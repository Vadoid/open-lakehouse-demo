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

export function StepExpect({ text }: { text: string }) {
  const [cfg, setCfg] = useState<DemoConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    setCfg(loadConfig());
    return subscribeConfig((c) => setCfg(c));
  }, []);
  return <div className="text-gray-200">{applyConfig(text, cfg)}</div>;
}
