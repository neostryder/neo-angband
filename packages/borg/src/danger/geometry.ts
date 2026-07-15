/**
 * Geometry helpers the danger evaluator needs: grid distance, line-of-sight,
 * projection paths, and the floor/wall predicates they build on. Faithful ports
 * of the reference routines, operating over the Borg's remembered map
 * (BorgWorld.map) exactly as the C read borg_grids[][].
 *
 * Sources:
 * - distance()               reference/src/cave-view.c:38
 * - borg_distance()          reference/src/borg/borg-projection.c:654
 * - borg_cave_floor_bold()   reference/src/borg/borg-cave-util.c:30
 * - borg_cave_floor_grid()   reference/src/borg/borg-cave-util.c:44
 * - borg_feature_protected() reference/src/borg/borg-cave-util.c:57
 * - borg_los()               reference/src/borg/borg-projection.c:44
 * - borg_inc_motion()        reference/src/borg/borg-projection.c:465
 * - borg_projectable()       reference/src/borg/borg-projection.c:243
 * - borg_projectable_pure()  reference/src/borg/borg-projection.c:372
 *
 * A local `trait()` (defaulting to 0 for the borg_init zero state) mirrors the
 * pattern used in flow-consts.ts; the danger port defines its own so it does not
 * import the flow subsystem.
 */

import { FEAT } from "@neo-angband/core";
import { AUTO_MAX_X, AUTO_MAX_Y } from "../world/grid";
import type { BorgGrid } from "../world/grid";
import type { BorgWorld } from "../world/model";
import { BI } from "../trait/trait-index";
import type { DangerGlobals } from "./globals";

/** Read a derived trait, defaulting to 0 when the self-model has not set it. */
export function trait(world: BorgWorld, bi: number): number {
  return world.self.trait[bi] ?? 0;
}

/* 8-neighbour scan order (cardinals first, then diagonals), plus the centre.
 * Matches cave.c ddx_ddd/ddy_ddd, used by the danger movement simulation. */
export const ddx_ddd: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1, 0];
export const ddy_ddd: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1, 0];

/**
 * distance (cave-view.c:38): the game's grid-distance approximation,
 * max + (min >> 1). borg_distance is a thin wrapper (borg-projection.c:654).
 */
export function distance(y1: number, x1: number, y2: number, x2: number): number {
  const ay = Math.abs(y2 - y1);
  const ax = Math.abs(x2 - x1);
  return ay > ax ? ay + (ax >> 1) : ax + (ay >> 1);
}

/** borg_distance (borg-projection.c:654): distance() with y/x argument order. */
export function borgDistance(y: number, x: number, y2: number, x2: number): number {
  return distance(y, x, y2, x2);
}

/** square_in_bounds (cave.c): inside the [0, MAX-1] map. */
export function squareInBounds(x: number, y: number): boolean {
  return x >= 0 && x < AUTO_MAX_X && y >= 0 && y < AUTO_MAX_Y;
}

/** square_in_bounds_fully (cave.c): strictly inside the outer wall ring. */
export function squareInBoundsFully(x: number, y: number): boolean {
  return x >= 1 && x < AUTO_MAX_X - 1 && y >= 1 && y < AUTO_MAX_Y - 1;
}

/**
 * borg_cave_floor_bold (borg-cave-util.c:30): can (x, y) be stepped on or seen
 * through. Bounds-checked with square_in_bounds_fully.
 */
export function borgCaveFloorBold(world: BorgWorld, y: number, x: number): boolean {
  if (!squareInBoundsFully(x, y)) return false;
  const g = world.map.at(x, y);
  return (
    g.feat === FEAT.FLOOR ||
    g.trap ||
    g.feat === FEAT.LESS ||
    g.feat === FEAT.MORE ||
    g.feat === FEAT.BROKEN ||
    g.feat === FEAT.OPEN
  );
}

/** borg_cave_floor_grid (borg-cave-util.c:44): is this grid a floor grid. */
export function borgCaveFloorGrid(ag: BorgGrid): boolean {
  return (
    ag.feat === FEAT.NONE ||
    ag.feat === FEAT.FLOOR ||
    ag.feat === FEAT.OPEN ||
    ag.feat === FEAT.MORE ||
    ag.feat === FEAT.LESS ||
    ag.feat === FEAT.BROKEN ||
    ag.feat === FEAT.PASS_RUBBLE ||
    ag.feat === FEAT.LAVA
  );
}

/**
 * borg_feature_protected (borg-cave-util.c:57): the grid does not need a glyph
 * to protect it (already blocked by a glyph, a monster, or a wall/door feat in
 * the [FEAT_CLOSED, FEAT_PERM] band).
 */
