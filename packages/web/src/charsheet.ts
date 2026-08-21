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
 * ability / hindrance / modifier + sustain grid) is built from the core
 * characterGrid (ui-entry.c) data: wide mode tiles the four flag regions and
 * the sustains block side by side to fill the screen (display_player_flag_info,
 * ui-player.c:222-232 / 379-443); narrow mode stacks them into a scroll list.
 * Only when no ui_entry packs are supplied does it fall back to a notice.
 *
 * A MOD MAY TAKE THE WHOLE THING. Both pages have models - `characterScreen`
 * and `characterFlagsScreen` - and `showCharacterSheet` offers the current one
 * to the installed screen presenter before the terminal draws anything, falling
 * back to the layouts above on a decline or a fault. The three commands the
 * footer names travel with the view as `actions`, and `ScreenHost.invoke` runs
 * them here, so a presenter's rename still opens the game's prompt and its dump
 * still writes the game's file.
 *
 * AND TWO OF THOSE COMMANDS PROMPT, which is the defect #258 names: `rename`
 * and `file` put a question on the faithful terminal and wait for an answer,
 * UNDERNEATH the presenter's overlay, while the input door goes on feeding them
 * keystrokes. `askforAuxKeypress` clears the prefilled default on the first
 * printable key, so 'c' then three letters then Enter renames the character and
 * writes the save with nothing visible on the screen at all.
 *
 * The fix is NOT to forbid a prompt inside `invoke` - that would make a mod's
 * actions a strict subset of the game's, which is the seam being given up
 * (owner ruling). It is `withTerminal`: the game ANNOUNCES the prompt from the
 * `SCREEN_PROMPTS` census, whoever is holding the screen stands aside for it,
 * and one that cannot stand aside is reported once by name and has the prompt
 * drawn over it - ugly, and enormously better than an invisible question.
 *
 * Pure display: no game mutation, no RNG. Renaming flows OUT through
 * opts.onRename (the shell persists it); nothing here touches state.
 */

import { inputEvents } from "./input-door";
import {
  characterPanels,
  statTable,
  colorToCss,
  buildUiEntryConfig,
  characterGrid,
  liveUiEntryDeps,
  gearGet,
  objectAttrChar,
  describeObject,
  makeObjectInfoDeps,
  objectInfo,
  textblockToString,
  ODESC,
  OINFO,
  OPTION_ENTRIES,
  PARITY_BASELINE,
  playerSafeName,
} from "@rpgm-tools/neo-angband-core";
import type {
  GameState,
  GameObject,
  ObjectInfoExtras,
  UiEntryConfig,
  UiEntryPackRecords,
  UiGridPanel,
} from "@rpgm-tools/neo-angband-core";
import {
  setActiveCellTap,
  type GridPointerInput,
  type GridSurface,
  type SurfaceSizeEvents,
} from "./term";
import {
  characterScreen,
  characterSheetLines,
  characterTitle,
  charSheetDeps,
  historyBlockLines,
  historyLines,
  screenPromptFor,
  statHeaderLine,
  statRowLine,
  CHARACTER_ACTIONS,
  CHARACTER_FOOTER,
} from "./screens";
import {
  freezeView,
  screenBlockLines,
  screenBodyLines,
  type ScreenCell,
  type ScreenColumn,
  type ScreenHost,
  type ScreenRow,
  type ScreenTableBlock,
  type ScreenView,
} from "./screen-view";
import { ScreenAbandoned, showThroughPresenter, withTerminal } from "./screen-runtime";
import { promptRequest } from "./prompt-view";
import { promptText, menuNav, getFile, screenFault, screenRegionSpec } from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import { argForceName } from "./launch";
import { userTextLinesToFile, exportUserFile, userPath } from "./user-io";
import type { ScreenLine } from "./overlay";
import { UI_TEXT, UI_DIM } from "./ui-colors";

const LABEL = UI_TEXT;
const FG = UI_TEXT;
const DIM = UI_DIM;
const TITLE = UI_TEXT;

/** Combat deps the shell can supply (shots / launcher) so the panel is exact,
 * plus the change-name hook ('c', do_cmd_change_name). */
export interface CharSheetOpts {
  numShots?: number;
  launcher?: GameObject | null;
  /** Called with the new name after a successful 'c' rename; the shell
   * persists it (roster metadata) - the sheet itself mutates nothing. */
  onRename?: (name: string) => void;
  /**
   * The ui_entry pack records (loadUiEntryPacks). When supplied, mode 1 renders
   * the real resist / ability / hindrance / modifier / sustain grid
   * (core characterGrid); without them it falls back to a labelled placeholder.
   * Also feeds the flag-grid section of the character dump ('f').
   */
  uiEntryPacks?: UiEntryPackRecords;
  /**
   * The object-info extras (projections / constants / race origins). When
   * supplied, the dump's equipment / inventory / quiver / home listings carry
   * the object_info_chardump block for each item; without them, only the item
   * name is written.
   */
  inspectExtras?: ObjectInfoExtras;
  /** seed_randart (write_character_dump L1185), for the [Randart seed] line. */
  seedRandart?: number;
  /**
   * The enabled mods, for the dump's [Mods enabled] block. Supplied by the
   * shell, which is the only thing that knows what is loaded; absent or empty
   * writes no block.
   */
  mods?: readonly { readonly id: string; readonly version: string }[];
  /**
   * msg(). 'f' reports its outcome on the message line ("Character dump
   * successful." / "Character dump failed!", ui-player.c:1273-1275) and
   * dump_save reports the staged file it could not create, so the sheet needs
   * the shell's message sink. Without it the dump is silent.
   */
  msg?: (text: string) => void;
}

