/**
 * player_best_digger (player-util.c L744) plus the swap-and-recompute tail that
 * do_cmd_tunnel_aux (cmd-cave.c L546-588) and compute_rubble_penalty
 * (player-path.c L219-256) share, ported from Angband 4.2.6.
 *
 * Digging normally uses the wielded weapon's DIGGING skill, but a better digger
 * carried in the pack is temporarily wielded first: upstream finds the pack's
 * best melee weapon (by the DIGGING skill it would grant), and if it differs
 * from the current weapon and the current weapon can be removed, recomputes the
 * bonuses with it swapped in and reads that DIGGING. This module reproduces that
 * choice and returns the DIGGING skill to feed into the existing dig roll.
 *
 * RNG: player_best_digger and the swap are RNG-FREE - they only change the INPUT
 * (the DIGGING skill) to the caller's existing randint0(1600) draw. calc_bonuses
 * takes no Rng, so `computeDigging` draws nothing; the caller's draw count and
 * order are unchanged. This is deliberately input-only (do not add or reorder
 * any draw here).
 */

import { OF } from "../generated";
import type { GameObject } from "../obj/object";
import { tvalIsMeleeWeapon } from "../obj/object";

/**
 * player_best_digger + the do_cmd_tunnel_aux / compute_rubble_penalty swap:
 * return the DIGGING skill the dig should use, given the live per-body-slot
 * equipment, every carried object (upstream p->gear, pack + equipped), the
 * weapon body-slot index, and a `computeDigging` that runs calc_bonuses over a
 * candidate equipment array and returns its SKILL_DIGGING (update=false, so no
 * side effects and no RNG).
 *
 * The best pack digger is the qualifying melee weapon whose wielded DIGGING is
 * highest (upstream's strict `score > best_score`, so ties keep the first-seen
 * object - immaterial here since ties share the same DIGGING value). The swap
 * only applies when that object differs from the current weapon AND the current
 * weapon can be taken off (obj_can_takeoff: not sticky-cursed); otherwise the
 * current wielded DIGGING stands.
 */
export function playerBestDiggerDigging(
  liveEquipment: readonly (GameObject | null)[],
  gearObjects: readonly GameObject[],
  weaponSlot: number,
  computeDigging: (equipment: (GameObject | null)[]) => number,
): number {
  const currentWeapon =
    weaponSlot >= 0 ? (liveEquipment[weaponSlot] ?? null) : null;

  /* player_best_digger: prefer any qualifying melee weapon over unarmed
     (best == null), scoring each with it temporarily in the weapon slot. */
  let best: GameObject | null = null;
  let bestScore = -1;
  for (const obj of gearObjects) {
    if (!tvalIsMeleeWeapon(obj.tval)) continue;
    /* forbid_stack is false here, so any positive-count item qualifies. */
    if (obj.number < 1) continue;
    /* Don't use it if it has a sticky curse (obj_can_takeoff). */
    if (obj.flags.has(OF.STICKY)) continue;

    const candidate = liveEquipment.slice();
    if (weaponSlot >= 0) candidate[weaponSlot] = obj;
    const score = computeDigging(candidate);
    if (score > bestScore) {
      best = obj;
      bestScore = score;
    }
  }

  /* do_cmd_tunnel_aux / compute_rubble_penalty swap condition: only swap when
     the best differs from the current weapon and the current weapon can come
     off (a null current weapon - unarmed - always can). */
  const swap =
    best !== currentWeapon &&
    (currentWeapon === null || !currentWeapon.flags.has(OF.STICKY));

  if (swap) {
    const equip = liveEquipment.slice();
    if (weaponSlot >= 0) equip[weaponSlot] = best;
    return computeDigging(equip);
  }
  return computeDigging(liveEquipment.slice());
}
