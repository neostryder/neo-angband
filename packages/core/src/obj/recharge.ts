/**
 * Rod / activatable recharge helpers, ported from reference/src/obj-util.c
 * (Angband 4.2.6): number_charging (L1020) and recharge_timeout (L1045), plus
 * the tval_can_have_timeout gate (obj-tval.c L120).
 *
 * These back recharge_objects (game-world.c) in the once-every-ten-turns world
 * upkeep: a rod (or activatable) counts down its obj->timeout by the number of
 * items currently charging, so a stack of rods gains one charge per unit of
 * charge time. Every value comes from randcalc(obj->time, 0, AVERAGE) which is
 * deterministic (no RNG draw), so recharging never perturbs the seeded stream.
 */

import type { Rng } from "../rng";
import type { GameObject } from "./object";
import { tvalCanHaveTimeout } from "./object";

export { tvalCanHaveTimeout };

/**
 * number_charging (obj-util.c L1020): how many items in the stack are still
 * charging, from the average charge time and the current timeout. Draws no RNG
 * (randcalc AVERAGE is a static evaluation).
 */
export function numberCharging(rng: Rng, obj: GameObject): number {
  const chargeTime = rng.randcalc(obj.time, 0, "average");

  /* Item has no timeout. */
  if (chargeTime <= 0) return 0;

  /* No items are charging. */
  if (obj.timeout <= 0) return 0;

  /* Calculate number charging based on timeout. */
  let numCharging = Math.trunc((obj.timeout + chargeTime - 1) / chargeTime);

  /* Number charging cannot exceed stack size. */
  if (numCharging > obj.number) numCharging = obj.number;

  return numCharging;
}

/**
 * recharge_timeout (obj-util.c L1045): let a stack of charging objects charge
 * by one unit per charging object. Returns true if at least one item obtained a
 * charge. Draws no RNG.
 */
export function rechargeTimeout(rng: Rng, obj: GameObject): boolean {
  /* Find the number of charging items. */
  const chargingBefore = numberCharging(rng, obj);

  /* Nothing to charge. */
  if (chargingBefore === 0) return false;

  /* Decrease the timeout. */
  obj.timeout -= Math.min(chargingBefore, obj.timeout);

  /* Find the new number of charging items. */
  const chargingAfter = numberCharging(rng, obj);

  /* Return true if at least 1 item obtained a charge. */
  return chargingAfter < chargingBefore;
}
