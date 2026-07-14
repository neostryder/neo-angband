/**
 * Shared to-hit and critical-hit machinery, ported VERBATIM from
 * reference/src/player-attack.c and reference/src/mon-attack.c (Angband
 * 4.2.6), with the critical constant tables from
 * reference/lib/gamedata/constants.txt.
 *
 * This module ports the DEFAULT (non-O) combat path: test_hit / hit_chance,
 * the melee/ranged critical chance-and-power formulas, and the critical-level
 * cutoff tables. It also ports the alternative "O-combat" path
 * (birth_percent_damage): o_critical_melee / o_critical_shot, the o-*-critical
 * constants (constants.txt), and apply_deadliness. The O path is a birth
 * option, off by default; oMeleeDamage / oRangedDamage (melee.ts / ranged.ts)
 * consume these behind that gate.
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

/* ------------------------------------------------------------------ *
 * O-combat criticals (player-attack.c o_critical_melee / o_critical_shot)
 *
 * The O path adds extra DICE (not a flat multiplier) on a critical, and
 * deadliness adds extra SIDES to each die. These constants are ported from
 * constants.txt (o-melee-critical* / o-ranged-critical*), the same values the
 * display estimate loads via z_info (constants.ts crit("o-melee-critical")).
 * ------------------------------------------------------------------ */

/** One O-combat critical severity level (constants.txt o-*-critical-level). */
export interface OCritLevel {
  /** one_in_(chance) to stop walking at this level (0 = never advances). */
  chance: number;
  /** Extra damage dice this level adds. */
  dice: number;
  /** Message key for this severity. */
  msg: HitType;
}

/** o-melee-critical scale factors (constants.txt). */
export const O_MELEE_CRIT = {
  debuffToh: 10,
  powerTohScaleNum: 1,
  powerTohScaleDen: 3,
  chancePowerScaleNum: 1,
  chancePowerScaleDen: 1,
  chanceAddDen: 240,
} as const;

/** o-melee-critical-level rows (constants.txt), head first. */
export const O_MELEE_CRIT_LEVELS: readonly OCritLevel[] = [
  { chance: 40, dice: 5, msg: "HIT_HI_SUPERB" },
  { chance: 12, dice: 4, msg: "HIT_HI_GREAT" },
  { chance: 3, dice: 3, msg: "HIT_SUPERB" },
  { chance: 2, dice: 2, msg: "HIT_GREAT" },
  { chance: 1, dice: 1, msg: "HIT_GOOD" },
];

/** o-ranged-critical scale factors (constants.txt). */
export const O_RANGED_CRIT = {
  debuffToh: 10,
  powerLaunchedTohScaleNum: 1,
  powerLaunchedTohScaleDen: 1,
  powerThrownTohScaleNum: 3,
  powerThrownTohScaleDen: 2,
  chancePowerScaleNum: 1,
  chancePowerScaleDen: 1,
  chanceAddDen: 360,
} as const;

/** o-ranged-critical-level rows (constants.txt), head first. */
export const O_RANGED_CRIT_LEVELS: readonly OCritLevel[] = [
  { chance: 50, dice: 3, msg: "HIT_SUPERB" },
  { chance: 10, dice: 2, msg: "HIT_GREAT" },
  { chance: 1, dice: 1, msg: "HIT_GOOD" },
];

/** Result of an O-combat critical: extra dice + the severity message. */
export interface OCritResult {
  addDice: number;
  msg: HitType;
}

/**
 * Walk the O-critical-level list, exactly as upstream
 * `while (this_l->next && !one_in_(this_l->chance)) this_l = this_l->next;`.
 * Draws one_in_ (a randint0) at each non-terminal level until it stops.
 */
function selectOCritLevel(
  rng: Rng,
  levels: readonly OCritLevel[],
): OCritResult {
  let i = 0;
  const last = levels.length - 1;
  while (i < last && !rng.oneIn((levels[i] as OCritLevel).chance)) {
    i++;
  }
  const lvl = levels[i] as OCritLevel;
  return { addDice: lvl.dice, msg: lvl.msg };
}