/**
 * Width at or above which the upstream grid is used; below it, the list.
 *
 * This is 80 because 80 is the width upstream lays every screen out for, and
 * the terminal is a fixed 80x24 (term.ts) - the grid's rightmost content is the
 * stat table's Best column ending at col 72 and, on the birth screen, the cost
 * column at cols 74-77, so 80 is exactly enough. It was 90 for a while, which
 * made the whole faithful layout DEAD CODE: at 80 columns `cols < WIDE_COLS`
 * was always true, so every character screen fell back to the phone list and no
 * panel ever landed on its upstream anchor. The narrow path is now reachable
 * only when a mobile reflow mod shrinks the grid below 80.
 */
const WIDE_COLS = 80;

/** INFO_SCREENS (ui-player.c L1213): mode 0 = skills/history, 1 = flag grid. */
const INFO_SCREENS = 2;

/**
 * The upstream panels[] anchors (ui-player.c L849-855). `width` is the region
 * width and `alignRight` mirrors the table's `!align_left`: only `topleft` is
 * left-adjusted, so its values sit just after the label; the other four have
 * their values right-justified to the region's right edge (display_panel
 * L619-622: `Term_putstr(col+w-len, ...)` when not left-adjusted).
 */
const ANCHOR = {
  topleft: { x: 1, y: 1, labelWidth: 6, width: 40, alignRight: false },
  misc: { x: 21, y: 1, labelWidth: 8, width: 18, alignRight: true },
  midleft: { x: 1, y: 9, labelWidth: 10, width: 24, alignRight: true },
  combat: { x: 29, y: 9, labelWidth: 13, width: 19, alignRight: true },
  skills: { x: 52, y: 9, labelWidth: 15, width: 20, alignRight: true },
} as const;

/** The stat table column (display_player_stat_info L460) and header row. */
const STAT_COL = 42;
const STAT_HEADER_ROW = 1;

/** Sustains block column (display_player_sust_info L541: col = 26); its header
 * sits on STAT_HEADER_ROW and its five stat rows below, left of the stat table. */
const SUST_COL = 26;

/** display_player mode-1 flag-region anchors (configure_char_sheet L229-231 /
 * display_resistance_panel L399-401): region i starts at col i*(res_cols+1) =
 * i*20 for the default 12-slot body; within it the equippy row is first, the
 * slot-letter header next, data rows below. The regions begin at row 2+STAT_MAX. */
const RES_REGION_STRIDE = 20;
const RES_REGION_ROW = 2 + 5; // 2 + STAT_MAX

/** all_letters_nohjkl (ui-menu.c:41): the equipment slot-letter set, skipping
 * h/j/k/l, used for the flag-grid and sustains column headers. */
const ALL_LETTERS_NOHJKL =
  "abcdefgimnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** History block row (display_player_xtra_info L872: Term_gotoxy(1, 19)). */
const HISTORY_ROW = 19;

/**
 * The view id of each page, in `mode` order - the key the `SCREEN_PROMPTS`
 * census is indexed by.
 *
 * A SECOND SPELLING of what `characterScreen` / `characterFlagsScreen` already
 * publish, and it exists because the census has to be consulted on a keypress
 * without building a whole view first (and because `viewFor()` answers `null`
 * for the mode-1 page of a character with no ui_entry packs, which would leave
 * the rename with nothing to announce from - the exact silence #258 is about).
 * Exported and PINNED to the builders' own ids by `charsheet.test.ts`, because
 * two spellings of the same fact with nothing tying them together is how a
 * prompt goes back to being un-announced without anybody noticing.
 */
export const MODE_VIEW_IDS = ["core:character", "core:character-flags"] as const;

/**
 * do_cmd_change_name's own prompt (ui-player.c:1229 -> get_string). Spelled ONCE
 * and used twice: `promptText` draws it, and `withTerminal` announces it as the
 * request's `label`, so a presenter captioning its own standing-aside says what
 * the player would have read.
 */
const RENAME_PROMPT = "Enter your character's name";

/**
 * `get_file`'s own prompt (get_file_text, ui-input.c:1359 -> get_string(
 * "File name: ")), without its separator. ui-player.c:1269 is the call site
 * this screen's `f` row ports; the prompt itself lives behind get_file_hook.
 *
 * THIS ONE IS A SECOND SPELLING and cannot be anything else: the string lives
 * inside `getFile` (overlay.ts) and is not exported. `charsheet.test.ts` reads
 * it back off the terminal the prompt actually drew on, so the two are tied
 * together by a measurement rather than by this comment.
 */
const FILE_PROMPT = "File name";

/**
 * The game's own wording for each prompt this screen opens, by the census's
 * `promptId`.
 *
 * BESIDE THE CODE THAT OPENS THEM rather than in the census, because the census
 * is the answer to "does this action take the terminal" and the wording is the
 * answer to "what does the player see" - the second is this file's to know.
 * Exported so `charsheet.test.ts` can check it is TOTAL over the census's rows
 * for both pages: a third prompt added here with no label would otherwise
 * announce itself by its id, which is a mod-facing string nobody wrote.
 */
export const CHARSHEET_PROMPT_LABELS: Readonly<Record<string, string>> = {
  "charsheet:rename": RENAME_PROMPT,
  "charsheet:file": FILE_PROMPT,
};

/** Mode-1 placeholder, only used when no ui_entry packs were supplied. */
function modeOnePlaceholder(): ScreenLine[] {
  return [
    { text: "Resistances & Abilities - unavailable (no ui_entry packs)", color: TITLE },
    { text: "", color: FG },
    { text: "Press 'h' to return to the main page.", color: DIM },
  ];
}

/** Human titles for the four resist regions (configure_char_sheet L187). */
const PANEL_TITLES: Record<string, string> = {
  resistances: "Resistances",
  abilities: "Abilities",
  hindrances: "Hindrances",
  modifiers: "Modifiers",
};

