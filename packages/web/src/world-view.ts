/**
 * Renderer-neutral description of the live map viewport.
 *
 * `main.ts` supplies the game-specific knowledge and visual resolution; this
 * module owns only frame shape and coordinates.  Keeping the output as data is
 * deliberate: the glyph terminal consumes `visual` today, while an isometric
 * or 3D front end can consume `terrain` and `overlays` without reverse-parsing
 * a character cell.  No DOM or canvas type appears in this contract.
 */

import type { Glyph, GridSurface, RenderAssetRef } from "./term";
import type {
  LiveRegion,
  RegionCells,
  RegionPixels,
  ScreenRegion,
  ScreenRegions,
} from "./regions";

export interface WorldGrid {
  readonly x: number;
  readonly y: number;
}

export type WorldVisibility = "seen" | "remembered" | "unknown";
export type WorldLayerKind = "terrain" | "trap" | "object" | "monster" | "player" | "path";

/** The default terminal projection. Alternate renderers may ignore it. */
export interface WorldVisual {
  readonly ch: string;
  readonly fg: string;
  readonly bg?: string;
  readonly asset?: RenderAssetRef;
  readonly backgroundAsset?: RenderAssetRef;
}

/**
 * One meaningful thing known to occupy a grid. `id` is the core registry id
 * (feature, trap kind, object kind, or monster race); it is intentionally not
 * a display string, so another renderer can choose its own art and language.
 */
export interface WorldLayer {
  readonly kind: WorldLayerKind;
  readonly id?: number;
  readonly lighting?: number;
}

/** A world grid as the player knows it, plus the faithful glyph fallback. */
export interface WorldCell {
  readonly grid: WorldGrid;
  readonly screen: WorldGrid;
  readonly visibility: WorldVisibility;
  readonly terrain?: WorldLayer;
  /** Bottom-to-top semantic occupants, excluding terrain. */
  readonly overlays: readonly WorldLayer[];
  /** The existing terminal renderer's resolved result; absent for unknown space. */
  readonly visual?: WorldVisual;
  /** The interactive look/target highlight, independent of terminal chrome. */
  readonly cursor: boolean;
}

export interface WorldPlayer {
  readonly grid: WorldGrid;
  readonly screen: WorldGrid;
  readonly layer: WorldLayer;
  readonly visual: WorldVisual;
  readonly cursor: boolean;
}

export interface WorldFrame {
  readonly viewport: {
    readonly origin: WorldGrid;
    readonly size: { readonly width: number; readonly height: number };
    readonly screenOrigin: WorldGrid;
  };
  /** Every in-bounds grid in viewport order, including unknown grids. */
  readonly cells: readonly WorldCell[];
  /** Separate only to preserve the upstream terminal's player-last paint order. */
  readonly player?: WorldPlayer;
  /**
   * Where this frame's map sits on the screen, and what core is still drawing
   * around it (#234). Optional because a producer without a fitted surface has
   * no geometry to give - not because a front end may ignore it.
   */
  readonly regions?: ScreenRegions;
  /**
   * EVERYTHING ON SCREEN, bottom to top, including the four base tiles
   * `regions` names (#261).
   *
   * WHY A FRONT END NEEDS IT, and the live defect it closes. `regions` answers
   * "where is the map"; it cannot answer "is anything on top of it". A
   * replacement front end draws into its own canvas over the map rectangle, and
   * core's screens - the inventory, the knowledge browser, the Mods screen
   * itself - repaint the terminal underneath that canvas without producing a
   * world frame at all. So the mod's last map stayed floating over the middle of
   * every screen the player opened, which is `samples/blueprint-view`'s original
   * cover-the-window defect back at map size. `occludersOf(stack, "map")` is the
   * question, and this field is what makes it askable.
   *
   * ORDERED, and the order is the answer: a region later in this array is drawn
   * over one earlier in it (`orderRegions`). The four base tiles are always
   * first, so anything a screen or a mod pushed is above them by construction.
   *
   * Optional for the same reason `regions` is - a producer with no fitted
   * surface has no stack to give - and ABSENT IS NOT EMPTY. An empty array means
   * this host published a stack and nothing is on screen; absent means it
   * published none, and a front end that treats the two alike is deciding it is
   * uncovered on the strength of a host that never answered.
   */
  readonly stack?: readonly LiveRegion[];
}

