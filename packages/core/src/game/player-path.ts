/**
 * The running engine, ported from reference/src/player-path.c (Angband 4.2.6):
 * the Christopher J Stuart corridor/open-area running code - run_init,
 * run_test, run_step and see_wall.
 *
 * Once running begins you keep moving until something interesting happens. In
 * a hallway you follow corners; in the open you run straight but stop before
 * entering an enclosed space; alongside a wall you stop before it opens or
 * closes. Every decision is made from the player's memory of the cave (an
 * unknown wall reads like floor), matching upstream exactly.
 *
 * CONTINUATION SEAM: upstream re-queues CMD_RUN after every step via
 * cmdq_push. This port has no blocking input - process_player reads through
 * the injected provider - so run_step pushes the follow-up onto GameState's
 * internal cmdQueue (the cmdq twin), which processPlayer drains before asking
 * the provider. One keypress therefore drives a whole run, and runGameLoop
 * interleaves it with monster and world turns exactly as upstream does.
 *
 * DEFERRED (ledgered in game-player-path.yaml): pathfinding / travel
 * (find_path, prepare_pfdistances, path_nearest_known / _unknown - the A*
 * with door and rubble penalties) and the pathfinding branch of run_step
 * (upkeep->steps / step_count, the automatic open-door / tunnel-rubble
 * command pushes); disturb() from events OTHER than the per-step run_test
 * checks (a monster waking or approaching from behind, taking damage, a
 * message) rides the monster-AI / message layer - disturb() is exported so
 * those sites can call it; the OF_TRAP_IMMUNE half of player_is_trapsafe
 * (#13 equipment flags); the running torch-radius recalculation (PU_TORCH)
 * and the run-into-trap-disarms nuance ride the light / trap layers.
 */

import { TF, TMD } from "../generated";
import type { Loc } from "../loc";
import { DDD, DDGRID, DDGRID_DDD, loc, locEq, locSum } from "../loc";
import { SKILL } from "../player/types";
import { monsterIsObvious, monsterIsVisible } from "../mon/predicate";
import type { GameState, PlayerCommand, RunState } from "./context";
import { squareMonster } from "./context";
import { squareIsKnown } from "./known";
import { squareIsVisibleTrap, squareIsWebbed } from "./trap";
import { calcUnlockingChance } from "./trap";
import { DIGGING, calcDiggingChances } from "./cave-cmd";
import { walkAction } from "./player-turn";
import type { ActionRegistry } from "./player-turn";

/** Quick "cycling" through the eight legal directions (player-path.c cycle[]). */
const CYCLE: readonly number[] = [
  1, 2, 3, 6, 9, 8, 7, 4, 1, 2, 3, 6, 9, 8, 7, 4, 1,
];

/** Map each direction into the middle of cycle[] (player-path.c chome[]). */
const CHOME: readonly number[] = [0, 8, 9, 10, 7, 0, 11, 6, 5, 4];

/** player_is_trapsafe (the OF_TRAP_IMMUNE equipment half is #13, deferred). */
function playerIsTrapsafe(state: GameState): boolean {
  return (state.actor.player.timed[TMD.TRAPSAFE] ?? 0) > 0;
}

/** Ensure the run state exists (created lazily on the first run). */
function ensureRun(state: GameState): RunState {
  if (!state.run) {
    state.run = {
      curDir: 0,
      oldDir: 0,
      openArea: true,
      breakRight: false,
      breakLeft: false,
      running: 0,
      firstStep: false,
      stepCount: 0,
    };
  }
  return state.run;
}

/** Push a command onto the internal queue (cmdq_push). */
function queueCommand(state: GameState, cmd: PlayerCommand): void {
  if (!state.cmdQueue) state.cmdQueue = [];
  state.cmdQueue.push(cmd);
}

/**
 * disturb(): stop running / pathfinding, free the path steps and flush the
 * queued continuations. path_dest is deliberately kept so the pathfinding
 * auto-open / auto-tunnel branch can re-issue the travel. The rest-cancel,
 * sound and redraw halves ride their subsystems (deferred).
 */
