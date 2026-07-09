/**
 * The mutable game state the turn loop operates on, plus the square-occupancy
 * helpers the AI and player turn read.
 *
 * struct player upstream carries grid/energy/speed/total_energy; the port's
 * Player (player/player.ts) deliberately omits the world/UI-only members, so
 * this module holds them in a PlayerActor wrapper alongside the Player. Live
 * monsters live in a flat array indexed by midx (index 0 unused, matching
 * cave_monster(cave, i) for i >= 1); Chunk.mon(grid) stores the occupant
 * (0 empty, > 0 a monster's midx, < 0 the player) exactly as upstream's
 * square(c, grid)->mon.
 *
 * The loop couples to the outside world only through injected hooks: a
 * command provider (so it never blocks on real input) and an FOV-update hook
 * (called after the player moves, as game code calls update_view).
 */

import type { Loc } from "../loc";
import { distance, locEq } from "../loc";
import type { Rng } from "../rng";
import type { Chunk } from "../world/chunk";
import type { Player } from "../player/player";
import type { Monster } from "../mon/monster";
import type { PlayerCombatState } from "../combat/melee";
import type { DefenderState } from "../combat/mon-melee";
import type { GameObject } from "../obj/object";
import type { Brand, Slay } from "../obj/types";
import type { Gear } from "./gear";
import { NORMAL_ENERGY } from "./energy";

/**
 * z_info fields the turn loop and monster AI read (defaults are the shipped
 * constants.txt values). Kept as a plain record so tests can override any
 * single field.
 */
export interface GameConstants {
  /** z_info->move_energy. */
  moveEnergy: number;
  /** z_info->max_sight (flee_range = max_sight + flee-range). */
  maxSight: number;
  /** z_info->flee_range. */
  fleeRange: number;
  /** z_info->turn_range (nearby monsters won't run away). */
  turnRange: number;
  /** z_info->day_length (is_daytime; town cycle DEFERRED). */
  dayLength: number;
  /** z_info->food_value. */
  foodValue: number;
  /** PY_FOOD_STARVE / _FAINT / _WEAK (food_value-scaled grade maxima). */
  foodStarve: number;
  foodFaint: number;
  foodWeak: number;
}

/** The shipped constants.txt values, food thresholds scaled by food_value. */
export const DEFAULT_GAME_CONSTANTS: GameConstants = {
  moveEnergy: NORMAL_ENERGY,
  maxSight: 20,
  fleeRange: 5,
  turnRange: 5,
  dayLength: 10000,
  foodValue: 100,
  foodStarve: 100,
  foodFaint: 400,
  foodWeak: 800,
};

/**
 * The player's world/turn-loop state (the struct player members the port's
 * Player omits), plus the combat/defence views combat needs. `combat` backs
 * py_attack (player-attack.c p->state) and `defense` backs make_attack_normal
 * (p->state.ac + p->state.to_a); calc_bonuses that would derive them is
 * deferred (player/calcs.ts), so they are supplied explicitly.
 */
export interface PlayerActor {
  player: Player;
  /** p->grid. */
  grid: Loc;
  /** p->energy. */
  energy: number;
  /** p->state.speed (net speed after effects; 110 = normal). */
  speed: number;
  /** p->total_energy (cumulative energy spent). */
  totalEnergy: number;
  /** player-attack.c reads this as p->state. */
  combat: PlayerCombatState;
  /** make_attack_normal reads ac + to_a from this. */
  defense: DefenderState;
  /** The wielded melee weapon, or null for unarmed (py_attack). */
  weapon: GameObject | null;
  /** p->state.skills[SKILL_STEALTH]; the AI's hearing math reads it. */
  stealth: number;
}

/**
 * The full mutable game state. `turn` is the upstream int32 game-turn counter;
 * `monsters` is indexed by midx with index 0 unused. Signals mirror the
 * upstream player->upkeep flags the loop branches on.
 */
export interface GameState {
  rng: Rng;
  chunk: Chunk;
  actor: PlayerActor;
  /**
   * The player's gear store (obj-gear.c): a handle -> object map, the pack
   * (non-equipped handles) and the equipment[] handles on actor.player.
   * Populated at birth by outfitPlayer (game/gear.ts).
   */
  gear: Gear;
  /** cave_monster(cave, i): live monsters, index 0 unused (null). */
  monsters: Array<Monster | null>;
  /** turn (game-world.c): the game-turn counter. */
  turn: number;
  z: GameConstants;
  /** Object domain tables for player melee brands/slays (index 0 = none). */
  brands: readonly (Brand | null)[];
  slays: readonly (Slay | null)[];

