/**
 * Player calculation tables and helpers, ported VERBATIM from
 * reference/src/player-calcs.c and player-util.c (Angband 4.2.6).
 *
 * The adj_* arrays are the stat-adjustment tables indexed by state->stat_ind
 * (0..STAT_RANGE-1). Each has exactly STAT_RANGE (38) entries. blows_table is
 * the 12x12 blow-energy table; player_exp is the experience needed per level.
 *
 * This module also ports the innate (race/class/stat/level) portion of
 * calc_bonuses as calcBonuses, calc_blows as the pure calcBlows, plus
 * player_flags (player.c), adjust_skill_scale and weight_limit, and the
 * level-1 hitpoint math. The equipment analysis loop and the launcher /
 * weapon analysis ARE ported: pass the worn objects via
 * CalcBonusesOptions.equipment and calc_bonuses applies their stat, skill,
 * combat and resist contributions and derives blows from the wielded weapon.
 * calc_light and the timed effects (food, stun, bless, hero, shero,
 * fast/slow, temp resists, etc.) are now ported (calcLight + the
 * timedEffects-gated blocks in calcBonuses). The per-object curse-object
 * traversal inside the equipment loop (2009-2023) is now ported: a worn item's
 * active curses fold their template objects into the state (pass the bound
 * Curse registry via CalcBonusesOptions.curses). Still DEFERRED (see the
 * calcBonuses notes and parity/ledger/player-calcs-bonuses.yaml):
 *   - the learn-by-use rune system that populates obj_k (equipment modifiers
 *     are rune-gated and inert at birth)
 * calc_mana (player-calcs.c:2322) is ported (player/spell.ts calcMana) and
 * invoked by the session layer (session/game.ts) right after this pass, split
 * across the calc/session seam; msp is populated there.
 * calc_shapechange is now ported (a non-normal player.shape stacks its
 * combat/skill/flag/modifier/resist package on the state).
 */

import {
  OF_SIZE,
  PF_SIZE,
  PY_MAX_LEVEL,
  SKILL,
  SKILL_MAX,
  STAT_MAX,
  STAT_RANGE,
  TMD_MAX,
} from "./types";
import { ELEM, KF, OBJ_MOD, OF, PF, STAT, TMD, TV } from "../generated";
import { COLOUR_L_GREEN, COLOUR_RED, COLOUR_YELLOW } from "../color";
import { FlagSet } from "../bitflag";
import type {
  PlayerClass,
  PlayerElementInfo,
  PlayerRace,
  TimedEffect,
} from "./types";
import type { Player } from "./player";
import type { GameObject } from "../obj/object";
import type { Curse, ElementInfo } from "../obj/types";
import {
  tvalCanHaveFlavor,
  tvalIsAmmo,
  tvalIsDigger,
  tvalIsLight,
} from "../obj/object";
import { playerTimedGradeEq } from "./timed";
import type { PlayerCombatState } from "../combat/melee";
import type { DefenderState } from "../combat/mon-melee";

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
 * The "Modify skills" tail of calc_bonuses (player-calcs.c:2239-2250),
 * applied in the exact upstream statement order:
 *   DISARM_PHYS  += adj_dex_dis[stat_ind[DEX]]   (2240)
 *   DISARM_MAGIC += adj_int_dis[stat_ind[INT]]   (2241)
 *   DEVICE       += adj_int_dev[stat_ind[INT]]   (2242)
 *   SAVE         += adj_wis_sav[stat_ind[WIS]]   (2243)
 *   DIGGING      += adj_str_dig[stat_ind[STR]]   (2244)
 *   skills[i]    += x_skills[i] * lev / 10       (2245-2246)
 * then DIGGING is floored at 1 and STEALTH clamped to [0, 30] (2248-2250).
 */
function applySkillStatAndLevel(
  skills: number[],
  cls: PlayerClass,
  lev: number,
  statInd: readonly number[],
): void {
  skills[SKILL.DISARM_PHYS] =
    (skills[SKILL.DISARM_PHYS] ?? 0) + at(adj_dex_dis, statInd[STAT.DEX] ?? 0);
  skills[SKILL.DISARM_MAGIC] =
    (skills[SKILL.DISARM_MAGIC] ?? 0) + at(adj_int_dis, statInd[STAT.INT] ?? 0);
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
}

/**
 * The non-equipment portion of calc_bonuses skill computation: base
 * skills[i] = r_skills[i] + c_skills[i] (player-calcs.c:1904-1906) followed
 * by the stat and level adjustments (2239-2250, see applySkillStatAndLevel).
 * For a player with no equipment, no timed effects and the normal shape this
 * equals calcBonuses(player).skills.
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
  applySkillStatAndLevel(skills, cls, lev, statInd);
  return skills;
}

/* ------------------------------------------------------------------ */
/* Player state (calc_bonuses / calc_blows)                            */
/* ------------------------------------------------------------------ */

/**
 * struct player_state (player.h:401-438): all the variable state that
 * changes when equipment goes on or off. Field-for-field port; `hold` is
 * additionally kept (upstream computes it as a local at player-calcs.c:2251)
 * because the deferred launcher/weapon weight analysis will need it.
 */
export interface PlayerState {
  /** stat_add[STAT_MAX]: equipment stat bonuses (rune-gated, decision 25). */
  statAdd: number[];
  /** stat_ind[STAT_MAX]: indices into the adj_* stat tables. */
  statInd: number[];
  /** stat_use[STAT_MAX]: current modified stats. */
  statUse: number[];
  /** stat_top[STAT_MAX]: maximal modified stats. */
  statTop: number[];
  /** skills[SKILL_MAX], indexed by SKILL. */
  skills: number[];
  /** Current speed (110 = normal). */
  speed: number;
  /** Number of blows times 100. */
  numBlows: number;
  /** Number of shots times 10 (launcher DEFERRED: 0). */
  numShots: number;
  /** Number of extra movement actions. */
  numMoves: number;
  /** Ammo multiplier (launcher DEFERRED: 0). */
  ammoMult: number;
  /** Ammo variety, as an upstream tval number (launcher DEFERRED: 0). */
  ammoTval: number;
  /** Base ac (armour DEFERRED: 0). */
  ac: number;
  /** Damage reduction. */
  damRed: number;
  /** Percentage damage reduction. */
  percDamRed: number;
  /** Bonus to ac. */
  toA: number;
  /** Bonus to hit. */
  toH: number;
  /** Bonus to dam. */
  toD: number;
  /** Infravision range. */
  seeInfra: number;
  /** Radius of light (calc_light; 0 when no light source is wielded). */
  curLight: number;
  /** Heavy weapon (weapon analysis, player-calcs.c:2291-2319). */
  heavyWield: boolean;
  /** Heavy shooter (launcher analysis, player-calcs.c:2254-2288). */
  heavyShoot: boolean;
  /** Blessed (or blunt) weapon (weapon analysis, player-calcs.c:2291-2319). */
  blessWield: boolean;
  /** Mana draining armour: set by calcMana in the session layer, not here. */
  cumberArmor: boolean;
  /** Status flags from race and items (OF_*). */
  flags: FlagSet;
  /** Player intrinsic flags (PF_*). */
  pflags: FlagSet;
  /** Resists from race and items, length ELEM_MAX. */
  elInfo: PlayerElementInfo[];
  /** adj_str_hold[stat_ind[STR]] (local `hold` at player-calcs.c:2251). */
  hold: number;
}

