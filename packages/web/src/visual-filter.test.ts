/**
 * VisualFilterOverlay: neo-angband#184's fix. #game's `alpha: false` 2d
 * context does not composite a CSS `filter` in Chromium (measured pixel-for-
 * pixel against the installed desktop build - identical output filtered vs
 * not, while a control `opacity` toggle DID change the same canvas). This
 * class mirrors #game's pixels onto a second, `alpha: true` overlay canvas
 * and applies the filter there instead, so #game itself must never carry a
 * `filter` style - that is the one invariant every test here is ultimately
 * checking for.
 *
 * No jsdom in this test environment (see term.test.ts), so the overlay
 * canvas is a plain recording stub rather than a real DOM element - the same
 * approach term-seams.test.ts uses for GlyphTerm's own canvas.
 */
import { describe, expect, it, vi } from "vitest";
import { VISUAL_FILTER_CAPABILITY, VisualFilterOverlay } from "./visual-filter";

interface StubCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  getContext: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  insertAdjacentElement: ReturnType<typeof vi.fn>;
}

function stubSource(): StubCanvas {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: vi.fn(),
    setAttribute: vi.fn(),
    insertAdjacentElement: vi.fn(),
  };
}

function stubOverlay(): { canvas: StubCanvas; drawImage: ReturnType<typeof vi.fn> } {
  const drawImage = vi.fn();
  const canvas: StubCanvas = {
    width: 0,
    height: 0,
    style: {},
    setAttribute: vi.fn(),
    insertAdjacentElement: vi.fn(),
    getContext: vi.fn(() => ({ drawImage })),
  };
  return { canvas, drawImage };
}

/** Wires an overlay factory that always hands back the same stub canvas. */
function makeOverlay(source: StubCanvas): {
  overlay: VisualFilterOverlay;
  overlayCanvas: StubCanvas;
  drawImage: ReturnType<typeof vi.fn>;
  createCanvas: ReturnType<typeof vi.fn>;
} {
  const { canvas: overlayCanvas, drawImage } = stubOverlay();
  const createCanvas = vi.fn(() => overlayCanvas as unknown as HTMLCanvasElement);
  const overlay = new VisualFilterOverlay(source as unknown as HTMLCanvasElement, createCanvas);
  return { overlay, overlayCanvas, drawImage, createCanvas };
}

describe("VISUAL_FILTER_CAPABILITY", () => {
  it("is the display:filter capability id", () => {
    expect(VISUAL_FILTER_CAPABILITY).toBe("display:filter");
  });
});

describe("VisualFilterOverlay", () => {
  it("creates no overlay canvas until a filter is actually set", () => {
    const source = stubSource();
    const { createCanvas, overlay } = makeOverlay(source);
    expect(createCanvas).not.toHaveBeenCalled();
    // sync() before any filter is set must be a true no-op.
    overlay.sync();
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("creates the overlay lazily on first setFilter, and reuses it on later calls", () => {
    const source = stubSource();
    const { overlay, createCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.55) saturate(1.2)");
    expect(createCanvas).toHaveBeenCalledTimes(1);
    overlay.setFilter("contrast(2)");
    overlay.setFilter(null);
    overlay.setFilter("contrast(1.1)");
    expect(createCanvas).toHaveBeenCalledTimes(1); // never recreated, only shown/hidden
  });

  it("applies the filter string to the overlay's own style, and shows it", () => {
    const source = stubSource();
    const { overlay, overlayCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.55) saturate(1.2)");
    expect(overlayCanvas.style.filter).toBe("contrast(1.55) saturate(1.2)");
    expect(overlayCanvas.style.display).not.toBe("none");
  });

  it("hides the overlay on setFilter(null) without destroying it", () => {
    const source = stubSource();
    const { overlay, overlayCanvas, createCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)");
    overlay.setFilter(null);
    expect(overlayCanvas.style.display).toBe("none");
    expect(createCanvas).toHaveBeenCalledTimes(1); // still just the one canvas, hidden not torn down
  });

  it("never sets a filter style on the source (#game) canvas, in any state", () => {
    const source = stubSource();
    const { overlay } = makeOverlay(source);
    overlay.setFilter("contrast(1.55) saturate(1.2)");
    overlay.sync();
    overlay.setFilter("contrast(2)");
    overlay.setFilter(null);
    expect(source.style.filter).toBeUndefined();
  });

  it("mirrors the source canvas's pixels onto the overlay via drawImage on sync", () => {
    const source = stubSource();
    const { overlay, drawImage } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)"); // setFilter syncs once immediately
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
    drawImage.mockClear();
    overlay.sync();
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
  });

  it("does not draw on sync once the filter is cleared", () => {
    const source = stubSource();
    const { overlay, drawImage } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)");
    drawImage.mockClear();
    overlay.setFilter(null);
    overlay.sync();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("sizes and positions the overlay to exactly match #game on every sync", () => {
    const source = stubSource();
    source.width = 3841;
    source.height = 2161;
    source.style.left = "12px";
    source.style.top = "0px";
    source.style.width = "1920px";
    source.style.height = "1080px";
    const { overlay, overlayCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)");
    expect(overlayCanvas.width).toBe(3841);
    expect(overlayCanvas.height).toBe(2161);
    expect(overlayCanvas.style.left).toBe("12px");
    expect(overlayCanvas.style.top).toBe("0px");
    expect(overlayCanvas.style.width).toBe("1920px");
    expect(overlayCanvas.style.height).toBe("1080px");

    // A later resize of #game (term.ts's fit()) is picked up on the next sync.
    source.width = 1280;
    source.height = 800;
    source.style.left = "0px";
    source.style.width = "1280px";
    source.style.height = "800px";
    overlay.sync();
    expect(overlayCanvas.width).toBe(1280);
    expect(overlayCanvas.height).toBe(800);
    expect(overlayCanvas.style.left).toBe("0px");
    expect(overlayCanvas.style.width).toBe("1280px");
    expect(overlayCanvas.style.height).toBe("800px");
  });

  it("gets an alpha-enabled context - the opposite of #game's alpha:false one", () => {
    const source = stubSource();
    const { overlay, overlayCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)");
    expect(overlayCanvas.getContext).toHaveBeenCalledWith("2d", { alpha: true });
  });

  it("marks the overlay non-interactive and out of the accessibility tree", () => {
    const source = stubSource();
    const { overlay, overlayCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)");
    expect(overlayCanvas.style.pointerEvents).toBe("none");
    expect(overlayCanvas.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
  });

  it("attaches the overlay immediately after #game so it paints on top", () => {
    const source = stubSource();
    const { overlay, overlayCanvas } = makeOverlay(source);
    overlay.setFilter("contrast(1.5)");
    expect(source.insertAdjacentElement).toHaveBeenCalledWith("afterend", overlayCanvas);
  });
});
