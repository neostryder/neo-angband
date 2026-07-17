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

import {
  characterPanels,
  statTable,
  colorToCss,
  buildUiEntryConfig,
  characterGrid,
  gearGet,
  describeObject,
  makeObjectInfoDeps,
  objectInfo,
  textblockToString,
  ODESC,
  OINFO,
  OPTION_ENTRIES,
  PARITY_BASELINE,
} from "@neo-angband/core";
import type {
  GameState,
  GameObject,
  ObjectInfoExtras,
  UiEntryConfig,
  UiEntryPackRecords,
  UiGridPanel,
} from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import {
  characterSheetLines,
  charSheetDeps,
  historyBlockLines,
  historyLines,
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

/** Stat sustain labels (display_player_sust_info, one row per STAT). */
const STAT_LABELS = ["Str", "Int", "Wis", "Dex", "Con"] as const;

/**
 * characterGridLines: render the mode-1 grid (core characterGrid) as scrollable
 * ScreenLines. Each row is the entry label (coloured by its combined value)
 * followed by one cell per equipment slot then the player "@" column, exactly
 * the display_resistance_panel / display_player_sust_info data - the Term
 * placement is this shell's business (game/ui-entry.ts's documented split).
 */
function characterGridLines(state: GameState, config: UiEntryConfig): ScreenLine[] {
  const { resistPanels, statModPanel } = characterGrid(state, config);
  const p = state.actor.player;
  const lines: ScreenLine[] = [];

  /* Equippy header: one glyph per body slot, then '@' for the player column. */
  const equippy: { text: string; color: string }[] = [{ text: " ".repeat(7), color: LABEL }];
  for (let i = 0; i < p.body.count; i++) {
    const obj = gearGet(state.gear, p.equipment[i] ?? 0);
    equippy.push({ text: obj ? obj.kind.dChar : ".", color: obj ? FG : DIM });
  }
  equippy.push({ text: "@", color: TITLE });
  lines.push({ text: equippy.map((r) => r.text).join(""), color: FG, runs: equippy });

  const pushPanel = (panel: UiGridPanel, title: string, labelFor: (i: number) => string): void => {
    lines.push({ text: "", color: FG });
    lines.push({ text: title, color: TITLE });
    panel.rows.forEach((row, i) => {
      const label = (row.label || labelFor(i)).padEnd(7).slice(0, 7);
      const runs: { text: string; color: string }[] = [
        { text: label, color: colorToCss(row.labelColor) },
      ];
      for (const cell of row.cells) {
        runs.push({ text: cell.symbol, color: colorToCss(cell.color) });
      }
      lines.push({ text: runs.map((r) => r.text).join(""), color: FG, runs });
    });
  };

  for (const panel of resistPanels) {
    pushPanel(panel, PANEL_TITLES[panel.key] ?? panel.key, () => "");
  }
  pushPanel(statModPanel, "Sustains", (i) => STAT_LABELS[i] ?? "");

  return lines;
}

/** player_safe_name: a filesystem-safe filename from the character's name. */
function safeFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return `${safe || "character"}.txt`;
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
  const { resistPanels } = characterGrid(state, buildUiEntryConfig(packs));
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
    for (const handle of state.gear.pack) {
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

  return out.join("\n");
}

/**
 * death_file (ui-death.c L162-188) / the char sheet's 'f': download the
 * character dump as a text file. Exported so the death menu's "File dump" row
 * shares the exact same output as the in-life dump.
 */
export function dumpCharacterFile(
  state: GameState,
  name: string,
  extras: CharDumpExtras = {},
): boolean {
  return downloadDump(state, name, extras);
}

/** 'f' (dump_save): download the full character dump as a plain-text file. */
function downloadDump(
  state: GameState,
  name: string,
  extras: CharDumpExtras = {},
): boolean {
  try {
    const text = buildCharacterDump(state, name, extras);
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
  /* Build the ui_entry config once (mode 1 grid); null without packs. */
  const gridConfig = opts.uiEntryPacks ? buildUiEntryConfig(opts.uiEntryPacks) : null;
  const modeOneLines = (): ScreenLine[] =>
    gridConfig ? characterGridLines(state, gridConfig) : modeOnePlaceholder();

  return new Promise<void>((resolve) => {
    let top = 0; // scroll offset for the narrow list / mode-1 grid
    let mode = 0; // 0 = skills/history, 1 = resist/ability/sustain grid
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
        // Mode 1: the resist / ability / hindrance / modifier / sustain grid
        // (display_player_flag_info). The stat table stays top-right; the grid
        // scrolls at the left since it exceeds 24 rows (its Term draw is the
        // shell's per game/ui-entry.ts).
        const lines = modeOneLines();
        const bodyRows = rows - 3;
        const maxTop = Math.max(0, lines.length - bodyRows);
        if (top > maxTop) top = maxTop;
        for (let r = 0; r < bodyRows; r++) {
          const line = lines[top + r];
          if (!line) break;
          printLine(0, 2 + r, line);
        }
      }

      term.print(0, rows - 1, wideFooter().slice(0, cols - 1), DIM);
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
          downloadDump(state, curName, {
            ...(opts.uiEntryPacks !== undefined ? { uiEntryPacks: opts.uiEntryPacks } : {}),
            ...(opts.inspectExtras !== undefined ? { inspectExtras: opts.inspectExtras } : {}),
            ...(opts.seedRandart !== undefined ? { seedRandart: opts.seedRandart } : {}),
          });
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