export interface BuildWorldFrameParams {
  readonly width: number;
  readonly height: number;
  readonly origin: WorldGrid;
  readonly size: { readonly width: number; readonly height: number };
  readonly screenOrigin: WorldGrid;
  readonly resolveCell: (grid: WorldGrid, screen: WorldGrid) => WorldCell;
  readonly player?: WorldPlayer;
  readonly regions?: ScreenRegions;
  readonly stack?: readonly LiveRegion[];
}

/**
 * The one consumer boundary for a produced world frame.  Phase 4 deliberately
 * keeps ownership here in the host: Phase 5 will decide which installed front
 * end supplies this sink.  Naming the boundary now prevents the default glyph
 * projection from becoming a second, privileged producer path.
 */
export interface WorldFrameSink {
  present(frame: WorldFrame): void;
}

/**
 * Make a front-end-owned snapshot of one live frame.
 *
 * A plugin is allowed to retain a frame for animation or inspection, so the
 * object it receives must not retain the game's mutable grid objects.  This is
 * deliberately a structural copy rather than a JSON round trip: render assets
 * are opaque renderer-owned values, while every game-derived wrapper and
 * coordinate is copied and frozen.  The default glyph sink keeps consuming the
 * live frame directly; only the cross-plugin boundary needs this ownership cut.
 */
export function snapshotWorldFrame(frame: WorldFrame): WorldFrame {
  const copyGrid = (grid: WorldGrid): WorldGrid => Object.freeze({ x: grid.x, y: grid.y });
  const copyAsset = (asset: RenderAssetRef): RenderAssetRef => Object.freeze({ ...asset });
  const copyVisual = (visual: WorldVisual): WorldVisual => {
    const copy: {
      ch: string; fg: string; bg?: string; asset?: RenderAssetRef; backgroundAsset?: RenderAssetRef;
    } = { ch: visual.ch, fg: visual.fg };
    if (visual.bg !== undefined) copy.bg = visual.bg;
    if (visual.asset !== undefined) copy.asset = copyAsset(visual.asset);
    if (visual.backgroundAsset !== undefined) copy.backgroundAsset = copyAsset(visual.backgroundAsset);
    return Object.freeze(copy);
  };
  const copyLayer = (layer: WorldLayer): WorldLayer =>
    Object.freeze({
      kind: layer.kind,
      ...(layer.id === undefined ? {} : { id: layer.id }),
      ...(layer.lighting === undefined ? {} : { lighting: layer.lighting }),
    });
  const cells: readonly WorldCell[] = Object.freeze(frame.cells.map((cell) => {
    const copy: {
      grid: WorldGrid; screen: WorldGrid; visibility: WorldVisibility; terrain?: WorldLayer;
      overlays: readonly WorldLayer[]; visual?: WorldVisual; cursor: boolean;
    } = {
      grid: copyGrid(cell.grid),
      screen: copyGrid(cell.screen),
      visibility: cell.visibility,
      overlays: Object.freeze(cell.overlays.map(copyLayer)),
      cursor: cell.cursor,
    };
    if (cell.terrain !== undefined) copy.terrain = copyLayer(cell.terrain);
    if (cell.visual !== undefined) copy.visual = copyVisual(cell.visual);
    return Object.freeze(copy);
  }));
  const player = frame.player === undefined
    ? undefined
    : Object.freeze({
        grid: copyGrid(frame.player.grid),
        screen: copyGrid(frame.player.screen),
        layer: copyLayer(frame.player.layer),
        visual: copyVisual(frame.player.visual),
        cursor: frame.player.cursor,
      });
  return Object.freeze({
    viewport: Object.freeze({
      origin: copyGrid(frame.viewport.origin),
      size: Object.freeze({ width: frame.viewport.size.width, height: frame.viewport.size.height }),
      screenOrigin: copyGrid(frame.viewport.screenOrigin),
    }),
    cells,
    ...(player === undefined ? {} : { player }),
    ...(frame.regions === undefined ? {} : { regions: copyRegions(frame.regions) }),
    ...(frame.stack === undefined ? {} : { stack: copyStack(frame.stack) }),
  });
}

/**
 * Regions are recomputed every frame from live terminal metrics, so they are
 * the host's mutable-in-principle objects like everything else here and get the
 * same ownership cut. Cheap: four small rectangles, not a grid of cells.
 */
