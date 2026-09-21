/**
 * GlyphTerm.onRepaint: the hook the visual-filter overlay (visual-filter.ts,
 * neo-angband#184) uses to learn a new frame landed on #game, so it can
 * mirror it onto its own alpha-enabled canvas. Every mutator in this class
 * only touches the grid model and calls schedule()/flush() (see term.ts's
 * own comment on `shown`), so flush() is the one point every repaint - a
 * grid write, a cursor move, a resize, a font swap - actually converges on.
 * This file proves onRepaint fires exactly there, for both the queued
 * (microtask) and synchronous (fit()) paths, and not otherwise.
 *
 * No jsdom in this test environment (see term.test.ts's own note), so
 * window/document/ResizeObserver are stubbed the same way term-seams.test.ts
 * already does to construct a real GlyphTerm off-DOM.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GlyphTerm } from "./term";

function recordingCtx(): CanvasRenderingContext2D {
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
    getContext: () => recordingCtx(),
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
      /* nothing here ever resizes */
    }
  };
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

describe("GlyphTerm.onRepaint", () => {
  it("fires once the queued flush from a grid write actually lands", async () => {
    const term = makeTerm();
    let calls = 0;
    term.onRepaint(() => calls++);
    term.put(0, 0, { ch: "@", fg: "#fff" });
    // schedule() only queues a microtask here; flush() has not run yet.
    expect(calls).toBe(0);
    await Promise.resolve();
    expect(calls).toBe(1);
  });

  it("fires synchronously for a resize, since fit() flushes inline", () => {
    const term = makeTerm();
    let calls = 0;
    term.onRepaint(() => calls++);
    // setReflow forces fit(true), which calls flush() before returning.
    term.setReflow({ cellHeight: 20, minCols: 32, minRows: 18, snapViewportToEven: false });
    expect(calls).toBe(1);
  });

  it("fires once per flush, not once per dirtied cell", async () => {
    const term = makeTerm();
    let calls = 0;
    term.onRepaint(() => calls++);
    term.put(0, 0, { ch: "@", fg: "#fff" });
    term.put(1, 0, { ch: "!", fg: "#fff" });
    term.put(2, 0, { ch: "?", fg: "#fff" });
    await Promise.resolve();
    expect(calls).toBe(1); // one microtask, one flush, one notification
  });

  it("stops firing once the returned disposer is called", async () => {
    const term = makeTerm();
    let calls = 0;
    const unsubscribe = term.onRepaint(() => calls++);
    unsubscribe();
    term.put(0, 0, { ch: "@", fg: "#fff" });
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  it("costs nothing behaviourally for a term with no subscribers", () => {
    const term = makeTerm();
    expect(() => term.invalidate()).not.toThrow();
  });
});
