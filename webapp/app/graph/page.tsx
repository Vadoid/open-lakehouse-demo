import Link from "next/link";
import LineageGraph from "@/components/UnderHood/LineageGraph";
import { listNamespaces, listTables } from "@/lib/lakekeeper";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  let entries: { ns: string[]; tables: string[] }[] = [];
  let err: string | null = null;
  try {
    const namespaces = await listNamespaces();
    entries = await Promise.all(
      namespaces.map(async (ns) => ({ ns, tables: await listTables(ns) })),
    );
  } catch (e: any) {
    err = e?.message ?? String(e);
  }

  const flat = entries.flatMap((e) => e.tables.map((t) => ({ ns: e.ns, table: t })));

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ice-100 mb-1">Iceberg lineage explorer</h1>
          <p className="text-sm text-gray-400">
            Every table in the catalog. Each section walks <code>catalog → metadata.json → manifest-list → manifest → data + delete</code>.
            Solid arrows are pointer references; dashed lines mark a deletion vector shadowing the data file it covers.
          </p>
        </div>
        <Link href="/" className="text-sm text-ice-400 hover:text-ice-200">← welcome</Link>
      </header>

      {err && <div className="text-red-400 text-sm font-mono mb-4">{err}</div>}
      {flat.length === 0 && !err && (
        <div className="text-gray-500 italic">No tables registered yet. Run section 1 first.</div>
      )}

      {flat.length > 0 && (
        <nav className="mb-6 text-sm flex flex-wrap gap-2">
          {flat.map(({ ns, table }) => (
            <a key={`${ns.join(".")}.${table}`} href={`#${table}`}
               className="px-2 py-1 rounded border border-ink-700 bg-ink-900/40 text-ice-300 hover:text-ice-100">
              {ns.join(".")}.{table}
            </a>
          ))}
        </nav>
      )}

      <div className="space-y-8">
        {flat.map(({ ns, table }) => (
          <section key={`${ns.join(".")}.${table}`} id={table}>
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-2">
              {ns.join(".")}.<span className="text-ice-200">{table}</span>
            </h2>
            <LineageGraph table={table} />
          </section>
        ))}
      </div>
    </div>
  );
}
