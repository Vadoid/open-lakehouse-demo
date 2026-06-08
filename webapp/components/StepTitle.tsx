"use client";
import { useEffect, useState } from "react";
import { applyConfig, DEFAULT_CONFIG, DemoConfig, loadConfig, subscribeConfig } from "@/lib/demoConfig";

export function StepTitle({ id, title }: { id: number; title: string }) {
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    setCfg(loadConfig());
    return subscribeConfig((c) => setCfg(c));
  }, []);
  return (
    <h1 className="text-xl font-semibold text-ice-100">
      <span className="text-gray-500 mr-2">Step {id}.</span>{applyConfig(title, cfg)}
    </h1>
  );
}

function inlineFmt(s: string): string {
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-ink-700/80 text-ice-100 font-mono text-[0.85em]">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-gray-100">$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
}

// Render the expect string: blank-line-separated paragraphs, "- " bullet lists,
// inline **bold** / *em* / `code`. Plain single-sentence expects (most steps)
// collapse to one <p>, so this is a no-op for them.
function renderExpect(text: string): string {
  let html = "";
  let inList = false;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { html += `<p>${inlineFmt(para.join(" "))}</p>`; para = []; }
  };
  for (const raw of text.split("\n")) {
    const ln = raw.trim();
    if (!ln) { flushPara(); if (inList) { html += "</ul>"; inList = false; } continue; }
    if (ln.startsWith("- ")) {
      flushPara();
      if (!inList) { html += '<ul class="list-disc pl-5 space-y-1">'; inList = true; }
      html += `<li>${inlineFmt(ln.slice(2))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      para.push(ln);
    }
  }
  flushPara();
  if (inList) html += "</ul>";
  return html;
}

export function StepExpect({ text }: { text: string }) {
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    setCfg(loadConfig());
    return subscribeConfig((c) => setCfg(c));
  }, []);
  return (
    <div
      className="text-gray-200 leading-relaxed space-y-2"
      dangerouslySetInnerHTML={{ __html: renderExpect(applyConfig(text, cfg)) }}
    />
  );
}
