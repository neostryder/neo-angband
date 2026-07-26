/**
 * Noise and scent heatmaps from game-world.c (make_noise, update_scent).
 *
 * Noise: a breadth-first flood from the player's grid; lower values are
 * closer to the player, 0 is silence (or the player grid itself). Monsters
 * home in by stepping to adjacent grids with lower noise.
 *
 * Scent: an aging trail; a 5x5 stamp around the player, aged by one each
 * player turn. Grids never visited hold 0.
 *
 * Upstream provenance: reference/src/game-world.c.
 */

import { DDGRID_DDD } from "../loc";
import type { Loc } from "../loc";
import { loc } from "../loc";
import type { Chunk } from "./chunk";
import { featIsNoFlow, featIsNoScent } from "./chunk";

/** The player fields the heatmaps read, injected like ViewerState. */
export interface FlowSource {
  grid: Loc;
  /** True while TMD_COVERTRACKS is active. */
  covertTracks: boolean;
}

/**
 * make_noise: rebuild the noise heatmap by flooding outward from the
 * source. Covered tracks quadruple the per-step noise increment.
 */
export function makeNoise(c: Chunk, p: FlowSource): void {
  const noiseIncrement = p.covertTracks ? 4 : 1;
  const queue: number[] = [];
  let head = 0;

  // Set all the grids to silence. Upstream only clears the interior
  // (borders are permanent walls and never carry flow).
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      c.noise[y * c.width + x] = 0;
    }
  }

  let noise = 0;
  let next = p.grid;
  c.noise[next.y * c.width + next.x] = noise;
  queue.push(next.y * c.width + next.x);
  noise += noiseIncrement;

  while (head < queue.length) {
    const i = queue[head++] as number;
    next = loc(i % c.width, Math.trunc(i / c.width));

    // Reached the current noise level: requeue it and step the level.
    if (c.noise[i] === noise) {
      queue.push(i);
      noise += noiseIncrement;
      continue;
    }

    for (let d = 0; d < 8; d++) {
      const dir = DDGRID_DDD[d] as Loc;
      const g = loc(next.x + dir.x, next.y + dir.y);
      if (!c.inBounds(g)) continue;
      if (featIsNoFlow(c.features, c.feat(g))) continue;
      const gi = g.y * c.width + g.x;
      if (c.noise[gi] !== 0) continue;
      if (g.x === p.grid.x && g.y === p.grid.y) continue;
      c.noise[gi] = noise;
      queue.push(gi);
    }
  }
}

/** The 5x5 stamp of fresh scent strengths centred on the player. */
const SCENT_STRENGTH: readonly (readonly number[])[] = [
  [2, 2, 2, 2, 2],
  [2, 1, 1, 1, 2],
  [2, 1, 0, 1, 2],
  [2, 1, 1, 1, 2],
  [2, 2, 2, 2, 2],
];

/**
 * update_scent: age all existing scent by one, then lay fresh scent in a
 * 5x5 stamp around the player. A stamped grid only takes scent when it is
 * connected to the trail: it is the player grid, or it neighbours a grid
 * whose scent is exactly one fresher (upstream's wall-leak guard).
 */
export function updateScent(c: Chunk, p: FlowSource): void {
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const i = y * c.width + x;
      if ((c.scent[i] as number) > 0) {
        c.scent[i] = (c.scent[i] as number) + 1;
      }
    }
  }

  if (p.covertTracks) return;

  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const newScent = (SCENT_STRENGTH[y] as readonly number[])[
        x
      ] as number;
      const scentGrid = loc(x + p.grid.x - 2, y + p.grid.y - 2);
      if (!c.inBounds(scentGrid)) continue;
      if (featIsNoScent(c.features, c.feat(scentGrid))) continue;

      let addScent = false;
      for (let d = 0; d < 8; d++) {
        const dir = DDGRID_DDD[d] as Loc;
        const adj = loc(scentGrid.x + dir.x, scentGrid.y + dir.y);
        if (!c.inBounds(adj)) continue;
        if (x === 2 && y === 2) addScent = true;
        if (c.scent[adj.y * c.width + adj.x] === newScent - 1) {
          addScent = true;
        }
      }
      if (!addScent) continue;

      c.scent[scentGrid.y * c.width + scentGrid.x] = newScent;
    }
  }
}
