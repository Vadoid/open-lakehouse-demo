import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/cache";

export const dynamic = "force-dynamic";

// GET /api/cached?stepId=N — return last run result (no re-execute).
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("stepId"));
  const run = getRun(id);
  if (!run) return NextResponse.json({ cached: false });
  return NextResponse.json({
    cached: true,
    ranAt: run.ranAt,
    durationMs: run.durationMs,
    rowSets: run.rowSets,
    error: run.error,
  });
}
