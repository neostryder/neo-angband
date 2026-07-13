/**
 * Monster-spell substrate, ported from reference/src/mon-spell.c (Angband
 * 4.2.6): the spell-type classification (the mon_spell_types table built from
 * list-mon-spells.h), the spell-type predicates and masks, the spell-hit
 * chance, and the breath-damage calculation. These are the pure computations
 * over the bound spell / race data that both the spell executor (do_mon_spell,
 * game/ layer) and the spell-selection AI (choose_attack_spell / remove_bad_
 * spells, mon-attack.c) sit on; they do not touch the GameState, so they live
 * here in mon/ below game/.
 *
 * The RST_ classification is generated as a string expression per spell
 * (generated/mon-spells.ts keeps `type` as written, e.g. "RST_BREATH |
 * RST_INNATE"); MON_SPELL_TYPES evaluates each once into a bitmask indexed by
 * RSF value (index 0 is RSF_NONE, matching the enum), so the lookups mirror
 * upstream's mon_spell_types[index] exactly.
 *
 * monSpellNonhpDamage (nonhp_dam, mon-spell.c L571) is the non-breath half of
 * mon_spell_dam: the deterministic MAXIMISE sum of a spell's damaging effect
 * dice, with each effect's SPELL_POWER expression (the only base value
 * monster-spell damage dice reference) rebound to the calling race - upstream
 * sets its global `ref_race` for the same duration. This is the seam the
 * lore/recall layer (mon/lore-describe.ts) needed to wire mon_spell_lore_damage
 * for real; breath damage keeps using breathDam below unchanged.
 */

import { Dice } from "../dice";
import { Expression } from "../expression";
import { FlagSet } from "../bitflag";
import { MON_SPELL_ENTRIES, MON_TMD, RSF } from "../generated";
import type { RandomValue } from "../rng";
import { RSF_SIZE } from "./types";
import type { MonsterRace, MonsterSpell, MonsterSpellEffect } from "./types";
import type { Monster } from "./monster";
import { monsterEffectLevel } from "./timed";

/**
 * RST_ spell-type bitflags (mon-spell.h). RST_DAMAGE is the composite of the
 * four damaging categories.
 */
export const RST = {
  NONE: 0x0000,
  BOLT: 0x0001,
  BALL: 0x0002,
  BREATH: 0x0004,
  DIRECT: 0x0008,
  ANNOY: 0x0010,
  HASTE: 0x0020,
  HEAL: 0x0040,
  HEAL_OTHER: 0x0080,
  TACTIC: 0x0100,
  ESCAPE: 0x0200,
  SUMMON: 0x0400,
  INNATE: 0x0800,
  ARCHERY: 0x1000,
} as const;

/** #define RST_DAMAGE (RST_BOLT | RST_BALL | RST_BREATH | RST_DIRECT). */
export const RST_DAMAGE = RST.BOLT | RST.BALL | RST.BREATH | RST.DIRECT;

/** CONF_HIT_REDUCTION (mon-timed.h): accuracy loss per level of confusion. */
export const CONF_HIT_REDUCTION = 20;

/** Evaluate a generated RST_ type expression ("RST_A | RST_B" or 0). */
function evalTypeExpr(expr: string | number): number {
  if (typeof expr === "number") return expr;
  let mask = 0;
  for (const tok of expr.split("|")) {
    const name = tok.trim().replace(/^RST_/, "");
    const value = (RST as Record<string, number>)[name];
    if (value === undefined) throw new Error(`unknown RST token: ${tok}`);
    mask |= value;
  }
  return mask;
}

/**
 * The per-spell type bitmask, indexed by RSF value (mon_spell_types[]). Built
 * once from the generated entries; index 0 (RSF_NONE) and the trailing MAX
 * entry are 0.
 */
export const MON_SPELL_TYPES: readonly number[] = MON_SPELL_ENTRIES.map((e) =>
  evalTypeExpr(e.type),
);

/** mon_spell_is_valid: a real RSF_ spell index. */
export function monSpellIsValid(index: number): boolean {
  return index > RSF.NONE && index < RSF.MAX;
}

/** monster_spell_is_breath. */
export function monSpellIsBreath(index: number): boolean {
  return (MON_SPELL_TYPES[index]! & RST.BREATH) !== 0;
}

/** mon_spell_has_damage. */
export function monSpellHasDamage(index: number): boolean {
  return (MON_SPELL_TYPES[index]! & RST_DAMAGE) !== 0;
}

/** mon_spell_is_innate. */
export function monSpellIsInnate(index: number): boolean {
  return (MON_SPELL_TYPES[index]! & RST.INNATE) !== 0;
}

/** test_spells: whether any spell of a wanted type is set in the flagset. */
export function testSpells(f: FlagSet, types: number): boolean {
  for (let index = RSF.NONE + 1; index < RSF.MAX; index++) {
    if (f.has(index) && (MON_SPELL_TYPES[index]! & types) !== 0) return true;
  }
  return false;
}

