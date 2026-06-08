export type Step = {
  id: number;
  title: string;
  why: string;
  sql: string;
  expect: string;
  inspect: {
    // No `table` → the file tree shows the whole warehouse root (storage-aware:
    // "demo/" on MinIO, bucket root on GCS). With `table`, it shows that table's
    // prefix (optionally narrowed to `subpath`, e.g. "data/").
    minio?: { table?: string; subpath?: string; hint: string };
    catalog?: { table?: string };
    snapshots?: { table: string };
    lineage?: { table: string };
    // Present only on the Flink interop step: renders the live row-count widget
    // (LiveStreamCount) that polls the Flink-written table and shows it growing.
    stream?: { table: string };
  };
  // When true, step page renders the wrap-up template instead of the
  // SQL/why/under-hood three-pane layout.
  wrapup?: boolean;
  // When true, this is an optional "bonus" step (the Flink streaming interop) —
  // it sits after the wrap-up and StepRail draws a separator before it.
  bonus?: boolean;
};

// SQL + title strings carry placeholders:
//   {{ROWS}}        — row count (formatted in titles, raw int in SQL)
//   {{ROWS_COMMA}}  — comma-grouped row count for prose
//   {{SECONDS}}     — days * 86400, for timestamp_seconds()
//   {{DAYS}}        — day count for prose
// Resolved at render via lib/demoConfig.applyConfig().

