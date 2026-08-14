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

/**
 * The parts of the BASE layout that have a name. Every one of them is core's.
 *
 * DELIBERATELY NOT WIDENED when regions became stackable. `LiveRegion.id` is a
 * plain string, so a screen or a mod names itself without appearing here. The
 * temptation is one open enum of every region name; it is wrong for a ratchet
 * reason. `SCREEN_REGION_NAMES` means "the regions that tile the terminal", and
 * several loops - `ScreenRegions` itself, the tiling test below - are only
 * correct because that is all it means. Adding "screen" to it would change what
 * every one of those loops asserts, silently.
 */
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

/* ------------------------------------------------------------------------- *
 * THE STACK: regions may overlap, and they are ORDERED.
 *
 * WHAT CHANGED AND WHY. Until now a region was one of four tiles that divided
 * the terminal between them, and the invariant was "no cell is claimed twice".
 * Gap 21 is decided in the direction that breaks it - a screen is COMPOSED of
 * regions and does not cover them - so a floating window has to be able to sit
 * over a map that is still being drawn. The tiling invariant is KEPT, scoped to
 * the base layout where it is still true and still load-bearing. What replaces
 * it globally is stated below, and it is the stronger of the two: overlap is
 * legal, but "who is on top" has exactly one answer.
 *
 * THE GRID IS ALREADY A COMPOSITOR, so none of this invents compositing.
 * GlyphTerm retains cells, and upstream's put_str-does-not-erase versus
 * prt-erases-the-row distinction is ported and load-bearing. `showFloorList` is
 * a shipped overlay relying on exactly that: it clears from a column rightwards
 * and everything to its left survives. What was missing was never the ability
 * to draw over something - it was any way to SAY that you were.
 * ------------------------------------------------------------------------- */

/**
 * Which band a region sits in. Within a band the later-declared region is on
 * top, and for a mod that means load order - the same last-load-wins rule that
 * already decides the front end, the HUD, the screen presenter and the menu
 * transform. Ordering here is that rule wearing a different hat, never a second
 * rule.
 *
 * WHY BANDS AND NOT A NUMERIC Z-INDEX, which is the obvious design: a free
 * number is a coordination problem with no coordinator. Every mod picks a large
 * one, and the first mod to out-bid the mod manager takes away the player's way
 * to turn it off. That is not hypothetical - this module's own header records
 * `blueprint-view` covering the whole window and costing the player their hit
 * points, their messages and the Mods screen at once.
 *
 * STATED COST, because it is a real one: two mods that both want the top
 * overlay cannot both have it, and the loser is the earlier-loaded one. That is
 * the same answer as every other composition layer here gives.
 */
export type RegionLayer = "base" | "overlay" | "modal" | "system";

/** Bottom to top. Paint order, and the order `orderRegions` concatenates in. */
export const REGION_LAYERS: readonly RegionLayer[] = ["base", "overlay", "modal", "system"];

/**
 * The bands a MOD may ask for. `system` is reserved so that whatever the player
 * uses to REGAIN CONTROL - the mod manager, a fault report - can always be
 * drawn above a mod, including above the mod that has gone wrong. A seam that
 * let a mod outrank that would have no recovery path except reinstalling.
 */
export type ModRegionLayer = Exclude<RegionLayer, "system">;

/**
 * A region as it exists in a live stack.
 *
 * `id` is a plain string and NOT `ScreenRegionName` - see that type's comment.
 * The four base regions carry their own names as ids, so `occludersOf(stack,
 * "map")` reads naturally for the one question a replacement front end actually
 * asks.
 */
export interface LiveRegion {
  readonly id: string;
  readonly layer: RegionLayer;
  readonly cells: RegionCells;
  /** Absent for the same reason as `ScreenRegion.pixels`: no projection to give. */
  readonly pixels?: RegionPixels;
}

/**
 * Put a set of regions in paint order: bottom of the stack first.
 *
 * STABLE BY CONSTRUCTION rather than by comparator. A comparator would work
 * only because ES2019 requires `Array.prototype.sort` to be stable, and the
 * failure if that assumption ever slipped is a window that is on top on one
 * machine and behind on another - a bug no screenshot reproduces. Bucketing
 * cannot have that failure at all, so the property does not need to be trusted.
 *
 * TOTAL: every region in goes exactly once out. A region with an unrecognised
 * band SINKS rather than vanishing, because a region that disappears with no
 * error is precisely the class of failure this module exists to stop - and a
 * mod drawing under the map is visible, reportable and obviously wrong in a way
 * that a mod drawing nowhere is not.
 */
