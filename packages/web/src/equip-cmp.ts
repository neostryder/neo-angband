/**
 * The equipment-comparison screen (ui-equip-cmp.c equip_cmp_display): a
 * resistance/ability/hindrance/modifier grid across worn, carried, floor,
 * home and store wearables, plus the "@" combined player+equipment row.
 *
 * The core (game/equip-cmp.ts) already computes the model - columns, the
 * combined row, and the filtered/sorted item rows, reusing the ui-entry
 * compute/render backend the character screen uses. This owns only the
 * Term drawing and the keyboard loop (its own window keydown, like
 * charsheet.ts), following the faithful key set: j/k or arrows move, n/p
 * (or space/PgUp/PgDn) page, c cycles the source filter, v cycles the
 * attribute view, r reverses, R resets, x/I picks one or two items to
 * compare (their object_info textblocks side by side, via the ported
 * obj/object-info.ts - not re-derived here), ? shows help, ESC exits.
 *
 * q / ! are prompt_for_easy_filter: type a 2-character property code (or a
 * 3-character stat code) to keep only the items that have it, ! for those that
 * do not, return to clear. The matching and the six selector functions live in
 * the core model (matchEquipCmpFilter / equipCmpFilterKeeps).
 *
 * d dumps the rendered table through the port's host-io layer, like the other
 * dumps (append_to_file). This header used to CLAIM that while no 'd' case
 * existed at all - a stand-in sentence rather than a stand-in function, and just
 * as invisible to either census, since a claim in a comment is what a reader
 * checks instead of the code.
 *
 * Simplified vs. upstream (see game/equip-cmp.ts's header for the model-side
 * notes): the intricate per-terminal-width page/view reconfiguration collapses
 * to plain vertical scroll plus a fixed 2/3-view split.
 *
 * Still unported, named rather than faked: the two MOUSE context menus
 * (L551-605, L1004-1042), which need a right-button/left-button distinction the
 * GlyphTerm tap seam does not carry, and the horizontal property-column scroll
 * is the port's own addition standing in for upstream's page reconfiguration.
 */

import {
  COLOUR_WHITE,
  EQUIP_CMP_FILTER_NO_MATCH,
  EQUIP_CMP_FILTER_PROMPT,
  colorToCss,
  equipCmpSummary,
  matchEquipCmpFilter,
  objectInfoTextblock,
} from "@rpgm-tools/neo-angband-core";
import type {
  EquipCmpEasyFilter,
  EquipCmpModel,
  EquipCmpOptions,
  GameState,
  ObjectInfoExtras,
  StoreInclusion,
  Textblock,
  UiEntryPackRecords,
} from "@rpgm-tools/neo-angband-core";
import type { GlyphTerm } from "./term";
import { showTextScreen, menuNav, promptTextInline, getFile } from "./overlay";
import type { ScreenLine } from "./overlay";
import { dumpFileName } from "./charsheet";
import { userTextLinesToFile, exportUserFile } from "./user-io";
import { wrapRuns } from "./screens";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_CURSOR } from "./ui-colors";

const FG = UI_TEXT;
const DIM = UI_DIM;
const TITLE = UI_TEXT;
const HEADER_ROW = 0;
const LABEL_ROW0 = 1;
const LABEL_ROW1 = 2;
const COMBINED_ROW = 3;
const ITEMS_TOP = 4;
const NAME_COL = 4;
const NAME_WIDTH = 20;

/**
 * The two menu_display_state prompts equip_cmp_display draws on the last row
 * (ui-equip-cmp.c:313-324), one per input state.
 */
const PROMPT_GENERAL = "[k/up, j/down, p/PgUp, n/PgDn to move; ? for help; ESC to exit]";
const PROMPT_SELECT = "[k/up, j/down, p/PgUp, n/PgDn to move; return to accept]";

/** Row 0 when the filter left nothing to show (equip_cmp_display L358). */
const EMPTY_FILTER_MSG = "No items; use q, !, c, or R to change filter";

/**
 * The four source-cycle messages (trans_msg_onlystore / _withstore / _carried),
 * set as dlg_trans_msg by ACT_CTX_EQUIPCMP_CYCLE_SOURCES (L694-730). They belong
 * on row 0 for one paint, not pinned to the footer: EQUIPPABLE_NO_STORE has no
 * message at all, which only reads correctly if the others are transient too.
 */
