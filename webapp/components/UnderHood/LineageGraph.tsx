"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Node = {
  id: string;
  kind: "catalog" | "metadata-json" | "manifest-list" | "manifest" | "data" | "delete-puffin" | "delete-parquet" | "stats-puffin";
  label: string;
  bytes?: number;
  snapshotId?: string;
  partition?: string;
  meta?: Record<string, any>;
};
type Edge = { from: string; to: string; kind: "points-to" | "shadows" };
type Graph = { table: string; nodes: Node[]; edges: Edge[]; error?: string };

const KIND_ORDER: Node["kind"][] = [
  "catalog", "metadata-json", "manifest-list", "manifest", "data", "delete-puffin", "delete-parquet", "stats-puffin",
];

const KIND_STYLE: Record<Node["kind"], { stroke: string; fill: string; text: string; short: string }> = {
  "catalog":       { stroke: "#5fc4d3", fill: "#0f3340", text: "#d6f4fa", short: "cat" },
  "metadata-json": { stroke: "#34d399", fill: "#062d24", text: "#a7f3d0", short: "metadata.json" },
  "manifest-list": { stroke: "#fbbf24", fill: "#3a2a0a", text: "#fde68a", short: "snap-*.avro" },
  "manifest":      { stroke: "#facc15", fill: "#3a3210", text: "#fef08a", short: "manifest" },
  "data":          { stroke: "#7dd3fc", fill: "#0a2438", text: "#bae6fd", short: "data parquet" },
  "delete-puffin": { stroke: "#f0abfc", fill: "#3b0a3b", text: "#f5d0fe", short: "puffin DV" },
  "delete-parquet":{ stroke: "#fb7185", fill: "#3b0e16", text: "#fecdd3", short: "pos delete" },
  "stats-puffin":  { stroke: "#a78bfa", fill: "#1f1b3a", text: "#ddd6fe", short: "stats" },
};

function fmtBytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function shortLabel(n: Node): string {
  // Strip overly long S3 prefixes to fit the box.
  const max = 28;
  if (n.label.length <= max) return n.label;
  return "…" + n.label.slice(-max + 1);
}

// Iceberg encodes day-transform as days-since-1970 and hour-transform as
// hours-since-1970. Decode them to ISO so the partition is readable.
function decodePartition(raw?: string): string {
  if (!raw) return "(unpartitioned)";
  let p: any;
  try { p = JSON.parse(raw); } catch { return raw; }
  if (!p || typeof p !== "object") return raw;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (v == null) { parts.push(`${k}=null`); continue; }
    if (typeof v === "number" && /day/i.test(k))  parts.push(`${k}=${new Date(v * 86400000).toISOString().slice(0, 10)}`);
    else if (typeof v === "number" && /hour/i.test(k)) parts.push(`${k}=${new Date(v * 3600000).toISOString().slice(0, 13).replace("T", " ")}`);
    else parts.push(`${k}=${v}`);
  }
  return parts.join(" · ");
}

