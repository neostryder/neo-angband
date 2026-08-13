/**
 * The public, renderer-neutral data a replacement front end consumes.
 *
 * This module contains types only. A folder plugin may `import type` from the
 * SDK while its built JavaScript continues to have no bare engine import.
 */

export interface WorldGrid {
  readonly x: number;
  readonly y: number;
}

export type WorldVisibility = "seen" | "remembered" | "unknown";
export type WorldLayerKind = "terrain" | "trap" | "object" | "monster" | "player" | "path";

export interface WorldRenderAssetRef {
  readonly kind: string;
  readonly key?: string;
  readonly data: unknown;
}

export interface WorldVisual {
  readonly ch: string;
  readonly fg: string;
  readonly bg?: string;
  readonly asset?: WorldRenderAssetRef;
  readonly backgroundAsset?: WorldRenderAssetRef;
}

export interface WorldLayer {
  readonly kind: WorldLayerKind;
  readonly id?: number;
  readonly lighting?: number;
}

export interface WorldCell {
  readonly grid: WorldGrid;
  readonly screen: WorldGrid;
  readonly visibility: WorldVisibility;
  readonly terrain?: WorldLayer;
  readonly overlays: readonly WorldLayer[];
  readonly visual?: WorldVisual;
  readonly cursor: boolean;
}

export interface WorldPlayer {
  readonly grid: WorldGrid;
  readonly screen: WorldGrid;
  readonly layer: WorldLayer;
  readonly visual: WorldVisual;
  readonly cursor: boolean;
}

/** A rectangle of the game's character grid, in cells. */
export interface RegionCells {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

/**
 * The same rectangle in CSS pixels, in the game window's coordinate space -
 * the space `getBoundingClientRect()` answers in and `position: fixed`
 * positions in. Put your canvas here and the rest of the game stays readable.
 */
export interface RegionPixels {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The parts of the screen that have a name. */
export type ScreenRegionName = "messages" | "sidebar" | "map" | "status";

export interface ScreenRegion {
  readonly name: ScreenRegionName;
  readonly cells: RegionCells;
  /** Absent when the host has no pixel projection - a headless harness, a test. */
  readonly pixels?: RegionPixels;
}

/**
 * Where the game is drawing, by name.
 *
 * `map` is YOURS while you hold the display: core has stopped drawing it. The
 * others are core's, still being drawn, and they are published so a front end
 * can stay off them - or deliberately cover them, knowing what it is covering.
 *
 * A name is absent when this layout has no such region: `sidebar` is undefined
 * when the player has turned the vitals furniture off ('=' -> (o) -> None).
 * The names are ROLES rather than places, so `sidebar` is the 13-column left
 * column in one layout and a one-line header under the messages in another.
 */
export interface ScreenRegions {
  readonly map: ScreenRegion;
  readonly messages?: ScreenRegion;
  readonly sidebar?: ScreenRegion;
  readonly status?: ScreenRegion;
}

export interface WorldFrame {
  readonly viewport: {
    readonly origin: WorldGrid;
    readonly size: { readonly width: number; readonly height: number };
    readonly screenOrigin: WorldGrid;
  };
  readonly cells: readonly WorldCell[];
  readonly player?: WorldPlayer;
  /**
   * Optional because a host without a fitted surface has no geometry to give,
   * not because it is optional to respect. Read `regions.map.pixels` and draw
   * there; a front end that covers the window takes the sidebar, the messages
   * and every menu with it, and the player cannot turn it off again.
   */
  readonly regions?: ScreenRegions;
}

export interface WorldFrameSink {
  present(frame: WorldFrame): void;
}