const SOURCE_MSG: Record<StoreInclusion, string> = {
  "no-store": "",
  "only-store": "Only showing goods from stores; press c to change",
  "yes-store": "Showing possessions and goods from stores; press c to change",
  "only-carried": "Only showing carried items; press c to change",
};

/**
 * trans_msg_unknown_key, shared by both input handlers (ui-equip-cmp.c:469 and
 * :983). It is the screen's own discoverability: press anything it does not know
 * and it tells you where the key list is.
 */
const UNKNOWN_KEY = "Unknown key pressed; ? will list available keys";

/** Keys that are a modifier being held, not a keystroke the C would ever see. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"]);

const SRC_CHAR: Record<string, string> = {
  worn: "e",
  pack: "p",
  floor: "f",
  home: "h",
  store: "s",
};

/** Deps the equip-cmp screen needs beyond GameState (registry pack data). */
export interface EquipCmpDeps {
  packs: UiEntryPackRecords;
  /**
   * The timed UiEntryDeps (player_flags_timed / get_timed_element_effect). Build
   * them with core's `liveTimedUiDeps`.
   *
   * REQUIRED, and it used to be optional: `equipCmpDeps()` in main.ts simply did
   * not return it, so both seams took their harness defaults and the character
   * screen's timed-flag column and temporary-resist row read empty in every game
   * (PORT_TODO 3.7, 3.8). An optional property let that omission compile.
   *
   * Being required stops the omission, which was the actual failure. It does NOT
   * stop someone passing `{}` on purpose - measured: that still typechecks and no
   * test catches it. Guarding that would need a nominal type for one field, and
   * the honest note is cheaper than the machinery.
   */
  entryDeps: EquipCmpOptions["entryDeps"];
  inspectExtras: ObjectInfoExtras;
  /**
   * The character's name, for the 'd' dump's suggested filename:
   * player_safe_name(p->full_name) + "_equip.txt" (ui-equip-cmp.c:770-772).
   */
  playerName: string;
}

/**
 * equip_cmp_display: show the comparison grid as a modal, owning the
 * keyboard until ESC. Re-derives the model on every state-changing key
 * (source cycle / reverse / reset) so the grid always reflects live gear.
 */
