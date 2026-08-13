/**
 * The screen, divided by NAME.
 *
 * WHY THIS EXISTS. A replacement front end draws with its own canvas, and until
 * this module there was no way for it to learn where the map's pixels are: cell
 * size, the letterbox offset and the grid dimensions were all private to
 * GlyphTerm, and nothing on `ctx` or the frame carried them. `samples/
 * blueprint-view` records what that cost - it covered the whole window, because
 * drawing inside the map rectangle would have meant guessing it, and with the
 * mod on you could not read your hit points, see a message, or open the Mods
 * screen to turn it off again. Core was doing its half correctly the whole time:
 * it stopped drawing the map and kept drawing everything else. The mod simply
 * had nowhere to put its canvas but over the lot.
 *
 * THE NAMES ARE ROLES, NOT PLACES. `sidebar` is "the vitals", and where the
 * vitals live depends on the sidebar layout ('=' -> (o)): a 13-column column on
 * the left, a one-line header under the message row, or nowhere at all. A mod
 * that asked for "columns 0-12" would be right in one layout of three and would
 * silently draw over the map in another. Asking for `sidebar` is right in all
 * three, and is `undefined` in the layout where the player turned it off - which
 * is a fact a front end needs rather than one it should have to infer.
 *
 * BOTH UNITS, DELIBERATELY. Cells are what the frame's own coordinates are in
 * and what a text-mode replacement wants; pixels are what a canvas needs. The
 * pixel rectangle is CSS pixels in the game window's coordinate space - the same
 * space `getBoundingClientRect()` answers in and `position: fixed` positions in -
 * because the game's canvas fills the window at the origin (index.html). It is
 * NOT device-pixel-snapped: a mod positions a DOM element with these numbers and
 * layout does its own rounding, so snapping here would be a precision the
 * destination cannot keep.
 *
 * PURE, and takes the geometry it needs as an argument rather than reading a
 * terminal. main.ts's viewport() is the one producer of these numbers, so this
 * module can be driven at any size and layout by a test with no canvas.
 */

/** The parts of the screen that have a name. Every one of them is core's today. */
export type ScreenRegionName = "messages" | "sidebar" | "map" | "status";

/**
 * In paint order, top to bottom. Order matters to a consumer that iterates -
 * a front end drawing borders, or a test asserting the whole screen is covered.
 */
export const SCREEN_REGION_NAMES: readonly ScreenRegionName[] = [
  "messages",
  "sidebar",
  "map",
  "status",
];

