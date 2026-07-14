/**
 * Player melee attacks, ported from reference/src/player-attack.c (Angband
 * 4.2.6): chance_of_melee_hit(_base), melee_damage, py_attack_real and the
 * py_attack blow loop. Standard (non-O) combat only.
 *
 * The upstream `struct player` carries a computed `struct player_state`
 * (calc_bonuses) with to_h/to_d/ac/num_blows/skills/stat_ind; the port's
 * Player does not yet compute that (player/calcs.ts defers it). Combat
 * therefore takes an explicit PlayerCombatState alongside the Player, exactly
 * as upstream separates `p` from `p->state`. num_blows is likewise injected.
 *
 * Knowledge / learning side effects (equip_learn_on_melee_attack,
 * learn_brand_slay_from_melee) are wired at the GAME layer around pyAttack
 * (game/player-turn.ts, game/cave-cmd.ts), keeping this module pure combat
 * math; see obj/knowledge.ts and parity/ledger/obj-knowledge.yaml.
 *
 * DEFERRED (ledgered in parity/ledger/combat-melee.yaml):
 * - Bloodlust exertion, vampiric drain (TMD_ATT_VAMP), confusion-brand
 *   side effect (blow_side_effects / TMD_ATT_CONF), impact earthquakes
 *   (OF_IMPACT / blow_after_effects), splash damage.
 * - Shape-change blow substitution; shield bash; the PF_COMBAT_REGEN mana
 *   reward. Monster fear generation and delayed fear messaging.
 * - Message text/formatting (the combat code returns the HitType key only).
 *
 * O-combat (birth_percent_damage) IS ported: oMeleeDamage / o_critical_melee,
 * gated in pyAttackReal at the same point upstream branches (player-attack.c
 * L803/L811/L826). With the option off the path is byte-identical to standard.
 */

import type { Rng } from "../rng";
import type { Brand, Slay } from "../obj/types";
import type { GameObject } from "../obj/object";
import { objectWeightOne } from "../obj/object";
import type { Monster } from "../mon/monster";
import type { Player } from "../player/player";
import { SKILL } from "../player/types";
import type { CritActor, HitType } from "./hit";
import {
  BTH_PLUS_ADJ,
  applyDeadliness,
  criticalMelee,
  oCriticalMelee,
  testHit,
} from "./hit";
import {
  getMonsterBrandMultiplier,
  improveAttackModifier,
  objectToDam,
  objectToHit,
} from "./brand-slay";
import type { AttackModifier } from "./brand-slay";

/**
 * The subset of upstream `struct player_state` that combat reads. Supplied by
 * the caller (calc_bonuses is deferred in player/calcs.ts).
 */
export interface PlayerCombatState {
  /** state->to_h. */
  toH: number;
  /** state->to_d. */
  toD: number;
  /** state->ac. */
  ac: number;
  /** state->to_a. */
  toA: number;
  /** state->skills[SKILL_MAX], indexed by SKILL. */
  skills: readonly number[];
  /** state->num_blows, in hundredths of a blow (100 = one blow). */
  numBlows: number;
  /** state->ammo_mult (ranged). */
  ammoMult: number;
  /** state->num_shots, in tenths of a shot (10 = one shot). */
  numShots: number;
  /** state->ammo_tval: the ammo tval the equipped launcher fires (0 = none). */
  ammoTval: number;
  /** state->bless_wield (blessed weapon / holy-wield bonus). */
  blessWield: boolean;
}

/** Options for a melee attack. */
export interface MeleeOptions {
  /** monster_is_visible(mon); a non-visible target halves the to-hit. */
  monVisible?: boolean;
  /** player_of_has(p, OF_AFRAID); an afraid player cannot attack. */
  afraid?: boolean;
  /**
   * Off-weapon equipped items (body slots >= 2) carrying brands/slays, in
   * slot order. Upstream iterates these before the weapon.
   */
  offhand?: readonly GameObject[];
  /** p->energy for the blow loop (defaults to moveEnergy: one full turn). */
  energy?: number;
  /** z_info->move_energy (constants.txt; 100 upstream). */
  moveEnergy?: number;
  /**
   * OPT(p, birth_percent_damage): route damage through the O-combat path
   * (oMeleeDamage) instead of the standard melee_damage + critical_melee.
   * Off by default; when off, RNG draws are byte-identical to the standard
   * path (the gate adds/reorders nothing).
   */
  percentDamage?: boolean;
}

/** The outcome of a single blow (py_attack_real). */
export interface MeleeBlow {
  hit: boolean;
  damage: number;
  msg: HitType;
  verb: string;
  /** Brand index used (0 = none). */
  brand: number;
  /** Slay index used (0 = none). */
  slay: number;
  monsterDied: boolean;
}

/** The outcome of a full attack (py_attack). */
export interface MeleeAttack {
  blows: MeleeBlow[];
  totalDamage: number;
  monsterDied: boolean;
}

