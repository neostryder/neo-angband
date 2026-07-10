/**
 * The monster-list view model (mon-list.c).
 *
 * The presentation logic behind the "list visible monsters" panel, ported as
 * front-end-agnostic data: collect the visible monsters into per-race entries
 * split by line-of-sight vs. telepathy, tally the section totals, and expose
 * the standard sort orders and line colours. The terminal draw half
 * (ui-mon-list.c) is what each shell replaces; this module computes the rows
 * it draws.
 *
 * Divergence from upstream (ledgered in parity/ledger/game-mon-list.yaml): the
 * C code keeps a shared, lazily-reallocated instance sized to
 * cave_monster_max(); the port builds a fresh list each collect (the realloc
 * dance is a memory optimisation, not behaviour). LOS is decided with
 * projectable() exactly as upstream, which "cheats" so ESP-detected but
 * out-of-view monsters land in the telepathy section.
 */

import { MFLAG, RF } from "../generated";
import { MON_TMD } from "../generated";
import {
  COLOUR_RED,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "../color";
import { PROJECT, projectable } from "../world/project";
import { monsterIsCamouflaged, monsterIsVisible } from "../mon/predicate";
import type { MonsterRace } from "../mon/types";
import type { GameState } from "./context";

/** Which part of the list an entry's monsters fall under. */
export const MONSTER_LIST_SECTION_LOS = 0;
export const MONSTER_LIST_SECTION_ESP = 1;
export const MONSTER_LIST_SECTION_MAX = 2;

/** monster_list_entry_t: one distinct race, tallied per section. */
export interface MonsterListEntry {
  race: MonsterRace;
  /** Count in [LOS, ESP]. */
  count: [number, number];
  /** How many of those are asleep, per section. */
  asleep: [number, number];
  /** Offset from the player of the last-seen monster, per section (used only
   * when a section's count is 1). */
  dx: [number, number];
  dy: [number, number];
  /** Latest monster attr for flicker animation; 0 = use the race glyph. */
  attr: number;
}

/** monster_list_t: the collected, optionally-sorted set of entries. */
export interface MonsterList {
  entries: MonsterListEntry[];
  distinctEntries: number;
  creationTurn: number;
  sorted: boolean;
  /** Distinct races with a monster in [LOS, ESP]. */
  totalEntries: [number, number];
  /** Total monsters in [LOS, ESP]. */
  totalMonsters: [number, number];
}

/** monster_list_reset: an empty list. */
export function monsterListNew(): MonsterList {
  return {
    entries: [],
    distinctEntries: 0,
    creationTurn: 0,
    sorted: false,
    totalEntries: [0, 0],
    totalMonsters: [0, 0],
  };
}

/**
 * monster_list_collect (mon-list.c L138): gather the visible, non-camouflaged
 * monsters of the live cave into per-race entries.
 */
export function monsterListCollect(state: GameState): MonsterList {
  const list = monsterListNew();
  const pgrid = state.actor.grid;

  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;

    /* Only consider visible, known monsters. */
    if (!monsterIsVisible(mon) || monsterIsCamouflaged(mon)) continue;

    /* Find or add the entry for this race. */
    let entry = list.entries.find((e) => e.race === mon.race);
    if (!entry) {
      entry = {
        race: mon.race,
        count: [0, 0],
        asleep: [0, 0],
        dx: [0, 0],
        dy: [0, 0],
        attr: 0,
      };
      list.entries.push(entry);
    }

    /* Always collect the latest attr so flicker animation works. */
    entry.attr = mon.attr;

    /*
     * Check for LOS. Upstream uses projectable() rather than MFLAG_VIEW so
     * ESP-detected but out-of-view monsters are still targetable and land in
     * the LOS section when a bolt could reach them.
     */
    const los = projectable(
      state.chunk,
      pgrid,
      mon.grid,
      PROJECT.NONE,
      state.z.maxRange,
    );
    const field = los ? MONSTER_LIST_SECTION_LOS : MONSTER_LIST_SECTION_ESP;
    entry.count[field]!++;

    if (mon.mTimed[MON_TMD.SLEEP]! > 0) entry.asleep[field]!++;

    /* Offset from the player; used for counts of 1. */
    entry.dx[field] = mon.grid.x - pgrid.x;
    entry.dy[field] = mon.grid.y - pgrid.y;
  }

  /* Collect totals. */
  for (const e of list.entries) {
    if (e.count[MONSTER_LIST_SECTION_LOS]! > 0)
      list.totalEntries[MONSTER_LIST_SECTION_LOS]++;
    if (e.count[MONSTER_LIST_SECTION_ESP]! > 0)
      list.totalEntries[MONSTER_LIST_SECTION_ESP]++;
    list.totalMonsters[MONSTER_LIST_SECTION_LOS] +=
      e.count[MONSTER_LIST_SECTION_LOS]!;
    list.totalMonsters[MONSTER_LIST_SECTION_ESP] +=
      e.count[MONSTER_LIST_SECTION_ESP]!;
    list.distinctEntries++;
  }

  list.creationTurn = state.turn;
  list.sorted = false;
  return list;
}

/** A comparator over collected entries (qsort semantics: <0, 0, >0). */
export type MonsterListCompare = (
  a: MonsterListEntry,
  b: MonsterListEntry,
) => number;

/**
 * monster_list_standard_compare (mon-list.c L228): sort by depth (level)
 * descending. Ties are left in place.
 */
export function monsterListStandardCompare(
  a: MonsterListEntry,
  b: MonsterListEntry,
): number {
  if (a.race.level > b.race.level) return -1;
  if (a.race.level < b.race.level) return 1;
  return 0;
}

/**
 * monster_list_compare_exp (mon-list.c L250): sort by experience yielded,
 * descending. Needs the player level, so it is a factory.
 */
export function monsterListCompareExp(playerLev: number): MonsterListCompare {
  return (a, b) => {
    const aExp = Math.trunc((a.race.mexp * a.race.level) / playerLev);
    const bExp = Math.trunc((b.race.mexp * b.race.level) / playerLev);
    if (aExp > bExp) return -1;
    if (aExp < bExp) return 1;
    return 0;
  };
}

/**
 * monster_list_sort (mon-list.c L278): stable-sort the entries in place with
 * the given comparator (no-op for 0/1 entries). Sets the sorted flag.
 */
export function monsterListSort(
  list: MonsterList,
  compare: MonsterListCompare,
): void {
  if (list.sorted) return;
  if (list.distinctEntries <= 1) return;
  /* Array.prototype.sort is stable, matching upstream's stable sort(). */
  list.entries.sort(compare);
  list.sorted = true;
}

/**
 * monster_list_entry_line_color (mon-list.c L304): uniques violet, over-depth
 * monsters red, everything else white.
 */
export function monsterListEntryLineColor(
  entry: MonsterListEntry,
  playerDepth: number,
): number {
  if (entry.race.flags.has(RF.UNIQUE)) return COLOUR_VIOLET;
  if (entry.race.level > playerDepth) return COLOUR_RED;
  return COLOUR_WHITE;
}
