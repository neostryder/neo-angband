/**
 * Upstream unit tests from reference/src/tests/cave/find.c
 *
 * Mapping:
 * - cave_find / cave_find_in_range / find_nearby_grid / cave_find_init
 *   -> caveFind / caveFindInRange / findNearbyGrid / CaveFinder
 *   (packages/core/src/gen/util.ts)
 * - square_isroom -> Chunk.sqinfoHas(SQUARE.ROOM)
 * - square_in_bounds / square_in_bounds_fully -> Chunk.inBounds / inBoundsFully
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { SQUARE } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { Rng } from "../rng";
import { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import {
  CaveFinder,
  caveFind,
  caveFindInRange,
  findNearbyGrid,
} from "./util";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };
const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;

function isRoom(c: Chunk, g: Loc): boolean {
  return c.sqinfoHas(g, SQUARE.ROOM);
}

describe("cave/find (reference/src/tests/cave/find.c)", () => {
  // upstream: test_cave_find_0
  it("cave_find 0", () => {
    const c = new Chunk(reg, 11, 9);
    c.fill(FLOOR);
    const rng = new Rng(1);

    expect(caveFind(c, rng, isRoom)).toBeNull();

    const targets: Loc[] = [
      loc(0, 0),
      loc(c.width - 1, 0),
      loc(0, c.height - 1),
      loc(c.width - 1, c.height - 1),
    ];
    for (const target of targets) {
      c.sqinfoOn(target, SQUARE.ROOM);
      const found = caveFind(c, rng, isRoom);
      expect(found).toEqual(target);
      c.sqinfoOff(target, SQUARE.ROOM);
    }

    // Mid-edge and interior single-room finds.
    for (const target of [
      loc(1 + rng.randint0(c.width - 2), 0),
      loc(1 + rng.randint0(c.width - 2), c.height - 1),
      loc(1 + rng.randint0(c.width - 2), 1 + rng.randint0(c.height - 2)),
      loc(0, 1 + rng.randint0(c.height - 2)),
      loc(c.width - 1, 1 + rng.randint0(c.height - 2)),
    ]) {
      c.sqinfoOn(target, SQUARE.ROOM);
      expect(caveFind(c, rng, isRoom)).toEqual(target);
      c.sqinfoOff(target, SQUARE.ROOM);
    }
  });

  // upstream: test_cave_find_in_range_0
  it("cave_find_in_range 0", () => {
    const c = new Chunk(reg, 11, 9);
    c.fill(FLOOR);
    const rng = new Rng(2);

    let ul = loc(-3, -2);
    let br = loc(0, 0);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBoundsFully(g)),
    ).toBeNull();
    expect(caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBounds(g))).toEqual(
      br,
    );

    ul = loc(c.width - 1, -1);
    br = loc(c.width + 5, 0);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBoundsFully(g)),
    ).toBeNull();
    expect(caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBounds(g))).toEqual(
      loc(c.width - 1, 0),
    );

    ul = loc(-1, c.height - 1);
    br = loc(0, c.height + 2);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBoundsFully(g)),
    ).toBeNull();
    expect(caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBounds(g))).toEqual(
      loc(0, c.height - 1),
    );

    ul = loc(c.width - 1, c.height - 1);
    br = loc(c.width + 2, c.height + 3);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBoundsFully(g)),
    ).toBeNull();
    expect(caveFindInRange(c, rng, ul, br, (cc, g) => cc.inBounds(g))).toEqual(
      ul,
    );

    ul = loc(0, 0);
    br = loc(c.width - 1, c.height - 1);
    let g = caveFindInRange(c, rng, ul, br, (cc, gr) => cc.inBounds(gr))!;
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.x).toBeLessThan(c.width);
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeLessThan(c.height);
    g = caveFindInRange(c, rng, ul, br, (cc, gr) => cc.inBoundsFully(gr))!;
    expect(g.x).toBeGreaterThanOrEqual(1);
    expect(g.x).toBeLessThan(c.width - 1);
    expect(g.y).toBeGreaterThanOrEqual(1);
    expect(g.y).toBeLessThan(c.height - 1);

    // Empty search ranges (ul past br).
    ul = loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));
    br = loc(ul.x - 3, ul.y + 3);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, gr) => cc.inBounds(gr)),
    ).toBeNull();
    br = loc(ul.x + 4, ul.y - 2);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, gr) => cc.inBounds(gr)),
    ).toBeNull();
    br = loc(ul.x - 2, ul.y - 4);
    expect(
      caveFindInRange(c, rng, ul, br, (cc, gr) => cc.inBounds(gr)),
    ).toBeNull();
  });

  // upstream: test_find_nearby_grid_0
  it("find_nearby_grid 0", () => {
    const c = new Chunk(reg, 11, 9);
    c.fill(FLOOR);
    const rng = new Rng(3);

    expect(findNearbyGrid(c, rng, loc(-4, -3), 2, 3)).toBeNull();
    expect(findNearbyGrid(c, rng, loc(c.width + 2, 1), 3, 1)).toBeNull();
    expect(findNearbyGrid(c, rng, loc(-3, c.height + 4), 4, 2)).toBeNull();
    expect(
      findNearbyGrid(c, rng, loc(c.width + 2, c.height + 1), 1, 2),
    ).toBeNull();

    let g = findNearbyGrid(c, rng, loc(Math.trunc(c.width / 2), -1), 2, 1)!;
    expect(g.x).toBeGreaterThanOrEqual(Math.trunc(c.width / 2) - 1);
    expect(g.x).toBeLessThanOrEqual(Math.trunc(c.width / 2) + 1);
    expect(g.y).toBe(1);

    g = findNearbyGrid(c, rng, loc(Math.trunc(c.width / 2), c.height + 1), 3, 1)!;
    expect(g.x).toBeGreaterThanOrEqual(Math.trunc(c.width / 2) - 1);
    expect(g.x).toBeLessThanOrEqual(Math.trunc(c.width / 2) + 1);
    expect(g.y).toBe(c.height - 2);

    g = findNearbyGrid(c, rng, loc(-1, Math.trunc(c.height / 2)), 1, 2)!;
    expect(g.x).toBe(1);
    expect(g.y).toBeGreaterThanOrEqual(Math.trunc(c.height / 2) - 1);
    expect(g.y).toBeLessThanOrEqual(Math.trunc(c.height / 2) + 1);

    g = findNearbyGrid(c, rng, loc(c.width + 2, Math.trunc(c.height / 2)), 1, 4)!;
    expect(g.x).toBe(c.width - 2);
    expect(g.y).toBeGreaterThanOrEqual(Math.trunc(c.height / 2) - 1);
    expect(g.y).toBeLessThanOrEqual(Math.trunc(c.height / 2) + 1);
  });

  // upstream: test_unbundled_find_0
  it("unbundled find 0", () => {
    const c = new Chunk(reg, 11, 9);
    c.fill(FLOOR);
    const rng = new Rng(4);
    let invalid = false;

    const finder = new CaveFinder(loc(1, 1), loc(c.width - 2, c.height - 2));
    for (;;) {
      const grid = finder.get(rng);
      if (!grid) break;
      if (c.inBoundsFully(grid) && !isRoom(c, grid)) {
        c.sqinfoOn(grid, SQUARE.ROOM);
      } else {
        invalid = true;
      }
    }

    for (let y = 1; y < c.height - 1; y++) {
      for (let x = 1; x < c.width - 1; x++) {
        if (!isRoom(c, loc(x, y))) invalid = true;
      }
    }

    finder.reset();
    for (;;) {
      const grid = finder.get(rng);
      if (!grid) break;
      if (c.inBoundsFully(grid) && isRoom(c, grid)) {
        c.sqinfoOff(grid, SQUARE.ROOM);
      } else {
        invalid = true;
      }
    }

    for (let y = 1; y < c.height - 1; y++) {
      for (let x = 1; x < c.width - 1; x++) {
        if (isRoom(c, loc(x, y))) invalid = true;
      }
    }

    expect(invalid).toBe(false);
  });
});
