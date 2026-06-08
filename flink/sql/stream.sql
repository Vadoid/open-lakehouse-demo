-- Flink streaming job: continuously append synthetic trades into an Iceberg
-- table that lives in the SAME Lakekeeper REST catalog + MinIO bucket Spark
-- uses. Submitted via `sql-client.sh -f` by deploy.sh's start_flink_stream.
--
-- The point of the demo: Flink writes, Spark reads, ONE catalog. While this
-- job runs, `SELECT count(*)` from beeline against demo.market.trades_stream
-- climbs every checkpoint (~10s).

-- Unbounded source -> keep the pipeline running forever (vs 'batch', which
-- would drain a finite input and stop).
SET 'execution.runtime-mode' = 'streaming';

-- ---------------------------------------------------------------------------
-- The shared catalog. Points at the very same Lakekeeper REST endpoint and
-- object store as spark/spark-defaults.conf — that shared target IS the interop
-- story. 'catalog-type'='rest' is the iceberg-flink-runtime-1.20 form for a
-- REST catalog (equivalent to catalog-impl=org.apache.iceberg.rest.RESTCatalog).
--
-- io-impl is ResolvingFileIO, mirroring Spark: it dispatches by URI scheme —
-- s3:// -> S3FileIO (MinIO, using the static s3.* creds below), gs:// -> GCSFileIO
-- (GCS). This is what lets Flink run against EITHER a MinIO or a GCS warehouse,
-- whichever the webapp registered. For gs:// the s3.* options are simply ignored.
--
-- GCS creds are NOT static (entered at runtime in the webapp, never reach this
-- container). Like Spark, Lakekeeper vends a per-table downscoped gcs.oauth2 token
-- in the REST load-table response; rest.access-delegation + the header tell the
-- Iceberg REST client to ask for it (the header form is the reliable cross-version
-- trigger). 'token'='dummy' mirrors Spark — harmless under allow-all authz.
-- ---------------------------------------------------------------------------
CREATE CATALOG demo WITH (
  'type'='iceberg',
  'catalog-type'='rest',
  'uri'='http://lakekeeper:8181/catalog',
  'warehouse'='demo',
  'token'='dummy',
  'io-impl'='org.apache.iceberg.io.ResolvingFileIO',
  'rest.access-delegation'='true',
  'header.X-Iceberg-Access-Delegation'='vended-credentials',
  's3.endpoint'='http://lake-minio:9000',
  's3.path-style-access'='true',
  's3.access-key-id'='minio-admin',
  's3.secret-access-key'='minio-admin-password'
);

-- The 'market' namespace is created by sql/demo.sql, but the default deploy
-- leaves the catalog EMPTY (demo.sql only runs with RUN_DEMO=1). So create the
-- database here too — the stream must not depend on the batch demo having run.
CREATE DATABASE IF NOT EXISTS demo.market;

-- ---------------------------------------------------------------------------
-- The Iceberg sink table — format-version 3, append-only.
--
-- V3 to match the rest of the demo (Spark writes V3 everywhere). Appends don't
-- need V3's deletion vectors; what V3 gives a pure append stream is row lineage
-- (_row_id / _last_updated_sequence_number auto-assigned per row), which Spark
-- can then read back. Equality-delete upserts on a V3 stream remain a stretch
-- goal. Spark reads V2 and V3 identically, so interop is unaffected either way.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.market.trades_stream (
  trade_id BIGINT,
  symbol   STRING,
  price    DOUBLE,
  qty      INT,
  ts       TIMESTAMP(6)
) WITH ('format-version'='3');

-- ---------------------------------------------------------------------------
-- datagen source: Flink's built-in synthetic row generator. No external system
-- — it fabricates rows at a fixed rate, which is exactly what we want for a
-- self-contained "watch the count climb" demo.
--
-- ts is computed with LOCALTIMESTAMP (a non-tz TIMESTAMP) rather than
-- CURRENT_TIMESTAMP. CURRENT_TIMESTAMP returns TIMESTAMP_LTZ, which Flink will
-- NOT implicitly cast into the sink's plain TIMESTAMP(6) column — the INSERT
-- fails type validation. CAST(LOCALTIMESTAMP AS TIMESTAMP(6)) matches the sink.
-- ---------------------------------------------------------------------------
-- symbol is NOT random text. datagen can't pick from an enum, so it generates a
-- bounded integer sym_idx (0..7) and the INSERT maps it to one of the SAME eight
-- tickers the batch table demo.market.trades_v3 uses (sql/demo.sql step 1). That
-- shared symbol domain is what lets step 19's temporal-join query join the live
-- stream against the static batch table on symbol.
CREATE TEMPORARY TABLE src (
  trade_id BIGINT,
  sym_idx  INT,
  price    DOUBLE,
  qty      INT,
  ts AS CAST(LOCALTIMESTAMP AS TIMESTAMP(6))
) WITH (
  'connector'='datagen',
  'rows-per-second'='50',           -- throughput knob: raise to stress, lower to slow the climb
  'fields.sym_idx.min'='0',         -- index into the 8-ticker array in the INSERT below
  'fields.sym_idx.max'='7',
  -- Bound the numeric fields. Without min/max, datagen fills each numeric across
  -- its ENTIRE type range — prices near 1e308, negative billion quantities — so
  -- aggregates overflow to null and the data looks nonsensical. Constrain to
  -- believable trade values.
  'fields.trade_id.min'='1',
  'fields.trade_id.max'='1000000',
  'fields.price.min'='10.0',
  'fields.price.max'='1000.0',
  'fields.qty.min'='1',
  'fields.qty.max'='1000'
);

-- The long-running streaming INSERT. sql-client submits this to the session
-- cluster and returns a job id (table.dml-sync defaults to false, so it does
-- NOT block) — the job then runs indefinitely on the taskmanager, committing a
-- snapshot every checkpoint. A CASE maps sym_idx 0..7 onto the eight tickers
-- (the same set sql/demo.sql writes into trades_v3) — Flink-portable, no array
-- indexing quirks.
INSERT INTO demo.market.trades_stream
  SELECT
    trade_id,
    CASE sym_idx
      WHEN 0 THEN 'AAPL' WHEN 1 THEN 'MSFT' WHEN 2 THEN 'NVDA' WHEN 3 THEN 'AMZN'
      WHEN 4 THEN 'GOOG' WHEN 5 THEN 'META' WHEN 6 THEN 'TSLA' ELSE 'AMD'
    END AS symbol,
    price, qty, ts
  FROM src;
