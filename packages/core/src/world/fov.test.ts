import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SQUARE } from "../generated";
import { loc } from "../loc";
import { Chunk } from "./chunk";
import { FeatureRegistry } from "./feature";
import type { TerrainRecordJson } from "./feature";
import { squareIsSeen, squareIsView, updateView } from "./view";
import type { ViewConstants, ViewerState } from "./view";

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };

const reg = new FeatureRegistry(terrain.records);
const FLOOR = reg.byCodeName("FLOOR").fidx;
const GRANITE = reg.byCodeName("GRANITE").fidx;

const Z: ViewConstants = { maxSight: 20, feelingNeed: 10 };

function viewer(x: number, y: number, over?: Partial<ViewerState>): ViewerState {
  return {
    grid: loc(x, y),
    curLight: 2,
    blind: false,
    hasUnlight: false,
    level: 1,
    ...over,
  };
}

/** A dark cave filled with granite, with a floor room carved out. */
function room(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Chunk {
  const c = new Chunk(reg, h, w);
  c.fill(GRANITE);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      c.setFeat(loc(x, y), FLOOR);
    }
  }
  return c;
}

function glowRect(c: Chunk, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      c.sqinfoOn(loc(x, y), SQUARE["GLOW"]);
    }
  }
}

describe("updateView", () => {
  it("a torch in the dark sees only within its radius", () => {
    const c = room(30, 20, 1, 1, 28, 18);
    const p = viewer(10, 10, { curLight: 3 });
    updateView(c, p, Z);
    expect(squareIsSeen(c, loc(10, 10))).toBe(true);
    expect(squareIsSeen(c, loc(12, 10))).toBe(true);
    // Beyond the torch radius, floor is in view but not seen (dark).
    expect(squareIsView(c, loc(18, 10))).toBe(true);
    expect(squareIsSeen(c, loc(18, 10))).toBe(false);
  });

  it("a glowing room is fully seen on entry", () => {
    const c = room(30, 20, 5, 5, 15, 12);
    glowRect(c, 5, 5, 15, 12);
    const p = viewer(6, 6, { curLight: 1 });
    updateView(c, p, Z);
    expect(squareIsSeen(c, loc(15, 12))).toBe(true);
    expect(squareIsSeen(c, loc(5, 12))).toBe(true);
  });

  it("walls block view into unlit side corridors", () => {
    const c = room(30, 20, 1, 1, 28, 18);
    // Wall off a chamber at x >= 20 with a single gap far from the viewer.
    for (let y = 1; y <= 18; y++) c.setFeat(loc(20, y), GRANITE);
    const p = viewer(5, 10, { curLight: 3 });
    updateView(c, p, Z);
    // Behind the wall: not in view.
    expect(squareIsView(c, loc(22, 10))).toBe(false);
    expect(squareIsSeen(c, loc(22, 10))).toBe(false);
  });

  it("blind viewers see nothing, even in glowing rooms", () => {
    const c = room(30, 20, 5, 5, 15, 12);
    glowRect(c, 5, 5, 15, 12);
    const p = viewer(6, 6, { blind: true });
    updateView(c, p, Z);
    for (let y = 5; y <= 12; y++) {
      for (let x = 5; x <= 15; x++) {
        expect(squareIsSeen(c, loc(x, y))).toBe(false);
      }
    }
  });

  it("lit wall faces are seen; back faces are not", () => {
    const c = room(30, 20, 1, 1, 28, 18);
    for (let y = 1; y <= 18; y++) c.setFeat(loc(20, y), GRANITE);
    // Room lighting glows the room floor AND its bounding walls, as
    // upstream light_room does.
    glowRect(c, 1, 1, 20, 18);
    const p = viewer(10, 10, { curLight: 2 });
    updateView(c, p, Z);
    // The wall's near face is visible from the lit side.
    expect(squareIsSeen(c, loc(20, 10))).toBe(true);
    // A floor grid beyond the wall stays unseen.
    expect(squareIsSeen(c, loc(21, 10))).toBe(false);
  });

  it("feeling squares count once when newly seen", () => {
    const c = room(30, 20, 5, 5, 15, 12);
    glowRect(c, 5, 5, 15, 12);
    c.sqinfoOn(loc(7, 7), SQUARE["FEEL"]);
    c.sqinfoOn(loc(8, 7), SQUARE["FEEL"]);
    const p = viewer(6, 6);
    updateView(c, p, Z);
    expect(c.feelingSquares).toBe(2);
    updateView(c, p, Z);
    expect(c.feelingSquares).toBe(2);
  });
});
