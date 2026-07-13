/**
 * The character screen (ui-player.c display_player + do_cmd_change_name). The
 * core hands us the faithful data models - statTable (the Self/RB/CB/EB/Best
 * stat block) and characterPanels (topleft / misc / midleft / combat / skills)
 * - and this places them on screen.
 *
 * WIDE (cols >= WIDE_COLS): the upstream 80x24 mode-0 grid at its own anchors
 * (panels[] table, ui-player.c L849): topleft at x=1,y=1; misc at x=21,y=1;
 * the stat table at col 42 (header row 1, data rows 2-6); midleft x=1,y=9;
 * combat x=29,y=9; skills x=52,y=9; player->history wrapped from row 19
 * (display_player_xtra_info). Stat cells carry the upstream per-column colours
 * (Self/Best L_GREEN, RB/CB/EB L_BLUE, drained value YELLOW - L469-507).
 *
 * NARROW (a phone): the scrolling single-column list (characterSheetLines,
 * screens.ts) with the same 6-wide stat fields and blank-unless-drained Cur,
 * scrolled by arrows / PageUp-Down / tap.
 *
 * Keys follow do_cmd_change_name (ui-player.c L1219): 'h'/Space/ArrowLeft =
 * next mode, 'l'/ArrowRight = previous mode, 'c' = change name, 'f' = dump
 * the character to a text file, ESC/Enter = return. Mode 1 (the resist /
 * sustain / ability grid) uses the ui-entry.c system, which core explicitly
 * excludes (char-sheet.ts L19-23), so it renders as a clearly labelled
 * placeholder page rather than a faked grid.
 *
 * Pure display: no game mutation, no RNG. Renaming flows OUT through
 * opts.onRename (the shell persists it); nothing here touches state.
 */

import { characterPanels, statTable, colorToCss } from "@neo-angband/core";
import type { GameState, GameObject } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import {
  characterSheetLines,
  charSheetDeps,
  historyBlockLines,
  statHeaderLine,
  statRowLine,
} from "./screens";
import { promptText } from "./overlay";
import type { ScreenLine } from "./overlay";

const LABEL = "#9aa0b4";
const FG = "#c8c8d4";
const DIM = "#8a8a94";
const TITLE = "#e8e8f0";

/** Combat deps the shell can supply (shots / launcher) so the panel is exact,
 * plus the change-name hook ('c', do_cmd_change_name). */
export interface CharSheetOpts {
  numShots?: number;
  launcher?: GameObject | null;
  /** Called with the new name after a successful 'c' rename; the shell
   * persists it (roster metadata) - the sheet itself mutates nothing. */
  onRename?: (name: string) => void;
}

/** Width at or above which the side-by-side layout is used; below it, the list. */
const WIDE_COLS = 90;

/** INFO_SCREENS (ui-player.c L1213): mode 0 = skills/history, 1 = flag grid. */
const INFO_SCREENS = 2;

/** The upstream panels[] anchors (ui-player.c L849-855). */
const ANCHOR = {
  topleft: { x: 1, y: 1, labelWidth: 6 },
  misc: { x: 21, y: 1, labelWidth: 8 },
  midleft: { x: 1, y: 9, labelWidth: 10 },
  combat: { x: 29, y: 9, labelWidth: 13 },
  skills: { x: 52, y: 9, labelWidth: 15 },
} as const;

/** The stat table column (display_player_stat_info L460) and header row. */
const STAT_COL = 42;
const STAT_HEADER_ROW = 1;

/** History block row (display_player_xtra_info L872: Term_gotoxy(1, 19)). */
const HISTORY_ROW = 19;

/** Mode-1 placeholder (the ui-entry.c resist/ability grid is not ported). */
function modeOnePlaceholder(): ScreenLine[] {
  return [
    { text: "Resistances & Abilities - not yet available", color: TITLE },
    { text: "", color: FG },
    {
      text: "This page (the equipment resist / sustain / ability grid) awaits",
      color: DIM,
    },
    { text: "the ui-entry.c port. Press 'h' to return to the main page.", color: DIM },
  ];
}

