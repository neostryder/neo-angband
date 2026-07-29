/**
 * The "Misc. string fixes" table's own tests, moved here with the table itself
 * when it left core (it was packages/core/src/game/msg-fixes.test.ts). The
 * assertions are unchanged; only the import is.
 */

import { describe, expect, it } from "vitest";
import { MISC_STRING_CORRECTIONS, MISSPELLINGS, miscStringFix } from "./strings";
import bugFixesHooks from "./hooks";

describe("the bug-fixes mod's Misc. string fixes (docs/modding/BUG_FIXES.md #14)", () => {
  it("normalizes upstream's single-spaced sentence breaks UP to its double", () => {
    /* The rule direction is the measurement's: 15 double-spaced breaks to 2
     * single-spaced ones after a period, so the double space is the convention
     * and the single space is the slip. Collapsing the majority would be a
     * restyling, not a normalization. */
    expect(miscStringFix("Bad effect passed to effect_do(). Please report this bug.")).toBe(
      "Bad effect passed to effect_do().  Please report this bug.",
    );
    expect(miscStringFix("The ground shakes! The ceiling caves in!")).toBe(
      "The ground shakes!  The ceiling caves in!",
    );
  });

  it("leaves the already-double-spaced majority EXACTLY as upstream wrote it", () => {
    /* Real upstream literals (ui-game.c:1153, ui-game.c:720, gen-util.c:422).
     * These are the whole point of the rule change: they used to be rewritten. */
    for (const s of [
      "Saving failed.  Try again? ",
      "A panic save exists.  Use it? ",
      "A savefile for that name exists.  Overwrite it? ",
      "Failed to place player; please report.  Restarting generation.",
      "Word of Recall is already active.  Do you want to cancel it? ",
    ]) {
      expect(miscStringFix(s)).toBe(s);
    }
  });

  it("is identity for every message not in the table", () => {
    for (const s of [
      "You have 5 Flasks of oil (1st c).",
      "You feel something roll beneath your feet.",
      "You bite the kobold. (7)", // an annotation, not a sentence break
      "You get in a shield bash! (4)",
      "Str.   18/70   Hit.   +12", // column alignment
      "etc. and so on",
    ]) {
      expect(miscStringFix(s)).toBe(s);
    }
  });

  it("cannot touch text the player typed", () => {
    /* Why this is an exact-match table and not a rewrite rule: messages reach
     * the sink already interpolated, so a general ". " -> ".  " would edit
     * inscriptions and character names. */
    expect(miscStringFix("You have a Dagger {@w1. Keep!} (c).")).toBe(
      "You have a Dagger {@w1. Keep!} (c).",
    );
    expect(miscStringFix("Sgt. Pepper hits you.")).toBe("Sgt. Pepper hits you.");
  });

  it("holds exactly the four applicable rows, all of them real upstream text", () => {
    const keys = Object.keys(MISC_STRING_CORRECTIONS);
    expect(keys).toHaveLength(4);
    for (const [from, to] of Object.entries(MISC_STRING_CORRECTIONS)) {
      /* Every row differs from its key ONLY by doubling one space after a
       * sentence end - no wording changes smuggled into a spacing patch. This is
       * also the messageText hook's limit: a hook may RESTATE a message, never
       * change what it means. */
      expect(to.replace(/([.!?]) {2}/gu, "$1 ")).toBe(from);
      expect(to).not.toBe(from);
    }
  });

  it("keeps the misspellings sweep checkable rather than asserted", () => {
    /* The claim in the module note is "zero misspellings in upstream's message
     * corpus OR its gamedata". The list is data so a future sweep can re-run
     * it; the pairs must at least be well-formed and genuinely different. */
    expect(MISSPELLINGS.length).toBeGreaterThan(20);
    for (const [wrong, right] of MISSPELLINGS) {
      expect(wrong).not.toBe(right);
      expect(wrong).toMatch(/^[a-z]+$/u);
      expect(right).toMatch(/^[a-z]+$/u);
    }
    /* None of them is a correction we actually had to make - the table above is
     * spacing only. If a sweep ever finds one, this stops being true. */
    const table = Object.keys(MISC_STRING_CORRECTIONS).join(" ").toLowerCase();
    for (const [wrong] of MISSPELLINGS) expect(table).not.toContain(wrong);
  });

  it("reaches the message sink only through the messageText hook", () => {
    /* The host applies state.modHooks.messageText at its single message sink; the
     * mod's job is to install the table there and only when the patch is on. */
    expect(bugFixesHooks({ "bugfix.miscStrings": false }).messageText).toBeUndefined();
    const fix = bugFixesHooks({ "bugfix.miscStrings": true }).messageText!;
    expect(fix("Oops! It feels deathly cold!")).toBe("Oops!  It feels deathly cold!");
    expect(fix("You hit the kobold.")).toBe("You hit the kobold.");
  });
});
