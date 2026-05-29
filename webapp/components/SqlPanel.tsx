"use client";
import { useEffect, useRef, useState } from "react";
import type { Step } from "@/lib/steps";
import {
  applyConfig,
  applyConfigForSql,
  DemoConfig,
  loadConfig,
  subscribeConfig,
} from "@/lib/demoConfig";
import DemoConfigPanel from "@/components/DemoConfigPanel";

type EventMsg =
  | { kind: "hello"; stepId: number; title: string; prefix: string }
  | { kind: "start"; stmtIdx: number; total: number; sql: string }
  | { kind: "running"; stmtIdx: number; elapsedMs: number }
  | { kind: "result"; stmtIdx: number; columns: string[]; data: any[][] }
  | { kind: "done"; durationMs: number }
  | { kind: "error"; message: string }
  | { kind: "diff"; prefix: string; added: string[]; removed: string[]; changed: string[] };

const KEYWORDS = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|INSERT INTO|UPDATE|DELETE|CREATE|DROP|TABLE|NAMESPACE|IF NOT EXISTS|IF EXISTS|USING|PARTITIONED BY|TBLPROPERTIES|ALTER|ADD COLUMN|AS|CALL|SET|AND|OR|UNION ALL|UNION|CAST|CASE|WHEN|THEN|ELSE|END|TIMESTAMP|BIGINT|STRING|DOUBLE|INT|BOOLEAN)\b/g;
// Format a result cell. Spark structs (e.g. partition column of `.partitions`
// view) come back as plain objects; native String() yields "[object Object]".
// Decode Iceberg day/hour partition transforms to ISO so the cell is readable.
function fmtCell(v: any): string {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  if (v && typeof v === "object") {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v)) {
      if (val == null) { parts.push(`${k}=null`); continue; }
      if (typeof val === "number" && /day/i.test(k))       parts.push(`${k}=${new Date(val * 86400000).toISOString().slice(0, 10)}`);
      else if (typeof val === "number" && /hour/i.test(k)) parts.push(`${k}=${new Date(val * 3600000).toISOString().slice(0, 13).replace("T", " ")}`);
      else if (typeof val === "object")                    parts.push(`${k}=${JSON.stringify(val)}`);
      else                                                  parts.push(`${k}=${val}`);
    }
    return parts.length ? `{${parts.join(", ")}}` : "{}";
  }
  return String(v);
}

function highlight(sql: string) {
  return sql
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/--.*$/gm, (m) => `<span class="sql-comment">${m}</span>`)
    .replace(/'([^']*)'/g, `<span class="sql-string">'$1'</span>`)
    .replace(/\b(\d+(?:\.\d+)?)\b/g, `<span class="sql-number">$1</span>`)
    .replace(KEYWORDS, `<span class="sql-keyword">$1</span>`);
}