/**
 * player_flags (player.c:290-300): the player's innate object flags -- racial
 * flags unioned with class flags, plus OF_PROT_FEAR for PF_BRAVERY_30
 * classes at level 30+. Returns a fresh OF-sized flag set (upstream fills a
 * caller buffer).
 */
export function playerFlags(player: Player): FlagSet {
  const f = new FlagSet(OF_SIZE);
  f.copy(player.race.flags);
  f.union(player.cls.flags);
  if (
    (player.race.pflags.has(PF.BRAVERY_30) ||
      player.cls.pflags.has(PF.BRAVERY_30)) &&
    player.lev >= 30
  ) {
    f.on(OF.PROT_FEAR);
  }
  return f;
}

/**
 * player_hp_attr (player.c:323): the colour the current hitpoints are drawn
 * in - COLOUR_L_GREEN at full health, COLOUR_YELLOW while above the
 * hitpoint-warning fraction (mhp * hitpoint_warn / 10), else COLOUR_RED.
 * `hitpointWarn` is op_ptr->hitpoint_warn (0..9); the options store is
 * deferred, so the caller supplies it.
 */
export function playerHpAttr(
  p: Pick<Player, "chp" | "mhp">,
  hitpointWarn: number,
): number {
  if (p.chp >= p.mhp) return COLOUR_L_GREEN;
  if (p.chp > Math.trunc((p.mhp * hitpointWarn) / 10)) return COLOUR_YELLOW;
  return COLOUR_RED;
}

/**
 * player_sp_attr (player.c:337): the spell-point colour, identical thresholds
 * to player_hp_attr but on csp / msp.
 */
export function playerSpAttr(
  p: Pick<Player, "csp" | "msp">,
  hitpointWarn: number,
): number {
  if (p.csp >= p.msp) return COLOUR_L_GREEN;
  if (p.csp > Math.trunc((p.msp * hitpointWarn) / 10)) return COLOUR_YELLOW;
  return COLOUR_RED;
}

/**
 * adjust_skill_scale (player-calcs.c:1781-1792): adjust a value by a
 * relative factor of its absolute value, mimicking value * (den + num) / den
 * for positive values (negative num rounds the adjustment up). Returns the
 * adjusted value instead of mutating through a pointer.
 */
export function adjustSkillScale(
  v: number,
  num: number,
  den: number,
  minv: number,
): number {
  if (num >= 0) {
    return v + Math.trunc((Math.max(minv, Math.abs(v)) * num) / den);
  }
  /* To mimic (value * (den + num)) / den for positive value, round up. */
  return v - Math.trunc((Math.max(minv, Math.abs(v)) * -num + den - 1) / den);
}

/**
 * weight_limit (player-calcs.c:1741-1750): the carrying capacity in tenth
 * pounds, based only on strength.
 */
export function weightLimit(state: PlayerState): number {
  return at(adj_str_wgt, state.statInd[STAT.STR] ?? 0) * 100;
}

/**
 * calc_blows (player-calcs.c:1703-1735): the blows a player would get with a
 * weapon of the given weight, as a pure function of the class blow
 * parameters and the STR/DEX stat indices (state->stat_ind upstream).
 *
 * \param cls supplies min_weight, att_multiply and max_attacks.
 * \param weaponWeight is object_weight_one(obj) in tenth pounds, or null for
 * no weapon (upstream passes obj == NULL and uses weight 0, so the class
 * min_weight becomes the divisor).
 * \param strInd / dexInd are stat_ind[STAT_STR] / stat_ind[STAT_DEX].
 * \param extraBlows is the +blows total from gear and state (innately 0).
 * \param percentDamage is OPT(p, birth_percent_damage): O-combat requires
 * two blows minimum instead of one.
 * \returns 100x the number of blows.
 */
export function calcBlows(
  cls: Pick<PlayerClass, "minWeight" | "attMultiply" | "maxAttacks">,
  weaponWeight: number | null,
  strInd: number,
  dexInd: number,
  extraBlows = 0,
  percentDamage = false,
): number {
  const weight = weaponWeight === null ? 0 : weaponWeight;
  const minWeight = cls.minWeight;

  /* Enforce a minimum "weight" (tenth pounds) (1715). */
  const div = weight < minWeight ? minWeight : weight;

  /* Get the strength vs weight (1717-1722). */
  let strIndex = Math.trunc((at(adj_str_blow, strInd) * cls.attMultiply) / div);
  if (strIndex > 11) strIndex = 11;

  /* Index by dexterity (1724-1725). */
  const dexIndex = Math.min(at(adj_dex_blow, dexInd), 11);

  /* Use the blows table to get energy per blow (1727-1730). */
  const blowEnergy = blows_table[strIndex]?.[dexIndex];
  if (blowEnergy === undefined) {
    throw new Error(`player: blows_table index out of range: ${strIndex},${dexIndex}`);
  }
  const blows = Math.min(
    Math.trunc(10000 / blowEnergy),
    100 * cls.maxAttacks,
  );

  /* Require at least one blow, two for O-combat (1732-1734). */
  return Math.max(blows + 100 * extraBlows, percentDamage ? 200 : 100);
}

