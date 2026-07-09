/**
 * Object valuation, ported from the pricing half of reference/src/obj-power.c
 * (Angband 4.2.6): object_value_base, object_value_real, object_value.
 *
 * SCOPE: the constant-price path is LIVE. Items whose price does not depend on
 * individual properties - potions, scrolls, food, mushrooms, flasks, wands,
 * staves, rods, chests, etc. - are priced here from the kind's base cost (plus
 * a per-charge premium for wands and staves), exactly as upstream.
 *
 * DEFERRED (ledgered in parity/ledger/obj-value.yaml): the VARIABLE-power path.
 * object_value_real prices wearables and ammo by object_power (the ~1000-line
 * obj-power.c engine, which also recurses through the curse system via
 * curse_power/apply_curse_attributes); that engine is not ported yet, so this
 * module throws for those items rather than guess a price. object_value's full
 * dispatch and price_item additionally need flavor-awareness (the object-
 * knowledge system), so they wait on both pieces.
 */

import { TV } from "../generated";
import { tvalCanHaveCharges, tvalHasVariablePower } from "./object";
import type { GameObject } from "./object";

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
 * Constant-price items are priced from kind.cost; wands and staves add a
 * premium for their charges. Wearables and ammo are priced by object_power -
 * DEFERRED (throws until obj-power.c is ported).
 */
export function objectValueReal(obj: GameObject, qty: number): number {
  if (tvalHasVariablePower(obj.tval)) {
    throw new Error(
      "object_value_real: variable-power valuation needs object_power" +
        " (obj-power.c), not yet ported",
    );
  }

  /* Worthless items. */
  if (!obj.kind.cost) return 0;

  /* Base cost. */
  const value = obj.kind.cost;
  let totalValue: number;

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

  return totalValue;
}
