"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { STEPS } from "@/lib/steps";
import ArchDiagram from "@/components/ArchDiagram";
import ResetButton from "@/components/ResetButton";
import CredsRow from "@/components/CredsRow";
import DynamicLink from "@/components/DynamicLink";
import Collapsible from "@/components/Collapsible";
import { loadConfig, applyConfig, DEFAULT_CONFIG, DemoConfig } from "@/lib/demoConfig";

const PHASES = [
  {
    title: "Phase 1: Table Initialization & Ingestion",
    steps: [1, 2],
  },
  {
    title: "Phase 2: Row-level Mutations & Lineage",
    steps: [3, 4, 5],
  },
  {
    title: "Phase 3: Schema Evolution & Positional Deletes",
    steps: [6, 7, 8],
  },
  {
    title: "Phase 4: Advanced DML, CoW vs MoR & Partition Evolution",
    steps: [9, 10, 11],
  },
  {
    title: "Phase 5: Schema Versioning, Branches, Tags & Time Travel",
    steps: [12, 13, 14],
  },
  {
    title: "Phase 6: Sort Orders, Compaction & Metadata Statistics",
    steps: [15, 16, 17, 18],
  },
  {
    title: "Phase 7: Multi-engine streaming interop (optional Flink)",
    steps: [19],
  },
];

// The wrap-up is a flagged step, not necessarily the last one (the optional
// Flink bonus step sits after it). Locate it by flag so "Skip to wrap-up" never
// points at the streaming step by accident.
const WRAPUP_ID = STEPS.find((s) => s.wrapup)?.id ?? STEPS.length;

