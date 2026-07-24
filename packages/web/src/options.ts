/**
 * The options menu ('=', do_cmd_options / option_toggle_menu / do_cmd_delay /
 * do_cmd_hp_warn, ui-options.c, Angband 4.2.6).
 *
 * Upstream's do_cmd_options (L2066) is a lettered menu_action[] list whose
 * rows dispatch into sub-screens; option_actions[] (L2038) tags each row with
 * a STABLE letter (a, b, x, w, i, {, d, h, m, o, s, t, u, p, e, c, v) that is
 * not simply the row's position (there are blank separator rows too), and
 * do_cmd_options itself sets MN_CASELESS_TAGS so either case of a tag
 * selects the row. This shell builds only the rows that make sense without a
 * filesystem or subwindows, but keeps their upstream letters:
 *   (a) User interface options  - option_toggle_menu(OP_INTERFACE)
 *   (b) Birth (difficulty) options - option_toggle_menu(OPT_PAGE_BIRTH+10),
 *       but since this screen only runs IN-GAME (birth itself is birth.ts's
 *       concern), it is always the read-only OPT_PAGE_BIRTH view: "You can
 *       only modify these options at character birth."
 *   (x) Cheat options - option_toggle_menu(OP_CHEAT), maintainer-confirmed IN
 *       SCOPE 2026-07-16 (the earlier "decision 16 omission" was rescinded).
 *       Toggling a cheat option on couples its score_* twin on in OptionState,
 *       invalidating the character's score exactly as upstream option_set does.
 *   (i) Item ignoring setup - do_cmd_options_item, already built as
 *       openIgnoreSetup() (main.ts); this screen only calls it, so '='
 *       reclaims ownership of the top-level menu while sibling gap #51's
 *       ignore-setup work is reused verbatim, not duplicated.
 *   (d) Set base delay factor - do_cmd_delay
 *   (h) Set hitpoint warning - do_cmd_hp_warn
 *   (m) Set movement delay - do_cmd_lazymove_delay, backed by the core
 *       OptionState.lazymoveDelay scalar (saved and restored like delayFactor);
 *       see runLazymoveDelayPrompt for the modelled-but-inert-effect note.
 *   (o) Set sidebar mode - do_cmd_sidebar_mode. Upstream's SIDEBAR_MODE is a
 *       UI-term display global (angband_term[0]->sidebar_mode), NOT a player
 *       option, so it lives in the web layer (main.ts, localStorage) and is
 *       injected here exactly like the graphics tile-mode selector below.
 * Omitted (documented, not silently dropped):
 *   (w) Subwindow setup - no subwindows modelled; ({) Auto-inscription /
 * (e) keymaps / (c) colours / (v) visuals / (s/t/u/p) pref-file dump-load -
 * no filesystem, the core save IS the persistence.
 *
 * PERSISTENCE: every toggle/setter here calls straight into the live
 * OptionState (state.options), which is already serialized into the core
 * save (SavedGame.options, save.ts) and restored additively (OptionState.
 * restore falls back to table defaults for any field an older save lacks).
 * The caller (main.ts) autosaves after this screen closes; no storage code
 * lives here.
 *
 * RNG SAFETY: nothing in this module reads state.rng, directly or indirectly
 * - every toggle/setter is a pure OptionState mutation, exactly like
 * upstream's option_set / player->opts.* assignment (ui-options.c draws no
 * rand_* calls in do_cmd_options, option_toggle_handle, do_cmd_delay, or
 * do_cmd_hp_warn).
 *
 * FLAGGED NO-OP READERS: the (a) User interface options page lists EVERY
 * INTERFACE-type row (table order, option.c init_options), including a few
 * whose backing display system this shell has not built yet. They are fully
 * toggleable and persist in the save (so a save round-trips a player's
 * choice, and a future gap can wire the reader without a save-format change),
 * but toggling them currently has NO visible effect:
 *   - autoexplore_commands - no autoexplore command exists in this port.
 *   - use_old_target - target_set_interactive's "reuse the last target by
 *     default" default-selection nuance is not modelled.
 *   - show_target / highlight_player - the persistent map-cursor highlight
 *     for the current target / the player between turns (outside the '*'/'l'
 *     interactive loop, which already has its own cursor) is not built.
 *   - view_yellow_light - torchlit-terrain yellow tinting (grid_get_attr's
 *     ATTR_LIGHT path) is not modelled in the shell's terrain coloring.
 *   - center_player - see viewport()'s own doc comment in main.ts.
 * Wired (real behaviour, see main.ts): auto_more (gates the -more- message
 * pager pumpMessages, main.ts), rogue_like_commands, use_sound,
 * solid_walls, hybrid_walls, purple_uniques, animate_flicker, mouse_movement,
 * hp_changes_color. Already wired before this gap (unchanged here):
 * pickup_always, pickup_inven, show_flavors, show_damage, disturb_near,
 * notify_recharge, effective_speed, and the birth_* options read at
 * construction.
 */