// Roll up per-manifest leaf children (data + delete + stats) into one summary
// node per (manifest, kind). Keeps the graph balanced across columns instead
// of fanning out 29+ files from a single manifest.
const LEAF_KINDS: ReadonlyArray<Node["kind"]> = [
  "data", "delete-puffin", "delete-parquet", "stats-puffin",
];
function collapseLeaves(g: Graph): Graph {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  type Group = { manifestId: string; kind: Node["kind"]; children: Node[]; bytes: number; seen: Set<string> };
  const groups = new Map<string, Group>();
  const childToSummary = new Map<string, string>();
  for (const e of g.edges) {
    if (e.kind !== "points-to") continue;
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    if (from.kind === "manifest" && (LEAF_KINDS as readonly string[]).includes(to.kind)) {
      const key = `${from.id}|${to.kind}`;
      let gp = groups.get(key);
      if (!gp) { gp = { manifestId: from.id, kind: to.kind, children: [], bytes: 0, seen: new Set() }; groups.set(key, gp); }
      if (gp.seen.has(to.id)) continue;
      gp.seen.add(to.id);
      gp.children.push(to);
      gp.bytes += to.bytes ?? 0;
      childToSummary.set(to.id, `summary:${key}`);
    }
  }
  if (groups.size === 0) return g;
  const nodes: Node[] = [];
  for (const n of g.nodes) {
    if (childToSummary.has(n.id)) continue;
    nodes.push(n);
  }
  for (const [key, gp] of groups) {
    const sid = `summary:${key}`;
    const noun = KIND_STYLE[gp.kind].short;
    const parts = new Set<string>();
    for (const c of gp.children) parts.add(c.partition ?? "");
    nodes.push({
      id: sid,
      kind: gp.kind,
      label: `${gp.children.length} ${noun}`,
      bytes: gp.bytes,
      meta: {
        collapsed: true,
        count: gp.children.length,
        children: gp.children,
        manifestId: gp.manifestId,
        partitionCount: parts.size,
      },
    });
  }
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const e of g.edges) {
    const from = childToSummary.get(e.from) ?? e.from;
    const to = childToSummary.get(e.to) ?? e.to;
    if (from === to) continue;
    const k = `${from}|${to}|${e.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ from, to, kind: e.kind });
  }
  return { ...g, nodes, edges };
}

type Layout = {
  positions: Map<string, { x: number; y: number; w: number; h: number }>;
  width: number;
  height: number;
};

const NODE_W = 220;
const NODE_H = 42;
const NODE_GAP_X = 16;
const ROW_GAP_Y = 40;
const PADDING = 24;

// Top-down layout: one row per kind, nodes spread horizontally inside the row,
// centered in the available width. Width grows only when a row needs more than
// the canvas can fit (rare with leaf-grouping on).
function layout(graph: Graph): Layout {
  const cols = new Map<Node["kind"], Node[]>();
  for (const k of KIND_ORDER) cols.set(k, []);
  for (const n of graph.nodes) cols.get(n.kind)!.push(n);

  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  const occupied = KIND_ORDER.filter((k) => (cols.get(k)?.length ?? 0) > 0);
  let maxRowW = 0;
  for (const k of occupied) {
    const ns = cols.get(k)!;
    const rowW = ns.length * NODE_W + Math.max(0, ns.length - 1) * NODE_GAP_X;
    if (rowW > maxRowW) maxRowW = rowW;
  }
  const width = PADDING * 2 + maxRowW;
  let y = PADDING;
  for (const k of occupied) {
    const ns = cols.get(k)!;
    const rowW = ns.length * NODE_W + Math.max(0, ns.length - 1) * NODE_GAP_X;
    let x = PADDING + (maxRowW - rowW) / 2;
    for (const n of ns) {
      positions.set(n.id, { x, y, w: NODE_W, h: NODE_H });
      x += NODE_W + NODE_GAP_X;
    }
    y += NODE_H + ROW_GAP_Y;
  }
  const height = y - ROW_GAP_Y + PADDING;
  return { positions, width, height };
}

export default function LineageGraph({ table }: { table: string }) {
  const [g, setG] = useState<Graph | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [showOnlyCurrent, setShowOnlyCurrent] = useState(false);
  const [collapse, setCollapse] = useState(true);
  const [tall, setTall] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 6;
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  // Translate a client point to SVG viewBox coordinates (accounts for
  // preserveAspectRatio="xMidYMid meet" letterboxing).
  const clientToView = (cx: number, cy: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg || !lay) return null;
    const r = svg.getBoundingClientRect();
    const vbW = lay.width;
    const vbH = Math.max(lay.height, 200);
    const s = Math.min(r.width / vbW, r.height / vbH);
    const offX = (r.width - vbW * s) / 2;
    const offY = (r.height - vbH * s) / 2;
    return { x: (cx - r.left - offX) / s, y: (cy - r.top - offY) / s };
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = clampZoom(zoom * factor);
    if (newZoom === zoom) return;
    const v = clientToView(e.clientX, e.clientY);
    if (!v) { setZoom(newZoom); return; }
    // graph-space point under cursor before/after: (v - pan)/zoom should stay constant.
    const gx = (v.x - pan.x) / zoom;
    const gy = (v.y - pan.y) / zoom;
    setZoom(newZoom);
    setPan({ x: v.x - gx * newZoom, y: v.y - gy * newZoom });
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("g[data-node]")) return;
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    setDragging(true);
    try { el.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const svg = svgRef.current;
    if (!d || !svg || !lay) return;
    const r = svg.getBoundingClientRect();
    const vbW = lay.width;
    const vbH = Math.max(lay.height, 200);
    const s = Math.min(r.width / vbW, r.height / vbH);
    setPan({ x: d.px + (e.clientX - d.x) / s, y: d.py + (e.clientY - d.y) / s });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try { containerRef.current?.releasePointerCapture(e.pointerId); } catch {}
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/lineage?table=${encodeURIComponent(table)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) {
        const e = j.error ?? `HTTP ${r.status}`;
        // Step pages mount the graph before the focus table exists. Render
        // a placeholder instead of a red error line for that case.
        if (/table not found|TABLE_OR_VIEW_NOT_FOUND|NoSuchTable/i.test(String(e))) {
          setErr(null); setG({ table, nodes: [], edges: [] });
        } else { setErr(e); setG(null); }
      } else { setG(j); setErr(null); }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }, [table]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const h = () => fetchData();
    window.addEventListener("ic:step-ran", h);
    return () => window.removeEventListener("ic:step-ran", h);
  }, [fetchData]);

  const filtered = useMemo<Graph | null>(() => {
    if (!g) return null;
    if (!showOnlyCurrent) return g;
    const currentSnap = String((g.nodes.find((n) => n.kind === "metadata-json")?.snapshotId) ?? "");
    if (!currentSnap) return g;
    // metadata-json links to every snapshot's manifest-list, so a naive
    // reachability walk pulls them all back in. Drop manifest-list nodes
    // whose snapshotId != current, then prune edges touching them, then
    // walk from {catalog, metadata-json, current manifest-list}.
    const drop = new Set<string>();
    for (const n of g.nodes) {
      if (n.kind === "manifest-list" && n.snapshotId !== currentSnap) drop.add(n.id);
    }
    const edges0 = g.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to));
    const reachable = new Set<string>();
    for (const n of g.nodes) {
      if (drop.has(n.id)) continue;
      if (n.kind === "catalog" || n.kind === "metadata-json") reachable.add(n.id);
      if (n.kind === "manifest-list" && n.snapshotId === currentSnap) reachable.add(n.id);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges0) {
        if (reachable.has(e.from) && !reachable.has(e.to)) { reachable.add(e.to); grew = true; }
      }
    }
    return {
      table: g.table,
      nodes: g.nodes.filter((n) => reachable.has(n.id)),
      edges: edges0.filter((e) => reachable.has(e.from) && reachable.has(e.to)),
    };
  }, [g, showOnlyCurrent]);

  const view = useMemo<Graph | null>(() => {
    if (!filtered) return null;
    return collapse ? collapseLeaves(filtered) : filtered;
  }, [filtered, collapse]);

  const lay = useMemo<Layout | null>(() => (view ? layout(view) : null), [view]);

  // Subgraph reachable from hovered node (downstream + shadows neighbours).
  const highlight = useMemo<Set<string> | null>(() => {
    if (!view || !hoverId) return null;
    const out = new Set<string>([hoverId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of view.edges) {
        if (out.has(e.from) && !out.has(e.to)) { out.add(e.to); grew = true; }
        if (e.kind === "shadows" && out.has(e.to) && !out.has(e.from)) { out.add(e.from); grew = true; }
      }
    }
    return out;
  }, [view, hoverId]);

  const selNode = view?.nodes.find((n) => n.id === selId) ?? null;


  return (
    <div className="rounded border border-ink-700 bg-ink-900/60">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-gray-500">Iceberg lineage · {table}</div>
        <div className="flex items-center gap-3">
          <label className="text-[10px] text-gray-400 flex items-center gap-1">
            <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} />
            group leaf files
          </label>
          <label className="text-[10px] text-gray-400 flex items-center gap-1">
            <input type="checkbox" checked={showOnlyCurrent} onChange={(e) => setShowOnlyCurrent(e.target.checked)} />
            only current snapshot
          </label>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <button onClick={() => setZoom((z) => clampZoom(z / 1.2))}
                    className="p-1 rounded border border-ink-700 bg-ink-900/60 hover:text-ice-100 hover:border-ice-500 transition-colors flex items-center justify-center"
                    title="Zoom out (Ctrl+wheel)">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
              </svg>
            </button>
            <span className="font-mono tabular-nums w-10 text-center select-none text-gray-300">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => clampZoom(z * 1.2))}
                    className="p-1 rounded border border-ink-700 bg-ink-900/60 hover:text-ice-100 hover:border-ice-500 transition-colors flex items-center justify-center"
                    title="Zoom in (Ctrl+wheel)">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button onClick={resetView}
                    className="p-1 rounded border border-ink-700 bg-ink-900/60 hover:text-ice-100 hover:border-ice-500 transition-colors flex items-center justify-center"
                    title="Reset zoom + pan">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h5M4 4v5m0-5l5 5m11-5h-5m5 0v5m0-5l-5 5M4 20h5m-5 0v-5m0 5l5-5m11 5h-5m5 0v-5m0 5l-5-5" />
              </svg>
            </button>
            <button onClick={() => setTall((t) => !t)}
                    className="p-1 rounded border border-ink-700 bg-ink-900/60 hover:text-ice-100 hover:border-ice-500 transition-colors flex items-center justify-center"
                    title="Toggle panel height">
              {tall ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              )}
            </button>
          </div>
          <button onClick={fetchData} className="text-[11px] text-ice-500 hover:text-ice-300 font-semibold transition-colors">refresh</button>
        </div>
      </div>
      {err && <div className="p-3 text-red-400 text-xs font-mono whitespace-pre-wrap">{err}</div>}
      {loading && !g && <div className="p-3 text-xs text-gray-500 italic">loading lineage…</div>}
      {g && g.nodes.length === 0 && !err && (
        <div className="p-3 text-xs text-gray-500 italic">(table not created yet)</div>
      )}
      {view && lay && (
        <div className="grid grid-cols-12 gap-2">
          <div
            ref={containerRef}
            className={`${selNode ? "col-span-8" : "col-span-12"} relative overflow-hidden select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ height: tall ? 720 : 420, touchAction: "none" }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${lay.width} ${Math.max(lay.height, 200)}`}
              xmlns="http://www.w3.org/2000/svg"
              className="block w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <marker id="lg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#7aa8c6" />
                </marker>
                <marker id="lg-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#f0abfc" />
                </marker>
              </defs>
              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {/* Edges first so nodes overlap them */}
              {view.edges.map((e, i) => {
                const a = lay.positions.get(e.from);
                const b = lay.positions.get(e.to);
                if (!a || !b) return null;
                const dim = highlight && !(highlight.has(e.from) && highlight.has(e.to));
                // Top-down: edges leave bottom-center, enter top-center.
                if (e.kind === "shadows") {
                  // Sibling row — connect side-to-side via a horizontal segment.
                  const y = a.y + a.h / 2;
                  return (
                    <line key={i} x1={a.x} y1={y} x2={b.x + b.w} y2={b.y + b.h / 2}
                      stroke="#f0abfc" strokeWidth={0.8} strokeDasharray="4 3"
                      markerEnd="url(#lg-arrow-dim)" opacity={dim ? 0.18 : 0.85} />
                  );
                }
                const x1 = a.x + a.w / 2;
                const y1 = a.y + a.h;
                const x2 = b.x + b.w / 2;
                const y2 = b.y;
                // Orthogonal route with a horizontal midline so fan-out edges
                // don't visually merge at the parent's bottom-center point.
                const midY = (y1 + y2) / 2;
                const d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
                return (
                  <path key={i} d={d} fill="none"
                    stroke="#7aa8c6" strokeWidth={0.8}
                    markerEnd="url(#lg-arrow)" opacity={dim ? 0.18 : 0.85} />
                );
              })}
              {view.nodes.map((n) => {
                const p = lay.positions.get(n.id)!;
                const s = KIND_STYLE[n.kind];
                const dim = highlight && !highlight.has(n.id);
                const isSel = n.id === selId;
                // Tint manifest-list by snapshot operation so compaction (replace)
                // and deletes visually stand out from plain appends.
                const op = n.kind === "manifest-list" ? (n.meta?.operation as string | undefined) : undefined;
                const opStroke = op === "replace" ? "#a78bfa"
                  : op === "delete" ? "#fb7185"
                  : op === "overwrite" ? "#fb923c"
                  : null;
                const stroke = isSel ? "#fff" : (opStroke ?? s.stroke);
                return (
                  <g key={n.id}
                     data-node="1"
                     onMouseEnter={() => setHoverId(n.id)}
                     onMouseLeave={() => setHoverId(null)}
                     onClick={() => setSelId(n.id)}
                     style={{ cursor: "pointer", opacity: dim ? 0.25 : 1 }}>
                    <title>{n.label}</title>
                    <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={6}
                          fill={s.fill} stroke={stroke}
                          strokeWidth={isSel ? 1.6 : (opStroke ? 1.3 : 0.8)} />
                    <text x={p.x + 8} y={p.y + 16} fontFamily="ui-monospace, monospace" fontSize={11} fill={s.text}>
                      {shortLabel(n)}
                    </text>
                    <text x={p.x + 8} y={p.y + 30} fontFamily="ui-sans-serif, system-ui" fontSize={9} fill="#94a3b8">
                      {s.short}
                      {n.kind === "manifest-list" && n.meta?.operation ? ` · ${n.meta.operation}` : ""}
                      {n.bytes ? ` · ${fmtBytes(n.bytes)}` : ""}
                      {n.meta?.partitionCount ? ` · ${n.meta.partitionCount} parts` : ""}
                    </text>
                  </g>
                );
              })}
              </g>
            </svg>
          </div>

          {selNode && (
            <div className="col-span-4 border-l border-ink-700/60 bg-ink-950/20 max-h-[420px] overflow-auto scrollbar-thin p-4 text-xs backdrop-blur-md transition-all duration-300 ease-out">
              <div className="space-y-3.5">
                <div className="flex items-center justify-between gap-3 border-b border-ink-700/60 pb-2.5">
                  <div>
                    <span className="text-[10px] uppercase font-semibold tracking-wider text-gray-500">Kind</span>
                    <div className="text-ice-300 font-bold text-sm tracking-tight">{KIND_STYLE[selNode.kind].short}</div>
                  </div>
                  <button onClick={() => setSelId(null)}
                          className="w-6 h-6 rounded-full hover:bg-ink-800 flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors text-[18px] leading-none"
                          title="Close details">×</button>
                </div>
                {!selNode.meta?.collapsed && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">S3 key</span>
                    <div className="font-mono text-[10px] text-gray-300 break-all">{selNode.id}</div>
                  </div>
                )}
                {selNode.meta?.collapsed && selNode.meta?.manifestId && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Manifest</span>
                    <div className="font-mono text-[10px] text-gray-300 break-all">{String(selNode.meta.manifestId).split("/").slice(-1)[0]}</div>
                  </div>
                )}
                {selNode.bytes != null && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Size</span>
                    <div className="text-gray-300">{fmtBytes(selNode.bytes)}</div>
                  </div>
                )}
                {selNode.snapshotId && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Snapshot</span>
                    <div className="text-gray-300 font-mono">{selNode.snapshotId}</div>
                  </div>
                )}
                {selNode.partition && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Partition</span>
                    <div className="text-gray-300 font-mono break-all">{selNode.partition}</div>
                  </div>
                )}
                {selNode.meta?.collapsed && Array.isArray(selNode.meta.children) && (() => {
                  const groups = new Map<string, Node[]>();
                  for (const c of selNode.meta.children as Node[]) {
                    const key = c.partition ?? "";
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(c);
                  }
                  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                  return (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-gray-500">
                        Files ({selNode.meta.count}) · {ordered.length} partitions
                      </span>
                      <ul className="mt-1 space-y-2">
                        {ordered.map(([part, kids]) => {
                          const partBytes = kids.reduce((s, k) => s + (k.bytes ?? 0), 0);
                          return (
                            <li key={part} className="rounded border border-ink-700 bg-ink-900/40">
                              <div className="px-2 py-1 border-b border-ink-700 bg-ink-800/40">
                                <div className="font-mono text-[10px] text-ice-200 break-all">{decodePartition(part)}</div>
                                <div className="text-[10px] text-gray-500">{kids.length} files · {fmtBytes(partBytes)}</div>
                              </div>
                              <ul className="px-2 py-1 space-y-0.5">
                                {kids.map((c) => (
                                  <li key={c.id} className="flex justify-between gap-2 text-[10px]">
                                    <span className="font-mono text-gray-400 truncate">{c.label}</span>
                                    <span className="text-gray-500 flex-none">{fmtBytes(c.bytes)}</span>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })()}
                {selNode.meta && !selNode.meta.collapsed && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Meta</span>
                    <pre className="text-[10px] text-gray-400 whitespace-pre-wrap break-all">
                      {JSON.stringify(selNode.meta, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
          </div>
          )}
        </div>
      )}
      {view && (
        <div className="border-t border-ink-700 px-3 py-1.5 text-[10px] text-gray-500 flex items-center justify-between">
          <span>{view.nodes.length} nodes · {view.edges.length} edges{selNode ? "" : " · click a node for details"}</span>
          <span className="text-gray-600">drag to pan · Ctrl+wheel to zoom</span>
        </div>
      )}
    </div>
  );
}
