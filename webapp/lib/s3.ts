import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { FileSnapshot } from "./cache";

const endpoint = process.env.MINIO_ENDPOINT ?? "http://lake-minio:9000";
const accessKeyId = process.env.MINIO_ACCESS_KEY ?? "minio-admin";
const secretAccessKey = process.env.MINIO_SECRET_KEY ?? "minio-admin-password";
export const BUCKET = process.env.MINIO_BUCKET ?? "warehouse";

export const s3 = new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

export async function listAll(prefix: string): Promise<FileSnapshot> {
  const out: FileSnapshot = { files: {} };
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of r.Contents ?? []) {
      if (!o.Key) continue;
      out.files[o.Key] = {
        size: o.Size ?? 0,
        etag: o.ETag ?? "",
        lastModified: o.LastModified?.toISOString() ?? "",
      };
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function head(key: string) {
  return s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
}
