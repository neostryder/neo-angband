/**
 * The production world-frame producer.
 *
 * This is deliberately separate from `main.ts`: the shell supplies live game
 * knowledge through these callbacks, while this module owns the exact
 * map-info layer order and the terminal visual projection.  A test can now run
 * the same producer that `render()` uses, rather than a parallel sample
 * resolver that merely resembles it.
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

/** The pre-frame glyph tuple used by the existing map-info helpers. */
export interface FrameCellGlyph {
  readonly ch: string;
  readonly attr: number;
  readonly css: string;
  readonly bg?: string;
  readonly tile?: RenderAssetRef;
  readonly layer?: WorldLayer;
}

export interface RememberedTerrain {
  /** The semantic terrain layer, before dimming or a remembered occupant. */
  readonly terrain: FrameCellGlyph;
  /** The faithful remembered terrain glyph, already dimmed. */
  readonly drawn: FrameCellGlyph;
  readonly tile?: RenderAssetRef;
}

export interface WorldFrameProducerParams<TMemory, TMonster> {
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
  readonly colorToCss: (attr: number) => string;
  readonly isSeen: (grid: WorldGrid) => boolean;
  readonly knownFeature: (grid: WorldGrid) => number;
  readonly rememberedTerrain: (grid: WorldGrid, feature: number) => RememberedTerrain;
  readonly knownObjectShown: (grid: WorldGrid) => TMemory | undefined;
  readonly rememberedObject: (memory: TMemory, grid: WorldGrid) => FrameCellGlyph;
  readonly seenTerrain: (grid: WorldGrid) => FrameCellGlyph;
  readonly traps: ReadonlyMap<number, FrameCellGlyph>;
  readonly objects: ReadonlyMap<number, FrameCellGlyph>;
  readonly monsters: ReadonlyMap<number, TMonster>;
  readonly composeMonster: (under: FrameCellGlyph, monster: TMonster) => FrameCellGlyph;
  readonly playerGlyph: () => { readonly ch: string; readonly css: string; readonly tile?: RenderAssetRef };
  readonly playerTerrain: (grid: WorldGrid) => FrameCellGlyph;
}

/**
 * Produce and present a live frame with the former `render()` cell resolution.
 * Every callback is a read of the current game state; no duplicated cache or
 * alternate projection is allowed at this boundary.
 */
export function produceWorldFrame<TMemory, TMonster>(
  p: WorldFrameProducerParams<TMemory, TMonster>,
  sink: WorldFrameSink,
): WorldFrame {
  const player = playerFor(p);
  return renderWorldFrame({
    width: p.width,
    height: p.height,
    origin: p.origin,
    size: p.size,
    screenOrigin: p.screenOrigin,
    ...(player ? { player } : {}),
    resolveCell: (grid, screen) => resolveWorldCell(p, grid, screen),
  }, sink);
}

function playerFor<TMemory, TMonster>(p: WorldFrameProducerParams<TMemory, TMonster>): WorldPlayer | undefined {
  const dx = p.playerGrid.x - p.origin.x;
  const dy = p.playerGrid.y - p.origin.y;
  if (dx < 0 || dx >= p.size.width || dy < 0 || dy >= p.size.height) return undefined;
  const cursor = isCursor(p.cursor, p.playerGrid);
  const glyph = p.playerGlyph();
  const terrain = p.playerTerrain(p.playerGrid);
  return {
    grid: p.playerGrid,
    screen: { x: p.screenOrigin.x + dx, y: p.screenOrigin.y + dy },
    layer: { kind: "player", id: 0 },
    visual: {
      ch: glyph.ch,
      fg: glyph.css,
      ...(glyph.tile ? { asset: glyph.tile } : {}),
      ...(terrain.tile ? { backgroundAsset: terrain.tile } : {}),
      ...(cursor ? { bg: p.cursorBackground } : {}),
    },
    cursor,
  };
}

