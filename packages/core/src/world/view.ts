/**
 * Line of sight, ported from reference/src/cave-view.c (Angband 4.2.6).
 *
 * los() is the integer fixed-point algorithm by Joseph Hall: true when a
 * line can be traced between grid centers with every intermediate grid
 * projectable. Reflexive except for the "chess knight move" special
 * cases, exactly as upstream.
 *
 * updateView() is the player FOV: wall-face lighting, light propagation
 * (player + other sources), and the VIEW/SEEN/CLOSE_PLAYER square flags.
 * The player and monster couplings are injected: a ViewerState carries
 * exactly the fields the C reads from struct player, and light sources
 * arrive as a list instead of scanning the monster array. The knowledge
 * side effects of update_one (trap reveal, square_note_spot/light_spot,
 * feeling display, blind memory forget) are deferred to the knowledge
 * module; the flag bookkeeping they sit beside is ported.
 */

import type { GameEvents } from "../events";
import { SQUARE } from "../generated";
import { DDGRID, DDGRID_DDD, distance, loc, locEq, locSum } from "../loc";
import type { Loc } from "../loc";
import { featIsBright } from "./chunk";
import type { Chunk } from "./chunk";

/** los(c, grid1, grid2). */
export function los(c: Chunk, grid1: Loc, grid2: Loc): boolean {
  const dy = grid2.y - grid1.y;
  const dx = grid2.x - grid1.x;
  const ay = Math.abs(dy);
  const ax = Math.abs(dx);

  /* Handle adjacent (or identical) grids */
  if (ax < 2 && ay < 2) return true;

  /* Directly South/North */
  if (!dx) {
    if (dy > 0) {
      for (let ty = grid1.y + 1; ty < grid2.y; ty++) {
        if (!c.isProjectable(loc(grid1.x, ty))) return false;
      }
    } else {
      for (let ty = grid1.y - 1; ty > grid2.y; ty--) {
        if (!c.isProjectable(loc(grid1.x, ty))) return false;
      }
    }
    return true;
  }

  /* Directly East/West */
  if (!dy) {
    if (dx > 0) {
      for (let tx = grid1.x + 1; tx < grid2.x; tx++) {
        if (!c.isProjectable(loc(tx, grid1.y))) return false;
      }
    } else {
      for (let tx = grid1.x - 1; tx > grid2.x; tx--) {
        if (!c.isProjectable(loc(tx, grid1.y))) return false;
      }
    }
    return true;
  }

  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;

  /* Vertical and horizontal "knights" */
  if (ax === 1 && ay === 2 && c.isProjectable(loc(grid1.x, grid1.y + sy))) {
    return true;
  } else if (
    ay === 1 &&
    ax === 2 &&
    c.isProjectable(loc(grid1.x + sx, grid1.y))
  ) {
    return true;
  }

  /* Scale factors */
  const f2 = ax * ay;
  const f1 = f2 << 1;

  if (ax >= ay) {
    /* Travel horizontally */
    let qy = ay * ay;
    const m = qy << 1;
    let tx = grid1.x + sx;
    let ty: number;

    if (qy === f2) {
      ty = grid1.y + sy;
      qy -= f1;
    } else {
      ty = grid1.y;
    }

    while (grid2.x - tx) {
      if (!c.isProjectable(loc(tx, ty))) return false;
      qy += m;
      if (qy < f2) {
        tx += sx;
      } else if (qy > f2) {
        ty += sy;
        if (!c.isProjectable(loc(tx, ty))) return false;
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
    let ty = grid1.y + sy;
    let tx: number;

    if (qx === f2) {
      tx = grid1.x + sx;
      qx -= f1;
    } else {
      tx = grid1.x;
    }

    while (grid2.y - ty) {
      if (!c.isProjectable(loc(tx, ty))) return false;
      qx += m;
      if (qx < f2) {
        ty += sy;
      } else if (qx > f2) {
        tx += sx;
        if (!c.isProjectable(loc(tx, ty))) return false;
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

/* ------------------------------------------------------------------ *
 * update_view and its helpers.
 * ------------------------------------------------------------------ */

/** The player fields update_view reads (injected instead of coupled). */
export interface ViewerState {
  grid: Loc;
  /** p->state.cur_light: light radius (negative = darkness source). */
  curLight: number;
  /** p->timed[TMD_BLIND] truthiness. */
  blind: boolean;
  /** player_has(p, PF_UNLIGHT). */
  hasUnlight: boolean;
  /** p->lev, for the UNLIGHT view radius. */
  level: number;
}

/** A non-player light source (upstream scans monsters for these). */
export interface LightSource {
  grid: Loc;
  /** mon->race->light: positive light, negative darkness. */
  light: number;
}

/** z_info fields the view code needs. */
export interface ViewConstants {
  maxSight: number;
  feelingNeed: number;
}

/** motion_dir: keypad direction from start toward finish (5 = none). */
export function motionDir(start: Loc, finish: Loc): number {
  const sx = Math.sign(finish.x - start.x);
  const sy = Math.sign(finish.y - start.y);
  for (let d = 1; d <= 9; d++) {
    const g = DDGRID[d] as Loc;
    if (g.x === sx && g.y === sy) return d;
  }
  return 5;
}

/** next_grid: the grid one step in a keypad direction. */
export function nextGrid(grid: Loc, dir: number): Loc {
  return locSum(grid, DDGRID[dir] as Loc);
}

function isGlow(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE["GLOW"]);
}

function isBrightSquare(c: Chunk, grid: Loc): boolean {
  return featIsBright(c.features, c.feat(grid));
}

/** square_islit: positive light level. */
export function squareIsLit(c: Chunk, grid: Loc): boolean {
  return c.light(grid) > 0;
}

/** square_isview / square_isseen. */
export function squareIsView(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE["VIEW"]);
}

export function squareIsSeen(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE["SEEN"]);
}

/** square_isno_esp: telepathy does not work on this square. */
export function squareIsNoEsp(c: Chunk, grid: Loc): boolean {
  return c.sqinfoHas(grid, SQUARE["NO_ESP"]);
}

/** mark_wasseen. */
function markWasseen(c: Chunk): void {
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (squareIsSeen(c, grid)) c.sqinfoOn(grid, SQUARE["WASSEEN"]);
      c.sqinfoOff(grid, SQUARE["VIEW"]);
      c.sqinfoOff(grid, SQUARE["SEEN"]);
      c.sqinfoOff(grid, SQUARE["CLOSE_PLAYER"]);
    }
  }
}

/** source_can_light_wall. */
function sourceCanLightWall(
  c: Chunk,
  p: ViewerState,
  sgrid: Loc,
  wgrid: Loc,
): boolean {
  const sn = nextGrid(wgrid, motionDir(wgrid, sgrid));
  if (locEq(sn, wgrid)) return true;

  const pn = nextGrid(wgrid, motionDir(wgrid, p.grid));
  if (locEq(pn, wgrid)) return true;

  let cn: Loc;
  if (sn.x === pn.x) {
    if (sn.y === pn.y) return true;
    cn = loc(sn.x, wgrid.y);
  } else if (sn.y === pn.y) {
    cn = loc(wgrid.x, sn.y);
  } else {
    return false;
  }
  return c.allowsLos(cn);
}

/** glow_can_light_wall. */
function glowCanLightWall(c: Chunk, p: ViewerState, wgrid: Loc): boolean {
  const pn = nextGrid(wgrid, motionDir(wgrid, p.grid));
  if (locEq(pn, wgrid)) return true;
  if (c.allowsLos(pn) && isGlow(c, pn)) return true;

  const tryGrid = (chk: Loc): boolean =>
    c.inBounds(chk) &&
    c.allowsLos(chk) &&
    isGlow(c, chk) &&
    sourceCanLightWall(c, p, chk, wgrid);

  if (pn.x !== wgrid.x) {
    if (pn.y !== wgrid.y) {
      if (tryGrid(loc(pn.x, wgrid.y))) return true;
      if (tryGrid(loc(wgrid.x, pn.y))) return true;
    } else {
      if (tryGrid(loc(pn.x, wgrid.y - 1))) return true;
      if (tryGrid(loc(pn.x, wgrid.y + 1))) return true;
    }
  } else {
    if (tryGrid(loc(wgrid.x - 1, pn.y))) return true;
    if (tryGrid(loc(wgrid.x + 1, pn.y))) return true;
  }
  return false;
}

/** add_light: brute-force light source propagation. */
function addLight(
  c: Chunk,
  p: ViewerState,
  sgrid: Loc,
  radius: number,
  inten: number,
): void {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const grid = locSum(sgrid, loc(x, y));
      const dist = distance(sgrid, grid);
      if (!c.inBounds(grid)) continue;
      if (dist > radius) continue;
      if (!los(c, sgrid, grid)) continue;
      if (!c.allowsLos(grid) && !sourceCanLightWall(c, p, sgrid, grid)) {
        continue;
      }
      if (inten > 0) {
        c.setLight(grid, c.light(grid) + inten - dist);
      } else {
        c.setLight(grid, c.light(grid) + inten + dist);
      }
    }
  }
}

