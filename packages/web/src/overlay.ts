/**
 * Modal overlay primitives for the glyph terminal: the reusable screen/menu
 * machinery every full-screen UI (inventory, equipment, character sheet,
 * message history, item/spell selection, birth) is built from.
 *
 * The pattern mirrors the score screen (score.ts): each modal owns the keyboard
 * while open (its own window keydown listener), repaints the whole terminal, and
 * resolves a Promise when dismissed. The caller (main.ts) gates the in-game key
 * handler behind a "modal open" flag so only one owner reads the keyboard at a
 * time, exactly as the upstream single-threaded UI does.
 *
 * These are platform UI, not core: the core stays UI-agnostic (decision 21) and
 * hands us data models (char-sheet panels, gear lists, spell menus); this turns
 * them into faithful full-screen views a keyboard or touch can drive.
 */

import type { GlyphTerm } from "./term";

/** A single styled line of overlay text. `color` is a CSS color string. */
export interface ScreenLine {
  text: string;
  color?: string;
  /**
   * Optional per-run colouring: when present, the row is painted run by run
   * (advancing the column) instead of as one `color` block. Used by the item
   * inspection viewer, whose lines carry multiple colours (obj-info's
   * L_GREEN / L_RED segments). `text` should still hold the concatenated
   * characters so width / scroll bookkeeping stays correct.
   */
  runs?: { text: string; color: string }[];
}

const FG = "#c8c8d4";
const DIM = "#8a8a94";
const TITLE = "#e8e8f0";
const HEADER_ROW = 0;
const BODY_TOP = 2;

/** a-z index letters, then A-Z, matching upstream's all_letters selection. */
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Letter shown for menu row `i` (a..z, A..Z), or "" past the alphabet. */
export function menuLetter(i: number): string {
  return LETTERS[i] ?? "";
}

/**
 * A scrollable full-screen text viewer (inventory, equipment, character sheet,
 * message history, help). Renders `title` at the top and `lines` below it,
 * scrolling with the arrows / PageUp-PageDown when the content is taller than
 * the screen. Any of ESC / Enter / Space closes it; resolves when dismissed.
 */
