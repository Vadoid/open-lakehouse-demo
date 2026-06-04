import Link from "next/link";
import { STEPS } from "@/lib/steps";
import ArchDiagram from "@/components/ArchDiagram";
import ResetButton from "@/components/ResetButton";
import CredsRow from "@/components/CredsRow";
import DynamicLink from "@/components/DynamicLink";

export default function Home() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-ice-100 mb-3">
          An open lakehouse demo
        </h1>
        <p className="text-gray-300 leading-relaxed">
          Self-contained open lakehouse on Apache Iceberg{" "}
          <strong>version 3</strong>. Six Docker containers, one
          Terraform apply to rule them all. SQL goes through the Spark Thrift Server; data and
          metadata land in MinIO; Lakekeeper is the REST catalog. This page
          drives the same SQL{" "}
          <code className="text-ice-300">sql/demo.sql</code> would, and shows
          what changes in MinIO, Lakekeeper, and the Iceberg snapshot log as
          you go.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">Architecture</h2>
        <div className="rounded border border-ink-700 bg-ink-900/60 p-4">
          <ArchDiagram />
        </div>
        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
          Six containers on one Docker network (<code>lakedemo</code>). Each layer
          is the smallest open-source piece that fills its role.
        </p>
        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-gray-500 hover:text-ice-300 select-none list-none flex items-center gap-2">
            <span className="inline-block transition-transform group-open:rotate-90">▸</span>
            Why this architecture
          </summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm text-gray-300 leading-relaxed">
          <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
            <dt className="text-ice-200 font-semibold mb-1">MinIO <span className="text-gray-500 font-normal">·object store</span></dt>
            <dd>
              S3-API-compatible, runs locally with no AWS account. Iceberg writes
              every Parquet, Avro manifest, and Puffin sidecar to a single bucket
              (<code>warehouse</code>). Swap for S3 / GCS / Azure Blob in production
              by changing one endpoint; Iceberg&apos;s <code>S3FileIO</code> is
              storage-agnostic.
            </dd>
          </div>
          <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
            <dt className="text-ice-200 font-semibold mb-1">Lakekeeper <span className="text-gray-500 font-normal">·Iceberg REST catalog</span></dt>
            <dd>
              Rust implementation of the <a href="https://iceberg.apache.org/concepts/catalog/" target="_blank" rel="noopener noreferrer" className="text-ice-300 hover:text-ice-200">Iceberg REST catalog spec</a>:
              the open, vendor-neutral way to register tables and resolve their
              current <code>metadata.json</code>. Any engine that speaks the spec
              (Spark, Trino, DuckDB, Snowflake, StarRocks) can read or write the
              same tables. We avoid Hive Metastore (legacy Thrift, JVM-heavy) and
              skip vendor catalogs (Unity, Glue, Polaris) so nothing is locked in.
            </dd>
          </div>
          <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
            <dt className="text-ice-200 font-semibold mb-1">Postgres <span className="text-gray-500 font-normal">·catalog backend</span></dt>
            <dd>
              Lakekeeper stores namespace, table, and snapshot pointers in
              Postgres (≥ 15). Boring, durable, transactional. Holds *only* the
              catalog index, not the data. In production this is the one piece
              that needs HA (RDS, Cloud SQL, Crunchy).
            </dd>
          </div>
          <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
            <dt className="text-ice-200 font-semibold mb-1">Spark Thrift Server <span className="text-gray-500 font-normal">·SQL engine</span></dt>
            <dd>
              <code>apache/spark 3.5.6</code> with <code>iceberg-spark-runtime 1.11.0</code>
              + <code>iceberg-aws-bundle</code>. The Thrift Server exposes the
              HiveServer2 wire protocol on <code>:10000</code>, so any JDBC client
              (beeline, DBeaver, this webapp) drives it without a Python or Scala
              shim. Spark gets us a mature Iceberg writer; the Thrift wrapper makes
              it SQL-first.
            </dd>
          </div>
          <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
            <dt className="text-ice-200 font-semibold mb-1">demo-webapp <span className="text-gray-500 font-normal">·this page</span></dt>
            <dd>
              Next.js 15 + React 18. Server routes are the only thing that talks
              to Spark (JDBC), Lakekeeper (REST), and MinIO (S3). The browser stays
              a thin renderer. Long INSERTs stream progress over Server-Sent
              Events so the request does not time out.
            </dd>
          </div>
          <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
            <dt className="text-ice-200 font-semibold mb-1">Docker + Terraform <span className="text-gray-500 font-normal">·wiring</span></dt>
            <dd>
              Terraform declares the containers, network, and one bootstrap step
              (MinIO bucket + Lakekeeper warehouse registration). One
              <code> apply</code> brings up the stack; one <code>destroy</code>
              tears it down. No Compose, no Helm, no hand-rolled bash for the
              infra path.
            </dd>
          </div>
        </dl>
        </details>
      </section>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">What is demonstrated</h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          The demo consists of multiple steps (and has to be executed in order). Each step is a page. The right pane shows MinIO files,
          the Lakekeeper catalog, the snapshot timeline, and the Iceberg
          lineage graph for the focus table.
        </p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm text-gray-300 leading-relaxed">
          {[
            { title: "V3 trades table", body: (<><code>format-version=3</code> + MoR writer modes. Hidden partitioning by day + symbol bucket.</>) },
            { title: "Bulk INSERT", body: (<>Synthetic trades streamed in over SSE at the row count you set above. Watch <code>data/ts_day=…/</code> populate.</>) },
            { title: "DELETE → deletion vector", body: (<>MoR <code>DELETE</code> writes a Puffin sidecar; original Parquet untouched. <code>.delete_files</code> shows <code>file_format='puffin'</code>.</>) },
            { title: "UPDATE → DV + replacement Parquet", body: (<>UPDATE = DELETE old + INSERT new. NVDA spans many partitions: one DV per file plus a small replacement Parquet for the bumped prices.</>) },
            { title: "Row lineage + .changes", body: (<>Stable <code>_row_id</code>, last-touched sequence number, plus the <code>.changes</code> CDC view. No Debezium.</>) },
            { title: "ADD COLUMN", body: (<>Schema change touches no data files; old rows read back as NULL.</>) },
            { title: "V2 contrast", body: (<>Same <code>DELETE</code> on a V2 sibling writes parquet positional deletes, shown side-by-side with the V3 Puffin.</>) },
            { title: "Compaction + expiry", body: (<><code>rewrite_data_files</code> materializes DVs into clean Parquet; <code>expire_snapshots</code> collapses history.</>) },
            { title: "MERGE INTO", body: (<>The CDC upsert primitive. Matched rows get a DV; new rows land as fresh Parquet.</>) },
            { title: "CoW vs MoR", body: (<>Same DELETE on a CoW (copy-on-write) sibling vs the MoR (merge-on-read) original. Bytes-written and file-count diff in one query.</>) },
            { title: "Partition evolution", body: (<><code>REPLACE PARTITION FIELD</code> rewires future writes; old data stays under the previous spec.</>) },
            { title: "Schema evolution", body: (<>Field-ID tracking. <code>RENAME</code>, <code>DROP</code>, type-widen touch zero data files.</>) },
            { title: "Branches, tags, .refs", body: (<>Write-audit-publish via <code>branch_staging</code>; tag a known-good snapshot; <code>.refs</code> projects them all.</>) },
            { title: "Rollback + .history", body: (<>Tag a snapshot, do a bad delete, <code>set_current_snapshot</code> to recover. <code>.history</code> shows the parent-id chain.</>) },
            { title: "Sort orders + clustering", body: (<>What Iceberg calls &quot;clustering&quot;: hidden partition + <code>WRITE ORDERED BY</code> + Z-order on rewrite. Per-file <code>lower_bounds</code> tighten visibly.</>) },
            { title: "Perf + price payoff", body: (<>Partitioned+sorted vs flat sibling. Same predicate, manifest-level pruning, files-touched and bytes-touched diff.</>) },
            { title: "Maintenance jobs", body: (<>Bin-pack compaction, <code>compute_table_stats</code> Puffin sketches, <code>expire_snapshots</code>. Z-order syntax shown in comments.</>) },
            { title: "Wrap-up", body: (<>Live counters, V3 coverage matrix, production-hardening checklist (catalog auth, vended creds, scheduled maintenance, observability).</>) },
          ].map((item, i) => (
            <li key={item.title}>
              <Link
                href={`/step/${i + 1}`}
                className="flex gap-3 rounded border border-ink-700 bg-ink-900/40 hover:border-ice-500/60 hover:bg-ink-900/70 p-3 h-full transition"
              >
                <span className="flex-none w-6 h-6 rounded-full bg-ice-500/15 border border-ice-500/40 text-ice-300 text-xs font-mono flex items-center justify-center">
                  {i + 1}
                </span>
                <div>
                  <div className="text-ice-200 font-semibold mb-0.5">{item.title}</div>
                  <div className="text-gray-300">{item.body}</div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">How V3 compares</h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Where Iceberg V3 sits next to V2, V1, and Delta Lake (current
          protocol). Sources cited in the footer.
        </p>
        <div className="overflow-x-auto rounded border border-ink-700">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/80 text-gray-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Feature</th>
                <th className="text-left px-3 py-2 font-medium">Iceberg V1</th>
                <th className="text-left px-3 py-2 font-medium">Iceberg V2</th>
                <th className="text-left px-3 py-2 font-medium text-ice-200">Iceberg V3</th>
                <th className="text-left px-3 py-2 font-medium">Delta Lake</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {[
                ["Row-level DELETE/UPDATE", "rewrite data files", "positional deletes (Parquet)", "deletion vectors (Puffin)", "deletion vectors (Roaring)"],
                ["Row lineage (_row_id, seq #)", "—", "—", "yes", "—"],
                ["Default column values", "—", "—", "yes", "yes (3.x)"],
                ["VARIANT semi-structured type", "—", "—", "yes (spec)", "yes"],
                ["Nanosecond timestamps", "—", "—", "yes (spec)", "µs only"],
                ["Hidden partitioning", "yes", "yes", "yes", "generated columns"],
                ["Schema add/drop/rename/reorder", "yes", "yes", "yes", "add/drop/rename"],
                ["Time travel", "yes", "yes", "yes", "yes"],
                ["Open REST catalog spec", "—", "yes", "yes", "Unity OSS / Hive"],
                ["Engine breadth", "broad", "broad", "broad", "Spark-first, growing"],
              ].map((row, i) => (
                <tr key={i} className={i % 2 ? "bg-ink-900/40" : ""}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2 align-top ${
                        j === 0 ? "text-gray-200 font-medium" : ""
                      } ${j === 3 ? "text-ice-200" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">How each page works</h2>
        <p className="text-gray-300 leading-relaxed">
          SQL on the left with a Run button. Step 2&apos;s bulk INSERT streams progress
          over SSE so the browser does not time out; its size is driven by the
          Demo size panel that appears above step 2&apos;s SQL. The middle pane
          explains what is happening. The right pane shows the MinIO file tree
          with added, changed, and removed files colored per section, plus the
          Lakekeeper catalog and the snapshot timeline.
        </p>
      </section>

      <section className="mb-8 rounded border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
        Step 2 inserts the row count picked in its Demo size panel. 1M finishes
        in ~15s on a laptop; 50M needs a beefier host (heap-bound). The warehouse
        on MinIO survives container restarts; the in-memory cache does not.
      </section>

      <div className="rounded border border-ink-700 bg-ink-900/40 p-4 flex flex-wrap items-center gap-2">
        <Link
          href="/step/1"
          className="px-5 py-2 bg-ice-500 hover:bg-ice-700 text-white font-semibold rounded transition"
        >
          Start with section 1 →
        </Link>
        <Link
          href="/graph"
          className="px-4 py-2 border border-ice-500 text-ice-700 dark:text-ice-200 hover:bg-ice-500/15 rounded text-sm font-semibold transition"
        >
          Lineage explorer
        </Link>
        <span className="mx-1 h-6 w-px bg-ink-700" aria-hidden="true" />
        <Link
          href={`/step/${STEPS.length}`}
          className="px-3 py-2 rounded border border-ink-700 text-sm text-gray-700 dark:text-gray-300 hover:border-ice-500 hover:text-ice-500 transition"
        >
          Skip to wrap-up
        </Link>
        <DynamicLink
          port={8181}
          path="/ui/"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded border border-ink-700 text-sm text-gray-700 dark:text-gray-300 hover:border-ice-500 hover:text-ice-500 transition"
        >
          Lakekeeper UI ↗
        </DynamicLink>
        <DynamicLink
          port={9001}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded border border-ink-700 text-sm text-gray-700 dark:text-gray-300 hover:border-ice-500 hover:text-ice-500 transition"
        >
          MinIO console ↗
        </DynamicLink>
        <span className="text-[11px] text-gray-500 flex items-center gap-1">
          <span className="text-gray-600">MinIO login:</span>
          <CredsRow />
        </span>
      </div>

      <section className="mt-8 rounded border border-ink-700 bg-ink-900/40 p-4">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-2">Reset</h2>
        <p className="text-xs text-gray-700 dark:text-gray-400 leading-relaxed mb-3 max-w-xl">
          Drops every table in the Lakekeeper catalog and purges the MinIO
          warehouse bucket. The containers stay up; the demo starts clean.
        </p>
        <ResetButton />
      </section>

      <footer className="mt-12 pt-6 border-t border-ink-700/60 text-xs text-gray-500">
        <div className="mb-3 uppercase tracking-wider text-gray-500">Sources</div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            {
              href: "https://iceberg.apache.org/spec/",
              title: "Apache Iceberg table spec",
              tag: "V1 / V2 / V3",
              note: "Format-version flags, deletion vectors, row lineage, default values, VARIANT, nanosecond timestamps.",
            },
            {
              href: "https://github.com/apache/iceberg/blob/main/format/spec.md",
              title: "apache/iceberg",
              tag: "format/spec.md",
              note: "V3 changes including the Puffin deletion-vector blob type.",
            },
            {
              href: "https://github.com/delta-io/delta/blob/master/PROTOCOL.md",
              title: "Delta Lake protocol",
              tag: "PROTOCOL.md",
              note: "Deletion vectors (RoaringBitmap), default values, VARIANT, schema-evolution scope.",
            },
            {
              href: "https://github.com/apache/iceberg/releases",
              title: "apache/iceberg releases",
              tag: "1.9 → 1.11",
              note: "Engine support timeline used in the comparison.",
            },
            {
              href: "/step/15",
              title: "What Iceberg calls clustering",
              tag: "step 15",
              note: "Hidden partitioning + WRITE ORDERED BY + Z-order rewrite, the three composable levers.",
            },
          ].map((s) => (
            <li key={s.href} className="rounded border border-ink-700 bg-ink-900/40 p-3 hover:border-ice-500/60 transition">
              <a href={s.href} target="_blank" rel="noopener noreferrer"
                 className="flex items-baseline gap-2 text-ice-400 hover:text-ice-200">
                <span className="font-semibold truncate">{s.title}</span>
                <span className="text-[10px] font-mono text-gray-500 flex-none">{s.tag}</span>
              </a>
              <p className="mt-1 text-gray-500 leading-snug">{s.note}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500">
          <a href="https://github.com/Vadoid/open-lakehouse-demo" target="_blank" rel="noopener noreferrer"
             className="hover:text-ice-300">github.com/Vadoid/open-lakehouse-demo</a>
          <span className="text-gray-700">·</span>
          <span>Apache Iceberg V3 · Lakekeeper · Spark Thrift · MinIO</span>
        </div>
      </footer>
    </div>
  );
}
