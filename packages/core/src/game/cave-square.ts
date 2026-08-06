/**
 * The `cave-square.c` grid MUTATORS that more than one caller needs, ported
 * from Angband 4.2.6.
 *
 * Most of cave-square.c is predicates, and those live on the chunk itself
 * (world/chunk.ts) or beside the concern that reads them. These five are
 * different: they CHANGE a grid, upstream calls each from two places, and the
 * port had grown two copies of four of them - a correct set inside
 * monster-turn.ts, private to that file, and a degraded set open-coded in
 * mon-cmd.ts's commanded walk. That second set turned SMASH_WALL into
 * KILL_WALL and left the "door lock" trap sitting on a door it had just burst
 * open (PORT_TODO 2.19). A shared module is the fix that cannot drift back:
 * there is now one body per C function, and the file it came from has a name.
 *
 * They take `GameState` rather than a chunk because two of them reach the trap
 * system through the state's door-lock seams.
 */

import { FEAT, TF } from "../generated/index.js";
import { DDGRID_DDD, locSum } from "../loc.js";
import type { Loc } from "../loc.js";
import type { GameState } from "./context.js";

/** square_issecretdoor: a door still disguised as rock (cave-square.c L304). */
export function squareIsSecretDoor(state: GameState, grid: Loc): boolean {
  const f = state.chunk.feature(grid).flags;
  return f.has(TF.DOOR_ANY) && f.has(TF.ROCK);
}

/** square_destroy_wall (cave-square.c L1419): turn a wall to floor. */
export function squareDestroyWall(state: GameState, grid: Loc): void {
  state.chunk.setFeat(grid, FEAT.FLOOR);
}

/**
 * square_open_door (cave-square.c L1351): remove the lock, open the door.
 *
 * The lock removal is not decoration. A door's lock is a "door lock" TRAP on
 * the grid (#21), so a door opened without it keeps a lock on a grid that is
 * no longer a door - and square_door_power would still report it.
 */
export function squareOpenDoor(state: GameState, grid: Loc): void {
  state.removeDoorLock?.(grid);
  state.chunk.setFeat(grid, FEAT.OPEN);
}

/** square_smash_door (cave-square.c L1367): remove the lock, break the door. */
export function squareSmashDoor(state: GameState, grid: Loc): void {
  state.removeDoorLock?.(grid);
  state.chunk.setFeat(grid, FEAT.BROKEN);
}

/**
 * square_smash_wall (cave-square.c L1424): reduce the wall and much of what is
 * next to it to floor. Each adjacent granite / quartz / magma grid gets a
 * survival roll (one_in_ 4 / 10 / 20) - the RNG draws happen in ddgrid_ddd
 * order, exactly once per mineral neighbour. (Decoy destruction on adjacent
 * floors is DEFERRED and draws no RNG.)
 */
export function squareSmashWall(state: GameState, grid: Loc): void {
  const c = state.chunk;
  c.setFeat(grid, FEAT.FLOOR);

  for (let i = 0; i < 8; i++) {
    const adj = locSum(grid, DDGRID_DDD[i] as Loc);
    if (!c.inBoundsFully(adj)) continue;
    if (c.isPerm(adj)) continue;
    /* Ignore floors (adjacent-decoy destruction DEFERRED). */
    if (c.isFloor(adj)) continue;
    /* Give this grid a chance to survive. */
    if (
      (c.isGranite(adj) && state.rng.oneIn(4)) ||
      (c.isQuartz(adj) && state.rng.oneIn(10)) ||
      (c.isMagma(adj) && state.rng.oneIn(20))
    ) {
      continue;
    }
    c.setFeat(adj, FEAT.FLOOR);
  }
}
