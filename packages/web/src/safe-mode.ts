/**
 * Recovery UI for the one boot failure a normal crash screen cannot fix: the
 * enabled content set could not be composed into a game pack.
 *
 * This deliberately does not use the terminal. Composition happens before the
 * game exists, so a plain DOM overlay remains usable when no screen, menu, or
 * registry was able to start. It is separate from crash-screen.ts because this
 * failure has a safe, player-controlled recovery: start the base game with every
 * mod off for one session. A generic crash does not have that promise.
 *
 * The same file holds safe mode's other two screens: the offer made after
 * starts that never reached the menus, and the notice shown while safe mode is
 * on. Both are DOM for the same reason: the offer comes before the game exists.
 */

const OVERLAY_ID = "neo-safe-mode";
const OFFER_ID = "neo-safe-offer";
const NOTICE_ID = "neo-safe-notice";

let shown = false;

export interface SafeModeOptions {
  /** Restart with every mod off for one session. This must not touch saved games or the mod settings. */
  readonly startWithoutMods: () => void;
}

const BUTTON_STYLE = [
  "font:inherit",
  "padding:0.5em 1em",
  "background:#24242e", // palette-exempt: DOM recovery button
  "color:#d8d8dc", // palette-exempt: DOM recovery button
  "border:1px solid #404052", // palette-exempt: DOM recovery button
  "border-radius:4px",
  "cursor:pointer",
].join(";");

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.style.cssText = BUTTON_STYLE;
  el.addEventListener("click", () => {
    /* A recovery control must never become another blank page, whatever the
     * callback throws. */
    try {
      onClick();
    } catch {
      /* keep the screen up */
    }
  });
  return el;
}

/** A short error description that remains useful for thrown non-Errors too. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Tell the player that composition failed and offer the one recovery that is
 * guaranteed not to re-enter the same combination. Safe to call repeatedly;
 * the first failure is the one worth showing.
 */
export function showSafeModeScreen(error: unknown, options: SafeModeOptions): void {
  try {
    if (shown) return;
    shown = true;

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-label", "Neo Angband safe mode");
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:#101014", // palette-exempt: DOM recovery overlay
      "color:#d8d8dc", // palette-exempt: DOM recovery overlay
      "font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "padding:6vh 6vw",
      "overflow:auto",
    ].join(";");

    const heading = document.createElement("div");
    heading.textContent = "Neo Angband could not start with the enabled mods.";
    heading.style.cssText = "color:#ffd166;font-size:18px;margin-bottom:1em"; // palette-exempt: DOM recovery heading

    const safe = document.createElement("p");
    safe.textContent =
      "Your saved characters have not been touched. Safe mode starts the game with every mod " +
      "off for this session only. Your mod settings stay as they are, so you can switch off " +
      "the mod that failed and then restart with the rest.";
    safe.style.cssText = "margin:0 0 1em";

    const detail = document.createElement("pre");
    detail.textContent = describe(error);
    detail.style.cssText = [
      "background:#18181f", // palette-exempt: DOM recovery detail
      "border:1px solid #303040", // palette-exempt: DOM recovery detail
      "padding:1em",
      "margin:0 0 1em",
      "white-space:pre-wrap",
      "word-break:break-word",
      "max-height:40vh",
      "overflow:auto",
      "font-size:12px",
    ].join(";");

    const restart = button("Start without mods", options.startWithoutMods);

    root.append(heading, safe, detail, restart);
    (document.body ?? document.documentElement).append(root);
  } catch {
    /* This is the final boot recovery. If even the DOM cannot be used, preserve
     * the original composition failure instead of throwing a second one. */
  }
}

/**
 * Ask whether to start without mods, after `incompleteStarts` starts in a row
 * stopped before the menus. Resolves true for a safe start. Y or Enter picks it,
 * N or Escape starts normally; nothing else is listening for keys this early.
 * If the dialog cannot be shown at all, the start goes ahead normally.
 */
export function offerSafeLaunch(incompleteStarts: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const root = document.createElement("div");
      root.id = OFFER_ID;
      root.setAttribute("role", "alertdialog");
      root.setAttribute("aria-label", "Start without mods?");
      root.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:#101014", // palette-exempt: DOM recovery overlay
        "color:#d8d8dc", // palette-exempt: DOM recovery overlay
        "font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
        "padding:6vh 6vw",
        "overflow:auto",
      ].join(";");
      const heading = document.createElement("div");
      heading.textContent = `Neo Angband stopped before reaching the menus on each of its last ${String(incompleteStarts)} starts.`;
      heading.style.cssText = "color:#ffd166;font-size:18px;margin-bottom:1em"; // palette-exempt: DOM recovery heading
      const body = document.createElement("p");
      body.textContent =
        "A mod may be the cause. You can start this once with every mod off. No mod is " +
        "uninstalled or switched off for good, and your saved characters are not touched.";
      body.style.cssText = "margin:0 0 1.5em";
      let settled = false;
      const finish = (safe: boolean): void => {
        if (settled) return;
        settled = true;
        document.removeEventListener("keydown", onKey, true);
        root.remove();
        resolve(safe);
      };
      const onKey = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (key === "y" || key === "enter") finish(true);
        else if (key === "n" || key === "escape") finish(false);
        else return;
        event.preventDefault();
      };
      const safe = button("Start without mods (y)", () => finish(true));
      const normal = button("Start normally (n)", () => finish(false));
      normal.style.marginLeft = "1em";
      document.addEventListener("keydown", onKey, true);
      root.append(heading, body, safe, normal);
      (document.body ?? document.documentElement).append(root);
      safe.focus();
    } catch {
      resolve(false);
    }
  });
}

export interface SafeNoticeOptions {
  /** Restart with the player's mods, leaving safe mode. */
  readonly restartWithMods: () => void;
}

/**
 * The reminder, while safe mode is on, that every mod is off for this session.
 * A small bar in the corner, out of the map's way, that the player can dismiss.
 */
export function showSafeLaunchNotice(options: SafeNoticeOptions): void {
  try {
    if (document.getElementById(NOTICE_ID)) return;
    const root = document.createElement("div");
    root.id = NOTICE_ID;
    root.setAttribute("role", "status");
    root.style.cssText = [
      "position:fixed",
      "right:8px",
      "bottom:8px",
      "z-index:2147483646",
      "background:#18181f", // palette-exempt: DOM safe-mode notice
      "color:#d8d8dc", // palette-exempt: DOM safe-mode notice
      "border:1px solid #ffd166", // palette-exempt: DOM safe-mode notice
      "border-radius:4px",
      "padding:0.4em 0.6em",
      "font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "display:flex",
      "gap:0.6em",
      "align-items:center",
    ].join(";");
    const text = document.createElement("span");
    text.textContent = "Safe mode: every mod is off for this session.";
    const restart = button("Restart with mods", options.restartWithMods);
    const close = button("Hide", () => root.remove());
    root.append(text, restart, close);
    (document.body ?? document.documentElement).append(root);
  } catch {
    /* the notice is a reminder; the session runs without it */
  }
}

/** Forget the visible state. Tests only. */
export function resetSafeModeScreen(): void {
  shown = false;
  try {
    for (const id of [OVERLAY_ID, OFFER_ID, NOTICE_ID]) document.getElementById(id)?.remove();
  } catch {
    /* no document */
  }
}
