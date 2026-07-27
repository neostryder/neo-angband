/**
 * Save and exit (^X, textui_quit, ui-game.c:199) - the leave-play path.
 *
 * Upstream quits to the OS and the next launch shows news.txt before waiting on
 * New/Open from the File menu (main-win.c:5475). A browser tab has no OS to quit
 * to, so the web analog saves and then reloads WITHOUT the continuation flag,
 * which is what routes boot through the title screen and then the character
 * select (main.ts isContinuation / bootGame) with the hero waiting to be
 * resumed. Two things therefore have to hold, and both are easy to break by
 * copy-pasting from switchCharacter/newGame, which deliberately DO skip the
 * title:
 *
 *   1. the save is flushed before the reload (nothing is lost), and
 *   2. the skip-the-title keys are CLEARED, never set.
 *
 * The menu row and ^X must also be the same action, not two half-implementations
 * - ^X used to just save and reopen the game menu, which was not "quit" in any
 * sense the player could see.
 *
 * main.ts boots a real game at module scope and cannot be imported in a unit
 * test, so the wiring is pinned by reading the source (as in
 * render-background.test.ts / term.test.ts). The menu ROW itself is structural
 * and covered directly in game-menu.test.ts.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { gameMenuEntries } from "./game-menu";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
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

describe("the game menu's Save and exit row", () => {
  it("exists, is last, and names the keyboard shortcut", () => {
    const entries = gameMenuEntries();
    const exit = entries.find((e) => e.action === "exit");
    expect(exit, "the game menu needs a save-and-exit row").toBeTruthy();
    expect(entries[entries.length - 1]?.action).toBe("exit");
    expect(exit!.item.label).toMatch(/exit/i);
    expect(exit!.item.hint).toMatch(/Ctrl-X/);
  });

  it("is dispatched to exitToTitle, behind a confirmation", () => {
    const body = functionBody(MAIN, "openGameMenu");
    expect(body).toMatch(/case "exit":[\s\S]{0,400}?confirmYesNo\([\s\S]{0,200}?exitToTitle\(\)/);
  });
});

describe("exitToTitle", () => {
  const body = functionBody(MAIN, "exitToTitle");

  it("writes the save before leaving, through close_game's retry loop", () => {
    /* Was a bare persistSave(); close_game (ui-game.c:1173) retries a failed
     * save for as long as the player says to, with prompt_failed_save true for a
     * deliberate exit. */
    expect(body).toContain("closeGameSave(true)");
  });

  it("CLEARS the skip-the-title keys rather than setting them", () => {
    // switchCharacter/newGame/resumeSelected set SKIP_TITLE because they are
    // continuations. Exiting is the opposite: the next load must show the title.
    expect(body).toMatch(/sessionStorage\.removeItem\(SKIP_TITLE_KEY\)/);
    expect(body).toMatch(/sessionStorage\.removeItem\(BIRTH_DONE_KEY\)/);
    expect(body).not.toMatch(/setItem/);
  });

  it("drops the fresh-start params so the reload is not a new game", () => {
    expect(body).toMatch(/searchParams\.delete\("new"\)/);
    expect(body).toMatch(/searchParams\.delete\("seed"\)/);
    expect(body).not.toMatch(/searchParams\.set/);
  });

  it("reloads (that is what re-runs boot and shows the title)", () => {
    expect(body).toMatch(/location\.assign\(/);
  });
});

describe("ESC out of the first birth stage (BIRTH_RESET)", () => {
  it("re-enters birth instead of playing on with an unchosen character", () => {
    // runBirth returns null for a step-back off the first stage, which upstream
    // treats as BIRTH_RESET - start creation over (ui-birth.c:1661-1666); a bare
    // ESCAPE in the quickstart prompt is ignored outright
    // (textui_birth_quickstart, ui-birth.c:103-138). Birth has no ESC exit.
    // maybeBirth used to accept the null and keep playing, which handed the
    // player the throwaway hero startGame had rolled behind the birth screen -
    // ESC appeared to "instantly create a character with default settings".
    const body = functionBody(MAIN, "maybeBirth");
    expect(body).toMatch(/while \(!choice\) \{[\s\S]{0,200}?runBirth\(/);
    expect(
      body,
      "maybeBirth must not treat a null birth choice as permission to play on",
    ).not.toMatch(/Your adventure begins/);
  });
});

describe("^X (textui_quit)", () => {
  it("runs the same confirm-then-exit as the menu row, not a menu reopen", () => {
    const body = functionBody(MAIN, "saveQuitCmd");
    expect(body).toMatch(/confirmYesNo\([\s\S]{0,200}?exitToTitle\(\)/);
    expect(body, "^X must not just reopen the game menu").not.toContain("openGameMenu");
  });
});
