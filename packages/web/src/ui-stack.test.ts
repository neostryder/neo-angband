/**
 * The live stack: what is open, in what order, and what happens when a region
 * asks for something impossible.
 *
 * `regions.test.ts` drives the ordering rules as pure functions and
 * `region-surface.test.ts` drives the clipping. What is left for this file is
 * everything those two cannot see because they take their inputs as arguments:
 * that a push survives a relayout, that a pop takes the right push with it, that
 * an author's mistake becomes a NAMED fault instead of a region that quietly
 * is not there, and that a region's surface follows the region.
 *
 * The double is a real cell grid, for the reason `region-surface.test.ts` gives:
 * the question is what ended up on screen, and a call recorder answers a
 * different one.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screenRegions } from "./regions";
import type { RegionCells } from "./regions";
import {
  liveRegionStack,
  paintRegionStack,
  popRegion,
  pushRegion,
  regionStackFaults,
  regionSurface,
  relayoutStack,
  resetRegionStack,
  type RegionHandle,
  type RegionSpec,
} from "./ui-stack";
import type { ClippableSurface } from "./region-surface";
import type { Glyph, GridCell, TermSize } from "./term";

const COLS = 80;
const ROWS = 24;

/** A grid that records what is in each cell, plus the optional pointer seam. */
class GridDouble implements ClippableSurface {
  readonly cells: (string | null)[][];
  cursor: { x: number; y: number } | null = null;
  /** Omitted on the unbounded flavour; see clipSurfaceFault. */
  eraseSpan?: (x: number, y: number, len: number) => void;
  /** Omitted on the no-touch flavour, as two dozen shipped doubles are. */
  onCellTap?: (listener: (cell: GridCell) => void) => () => void;
  private tap: ((cell: GridCell) => void) | null = null;

  constructor(
    readonly cols = COLS,
    readonly rows = ROWS,
    opts: { bounded?: boolean; touch?: boolean } = {},
  ) {
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, (): string | null => null),
    );
    if (opts.bounded !== false) {
      this.eraseSpan = (x, y, len): void => {
        const row = this.cells[y];
        if (!row) return;
        for (let cx = Math.max(0, x); cx < Math.min(this.cols, x + len); cx++) row[cx] = null;
      };
    }
    if (opts.touch) {
      this.onCellTap = (listener): (() => void) => {
        this.tap = listener;
        return () => {
          if (this.tap === listener) this.tap = null;
        };
      };
    }
  }

  /** What GlyphTerm would deliver for a canvas pointerdown. */
  fireTap(col: number, row: number): void {
    this.tap?.({ col, row });
  }

  row(y: number): string {
    return (this.cells[y] ?? []).map((c) => c ?? " ").join("").replace(/\s+$/u, "");
  }

  size(): TermSize {
    return { cols: this.cols, rows: this.rows };
  }
  invalidate(): void {}
  flush(): void {}
  clear(): void {
    for (const row of this.cells) row.fill(null);
  }
  setCursor(x: number, y: number): void {
    this.cursor = { x, y };
  }
  hideCursor(): void {
    this.cursor = null;
  }
  put(x: number, y: number, glyph: Glyph): void {
    const row = this.cells[y];
    if (!row || x < 0 || x >= this.cols) return;
    row[x] = glyph.ch;
  }
  print(x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) this.put(x + i, y, { ch: text[i]!, fg: "#fff" });
  }
  eraseToEol(x: number, y: number): void {
    const row = this.cells[y];
    if (!row) return;
    for (let cx = Math.max(0, x); cx < this.cols; cx++) row[cx] = null;
  }
  prt(x: number, y: number, text: string): void {
    this.eraseToEol(x, y);
    this.print(x, y, text);
  }
}

/** The base layout at a given size, in the Left sidebar mode. */
function baseAt(cols = COLS, rows = ROWS): ReturnType<typeof screenRegions> {
  return screenRegions({
    cols,
    rows,
    sidebar: "left",
    sidebarWidth: 13,
    mapOriginX: 13,
    mapTop: 1,
    mapCols: cols - 14,
    mapRows: rows - 2,
  });
}

