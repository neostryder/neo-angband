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
export interface TileDraw {
  draw(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    w: number,
    h: number,
  ): boolean;
}

export interface Glyph {
  ch: string;
  fg: string;
  bg?: string;
  /** When set, blit this tile in place of the ASCII glyph (ASCII on failure). */
  tile?: TileDraw;
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

const FONT_STACK =
  '"Cascadia Mono", "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace';

/** The fixed main-term dimensions (ui-term.c main term). */
const FIXED_COLS = 80;
const FIXED_ROWS = 24;

export class GlyphTerm {
  private ctx: CanvasRenderingContext2D;
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
  onResize: ((size: TermSize) => void) | null = null;
  /**
   * The active modal's tap handler (see onCellTap). While set, a pointerdown
   * on the canvas is consumed here (stopImmediatePropagation) so the in-world
   * tap-to-move and long-press handlers - registered later on the same canvas
   * - never double-fire underneath an open menu.
   */
  private tapCb: ((cell: { col: number; row: number }) => void) | null = null;

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
    } = {
      // The responsive floor, used only in reflow (mobile opt-in) mode.
      minCols: 32,
      minRows: 18,
      fontPx: 18,
      reflow: false,
    },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.fit();
    const refit = () => {
      this.fit();
      this.onResize?.(this.size());
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
      const rect = canvas.getBoundingClientRect();
      this.tapCb(this.cellAt(ev.clientX - rect.left, ev.clientY - rect.top));
    });
  }

  /**
   * Register (or clear, with null) the tap handler for the active modal: a
   * pointer/touch tap on the canvas is mapped to its grid cell via cellAt()
   * and delivered to `cb`. Exactly one handler is active at a time - each
   * modal registers on open and MUST clear (or restore its parent's handler)
   * on resolve, mirroring the window-keydown add/remove discipline. While a
   * handler is registered the tap never reaches the in-world tap-to-move or
   * long-press listeners.
   */
  onCellTap(cb: ((cell: { col: number; row: number }) => void) | null): void {
    this.tapCb = cb;
  }

  size(): TermSize {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * The grid cell under a client-space pixel (e.g. a pointer/touch), for
   * tap-to-move on touch devices. Coordinates are relative to the canvas's
   * top-left; callers pass event.clientX/Y minus the canvas bounding rect.
   */
  cellAt(cssX: number, cssY: number): { col: number; row: number } {
    return {
      col: Math.floor((cssX - this.offsetX) / this.cellW),
      row: Math.floor((cssY - this.offsetY) / this.cellH),
    };
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

    if (this.options.reflow) {
      this.fitReflow(w, h);
    } else {
      this.fitFixed(w, h);
    }

    this.grid = Array.from({ length: this.rows }, () =>
      new Array<Glyph | null>(this.cols).fill(null),
    );
    this.ctx.textBaseline = "top";
    this.redraw();
  }

  /**
   * Fixed 80x24 (REND-1): pick the largest font at which the whole grid fits
   * the window, then center it so the grid is letterboxed. If even the smallest
   * font overflows (a very small window), the grid stays 80x24 and clamps the
   * offset to 0 (it clips rather than reflowing - reflow is the mobile opt-in).
   */
  private fitFixed(w: number, h: number): void {
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
    this.redraw();
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

  put(x: number, y: number, glyph: Glyph): void {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return;
    const row = this.grid[y];
    if (!row) return;
    row[x] = glyph;
    this.paintCell(x, y);
  }

  print(x: number, y: number, text: string, fg: string, bg?: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === undefined) break;
      this.put(x + i, y, bg !== undefined ? { ch, fg, bg } : { ch, fg });
    }
  }

  private paintCell(x: number, y: number): void {
    const g = this.grid[y]?.[x] ?? null;
    const px = this.offsetX + x * this.cellW;
    const py = this.offsetY + y * this.cellH;
    this.ctx.fillStyle = g?.bg ?? "#101014";
    this.ctx.fillRect(px, py, this.cellW, this.cellH);
    // Graphics tile: blit it over the cell background; only if the blit
    // succeeds do we skip the ASCII glyph. A not-ready atlas returns false and
    // the cell degrades to its text glyph, so tiles never blank the map out.
    if (g?.tile && g.tile.draw(this.ctx, px, py, this.cellW, this.cellH)) {
      return;
    }
    if (g && g.ch !== " ") {
      this.ctx.fillStyle = g.fg;
      this.ctx.fillText(g.ch, px, py + Math.floor(this.cellH * 0.1));
    }
  }

  redraw(): void {
    this.ctx.fillStyle = "#101014";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.grid[y]?.[x]) this.paintCell(x, y);
      }
    }
  }
}
