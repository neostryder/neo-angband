/**
 * Static lookup tables and game constants the self-model needs, transcribed
 * verbatim from the C so the arithmetic matches to the last entry.
 *
 * Sources:
 * - borg_adj_* : reference/src/borg/borg-trait.c:48-719
 * - adj_str_hold : reference/src/player-calcs.c:456
 * - modify_stat_value : reference/src/player-util.c:339
 * - food thresholds : player_timed.txt grades * z_info->food_value (100)
 * - borg_cfg defaults : reference/src/borg/borg.txt
 */

/* All borg_adj_* tables are indexed by the stat "index" 0..37 (STAT_RANGE). */

/** borg_adj_mag_mana - mana adjustment by casting-stat index (trait.c:48). */
export const BORG_ADJ_MAG_MANA: readonly number[] = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140,
  150, 160, 170, 180, 190, 200, 225, 250, 300, 350, 400, 450, 500, 550,
  600, 650, 700, 750, 800, 800, 800, 800, 800,
];

/** borg_adj_dex_ta - AC bonus by DEX index (trait.c:89). */
export const BORG_ADJ_DEX_TA: readonly number[] = [
  -4, -3, -2, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4,
  5, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 15, 15,
];

/** borg_adj_str_td - bonus to damage by STR index (trait.c:133). */
export const BORG_ADJ_STR_TD: readonly number[] = [
  -2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 5,
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20,
];

/** borg_adj_dex_th - bonus to hit by DEX index (trait.c:177). */
export const BORG_ADJ_DEX_TH: readonly number[] = [
  -3, -2, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4,
  5, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 15, 15,
];

/** borg_adj_str_th - bonus to hit by STR index (trait.c:221). */
export const BORG_ADJ_STR_TH: readonly number[] = [
  -3, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 3,
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 15,
];

/** borg_adj_dex_blow - blows by DEX index (trait.c:262). */
export const BORG_ADJ_DEX_BLOW: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 11, 11, 11,
];

/** borg_blows_table[str_index][dex_index] -> energy per blow (trait.c:303). */
export const BORG_BLOWS_TABLE: readonly (readonly number[])[] = [
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

/** borg_adj_dex_dis - disarm by DEX index (trait.c:346). */
export const BORG_ADJ_DEX_DIS: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9,
  10, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19, 19,
];

/** borg_adj_int_dis - disarm by INT index (trait.c:387). */
export const BORG_ADJ_INT_DIS: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9,
  10, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19, 19,
];

/** borg_adj_int_dev - magic device by INT index (trait.c:428). */
export const BORG_ADJ_INT_DEV: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5, 5, 6,
  6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 13,
];

/** borg_adj_str_dig - digging by STR index (trait.c:469). */
export const BORG_ADJ_STR_DIG: readonly number[] = [
  0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10, 12, 15, 20, 25, 30, 35,
  40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 100, 100,
];

/** borg_adj_wis_sav - saving throw by WIS index (trait.c:510). */
export const BORG_ADJ_WIS_SAV: readonly number[] = [
  0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5, 5, 6,
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
];

/** borg_adj_str_wgt - weight allowance (tenth-lbs / 100) by STR index (trait.c:551). */
export const BORG_ADJ_STR_WGT: readonly number[] = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28,
  30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];

/** borg_adj_con_mhp - max-HP adjustment by CON index (trait.c:592). */
export const BORG_ADJ_CON_MHP: readonly number[] = [
  -250, -150, -100, -75, -50, -25, -10, -5, 0, 5, 10, 25, 50, 75, 100, 150,
  175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750,
  800, 900, 1000, 1100, 1250, 1250, 1250,
];

/** borg_adj_mag_fail - minimum spell fail by casting-stat index (trait.c:636). */
export const BORG_ADJ_MAG_FAIL: readonly number[] = [
  99, 99, 99, 99, 99, 50, 30, 20, 15, 12, 11, 10, 9, 8, 7, 6, 6, 5, 5, 5, 4,
  4, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0,
];

/** borg_adj_mag_stat - spell fail adjustment by casting-stat index (trait.c:680). */
export const BORG_ADJ_MAG_STAT: readonly number[] = [
  -5, -4, -3, -3, -2, -1, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57,
];

/** adj_str_hold - max weapon weight (tenth-lbs) by STR index (player-calcs.c:456). */
export const ADJ_STR_HOLD: readonly number[] = [
  4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 30, 35, 40, 45,
  50, 55, 60, 65, 70, 80, 80, 80, 80, 80, 90, 90, 90, 90, 90, 100, 100, 100,
];

/** Food thresholds (player_timed.txt grades * food_value=100). */
export const PY_FOOD_STARVE = 100;
export const PY_FOOD_FAINT = 400;
export const PY_FOOD_WEAK = 800;
export const PY_FOOD_HUNGRY = 1500;
export const PY_FOOD_FULL = 9000; /* "Fed" grade */
export const PY_FOOD_MAX = 10000; /* "Full" grade */

/** BORG_DIG threshold (borg-flow.h:34). */
export const BORG_DIG = 10;

/**
 * modify_stat_value - apply +/- stat points, respecting the 3..18/220 scale
 * (player-util.c:339). Ported verbatim.
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
 * Convert a "used" stat value to its 0..37 table index (trait.c:1815-1825).
 */
export function statToIndex(use: number): number {
  let ind: number;
  if (use <= 18) ind = use - 3;
  else if (use <= 18 + 219) ind = 15 + Math.trunc((use - 18) / 10);
  else ind = 37;
  return ind > 37 ? 37 : ind;
}
