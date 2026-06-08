-- ============================================================================
-- Iceberg V3 on Lakekeeper + Spark Thrift Server  (run via beeline)
-- Domain: synthetic stock trades. All pure SQL, no PySpark.
--
--   docker exec spark-thrift /opt/spark/bin/beeline \
--     -u jdbc:hive2://localhost:10000 -f /opt/demo/demo.sql
--
-- HEAVY KNOB: change the upper bound of range(...) below. 1,000,000 is the
-- laptop-friendly default (matches the webapp's default demo config). Bump rows
-- to 50,000,000 with spark.driver.memory=8g, or 500,000,000 to stress a beefier
-- host.
--
-- The ts expression pins each row to one of 30 days: pmod(id, 30) picks the day
-- (so every day-partition is populated regardless of row count) and pmod(id,
-- 86400) spreads it within that day. Base 1699920000 = 2023-11-14 00:00:00 UTC
-- (midnight) so day boundaries land cleanly on exactly 30 partitions. The old
-- pmod(id, 2592000) only worked when rows >= 2.59M; below that it never wrapped
-- and you got far fewer than 30 days.
-- ============================================================================

CREATE NAMESPACE IF NOT EXISTS demo.market;

-- ----------------------------------------------------------------------------
-- 1. Heavy V3 table. format-version=3 + merge-on-read = deletion vectors.
-- ----------------------------------------------------------------------------
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
  'format-version'   = '3',
  'write.delete.mode' = 'merge-on-read',
  'write.update.mode' = 'merge-on-read',
  'write.merge.mode'  = 'merge-on-read',
  'write.target-file-size-bytes' = '134217728'
);

INSERT INTO demo.market.trades_v3
SELECT
  id AS trade_id,
  element_at(array('AAPL','MSFT','NVDA','AMZN','GOOG','META','TSLA','AMD'),
             CAST(pmod(id, 8) AS INT) + 1) AS symbol,
  timestamp_seconds(1699920000 + CAST(pmod(id, 30) AS BIGINT) * 86400 + CAST(pmod(id, 86400) AS BIGINT)) AS ts,
  round(50 + rand() * 500, 2) AS price,
  CAST(1 + rand() * 1000 AS INT) AS qty,
  CASE WHEN pmod(id, 2) = 0 THEN 'BUY' ELSE 'SELL' END AS side
FROM range(0, 1000000);

SELECT count(*) AS row_count FROM demo.market.trades_v3;

-- ----------------------------------------------------------------------------
-- 2. Mutate it. UPDATE/DELETE in MoR mode -> compact Puffin deletion vectors,
--    NOT full data-file rewrites.
-- ----------------------------------------------------------------------------
DELETE FROM demo.market.trades_v3 WHERE side = 'SELL' AND qty < 5;
UPDATE demo.market.trades_v3 SET price = price * 1.10 WHERE symbol = 'NVDA';

-- Proof: delete files are Puffin DVs (file_format='puffin', content=1).
SELECT file_format, content, count(*) AS files
FROM demo.market.trades_v3.delete_files
GROUP BY file_format, content;

SELECT committed_at, operation, summary['total-delete-files'] AS delete_files
FROM demo.market.trades_v3.snapshots
ORDER BY committed_at;

-- ----------------------------------------------------------------------------
-- 3. Row lineage (V3): _row_id + _last_updated_sequence_number track changes
--    per row -> incremental / CDC reads with no custom plumbing.
-- ----------------------------------------------------------------------------
SELECT trade_id, symbol, price, _row_id, _last_updated_sequence_number
FROM demo.market.trades_v3
WHERE symbol = 'NVDA'
LIMIT 10;

-- "Give me everything changed since sequence 1" — the CDC pattern.
SELECT count(*) AS rows_changed_since_seq_1
FROM demo.market.trades_v3
WHERE _last_updated_sequence_number > 1;

-- ----------------------------------------------------------------------------
-- 4. Default values (V3): the V3 spec supports per-column defaults read back
--    without rewriting old data files. Spark 3.5 + Iceberg 1.11 does NOT pass
--    the SQL DEFAULT clause through to Iceberg (UnsupportedOperationException
--    on ALTER ... ADD COLUMN ... DEFAULT); you need Spark 4.0 +
--    iceberg-spark-runtime-4.0 for that path. We add the column without a
--    default to keep the script moving — the V3 capability is real, it's just
--    not reachable from Spark 3.5 SQL.
-- ----------------------------------------------------------------------------
ALTER TABLE demo.market.trades_v3 ADD COLUMN exchange STRING;
SELECT exchange, count(*) FROM demo.market.trades_v3 GROUP BY exchange;

-- ----------------------------------------------------------------------------
-- 5. Time travel over the heavy table. (.history has made_current_at, not
--    committed_at — that column lives on .snapshots.)
-- ----------------------------------------------------------------------------
SELECT snapshot_id, made_current_at, is_current_ancestor
FROM demo.market.trades_v3.history
ORDER BY made_current_at;

