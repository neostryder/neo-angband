/**
 * THE LIVE STACK: which regions are on screen right now, and in what order.
 *
 * `regions.ts` says what a region IS and how a set of them is ordered;
 * `region-surface.ts` says what a region may draw. Neither of them knows what is
 * currently open, because both are pure and take their inputs as arguments. This
 * module is the one mutable thing between them: the list of regions the running
 * shell has actually opened, re-placed whenever the terminal changes shape and
 * painted in one pass at the end of a frame.
 *
 * WHAT WAS MISSING WAS NEVER THAT A SCREEN'S RECTANGLE WAS TOO BIG. A core
 * screen covers the whole terminal and still does: 4.2.6's screens are
 * screen_save / full repaint / screen_load, and the parity suite pins those
 * pictures byte for byte. What a screen had was NO RECTANGLE AT ALL - it opened,
 * drew over everything, and nothing else on the display could learn that it had
 * happened. `pushRegion` is that missing fact and nothing more. A screen that
 * wants to be smaller declares a smaller `place()`; core's declares the terminal.
 *
 * `place()` IS CALLED ON EVERY LAYOUT CHANGE, so the contract on it is narrow on
 * purpose: return a rectangle, do no work. It must not paint, must not read the
 * game, and must not throw - a resize can arrive between any two keystrokes, and
 * an author's exception there would take down the relayout for every OTHER
 * region too. It is called inside a try/catch for that reason, and a region
 * whose `place()` throws is recorded as a fault rather than silently dropped:
 * see `regionStackFaults`.
 *
 * A FAULTED REGION IS NOT PAINTED AND IS NOT IN THE STACK, which sounds like
 * exactly the vanishing act `regions.ts` refuses to allow, and is the opposite:
 * it vanishes WITH a message. There is no honest alternative. A rectangle that
 * runs off the grid cannot be clipped into one that does not without moving
 * somebody's window, and a region drawn at a rectangle its author did not ask
 * for is a bug report nobody can act on.
 */

import {
  orderRegions,
  regionContains,
  regionGridFault,
  regionPixels,
  baseRegionStack,
  type GridPixelMetrics,
  type LiveRegion,
  type RegionCells,
  type RegionLayer,
  type ScreenRegions,
} from "./regions";
import { clipSurface, clipSurfaceFault, type ClippableSurface } from "./region-surface";
import type { GridCell, GridPointerInput, GridSurface } from "./term";

/** The terminal a region is placed against. Cells, because `place()` is. */
export interface StackGrid {
  readonly cols: number;
  readonly rows: number;
}

/**
 * What one region declares about itself.
 *
 * `paint` is OPTIONAL, and its absence is the normal case for core today: a
 * screen that owns the keyboard repaints itself when a key arrives, so the
 * compositor has nothing to do for it. A region WITH a painter is one that wants
 * to be redrawn every frame - a mod's HUD window over a live map - and that is
 * what `paintRegionStack` exists for.
 */
export interface RegionSpec {
  readonly id: string;
  readonly layer: RegionLayer;
  /** Where this region sits on a terminal of this size. Cheap, total, pure. */
  place(grid: StackGrid): RegionCells;
  /** Drawn every frame, through a surface clipped to `place()`'s rectangle. */
  paint?(surface: GridSurface): void;
}

/** A push, held by whoever made it so it can be undone. */
export interface RegionHandle {
  readonly id: string;
  /** Where it is right now, or undefined while it is faulted or released. */
  cells(): RegionCells | undefined;
  /** Why it is not on screen, or undefined when it is. */
  fault(): string | undefined;
  /** Same as `popRegion(handle)`. Idempotent. */
  release(): void;
}

/** One region that asked to be on screen and is not. */
export interface RegionStackFault {
  readonly id: string;
  readonly fault: string;
}

/**
 * The screen the stack is being laid out against.
 *
 * `base` and `metrics` are optional and are REMEMBERED between calls, so a
 * caller that only knows the new grid size (a resize handler firing while a
 * modal owns the terminal) does not have to invent a base layout it has no
 * business computing. Passing them replaces what was remembered.
 */
export interface StackLayout {
  readonly cols: number;
  readonly rows: number;
  readonly base?: ScreenRegions;
  readonly metrics?: GridPixelMetrics;
}

interface Entry {
  readonly spec: RegionSpec;
  cells: RegionCells | undefined;
  fault: string | undefined;
}