export function orderRegions(regions: readonly LiveRegion[]): readonly LiveRegion[] {
  const bands: LiveRegion[][] = REGION_LAYERS.map(() => []);
  const sunk: LiveRegion[] = [];
  for (const r of regions) {
    const band = REGION_LAYERS.indexOf(r.layer);
    if (band < 0) sunk.push(r);
    else bands[band]!.push(r);
  }
  return [...sunk, ...bands.flat()];
}

/** True when two cell rectangles share at least one cell. */
export function regionsIntersect(a: RegionCells, b: RegionCells): boolean {
  return (
    a.col < b.col + b.cols &&
    b.col < a.col + a.cols &&
    a.row < b.row + b.rows &&
    b.row < a.row + a.rows
  );
}

/**
 * The one region a cell is VISIBLY owned by: the top-most in the stack that
 * claims it, or undefined when nothing does.
 *
 * THIS IS THE INVARIANT THAT REPLACED "no cell is claimed twice". Two regions
 * writing one cell is now legal. Two answers to "who is on top" never is - the
 * composite has to be a function of the region set, not of the order some Map
 * happened to iterate in.
 *
 * Takes a stack already in paint order, so it walks it backwards.
 */
export function topRegionAt(
  stack: readonly LiveRegion[],
  col: number,
  row: number,
): LiveRegion | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const r = stack[i]!;
    if (regionContains(r.cells, col, row)) return r;
  }
  return undefined;
}

/**
 * Everything drawn ABOVE `id` that overlaps it, bottom-most first. This is the
 * question a replacement front end asks - "is anything covering the map?" - and
 * the answer is what lets it stand its canvas down instead of showing a map
 * nobody is compositing it with.
 *
 * RETURNS undefined, NOT [], WHEN NO REGION HAS THAT ID, and the distinction is
 * the whole reason for the awkward return type. An empty array means "nothing
 * covers you". `undefined` means "you asked about a region that is not here" -
 * a typo, or a name from a layout that does not have one. Collapsing the two
 * would report a misspelled id as good news, and the symptom would be a mod
 * canvas cheerfully painting over a screen forever.
 */
export function occludersOf(
  stack: readonly LiveRegion[],
  id: string,
): readonly LiveRegion[] | undefined {
  const at = stack.findIndex((r) => r.id === id);
  if (at < 0) return undefined;
  const subject = stack[at]!;
  return stack.slice(at + 1).filter((r) => regionsIntersect(r.cells, subject.cells));
}

/**
 * Why this rectangle cannot live on a grid this size, or undefined if it can.
 *
 * OFF-GRID IS WORSE THAN OVERLAPPING. An overlapping region is drawn and the
 * player can see the argument; a region that runs off the edge is silently
 * CLIPPED, and the author gets a half-drawn window with no error anywhere and
 * nothing to search for. Named as a fault rather than a boolean so the report
 * carries the numbers - "cols 60..100 of an 80-column grid" is a bug someone
 * can fix, and `false` is not.
 */
export function regionGridFault(
  cells: RegionCells,
  cols: number,
  rows: number,
): string | undefined {
  if (cells.cols <= 0 || cells.rows <= 0)
    return `region is ${cells.cols}x${cells.rows} cells: a region must have at least one cell`;
  if (cells.col < 0 || cells.row < 0)
    return `region starts at ${cells.col},${cells.row}: a region cannot start off the grid`;
  if (cells.col + cells.cols > cols)
    return `region spans columns ${cells.col}..${cells.col + cells.cols} of a ${cols}-column grid`;
  if (cells.row + cells.rows > rows)
    return `region spans rows ${cells.row}..${cells.row + cells.rows} of a ${rows}-row grid`;
  return undefined;
}

/**
 * The four named regions of the base layout, as stack entries.
 *
 * They carry their own names as ids and sit in the `base` band, so everything
 * a mod or a screen adds is automatically above them and the front end's
 * question about the map has something to be asked about.
 */
export function baseRegionStack(regions: ScreenRegions): readonly LiveRegion[] {
  const out: LiveRegion[] = [];
  for (const name of SCREEN_REGION_NAMES) {
    const r = regions[name];
    if (r === undefined) continue;
    out.push({ id: r.name, layer: "base", cells: r.cells, ...(r.pixels ? { pixels: r.pixels } : {}) });
  }
  return out;
}
