/**
 * Live map knowledge projected into renderer-neutral world data.
 *
 * `main.ts` supplies only reads from its current game session.  This module
 * owns the former cell-resolution order and produces exactly one WorldFrame
 * for a repaint before sending that same object to its caller's sink.
 */
import type { RenderAssetRef } from "./term";
import {
  backgroundAssetForWorldCell,
  renderWorldFrame,
  type WorldFrame,
  type WorldFrameSink,
  type WorldGrid,
  type WorldLayer,
  type WorldPlayer,
  type WorldVisual,
} from "./world-view";

/** The map-info glyph tuple before the terminal consumes it. */
export interface ResolvedGlyph {
  readonly ch: string;
  readonly attr: number;
  readonly css: string;
  readonly bg?: string;
  readonly tile?: RenderAssetRef;
  readonly layer?: WorldLayer;
}

export interface RememberedCell {
  readonly terrain: ResolvedGlyph;
  readonly visual: ResolvedGlyph;
  readonly terrainAsset?: RenderAssetRef;
}

/** All dependencies are live read callbacks or snapshots made by render(). */
export interface LiveWorldRead<TMemory, TMonster> {
  readonly width: number;
  readonly height: number;
  readonly origin: WorldGrid;
  readonly size: { readonly width: number; readonly height: number };
  readonly screenOrigin: WorldGrid;
  readonly playerGrid: WorldGrid;
  readonly cursor?: WorldGrid;
  readonly cursorBackground: string;
  readonly unknownForeground: string;
  readonly pathColours: ReadonlyMap<number, number>;
  readonly gridKey: (grid: WorldGrid) => number;
  readonly css: (attr: number) => string;
  readonly seen: (grid: WorldGrid) => boolean;
  readonly knownFeature: (grid: WorldGrid) => number;
  readonly remembered: (grid: WorldGrid, feature: number) => RememberedCell;
  readonly rememberedObjectAt: (grid: WorldGrid) => TMemory | undefined;
  readonly rememberedObjectGlyph: (memory: TMemory, grid: WorldGrid) => ResolvedGlyph;
  readonly terrainAt: (grid: WorldGrid) => ResolvedGlyph;
  readonly traps: ReadonlyMap<number, ResolvedGlyph>;
  readonly objects: ReadonlyMap<number, ResolvedGlyph>;
  readonly monsters: ReadonlyMap<number, TMonster>;
  readonly monsterGlyph: (under: ResolvedGlyph, monster: TMonster) => ResolvedGlyph;
  readonly playerGlyph: () => { readonly ch: string; readonly css: string; readonly tile?: RenderAssetRef };
  readonly playerTerrain: (grid: WorldGrid) => ResolvedGlyph;
}

/**
 * The production producer.  Consumers cannot receive a separately rebuilt
 * approximation: the frame returned here is the one passed to `sink`.
 */
export function projectLiveWorld<TMemory, TMonster>(
  read: LiveWorldRead<TMemory, TMonster>,
  sink: WorldFrameSink,
): WorldFrame {
  const player = projectPlayer(read);
  return renderWorldFrame({
    width: read.width,
    height: read.height,
    origin: read.origin,
    size: read.size,
    screenOrigin: read.screenOrigin,
    ...(player ? { player } : {}),
    resolveCell: (grid, screen) => projectCell(read, grid, screen),
  }, sink);
}

function projectPlayer<TMemory, TMonster>(read: LiveWorldRead<TMemory, TMonster>): WorldPlayer | undefined {
  const dx = read.playerGrid.x - read.origin.x;
  const dy = read.playerGrid.y - read.origin.y;
  if (dx < 0 || dy < 0 || dx >= read.size.width || dy >= read.size.height) return undefined;
  const cursor = sameGrid(read.cursor, read.playerGrid);
  const glyph = read.playerGlyph();
  const terrain = read.playerTerrain(read.playerGrid);
  return {
    // `state.actor.grid` is mutable. A WorldFrame may cross into a plugin and
    // be retained there, so it must never carry that live object by alias.
    grid: { x: read.playerGrid.x, y: read.playerGrid.y },
    screen: { x: read.screenOrigin.x + dx, y: read.screenOrigin.y + dy },
    layer: { kind: "player", id: 0 },
    visual: {
      ch: glyph.ch,
      fg: glyph.css,
      ...(glyph.tile ? { asset: glyph.tile } : {}),
      ...(terrain.tile ? { backgroundAsset: terrain.tile } : {}),
      ...(cursor ? { bg: read.cursorBackground } : {}),
    },
    cursor,
  };
}

