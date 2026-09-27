import { describe, expect, it, vi } from "vitest";
import { createDisplayOwnership } from "./display-ownership";
import type { ModDisplay } from "./mod-plugin";

function display() {
  const setCamera = vi.fn();
  const setGrid = vi.fn();
  const setMapView = vi.fn();
  const setSidebarExtent = vi.fn();
  const setMapMargin = vi.fn();
  const setTileScaling = vi.fn();
  const setFullMapOverview = vi.fn();
  const setVisualFilter = vi.fn();
  const base = {
    snapshot: () => ({}), onKey: () => () => undefined,
    setCamera, setGrid, setMapView, setSidebarExtent, setMapMargin,
    setTileScaling, setFullMapOverview, setVisualFilter,
    setStoreItemNameEllipsis: () => undefined,
    setStoreSelectionDescription: () => undefined,
    setQuiverItemization: () => undefined,
    setMonsterListColorKey: () => undefined,
    repaint: () => undefined,
  } as unknown as ModDisplay;
  return { base, setCamera, setGrid, setMapView, setSidebarExtent, setMapMargin, setTileScaling, setFullMapOverview, setVisualFilter };
}

describe("owned display requests", () => {
  it("keeps the last live value and restores two and three earlier owners", () => {
    const { base, setCamera } = display();
    const owned = createDisplayOwnership(base);
    const a = owned.forMod("interface");
    const b = owned.forMod("qol");
    const c = owned.forMod("third");
    expect(a.getCamera?.()).toBeNull();
    a.setCamera({ x: 1, y: 2 });
    b.setCamera({ x: 3, y: 4 });
    c.setCamera({ x: 5, y: 6 });
    expect(a.getCamera?.()).toEqual({ x: 5, y: 6 });
    const copied = a.getCamera?.() as { x: number; y: number };
    copied.x = 99;
    expect(a.getCamera?.()).toEqual({ x: 5, y: 6 });
    expect(b.getCamera?.()).toEqual({ x: 5, y: 6 });
    owned.clear("qol");
    expect(a.getCamera?.()).toEqual({ x: 5, y: 6 });
    c.setCamera(null);
    expect(a.getCamera?.()).toEqual({ x: 1, y: 2 });
    expect(setCamera).toHaveBeenLastCalledWith({ x: 1, y: 2 });
    owned.clear("interface");
    expect(a.getCamera?.()).toBeNull();
    expect(setCamera).toHaveBeenLastCalledWith(null);
  });

  it("stacks every requested setter and clears a mod on reload", () => {
    const calls = display();
    const owned = createDisplayOwnership(calls.base);
    const a = owned.forMod("interface");
    const b = owned.forMod("qol");
    const grid = { cellHeight: 20, minCols: 80, minRows: 24, snapViewportToEven: true };
    const view = { origin: { x: 2, y: 3 }, size: { width: 20, height: 10 } };
    const sidebar = { columns: 12, topRows: 2 };
    const margin = { edge: "right" as const, cells: 2 };
    a.setGrid(grid);
    a.setMapView(view);
    a.setSidebarExtent(sidebar);
    a.setMapMargin?.(margin);
    a.setTileScaling("crisp");
    a.setFullMapOverview(true);
    a.setVisualFilter("blur(1px)", { scope: "game" });
    b.setGrid(null);
    b.setMapView(null);
    b.setSidebarExtent(null);
    b.setMapMargin?.(null);
    b.setTileScaling("auto");
    b.setFullMapOverview(false);
    b.setVisualFilter("contrast(2)");
    expect(b.getGrid?.()).toEqual(grid);
    expect(b.getMapView?.()).toEqual(view);
    expect(b.getSidebarExtent?.()).toEqual(sidebar);
    expect(b.getMapMargin?.()).toEqual(margin);
    expect(b.getTileScaling?.()).toBe("auto");
    expect(b.getFullMapOverview?.()).toBe(false);
    expect(b.getVisualFilter?.()).toEqual({ filter: "contrast(2)", scope: "canvas" });
    owned.clear("qol");
    expect(b.getTileScaling?.()).toBe("crisp");
    expect(b.getFullMapOverview?.()).toBe(true);
    expect(b.getVisualFilter?.()).toEqual({ filter: "blur(1px)", scope: "game" });
    expect(calls.setVisualFilter).toHaveBeenLastCalledWith("blur(1px)", { scope: "game" });
    expect(calls.setGrid).toHaveBeenLastCalledWith(grid);
  });

  it("keeps the earlier request when a new display request is refused", () => {
    const calls = display();
    calls.setGrid.mockImplementation((value) => {
      if (value?.cellHeight === 0) throw new RangeError("invalid grid");
    });
    const owned = createDisplayOwnership(calls.base);
    const a = owned.forMod("interface");
    const b = owned.forMod("qol");
    const grid = { cellHeight: 20, minCols: 80, minRows: 24, snapViewportToEven: false };
    a.setGrid(grid);
    expect(() => b.setGrid({ ...grid, cellHeight: 0 })).toThrow(RangeError);
    expect(b.getGrid()).toEqual(grid);
    owned.clear("qol");
    expect(a.getGrid()).toEqual(grid);
  });
});
