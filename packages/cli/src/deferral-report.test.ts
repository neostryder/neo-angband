/**
 * THE RATCHET on deferral notes.
 *
 * "Deferred" was written 439 times across this repository over many months, and
 * by the time anyone asked what was actually missing, nobody could tell which of
 * those notes described a hole and which described work that had landed since.
 * 137 of them turned out to be the latter. parity/DEFERRALS.md is the answer,
 * and these tests are what stop it becoming another one of those notes.
 *
 * Three independent failures:
 *
 * 1. A NEW deferral note with no verdict fails the suite. That is the ratchet:
 *    writing "deferred" in a comment now obliges you to say which kind of
 *    deferral it is, in the census, with evidence.
 * 2. A verdict outside the vocabulary fails, so the categories stay adjudicable
 *    instead of drifting into free text.
 * 3. The generated appendix of parity/DEFERRALS.md must be current, so the
 *    document cannot describe a census that has since changed.
 *
 * And the third test is mutation-checked against a doctored copy of the file,
 * because a --check that always passes would be worse than no check at all.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CENSUS = join(ROOT, "parity", "reports", "deferral-census.tsv");
const DOC = join(ROOT, "parity", "DEFERRALS.md");
const REPORT = join(ROOT, "parity", "tools", "deferral-report.mjs");

/** The closed vocabulary, mirroring parity/tools/deferral-verdict.mjs. */
const VERDICTS = new Set([
  "ported",
  "note-is-fix",
  "real",
  "real-dead",
  "partial",
  "n-a",
  /* The third finished state (owner ruling 2026-08-09), added to the vocabulary
   * 2026-08-14. Deliberately distinct from `n-a`: that one is a claim about this
   * port's platform, this one is a measurement of upstream's own C. */
  "unreachable-in-upstream",
  "divergence",
  "stale-doc",
  "not-a-deferral",
]);

interface Row {
  readonly ref: string;
  readonly verdict: string;
  readonly evidence: string;
}

function censusRows(): readonly Row[] {
  const lines = readFileSync(CENSUS, "utf8").split(/\r?\n/u);
  const head = (lines[0] ?? "").split("\t");
  const iFile = head.indexOf("file");
  const iLine = head.indexOf("line");
  const iVerdict = head.indexOf("verdict");
  const iEvidence = head.indexOf("evidence");
  const out: Row[] = [];
  for (const l of lines.slice(1)) {
    if (l.trim() === "") continue;
    const c = l.split("\t");
    out.push({
      ref: `${c[iFile] ?? "?"}:${c[iLine] ?? "?"}`,
      verdict: c[iVerdict] ?? "",
      evidence: c[iEvidence] ?? "",
    });
  }
  return out;
}

describe("deferral census", () => {
  it("has a verdict for every row", () => {
    const blank = censusRows().filter((r) => r.verdict === "");
    expect(
      blank.map((r) => r.ref),
      "A deferral note without a verdict. Re-run node parity/tools/deferral-census.mjs, " +
        "then record each one with node parity/tools/deferral-verdict.mjs <file>:<line> <verdict> <evidence>. " +
        "See parity/DEFERRALS.md for what the verdicts mean.",
    ).toEqual([]);
  });

  it("uses only the closed vocabulary, and every verdict carries evidence", () => {
    const bad = censusRows().filter((r) => !VERDICTS.has(r.verdict));
    expect(bad.map((r) => `${r.ref} -> ${r.verdict}`)).toEqual([]);
    const bare = censusRows().filter((r) => r.evidence.trim() === "");
    expect(
      bare.map((r) => r.ref),
      "A verdict with no evidence is an opinion. Name the file, the C reference or the mechanism.",
    ).toEqual([]);
  });

  it("keeps parity/DEFERRALS.md's generated appendix current", () => {
    expect(() => execFileSync(process.execPath, [REPORT, "--check"], { cwd: ROOT })).not.toThrow();
  });

  it("would notice a stale appendix (mutation check on the guard above)", () => {
    const before = readFileSync(DOC, "utf8");
    try {
      writeFileSync(DOC, before.replace("## Appendix: every row", "## Appendix: every ROW"), "utf8");
      expect(() => execFileSync(process.execPath, [REPORT, "--check"], { cwd: ROOT, stdio: "pipe" })).toThrow();
    } finally {
      writeFileSync(DOC, before, "utf8");
    }
    /* And the restore worked, so a failure here cannot leave the tree dirty. */
    expect(readFileSync(DOC, "utf8")).toBe(before);
  });
});
