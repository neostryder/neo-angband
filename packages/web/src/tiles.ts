/**
 * Optional tile renderer: the platform half of the graphics/tiles subsystem.
 *
 * This is the CLASSIC TILESHEET engine - one atlas PNG addressed by (row, col),
 * which is how every tile set upstream ships is described. The shell can also
 * draw loose packs (a directory of individual PNGs addressed by name, with
 * variant pools); that engine is linoleum-pack.ts, and both engines implement
 * the TileBlitter interface below so the live map render has one code path.
 *
 * The core ships the graphics-mode CATALOG (packages/core/src/visuals/grafmode)
 * - names, tile dimensions, directory + image filenames - and the web build ships
 * the ART for all five packs at public/tiles/ (see its CREDITS.md: the terms
 * differ per pack, and Shockbolt's are the author's own). A player can still
 * point the game at a pack of their own with `?tiles=<base-url>&graf=<id>`.
 *
 * ASCII is the DEFAULT: with no graphics mode selected, or if the tileset image
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
} from "@rpgm-tools/neo-angband-core";
import type { GraphicsMode, TilePrefsDeps } from "@rpgm-tools/neo-angband-core";
import type { PackFileResolver } from "./pack-files";

// The Graphics-menu mode list, re-exported so the whole tile subsystem is
// reachable through this module. CORE's tile sets come from the ported
// list.txt catalog and need no mod (tile-catalog.ts); `tiles`-shape mods add
// their own packs on top (tile-mods.ts) and composeTileModes layers the two.
export {
  BUNDLED_TILE_DIRECTORIES,
  composeTileModes,
  coreTileModes,
} from "./tile-catalog";
export type { TileModeEntry } from "./tile-catalog";
export { discoverEnabledTileModes, enabledTileModes } from "./tile-mods";
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
 * What the map render needs of a graphics engine: blit the tile a decoded code
 * addresses, or say you cannot so the cell keeps its ASCII glyph. Implemented by
 * TileSet (tilesheet) and LinoleumPack (loose pack).
 *
 * `grid` is the map cell being drawn. The tilesheet engine ignores it - a code
 * is a fixed atlas position - and a loose pack uses it to resolve a variant
 * POOL to one member, deterministically (same cell, same tile, every replay).
 */
export interface TileBlitter {
  /** Menu label of the mode this draws, for diagnostics. */
  readonly menuname: string;
  /** True once the engine can draw at least some tiles. */
  readonly ready: boolean;
  /** Called when more art has loaded, so the caller can repaint. */
  onReady: (() => void) | null;
  drawTile(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    code: TileCode,
    grid?: { x: number; y: number },
  ): boolean;
}

/**
 * A loaded tileset image plus its tile metrics. Loading is asynchronous and
 * best-effort: `ready` flips true on a successful load and stays false on any
 * error, so callers can keep drawing ASCII until (and unless) tiles arrive.
 */
export class TileSet implements TileBlitter {
  readonly mode: GraphicsMode;
  readonly cellWidth: number;
  readonly cellHeight: number;
  private image: HTMLImageElement | null = null;
  private loaded = false;
  /** Called once the atlas image has finished loading (for a repaint). */
  onReady: (() => void) | null = null;

  /**
   * Build the tileset and start its atlas load.
   *
   * Takes a RESOLVER for the pack's files rather than a finished URL, because two
   * of the three places a tile pack can come from have no URL until something
   * mints one (see PackFileResolver). Construction stays synchronous - the caller
   * gets an object it can hold and draw ASCII through - and the resolve happens on
   * its own turn, exactly as LinoleumPack's asset loads do. A resolver that
   * returns null (or throws) leaves the atlas unloaded, which is the same outcome
   * as a 404: the map stays ASCII.
   */
  constructor(mode: GraphicsMode, resolve: PackFileResolver) {
    this.mode = mode;
    this.cellWidth = mode.cellWidth;
    this.cellHeight = mode.cellHeight;
    void this.startLoad(resolve, `${mode.directory}/${mode.file}`);
  }

