/**
 * The chest pval/trap model, ported from reference/src/obj-chest.c and the
 * chest trap data (reference/lib/gamedata/chest_trap.txt), Angband 4.2.6.
 *
 * A chest's 16-bit pval encodes both its lock and its traps (obj-chest.c
 * L37-51):
 * - pval == 0: an empty chest.
 * - pval == 1: locked, no traps.
 * - pval > 1: locked and trapped - each set bit besides the lowest is a
 *   different trap (traps may overlap).
 * - pval < 0: disarmed/unlocked (unlock_chest simply negates the pval).
 * The pval magnitude also sets the disarm/lock-pick difficulty.
 *
 * This module holds the trap table and the pure (Rng + GameObject only)
 * chest-model helpers - pval generation, predicates and the trap-name
 * description. The GameState-dependent runtime (chest_check, chest_trap,
 * chest_death, do_cmd_open_chest, do_cmd_disarm_chest) lives in
 * game/chest.ts alongside its sibling trap.ts, since it needs floor piles,
 * the effect interpreter and player state.
 *
 * The 7 chest_trap.txt entries are hardcoded here (fixed, small, and
 * unlikely to change); a future data-driven parser is a moddability
 * follow-up, not required for this port.
 */

import type { Rng } from "../rng";
import type { EffectRecordJson } from "./types";
import type { GameObject } from "./object";
import { tvalIsChest } from "./object";

/** enum chest_query (obj-chest.h): what chest_check/count_chests look for. */
export const CHEST_QUERY = {
  ANY: 0,
  OPENABLE: 1,
  TRAPPED: 2,
} as const;
export type ChestQuery = (typeof CHEST_QUERY)[keyof typeof CHEST_QUERY];

/** struct chest_trap (obj-chest.h): one entry in chest_trap.txt. */
export interface ChestTrapEntry {
  name: string;
  /** The pval bit this trap sets/checks. */
  pval: number;
  /** Minimum chest object level for this trap to be picked. */
  level: number;
  magic: boolean;
  destroy: boolean;
  msg: string | null;
  msgDeath: string | null;
  effect: readonly EffectRecordJson[];
}

/**
 * chest_traps (chest_trap.txt), in file order. Index 0 is the "locked, no
 * trap" sentinel (pval 1); parse_chest_trap_name assigns each subsequent
 * pval as double the previous one (1, 2, 4, 8, 16, 32, 64).
 */
export const CHEST_TRAPS: readonly ChestTrapEntry[] = [
  {
    name: "locked",
    pval: 1,
    level: 1,
    magic: false,
    destroy: false,
    msg: null,
    msgDeath: null,
    effect: [],
  },
  {
    name: "gas trap",
    pval: 2,
    level: 1,
    magic: false,
    destroy: false,
    msg: "A puff of green gas surrounds you!",
    msgDeath: null,
    effect: [{ eff: "TIMED_INC", type: "POISONED", dice: "10+d20" }],
  },
  {
    name: "poison needle",
    pval: 4,
    level: 2,
    magic: false,
    destroy: false,
    msg: "A small needle has pricked you!",
    msgDeath: "a poison needle",
    effect: [
      { eff: "DAMAGE", dice: "1d4" },
      { eff: "DRAIN_STAT", type: "STR" },
    ],
  },
  {
    name: "poison needle",
    pval: 8,
    level: 3,
    magic: false,
    destroy: false,
    msg: "A small needle has pricked you!",
    msgDeath: "a poison needle",
    effect: [
      { eff: "DAMAGE", dice: "1d4" },
      { eff: "DRAIN_STAT", type: "CON" },
    ],
  },
  {
    name: "summoning runes",
    pval: 16,
    level: 15,
    magic: true,
    destroy: false,
    msg: "You are enveloped in a cloud of smoke!",
    msgDeath: null,
    effect: [{ eff: "SUMMON", type: "ANY", dice: "2+1d3" }],
  },
  {
    name: "gas trap",
    pval: 32,
    level: 19,
    magic: false,
    destroy: false,
    msg: "A puff of yellow gas surrounds you!",
    msgDeath: null,
    effect: [{ eff: "TIMED_INC", type: "PARALYZED", dice: "10+d20" }],
  },
  {
    name: "explosion device",
    pval: 64,
    level: 25,
    magic: false,
    destroy: true,
    msg: "There is a sudden explosion! Everything inside the chest is destroyed!",
    msgDeath: "an exploding chest",
    effect: [{ eff: "DAMAGE", dice: "5d8" }],
  },
];

