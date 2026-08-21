/**
 * The restart-on-death loop, on the host side of the seam.
 *
 * WHY THIS READS SOURCE. main.ts boots a game on import and cannot be imported by
 * a test, and the behaviour being pinned here is not a function's return value -
 * it is an ORDER and an ABSENCE inside one branch of the game loop's tail. The
 * function is in core and is tested for real there
 * (core/src/session/reincarnate.test.ts, 18 behavioural tests); what cannot be
 * reached from there is whether the host calls it, where, and what the human path
 * does when it does not. Same instrument, and the same reason, as
 * mod-teardown.test.ts and mod-bags.test.ts: a citation in a comment must not be
 * able to satisfy a claim about code.
 *
 * THE MOST IMPORTANT TEST IN THE FILE is the regression guard - a human player's
 * death must reach the tombstone, the dropped save slot, the score entry and the
 * death menu exactly as it did before this loop existed. A bug in the other
 * direction costs a screensaver a respawn; a bug in this one silently resurrects
 * somebody's dead character and overwrites their save with it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, "main.ts"), "utf8");

/**
 * main.ts with comments stripped. Every assertion below runs against this, so a
 * doc comment naming a function cannot stand in for a call to it.
 */
const NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//gu, "").replace(
  /(^|[^:])\/\/[^\n]*/gu,
  "$1",
);

/** The DEAD branch of continueAdvance, from its test to the next status test. */
function deadBranch(): string {
  const at = NO_COMMENTS.indexOf("status === LOOP_STATUS.DEAD");
  expect(at, "continueAdvance still branches on LOOP_STATUS.DEAD").toBeGreaterThan(-1);
  const end = NO_COMMENTS.indexOf("LOOP_STATUS.LEVEL_CHANGE", at);
  expect(end, "the DEAD branch still ends at the LEVEL_CHANGE one").toBeGreaterThan(at);
  return NO_COMMENTS.slice(at, end);
}

/** The body of reincarnateAutoplayer. */
function reincarnateBody(): string {
  const at = NO_COMMENTS.indexOf("function reincarnateAutoplayer()");
  expect(at, "main.ts still has the reincarnateAutoplayer helper").toBeGreaterThan(-1);
  const end = NO_COMMENTS.indexOf("function continueAdvance", at);
  expect(end, "the helper still sits ahead of continueAdvance").toBeGreaterThan(at);
  return NO_COMMENTS.slice(at, end);
}

