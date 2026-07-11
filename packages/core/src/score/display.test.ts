import { describe, expect, it } from "vitest";
import { COLOUR_L_GREEN, COLOUR_WHITE } from "../color";
import { scoreRow, scorePageRows, scoreRows } from "./display";
import type { ScoreNameResolver } from "./display";
import type { HighScore } from "./types";

/** Resolver mapping a couple of race/class indices; unknown -> null. */
const names: ScoreNameResolver = {
  raceName: (i) => (i === 0 ? "Human" : i === 3 ? "Half-Troll" : null),
  className: (i) => (i === 0 ? "Warrior" : i === 1 ? "Mage" : null),
};

function score(over: Partial<HighScore> = {}): HighScore {
  return {
    what: "0.1.0",
    pts: 6200,
    gold: 1234,
    turns: 54321,
    day: "@20260711",
    who: "Aragorn",
    uid: 501,
    pRace: 0,
    pClass: 0,
    curLev: 20,
    curDun: 5,
    maxLev: 20,
    maxDun: 5,
    how: "a giant rat",
    ...over,
  };
}

describe("scoreRow (ui-score.c display_score_page, L30)", () => {
  it("formats the classic three lines for a dungeon death", () => {
    const row = scoreRow([score()], 0, -1, names);
    expect(row.rank).toBe(1);
    expect(row.highlighted).toBe(false);
    expect(row.color).toBe(COLOUR_WHITE);
    // "%3d.%9s  %s the %s %s, level %d"
    expect(row.line1).toBe("  1.     6200  Aragorn the Human Warrior, level 20");
    expect(row.line2).toBe("Killed by a giant rat on dungeon level 5");
    expect(row.line3).toBe(
      "(User 501, Date 2026-07-11, Gold 1234, Turn 54321).",
    );
  });

  it("says 'in the town' at dungeon level 0", () => {
    const row = scoreRow([score({ curDun: 0, maxDun: 0 })], 0, -1, names);
    expect(row.line2).toBe("Killed by a giant rat in the town");
  });

  it("appends (Max N) when max level/depth exceed the death values", () => {
    const row = scoreRow(
      [score({ curLev: 20, maxLev: 25, curDun: 5, maxDun: 18 })],
      0,
      -1,
      names,
    );
    expect(row.line1).toBe(
      "  1.     6200  Aragorn the Human Warrior, level 20 (Max 25)",
    );
    expect(row.line2).toBe(
      "Killed by a giant rat on dungeon level 5 (Max 18)",
    );
  });

  it("highlights the current entry in light green", () => {
    const row = scoreRow([score(), score()], 1, 1, names);
    expect(row.highlighted).toBe(true);
    expect(row.color).toBe(COLOUR_L_GREEN);
    expect(row.rank).toBe(2);
  });

  it("shows <none> for an unknown race/class index", () => {
    const row = scoreRow([score({ pRace: 99, pClass: 99 })], 0, -1, names);
    expect(row.line1).toContain("the <none> <none>,");
  });

  it("leaves a non-@ day (TODAY, predict) unchanged", () => {
    const row = scoreRow([score({ day: "TODAY" })], 0, -1, names);
    expect(row.line3).toContain("Date TODAY,");
  });

  it("right-justifies rank (3) and points (9)", () => {
    const scores: HighScore[] = [];
    for (let i = 0; i < 7; i++) scores.push(score({ pts: 42 }));
    const row = scoreRow(scores, 6, -1, names); // rank 7
    // "  7." then points padded to 9: "       42"
    expect(row.line1.startsWith("  7.       42  ")).toBe(true);
  });
});

describe("scorePageRows / scoreRows", () => {
  it("returns at most 5 rows per page and respects count", () => {
    const scores: HighScore[] = [];
    for (let i = 0; i < 8; i++) scores.push(score({ pts: 1000 - i, who: `p${i}` }));
    const page0 = scorePageRows(scores, 0, scores.length, 2, names);
    expect(page0.length).toBe(5);
    expect(page0[2]!.highlighted).toBe(true);
    const page1 = scorePageRows(scores, 5, scores.length, 2, names);
    expect(page1.length).toBe(3); // only 3 left
  });

  it("clamps a range to the real record count", () => {
    const scores = [score({ who: "a" }), score({ who: "b" })];
    const rows = scoreRows(scores, -2, 15, -1, names);
    expect(rows.length).toBe(2);
    expect(rows[0]!.rank).toBe(1);
  });
});
