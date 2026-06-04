"use client";
import { useState } from "react";

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      // Modern API (requires HTTPS or localhost)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for insecure HTTP contexts
        const textArea = document.createElement("textarea");
        textArea.value = value;
        // Ensure textarea is not visible but part of the DOM
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand("copy");
        } catch (err) {
          console.error("Fallback copy failed", err);
        }
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  return (
    <div
      onClick={copyToClipboard}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-ink-700 hover:border-ice-500/60 bg-ink-900/40 text-gray-300 hover:text-ice-200 font-mono text-[11px] transition cursor-pointer select-text"
      title={`Click to copy ${label} (or select manually)`}
    >
      <span className="text-gray-500 pointer-events-none">{label}:</span>
      <span className="select-text cursor-text">{value}</span>
      <span className="text-[9px] text-emerald-400 ml-1 pointer-events-none">{copied ? "✓" : "⧉"}</span>
    </div>
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
