"use client";
import { useEffect, useMemo, useState } from "react";
import { applyConfig, DEFAULT_CONFIG, DemoConfig, loadConfig, subscribeConfig } from "@/lib/demoConfig";

function inline(s: string): string {
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-ink-700/80 text-ice-100 font-mono text-[0.85em]">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
}

function paragraphs(body: string): string {
  return body
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((p) => `<p>${inline(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

type Section = { title: string | null; body: string };

function parse(md: string): Section[] {
  const lines = md.split("\n");
  const out: Section[] = [];
  let cur: Section = { title: null, body: "" };
  for (const ln of lines) {
    const m = ln.match(/^##\s+(.+)$/);
    if (m) {
      if (cur.body.trim() || cur.title) out.push(cur);
      cur = { title: m[1], body: "" };
    } else {
      cur.body += ln + "\n";
    }
  }
  if (cur.body.trim() || cur.title) out.push(cur);
  return out;
}

export default function WhyPanel({ markdown }: { markdown: string }) {
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    setCfg(loadConfig());
    return subscribeConfig((c) => setCfg(c));
  }, []);
  const resolved = useMemo(() => applyConfig(markdown, cfg), [markdown, cfg]);
  const sections = useMemo(() => parse(resolved), [resolved]);
  const hasSections = sections.some((s) => s.title !== null);
  if (!hasSections) {
    return (
      <div
        className="rounded border border-ink-700 bg-ink-800/60 p-4 text-sm leading-relaxed text-gray-200 space-y-2 [&_p+p]:mt-2 max-h-[calc(100vh-280px)] overflow-y-auto scrollbar-thin"
        dangerouslySetInnerHTML={{ __html: paragraphs(resolved) }}
      />
    );
  }
  return (
    <div className="rounded border border-ink-700 bg-ink-800/60 text-sm leading-relaxed text-gray-200 max-h-[calc(100vh-280px)] overflow-y-auto scrollbar-thin divide-y divide-ink-700/70">
      {sections.map((s, i) => {
        if (s.title === null) {
          return (
            <div
              key={i}
              className="p-4 space-y-2 [&_p+p]:mt-2"
              dangerouslySetInnerHTML={{ __html: paragraphs(s.body) }}
            />
          );
        }
        return (
          <details
            key={i}
            className="group"
          >
            <summary className="cursor-pointer list-none px-4 py-2.5 flex items-center justify-between bg-ink-800/40 hover:bg-ink-700/40 transition select-none">
              <span className="text-ice-200 font-semibold text-[0.85rem] uppercase tracking-wider">{s.title}</span>
              <span className="text-gray-500 group-open:rotate-90 transition-transform text-xs">▶</span>
            </summary>
            <div
              className="p-4 space-y-2 [&_p+p]:mt-2"
              dangerouslySetInnerHTML={{ __html: paragraphs(s.body) }}
            />
          </details>
        );
      })}
    </div>
  );
}
