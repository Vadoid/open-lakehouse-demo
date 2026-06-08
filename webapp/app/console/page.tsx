import Link from "next/link";
import SqlPanel from "@/components/SqlPanel";
import CatalogView from "@/components/UnderHood/CatalogView";
import MinioTree from "@/components/UnderHood/MinioTree";
import { CONSOLE_STEP } from "@/lib/steps";
import { warehouseRootPrefix } from "@/lib/storage";
import { hydrateStorageConfig } from "@/lib/configPersist";
import { cache } from "@/lib/cache";

export const dynamic = "force-dynamic";

// Free-form explorer: a SQL console plus the live catalog and object-store tree,
// untied to the guided demo steps. Lets you query anything against the same
// Spark Thrift + Lakekeeper + MinIO the demo uses.
export default function ConsolePage() {
  // Whole-warehouse root prefix (storage-aware: "demo/" on MinIO, bucket root on
  // GCS). MinioTree lists this; stepId 0 means "no step diff", just a listing.
  hydrateStorageConfig(cache);
  const rootPrefix = warehouseRootPrefix();

  return (
    <div className="p-6 flex flex-col gap-5 min-h-full">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ice-100 mb-1">SQL Console</h1>
          <p className="text-sm text-gray-400">
            Run arbitrary SQL against the demo&rsquo;s Spark Thrift Server, and
            browse the live Lakekeeper catalog and {`object store`} alongside.
            Not tied to the guided steps — query whatever you like.
          </p>
        </div>
        <Link href="/" className="text-sm text-ice-400 hover:text-ice-200 whitespace-nowrap">← welcome</Link>
      </header>

      <div className="grid grid-cols-12 gap-5">
        {/* Console (left, major width). Reuses the same SqlPanel the demo steps
            use — syntax highlighting, copy, line numbers, selection-run, SSE
            streaming — fed the synthetic CONSOLE_STEP (id 0, empty SQL). */}
        <section className="col-span-12 lg:col-span-7">
          <SqlPanel step={CONSOLE_STEP} />
        </section>

        {/* Catalog + file tree (right) */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Catalog</h2>
            <CatalogView />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Object store</h2>
            <MinioTree prefix={rootPrefix} stepId={0} hint="Whole warehouse. Refreshes after a console run." />
          </div>
        </section>
      </div>
    </div>
  );
}
