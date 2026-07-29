/**
 * The run-interrupt guard.
 *
 * A run re-queues itself inside the engine (player-path.c run_step, ported in
 * core/game/player-path.ts), so the whole run used to happen inside ONE
 * synchronous advance() call: the browser never got the event-loop turn it needs
 * to deliver a keydown, and a run down a long corridor could not be stopped -
 * upstream's only way to abort one (check_for_player_interrupt, ui-game.c:645) is
 * a keypress. Each step was also invisible, since nothing was drawn until the
 * run had finished.
 *
 * The engine half is tested for real in core/game/loop.test.ts. This guard holds
 * the shell half, which cannot be imported (main.ts boots a game at module
 * scope): the loop's LOOP_STATUS.PAUSE must be pumped, and while pumping every
 * key must be swallowed as the abort rather than executed as a command.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  /* `[(<]` so a GENERIC declaration matches too (openModal<T>), not only `name(`. */
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

describe("a run can be interrupted", () => {
  it("installs the check_for_player_interrupt hook", () => {
    expect(MAIN).toMatch(/state\.checkInterrupt = \(\): InterruptResponse =>/);
  });

  it("answers cancel once, and pause otherwise", () => {
    const body = MAIN.slice(MAIN.indexOf("state.checkInterrupt ="));
    const hook = body.slice(0, body.indexOf("\n};") + 3);
    // The flag is consumed, so one keypress cancels one run - it must not stay
    // set and cancel the next one too.
    expect(hook).toMatch(/if \(interruptKey\) \{\s*interruptKey = false;\s*return "cancel";/);
    expect(hook).toContain('return "pause"');
    // driveRest owns the rest lifecycle and pauses per turn itself; pausing the
    // engine underneath it would strand the {hold} it has queued.
    expect(hook).toMatch(/if \(state\.resting\) return "go";/);
  });

  it("pumps the next step when the loop pauses", () => {
    const body = functionBody(MAIN, "advance");
    expect(body).toMatch(/status === LOOP_STATUS\.PAUSE\) pumpStep\(\)/);
  });

  it("waits for any overlay before pumping the next step", () => {
    // A -more- prompt, a floor pile or a store screen opens in the tail of a
    // step; stepping again underneath it would drive the game while a modal
    // owns the terminal.
    const body = functionBody(MAIN, "pumpStep");
    expect(body).toMatch(/if \(modalDepth > 0\) \{\s*pumpStep\(\);\s*return;/);
    expect(body).toContain("pumping = true");
  });

  it("clears the pump flag on every exit from a turn", () => {
    // advance() returns early on a level change and on death; leaving `pumping`
    // set there would swallow the player's keys forever.
    const body = functionBody(MAIN, "advance");
    expect(body).toMatch(/if \(!pumping\) interruptKey = false;\s*pumping = false;/);
  });

  it("swallows keys while pumping instead of executing them", () => {
    const handler = MAIN.slice(MAIN.indexOf('window.addEventListener("keydown"'));
    const swallow = handler.indexOf("if (pumping) {");
    expect(swallow, "the keydown handler no longer checks `pumping`").toBeGreaterThan(-1);
    expect(handler.slice(swallow, swallow + 200)).toContain("interruptKey = true");
    // It must come before any command dispatch, or the key that stops the run
    // would also be obeyed (upstream flushes it: EVENT_INPUT_FLUSH).
    const dispatch = handler.indexOf("resolveKey(");
    expect(dispatch).toBeGreaterThan(swallow);
  });

  it("reports an interrupted rest the way the engine reports an interrupted run", () => {
    const body = functionBody(MAIN, "driveRest");
    // Only the keypress arm: the monster-in-view and damage disturbs are silent
    // in the C (ui-game.c:663 is the only "Cancelled." site).
    expect(body).toMatch(/if \(interrupted && !dead\) say\("Cancelled\."\);/);
  });
});
