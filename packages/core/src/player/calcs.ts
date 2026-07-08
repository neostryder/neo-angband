/**
 * Player calculation tables and helpers, ported VERBATIM from
 * reference/src/player-calcs.c and player-util.c (Angband 4.2.6).
 *
 * The adj_* arrays are the stat-adjustment tables indexed by state->stat_ind
 * (0..STAT_RANGE-1). Each has exactly STAT_RANGE (38) entries. blows_table is
 * the 12x12 blow-energy table; player_exp is the experience needed per level.
 *
 * This module also ports the non-equipment portion of calc_bonuses skill
 * computation and the level-1 hitpoint math. Equipment-, shape- and
 * class-special-dependent adjustments are DEFERRED (see the DEFERRED list
 * below and parity/ledger/player-calcs.yaml):
 *   - object modifier contributions to skills (STEALTH/SEARCH/DIGGING/to-hit)
 *   - shape->skills / shape->modifiers additions
 *   - weapon/launcher weight to-hit penalties and heavy-wield handling
 *   - class-special skill scaling (rogue/ranger device/disarm, throwing, etc.)
 *   - to_a/to_d/to_h, num_blows/num_shots, mana (calc_mana), light, speed
 */

import {
  PY_MAX_LEVEL,
  SKILL,
  SKILL_MAX,
  STAT_MAX,
  STAT_RANGE,
} from "./types";
import { STAT } from "../generated";
import type { PlayerClass, PlayerRace } from "./types";

/* ------------------------------------------------------------------ */
/* Stat adjustment tables (player-calcs.c), each STAT_RANGE entries    */
/* ------------------------------------------------------------------ */

/** Stat Table (INT) -- Magic devices. */
export const adj_int_dev: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 13,
];

/** Stat Table (WIS) -- Saving throw. */
export const adj_wis_sav: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
];

/** Stat Table (DEX) -- disarming. */
export const adj_dex_dis: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19, 19,
];

/** Stat Table (INT) -- disarming. */
export const adj_int_dis: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 10,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19, 19,
];

/** Stat Table (DEX) -- bonus to ac. */
export const adj_dex_ta: readonly number[] = [
  -4, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 5,
  6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 15, 15,
];

/** Stat Table (STR) -- bonus to dam. */
export const adj_str_td: readonly number[] = [
  -2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 5, 5,
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20,
];

/** Stat Table (DEX) -- bonus to hit. */
export const adj_dex_th: readonly number[] = [
  -3, -2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5,
  6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 15, 15,
];

/** Stat Table (STR) -- bonus to hit. */
export const adj_str_th: readonly number[] = [
  -3, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4,
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15,
];

/** Stat Table (STR) -- weight limit in deca-pounds. */
export const adj_str_wgt: readonly number[] = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30,
  30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];

/** Stat Table (STR) -- weapon weight limit in pounds. */
export const adj_str_hold: readonly number[] = [
  4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 30, 35, 40, 45, 50,
  55, 60, 65, 70, 80, 80, 80, 80, 80, 90, 90, 90, 90, 90, 100, 100, 100,
];

/** Stat Table (STR) -- digging value. */
export const adj_str_dig: readonly number[] = [
  0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40,
  45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 100, 100,
];

/** Stat Table (STR) -- index into the "blow" table. */
export const adj_str_blow: readonly number[] = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 30, 40, 50, 60, 70,
  80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230,
  240,
];

/** Stat Table (DEX) -- index into the "blow" table. */
export const adj_dex_blow: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7,
  7, 8, 8, 8, 9, 9, 9, 10, 10, 11, 11, 11,
];

/** Stat Table (DEX) -- chance of avoiding "theft" and "falling". */
export const adj_dex_safe: readonly number[] = [
  0, 1, 2, 3, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 15, 15, 20, 25, 30, 35,
  40, 45, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100, 100, 100, 100,
];

/** Stat Table (CON) -- base regeneration rate. */
export const adj_con_fix: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4,
  4, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9,
];

