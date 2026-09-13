/**
 * Independent Angband terms hosted as tiled panels around the main view.
 *
 * Content types match the non-Borg PW_* flags in ui-term.h. Borg's two extra
 * flags stay out: Borg is a separate mod, and core must not learn its names.
 * Layout (which panel sits where) lives in subwindow-layout.ts; this module
 * owns the content list, persistence, and painters.
 */

import {
  COLOUR_RED,
  COLOUR_WHITE,
  colorToCss,
  sidebarModel,
  statusLineModel,
} from "@rpgm-tools/neo-angband-core";
import type {
  Constants,
  DisplayDeps,
  GameState,
  LoreDeps,
  MonsterLore,
  MonsterRace,
  SidebarField,
  StatusIndicator,
  Textblock,
  UiEntryConfig,
} from "@rpgm-tools/neo-angband-core";
import { characterFlagsLines } from "./charsheet";
import { format, type LoggedMessage, type MessageLog } from "./messages";
import type { Overview } from "./mapview";
import {
  characterSheetLines,
  equipmentSubwindowLines,
  inventorySubwindowLines,
  monsterListSubwindowLines,
  monsterRecallLines,
  objectListSubwindowLines,
  objectRecallScreen,
} from "./screens";
import { screenBodyLines } from "./screen-view";
import type { GridSurface } from "./term";
import type { ScreenLine } from "./overlay";
import { UI_DIM, UI_TEXT } from "./ui-colors";
import {
  MAIN_TILE_ID,
  containsLeaf,
  insertAtEdge,
  parseLayoutTree,
  pruneTree,
  type DockEdge,
  type LayoutNode,
} from "./subwindow-layout";

export type SubwindowId =
  | "inventory"
  | "equipment"
  | "player-basic"
  | "player-extra"
  | "player-compact"
  | "map"
  | "messages"
  | "overhead"
  | "monster-recall"
  | "object-recall"
  | "monsters"
  | "status"
  | "items"
  | "player-topbar";

export type SubwindowSettings = Record<SubwindowId, boolean>;

export interface SubwindowState {
  enabled: SubwindowSettings;
  tree: LayoutNode;
}

export const SUBWINDOW_STORAGE_KEY = "neo-angband:subwindows";

export const SUBWINDOW_CHOICES: readonly { id: SubwindowId; label: string }[] = [
  { id: "inventory", label: "Display inven/equip" },
  { id: "equipment", label: "Display equip/inven" },
  { id: "player-basic", label: "Display player (basic)" },
  { id: "player-extra", label: "Display player (extra)" },
  { id: "player-compact", label: "Display player (compact)" },
  { id: "map", label: "Display dungeon map" },
  { id: "messages", label: "Display messages" },
  { id: "overhead", label: "Display overhead view" },
  { id: "monster-recall", label: "Display monster recall" },
  { id: "object-recall", label: "Display object recall" },
  { id: "monsters", label: "Display monster list" },
  { id: "status", label: "Display status" },
  { id: "items", label: "Display item list" },
  { id: "player-topbar", label: "Display player (topbar)" },
];

const SUBWINDOW_IDS: readonly SubwindowId[] = SUBWINDOW_CHOICES.map((choice) => choice.id);

export const DEFAULT_SUBWINDOW_SETTINGS: Readonly<SubwindowSettings> = Object.freeze(
  Object.fromEntries(SUBWINDOW_IDS.map((id) => [id, false])) as SubwindowSettings,
);

const DEFAULT_DOCK: Readonly<Record<SubwindowId, { edge: DockEdge; ratio: number }>> = {
  messages: { edge: "bottom", ratio: 0.22 },
  inventory: { edge: "right", ratio: 0.32 },
  equipment: { edge: "right", ratio: 0.32 },
  monsters: { edge: "right", ratio: 0.28 },
  items: { edge: "right", ratio: 0.28 },
  "monster-recall": { edge: "right", ratio: 0.3 },
  "object-recall": { edge: "right", ratio: 0.3 },
  overhead: { edge: "left", ratio: 0.28 },
  map: { edge: "left", ratio: 0.32 },
  "player-compact": { edge: "left", ratio: 0.22 },
  "player-basic": { edge: "left", ratio: 0.3 },
  "player-extra": { edge: "left", ratio: 0.3 },
  "player-topbar": { edge: "top", ratio: 0.16 },
  status: { edge: "bottom", ratio: 0.12 },
};

