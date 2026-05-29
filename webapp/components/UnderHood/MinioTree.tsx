"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type FileRow = { key: string; size: number; etag: string; lastModified: string; status: "added" | "removed" | "changed" | "same" };
type Resp = { prefix: string; count: number; files: FileRow[]; diff?: { baseline: string } };

type TreeNode = {
  name: string;
  fullPath: string;
  isFile: boolean;
  size?: number;
  status?: FileRow["status"];
  children: Map<string, TreeNode>;
};

function buildTree(prefix: string, files: FileRow[]): TreeNode {
  const root: TreeNode = { name: prefix, fullPath: prefix, isFile: false, children: new Map() };
  for (const f of files) {
    const rel = f.key.startsWith(prefix) ? f.key.slice(prefix.length) : f.key;
    const parts = rel.split("/").filter(Boolean);
    let node = root;
    parts.forEach((p, idx) => {
      const last = idx === parts.length - 1;
      let child = node.children.get(p);
      if (!child) {
        child = {
          name: p,
          fullPath: (node.fullPath.endsWith("/") ? node.fullPath : node.fullPath + "/") + p,
          isFile: last,
          children: new Map(),
        };
        node.children.set(p, child);
      }
      if (last) {
        child.isFile = true;
        child.size = f.size;
        child.status = f.status;
      }
      node = child;
    });
  }
  return root;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function kindOf(name: string): { label: string; cls: string } | null {
  if (name.endsWith(".puffin")) return { label: "puffin DV", cls: "text-fuchsia-300 bg-fuchsia-900/30 border-fuchsia-700/40" };
  if (name.endsWith(".parquet")) return { label: "parquet", cls: "text-sky-300 bg-sky-900/30 border-sky-700/40" };
  if (name.endsWith(".metadata.json")) return { label: "metadata", cls: "text-emerald-300 bg-emerald-900/30 border-emerald-700/40" };
  if (name.endsWith(".avro") && name.includes("snap-")) return { label: "snapshot list", cls: "text-amber-300 bg-amber-900/30 border-amber-700/40" };
  if (name.endsWith(".avro")) return { label: "manifest", cls: "text-yellow-300 bg-yellow-900/30 border-yellow-700/40" };
  if (name.endsWith(".stats")) return { label: "stats", cls: "text-gray-300 bg-gray-900/30 border-gray-700/40" };
  return null;
}

function statusGlyph(s?: FileRow["status"]) {
  switch (s) {
    case "added":   return { ch: "+", cls: "text-emerald-400" };
    case "removed": return { ch: "−", cls: "text-red-400" };
    case "changed": return { ch: "~", cls: "text-amber-400" };
    default:        return { ch: "·", cls: "text-gray-600" };
  }
}

function NodeView({ node, depth, openMap, toggle }: {
  node: TreeNode; depth: number;
  openMap: Set<string>; toggle: (k: string) => void;
}) {
  const open = openMap.has(node.fullPath) || depth < 2;
  if (node.isFile) {
    const k = kindOf(node.name);
    const g = statusGlyph(node.status);
    const rowCls =
      node.status === "added"   ? "bg-emerald-900/15"
      : node.status === "removed" ? "bg-red-900/15 line-through"
      : node.status === "changed" ? "bg-amber-900/15"
      : "";
    return (
      <div className={`flex items-center gap-2 font-mono text-xs py-0.5 pr-1 rounded ${rowCls}`}
           style={{ paddingLeft: depth * 12 + 4 }}>
        <span className={`w-3 text-center ${g.cls}`}>{g.ch}</span>
        <span className="text-gray-300 truncate">{node.name}</span>
        {k && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${k.cls}`}>{k.label}</span>}
        <span className="ml-auto text-[10px] text-gray-500 shrink-0">{fmtSize(node.size ?? 0)}</span>
      </div>
    );
  }
  const kids = Array.from(node.children.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return (
    <div>
      {depth > 0 && (
        <button
          onClick={() => toggle(node.fullPath)}
          className="flex items-center gap-1 text-xs text-ice-100 hover:text-ice-500 py-0.5 w-full text-left font-mono"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <span className="w-3 text-gray-500">{open ? "▾" : "▸"}</span>
          <span className="font-semibold">{node.name}/</span>
          <span className="text-[10px] text-gray-500 ml-1">{countFiles(node)} files</span>
        </button>
      )}
      {open && kids.map((c) => (
        <NodeView key={c.fullPath} node={c} depth={depth + 1} openMap={openMap} toggle={toggle} />
      ))}
    </div>
  );
}

function countFiles(n: TreeNode): number {
  if (n.isFile) return 1;
  let c = 0;
  for (const child of n.children.values()) c += countFiles(child);
  return c;
}

export default function MinioTree({ prefix, hint, stepId }: { prefix: string; hint?: string; stepId: number }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Set<string>>(new Set());
  const [diffOn, setDiffOn] = useState(true);

  const fetchData = useCallback(async () => {
    const q = new URLSearchParams({ prefix });
    if (diffOn) q.set("diffStep", String(stepId));
    try {
      const r = await fetch(`/api/minio?${q.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? `HTTP ${r.status}`); return; }
      setData(j); setErr(null);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }, [prefix, stepId, diffOn]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.stepId === stepId) fetchData();
    };
    window.addEventListener("ic:step-ran", h);
    return () => window.removeEventListener("ic:step-ran", h);
  }, [stepId, fetchData]);

  const tree = useMemo(() => data ? buildTree(prefix, data.files) : null, [data, prefix]);
  const toggle = (k: string) => setOpenMap((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const counts = useMemo(() => {
    if (!data) return null;
    const c = { added: 0, removed: 0, changed: 0, same: 0 };
    for (const f of data.files) c[f.status]++;
    return c;
  }, [data]);

  return (
    <div className="rounded border border-ink-700 bg-ink-900/60">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-gray-500">MinIO file tree</div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400 flex items-center gap-1">
            <input type="checkbox" checked={diffOn} onChange={(e) => setDiffOn(e.target.checked)} />
            highlight diff
          </label>
          <button onClick={fetchData} className="text-[11px] text-ice-500 hover:text-ice-100">refresh</button>
        </div>
      </div>
      {hint && <div className="px-3 py-1.5 text-[11px] text-gray-500 border-b border-ink-700/60">{hint}</div>}
      <div className="px-3 py-1.5 text-[11px] text-gray-500 border-b border-ink-700/60 font-mono">
        {prefix} · {data?.count ?? "…"} objects
        {counts && diffOn && (
          <span className="ml-2">
            <span className="text-emerald-400">+{counts.added}</span>{" "}
            <span className="text-amber-400">~{counts.changed}</span>{" "}
            <span className="text-red-400">−{counts.removed}</span>
          </span>
        )}
      </div>
      {err && <div className="p-3 text-red-400 text-xs font-mono">{err}</div>}
      <div className="p-2 max-h-[460px] overflow-auto scrollbar-thin">
        {tree && <NodeView node={tree} depth={0} openMap={openMap} toggle={toggle} />}
        {data && data.count === 0 && <div className="text-xs text-gray-500 italic px-2 py-3">(no objects under this prefix)</div>}
      </div>
    </div>
  );
}
