/**
 * Player ranged attacks (firing and throwing), ported from
 * reference/src/player-attack.c (Angband 4.2.6):
 * chance_of_missile_hit(_base), ranged_damage, breakage_chance, and the
 * make_ranged_shot / make_ranged_throw attack builders. Standard (non-O)
 * combat only.
 *
 * This is the attack-resolution shell: to-hit, damage, and critical. The
 * projectile path, ammo/quiver management, drop_near/breakage application,
 * piercing (TMD_POWERSHOT), and the do_cmd_fire/throw command front-ends live
 * in the world/command layer and are DEFERRED (see parity/ledger).
 *
 * DEFERRED (ledgered in parity/ledger/combat-ranged.yaml): knowledge/learning
 * (missile_learn_*, learn_brand_slay_from_launch/throw), OF_EXPLODE triple
 * damage happens in make_ranged_throw here but the projectile path/target
 * selection does not; O-combat ranged (o_ranged_damage / o_critical_shot);
 * temporary brands/slays.
 */

import type { Rng } from "../rng";
import type { Brand, Slay } from "../obj/types";
import type { GameObject } from "../obj/object";
import type { Monster } from "../mon/monster";
import type { Player } from "../player/player";
import { OF } from "../generated";
import { SKILL } from "../player/types";
import { tvalIsAmmo } from "../obj/object";
import type { CritActor, HitType } from "./hit";
import { BTH_PLUS_ADJ, criticalShot, testHit } from "./hit";
import type { PlayerCombatState } from "./melee";
import {
  getMonsterBrandMultiplier,
  improveAttackModifier,
  objectToDam,
  objectToHit,
  objectWeightOne,
} from "./brand-slay";
import type { AttackModifier } from "./brand-slay";

