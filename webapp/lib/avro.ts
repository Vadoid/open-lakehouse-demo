// Thin wrappers over `avsc` for reading Iceberg manifest-list and manifest
// Avro Object Container Files. We don't bundle schemas — the OCF header
// carries them. avsc's BlockDecoder stream emits decoded objects.
//
// Iceberg uses Avro `long` (int64) for snapshot_id, sequence_number, file
// counters, etc. Snapshot IDs routinely exceed 2^53 (e.g.
// 7681222630352526051), so avsc's default LongType._read — which throws
// `potential precision loss` — is unusable. We monkey-patch the prototype
// to read longs as BigInt via a raw varint decoder that bypasses the
// upstream Number-based path. jsonable() then stringifies BigInts so the
// route's JSON response stays valid.

import { Readable } from "node:stream";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const avro: any = require("avsc");

// Raw zig-zag varint reader against avsc's Tap (Node Buffer-backed).
// Returns Number when within Number.MAX_SAFE_INTEGER, otherwise BigInt.
// Mirrors the wire format used by Tap.readLong. avsc's BlockDecoder uses
// the return value of tap.readLong() in arithmetic (block item counts,
// offsets) — those are small enough to stay in Number range, so we don't
// break the upstream code path. Only true int64 payload values (snapshot
// IDs, large counters) widen to BigInt.
function readLongSafe(this: any): number | bigint {
  const buf = this.buf;
  let pos = this.pos;
  let shift = 0n;
  let result = 0n;
  let b: number;
  do {
    b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    shift += 7n;
  } while (b & 0x80);
  this.pos = pos;
  const neg = (result & 1n) === 1n;
  const mag = result >> 1n;
  const big = neg ? -(mag + 1n) : mag;
  // Stay in Number when safe — keeps avsc's internal arithmetic happy.
  if (big >= -9007199254740991n && big <= 9007199254740991n) return Number(big);
  return big;
}

let patched = false;
function patchLongType() {
  if (patched) return;
  const LongType = avro.types.LongType;
  LongType.prototype._read = function (tap: any) {
    return readLongSafe.call(tap);
  };
  // _check / _write don't run on read-only decode, but make them BigInt-safe
  // anyway so jsonable() and any downstream introspection don't crash.
  LongType.prototype._check = function (val: any) {
    return typeof val === "bigint" || (typeof val === "number" && Number.isInteger(val));
  };
  patched = true;
}
patchLongType();

async function decodeOcf(buf: Buffer | Uint8Array): Promise<any[]> {
  const decoder = new avro.streams.BlockDecoder();
  const src = Readable.from(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  return await new Promise((resolve, reject) => {
    const out: any[] = [];
    src.pipe(decoder)
      .on("data", (rec: any) => out.push(rec))
      .on("end", () => resolve(out))
      .on("error", reject);
  });
}

// Convert avsc-decoded values (BigInt, Buffers) into JSON-safe shapes.
function jsonable(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return v.toString("base64");
  if (Array.isArray(v)) return v.map(jsonable);
  if (typeof v === "object") {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = jsonable(v[k]);
    return o;
  }
  return v;
}

function num(v: any): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return 0;
}

function str(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

export type ManifestListEntry = {
  manifestPath: string;
  content: number; // 0 = data, 1 = deletes
  partitionSpecId?: number;
  addedDataFiles?: number;
  existingDataFiles?: number;
  deletedDataFiles?: number;
  addedRows?: number;
  raw: any;
};

export async function readManifestList(buf: Buffer | Uint8Array): Promise<ManifestListEntry[]> {
  const recs = await decodeOcf(buf);
  return recs.map((r) => ({
    manifestPath: r.manifest_path,
    content: num(r.content ?? 0),
    partitionSpecId: num(r.partition_spec_id),
    addedDataFiles: num(r.added_data_files_count ?? r.added_files_count ?? 0),
    existingDataFiles: num(r.existing_data_files_count ?? r.existing_files_count ?? 0),
    deletedDataFiles: num(r.deleted_data_files_count ?? r.deleted_files_count ?? 0),
    addedRows: num(r.added_rows_count ?? 0),
    raw: jsonable(r),
  }));
}

export type ManifestEntry = {
  status: number; // 0 = EXISTING, 1 = ADDED, 2 = DELETED
  filePath: string;
  fileFormat: string;
  content: number; // 0 = data, 1 = position-delete, 2 = equality-delete
  recordCount: number;
  fileSizeInBytes: number;
  partition?: any;
  referencedDataFile?: string;
  raw: any;
};

export async function readManifest(buf: Buffer | Uint8Array): Promise<ManifestEntry[]> {
  const recs = await decodeOcf(buf);
  return recs.map((r) => {
    const df = r.data_file ?? r;
    return {
      status: num(r.status ?? 1),
      filePath: df.file_path,
      fileFormat: String(df.file_format ?? "").toLowerCase(),
      content: num(df.content ?? 0),
      recordCount: num(df.record_count ?? 0),
      fileSizeInBytes: num(df.file_size_in_bytes ?? 0),
      partition: jsonable(df.partition),
      referencedDataFile: str(df.referenced_data_file),
      raw: jsonable(r),
    };
  });
}