let entries: Entry[] = [];
let grid: StackGrid = { cols: 0, rows: 0 };
let metrics: GridPixelMetrics | undefined;
let baseStack: readonly LiveRegion[] = [];
let ordered: readonly LiveRegion[] = [];
/**
 * Which entry produced which `LiveRegion`, by object identity. `orderRegions`
 * returns the same objects it was handed, so identity survives the sort - and it
 * is the only key that works, because two screens may legitimately be open under
 * the same id and a Map keyed by that would lose one of them.
 */
let owners = new Map<LiveRegion, Entry>();
const handles = new WeakMap<RegionHandle, Entry>();

function place(entry: Entry): void {
  if (grid.cols <= 0 || grid.rows <= 0) {
    entry.cells = undefined;
    entry.fault = `the terminal is ${grid.cols}x${grid.rows}: nothing can be placed on it yet`;
    return;
  }
  let cells: RegionCells;
  try {
    cells = entry.spec.place(grid);
  } catch (error) {
    entry.cells = undefined;
    entry.fault = `place() threw: ${String(error)}`;
    return;
  }
  const fault = regionGridFault(cells, grid.cols, grid.rows);
  if (fault !== undefined) {
    entry.cells = undefined;
    entry.fault = fault;
    return;
  }
  entry.cells = cells;
  entry.fault = undefined;
}

function recompose(): void {
  const live: LiveRegion[] = [...baseStack];
  const next = new Map<LiveRegion, Entry>();
  for (const entry of entries) {
    if (entry.cells === undefined) continue;
    const region: LiveRegion = {
      id: entry.spec.id,
      layer: entry.spec.layer,
      cells: entry.cells,
      ...(metrics ? { pixels: regionPixels(entry.cells, metrics) } : {}),
    };
    live.push(region);
    next.set(region, entry);
  }
  ordered = orderRegions(live);
  owners = next;
}

/**
 * Add a region to the stack.
 *
 * `on` is the terminal the caller has just measured. It exists because the first
 * push commonly happens BEFORE any relayout - a screen opens, reads `size()` and
 * declares itself in one breath - and a region placed against a 0x0 grid would
 * be faulted for a reason that is the host's fault rather than the author's.
 */
export function pushRegion(spec: RegionSpec, on?: StackGrid): RegionHandle {
  if (on) grid = { cols: on.cols, rows: on.rows };
  const entry: Entry = { spec, cells: undefined, fault: undefined };
  entries.push(entry);
  place(entry);
  recompose();
  const handle: RegionHandle = {
    id: spec.id,
    cells: () => entry.cells,
    fault: () => entry.fault,
    release: () => popRegion(handle),
  };
  handles.set(handle, entry);
  return handle;
}

/**
 * Remove a region. Idempotent: a screen that closes twice (a dismissing key and
 * a tap arriving in the same tick) must not take a later screen's push with it,
 * which is why this is keyed on the HANDLE and not on the id.
 */
export function popRegion(handle: RegionHandle): void {
  const entry = handles.get(handle);
  if (!entry) return;
  const at = entries.indexOf(entry);
  if (at < 0) return;
  entries.splice(at, 1);
  entry.cells = undefined;
  recompose();
}

/**
 * Re-place every region for a screen of this shape, and answer the new stack.
 *
 * Called on a layout change and once per frame. It draws nothing: a relayout
 * that painted would put a second painter on the frame's hot path, and the
 * frame already has one at the end of it (`paintRegionStack`).
 */
export function relayoutStack(layout: StackLayout): readonly LiveRegion[] {
  grid = { cols: layout.cols, rows: layout.rows };
  if (layout.metrics) metrics = layout.metrics;
  if (layout.base) baseStack = baseRegionStack(layout.base);
  for (const entry of entries) place(entry);
  recompose();
  return ordered;
}

/** The stack as it stands, bottom to top. Base regions first; see `orderRegions`. */
export function liveRegionStack(): readonly LiveRegion[] {
  return ordered;
}

/** Every region that asked to be on screen and is not, with the reason. */
export function regionStackFaults(): readonly RegionStackFault[] {
  const out: RegionStackFault[] = [];
  for (const entry of entries) {
    if (entry.fault !== undefined) out.push({ id: entry.spec.id, fault: entry.fault });
  }
  return out;
}

/** Drop everything. Tests only - the shell's stack outlives every screen in it. */
export function resetRegionStack(): void {
  entries = [];
  grid = { cols: 0, rows: 0 };
  metrics = undefined;
  baseStack = [];
  ordered = [];
  owners = new Map();
}

