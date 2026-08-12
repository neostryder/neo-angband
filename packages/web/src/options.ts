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
 *   (w) Subwindow setup - the port is ONE terminal, not eight.
 *   ({) Auto-inscription - built, but reachable only from the knowledge
 *       browser ('~'), which is the same screen upstream's row opens.
 * The rest of that list is no longer omitted: (e) keymaps, (c) colours,
 * (v) visuals and the (s/t/u/p) pref-file rows all exist, over the virtual
 * ANGBAND_DIR_USER (prefs-ui.ts, host/io.ts).
 *
 * PERSISTENCE, and it is TWO stores, not one - the sentence that used to sit
 * here ("no filesystem, the core save IS the persistence") was true of only
 * half of it:
 *   - the SAVE holds what THIS character is playing with. Every toggle and
 *     setter below writes the live OptionState (state.options), which
 *     serialises into SavedGame.options and restores additively. main.ts
 *     autosaves when this screen closes; no storage code lives here.
 *   - `customized_birth_options.txt` / `customized_interface_options.txt` in
 *     ANGBAND_DIR_USER hold what the PLAYER wants the NEXT character to start
 *     from ('s' to save, 'r' to restore, option.c L207-328). The save cannot
 *     do that job: at birth there is no save. See customPageDefaults.
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
 *   - show_target / highlight_player - the persistent map-cursor highlight
 *     for the current target / the player between turns (outside the '*'/'l'
 *     interactive loop, which already has its own cursor) is not built.
 *   - view_yellow_light - torchlit-terrain yellow tinting (grid_get_attr's
 *     ATTR_LIGHT path) is not modelled in the shell's terrain coloring.
 * Wired (real behaviour, see main.ts):
 * use_old_target (aimDir returns DIR_TARGET without prompting when it is on and
 * target_okay() holds - ui-input.c:1619-1620. It was on the no-op list above with
 * a WRONG reason, attributed to a default-selection nuance in
 * target_set_interactive; the C uses it in textui_get_aim_dir, and that note had
 * been written from the option's description rather than from its one reader.
 * Default stays false, as upstream ships it),
 * auto_more (gates the -more- message
 * pager pumpMessages, main.ts), rogue_like_commands, use_sound,
 * solid_walls, hybrid_walls, purple_uniques, animate_flicker, mouse_movement,
 * hp_changes_color,
 * center_player (verifyPanel recentres on it rather than only edge-scrolling,
 * main.ts - see viewport()'s own doc comment there),
 * autoexplore_commands (the 'p' explore command is bound in main.ts, and the
 * option itself gates descend/ascend falling through to navigate-down /
 * navigate-up when the player is not standing on the stair,
 * packages/core/src/game/cave-cmd.ts - cmd-cave.c:62-66,107-111).
 * Already wired before this gap (unchanged here):
 * pickup_always, pickup_inven, show_flavors, show_damage, disturb_near,
 * notify_recharge, effective_speed, and the birth_* options read at
 * construction.
 */

import { inputEvents } from "./input-door";
import {
  OPTION_ENTRIES,
  DEFAULT_HITPOINT_WARN,
  DEFAULT_DELAY_FACTOR,
  DEFAULT_LAZYMOVE_DELAY,
  GRAPHICS_NONE,
  host,
  optionsRestoreCustom,
  optionsRestoreMaintainer,
  optionsSaveCustom,
} from "@rpgm-tools/neo-angband-core";
import type { GameState, OptionOpts } from "@rpgm-tools/neo-angband-core";
import type { GridPointerInput, GridSurface } from "./term";
import { getKeyInline, selectFromMenu, promptNumber, menuNav } from "./overlay";
import type { MenuItem } from "./overlay";
import { UI_TEXT, UI_DIM, UI_CURSOR } from "./ui-colors";
import { runColorsEditor, saveColorPrefs } from "./colors";
import { runKeymapEditor } from "./keymap-edit";
import { log } from "./logging";
import {
  dumpAutoinscriptionsRow,
  dumpCharScreenOptions,
  dumpWindowSettings,
  loadUserPrefFileRow,
  runColorsMenu,
  runVisualsMenu,
} from "./prefs-ui";
import type { PrefsUiCtx } from "./prefs-ui";

const FG = UI_TEXT;
/** curs_attrs[CURS_KNOWN][1] (ui-menu.c:32): the selected row's colour. */
const CURSOR = UI_CURSOR;
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
}

/**
 * Build the s/r/x actions for one page over whatever store holds its values -
 * the live OptionState in game, or the plain birth-choice map during birth.
 *
 * The store is adapted to `OptionOpts` (core's spelling of
 * `struct player_options.opt[]`) for the duration of each action, because
 * option.c's three functions all read and write that array and nothing else.
 * Going through a snapshot rather than handing them OptionState directly is
 * what keeps the birth lock intact: OptionState.set refuses birth options after
 * construction, and it should - the at-birth editor is not an OptionState.
 */
function customDefaultsFor(
  term: GridSurface & GridPointerInput,
  page: string,
  rows: OptionRow[],
  get: (name: string) => boolean,
  set: (name: string, value: boolean) => void,
  msg?: (text: string) => void,
): OptionCustomDefaults {
  const snapshot = (): OptionOpts => {
    const opts: OptionOpts = {};
    for (const row of rows) opts[row.name] = get(row.name);
    return opts;
  };
  const writeBack = (opts: OptionOpts): void => {
    for (const row of rows) {
      const v = opts[row.name];
      if (v !== undefined) set(row.name, v);
    }
  };
  return {
    save: () => optionsSaveCustom(host(), snapshot(), page),
    restore: () => {
      const opts = snapshot();
      /* 4.2.6 reports a bad line with msg() (option.c:302, :320, :328), so it
       * reaches the message line and the history screen. It goes to the LOG as
       * well as the message line, unconditionally, because that is where a
       * "Report a problem" dump can find it - and because the birth-time caller
       * has no message line to write to. See customPageDefaults. */
      const ok = optionsRestoreCustom(host(), opts, page, (m) => {
        log.warn("options", m);
        msg?.(m);
      });
      /* The `if` is belt-and-braces and a mutation battery says so: dropping it
       * kills nothing, because optionsRestoreCustom returns false only from its
       * pre-parse early return, so a failed restore leaves `opts` byte-identical
       * to the snapshot and writing it back is a no-op. Kept anyway - the guard
       * is what makes that a property of THIS function rather than a fact about
       * the other one. Not a test to contrive; an unkillable mutant to record. */
      if (ok) writeBack(opts);
      return ok;
    },
    reset: () => {
      const opts = snapshot();
      optionsRestoreMaintainer(opts, page);
      writeBack(opts);
    },
    reload: () => {
      for (const row of rows) row.value = get(row.name);
    },
    /* get_com(", &dummy) with upstream's three literals composed here so the
     * "Press any key to continue." half is written once:
     *   "Successfully saved.  Press any key to continue."
     *   "Save failed.  Press any key to continue."
     *   "Restore failed.  Press any key to continue."
     * Two spaces after the period, as the C has. */
    acknowledge: async (message) => {
      await getKeyInline(term, `${message}  Press any key to continue.`);
    },
  };
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
  }));
}

