import { describe, expect, it } from "vitest";
import {
  baseRegionStack,
  occludersOf,
  orderRegions,
  regionContains,
  regionGridFault,
  regionPixels,
  screenRegions,
  topRegionAt,
  SCREEN_REGION_NAMES,
  type LiveRegion,
  type RegionCells,
  type RegionLayer,
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

  it("tiles the BASE layout without overlap, in any layout", () => {
    /* The invariant that makes "draw in your region" mean anything for core's
     * own furniture: if two of these four could claim the same cell, a front
     * end honouring its own would still be drawing over somebody else's.
     *
     * ONLY THE TITLE EVER LIED. The comment below was already scoped to the
     * base layout, and the overlapping stack has now arrived exactly as it
     * predicted — so the test keeps its subject and loses the global promise it
     * was being read as. What replaced that promise is
     * "exactly one visible owner" further down, which is the stronger claim:
     * this one says overlap cannot happen, and that one says overlap cannot be
     * AMBIGUOUS, which stays true once overlap is legal.
     *
     * Scope: the four regions that tile the terminal. Gap 21 is decided in the
     * direction that breaks a global version — a full screen is COMPOSED of
     * regions rather than covering them, so a floating window sits over a map
     * that is still being drawn. */
    for (const layout of [LEFT, TOP, NONE]) {
      expect(overlaps(screenRegions(layout), layout)).toEqual([]);
    }
  });

  it("keeps every base region inside the grid it was measured for", () => {
    /* Off-grid is worse than overlapping: an overlapping region is drawn and
     * the player can see the argument, but a region running off the edge is
     * silently CLIPPED — a half-drawn window, no error anywhere, and nothing to
     * search for. Asserted on core's own four first, because a rule the base
     * layout breaks is a rule no mod will be asked to keep. */
    for (const layout of [LEFT, TOP, NONE]) {
      for (const r of baseRegionStack(screenRegions(layout))) {
        expect([r.id, regionGridFault(r.cells, layout.cols, layout.rows)]).toEqual([
          r.id,
          undefined,
        ]);
      }
    }
  });
});

/** A stack entry, spelled out so a test reads as a picture of the screen. */
function live(id: string, layer: RegionLayer, cells: RegionCells): LiveRegion {
  return { id, layer, cells };
}