describe("a human player's death is untouched", () => {
  /* THE REGRESSION GUARD. If any of these four moved above the reincarnation
   * check, or if the check stopped returning, a human character's death would run
   * a respawn - or run half the death flow and then a respawn, which is worse. */
  it("runs the reincarnation check FIRST, ahead of every death-flow step", () => {
    const body = deadBranch();
    const check = body.indexOf("reincarnateAutoplayer()");
    expect(check).toBeGreaterThan(-1);
    for (const step of [
      "dead = true",
      "markDead(activeId)",
      "setActiveId(null)",
      "deathKnowledge(",
      "enterScore(",
      "showTombstone(",
      "runDeathMenu()",
    ]) {
      const at = body.indexOf(step);
      expect(at, `the DEAD branch still does ${step}`).toBeGreaterThan(-1);
      expect(at, `${step} must not run before the reincarnation check`).toBeGreaterThan(check);
    }
  });

  it("leaves the branch entirely when it reincarnates", () => {
    /* Falling through instead of returning would run the tombstone over the top
     * of a living character - the death menu, the dropped slot and all. */
    const body = deadBranch();
    expect(body).toMatch(/if \(reincarnateAutoplayer\(\)\) return;/u);
  });

  it("is gated on the autoplayer slot and nothing else", () => {
    /* `installedController` is null whenever a human has the keyboard: a mod fills
     * it only by returning a controller from controller(), and the Borg returns one
     * only when its own borg.autoplay flag is on. So for a human this is one null
     * check and the branch below is unchanged. */
    const body = reincarnateBody();
    expect(body).toMatch(/const holder = installedController;/u);
    expect(body).toMatch(/if \(!holder\) return false;/u);
  });

  it("has exactly one place that decides a death is terminal", () => {
    /* A second `dead = true` inside the DEAD branch would be a second door the
     * gate does not cover. */
    const occurrences = deadBranch().match(/\bdead = true\b/gu) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("the reincarnation itself", () => {
  it("calls the engine's own reincarnate rather than re-deriving birth", () => {
    expect(reincarnateBody()).toMatch(/game\.reincarnate\(\{/u);
  });

  it("marks the new character NOSCORE_BORG, every time", () => {
    /* player_generate zeroes the field, so the mark has to ride each respawn and
     * not only the first. */
    expect(reincarnateBody()).toMatch(/noscore:\s*NOSCORE\.BORG/u);
  });

  it("asks for no race or class, so the engine rolls them", () => {
    /* borg_cfg[BORG_RESPAWN_RACE] == -1 is upstream's default and a reroll is what
     * it means. Pinning a build here would make every character in a screensaver
     * run the same one. */
    const body = reincarnateBody();
    expect(body).not.toMatch(/raceName:/u);
    expect(body).not.toMatch(/className:/u);
  });

  it("opens no new save file, claims no new slot, and does not reload the page", () => {
    /* THE OTHER HALF OF "SAME SESSION". Any of these would turn an in-session
     * reincarnation into a new game that happens to follow one. */
    const body = reincarnateBody();
    expect(body).not.toMatch(/setActiveId\(/u);
    expect(body).not.toMatch(/newCharId\(/u);
    expect(body).not.toMatch(/markDead\(/u);
    expect(body).not.toMatch(/newGame\(/u);
    expect(body).not.toMatch(/location\.assign/u);
    expect(body).not.toMatch(/location\.reload/u);
  });

  it("saves the reborn character into the slot the dead one was using", () => {
    expect(reincarnateBody()).toMatch(/autosave\(true\)/u);
  });

  it("contains a failure, rather than letting it escape into the game loop", () => {
    /* A respawn that throws must still reach the tombstone: the character is dead
     * either way, and an exception escaping here would leave the screen frozen on
     * the frame before the killing blow. */
    const body = reincarnateBody();
    const at = body.indexOf("catch (err)");
    expect(at, "the reincarnation is still wrapped in a try").toBeGreaterThan(-1);
    /* The catch's own text, not the whole function: a `return false` sitting
     * anywhere else would satisfy a looser match while the catch swallowed the
     * error and carried on into a game with a dead player in it. */
    const caught = body.slice(at, body.indexOf("\n  }", at));
    expect(caught).toMatch(/reportModFault\(/u);
    expect(caught).toMatch(/return false;/u);
  });
});

describe("the activation gate marks the savefile", () => {
  it("marks NOSCORE_BORG when an autoplayer takes the keyboard", () => {
    /* do_cmd_try_borg (cmd-misc.c:128-140) marks at activation, not at the first
     * respawn - so the character that was already alive when the mod took over is
     * marked too. The bit was defined, score-invalidating, persisted and read at
     * death, and set by nothing at all until this line. */
    const at = NO_COMMENTS.indexOf("installedController = { id: loaded.id, session }");
    expect(at, "the host still records the autoplayer slot").toBeGreaterThan(-1);
    const nearby = NO_COMMENTS.slice(at, at + 500);
    expect(nearby).toMatch(/markNoscore\([^)]*noscore,\s*NOSCORE\.BORG\)/u);
  });

  it("still reads that same bit at the score gate", () => {
    /* The read was always there and always answered false. Both ends are pinned
     * together so a rename cannot leave one behind. */
    expect(NO_COMMENTS).toMatch(/borg:\s*\(player\.noscore & NOSCORE\.BORG\) !== 0/u);
  });
});
