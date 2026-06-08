import { describe, expect, it } from "vitest";
import { CONSOLE_STEP, STEPS, stepById } from "../steps";

describe("STEPS integrity", () => {
  it("has unique ids", () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a non-empty title on every step", () => {
    for (const s of STEPS) expect(s.title.trim().length).toBeGreaterThan(0);
  });

  it("has non-empty sql on every step except the wrap-up", () => {
    // The wrap-up step (and only it) carries no SQL — it renders a summary
    // template instead of the SQL/why/under-hood panes.
    for (const s of STEPS) {
      if (s.wrapup) expect(s.sql).toBe("");
      else expect(s.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it("has exactly one wrap-up step", () => {
    expect(STEPS.filter((s) => s.wrapup).length).toBe(1);
  });

  it("has exactly one bonus step", () => {
    expect(STEPS.filter((s) => s.bonus).length).toBe(1);
  });

  it("places the bonus step after the wrap-up", () => {
    const wrapIdx = STEPS.findIndex((s) => s.wrapup);
    const bonusIdx = STEPS.findIndex((s) => s.bonus);
    expect(bonusIdx).toBeGreaterThan(wrapIdx);
  });
});

describe("stepById", () => {
  it("returns the matching step", () => {
    expect(stepById(1)?.title).toBe("Create V3 trades table");
  });

  it("returns undefined for an unknown id", () => {
    expect(stepById(424242)).toBeUndefined();
  });

  it("does not resolve the standalone console step (id 0 lives outside STEPS)", () => {
    // CONSOLE_STEP is exported separately and is intentionally NOT a member of
    // STEPS, so it neither affects the wrap-up/bonus counts nor is reachable
    // via stepById.
    expect(stepById(0)).toBeUndefined();
    expect(STEPS).not.toContain(CONSOLE_STEP);
  });
});