export function disturb(state: GameState): void {
  if (state.run) {
    state.run.running = 0;
    delete state.run.steps;
    state.run.stepCount = 0;
  }
  if (state.cmdQueue) state.cmdQueue.length = 0;
}

/**
 * see_wall: a "known wall" in the given direction from grid. Webs count as
 * walls; unknown rock does not (running treats the unseen like open floor).
 */
function seeWall(state: GameState, dir: number, grid: Loc): boolean {
  const g = locSum(grid, DDGRID[dir] as Loc);
  /* Illegal grids are not known walls. */
  if (!state.chunk.inBounds(g)) return false;
  /* Webs are enough like walls. */
  if (squareIsWebbed(state, g)) return true;
  /* Non-wall grids are not known walls (square_seemslikewall = TF_ROCK). */
  if (!state.chunk.feature(g).flags.has(TF.ROCK)) return false;
  /* Unknown walls are not known walls. */
  if (!squareIsKnown(state, g)) return false;
  return true;
}

/**
 * run_init: initialize the running algorithm for a new direction, examining
 * the two grids on each side of the destination to decide whether we are in a
 * hallway (both sides closed), the open, or alongside a single wall, and to
 * pick the diagonal / blunt-corridor entry direction.
 */
function runInit(state: GameState, dir: number): void {
  const run = ensureRun(state);
  const here = state.actor.grid;

  run.firstStep = true;
  run.curDir = dir;
  run.oldDir = dir;
  run.openArea = true;
  run.breakRight = false;
  run.breakLeft = false;

  let deepLeft = false;
  let deepRight = false;
  let shortLeft = false;
  let shortRight = false;

  const grid = locSum(here, DDGRID[dir] as Loc);
  const i = CHOME[dir] as number;

  /* Check for a nearby or distant wall on the left. */
  if (seeWall(state, CYCLE[i + 1] as number, here)) {
    run.breakLeft = true;
    shortLeft = true;
  } else if (seeWall(state, CYCLE[i + 1] as number, grid)) {
    run.breakLeft = true;
    deepLeft = true;
  }

  /* Check for a nearby or distant wall on the right. */
  if (seeWall(state, CYCLE[i - 1] as number, here)) {
    run.breakRight = true;
    shortRight = true;
  } else if (seeWall(state, CYCLE[i - 1] as number, grid)) {
    run.breakRight = true;
    deepRight = true;
  }

  /* Looking for a break: a hallway. */
  if (run.breakLeft && run.breakRight) {
    run.openArea = false;

    /* Angled or blunt corridor entry. */
    if (dir & 0x01) {
      if (deepLeft && !deepRight) run.oldDir = CYCLE[i - 1] as number;
      else if (deepRight && !deepLeft) run.oldDir = CYCLE[i + 1] as number;
    } else if (seeWall(state, CYCLE[i] as number, here)) {
      if (shortLeft && !shortRight) run.oldDir = CYCLE[i - 2] as number;
      else if (shortRight && !shortLeft) run.oldDir = CYCLE[i + 2] as number;
    }
  }
}

/** square_ispassable, but false (rather than asserting) out of bounds. */
function passable(state: GameState, grid: Loc): boolean {
  return state.chunk.inBounds(grid) && state.chunk.isPassable(grid);
}

/**
 * A visible floor object here that running should stop for: any object in the
 * pile that is not ignored (obj->known && !ignore_item_ok). Everything is
 * known in the port, so the live pile is the player's knowledge.
 */
function hasBlockingObject(state: GameState, grid: Loc): boolean {
  const pile = state.floor.get(grid.y * state.chunk.width + grid.x);
  if (!pile) return false;
  for (const obj of pile) {
    if (!state.isIgnored || !state.isIgnored(obj)) return true;
  }
  return false;
}

/**
 * run_test: examine the surroundings after a step to decide whether running
 * should stop, and to steer the current direction when following a corridor.
 * Returns true if the running should be stopped.
 */
