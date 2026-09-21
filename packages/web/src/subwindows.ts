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
  /** Independent dungeon-map grafID; absent in older layouts means ASCII. */
  mapTileMode?: number;
}

export const SUBWINDOW_STORAGE_KEY = "neo-angband:subwindows";
export const SUBWINDOW_DEFAULT_STORAGE_KEY = "neo-angband:subwindows:default";

/**
 * neo-subwindows (#238): the pref-file directive that carries this state as
 * one JSON payload. Not an upstream directive - see prefs.ts's PrefSink.
 * subwindowLayout doc comment for why the BSP tree needs a directive of its
 * own rather than reusing upstream's window:i:j:v grammar.
 */
export const SUBWINDOW_PREF_DIRECTIVE = "neo-subwindows";

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

/**
 * The default tiling arrangement for a newly-enabled panel with no saved tree
 * of its own (#236): a full multi-panel layout rather than upstream's flat
 * Term-1..7 right-hand column, built around a main view sharing its row with
 * the dungeon map. A panel this tree does not place falls back to DEFAULT_DOCK
 * the same way it already did, so leaving one out here is never a gap.
 */
export function canonicalSubwindowTree(): LayoutNode {
  return {
    kind: "split",
    axis: "v",
    ratio: 0.92,
    first: {
      kind: "split",
      axis: "v",
      ratio: 0.11814488056710794,
      first: {
        kind: "split",
        axis: "h",
        ratio: 0.6325118418796261,
        first: { kind: "leaf", id: "player-basic" },
        second: {
          kind: "split",
          axis: "h",
          ratio: 0.35968923702293415,
          first: { kind: "leaf", id: "equipment" },
          second: { kind: "leaf", id: "inventory" },
        },
      },
      second: {
        kind: "split",
        axis: "v",
        ratio: 0.814788482047636,
        first: {
          kind: "split",
          axis: "h",
          ratio: 0.6325118418796261,
          first: { kind: "leaf", id: MAIN_TILE_ID },
          second: { kind: "leaf", id: "map" },
        },
        second: {
          kind: "split",
          axis: "h",
          ratio: 0.8427305041435362,
          first: {
            kind: "split",
            axis: "h",
            ratio: 0.7955276675939713,
            first: {
              kind: "split",
              axis: "h",
              ratio: 0.7,
              first: {
                kind: "split",
                axis: "h",
                ratio: 0.48665462266530424,
                first: { kind: "leaf", id: "monsters" },
                second: { kind: "leaf", id: "items" },
              },
              second: { kind: "leaf", id: "messages" },
            },
            second: { kind: "leaf", id: "monster-recall" },
          },
          second: { kind: "leaf", id: "object-recall" },
        },
      },
    },
    second: { kind: "leaf", id: "player-extra" },
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

function parseMapTileMode(raw: unknown): number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
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
      return {
        enabled,
        tree: reconcileSubwindowTree(tree ?? treeForSettings(enabled), enabled),
        mapTileMode: parseMapTileMode(parsed.mapTileMode),
      };
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
  if (!Object.values(state.enabled).some(Boolean) && !state.mapTileMode) {
    storage.removeItem(SUBWINDOW_STORAGE_KEY);
    return;
  }
  storage.setItem(SUBWINDOW_STORAGE_KEY, serializeSubwindowState(state));
}

function serializeSubwindowState(state: SubwindowState): string {
  return JSON.stringify({
    v: 2,
    enabled: state.enabled,
    tree: state.tree,
    mapTileMode: parseMapTileMode(state.mapTileMode),
  });
}

/** A missing, unreadable, or malformed personal default leaves the live layout intact. */
export function readSubwindowDefault(storage: Pick<Storage, "getItem">): SubwindowState | null {
  try {
    const raw = storage.getItem(SUBWINDOW_DEFAULT_STORAGE_KEY);
    return raw === null ? null : parseSubwindowStateJson(raw);
  } catch {
    return null;
  }
}

/** Preserve an all-disabled layout as a saved default, too. */
export function writeSubwindowDefault(
  storage: Pick<Storage, "setItem">,
  state: SubwindowState,
): boolean {
  try {
    storage.setItem(SUBWINDOW_DEFAULT_STORAGE_KEY, serializeSubwindowState(state));
    return true;
  } catch {
    return false;
  }
}

/** Persist the display setting outside the character save, like window flags. */
export function writeSubwindowSettings(
  storage: Pick<Storage, "setItem" | "removeItem">,
  settings: SubwindowSettings,
): void {
  writeSubwindowState(storage, { enabled: settings, tree: treeForSettings(settings) });
}

/**
 * neo-subwindows (#238): serialise the tiling tree plus which panels are
 * enabled as one pref-file line, so an arrangement can be carried between
 * installs (hosted vs local, or one machine to another) via the same
 * "save subwindow setup to pref file" flow upstream uses for window flags.
 */
export function dumpSubwindowLayoutPrefText(state: SubwindowState): string {
  const payload = JSON.stringify({
    enabled: state.enabled, tree: state.tree, mapTileMode: parseMapTileMode(state.mapTileMode),
  });
  return `${SUBWINDOW_PREF_DIRECTIVE}:${payload}\n`;
}

/**
 * neo-subwindows (#238): the inverse of dumpSubwindowLayoutPrefText. Returns
 * null on anything malformed - a bad or foreign pref file must never corrupt
 * the live layout, only fail to change it.
 */
export function parseSubwindowStateJson(json: string): SubwindowState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<Record<string, unknown>>;
  const tree = parseLayoutTree(record.tree);
  if (!tree) return null;
  const enabled = parseEnabled(
    record.enabled && typeof record.enabled === "object"
      ? (record.enabled as Partial<Record<string, unknown>>)
      : {},
  );
  return { enabled, tree: reconcileSubwindowTree(tree, enabled), mapTileMode: parseMapTileMode(record.mapTileMode) };
}

