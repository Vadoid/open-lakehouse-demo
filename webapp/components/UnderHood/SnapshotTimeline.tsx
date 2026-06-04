"use client";
import { useCallback, useEffect, useState } from "react";

type Resp = { table: string; columns: string[]; data: any[][]; error?: string; missing?: boolean };

const OP_COLOR: Record<string, string> = {
  append: "bg-emerald-500",
  overwrite: "bg-indigo-500",
  delete: "bg-red-500",
  update: "bg-amber-500",
  replace: "bg-fuchsia-500",
};

export default function SnapshotTimeline({ table, borderless = false }: { table: string; borderless?: boolean }) {
  const [r, setR] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/snapshots?table=${encodeURIComponent(table)}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || j.error) { setErr(j.error ?? `HTTP ${res.status}`); setR(null); return; }
      setR(j); setErr(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }, [table]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const h = () => fetchData();
    window.addEventListener("ic:step-ran", h);
    return () => window.removeEventListener("ic:step-ran", h);
  }, [fetchData]);

  return (
    <div className={borderless ? "" : "rounded border border-ink-700 bg-ink-900/60"}>
      {!borderless ? (
        <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
          <div className="text-xs uppercase tracking-wider text-gray-500">Snapshot timeline · {table}</div>
          <button onClick={fetchData} className="text-[11px] text-ice-500 hover:text-ice-100">refresh</button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-ink-700/60 px-3 py-1.5 bg-ink-950/20">
          <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Commit Timeline</div>
          <button onClick={fetchData} className="text-[10px] text-ice-500 hover:text-ice-100">refresh</button>
        </div>
      )}
      {err && <div className="p-3 text-red-400 text-xs font-mono whitespace-pre-wrap">{err}</div>}
      {r && (
        <div className="p-3">
          <div className="flex flex-wrap gap-2">
            {r.data.map((row, i) => {
              const m = Object.fromEntries(r.columns.map((c, idx) => [c, row[idx]]));
              const op = String(m.operation ?? "").toLowerCase();
              const dot = OP_COLOR[op] ?? "bg-gray-500";
              return (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded border border-ink-700 bg-ink-800/70">
                  <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
                  <div className="text-[10px] leading-tight">
                    <div className="text-gray-200 font-mono">{op || "?"}</div>
                    <div className="text-gray-500">{String(m.committed_at ?? "").replace("T", " ").slice(0, 19)}</div>
                  </div>
                  {m.data_files != null && (
                    <div className="text-[10px] text-gray-500 ml-1">d:{String(m.data_files)} / dv:{String(m.delete_files ?? 0)}</div>
                  )}
                </div>
              );
            })}
            {r.data.length === 0 && (
              <div className="text-xs text-gray-500 italic">
                {r.missing ? "(table not created yet)" : "(no snapshots yet)"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