-- ----------------------------------------------------------------------------
-- 6. V2 baseline for contrast: same mutations, but V2 writes positional delete
--    files (parquet), not deletion vectors.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS demo.market.trades_v2;
CREATE TABLE demo.market.trades_v2
USING iceberg
PARTITIONED BY (bucket(8, symbol))
TBLPROPERTIES ('format-version'='2','write.delete.mode'='merge-on-read')
AS SELECT * FROM demo.market.trades_v3 LIMIT 1000000;

DELETE FROM demo.market.trades_v2 WHERE side = 'SELL' AND qty < 5;

SELECT 'v2' AS fmt, file_format, content, count(*) FROM demo.market.trades_v2.delete_files GROUP BY file_format, content
UNION ALL
SELECT 'v3' AS fmt, file_format, content, count(*) FROM demo.market.trades_v3.delete_files GROUP BY file_format, content;

-- ----------------------------------------------------------------------------
-- 7. Maintenance: compaction (materializes DVs) + snapshot expiry.
-- ----------------------------------------------------------------------------
CALL demo.system.rewrite_data_files(table => 'market.trades_v3');
CALL demo.system.rewrite_manifests(table => 'market.trades_v3');
CALL demo.system.expire_snapshots(table => 'market.trades_v3', older_than => TIMESTAMP '2000-01-01 00:00:00', retain_last => 1);

SELECT count(*) AS final_row_count FROM demo.market.trades_v3;

-- ----------------------------------------------------------------------------
-- 8. MERGE INTO — CDC upsert primitive. Matched rows get a Puffin DV; new rows
--    land as fresh Parquet. One snapshot. (exchange column already added in
--    section 4.)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS demo.market.trades_v3_staging;
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

-- ----------------------------------------------------------------------------
-- 9. CoW vs MoR — same DELETE on a copy-on-write sibling rewrites data files
--    instead of writing Puffin DVs.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS demo.market.trades_v3_cow;
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

SELECT 'mor (v3)' AS table_kind, count(*) AS data_files, sum(file_size_in_bytes) AS bytes
FROM demo.market.trades_v3.files
UNION ALL
SELECT 'cow (v3)' AS table_kind, count(*) AS data_files, sum(file_size_in_bytes) AS bytes
FROM demo.market.trades_v3_cow.files;

-- ----------------------------------------------------------------------------
-- 10. Partition evolution. REPLACE days(ts) with hours(ts) — only new writes
--     use the finer grain; old data keeps its days(ts) layout. Both queryable
--     through one SELECT. (Iceberg permits one time transform per source.)
-- ----------------------------------------------------------------------------
ALTER TABLE demo.market.trades_v3 REPLACE PARTITION FIELD ts_day WITH hours(ts) AS ts_hour;

INSERT INTO demo.market.trades_v3
SELECT id + 2000000000 AS trade_id, 'AAPL' AS symbol,
       timestamp_seconds(1701000000 + CAST(id AS BIGINT)) AS ts,
       100.0 AS price, CAST(id AS INT) AS qty, 'BUY' AS side, 'NASDAQ' AS exchange
FROM range(0, 50000);

SELECT to_json(partition) AS partition, record_count
FROM demo.market.trades_v3.partitions
ORDER BY record_count DESC LIMIT 10;

-- ----------------------------------------------------------------------------
-- 11. Schema evolution beyond ADD. Field-ID tracking → RENAME/DROP/widen
--     touch zero data files.
-- ----------------------------------------------------------------------------
ALTER TABLE demo.market.trades_v3 RENAME COLUMN qty TO quantity;
ALTER TABLE demo.market.trades_v3 DROP COLUMN side;

DESCRIBE TABLE demo.market.trades_v3;

-- ----------------------------------------------------------------------------
-- 12. Branches & tags (write-audit-publish). Branches are named refs in
--     metadata. Tags are immutable pins. Zero data movement.
-- ----------------------------------------------------------------------------
ALTER TABLE demo.market.trades_v3 CREATE BRANCH staging;

INSERT INTO demo.market.trades_v3.branch_staging
SELECT (3000000000 + id) AS trade_id, 'STG' AS symbol,
       timestamp_seconds(1702000000) AS ts, 1.0 AS price,
       CAST(id AS INT) AS quantity, 'NASDAQ' AS exchange
FROM range(0, 1000);

ALTER TABLE demo.market.trades_v3 CREATE TAG `release-v1`;

SELECT name, type, snapshot_id FROM demo.market.trades_v3.refs ORDER BY name;

-- ----------------------------------------------------------------------------
-- 13. Rollback. Bad delete -> rollback_to_snapshot. Snapshot still in metadata
--     (re-pointable); current pointer just moves.
-- ----------------------------------------------------------------------------
ALTER TABLE demo.market.trades_v3 CREATE TAG `pre_bad_delete`;

SELECT count(*) AS before_bad_delete FROM demo.market.trades_v3;

DELETE FROM demo.market.trades_v3 WHERE symbol = 'AAPL';

CALL demo.system.set_current_snapshot(
  table => 'market.trades_v3',
  ref   => 'pre_bad_delete');

SELECT count(*) AS after_rollback FROM demo.market.trades_v3;