/** A region that fills the whole terminal, as every core screen declares. */
function fullScreen(id: string, spec: Partial<RegionSpec> = {}): RegionSpec {
  return {
    id,
    layer: "modal",
    place: (g) => ({ col: 0, row: 0, cols: g.cols, rows: g.rows }),
    ...spec,
  };
}

/** A region somewhere in the middle, sharing no edge with the terminal. */
function windowAt(id: string, cells: RegionCells, spec: Partial<RegionSpec> = {}): RegionSpec {
  return { id, layer: "overlay", place: () => cells, ...spec };
}

beforeEach(() => {
  resetRegionStack();
});

describe("the stack holds what is open, in order", () => {
  it("puts every push above the four base tiles, bottom band first", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion({ ...fullScreen("core:screen"), layer: "system" });
    pushRegion(windowAt("mod:hud", { col: 2, row: 2, cols: 10, rows: 4 }));
    pushRegion({ ...fullScreen("core:menu"), layer: "modal" });
    /* Declared system-first and it still sinks below the two mod bands: the
     * order is the BAND's, not the order the pushes happened to arrive in. */
    expect(liveRegionStack().map((r) => r.id)).toEqual([
      "messages",
      "sidebar",
      "map",
      "status",
      "mod:hud",
      "core:menu",
      "core:screen",
    ]);
  });

  it("keeps the last-loaded region on top WITHIN a band", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion(windowAt("mod:first", { col: 0, row: 0, cols: 5, rows: 5 }));
    pushRegion(windowAt("mod:second", { col: 0, row: 0, cols: 5, rows: 5 }));
    expect(liveRegionStack().slice(-2).map((r) => r.id)).toEqual(["mod:first", "mod:second"]);
  });

  it("projects pixels only when the host offered metrics", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion(windowAt("mod:hud", { col: 2, row: 3, cols: 10, rows: 4 }));
    expect(liveRegionStack().at(-1)?.pixels).toBeUndefined();
    relayoutStack({
      cols: COLS,
      rows: ROWS,
      metrics: { cellWidth: 8, cellHeight: 16, originX: 4, originY: 6 },
    });
    expect(liveRegionStack().at(-1)?.pixels).toEqual({ x: 20, y: 54, width: 80, height: 64 });
  });
});

describe("relayout re-places every region and does no work of its own", () => {
  it("asks place() again at the new size", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const handle = pushRegion(fullScreen("core:screen"));
    expect(handle.cells()).toEqual({ col: 0, row: 0, cols: 80, rows: 24 });
    relayoutStack({ cols: 40, rows: 12, base: baseAt(40, 12) });
    expect(handle.cells()).toEqual({ col: 0, row: 0, cols: 40, rows: 12 });
  });

  it("remembers the base and the metrics when a relayout only knows the size", () => {
    /* The resize handler fires while a modal owns the terminal and has no
     * business computing a base layout of its own; what it knows is the grid. */
    relayoutStack({
      cols: COLS,
      rows: ROWS,
      base: baseAt(),
      metrics: { cellWidth: 8, cellHeight: 16, originX: 0, originY: 0 },
    });
    pushRegion(windowAt("mod:hud", { col: 1, row: 1, cols: 4, rows: 4 }));
    relayoutStack({ cols: COLS, rows: ROWS });
    expect(liveRegionStack().map((r) => r.id)).toContain("map");
    expect(liveRegionStack().at(-1)?.pixels).toBeDefined();
  });

  it("draws nothing", () => {
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion(fullScreen("core:screen", { paint: (s) => s.print(0, 0, "PAINTED", "#fff") }));
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    expect(grid.row(0)).toBe("");
  });
});

