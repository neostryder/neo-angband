/**
 * A responsive glyph-grid renderer on canvas: the modern replacement for
 * the multi-terminal curses surface. One surface, scales with the
 * viewport, no terminal limitations; tile packs can swap in later by
 * replacing the glyph painter.
 */

export interface Glyph {
  ch: string;
  fg: string;
  bg?: string;
}

export interface TermSize {
  cols: number;
  rows: number;
}

const FONT_STACK =
  '"Cascadia Mono", "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace';

export class GlyphTerm {
  private ctx: CanvasRenderingContext2D;
  private cellW = 12;
  private cellH = 20;
  private cols = 80;
  private rows = 24;
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
    private options: { minCols: number; minRows: number; fontPx: number } = {
      // A small, usable floor rather than a hard 80x24: on a desktop the grid
      // is far larger than this (floor(w/cellW)); on a phone we drop to this
      // few, still-legible cells and let the shell reflow to a compact layout,
      // instead of clipping an 80-column grid off the right edge.
      minCols: 32,
      minRows: 18,
      fontPx: 18,
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
      col: Math.floor(cssX / this.cellW),
      row: Math.floor(cssY / this.cellH),
    };
  }

  /** Recompute cell metrics so at least minCols x minRows always fit. */
  private fit(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let fontPx = this.options.fontPx;
    this.ctx.font = `${fontPx}px ${FONT_STACK}`;
    let cellW = Math.ceil(this.ctx.measureText("M").width);
    let cellH = Math.ceil(fontPx * 1.2);
    // Shrink to honor the minimum grid on small screens, but never below a
    // legible floor: on a phone we would rather show fewer, readable cells
    // than an unreadable 5px 80-column grid.
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
    this.grid = Array.from({ length: this.rows }, () =>
      new Array<Glyph | null>(this.cols).fill(null),
    );
    this.ctx.font = `${fontPx}px ${FONT_STACK}`;
    this.ctx.textBaseline = "top";
    this.redraw();
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
    const px = x * this.cellW;
    const py = y * this.cellH;
    this.ctx.fillStyle = g?.bg ?? "#101014";
    this.ctx.fillRect(px, py, this.cellW, this.cellH);
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
