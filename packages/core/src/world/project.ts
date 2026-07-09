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

import { SQUARE } from "../generated";
import type { Loc } from "../loc";
import { distance, loc } from "../loc";
import type { Chunk } from "./chunk";
import { los } from "./view";

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

/**
 * get_angle_to_grid[41][41] (gen-util.c L63): for a grid offset (dx, dy) from a
 * centre, indexed [dy + 20][dx + 20], the angle in degrees to that grid. Used by
 * arc projections (and starburst rooms) to reject grids outside the arc's cone.
 * [20][20] is the centre itself (255, an undefined-angle sentinel). Copied
 * verbatim from upstream; indexing is [y][x] exactly as the C table.
 */
export const GET_ANGLE_TO_GRID: readonly (readonly number[])[] = [
  [68,67,66,65,64,63,62,62,60,59,58,57,56,55,53,52,51,49,48,46,45,44,42,41,39,38,37,35,34,33,32,31,30,28,28,27,26,25,24,24,23],
  [69,68,67,66,65,64,63,62,61,60,59,58,56,55,54,52,51,49,48,47,45,43,42,41,39,38,36,35,34,32,31,30,29,28,27,26,25,24,24,23,22],
  [69,69,68,67,66,65,64,63,62,61,60,58,57,56,54,53,51,50,48,47,45,43,42,40,39,37,36,34,33,32,30,29,28,27,26,25,24,24,23,22,21],
  [70,69,69,68,67,66,65,64,63,61,60,59,58,56,55,53,52,50,48,47,45,43,42,40,38,37,35,34,32,31,30,29,27,26,25,24,24,23,22,21,20],
  [71,70,69,69,68,67,66,65,63,62,61,60,58,57,55,54,52,50,49,47,45,43,41,40,38,36,35,33,32,30,29,28,27,25,24,24,23,22,21,20,19],
  [72,71,70,69,69,68,67,65,64,63,62,60,59,58,56,54,52,51,49,47,45,43,41,39,38,36,34,32,31,30,28,27,26,25,24,23,22,21,20,19,18],
  [73,72,71,70,69,69,68,66,65,64,63,61,60,58,57,55,53,51,49,47,45,43,41,39,37,35,33,32,30,29,27,26,25,24,23,22,21,20,19,18,17],
  [73,73,72,71,70,70,69,68,66,65,64,62,61,59,57,56,54,51,49,47,45,43,41,39,36,34,33,31,29,28,26,25,24,23,21,20,20,19,18,17,17],
  [75,74,73,72,72,71,70,69,68,66,65,63,62,60,58,56,54,52,50,47,45,43,40,38,36,34,32,30,28,27,25,24,23,21,20,19,18,18,17,16,15],
  [76,75,74,74,73,72,71,70,69,68,66,65,63,61,59,57,55,53,50,48,45,42,40,37,35,33,31,29,27,25,24,23,21,20,19,18,17,16,16,15,14],
  [77,76,75,75,74,73,72,71,70,69,68,66,64,62,60,58,56,53,51,48,45,42,39,37,34,32,30,28,26,24,23,21,20,19,18,17,16,15,15,14,13],
  [78,77,77,76,75,75,74,73,72,70,69,68,66,64,62,60,57,54,51,48,45,42,39,36,33,30,28,26,24,23,21,20,18,17,16,15,15,14,13,13,12],
  [79,79,78,77,77,76,75,74,73,72,71,69,68,66,63,61,58,55,52,49,45,41,38,35,32,29,27,24,23,21,19,18,17,16,15,14,13,13,12,11,11],
  [80,80,79,79,78,77,77,76,75,74,73,71,69,68,65,63,60,57,53,49,45,41,37,33,30,27,25,23,21,19,17,16,15,14,13,13,12,11,11,10,10],
  [82,81,81,80,80,79,78,78,77,76,75,73,72,70,68,65,62,58,54,50,45,40,36,32,28,25,23,20,18,17,15,14,13,12,12,11,10,10,9,9,8],
  [83,83,82,82,81,81,80,79,79,78,77,75,74,72,70,68,64,60,56,51,45,39,34,30,26,23,20,18,16,15,13,12,11,11,10,9,9,8,8,7,7],
  [84,84,84,83,83,83,82,81,81,80,79,78,77,75,73,71,68,63,58,52,45,38,32,27,23,19,17,15,13,12,11,10,9,9,8,7,7,7,6,6,6],
  [86,86,85,85,85,84,84,84,83,82,82,81,80,78,77,75,72,68,62,54,45,36,28,23,18,15,13,12,10,9,8,8,7,6,6,6,5,5,5,4,4],
  [87,87,87,87,86,86,86,86,85,85,84,84,83,82,81,79,77,73,68,58,45,32,23,17,13,11,9,8,7,6,6,5,5,4,4,4,4,3,3,3,3],
  [89,88,88,88,88,88,88,88,88,87,87,87,86,86,85,84,83,81,77,68,45,23,13,9,7,6,5,4,4,3,3,3,2,2,2,2,2,2,2,2,1],
  [90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,90,255,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [91,92,92,92,92,92,92,92,92,93,93,93,94,94,95,96,97,99,103,113,135,158,167,171,173,174,175,176,176,177,177,177,178,178,178,178,178,178,178,178,179],
  [93,93,93,93,94,94,94,94,95,95,96,96,97,98,99,101,103,107,113,122,135,148,158,163,167,169,171,172,173,174,174,175,175,176,176,176,176,177,177,177,177],
  [94,94,95,95,95,96,96,96,97,98,98,99,100,102,103,105,108,113,118,126,135,144,152,158,162,165,167,168,170,171,172,172,173,174,174,174,175,175,175,176,176],
  [96,96,96,97,97,97,98,99,99,100,101,102,103,105,107,109,113,117,122,128,135,142,148,153,158,161,163,165,167,168,169,170,171,171,172,173,173,173,174,174,174],
  [97,97,98,98,99,99,100,101,101,102,103,105,106,108,110,113,116,120,124,129,135,141,146,150,154,158,160,162,164,165,167,168,169,169,170,171,171,172,172,173,173],
  [98,99,99,100,100,101,102,102,103,104,105,107,108,110,113,115,118,122,126,130,135,140,144,148,152,155,158,160,162,163,165,166,167,168,168,169,170,170,171,171,172],
  [100,100,101,101,102,103,103,104,105,106,107,109,111,113,115,117,120,123,127,131,135,139,143,147,150,153,155,158,159,161,163,164,165,166,167,167,168,169,169,170,170],
  [101,101,102,103,103,104,105,106,107,108,109,111,113,114,117,119,122,125,128,131,135,139,142,145,148,151,153,156,158,159,161,162,163,164,165,166,167,167,168,169,169],
  [102,103,103,104,105,105,106,107,108,110,111,113,114,116,118,120,123,126,129,132,135,138,141,144,147,150,152,154,156,158,159,160,162,163,164,165,165,166,167,167,168],
  [103,104,105,105,106,107,108,109,110,111,113,114,116,118,120,122,124,127,129,132,135,138,141,143,146,148,150,152,154,156,158,159,160,161,162,163,164,165,165,166,167],
  [104,105,106,106,107,108,109,110,111,113,114,115,117,119,121,123,125,127,130,132,135,138,140,143,145,147,149,151,153,155,156,158,159,160,161,162,163,164,164,165,166],
  [105,106,107,108,108,109,110,111,113,114,115,117,118,120,122,124,126,128,130,133,135,137,140,142,144,146,148,150,152,153,155,156,158,159,160,161,162,162,163,164,165],
  [107,107,108,109,110,110,111,113,114,115,116,118,119,121,123,124,126,129,131,133,135,137,139,141,144,146,147,149,151,152,154,155,156,158,159,160,160,161,162,163,163],
  [107,108,109,110,111,112,113,114,115,116,117,119,120,122,123,125,127,129,131,133,135,137,139,141,143,145,147,148,150,151,153,154,155,156,158,159,159,160,161,162,163],
  [108,109,110,111,112,113,114,115,116,117,118,120,121,122,124,126,128,129,131,133,135,137,139,141,142,144,146,148,149,150,152,153,154,155,157,158,159,159,160,161,162],
  [109,110,111,112,113,114,114,115,117,118,119,120,122,123,125,126,128,130,131,133,135,137,139,140,142,144,145,147,148,150,151,152,153,155,156,157,158,159,159,160,161],
  [110,111,112,113,114,114,115,116,117,119,120,121,122,124,125,127,128,130,132,133,135,137,138,140,142,143,145,146,148,149,150,151,153,154,155,156,157,158,159,159,160],
  [111,112,113,114,114,115,116,117,118,119,120,122,123,124,126,127,129,130,132,133,135,137,138,140,141,143,144,146,147,148,150,151,152,153,154,155,156,157,158,159,159],
  [112,113,114,114,115,116,117,118,119,120,121,122,124,125,126,128,129,131,132,133,135,137,138,139,141,142,144,145,146,148,149,150,151,152,153,154,155,156,157,158,159],
  [113,114,114,115,116,117,118,118,120,121,122,123,124,125,127,128,129,131,132,134,135,136,138,139,141,142,143,145,146,147,148,149,150,152,152,153,154,155,156,157,158],
] as const;

/** One traveled step of a bolt/beam, for projection visuals. */
export interface BoltStep {
  /** Grid the step moved from. */
  from: Loc;
  /** Grid the step moved to. */
  to: Loc;
}

/** The result of a monster GF handler, mirroring project_m's out-parameters. */
export interface MonsterHitResult {
  /** did_hit: the projection struck a monster in the grid. */
  didHit: boolean;
  /** was_obvious: the effect was observed by the player. */
  wasObvious: boolean;
  /** The monster's grid AFTER the hit (project_m may teleport it). */
  grid?: Loc;
}

/** Inputs to a projection, matching project()'s C signature (project.c L576). */
export interface ProjectParams {
  /** Resolved source grid (caller applies origin_get_loc); (-1,-1) => none. */
  origin: Loc;
  /** finish: the target grid, or a grid to travel toward. */
  finish: Loc;
  /** rad: 0 = bolt/beam, 1..20 = ball radius, or max arc length. */
  rad: number;
  /** typ: GF_ projection type, opaque to the driver; passed to the hooks. */
  typ: number;
  /** flg: PROJECT_* behaviour flags. */
  flg: number;
  /** degrees_of_arc: arc width; 0 with a radius means a fixed-length beam. */
  degreesOfArc?: number;
  /** diameter_of_source: controls damage falloff (10 = 1/2 at range 1). */
  diameterOfSource?: number;
  /** z_info->max_range. */
  maxRange: number;
  /** dam: base damage applied to each affected grid. */
  dam: number;
  /** Whether the source is the player (drives single-target tracking). */
  sourceIsPlayer?: boolean;
  /** Whether the player is blind (suppresses bolt visuals). */
  blind?: boolean;
}

/** The computed blast: pure geometry + damage, no side effects. */
export interface Projection {
  /** flg after JUMP/arc-to-beam normalization (what the hooks receive). */
  flg: number;
  /** The blast epicentre. */
  centre: Loc;
  /** The full projection path (beam-limited), for on-path tests and visuals. */
  pathGrids: Loc[];
  /** Traveled bolt/beam steps, in order, for bolt visuals. */
  bolts: BoltStep[];
  /** Affected grids (num_grids), sorted ascending by distance from centre. */
  grids: Loc[];
  /** distance_to_grid[i] for each affected grid. */
  distanceToGrid: number[];
  /** dam_at_dist[0..maxRange]: damage applied at each distance from centre. */
  damAtDist: number[];
}

/** The 8 grid offsets around a cell (order irrelevant for existence tests). */
const NEIGHBORS8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

/**
 * computeProjection: the pure blast geometry and damage-falloff core of
 * project() (project.c L576), with no side effects. It resolves the source,
 * normalizes the flags (PROJECT_JUMP, and a zero-width arc into a beam), walks
 * the path collecting beam/bolt grids, gathers the explosion's blast grids
 * (with arc-angle rejection via GET_ANGLE_TO_GRID and LOS from the centre),
 * precomputes damage at each distance, and sorts the grids outward from the
 * centre. The per-grid GF effects and UI events are applied by project() using
 * this result, so the geometry is independently testable.
 */
export function computeProjection(c: Chunk, p: ProjectParams): Projection {
  let flg = p.flg;
  let rad = p.rad;
  const { finish, maxRange, dam } = p;
  const degreesOfArc = p.degreesOfArc ?? 0;
  const diameterOfSource = p.diameterOfSource ?? 0;

  /* No projection path - jump to target. */
  let start: Loc;
  if (flg & PROJECT.JUMP) {
    start = finish;
    flg &= ~PROJECT.JUMP;
  } else {
    start = p.origin.x === -1 && p.origin.y === -1 ? finish : p.origin;
  }

  /* Default center of explosion (if any). */
  let centre = start;

  /* A zero-width arc with a radius is really a fixed-length beam. */
  if (flg & PROJECT.ARC && degreesOfArc === 0 && rad !== 0) {
    flg &= ~PROJECT.ARC;
    flg |= PROJECT.BEAM;
    flg |= PROJECT.THRU;
  }

  const grids: Loc[] = [];
  const distanceToGrid: number[] = [];
  let pathGrids: Loc[] = [];
  const bolts: BoltStep[] = [];

  if (start.x === finish.x && start.y === finish.y) {
    /* A single grid is both start and finish. */
    grids.push(finish);
    distanceToGrid.push(0);
    centre = finish;
  } else {
    let y = start.y;
    let x = start.x;

    /* Calculate the projection path. */
    pathGrids = projectPath(c, maxRange, start, finish, flg);

    /* Some beams have limited length. */
    if (flg & PROJECT.BEAM && rad > 0 && rad < pathGrids.length) {
      pathGrids = pathGrids.slice(0, rad);
    }

    /* Project along the path (except for arcs). */
    if (!(flg & PROJECT.ARC)) {
      for (let i = 0; i < pathGrids.length; i++) {
        const step = pathGrids[i]!;
        const oy = y;
        const ox = x;

        /* Balls explode before reaching walls. */
        if (!c.isPassable(step) && rad > 0 && !(flg & PROJECT.BEAM)) break;

        /* Advance. */
        y = step.y;
        x = step.x;

        /* Beams collect every grid; other methods collect only the last. */
        if (flg & PROJECT.BEAM) {
          grids.push(loc(x, y));
          distanceToGrid.push(0);
        } else if (i === pathGrids.length - 1) {
          grids.push(loc(x, y));
          distanceToGrid.push(0);
        }

        bolts.push({ from: loc(ox, oy), to: loc(x, y) });
      }
    }

    /* Save the "blast epicenter". */
    centre = loc(x, y);
  }

  /* Now check for explosions. Non-beam projections with positive radius
   * explode; beams have already collected all their grids. */
  if (rad > 0 && !(flg & PROJECT.BEAM)) {
    let n1y = 0;
    let n1x = 0;

    /* Pre-calculate some things for arcs. */
    if (flg & PROJECT.ARC && pathGrids.length !== 0) {
      /* Explosion centers on the caster. */
      centre = start;

      /* The radius of arcs cannot be more than 20. */
      if (rad > 20) rad = 20;

      /* Ensure legal access into the angle table. */
      const i = pathGrids.length < 21 ? pathGrids.length - 1 : 20;
      const end = pathGrids[i]!;

      /* Reorient the grid at the end of the arc's centerline. */
      n1y = end.y - centre.y + 20;
      n1x = end.x - centre.x + 20;
    }

    /* If the explosion centre hasn't been saved already, save it now. */
    if (grids.length === 0) {
      grids.push(centre);
      distanceToGrid.push(0);
    }

    /* Scan every grid that might possibly be in the blast radius. */
    for (let y = centre.y - rad; y <= centre.y + rad; y++) {
      for (let x = centre.x - rad; x <= centre.x + rad; x++) {
        const grid = loc(x, y);

        /* Center grid has already been stored. */
        if (grid.x === centre.x && grid.y === centre.y) continue;

        /* Precaution: stay within the area limit. */
        if (grids.length >= 255) break;

        /* Ignore illegal locations. */
        if (!c.inBounds(grid)) continue;

        /* Walls block most explosions. With PROJECT_THRU (none in 4.2.6) a
         * wall can be affected if adjacent to a grid in LOS of the centre.
         * All explosions can affect one passable-but-not-projectable layer. */
        if (flg & PROJECT.THRU || c.isPassable(grid)) {
          if (!c.isProjectable(grid)) {
            let canSeeOne = false;
            for (const [dx, dy] of NEIGHBORS8) {
              if (los(c, centre, loc(grid.x + dx, grid.y + dy))) {
                canSeeOne = true;
                break;
              }
            }
            if (!canSeeOne) continue;
          }
        } else if (!c.isProjectable(grid)) {
          continue;
        }

        /* Must be within maximum distance. */
        const distFromCentre = distance(centre, grid);
        if (distFromCentre > rad) continue;

        /* Mark grids which are on the projection path. */
        let onPath = false;
        for (const g of pathGrids) {
          if (g.x === grid.x && g.y === grid.y) onPath = true;
        }

        /* Do we need to consider a restricted angle? */
        if (flg & PROJECT.ARC) {
          const n2y = y - start.y + 20;
          const n2x = x - start.x + 20;
          const rotate = 90 - GET_ANGLE_TO_GRID[n1y]![n1x]!;
          const tmp = Math.abs(GET_ANGLE_TO_GRID[n2y]![n2x]! + rotate) % 180;
          const diff = Math.abs(90 - tmp);

          /* Skip if outside the arc, unless it's on the target path. */
          if (diff >= Math.floor((degreesOfArc + 6) / 4) && !onPath) continue;
        }

        /* Accept remaining grids if in LOS of the centre or on the path. */
        if (los(c, centre, grid) || onPath) {
          grids.push(grid);
          distanceToGrid.push(distFromCentre);
        }
      }
    }
  }

  /* Calculate and store the actual damage at each distance. */
  const damAtDist: number[] = new Array(maxRange + 1);
  for (let i = 0; i <= maxRange; i++) {
    let damTemp: number;
    if (i > rad) {
      /* No damage outside the radius. */
      damTemp = 0;
    } else if (!diameterOfSource || i === 0) {
      /* Standard calc. for 10' source diameters, or at the origin. */
      damTemp = Math.floor((dam + i) / (i + 1));
    } else {
      /* A given source diameter is full strength to that diameter, then
       * reduces with distance. */
      damTemp = Math.floor((diameterOfSource * dam) / (i + 1));
      if (damTemp > dam) damTemp = dam;
    }
    damAtDist[i] = damTemp;
  }

  /* Sort the blast grids by distance from the centre (stable outward order). */
  let k = 0;
  for (let i = 0; i <= rad; i++) {
    for (let j = k; j < grids.length; j++) {
      if (distanceToGrid[j] === i) {
        const tmpGrid = grids[k]!;
        const tmpDist = distanceToGrid[k]!;
        grids[k] = grids[j]!;
        distanceToGrid[k] = distanceToGrid[j]!;
        grids[j] = tmpGrid;
        distanceToGrid[j] = tmpDist;
        k++;
      }
    }
  }

  return { flg, centre, pathGrids, bolts, grids, distanceToGrid, damAtDist };
}

/**
 * The per-grid effect and UI seams of project(). Each is optional; the port's
 * GF_ handlers (project_f/o/m/p) and the web UI supply them in later
 * increments. Object/feature/player handlers return true when the player
 * observed an effect; the monster handler returns project_m's out-parameters.
 */
export interface ProjectHooks {
  /** UI: display one bolt/beam step. Fired only when not blind and not HIDE. */
  onBolt?: (step: BoltStep, typ: number, beam: boolean) => void;
  /** UI: display the whole blast, once, before per-grid effects. */
  onBlast?: (proj: Projection, typ: number) => void;
  /** project_o: affect an object on the ground. */
  onObject?: (dist: number, grid: Loc, dam: number, typ: number) => boolean;
  /** project_m: affect a monster in the grid. */
  onMonster?: (
    dist: number,
    grid: Loc,
    dam: number,
    typ: number,
    flg: number,
  ) => MonsterHitResult;
  /** project_p: affect the player. */
  onPlayer?: (
    dist: number,
    grid: Loc,
    dam: number,
    typ: number,
    projSelf: boolean,
  ) => boolean;
  /** project_f: affect a terrain feature. */
  onFeature?: (dist: number, grid: Loc, dam: number, typ: number) => boolean;
  /** Recall/health-track the single monster a player projection hit. */
  onTrackMonster?: (grid: Loc) => void;
  /** Whether the player has just died (checked after project_p). */
  playerIsDead?: () => boolean;
}

/**
 * project (project.c L576): the generic beam/bolt/ball/arc driver. Computes the
 * blast via computeProjection, marks the affected grids for one-shot monster
 * processing, then applies the per-grid GF handlers and UI events (supplied as
 * hooks) in upstream order: bolt visuals, blast visuals, objects, monsters,
 * player, features. Returns true if the player observed any effect.
 *
 * Faithful deviation: on the player-death early return we clear the
 * SQUARE_PROJECT marks first. Upstream leaves them set (the level is torn down
 * on death), so this is unobservable but avoids leaving stale marks on a Chunk
 * the port may keep.
 */
export function project(
  c: Chunk,
  params: ProjectParams,
  hooks: ProjectHooks = {},
): boolean {
  const proj = computeProjection(c, params);
  const { flg, grids, distanceToGrid, damAtDist } = proj;
  let notice = false;

  /* Mark every affected grid for projection processing. */
  for (const g of grids) c.sqinfoOn(g, SQUARE.PROJECT);

  const clearMarks = () => {
    for (const g of grids) c.sqinfoOff(g, SQUARE.PROJECT);
  };

  /* Bolt visuals. */
  if (!params.blind && !(flg & PROJECT.HIDE) && hooks.onBolt) {
    const beam = !!(flg & PROJECT.BEAM);
    for (const step of proj.bolts) hooks.onBolt(step, params.typ, beam);
  }

  /* Blast visuals. */
  hooks.onBlast?.(proj, params.typ);

  /* Affect objects on every relevant grid. */
  if (flg & PROJECT.ITEM && hooks.onObject) {
    for (let i = 0; i < grids.length; i++) {
      const d = distanceToGrid[i]!;
      if (hooks.onObject(d, grids[i]!, damAtDist[d]!, params.typ)) notice = true;
    }
  }

  /* Check monsters. */
  if (flg & PROJECT.KILL && hooks.onMonster) {
    let numHit = 0;
    let lastHit = loc(0, 0);

    for (let i = 0; i < grids.length; i++) {
      const g = grids[i]!;

      /* Skip grids no longer marked, or with no monster. */
      if (!c.sqinfoHas(g, SQUARE.PROJECT)) continue;
      if (c.mon(g) === 0) continue;

      const d = distanceToGrid[i]!;
      const res = hooks.onMonster(d, g, damAtDist[d]!, params.typ, flg);
      if (res.wasObvious) notice = true;
      if (res.didHit) {
        numHit++;
        /* Monster location may have been updated by the handler. */
        lastHit = res.grid ?? g;
      }
    }

    /* Player affected exactly one monster (without jumping). */
    if (params.sourceIsPlayer && numHit === 1 && !(flg & PROJECT.JUMP)) {
      hooks.onTrackMonster?.(lastHit);
    }
  }

  /* Look for the player, affect them when found. */
  if (flg & PROJECT.PLAY && hooks.onPlayer) {
    const projSelf = !!(flg & PROJECT.SELF);
    for (let i = 0; i < grids.length; i++) {
      const d = distanceToGrid[i]!;
      if (hooks.onPlayer(d, grids[i]!, damAtDist[d]!, params.typ, projSelf)) {
        notice = true;
        if (hooks.playerIsDead?.()) {
          clearMarks();
          return notice;
        }
        break;
      }
    }
  }

  /* Affect features in every relevant grid. */
  if (flg & PROJECT.GRID && hooks.onFeature) {
    for (let i = 0; i < grids.length; i++) {
      const d = distanceToGrid[i]!;
      if (hooks.onFeature(d, grids[i]!, damAtDist[d]!, params.typ)) notice = true;
    }
  }

  /* Clear all the processing marks. */
  clearMarks();

  return notice;
}

/** distance re-export for callers computing octagonal blast radii. */
export { distance };
