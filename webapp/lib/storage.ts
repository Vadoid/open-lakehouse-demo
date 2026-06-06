import type { FileSnapshot } from "./cache";
import { cache } from "./cache";
import { listAll } from "./s3";

// Storage-aware object listing. Dispatches to MinIO (S3) or GCS based on the
// active storage config, so every route lists the backend the warehouse is
// actually registered against instead of always hitting MinIO.
export async function listStorage(prefix: string): Promise<FileSnapshot> {
  const cfg = cache.storageConfig;
  if (cfg && cfg.type === "gcs") {
    const { listAllGcs } = await import("./gcs");
    return listAllGcs(cfg.bucket, prefix, cfg.gcsKey);
  }
  return listAll(prefix);
}

// Root key prefix covering "everything in this warehouse". MinIO registers
// key-prefix "demo"; GCS has no key-prefix, so its root is the bucket root.
export function warehouseRootPrefix(): string {
  const cfg = cache.storageConfig;
  return cfg && cfg.type === "gcs" ? "" : "demo/";
}
