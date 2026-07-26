/**
 * Object inspection, ported from reference/src/obj-info.c (Angband 4.2.6):
 * object_info_out (L2315) and its describe_* helpers, obj_known_blows (L864),
 * obj_known_damage / o_obj_known_damage (L1023 / L1264), obj_known_digging
 * (L1813), obj_known_light (L1914), obj_known_effect / describe_effect
 * (L2013 / L2060), describe_combat (L1752), describe_origin (L2177) and
 * describe_flavor_text (L2252).
 *
 * The engine is a PURE READ: it reproduces upstream's block order, separators,
 * wording, punctuation, colours (COLOUR_* -> color.ts) and integer math, and
 * MUST NOT draw from the game RNG. Every value comes from deterministic reads
 * or randcalc(timeout, MINIMISE/MAXIMISE) fixed bounds; calcBonuses /
 * calcBlows / calcDiggingChances / breakageChance are deterministic given
 * state, and the hypothetical-wield re-derive is driven through a deps closure
 * that must pass update=false and never roll. See object-info.test.ts for the
 * RNG-invariance guard.
 *
 * The result is a Textblock: an ordered list of coloured runs with literal
 * '\n' in the text (the faithful analogue of z-textblock's textblock_append /
 * textblock_append_c). Word-wrapping to a display width is a presentation
 * concern left to the shell (packages/web wrapRuns), so the core emits logical
 * lines only, exactly as the character-dump path needs.
 *
 * Game-layer data the upstream reads from globals (the player, the rune env,
 * the projection table, the monster-race registry, the built effect chain, the
 * constants and options) is injected via ObjectInfoDeps rather than reached
 * from a live GameState, so the engine is reusable by inspect, the store look
 * command and object recall without a second divergent copy.
 */

