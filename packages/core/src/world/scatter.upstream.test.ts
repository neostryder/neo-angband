/**
 * Upstream unit tests from reference/src/tests/cave/scatter.c
 *
 * Mapping:
 * - scatter_ext / scatter -> scatterExt / scatter
 *   (packages/core/src/world/scatter.ts)
 * - square_isstairs / square_isfloor predicates use Chunk feature helpers.
 * - create_empty_cave with permanent border + floor interior mirrors
 *   the C helper via FeatureRegistry + setFeat.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { distance, loc } from "../loc.js";
import type { Loc } from "../loc.js";
import { Rng } from "../rng.js";
import { Chunk } from "./chunk.js";
import { FeatureRegistry } from "./feature.js";
import type { TerrainRecordJson } from "./feature.js";
import { scatter, scatterExt } from "./scatter.js";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const PERM = reg.byCodeName("PERM").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;
const LESS = reg.byCodeName("LESS").fidx;

function createEmptyCave(height: number, width: number): Chunk {
  const c = new Chunk(reg, height, width);
  for (let x = 0; x < width; x++) c.setFeat(loc(x, 0), PERM);
  for (let y = 1; y < height - 1; y++) {
    c.setFeat(loc(0, y), PERM);
    for (let x = 1; x < width - 1; x++) c.setFeat(loc(x, y), FLOOR);
    c.setFeat(loc(width - 1, y), PERM);
  }
  for (let x = 0; x < width; x++) c.setFeat(loc(x, height - 1), PERM);
  return c;
}

function isStairs(c: Chunk, g: Loc): boolean {
  return c.isUpstairs(g) || c.isDownstairs(g);
}
function isFloor(c: Chunk, g: Loc): boolean {
  return c.isFloor(g);
}

describe("cave/scatter (reference/src/tests/cave/scatter.c)", () => {
  // upstream: test_scatter_0
  it("scatter dist=0", () => {
    const c = createEmptyCave(7, 9);
    const rng = new Rng(1);
    let ctr = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));

    let found = scatterExt(c, rng, 9, ctr, 0, false);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(ctr);

    found = scatterExt(c, rng, 9, ctr, 0, true);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(ctr);

    expect(scatter(c, rng, ctr, 0, false)).toEqual(ctr);
    expect(scatter(c, rng, ctr, 0, true)).toEqual(ctr);

    ctr = loc(c.width - 1, -1);
    found = scatterExt(c, rng, 9, ctr, 0, false);
    expect(found.length).toBe(0);
    found = scatterExt(c, rng, 9, ctr, 0, true);
    expect(found.length).toBe(0);
    expect(scatter(c, rng, ctr, 0, false)).toBeNull();
    expect(scatter(c, rng, ctr, 0, true)).toBeNull();
  });

  // upstream: test_scatter_1
  it("scatter dist=1", () => {
    const c = createEmptyCave(7, 9);
    const rng = new Rng(2);
    let ctr = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));

    let found = scatterExt(c, rng, 10, ctr, 1, false);
    expect(found.length).toBe(9);
    for (const g of found) {
      expect(g.x).toBeGreaterThanOrEqual(ctr.x - 1);
      expect(g.x).toBeLessThanOrEqual(ctr.x + 1);
      expect(g.y).toBeGreaterThanOrEqual(ctr.y - 1);
      expect(g.y).toBeLessThanOrEqual(ctr.y + 1);
    }
    expect(new Set(found.map((g) => `${g.x},${g.y}`)).size).toBe(9);

    found = scatterExt(c, rng, 10, ctr, 1, true);
    expect(found.length).toBe(9);

    const one = scatter(c, rng, ctr, 1, false)!;
    expect(one.x).toBeGreaterThanOrEqual(ctr.x - 1);
    expect(one.x).toBeLessThanOrEqual(ctr.x + 1);

    // Corner-in (1,1): only 4 fully-in-bounds grids in the 3x3.
    ctr = loc(1, 1);
    found = scatterExt(c, rng, 10, ctr, 1, false);
    expect(found.length).toBe(4);
    for (const g of found) {
      expect(g.x).toBeGreaterThanOrEqual(ctr.x);
      expect(g.x).toBeLessThanOrEqual(ctr.x + 1);
      expect(g.y).toBeGreaterThanOrEqual(ctr.y);
      expect(g.y).toBeLessThanOrEqual(ctr.y + 1);
    }

    ctr = loc(c.width - 2, 1);
    found = scatterExt(c, rng, 10, ctr, 1, false);
    expect(found.length).toBe(4);

    ctr = loc(1, c.height - 2);
    found = scatterExt(c, rng, 10, ctr, 1, false);
    expect(found.length).toBe(4);

    ctr = loc(c.width - 2, c.height - 2);
    found = scatterExt(c, rng, 10, ctr, 1, false);
    expect(found.length).toBe(4);

    // Absolute corners: only the inward fully-in-bounds neighbour.
    ctr = loc(0, 0);
    found = scatterExt(c, rng, 2, ctr, 1, false);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(loc(1, 1));

    ctr = loc(c.width - 1, 0);
    found = scatterExt(c, rng, 2, ctr, 1, false);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(loc(c.width - 2, 1));

    ctr = loc(0, c.height - 1);
    found = scatterExt(c, rng, 2, ctr, 1, false);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(loc(1, c.height - 2));

    ctr = loc(c.width - 1, c.height - 1);
    found = scatterExt(c, rng, 2, ctr, 1, false);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(loc(c.width - 2, c.height - 2));

    // Far outside: nothing.
    ctr = loc(-1, c.height);
    found = scatterExt(c, rng, 9, ctr, 1, false);
    expect(found.length).toBe(0);
    expect(scatter(c, rng, ctr, 1, false)).toBeNull();
  });

  // upstream: test_scatter_2
  it("scatter dist=2", () => {
    const c = createEmptyCave(7, 9);
    const rng = new Rng(3);
    const ctr = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));

    const found = scatterExt(c, rng, 26, ctr, 2, false);
    expect(found.length).toBe(21);
    for (const g of found) {
      expect(distance(ctr, g)).toBeLessThanOrEqual(2);
    }
    expect(new Set(found.map((g) => `${g.x},${g.y}`)).size).toBe(21);

    const one = scatter(c, rng, ctr, 2, false)!;
    expect(distance(ctr, one)).toBeLessThanOrEqual(2);
  });

  // upstream: test_scatter_los
  it("scatter los", () => {
    const c = createEmptyCave(7, 9);
    const rng = new Rng(4);
    const ctr = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));
    for (let i = 1; i < c.height - 1; i++) {
      c.setFeat(loc(ctr.x - 1, i), GRANITE);
    }
    const found = scatterExt(c, rng, 26, ctr, 2, true);
    expect(found.length).toBe(18);
    for (const g of found) {
      expect(distance(ctr, g)).toBeLessThanOrEqual(2);
      expect(g.x).toBeGreaterThanOrEqual(ctr.x - 1);
    }
  });

  // upstream: test_scatter_pred
  it("scatter pred", () => {
    const c = createEmptyCave(7, 9);
    const rng = new Rng(5);
    const ctr = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));
    for (let y = ctr.y - 2; y <= ctr.y + 2; y++) {
      for (let x = ctr.x - 2; x <= ctr.x + 2; x++) {
        if (c.inBounds(loc(x, y))) c.setFeat(loc(x, y), FLOOR);
      }
    }
    // Place a stair within distance 2 of centre.
    const stair = loc(ctr.x, ctr.y + 1);
    c.setFeat(stair, LESS);

    let found = scatterExt(c, rng, 26, ctr, 2, true, isStairs);
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(stair);

    found = scatterExt(c, rng, 26, ctr, 2, true, isFloor);
    expect(found.length).toBe(20);
    for (const g of found) {
      expect(distance(ctr, g)).toBeLessThanOrEqual(2);
      expect(g).not.toEqual(stair);
    }
  });

  // upstream: test_scatter_distribution (n=9000, Chernoff bound >= 874)
  it("scatter distribution", () => {
    const c = createEmptyCave(7, 9);
    const rng = new Rng(42);
    const ctr = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));
    const counts = new Array<number>(9).fill(0);
    const n = 9000;
    for (let i = 0; i < n; i++) {
      const grid = scatter(c, rng, ctr, 1, false)!;
      const dx = grid.x - ctr.x;
      const dy = grid.y - ctr.y;
      expect(Math.abs(dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      counts[dx + 1 + 3 * (dy + 1)]!++;
    }
    const nexp = Math.trunc(n / 9);
    let dmax = 0;
    for (const cnt of counts) {
      dmax = Math.max(dmax, Math.abs(cnt - nexp));
    }
    expect(nexp - dmax).toBeGreaterThanOrEqual(874);
  });
});
