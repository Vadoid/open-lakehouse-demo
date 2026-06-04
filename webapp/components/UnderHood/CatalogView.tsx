"use client";
import { useCallback, useEffect, useState } from "react";

type Tree = { namespaces: { ns: string[]; tables: string[] }[] };

export default function CatalogView({ focusTable, borderless = false }: { focusTable?: string; borderless?: boolean }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [props, setProps] = useState<any | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const r = await fetch("/api/catalog", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? `HTTP ${r.status}`); return; }
      setTree(j); setErr(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const h = () => fetchAll();
    window.addEventListener("ic:step-ran", h);
    return () => window.removeEventListener("ic:step-ran", h);
  }, [fetchAll]);

  useEffect(() => {
    if (!focusTable) { setProps(null); return; }
    fetch(`/api/catalog?table=${encodeURIComponent(focusTable)}&ns=market`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setProps(j?.meta?.metadata ?? null)).catch(() => {});
  }, [focusTable, tree]);

  return (
    <div className={borderless ? "" : "rounded border border-ink-700 bg-ink-900/60"}>
      {!borderless ? (
        <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
          <div className="text-xs uppercase tracking-wider text-gray-500">Lakekeeper catalog</div>
          <button onClick={fetchAll} className="text-[11px] text-ice-500 hover:text-ice-100">refresh</button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-ink-700/60 px-3 py-1.5 bg-ink-950/20">
          <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Catalog Schema</div>
          <button onClick={fetchAll} className="text-[10px] text-ice-500 hover:text-ice-100">refresh</button>
        </div>
      )}
      {err && <div className="p-3 text-red-400 text-xs font-mono">{err}</div>}
      <div className="p-3 text-xs font-mono space-y-1.5">
        {tree?.namespaces.map((nsRow) => (
          <div key={nsRow.ns.join(".")}>
            <div className="text-ice-100 font-semibold">📂 {nsRow.ns.join(".")}</div>
            {nsRow.tables.map((t) => (
              <div key={t} className="pl-5">
                <a href={`/graph#${encodeURIComponent(t)}`}
                   title={`Open ${t} in lineage explorer`}
                   className={`hover:text-ice-100 hover:underline ${t === focusTable ? "text-amber-300" : "text-gray-300"}`}>
                  📊 {t}
                </a>
                {t === focusTable && props && (
                  <div className="pl-5 mt-1 text-[10px] text-gray-400 space-y-0.5">
                    <div>format-version: <span className="text-emerald-300">{props["format-version"] ?? "?"}</span></div>
                    {props.properties && Object.entries(props.properties).slice(0, 6).map(([k, v]) => (
                      <div key={k}><span className="text-gray-500">{k}</span> = <span className="text-gray-300">{String(v)}</span></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {nsRow.tables.length === 0 && <div className="pl-5 text-gray-600 italic">(no tables)</div>}
          </div>
        ))}
        {!tree && !err && <div className="text-gray-500 italic">loading…</div>}
      </div>
    </div>
  );
}