import {
  COLOUR_GREEN,
  COLOUR_L_GREEN,
  COLOUR_L_RED,
  COLOUR_L_WHITE,
  COLOUR_RED,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color";
import { OF, OBJ_MOD } from "../generated";
import { ORIGIN, ORIGIN_ENTRIES } from "../generated/origins";
import {
  MELEE_CRIT,
  MELEE_CRIT_LEVELS,
  RANGED_CRIT,
  RANGED_CRIT_LEVELS,
  type CriticalLevel,
} from "../combat/hit";
import { chanceOfMeleeHitBase } from "../combat/melee";
import { chanceOfMissileHitBase } from "../combat/ranged";
import type { PlayerCombatState } from "../combat/melee";
import type { PlayerState } from "../player/calcs";
import type { Player } from "../player/player";
import { SKILL, STAT_MAX } from "../player/types";
import type { RandomValue } from "../rng";
import type { ProjectionInfo } from "../world/projection";
import type { RuneEnv } from "./knowledge";
import { OBJ_NOTICE, objectHasStandardToH, sustainFlag } from "./knowledge";
import type { KnownDesc } from "./known-object";
import {
  objectEffectIsKnown,
  objectFullyKnown,
  objectKnownShadow,
} from "./known-object";
import type { CurseData, GameObject } from "./object";
import {
  copyBrands,
  copySlays,
  objectWeightOne,
  tvalIsAmmo,
  tvalIsEdible,
  tvalIsFuel,
  tvalIsLight,
  tvalIsMeleeWeapon,
  tvalIsPotion,
  tvalIsRod,
  tvalIsScroll,
  tvalIsStaff,
  tvalIsUseable,
  tvalIsWand,
  tvalIsWeapon,
  tvalIsWearable,
} from "./object";
import {
  EL_INFO_HATES,
  EL_INFO_IGNORE,
  ELEM_MAX,
  OBJ_MOD_MAX,
  OBJ_PROPERTY,
  OFT,
  type ObjectProperty,
} from "./types";

/* ------------------------------------------------------------------ *
 * OINFO modes (obj-info.h L28-35). Values MUST match upstream so the
 * EGO / FAKE / TERSE / SPOIL gates in describe_stats / get_known_flags /
 * get_known_elements stay correct when the character dump, store look and
 * ego-recall reuse the engine.
 * ------------------------------------------------------------------ */
export const OINFO = {
  NONE: 0x00,
  TERSE: 0x01,
  SUBJ: 0x02,
  EGO: 0x04,
  FAKE: 0x08,
  SPOIL: 0x10,
} as const;

/* ------------------------------------------------------------------ *
 * Textblock (z-textblock analogue).
 * ------------------------------------------------------------------ */

/** One coloured run of text; '\n' stays literal inside `text`. */
export interface TextRun {
  text: string;
  /** COLOUR_* attr (color.ts). */
  attr: number;
}

/** The run-stream object_info returns. */
export interface Textblock {
  runs: TextRun[];
}

function tbNew(): Textblock {
  return { runs: [] };
}

/** textblock_append: default (white) colour. */
function tbAppend(tb: Textblock, text: string): void {
  if (text.length > 0) tb.runs.push({ text, attr: COLOUR_WHITE });
}

/** textblock_append_c: coloured. */
function tbAppendC(tb: Textblock, attr: number, text: string): void {
  if (text.length > 0) tb.runs.push({ text, attr });
}

/** Concatenate the entire run-stream text (tests / plain readouts). */
export function textblockToString(tb: Textblock): string {
  let s = "";
  for (const r of tb.runs) s += r.text;
  return s;
}

/* ------------------------------------------------------------------ *
 * Dependency bag.
 * ------------------------------------------------------------------ */

/** o-*-critical constants (z_info) for the O-combat damage path. */
export interface OCritConstants {
  powerTohScaleNumerator?: number;
  powerTohScaleDenominator?: number;
  powerLaunchedTohScaleNumerator?: number;
  powerLaunchedTohScaleDenominator?: number;
  powerThrownTohScaleNumerator?: number;
  powerThrownTohScaleDenominator?: number;
  chancePowerScaleNumerator: number;
  chancePowerScaleDenominator: number;
  chanceAddDenominator: number;
  levels: readonly { chance: number; dice: number; msg: string }[];
}

/** z_info scalars the engine reads. */
export interface ObjectInfoConstants {
  fuelLamp: number;
  maxRange: number;
  oMeleeCritical: OCritConstants;
  oRangedCritical: OCritConstants;
}

/**
 * The effect-description seam. The bridge builds the object_effect(obj) chain
 * (obj-cmd.ts buildObjectEffectChain over obj.activation?.effect ?? obj.effect)
 * and provides a describeEffect closure with the projection table baked in, so
 * the core stays free of the effects-interpreter and the game layer.
 */
export interface ObjectInfoEffectDeps {
  /**
   * effect_describe(effect, prefix, boost, false): the "When used, it ..."
   * sentence, or null when the chain has nothing to say. Returns plain text
   * (the port's effect-info dropped digit-colouring).
   */
  describe(prefix: string | null, boost: number, onlyFirst: boolean): string | null;
  /** effect_aim(object_effect(obj)): the effect requires a target. */
  aimed: boolean;
  /** get_use_device_chance(obj) out of 1000; used only for zappers/rods. */
  deviceFailure: number;
}

/** A resolved monster-race origin (describe_origin). */
export interface OriginRace {
  name: string;
  unique: boolean;
  comma: boolean;
}

/** Everything object_info_out reads that a live GameState cannot supply pure. */
export interface ObjectInfoDeps {
  player: Player;
  env: RuneEnv;
  known: KnownDesc;
  /** Full ProjectionInfo[] indexed by PROJ value (element names etc). */
  projections: readonly ProjectionInfo[];
  z: ObjectInfoConstants;
  /** OPT(player, birth_percent_damage). */
  percentDamage: boolean;
  /** OPT(player, birth_randarts). */
  randarts: boolean;
  /** The player's real derived state (player->state): ammo, missile crits, speed. */
  currentState: PlayerState;
  /** turn_energy(player->state.speed), for the recharge line. */
  speedMultiplier: number;
  /** The player's current equipped objects, indexed by body slot (null = empty). */
  equipObjects: readonly (GameObject | null)[];
  /** equipped_item_by_slot_name(player, "shooting"): the launcher, or null. */
  bow: GameObject | null;
  /** slot_by_name(player, "weapon"): the body-slot index of the weapon. */
  weaponSlot: number;
  /** wield_slot(obj): the body-slot the object would occupy (digging). */
  wieldSlot(obj: GameObject): number;
  /**
   * Hypothetical calc_bonuses: calcBonuses(player, { equipment, update: false,
   * statIndBoost: { str, dex }, ...liveOptions }). The clone with the inspected
   * object placed in a slot is built by the engine; the closure only derives.
   */
  deriveState(
    equip: readonly (GameObject | null)[],
    strBoost: number,
    dexBoost: number,
  ): PlayerState;
  /** Resolve GameObject.originRace (a handle) to a race name + flags, or null. */
  raceOrigin?(handle: number): OriginRace | null;
  /** breakage_chance(obj, true) (combat/ranged.ts). */
  breakageChance(obj: GameObject): number;
  /** calc_digging_chances(skill) (game/cave-cmd.ts): chances out of 1600. */
  calcDiggingChances(diggingSkill: number): number[];
  /** obj_can_browse(obj): a book the player's class can read. Defaults false. */
  canBrowse?(obj: GameObject): boolean;
  /** The object_effect(obj) description seam. */
  effect: ObjectInfoEffectDeps;
  /** object_is_in_store(obj): inspect from a store. Defaults false. */
  inStore?: boolean;
}

/* ------------------------------------------------------------------ *
 * Small helpers.
 * ------------------------------------------------------------------ */

/** randcalc(v, 0, MINIMISE). */
function rvMin(v: RandomValue): number {
  return v.base + v.dice;
}
/** randcalc(v, 0, MAXIMISE). */
function rvMax(v: RandomValue): number {
  return v.base + v.dice * v.sides + v.mBonus;
}

/** is_a_vowel (z-util.c). */
function isAVowel(c: string): boolean {
  return "aeiouAEIOU".includes(c);
}

/** C "%+i" (always-signed integer). */
function plusI(n: number): string {
  return n < 0 ? String(n) : `+${n}`;
}

/** Substitute %s placeholders left to right. */
function sprintfS(fmt: string, ...args: string[]): string {
  let i = 0;
  return fmt.replace(/%s/g, () => args[i++] ?? "");
}

function lookupProp(
  env: RuneEnv,
  type: number,
  propIndex: number,
): ObjectProperty | null {
  for (const p of env.properties) {
    if (p && p.type === type && p.propIndex === propIndex) return p;
  }
  return null;
}

/** object_to_hit(obj->known) (obj-util.c L296): shadow to-hit plus curses. */
function objToHit(o: GameObject, env: RuneEnv): number {
  let result = o.toH;
  if (o.curses) {
    for (let i = 1; i < env.curses.length; i++) {
      if (o.curses[i]?.power) result += env.curses[i]?.obj.toH ?? 0;
    }
  }
  return result;
}
/** object_to_dam(obj->known). */
function objToDam(o: GameObject, env: RuneEnv): number {
  let result = o.toD;
  if (o.curses) {
    for (let i = 1; i < env.curses.length; i++) {
      if (o.curses[i]?.power) result += env.curses[i]?.obj.toD ?? 0;
    }
  }
  return result;
}

/** info_out_list (obj-info.c L78): "a, b, c.\n". */
function infoOutList(tb: Textblock, list: string[]): void {
  for (let i = 0; i < list.length; i++) {
    tbAppend(tb, list[i] as string);
    if (i !== list.length - 1) tbAppend(tb, ", ");
  }
  tbAppend(tb, ".\n");
}

/* ------------------------------------------------------------------ *
 * Element info view (get_known_elements, obj-info.c L814).
 * ------------------------------------------------------------------ */

interface ElView {
  resLevel: number;
  flags: number;
}

function getKnownElements(
  obj: GameObject,
  shadow: GameObject,
  p: Player,
  mode: number,
): ElView[] {
  const out: ElView[] = [];
  for (let i = 0; i < ELEM_MAX; i++) {
    const known = p.objKnown.elInfo[i]?.resLevel ?? 0;
    let resLevel = 0;
    if (known || mode & OINFO.SPOIL) {
      resLevel = shadow.elInfo[i]?.resLevel ?? 0;
    }
    let flags = shadow.elInfo[i]?.flags ?? 0;
    /* Ignoring an element. */
    if ((obj.elInfo[i]?.flags ?? 0) & EL_INFO_IGNORE) {
      if ((obj.elInfo[i]?.flags ?? 0) & EL_INFO_HATES) {
        flags &= ~EL_INFO_HATES;
      } else {
        flags &= ~EL_INFO_IGNORE;
      }
    }
    if (mode & OINFO.TERSE) flags &= ~EL_INFO_HATES;
    out.push({ resLevel, flags });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * describe_* helpers (obj-info.c).
 * ------------------------------------------------------------------ */

function describeCurses(tb: Textblock, shadow: GameObject, env: RuneEnv): boolean {
  const c = shadow.curses;
  if (!c) return false;
  for (let i = 1; i < env.curses.length; i++) {
    if (c[i]?.power) {
      tbAppend(tb, "It ");
      tbAppendC(tb, COLOUR_L_RED, env.curses[i]?.desc ?? "");
      if (c[i]?.power === 100) tbAppend(tb, "; this curse cannot be removed");
      tbAppend(tb, ".\n");
    }
  }
  return true;
}

function describeStats(
  tb: Textblock,
  shadow: GameObject,
  env: RuneEnv,
  mode: number,
  aware: boolean,
): boolean {
  const suppressDetails = (mode & (OINFO.EGO | OINFO.FAKE)) !== 0;
  let knownEffect = false;
  if (shadow.ego) knownEffect = true;
  /* tval_can_have_flavor_k && object_flavor_is_aware (jewellery). */
  if (aware) knownEffect = true;

  let count = 0;
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if (shadow.modifiers[i]) count++;
  }
  const detail = count > 0;
  if (!count) return false;

  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    const val = shadow.modifiers[i] ?? 0;
    if (!val) continue;
    const desc =
      lookupProp(env, OBJ_PROPERTY.MOD, i)?.name ??
      lookupProp(env, OBJ_PROPERTY.STAT, i)?.name ??
      "";
    if (detail && !suppressDetails) {
      const attr = val > 0 ? COLOUR_L_GREEN : COLOUR_RED;
      tbAppendC(tb, attr, `${plusI(val)} ${desc}.\n`);
    } else if (knownEffect) {
      tbAppend(tb, `Affects your ${desc}.\n`);
    }
  }
  return true;
}

function describeSlays(tb: Textblock, shadow: GameObject, env: RuneEnv): boolean {
  const s = shadow.slays;
  if (!s) return false;
  if (tvalIsWeapon(shadow.tval) || tvalIsFuel(shadow.tval)) {
    tbAppend(tb, "Slays ");
  } else {
    tbAppend(tb, "It causes your melee attacks to slay ");
  }
  let count = 0;
  for (let i = 1; i < env.slays.length; i++) if (s[i]) count++;
  for (let i = 1; i < env.slays.length; i++) {
    if (!s[i]) continue;
    tbAppend(tb, env.slays[i]?.name ?? "");
    if ((env.slays[i]?.multiplier ?? 0) > 3) tbAppend(tb, " (powerfully)");
    if (count > 1) tbAppend(tb, ", ");
    else tbAppend(tb, ".\n");
    count--;
  }
  return true;
}

function describeBrands(tb: Textblock, shadow: GameObject, env: RuneEnv): boolean {
  const b = shadow.brands;
  if (!b) return false;
  if (tvalIsWeapon(shadow.tval) || tvalIsFuel(shadow.tval)) {
    tbAppend(tb, "Branded with ");
  } else {
    tbAppend(tb, "It brands your melee attacks with ");
  }
  let count = 0;
  for (let i = 1; i < env.brands.length; i++) if (b[i]) count++;
  for (let i = 1; i < env.brands.length; i++) {
    if (!b[i]) continue;
    if ((env.brands[i]?.multiplier ?? 0) < 3) tbAppend(tb, "weak ");
    tbAppend(tb, env.brands[i]?.name ?? "");
    if (count > 1) tbAppend(tb, ", ");
    else tbAppend(tb, ".\n");
    count--;
  }
  return true;
}

function describeElements(
  tb: Textblock,
  el: ElView[],
  projections: readonly ProjectionInfo[],
): boolean {
  let prev = false;
  const collect = (test: (r: number) => boolean): string[] => {
    const out: string[] = [];
    for (let i = 0; i < ELEM_MAX; i++) {
      if (test(el[i]?.resLevel ?? 0)) out.push(projections[i]?.name ?? "");
    }
    return out;
  };
  const imm = collect((r) => r === 3);
  if (imm.length) {
    tbAppend(tb, "Provides immunity to ");
    infoOutList(tb, imm);
    prev = true;
  }
  const res = collect((r) => r === 1);
  if (res.length) {
    tbAppend(tb, "Provides resistance to ");
    infoOutList(tb, res);
    prev = true;
  }
  const vul = collect((r) => r === -1);
  if (vul.length) {
    tbAppend(tb, "Makes you vulnerable to ");
    infoOutList(tb, vul);
    prev = true;
  }
  return prev;
}

function describeProtects(tb: Textblock, flags: GameObject["flags"], env: RuneEnv): boolean {
  const descs: string[] = [];
  for (let i = 1; i < OF.MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.FLAG, i);
    if (!prop || prop.subtype !== OFT.PROT) continue;
    if (flags.has(i)) descs.push(prop.desc);
  }
  if (!descs.length) return false;
  tbAppend(tb, "Provides protection from ");
  infoOutList(tb, descs);
  return true;
}