/** player_safe_name: a filesystem-safe filename from the character's name. */
function safeFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return `${safe || "character"}.txt`;
}

/** 'f' (dump_save, reduced): download the sheet as a plain-text file. */
function downloadDump(state: GameState, name: string): boolean {
  try {
    const text = characterSheetLines(state, name, 80)
      .map((l) => l.text)
      .join("\n");
    const blob = new Blob([`${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false; // headless / storage-restricted: the sheet stays up
  }
}

/**
 * Show the character sheet as a modal, repainting on resize so a window that
 * crosses the wide/narrow threshold re-picks its layout. ESC / Enter closes
 * it; 'h'/Space/ArrowLeft and 'l'/ArrowRight cycle the two display modes; 'c'
 * renames; 'f' downloads a text dump; the narrow list scrolls with the arrows
 * or a tap.
 */
export function showCharacterSheet(
  term: GlyphTerm,
  state: GameState,
  name: string,
  opts: CharSheetOpts = {},
): Promise<void> {
  let curName = name;
  const mkDeps = () => ({
    ...charSheetDeps(state, curName),
    ...(opts.numShots !== undefined ? { numShots: opts.numShots } : {}),
    ...(opts.launcher !== undefined ? { launcher: opts.launcher } : {}),
  });
  return new Promise<void>((resolve) => {
    let top = 0; // scroll offset for the narrow list
    let mode = 0; // 0 = skills/history, 1 = flag grid (placeholder)
    let narrow = false; // what the last paint drew, for the tap handler

    /** Paint one ScreenLine's runs (or plain text) at (x, y). */
    const printLine = (x: number, y: number, line: ScreenLine): void => {
      if (line.runs) {
        let cx = x;
        for (const run of line.runs) {
          term.print(cx, y, run.text, run.color);
          cx += run.text.length;
        }
      } else {
        term.print(x, y, line.text, line.color ?? FG);
      }
    };

    const title = (): string => {
      const p = state.actor.player;
      return `Character  -  ${curName || "(unnamed)"} the ${p.race.name} ${p.cls.name}, Level ${p.lev}`;
    };

    const wideFooter = (): string =>
      `[ h/Space: page  c: name  f: dump  ESC: back ]  (page ${mode + 1}/${INFO_SCREENS})`;

    const paintWide = (): void => {
      term.clear();
      const { cols, rows } = term.size();
      term.print(0, 0, title().slice(0, cols - 1), TITLE);
      const deps = mkDeps();

      // Stat table at the upstream column stops, shared with the narrow list
      // (statHeaderLine/statRowLine carry the per-column colours).
      printLine(STAT_COL, STAT_HEADER_ROW, statHeaderLine());
      let sy = STAT_HEADER_ROW + 1;
      for (const row of statTable(state, deps)) {
        printLine(STAT_COL, sy++, statRowLine(row));
      }

      const panels = characterPanels(state, deps);
      const byKey = (k: string) => panels.find((p) => p.key === k)?.lines ?? [];

      if (mode === 0) {
        paintPanel(term, ANCHOR.topleft.x, ANCHOR.topleft.y, ANCHOR.topleft.labelWidth, byKey("topleft"));
        paintPanel(term, ANCHOR.misc.x, ANCHOR.misc.y, ANCHOR.misc.labelWidth, byKey("misc"));
        const midEnd = paintPanel(term, ANCHOR.midleft.x, ANCHOR.midleft.y, ANCHOR.midleft.labelWidth, byKey("midleft"));
        const combatEnd = paintPanel(term, ANCHOR.combat.x, ANCHOR.combat.y, ANCHOR.combat.labelWidth, byKey("combat"));
        const skillsEnd = paintPanel(term, ANCHOR.skills.x, ANCHOR.skills.y, ANCHOR.skills.labelWidth, byKey("skills"));
        // History from row 19 (below the lowest panel if one ever grows).
        let hy = Math.max(HISTORY_ROW, midEnd + 1, combatEnd + 1, skillsEnd + 1);
        for (const line of historyBlockLines(state, cols)) {
          if (hy >= rows - 1) break;
          printLine(0, hy++, line);
        }
      } else {
        // Mode 1 keeps the stat table + topleft panel (display_player L905)
        // and labels the unported grid instead of faking it.
        paintPanel(term, ANCHOR.topleft.x, ANCHOR.topleft.y, ANCHOR.topleft.labelWidth, byKey("topleft"));
        let py = 9;
        for (const line of modeOnePlaceholder()) {
          if (py >= rows - 1) break;
          printLine(1, py++, line);
        }
      }

      term.print(0, rows - 1, wideFooter().slice(0, cols - 1), DIM);
    };

    const narrowLines = (): ScreenLine[] => {
      const { cols } = term.size();
      if (mode === 1) return modeOnePlaceholder();
      return characterSheetLines(state, curName, cols);
    };

    const paintNarrow = (): void => {
      const { cols, rows } = term.size();
      const lines = narrowLines();
      term.clear();
      term.print(0, 0, "Character".slice(0, cols - 1), TITLE);
      const bodyRows = rows - 3;
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (top > maxTop) top = maxTop;
      for (let r = 0; r < bodyRows; r++) {
        const line = lines[top + r];
        if (!line) break;
        if (line.runs) {
          let x = 0;
          for (const run of line.runs) {
            if (x >= cols - 1) break;
            const chunk = run.text.slice(0, cols - 1 - x);
            term.print(x, 2 + r, chunk, run.color);
            x += chunk.length;
          }
        } else {
          term.print(0, 2 + r, line.text.slice(0, cols - 1), line.color ?? FG);
        }
      }
      const more =
        maxTop > 0
          ? `  (${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length})`
          : "";
      term.print(
        0,
        rows - 1,
        `[ h: page  c: name  ESC: back ]${more}`.slice(0, cols - 1),
        DIM,
      );
    };

    const paint = (): void => {
      narrow = term.size().cols < WIDE_COLS;
      if (narrow) paintNarrow();
      else paintWide();
    };

    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      term.onResize = prevResize;
      resolve();
    };

    const cycleMode = (delta: number): void => {
      mode = (mode + delta + INFO_SCREENS) % INFO_SCREENS;
      top = 0;
      paint();
    };

    /** 'c' (change name): detach our listeners, run promptText, reattach. */
    const changeName = (): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      void promptText(term, "Enter your character's name", curName).then((entered) => {
        if (entered !== null && entered.trim()) {
          curName = entered.trim();
          opts.onRename?.(curName);
        }
        window.addEventListener("keydown", onKey, true);
        installTap();
        paint();
      });
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - 4);
      switch (ev.key) {
        case "Escape":
        case "Enter":
          finish();
          return;
        // do_cmd_change_name (L1280-1289): h/Space/ArrowLeft cycle FORWARD,
        // l/ArrowRight cycle BACKWARD. On the narrow list Space keeps its
        // close behaviour and the arrows scroll, so only 'h'/'l' cycle there.
        case "h":
          cycleMode(+1);
          return;
        case "l":
          cycleMode(-1);
          return;
        case " ":
          if (narrow) finish();
          else cycleMode(+1);
          return;
        case "ArrowLeft":
          if (!narrow) cycleMode(+1);
          return;
        case "ArrowRight":
          if (!narrow) cycleMode(-1);
          return;
        case "c":
          changeName();
          return;
        case "f":
          downloadDump(state, curName);
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

    /** Tap: on the wide sheet a body tap flips the page (upstream's mouse
     * button 1) and a footer tap closes; on the narrow list a tap scrolls
     * (upper half up, lower half down) and the footer closes. */
    const installTap = (): void => {
      term.onCellTap?.((cell) => {
        const { rows } = term.size();
        if (cell.row === rows - 1) {
          finish();
          return;
        }
        if (!narrow) {
          cycleMode(+1);
          return;
        }
        const page = Math.max(1, rows - 4);
        if (cell.row < Math.floor(rows / 2)) top = Math.max(0, top - page);
        else top += page;
        paint();
      });
    };

    // Repaint on resize so crossing the wide/narrow threshold re-lays out.
    const prevResize = term.onResize;
    term.onResize = (size) => {
      prevResize?.(size);
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    installTap();
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