/**
 * Paint every region that has a painter, bottom to top, each through a surface
 * clipped to its own rectangle.
 *
 * CALL THIS LAST IN A FRAME. `render()` opens with `term.clear()`, so a stack
 * painted anywhere before that is erased by the frame that was supposed to
 * carry it. The symptom is not a missing window - it is a window that flickers
 * only while the player is moving, which reads as the mod being broken.
 */
export function paintRegionStack(host: ClippableSurface): void {
  const { cols } = host.size();
  for (const region of ordered) {
    const entry = owners.get(region);
    if (!entry?.spec.paint) continue;
    /* Refuse rather than draw a region this surface cannot erase honestly; the
     * alternative is erasing with spaces, which punches a hole in whatever the
     * region was floating over. See `clipSurfaceFault`. */
    const fault = clipSurfaceFault(host, region.cells, cols);
    if (fault !== undefined) {
      entry.fault = fault;
      continue;
    }
    try {
      entry.spec.paint(clipSurface(host, region.cells));
      entry.fault = undefined;
    } catch (error) {
      entry.fault = `paint() threw: ${String(error)}`;
    }
  }
}

/**
 * A region's own surface, following the region as it is re-placed.
 *
 * `clipSurface` takes a FIXED rectangle, which is right for a painter called
 * once per frame and wrong for a screen that holds the terminal across a resize:
 * such a screen reads `size()` again on its next repaint, and a clip captured
 * when it opened would answer with the terminal it opened on. This re-derives
 * the clip when - and only when - the rectangle actually moves, so a screen sees
 * the same live geometry it saw before it had a region at all.
 *
 * A MISSING RECTANGLE FALLS BACK TO THE WHOLE HOST rather than to a surface that
 * drops everything. A screen whose region has been popped or faulted is still on
 * screen and still owns the keyboard; drawing it at the terminal's size is what
 * it did before this module existed, and a black rectangle with a live key
 * handler behind it is the worse of the two failures by a distance.
 *
 * Pointer input is forwarded and translated into region-local cells, so a
 * painter written against the terminal reads taps in the same coordinates it
 * draws in. Taps outside the rectangle are dropped for the same reason a write
 * outside it is.
 */
export function regionSurface(
  host: ClippableSurface & Partial<GridPointerInput>,
  cellsOf: () => RegionCells | undefined,
): GridSurface & GridPointerInput {
  let last: RegionCells | undefined;
  let clipped: GridSurface | undefined;
  const rect = (): RegionCells => {
    const size = host.size();
    return cellsOf() ?? { col: 0, row: 0, cols: size.cols, rows: size.rows };
  };
  const at = (): GridSurface => {
    const want = rect();
    if (
      clipped === undefined ||
      last === undefined ||
      last.col !== want.col ||
      last.row !== want.row ||
      last.cols !== want.cols ||
      last.rows !== want.rows
    ) {
      last = want;
      clipped = clipSurface(host, want);
    }
    return clipped;
  };
  return {
    size: () => at().size(),
    invalidate: () => at().invalidate(),
    flush: () => at().flush(),
    clear: () => at().clear(),
    setCursor: (x, y) => at().setCursor(x, y),
    hideCursor: () => at().hideCursor(),
    put: (x, y, glyph) => at().put(x, y, glyph),
    print: (x, y, text, fg, bg) => at().print(x, y, text, fg, bg),
    eraseToEol: (x, y) => at().eraseToEol(x, y),
    prt: (x, y, text, fg) => at().prt(x, y, text, fg),
    onCellTap: (listener) => {
      const subscribe = host.onCellTap;
      /* Two dozen hand-written test doubles implement `GridSurface` without
       * pointer input, and `setActiveCellTap` already treats that as "this
       * surface has no taps". Answering with a no-op disposer keeps that exact
       * outcome instead of throwing on a surface that never had the method. */
      if (typeof subscribe !== "function") return () => {};
      /* `setActiveCellTap`'s compatibility path re-enters with a literal null to
       * tear a pre-split double's handler down. Wrapping that would turn a
       * teardown into a fresh subscription. */
      if (typeof listener !== "function") {
        return subscribe.call(host, listener as unknown as (cell: GridCell) => void);
      }
      return subscribe.call(host, (cell: GridCell) => {
        const cells = rect();
        const col = cell.col - cells.col;
        const row = cell.row - cells.row;
        if (!regionContains({ col: 0, row: 0, cols: cells.cols, rows: cells.rows }, col, row)) {
          return;
        }
        listener({ col, row });
      });
    },
  };
}