/** calc_lighting (monster scan replaced by the injected source list). */
function calcLighting(
  c: Chunk,
  p: ViewerState,
  sources: readonly LightSource[],
  z: ViewConstants,
): void {
  const light = p.curLight;
  const radius = Math.abs(light) - 1;

  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (
        isGlow(c, grid) &&
        (c.allowsLos(grid) || glowCanLightWall(c, p, grid))
      ) {
        c.setLight(grid, 1);
      } else {
        c.setLight(grid, 0);
      }
      if (isBrightSquare(c, grid)) {
        c.setLight(grid, c.light(grid) + 2);
        for (let dir = 0; dir < 8; dir++) {
          const adj = locSum(grid, DDGRID_DDD[dir] as Loc);
          if (!c.inBounds(adj)) continue;
          if (!c.allowsLos(adj) && !sourceCanLightWall(c, p, grid, adj)) {
            continue;
          }
          c.setLight(adj, c.light(adj) + 1);
        }
      }
    }
  }

  addLight(c, p, p.grid, radius, light);

  for (const src of sources) {
    if (!src.light) continue;
    const srcRadius = Math.abs(src.light) - 1;
    if (distance(p.grid, src.grid) - srcRadius > z.maxSight) continue;
    addLight(c, p, src.grid, srcRadius, src.light);
  }
}