/** Options for calcBonuses covering upstream globals. */
export interface CalcBonusesOptions {
  /**
   * character_dungeon (upstream global): true once the character is in play
   * on a generated level. Gates the PF_UNLIGHT / PF_EVIL element-info
   * adjustments (player-calcs.c:2043-2052). Defaults to false (the
   * freshly-born state).
   */
  characterDungeon?: boolean;
  /**
   * The equipped object per body slot (index = body slot, null = empty), as
   * resolved from player.equipment via the gear store. Drives the equipment
   * analysis loop (player-calcs.c:1924-2025) and the launcher / weapon
   * analysis (2254-2319). Defaults to empty (unarmed and unarmored).
   */
  equipment?: readonly (GameObject | null)[];
  /**
   * The bound timed-effect table (player/bind.ts TimedEffect[]), indexed by
   * TMD. Drives the FOOD-grade block (2094-2132), player_flags_timed and the
   * grade / temp_resist driven timed block (2134-2213). Defaults to empty,
   * which disables the whole timed model (both the table-driven AND the
   * per-timer branches) so no self-inconsistent partial derive can occur:
   * an empty table is valid only when the timed contributions are meant to
   * be ignored wholesale (the innate / no-timers callers). All three live
   * call sites (game.ts refreshDerived, startGame, loadGame) pass players.timed.
   */
  timedEffects?: readonly TimedEffect[];
  /**
   * The bound curse registry (obj/bind.ts (Curse | null)[], 1-based, index 0
   * null), i.e. upstream's global `curses[]` array of length z_info->curse_max.
   * Drives the per-object curse-object traversal in the equipment loop
   * (player-calcs.c:2009-2023): each worn item's active curses fold their own
   * curse template object (modifiers/flags/toH/toD/toA/elInfo) into the state.
   * Defaults to empty, which disables the traversal (no templates to resolve);
   * the live call sites (game.ts refreshDerived/startGame/loadGame) pass
   * reg.objects.curses.
   */
  curses?: readonly (Curse | null)[];
  /**
   * calc_bonuses' `update` arg (player-calcs.c:1877): when true the derive is
   * allowed its faithful side effects -- zeroing p->timed[TMD_FASTCAST] on a
   * Stun/Heavy Stun grade (2141-2143/2148-2150) and the calc_light town
   * redraw flag. Defaults to true (the live refresh path). Hypothetical /
   * known_only callers pass false so the derive stays pure.
   */
  update?: boolean;
  /**
   * The hypothetical-blows stat-index shift (player-calcs.c:2077-2088), the
   * "Hack for hypothetical blows - NRM" upstream runs when update is false and
   * a caller has pre-loaded state->stat_ind[STAT_STR]/[STAT_DEX] with an
   * increment. obj-info.c's obj_known_blows / obj_known_damage / obj_known_digging
   * / obj_known_misc_combat all take this path (they zero the two indices, then
   * the blows scan bumps them). When supplied, the STR and DEX stat indices are
   * shifted by str / dex and clamped to [3, 37] AFTER the normal derivation,
   * exactly as upstream. Absent (the live refresh path), no shift is applied.
   */
  statIndBoost?: { str: number; dex: number };
  /**
   * p->depth (calc_light town-daytime early-out, 1607). Defaults to undefined,
   * treated as a nonzero depth so the town branch stays dormant.
   */
  depth?: number;
  /**
   * is_daytime() (calc_light, 1607). Defaults to false; the town-daytime
   * early-out is dormant until the world clock lands (see calcLight).
   */
  isDaytime?: boolean;
}

/**
 * calc_light (player-calcs.c:1598-1645): set state.curLight to the sum of the
 * light radii of every wielded light source. Each slot contributes OF_LIGHT_2
 * (2) or OF_LIGHT_3 (3) plus its OBJ_MOD_LIGHT modifier, an UNLIGHT player
 * loses 1 from any positive +LIGHT item, and a tval-light item with fuel that
 * has run out (timeout == 0, no NO_FUEL) contributes nothing.
 *
 * FAITHFULNESS: obj->modifiers[OBJ_MOD_LIGHT] is read RAW here (1629), NOT
 * multiplied by the learned-rune mask obj_k like the pval modifiers in the
 * equipment loop -- upstream calc_light does not rune-gate light. Do not
 * "consistency-fix" this into a knownMods multiply; that would diverge.
 */
function calcLight(
  player: Player,
  state: PlayerState,
  options: CalcBonusesOptions,
): void {
  /* Assume no light (1604). */
  state.curLight = 0;

  /* Ascertain lightness if in the town (1606-1613). is_daytime() comes from
     the world clock (deferred), so isDaytime defaults false and this branch
     is dormant in the dungeon-only build.
     TODO(world-clock): when isDaytime becomes real, also reinstate the
     upstream visual refresh here -- calc_light sets p->upkeep->update |=
     (PU_UPDATE_VIEW | PU_MONSTERS) when the town light changes (1608-1611)
     before returning. The port must trigger the equivalent view/monster
     refresh on the town daytime path once the town/world clock lands. */
  const depth = options.depth;
  const update = options.update ?? true;
  if (depth === 0 && (options.isDaytime ?? false) && update) {
    return;
  }

  const equipment = options.equipment ?? [];

  /* Examine all wielded objects, use the brightest (1615-1644). */
  for (let i = 0; i < player.body.count; i++) {
    let amt = 0;
    const obj = equipment[i] ?? null;

    /* Skip empty slots (1621). */
    if (!obj) continue;

    /* Light radius - innate plus modifier (1623-1629). */
    if (obj.flags.has(OF.LIGHT_2)) {
      amt = 2;
    } else if (obj.flags.has(OF.LIGHT_3)) {
      amt = 3;
    }
    amt += obj.modifiers[OBJ_MOD.LIGHT] ?? 0;

    /* Adjustment to allow UNLIGHT players to use +1 LIGHT gear (1631-1634). */
    if ((obj.modifiers[OBJ_MOD.LIGHT] ?? 0) > 0 && state.pflags.has(PF.UNLIGHT)) {
      amt--;
    }

    /* Examine actual lights: no fuel means no light (1636-1640). */
    if (tvalIsLight(obj.tval) && !obj.flags.has(OF.NO_FUEL) && obj.timeout === 0) {
      amt = 0;
    }

    /* Alter cur_light if reasonable (1643). */
    state.curLight += amt;
  }
}

