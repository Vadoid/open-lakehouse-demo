import { NextRequest } from "next/server";
import { stepById } from "@/lib/steps";
import { runScript } from "@/lib/thrift";
import { listAll } from "@/lib/s3";
import { saveRun } from "@/lib/cache";
import { resolveStepPrefix } from "@/lib/resolvePrefix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/run  body: { stepId: number }
// → text/event-stream SSE feed: progress, results, done/error.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const step = stepById(Number(body.stepId));
  if (!step) return new Response("unknown step", { status: 400 });

  const customSql = typeof body.sql === "string" ? body.sql : null;
  const sqlToRun = customSql ?? step.sql;
  const edited = typeof body.isEdited === "boolean" ? body.isEdited : (customSql !== null && customSql.trim() !== step.sql.trim());

  const prefix = await resolveStepPrefix(step).catch(() => "demo/");
  let filesBefore;
  try { filesBefore = await listAll(prefix); } catch { /* tolerate */ }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const safeEnqueue = (bytes: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(bytes); } catch { closed = true; }
      };
      const send = (event: string, data: unknown) =>
        safeEnqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      // SSE keep-alive: long-running statements (compaction, expire_snapshots)
      // can stall the stream for minutes. Browsers/proxies drop idle fetches.
      // A comment line every 10s keeps the connection warm without surfacing
      // a visible event on the client.
      const keepAlive = setInterval(() => safeEnqueue(enc.encode(`: ping\n\n`)), 10000);

      const t0 = Date.now();
      const log: string[] = [];
      const rowSets: import("@/lib/cache").RowSet[] = [];

      send("hello", { stepId: step.id, title: step.title, prefix });

      try {
        for await (const ev of runScript(sqlToRun)) {
          send(ev.kind, ev);
          if (ev.kind === "running" && ev.state) log.push(`stmt ${ev.stmtIdx + 1}: ${ev.state} @${ev.elapsedMs}ms`);
          if (ev.kind === "result") rowSets.push({ stmtIdx: ev.stmtIdx, columns: ev.columns, data: ev.data });
          if (ev.kind === "error") {
            if (!edited) saveRun(step.id, {
              ranAt: new Date().toISOString(),
              durationMs: Date.now() - t0,
              rowSets,
              log,
              error: ev.message,
              filesBefore,
            });
            controller.close();
            return;
          }
        }
        let filesAfter;
        try { filesAfter = await listAll(prefix); } catch { /* tolerate */ }

        if (!edited) saveRun(step.id, {
          ranAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          rowSets,
          log,
          filesBefore,
          filesAfter,
        });

        const added: string[] = [];
        const removed: string[] = [];
        const changed: string[] = [];
        if (filesBefore && filesAfter) {
          const a = filesBefore.files, b = filesAfter.files;
          for (const k of Object.keys(b)) {
            if (!(k in a)) added.push(k);
            else if (a[k].etag !== b[k].etag) changed.push(k);
          }
          for (const k of Object.keys(a)) if (!(k in b)) removed.push(k);
        }
        send("diff", { prefix, added, removed, changed });
      } catch (e: any) {
        send("error", { message: e?.message ?? String(e) });
      } finally {
        clearInterval(keepAlive);
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