export function setSubwindowEnabled(state: SubwindowState, id: SubwindowId, enabled: boolean): SubwindowState {
  const nextEnabled = { ...state.enabled, [id]: enabled };
  return { ...state, enabled: nextEnabled, tree: reconcileSubwindowTree(state.tree, nextEnabled) };
}

/**
 * A mod's own named block of pref-file content, carried alongside (never
 * inside) `neo-subwindows`'s own JSON (neo-angband#262). `serialize` returns
 * this block's current text, or null to leave it out of a dump entirely (a
 * mod with nothing worth saving right now); `parse` is its inverse and
 * returns null for anything malformed, the same contract
 * parseSubwindowStateJson already keeps; `apply` is called only with a value
 * `parse` itself accepted.
 */
export interface SubwindowPrefBlock<T = unknown> {
  serialize(): string | null;
  parse(text: string): T | null;
  apply(value: T): void;
}

const subwindowPrefBlocks = new Map<string, SubwindowPrefBlock>();

/**
 * Register (or replace) one named block. Re-registering an in-use name
 * replaces it outright - the same "last one wins" rule the subwindow shell's
 * `addControl` already uses for a re-added key - rather than erroring, since
 * a mod re-registering its own block on reload (a hot-reload, a settings
 * change) is the ordinary case, not a collision to guard against. Returns an
 * unregister function that is a no-op once superseded by a later
 * registration under the same name.
 */
export function registerSubwindowPrefBlock<T>(name: string, block: SubwindowPrefBlock<T>): () => void {
  subwindowPrefBlocks.set(name, block as SubwindowPrefBlock);
  return () => {
    if (subwindowPrefBlocks.get(name) === block) subwindowPrefBlocks.delete(name);
  };
}

/**
 * Every registered block's own `mod-block:<name>:<payload>` line, one per
 * block whose serialize() returned non-null text - appended alongside
 * dumpSubwindowLayoutPrefText's own line rather than folded into its JSON,
 * so a change here can never touch that parser (#262).
 */
export function dumpSubwindowPrefBlocks(): string {
  let out = "";
  for (const [name, block] of subwindowPrefBlocks) {
    const text = block.serialize();
    if (text === null) continue;
    out += `mod-block:${name}:${text}\n`;
  }
  return out;
}

