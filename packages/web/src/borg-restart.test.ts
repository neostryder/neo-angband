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
     * only for a character it already holds the keyboard for. So for a human this
     * is one null check and the branch below is unchanged. */
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
    /* And it does not let go of the slot either. Detaching is how a page stops
     * being a character's writer (slot-attach.ts), so a reincarnation that did it
     * would leave the reborn character playing to nowhere - the same "new game
     * that happens to follow one" this test is about, arriving by a newer door. */
    expect(body).not.toMatch(/detachSlot\(/u);
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

describe("a mod's controller has a clock of its own", () => {
  /* Found while wiring the restart loop, and fixed here rather than left as a
   * second gap: ModPlugin.controller was installed and then nothing drove it,
   * so an autoplayer only took a turn when a human happened to press a key.
   * A screensaver that only advances on a keypress is not a screensaver. */

  /**
   * From finishAutoplayerInstall (the extracted install-and-pump helper, #125)
   * through the mod-controller install loop that calls it, to the next
   * top-level statement. The two live back to back and the install/pump steps
   * these tests pin now live in the helper rather than inline in the loop, so
   * both have to be in view for the same assertions to still find them.
   */
  function installLoopBody(): string {
    const at = NO_COMMENTS.indexOf("function finishAutoplayerInstall(");
    expect(at, "the autoplayer install-and-pump helper is still here").toBeGreaterThan(-1);
    const end = NO_COMMENTS.indexOf('window as unknown as { __neo?: unknown }', at);
    expect(end, "the loop still ends before the dev diagnostic hook").toBeGreaterThan(at);
    return NO_COMMENTS.slice(at, end);
  }

  it("wraps the mod's controller in a latch before installing it", () => {
    /* Not optional: runGameLoop asks nextCommand() for as long as the player
     * has energy, so a controller answering every time would never let
     * advance() return, and the tab would hang inside one turn. */
    const body = installLoopBody();
    expect(body).toMatch(/let modArmed = false;/u);
    expect(body).toMatch(/if \(!modArmed\) return null;/u);
    expect(body).toMatch(/installController\(state, modLatched,/u);
  });

  it("pumps advance() on an interval, arming one action per tick", () => {
    const body = installLoopBody();
    expect(body).toMatch(/setInterval\(\(\) => \{/u);
    const timerAt = body.indexOf("setInterval(() => {");
    const timerBody = body.slice(timerAt, body.indexOf("}, MOD_AUTOPLAYER_TICK_MS)"));
    expect(timerBody).toMatch(/modArmed = true;/u);
    expect(timerBody).toMatch(/advance\(\);/u);
  });

  it("answers a blocking prompt instead of parking on it, and never during birth", () => {
    /* THIS ASSERTION USED TO SAY THE OPPOSITE, and the opposite was the bug: the
     * pump skipped every tick while a modal was up, so a `-more-` in the tail of
     * a turn - the forced one a level change puts in front of the stair message,
     * for instance - stopped the run until a human pressed a key. It now feeds the
     * autoplayer's own key through the input door, which is what upstream's
     * inkey_hack does.
     *
     * The `gameScreenLive` half is the part that must not be lost: before boot
     * settles on a game the birth flow owns the terminal, and a mod's 120ms clock
     * must not answer for the player rolling a character. */
    const body = installLoopBody();
    const timerAt = body.indexOf("setInterval(() => {");
    const timerBody = body.slice(timerAt, body.indexOf("}, MOD_AUTOPLAYER_TICK_MS)"));
    expect(timerBody).toMatch(/if \(scoresOpen\) return;/u);
    expect(timerBody).toMatch(/if \(modalDepth > 0\) \{/u);
    expect(timerBody).toMatch(/if \(gameScreenLive\) answerBlockingPrompt\(/u);
  });

  it("answers with a key through the one input door, not with its own listener", () => {
    /* The mechanism is upstream's: the borg's key goes through the same function
     * every other key goes through (borg.c:189). A second dispatch path here
     * would be a second answer to "who has the keyboard". */
    const at = NO_COMMENTS.indexOf("function answerBlockingPrompt(");
    expect(at, "main.ts still has the prompt answer").toBeGreaterThan(-1);
    const fn = NO_COMMENTS.slice(at, NO_COMMENTS.indexOf("function waitAnyKey", at));
    expect(fn).toMatch(/dispatchUiInput\(/u);
    expect(fn).toMatch(/"Escape"/u);
  });

  it("stops itself on death rather than racing the reincarnation check", () => {
    /* Belt and suspenders: a successful reincarnation never sets dead, so this
     * branch is normally not taken for an autoplayer. It still has to exist for
     * the case reincarnateAutoplayer() itself declines (holder gone, engine too
     * old) and the ordinary death flow runs - the pump must not keep calling
     * advance() into a dead game. */
    const body = installLoopBody();
    const timerAt = body.indexOf("setInterval(() => {");
    const timerBody = body.slice(timerAt, body.indexOf("}, MOD_AUTOPLAYER_TICK_MS)"));
    expect(timerBody).toMatch(/if \(dead\) \{\s*clearInterval\(modTimer\);/u);
  });

  it("contains a throwing autoplayer instead of hanging the host", () => {
    const body = installLoopBody();
    const timerAt = body.indexOf("setInterval(() => {");
    const timerBody = body.slice(timerAt, body.indexOf("}, MOD_AUTOPLAYER_TICK_MS)"));
    expect(timerBody).toMatch(/catch \(err\) \{/u);
    expect(timerBody).toMatch(/clearInterval\(modTimer\);/u);
  });

  it("has no tick cap, unlike the debug agent and plugin seams", () => {
    /* AGENT_TICK_CAP / PLUGIN_TICK_CAP exist as a manual-test safety valve.
     * A real "let it play" mod is supposed to keep going. */
    const body = installLoopBody();
    expect(body).not.toMatch(/MOD_AUTOPLAYER_TICK_CAP/u);
  });
});