describe("a pop takes exactly its own push", () => {
  it("is keyed on the handle, not the id", () => {
    /* Two screens open under one id is legal - a screen opened from a screen -
     * and a pop keyed on the name would close the wrong one. */
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const first = pushRegion(fullScreen("core:screen"));
    const second = pushRegion(fullScreen("core:screen"));
    expect(liveRegionStack().filter((r) => r.id === "core:screen")).toHaveLength(2);
    popRegion(second);
    expect(liveRegionStack().filter((r) => r.id === "core:screen")).toHaveLength(1);
    expect(first.cells()).toBeDefined();
    expect(second.cells()).toBeUndefined();
  });

  it("is idempotent", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const first = pushRegion(fullScreen("a"));
    const second = pushRegion(fullScreen("b"));
    popRegion(second);
    popRegion(second);
    second.release();
    expect(liveRegionStack().map((r) => r.id)).toContain("a");
    expect(first.cells()).toBeDefined();
  });
});

describe("an impossible region is a NAMED fault, not a silent absence", () => {
  it("refuses a rectangle that runs off the grid, with the numbers", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const handle = pushRegion(windowAt("mod:wide", { col: 60, row: 0, cols: 40, rows: 4 }));
    expect(handle.cells()).toBeUndefined();
    expect(handle.fault()).toContain("columns 60..100");
    expect(handle.fault()).toContain("80-column");
    expect(regionStackFaults()).toEqual([{ id: "mod:wide", fault: handle.fault() }]);
    expect(liveRegionStack().map((r) => r.id)).not.toContain("mod:wide");
  });

  it("survives a place() that throws, and the other regions are untouched", () => {
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const good = pushRegion(windowAt("mod:good", { col: 0, row: 0, cols: 4, rows: 4 }));
    const bad = pushRegion({
      id: "mod:bad",
      layer: "overlay",
      place: () => {
        throw new Error("place() did work");
      },
    });
    expect(bad.fault()).toContain("place() threw");
    expect(() => relayoutStack({ cols: 40, rows: 12, base: baseAt(40, 12) })).not.toThrow();
    expect(good.cells()).toEqual({ col: 0, row: 0, cols: 4, rows: 4 });
    expect(liveRegionStack().map((r) => r.id)).toContain("mod:good");
  });

  it("recovers when the terminal grows back into the region's rectangle", () => {
    relayoutStack({ cols: 20, rows: 6, base: baseAt(20, 6) });
    const handle = pushRegion(windowAt("mod:hud", { col: 30, row: 0, cols: 10, rows: 4 }));
    expect(handle.fault()).toBeDefined();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    expect(handle.fault()).toBeUndefined();
    expect(handle.cells()).toEqual({ col: 30, row: 0, cols: 10, rows: 4 });
  });

  it("faults a push made before anything told it how big the terminal is", () => {
    const handle = pushRegion(fullScreen("core:screen"));
    expect(handle.fault()).toContain("0x0");
    /* ...which is why a screen that has just measured the terminal says so. */
    const measured = pushRegion(fullScreen("core:screen"), { cols: 40, rows: 12 });
    expect(measured.cells()).toEqual({ col: 0, row: 0, cols: 40, rows: 12 });
  });
});

