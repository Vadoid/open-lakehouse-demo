"use client";

import { useEffect, useState } from "react";
import {
  DAY_PRESETS,
  DEFAULT_CONFIG,
  DemoConfig,
  ROW_PRESETS,
  fmtRows,
  loadConfig,
  saveConfig,
  subscribeConfig,
} from "@/lib/demoConfig";

type Variant = "welcome" | "step";

export default function DemoConfigPanel({ variant = "step" }: { variant?: Variant }) {
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    setCfg(loadConfig());
    return subscribeConfig((next) => setCfg(next));
  }, []);

  function update(next: Partial<DemoConfig>) {
    const merged: DemoConfig = { ...cfg, ...next };
    if (!Number.isFinite(merged.rows) || merged.rows < 1) merged.rows = 1;
    if (!Number.isFinite(merged.days) || merged.days < 1) merged.days = 1;
    setCfg(merged);
    saveConfig(merged);
  }

  return (
    <div
      className={`rounded border border-ink-700 bg-ink-900/40 ${
        variant === "welcome" ? "p-4" : "p-3"
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-gray-500">
          Demo size {variant === "welcome" ? "" : "(step 2 INSERT)"}
        </h3>
        <span className="text-[11px] font-mono text-ice-300">
          {fmtRows(cfg.rows)} rows · {cfg.days} days
        </span>
      </div>

      <Row
        label="ROWS"
        presets={ROW_PRESETS as readonly number[]}
        value={cfg.rows}
        fmt={fmtRows}
        onPick={(v) => update({ rows: v })}
        onCustom={(v) => update({ rows: v })}
      />
      <Row
        label="DAYS"
        presets={DAY_PRESETS as readonly number[]}
        value={cfg.days}
        fmt={(v) => String(v)}
        onPick={(v) => update({ days: v })}
        onCustom={(v) => update({ days: v })}
      />

    </div>
  );
}

function Row({
  label,
  presets,
  value,
  fmt,
  onPick,
  onCustom,
}: {
  label: string;
  presets: readonly number[];
  value: number;
  fmt: (v: number) => string;
  onPick: (v: number) => void;
  onCustom: (v: number) => void;
}) {
  const [custom, setCustom] = useState("");
  const isPreset = presets.includes(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5 my-1.5">
      <span className="text-[11px] font-mono text-gray-500 w-12">{label}</span>
      {presets.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            onClick={() => onPick(p)}
            className={`px-2 py-0.5 rounded text-[11px] font-mono border transition ${
              active
                ? "bg-ice-500/20 border-ice-500 text-ice-100"
                : "border-ink-700 text-gray-400 hover:border-ice-500/60 hover:text-ice-200"
            }`}
          >
            {fmt(p)}
          </button>
        );
      })}
      <span className="text-[10px] text-gray-600 ml-1">custom</span>
      <input
        type="number"
        min={1}
        value={custom || (isPreset ? "" : String(value))}
        onChange={(e) => setCustom(e.target.value)}
        onBlur={() => {
          const n = Number(custom);
          if (Number.isFinite(n) && n > 0) onCustom(Math.floor(n));
          setCustom("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="…"
        className="w-20 px-1.5 py-0.5 rounded bg-ink-900/60 border border-ink-700 text-[11px] font-mono text-gray-200 outline-none focus:border-ice-500/60"
      />
    </div>
  );
}