/** A rectangle of the terminal grid, in cells. `col`/`row` are its top-left. */
export interface RegionCells {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

/** The same rectangle in CSS pixels, in the game window's coordinate space. */
export interface RegionPixels {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenRegion {
  readonly name: ScreenRegionName;
  readonly cells: RegionCells;
  /**
   * Absent when the host has no pixel projection to offer - a headless harness,
   * a test surface, a terminal that has not been fitted yet. A front end that
   * needs pixels must handle that rather than assume a canvas exists, which is
   * the same rule `frontend()` already follows about `document`.
   */
  readonly pixels?: RegionPixels;
}

/**
 * The named regions of one screen. A name is missing when the current layout
 * genuinely has no such region (`sidebar` under the None layout), which is why
 * every member is optional except the map - there is always a map.
 */
export interface ScreenRegions {
  readonly map: ScreenRegion;
  readonly messages?: ScreenRegion;
  readonly sidebar?: ScreenRegion;
  readonly status?: ScreenRegion;
}

/**
 * What a grid renderer must publish for its cells to be locatable in pixels.
 *
 * Four numbers rather than a `cellRect(col, row)` call: a consumer computes
 * rectangles for regions the renderer has never heard of, and a per-cell call
 * would make that a loop over thousands of cells to find two corners.
 */
export interface GridPixelMetrics {
  /** One cell's width in CSS pixels. Fractional in reflow mode. */
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** The grid's top-left inside the window: the letterbox offset. */
  readonly originX: number;
  readonly originY: number;
}

/** A surface that can say where its cells are. Optional: see GridPixelMetrics. */
export interface GridGeometry {
  metrics(): GridPixelMetrics;
}

/** The geometry main.ts's viewport() already computes, as an argument. */
export interface ScreenLayout {
  readonly cols: number;
  readonly rows: number;
  /** The sidebar mode in force, AFTER the narrow-screen fallback is applied. */
  readonly sidebar: "left" | "top" | "none";
  /** The Left layout's column width (SIDEBAR_W). Ignored by the other two. */
  readonly sidebarWidth: number;
  readonly mapOriginX: number;
  readonly mapTop: number;
  readonly mapCols: number;
  readonly mapRows: number;
}

/** Project a cell rectangle into the window. */
export function regionPixels(cells: RegionCells, metrics: GridPixelMetrics): RegionPixels {
  return {
    x: metrics.originX + cells.col * metrics.cellWidth,
    y: metrics.originY + cells.row * metrics.cellHeight,
    width: cells.cols * metrics.cellWidth,
    height: cells.rows * metrics.cellHeight,
  };
}

/** True when a cell is inside a region. */
export function regionContains(cells: RegionCells, col: number, row: number): boolean {
  return (
    col >= cells.col &&
    row >= cells.row &&
    col < cells.col + cells.cols &&
    row < cells.row + cells.rows
  );
}

function region(
  name: ScreenRegionName,
  cells: RegionCells,
  metrics: GridPixelMetrics | undefined,
): ScreenRegion {
  return { name, cells, ...(metrics ? { pixels: regionPixels(cells, metrics) } : {}) };
}

/**
 * Divide one screen.
 *
 * The rectangles are what core's own render() draws into, taken from the same
 * numbers rather than written out again beside them - `main-regions.test.ts`
 * is what holds the two together, because a second copy of "the status line is
 * the last row" is the copy that goes stale.
 *
 * THE MAP IS ONE COLUMN SHORT OF THE SCREEN, and that is upstream's rule, not
 * a rounding here: SCREEN_WID reserves the rightmost column (ui-term.h,
 * `wid - COL_MAP - 1`), which is why the map is 66 columns of an 80-column
 * terminal in the Left layout. The status line is the same width for the same
 * reason. A front end that stretched itself over that column would be drawing
 * somewhere the faithful terminal deliberately does not.
 */
export function screenRegions(
  layout: ScreenLayout,
  metrics?: GridPixelMetrics,
): ScreenRegions {
  const { cols, rows } = layout;
  /* Row 0 is the message line and it owns the FULL width from column 0 - it is
   * not indented to the map, and it runs above the sidebar rather than beside
   * it (c_prt at 0,0; see render()). */
  const messages = region("messages", { col: 0, row: 0, cols, rows: 1 }, metrics);
  const map = region(
    "map",
    { col: layout.mapOriginX, row: layout.mapTop, cols: layout.mapCols, rows: layout.mapRows },
    metrics,
  );
  /* The status line starts where the map does and is as wide, so in the Left
   * layout the last row's first 13 columns belong to the sidebar, not to it. */
  const status = region(
    "status",
    { col: layout.mapOriginX, row: rows - 1, cols: layout.mapCols, rows: 1 },
    metrics,
  );
  const sidebar =
    layout.sidebar === "left"
      ? /* Row 1 down to the last row inclusive: sidebarLayout() may place a
         * field on the bottom row, in the columns the status line does not
         * reach. ROW_MAP = 1 is why it starts level with the map's top row. */
        region(
          "sidebar",
          { col: 0, row: 1, cols: layout.sidebarWidth, rows: rows - 1 },
          metrics,
        )
      : layout.sidebar === "top"
        ? region("sidebar", { col: 0, row: 1, cols, rows: 1 }, metrics)
        : /* None: the player turned the vitals furniture off entirely. */
          undefined;
  return { map, messages, status, ...(sidebar ? { sidebar } : {}) };
}