function skill(state: PlayerCombatState, idx: number): number {
  return state.skills[idx] ?? 0;
}

function critActor(p: Player, state: PlayerCombatState): CritActor {
  return {
    lev: p.lev,
    toH: state.toH,
    meleeSkill: skill(state, SKILL.TO_HIT_MELEE),
    bowSkill: skill(state, SKILL.TO_HIT_BOW),
    throwSkill: skill(state, SKILL.TO_HIT_THROW),
  };
}

/**
 * chance_of_melee_hit_base: the player's melee to-hit before the target.
 */
export function chanceOfMeleeHitBase(
  state: PlayerCombatState,
  weapon: GameObject | null,
): number {
  const bonus =
    state.toH + (weapon ? objectToHit(weapon) : 0) + (state.blessWield ? 2 : 0);
  return skill(state, SKILL.TO_HIT_MELEE) + bonus * BTH_PLUS_ADJ;
}

/**
 * chance_of_melee_hit: to-hit against a specific monster (half if unseen).
 */
export function chanceOfMeleeHit(
  state: PlayerCombatState,
  weapon: GameObject | null,
  monVisible: boolean,
): number {
  const chance = chanceOfMeleeHitBase(state, weapon);
  return monVisible ? chance : Math.trunc(chance / 2);
}

/**
 * melee_damage: base weapon dice, times the best slay or brand multiplier,
 * plus the weapon's to-dam. Standard (non-O) combat.
 */
export function meleeDamage(
  rng: Rng,
  mon: Monster,
  weapon: GameObject | null,
  brand: number,
  slay: number,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
): number {
  let dmg = weapon ? rng.damroll(weapon.dd, weapon.ds) : 1;

  if (slay) {
    dmg *= (slays[slay] as Slay).multiplier;
  } else if (brand) {
    dmg *= getMonsterBrandMultiplier(mon, brands[brand] as Brand, false);
  }

  if (weapon) dmg += objectToDam(weapon);

  return dmg;
}

/** The (possibly critical-boosted) damage of a single blow plus its message. */
export interface DamageOutcome {
  damage: number;
  msg: HitType;
}

/**
 * o_melee_damage (player-attack.c L501): the birth_percent_damage melee path.
 * Deadliness and the slay/brand o_multiplier add extra SIDES to the damage
 * dice; criticals add extra DICE. Unlike the standard path, the player's
 * to-dam (player_damage_bonus) is folded in here via deadliness, so the caller
 * must NOT add state.toD afterwards (upstream skips it under the option gate).
 *
 * RNG order, matching upstream exactly:
 *  1. randint0(10000) - the fractional-sides roll (drawn even when unarmed).
 *  2. (weapon only) o_critical_melee: randint1(chance_den) crit test, then on
 *     a crit the one_in_ level walk.
 *  3. damroll(dice, sides).
 */
export function oMeleeDamage(
  rng: Rng,
  state: PlayerCombatState,
  mon: Monster,
  weapon: GameObject | null,
  brand: number,
  slay: number,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
): DamageOutcome {
  let dice = weapon ? weapon.dd : 1;
  let add = 0;

  /* Average value of a single damage die, x10. */
  let dieAverage = Math.trunc((10 * ((weapon ? weapon.ds : 1) + 1)) / 2);

  /* Slays/brands inflate the average (10x) and contribute a flat add. Melee
   * prefers a slay over a brand (player-attack.c L512: `if (s) ... else if`). */
  if (slay) {
    const oMult = (slays[slay] as Slay).oMultiplier;
    dieAverage *= oMult;
    add = oMult - 10;
  } else if (brand) {
    const bmult = getMonsterBrandMultiplier(mon, brands[brand] as Brand, true);
    dieAverage *= bmult;
    add = bmult - 10;
  } else {
    dieAverage *= 10;
  }

  /* Apply deadliness (x100) from to_d + weapon to-dam. */
  const deadliness = state.toD + (weapon ? objectToDam(weapon) : 0);
  dieAverage = applyDeadliness(dieAverage, Math.min(deadliness, 150));

  /* Sides per die, with a fractional-sides roll. */
  let sides = 2 * dieAverage - 10000;
  const extra = rng.randint0(10000) < sides % 10000;
  sides = Math.trunc(sides / 10000);
  sides += extra ? 1 : 0;

  /* Criticals add dice (excluded for unarmed; upstream leaves msg at MSG_HIT). */
  let msg: HitType = "HIT";
  if (weapon) {
    const crit = oCriticalMelee(rng, chanceOfMeleeHitBase(state, weapon), mon);
    dice += crit.addDice;
    msg = crit.msg;
  }

  let dmg = rng.damroll(dice, sides);
  dmg += add;

  return { damage: dmg, msg };
}

