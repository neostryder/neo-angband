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
}

export interface BuildWorldFrameParams {
  readonly width: number;
  readonly height: number;
  readonly origin: WorldGrid;
  readonly size: { readonly width: number; readonly height: number };
  readonly screenOrigin: WorldGrid;
  readonly resolveCell: (grid: WorldGrid, screen: WorldGrid) => WorldCell;
  readonly player?: WorldPlayer;
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
 * observe the exact same world snapshot as the glyph terminal. `main.ts`
 * still installs only the glyph sink until Phase 5 selects another owner.
 */
export function teeWorldFrameSink(...sinks: readonly WorldFrameSink[]): WorldFrameSink {
  return { present: (frame) => { for (const sink of sinks) sink.present(frame); } };
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