/** res_nlabel: the 6-char label column of a flag region (configure_char_sheet
 * L223, res_nlabel = 6). A region is label(6) + one cell per body slot + the
 * '@' player column, so its width is res_nlabel + body.count + 1. */
const RES_LABEL_WIDTH = 6;

/**
 * buildGridBlock: render ONE characterGrid panel (a resist / ability /
 * hindrance / modifier region, or the sustains block) as a self-contained
 * ScreenLine block - a title, the slot-letter header, the equippy glyph row,
 * then one row per entry (a 6-char label in its own colour + one cell per
 * equipment slot + the '@' player column), matching display_resistance_panel /
 * display_player_sust_info (ui-player.c:379-421). The caller blits the block at
 * whatever (x, y) the layout wants - wide mode tiles four of these across the
 * screen, narrow mode stacks them.
 */
function gridPanelBlock(
  state: GameState,
  panel: UiGridPanel,
  opts: { labels: boolean; caption?: string; gapAfter?: number },
): ScreenTableBlock {
  const p = state.actor.player;
  const columns: ScreenColumn[] = [];
  /* The 6-char label column, absent on the sustains block: upstream calls
   * ui_entry_renderer_apply there with label = NULL (L541-563). */
  if (opts.labels) columns.push({ key: "label", label: "", width: RES_LABEL_WIDTH });
  for (let i = 0; i < p.body.count; i++) {
    const obj = gearGet(state.gear, p.equipment[i] ?? 0);
    /* object_attr / object_char, not the kind record and not a fixed colour
     * (ui-player.c:365-367). This row used to paint every slot FG, so a Long
     * Sword and a Ring of Speed were the same white; and it read kind.dChar
     * directly, so a flavoured item ignored its flavour. An EMPTY slot still
     * carries a glyph - upstream's L' ' - so the equippy row is drawn even for a
     * character wearing nothing, rather than the panel sliding up a line. */
    const g = obj ? objectAttrChar(state, obj) : null;
    columns.push({
      key: `s${i}`,
      label: ALL_LETTERS_NOHJKL[i] ?? "",
      width: 1,
      gap: 0,
      ...(opts.labels
        ? { glyph: g ? { text: g.char, color: colorToCss(g.attr) } : { text: " ", color: FG } }
        : {}),
    });
  }
  columns.push({ key: "player", label: "@", width: 1, gap: 0 });

  const rows: ScreenRow[] = panel.rows.map((row) => {
    const cells: Record<string, ScreenCell> = {};
    if (opts.labels) cells["label"] = { text: row.label, color: colorToCss(row.labelColor) };
    row.cells.forEach((cell, ci) => {
      /* Player column (last cell) carries only the sustain state; L563 forces
       * its stat-modifier value to 0, so it renders as the empty symbol. */
      const isPlayer = ci === p.body.count;
      const symbol =
        !opts.labels && isPlayer && /[0-9+-]/u.test(cell.symbol) ? "." : cell.symbol;
      cells[isPlayer ? "player" : `s${ci}`] = { text: symbol, color: colorToCss(cell.color) };
    });
    /* The ui_entry name ("resist_ui_compact_0<ACID>") is the row's identity, and
     * the only handle a presenter has on WHICH resistance a row is. */
    return { id: row.name, color: FG, cells };
  });

  return {
    kind: "table",
    key: panel.key,
    tagged: false,
    columns,
    headerColor: LABEL,
    rows,
    ...(opts.caption === undefined ? {} : { caption: { text: opts.caption, color: TITLE } }),
    ...(opts.gapAfter === undefined ? {} : { gapAfter: opts.gapAfter }),
  };
}

/** One flag region's rows, for the wide layout that blits it at its own anchor. */
function buildGridBlock(state: GameState, panel: UiGridPanel): ScreenLine[] {
  return screenBlockLines(gridPanelBlock(state, panel, { labels: true }));
}

/**
 * buildSustainBlock: the stat-modifier / sustain block (display_player_sust_info,
 * ui-player.c:521-568). Unlike a resist region it has NO equippy row and NO
 * row labels: just the "abcdefgimnop@" header (no 6-char pad) and one cell-only
 * row per stat, the player '@' column blanked (L563: vals[body.count] = 0).
 */
function buildSustainBlock(state: GameState, panel: UiGridPanel): ScreenLine[] {
  return screenBlockLines(gridPanelBlock(state, panel, { labels: false }));
}

/**
 * The character sheet's SECOND page (display_player mode 1): the four
 * resist / ability / hindrance / modifier regions and the sustains block.
 *
 * Every region is a table whose columns ARE the equipment slots - each headed by
 * its `all_letters_nohjkl` letter and carrying the worn item's glyph - and whose
 * rows are the ui_entries, addressed by the entry name. So "does this character
 * resist acid, and which item gives it" is a lookup rather than a search through
 * a wall of one-character cells.
 */
export function characterFlagsScreen(
  state: GameState,
  name: string,
  config: UiEntryConfig,
): ScreenView {
  /* liveUiEntryDeps (PORT_TODO 3.6/3.7/3.8): this call passed NO deps - so the
   * timed-flag column, the temporary-resist row and every PF_* intrinsic read as
   * absent on the character sheet in every game. */
  const { resistPanels, statModPanel } = characterGrid(state, config, liveUiEntryDeps(state));
  return freezeView({
    id: "core:character-flags",
    title: characterTitle(state, name),
    footer: CHARACTER_FOOTER,
    actions: CHARACTER_ACTIONS,
    /* A section title precedes each block so the STACKED list stays legible. The
     * wide layout tiles the same blocks side by side and draws no titles, which
     * is upstream's screen - it shows them only in the character dump. */
    blocks: [
      ...resistPanels.map((panel) =>
        gridPanelBlock(state, panel, {
          labels: true,
          caption: PANEL_TITLES[panel.key] ?? panel.key,
          gapAfter: 1,
        }),
      ),
      gridPanelBlock(state, statModPanel, { labels: false, caption: "Sustains" }),
    ],
  });
}

