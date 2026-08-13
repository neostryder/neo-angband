import { describe, expect, it } from "vitest";
import {
  regionContains,
  regionPixels,
  screenRegions,
  SCREEN_REGION_NAMES,
  type ScreenLayout,
  type ScreenRegions,
} from "./regions";

/** The classic terminal, in the layout every screenshot in the docs is of. */
const LEFT: ScreenLayout = {
  cols: 80,
  rows: 24,
  sidebar: "left",
  sidebarWidth: 13,
  mapOriginX: 13,
  mapTop: 1,
  mapCols: 66,
  mapRows: 22,
};

/** The compact layout: no column, a one-line vitals header instead. */
const TOP: ScreenLayout = {
  ...LEFT,
  sidebar: "top",
  mapOriginX: 0,
  mapTop: 2,
  mapCols: 79,
  mapRows: 21,
};

/** No vitals furniture at all. */
const NONE: ScreenLayout = { ...TOP, sidebar: "none", mapTop: 1, mapRows: 22 };

/** Every (col, row) claimed by more than one region. Must always be empty. */
function overlaps(regions: ScreenRegions, layout: ScreenLayout): string[] {
  const found: string[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const owners = SCREEN_REGION_NAMES.filter((name) => {
        const region = regions[name];
        return region !== undefined && regionContains(region.cells, col, row);
      });
      if (owners.length > 1) found.push(`${col},${row}: ${owners.join(" + ")}`);
    }
  }
  return found;
}

describe("screenRegions", () => {
  it("divides the classic 80x24 Left layout the way render() draws it", () => {
    const r = screenRegions(LEFT);
    /* Row 0 is the message line and it owns the FULL width from column 0 - it
     * runs ABOVE the sidebar rather than beside it, which is the one people get
     * wrong when they reimplement it. */
    expect(r.messages?.cells).toEqual({ col: 0, row: 0, cols: 80, rows: 1 });
    /* The 13-column status column, starting level with the map's top row
     * (ROW_MAP = 1) and running to the bottom - sidebarLayout() may place a
     * field on the last row, in the columns the status line does not reach. */
    expect(r.sidebar?.cells).toEqual({ col: 0, row: 1, cols: 13, rows: 23 });
    /* 66 of 80 columns, because SCREEN_WID reserves the rightmost one. */
    expect(r.map.cells).toEqual({ col: 13, row: 1, cols: 66, rows: 22 });
    expect(r.status?.cells).toEqual({ col: 13, row: 23, cols: 66, rows: 1 });
  });

  it("moves the sidebar rather than losing it in the compact layout", () => {
    /* The names are ROLES. A mod that had asked for "columns 0-12" would be
     * right here in one layout of three and would draw over the map in this
     * one; asking for `sidebar` is right in both. */
    const r = screenRegions(TOP);
    expect(r.sidebar?.cells).toEqual({ col: 0, row: 1, cols: 80, rows: 1 });
    expect(r.map.cells).toEqual({ col: 0, row: 2, cols: 79, rows: 21 });
    expect(r.messages?.cells.row).toBe(0);
    expect(r.status?.cells).toEqual({ col: 0, row: 23, cols: 79, rows: 1 });
  });

  it("reports no sidebar at all when the player has turned it off", () => {
    /* Absent, not empty. A front end asking "is there a sidebar" gets an answer
     * rather than a zero-sized rectangle it has to interpret. */
    const r = screenRegions(NONE);
    expect(r.sidebar).toBeUndefined();
    expect(r.map.cells).toEqual({ col: 0, row: 1, cols: 79, rows: 22 });
  });

  it("never gives one cell to two regions, in any layout", () => {
    /* The invariant that makes "draw in your region" mean anything: if two
     * regions could claim the same cell, a front end honouring its own would
     * still be drawing over somebody else's. */
    for (const layout of [LEFT, TOP, NONE]) {
      expect(overlaps(screenRegions(layout), layout)).toEqual([]);
    }
  });

  it("projects into CSS pixels through the surface's own metrics", () => {
    const metrics = { cellWidth: 12, cellHeight: 20, originX: 40, originY: 6 };
    const r = screenRegions(LEFT, metrics);
    /* The letterbox offset is included, which is the half a mod cannot compute:
     * cell size it might guess from the canvas, but where the grid was centred
     * inside the window it cannot. */
    expect(r.map.pixels).toEqual({ x: 40 + 13 * 12, y: 6 + 20, width: 66 * 12, height: 22 * 20 });
    expect(r.sidebar?.pixels).toEqual({ x: 40, y: 26, width: 13 * 12, height: 23 * 20 });
  });

  it("omits pixels entirely when the host has no projection to give", () => {
    /* A headless harness or an unfitted surface. Absent rather than zeroed: a
     * zero-sized rectangle reads as "the map is here and it is 0x0", and a
     * front end that trusted it would draw nothing forever with no way to tell
     * that from a host that simply could not answer. */
    const r = screenRegions(LEFT);
    for (const name of SCREEN_REGION_NAMES) expect(r[name]?.pixels).toBeUndefined();
  });

  it("projects a rectangle at fractional cell sizes without rounding it away", () => {
    /* Reflow mode divides the window rather than fitting a fixed grid, so cell
     * size is fractional there. Rounding here would put a front end's canvas a
     * pixel or two off the map it is replacing, on every frame. */
    expect(regionPixels({ col: 2, row: 3, cols: 4, rows: 5 }, {
      cellWidth: 7.5,
      cellHeight: 11.25,
      originX: 0,
      originY: 0,
    })).toEqual({ x: 15, y: 33.75, width: 30, height: 56.25 });
  });

  it("contains its own cells and not the ones past its edges", () => {
    const cells = { col: 13, row: 1, cols: 66, rows: 22 };
    expect(regionContains(cells, 13, 1)).toBe(true);
    expect(regionContains(cells, 78, 22)).toBe(true);
    expect(regionContains(cells, 12, 1)).toBe(false);
    expect(regionContains(cells, 79, 1)).toBe(false);
    expect(regionContains(cells, 13, 23)).toBe(false);
  });
});