/**
 * The inverse of dumpSubwindowPrefBlocks for one already-split `mod-block`
 * line. An unregistered name (that block's owning mod is not installed, or
 * not enabled, on this machine) or a payload the block's own parser rejects
 * is a silent no-op, exactly like an unrecognised pref directive - neither
 * can reach, or alter, core's own subwindow state (#262).
 */
export function applySubwindowPrefBlock(name: string, payload: string): void {
  const block = subwindowPrefBlocks.get(name);
  if (!block) return;
  let value: unknown;
  try {
    value = block.parse(payload);
  } catch {
    return;
  }
  if (value === null) return;
  block.apply(value);
}

interface ColoredChar {
  ch: string;
  color: string;
}

function flattenLine(line: ScreenLine): ColoredChar[] {
  const chars: ColoredChar[] = [];
  if (line.runs) {
    for (const run of line.runs) {
      for (const ch of run.text) chars.push({ ch, color: run.color });
    }
  } else {
    const color = line.color ?? UI_TEXT;
    for (const ch of line.text) chars.push({ ch, color });
  }
  return chars;
}

function coalesceToLine(chars: readonly ColoredChar[]): ScreenLine {
  if (chars.length === 0) return { text: "" };
  const runs: { text: string; color: string }[] = [];
  let text = "";
  for (const c of chars) {
    text += c.ch;
    const last = runs[runs.length - 1];
    if (last && last.color === c.color) last.text += c.ch;
    else runs.push({ text: c.ch, color: c.color });
  }
  // A single-colour row keeps the plain-text shape every caller already
  // builds, rather than always forcing the (equivalent) one-run shape.
  return runs.length === 1 ? { text, color: runs[0]!.color } : { text, runs };
}

/**
 * Word-wrap one logical line to `cols`-wide physical rows (neo-angband#258),
 * preserving per-character colour across the split. A run of non-space
 * characters longer than `cols` on its own is hard-split rather than left
 * overflowing, the way a single very long token has to be somewhere.
 */
function wrapScreenLine(line: ScreenLine, cols: number): ScreenLine[] {
  if (cols <= 0) return [line];
  const chars = flattenLine(line);
  if (chars.length <= cols) return [coalesceToLine(chars)];

  const words: ColoredChar[][] = [];
  let current: ColoredChar[] = [];
  for (const c of chars) {
    if (c.ch === " ") {
      if (current.length > 0) {
        words.push(current);
        current = [];
      }
    } else {
      current.push(c);
    }
  }
  if (current.length > 0) words.push(current);

  const rows: ColoredChar[][] = [];
  let row: ColoredChar[] = [];
  for (const word of words) {
    const sepLen = row.length > 0 ? 1 : 0;
    if (word.length > cols) {
      if (row.length > 0) {
        rows.push(row);
        row = [];
      }
      let i = 0;
      while (i < word.length) {
        const take = word.slice(i, i + cols);
        i += take.length;
        if (i < word.length) rows.push(take);
        else row = take;
      }
      continue;
    }
    if (row.length + sepLen + word.length > cols) {
      rows.push(row);
      row = [...word];
    } else {
      if (sepLen) row.push({ ch: " ", color: word[0]!.color });
      row.push(...word);
    }
  }
  if (row.length > 0) rows.push(row);
  return rows.length > 0 ? rows.map(coalesceToLine) : [{ text: "" }];
}

/**
 * A tiled panel's scroll position, in wrapped physical rows, as a signed
 * offset from its natural default anchor (the newest rows for a
 * bottom-anchored panel, the first rows otherwise) - not an absolute row
 * index, so a panel whose content has since shrunk or grown still lands
 * somewhere sane without this needing to track it. Keyed by each panel's own
 * stable term instance (main.ts's subwindowTerms never recreates one across
 * repaints) rather than threaded through paintSubwindowLines' dozen-odd
 * callers, since only the scroll gesture itself needs to reach this (#258).
 */
const scrollOffsets = new WeakMap<GridSurface, number>();

/** Scroll a tiled text panel by `deltaRows` physical rows (mouse wheel). The
 * offset self-clamps against the panel's actual wrapped content on its next
 * repaint, so this never needs to know the panel's current line count. */