/** Stat Table (CON) -- extra 1/100th hitpoints per level. */
export const adj_con_mhp: readonly number[] = [
  -250, -150, -100, -75, -50, -25, -10, -5, 0, 5, 10, 25, 50, 75, 100, 150, 175,
  200, 225, 250, 275, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
  900, 1000, 1100, 1250, 1250, 1250,
];

/** Stat Table (INT/WIS) -- spell study rate. */
export const adj_mag_study: readonly number[] = [
  0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 100, 105, 110, 115, 120, 130,
  140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 250, 250, 250, 250,
  250, 250, 250,
];

/** Stat Table (INT/WIS) -- extra 1/100 mana-points per level. */
export const adj_mag_mana: readonly number[] = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170,
  180, 190, 200, 225, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
  800, 800, 800, 800,
];

/**
 * blows_table[P][D] (player-calcs.c): energy per blow indexed by the STR blow
 * index P (adj_str_blow bucketed) and the DEX blow index D (adj_dex_blow).
 */
export const blows_table: readonly (readonly number[])[] = [
  [100, 100, 95, 85, 75, 60, 50, 42, 35, 30, 25, 23],
  [100, 95, 85, 75, 60, 50, 42, 35, 30, 25, 23, 21],
  [95, 85, 75, 60, 50, 42, 35, 30, 26, 23, 21, 20],
  [85, 75, 60, 50, 42, 36, 32, 28, 25, 22, 20, 19],
  [75, 60, 50, 42, 36, 33, 28, 25, 23, 21, 19, 18],
  [60, 50, 42, 36, 33, 30, 27, 24, 22, 21, 19, 17],
  [50, 42, 36, 33, 30, 27, 25, 23, 21, 20, 18, 17],
  [42, 36, 33, 30, 28, 26, 24, 22, 20, 19, 18, 17],
  [36, 33, 30, 28, 26, 24, 22, 21, 20, 19, 17, 16],
  [35, 32, 29, 26, 24, 22, 21, 20, 19, 18, 17, 16],
  [34, 30, 27, 25, 23, 22, 21, 20, 19, 18, 17, 16],
  [33, 29, 26, 24, 22, 21, 20, 19, 18, 17, 16, 15],
];

/**
 * Experience needed to reach each level (player.c player_exp[PY_MAX_LEVEL]).
 * player_exp[lev-1] is the base threshold for level lev+1; multiplied by the
 * player's expfact/100.
 */
