/**
 * Projection path geometry, ported from reference/src/project.c (Angband
 * 4.2.6): project_path (the grid-by-grid path a bolt/beam/ball travels) and
 * projectable (can a bolt from grid1 reach grid2). These are the pure-geometry
 * foundation of the projection engine; the project() driver that turns a path
 * into a blast area and the per-target GF_ handlers (project_f/o/m/p) build on
 * this in later increments.
 *
 * Distance here is the game's octagonal metric MAX(dy,dx) + MIN(dy,dx)/2, via
 * the Bresenham-like slope walk. The array-out-parameter of the C signature is
 * returned as a Loc[]; its length is upstream's return value n. The initial
 * grid (grid1) is never included, exactly as upstream.
 *
 * Two upstream couplings are approximated, both faithful in reachable states:
 * - Decoys (cave_find_decoy) are not modelled, so the PROJECT_STOP decoy check
 *   uses a sentinel (-1,-1) that never matches; a decoy only exists once the
 *   create-decoy effect is ported.
 * - PROJECT_INFO uses square_isbelievedwall (the player's remembered map),
 *   which is not modelled; it is approximated by the real projectability. This
 *   branch is only used by targeting display (deferred UI), so it is currently
 *   unreached by ported callers.
 */

import type { Loc } from "../loc";
import { distance, loc } from "../loc";
import type { Chunk } from "./chunk";

/** project.h projection-behaviour flags. */
export const PROJECT = {
  NONE: 0x0000,
  JUMP: 0x0001,
  BEAM: 0x0002,
  THRU: 0x0004,
  STOP: 0x0008,
  GRID: 0x0010,
  ITEM: 0x0020,
  KILL: 0x0040,
  HIDE: 0x0080,
  AWARE: 0x0100,
  SAFE: 0x0200,
  ARC: 0x0400,
  PLAY: 0x0800,
  INFO: 0x1000,
  SHORT: 0x2000,
  SELF: 0x4000,
  ROCK: 0x8000,
} as const;

/** A grid that never matches a real one (no decoy modelled yet). */
const NO_DECOY: Loc = loc(-1, -1);

/**
 * project_path (project.c L123): the ordered grids a projection from grid1
 * toward grid2 passes through, up to `range`, stopping per the flags (finish
 * grid unless THRU, walls unless ROCK, monsters/decoy if STOP). Returns the
 * path grids (length = upstream n); empty when grid1 == grid2.
 */
export function projectPath(
  c: Chunk,
  range: number,
  grid1: Loc,
  grid2: Loc,
  flg: number,
): Loc[] {
  const gp: Loc[] = [];

  /* No path necessary (or allowed). */
  if (grid1.x === grid2.x && grid1.y === grid2.y) return gp;

  /* Analyze dy, dx into absolute magnitudes and step directions. */
  let ay: number;
  let sy: number;
  if (grid2.y < grid1.y) {
    ay = grid1.y - grid2.y;
    sy = -1;
  } else {
    ay = grid2.y - grid1.y;
    sy = 1;
  }
  let ax: number;
  let sx: number;
  if (grid2.x < grid1.x) {
    ax = grid1.x - grid2.x;
    sx = -1;
  } else {
    ax = grid2.x - grid1.x;
    sx = 1;
  }

  const half = ay * ax;
  const full = half << 1;

  /* The shared stop test (finish / wall / monster-decoy). n is gp.length. */
  const shouldStop = (x: number, y: number, n: number): boolean => {
    const here = loc(x, y);
    /* Sometimes stop at the finish grid. */
    if (!(flg & PROJECT.THRU) && x === grid2.x && y === grid2.y) return true;
    /* Stop at non-initial wall grids (n is always >= 1 here, as upstream). */
    if (!(flg & PROJECT.ROCK)) {
      if (!(flg & PROJECT.INFO)) {
        if (n > 0 && !c.isProjectable(here)) return true;
      } else if (n > 0 && !c.isProjectable(here)) {
        /* square_isbelievedwall approximated by the real map (DEFERRED). */
        return true;
      }
    }
    /* Sometimes stop at non-initial monsters / the decoy. */
    if (flg & PROJECT.STOP) {
      if (n > 0 && c.mon(here) !== 0) return true;
      if (x === NO_DECOY.x && y === NO_DECOY.y) return true;
    }
    return false;
  };

  if (ay > ax) {
    /* Mostly vertical. */
    let frac = ax * ax;
    const m = frac << 1;
    let y = grid1.y + sy;
    let x = grid1.x;
    let k = 0;
    for (;;) {
      gp.push(loc(x, y));
      const n = gp.length;
      if (n + (k >> 1) >= range) break;
      if (shouldStop(x, y, n)) break;
      if (m) {
        frac += m;
        if (frac >= half) {
          x += sx;
          frac -= full;
          k++;
        }
      }
      y += sy;
    }
  } else if (ax > ay) {
    /* Mostly horizontal. */
    let frac = ay * ay;
    const m = frac << 1;
    let y = grid1.y;
    let x = grid1.x + sx;
    let k = 0;
    for (;;) {
      gp.push(loc(x, y));
      const n = gp.length;
      if (n + (k >> 1) >= range) break;
      if (shouldStop(x, y, n)) break;
      if (m) {
        frac += m;
        if (frac >= half) {
          y += sy;
          frac -= full;
          k++;
        }
      }
      x += sx;
    }
  } else {
    /* Diagonal. */
    let y = grid1.y + sy;
    let x = grid1.x + sx;
    for (;;) {
      gp.push(loc(x, y));
      const n = gp.length;
      if (n + (n >> 1) >= range) break;
      if (shouldStop(x, y, n)) break;
      y += sy;
      x += sx;
    }
  }

  return gp;
}

/**
 * projectable (project.c L366): true when a bolt from grid1 reaches grid2 with
 * nothing in the way. `maxRange` is z_info->max_range; callers apply the
 * PROJECT_SHORT quartering (a player's COVERTRACKS state) by passing a reduced
 * value. No grid is ever projectable from itself.
 */
export function projectable(
  c: Chunk,
  grid1: Loc,
  grid2: Loc,
  flg: number,
  maxRange: number,
): boolean {
  const gridG = projectPath(c, maxRange, grid1, grid2, flg);

  /* No grid is ever projectable from itself. */
  if (gridG.length === 0) return false;

  const last = gridG[gridG.length - 1]!;
  /* May not end in a wall grid (guard bounds; the path can end OOB only if the
   * very first step left the map, which square_ispassable would reject). */
  if (!c.inBounds(last)) return false;
  if (!c.isPassable(last)) return false;

  /* May not end in an unrequested grid. */
  if (!(last.x === grid2.x && last.y === grid2.y)) return false;

  return true;
}

/** distance re-export for callers computing octagonal blast radii. */
export { distance };
