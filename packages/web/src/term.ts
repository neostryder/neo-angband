/**
 * A glyph-grid renderer on canvas, the browser stand-in for the curses main
 * term (ui-term.c). By default it is a FIXED 80x24 addressable grid (D3 /
 * REND-1): upstream Angband draws every screen against an exact 80-column,
 * 24-row terminal (status line rows 22/23, message row 0, right-aligned
 * inventory, store column stops), so the port must present the same fixed grid
 * for those placements to land. The grid is drawn at the largest integer cell
 * size that fits the window and CENTERED (letterboxed) - the area around it is
 * background fill, exactly as a real terminal letterboxes a fixed character
 * matrix in a larger window.
 *
 * Viewport reflow (the old responsive floor(w/cellW) x floor(h/cellH) grid) is
 * NOT the base any more; it is an explicit opt-in (`reflow: true`) for a future
 * mobile QoL mod. With reflow off, cols/rows are always the fixed FIXED_COLS x
 * FIXED_ROWS.
 */

/**
 * An optional graphics tile attached to a cell. When present (and its draw
 * succeeds) the cell is blitted as a tile instead of drawing the ASCII glyph;
 * draw returns false when the atlas image is not ready, so the cell falls back
 * to its ch/fg text. Kept as a small interface so the terminal stays decoupled
 * from the tileset implementation (tiles.ts).
 */
import { UI_BG, UI_GOLD } from "./ui-colors";
import { FONT_16X24, type BitmapFontData } from "./font-16x24";
/* Type-only, and it points the other way from the usual dependency: regions.ts
 * knows nothing about a canvas, so the geometry contract lives beside the
 * consumer that needs it rather than inside the renderer that answers it. */
import type { GridGeometry, GridPixelMetrics } from "./regions";

/**
 * A renderer-neutral reference to art associated with a grid cell.  The grid
 * owns the meaning ("this cell has this asset"), while the selected renderer
 * owns how that asset is painted.  `data` deliberately has no Canvas2D type:
 * a DOM, WebGL, or test renderer can consume the same grid without manufacturing
 * a 2d context.
 */
export interface RenderAssetRef {
  readonly kind: string;
  readonly key?: string;
  readonly data: unknown;
  /**
   * This asset also paints into the cell ABOVE its own - a double-height tile
   * (is_dh_tile, grafmode.c L241). Bottom-anchored: the cell it is queued at is
   * the LOWER half, and the upper half overdraws (x, y-1).
   *
   * It lives on the ref rather than inside `data` because the terminal has to
   * answer "does this asset draw above itself?" without knowing what a tile is
   * - the frame diff needs it (expandTallDirty below) and so does any
   * replacement front end.
   */
  readonly tall?: boolean;
}

/** Does this cell's content overdraw the cell above it? Either layer can. */
export function glyphIsTall(g: Glyph | null | undefined): boolean {
  return (g?.tile?.tall ?? false) || (g?.bgTile?.tall ?? false);
}

/**
 * pr_drw (ui-term.c L915-960): grow a dirty set so a double-height tile and the
 * cell it overdraws stay consistent. Pure, so it is testable without a canvas.
 *
 * Two rules, and BOTH are needed - each covers a smear the other leaves:
 *
 *  - `(x,y)` is dirty and is tall in the OLD or the NEW frame -> `(x, y-1)`
 *    joins. Without this an upper half survives after the tall tile leaves,
 *    because painting `(x,y)` only clears `(x,y)`.
 *  - `(x, y-1)` is dirty and `(x,y)` is tall in either frame -> `(x,y)` joins.
 *    Without this, clearing the upper cell erases a still-current tall tile's
 *    upper half and nothing repaints it, the anchor's own glyph not having
 *    changed.
 *
 * The second rule can dirty a new anchor whose own upper cell was clean, which
 * re-triggers the first, so this iterates to a fixed point. The chain is
 * bounded by the column height and in practice settles in one pass.
 */
export function expandTallDirty(
  dirty: Set<number>,
  cols: number,
  rows: number,
  isTall: (x: number, y: number) => boolean,
): void {
  const key = (x: number, y: number): number => y * cols + x;
  let frontier = [...dirty];
  while (frontier.length > 0) {
    const next: number[] = [];
    const add = (x: number, y: number): void => {
      if (y < 0 || y >= rows || x < 0 || x >= cols) return;
      const k = key(x, y);
      if (dirty.has(k)) return;
      dirty.add(k);
      next.push(k);
    };
    for (const k of frontier) {
      const x = k % cols;
      const y = (k - x) / cols;
      if (isTall(x, y)) add(x, y - 1);
      if (isTall(x, y + 1)) add(x, y + 1);
    }
    frontier = next;
  }
}

export interface Glyph {
  ch: string;
  fg: string;
  bg?: string;
  /** When set, blit this tile in place of the ASCII glyph (ASCII on failure). */
  tile?: RenderAssetRef;
  /**
   * The TERRAIN tile under `tile`, blitted first so an alpha foreground tile
   * shows the floor through its transparent pixels instead of the cell's flat
   * background colour.
   *
   * This is grid_data_as_text's (tap, tcp) pair: the feature's attr/char, saved
   * "for the transparency effects" BEFORE traps, objects, monsters and the
   * player overwrite (ap, cp) (ui-map.c L186-189). The front ends blit the
   * terrain tile and then, only when the foreground pair differs, the
   * foreground tile over it (Term_pict_sdl, main-sdl.c L5511-5540; the same
   * two-pass shape in main-win.c and main-sdl2.c). Callers therefore leave this
   * undefined when the terrain IS the top layer, which is upstream's
   * `if ((tap[i] == ap[i]) && (tcp[i] == cp[i])) continue;`.
   */
  bgTile?: RenderAssetRef;
}

export interface TermSize {
  cols: number;
  rows: number;
}

/** One serialized grid cell for appearance-parity snapshots (snapshotColored). */
export interface ColoredCell {
  ch: string;
  fg: string;
  bg?: string;
}

export interface GridCell {
  readonly col: number;
  readonly row: number;
}

