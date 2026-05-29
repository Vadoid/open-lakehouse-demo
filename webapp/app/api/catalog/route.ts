import { NextRequest, NextResponse } from "next/server";
import { listNamespaces, listTables, loadTable } from "@/lib/lakekeeper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  const ns = (req.nextUrl.searchParams.get("ns") ?? "market").split(".");

  try {
    if (table) {
      const meta = await loadTable(ns, table);
      return NextResponse.json({ ns, table, meta });
    }
    const namespaces = await listNamespaces();
    const tree = await Promise.all(
      namespaces.map(async (n) => ({ ns: n, tables: await listTables(n) })),
    );
    return NextResponse.json({ namespaces: tree });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
