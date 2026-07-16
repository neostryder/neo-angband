/**
 * Optional tile renderer: the platform half of the graphics/tiles subsystem.
 *
 * The core ships the graphics-mode CATALOG (packages/core/src/visuals/grafmode)
 * - names, tile dimensions, directory + image filenames - but NO tile IMAGE
 * assets. The tile art packs (adam-bolt, gervais, shockbolt, nomad) carry
 * their own licenses (Shockbolt's is NOT freely redistributable for commercial
 * use), so nothing is bundled. A user supplies their own pack and points the
 * game at it with a configurable base URL (`?tiles=<base-url>&graf=<id>`).
 *
 * ASCII is the DEFAULT: with no base URL configured, or if the tileset image
 * fails to load, createTileRenderer returns null and the game renders as pure
 * ASCII. Nothing here can crash the game - every failure path degrades.
 *
 * The attr/char -> tile-atlas pref mapping (graf-*.prf, ui-prefs.c) is ported
 * in core (visuals/tile-prefs.ts). This module provides the tileset image LOAD
 * path, the classic tile-code blit primitive, and loadTilePrefs, which fetches
 * a pack's graf/flvr/xtra pref files and parses them into a core TileMap; the
 * live map render (main.ts) looks each cell's entity up in that map and blits
 * the tile, falling back to ASCII. The double-height (overdraw) test lives in
 * core (isDoubleHeightTile).
 */

import {
  getGraphicsMode,
  GRAPHICS_NONE,
  parseTilePrefsInto,
  TileMap,
} from "@neo-angband/core";
import type { GraphicsMode, TilePrefsDeps } from "@neo-angband/core";

// The tile-mode registry driven by enabled `tiles`-shape mods (neo-linoleum).
// Re-exported so the whole tile subsystem is reachable through this module: the
// Options tile-mode selector builds its pack list from discoverEnabledTileModes
// (a graphics set is offered only when its contributing mod is enabled) instead
// of a hardcoded catalog slice. See tile-mods.ts.
export {
  discoverEnabledTileModes,
  enabledTileModes,
} from "./tile-mods";
export type { TileModePack } from "./tile-mods";

/**
 * The classic Angband tile encoding: a cell is a tile (not an ASCII glyph)
 * when both the attr and char have the high bit set; the atlas position is
 * (row = attr & 0x7F, col = char & 0x7F).
 */
export interface TileCode {
  row: number;
  col: number;
}

/** True when an (attr, char) pair addresses a tile rather than an ASCII glyph. */
export function isTile(attr: number, char: number): boolean {
  return (attr & 0x80) !== 0 && (char & 0x80) !== 0;
}

/** Decode an (attr, char) tile pair into its atlas (row, col). */
export function tileCode(attr: number, char: number): TileCode {
  return { row: attr & 0x7f, col: char & 0x7f };
}

/**
 * A loaded tileset image plus its tile metrics. Loading is asynchronous and
 * best-effort: `ready` flips true on a successful load and stays false on any
 * error, so callers can keep drawing ASCII until (and unless) tiles arrive.
 */
export class TileSet {
  readonly mode: GraphicsMode;
  readonly cellWidth: number;
  readonly cellHeight: number;
  private image: HTMLImageElement | null = null;
  private loaded = false;
  /** Called once the atlas image has finished loading (for a repaint). */
  onReady: (() => void) | null = null;

  constructor(mode: GraphicsMode, url: string) {
    this.mode = mode;
    this.cellWidth = mode.cellWidth;
    this.cellHeight = mode.cellHeight;
    try {
      const img = new Image();
      img.addEventListener("load", () => {
        this.loaded = true;
        this.onReady?.();
      });
      img.addEventListener("error", () => {
        this.loaded = false;
        this.image = null;
      });
      img.src = url;
      this.image = img;
    } catch {
      this.image = null;
    }
  }

  /** True once the atlas image has loaded successfully. */
  get ready(): boolean {
    return this.loaded && this.image !== null;
  }

  /**
   * Blit one tile onto a 2D context at (dx, dy), scaled to (dw, dh). A no-op
   * (returns false) until the atlas is ready, so the caller can fall back to
   * ASCII. Tiles outside the atlas simply draw nothing (canvas clips).
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    code: TileCode,
  ): boolean {
    if (!this.ready || this.image === null) return false;
    const sx = code.col * this.cellWidth;
    const sy = code.row * this.cellHeight;
    try {
      ctx.drawImage(
        this.image,
        sx,
        sy,
        this.cellWidth,
        this.cellHeight,
        dx,
        dy,
        dw,
        dh,
      );
      return true;
    } catch {
      return false;
    }
  }
}

export interface TileRendererOptions {
  /**
   * Base URL/path the user's tile pack lives under (e.g. "/tiles/" or
   * "https://my-cdn.example/angband-tiles/"). The atlas is fetched from
   * `${baseUrl}${mode.directory}/${mode.file}`. Omitted/empty -> tiles off.
   */
  baseUrl?: string;
  /** The graphics-mode id to use (list.txt grafID). Defaults to none. */
  grafID?: number;
}

/**
 * Build a TileSet for the configured graphics mode, or null when tiles are
 * disabled: no base URL, GRAPHICS_NONE, or an unknown mode id. Never throws.
 */
export function createTileRenderer(options: TileRendererOptions): TileSet | null {
  const baseUrl = options.baseUrl ?? "";
  const grafID = options.grafID ?? GRAPHICS_NONE;
  if (!baseUrl || grafID === GRAPHICS_NONE) return null;

  const mode = getGraphicsMode(grafID);
  if (!mode || mode.grafID === GRAPHICS_NONE || !mode.file) return null;

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${base}${mode.directory}/${mode.file}`;
  return new TileSet(mode, url);
}

/**
 * Fetch a graphics mode's pref files and parse them into a core TileMap. The
 * mode's `pref` (graf-*.prf) is fetched first; its `%:<file>` include lines
 * (ui-prefs.c process_pref_file) pull in the pack's flvr-*.prf and xtra-*.prf,
 * which are pre-fetched here so the synchronous parser's loadFile resolver can
 * satisfy them. Returns null on any fetch failure - the caller then keeps the
 * map ASCII. Never throws.
 */
export async function loadTilePrefs(
  baseUrl: string,
  mode: GraphicsMode,
  deps: TilePrefsDeps,
): Promise<TileMap | null> {
  if (!mode.pref || mode.pref === "none") return null;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const dir = `${base}${mode.directory}/`;
  const fetchText = async (name: string): Promise<string | null> => {
    try {
      const r = await fetch(dir + name);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  };
  const grafText = await fetchText(mode.pref);
  if (grafText === null) return null;

  // Pre-fetch every referenced include so the sync parser can resolve them.
  const includes = new Map<string, string>();
  for (const m of grafText.matchAll(/^%:(.+)$/gm)) {
    const name = (m[1] ?? "").trim();
    if (!name || includes.has(name)) continue;
    const text = await fetchText(name);
    if (text !== null) includes.set(name, text);
  }

  const map = new TileMap();
  parseTilePrefsInto(map, grafText, {
    ...deps,
    loadFile: (name: string) => includes.get(name) ?? null,
  });
  return map;
}