function runTest(state: GameState): boolean {
  const run = state.run as RunState;
  const here = state.actor.grid;
  const prevDir = run.oldDir;

  let option = 0;
  let option2 = 0;

  /* Range of newly adjacent grids - 5 for diagonals, 3 for cardinals. */
  const max = (prevDir & 0x01) + 1;

  /* Look at every newly adjacent square. */
  for (let i = -max; i <= max; i++) {
    const newDir = CYCLE[(CHOME[prevDir] as number) + i] as number;
    const grid = locSum(here, DDGRID[newDir] as Loc);

    /* Visible monsters abort running. */
    const mon = squareMonster(state, grid);
    if (mon && monsterIsVisible(mon)) return true;

    /* Visible traps abort running (unless trapsafe). */
    if (squareIsVisibleTrap(state, grid) && !playerIsTrapsafe(state)) {
      return true;
    }

    /* Visible, non-ignored floor objects abort running. */
    if (hasBlockingObject(state, grid)) return true;

    /* Assume unknown. */
    let inv = true;

    /* Check memorized grids. */
    if (squareIsKnown(state, grid)) {
      /* Interesting feature. */
      if (state.chunk.feature(grid).flags.has(TF.INTERESTING)) return true;
      /* The grid is "visible". */
      inv = false;
    }

    /* Analyze unknown grids and floors. */
    if (inv || passable(state, grid)) {
      if (run.openArea) {
        /* Nothing. */
      } else if (!option) {
        /* The first new direction. */
        option = newDir;
      } else if (option2) {
        /* Three new directions. Stop running. */
        return true;
      } else if (option !== CYCLE[(CHOME[prevDir] as number) + i - 1]) {
        /* Two non-adjacent new directions. Stop running. */
        return true;
      } else if (newDir & 0x01) {
        /* Two new (adjacent) directions (case 1). */
        option2 = newDir;
      } else {
        /* Two new (adjacent) directions (case 2). */
        option2 = option;
        option = newDir;
      }
    } else if (run.openArea) {
      /* Obstacle, while looking for open area. */
      if (i < 0) run.breakRight = true;
      else if (i > 0) run.breakLeft = true;
    }
  }

  /* Look at every soon-to-be newly adjacent square. */
  for (let i = -max; i <= max; i++) {
    const newDir = CYCLE[(CHOME[prevDir] as number) + i] as number;
    const grid = locSum(
      here,
      locSum(DDGRID[prevDir] as Loc, DDGRID[newDir] as Loc),
    );
    /* Sometimes we come up with illegal bounds. */
    if (!state.chunk.inBounds(grid)) continue;

    /* Obvious monsters abort running. */
    const mon = squareMonster(state, grid);
    if (mon && monsterIsObvious(mon)) return true;
  }

  if (run.openArea) {
    /* Looking for open area: look again. */
    for (let i = -max; i < 0; i++) {
      const newDir = CYCLE[(CHOME[prevDir] as number) + i] as number;
      const grid = locSum(here, DDGRID[newDir] as Loc);

      if (!squareIsKnown(state, grid) || passable(state, grid)) {
        /* Unknown grid or non-wall: looking to break right. */
        if (run.breakRight) return true;
      } else if (run.breakLeft) {
        /* Obstacle: looking to break left. */
        return true;
      }
    }

    for (let i = max; i > 0; i--) {
      const newDir = CYCLE[(CHOME[prevDir] as number) + i] as number;
      const grid = locSum(here, DDGRID[newDir] as Loc);

      if (!squareIsKnown(state, grid) || passable(state, grid)) {
        /* Unknown grid or non-wall: looking to break left. */
        if (run.breakLeft) return true;
      } else if (run.breakRight) {
        /* Obstacle: looking to break right. */
        return true;
      }
    }
  } else if (!option) {
    /* Not looking for open area: no options. */
    return true;
  } else if (!option2) {
    /* One option. */
    run.curDir = option;
    run.oldDir = option;
  } else {
    /* Two options, examining corners: allow curving. */
    run.curDir = option;
    run.oldDir = option2;
  }

  /* About to hit a known wall: stop. */
  if (seeWall(state, run.curDir, here)) return true;

  return false;
}

/* ================================================================== *
 * Pathfinding (player-path.c L36-L1377).
 * ================================================================== */

