import { describe, expect, it } from "vitest";
import type { Glyph, RenderAssetRef } from "./term";
import {
  backgroundAssetForWorldCell,
  buildWorldFrame,
  paintWorldFrame,
  type WorldCell,
} from "./world-view";

describe("buildWorldFrame", () => {
  it("streams the in-bounds viewport in row order with semantic layers intact", () => {
    const seen: WorldCell[] = [];
    const frame = buildWorldFrame({
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
    });

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
  });
});

describe("the live WorldFrame projection", () => {
  const asset = (name: string): RenderAssetRef => ({ kind: "test", data: name });

  it("keeps a visible path marker's terrain tile while preserving remembered path behavior", () => {
    const floor = asset("floor");
    expect(backgroundAssetForWorldCell("seen", floor, true, true)).toBe(floor);
    expect(backgroundAssetForWorldCell("remembered", floor, true, true)).toBeUndefined();
    expect(backgroundAssetForWorldCell("seen", floor, false, false)).toBeUndefined();
  });

  it("runs resolved cells through the frame consumer with exact tile inputs and player-last order", () => {
    const calls: Array<{ x: number; y: number; glyph: Glyph }> = [];
    const floor = asset("floor");
    const path = asset("path");
    const frame = buildWorldFrame({
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
    });

    paintWorldFrame({ put: (x, y, glyph) => calls.push({ x, y, glyph }) }, frame);

    expect(calls).toEqual([
      { x: 10, y: 4, glyph: { ch: "*", fg: "#f00", tile: path, bgTile: floor } },
      { x: 11, y: 4, glyph: { ch: ".", fg: "#777" } },
      { x: 11, y: 4, glyph: { ch: "@", fg: "#fff", bgTile: floor } },
    ]);
  });
});
