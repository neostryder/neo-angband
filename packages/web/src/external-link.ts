/**
 * Opening a page in the player's real browser, from a game that draws to a canvas.
 *
 * ONE CALL COVERS BOTH SHELLS, and that is a fact about the desktop build rather
 * than a hope. `packages/desktop/src/main.ts` installs
 * `win.webContents.setWindowOpenHandler`, which intercepts every `window.open`
 * the renderer makes: an http or https URL is handed to `shell.openExternal` and
 * the in-app window is denied, and anything else is refused and logged. So the
 * desktop app already turns this exact call into "open it in the browser they
 * actually use", and a browser build needs no help doing the same. There is no
 * second mechanism to build, and adding an IPC channel for it would be a second
 * thing to keep in step with the handler that already works.
 *
 * WHY THE SCHEME IS CHECKED HERE TOO, when the desktop handler checks it as well.
 * The browser build has no such handler - `window.open("file:///...")` in a tab is
 * the page's own business - so the guard cannot live only on the desktop side or
 * the two shells disagree about what a link may do. The URLs this game opens are
 * built from a mod's recorded origin, which is data the game did not author, and
 * a scheme is the part of a URL that decides whether the operating system or the
 * browser answers it.
 *
 * WHY IT MUST STAY SYNCHRONOUS. A browser only honours `window.open` while a user
 * gesture is still being handled. Awaiting anything first spends the gesture and
 * the call is then blocked as a popup, which presents as a link that silently does
 * nothing. Callers reach this straight from the key press for that reason.
 */

/** Whether this is a URL this game is willing to hand to a browser. */
export function isOpenableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * Open `url` in the player's browser. False means nothing was opened.
 *
 * `noopener,noreferrer` because the destination is a third party's page: without
 * it the opened tab gets a live `window.opener` handle back into the game.
 */
export function openExternalUrl(url: string): boolean {
  if (!isOpenableUrl(url)) return false;
  /* Read off globalThis rather than named directly, so a context with no DOM
   * answers "nothing was opened" instead of throwing a ReferenceError at a
   * caller that only wanted to know whether the link worked. */
  const open = (globalThis as { window?: { open?: unknown } }).window?.open;
  if (typeof open !== "function") return false;
  try {
    (open as (u: string, t: string, f: string) => unknown).call(
      globalThis.window,
      url,
      "_blank",
      "noopener,noreferrer",
    );
    return true;
  } catch {
    /* A browser that refuses the popup throws or returns null; either way the
     * player is owed "that did not open" rather than a screen that looks as if
     * it did. */
    return false;
  }
}