export const player_exp: readonly number[] = [
  10, 25, 45, 70, 100, 140, 200, 280, 380, 500, 650, 850, 1100, 1400, 1800, 2300,
  2900, 3600, 4400, 5400, 6800, 8400, 10200, 12500, 17500, 25000, 35000, 50000,
  75000, 100000, 150000, 200000, 275000, 350000, 450000, 550000, 700000, 850000,
  1000000, 1250000, 1500000, 1800000, 2100000, 2400000, 2700000, 3000000, 3500000,
  4000000, 4500000, 5000000,
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Bounds-checked table read; throws on an out-of-range index. */
function at(table: readonly number[], i: number): number {
  const v = table[i];
  if (v === undefined) {
    throw new Error(`player: adj table index out of range: ${i}`);
  }
  return v;
}

/**
 * modify_stat_value (player-util.c): apply a racial/class stat modifier to a
 * base stat value, using the 3..18/220 encoding (each point below 18 is +1,
 * each point at/above 18 is +10; symmetric on the way down).
 */
export function modifyStatValue(value: number, amount: number): number {
  let v = value;
  if (amount > 0) {
    for (let i = 0; i < amount; i++) {
      if (v < 18) v++;
      else v += 10;
    }
  } else if (amount < 0) {
    for (let i = 0; i < -amount; i++) {
      if (v >= 18 + 10) v -= 10;
      else if (v > 18) v = 18;
      else if (v > 3) v--;
    }
  }
  return v;
}

/**
 * The stat_ind computation from calc_bonuses: map a modified stat "use" value
 * to its index into the adj_* tables (0..STAT_RANGE-1).
 */
export function statUseToIndex(use: number): number {
  let ind: number;
  if (use <= 3) ind = 0;
  else if (use <= 18) ind = use - 3;
  else if (use <= 18 + 219) ind = 15 + Math.trunc((use - 18) / 10);
  else ind = 37;
  if (ind < 0 || ind >= STAT_RANGE) {
    throw new Error(`player: stat index out of range: ${ind}`);
  }
  return ind;
}

/**
 * Compute the stat_ind array (indices into adj_* tables) for a race/class at a
 * given set of base stat values (state->stat_ind in calc_bonuses, without the
 * hypothetical-blow hack). stat_add (equipment) is DEFERRED and treated as 0.
 */
export function calcStatIndices(
  race: PlayerRace,
  cls: PlayerClass,
  statCur: readonly number[],
): number[] {
  const out = new Array<number>(STAT_MAX).fill(0);
  for (let i = 0; i < STAT_MAX; i++) {
    const add = (race.statAdj[i] ?? 0) + (cls.statAdj[i] ?? 0);
    const use = modifyStatValue(statCur[i] ?? 0, add);
    out[i] = statUseToIndex(use);
  }
  return out;
}

/**
 * calc_hitpoints (player-calcs.c): maximum hitpoints at a level, given the
 * accumulated player_hp roll for that level and the CON stat index.
 * mhp = player_hp[lev-1] + adj_con_mhp[con_ind] * lev / 100, floored at lev+1.
 */
export function calcHitpoints(
  playerHpAtLevel: number,
  lev: number,
  conInd: number,
): number {
  const bonus = at(adj_con_mhp, conInd);
  let mhp = playerHpAtLevel + Math.trunc((bonus * lev) / 100);
  if (mhp < lev + 1) mhp = lev + 1;
  return mhp;
}

/**
 * The non-equipment portion of calc_bonuses skill computation:
 *   skills[i] = r_skills[i] + c_skills[i]
 *   DEVICE  += adj_int_dev[stat_ind[INT]]
 *   SAVE    += adj_wis_sav[stat_ind[WIS]]
 *   DIGGING += adj_str_dig[stat_ind[STR]]
 *   skills[i] += x_skills[i] * lev / 10
 * then DIGGING is floored at 1 and STEALTH clamped to [0, 30].
 *
 * Equipment/shape/class-special adjustments are DEFERRED (see module header).
 */
export function calcSkills(
  race: PlayerRace,
  cls: PlayerClass,
  lev: number,
  statInd: readonly number[],
): number[] {
  const skills = new Array<number>(SKILL_MAX).fill(0);
  for (let i = 0; i < SKILL_MAX; i++) {
    skills[i] = (race.skills[i] ?? 0) + (cls.skills[i] ?? 0);
  }
  skills[SKILL.DEVICE] =
    (skills[SKILL.DEVICE] ?? 0) + at(adj_int_dev, statInd[STAT.INT] ?? 0);
  skills[SKILL.SAVE] =
    (skills[SKILL.SAVE] ?? 0) + at(adj_wis_sav, statInd[STAT.WIS] ?? 0);
  skills[SKILL.DIGGING] =
    (skills[SKILL.DIGGING] ?? 0) + at(adj_str_dig, statInd[STAT.STR] ?? 0);
  for (let i = 0; i < SKILL_MAX; i++) {
    skills[i] = (skills[i] ?? 0) + Math.trunc(((cls.extraSkills[i] ?? 0) * lev) / 10);
  }
  if ((skills[SKILL.DIGGING] ?? 0) < 1) skills[SKILL.DIGGING] = 1;
  if ((skills[SKILL.STEALTH] ?? 0) > 30) skills[SKILL.STEALTH] = 30;
  if ((skills[SKILL.STEALTH] ?? 0) < 0) skills[SKILL.STEALTH] = 0;
  return skills;
}

/** Re-export for callers computing HP arrays over all levels. */
export { PY_MAX_LEVEL };