function describeIgnores(
  tb: Textblock,
  el: ElView[],
  projections: readonly ProjectionInfo[],
): boolean {
  const descs: string[] = [];
  for (let i = 0; i < ELEM_MAX; i++) {
    if ((el[i]?.flags ?? 0) & EL_INFO_IGNORE) descs.push(projections[i]?.name ?? "");
  }
  if (!descs.length) return false;
  tbAppend(tb, "Cannot be harmed by ");
  infoOutList(tb, descs);
  return true;
}

function describeHates(
  tb: Textblock,
  el: ElView[],
  projections: readonly ProjectionInfo[],
): boolean {
  const descs: string[] = [];
  for (let i = 0; i < ELEM_MAX; i++) {
    if ((el[i]?.flags ?? 0) & EL_INFO_HATES) descs.push(projections[i]?.name ?? "");
  }
  if (!descs.length) return false;
  tbAppend(tb, "Can be destroyed by ");
  infoOutList(tb, descs);
  return true;
}

function describeSustains(tb: Textblock, flags: GameObject["flags"], env: RuneEnv): boolean {
  const descs: string[] = [];
  for (let i = 0; i < STAT_MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.STAT, i);
    if (!prop) continue;
    if (flags.has(sustainFlag(i))) descs.push(prop.name);
  }
  if (!descs.length) return false;
  tbAppend(tb, "Sustains ");
  infoOutList(tb, descs);
  return true;
}

function describeMiscMagic(tb: Textblock, flags: GameObject["flags"], env: RuneEnv): boolean {
  let printed = false;
  for (let i = 1; i < OF.MAX; i++) {
    const prop = lookupProp(env, OBJ_PROPERTY.FLAG, i);
    if (!prop) continue;
    if (prop.subtype !== OFT.MISC && prop.subtype !== OFT.MELEE && prop.subtype !== OFT.BAD) {
      continue;
    }
    if (flags.has(i)) {
      tbAppend(tb, `${prop.desc}.  `);
      printed = true;
    }
  }
  if (printed) tbAppend(tb, "\n");
  return printed;
}

/* ------------------------------------------------------------------ *
 * Critical-hit averages (calculate_melee_crits / calculate_missile_crits).
 * ------------------------------------------------------------------ */

interface CritScale {
  mult: number;
  add: number;
  div: number;
  multRound: number;
  addRound: number;
  sclRound: number;
}

/** The shared level-band summation of calculate_*_crits (obj-info.c L488-540). */
function critScale(
  critChance: number,
  weight: number,
  chanceRange: number,
  powerWeightScl: number,
  powerRandom: number,
  levels: readonly CriticalLevel[],
): CritScale {
  const div = 100;
  if (critChance > 0 && levels.length > 0) {
    let minPower = powerWeightScl * weight + 1;
    const maxPower = minPower - 1 + powerRandom;
    let multSum = 0;
    let addSum = 0;
    let i = 0;
    const last = levels.length - 1;
    while (minPower <= maxPower) {
      const lvl = levels[i] as CriticalLevel;
      let w: number;
      if (maxPower < lvl.cutoff || i === last) {
        w = maxPower - minPower + 1;
        minPower = maxPower + 1;
      } else {
        if (minPower >= lvl.cutoff) {
          i++;
          continue;
        }
        w = lvl.cutoff - minPower;
        minPower = lvl.cutoff;
      }
      multSum += w * (lvl.mult - 1);
      addSum += w * lvl.add;
      i++;
    }
    const scale = Math.trunc(chanceRange / div) * powerRandom;
    return {
      mult: div + Math.trunc((critChance * multSum) / scale),
      add: Math.trunc((critChance * addSum) / scale),
      multRound: (critChance * multSum) % scale,
      addRound: (critChance * addSum) % scale,
      sclRound: scale,
      div,
    };
  }
  return { mult: 100, add: 0, div, multRound: 0, addRound: 0, sclRound: 1 };
}

function calculateMeleeCrits(
  deps: ObjectInfoDeps,
  state: PlayerState,
  weight: number,
  plus: number,
): CritScale {
  let critChance =
    MELEE_CRIT.chanceWeightScl * weight +
    MELEE_CRIT.chanceTohScl * (state.toH + plus) +
    MELEE_CRIT.chanceLevelScl * deps.player.lev +
    MELEE_CRIT.chanceTohSkillScl * (state.skills[SKILL.TO_HIT_MELEE] ?? 0) +
    MELEE_CRIT.chanceOffset;
  critChance = Math.min(MELEE_CRIT.chanceRange, Math.max(0, critChance));
  return critScale(
    critChance,
    weight,
    MELEE_CRIT.chanceRange,
    MELEE_CRIT.powerWeightScl,
    MELEE_CRIT.powerRandom,
    MELEE_CRIT_LEVELS,
  );
}

function calculateMissileCrits(
  deps: ObjectInfoDeps,
  state: PlayerState,
  weight: number,
  plus: number,
  launched: boolean,
): CritScale {
  let critChance =
    RANGED_CRIT.chanceWeightScl * weight +
    RANGED_CRIT.chanceTohScl * (state.toH + plus) +
    RANGED_CRIT.chanceLevelScl * deps.player.lev +
    RANGED_CRIT.chanceOffset;
  if (launched) {
    critChance +=
      RANGED_CRIT.chanceLaunchedTohSkillScl *
      (deps.currentState.skills[SKILL.TO_HIT_BOW] ?? 0);
  } else {
    critChance +=
      RANGED_CRIT.chanceThrownTohSkillScl *
      (deps.currentState.skills[SKILL.TO_HIT_THROW] ?? 0);
  }
  critChance = Math.min(RANGED_CRIT.chanceRange, Math.max(0, critChance));
  return critScale(
    critChance,
    weight,
    RANGED_CRIT.chanceRange,
    RANGED_CRIT.powerWeightScl,
    RANGED_CRIT.powerRandom,
    RANGED_CRIT_LEVELS,
  );
}

/* ------------------------------------------------------------------ *
 * my_rational + O-combat crits (obj-info.c L435, L561, L723).
 * JS numbers are 53-bit safe integers, so the upstream multiprecision
 * overflow fallbacks (only reached near UINT_MAX) are not needed for the
 * value ranges here; the native-arithmetic path is ported directly.
 * ------------------------------------------------------------------ */

