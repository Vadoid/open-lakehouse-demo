"use client";
import { useEffect, useRef, useState } from "react";
import DynamicLink from "@/components/DynamicLink";

// Live interop widget for step 19. Polls /api/stream-count every few seconds and
// shows the row count of demo.market.trades_stream climbing while Flink streams
// into it — the visible proof that two engines share one Iceberg catalog
// (Flink writes, this Spark-backed read sees the growth).
//
// States, driven by the route's {enabled, armed, missing} flags:
//   • !enabled                  → Flink not deployed; show how to redeploy.
//   • enabled & !armed          → idle; show the "Start streaming" button.
//   • enabled & armed & missing → starting; supervisor submitting / no checkpoint yet.
//   • enabled & armed & count   → streaming; number + delta + Stop button.
// The stream is user-triggered: it does nothing until the Start button POSTs
// /api/flink-stream, which arms the flag the jobmanager supervisor watches.

type Resp = { enabled: boolean; armed?: boolean; count: number | null; missing?: boolean; error?: string };

const POLL_MS = 4000;

export default function LiveStreamCount() {
  const [resp, setResp] = useState<Resp | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const prev = useRef<number | null>(null);

  const tickRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/stream-count", { cache: "no-store" });
        const j: Resp = await r.json();
        if (!alive) return;
        if (typeof j.count === "number" && prev.current != null) {
          setDelta(j.count - prev.current);
        }
        if (typeof j.count === "number") prev.current = j.count;
        setResp(j);
      } catch {
        /* transient — keep the last good value, try again next tick */
      }
    };
    tickRef.current = tick;
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Start / Stop the stream by arming/disarming the supervisor flag. Optimistic:
  // flip `armed` locally, then re-poll so the widget reflects real state fast.
  const setStreaming = async (on: boolean) => {
    setBusy(true);
    setResp((r) => (r ? { ...r, armed: on } : r));
    if (!on) { prev.current = null; setDelta(null); }
    try {
      await fetch("/api/flink-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "start" : "stop" }),
      });
    } catch {
      /* surface nothing — next poll reconciles real state */
    } finally {
      setBusy(false);
      tickRef.current();
    }
  };

  // Flink was never deployed — point the user at the opt-in deploy path.
  if (resp && !resp.enabled) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200 leading-relaxed">
        <div className="font-semibold text-amber-400 mb-1">Flink streaming engine not enabled</div>
        <p className="mb-2">
          This step needs the Flink engine, which writes
          <code className="mx-1 px-1 rounded bg-ink-900/60 text-amber-100">demo.market.trades_stream</code>.
          This deploy was started Spark-only.
        </p>
        <p className="text-amber-200/80">
          Flink ships on by default — just redeploy (or pick <strong>Spark + Flink streaming</strong> at the menu):
        </p>
        <pre className="mt-1.5 rounded bg-ink-900/70 border border-ink-700 p-2 text-[11px] text-gray-300 overflow-x-auto">./deploy.sh        # option 1 (default) includes Flink</pre>
      </div>
    );
  }

  const armed = !!resp?.armed;

  // Idle (deployed but not started): show the Start button. The stream is
  // user-triggered — nothing runs until this POSTs the supervisor flag.
  if (resp?.enabled && !armed) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-600" aria-hidden="true" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              trades_stream · Flink → Spark
            </span>
          </div>
          <DynamicLink
            port={8081}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-ice-400 hover:text-ice-300 transition"
          >
            Flink UI ↗
          </DynamicLink>
        </div>
        <button
          onClick={() => setStreaming(true)}
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition"
        >
          {busy ? "Starting…" : "▶ Start streaming"}
        </button>
        <p className="mt-2 text-[11px] text-gray-500 leading-snug">
          Flink is up but idle. Click Start and the jobmanager begins a continuous
          <code className="mx-1 px-1 rounded bg-ink-900/60">datagen → Iceberg</code>
          job. The count below climbs every checkpoint (~10s) while Spark reads the
          same table.
        </p>
      </div>
    );
  }

  const streaming = resp?.enabled && armed && typeof resp.count === "number";

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${streaming ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"}`}
            aria-hidden="true"
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            trades_stream · Flink → Spark
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStreaming(false)}
            disabled={busy}
            className="text-[11px] text-gray-500 hover:text-rose-300 disabled:opacity-50 transition"
            title="Stop the stream and cancel the Flink job"
          >
            ■ Stop
          </button>
          <DynamicLink
            port={8081}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-ice-400 hover:text-ice-300 transition"
          >
            Flink UI ↗
          </DynamicLink>
        </div>
      </div>

      {streaming ? (
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-extrabold tabular-nums text-ice-200">
            {resp!.count!.toLocaleString()}
          </span>
          <span className="text-xs text-gray-500">rows</span>
          {delta != null && delta > 0 && (
            <span className="text-xs font-semibold text-emerald-400 tabular-nums">
              ▲ +{delta.toLocaleString()} / {POLL_MS / 1000}s
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400">
          Starting the stream. The job is submitting and waiting for its first
          checkpoint (~10s); the Iceberg sink only makes rows visible to Spark on
          a completed checkpoint.
        </p>
      )}

      <p className="mt-2 text-[11px] text-gray-500 leading-snug">
        Polling <code className="px-1 rounded bg-ink-900/60">SELECT count(*)</code> every {POLL_MS / 1000}s.
        Flink writes; Spark reads the same table through one Lakekeeper catalog.
      </p>
    </div>
  );
}
