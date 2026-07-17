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
import { ELEM, MON_SPELL_ENTRIES, MON_TMD, OF, PF, RSF } from "../generated";
import type { RandomValue, Rng } from "../rng";
import { ELEM_MAX } from "../obj/types";
import type { TimedFailLike } from "../obj/object";
import { RSF_SIZE } from "./types";
import type { MonsterRace, MonsterSpell, MonsterSpellEffect } from "./types";
import type { Monster } from "./monster";
import { monsterEffectLevel } from "./timed";
import { monsterIsSmart, monsterIsStupid } from "./predicate";

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

/** TMD_FAIL_ codes (player-timed.h), for the unset_spells fail-table scan. */
const TMD_FAIL_FLAG_OBJECT = 1;
const TMD_FAIL_FLAG_RESIST = 2;
const TMD_FAIL_FLAG_VULN = 3;
const TMD_FAIL_FLAG_PLAYER = 4;

/**
 * unset_spells (mon-spell.c L470): turn off spells with a side effect or
 * projection type resisted by what the monster knows about the player, subject
 * to intelligence and chance. `flags` / `pflags` / `el` are the monster's
 * ai-memorized view of the player (known_pstate copies); `timedFail` resolves a
 * TMD_ name to its fail-condition table (the bound player-timed data).
 *
 * RNG order preserved exactly, including the C short-circuit quirks:
 * - every elemental (BOLT/BALL/BREATH) spell present draws one randint0(100),
 *   even when the learn chance is 0;
 * - a non-smart monster draws one_in_(3) per EFFECT LINE of every non-elemental
 *   spell (the `(smart || !one_in_(3)) && index == EF_TIMED_INC` gate is
 *   evaluated left-to-right for every effect), and one_in_(2) likewise for the
 *   drain-mana gate.
 * Upstream indexes el[] by the raw projection subtype; for the handful of
 * non-element breath subtypes (TIME / INERTIA / GRAVITY / PLASMA / MANA /
 * WATER) that read past the element table in C, the port treats the resist
 * level as 0 (an unreproducible out-of-bounds read; the draw still happens).
 */
export function unsetSpells(
  rng: Rng,
  spells: FlagSet,
  flags: FlagSet,
  pflags: FlagSet,
  el: Int16Array,
  mon: Monster,
  spellTable: ReadonlyMap<number, MonsterSpell>,
  timedFail: (tmdName: string) => readonly TimedFailLike[] | null,
): void {
  const smart = monsterIsSmart(mon);

  for (let index = RSF.NONE + 1; index < RSF.MAX; index++) {
    const spell = spellTable.get(index);
    if (!spell) continue;
    if (!spells.has(index)) continue;

    const types = MON_SPELL_TYPES[index]!;

    if (types & (RST.BOLT | RST.BALL | RST.BREATH)) {
      /* First we test the elemental spells. */
      const typeName = spell.effects[0]?.type ?? "";
      const element = (ELEM as Record<string, number>)[typeName];
      const resLevel =
        element !== undefined && element < ELEM_MAX ? (el[element] ?? 0) : 0;
      const learnChance = resLevel * (smart ? 50 : 25);
      if (rng.randint0(100) < learnChance) {
        spells.off(index);
      }
    } else {
      /* Now others with resisted effects. */
      let stopped = false;
      for (const effect of spell.effects) {
        /* Timed effects: the intelligence/chance gate draws for every
         * effect line of a non-smart monster (C short-circuit order). */
        const timedGate = smart || !rng.oneIn(3);
        if (timedGate && effect.eff === "TIMED_INC") {
          let resisted = false;
          for (const f of timedFail(effect.type ?? "") ?? []) {
            if (resisted) break;
            switch (f.code) {
              case TMD_FAIL_FLAG_OBJECT: {
                const of = (OF as Record<string, number>)[f.flag];
                if (of !== undefined && flags.has(of)) resisted = true;
                break;
              }
              case TMD_FAIL_FLAG_RESIST: {
                const e = (ELEM as Record<string, number>)[f.flag];
                if (e !== undefined && (el[e] ?? 0) > 0) resisted = true;
                break;
              }
              case TMD_FAIL_FLAG_VULN: {
                const e = (ELEM as Record<string, number>)[f.flag];
                if (e !== undefined && (el[e] ?? 0) < 0) resisted = true;
                break;
              }
              case TMD_FAIL_FLAG_PLAYER: {
                const pf = (PF as Record<string, number>)[f.flag];
                if (pf !== undefined && pflags.has(pf)) resisted = true;
                break;
              }
              /* TMD_FAIL_FLAG_TIMED_EFFECT: the monster does not track the
               * player's timed effects; do nothing. */
              default:
                break;
            }
          }
          if (resisted) {
            stopped = true;
            break;
          }
        }

        /* Mana drain (the chance gate draws per effect for non-smart). */
        const manaGate = smart || rng.oneIn(2);
        if (
          manaGate &&
          effect.eff === "DRAIN_MANA" &&
          pflags.has(PF.NO_MANA)
        ) {
          stopped = true;
          break;
        }
      }
      if (stopped) spells.off(index);
    }
  }
}

/** The player-side seams update_smart_learn drives (mon-util.c L788). */
export interface SmartLearnEnv {
  /** OPT(p, birth_ai_learn). */
  aiLearn: boolean;
  /** equip_learn_flag(p, flag). */
  equipLearnFlag: (of: number) => void;
  /** equip_learn_element(p, element). */
  equipLearnElement: (elem: number) => void;
  /** player_of_has(p, flag). */
  playerOfHas: (of: number) => boolean;
  /** pf_has(p->state.pflags, pflag). */
  playerPfHas: (pf: number) => boolean;
  /** p->state.el_info[element].res_level. */
  playerResLevel: (elem: number) => number;
}

/**
 * update_smart_learn (mon-util.c L788): the monster learns an "observed"
 * resistance or other player property (or its absence). The player always
 * learns the corresponding rune (equip_learn_*); the monster's known_pstate is
 * only updated under birth_ai_learn, for non-stupid monsters, with the
 * one_in_(2) non-smart and one_in_(100) failure draws in upstream order.
 * Robust to `element` being an arbitrary PROJ_ index, as upstream.
 */
export function updateSmartLearn(
  rng: Rng,
  mon: Monster,
  env: SmartLearnEnv,
  flag: number,
  pflag: number,
  element: number,
): void {
  const elementOk = element >= 0 && element < ELEM_MAX;

  /* Sanity check. */
  if (!flag && !elementOk) return;

  /* Anything a monster might learn, the player should learn. */
  if (flag) env.equipLearnFlag(flag);
  if (elementOk) env.equipLearnElement(element);

  /* Not allowed to learn. */
  if (!env.aiLearn) return;

  /* Too stupid to learn anything. */
  if (monsterIsStupid(mon)) return;

  /* Not intelligent, only learn sometimes. */
  if (!monsterIsSmart(mon) && rng.oneIn(2)) return;

  /* Analyze the knowledge; fail very rarely. */
  if (rng.oneIn(100)) return;

  /* Learn the flag. */
  if (flag) {
    if (env.playerOfHas(flag)) mon.knownPstate.flags.on(flag);
    else mon.knownPstate.flags.off(flag);
  }

  /* Learn the pflag (upstream writes it with of_on/of_off; same bit ops). */
  if (pflag) {
    if (env.playerPfHas(pflag)) mon.knownPstate.pflags.on(pflag);
    else mon.knownPstate.pflags.off(pflag);
  }

  /* Learn the element. */
  if (elementOk) {
    mon.knownPstate.elInfo[element] = env.playerResLevel(element);
  }
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
