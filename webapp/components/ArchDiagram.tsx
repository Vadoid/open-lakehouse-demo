"use client";
// Inline SVG architecture diagram for the demo. No external deps.
// Six boxes (webapp, Spark Thrift, Lakekeeper, object store, Postgres)
// connected with labelled edges. Colors come from CSS vars (see
// app/globals.css) so the diagram flips with the theme. The object-store box
// and the data-plane labels swap between MinIO/S3 and GCS depending on the
// active storage config (fetched from /api/storage-setup).

import { useEffect, useState } from "react";

export default function ArchDiagram() {
  const [isGcs, setIsGcs] = useState(false);
  const [bucket, setBucket] = useState("warehouse");

  useEffect(() => {
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => {
        setIsGcs(j.type === "gcs");
        if (j.bucket) setBucket(j.bucket);
      })
      .catch(() => {});
  }, []);

  const storeName = isGcs ? "GCS" : "MinIO";
  const storeSub = isGcs ? "Google Cloud Storage" : "S3-compatible object store";
  const storeEdge = isGcs ? "GCS API · 443" : "S3 :9000";
  const fileIo = isGcs ? "GCSFileIO · Parquet + Puffin" : "S3FileIO · Parquet + Puffin";
  const sparkBundle = isGcs ? "iceberg-gcp-bundle 1.11.0" : "iceberg-aws-bundle 1.11.0";

  return (
    <svg
      viewBox="0 0 900 560"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      role="img"
      aria-label={`Architecture diagram: demo-webapp at top fans out to Spark Thrift, Lakekeeper, and ${storeName}. Lakekeeper backs onto Postgres. Spark Thrift reads and writes ${storeName}.`}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--arch-edge)" />
        </marker>
        <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--arch-edge-dim)" />
        </marker>
      </defs>

      {/* host port chip */}
      <g>
        <rect x="395" y="6" width="110" height="22" rx="11" fill="var(--arch-chip-bg)" stroke="var(--arch-chip-stroke)" />
        <text x="450" y="22" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="12" fill="var(--arch-chip-fg)">host :3030</text>
      </g>
      <line x1="450" y1="28" x2="450" y2="58" stroke="var(--arch-edge-dim)" strokeWidth="1.5" markerEnd="url(#arrow-dim)" />

      {/* demo-webapp */}
      <g>
        <rect x="290" y="60" width="320" height="84" rx="10" fill="var(--arch-webapp-bg)" stroke="var(--arch-webapp-stroke)" strokeWidth="1.5" />
        <text x="450" y="92" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontWeight="600" fontSize="16" fill="var(--arch-webapp-fg)">demo-webapp</text>
        <text x="450" y="112" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="11" fill="var(--arch-webapp-sub)">Next.js 15 · React 18</text>
        <text x="450" y="128" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="11" fill="var(--arch-webapp-sub)">SSE pipe for long INSERTs</text>
      </g>

      {/* Spark Thrift */}
      <g>
        <rect x="40" y="230" width="220" height="120" rx="10" fill="var(--arch-spark-bg)" stroke="var(--arch-spark-stroke)" strokeWidth="1.5" />
        <text x="150" y="260" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontWeight="600" fontSize="15" fill="var(--arch-spark-fg)">Spark Thrift Server</text>
        <text x="150" y="280" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="11" fill="var(--arch-spark-sub)">HiveServer2 wire protocol</text>
        <text x="150" y="306" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-spark-sub)">apache/spark 3.5.6</text>
        <text x="150" y="322" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-spark-sub)">iceberg-spark-runtime 1.11.0</text>
        <text x="150" y="338" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-spark-sub)">{sparkBundle}</text>
      </g>

      {/* Lakekeeper */}
      <g>
        <rect x="340" y="230" width="220" height="120" rx="10" fill="var(--arch-lake-bg)" stroke="var(--arch-lake-stroke)" strokeWidth="1.5" />
        <text x="450" y="260" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontWeight="600" fontSize="15" fill="var(--arch-lake-fg)">Lakekeeper</text>
        <text x="450" y="280" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="11" fill="var(--arch-lake-sub)">Iceberg REST catalog (Rust)</text>
        <text x="450" y="306" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-lake-sub)">v0.12.0</text>
        <text x="450" y="324" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-lake-sub)">authz: allow-all (demo)</text>
      </g>

      {/* Object store (MinIO / GCS) */}
      <g>
        <rect x="640" y="230" width="220" height="120" rx="10" fill="var(--arch-minio-bg)" stroke="var(--arch-minio-stroke)" strokeWidth="1.5" />
        <text x="750" y="260" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontWeight="600" fontSize="15" fill="var(--arch-minio-fg)">{storeName}</text>
        <text x="750" y="280" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="11" fill="var(--arch-minio-sub)">{storeSub}</text>
        <text x="750" y="306" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-minio-sub)">bucket: {bucket}</text>
        <text x="750" y="324" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-minio-sub)">Parquet + Puffin</text>
      </g>

      {/* Postgres */}
      <g>
        <rect x="340" y="470" width="220" height="74" rx="10" fill="var(--arch-lake-bg)" stroke="var(--arch-lake-stroke)" strokeWidth="1.5" strokeDasharray="4 4" />
        <text x="450" y="498" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontWeight="600" fontSize="14" fill="var(--arch-lake-fg)">Postgres 15</text>
        <text x="450" y="518" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="11" fill="var(--arch-lake-sub)">Lakekeeper metadata store</text>
        <text x="450" y="534" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="var(--arch-pg-foot)">internal · not exposed</text>
      </g>

      {/* webapp -> Spark (JDBC) */}
      <path d="M 370 144 C 280 180, 200 200, 150 230" stroke="var(--arch-edge)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
      <g>
        <rect x="200" y="174" width="110" height="22" rx="11" fill="var(--arch-chip-bg)" stroke="var(--arch-chip-stroke)" />
        <text x="255" y="190" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-chip-fg)">JDBC :10000</text>
      </g>

      {/* webapp -> Lakekeeper (REST) */}
      <line x1="450" y1="144" x2="450" y2="230" stroke="var(--arch-edge)" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <g>
        <rect x="395" y="174" width="110" height="22" rx="11" fill="var(--arch-chip-bg)" stroke="var(--arch-chip-stroke)" />
        <text x="450" y="190" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-chip-fg)">REST :8181</text>
      </g>

      {/* webapp -> object store */}
      <path d="M 530 144 C 620 180, 700 200, 750 230" stroke="var(--arch-edge)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
      <g>
        <rect x="585" y="174" width="120" height="22" rx="11" fill="var(--arch-chip-bg)" stroke="var(--arch-chip-stroke)" />
        <text x="645" y="190" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-chip-fg)">{storeEdge}</text>
      </g>

      {/* Spark <-> Lakekeeper (REST catalog) */}
      <line x1="260" y1="290" x2="340" y2="290" stroke="var(--arch-edge)" strokeWidth="1.5" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <text x="300" y="282" textAnchor="middle" fontFamily="ui-sans-serif, system-ui" fontSize="10" fill="var(--arch-edge-label)">REST catalog</text>

      {/* Lakekeeper -> Postgres */}
      <line x1="450" y1="350" x2="450" y2="470" stroke="var(--arch-edge-dim)" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arrow-dim)" />
      <g>
        <rect x="395" y="398" width="110" height="22" rx="11" fill="var(--arch-chip-bg)" stroke="var(--arch-chip-stroke)" />
        <text x="450" y="414" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-edge-label)">SQL · 5432</text>
      </g>

      {/* Spark -> object store (data plane). Arcs above Postgres, below Lakekeeper. */}
      <path d="M 260 320 C 360 400, 540 400, 640 320" stroke="var(--arch-edge)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
      <g>
        <rect x="600" y="378" width="210" height="22" rx="11" fill="var(--arch-chip-bg)" stroke="var(--arch-chip-stroke)" />
        <text x="705" y="394" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="var(--arch-chip-fg)">{fileIo}</text>
      </g>
    </svg>
  );
}
