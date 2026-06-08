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
-- MinIO bucket as spark/spark-defaults.conf — that shared target IS the interop
-- story. 'catalog-type'='rest' is the iceberg-flink-runtime-1.20 form for a
-- REST catalog (equivalent to catalog-impl=org.apache.iceberg.rest.RESTCatalog).
--
-- S3FileIO with static MinIO creds: unlike Spark (which uses ResolvingFileIO +
-- Lakekeeper credential vending for its GCS path), this demo's Flink writes only
-- to MinIO, so static S3 creds are simplest and correct. 'token'='dummy' mirrors
-- Spark — harmless under Lakekeeper's allow-all authz.
-- ---------------------------------------------------------------------------
CREATE CATALOG demo WITH (
  'type'='iceberg',
  'catalog-type'='rest',
  'uri'='http://lakekeeper:8181/catalog',
  'warehouse'='demo',
  'token'='dummy',
  'io-impl'='org.apache.iceberg.aws.s3.S3FileIO',
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
-- The Iceberg sink table.
--
-- format-version 2, append-only: Flink's Iceberg sink lags Spark on V3 writes
-- (deletion vectors, row lineage). A V3 streaming table + equality-delete
-- upserts is a stretch goal; v1 stays on V2 appends to stay safe. Spark reads
-- V2 and V3 tables identically, so the interop check is unaffected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo.market.trades_stream (
  trade_id BIGINT,
  symbol   STRING,
  price    DOUBLE,
  qty      INT,
  ts       TIMESTAMP(6)
) WITH ('format-version'='2');

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
CREATE TEMPORARY TABLE src (
  trade_id BIGINT,
  symbol   STRING,
  price    DOUBLE,
  qty      INT,
  ts AS CAST(LOCALTIMESTAMP AS TIMESTAMP(6))
) WITH (
  'connector'='datagen',
  'rows-per-second'='50',     -- throughput knob: raise to stress, lower to slow the climb
  'fields.symbol.length'='4'  -- 4-char random tickers
);

-- The long-running streaming INSERT. sql-client submits this to the session
-- cluster and returns a job id (table.dml-sync defaults to false, so it does
-- NOT block) — the job then runs indefinitely on the taskmanager, committing a
-- snapshot every checkpoint.
INSERT INTO demo.market.trades_stream
  SELECT trade_id, symbol, price, qty, ts FROM src;
