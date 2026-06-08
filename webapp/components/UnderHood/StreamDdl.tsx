"use client";

import { highlight } from "@/lib/sqlHighlight";

// Read-only view of the Flink SQL behind step 19. The streaming table is created
// and written by the Flink job itself (the jobmanager supervisor runs
// flink/sql/stream.sql) — this panel just makes that DDL visible so you can see
// the V3 table shape and the datagen → Iceberg INSERT the "Start streaming"
// button kicks off. It is not runnable here (it's Flink SQL, not Spark).
const DDL = `-- Flink writes this table; Spark (left) reads it — one Lakekeeper catalog.
CREATE CATALOG demo WITH (
  'type'='iceberg', 'catalog-type'='rest',
  'uri'='http://lakekeeper:8181/catalog', 'warehouse'='demo',
  'io-impl'='org.apache.iceberg.io.ResolvingFileIO',      -- s3:// or gs://
  'rest.access-delegation'='true',
  'header.X-Iceberg-Access-Delegation'='vended-credentials'
);

-- format-version 3, append-only. Flink assigns V3 row lineage (_row_id,
-- _last_updated_sequence_number) per row; Spark reads it back.
CREATE TABLE IF NOT EXISTS demo.market.trades_stream (
  trade_id BIGINT, symbol STRING, price DOUBLE, qty INT, ts TIMESTAMP(6)
) WITH ('format-version' = '3');

-- A built-in datagen source fabricates rows at a fixed rate (bounded so the
-- numbers look like real trades). sym_idx is a 0..7 int the INSERT maps to one of
-- the SAME eight tickers the batch table trades_v3 uses — that shared symbol set
-- is what lets query #7 join the live stream to the static table.
CREATE TEMPORARY TABLE src (
  trade_id BIGINT, sym_idx INT, price DOUBLE, qty INT,
  ts AS CAST(LOCALTIMESTAMP AS TIMESTAMP(6))      -- non-tz, matches the sink column
) WITH (
  'connector' = 'datagen', 'rows-per-second' = '50',
  'fields.sym_idx.min' = '0', 'fields.sym_idx.max' = '7',
  'fields.price.min' = '10.0', 'fields.price.max' = '1000.0',
  'fields.qty.min'   = '1',    'fields.qty.max'   = '1000'
);

-- The continuous INSERT maps sym_idx -> ticker and appends. The Iceberg sink
-- commits one snapshot per checkpoint (~10s) — that is when the count moves.
INSERT INTO demo.market.trades_stream
  SELECT trade_id,
         CASE sym_idx WHEN 0 THEN 'AAPL' WHEN 1 THEN 'MSFT' WHEN 2 THEN 'NVDA'
                      WHEN 3 THEN 'AMZN' WHEN 4 THEN 'GOOG' WHEN 5 THEN 'META'
                      WHEN 6 THEN 'TSLA' ELSE 'AMD' END AS symbol,
         price, qty, ts
  FROM src;`;

export default function StreamDdl() {
  return (
    <details className="rounded-xl border border-ink-700 bg-ink-800/60 shadow-sm group">
      <summary className="cursor-pointer select-none list-none px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Streaming table &amp; job · Flink SQL
        </span>
        <span className="text-[10px] text-gray-600 group-open:hidden">show</span>
        <span className="text-[10px] text-gray-600 hidden group-open:inline">hide</span>
      </summary>
      <div className="px-4 pb-3">
        <pre
          className="rounded-lg bg-ink-900/70 border border-ink-700 p-3 text-[11px] leading-relaxed text-gray-300 overflow-x-auto font-mono"
          dangerouslySetInnerHTML={{ __html: highlight(DDL) }}
        />
        <p className="mt-2 text-[11px] text-gray-500 leading-snug">
          Read-only. The Flink jobmanager runs this itself when you press{" "}
          <strong>Start streaming</strong> above; it's Flink SQL, so it won't run in
          the Spark console. The queries on the left read the table it writes.
        </p>
      </div>
    </details>
  );
}
