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
  isDoubleHeightTile,
  parseTilePrefsInto,
  TileMap,
} from "@rpgm-tools/neo-angband-core";
import type { GraphicsMode, TilePrefsDeps } from "@rpgm-tools/neo-angband-core";
import type { PackFileResolver } from "./pack-files";
import { preloadPrefIncludes } from "./prefs-ui";
import { tileRegistry } from "./tile-registry";

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

/**
 * Is a tile blit from (srcW, srcH) into (dstW, dstH) a DOWNSCALE on either
 * axis (#100)? Nearest-neighbour sampling is correct for pixel-art upscaling
 * - it is what keeps the bitmap font and integer-upscaled small tiles crisp -
 * but it is not automatically correct the other direction: downscaling with
 * nearest samples one source texel per destination pixel and throws the rest
 * away, which reads harsher than a filtered downscale.
 *
 * Equal-size (dst == src on both axes) and any upscale axis is NOT a
 * downscale, so it keeps nearest - only a strictly smaller destination axis
 * calls for smoothing.
 */
export function isTileDownscale(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): boolean {
  return dstW < srcW || dstH < srcH;
}

/**
 * Run one tile blit with the canvas smoothing mode `isTileDownscale` picks for
 * it, then RESTORE whatever smoothing state the context had before.
 *
 * The restore is load-bearing, not tidy: GlyphTerm paints one shared 2D
 * context cell by cell, tiles and bitmap-font glyphs interleaved in the same
 * flush pass (paintCell in term.ts). A downscaled tile that left smoothing on
 * would blur the very next cell's nearest-neighbour glyph, which must stay
 * crisp regardless of the scale direction its neighbour happened to need.
 */