/**
 * characterGridLines: the NARROW (phone) mode-1 layout - the faithful terminal's
 * rows for `characterFlagsScreen`. Wide mode does not use this; it tiles the same
 * blocks side by side.
 */
function characterGridLines(state: GameState, name: string, config: UiEntryConfig): ScreenLine[] {
  return screenBodyLines(characterFlagsScreen(state, name, config));
}

/**
 * The suggested dump name: player_safe_name(fname, 80, false) + ".txt", the
 * default get_file offers at all three dump call sites (ui-player.c:1268,
 * ui-death.c:168, ui-equip-cmp.c:771 - the last with "_equip.txt").
 */
export function dumpFileName(name: string, suffix = ".txt"): string {
  return `${playerSafeName(name, 80, false)}${suffix}`;
}

/** The optional data the full dump needs beyond the GameState. */
export interface CharDumpExtras {
  /** ui_entry packs, for the resist/ability/hindrance/modifier flag grids. */
  uiEntryPacks?: UiEntryPackRecords;
  /** object-info extras, for the per-item object_info_chardump blocks. */
  inspectExtras?: ObjectInfoExtras;
  /**
   * The last messages, oldest-first (write_character_dump L1063-1078). Present
   * only for the death dump; when supplied the [Last Messages] block is written
   * (the newest 15) followed by the "Killed by" / "Retired" line.
   */
  messages?: readonly string[];
  /** player->died_from (L1075); "Retiring" prints "Retired.". */
  diedFrom?: string;
  /** seed_randart (L1187), for the [Randart seed] block under birth_randarts. */
  seedRandart?: number;
  /**
   * The mods enabled in this game, id and version, for the [Mods enabled] block.
   *
   * Omitted or empty writes NO block at all - see buildCharacterDump's tail for
   * why that is the design and not an oversight.
   */
  mods?: readonly { readonly id: string; readonly version: string }[];
}

/** I2A / 'a'-'z' running label for a dump listing. */
function dumpLabel(i: number): string {
  return String.fromCharCode(97 + i);
}

/**
 * textblock_to_file(tb, f, indent, wrap) (z-textblock.c): word-wrap `text` to
 * the wrap column, each line prefixed by `indent` spaces. Used for
 * object_info_chardump (indent 5, wrap 72).
 */
function wrapChardump(text: string, indent = 5, wrap = 72): string[] {
  const pad = " ".repeat(indent);
  const width = Math.max(1, wrap - indent);
  const out: string[] = [];
  for (const src of text.split("\n")) {
    const line = src.replace(/\s+$/u, "");
    if (line === "") {
      out.push("");
      continue;
    }
    let cur = "";
    for (const word of line.split(/\s+/u)) {
      if (cur === "") {
        cur = word;
      } else if (cur.length + 1 + word.length <= width) {
        cur += ` ${word}`;
      } else {
        out.push(pad + cur);
        cur = word;
      }
    }
    if (cur !== "") out.push(pad + cur);
  }
  return out;
}

/**
 * One dump item line: "<label>) <name>" plus the object_info_chardump block
 * (object_info_out with OINFO_TERSE | OINFO_SUBJ, wrapped at indent 5 / col 72).
 * Without inspectExtras the info block is omitted (name only).
 */
function dumpItemLines(
  state: GameState,
  obj: GameObject,
  label: string,
  extras: CharDumpExtras,
): string[] {
  const name = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
  const lines = [`${label}) ${name}`];
  if (extras.inspectExtras) {
    const tb = objectInfo(
      obj,
      OINFO.TERSE | OINFO.SUBJ,
      makeObjectInfoDeps(state, obj, extras.inspectExtras),
    );
    for (const l of wrapChardump(textblockToString(tb))) lines.push(l);
  }
  return lines;
}

/**
 * The flag-grid section (write_character_dump L983-1057): the Resistances /
 * Abilities grid then the Hindrances / Modifiers grid, each a side-by-side pair
 * of characterGrid panels. Returns [] when no ui_entry packs are available.
 */
function flagGridSection(state: GameState, packs?: UiEntryPackRecords): string[] {
  if (!packs) return [];
  const { resistPanels } = characterGrid(
    state,
    buildUiEntryConfig(packs, state.uiEntry),
    liveUiEntryDeps(state),
  );
  const byKey = (k: string): UiGridPanel | undefined =>
    resistPanels.find((p) => p.key === k);
  const resistances = byKey("resistances");
  const abilities = byKey("abilities");
  const hindrances = byKey("hindrances");
  const modifiers = byKey("modifiers");
  if (!resistances || !abilities || !hindrances || !modifiers) return [];

  const bodyCount = state.actor.player.body.count;
  /* Region width = 6-char label + ':' + one cell per body slot + the player
   * column; the upstream "%-20s" header assumes the default body (12 -> 20). */
  const col = Math.max(20, bodyCount + 8);
  const rowText = (panel: UiGridPanel, i: number): string => {
    const row = panel.rows[i];
    if (!row) return "";
    return row.label + row.cells.map((c) => c.symbol).join("");
  };
  const pair = (
    left: UiGridPanel,
    right: UiGridPanel,
    leftHdr: string,
    rightHdr: string,
  ): string[] => {
    const out = [leftHdr.padEnd(col) + rightHdr];
    const n = Math.max(left.rows.length, right.rows.length);
    for (let i = 0; i < n; i++) {
      const line = (rowText(left, i).padEnd(col) + rowText(right, i)).replace(
        /\s+$/u,
        "",
      );
      out.push(line);
    }
    return out;
  };

  const out: string[] = [];
  out.push(...pair(resistances, abilities, "Resistances", "Abilities"));
  out.push(""); // L1022 blank between the two grids
  out.push(...pair(hindrances, modifiers, "Hindrances", "Modifiers"));
  return out;
}

