/**
 * scatter / scatter_ext from cave.c: randomly selected locations near a
 * grid, fully in bounds, optionally in line of sight and satisfying a
 * predicate.
 *
 * Upstream provenance: reference/src/cave.c (scatter, scatter_ext).
 */

import { distance } from "../loc";
import type { Loc } from "../loc";
import { loc } from "../loc";
import type { Rng } from "../rng";
import type { Chunk } from "./chunk";
import { los } from "./view";

export type ScatterPred = (c: Chunk, grid: Loc) => boolean;

/**
 * Find up to n distinct random locations within distance d of grid.
 * Mirrors scatter_ext: collect every feasible grid in the (2d+1)^2 box
 * (skipping the exact-distance check when d <= 1, as upstream does),
 * then draw without replacement using rng.randint0.
 */
export function scatterExt(
  c: Chunk,
  rng: Rng,
  n: number,
  grid: Loc,
  d: number,
  needLos: boolean,
  pred?: ScatterPred,
): Loc[] {
  const feas: Loc[] = [];
  for (let y = grid.y - d; y <= grid.y + d; y++) {
    for (let x = grid.x - d; x <= grid.x + d; x++) {
      const g = loc(x, y);
      if (!c.inBoundsFully(g)) continue;
      if (d > 1 && distance(grid, g) > d) continue;
      if (needLos && !los(c, grid, g)) continue;
      if (pred && !pred(c, g)) continue;
      feas.push(g);
    }
  }

  const places: Loc[] = [];
  let nfeas = feas.length;
  while (places.length < n && nfeas > 0) {
    const choice = rng.randint0(nfeas);
    // feas entries below nfeas are always defined; the picked one is
    // replaced by the last feasible entry, exactly as upstream shifts.
    places.push(feas[choice] as Loc);
    nfeas--;
    feas[choice] = feas[nfeas] as Loc;
  }
  return places;
}

/**
 * scatter: the single-location convenience wrapper. Returns the found
 * location, or null when no feasible grid exists (upstream leaves the
 * output loc untouched in that case; callers there always pre-fill it).
 */
export function scatter(
  c: Chunk,
  rng: Rng,
  grid: Loc,
  d: number,
  needLos: boolean,
): Loc | null {
  const found = scatterExt(c, rng, 1, grid, d, needLos);
  return found.length > 0 ? (found[0] as Loc) : null;
}