/** Scale factor for distances (fractional turns); PF_SCL in player-path.c. */
const PF_SCL = 16;

/** A large sentinel standing in for INT_MAX in the distance array. */
const PF_INF = 0x3fffffff;

/**
 * is_valid_pf: is a grid OK for the pathfinder to consider? Uses the player's
 * memory: unremembered grids are acceptable unless only_known; damaging
 * terrain and (when forbidding) visible traps are rejected; passable terrain
 * and traversable-with-effort closed doors / rubble are accepted.
 */
function isValidPf(
  state: GameState,
  grid: Loc,
  onlyKnown: boolean,
  forbidTraps: boolean,
): boolean {
  if (!squareIsKnown(state, grid)) return !onlyKnown;
  /* square_isdamaging reduced to fiery terrain (lava); the fuller set
   * rides later batches. */
  if (state.chunk.isFiery(grid)) return false;
  if (
    forbidTraps &&
    squareIsVisibleTrap(state, grid) &&
    !playerIsTrapsafe(state)
  ) {
    return false;
  }
  if (state.chunk.isPassable(grid)) return true;
  if (state.chunk.isClosedDoor(grid) || state.chunk.isRubble(grid)) return true;
  return false;
}

/** compute_locked_penalty: expected movement turns to open a locked door. */
function lockedPenalty(state: GameState): number {
  /* Treat the lock power as the maximum in use (7), as upstream does. */
  const chance = calcUnlockingChance(state, 7);
  if (chance <= 0) return PF_INF;
  if (chance >= 100) return PF_SCL;
  return Math.round((PF_SCL * 100) / chance);
}

/** compute_rubble_penalty: expected movement turns to dig through rubble. */
function rubblePenalty(state: GameState): number {
  /* The swap-to-best-digger recalculation is deferred (as in tunnelAux); the
   * wielded DIGGING skill decides. */
  const chances = calcDiggingChances(
    state.actor.combat.skills[SKILL.DIGGING] ?? 0,
  );
  const r = chances[DIGGING.RUBBLE] as number;
  if (r <= 0) return PF_INF;
  if (r >= 1600) return PF_SCL;
  return Math.round((PF_SCL * 1600) / r);
}

/** A computed distance field over the level (movement turns * PF_SCL). */
interface PfDistances {
  rows: Int32Array;
  width: number;
  height: number;
  start: Loc;
}

/**
 * prepare_pfdistances: the distances, in movement turns * PF_SCL, from `start`
 * to every grid, using the player's memory. The outer edge is marked
 * unreachable; some hard-to-traverse known terrain is penalized.
 */
function preparePfdistances(
  state: GameState,
  start: Loc,
  onlyKnown: boolean,
  forbidTraps: boolean,
): PfDistances {
  const w = state.chunk.width;
  const h = state.chunk.height;
  const rows = new Int32Array(w * h);

  /* Border unreachable; interior valid grids start at "infinity". */
  for (let x = 0; x < w; x++) rows[x] = -1;
  for (let y = 1; y < h - 1; y++) {
    rows[y * w] = -1;
    for (let x = 1; x < w - 1; x++) {
      rows[y * w + x] = isValidPf(state, loc(x, y), onlyKnown, forbidTraps)
        ? PF_INF
        : -1;
    }
    rows[y * w + w - 1] = -1;
  }
  for (let x = 0; x < w; x++) rows[(h - 1) * w + x] = -1;

  rows[start.y * w + start.x] = 0;

  const unlocked = PF_SCL;
  const locked = lockedPenalty(state);
  const rubble = rubblePenalty(state);

  const pending: number[] = [start.y * w + start.x];
  while (pending.length > 0) {
    const i = pending.shift() as number;
    const gy = Math.trunc(i / w);
    const gx = i - gy * w;
    let cur = rows[i] as number;
    if (cur >= PF_INF - PF_SCL) continue;
    cur += PF_SCL;

    for (let d = 0; d < 8; d++) {
      const off = DDGRID_DDD[d] as Loc;
      const nx = gx + off.x;
      const ny = gy + off.y;
      const ni = ny * w + nx;
      if ((rows[ni] as number) <= cur) continue;
      const ngrid = loc(nx, ny);

      if (!squareIsKnown(state, ngrid) || state.chunk.isPassable(ngrid)) {
        rows[ni] = cur;
      } else {
        let penalty: number;
        if (state.chunk.isClosedDoor(ngrid)) {
          penalty = env_isLockedDoor(state, ngrid) ? locked : unlocked;
        } else if (state.chunk.isRubble(ngrid)) {
          penalty = rubble;
        } else {
          continue;
        }
        if (cur >= PF_INF - penalty) continue;
        const penalized = cur + penalty;
        if ((rows[ni] as number) <= penalized) continue;
        rows[ni] = penalized;
      }
      pending.push(ni);
    }
  }

  return { rows, width: w, height: h, start };
}

