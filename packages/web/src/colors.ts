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

import { inputEvents } from "./input-door";
import { colorTableFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  COLOR_TABLE,
  MAX_COLORS,
  colorChannel,
  colorPrefId,
  colorTableSnapshot,
  colorToCss,
  restoreColorTable,
  setColorChannel,
} from "@rpgm-tools/neo-angband-core";
import { readStoredDocument, writeStoredDocument } from "./json-storage";
import type { GridPointerInput, GridSurface } from "./term";
import { screenRegionSpec } from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import { UI_TEXT } from "./ui-colors";

/** localStorage key for the user's edited colour table (a global pref). */
const COLOR_PREF_KEY = "neo-angband:colors";
const colorAlpha = Array.from({ length: MAX_COLORS }, () => 255);

/**
 * Load the user's saved colour edits into the live table. Called once at boot,
 * before the first paint, so custom colours apply from the start. Best-effort:
 * a missing / malformed value leaves the built-in defaults in place.
 */
function documentFromTable(): { colors: { name: string; kv: number; color: { red: number; green: number; blue: number; alpha: number } }[] } {
  return {
    colors: colorTableSnapshot().map((row, index) => ({
      name: colorPrefId(index),
      kv: row[0] ?? 0,
      color: { red: row[1] ?? 0, green: row[2] ?? 0, blue: row[3] ?? 0, alpha: colorAlpha[index] ?? 255 },
    })),
  };
}

function restoreDocument(data: { colors: readonly { kv: number; color: { red: number; green: number; blue: number; alpha: number } }[] }): void {
  data.colors.forEach((row, index) => { colorAlpha[index] = row.color.alpha; });
  restoreColorTable(data.colors.map((row) => [row.kv, row.color.red, row.color.green, row.color.blue]));
}

/** The old pref was a bare array of `[kv, red, green, blue]` tuples, one per row. */
function legacyColors(raw: string): ReturnType<typeof documentFromTable> | null {
  let rows: unknown;
  try {
    rows = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const current = documentFromTable();
  rows.forEach((row, index) => {
    const slot = current.colors[index];
    if (!slot || !Array.isArray(row)) return;
    const [kv, red, green, blue] = row as unknown[];
    if (typeof kv === "number") slot.kv = kv & 255;
    if (typeof red === "number") slot.color.red = red & 255;
    if (typeof green === "number") slot.color.green = green & 255;
    if (typeof blue === "number") slot.color.blue = blue & 255;
  });
  return current;
}

export function loadColorPrefs(): void {
  try {
    colorAlpha.fill(255);
    const read = readStoredDocument(localStorage, COLOR_PREF_KEY, colorTableFormat, legacyColors);
    if (read.data) restoreDocument(read.data);
  } catch {
    /* ignore: a corrupt pref just means default colours. */
  }
}

/** The live palette as a pretty JSON document for a download. */
export function exportColorDocument(): string {
  return serializeDocument(colorTableFormat, documentFromTable());
}

/** Persist the live colour table as the user's colour document. */
export function saveColorPrefs(): boolean {
  try {
    return writeStoredDocument(localStorage, COLOR_PREF_KEY, colorTableFormat, documentFromTable()) !== null;
  } catch {
    /* ignore: storage may be unavailable (private mode); edits still apply live. */
    return false;
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
export function runColorsEditor(host: GridSurface & GridPointerInput, persist: () => void): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
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
      inputEvents.removeEventListener("keydown", onKey, true);
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

    inputEvents.addEventListener("keydown", onKey, true);
    paint();
  }).finally(() => {
    popRegion(handle);
  });
}
