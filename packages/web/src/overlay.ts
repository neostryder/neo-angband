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
import type { Overview } from "./mapview";

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

/** Coarse vertical navigation intent for a scrollable list or lettered menu. */
export type MenuNav = "up" | "down" | "pageup" | "pagedown" | "home" | "end";

/**
 * Menu/list navigation intent from a key event, or null when the key is not
 * navigation. The reference drives every menu cursor through target_dir_allow
 * (ui-target.c:99-108) -> process_dir, where numpad digits and arrow keys are
 * interchangeable directions; for a vertical list only the y component matters,
 * so keypad 7/8/9 move up and 1/2/3 move down (ddy[7..9]=-1, ddy[1..3]=+1),
 * while 4/6 (pure horizontal) do nothing. We mirror that here so the numpad
 * works in menus regardless of NumLock: event.key is the digit when NumLock is
 * ON and an Arrow* name when OFF, and event.code is Numpad* in both states (our
 * belt-and-suspenders). This is the single helper every overlay handler shares
 * so the "numpad is dead in menus" asymmetry cannot creep back in per-screen.
 */
export function menuNav(ev: KeyboardEvent): MenuNav | null {
  switch (ev.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "PageUp":
      return "pageup";
    case "PageDown":
      return "pagedown";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      break;
  }
  const digit = /^[1-9]$/u.test(ev.key)
    ? ev.key
    : /^Numpad[1-9]$/u.test(ev.code)
      ? ev.code.slice(6)
      : "";
  switch (digit) {
    case "7":
    case "8":
    case "9":
      return "up";
    case "1":
    case "2":
    case "3":
      return "down";
    default:
      return null;
  }
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
    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - BODY_TOP - 2);
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") {
        finish();
        return;
      }
      // Scroll with arrows AND numpad digits (menuNav): the numpad must drive
      // scrollable lists regardless of NumLock, not just the arrow keys.
      const bodyRows = rows - BODY_TOP - 1;
      const maxTop = Math.max(0, lines.length - bodyRows);
      const nav = menuNav(ev);
      if (!nav) return;
      if (nav === "up") top = Math.max(0, top - 1);
      else if (nav === "down") top += 1;
      else if (nav === "pageup") top = Math.max(0, top - page);
      else if (nav === "pagedown") top += page;
      else if (nav === "home") top = 0;
      else if (nav === "end") top = maxTop;
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    // Tap: footer row closes; when the content scrolls, a tap in the upper
    // half pages up and in the lower half pages down; a non-scrolling screen
    // closes on any tap (the touch analogue of "any of ESC/Enter/Space").
    term.onCellTap?.((cell) => {
      const { rows } = term.size();
      const bodyRows = rows - BODY_TOP - 1;
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (cell.row === rows - 1 || maxTop === 0) {
        finish();
        return;
      }
      const page = Math.max(1, rows - BODY_TOP - 2);
      if (cell.row < Math.floor(rows / 2)) top = Math.max(0, top - page);
      else top += page;
      paint();
    });
    paint();
  });
}

/**
 * do_cmd_view_map ('M', ui-map.c): a modal, scaled whole-level overview -
 * screen_save / display_map / "Hit any key to continue" / anykey /
 * screen_load, mirroring showTextScreen's Promise + window-keydown shape.
 * `overview` is the priority-resolved miniature buildOverview (mapview.ts)
 * already produced; this only draws it (box border in COLOUR_WHITE, the
 * player's '@' at its scaled cell, the centered footer) and resolves on any
 * key or tap - it builds no rendering of its own.
 */
