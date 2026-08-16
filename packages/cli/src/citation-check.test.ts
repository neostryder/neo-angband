/**
 * tools/citation-check.mjs, tested in BOTH directions - and the negative
 * control built the hard way.
 *
 * Every parity claim in this repository cites an upstream C line and line
 * number (say, store.c at line 1924, or ui-store.c over lines 208 to 233);
 * those citations are the only evidence a piece of ported TypeScript
 * reproduces the behaviour it claims to. Two independent audits
 * (2026-08-14) found 38+ wrong ones by hand, including a citation to line
 * 207 of an upstream file that is only 149 lines long. An LLM sweep tried
 * to automate the audit and had to be thrown out: its function-name
 * extractor produced ~1,818 "WRONG" verdicts, almost all of them a symbol
 * name that merely appeared in nearby prose (an English word sitting in
 * front of a well-formed citation reads exactly like a real anchor, but
 * names nothing). That is the failure mode this test is guarding against as
 * much as it is guarding the checker's positive detection - a scanner that
 * cries wolf gets disabled, and then the real drift returns invisibly.
 *
 * THE NEGATIVE CONTROL, BUILT BY REMOVAL. A hand-picked "obviously bad"
 * citation proves only that the checker rejects the one string it was
 * handed - it says nothing about whether the checker is actually measuring
 * anything. So every failing case below starts from a citation that is
 * mechanically TRUE against a fixture, asserts the checker agrees, then
 * removes the very thing that made it true (shrinks the cited file so the
 * line falls off the end; shrinks the cited function's body so the same
 * line now falls in the NEXT function instead) and asserts the checker's
 * verdict flips. A control that only ever passes proves nothing; this file
 * watches it fail on purpose, once per verdict class.
 *
 * A NOTE ON THIS FILE'S OWN TEXT. Every fixture citation below is built by
 * string concatenation rather than written as a contiguous literal, because
 * citation-check.mjs scans this very file when it runs over the real repo
 * (packages/cli/src/**\/*.ts is one of its four inputs) - a bare fixture
 * filename, colon, line number sitting in this source as plain text would be
 * extracted as a citation to a fixture file that does not exist under the
 * real reference/, and would report itself as OUT OF RANGE on every run.
 * private-scan.test.ts uses the same technique for its own sensitive terms,
 * for the same reason: a detector's test fixtures must not look like real
 * input to the detector scanning the tree the fixtures live in.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../tools/citation-check.mjs", import.meta.url));

/* Never written as a literal filename-colon-number - see the file-level
 * comment above. `cite(n)` joins the pieces at runtime only. */
const FIXTURE_C = ["fixture", ".c"].join("");
const cite = (spec: string): string => `${FIXTURE_C}:${spec}`;
const citeL = (spec: string): string => `${FIXTURE_C} L${spec}`;
const MAKEFILE = ["Make", "file"].join("");

interface Result {
  code: number;
  out: string;
  json: {
    total: number;
    counts: {
      OUT_OF_RANGE: number;
      ANCHOR_MISMATCH: number;
      ANCHOR_OK: number;
      UNCHECKED: number;
    };
    findings: Array<{
      verdict: string;
      loc: string;
      citation: string;
      reason: string;
      symbol?: string;
    }>;
  };
}

function run(root: string, ...extra: string[]): Result {
  const r = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--json", ...extra],
    { encoding: "utf8" },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  let json: Result["json"];
  try {
    json = JSON.parse(r.stdout ?? "{}");
  } catch {
    json = { total: -1, counts: { OUT_OF_RANGE: -1, ANCHOR_MISMATCH: -1, ANCHOR_OK: -1, UNCHECKED: -1 }, findings: [] };
  }
  return { code: r.status ?? -1, out, json };
}

let scratch = "";
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