/** The traps after the "locked" sentinel (chest_traps->next in the C list). */
const PICKABLE_TRAPS: readonly ChestTrapEntry[] = CHEST_TRAPS.slice(1);

/**
 * pick_one_chest_trap (obj-chest.c L359): count traps after the "locked"
 * sentinel whose level <= level, randint0(count), then walk the SAME
 * unfiltered list decrementing pick each step and returning whichever entry
 * pick lands on - replicating upstream's exact quirk of not re-checking
 * level on the walk. Consumes exactly one randint0.
 *
 * The quirk is dormant for the shipped table (chest_trap.txt rule 2: traps
 * appear in ascending level order, so the count-qualifying entries are
 * always a prefix of the unfiltered walk) but is ported faithfully in case
 * a mod's table is not sorted. pickLevelGated is generic precisely so a
 * test can exercise that divergence with a synthetic, non-monotonic list.
 */
export function pickLevelGated<T extends { level: number }>(
  rng: Rng,
  level: number,
  list: readonly T[],
): T {
  let count = 0;
  for (const item of list) {
    if (item.level <= level) count++;
  }
  let pick = rng.randint0(count);
  let result: T = list[0] as T;
  for (const item of list) {
    if (pick === 0) {
      result = item;
      break;
    }
    pick--;
  }
  return result;
}

export function pickOneChestTrap(rng: Rng, level: number): number {
  return pickLevelGated(rng, level, PICKABLE_TRAPS).pval;
}

/**
 * pick_chest_traps (obj-chest.c L381): the pval (lock+trap bitmask) for a
 * freshly generated chest, keyed off the chest kind's object level. RNG
 * order (see the parity notes on this gap): a one_in_(10) short-circuit,
 * then the first pick, then level-gated second/third/fourth picks.
 */
export function pickChestTraps(rng: Rng, obj: GameObject): number {
  const level = obj.kind.level;
  let trap = 0;

  /* One in ten chance of no trap. */
  if (rng.oneIn(10)) return 1;

  /* Pick a trap, add it. */
  trap |= pickOneChestTrap(rng, level);

  /* Level dependent chance of a second trap (may overlap the first one). */
  if (level > 5 && rng.oneIn(1 + Math.trunc((65 - level) / 10))) {
    trap |= pickOneChestTrap(rng, level);
  }

  /* Chance of a third trap for deep chests (may overlap existing traps). */
  if (level > 45 && rng.oneIn(65 - level)) {
    trap |= pickOneChestTrap(rng, level);
    /* Small chance of a fourth trap (may overlap existing traps). */
    if (rng.oneIn(40)) {
      trap |= pickOneChestTrap(rng, level);
    }
  }

  return trap;
}

/** unlock_chest (obj-chest.c L414). */
export function unlockChest(obj: GameObject): void {
  obj.pval = -obj.pval;
}

/** is_trapped_chest (obj-chest.c L326). */
export function isTrappedChest(obj: GameObject): boolean {
  if (!tvalIsChest(obj.tval)) return false;
  if (obj.pval <= 0) return false;
  return obj.pval !== 1;
}

/** is_locked_chest (obj-chest.c L343). */
export function isLockedChest(obj: GameObject): boolean {
  if (!tvalIsChest(obj.tval)) return false;
  return obj.pval > 0;
}

/**
 * chest_trap_name (obj-chest.c L297): a description of the chest's
 * lock/trap state - "unlocked"/"disarmed" once negative, the single
 * matching trap's name, "multiple traps" for an overlapping pval, or
 * "empty".
 */
export function chestTrapName(obj: GameObject): string {
  const value = obj.pval;
  if (value < 0) return value === -1 ? "unlocked" : "disarmed";
  if (value > 0) {
    let found: ChestTrapEntry | null = null;
    for (const trap of CHEST_TRAPS) {
      if (value & trap.pval) {
        if (found) return "multiple traps";
        found = trap;
      }
    }
    if (found) return found.name;
  }
  return "empty";
}