/**
 * write_character_dump (ui-player.c L925-1189): the full character dump, in the
 * exact upstream section order - the character sheet, the resist/ability flag
 * grids, (last messages when dead), equipment, inventory, quiver, home (when
 * anything is there), the history ledger, the options, and the randart seed.
 *
 * Home persistence is a known gap (12.1); when no live home store is available
 * the [Home Inventory] block is skipped, matching upstream's `if
 * (home->stock_num)` guard on an empty home.
 */
export function buildCharacterDump(
  state: GameState,
  name: string,
  extras: CharDumpExtras = {},
): string {
  const p = state.actor.player;
  const out: string[] = [];

  /* Header (L951). */
  out.push(`  [Angband ${PARITY_BASELINE} Character Dump]`, "");

  /* The character sheet - display_player(0) (L954-980). */
  for (const l of characterSheetLines(state, name, 80)) out.push(l.text);

  /* The resist / ability / hindrance / modifier flag grids (L983-1057). */
  const grids = flagGridSection(state, extras.uiEntryPacks);
  if (grids.length > 0) {
    out.push("");
    out.push(...grids);
  }
  out.push("", ""); // L1060

  /* Last messages, only when dead (L1063-1078). */
  if (extras.messages && extras.messages.length > 0) {
    out.push("  [Last Messages]", "");
    for (const m of extras.messages.slice(-15)) out.push(`> ${m}`);
    out.push("");
    if (extras.diedFrom === "Retiring") out.push("Retired.", "");
    else out.push(`Killed by ${extras.diedFrom ?? "the dungeon"}.`, "");
  }

  /* Equipment (L1081-1092). */
  out.push("  [Character Equipment]", "");
  {
    let label = 0;
    for (let i = 0; i < p.body.count; i++) {
      const obj = gearGet(state.gear, p.equipment[i] ?? 0);
      if (!obj) continue;
      out.push(...dumpItemLines(state, obj, dumpLabel(label++), extras));
    }
  }
  out.push("", "");

  /* Inventory (L1094-1105). */
  out.push("", "", "  [Character Inventory]", "");
  {
    let label = 0;
    /* upkeep->inven[], not the master gear list (L1095): the quiver gets its
     * own section below, so a quivered stack must not be dumped twice. */
    for (const handle of state.gear.inven ?? []) {
      const obj = gearGet(state.gear, handle);
      if (!obj) continue;
      out.push(...dumpItemLines(state, obj, dumpLabel(label++), extras));
    }
  }
  out.push("", "");

  /* Quiver (L1107-1118). */
  out.push("", "", "  [Character Quiver]", "");
  {
    let label = 0;
    for (const handle of state.gear.quiver ?? []) {
      if (!handle) continue;
      const obj = gearGet(state.gear, handle);
      if (!obj) continue;
      out.push(...dumpItemLines(state, obj, dumpLabel(label++), extras));
    }
  }
  out.push("", "");

  /* Home inventory (L1120-1139): skipped when no live home store (12.1). */

  /* Character history ledger - dump_history (ui-history.c L128). */
  out.push("[Player history]");
  for (const l of historyLines(state)) {
    if (l.text === "(no history yet)") continue;
    out.push(l.text);
  }
  out.push("", "");

  /* Options (L1146-1179): the User interface and Birth pages. */
  out.push("  [Options]", "");
  for (const [title, type] of [
    ["User interface", "INTERFACE"],
    ["Birth", "BIRTH"],
  ] as const) {
    out.push(`  [${title}]`, "");
    for (const entry of OPTION_ENTRIES) {
      if (entry.type !== type) continue;
      const desc = entry.description;
      const padded = desc.length < 45 ? desc + " ".repeat(45 - desc.length) : desc;
      const val = state.options ? state.options.get(entry.name) : entry.normal;
      out.push(`${padded}: ${val ? "yes" : "no "} (${entry.name})`);
    }
    out.push("");
  }

  /* Randart seed (L1181-1188). */
  if (state.options?.get("birth_randarts") && extras.seedRandart !== undefined) {
    out.push("  [Randart seed]", "");
    out.push((extras.seedRandart >>> 0).toString(16).padStart(8, "0"), "");
  }

  /*
   * [Mods enabled] - the one block in this file with no upstream line to cite,
   * because upstream has no mods.
   *
   * WHY IT IS HERE. A dump is the artefact players hand each other, and a mod's
   * change is indistinguishable from a core bug in one - the same reason the
   * diagnostics report lists them (report.ts). Without this, "my Priest's Minor
   * Healing only costs 1 mana" is unanswerable from the file that was shared.
   *
   * WHY IT DOES NOT BREAK PARITY. It is written ONLY when a mod is enabled. A
   * vanilla dump ends exactly where upstream's does, byte for byte, so the
   * faithful case is untouched - and the case this appears in is the case the
   * parity claim already excludes by definition (docs/PARITY.md: the target is
   * the game with no mods). An empty list is not written as an empty heading,
   * for the same reason: "no mods" is what the absence of the block means.
   */
  if (extras.mods && extras.mods.length > 0) {
    out.push("  [Mods enabled]", "");
    for (const m of extras.mods) out.push(`${m.id} ${m.version}`);
    out.push("");
  }

  return out.join("\n");
}