import {
  OPTION_ENTRIES,
  DEFAULT_HITPOINT_WARN,
  DEFAULT_DELAY_FACTOR,
  DEFAULT_LAZYMOVE_DELAY,
} from "@neo-angband/core";
import type { GameState } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { selectFromMenu, promptNumber, menuNav } from "./overlay";
import type { MenuItem } from "./overlay";
import { UI_TEXT, UI_DIM } from "./ui-colors";
import { runColorsEditor, saveColorPrefs } from "./colors";

const FG = UI_TEXT;
const DIM = UI_DIM;
const TITLE = UI_TEXT;
// Birth-locked options draw greyed (curs_attrs greyed row == COLOUR_SLATE).
const LOCKED = UI_DIM;

/** One row of the interface/birth toggle screen. */
export interface OptionRow {
  name: string;
  description: string;
  value: boolean;
  locked: boolean;
  /** The maintainer/table default (OPTION_ENTRIES.normal), for 'x' reset. */
  defaultValue?: boolean;
}

/**
 * option_page[] (option.c init_options), filtered by page: every
 * OPTION_ENTRIES row of the given `type`, in table order (codegen preserves
 * list-options.h's declaration order), read live from state.options so the
 * screen reflects the current save. `page === "BIRTH"` rows are always
 * `locked: true` (birth options are read-only once play has started; the
 * birth FLOW itself, birth.ts, is the only writer, and that is a sibling
 * concern, not this screen).
 */
function pageRows(
  state: GameState,
  page: "INTERFACE" | "BIRTH" | "CHEAT",
): OptionRow[] {
  return OPTION_ENTRIES.filter((e) => e.type === page).map((e) => ({
    name: e.name,
    description: e.description,
    value: state.options?.get(e.name) ?? e.normal,
    locked: page === "BIRTH",
    defaultValue: e.normal,
  }));
}

/**
 * option_toggle_menu's curated jump-tag string (ui-options.c L326,
 * `selections`): index letters that deliberately EXCLUDE the y/n/t toggle
 * command letters (and s/r/x, upstream's save/restore/reset-to-default
 * actions, which this screen does not implement) so a row jump never shadows
 * a command key. Case-sensitive (MN_DBL_TAP, not MN_CASELESS_TAGS) - lower
 * and upper case are distinct rows, exactly like upstream.
 */
const TOGGLE_TAGS = "abcdefgimopquvwzABCDEFGHIJKLMOPQUVWZ";

/**
 * option_toggle_menu/option_toggle_display/option_toggle_handle (ui-options.c
 * L117-372): a repeatable toggle list. Each row paints as
 * "<desc padded to 45> : yes/no  (name)" (option_toggle_display), matching
 * upstream's own column layout; the cursor row is highlighted and prefixed
 * '>'. Keys: y/Y sets true and advances the cursor (wrapping), n/N sets false
 * and advances, t/T/Enter toggles in place (no advance), ArrowUp/ArrowDown
 * move the cursor, a TOGGLE_TAGS letter jumps directly to that row, Escape
 * resolves. When `readOnly` (the in-game birth-options view: upstream's
 * page===OPT_PAGE_BIRTH with MN_NO_TAGS/empty cmd_keys) no command or jump
 * key does anything at all - only navigation and ESC - and every row renders
 * dimmed, faithfully reproducing "You can only modify these options at
 * character birth."
 *
 * `onToggle` is called only for a row that is neither locked nor on a
 * read-only page; the caller (options.ts) wires it straight to
 * state.options.set(), which already refuses birth-locked names on its own
 * (belt-and-braces - this screen never even offers to toggle one).
 */
