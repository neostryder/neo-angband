/**
 * Grid locations and keypad-direction tables, ported from
 * reference/src/z-type.h, z-type.c, and the direction tables plus
 * distance() from reference/src/cave.c and cave-view.c (Angband 4.2.6).
 *
 * Locations are plain immutable value objects; y grows downward (screen
 * order) exactly as upstream. Directions use keypad numbering: 5 is
 * "no direction", 2/4/6/8 orthogonal, 1/3/7/9 diagonal.
 */

import type { Rng } from "./rng";

export interface Loc {
  readonly x: number;
  readonly y: number;
}

/** Construct a location. */
export function loc(x: number, y: number): Loc {
  return { x, y };
}

/** loc_eq: value equality. */
export function locEq(a: Loc, b: Loc): boolean {
  return a.x === b.x && a.y === b.y;
}

/** loc_is_zero. */
export function locIsZero(a: Loc): boolean {
  return a.x === 0 && a.y === 0;
}

/** loc_sum. */
export function locSum(a: Loc, b: Loc): Loc {
  return loc(a.x + b.x, a.y + b.y);
}

/** loc_diff: a - b. */
export function locDiff(a: Loc, b: Loc): Loc {
  return loc(a.x - b.x, a.y - b.y);
}

/** loc_offset. */
export function locOffset(a: Loc, dx: number, dy: number): Loc {
  return loc(a.x + dx, a.y + dy);
}

/** rand_loc: a location spread uniformly around `grid`. */
export function randLoc(
  rng: Rng,
  grid: Loc,
  xSpread: number,
  ySpread: number,
): Loc {
  return loc(rng.randSpread(grid.x, xSpread), rng.randSpread(grid.y, ySpread));
}

/**
 * distance: the upstream integer approximation
 * (longer axis + half the shorter axis).
 */
export function distance(a: Loc, b: Loc): number {
  const ay = Math.abs(b.y - a.y);
  const ax = Math.abs(b.x - a.x);
  return ay > ax ? ay + (ax >> 1) : ax + (ay >> 1);
}

/**
 * ddd: the cycle of directions, southward then clockwise, ending with 5.
 */
export const DDD: readonly number[] = [2, 8, 6, 4, 3, 1, 9, 7, 5];

/** ddx: keypad direction -> x offset (index 0 unused). */
export const DDX: readonly number[] = [0, -1, 0, 1, -1, 0, 1, -1, 0, 1];

/** ddy: keypad direction -> y offset (index 0 unused). */
export const DDY: readonly number[] = [0, 1, 1, 1, 0, 0, 0, -1, -1, -1];

/** ddgrid: keypad direction -> Loc offset (index 0 unused). */
export const DDGRID: readonly Loc[] = [
  { x: 0, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

/** ddx_ddd: x offsets in ddd order. */
export const DDX_DDD: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1, 0];

/** ddy_ddd: y offsets in ddd order. */
export const DDY_DDD: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1, 0];

/** ddgrid_ddd: Loc offsets in ddd order. */
export const DDGRID_DDD: readonly Loc[] = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 0, y: 0 },
];

/**
 * clockwise_ddd: can multiply the index by 45 degrees, e.g. index 6 is
 * 270 degrees (9 o'clock).
 */
export const CLOCKWISE_DDD: readonly number[] = [8, 9, 6, 3, 2, 1, 4, 7, 5];

/** clockwise_grid: Loc offsets in clockwise order starting north. */
export const CLOCKWISE_GRID: readonly Loc[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: 0 },
];

/**
 * side_dirs: alternative sideways/backup directions for each keypad
 * direction, in order of decreasing desirability. Rows 0-9 bias right,
 * rows 10-19 bias left.
 */
export const SIDE_DIRS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 4, 2, 7, 3, 8, 6, 9],
  [2, 1, 3, 4, 6, 7, 9, 8],
  [3, 2, 6, 1, 9, 4, 8, 7],
  [4, 7, 1, 8, 2, 9, 3, 6],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [6, 3, 9, 2, 8, 1, 7, 4],
  [7, 8, 4, 9, 1, 6, 2, 3],
  [8, 9, 7, 6, 4, 3, 1, 2],
  [9, 6, 8, 3, 7, 2, 4, 1],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 2, 4, 3, 7, 6, 8, 9],
  [2, 3, 1, 6, 4, 9, 7, 8],
  [3, 6, 2, 9, 1, 8, 4, 7],
  [4, 1, 7, 2, 8, 3, 9, 6],
  [5, 5, 5, 5, 5, 5, 5, 5],
  [6, 9, 3, 8, 2, 7, 1, 4],
  [7, 4, 8, 1, 9, 2, 6, 3],
  [8, 7, 9, 4, 6, 1, 3, 2],
  [9, 8, 6, 7, 3, 4, 2, 1],
];
