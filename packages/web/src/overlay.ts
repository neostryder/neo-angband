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

import { userFileExists, userPath } from "./userdir";
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

import { UI_TEXT, UI_DIM, UI_GOLD, UI_BG, UI_CURSOR } from "./ui-colors";

const FG = UI_TEXT;
/** curs_attrs[CURS_KNOWN][1] (ui-menu.c:32): the selected menu row's colour. */
const CURSOR = UI_CURSOR;
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
 *
 * This is get_com_ex / textui_get_com (ui-input.c:1407); textui_get_com is only
 * get_com_ex narrowed to an ASCII char, so it has no separate counterpart. The
 * C returns false on ESCAPE where callers here compare the resolved key.
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

/** The buffer and cursor askfor_aux threads through its keypress handler. */
interface LineEdit {
  buf: string;
  /** k in askfor_aux (L864). Starts at 0, i.e. in FRONT of the default. */
  curs: number;
}

/**
 * askfor_aux_keypress (ui-input.c:662-800), the line editor both prompts share.
 * Upstream handles exactly six cases and no others, and anything unmatched is
 * inert -- which is also how askfor_aux_numbers (ui-options.c:1026) restricts
 * itself to digits: it switches on the keys it allows and delegates every one of
 * them here, returning false for the rest. Hence `accepts`.
 *
 * The `firsttime` rule is the whole point of the function and the part the port
 * originally dropped (found by W1-CITED, fixed 2026-07-26): a default answer
 * behaves like a suggestion you type OVER, not text you append to. The flag
 * clears after ANY keypress (L910).
 */
function askforAuxKeypress(
  st: LineEdit,
  maxLen: number,
  key: string,
  firsttime: boolean,
  accepts: (ch: string) => boolean,
): "escape" | "enter" | "edit" {
  /* ESCAPE (L669-673) / KC_ENTER (L675-679). */
  if (key === "Escape") return "escape";
  if (key === "Enter") return "enter";

  if (key === "ArrowLeft") {
    /* L682-689: the first left jumps to the front, it does not step. */
    st.curs = firsttime ? 0 : Math.max(0, st.curs - 1);
  } else if (key === "ArrowRight") {
    /* L691-698. */
    st.curs = firsttime ? st.buf.length : Math.min(st.buf.length, st.curs + 1);
  } else if (key === "Backspace" || key === "Delete") {
    if (firsttime) {
      /* L703-709: "If this is the first time round, backspace means delete
       * all". The C shares the case, so Delete does it too. */
      st.buf = "";
      st.curs = 0;
    } else if (key === "Backspace") {
      /* L712-714 refuses to backspace into oblivion. */
      if (st.curs > 0) {
        st.buf = st.buf.slice(0, st.curs - 1) + st.buf.slice(st.curs);
        st.curs--;
      }
    } else if (st.curs < st.buf.length) {
      st.buf = st.buf.slice(0, st.curs) + st.buf.slice(st.curs + 1);
    }
  } else if (key.length === 1 && accepts(key)) {
    /* The printable default (L749-800). */
    if (firsttime) {
      /* L765-771: the first printable key clears the buffer, so a typed answer
       * REPLACES the default. Without this the birth screen's default "Gandalf"
       * plus typing "Bob" produced "GandalfBob". */
      st.buf = "";
      st.curs = 0;
    }
    /* L772-775: refuse when there is no room, rather than truncating. */
    if (st.buf.length < maxLen) {
      st.buf = st.buf.slice(0, st.curs) + key + st.buf.slice(st.curs);
      st.curs++;
    }
  }
  return "edit";
}

/**
 * Draw the buffer with its cursor. There is no Term_gotoxy on this surface, so
 * the cursor is an inverted cell. The text renders in COLOUR_YELLOW while the
 * default is untouched and COLOUR_WHITE after the first keypress (L892 vs L907).
 */
function paintLineEdit(
  term: GlyphTerm,
  x: number,
  y: number,
  st: LineEdit,
  firsttime: boolean,
): void {
  const { cols } = term.size();
  const fg = firsttime ? UI_GOLD : FG;
  term.print(x, y, `${st.buf}`.slice(0, cols - 1 - x), fg);
  const cx = x + st.curs;
  if (cx < cols) term.print(cx, y, st.buf[st.curs] ?? " ", UI_BG, fg);
}