/**
 * The player's customised defaults for one page, as options_init_defaults reads
 * them (option.c L192-199): the table defaults, then whatever
 * `customized_<page>_options.txt` overrides.
 *
 * This is the READ side of the feature and the reason it exists. What 's' saves
 * on the birth screen has to come back on the NEXT character's birth screen,
 * and the savefile cannot do that job - at that point there is no savefile.
 * birth.ts seeds its birth-choice map from this before the first stage runs.
 */
export function customPageDefaults(page: string): Record<string, boolean> {
  const opts: OptionOpts = {};
  optionsRestoreMaintainer(opts, page);
  /* Log only, and that is a divergence worth naming rather than hiding: this
   * runs where options_init_defaults does, inside player_init, BEFORE a
   * character exists - so there is no state.msg to call and no message line
   * drawn yet. Upstream's msg() at that moment goes into a buffer nobody has
   * shown either. Recorded in docs/PARITY.md. */
  optionsRestoreCustom(host(), opts, page, (m) => log.warn("options", m));
  return opts;
}

/**
 * option_toggle_menu's curated jump-tag string (ui-options.c L326,
 * `selections`): index letters that deliberately EXCLUDE the y/n/t toggle
 * command letters and s/r/x, upstream's save/restore/reset-to-default actions,
 * so a row jump never shadows a command key. Case-sensitive (MN_DBL_TAP, not
 * MN_CASELESS_TAGS) - lower and upper case are distinct rows, exactly like
 * upstream.
 */
