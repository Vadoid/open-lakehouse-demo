import fs from "fs";
import path from "path";

// Shared "arm" flag for the Flink streaming job. The flink-jobmanager container
// bind-mounts the SAME host dir (the webapp's STATE_DIR / .demo-state) at
// /control and its resubmit supervisor only submits the stream while this file
// exists. So writing/removing it here is how the bonus-screen Start/Stop button
// drives the engine — the webapp can't docker-exec and there's no SQL gateway.
const STATE_DIR = process.env.STATE_DIR || "/data";
const FLAG_FILE = path.join(STATE_DIR, "flink-stream.on");

export function isArmed(): boolean {
  try {
    return fs.existsSync(FLAG_FILE);
  } catch {
    return false;
  }
}

export function arm(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(FLAG_FILE, new Date().toISOString(), "utf8");
}

export function disarm(): void {
  try {
    fs.rmSync(FLAG_FILE, { force: true });
  } catch {
    /* already gone — fine */
  }
}
