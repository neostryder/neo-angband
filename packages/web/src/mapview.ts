/**
 * Pure data/geometry for the full-level map ('M', ui-map.c do_cmd_view_map /
 * display_map) and the locate/scroll command ('L', ui-knowledge.c
 * do_cmd_locate + ui-output.c change_panel/modify_panel/verify_panel).
 *
 * Kept separate from main.ts (which cannot be imported by a test - it is a
 * top-level script that reaches for `document.getElementById("game")` the
 * moment it loads) so the priority-resolution algorithm and the panel-pan
 * math are unit-testable in isolation, the same split screens.ts/help.ts
 * already use for their own pure logic. main.ts supplies the live game-state
 * accessors (knownFeat/knownObject/features/monsterIndex/trapIndex - the
 * SAME helpers render() already uses) as small closures; no parallel
 * rendering system is built here, only the scan/scale/priority arithmetic
 * upstream performs in display_map and the panel math from ui-output.c.
 *
 * Neither function below touches the GAME RNG, and display_map /
 * do_cmd_locate / change_panel / modify_panel / verify_panel consume none
 * either. The one random draw in ui-map.c is the hallucinatory-monster/object
 * path, and buildOverview does now model it - but only through the injected
 * `hallucinateAt` callback, which the live shell backs with a display-only
 * stream (see main.ts hallucinationRng). Omit the callback and this module is
 * pure again, which is what every caller but the shell does.
 */

import { DDX, DDY } from "@rpgm-tools/neo-angband-core";
import type { RenderAssetRef } from "./term";

/**
 * A single displayed cell: glyph char + resolved CSS color, plus the graphics
 * tile the cell blits when a tileset is active.
 *
 * The tile pair is not decoration. display_map queues each cell through
 * `Term_queue_char(Term, col + 1, row + 1, a, c, ta, tc)` (ui-map.c:849) -
 * exactly the attr/char + terrain-attr/terrain-char pair the live map queues,
 * so in graphics mode the level overview is a TILE map upstream, and it scales
 * by tile_width / tile_height (ui-map.c:838, 842) which only exists for that
 * reason. Carrying only ch/css made the overview ASCII no matter what the
 * player had selected.
 */
export interface OverviewGlyph {
  ch: string;
  css: string;
  /** The foreground tile (a, c), blitted in place of the ASCII glyph. */
  tile?: RenderAssetRef;
  /** The terrain tile under it (ta, tc), so an alpha foreground shows floor. */
  bgTile?: RenderAssetRef;
}

/**
 * Inputs to buildOverview. All accessors are cave-space (x,y), not
 * screen-space - the scaling to the mapW x mapH box happens inside.
 */
export interface BuildOverviewParams {
  /** cave.width / cave.height (state.chunk.width/height). */
  width: number;
  height: number;
  /** The box's interior size: min(termCols-2, width), min(termRows-2, height). */
  mapW: number;
  mapH: number;
  /** knownFeat(state, loc(x,y)): remembered feat index, or <0 if never seen. */
  knownFeatAt: (x: number, y: number) => number;
  /** The mimic-resolved display glyph + Feature.priority for a known feat index. */
  featureGlyph: (fidx: number) => OverviewGlyph & { priority: number };
  /** Remembered/sensed floor object glyph (knownObject), if any; priority 20. */
  objectGlyphAt?: (x: number, y: number) => OverviewGlyph | null;
  /** Revealed/visible trap glyph, if any; priority 20. */
  trapGlyphAt?: (x: number, y: number) => OverviewGlyph | null;
  /** Visible-or-detected monster glyph, if any; priority 20, wins last (drawn
   * after object/trap in the same grid, mirroring grid_data_as_text's
   * terrain -> trap -> object -> monster layering, which render() already
   * uses for the live map). */
  monsterGlyphAt?: (x: number, y: number) => OverviewGlyph | null;
  playerGrid: { x: number; y: number };
  /**
   * How the player draws on the miniature. display_map has no special case for
   * the player at all - map_info reports the player's own grid like any other,
   * so in graphics mode the '@' is race 0's tile (ui-map.c:184, the
   * MFLAG_VISIBLE player arm). Omit to keep the plain '@'.
   */
  playerGlyph?: OverviewGlyph;
  /**
   * map_info's hallucination pass, applied here because display_map resolves
   * every grid through grid_data_as_text exactly as the live panel does
   * (ui-map.c L825, L837) - so the level miniature hallucinates too. Null means
   * this grid draws normally. Omit to build an overview with no hallucination,
   * which is what every caller that is not the live shell wants.
   *
   * `sensed` is grid_data_as_text's unseen_money/unseen_object arm: it is drawn
   * literally, and an invented object never shows under it.
   */
  hallucinateAt?: (
    x: number,
    y: number,
    present: { object: boolean; sensed: boolean; monster: boolean },
  ) => { object?: OverviewGlyph; monster?: OverviewGlyph } | null;
  /** knownObject's `seen === false`: this grid's memory is a sensed marker. */
  sensedObjectAt?: (x: number, y: number) => boolean;
}

