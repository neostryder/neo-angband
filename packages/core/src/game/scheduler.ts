/**
 * Creature scheduling, ported from process_monsters() and reset_monsters()
 * in reference/src/mon-move.c plus the player-energy / turn-counter steps of
 * run_game_loop() in reference/src/game-world.c (Angband 4.2.6).
 *
 * Each pass, every live monster is energised by its net speed and, once it
 * has reached move_energy, spends a turn (in the upstream backwards scan
 * order, highest slot first). process_monsters(minimum_energy) only touches
 * monsters that already hold at least `minimum_energy`, which is how the loop
 * lets monsters "with even more energy than the player" act before the
 * player: it calls process_monsters(player_energy + 1) first. MFLAG_HANDLED
 * stops a monster acting twice in one game turn; reset_monsters() clears it.
 *
 * The actual monster turn (the AI) is delegated to monster-turn.ts; the
 * energy/regen/active/timed bookkeeping around it is here, exactly as the
 * upstream process_monsters loop nests it.
 */

import { MFLAG, MON_TMD, RF } from "../generated";
import type { Monster } from "../mon/monster";
import { turnEnergy } from "./energy";
import type { GameState } from "./context";
import { updateMonsterDistances } from "./context";
import { monsterEffectLevel } from "../mon/timed";
import {
  monsterCheckActive,
  monsterTurn,
  processMonsterTimed,
} from "./monster-turn";

/** regen_monster: heal 1/100 of max hp per regeneration (doubled by REGEN). */
export function regenMonster(mon: Monster, num: number): void {
  if (mon.hp >= mon.maxhp) return;
  let frac = Math.trunc(mon.maxhp / 100);
  if (!frac) frac = 1;
  if (mon.race.flags.has(RF.REGENERATE)) frac *= 2;
  frac *= num;
  mon.hp += frac;
  if (mon.hp > mon.maxhp) mon.hp = mon.maxhp;
}

/** The monster's net speed after FAST / SLOW timed effects. */
function netSpeed(mon: Monster): number {
  let mspeed = mon.mspeed;
  if (mon.mTimed[MON_TMD.FAST] ?? 0) mspeed += 10;
  if (mon.mTimed[MON_TMD.SLOW] ?? 0) {
    mspeed -= 2 * monsterEffectLevel(mon, MON_TMD.SLOW);
  }
  return mspeed;
}

/**
 * process_monsters(minimum_energy): energise and run every monster holding at
 * least `minimum_energy`. Monsters are scanned high slot to low so a freshly
 * killed monster (its slot cleared) is simply skipped.
 */
export function processMonsters(state: GameState, minimumEnergy: number): void {
  const regen = state.turn % 100 === 0;

  /* update_mon keeps cdis current upstream; refresh it here before the AI
   * (and the active/range checks) read it. */
  updateMonsterDistances(state);

  for (let i = state.monsters.length - 1; i >= 1; i--) {
    if (state.isDead || state.generateLevel) break;

    const mon = state.monsters[i];
    if (!mon) continue;
    if (mon.mflag.has(MFLAG.HANDLED)) continue;
    if (mon.energy < minimumEnergy) continue;

    const moving = mon.energy >= state.z.moveEnergy;
    mon.mflag.on(MFLAG.HANDLED);

    if (regen) regenMonster(mon, 1);

    mon.energy += turnEnergy(netSpeed(mon), state.z.moveEnergy);

    if (!moving) continue;

    /* Use up "some" energy. */
    mon.energy -= state.z.moveEnergy;

    /* Mimics lie in wait: DEFERRED. */

    if (monsterCheckActive(mon, state)) {
      if (processMonsterTimed(mon, state)) continue;
      monsterTurn(mon, state);
      /* monster_take_terrain_damage after the turn: DEFERRED. */
    }
  }
}

/** reset_monsters: clear MFLAG_HANDLED so every monster can act again. */
export function resetMonsters(state: GameState): void {
  for (let i = state.monsters.length - 1; i >= 1; i--) {
    const mon = state.monsters[i];
    if (mon) mon.mflag.off(MFLAG.HANDLED);
  }
}

/**
 * Give the player a game turn's worth of energy
 * (player->energy += turn_energy(player->state.speed)).
 */
export function givePlayerEnergy(state: GameState): void {
  state.actor.energy += turnEnergy(state.actor.speed, state.z.moveEnergy);
}
