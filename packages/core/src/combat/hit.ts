/**
 * Shared to-hit and critical-hit machinery, ported VERBATIM from
 * reference/src/player-attack.c and reference/src/mon-attack.c (Angband
 * 4.2.6), with the critical constant tables from
 * reference/lib/gamedata/constants.txt.
 *
 * This module ports the DEFAULT (non-O) combat path: test_hit / hit_chance,
 * the melee/ranged critical chance-and-power formulas, and the critical-level
 * cutoff tables. The alternative "O-combat" path (birth_percent_damage:
 * o_critical_melee / o_critical_shot and their constants) is DEFERRED and
 * ledgered; it is a birth option, off by default.
 *
 * All integer arithmetic reproduces C semantics (Math.trunc for the C `/`).
 */

import type { RandomChance, Rng } from "../rng";
import { MON_TMD } from "../generated";

/** Adjust BTH per plus-to-hit (player.h BTH_PLUS_ADJ). */
export const BTH_PLUS_ADJ = 3;

/** Percentage reduction in accuracy for a stunned combatant (mon-timed.h). */
export const STUN_HIT_REDUCTION = 25;

/** Percentage reduction in damage for a stunned combatant (mon-timed.h). */
export const STUN_DAM_REDUCTION = 25;

/**
 * The message key a hit resolves to. These match the upstream MSG_ names used
 * by the melee/ranged hit_types tables (player-attack.c); the combat code
 * returns the key and leaves message text/formatting to the UI layer.
 */
export type HitType =
  | "MISS"
  | "HIT"
  | "HIT_GOOD"
  | "HIT_GREAT"
  | "HIT_SUPERB"
  | "HIT_HI_GREAT"
  | "HIT_HI_SUPERB"
  | "SHOOT_HIT";

/* ------------------------------------------------------------------ *
 * test_hit / hit_chance (player-attack.c)
 * ------------------------------------------------------------------ */

const HUNDRED_PCT = 10000;
const ALWAYS_HIT = 1200;
const ALWAYS_MISS = 500;

/**
 * hit_chance: the likelihood of a hit roll succeeding for the given to_hit and
 * ac. Scaled to a denominator of 10,000 to avoid rounding error.
 *
 * Always hit 12% of the time, always miss 5% of the time, floor the to-hit at
 * 9, roll 0..to_hit, and require the roll to reach ac*2/3.
 */
export function hitChance(toHit: number, ac: number): RandomChance {
  /* Put a floor on the to_hit */
  const th = Math.max(9, toHit);

  /* Calculate the hit percentage */
  let numerator = Math.max(0, th - Math.trunc((ac * 2) / 3));
  const denominator = th;

  /* Convert the ratio to a scaled percentage */
  numerator = Math.trunc((HUNDRED_PCT * numerator) / denominator);

  /* The calculated rate only applies when the guaranteed hit/miss don't */
  numerator = Math.trunc(
    (numerator * (HUNDRED_PCT - ALWAYS_MISS - ALWAYS_HIT)) / HUNDRED_PCT,
  );

  /* Add in the guaranteed hit */
  numerator += ALWAYS_HIT;

  return { numerator, denominator: HUNDRED_PCT };
}

/**
 * test_hit: determine if a hit roll succeeds against the target AC. Uses the
 * port's random_chance_check (rng.randomChanceCheck), which is the faithful
 * WELL-stream equivalent of upstream random_chance_check.
 */
export function testHit(rng: Rng, toHit: number, ac: number): boolean {
  return rng.randomChanceCheck(hitChance(toHit, ac));
}

/**
 * Success percentage (0..100) for the given to_hit and ac, derived from
 * hit_chance. Upstream ui-player.c reports the same ratio (numerator / 100).
 */
export function getHitChance(toHit: number, ac: number): number {
  return Math.trunc(hitChance(toHit, ac).numerator / 100);
}

/* ------------------------------------------------------------------ *
 * Debuff check (player-attack.c is_debuffed)
 * ------------------------------------------------------------------ */

/** Minimal monster shape the crit code reads (its timed-effect array). */
export interface DebuffTarget {
  mTimed: Int16Array;
}

/**
 * is_debuffed: whether a monster is confused, held, afraid or stunned - any
 * of which makes a critical hit more likely.
 */
export function isDebuffed(mon: DebuffTarget): boolean {
  return (
    (mon.mTimed[MON_TMD.CONF] ?? 0) > 0 ||
    (mon.mTimed[MON_TMD.HOLD] ?? 0) > 0 ||
    (mon.mTimed[MON_TMD.FEAR] ?? 0) > 0 ||
    (mon.mTimed[MON_TMD.STUN] ?? 0) > 0
  );
}

/* ------------------------------------------------------------------ *
 * Critical constant tables (constants.txt)
 * ------------------------------------------------------------------ */

/** One critical severity level (constants.txt *-critical-level lines). */
export interface CriticalLevel {
  /** Power cutoff; the last level uses -1 as the catch-all sentinel. */
  cutoff: number;
  /** Damage multiplier applied to the base damage. */
  mult: number;
  /** Flat damage added. */
  add: number;
  /** Message key for this severity. */
  msg: HitType;
}

/** melee-critical chance/power scale factors (constants.txt). */
export const MELEE_CRIT = {
  debuffToh: 10,
  chanceWeightScl: 1,
  chanceTohScl: 5,
  chanceLevelScl: 0,
  chanceTohSkillScl: 1,
  chanceOffset: -60,
  chanceRange: 5000,
  powerWeightScl: 1,
  powerRandom: 650,
} as const;