-- ----------------------------------------------------------------------------
-- 14. Bin-pack compaction + orphan reap + snapshot expiry. Bin-pack is the
--     laptop-friendly default; for production multi-dim co-location, replace
--     with `strategy => 'sort', sort_order => 'zorder(symbol, ts)'` on a
--     beefier driver (z-ordering all 5M rows OOMs a 6g JVM here).
-- ----------------------------------------------------------------------------
CALL demo.system.rewrite_data_files(
  table => 'market.trades_v3',
  options => map(
    'min-input-files', '5',
    'target-file-size-bytes', '67108864',
    'partial-progress.enabled', 'true'
  ));

-- remove_orphan_files is intentionally omitted here. The Iceberg action
-- walks the table prefix with Hadoop FS (no s3:// filesystem in this
-- S3FileIO-only image). To run it in production, add hadoop-aws + fs.s3a
-- creds to spark-defaults; the call shape is the same as expire_snapshots
-- below but with `older_than => TIMESTAMP '<past>'`.

CALL demo.system.expire_snapshots(
  table => 'market.trades_v3',
  older_than => TIMESTAMP '2099-01-01 00:00:00',
  retain_last => 1);

SELECT count(*) AS files, sum(file_size_in_bytes) AS total_bytes
FROM demo.market.trades_v3.files;

-- ----------------------------------------------------------------------------
-- 15. Sort orders + clustering. Iceberg has no `CLUSTERED BY` keyword. The
--     equivalent is three composable levers: hidden partitioning (section 1),
--     table-level sort order (this section), and Z-order rewrite (section 17).
-- ----------------------------------------------------------------------------
ALTER TABLE demo.market.trades_v3 WRITE ORDERED BY (symbol, ts);

INSERT INTO demo.market.trades_v3
SELECT
  (1000000 + id) AS trade_id,
  element_at(array('AAPL','MSFT','NVDA','AMZN','GOOG','META','TSLA','AMD'),
             CAST(pmod(id, 8) AS INT) + 1) AS symbol,
  timestamp_seconds(1699920000 + CAST(pmod(id, 30) AS BIGINT) * 86400 + CAST(pmod(id, 86400) AS BIGINT)) AS ts,
  round(50 + rand() * 500, 2) AS price,
  CAST(1 + rand() * 1000 AS INT) AS quantity,
  'NASDAQ' AS exchange
FROM range(0, 100000);

-- Tight, non-overlapping symbol bounds on the newest files.
-- readable_metrics is the decoded, column-name-keyed projection of the
-- per-file bounds map (raw lower_bounds/upper_bounds are map<int, binary>).
SELECT file_path,
       readable_metrics.symbol.lower_bound AS symbol_lo,
       readable_metrics.symbol.upper_bound AS symbol_hi,
       record_count
FROM demo.market.trades_v3.files
ORDER BY file_path DESC
LIMIT 10;

-- ----------------------------------------------------------------------------
-- 16. Perf + price payoff. Build a flat sibling (no partition, no sort) and
--     compare manifest-level pruning for the same predicate.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS demo.market.trades_v3_flat;
CREATE TABLE demo.market.trades_v3_flat
USING iceberg
TBLPROPERTIES ('format-version'='3')
AS SELECT trade_id, symbol, ts, price, quantity, exchange
   FROM demo.market.trades_v3 LIMIT 500000;

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
SELECT 'v3 flat (no partition, no sort)',
       count(*),
       sum(file_size_in_bytes),
       sum(CASE WHEN readable_metrics.symbol.lower_bound <= 'NVDA'
                 AND readable_metrics.symbol.upper_bound >= 'NVDA'
                THEN 1 ELSE 0 END),
       sum(CASE WHEN readable_metrics.symbol.lower_bound <= 'NVDA'
                 AND readable_metrics.symbol.upper_bound >= 'NVDA'
                THEN file_size_in_bytes ELSE 0 END)
FROM demo.market.trades_v3_flat.files;

-- ----------------------------------------------------------------------------
-- 17. V3 metadata-view enrichments. .changes is the V3 incremental-read
--     primitive (the CDC projection backed by row lineage). .refs lists
--     every branch/tag in one row. .history walks parent_id linkage.
--     compute_table_stats materializes Puffin theta sketches.
-- ----------------------------------------------------------------------------
-- .changes view documented but skipped: Spark 3.5 + Iceberg 1.11 changelog
-- scans cannot read through Puffin deletion vectors written in section 3+4.
-- Spark 4 + Iceberg 1.12 lifts the limit; the projection is _change_type /
-- _change_ordinal / _commit_snapshot_id + the table's user columns.

SELECT * FROM demo.market.trades_v3.refs ORDER BY name;

SELECT made_current_at, snapshot_id, parent_id, is_current_ancestor
FROM demo.market.trades_v3.history
ORDER BY made_current_at;

CALL demo.system.compute_table_stats(
  table   => 'market.trades_v3',
  columns => array('symbol'));

SELECT to_json(partition) AS partition, record_count
FROM demo.market.trades_v3.partitions
ORDER BY record_count DESC LIMIT 10;
