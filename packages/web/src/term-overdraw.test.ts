/**
 * How much the terminal actually draws, gated rather than reviewed.
 *
 * THE DEFECT, MEASURED. Every mutator used to paint straight to the canvas, so a
 * single move of the player cost **1,469 cell paints** - each one a `fillRect`
 * plus a `drawImage` - and a full-canvas fill on top, for an 80x24 grid that had
 * changed in about a dozen places. Angband is turn-based, so that landed on every
 * keypress: a 3.4 ms median of synchronous canvas work per move on a Windows box
 * at devicePixelRatio 1.1, with a 12.4 ms tail. A Retina Mac pushes 3.3x the
 * pixels through the same calls, which is where "each move has a many
 * milliseconds lag on an M4" came from.
 *
 * With the grid diffed against what is on the canvas, the same twenty moves cost
 * **140 cell paints** each and no full-canvas fill at all - a median of 1.7 ms
 * with a 2.2 ms tail, both measured in a browser through `__neo.paints()`.
 *
 * A number that good is a number that rots. `clear()` painting eagerly again, a
 * mutator calling `paintCell` directly, a glyph comparison that forgets a field -
 * each would restore the old cost and none would fail a test about what is ON the
 * screen, because the pixels would be identical. So the COUNT is asserted.
 *
 * No jsdom in this repo (help.test.ts explains why); the stubs below are the
 * smallest canvas and window GlyphTerm will construct against.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GlyphTerm, type Glyph, type RenderAssetRef } from "./term";

/** A 2D context that records nothing and refuses nothing. */
function stubCtx(): CanvasRenderingContext2D {
  return {
    setTransform: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    drawImage: () => undefined,
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
    getContext: () => stubCtx(),
    addEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
  } as unknown as HTMLCanvasElement;
}

const saved: Record<string, unknown> = {};

beforeEach(() => {
  for (const k of ["window", "document", "ResizeObserver"]) {
    saved[k] = (globalThis as Record<string, unknown>)[k];
  }
  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as Record<string, unknown>).document = {
    documentElement: {},
    createElement: () => stubCanvas(),
  };
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe(): void {
      /* the term observes documentElement; nothing here ever resizes */
    }
  };
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    (globalThis as Record<string, unknown>)[k] = v;
  }
});

/** A term with the bitmap font off, so paintCell takes the fillText path. */
function makeTerm(): GlyphTerm {
  return new GlyphTerm(stubCanvas(), {
    minCols: 32,
    minRows: 18,
    fontPx: 18,
    reflow: false,
    bitmapFont: null,
  });
}

/** Paint a whole 80x24 screenful of text, the way one frame of the game does. */
function paintScreen(term: GlyphTerm, tag = "."): void {
  const { cols, rows } = term.size();
  term.clear();
  for (let y = 0; y < rows; y++) term.print(0, y, tag.repeat(cols), "#c8c8d4");
}

