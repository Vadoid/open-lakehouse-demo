// @vitest-environment jsdom
//
// jsdom gives us a real window + EventTarget. Its localStorage, though, is a
// non-functional stub in this toolchain (a bare object with no Storage
// methods), so we install a Map-backed mock before each test — that keeps
// loadConfig/saveConfig deterministic and spy-able regardless of the env's
// storage behavior. The pure fmtRows/applyConfig tests ignore it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: ls,
    configurable: true,
    writable: true,
  });
}

beforeEach(installLocalStorage);
import {
  DEFAULT_CONFIG,
  applyConfig,
  applyConfigForSql,
  fmtRows,
  loadConfig,
  saveConfig,
} from "../demoConfig";

describe("fmtRows", () => {
  // Characterization: pins what the function returns when run, not an ideal.
  it("leaves counts below 1000 as a plain integer string", () => {
    expect(fmtRows(0)).toBe("0");
    expect(fmtRows(999)).toBe("999");
  });

  it("switches to K at exactly 1000", () => {
    expect(fmtRows(1_000)).toBe("1K");
    expect(fmtRows(1_500)).toBe("1.5K");
  });

  it("formats millions, dropping the decimal on an exact million", () => {
    expect(fmtRows(1_000_000)).toBe("1M");
    expect(fmtRows(1_500_000)).toBe("1.5M");
  });

  it("formats billions", () => {
    expect(fmtRows(2_000_000_000)).toBe("2B");
    expect(fmtRows(2_500_000_000)).toBe("2.5B");
  });
});

describe("applyConfig (display substitution)", () => {
  const cfg = { rows: 1_500_000, days: 30 };

  it("substitutes every placeholder", () => {
    const out = applyConfig(
      "{{ROWS}} | {{ROWS_RAW}} | {{ROWS_COMMA}} | {{SECONDS}} | {{DAYS}}",
      cfg,
    );
    // {{ROWS}} is the human-formatted form in display contexts.
    expect(out).toBe("1.5M | 1500000 | 1,500,000 | 2592000 | 30");
  });

  it("replaces all occurrences of a placeholder, not just the first", () => {
    expect(applyConfig("{{DAYS}}-{{DAYS}}", cfg)).toBe("30-30");
  });

  it("computes SECONDS as days * 86400", () => {
    expect(applyConfig("{{SECONDS}}", { rows: 1, days: 7 })).toBe("604800");
  });
});

describe("applyConfigForSql (numeric-literal substitution)", () => {
  const cfg = { rows: 1_500_000, days: 30 };

  it("emits raw integers, never the 1.5M short form", () => {
    const out = applyConfigForSql(
      "{{ROWS}} | {{ROWS_RAW}} | {{ROWS_COMMA}} | {{SECONDS}} | {{DAYS}}",
      cfg,
    );
    // All three ROW placeholders collapse to the same bare integer in SQL.
    expect(out).toBe("1500000 | 1500000 | 1500000 | 2592000 | 30");
  });
});

describe("loadConfig", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("returns a stored, valid config", () => {
    window.localStorage.setItem("demoConfig", JSON.stringify({ rows: 5000, days: 90 }));
    expect(loadConfig()).toEqual({ rows: 5000, days: 90 });
  });

  it("floors fractional values", () => {
    window.localStorage.setItem("demoConfig", JSON.stringify({ rows: 5000.9, days: 90.7 }));
    expect(loadConfig()).toEqual({ rows: 5000, days: 90 });
  });

  it("falls back to the default on unparseable JSON", () => {
    window.localStorage.setItem("demoConfig", "{not json");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to the default on negative / zero / NaN values", () => {
    window.localStorage.setItem("demoConfig", JSON.stringify({ rows: -5, days: 30 }));
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    window.localStorage.setItem("demoConfig", JSON.stringify({ rows: 1000, days: 0 }));
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    window.localStorage.setItem("demoConfig", JSON.stringify({ rows: "abc", days: 30 }));
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});

describe("saveConfig", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes to localStorage and dispatches the config event", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const cfg = { rows: 1234, days: 5 };

    saveConfig(cfg);

    expect(setItem).toHaveBeenCalledWith("demoConfig", JSON.stringify(cfg));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const evt = dispatch.mock.calls[0][0] as CustomEvent;
    expect(evt.type).toBe("ic:config");
    expect(evt.detail).toEqual(cfg);
  });
});
