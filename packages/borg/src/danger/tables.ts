/**
 * Static tables and enums the danger evaluator reads, transcribed verbatim from
 * the reference so the ported math is numerically identical to upstream.
 *
 * - extract_energy[] : reference/src/game-world.c:68 (speed -> energy/turn).
 * - adj_dex_safe[]   : reference/src/player-calcs.c:640 (DEX index -> theft/fall
 *   avoidance), read by the EAT_GOLD / EAT_ITEM blow branches.
 * - MONBLOW enum + name map : reference/src/borg/borg-danger.h:30 and the
 *   borg_mon_blow_effect() name table in borg-fight-attack.c:69.
 */

/**
 * extract_energy[speed] : game energy gained per game turn at a given net
 * speed (110 == normal). Transcribed 1:1 from reference/src/game-world.c:68-89
 * (const uint8_t extract_energy[200]).
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

/** extract_energy[speed] with the same clamping the table's [0,199] domain gives. */
export function extractEnergy(speed: number): number {
  const s = speed < 0 ? 0 : speed > 199 ? 199 : speed;
  return EXTRACT_ENERGY[s]!;
}

/**
 * adj_dex_safe[STAT_RANGE] : DEX-index -> chance of avoiding theft/falling.
 * Transcribed 1:1 from reference/src/player-calcs.c:640-680 (STAT_RANGE == 38).
 */
export const ADJ_DEX_SAFE: readonly number[] = [
  0 /* 3 */, 1 /* 4 */, 2 /* 5 */, 3 /* 6 */, 4 /* 7 */, 5 /* 8 */, 5 /* 9 */,
  6 /* 10 */, 6 /* 11 */, 7 /* 12 */, 7 /* 13 */, 8 /* 14 */, 8 /* 15 */,
  9 /* 16 */, 9 /* 17 */, 10 /* 18/00 */, 10 /* 18/10 */, 15 /* 18/20 */,
  15 /* 18/30 */, 20 /* 18/40 */, 25 /* 18/50 */, 30 /* 18/60 */, 35 /* 18/70 */,
  40 /* 18/80 */, 45 /* 18/90 */, 50 /* 18/100 */, 60 /* 18/110 */,
  70 /* 18/120 */, 80 /* 18/130 */, 90 /* 18/140 */, 100 /* 18/150 */,
  100 /* 18/160 */, 100 /* 18/170 */, 100 /* 18/180 */, 100 /* 18/190 */,
  100 /* 18/200 */, 100 /* 18/210 */, 100 /* 18/220+ */,
];

/** adj_dex_safe[dexIndex], clamped to the table domain. */
export function adjDexSafe(dexIndex: number): number {
  const i =
    dexIndex < 0 ? 0 : dexIndex >= ADJ_DEX_SAFE.length ? ADJ_DEX_SAFE.length - 1 : dexIndex;
  return ADJ_DEX_SAFE[i]!;
}

/**
 * enum BORG_MONBLOW (reference/src/borg/borg-danger.h:30). The ordinals are not
 * load-bearing for the danger math (it switches on the value), but the set and
 * names must match so blow-effect resolution lines up with the C.
 */
export enum MONBLOW {
  NONE,
  HURT,
  POISON,
  DISENCHANT,
  DRAIN_CHARGES,
  EAT_GOLD,
  EAT_ITEM,
  EAT_FOOD,
  EAT_LIGHT,
  ACID,
  ELEC,
  FIRE,
  COLD,
  BLIND,
  CONFUSE,
  TERRIFY,
  PARALYZE,
  LOSE_STR,
  LOSE_INT,
  LOSE_WIS,
  LOSE_DEX,
  LOSE_CON,
  LOSE_ALL,
  SHATTER,
  EXP_10,
  EXP_20,
  EXP_40,
  EXP_80,
  HALLU,
  BLACK_BREATH,
  UNDEFINED,
}

/**
 * borg_mon_blow_effect(name) : map a blow_effect name to the MONBLOW enum.
 * Transcribed from the static table in reference/src/borg/borg-fight-attack.c:69.
 * An unknown name resolves to NONE, exactly as the C default.
 */
const BLOW_EFFECT_BY_NAME: Readonly<Record<string, MONBLOW>> = {
  NONE: MONBLOW.NONE,
  HURT: MONBLOW.HURT,
  POISON: MONBLOW.POISON,
  DISENCHANT: MONBLOW.DISENCHANT,
  DRAIN_CHARGES: MONBLOW.DRAIN_CHARGES,
  EAT_GOLD: MONBLOW.EAT_GOLD,
  EAT_ITEM: MONBLOW.EAT_ITEM,
  EAT_FOOD: MONBLOW.EAT_FOOD,
  EAT_LIGHT: MONBLOW.EAT_LIGHT,
  ACID: MONBLOW.ACID,
  ELEC: MONBLOW.ELEC,
  FIRE: MONBLOW.FIRE,
  COLD: MONBLOW.COLD,
  BLIND: MONBLOW.BLIND,
  CONFUSE: MONBLOW.CONFUSE,
  TERRIFY: MONBLOW.TERRIFY,
  PARALYZE: MONBLOW.PARALYZE,
  LOSE_STR: MONBLOW.LOSE_STR,
  LOSE_INT: MONBLOW.LOSE_INT,
  LOSE_WIS: MONBLOW.LOSE_WIS,
  LOSE_DEX: MONBLOW.LOSE_DEX,
  LOSE_CON: MONBLOW.LOSE_CON,
  LOSE_ALL: MONBLOW.LOSE_ALL,
  SHATTER: MONBLOW.SHATTER,
  EXP_10: MONBLOW.EXP_10,
  EXP_20: MONBLOW.EXP_20,
  EXP_40: MONBLOW.EXP_40,
  EXP_80: MONBLOW.EXP_80,
  HALLU: MONBLOW.HALLU,
  BLACK_BREATH: MONBLOW.BLACK_BREATH,
};

/** borg_mon_blow_effect (borg-fight-attack.c:69): name -> MONBLOW, NONE default. */
export function borgMonBlowEffect(name: string): MONBLOW {
  return BLOW_EFFECT_BY_NAME[name] ?? MONBLOW.NONE;
}
