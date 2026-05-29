import { NextResponse } from "next/server";
import { runOnce } from "@/lib/thrift";
import { listNamespaces, listTables } from "@/lib/lakekeeper";
import { s3, BUCKET } from "@/lib/s3";
import { cache } from "@/lib/cache";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/reset
// → drop every table + non-default namespace via Spark, then purge any leftover
//   S3 keys under the warehouse bucket, then clear the in-memory step cache.
export async function POST() {
  const log: string[] = [];
  const errors: string[] = [];

  try {
    const namespaces = await listNamespaces();
    for (const ns of namespaces) {
      const tables = await listTables(ns);
      for (const t of tables) {
        const fqn = [...ns, t].map((s) => `\`${s}\``).join(".");
        try {
          await runOnce(`DROP TABLE IF EXISTS demo.${fqn}`);
          log.push(`dropped table demo.${fqn}`);
        } catch (e: any) {
          errors.push(`drop table demo.${fqn}: ${e?.message ?? e}`);
        }
      }
      if (ns.length === 1 && ns[0] === "default") continue;
      const nsName = ns.map((s) => `\`${s}\``).join(".");
      try {
        await runOnce(`DROP NAMESPACE IF EXISTS demo.${nsName} CASCADE`);
        log.push(`dropped namespace demo.${nsName}`);
      } catch (e: any) {
        errors.push(`drop namespace demo.${nsName}: ${e?.message ?? e}`);
      }
    }
  } catch (e: any) {
    errors.push(`catalog walk: ${e?.message ?? e}`);
  }

  try {
    let token: string | undefined;
    let purged = 0;
    do {
      const list = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }),
      );
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((k) => k.Key);
      if (keys.length) {
        await s3.send(
          new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys, Quiet: true } }),
        );
        purged += keys.length;
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    log.push(`purged ${purged} S3 objects from bucket ${BUCKET}`);
  } catch (e: any) {
    errors.push(`s3 purge: ${e?.message ?? e}`);
  }

  cache.runs = {};
  cache.lastSeenFiles = undefined;
  log.push("cleared in-memory step cache");

  return NextResponse.json({ ok: errors.length === 0, log, errors });
}