describe("the region stack", () => {
  it("orders bands bottom to top, and keeps declaration order inside a band", () => {
    /* Within a band the later-declared region is on top, and for a mod that is
     * load order — the same last-load-wins rule that already decides the front
     * end, the HUD, the screen presenter and the menu transform. */
    const cells = { col: 0, row: 0, cols: 4, rows: 4 };
    const ordered = orderRegions([
      live("modal-first", "modal", cells),
      live("overlay-first", "overlay", cells),
      live("base", "base", cells),
      live("overlay-second", "overlay", cells),
      live("system", "system", cells),
      live("modal-second", "modal", cells),
    ]);
    expect(ordered.map((r) => r.id)).toEqual([
      "base",
      "overlay-first",
      "overlay-second",
      "modal-first",
      "modal-second",
      "system",
    ]);
  });

  it("orders the same stack the same way however the declarations arrive", () => {
    /* Stability asserted, not assumed. An unstable ordering makes the composite
     * depend on the sort implementation, and the symptom is a window that is on
     * top on one machine and behind on another — a bug no screenshot
     * reproduces. `orderRegions` buckets rather than sorting, so it cannot have
     * that failure at all; this is what says so.
     *
     * Enough entries in one band that a naive unstable sort would be visibly
     * free to reorder them. */
    const cells = { col: 1, row: 1, cols: 2, rows: 2 };
    const many = Array.from({ length: 12 }, (_, i) => live(`overlay-${i}`, "overlay", cells));
    const withBands = [live("sys", "system", cells), ...many, live("floor", "base", cells)];
    const first = orderRegions(withBands).map((r) => r.id);
    expect(first).toEqual(["floor", ...many.map((r) => r.id), "sys"]);
    /* Same members, declared in a different order: the BANDS still sort, and
     * the within-band order follows the new declaration order rather than any
     * remembered one. */
    const reversed = orderRegions([...withBands].reverse()).map((r) => r.id);
    expect(reversed).toEqual(["floor", ...many.map((r) => r.id).reverse(), "sys"]);
  });

  it("sinks a region with an unrecognised band instead of losing it", () => {
    /* TOTAL: every region in comes exactly once out. A region that disappears
     * with no error is the failure this whole module exists to stop, and a mod
     * drawing under the map is visible, reportable and obviously wrong in a way
     * that a mod drawing nowhere is not. */
    const cells = { col: 0, row: 0, cols: 2, rows: 2 };
    const junk = { id: "junk", layer: "floating" as RegionLayer, cells };
    const ordered = orderRegions([live("base", "base", cells), junk]);
    expect(ordered.map((r) => r.id)).toEqual(["junk", "base"]);
  });

  it("gives a cell claimed more than once exactly one visible owner: the top", () => {
    /* THIS IS THE ASSERTION THAT REPLACED "no cell is claimed twice". Two
     * regions writing one cell is now legal. Two answers to "who is on top"
     * never is — the composite has to be a function of the region SET, not of
     * the order some Map happened to iterate in.
     *
     * Deliberately overlapping: a base floor, a window over its middle, and a
     * modal over the window's corner, so there are cells with one, two and
     * three claimants. */
    const stack = orderRegions([
      live("floor", "base", { col: 0, row: 0, cols: 10, rows: 10 }),
      live("window", "overlay", { col: 2, row: 2, cols: 5, rows: 5 }),
      live("dialog", "modal", { col: 5, row: 5, cols: 4, rows: 4 }),
    ]);
    let overlapped = 0;
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const claimants = stack.filter((r) => regionContains(r.cells, col, row));
        if (claimants.length > 1) overlapped++;
        /* The visible owner is the LAST claimant in paint order, every time. */
        expect([col, row, topRegionAt(stack, col, row)?.id]).toEqual([
          col,
          row,
          claimants.at(-1)?.id,
        ]);
      }
    }
    /* The fixture has to actually exercise the thing: a stack that happened not
     * to overlap would pass this test while proving nothing about overlap. */
    expect(overlapped).toBe(25 + 16 - 4);
  });

  it("tells a front end what is covering the map, and bottom-most first", () => {
    /* The one question a replacement front end asks. `blueprint-view` draws to
     * its own canvas at the map's pixels, so when a screen opens it has to
     * learn it is covered — otherwise it keeps showing a map nobody is
     * compositing it with, which is exactly what the photographed defect is. */
    const stack = orderRegions([
      ...baseRegionStack(screenRegions(LEFT)),
      live("mod:corner", "overlay", { col: 60, row: 20, cols: 6, rows: 3 }),
      live("core:screen", "modal", { col: 0, row: 0, cols: 80, rows: 24 }),
    ]);
    expect(occludersOf(stack, "map")?.map((r) => r.id)).toEqual(["mod:corner", "core:screen"]);
    /* Nothing sits above the top of the stack. */
    expect(occludersOf(stack, "core:screen")).toEqual([]);
    /* A region that does not overlap is not an occluder, even from above it:
     * the message line is row 0 and the corner window is rows 20-22. */
    expect(occludersOf(stack, "messages")?.map((r) => r.id)).toEqual(["core:screen"]);
  });

  it("says 'no such region' differently from 'nothing covers you'", () => {
    /* The awkward return type earns itself here. An empty array means nothing
     * covers you; undefined means you asked about a region that is not in this
     * stack — a typo, or a name from a layout that does not have one (the
     * sidebar under the None layout is exactly that). Collapsing the two would
     * report a misspelled id as GOOD NEWS, and the symptom would be a mod
     * canvas cheerfully painting over a screen forever. */
    const stack = orderRegions(baseRegionStack(screenRegions(NONE)));
    expect(occludersOf(stack, "map")).toEqual([]);
    expect(occludersOf(stack, "sidebar")).toBeUndefined();
    expect(occludersOf(stack, "mpa")).toBeUndefined();
  });

  it("names the numbers when a region will not fit, rather than returning false", () => {
    /* "cols 60..100 of an 80-column grid" is a bug an author can fix; `false`
     * is not. */
    const fits = { col: 60, row: 20, cols: 20, rows: 4 };
    expect(regionGridFault(fits, 80, 24)).toBeUndefined();
    expect(regionGridFault({ ...fits, cols: 40 }, 80, 24)).toBe(
      "region spans columns 60..100 of a 80-column grid",
    );
    expect(regionGridFault({ ...fits, rows: 8 }, 80, 24)).toBe(
      "region spans rows 20..28 of a 24-row grid",
    );
    expect(regionGridFault({ ...fits, cols: 0 }, 80, 24)).toBe(
      "region is 0x4 cells: a region must have at least one cell",
    );
    expect(regionGridFault({ ...fits, col: -1 }, 80, 24)).toBe(
      "region starts at -1,20: a region cannot start off the grid",
    );
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
