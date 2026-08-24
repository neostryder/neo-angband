/**
 * Recovery UI for the one boot failure a normal crash screen cannot fix: the
 * enabled content set could not be composed into a game pack.
 *
 * This deliberately does not use the terminal. Composition happens before the
 * game exists, so a plain DOM overlay remains usable when no screen, menu, or
 * registry was able to start. It is separate from crash-screen.ts because this
 * failure has a safe, player-controlled recovery: turn every mod off and boot
 * the base game. A generic crash does not have that promise.
 */

const OVERLAY_ID = "neo-safe-mode";

let shown = false;

export interface SafeModeOptions {
  /** Persist the safe selection and relaunch. This must not touch saved games. */
  readonly disableModsAndRestart: () => void;
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
      "Your saved characters have not been touched. Safe mode disables every enabled mod " +
      "for the next launch; you can re-enable mods individually later.";
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

    const restart = document.createElement("button");
    restart.type = "button";
    restart.textContent = "Disable all mods and restart";
    restart.style.cssText = [
      "font:inherit",
      "padding:0.5em 1em",
      "background:#24242e", // palette-exempt: DOM recovery button
      "color:#d8d8dc", // palette-exempt: DOM recovery button
      "border:1px solid #404052", // palette-exempt: DOM recovery button
      "border-radius:4px",
      "cursor:pointer",
    ].join(";");
    restart.addEventListener("click", () => {
      /* The callback persists the new selection and starts the navigation. If a
       * hostile storage implementation rejects either operation, leave this
       * readable recovery screen up rather than replacing it with a new error. */
      try {
        options.disableModsAndRestart();
      } catch {
        /* recovery controls must never become another blank page */
      }
    });

    root.append(heading, safe, detail, restart);
    (document.body ?? document.documentElement).append(root);
  } catch {
    /* This is the final boot recovery. If even the DOM cannot be used, preserve
     * the original composition failure instead of throwing a second one. */
  }
}

/** Forget the visible state. Tests only. */
export function resetSafeModeScreen(): void {
  shown = false;
  try {
    document.getElementById(OVERLAY_ID)?.remove();
  } catch {
    /* no document */
  }
}
