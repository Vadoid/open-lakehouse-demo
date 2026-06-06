// Server-only persistence for the storage config. Keeps the chosen storage
// target (and the GCS SA key) on a mounted volume so it survives container
// restarts/recreations — the in-memory cache alone resets every restart, which
// silently dropped a GCS warehouse back to the MinIO default.
//
// NOTE: imports `fs`, so this must never be pulled into a client bundle. Only
// server code (API routes, lib/storage) may import it.
import fs from "node:fs";
import path from "node:path";
import type { StorageConfig } from "./cache";

const STATE_DIR = process.env.STATE_DIR || "/data";
const CONFIG_FILE = path.join(STATE_DIR, "storage-config.json");

let hydrated = false;
let configured = false;

// Load persisted config into the cache on the first server-side read. Cheap
// guard so we hit disk at most once per process (re-hydrates after a reload,
// which is harmless).
export function hydrateStorageConfig(cache: { storageConfig?: StorageConfig }): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const cfg = JSON.parse(raw) as StorageConfig;
    if (cfg && cfg.type) {
      cache.storageConfig = cfg;
      configured = true;
    }
  } catch {
    /* no persisted config yet — leave the in-memory default in place */
  }
}

export function persistStorageConfig(cfg: StorageConfig): void {
  configured = true;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg), "utf8");
  } catch (e) {
    console.error("Failed to persist storage config:", e);
  }
}

// True once a real config has been chosen (persisted to disk or set this
// session) — NOT the implicit MinIO default. Drives whether SetupGuard shows
// the welcome screen.
export function isConfigured(): boolean {
  return configured;
}
