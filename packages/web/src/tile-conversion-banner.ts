/**
 * The persistent on-screen sign that a Linoleum tile pack is converting for
 * the first time, and the game is still playable underneath (#124).
 *
 * Selecting a Linoleum tile set that has never been converted before slices
 * its whole source atlas into individual PNGs before it can draw anything -
 * for a large pack (Shockbolt, ~1500 tiles) that takes long enough to look
 * identical to a hang if the player is simply left staring at a frozen menu.
 * This banner is the fix for that half of #124: the player is handed back to
 * the game immediately, and this names what is still happening in the
 * background. Streaming individual tiles in as each one finishes converting,
 * rather than applying the whole set at once at the end, is #124's own
 * stretch goal and stays open.
 *
 * Same shape as autoplayer-banner.ts on purpose - a small fixed corner sign,
 * not a full-screen overlay, and `pointer-events:none` so it never intercepts
 * a click or tap meant for the game underneath.
 */

const BANNER_ID = "neo-tile-conversion-banner";

let shown = false;

/**
 * Put the banner up, naming the pack and that graphics apply once it is
 * done. Safe to call again while already shown - the text changes in place
 * rather than a second banner stacking on the first.
 */
export function showTileConversionBanner(packName: string): void {
  try {
    const text = `Converting ${packName} tiles for the first time - the game stays playable, and the tileset applies once this finishes.`;
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
     * the terminal, not a glyph cell - matches autoplayer-banner.ts,
     * crash-screen.ts and safe-mode.ts so the family reads as one. */
    root.style.cssText = [
      "position:fixed",
      "top:0.5em",
      "right:0.5em",
      "z-index:999999",
      "background:#101014", // palette-exempt: DOM banner, matches autoplayer-banner.ts
      "color:#ffd166", // palette-exempt: DOM banner, matches autoplayer-banner.ts
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
export function hideTileConversionBanner(): void {
  try {
    document.getElementById(BANNER_ID)?.remove();
  } catch {
    /* no document */
  } finally {
    shown = false;
  }
}
