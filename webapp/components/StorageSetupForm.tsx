"use client";
import { useState, useEffect } from "react";

type Props = {
  onSuccess: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
};

type Config = {
  type: "minio" | "gcs";
  bucket: string;
  gcsKey?: string;
  hasKey?: boolean;
};

export default function StorageSetupForm({ onSuccess, onCancel, showCancel = true }: Props) {
  const [cfg, setCfg] = useState<Config>({ type: "minio", bucket: "" });
  const [gcsKeyInput, setGcsKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => {
        setCfg({ type: j.type, bucket: j.bucket, hasKey: j.hasKey });
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
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
        throw new Error(data.error ?? "Failed to bootstrap warehouse");
      }
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 1000);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
          Storage Provider
        </span>
        <div className="grid grid-cols-2 gap-3">
          <label className={`flex flex-col p-3 rounded-lg border cursor-pointer transition ${
            cfg.type === "minio"
              ? "border-ice-500 bg-ice-500/5 text-ice-200"
              : "border-ink-700 bg-ink-950/20 hover:border-ink-600 text-gray-400"
          }`}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="radio"
                name="type"
                checked={cfg.type === "minio"}
                onChange={() => setCfg((c) => ({ ...c, type: "minio" }))}
                className="accent-ice-500"
              />
              Local Sandbox (MinIO)
            </div>
            <span className="text-[10px] text-gray-500 mt-1">Runs locally in Docker containers. Zero configuration required.</span>
          </label>
          <label className={`flex flex-col p-3 rounded-lg border cursor-pointer transition ${
            cfg.type === "gcs"
              ? "border-ice-500 bg-ice-500/5 text-ice-200"
              : "border-ink-700 bg-ink-950/20 hover:border-ink-600 text-gray-400"
          }`}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="radio"
                name="type"
                checked={cfg.type === "gcs"}
                onChange={() => setCfg((c) => ({ ...c, type: "gcs" }))}
                className="accent-ice-500"
              />
              Google Cloud Storage
            </div>
            <span className="text-[10px] text-gray-500 mt-1">Connects directly to GCS buckets. Requires SA JSON credentials.</span>
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
          placeholder={cfg.type === "gcs" ? "my-gcs-bucket-name" : "warehouse"}
          className="w-full px-3 py-2 bg-ink-950 text-xs rounded border border-ink-700/60 focus:border-ice-500/40 outline-none text-gray-200"
        />
      </div>

      {cfg.type === "gcs" && (
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
            GCS Service Account JSON Key {cfg.hasKey && <span className="text-[10px] text-emerald-500 font-semibold">(Already configured)</span>}
          </label>
          <textarea
            required={!cfg.hasKey}
            value={gcsKeyInput}
            onChange={(e) => setGcsKeyInput(e.target.value)}
            placeholder='{"type": "service_account", "project_id": ...}'
            rows={5}
            className="w-full px-3 py-1.5 bg-ink-950 text-[11px] font-mono rounded border border-ink-700/60 focus:border-ice-500/40 outline-none text-gray-200"
          />
          <span className="text-[9px] text-gray-500 block">
            Paste JSON key. If key is already configured, leave empty to keep it unchanged.
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded font-mono">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 rounded font-medium">
          ✓ Warehouse re-registered successfully. Launching demo...
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        {showCancel && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 border border-ink-700 bg-ink-800 text-gray-300 hover:bg-ink-700/50 rounded text-xs transition disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading || success}
          className="px-5 py-2 bg-ice-500 hover:bg-ice-600 text-white rounded text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? (
            <>
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Bootstrapping...
            </>
          ) : (
            "Bootstrap Warehouse"
          )}
        </button>
      </div>
    </form>
  );
}
