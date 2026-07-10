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
import { DDGRID, locSum } from "../loc";
import { monsterIsObvious, monsterIsVisible } from "../mon/predicate";
import type { GameState, PlayerCommand, RunState } from "./context";
import { squareMonster } from "./context";
import { knownObject, squareIsKnown } from "./known";
import { squareIsVisibleTrap, squareIsWebbed } from "./trap";
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
 * disturb(): stop running and flush the queued continuations. The rest-cancel,
 * sound and redraw halves ride their subsystems (deferred).
 */
export function disturb(state: GameState): void {
  if (state.run) state.run.running = 0;
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

    /* Visible (remembered) objects abort running. The obj->known /
     * ignore_item_ok refinement rides knowledge and ignore (#24). */
    if (knownObject(state, grid) !== null) return true;

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

/**
 * run_step (running branch): begin a run (real direction) or continue one
 * (dir 0). The action moves the player one grid in the current run direction
 * via walkAction (the move / FOV / autopickup / trap consequences), decrements
 * the counter and re-queues itself while running remains. Returns the energy
 * spent (0 stops the run).
 */
export function runAction(state: GameState, cmd: PlayerCommand): number {
  const run = ensureRun(state);
  const dir = cmd.dir ?? 0;

  if (dir >= 1 && dir <= 9 && dir !== 5) {
    /* Start a new run. */
    runInit(state, dir);
    if (run.running === 0) run.running = 9999;
  } else if (runTest(state)) {
    /* Continue running: an interesting change stops us. */
    disturb(state);
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
  if (run.running > 0 && !state.isDead && !state.generateLevel) {
    queueCommand(state, { code: "run", dir: 0 });
  } else {
    run.running = 0;
  }

  return used;
}

/** Register the run action over its stub. */
export function installRunning(registry: ActionRegistry): void {
  registry.register("run", runAction);
}
