/**
 * The derived-stat surface of a loadout, and the difference between two of them.
 *
 * WHAT THIS IS FOR. `calc_bonuses` answers "what is this character, wearing
 * this". Two questions need the answer for a loadout the character is NOT
 * wearing: an autoplayer deciding whether to wear, buy or sell a thing, and a
 * player asking what an item would do for them. Both want the SAME answer, and
 * the way to guarantee that is for both to read one derive rather than each
 * summing the item's own bonuses. `PlayerState` is that derive; this module is
 * the readable, serializable, diffable projection of it.
 *
 * WHY IT IS THE WHOLE SURFACE AND NOT A SCORE. An autoplayer collapses the
 * answer to one number, so it would have been cheaper to return that number.
 * A number cannot be shown to a player, cannot say WHICH resist was lost, and
 * cannot be extended without changing what every caller receives. So every
 * field of player_state is here, named, with the vector fields kept as vectors
 * and the flag sets kept as code names.
 *
 * SPEED IS NOT A FIELD OF player_state ALONE. maxHp comes from calc_hitpoints
 * over the derived CON index and maxSp from calc_mana over the derived stat
 * indices and the worn armour weight; both change when a ring of CON or a heavy
 * cuirass goes on, and a comparison that omitted them would show a plain
 * upgrade for gear that costs a caster half their mana. They are carried here
 * beside the state's own fields, and the caller supplies them.
 */

import { ELEMENT_ENTRIES, OBJECT_FLAG_ENTRIES, PLAYER_FLAG_ENTRIES } from "../generated/index.js";
import type { FlagSet } from "../bitflag.js";
import type { PlayerState } from "./calcs.js";

/** OF_* code names for the set flags in an object-flag set (OF is 1-indexed). */
function objectFlagCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = OBJECT_FLAG_ENTRIES[f - 1];
    if (entry) out.push(entry.name);
  }
  return out;
}

/** PF_* code names for the set flags in a player-flag set (entry index == PF). */
function playerFlagCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = PLAYER_FLAG_ENTRIES[f];
    if (entry) out.push(entry.name);
  }
  return out;
}

/**
 * The facts about a loadout that do not come out of calc_bonuses, which the
 * caller derives from the same state (see the module header).
 */
export interface DerivedStatsExtras {
  /** calc_hitpoints over the derived CON index: p->mhp for this loadout. */
  maxHp: number;
  /** calc_mana over the derived stat indices and worn armour: p->msp. */
  maxSp: number;
  /** state->cumber_armor, which calc_mana owns rather than calc_bonuses. */
  cumberArmor: boolean;
  /** p->upkeep->total_weight for this loadout, in tenth pounds. */
  totalWeight: number;
  /** weight_limit(state): the STR-derived carrying capacity, tenth pounds. */
  weightLimit: number;
}

/**
 * Every derived fact about a character wearing one particular loadout: the whole
 * of upstream's player_state, plus the four values calc_bonuses does not own.
 * Plain data throughout (arrays and code names, no FlagSet), so it crosses a
 * worker boundary and can be shown to a player as it stands.
 */
