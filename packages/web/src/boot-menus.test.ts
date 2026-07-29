/**
 * ESC in the pre-game flow must back up ONE level, and keep working until the
 * title screen is showing again.
 *
 * That is upstream's own rule for its menu stack, not a web invention:
 * ui-birth.c:804-806 says "As all the menus are displayed in 'hierarchical' style,
 * we allow use of 'back' (left arrow key or equivalent) to step back in the proces
 * as well as 'escape'", ESC becomes BIRTH_BACK (:811), and the stage machine turns
 * that into `next = current_stage - 1` (:1662). The one place upstream cannot go
 * further up is the FIRST birth stage, because textui_do_birth is entered from a
 * running program whose only exit is KTRL('X'); it remaps that step-back to
 * BIRTH_QUICKSTART and then BIRTH_RESET (:1615-1626, :1661-1666), i.e. creation
 * starts over. The web shell HAS a level above - the title screen is its "no game
 * in progress" splash (main-win.c:5475) - so the rule continues one step further.
 *
 * Two boundaries were broken, at opposite ends:
 *
 *   1. openRoster answered `false` for "the player pressed ESC" and bootMenus read
 *      that as "there was nothing to choose", so backing out of the character
 *      picker on a continuation boot fell through into character creation. The fix
 *      is a "back" result DISTINCT from null/false, which is what makes the two
 *      answers different answers.
 *   2. birth's own first-stage ESC sat inside `while (!choice)`, so once you were
 *      in creation there was no way back to the title at all.
 *
 * main.ts boots a real game at module scope and cannot be imported into a unit
 * test, so the control flow is pinned by reading the source - the shape
 * exit-to-title.test.ts established. What is asserted here is exactly the set of
 * things that, if they regress, put ESC back in a dead end.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runCharacterSelect } from "./charselect";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
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

/** Source with line and block comments stripped, so a citation cannot score. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

describe('the pre-game menus answer "back", not null/false', () => {
  it("declares the BootStep type with a back arm distinct from done", () => {
    const src = stripComments(MAIN);
    expect(src).toMatch(/type BootStep = "done" \| "back"/u);
  });

  it("openRoster returns BootStep and answers 'back' for the picker's ESC", () => {
    const src = stripComments(MAIN);
    expect(src).toMatch(/async function openRoster\(\): Promise<BootStep>/u);
    const body = stripComments(functionBody(MAIN, "openRoster"));
    expect(body).toMatch(/res\.action === "back"\) return "back"/u);
    /* The boolean it used to answer is what conflated the two outcomes. */
    expect(body).not.toMatch(/return false/u);
  });

  it("maybeBirth returns BootStep and answers 'back' off the first stage", () => {
    const src = stripComments(MAIN);
    expect(src).toMatch(/async function maybeBirth\(\): Promise<BootStep>/u);
    const body = stripComments(functionBody(MAIN, "maybeBirth"));
    expect(body).toMatch(/if \(!choice\) return "back"/u);
  });

  it("birth is no longer wrapped in an un-escapable retry loop", () => {
    /* `while (!choice)` re-ran runBirth on every first-stage ESC, so birth could
     * not be left. It is the single line that made ESC a dead end. */
    const body = stripComments(functionBody(MAIN, "maybeBirth"));
    expect(body).not.toMatch(/while \(!choice\)/u);
    expect(body).toMatch(/const choice = await runBirth\(/u);
  });

  it("startNewCharacter is awaited so birth's 'back' can reach bootMenus", () => {
    const src = stripComments(MAIN);
    expect(src).toMatch(/async function startNewCharacter\(\): Promise<BootStep>/u);
    const body = stripComments(functionBody(MAIN, "startNewCharacter"));
    /* `void maybeBirth()` threw the answer away, which is how the New row became
     * a one-way door. */
    expect(body).not.toMatch(/void maybeBirth\(\)/u);
    expect(body).toMatch(/return maybeBirth\(\)/u);
  });
});

describe("bootMenus is one loop that walks back up to the title", () => {
  const body = stripComments(functionBody(MAIN, "bootMenus"));

  it("asks for the title INSIDE the loop, so a step-back re-shows it", () => {
    /* The old version called maybeTitle once before the loop and again at the
     * bottom; the suppressed-title branch then returned without ever looping. */
    expect(body).toMatch(/for \(;;\) \{\s*const choice = await maybeTitle\(\)/u);
    expect((body.match(/await maybeTitle\(\)/gu) ?? []).length).toBe(1);
  });

  it("continues (rather than falling through) when the roster is escaped", () => {
    expect(body).toMatch(/\(await openRoster\(\)\) === "done"\) return;/u);
    expect(body).toMatch(/canReturnToTitle\) continue;/u);
  });

  it("continues when birth's first stage is escaped", () => {
    expect(body).toMatch(/\(await maybeBirth\(\)\) === "done"\) return;/u);
    expect(body).toMatch(/\(await startNewCharacter\(\)\) === "done"\) return;\s*continue;/u);
  });

  it("never returns straight after a 'new' choice without checking the answer", () => {
    /* `startNewCharacter(); return;` is the regression: it discarded "back". */
    expect(body).not.toMatch(/startNewCharacter\(\);\s*return;/u);
  });

  it("guards the one permanently-suppressed title (?agent) against looping", () => {
    /* Every other suppressor is one-shot and cleared on the first pass, so only
     * an autoplayer boot could spin here. */
    expect(body).toMatch(/canReturnToTitle = !params\.get\("agent"\)/u);
    expect(body).toMatch(/if \(!canReturnToTitle\) return;/u);
  });
});

describe("the character picker really produces a back action", () => {
  it("runCharacterSelect's result type has a 'back' arm", () => {
    /* Structural, not source-pinned: the type is what openRoster switches on, and
     * charselect.test.ts drives the ESC key itself. */
    expect(typeof runCharacterSelect).toBe("function");
    const src = readFileSync(new URL("./charselect.ts", import.meta.url), "utf8");
    expect(stripComments(src)).toMatch(/\{ action: "back" \}/u);
    expect(stripComments(src)).toMatch(/pick === null\) return \{ action: "back" \}/u);
  });
});
