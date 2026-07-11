/**
 * Floor object piles, ported from reference/src/obj-pile.c (Angband 4.2.6):
 * the live-cave half that lets squares carry objects - floor_carry,
 * drop_near (with drop_find_grid's scored placement scan and the artifact
 * rescue walk), floor_object_for_use, and the pile primitives. Piles live on
 * the GameState (state.floor, keyed by grid index) with the newest object at
 * the head, exactly as upstream's square->obj linked list (pile_insert
 * prepends).
 *
 * Unported-subsystem seams are grouped on FloorEnv with inert defaults:
 * - isIgnored (ignore_item_ok, obj-ignore.c, task #24): nothing is ignored,
 *   so the oldest-ignored eviction never fires and *note stays truthful.
 * - isTrap (square_istrap, task #21): no traps, so drops may land anywhere
 *   a floor grid allows.
 * - birthStacking (OPT birth_stacking): defaults true as shipped.
 * - onBreak / onDrop / onNote: message and redraw hooks (UI layer).
 *
 * DEFERRED with their subsystems (ledgered in parity/ledger/game-floor.yaml):
 * push_object (needs doors/traps interplay), the known-object shadow cave
 * (player->cave, knowledge #24), list_object/delist_object oidx bookkeeping
 * (the pile map is the object list), and mimicked-object handling.
 */

import type { Loc } from "../loc";
import { loc, locSum, randLoc } from "../loc";
import { ORIGIN } from "../generated";
import type { GameObject, StackLimits } from "../obj/object";
import { OSTACK_FLOOR, objectAbsorb, objectMergeable } from "../obj/object";
import { los } from "../world/view";
import type { GameState } from "./context";
import { objectSplit } from "./gear";

/** Unported-subsystem hooks for the floor routines; every slot is optional. */
export interface FloorEnv {
  /** ignore_item_ok (obj-ignore.c, #24). Default: nothing is ignored. */
  isIgnored?: (obj: GameObject) => boolean;
  /** square_istrap (trap.c, #21). Default: no traps. */
  isTrap?: (grid: Loc) => boolean;
  /** OPT(player, birth_stacking). Default true (shipped default). */
  birthStacking?: boolean;
  /** The dropped object broke / disappeared (message hook). */
  onBreak?: (obj: GameObject, broke: boolean) => void;
  /** An object landed on the floor (message / redraw hook). */
  onDrop?: (obj: GameObject, grid: Loc) => void;
  /** Quiver stacking limits; floor stacks never read them (shipped values). */
  limits?: StackLimits;
}

/** The shipped constants.txt quiver limits (unused by OSTACK_FLOOR checks). */
const DEFAULT_LIMITS: StackLimits = { quiverSlotSize: 40, thrownQuiverMult: 5 };

/** The state.floor key for a grid. */
function gridIdx(state: GameState, grid: Loc): number {
  return grid.y * state.chunk.width + grid.x;
}

/** square_object(c, grid): the pile at a grid, head (newest) first. */
export function floorPile(
  state: GameState,
  grid: Loc,
): readonly GameObject[] {
  return state.floor.get(gridIdx(state, grid)) ?? [];
}

/** pile_insert: prepend an object to the pile at a grid. */
function pileInsert(state: GameState, grid: Loc, obj: GameObject): void {
  const key = gridIdx(state, grid);
  const pile = state.floor.get(key);
  if (pile) pile.unshift(obj);
  else state.floor.set(key, [obj]);
}

/**
 * square_excise_object / pile_excise: remove an object from the pile at a
 * grid. Returns whether it was found.
 */
export function floorExcise(
  state: GameState,
  grid: Loc,
  obj: GameObject,
): boolean {
  const key = gridIdx(state, grid);
  const pile = state.floor.get(key);
  if (!pile) return false;
  const at = pile.indexOf(obj);
  if (at < 0) return false;
  pile.splice(at, 1);
  if (pile.length === 0) state.floor.delete(key);
  return true;
}

/** floor_get_oldest_ignored: the last (oldest) ignored object at a grid. */
function floorGetOldestIgnored(
  state: GameState,
  grid: Loc,
  env: FloorEnv,
): GameObject | null {
  if (!env.isIgnored) return null;
  const pile = floorPile(state, grid);
  let ignore: GameObject | null = null;
  for (const obj of pile) {
    if (env.isIgnored(obj)) ignore = obj;
  }
  return ignore;
}

/**
 * floor_carry: let the floor at a grid carry an object - merge into a
 * compatible stack, or add to the pile if it has room (evicting the oldest
 * ignored object when full). Returns false when the square can't take it;
 * the caller deals with the object.
 */
export function floorCarry(
  state: GameState,
  grid: Loc,
  drop: GameObject,
  env: FloorEnv = {},
): boolean {
  const ignore = floorGetOldestIgnored(state, grid, env);

  /* Fail if the square can't hold objects. */
  if (!state.chunk.isObjectHolding(grid)) return false;

  /* Scan objects in that grid for combination. */
  const pile = floorPile(state, grid);
  const limits = env.limits ?? DEFAULT_LIMITS;
  let n = 0;
  for (const obj of pile) {
    if (objectMergeable(obj, drop, OSTACK_FLOOR, limits)) {
      objectAbsorb(obj, drop, ORIGIN.MIXED);
      return true;
    }
    n++;
  }

  /* The stack is already too large. */
  if (n >= state.z.floorSize || (!((env.birthStacking ?? state.options?.get("birth_stacking") ?? true)) && n)) {
    /* Delete the oldest ignored object. */
    if (ignore) floorExcise(state, grid, ignore);
    else return false;
  }

  /* Location; forget monster. */
  drop.grid = grid;
  drop.heldMIdx = 0;

  /* Link to the first object in the pile. */
  pileInsert(state, grid, drop);
  return true;
}

