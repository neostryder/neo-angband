/**
 * The object-list view model (obj-list.c).
 *
 * The presentation logic behind the "list visible objects" panel, ported as
 * front-end-agnostic data: one entry per floor object the player knows about,
 * split by line-of-sight vs. out-of-view, with the stack count, offset from
 * the player, sort order and line colour. The terminal draw half
 * (ui-obj-list.c) is replaced by each shell.
 *
 * Divergences from upstream (ledgered in parity/ledger/game-obj-list.yaml):
 *  - Upstream scans player->cave->objects (the fully memorised pile per grid).
 *    The port's reduced known model (game/known.ts) remembers only the pile
 *    head glyph, so the list is computed from the LIVE floor pile gated by a
 *    known-grid marker - the same "live cave, gated by knowledge" shape the
 *    monster list uses. A sensed-but-unidentified grid (null-glyph marker,
 *    from detection's square_sense_pile) yields one "unknown" entry.
 *  - object_desc is not ported yet, so entry names use the base-kind name
 *    approximation (objBaseName). Rich naming (flavours, ego/artifact names,
 *    pluralisation, the right-aligned prefix of object_list_format_name) is a
 *    separate #25 slice; the entry carries the real object so it drops in.
 */

import {
  COLOUR_L_RED,
  COLOUR_RED,
  COLOUR_SLATE,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "../color";
import { PROJECT, projectable } from "../world/project";
import { objBaseName } from "../obj/knowledge";
import { tvalIsMoney } from "../obj/object";
import type { GameObject } from "../obj/object";
import { knownObject } from "./known";
import type { GameState } from "./context";

/** Which part of the list an entry falls under. */
export const OBJECT_LIST_SECTION_LOS = 0;
export const OBJECT_LIST_SECTION_NO_LOS = 1;
export const OBJECT_LIST_SECTION_MAX = 2;

/** object_list_entry_t: one floor object (or a sensed-unknown marker). */
export interface ObjectListEntry {
  /** The live floor object, or null for a sensed-but-unidentified grid. */
  object: GameObject | null;
  /** is_unknown: the player senses something here but not what it is. */
  unknown: boolean;
  /** Stack count in [LOS, NO_LOS]. */
  count: [number, number];
  /** Offset from the player. */
  dx: number;
  dy: number;
}

/** object_list_t: the collected, optionally-sorted set of entries. */
export interface ObjectList {
  entries: ObjectListEntry[];
  distinctEntries: number;
  creationTurn: number;
  sorted: boolean;
  totalEntries: [number, number];
  totalObjects: [number, number];
}

/** object_list_reset: an empty list. */
export function objectListNew(): ObjectList {
  return {
    entries: [],
    distinctEntries: 0,
    creationTurn: 0,
    sorted: false,
    totalEntries: [0, 0],
    totalObjects: [0, 0],
  };
}

/**
 * object_list_collect (obj-list.c L156): gather the known floor objects of the
 * live cave into per-object entries, skipping ignored items and money.
 */
export function objectListCollect(state: GameState): ObjectList {
  const list = objectListNew();
  const pgrid = state.actor.grid;
  const w = state.chunk.width;

  /* Scan every remembered floor grid in a stable (grid-index) order. */
  const knownGrids = Array.from(state.known.objects.keys()).sort((a, b) => a - b);

  for (const idx of knownGrids) {
    const marker = state.known.objects.get(idx);
    if (!marker) continue;
    const grid = { x: idx % w, y: Math.floor(idx / w) };

    /* Determine which section this grid's objects are in. */
    const los =
      projectable(state.chunk, pgrid, grid, PROJECT.NONE, state.z.maxRange) ||
      (grid.x === pgrid.x && grid.y === pgrid.y);
    const field = los ? OBJECT_LIST_SECTION_LOS : OBJECT_LIST_SECTION_NO_LOS;

    if (marker.ch === null) {
      /* Sensed but unidentified: a single unknown entry, never ignored. */
      const entry: ObjectListEntry = {
        object: null,
        unknown: true,
        count: [0, 0],
        dx: grid.x - pgrid.x,
        dy: grid.y - pgrid.y,
      };
      entry.count[field] = 1;
      list.entries.push(entry);
      continue;
    }

    /* Known grid: list each live floor object here. */
    const pile = state.floor.get(idx);
    if (!pile) continue;
    for (const obj of pile) {
      /* Skip ignored items and money (obj-list.c object_list_should_ignore). */
      if (tvalIsMoney(obj.tval)) continue;
      if (state.isIgnored && state.isIgnored(obj)) continue;

      const entry: ObjectListEntry = {
        object: obj,
        unknown: false,
        count: [0, 0],
        dx: grid.x - pgrid.x,
        dy: grid.y - pgrid.y,
      };
      entry.count[field] = obj.number;
      list.entries.push(entry);
    }
  }

  /* Collect totals. */
  for (const e of list.entries) {
    if (e.count[OBJECT_LIST_SECTION_LOS]! > 0)
      list.totalEntries[OBJECT_LIST_SECTION_LOS]++;
    if (e.count[OBJECT_LIST_SECTION_NO_LOS]! > 0)
      list.totalEntries[OBJECT_LIST_SECTION_NO_LOS]++;
    list.totalObjects[OBJECT_LIST_SECTION_LOS] +=
      e.count[OBJECT_LIST_SECTION_LOS]!;
    list.totalObjects[OBJECT_LIST_SECTION_NO_LOS] +=
      e.count[OBJECT_LIST_SECTION_NO_LOS]!;
    list.distinctEntries++;
  }

  list.creationTurn = state.turn;
  list.sorted = false;
  return list;
}

/** A comparator over collected entries (qsort semantics). */
export type ObjectListCompare = (
  a: ObjectListEntry,
  b: ObjectListEntry,
) => number;

function distanceCompare(a: ObjectListEntry, b: ObjectListEntry): number {
  const ad = a.dy * a.dy + a.dx * a.dx;
  const bd = b.dy * b.dy + b.dx * b.dx;
  if (ad < bd) return -1;
  if (ad > bd) return 1;
  return 0;
}

/** compare_types (obj-util.c L629): order by tval, then sval. */
function compareTypes(a: GameObject, b: GameObject): number {
  if (a.tval === b.tval) return Math.sign(a.sval - b.sval);
  return Math.sign(a.tval - b.tval);
}

/**
 * object_list_standard_compare (obj-list.c L275) over compare_items
 * (obj-util.c L646), adapted to the port's awareness model: unknown items
 * last, known artifacts first, unaware-flavour kinds next, worthless kinds
 * after valuable ones, then by type; ties break nearest-to-farthest.
 */
export function objectListStandardCompare(
  state: GameState,
): ObjectListCompare {
  const aware = (o: GameObject) =>
    state.isAware ? state.isAware(o.kind) : true;
  const isArtifact = (o: GameObject) => o.artifact !== null;

  return (ea, eb) => {
    const ao = ea.object;
    const bo = eb.object;

    /* Unknown objects go at the end. */
    const au = ea.unknown || ao === null;
    const bu = eb.unknown || bo === null;
    if (au) return bu ? 0 : 1;
    if (bu) return -1;

    let result: number;
    /* Known artifacts sort first. */
    const aa = isArtifact(ao!);
    const ba = isArtifact(bo!);
    if (aa && ba) result = compareTypes(ao!, bo!);
    else if (aa) result = -1;
    else if (ba) result = 1;
    /* Unaware-flavour kinds sort next. */
    else if (!aware(ao!) && !aware(bo!)) result = compareTypes(ao!, bo!);
    else if (!aware(ao!)) result = -1;
    else if (!aware(bo!)) result = 1;
    /* Worthless kinds come after valuable ones. */
    else if (ao!.kind.cost === 0 && bo!.kind.cost !== 0) result = 1;
    else if (ao!.kind.cost !== 0 && bo!.kind.cost === 0) result = -1;
    else result = compareTypes(ao!, bo!);

    if (result === 0) result = distanceCompare(ea, eb);
    return result;
  };
}

/**
 * object_list_sort (obj-list.c L297): stable-sort the entries in place (no-op
 * for 0/1 entries). Sets the sorted flag.
 */
export function objectListSort(
  list: ObjectList,
  compare: ObjectListCompare,
): void {
  if (list.sorted) return;
  if (list.distinctEntries <= 1) return;
  list.entries.sort(compare);
  list.sorted = true;
}

/**
 * object_list_entry_line_attribute (obj-list.c L323): unknown red, known
 * artifact violet, unaware-flavour light red, worthless slate, else white.
 */
export function objectListEntryLineAttribute(
  entry: ObjectListEntry,
  state: GameState,
): number {
  const obj = entry.object;
  if (entry.unknown || obj === null) return COLOUR_RED;
  if (obj.artifact !== null) return COLOUR_VIOLET;
  if (state.isAware && !state.isAware(obj.kind)) return COLOUR_L_RED;
  if (obj.kind.cost === 0) return COLOUR_SLATE;
  return COLOUR_WHITE;
}

/**
 * object_list_format_name (obj-list.c L364), reduced: the display name for an
 * entry. Full object_desc (flavours, ego/artifact names, pluralisation) and
 * the terminal right-aligned prefix are deferred; this returns the base-kind
 * name with the accumulated stack count, front-end-agnostic.
 */
export function objectListEntryName(entry: ObjectListEntry): string {
  if (entry.unknown || entry.object === null) return "(unknown)";
  const n = (entry.count[OBJECT_LIST_SECTION_LOS] || 0) +
    (entry.count[OBJECT_LIST_SECTION_NO_LOS] || 0);
  const name = objBaseName(entry.object);
  return n > 1 ? `${n} ${name}` : name;
}
