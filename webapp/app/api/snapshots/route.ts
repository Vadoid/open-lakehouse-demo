import { NextRequest, NextResponse } from "next/server";
import { runOnce } from "@/lib/thrift";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table") ?? "trades_v3";
  const sql = `
    SELECT committed_at, snapshot_id, operation,
           summary['total-data-files']   AS data_files,
           summary['total-delete-files'] AS delete_files,
           summary['total-records']      AS rows
    FROM demo.market.${table}.snapshots
    ORDER BY committed_at
  `;
  try {
    const { columns, data } = await runOnce(sql);
    return NextResponse.json({ table, columns, data });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Step cards render before the table has been created. Treat
    // "missing table" as an empty timeline, not a hard error.
    if (/TABLE_OR_VIEW_NOT_FOUND|cannot be found|NoSuchTable/i.test(msg)) {
      return NextResponse.json({ table, columns: [], data: [], missing: true });
    }
    return NextResponse.json({ table, error: msg }, { status: 500 });
  }
}
