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
 *  - Entry names route through object_desc (describeObject), so flavours,
 *    ego/artifact names and the &/~ pluralisation gate exactly by the player's
 *    knowledge. Only the terminal right-aligned "%3.3s" prefix padding of the
 *    upstream draw code stays with each shell.
 */

import {
  COLOUR_L_RED,
  COLOUR_RED,
  COLOUR_SLATE,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "../color";
import { PROJECT, projectable } from "../world/project";
import { ODESC } from "../obj/desc";
import { OBJ_NOTICE } from "../obj/knowledge";
import { tvalIsMoney } from "../obj/object";
import type { GameObject } from "../obj/object";
import { describeObject } from "./describe";
import { modRuleEnabled } from "./context";
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

/**
 * Whether the object is known to the player to be an artifact. Upstream gates
 * this decision on the player's knowledge (obj->known->artifact, set by
 * object_touch when the item is ASSESSED - obj-list.c object_is_known_artifact
 * L336, compare_items obj-util.c L646-656), NOT on the raw obj->artifact. In
 * the port's knowledge model that is the object's OBJ_NOTICE.ASSESSED bit (see
 * objectKnownShadow in obj/known-object.ts). An unassessed floor artifact must
 * not colour violet / sort first while its list name still reads as an unknown
 * item.
 */
function isKnownArtifact(o: GameObject): boolean {
  return o.artifact !== null && (o.notice & OBJ_NOTICE.ASSESSED) !== 0;
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
  const isArtifact = isKnownArtifact;
  /* bug-fixes #4664 ("Object list is not always correctly ordered"): upstream's
   * compare_items (obj-util.c) is not a strict weak order for qsort, so the
   * list can come out unstable/wrong. The port's comparator is already a
   * lexicographic strict weak order and it feeds a STABLE Array.sort, so ties
   * keep collect order - but distance-only tiebreaks still leave distinct
   * entries at equal distance formally equivalent. With bugfix.objectListOrder
   * on, a deterministic geometric total-key tiebreak (dy then dx) makes the
   * order a strict TOTAL order that is stable even under a non-stable sort.
   * PR #4668 was closed unmerged, so there is no accepted upstream fix. */
  const totalKeyTiebreak = modRuleEnabled(state, "bugfix.objectListOrder");

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
    if (result === 0 && totalKeyTiebreak) {
      /* Deterministic geometric key: nearer-to-top first, then leftmost. */
      result = Math.sign(ea.dy - eb.dy) || Math.sign(ea.dx - eb.dx);
    }
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
  if (isKnownArtifact(obj)) return COLOUR_VIOLET;
  if (state.isAware && !state.isAware(obj.kind)) return COLOUR_L_RED;
  if (obj.kind.cost === 0) return COLOUR_SLATE;
  return COLOUR_WHITE;
}

/**
 * object_list_format_name (obj-list.c L364): the display name for an entry.
 * The accumulated stack count is passed through object_desc's ODESC_ALTNUM
 * mechanism (as upstream does) so the article / pluralisation reflect the
 * summed count, not the single pile's number. Names now gate exactly by the
 * player's knowledge (flavours, ego / artifact names, the &/~ grammar) via
 * describeObject. The terminal right-aligned "%3.3s" prefix padding of the
 * upstream draw code stays with each shell (front-end-agnostic).
 */
export function objectListEntryName(
  entry: ObjectListEntry,
  state: GameState,
): string {
  if (entry.unknown || entry.object === null) return "(unknown)";
  /* Only one section field is ever set at collect time; summing picks it. */
  const n = (entry.count[OBJECT_LIST_SECTION_LOS] || 0) +
    (entry.count[OBJECT_LIST_SECTION_NO_LOS] || 0);
  return describeObject(
    state,
    entry.object,
    ODESC.PREFIX | ODESC.FULL | ODESC.ALTNUM,
    n,
  );
}
