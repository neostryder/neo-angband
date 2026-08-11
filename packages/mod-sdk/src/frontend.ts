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

export interface WorldFrame {
  readonly viewport: {
    readonly origin: WorldGrid;
    readonly size: { readonly width: number; readonly height: number };
    readonly screenOrigin: WorldGrid;
  };
  readonly cells: readonly WorldCell[];
  readonly player?: WorldPlayer;
}

export interface WorldFrameSink {
  present(frame: WorldFrame): void;
}
