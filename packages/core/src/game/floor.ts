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
import { OSTACK_FLOOR, objectAbsorb, objectMergeable, tvalIsMoney } from "../obj/object";
import { los } from "../world/view";
import type { GameState } from "./context";
import { objectIsInQuiver, objectSplit } from "./gear";

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

/**
 * pile_contains (obj-pile.c L268). The pile is an array here, so the walk down
 * obj->next is indexOf; kept as a named function so the intent (and the C
 * symbol) is visible where the pile identity check matters.
 */
export function pileContains(
  pile: readonly GameObject[],
  obj: GameObject,
): boolean {
  return pile.indexOf(obj) >= 0;
}

/**
 * square_holds_object (cave-square.c L1015): whether this exact object is in
 * the pile at `grid`. Identity, not equality - it answers "is this the object I
 * am holding a reference to, still here".
 */
export function squareHoldsObject(
  state: GameState,
  grid: Loc,
  obj: GameObject,
): boolean {
  if (!state.chunk.inBounds(grid)) return false;
  return pileContains(floorPile(state, grid), obj);
}

/**
 * pile_last_item (obj-pile.c L248): the tail of a pile, or null when empty.
 * Upstream's two consumers (gear_last_item -> combine_pack, obj-ignore.c
 * ignore_drop) both use it to walk gear BACKWARDS; here that is a reversed
 * array walk (game/gear.ts combinePack, game/ignore-cmd.ts).
 */
export function pileLastItem(
  pile: readonly GameObject[],
): GameObject | null {
  return pile.length > 0 ? (pile[pile.length - 1] as GameObject) : null;
}

/** object_floor_t (obj-pile.h L43): scan_floor's mode bits. */
export const OFLOOR = {
  NONE: 0x00,
  /** Verify the item tester. */
  TEST: 0x01,
  /** Sensed or known items only. */
  SENSE: 0x02,
  /** Only the top item. */
  TOP: 0x04,
  /** Visible items only. */
  VISIBLE: 0x08,
} as const;

/** get_item mode bits (game-input.h L28-40), the subset scan_items reads. */
export const USE_MODE = {
  EQUIP: 0x0001,
  INVEN: 0x0002,
  FLOOR: 0x0004,
  QUIVER: 0x0008,
} as const;

/** item_tester: null accepts everything (object_test, obj-util.c). */
export type ItemTester = ((obj: GameObject) => boolean) | null;

/**
 * object_test (obj-util.c L386): null accepts anything except gold, a real
 * tester still must reject gold too. Every OFLOOR_TEST / scan_items caller
 * routes through this rather than the tester alone, so a null-tester scan
 * (e.g. a future "drop"/"pickup" get_item) does not offer gold objects the
 * way a bare `tester(obj)` call would.
 */
function objectTest(tester: ItemTester, obj: GameObject | null | undefined): boolean {
  if (!obj) return false;
  if (tvalIsMoney(obj.tval)) return false;
  return !tester || tester(obj);
}

/**
 * scan_floor (obj-pile.c L1295): the objects at the player's grid that pass
 * `mode`, newest first, capped at maxSize.
 *
 * OFLOOR_SENSE (`!obj->known`) has no counterpart: this port has no per-object
 * known twin (see the module header), so nothing is dropped for being unsensed.
 * OFLOOR_VISIBLE is `!is_unknown(obj) && ignore_item_ok(p, obj) -> skip`; with
 * no unknown_item_kind marker, is_unknown is always false and the term reduces
 * to the ignore check, which rides env.isIgnored.
 */
export function scanFloor(
  state: GameState,
  maxSize: number,
  mode: number,
  tester: ItemTester,
  env: FloorEnv = {},
): GameObject[] {
  const out: GameObject[] = [];
  if (!state.chunk.inBounds(state.actor.grid)) return out;
  for (const obj of floorPile(state, state.actor.grid)) {
    /* Enforce limit. */
    if (out.length >= maxSize) break;
    /* Item tester. */
    if (mode & OFLOOR.TEST && !objectTest(tester, obj)) continue;
    /* Visible. */
    if (mode & OFLOOR.VISIBLE && (env.isIgnored?.(obj) ?? false)) continue;
    out.push(obj);
    /* Only one. */
    if (mode & OFLOOR.TOP) break;
  }
  return out;
}

/**
 * scan_items (obj-pile.c L1376): the "valid" objects a get_item picker over
 * `mode` may offer, in upstream's source order - inventory, then equipment,
 * then quiver, then the floor. ORDER IS BEHAVIOUR: it decides which letter each
 * item gets. The floor pass is scan_floor with
 * OFLOOR_TEST | OFLOOR_SENSE | OFLOOR_VISIBLE (L1411).
 *
 * Upstream stops at item_max across ALL passes; that cap is kept.
 *
 * The inventory pass walks p->upkeep->inven[], which calc_inventory fills
 * DISJOINTLY from p->upkeep->quiver[] (player-calcs.c L1023: each non-equipped
 * gear item is assigned to exactly one of the two). This port's gear.pack is
 * the raw gear list and keeps quiver members, so the inven pass excludes them
 * with objectIsInQuiver - otherwise USE_INVEN | USE_QUIVER would list a quivered
 * stack twice and shift every later letter.
 */
export function scanItems(
  state: GameState,
  itemMax: number,
  mode: number,
  tester: ItemTester,
  env: FloorEnv = {},
): GameObject[] {
  const out: GameObject[] = [];
  const player = state.actor.player;
  const test = (obj: GameObject | null | undefined): boolean => objectTest(tester, obj);

  if (mode & USE_MODE.INVEN) {
    for (const handle of state.gear.pack) {
      if (out.length >= itemMax) break;
      if (objectIsInQuiver(state.gear, handle)) continue;
      const obj = state.gear.store.get(handle);
      if (test(obj)) out.push(obj as GameObject);
    }
  }
  if (mode & USE_MODE.EQUIP) {
    for (let i = 0; i < player.body.count; i++) {
      if (out.length >= itemMax) break;
      const obj = state.gear.store.get(player.equipment[i] ?? 0);
      if (test(obj)) out.push(obj as GameObject);
    }
  }
  if (mode & USE_MODE.QUIVER) {
    for (const handle of state.gear.quiver ?? []) {
      if (out.length >= itemMax) break;
      const obj = state.gear.store.get(handle);
      if (test(obj)) out.push(obj as GameObject);
    }
  }
  if (mode & USE_MODE.FLOOR) {
    const floor = scanFloor(
      state,
      state.z.floorSize,
      OFLOOR.TEST | OFLOOR.SENSE | OFLOOR.VISIBLE,
      tester,
      env,
    );
    for (const obj of floor) {
      if (out.length >= itemMax) break;
      out.push(obj);
    }
  }
  return out;
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
 *
 * square_set_obj (cave-square.c:1291) has no counterpart: upstream stores a
 * `square->obj` linked-list HEAD, and its only two calls both set it to NULL
 * (cave-square.c:1035 inside square_excise_pile, obj-pile.c:1201 inside
 * push_object). Here the pile IS the Map entry, so emptying it is the delete
 * below - and square_excise_pile (cave-square.c:1031) is the caller-side loop
 * `for (obj of [...floorPile(...)]) floorExcise(...)`.
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