/**
 * A locked-door test for the pathfinder's penalty choice. Door locks are traps
 * (#21); without the trap deps wired here we treat every closed door as
 * unlocked (the common case), which only under-penalizes locked doors.
 */
function env_isLockedDoor(state: GameState, grid: Loc): boolean {
  return state.chunk.feature(grid).flags.has(TF.DOOR_LOCKED);
}

/** pfdistances_to_turncount: expected movement turns to a grid, or -1. */
function pfTurncount(a: PfDistances, grid: Loc): number {
  if (
    grid.y < 0 ||
    grid.y >= a.height ||
    grid.x < 0 ||
    grid.x >= a.width
  ) {
    return -1;
  }
  const d = a.rows[grid.y * a.width + grid.x] as number;
  if (d < 0 || d >= PF_INF) return -1;
  return Math.trunc(d / PF_SCL) + (d % PF_SCL >= (PF_SCL + 1) >> 1 ? 1 : 0);
}

/**
 * pfdistances_to_path: the path to a destination as forward keypad directions
 * in reverse order (index length-1 is the first step). Returns [] with a
 * length of -1 when unreachable, 0 when already at the destination.
 */
function pfToPath(a: PfDistances, dest: Loc): { length: number; steps: number[] } {
  if (
    dest.y < 0 ||
    dest.y >= a.height ||
    dest.x < 0 ||
    dest.x >= a.width ||
    (a.rows[dest.y * a.width + dest.x] as number) < 0
  ) {
    return { length: -1, steps: [] };
  }
  if (locEq(dest, a.start)) return { length: 0, steps: [] };

  const steps: number[] = [];
  let grid = dest;
  while (!locEq(grid, a.start)) {
    let bestK = -1;
    let bestDistance = a.rows[grid.y * a.width + grid.x] as number;
    for (let k = 0; k < 8; k++) {
      const off = DDGRID_DDD[k] as Loc;
      const next = loc(grid.x + off.x, grid.y + off.y);
      if (next.y < 0 || next.y >= a.height || next.x < 0 || next.x >= a.width) {
        continue;
      }
      const tryD = a.rows[next.y * a.width + next.x] as number;
      if (tryD >= 0 && bestDistance > tryD) {
        bestDistance = tryD;
        bestK = k;
      }
    }
    if (bestK < 0) return { length: -1, steps: [] };
    /* Record the opposite of the backward direction. */
    steps.push(10 - (DDD[bestK] as number));
    const off = DDGRID_DDD[bestK] as Loc;
    grid = loc(grid.x + off.x, grid.y + off.y);
  }
  return { length: steps.length, steps };
}

/**
 * find_path: the path from start to dest using the player's memory. Ported via
 * prepare_pfdistances + pfdistances_to_path (the same distances upstream's A*
 * approximates, so the paths match up to tie-breaking) with the same
 * constraint-loosening: try remembered-only then any, and no-traps then traps.
 */
