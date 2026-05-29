import { tableKeyPrefix } from "./lakekeeper";
import type { Step } from "./steps";

// Server-only. Resolves Step.inspect.minio into the actual S3 key prefix.
// Lakekeeper writes under <warehouse-root>/<wh-uuid>/<table-uuid>/, so the prefix
// for a named table is not derivable without asking the catalog.
export async function resolveStepPrefix(step: Step): Promise<string> {
  const m = step.inspect.minio;
  if (!m) return "demo/";
  if (m.raw) return m.raw;
  if (m.table) {
    const base = await tableKeyPrefix(["market"], m.table);
    if (base) return `${base}${m.subpath ?? ""}`;
  }
  return "demo/";
}