/**
 * mon_take_hit reduced to the port's scope: apply damage to the monster and
 * report whether it died (hp < 0 after the hit). Zero damage never kills.
 * Fear generation, arena handling, and death bookkeeping are DEFERRED.
 */
function monTakeHit(mon: Monster, dam: number): boolean {
  if (dam === 0) return false;
  mon.hp -= dam;
  return mon.hp < 0;
}

/**
 * py_attack_real: a single melee blow against the monster. Mutates mon.hp on a
 * damaging hit. Returns the blow outcome; blow.monsterDied is the upstream
 * `stop` value (monster killed).
 */
export function pyAttackReal(
  rng: Rng,
  p: Player,
  state: PlayerCombatState,
  weapon: GameObject | null,
  mon: Monster,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  opts: MeleeOptions = {},
): MeleeBlow {
  const monVisible = opts.monVisible ?? true;

  /* An afraid player cannot attack. */
  if (opts.afraid) {
    return {
      hit: false,
      damage: 0,
      msg: "MISS",
      verb: "afraid",
      brand: 0,
      slay: 0,
      monsterDied: false,
    };
  }

  /* See if the player hit. */
  const success = testHit(
    rng,
    chanceOfMeleeHit(state, weapon, monVisible),
    mon.race.ac,
  );
  if (!success) {
    return {
      hit: false,
      damage: 0,
      msg: "MISS",
      verb: weapon ? "hit" : "punch",
      brand: 0,
      slay: 0,
      monsterDied: false,
    };
  }

  const weight = weapon ? objectWeightOne(weapon) : 0;
  const oCombat = opts.percentDamage ?? false;

  /* Best attack from all slays or brands on all non-launcher equipment.
   * improve_attack_modifier reads birth_percent_damage internally to pick the
   * comparison multiplier, so the O flag is threaded here too (no RNG). */
  const mod: AttackModifier = { brand: 0, slay: 0, verb: weapon ? "hit" : "punch" };
  for (const off of opts.offhand ?? []) {
    improveAttackModifier(off, mon, brands, slays, mod, false, oCombat);
  }
  if (weapon) {
    improveAttackModifier(weapon, mon, brands, slays, mod, false, oCombat);
  }
  /* improve_attack_modifier(p, NULL, ...) for temporary brands/slays: DEFERRED. */

  /* Get the damage. The option gate matches upstream player-attack.c
   * L803/L811/L826: the standard branch computes base damage, criticals, then
   * adds player_damage_bonus; the O branch folds all of that into oMeleeDamage
   * (to_d enters via deadliness) and skips the trailing state.toD. */
  let dmg: number;
  let msg: HitType;
  if (!oCombat) {
    dmg = meleeDamage(rng, mon, weapon, mod.brand, mod.slay, brands, slays);
    msg = "HIT";
    if (weapon) {
      const crit = criticalMelee(
        rng,
        critActor(p, state),
        mon,
        weight,
        objectToHit(weapon),
        dmg,
      );
      dmg = crit.damage;
      msg = crit.msg;
    }
    /* Apply the player damage bonus (player_damage_bonus = state->to_d). */
    dmg += state.toD;
  } else {
    const o = oMeleeDamage(rng, state, mon, weapon, mod.brand, mod.slay, brands, slays);
    dmg = o.damage;
    msg = o.msg;
  }

  /* No negative damage; change verb if no damage done. */
  if (dmg <= 0) {
    dmg = 0;
    msg = "MISS";
    mod.verb = "fail to harm";
  }

  const monsterDied = monTakeHit(mon, dmg);

  return {
    hit: true,
    damage: dmg,
    msg,
    verb: mod.verb,
    brand: mod.brand,
    slay: mod.slay,
    monsterDied,
  };
}

/**
 * py_attack: land blows until the next blow would exceed the energy available
 * for a single turn, or the monster dies. blow_energy = 100 * move_energy /
 * num_blows; energy defaults to a full turn's worth.
 */
export function pyAttack(
  rng: Rng,
  p: Player,
  state: PlayerCombatState,
  weapon: GameObject | null,
  mon: Monster,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  opts: MeleeOptions = {},
): MeleeAttack {
  const moveEnergy = opts.moveEnergy ?? 100;
  const availEnergy = Math.min(opts.energy ?? moveEnergy, moveEnergy);
  /* Guard a degenerate num_blows against a zero-energy infinite loop. */
  const blowEnergy = Math.max(
    1,
    Math.trunc((100 * moveEnergy) / state.numBlows),
  );

  const blows: MeleeBlow[] = [];
  let totalDamage = 0;
  let slain = false;
  let used = 0;

  while (availEnergy - used >= blowEnergy && !slain) {
    const blow = pyAttackReal(rng, p, state, weapon, mon, brands, slays, opts);
    blows.push(blow);
    totalDamage += blow.damage;
    if (blow.monsterDied) slain = true;
    used += blowEnergy;
  }

  return { blows, totalDamage, monsterDied: slain };
}
