/**
 * Brand and slay selection for combat, ported VERBATIM from
 * reference/src/obj-slays.c (Angband 4.2.6): get_monster_brand_multiplier and
 * improve_attack_modifier, plus the small object bonus accessors from
 * obj-util.c (object_to_hit / object_to_dam / object_weight_one).
 *
 * These live in the combat domain rather than obj/ because they are combat
 * math and the obj domain does not export them; obj/ owns the Brand/Slay
 * record shapes and the bound brands[]/slays[] arrays, which are passed in.
 *
 * DEFERRED (ledgered in parity/ledger/combat-melee.yaml):
 * - Temporary brands/slays (improve_attack_modifier's obj == NULL path, which
 *   reads player_has_temporary_brand/slay from the player-timed registry).
 *   The obj != NULL path (weapon and off-weapon equipment) is fully ported.
 * - Curse contributions to object_to_hit/to_dam/weight (obj->curses); no
 *   object carries curses through combat yet.
 */

import type { Brand, Slay } from "../obj/types";
import type { GameObject } from "../obj/object";
import type { MonsterRace } from "../mon/types";

/** The monster fields brand/slay selection reads. */
export interface BrandSlayTarget {
  race: MonsterRace;
}

/** object_to_hit(obj): the object's to-hit bonus (curses DEFERRED). */
export function objectToHit(obj: GameObject): number {
  return obj.toH;
}

/** object_to_dam(obj): the object's to-dam bonus (curses DEFERRED). */
export function objectToDam(obj: GameObject): number {
  return obj.toD;
}

/** object_weight_one(obj): the object's weight, floored at 0 (curses DEFERRED). */
export function objectWeightOne(obj: GameObject): number {
  return Math.max(obj.weight, 0);
}

/**
 * get_monster_brand_multiplier: the multiplicative factor for a brand hitting
 * a monster. Elemental vulnerability doubles the extra damage; resistances are
 * accounted for by the caller (improve_attack_modifier skips resisted brands).
 */
export function getMonsterBrandMultiplier(
  mon: BrandSlayTarget,
  b: Brand,
  isOCombat: boolean,
): number {
  let mult = isOCombat ? b.oMultiplier : b.multiplier;

  if (b.vulnFlag && mon.race.flags.has(b.vulnFlag)) {
    /* Especially vulnerable: apply a factor of two to the extra damage. */
    if (isOCombat) {
      mult = 2 * (mult - 10) + 10;
    } else {
      mult *= 2;
    }
  }

  return mult;
}

/**
 * A best-of brand/slay selection accumulator. `brand` and `slay` are indices
 * into the brands[]/slays[] arrays (0 = none), mirroring the upstream
 * *brand_used / *slay_used out-parameters.
 */
export interface AttackModifier {
  brand: number;
  slay: number;
  /** Attack verb, updated as the best brand/slay changes ("smite", etc). */
  verb: string;
}

/**
 * react_to_specific_slay (obj-slays.c): does this slay affect this monster?
 */
function reactToSpecificSlay(s: Slay, mon: BrandSlayTarget): boolean {
  if (!s.name) return false;
  /* Upstream also requires mon->race->base; every bound race has one. */
  if (s.raceFlag && mon.race.flags.has(s.raceFlag)) return true;
  if (s.base && s.base === mon.race.base.name) return true;
  return false;
}

/**
 * improve_attack_modifier: fold the best applicable brand or slay for `obj`
 * against `mon` into `mod`, updating mod.brand/mod.slay/mod.verb.
 *
 * Faithful to upstream, including the quirk that the brand loop sets
 * mod.brand without clearing mod.slay (only the slay loop clears mod.brand);
 * the damage code then prefers a set slay. Non-null objects only; the
 * temporary-brand/slay path (obj == null) is DEFERRED (see module docs).
 *
 * \param isOCombat selects the O-combat multipliers (birth_percent_damage);
 * the standard path passes false.
 */
export function improveAttackModifier(
  obj: GameObject | null,
  mon: BrandSlayTarget,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  mod: AttackModifier,
  range: boolean,
  isOCombat = false,
): void {
  let bestMult = 1;

  /* Set the current best multiplier from any already-chosen brand/slay. */
  if (mod.brand) {
    const b = brands[mod.brand] as Brand;
    bestMult = Math.max(bestMult, getMonsterBrandMultiplier(mon, b, isOCombat));
  } else if (mod.slay) {
    const s = slays[mod.slay] as Slay;
    const mult = isOCombat ? s.oMultiplier : s.multiplier;
    bestMult = Math.max(bestMult, mult);
  }

  /* Brands */
  for (let i = 1; i < brands.length; i++) {
    const b = brands[i];
    if (!b) continue;
    if (obj) {
      if (!obj.brands || !obj.brands[i]) continue;
    } else {
      /* DEFERRED: temporary brand (player_has_temporary_brand). */
      continue;
    }

    /* Is the monster vulnerable (not resistant)? */
    if (!mon.race.flags.has(b.resistFlag)) {
      const mult = getMonsterBrandMultiplier(mon, b, isOCombat);
      if (bestMult < mult) {
        bestMult = mult;
        mod.brand = i;
        mod.verb = range ? `${b.verb}s` : b.verb;
      }
    }
  }

  /* Slays */
  for (let i = 1; i < slays.length; i++) {
    const s = slays[i];
    if (!s) continue;
    if (obj) {
      if (!obj.slays || !obj.slays[i]) continue;
    } else {
      /* DEFERRED: temporary slay (player_has_temporary_slay). */
      continue;
    }

    if (reactToSpecificSlay(s, mon)) {
      const mult = isOCombat ? s.oMultiplier : s.multiplier;
      if (bestMult < mult) {
        bestMult = mult;
        mod.brand = 0;
        mod.slay = i;
        mod.verb = range ? s.rangeVerb : s.meleeVerb;
      }
    }
  }
}
