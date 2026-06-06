"use client";
import { useState, useEffect } from "react";
import MinioTree from "@/components/UnderHood/MinioTree";
import CatalogView from "@/components/UnderHood/CatalogView";
import SnapshotTimeline from "@/components/UnderHood/SnapshotTimeline";

type Props = {
  minioPrefix: string;
  stepId: number;
  minioHint?: string;
  catalogTable?: string;
  snapshotsTable?: string;
};

export default function UnderHoodTabs({
  minioPrefix,
  stepId,
  minioHint,
  catalogTable,
  snapshotsTable,
}: Props) {
  const [activeTab, setActiveTab] = useState<"minio" | "catalog" | "snapshots">("minio");
  const [isGcs, setIsGcs] = useState(false);

  // Keep active tab valid if tables change across steps
  useEffect(() => {
    if (activeTab === "catalog" && !catalogTable) {
      setActiveTab("minio");
    } else if (activeTab === "snapshots" && !snapshotsTable) {
      setActiveTab("minio");
    }
  }, [catalogTable, snapshotsTable, activeTab]);

  useEffect(() => {
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => setIsGcs(j.type === "gcs"))
      .catch(() => {});
  }, []);

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 shadow-lg overflow-hidden backdrop-blur-md">
      {/* Tab bar header */}
      <div className="flex border-b border-ink-700 bg-ink-950/40">
        <button
          onClick={() => setActiveTab("minio")}
          className={`flex-1 py-2 px-3 text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 border-b-2 outline-none ${
            activeTab === "minio"
              ? "border-ice-500 text-ice-300 bg-ice-500/5"
              : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-ink-900/20"
          }`}
        >
          📂 {isGcs ? "GCS Storage" : "S3 Storage"}
        </button>
        {catalogTable && (
          <button
            onClick={() => setActiveTab("catalog")}
            className={`flex-1 py-2 px-3 text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 border-b-2 outline-none ${
              activeTab === "catalog"
                ? "border-ice-500 text-ice-300 bg-ice-500/5"
                : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-ink-900/20"
            }`}
          >
            📂 Catalog
          </button>
        )}
        {snapshotsTable && (
          <button
            onClick={() => setActiveTab("snapshots")}
            className={`flex-1 py-2 px-3 text-[11px] font-semibold uppercase tracking-wider transition-all duration-200 border-b-2 outline-none ${
              activeTab === "snapshots"
                ? "border-ice-500 text-ice-300 bg-ice-500/5"
                : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-ink-900/20"
            }`}
          >
            📂 Snapshots
          </button>
        )}
      </div>

      {/* Content pane */}
      <div>
        {activeTab === "minio" && (
          <div className="p-1 animate-in fade-in duration-200">
            <MinioTree prefix={minioPrefix} hint={minioHint} stepId={stepId} />
          </div>
        )}
        {activeTab === "catalog" && catalogTable && (
          <div className="p-1 animate-in fade-in duration-200">
            <CatalogView focusTable={catalogTable} />
          </div>
        )}
        {activeTab === "snapshots" && snapshotsTable && (
          <div className="p-1 animate-in fade-in duration-200">
            <SnapshotTimeline table={snapshotsTable} />
          </div>
        )}
      </div>
    </div>
  );
}