/** Upstream Term-1..Term-7 assignment, as a tiling tree around the main view. */
export function canonicalSubwindowTree(): LayoutNode {
  return {
    kind: "split",
    axis: "v",
    ratio: 0.68,
    first: {
      kind: "split",
      axis: "h",
      ratio: 0.78,
      first: { kind: "leaf", id: MAIN_TILE_ID },
      second: { kind: "leaf", id: "messages" },
    },
    second: {
      kind: "split",
      axis: "h",
      ratio: 0.22,
      first: { kind: "leaf", id: "inventory" },
      second: {
        kind: "split",
        axis: "h",
        ratio: 0.25,
        first: { kind: "leaf", id: "monsters" },
        second: {
          kind: "split",
          axis: "h",
          ratio: 0.33,
          first: { kind: "leaf", id: "items" },
          second: {
            kind: "split",
            axis: "h",
            ratio: 0.5,
            first: {
              kind: "split",
              axis: "v",
              ratio: 0.5,
              first: { kind: "leaf", id: "monster-recall" },
              second: { kind: "leaf", id: "object-recall" },
            },
            second: {
              kind: "split",
              axis: "h",
              ratio: 0.5,
              first: { kind: "leaf", id: "overhead" },
              second: { kind: "leaf", id: "player-compact" },
            },
          },
        },
      },
    },
  };
}

export function emptyLayoutTree(): LayoutNode {
  return { kind: "leaf", id: MAIN_TILE_ID };
}

export function enabledSubwindowIds(settings: SubwindowSettings): SubwindowId[] {
  return SUBWINDOW_IDS.filter((id) => settings[id]);
}

export function reconcileSubwindowTree(tree: LayoutNode, settings: SubwindowSettings): LayoutNode {
  const enabled = enabledSubwindowIds(settings);
  const keep = new Set<string>([MAIN_TILE_ID, ...enabled]);
  let next = pruneTree(tree, keep) ?? emptyLayoutTree();
  for (const id of enabled) {
    if (containsLeaf(next, id)) continue;
    const dock = DEFAULT_DOCK[id];
    next = insertAtEdge(next, id, MAIN_TILE_ID, dock.edge, dock.ratio);
  }
  return next;
}

export function treeForSettings(settings: SubwindowSettings): LayoutNode {
  return reconcileSubwindowTree(canonicalSubwindowTree(), settings);
}

function blankSettings(): SubwindowSettings {
  return { ...DEFAULT_SUBWINDOW_SETTINGS };
}

function parseEnabled(raw: Partial<Record<string, unknown>>): SubwindowSettings {
  const enabled = blankSettings();
  for (const id of SUBWINDOW_IDS) {
    enabled[id] = raw[id] === true;
  }
  return enabled;
}

export function readSubwindowState(storage: Pick<Storage, "getItem">): SubwindowState {
  try {
    const raw = storage.getItem(SUBWINDOW_STORAGE_KEY);
    if (raw === null) {
      const enabled = blankSettings();
      return { enabled, tree: emptyLayoutTree() };
    }
    const parsed = JSON.parse(raw) as { v?: unknown } & Partial<Record<string, unknown>>;
    if (parsed.v === 2) {
      const enabled = parseEnabled(
        parsed.enabled && typeof parsed.enabled === "object"
          ? (parsed.enabled as Partial<Record<string, unknown>>)
          : parsed,
      );
      const tree = parseLayoutTree(parsed.tree);
      return { enabled, tree: reconcileSubwindowTree(tree ?? treeForSettings(enabled), enabled) };
    }
    const enabled = parseEnabled(parsed);
    return { enabled, tree: treeForSettings(enabled) };
  } catch {
    const enabled = blankSettings();
    return { enabled, tree: emptyLayoutTree() };
  }
}