/** become_viewable. */
function becomeViewable(
  c: Chunk,
  grid: Loc,
  p: ViewerState,
  close: boolean,
): void {
  if (squareIsView(c, grid)) return;
  c.sqinfoOn(grid, SQUARE["VIEW"]);
  if (close) {
    c.sqinfoOn(grid, SQUARE["SEEN"]);
    c.sqinfoOn(grid, SQUARE["CLOSE_PLAYER"]);
  }
  if (squareIsLit(c, grid)) {
    if (!c.allowsLos(grid)) {
      const x = grid.x;
      const y = grid.y;
      const xc = x < p.grid.x ? x + 1 : x > p.grid.x ? x - 1 : x;
      const yc = y < p.grid.y ? y + 1 : y > p.grid.y ? y - 1 : y;
      if (squareIsLit(c, loc(xc, yc))) {
        c.sqinfoOn(grid, SQUARE["SEEN"]);
      }
    } else {
      c.sqinfoOn(grid, SQUARE["SEEN"]);
    }
  }
}

/** update_view_one. */
function updateViewOne(
  c: Chunk,
  grid: Loc,
  p: ViewerState,
  z: ViewConstants,
): void {
  const x = grid.x;
  const y = grid.y;
  let xc = x;
  let yc = y;

  const d = distance(grid, p.grid);
  let close = d < p.curLight;

  if (d > z.maxSight) return;

  if (p.hasUnlight && p.curLight <= 1) {
    close = d < 2 + Math.trunc(p.level / 6) - p.curLight;
  }

  if (!c.allowsLos(grid)) {
    const dx = x - p.grid.x;
    const dy = y - p.grid.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;

    xc = x < p.grid.x ? x + 1 : x > p.grid.x ? x - 1 : x;
    yc = y < p.grid.y ? y + 1 : y > p.grid.y ? y - 1 : y;

    if (!c.allowsLos(loc(xc, yc))) {
      xc = x;
      yc = y;
    }

    if (ax === 2 && ay === 1) {
      if (c.allowsLos(loc(x - sx, y)) && !c.allowsLos(loc(x - sx, y - sy))) {
        xc = x;
        yc = y;
      }
    } else if (ax === 1 && ay === 2) {
      if (c.allowsLos(loc(x, y - sy)) && !c.allowsLos(loc(x - sx, y - sy))) {
        xc = x;
        yc = y;
      }
    }
  }

  if (los(c, p.grid, loc(xc, yc))) {
    becomeViewable(c, grid, p, close);
  }
}