function resolveWorldCell<TMemory, TMonster>(
  p: WorldFrameProducerParams<TMemory, TMonster>,
  grid: WorldGrid,
  screen: WorldGrid,
) {
  const key = p.gridKey(grid);
  const cursor = isCursor(p.cursor, grid);
  const pathColour = p.pathColours.get(key);
  const path = pathColour === undefined ? undefined : { kind: "path" as const };
  if (!p.isSeen(grid)) {
    const feature = p.knownFeature(grid);
    if (feature < 0) {
      const visual = pathColour !== undefined
        ? { ch: "*", fg: p.colorToCss(pathColour), ...(cursor ? { bg: p.cursorBackground } : {}) }
        : cursor ? { ch: " ", fg: p.unknownForeground, bg: p.cursorBackground } : undefined;
      return {
        grid, screen, visibility: "unknown" as const, overlays: path ? [path] : [], cursor,
        ...(visual ? { visual } : {}),
      };
    }
    const remembered = p.rememberedTerrain(grid, feature);
    let drawn: FrameCellGlyph = remembered.drawn;
    const overlays: WorldLayer[] = [];
    const memory = p.knownObjectShown(grid);
    if (memory) {
      drawn = p.rememberedObject(memory, grid);
      if (drawn.layer) overlays.push(drawn.layer);
    }
    const monster = p.monsters.get(key);
    if (monster) {
      drawn = p.composeMonster(drawn, monster);
      if (drawn.layer) overlays.push(drawn.layer);
    }
    if (pathColour !== undefined) {
      drawn = { ch: "*", attr: pathColour, css: p.colorToCss(pathColour) };
      overlays.push(path!);
    }
    return {
      grid,
      screen,
      visibility: "remembered" as const,
      terrain: requiredLayer(remembered.terrain),
      overlays,
      visual: visualFor(drawn, cursor, p.cursorBackground, backgroundAssetForWorldCell("remembered", remembered.tile, overlays)),
      cursor,
    };
  }

  const terrain = p.seenTerrain(grid);
  let drawn: FrameCellGlyph = terrain;
  const overlays: WorldLayer[] = [];
  const trap = p.traps.get(key);
  if (trap) { drawn = trap; if (trap.layer) overlays.push(trap.layer); }
  const object = p.objects.get(key);
  if (object) { drawn = object; if (object.layer) overlays.push(object.layer); }
  const monster = p.monsters.get(key);
  if (monster) {
    drawn = p.composeMonster(drawn, monster);
    if (drawn.layer) overlays.push(drawn.layer);
  }
  if (pathColour !== undefined) {
    drawn = { ch: "*", attr: pathColour, css: p.colorToCss(pathColour) };
    overlays.push(path!);
  }
  return {
    grid,
    screen,
    visibility: "seen" as const,
    terrain: requiredLayer(terrain),
    overlays,
    visual: visualFor(drawn, cursor, p.cursorBackground, backgroundAssetForWorldCell("seen", terrain.tile, overlays)),
    cursor,
  };
}

function requiredLayer(glyph: FrameCellGlyph): WorldLayer {
  if (!glyph.layer) throw new Error("world terrain has no semantic layer");
  return glyph.layer;
}

function visualFor(
  glyph: FrameCellGlyph,
  cursor: boolean,
  cursorBackground: string,
  backgroundAsset?: RenderAssetRef,
): WorldVisual {
  return {
    ch: glyph.ch,
    fg: glyph.css,
    ...(glyph.bg !== undefined ? { bg: glyph.bg } : {}),
    ...(glyph.tile ? { asset: glyph.tile } : {}),
    ...(backgroundAsset ? { backgroundAsset } : {}),
    ...(cursor ? { bg: cursorBackground } : {}),
  };
}

function isCursor(cursor: WorldGrid | undefined, grid: WorldGrid): boolean {
  return !!cursor && cursor.x === grid.x && cursor.y === grid.y;
}