/**
 * A single-line text input (get_string / textui_get_name), ported from
 * askfor_aux (ui-input.c:860) driving askfor_aux_keypress (L662). Resolves the
 * entered string (possibly empty) or null on cancel.
 *
 * The `firsttime` rule is the part that matters and the part the port originally
 * dropped (found by W1-CITED, fixed 2026-07-26). Upstream a default answer
 * behaves like a suggestion you type OVER: the first printable key clears the
 * whole buffer (L765-771) and the first Backspace or Delete deletes all of it
 * (L703-709), while the first ARROW_LEFT jumps to the front and the first
 * ARROW_RIGHT to the end (L682-698) rather than stepping. The flag clears after
 * ANY keypress (L910). Without it the birth screen's default "Gandalf" plus
 * typing "Bob" produced "GandalfBob".
 *
 * The cursor is real: k starts at 0, i.e. in FRONT of the default (L864), and
 * insert/delete happen at it. There is no Term_gotoxy on this surface, so it
 * draws as an inverted cell. The default renders in COLOUR_YELLOW until the
 * first keypress and COLOUR_WHITE after (L892 vs L907).
 *
 * askfor_aux_keypress handles exactly six cases and no others -- ESCAPE,
 * KC_ENTER, ARROW_LEFT, ARROW_RIGHT, KC_BACKSPACE/KC_DELETE, and printable --
 * so anything else is deliberately inert here too.
 *
 * `randomize` opts this surface into get_name_keypress (ui-input.c L1028), the
 * handler askfor_aux is given for the CHARACTER NAME field specifically: it
 * intercepts '*' ahead of the default handler, replaces the whole buffer with
 * player_random_name's output and resets the cursor to 0 (L1035-1042), then
 * carries on editing. `firsttime` is not consulted by that case, so '*' as the
 * very first key replaces rather than clears-and-inserts; it does clear
 * firsttime afterwards, as any keypress does (L910).
 */
/**
 * askfor_aux over the CURRENT screen (ui-input.c:860), the inline form: the
 * prompt is drawn at row 0 and the answer is typed right after it, leaving
 * everything already on screen untouched.
 *
 * This is the shape of get_character_name (ui-input.c:1145-1169) - `prt("Enter a
 * name for your character (* for a random name): ", 0, 0)` over the character
 * sheet display_player(0) has just drawn - and of get_string generally. The
 * full-screen promptText below is a different thing (its own titled screen) and
 * must not be used where the C keeps the screen.
 *
 * Resolves the entered string, or null on ESCAPE. Clears row 0 either way
 * (`prt("", 0, 0)`, L1162).
 */