/** ignore_spells: clear every spell of the given type(s) from the flagset. */
export function ignoreSpells(f: FlagSet, types: number): void {
  for (let index = RSF.NONE + 1; index < RSF.MAX; index++) {
    if (f.has(index) && (MON_SPELL_TYPES[index]! & types) !== 0) f.off(index);
  }
}

/** create_mon_spell_mask: a fresh flagset of every spell of the given type(s). */
export function createMonSpellMask(...types: number[]): FlagSet {
  const f = new FlagSet(RSF_SIZE);
  const wanted = types.reduce((a, b) => a | b, 0);
  for (let index = RSF.NONE + 1; index < RSF.MAX; index++) {
    if ((MON_SPELL_TYPES[index]! & wanted) !== 0) f.on(index);
  }
  return f;
}

/**
 * chance_of_spell_hit_base: MAX(race->level, 1) * 3 + spell->hit. See also the
 * melee analogue chance_of_monster_hit_base.
 */
export function chanceOfSpellHitBase(
  race: MonsterRace,
  spell: MonsterSpell,
): number {
  return Math.max(race.level, 1) * 3 + spell.hit;
}

/** chance_of_spell_hit: the base to-hit reduced for each level of confusion. */
export function chanceOfSpellHit(mon: Monster, spell: MonsterSpell): number {
  let toHit = chanceOfSpellHitBase(mon.race, spell);
  const conf = monsterEffectLevel(mon, MON_TMD.CONF);
  for (let i = 0; i < conf; i++) {
    toHit = Math.trunc((toHit * (100 - CONF_HIT_REDUCTION)) / 100);
  }
  return toHit;
}

/** The projection fields breath_dam reads (a structural view of ProjectionInfo). */
export interface BreathProjection {
  /** element->divisor: hp is divided by this. */
  divisor: number;
  /** element->damage_cap: the maximum breath damage. */
  damageCap: number;
}

/**
 * breath_dam: a monster breath does hp / divisor damage, capped at the
 * element's damage cap.
 */
export function breathDam(proj: BreathProjection, hp: number): number {
  let dam = Math.trunc(hp / proj.divisor);
  if (dam > proj.damageCap) dam = proj.damageCap;
  return dam;
}

/**
 * randcalc(v, 0, MAXIMISE): base + dice*sides + mBonus. Level and RNG never
 * enter the MAXIMISE branch (rng.ts damcalc / mBonusCalc), so this mirrors
 * that arithmetic directly rather than threading an Rng through a display
 * path (the same choice obj/object-info.ts makes for its own rvMax).
 */
function maximiseRandomValue(rv: RandomValue): number {
  return rv.base + rv.dice * rv.sides + rv.mBonus;
}

/**
 * FLAGGED ADDITION (#lore-damage): nonhp_dam (mon-spell.c L571), restricted to
 * the MAXIMISE aspect mon_spell_lore_damage needs - deterministic, no RNG.
 *
 * Sums the MAXIMISE damage of every effect line except EF_TIMED_INC ("Timed
 * effects increases don't count as damage in lore", upstream comment).
 * EF_LASH is special-cased exactly as upstream: full damage from the race's
 * first blow plus half from each of the rest (integer division per term,
 * summed - not the total divided by two).
 *
 * Each non-LASH effect's dice is parsed fresh from its raw string and any
 * SPELL_POWER expression rebound to `race` (the only base value monster-spell
 * damage dice reference - see reference/lib/gamedata/monster_spell.txt),
 * mirroring upstream's do_mon_spell / mon-cast.ts buildSpellEffectChain
 * pattern of rebuilding the bound dice per caster rather than mutating the
 * shared MonsterSpell record (which every race with that spell shares).
 */
export function monSpellNonhpDamage(
  effects: readonly MonsterSpellEffect[],
  race: MonsterRace,
): number {
  let dam = 0;

  for (const effect of effects) {
    if (effect.eff === "LASH") {
      for (let i = 0; i < race.blows.length; i++) {
        const blowDice = race.blows[i]!.dice;
        if (!blowDice) continue;
        const full = maximiseRandomValue(blowDice.randomValue());
        dam += i === 0 ? full : Math.trunc(full / 2);
      }
      continue;
    }

    if (!effect.dice || effect.eff === "TIMED_INC" || effect.diceRaw === null) {
      continue;
    }

    const dice = new Dice();
    if (!dice.parseString(effect.diceRaw)) continue;
    for (const x of effect.exprs) {
      if (x.base.toUpperCase() !== "SPELL_POWER") continue;
      const expr = new Expression();
      expr.setBaseValue(() => race.spellPower);
      expr.addOperationsString(x.expr);
      dice.bindExpression(x.name, expr);
    }
    dam += maximiseRandomValue(dice.randomValue());
  }

  return dam;
}
