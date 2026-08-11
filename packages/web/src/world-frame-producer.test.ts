import { describe, expect, it } from "vitest";
import type { Glyph, RenderAssetRef } from "./term";
import {
  produceWorldFrame,
  type FrameCellGlyph,
  type WorldFrameProducerParams,
} from "./world-frame-producer";
import { glyphWorldFrameSink, type WorldFrame } from "./world-view";

const asset = (name: string): RenderAssetRef => ({ kind: "test", data: name });
const terrain = (id: number, tile?: RenderAssetRef): FrameCellGlyph => ({
  ch: ".", attr: id, css: `#${id}`, ...(tile ? { tile } : {}),
  layer: { kind: "terrain", id, lighting: 2 },
});

describe("the extracted live world-frame producer", () => {
  it("preserves the pre-frame glyph tuples for every map-info layer", () => {
    const floor = asset("floor");
    const rememberedFloor = asset("remembered-floor");
    const monsterTile = asset("monster");
    const monster: FrameCellGlyph = {
      ch: "D", attr: 7, css: "#7", tile: monsterTile,
      layer: { kind: "monster", id: 7 },
    };
    const calls: Array<{ x: number; y: number; glyph: Glyph }> = [];

    produceWorldFrame(producerParams({
      isSeen: ({ x }) => x === 0,
      pathColours: new Map([[0, 12], [1, 13]]),
      seenTerrain: () => terrain(4, floor),
      rememberedTerrain: () => ({
        terrain: terrain(5),
        drawn: { ...terrain(5), css: "dim(#5)", tile: rememberedFloor },
        tile: rememberedFloor,
      }),
      monsters: new Map([[0, monster], [1, monster]]),
      cursor: { x: 2, y: 1 },
      playerGrid: { x: 0, y: 1 },
    }), glyphWorldFrameSink({ put: (x, y, glyph) => calls.push({ x, y, glyph }) }));

    /* These are the direct pre-Phase-4 CellGlyph -> term.put tuples: visible
     * terrain stays under a path tile, remembered paths stay glyph-only, an
     * unknown cursor is visible, and the player paints last. */
    expect(calls).toEqual([
      { x: 10, y: 4, glyph: { ch: "*", fg: "#12", bgTile: floor } },
      { x: 11, y: 4, glyph: { ch: "*", fg: "#13" } },
      { x: 10, y: 5, glyph: { ch: ".", fg: "#4", tile: floor } },
      { x: 12, y: 5, glyph: { ch: " ", fg: "#000", bg: "#cursor" } },
      { x: 10, y: 5, glyph: { ch: "@", fg: "#fff", bgTile: floor } },
    ]);
  });

  it("hands an independent sink the exact WorldFrame the map repaint produced", () => {
    let received: WorldFrame | undefined;
    const frame = produceWorldFrame(producerParams({}), {
      present: (produced) => { received = produced; },
    });

    expect(received).toBe(frame);
    expect(received?.viewport).toMatchObject({
      origin: { x: 0, y: 0 }, size: { width: 3, height: 2 },
    });
    expect(received?.cells.slice(0, 2)).toMatchObject([
      { grid: { x: 0, y: 0 }, visibility: "seen", terrain: { id: 4 } },
      { grid: { x: 1, y: 0 }, visibility: "remembered", terrain: { id: 5 } },
    ]);
  });
});

function producerParams(overrides: Partial<WorldFrameProducerParams<string, FrameCellGlyph>>): WorldFrameProducerParams<string, FrameCellGlyph> {
  const floor = asset("floor");
  const rememberedFloor = asset("remembered-floor");
  const defaults: WorldFrameProducerParams<string, FrameCellGlyph> = {
    width: 3,
    height: 2,
    origin: { x: 0, y: 0 },
    size: { width: 3, height: 2 },
    screenOrigin: { x: 10, y: 4 },
    playerGrid: { x: 9, y: 9 },
    cursorBackground: "#cursor",
    unknownForeground: "#000",
    pathColours: new Map(),
    gridKey: ({ x, y }) => y * 3 + x,
    colorToCss: (attr) => `#${attr}`,
    isSeen: ({ x, y }) => x === 0 && y === 0,
    knownFeature: ({ x, y }) => x === 1 && y === 0 ? 5 : -1,
    rememberedTerrain: () => ({
      terrain: terrain(5),
      drawn: { ...terrain(5), css: "dim(#5)", tile: rememberedFloor },
      tile: rememberedFloor,
    }),
    knownObjectShown: ({ x }) => x === 1 ? "memory" : undefined,
    rememberedObject: () => ({
      ch: "!", attr: 8, css: "#8", layer: { kind: "object", id: 8 },
    }),
    seenTerrain: () => terrain(4, floor),
    traps: new Map([[0, { ch: "^", attr: 6, css: "#6", layer: { kind: "trap", id: 6 } }]]),
    objects: new Map([[0, { ch: "!", attr: 8, css: "#8", layer: { kind: "object", id: 8 } }]]),
    monsters: new Map(),
    composeMonster: (_under, monster) => monster,
    playerGlyph: () => ({ ch: "@", css: "#fff" }),
    playerTerrain: () => terrain(4, floor),
  };
  return { ...defaults, ...overrides };
}
