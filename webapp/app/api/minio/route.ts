import { NextRequest, NextResponse } from "next/server";
import { listStorage } from "@/lib/storage";
import { cache, diffSnapshots, FileSnapshot } from "@/lib/cache";
import { resolveStepPrefix } from "@/lib/resolvePrefix";
import { stepById } from "@/lib/steps";

export const dynamic = "force-dynamic";

// GET /api/minio?step=1&diffStep=3   (or &prefix=demo/market/trades_v3/)
//
// `step` (optional): resolve the table prefix server-side, fresh on every
// request. Table-creating steps don't have a prefix until the step runs, so
// resolving here (not at page render) lets the tree fill after a Run without a
// reload.
// `diffStep` (optional): compare current listing vs the snapshot taken BEFORE
// step N ran — files added/changed/removed in that step are highlighted.

export async function GET(req: NextRequest) {
  let prefix = req.nextUrl.searchParams.get("prefix") ?? "demo/";
  const stepParam = req.nextUrl.searchParams.get("step");
  const diffStep = req.nextUrl.searchParams.get("diffStep");

  if (stepParam) {
    const step = stepById(Number(stepParam));
    if (step) prefix = await resolveStepPrefix(step).catch(() => prefix);
  }

  const snap: FileSnapshot = await listStorage(prefix);

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
