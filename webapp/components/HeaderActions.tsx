"use client";
import HealthPills from "@/components/HealthPills";
import ThemeToggle from "@/components/ThemeToggle";

export default function HeaderActions() {
  return (
    <div className="flex items-center gap-3">
      <HealthPills />
      <ThemeToggle />
    </div>
  );
}