export function borgFeatureProtected(ag: BorgGrid): boolean {
  return (
    ag.glyph ||
    ag.kill !== 0 ||
    (ag.feat >= FEAT.CLOSED && ag.feat <= FEAT.PERM)
  );
}

/**
 * borg_los (borg-projection.c:44): clear line of sight between two grids over
 * the Borg's remembered map. Verbatim Bresenham-style port, including the knight
 * and exact-corner cases.
 */
export function borgLos(
  world: BorgWorld,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): boolean {
  const dy = y2 - y1;
  const dx = x2 - x1;
  const ay = Math.abs(dy);
  const ax = Math.abs(dx);

  /* Handle adjacent (or identical) grids */
  if (ax < 2 && ay < 2) return true;

  /* Paranoia -- require "safe" origin */
  if (!squareInBoundsFully(x1, y1)) return false;

  /* Directly South/North */
  if (!dx) {
    if (dy > 0) {
      for (let ty = y1 + 1; ty < y2; ty++) {
        if (!borgCaveFloorBold(world, ty, x1)) return false;
      }
    } else {
      for (let ty = y1 - 1; ty > y2; ty--) {
        if (!borgCaveFloorBold(world, ty, x1)) return false;
      }
    }
    return true;
  }

  /* Directly East/West */
  if (!dy) {
    if (dx > 0) {
      for (let tx = x1 + 1; tx < x2; tx++) {
        if (!borgCaveFloorBold(world, y1, tx)) return false;
      }
    } else {
      for (let tx = x1 - 1; tx > x2; tx--) {
        if (!borgCaveFloorBold(world, y1, tx)) return false;
      }
    }
    return true;
  }

  /* Extract some signs */
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;

  /* Vertical "knights" */
  if (ax === 1) {
    if (ay === 2) {
      if (borgCaveFloorBold(world, y1 + sy, x1)) return true;
    }
  } else if (ay === 1) {
    /* Horizontal "knights" */
    if (ax === 2) {
      if (borgCaveFloorBold(world, y1, x1 + sx)) return true;
    }
  }

  /* Calculate scale factor div 2 */
  const f2 = ax * ay;
  /* Calculate scale factor */
  const f1 = f2 << 1;

  let tx: number;
  let ty: number;

  /* Travel horizontally */
  if (ax >= ay) {
    let qy = ay * ay;
    const m = qy << 1;

    tx = x1 + sx;

    if (qy === f2) {
      ty = y1 + sy;
      qy -= f1;
    } else {
      ty = y1;
    }

    while (x2 - tx) {
      if (!borgCaveFloorBold(world, ty, tx)) return false;

      qy += m;

      if (qy < f2) {
        tx += sx;
      } else if (qy > f2) {
        ty += sy;
        if (!borgCaveFloorBold(world, ty, tx)) return false;
        qy -= f1;
        tx += sx;
      } else {
        ty += sy;
        qy -= f1;
        tx += sx;
      }
    }
  } else {
    /* Travel vertically */
    let qx = ax * ax;
    const m = qx << 1;

    ty = y1 + sy;

    if (qx === f2) {
      tx = x1 + sx;
      qx -= f1;
    } else {
      tx = x1;
    }

    while (y2 - ty) {
      if (!borgCaveFloorBold(world, ty, tx)) return false;

      qx += m;

      if (qx < f2) {
        ty += sy;
      } else if (qx > f2) {
        tx += sx;
        if (!borgCaveFloorBold(world, ty, tx)) return false;
        qx -= f1;
        ty += sy;
      } else {
        tx += sx;
        qx -= f1;
        ty += sy;
      }
    }
  }

  return true;
}

/**
 * borg_inc_motion (borg-projection.c:465): advance (py, px) one step along the
 * path from (y1, x1) toward (y2, x2). Verbatim port; mutates and returns the
 * new [y, x].
 */