interface Rational {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

function ratConstruct(n: number, d: number): Rational {
  if (n === 0) return { n: 0, d: 1 };
  const g = gcd(n, d);
  return { n: Math.trunc(n / g), d: Math.trunc(d / g) };
}

function ratToUint(a: Rational, scale: number): { value: number; remainder: number } {
  if (!scale) return { value: 0, remainder: 0 };
  let result = Math.trunc(a.n / a.d) * scale;
  const r = a.n % a.d;
  const q = Math.trunc(scale / a.d);
  result += q * r;
  const r2 = scale - q * a.d;
  const t = r * r2;
  const q2 = Math.trunc(t / a.d);
  result += q2;
  return { value: result, remainder: t - q2 * a.d };
}

function ratProduct(a: Rational, b: Rational): Rational {
  const g1 = gcd(a.n, b.d) || 1;
  const g2 = gcd(a.d, b.n) || 1;
  const anr = Math.trunc(a.n / g1);
  const adr = Math.trunc(a.d / g2);
  const bnr = Math.trunc(b.n / g2);
  const bdr = Math.trunc(b.d / g1);
  return { n: anr * bnr, d: adr * bdr };
}

function ratSum(a: Rational, b: Rational): Rational {
  const g = gcd(a.d, b.d) || 1;
  const adr = Math.trunc(a.d / g);
  const bdr = Math.trunc(b.d / g);
  return ratConstruct(a.n * bdr + b.n * adr, adr * b.d);
}

/** sum_o_criticals (obj-info.c L435). */
function sumOCriticals(levels: readonly { chance: number; dice: number }[]): Rational {
  let remaining = ratConstruct(1, 1);
  let added = ratConstruct(0, 1);
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i] as { chance: number; dice: number };
    const hasNext = i < levels.length - 1;
    let levelAdded = ratConstruct(lvl.dice, hasNext ? lvl.chance : 1);
    levelAdded = ratProduct(levelAdded, remaining);
    added = ratSum(added, levelAdded);
    if (hasNext) {
      remaining = ratProduct(remaining, ratConstruct(lvl.chance - 1, lvl.chance));
    }
  }
  return added;
}

interface OCritResult {
  dice: number;
  fracDice: Rational;
}

function oCalcCrits(
  power0: number,
  powerNum: number,
  powerDen: number,
  crit: OCritConstants,
): OCritResult {
  if (crit.levels.length === 0) return { dice: 0, fracDice: ratConstruct(0, 1) };
  const maxAdded = sumOCriticals(crit.levels);
  let power = Math.trunc((power0 * powerNum) / powerDen);
  const chanceNum = power * crit.chancePowerScaleNumerator;
  const chanceDen =
    power * crit.chancePowerScaleDenominator + crit.chanceAddDenominator;
  if (chanceDen > 0 && chanceNum > 0) {
    if (chanceNum < chanceDen) {
      let t = ratConstruct(chanceNum, chanceDen);
      t = ratProduct(t, maxAdded);
      const { value, remainder } = ratToUint(t, 100);
      return { dice: value, fracDice: ratConstruct(remainder, t.d) };
    }
    const { value, remainder } = ratToUint(maxAdded, 100);
    return { dice: value, fracDice: ratConstruct(remainder, maxAdded.d) };
  }
  return { dice: 0, fracDice: ratConstruct(0, 1) };
}

