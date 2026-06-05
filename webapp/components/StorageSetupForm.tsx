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
  const [defaultBucket, setDefaultBucket] = useState("");
  const [projectId, setProjectId] = useState("");
  const [copied, setCopied] = useState(false);
  const [bypassOrgPolicy, setBypassOrgPolicy] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hostSuffix, setHostSuffix] = useState("default");

  useEffect(() => {
    fetch("/api/storage-setup")
      .then((r) => r.json())
      .then((j) => {
        setCfg({
          type: j.type,
          bucket: j.type === "gcs" ? j.bucket : (j.defaultGcsBucket || ""),
          hasKey: j.hasKey
        });
        setDefaultBucket(j.defaultGcsBucket || "");
        setIsUnlocked(!!j.isCustomBucket);
        setHostSuffix(j.hostSuffix || "default");
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
          bucket: cfg.type === "minio" ? "warehouse" : cfg.bucket,
          gcsKey: cfg.type === "gcs" && gcsKeyInput ? gcsKeyInput : undefined,
          isCustomBucket: cfg.type === "gcs" ? (cfg.bucket !== defaultBucket) : false,
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

  const proj = projectId || "[PROJECT_ID]";
  const bkt = cfg.bucket || defaultBucket || "open-lakehouse-bucket";
  const saName = `lakehouse-catalog-${hostSuffix}`;
  
  const gcloudScript = bypassOrgPolicy
    ? `gcloud config set project ${proj} && \\
gcloud resource-manager org-policies disable-enforce constraints/iam.disableServiceAccountKeyCreation --project=${proj} && \\
(gcloud storage buckets describe gs://${bkt} >/dev/null 2>&1 || gcloud storage buckets create gs://${bkt} --location=us-central1) && \\
(gcloud iam service-accounts describe ${saName}@${proj}.iam.gserviceaccount.com --project=${proj} >/dev/null 2>&1 || gcloud iam service-accounts create ${saName} --display-name="${saName}" --project=${proj}) && \\
gcloud projects add-iam-policy-binding ${proj} --member="serviceAccount:${saName}@${proj}.iam.gserviceaccount.com" --role="roles/storage.admin" && \\
gcloud iam service-accounts keys create /dev/stdout --iam-account="${saName}@${proj}.iam.gserviceaccount.com" && \\
gcloud resource-manager org-policies enable-enforce constraints/iam.disableServiceAccountKeyCreation --project=${proj}`
    : `gcloud config set project ${proj} && \\
(gcloud storage buckets describe gs://${bkt} >/dev/null 2>&1 || gcloud storage buckets create gs://${bkt} --location=us-central1) && \\
(gcloud iam service-accounts describe ${saName}@${proj}.iam.gserviceaccount.com --project=${proj} >/dev/null 2>&1 || gcloud iam service-accounts create ${saName} --display-name="${saName}" --project=${proj}) && \\
gcloud projects add-iam-policy-binding ${proj} --member="serviceAccount:${saName}@${proj}.iam.gserviceaccount.com" --role="roles/storage.admin" && \\
gcloud iam service-accounts keys create /dev/stdout --iam-account="${saName}@${proj}.iam.gserviceaccount.com"`;

  function copyToClipboard(text: string) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text: string) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Fallback copy failed:", err);
    }
    document.body.removeChild(textArea);
  }

  function renderScriptLine(line: string) {
    if (!line) return "";
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = line.split(new RegExp(`(${escapeRegExp(bkt)}|${escapeRegExp(proj)}|${escapeRegExp(saName)})`, 'g'));
    return parts.map((part, i) => {
      if (part === bkt) {
        return <span key={i} className="text-sky-400 font-bold bg-sky-500/10 px-1 rounded border border-sky-500/20">{part}</span>;
      }
      if (part === proj) {
        return <span key={i} className="text-amber-400 font-bold bg-amber-500/10 px-1 rounded border border-amber-500/20">{part}</span>;
      }
      if (part === saName) {
        return <span key={i} className="text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded border border-emerald-500/20">{part}</span>;
      }
      return part;
    });
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
                onChange={() => setCfg((c) => ({ ...c, type: "minio", bucket: "warehouse" }))}
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
                onChange={() => setCfg((c) => ({ ...c, type: "gcs", bucket: c.bucket === "warehouse" ? defaultBucket : c.bucket }))}
                className="accent-ice-500"
              />
              Google Cloud Storage
            </div>
            <span className="text-[10px] text-gray-500 mt-1">Connects directly to GCS buckets. Requires SA JSON credentials.</span>
          </label>
        </div>
      </div>

      {cfg.type === "gcs" && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block">
                Bucket Name
              </label>
              <button
                type="button"
                onClick={() => {
                  if (isUnlocked) {
                    setCfg((c) => ({ ...c, bucket: defaultBucket }));
                  }
                  setIsUnlocked(!isUnlocked);
                }}
                className="text-[10px] text-ice-400 hover:text-ice-300 font-semibold underline"
              >
                {isUnlocked ? "Lock (Reset to default)" : "✏️ Unlock / Change"}
              </button>
            </div>
            <input
              type="text"
              required
              disabled={!isUnlocked}
              value={cfg.bucket}
              onChange={(e) => setCfg((c) => ({ ...c, bucket: e.target.value }))}
              placeholder={defaultBucket}
              className={`w-full px-3 py-2 bg-ink-950 text-xs rounded border outline-none font-semibold ${
                isUnlocked
                  ? "border-amber-500/40 text-amber-200 focus:border-amber-500/60"
                  : "border-ink-700/60 text-gray-400 opacity-80 cursor-not-allowed"
              }`}
            />
            {isUnlocked && (
              <p className="text-[9px] text-amber-500/80 leading-normal mt-1 animate-in fade-in slide-in-from-top-1 duration-150">
                ⚠️ Warning: Custom bucket names will not be automatically deleted by <code>destroy.sh</code> to prevent accidental data loss of existing GCS resources.
              </p>
            )}
          </div>

          {/* GCP Onboarding Helper script box */}
          <div className="bg-ink-950/50 border border-ink-700/60 p-4 rounded-xl space-y-3">
            <div className="text-xs font-semibold text-ice-200 flex items-center gap-1.5">
              <span>🚀</span> GCP Onboarding Helper Script
            </div>
            <p className="text-[10px] text-gray-500 leading-normal">
              Need to set up the bucket and service account? Enter your Google Cloud Project ID below to generate a pre-configured script. Paste this into Cloud Shell to bootstrap instantly.
            </p>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">GCP Project ID</label>
                <input
                  type="text"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="my-gcp-project"
                  className="w-full px-3 py-1.5 bg-ink-950 text-xs rounded border border-ink-700/60 focus:border-ice-500/40 outline-none text-gray-200"
                />
              </div>
              <div className="space-y-1">
                <label className="flex items-start gap-2 text-[10px] text-gray-400 hover:text-gray-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bypassOrgPolicy}
                    onChange={(e) => setBypassOrgPolicy(e.target.checked)}
                    className="accent-ice-500 mt-0.5"
                  />
                  <span>
                    My project restricts SA key creation (temporarily bypass Org Policy)
                  </span>
                </label>
                {bypassOrgPolicy && (
                  <p className="text-[9px] text-amber-500/80 leading-normal pl-5 animate-in fade-in slide-in-from-top-1 duration-150">
                    ℹ️ This wraps the script in `resource-manager` commands to temporarily disable the service account key constraint, download the key, and re-enable it immediately. Requires Project Owner or Org Policy Administrator privileges.
                  </p>
                )}
              </div>
            </div>
            <div className="relative">
              <div className="p-2.5 bg-ink-950 text-[10px] font-mono rounded overflow-x-auto text-gray-300 border border-ink-800 max-h-36 scrollbar-thin leading-relaxed whitespace-pre-wrap">
                {gcloudScript.split("\n").map((line, i) => (
                  <div key={i}>{renderScriptLine(line)}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(gcloudScript)}
                className="absolute right-2 top-2 px-2 py-1 bg-ink-800 hover:bg-ink-700 text-[10px] text-gray-300 rounded border border-ink-700 transition"
              >
                {copied ? "Copied! ✓" : "Copy"}
              </button>
            </div>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-gray-500">
                Run this inside your Cloud Shell window.
              </span>
              <a
                href="https://shell.cloud.google.com/?show=terminal"
                target="_blank"
                rel="noreferrer"
                className="text-ice-400 hover:text-ice-300 font-semibold underline flex items-center gap-1"
              >
                Open Cloud Shell ↗
              </a>
            </div>
          </div>

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