export function borgIncMotion(
  py: number,
  px: number,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): [number, number] {
  let dy: number;
  let dx: number;
  let sy: number;
  let sx: number;

  if (y2 < y1) {
    dy = y1 - y2;
    sy = -1;
  } else {
    dy = y2 - y1;
    sy = 1;
  }

  if (x2 < x1) {
    dx = x1 - x2;
    sx = -1;
  } else {
    dx = x2 - x1;
    sx = 1;
  }

  /* Paranoia -- no motion */
  if (!dy && !dx) return [py, px];

  const half = dy * dx;
  const full = half << 1;

  /* First step is fixed */
  if (px === x1 && py === y1) {
    if (dy > dx) {
      return [py + sy, px];
    } else if (dx > dy) {
      return [py, px + sx];
    } else {
      return [py + sy, px + sx];
    }
  }

  let frac: number;
  let m: number;
  let y: number;
  let x: number;
  let k: number;

  /* Move mostly vertically */
  if (dy > dx) {
    k = dy;
    frac = dx * dx;
    m = frac << 1;
    y = y1 + sy;
    x = x1;

    for (;;) {
      if (x === px && y === py) k = 1;

      if (m) {
        frac += m;
        if (frac >= half) {
          x += sx;
          frac -= full;
        }
      }

      y += sy;
      k--;

      if (!k) return [y, x];
    }
  } else if (dx > dy) {
    /* Move mostly horizontally */
    frac = dy * dy;
    m = frac << 1;
    y = y1;
    x = x1 + sx;
    k = dx;

    for (;;) {
      if (x === px && y === py) k = 1;

      if (m) {
        frac += m;
        if (frac >= half) {
          y += sy;
          frac -= full;
        }
      }

      x += sx;
      k--;

      if (!k) return [y, x];
    }
  } else {
    /* Diagonal */
    k = dy;
    y = y1 + sy;
    x = x1 + sx;

    for (;;) {
      if (x === px && y === py) k = 1;

      y += sy;
      x += sx;
      k--;

      if (!k) return [y, x];
    }
  }
}

/**
 * borg_projectable (borg-projection.c:243): can a spell/missile travel from
 * (y1, x1) to (y2, x2) over the remembered map, assuming no monster blocks it.
 * Unknown (FEAT_NONE) grids are treated as walls beyond a distance that depends
 * on how wounded/fearful the Borg is - the exact wounded-state branches are
 * preserved.
 */
export function borgProjectable(
  world: BorgWorld,
  g: DangerGlobals,
  maxRange: number,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): boolean {
  let y = y1;
  let x = x1;

  const curhp = trait(world, BI.CURHP);
  const maxhp = trait(world, BI.MAXHP);
  const scary = world.facts.scaryGuyOnLevel;
  const cy = world.self.c.y;
  const cx = world.self.c.x;

  for (let dist = 0; dist <= maxRange; dist++) {
    if (!squareInBounds(x, y)) return false;
    const ag = world.map.at(x, y);

    if (curhp < Math.trunc(maxhp / 3) || g.morgothPosition || scary) {
      if (dist > 20 && ag.feat === FEAT.NONE) break;
    } else if (curhp < Math.trunc(maxhp / 2)) {
      if (dist > 10 && ag.feat === FEAT.NONE) break;
    } else if (
      fearRegionAt(world, g, cy, cx) >= Math.trunc(g.avoidance / 20)
    ) {
      if (dist > maxRange && ag.feat === FEAT.NONE) break;
    } else {
      if (dist > 2 && ag.feat === FEAT.NONE) break;
    }

    /* Never pass through walls/doors */
    if (dist && !borgCaveFloorGrid(ag)) break;

    /* Check for arrival at "final target" */
    if (x === x2 && y === y2) return true;

    /* Calculate the new location */
    [y, x] = borgIncMotion(y, x, y1, x1, y2, x2);
  }

  return false;
}

/**
 * borg_projectable_pure (borg-projection.c:372): like borg_projectable but
 * assumes unknown grids are walls and monsters in the way stop the projection.
 */
export function borgProjectablePure(
  world: BorgWorld,
  maxRange: number,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): boolean {
  let y = y1;
  let x = x1;

  for (let dist = 0; dist <= maxRange; dist++) {
    if (!squareInBounds(x, y)) return false;
    const ag = world.map.at(x, y);

    /* Assume unknown grids are walls */
    if (dist && ag.feat === FEAT.NONE) break;

    /* Never pass through walls/doors */
    if (dist && !borgCaveFloorGrid(ag)) break;

    /* Check for arrival at "final target" */
    if (x === x2 && y === y2) return true;

    /* Stop at monsters */
    if (ag.kill) break;

    [y, x] = borgIncMotion(y, x, y1, x1, y2, x2);
  }

  return false;
}

/**
 * Read the regional-fear cache at a grid's region, importing lazily to avoid a
 * module cycle with fear.ts. The DangerGlobals object carries the live cache so
 * borg_projectable can consult it exactly as the C read borg_fear_region[][].
 */
function fearRegionAt(world: BorgWorld, g: DangerGlobals, y: number, x: number): number {
  return g.fearRegion ? g.fearRegion.region(y, x) : 0;
}