export default function Home() {
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  const [isGcs, setIsGcs] = useState(false);
  const [bucket, setBucket] = useState("warehouse");
  // Flink ships on by default but can be opted out (Spark-only); only show its
  // UI link when the engine is actually deployed.
  const [flinkEnabled, setFlinkEnabled] = useState(false);

  useEffect(() => {
    setCfg(loadConfig());
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => { setIsGcs(j.type === "gcs"); if (j.bucket) setBucket(j.bucket); })
      .catch(() => {});
    fetch("/api/stream-count")
      .then((r) => r.json())
      .then((j) => setFlinkEnabled(!!j.enabled))
      .catch(() => {});
  }, []);

  const store = isGcs ? "GCS" : "MinIO";
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-12">
      {/* Hero Header Section */}
      <header className="text-center md:text-left space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-ice-500/30 bg-ice-500/10 text-ice-300 text-xs font-semibold select-none animate-pulse">
          <span>Apache Iceberg Spec V3</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-ice-300 via-ice-100 to-ice-400">
          Open Lakehouse Demo
        </h1>
        <p className="text-sm md:text-base text-gray-300 leading-relaxed max-w-3xl">
          A fully self-contained open lakehouse running locally on Apache Iceberg{" "}
          <strong className="text-ice-300">version 3</strong>. Built with {flinkEnabled ? "eight" : "six"} Docker containers wired together by Terraform.
          Run SQL queries through the Spark Thrift Server; watch table data and metadata land directly in {store}; manage pointers through Lakekeeper (the open REST catalog). Follow the live timeline and watch your {isGcs ? "object-store" : "S3"} files, schemas, and lineage evolve in real-time.
        </p>
      </header>

      {/* Architecture Panel */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">System Architecture</h2>
          <span className="text-[10px] text-gray-600 font-mono">Docker network: lakedemo</span>
        </div>
        
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-6 shadow-xl backdrop-blur-md relative overflow-hidden group hover:border-ice-500/20 transition-all duration-300">
          <div className="absolute top-0 right-0 w-48 h-48 bg-ice-500/5 rounded-full blur-3xl pointer-events-none" />
          <ArchDiagram />
        </div>
        
        <Collapsible title="Component Reference" hint="per-service detail">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs text-gray-400 leading-relaxed">
            <div className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-4 hover:border-ink-700 transition">
              <h3 className="text-ice-300 font-semibold mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ice-400" />
                {store} <span className="text-gray-600 font-normal">· object store</span>
              </h3>
              <p>
                {isGcs
                  ? "Google Cloud Storage bucket. Iceberg writes parquet data files, manifest lists, and puffin deletion vectors here. Lakekeeper vends scoped credentials per table. Easily swap this out for AWS S3, MinIO, or Azure Blob in production."
                  : "S3-compatible bucket storage. Iceberg writes parquet data files, manifest lists, and puffin deletion vectors here. Easily swap this out for standard AWS S3, GCS, or Azure Blob in production."}
              </p>
            </div>
            <div className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-4 hover:border-ink-700 transition">
              <h3 className="text-ice-300 font-semibold mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ice-400" />
                Lakekeeper <span className="text-gray-600 font-normal">· REST Catalog</span>
              </h3>
              <p>
                A high-performance Rust implementation of the open Iceberg REST catalog specification. Standardizes table namespace registration and snapshot resolution for Spark, Trino, Snowflake, and DuckDB.
              </p>
            </div>
            <div className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-4 hover:border-ink-700 transition">
              <h3 className="text-ice-300 font-semibold mb-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ice-400" />
                Spark Thrift <span className="text-gray-600 font-normal">· SQL Engine</span>
              </h3>
              <p>
                Uses Apache Spark 3.5.6 running `iceberg-spark-runtime`. Exposes HiveServer2 wire protocol on port 10000, allowing direct query execution without additional Python or Scala shims.
              </p>
            </div>
            {flinkEnabled && (
              <div className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-4 hover:border-ink-700 transition">
                <h3 className="text-ice-300 font-semibold mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Flink <span className="text-gray-600 font-normal">· streaming engine</span>
                </h3>
                <p>
                  Apache Flink 1.20 (jobmanager + taskmanager) running `iceberg-flink-runtime`.
                  A second engine sharing the same Lakekeeper catalog and {store} bucket as Spark:
                  a continuous datagen→Iceberg job appends to a format-version 3 table, committing
                  on every checkpoint (~10s) while Spark reads the same table live. Optional — off
                  on Spark-only deploys.
                </p>
              </div>
            )}
          </div>
        </Collapsible>
      </section>

      {/* Authentication & Credentials */}
      <section>
        <Collapsible title="Authentication & Credentials" hint={`${store} mode`}>
          <div className="space-y-4 text-xs text-gray-400 leading-relaxed">
            <p className="text-[11px] text-gray-500 max-w-3xl">
              Two independent planes. The <span className="text-gray-300">control plane</span> (catalog
              auth) is identical for every backend; the <span className="text-gray-300">data plane</span>{" "}
              (object-store auth) is where MinIO and GCS diverge. Everything here is{" "}
              <span className="text-amber-300/80">full-permission and demo-grade</span> — wire a real
              issuer and scoped credentials for production.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Control plane card */}
              <div className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-4 space-y-2.5">
                <h3 className="text-ice-300 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-ice-400" />
                  Control plane <span className="text-gray-600 font-normal">· catalog auth</span>
                </h3>
                <p>
                  Spark, Flink, and this webapp all reach Lakekeeper&apos;s REST catalog with a single
                  static bearer token <code className="text-ice-300">token=dummy</code> (sent as{" "}
                  <code className="text-ice-300">Authorization: Bearer dummy</code>). Same for MinIO and GCS.
                </p>
                <p>
                  Lakekeeper runs <code className="text-ice-300">AUTHZ_BACKEND=allow-all</code>, so{" "}
                  <span className="text-gray-300">authorization is open</span>. There is also no
                  IdP/OIDC wired up, so <span className="text-gray-300">authentication is open</span> too —
                  the <code className="text-ice-300">dummy</code> token is accepted but never validated.
                  (Two distinct things: authz ≠ authn.)
                </p>
                <p>
                  The management API (<code className="text-ice-300">/management/v1/bootstrap</code>,{" "}
                  <code className="text-ice-300">/warehouse</code>) takes no auth header at all; the catalog
                  API expects the <code className="text-ice-300">dummy</code> bearer (ignored under allow-all).
                </p>
                <p className="text-[11px] text-gray-500">
                  Production: wire an OIDC issuer + a real authz backend.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="px-1.5 py-0.5 rounded bg-ink-800/80 border border-ink-700 font-mono text-[10px] text-gray-400">
                    Authorization: Bearer dummy
                  </span>
                </div>
              </div>

              {/* Data plane card */}
              <div className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-4 space-y-3">
                <h3 className="text-ice-300 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-ice-400" />
                  Data plane <span className="text-gray-600 font-normal">· object-store auth</span>
                </h3>

                {/* MinIO sub-block */}
                <div className={isGcs ? "opacity-50" : ""}>
                  <h4 className={`font-semibold mb-1 flex items-center gap-1.5 ${isGcs ? "text-gray-400" : "text-ice-200"}`}>
                    MinIO <span className="text-gray-600 font-normal">· static S3 key{!isGcs && " · active"}</span>
                  </h4>
                  <p>
                    The access key (<code className={isGcs ? "text-gray-400" : "text-ice-300"}>minio-admin</code> /{" "}
                    <code className={isGcs ? "text-gray-400" : "text-ice-300"}>minio-admin-password</code>) is
                    configured directly on each engine — Spark&apos;s <code className={isGcs ? "text-gray-400" : "text-ice-300"}>s3.access-key-id</code> /{" "}
                    <code className={isGcs ? "text-gray-400" : "text-ice-300"}>s3.secret-access-key</code>, the Flink
                    catalog DDL, and the webapp via env. Lakekeeper registers the S3 warehouse with{" "}
                    <code className={isGcs ? "text-gray-400" : "text-ice-300"}>sts-enabled: false</code>, so it does
                    not vend STS credentials — each engine uses its own locally-configured static key. Same root
                    credential everywhere.
                  </p>
                </div>

                {/* GCS sub-block */}
                <div className={isGcs ? "" : "opacity-50"}>
                  <h4 className={`font-semibold mb-1 flex items-center gap-1.5 ${isGcs ? "text-ice-200" : "text-gray-400"}`}>
                    GCS <span className="text-gray-600 font-normal">· vended OAuth2{isGcs && " · active"}</span>
                  </h4>
                  <p>
                    No GCS key lives in any engine config. The user pastes a service-account JSON into the webapp
                    at runtime; that key is handed to Lakekeeper as the warehouse{" "}
                    <code className={isGcs ? "text-ice-300" : "text-gray-400"}>storage-credential</code>{" "}
                    (<code className={isGcs ? "text-ice-300" : "text-gray-400"}>credential-type: service-account-key</code>).
                    Engines send <code className={isGcs ? "text-ice-300" : "text-gray-400"}>X-Iceberg-Access-Delegation: vended-credentials</code>{" "}
                    with <code className={isGcs ? "text-ice-300" : "text-gray-400"}>rest.access-delegation=true</code>;
                    on load-table Lakekeeper mints a downscoped, short-lived OAuth2 token per table and returns it in
                    the REST response. <code className={isGcs ? "text-ice-300" : "text-gray-400"}>ResolvingFileIO</code>{" "}
                    routes <code className={isGcs ? "text-ice-300" : "text-gray-400"}>gs://</code> to GCSFileIO, which
                    uses that token. <span className="text-gray-300">Engines never see the SA key.</span>
                  </p>
                  <p className="mt-1.5 text-[11px] text-gray-500">
                    Asymmetry: the webapp server-side (file tree / lineage graph) uses the full SA key directly as a
                    plain GCS client, not a vended token — it talks to GCS outside the catalog.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="px-1.5 py-0.5 rounded bg-ink-800/80 border border-ink-700 font-mono text-[10px] text-gray-400">
                    X-Iceberg-Access-Delegation: vended-credentials
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Collapsible>
      </section>

      {/* Phases timeline section */}
      <section className="space-y-6">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Interactive Demo Pathway</h2>
          <p className="text-xs text-gray-400">
            The demo is structured as a chronological sequence of steps. Each page provides an interactive SQL console to view under-the-hood file mutations.
          </p>
        </div>

        <div className="space-y-8 relative pl-4 border-l border-ink-700/60">
          {PHASES.map((phase, pIdx) => (
            <div key={phase.title} className="space-y-3 relative">
              {/* Timeline marker */}
              <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border border-ice-500 bg-ink-950 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
              
              <h3 className="text-sm font-bold text-ice-200 tracking-tight">{phase.title}</h3>
              <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {phase.steps.map((sId) => {
                  const step = STEPS[sId - 1];
                  return (
                    <li key={sId}>
                      <Link
                        href={`/step/${sId}`}
                        className="group flex gap-2.5 rounded-lg border border-ink-700 bg-ink-900/30 hover:border-ice-500/50 hover:bg-ink-900/60 p-3 h-full transition duration-200"
                      >
                        <span className="flex-none w-5 h-5 rounded-full bg-ice-500/10 border border-ice-500/30 text-ice-300 text-[10px] font-mono flex items-center justify-center group-hover:bg-ice-500 group-hover:text-white transition-colors duration-200">
                          {sId}
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-gray-200 group-hover:text-ice-100 transition-colors leading-tight mb-1 truncate">
                            {applyConfig(step.title, cfg)}
                          </h4>
                          <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">
                            {sId === 18 ? "Live counters, matrix check, production review checklist" : applyConfig(step.why, cfg).replace(/##.*/g, "").trim().slice(0, 100)}...
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section>
        <Collapsible title="Iceberg Format Comparison" hint="V1 / V2 / V3 / Delta">
        <p className="text-xs text-gray-400 mb-4">See where Iceberg V3 stands compared to V1, V2, and Delta Lake spec.</p>

        <div className="overflow-x-auto rounded-xl border border-ink-700 shadow-lg bg-ink-900/20 backdrop-blur-md">
          <table className="w-full text-xs">
            <thead className="bg-ink-900/80 text-gray-400 border-b border-ink-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Feature</th>
                <th className="text-left px-4 py-3 font-semibold">Iceberg V1</th>
                <th className="text-left px-4 py-3 font-semibold">Iceberg V2</th>
                <th className="text-left px-4 py-3 font-semibold text-ice-300 bg-ice-500/5">Iceberg V3 (Specs)</th>
                <th className="text-left px-4 py-3 font-semibold">Delta Lake</th>
              </tr>
            </thead>
            <tbody className="text-gray-300 divide-y divide-ink-800/50">
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
                <tr key={i} className={i % 2 ? "bg-ink-900/30" : "bg-ink-900/10"}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-4 py-2.5 align-top ${
                        j === 0 ? "text-gray-200 font-semibold" : ""
                      } ${j === 3 ? "text-ice-300 font-medium bg-ice-500/5 border-x border-ice-500/10" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Collapsible>
      </section>

      {/* Helper Warning */}
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3 text-xs text-amber-200 leading-relaxed shadow-sm">
        <div className="flex-none pt-0.5 text-amber-500 text-[14px]">⚠️</div>
        <div>
          <strong className="font-semibold text-amber-400">Scale Warning:</strong> Step 2 runs bulk inserts utilizing your custom row size setting. Running 1M rows executes in ~15s on standard runtimes; executing 50M rows is heap-bound and requires an optimized memory host. {isGcs ? "Data persists in your GCS bucket" : "MinIO buckets persist on local disks"}; in-memory caches will clear on container restart.
        </div>
      </section>

      {/* Page Actions panel */}
      <div className="rounded-xl border border-ink-700/60 bg-ink-900/30 p-5 flex flex-wrap items-center justify-between gap-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/step/1"
            className="px-6 py-2.5 bg-ice-500 hover:bg-ice-600 text-white font-semibold rounded-lg shadow-lg hover:shadow-ice-500/25 transition duration-200 flex items-center gap-1.5"
          >
            <span>Start with Section 1</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
          <Link
            href="/graph"
            className="px-4 py-2.5 border border-ice-500/40 text-ice-300 hover:border-ice-500 hover:bg-ice-500/10 rounded-lg text-xs font-semibold transition"
          >
            Lineage Explorer
          </Link>
          <span className="mx-1 h-6 w-px bg-ink-700" aria-hidden="true" />
          <Link
            href={`/step/${WRAPUP_ID}`}
            className="px-3.5 py-2.5 rounded-lg border border-ink-700 text-xs text-gray-300 hover:border-ice-500/40 hover:text-ice-200 transition"
          >
            Skip to wrap-up
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DynamicLink
            port={8181}
            path="/ui/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg border border-ink-700 text-[11px] text-gray-400 hover:border-ice-500/40 hover:text-ice-200 transition"
          >
            Lakekeeper UI ↗
          </DynamicLink>
          {flinkEnabled && (
            <DynamicLink
              port={8081}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg border border-ink-700 text-[11px] text-gray-400 hover:border-emerald-500/40 hover:text-emerald-200 transition"
              title="Flink job dashboard — no login required"
            >
              Flink UI ↗
            </DynamicLink>
          )}
          {isGcs ? (
            <a
              href={`https://console.cloud.google.com/storage/browser/${bucket}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg border border-ink-700 text-[11px] text-gray-400 hover:border-ice-500/40 hover:text-ice-200 transition"
            >
              GCS Console ↗
            </a>
          ) : (
            <>
              <DynamicLink
                port={9001}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg border border-ink-700 text-[11px] text-gray-400 hover:border-ice-500/40 hover:text-ice-200 transition"
              >
                MinIO Console ↗
              </DynamicLink>
              <div className="text-[11px] text-gray-500 flex items-center gap-1.5 pl-1.5 border-l border-ink-700/60 h-6">
                <span className="text-gray-600">Login:</span>
                <CredsRow />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Reset Control */}
      <section className="rounded-xl border border-ink-700/60 bg-ink-900/30 p-5 space-y-3.5">
        <div>
          <h2 className="text-xs uppercase font-bold tracking-wider text-gray-500">Reset Demo State</h2>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl leading-normal">
            Drops table schemas in the Lakekeeper catalog and wipes data files inside the {store} warehouse bucket.
            Docker containers will stay active, allowing you to restart the demo from a fresh catalog.
          </p>
        </div>
        <div className="border-t border-ink-800/60 pt-3.5">
          <ResetButton />
        </div>
      </section>

      {/* Footer / Citation details */}
      <footer className="pt-8 border-t border-ink-700/60 text-xs text-gray-500 space-y-6">
        <Collapsible title="Citations & References" hint="specs & releases">
          <ul className="grid gap-3 sm:grid-cols-2">
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
            ].map((s) => (
              <li key={s.href} className="rounded-lg border border-ink-700/60 bg-ink-900/30 p-3 hover:border-ice-500/30 transition duration-200">
                <a href={s.href} target="_blank" rel="noopener noreferrer"
                   className="flex items-baseline justify-between gap-2 text-ice-400 hover:text-ice-300 transition-colors">
                  <span className="font-semibold truncate">{s.title}</span>
                  <span className="text-[9px] font-mono text-gray-600 flex-none">{s.tag}</span>
                </a>
                <p className="mt-1 text-gray-500 leading-snug text-[11px]">{s.note}</p>
              </li>
            ))}
          </ul>
        </Collapsible>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-600 pt-3 border-t border-ink-800/40">
          <a href="https://github.com/Vadoid/open-lakehouse-demo" target="_blank" rel="noopener noreferrer"
             className="hover:text-ice-400 transition-colors">github.com/Vadoid/open-lakehouse-demo</a>
          <span>Apache Iceberg V3 · Lakekeeper · Spark Thrift{flinkEnabled ? " · Flink" : ""} · {store}</span>
        </div>
      </footer>
    </div>
  );
}
