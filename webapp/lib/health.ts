import net from "node:net";
import { s3, BUCKET } from "./s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { health as lkHealth } from "./lakekeeper";

const PG_HOST = "lake-postgres";
const PG_PORT = 5432;
const THRIFT_HOST = process.env.THRIFT_HOST ?? "spark-thrift";
const THRIFT_PORT = Number(process.env.THRIFT_PORT ?? 10000);
// Flink is optional — only deployed when enable_flink=true (main.tf sets
// FLINK_ENABLED on this container to match). When off, we omit the field
// entirely so the header doesn't show a permanently-red pill for a service the
// user chose not to run.
const FLINK_ENABLED = process.env.FLINK_ENABLED === "1";
const FLINK_HOST = process.env.FLINK_HOST ?? "flink-jobmanager";
const FLINK_PORT = Number(process.env.FLINK_PORT ?? 8081);

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
  const [postgres, thrift, lakekeeper, minio, flink] = await Promise.all([
    tcpProbe(PG_HOST, PG_PORT),
    tcpProbe(THRIFT_HOST, THRIFT_PORT),
    lkHealth(),
    s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 })).then(() => true).catch(() => false),
    // The jobmanager's REST/web-UI port is up once the cluster is serving.
    FLINK_ENABLED ? tcpProbe(FLINK_HOST, FLINK_PORT) : Promise.resolve(undefined),
  ]);
  // Only surface the Flink key when the engine is enabled — the pill is then
  // rendered; otherwise it's absent and HealthPills skips it.
  return FLINK_ENABLED
    ? { postgres, thrift, lakekeeper, minio, flink }
    : { postgres, thrift, lakekeeper, minio };
}
