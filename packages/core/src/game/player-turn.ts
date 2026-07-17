/**
 * The player-action layer: a string-keyed action registry and the
 * process_player() command pump, ported from reference/src/cmd-core.c
 * (cmdq_pop / the command dispatch), game-world.c (process_player and
 * process_player_cleanup: player->energy -= energy_use) and the move/attack
 * path of cmd-cave.c / player-util.c / player-attack.c (Angband 4.2.6).
 *
 * The registry is the moddability seam (decision 13): a command code maps to
 * an action that mutates the game state and returns the energy it spent
 * (0 = a free, non-turn-consuming command). Mods add or replace codes without
 * touching the core. The built-in actions cover walk (move / melee an
 * adjacent monster), hold/rest (spend a turn in place) and the stair commands
 * (signal a level change). Every other command code is registered as a stub
 * that spends no energy and is ledgered as deferred.
 *
 * process_player() reads queued commands through the injected provider
 * (state.nextCommand) so the loop never blocks on real input, and drains free
 * commands until one uses energy or the queue empties, exactly as the
 * upstream do-while around cmdq_pop.
 */

import { TMD } from "../generated";
import { DDGRID } from "../loc";
import type { Loc } from "../loc";
import { pyAttack } from "../combat/melee";
import { learnBrandSlayFromMelee } from "../combat/brand-slay";
import { getLore } from "../mon/lore";
import { monsterIsCamouflaged } from "../mon/predicate";
import { monsterWake } from "../mon/take-hit";
import { equipLearnOnMeleeAttack } from "../obj/knowledge";
import type { GameState, PlayerCommand } from "./context";
import { arenaInterceptDeath, deleteMonster, movePlayer, squareMonster } from "./context";

/**
 * A player action: mutate the state for `cmd` and return the energy spent
 * (player->upkeep->energy_use). Zero means the command consumed no turn.
 */
export type PlayerAction = (state: GameState, cmd: PlayerCommand) => number;

/**
 * The action registry (moddable command table). Built-ins can be replaced and
 * new codes added; unknown codes fall back to a no-energy stub.
 */
export class ActionRegistry {
  private actions = new Map<string, PlayerAction>();

  /** Register (or replace) the action for a command code. */
  register(code: string, action: PlayerAction): void {
    this.actions.set(code, action);
  }

  has(code: string): boolean {
    return this.actions.has(code);
  }

  /** The action for a code, or undefined if none is registered. */
  get(code: string): PlayerAction | undefined {
    return this.actions.get(code);
  }

  codes(): string[] {
    return Array.from(this.actions.keys());
  }
}

/** The direction offset for a keypad command (5 / missing => no move). */
function commandOffset(cmd: PlayerCommand): Loc | null {
  const dir = cmd.dir;
  if (dir === undefined || dir < 1 || dir > 9 || dir === 5) return null;
  return DDGRID[dir] as Loc;
}

/**
 * walk: melee an adjacent monster (py_attack) or step onto a passable grid,
 * refreshing FOV via the injected hook. Returns move_energy when the turn is
 * spent, 0 when blocked by a wall (a bump uses no energy).
 */
export function walkAction(state: GameState, cmd: PlayerCommand): number {
  const offset = commandOffset(cmd);
  if (!offset) return 0;

  const next: Loc = { x: state.actor.grid.x + offset.x, y: state.actor.grid.y + offset.y };
  if (!state.chunk.inBounds(next)) return 0;

  const target = squareMonster(state, next);
  if (target) {
    /* move_player (cmd-cave.c L1071): a camouflaged monster in the way
     * surprises the player instead of being attacked - reveal it and wake it,
     * matching upstream's become_aware + monster_wake(mon, false, 100). */
    if (monsterIsCamouflaged(target)) {
      state.becomeAware?.(target);
      monsterWake(state.rng, target, false, 100);
      return state.z.moveEnergy;
    }
    /* Learning from the attack (player-attack.c L822 equip_learn_on_melee_
     * attack; obj-slays.c learn_brand_slay_from_melee). The target is
     * treated as visible, matching the monVisible option below. */
    learnBrandSlayFromMelee(
      state.actor.player,
      state.runeEnv,
      state.actor.weapon,
      {
        race: target.race,
        visible: true,
        lore: getLore(state.lore, target.race),
      },
    );
    const result = pyAttack(
      state.rng,
      state.actor.player,
      state.actor.combat,
      state.actor.weapon,
      target,
      state.brands,
      state.slays,
      {
        monVisible: true,
        percentDamage: state.options?.get("birth_percent_damage") ?? false,
      },
    );
    equipLearnOnMeleeAttack(state.actor.player, state.runeEnv);
    /* py_attack message slice: hand the blow-by-blow result to the shell for
     * faithful "You hit/miss/slay the X" text (combat returns HitType keys
     * only). Before deletion so the monster name is still resolvable. */
    state.onMelee?.(target, result);
    if (result.monsterDied && !arenaInterceptDeath(state, target)) {
      state.onPlayerKill?.(target);
      deleteMonster(state, target.midx);
    }
    return state.z.moveEnergy;
  }

  /* Bump into a wall: no step, no energy (disturb/knowledge DEFERRED).
   * QoL auto-dig (mod seam): walking into known diggable terrain the player can
   * dig begins one tunnel attempt instead of a no-op bump. autoDigStep returns 0
   * without drawing RNG unless the qol.autoDig flag is on and the grid qualifies,
   * so faithful core (no mod / flag off) still just bumps. */
  if (!state.chunk.isPassable(next)) {
    const dug = state.autoDigStep?.(state, next) ?? 0;
    return dug > 0 ? dug : 0;
  }

  movePlayer(state, next);
  if (state.updateFov) state.updateFov(state);

  /* Autopickup on the new grid (upstream queues CMD_AUTOPICKUP; its energy
   * cost is folded into this step, see game/pickup.ts). */
  const pickupCost = state.autoPickup ? state.autoPickup(state) : 0;

  /* Trap / terrain consequences of the step (move_player -> hit_trap). */
  state.onPlayerMoved?.(state, next);

  return state.z.moveEnergy + pickupCost;
}

