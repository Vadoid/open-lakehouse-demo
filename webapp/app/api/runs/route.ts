import { NextResponse } from "next/server";
import { cache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const completedStepIds = Object.keys(cache.runs).map(Number);
  return NextResponse.json({ completed: completedStepIds });
}
