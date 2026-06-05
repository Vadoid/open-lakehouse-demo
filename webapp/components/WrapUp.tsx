"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CredsRow from "@/components/CredsRow";
import DynamicLink from "@/components/DynamicLink";

type Wrap = {
  tables: { ns: string; table: string; snapshots: number; formatVersion?: number; columns: number }[];
  totals: { puffinDvs?: number; positionalDeletes?: number; minioObjects?: number; minioBytes?: number };
  errors: string[];
};

function fmtBytes(n?: number) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const V3_RECAP: { step: number; label: string }[] = [
  { step: 1,  label: "format-version=3 + MoR writer modes" },
  { step: 3,  label: "Puffin deletion vectors on DELETE" },
  { step: 4,  label: "UPDATE = DV + replacement Parquet" },
  { step: 5,  label: "Row lineage + .changes incremental read" },
  { step: 6,  label: "ADD COLUMN with V3 default-value semantics" },
  { step: 9,  label: "MERGE INTO emits a DV for matched rows" },
  { step: 11, label: "Partition evolution without rewriting old data" },
  { step: 17, label: "Puffin theta sketches via compute_table_stats" },
];
const GENERAL_RECAP: { step: number; label: string }[] = [
  { step: 2,  label: "Bulk INSERT with hidden partitioning" },
  { step: 7,  label: "V2 contrast: positional Parquet deletes" },
  { step: 8,  label: "rewrite_data_files materializes DVs back into Parquet" },
  { step: 10, label: "CoW vs MoR side-by-side bytes" },
  { step: 12, label: "Schema rename / drop: zero data rewrites" },
  { step: 13, label: "Branches, tags, .refs (write-audit-publish)" },
  { step: 14, label: "Rollback + .history parent_id chain" },
  { step: 15, label: "Sort orders: WRITE ORDERED BY tightens bounds" },
  { step: 16, label: "Perf payoff: manifest pruning files-touched diff" },
  { step: 17, label: "Z-order compaction + expire_snapshots" },
];

const COVERAGE: { feature: string; status: string; step: number | null }[] = [
  { feature: "format-version=3",                      status: "✓",  step: 1 },
  { feature: "MoR Puffin deletion vectors",           status: "✓",  step: 3 },
  { feature: "UPDATE as DV + replacement Parquet",    status: "✓",  step: 4 },
  { feature: "Row lineage (_row_id, _last_updated_sequence_number)", status: "✓", step: 5 },
  { feature: ".changes incremental read",             status: "✓",  step: 5 },
  { feature: "Default values on ADD COLUMN",          status: "Spark-3.5 limited", step: 6 },
  { feature: "MERGE INTO",                            status: "✓",  step: 9 },
  { feature: "CoW vs MoR comparison",                 status: "✓",  step: 10 },
  { feature: "Partition evolution",                   status: "✓",  step: 11 },
  { feature: "Schema rename / drop / widen",          status: "✓",  step: 12 },
  { feature: "Branches + tags + .refs",               status: "✓",  step: 13 },
  { feature: "Rollback + .history",                   status: "✓",  step: 14 },
  { feature: "Sort orders / clustering",              status: "✓",  step: 15 },
  { feature: "Perf payoff (manifest pruning)",        status: "✓",  step: 16 },
  { feature: "Z-order + Puffin theta sketches",       status: "✓",  step: 17 },
  { feature: "VARIANT",                               status: "skipped, needs Spark 4.0",  step: null },
  { feature: "Nanosecond timestamps",                 status: "skipped, needs Spark 4.0",  step: null },
  { feature: "Geometry / Geography",                  status: "skipped, needs Spark 4.0",  step: null },
  { feature: "Multi-arg partition transforms",        status: "skipped, needs Spark 4.0",  step: null },
  { feature: "Column-level encryption",               status: "skipped, needs Iceberg 1.12", step: null },
];