/**
 * o_critical_melee (player-attack.c L439): the crit-chance is a rational
 * a*power / (b*power + c); on success, walk the level list for the added dice.
 * `powerBase` is chance_of_melee_hit_base(p, obj) (computed by the caller).
 *
 * RNG: one randint1(chance_den) for the crit test, then (on a crit) the
 * one_in_ level walk. Non-crit returns msg SHOOT_HIT, faithful to upstream.
 */
export function oCriticalMelee(
  rng: Rng,
  powerBase: number,
  mon: DebuffTarget,
): OCritResult {
  let power = powerBase;
  if (isDebuffed(mon)) power += O_MELEE_CRIT.debuffToh;
  power = Math.trunc(
    (power * O_MELEE_CRIT.powerTohScaleNum) / O_MELEE_CRIT.powerTohScaleDen,
  );
  const chanceNum = power * O_MELEE_CRIT.chancePowerScaleNum;
  const chanceDen =
    power * O_MELEE_CRIT.chancePowerScaleDen + O_MELEE_CRIT.chanceAddDen;
  if (rng.randint1(chanceDen) <= chanceNum) {
    return selectOCritLevel(rng, O_MELEE_CRIT_LEVELS);
  }
  return { addDice: 0, msg: "SHOOT_HIT" };
}

/**
 * o_critical_shot (player-attack.c L351): as oCriticalMelee for shooting
 * (launched) / throwing. `powerBase` is chance_of_missile_hit_base(p, missile,
 * launcher). The power scale factor differs for launched vs thrown.
 */
export function oCriticalShot(
  rng: Rng,
  powerBase: number,
  mon: DebuffTarget,
  launched: boolean,
): OCritResult {
  let power = powerBase;
  if (isDebuffed(mon)) power += O_RANGED_CRIT.debuffToh;
  const num = launched
    ? O_RANGED_CRIT.powerLaunchedTohScaleNum
    : O_RANGED_CRIT.powerThrownTohScaleNum;
  const den = launched
    ? O_RANGED_CRIT.powerLaunchedTohScaleDen
    : O_RANGED_CRIT.powerThrownTohScaleDen;
  power = Math.trunc((power * num) / den);
  const chanceNum = power * O_RANGED_CRIT.chancePowerScaleNum;
  const chanceDen =
    power * O_RANGED_CRIT.chancePowerScaleDen + O_RANGED_CRIT.chanceAddDen;
  if (rng.randint1(chanceDen) <= chanceNum) {
    return selectOCritLevel(rng, O_RANGED_CRIT_LEVELS);
  }
  return { addDice: 0, msg: "SHOOT_HIT" };
}

/* ------------------------------------------------------------------ *
 * apply_deadliness (player-attack.c L231/L261)
 *
 * Ported faithfully here (rather than reused) because obj/object-info.ts - the
 * display estimate's home for the same table - imports from this combat module,
 * so combat cannot import back from it without a cycle. Both copies are
 * verified against the constants; keep them in step.
 * ------------------------------------------------------------------ */

/** deadliness_conversion[151] (player-attack.c L231). */
export const DEADLINESS_CONVERSION: readonly number[] = [
  0, 5, 10, 14, 18, 22, 26, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66,
  69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 104, 107, 109, 112, 114, 117,
  119, 122, 124, 127, 129, 132, 134, 137, 139, 142, 144, 147, 149, 152, 154,
  157, 159, 162, 164, 167, 169, 172, 174, 176, 178, 180, 182, 184, 186, 188,
  190, 192, 194, 196, 198, 200, 202, 204, 206, 208, 210, 212, 214, 216, 218,
  220, 222, 224, 226, 228, 230, 232, 234, 236, 238, 240, 242, 244, 246, 248,
  250, 251, 253, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255,
];

/**
 * apply_deadliness (player-attack.c L261): scale die_average (x100) by the
 * deadliness bonus. Returns the scaled value (upstream mutates in place).
 */
export function applyDeadliness(dieAverage: number, deadliness: number): number {
  let dl = deadliness;
  if (dl > 150) dl = 150;
  if (dl < -150) dl = -150;
  if (dl >= 0) {
    const i = DEADLINESS_CONVERSION[dl] as number;
    return dieAverage * (100 + i);
  }
  const i = DEADLINESS_CONVERSION[Math.abs(dl)] as number;
  if (i >= 100) return 0;
  return dieAverage * (100 - i);
}
