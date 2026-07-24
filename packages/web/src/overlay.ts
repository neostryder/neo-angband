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

import { UI_TEXT, UI_DIM } from "./ui-colors";

const FG = UI_TEXT;
const DIM = UI_DIM;
const TITLE = UI_TEXT;
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

/** getAimDir sentinel: the player pressed '*' (or <click>) to pick a target. */
export const AIM_STAR = -1;
/** getAimDir sentinel: the player pressed "'" to target the closest monster. */
export const AIM_CLOSEST = -2;

/** Keypad direction from an arrow key (ddd/ddx/ddy convention), else 0. */
const ARROW_DIR: Record<string, number> = {
  ArrowUp: 8, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6,
};

/**
 * Clear the row-0 prompt line (prt("", 0, 0) in the reference). The next frame
 * repaints the message line, but blanking here keeps a cancelled prompt from
 * lingering when the caller returns without rendering.
 */
function clearPromptRow(term: GlyphTerm): void {
  const { cols } = term.size();
  term.print(0, 0, " ".repeat(cols - 1), FG);
}

/**
 * textui_get_rep_dir (ui-input.c L1487): a "repeated"/movement direction for
 * open / close / tunnel / disarm / alter / walk / run / jump / steal. Draws the
 * single shared prompt at row 0 in white (prt) and accepts keypad 1-9 and the
 * arrows; ESC cancels. `allow5` mirrors the C allow_5 flag: when false, keypad
 * 5 is equivalent to escape (returns null). It does NOT accept '*' - aiming is
 * a separate function (get_aim_dir). Resolves the keypad digit, or null.
 */