export default function SqlPanel({ step }: { step: Step }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ stmt: number; total: number; elapsedMs: number; startedAt: number } | null>(null);
  const [results, setResults] = useState<Array<{ stmtIdx: number; columns: string[]; data: any[][] }>>([]);
  const [stmtSql, setStmtSql] = useState<Record<number, string>>({});
  const [doneMs, setDoneMs] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ added: number; removed: number; changed: number } | null>(null);
  const [cfg, setCfg] = useState<DemoConfig | null>(null);
  // Use the bare step.sql until config has loaded so SSR + first paint stay
  // consistent; placeholders get resolved on the first effect tick.
  // SQL displayed in editor must be runnable; use raw int substitution
  // (formatted "100K" would be invalid SQL). Prose elsewhere uses applyConfig.
  const baseSql = cfg ? applyConfigForSql(step.sql, cfg) : step.sql;
  const [sql, setSql] = useState<string>(step.sql);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const edited = sql.trim() !== baseSql.trim();

  useEffect(() => {
    if (!progress) return;
    const startedAt = progress.startedAt;
    const t = setInterval(() => {
      setProgress((p) => (p && p.startedAt === startedAt ? { ...p, elapsedMs: Date.now() - startedAt } : p));
    }, 500);
    return () => clearInterval(t);
  }, [progress?.startedAt]);

  const lastTemplateRef = useRef<string>("");
  useEffect(() => {
    const initial = loadConfig();
    setCfg(initial);
    const firstTemplate = applyConfigForSql(step.sql, initial);
    lastTemplateRef.current = firstTemplate;
    setSql(firstTemplate);
    setResults([]); setStmtSql({}); setDoneMs(null); setErr(null); setDiff(null); setProgress(null);
    const unsub = subscribeConfig((next) => {
      setCfg(next);
      const nextTemplate = applyConfigForSql(step.sql, next);
      // Only sync the editor to the new template if the user hasn't typed
      // edits in (i.e. the textarea still matches the last template we wrote).
      setSql((prev) => {
        const synced = prev.trim() === lastTemplateRef.current.trim();
        lastTemplateRef.current = nextTemplate;
        return synced ? nextTemplate : prev;
      });
    });
    fetch(`/api/cached?stepId=${step.id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.cached) {
          if (Array.isArray(j.rowSets)) {
            setResults(j.rowSets.filter((r: any) => r.columns.length > 0));
            // Cached payloads don't carry per-stmt SQL. Reconstruct from
            // step.sql so the per-result label still shows a snippet.
            const stmts = step.sql
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .replace(/^\s*--.*$/gm, "")
              .split(/;\s*(?:\r?\n|$)/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            const map: Record<number, string> = {};
            stmts.forEach((s, i) => { map[i] = s; });
            setStmtSql(map);
          }
          setDoneMs(j.durationMs);
          if (j.error) setErr(j.error);
        }
      })
      .catch(() => {});
    return unsub;
  }, [step.id]);

  async function run() {
    if (running) return;
    setRunning(true); setResults([]); setStmtSql({}); setDoneMs(null); setErr(null); setDiff(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const currentCfg = cfg ?? loadConfig();
      const runSql = applyConfigForSql(sql, currentCfg);
      const resp = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id, sql: runSql }),
        signal: ctrl.signal,
      });
      if (!resp.body) throw new Error("no stream");
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const evLine = f.split("\n").find((l) => l.startsWith("event: "));
          const dataLine = f.split("\n").find((l) => l.startsWith("data: "));
          if (!evLine || !dataLine) continue;
          const ev = evLine.slice(7).trim();
          let payload: any;
          try { payload = JSON.parse(dataLine.slice(6)); } catch { continue; }
          const msg = { kind: ev, ...payload } as EventMsg;
          handle(msg);
        }
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setRunning(false);
      window.dispatchEvent(new CustomEvent("ic:step-ran", { detail: { stepId: step.id } }));
    }
  }

  function handle(msg: EventMsg) {
    switch (msg.kind) {
      case "start":
        setProgress({ stmt: msg.stmtIdx + 1, total: msg.total, elapsedMs: 0, startedAt: Date.now() });
        setStmtSql((m) => ({ ...m, [msg.stmtIdx]: msg.sql }));
        break;
      case "running":
        setProgress((p) => p ? { ...p, elapsedMs: msg.elapsedMs } : p);
        break;
      case "result":
        if (msg.columns.length > 0) {
          setResults((r) => [...r, { stmtIdx: msg.stmtIdx, columns: msg.columns, data: msg.data }]);
        }
        break;
      case "done":
        setDoneMs(msg.durationMs);
        setProgress(null);
        break;
      case "error":
        setErr(msg.message);
        setProgress(null);
        break;
      case "diff":
        setDiff({ added: msg.added.length, removed: msg.removed.length, changed: msg.changed.length });
        break;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {step.id === 2 && <DemoConfigPanel variant="step" />}
      <div className="rounded border border-ink-700 bg-ink-900/80 flex flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-2">
          SQL
          {edited && <span className="text-[10px] text-amber-400 normal-case tracking-normal">(edited, cache off)</span>}
        </div>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-xs text-gray-400">
              stmt {progress.stmt}/{progress.total} · {Math.round(progress.elapsedMs / 1000)}s
            </span>
          )}
          {doneMs !== null && !running && !err && (
            <span className="text-xs text-emerald-400">done in {Math.round(doneMs / 1000)}s</span>
          )}
          {edited && !running && (
            <button
              onClick={() => setSql(baseSql)}
              className="px-2 py-1 rounded text-xs text-gray-400 hover:text-ice-200 border border-ink-700 hover:border-ice-500/60 transition"
              title="Restore the original SQL for this step"
            >
              Reset
            </button>
          )}
          <button
            onClick={run}
            disabled={running}
            className={`px-3 py-1 rounded text-xs font-semibold transition ${
              running
                ? "bg-ink-700 text-gray-500 cursor-not-allowed"
                : "bg-ice-500 hover:bg-ice-700 text-white"
            }`}
          >
            {running ? (
              <span className="inline-flex items-center">
                Running<span className="ic-dots"><span /><span /><span /></span>
              </span>
            ) : "Run"}
          </button>
        </div>
      </div>

      <div className="relative font-mono text-[0.78rem] leading-relaxed">
        <pre
          ref={preRef}
          aria-hidden
          className="absolute inset-0 m-0 p-4 overflow-hidden whitespace-pre text-gray-300 pointer-events-none"
          style={{ fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }}
          dangerouslySetInnerHTML={{ __html: highlight(sql) + "\n" }}
        />
        <textarea
          ref={taRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onScroll={(e) => {
            if (preRef.current) {
              preRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
              preRef.current.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft;
            }
          }}
          spellCheck={false}
          rows={Math.max(6, sql.split("\n").length)}
          className="relative block w-full p-4 m-0 bg-transparent text-transparent resize-y outline-none whitespace-pre overflow-auto scrollbar-thin selection:bg-ice-500/40"
          style={{
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: "inherit",
            minHeight: "8rem",
            caretColor: "#dcecff",
          }}
        />
      </div>

      {err && (
        <div className="border-t border-ink-700 px-4 py-3 text-sm text-red-400 bg-red-900/10 font-mono whitespace-pre-wrap">
          {err}
        </div>
      )}

      {diff && (
        <div className="border-t border-ink-700 px-4 py-2 text-xs text-gray-400 bg-ink-800/50">
          MinIO delta this step:
          <span className="text-emerald-400 ml-2">+{diff.added}</span>
          <span className="text-amber-400 ml-2">~{diff.changed}</span>
          <span className="text-red-400 ml-2">−{diff.removed}</span>
        </div>
      )}

      {results.length > 0 && (
        <div className="border-t border-ink-700">
          <div className="text-xs uppercase tracking-wider text-gray-500 px-3 py-2 border-b border-ink-700">
            Result{results.length > 1 ? "s" : ""}
          </div>
          <div className="p-3 space-y-3 bg-ink-900/40">
            {results.map((r, i) => {
              const snippet = (stmtSql[r.stmtIdx] ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
              return (
                <div key={i} className="rounded-md border border-ink-700 bg-ink-900/80 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-ink-800/60 border-b border-ink-700">
                    <span className="inline-flex items-center justify-center min-w-[1.75rem] h-5 px-1.5 rounded text-[10px] font-bold bg-ice-500/20 text-ice-300 border border-ice-500/40">S{r.stmtIdx + 1}</span>
                    {snippet && (
                      <code className="text-[11px] font-mono text-gray-400 truncate flex-1">{snippet}{snippet.length === 120 ? "…" : ""}</code>
                    )}
                    <span className="text-[10px] text-gray-500 flex-none">{r.data.length} row{r.data.length === 1 ? "" : "s"}</span>
                  </div>
                  <ResultTable columns={r.columns} data={r.data} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function ResultTable({ columns, data }: { columns: string[]; data: any[][] }) {
  if (columns.length === 0) return null;
  if (data.length === 0) {
    return <div className="px-3 py-2 text-gray-500 italic text-xs">(no rows)</div>;
  }
  return (
    <div className="overflow-auto scrollbar-thin max-h-[28rem]">
      <table className="min-w-full table-auto border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="text-left px-3 py-2 bg-ink-800 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 border-b-2 border-ice-500/40 whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="even:bg-ink-900/30 hover:bg-ice-500/[0.06] transition-colors">
              {row.map((v, j) => {
                const s = v === null || v === undefined ? null : fmtCell(v);
                const long = s !== null && s.length > 80;
                return (
                  <td
                    key={j}
                    title={long ? s! : undefined}
                    className="px-3 py-1.5 text-gray-100 border-b border-ink-700/40 align-top font-mono text-[12px] max-w-[28rem] truncate"
                  >
                    {s === null ? <span className="text-gray-600 italic">NULL</span> : s}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
