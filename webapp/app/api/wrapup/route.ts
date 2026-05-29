import { NextResponse } from "next/server";
import { runOnce } from "@/lib/thrift";
import { listAll } from "@/lib/s3";
import { listNamespaces, listTables, loadTable } from "@/lib/lakekeeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function safeRun(sql: string): Promise<{ columns: string[]; data: any[][] } | null> {
  try { return await runOnce(sql); } catch { return null; }
}

export async function GET() {
  const out: any = { tables: [], totals: {}, errors: [] as string[] };

  try {
    const namespaces = await listNamespaces();
    for (const ns of namespaces) {
      const tables = await listTables(ns);
      for (const t of tables) {
        const fqn = `demo.${ns.join(".")}.${t}`;
        const snaps = await safeRun(`SELECT count(*) FROM ${fqn}.snapshots`);
        const meta = await loadTable(ns, t).catch(() => null);
        const schemaCols = (meta?.metadata?.schemas?.find?.((s: any) => s["schema-id"] === meta?.metadata?.["current-schema-id"])?.fields ?? []).length;
        out.tables.push({
          ns: ns.join("."),
          table: t,
          snapshots: Number(snaps?.data?.[0]?.[0] ?? 0),
          formatVersion: meta?.metadata?.["format-version"],
          columns: schemaCols,
        });
      }
    }
  } catch (e: any) { out.errors.push(`catalog: ${e?.message ?? e}`); }

  // Puffin vs positional delete counts across the warehouse — quick lakehouse-wide tally.
  try {
    const dv = await safeRun(`
      SELECT
        sum(CASE WHEN file_format='puffin' THEN 1 ELSE 0 END) AS puffin,
        sum(CASE WHEN file_format='parquet' THEN 1 ELSE 0 END) AS parquet
      FROM (
        SELECT file_format FROM demo.market.trades_v3.delete_files
        UNION ALL SELECT file_format FROM demo.market.trades_v2.delete_files
      )
    `);
    if (dv?.data?.[0]) {
      out.totals.puffinDvs = Number(dv.data[0][0] ?? 0);
      out.totals.positionalDeletes = Number(dv.data[0][1] ?? 0);
    }
  } catch { /* tolerate — v2 may not exist */ }

  // Total bytes in MinIO under demo/.
  try {
    const snap = await listAll("demo/");
    let bytes = 0, objects = 0;
    for (const k of Object.keys(snap.files)) { bytes += snap.files[k].size; objects++; }
    out.totals.minioObjects = objects;
    out.totals.minioBytes = bytes;
  } catch (e: any) { out.errors.push(`s3: ${e?.message ?? e}`); }

  return NextResponse.json(out);
}