export function getRepDir(
  term: GlyphTerm,
  allow5 = false,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const { cols } = term.size();
    term.print(0, 0, "Direction or <click> (Escape to cancel)? ".slice(0, cols - 1), FG);
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      let dir = 0;
      if (ev.key in ARROW_DIR) dir = ARROW_DIR[ev.key] ?? 0;
      else if (/^[1-9]$/.test(ev.key)) dir = Number(ev.key);
      if (dir === 0) return; // bell(): ignore non-direction keys
      if (dir === 5 && !allow5) return finish(null); // "5 is equivalent to escape"
      finish(dir);
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * textui_get_aim_dir (ui-input.c L1608): an aiming direction for fire / throw /
 * aim / zap / attack spells. Draws one of two row-0 white prompts depending on
 * whether a target is already set (target_okay). Accepts keypad 1-9 and arrows
 * (a compass direction), '*' or <click> to open the target picker (AIM_STAR),
 * "'" for the closest monster (AIM_CLOSEST), and 5/t/0/. to use the current
 * target (returns 5, DIR_TARGET) - the last only when a target is set. ESC
 * cancels. Resolves the keypad digit, a sentinel, 5, or null.
 */
export function getAimDir(
  term: GlyphTerm,
  targetOkay: boolean,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const { cols } = term.size();
    const prompt = targetOkay
      ? "Direction ('5' for target, '*' or <click> to re-target, Escape to cancel)? "
      : "Direction ('*' or <click> to target, \"'\" for closest, Escape to cancel)? ";
    term.print(0, 0, prompt.slice(0, cols - 1), FG);
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish(null);
      if (ev.key === "*") return finish(AIM_STAR);
      if (ev.key === "'") return finish(AIM_CLOSEST);
      if (ev.key === "t" || ev.key === "5" || ev.key === "0" || ev.key === ".") {
        if (targetOkay) return finish(5); // DIR_TARGET
        return; // bell(): no target to use
      }
      let dir = 0;
      if (ev.key in ARROW_DIR) dir = ARROW_DIR[ev.key] ?? 0;
      else if (/^[1-9]$/.test(ev.key)) dir = Number(ev.key);
      if (dir === 0 || dir === 5) return; // bell(): 5 handled above
      finish(dir);
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * textui_get_check (ui-input.c L1255): an inline yes/no confirmation. Builds
 * "%.70s[y/n] " (the prompt truncated to 70 chars, then "[y/n] "), draws it at
 * row 0 in white (prt), and reads a single key. Returns true only for 'y'/'Y';
 * every other key - including Escape - is "no", exactly as the reference. Pure
 * modifier keydowns (Shift/Ctrl/Alt/Meta) are ignored so a Shift+Y chord is
 * not read as an immediate "no".
 */
export function getCheck(term: GlyphTerm, prompt: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { cols } = term.size();
    const buf = `${prompt.slice(0, 70)}[y/n] `;
    term.print(0, 0, buf.slice(0, cols - 1), FG);
    const finish = (value: boolean): void => {
      window.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return; // a modifier alone is not an answer
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish(ev.key === "y" || ev.key === "Y");
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * A single inline keypress over the current screen (prt(prompt, 0, 0); inkey()).
 * Draws `prompt` at row 0 in white, reads ONE key (lone Shift/Ctrl/Alt/Meta
 * ignored), clears row 0, and resolves the key string - the faithful shape of
 * the retire '@' verification (ui-command.c L178-182) and any other "type this
 * exact key to confirm" prompt, which do NOT open a full-screen line editor.
 */
export function getKeyInline(term: GlyphTerm, prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const { cols } = term.size();
    term.print(0, 0, prompt.slice(0, cols - 1), FG);
    const finish = (key: string): void => {
      window.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(key);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish(ev.key);
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
  /**
   * do_cmd_options_birth key ('=', ui-birth.c:126): when set, pressing this key
   * closes the menu resolving with the MENU_OPTIONS sentinel so the caller can
   * open a sub-flow (e.g. the birth-options editor) and then re-show the menu.
   * The menu must close first - opening another modal while this menu's own
   * capturing keydown listener is still attached would double-capture keys.
   */
  optionsKey?: string;
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
/**
 * selectFromMenu resolves with this sentinel (instead of a row index or null)
 * when the caller set SelectMenuOptions.optionsKey and the user pressed it -
 * the do_cmd_options_birth '=' path. A negative value never collides with a
 * real 0..n-1 row index; callers that never set optionsKey never see it.
 */
export const MENU_OPTIONS = -2;

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
      // do_cmd_options_birth ('=', ui-birth.c:126): close the menu with the
      // MENU_OPTIONS sentinel so the caller opens the birth-options editor and
      // re-shows this same menu (a nested modal here would double-capture keys).
      if (extra?.optionsKey && ev.key === extra.optionsKey) {
        finish(MENU_OPTIONS);
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

/** One source (command_wrk) of the get_item picker: its upstream label
 * ("Inven" | "Equip" | "Quiver" | "Floor") and the lettered rows it offers
 * (tags already assigned - a-z via all_letters_nohjkl, or 0-9 for the quiver). */
export interface ItemMenuSource {
  label: string;
  items: readonly MenuItem[];
}

/** The effective selection tag for row `i` of a source (its explicit tag, or
 * the positional all-letters letter as a fallback). */
function sourceTag(src: ItemMenuSource, i: number): string {
  return src.items[i]?.tag ?? menuLetter(i);
}

/**
 * Build the get_item header (menu_header, ui-object.c L764-914): the current
 * source's "Label: a-c," range, then the legality legends for the OTHER
 * sources in upstream order (Equip/Inven via '/', Quiver via '|', floor via
 * '-'), then " ESC", all wrapped in "(...)".
 */
function itemMenuHeader(
  sources: readonly ItemMenuSource[],
  cur: number,
): string {
  const src = sources[cur];
  if (!src) return "()";
  const nonEmpty = (label: string): boolean =>
    sources.some((s, i) => i !== cur && s.label === label && s.items.length > 0);
  let out = `${src.label}:`;
  if (src.items.length > 0) {
    out += ` ${sourceTag(src, 0)}-${sourceTag(src, src.items.length - 1)},`;
  }
  // The "/" legend names the other main carry source (Inven <-> Equip).
  if (src.label === "Inven" && nonEmpty("Equip")) out += " / for Equip,";
  else if (src.label !== "Inven" && nonEmpty("Inven")) out += " / for Inven,";
  else if (src.label !== "Equip" && nonEmpty("Equip")) out += " / for Equip,";
  if (src.label !== "Quiver" && nonEmpty("Quiver")) out += " | for Quiver,";
  if (src.label !== "Floor" && nonEmpty("Floor")) out += " - for floor,";
  out += " ESC";
  return `(${out})`;
}

/**
 * The faithful get_item selection menu (textui_get_item / item_menu,
 * ui-object.c L1142-1315): draws the prompt and the "(Inven: a-c, / for Equip,
 * - for floor, ESC)" header (menu_header), the current source's lettered list,
 * and switches sources with '/', '|' and '-' (m->switch_keys "/|-", L1158).
 * Select by tag letter/digit, cursor + Enter, or tap; ESC cancels. Resolves the
 * chosen { source, index } as indices into the ORIGINAL `sources` array (so the
 * caller maps back to the right handle / floor ref), or null on ESC / empty.
 */
export function itemSelect(
  term: GlyphTerm,
  prompt: string,
  sources: readonly ItemMenuSource[],
  initialSource = 0,
): Promise<{ source: number; index: number } | null> {
  return new Promise((resolve) => {
    const firstNonEmpty = (): number => sources.findIndex((s) => s.items.length > 0);
    let cur =
      sources[initialSource]?.items.length ? initialSource : firstNonEmpty();
    if (cur < 0) {
      resolve(null);
      return;
    }
    let cursor = 0;
    let top = 0;
    let paintedBodyRows = 1;
    const listTop = 1; // area.row = 1 (item_menu L1201).

    const src = (): ItemMenuSource => sources[cur]!;

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      // Prompt then header on the top line (show_prompt + menu header).
      const head = itemMenuHeader(sources, cur);
      term.print(0, HEADER_ROW, prompt.slice(0, cols - 1), TITLE);
      const hx = Math.min(prompt.length + 1, cols - 1);
      term.print(hx, HEADER_ROW, head.slice(0, cols - 1 - hx), DIM);
      const rowsList = src().items;
      const bodyRows = Math.max(1, rows - listTop - 1);
      paintedBodyRows = bodyRows;
      if (cursor < top) top = cursor;
      if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const it = rowsList[i];
        if (!it) break;
        const mark = i === cursor ? ">" : " ";
        const tag = sourceTag(src(), i);
        const color = it.disabled ? DIM : it.color ?? FG;
        term.print(0, listTop + r, `${mark}${tag}) ${it.label}`.slice(0, cols - 1), color);
      }
      term.print(
        0,
        rows - 1,
        "[ a-z/0-9 to choose, / | - to switch, ESC to cancel ]".slice(0, cols - 1),
        DIM,
      );
    };

    const finish = (value: { source: number; index: number } | null): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve(value);
    };
    const pick = (i: number): void => {
      const it = src().items[i];
      if (!it || it.disabled) return;
      finish({ source: cur, index: i });
    };
    const switchTo = (label: string): void => {
      const next = sources.findIndex((s) => s.label === label && s.items.length > 0);
      if (next < 0 || next === cur) return;
      cur = next;
      cursor = 0;
      top = 0;
      paint();
    };
    // The switch key logic mirrors menu_header's legends: '/' toggles the main
    // carry sources, '|' jumps to the quiver, '-' to the floor.
    const doSwitchSlash = (): void => {
      if (src().label === "Inven") switchTo("Equip");
      else if (sources.some((s, i) => i !== cur && s.label === "Inven" && s.items.length > 0))
        switchTo("Inven");
      else switchTo("Equip");
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish(null);
        return;
      }
      if (ev.key === "/") {
        doSwitchSlash();
        return;
      }
      if (ev.key === "|") {
        switchTo("Quiver");
        return;
      }
      if (ev.key === "-") {
        switchTo("Floor");
        return;
      }
      if (ev.key === "Enter") {
        pick(cursor);
        return;
      }
      if (ev.key.length === 1) {
        // Tag letter/digit select (MN_PVT_TAGS), case-insensitive.
        const lower = ev.key.toLowerCase();
        const rowsList = src().items;
        for (let i = 0; i < rowsList.length; i++) {
          if (sourceTag(src(), i).toLowerCase() === lower) {
            pick(i);
            return;
          }
        }
      }
      const nav = menuNav(ev);
      if (nav) {
        const n = src().items.length;
        if (n > 0) {
          if (nav === "up") cursor = (cursor + n - 1) % n;
          else if (nav === "down") cursor = (cursor + 1) % n;
          else if (nav === "pageup") cursor = Math.max(0, cursor - paintedBodyRows);
          else if (nav === "pagedown") cursor = Math.min(n - 1, cursor + paintedBodyRows);
          else if (nav === "home") cursor = 0;
          else if (nav === "end") cursor = n - 1;
        }
        paint();
      }
    };
    window.addEventListener("keydown", onKey, true);
    term.onCellTap?.((cell) => {
      const { rows } = term.size();
      if (cell.row === rows - 1) {
        finish(null);
        return;
      }
      const r = cell.row - listTop;
      if (r < 0 || r >= paintedBodyRows) return;
      const i = top + r;
      const it = src().items[i];
      if (!it || it.disabled) return;
      if (i === cursor) {
        pick(i);
        return;
      }
      cursor = i;
      paint();
    });
    paint();
  });
}
