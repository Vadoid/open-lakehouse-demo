import { createServer } from "node:http";
import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 80);
const html = await readFile(new URL("./index.html", import.meta.url));

async function httpProbe(url, timeoutMs = 2200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function tcpProbe(host, port, timeoutMs = 1800) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function checkServices() {
  const entries = await Promise.all([
    // The webapp listens on 3000 inside Docker; 3030 is the host-published port.
    httpProbe("http://demo-webapp:3000/api/health").then((ok) => ["lakehouse", ok]),
    tcpProbe("spark-thrift", 10000).then((ok) => ["spark", ok]),
    httpProbe("http://flink-jobmanager:8081/overview").then((ok) => ["flink", ok]),
    httpProbe("http://lakekeeper:8181/health").then((ok) => ["lakekeeper", ok]),
    httpProbe("http://lake-minio:9000/minio/health/live").then((ok) => ["minio", ok]),
    httpProbe("http://lake-jupyter:8888/api").then((ok) => ["jupyter", ok]),
    httpProbe("http://mlflow:5000/health").then((ok) => ["mlflow", ok]),
    httpProbe("http://superset:8088/health").then((ok) => ["superset", ok]),
  ]);
  return Object.fromEntries(entries);
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  if (pathname === "/api/health") {
    const health = await checkServices();
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify(health));
    return;
  }
  if (pathname === "/" || pathname === "/index.html") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : html);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Open Lakehouse portal listening on port ${PORT}`);
});
