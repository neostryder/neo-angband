import { describe, expect, it } from "vitest";
import type { Glyph, RenderAssetRef } from "./term";
import {
  backgroundAssetForWorldCell,
  glyphWorldFrameSink,
  renderWorldFrame,
  type WorldCell,
} from "./world-view";

describe("the live WorldFrame render path", () => {
  it("streams the in-bounds viewport in row order with semantic layers intact", () => {
    const seen: WorldCell[] = [];
    const frames: WorldCell[][] = [];
    const frame = renderWorldFrame({
      width: 3,
      height: 2,
      origin: { x: -1, y: 0 },
      size: { width: 3, height: 2 },
      screenOrigin: { x: 10, y: 4 },
      resolveCell: (grid, screen) => {
        const cell: WorldCell = {
          grid,
          screen,
          visibility: grid.x === 1 ? "remembered" : "seen",
          terrain: { kind: "terrain", id: 17, lighting: 2 },
          overlays: grid.x === 1 ? [{ kind: "monster", id: 42 }] : [],
          cursor: grid.x === 1 && grid.y === 0,
        };
        seen.push(cell);
        return cell;
      },
      player: {
        grid: { x: 1, y: 1 },
        screen: { x: 12, y: 5 },
        layer: { kind: "player", id: 0 },
        visual: { ch: "@", fg: "#fff" },
        cursor: false,
      },
    }, { present: (produced) => frames.push([...produced.cells]) });

    expect(seen.map((c) => [c.grid, c.screen])).toEqual([
      [{ x: 0, y: 0 }, { x: 11, y: 4 }],
      [{ x: 1, y: 0 }, { x: 12, y: 4 }],
      [{ x: 0, y: 1 }, { x: 11, y: 5 }],
      [{ x: 1, y: 1 }, { x: 12, y: 5 }],
    ]);
    expect(frame.cells[1]).toMatchObject({
      visibility: "remembered",
      terrain: { kind: "terrain", id: 17, lighting: 2 },
      overlays: [{ kind: "monster", id: 42 }],
      cursor: true,
    });
    expect(frame.player).toMatchObject({ layer: { kind: "player", id: 0 } });
    expect(frames).toEqual([[...frame.cells]]);
  });
});

describe("the live WorldFrame projection", () => {
  const asset = (name: string): RenderAssetRef => ({ kind: "test", data: name });

  it("keeps a live visible path marker's terrain tile, even over otherwise bare terrain", () => {
    const floor = asset("floor");
    const path = [{ kind: "path" as const }];
    expect(backgroundAssetForWorldCell("seen", floor, path)).toBe(floor);
    expect(backgroundAssetForWorldCell("remembered", floor, path)).toBeUndefined();
    expect(backgroundAssetForWorldCell("seen", floor, [])).toBeUndefined();
  });

  it("keeps the unmodded glyph sink's frame-to-glyph output unchanged", () => {
    const calls: Array<{ x: number; y: number; glyph: Glyph }> = [];
    const floor = asset("floor");
    const path = asset("path");
    renderWorldFrame({
      width: 2,
      height: 1,
      origin: { x: 0, y: 0 },
      size: { width: 2, height: 1 },
      screenOrigin: { x: 10, y: 4 },
      resolveCell: (grid, screen): WorldCell => ({
        grid,
        screen,
        visibility: "seen",
        terrain: { kind: "terrain", id: 4 },
        overlays: grid.x === 0 ? [{ kind: "path" }] : [],
        visual: grid.x === 0
          ? { ch: "*", fg: "#f00", asset: path, backgroundAsset: floor }
          : { ch: ".", fg: "#777" },
        cursor: false,
      }),
      player: {
        grid: { x: 1, y: 0 },
        screen: { x: 11, y: 4 },
        layer: { kind: "player", id: 0 },
        visual: { ch: "@", fg: "#fff", backgroundAsset: floor },
        cursor: false,
      },
    }, glyphWorldFrameSink({ put: (x, y, glyph) => calls.push({ x, y, glyph }) }));

    expect(calls).toEqual([
      { x: 10, y: 4, glyph: { ch: "*", fg: "#f00", tile: path, bgTile: floor } },
      { x: 11, y: 4, glyph: { ch: ".", fg: "#777" } },
      { x: 11, y: 4, glyph: { ch: "@", fg: "#fff", bgTile: floor } },
    ]);
  });

  it("hands a separately owned renderer the same semantic frame the live path produced", () => {
    const received: WorldCell[][] = [];
    const modOwnedLayer = { kind: "object" as const, id: 901 };

    renderWorldFrame({
      width: 1,
      height: 1,
      origin: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
      screenOrigin: { x: 3, y: 2 },
      resolveCell: (grid, screen): WorldCell => ({
        grid,
        screen,
        visibility: "seen",
        terrain: { kind: "terrain", id: 4 },
        overlays: [modOwnedLayer],
        visual: { ch: "!", fg: "#f0f" },
        cursor: false,
      }),
    }, {
      /* Phase 5 will install this from a plugin.  Phase 4 proves that a
       * non-glyph owner can already consume the live frame without decoding
       * the fallback character. */
      present: (produced) => received.push([...produced.cells]),
    });

    expect(received).toEqual([[{
      grid: { x: 0, y: 0 },
      screen: { x: 3, y: 2 },
      visibility: "seen",
      terrain: { kind: "terrain", id: 4 },
      overlays: [modOwnedLayer],
      visual: { ch: "!", fg: "#f0f" },
      cursor: false,
    }]]);
  });
});
