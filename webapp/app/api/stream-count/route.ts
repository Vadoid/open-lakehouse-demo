import { NextResponse } from "next/server";
import { runOnce } from "@/lib/thrift";
import { isArmed } from "@/lib/flinkFlag";

export const dynamic = "force-dynamic";

// Live row count of the Flink-written streaming table, for the step 19 interop
// widget. Polled every few seconds by LiveStreamCount; the number climbing is
// the proof that Flink (writer) and Spark (this reader) share one catalog.
//
// Engine awareness: FLINK_ENABLED is injected into the webapp container by
// main.tf, gated on the same `enable_flink` Terraform var that creates the
// Flink containers. So the widget can tell "Flink isn't deployed" (show a
// redeploy hint) apart from "Flink is up but hasn't committed its first
// checkpoint yet" (table missing) apart from "streaming" (count > 0).
export async function GET() {
  const enabled = process.env.FLINK_ENABLED === "1";

  // When Flink was never deployed, don't even hit Spark — there is nothing to
  // count, and the table legitimately won't exist.
  if (!enabled) {
    return NextResponse.json({ enabled: false, armed: false, count: null, missing: true });
  }

  // `armed` = the bonus-screen Start button has requested streaming. It lets the
  // widget tell "never started" (show Start) from "started, no checkpoint yet".
  const armed = isArmed();

  try {
    const { data } = await runOnce(
      "SELECT count(*) AS n FROM demo.market.trades_stream"
    );
    // runOnce returns rows as arrays; count(*) is the single cell [0][0].
    const raw = data?.[0]?.[0];
    const count = typeof raw === "string" ? Number(raw) : (raw ?? 0);
    return NextResponse.json({ enabled: true, armed, count, missing: false });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Flink is enabled but the sink hasn't committed its first checkpoint yet,
    // so the table isn't in the catalog. Mirror the snapshots route: treat a
    // missing table as "not streaming yet", not a hard error.
    if (/TABLE_OR_VIEW_NOT_FOUND|cannot be found|NoSuchTable/i.test(msg)) {
      return NextResponse.json({ enabled: true, armed, count: null, missing: true });
    }
    return NextResponse.json({ enabled: true, armed, error: msg }, { status: 500 });
  }
}
