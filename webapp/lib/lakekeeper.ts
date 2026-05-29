// Tiny REST client for Lakekeeper. Unsecured (allow-all) demo — pass a dummy
// bearer because Lakekeeper still parses the header. Returns warehouse prefix
// + namespace/table listings.

const URL_BASE = process.env.LAKEKEEPER_URL ?? "http://lakekeeper:8181";
const WH = process.env.LAKEKEEPER_WAREHOUSE ?? "demo";
const HEADERS = { "Content-Type": "application/json", Authorization: "Bearer dummy" };

let cachedPrefix: string | undefined;

export async function getPrefix(): Promise<string> {
  if (cachedPrefix) return cachedPrefix;
  const r = await fetch(`${URL_BASE}/catalog/v1/config?warehouse=${WH}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`config: ${r.status}`);
  // Guard JSON parse: a non-JSON body (error page, empty) would otherwise throw
  // a bare SyntaxError. Surface it as a clear, catchable error instead.
  const text = await r.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`config: non-JSON response (${text.slice(0, 120)})`);
  }
  cachedPrefix = j?.defaults?.prefix ?? j?.overrides?.prefix;
  if (!cachedPrefix) throw new Error("no prefix in /v1/config response");
  return cachedPrefix;
}

export async function listNamespaces(): Promise<string[][]> {
  const p = await getPrefix();
  const r = await fetch(`${URL_BASE}/catalog/v1/${p}/namespaces`, { headers: HEADERS });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.namespaces ?? [];
}

export async function listTables(ns: string[]): Promise<string[]> {
  const p = await getPrefix();
  const enc = ns.map(encodeURIComponent).join("%1F");
  const r = await fetch(`${URL_BASE}/catalog/v1/${p}/namespaces/${enc}/tables`, { headers: HEADERS });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.identifiers ?? []).map((t: any) => t.name);
}

export async function loadTable(ns: string[], table: string) {
  const p = await getPrefix();
  const enc = ns.map(encodeURIComponent).join("%1F");
  const r = await fetch(
    `${URL_BASE}/catalog/v1/${p}/namespaces/${enc}/tables/${encodeURIComponent(table)}`,
    { headers: HEADERS },
  );
  if (!r.ok) return null;
  return r.json();
}

// Return the S3 key prefix (no leading bucket, trailing slash) for a table.
// Lakekeeper writes under <warehouse-root>/<warehouse-uuid>/<table-uuid>/, so the
// prefix isn't derivable from (namespace,name) — we have to load the table.
export async function tableKeyPrefix(ns: string[], table: string): Promise<string | null> {
  const t = await loadTable(ns, table);
  const loc: string | undefined = t?.metadata?.location;
  if (!loc) return null;
  const m = loc.match(/^s3:\/\/[^/]+\/(.+?)\/?$/);
  return m ? `${m[1]}/` : null;
}

export async function health(): Promise<boolean> {
  try {
    const r = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}