export function showEquipCmp(term: GlyphTerm, state: GameState, deps: EquipCmpDeps): Promise<void> {
  return new Promise<void>((resolve) => {
    let source: StoreInclusion = "no-store";
    let reverse = false;
    let view = 0; // 0 = all categories, 1 = stat_modifiers only (the 2-view split)
    let cursor = 0;
    let top = 0;
    let colScroll = 0;
    let dlgMsg = "";
    /** The 'q' / '!' quick filter (easy_filt's property selector), or none. */
    let filter: EquipCmpEasyFilter | null = null;
    const summaryOpts = (): EquipCmpOptions => ({
      source,
      reverse,
      filter,
      ...(deps.entryDeps !== undefined ? { entryDeps: deps.entryDeps } : {}),
    });
    let model: EquipCmpModel = equipCmpSummary(state, deps.packs, summaryOpts());

    const rebuild = (): void => {
      model = equipCmpSummary(state, deps.packs, summaryOpts());
      if (cursor >= model.items.length) cursor = Math.max(0, model.items.length - 1);
    };

    /** Column groups for the "v" view cycle - a fixed 2-way split (see the
     * core module's header note on the simplified view/paging model). */
    const viewColumns = (): number[] => {
      const all = model.columns.map((_, i) => i);
      if (view === 0) return all.filter((i) => model.columns[i]?.category !== "stat_modifiers");
      return all.filter((i) => model.columns[i]?.category === "stat_modifiers");
    };

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      /* equip_cmp_display L347-363: row 0 is the transition message, cleared
       * after one paint; with no message it carries the empty-filter warning if
       * nothing passed the filter, and is otherwise blank. The port had put a
       * "Equipment comparison" title here that upstream never draws, which is
       * also why the empty-list case had nothing to say. */
      const row0 = dlgMsg || (model.items.length === 0 ? EMPTY_FILTER_MSG : "");
      if (row0) term.print(0, HEADER_ROW, row0.slice(0, cols - 1), dlgMsg ? UI_GOLD : TITLE);
      dlgMsg = "";

      const colIdx = viewColumns();
      const availCols = Math.max(1, cols - NAME_COL - NAME_WIDTH - 1);
      if (colScroll > Math.max(0, colIdx.length - availCols)) colScroll = Math.max(0, colIdx.length - availCols);
      const visible = colIdx.slice(colScroll, colScroll + availCols);

      // Two rows of 2-char vertical column labels, alternating white/l-white.
      visible.forEach((ci, vi) => {
        const col = model.columns[ci];
        if (!col) return;
        const x = NAME_COL + NAME_WIDTH + vi;
        const shade = vi % 2 === 0 ? FG : DIM;
        term.print(x, LABEL_ROW0, (col.label[0] ?? " "), shade);
        term.print(x, LABEL_ROW1, (col.label[1] ?? " "), shade);
      });

      // The "@" combined row.
      term.print(0, COMBINED_ROW, "@".padEnd(NAME_COL + NAME_WIDTH), UI_GOLD);
      visible.forEach((ci, vi) => {
        const cell = model.combinedCells[ci];
        if (!cell) return;
        term.put(NAME_COL + NAME_WIDTH + vi, COMBINED_ROW, { ch: cell.symbol, fg: colorToCss(cell.color) });
      });

      const bodyRows = Math.max(1, rows - ITEMS_TOP - 1);
      /* In select mode work_sel is what the view follows and what is
       * highlighted; the general cursor is left where it was (the C keeps
       * ifirst/npage and only tracks work_sel while selecting). */
      const focus = selState !== null ? workSel : cursor;
      if (focus < top) top = focus;
      if (focus >= top + bodyRows) top = focus - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const i = top + r;
        const item = model.items[i];
        if (!item) break;
        const y = ITEMS_TOP + r;
        /* display_page L222-224: the name goes L_BLUE for isel0, isel1 OR
         * work_sel - so the item already chosen stays lit while the second is
         * being picked, which is how you can see what you are comparing to. */
        const selected = i === focus || i === isel0;
        term.put(0, y, { ch: item.equippyCh, fg: colorToCss(item.equippyAttr) });
        term.print(2, y, SRC_CHAR[item.src] ?? "?", DIM);
        term.print(NAME_COL, y, item.shortName.padEnd(NAME_WIDTH).slice(0, NAME_WIDTH), selected ? UI_CURSOR : FG);
        visible.forEach((ci, vi) => {
          const cell = item.cells[ci];
          if (!cell) return;
          term.put(NAME_COL + NAME_WIDTH + vi, y, { ch: cell.symbol, fg: colorToCss(cell.color) });
        });
      }

      /* "Use last row for prompt" (L372-374): one of the menu_display_state
       * prompts, chosen by the input state. Both were invented before - a
       * hand-written key list downstairs and the source message pinned there
       * permanently, where upstream shows it once on row 0 and clears it. */
      term.print(0, rows - 1, (selState !== null ? PROMPT_SELECT : PROMPT_GENERAL).slice(0, cols - 1), DIM);
    };

    /**
     * display_equip_cmp_help (ui-equip-cmp.c:377-414), transcribed. It had been
     * PARAPHRASED into this shell's own wording, which is worse than an absence:
     * a paraphrase fills the slot, so no census can see it, and a player reading
     * it cannot tell which keys the screen really has. Every line below is one
     * prt() call in the C, in its order, with its spacing.
     *
     * The only added line is Left/Right, because the port's simplified paging
     * scrolls the property columns where upstream reconfigures pages instead
     * (see this file's header note) - so that key exists here and nowhere in the
     * C, and the help has to say so rather than leave it undiscoverable.
     */
    const showHelp = async (): Promise<void> => {
      await showTextScreen(term, "Equipment comparison - help", [
        "Movement/scrolling ---------------------------------",
        "j, down  one line down    k, up    one line up",
        "n, PgDn  one page down    p, PgUp  one page up",
        "space    one page down",
        "left, right  scroll the property columns",
        "Filtering/searching/sorting ------------------------",
        "q        quick filter     !        use opposite quick",
        "c        cycle through sources of items",
        "r        reverse",
        "Information ----------------------------------------",
        "v        cycle through attribute views",
        "I, x     select one or two items for details",
        "Other ----------------------------------------------",
        "d        dump to file     R        reset display",
        "ESC      exit",
      ].map((text) => ({ text, color: FG }) as ScreenLine));
    };

    /**
     * display_equip_cmp_sel_help (ui-equip-cmp.c:894-918), transcribed. This
     * screen was entirely absent: select mode had no '?' at all, so the one place
     * a player is most likely to press it was the one place it did nothing.
     */
    const showSelHelp = async (): Promise<void> => {
      await showTextScreen(term, "Equipment comparison - help", [
        "j, down   move selection one line down",
        "k, up     move selection one line up",
        "n, PgDn   move selection one page up",
        "p, PgUp   move selection one page up",
        "x         stop selection; if first item, escapes",
        "return    select current item",
        "ESC       leave selection process",
      ].map((text) => ({ text, color: FG }) as ScreenLine));
    };

    /**
     * append_to_file (ui-equip-cmp.c:1481-1545): the rendered table, dumped as
     * text - the property label rows, the combined "@" row, then every item row,
     * each with its trailing spaces backed off. Upstream walks page by page
     * because its display is paged; the port's simplified model shows one
     * continuous list, so "every page" is "every row" here, and the current view
     * and filter select the columns and rows exactly as they do on screen.
     *
     * Built as one string and written once rather than appended row by row
     * through an open handle - the same shape dumpCharacterFile uses, and the
     * same bytes. The user directory it lands in is the installed host's, so this
     * is a real file on the desktop shell.
     */
    const dumpText = (): string => {
      const colIdx = viewColumns();
      const pad = NAME_COL + NAME_WIDTH;
      const rows: string[] = [];
      for (const which of [0, 1]) {
        rows.push(
          " ".repeat(pad) + colIdx.map((ci) => model.columns[ci]?.label[which] ?? " ").join(""),
        );
      }
      rows.push(
        "@".padEnd(pad) + colIdx.map((ci) => model.combinedCells[ci]?.symbol ?? " ").join(""),
      );
      for (const item of model.items) {
        const name = `${item.equippyCh} ${SRC_CHAR[item.src] ?? "?"} ${item.shortName}`;
        rows.push(
          name.padEnd(pad).slice(0, pad) +
            colIdx.map((ci) => item.cells[ci]?.symbol ?? " ").join(""),
        );
      }
      /* "Back up over spaces" (L1528-1530), per row. */
      return `${rows.map((r) => r.replace(/ +$/, "")).join("\n")}\n`;
    };

    /**
     * ACT_CTX_EQUIPCMP_DUMP_FILE (ui-equip-cmp.c:765-783). The suffix is
     * "_equip.txt" over player_safe_name, which charsheet.ts's dumpFileName
     * already cited and offered - the key that reaches it was simply never
     * wired, so this screen's own header claimed a dump that did not exist.
     */
    const dumpToFile = async (): Promise<void> => {
      const file = await nested(() => getFile(term, dumpFileName(deps.playerName, "_equip.txt")));
      if (file === null) return;
      /* One render, not three: dumpText() walks the whole model, and calling it
       * again for the export could hand out bytes that differ from the file. */
      const text = dumpText();
      dlgMsg = userTextLinesToFile(file, text)
        ? "Failed to save to file!"
        : "Successfully saved to file";
      if (!dlgMsg.startsWith("Failed")) exportUserFile(file, text);
    };

    const compare = async (i0: number, i1: number | null): Promise<void> => {
      const a = model.items[i0];
      if (!a) return;
      const tb0 = objectInfoTextblock(state, a.obj, deps.inspectExtras);
      if (i1 !== null && i1 !== i0 && model.items[i1]) {
        const b = model.items[i1]!;
        const tb1 = objectInfoTextblock(state, b.obj, deps.inspectExtras);
        // display_object_comparison (ui-equip-cmp.c L1440): the two items'
        // headers and object_info textblocks, back to back.
        const combined: Textblock = {
          runs: [
            { text: `${a.shortName}\n`, attr: COLOUR_WHITE },
            ...tb0.runs,
            { text: `\n${b.shortName}\n`, attr: COLOUR_WHITE },
            ...tb1.runs,
          ],
        };
        await showTextScreen(term, "Object comparison", wrapRuns(combined, term.size().cols));
      } else {
        await showTextScreen(term, a.shortName, wrapRuns(tb0, term.size().cols));
      }
    };

    /**
     * Run a nested overlay (the compare picker, the help screen, the filter
     * prompt) with OUR listener detached, the way charsheet.ts does it for the
     * rename prompt.
     *
     * Every overlay in this shell listens on window in the capture phase, and
     * this screen's handler - registered first - opens with
     * stopImmediatePropagation(). So while it was attached, no nested overlay
     * ever saw a key: 'x' opened the item picker and then swallowed every letter
     * the player typed into it, and ESC closed the WHOLE screen from underneath
     * it. Verified live before the fix.
     */
    const nested = async <T>(run: () => Promise<T>): Promise<T> => {
      window.removeEventListener("keydown", onKey, true);
      try {
        return await run();
      } finally {
        window.addEventListener("keydown", onKey, true);
      }
    };

    /**
     * prompt_for_easy_filter (ui-equip-cmp.c:1229): get_string for a 2- or
     * 3-character property code, then either clear the filter (empty answer),
     * install it, or report that nothing matched. ESC leaves it untouched.
     */
    const runFilterPrompt = async (not: boolean): Promise<void> => {
      const code = await nested(() =>
        promptTextInline(term, EQUIP_CMP_FILTER_PROMPT, "", 3),
      );
      if (code === null) return; // ESC: EQUIP_CMP_MENU_NEW_PAGE, no change
      if (code === "") {
        filter = null; // "return to clear"
        rebuild();
        return;
      }
      const match = matchEquipCmpFilter(model.columns, code, not);
      if (!match) {
        dlgMsg = EQUIP_CMP_FILTER_NO_MATCH;
        return;
      }
      filter = match;
      cursor = 0;
      top = 0;
      rebuild();
    };

    /**
     * handle_input_equip_cmp_select (ui-equip-cmp.c:920-1225). Select mode is not
     * a separate picker: it is a second INPUT STATE over the same table, with its
     * own key set and its own highlighted row (work_sel), and the two items are
     * chosen one after the other in place.
     *
     * The port had invented a pair of selectFromMenu overlays instead - a list of
     * bare item names, twice, with the port's own prompt wording. That lost the
     * grid the screen exists to show (you picked blind, from a list stripped of
     * every property column), lost 'x' as "skip the second and just show the
     * first", and lost '?'. Reading upstream's istate machine is what turned it
     * up: the C returns EQUIP_CMP_MENU_SEL0/SEL1 from the general handler and
     * keeps drawing the same page.
     */
    /** Upstream's istate while selecting: 0 = SEL0, 1 = SEL1, null = general. */
    let selState: 0 | 1 | null = null;
    /** s->work_sel, the row the selection cursor is on. */
    let workSel = -1;
    /** s->isel0, the first chosen row, once accepted. */
    let isel0 = -1;

    /** ESC / a finished comparison: isel0 = isel1 = work_sel = -1 (L1188-1191). */
    const leaveSelect = (): void => {
      selState = null;
      workSel = -1;
      isel0 = -1;
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      /* A held modifier is not a keystroke: without this it would report
       * "Unknown key pressed" for pressing Shift on the way to '!'. */
      if (MODIFIER_KEYS.has(ev.key)) return;
      const { rows } = term.size();
      const page = Math.max(1, rows - ITEMS_TOP - 2);
      const last = Math.max(0, model.items.length - 1);
      // Arrows AND numpad digits move the cursor (menuNav), so the numpad is
      // not dead here when NumLock is on; horizontal arrows still column-scroll.
      const nav = menuNav(ev);

      /* Select mode owns every key while it is active (the C dispatches to
       * handle_input_equip_cmp_select instead of ..._general for SEL0/SEL1). */
      if (selState !== null) {
        const move = (d: number): void => { workSel = Math.min(last, Math.max(0, workSel + d)); };
        switch (nav !== null ? `nav:${nav}` : ev.key) {
          case "nav:down": case "j": case "ArrowDown": move(1); break;
          case "nav:up": case "k": case "ArrowUp": move(-1); break;
          case "nav:pagedown": case "n": case "PageDown": move(page); break;
          case "nav:pageup": case "p": case "PageUp": move(-page); break;
          case "x":
            /* SELECT_SKIP (L1182-1191): from SEL1 show just the first item;
             * from SEL0 it "acts like ESC". */
            if (selState === 1) {
              const first = isel0;
              leaveSelect();
              void (async () => { await nested(() => compare(first, null)); paint(); })();
              return;
            }
            leaveSelect();
            break;
          case "Enter":
            /* SELECT_ACCEPT (L1193-1207). */
            if (workSel < 0 || workSel > last) break;
            if (selState === 0) {
              isel0 = workSel;
              selState = 1;
              dlgMsg = "Select second item; x to skip";
              break;
            } else {
              const a = isel0;
              const b = workSel;
              leaveSelect();
              void (async () => { await nested(() => compare(a, b)); paint(); })();
              return;
            }
          case "?":
            void (async () => { await nested(showSelHelp); paint(); })();
            return;
          case "Escape":
            leaveSelect();
            break;
          default:
            dlgMsg = UNKNOWN_KEY;
            break;
        }
        paint();
        return;
      }

      if (nav === "up") { cursor = Math.max(0, cursor - 1); paint(); return; }
      if (nav === "down") { cursor = Math.min(last, cursor + 1); paint(); return; }
      if (nav === "pageup") { cursor = Math.max(0, cursor - page); paint(); return; }
      if (nav === "pagedown") { cursor = Math.min(last, cursor + page); paint(); return; }
      if (nav === "home") { cursor = 0; paint(); return; }
      if (nav === "end") { cursor = last; paint(); return; }
      switch (ev.key) {
        case "Escape":
          window.removeEventListener("keydown", onKey, true);
          resolve();
          return;
        case "j":
        case "ArrowDown":
          cursor = Math.min(Math.max(0, model.items.length - 1), cursor + 1);
          break;
        case "k":
        case "ArrowUp":
          cursor = Math.max(0, cursor - 1);
          break;
        case "n":
        case " ":
        case "PageDown":
          cursor = Math.min(Math.max(0, model.items.length - 1), cursor + page);
          break;
        case "p":
        case "PageUp":
          cursor = Math.max(0, cursor - page);
          break;
        case "ArrowLeft":
          colScroll = Math.max(0, colScroll - 1);
          break;
        case "ArrowRight":
          colScroll += 1;
          break;
        case "c":
          source =
            source === "no-store"
              ? "only-store"
              : source === "only-store"
                ? "yes-store"
                : source === "yes-store"
                  ? "only-carried"
                  : "no-store";
          dlgMsg = SOURCE_MSG[source];
          rebuild();
          break;
        case "v":
          view = view === 0 ? 1 : 0;
          dlgMsg = "Showing alternate attributes; press v to cycle";
          break;
        case "r":
          reverse = !reverse;
          rebuild();
          break;
        case "R":
          source = "no-store";
          reverse = false;
          view = 0;
          colScroll = 0;
          filter = null;
          rebuild();
          break;
        case "q":
          void (async () => {
            await runFilterPrompt(false);
            paint();
          })();
          return;
        case "!":
          void (async () => {
            await runFilterPrompt(true);
            paint();
          })();
          return;
        case "x":
        case "I":
          /* START_SELECT (L810-815): work_sel = ifirst - the top of the page in
           * view, not the general cursor - then straight into SEL0. */
          if (model.items.length === 0) break;
          workSel = top;
          isel0 = -1;
          selState = 0;
          dlgMsg = "Select first item to examine";
          break;
        case "d":
          void (async () => {
            await dumpToFile();
            paint();
          })();
          return;
        case "?":
          void (async () => {
            await nested(showHelp);
            paint();
          })();
          return;
        default:
          /* ACT_CTX_EQUIPCMP_UNKNOWN (L885-887). Saying nothing was its own bug:
           * this message is the only thing that tells a player '?' exists. */
          dlgMsg = UNKNOWN_KEY;
          break;
      }
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}
