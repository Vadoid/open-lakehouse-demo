import { NextRequest, NextResponse } from "next/server";
import { listAll } from "@/lib/s3";
import { cache, diffSnapshots } from "@/lib/cache";

export const dynamic = "force-dynamic";

// GET /api/minio?prefix=demo/market/trades_v3/&diffStep=3
//
// `diffStep` (optional): compare current listing vs the snapshot taken BEFORE
// step N ran — files added/changed/removed in that step are highlighted.

export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get("prefix") ?? "demo/";
  const diffStep = req.nextUrl.searchParams.get("diffStep");

  const snap = await listAll(prefix);

  let diff: Record<string, string> | undefined;
  let baseline: "pre-step" | "previous-listing" | undefined;
  if (diffStep) {
    const run = cache.runs[Number(diffStep)];
    if (run?.filesBefore) {
      diff = diffSnapshots(run.filesBefore, snap);
      baseline = "pre-step";
    }
  }

  return NextResponse.json({
    prefix,
    count: Object.keys(snap.files).length,
    files: Object.entries(snap.files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, m]) => ({ key, ...m, status: diff?.[key] ?? "same" })),
    diff: diff ? { baseline } : undefined,
  });
}
