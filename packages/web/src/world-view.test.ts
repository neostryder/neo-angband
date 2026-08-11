import { describe, expect, it } from "vitest";
import { buildWorldFrame, type WorldCell } from "./world-view";

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