/** The common terminal-grid contract; no implementation detail leaks through it. */
export interface GridSurface {
  size(): TermSize;
  invalidate(): void;
  /** Commit queued work now; callers use this as a visible-progress fence. */
  flush(): void;
  clear(): void;
  setCursor(x: number, y: number): void;
  hideCursor(): void;
  put(x: number, y: number, glyph: Glyph): void;
  print(x: number, y: number, text: string, fg: string, bg?: string): void;
  eraseToEol(x: number, y: number): void;
  /** Erase through the end of the row, then print. */
  prt(x: number, y: number, text: string, fg: string): void;
}

/** Pointer delivery is optional for a grid renderer, and owns one active modal tap. */
export interface GridPointerInput {
  onCellTap(listener: (cell: GridCell) => void): () => void;
}

const activeCellTaps = new WeakMap<GridPointerInput, () => void>();

/**
 * Preserve the terminal modal protocol while using subscriptions: there is one
 * active modal owner, and replacing it always disposes the previous listener.
 */
export function setActiveCellTap(
  input: GridPointerInput,
  listener: ((cell: GridCell) => void) | null,
): void {
  /* Old test doubles (and only test doubles) may be structurally cast from the
   * pre-split terminal. Production consumers require GridPointerInput in their
   * type, but preserving keyboard-only tests keeps the former no-touch path
   * observable while those doubles migrate. */
  if (typeof input.onCellTap !== "function") return;
  activeCellTaps.get(input)?.();
  activeCellTaps.delete(input);
  if (!listener) return;
  const dispose = input.onCellTap(listener);
  /* Compatibility for pre-split test doubles. Real GridPointerInput providers
   * return a disposer; the fallback is never selected by GlyphTerm. */
  activeCellTaps.set(
    input,
    typeof dispose === "function"
      ? dispose
      : () => (input.onCellTap as unknown as (listener: null) => void)(null),
  );
}

/** Convert client-space pointer coordinates to a grid cell, or reject off-grid input. */
export interface GridHitTest {
  cellAt(clientX: number, clientY: number): GridCell | null;
}

/**
 * A BOUNDED erase: `Term_erase(x, y, len)`, blanking `len` cells and no more.
 *
 * NOT AN INVENTION - it is the call upstream already has and the port had not
 * needed until now. `eraseToEol`'s own comment names it: `askfor_aux`
 * (ui-input.c:891) edits a field in the middle of a row and must not wipe what
 * is to its right, and says in as many words that eraseToEol/prt is the wrong
 * tool there.
 *
 * OPTIONAL, like `GridReadback` and `GridGeometry`, and for a concrete reason
 * rather than symmetry: two dozen test doubles implement `GridSurface` by hand,
 * and adding a required method would break every one of them for no benefit -
 * they are all full-width, which is exactly the case that does not need it.
 * `region-surface.ts` says what a surface without it can and cannot bound.
 */
export interface GridSpanErase {
  eraseSpan(x: number, y: number, len: number): void;
}

/** Logical-grid readback is optional: 3D renderers need not retain a character buffer. */
export interface GridReadback {
  snapshot(): string[];
  snapshotColored(): ColoredCell[][];
}

/** Size subscribers run only after a resize has synchronously repainted retained cells. */
export interface SurfaceSizeEvents {
  onSizeChanged(listener: (size: TermSize) => void): () => void;
}

/** Canvas-only adapter used by GlyphTerm to resolve the otherwise-neutral assets. */
interface CanvasAssetRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    asset: RenderAssetRef,
    px: number,
    py: number,
    w: number,
    h: number,
  ): boolean;
}

/** The legacy tilesheet/loose-pack adapter; it is intentionally not GridSurface API. */
const canvasAssetRenderer: CanvasAssetRenderer = {
  draw(ctx, asset, px, py, w, h): boolean {
    if (asset.kind !== "canvas-tile" || !asset.data || typeof asset.data !== "object") return false;
    const data = asset.data as {
      blitter?: {
        drawTile: (
          ctx: CanvasRenderingContext2D,
          px: number,
          py: number,
          w: number,
          h: number,
          code: { row: number; col: number },
          grid?: { x: number; y: number },
          tall?: boolean,
        ) => boolean;
      };
      code?: { row: number; col: number };
      grid?: { x: number; y: number };
      dimScale?: number;
    };
    if (!data.blitter || !data.code) return false;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * (data.dimScale ?? 1);
    try {
      return data.blitter.drawTile(ctx, px, py, w, h, data.code, data.grid, asset.tall);
    } finally {
      ctx.globalAlpha = alpha;
    }
  },
};

// Fallback vector font (FONT-1): the terminal blits the original Angband
// 16x24 bitmap glyphs (font-16x24.ts, from 16X24x.FON) for code points 0-255,
// the faithful default. This stack is used only for glyphs the bitmap font lacks
// (e.g. any code point >= 256 a mod might print) and while measuring is needed.
const FONT_STACK =
  '"Cascadia Mono", "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace';

/** Parse a CSS colour (#rgb, #rrggbb, or rgb(r,g,b)) to [r,g,b], or null. */
function parseRgb(css: string): [number, number, number] | null {
  if (css.startsWith("#")) {
    const hex = css.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      return [r, g, b];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(css);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** The fixed main-term dimensions (ui-term.c main term). */
const FIXED_COLS = 80;
const FIXED_ROWS = 24;

/**
 * A rows x cols grid carrying over whatever `prev` already held (the overlapping
 * top-left rectangle; new cells come up empty).
 *
 * This is what keeps a resize from BLANKING the terminal. `fit()` has to
 * reallocate the grid because the geometry may change, and it used to allocate an
 * empty one - so every resize wiped the screen and left it wiped until something
 * repainted. The only repaint wired to the size event is the game map, so a resize
 * landing while a full-screen overlay owned the screen erased that overlay: the
 * ResizeObserver fires once on observe, i.e. right around the boot title screen,
 * which is how launching the game came to show nothing at all with the title
 * modal still silently waiting on a key. (Repainting the map there instead is no
 * better - it draws the town over the title, the same bug wearing a hat.)
 *
 * In the default fixed mode the grid is always 80x24, so a resize changes only
 * cell size and letterbox offset and this is exact: every cell carries over.
 * Reflow mode (the mobile opt-in) keeps the overlapping rectangle and lets the
 * next paint fill the rest, which is strictly better than starting blank.
 */
export function carryGrid<T>(
  prev: readonly (readonly (T | null)[])[],
  rows: number,
  cols: number,
): (T | null)[][] {
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => prev[y]?.[x] ?? null),
  );
}

