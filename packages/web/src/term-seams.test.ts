/**
 * Where a repainted cell's EDGES land, which is a different question from which
 * cells get repainted (term-overdraw.test.ts) and from what ends up on the
 * screen (term.test.ts). Nothing else asks it, and it is invisible to both.
 *
 * THE DEFECT, MEASURED. cellW/cellH/offsetX/offsetY are whole CSS pixels and the
 * context carries `setTransform(dpr, ...)`, so on a fractional device-pixel
 * ratio a cell's edge fell PART-WAY THROUGH a device pixel. Repainting the cell
 * covered only part of that pixel; the rest still held the previous screen. The
 * renderer repaints only changed cells, so the neighbour owning the other half
 * was never touched and the stale half survived indefinitely.
 *
 * Going title screen -> update page -> ESC back on the shipped 0.16.1 desktop
 * build left 118,452 differing pixels against the first paint of the same
 * screen - 1.43% of a 3841x2161 canvas, peak channel delta 122 of 765 - in a
 * lattice of cell outlines. The measured seam pitch was 47.24 and 71.55 device
 * pixels: fractional, which is the signature. The first frame always looked
 * right because it follows a full-canvas fill.
 *
 * A pixel assertion cannot be written here (no jsdom, no real canvas - see
 * help.test.ts), so the GEOMETRY is asserted instead, against a context that
 * records the rectangles it is handed. Two properties matter and neither is
 * visible to a screenshot of a single frame:
 *
 *   1. every cell's edges land on whole device pixels, and
 *   2. neighbours TILE - one cell's right edge is exactly the next one's left.
 *
 * Property 2 is why the edges are ROUNDED rather than grown outward: floor/ceil
 * would also erase the residue, by making every cell overwrite a device pixel
 * of each neighbour and clip its glyph.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GlyphTerm } from "./term";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const rects: Rect[] = [];
const images: Rect[] = [];

function recordingCtx(): CanvasRenderingContext2D {
  return {
    setTransform: () => undefined,
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
    strokeRect: () => undefined,
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
      images.push({ x, y, w, h });
    },
    fillText: () => undefined,
    measureText: (t: string) => ({ width: t.length * 8 }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    imageSmoothingEnabled: false,
    textBaseline: "top",
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

function stubCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => recordingCtx(),
    addEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
  } as unknown as HTMLCanvasElement;
}

const saved: Record<string, unknown> = {};

/**
 * 1.1 is not an arbitrary awkward number: it is the ratio of the Windows box
 * the overdraw work was measured on, and the one the residue was captured on.
 * At dpr 1 or 2 every cell edge is already whole and the defect cannot appear -
 * a test that only ran at those would have passed throughout.
 */
function useDpr(dpr: number): void {
  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: dpr,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

beforeEach(() => {
  for (const k of ["window", "document", "ResizeObserver"]) {
    saved[k] = (globalThis as Record<string, unknown>)[k];
  }
  useDpr(1.1);
  (globalThis as Record<string, unknown>).document = {
    documentElement: {},
    createElement: () => stubCanvas(),
  };
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe(): void {
      /* nothing here ever resizes */
    }
  };
  rects.length = 0;
  images.length = 0;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    (globalThis as Record<string, unknown>)[k] = v;
  }
});

function makeTerm(): GlyphTerm {
  return new GlyphTerm(stubCanvas(), {
    minCols: 32,
    minRows: 18,
    fontPx: 18,
    reflow: false,
    bitmapFont: null,
  });
}

/** The cell fills of one frame, ignoring the full-canvas clear (much bigger). */
function cellFills(): Rect[] {
  const term = { w: 0, h: 0 };
  for (const r of rects) if (r.w > term.w) term.w = r.w;
  /* The full-canvas fill is the one as wide as the canvas; cells are far
   * smaller. Filtering on width alone is enough and needs no bookkeeping. */
  return rects.filter((r) => r.w < term.w);
}

describe("cell edges land on device pixels", () => {
  it("snaps every repainted cell to whole device pixels at a fractional dpr", () => {
    const dpr = 1.1;
    const term = makeTerm();
    term.clear();
    term.print(0, 0, "abcdefghij", "#c8c8d4");
    term.print(0, 1, "klmnopqrst", "#c8c8d4");
    term.flush();

    const cells = cellFills();
    expect(cells.length, "the frame has to have painted some cells").toBeGreaterThan(10);

    for (const r of cells) {
      for (const [edge, v] of [
        ["left", r.x],
        ["top", r.y],
        ["right", r.x + r.w],
        ["bottom", r.y + r.h],
      ] as const) {
        const device = v * dpr;
        expect(
          Math.abs(device - Math.round(device)),
          `${edge} edge at CSS ${v} is device ${device}, which is between pixels`,
        ).toBeLessThan(1e-6);
      }
    }
  });

  it("tiles: one cell's right edge is exactly the next cell's left edge", () => {
    const term = makeTerm();
    term.clear();
    /* A run along one row, so consecutive fills are horizontal neighbours. */
    term.print(0, 3, "0123456789", "#c8c8d4");
    term.flush();

    const row = cellFills().filter((r) => r.h > 0);
    expect(row.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < 10; i++) {
      const prev = row[i - 1];
      const cur = row[i];
      if (!prev || !cur) throw new Error("missing cell fill");
      expect(cur.y, "same row").toBeCloseTo(prev.y, 9);
      /* No gap (residue survives in it) and no overlap (clips the neighbour). */
      expect(cur.x, `cell ${i} must start where cell ${i - 1} ended`).toBeCloseTo(
        prev.x + prev.w,
        9,
      );
    }
  });

  it("covers the row end to end, so the union has no unpainted seams", () => {
    const term = makeTerm();
    const { cols } = term.size();
    term.clear();
    term.print(0, 5, "#".repeat(cols), "#c8c8d4");
    term.flush();

    const row = cellFills();
    const painted = row.filter((r) => Math.abs(r.y - (row[0]?.y ?? 0)) < 1e-9);
    const left = Math.min(...painted.map((r) => r.x));
    const right = Math.max(...painted.map((r) => r.x + r.w));
    const covered = painted.reduce((n, r) => n + r.w, 0);
    /* Sum of widths equals the span exactly: every point between the first and
     * last edge belongs to exactly one cell. */
    expect(covered).toBeCloseTo(right - left, 6);
  });

  it("still snaps when dpr is a whole number, where it is a no-op", () => {
    /* Guards against a fix that only works on the ratio it was written for. */
    for (const dpr of [1, 2, 3]) {
      useDpr(dpr);
      rects.length = 0;
      const term = makeTerm();
      term.clear();
      term.print(0, 0, "xyz", "#c8c8d4");
      term.flush();
      for (const r of cellFills()) {
        expect(Math.abs(r.x * dpr - Math.round(r.x * dpr))).toBeLessThan(1e-6);
        expect(Math.abs((r.x + r.w) * dpr - Math.round((r.x + r.w) * dpr))).toBeLessThan(1e-6);
      }
    }
  });

  it("paints no more cells than before, so the overdraw budget is untouched", () => {
    /* The fix is about WHERE edges land, not which cells are painted. If it ever
     * starts dirtying neighbours to hide a seam, this is what says so. */
    const term = makeTerm();
    term.clear();
    term.print(0, 0, "hello", "#c8c8d4");
    term.flush();
    const before = term.paintStats().cells;
    term.print(2, 0, "L", "#ffffff");
    term.flush();
    expect(term.paintStats().cells - before).toBe(1);
  });
});
