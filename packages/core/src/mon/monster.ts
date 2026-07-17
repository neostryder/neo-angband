/**
 * Live monster instances, ported from struct monster in
 * reference/src/monster.h, plus the energy table from
 * reference/src/game-world.c (Angband 4.2.6).
 *
 * World coupling is kept to numeric handles: held and mimicked objects are
 * object handles (0 = none) and the grid is a plain Loc. The chunk-side
 * bookkeeping (midx assignment, square occupancy) happens at placement,
 * which is deferred to the world integration.
 */

import { FlagSet } from "../bitflag";
import type { Loc } from "../loc";
import { loc } from "../loc";
import { MON_TMD } from "../generated";
import type { GameObject } from "../obj/object";
import { ELEM_MAX, OF_SIZE } from "../obj/types";
import { PF_SIZE } from "../player/types";
import type { MonsterGroupRole, MonsterRace } from "./types";
import { MFLAG_SIZE, MON_GROUP } from "./types";

/** enum monster_group_type. */
export const GROUP_TYPE = {
  PRIMARY: 0,
  SUMMON: 1,
} as const;
export const GROUP_MAX = 2;

/** struct monster_group_info. */
export interface MonsterGroupInfo {
  index: number;
  role: MonsterGroupRole;
}

/** Minimal struct target: a grid and/or a monster index. */
export interface MonsterTarget {
  grid: Loc;
  midx: number;
}

/**
 * monster.known_pstate (monster.h): what the monster has learned about the
 * player under birth_ai_learn - observed object flags, player (class/race)
 * flags and elemental resist levels. Written by update_smart_learn
 * (mon/spell.ts) and read by remove_bad_spells' unset_spells filter.
 */
export interface MonKnownPstate {
  /** of-flags observed on the player (OF_ index space). */
  flags: FlagSet;
  /** player flags observed (PF_ index space). */
  pflags: FlagSet;
  /** el_info[elem].res_level observed, indexed by ELEM_. */
  elInfo: Int16Array;
}

/** struct monster (monster.h), world references as numeric handles. */
export interface Monster {
  race: MonsterRace;
  /** Changed monster's original race, or null. */
  originalRace: MonsterRace | null;
  /** Index in the chunk monster list; 0 until placed. */
  midx: number;
  grid: Loc;
  hp: number;
  maxhp: number;
  /** Timed effects, indexed by MON_TMD_*. */
  mTimed: Int16Array;
  mspeed: number;
  energy: number;
  /** Current distance from the player. */
  cdis: number;
  /** Temporary MFLAG_* flags. */
  mflag: FlagSet;
  /** Object handle of the mimicked object (0 = none). */
  mimickedObj: number;
  /**
   * The monster's held objects (struct monster.held_obj), head-first: pile[0]
   * is the newest, exactly as upstream's pile_insert-prepended linked list.
   * Populated by monster_carry (mon/make.ts) - generated drops at death and
   * gold/items stolen by melee - and emptied by monster_death.
   */
  heldObj: GameObject[];
  /** Attr last used for drawing (0 = use race default). */
  attr: number;
  target: MonsterTarget;
  groupInfo: MonsterGroupInfo[];
  minRange: number;
  bestRange: number;
  /** known_pstate: the birth_ai_learn player-knowledge memory. */
  knownPstate: MonKnownPstate;
}

/** A zeroed monster of the given race (memset in place_new_monster_one). */
export function blankMonster(race: MonsterRace): Monster {
  const groupInfo: MonsterGroupInfo[] = [];
  for (let i = 0; i < GROUP_MAX; i++) {
    groupInfo.push({ index: 0, role: MON_GROUP.MEMBER });
  }
  return {
    race,
    originalRace: null,
    midx: 0,
    grid: loc(0, 0),
    hp: 0,
    maxhp: 0,
    mTimed: new Int16Array(MON_TMD.MAX),
    mspeed: 0,
    energy: 0,
    cdis: 0,
    mflag: new FlagSet(MFLAG_SIZE),
    mimickedObj: 0,
    heldObj: [],
    attr: 0,
    target: { grid: loc(0, 0), midx: 0 },
    groupInfo,
    minRange: 0,
    bestRange: 0,
    knownPstate: {
      flags: new FlagSet(OF_SIZE),
      pflags: new FlagSet(PF_SIZE),
      elInfo: new Int16Array(ELEM_MAX),
    },
  };
}

/**
 * extract_energy from game-world.c: energy gained per game turn by speed.
 * Indexed 0..199; standard speed 110 gains 10.
 */
export const EXTRACT_ENERGY: readonly number[] = [
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* S-50 */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* S-40 */ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /* S-30 */ 2, 2, 2, 2, 2, 2, 2, 3, 3, 3,
  /* S-20 */ 3, 3, 3, 3, 3, 4, 4, 4, 4, 4,
  /* S-10 */ 5, 5, 5, 5, 6, 6, 7, 7, 8, 9,
  /* Norm */ 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  /* F+10 */ 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  /* F+20 */ 30, 31, 32, 33, 34, 35, 36, 36, 37, 37,
  /* F+30 */ 38, 38, 39, 39, 40, 40, 40, 41, 41, 41,
  /* F+40 */ 42, 42, 42, 43, 43, 43, 44, 44, 44, 44,
  /* F+50 */ 45, 45, 45, 45, 45, 46, 46, 46, 46, 46,
  /* F+60 */ 47, 47, 47, 47, 47, 48, 48, 48, 48, 48,
  /* F+70 */ 49, 49, 49, 49, 49, 49, 49, 49, 49, 49,
  /* Fast */ 49, 49, 49, 49, 49, 49, 49, 49, 49, 49,
];

/**
 * turn_energy (game-world.c). moveEnergy is z_info->move_energy (100 in
 * the shipped constants.txt). Divergence: upstream indexes the table
 * unchecked; this port clamps speed to 0..199 to keep the lookup safe.
 */
export function turnEnergy(speed: number, moveEnergy = 100): number {
  const s = Math.min(Math.max(speed, 0), EXTRACT_ENERGY.length - 1);
  return Math.trunc(((EXTRACT_ENERGY[s] as number) * moveEnergy) / 100);
}