export function findPath(
  state: GameState,
  start: Loc,
  dest: Loc,
): { length: number; steps: number[] } {
  if (!state.chunk.inBounds(start) || !state.chunk.inBounds(dest)) {
    return { length: -1, steps: [] };
  }
  if (locEq(start, dest)) return { length: 0, steps: [] };

  let onlyKnown = squareIsKnown(state, start) && squareIsKnown(state, dest);
  let forbidTraps: boolean;
  if (isValidPf(state, dest, onlyKnown, true)) forbidTraps = true;
  else if (isValidPf(state, dest, onlyKnown, false)) forbidTraps = false;
  else return { length: -1, steps: [] };

  for (;;) {
    const dist = preparePfdistances(state, start, onlyKnown, forbidTraps);
    const path = pfToPath(dist, dest);
    if (path.length >= 0) return path;

    if (forbidTraps && !playerIsTrapsafe(state)) {
      forbidTraps = false;
      continue;
    }
    if (onlyKnown) {
      onlyKnown = false;
      forbidTraps = isValidPf(state, dest, false, true);
      continue;
    }
    return { length: -1, steps: [] };
  }
}

/**
 * path_nearest_known: the path to the nearest remembered grid (other than the
 * start) satisfying `pred`, with the same constraint-loosening as find_path.
 * Returns the path and the chosen destination.
 */
export function pathNearestKnown(
  state: GameState,
  start: Loc,
  pred: (state: GameState, grid: Loc) => boolean,
): { length: number; steps: number[]; dest: Loc } {
  let onlyKnown = true;
  let forbidTraps = true;
  for (;;) {
    const dist = preparePfdistances(state, start, onlyKnown, forbidTraps);
    let minGrid = loc(-1, -1);
    let minTurns = PF_INF;
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x < state.chunk.width; x++) {
        const grid = loc(x, y);
        if (locEq(grid, start)) continue;
        if (squareIsKnown(state, grid) && pred(state, grid)) {
          const turns = pfTurncount(dist, grid);
          if (turns > 0 && minTurns > turns) {
            minTurns = turns;
            minGrid = grid;
          }
        }
      }
    }
    if (minTurns < PF_INF) {
      return { ...pfToPath(dist, minGrid), dest: minGrid };
    }
    if (forbidTraps && !playerIsTrapsafe(state)) {
      forbidTraps = false;
      continue;
    }
    if (onlyKnown) {
      onlyKnown = false;
      forbidTraps = true;
      continue;
    }
    return { length: -1, steps: [], dest: loc(-1, -1) };
  }
}

/** count_neighbors(square_isknown, under=true): all 9 grids remembered? */
function allNeighborsKnown(state: GameState, grid: Loc): boolean {
  for (let d = 0; d < 9; d++) {
    const off = DDGRID_DDD[d] as Loc;
    const g = loc(grid.x + off.x, grid.y + off.y);
    if (!state.chunk.inBounds(g) || !squareIsKnown(state, g)) return false;
  }
  return true;
}

/** count_neighbors over an arbitrary predicate (under=false: the 8 around). */
function countNeighbors(
  state: GameState,
  grid: Loc,
  pred: (state: GameState, grid: Loc) => boolean,
): { count: number; last: Loc } {
  let count = 0;
  let last = loc(-1, -1);
  for (let d = 0; d < 8; d++) {
    const off = DDGRID_DDD[d] as Loc;
    const g = loc(grid.x + off.x, grid.y + off.y);
    if (!state.chunk.inBounds(g)) continue;
    if (pred(state, g)) {
      count++;
      last = g;
    }
  }
  return { count, last };
}

/** square_isknownpassable: remembered and passable. */
function squareIsKnownPassable(state: GameState, grid: Loc): boolean {
  return squareIsKnown(state, grid) && state.chunk.isPassable(grid);
}

/**
 * path_nearest_unknown: the path to the nearest remembered passable grid with
 * an unknown neighbor, or (failing that) the nearest remembered closed door /
 * rubble with an unknown neighbor and a known-passable neighbor to stand on.
 * This is the explore command's target.
 */
