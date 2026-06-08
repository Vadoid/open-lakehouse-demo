"use client";
import { useEffect, useState } from "react";

// `flink` is optional: the key is present only when the Flink engine is
// deployed (FLINK_ENABLED). Absent → pill not rendered.
type Probe = { postgres: boolean; minio: boolean; lakekeeper: boolean; thrift: boolean; flink?: boolean };

const LABELS: { key: keyof Probe; label: string; okMsg: string; downMsg: string; optional?: boolean }[] = [
  {
    key: "postgres",
    label: "Postgres",
    okMsg: "Postgres reachable. Lakekeeper metadata store healthy.",
    downMsg: "Postgres not reachable. Lakekeeper can't read or write catalog metadata.",
  },
  {
    key: "minio",
    label: "MinIO",
    okMsg: "MinIO reachable. Warehouse bucket online; data + Puffin DVs can be written.",
    downMsg: "MinIO not reachable. Table data and metadata I/O will fail.",
  },
  {
    key: "lakekeeper",
    label: "Lakekeeper",
    okMsg: "Lakekeeper REST catalog healthy. Iceberg snapshots and table metadata flowing.",
    downMsg: "Lakekeeper not responding. Catalog operations and S3 path resolution will fail.",
  },
  {
    key: "thrift",
    label: "Spark Thrift",
    okMsg: "Spark Thrift Server accepting JDBC. SQL ready to run.",
    downMsg: "Spark Thrift Server not accepting JDBC. First start can take 1 to 2 min while jars resolve.",
  },
  {
    key: "flink",
    label: "Flink",
    optional: true,
    okMsg: "Flink jobmanager up. Streaming engine writing to demo.market.trades_stream.",
    downMsg: "Flink jobmanager not reachable. The streaming job may be starting or down.",
  },
];

export default function HealthPills() {
  const [p, setP] = useState<Probe | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = (await r.json()) as Probe;
        if (alive) setP(j);
      } catch {
        if (alive) setP({ postgres: false, minio: false, lakekeeper: false, thrift: false });
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="flex gap-3 text-xs">
      {LABELS.map(({ key, label, okMsg, downMsg, optional }) => {
        // Optional services (Flink) only appear once the health probe confirms
        // the key exists — i.e. the engine is deployed. Hidden otherwise.
        if (optional && (p === null || !(key in p))) return null;
        const ok = p?.[key] === true;
        const unknown = p === null;
        const tip = unknown ? `${label}: probing...` : ok ? `OK. ${okMsg}` : `Down. ${downMsg}`;
        return (
          <div
            key={key}
            title={tip}
            aria-label={tip}
            className="flex items-center gap-1.5 text-gray-300 cursor-default"
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                unknown ? "bg-gray-600" : ok ? "bg-emerald-500 shadow-emerald-500/50 shadow" : "bg-red-500"
              }`}
            />
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
