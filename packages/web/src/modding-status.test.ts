/**
 * The author-facing status index in `docs/modding/README.md` against the
 * measurement it summarises in `docs/modding/MOD_REACH.md`.
 *
 * A summary table of "what works today" is the single most dangerous thing in a
 * docs directory, because it is the page an author reads FIRST and the page
 * nobody edits when a seam lands. MOD_REACH row 2 sat on stale wording for nine
 * days and cost two reviewers a duplicate P1 each; that was one row on the page
 * whose whole job is being accurate. A second copy of every status, on a page
 * that is not the measurement, would rot faster and be believed harder.
 *
 * So the index is allowed to exist only because this test holds it to the gap
 * list. It does not check prose. It checks the one thing that makes the index
 * either useful or a lie: that **Complete** here means yes/closed there, and
 * that **WIP** / **Not yet** here means it is not.
 *
 * It also runs the other direction, which is the half that catches a NEW gap:
 * any gap row that is not yes/closed must appear in the index. Opening gap 22
 * without telling authors it exists is exactly the silence this is here to
 * prevent.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DOCS = join(import.meta.dirname, "..", "..", "..", "docs", "modding");

const README = readFileSync(join(DOCS, "README.md"), "utf8");
const MOD_REACH = readFileSync(join(DOCS, "MOD_REACH.md"), "utf8");

/** The three words the index is allowed to use. */
type Status = "Complete" | "WIP" | "Not yet";

interface IndexRow {
  readonly what: string;
  readonly status: Status;
  /** Gap-list rows this line claims to summarise; empty for a non-gap source. */
  readonly gaps: readonly number[];
}

/** Cells of one markdown table row, trimmed, without the outer pipes. */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Every row of the table whose header row contains `headerCell`. */
function tableRows(markdown: string, headerCell: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith("|") && cells(l).includes(headerCell));
  expect(start, `no table with a "${headerCell}" column`).toBeGreaterThanOrEqual(0);
  const out: string[][] = [];
  // +2 skips the header and the `| --- |` separator.
  for (let i = start + 2; i < lines.length && lines[i]?.startsWith("|"); i++) {
    out.push(cells(lines[i] as string));
  }
  return out;
}

function indexRows(): IndexRow[] {
  return tableRows(README, "Status").map(([what, status, measured]) => {
    const word = (status ?? "").replace(/\*/g, "").trim();
    expect(["Complete", "WIP", "Not yet"], `"${what}" uses a status word the index does not define`).toContain(word);
    return {
      what: what ?? "",
      status: word as Status,
      gaps: [...(measured ?? "").matchAll(/\bgap (\d+)\b/g)].map((m) => Number(m[1])),
    };
  });
}

/** The gap list's `Today` column, by row number. */
function gapStatuses(): Map<number, string> {
  // Keyed on `Today`, which only the gap list has. `Capability` looked like the
  // obvious column and is NOT unique - the facade table 500 lines earlier uses
  // it too, and matching that one yields a map with none of the gap numbers in
  // it. Two numbered tables in one file is exactly how a cross-reference ends
  // up pointing at the wrong measurement.
  const out = new Map<number, string>();
  for (const row of tableRows(MOD_REACH, "Today")) {
    const n = Number(row[0]);
    if (Number.isInteger(n)) out.set(n, row[2] ?? "");
  }
  return out;
}

/** Does a gap's `Today` cell say the capability is there? */
function isClosed(today: string): boolean {
  return /\b(yes|closed)\b/i.test(today);
}

describe("the modding status index says what MOD_REACH measured", () => {
  const index = indexRows();
  const gaps = gapStatuses();

  it("found both tables", () => {
    expect(index.length).toBeGreaterThan(20);
    expect(gaps.size).toBeGreaterThan(15);
  });

  it("references only gap rows that exist", () => {
    for (const row of index) {
      for (const n of row.gaps) {
        expect(gaps.has(n), `"${row.what}" cites gap ${n}, which the gap list does not have`).toBe(true);
      }
    }
  });

  it("never calls a surface Complete that the gap list has not closed", () => {
    for (const row of index.filter((r) => r.status === "Complete")) {
      for (const n of row.gaps) {
        const today = gaps.get(n) as string;
        expect(isClosed(today), `the index calls "${row.what}" Complete, but gap ${n} reads: ${today}`).toBe(true);
      }
    }
  });

  it("never calls a surface WIP or Not yet that the gap list has closed", () => {
    for (const row of index.filter((r) => r.status !== "Complete")) {
      for (const n of row.gaps) {
        const today = gaps.get(n) as string;
        expect(isClosed(today), `the index still calls "${row.what}" ${row.status}, but gap ${n} reads: ${today}`).toBe(
          false,
        );
      }
    }
  });

  it("names every gap that is still open, so a new one cannot land unannounced", () => {
    const cited = new Set(index.flatMap((r) => r.gaps));
    for (const [n, today] of gaps) {
      if (isClosed(today)) continue;
      expect(cited.has(n), `gap ${n} is open (${today}) but the status index never mentions it`).toBe(true);
    }
  });
});
