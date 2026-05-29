// Thin wrapper over hive-driver (lenchv/hive-driver on npm).
//
// The package exposes HiveClient + a separate HiveUtils helper:
//   utils.waitUntilReady(op, progressEnabled, progressCb)
//   utils.fetchAll(op)
//   utils.getResult(op).getValue()  // → array of row objects
//
// Spark Thrift Server speaks HiveServer2 V10 over plain TCP, no SASL.

// hive-driver is a CommonJS package; depending on the bundling path Next.js
// takes for a given route, the default import can come back undefined. Require
// it lazily and tolerate both default and namespace shapes.
function loadHive(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("hive-driver");
  patchBigInt();
  return mod?.default ?? mod;
}

// JsonResult.convertBigInt does `value.toNumber()`, which overflows for any
// i64 above 2^53 (Iceberg snapshot ids are 18-digit). Patch it once to keep
// the precise value as a string when it can't fit in a JS number.
let bigIntPatched = false;
function patchBigInt() {
  if (bigIntPatched) return;
  bigIntPatched = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JR = require("hive-driver/dist/result/JsonResult").default;
    if (JR?.prototype?.convertBigInt) {
      JR.prototype.convertBigInt = function (value: any) {
        // node-int64 holds a Buffer; .toNumber() / .toString() both lose
        // precision (overflow → Infinity, decimal toString uses Number).
        // Reconstruct losslessly via BigInt over the 8-byte buffer.
        try {
          const buf: any = value?.buffer;
          if (buf && typeof buf.readBigInt64BE === "function") {
            const offset = typeof value.offset === "number" ? value.offset : 0;
            const big = buf.readBigInt64BE(offset);
            if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) {
              return Number(big);
            }
            return big.toString();
          }
        } catch { /* fall through */ }
        const n = value?.toNumber?.();
        if (typeof n === "number" && Number.isFinite(n) && Number.isSafeInteger(n)) return n;
        return value?.toString?.() ?? n ?? null;
      };
    }
  } catch { /* tolerate — patch is opportunistic */ }
}

const HOST = process.env.THRIFT_HOST ?? "spark-thrift";
const PORT = Number(process.env.THRIFT_PORT ?? 10000);

export type ProgressEvent =
  | { kind: "start"; stmtIdx: number; total: number; sql: string }
  | { kind: "running"; stmtIdx: number; elapsedMs: number; state?: string }
  | { kind: "result"; stmtIdx: number; columns: string[]; data: any[][] }
  | { kind: "done"; durationMs: number }
  | { kind: "error"; message: string };

export function splitStatements(sql: string): string[] {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
  return stripped
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function openSession() {
  const hive = loadHive();
  const { HiveClient, HiveUtils, thrift, connections, auth } = hive;
  const { TCLIService, TCLIService_types } = thrift;
  const client = new HiveClient(TCLIService, TCLIService_types);
  const utils = new HiveUtils(TCLIService_types);
  // Spark Thrift Server expects SASL PLAIN with anonymous on the default
  // unauthenticated config. NoSasl hangs at openSession because Spark waits
  // for the SASL handshake.
  const conn = await client.connect(
    { host: HOST, port: PORT },
    new connections.TcpConnection(),
    new auth.PlainTcpAuthentication({ username: "anonymous", password: "anonymous" }),
  );
  const session = await conn.openSession({
    client_protocol: TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10,
  });
  return { client, conn, session, utils };
}

export async function* runScript(sql: string): AsyncGenerator<ProgressEvent> {
  const t0 = Date.now();
  const statements = splitStatements(sql);
  let session: any, conn: any, utils: any;
  try {
    const o = await openSession();
    session = o.session; conn = o.conn; utils = o.utils;
  } catch (e: any) {
    yield { kind: "error", message: `connect failed: ${e?.message ?? e}` };
    return;
  }

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      yield { kind: "start", stmtIdx: i, total: statements.length, sql: stmt };
      const tStmt = Date.now();

      let op: any;
      try {
        op = await session.executeStatement(stmt, { runAsync: true });
      } catch (e: any) {
        yield { kind: "error", message: `execute failed at stmt ${i + 1}: ${e?.message ?? e}` };
        return;
      }

      // waitUntilReady accepts a progress callback that fires on each status
      // poll. We can't yield from inside it (the generator scope is outside),
      // so we collect status events into a buffer and drain them after.
      const heartbeats: { elapsedMs: number; state?: string }[] = [];
      try {
        await utils.waitUntilReady(op, false, (res: any) => {
          heartbeats.push({
            elapsedMs: Date.now() - tStmt,
            state: res?.operationState != null ? String(res.operationState) : undefined,
          });
        });
      } catch (e: any) {
        // waitUntilReady throws OperationStateError with a generic outer
        // message. Spark Thrift Server attaches the real SQL error to
        // response.errorMessage at the top level (not response.status). Take
        // only the first line so the UI doesn't render the entire Java stack.
        const pick = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);
        const r = e?.response;
        const raw = pick(r?.errorMessage)
          ?? pick(r?.status?.errorMessage)
          ?? (Array.isArray(r?.status?.infoMessages) ? pick(r.status.infoMessages.find((x: any) => pick(String(x)))) : null)
          ?? pick(e?.message)
          ?? String(e);
        const detail = raw.split(/\r?\n/)[0].replace(/^Error:\s*/, "");
        yield { kind: "error", message: `stmt ${i + 1} failed: ${detail}` };
        try { await op.close?.(); } catch { /* ignore */ }
        return;
      }

      for (const hb of heartbeats) yield { kind: "running", stmtIdx: i, ...hb };

      // Pull results, if any.
      let columns: string[] = [];
      let data: any[][] = [];
      try {
        await utils.fetchAll(op);
        const result = utils.getResult(op);
        const rows: any[] = result?.getValue?.() ?? [];
        if (Array.isArray(rows) && rows.length > 0) {
          columns = Object.keys(rows[0]);
          data = rows.map((r) => columns.map((c) => r[c]));
        }
      } catch {
        // DDL / CALL / no result set — fine.
      }
      try { await op.close?.(); } catch { /* ignore */ }

      yield { kind: "result", stmtIdx: i, columns, data: data.slice(0, 200) };
    }
    yield { kind: "done", durationMs: Date.now() - t0 };
  } finally {
    try { await session?.close?.(); } catch { /* ignore */ }
    try { await conn?.close?.(); } catch { /* ignore */ }
  }
}

// One-shot helper for short queries (no SSE). Returns the LAST result set.
export async function runOnce(sql: string): Promise<{ columns: string[]; data: any[][] }> {
  let columns: string[] = [];
  let data: any[][] = [];
  for await (const ev of runScript(sql)) {
    if (ev.kind === "result") { columns = ev.columns; data = ev.data; }
    if (ev.kind === "error") throw new Error(ev.message);
  }
  return { columns, data };
}