export interface DerivedStatsView {
  /** state->speed (110 = normal, 0..199 after the weight penalty). */
  speed: number;
  /** state->ac: the base armour of the worn pieces. */
  baseAc: number;
  /** state->to_a: the armour BONUS (magical plusses, DEX, timed effects). */
  toA: number;
  /** The armour class as the character sheet prints it: state->ac + to_a. */
  ac: number;
  /** state->to_h, excluding the wielded weapon's own plus (applied at attack). */
  toH: number;
  /** state->to_d, on the same terms as toH. */
  toD: number;
  /** state->num_blows, in HUNDREDTHS of a blow (100 == one blow). */
  blows: number;
  /** state->num_shots, in TENTHS of a shot (10 == one shot). */
  shots: number;
  /** state->num_moves: extra movement actions. */
  moves: number;
  /** state->ammo_mult: the launcher's multiplier. */
  ammoMult: number;
  /** state->ammo_tval: the ammunition the launcher takes (0 = none). */
  ammoTval: number;
  /** state->dam_red: flat damage reduction. */
  damRed: number;
  /** state->perc_dam_red: percentage damage reduction. */
  percDamRed: number;
  /** state->see_infra: infravision range in grids. */
  seeInfra: number;
  /** state->cur_light: light radius (calc_light). */
  light: number;
  /** adj_str_hold[STR]: the weapon weight this character carries comfortably. */
  hold: number;
  /** state->heavy_wield: the wielded weapon is too heavy for this STR. */
  heavyWield: boolean;
  /** state->heavy_shoot: the launcher is too heavy for this STR. */
  heavyShoot: boolean;
  /** state->bless_wield: a PF_BLESS_WEAPON class is content with its weapon. */
  blessWield: boolean;
  /** state->cumber_armor: worn armour over the class allowance costs mana. */
  cumberArmor: boolean;
  /** state->stat_add[], STAT order: the equipment's stat modifiers. */
  statAdd: number[];
  /** state->stat_use[], STAT order: the stats in play. */
  statUse: number[];
  /** state->stat_top[], STAT order: the same before drain. */
  statTop: number[];
  /** state->stat_ind[], STAT order: the adj_* table indices. */
  statInd: number[];
  /** state->skills[], SKILL order. */
  skills: number[];
  /** el_info[].res_level per element, ELEM order (see resistElements). */
  resists: number[];
  /** The element name for each entry of `resists`, in the same order. */
  resistElements: string[];
  /** OF_* code names set in state->flags. */
  objectFlags: string[];
  /** PF_* code names set in state->pflags. */
  playerFlags: string[];
  /** calc_hitpoints for this loadout. */
  maxHp: number;
  /** calc_mana for this loadout. */
  maxSp: number;
  /** p->upkeep->total_weight for this loadout, tenth pounds. */
  totalWeight: number;
  /** weight_limit(state), tenth pounds. */
  weightLimit: number;
}

/**
 * Project a derived PlayerState (plus the four values calc_bonuses does not
 * own) into plain data. Copies every array, so the result cannot alias a live
 * derive that a later refresh replaces.
 */
export function derivedStatsView(
  state: PlayerState,
  extras: DerivedStatsExtras,
): DerivedStatsView {
  return {
    speed: state.speed,
    baseAc: state.ac,
    toA: state.toA,
    ac: state.ac + state.toA,
    toH: state.toH,
    toD: state.toD,
    blows: state.numBlows,
    shots: state.numShots,
    moves: state.numMoves,
    ammoMult: state.ammoMult,
    ammoTval: state.ammoTval,
    damRed: state.damRed,
    percDamRed: state.percDamRed,
    seeInfra: state.seeInfra,
    light: state.curLight,
    hold: state.hold,
    heavyWield: state.heavyWield,
    heavyShoot: state.heavyShoot,
    blessWield: state.blessWield,
    cumberArmor: extras.cumberArmor,
    statAdd: [...state.statAdd],
    statUse: [...state.statUse],
    statTop: [...state.statTop],
    statInd: [...state.statInd],
    skills: [...state.skills],
    resists: state.elInfo.map((el) => el.resLevel),
    resistElements: state.elInfo.map(
      (_el, i) => ELEMENT_ENTRIES[i]?.name ?? String(i),
    ),
    objectFlags: objectFlagCodes(state.flags),
    playerFlags: playerFlagCodes(state.pflags),
    maxHp: extras.maxHp,
    maxSp: extras.maxSp,
    totalWeight: extras.totalWeight,
    weightLimit: extras.weightLimit,
  };
}

/**
 * What changes between two loadouts.
 *
 * NUMBERS ONLY, plus the flag names gained and lost. A boolean has no
 * difference - "heavy_wield went from false to true" is two facts, not one
 * number - so the four boolean fields are read from the before and after views
 * instead of appearing here. That is a deliberate shape: a three-state
 * `true | false | null` field reads as a number that happens to be a boolean and
 * is wrong at every call site that forgets the null.
 */