/**
 * calc_bonuses (player-calcs.c:1877-2331), innate portion: derives the
 * player's state from race/class intrinsics, stats, level, the worn
 * equipment (options.equipment) and the timed effects (options.timedEffects
 * + player.timed). With no equipment supplied the player is unarmed and
 * unarmored (the just-born default); with no timed table supplied the timed
 * model is inert (see CalcBonusesOptions.timedEffects).
 *
 * Ported statement-for-statement in upstream order; each block cites its
 * lines. DEFERRED blocks (see parity/ledger/player-calcs-bonuses.yaml), all
 * of which are no-ops for the innate state:
 * - the learn-by-use rune system that populates obj_k: equipment modifiers
 *   are rune-gated (obj->modifiers * obj_k->modifiers) and UNKNOWN at birth
 *   (decision 25), so they contribute nothing until a rune is learned. The
 *   per-object curse-object traversal in the equipment loop (2009-2023) is
 *   now ported (see options.curses)
 * - calc_light (2040-2041), the food-grade block (2094-2132) and the timed
 *   block (2134-2213) are now ported (calcLight + the timedEffects-gated
 *   blocks below); the launcher analysis (2254-2288) and weapon analysis
 *   (2291-2319) are ported and the wielded weapon drives num_blows/digging
 * - calc_mana (2322): ported (player/spell.ts calcMana) but called by the
 *   session layer just after this pass, not inline; the PF_NO_MANA check
 *   (2323-2325) is ported here and reads p->msp populated by that call
 * - the known_only object-knowledge variant and the !update hypothetical
 *   blows index shift (1891-1893, 2077-2088): birth-UI only
 */