/** The scaled, priority-resolved miniature plus the player's scaled cell. */
export interface Overview {
  /** [row][col], size mapH x mapW; null = no known grid ever mapped here. */
  cells: (OverviewGlyph | null)[][];
  mapW: number;
  mapH: number;
  playerRow: number;
  playerCol: number;
  /** The player's own cell, drawn last over whatever occupies its scaled cell. */
  playerGlyph?: OverviewGlyph;
}

/**
 * display_map's scan (ui-map.c:820-843), adapted to the web's arbitrary
 * viewport box instead of a fixed 80x24 terminal (the verify-required
 * divergence: tile_width/tile_height are always 1 here, so the C tile-
 * rounding branches are dead code and are not ported).
 *
 * For every cave grid, scaled to (row,col) = floor(y*mapH/height),
 * floor(x*mapW/width): resolve ONE top glyph for that grid (terrain, then
 * trap/object/monster override in that order - the same layering render()
 * uses), with priority 20 for anything on top of bare terrain and the
 * feature's own Feature.priority otherwise (upstream: "if (a != ta || c !=
 * tc) tp = 20"). Grids are scanned y-then-x ascending; a cell keeps its
 * current occupant unless a STRICTLY higher priority grid claims it, so
 * ties keep the first (lowest y, then x) grid, exactly as mp[row][col] < tp
 * in the original. A never-seen grid (knownFeatAt < 0) contributes nothing -
 * provably equivalent to upstream's FEAT_NONE, priority 2, since every real
 * terrain feature's priority is >= 5.
 */
export function buildOverview(p: BuildOverviewParams): Overview {
  const { width, height, mapW, mapH } = p;
  if (mapW < 1 || mapH < 1 || width < 1 || height < 1) {
    return {
      cells: [],
      mapW,
      mapH,
      playerRow: 0,
      playerCol: 0,
      ...(p.playerGlyph ? { playerGlyph: p.playerGlyph } : {}),
    };
  }
  const cells: (OverviewGlyph | null)[][] = Array.from({ length: mapH }, () =>
    new Array<OverviewGlyph | null>(mapW).fill(null),
  );
  const priority: number[][] = Array.from({ length: mapH }, () =>
    new Array<number>(mapW).fill(0),
  );
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * mapH) / height);
    for (let x = 0; x < width; x++) {
      const fidx = p.knownFeatAt(x, y);
      if (fidx < 0) continue;
      const col = Math.floor((x * mapW) / width);
      const { priority: terrainPrio, ...terrain } = p.featureGlyph(fidx);
      let glyph: OverviewGlyph = terrain;
      let prio = terrainPrio;
      /* Term_queue_char's (ta, tc) is ALWAYS the terrain pair, whatever
       * overwrites (a, c) - the trap, object or monster on top of it
       * (ui-map.c:849, and grid_data_as_text's L186-189 save). So a foreground
       * layer keeps the terrain tile beneath it, exactly as the live map does. */
      const over = (g: OverviewGlyph): OverviewGlyph =>
        terrain.tile && g.tile && g.tile !== terrain.tile
          ? { ...g, bgTile: terrain.tile }
          : g;
      const trap = p.trapGlyphAt?.(x, y);
      const obj = p.objectGlyphAt?.(x, y);
      const mon = p.monsterGlyphAt?.(x, y);
      const sensed = !!obj && (p.sensedObjectAt?.(x, y) ?? false);
      const fake =
        p.hallucinateAt?.(x, y, { object: !!obj && !sensed, sensed, monster: !!mon }) ?? null;
      /* ui-map.c L193: a trap draws only while the grid is NOT hallucinating. */
      if (trap && !fake) {
        glyph = over(trap);
        prio = 20;
      }
      if (fake?.object) {
        glyph = over(fake.object);
        prio = 20;
      } else if (obj) {
        glyph = over(obj);
        prio = 20;
      }
      if (fake?.monster) {
        glyph = over(fake.monster);
        prio = 20;
      } else if (mon) {
        glyph = over(mon);
        prio = 20;
      }
      const rowArr = priority[row]!;
      if (prio > rowArr[col]!) {
        rowArr[col] = prio;
        cells[row]![col] = glyph;
      }
    }
  }
  const playerRow = Math.floor((p.playerGrid.y * mapH) / height);
  const playerCol = Math.floor((p.playerGrid.x * mapW) / width);
  return {
    cells,
    mapW,
    mapH,
    playerRow,
    playerCol,
    ...(p.playerGlyph ? { playerGlyph: p.playerGlyph } : {}),
  };
}