/** Read only the supported booleans; malformed or older data is harmless. */
export function readSubwindowSettings(storage: Pick<Storage, "getItem">): SubwindowSettings {
  return readSubwindowState(storage).enabled;
}

export function writeSubwindowState(
  storage: Pick<Storage, "setItem" | "removeItem">,
  state: SubwindowState,
): void {
  if (!Object.values(state.enabled).some(Boolean)) {
    storage.removeItem(SUBWINDOW_STORAGE_KEY);
    return;
  }
  storage.setItem(
    SUBWINDOW_STORAGE_KEY,
    JSON.stringify({
      v: 2,
      enabled: state.enabled,
      tree: state.tree,
    }),
  );
}

/** Persist the display setting outside the character save, like window flags. */
export function writeSubwindowSettings(
  storage: Pick<Storage, "setItem" | "removeItem">,
  settings: SubwindowSettings,
): void {
  writeSubwindowState(storage, { enabled: settings, tree: treeForSettings(settings) });
}

export function setSubwindowEnabled(state: SubwindowState, id: SubwindowId, enabled: boolean): SubwindowState {
  const nextEnabled = { ...state.enabled, [id]: enabled };
  return { enabled: nextEnabled, tree: reconcileSubwindowTree(state.tree, nextEnabled) };
}

/** Paint styled terminal rows, optionally anchored to the bottom of the term. */
export function paintSubwindowLines(
  term: GridSurface,
  lines: readonly ScreenLine[],
  bottom = false,
): void {
  const { cols, rows } = term.size();
  term.clear();
  const visible = bottom ? lines.slice(-rows) : lines.slice(0, rows);
  const top = bottom ? rows - visible.length : 0;
  visible.forEach((line, index) => {
    const y = top + index;
    if (line.runs) {
      let x = 0;
      for (const run of line.runs) {
        if (x >= cols) break;
        const text = run.text.slice(0, cols - x);
        term.print(x, y, text, run.color);
        x += text.length;
      }
    } else {
      term.print(0, y, line.text.slice(0, cols), line.color ?? UI_TEXT);
    }
  });
  term.hideCursor();
}

function runsToLine(runs: readonly { text: string; color: number }[]): ScreenLine {
  const parts = runs.map((run) => ({
    text: run.text,
    color: colorToCss(run.color),
  }));
  return {
    text: parts.map((part) => part.text).join(""),
    runs: parts,
  };
}

function wrapRunText(
  runs: readonly { text: string; color: string }[],
  cols: number,
): ScreenLine[] {
  if (cols < 1) return [];
  const lines: ScreenLine[] = [];
  let current: { text: string; color: string }[] = [];
  let width = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    lines.push({
      text: current.map((part) => part.text).join(""),
      runs: current,
    });
    current = [];
    width = 0;
  };
  for (const run of runs) {
    let rest = run.text;
    while (rest.length > 0) {
      const room = cols - width;
      if (room <= 0) {
        flush();
        continue;
      }
      const chunk = rest.slice(0, room);
      current.push({ text: chunk, color: run.color });
      width += chunk.length;
      rest = rest.slice(chunk.length);
      if (width >= cols) flush();
    }
  }
  flush();
  return lines;
}

const COMPACT_FIELD_ORDER: readonly (string | null)[] = [
  "race",
  "class",
  "title",
  "level",
  "exp",
  "gold",
  "equippy",
  "str",
  "int",
  "wis",
  "dex",
  "con",
  null,
  "ac",
  "hp",
  "sp",
  "health",
];

const TOPBAR_ROW_0: readonly string[] = [
  "level",
  "exp",
  "str",
  "int",
  "wis",
  "dex",
  "con",
  "ac",
  "gold",
  "race",
  "class",
];

const TOPBAR_ROW_1: readonly string[] = ["hp", "sp", "health", "speed", "depth", "title"];

export function playerCompactLines(fields: readonly SidebarField[]): ScreenLine[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const lines: ScreenLine[] = [];
  for (const key of COMPACT_FIELD_ORDER) {
    if (key === null) {
      lines.push({ text: "" });
      continue;
    }
    const field = byKey.get(key);
    lines.push(field ? runsToLine(field.runs) : { text: "" });
  }
  return lines;
}