export function calcBonuses(
  player: Player,
  options: CalcBonusesOptions = {},
): PlayerState {
  const race = player.race;
  const cls = player.cls;
  const elemCount = race.elInfo.length;
  /* extra_blows/shots/might/moves accumulate from equipment modifiers and
     feed the launcher / weapon / movement analysis below (0 when unarmed). */
  let extraBlows = 0;
  let extraShots = 0;
  let extraMight = 0;
  let extraMoves = 0;
  /* The wielded weapon and launcher, captured during the equipment loop. */
  let weapon: GameObject | null = null;
  let launcher: GameObject | null = null;

  /* Reset (1896) and set various defaults (1898-1900). */
  const state: PlayerState = {
    statAdd: new Array<number>(STAT_MAX).fill(0),
    statInd: new Array<number>(STAT_MAX).fill(0),
    statUse: new Array<number>(STAT_MAX).fill(0),
    statTop: new Array<number>(STAT_MAX).fill(0),
    skills: new Array<number>(SKILL_MAX).fill(0),
    speed: 110,
    numBlows: 100,
    numShots: 0,
    numMoves: 0,
    ammoMult: 0,
    ammoTval: 0,
    ac: 0,
    damRed: 0,
    percDamRed: 0,
    toA: 0,
    toH: 0,
    toD: 0,
    seeInfra: 0,
    curLight: 0,
    heavyWield: false,
    heavyShoot: false,
    blessWield: false,
    cumberArmor: false,
    flags: new FlagSet(OF_SIZE),
    pflags: new FlagSet(PF_SIZE),
    elInfo: [],
    hold: 0,
  };

  /* Extract race/class info (1902-1914). */
  state.seeInfra = race.infravision;
  for (let i = 0; i < SKILL_MAX; i++) {
    state.skills[i] = (race.skills[i] ?? 0) + (cls.skills[i] ?? 0);
  }
  const vuln = new Array<boolean>(elemCount).fill(false);
  for (let i = 0; i < elemCount; i++) {
    const raceRes = race.elInfo[i]?.resLevel ?? 0;
    if (raceRes === -1) {
      vuln[i] = true;
      state.elInfo.push({ resLevel: 0 });
    } else {
      state.elInfo.push({ resLevel: raceRes });
    }
  }

  /* Base pflags (1916-1919). */
  state.pflags.wipe();
  state.pflags.copy(race.pflags);
  state.pflags.union(cls.pflags);

  /* Extract the player flags (1921-1922; player.c:290-300). */
  const collectF = playerFlags(player);

  /* Analyze equipment (1924-2025). Equipped objects arrive from the caller
     (options.equipment, indexed by body slot). Each item's pval MODIFIERS are
     gated by the player's learned-rune mask (p->obj_k->modifiers): upstream
     multiplies every modifier by obj_k, so a bonus is inert until its rune is
     known, and runes are UNKNOWN by default (PORT_PLAN.md decision 25) -- at
     birth, item modifiers contribute nothing until learned. The el_info and
     combat bonuses (to_a/to_h/to_d) are NOT rune-gated for the real state
     (upstream gates those only for the displayed known_state), so they apply
     unconditionally here.

     Per-object curse traversal (2009-2023) IS ported: the inner while walks
     from the worn item to each of its active curse objects, folding each
     one's own template object (modifiers/flags/toH/toD/toA/elInfo) into the
     state through the SAME loop body (applySource), in the exact upstream
     accumulation order (worn item first, then its curses in ascending index
     order). The curse template objects come from the bound registry
     (options.curses == upstream's global curses[]); a curse object carries no
     ac and no tval, matching the zeroed fields of the upstream curse struct
     (curse ac is a guaranteed no-op, tval 0 makes tval_is_digger false).
     Still DEFERRED (parity ledger): the learn-by-use rune system that
     populates obj_k (obj-knowledge.c), pending its own increment. */
  const equipment = options.equipment ?? [];
  const curseTable = options.curses ?? [];
  const knownMods = player.objKnown.modifiers;

  /* The single loop body upstream applies to the worn item AND to each of its
     curse objects (the do/while at 1930-2024). A worn GameObject satisfies
     BonusSource directly; a curse template is adapted with ac 0 / tval 0 (the
     upstream curse struct leaves those zero). Kept as one closure so the two
     never diverge -- this is calc_bonuses' one loop body, not a fork. */
  interface BonusSource {
    flags: FlagSet;
    modifiers: number[];
    elInfo: readonly ElementInfo[];
    ac: number;
    toA: number;
    toH: number;
    toD: number;
    tval: number;
  }
  const applySource = (
    src: BonusSource,
    isWeaponSlot: boolean,
    isBowSlot: boolean,
  ): void => {
    /* Extract the item flags (1933-1939). */
    collectF.union(src.flags);

    /* Apply modifiers (1941-1981), each multiplied by the learned-rune mask
       (obj->modifiers[X] * p->obj_k->modifiers[X]). The five stat modifiers
       share indices with STAT_* (OBJ_MOD_STR == STAT_STR == 0). */
    for (let s = 0; s < STAT_MAX; s++) {
      state.statAdd[s] =
        (state.statAdd[s] ?? 0) + (src.modifiers[s] ?? 0) * (knownMods[s] ?? 0);
    }
    state.skills[SKILL.STEALTH] =
      (state.skills[SKILL.STEALTH] ?? 0) +
      (src.modifiers[OBJ_MOD.STEALTH] ?? 0) * (knownMods[OBJ_MOD.STEALTH] ?? 0);
    state.skills[SKILL.SEARCH] =
      (state.skills[SKILL.SEARCH] ?? 0) +
      (src.modifiers[OBJ_MOD.SEARCH] ?? 0) * 5 * (knownMods[OBJ_MOD.SEARCH] ?? 0);
    state.seeInfra +=
      (src.modifiers[OBJ_MOD.INFRA] ?? 0) * (knownMods[OBJ_MOD.INFRA] ?? 0);

    let dig = 0;
    if (tvalIsDigger(src.tval)) {
      if (src.flags.has(OF.DIG_1)) dig = 1;
      else if (src.flags.has(OF.DIG_2)) dig = 2;
      else if (src.flags.has(OF.DIG_3)) dig = 3;
    }
    dig += (src.modifiers[OBJ_MOD.TUNNEL] ?? 0) * (knownMods[OBJ_MOD.TUNNEL] ?? 0);
    state.skills[SKILL.DIGGING] = (state.skills[SKILL.DIGGING] ?? 0) + dig * 20;

    state.speed +=
      (src.modifiers[OBJ_MOD.SPEED] ?? 0) * (knownMods[OBJ_MOD.SPEED] ?? 0);
    state.damRed +=
      (src.modifiers[OBJ_MOD.DAM_RED] ?? 0) * (knownMods[OBJ_MOD.DAM_RED] ?? 0);
    extraBlows += (src.modifiers[OBJ_MOD.BLOWS] ?? 0) * (knownMods[OBJ_MOD.BLOWS] ?? 0);
    extraShots += (src.modifiers[OBJ_MOD.SHOTS] ?? 0) * (knownMods[OBJ_MOD.SHOTS] ?? 0);
    extraMight += (src.modifiers[OBJ_MOD.MIGHT] ?? 0) * (knownMods[OBJ_MOD.MIGHT] ?? 0);
    extraMoves += (src.modifiers[OBJ_MOD.MOVES] ?? 0) * (knownMods[OBJ_MOD.MOVES] ?? 0);

    /* Apply element info, noting vulnerabilities for later (1983-1993). */
    for (let jj = 0; jj < elemCount; jj++) {
      const oel = src.elInfo[jj];
      const sel = state.elInfo[jj] as PlayerElementInfo;
      if (!oel) continue;
      if (oel.resLevel === -1) vuln[jj] = true;
      if (oel.resLevel > sel.resLevel) sel.resLevel = oel.resLevel;
    }

    /* Apply combat bonuses (1995-2007). The wielded weapon's and launcher's
       own to_h/to_d are applied at attack time, not here. A curse object's ac
       is 0 (curse struct carries none). */
    state.ac += src.ac;
    state.toA += src.toA;
    if (!isWeaponSlot && !isBowSlot) {
      state.toH += src.toH;
      state.toD += src.toD;
    }
  };

  for (let i = 0; i < player.body.count; i++) {
    const worn = equipment[i] ?? null;
    if (!worn) continue;

    const slotType = player.body.slots[i]?.type;
    const isWeaponSlot = slotType === "WEAPON";
    const isBowSlot = slotType === "BOW";
    /* weapon/launcher are the WORN items (upstream reads them by slot name
       before the loop, 1885-1886); a curse object never becomes the weapon. */
    if (isWeaponSlot) weapon = worn;
    if (isBowSlot) launcher = worn;

    /* curse := obj->curses, the worn item's curse_data array, held fixed while
       we walk the item and its curse objects (1928, 2009-2023). */
    const curse = worn.curses;
    let obj: BonusSource | null = worn;
    let index = 0;
    while (obj) {
      applySource(obj, isWeaponSlot, isBowSlot);

      /* Move to any unprocessed curse object (2009-2023). Scan the worn item's
         curse_data for the next active (power != 0) curse, resolving its
         template object from the bound registry (curses[index].obj). The scan
         bound is z_info->curse_max == curseTable.length. */
      if (curse) {
        index++;
        obj = null;
        while (index < curseTable.length) {
          if (curse[index]?.power) {
            const template = curseTable[index]?.obj;
            obj = template
              ? {
                  flags: template.flags,
                  modifiers: template.modifiers,
                  elInfo: template.elInfo,
                  ac: 0,
                  toA: template.toA,
                  toH: template.toH,
                  toD: template.toD,
                  tval: 0,
                }
              : null;
            break;
          } else {
            index++;
          }
        }
      } else {
        obj = null;
      }
    }
  }

  /* Apply the collected flags (2027-2028). */
  state.flags.union(collectF);

  /* Add shapechange info (calc_shapechange, 1798/2030): a non-normal
     shape's combat bonuses, skills, flags and modifiers stack on top of
     the equipment, and its resists apply when better (vulnerabilities
     join the vuln pass below). The normal shape is null (all zeros). */
  const shape = player.shape;
  if (shape) {
    state.toA += shape.toA;
    state.toH += shape.toH;
    state.toD += shape.toD;
    for (let i = 0; i < SKILL_MAX; i++) {
      state.skills[i] = (state.skills[i] ?? 0) + (shape.skills[i] ?? 0);
    }
    state.flags.union(shape.flags);
    state.pflags.union(shape.pflags);
    for (let s = 0; s < STAT_MAX; s++) {
      state.statAdd[s] = (state.statAdd[s] ?? 0) + (shape.modifiers[s] ?? 0);
    }
    state.skills[SKILL.STEALTH] =
      (state.skills[SKILL.STEALTH] ?? 0) +
      (shape.modifiers[OBJ_MOD.STEALTH] ?? 0);
    state.skills[SKILL.SEARCH] =
      (state.skills[SKILL.SEARCH] ?? 0) +
      (shape.modifiers[OBJ_MOD.SEARCH] ?? 0) * 5;
    state.seeInfra += shape.modifiers[OBJ_MOD.INFRA] ?? 0;
    state.skills[SKILL.DIGGING] =
      (state.skills[SKILL.DIGGING] ?? 0) +
      (shape.modifiers[OBJ_MOD.TUNNEL] ?? 0) * 20;
    state.speed += shape.modifiers[OBJ_MOD.SPEED] ?? 0;
    state.damRed += shape.modifiers[OBJ_MOD.DAM_RED] ?? 0;
    extraBlows += shape.modifiers[OBJ_MOD.BLOWS] ?? 0;
    extraShots += shape.modifiers[OBJ_MOD.SHOTS] ?? 0;
    extraMight += shape.modifiers[OBJ_MOD.MIGHT] ?? 0;
    extraMoves += shape.modifiers[OBJ_MOD.MOVES] ?? 0;

    /* Resists and vulnerabilities. */
    for (let i = 0; i < elemCount; i++) {
      const sel = state.elInfo[i] as PlayerElementInfo;
      const res = shape.elInfo[i]?.resLevel ?? 0;
      if (res === -1) vuln[i] = true;
      else if (res > sel.resLevel) sel.resLevel = res;
    }
  }

  /* Now deal with vulnerabilities (2034-2038). */
  for (let i = 0; i < elemCount; i++) {
    const el = state.elInfo[i] as PlayerElementInfo;
    if (vuln[i] && el.resLevel < 3) el.resLevel--;
  }

  /* Calculate light (2040-2041). */
  calcLight(player, state, options);

  /* Unlight (2043-2046). */
  const characterDungeon = options.characterDungeon ?? false;
  if (state.pflags.has(PF.UNLIGHT) && characterDungeon) {
    const el = state.elInfo[ELEM.DARK];
    if (el) el.resLevel = 1;
  }

  /* Evil (2048-2052). */
  if (state.pflags.has(PF.EVIL) && characterDungeon) {
    const nether = state.elInfo[ELEM.NETHER];
    if (nether) nether.resLevel = 1;
    const holy = state.elInfo[ELEM.HOLY_ORB];
    if (holy) holy.resLevel = -1;
  }

  /* Calculate the various stat values (2054-2092). */
  for (let i = 0; i < STAT_MAX; i++) {
    let add = state.statAdd[i] ?? 0;
    add += (race.statAdj[i] ?? 0) + (cls.statAdj[i] ?? 0);
    state.statTop[i] = modifyStatValue(player.statMax[i] ?? 0, add);
    const use = modifyStatValue(player.statCur[i] ?? 0, add);
    state.statUse[i] = use;
    let ind = statUseToIndex(use);
    /* The !update hypothetical-blows index shift (2077-2088): applied only
       when a caller supplies statIndBoost (obj-info's hypothetical re-derive);
       the live refresh path leaves it undefined and takes the update=true
       branch (no shift). */
    const boost = options.statIndBoost;
    if (boost) {
      if (i === STAT.STR) ind = Math.max(3, Math.min(37, ind + boost.str));
      else if (i === STAT.DEX) ind = Math.max(3, Math.min(37, ind + boost.dex));
    }
    state.statInd[i] = ind;
  }

  /* The timed model (FOOD 2094-2132 + the timed block 2134-2213) is gated on
     the bound table being supplied. An empty table disables BOTH halves -- the
     table-driven grade / flag / temp_resist logic AND the per-timer combat
     branches -- so a caller that omits the table gets a consistent "no timed
     effects" derive rather than a partial one (see CalcBonusesOptions). */
  const timedEffects = options.timedEffects ?? [];
  const update = options.update ?? true;
  if (timedEffects.length > 0) {
    /* Effects of food outside the "Fed" range (2094-2132). PY_FOOD_* are the
       FOOD grade maxes (player-timed.c:320-338), already FOOD_VALUE-scaled in
       the bound table: Fed.max = PY_FOOD_FULL, Full.max = PY_FOOD_MAX,
       Hungry.max = PY_FOOD_HUNGRY. */
    const foodEffect = timedEffects[TMD.FOOD];
    if (foodEffect && !playerTimedGradeEq(player, foodEffect, "Fed")) {
      const foodMax = (name: string): number =>
        foodEffect.grades.find((g) => g.name === name)?.max ?? 0;
      const pyFoodFull = foodMax("Fed");
      const pyFoodMax = foodMax("Full");
      const pyFoodHungry = foodMax("Hungry");
      const food = player.timed[TMD.FOOD] ?? 0;
      const excess = food - pyFoodFull;
      const lack = pyFoodHungry - food;
      if (excess > 0 && !player.timed[TMD.ATT_VAMP]) {
        /* Scale to units 1/10 of the range and subtract from speed. */
        state.speed -= Math.trunc((excess * 10) / (pyFoodMax - pyFoodFull));
      } else if (lack > 0) {
        /* Scale to units 1/20 of the range. */
        const l = Math.trunc((lack * 20) / pyFoodHungry);
        state.toH -= l;
        state.toD -= l;
        if (l > 10 && l <= 15) {
          state.skills[SKILL.DEVICE] = adjustSkillScale(
            state.skills[SKILL.DEVICE] ?? 0, -1, 10, 0);
        } else if (l > 15 && l <= 18) {
          state.skills[SKILL.DEVICE] = adjustSkillScale(
            state.skills[SKILL.DEVICE] ?? 0, -1, 5, 0);
          state.skills[SKILL.DISARM_PHYS] =
            Math.trunc(((state.skills[SKILL.DISARM_PHYS] ?? 0) * 9) / 10);
          state.skills[SKILL.DISARM_MAGIC] =
            Math.trunc(((state.skills[SKILL.DISARM_MAGIC] ?? 0) * 9) / 10);
        } else if (l > 18) {
          state.skills[SKILL.DEVICE] = adjustSkillScale(
            state.skills[SKILL.DEVICE] ?? 0, -3, 10, 0);
          state.skills[SKILL.DISARM_PHYS] =
            Math.trunc(((state.skills[SKILL.DISARM_PHYS] ?? 0) * 8) / 10);
          state.skills[SKILL.DISARM_MAGIC] =
            Math.trunc(((state.skills[SKILL.DISARM_MAGIC] ?? 0) * 8) / 10);
          state.skills[SKILL.SAVE] =
            Math.trunc(((state.skills[SKILL.SAVE] ?? 0) * 9) / 10);
          state.skills[SKILL.SEARCH] =
            Math.trunc(((state.skills[SKILL.SEARCH] ?? 0) * 9) / 10);
        }
      }
    }

    /* Other timed effects (2134-2213). */
    /* player_flags_timed (2135; player.c:310-320): OR each active effect's
       oflag_dup into state.flags, except TMD_TRAPSAFE (excluded so the
       OF_TRAP_IMMUNE learning hack can tell timed from innate). */
    for (let i = 0; i < TMD_MAX; i++) {
      const eff = timedEffects[i];
      if (
        player.timed[i] &&
        eff &&
        eff.oflagDup !== 0 &&
        i !== TMD.TRAPSAFE
      ) {
        state.flags.on(eff.oflagDup);
      }
    }

    /* STUN grade (2137-2151): the FASTCAST-zeroing is the one faithful
       player.timed mutation this derive makes, gated on `update`. */
    const stunEffect = timedEffects[TMD.STUN];
    if (stunEffect && playerTimedGradeEq(player, stunEffect, "Heavy Stun")) {
      state.toH -= 20;
      state.toD -= 20;
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 5, 0);
      if (update) player.timed[TMD.FASTCAST] = 0;
    } else if (stunEffect && playerTimedGradeEq(player, stunEffect, "Stun")) {
      state.toH -= 5;
      state.toD -= 5;
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 10, 0);
      if (update) player.timed[TMD.FASTCAST] = 0;
    }
    if (player.timed[TMD.INVULN]) {
      state.toA += 100;
    }
    if (player.timed[TMD.BLESSED]) {
      state.toA += 5;
      state.toH += 10;
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, 1, 20, 0);
    }
    if (player.timed[TMD.SHIELD]) {
      state.toA += 50;
    }
    if (player.timed[TMD.STONESKIN]) {
      state.toA += 40;
      state.speed -= 5;
    }
    if (player.timed[TMD.HERO]) {
      state.toH += 12;
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, 1, 20, 0);
    }
    if (player.timed[TMD.SHERO]) {
      state.skills[SKILL.TO_HIT_MELEE] =
        (state.skills[SKILL.TO_HIT_MELEE] ?? 0) + 75;
      state.toA -= 10;
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 10, 0);
    }
    if (player.timed[TMD.FAST] || player.timed[TMD.SPRINT]) {
      state.speed += 10;
    }
    if (player.timed[TMD.SLOW]) {
      state.speed -= 10;
    }
    if (player.timed[TMD.SINFRA]) {
      state.seeInfra += 5;
    }
    if (player.timed[TMD.TERROR]) {
      state.speed += 10;
    }
    /* Temporary elemental resists (2188-2194): each active temp_resist effect
       bumps its element's res_level by one, capped at 2 through this path. */
    for (let i = 0; i < TMD_MAX; i++) {
      const eff = timedEffects[i];
      if (!player.timed[i] || !eff || eff.tempResist === -1) continue;
      const el = state.elInfo[eff.tempResist];
      if (el && el.resLevel < 2) el.resLevel++;
    }
    if (player.timed[TMD.CONFUSED]) {
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 4, 0);
    }
    if (player.timed[TMD.AMNESIA]) {
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 5, 0);
    }
    if (player.timed[TMD.POISONED]) {
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 20, 0);
    }
    if (player.timed[TMD.IMAGE]) {
      state.skills[SKILL.DEVICE] = adjustSkillScale(
        state.skills[SKILL.DEVICE] ?? 0, -1, 5, 0);
    }
    if (player.timed[TMD.BLOODLUST]) {
      const bl = player.timed[TMD.BLOODLUST] ?? 0;
      state.toD += Math.trunc(bl / 2);
      extraBlows += Math.trunc(bl / 20);
    }
    if (player.timed[TMD.STEALTH]) {
      state.skills[SKILL.STEALTH] = (state.skills[SKILL.STEALTH] ?? 0) + 10;
    }
  }

  /* Analyze flags - check for fear (2215-2220). Innate flags can in
     principle carry OF_AFRAID (mods), so the check is ported. */
  if (state.flags.has(OF.AFRAID)) {
    state.toH -= 20;
    state.toA += 8;
    state.skills[SKILL.DEVICE] = adjustSkillScale(
      state.skills[SKILL.DEVICE] ?? 0,
      -1,
      20,
      0,
    );
  }

  /* Analyze weight (2222-2230). */
  const j = player.upkeep.totalWeight;
  const limit = weightLimit(state);
  if (j > Math.trunc(limit / 2)) {
    state.speed -=
      Math.trunc((j - Math.trunc(limit / 2)) / Math.trunc(limit / 10));
  }
  if (state.speed < 0) state.speed = 0;
  if (state.speed > 199) state.speed = 199;

  /* Apply modifier bonuses (2232-2236). */
  state.toA += at(adj_dex_ta, state.statInd[STAT.DEX] ?? 0);
  state.toD += at(adj_str_td, state.statInd[STAT.STR] ?? 0);
  state.toH += at(adj_dex_th, state.statInd[STAT.DEX] ?? 0);
  state.toH += at(adj_str_th, state.statInd[STAT.STR] ?? 0);

  /* Modify skills (2239-2250). */
  applySkillStatAndLevel(state.skills, cls, player.lev, state.statInd);
  state.hold = at(adj_str_hold, state.statInd[STAT.STR] ?? 0);

  /* Analyze launcher (2254-2288). object_weight_one is per-item weight; a
     wielded launcher has number 1. */
  state.heavyShoot = false;
  if (launcher) {
    const launcherWeight = launcher.weight;
    if (state.hold < Math.trunc(launcherWeight / 10)) {
      state.toH += 2 * (state.hold - Math.trunc(launcherWeight / 10));
      state.heavyShoot = true;
    }
    state.numShots = 10;
    if (launcher.kind.kindFlags.has(KF.SHOOTS_SHOTS)) state.ammoTval = TV.SHOT;
    else if (launcher.kind.kindFlags.has(KF.SHOOTS_ARROWS)) state.ammoTval = TV.ARROW;
    else if (launcher.kind.kindFlags.has(KF.SHOOTS_BOLTS)) state.ammoTval = TV.BOLT;
    state.ammoMult = launcher.pval;
    if (!state.heavyShoot) {
      state.numShots += extraShots;
      state.ammoMult += extraMight;
      if (state.pflags.has(PF.FAST_SHOT)) {
        state.numShots += Math.trunc(player.lev / 3);
      }
    }
    if (state.numShots < 10) state.numShots = 10;
  }

  /* Analyze weapon (2291-2319). An empty weapon slot uses the unarmed branch
     (2316-2319); a too-heavy weapon keeps num_blows at its 1-blow default. */
  state.heavyWield = false;
  state.blessWield = false;
  if (weapon) {
    const weaponWeight = weapon.weight;
    if (state.hold < Math.trunc(weaponWeight / 10)) {
      state.toH += 2 * (state.hold - Math.trunc(weaponWeight / 10));
      state.heavyWield = true;
    }
    if (!state.heavyWield) {
      state.numBlows = calcBlows(
        cls,
        weaponWeight,
        state.statInd[STAT.STR] ?? 0,
        state.statInd[STAT.DEX] ?? 0,
        extraBlows,
      );
      state.skills[SKILL.DIGGING] =
        (state.skills[SKILL.DIGGING] ?? 0) + Math.trunc(weaponWeight / 10);
    }
    if (
      state.pflags.has(PF.BLESS_WEAPON) &&
      (weapon.tval === TV.HAFTED || state.flags.has(OF.BLESSED))
    ) {
      state.toD += 2;
      state.blessWield = true;
    }
  } else {
    /* Unarmed (2316-2319). */
    state.numBlows = calcBlows(
      cls,
      null,
      state.statInd[STAT.STR] ?? 0,
      state.statInd[STAT.DEX] ?? 0,
      extraBlows,
    );
  }

  /* Mana (2321-2325): calc_mana DEFERRED. The PF_NO_MANA check reads
     p->msp, which is 0 until calc_mana is ported (correct for warriors;
     see the ledger for the caster caveat). */
  if (!player.msp) {
    state.pflags.on(PF.NO_MANA);
  }

  /* Movement speed (2327-2328): num_moves = extra_moves. */
  state.numMoves = extraMoves;

  return state;
}

