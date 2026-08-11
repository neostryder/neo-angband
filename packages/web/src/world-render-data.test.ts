import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Glyph, RenderAssetRef } from "./term";
import { projectLiveWorld, type LiveWorldRead, type ResolvedGlyph } from "./world-render-data";
import { glyphWorldFrameSink, teeWorldFrameSink, type WorldFrame } from "./world-view";

const asset = (data: string): RenderAssetRef => ({ kind: "test", data });
const terrain = (id: number, tile?: RenderAssetRef): ResolvedGlyph => ({ ch: ".", attr: id, css: `#${id}`, ...(tile ? { tile } : {}), layer: { kind: "terrain", id, lighting: 2 } });

describe("the production live-world data producer", () => {
  it("keeps the unmodded pre-frame map glyph tuples while teeing the one live frame", () => {
    const floor = asset("floor");
    const rememberedFloor = asset("memory");
    const monster: ResolvedGlyph = { ch: "D", attr: 7, css: "#7", tile: asset("monster"), layer: { kind: "monster", id: 7 } };
    const calls: Array<{ x: number; y: number; glyph: Glyph }> = [];
    let independentFrame: WorldFrame | undefined;
    const frame = projectLiveWorld(reads({
      width: 4,
      size: { width: 4, height: 2 },
      seen: ({ x, y }) => (x === 0 && y === 0) || y === 1,
      knownFeature: ({ x, y }) => y === 0 && (x === 1 || x === 2) ? 5 : -1,
      pathColours: new Map([[0, 12], [1, 13]]),
      terrainAt: () => terrain(4, floor),
      remembered: () => ({ terrain: terrain(5), visual: { ...terrain(5), css: "dim(#5)", tile: rememberedFloor }, terrainAsset: rememberedFloor }),
      rememberedObjectAt: ({ x }) => x === 1 || x === 2 ? "memory" : undefined,
      monsters: new Map([[1, monster], [2, monster], [5, monster]]),
      cursor: { x: 3, y: 0 }, playerGrid: { x: 0, y: 1 },
    }), teeWorldFrameSink(
      glyphWorldFrameSink({ put: (x, y, glyph) => calls.push({ x, y, glyph }) }),
      { present: (value) => { independentFrame = value; } },
    ));

    // This is the unmodded control captured at the old term.put boundary:
    // foreground order, remembered dimness, path tiles, cursor, and player-last.
    expect(calls).toEqual([
      { x: 10, y: 4, glyph: { ch: "*", fg: "#12", bgTile: floor } },
      { x: 11, y: 4, glyph: { ch: "*", fg: "#13" } },
      { x: 12, y: 4, glyph: { ch: "D", fg: "#7", tile: asset("monster"), bgTile: rememberedFloor } },
      { x: 13, y: 4, glyph: { ch: " ", fg: "#000", bg: "#cursor" } },
      { x: 10, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 11, y: 5, glyph: { ch: "D", fg: "#7", tile: asset("monster"), bgTile: floor } },
      { x: 12, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 13, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 10, y: 5, glyph: { ch: "@", fg: "#fff", bgTile: floor } },
    ]);
    expect(independentFrame).toBe(frame);
    expect(independentFrame?.cells).toHaveLength(8);
    expect(independentFrame?.cells[2]).toMatchObject({
      visibility: "remembered", terrain: { id: 5 }, overlays: [{ kind: "object", id: 8 }, { kind: "monster", id: 7 }],
    });
  });

  it("delivers the exact production frame to an independent sink", () => {
    let received: WorldFrame | undefined;
    const frame = projectLiveWorld(reads({}), { present: (value) => { received = value; } });
    expect(received).toBe(frame);
    expect(frame.cells.slice(0, 2)).toMatchObject([
      { grid: { x: 0, y: 0 }, visibility: "seen", terrain: { id: 4 } },
      { grid: { x: 1, y: 0 }, visibility: "remembered", terrain: { id: 5 } },
    ]);
  });

  it("is the producer the live render path calls, rather than a test-only projection", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/const frame = projectLiveWorld\(\{[\s\S]*?\}, glyphWorldFrameSink\(term\)\);/);
    expect(main).toContain("seen: ({ x, y }) => squareIsSeen(state.chunk, loc(x, y))");
    expect(main).toContain("terrainAt: ({ x, y }) => terrainGlyph(x, y, LIGHTING.LOS)");
    expect(main).toContain("monsterGlyph: composeMonster");
  });
});

function reads(overrides: Partial<LiveWorldRead<string, ResolvedGlyph>>): LiveWorldRead<string, ResolvedGlyph> {
  const floor = asset("floor"); const rememberedFloor = asset("memory");
  return {
    width: 3, height: 2, origin: { x: 0, y: 0 }, size: { width: 3, height: 2 }, screenOrigin: { x: 10, y: 4 }, playerGrid: { x: 9, y: 9 }, cursorBackground: "#cursor", unknownForeground: "#000", pathColours: new Map(), gridKey: ({ x, y }) => y * 4 + x, css: (attr) => `#${attr}`,
    seen: ({ x, y }) => x === 0 && y === 0, knownFeature: ({ x, y }) => x === 1 && y === 0 ? 5 : -1,
    remembered: () => ({ terrain: terrain(5), visual: { ...terrain(5), css: "dim(#5)", tile: rememberedFloor }, terrainAsset: rememberedFloor }),
    rememberedObjectAt: ({ x }) => x === 1 ? "memory" : undefined, rememberedObjectGlyph: () => ({ ch: "!", attr: 8, css: "#8", layer: { kind: "object", id: 8 } }), terrainAt: () => terrain(4, floor),
    traps: new Map([[0, { ch: "^", attr: 6, css: "#6", layer: { kind: "trap", id: 6 } }]]), objects: new Map([[0, { ch: "!", attr: 8, css: "#8", layer: { kind: "object", id: 8 } }]]), monsters: new Map(), monsterGlyph: (_under, monster) => monster,
    playerGlyph: () => ({ ch: "@", css: "#fff" }), playerTerrain: () => terrain(4, floor), ...overrides,
  };
}
