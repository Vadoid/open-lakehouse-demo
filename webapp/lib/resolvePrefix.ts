import { tableKeyPrefix } from "./lakekeeper";
import { warehouseRootPrefix } from "./storage";
import { hydrateStorageConfig } from "./configPersist";
import { cache } from "./cache";
import type { Step } from "./steps";

// Server-only. Resolves Step.inspect.minio into the actual object-store key
// prefix, the same way for every step and for both MinIO and GCS:
//   - a named table  -> that table's prefix from the catalog (+ optional subpath)
//   - anything else   -> the warehouse root ("demo/" on MinIO, bucket root on GCS)
// Lakekeeper writes under <warehouse-root>/<wh-uuid>/<table-uuid>/, so a table's
// prefix isn't derivable without asking the catalog.
export async function resolveStepPrefix(step: Step): Promise<string> {
  hydrateStorageConfig(cache);
  const table = step.inspect.minio?.table;
  if (table) {
    const base = await tableKeyPrefix(["market"], table);
    if (base) return `${base}${step.inspect.minio?.subpath ?? ""}`;
  }
  return warehouseRootPrefix();
}
