/**
 * The regional-fear caches and their updaters, ported from
 * reference/src/borg/borg-danger.c (the borg_fear_region / borg_fear_monsters
 * arrays) and reference/src/borg/borg-update.c (borg_fear_grid:614 and
 * borg_fear_regional:702, the functions that fill them).
 *
 * borg_fear_monsters[y][x] is extra grid danger radiating from each nearby
 * monster (a 13x13 stamp whose strength falls off with range). borg_fear_region
 * is coarse per-11x11-region fear the borg adds when it is attacked by something
 * it cannot see (an assumed invisible monster). borg_danger reads both.
 *
 * square_isvault GAP: upstream cheats the engine's vault flag to skip adding
 * fear inside vaults. The Borg's remembered map carries no vault flag, so
 * isVault() returns false here (never a vault); this is the only place the fear
 * updaters diverge from upstream, and it only ever adds fear the C would skip.
 */

import { AUTO_MAX_X, AUTO_MAX_Y } from "../world/grid";
import type { BorgWorld } from "../world/model";
import { BI } from "../trait/trait-index";
import { borgLos, trait } from "./geometry";
import type { DangerGlobals } from "./globals";

/** borg_fear_region dimensions: [(AUTO_MAX_Y/11)+1][(AUTO_MAX_X/11)+1]. */
export const FEAR_REGION_H = Math.trunc(AUTO_MAX_Y / 11) + 1; /* 7 */
export const FEAR_REGION_W = Math.trunc(AUTO_MAX_X / 11) + 1; /* 19 */

/**
 * The two fear caches (borg_danger.c:41-46). Stored per Borg (via the per-world
 * danger state) rather than as file globals, matching how BorgWorld replaces the
 * other upstream singletons.
 */
export class FearCaches {
  /** borg_fear_region[FEAR_REGION_H][FEAR_REGION_W]. */
  readonly region2d: number[][];
  /** borg_fear_monsters[AUTO_MAX_Y+1][AUTO_MAX_X+1]. */
  readonly monsters2d: number[][];

  constructor() {
    this.region2d = FearCaches.makeGrid(FEAR_REGION_H, FEAR_REGION_W);
    this.monsters2d = FearCaches.makeGrid(AUTO_MAX_Y + 1, AUTO_MAX_X + 1);
  }

  private static makeGrid(h: number, w: number): number[][] {
    const g = new Array<number[]>(h);
    for (let y = 0; y < h; y++) g[y] = new Array<number>(w).fill(0);
    return g;
  }

  /** borg_fear_region[y/11][x/11]. */
  region(y: number, x: number): number {
    const ry = Math.trunc(y / 11);
    const rx = Math.trunc(x / 11);
    if (ry < 0 || ry >= FEAR_REGION_H || rx < 0 || rx >= FEAR_REGION_W) return 0;
    return this.region2d[ry]![rx]!;
  }

  /** borg_fear_monsters[y][x]. */
  monsters(y: number, x: number): number {
    if (y < 0 || y > AUTO_MAX_Y || x < 0 || x > AUTO_MAX_X) return 0;
    return this.monsters2d[y]![x]!;
  }

  /** Zero both caches (done each perceive pass before re-stamping). */
  wipe(): void {
    for (const row of this.region2d) row.fill(0);
    for (const row of this.monsters2d) row.fill(0);
  }
}

/**
 * square_isvault: the Borg's map has no vault flag, so this is always false.
 * See the file header GAP note. Kept as a named seam for P8.6 to override.
 */
function isVault(_world: BorgWorld, _y: number, _x: number): boolean {
  return false;
}

/**
 * borg_fear_grid (borg-update.c:614): stamp extra grid danger radiating from the
 * monster occupying (y, x), value k, falling off with range and gated on LOS.
 * Verbatim port including the nested range bands and the level-50 halving.
 */
