"use client";
import { useState, useEffect } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type Config = {
  type: "minio" | "gcs";
  bucket: string;
  gcsKey?: string;
  hasKey?: boolean;
};

export default function StorageSetupModal({ isOpen, onClose }: Props) {
  const [cfg, setCfg] = useState<Config>({ type: "minio", bucket: "" });
  const [gcsKeyInput, setGcsKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSuccess(false);
    setError(null);
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => {
        setCfg({ type: j.type, bucket: j.bucket, hasKey: j.hasKey });
        setGcsKeyInput("");
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/storage-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: cfg.type,
          bucket: cfg.bucket,
          gcsKey: cfg.type === "gcs" && gcsKeyInput ? gcsKeyInput : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to save storage settings");
      }
      setSuccess(true);
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-ink-700 bg-ink-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <header className="px-5 py-4 border-b border-ink-700 flex justify-between items-center bg-ink-950/40">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ice-100">
            Storage Warehouse Setup
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition text-sm font-semibold"
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Storage Provider
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-200 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  checked={cfg.type === "minio"}
                  onChange={() => setCfg((c) => ({ ...c, type: "minio" }))}
                  className="accent-ice-500"
                />
                Local Sandbox (MinIO)
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-200 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  checked={cfg.type === "gcs"}
                  onChange={() => setCfg((c) => ({ ...c, type: "gcs" }))}
                  className="accent-ice-500"
                />
                Google Cloud Storage (GCS)
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
              Bucket Name
            </label>
            <input
              type="text"
              required
              value={cfg.bucket}
              onChange={(e) => setCfg((c) => ({ ...c, bucket: e.target.value }))}
              placeholder={cfg.type === "gcs" ? "my-gcs-bucket" : "warehouse"}
              className="w-full px-3 py-1.5 bg-ink-950 text-xs rounded border border-ink-700/60 focus:border-ice-500/40 outline-none text-gray-200"
            />
          </div>

          {cfg.type === "gcs" && (
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
                GCS Service Account JSON Key {cfg.hasKey && <span className="text-[10px] text-emerald-500 font-semibold">(Configured)</span>}
              </label>
              <textarea
                value={gcsKeyInput}
                onChange={(e) => setGcsKeyInput(e.target.value)}
                placeholder='{"type": "service_account", "project_id": ...}'
                rows={5}
                className="w-full px-3 py-1.5 bg-ink-950 text-[11px] font-mono rounded border border-ink-700/60 focus:border-ice-500/40 outline-none text-gray-200"
              />
              <span className="text-[9px] text-gray-500 block mt-1">
                Paste JSON key contents. Leave blank to retain currently configured key (if already configured).
              </span>
            </div>
          )}

          {error && (
            <div className="p-3 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded font-mono">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 rounded font-medium flex items-center gap-2">
              <span>✓ Warehouse bootstrapped successfully. Refreshing...</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-ink-700 bg-ink-800 text-gray-300 hover:bg-ink-700/50 rounded text-xs transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className="px-4 py-2 bg-ice-500 hover:bg-ice-600 text-white rounded text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Applying...
                </>
              ) : (
                "Save & Bootstrap"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
