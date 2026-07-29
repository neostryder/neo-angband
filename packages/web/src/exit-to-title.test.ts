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

describe("the game menu's Save and exit row", () => {
  it("exists and is last when the front end cannot quit", () => {
    const entries = gameMenuEntries();
    const exit = entries.find((e) => e.action === "exit");
    expect(exit, "the game menu needs a save-and-exit row").toBeTruthy();
    expect(entries[entries.length - 1]?.action).toBe("exit");
    expect(exit!.item.label).toMatch(/exit/i);
  });

  it("does NOT claim Ctrl-X, because ^X quits and this row does not", () => {
    /* The hint used to say "(Ctrl-X)". That was true only while the two actions
     * were the same function - and them being the same function is exactly what
     * made "Save and exit" close the app on desktop. A hint naming the wrong key
     * is how the confusion stayed invisible. */
    const exit = gameMenuEntries().find((e) => e.action === "exit");
    expect(exit!.item.hint).not.toMatch(/Ctrl-X/);
    expect(exit!.item.hint).toMatch(/title screen/);
  });

  it("offers a SEPARATE quit row only where there is something to quit to", () => {
    expect(gameMenuEntries().some((e) => e.action === "quit")).toBe(false);
    const desktop = gameMenuEntries({ canQuit: true });
    const quit = desktop.find((e) => e.action === "quit");
    expect(quit, "the desktop build needs a discoverable way out").toBeTruthy();
    expect(quit!.item.hint).toMatch(/Ctrl-X/);
    /* Last, after "Save and exit": leaving the program is the more final act. */
    expect(desktop[desktop.length - 1]?.action).toBe("quit");
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
  it("steps back to the title instead of playing on with an unchosen character", () => {
    // What must NOT happen is the original bug: accepting runBirth's null and
    // playing on handed the player the throwaway hero startGame had rolled behind
    // the birth screen, so ESC appeared to "instantly create a character with
    // default settings". That is what this guards.
    //
    // The fix for it was `while (!choice)` - re-enter birth, upstream's
    // BIRTH_RESET (ui-birth.c:1661-1666) - and that has since been REPLACED by a
    // "back" result, because re-entering was a dead end: there was then no way out
    // of creation at all. ESC now steps up one level to the title, which is
    // upstream's own hierarchical-back rule (ui-birth.c:804-806) continued into a
    // shell that HAS a level above birth. See boot-menus.test.ts for the full
    // walk-back; this file only keeps the never-play-an-unchosen-hero half.
    const body = functionBody(MAIN, "maybeBirth");
    expect(body).toMatch(/if \(!choice\) return "back"/u);
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

/**
 * Leaving play and quitting the program are two actions, and collapsing them onto
 * one function is how the menu came to lie.
 *
 * The history is worth keeping, because the same report was misread twice. First
 * "Save and exit just saves" - true then: it saved, reloaded, and landed back in
 * the game because the continuation flags were still set. The fix for THAT was to
 * clear the flags. A second fix was then layered on top, calling desktopQuit()
 * first, which made the desktop build close the whole app - so the row labelled
 * "Save and exit", its hint promising "the title screen and character list", and
 * its confirmation asking "Save and exit to the title screen?" all did something
 * none of them said. Reported 2026-07-29 as "it just closes the game instead".
 *
 * Worse, three other callers inherited the quit through exitToTitle: death,
 * retirement, and ^X. On desktop, DYING closed the app.
 *
 * Pinned by source, like the rest of this file: exitToTitle navigates, which a
 * node test cannot let it do.
 */
describe("exitToTitle goes to the title on BOTH front ends", () => {
  it("does not quit the shell", () => {
    const body = functionBody(MAIN, "exitToTitle");
    expect(
      body,
      "exitToTitle must not quit - that is saveQuitCmd's job",
    ).not.toContain("desktopQuit");
    expect(body).toContain("location.assign");
  });

  it("so death and retirement reach the title, not the OS", () => {
    /* These two only ever called exitToTitle, so the defect was invisible at
     * their own call sites - which is why they are asserted here. */
    expect(functionBody(MAIN, "quitAfterDeath")).toContain("exitToTitle()");
    expect(functionBody(MAIN, "quitAfterDeath")).not.toContain("desktopQuit");
  });

  it("^X is the faithful quit, and asks its own question", () => {
    /* textui_quit (ui-game.c:199) ends the program; every front end then calls
     * quit() (main.c:581-586, main-win.c:3511-3512). A tab has no OS to quit to
     * and falls back to the title, the nearest thing that exists there. */
    const body = functionBody(MAIN, "saveQuitCmd");
    expect(body).toContain("desktopQuitAvailable()");
    expect(body).toContain("Save and quit?");
    /* The save comes FIRST: quitting before closeGameSave would drop the turn. */
    expect(body.indexOf("closeGameSave")).toBeLessThan(body.indexOf("desktopQuit()"));
  });

  it("treats an absent shell as a tab rather than swallowing the exit", () => {
    const body = functionBody(MAIN, "desktopQuit");
    expect(body).toContain('typeof shell?.quit !== "function"');
    expect(body).toContain("return false");
  });

  it("the preload exposes quit and the main process handles it", () => {
    const preload = readFileSync(
      new URL("../../desktop/src/preload.ts", import.meta.url),
      "utf8",
    );
    expect(preload).toContain("HOST_QUIT_CHANNEL");
    expect(preload).toContain("quit(): void {");
    const main = readFileSync(new URL("../../desktop/src/main.ts", import.meta.url), "utf8");
    expect(main).toContain("ipcMain.on(HOST_QUIT_CHANNEL");
    /* app.quit(), not win.close(): closing the window runs window-all-closed,
     * which on macOS keeps the app alive - an "exit" to nothing at all. */
    expect(main).toContain("app.quit()");
  });
});
