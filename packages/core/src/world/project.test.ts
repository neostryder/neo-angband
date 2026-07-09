import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";
import { PROJECT, projectPath, projectable } from "./project";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;

/** An all-floor chunk of the given size (Chunk takes height, width). */
function floorChunk(w = 20, h = 14): Chunk {
  const c = new Chunk(reg, h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) c.setFeat(loc(x, y), FLOOR);
  }
  return c;
}

/** Path as [x,y] pairs for easy comparison. */
function coords(c: Chunk, range: number, a: [number, number], b: [number, number], flg = 0) {
  return projectPath(c, range, loc(a[0], a[1]), loc(b[0], b[1]), flg).map(
    (g) => [g.x, g.y] as [number, number],
  );
}

describe("project_path (project.c)", () => {
  it("is empty when source and target coincide", () => {
    expect(coords(floorChunk(), 20, [5, 5], [5, 5])).toEqual([]);
  });

  it("walks a straight horizontal line, ending on the target", () => {
    expect(coords(floorChunk(), 20, [2, 7], [6, 7])).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
      [6, 7],
    ]);
  });

  it("walks a pure diagonal one step per grid", () => {
    expect(coords(floorChunk(), 20, [2, 2], [6, 6])).toEqual([
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]);
  });

  it("matches the hand-derived slope walk for a 4:2 bolt", () => {
    // (0,0) -> (4,2): horizontal-major slope walk.
    expect(coords(floorChunk(), 20, [0, 0], [4, 2])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
  });

  it("includes and stops at a wall grid in the way", () => {
    const c = floorChunk();
    c.setFeat(loc(5, 7), GRANITE);
    // The bolt reaches the wall (included as the last grid) and stops there.
    expect(coords(c, 20, [2, 7], [9, 7])).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
    ]);
  });

  it("stops at an intervening monster only with PROJECT_STOP", () => {
    const c = floorChunk();
    c.setMon(loc(5, 7), 3);
    // Without STOP, the monster does not halt the path.
    expect(coords(c, 20, [2, 7], [7, 7]).at(-1)).toEqual([7, 7]);
    // With STOP, the path halts on the monster's grid.
    expect(coords(c, 20, [2, 7], [7, 7], PROJECT.STOP)).toEqual([
      [3, 7],
      [4, 7],
      [5, 7],
    ]);
  });

  it("respects the range limit", () => {
    // Range 3 truncates a would-be longer horizontal path.
    expect(coords(floorChunk(), 3, [2, 7], [12, 7]).length).toBeLessThanOrEqual(3);
  });
});

describe("projectable (project.c)", () => {
  it("is true for a clear line to the target and false through a wall", () => {
    const c = floorChunk();
    expect(projectable(c, loc(2, 7), loc(9, 7), 0, 20)).toBe(true);
    c.setFeat(loc(5, 7), GRANITE);
    expect(projectable(c, loc(2, 7), loc(9, 7), 0, 20)).toBe(false);
  });

  it("is never projectable from a grid to itself", () => {
    expect(projectable(floorChunk(), loc(4, 4), loc(4, 4), 0, 20)).toBe(false);
  });
});
