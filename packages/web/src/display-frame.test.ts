// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { Api2DisplaySnapshot } from "@rpgm-tools/neo-angband-mod-sdk";
import { displayCellAt, displayFrame } from "./display-frame";

const snapshot = {
  mode: "play", grid: { cols: 82, rows: 26, cellWidth: 8, cellHeight: 16 },
  viewport: { origin: { x: 10, y: 20 }, size: { width: 80, height: 24 }, screenOrigin: { x: 1, y: 1 } },
  level: { width: 200, height: 100 }, layout: "none", regions: {},
} as Api2DisplaySnapshot;

describe("presentation display reads", () => {
  it("maps terminal cells to the camera and rejects chrome and full-screen menus", () => {
    expect(displayCellAt({ col: 5, row: 3 }, snapshot, 40, 48)).toEqual({ cell: { col: 5, row: 3 }, grid: { x: 14, y: 22 } });
    expect(displayCellAt({ col: 0, row: 0 }, snapshot, 0, 0)?.grid).toBeNull();
    expect(displayCellAt({ col: 5, row: 3 }, { ...snapshot, mode: "store" }, 40, 48)?.grid).toBeNull();
    expect(displayCellAt(null, snapshot, -1, -1)).toBeNull();
    expect(displayCellAt({ col: 1, row: 1 }, snapshot, NaN, 0)).toBeNull();
  });

  it("maps a compressed text overview to each cell's central cave grid", () => {
    const map = { ...snapshot, mode: "map" as const, viewport: { ...snapshot.viewport, origin: { x: 0, y: 0 }, size: { width: 200, height: 100 } } };
    expect(displayCellAt({ col: 41, row: 13 }, map, 0, 0)?.grid).toEqual({ x: 101, y: 52 });
    expect(displayCellAt({ col: 81, row: 13 }, map, 0, 0)?.grid).toBeNull();
  });

  it("uses the graphics overview's painted rectangle across tilesets and full-detail text maps", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 100, top: 50, width: 400, height: 200 } as DOMRect);
    const layer = { canvas, origin: { x: 7, y: 9 }, width: 100, height: 50 };
    const map = { ...snapshot, mode: "map" as const };
    expect(displayCellAt({ col: 20, row: 10 }, map, 300, 150, layer)?.grid).toEqual({ x: 57, y: 34 });
    expect(displayCellAt({ col: 20, row: 10 }, map, 90, 150, layer)?.grid).toBeNull();
    expect(displayCellAt({ col: 20, row: 10 }, map, 500, 150, layer)?.grid).toBeNull();
  });

  it("copies finished terminal pixels and composites the overview at device-pixel coordinates", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 400, height: 200 } as DOMRect);
    const overlay = document.createElement("canvas");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 110, top: 70, width: 200, height: 100 } as DOMRect);
    const pixels = { width: 800, height: 400, data: new Uint8ClampedArray(800 * 400 * 4) };
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => pixels) };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    try {
      expect(displayFrame(canvas)).toBe(pixels);
      expect(context.drawImage).toHaveBeenCalledWith(canvas, 0, 0);
      expect(displayFrame(canvas, { canvas: overlay, origin: { x: 0, y: 0 }, width: 10, height: 10 })).toBe(pixels);
      expect(context.drawImage).toHaveBeenCalledWith(overlay, 200, 100, 400, 200);
      expect(context.getImageData).toHaveBeenCalledWith(0, 0, 800, 400);
    } finally {
      spy.mockRestore();
    }
  });
});
