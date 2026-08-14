/**
 * A region cannot write a cell outside its own rectangle.
 *
 * THIS IS THE GENERALISATION of what `hud-view.test.ts` already asserts for
 * core's own furniture (`section.clip === section.region.cells`). That test says
 * core agrees with core. This one says NO PAINTER, core's or a mod's, can reach
 * past its rectangle - which is the property a mod-created region has to have
 * before one can be allowed to exist at all.
 *
 * The double below is a real 80x24 cell grid rather than a call recorder, on
 * purpose: the question is what ENDED UP on the screen, and a recorder answers
 * a different one. A painter that wrote a cell and then erased it has not
 * trespassed, and a recorder would say it had.
 */

import { describe, expect, it } from "vitest";
import { clipSurface, clipSurfaceFault, type ClippableSurface } from "./region-surface";
import type { Glyph, TermSize } from "./term";

const COLS = 80;
const ROWS = 24;

/** A grid that records what is in each cell, and nothing else. */
class GridDouble implements ClippableSurface {
  readonly cells: (string | null)[][];
  cursor: { x: number; y: number } | null = null;
  /** Omitted entirely on the no-eraseSpan flavour: see clipSurfaceFault. */
  eraseSpan?: (x: number, y: number, len: number) => void;

  constructor(bounded: boolean, fill: string | null = null) {
    this.cells = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => fill),
    );
    if (bounded) {
      this.eraseSpan = (x, y, len): void => {
        const row = this.cells[y];
        if (!row) return;
        for (let cx = Math.max(0, x); cx < Math.min(COLS, x + len); cx++) row[cx] = null;
      };
    }
  }

  size(): TermSize {
    return { cols: COLS, rows: ROWS };
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
    if (!row || x < 0 || x >= COLS) return;
    row[x] = glyph.ch;
  }
  print(x: number, y: number, text: string, _fg: string): void {
    for (let i = 0; i < text.length; i++) this.put(x + i, y, { ch: text[i]!, fg: "#fff" });
  }
  eraseToEol(x: number, y: number): void {
    const row = this.cells[y];
    if (!row) return;
    for (let cx = Math.max(0, x); cx < COLS; cx++) row[cx] = null;
  }
  prt(x: number, y: number, text: string, fg: string): void {
    this.eraseToEol(x, y);
    this.print(x, y, text, fg);
  }
}

/** A window floating in the middle of the screen: nothing shares an edge. */
const WINDOW = { col: 20, row: 6, cols: 30, rows: 10 };

/** Every cell OUTSIDE `cells`, as "col,row:content", so a diff names the cell. */
function outside(grid: GridDouble, cells: typeof WINDOW): string[] {
  const out: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const within =
        col >= cells.col &&
        col < cells.col + cells.cols &&
        row >= cells.row &&
        row < cells.row + cells.rows;
      if (!within) out.push(`${col},${row}:${grid.cells[row]?.[col] ?? "-"}`);
    }
  }
  return out;
}

