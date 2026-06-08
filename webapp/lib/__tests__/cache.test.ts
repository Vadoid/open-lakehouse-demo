import { describe, expect, it } from "vitest";
import { diffSnapshots, getRun, saveRun, type FileSnapshot, type StepRun } from "../cache";

function snap(files: Record<string, string>): FileSnapshot {
  // Only etag drives the diff; size/lastModified are filler for the type.
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([k, etag]) => [k, { size: 0, etag, lastModified: "" }]),
    ),
  };
}

describe("diffSnapshots", () => {
  it("marks keys present only in curr as added", () => {
    const out = diffSnapshots(snap({ a: "1" }), snap({ a: "1", b: "2" }));
    expect(out).toEqual({ a: "same", b: "added" });
  });

  it("marks keys present only in prev as removed", () => {
    const out = diffSnapshots(snap({ a: "1", b: "2" }), snap({ a: "1" }));
    expect(out).toEqual({ a: "same", b: "removed" });
  });

  it("marks a key whose etag differs as changed", () => {
    const out = diffSnapshots(snap({ a: "1" }), snap({ a: "2" }));
    expect(out).toEqual({ a: "changed" });
  });

  it("marks an identical etag as same", () => {
    const out = diffSnapshots(snap({ a: "1" }), snap({ a: "1" }));
    expect(out).toEqual({ a: "same" });
  });

  it("treats an undefined prev as everything added", () => {
    const out = diffSnapshots(undefined, snap({ a: "1", b: "2" }));
    expect(out).toEqual({ a: "added", b: "added" });
  });
});

describe("saveRun / getRun", () => {
  it("round-trips a stored run by step id", () => {
    const run: StepRun = { ranAt: "2026-01-01", durationMs: 12, rowSets: [], log: [] };
    saveRun(101, run);
    expect(getRun(101)).toBe(run);
  });

  it("returns undefined for a step id that was never stored", () => {
    expect(getRun(999_999)).toBeUndefined();
  });
});