function joinFieldRow(fields: readonly SidebarField[], keys: readonly string[]): ScreenLine {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const runs: { text: string; color: number }[] = [];
  for (const key of keys) {
    const field = byKey.get(key);
    if (!field || field.runs.length === 0) continue;
    if (runs.length > 0) runs.push({ text: " ", color: COLOUR_WHITE });
    runs.push(...field.runs);
  }
  return runsToLine(runs);
}

export function playerTopbarLines(
  fields: readonly SidebarField[],
  indicators: readonly StatusIndicator[],
  cols: number,
): ScreenLine[] {
  const statusRuns = indicators.flatMap((indicator) =>
    indicator.runs.map((run) => ({ text: run.text, color: colorToCss(run.color) })),
  );
  return [
    joinFieldRow(fields, TOPBAR_ROW_0),
    joinFieldRow(fields, TOPBAR_ROW_1),
    ...wrapRunText(statusRuns, cols),
  ];
}

export function statusSubwindowLines(indicators: readonly StatusIndicator[], cols: number): ScreenLine[] {
  const runs = indicators.flatMap((indicator) =>
    indicator.runs.map((run) => ({ text: run.text, color: colorToCss(run.color) })),
  );
  const lines = wrapRunText(runs, cols);
  return lines.length > 0 ? lines : [{ text: "", color: UI_TEXT }];
}

/**
 * update_messages_subwindow (ui-display.c L1886-1933). Messages are oldest at
 * the top and newest at the bottom. Entries newer than the last repaint are
 * red; older entries retain their message type colour.
 */
export class MessageSubwindowPainter {
  private previousNewest: LoggedMessage | null = null;
  private paintedNewest: LoggedMessage | null = null;
  private paintedNewestText = "";
  private paintedLength = -1;
  private paintedCols = -1;
  private paintedRows = -1;

  paint(term: GridSurface, log: MessageLog): void {
    const all = log.all();
    const newest = all[all.length - 1] ?? null;
    const newestText = newest ? format(newest) : "";
    const { cols, rows } = term.size();
    /* Idle animation frames repaint the game but upstream updates this term
     * only on EVENT_STATE. Do not turn a fresh red message back to its ordinary
     * colour merely because another canvas requested a frame. */
    if (
      newest === this.paintedNewest &&
      newestText === this.paintedNewestText &&
      all.length === this.paintedLength &&
      cols === this.paintedCols &&
      rows === this.paintedRows
    ) {
      return;
    }
    const newestFirst = [...all].reverse();
    let fresh = true;
    const lines = newestFirst
      .slice(0, rows)
      .map((entry): ScreenLine => {
        if (entry === this.previousNewest) fresh = false;
        const color = fresh ? colorToCss(COLOUR_RED) : entry.color;
        return { text: format(entry), ...(color === undefined ? {} : { color }) };
      })
      .reverse();
    this.previousNewest = newestFirst[0] ?? null;
    this.paintedNewest = newest;
    this.paintedNewestText = newestText;
    this.paintedLength = all.length;
    this.paintedCols = cols;
    this.paintedRows = rows;
    paintSubwindowLines(term, lines, true);
  }
}

/** monster_list_show_subwindow, repainted from current game state. */
export function paintMonsterSubwindow(term: GridSurface, state: GameState): void {
  const { cols, rows } = term.size();
  paintSubwindowLines(term, monsterListSubwindowLines(state, rows, cols));
}

/** update_inven_subwindow, using the shared inventory screen model. */
export function paintInventorySubwindow(
  term: GridSurface,
  state: GameState,
  constants: Pick<Constants, "quiverSlotSize" | "thrownQuiverMult">,
): void {
  const { cols } = term.size();
  paintSubwindowLines(term, inventorySubwindowLines(state, cols, constants));
}

/** update_equip_subwindow, using the shared equipment screen model. */
export function paintEquipmentSubwindow(term: GridSurface, state: GameState): void {
  const { cols } = term.size();
  paintSubwindowLines(term, equipmentSubwindowLines(state, cols));
}

