import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SQUARE } from "../generated";
import { loc } from "../loc";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;
const PERM = reg.byCodeName("PERM").fidx;
const RUBBLE = reg.byCodeName("RUBBLE").fidx;
const LESS = reg.byCodeName("LESS").fidx;
const MORE = reg.byCodeName("MORE").fidx;
const MAGMA = reg.byCodeName("MAGMA").fidx;
const OPEN = reg.byCodeName("OPEN").fidx;
const CLOSED = reg.byCodeName("CLOSED").fidx;
const LAVA = reg.byCodeName("LAVA").fidx;

describe("Chunk", () => {
  it("tracks feature counts through setFeat", () => {
    const c = new Chunk(reg, 5, 7);
    c.setFeat(loc(1, 1), FLOOR);
    c.setFeat(loc(2, 1), FLOOR);
    c.setFeat(loc(3, 1), GRANITE);
    expect(c.featCount[FLOOR]).toBe(2);
    expect(c.featCount[GRANITE]).toBe(1);
    c.setFeat(loc(1, 1), GRANITE);
    expect(c.featCount[FLOOR]).toBe(1);
    expect(c.featCount[GRANITE]).toBe(2);
  });

  it("bounds checks match upstream semantics", () => {
    const c = new Chunk(reg, 4, 4);
    expect(c.inBounds(loc(0, 0))).toBe(true);
    expect(c.inBounds(loc(4, 0))).toBe(false);
    expect(c.inBoundsFully(loc(0, 0))).toBe(false);
    expect(c.inBoundsFully(loc(1, 1))).toBe(true);
    expect(c.inBoundsFully(loc(3, 3))).toBe(false);
    expect(() => c.feat(loc(-1, 0))).toThrow(RangeError);
    // isProjectable is false OOB rather than throwing, like upstream.
    expect(c.isProjectable(loc(99, 99))).toBe(false);
    expect(() => c.isPassable(loc(99, 99))).toThrow(RangeError);
  });

  it("classifies terrain exactly like the cave-square predicates", () => {
    const c = new Chunk(reg, 8, 8);
    const g = loc(2, 2);

    c.setFeat(g, FLOOR);
    expect(c.isFloor(g)).toBe(true);
    expect(c.isPassable(g)).toBe(true);
    expect(c.isProjectable(g)).toBe(true);
    expect(c.allowsLos(g)).toBe(true);
    expect(c.isWall(g)).toBe(false);

    c.setFeat(g, GRANITE);
    expect(c.isGranite(g)).toBe(true);
    expect(c.isMineralWall(g)).toBe(true);
    expect(c.isPerm(g)).toBe(false);
    expect(c.allowsLos(g)).toBe(false);

    c.setFeat(g, PERM);
    expect(c.isPerm(g)).toBe(true);

    c.setFeat(g, RUBBLE);
    expect(c.isRubble(g)).toBe(true);
    expect(c.isWall(g)).toBe(false);

    c.setFeat(g, MAGMA);
    expect(c.isMagma(g)).toBe(true);

    c.setFeat(g, LESS);
    expect(c.isStairs(g)).toBe(true);
    expect(c.isUpstairs(g)).toBe(true);
    expect(c.isDownstairs(g)).toBe(false);

    c.setFeat(g, MORE);
    expect(c.isDownstairs(g)).toBe(true);

    c.setFeat(g, OPEN);
    expect(c.isDoor(g)).toBe(true);
    expect(c.isClosedDoor(g)).toBe(false);
    expect(c.isPassable(g)).toBe(true);

    c.setFeat(g, CLOSED);
    expect(c.isClosedDoor(g)).toBe(true);
    expect(c.allowsLos(g)).toBe(false);
  });

  it("bright terrain glows on placement", () => {
    const c = new Chunk(reg, 4, 4);
    const g = loc(1, 1);
    c.setFeat(g, LAVA);
    expect(c.isFiery(g)).toBe(true);
    expect(c.sqinfoHas(g, SQUARE["GLOW"])).toBe(true);
    // Floor placement does not glow by itself.
    const g2 = loc(2, 2);
    c.setFeat(g2, FLOOR);
    expect(c.sqinfoHas(g2, SQUARE["GLOW"])).toBe(false);
  });

  it("square info flags and monster slots are per-square", () => {
    const c = new Chunk(reg, 4, 4);
    c.sqinfoOn(loc(1, 1), SQUARE["ROOM"]);
    expect(c.sqinfoHas(loc(1, 1), SQUARE["ROOM"])).toBe(true);
    expect(c.sqinfoHas(loc(2, 1), SQUARE["ROOM"])).toBe(false);
    c.sqinfoOff(loc(1, 1), SQUARE["ROOM"]);
    expect(c.sqinfoHas(loc(1, 1), SQUARE["ROOM"])).toBe(false);

    c.setMon(loc(3, 3), 17);
    expect(c.mon(loc(3, 3))).toBe(17);
    expect(c.mon(loc(2, 3))).toBe(0);
  });

  it("fill covers the chunk and counts every square", () => {
    const c = new Chunk(reg, 6, 9);
    c.fill(GRANITE);
    expect(c.featCount[GRANITE]).toBe(54);
    expect(c.isGranite(loc(8, 5))).toBe(true);
  });

  it("allowsFeel (square_allowsfeel): passable and not damaging", () => {
    const c = new Chunk(reg, 4, 4);
    c.setFeat(loc(1, 1), FLOOR);
    expect(c.allowsFeel(loc(1, 1))).toBe(true);

    c.setFeat(loc(2, 1), GRANITE);
    expect(c.allowsFeel(loc(2, 1))).toBe(false); // impassable

    c.setFeat(loc(3, 1), LAVA);
    expect(c.isPassable(loc(3, 1))).toBe(true);
    expect(c.isDamaging(loc(3, 1))).toBe(true);
    expect(c.allowsFeel(loc(3, 1))).toBe(false); // passable but damaging
  });

  it("addToMonsterRating / addToObjRating accumulate and saturate at UINT32_MAX", () => {
    const c = new Chunk(reg, 4, 4);
    expect(c.monRating).toBe(0);
    expect(c.objRating).toBe(0);

    c.addToMonsterRating(100);
    c.addToMonsterRating(25);
    expect(c.monRating).toBe(125);

    c.addToObjRating(64);
    c.addToObjRating(36);
    expect(c.objRating).toBe(100);

    const UINT32_MAX = 4294967295;
    c.monRating = UINT32_MAX - 5;
    c.addToMonsterRating(1000);
    expect(c.monRating).toBe(UINT32_MAX);

    c.objRating = UINT32_MAX - 5;
    c.addToObjRating(1000);
    expect(c.objRating).toBe(UINT32_MAX);
  });

  describe("bug-fixes #4605 - noise/scent save via snapshotSquares(includeFlow)", () => {
    function chunkWithFlow(): Chunk {
      const c = new Chunk(reg, 5, 5);
      c.fill(FLOOR);
      c.noise[2 * 5 + 2] = 7;
      c.noise[2 * 5 + 3] = 9;
      c.scent[2 * 5 + 2] = 3;
      c.scent[3 * 5 + 2] = 5;
      return c;
    }

    it("faithful (includeFlow=false): omits heatmaps; restore leaves them zeroed", () => {
      const src = chunkWithFlow();
      const data = src.snapshotSquares();
      expect(data.noise).toBeUndefined();
      expect(data.scent).toBeUndefined();

      const dst = new Chunk(reg, 5, 5);
      dst.restoreSquares(data);
      expect(Array.from(dst.noise).every((v) => v === 0)).toBe(true);
      expect(Array.from(dst.scent).every((v) => v === 0)).toBe(true);
    });

    it("corrected (includeFlow=true): persists and restores both heatmaps exactly", () => {
      const src = chunkWithFlow();
      const data = src.snapshotSquares(true);
      expect(data.noise).toEqual(Array.from(src.noise));
      expect(data.scent).toEqual(Array.from(src.scent));

      const dst = new Chunk(reg, 5, 5);
      dst.restoreSquares(data);
      expect(Array.from(dst.noise)).toEqual(Array.from(src.noise));
      expect(Array.from(dst.scent)).toEqual(Array.from(src.scent));
    });
  });
});