export default function WrapUp() {
  const [w, setW] = useState<Wrap | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/wrapup", { cache: "no-store" });
      const j = await r.json();
      setW(j);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-complete step 18 on visit since it is a wrap-up page with no SQL console
    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId: 18, isEdited: false }),
    }).then(() => {
      window.dispatchEvent(new CustomEvent("ic:step-ran", { detail: { stepId: 18 } }));
    }).catch(() => {});
  }, [fetchData]);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ice-100 mb-1">
          <span className="text-gray-500 mr-2">Step 18.</span>Wrap-up: recap and production hardening
        </h1>
        <p className="text-sm text-gray-400">What this demo proved, the numbers it left behind in the warehouse, and what changes to take it to production.</p>
      </header>

      <section className="grid sm:grid-cols-2 gap-4">
        <div className="rounded border border-ink-700 bg-ink-900/40 p-4">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-2">V3-specific features</h2>
          <ul className="space-y-1.5 text-sm">
            {V3_RECAP.map((r) => (
              <li key={r.step}>
                <Link href={`/step/${r.step}`} className="text-ice-300 hover:text-ice-100">
                  Step {r.step}. {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-ink-700 bg-ink-900/40 p-4">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-2">Iceberg in general</h2>
          <ul className="space-y-1.5 text-sm">
            {GENERAL_RECAP.map((r) => (
              <li key={r.step}>
                <Link href={`/step/${r.step}`} className="text-ice-300 hover:text-ice-100">
                  Step {r.step}. {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-2">V3 coverage matrix</h2>
        <div className="overflow-x-auto rounded border border-ink-700">
          <table className="w-full text-xs">
            <thead className="bg-ink-900/80 text-gray-400">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Feature</th>
                <th className="text-left px-3 py-1.5 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 font-medium">Step</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {COVERAGE.map((row, i) => (
                <tr key={i} className={i % 2 ? "bg-ink-900/40" : ""}>
                  <td className="px-3 py-1 text-gray-200">{row.feature}</td>
                  <td className={`px-3 py-1 ${row.status === "✓" ? "text-emerald-300" : "text-amber-300"}`}>
                    {row.status}
                  </td>
                  <td className="px-3 py-1 font-mono">
                    {row.step != null ? (
                      <Link href={`/step/${row.step}`} className="text-ice-300 hover:text-ice-100">
                        step {row.step}
                      </Link>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wider text-gray-500">Live counters</h2>
          <button onClick={fetchData} disabled={loading}
                  className="text-[11px] text-ice-500 hover:text-ice-100 disabled:text-gray-600">
            {loading ? "refreshing…" : "refresh"}
          </button>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Counter label="Tables in catalog" value={w?.tables?.length ?? "—"} />
          <Counter label="Snapshots (total)" value={w?.tables?.reduce((a, t) => a + (t.snapshots || 0), 0) ?? "—"} />
          <Counter label="Puffin DVs" value={w?.totals?.puffinDvs ?? "—"} />
          <Counter label="Positional deletes" value={w?.totals?.positionalDeletes ?? "—"} />
          <Counter label="MinIO objects" value={w?.totals?.minioObjects ?? "—"} />
          <Counter label="MinIO bytes" value={fmtBytes(w?.totals?.minioBytes)} />
          <Counter label="Tables" value={w?.tables?.length ?? "—"} />
          <Counter label="Errors" value={w?.errors?.length ?? 0} />
        </div>
        {w?.tables && w.tables.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-xs font-mono">
              <thead className="bg-ink-800/60 text-gray-400">
                <tr>
                  <th className="px-3 py-1.5 text-left">table</th>
                  <th className="px-3 py-1.5 text-left">format-version</th>
                  <th className="px-3 py-1.5 text-left">columns</th>
                  <th className="px-3 py-1.5 text-left">snapshots</th>
                </tr>
              </thead>
              <tbody>
                {w.tables.map((t) => (
                  <tr key={`${t.ns}.${t.table}`} className="odd:bg-ink-900/40">
                    <td className="px-3 py-1 text-gray-300">{t.ns}.{t.table}</td>
                    <td className="px-3 py-1 text-emerald-300">{t.formatVersion ?? "?"}</td>
                    <td className="px-3 py-1 text-gray-300">{t.columns}</td>
                    <td className="px-3 py-1 text-gray-300">{t.snapshots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">Production hardening</h2>
        <div className="space-y-4 text-sm text-gray-300 leading-relaxed">
          <Block title="Catalog auth">
            Swap Lakekeeper&apos;s <code>AUTHZ_BACKEND=allow-all</code> for OIDC + OpenFGA so callers authenticate before mutating tables.
            See <a className="text-ice-400 hover:text-ice-200" target="_blank" rel="noreferrer" href="https://docs.lakekeeper.io/">docs.lakekeeper.io</a>.
          </Block>
          <Block title="Storage credentials">
            Drop the static MinIO creds baked into <code>spark/spark-defaults.conf</code>. Turn on Lakekeeper credential vending
            (<code>rest.access-delegation=vended-credentials</code>); the catalog hands engines short-lived per-table scoped creds.
          </Block>
          <Block title="Engines">
            The same SQL runs on Trino, DuckDB (with <code>iceberg</code> extension), StarRocks, Snowflake, Athena, all against the same REST catalog.
            <a className="text-ice-400 hover:text-ice-200 ml-1" target="_blank" rel="noreferrer" href="https://iceberg.apache.org/concepts/catalog/">Iceberg REST catalog spec</a>.
          </Block>
          <Block title="Postgres">
            Run the Lakekeeper backend on managed HA Postgres (RDS, Cloud SQL, Crunchy). The single demo container is not durable.
          </Block>
          <Block title="Object store">
            MinIO is API-compatible with S3. Iceberg <code>S3FileIO</code> works against S3, GCS (HMAC), Azure Blob (with <code>ABFSFileIO</code>), or any S3-API store.
          </Block>
          <Block title="Maintenance jobs">
            Move step 17&apos;s procedures behind a scheduler: Airflow, Argo, Kestra, or a Spark scheduled job. Cadence: hourly compact, daily expire, weekly orphan reap.
            See the <a className="text-ice-400 hover:text-ice-200" target="_blank" rel="noreferrer" href="https://iceberg.apache.org/docs/latest/maintenance/">Iceberg maintenance docs</a>.
          </Block>
          <Block title="Observability">
            Lakekeeper exposes Prometheus metrics; Spark Thrift has its own UI at <code>:4040</code>; MinIO exposes Prometheus + audit logs.
            Wire each into your existing collector (Grafana / Datadog / Honeycomb).
          </Block>
          <Block title="CI / schema review">
            Treat <code>sql/</code> as code. Gate <code>ALTER TABLE</code> and partition-spec changes on a PR review; run the demo SQL through a CI lane against a sandbox Lakekeeper to validate before merge.
          </Block>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">Where to go next</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LinkCard
            title="Apache Iceberg"
            items={[
              { href: "https://iceberg.apache.org/spec/",        label: "Table spec (V3)",          hint: "Canonical reference." },
              { href: "https://iceberg.apache.org/docs/latest/", label: "Engine docs",              hint: "Spark, Flink, Trino, Hive." },
              { href: "https://iceberg.apache.org/puffin-spec/", label: "Puffin file spec",         hint: "Deletion vectors, stats." },
              { href: "https://github.com/apache/iceberg",       label: "GitHub repo",              hint: "Issues, releases, source." },
            ]}
          />
          <LinkCard
            title="REST catalog"
            items={[
              { href: "https://docs.lakekeeper.io/",                                       label: "Lakekeeper docs",            hint: "Auth, OpenFGA, vended creds." },
              { href: "https://github.com/lakekeeper/lakekeeper",                          label: "Lakekeeper GitHub",          hint: "Rust implementation." },
              { href: "https://github.com/apache/iceberg/blob/main/open-api/rest-catalog-open-api.yaml", label: "REST catalog OpenAPI spec",  hint: "Same surface every engine speaks." },
            ]}
          />
          <LinkCard
            title="Engines on the same catalog"
            items={[
              { href: "https://trino.io/docs/current/connector/iceberg.html",         label: "Trino · Iceberg connector",     hint: "REST + S3FileIO." },
              { href: "https://duckdb.org/docs/extensions/iceberg",                   label: "DuckDB · iceberg extension",    hint: "Local interactive reads." },
              { href: "https://docs.starrocks.io/docs/data_source/catalog/iceberg_catalog/", label: "StarRocks · Iceberg catalog",   hint: "MPP analytics." },
              { href: "https://docs.snowflake.com/en/user-guide/tables-iceberg",      label: "Snowflake · Iceberg tables",    hint: "External REST catalog." },
            ]}
          />
          <LinkCard
            title="Background reading"
            items={[
              { href: "https://tabular.io/blog/",                                                                 label: "Tabular blog archive",     hint: "Deep dives on internals." },
              { href: "https://aws.amazon.com/prescriptive-guidance/latest/apache-iceberg-on-aws/", label: "AWS prescriptive guide",  hint: "Production patterns." },
              { href: "https://github.com/apache/iceberg/discussions",                                            label: "Iceberg discussions",      hint: "Roadmap, RFCs." },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">Keep exploring this demo</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/graph"
                className="px-5 py-2 bg-ice-500 hover:bg-ice-700 text-white font-semibold rounded transition">
            Full lineage graph →
          </Link>
          <Link href="/step/1"
                className="px-4 py-2 border border-ink-700 hover:border-ice-500 text-ice-200 rounded transition text-sm">
            Restart from step 1
          </Link>
          <Link href="/"
                className="px-4 py-2 border border-ink-700 hover:border-ice-500 text-gray-300 rounded transition text-sm">
            Back to welcome
          </Link>
        </div>
      </section>

      <footer className="mt-12 pt-6 border-t border-ink-700 text-xs text-gray-500">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-gray-400 font-semibold mb-1">Stack</div>
            <ul className="space-y-0.5">
              <li>Apache Iceberg 1.11.0 (V3)</li>
              <li>Apache Spark 3.5.6 (Thrift)</li>
              <li>Lakekeeper REST catalog</li>
              <li>MinIO · Postgres 15</li>
              <li>Next.js 15 · React 18</li>
            </ul>
          </div>
          <div>
            <div className="text-gray-400 font-semibold mb-1">Local endpoints</div>
            <ul className="space-y-0.5 font-mono">
              <li>
                <DynamicLink port={8181} path="/ui/" className="hover:text-ice-300" target="_blank" rel="noreferrer">
                  <DynamicText port={8181} path="/ui" />
                </DynamicLink> · Lakekeeper
              </li>
              <li>
                <DynamicLink port={9001} className="hover:text-ice-300" target="_blank" rel="noreferrer">
                  <DynamicText port={9001} />
                </DynamicLink> · MinIO <span className="ml-1 inline-block"><CredsRow /></span>
              </li>
              <li>
                <DynamicLink port={4040} className="hover:text-ice-300" target="_blank" rel="noreferrer">
                  <DynamicText port={4040} />
                </DynamicLink> · Spark UI
              </li>
              <li><DynamicText port={10000} /> · Thrift JDBC</li>
            </ul>
          </div>
          <div>
            <div className="text-gray-400 font-semibold mb-1">Reset</div>
            <p>
              Run <code className="text-gray-300">terraform destroy -auto-approve</code> then{" "}
              <code className="text-gray-300">./deploy.sh</code> for a clean stack. Or hit{" "}
              <button onClick={async () => { await fetch("/api/reset", { method: "POST" }); fetchData(); }}
                      className="text-ice-400 hover:text-ice-200 underline">/api/reset</button>{" "}
              to wipe tables only.
            </p>
            <p className="mt-2">
              SQL source · <code className="text-gray-300">sql/demo.sql</code> in the repo.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-gray-600">
          <span>Iceberg V3 lakehouse demo. SQL-only, single Docker host, no PySpark.</span>
          <span>MIT · 2026</span>
        </div>
      </footer>
    </div>
  );
}

function LinkCard({ title, items }: { title: string; items: { href: string; label: string; hint?: string }[] }) {
  return (
    <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {items.map((it) => (
          <li key={it.href} className="leading-snug">
            <a href={it.href} target="_blank" rel="noreferrer"
               className="text-ice-300 hover:text-ice-100 hover:underline">{it.label}</a>
            {it.hint && <span className="text-gray-500"> · {it.hint}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-ice-200 font-mono">{value}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-ink-700 bg-ink-900/40 p-3">
      <div className="text-ice-200 font-semibold mb-1">{title}</div>
      <div className="text-gray-300">{children}</div>
    </div>
  );
}

function DynamicText({ port, path = "" }: { port: number, path?: string }) {
  const [host, setHost] = useState("localhost");
  useEffect(() => {
    if (typeof window !== "undefined") setHost(window.location.hostname);
  }, []);
  return <>{host}:{port}{path}</>;
}
