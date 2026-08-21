/**
 * The last thing between a thrown error and a black rectangle.
 *
 * WHAT A PLAYER SAW BEFORE THIS EXISTED. `main.ts` runs `bootGame()` at module
 * top level, and the whole UI is `await`ed menus. So a throw during boot, or a
 * rejected promise in any menu flow, produced a canvas that never painted or
 * one that stopped responding - with the message that would explain it sitting
 * in a devtools console the player does not have open and, on the desktop
 * build, cannot easily open. "It just doesn't start" is the least actionable
 * bug report there is, and it is the one that failure mode generates.
 *
 * WHY THE DOM AND NOT THE TERMINAL. The terminal is the thing that may have
 * failed. This paints a plain overlay element with inline styles and no
 * dependencies, so it works when the canvas is 0x0, when the font never
 * loaded, and when the module that owns the terminal is the one that threw.
 *
 * IT IS DISMISSIBLE, on purpose. A global handler will occasionally catch
 * something benign - a rejected fetch from a cancelled navigation, an extension
 * injecting into the page. Wrongly covering the game for one click is a much
 * smaller failure than wrongly staying silent, and the button makes the wrong
 * call cheap.
 *
 * It never throws. Everything in here runs at the exact moment the rest of the
 * program has stopped being trustworthy.
 */

const ISSUES = "https://github.com/neostryder/neo-angband/issues";
const DISCORD = "https://discord.gg/YegtwbHTBQ";
const OVERLAY_ID = "neo-crash";

let shown = false;
let extra = 0;

/** An error's message and stack, however it was thrown. */
function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * The block of text the player is asked to paste into an issue.
 *
 * Pure and exported so its content is pinned by a test rather than by the
 * layout code around it. What has to be in it is what a maintainer cannot get
 * any other way: the version (which decides whether the bug still exists), what
 * the game was doing, the browser, and the stack. A report missing the version
 * costs a round trip on every single issue.
 */
export function crashReport(
  err: unknown,
  context: string,
  version: string,
  userAgent = "",
): string {
  return [
    `Neo Angband ${version}`,
    `While: ${context}`,
    userAgent,
    "",
    describe(err),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Put the crash screen up. Safe to call repeatedly: the first error is the one
 * displayed, because it is the one that happened while the program was still
 * in a state worth describing. Later ones are counted.
 */
export function showCrashScreen(err: unknown, context: string, version: string): void {
  try {
    if (shown) {
      extra++;
      const more = document.getElementById(`${OVERLAY_ID}-more`);
      if (more) {
        more.textContent = `(${extra} further error${extra === 1 ? "" : "s"} since)`;
      }
      return;
    }
    shown = true;

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-label", "Neo Angband has hit a bug");
    /* palette-exempt (every #rrggbb in this file): this is a DOM overlay, not a
     * terminal cell. The z-color palette exists so the game's GLYPHS match the
     * C's; a browser dialog drawn over a canvas that has stopped working is not
     * a glyph, and it must stay legible when the terminal's own colours are
     * exactly what cannot be trusted. It matches the page background from
     * index.html so it does not flash. */
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:#101014", // palette-exempt: page background, index.html
      "color:#d8d8dc", // palette-exempt: DOM dialog body text
      "font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "padding:6vh 6vw",
      "overflow:auto",
      "-webkit-user-select:text",
      "user-select:text",
    ].join(";");

    const h = document.createElement("div");
    h.textContent = "Neo Angband hit a bug and stopped.";
    h.style.cssText = "color:#ff6b6b;font-size:18px;margin-bottom:1em"; // palette-exempt: DOM dialog heading

    /* The first thing said, because it is the first thing feared. */
    const safe = document.createElement("p");
    safe.textContent =
      "Your saved characters have not been touched. Nothing was deleted and " +
      "nothing was overwritten - reloading will pick up from your last save.";
    safe.style.cssText = "margin:0 0 1em";

    const what = document.createElement("p");
    what.textContent =
      `This is an alpha, and this is exactly the kind of thing worth reporting ` +
      `about. Copy the text below into an issue at ${ISSUES}, or paste it in ` +
      `the Discord at ${DISCORD}, with a line about what you were doing.`;
    what.style.cssText = "margin:0 0 1em";

    const pre = document.createElement("pre");
    pre.textContent = crashReport(
      err,
      context,
      version,
      typeof navigator === "undefined" ? "" : navigator.userAgent,
    );
    pre.style.cssText = [
      "background:#18181f", // palette-exempt: DOM code block
      "border:1px solid #303040", // palette-exempt: DOM code block border
      "padding:1em",
      "margin:0 0 1em",
      "white-space:pre-wrap",
      "word-break:break-word",
      "max-height:40vh",
      "overflow:auto",
      "font-size:12px",
    ].join(";");

    const more = document.createElement("div");
    more.id = `${OVERLAY_ID}-more`;
    more.style.cssText = "color:#8a8a96;margin-bottom:1em;min-height:1.2em"; // palette-exempt: DOM dimmed note

    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:0.75em;flex-wrap:wrap";
    buttons.append(
      button("Reload the game", () => {
        location.reload();
      }),
      button("Copy this report", () => {
        void navigator.clipboard?.writeText(pre.textContent ?? "");
      }),
      button("Close and carry on", () => {
        root.remove();
        shown = false;
        extra = 0;
      }),
    );

    root.append(h, safe, what, pre, more, buttons);
    (document.body ?? document.documentElement).append(root);
  } catch {
    /* The crash handler crashed. There is nothing above this to catch it, and a
     * throw here would replace a bad situation with a silent one. */
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = [
    "font:inherit",
    "padding:0.5em 1em",
    "background:#24242e", // palette-exempt: DOM button
    "color:#d8d8dc", // palette-exempt: DOM button text
    "border:1px solid #404052", // palette-exempt: DOM button border
    "border-radius:4px",
    "cursor:pointer",
  ].join(";");
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Listen for everything that would otherwise reach nobody.
 *
 * Called as early as main.ts can call it - before `bootGame()`, so a throw
 * during boot is caught by it rather than escaping into a blank page.
 */
export function installCrashScreen(version: string): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (ev: ErrorEvent) => {
    /* A failed <img> or <script> also fires "error" on the window during the
     * capture phase; those carry no `error` and are not the program breaking.
     * A missing tile is not a reason to cover the game. */
    if (!ev.error && !ev.message) return;
    showCrashScreen(ev.error ?? ev.message, "the game was running", version);
  });
  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    showCrashScreen(ev.reason, "an unfinished action", version);
  });
}

/** Forget that a crash was shown. Tests only. */
export function resetCrashScreen(): void {
  shown = false;
  extra = 0;
  /* Guarded like everything else here. This module's whole claim is that it
   * cannot throw, and a reset that assumes a document breaks that claim in the
   * one environment - no DOM at all - the claim was written for. */
  try {
    document.getElementById(OVERLAY_ID)?.remove();
  } catch {
    /* no document */
  }
}
