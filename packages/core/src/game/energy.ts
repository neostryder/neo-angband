/**
 * The turn/energy core, ported from reference/src/game-world.c (Angband
 * 4.2.6): the extract_energy[] table, turn_energy(), z_info->move_energy
 * (NORMAL_ENERGY), and the rule that an actor may act once its accumulated
 * energy reaches move_energy.
 *
 * The energy table and turn_energy() already live in ../mon/monster (the
 * monster domain needs them at construction time); they are the exact
 * upstream extract_energy[200] and turn_energy(speed) = extract_energy[speed]
 * * move_energy / 100. This module re-exports them as the canonical turn-loop
 * arithmetic and adds the small threshold/spend helpers the scheduler and
 * loop build on. Everything here is pure so the loop stays deterministic
 * under a seeded Rng.
 */

import { EXTRACT_ENERGY, turnEnergy } from "../mon/monster";

export { EXTRACT_ENERGY, turnEnergy };

/**
 * z_info->move_energy default (constants.txt world:move-energy). One
 * "normal" action costs this much energy, and an actor may act when its
 * energy has reached it.
 */
export const NORMAL_ENERGY = 100;

/**
 * The speed at which extract_energy[] yields exactly 10 energy per game
 * turn: index 110 in the table ("Norm"). A normal-speed actor therefore
 * takes one action every move_energy / 10 == 10 game turns.
 */
export const NORMAL_SPEED = 110;

/**
 * True when an actor with this much accumulated energy is allowed to take a
 * turn (mon->energy >= z_info->move_energy; player->energy >= move_energy).
 */
export function canAct(energy: number, moveEnergy = NORMAL_ENERGY): boolean {
  return energy >= moveEnergy;
}

/**
 * Energy after gaining a turn's worth at the given speed
 * (actor->energy += turn_energy(speed)).
 */
export function gainEnergy(
  energy: number,
  speed: number,
  moveEnergy = NORMAL_ENERGY,
): number {
  return energy + turnEnergy(speed, moveEnergy);
}

/**
 * Energy after spending `amount` on an action (player->energy -=
 * energy_use; mon->energy -= move_energy). Not clamped: upstream lets energy
 * go slightly negative and recover, which keeps fast actors on schedule.
 */
export function spendEnergy(energy: number, amount: number): number {
  return energy - amount;
}