/** melee-critical-level cutoffs (constants.txt), in file order (head first). */
export const MELEE_CRIT_LEVELS: readonly CriticalLevel[] = [
  { cutoff: 400, mult: 2, add: 5, msg: "HIT_GOOD" },
  { cutoff: 700, mult: 2, add: 10, msg: "HIT_GREAT" },
  { cutoff: 900, mult: 3, add: 15, msg: "HIT_SUPERB" },
  { cutoff: 1300, mult: 3, add: 20, msg: "HIT_HI_GREAT" },
  { cutoff: -1, mult: 4, add: 20, msg: "HIT_HI_SUPERB" },
];

/** ranged-critical chance/power scale factors (constants.txt). */
export const RANGED_CRIT = {
  debuffToh: 10,
  chanceWeightScl: 1,
  chanceTohScl: 4,
  chanceLevelScl: 2,
  chanceLaunchedTohSkillScl: 0,
  chanceThrownTohSkillScl: 0,
  chanceOffset: 0,
  chanceRange: 5000,
  powerWeightScl: 1,
  powerRandom: 500,
} as const;

/** ranged-critical-level cutoffs (constants.txt), in file order. */
export const RANGED_CRIT_LEVELS: readonly CriticalLevel[] = [
  { cutoff: 500, mult: 2, add: 5, msg: "HIT_GOOD" },
  { cutoff: 1000, mult: 2, add: 10, msg: "HIT_GREAT" },
  { cutoff: -1, mult: 3, add: 15, msg: "HIT_SUPERB" },
];

/**
 * Walk the critical-level list for a given power, exactly as the upstream
 * `while (power >= this_l->cutoff && this_l->next) this_l = this_l->next`.
 * The head level is the "below the first cutoff" bucket; each cutoff is the
 * threshold to advance to the next, sharper level; the final entry (cutoff
 * -1) is the catch-all.
 */
export function selectCritLevel(
  power: number,
  levels: readonly CriticalLevel[],
): CriticalLevel {
  let i = 0;
  const last = levels.length - 1;
  while (i < last && power >= (levels[i] as CriticalLevel).cutoff) {
    i++;
  }
  return levels[i] as CriticalLevel;
}

/* ------------------------------------------------------------------ *
 * critical_melee / critical_shot (player-attack.c)
 * ------------------------------------------------------------------ */

/** The player_state fields the critical formulas read. */
export interface CritActor {
  /** Player level (p->lev). */
  lev: number;
  /** state->to_h. */
  toH: number;
  /** state->skills[SKILL_TO_HIT_MELEE]. */
  meleeSkill: number;
  /** state->skills[SKILL_TO_HIT_BOW]. */
  bowSkill: number;
  /** state->skills[SKILL_TO_HIT_THROW]. */
  throwSkill: number;
}

/** Result of a critical calculation: the (possibly) boosted damage + message. */
export interface CritResult {
  damage: number;
  msg: HitType;
}

/**
 * critical_melee: factor weapon weight, total plusses and player level into a
 * chance of a critical, then a power that selects a severity level.
 *
 * NB: in 4.2.6 the melee critical is critical_melee(); earlier releases named
 * the equivalent routine critical_norm(). criticalMelee is the faithful port.
 */
export function criticalMelee(
  rng: Rng,
  actor: CritActor,
  mon: DebuffTarget,
  weight: number,
  plus: number,
  dam: number,
): CritResult {
  let toH = actor.toH + plus;
  if (isDebuffed(mon)) toH += MELEE_CRIT.debuffToh;

  const chance =
    MELEE_CRIT.chanceWeightScl * weight +
    MELEE_CRIT.chanceTohScl * toH +
    MELEE_CRIT.chanceLevelScl * actor.lev +
    MELEE_CRIT.chanceTohSkillScl * actor.meleeSkill +
    MELEE_CRIT.chanceOffset;

  if (rng.randint1(MELEE_CRIT.chanceRange) > chance) {
    return { damage: dam, msg: "HIT" };
  }

  const power =
    MELEE_CRIT.powerWeightScl * weight + rng.randint1(MELEE_CRIT.powerRandom);
  const level = selectCritLevel(power, MELEE_CRIT_LEVELS);
  return { damage: level.add + level.mult * dam, msg: level.msg };
}

/**
 * critical_shot: as critical_melee but for shooting/throwing. `launched` is
 * true for a launcher shot, false for a thrown object. The non-critical
 * message is SHOOT_HIT (not HIT).
 */
export function criticalShot(
  rng: Rng,
  actor: CritActor,
  mon: DebuffTarget,
  weight: number,
  plus: number,
  dam: number,
  launched: boolean,
): CritResult {
  let toH = actor.toH + plus;
  if (isDebuffed(mon)) toH += RANGED_CRIT.debuffToh;

  let chance =
    RANGED_CRIT.chanceWeightScl * weight +
    RANGED_CRIT.chanceTohScl * toH +
    RANGED_CRIT.chanceLevelScl * actor.lev +
    RANGED_CRIT.chanceOffset;
  if (launched) {
    chance += RANGED_CRIT.chanceLaunchedTohSkillScl * actor.bowSkill;
  } else {
    chance += RANGED_CRIT.chanceThrownTohSkillScl * actor.throwSkill;
  }

  if (rng.randint1(RANGED_CRIT.chanceRange) > chance) {
    return { damage: dam, msg: "SHOOT_HIT" };
  }

  const power =
    RANGED_CRIT.powerWeightScl * weight + rng.randint1(RANGED_CRIT.powerRandom);
  const level = selectCritLevel(power, RANGED_CRIT_LEVELS);
  return { damage: level.add + level.mult * dam, msg: level.msg };
}
