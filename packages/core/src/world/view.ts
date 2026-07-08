/**
 * Line of sight, ported from reference/src/cave-view.c (Angband 4.2.6).
 *
 * los() is the integer fixed-point algorithm by Joseph Hall: true when a
 * line can be traced between grid centers with every intermediate grid
 * projectable. Reflexive except for the "chess knight move" special
 * cases, exactly as upstream. update_view() (the player FOV) is ported
 * separately; see the parity ledger.
 */

import { loc } from "../loc";
import type { Loc } from "../loc";
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
