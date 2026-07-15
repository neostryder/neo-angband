/**
 * Shared constants and small helpers for the Borg flow/pathfinding port
 * (reference/src/borg/borg-flow*.c). Kept in one place so every flow module
 * references the exact same magic numbers, feature ordinals, and direction
 * tables the C borg used.
 *
 * FAITHFULNESS NOTES
 * - FEAT_* comes straight from the engine's generated terrain enum
 *   (packages/core generated FEAT, itself generated from list-terrain.h) so the
 *   Borg's feat comparisons stay numerically identical to upstream's
 *   `ag->feat >= FEAT_SECRET` style tests, which depend on the exact ordering.
 * - BI_* are the trait indices from borg-trait.h (the enum whose comment reads
 *   "This must exactly match the prefix_pref enums"). Only the subset the flow
 *   code reads is listed; the ordinals were computed from that enum so they line
 *   up with the full trait[] array the self-model (P8.3) will fill. Until then
 *   trait[] is empty and `trait()` reads default to 0 (the borg_init zero
 *   state), which is the faithful "unknown/none" value.
 * - ddx/ddy/ddx_ddd/ddy_ddd match cave.c exactly (keypad-direction offsets and
 *   the 8-neighbour scan order); the flow's "queue children in this order"
 *   behaviour depends on ddx_ddd/ddy_ddd verbatim.
 */

import { FEAT } from "@neo-angband/core";
import { AUTO_MAX_X, AUTO_MAX_Y } from "../world/grid";
import type { BorgGrid } from "../world/grid";
import type { BorgWorld } from "../world/model";
import {
  BI,
  CLASS_WARRIOR,
  CLASS_MAGE,
  CLASS_PRIEST,
  CLASS_NECROMANCER,
} from "../trait/trait-index";
import { BORG_DIG } from "../trait/tables";

export { FEAT };
/**
 * BI_* trait indices, the class ordinals, and BORG_DIG - re-exported from the
 * canonical definitions the self-model (P8.3) owns (trait/trait-index.ts and
 * trait/tables.ts, transcribed from borg-trait.h / borg-flow.h). The flow
 * subsystem reads a subset; sharing the one definition keeps the ordinals and
 * thresholds in a single place. Until borg_notice runs, trait[] is empty and
 * trait() below reads default to 0 (the borg_init zero state = "unknown/none").
 */
export { BI, CLASS_WARRIOR, CLASS_MAGE, CLASS_PRIEST, CLASS_NECROMANCER };

/** borg-flow.h: number of grids in the flow circular queue. */
export const AUTO_FLOW_MAX = 1536;

/** borg-flow.h: number of grids in the temp scanning array. */
export const AUTO_TEMP_MAX = 9000;

/** borg-flow.h dig thresholds (mirror calc_digging_chances()). BORG_DIG itself
 * is imported from trait/tables.ts (single definition). */
export const BORG_DIG_MOD = 20;
export const BORG_DIG_HARD = 40;
export { BORG_DIG };

/* Player class ordinals (CLASS_WARRIOR/MAGE/PRIEST/NECROMANCER) are imported
 * and re-exported above from trait/trait-index.ts (single definition). */

/** Read a derived trait, defaulting to 0 when the self-model has not set it. */
export function trait(world: BorgWorld, bi: number): number {
  return world.self.trait[bi] ?? 0;
}

/* Direction offset tables (cave.c). Index by keypad direction 1-9. */
export const ddx: readonly number[] = [0, -1, 0, 1, -1, 0, 1, -1, 0, 1];
export const ddy: readonly number[] = [0, 1, 1, 1, 0, 0, 0, -1, -1, -1];

/* 8-neighbour scan order (cardinals first, then diagonals), plus the centre. */
export const ddx_ddd: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1, 0];
export const ddy_ddd: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1, 0];

/** Keypad-direction constant used when a search grid is the borg's own grid. */
export const DIR_NONE = 5;

/**
 * borg_cave_floor_grid (borg-cave-util.c): is this a grid the borg can stand on
 * or see through. Faithful feat set.
 */
export function borgCaveFloorGrid(ag: BorgGrid): boolean {
  return (
    ag.feat === FEAT.NONE ||
    ag.feat === FEAT.FLOOR ||
    ag.feat === FEAT.OPEN ||
    ag.feat === FEAT.MORE ||
    ag.feat === FEAT.LESS ||
    ag.feat === FEAT.BROKEN ||
    ag.feat === FEAT.PASS_RUBBLE ||
    ag.feat === FEAT.LAVA
  );
}