export function borgFearGrid(
  world: BorgWorld,
  g: DangerGlobals,
  fear: FearCaches,
  y: number,
  x: number,
  k: number,
): void {
  /* Not in town */
  if (trait(world, BI.CDEPTH) === 0) return;

  /* In a Sea of Runes, no worry */
  if (g.morgothPosition || g.asPosition) return;

  /* Do not add fear in a vault -- Cheating the cave info */
  if (isVault(world, y, x)) return;

  /* Access the grid info: the monster occupying (y, x). */
  const ag = world.map.inBounds(x, y) ? world.map.at(x, y) : null;
  const killIdx = ag ? ag.kill : 0;
  const kill = killIdx ? world.kills.at(killIdx) : null;
  const ky = kill ? kill.pos.y : y;
  const kx = kill ? kill.pos.x : x;

  /* Level 50 borgs have greatly reduced Monster Fear */
  if (trait(world, BI.CLEVEL) === 50) k = Math.trunc((k * 5) / 10);

  /* Add `val` to borg_fear_monsters[yy][xx] (bounds already guaranteed). */
  const addMon = (yy: number, xx: number, val: number): void => {
    const row = fear.monsters2d[yy];
    if (row) row[xx] = (row[xx] ?? 0) + val;
  };

  /* Collect "fear", spread around */
  for (let x1 = -6; x1 <= 6; x1++) {
    for (let y1 = -6; y1 <= 6; y1++) {
      /* careful */
      if (x + x1 <= 0 || x1 + x >= AUTO_MAX_X) continue;
      if (y + y1 <= 0 || y1 + y >= AUTO_MAX_Y) continue;

      /* Very Weak Fear at this range */
      if (borgLos(world, ky, kx, y + y1, x + x1))
        addMon(y + y1, x + x1, Math.trunc(k / 8));

      /* Next range set */
      if (x1 <= -5 || x1 >= 5) continue;
      if (y1 <= -5 || y1 >= 5) continue;

      /* Weak Fear at this range */
      if (borgLos(world, ky, kx, y + y1, x + x1))
        addMon(y + y1, x + x1, Math.trunc(k / 5));

      /* Next range set */
      if (x1 <= -3 || x1 >= 3) continue;
      if (y1 <= -3 || y1 >= 3) continue;

      /* Fear at this range */
      if (borgLos(world, ky, kx, y + y1, x + x1))
        addMon(y + y1, x + x1, Math.trunc(k / 3));

      /* Next range set */
      if (x1 <= -2 || x1 >= 2) continue;
      if (y1 <= -2 || y1 >= 2) continue;

      /* Mild Fear at this range */
      if (borgLos(world, ky, kx, y + y1, x + x1))
        addMon(y + y1, x + x1, Math.trunc(k / 2));

      /* Next range set */
      if (x1 <= -1 || x1 >= 1) continue;
      if (y1 <= -1 || y1 >= 1) continue;

      /* Full fear close to this monster */
      if (borgLos(world, ky, kx, y + y1, x + x1)) addMon(y + y1, x + x1, k);
    }
  }
}

/**
 * borg_fear_regional (borg-update.c:702): coarse per-region fear the borg adds
 * when attacked by an unseen source. Verbatim port, including the upstream
 * clamp expressions (note y2 is computed from x0 exactly as in the C).
 */
export function borgFearRegional(
  world: BorgWorld,
  fear: FearCaches,
  y: number,
  x: number,
  k: number,
  seenGuy: boolean,
): void {
  /* Do not add fear in a vault -- Cheating the cave info */
  if (isVault(world, y, x)) return;

  /* Messages: the C logs here; the port sets need_shift_panel for the non-LOS
   * case (borg.need_shift_panel = true) and otherwise only logs. */
  if (!seenGuy) {
    world.self.needShiftPanel = true;
  }

  /* Current region */
  const y0 = Math.trunc(y / 11);
  const x0 = Math.trunc(x / 11);

  /* Nearby regions (verbatim; y2 uses x0 as upstream does) */
  const y1 = y0 > 0 ? y0 - 1 : 0;
  const x1 = x0 > 0 ? x0 - 1 : 0;
  const y2 = x0 < 5 ? x0 + 1 : 5;
  const x2 = x0 < 17 ? x0 + 1 : 17;

  /* Add `val` to borg_fear_region[ry][rx]. */
  const addReg = (ry: number, rx: number, val: number): void => {
    const row = fear.region2d[ry];
    if (row) row[rx] = (row[rx] ?? 0) + val;
  };

  /* Collect "fear", spread around */
  addReg(y0, x0, k);
  addReg(y0, x1, k);
  addReg(y0, x2, k);
  addReg(y1, x0, Math.trunc(k / 2));
  addReg(y2, x0, Math.trunc(k / 2));
  addReg(y1, x1, Math.trunc(k / 2));
  addReg(y1, x2, Math.trunc(k / 3));
  addReg(y2, x1, Math.trunc(k / 3));
  addReg(y2, x2, Math.trunc(k / 3));
}