export function pathNearestUnknown(
  state: GameState,
  start: Loc,
): { length: number; steps: number[]; dest: Loc } {
  let onlyKnown = true;
  let forbidTraps = true;
  let passableMode = true;
  for (;;) {
    const dist = preparePfdistances(state, start, onlyKnown, forbidTraps);
    let minGrid = loc(-1, -1);
    let minTurns = PF_INF;
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x < state.chunk.width; x++) {
        const grid = loc(x, y);
        if (locEq(grid, start) || !squareIsKnown(state, grid)) continue;
        let testGrid: Loc;
        if (passableMode) {
          if (
            !state.chunk.isPassable(grid) ||
            countNeighbors(state, grid, squareIsKnown).count === 8
          ) {
            continue;
          }
          testGrid = grid;
        } else {
          if (
            (!state.chunk.isClosedDoor(grid) && !state.chunk.isRubble(grid)) ||
            countNeighbors(state, grid, squareIsKnown).count === 8
          ) {
            continue;
          }
          const near = countNeighbors(state, grid, squareIsKnownPassable);
          if (near.count === 0 || locEq(near.last, start)) continue;
          testGrid = near.last;
        }
        const turns = pfTurncount(dist, testGrid);
        if (turns > 0 && minTurns > turns) {
          minTurns = turns;
          minGrid = testGrid;
        }
      }
    }
    if (minTurns < PF_INF) {
      return { ...pfToPath(dist, minGrid), dest: minGrid };
    }
    if (forbidTraps && !playerIsTrapsafe(state)) {
      forbidTraps = false;
      continue;
    }
    if (onlyKnown) {
      onlyKnown = false;
      forbidTraps = true;
      continue;
    }
    if (passableMode) {
      passableMode = false;
      onlyKnown = true;
      forbidTraps = true;
      continue;
    }
    return { length: -1, steps: [], dest: loc(-1, -1) };
  }
}

/**
 * pathfind_direction_to: the keypad direction from one point to another,
 * preferring diagonals when dx and dy are within a factor of two.
 */
export function pathfindDirectionTo(from: Loc, to: Loc): number {
  const adx = Math.abs(to.x - from.x);
  const ady = Math.abs(to.y - from.y);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 5; /* DIR_NONE */
  const diag = adx < ady * 2 && ady < adx * 2;
  if (dx >= 0 && dy >= 0) return diag ? 3 : adx > ady ? 6 : 2;
  if (dx > 0 && dy < 0) return diag ? 9 : adx > ady ? 6 : 8;
  if (dx < 0 && dy > 0) return diag ? 1 : adx > ady ? 4 : 2;
  return diag ? 7 : adx > ady ? 4 : 8;
}

/* ================================================================== *
 * run_step: the shared move engine for running and pathfinding.
 * ================================================================== */

/**
 * The pathfinding branch of run_step: decide the next step from the stored
 * path, auto-opening a fully-surrounded closed door or digging fully-known
 * rubble (by re-issuing the command then re-pathfinding), stopping on a block,
 * a visible monster or object, or converting to a plain run if the path would
 * end in a wall. Returns false to stop (already disturbed), true to take the
 * chosen step.
 */
function pathfindStep(state: GameState, run: RunState): boolean {
  const nextInd = run.stepCount - 1;
  const nextDir = (run.steps as number[])[nextInd] as number;
  const here = state.actor.grid;
  const grid = locSum(here, DDGRID[nextDir] as Loc);

  /* Auto-open a closed door whose surroundings are fully known. */
  if (state.chunk.isClosedDoor(grid)) {
    if (allNeighborsKnown(state, grid)) {
      const dest = run.pathDest;
      disturb(state);
      queueCommand(state, { code: "open", dir: nextDir });
      if (dest) queueCommand(state, { code: "pathfind", args: { dest } });
      return false;
    }
  } else if (state.chunk.isRubble(grid) && !state.chunk.isPassable(grid)) {
    if (allNeighborsKnown(state, grid)) {
      const dest = run.pathDest;
      disturb(state);
      queueCommand(state, { code: "tunnel", dir: nextDir });
      if (dest) queueCommand(state, { code: "pathfind", args: { dest } });
      return false;
    }
  }

  /* Known impassable terrain that is not automatically handled: stop. */
  if (squareIsKnown(state, grid) && !state.chunk.isPassable(grid)) {
    disturb(state);
    return false;
  }

  /* Visible monsters or remembered objects abort. */
  const mon = squareMonster(state, grid);
  if (mon && monsterIsVisible(mon)) {
    disturb(state);
    return false;
  }
  if (hasBlockingObject(state, grid)) {
    disturb(state);
    return false;
  }

  /* If the path would end up in a wall, convert to a normal run so a click on
   * an unknown area still explores. Look ahead two to init the run properly. */
  if (nextInd > 0) {
    const after = locSum(grid, DDGRID[(run.steps as number[])[nextInd - 1] as number] as Loc);
    if (
      squareIsKnown(state, after) &&
      !state.chunk.isPassable(after) &&
      ((!state.chunk.isClosedDoor(after) && !state.chunk.isRubble(after)) ||
        !allNeighborsKnown(state, after))
    ) {
      delete run.steps;
      runInit(state, nextDir);
    }
  }

  if (run.steps) {
    run.curDir = nextDir;
    run.stepCount = nextInd;
  }
  return true;
}

