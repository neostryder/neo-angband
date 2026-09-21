/** The explicit consent a mod needs before it changes final canvas pixels. */
export const VISUAL_FILTER_CAPABILITY = "display:filter";

/** Produces the overlay canvas element. Overridable so this stays testable off-DOM. */
export type VisualFilterCanvasFactory = () => HTMLCanvasElement;

/**
 * Applies a CSS post-processing filter to the game via a second, overlay
 * canvas mirroring #game's pixels - never by setting `filter` on #game
 * itself.
 *
 * WHY: #game's 2d context is created `{ alpha: false }` (term.ts) so the
 * compositor never has to blend it against anything behind it - free on a
 * small window, worth real milliseconds on Retina. Measured against the
 * installed desktop build (neo-angband#184), that same opaque-canvas path
 * makes Chromium composite `filter` as a no-op: `contrast()`/`saturate()`
 * applied directly to #game produced byte-identical pixels to no filter at
 * all, while `opacity` (a control) visibly changed the same canvas the same
 * way. An `alpha: true` canvas is not eligible for that bypass, so this
 * class keeps a second canvas in that mode, copies #game's latest frame onto
 * it every repaint, and puts the CSS filter there instead.
 *
 * LIFECYCLE: the overlay is created lazily on the first non-null filter and
 * then only ever hidden/shown afterwards, never destroyed - a filter toggle
 * is a display:none flip, not DOM churn. A player who never turns a filter
 * on never creates the overlay's canvas or its context at all.
 */
export class VisualFilterOverlay {
  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private active = false;

  constructor(
    private readonly source: HTMLCanvasElement,
    private readonly createCanvas: VisualFilterCanvasFactory = () => document.createElement("canvas"),
  ) {}

  /**
   * Apply a CSS filter (creating/showing the overlay), or clear it (hiding
   * the overlay again). #game's own `style.filter` is never touched by
   * either branch - it has no filter before this class exists and none
   * after, in every case.
   */
  setFilter(filter: string | null): void {
    if (filter === null) {
      this.active = false;
      if (this.overlay) this.overlay.style.display = "none";
      return;
    }
    this.active = true;
    if (!this.overlay) this.createOverlay();
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.style.display = "block";
    overlay.style.filter = filter;
    // Paint the current frame immediately rather than waiting for the next
    // repaint, so turning a filter on (e.g. from the options menu) shows its
    // effect at once instead of on whatever draws next.
    this.sync();
  }

  /**
   * Mirror #game's current pixel content and geometry onto the overlay. A
   * no-op while no filter is active - this is safe (and meant) to be called
   * on every single repaint via GlyphTerm.onRepaint.
   */
  sync(): void {
    if (!this.active || !this.overlay || !this.overlayCtx) return;
    const overlay = this.overlay;
    // Mirror the backing-store size (device pixels) and the CSS box
    // (position/left/top/width/height) term.ts's fit() sets on #game, so the
    // overlay always sits exactly over it at exactly its resolution - no
    // recomputation, just copying the numbers #game already carries.
    if (overlay.width !== this.source.width) overlay.width = this.source.width;
    if (overlay.height !== this.source.height) overlay.height = this.source.height;
    overlay.style.left = this.source.style.left;
    overlay.style.top = this.source.style.top;
    overlay.style.width = this.source.style.width;
    overlay.style.height = this.source.style.height;
    // A straight 1:1 device-pixel copy (overlay.width/height already match
    // source), so there is no scaling here for imageSmoothingEnabled to affect.
    this.overlayCtx.drawImage(this.source, 0, 0);
  }

  private createOverlay(): void {
    const overlay = this.createCanvas();
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "none";
    overlay.style.imageRendering = "pixelated";
    overlay.style.display = "none";
    // Immediately after #game, so it paints on top without needing a z-index.
    this.source.insertAdjacentElement("afterend", overlay);
    // alpha: true (the default) - deliberately the opposite of #game's own
    // context. This is the whole fix; never pass { alpha: false } here.
    const ctx = overlay.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("overlay canvas 2d context unavailable");
    this.overlay = overlay;
    this.overlayCtx = ctx;
  }
}
