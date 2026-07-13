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
 * Neither function below touches the game RNG (display_map and
 * do_cmd_locate/change_panel/modify_panel/verify_panel consume none either -
 * the only random draw anywhere in ui-map.c is the hallucinatory-monster/
 * object path, which this port does not model here).
 */

import { DDX, DDY } from "@neo-angband/core";

/** A single displayed cell: glyph char + resolved CSS color. */
export interface OverviewGlyph {
  ch: string;
  css: string;
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
}

/** The scaled, priority-resolved miniature plus the player's scaled cell. */
export interface Overview {
  /** [row][col], size mapH x mapW; null = no known grid ever mapped here. */
  cells: (OverviewGlyph | null)[][];
  mapW: number;
  mapH: number;
  playerRow: number;
  playerCol: number;
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
    return { cells: [], mapW, mapH, playerRow: 0, playerCol: 0 };
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
      const terrain = p.featureGlyph(fidx);
      let glyph: OverviewGlyph = { ch: terrain.ch, css: terrain.css };
      let prio = terrain.priority;
      const trap = p.trapGlyphAt?.(x, y);
      if (trap) {
        glyph = trap;
        prio = 20;
      }
      const obj = p.objectGlyphAt?.(x, y);
      if (obj) {
        glyph = obj;
        prio = 20;
      }
      const mon = p.monsterGlyphAt?.(x, y);
      if (mon) {
        glyph = mon;
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
  return { cells, mapW, mapH, playerRow, playerCol };
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
