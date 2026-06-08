import { describe, expect, it } from "vitest";
import { highlight } from "../sqlHighlight";

describe("highlight", () => {
  it("HTML-escapes &, <, > from the source before wrapping anything", () => {
    const out = highlight("a < b & c > d");
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;");
    expect(out).toContain("&gt;");
    // The source has no quotes/keywords/numbers, so it produces no spans — the
    // only characters in the output are escaped entities and plain text, with
    // no raw user angle brackets left over.
    expect(out).toBe("a &lt; b &amp; c &gt; d");
  });

  it("wraps line comments in a sql-comment span", () => {
    expect(highlight("-- a note")).toContain('<span class="sql-comment">-- a note</span>');
  });

  it("wraps single-quoted strings in a sql-string span", () => {
    expect(highlight("WHERE s = 'foo'")).toContain('<span class="sql-string">\'foo\'</span>');
  });

  it("wraps bare numbers in a sql-number span", () => {
    const out = highlight("LIMIT 42");
    expect(out).toContain('<span class="sql-number">42</span>');
  });

  it("wraps keywords in a sql-keyword span", () => {
    const out = highlight("SELECT trade_id FROM t");
    expect(out).toContain('<span class="sql-keyword">SELECT</span>');
    expect(out).toContain('<span class="sql-keyword">FROM</span>');
  });

  // KNOWN LIMITATION (characterization, not aspiration): the string pass runs
  // before the keyword pass, so a keyword sitting *inside* a string literal gets
  // double-wrapped — the keyword regex matches the inner text of the freshly
  // inserted sql-string span. We pin the real behavior: a sql-keyword span
  // nested inside the sql-string span. Do NOT "fix" this expectation to assume
  // the keyword stays un-wrapped; it doesn't.
  it("double-wraps a keyword that appears inside a string literal (order artifact)", () => {
    const out = highlight("WHERE op = 'SELECT'");
    expect(out).toContain(
      '<span class="sql-string">\'<span class="sql-keyword">SELECT</span>\'</span>',
    );
  });

  // The keyword set includes STRING, but the regex is case-sensitive and the
  // injected class names are lowercase ("sql-string"), so highlighting never
  // corrupts its own emitted markup by matching a class token.
  it("does not match lowercase class-name tokens as keywords", () => {
    const out = highlight("CAST(x AS STRING)");
    // The emitted class attribute stays intact, not rewritten into a span.
    expect(out).toContain('class="sql-keyword"');
    expect(out).not.toContain('class="sql-<span');
  });
});