describe("painting the stack", () => {
  it("does nothing at all for regions with no painter", () => {
    /* Every core screen today. This is what makes #261 commit 3 byte-identical:
     * the screen declares a rectangle and paints itself exactly as before, and
     * the compositor pass at the end of the frame has no work to do. */
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion(fullScreen("core:screen"));
    paintRegionStack(grid);
    expect(grid.cells.flat().every((c) => c === null)).toBe(true);
  });

  it("paints bottom to top, so the higher band wins the shared cells", () => {
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion({
      ...windowAt("mod:under", { col: 0, row: 0, cols: 20, rows: 3 }),
      paint: (s) => s.print(0, 0, "UNDER-UNDER-UNDER", "#fff"),
    });
    pushRegion({
      ...windowAt("mod:over", { col: 6, row: 0, cols: 10, rows: 3 }),
      layer: "modal",
      paint: (s) => s.print(0, 0, "OVER", "#fff"),
    });
    paintRegionStack(grid);
    /* "UNDER-UNDER-UNDER" with columns 6..9 overwritten by "OVER". */
    expect(grid.row(0)).toBe("UNDER-OVERR-UNDER");
  });

  it("cannot let a painter write outside its own rectangle", () => {
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    pushRegion({
      ...windowAt("mod:hud", { col: 10, row: 2, cols: 5, rows: 2 }),
      paint: (s) => {
        s.print(0, 0, "0123456789", "#fff"); // runs past the right edge
        s.print(0, 9, "below", "#fff"); // runs past the bottom
        s.clear(); // must erase the rectangle, not the screen
        s.print(0, 0, "abcde", "#fff");
      },
    });
    grid.print(0, 2, "left");
    grid.print(40, 2, "right");
    paintRegionStack(grid);
    expect(grid.row(2)).toBe("left      abcde" + " ".repeat(25) + "right");
    expect(grid.row(9)).toBe("");
  });

  it("refuses a narrow region on a surface that cannot bound an erase", () => {
    /* Erasing with spaces would punch a white hole in whatever the region is
     * floating over, so the honest answer is to refuse at the door. */
    const grid = new GridDouble(COLS, ROWS, { bounded: false });
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const handle = pushRegion({
      ...windowAt("mod:hud", { col: 10, row: 2, cols: 5, rows: 2 }),
      paint: (s) => s.print(0, 0, "abcde", "#fff"),
    });
    paintRegionStack(grid);
    expect(handle.fault()).toContain("no eraseSpan");
    expect(grid.row(2)).toBe("");
  });

  it("reports a painter that throws instead of losing the frame", () => {
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const bad = pushRegion({
      ...windowAt("mod:bad", { col: 0, row: 0, cols: 5, rows: 2 }),
      paint: () => {
        throw new Error("boom");
      },
    });
    const good = pushRegion({
      ...windowAt("mod:good", { col: 10, row: 0, cols: 5, rows: 2 }),
      paint: (s) => s.print(0, 0, "ok", "#fff"),
    });
    expect(() => paintRegionStack(grid)).not.toThrow();
    expect(bad.fault()).toContain("boom");
    expect(good.fault()).toBeUndefined();
    expect(grid.row(0)).toBe("          ok");
  });

  it("keeps painting the regions ABOVE one that pops itself mid-frame (#261)", () => {
    /* THE DEFECT, in this file's own terms because it is this file's and has
     * nothing to do with mods. `popRegion` runs `recompose()`, which mints a
     * fresh `LiveRegion` for every entry and a fresh `owners` map keyed by those
     * new objects. The paint loop was walking the PREVIOUS array and looking its
     * members up in the NEW map, so from the pop onwards every lookup missed and
     * every region above the one that popped silently skipped a frame.
     *
     * It was unreachable until something could remove itself from inside a
     * paint, which is exactly what `region-runtime.ts` does when a mod's painter
     * throws - and it found this. The symptom would have been a flicker in an
     * innocent region while a DIFFERENT mod was failing. */
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    /* A box, because the spec must reach a handle that does not exist until
     * pushRegion has been given the spec - the same knot `region-runtime.ts`
     * ties for the same reason. */
    const held: { handle?: RegionHandle } = {};
    held.handle = pushRegion({
      ...windowAt("mod:leaves", { col: 0, row: 0, cols: 5, rows: 1 }),
      paint: () => held.handle!.release(),
    });
    pushRegion({
      ...windowAt("mod:stays", { col: 10, row: 0, cols: 5, rows: 1 }),
      paint: (s) => s.print(0, 0, "ok", "#fff"),
    });
    paintRegionStack(grid);
    expect(grid.row(0)).toBe("          ok");
    expect(liveRegionStack().map((r) => r.id)).toContain("mod:stays");
    expect(liveRegionStack().map((r) => r.id)).not.toContain("mod:leaves");
  });

  it("does not paint a region that was popped EARLIER in the same frame (#261)", () => {
    /* The other direction, and the reason the fix is a snapshot PLUS a liveness
     * check rather than a snapshot alone. A region removed while the frame is
     * still running must not then be drawn by that same frame - it would leave
     * one last picture on screen after being withdrawn, which is how a phantom
     * outlives its owner. */
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const held: { victim?: RegionHandle } = {};
    pushRegion({
      ...windowAt("mod:first", { col: 0, row: 0, cols: 5, rows: 1 }),
      paint: () => held.victim!.release(),
    });
    held.victim = pushRegion({
      ...windowAt("mod:second", { col: 10, row: 0, cols: 5, rows: 1 }),
      paint: (s) => s.print(0, 0, "NO", "#fff"),
    });
    paintRegionStack(grid);
    expect(grid.row(0)).toBe("");
  });
});

