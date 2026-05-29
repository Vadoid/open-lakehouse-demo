// Demo configuration: row count + day range. Persisted in localStorage,
// applied at render time by substituting {{ROWS}}/{{SECONDS}}/{{DAYS}} in
// step SQL and titles.

export type DemoConfig = { rows: number; days: number };

export const DEFAULT_CONFIG: DemoConfig = { rows: 1_000_000, days: 30 };

export const ROW_PRESETS = [100_000, 500_000, 1_000_000, 5_000_000, 50_000_000] as const;
export const DAY_PRESETS = [7, 30, 90, 365] as const;

const STORAGE_KEY = "demoConfig";
const EVENT_NAME = "ic:config";

export function fmtRows(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function applyConfig(text: string, cfg: DemoConfig): string {
  return text
    .replace(/\{\{ROWS\}\}/g, fmtRows(cfg.rows))
    .replace(/\{\{ROWS_RAW\}\}/g, String(cfg.rows))
    .replace(/\{\{ROWS_COMMA\}\}/g, cfg.rows.toLocaleString())
    .replace(/\{\{SECONDS\}\}/g, String(cfg.days * 86400))
    .replace(/\{\{DAYS\}\}/g, String(cfg.days));
}

// SQL run-time substitution: numeric literals only.
export function applyConfigForSql(sql: string, cfg: DemoConfig): string {
  return sql
    .replace(/\{\{ROWS\}\}/g, String(cfg.rows))
    .replace(/\{\{ROWS_RAW\}\}/g, String(cfg.rows))
    .replace(/\{\{ROWS_COMMA\}\}/g, String(cfg.rows))
    .replace(/\{\{SECONDS\}\}/g, String(cfg.days * 86400))
    .replace(/\{\{DAYS\}\}/g, String(cfg.days));
}

export function loadConfig(): DemoConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    const rows = Number(parsed?.rows);
    const days = Number(parsed?.days);
    if (!Number.isFinite(rows) || rows <= 0) return DEFAULT_CONFIG;
    if (!Number.isFinite(days) || days <= 0) return DEFAULT_CONFIG;
    return { rows: Math.floor(rows), days: Math.floor(days) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: DemoConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* ignore quota / privacy errors */ }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: cfg }));
}

export function subscribeConfig(handler: (cfg: DemoConfig) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.rows === "number" && typeof detail.days === "number") {
      handler(detail as DemoConfig);
    } else {
      handler(loadConfig());
    }
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