/** A locate/panel position (top-left of the viewport, cave-space). */
export interface LocatePos {
  x: number;
  y: number;
}

/**
 * change_panel + modify_panel (ui-output.c:518-545, 623-635): shift the
 * panel by HALF a viewport in keypad direction `dir`, then clamp to
 * [0, width-mapCols] x [0, height-mapRows] (0 when the level is smaller than
 * the viewport). DDX/DDY are the port's ddx/ddy tables (loc.ts), identical to
 * upstream's.
 */
export function panLocate(
  pos: LocatePos,
  dir: number,
  mapCols: number,
  mapRows: number,
  width: number,
  height: number,
): LocatePos {
  const dx = DDX[dir] ?? 0;
  const dy = DDY[dir] ?? 0;
  const halfW = Math.floor(mapCols / 2);
  const halfH = Math.floor(mapRows / 2);
  const maxX = Math.max(0, width - mapCols);
  const maxY = Math.max(0, height - mapRows);
  const x = Math.max(0, Math.min(maxX, pos.x + dx * halfW));
  const y = Math.max(0, Math.min(maxY, pos.y + dy * halfH));
  return { x, y };
}

/**
 * do_cmd_locate's relative descriptor (ui-knowledge.c): "" when the panel is
 * back where it started, else " north"/" south" + " west"/" east" + " of".
 */
export function locateRelDesc(top: LocatePos, start: LocatePos): string {
  if (top.y === start.y && top.x === start.x) return "";
  const ns = top.y < start.y ? " north" : top.y > start.y ? " south" : "";
  const we = top.x < start.x ? " west" : top.x > start.x ? " east" : "";
  return `${ns}${we} of`;
}

/**
 * The "Map sector [r,c], which is<desc> your sector." banner
 * (ui-knowledge.c's out_val), with sector coordinates (2*top.y)/mapRows,
 * (2*top.x)/mapCols per upstream's simple (non-center-player) form. The
 * trailing "Direction?" is reworded "Direction (ESC to exit)" for the web
 * (no on-screen prompt line otherwise hints how to leave locate mode).
 */
export function locateSectorBanner(
  top: LocatePos,
  start: LocatePos,
  mapCols: number,
  mapRows: number,
): string {
  const row = mapRows > 0 ? Math.floor((2 * top.y) / mapRows) : 0;
  const col = mapCols > 0 ? Math.floor((2 * top.x) / mapCols) : 0;
  const desc = locateRelDesc(top, start);
  return `Map sector [${row},${col}], which is${desc} your sector.  Direction (ESC to exit)`;
}
