/**
 * The Borg's own remembered map - a faithful port of the borg_grid struct and
 * the borg_grids[][] cache (reference/src/borg/borg-cave.h, borg-cave-view.h).
 *
 * WHY THE BORG KEEPS ITS OWN MAP: the Borg does not read the engine's cave
 * directly for navigation. It maintains a parallel, deliberately imperfect model
 * of the dungeon that it updates from what it can perceive, exactly as a human
 * player builds a mental map. That self-imposed fog-of-war is behaviorally
 * load-bearing (the C borg re-derives monster/object identity from screen
 * symbols and forgets stale grids), so the port preserves it rather than
 * granting the Borg omniscience over GameState. Perception feeds this model from
 * the frozen AgentView (see perceive.ts); every decision subsystem reads THIS,
 * never the live engine.
 *
 * Faithful to the upstream field-for-field so the ported flow/danger/think code
 * can reference the same names.
 */

/** Maximum dungeon dimensions (z_info->dungeon_wid/hgt). borg-cave.h. */
export const AUTO_MAX_X = 198;
export const AUTO_MAX_Y = 66;

/**
 * borg_grid.info flags (borg-cave-view.h). The Borg tracks light/view/mark
 * state per grid separately from the engine's SQUARE_* flags.
 */
export const BORG_MARK = 0x01; /* observed grid */
export const BORG_GLOW = 0x02; /* probably perma-lit */
export const BORG_DARK = 0x04; /* probably not perma-lit */
export const BORG_OKAY = 0x08; /* on the current panel */
export const BORG_LIGHT = 0x10; /* lit by the torch */
export const BORG_VIEW = 0x20; /* in line of sight */
export const BORG_TEMP = 0x40; /* temporary flag */
export const BORG_XTRA = 0x80; /* extra flag */

/**
 * A single grid in the Borg's remembered dungeon (struct borg_grid). `feat` is
 * the Borg's belief about the terrain (may be wrong/stale); `take`/`kill` index
 * into the object/monster tracking lists (0 = none); `xtra` counts nearby
 * searching. Faithful to borg-cave.h.
 */
export interface BorgGrid {
  /** Grid terrain type (the Borg's belief; FEAT_* index). */
  feat: number;
  /** Grid flags (BORG_* above). */
  info: number;
  trap: boolean;
  glyph: boolean;
  web: boolean;
  /** Store number occupying this grid, 0 for none. */
  store: number;
  /** Object-tracking index (into borg_takes), 0 for none. */
  take: number;
  /** Monster-tracking index (into borg_kills), 0 for none. */
  kill: number;
  /** Extra field (search count). */
  xtra: number;
}

/** A fresh, empty grid (all-zero, as borg_init_cave leaves them). */
export function makeBorgGrid(): BorgGrid {
  return {
    feat: 0,
    info: 0,
    trap: false,
    glyph: false,
    web: false,
    store: 0,
    take: 0,
    kill: 0,
    xtra: 0,
  };
}

/**
 * The Borg's remembered map: borg_grids[AUTO_MAX_Y][AUTO_MAX_X]. Row-major,
 * indexed [y][x] to match the upstream access pattern exactly.
 */
export class BorgMap {
  readonly width = AUTO_MAX_X;
  readonly height = AUTO_MAX_Y;
  private readonly grids: BorgGrid[][];

  constructor() {
    this.grids = new Array(AUTO_MAX_Y);
    for (let y = 0; y < AUTO_MAX_Y; y++) {
      const row = new Array<BorgGrid>(AUTO_MAX_X);
      for (let x = 0; x < AUTO_MAX_X; x++) row[x] = makeBorgGrid();
      this.grids[y] = row;
    }
  }

  /** True when (x, y) is inside the map bounds. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < AUTO_MAX_X && y >= 0 && y < AUTO_MAX_Y;
  }

  /** The grid at (x, y). Callers must ensure bounds (inBounds). */
  at(x: number, y: number): BorgGrid {
    return this.grids[y]![x]!;
  }

  /** Reset every grid to empty (borg_init_cave on level change). */
  wipe(): void {
    for (let y = 0; y < AUTO_MAX_Y; y++) {
      const row = this.grids[y]!;
      for (let x = 0; x < AUTO_MAX_X; x++) {
        const g = row[x]!;
        g.feat = 0;
        g.info = 0;
        g.trap = false;
        g.glyph = false;
        g.web = false;
        g.store = 0;
        g.take = 0;
        g.kill = 0;
        g.xtra = 0;
      }
    }
  }
}