function copyRegions(regions: ScreenRegions): ScreenRegions {
  const copyCells = (cells: RegionCells): RegionCells =>
    Object.freeze({ col: cells.col, row: cells.row, cols: cells.cols, rows: cells.rows });
  const copyPixels = (pixels: RegionPixels): RegionPixels =>
    Object.freeze({ x: pixels.x, y: pixels.y, width: pixels.width, height: pixels.height });
  const copyRegion = (region: ScreenRegion): ScreenRegion =>
    Object.freeze({
      name: region.name,
      cells: copyCells(region.cells),
      ...(region.pixels === undefined ? {} : { pixels: copyPixels(region.pixels) }),
    });
  return Object.freeze({
    map: copyRegion(regions.map),
    ...(regions.messages === undefined ? {} : { messages: copyRegion(regions.messages) }),
    ...(regions.sidebar === undefined ? {} : { sidebar: copyRegion(regions.sidebar) }),
    ...(regions.status === undefined ? {} : { status: copyRegion(regions.status) }),
  });
}

/**
 * The live stack, owned by whoever receives it.
 *
 * SEPARATE FROM `copyRegions` even though the rectangles are the same shape,
 * because the two carry different things: a `ScreenRegion` has a `name` from a
 * closed set and a `LiveRegion` has an `id` any screen or mod may mint, plus the
 * band that decides what it is drawn over. Sharing one copier would mean one of
 * the two silently losing a field.
 *
 * `ui-stack.ts` rebuilds these objects on every relayout, so they are the host's
 * mutable-in-principle values like everything else here and get the same
 * ownership cut. Cheap: a handful of small rectangles.
 */
function copyStack(stack: readonly LiveRegion[]): readonly LiveRegion[] {
  return Object.freeze(stack.map((region) =>
    Object.freeze({
      id: region.id,
      layer: region.layer,
      cells: Object.freeze({
        col: region.cells.col,
        row: region.cells.row,
        cols: region.cells.cols,
        rows: region.cells.rows,
      }),
      ...(region.pixels === undefined
        ? {}
        : {
            pixels: Object.freeze({
              x: region.pixels.x,
              y: region.pixels.y,
              width: region.pixels.width,
              height: region.pixels.height,
            }),
          }),
    })));
}

/**
 * Preserve grid_data_as_text's terrain pair when a visible path marker covers
 * a tile. A remembered path has always been glyph-only; the visible path is
 * painted by the normal foreground pass and therefore keeps its terrain tile.
 */
export function backgroundAssetForWorldCell(
  visibility: Exclude<WorldVisibility, "unknown">,
  terrainAsset: RenderAssetRef | undefined,
  overlays: readonly WorldLayer[],
): RenderAssetRef | undefined {
  if (overlays.length === 0) return undefined;
  if (visibility === "remembered" && overlays.some((layer) => layer.kind === "path")) {
    return undefined;
  }
  return terrainAsset;
}

/**
 * Produce the exact viewport stream once. Bounds live here so every consumer
 * sees the same ordered, in-world rectangle rather than reimplementing camera
 * clipping around a terminal grid.
 */
export function buildWorldFrame(p: BuildWorldFrameParams): WorldFrame {
  const cells: WorldCell[] = [];
  for (let sy = 0; sy < p.size.height; sy++) {
    for (let sx = 0; sx < p.size.width; sx++) {
      const grid = { x: p.origin.x + sx, y: p.origin.y + sy };
      if (grid.x < 0 || grid.y < 0 || grid.x >= p.width || grid.y >= p.height) continue;
      const screen = { x: p.screenOrigin.x + sx, y: p.screenOrigin.y + sy };
      cells.push(p.resolveCell(grid, screen));
    }
  }
  return {
    viewport: { origin: p.origin, size: p.size, screenOrigin: p.screenOrigin },
    cells,
    ...(p.player ? { player: p.player } : {}),
    ...(p.regions ? { regions: p.regions } : {}),
    ...(p.stack ? { stack: p.stack } : {}),
  };
}

/**
 * The live production path: build one new frame wrapper and cells array, then
 * hand that exact frame object to the sink and return it.  Its viewport values,
 * resolved cells, and optional player are the values supplied by the producer;
 * this function does not clone them. `main.ts` calls this rather than separately
 * building and painting, so its tests cover the production producer-to-consumer
 * boundary.
 */
