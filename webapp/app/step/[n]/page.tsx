import { notFound } from "next/navigation";
import { stepById, STEPS } from "@/lib/steps";
import SqlPanel from "@/components/SqlPanel";
import WhyPanel from "@/components/WhyPanel";
import UnderHoodTabs from "@/components/UnderHoodTabs";
import LineageGraph from "@/components/UnderHood/LineageGraph";
import LiveStreamCount from "@/components/UnderHood/LiveStreamCount";
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
    <div className="p-6 flex flex-col gap-5 min-h-full">
      <div className="grid grid-cols-12 gap-5">
        {/* Left Column - SQL Panel gets major space to prevent horizontal scrolls */}
        <section className="col-span-8 flex flex-col gap-3">
          <header className="flex items-baseline justify-between">
            <StepTitle id={step.id} title={step.title} />
          </header>
          <SqlPanel step={step} />
          {/* Flink interop step: live count of the streamed table, climbing
              while Flink writes. Gated/explained inside the widget. */}
          {step.inspect.stream && <LiveStreamCount />}
        </section>

        {/* Right Column - Why, Expected Outcome, and Metadata Tabs */}
        <section className="col-span-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Why this matters</h2>
            <WhyPanel markdown={step.why} />
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800/60 p-3 text-sm shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Expected outcome</div>
            <StepExpect text={step.expect} />
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Under the hood</h2>
            <UnderHoodTabs
              minioPrefix={minioPrefix}
              stepId={step.id}
              minioHint={step.inspect.minio?.hint}
              catalogTable={step.inspect.catalog?.table}
              snapshotsTable={step.inspect.snapshots?.table}
            />
          </div>
        </section>
      </div>

      {step.inspect.lineage && (
        <section className="flex flex-col gap-2 mt-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Lineage & Layout Explorer</h2>
          <LineageGraph table={step.inspect.lineage.table} />
        </section>
      )}

      <nav className="flex items-center justify-between border-t border-ink-700 pt-4 mt-4">
        {prev ? (
          <a
            className="px-4 py-2 rounded border border-ink-700 bg-ink-800/60 text-ice-300 hover:border-ice-500/60 hover:text-ice-100 transition text-xs font-semibold"
            href={prev}
          >
            ← Step {step.id - 1}
          </a>
        ) : (
          <a
            className="px-4 py-2 rounded border border-ink-700 bg-ink-800/60 text-gray-300 hover:border-ice-500/60 hover:text-ice-100 transition text-xs font-semibold"
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
            className="px-4 py-2 rounded bg-ice-500 hover:bg-ice-700 text-white font-semibold transition text-xs"
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