/* ------------------------------------------------------------------ */
/* Inventory ordering (earlier_object)                                 */
/* ------------------------------------------------------------------ */

/**
 * The hooks earlier_object reads off the globals it can't see in isolation:
 * player->state.ammo_tval (usable-ammo preference), object_value(obj, 1),
 * object_flavor_is_aware(obj) and obj_can_browse(obj). Each defaults to the
 * value that makes its branch a no-op (ammoTval 0, value 0, aware, not a
 * browsable book), so a caller comparing ammo only needs ammoTval + objectValue.
 */
export interface EarlierObjectOpts {
  /** `store` argument (skips the book / flavor / light branches). */
  store?: boolean;
  /** player->state.ammo_tval: the currently-usable ammo tval. */
  ammoTval?: number;
  /** object_value(obj, 1): the per-item price used for the value tiebreak. */
  objectValue?: (obj: GameObject) => number;
  /** object_flavor_is_aware(obj): defaults to aware (true). */
  isAware?: (obj: GameObject) => boolean;
  /** obj_can_browse(obj): a readable spellbook. Defaults to false. */
  canBrowse?: (obj: GameObject) => boolean;
}

/**
 * earlier_object (player-calcs.c:934-1003): decide whether `next` should
 * replace `orig` as the object that comes earlier in the standard inventory
 * listing (returns true to replace). Ported statement-for-statement; the
 * globals earlier_object reads (player->state.ammo_tval, object_value,
 * object_flavor_is_aware, obj_can_browse) arrive through EarlierObjectOpts.
 * `pval` (light fuel) is read straight off the object.
 */
