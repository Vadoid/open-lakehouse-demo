import { notFound } from "next/navigation";
import { stepById, STEPS } from "@/lib/steps";
import SqlPanel from "@/components/SqlPanel";
import WhyPanel from "@/components/WhyPanel";
import MinioTree from "@/components/UnderHood/MinioTree";
import CatalogView from "@/components/UnderHood/CatalogView";
import SnapshotTimeline from "@/components/UnderHood/SnapshotTimeline";
import LineageGraph from "@/components/UnderHood/LineageGraph";
import WrapUp from "@/components/WrapUp";
import { resolveStepPrefix } from "@/lib/resolvePrefix";
import { StepTitle, StepExpect } from "@/components/StepTitle";

export default async function StepPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const step = stepById(Number(n));
  if (!step) notFound();
  if (step.wrapup) return <WrapUp />;

  const minioPrefix = await resolveStepPrefix(step);

  const prev = step.id > 1 ? `/step/${step.id - 1}` : null;
  const next = step.id < STEPS.length ? `/step/${step.id + 1}` : null;

  return (
    <div className="p-6 flex flex-col gap-4 min-h-full">
      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-5 flex flex-col gap-3">
          <header className="flex items-baseline justify-between">
            <StepTitle id={step.id} title={step.title} />
          </header>
          <SqlPanel step={step} />
        </section>

        <section className="col-span-3 flex flex-col gap-3">
          <h2 className="text-sm uppercase tracking-wider text-gray-500">Why this matters</h2>
          <WhyPanel markdown={step.why} />
          <div className="rounded border border-ink-700 bg-ink-800/60 p-3 text-sm">
            <div className="text-xs uppercase text-gray-500 mb-1">Expected outcome</div>
            <StepExpect text={step.expect} />
          </div>
        </section>

        <section className="col-span-4 flex flex-col gap-3">
          <h2 className="text-sm uppercase tracking-wider text-gray-500">Under the hood</h2>
          <MinioTree
            prefix={minioPrefix}
            hint={step.inspect.minio?.hint}
            stepId={step.id}
          />
          {step.inspect.catalog && (
            <CatalogView focusTable={step.inspect.catalog.table} />
          )}
          {step.inspect.snapshots && (
            <SnapshotTimeline table={step.inspect.snapshots.table} />
          )}
        </section>
      </div>

      {step.inspect.lineage && (
        <section className="flex flex-col gap-3">
          <LineageGraph table={step.inspect.lineage.table} />
        </section>
      )}

      <nav className="flex items-center justify-between border-t border-ink-700 pt-4 mt-2">
        {prev ? (
          <a
            className="px-4 py-2 rounded border border-ink-700 bg-ink-800/60 text-ice-300 hover:border-ice-500/60 hover:text-ice-100 transition"
            href={prev}
          >
            ← Step {step.id - 1}
          </a>
        ) : (
          <a
            className="px-4 py-2 rounded border border-ink-700 bg-ink-800/60 text-gray-300 hover:border-ice-500/60 hover:text-ice-100 transition"
            href="/"
          >
            ← Welcome
          </a>
        )}
        <span className="text-xs uppercase tracking-wider text-gray-500">
          Step {step.id} of {STEPS.length}
        </span>
        {next ? (
          <a
            className="px-4 py-2 rounded bg-ice-500 hover:bg-ice-700 text-white font-semibold transition"
            href={next}
          >
            Step {step.id + 1} →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
