"use client";
import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { STEPS } from "@/lib/steps";
import { applyConfig, DEFAULT_CONFIG, DemoConfig, loadConfig, subscribeConfig } from "@/lib/demoConfig";

export default function StepRail() {
  const path = usePathname();
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  // Fetch completed steps from cache
  const fetchCompletedSteps = useCallback(async () => {
    try {
      const r = await fetch("/api/runs", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        setCompletedSteps(j.completed ?? []);
      }
    } catch (e) {
      console.error("Failed to fetch completed steps:", e);
    }
  }, []);

  useEffect(() => {
    setCfg(loadConfig());
    const unsub = subscribeConfig((c) => setCfg(c));

    fetchCompletedSteps();

    // Listen to step-ran event to refresh completed steps
    const handleStepRan = () => {
      fetchCompletedSteps();
    };
    window.addEventListener("ic:step-ran", handleStepRan);

    return () => {
      unsub();
      window.removeEventListener("ic:step-ran", handleStepRan);
    };
  }, [fetchCompletedSteps]);

  // Calculate progress percentage
  const totalDemoSteps = STEPS.filter(s => !s.wrapup).length;
  const completedDemoSteps = STEPS.filter(s => !s.wrapup && completedSteps.includes(s.id)).length;
  const percent = totalDemoSteps > 0 ? (completedDemoSteps / totalDemoSteps) * 100 : 0;

  return (
    <nav className="w-64 border-r border-ink-700/60 bg-ink-900/30 py-5 px-3 shrink-0 flex flex-col h-full overflow-hidden select-none">
      {/* Progress Tracker Card */}
      <div className="mb-5 p-3 rounded-lg border border-ink-700 bg-ink-900/60 shadow-sm backdrop-blur-md">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          <span>Demo Completion</span>
          <span className="font-mono text-ice-300">{Math.round(percent)}%</span>
        </div>
        <div className="w-full h-1.5 bg-ink-800 rounded-full overflow-hidden border border-ink-700/50">
          <div
            className="h-full bg-gradient-to-r from-ice-600 to-ice-400 transition-all duration-700 ease-out shadow-[0_0_8px_rgba(59,130,246,0.5)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="text-[10px] text-gray-500 mt-1.5 flex justify-between">
          <span>{completedDemoSteps} of {totalDemoSteps} steps run</span>
          {percent === 100 && <span className="text-emerald-400 font-medium">Completed! 🎉</span>}
        </div>
      </div>

      {/* Stepper list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin relative pr-1">
        {/* Continuous stepper vertical line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-ink-700/40" />

        <ol className="space-y-2.5 relative">
          {STEPS.map((s) => {
            const active = path === `/step/${s.id}`;
            const completed = completedSteps.includes(s.id);
            const title = applyConfig(s.title, cfg);

            return (
              <li key={s.id}>
                <Link
                  href={`/step/${s.id}`}
                  className={`group flex items-start gap-3 rounded-md px-2 py-1.5 text-xs transition duration-200 ${
                    active
                      ? "bg-ice-500/10 border border-ice-500/30 text-ice-100 shadow-[0_2px_10px_rgba(59,130,246,0.05)]"
                      : "text-gray-400 border border-transparent hover:bg-ink-800/40 hover:text-gray-100 hover:border-ink-700/30"
                  }`}
                >
                  {/* Step status node indicator */}
                  <div className="relative flex-none flex items-center justify-center w-6 h-6 z-10">
                    {completed ? (
                      // Completed checkmark indicator
                      <div className="w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500 flex items-center justify-center shadow-[0_0_6px_rgba(16,185,129,0.3)]">
                        <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : active ? (
                      // Active pulsing indicator
                      <div className="relative w-4.5 h-4.5 flex items-center justify-center">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-ice-500/45 animate-ping opacity-60"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-ice-400 shadow-[0_0_8px_rgb(96,165,250)]"></span>
                      </div>
                    ) : (
                      // Upcoming standard number indicator
                      <div className="w-4.5 h-4.5 rounded-full bg-ink-800 border border-ink-700 text-[10px] text-gray-500 flex items-center justify-center font-mono group-hover:border-gray-500 transition-colors">
                        {s.id}
                      </div>
                    )}
                  </div>

                  {/* Step Name */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className={`font-medium leading-normal truncate ${active ? "text-ice-200" : "group-hover:text-gray-200"}`}>
                      {title}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