const TOGGLE_TAGS = "abcdefgimopquvwzABCDEFGHIJKLMOPQUVWZ";

/**
 * The three s/r/x actions upstream gives a page whose `cmd_keys` contains
 * "SsRrXx" - the INTERFACE page and the AT-BIRTH birth page, and NO others
 * (ui-options.c L333-348). Passing this to optionToggleScreen is how a page
 * declares it has them; a page that passes nothing is upstream's default
 * `cmd_keys = "YyNnTt"`, which is what the CHEAT page gets.
 *
 * `save` and `restore` return upstream's boolean so the screen can print the
 * right one of "Successfully saved." / "Save failed." / "Restore failed.";
 * `reload` re-reads every row after a successful restore or a reset, which is
 * upstream's menu_refresh(m, false).
 */
export interface OptionCustomDefaults {
  /** 's' -> options_save_custom (option.c L212). */
  save: () => boolean;
  /** 'r' -> options_restore_custom (option.c L263). */
  restore: () => boolean;
  /** 'x' -> options_restore_maintainer (option.c L313). No failure mode. */
  reset: () => void;
  /** menu_refresh: pull each row's value back out of the store. */
  reload: () => void;
  /** get_com("<message>  Press any key to continue.", &dummy). */
  acknowledge: (message: string) => Promise<void>;
}

/**
 * option_toggle_menu/option_toggle_display/option_toggle_handle (ui-options.c
 * L117-372): a repeatable toggle list. Each row paints as
 * "<desc padded to 45> : yes/no  (name)" (option_toggle_display), matching
 * upstream's own column layout; the cursor row takes the light-blue cursor
 * colour and the terminal cursor (curs_attrs, ui-menu.c:29-33) - no '>' marker,
 * which upstream does not have. Keys: y/Y sets true and advances the cursor (wrapping), n/N sets false
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
 *
 * `custom` carries the s/r/x actions, and its PRESENCE is what upstream spells
 * as `cmd_keys` (L333-348): only the INTERFACE page and the at-birth birth page
 * have them. Everything else - the CHEAT page in this port - gets y/n/t alone.
 * That gating is not cosmetic: 'x' used to be offered on every editable page
 * here, including CHEAT, where upstream has no such key.
 */