/**
 * run_step: begin a run (real direction), or continue a run / pathfind (dir
 * 0). Moves one grid in the current direction via walkAction (move / FOV /
 * autopickup / trap consequences), decrements the counter and re-queues itself
 * while steps remain. Returns the energy spent (0 stops).
 */
export function runStep(state: GameState, dir: number): number {
  const run = ensureRun(state);

  if (dir >= 1 && dir <= 9 && dir !== 5) {
    /* Start a new plain run. */
    runInit(state, dir);
    if (run.running === 0) run.running = 9999;
  } else if (!run.steps) {
    /* Continue a plain run: an interesting change stops us. */
    if (runTest(state)) {
      disturb(state);
      return 0;
    }
  } else if (run.stepCount <= 0) {
    /* Pathfinding finished. */
    disturb(state);
    return 0;
  } else if (!pathfindStep(state, run)) {
    /* Pathfinding branch chose to stop (already disturbed / re-queued). */
    return 0;
  }

  /* Take one step in the current direction. Running while confused is not
   * allowed, so a zero-energy result is an unseen wall - stop. */
  const used = walkAction(state, { code: "walk", dir: run.curDir });
  if (used === 0) {
    disturb(state);
    return 0;
  }
  run.firstStep = false;

  /* Decrease the counter (after the move, so running works as a flag), then
   * queue the next step while we are still running. */
  if (run.running > 0) run.running--;
  else if (!run.steps) return used;

  if (run.running > 0 && !state.isDead && !state.generateLevel) {
    queueCommand(state, { code: "run", dir: 0 });
  } else if (run.steps) {
    delete run.steps;
    run.stepCount = 0;
  }

  return used;
}

/** The run command: start (a real direction) or continue (dir 0) a run. */
export function runAction(state: GameState, cmd: PlayerCommand): number {
  return runStep(state, cmd.dir ?? 0);
}

/** Begin travelling along a freshly computed path (do_cmd_* setup + run_step). */
function beginPath(
  state: GameState,
  path: { length: number; steps: number[] },
  dest: Loc,
): number {
  const run = ensureRun(state);
  if (path.length > 0) {
    run.steps = path.steps;
    run.stepCount = path.length;
    run.pathDest = dest;
    run.firstStep = true;
    run.running = path.length;
    return runStep(state, 0);
  }
  return 0;
}

/**
 * do_cmd_pathfind: travel to cmd.args.dest (a Loc). Computes the path and
 * walks it, self-continuing through the command queue.
 */
export function pathfindAction(state: GameState, cmd: PlayerCommand): number {
  const dest = cmd.args?.dest as Loc | undefined;
  if (!dest || !state.chunk.inBounds(dest)) return 0;
  return beginPath(state, findPath(state, state.actor.grid, dest), dest);
}

/** do_cmd_explore: travel toward the nearest unexplored area. */
export function exploreAction(state: GameState, _cmd: PlayerCommand): number {
  const found = pathNearestUnknown(state, state.actor.grid);
  return beginPath(state, found, found.dest);
}

/** Register the run / pathfind / explore actions over their stubs. */
export function installRunning(registry: ActionRegistry): void {
  registry.register("run", runAction);
  registry.register("pathfind", pathfindAction);
  registry.register("explore", exploreAction);
}
