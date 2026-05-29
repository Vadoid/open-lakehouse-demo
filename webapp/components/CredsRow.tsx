"use client";
import { useState } from "react";

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* ignore */ }
      }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-ink-700 hover:border-ice-500/60 text-gray-300 hover:text-ice-200 font-mono text-[11px] transition"
      title={`Copy ${label}`}
    >
      <span className="text-gray-500">{label}:</span>
      <span>{value}</span>
      <span className="text-[9px] text-emerald-400 ml-1">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

export default function CredsRow({ user = "minio-admin", password = "minio-admin-password" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <CopyChip label="user" value={user} />
      <CopyChip label="pw" value={password} />
    </span>
  );
}