/**
 * borg_cave_floor_bold (borg-cave-util.c): is (x, y) steppable/see-through.
 * Bounds are checked with square_in_bounds_fully (the [1, MAX-2] interior).
 */
export function borgCaveFloorBold(world: BorgWorld, y: number, x: number): boolean {
  if (!inBoundsFully(x, y)) return false;
  const ag = world.map.at(x, y);
  return (
    ag.feat === FEAT.FLOOR ||
    ag.trap ||
    ag.feat === FEAT.LESS ||
    ag.feat === FEAT.MORE ||
    ag.feat === FEAT.BROKEN ||
    ag.feat === FEAT.OPEN
  );
}

/** feat_is_shop (cave-square.c): the TF_SHOP feats are STORE_GENERAL..HOME. */
export function featIsShop(feat: number): boolean {
  return feat >= FEAT.STORE_GENERAL && feat <= FEAT.HOME;
}

/**
 * feat_is_trap_holding (cave-square.c): only FEAT_FLOOR carries the TF_TRAP
 * flag in 4.2.6, so this is true for FLOOR alone (matching upstream, where the
 * dark-interesting trap branch is consequently unreachable for wall feats).
 */
export function featIsTrapHolding(feat: number): boolean {
  return feat === FEAT.FLOOR;
}

/**
 * square_in_bounds_fully: strictly inside the outer wall ring, i.e. the
 * [1, MAX-2] interior. The flow code relies on this exact interior test.
 */
export function inBoundsFully(x: number, y: number): boolean {
  return x >= 1 && x < AUTO_MAX_X - 1 && y >= 1 && y < AUTO_MAX_Y - 1;
}

/**
 * borg_extract_dir (borg-flow-misc.c): the keypad direction stepping one grid
 * from (x1, y1) toward (x2, y2). Returns 5 when no movement is needed. (Placed
 * here as a leaf helper so both flow.ts and flow-misc.ts can use it without a
 * module cycle.)
 */
export function borgExtractDir(y1: number, x1: number, y2: number, x2: number): number {
  if (y1 === y2 && x1 === x2) return 5;
  if (x1 === x2) return y1 < y2 ? 2 : 8;
  if (y1 === y2) return x1 < x2 ? 6 : 4;
  if (y1 < y2) return x1 < x2 ? 3 : 1;
  if (y1 > y2) return x1 < x2 ? 9 : 7;
  return 5;
}

/**
 * borg_goto_dir (borg-flow-misc.c): prefer non-diagonal motion, saving
 * diagonals for stepping around pillars. Falls back to borg_extract_dir. Ported
 * verbatim including the obstacle-circling cases.
 */
export function borgGotoDir(
  world: BorgWorld,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): number {
  const ay = y2 > y1 ? y2 - y1 : y1 - y2;
  const ax = x2 > x1 ? x2 - x1 : x1 - x2;

  /* Default direction */
  const e = borgExtractDir(y1, x1, y2, x2);

  /* Adjacent location, use default */
  if (ax <= 1 && ay <= 1) return e;

  let d: number;

  /* Try south/north (primary) */
  if (ay > ax) {
    d = y1 < y2 ? 2 : 8;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
  }

  /* Try east/west (primary) */
  if (ay < ax) {
    d = x1 < x2 ? 6 : 4;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
  }

  /* Try diagonal */
  d = borgExtractDir(y1, x1, y2, x2);
  if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;

  /* Try south/north (secondary) */
  if (ay <= ax) {
    d = y1 < y2 ? 2 : 8;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
  }

  /* Try east/west (secondary) */
  if (ay >= ax) {
    d = x1 < x2 ? 6 : 4;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
  }

  /* Circle obstacles */
  if (!ay) {
    d = x1 < x2 ? 3 : 1;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
    d = x1 < x2 ? 9 : 7;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
  }

  /* Circle obstacles */
  if (!ax) {
    d = y1 < y2 ? 3 : 9;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
    d = y1 < y2 ? 1 : 7;
    if (borgCaveFloorBold(world, y1 + ddy[d]!, x1 + ddx[d]!)) return d;
  }

  return e;
}

export { AUTO_MAX_X, AUTO_MAX_Y };