/** A fresh, minimal fixture tree: reference/src/<c>, packages/core/src/<ts>. */
function makeFixture(): { root: string; refC: string; srcTs: string } {
  scratch = mkdtempSync(join(tmpdir(), "citation-check-"));
  const refDir = join(scratch, "reference", "src");
  const srcDir = join(scratch, "packages", "core", "src");
  mkdirSync(refDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });
  return {
    root: scratch,
    refC: join(refDir, "fixture.c"),
    srcTs: join(srcDir, "fixture.ts"),
  };
}

describe("citation-check: OUT OF RANGE, via removing the mechanism", () => {
  it("passes a citation that fits, then fails the SAME citation once the file is shrunk under it", () => {
    const { root, refC, srcTs } = makeFixture();

    /* real_func's signature sits on line 9 of an 11-line file - the citation
     * below is mechanically TRUE. */
    const fullC = [
      "int unrelated_helper(int x)",
      "{",
      "    return x + 1;",
      "}",
      "",
      "/**",
      " * Doubles the value passed in.",
      " */",
      "int real_func(int x)",
      "{",
      "    return x * 2;",
      "}",
      "",
    ].join("\n");
    writeFileSync(refC, fullC, "utf8");
    writeFileSync(srcTs, `/** real_func (${cite("9")}) doubles a value. */\nexport {};\n`, "utf8");

    const before = run(root, "--check");
    expect(before.code, before.out).toBe(0);
    expect(before.json.counts.OUT_OF_RANGE, before.out).toBe(0);
    expect(before.json.counts.ANCHOR_OK, before.out).toBe(1);

    /* Remove the mechanism: the file no longer HAS a line 9 at all. Nothing
     * about the citation in fixture.ts changed. */
    const shrunkC = fullC.split("\n").slice(0, 4).join("\n");
    writeFileSync(refC, shrunkC, "utf8");

    const after = run(root, "--check");
    expect(after.code, after.out).toBe(1);
    expect(after.json.counts.OUT_OF_RANGE, after.out).toBe(1);
    const finding = after.json.findings.find((f) => f.verdict === "OUT_OF_RANGE");
    expect(finding?.citation).toBe(cite("9"));
    expect(finding?.reason).toMatch(/has 4 lines/u);
  });

  it("--check exits 0 when nothing is out of range, even with an unrelated anchor problem", () => {
    /* The spec ties --check to OUT OF RANGE only. An ANCHOR MISMATCH alone
     * must not fail the gate - asserted explicitly so a future change that
     * widens --check's trigger is a deliberate one, not a silent one. */
    const { root, refC, srcTs } = makeFixture();
    writeFileSync(
      refC,
      ["int real_func(int x)", "{", "    return x + 1;", "}", "int other_func(int y)", "{", "    return y;", "}", ""].join("\n"),
      "utf8",
    );
    /* Line 5 is other_func's signature, not real_func's - a real anchor
     * mismatch, but it is IN RANGE. */
    writeFileSync(srcTs, `/** real_func (${cite("5")}) is wrong on purpose. */\nexport {};\n`, "utf8");
    const { code, json, out } = run(root, "--check");
    expect(json.counts.ANCHOR_MISMATCH, out).toBe(1);
    expect(code, out).toBe(0);
  });
});

