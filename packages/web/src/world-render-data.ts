/**
 * Live map knowledge projected into renderer-neutral world data.
 *
 * `main.ts` supplies only reads from its current game session.  This module
 * owns the former cell-resolution order and produces exactly one WorldFrame
 * for a repaint before sending that same object to its caller's sink.
 */
import type { RenderAssetRef } from "./term";
import type { ScreenRegions } from "./regions";
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

/** What this grid holds, as map_info knows it by cave-map.c L179. */
export interface HallucinationPresence {
  /** `g->first_kind != 0`: a real known object kind. */
  readonly object: boolean;
  /** `g->unseen_money || g->unseen_object`: a sensed marker, drawn literally. */
  readonly sensed: boolean;
  /** `g->m_idx > 0`: a monster that survived the visibility filter. */
  readonly monster: boolean;
}

/**
 * What the hallucination resolver substitutes into one grid. A non-null result
 * means `g->hallucinate` is still true for this grid after map_info, which is
 * what suppresses the trap layer (ui-map.c L193).
 */
export interface HallucinatedCell {
  /** Replaces the object layer entirely (ui-map.c L214-215). */
  readonly object?: ResolvedGlyph;
  /** Replaces the monster layer entirely, bypassing monsterGlyph (L232-235). */
  readonly monster?: ResolvedGlyph;
}

/** All dependencies are live read callbacks or snapshots made by render(). */
export interface LiveWorldRead<TMemory, TMonster> {
  readonly width: number;
  readonly height: number;
  readonly origin: WorldGrid;
  readonly size: { readonly width: number; readonly height: number };
  readonly screenOrigin: WorldGrid;
  /**
   * The named regions of the screen this frame is being drawn on (#234). Passed
   * through untouched: this producer owns the world, and where the world sits
   * on a screen is the host's fact, not a projection of the dungeon.
   */
  readonly regions?: ScreenRegions;
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
  /**
   * knownObject's `seen === false` arm: this memory is a SENSED marker
   * (unknown_gold_kind / unknown_item_kind), not a known kind. It leaves
   * `first_kind` at 0 upstream, which is why it is asked about separately.
   */
  readonly rememberedObjectSensed?: (memory: TMemory) => boolean;
  readonly terrainAt: (grid: WorldGrid) => ResolvedGlyph;
  readonly traps: ReadonlyMap<number, ResolvedGlyph>;
  readonly objects: ReadonlyMap<number, ResolvedGlyph>;
  readonly monsters: ReadonlyMap<number, TMonster>;
  readonly monsterGlyph: (under: ResolvedGlyph, monster: TMonster) => ResolvedGlyph;
  readonly playerGlyph: () => { readonly ch: string; readonly css: string; readonly tile?: RenderAssetRef };
  readonly playerTerrain: (grid: WorldGrid) => ResolvedGlyph;
  /**
   * map_info's hallucination pass plus grid_data_as_text's two substitution
   * arms (cave-map.c L179-188, ui-map.c L212-235). Null means this grid draws
   * normally - the player is not hallucinating, or the grid was empty and both
   * placeholder rolls missed. Omit entirely to render with no hallucination at
   * all, which is what every test that is not about hallucination wants.
   *
   * The resolver is expected to memoise per frame: the player's grid is
   * resolved twice here (once as a cell, once as the player) and three times in
   * the overview, where upstream resolves it once per pass.
   */
  readonly hallucinate?: (grid: WorldGrid, present: HallucinationPresence) => HallucinatedCell | null;
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
    ...(read.regions ? { regions: read.regions } : {}),
    ...(player ? { player } : {}),
    resolveCell: (grid, screen) => projectCell(read, grid, screen),
  }, sink);
}

function projectPlayer<TMemory, TMonster>(read: LiveWorldRead<TMemory, TMonster>): WorldPlayer | undefined {
  const dx = read.playerGrid.x - read.origin.x;
  const dy = read.playerGrid.y - read.origin.y;
  if (dx < 0 || dy < 0 || dx >= read.size.width || dy >= read.size.height) return undefined;
  const cursor = sameGrid(read.cursor, read.playerGrid);
  const terrain = read.playerTerrain(read.playerGrid);
  /* map_info gives the player's own grid `m_idx = 0` (cave-map.c L104), so it
   * enters the placeholder block like any empty grid - and grid_data_as_text
   * tests `g->m_idx > 0` BEFORE `g->is_player` (ui-map.c L229, L282). A
   * hallucinating player therefore sees their own '@' replaced by a random
   * monster 1 time in 128. Without this the port would paint the player last
   * and unconditionally, and that one arm would be unreachable. */
  const fake = read.hallucinate?.(read.playerGrid, { object: false, sensed: false, monster: false }) ?? null;
  const glyph = fake?.monster
    ? { ch: fake.monster.ch, css: fake.monster.css, ...(fake.monster.tile ? { tile: fake.monster.tile } : {}) }
    : read.playerGlyph();
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
  const object = read.objects.get(key);
  const monster = read.monsters.get(key);
  /* Everything below is grid_data_as_text's layering order, with the two
   * hallucination substitutions in the arms upstream puts them in. A live
   * object is always a real kind, so `sensed` is false on this path. */
  const fake = read.hallucinate?.(grid, { object: !!object, sensed: false, monster: !!monster }) ?? null;
  /* ui-map.c L193: a trap is drawn only when the grid is NOT hallucinating. */
  if (trap && !fake) { visual = trap; addLayer(overlays, trap); }
  if (fake?.object) { visual = fake.object; addLayer(overlays, fake.object); }
  else if (object) { visual = object; addLayer(overlays, object); }
  if (fake?.monster) { visual = fake.monster; addLayer(overlays, fake.monster); }
  else if (monster) { visual = read.monsterGlyph(visual, monster); addLayer(overlays, visual); }
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
  const monster = read.monsters.get(key);
  /* map_info runs on remembered grids too - it never tests in_view before the
   * placeholder block - so an unseen corridor hallucinates exactly as a lit one
   * does. A sensed marker is `first_kind == 0` with an unseen_* flag set, so it
   * still qualifies the grid for a placeholder while never being replaced. */
  const sensed = object !== undefined && (read.rememberedObjectSensed?.(object) ?? false);
  const fake = read.hallucinate?.(grid, {
    object: object !== undefined && !sensed, sensed, monster: !!monster,
  }) ?? null;
  if (fake?.object) { visual = fake.object; addLayer(overlays, fake.object); }
  else if (object) { visual = read.rememberedObjectGlyph(object, grid); addLayer(overlays, visual); }
  if (fake?.monster) { visual = fake.monster; addLayer(overlays, fake.monster); }
  else if (monster) { visual = read.monsterGlyph(visual, monster); addLayer(overlays, visual); }
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
