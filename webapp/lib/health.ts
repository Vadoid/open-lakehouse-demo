import net from "node:net";
import { s3, BUCKET } from "./s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { health as lkHealth } from "./lakekeeper";

const PG_HOST = "lake-postgres";
const PG_PORT = 5432;
const THRIFT_HOST = process.env.THRIFT_HOST ?? "spark-thrift";
const THRIFT_PORT = Number(process.env.THRIFT_PORT ?? 10000);

function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
    sock.connect(port, host);
  });
}

export async function probeAll() {
  const [postgres, thrift, lakekeeper, minio] = await Promise.all([
    tcpProbe(PG_HOST, PG_PORT),
    tcpProbe(THRIFT_HOST, THRIFT_PORT),
    lkHealth(),
    s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 })).then(() => true).catch(() => false),
  ]);
  return { postgres, thrift, lakekeeper, minio };
}