export interface DerivedStatsDelta {
  speed: number;
  baseAc: number;
  toA: number;
  ac: number;
  toH: number;
  toD: number;
  blows: number;
  shots: number;
  moves: number;
  ammoMult: number;
  damRed: number;
  percDamRed: number;
  seeInfra: number;
  light: number;
  hold: number;
  maxHp: number;
  maxSp: number;
  totalWeight: number;
  weightLimit: number;
  /** Per-stat differences, STAT order. */
  statAdd: number[];
  statUse: number[];
  statTop: number[];
  statInd: number[];
  /** Per-skill differences, SKILL order. */
  skills: number[];
  /** Per-element res_level differences, ELEM order. */
  resists: number[];
  /** OF_* codes the after loadout has and the before one did not. */
  objectFlagsGained: string[];
  /** OF_* codes the before loadout had and the after one does not. */
  objectFlagsLost: string[];
  /** PF_* codes gained / lost, on the same terms. */
  playerFlagsGained: string[];
  playerFlagsLost: string[];
  /**
   * Whether anything in this delta is nonzero or non-empty. False means the two
   * loadouts derive identically, which is the honest answer for a swap between
   * two items with the same properties.
   */
  changed: boolean;
}

/** Element-wise difference of two equal-length numeric vectors. */
function diffVector(before: readonly number[], after: readonly number[]): number[] {
  const n = Math.max(before.length, after.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = (after[i] ?? 0) - (before[i] ?? 0);
  return out;
}

/** The names in `after` that are absent from `before`. */
function gained(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before);
  return after.filter((name) => !had.has(name));
}

/** after - before, over the whole derived surface (see DerivedStatsDelta). */
export function diffDerivedStats(
  before: DerivedStatsView,
  after: DerivedStatsView,
): DerivedStatsDelta {
  const delta: DerivedStatsDelta = {
    speed: after.speed - before.speed,
    baseAc: after.baseAc - before.baseAc,
    toA: after.toA - before.toA,
    ac: after.ac - before.ac,
    toH: after.toH - before.toH,
    toD: after.toD - before.toD,
    blows: after.blows - before.blows,
    shots: after.shots - before.shots,
    moves: after.moves - before.moves,
    ammoMult: after.ammoMult - before.ammoMult,
    damRed: after.damRed - before.damRed,
    percDamRed: after.percDamRed - before.percDamRed,
    seeInfra: after.seeInfra - before.seeInfra,
    light: after.light - before.light,
    hold: after.hold - before.hold,
    maxHp: after.maxHp - before.maxHp,
    maxSp: after.maxSp - before.maxSp,
    totalWeight: after.totalWeight - before.totalWeight,
    weightLimit: after.weightLimit - before.weightLimit,
    statAdd: diffVector(before.statAdd, after.statAdd),
    statUse: diffVector(before.statUse, after.statUse),
    statTop: diffVector(before.statTop, after.statTop),
    statInd: diffVector(before.statInd, after.statInd),
    skills: diffVector(before.skills, after.skills),
    resists: diffVector(before.resists, after.resists),
    objectFlagsGained: gained(before.objectFlags, after.objectFlags),
    objectFlagsLost: gained(after.objectFlags, before.objectFlags),
    playerFlagsGained: gained(before.playerFlags, after.playerFlags),
    playerFlagsLost: gained(after.playerFlags, before.playerFlags),
    changed: false,
  };
  delta.changed =
    delta.speed !== 0 ||
    delta.baseAc !== 0 ||
    delta.toA !== 0 ||
    delta.toH !== 0 ||
    delta.toD !== 0 ||
    delta.blows !== 0 ||
    delta.shots !== 0 ||
    delta.moves !== 0 ||
    delta.ammoMult !== 0 ||
    delta.damRed !== 0 ||
    delta.percDamRed !== 0 ||
    delta.seeInfra !== 0 ||
    delta.light !== 0 ||
    delta.hold !== 0 ||
    delta.maxHp !== 0 ||
    delta.maxSp !== 0 ||
    delta.totalWeight !== 0 ||
    delta.weightLimit !== 0 ||
    after.ammoTval !== before.ammoTval ||
    after.heavyWield !== before.heavyWield ||
    after.heavyShoot !== before.heavyShoot ||
    after.blessWield !== before.blessWield ||
    after.cumberArmor !== before.cumberArmor ||
    delta.statAdd.some((v) => v !== 0) ||
    delta.statUse.some((v) => v !== 0) ||
    delta.statTop.some((v) => v !== 0) ||
    delta.statInd.some((v) => v !== 0) ||
    delta.skills.some((v) => v !== 0) ||
    delta.resists.some((v) => v !== 0) ||
    delta.objectFlagsGained.length > 0 ||
    delta.objectFlagsLost.length > 0 ||
    delta.playerFlagsGained.length > 0 ||
    delta.playerFlagsLost.length > 0;
  return delta;
}
