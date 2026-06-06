import { Storage } from "@google-cloud/storage";
import type { FileSnapshot } from "./cache";

export async function listAllGcs(bucketName: string, prefix: string, serviceAccountJson?: string): Promise<FileSnapshot> {
  const options: any = {};
  if (serviceAccountJson) {
    try {
      options.credentials = JSON.parse(serviceAccountJson);
    } catch (e) {
      console.error("Invalid GCS service account JSON key:", e);
    }
  }

  const storage = new Storage(options);
  const out: FileSnapshot = { files: {} };

  try {
    const [files] = await storage.bucket(bucketName).getFiles({
      prefix,
    });

    for (const f of files) {
      out.files[f.name] = {
        size: Number(f.metadata.size ?? 0),
        etag: f.metadata.etag ?? "",
        lastModified: f.metadata.updated ?? "",
      };
    }
  } catch (e) {
    console.error("Failed to list files from GCS bucket:", e);
  }

  return out;
}

export async function getGcsObjectBuffer(bucketName: string, key: string, serviceAccountJson?: string): Promise<Buffer> {
  const options: any = {};
  if (serviceAccountJson) {
    try {
      options.credentials = JSON.parse(serviceAccountJson);
    } catch (e) {
      console.error("Invalid GCS service account JSON key:", e);
    }
  }
  const storage = new Storage(options);
  const [contents] = await storage.bucket(bucketName).file(key).download();
  return contents;
}
