import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { Rng } from "../rng";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";
import { los } from "./view";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;

function openChunk(w: number, h: number): Chunk {
  const c = new Chunk(reg, h, w);
  c.fill(FLOOR);
  return c;
}

describe("los", () => {
  it("is true for identical and adjacent grids regardless of terrain", () => {
    const c = new Chunk(reg, 5, 5);
    c.fill(GRANITE);
    expect(los(c, loc(2, 2), loc(2, 2))).toBe(true);
    expect(los(c, loc(2, 2), loc(3, 3))).toBe(true);
    expect(los(c, loc(2, 2), loc(1, 2))).toBe(true);
  });

  it("sees along clear rows, columns, and diagonals", () => {
    const c = openChunk(20, 20);
    expect(los(c, loc(1, 5), loc(15, 5))).toBe(true);
    expect(los(c, loc(5, 1), loc(5, 15))).toBe(true);
    expect(los(c, loc(1, 1), loc(12, 12))).toBe(true);
    expect(los(c, loc(15, 3), loc(2, 11))).toBe(true);
  });

  it("walls block straight and sloped lines", () => {
    const c = openChunk(20, 20);
    c.setFeat(loc(8, 5), GRANITE);
    expect(los(c, loc(1, 5), loc(15, 5))).toBe(false);
    // Around the wall the sight remains.
    expect(los(c, loc(1, 5), loc(8, 12))).toBe(true);

    const d = openChunk(20, 20);
    d.setFeat(loc(6, 6), GRANITE);
    expect(los(d, loc(1, 1), loc(12, 12))).toBe(false);
  });

  it("handles the knight-move special case like upstream", () => {
    // ax == 1, ay == 2: only the grid one step along y must be clear.
    const c = openChunk(10, 10);
    c.setFeat(loc(5, 6), GRANITE);
    // Start (5,5) -> (6,7): sy = 1, checks (5,6)... blocked.
    expect(los(c, loc(5, 5), loc(6, 7))).toBe(false);
    const d = openChunk(10, 10);
    d.setFeat(loc(6, 6), GRANITE); // the diagonal grid may be obstructed
    expect(los(d, loc(5, 5), loc(6, 7))).toBe(true);
  });

  it("is symmetric on random maps (except knight moves)", () => {
    const rng = new Rng(0xc0ffee);
    for (let trial = 0; trial < 5; trial++) {
      const c = openChunk(24, 24);
      for (let i = 0; i < 120; i++) {
        c.setFeat(loc(rng.randint0(24), rng.randint0(24)), GRANITE);
      }
      for (let i = 0; i < 300; i++) {
        const a = loc(rng.randint0(24), rng.randint0(24));
        const b = loc(rng.randint0(24), rng.randint0(24));
        const ax = Math.abs(a.x - b.x);
        const ay = Math.abs(a.y - b.y);
        const knight =
          (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
        if (knight) continue;
        expect(los(c, a, b)).toBe(los(c, b, a));
      }
    }
  });

  it("endpoints may be walls; only intermediate grids block", () => {
    const c = openChunk(12, 12);
    c.setFeat(loc(9, 5), GRANITE);
    // Looking AT a wall from distance along a clear row is fine.
    expect(los(c, loc(1, 5), loc(9, 5))).toBe(true);
    // Looking THROUGH it is not.
    expect(los(c, loc(1, 5), loc(11, 5))).toBe(false);
  });
});