/**
 * dump_save (ui-player.c:1201-1209): write the character dump to `file` in the
 * user directory through text_lines_to_file, and report its ONE failure - the
 * staged file it could not create - with upstream's own message.
 *
 * The user directory is whatever the installed host provides: a real directory on
 * the desktop shell and in the CLI, localStorage in a browser tab. exportUserFile
 * then offers a download only where the file is not one the player can otherwise
 * reach; see user-io.ts.
 *
 * Upstream appends line by line to an open ang_file via file_putf; the port builds
 * the same bytes as one string and hands them to text_lines_to_file, which is what
 * upstream's own dump_save does with its dump_player_lines callback. A difference
 * in how the text reaches the file, not in the file.
 */
export function dumpCharacterFile(
  state: GameState,
  name: string,
  file: string,
  extras: CharDumpExtras = {},
  msg?: (text: string) => void,
): boolean {
  const text = `${buildCharacterDump(state, name, extras)}\n`;
  if (userTextLinesToFile(file, text)) {
    msg?.(`Failed to create file ${userPath(file)}.new`);
    return false;
  }
  exportUserFile(file, text);
  return true;
}

/**
 * Show the character sheet as a modal, repainting on resize so a window that
 * crosses the wide/narrow threshold re-picks its layout. ESC / Enter closes
 * it; 'h'/Space/ArrowLeft and 'l'/ArrowRight cycle the two display modes; 'c'
 * renames; 'f' downloads a text dump; the narrow list scrolls with the arrows
 * or a tap.
 */