export function earlierObject(
  orig: GameObject | null,
  next: GameObject | null,
  opts: EarlierObjectOpts = {},
): boolean {
  /* Check we have actual objects (938-940). */
  if (!next) return false;
  if (!orig) return true;

  const store = opts.store ?? false;
  const ammoTval = opts.ammoTval ?? 0;
  const value = opts.objectValue ?? (() => 0);
  const aware = opts.isAware ?? (() => true);
  const canBrowse = opts.canBrowse ?? (() => false);

  if (!store) {
    /* Readable books always come first (943-945). */
    if (canBrowse(orig) && !canBrowse(next)) return false;
    if (!canBrowse(orig) && canBrowse(next)) return true;
  }

  /* Usable ammo is before other ammo (948-956). */
  if (tvalIsAmmo(orig.tval) && tvalIsAmmo(next.tval)) {
    if (ammoTval === orig.tval && ammoTval !== next.tval) return false;
    if (ammoTval !== orig.tval && ammoTval === next.tval) return true;
  }

  /* Objects sort by decreasing type (959-961). */
  if (orig.tval > next.tval) return false;
  if (orig.tval < next.tval) return true;

  if (!store) {
    /* Non-aware (flavored) items always come last (966-969). */
    if (!aware(next)) return false;
    if (!aware(orig)) return true;
  }

  /* Objects sort by increasing sval (972-974). */
  if (orig.sval < next.sval) return false;
  if (orig.sval > next.sval) return true;

  if (!store) {
    /* Unaware objects always come last (977-979). The port marks a kind as
     * flavored by tval (tvalCanHaveFlavor), the same convention obj/value.ts and
     * obj/desc.ts use, since bound ObjectKind carries no flavor pointer. */
    if (tvalCanHaveFlavor(next.tval) && !aware(next)) return false;
    if (tvalCanHaveFlavor(orig.tval) && !aware(orig)) return true;

    /* Lights sort by decreasing fuel (982-985). */
    if (tvalIsLight(orig.tval)) {
      if (orig.pval > next.pval) return false;
      if (orig.pval < next.pval) return true;
    }
  }

  /* Objects sort by decreasing value, except ammo which sorts increasing
   * (988-999). */
  if (tvalIsAmmo(orig.tval)) {
    if (value(orig) < value(next)) return false;
    if (value(orig) > value(next)) return true;
  } else {
    if (value(orig) > value(next)) return false;
    if (value(orig) < value(next)) return true;
  }

  /* No preference (1002). */
  return false;
}

/* ------------------------------------------------------------------ */
/* Adapters for the combat and turn-loop consumers                     */
/* ------------------------------------------------------------------ */

/**
 * The player_state fields player-attack.c reads as p->state, shaped as
 * combat/melee.ts PlayerCombatState. The skills array is shared, not
 * copied: recompute the state rather than mutating it.
 */
export function toCombatState(state: PlayerState): PlayerCombatState {
  return {
    toH: state.toH,
    toD: state.toD,
    ac: state.ac,
    toA: state.toA,
    skills: state.skills,
    numBlows: state.numBlows,
    ammoMult: state.ammoMult,
    numShots: state.numShots,
    ammoTval: state.ammoTval,
    blessWield: state.blessWield,
  };
}

/**
 * The player_state fields mon-attack.c reads (p->state.ac + p->state.to_a),
 * shaped as combat/mon-melee.ts DefenderState.
 */
export function toDefenderState(state: PlayerState): DefenderState {
  return { ac: state.ac, toA: state.toA };
}

/** Re-export for callers computing HP arrays over all levels. */
export { PY_MAX_LEVEL };
