"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { STEPS } from "@/lib/steps";
import { applyConfig, DEFAULT_CONFIG, DemoConfig, loadConfig, subscribeConfig } from "@/lib/demoConfig";

export default function StepRail() {
  const path = usePathname();
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    setCfg(loadConfig());
    return subscribeConfig((c) => setCfg(c));
  }, []);
  return (
    <nav className="w-56 border-r border-ink-700 bg-ink-900/40 py-4 px-2 shrink-0">
      <ol className="space-y-1">
        {STEPS.map((s) => {
          const active = path === `/step/${s.id}`;
          const title = applyConfig(s.title, cfg);
          return (
            <li key={s.id}>
              <Link
                href={`/step/${s.id}`}
                className={`flex items-baseline gap-2 rounded px-3 py-2 text-sm transition ${
                  active
                    ? "bg-ice-500/20 text-ice-100 border-l-2 border-ice-500"
                    : "text-gray-400 hover:bg-ink-700/60 hover:text-gray-100"
                }`}
              >
                <span className="font-mono text-xs text-gray-500 w-4">{s.id}</span>
                <span className="leading-tight">{title}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
