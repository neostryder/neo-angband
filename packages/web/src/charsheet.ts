/**
 * The character screen (ui-player.c display_player). The core hands us the
 * faithful data models - statTable (the six-column Self/RB/CB/EB/Best/Cur stat
 * block) and characterPanels (topleft / misc / midleft / combat / skills) - and
 * this places them on screen.
 *
 * Upstream display_player draws every panel side by side so the whole sheet
 * fits one 80x24 screen; a naive top-to-bottom list turns that into a 50-row
 * scroll with the combat and ability panels shoved off the bottom. So on a wide
 * terminal we reproduce the columnar layout (stats + identity + progress on the
 * left, combat + skills on the right, one screen, per-cell colour); on a narrow
 * one (a phone) we fall back to the scrolling list, which reads fine there.
 */

import { characterPanels, statTable, colorToCss } from "@neo-angband/core";
import type { GameState, GameObject } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { characterSheetLines } from "./screens";

const LABEL = "#9aa0b4";
const FG = "#c8c8d4";
const DIM = "#8a8a94";
const TITLE = "#e8e8f0";
const YELLOW = "#e0c040";

/** Combat deps the shell can supply (shots / launcher) so the panel is exact. */
export interface CharSheetOpts {
  numShots?: number;
  launcher?: GameObject | null;
}

/** Width at or above which the side-by-side layout is used; below it, the list. */
const WIDE_COLS = 90;

/**
 * Show the character sheet as a modal, repainting on resize so a window that
 * crosses the wide/narrow threshold re-picks its layout. Any of ESC / Enter /
 * Space closes it; the narrow list additionally scrolls with the arrows.
 */
export function showCharacterSheet(
  term: GlyphTerm,
  state: GameState,
  name: string,
  opts: CharSheetOpts = {},
): Promise<void> {
  const deps = {
    ...(name ? { fullName: name } : {}),
    ...(opts.numShots !== undefined ? { numShots: opts.numShots } : {}),
    ...(opts.launcher !== undefined ? { launcher: opts.launcher } : {}),
  };
  return new Promise<void>((resolve) => {
    let top = 0; // scroll offset for the narrow list

    const paintWide = (): void => {
      term.clear();
      const { cols } = term.size();
      term.print(0, 0, "Character", TITLE);

      // Left column: stat table, then identity, then miscellany. statRow keeps
      // the header and the data rows on identical column stops.
      const statRow = (
        label: string,
        self: string,
        rb: string,
        cb: string,
        eb: string,
        best: string,
        flag: string,
        cur: string,
      ): string =>
        `${label.padEnd(5)}${self.padStart(5)} ${rb.padStart(4)} ` +
        `${cb.padStart(4)} ${eb.padStart(4)} ${best.padStart(5)}${flag}${cur.padStart(5)}`;
      let y = 2;
      term.print(0, y++, statRow("Stat", "Self", "RB", "CB", "EB", "Best", " ", "Cur"), LABEL);
      for (const row of statTable(state, deps)) {
        const flag = row.naturalMax ? "!" : " ";
        const cur = row.drained ? row.reduced ?? row.best : row.best;
        const text = statRow(
          row.label.slice(0, 4),
          row.natural,
          row.raceBonus,
          row.classBonus,
          row.equipBonus,
          row.best,
          flag,
          cur,
        );
        term.print(0, y++, text, row.drained ? YELLOW : FG);
      }

      const panels = characterPanels(state, deps);
      const byKey = (k: string) => panels.find((p) => p.key === k)?.lines ?? [];

      // Left column continues below the stat block.
      y += 1;
      y = paintPanel(term, 0, y, 8, byKey("topleft"));
      y += 1;
      paintPanel(term, 0, y, 8, byKey("misc"));

      // Middle column: level / experience / gold / burden / depth. The stat rows
      // reach column ~40, so the middle column starts past them.
      paintPanel(term, 44, 2, 11, byKey("midleft"));

      // Right column: combat, then the ability skills. Placed only if it fits.
      // labelWidth 15 clears the longest label ("Disarm - phys.").
      const rightX = 66;
      if (cols >= rightX + 24) {
        let ry = paintPanel(term, rightX, 2, 15, byKey("combat"));
        ry += 1;
        paintPanel(term, rightX, ry, 15, byKey("skills"));
      }

      term.print(0, term.size().rows - 1, "[ Press ESC to return ]", DIM);
    };

    const paintNarrow = (): void => {
      const { cols, rows } = term.size();
      const lines = characterSheetLines(state, name);
      term.clear();
      term.print(0, 0, "Character".slice(0, cols - 1), TITLE);
      const bodyRows = rows - 3;
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (top > maxTop) top = maxTop;
      for (let r = 0; r < bodyRows; r++) {
        const line = lines[top + r];
        if (!line) break;
        term.print(0, 2 + r, line.text.slice(0, cols - 1), line.color ?? FG);
      }
      const more =
        maxTop > 0
          ? `  (${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length})`
          : "";
      term.print(0, rows - 1, `[ Press ESC to return ]${more}`.slice(0, cols - 1), DIM);
    };

    const paint = (): void => {
      if (term.size().cols >= WIDE_COLS) paintWide();
      else paintNarrow();
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - 4);
      switch (ev.key) {
        case "Escape":
        case "Enter":
        case " ":
          window.removeEventListener("keydown", onKey, true);
          term.onResize = prevResize;
          resolve();
          return;
        case "ArrowDown":
          top += 1;
          break;
        case "ArrowUp":
          top = Math.max(0, top - 1);
          break;
        case "PageDown":
          top += page;
          break;
        case "PageUp":
          top = Math.max(0, top - page);
          break;
        default:
          return;
      }
      paint();
    };

    // Repaint on resize so crossing the wide/narrow threshold re-lays out.
    const prevResize = term.onResize;
    term.onResize = (size) => {
      prevResize?.(size);
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/**
 * Draw one characterPanels panel as a label/value column at (x, y): the label
 * left-justified to `labelWidth` in the label colour, the value after it in the
 * row's own colour. Blank separators advance a row; label-only lines (section
 * headers such as "Turns used:") print bare. Returns the next free row.
 */
function paintPanel(
  term: GlyphTerm,
  x: number,
  y: number,
  labelWidth: number,
  lines: readonly { label: string; value: string; color: number }[],
): number {
  for (const ln of lines) {
    if (!ln.label && !ln.value) {
      y += 1;
      continue;
    }
    const label = ln.label.replace(/:\s*$/u, "");
    if (!ln.value) {
      term.print(x, y++, label, LABEL);
      continue;
    }
    term.print(x, y, label.padEnd(labelWidth), LABEL);
    term.print(x + labelWidth + 1, y, ln.value, colorToCss(ln.color));
    y += 1;
  }
  return y;
}