export function showTextScreen(
  term: GlyphTerm,
  title: string,
  lines: readonly ScreenLine[],
  footer = "[ Press ESC to return ]",
): Promise<void> {
  return new Promise<void>((resolve) => {
    let top = 0;
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      const bodyRows = rows - BODY_TOP - 1; // last row is the footer
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
            term.print(x, BODY_TOP + r, chunk, run.color);
            x += chunk.length;
          }
        } else {
          term.print(0, BODY_TOP + r, line.text.slice(0, cols - 1), line.color ?? FG);
        }
      }
      const more = maxTop > 0 ? `  (${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length})` : "";
      term.print(0, rows - 1, (footer + more).slice(0, cols - 1), DIM);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - BODY_TOP - 2);
      switch (ev.key) {
        case "Escape":
        case "Enter":
        case " ":
          window.removeEventListener("keydown", onKey, true);
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
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/** promptDirection sentinel: the player pressed '*' to pick a target. */
export const AIM_STAR = -1;

/**
 * get_aim_dir: prompt for a keypad direction (1-9). Resolves to the keypad
 * digit, or null if cancelled. Accepts numpad/number keys and the arrows; 5 is
 * DIR_TARGET (use the current target), and '*' resolves to AIM_STAR so the
 * caller can open the target picker. A one-line banner shows over the game so
 * the player keeps their bearings while aiming.
 */
export function promptDirection(
  term: GlyphTerm,
  prompt = "Aim: 1-9 direction, 5/* to target, ESC to cancel",
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const { rows, cols } = term.size();
    term.print(0, rows - 1, prompt.slice(0, cols - 1), "#e0c040");
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      if (ev.key === "*") return finish(AIM_STAR);
      const arrows: Record<string, number> = {
        ArrowUp: 8, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6,
      };
      if (ev.key in arrows) return finish(arrows[ev.key] ?? null);
      if (/^[1-9]$/.test(ev.key)) return finish(Number(ev.key));
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * A single-line text input (get_string / textui_get_name). Renders a prompt and
 * the editable buffer; Enter confirms, Escape cancels (resolves null), Backspace
 * deletes. Resolves the entered string (possibly empty) or null on cancel.
 */
export function promptText(
  term: GlyphTerm,
  title: string,
  initial = "",
  maxLen = 15,
  footer = "[ type a name, Enter to accept, ESC to cancel ]",
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let buf = initial;
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      term.print(0, BODY_TOP, `> ${buf}_`.slice(0, cols - 1), FG);
      term.print(0, rows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (value: string | null): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      if (ev.key === "Enter") return finish(buf);
      if (ev.key === "Backspace") {
        buf = buf.slice(0, -1);
        paint();
        return;
      }
      if (ev.key.length === 1 && buf.length < maxLen && !ev.ctrlKey && !ev.metaKey) {
        buf += ev.key;
        paint();
      }
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/** One selectable row in a menu. Disabled rows show dimmed and cannot be picked. */
export interface MenuItem {
  label: string;
  color?: string;
  disabled?: boolean;
}

/**
 * Optional extras for selectFromMenu, ported from upstream's menu browse_hook
 * (curse_menu_browser, view_ability_menu_browser): a per-cursor detail pane
 * drawn below the list, and (for the read-only ability browser) a "browse
 * only" mode where Enter/letter re-displays the current row instead of
 * closing the menu (upstream's MN_DBL_TAP with no EVT_SELECT action) so only
 * ESC exits.
 */
export interface SelectMenuOptions {
  /** browse_hook: lines shown below the list for the row under the cursor. */
  detail?: (index: number) => readonly ScreenLine[];
  /** MN_DBL_TAP / read-only menu: Enter and letters never resolve; only ESC does. */
  browseOnly?: boolean;
  /** Colour applied to the cursor row instead of its own MenuItem.color (upstream draws the highlighted row COLOUR_WHITE regardless of its normal colour, e.g. view_ability_display). */
  cursorColor?: string;
}

/**
 * A single-column lettered selection menu (the object/spell/command menus).
 * Rows are labelled a).. and picked by that letter; ESC returns null. Resolves
 * to the chosen index, or null if the user cancelled. Disabled rows are shown
 * but reject selection (e.g. a spell too high level, an item that cannot be
 * used). Falls back to arrow-key + Enter selection for touch/discoverability.
 *
 * `extra.detail`, when given, renders a description pane below the list for
 * the row under the cursor (the curse-removal and abilities screens use this
 * to show the curse/ability's long description, mirroring upstream's
 * browse_hook). `extra.browseOnly` turns the menu read-only (abilities): Enter
 * / letter-select just re-paints instead of resolving, so only ESC exits.
 */
export function selectFromMenu(
  term: GlyphTerm,
  title: string,
  items: readonly MenuItem[],
  footer = "[ a-z to choose, ESC to cancel ]",
  extra?: SelectMenuOptions,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let cursor = items.findIndex((it) => !it.disabled);
    if (cursor < 0) cursor = 0;
    let top = 0;
    const detail = extra?.detail;
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      const detailLines = detail ? detail(cursor) : [];
      const bodyRows = Math.max(1, rows - BODY_TOP - 1 - detailLines.length);
      if (cursor < top) top = cursor;
      if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const it = items[i];
        if (!it) break;
        const letter = menuLetter(i);
        const mark = i === cursor ? ">" : " ";
        const prefix = letter ? `${mark}${letter}) ` : `${mark}   `;
        const color = it.disabled ? DIM : i === cursor && extra?.cursorColor ? extra.cursorColor : it.color ?? FG;
        term.print(0, BODY_TOP + r, `${prefix}${it.label}`.slice(0, cols - 1), color);
      }
      let dy = BODY_TOP + bodyRows;
      for (const line of detailLines) {
        if (dy >= rows - 1) break;
        if (line.runs) {
          let x = 0;
          for (const run of line.runs) {
            if (x >= cols - 1) break;
            const chunk = run.text.slice(0, cols - 1 - x);
            term.print(x, dy, chunk, run.color);
            x += chunk.length;
          }
        } else {
          term.print(0, dy, line.text.slice(0, cols - 1), line.color ?? FG);
        }
        dy++;
      }
      term.print(0, rows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const pick = (i: number): void => {
      const it = items[i];
      if (!it || it.disabled) return;
      if (extra?.browseOnly) {
        cursor = i;
        paint();
        return;
      }
      finish(i);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish(null);
        return;
      }
      if (ev.key === "Enter") {
        pick(cursor);
        return;
      }
      if (ev.key === "ArrowDown") {
        for (let i = cursor + 1; i < items.length; i++) {
          if (!items[i]?.disabled) { cursor = i; break; }
        }
        paint();
        return;
      }
      if (ev.key === "ArrowUp") {
        for (let i = cursor - 1; i >= 0; i--) {
          if (!items[i]?.disabled) { cursor = i; break; }
        }
        paint();
        return;
      }
      if (ev.key.length === 1) {
        const idx = LETTERS.indexOf(ev.key);
        if (idx >= 0 && idx < items.length) pick(idx);
      }
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}