/**
 * update_one: per-grid post pass. The knowledge side effects (note/light
 * spot) live in the knowledge pass instead: the passive trap reveal that
 * upstream runs here (cave-view.c L840-842 square_reveal_trap on a newly seen
 * grid, gap 10.4) needs the trap subsystem on GameState, which this pure
 * geometry module cannot reach, so it runs from game/known.ts noteSpots
 * (noteSpotRevealTrap) immediately after updateView - same net timing, traps
 * spotted before being stepped on. The flag, feeling-count
 * bookkeeping, and the feeling_need reveal signal are ported (cave-view.c
 * L844-855): a FEEL grid newly seen increments feeling_squares, clears the
 * flag, and at the feeling_need crossing fires the reveal (upstream's
 * display_feeling(true) message is a UI concern - only the "reveal now"
 * signal, GameEvents' `feeling` event, is emitted here). Upstream also
 * guards this on `!p->upkeep->only_partial` (suppressing the redundant
 * reveal right after a fresh level's initial full update); that flag is not
 * modelled, so the event can fire once more than upstream on level entry -
 * a presentation nicety, not a state divergence.
 */
function updateOne(
  c: Chunk,
  grid: Loc,
  p: ViewerState,
  z: ViewConstants,
  events?: GameEvents,
): void {
  if (p.blind) {
    c.sqinfoOff(grid, SQUARE["SEEN"]);
    c.sqinfoOff(grid, SQUARE["CLOSE_PLAYER"]);
  }

  if (squareIsSeen(c, grid) && !c.sqinfoHas(grid, SQUARE["WASSEEN"])) {
    if (c.sqinfoHas(grid, SQUARE["FEEL"])) {
      c.feelingSquares++;
      c.sqinfoOff(grid, SQUARE["FEEL"]);
      if (c.feelingSquares === z.feelingNeed) {
        events?.signal("feeling");
      }
    }
  }

  c.sqinfoOff(grid, SQUARE["WASSEEN"]);
}

/** update_view. */
export function updateView(
  c: Chunk,
  p: ViewerState,
  z: ViewConstants,
  sources: readonly LightSource[] = [],
  events?: GameEvents,
): void {
  markWasseen(c);
  calcLighting(c, p, sources, z);

  c.sqinfoOn(p.grid, SQUARE["VIEW"]);
  if (p.curLight > 0 || squareIsLit(c, p.grid) || p.hasUnlight) {
    c.sqinfoOn(p.grid, SQUARE["SEEN"]);
    c.sqinfoOn(p.grid, SQUARE["CLOSE_PLAYER"]);
  }

  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      updateViewOne(c, loc(x, y), p, z);
    }
  }
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      updateOne(c, loc(x, y), p, z, events);
    }
  }
}
