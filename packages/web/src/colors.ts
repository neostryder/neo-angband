/**
 * The colour editor (do_cmd_colors -> colors_modify, ui-options.c L876-979): an
 * interactive RGB editor over the live angband_color_table. Reachable from the
 * '=' options menu ('c'). Cycle the current colour with n/N and nudge each
 * channel with k/K (the extra "kv" byte), r/R, g/G, b/B; every edit repaints so
 * the swatches update immediately (upstream's Term_xtra REACT + Term_redraw).
 * ESC leaves and persists.
 *
 * Persistence is a user-global pref (localStorage), matching how the port stores
 * graphics mode / font / sound - upstream keeps colours in a user pref file, not
 * the character save, so they are shared across characters, not per-save.
 */

import {
  COLOR_TABLE,
  MAX_COLORS,
  colorChannel,
  colorTableSnapshot,
  colorToCss,
  restoreColorTable,
  setColorChannel,
} from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { UI_TEXT } from "./ui-colors";

/** localStorage key for the user's edited colour table (a global pref). */
const COLOR_PREF_KEY = "neo-angband:colors";

/**
 * Load the user's saved colour edits into the live table. Called once at boot,
 * before the first paint, so custom colours apply from the start. Best-effort:
 * a missing / malformed value leaves the built-in defaults in place.
 */
export function loadColorPrefs(): void {
  try {
    const raw = localStorage.getItem(COLOR_PREF_KEY);
    if (!raw) return;
    const rows = JSON.parse(raw) as unknown;
    if (Array.isArray(rows)) restoreColorTable(rows as number[][]);
  } catch {
    /* ignore: a corrupt pref just means default colours. */
  }
}

/** Persist the live colour table as the user's colour pref. */
export function saveColorPrefs(): void {
  try {
    localStorage.setItem(COLOR_PREF_KEY, JSON.stringify(colorTableSnapshot()));
  } catch {
    /* ignore: storage may be unavailable (private mode); edits still apply live. */
  }
}

/** hex byte, "0x%02x" style. */
function hx(n: number): string {
  return `0x${n.toString(16).padStart(2, "0")}`;
}

/**
 * colors_modify (ui-options.c L876): edit the live colour table. `persist` is
 * called on exit so the front end can save the edited table (localStorage).
 */
export function runColorsEditor(term: GlyphTerm, persist: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let a = 0; // the current colour index (colors_modify's static `a`).

    const paint = (): void => {
      const { cols } = term.size();
      term.clear();
      term.print(0, 8, "Command: Modify colors", UI_TEXT);

      // The colour name / index char (Term_putstr row 10).
      const info = a < COLOR_TABLE.length ? COLOR_TABLE[a] : undefined;
      const name = info ? info.name : "undefined";
      const indexChar = info ? info.char : "?";
      term.print(5, 10, `Color = ${a}, Name = ${name}, Index = ${indexChar}`, UI_TEXT);

      // The current K / R,G,B bytes (row 12).
      term.print(
        5,
        12,
        `K = ${hx(colorChannel(a, 0))} / R,G,B = ${hx(colorChannel(a, 1))},${hx(
          colorChannel(a, 2),
        )},${hx(colorChannel(a, 3))}`,
        UI_TEXT,
      );

      // The command prompt (row 14).
      term.print(0, 14, "Command (n/N/k/K/r/R/g/G/b/B): ", UI_TEXT);

      // Swatches: "##" in each colour, then its index char, then its number
      // (rows 20-22). Each column is 3 wide; rightmost entries clip on an
      // 80-wide term exactly as upstream's Term_putstr does.
      for (let i = 0; i < COLOR_TABLE.length; i++) {
        const x = i * 3;
        if (x >= cols) break;
        const css = colorToCss(i);
        term.print(x, 20, "##", css);
        const ch = COLOR_TABLE[i]?.char ?? "?";
        term.print(x, 21, ` ${ch}`, css);
        term.print(x, 22, String(i).padStart(2), css);
      }
    };

    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      persist();
      resolve();
    };

    const nudge = (channel: 0 | 1 | 2 | 3, delta: number): void => {
      setColorChannel(a, channel, colorChannel(a, channel) + delta);
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const k = ev.key;
      if (k === "Escape") return finish();
      // n/N cycle the colour index (wrapping over the defined colours).
      if (k === "n") a = (a + 1) % MAX_COLORS;
      else if (k === "N") a = (a - 1 + MAX_COLORS) % MAX_COLORS;
      else if (k === "k") nudge(0, 1);
      else if (k === "K") nudge(0, -1);
      else if (k === "r") nudge(1, 1);
      else if (k === "R") nudge(1, -1);
      else if (k === "g") nudge(2, 1);
      else if (k === "G") nudge(2, -1);
      else if (k === "b") nudge(3, 1);
      else if (k === "B") nudge(3, -1);
      else return; // any other key: ignore (no bell in the web shell)
      paint();
    };

    window.addEventListener("keydown", onKey, true);
    paint();
  });
}