  /* --- upkeep signals (player->upkeep) --- */
  playing: boolean;
  /** player->is_dead. */
  isDead: boolean;
  /** player->upkeep->generate_level (a stairs/recall level change). */
  generateLevel: boolean;

  /* --- injected hooks --- */
  /** cmdq_pop: the next queued player command, or null when input is needed. */
  nextCommand: () => PlayerCommand | null;
  /** update_view: refresh player FOV after the player moves. */
  updateFov?: (state: GameState) => void;
}

/** One queued player command (a keyed action plus optional direction/args). */
export interface PlayerCommand {
  /** The action-registry key (e.g. "walk", "hold", "descend"). */
  code: string;
  /** Keypad direction 1..9 for movement commands. */
  dir?: number;
  /** Free-form arguments a mod-registered action may read. */
  args?: Readonly<Record<string, unknown>>;
}

/** cave_monster_max(cave): one past the highest occupied monster slot. */
export function monsterMax(state: GameState): number {
  return state.monsters.length;
}

/** cave_monster(cave, i): the monster in slot i, or null. */
export function monsterAt(state: GameState, i: number): Monster | null {
  return state.monsters[i] ?? null;
}

/**
 * Add a monster to the state and mark its grid occupied, assigning the next
 * free midx. Mirrors the midx/square bookkeeping place_new_monster does.
 */
export function addMonster(state: GameState, mon: Monster): number {
  if (state.monsters.length === 0) state.monsters.push(null);
  const midx = state.monsters.length;
  mon.midx = midx;
  state.monsters.push(mon);
  state.chunk.setMon(mon.grid, midx);
  return midx;
}

/** square_monster(c, grid): the monster occupying a grid, or null. */
export function squareMonster(state: GameState, grid: Loc): Monster | null {
  if (!state.chunk.inBounds(grid)) return null;
  const idx = state.chunk.mon(grid);
  return idx > 0 ? (state.monsters[idx] ?? null) : null;
}

/** square_isplayer(c, grid): the player occupies this grid. */
export function squareIsPlayer(state: GameState, grid: Loc): boolean {
  return locEq(grid, state.actor.grid);
}

/**
 * square_isempty reduced to the loop's needs: passable feature, no monster
 * and not the player. (Player-trap / web / object refinements DEFERRED.)
 */
export function squareIsEmpty(state: GameState, grid: Loc): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  if (!state.chunk.isPassable(grid)) return false;
  if (state.chunk.mon(grid) !== 0) return false;
  return !squareIsPlayer(state, grid);
}

/**
 * monster_swap(grid1, grid2) for the two cases the ported AI produces: a
 * monster stepping into an empty grid, and two monsters trading places. The
 * player is never swapped here (the AI attacks the player instead of moving
 * onto it).
 */
export function monsterSwap(state: GameState, grid1: Loc, grid2: Loc): void {
  const c = state.chunk;
  const m1 = c.mon(grid1);
  const m2 = c.mon(grid2);
  c.setMon(grid1, m2);
  c.setMon(grid2, m1);
  const mon1 = m1 > 0 ? state.monsters[m1] : null;
  const mon2 = m2 > 0 ? state.monsters[m2] : null;
  if (mon1) mon1.grid = grid2;
  if (mon2) mon2.grid = grid1;
}

/**
 * delete_monster_idx (mon-make.c), minimal: clear the monster's square and
 * free its slot. The held-object drop, monster-group, mimic, racial-counter
 * and targeting/redraw bookkeeping are DEFERRED with their subsystems (floor
 * objects, groups, lore); the caller runs monster_death (drops) beforehand.
 */
export function deleteMonster(state: GameState, midx: number): void {
  const mon = state.monsters[midx];
  if (!mon) return;
  state.chunk.setMon(mon.grid, 0);
  state.monsters[midx] = null;
}

/**
 * Mark the player's starting grid occupied (square(c, grid)->mon = -1) and
 * set actor.grid, mirroring how the player is placed on a fresh level.
 */
export function placePlayer(state: GameState, grid: Loc): void {
  state.actor.grid = grid;
  state.chunk.setMon(grid, -1);
}

/**
 * Move the player to a new grid, updating the square-occupancy marker
 * (clear the old grid, mark the new one with the player sentinel -1).
 */
export function movePlayer(state: GameState, grid: Loc): void {
  state.chunk.setMon(state.actor.grid, 0);
  state.actor.grid = grid;
  state.chunk.setMon(grid, -1);
}

/** Refresh mon->cdis for every live monster (update_mon does this upstream). */
export function updateMonsterDistances(state: GameState): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.cdis = distance(mon.grid, state.actor.grid);
  }
}