export function promptTextInline(
  term: GlyphTerm,
  prompt: string,
  initial = "",
  maxLen = 15,
  randomize?: () => string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const st: LineEdit = { buf: initial, curs: 0 };
    let firsttime = true;
    const x = prompt.length;
    const paint = (): void => {
      const { cols } = term.size();
      term.print(0, 0, " ".repeat(Math.max(0, cols - 1)), FG);
      term.print(0, 0, prompt.slice(0, cols - 1), FG);
      paintLineEdit(term, x, 0, st, firsttime);
    };
    const finish = (value: string | null): void => {
      window.removeEventListener("keydown", onKey, true);
      clearPromptRow(term);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const wasFirst = firsttime;
      firsttime = false;
      /* get_name_keypress' '*' -> player_random_name (ui-input.c L1035-1042). */
      if (randomize && ev.key === "*") {
        const generated = randomize();
        if (generated !== "") {
          st.buf = generated.slice(0, maxLen);
          st.curs = 0;
        }
        paint();
        return;
      }
      const r = askforAuxKeypress(st, maxLen, ev.key, wasFirst, () => !ev.ctrlKey && !ev.metaKey);
      if (r === "escape") return finish(null);
      if (r === "enter") return finish(st.buf);
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/**
 * get_string (textui_get_string, ui-input.c:1181): `prt(prompt, 0, 0)`, then
 * askfor_aux over the untouched screen with `initial` as the default answer,
 * then `prt("", 0, 0)`. Resolves the typed string, or null where the C returns
 * false (ESCAPE).
 *
 * `len` is the C's `sizeof(buf)`, so the answer is at most len-1 characters -
 * and askfor_aux narrows that again to what still fits on an 80-column row
 * after the prompt (L881-882: `if (x + len > 80) len = 80 - x`). Callers pass
 * the C's sizeof value verbatim so both limits land where upstream puts them.
 */
export function getString(
  term: GlyphTerm,
  prompt: string,
  initial = "",
  len = 80,
): Promise<string | null> {
  const x = prompt.length;
  const eff = x + len > 80 ? 80 - x : len;
  return promptTextInline(term, prompt, initial, Math.max(1, eff - 1));
}

/**
 * get_quantity (textui_get_quantity, ui-input.c:1206): an amount prompt over
 * the current screen. `max` of 1 answers 1 without asking; otherwise it is a
 * get_string defaulting to "1" with a 7-byte buffer, read with atoi, where a
 * leading '*' or letter means "all", and the result is clamped to [0, max].
 * ESCAPE is 0, which every caller treats as "no".
 *
 * `prompt` is the caller's (e.g. "How many great objects? "); null builds
 * upstream's own "Quantity (0-N, *=all): ".
 */
export async function getQuantity(
  term: GlyphTerm,
  prompt: string | null,
  max: number,
): Promise<number> {
  if (max === 1) return 1;
  const label = prompt ?? `Quantity (0-${max}, *=all): `;
  const s = await getString(term, label, "1", 7);
  if (s === null) return 0;
  /* atoi: leading digits, 0 for anything unparseable. */
  const parsed = Number.parseInt(s, 10);
  let amt = Number.isFinite(parsed) ? parsed : 0;
  /* L1234: only the FIRST character makes it "all". */
  const first = s.charAt(0);
  if (first === "*" || /^[a-zA-Z]$/.test(first)) amt = max;
  if (amt > max) amt = max;
  if (amt < 0) amt = 0;
  return amt;
}

/**
 * get_char (ui-input.c:1300-1329): a one-key choice from a fixed option set.
 * Builds "%.70s[%s] " (strnfmt into a 78-byte buffer), reads one key,
 * lower-cases A-Z, and answers `fallback` for anything not in `options`.
 */
export async function getChar(
  term: GlyphTerm,
  prompt: string,
  options: string,
  fallback = " ",
): Promise<string> {
  const buf = `${prompt.slice(0, 70)}[${options}] `.slice(0, 77);
  let key = await getKeyInline(term, buf);
  /* "Lowercase answer if necessary" (L1318). */
  if (key.length === 1 && key >= "A" && key <= "Z") key = key.toLowerCase();
  if (key.length !== 1 || !options.includes(key)) key = fallback;
  return key;
}

/**
 * get_file (get_file_text, ui-input.c:1335-1383): ask where to write a dump.
 *
 *   File name: <suggested>          get_string over the untouched screen
 *   <empty or leading space>        -> cancel (L1347)
 *   Replace existing file?          only when the user directory has that name
 *   Saving as user/<name>.          prt + anykey + prt("", 0, 0)
 *
 * Resolves the file name, or null on any of the three cancels. The arg_force_name
 * arm (L1348-1368, a host-pinned name with a timestamp appended) has no way to
 * fire in a browser build - see the recorded divergence in the text census - so
 * only the interactive arm is here.
 */
export async function getFile(
  term: GlyphTerm,
  suggestedName: string,
): Promise<string | null> {
  /* char buf[160] (L1337). */
  const name = await getString(term, "File name: ", suggestedName, 160);
  if (name === null) return null;
  /* "Make sure it's actually a filename" (L1346-1347). */
  if (name === "" || name.startsWith(" ")) return null;
  if (userFileExists(name) && !(await getCheck(term, "Replace existing file? "))) {
    return null;
  }
  /* "Tell the user where it's saved to." (L1377-1380). */
  await getKeyInline(term, `Saving as ${userPath(name)}.`);
  return name;
}

export function promptText(
  term: GlyphTerm,
  title: string,
  initial = "",
  maxLen = 15,
  footer = "[ type a name, Enter to accept, ESC to cancel ]",
  randomize?: () => string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const st: LineEdit = { buf: initial, curs: 0 };
    let firsttime = true;
    const PROMPT = "> ";
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      term.print(0, BODY_TOP, PROMPT, FG);
      paintLineEdit(term, PROMPT.length, BODY_TOP, st, firsttime);
      term.print(0, rows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (value: string | null): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const wasFirst = firsttime;
      firsttime = false;
      /* get_name_keypress' '*' case (ui-input.c L1035-1042), ahead of the
       * default handler and independent of firsttime. */
      if (randomize && ev.key === "*") {
        const generated = randomize();
        if (generated !== "") {
          st.buf = generated.slice(0, maxLen);
          st.curs = 0;
        }
        paint();
        return;
      }
      const r = askforAuxKeypress(
        st,
        maxLen,
        ev.key,
        wasFirst,
        () => !ev.ctrlKey && !ev.metaKey,
      );
      if (r === "escape") return finish(null);
      if (r === "enter") return finish(st.buf);
      paint();
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
    const st: LineEdit = { buf: String(current), curs: 0 };
    let firsttime = true;
    const PROMPT = "> ";
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, HEADER_ROW, title.slice(0, cols - 1), TITLE);
      let y = BODY_TOP;
      if (subtitle) {
        term.print(0, y, subtitle.slice(0, cols - 1), DIM);
        y += 1;
      }
      term.print(0, y, PROMPT, FG);
      paintLineEdit(term, PROMPT.length, y, st, firsttime);
      term.print(0, rows - 1, "[ digits, Enter to accept, ESC to cancel ]".slice(0, cols - 1), DIM);
    };
    const finish = (value: number | null): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const wasFirst = firsttime;
      firsttime = false;
      /* askfor_aux_numbers (ui-options.c:1026) allows ESCAPE, ENTER, the two
       * arrows, DELETE, BACKSPACE and the ten digits, delegates every one of them
       * to askfor_aux_keypress, and returns false -- inert -- for anything else. */
      const r = askforAuxKeypress(st, maxLen, ev.key, wasFirst, (ch) =>
        /^[0-9]$/.test(ch),
      );
      if (r === "escape") return finish(null);
      if (r === "enter") {
        const n = st.buf.length > 0 ? Number.parseInt(st.buf, 10) : current;
        const clamped = Math.max(min, Math.min(max, Number.isFinite(n) ? n : current));
        return finish(clamped);
      }
      paint();
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
   * The object's inscription (`obj->note`, the upstream quark) for rows in the
   * get_item picker, so `@`-tags can quick-select this row (MN_INSCRIP_TAGS /
   * get_tag, ui-object.c:693-753). Only the item picker reads it; every other
   * menu leaves it unset and behaves exactly as before.
   */
  inscrip?: string | null;
  /**
   * One-line help for THIS row, shown on a reserved line above the footer
   * while the row is under the cursor (the game menu's action descriptions,
   * char-select's roster detail, birth's per-race/class notes). When any item
   * in the menu carries a hint, the hint line is reserved for all of them so
   * the list never jumps as the cursor moves.
   */
  hint?: string;
  /**
   * A right-hand annotation drawn at a fixed column in its OWN colour, after
   * the label. This is display_rune's second field (ui-knowledge.c:2201-2202:
   * `c_put_str(COLOUR_YELLOW, inscrip, row, 47)`) - the rune's autoinscription
   * beside its name. Rows without one paint exactly as before.
   */
  suffix?: { text: string; color: string; col: number };
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
  /**
   * Enables the `@`-inscription quick-select (MN_INSCRIP_TAGS) on this menu, for
   * the object pickers upstream drives through get_item. The value is the
   * invoking command's own key (cmd_lookup_key_unktrl), matched by the `@xn`
   * form; set it only on menus whose rows carry MenuItem.inscrip. Leaving it
   * unset keeps digits meaning cursor navigation, as every other menu expects.
   */
  inscripCmdKey?: string | undefined;
  /** MN_DBL_TAP / read-only menu: Enter and letters never resolve; only ESC does. */
  browseOnly?: boolean;
  /**
   * MN_CASELESS_TAGS (ui-menu.h:192): match a typed tag letter without regard to
   * case. Only three upstream menus set it - the death menu (ui-death.c:397),
   * the option menus (ui-options.c:2074) and the spell menu (ui-spell.c:250) -
   * because most tables use both cases of a letter as DIFFERENT rows. Leave it
   * unset and the tag match is exact, as get_cursor_key's default is.
   */
  caselessTags?: boolean;
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
  /**
   * Control-modified command keys, for death_screen's KTRL('X') / KTRL('N')
   * (ui-death.c:406-407). Upstream matches the control CODE against cmd_keys,
   * and KTRL('X') is 0x18 rather than 'x', so a control chord can never collide
   * with a row tag - which is why `commands` above is matched only when no
   * modifier is held. Keys are named unmodified and lower case ("x" for Ctrl-X).
   * A handler returning MENU_CLOSE closes the menu with that sentinel (the
   * caller acted and wants out), a row index resolves that row, null/void
   * consumes the chord.
   */
  ctrlCommands?: Record<string, (cursor: number) => number | null | void>;
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
 *
 * This is the port of ui-menu.c's whole menu object for every non-item menu, so
 * menu_new (ui-menu.c:980) - the allocator for `struct menu` - has no
 * counterpart: a menu here is one call with its rows, not a long-lived struct
 * with a skin, an iterator and priv state. (Object selection keeps its own
 * shape in itemSelect below, upstream's item_menu.)
 */
/**
 * selectFromMenu resolves with this sentinel (instead of a row index or null)
 * when the caller set SelectMenuOptions.optionsKey and the user pressed it -
 * the do_cmd_options_birth '=' path. A negative value never collides with a
 * real 0..n-1 row index; callers that never set optionsKey never see it.
 */
export const MENU_OPTIONS = -2;

/**
 * A ctrlCommands handler returns this to close the menu without selecting a
 * row - death_screen's `break` on KTRL('X') (ui-death.c:406), where the caller
 * has already decided what happens next. Negative, so it never collides with a
 * real row index; callers that set no ctrlCommands never see it.
 */
export const MENU_CLOSE = -3;

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
        // display_menu_row (ui-menu.c:577-585): the tag is "%c) " - three
        // columns - and the WHOLE row (tag included) takes the cursor colour
        // when selected. There is no '>' marker in Angband; the selected row is
        // light blue and carries the terminal cursor (set after this loop).
        const prefix = letter ? `${letter}) ` : "   ";
        const color = it.disabled
          ? DIM
          : i === cursor
            ? (extra?.cursorColor ?? CURSOR)
            : it.color ?? FG;
        term.print(0, BODY_TOP + r, `${prefix}${it.label}`.slice(0, cols - 1), color);
        /* display_rune's second field: its own colour at its own column. */
        const sfx = it.suffix;
        if (sfx && sfx.text.length > 0 && sfx.col < cols - 1) {
          term.print(
            sfx.col,
            BODY_TOP + r,
            sfx.text.slice(0, cols - 1 - sfx.col),
            it.disabled ? DIM : sfx.color,
          );
        }
      }
      // Term_gotoxy on the selected row (display_scrolling, ui-menu.c:212-213):
      // the yellow frame the Windows front end draws for the cursor.
      if (cursor >= top && cursor < top + bodyRows) {
        term.setCursor?.(0, BODY_TOP + (cursor - top));
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
      // both meanings (upstream keeps the two key sets disjoint). Named keys
      // ("Delete", "Backspace") are matched too, so a screen can offer an action
      // that does not consume one of the a-z selection letters.
      // Control chords first: upstream compares the control CODE, so KTRL('X')
      // is 0x18 and never matches the 'x' in cmd_keys or a row tag
      // (ui-death.c:406-407 alongside the 'x' Examine row). The plain layer
      // below is therefore matched only when NO modifier is held, or Ctrl-X
      // would fire the Examine row on its way past.
      const ctrlCommands = extra?.ctrlCommands;
      if (ctrlCommands && ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.length === 1) {
        const chord = ctrlCommands[ev.key.toLowerCase()];
        if (chord) {
          const res = chord(cursor);
          if (res === MENU_CLOSE) finish(MENU_CLOSE);
          else if (typeof res === "number") pick(res);
          return;
        }
      }
      if (commands && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        const cmd =
          ev.key.length === 1
            ? commands[ev.key] ?? commands[ev.key.toLowerCase()]
            : commands[ev.key];
        if (cmd) {
          const res = cmd(cursor);
          if (typeof res === "number") pick(res);
          return;
        }
      }
      // `@`-inscription quick-select, for the object pickers that opt in via
      // inscripCmdKey. get_cursor_key (ui-menu.c:488-490) resolves the digit
      // before any tag match, and it must also come before menuNav below, which
      // would otherwise swallow the digit as a cursor move.
      if (extra?.inscripCmdKey !== undefined && ev.key >= "0" && ev.key <= "9") {
        const row = inscripTagRow(items, ev.key, extra.inscripCmdKey);
        if (row >= 0) {
          pick(row);
          return;
        }
      }
      if (ev.key.length === 1) {
        // get_cursor_key (ui-menu.c:480): an explicit per-item tag (see
        // MenuItem.tag) is matched before nav, so a tag letter/digit is honoured
        // rather than swallowed as a cursor move. The match is EXACT unless the
        // menu sets MN_CASELESS_TAGS (L485-509), which only three upstream menus
        // do - death, options and spell. It has to be exact by default because
        // several tables deliberately use both cases of a letter: the debug
        // command menu's Items rows are 'c' Create an object and 'C' Create an
        // artifact (ui-game.c:247-248), and a caseless match made every
        // upper-case row in that menu unreachable.
        const lower = ev.key.toLowerCase();
        const exact = items.findIndex((it) => it.tag === ev.key);
        const tagIdx =
          exact >= 0
            ? exact
            : extra?.caselessTags
              ? items.findIndex((it) => it.tag && it.tag.toLowerCase() === lower)
              : -1;
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
 * get_tag (ui-object.c:693-753): the row in `items` that the `@`-inscription
 * tag `digit` selects, or -1 for none. Scans the rows in list order and, within
 * each row's inscription, every '@' in turn; an '@' matches when the character
 * after it IS the digit (`@1`), or when it is `cmdKey` and the one after THAT is
 * the digit (`@q1` - the "@xn" form, where x is the command the tag is for, so
 * one object can carry a different slot per command). First row wins.
 *
 * `cmdKey` is the command's own keypress (cmd_lookup_key_unktrl, ui-game.c:461),
 * which differs between the two keysets - so the same `@z1` picks a different
 * command under rogue_like_commands, exactly as upstream.
 */
export function inscripTagRow(
  items: readonly MenuItem[],
  digit: string,
  cmdKey?: string,
): number {
  for (let i = 0; i < items.length; i++) {
    const note = items[i]?.inscrip;
    if (!note) continue;
    // strchr(quark_str(obj->note), '@'), then strchr(s + 1, '@') (L720, L747).
    for (let at = note.indexOf("@"); at >= 0; at = note.indexOf("@", at + 1)) {
      if (note[at + 1] === digit) return i;
      if (cmdKey && note[at + 1] === cmdKey && note[at + 2] === digit) return i;
    }
  }
  return -1;
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
 *
 * `cmdKey` is the invoking command's own key, enabling the `@`-inscription
 * quick-select (MN_INSCRIP_TAGS, item_menu L1160-1177): see inscripTagRow. It is
 * resolved against the CURRENTLY displayed source, which is where upstream reads
 * it too - item_menu rebuilds m->inscriptions from the current command_wrk list
 * on every re-entry and frees it on the way out (L1164, L1221), so a tag never
 * carries across a source switch.
 */
export function itemSelect(
  term: GlyphTerm,
  prompt: string,
  sources: readonly ItemMenuSource[],
  initialSource = 0,
  cmdKey?: string,
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
        const tag = sourceTag(src(), i);
        const color = it.disabled ? DIM : i === cursor ? CURSOR : it.color ?? FG;
        term.print(0, listTop + r, `${tag}) ${it.label}`.slice(0, cols - 1), color);
      }
      if (cursor >= top && cursor < top + bodyRows) {
        term.setCursor?.(0, listTop + (cursor - top));
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
        // `@`-inscription quick-select. get_cursor_key (ui-menu.c:488-490) does
        // this substitution BEFORE any tag match, so an inscribed digit beats a
        // literal digit tag (the quiver's own 0-9 lettering).
        if (ev.key >= "0" && ev.key <= "9") {
          const row = inscripTagRow(src().items, ev.key, cmdKey);
          if (row >= 0) {
            pick(row);
            return;
          }
        }
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
