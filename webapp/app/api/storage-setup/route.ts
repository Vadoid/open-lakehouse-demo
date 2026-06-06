import { NextRequest, NextResponse } from "next/server";
import { cache } from "@/lib/cache";
import { resetPrefixCache } from "@/lib/lakekeeper";
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

    // 1. Resolve the warehouse ID (prefix) before deleting it
    let warehouseId = "";
    try {
      const configRes = await fetch(`${LK_URL}/catalog/v1/config?warehouse=${WAREHOUSE}`, {
        headers: { Authorization: "Bearer dummy" },
        cache: "no-store",
      });
      if (configRes.ok) {
        const configJson = await configRes.json();
        warehouseId = configJson.defaults?.prefix ?? configJson.overrides?.prefix ?? "";
      }
    } catch (err) {
      console.warn("Could not resolve prefix for deletion:", err);
    }

    // 2. Delete the warehouse using its resolved UUID
    if (warehouseId) {
      try {
        const headers = { Authorization: "Bearer dummy" };
        
        // a. List namespaces
        const nsRes = await fetch(`${LK_URL}/catalog/v1/${warehouseId}/namespaces`, { headers });
        if (nsRes.ok) {
          const nsJson = await nsRes.json();
          const namespaces: string[][] = nsJson.namespaces || [];
          
          for (const ns of namespaces) {
            const encNs = ns.map(encodeURIComponent).join("%1F");
            
            // b. List tables in namespace
            const tablesRes = await fetch(`${LK_URL}/catalog/v1/${warehouseId}/namespaces/${encNs}/tables`, { headers });
            if (tablesRes.ok) {
              const tablesJson = await tablesRes.json();
              const identifiers = tablesJson.identifiers || [];
              for (const tbl of identifiers) {
                const encTbl = encodeURIComponent(tbl.name);
                // c. Delete table
                await fetch(`${LK_URL}/catalog/v1/${warehouseId}/namespaces/${encNs}/tables/${encTbl}`, {
                  method: "DELETE",
                  headers,
                });
              }
            }
            
            // d. Delete namespace
            await fetch(`${LK_URL}/catalog/v1/${warehouseId}/namespaces/${encNs}`, {
              method: "DELETE",
              headers,
            });
          }
        }

        // e. Finally delete the warehouse
        const delRes = await fetch(`${LK_URL}/management/v1/warehouse/${warehouseId}`, {
          method: "DELETE",
        });
        if (!delRes.ok) {
          const delText = await delRes.text();
          return NextResponse.json({
            error: `DELETE warehouse ${warehouseId} failed (status ${delRes.status}): ${delText}`
          }, { status: 500 });
        }
      } catch (err: any) {
        return NextResponse.json({
          error: `Could not clean up old warehouse from Lakekeeper: ${err.message}`
        }, { status: 500 });
      }
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
        try {
          payload["storage-credential"] = {
            type: "gcs",
            "credential-type": "service-account-key",
            key: JSON.parse(gcsKey),
          };
        } catch (parseErr: any) {
          return NextResponse.json({ error: `Invalid GCS Service Account JSON: ${parseErr.message}` }, { status: 400 });
        }
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
    resetPrefixCache(); // New warehouse → new UUID prefix; drop the stale memo

    return NextResponse.json({ success: true, prefix });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