describe("the terminal paints the difference, not the screen", () => {
  it("costs nothing at all to draw the same frame twice", () => {
    const term = makeTerm();
    paintScreen(term);
    term.flush();
    const first = term.paintStats();
    expect(first.cells, "the first frame has to paint every cell").toBeGreaterThan(1900);

    /* The identical frame again - clear() and all. This is the shape of a
     * keypress that changes nothing visible (a rejected command, a menu
     * repainting after a key it ignored), and it used to cost a full-canvas
     * fill plus 1,920 cell paints. */
    paintScreen(term);
    term.flush();
    expect(term.paintStats().cells - first.cells).toBe(0);
    expect(term.paintStats().redraws - first.redraws).toBe(0);
  });

  it("costs one cell to change one cell", () => {
    const term = makeTerm();
    paintScreen(term);
    term.flush();
    const before = term.paintStats().cells;
    term.print(5, 5, "@", "#ffffff");
    term.flush();
    expect(term.paintStats().cells - before).toBe(1);
  });

  it("charges for a colour change, not just a glyph change", () => {
    /* The comparison has to look at every field that reaches the canvas. A
     * `ch`-only compare would leave a monster the wrong colour after it woke up. */
    const term = makeTerm();
    term.print(1, 1, "k", "#00ff00");
    term.flush();
    const before = term.paintStats().cells;
    term.print(1, 1, "k", "#ff0000");
    term.flush();
    expect(term.paintStats().cells - before).toBe(1);
  });

  it("does not coalesce two different frames into one", () => {
    /* The flush is queued on a microtask, and the danger of queueing is dropping
     * an intermediate state. Two flushes, two costs. */
    const term = makeTerm();
    term.print(0, 0, "a", "#ffffff");
    term.flush();
    term.print(0, 0, "b", "#ffffff");
    term.flush();
    term.print(0, 0, "c", "#ffffff");
    term.flush();
    expect(term.paintStats().cells).toBe(3);
  });

  it("repaints a cell the cursor leaves, and only that one", () => {
    /* The cursor is a stroked frame over a cell, so moving it has to repaint
     * what it was covering - a change no glyph diff can see. */
    const term = makeTerm();
    paintScreen(term);
    term.setCursor(3, 3);
    term.flush();
    const before = term.paintStats().cells;
    term.setCursor(4, 3);
    term.flush();
    expect(term.paintStats().cells - before).toBe(1);
  });

  it("only does a whole-canvas repaint when told to", () => {
    const term = makeTerm();
    paintScreen(term);
    term.flush();
    const before = term.paintStats();
    /* A tile set finishing its load: the grid is unchanged and the pixels are
     * not, so this is the one thing that has to bypass the diff. */
    term.invalidate();
    term.flush();
    const after = term.paintStats();
    expect(after.redraws - before.redraws).toBe(1);
    expect(after.cells - before.cells).toBeGreaterThan(1900);
  });

  it("a tile redraws when its key changes and not when it does not", () => {
    /* tileDrawFor allocates a fresh closure per cell per frame, so identity says
     * "changed" about every tile on screen, every frame. The key is what two
     * frames of the same dungeon have in common. */
    const term = makeTerm();
    const tile = (key: string): RenderAssetRef => ({ kind: "test", key, data: null });
    const cell = (t: RenderAssetRef): Glyph => ({ ch: "#", fg: "#888888", tile: t });

    term.put(2, 2, cell(tile("101@4,4")));
    term.flush();
    const painted = term.paintStats().cells;

    term.put(2, 2, cell(tile("101@4,4"))); // a DIFFERENT object, the same picture
    term.flush();
    expect(term.paintStats().cells - painted).toBe(0);

    term.put(2, 2, cell(tile("101@5,4"))); // the pool can differ by position
    term.flush();
    expect(term.paintStats().cells - painted).toBe(1);
  });

  it("always repaints a tile that has no key", () => {
    /* Conservative on purpose: a tileset that is not ready hands out keyless
     * draws, and the frame after it loads must not be skipped. */
    const term = makeTerm();
    const keyless: Glyph = { ch: "#", fg: "#888888", tile: { kind: "test", data: null } };
    term.put(2, 2, keyless);
    term.flush();
    const painted = term.paintStats().cells;
    term.put(2, 2, { ...keyless, tile: { kind: "test", data: null } });
    term.flush();
    expect(term.paintStats().cells - painted).toBe(1);
  });

  it("flushes on its own at the end of the task, with no flush() call", () => {
    /* The game never calls flush(); it draws inside a keydown handler and the
     * microtask at the end of that handler is the frame boundary. */
    const term = makeTerm();
    term.print(0, 0, "x", "#ffffff");
    const beforeMicrotask = term.paintStats().cells;
    expect(beforeMicrotask, "nothing should paint synchronously").toBe(0);
    return Promise.resolve().then(() => {
      expect(term.paintStats().cells).toBe(1);
    });
  });
});
