/**
 * A surface a region cannot write outside of.
 *
 * WHY THIS IS THE WHOLE IMPLEMENTATION OF "transparent". Transparency here is
 * not a per-region alpha and not a null-glyph sentinel: it is A CELL THAT IS
 * NOT WRITTEN. The grid already spells "nothing here" as `null`, and a second
 * spelling would be a second rule. A cell holds one glyph - there is no blend
 * of `k` and `#` - and alpha is a pixel concept that is already available at the
 * pixel projection through CSS.
 *
 * The corollary is this module. If a region draws by not-writing the cells it
 * does not want, then the one thing that must become impossible is a region
 * wiping cells it does not own: `clear()` erasing the terminal, or an
 * `eraseToEol` running from the middle of a floating window to the right-hand
 * edge of the screen. `clipSurface` is what makes `term.clear()` unreachable
 * from inside a region.
 *
 * DROPPED, NOT CLAMPED. A write outside the rectangle is discarded. Clamping is
 * the tempting alternative and it is worse: it puts a mod's overflow onto
 * somebody else's cell, which turns an author's off-by-one into a corruption of
 * a neighbour that neither of them can see the cause of. Dropping loses the
 * same character, and loses it where the author is looking.
 *
 * COORDINATES ARE REGION-LOCAL. `size()` answers the region's size, so a
 * painter written against the terminal works unchanged against a rectangle -
 * which is the property that lets `showViewOnTerminal` be handed a region with
 * NO CHANGE TO ITS BODY AT ALL.
 */

import {
  regionContains,
  type RegionCells,
} from "./regions";
import type { Glyph, GridSpanErase, GridSurface, TermSize } from "./term";

/** A host surface that may or may not be able to bound an erase. */
export type ClippableSurface = GridSurface & Partial<GridSpanErase>;

/** Told, in region-local cells, about every cell this surface actually writes. */
export type CellWitness = (x: number, y: number) => void;

/**
 * Why this surface cannot bound a region to this rectangle, or undefined when
 * it can.
 *
 * THE ONE DEGRADATION WORTH NAMING. A region's `eraseToEol` must stop at the
 * region's right edge. There are exactly two ways to do that: the host offers
 * `eraseSpan` (`Term_erase(x, y, len)`), or the region's right edge already IS
 * the terminal's, in which case the unbounded erase is the bounded one and the
 * result is byte-identical. Every core screen is the second case, which is why
 * a full-terminal region needs nothing new.
 *
 * A surface with neither cannot host a narrow region honestly. It could erase
 * with SPACES instead, and that is the trap: a space is a glyph that happens to
 * look blank, so it occludes, and a floating window erasing with spaces punches
 * a white hole in the map it was meant to be floating over. Refusing at the
 * door is the only answer that does not lie about what was drawn.
 */
export function clipSurfaceFault(
  surface: ClippableSurface,
  cells: RegionCells,
  termCols: number,
): string | undefined {
  if (typeof surface.eraseSpan === "function") return undefined;
  if (cells.col + cells.cols >= termCols) return undefined;
  return (
    `surface cannot bound an erase: it has no eraseSpan, and the region ends at ` +
    `column ${cells.col + cells.cols} of ${termCols} rather than at the right edge`
  );
}

/**
 * Present `cells` of `surface` as a surface in its own right.
 *
 * The returned object is a `GridSurface`, so anything that paints a terminal
 * paints a region instead by being handed this and nothing else.
 */
export function clipSurface(
  surface: ClippableSurface,
  cells: RegionCells,
  witness?: CellWitness,
): GridSurface {
  /* Region-local (x, y) -> is it inside? Written against the same predicate the
   * stack uses, at the origin, so "inside a region" has one definition. */
  const inside = (x: number, y: number): boolean =>
    regionContains({ col: 0, row: 0, cols: cells.cols, rows: cells.rows }, x, y);

  /** How many cells remain to the region's right edge from a local column. */
  const spanFrom = (x: number): number => cells.cols - Math.max(0, x);

  const eraseRow = (x: number, y: number): void => {
    if (y < 0 || y >= cells.rows) return;
    if (witness) {
      for (let x2 = Math.max(0, x); x2 < cells.cols; x2++) witness(x2, y);
    }
    const from = cells.col + Math.max(0, x);
    if (typeof surface.eraseSpan === "function") {
      surface.eraseSpan(from, cells.row + y, spanFrom(x));
      return;
    }
    /* No bounded erase. Honest only when this right edge is the host's - see
     * clipSurfaceFault, which a caller is expected to have consulted. Doing it
     * anyway rather than silently skipping: a region that never erases leaves
     * the previous frame's text under its own, which reads as corruption. */
    surface.eraseToEol(from, cells.row + y);
  };

  return {
    /* The region's own size, which is the whole point: a painter that asks the
     * terminal how big it is gets the rectangle's answer and lays out to fit. */
    size(): TermSize {
      return { cols: cells.cols, rows: cells.rows };
    },

    invalidate(): void {
      surface.invalidate();
    },

    flush(): void {
      surface.flush();
    },

    /**
     * ERASES THE RECTANGLE, NOT THE SCREEN. This single method is why a screen
     * can stop covering the window: `term.clear()` was the only way a screen
     * knew how to start, and every one of them called it.
     */
    clear(): void {
      for (let y = 0; y < cells.rows; y++) eraseRow(0, y);
    },

    setCursor(x: number, y: number): void {
      /* A cursor parked outside the region would sit on a neighbour's cell and
       * blink there, which is a write by any other name. It does not witness:
       * a cursor changes no cell's contents, so it must not claim pointer input. */
      if (!inside(x, y)) return;
      surface.setCursor(cells.col + x, cells.row + y);
    },

    hideCursor(): void {
      surface.hideCursor();
    },

    put(x: number, y: number, glyph: Glyph): void {
      if (!inside(x, y)) return;
      witness?.(x, y);
      surface.put(cells.col + x, cells.row + y, glyph);
    },

    print(x: number, y: number, text: string, fg: string, bg?: string): void {
      if (y < 0 || y >= cells.rows) return;
      /* Clip the STRING and hand the host one call, rather than looping put():
       * a host may have a fast path for a run of characters, and clipping here
       * keeps whatever it is. The visible span is [from, to) in local columns. */
      const from = Math.max(x, 0);
      const to = Math.min(x + text.length, cells.cols);
      if (to <= from) return;
      if (witness) {
        for (let x2 = from; x2 < to; x2++) witness(x2, y);
      }
      const visible = text.slice(from - x, to - x);
      surface.print(cells.col + from, cells.row + y, visible, fg, bg);
    },

    /** To the end of the REGION's row. */
    eraseToEol(x: number, y: number): void {
      eraseRow(x, y);
    },

    /**
     * Erase then print, preserving upstream's prt-versus-put_str distinction
     * inside a region exactly as `GlyphTerm.prt` does outside one. Composed
     * from this object's own two methods rather than delegating to the host's
     * `prt`, because the host's would erase to the HOST's end of line.
     */
    prt(x: number, y: number, text: string, fg: string): void {
      this.eraseToEol(x, y);
      this.print(x, y, text, fg);
    },
  };
}
