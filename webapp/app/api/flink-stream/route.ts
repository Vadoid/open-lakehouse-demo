import { NextResponse } from "next/server";
import { arm, disarm, isArmed } from "@/lib/flinkFlag";

export const dynamic = "force-dynamic";

// Control endpoint for the step-19 "Start / Stop streaming" button. The stream
// does NOT run on deploy — it starts only when this route arms the shared flag
// the flink-jobmanager supervisor watches (see lib/flinkFlag + main.tf).
//
//   POST {action:"start"} -> write the flag; supervisor submits within ~3s.
//   POST {action:"stop"}  -> remove the flag AND best-effort cancel the running
//                            job via the Flink REST API so the count stops now.
const FLINK_URL = process.env.FLINK_URL || "http://flink-jobmanager:8081";
const TERMINAL = ["FAILED", "FINISHED", "CANCELED"];

export async function POST(req: Request) {
  if (process.env.FLINK_ENABLED !== "1") {
    return NextResponse.json({ error: "Flink engine not deployed" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({} as any));
  const action = body?.action;

  if (action === "start") {
    arm();
    return NextResponse.json({ armed: true });
  }

  if (action === "stop") {
    disarm();
    // Best-effort: cancel any live job so the stream halts immediately instead
    // of waiting for the supervisor. Failure here is non-fatal — the flag is
    // already cleared, so the supervisor won't resubmit.
    try {
      const r = await fetch(`${FLINK_URL}/jobs`, { cache: "no-store" });
      const j = await r.json();
      const jobs: Array<{ id: string; status: string }> = Array.isArray(j?.jobs) ? j.jobs : [];
      await Promise.all(
        jobs
          .filter((x) => !TERMINAL.includes(x.status))
          .map((x) =>
            fetch(`${FLINK_URL}/jobs/${x.id}?mode=cancel`, { method: "PATCH" }).catch(() => {})
          )
      );
    } catch {
      /* JM unreachable — flag is cleared, job will drain on its own */
    }
    return NextResponse.json({ armed: false });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({
    enabled: process.env.FLINK_ENABLED === "1",
    armed: isArmed(),
  });
}
