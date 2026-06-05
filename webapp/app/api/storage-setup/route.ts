import { NextRequest, NextResponse } from "next/server";
import { cache } from "@/lib/cache";
const LK_URL = process.env.LAKEKEEPER_URL ?? "http://lakekeeper:8181";
const WAREHOUSE = process.env.LAKEKEEPER_WAREHOUSE ?? "demo";

export const dynamic = "force-dynamic";

function getDeterministicBucketName() {
  const suffix = process.env.HOST_SUFFIX || "default";
  return `open-lakehouse-${suffix}`;
}

export async function GET() {
  const cfg = cache.storageConfig ?? { type: "minio", bucket: "warehouse" };
  const defaultGcsBucket = getDeterministicBucketName();
  const hostSuffix = process.env.HOST_SUFFIX || "default";
  
  let projectId = "";
  if (cfg.gcsKey) {
    try {
      projectId = JSON.parse(cfg.gcsKey).project_id || "";
    } catch {}
  }

  return NextResponse.json({
    type: cfg.type,
    bucket: cfg.bucket || defaultGcsBucket,
    hasKey: !!cfg.gcsKey,
    isCustomBucket: !!cfg.isCustomBucket,
    defaultGcsBucket,
    hostSuffix,
    projectId,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, bucket, gcsKey, isCustomBucket } = body as {
      type: "minio" | "gcs";
      bucket: string;
      gcsKey?: string;
      isCustomBucket?: boolean;
    };

    if (!type || !bucket) {
      return NextResponse.json({ error: "Missing type or bucket parameters" }, { status: 400 });
    }

    // 1. Delete current warehouse from Lakekeeper catalog (ignore errors if it doesn't exist)
    try {
      await fetch(`${LK_URL}/management/v1/warehouse/${WAREHOUSE}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("Could not delete old warehouse from Lakekeeper:", err);
    }

    // 2. Register the new warehouse with Lakekeeper catalog
    let payload: any;
    if (type === "gcs") {
      payload = {
        "warehouse-name": WAREHOUSE,
        "storage-profile": {
          type: "gcs",
          bucket: bucket,
        },
      };
      if (gcsKey) {
        payload["storage-credential"] = {
          type: "gcs",
          "credential-type": "service-account-key",
          "service-account-key": gcsKey,
        };
      }
    } else {
      // MinIO fallback
      payload = {
        "warehouse-name": WAREHOUSE,
        "storage-profile": {
          type: "s3",
          bucket: bucket,
          "key-prefix": "demo",
          endpoint: process.env.MINIO_ENDPOINT ?? "http://lake-minio:9000",
          region: "us-east-1",
          "path-style-access": true,
          flavor: "s3-compat",
          "sts-enabled": false,
        },
        "storage-credential": {
          type: "s3",
          "credential-type": "access-key",
          "aws-access-key-id": process.env.MINIO_ACCESS_KEY ?? "admin",
          "aws-secret-access-key": process.env.MINIO_SECRET_KEY ?? "password",
        },
      };
    }

    const regRes = await fetch(`${LK_URL}/management/v1/warehouse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!regRes.ok) {
      const errMsg = await regRes.text();
      return NextResponse.json({ error: `Lakekeeper registration failed: ${errMsg}` }, { status: regRes.status });
    }

    // 3. Retrieve new warehouse prefix and create default namespace
    let prefix = "";
    for (let i = 0; i < 10; i++) {
      try {
        const configRes = await fetch(`${LK_URL}/catalog/v1/config?warehouse=${WAREHOUSE}`, {
          headers: { Authorization: "Bearer dummy" },
          cache: "no-store",
        });
        if (configRes.ok) {
          const configJson = await configRes.json();
          prefix = configJson.defaults?.prefix ?? configJson.overrides?.prefix ?? "";
          if (prefix) break;
        }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!prefix) {
      return NextResponse.json({ error: "Could not resolve warehouse catalog prefix" }, { status: 500 });
    }

    // Create default namespace
    const nsRes = await fetch(`${LK_URL}/catalog/v1/${prefix}/namespaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dummy",
      },
      body: JSON.stringify({ namespace: ["default"] }),
    });

    if (!nsRes.ok) {
      const nsErr = await nsRes.text();
      console.warn("Could not create default namespace:", nsErr);
    }

    // 4. Update memory cache configurations and clear runs
    cache.storageConfig = { type, bucket, gcsKey, isCustomBucket };
    cache.runs = {}; // Reset completed steps so they run on new warehouse
    cache.lastSeenFiles = undefined;

    return NextResponse.json({ success: true, prefix });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