export function showCharacterSheet(
  term: GridSurface & GridPointerInput & SurfaceSizeEvents,
  state: GameState,
  name: string,
  opts: CharSheetOpts = {},
): Promise<void> {
  let curName = name;
  /* Hoisted out of the terminal's own painting loop because the PRESENTER moves
   * it too, through `invoke("page-next")`. */
  let mode = 0; // 0 = skills/history, 1 = resist/ability/sustain grid
  const extraDeps = () => ({
    ...(opts.numShots !== undefined ? { numShots: opts.numShots } : {}),
    ...(opts.launcher !== undefined ? { launcher: opts.launcher } : {}),
  });
  const mkDeps = () => ({ ...charSheetDeps(state, curName), ...extraDeps() });
  /* Build the ui_entry config once (mode 1 grid); null without packs. */
  const gridConfig = opts.uiEntryPacks
    ? buildUiEntryConfig(opts.uiEntryPacks, state.uiEntry)
    : null;
  const modeOneLines = (): ScreenLine[] =>
    gridConfig ? characterGridLines(state, curName, gridConfig) : modeOnePlaceholder();

  /**
   * 'c' (do_cmd_change_name L1249-1250): with the name pinned from the command
   * line the rename is refused outright and the prompt never opens.
   */
  const doRename = async (): Promise<void> => {
    if (argForceName()) {
      opts.msg?.("You are not allowed to change your name!");
      return;
    }
    const entered = await promptText(term, RENAME_PROMPT, curName);
    if (entered !== null && entered.trim()) {
      curName = entered.trim();
      opts.onRename?.(curName);
    }
  };

  /** 'f' (L1263-1278): get_file over the suggested name, dump_save, then msg. */
  const doFileDump = async (): Promise<void> => {
    const file = await getFile(term, dumpFileName(curName));
    if (file === null) return;
    const ok = dumpCharacterFile(
      state,
      curName,
      file,
      {
        ...(opts.uiEntryPacks !== undefined ? { uiEntryPacks: opts.uiEntryPacks } : {}),
        ...(opts.inspectExtras !== undefined ? { inspectExtras: opts.inspectExtras } : {}),
        ...(opts.seedRandart !== undefined ? { seedRandart: opts.seedRandart } : {}),
        ...(opts.mods !== undefined ? { mods: opts.mods } : {}),
      },
      opts.msg,
    );
    opts.msg?.(ok ? "Character dump successful." : "Character dump failed!");
  };

  /**
   * The view for whichever page is showing, or `null` for the mode-1 placeholder
   * a character with no ui_entry packs gets - there is no model for a notice
   * saying the data is missing, and publishing one under `core:character-flags`
   * would be a lie about what a presenter is holding.
   */
  const viewFor = (): ScreenView | null =>
    mode === 0
      ? characterScreen(state, curName, extraDeps())
      : gridConfig === null
        ? null
        : characterFlagsScreen(state, curName, gridConfig);

  /**
   * THE SEAM. A presenter is offered the sheet before the terminal draws it, and
   * `host` is how it reaches the three commands the footer names: the rename and
   * the dump still run the GAME's code (its prompt, its file), and the page keys
   * hand back the other page's view.
   *
   * An unknown id is a no-op that returns the current view rather than an error,
   * because a presenter written against a later engine must not be able to close
   * the player's character sheet by asking for a command this one has not got.
   */
  /**
   * Run one command of the sheet with whoever is holding the screen TOLD FIRST.
   *
   * The census (`screenPromptFor`) is what decides, not a list spelled again
   * here: an action it has no row for never reaches the terminal, so there is
   * nothing to stand aside for and announcing anyway would make a presenter fade
   * its overlay out for a page flip. An action it DOES have a row for is
   * announced with that row's own `promptId` and `extent`, so "how much of the
   * screen does this need" is answered once, where it was verified.
   *
   * `withTerminal`'s answer is deliberately dropped. `held: false` means the
   * holder could not stand aside; it has already been reported BY NAME through
   * `screenFault`, and the prompt has already run over its overlay. There is
   * nothing this screen would do differently, and branching on it would be a
   * second policy about mods inside the character sheet.
   */
  const announced = async (actionId: string, work: () => Promise<void>): Promise<void> => {
    const fact = screenPromptFor(MODE_VIEW_IDS[mode] ?? MODE_VIEW_IDS[0], actionId);
    if (fact === undefined) {
      await work();
      return;
    }
    await withTerminal(
      promptRequest(
        fact.promptId,
        actionId,
        fact.extent,
        /* Falls back to the id rather than throwing: a missing label is a mod
         * reading a slightly worse caption, and `charsheet.test.ts` fails on it
         * long before a player could. Refusing the rename would be worse than
         * anything the census could get wrong. */
        CHARSHEET_PROMPT_LABELS[fact.promptId] ?? fact.promptId,
        term.size(),
      ),
      work,
      screenFault,
    );
  };

  const host: ScreenHost = {
    invoke: async (id: string): Promise<ScreenView | undefined> => {
      if (id === "page-next") mode = (mode + 1) % INFO_SCREENS;
      else if (id === "page-prev") mode = (mode - 1 + INFO_SCREENS) % INFO_SCREENS;
      else if (id === "rename") await announced(id, doRename);
      else if (id === "file") await announced(id, doFileDump);
      return viewFor() ?? undefined;
    },
  };

  const opening = viewFor();
  if (opening !== null) {
    const taken = showThroughPresenter(opening, screenFault, host);
    if (taken) {
      return taken.catch((error: unknown) => {
        /* The presenter died with the sheet open. It is already reported and the
         * seam is already out; all that is left is to show the player the screen
         * they asked for, which the terminal path below does. */
        if (!(error instanceof ScreenAbandoned)) throw error;
        return showSheetOnTerminal();
      });
    }
  }
  return showSheetOnTerminal();

  /**
   * The faithful terminal's own character sheet; see `showCharacterSheet`.
   *
   * A REGION for as long as the sheet is up (#253). Both painters below erase
   * the whole terminal - `paintWide` and `paintNarrow` are the two halves of one
   * screen, and which of them runs is a width decision, so the rectangle is the
   * same either way and one push covers both. The split into `show`/`paint` is
   * the shape overlay.ts's converted screens use, and the painter's body is
   * unchanged because `regionSurface` hands it region-local coordinates and a
   * `size()` that answers the rectangle - which here IS the terminal, because
   * that is what a 4.2.6 screen is.
   *
   * `onSizeChanged` IS THE TERMINAL'S, not the region's, and is carried across
   * deliberately. A region has no size events of its own - `place()` is re-run
   * by the compositor and reports through the handle - but this screen holds the
   * keyboard across a resize and repaints itself when the terminal changes
   * shape, which is exactly what crossing the wide/narrow threshold needs. A
   * surface without it would leave the sheet in the wrong layout until a key
   * arrived.
   */
  function showSheetOnTerminal(): Promise<void> {
    const handle = pushRegion(screenRegionSpec(), term.size());
    const surface: GridSurface & GridPointerInput & SurfaceSizeEvents = {
      ...regionSurface(term, handle.cells),
      onSizeChanged: (listener) => term.onSizeChanged(listener),
    };
    return paintSheetOnTerminal(surface).finally(() => {
      popRegion(handle);
    });
  }

  function paintSheetOnTerminal(
    term: GridSurface & GridPointerInput & SurfaceSizeEvents,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let top = 0; // scroll offset for the narrow list / mode-1 grid
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

      const title = (): string => characterTitle(state, curName);

      // do_cmd_change_name prompt (ui-player.c:1229), verbatim and identical in
      // both display modes; 'h' cycles the pages. The same string the views
      // publish as their footer, spelled once in `screens.ts`.
      const wideFooter = (): string => CHARACTER_FOOTER;

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
          drawPlayerXtraInfo(term, characterPanels(state, deps), historyBlockLines(state, cols));
        } else if (!gridConfig) {
          // No ui_entry packs: a labelled notice instead of a faked grid.
          let y = 2;
          for (const line of modeOnePlaceholder()) printLine(0, y++, line);
        } else {
          // Mode 1 (display_player mode 1, ui-player.c:905-914): the topleft
          // Name/Race/Class/Title/HP/SP panel, the stat table (already drawn
          // above), the sustains block, and the four flag regions - each at its
          // exact upstream anchor, with NO on-screen region titles (upstream
          // shows those only in the character dump).
          paintPanel(term, ANCHOR.topleft, byKey("topleft"));
          const { resistPanels, statModPanel } = characterGrid(
            state,
            gridConfig,
            liveUiEntryDeps(state),
          );
          const blit = (block: ScreenLine[], x: number, y0: number): void => {
            let y = y0;
            for (const line of block) {
              if (y >= rows - 1) break;
              printLine(x, y, line);
              y += 1;
            }
          };
          // Sustains (display_player_sust_info, col 26): the "abcdefgimnop@"
          // header on the stat-header row, its five stat rows on the stat rows,
          // just left of the stat table.
          blit(buildSustainBlock(state, statModPanel), SUST_COL, STAT_HEADER_ROW);
          // Four flag regions tiled left-to-right (cols 0/20/40/60), each with an
          // equippy row / letter header / data rows from row 2+STAT_MAX.
          resistPanels.forEach((panel, i) => {
            blit(buildGridBlock(state, panel), i * RES_REGION_STRIDE, RES_REGION_ROW);
          });
        }

        term.print(2, rows - 1, wideFooter().slice(0, cols - 3), DIM);
      };

      const narrowLines = (): ScreenLine[] => {
        const { cols } = term.size();
        if (mode === 1) return modeOneLines();
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
        term.print(0, rows - 1, `${CHARACTER_FOOTER}${more}`.slice(0, cols - 1), DIM);
      };

      const paint = (): void => {
        narrow = term.size().cols < WIDE_COLS;
        if (narrow) paintNarrow();
        else paintWide();
      };

      const finish = (): void => {
        inputEvents.removeEventListener("keydown", onKey, true);
        setActiveCellTap(term, null);
        stopSizeChanged();
        resolve();
      };

      const cycleMode = (delta: number): void => {
        mode = (mode + delta + INFO_SCREENS) % INFO_SCREENS;
        top = 0;
        paint();
      };


      /**
       * Run one of the sheet's commands with THIS MODULE'S listeners detached: `promptText`
       * and `getFile` listen in the capture phase and would otherwise be starved by
       * them. The command bodies themselves are shared with the presenter's `host`,
       * which needs no detaching because it never installed anything.
       */
      const detached = (run: () => Promise<void>): void => {
        inputEvents.removeEventListener("keydown", onKey, true);
        setActiveCellTap(term, null);
        void run().then(() => {
          inputEvents.addEventListener("keydown", onKey, true);
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
            detached(doRename);
            return;
          case "f":
            detached(doFileDump);
            return;
          default: {
            // Arrows AND numpad digits scroll (menuNav), so the numpad is not
            // dead here when NumLock is on. ArrowLeft/Right (cycle) are handled
            // above; menuNav only reports vertical intent (4/6 stay page cycles).
            const nav = menuNav(ev);
            if (!nav) return;
            if (nav === "up") top = Math.max(0, top - 1);
            else if (nav === "down") top += 1;
            else if (nav === "pageup") top = Math.max(0, top - page);
            else if (nav === "pagedown") top += page;
            else if (nav === "home") top = 0;
            else if (nav === "end") top += page; // clamped in paint()
            break;
          }
        }
        paint();
      };

      /** Tap: on the wide sheet a body tap flips the page (upstream's mouse
       * button 1) and a footer tap closes; on the narrow list a tap scrolls
       * (upper half up, lower half down) and the footer closes. */
      const installTap = (): void => {
        setActiveCellTap(term, (cell) => {
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
      const stopSizeChanged = term.onSizeChanged(() => paint());
      inputEvents.addEventListener("keydown", onKey, true);
      installTap();
      paint();
    });
  }
}

