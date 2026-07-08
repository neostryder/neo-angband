import { describe, expect, it } from "vitest";
import {
  CLOCKWISE_DDD,
  CLOCKWISE_GRID,
  DDD,
  DDGRID,
  DDGRID_DDD,
  DDX,
  DDX_DDD,
  DDY,
  DDY_DDD,
  SIDE_DIRS,
  distance,
  loc,
  locDiff,
  locEq,
  locIsZero,
  locOffset,
  locSum,
  randLoc,
} from "./loc";
import { Rng } from "./rng";

describe("loc primitives", () => {
  it("constructs and compares", () => {
    expect(locEq(loc(3, 4), loc(3, 4))).toBe(true);
    expect(locEq(loc(3, 4), loc(4, 3))).toBe(false);
    expect(locIsZero(loc(0, 0))).toBe(true);
    expect(locIsZero(loc(1, 0))).toBe(false);
  });

  it("does arithmetic like upstream", () => {
    expect(locSum(loc(1, 2), loc(3, 4))).toEqual(loc(4, 6));
    expect(locDiff(loc(5, 5), loc(2, 3))).toEqual(loc(3, 2));
    expect(locOffset(loc(1, 1), -1, 2)).toEqual(loc(0, 3));
  });

  it("randLoc stays within the spread box", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 300; i++) {
      const g = randLoc(rng, loc(50, 50), 3, 2);
      expect(Math.abs(g.x - 50)).toBeLessThanOrEqual(3);
      expect(Math.abs(g.y - 50)).toBeLessThanOrEqual(2);
    }
  });

  it("distance matches the upstream approximation", () => {
    expect(distance(loc(0, 0), loc(0, 0))).toBe(0);
    expect(distance(loc(0, 0), loc(3, 0))).toBe(3);
    expect(distance(loc(0, 0), loc(0, 3))).toBe(3);
    // ay > ax: ay + (ax >> 1)
    expect(distance(loc(0, 0), loc(2, 5))).toBe(6);
    // ax >= ay: ax + (ay >> 1)
    expect(distance(loc(0, 0), loc(5, 2))).toBe(6);
    expect(distance(loc(10, 10), loc(7, 14))).toBe(5);
  });
});

describe("direction tables", () => {
  it("mirror the cave.c constants", () => {
    expect(DDD).toEqual([2, 8, 6, 4, 3, 1, 9, 7, 5]);
    expect(DDX).toEqual([0, -1, 0, 1, -1, 0, 1, -1, 0, 1]);
    expect(DDY).toEqual([0, 1, 1, 1, 0, 0, 0, -1, -1, -1]);
    expect(CLOCKWISE_DDD).toEqual([8, 9, 6, 3, 2, 1, 4, 7, 5]);
    expect(SIDE_DIRS).toHaveLength(20);
    for (const row of SIDE_DIRS) expect(row).toHaveLength(8);
  });

  it("ddgrid agrees with ddx/ddy for every keypad direction", () => {
    for (let d = 0; d <= 9; d++) {
      expect(DDGRID[d]).toEqual({ x: DDX[d], y: DDY[d] });
    }
  });

  it("ddgrid_ddd agrees with ddx_ddd/ddy_ddd and with ddd ordering", () => {
    for (let i = 0; i < 9; i++) {
      expect(DDGRID_DDD[i]).toEqual({ x: DDX_DDD[i], y: DDY_DDD[i] });
      const d = DDD[i] as number;
      expect(DDGRID_DDD[i]).toEqual(DDGRID[d]);
    }
  });

  it("clockwise_grid is ddgrid reordered clockwise from north", () => {
    for (let i = 0; i < 9; i++) {
      const d = CLOCKWISE_DDD[i] as number;
      expect(CLOCKWISE_GRID[i]).toEqual(DDGRID[d]);
    }
  });
});
