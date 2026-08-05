/**
 * THE RATCHET on the work list.
 *
 * parity/DEFERRALS.md says what is missing; parity/PORT_TODO.md is the list of
 * items to fix it. Two documents describing the same 95 citations will part
 * company the first time one of them is edited alone, and the failure mode is
 * silent: a row adjudicated `real` in the census and left off the work list
 * reads, to anyone counting checkboxes, exactly like a row that was finished.
 *
 * Three independent failures, and a mutation check on the first:
 *
 * 1. A file with a `real` or `partial` census row must be cited by the work
 *    list. This is the coverage guard, and the one that matters.
 * 2. The counts PORT_TODO.md states about itself must match the census and its
 *    own checkbox count. Guard 1 is keyed on FILE, deliberately - keying it on
 *    file:line would fail on every unrelated edit above a cited line, and a
 *    churning test gets turned off. The count guard is what closes that hole:
 *    a second `real` row in an already-cited file changes the total.
 * 3. Every repository path the document cites must exist, so a citation cannot
 *    rot into fiction after a rename.
 *
 * Deliberately NOT guarded: the 331 unadjudicated items of Tier 0. A test
 * asserting that number is zero would be turned off long before it went green.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CENSUS = join(ROOT, "parity", "reports", "deferral-census.tsv");
/**
 * The second tranche - the ledger's `deferred:` list items, which the keyword
 * census structurally cannot see. It is counted but NOT coverage-checked, and
 * the asymmetry is deliberate:
 *
 *  - COUNTED, because a work item whose only citation is a ledger row was
 *    invisible to the count guard, which is exactly the hole that lets an owed
 *    row hide inside an existing item. Three items added on 2026-08-04 sat
 *    outside every guard for that reason.
 *  - NOT coverage-checked, because most of this tranche is still unadjudicated
 *    (PORT_TODO 0.1), and a coverage assertion over rows nobody has read is an
 *    assertion about the reading order, not about the work.
 *
 * When 0.1 finishes, move it into the coverage guard too and delete this note.
 */
const LEDGER = join(ROOT, "parity", "reports", "ledger-deferred-items.tsv");
const TODO = join(ROOT, "parity", "PORT_TODO.md");

/** The verdicts that mean "still owed", i.e. the ones that need a work item. */
const OWED = new Set(["real", "partial"]);

interface Census {
  /** Distinct files carrying at least one owed row. */
  readonly files: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

function census(tsv: string = CENSUS): Census {
  const lines = readFileSync(tsv, "utf8").split(/\r?\n/u);
  const head = (lines[0] ?? "").split("\t");
  const iFile = head.indexOf("file");
  const iVerdict = head.indexOf("verdict");
  const files = new Set<string>();
  const counts: Record<string, number> = {};
  for (const l of lines.slice(1)) {
    if (l.trim() === "") continue;
    const c = l.split("\t");
    const verdict = c[iVerdict] ?? "";
    if (!OWED.has(verdict)) continue;
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    files.add((c[iFile] ?? "").replace(/\\/gu, "/"));
  }
  return { files: [...files].sort(), counts };
}

/**
 * Every repository path the document cites, in backticks, with any `:line`
 * suffix dropped. Anchored on the top-level directories on purpose: the prose
 * also cites upstream C files by bare name (`cave-square.c:604`), and those are
 * references to Angband 4.2.6, not paths in this tree.
 */
function citedPaths(doc: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of doc.matchAll(/`((?:packages|parity|tools|docs)\/[\w./-]+?)(?::[\d-]+)?`/gu)) {
    out.add(m[1] as string);
  }
  return out;
}

/**
 * Tokens that ATTEMPT a repo-root path: the first segment begins with one of the
 * top-level directory names but need not equal it.
 *
 * Kept separate from citedPaths, which is anchored on the exact names. An
 * anchored pattern does not match "packagesges/core/src/..." at all, so a typo'd
 * prefix is never collected and never checked - which is how one reached this
 * file and survived a green run. Deliberate shorthand relative to a package
 * root ("game/display.ts:505") has a first segment that starts with none of
 * them, so it is left alone; upstream C references have no slash at all.
 */
function pathShapedTokens(doc: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const m of doc.matchAll(
    /`((?:packages|parity|tools|docs)[\w.-]*(?:\/[\w.-]+)+\.(?:ts|tsx|mjs|js|yaml|tsv|md|txt))(?::[\d-]+)?`/gu,
  )) {
    out.add(m[1] as string);
  }
  return out;
}

function uncovered(doc: string, files: readonly string[]): readonly string[] {
  const cited = citedPaths(doc);
  return files.filter((f) => !cited.has(f));
}

describe("parity/PORT_TODO.md", () => {
  it("cites every file that still carries an owed census row", () => {
    const { files } = census();
    expect(
      uncovered(readFileSync(TODO, "utf8"), files),
      "A file with a `real` or `partial` verdict and no work item. Add it to a tier in " +
        "parity/PORT_TODO.md, or change its verdict in the census with evidence.",
    ).toEqual([]);
  });

  it("would notice an uncovered file (mutation check on the guard above)", () => {
    const { files } = census();
    const doc = readFileSync(TODO, "utf8");
    /* Drop one covered file's every citation and the guard must see it. No file
     * is written: the check is a pure function of the text, so the mutation can
     * be done in memory and cannot leave the tree dirty. */
    const victim = files[0] as string;
    const holed = doc.replaceAll(victim, "packages/core/src/nowhere.ts");
    expect(holed).not.toBe(doc);
    expect(uncovered(holed, files)).toEqual([victim]);
  });

  it("states counts that match both tranches and its own checkboxes", () => {
    const doc = readFileSync(TODO, "utf8");
    const { counts } = census();
    const led = census(LEDGER).counts;
    const real = (counts["real"] ?? 0) + (led["real"] ?? 0);
    const partial = (counts["partial"] ?? 0) + (led["partial"] ?? 0);
    const items = (doc.match(/^- \[[ x]\] /gmu) ?? []).length;
    /* Whitespace-collapsed, so re-wrapping a paragraph cannot fail this. */
    const flat = doc.replace(/\s+/gu, " ");
    for (const claim of [
      `**${items} items covering all ${real + partial} confirmed-absent citations**`,
      `**${items} items, ${real + partial} citations, ${real} \`real\` + ${partial} \`partial\`**`,
    ]) {
      expect(
        flat.includes(claim),
        `parity/PORT_TODO.md must state ${JSON.stringify(claim)}. The census now has ` +
          `${real} real and ${partial} partial rows across ${items} work items.`,
      ).toBe(true);
    }
  });

  it("cites only paths that exist", () => {
    const doc = readFileSync(TODO, "utf8");
    const all = new Set([...citedPaths(doc), ...pathShapedTokens(doc)]);
    const missing = [...all].filter((p) => !existsSync(join(ROOT, p)));
    expect(
      missing,
      "A cited path that is not in the tree - renamed, typo'd, or never there.",
    ).toEqual([]);
  });

  it("would notice a typo'd path prefix (mutation check on the guard above)", () => {
    /* The exact typo that reached this file: an anchored pattern does not match
     * "packagesges/..." at all, so the path was never collected and never
     * checked. pathShapedTokens has to see it. */
    const holed = "Sites: `packagesges/core/src/mon/lore-describe.ts:22`";
    expect([...pathShapedTokens(holed)]).toEqual(["packagesges/core/src/mon/lore-describe.ts"]);
    expect(existsSync(join(ROOT, "packagesges/core/src/mon/lore-describe.ts"))).toBe(false);
  });
});
