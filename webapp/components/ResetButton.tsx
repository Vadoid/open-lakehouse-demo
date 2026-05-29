"use client";

import { useState } from "react";

type ResetResult = { ok: boolean; log: string[]; errors: string[] };

export default function ResetButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/reset", { method: "POST" });
      const j = (await r.json()) as ResetResult;
      setResult(j);
    } catch (e: any) {
      setResult({ ok: false, log: [], errors: [String(e?.message ?? e)] });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded border border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-200 hover:bg-red-500/30 disabled:opacity-50"
        >
          Reset demo
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-700 dark:text-red-200">Drop every table and purge MinIO?</span>
          <button
            onClick={run}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {busy ? "Resetting…" : "Yes, reset"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded border border-ink-700 text-gray-300 hover:bg-ink-800"
          >
            Cancel
          </button>
        </div>
      )}

      {result && (
        <div
          className={`text-xs rounded border p-2 max-w-md ${
            result.ok
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-200"
          }`}
        >
          <div className="font-semibold mb-1">
            {result.ok ? "Reset complete." : "Reset finished with errors."}
          </div>
          {result.log.map((l, i) => (
            <div key={`l${i}`} className="font-mono">
              {l}
            </div>
          ))}
          {result.errors.map((e, i) => (
            <div key={`e${i}`} className="font-mono text-red-800 dark:text-red-300">
              {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
