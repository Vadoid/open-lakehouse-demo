"use client";
import { useEffect, useRef, useState } from "react";
import DynamicLink from "@/components/DynamicLink";

// Live interop widget for step 19. Polls /api/stream-count every few seconds and
// shows the row count of demo.market.trades_stream climbing while Flink streams
// into it — the visible proof that two engines share one Iceberg catalog
// (Flink writes, this Spark-backed read sees the growth).
//
// Three states, driven by the route's {enabled, missing} flags:
//   • !enabled         → Flink not deployed; show how to redeploy with it.
//   • enabled & missing → Flink up, but no first checkpoint committed yet.
//   • enabled & count   → streaming; show the number + delta since last poll.

type Resp = { enabled: boolean; count: number | null; missing?: boolean; error?: string };

const POLL_MS = 4000;

export default function LiveStreamCount() {
  const [resp, setResp] = useState<Resp | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const prev = useRef<number | null>(null);

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
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Flink was never deployed — point the user at the opt-in deploy path.
  if (resp && !resp.enabled) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200 leading-relaxed">
        <div className="font-semibold text-amber-400 mb-1">Flink streaming engine not enabled</div>
        <p className="mb-2">
          This step needs the optional Flink engine, which writes
          <code className="mx-1 px-1 rounded bg-ink-900/60 text-amber-100">demo.market.trades_stream</code>.
          The current deploy is Spark-only.
        </p>
        <p className="text-amber-200/80">
          Redeploy and pick <strong>Spark + Flink streaming</strong> at the menu:
        </p>
        <pre className="mt-1.5 rounded bg-ink-900/70 border border-ink-700 p-2 text-[11px] text-gray-300 overflow-x-auto">./deploy.sh        # then choose option 2
# or non-interactively:
ENABLE_FLINK=1 ./deploy.sh</pre>
      </div>
    );
  }

  const streaming = resp?.enabled && typeof resp.count === "number";

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${streaming ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`}
            aria-hidden="true"
          />
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
          Flink is up — waiting for the stream&rsquo;s first checkpoint commit
          (~10s). The Iceberg sink makes rows visible to Spark only on a
          completed checkpoint.
        </p>
      )}

      <p className="mt-2 text-[11px] text-gray-500 leading-snug">
        Polling <code className="px-1 rounded bg-ink-900/60">SELECT count(*)</code> every {POLL_MS / 1000}s.
        Flink writes; Spark reads the same table through one Lakekeeper catalog.
      </p>
    </div>
  );
}
