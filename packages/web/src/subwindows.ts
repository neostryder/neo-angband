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
  t,
} from "@rpgm-tools/neo-angband-core";
import { parseDocument, serializeDocument, subwindowLayoutFormat } from "@rpgm-tools/neo-angband-mod-sdk";
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
import { looksLikeEnvelope, readStoredDocument, writeStoredDocument } from "./json-storage";
import { UI_DIM, UI_TEXT } from "./ui-colors";
import {
  MAIN_TILE_ID,
  containsLeaf,
  insertAtEdge,
  leafIds,
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
  /** Opaque payloads retained for mods that are not currently installed. */
  modBlocks?: Record<string, string>;
}

export const SUBWINDOW_STORAGE_KEY = "neo-angband:subwindows";
export const SUBWINDOW_DEFAULT_STORAGE_KEY = "neo-angband:subwindows:default";

/**
 * `label` is upstream's own window-flag name (ui-init.c window_flag_desc) and
 * titles the panel. `tab` is the short name a tab strip and the small-viewport
 * notice use, where every label starting with "Display" would truncate to the
 * same word.
 */
export const SUBWINDOW_CHOICES: readonly { id: SubwindowId; label: string; tab: string }[] = [
  { id: "inventory", label: "Display inven/equip", tab: "Inventory" },
  { id: "equipment", label: "Display equip/inven", tab: "Equipment" },
  { id: "player-basic", label: "Display player (basic)", tab: "Player" },
  { id: "player-extra", label: "Display player (extra)", tab: "Player (extra)" },
  { id: "player-compact", label: "Display player (compact)", tab: "Player (compact)" },
  { id: "map", label: "Display dungeon map", tab: "Map" },
  { id: "messages", label: "Display messages", tab: "Messages" },
  { id: "overhead", label: "Display overhead view", tab: "Overhead" },
  { id: "monster-recall", label: "Display monster recall", tab: "Monster recall" },
  { id: "object-recall", label: "Display object recall", tab: "Object recall" },
  { id: "monsters", label: "Display monster list", tab: "Monsters" },
  { id: "status", label: "Display status", tab: "Status" },
  { id: "items", label: "Display item list", tab: "Items" },
  { id: "player-topbar", label: "Display player (topbar)", tab: "Player (top bar)" },
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

/**
 * What a new install opens with (#287): every panel of the shipped Loth.prf
 * arrangement, tiled as `canonicalSubwindowTree` places them.
 */
export function firstLaunchSubwindowState(): SubwindowState {
  const tree = canonicalSubwindowTree();
  const enabled = blankSettings();
  for (const id of leafIds(tree)) {
    if (id !== MAIN_TILE_ID) enabled[id as SubwindowId] = true;
  }
  return { enabled, tree };
}

export function enabledSubwindowIds(settings: SubwindowSettings): SubwindowId[] {
  return SUBWINDOW_IDS.filter((id) => settings[id]);
}

/**
 * The notice for panels the small-viewport pass merged as tabs (#275, #287).
 * The shell reports only when the merged set changes, so a resize does not
 * repeat it.
 */
export function describeSubwindowsMerged(merges: readonly { id: string; into: string }[]): string {
  if (merges.length === 0) return "";
  const labelById = new Map<string, string>(SUBWINDOW_CHOICES.map((choice) => [choice.id, choice.tab]));
  const label = (id: string): string => labelById.get(id) ?? id;
  const pairs = merges.map((merge) => t(
    "subwindows.note.mergedPair",
    "{panel} with {other}",
    { panel: label(merge.id), other: label(merge.into) },
  )).join(", ");
  return t(
    "subwindows.note.merged",
    "The window is too small to show every panel side by side, so some now share a space as tabs: {pairs}. They separate again when the window has room.",
    { pairs },
  );
}

export function reconcileSubwindowTree(tree: LayoutNode, settings: SubwindowSettings): LayoutNode {
  const enabled = enabledSubwindowIds(settings);
  const keep = new Set<string>([MAIN_TILE_ID, ...enabled, ...leafIds(tree).filter((id) => /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(id) && !id.startsWith("core:"))]);
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

interface LayoutDocument {
  enabled: Record<string, boolean>;
  tree: LayoutNode;
  mapTileMode: number;
  modBlocks?: Record<string, string>;
}

function stateFromDocument(data: LayoutDocument): SubwindowState {
  const enabled = parseEnabled(data.enabled);
  const tree = parseLayoutTree(data.tree) ?? treeForSettings(enabled);
  return {
    enabled,
    tree: reconcileSubwindowTree(tree, enabled),
    mapTileMode: parseMapTileMode(data.mapTileMode),
    ...(data.modBlocks ? { modBlocks: data.modBlocks } : {}),
  };
}

function documentFromState(state: SubwindowState, modBlocks?: Record<string, string>): LayoutDocument {
  const enabled: Record<string, boolean> = {};
  for (const id of SUBWINDOW_IDS) enabled[id] = state.enabled[id];
  const document: LayoutDocument = {
    enabled,
    tree: state.tree,
    mapTileMode: parseMapTileMode(state.mapTileMode),
  };
  if (modBlocks && Object.keys(modBlocks).length > 0) document.modBlocks = modBlocks;
  return document;
}

/** The previous `v: 2` object, or the flat boolean map that came before it. */
function legacyLayout(raw: string): LayoutDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { v?: unknown } & Partial<Record<string, unknown>>;
  if (record.v === 2) {
    const enabled = parseEnabled(
      record.enabled && typeof record.enabled === "object"
        ? (record.enabled as Partial<Record<string, unknown>>)
        : record,
    );
    const tree = parseLayoutTree(record.tree) ?? treeForSettings(enabled);
    return documentFromState({
      enabled,
      tree: reconcileSubwindowTree(tree, enabled),
      mapTileMode: parseMapTileMode(record.mapTileMode),
    });
  }
  if (!SUBWINDOW_IDS.some((id) => typeof record[id] === "boolean")) return null;
  const enabled = parseEnabled(record);
  return documentFromState({ enabled, tree: treeForSettings(enabled) });
}

function storedModBlocks(storage: Pick<Storage, "getItem">, key: string): Record<string, string> | undefined {
  try {
    const raw = storage.getItem(key);
    if (!raw || !looksLikeEnvelope(raw)) return undefined;
    const parsed = parseDocument(raw, subwindowLayoutFormat);
    return parsed.ok ? parsed.data.modBlocks : undefined;
  } catch {
    return undefined;
  }
}

function mergedModBlocks(
  storage: Pick<Storage, "getItem">,
  key: string,
  seed?: Readonly<Record<string, string>>,
): Record<string, string> | undefined {
  const merged: Record<string, string> = seed ? { ...seed } : { ...storedModBlocks(storage, key) };
  for (const [name, block] of subwindowPrefBlocks) {
    try {
      const text = block.serialize();
      if (text === null) delete merged[name];
      else merged[name] = text;
    } catch {
      /* A failing mod leaves its prior payload intact. */
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** The JSON object a `neo-subwindows` line used to carry, before that line was retired. */
export function stateFromLayoutPayload(json: string): SubwindowState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Partial<Record<string, unknown>>;
  const enabled = parseEnabled(
    record.enabled && typeof record.enabled === "object"
      ? (record.enabled as Partial<Record<string, unknown>>)
      : {},
  );
  const tree = parseLayoutTree(record.tree);
  if (!tree) return null;
  return {
    enabled,
    tree: reconcileSubwindowTree(tree, enabled),
    mapTileMode: parseMapTileMode(record.mapTileMode),
  };
}

/** Write a layout, including mod-block payloads lifted out of an old preferences file. */
export function saveLayoutWithBlocks(state: SubwindowState | null, blocks: Readonly<Record<string, string>>): boolean {
  const base = state ?? { enabled: blankSettings(), tree: emptyLayoutTree(), mapTileMode: 0 };
  const modBlocks = Object.keys(blocks).length > 0 ? { ...blocks } : undefined;
  try {
    return writeStoredDocument(
      localStorage,
      SUBWINDOW_STORAGE_KEY,
      subwindowLayoutFormat,
      documentFromState(base, modBlocks),
    ) !== null;
  } catch {
    return false;
  }
}

export function readSubwindowState(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): SubwindowState {
  try {
    /* Nothing stored at all means a new install, which opens with the default
     * arrangement. A stored layout with every panel off is still a layout, so
     * that choice survives the next launch. */
    if (storage.getItem(SUBWINDOW_STORAGE_KEY) === null) return firstLaunchSubwindowState();
    const read = readStoredDocument(storage, SUBWINDOW_STORAGE_KEY, subwindowLayoutFormat, legacyLayout);
    if (!read.data) {
      const enabled = blankSettings();
      return { enabled, tree: emptyLayoutTree() };
    }
    const state = stateFromDocument(read.data);
    if (read.data.modBlocks) applyStoredModBlocks(read.data.modBlocks);
    return state;
  } catch {
    const enabled = blankSettings();
    return { enabled, tree: emptyLayoutTree() };
  }
}

type LayoutStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Read only the supported booleans; malformed or older data is harmless. */
export function readSubwindowSettings(storage: LayoutStorage): SubwindowSettings {
  return readSubwindowState(storage).enabled;
}

export function writeSubwindowState(storage: LayoutStorage, state: SubwindowState): void {
  const modBlocks = mergedModBlocks(storage, SUBWINDOW_STORAGE_KEY, state.modBlocks);
  writeStoredDocument(
    storage,
    SUBWINDOW_STORAGE_KEY,
    subwindowLayoutFormat,
    documentFromState(state, modBlocks),
  );
}

/** A missing, unreadable, or malformed personal default leaves the live layout intact. */
export function readSubwindowDefault(storage: LayoutStorage): SubwindowState | null {
  try {
    const read = readStoredDocument(
      storage,
      SUBWINDOW_DEFAULT_STORAGE_KEY,
      subwindowLayoutFormat,
      legacyLayout,
    );
    return read.data ? stateFromDocument(read.data) : null;
  } catch {
    return null;
  }
}

/** Preserve an all-disabled layout as a saved default, too. */
export function writeSubwindowDefault(storage: LayoutStorage, state: SubwindowState): boolean {
  try {
    const modBlocks = mergedModBlocks(storage, SUBWINDOW_STORAGE_KEY, state.modBlocks);
    return writeStoredDocument(
      storage,
      SUBWINDOW_DEFAULT_STORAGE_KEY,
      subwindowLayoutFormat,
      documentFromState(state, modBlocks),
    ) !== null;
  } catch {
    return false;
  }
}

/** Persist the display setting outside the character save, like window flags. */
export function writeSubwindowSettings(storage: LayoutStorage, settings: SubwindowSettings): void {
  writeSubwindowState(storage, { enabled: settings, tree: treeForSettings(settings) });
}

/**
 * The layout document a player can download. Registered mod blocks are
 * included; a block whose serialize() returns null is left out.
 */
export function serializeSubwindowDocument(state: SubwindowState): string {
  let blocks: Record<string, string> | undefined;
  try {
    blocks = mergedModBlocks(localStorage, SUBWINDOW_STORAGE_KEY, state.modBlocks);
  } catch {
    blocks = { ...state.modBlocks, ...liveModBlocks() };
  }
  return serializeDocument(subwindowLayoutFormat, documentFromState(state, blocks));
}

function liveModBlocks(): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const [name, block] of subwindowPrefBlocks) {
    try {
      const text = block.serialize();
      if (text !== null) merged[name] = text;
    } catch {
      /* An unrelated mod cannot block a layout export. */
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Read a layout document. Returns null when the text is not this document,
 * so a damaged file cannot replace the layout on screen.
 */
export function parseSubwindowDocument(text: string): (SubwindowState & { modBlocks?: Record<string, string> }) | null {
  const parsed = parseDocument(text, subwindowLayoutFormat);
  if (!parsed.ok) return null;
  const state = stateFromDocument(parsed.data);
  return parsed.data.modBlocks ? { ...state, modBlocks: parsed.data.modBlocks } : state;
}

export function setSubwindowEnabled(state: SubwindowState, id: SubwindowId, enabled: boolean): SubwindowState {
  const nextEnabled = { ...state.enabled, [id]: enabled };
  return { ...state, enabled: nextEnabled, tree: reconcileSubwindowTree(state.tree, nextEnabled) };
}

/**
 * A mod's named block of layout data. The payload is an opaque string kept
 * on the layout document under the block's name. `serialize` returns null
 * when the mod has nothing to store. `parse` returns null for a payload it
 * rejects, and `apply` runs only with a value `parse` accepted.
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
 *
 * If the stored layout already has a payload for this name, it is applied
 * now. Registration often happens after the layout was read.
 */
export function registerSubwindowPrefBlock<T>(name: string, block: SubwindowPrefBlock<T>): () => void {
  subwindowPrefBlocks.set(name, block as SubwindowPrefBlock);
  try {
    const raw = localStorage.getItem(SUBWINDOW_STORAGE_KEY);
    if (raw && looksLikeEnvelope(raw)) {
      const parsed = parseDocument(raw, subwindowLayoutFormat);
      const payload = parsed.ok ? parsed.data.modBlocks?.[name] : undefined;
      if (payload !== undefined) applySubwindowPrefBlock(name, payload);
    }
  } catch {
    /* Storage is absent in some tests, and a missing layout is not an error. */
  }
  return () => {
    if (subwindowPrefBlocks.get(name) === block) subwindowPrefBlocks.delete(name);
  };
}

/** Apply every stored mod block. An unknown name or a rejected payload is skipped. */
export function applyStoredModBlocks(blocks: Readonly<Record<string, string>>): void {
  for (const [name, payload] of Object.entries(blocks)) applySubwindowPrefBlock(name, payload);
}

/**
 * Apply one block payload. An unregistered name, or a payload the block's
 * parser rejects, is a silent no-op and cannot change the tiling tree.
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
  try {
    block.apply(value);
  } catch {
    /* A bad mod payload cannot stop the layout from loading. */
  }
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
export function paintMonsterSubwindow(
  term: GridSurface,
  state: GameState,
  colorKey = false,
): void {
  const { cols, rows } = term.size();
  paintSubwindowLines(term, monsterListSubwindowLines(state, rows, cols, colorKey));
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
