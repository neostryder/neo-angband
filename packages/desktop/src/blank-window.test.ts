/**
 * The three ways the desktop window goes black without saying anything.
 *
 * The renderer has a crash screen of its own (web/src/crash-screen.ts) and it
 * covers everything the page can catch. It cannot catch these:
 *
 *   - **render-process-gone** - the process that would draw the crash screen is
 *     the one that died.
 *   - **unresponsive** - the renderer is wedged, so nothing in it runs.
 *   - **did-fail-load** - there is no page yet.
 *
 * All three look identical to a player: a black window. Each now raises a
 * dialog from the MAIN process, which is the only side still running.
 *
 * Asserted against the source because these are Electron event registrations -
 * there is no return value to check and no way to fire `render-process-gone` in
 * a unit test. The weakness of a source assertion is real (a handler could be
 * registered and do nothing), so what is pinned here is the pair that matters:
 * the event is listened for, AND a dialog is what it raises.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "main.ts"),
  "utf8",
);

/** Source with block and line comments removed - a comment is not behaviour. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[^\n"'`]*\/\/.*$/gmu, "");
}

const CODE = stripComments(MAIN);

/** The `on("<event>", ...)` registration and the ~900 characters after it. */
function handler(event: string): string {
  const at = CODE.indexOf(`"${event}"`);
  expect(at, `nothing listens for "${event}"`).toBeGreaterThan(-1);
  return CODE.slice(at, at + 900);
}

describe("a window that goes blank says why", () => {
  it("reports a dead renderer process", () => {
    const h = handler("render-process-gone");
    expect(h).toMatch(/dialog\.showMessageBox/u);
    /* The one sentence a permadeath player needs before any of the rest. */
    expect(h).toMatch(/not touched/u);
    expect(h).toMatch(/issues/u);
  });

  it("offers a way out of a wedged renderer instead of only announcing it", () => {
    const h = handler("unresponsive");
    expect(h).toMatch(/dialog\.showMessageBox/u);
    /* Two buttons, because "unresponsive" is often just a slow level
     * generation - the player decides whether to wait. */
    expect(h).toMatch(/buttons:/u);
    expect(h).toMatch(/reload\(\)/u);
  });

  it("reports a failed load, and does not shout at its own startup", () => {
    const h = handler("did-fail-load");
    expect(h).toMatch(/dialog\.showMessageBox/u);
    /* ERR_ABORTED (-3) is what a navigation replaced by another one reports.
     * Treating it as a failure would raise a dialog during a normal launch. */
    expect(h).toMatch(/=== -3|code === -3/u);
    expect(h).toMatch(/isMainFrame/u);
  });
});