/**
 * Term_pict's two-pass tile blit (main-sdl.c Term_pict_sdl L5511-5540, and the
 * same shape in main-win.c and main-sdl2.c): lay the TERRAIN tile down, then the
 * foreground tile over it. That second blit is what puts a monster on a floor
 * rather than on a bare cell, and it is the only reason an alpha tile's
 * transparent pixels ever show anything but the cell's background colour.
 *
 * Returns true when the FOREGROUND tile drew, meaning the caller must not also
 * draw the ASCII glyph. A terrain tile that draws on its own does NOT suppress
 * the glyph: the terrain is scenery, and a cell whose real content failed to
 * blit still has to say what is standing there.
 *
 * Pure but for the two draw calls, so the ORDER is testable without a canvas -
 * the class itself needs a real 2d context the node test environment has not
 * got (see carryGrid above for the same split).
 */
export function blitCellAssets(
  renderer: CanvasAssetRenderer,
  ctx: CanvasRenderingContext2D,
  g: Glyph | null,
  px: number,
  py: number,
  w: number,
  h: number,
): boolean {
  if (g?.bgTile) renderer.draw(ctx, g.bgTile, px, py, w, h);
  return g?.tile ? renderer.draw(ctx, g.tile, px, py, w, h) : false;
}

/** Canvas implementation of GridSurface. Canvas-only policy stays in this class. */
export class GlyphTerm
  implements
    GridSurface,
    GridPointerInput,
    GridHitTest,
    GridReadback,
    SurfaceSizeEvents,
    GridGeometry
{
  private ctx: CanvasRenderingContext2D;
  /** Term_gotoxy's cursor cell, and whether Term_set_cursor showed it. */
  private cursorX = 0;
  private cursorY = 0;
  private cursorOn = false;
  private cellW = 12;
  private cellH = 20;
  private cols = FIXED_COLS;
  private rows = FIXED_ROWS;
  /**
   * The letterbox offset (px) of the grid's top-left inside the canvas. In
   * fixed mode the 80x24 grid is centered, so cells draw at
   * (offsetX + x*cellW, offsetY + y*cellH) and a client pixel maps back to a
   * cell by subtracting the offset (cellAt). Zero in reflow mode.
   */
  private offsetX = 0;
  private offsetY = 0;
  private grid: (Glyph | null)[][] = [];
  /**
   * What is CURRENTLY ON THE CANVAS, against which `grid` is diffed.
   *
   * THE MEASUREMENT THIS EXISTS FOR. Before it, every mutator painted straight
   * to the canvas, so one move of the player cost 1469 cell paints (each a
   * fillRect plus a drawImage) plus a full-canvas fill - roughly 2,900 canvas
   * calls on the main thread, synchronously, for a 1,920-cell grid that had
   * changed in about a dozen places. Measured at a 3.4 ms median per move on a
   * Windows box at devicePixelRatio 1.1; a Retina Mac has 3.3x the pixels to
   * push per call, which is where "each move has a many milliseconds lag" came
   * from. Angband is turn-based, so that cost lands on every single keypress.
   *
   * The grid is the model and this is the view. Mutators only touch the model
   * and queue a flush; the flush walks both and paints the difference.
   */
  private shown: (Glyph | null)[][] = [];
  /** Where the cursor frame is drawn on the canvas right now (not where it is). */
  private shownCursor: { x: number; y: number } | null = null;
  /** Set by anything that makes `shown` untrustworthy: a resize, a font change. */
  private fullRepaint = true;
  /** A flush is already queued for the end of this task. */
  private flushQueued = false;
  /**
   * The active bitmap font (FONT-1). Non-null (the default FONT_16X24) means the
   * terminal blits the original Angband glyphs; null falls back to FONT_STACK
   * fillText everywhere (a mod / test escape hatch).
   */
  private font: BitmapFontData | null = FONT_16X24;
  /**
   * Tinted native-resolution glyph cache, keyed "code:fg". Each entry is an
   * (font.w x font.h) canvas with the glyph's set pixels painted in fg and the
   * rest transparent; paintCell scales it to the cell with smoothing off, so
   * the cache is independent of cell size and survives resizes.
   */
  private glyphCache = new Map<string, HTMLCanvasElement | null>();
  private sizeListeners = new Set<(size: TermSize) => void>();
  /**
   * The active modal's tap handler (see onCellTap). While set, a pointerdown
   * on the canvas is consumed here (stopImmediatePropagation) so the in-world
   * tap-to-move and long-press handlers - registered later on the same canvas
   * - never double-fire underneath an open menu.
   */
  private tapCb: ((cell: GridCell) => void) | null = null;

  /**
   * How many cell paints this term has issued, ever.
   *
   * A COUNTER RATHER THAN A GUESS, because "the Mac is slow" is not something
   * code review can answer. Every canvas call this term makes goes through
   * paintCell, so the ratio of this to the number of frames drawn IS the
   * overdraw - see paintStats and term-overdraw.test.ts.
   */
  private painted = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private options: {
      minCols: number;
      minRows: number;
      fontPx: number;
      /**
       * Opt-in responsive mode (a future mobile QoL mod). When true the grid
       * scales to fill the window (floor(w/cellW) x floor(h/cellH), with the
       * minCols/minRows floor) as it did before REND-1. When false (the
       * default) the grid is the fixed 80x24 main term, letterboxed.
       */
      reflow: boolean;
      /**
       * The bitmap font to blit (FONT-1). Omit for the faithful default
       * (FONT_16X24); pass null to disable bitmap blitting and use FONT_STACK.
       */
      bitmapFont?: BitmapFontData | null;
    } = {
      // The responsive floor, used only in reflow (mobile opt-in) mode.
      minCols: 32,
      minRows: 18,
      fontPx: 18,
      reflow: false,
    },
  ) {
    /* alpha: false. The terminal paints its own opaque background over every
     * pixel it owns, so there is nothing for the compositor to blend the canvas
     * against - and saying so lets it skip that blend for the whole surface
     * every frame. It is free on a small window and worth real milliseconds on a
     * Retina display, where the backing store is four times the pixels. */
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    if (options.bitmapFont !== undefined) this.font = options.bitmapFont;
    this.fit();
    const refit = () => {
      this.fit();
      const size = this.size();
      for (const listener of this.sizeListeners) listener(size);
    };
    window.addEventListener("resize", refit);
    // Some embeds start at 0x0 and never fire window resize; observe the
    // document element so the grid appears as soon as there is space.
    new ResizeObserver(refit).observe(document.documentElement);
    // Tap plumbing for modals (onCellTap): registered ONCE here, ahead of the
    // shell's own canvas pointerdown listeners (main.ts adds tap-to-move and
    // long-press after constructing the term), so an active modal handler can
    // consume the tap before the in-world handlers see it.
    canvas.addEventListener("pointerdown", (ev) => {
      if (!this.tapCb) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const cell = this.cellAt(ev.clientX, ev.clientY);
      if (cell) this.tapCb(cell);
    });
  }

  /**
   * Subscribe the active modal's tap handler. A pointer/touch tap is mapped from
   * client coordinates to a grid cell and delivered to `cb`; the returned
   * disposer clears this listener only if it is still active. `setActiveCellTap`
   * provides the shell's one-modal-owner policy. While a handler is registered
   * the tap never reaches the in-world tap-to-move or long-press listeners.
   */
  onCellTap(cb: (cell: GridCell) => void): () => void {
    this.tapCb = cb;
    return () => {
      if (this.tapCb === cb) this.tapCb = null;
    };
  }

  onSizeChanged(listener: (size: TermSize) => void): () => void {
    this.sizeListeners.add(listener);
    return () => this.sizeListeners.delete(listener);
  }

  size(): TermSize {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Where this grid's cells are, in CSS pixels.
   *
   * These four numbers were private for five phases of the front-end work, and
   * that is exactly what left a replacement front end with nowhere to draw but
   * over the whole window: `screenRegions()` turns them into the map rectangle,
   * and the frame carries it to whoever holds the display (#234).
   *
   * CSS pixels, not device pixels. The canvas fills the window at the origin
   * (index.html) and its context carries `setTransform(dpr, ...)`, so these are
   * already in the space `getBoundingClientRect()` answers in and a `position:
   * fixed` element positions in - which is the space a mod's own canvas needs.
   * cellAt() reads the same fields the same way for the reverse trip.
   */
  metrics(): GridPixelMetrics {
    return {
      cellWidth: this.cellW,
      cellHeight: this.cellH,
      originX: this.offsetX,
      originY: this.offsetY,
    };
  }

  /**
   * The grid cell under a client-space pixel (e.g. a pointer/touch), for
   * tap-to-move on touch devices. Coordinates are in client space; this method
   * owns the canvas rectangle and letterbox, and returns null outside the grid.
   */
  cellAt(clientX: number, clientY: number): GridCell | null {
    const rect = this.canvas.getBoundingClientRect();
    const col = Math.floor((clientX - rect.left - this.offsetX) / this.cellW);
    const row = Math.floor((clientY - rect.top - this.offsetY) / this.cellH);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return { col, row };
  }

  /**
   * Recompute cell metrics and grid size. In the default fixed mode this sizes
   * a letterboxed 80x24 grid (largest cell that fits, centered); in reflow mode
   * it sizes a responsive grid honoring the minCols/minRows floor.
   */
  private fit(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Baseline for the whole context: nearest-neighbour, so bitmap glyphs stay
    // crisp (smoothing would blur the classic font into mush) and an upscaled
    // tile keeps its pixel-art edges. A tile blit that is DOWNSCALED overrides
    // this for its own drawImage call and restores it immediately after
    // (withTileSmoothing in tiles.ts, used by TileSet.drawTile and
    // LinoleumPack.drawTile - #100), so the override never survives to the next
    // cell's glyph paint.
    this.ctx.imageSmoothingEnabled = false;

    if (this.options.reflow) {
      this.fitReflow(w, h);
    } else {
      this.fitFixed(w, h);
    }

    // Carry the screen across the resize rather than starting blank - see
    // carryGrid: an empty grid here is what made the boot title screen vanish.
    this.grid = carryGrid(this.grid, this.rows, this.cols);
    /* Cells have moved and changed size, so nothing on the canvas can be
     * trusted to still be where `shown` says it is. */
    this.shown = carryGrid([], this.rows, this.cols);
    this.fullRepaint = true;
    this.ctx.textBaseline = "top";
    // Sync the fallback vector font to the current cell (used only for glyphs
    // the bitmap font lacks). Harmless when a bitmap glyph is blitted instead.
    this.ctx.font = `${Math.max(8, Math.floor(this.cellH * 0.82))}px ${FONT_STACK}`;
    /* Synchronously, not queued: a resize must show the new geometry now, and
     * this runs from a resize/ResizeObserver callback rather than from a frame
     * of gameplay. */
    this.flush();
  }

  /**
   * Repaint everything on the next flush, because something outside the grid
   * changed what a cell would look like.
   *
   * The diff compares glyph DATA, so a change nothing in the grid records - a
   * tile atlas finishing its load, a new graphics mode, a font swap - is
   * invisible to it and would leave the old pixels on screen forever. Anything
   * that changes how a glyph draws has to say so here.
   */
  invalidate(): void {
    this.fullRepaint = true;
    this.schedule();
  }

  /**
   * Queue the paint for the end of the current task.
   *
   * A MICROTASK, not requestAnimationFrame. Everything the game draws happens
   * inside one synchronous keydown handler (or one `await` step of a modal
   * flow), so the end of the task IS the frame boundary - and coalescing there
   * costs no latency, keeps working in a hidden tab where rAF does not fire, and
   * needs no scheduler for the turn-based loop to fight with. It is what turns
   * "clear the screen, then print 1,469 cells over it" into one paint of the
   * cells that actually differ from the last frame.
   */
  private schedule(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flush();
    });
  }

  /**
   * Paint every cell whose model differs from what is on the canvas, now.
   *
   * Public because a caller that reads PIXELS rather than the grid - a
   * screenshot, a canvas-scraping verification - has to be able to force the
   * queued frame out first. Everything else can leave it to schedule().
   */
  flush(): void {
    if (this.fullRepaint) {
      this.fullRepaint = false;
      this.ctx.fillStyle = UI_BG;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      /* Nothing is on the canvas now, so every non-null cell below differs and
       * every null one already matches the fill. */
      for (const row of this.shown) row.fill(null);
      this.shownCursor = null;
      this.redraws++;
    }
    /*
     * Collect the diff BEFORE painting, because a double-height tile makes a
     * cell's paint depend on its neighbour's (expandTallDirty). `view` is
     * updated here and not in the paint loop so `isTall` below can still see
     * BOTH frames: the old glyph in `view`, the new one in `model`.
     */
    const dirty = new Set<number>();
    const oldGlyphs = new Map<number, Glyph | null>();
    for (let y = 0; y < this.rows; y++) {
      const model = this.grid[y];
      const view = this.shown[y];
      if (!model || !view) continue;
      for (let x = 0; x < this.cols; x++) {
        const g = model[x] ?? null;
        const was = view[x] ?? null;
        if (sameGlyph(g, was)) continue;
        dirty.add(y * this.cols + x);
        oldGlyphs.set(y * this.cols + x, was);
      }
    }
    /* Tall in EITHER frame: a tile that just left still has an upper half on
     * the canvas, and one that just arrived is about to draw one. */
    const isTall = (x: number, y: number): boolean => {
      const k = y * this.cols + x;
      const now = this.grid[y]?.[x] ?? null;
      const before = oldGlyphs.has(k) ? (oldGlyphs.get(k) ?? null) : (this.shown[y]?.[x] ?? null);
      return glyphIsTall(now) || glyphIsTall(before);
    };
    expandTallDirty(dirty, this.cols, this.rows, isTall);
    /* Top-to-bottom, so an anchor's upward overdraw lands AFTER the cell above
     * it has been cleared and painted with its own content. */
    for (let y = 0; y < this.rows; y++) {
      const model = this.grid[y];
      const view = this.shown[y];
      if (!model || !view) continue;
      for (let x = 0; x < this.cols; x++) {
        if (!dirty.has(y * this.cols + x)) continue;
        view[x] = model[x] ?? null;
        this.paintCell(x, y);
      }
    }
    /* The cursor is a stroked frame ON TOP of a cell, so moving it means
     * repainting the cell it was over - which the diff above cannot know about,
     * the glyph there not having changed. */
    const want = this.cursorOn ? { x: this.cursorX, y: this.cursorY } : null;
    const had = this.shownCursor;
    const moved = (had?.x ?? -1) !== (want?.x ?? -1) || (had?.y ?? -1) !== (want?.y ?? -1);
    if (moved) {
      if (had) this.paintCell(had.x, had.y);
      this.shownCursor = want;
      if (want) this.drawCursor();
    } else if (want) {
      /* Same cell, but the diff may have just repainted the glyph under it. */
      this.drawCursor();
    }
  }

  /**
   * Swap the bitmap font the terminal draws from - core's FONT_16X24, a mod's,
   * or null to fall back to the vector FONT_STACK.
   *
   * THE CONSTRUCTOR OPTION COULD NOT DO THIS JOB. `bitmapFont` has been on the
   * options object since the terminal was written and had zero callers, and the
   * reason is structural rather than an oversight: the one construction site is
   * at module scope in main.ts, and a mod's font arrives from a fetch, which is
   * asynchronous. A resource that can only be supplied before the first `await`
   * can only be supplied by code compiled into the app - which is the whole
   * thing MOD_REACH gap 7 was about.
   *
   * Three things have to happen together and none of them is optional. The cell
   * SIZE comes from the font (fitFixed scales `font.w`/`font.h`), so the layout
   * has to be recomputed or the new glyphs draw at the old font's pitch. The
   * glyph CACHE is keyed by `code:colour` with no font in the key - correct
   * while the font never changed, and stale the instant it does, which would
   * paint the old font's shapes for the rest of the session. And `fit` marks a
   * full repaint, so the screen already on the canvas is redrawn rather than
   * left as a half-and-half of two fonts.
   */
  setBitmapFont(font: BitmapFontData | null): void {
    if (this.font === font) return;
    this.font = font;
    this.glyphCache.clear();
    this.fit();
  }

  /**
   * Fixed 80x24 (REND-1): pick the largest font at which the whole grid fits
   * the window, then center it so the grid is letterboxed. If even the smallest
   * font overflows (a very small window), the grid stays 80x24 and clamps the
   * offset to 0 (it clips rather than reflowing - reflow is the mobile opt-in).
   */
  private fitFixed(w: number, h: number): void {
    // Bitmap font: scale the native 16x24 cell UNIFORMLY (preserving its aspect)
    // by the largest factor at which the whole 80x24 grid still fits, then
    // centre it - a letterboxed terminal. A uniform scale keeps the glyphs
    // undistorted; nearest-neighbour (imageSmoothingEnabled=false) keeps them
    // crisp even at a fractional factor.
    if (this.font) {
      const scale = Math.min(
        w / (this.font.w * FIXED_COLS),
        h / (this.font.h * FIXED_ROWS),
      );
      const cellW = Math.max(4, Math.floor(this.font.w * scale));
      const cellH = Math.max(6, Math.floor(this.font.h * scale));
      this.cellW = cellW;
      this.cellH = cellH;
      this.cols = FIXED_COLS;
      this.rows = FIXED_ROWS;
      this.offsetX = Math.max(0, Math.floor((w - cellW * FIXED_COLS) / 2));
      this.offsetY = Math.max(0, Math.floor((h - cellH * FIXED_ROWS) / 2));
      return;
    }
    const MIN_FONT = 8;
    const MAX_FONT = 48;
    let fontPx = MAX_FONT;
    let cellW = 0;
    let cellH = 0;
    for (; fontPx >= MIN_FONT; fontPx--) {
      this.ctx.font = `${fontPx}px ${FONT_STACK}`;
      cellW = Math.ceil(this.ctx.measureText("M").width);
      cellH = Math.ceil(fontPx * 1.2);
      if (cellW * FIXED_COLS <= w && cellH * FIXED_ROWS <= h) break;
    }
    if (fontPx < MIN_FONT) {
      fontPx = MIN_FONT;
      this.ctx.font = `${fontPx}px ${FONT_STACK}`;
      cellW = Math.ceil(this.ctx.measureText("M").width);
      cellH = Math.ceil(fontPx * 1.2);
    }
    this.cellW = cellW;
    this.cellH = cellH;
    this.cols = FIXED_COLS;
    this.rows = FIXED_ROWS;
    this.offsetX = Math.max(0, Math.floor((w - cellW * FIXED_COLS) / 2));
    this.offsetY = Math.max(0, Math.floor((h - cellH * FIXED_ROWS) / 2));
    this.ctx.font = `${fontPx}px ${FONT_STACK}`;
  }

  /** Responsive grid (reflow opt-in): the pre-REND-1 behavior. */
  private fitReflow(w: number, h: number): void {
    // Bitmap font: integer-scale the native cell, then derive the grid from the
    // window (honouring the minCols/minRows floor).
    if (this.font) {
      const scale = Math.max(1, Math.round(this.options.fontPx / this.font.h));
      const cellW = this.font.w * scale;
      const cellH = this.font.h * scale;
      this.cellW = cellW;
      this.cellH = cellH;
      this.cols = Math.max(this.options.minCols, Math.floor(w / cellW));
      this.rows = Math.max(this.options.minRows, Math.floor(h / cellH));
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    let fontPx = this.options.fontPx;
    this.ctx.font = `${fontPx}px ${FONT_STACK}`;
    let cellW = Math.ceil(this.ctx.measureText("M").width);
    let cellH = Math.ceil(fontPx * 1.2);
    const MIN_FONT = 11;
    while (
      fontPx > MIN_FONT &&
      (Math.floor(w / cellW) < this.options.minCols ||
        Math.floor(h / cellH) < this.options.minRows)
    ) {
      fontPx -= 1;
      this.ctx.font = `${fontPx}px ${FONT_STACK}`;
      cellW = Math.ceil(this.ctx.measureText("M").width);
      cellH = Math.ceil(fontPx * 1.2);
    }
    this.cellW = cellW;
    this.cellH = cellH;
    this.cols = Math.max(this.options.minCols, Math.floor(w / cellW));
    this.rows = Math.max(this.options.minRows, Math.floor(h / cellH));
    this.offsetX = 0;
    this.offsetY = 0;
    this.ctx.font = `${fontPx}px ${FONT_STACK}`;
  }

  clear(): void {
    for (const row of this.grid) row.fill(null);
    // Term_clear takes the cursor with it; a stale frame on a blank screen
    // would point at nothing.
    this.cursorOn = false;
    /* NOT a redraw. Almost every clear() in this codebase is immediately
     * followed by drawing a whole screen over the top of it, and painting the
     * blank in between was half the per-frame cost: a full-canvas fill plus a
     * repaint of every cell the clear emptied, thrown away microseconds later.
     * The flush at the end of the task paints the difference between the last
     * frame and this one, and a cleared-then-redrawn cell that ends up
     * identical is not a difference. */
    this.schedule();
  }

  /**
   * The current grid as one string per row (spaces for empty cells). Used by
   * automated verification to read what is on screen without pixel-scraping the
   * canvas, and handy for tests/diagnostics.
   */
  snapshot(): string[] {
    return this.grid.map((row) =>
      row.map((g) => (g && g.ch ? g.ch : " ")).join("").replace(/\s+$/u, ""),
    );
  }

  /**
   * The current grid as a full rectangular array of coloured cells (glyph +
   * CSS foreground, and background when set). This is the appearance-parity
   * counterpart of snapshot(): the port stores each cell's colour as the CSS
   * string colorToCss(COLOUR_*) produces (i.e. "#rrggbb"), which is the same
   * form the C oracle's html_screenshot (ui-command.c do_cmd_save_screen) emits
   * per cell, so a cell-by-cell (glyph, fg, bg) diff against a captured C screen
   * dump is exact - both sides derive from the byte-identical palette
   * (core/color.ts COLOR_TABLE == reference z-color.c angband_color_table).
   * Empty cells normalise to a blank glyph with no colour so trailing padding
   * compares equal regardless of how a screen was drawn.
   */
  snapshotColored(): ColoredCell[][] {
    return this.grid.map((row) =>
      row.map((g) =>
        g && g.ch
          ? g.bg !== undefined
            ? { ch: g.ch, fg: g.fg, bg: g.bg }
            : { ch: g.ch, fg: g.fg }
          : { ch: " ", fg: "" },
      ),
    );
  }

  /**
   * The number of grid cells currently carrying a graphics tile. Used by
   * automated verification to confirm the render path chose tiles over ASCII
   * without pixel-scraping the canvas.
   */
  tileCellCount(): number {
    let n = 0;
    for (const row of this.grid) {
      for (const g of row) if (g?.tile) n++;
    }
    return n;
  }

  /**
   * How many cells carry a TERRAIN tile under their foreground tile - the count
   * of cells where something covers the floor and the floor still shows through.
   * Zero while nothing stands on mapped terrain, and zero if the (tap, tcp) pair
   * stops being threaded through, which is the regression this measures.
   */
  /**
   * The BACKING-STORE pixel rectangle of one cell, so automated verification can
   * read exactly the cell it means - `getImageData` on this canvas, or a crop out
   * of an Electron capturePage() - instead of estimating from the window size and
   * the letterbox.
   *
   * The dpr multiply is the whole point: cellW/cellH/offsetX/offsetY are CSS
   * pixels (fit() is handed the CSS size and compensates with
   * `ctx.setTransform(dpr, ...)`), while the backing store is `width * dpr`. On a
   * 1.1x display that 10% drift is ~3.6 cells at mid-screen, which is enough to
   * read a NEIGHBOURING cell and believe the answer - measured, and it produced a
   * clean false positive before it was found.
   */
  cellRect(x: number, y: number): { x: number; y: number; w: number; h: number } {
    const dpr = this.dpr();
    return {
      x: Math.round((this.offsetX + x * this.cellW) * dpr),
      y: Math.round((this.offsetY + y * this.cellH) * dpr),
      w: Math.round(this.cellW * dpr),
      h: Math.round(this.cellH * dpr),
    };
  }

  /** The device-pixel ratio the canvas was sized against, safe outside a DOM. */
  private dpr(): number {
    return (typeof window === "undefined" ? 1 : window.devicePixelRatio) || 1;
  }

  /**
   * One cell's rect in CSS pixels, with its EDGES SNAPPED to whole device pixels.
   *
   * THE DEFECT THIS FIXES, MEASURED. cellW/cellH/offsetX/offsetY are integers in
   * CSS pixels and the context carries `setTransform(dpr, ...)`, so on any
   * fractional dpr a cell's edge lands part-way through a device pixel. That
   * pixel is then only PARTIALLY covered when the cell is repainted: the rest of
   * it still holds whatever was on screen before. The diff renderer repaints
   * only cells whose content changed, so the neighbour that owns the other half
   * is never touched, and the stale half survives every subsequent frame.
   *
   * Going title -> update page -> title left 118,452 differing pixels (1.43% of
   * a 3841x2161 canvas, peak delta 122/765) in a lattice of cell outlines. The
   * seam pitch measured 47.24 and 71.55 device pixels - fractional, which is
   * what says "cell edges do not align to the grid the GPU actually paints on".
   * The first frame looks right because it follows a full-canvas fill.
   *
   * Rounding both edges - rather than growing the rect outward - is what makes
   * neighbours TILE. A cell's right edge and the next cell's left edge are the
   * same expression, so they round to the same device pixel: no gap to leave
   * residue in, and no overlap to clip the neighbour's glyph. Snapping outward
   * with floor/ceil would also erase the residue, at the cost of every cell
   * overwriting one device pixel of each neighbour.
   *
   * This costs no extra paints. The overdraw budget in term-overdraw.test.ts is
   * about WHICH cells are painted; this is only where their edges land.
   */
  private cellBox(x: number, y: number): { x: number; y: number; w: number; h: number } {
    const dpr = this.dpr();
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    const left = snap(this.offsetX + x * this.cellW);
    const top = snap(this.offsetY + y * this.cellH);
    const right = snap(this.offsetX + (x + 1) * this.cellW);
    const bottom = snap(this.offsetY + (y + 1) * this.cellH);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  bgTileCellCount(): number {
    let n = 0;
    for (const row of this.grid) {
      for (const g of row) if (g?.bgTile) n++;
    }
    return n;
  }

  /**
   * Term_gotoxy + Term_set_cursor(1) (ui-term.c): show the cursor at a cell.
   *
   * Drawn the way the Windows front end draws it (main-win.c Term_curs_win
   * L1990-1999): a one-pixel YELLOW frame around the cell - "the gold
   * rectangle". It is what upstream uses to say "you are here": menus put it on
   * the selected row (ui-menu.c display_scrolling L212-213), the birth
   * point-buy screen puts it just after the current stat's cost
   * (ui-birth.c:1121), and the map puts it on the targeted grid.
   *
   * Like the C, this is painted LAST, just before waiting for input: repainting
   * the cell erases it, so a caller that redraws must set it again (which is
   * exactly what Term_gotoxy-before-inkey does).
   */
  setCursor(x: number, y: number): void {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return;
    this.cursorX = x;
    this.cursorY = y;
    this.cursorOn = true;
    /* The old cell's repaint happens in flush(), which is the only place that
     * knows where the frame is currently DRAWN - `cursorX/Y` is where it is
     * wanted, and those two diverge as soon as painting is queued. */
    this.schedule();
  }

  /** Term_set_cursor(0): hide it again (and repaint the cell it framed). */
  hideCursor(): void {
    if (!this.cursorOn) return;
    this.cursorOn = false;
    this.schedule();
  }

  private drawCursor(): void {
    if (!this.cursorOn) return;
    /* Snapped like every other cell paint: the frame has to sit on the same
     * rect the cell under it occupies, or it leaves gold on a neighbour that
     * only a full repaint would clear. */
    const { x: px, y: py, w: cw, h: ch } = this.cellBox(this.cursorX, this.cursorY);
    this.ctx.strokeStyle = UI_GOLD;
    this.ctx.lineWidth = 1;
    // Half-pixel inset so a 1px stroke lands on the cell edge, not across it.
    this.ctx.strokeRect(px + 0.5, py + 0.5, cw - 1, ch - 1);
  }

  put(x: number, y: number, glyph: Glyph): void {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return;
    const row = this.grid[y];
    if (!row) return;
    row[x] = glyph;
    this.schedule();
  }

  print(x: number, y: number, text: string, fg: string, bg?: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === undefined) break;
      this.put(x + i, y, bg !== undefined ? { ch, fg, bg } : { ch, fg });
    }
  }

  /**
   * erase (ui-term.c Term_erase): blank a row from `x` to the end of the line.
   */
  eraseToEol(x: number, y: number): void {
    if (y < 0 || y >= this.rows || y >= this.grid.length) return;
    const row = this.grid[y];
    if (!row) return;
    for (let cx = Math.max(0, x); cx < this.cols; cx++) row[cx] = null;
    this.schedule();
  }

  /**
   * Term_erase(x, y, len) (ui-term.c): blank exactly `len` cells from `x`.
   *
   * The bounded sibling of eraseToEol, which is `Term_erase(col, row, 255)` -
   * 255 being clamped to the terminal width. See `GridSpanErase` for why the
   * port needs it now and why it is optional on the interface.
   *
   * BLANKS TO null, NOT TO SPACES, which is the same distinction eraseToEol
   * draws. `null` is the grid's own spelling of "nothing here" and is what
   * `carryGrid` preserves across a resize; a space is a glyph that happens to
   * be blank, and it OCCLUDES - a region erasing with spaces would punch a
   * white hole in whatever it was meant to be floating over.
   */
  eraseSpan(x: number, y: number, len: number): void {
    if (y < 0 || y >= this.rows || y >= this.grid.length) return;
    const row = this.grid[y];
    if (!row) return;
    const to = Math.min(this.cols, x + len);
    for (let cx = Math.max(0, x); cx < to; cx++) row[cx] = null;
    this.schedule();
  }

  /**
   * c_prt / prt (ui-output.c:385-391 and :396-398): `Term_erase(col, row, 255)`
   * THEN `Term_addstr`, in that order, as ONE operation.
   *
   *     void c_prt(uint8_t attr, const char *str, int row, int col) {
   *             Term_erase(col, row, 255);
   *             Term_addstr(-1, attr, str);
   *     }
   *
   * How this differs from print(): print() is `c_put_str` / `put_str`
   * (ui-output.c:368-379), which is a bare `Term_putstr` and whose own comment is
   * "Do not clear the line." That is the entire distinction upstream draws
   * between the two families, and the port must keep them distinct - a site that
   * mirrors put_str MUST NOT erase (e.g. msg_flush's "-more-", ui-input.c:393,
   * is a Term_putstr appended one column past the message text and would wipe
   * that text if it erased), and a site that mirrors prt MUST.
   *
   * The erase is load-bearing rather than tidy: upstream draws its one-line
   * prompts over whatever is already on that row and relies on prt to wipe the
   * rest of it. Two cases surfaced from live play:
   *   - the store's buy/sell confirmation prints "Price: N" onto row 1, the
   *     shopkeeper line, so a print() left "Price: 450the Great (Gnome)";
   *   - textui_get_check (ui-input.c:1271, `prt(buf, 0, 0)`) draws "Save and
   *     quit?[y/n] " onto the message row, so a print() left the tail of the
   *     previous message behind: "Save and quit?[y/n] d5) (+5,+3) (0).".
   *
   * Note the erase runs to the END of the row (255 is clamped to the term width
   * by Term_erase), not to the length of `text`. A field edit that must preserve
   * what is to its right uses the BOUNDED `Term_erase(x, y, len)` instead
   * (askfor_aux, ui-input.c:891) - eraseToEol/prt is the wrong tool there.
   *
   * Every place the C calls prt()/c_prt() should call this, not print().
   */
  prt(x: number, y: number, text: string, fg: string): void {
    this.eraseToEol(x, y);
    this.print(x, y, text, fg);
  }

  /**
   * A native-resolution (font.w x font.h) canvas of glyph `code` tinted `fg`,
   * cached by "code:fg". Set pixels are painted fg (opaque), the rest stay
   * transparent, so paintCell can scale it into the cell over the background.
   * Returns null when there is no bitmap font, the code is out of range, the
   * glyph is blank, or the colour cannot be parsed (caller falls back to text).
   */
  private tintedGlyph(code: number, fg: string): HTMLCanvasElement | null {
    const font = this.font;
    if (!font || code < 0 || code >= font.glyphs.length) return null;
    const key = `${code}:${fg}`;
    const cached = this.glyphCache.get(key);
    if (cached !== undefined) return cached;
    const rows = font.glyphs[code];
    const rgb = rows ? parseRgb(fg) : null;
    if (!rows || !rgb || rows.every((r) => r === 0)) {
      this.glyphCache.set(key, null);
      return null;
    }
    const { w, h } = font;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const gctx = c.getContext("2d");
    if (!gctx) {
      this.glyphCache.set(key, null);
      return null;
    }
    const img = gctx.createImageData(w, h);
    const [r, gr, b] = rgb;
    for (let ry = 0; ry < h; ry++) {
      const mask = rows[ry] ?? 0;
      for (let rx = 0; rx < w; rx++) {
        if ((mask >> (w - 1 - rx)) & 1) {
          const o = (ry * w + rx) * 4;
          img.data[o] = r;
          img.data[o + 1] = gr;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
    }
    gctx.putImageData(img, 0, 0);
    this.glyphCache.set(key, c);
    return c;
  }

  private paintCell(x: number, y: number): void {
    this.painted++;
    const g = this.grid[y]?.[x] ?? null;
    /* Snapped to whole device pixels - see cellBox. Painting on the CSS grid
     * instead leaves a lattice of half-erased cell edges behind on any
     * fractional dpr, because the diff never repaints the neighbour that owns
     * the other half of the boundary pixel. */
    const { x: px, y: py, w: cw, h: ch } = this.cellBox(x, y);
    this.ctx.fillStyle = g?.bg ?? UI_BG;
    this.ctx.fillRect(px, py, cw, ch);
    if (blitCellAssets(canvasAssetRenderer, this.ctx, g, px, py, cw, ch)) return;
    if (g && g.ch !== " ") {
      // FONT-1: blit the original 16x24 bitmap glyph, tinted to fg and scaled to
      // the cell (nearest-neighbour). Falls back to FONT_STACK fillText for any
      // glyph the bitmap font lacks (code >= 256, blank, or a rare colour form).
      const code = g.ch.codePointAt(0) ?? 0;
      const glyph = this.tintedGlyph(code, g.fg);
      if (glyph) {
        /* The snapped size, not cellW/cellH: the glyph has to fill the same
         * rect the background just filled, or it reintroduces the seam it was
         * drawn to cover. */
        this.ctx.drawImage(glyph, px, py, cw, ch);
      } else {
        this.ctx.fillStyle = g.fg;
        this.ctx.fillText(g.ch, px, py + Math.floor(ch * 0.1));
      }
    }
  }

  /**
   * Cell paints issued so far, and how many of them were whole-screen redraws.
   *
   * Read by the overdraw ratchet and by anyone diagnosing a slow front end. It
   * costs one increment per paint and answers the question "is the renderer
   * doing more work than the screen has cells", which nothing else could.
   */
  paintStats(): { cells: number; redraws: number } {
    return { cells: this.painted, redraws: this.redraws };
  }

  private redraws = 0;

}

/**
 * Whether two cells would paint identically, i.e. whether the diff may skip one.
 *
 * Conservative by construction: anything it cannot compare counts as changed. A
 * RenderAssetRef values are allocated per cell per frame, so identity is useless -
 * `key` is what two frames of the same dungeon have in common, and an asset
 * without one (a tileset that is not ready) is always redrawn.
 */
function sameGlyph(a: Glyph | null, b: Glyph | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.ch !== b.ch || a.fg !== b.fg || a.bg !== b.bg) return false;
  return sameTile(a.tile, b.tile) && sameTile(a.bgTile, b.bgTile);
}

function sameTile(a: RenderAssetRef | undefined, b: RenderAssetRef | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.key !== undefined && a.key === b.key;
}