export function optionToggleScreen(
  term: GlyphTerm,
  title: string,
  rows: OptionRow[],
  onToggle: (name: string, value: boolean) => void,
  readOnly: boolean,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let cursor = 0;
    let top = 0;
    const prompt = readOnly
      ? "You can only modify these options at character birth."
      : "Set option (y/n/t), 'x' to reset to defaults";
    const footer = readOnly
      ? "[ ESC to return ]"
      : "[ y/n/t to set, x reset, a-z index to jump, ESC to return ]";
    const bodyTop = 3;

    const paint = (): void => {
      const { cols, rows: termRows } = term.size();
      term.clear();
      term.print(0, 0, title.slice(0, cols - 1), TITLE);
      term.print(0, 1, prompt.slice(0, cols - 1), DIM);
      const bodyRows = Math.max(1, termRows - bodyTop - 1);
      if (cursor < top) top = cursor;
      if (cursor >= top + bodyRows) top = cursor - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const row = rows[i];
        if (!row) break;
        const mark = i === cursor ? ">" : " ";
        const desc =
          row.description.length < 45
            ? row.description.padEnd(45, " ")
            : row.description.slice(0, 45);
        const value = row.value ? "yes" : "no ";
        const line = `${mark}${desc}: ${value}  (${row.name})`;
        const color = row.locked ? LOCKED : i === cursor ? TITLE : FG;
        term.print(0, bodyTop + r, line.slice(0, cols - 1), color);
      }
      term.print(0, termRows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      resolve();
    };
    /** Mutate row `i` if it is writable; returns whether it changed. */
    const setAt = (i: number, value: boolean): boolean => {
      const row = rows[i];
      if (!row || row.locked || readOnly) return false;
      onToggle(row.name, value);
      row.value = value;
      return true;
    };
    const advance = (): void => {
      if (rows.length > 0) cursor = (cursor + 1) % rows.length;
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") return finish();
      // Arrows AND numpad digits move the cursor (menuNav), so the numpad works
      // here regardless of NumLock; up/down wrap as before.
      const nav = menuNav(ev);
      if (nav === "up" || nav === "pageup" || nav === "home") {
        if (rows.length > 0) cursor = (cursor - 1 + rows.length) % rows.length;
        paint();
        return;
      }
      if (nav === "down" || nav === "pagedown" || nav === "end") {
        if (rows.length > 0) cursor = (cursor + 1) % rows.length;
        paint();
        return;
      }
      // Horizontal arrows mirror the C scroll-skin (ui-menu.c:224-243): LEFT
      // (ddx<0 -> EVT_ESCAPE) steps back out of the menu, RIGHT (ddx>0 ->
      // EVT_SELECT) toggles the current option. Numpad 4/6 are identical
      // (target_dir), matched via ev.code so NumLock state is irrelevant. Left
      // (escape) is unconditional; right (toggle) is refused on read-only rows
      // by setAt, so the in-game locked birth page stays read-only.
      if (ev.key === "ArrowLeft" || ev.code === "Numpad4") return finish();
      if (ev.key === "ArrowRight" || ev.code === "Numpad6") {
        const row = rows[cursor];
        if (row) setAt(cursor, !row.value);
        paint();
        return;
      }
      if (readOnly) return; // MN_NO_TAGS: no command/jump keys at all.
      if (ev.key === "y" || ev.key === "Y") {
        if (setAt(cursor, true)) advance();
        paint();
        return;
      }
      if (ev.key === "n" || ev.key === "N") {
        if (setAt(cursor, false)) advance();
        paint();
        return;
      }
      if (ev.key === "t" || ev.key === "T" || ev.key === "Enter") {
        const row = rows[cursor];
        if (row) setAt(cursor, !row.value);
        paint();
        return;
      }
      /* 'x' -> options_restore_maintainer (ui-options.c L196-199): reset every
       * writable row on this page to its table/maintainer default, immediately
       * and with no confirm (exactly as upstream). Rows without a known default
       * (should not happen on the INTERFACE page) are left untouched. Custom
       * save/restore ('s'/'r') stay unimplemented: the port has no separate
       * custom-defaults snapshot - the game save IS the persistence. */
      if (ev.key === "x" || ev.key === "X") {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row && row.defaultValue !== undefined) setAt(i, row.defaultValue);
        }
        paint();
        return;
      }
      if (ev.key.length === 1) {
        const i = TOGGLE_TAGS.indexOf(ev.key);
        if (i >= 0 && i < rows.length) {
          cursor = i;
          paint();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/** (a) User interface options: every INTERFACE row, editable. */
async function runInterfacePage(term: GlyphTerm, state: GameState): Promise<void> {
  await optionToggleScreen(
    term,
    "User interface options",
    pageRows(state, "INTERFACE"),
    (name, value) => {
      state.options?.set(name, value);
    },
    false,
  );
}

/** (b) Birth (difficulty) options: every BIRTH row, read-only in-game. */
async function runBirthPage(term: GlyphTerm, state: GameState): Promise<void> {
  await optionToggleScreen(
    term,
    "Birth options",
    pageRows(state, "BIRTH"),
    () => {
      /* read-only: optionToggleScreen never calls onToggle while readOnly. */
    },
    true,
  );
}

/**
 * The EDITABLE birth-options screen shown DURING birth (do_cmd_options_birth,
 * reached by '=' at the quickstart prompt and in every menu_question stage,
 * ui-birth.c:126,848; option_toggle_menu(OPT_PAGE_BIRTH + 10) makes the page
 * editable, ui-options.c:377). Unlike the in-game '=' Birth page (read-only,
 * because birth options lock once play starts), this writes the player's
 * pre-birth choices into `store`, a plain name->boolean map the caller applies
 * as startGame optionOverrides when the character is created. Seeded from the
 * table defaults (OPTION_ENTRIES.normal) for any option the store has not set.
 */
export async function runBirthOptionsEditor(
  term: GlyphTerm,
  store: Record<string, boolean>,
): Promise<void> {
  const rows: OptionRow[] = OPTION_ENTRIES.filter((e) => e.type === "BIRTH").map(
    (e) => ({
      name: e.name,
      description: e.description,
      value: store[e.name] ?? e.normal,
      locked: false,
    }),
  );
  await optionToggleScreen(
    term,
    "Birth options",
    rows,
    (name, value) => {
      store[name] = value;
    },
    false,
  );
}

/**
 * (x) Cheat options (option_toggle_menu(OP_CHEAT), ui-options.c L2042):
 * maintainer-confirmed IN SCOPE 2026-07-16. Every CHEAT-type row (cheat_hear,
 * cheat_room, cheat_xtra, cheat_live), editable exactly like the interface
 * page. Turning any cheat option ON forces its score_* twin ON in the core
 * OptionState (option_set, option.c L162-164), which trips anyScoreSet() so the
 * character is no longer eligible for the high-score table (enter_score's
 * "cheating" gate, score.c L277) - the same score invalidation upstream
 * applies. That coupling lives in OptionState.set, so this screen just calls it.
 */
async function runCheatPage(term: GlyphTerm, state: GameState): Promise<void> {
  await optionToggleScreen(
    term,
    "Cheat options",
    pageRows(state, "CHEAT"),
    (name, value) => {
      state.options?.set(name, value);
    },
    false,
  );
}

/**
 * (d) Set base delay factor (do_cmd_delay, ui-options.c L1057): 0-255,
 * MIN(val, 255)-clamped - promptNumber's generic [min, max] clamp is exactly
 * upstream's rule here (unlike hitpoint warning, see runHitpointWarnPrompt).
 */
async function runDelayFactorPrompt(term: GlyphTerm, state: GameState): Promise<void> {
  const current = state.options?.delayFactor ?? DEFAULT_DELAY_FACTOR;
  const val = await promptNumber(
    term,
    "Command: Base Delay Factor",
    current,
    0,
    255,
    `Current base delay factor: ${current} msec`,
  );
  if (val === null || !state.options) return;
  state.options.delayFactor = val;
}

/**
 * (h) Set hitpoint warning (do_cmd_hp_warn, ui-options.c L1122): 0-9, but any
 * typed value over 9 RESETS to 0 (L1149) rather than clamping to 9 - the
 * verify pass's divergence #3. promptNumber is given a generous upper bound
 * (99, matching its 3-digit buffer) purely so it never mis-clamps the raw
 * value; the >9 -> 0 rule is applied here, on the raw result.
 */
async function runHitpointWarnPrompt(term: GlyphTerm, state: GameState): Promise<void> {
  const current = state.options?.hitpointWarn ?? DEFAULT_HITPOINT_WARN;
  const val = await promptNumber(
    term,
    "Command: Hitpoint Warning",
    current,
    0,
    99,
    `Current hitpoint warning: ${current} (${current * 10}%)`,
  );
  if (val === null || !state.options) return;
  state.options.hitpointWarn = val > 9 ? 0 : val;
}

/**
 * (m) Set movement delay (do_cmd_lazymove_delay, ui-options.c L1162):
 * player->opts.lazymove_delay, MIN(delay, 255)-clamped - promptNumber's [0, 255]
 * clamp is exactly upstream's rule (same as the base delay factor). Upstream
 * shows "Current movement delay: %d (%d msec)" with the msec being value*10.
 *
 * FLAGGED NO-OP EFFECT: the value is fully modelled in core OptionState and
 * round-trips through the save, but toggling it has no visible effect in this
 * shell. Upstream lazymove_delay feeds inkey_scan (ui-input.c L1565/1690) to
 * pace disturbance checks during repeated "lazy" movement; the web input loop
 * is event-driven (keydown -> command), not that polling subsystem, so there
 * is nothing to pace. Persisting the value now means a future input-timing
 * port can honour it without a save-format change - a real gap, not a silent
 * one (mirrors center_player etc. in viewport()'s doc comment, main.ts).
 */
async function runLazymoveDelayPrompt(term: GlyphTerm, state: GameState): Promise<void> {
  const current = state.options?.lazymoveDelay ?? DEFAULT_LAZYMOVE_DELAY;
  const val = await promptNumber(
    term,
    "Command: Movement Delay Factor",
    current,
    0,
    255,
    `Current movement delay: ${current} (${current * 10} msec)`,
  );
  if (val === null || !state.options) return;
  state.options.lazymoveDelay = val;
}

/**
 * (o) Set sidebar mode selector (do_cmd_sidebar_mode, ui-options.c L1085).
 * SIDEBAR_MODE is a UI-term display setting (Left / Top / None), not a player
 * option, so the state + persistence live in the web layer and are injected
 * here (like TileModeMenu). `current()` reads the active mode index, `set()`
 * persists + applies it. The caller (main.ts) owns the layout + localStorage.
 */
export interface SidebarModeMenu {
  /** Mode names in cycle order: Left, Top, None (SIDEBAR_LEFT/TOP/NONE). */
  modes: readonly string[];
  /** The active mode index. */
  current: () => number;
  /** Apply + persist a chosen mode index (repaints the live layout). */
  set: (index: number) => void;
}

/**
 * do_cmd_sidebar_mode's loop (ui-options.c L1085): show the current mode and
 * cycle Left -> Top -> None -> Left on any key, ESC to return. Upstream mutates
 * SIDEBAR_MODE live on each cycle; set() does the same (persist + repaint).
 */
async function runSidebarModePage(
  term: GlyphTerm,
  sidebar: SidebarModeMenu,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const paint = (): void => {
      const { cols } = term.size();
      term.clear();
      term.print(0, 0, "Command: Sidebar Mode".slice(0, cols - 1), TITLE);
      const name = sidebar.modes[sidebar.current()] ?? "?";
      term.print(0, 2, `Current mode: ${name}`.slice(0, cols - 1), FG);
      term.print(
        0,
        4,
        "[ any key: cycle Left/Top/None, ESC to return ]".slice(0, cols - 1),
        DIM,
      );
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        window.removeEventListener("keydown", onKey, true);
        resolve();
        return;
      }
      // A bare modifier press is not a command (upstream inkey() never returns
      // one); ignore so it does not count as a cycle.
      if (["Shift", "Control", "Alt", "Meta"].includes(ev.key)) return;
      const n = sidebar.modes.length;
      if (n > 0) sidebar.set((sidebar.current() + 1) % n);
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/**
 * do_cmd_options ('=', ui-options.c L2066): the top-level Options Menu loop.
 * Reuses selectFromMenu (extended with per-item stable tags, see overlay.ts's
 * MenuItem.tag) for the page list, so upstream's a/b/i/d/h letters stay
 * literal instead of being renumbered by row position; dispatches to the
 * interface/birth toggle pages, the ignore-setup screen (reused verbatim from
 * main.ts, not duplicated here), and the two numeric setters. Loops (like
 * upstream's menu_select) until ESC backs all the way out to the game.
 */
/**
 * The graphics tile-mode selector wiring (task C1). Upstream chooses a graphics
 * mode OUTSIDE do_cmd_options - the SDL2/Windows frontends put "Graphics" in
 * their always-available window menu bar, not in the '=' options command
 * (ui-options.c:2038 has no graphics entry). The web shell mirrors that: this
 * selector is reached from the in-game menu (the web analog of the frontend
 * menu bar), NOT from '='. The caller (main.ts) owns the actual tileset/pref
 * load + localStorage persistence and passes it in, like openIgnoreSetup.
 */
export interface TileModeMenu {
  /** Selectable modes in menu order, including the None (ASCII) entry. */
  modes: readonly { grafID: number; menuname: string }[];
  /** The currently active grafID (GRAPHICS_NONE = ASCII). */
  current: () => number;
  /** Apply + persist a chosen grafID (reloads the tileset and repaints). */
  apply: (grafID: number) => Promise<void>;
}

/**
 * Pick a graphics tile set (or ASCII). Reached from the in-game menu (the web
 * analog of the SDL/Windows frontend's "Graphics" menu bar), NOT from '=' -
 * upstream selects graphics outside do_cmd_options.
 */
export async function runTileModePage(
  term: GlyphTerm,
  tiles: TileModeMenu,
): Promise<void> {
  const cur = tiles.current();
  const items: MenuItem[] = tiles.modes.map((m) => ({
    label: m.grafID === cur ? `${m.menuname}  (current)` : m.menuname,
  }));
  const idx = await selectFromMenu(
    term,
    "Graphics (tiles) mode",
    items,
    "[ choose a tile set, ESC to keep current ]",
  );
  if (idx === null) return;
  const chosen = tiles.modes[idx];
  if (chosen && chosen.grafID !== cur) await tiles.apply(chosen.grafID);
}

export async function runOptionsMenu(
  term: GlyphTerm,
  state: GameState,
  openIgnoreSetup: () => Promise<void>,
  sidebar?: SidebarModeMenu,
): Promise<void> {
  // Upstream order (option_actions[], ui-options.c L2038): a, b, x, i, then the
  // numeric setters d, h, m, and o. There is deliberately NO graphics entry -
  // upstream picks graphics in the frontend menu bar, not in do_cmd_options; the
  // web shell mirrors that by placing tile selection in the in-game menu.
  const items: MenuItem[] = [
    { label: "User interface options", tag: "a" },
    { label: "Birth (difficulty) options", tag: "b" },
    { label: "Cheat options", tag: "x" },
    { label: "Item ignoring setup", tag: "i" },
    { label: "Edit colours (advanced)", tag: "c" },
    { label: "Set base delay factor", tag: "d" },
    { label: "Set hitpoint warning", tag: "h" },
    { label: "Set movement delay", tag: "m" },
  ];
  if (sidebar) items.push({ label: "Set sidebar mode", tag: "o" });
  // Derive the hint from the live rows so it can never drift out of sync.
  const tagHint = items.map((i) => i.tag).join("/");
  for (;;) {
    const idx = await selectFromMenu(
      term,
      "Options Menu",
      items,
      `[ ${tagHint} to choose, ESC to return ]`,
    );
    if (idx === null) return;
    switch (items[idx]?.tag) {
      case "a":
        await runInterfacePage(term, state);
        break;
      case "b":
        await runBirthPage(term, state);
        break;
      case "x":
        await runCheatPage(term, state);
        break;
      case "i":
        await openIgnoreSetup();
        break;
      case "c":
        // do_cmd_colors (ui-options.c L999): the interactive RGB editor.
        await runColorsEditor(term, saveColorPrefs);
        break;
      case "d":
        await runDelayFactorPrompt(term, state);
        break;
      case "h":
        await runHitpointWarnPrompt(term, state);
        break;
      case "m":
        await runLazymoveDelayPrompt(term, state);
        break;
      case "o":
        if (sidebar) await runSidebarModePage(term, sidebar);
        break;
      default:
        break;
    }
  }
}