export const STEPS: Step[] = [
  {
    id: 1,
    title: "Create V3 trades table",
    why: `Two settings do the work here. \`format-version='3'\` picks the V3 spec. \`write.{delete,update,merge}.mode='merge-on-read'\` tells Iceberg that future UPDATE and DELETE statements should write tiny Puffin sidecar files (deletion vectors) instead of rewriting whole Parquet files. You'll see those sidecars appear in step 3.

The partition spec \`days(ts), bucket(8, symbol)\` keeps each Parquet file's row set narrow. When a deletion vector lands, it covers a small slice instead of a fat file.

Nothing on disk yet beyond one \`metadata.json\`. That file is Iceberg's record of the schema, partition spec, and table properties. Lakekeeper stores only a pointer to it.`,
    sql: `CREATE NAMESPACE IF NOT EXISTS demo.market;

DROP TABLE IF EXISTS demo.market.trades_v3;
CREATE TABLE demo.market.trades_v3 (
  trade_id   BIGINT,
  symbol     STRING,
  ts         TIMESTAMP,
  price      DOUBLE,
  qty        INT,
  side       STRING
)
USING iceberg
PARTITIONED BY (days(ts), bucket(8, symbol))
TBLPROPERTIES (
  'format-version'               = '3',
  'write.delete.mode'            = 'merge-on-read',
  'write.update.mode'            = 'merge-on-read',
  'write.merge.mode'              = 'merge-on-read',
  'write.target-file-size-bytes' = '134217728'
);`,
    expect: "Table appears in Lakekeeper. MinIO shows one metadata/00000-*.metadata.json under demo/market/trades_v3/.",
    inspect: {
      catalog: { table: "trades_v3" },
      minio: { table: "trades_v3", hint: "Empty data/. One metadata.json declaring format-version=3" },
      lineage: { table: "trades_v3" },
    },
  },
  {
    id: 2,
    title: "Bulk INSERT",
    why: `{{ROWS_COMMA}} rows across 8 symbols and {{DAYS}} days, spaced so every partition gets data. Row count and day window come from the panel above, and they're substituted into the SQL on every render. The INSERT runs asynchronously on the Thrift server and streams progress back over server-sent events so the browser doesn't time out.

## The four-layer file chain

Watch the lineage graph fill in top-down. Iceberg writes four layers per commit.

\`metadata.json\` is the table's pointer file. Lakekeeper holds an S3 URI to it. It lists every snapshot ever taken and points at the current one.

\`snap-<snapshot-id>.avro\` is the **manifest list** for that snapshot. One file, listing the manifests that belong to this commit (data manifests, delete manifests). Iceberg adds one of these per snapshot.

\`<uuid>-m0.avro\` is a **manifest**. It enumerates the actual data files (and their partition tuples, byte counts, row counts) added or kept by this commit. One INSERT typically writes one data manifest.

The \`data parquet\` tile at the bottom rolls up every file the manifest references. Click it to see the partition breakdown.

## What a snapshot actually is

A snapshot is an immutable, point-in-time view of the table: the exact set of data files plus delete files that make up its contents at that instant. Each snapshot has an ID, a parent snapshot, a timestamp, and a summary (operation, rows added, files added, etc.).

## When a new snapshot is written

Every time data or its visibility changes: INSERT, UPDATE, DELETE, MERGE, REPLACE INTO, plus maintenance calls like \`rewrite_data_files\` and \`expire_snapshots\`.

Pure-metadata edits do **not** create one. ADD/DROP/RENAME COLUMN, ALTER PARTITION FIELD, CREATE BRANCH, CREATE TAG all touch \`metadata.json\` only.

## Why this matters: time travel

Snapshots are append-only. Old ones stay reachable in \`metadata.json\` until \`expire_snapshots\` drops them. That is what makes time travel (\`VERSION AS OF\`, \`FOR TIMESTAMP AS OF\`) and rollback (\`set_current_snapshot\`) work. Step 8 collapses the history; steps 13 and 14 walk it.`,
    sql: `INSERT INTO demo.market.trades_v3
SELECT
  id AS trade_id,
  element_at(array('AAPL','MSFT','NVDA','AMZN','GOOG','META','TSLA','AMD'),
             CAST(pmod(id, 8) AS INT) + 1) AS symbol,
  timestamp_seconds(1700000000 + CAST(pmod(id, {{SECONDS}}) AS BIGINT)) AS ts,
  round(50 + rand() * 500, 2) AS price,
  CAST(1 + rand() * 1000 AS INT) AS qty,
  CASE WHEN pmod(id, 2) = 0 THEN 'BUY' ELSE 'SELL' END AS side
FROM range(0, {{ROWS}});

SELECT count(*) AS row_count FROM demo.market.trades_v3;`,
    expect: `{{ROWS_COMMA}} rows. Hundreds of Parquet data files appear under data/.`,
    inspect: {
      minio: { table: "trades_v3", hint: "data/ partitions populated; new metadata.json + snap-*.avro" },
      snapshots: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
    },
  },
  {
    id: 3,
    title: "DELETE: deletion vector",
    why: `One DELETE against the V3 merge-on-read table. Parquet from step 2 stays untouched; the deleted rows are masked in place by a Puffin sidecar.

## What the statement does

\`DELETE FROM trades_v3 WHERE side = 'SELL' AND qty < 5\` targets small SELL rows. Iceberg locates the partition files that hold matching rows and, for each one, writes a **Puffin deletion vector** (\`file_format='puffin'\`, \`content=1\`) flagging the row positions to skip. One new snapshot. Zero Parquet rewritten.

## What the lineage graph now shows

Two \`snap-*.avro\` files at the manifest-list row: original INSERT, plus this DELETE.

Two manifests below. The original **data manifest** from step 2 is reused (manifests are immutable, snapshots just re-point). The new one is a **delete manifest** that enumerates the Puffin DVs added by this snapshot.

At the bottom: original 25 data Parquet (step 2) plus the **Puffin DV** tile from this step.

## The dashed shadows edges

Each Puffin DV stores a \`referenced_data_file\` pointer. Dashed line from a DV to its data Parquet means "this DV masks rows in that file." Spark reads the Parquet, applies the DV's Roaring bitmap, skips masked positions.

## What changes in storage and snapshots

\`.delete_files\` should list every new DV as \`file_format='puffin'\`, \`content=1\`. \`.snapshots\` picks up one new \`delete\` operation on top of step 2.`,
    sql: `DELETE FROM demo.market.trades_v3 WHERE side = 'SELL' AND qty < 5;

SELECT file_format, content, count(*) AS files
FROM demo.market.trades_v3.delete_files
GROUP BY file_format, content;

SELECT committed_at, operation, summary['total-delete-files'] AS delete_files
FROM demo.market.trades_v3.snapshots
ORDER BY committed_at;`,
    expect: "delete_files all show file_format=puffin, content=1. One new delete snapshot.",
    inspect: {
      minio: { table: "trades_v3", subpath: "data/", hint: "New *.puffin files alongside the existing Parquet. No Parquet rewrites" },
      snapshots: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
    },
  },
  {
    id: 4,
    title: "UPDATE: DV + Parquet",
    why: `One UPDATE that touches every NVDA row. UPDATE on a MoR table = DELETE old + INSERT new. The old rows get masked by Puffin DVs; the new values land in a fresh small Parquet.

## What the statement does

\`UPDATE trades_v3 SET price = price * 1.10 WHERE symbol = 'NVDA'\`. NVDA rows live in one bucket but span **{{DAYS}} day partitions** at the current setting. Iceberg writes one **Puffin DV per affected data file** masking the old NVDA rows, plus **1 new Parquet** holding the bumped-price replacements. One new snapshot.

## What the lineage graph now shows

Three \`snap-*.avro\` lanes total: INSERT (step 2), DELETE (step 3), UPDATE (this step).

Four manifests across the row. Original data manifest still reused. New manifests under the UPDATE lane: one **data manifest** for the replacement Parquet, one **delete manifest** for the new DVs.

At the bottom: original data Parquet, the DV tile from step 3, **1 new data Parquet** (replacements), and a fresh DV tile from this step. Each new DV has a dashed shadows edge back to a different NVDA partition file.

## Why splitting matters

Splitting DELETE and UPDATE across two steps keeps each snapshot's contribution to the graph small. A combined run produces all DVs + 1 replacement Parquet in a single snapshot, which fans the graph out wide and hides which DV came from which statement.

## What changes in storage and snapshots

\`.delete_files\` total grows by the partition count. \`.snapshots\` picks up one new \`overwrite\` operation (UPDATE rewrites via overwrite).`,
    sql: `UPDATE demo.market.trades_v3 SET price = price * 1.10 WHERE symbol = 'NVDA';

SELECT file_format, content, count(*) AS files
FROM demo.market.trades_v3.delete_files
GROUP BY file_format, content;

SELECT committed_at, operation, summary['total-delete-files'] AS delete_files
FROM demo.market.trades_v3.snapshots
ORDER BY committed_at;`,
    expect: "delete_files puffin count grows. Snapshot timeline now has three operations.",
    inspect: {
      minio: { table: "trades_v3", subpath: "data/", hint: "More *.puffin files plus 1 small data Parquet for NVDA replacements" },
      snapshots: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
    },
  },
  {
    id: 5,
    title: "Row lineage",
    why: `V3 stamps every row with two hidden columns. \`_row_id\` is a stable identifier that survives UPDATEs. \`_last_updated_sequence_number\` records the snapshot sequence that last touched the row.

That pair is enough to do change-data-capture without a separate pipeline: "what changed since sequence N" is just a WHERE clause, so you can drop the usual Debezium-plus-audit-tables-plus-triggers machinery.

The first query below shows NVDA at its updated price. The second counts every row mutated since the initial load (the deleted SELLs plus the NVDA updates).

## The \`.changes\` metadata view

V3 elevates the lineage columns into a first-class **incremental-read primitive**: \`<table>.changes\` projects rows tagged by \`_change_type\` (INSERT / UPDATE_BEFORE / UPDATE_AFTER / DELETE), plus \`_change_ordinal\` and \`_commit_snapshot_id\`, for a given snapshot range. That is your CDC stream, sitting in the table metadata itself rather than in a separate Debezium-and-audit-table setup.

Spark 3.5 + Iceberg 1.11 (this demo) cannot yet plan a changelog scan over Puffin deletion vectors, so the live query is deferred here, since steps 3 and 4 already wrote DVs. Spark 4 + Iceberg 1.12 lifts the limit and makes \`SELECT * FROM trades_v3.changes\` work end to end against the same V3 metadata.`,
    sql: `SELECT trade_id, symbol, price, _row_id, _last_updated_sequence_number
FROM demo.market.trades_v3
WHERE symbol = 'NVDA'
LIMIT 10;

SELECT count(*) AS rows_changed_since_seq_1
FROM demo.market.trades_v3
WHERE _last_updated_sequence_number > 1;

-- (.changes view demo deferred: Spark 3.5 / Iceberg 1.11 changelog scans
--  cannot yet read through Puffin deletion vectors, and steps 3/4 already
--  added DVs to this table. Spark 4 / Iceberg 1.12 lifts that limit. See
--  the "why" panel for the projection's column shape.)`,
    expect: "_row_id is non-null; rows_changed_since_seq_1 ≈ count of (deleted SELL + updated NVDA). .changes view is documented but skipped on Spark 3.5 + Iceberg 1.11.",
    inspect: { snapshots: { table: "trades_v3" }, lineage: { table: "trades_v3" } },
  },
  {
    id: 6,
    title: "ADD COLUMN",
    why: `Adding a column doesn't rewrite anything. Iceberg stores schemas by version, and old data files are read against the new schema by field ID. Existing rows return NULL for the new column.

V3 also supports per-column DEFAULT values that get filled in on read, but Spark 3.5 doesn't pass the SQL \`DEFAULT\` clause through to Iceberg (it throws \`UnsupportedOperationException\`). That needs Spark 4.0 with Iceberg 1.12+. So we add the column without a default and read the old rows back as NULL.

You should see a new \`metadata.json\` with seven columns. Zero Parquet files change.`,
    sql: `ALTER TABLE demo.market.trades_v3 ADD COLUMN exchange STRING;
SELECT exchange, count(*) FROM demo.market.trades_v3 GROUP BY exchange;`,
    expect: "One row: exchange=NULL, count=full row count. New metadata.json appears.",
    inspect: {
      minio: { table: "trades_v3", subpath: "metadata/", hint: "Latest metadata.json. Schema now has 7 columns" },
      catalog: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
    },
  },
  {
    id: 7,
    title: "V2 contrast",
    why: `Same DELETE, V2 table, different output. V2 represents row-level deletes as Parquet files listing the (file, row_position) pairs to skip. Every scan has to read both the data Parquet and the delete Parquet, then anti-join them.

V3's Puffin deletion vectors do the same job as a compressed bitmap per data file. Much smaller on disk, and applied as a fast bitmap-test on read instead of an anti-join.

The UNION below puts the two side by side so you can see \`file_format='parquet'\` for V2 and \`'puffin'\` for V3 from the same delete intent.`,
    sql: `DROP TABLE IF EXISTS demo.market.trades_v2;
CREATE TABLE demo.market.trades_v2
USING iceberg
PARTITIONED BY (bucket(8, symbol))
TBLPROPERTIES ('format-version'='2','write.delete.mode'='merge-on-read')
AS SELECT * FROM demo.market.trades_v3 LIMIT 1000000;

DELETE FROM demo.market.trades_v2 WHERE side = 'SELL' AND qty < 5;

SELECT 'v2' AS fmt, file_format, content, count(*) FROM demo.market.trades_v2.delete_files GROUP BY file_format, content
UNION ALL
SELECT 'v3' AS fmt, file_format, content, count(*) FROM demo.market.trades_v3.delete_files GROUP BY file_format, content;`,
    expect: "v2 row: file_format=parquet. v3 row: file_format=puffin. Same deletion intent, different physical encoding.",
    inspect: {
      minio: { hint: "trades_v2/ tree appears alongside trades_v3/; v2 delete files are parquet" },
      catalog: {},
      lineage: { table: "trades_v2" },
    },
  },
  {
    id: 8,
    title: "Compaction + expiry",
    why: `Three calls, in order. \`rewrite_data_files\` folds the Puffin deletion vectors back into clean Parquet. A real rewrite, not a no-op, since the new files don't carry the deleted rows. \`rewrite_manifests\` repacks manifest entries so query planning scans less metadata. \`expire_snapshots\` drops history older than the cutoff while keeping the most recent snapshot as the current one.

The snapshot timeline collapses to a single entry. The old Parquet and Puffin files are still in MinIO but nothing points at them anymore. A real garbage-collection pass would reclaim the bytes.`,
    sql: `CALL demo.system.rewrite_data_files(table => 'market.trades_v3');
CALL demo.system.rewrite_manifests(table => 'market.trades_v3');
CALL demo.system.expire_snapshots(table => 'market.trades_v3', older_than => TIMESTAMP '2000-01-01 00:00:00', retain_last => 1);

SELECT count(*) AS final_row_count FROM demo.market.trades_v3;`,
    expect: "final_row_count == post-DELETE count. Snapshot timeline collapses to a single entry.",
    inspect: {
      minio: { table: "trades_v3", hint: "Fresh post-compaction Parquet; puffin DVs no longer referenced" },
      snapshots: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
    },
  },
  {
    id: 9,
    title: "MERGE INTO",
    why: `MERGE INTO is the upsert primitive every CDC pipeline needs. One statement updates the matched rows and inserts the unmatched ones, against an arbitrary source query.

On a V3 merge-on-read table this maps cleanly onto two physical effects. Matched updates write a Puffin deletion vector that masks the old row version (the new version lands in fresh Parquet). Unmatched inserts append Parquet directly.

The query at the end inspects the latest snapshots: a single MERGE call moved both \`data_files\` (the inserts) and \`delete_files\` (the DV for matched updates).`,
    sql: `DROP TABLE IF EXISTS demo.market.trades_v3_staging;
CREATE TABLE demo.market.trades_v3_staging
USING iceberg
TBLPROPERTIES ('format-version'='3') AS
(SELECT trade_id, symbol, ts, price * 1.05 AS price, qty, side, 'NASDAQ' AS exchange
 FROM demo.market.trades_v3
 WHERE symbol IN ('AAPL', 'NVDA') LIMIT 1000)
UNION ALL
(SELECT (1000000000 + id) AS trade_id, 'NEW' AS symbol,
        timestamp_seconds(1700000000) AS ts, 99.0 AS price,
        CAST(id AS INT) AS qty, 'BUY' AS side, 'NASDAQ' AS exchange
 FROM range(0, 500));

MERGE INTO demo.market.trades_v3 t
USING demo.market.trades_v3_staging s
ON t.trade_id = s.trade_id
WHEN MATCHED THEN UPDATE SET t.price = s.price, t.exchange = s.exchange
WHEN NOT MATCHED THEN INSERT (trade_id, symbol, ts, price, qty, side, exchange)
                      VALUES (s.trade_id, s.symbol, s.ts, s.price, s.qty, s.side, s.exchange);

SELECT operation, summary['total-data-files'] AS data_files,
       summary['total-delete-files'] AS delete_files
FROM demo.market.trades_v3.snapshots
ORDER BY committed_at DESC LIMIT 3;`,
    expect: "Latest snapshot is overwrite-style. delete_files grew (DV for matched rows); data_files grew (inserted rows).",
    inspect: {
      snapshots: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
      minio: { table: "trades_v3", hint: "New data files + new Puffin DV for the matched updates" },
    },
  },
  {
    id: 10,
    title: "CoW vs MoR",
    why: `Build a copy-on-write sibling, run the same DELETE on both tables, compare. Copy-on-write rewrites every Parquet file that contains a deleted row: the new file is the old one minus the matched rows. Merge-on-read leaves the Parquet alone and writes a Puffin sidecar pointing at the rows to skip.

The \`.files\` metadata view sums bytes-on-disk per table. The MoR side shows mostly unchanged data with small DVs; the CoW side shows fresh Parquet for every touched partition.

The trade-off in production: CoW makes reads simpler and slightly faster but writes more bytes; MoR is the reverse, and benefits from periodic compaction (see step 8). At the current {{ROWS}}-row scale, the CoW sibling is built as a 10% sample so the comparison stays fast.`,
    sql: `DROP TABLE IF EXISTS demo.market.trades_v3_cow;
CREATE TABLE demo.market.trades_v3_cow
USING iceberg
PARTITIONED BY (bucket(8, symbol))
TBLPROPERTIES (
  'format-version' = '3',
  'write.delete.mode' = 'copy-on-write',
  'write.update.mode' = 'copy-on-write',
  'write.merge.mode'  = 'copy-on-write'
) AS SELECT trade_id, symbol, ts, price, qty, side FROM demo.market.trades_v3 LIMIT 500000;

DELETE FROM demo.market.trades_v3_cow WHERE side = 'SELL' AND qty < 5;

SELECT 'MoR (merge-on-read)' AS table_kind, count(*) AS data_files,
       sum(file_size_in_bytes) AS bytes
FROM demo.market.trades_v3.files
UNION ALL
SELECT 'CoW (copy-on-write)' AS table_kind, count(*) AS data_files,
       sum(file_size_in_bytes) AS bytes
FROM demo.market.trades_v3_cow.files;`,
    expect: "Two rows: MoR (merge-on-read) row has small bytes (most files unchanged + DVs); CoW (copy-on-write) row shows the rewritten data files.",
    inspect: {
      lineage: { table: "trades_v3_cow" },
      snapshots: { table: "trades_v3_cow" },
      minio: { table: "trades_v3_cow", hint: "Fresh Parquet for each touched partition. No .puffin in this tree" },
    },
  },
  {
    id: 11,
    title: "Partition evolution",
    why: `\`REPLACE PARTITION FIELD\` changes how new writes get laid out, without touching anything that's already on disk. Existing rows stay in \`ts_day=...\` directories (from the {{DAYS}}-day load in step 2). New rows land under \`ts_hour=...\`.

The same SELECT reads both layouts: Iceberg keeps the partition spec a file was written under, and plans each scan against the spec the file remembers. No rewrite needed.

(Iceberg permits one time transform per source column. \`hours(ts)\` and \`days(ts)\` collide on the same source, so this has to be a REPLACE, not an ADD.)

The \`.partitions\` view at the bottom lists both layouts coexisting.`,
    sql: `ALTER TABLE demo.market.trades_v3 REPLACE PARTITION FIELD ts_day WITH hours(ts) AS ts_hour;

INSERT INTO demo.market.trades_v3
SELECT id + 2000000000 AS trade_id,
       'AAPL' AS symbol,
       timestamp_seconds(1701000000 + CAST(id AS BIGINT)) AS ts,
       100.0 AS price, CAST(id AS INT) AS qty, 'BUY' AS side, 'NASDAQ' AS exchange
FROM range(0, 50000);

SELECT to_json(partition) AS partition, record_count
FROM demo.market.trades_v3.partitions
ORDER BY record_count DESC LIMIT 10;`,
    expect: ".partitions shows both ts_day and ts_hour buckets coexisting. Old data not rewritten.",
    inspect: {
      lineage: { table: "trades_v3" },
      snapshots: { table: "trades_v3" },
      minio: { table: "trades_v3", subpath: "data/", hint: "New ts_hour=... directory tree alongside the legacy ts_day=... one" },
    },
  },
  {
    id: 12,
    title: "Schema evolution",
    why: `Iceberg identifies columns by integer field ID, not by name. RENAME just updates the schema's name-to-id map. DROP marks the field ID as deleted. Type widening (INT to BIGINT, FLOAT to DOUBLE) records the new type in the schema. None of these touch a single Parquet byte; old data files are reinterpreted by the new schema on read.

The \`metadata/\` directory gains a new schema version. The \`data/\` directory is untouched. The SELECT at the end pulls rows written before the rename and returns them under the new column name.`,
    sql: `ALTER TABLE demo.market.trades_v3 RENAME COLUMN qty TO quantity;
ALTER TABLE demo.market.trades_v3 DROP COLUMN side;

DESCRIBE TABLE demo.market.trades_v3;

SELECT trade_id, symbol, price, quantity, exchange
FROM demo.market.trades_v3
WHERE symbol = 'NVDA' LIMIT 5;`,
    expect: "DESCRIBE shows `quantity` (was qty), no `side` column. SELECT against the renamed column returns rows from the old data files.",
    inspect: {
      catalog: { table: "trades_v3" },
      lineage: { table: "trades_v3" },
      minio: { table: "trades_v3", subpath: "metadata/", hint: "New metadata.json with the evolved schema. Data files untouched" },
    },
  },
  {
    id: 13,
    title: "Branches and tags",
    why: `Branches and tags are named pointers into the snapshot graph, stored in \`metadata.json\`. A branch advances when you write to it (\`INSERT INTO table.branch_<name>\`); a tag stays put. Creating either is a metadata-only edit. No data movement.

This is the write-audit-publish pattern. Write to a \`staging\` branch, run validation queries against it, fast-forward \`main\` once it looks right. Tags pin known-good snapshots for compliance or as rollback targets.

The \`.refs\` metadata view is V3's first-class projection of those pointers: \`name / type / snapshot_id / max_ref_age_ms / min_snapshots_to_keep\`. Every branch and tag shows up as one row, including the implicit \`main\` branch. The two SELECTs at the bottom compare \`staging\` (with the new 1000 STG rows) against \`main\` (without).`,
    sql: `ALTER TABLE demo.market.trades_v3 CREATE BRANCH staging;

INSERT INTO demo.market.trades_v3.branch_staging
SELECT (3000000000 + id) AS trade_id, 'STG' AS symbol,
       timestamp_seconds(1702000000) AS ts, 1.0 AS price,
       CAST(id AS INT) AS quantity, 'NASDAQ' AS exchange
FROM range(0, 1000);

ALTER TABLE demo.market.trades_v3 CREATE TAG \`release-v1\`;

SELECT * FROM demo.market.trades_v3.refs ORDER BY name;

SELECT 'staging' AS ref, count(*) FROM demo.market.trades_v3 VERSION AS OF 'staging'
UNION ALL
SELECT 'main',  count(*) FROM demo.market.trades_v3;`,
    expect: ".refs lists main + staging + release-v1 with their snapshot IDs and retention settings. The staging count is higher than main (the 1000 STG rows only live on the branch).",
    inspect: {
      lineage: { table: "trades_v3" },
      snapshots: { table: "trades_v3" },
      catalog: { table: "trades_v3" },
    },
  },
  {
    id: 14,
    title: "Rollback + time travel",
    why: `The pattern is: tag the snapshot you trust, do the dangerous thing, and if it goes wrong, point the table back at the tag.

A bad DELETE still writes a snapshot. \`set_current_snapshot\` (used here with \`ref => 'pre_bad_delete'\`) moves the current-pointer back to the tagged snapshot. The bad snapshot stays in the metadata graph; you could point at it again if you change your mind.

\`FOR TIMESTAMP AS OF\` does the same idea by wall-clock instant instead of a named ref.

The three counts show the round-trip: full count, drop after the bad DELETE, full count restored after rollback. The trailing \`.history\` view spells out the snapshot lineage that made the rollback possible: \`parent_id\` links every snapshot to its predecessor, and a rollback grafts a new head onto the chain while leaving the orphaned bad-delete snapshot intact (still reachable, just not current).`,
    sql: `ALTER TABLE demo.market.trades_v3 CREATE TAG \`pre_bad_delete\`;

SELECT count(*) AS before_bad_delete FROM demo.market.trades_v3;

DELETE FROM demo.market.trades_v3 WHERE symbol = 'AAPL';

SELECT count(*) AS after_bad_delete FROM demo.market.trades_v3;

CALL demo.system.set_current_snapshot(
  table => 'market.trades_v3',
  ref   => 'pre_bad_delete');

SELECT count(*) AS after_rollback FROM demo.market.trades_v3;

-- Full snapshot chain: parent_id ties every snapshot back to its predecessor.
SELECT made_current_at, snapshot_id, parent_id, is_current_ancestor
FROM demo.market.trades_v3.history
ORDER BY made_current_at;`,
    expect: "after_bad_delete drops a lot; after_rollback returns to before_bad_delete. .history shows parent_id linking each snapshot; the bad-delete snapshot is no longer is_current_ancestor.",
    inspect: {
      lineage: { table: "trades_v3" },
      snapshots: { table: "trades_v3" },
    },
  },
  {
    id: 15,
    title: "Sort orders + clustering",
    why: `Iceberg has no \`CLUSTERED BY\` keyword like Hive or Databricks SQL. The equivalent is three composable levers, each at a different point in the write path.

## Three levers

1. **Hidden partitioning** (step 1: \`days(ts), bucket(8, symbol)\`). Splits data into prunable directories. Coarse, operating at the file-group level.
2. **Table-level sort order** (this step). Metadata-only: \`ALTER TABLE … WRITE ORDERED BY (col1, col2)\` records the desired order in \`metadata.json\`, and every subsequent INSERT / MERGE / branch write honors it. Free at write time, applies within each partition, gives the planner tight \`lower_bounds\` / \`upper_bounds\` per file so range filters prune more.
3. **Z-order rewrite** (step 17: \`rewrite_data_files\` with \`strategy => 'sort', sort_order => 'zorder(symbol, ts)'\`). Maintenance-time. Interleaves a multi-dimensional curve across files so queries with predicates on either column prune well. Use when you cannot pick a single primary sort axis.

## What the SQL below proves

\`WRITE ORDERED BY (symbol, ts)\` writes a new metadata.json with the sort order set. The follow-up INSERT writes 100K fresh rows; because the sort order is now in effect, Spark sorts the input batch before writing Parquet, so each new file's \`symbol\` column holds a tight, non-overlapping range.

The \`.files\` view exposes those ranges. The raw \`lower_bounds\` / \`upper_bounds\` are a \`map<int, binary>\` (field-id keyed, raw bytes, awkward to compare). \`readable_metrics\` is the engine-friendly projection: a struct keyed by column name with decoded values. After the sorted INSERT the latest snapshot's files should show clean, non-overlapping symbol bounds. Older files from the unsorted bulk INSERT in step 2 still have interleaved ranges, and that side-by-side is the visual "did clustering work?" check.`,
    sql: `ALTER TABLE demo.market.trades_v3 WRITE ORDERED BY (symbol, ts);

INSERT INTO demo.market.trades_v3
SELECT
  ({{ROWS}} + id) AS trade_id,
  element_at(array('AAPL','MSFT','NVDA','AMZN','GOOG','META','TSLA','AMD'),
             CAST(pmod(id, 8) AS INT) + 1) AS symbol,
  timestamp_seconds(1700000000 + CAST(pmod(id, {{SECONDS}}) AS BIGINT)) AS ts,
  round(50 + rand() * 500, 2) AS price,
  CAST(1 + rand() * 1000 AS INT) AS quantity,
  'NASDAQ' AS exchange
FROM range(0, 100000);

-- Files from the newest snapshot should have tight, non-overlapping
-- symbol bounds. readable_metrics is a struct keyed by column name with
-- already-decoded values; survives schema changes, types compare naturally.
SELECT file_path,
       readable_metrics.symbol.lower_bound AS symbol_lo,
       readable_metrics.symbol.upper_bound AS symbol_hi,
       record_count
FROM demo.market.trades_v3.files
ORDER BY file_path DESC
LIMIT 10;`,
    expect: "metadata.json now records the sort order. The newest snapshot's files have tight, non-overlapping symbol_lo / symbol_hi vs the interleaved bounds on older files.",
    inspect: {
      lineage: { table: "trades_v3" },
      snapshots: { table: "trades_v3" },
      minio: { table: "trades_v3", hint: "Newer parquet files are pre-sorted by (symbol, ts)" },
    },
  },
  {
    id: 16,
    title: "Perf + price payoff",
    why: `Partitioning, sort orders, and the Z-order rewrite barely cost anything when you write. You get it back on every read, because Iceberg can skip files it already knows can't match the predicate.

This step builds a V3 sibling with no partitioning and no sort order, then runs the same predicate against both tables. What it measures is the files and bytes a query like \`WHERE symbol = 'NVDA'\` would have to open, read straight from Iceberg's manifest min/max metadata. Nothing actually gets scanned; Iceberg prunes before it opens a single Parquet.

## What the comparison shows

The CTE counts files whose \`[lower_bounds, upper_bounds]\` for the \`symbol\` column overlap \`'NVDA'\`. On the **partitioned + sorted** table the bucket transform isolates NVDA into a single bucket directory, and the sort order from step 15 tightens per-file bounds, so the bulk of files are pruned by manifest alone. On the **flat** sibling every file has a wide bounds range (NVDA scattered across all of them), so nothing is pruned and Spark has to open every Parquet's row groups before it can skip anything.

## Other places V3 saves on cost in this demo

- **Merge-on-read with Puffin DVs (step 3).** UPDATE/DELETE write a few-KB bitmap instead of rewriting tens-of-MB Parquet, which cuts the bytes you write to cloud storage.
- **\`.changes\` incremental read (step 5).** A CDC stream without Debezium, Kafka, or a separate state store. The pipeline cost goes from "extra cluster" to "WHERE clause".
- **Schema/partition evolution without rewrites (steps 11, 12).** Adding columns, renaming, even reshaping partition layout costs zero compute. The old data is reread under the new schema by field id.
- **Branches and tags (step 13).** Write-audit-publish without table copies. Validation queries hit the staging branch's snapshot in place.
- **\`rewrite_manifests\` + sort/Z-order compaction (next step).** Narrower manifests and tighter per-file bounds compound the pruning effect.
- **Puffin theta sketches via \`compute_table_stats\` (next step).** The query planner sizes joins from sketches in metadata, with no sampling job.

## How the planner actually uses this

When Spark sees \`WHERE symbol = 'NVDA'\`, Iceberg's planner walks the manifest list and checks each entry's bounds map. Files whose \`[lo, hi]\` doesn't include 'NVDA' get skipped, so Spark never opens the Parquet footer. Once a file is open, the per-file row-group min/max prunes further, and column projection means only the symbol, ts, and price columns get decoded. Stack those together and the bytes you actually read drop sharply, which is where the cloud-bill savings come from.`,
    sql: `DROP TABLE IF EXISTS demo.market.trades_v3_flat;
CREATE TABLE demo.market.trades_v3_flat
USING iceberg
TBLPROPERTIES ('format-version'='3')  -- no PARTITIONED BY, no WRITE ORDERED BY
AS SELECT trade_id, symbol, ts, price, quantity, exchange
   FROM demo.market.trades_v3 LIMIT 500000;

-- Manifest-level pruning. readable_metrics is the decoded, column-name-keyed
-- projection of the per-file bounds map (raw lower_bounds/upper_bounds are
-- map<int, binary>, awkward to compare against string literals).
SELECT 'v3 partitioned + sorted' AS variant,
       count(*) AS total_files,
       sum(file_size_in_bytes) AS total_bytes,
       sum(CASE WHEN readable_metrics.symbol.lower_bound <= 'NVDA'
                 AND readable_metrics.symbol.upper_bound >= 'NVDA'
                THEN 1 ELSE 0 END) AS files_touched_for_nvda,
       sum(CASE WHEN readable_metrics.symbol.lower_bound <= 'NVDA'
                 AND readable_metrics.symbol.upper_bound >= 'NVDA'
                THEN file_size_in_bytes ELSE 0 END) AS bytes_touched_for_nvda
FROM demo.market.trades_v3.files
UNION ALL
SELECT 'v3 flat (no partition, no sort)' AS variant,
       count(*),
       sum(file_size_in_bytes),
       sum(CASE WHEN readable_metrics.symbol.lower_bound <= 'NVDA'
                 AND readable_metrics.symbol.upper_bound >= 'NVDA'
                THEN 1 ELSE 0 END),
       sum(CASE WHEN readable_metrics.symbol.lower_bound <= 'NVDA'
                 AND readable_metrics.symbol.upper_bound >= 'NVDA'
                THEN file_size_in_bytes ELSE 0 END)
FROM demo.market.trades_v3_flat.files;

-- Same query, wall-clock. Both return identical row counts; the partitioned+
-- sorted side reads a fraction of the bytes.
SELECT 'v3 partitioned + sorted' AS variant, count(*) AS nvda_rows
FROM demo.market.trades_v3 WHERE symbol = 'NVDA'
UNION ALL
SELECT 'v3 flat (no partition, no sort)',  count(*)
FROM demo.market.trades_v3_flat WHERE symbol = 'NVDA';`,
    expect: "files_touched_for_nvda on the partitioned+sorted table is roughly 1/8 of total_files (the NVDA bucket); on the flat table every file is touched. bytes_touched_for_nvda differs by the same ratio. The wall-clock SELECTs return identical NVDA row counts.",
    inspect: {
      lineage: { table: "trades_v3_flat" },
      snapshots: { table: "trades_v3" },
      minio: { table: "trades_v3_flat", hint: "Flat sibling: one big directory of Parquet, no ts_*=/symbol_bucket=* subdirs" },
    },
  },
  {
    id: 17,
    title: "Maintenance jobs",
    why: `Three maintenance procedures, all callable from SQL.

\`rewrite_data_files\` folds the long tail of small files into fewer right-sized Parquet. Bin-pack here. Swap in \`strategy => 'sort', sort_order => 'zorder(symbol, ts)'\` to also co-locate rows by symbol and time across files (the third clustering lever from step 15). That is what makes range scans on those columns fast.

\`compute_table_stats\` is V3's Puffin-backed statistics primitive. It materializes column-level statistics (Apache DataSketches **theta sketches** for approximate distinct count, soon HLL and quantile sketches) as a Puffin blob and registers it under \`metadata.json.statistics[]\` against the current snapshot. The query planner reads those sketches to size join inputs and prune dimensions without scanning data files. The lineage graph picks up a new \`stats-puffin\` node attached to the current snapshot.

\`expire_snapshots\` drops history past a retention horizon. Snapshots referenced by branches or tags stay regardless.

After this, the \`.files\` view summarizes the cleaner layout: fewer files, larger average size. \`.partitions\` confirms record_count per partition tuple.

**Why \`remove_orphan_files\` is skipped here.**

The procedure walks every object under the table's S3 prefix, then cross-references it against everything reachable from the current snapshot tree: \`metadata.json\` → manifest list → manifest → data files + delete files. Anything present in storage but not referenced is an orphan, and gets deleted. Orphans come from failed or aborted writes, killed compactions, partial commits, crashed Spark drivers.

It needs the Hadoop FileSystem API, not Iceberg's own S3FileIO:

- \`RemoveOrphanFilesSparkAction\` calls Spark's \`FileSystem.listStatus(path)\` to enumerate the prefix.
- \`FileSystem\` is the Hadoop API (\`org.apache.hadoop.fs.*\`). For S3 it needs the \`s3a://\` scheme registered, which lives in \`hadoop-aws.jar\` + \`aws-java-sdk-bundle.jar\`.
- This image only ships \`iceberg-aws-bundle.jar\`. That bundle gives Iceberg's \`S3FileIO\` for reading data files, but it does **not** register an \`s3a://\` Hadoop FileSystem. So \`FileSystem.get("s3a://warehouse/")\` throws \`No FileSystem for scheme: s3a\`.

To enable in production:

1. Drop \`hadoop-aws-3.3.4.jar\` + \`aws-java-sdk-bundle-1.12.x.jar\` into \`/opt/spark/jars\`.
2. Add to \`spark-defaults.conf\`:
   - \`spark.hadoop.fs.s3a.endpoint http://minio:9000\`
   - \`spark.hadoop.fs.s3a.access.key <key>\`
   - \`spark.hadoop.fs.s3a.secret.key <secret>\`
   - \`spark.hadoop.fs.s3a.path.style.access true\`
3. Call \`demo.system.remove_orphan_files(table => 'market.trades_v3', older_than => TIMESTAMP '...')\`.

Reasons left out of the demo: ~50 MB extra image weight; and a real footgun: \`older_than\` defaults to **3 days** specifically so it never races with an in-flight write. Lower it carelessly and you can wipe data files that a concurrent commit was about to reference. Iceberg deliberately makes this knob hard to override.`,
    sql: `CALL demo.system.rewrite_data_files(
  table => 'market.trades_v3',
  options => map(
    'min-input-files', '5',
    'target-file-size-bytes', '67108864',
    'partial-progress.enabled', 'true'
  ));

-- remove_orphan_files is omitted: the Iceberg action walks the prefix with
-- Hadoop FS, but this image only ships S3FileIO (no s3:// Hadoop FileSystem).
-- Add hadoop-aws + fs.s3a creds to spark-defaults to enable it in production.

CALL demo.system.expire_snapshots(
  table => 'market.trades_v3',
  older_than => TIMESTAMP '2099-01-01 00:00:00',
  retain_last => 1);

-- V3 Puffin-backed column statistics (theta sketches). Lineage panel picks
-- this up as a stats-puffin node attached to the current snapshot.
CALL demo.system.compute_table_stats(
  table   => 'market.trades_v3',
  columns => array('symbol'));

SELECT count(*) AS files, sum(file_size_in_bytes) AS total_bytes,
       avg(file_size_in_bytes) AS avg_bytes
FROM demo.market.trades_v3.files;

SELECT to_json(partition) AS partition, record_count
FROM demo.market.trades_v3.partitions
ORDER BY record_count DESC LIMIT 10;`,
    expect: "files / total_bytes / avg_bytes summarize the post-compaction layout. compute_table_stats writes a Puffin stats blob; metadata.json picks up a statistics[] entry and the lineage graph shows a stats-puffin node.",
    inspect: {
      lineage: { table: "trades_v3" },
      snapshots: { table: "trades_v3" },
      minio: { table: "trades_v3", hint: "Compacted Parquet. New Puffin stats blob in metadata/. Old snapshots dereferenced" },
    },
  },
  {
    id: 18,
    title: "Wrap-up",
    why: "Live counters and a production-hardening checklist. No SQL.",
    sql: "",
    expect: "",
    inspect: {},
    wrapup: true,
  },
  {
    id: 19,
    bonus: true,
    title: "Multi-engine streaming (Flink)",
    why: `**Bonus — optional Flink streaming engine.** Everything up to here ran on **Spark** (batch). This step shows a *second* engine, **Apache Flink**, writing into the **same Iceberg catalog** Spark reads — multi-engine interop on one source of truth.

**What Flink is doing.** A continuous Flink job generates synthetic trades (a \`datagen\` source) and appends them to \`demo.market.trades_stream\` through an Iceberg sink. The sink commits a new snapshot **on every checkpoint (~10s)**, so the table grows in visible bursts.

**Start it first.** The stream doesn't run on deploy. Click **▶ Start streaming** on the live tile to the right; the Flink jobmanager submits the job and the count starts climbing every checkpoint. Run the \`count(*)\` below twice a few seconds apart and the number moves. (The same tile has a Stop button.)

**Why this is a separate engine, not a Spark/Flink toggle.** The two are *not* interchangeable. This demo's batch script (steps 1–17) is Spark-dialect: \`MERGE INTO\`, the \`range()\` table function, \`CALL\` maintenance procedures, Spark DDL — none of which exist in Flink SQL. So Flink can't *replace* Spark without dropping half the V3 features. It's **additive**: Spark stays the batch showcase; Flink adds the thing batch can't show — a long-running append stream.

**The interop proof.** One Lakekeeper REST catalog, one MinIO bucket, two engines. Flink writes; Spark (these queries) reads the identical table. Neither knows about the other — they only share the catalog. That is exactly how an open lakehouse decouples storage from compute.

**Try the sample queries.** All seven below run on **Spark over the live Flink stream**, so re-run any of them a few seconds apart and the numbers move. Past the \`count(*)\` interop proof you get a per-symbol leaderboard, tumbling-window volume buckets, **1-minute OHLC candlesticks rebuilt in plain Spark SQL** (#5), and a snapshots query (#6) that exposes Flink's commit cadence: one snapshot per ~10s checkpoint. Run all, or highlight one statement and Run just that.

**Stream ⨝ batch — the temporal join (#7).** The Flink stream emits the same eight tickers (\`AAPL, MSFT, NVDA, …\`) the batch table \`trades_v3\` uses in step 1, so query #7 can **join the live stream's last two minutes against that static table** on the shared symbol and show live-vs-historical price drift. One engine writes the stream, another wrote the batch table, and Spark joins them on one catalog — exactly the lakehouse payoff. (Needs step 1's \`trades_v3\`; on a fresh catalog that statement errors until you run step 1.)

**Format note.** \`trades_stream\` is **format-version 3, append-only**, the same V3 line as the rest of the demo. Flink writes it and Spark reads back V3 **row lineage**: every row carries a \`_row_id\` and \`_last_updated_sequence_number\` the sink assigned. Since it only appends, there are no deletion vectors here; Flink equality-delete upserts on a V3 stream are still a stretch goal.

**Storage-agnostic, like Spark.** Flink uses the same \`ResolvingFileIO\` and Lakekeeper vended credentials as Spark, so the stream writes to either a **MinIO or a GCS** warehouse with no static GCS key in the container. Switch the storage target at runtime and the jobmanager's resubmit supervisor reruns the stream against the newly registered warehouse, so the count picks back up by itself.

> Requires the optional Flink engine. If you deployed Spark-only, the tile on the right explains how to redeploy with Flink (\`./deploy.sh\` → option 2).`,
    sql: `-- Spark reading the LIVE Flink stream. Run all, or select one statement and Run.
-- Re-run while Flink streams — the numbers move.

-- 1. Interop proof: Flink writes, Spark counts the same catalog table.
SELECT count(*) AS row_count FROM demo.market.trades_stream;

-- 2. Per-symbol leaderboard: who's trading, at what price, for how much notional.
SELECT symbol,
       count(*)                  AS trades,
       round(avg(price), 2)      AS avg_price,
       round(sum(price * qty), 0) AS notional
FROM demo.market.trades_stream
GROUP BY symbol
ORDER BY trades DESC
LIMIT 10;

-- 3. Most recent trades the stream has committed.
SELECT ts, symbol, price, qty
FROM demo.market.trades_stream
ORDER BY ts DESC
LIMIT 15;

-- 4. 10-second volume buckets — Spark tumbling-window aggregation over the stream.
SELECT window.start AS bucket,
       count(*)     AS trades,
       sum(qty)     AS shares
FROM demo.market.trades_stream
GROUP BY window(ts, '10 seconds')
ORDER BY bucket DESC
LIMIT 12;

-- 5. 1-minute OHLC candlesticks per symbol — reconstructed purely in Spark SQL.
SELECT window.start          AS minute,
       symbol,
       min_by(price, ts)     AS open,
       max(price)            AS high,
       min(price)            AS low,
       max_by(price, ts)     AS close,
       sum(qty)              AS volume
FROM demo.market.trades_stream
GROUP BY window(ts, '1 minute'), symbol
ORDER BY minute DESC, symbol
LIMIT 20;

-- 6. Flink commit cadence — one snapshot per ~10s checkpoint.
SELECT committed_at,
       summary['total-records'] AS total_rows,
       summary['added-records'] AS added_this_commit
FROM demo.market.trades_stream.snapshots
ORDER BY committed_at DESC
LIMIT 10;

-- 7. Temporal join: the LIVE Flink stream (last 2 minutes) joined to the STATIC
--    batch table from step 1, on the shared ticker. Needs step 1's trades_v3.
SELECT live.symbol,
       live.live_trades,
       round(live.live_avg, 2)                  AS live_avg_price,
       round(ref.batch_avg, 2)                  AS batch_avg_price,
       round(live.live_avg - ref.batch_avg, 2)  AS drift
FROM (
  SELECT symbol, count(*) AS live_trades, avg(price) AS live_avg
  FROM demo.market.trades_stream
  WHERE ts >= current_timestamp() - INTERVAL 2 MINUTES   -- temporal window on the stream
  GROUP BY symbol
) live
JOIN (
  SELECT symbol, avg(price) AS batch_avg
  FROM demo.market.trades_v3                              -- static table from step 1
  GROUP BY symbol
) ref
  ON live.symbol = ref.symbol
ORDER BY drift DESC;`,
    expect: "First click ▶ Start streaming on the right-hand tile (the stream is off until you start it). Then: run all, or select one statement and Run. Results change every run while Flink streams (≈500 rows / 10s checkpoint at the default rows-per-second). #5 reconstructs OHLC candlesticks from raw trades; #6 exposes Flink's checkpoint-driven commit cadence — a fresh committed_at every ~10s; #7 joins the live stream to the static trades_v3 batch table on the shared ticker (run step 1 first, or that one query errors). Spark-only deploy: the table won't exist — see the tile for how to add Flink.",
    inspect: {
      stream: { table: "trades_stream" },
      catalog: { table: "trades_stream" },
      snapshots: { table: "trades_stream" },
      lineage: { table: "trades_stream" },
      minio: { table: "trades_stream", hint: "Flink writes Parquet data files + manifests here, a new snapshot per checkpoint (~10s). Format-version 3 (row lineage); no Puffin, since it's append-only." },
    },
  },
];

export const stepById = (n: number): Step | undefined => STEPS.find((s) => s.id === n);

// Synthetic step for the free-form /console page: id 0, empty SQL, no inspect
// (so prefix resolution falls back to the warehouse root). Lets the real
// SqlPanel — syntax highlighting, copy, line numbers, selection-run, SSE — drive
// arbitrary SQL without a dedicated console component. /api/run accepts id 0 by
// substituting this step.
export const CONSOLE_STEP: Step = {
  id: 0,
  title: "SQL Console",
  why: "",
  sql: "",
  expect: "",
  inspect: {},
};