/** update_itemlist_subwindow, using the shared floor-item screen model. */
export function paintItemListSubwindow(term: GridSurface, state: GameState): void {
  const { cols, rows } = term.size();
  paintSubwindowLines(term, objectListSubwindowLines(state, rows, cols));
}

/** display_player(0): basic character sheet. */
export function paintPlayerBasicSubwindow(term: GridSurface, state: GameState, name?: string): void {
  const { cols } = term.size();
  paintSubwindowLines(term, characterSheetLines(state, name, cols));
}

/** display_player(1): extra flags / sustains. */
export function paintPlayerExtraSubwindow(
  term: GridSurface,
  state: GameState,
  name: string,
  config: UiEntryConfig,
): void {
  paintSubwindowLines(term, characterFlagsLines(state, name, config));
}

/** update_player_compact_subwindow: left-sidebar fields in compact order. */
export function paintPlayerCompactSubwindow(
  term: GridSurface,
  state: GameState,
  deps: DisplayDeps = {},
): void {
  paintSubwindowLines(term, playerCompactLines(sidebarModel(state, deps)));
}

/** update_topbar_subwindow: two short vitals rows plus the status line. */
export function paintPlayerTopbarSubwindow(
  term: GridSurface,
  state: GameState,
  deps: DisplayDeps = {},
): void {
  const { cols } = term.size();
  paintSubwindowLines(
    term,
    playerTopbarLines(sidebarModel(state, deps), statusLineModel(state, deps), cols),
  );
}

/** update_statusline as its own term. */
export function paintStatusSubwindow(
  term: GridSurface,
  state: GameState,
  deps: DisplayDeps = {},
): void {
  const { cols } = term.size();
  paintSubwindowLines(term, statusSubwindowLines(statusLineModel(state, deps), cols));
}

/** lore_show_subwindow for the currently tracked monster race. */
export function paintMonsterRecallSubwindow(
  term: GridSurface,
  race: MonsterRace | null,
  lore: MonsterLore | null,
  deps: LoreDeps,
): void {
  if (!race || !lore) {
    paintSubwindowLines(term, [{ text: "(no monster recalled)", color: UI_DIM }]);
    return;
  }
  const { cols } = term.size();
  paintSubwindowLines(term, monsterRecallLines(race, lore, deps, cols));
}

/** display_object_recall for the currently tracked object. */
export function paintObjectRecallSubwindow(
  term: GridSurface,
  title: string | null,
  tb: Textblock | null,
): void {
  if (!title || !tb) {
    paintSubwindowLines(term, [{ text: "(no object recalled)", color: UI_DIM }]);
    return;
  }
  const { cols } = term.size();
  paintSubwindowLines(term, screenBodyLines(objectRecallScreen(title, tb), cols));
}

/** PW_MAP / PW_OVERHEAD: ASCII miniature painted into the term. */
export function paintOverviewSubwindow(term: GridSurface, overview: Overview | null): void {
  const { cols, rows } = term.size();
  term.clear();
  if (!overview || overview.mapW < 1 || overview.mapH < 1) {
    term.hideCursor();
    return;
  }
  const originX = Math.max(0, Math.floor((cols - overview.mapW) / 2));
  const originY = Math.max(0, Math.floor((rows - overview.mapH) / 2));
  const maxRow = Math.min(overview.mapH, rows - originY);
  const maxCol = Math.min(overview.mapW, cols - originX);
  for (let row = 0; row < maxRow; row++) {
    const cells = overview.cells[row];
    if (!cells) continue;
    for (let col = 0; col < maxCol; col++) {
      const glyph = cells[col];
      if (!glyph) continue;
      term.put(originX + col, originY + row, { ch: glyph.ch, fg: glyph.css });
    }
  }
  const player = overview.playerGlyph ?? { ch: "@", css: UI_TEXT };
  const px = originX + overview.playerCol;
  const py = originY + overview.playerRow;
  if (px >= 0 && py >= 0 && px < cols && py < rows) {
    term.put(px, py, { ch: player.ch, fg: player.css });
  }
  term.hideCursor();
}