export function withTileSmoothing<T>(
  ctx: CanvasRenderingContext2D,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  draw: () => T,
): T {
  const prevEnabled = ctx.imageSmoothingEnabled;
  const prevQuality = ctx.imageSmoothingQuality;
  const downscale = isTileDownscale(srcW, srcH, dstW, dstH);
  ctx.imageSmoothingEnabled = downscale;
  if (downscale) ctx.imageSmoothingQuality = "high";
  try {
    return draw();
  } finally {
    ctx.imageSmoothingEnabled = prevEnabled;
    ctx.imageSmoothingQuality = prevQuality;
  }
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
  /**
   * Does this code's picture occupy TWO cells, bottom-anchored - upstream's
   * double-height overdraw (is_dh_tile, grafmode.c L241)?
   *
   * THE ENGINE HAS TO ANSWER THIS, not the caller. A code means whatever the
   * engine that minted it says it means: for a tilesheet it is an atlas
   * (row, col) and the answer is the MODE's overdraw band, exactly as the C
   * reads it; for a loose pack it is a synthetic SLOT (slotToAtlas) with no
   * tileset row in it at all, and the row test is not merely unavailable but
   * meaningless. main.ts used to compute this itself from the core catalog,
   * which silently answered "never" for every mod-supplied mode - see #243.
   *
   * `grid` is passed for the same reason drawTile takes it: a pool resolves to a
   * different member per cell, and members may differ in height.
   */
  isTall(code: TileCode, grid?: { x: number; y: number }): boolean;
  /**
   * Start this code's asset loading without drawing it, so a cell the player
   * has not reached yet can already be warm by the time it is. Optional and
   * absent on TileSet: a tilesheet has one atlas image, loaded in full the
   * moment the mode is chosen, so there is nothing per-tile to warm. Only
   * LinoleumPack's lazy per-asset cache needs this (see #290's cold-boot
   * staircase flash).
   */
  preload?(code: TileCode, grid?: { x: number; y: number }): void;
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
   * is_dh_tile against THIS tileset's own mode (TileBlitter.isTall).
   *
   * The mode is held, not looked up: a tilesheet pack contributed by a mod
   * re-skins a row of the core catalog and so is constructed from a real
   * GraphicsMode, while a lookup by the live grafID answers `undefined` for any
   * id the catalog does not list. `code.row` is the attr's low seven bits, so
   * the high bit goes back on for the C's `!(a & 0x80)` guard.
   */
  isTall(code: TileCode): boolean {
    return isDoubleHeightTile(this.mode, 0x80 | code.row);
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
    const image = this.image;
    if (!this.ready || image === null) return false;
    const sx = code.col * this.cellWidth;
    const sy = code.row * this.cellHeight;
    const sw = this.cellWidth;
    const sh = tall ? this.cellHeight * 2 : this.cellHeight;
    const ddh = tall ? dh * 2 : dh;
    try {
      withTileSmoothing(ctx, sw, sh, dw, ddh, () =>
        ctx.drawImage(
          image,
          sx,
          tall ? sy - this.cellHeight : sy,
          sw,
          sh,
          dx,
          tall ? dy - dh : dy,
          dw,
          ddh,
        ),
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
 * One mod's pref file as the caller latched it: the bytes, and every file its
 * `%:` lines pull in, already read.
 *
 * THE INCLUDES TRAVEL WITH THE TEXT rather than being fetched here, because the
 * mod that supplied them may be long out of reach by the time a graphics mode is
 * switched - the whole reason the text is latched at all. `includes` is required
 * rather than optional for the reason #278 exists: an omitted map is a silently
 * skipped directive, and a skipped `%:` reports nothing by construction. A
 * caller with nothing to include passes an empty map and says so.
 */
export interface ModPrefText {
  readonly text: string;
  readonly includes: ReadonlyMap<string, string>;
}

/**
 * Fetch a graphics mode's pref files and parse them into a core TileMap, through
 * the same pack-relative resolver the atlas load uses. The mode's `pref`
 * (graf-*.prf) is fetched first; its `%:<file>` include lines
 * (ui-prefs.c process_pref_file) pull in the pack's flvr-*.prf and xtra-*.prf,
 * which are pre-fetched here so the synchronous parser's loadFile resolver can
 * satisfy them. Mod pref texts, already read and latched by the caller in
 * enabled load order, layer over that fresh map through the same parser - each
 * with its OWN includes, since a mod's files and a pack's files are two
 * different directories and a name may exist in both. Returns null on any pack
 * fetch failure - the caller then keeps the map ASCII. Never throws.
 *
 * Pack includes use the same depth-bounded preload as mod pref resources, so a
 * nested pack include is available to the synchronous parser just like a mod's.
 */
export async function loadTilePrefs(
  resolve: PackFileResolver,
  mode: GraphicsMode,
  deps: TilePrefsDeps,
  modPrefTexts: readonly ModPrefText[] = [],
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
  const includes = await preloadPrefIncludes(grafText, fetchText);

  const map = new TileMap();
  parseTilePrefsInto(map, grafText, {
    ...deps,
    loadFile: (name: string) => includes.get(name) ?? null,
  });
  for (const mod of modPrefTexts) {
    parseTilePrefsInto(map, mod.text, {
      ...deps,
      loadFile: (name: string) => mod.includes.get(name) ?? null,
    });
  }
  /*
   * LAST, so that any tile an author actually named - the pack's own, or a
   * mod's pref layered above - is already in place and is left alone. A filler
   * only ever supplies what nothing assigned, which in practice means content a
   * mod added and the tile pack has never heard of.
   *
   * `derive` IS NULL HERE, and that is the difference between the two engines
   * rather than an omission. This pack is one image cut into a fixed grid of
   * cells: every cell is somebody's tile and there is no spare one to put a
   * variant of an existing tile into. A filler that wanted a distinctive
   * picture gets null and copies a donor instead. The loose-pack engine
   * (linoleum-pack.ts) can allocate, so it passes a real one.
   */
  tileRegistry.run(
    map,
    { engine: "tilesheet", id: mode.directory, menuname: mode.menuname },
    null,
  );
  return map;
}