/** The outcome of a single ranged attack resolution. */
export interface RangedAttackResult {
  success: boolean;
  damage: number;
  msg: HitType;
  verb: string;
  brand: number;
  slay: number;
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
 * chance_of_missile_hit_base: to-hit for a missile before the target. A
 * launcher shot uses the bow skill; a thrown throwing-weapon uses the throw
 * skill and adds the player's to-hit; any other thrown object uses 3/2 of the
 * throw skill and no personal to-hit.
 */
export function chanceOfMissileHitBase(
  state: PlayerCombatState,
  missile: GameObject,
  launcher: GameObject | null,
): number {
  let bonus = objectToHit(missile);
  let chance: number;

  if (!launcher) {
    if (missile.flags.has(OF.THROWING)) {
      bonus += state.toH;
      chance = skill(state, SKILL.TO_HIT_THROW) + bonus * BTH_PLUS_ADJ;
    } else {
      chance =
        Math.trunc((3 * skill(state, SKILL.TO_HIT_THROW)) / 2) +
        bonus * BTH_PLUS_ADJ;
    }
  } else {
    bonus += state.toH + objectToHit(launcher);
    chance = skill(state, SKILL.TO_HIT_BOW) + bonus * BTH_PLUS_ADJ;
  }

  return chance;
}

/**
 * chance_of_missile_hit: base value less the distance to the target, halved
 * when the target is not obvious.
 */
export function chanceOfMissileHit(
  state: PlayerCombatState,
  missile: GameObject,
  launcher: GameObject | null,
  distance: number,
  monObvious: boolean,
): number {
  const chance = chanceOfMissileHitBase(state, missile, launcher) - distance;
  return monObvious ? chance : Math.trunc(chance / 2);
}

/**
 * ranged_damage: missile dice times the launcher/brand/slay multiplier, plus
 * to-dam bonuses; thrown throwing-weapons get a weight-scaled damage boost.
 */
export function rangedDamage(
  rng: Rng,
  state: PlayerCombatState,
  mon: Monster,
  missile: GameObject,
  launcher: GameObject | null,
  brand: number,
  slay: number,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
): number {
  let mult = launcher ? state.ammoMult : 1;

  if (brand) {
    mult += getMonsterBrandMultiplier(mon, brands[brand] as Brand, false);
  } else if (slay) {
    mult += (slays[slay] as Slay).multiplier;
  }

  let dmg = rng.damroll(missile.dd, missile.ds);
  dmg += objectToDam(missile);
  if (launcher) {
    dmg += objectToDam(launcher);
  } else if (missile.flags.has(OF.THROWING)) {
    dmg *= 2 + Math.trunc(objectWeightOne(missile) / 12);
  }
  dmg *= mult;

  return dmg;
}

/**
 * make_ranged_shot: resolve a launcher shot (bow + ammo) against a monster.
 * Returns success=false (with zero damage) on a miss.
 */
export function makeRangedShot(
  rng: Rng,
  p: Player,
  state: PlayerCombatState,
  ammo: GameObject,
  launcher: GameObject,
  mon: Monster,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  distance: number,
  monObvious = true,
): RangedAttackResult {
  if (
    !testHit(
      rng,
      chanceOfMissileHit(state, ammo, launcher, distance, monObvious),
      mon.race.ac,
    )
  ) {
    return { success: false, damage: 0, msg: "MISS", verb: "hits", brand: 0, slay: 0 };
  }

  const mod: AttackModifier = { brand: 0, slay: 0, verb: "hits" };
  improveAttackModifier(ammo, mon, brands, slays, mod, true);
  improveAttackModifier(launcher, mon, brands, slays, mod, true);

  let dmg = rangedDamage(rng, state, mon, ammo, launcher, mod.brand, mod.slay, brands, slays);
  const crit = criticalShot(
    rng,
    critActor(p, state),
    mon,
    objectWeightOne(ammo),
    objectToHit(ammo),
    dmg,
    true,
  );
  dmg = crit.damage;

  return {
    success: true,
    damage: dmg,
    msg: crit.msg,
    verb: mod.verb,
    brand: mod.brand,
    slay: mod.slay,
  };
}

/**
 * make_ranged_throw: resolve a thrown object against a monster. OF_EXPLODE
 * objects (flasks of oil) triple their damage.
 */
export function makeRangedThrow(
  rng: Rng,
  p: Player,
  state: PlayerCombatState,
  obj: GameObject,
  mon: Monster,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  distance: number,
  monObvious = true,
): RangedAttackResult {
  if (
    !testHit(
      rng,
      chanceOfMissileHit(state, obj, null, distance, monObvious),
      mon.race.ac,
    )
  ) {
    return { success: false, damage: 0, msg: "MISS", verb: "hits", brand: 0, slay: 0 };
  }

  const mod: AttackModifier = { brand: 0, slay: 0, verb: "hits" };
  improveAttackModifier(obj, mon, brands, slays, mod, true);

  let dmg = rangedDamage(rng, state, mon, obj, null, mod.brand, mod.slay, brands, slays);
  const crit = criticalShot(
    rng,
    critActor(p, state),
    mon,
    objectWeightOne(obj),
    objectToHit(obj),
    dmg,
    false,
  );
  dmg = crit.damage;

  /* Direct adjustment for exploding things (flasks of oil). */
  if (obj.flags.has(OF.EXPLODE)) dmg *= 3;

  return {
    success: true,
    damage: dmg,
    msg: crit.msg,
    verb: mod.verb,
    brand: mod.brand,
    slay: mod.slay,
  };
}

/**
 * breakage_chance: percent chance an object breaks after hitting (or missing).
 * Artifacts never break; a missed object squares its break chance.
 */
export function breakageChance(obj: GameObject, hitTarget: boolean): number {
  let perc = obj.kind.base.breakPerc;

  if (obj.artifact) return 0;
  if (
    obj.flags.has(OF.THROWING) &&
    !obj.flags.has(OF.EXPLODE) &&
    !tvalIsAmmo(obj.tval)
  ) {
    perc = 1;
  }
  if (!hitTarget) return Math.trunc((perc * perc) / 100);
  return perc;
}
