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

import { MON_TMD, TMD } from "../generated";
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
/* Value import is safe: mon-group's imports from this module are type-only,
 * so there is no runtime cycle. */
import { monsterRemoveFromGroups } from "./mon-group";

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
  /** z_info->max_range (the projectable / targeting range bound). */
  maxRange: number;
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
  /** z_info->floor_size (obj:floor-size): max objects in one floor pile. */
  floorSize: number;
  /** z_info->max_depth (world:max-depth): the trapdoor legality bound. */
  maxDepth: number;
  /** z_info->stair_skip (world:stair-skip): deep-descent increment scale. */
  stairSkip: number;
}

/** The shipped constants.txt values, food thresholds scaled by food_value. */
export const DEFAULT_GAME_CONSTANTS: GameConstants = {
  moveEnergy: NORMAL_ENERGY,
  maxSight: 20,
  maxRange: 20,
  fleeRange: 5,
  turnRange: 5,
  dayLength: 10000,
  foodValue: 100,
  foodStarve: 100,
  foodFaint: 400,
  foodWeak: 800,
  floorSize: 23,
  maxDepth: 128,
  stairSkip: 1,
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
 * struct monster_group (mon-group.c): a pack of monsters sharing a leader.
 * `members` is the member midx list; its head is the most recently added
 * member, mirroring upstream's member_list (add prepends).
 */
export interface MonsterGroup {
  /** The group's index in state.groups. */
  index: number;
  /** midx of the group leader (0 = none). */
  leader: number;
  /** Member midx list, head-first (most recently added). */
  members: number[];
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
  /** cave->monster_groups[]: monster packs, index 0 unused (null). */
  groups: Array<MonsterGroup | null>;
  /**
   * Floor object piles (square(c, grid)->obj), keyed by grid index
   * (y * width + x). Each pile is head-first: pile_insert prepends, so
   * pile[0] is the newest drop, exactly as the upstream linked list.
   * Managed by game/floor.ts (floor_carry / drop_near / excise).
   */
  floor: Map<number, GameObject[]>;
  /**
   * Live traps (square(c, grid)->trap), keyed by grid index, newest
   * first. Managed by game/trap.ts (place_trap / hit_trap / locks).
   * The type import is erased, so no runtime cycle with game/trap.
   */
  traps: Map<number, import("./trap").Trap[]>;
  /**
   * The player's map knowledge (the upstream player->cave twin, reduced):
   * remembered terrain and floor objects, possibly stale. Managed by
   * game/known.ts (square_memorize / note_spot / detection).
   */
  known: import("./known").KnownMap;
  /**
   * The player's target (target.c's file-statics). Managed by
   * game/target.ts (target_set_monster / target_okay / fix / release).
   */
  target: import("./target").TargetState;
  /**
   * The player's ignore settings (obj-ignore.c's file-statics: quality tiers,
   * ego ignore, per-kind flags). Defaults to nothing ignored. Persists in the
   * save. Read through state.isIgnored (built by the session with flavor
   * awareness), so worldless code stays decoupled from flavor knowledge.
   */
  ignore: import("../obj/ignore").IgnoreSettings;
  /**
   * ignore_item_ok(obj): whether an object is currently ignored. Installed by
   * the session (wireGame) with the flavor-awareness lookup baked in; absent,
   * nothing is ignored.
   */
  isIgnored?: (obj: GameObject) => boolean;
  /**
   * object_flavor_is_aware(kind): whether the player has identified this
   * kind's flavour. Installed by the session (wireGame) from flavor
   * knowledge, so presentation code (obj-list.c, #25) stays decoupled from
   * the flavor store the same way isIgnored does; absent, treated as aware.
   */
  isAware?: (kind: import("../obj/types").ObjectKind) => boolean;
  /**
   * obj->kind->flavor != NULL: whether flavor_init assigned this kind a
   * flavour. Installed by the session (wireGame) from the per-game
   * FlavorAssignment; absent, presentation falls back to the tval-only test.
   */
  hasFlavor?: (kind: import("../obj/types").ObjectKind) => boolean;
  /**
   * obj->kind->flavor->text: the flavour adjective ("Smoky") or scroll title
   * shown for an unaware flavoured object. Installed by wireGame from the
   * FlavorAssignment; absent, no '#' modstr is produced.
   */
  flavorText?: (kind: import("../obj/types").ObjectKind) => string;
  /**
   * The player option store (option.c op_ptr->opt / hitpoint_warn). Built by
   * the session (startGame / loadGame) from OPTION_ENTRIES defaults and the
   * birth-option choices; persists in the save. Optional so worldless tests
   * (game/harness.ts) stay total - each deferred seam reads it as
   * `dep ?? state.options?.get(name) ?? <shipped default>`, so an absent store
   * reproduces the shipped defaults exactly.
   */
  options?: import("../player/options").OptionState;
  /**
   * player->upkeep->health_who (health_track reduced to the tracked
   * monster; the health-bar redraw rides presentation, #25).
   */
  healthWho?: Monster | null;
  /**
   * Monster memory (upstream l_list), keyed by race.ridx and created
   * lazily by getLore (mon/lore.ts). Persists across levels and in the
   * save.
   */
  lore: import("../mon/lore").LoreStore;
  /** turn (game-world.c): the game-turn counter. */
  turn: number;
  z: GameConstants;
  /** Object domain tables for player melee brands/slays (index 0 = none). */
  brands: readonly (Brand | null)[];
  slays: readonly (Slay | null)[];
  /**
   * Rune-learning environment (obj-knowledge.c learn-by-use): registry
   * tables plus equipment access. Built by the session (wireGame); the
   * harness supplies an inert default so worldless tests stay total.
   */
  runeEnv: import("../obj/knowledge").RuneEnv;

  /* --- upkeep signals (player->upkeep) --- */
  playing: boolean;
  /** player->is_dead. */
  isDead: boolean;
  /** player->upkeep->generate_level (a stairs/recall level change). */
  generateLevel: boolean;
  /**
   * The depth the pending level change targets (dungeon_change_level's
   * argument). Set with generateLevel by stairs / trapdoors / deep
   * descent; consumed by the session's changeLevel.
   */
  targetDepth?: number;
  /**
   * player->upkeep->arena_level: the player is in (or headed to) single
   * combat. Set by EF_SINGLE_COMBAT; cleared by the arena exit.
   */
  arenaLevel?: boolean;
  /** player->old_grid: where to stand again after the arena. */
  oldGrid?: Loc;

  /**
   * The running engine's live state (player-path.c). Created lazily by the
   * run action (game/player-path.ts); absent until the player first runs.
   */
  run?: RunState;

  /* --- injected hooks --- */
  /**
   * cmdq: the internal command queue (cmd-core.c). Self-continuing commands
   * (running re-queues CMD_RUN) push here; processPlayer drains it before
   * nextCommand so a run advances without new input. disturb() flushes it.
   */
  cmdQueue?: PlayerCommand[];
  /** cmdq_pop: the next queued player command, or null when input is needed. */
  nextCommand: () => PlayerCommand | null;
  /** update_view: refresh player FOV after the player moves. */
  updateFov?: (state: GameState) => void;
  /**
   * make_ranged_attack: a monster attempts a spell / breath on its turn,
   * returning true if it spent the turn casting. Installed by
   * installMonsterCasting (game/mon-ranged.ts); absent, monsters never cast.
   */
  monsterCast?: (mon: Monster, state: GameState) => boolean;
  /**
   * do_cmd_mon_command: while TMD_COMMAND runs, player commands drive the
   * commanded monster instead (upstream swaps the command list,
   * cmd-core.c L333). Installed by installMonCommand (game/mon-cmd.ts);
   * returns the energy spent.
   */
  monCommand?: (state: GameState, cmd: PlayerCommand) => number;
  /**
   * do_autopickup after a step: returns the energy the pickup cost (picked
   * * move_energy / 10, capped). Installed by installPickup (game/pickup.ts);
   * upstream queues CMD_AUTOPICKUP instead - the port folds the identical
   * cost into the step because the command provider is injected.
   */
  autoPickup?: (state: GameState) => number;
  /**
   * Runs after the player steps onto a new grid (move_player's trap /
   * terrain consequences). Installed by installTraps (game/trap.ts).
   */
  onPlayerMoved?: (state: GameState, grid: Loc) => void;
  /**
   * player_kill_monster's reward slice: runs when the PLAYER kills a
   * monster, before it is deleted (experience now; drops/lore/quests join
   * it with their subsystems). Installed by the session (wireGame).
   */
  onPlayerKill?: (mon: Monster) => void;
  /**
   * PU_BONUS | PU_HP | PU_MANA: recompute the derived state from the
   * current gear (equipment commands call this after changing what is
   * worn). Installed by the session (wireGame).
   */
  updateBonuses?: () => void;
  /**
   * cave->decoy: the grid of the player's active decoy glyph (EF_GLYPH with
   * GLYPH_DECOY), or absent/null when none is deployed. Level state, like
   * traps; cleared when the decoy trap is destroyed or the level changes.
   */
  decoy?: Loc | null;
  /**
   * The world-event message sink (the recall yank, the deep-descent floor
   * opening). Presentation (#25) installs it; absent, the messages drop.
   */
  msg?: (text: string) => void;
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

/**
 * The running engine's state (player-path.c file-statics plus the
 * player->upkeep running counter). Created lazily by the run action; a
 * `running` of 0 means the player is not running. `firstStep` mirrors
 * upstream's running_firststep (the disturb-suppressed first step).
 */
export interface RunState {
  /** run_cur_dir: the direction we are moving. */
  curDir: number;
  /** run_old_dir: the direction we are considered to have come from. */
  oldDir: number;
  /** run_open_area: in the open on at least one side. */
  openArea: boolean;
  /** run_break_right: wall on the right, stop if it opens. */
  breakRight: boolean;
  /** run_break_left: wall on the left, stop if it opens. */
  breakLeft: boolean;
  /** player->upkeep->running: steps remaining (0 = not running). */
  running: number;
  /** player->upkeep->running_firststep. */
  firstStep: boolean;
  /**
   * player->upkeep->steps: a pathfinding path as forward keypad directions
   * in reverse order (index stepCount-1 is the next step); absent for a
   * plain run. Freed by disturb().
   */
  steps?: number[];
  /** player->upkeep->step_count: steps of `steps` left to take. */
  stepCount: number;
  /** player->upkeep->path_dest: the travel destination (kept across disturb). */
  pathDest?: Loc;
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
 * delete_monster_idx (mon-make.c): remove the monster from its groups
 * (leader succession / group split happen here), forget its racial
 * occurrence, clear its square and free its slot. The held-object drop,
 * mimic and targeting/redraw bookkeeping are DEFERRED with their subsystems
 * (floor objects, lore); the caller runs monster_death (drops) beforehand.
 */
export function deleteMonster(state: GameState, midx: number): void {
  const mon = state.monsters[midx];
  if (!mon) return;
  monsterRemoveFromGroups(state, mon);
  /* If the monster was the target, forget it (target_set_monster(NULL),
   * inlined to keep this module below game/target.ts): a fixed target
   * keeps its grid for the rest of the spell, otherwise fully reset. */
  const t = state.target;
  if (t.midx === midx) {
    t.midx = 0;
    if (!t.fixed) {
      t.set = false;
      t.grid = { x: 0, y: 0 };
    }
  }
  /* If the monster was tracked, forget it (health_track(NULL)). */
  if (state.healthWho === mon) state.healthWho = null;
  /* A commanded monster dying releases the player (mon-make.c L345). */
  if (mon.mTimed[MON_TMD.COMMAND]) {
    state.actor.player.timed[TMD.COMMAND] = 0;
  }
  /* Decrease the racial counter (clamped: test-harness monsters register
   * without counting, so a naked decrement could go negative). */
  const race = mon.originalRace ?? mon.race;
  if (race.curNum > 0) race.curNum--;
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

/**
 * The mon_take_hit arena branch (mon-util.c L1290) for the game-layer
 * kill sites: a lethal player blow in single combat signals the level
 * change (the arena exit finishes the monster) instead of killing.
 * Returns true when the death was intercepted (skip the kill).
 */
export function arenaInterceptDeath(state: GameState, mon: Monster): boolean {
  if (!state.arenaLevel) return false;
  state.generateLevel = true;
  state.healthWho = mon;
  return true;
}

/** Refresh mon->cdis for every live monster (update_mon does this upstream). */
export function updateMonsterDistances(state: GameState): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.cdis = distance(mon.grid, state.actor.grid);
  }
}
