/**
 * Object valuation, ported from the pricing half of reference/src/obj-power.c
 * (Angband 4.2.6): object_value_base, object_value_real, object_value.
 *
 * The variable-power path (weapons, launchers, ammo, armour, jewelry, lights)
 * is priced from object_power (see power.ts); constant-price kinds (potions,
 * scrolls, food, wands, staves, rods, ...) are priced from the kind's base
 * cost, plus a per-charge premium for wands and staves.
 *
 * object_value dispatches by flavor-awareness (supplied by the caller's
 * FlavorKnowledge) and item class. For variable-power items upstream prices the
 * obj->known partial-knowledge twin (obj-power.c L1257-1259); a caller that
 * supplies an ObjectValueKnowledge context makes object_value synthesise that
 * twin (the port's on-demand known shadow) and price it, so an item with
 * still-unknown runes is valued from what the player actually knows. A caller
 * with no context prices the real object, which is exact for a fully-known item
 * (store stock, identified gear) and over-values only an item with unknown runes.
 */

import { OF, TV } from "../generated";
import { INT_MAX, INT_MIN } from "../guard";
import type { Player } from "../player/player";
import type { ObjRegistry } from "./bind";
import type { KnownDesc } from "./known-object";
import { objectKnownShadow } from "./known-object";
import type { RuneEnv } from "./knowledge";
import {
  tvalCanHaveCharges,
  tvalCanHaveFlavor,
  tvalHasVariablePower,
  tvalIsAmmo,
  tvalIsLight,
} from "./object";
import type { GameObject } from "./object";
import { objectPower } from "./power";

/**
 * AMMO_RESCALER (obj-power.h): a stack of this many pieces of ammo (or plain
 * torches) is worth one weapon of the same damage output.
 */
const AMMO_RESCALER = 20;

/**
 * object_value_base (obj-power.c L1060): a guess at the value of a non-aware
 * item. `aware` is object_flavor_is_aware(obj); when the item's flavor is known
 * the kind's real cost is used, otherwise a flat per-tval estimate.
 */
export function objectValueBase(obj: GameObject, aware: boolean): number {
  /* Use template cost for aware objects. */
  if (aware) return obj.kind.cost;

  /* Analyze the type. */
  switch (obj.tval) {
    case TV.FOOD:
    case TV.MUSHROOM:
      return 5;
    case TV.POTION:
    case TV.SCROLL:
      return 20;
    case TV.RING:
    case TV.AMULET:
      return 45;
    case TV.WAND:
      return 50;
    case TV.STAFF:
      return 70;
    case TV.ROD:
      return 90;
    default:
      return 0;
  }
}

/**
 * object_value_real (obj-power.c L1099): the real price of a known (or partly
 * known) item, for a stack of `qty`.
 *
 * Wearables and ammo are priced by object_power via a quadratic
 * value = power * (power * a + b) (a = 1, b = 5), scaled down by AMMO_RESCALER
 * for ammo and non-ego burning torches. Constant-price kinds use kind.cost,
 * with a per-charge premium for wands and staves.
 */
export function objectValueReal(
  reg: ObjRegistry,
  obj: GameObject,
  qty: number,
): number {
  /* Quadratic (a) and linear (b) coefficients; both must be non-negative. */
  const a = 1;
  const b = 5;
  let value = 0;
  let totalValue: number;

  /* Wearables and ammo vary by individual item properties. */
  if (tvalHasVariablePower(obj.tval)) {
    const power = objectPower(reg, obj);

    /* Protect against overflow. */
    if (power > 0) {
      if (a > 0) {
        if (power <= Math.trunc((Math.trunc(INT_MAX / power) - b) / a)) {
          value = power * (power * a + b);
        } else {
          value = INT_MAX;
        }
      } else if (b > 0) {
        value = power <= Math.trunc(INT_MAX / b) ? power * b : INT_MAX;
      } else {
        value = 0;
      }
    } else if (power < 0) {
      if (a > 0) {
        if (
          power > INT_MIN &&
          power >= Math.trunc((Math.trunc(INT_MIN / -power) + b) / a)
        ) {
          value = -power * (power * a - b);
        } else {
          value = INT_MIN;
        }
      } else if (b > 0) {
        value = power >= Math.trunc(INT_MIN / b) ? power * b : INT_MIN;
      } else {
        value = 0;
      }
    } else {
      value = 0;
    }

    /* Rescale for expendables. */
    if (
      (tvalIsLight(obj.tval) && obj.flags.has(OF.BURNS_OUT) && !obj.ego) ||
      tvalIsAmmo(obj.tval)
    ) {
      value = Math.trunc(value / AMMO_RESCALER);
    }

    /* Round up so things like cloaks are not worthless. */
    if (value === 0) value = 1;

    totalValue = value * qty;
    if (totalValue < 0) totalValue = 0;
  } else {
    /* Worthless items. */
    if (!obj.kind.cost) return 0;

    /* Base cost. */
    value = obj.kind.cost;

    /* Analyze the item type and quantity. */
    if (tvalCanHaveCharges(obj.tval)) {
      totalValue = value * qty;

      /* Calculate number of charges, rounded up. */
      let charges = Math.floor((obj.pval * qty) / obj.number);
      if ((obj.pval * qty) % obj.number !== 0) charges++;

      /* Pay extra for charges, depending on standard number of charges. */
      totalValue += Math.floor((value * charges) / 20);
    } else {
      totalValue = value * qty;
    }

    /* No negative value. */
    if (totalValue < 0) totalValue = 0;
  }

  return totalValue;
}

/**
 * The knowledge context object_value needs to synthesise the obj->known twin
 * (the port's on-demand known shadow) for a variable-power item, mirroring
 * upstream's object_value_real(obj->known) at obj-power.c L1258-1259.
 */
export interface ObjectValueKnowledge {
  /** The pricing player (upstream `player`; obj->known is built from p->obj_k). */
  p: Player;
  /** The rune/curse registries the shadow synthesis reads. */
  env: RuneEnv;
  /** Flavour-awareness deps the shadow synthesis reads. */
  deps: KnownDesc;
}

/**
 * object_value (obj-power.c L1253): the price of an item (qty one or a stack),
 * including plusses and charges, never noticing unknown bonuses.
 *
 * `aware` is object_flavor_is_aware(obj), supplied by the caller's
 * FlavorKnowledge. For a variable-power item upstream prices obj->known
 * (L1258-1259): when `known` is supplied this synthesises that twin from the
 * player's rune knowledge and prices it (so unknown runes are not paid for);
 * without it the real object is priced (exact for a fully-known item).
 */
export function objectValue(
  reg: ObjRegistry,
  obj: GameObject,
  qty: number,
  aware: boolean,
  known?: ObjectValueKnowledge,
): number {
  /* Variable-power items are assessed by what is known about them. */
  if (tvalHasVariablePower(obj.tval)) {
    const priced = known
      ? objectKnownShadow(obj, known.p, known.env, known.deps)
      : obj;
    return objectValueReal(reg, priced, qty);
  }
  /* Flavoured kinds the player is aware of price at their real cost. */
  if (tvalCanHaveFlavor(obj.kind.tval) && aware) {
    return objectValueReal(reg, obj, qty);
  }
  /* Otherwise, a flat base guess. */
  return objectValueBase(obj, aware) * qty;
}
