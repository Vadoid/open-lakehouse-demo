import { NextResponse } from "next/server";
import { probeAll } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await probeAll();
  return NextResponse.json(r);
}
