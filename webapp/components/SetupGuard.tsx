"use client";
import { useEffect, useState } from "react";
import StorageSetupForm from "@/components/StorageSetupForm";

export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const [hasChecked, setHasChecked] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    // Server is source of truth: the storage config is persisted on a volume,
    // so it survives restarts. Reconcile localStorage against it — a stale
    // "completed" flag must not skip setup after the server lost its config
    // (e.g. a fresh volume), and a configured server must not re-prompt.
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => {
        const serverConfigured = j?.configured === true;
        if (serverConfigured) {
          localStorage.setItem("storage_setup_completed", "true");
        } else {
          localStorage.removeItem("storage_setup_completed");
        }
        setIsConfigured(serverConfigured);
      })
      .catch(() => {
        // Network/parse failure: fall back to the local flag so we don't lock
        // the user out of a working stack.
        setIsConfigured(localStorage.getItem("storage_setup_completed") === "true");
      })
      .finally(() => setHasChecked(true));
  }, []);

  if (!hasChecked) {
    // Clean loading screen to prevent flashing
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-ice-500/30 border-t-ice-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-ink-950 via-ink-900 to-ink-950 text-gray-100 font-sans select-none">
        {/* Animated background highlights */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.06),transparent_40%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.03),transparent_45%)] pointer-events-none" />

        <div className="w-full max-w-2xl bg-ink-900/60 border border-ink-700/80 rounded-2xl shadow-2xl p-8 backdrop-blur-md relative z-10 space-y-6">
          <header className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-ice-500/10 border border-ice-500/20 text-ice-300 text-2xl mb-2 animate-bounce">
              🧊
            </div>
            <h1 className="text-xl font-bold tracking-tight text-ice-100 uppercase">
              Welcome to the Open Lakehouse Demo
            </h1>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Before exploring Apache Iceberg Spec V3, select your target data catalog warehouse. You can change this later in settings.
            </p>
          </header>

          <div className="border-t border-ink-700/60 pt-6">
            <StorageSetupForm
              showCancel={false}
              onSuccess={() => {
                localStorage.setItem("storage_setup_completed", "true");
                setIsConfigured(true);
                window.location.reload();
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