describe("a region's surface follows the region", () => {
  it("is indistinguishable from the host at the full-terminal default", () => {
    /* The acceptance criterion for #261 commit 3, as a unit: a painter handed
     * the whole terminal as a region must produce the same bytes it produced
     * when it was handed the terminal itself. */
    const direct = new GridDouble();
    const viaRegion = new GridDouble();
    const paint = (s: {
      size(): TermSize;
      clear(): void;
      print(x: number, y: number, t: string, fg: string): void;
      prt(x: number, y: number, t: string, fg: string): void;
    }): void => {
      const { cols, rows } = s.size();
      s.clear();
      s.print(0, 0, "Title".slice(0, cols - 1), "#fff");
      s.prt(0, rows - 1, "footer", "#888");
      s.print(cols - 3, 4, "edge", "#fff"); // deliberately one past the edge
    };
    paint(direct);
    const full = { col: 0, row: 0, cols: COLS, rows: ROWS };
    paint(regionSurface(viaRegion, () => full));
    expect(viaRegion.cells).toEqual(direct.cells);
  });

  it("re-reads its rectangle after a relayout, as term.size() always did", () => {
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const handle = pushRegion(fullScreen("core:screen"));
    const surface = regionSurface(grid, handle.cells);
    expect(surface.size()).toEqual({ cols: 80, rows: 24 });
    relayoutStack({ cols: 40, rows: 12, base: baseAt(40, 12) });
    expect(surface.size()).toEqual({ cols: 40, rows: 12 });
  });

  it("falls back to the whole host when its region is gone", () => {
    /* A popped or faulted region still has a live key handler behind it. A
     * surface that dropped every write would leave a black screen listening. */
    const grid = new GridDouble();
    relayoutStack({ cols: COLS, rows: ROWS, base: baseAt() });
    const handle = pushRegion(fullScreen("core:screen"));
    const surface = regionSurface(grid, handle.cells);
    popRegion(handle);
    expect(surface.size()).toEqual({ cols: 80, rows: 24 });
    surface.print(0, 0, "still here", "#fff");
    expect(grid.row(0)).toBe("still here");
  });

  it("delivers taps in the region's own coordinates and drops the rest", () => {
    const grid = new GridDouble(COLS, ROWS, { touch: true });
    const surface = regionSurface(grid, () => ({ col: 10, row: 4, cols: 6, rows: 3 }));
    const seen: GridCell[] = [];
    surface.onCellTap((cell) => seen.push(cell));
    grid.fireTap(12, 5); // inside
    grid.fireTap(0, 0); // outside: belongs to whoever is underneath
    grid.fireTap(16, 5); // one column past the right edge
    expect(seen).toEqual([{ col: 2, row: 1 }]);
  });

  it("is a no-op on a surface with no pointer seam, as setActiveCellTap is", () => {
    const grid = new GridDouble(); // no onCellTap at all
    const surface = regionSurface(grid, () => ({ col: 0, row: 0, cols: COLS, rows: ROWS }));
    const dispose = surface.onCellTap(() => {
      throw new Error("a surface with no taps delivered one");
    });
    expect(() => dispose()).not.toThrow();
  });
});
