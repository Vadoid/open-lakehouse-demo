import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { FileSnapshot } from "./cache";
import { cache } from "./cache";
import { listAll, s3, BUCKET } from "./s3";
import { hydrateStorageConfig } from "./configPersist";

// Storage-aware object listing. Dispatches to MinIO (S3) or GCS based on the
// active storage config, so every route lists the backend the warehouse is
// actually registered against instead of always hitting MinIO.
export async function listStorage(prefix: string): Promise<FileSnapshot> {
  hydrateStorageConfig(cache);
  const cfg = cache.storageConfig;
  if (cfg && cfg.type === "gcs") {
    const { listAllGcs } = await import("./gcs");
    return listAllGcs(cfg.bucket, prefix, cfg.gcsKey);
  }
  return listAll(prefix);
}

// Storage-aware object download. Returns the raw bytes for a bucket-relative
// key from whichever backend the warehouse uses. Used to read avro/puffin
// content (manifests, manifest lists) for the lineage graph.
export async function getObjectBuffer(key: string): Promise<Buffer> {
  hydrateStorageConfig(cache);
  const cfg = cache.storageConfig;
  if (cfg && cfg.type === "gcs") {
    const { getGcsObjectBuffer } = await import("./gcs");
    return getGcsObjectBuffer(cfg.bucket, key, cfg.gcsKey);
  }
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = r.Body as any;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

// Root key prefix covering "everything in this warehouse". MinIO registers
// key-prefix "demo"; GCS has no key-prefix, so its root is the bucket root.
export function warehouseRootPrefix(): string {
  const cfg = cache.storageConfig;
  return cfg && cfg.type === "gcs" ? "" : "demo/";
}
