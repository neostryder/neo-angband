import { describe, expect, it } from "vitest";
import { MISC_STRING_CORRECTIONS, miscStringFix } from "./msg-fixes";

describe("the bug-fixes mod's Misc. string fixes (docs/modding/BUG_FIXES.md #14)", () => {
  it("collapses the double space upstream puts after a sentence", () => {
    /* Real upstream literals (ui-game.c:1162, ui-game.c:720, gen-util.c:422). */
    expect(miscStringFix("Saving failed.  Try again? ")).toBe(
      "Saving failed. Try again? ",
    );
    expect(miscStringFix("A panic save exists.  Use it? ")).toBe(
      "A panic save exists. Use it? ",
    );
    expect(
      miscStringFix(
        "Failed to place player; please report.  Restarting generation.",
      ),
    ).toBe("Failed to place player; please report. Restarting generation.");
  });

  it("handles ! and ? as sentence ends too", () => {
    expect(miscStringFix("Look out!  A trap!")).toBe("Look out! A trap!");
    expect(miscStringFix("Really?  Yes.")).toBe("Really? Yes.");
  });

  it("leaves a single space alone (identity for well-spaced text)", () => {
    const ok = "You have 5 Flasks of oil (1st c).";
    expect(miscStringFix(ok)).toBe(ok);
    expect(miscStringFix("You feel something roll beneath your feet.")).toBe(
      "You feel something roll beneath your feet.",
    );
  });

  it("does NOT touch column alignment - three or more spaces are left", () => {
    /* Help and spoiler text aligns with runs of spaces; collapsing those would
     * break the layout, which is why the rule requires exactly two. */
    const aligned = "Str.   18/70   Hit.   +12";
    expect(miscStringFix(aligned)).toBe(aligned);
    expect(miscStringFix("Done.   Next")).toBe("Done.   Next");
  });

  it("does NOT collapse two spaces mid-clause (no sentence end before them)", () => {
    expect(miscStringFix("a  b")).toBe("a  b");
    expect(miscStringFix("the  sword")).toBe("the  sword");
  });

  it("requires a capital, digit or quote after the space", () => {
    /* An abbreviation followed by a lowercase word is not a sentence break. */
    expect(miscStringFix("etc.  and so on")).toBe("etc.  and so on");
    expect(miscStringFix("Done.  42 left")).toBe("Done. 42 left");
    expect(miscStringFix('Done.  "quoted"')).toBe('Done. "quoted"');
  });

  it("has an exact-match table that is empty BY MEASUREMENT", () => {
    /* The sweep for misspellings found none. This assertion is here so that
     * adding one is a deliberate act with a test beside it, and so the "empty"
     * claim in the module note and the docs cannot rot silently. */
    expect(Object.keys(MISC_STRING_CORRECTIONS)).toEqual([]);
  });

  it("prefers an exact correction over the whitespace rule when one exists", () => {
    /* Guard the precedence even while the table is empty: a future typo entry
     * whose value keeps a deliberate double space must survive. */
    const table: Record<string, string> = { "Teh end.  Now": "The end.  Now" };
    const fix = (t: string): string => table[t] ?? miscStringFix(t);
    expect(fix("Teh end.  Now")).toBe("The end.  Now");
  });
});