export function optionToggleScreen(
  term: GridSurface & GridPointerInput,
  title: string,
  rows: OptionRow[],
  onToggle: (name: string, value: boolean) => void,
  readOnly: boolean,
  custom?: OptionCustomDefaults,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let cursor = 0;
    let top = 0;
    /* m->prompt, all three of upstream's (ui-options.c L331, L337, L342). */
    const prompt = readOnly
      ? "You can only modify these options at character birth."
      : custom
        ? "Set option (y/n/t), 's' to save, 'r' to restore, 'x' to reset"
        : "Set option (y/n/t), select with movement keys or index";
    const footer = readOnly
      ? "[ ESC to return ]"
      : custom
        ? "[ y/n/t to set, s save, r restore, x reset, a-z jump, ESC to return ]"
        : "[ y/n/t to set, a-z index to jump, ESC to return ]";
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
        const desc =
          row.description.length < 45
            ? row.description.padEnd(45, " ")
            : row.description.slice(0, 45);
        const value = row.value ? "yes" : "no ";
        // display_menu_row's "%c) " tag from m->selections (ui-menu.c:571-582,
        // option_toggle_menu's `selections` = TOGGLE_TAGS) then
        // option_toggle_display's own columns (ui-options.c:117-139): the
        // description padded to 45, then ": yes  (option_name)". The letter is
        // the SAME character that jumps to the row, and a read-only page shows
        // none at all (MN_NO_TAGS, L341).
        const tag = readOnly ? "   " : `${TOGGLE_TAGS[i] ?? " "}) `;
        const line = `${tag}${desc}: ${value}  (${row.name})`;
        const color = row.locked ? LOCKED : i === cursor ? CURSOR : FG;
        term.print(0, bodyTop + r, line.slice(0, cols - 1), color);
      }
      if (cursor >= top && cursor < top + bodyRows) {
        term.setCursor?.(0, bodyTop + (cursor - top));
      }
      term.print(0, termRows - 1, footer.slice(0, cols - 1), DIM);
    };
    const finish = (): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
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
    /**
     * screen_save() / <action> / screen_load() around the s and r keys
     * (ui-options.c L168-193). The listener comes off for the duration so the
     * get_com acknowledgement owns the keyboard - without that, the keypress
     * that dismisses "Successfully saved." also lands on the option list
     * underneath. Re-registered and repainted afterwards, which is
     * screen_load + menu_refresh.
     */
    const runAction = async (action: () => Promise<void>): Promise<void> => {
      inputEvents.removeEventListener("keydown", onKey, true);
      try {
        await action();
      } finally {
        inputEvents.addEventListener("keydown", onKey, true);
        paint();
      }
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
      /* s / r / x exist only where upstream's cmd_keys has "SsRrXx" - see
       * OptionCustomDefaults. A page without them falls through to the jump
       * tags, which is right: TOGGLE_TAGS excludes s, r and x, so the keys are
       * simply inert there, exactly as an unlisted cmd_key is upstream. */
      if (custom) {
        /* 's' -> options_save_custom (ui-options.c L167-175), then get_com's
         * acknowledgement. Not gated on the page being editable: upstream lets
         * you save from any page whose cmd_keys carries S. */
        if (ev.key === "s" || ev.key === "S") {
          void runAction(async () => {
            await custom.acknowledge(
              custom.save() ? "Successfully saved." : "Save failed.",
            );
          });
          return;
        }
        /* 'r' -> options_restore_custom (L180-193). On success the menu just
         * refreshes; only a FAILED restore prints anything. */
        if (ev.key === "r" || ev.key === "R") {
          void runAction(async () => {
            if (custom.restore()) {
              custom.reload();
            } else {
              await custom.acknowledge("Restore failed.");
            }
          });
          return;
        }
        /* 'x' -> options_restore_maintainer (L196-199): every row on this page
         * back to its table default, immediately and with no confirm. */
        if (ev.key === "x" || ev.key === "X") {
          custom.reset();
          custom.reload();
          paint();
          return;
        }
      }
      if (ev.key.length === 1) {
        const i = TOGGLE_TAGS.indexOf(ev.key);
        if (i >= 0 && i < rows.length) {
          cursor = i;
          paint();
        }
      }
    };
    inputEvents.addEventListener("keydown", onKey, true);
    paint();
  });
}

/**
 * (a) User interface options: every INTERFACE row, editable, WITH the s/r/x
 * custom-defaults actions - upstream gives this page `cmd_keys = "YyNnTtSsRrXx"`
 * (ui-options.c L341-347), and it is one of only two pages that get them.
 */
async function runInterfacePage(term: GridSurface & GridPointerInput, state: GameState): Promise<void> {
  const rows = pageRows(state, "INTERFACE");
  await optionToggleScreen(
    term,
    "User interface options",
    rows,
    (name, value) => {
      state.options?.set(name, value);
    },
    false,
    customDefaultsFor(
      term,
      "INTERFACE",
      rows,
      (name) => state.options?.get(name) ?? false,
      (name, value) => {
        state.options?.set(name, value);
      },
      /* The one custom-defaults page reached with a game running, so the one
       * that can put option.c's msg() where upstream puts it. */
      (m) => state.msg?.(m),
    ),
  );
}

