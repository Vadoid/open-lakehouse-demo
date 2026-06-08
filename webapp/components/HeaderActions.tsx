"use client";
import Link from "next/link";
import HealthPills from "@/components/HealthPills";
import ThemeToggle from "@/components/ThemeToggle";

export default function HeaderActions() {
  return (
    <div className="flex items-center gap-3">
      <HealthPills />
      <Link
        href="/console"
        className="px-3 py-1.5 rounded-lg border border-ice-500/40 text-ice-300 hover:border-ice-500 hover:bg-ice-500/10 text-xs font-semibold transition whitespace-nowrap"
      >
        SQL Console
      </Link>
      <ThemeToggle />
    </div>
  );
}