describe("citation-check: ANCHOR MISMATCH, via removing the mechanism", () => {
  it("passes a citation that lands in the right body, then fails once the body is shrunk out from under it", () => {
    const { root, refC, srcTs } = makeFixture();

    /* real_func's body runs lines 1-7; line 5 is inside it. Mechanically
     * true, and NOT because "real_func" merely appears near line 5 - the
     * checker requires the actual brace-matched body to contain the line. */
    const fullC = [
      "int real_func(int x)",
      "{",
      "    int a = x + 1;",
      "    int b = a * 2;",
      "    int c = b - 3;",
      "    return c;",
      "}",
      "",
      "int other_func(int y)",
      "{",
      "    return y * 100;",
      "}",
      "",
    ].join("\n");
    writeFileSync(refC, fullC, "utf8");
    writeFileSync(srcTs, `/** real_func (${cite("5")}) computes a running total. */\nexport {};\n`, "utf8");

    const before = run(root);
    expect(before.json.counts.ANCHOR_MISMATCH, before.out).toBe(0);
    expect(before.json.counts.ANCHOR_OK, before.out).toBe(1);

    /* Remove the mechanism: shrink real_func's body so it no longer reaches
     * line 5 - and because the file also shrinks, line 5 now falls on
     * OTHER_FUNC's own signature line. This is the exact failure mode the
     * checker exists to catch: a citation that lands in the WRONG function,
     * not merely off by a few lines within the right one. The citation
     * string in fixture.ts is untouched. */
    const shrunkC = [
      "int real_func(int x)",
      "{",
      "    return x + 1;",
      "}",
      "int other_func(int y)",
      "{",
      "    return y * 100;",
      "}",
      "",
    ].join("\n");
    writeFileSync(refC, shrunkC, "utf8");

    const after = run(root);
    expect(after.json.counts.ANCHOR_MISMATCH, after.out).toBe(1);
    expect(after.json.counts.ANCHOR_OK, after.out).toBe(0);
    const finding = after.json.findings.find((f) => f.verdict === "ANCHOR_MISMATCH");
    expect(finding?.symbol).toBe("real_func");
    expect(finding?.citation).toBe(cite("5"));
  });

  it("does not flag a bare English word standing next to a citation", () => {
    /* The false-positive class that sank the LLM sweep, reproduced on
     * purpose: "depth" is a real English word sitting directly in front of
     * a well-formed citation, and it is not snake_case, so it must never be
     * treated as a code symbol. */
    const { root, refC, srcTs } = makeFixture();
    writeFileSync(refC, ["int real_func(int x)", "{", "    return x + 1;", "}", ""].join("\n"), "utf8");
    writeFileSync(
      srcTs,
      `/** the per-level total, summed at that depth (${cite("1-2")}). */\nexport {};\n`,
      "utf8",
    );
    const { json, out } = run(root);
    expect(json.counts.ANCHOR_MISMATCH, out).toBe(0);
    expect(json.counts.UNCHECKED, out).toBe(1);
  });
});

describe("citation-check: citation forms", () => {
  it("resolves store.c:N, src/store.c:N, reference/src/store.c:N, L-ranges (hyphen and en dash), and Makefile:N", () => {
    const { root, refC, srcTs } = makeFixture();
    const tenLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1};`).join("\n");
    writeFileSync(refC, `${tenLines}\n`, "utf8");
    const makefileDir = join(root, "reference", "lib", "gamedata");
    mkdirSync(makefileDir, { recursive: true });
    writeFileSync(join(makefileDir, MAKEFILE), Array.from({ length: 20 }, () => "x").join("\n"), "utf8");

    writeFileSync(
      srcTs,
      [
        `/* ${cite("3")} */`,
        `/* src/${cite("4")} */`,
        `/* reference/src/${cite("5")} */`,
        `/* ${cite("2-4")} */`,
        `/* ${citeL("2-4")} */`,
        `/* ${citeL("2–4")} */`, // en dash
        `/* lib/gamedata/${MAKEFILE}:8 */`,
        "export {};",
        "",
      ].join("\n"),
      "utf8",
    );

    const { json, out } = run(root);
    expect(json.total, out).toBe(7);
    expect(json.counts.OUT_OF_RANGE, out).toBe(0);
  });

  it("never treats a same-repo .ts/.yaml self-citation as an upstream C citation", () => {
    const { root, refC, srcTs } = makeFixture();
    writeFileSync(refC, "int x;\n", "utf8");
    /* `brand-slay.ts:69` and `gamedata.yaml:502` name files IN THIS repo, not
     * upstream C - extracting them as if they were `store.c:1924` would
     * silently resolve against nothing (or against an unrelated reference/
     * file of the same basename) and either miss real drift or invent it. */
    writeFileSync(
      srcTs,
      "/* see combat/brand-slay.ts:69 and parity/ledger/gamedata.yaml:502 */\nexport {};\n",
      "utf8",
    );
    const { json, out } = run(root);
    expect(json.total, out).toBe(0);
  });
});
