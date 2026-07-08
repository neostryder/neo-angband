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
});