describe("clipSurface", () => {
  it("lets nothing a region draws land outside the region, however it draws", () => {
    /* THE LOAD-BEARING TEST. The whole screen starts as `#`; the region then
     * paints every way it knows how, deliberately overrunning every edge and
     * passing negative coordinates. Afterwards every cell outside the rectangle
     * must still be `#`. */
    const grid = new GridDouble(true, "#");
    const before = outside(grid, WINDOW);
    const s = clipSurface(grid, WINDOW);

    s.clear();
    s.print(0, 0, "x".repeat(200), "#fff"); // runs off the right
    s.print(-40, 1, "y".repeat(200), "#fff"); // starts off the left and runs off the right
    s.print(0, 999, "never", "#fff"); // below
    s.print(0, -3, "never", "#fff"); // above
    s.prt(5, 2, "z".repeat(200), "#fff"); // erase + print, both overrunning
    s.eraseToEol(0, 9); // last row of the region
    s.eraseToEol(-5, 3);
    for (let i = -5; i < 40; i++) s.put(i, 4, { ch: "p", fg: "#fff" });
    for (let j = -5; j < 20; j++) s.put(2, j, { ch: "q", fg: "#fff" });

    expect(outside(grid, WINDOW)).toEqual(before);
  });

  it("drops a put outside the region rather than folding it onto the edge", () => {
    /* FOUND BY A NEGATIVE CONTROL, and the reason to run them: the test above
     * cannot see clamping at all. A clamped write lands INSIDE the rectangle,
     * so an assertion about the cells outside it passes while the region is
     * quietly corrupting its own edge. Replacing the drop with a clamp left
     * this whole file green until this test existed.
     *
     * Clamping is also the worse of the two failures: it turns an author's
     * off-by-one into a garbled edge that reads as a rendering bug, where a
     * dropped character reads as the coordinate mistake it is. */
    const grid = new GridDouble(true, "#");
    const s = clipSurface(grid, WINDOW);
    s.clear();
    s.put(-1, 0, { ch: "L", fg: "#fff" }); // left of the region
    s.put(30, 0, { ch: "R", fg: "#fff" }); // right of it: 0..29 are inside
    s.put(0, -1, { ch: "U", fg: "#fff" }); // above
    s.put(0, 10, { ch: "D", fg: "#fff" }); // below: 0..9 are inside
    /* The region's own edge cells stayed empty - nothing was folded onto them. */
    expect(grid.cells[6]?.[20]).toBeNull();
    expect(grid.cells[6]?.[49]).toBeNull();
    expect(grid.cells[15]?.[20]).toBeNull();
    /* And nothing reached the neighbours, which is the other half. */
    expect(grid.cells[6]?.[19]).toBe("#");
    expect(grid.cells[6]?.[50]).toBe("#");
  });

  it("drops the overflowing tail of a string rather than clamping it", () => {
    /* Clamping is the tempting alternative and it is worse: it would pile the
     * overflow onto the region's last column, so an off-by-one in a mod would
     * show up as a garbled edge rather than as a missing character. Dropping
     * loses the same characters and loses them where the author is looking. */
    const grid = new GridDouble(true);
    clipSurface(grid, WINDOW).print(28, 0, "ABCDEF", "#fff");
    /* The region is 30 wide, so "AB" fit at local 28-29 and CDEF are gone -
     * NOT stacked on column 29, and NOT written past the region's edge. */
    expect(grid.cells[6]?.slice(46, 52)).toEqual([null, null, "A", "B", null, null]);
  });

  it("erases the rectangle and not the screen", () => {
    /* `term.clear()` was the only way a screen knew how to start, and every
     * screen called it. This method is the reason a screen can stop covering
     * the window. */
    const grid = new GridDouble(true, "#");
    clipSurface(grid, WINDOW).clear();
    expect(grid.cells[6]?.slice(19, 22)).toEqual(["#", null, null]);
    expect(grid.cells[6]?.slice(48, 51)).toEqual([null, null, "#"]);
    expect(grid.cells[5]?.[30]).toBe("#"); // the row above is untouched
    expect(grid.cells[16]?.[30]).toBe("#"); // and the row below
  });

  it("erases to the end of the REGION's row, not the terminal's", () => {
    const grid = new GridDouble(true, "#");
    clipSurface(grid, WINDOW).eraseToEol(10, 0);
    /* Local column 10 is absolute 30; the region ends at absolute 50. */
    expect(grid.cells[6]?.[29]).toBe("#");
    expect(grid.cells[6]?.[30]).toBeNull();
    expect(grid.cells[6]?.[49]).toBeNull();
    expect(grid.cells[6]?.[50]).toBe("#");
  });

  it("erases to null rather than to spaces, because a space occludes", () => {
    /* A space is a glyph that happens to look blank. A region erasing with
     * spaces would punch a white hole in whatever it is floating over, which is
     * the opposite of what "transparent means a cell that is not written" is
     * for. */
    const grid = new GridDouble(true, "#");
    clipSurface(grid, WINDOW).clear();
    expect(grid.cells[6]?.[25]).toBeNull();
    expect(grid.cells[6]?.[25]).not.toBe(" ");
  });

  it("answers the region's size, so a painter lays out to the rectangle", () => {
    /* The property that lets a painter written against the terminal be handed a
     * region with no change to its body at all. */
    expect(clipSurface(new GridDouble(true), WINDOW).size()).toEqual({ cols: 30, rows: 10 });
  });

  it("keeps the cursor inside the region", () => {
    /* A cursor parked outside would sit on a neighbour's cell and blink there,
     * which is a write by any other name. */
    const grid = new GridDouble(true);
    const s = clipSurface(grid, WINDOW);
    s.setCursor(3, 4);
    expect(grid.cursor).toEqual({ x: 23, y: 10 });
    s.setCursor(99, 4);
    expect(grid.cursor).toEqual({ x: 23, y: 10 }); // unchanged: dropped, not clamped
  });

  it("is byte-identical to an unbounded erase when the region IS the terminal", () => {
    /* Every core screen is this case, which is why a full-terminal region needs
     * nothing new and why the screen-owns-a-rectangle commit can be a no-op on
     * the pixels. Proved by running BOTH surfaces over the same painting and
     * comparing the grids, rather than by asserting it in prose. */
    const full = { col: 0, row: 0, cols: COLS, rows: ROWS };
    const direct = new GridDouble(false, "#");
    const viaRegion = new GridDouble(false, "#");
    for (const s of [direct as unknown as ReturnType<typeof clipSurface>, clipSurface(viaRegion, full)]) {
      s.clear();
      s.prt(0, 0, "Neo Angband", "#fff");
      s.print(4, 3, "an inventory listing that runs a fair way across", "#fff");
      s.eraseToEol(10, 3);
    }
    expect(viaRegion.cells).toEqual(direct.cells);
  });

  it("refuses a narrow region on a surface that cannot bound an erase", () => {
    /* The one degradation worth naming. A surface with neither `eraseSpan` nor
     * a right edge shared with the region cannot erase honestly - the only
     * remaining option is spaces, which occlude. Named with its numbers so the
     * report is actionable. */
    const bounded = new GridDouble(true);
    const plain = new GridDouble(false);
    const full = { col: 0, row: 0, cols: COLS, rows: ROWS };
    expect(clipSurfaceFault(bounded, WINDOW, COLS)).toBeUndefined();
    expect(clipSurfaceFault(plain, full, COLS)).toBeUndefined();
    expect(clipSurfaceFault(plain, WINDOW, COLS)).toBe(
      "surface cannot bound an erase: it has no eraseSpan, and the region ends at " +
        "column 50 of 80 rather than at the right edge",
    );
  });

  it("uses the bounded erase when the host offers one", () => {
    /* Otherwise the previous test's fault would be describing a condition
     * nothing acts on. Distinguished by result rather than by spying: the
     * bounded host leaves the cell past the region's edge alone. */
    const grid = new GridDouble(true, "#");
    clipSurface(grid, WINDOW).prt(0, 0, "hello", "#fff");
    expect(grid.cells[6]?.[50]).toBe("#");
  });
});
