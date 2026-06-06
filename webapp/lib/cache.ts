// In-memory per-step result cache. Resets on container restart — fine for a demo.

export type FileSnapshot = {
  // key = S3 object key, value = etag (proxy for content change)
  files: Record<string, { size: number; etag: string; lastModified: string }>;
};

export type RowSet = { stmtIdx: number; columns: string[]; data: any[][] };

export type StepRun = {
  ranAt: string;
  durationMs: number;
  rowSets: RowSet[];
  log: string[];
  error?: string;
  filesBefore?: FileSnapshot;
  filesAfter?: FileSnapshot;
};

export type StorageConfig = {
  type: "minio" | "gcs";
  bucket: string;
  gcsKey?: string;
  isCustomBucket?: boolean;
};

type CacheShape = {
  runs: Record<number, StepRun>;
  // Most recent file listing per prefix — used for diff coloring across steps.
  lastSeenFiles?: FileSnapshot;
  storageConfig?: StorageConfig;
};

const g = globalThis as unknown as { __ic_cache?: CacheShape };
if (!g.__ic_cache) {
  g.__ic_cache = {
    runs: {},
    storageConfig: {
      type: "minio",
      bucket: process.env.MINIO_BUCKET || "warehouse",
    },
  };
}

export const cache = g.__ic_cache;

export function saveRun(stepId: number, run: StepRun) {
  cache.runs[stepId] = run;
}

export function getRun(stepId: number): StepRun | undefined {
  return cache.runs[stepId];
}

export function diffSnapshots(prev: FileSnapshot | undefined, curr: FileSnapshot) {
  const status: Record<string, "added" | "removed" | "changed" | "same"> = {};
  const prevFiles = prev?.files ?? {};
  for (const k of Object.keys(curr.files)) {
    if (!(k in prevFiles)) status[k] = "added";
    else if (prevFiles[k].etag !== curr.files[k].etag) status[k] = "changed";
    else status[k] = "same";
  }
  for (const k of Object.keys(prevFiles)) {
    if (!(k in curr.files)) status[k] = "removed";
  }
  return status;
}
