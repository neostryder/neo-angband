/**
 * on_new_level announces the level feeling (game-world.c:1047-1049).
 *
 * WHY THIS TEST EXISTS, AND WHY IT IS A SOURCE PIN
 *
 * The whole feeling system was ported and CORRECT: both message tables
 * transcribed verbatim (game/cave-cmd.ts), calc_obj_feeling / calc_mon_feeling,
 * place_feeling's scatter, feeling_squares, the birth_feelings gate, and the LF:
 * status row. And `displayFeeling` had exactly ONE caller in the entire repo -
 * the ^F command. Nothing announced a feeling on arrival, so a player who never
 * pressed ^F never saw one in a whole game.
 *
 * That is the failure mode code review cannot find ([[code-review-cannot-find-absence]]):
 * every line you read is right, and the defect is a call that was never written.
 * Only a call-site assertion catches it, so that is what this is.
 *
 * It is a SOURCE pin rather than a behavioural one because the three call sites
 * are inside changeLevel/startGame closures that need a full bound pack, a
 * generated level and a live FOV to reach - and a behavioural test that booted
 * all that would pass just as happily with the call present at one of the three
 * sites as at all three. The thing at risk here is COVERAGE of the sites, which
 * is exactly what source text measures well.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GAME = readFileSync(new URL("./game.ts", import.meta.url), "utf8");

/** game.ts with comments stripped: a comment naming a call is not a call. */
const CODE = GAME.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("every on_new_level path announces the feeling", () => {
  /* search(player) is the statement immediately AFTER display_feeling in
   * on_new_level (game-world.c:1049 then :1052), so each search() call in a
   * level-arrival path marks one site that needs the announcement. */
  const arrivals = CODE.match(/^.*\bsearch\(state\);/gm) ?? [];

  it("has the three arrival sites this test was written against", () => {
    /* If this number changes, a level-arrival path was added or removed and the
     * assertions below no longer cover what they claim to. Re-derive rather than
     * bumping the number. */
    expect(arrivals.length).toBe(3);
  });

  it("announces at every one of them, BEFORE search()", () => {
    /* Upstream order: display_feeling (game-world.c:1047-1049) then search
     * (:1052). Both are observable - the feeling message and the passive-search
     * discovery messages land on the same message line in that order. */
    const calls = CODE.match(/announceFeeling\(state, reg\);\s*search\(state\);/g) ?? [];
    expect(
      calls.length,
      "an on_new_level path reaches search() without announcing the feeling",
    ).toBe(arrivals.length);
  });

  it("guards on depth in ONE place, not at the call sites", () => {
    /* The depth guard is the CALLER's upstream (`if (player->depth)`), and
     * displayFeeling's own town line - "Looks like a typical town." - is reachable
     * only through ^F. Putting the guard inside the one helper is what keeps the
     * town silent on every arrival; putting it at three call sites is what lets
     * one of them drift. */
    const body = CODE.slice(CODE.indexOf("function announceFeeling"));
    expect(body.slice(0, 200)).toContain("if (!state.chunk.depth) return;");
    expect(body.slice(0, 200)).toContain("feelingNeed: reg.constants.feelingNeed");
  });

  it("passes objOnly false, so arrival gets the JOINED monster+object line", () => {
    /* display_feeling(false) at game-world.c:1049. objOnly true is the separate
     * mid-exploration reveal (cave-view.c:849), which is the "feeling" event's
     * job, not this one's - passing true here would show the object half twice
     * and the danger half never. */
    const body = CODE.slice(CODE.indexOf("function announceFeeling"));
    expect(body.slice(0, 200)).not.toContain("objOnly");
  });
});

describe("the arena paths deliberately do NOT announce", () => {
  it("keeps upstream's arena_level early return", () => {
    /* game-world.c:1044-1046 returns from on_new_level before display_feeling
     * when arena_level is set, so an arena has no feeling at all. A future
     * "announce everywhere" simplification would break that silently. */
    const arena = CODE.match(/arenaLevel/g) ?? [];
    expect(arena.length, "the arena paths vanished; re-derive this test").toBeGreaterThan(0);
    /* No announceFeeling within the arena setup blocks: assert by counting, since
     * the three legitimate calls are already pinned above. */
    const all = CODE.match(/announceFeeling\(/g) ?? [];
    expect(
      all.length,
      "announceFeeling gained a call site - is it an arena path?",
    ).toBe(4); // 3 call sites + the declaration
  });
});