/** (b) Birth (difficulty) options: every BIRTH row, read-only in-game. */
async function runBirthPage(term: GridSurface & GridPointerInput, state: GameState): Promise<void> {
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
  term: GridSurface & GridPointerInput,
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
    /* OPT_PAGE_BIRTH + 10 is the other page with "SsRrXx" (L341-347). This is
     * the screen the customised birth defaults exist FOR: what is saved here is
     * what the NEXT character's birth screen opens on. */
    customDefaultsFor(
      term,
      "BIRTH",
      rows,
      (name) => store[name] ?? OPTION_ENTRIES.find((e) => e.name === name)?.normal ?? false,
      (name, value) => {
        store[name] = value;
      },
    ),
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
 *
 * NO s/r/x HERE, and that is upstream: option_toggle_menu gives the cheat page
 * the default `cmd_keys = "YyNnTt"` (ui-options.c L332), so it has no
 * save/restore/reset. This screen used to offer 'x' - optionToggleScreen ran it
 * for every editable page - which was a key upstream does not have. It is now
 * gated on the page declaring OptionCustomDefaults, which only INTERFACE and
 * the at-birth birth page do.
 */
async function runCheatPage(term: GridSurface & GridPointerInput, state: GameState): Promise<void> {
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
async function runDelayFactorPrompt(term: GridSurface & GridPointerInput, state: GameState): Promise<void> {
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
async function runHitpointWarnPrompt(term: GridSurface & GridPointerInput, state: GameState): Promise<void> {
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
async function runLazymoveDelayPrompt(term: GridSurface & GridPointerInput, state: GameState): Promise<void> {
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
  term: GridSurface & GridPointerInput,
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
        inputEvents.removeEventListener("keydown", onKey, true);
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
    inputEvents.addEventListener("keydown", onKey, true);
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
  /**
   * Selectable modes in menu order: ASCII, then core's own tile sets (the
   * upstream list.txt catalog), then anything enabled `tiles`-shape mods add.
   * A mod-supplied row carries that mod's display name in `modName`; core rows
   * leave it unset.
   */
  modes: readonly { grafID: number; menuname: string; modName?: string }[];
  /** The currently active grafID (GRAPHICS_NONE = ASCII). */
  current: () => number;
  /** Apply + persist a chosen grafID (reloads the tileset and repaints). */
  apply: (grafID: number) => Promise<void>;
}

/**
 * Pick a graphics tile set (or ASCII). Reached from the in-game menu (the web
 * analog of the SDL/Windows frontend's "Graphics" menu bar), NOT from '=' -
 * upstream selects graphics outside do_cmd_options.
 *
 * The rows are the upstream catalog, exactly as each frontend builds this menu
 * by walking `graphics_modes` (main-win.c:2897-2905): core content, offered with
 * no mod enabled. A `tiles`-shape mod may ADD a set or re-skin one of these, and
 * only those rows are tagged `[mod name]` - so a tagged row means "this is not
 * stock, and here is the mod to disable to be rid of it", while an untagged row
 * is the tile set upstream ships. The caller (main.ts) composes the list; this
 * page just renders and applies it.
 */
export async function runTileModePage(
  term: GridSurface & GridPointerInput,
  tiles: TileModeMenu,
): Promise<void> {
  const cur = tiles.current();
  const items: MenuItem[] = tiles.modes.map((m) => ({
    label:
      (m.modName ? `${m.menuname}  [${m.modName}]` : m.menuname) +
      (m.grafID === cur ? "  (current)" : ""),
    hint: m.modName
      ? `Graphics tiles from the ${m.modName} mod - disable it to remove this set.`
      : m.grafID === GRAPHICS_NONE
        ? "The faithful ASCII glyphs - the default, always available."
        : "A tile set that ships with the game.",
  }));
  const idx = await selectFromMenu(
    term,
    "core:graphics-mode",
    "Graphics (tiles) mode",
    items,
    "[ choose a tile set, ESC to keep current ]",
  );
  if (idx === null) return;
  const chosen = tiles.modes[idx];
  if (chosen && chosen.grafID !== cur) await tiles.apply(chosen.grafID);
}

export async function runOptionsMenu(
  term: GridSurface & GridPointerInput,
  state: GameState,
  openIgnoreSetup: () => Promise<void>,
  sidebar?: SidebarModeMenu,
  prefs?: PrefsUiCtx,
): Promise<void> {
  // Upstream's option_actions[] in ui-options.c:2036-2058, in ITS order:
  //   a b x w i {   d h m o   s t u   p e c v
  // The rows below are that sequence with the ones a browser cannot offer
  // removed. What is dropped and why (the full display-lever inventory is in
  // docs/INSTALL.md, "Screen and display controls"):
  //   w  Subwindow setup     - the port is ONE surface, not eight terms.
  //   {  Auto-inscription    - the capability is present but reachable only from
  //                            the knowledge browser (`~`), the same screen
  //                            upstream's row opens. Missing shortcut, not
  //                            missing feature.
  // The pref-file rows s / t / u / p / v are present (prefs-ui.ts): they write
  // into and read back out of the virtual ANGBAND_DIR_USER, which is what they
  // do upstream. `s` dumps the subwindow flag set, which for a one-terminal
  // build is its header alone - exactly what option_dump writes when no
  // angband_term[i>0] exists.
  // There is deliberately NO graphics entry - upstream picks graphics in the
  // frontend menu bar, not in do_cmd_options; the web shell mirrors that by
  // placing tile selection in the in-game menu.
  const items: MenuItem[] = [
    { label: "User interface options", tag: "a" },
    { label: "Birth (difficulty) options", tag: "b" },
    { label: "Cheat options", tag: "x" },
    { label: "Item ignoring setup", tag: "i" },
    { label: "Set base delay factor", tag: "d" },
    { label: "Set hitpoint warning", tag: "h" },
    { label: "Set movement delay", tag: "m" },
  ];
  if (sidebar) items.push({ label: "Set sidebar mode", tag: "o" });
  if (prefs) {
    items.push(
      { label: "Save subwindow setup to pref file", tag: "s" },
      { label: "Save autoinscriptions to pref file", tag: "t" },
      { label: "Save char screen options to pref file", tag: "u" },
      { label: "Load a user pref file", tag: "p" },
    );
  }
  items.push(
    { label: "Edit keymaps (advanced)", tag: "e" },
    { label: "Edit colours (advanced)", tag: "c" },
  );
  if (prefs) items.push({ label: "Save visuals (advanced)", tag: "v" });
  // Derive the hint from the live rows so it can never drift out of sync.
  const tagHint = items.map((i) => i.tag).join("/");
  /* Every row below can change an option, including the pref-file loader, so the
   * baseline is taken once around the WHOLE menu rather than per row. */
  const before = optionsFingerprint(state);
  for (;;) {
    const idx = await selectFromMenu(
      term,
      "core:options",
      "Options Menu",
      items,
      `[ ${tagHint} to choose, ESC to return ]`,
      /* option_menu->flags = MN_CASELESS_TAGS (ui-options.c:2074). */
      { caselessTags: true },
    );
    if (idx === null) break;
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
      case "e":
        // do_cmd_keymaps (ui-options.c L743): the keymap query/create/remove
        // editor, for the current keyset (rogue_like_commands, read live).
        await runKeymapEditor(term, state.options?.get("rogue_like_commands") ?? false);
        break;
      case "c":
        // do_cmd_colors (ui-options.c L999): color_events[]' three rows, the
        // third of which is the interactive RGB editor (colors_modify). Without
        // a pref context there is nowhere for the other two to read or write, so
        // the editor opens directly, as it did before those rows existed.
        if (prefs) {
          await runColorsMenu(prefs, "Colors", () =>
            runColorsEditor(term, saveColorPrefs),
          );
        } else {
          await runColorsEditor(term, saveColorPrefs);
        }
        break;
      case "s":
        if (prefs) await dumpWindowSettings(prefs);
        break;
      case "t":
        if (prefs) await dumpAutoinscriptionsRow(prefs);
        break;
      case "u":
        if (prefs) await dumpCharScreenOptions(prefs);
        break;
      case "p":
        if (prefs) await loadUserPrefFileRow(prefs);
        break;
      case "v":
        // do_cmd_visuals (ui-options.c L831): the "Save visuals (advanced)" row.
        if (prefs) await runVisualsMenu(prefs, "Visuals");
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
  notifyOptionsChanged(state, before);
}

/**
 * Tell the mods the player changed their settings (ModHooks.optionsChanged).
 *
 * FIRED FROM INSIDE runOptionsMenu, not from its four callers, and that is the
 * point: a hook wired at each call site is a hook the fifth call site forgets,
 * and the failure is silent - the mod is loaded, the player changes a setting,
 * and nothing happens. One chokepoint is one thing to keep right.
 *
 * ONLY WHEN SOMETHING ACTUALLY MOVED. The hook is named for a change, so firing
 * it when a player opened the menu and pressed ESC would make the name a lie and
 * would wake every listening mod for nothing. Compared by serialising the whole
 * snapshot, so a field added to OptionStateData is covered the day it is added
 * rather than the day somebody remembers to add it to a list here.
 *
 * Exported for the test that asserts the call happens - see options.test.ts.
 */
export function notifyOptionsChanged(state: GameState, before: string): void {
  const hook = state.modHooks?.optionsChanged;
  if (!hook || !state.options) return;
  const after = state.options.snapshot();
  if (JSON.stringify(after) === before) return;
  hook(after);
}

/** The comparison baseline: the whole option snapshot as it was on entry. */
export function optionsFingerprint(state: GameState): string {
  return state.options ? JSON.stringify(state.options.snapshot()) : "";
}
