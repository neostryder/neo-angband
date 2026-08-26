/**
 * The persistent on-screen sign that an autoplayer, not the player, holds the
 * keyboard (#125).
 *
 * Before this, the only feedback a player got that an autoplayer had taken
 * over was a one-shot `say()` line, and only on the way OUT - printed after
 * control was already being handed back. There was nothing on screen for
 * however long it held the keyboard, and nothing naming how to get it back.
 *
 * This is a small fixed banner, not a full-screen overlay like
 * crash-screen.ts or safe-mode.ts: an autoplayer holding the keyboard is not
 * a broken game, and covering the map it is playing would defeat the point of
 * watching it. `pointer-events:none` for the same reason - it must never
 * intercept a click or tap meant for the game underneath.
 */

const BANNER_ID = "neo-autoplayer-banner";

let shown = false;

/**
 * Put the banner up, naming which mod has the keyboard and how to take it
 * back. Safe to call again while already shown - the id changes in place,
 * rather than a second banner stacking on the first (only one autoplayer can
 * hold the keyboard at a time, so this should never happen, but the banner
 * does not need to trust that).
 */
export function showAutoplayerBanner(modId: string): void {
  try {
    const text = `${modId} has the keyboard. Press any key to take it back.`;
    if (shown) {
      const existing = document.getElementById(BANNER_ID);
      if (existing) existing.textContent = text;
      return;
    }
    shown = true;

    const root = document.createElement("div");
    root.id = BANNER_ID;
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.textContent = text;
    /* palette-exempt (every #rrggbb in this file): a DOM overlay drawn above
     * the terminal, not a glyph cell - the z-color palette is for GLYPHS
     * matching the C's, and this is not one. Colours match crash-screen.ts
     * and safe-mode.ts's own DOM overlays so the three read as one family. */
    root.style.cssText = [
      "position:fixed",
      "top:0.5em",
      "right:0.5em",
      "z-index:999999",
      "background:#101014", // palette-exempt: DOM banner, matches crash-screen.ts
      "color:#ffd166", // palette-exempt: DOM banner, matches safe-mode.ts's heading
      "border:1px solid #404052", // palette-exempt: DOM banner border
      "font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "padding:0.5em 0.75em",
      "border-radius:4px",
      "pointer-events:none",
      "max-width:60vw",
    ].join(";");

    (document.body ?? document.documentElement).append(root);
  } catch {
    /* A missing indicator is a smaller failure than a thrown boot. */
  }
}

/** Take the banner down. Safe to call when it was never shown. */
export function hideAutoplayerBanner(): void {
  try {
    document.getElementById(BANNER_ID)?.remove();
  } catch {
    /* no document */
  } finally {
    shown = false;
  }
}