export function renderWorldFrame(
  params: BuildWorldFrameParams,
  sink: WorldFrameSink,
): WorldFrame {
  const frame = buildWorldFrame(params);
  sink.present(frame);
  return frame;
}

/**
 * The default glyph projection of a live frame. Keeping this consumer beside
 * the frame contract makes its player-last order and tile inputs executable
 * rather than an implicit convention in main.ts.
 */
export function paintWorldFrame(surface: Pick<GridSurface, "put">, frame: WorldFrame): void {
  for (const cell of frame.cells) {
    if (!cell.visual) continue;
    surface.put(cell.screen.x, cell.screen.y, worldVisualToGlyph(cell.visual));
  }
  if (frame.player) {
    surface.put(
      frame.player.screen.x,
      frame.player.screen.y,
      worldVisualToGlyph(frame.player.visual),
    );
  }
}

/** The unmodded renderer's sink; it is an ordinary consumer of the live frame. */
export function glyphWorldFrameSink(surface: Pick<GridSurface, "put">): WorldFrameSink {
  return { present: (frame) => paintWorldFrame(surface, frame) };
}

/**
 * Deliver one already-produced frame to more than one host-owned consumer.
 *
 * This deliberately fans out the object it is given rather than rebuilding a
 * frame per consumer: a debugger, recorder, or future alternate renderer must
 * observe the exact same world snapshot as the glyph terminal. `main.ts` no
 * longer installs the glyph sink directly: since phase 5 it is candidate zero
 * of the front-end selection (`frontend-runtime.ts`), so whoever owns the map
 * is whoever won that selection.
 */
export function teeWorldFrameSink(...sinks: readonly WorldFrameSink[]): WorldFrameSink {
  return { present: (frame) => { for (const sink of sinks) sink.present(frame); } };
}

/**
 * A sink that can be told the STACK changed when no new frame was produced.
 *
 * WHY THIS IS NEEDED AT ALL, and it is the half of #261 that a type alone does
 * not close. A world frame is produced by `render()`, and `render()` does not
 * run while a core screen owns the terminal - a screen repaints itself from its
 * own key loop. So the exact moment a front end most needs to hear "you are
 * covered now" is the one moment nothing is going to tell it: the mod's canvas
 * would sit over the middle of the inventory until the player closed it, which
 * is the live defect. Re-presenting the LAST frame with the NEW stack is what
 * turns the stack from a fact on a frame into a notification.
 *
 * THE LAST FRAME IS STALE ON PURPOSE. The map has not changed - nothing has run
 * that could change it - and inventing a fresh one would mean re-projecting the
 * dungeon from a shell that is not in a repaint. What the consumer needs from
 * this call is the stack; the cells are the ones it already drew.
 */
export interface RestatableWorldFrameSink extends WorldFrameSink {
  /** Re-present the last frame with this stack. No-op before the first frame. */
  restate(stack: readonly LiveRegion[]): void;
}

/**
 * Remember each frame so it can be presented again under a new stack.
 *
 * NOT FOR CORE'S OWN SINK. Core repaints the map from `render()` and from
 * nowhere else; asking the glyph painter to restate would draw the dungeon over
 * whichever screen had just opened - the very thing the notification exists to
 * stop, with core doing it instead of the mod. `frontendWorldFrameSink` is what
 * decides, and it hands core's sink back unwrapped.
 */
export function restatableWorldFrameSink(sink: WorldFrameSink): RestatableWorldFrameSink {
  let last: WorldFrame | undefined;
  return {
    present(frame) {
      last = frame;
      sink.present(frame);
    },
    restate(stack) {
      if (last === undefined) return;
      /* A NEW wrapper object, never a mutation of the remembered one: the frame
       * this sink was handed belongs to the producer, and a consumer that
       * retained the previous snapshot must not see its stack change under it. */
      last = { ...last, stack };
      sink.present(last);
    },
  };
}

function worldVisualToGlyph(visual: WorldVisual): Glyph {
  return {
    ch: visual.ch,
    fg: visual.fg,
    ...(visual.bg !== undefined ? { bg: visual.bg } : {}),
    ...(visual.asset ? { tile: visual.asset } : {}),
    ...(visual.backgroundAsset ? { bgTile: visual.backgroundAsset } : {}),
  };
}