/** deadliness_conversion[151] (player-attack.c L231). */
const DEADLINESS_CONVERSION: readonly number[] = [
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

/** apply_deadliness (player-attack.c L261): scale die_average by deadliness. */
function applyDeadliness(dieAverage: number, deadliness: number): number {
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

/* ------------------------------------------------------------------ *
 * Hypothetical-wield helpers.
 * ------------------------------------------------------------------ */

/** Clone the current equipment array with `obj` placed in `slot`. */
function equipWith(
  deps: ObjectInfoDeps,
  obj: GameObject,
  slot: number,
): (GameObject | null)[] {
  const eq = deps.equipObjects.slice();
  if (slot >= 0) eq[slot] = obj;
  return eq;
}

function shadowOf(deps: ObjectInfoDeps, o: GameObject): GameObject {
  return objectKnownShadow(o, deps.player, deps.env, deps.known);
}

/* ------------------------------------------------------------------ *
 * obj_known_blows / describe_blows.
 * ------------------------------------------------------------------ */

const STAT_RANGE = 38;

interface BlowInfo {
  strPlus: number;
  dexPlus: number;
  centiblows: number;
}

function objKnownBlows(deps: ObjectInfoDeps, obj: GameObject, maxNum: number): BlowInfo[] {
  if (!tvalIsMeleeWeapon(obj.tval)) return [];
  const equip = equipWith(deps, obj, deps.weaponSlot);
  const out: BlowInfo[] = [];

  /* First entry: the current blows (str/dex boost 0, clamp [3,37]). */
  const base = deps.deriveState(equip, 0, 0);
  out.push({ strPlus: 0, dexPlus: 0, centiblows: base.numBlows });

  const oldBlows = base.numBlows;
  const dexBound = STAT_RANGE - (base.statInd[1] ?? 0);
  const strBound = STAT_RANGE - (base.statInd[0] ?? 0);
  let strFaster = -1;
  let strDone = -1;

  for (let dexPlus = 0; dexPlus < dexBound; dexPlus++) {
    for (let strPlus = 0; strPlus < strBound; strPlus++) {
      if (out.length === maxNum) return out;
      const s = deps.deriveState(equip, strPlus, dexPlus);
      const newBlows = s.numBlows;
      if (
        newBlows - (newBlows % 10) > oldBlows - (oldBlows % 10) &&
        (strPlus < strDone || strDone === -1)
      ) {
        out.push({
          strPlus,
          dexPlus,
          centiblows: Math.trunc(newBlows / 10) * 10,
        });
        strDone = strPlus;
        break;
      }
      if (
        newBlows > oldBlows &&
        (strPlus < strFaster || strFaster === -1) &&
        (strPlus < strDone || strDone === -1)
      ) {
        out.push({ strPlus, dexPlus, centiblows: newBlows });
        strFaster = strPlus;
      }
    }
  }
  return out;
}

function describeBlows(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject): boolean {
  const entries = objKnownBlows(deps, obj, STAT_RANGE * 2);
  if (entries.length === 0) return false;
  const first = entries[0] as BlowInfo;
  tbAppendC(
    tb,
    COLOUR_L_GREEN,
    `${Math.trunc(first.centiblows / 100)}.${Math.trunc(first.centiblows / 10) % 10} `,
  );
  tbAppend(tb, `blow${first.centiblows > 100 ? "s" : ""}/round.\n`);
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i] as BlowInfo;
    if (e.centiblows % 10 === 0) {
      tbAppend(
        tb,
        `With +${e.strPlus} STR and +${e.dexPlus} DEX you would get ${Math.trunc(
          e.centiblows / 100,
        )}.${Math.trunc(e.centiblows / 10) % 10} blows\n`,
      );
    } else {
      tbAppend(
        tb,
        `With +${e.strPlus} STR and +${e.dexPlus} DEX you would attack a bit faster\n`,
      );
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * obj_known_damage (standard) and o_obj_known_damage (O-combat).
 * ------------------------------------------------------------------ */

interface DamageResult {
  normal: number;
  brand: number[];
  slay: number[];
  nonweapSlay: boolean;
  hasBrandsOrSlays: boolean;
}

function collectTotalBrandsSlays(
  deps: ObjectInfoDeps,
  shadow: GameObject,
  weapon: boolean,
  ammo: boolean,
  bowShadow: GameObject | null,
): { brands: boolean[]; slays: boolean[]; nonweapSlay: boolean } {
  const env = deps.env;
  let brands = copyBrands(null, shadow.brands, env.brands) ??
    new Array<boolean>(env.brands.length).fill(false);
  let slays = copySlays(null, shadow.slays, env.slays) ??
    new Array<boolean>(env.slays.length).fill(false);
  if (ammo && bowShadow) {
    brands = copyBrands(brands, bowShadow.brands, env.brands) ?? brands;
    slays = copySlays(slays, bowShadow.slays, env.slays) ?? slays;
  }
  let nonweapSlay = false;
  if (weapon) {
    for (let i = 2; i < deps.player.body.count; i++) {
      const slotObj = env.slotObject(i);
      if (!slotObj) continue;
      const ss = shadowOf(deps, slotObj);
      if (ss.brands || ss.slays) nonweapSlay = true;
      else continue;
      brands = copyBrands(brands, ss.brands, env.brands) ?? brands;
      slays = copySlays(slays, ss.slays, env.slays) ?? slays;
    }
    /* Temporary (timed) brands/slays are DEFERRED with the timed-brand system. */
  }
  return { brands, slays, nonweapSlay };
}

function objKnownDamage(deps: ObjectInfoDeps, obj: GameObject, throwIt: boolean): DamageResult {
  const env = deps.env;
  const shadow = shadowOf(deps, obj);
  const brandDamage = new Array<number>(env.brands.length).fill(0);
  const slayDamage = new Array<number>(env.slays.length).fill(0);
  const bow = deps.bow;
  const weapon = tvalIsMeleeWeapon(obj.tval) && !throwIt;
  const ammo = deps.currentState.ammoTval === obj.tval && !!bow && !throwIt;
  const meleeAdjMult = ammo || throwIt ? 0 : 1;
  let multiplier = 1;

  const state = weapon
    ? deps.deriveState(equipWith(deps, obj, deps.weaponSlot), 0, 0)
    : deps.deriveState(deps.equipObjects.slice(), 0, 0);

  const dice = shadow.dd;
  const sides = shadow.ds;
  if (!dice || !sides) {
    return { normal: 0, brand: brandDamage, slay: slayDamage, nonweapSlay: false, hasBrandsOrSlays: false };
  }
  let dam = (sides + 1) * dice * 5;
  const plus = objToHit(shadow, env);
  let xtraPostcrit = 0;
  let xtraPrecrit = 0;
  let crit: CritScale;
  let oldBlows = 0;
  const weight = objectWeightOne(obj, env.curses);

  if (weapon) {
    xtraPostcrit = state.toD * 10;
    xtraPrecrit += objToDam(shadow, env) * 10;
    crit = calculateMeleeCrits(deps, state, weight, plus);
    oldBlows = state.numBlows;
  } else if (ammo) {
    crit = calculateMissileCrits(deps, deps.currentState, weight, plus, true);
    dam += objToDam(shadow, env) * 10;
    if (bow) dam += objToDam(shadowOf(deps, bow), env) * 10;
  } else {
    crit = calculateMissileCrits(deps, deps.currentState, weight, plus, false);
    dam += objToDam(shadow, env) * 10;
    dam *= 2 + Math.trunc(weight / 12);
  }

  if (ammo) multiplier = deps.currentState.ammoMult;

  const bowShadow = ammo && bow ? shadowOf(deps, bow) : null;
  const { brands, slays, nonweapSlay } = collectTotalBrandsSlays(
    deps, shadow, weapon, ammo, bowShadow,
  );

  let hasBrandsOrSlays = false;
  const numShots = deps.currentState.numShots;

  /* The thrown branch rounds differently per site (brand uses '>', slay uses
     '>=', normal uses '>'), so perHit takes a thrownGe flag. */
  const critTransform = (base: number): { totalDam: number; round: number } => {
    const temp0 = base;
    const temp1 =
      temp0 * crit.mult +
      10 * crit.add +
      Math.trunc((temp0 * crit.multRound + 10 * crit.addRound) / crit.sclRound);
    return { totalDam: Math.trunc(temp1 / crit.div) + xtraPostcrit, round: temp1 % crit.div };
  };
  const perHit = (totalDam: number, round: number, thrownGe: boolean): number => {
    if (weapon) {
      const t = totalDam * oldBlows + Math.trunc((round * oldBlows) / crit.div);
      return Math.trunc(t / 100) + (t % 100 >= 50 ? 1 : 0);
    }
    if (ammo) {
      const t = totalDam * numShots + Math.trunc((round * numShots) / crit.div);
      return Math.trunc(t / 10) + (t % 10 >= 5 ? 1 : 0);
    }
    const half = Math.trunc((crit.div + 1) / 2);
    return totalDam + ((thrownGe ? round >= half : round > half) ? 1 : 0);
  };

  for (let i = 1; i < env.brands.length; i++) {
    if (!brands[i]) continue;
    hasBrandsOrSlays = true;
    const base = dam * (multiplier + (env.brands[i]?.multiplier ?? 0) - meleeAdjMult) + xtraPrecrit;
    const { totalDam, round } = critTransform(base);
    brandDamage[i] = perHit(totalDam, round, false); /* brand: '>' */
  }
  for (let i = 1; i < env.slays.length; i++) {
    if (!slays[i]) continue;
    hasBrandsOrSlays = true;
    const base = dam * (multiplier + (env.slays[i]?.multiplier ?? 0) - meleeAdjMult) + xtraPrecrit;
    const { totalDam, round } = critTransform(base);
    slayDamage[i] = perHit(totalDam, round, true); /* slay: '>=' */
  }
  {
    const base = dam * multiplier + xtraPrecrit;
    const { totalDam, round } = critTransform(base);
    const normal = perHit(totalDam, round, false); /* normal: '>' */
    return { normal, brand: brandDamage, slay: slayDamage, nonweapSlay, hasBrandsOrSlays };
  }
}

function oObjKnownDamage(deps: ObjectInfoDeps, obj: GameObject, throwIt: boolean): DamageResult {
  const env = deps.env;
  const shadow = shadowOf(deps, obj);
  const brandDamage = new Array<number>(env.brands.length).fill(0);
  const slayDamage = new Array<number>(env.slays.length).fill(0);
  const bow = deps.bow;
  const weapon = tvalIsMeleeWeapon(obj.tval) && !throwIt;
  const ammo = deps.currentState.ammoTval === obj.tval && !!bow && !throwIt;
  let multiplier = 1;
  let deadliness = objToDam(shadow, env);

  const state = weapon
    ? deps.deriveState(equipWith(deps, obj, deps.weaponSlot), 0, 0)
    : deps.deriveState(deps.equipObjects.slice(), 0, 0);

  let dice = shadow.dd * 100;
  const sides = shadow.ds;
  if (!dice || !sides) {
    return { normal: 0, brand: brandDamage, slay: slayDamage, nonweapSlay: false, hasBrandsOrSlays: false };
  }
  let oldBlows = 0;
  let fracDice = ratConstruct(0, 1);
  const weight = objectWeightOne(obj, env.curses);

  if (weapon) {
    const power = chanceOfMeleeHitBase(toCombat(state), obj);
    const oc = oCalcCrits(
      power,
      deps.z.oMeleeCritical.powerTohScaleNumerator ?? 1,
      deps.z.oMeleeCritical.powerTohScaleDenominator ?? 1,
      deps.z.oMeleeCritical,
    );
    dice += oc.dice;
    fracDice = oc.fracDice;
    oldBlows = state.numBlows;
  } else if (ammo) {
    const power = chanceOfMissileHitBase(toCombat(deps.currentState), obj, bow);
    const oc = oCalcMissile(power, deps, true);
    dice += oc.dice;
    fracDice = oc.fracDice;
  } else {
    const thrownScl = 2 + Math.trunc(weight / 12);
    const power = chanceOfMissileHitBase(toCombat(deps.currentState), obj, null);
    const oc = oCalcMissile(power, deps, false);
    dice += oc.dice;
    dice *= thrownScl;
    const { value, remainder } = ratToUint(oc.fracDice, thrownScl);
    dice += value;
    fracDice = ratConstruct(remainder, oc.fracDice.d);
  }

  if (ammo) multiplier = deps.currentState.ammoMult;

  let dieAverage = 5 * (sides + 1);
  dieAverage *= multiplier;
  if (ammo && bow) {
    deadliness += objToDam(shadowOf(deps, bow), env) + state.toD;
  } else {
    deadliness += state.toD;
  }
  dieAverage = applyDeadliness(dieAverage, Math.min(deadliness, 150));

  const bowShadow = ammo && bow ? shadowOf(deps, bow) : null;
  const { brands, slays, nonweapSlay } = collectTotalBrandsSlays(
    deps, shadow, weapon, ammo, bowShadow,
  );

  let hasBrandsOrSlays = false;
  const numShots = deps.currentState.numShots;

  const perMult = (oMult: number): number => {
    let average = dieAverage * oMult;
    let round = average % 1000;
    average = Math.trunc(average / 1000);
    const u1 = ratToUint(fracDice, average);
    let temp0 = dice * average + Math.trunc((dice * round) / 1000) + u1.value;
    const fracTemp = ratConstruct(u1.remainder, fracDice.d);
    const u2 = ratToUint(fracTemp, 1000);
    round = ((dice * round) % 1000) + u2.value;
    if (u2.remainder >= Math.trunc((fracTemp.d + 1) / 2)) round++;
    const add = oMult - 10;
    let totalDam: number;
    if (weapon) {
      totalDam = oldBlows * temp0 + Math.trunc((oldBlows * round) / 1000);
      const r = totalDam % 10000;
      totalDam = Math.trunc(totalDam / 10000);
      totalDam += Math.trunc((add * oldBlows) / 10) + (r >= 5000 ? 1 : 0);
    } else if (ammo) {
      totalDam = numShots * temp0 + Math.trunc((numShots * round) / 1000);
      const r = totalDam % 1000;
      totalDam = Math.trunc(totalDam / 1000);
      totalDam += add * numShots + (r >= 500 ? 1 : 0);
    } else {
      totalDam = Math.trunc(temp0 / 100) + add * 10 + (temp0 % 100 >= 50 ? 1 : 0);
    }
    return totalDam;
  };

  for (let i = 1; i < env.brands.length; i++) {
    if (!brands[i]) continue;
    hasBrandsOrSlays = true;
    brandDamage[i] = perMult(env.brands[i]?.oMultiplier ?? 0);
  }
  for (let i = 1; i < env.slays.length; i++) {
    if (!slays[i]) continue;
    hasBrandsOrSlays = true;
    slayDamage[i] = perMult(env.slays[i]?.oMultiplier ?? 0);
  }

  /* Normal damage. */
  const u = ratToUint(fracDice, dieAverage);
  let temp0 = dice * dieAverage + u.value;
  if (u.remainder >= Math.trunc((fracDice.d + 1) / 2)) temp0++;
  let round = temp0 % 1000;
  temp0 = Math.trunc(temp0 / 1000);
  let normal: number;
  if (weapon) {
    normal = oldBlows * temp0 + Math.trunc((oldBlows * round) / 1000);
    round = normal % 1000;
    normal = Math.trunc(normal / 1000);
    normal += round >= 500 ? 1 : 0;
  } else if (ammo) {
    normal = numShots * temp0 + Math.trunc((numShots * round) / 1000);
    round = normal % 100;
    normal = Math.trunc(normal / 100);
    normal += round >= 50 ? 1 : 0;
  } else {
    normal = Math.trunc(temp0 / 10) + (temp0 % 10 >= 5 ? 1 : 0);
  }

  return { normal, brand: brandDamage, slay: slayDamage, nonweapSlay, hasBrandsOrSlays };
}

function oCalcMissile(power: number, deps: ObjectInfoDeps, launched: boolean): OCritResult {
  const c = deps.z.oRangedCritical;
  const num = launched
    ? c.powerLaunchedTohScaleNumerator ?? 1
    : c.powerThrownTohScaleNumerator ?? 1;
  const den = launched
    ? c.powerLaunchedTohScaleDenominator ?? 1
    : c.powerThrownTohScaleDenominator ?? 1;
  return oCalcCrits(power, num, den, c);
}

function toCombat(state: PlayerState): PlayerCombatState {
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

/* ------------------------------------------------------------------ *
 * describe_damage (obj-info.c L1519): sorted, grouped average damage.
 * ------------------------------------------------------------------ */

function describeDamage(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject, throwIt: boolean): boolean {
  const env = deps.env;
  const res = deps.percentDamage
    ? oObjKnownDamage(deps, obj, throwIt)
    : objKnownDamage(deps, obj, throwIt);
  let hasBrandsOrSlays = res.hasBrandsOrSlays;

  if (res.nonweapSlay) {
    tbAppend(tb, "This weapon may benefit from one or more off-weapon brands or slays.\n");
  }
  tbAppend(tb, throwIt ? "Average thrown damage: " : "Average damage/round: ");

  if (hasBrandsOrSlays) {
    const brandMax = env.brands.length;
    const slayMax = env.slays.length;
    const sortind: number[] = [];
    for (let i = 0; i < slayMax; i++) {
      if ((res.slay[i] ?? 0) > 0) sortind.push(i + brandMax);
    }
    for (let i = 0; i < brandMax; i++) {
      if ((res.brand[i] ?? 0) > 0) sortind.push(i);
    }
    const damOf = (ind: number): number =>
      ind < brandMax ? (res.brand[ind] ?? 0) : (res.slay[ind - brandMax] ?? 0);
    /* Insertion sort, descending. */
    for (let i = 0; i < sortind.length - 1; i++) {
      let maxdam = damOf(sortind[i] as number);
      let maxind = i;
      for (let j = i + 1; j < sortind.length; j++) {
        const d = damOf(sortind[j] as number);
        if (maxdam < d) {
          maxdam = d;
          maxind = j;
        }
      }
      if (maxind !== i) {
        const tmp = sortind[maxind] as number;
        sortind[maxind] = sortind[i] as number;
        sortind[i] = tmp;
      }
    }

    let lastdam = 0;
    let groupn = 0;
    let lastnm: string | null = null;
    let lastIsBrand = false;
    for (let i = 0; i < sortind.length; i++) {
      const ind = sortind[i] as number;
      let isBrand: boolean;
      let tgt: string;
      let dam: number;
      if (ind < brandMax) {
        isBrand = true;
        tgt = env.brands[ind]?.name ?? "";
        dam = res.brand[ind] ?? 0;
      } else {
        isBrand = false;
        tgt = env.slays[ind - brandMax]?.name ?? "";
        dam = res.slay[ind - brandMax] ?? 0;
      }

      if (groupn > 0) {
        if (dam !== lastdam) {
          if (groupn > 2) tbAppend(tb, ", and");
          else if (groupn === 2) tbAppend(tb, " and");
        } else if (groupn > 1) {
          tbAppend(tb, ",");
        }
        if (lastIsBrand) tbAppend(tb, " creatures not resistant to");
        tbAppend(tb, ` ${lastnm}`);
      }
      if (dam !== lastdam) {
        if (i !== 0) tbAppend(tb, ", ");
        if (dam % 10) {
          tbAppendC(tb, COLOUR_L_GREEN, `${Math.trunc(dam / 10)}.${dam % 10} vs`);
        } else {
          tbAppendC(tb, COLOUR_L_GREEN, `${Math.trunc(dam / 10)} vs`);
        }
        groupn = 1;
        lastdam = dam;
      } else {
        groupn++;
      }
      lastnm = tgt;
      lastIsBrand = isBrand;
    }
    if (groupn > 0) {
      if (groupn > 2) tbAppend(tb, ", and");
      else if (groupn === 2) tbAppend(tb, " and");
      if (lastIsBrand) tbAppend(tb, " creatures not resistant to");
      tbAppend(tb, ` ${lastnm}`);
    }

    if (sortind.length === 0) {
      hasBrandsOrSlays = false;
    } else {
      tbAppend(tb, sortind.length === 1 ? " and " : ", and ");
    }
  }

  if (res.normal <= 0) {
    tbAppendC(tb, COLOUR_L_RED, "0");
  } else if (res.normal % 10) {
    tbAppendC(tb, COLOUR_L_GREEN, `${Math.trunc(res.normal / 10)}.${res.normal % 10}`);
  } else {
    tbAppendC(tb, COLOUR_L_GREEN, `${Math.trunc(res.normal / 10)}`);
  }

  if (hasBrandsOrSlays) tbAppend(tb, " vs. others");
  tbAppend(tb, ".\n");
  return true;
}

/* ------------------------------------------------------------------ *
 * describe_combat (obj-info.c L1752).
 * ------------------------------------------------------------------ */

function describeCombat(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject): boolean {
  const bow = deps.bow;
  const weapon = tvalIsMeleeWeapon(obj.tval);
  const ammo = deps.currentState.ammoTval === obj.tval && !!bow;
  const throwingWeapon = weapon && obj.flags.has(OF.THROWING);
  const rock = tvalIsAmmo(obj.tval) && obj.flags.has(OF.THROWING);

  /* obj_known_misc_combat. */
  let thrownEffect = false;
  let range = 0;
  let heavy = false;
  if (!weapon && !ammo) {
    if (tvalIsPotion(obj.tval) && obj.dd !== 0 && obj.ds !== 0 && deps.known.isAware(obj.kind)) {
      thrownEffect = true;
    }
  }
  if (ammo) {
    range = 10 * Math.min(6 + 2 * deps.currentState.ammoMult, deps.z.maxRange);
  }
  const breakChance = deps.breakageChance(obj);
  if (weapon) {
    const s = deps.deriveState(equipWith(deps, obj, deps.weaponSlot), 0, 0);
    heavy = s.heavyWield;
  }

  if (!weapon && !ammo && !rock) {
    if (thrownEffect) {
      tbAppend(tb, "It can be thrown at creatures with damaging effect.\n");
      return true;
    }
    return false;
  }

  tbAppendC(tb, COLOUR_L_WHITE, "Combat info:\n");
  if (heavy) tbAppendC(tb, COLOUR_L_RED, "You are too weak to use this weapon.\n");
  describeBlows(tb, deps, obj);
  if (ammo) {
    tbAppend(tb, "When fired, hits targets up to ");
    tbAppendC(tb, COLOUR_L_GREEN, `${range}`);
    tbAppend(tb, " feet away.\n");
  }
  if (weapon || ammo) describeDamage(tb, deps, obj, false);
  if (throwingWeapon || rock) describeDamage(tb, deps, obj, true);
  if (ammo) {
    tbAppendC(tb, COLOUR_L_GREEN, `${breakChance}%`);
    tbAppend(tb, " chance of breaking upon contact.\n");
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * obj_known_digging / describe_digger (obj-info.c L1813 / L1858).
 * ------------------------------------------------------------------ */

const DIGGING_NAMES = ["rubble", "magma veins", "quartz veins", "granite"];

function objKnownDigging(deps: ObjectInfoDeps, obj: GameObject): number[] | null {
  if (
    !tvalIsWearable(obj.tval) ||
    (!tvalIsMeleeWeapon(obj.tval) && (obj.modifiers[OBJ_MOD.TUNNEL] ?? 0) <= 0)
  ) {
    return null;
  }
  const shadow = shadowOf(deps, obj);
  if (!tvalIsMeleeWeapon(obj.tval) && !(shadow.modifiers[OBJ_MOD.TUNNEL] ?? 0)) {
    return null;
  }
  const slot = deps.wieldSlot(obj);
  const state = deps.deriveState(equipWith(deps, obj, slot), 0, 0);
  const chances = deps.calcDiggingChances(state.skills[SKILL.DIGGING] ?? 0);
  const deciturns: number[] = [];
  for (let i = 0; i < 4; i++) {
    const chance = Math.min(1600, chances[i] ?? 0);
    deciturns[i] = chance ? Math.trunc(16000 / chance) : 0;
  }
  return deciturns;
}

function describeDigger(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject): boolean {
  const deciturns = objKnownDigging(deps, obj);
  if (!deciturns) return false;
  for (let i = 0; i < 4; i++) {
    const dt = deciturns[i] as number;
    if (i === 0 && dt > 0) {
      if (tvalIsMeleeWeapon(obj.tval)) tbAppend(tb, "Clears ");
      else tbAppend(tb, "With this item, your current weapon clears ");
    }
    if (i === 3 || (i !== 0 && dt === 0)) tbAppend(tb, "and ");
    if (dt === 0) {
      tbAppendC(tb, COLOUR_L_RED, "doesn't affect ");
      tbAppend(tb, `${DIGGING_NAMES[i]}.\n`);
      break;
    }
    tbAppend(tb, `${DIGGING_NAMES[i]} in `);
    if (dt === 10) {
      tbAppendC(tb, COLOUR_L_GREEN, "1 ");
    } else if (dt < 100) {
      tbAppendC(tb, COLOUR_GREEN, `${Math.trunc(dt / 10)}.${dt % 10} `);
    } else {
      tbAppendC(tb, dt < 1000 ? COLOUR_YELLOW : COLOUR_RED, `${Math.trunc((dt + 5) / 10)} `);
    }
    tbAppend(tb, `turn${dt === 10 ? "" : "s"}${i === 3 ? ".\n" : ", "}`);
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * describe_light (obj-info.c L1914 / L1955).
 * ------------------------------------------------------------------ */

function describeLight(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject, mode: number): boolean {
  const shadow = shadowOf(deps, obj);
  const isLight = tvalIsLight(obj.tval);
  if (!isLight && (obj.modifiers[OBJ_MOD.LIGHT] ?? 0) <= 0) return false;
  let intensity = 0;
  if (obj.flags.has(OF.LIGHT_2)) intensity = 2;
  else if (obj.flags.has(OF.LIGHT_3)) intensity = 3;
  intensity += shadow.modifiers[OBJ_MOD.LIGHT] ?? 0;
  if (intensity === 0) return false;
  const noFuel = shadow.flags.has(OF.NO_FUEL);
  const usesFuel = !(noFuel || shadow.artifact);
  const refuelTurns = isLight && shadow.flags.has(OF.TAKES_FUEL) ? deps.z.fuelLamp : 0;
  const terse = (mode & OINFO.TERSE) !== 0;

  if (isLight) {
    tbAppend(tb, "Intensity ");
    tbAppendC(tb, COLOUR_L_GREEN, `${intensity}`);
    tbAppend(tb, " light.");
    if (!obj.artifact && !usesFuel) tbAppend(tb, "  No fuel required.");
    if (!terse) {
      if (refuelTurns) {
        tbAppend(tb, `  Refills other lanterns up to ${refuelTurns} turns of fuel.`);
      } else {
        tbAppend(tb, "  Cannot be refueled.");
      }
    }
    tbAppend(tb, "\n");
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * describe_book / describe_effect (obj-info.c L1990 / L2060).
 * ------------------------------------------------------------------ */

function describeBook(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject): boolean {
  if (!(deps.canBrowse?.(obj) ?? false)) return false;
  tbAppend(tb, "\nYou can read this book.\n");
  return true;
}

function describeEffect(
  tb: Textblock,
  deps: ObjectInfoDeps,
  obj: GameObject,
  shadow: GameObject,
  subjective: boolean,
): boolean {
  const effRecords = obj.activation?.effect ?? obj.effect ?? null;
  if (!effRecords || effRecords.length === 0) return false;

  const storeConsumable = (deps.inStore ?? false) && tvalIsUseable(obj.tval);
  const known = objectEffectIsKnown(obj, shadow) || storeConsumable;

  /* Effect not known: mouth platitudes. */
  if (!known) {
    if (tvalIsEdible(obj.tval)) tbAppend(tb, "It can be eaten.\n");
    else if (tvalIsPotion(obj.tval)) tbAppend(tb, "It can be drunk.\n");
    else if (tvalIsScroll(obj.tval)) tbAppend(tb, "It can be read.\n");
    else if (tvalIsWand(obj.tval)) tbAppend(tb, "It requires a target. It can be used.");
    else if (tvalIsStaff(obj.tval)) tbAppend(tb, "It can be used.");
    else tbAppend(tb, "It may require a target. It can be used.");
    return true;
  }

  const aimed = deps.effect.aimed;
  let minTime = 0;
  let maxTime = 0;
  if (rvMax(obj.time) > 0) {
    minTime = rvMin(obj.time);
    maxTime = rvMax(obj.time);
  }
  const failureChance =
    tvalIsEdible(obj.tval) || tvalIsPotion(obj.tval) || tvalIsScroll(obj.tval)
      ? 0
      : deps.effect.deviceFailure;

  if (obj.activation && obj.activation.desc) {
    if (aimed) tbAppend(tb, "It requires a target. ");
    tbAppend(tb, "When used, it ");
    tbAppend(tb, obj.activation.desc);
  } else {
    const level =
      obj.artifact?.level ?? obj.activation?.level ?? obj.kind.level;
    const deviceSkill = deps.currentState.skills[SKILL.DEVICE] ?? 0;
    const boost = Math.max(Math.trunc((deviceSkill - level) / 2), 0);
    let prefix: string;
    if (tvalIsEdible(obj.tval)) {
      prefix = aimed ? "It requires a target. When eaten, it " : "When eaten, it ";
    } else if (tvalIsPotion(obj.tval)) {
      prefix = aimed ? "It requires a target. When quaffed, it " : "When quaffed, it ";
    } else if (tvalIsScroll(obj.tval)) {
      prefix = aimed ? "It requires a target. When read, it " : "When read, it ";
    } else {
      prefix = aimed ? "It requires a target. When used, it " : "When used, it ";
    }
    const tbe = deps.effect.describe(prefix, boost, false);
    if (tbe === null) return false;
    tbAppend(tb, tbe);
  }

  tbAppend(tb, ".\n");

  if (minTime || maxTime) {
    const multiplier = subjective ? deps.speedMultiplier : 10;
    tbAppend(tb, "Takes ");
    minTime = Math.trunc((minTime * multiplier) / 10);
    maxTime = Math.trunc((maxTime * multiplier) / 10);
    tbAppendC(tb, COLOUR_L_GREEN, `${minTime}`);
    if (minTime !== maxTime) {
      tbAppend(tb, " to ");
      tbAppendC(tb, COLOUR_L_GREEN, `${maxTime}`);
    }
    tbAppend(tb, " turns to recharge");
    if (subjective && deps.currentState.speed !== 110) {
      tbAppend(tb, " at your current speed");
    }
    tbAppend(tb, ".\n");
  }

  if (failureChance > 0) {
    tbAppend(
      tb,
      `Your chance of success is ${Math.trunc((1000 - failureChance) / 10)}.${(1000 - failureChance) % 10}%\n`,
    );
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * describe_origin / describe_flavor_text (obj-info.c L2177 / L2252).
 * ------------------------------------------------------------------ */

function describeOrigin(tb: Textblock, deps: ObjectInfoDeps, obj: GameObject, terse: boolean): boolean {
  /* Only in chardumps if wieldable; inspect is never terse. */
  if (terse && !tvalIsWearable(obj.tval)) return false;

  let origin = obj.origin;
  if (obj.origin === ORIGIN.DROP_MIMIC && obj.mimickingMIdx !== 0) {
    origin = ORIGIN.FLOOR;
  }

  const lootSpot = obj.originDepth
    ? `at ${obj.originDepth * 50} feet (level ${obj.originDepth})`
    : "in town";

  let dropper = "monster lost to history";
  let unique = false;
  let comma = false;
  if (obj.originRace) {
    const race = deps.raceOrigin?.(obj.originRace);
    if (race) {
      dropper = race.name;
      unique = race.unique;
      comma = race.comma;
    }
  }
  const article = isAVowel(dropper[0] ?? "") ? "an " : "a ";
  let name = unique ? dropper : article + dropper;
  if (comma) name += ",";

  const entry = ORIGIN_ENTRIES[origin];
  if (!entry) return false;
  switch (entry.args) {
    case -1:
      return false;
    case 0:
      tbAppend(tb, entry.description);
      break;
    case 1:
      tbAppend(tb, sprintfS(entry.description, lootSpot));
      break;
    case 2:
      tbAppend(tb, sprintfS(entry.description, name, lootSpot));
      break;
    default:
      break;
  }
  tbAppend(tb, "\n\n");
  return true;
}

function describeFlavorText(
  tb: Textblock,
  deps: ObjectInfoDeps,
  obj: GameObject,
  shadow: GameObject,
  ego: boolean,
): void {
  if (!deps.randarts && obj.artifact && shadow.artifact && obj.artifact.text) {
    tbAppend(tb, `${obj.artifact.text}\n\n`);
  } else if (deps.known.isAware(obj.kind) || ego) {
    let didDesc = false;
    if (!ego && obj.kind.text) {
      tbAppend(tb, obj.kind.text);
      didDesc = true;
    }
    if ((ego || shadow.ego !== null) && obj.ego?.text) {
      if (didDesc) tbAppend(tb, "  ");
      tbAppend(tb, `${obj.ego.text}\n\n`);
    } else if (didDesc) {
      tbAppend(tb, "\n\n");
    }
  }
}

/* ------------------------------------------------------------------ *
 * object_info_out (obj-info.c L2315).
 * ------------------------------------------------------------------ */

/**
 * object_info (obj-info.c L2393) folded with object_info_out: build the run
 * stream for an object. Inspect calls with mode = OINFO.SUBJ (the ego / terse
 * / fake / spoil bits stay off). The caller must OR in OINFO.SUBJ, matching
 * upstream object_info().
 */
export function objectInfo(obj: GameObject, mode: number, deps: ObjectInfoDeps): Textblock {
  const tb = tbNew();
  const terse = (mode & OINFO.TERSE) !== 0;
  const subjective = (mode & OINFO.SUBJ) !== 0;
  const ego = (mode & OINFO.EGO) !== 0;

  const shadow = shadowOf(deps, obj);

  /* Unaware objects get simple descriptions (the port's shadow.kind always
     mirrors obj.kind, matching object_set_base_known; the is_unknown grid
     placeholder is not modelled). */
  if (obj.kind !== shadow.kind) {
    tbAppend(tb, "\n\nYou do not know what this is.\n");
    return tb;
  }

  /* get_known_flags: non-ego, non-terse -> the shadow's flags. */
  const flags = shadow.flags;
  const el = getKnownElements(obj, shadow, deps.player, mode);

  if (subjective) describeOrigin(tb, deps, obj, terse);
  if (!terse) describeFlavorText(tb, deps, obj, shadow, ego);

  let something = false;
  if (
    !objectFullyKnown(obj, shadow, deps.player, deps.env) &&
    shadow.notice & OBJ_NOTICE.ASSESSED &&
    !tvalIsUseable(obj.tval)
  ) {
    tbAppend(tb, "You do not know the full extent of this item's powers.\n");
    something = true;
  }

  const aware = deps.known.isAware(obj.kind);
  if (describeCurses(tb, shadow, deps.env)) something = true;
  if (describeStats(tb, shadow, deps.env, mode, aware)) something = true;
  if (describeSlays(tb, shadow, deps.env)) something = true;
  if (describeBrands(tb, shadow, deps.env)) something = true;
  if (describeElements(tb, el, deps.projections)) something = true;
  if (describeProtects(tb, flags, deps.env)) something = true;
  if (describeIgnores(tb, el, deps.projections)) something = true;
  if (describeHates(tb, el, deps.projections)) something = true;
  if (describeSustains(tb, flags, deps.env)) something = true;
  if (describeMiscMagic(tb, flags, deps.env)) something = true;
  if (describeLight(tb, deps, obj, mode)) something = true;
  if (describeBook(tb, deps, obj)) something = true;
  /* describe_ego is skipped for inspect (ego bit off). */
  if (something) tbAppend(tb, "\n");

  if (!ego) {
    if (describeEffect(tb, deps, obj, shadow, subjective)) {
      something = true;
      tbAppend(tb, "\n");
    }
    if (subjective && describeCombat(tb, deps, obj)) {
      something = true;
      tbAppend(tb, "\n");
    }
    if (!terse && subjective && describeDigger(tb, deps, obj)) something = true;
  }

  if (!something && !terse) {
    tbAppend(tb, "\n\n\nThis item does not seem to possess any special abilities.");
  }
  return tb;
}
