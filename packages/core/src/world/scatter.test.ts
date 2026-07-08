import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { distance, loc } from "../loc";
import { Rng } from "../rng";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";
import { scatter, scatterExt } from "./scatter";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;

function openField(w: number, h: number): Chunk {
  const c = new Chunk(reg, h, w);
  c.fill(FLOOR);
  return c;
}

describe("scatterExt", () => {
  it("finds only grids within distance d, fully in bounds", () => {
    const c = openField(30, 20);
    const rng = new Rng(42);
    const origin = loc(10, 10);
    const found = scatterExt(c, rng, 500, origin, 3, false);
    expect(found.length).toBeGreaterThan(0);
    for (const g of found) {
      expect(distance(origin, g)).toBeLessThanOrEqual(3);
      expect(c.inBoundsFully(g)).toBe(true);
    }
  });

  it("d <= 1 skips the distance check, exactly like upstream", () => {
    // Upstream only applies the distance filter when d > 1, so d = 1
    // accepts the full 3x3 box even though diagonal distance is 1 anyway.
    const c = openField(30, 20);
    const rng = new Rng(1);
    const found = scatterExt(c, rng, 500, loc(10, 10), 1, false);
    expect(found.length).toBe(9);
  });

  it("draws distinct grids without replacement", () => {
    const c = openField(30, 20);
    const rng = new Rng(7);
    const found = scatterExt(c, rng, 500, loc(10, 10), 2, false);
    const keys = new Set(found.map((g) => `${g.x},${g.y}`));
    expect(keys.size).toBe(found.length);
  });

  it("respects line of sight when asked", () => {
    const c = openField(30, 20);
    // Wall column at x = 12 blocks everything east of it.
    for (let y = 0; y < 20; y++) c.setFeat(loc(12, y), GRANITE);
    const rng = new Rng(3);
    const found = scatterExt(c, rng, 500, loc(10, 10), 5, true);
    expect(found.length).toBeGreaterThan(0);
    for (const g of found) {
      expect(g.x).toBeLessThanOrEqual(12);
    }
  });

  it("applies the predicate filter", () => {
    const c = openField(30, 20);
    const rng = new Rng(9);
    const found = scatterExt(c, rng, 500, loc(10, 10), 4, false, (ch, g) =>
      ch.feat(g) === FLOOR && g.x % 2 === 0,
    );
    expect(found.length).toBeGreaterThan(0);
    for (const g of found) {
      expect(g.x % 2).toBe(0);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const c = openField(30, 20);
    const a = scatterExt(c, new Rng(123), 5, loc(10, 10), 4, false);
    const b = scatterExt(c, new Rng(123), 5, loc(10, 10), 4, false);
    expect(a).toEqual(b);
  });
});

describe("scatter", () => {
  it("returns one nearby grid, or null when nothing is feasible", () => {
    const c = openField(30, 20);
    const rng = new Rng(5);
    const g = scatter(c, rng, loc(10, 10), 2, false);
    expect(g).not.toBeNull();
    if (g) expect(distance(loc(10, 10), g)).toBeLessThanOrEqual(2);

    // An origin whose whole box is out of full bounds yields nothing.
    const edge = scatterExt(c, rng, 1, loc(0, 0), 0, false);
    expect(edge.length).toBe(0);
  });
});