/** hold / rest: stay put and spend a full turn. */
export function holdAction(state: GameState, _cmd: PlayerCommand): number {
  return state.z.moveEnergy;
}

/**
 * descend / ascend: signal a level change (player->upkeep->generate_level).
 * The actual level generation and depth change are DEFERRED to the world
 * integration; the loop observes the signal and clears it.
 */
export function descendAction(state: GameState, _cmd: PlayerCommand): number {
  state.generateLevel = true;
  return state.z.moveEnergy;
}

export function ascendAction(state: GameState, _cmd: PlayerCommand): number {
  state.generateLevel = true;
  return state.z.moveEnergy;
}

/** A deferred command: consumes no turn (ledgered as not yet ported). */
export function stubAction(_state: GameState, _cmd: PlayerCommand): number {
  return 0;
}

/** Command codes registered as stubs (deferred; see game-loop.yaml).
 * "pickup"/"autopickup" stubs are replaced by installPickup (game/pickup.ts);
 * "run" is replaced by installRunning (game/player-path.ts). */
export const STUBBED_COMMANDS: readonly string[] = [
  "tunnel",
  "cast",
  "fire",
  "throw",
  "quaff",
  "read",
  "eat",
  "use-staff",
  "aim-wand",
  "zap-rod",
  "activate",
  "pickup",
  "drop",
  "wield",
  "takeoff",
  "look",
  "search",
  "disarm",
  "open",
  "close",
];

/** Build the default registry: the ported actions plus the deferred stubs. */
export function createDefaultRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  reg.register("walk", walkAction);
  reg.register("hold", holdAction);
  reg.register("rest", holdAction);
  reg.register("descend", descendAction);
  reg.register("ascend", ascendAction);
  for (const code of STUBBED_COMMANDS) reg.register(code, stubAction);
  return reg;
}

/** The result of pumping the player's command queue. */
export interface PlayerTurnResult {
  /** The provider had no command ready: the loop should return for input. */
  needsInput: boolean;
  /** Energy spent this call (0 when a free command ran or input is needed). */
  energyUsed: number;
}

/**
 * process_player: drain queued commands until one spends energy, the queue
 * empties (needsInput), or the player dies / a level change is requested.
 * Applies the process_player_cleanup energy accounting for the spending
 * command (player->energy -= energy_use; total_energy += energy_use).
 */
export function processPlayer(
  state: GameState,
  registry: ActionRegistry,
): PlayerTurnResult {
  let energyUsed = 0;
  do {
    if (state.isDead || state.generateLevel) break;

    /* Drain the internal queue (cmdq) first - self-continuing commands like
     * running push their follow-up there - then ask the injected provider. */
    const cmd =
      state.cmdQueue && state.cmdQueue.length > 0
        ? state.cmdQueue.shift()!
        : state.nextCommand();
    if (!cmd) return { needsInput: true, energyUsed: 0 };

    /* While TMD_COMMAND runs, the player's commands drive the commanded
     * monster instead (cmd-core.c L333 swaps the command list). */
    const commanding =
      (state.actor.player.timed[TMD.COMMAND] ?? 0) > 0 && state.monCommand;
    const action = commanding
      ? state.monCommand!
      : (registry.get(cmd.code) ?? stubAction);
    const use = action(state, cmd);
    if (use > 0) {
      state.actor.energy -= use;
      state.actor.totalEnergy += use;
      energyUsed = use;
    }
  } while (energyUsed === 0 && !state.isDead && !state.generateLevel);

  return { needsInput: false, energyUsed };
}
