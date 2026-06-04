"use client";
import { useState } from "react";
import HealthPills from "@/components/HealthPills";
import ThemeToggle from "@/components/ThemeToggle";
import StorageSetupModal from "@/components/StorageSetupModal";

export default function HeaderActions() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setModalOpen(true)}
        title="Configure storage target (MinIO / GCS)"
        className="px-2.5 py-1.5 rounded-md border border-ink-700 bg-ink-900/60 text-gray-400 hover:text-ice-300 hover:border-ice-500/30 transition text-xs font-semibold flex items-center gap-1.5"
      >
        <span>⚙️</span> Storage Setup
      </button>
      <HealthPills />
      <ThemeToggle />
      <StorageSetupModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