/**
 * drop_find_grid: find a grid near the given one for an object to fall on -
 * the scored 7x7 scan (close and uncluttered wins, ties break one_in_2),
 * then the artifact rescue walk when nothing scores. Returns the grid to
 * drop at (the input grid when no better one is found).
 */
export function dropFindGrid(
  state: GameState,
  drop: GameObject,
  preferPile: boolean,
  start: Loc,
  env: FloorEnv = {},
): Loc {
  const c = state.chunk;
  let bestScore = -1;
  let best = start;

  /* Scan local grids. */
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const dist = dy * dy + dx * dx;
      const tryGrid = locSum(start, loc(dx, dy));

      /* Lots of reasons to say no. */
      if (
        dist > 10 ||
        !c.inBoundsFully(tryGrid) ||
        !los(c, start, tryGrid) ||
        !c.isFloor(tryGrid) ||
        (env.isTrap ? env.isTrap(tryGrid) : false)
      ) {
        continue;
      }

      /* Analyse the grid for carrying the new object. */
      let combine = false;
      let numShown = 0;
      let numIgnored = 0;
      for (const obj of floorPile(state, tryGrid)) {
        if (objectMergeable(obj, drop, OSTACK_FLOOR, env.limits ?? DEFAULT_LIMITS)) {
          combine = true;
        }
        if (env.isIgnored?.(obj)) numIgnored++;
        else numShown++;
      }
      if (!combine) numShown++;

      /* Disallow if the stack size is too big. */
      if (
        (!((env.birthStacking ?? state.options?.get("birth_stacking") ?? true)) && numShown > 1) ||
        (numShown + numIgnored > state.z.floorSize &&
          !floorGetOldestIgnored(state, tryGrid, env))
      ) {
        continue;
      }

      /* Score by how close and how full the grid is. */
      const score = 1000 - (dist + (preferPile ? 0 : numShown * 5));
      if (score < bestScore || (score === bestScore && state.rng.oneIn(2))) {
        continue;
      }
      bestScore = score;
      best = tryGrid;
    }
  }

  /* Return if we have a score, otherwise fail or try harder for artifacts. */
  if (bestScore >= 0) return best;
  if (!drop.artifact) return start;

  for (let i = 0; i < 2000; i++) {
    /* Bounce from grid to grid, then go fully random, until an empty one. */
    if (i < 1000) {
      best = randLoc(state.rng, best, 1, 1);
      best = loc(
        Math.max(0, Math.min(best.x, c.width - 1)),
        Math.max(0, Math.min(best.y, c.height - 1)),
      );
    } else {
      best = loc(state.rng.randint0(c.width), state.rng.randint0(c.height));
    }
    if (squareCanPutItem(state, best, env)) return best;
  }
  return start;
}

/** square_canputitem: floor that holds objects, no trap, no pile yet. */
export function squareCanPutItem(
  state: GameState,
  grid: Loc,
  env: FloorEnv = {},
): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  if (!state.chunk.isObjectHolding(grid)) return false;
  if (env.isTrap?.(grid)) return false;
  return floorPile(state, grid).length === 0;
}

/**
 * drop_near: let an object fall to the ground at or near a location.
 * `chance` is the percentage chance the item disappears instead (breakage
 * on a thrown object); artifacts never break. Returns the grid the object
 * landed on, or null when it broke or the floor failed to carry it.
 */
export function dropNear(
  state: GameState,
  drop: GameObject,
  chance: number,
  grid: Loc,
  preferPile: boolean,
  env: FloorEnv = {},
): Loc | null {
  /* Handle normal breakage. */
  if (!drop.artifact && state.rng.randint0(100) < chance) {
    env.onBreak?.(drop, true);
    return null;
  }

  /* Find the best grid and drop the item, destroying if there's no space. */
  const best = dropFindGrid(state, drop, preferPile, grid, env);
  if (floorCarry(state, best, drop, env)) {
    env.onDrop?.(drop, best);
    return best;
  }
  env.onBreak?.(drop, false);
  return null;
}

/**
 * floor_object_for_use: detach `num` items from a floor stack for use -
 * split off a part, or excise the whole object when it is all taken.
 * Returns the detached object and whether none is left on the floor.
 */
export function floorObjectForUse(
  state: GameState,
  obj: GameObject,
  num: number,
): { usable: GameObject; noneLeft: boolean } {
  num = Math.min(num, obj.number);
  if (obj.number > num) {
    const usable = objectSplit(obj, num);
    usable.grid = null;
    return { usable, noneLeft: false };
  }
  if (obj.grid) floorExcise(state, obj.grid, obj);
  obj.grid = null;
  return { usable: obj, noneLeft: true };
}