function projectCell<TMemory, TMonster>(
  read: LiveWorldRead<TMemory, TMonster>, grid: WorldGrid, screen: WorldGrid,
) {
  const key = read.gridKey(grid);
  const cursor = sameGrid(read.cursor, grid);
  const pathColour = read.pathColours.get(key);
  const path = pathColour === undefined ? undefined : { kind: "path" as const };
  if (!read.seen(grid)) return projectUnseen(read, grid, screen, key, cursor, pathColour, path);

  const terrain = read.terrainAt(grid);
  let visual = terrain;
  const overlays: WorldLayer[] = [];
  const trap = read.traps.get(key);
  if (trap) { visual = trap; addLayer(overlays, trap); }
  const object = read.objects.get(key);
  if (object) { visual = object; addLayer(overlays, object); }
  const monster = read.monsters.get(key);
  if (monster) { visual = read.monsterGlyph(visual, monster); addLayer(overlays, visual); }
  if (pathColour !== undefined) { visual = { ch: "*", attr: pathColour, css: read.css(pathColour) }; overlays.push(path!); }
  return {
    grid, screen, visibility: "seen" as const, terrain: layerOf(terrain), overlays,
    visual: toVisual(visual, cursor, read.cursorBackground, backgroundAssetForWorldCell("seen", terrain.tile, overlays)),
    cursor,
  };
}

function projectUnseen<TMemory, TMonster>(
  read: LiveWorldRead<TMemory, TMonster>, grid: WorldGrid, screen: WorldGrid, key: number,
  cursor: boolean, pathColour: number | undefined, path: { readonly kind: "path" } | undefined,
) {
  const feature = read.knownFeature(grid);
  if (feature < 0) {
    const visual = pathColour !== undefined
      ? { ch: "*", fg: read.css(pathColour), ...(cursor ? { bg: read.cursorBackground } : {}) }
      : cursor ? { ch: " ", fg: read.unknownForeground, bg: read.cursorBackground } : undefined;
    return { grid, screen, visibility: "unknown" as const, overlays: path ? [path] : [], cursor, ...(visual ? { visual } : {}) };
  }
  const memory = read.remembered(grid, feature);
  let visual = memory.visual;
  const overlays: WorldLayer[] = [];
  const object = read.rememberedObjectAt(grid);
  if (object) { visual = read.rememberedObjectGlyph(object, grid); addLayer(overlays, visual); }
  const monster = read.monsters.get(key);
  if (monster) { visual = read.monsterGlyph(visual, monster); addLayer(overlays, visual); }
  if (pathColour !== undefined) { visual = { ch: "*", attr: pathColour, css: read.css(pathColour) }; overlays.push(path!); }
  return {
    grid, screen, visibility: "remembered" as const, terrain: layerOf(memory.terrain), overlays,
    visual: toVisual(visual, cursor, read.cursorBackground, backgroundAssetForWorldCell("remembered", memory.terrainAsset, overlays)),
    cursor,
  };
}

function addLayer(layers: WorldLayer[], glyph: ResolvedGlyph): void { if (glyph.layer) layers.push(glyph.layer); }
function layerOf(glyph: ResolvedGlyph): WorldLayer { if (!glyph.layer) throw new Error("world terrain has no semantic layer"); return glyph.layer; }
function sameGrid(a: WorldGrid | undefined, b: WorldGrid): boolean { return !!a && a.x === b.x && a.y === b.y; }
function toVisual(glyph: ResolvedGlyph, cursor: boolean, cursorBackground: string, backgroundAsset?: RenderAssetRef): WorldVisual {
  return { ch: glyph.ch, fg: glyph.css, ...(glyph.bg ? { bg: glyph.bg } : {}), ...(glyph.tile ? { asset: glyph.tile } : {}), ...(backgroundAsset ? { backgroundAsset } : {}), ...(cursor ? { bg: cursorBackground } : {}) };
}