/**
 * Draw one characterPanels panel as a label/value column at the anchor's (x, y):
 * the label left-justified to `labelWidth` in the label colour, the value in the
 * row's own colour. Blank separators advance a row; label-only lines (section
 * headers such as "Turns used:") print bare. Returns the next free row.
 *
 * Value placement mirrors display_panel (ui-player.c L619-622): a left-adjusted
 * panel (only `topleft`, per panels[] L850-856) prints the value just after the
 * label; a right-adjusted panel prints it so its last char lands at the region's
 * right edge (`col + w - len`), clamped so it never overlaps the label.
 */
/**
 * display_player_xtra_info (ui-player.c L858-880) - the five character panels at
 * their upstream anchors plus the history block from row 19.
 *
 * Exported because it is not the character screen's private layout: ui-birth.c
 * calls this same function for the roller (L894), the point-based screen
 * (L1083) and the final confirmation (L1546), so the birth screens must show
 * the SAME panels in the SAME places - the whole sheet minus the stat table,
 * which each caller draws itself (the birth screen adds a cost column beside
 * it). Painting a different, list-shaped summary there is exactly the drift
 * this replaces.
 */
export function drawPlayerXtraInfo(
  term: GridSurface,
  panels: readonly { key: string; lines: readonly { label: string; value: string; color: number }[] }[],
  history: readonly ScreenLine[],
): void {
  const { rows } = term.size();
  const byKey = (k: string): readonly { label: string; value: string; color: number }[] =>
    panels.find((p) => p.key === k)?.lines ?? [];
  paintPanel(term, ANCHOR.topleft, byKey("topleft"));
  paintPanel(term, ANCHOR.misc, byKey("misc"));
  const midEnd = paintPanel(term, ANCHOR.midleft, byKey("midleft"));
  const combatEnd = paintPanel(term, ANCHOR.combat, byKey("combat"));
  const skillsEnd = paintPanel(term, ANCHOR.skills, byKey("skills"));
  // History from row 19 (Term_gotoxy(1, 19) + text_out_to_screen), pushed down
  // only if a panel ever grew past it.
  let hy = Math.max(HISTORY_ROW, midEnd + 1, combatEnd + 1, skillsEnd + 1);
  for (const line of history) {
    if (hy >= rows - 1) break;
    if (line.runs) {
      let cx = 0;
      for (const run of line.runs) {
        term.print(cx, hy, run.text, run.color);
        cx += run.text.length;
      }
    } else {
      term.print(0, hy, line.text, line.color ?? FG);
    }
    hy += 1;
  }
}

function paintPanel(
  term: GridSurface,
  region: { x: number; y: number; labelWidth: number; width: number; alignRight: boolean },
  lines: readonly { label: string; value: string; color: number }[],
): number {
  const { x, labelWidth, width, alignRight } = region;
  let y = region.y;
  for (const ln of lines) {
    if (!ln.label && !ln.value) {
      y += 1;
      continue;
    }
    // The label is printed VERBATIM (display_panel L614 Term_putstr of
    // pl->label): upstream's own labels carry no colon except get_panel_misc's
    // "Turns used:", which keeps its one.
    const label = ln.label;
    if (!ln.value) {
      term.print(x, y++, label, LABEL);
      continue;
    }
    term.print(x, y, label.padEnd(labelWidth), LABEL);
    // Left-adjusted: value just after the label. Right-adjusted: value's last
    // char at the region's right edge (x + width - len), clamped so it never
    // collides with the label (falls back to just-after-label if it would).
    const afterLabel = x + labelWidth + 1;
    const valueX = alignRight
      ? Math.max(afterLabel, x + width - ln.value.length)
      : afterLabel;
    term.print(valueX, y, ln.value, colorToCss(ln.color));
    y += 1;
  }
  return y;
}