export function scrollSubwindow(term: GridSurface, deltaRows: number): void {
  scrollOffsets.set(term, (scrollOffsets.get(term) ?? 0) + deltaRows);
}

/** The raw, not-yet-clamped scroll delta a caller with its own repaint cache
 * (MessageSubwindowPainter) needs in its cache key, so scrolling a panel
 * whose content has not otherwise changed still triggers a repaint. */
function peekSubwindowScroll(term: GridSurface): number {
  return scrollOffsets.get(term) ?? 0;
}

/** Paint styled terminal rows, optionally anchored to the bottom of the term.
 * Lines wider than the term wrap to further physical rows instead of being
 * cut off, and the whole wrapped result scrolls per scrollSubwindow (#258). */
export function paintSubwindowLines(
  term: GridSurface,
  lines: readonly ScreenLine[],
  bottom = false,
): void {
  const { cols, rows } = term.size();
  term.clear();
  const wrapped = lines.flatMap((line) => wrapScreenLine(line, cols));
  const maxTop = Math.max(0, wrapped.length - rows);
  const defaultTop = bottom ? maxTop : 0;
  const delta = scrollOffsets.get(term) ?? 0;
  const top = Math.max(0, Math.min(maxTop, defaultTop + delta));
  scrollOffsets.set(term, top - defaultTop);
  const visible = wrapped.slice(top, top + rows);
  // A bottom-anchored panel with fewer wrapped rows than it has room for
  // (the common case: a handful of messages in a tall message log) pins
  // that content to the bottom of the panel rather than its top.
  const rowOffset = bottom ? Math.max(0, rows - visible.length) : 0;
  visible.forEach((line, index) => {
    const y = rowOffset + index;
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
  private paintedScroll = 0;

  paint(term: GridSurface, log: MessageLog): void {
    const all = log.all();
    const newest = all[all.length - 1] ?? null;
    const newestText = newest ? format(newest) : "";
    const { cols, rows } = term.size();
    const scroll = peekSubwindowScroll(term);
    /* Idle animation frames repaint the game but upstream updates this term
     * only on EVENT_STATE. Do not turn a fresh red message back to its ordinary
     * colour merely because another canvas requested a frame. The scroll
     * check is what makes wheel-scrolling this panel (#258) actually repaint
     * it when the log itself has not changed since the last frame. */
    if (
      newest === this.paintedNewest &&
      newestText === this.paintedNewestText &&
      all.length === this.paintedLength &&
      cols === this.paintedCols &&
      rows === this.paintedRows &&
      scroll === this.paintedScroll
    ) {
      return;
    }
    // The whole log, not just the newest `rows`: paintSubwindowLines wraps
    // and scrolls now (#258), so scrolling back needs real history to scroll
    // into rather than only ever the most recent screenful.
    const newestFirst = [...all].reverse();
    let fresh = true;
    const lines = newestFirst
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
    this.paintedScroll = scroll;
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
  quiverItemization = false,
): void {
  const { cols } = term.size();
  paintSubwindowLines(term, inventorySubwindowLines(state, cols, constants, quiverItemization));
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

/** PW_MAP / PW_OVERHEAD: miniature with optional foreground and terrain tiles. */
export function paintOverviewSubwindow(term: GridSurface, overview: Overview | null, graphics = false): void {
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
      term.put(originX + col, originY + row, {
        ch: glyph.ch, fg: glyph.css,
        ...(graphics && glyph.tile ? { tile: glyph.tile } : {}),
        ...(graphics && glyph.bgTile ? { bgTile: glyph.bgTile } : {}),
      });
    }
  }
  const player = overview.playerGlyph ?? { ch: "@", css: UI_TEXT };
  const px = originX + overview.playerCol;
  const py = originY + overview.playerRow;
  if (px >= 0 && py >= 0 && px < cols && py < rows) {
    const under = overview.cells[overview.playerRow]?.[overview.playerCol];
    const bgTile = under?.bgTile ?? under?.tile;
    term.put(px, py, {
      ch: player.ch, fg: player.css,
      ...(graphics && player.tile ? { tile: player.tile } : {}),
      ...(graphics && player.tile && bgTile ? { bgTile } : {}),
    });
  }
  term.hideCursor();
}