export function showLevelMap(term: GlyphTerm, overview: Overview): Promise<void> {
  return new Promise<void>((resolve) => {
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      const { mapW, mapH, cells, playerRow, playerCol } = overview;
      if (mapW >= 1 && mapH >= 1) {
        // window_make (ui-output.c): a '+' cornered box in COLOUR_WHITE
        // around the interior, offsetting every interior cell by (+1,+1).
        term.print(0, 0, `+${"-".repeat(mapW)}+`, TITLE);
        term.print(0, mapH + 1, `+${"-".repeat(mapW)}+`, TITLE);
        for (let r = 0; r < mapH; r++) {
          term.print(0, r + 1, "|", TITLE);
          term.print(mapW + 1, r + 1, "|", TITLE);
        }
        for (let r = 0; r < mapH; r++) {
          const row = cells[r];
          if (!row) continue;
          for (let c = 0; c < mapW; c++) {
            const g = row[c];
            if (g) term.print(c + 1, r + 1, g.ch, g.css);
          }
        }
        // The player is always drawn last, on top of whatever occupies its cell.
        term.print(playerCol + 1, playerRow + 1, "@", TITLE);
      }
      const footer = "Hit any key to continue";
      const fx = Math.max(0, Math.floor((cols - footer.length) / 2));
      term.print(fx, rows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onTap, true);
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish();
    };
    const onTap = (ev: Event): void => {
      ev.preventDefault();
      finish();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onTap, true);
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

/**
 * A digit-only numeric prompt (askfor_aux_numbers, ui-options.c L1026): shows
 * the current value on its own line, accepts only digits/Backspace, Enter
 * confirms (clamped to [min, max]), Escape cancels (resolves null). `subtitle`
 * renders as a second line above the input, e.g. "Current hitpoint warning: 3
 * (30%)" (do_cmd_hp_warn) or "Current base delay factor: 40 msec"
 * (do_cmd_delay).
 *
 * The [min, max] clamp matches do_cmd_delay's `MIN(val, 255)` exactly, but
 * do_cmd_hp_warn's ">9 resets to 0" rule is NOT a plain clamp (12 -> 0, not
 * 9) - callers with that rule should pass a generous `max` (so this function
 * never mis-clamps the raw value) and apply the >9 -> 0 reset themselves on
 * the returned number.
 */
export function promptNumber(
  term: GlyphTerm,
  title: string,
  current: number,
  min: number,
  max: number,
  subtitle?: string,
  maxLen = 3,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let buf = String(current);
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      let y = BODY_TOP;
      if (subtitle) {
        term.print(0, y, subtitle.slice(0, cols - 1), DIM);
        y += 1;
      }
      term.print(0, y, `> ${buf}_`.slice(0, cols - 1), FG);
      term.print(0, rows - 1, "[ digits, Enter to accept, ESC to cancel ]".slice(0, cols - 1), DIM);
    };
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      if (ev.key === "Enter") {
        const n = buf.length > 0 ? Number.parseInt(buf, 10) : current;
        const clamped = Math.max(min, Math.min(max, Number.isFinite(n) ? n : current));
        return finish(clamped);
      }
      if (ev.key === "Backspace") {
        buf = buf.slice(0, -1);
        paint();
        return;
      }
      if (/^[0-9]$/.test(ev.key) && buf.length < maxLen) {
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
  /**
   * An explicit tag letter (menu_action's own `.c` tag, e.g. option_actions[]'
   * stable a/b/d/h in ui-options.c), overriding the default positional a,b,c..
   * lettering. Matched case-insensitively (MN_CASELESS_TAGS, do_cmd_options'
   * own menu flag) so pressing either case of the tag selects the row; rows
   * without a tag keep the exact-case positional behaviour untouched.
   */
  tag?: string;
  /**
   * One-line help for THIS row, shown on a reserved line above the footer
   * while the row is under the cursor (the game menu's action descriptions,
   * char-select's roster detail, birth's per-race/class notes). When any item
   * in the menu carries a hint, the hint line is reserved for all of them so
   * the list never jumps as the cursor moves.
   */
  hint?: string;
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
  /**
   * spell_menu_handler's '?' toggle (ui-spell.c L127-142): when set, `detail`
   * only renders while toggled on, and this key flips it (repainting in
   * place, no selection made). Omitted entirely, `detail` behaves as before
   * (always shown) - the curse-removal and ability-browser callers, which
   * predate this toggle, are unaffected since they never set it.
   */
  detailToggleKey?: string;
  /** Initial toggle state when `detailToggleKey` is set (default false, matching spell_menu_new's cast/study call sites; textui_book_browse passes true). */
  detailInitiallyShown?: boolean;
  /**
   * A one-line subtitle under the title (upstream birthmenu_data.hint: the
   * stage-wide "Race affects stats and skills..." line), rendered dim on the
   * row the plain menu leaves blank - no layout shift for callers without it.
   */
  subtitle?: string;
  /**
   * A command-key layer laid over the a-z selection letters, mirroring the
   * store menu's command keys (ui-store.c:1097-1120: p/g buy, s/d sell, l/x
   * examine). Checked BEFORE positional-letter selection and cursor nav, so a
   * command key takes precedence over the same letter's positional meaning
   * (upstream guarantees the command and selection key sets never intersect).
   * The handler receives the current cursor row; returning a number resolves
   * the menu with THAT row index (respecting disabled), returning null/void
   * consumes the key without resolving (the caller handled it, e.g. opened its
   * own sub-flow, or it was a no-op).
   */
  commands?: Record<string, (cursor: number) => number | null | void>;
  /** Footer legend override; wins over the positional `footer` parameter. */
  footer?: string;
  /** Start the cursor on this row (skipped if it is disabled/out of range). */
  initialCursor?: number;
  /** Called with the cursor row on open and after every cursor move. */
  onHighlight?: (index: number) => void;
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
    const wanted = extra?.initialCursor;
    if (wanted !== undefined && wanted >= 0 && wanted < items.length && !items[wanted]?.disabled) {
      cursor = wanted;
    }
    let top = 0;
    // Painted geometry, kept for the tap handler (a tapped screen row maps
    // back to top + (row - listTop) using exactly what the last paint drew).
    let paintedBodyRows = 1;
    let listTop = BODY_TOP;
    const detail = extra?.detail;
    const toggleKey = extra?.detailToggleKey;
    const hasHints = items.some((it) => it.hint !== undefined);
    let detailShown = toggleKey ? (extra?.detailInitiallyShown ?? false) : true;
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      if (extra?.subtitle) {
        term.print(0, HEADER_ROW + 1, extra.subtitle.slice(0, cols - 1), DIM);
      }
      const detailLines = detail && detailShown ? detail(cursor) : [];
      const hintRows = hasHints ? 1 : 0;
      const bodyRows = Math.max(1, rows - BODY_TOP - 1 - detailLines.length - hintRows);
      paintedBodyRows = bodyRows;
      listTop = BODY_TOP;
      if (cursor < top) top = cursor;
      if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const it = items[i];
        if (!it) break;
        const letter = it.tag ?? menuLetter(i);
        const mark = i === cursor ? ">" : " ";
        const prefix = letter ? `${mark}${letter}) ` : `${mark}   `;
        const color = it.disabled ? DIM : i === cursor && extra?.cursorColor ? extra.cursorColor : it.color ?? FG;
        term.print(0, BODY_TOP + r, `${prefix}${it.label}`.slice(0, cols - 1), color);
      }
      let dy = BODY_TOP + bodyRows;
      for (const line of detailLines) {
        if (dy >= rows - 1 - hintRows) break;
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
      if (hasHints) {
        const hint = items[cursor]?.hint ?? "";
        if (hint) term.print(0, rows - 2, hint.slice(0, cols - 1), DIM);
      }
      term.print(0, rows - 1, (extra?.footer ?? footer).slice(0, cols - 1), DIM);
    };
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve(value);
    };
    const setCursor = (i: number): void => {
      if (i === cursor) return;
      cursor = i;
      extra?.onHighlight?.(cursor);
    };
    const pick = (i: number): void => {
      const it = items[i];
      if (!it || it.disabled) return;
      if (extra?.browseOnly) {
        setCursor(i);
        paint();
        return;
      }
      finish(i);
    };
    const commands = extra?.commands;
    const moveUp = (): void => {
      for (let i = cursor - 1; i >= 0; i--) if (!items[i]?.disabled) { setCursor(i); return; }
    };
    const moveDown = (): void => {
      for (let i = cursor + 1; i < items.length; i++) if (!items[i]?.disabled) { setCursor(i); return; }
    };
    const toHome = (): void => {
      for (let i = 0; i < items.length; i++) if (!items[i]?.disabled) { setCursor(i); return; }
    };
    const toEnd = (): void => {
      for (let i = items.length - 1; i >= 0; i--) if (!items[i]?.disabled) { setCursor(i); return; }
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish(null);
        return;
      }
      if (toggleKey && ev.key === toggleKey) {
        detailShown = !detailShown;
        paint();
        return;
      }
      if (ev.key === "Enter") {
        pick(cursor);
        return;
      }
      // Command-key layer (store buy/sell/examine, ui-store.c:1097-1120) sits
      // above positional selection AND cursor nav, so a command letter beats
      // both meanings (upstream keeps the two key sets disjoint).
      if (commands && ev.key.length === 1) {
        const cmd = commands[ev.key] ?? commands[ev.key.toLowerCase()];
        if (cmd) {
          const res = cmd(cursor);
          if (typeof res === "number") pick(res);
          return;
        }
      }
      if (ev.key.length === 1) {
        // MN_CASELESS_TAGS: an explicit per-item tag (see MenuItem.tag) is
        // matched case-insensitively before nav so a tag letter/digit is
        // honoured rather than swallowed as a cursor move. Untagged rows keep
        // the original exact-case positional match (a..z then A..Z).
        const lower = ev.key.toLowerCase();
        const tagIdx = items.findIndex((it) => it.tag && it.tag.toLowerCase() === lower);
        if (tagIdx >= 0) {
          pick(tagIdx);
          return;
        }
      }
      // Cursor navigation: arrows AND numpad digits (menuNav), so the numpad
      // drives menus regardless of NumLock (the "controls dead in menus" bug).
      const nav = menuNav(ev);
      if (nav) {
        if (nav === "up") moveUp();
        else if (nav === "down") moveDown();
        else if (nav === "pageup") for (let i = 0; i < paintedBodyRows; i++) moveUp();
        else if (nav === "pagedown") for (let i = 0; i < paintedBodyRows; i++) moveDown();
        else if (nav === "home") toHome();
        else if (nav === "end") toEnd();
        paint();
        return;
      }
      if (ev.key.length === 1) {
        const idx = LETTERS.indexOf(ev.key);
        if (idx >= 0 && idx < items.length) pick(idx);
      }
    };
    window.addEventListener("keydown", onKey, true);
    // Tap-to-select (MN_DBL_TAP): the first tap on a row highlights it, a tap
    // on the already-highlighted row selects it; a tap on the footer row
    // cancels, exactly like ESC. Registered per-modal and torn down in finish
    // so it never leaks into the game underneath or a sibling modal.
    term.onCellTap?.((cell) => {
      const { rows } = term.size();
      if (cell.row === rows - 1) {
        finish(null);
        return;
      }
      const r = cell.row - listTop;
      if (r < 0 || r >= paintedBodyRows) return;
      const i = top + r;
      const it = items[i];
      if (!it || it.disabled) return;
      if (i === cursor) {
        pick(i);
        return;
      }
      setCursor(i);
      paint();
    });
    extra?.onHighlight?.(cursor);
    paint();
  });
}
