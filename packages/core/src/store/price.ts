/**
 * Store pricing, ported from reference/src/store.c (Angband 4.2.6): price_item.
 *
 * This is the economics layer on top of object valuation (obj/value.ts): the
 * buy-versus-sell asymmetry, the black-market surcharge (applied twice on the
 * sell side), the birth_no_selling kill-switch, and the owner's purse cap.
 */

import { FEAT } from "../generated";
import { tvalCanHaveCharges } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { ObjRegistry } from "../obj/bind";
import { objectValue, objectValueReal } from "../obj/value";

/**
 * price_item (store.c L579): the price of `obj` (qty one, or a wand/staff
 * stack) in a store. A shop never loses money on a trade.
 *
 * @param store the entrance-feature carrier (BoundStore); only .feat is read,
 *   to detect the black market.
 * @param owner the current proprietor (StoreOwner); .maxCost is the purse cap.
 * @param storeBuying true when the shop is buying (player selling), false when
 *   the shop is selling (player buying).
 * @param aware object_flavor_is_aware(obj), for object_value's dispatch.
 * @param noSelling OPT(player, birth_no_selling): when set, the shop pays 0.
 */
export function priceItem(
  reg: ObjRegistry,
  store: { feat: number },
  owner: { maxCost: number },
  obj: GameObject,
  storeBuying: boolean,
  qty: number,
  aware: boolean,
  noSelling: boolean,
): number {
  let adjust = 100;
  let price: number;

  /* Get the value of the stack of wands, or a single item. */
  if (tvalCanHaveCharges(obj.tval)) {
    price = storeBuying
      ? Math.min(objectValueReal(reg, obj, qty), objectValue(reg, obj, qty, aware))
      : Math.max(objectValueReal(reg, obj, qty), objectValue(reg, obj, qty, aware));
  } else {
    price = storeBuying
      ? Math.min(objectValueReal(reg, obj, 1), objectValue(reg, obj, 1, aware))
      : Math.max(objectValueReal(reg, obj, 1), objectValue(reg, obj, 1, aware));
  }

  /* Worthless items. */
  if (price <= 0) {
    return storeBuying ? 0 : qty;
  }

  /* The black market is always a worse deal. */
  if (store.feat === FEAT.STORE_BLACK) adjust = 150;

  if (storeBuying) {
    /* Set the factor. */
    adjust = 100 + (100 - adjust);
    if (adjust > 100) adjust = 100;

    /* Shops now pay 2/3 of true value. */
    price = Math.trunc((price * 2) / 3);

    /* Black market sucks. */
    if (store.feat === FEAT.STORE_BLACK) price = Math.trunc(price / 2);

    /* Check for no_selling option. */
    if (noSelling) return 0;
  } else {
    /* Re-evaluate if we're selling. */
    price = tvalCanHaveCharges(obj.tval)
      ? objectValueReal(reg, obj, qty)
      : objectValueReal(reg, obj, 1);

    /* Black market sucks. */
    if (store.feat === FEAT.STORE_BLACK) price = price * 2;
  }

  /* Compute the final price (with rounding). */
  price = Math.trunc((price * adjust + 50) / 100);

  /* Convert price to total price for non-wands. */
  if (!tvalCanHaveCharges(obj.tval)) price *= qty;

  /* Limit the price to the purse limit. */
  if (storeBuying && price > owner.maxCost * qty) {
    price = owner.maxCost * qty;
  }

  /* Never become "free". */
  if (price <= 0) return qty;

  return price;
}