  private async startLoad(
    resolve: PackFileResolver,
    relPath: string,
  ): Promise<void> {
    let url: string | null;
    try {
      url = await resolve(relPath);
    } catch {
      url = null;
    }
    if (url === null) return;
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

  /** The mode's menu label (TileBlitter, for diagnostics). */
  get menuname(): string {
    return this.mode.menuname;
  }

  /**
   * Blit one tile onto a 2D context at (dx, dy), scaled to (dw, dh). A no-op
   * (returns false) until the atlas is ready, so the caller can fall back to
   * ASCII. Tiles outside the atlas simply draw nothing (canvas clips).
   *
   * `tall` is a double-height tile (is_dh_tile, grafmode.c L241), and it is
   * BOTTOM-ANCHORED: `code.row` is the LOWER half and row-1 is the upper one,
   * so both the source and the destination grow upward. That is exactly what
   * the reference renderer does - main-sdl.c L5191/L5193 subtracts one source
   * cell height and one destination cell height, then doubles both.
   *
   * Drawing upward writes over the cell above, so the caller is responsible for
   * having painted that cell FIRST; GlyphTerm.flush does it via expandTallDirty.
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    code: TileCode,
    _grid?: { x: number; y: number },
    tall = false,
  ): boolean {
    if (!this.ready || this.image === null) return false;
    const sx = code.col * this.cellWidth;
    const sy = code.row * this.cellHeight;
    try {
      ctx.drawImage(
        this.image,
        sx,
        tall ? sy - this.cellHeight : sy,
        this.cellWidth,
        tall ? this.cellHeight * 2 : this.cellHeight,
        dx,
        tall ? dy - dh : dy,
        dw,
        tall ? dh * 2 : dh,
      );
      return true;
    } catch {
      return false;
    }
  }
}

export interface TileRendererOptions {
  /**
   * How to reach the pack's files, by path relative to the pack ROOT - so the
   * atlas is `${mode.directory}/${mode.file}`. For a pack with a real base URL
   * (`public/tiles/`, a `?tiles=` override, the desktop shell's loopback folder)
   * that is `urlBaseResolver(base)`; for a mod in a picked folder or installed
   * from GitHub it is the mod's own asset resolver. Omitted -> tiles off.
   */
  resolve?: PackFileResolver;
  /** The graphics-mode id to use (list.txt grafID). Defaults to none. */
  grafID?: number;
}

/**
 * Build a TileSet for the configured graphics mode, or null when tiles are
 * disabled: no resolver, GRAPHICS_NONE, or an unknown mode id. Never throws.
 */
export function createTileRenderer(options: TileRendererOptions): TileSet | null {
  const resolve = options.resolve;
  const grafID = options.grafID ?? GRAPHICS_NONE;
  if (resolve === undefined || grafID === GRAPHICS_NONE) return null;

  const mode = getGraphicsMode(grafID);
  if (!mode || mode.grafID === GRAPHICS_NONE || !mode.file) return null;

  return new TileSet(mode, resolve);
}

/**
 * Fetch a graphics mode's pref files and parse them into a core TileMap, through
 * the same pack-relative resolver the atlas load uses. The mode's `pref`
 * (graf-*.prf) is fetched first; its `%:<file>` include lines
 * (ui-prefs.c process_pref_file) pull in the pack's flvr-*.prf and xtra-*.prf,
 * which are pre-fetched here so the synchronous parser's loadFile resolver can
 * satisfy them. Returns null on any fetch failure - the caller then keeps the
 * map ASCII. Never throws.
 */
export async function loadTilePrefs(
  resolve: PackFileResolver,
  mode: GraphicsMode,
  deps: TilePrefsDeps,
): Promise<TileMap | null> {
  if (!mode.pref || mode.pref === "none") return null;
  const fetchText = async (name: string): Promise<string | null> => {
    try {
      const url = await resolve(`${mode.directory}/${name}`);
      if (url === null) return null;
      const r = await fetch(url);
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
