/**
 * Tests for bitflag.ts (port of reference/src/z-bitflag.c/h). Upstream has
 * no unit test suite for z-bitflag, so these tests pin the documented C
 * behavior directly, including the flag_inter return-value quirk and
 * 1-indexed flags.
 */

import { describe, expect, it } from "vitest";
import {
  FLAG_END,
  FLAG_START,
  FLAG_WIDTH,
  FlagSet,
  NO_FLAG,
  flagCompDiff,
  flagCompInter,
  flagCompUnion,
  flagCopy,
  flagCount,
  flagDiff,
  flagHas,
  flagInter,
  flagIsEmpty,
  flagIsEqual,
  flagIsFull,
  flagIsInter,
  flagIsSubset,
  flagMax,
  flagNegate,
  flagNext,
  flagOff,
  flagOn,
  flagSetall,
  flagSize,
  flagUnion,
  flagWipe,
  flagsClear,
  flagsInit,
  flagsMask,
  flagsSet,
  flagsTest,
  flagsTestAll,
} from "./bitflag";

describe("constants and size macros", () => {
  it("mirrors the upstream macro values", () => {
    expect(FLAG_WIDTH).toBe(8);
    expect(FLAG_START).toBe(1);
    expect(FLAG_END).toBe(0);
    expect(NO_FLAG).toBe(-1);
  });

  it("flagSize matches FLAG_SIZE (integer ceiling division)", () => {
    expect(flagSize(1)).toBe(1);
    expect(flagSize(8)).toBe(1);
    expect(flagSize(9)).toBe(2);
    expect(flagSize(16)).toBe(2);
    expect(flagSize(17)).toBe(3);
  });

  it("flagMax matches FLAG_MAX", () => {
    expect(flagMax(1)).toBe(9);
    expect(flagMax(2)).toBe(17);
  });
});

describe("flag has/on/off (1-indexed)", () => {
  it("sets and tests flags across byte boundaries", () => {
    const f = new Uint8Array(2);
    expect(flagOn(f, 1)).toBe(true);
    expect(flagOn(f, 8)).toBe(true);
    expect(flagOn(f, 9)).toBe(true);
    /* Flag 1 is bit 0 of byte 0; flag 9 is bit 0 of byte 1. */
    expect(f[0]).toBe(0b10000001);
    expect(f[1]).toBe(0b00000001);
    expect(flagHas(f, 1)).toBe(true);
    expect(flagHas(f, 2)).toBe(false);
    expect(flagHas(f, 8)).toBe(true);
    expect(flagHas(f, 9)).toBe(true);
    expect(flagHas(f, 16)).toBe(false);
  });

  it("flag_on/off report whether a change was made", () => {
    const f = new Uint8Array(1);
    expect(flagOn(f, 3)).toBe(true);
    expect(flagOn(f, 3)).toBe(false);
    expect(flagOff(f, 3)).toBe(true);
    expect(flagOff(f, 3)).toBe(false);
  });

  it("flag_has of FLAG_END is always false", () => {
    const f = new Uint8Array(1);
    f[0] = 0xff;
    expect(flagHas(f, FLAG_END)).toBe(false);
  });

  it("throws on out-of-range flags (upstream asserts/UB)", () => {
    const f = new Uint8Array(1);
    expect(() => flagOn(f, 9)).toThrow(RangeError);
    expect(() => flagOff(f, 0)).toThrow(RangeError);
    expect(() => flagHas(f, 99)).toThrow(RangeError);
  });
});

describe("flag_next iteration", () => {
  it("walks set flags and ends with NO_FLAG (upstream FLAG_END)", () => {
    const f = new Uint8Array(2);
    flagsInit(f, 2, 9, 16);
    expect(flagNext(f, FLAG_START)).toBe(2);
    expect(flagNext(f, 2)).toBe(2); /* inclusive start */
    expect(flagNext(f, 3)).toBe(9);
    expect(flagNext(f, 10)).toBe(16);
    expect(flagNext(f, 17)).toBe(NO_FLAG);
  });

  it("starts from the beginning when given FLAG_END", () => {
    const f = new Uint8Array(1);
    flagOn(f, 5);
    expect(flagNext(f, FLAG_END)).toBe(5);
  });

  it("returns NO_FLAG on an empty set", () => {
    expect(flagNext(new Uint8Array(2), FLAG_START)).toBe(NO_FLAG);
  });
});

describe("count/empty/full", () => {
  it("flag_count counts set bits", () => {
    const f = new Uint8Array(2);
    expect(flagCount(f)).toBe(0);
    flagsSet(f, 1, 2, 9, 16);
    expect(flagCount(f)).toBe(4);
    flagSetall(f);
    expect(flagCount(f)).toBe(16);
  });

  it("flag_is_empty / flag_is_full check whole bytes", () => {
    const f = new Uint8Array(2);
    expect(flagIsEmpty(f)).toBe(true);
    expect(flagIsFull(f)).toBe(false);
    flagOn(f, 3);
    expect(flagIsEmpty(f)).toBe(false);
    flagSetall(f);
    expect(flagIsFull(f)).toBe(true);
    flagOff(f, 16);
    expect(flagIsFull(f)).toBe(false);
  });
});

describe("set comparisons", () => {
  it("flag_is_inter", () => {
    const a = new Uint8Array(2);
    const b = new Uint8Array(2);
    flagsInit(a, 1, 9);
    flagsInit(b, 2, 10);
    expect(flagIsInter(a, b)).toBe(false);
    flagOn(b, 9);
    expect(flagIsInter(a, b)).toBe(true);
  });

  it("flag_is_subset(f1, f2) is true when f2 is a subset of f1", () => {
    const f1 = new Uint8Array(2);
    const f2 = new Uint8Array(2);
    flagsInit(f1, 1, 2, 9);
    flagsInit(f2, 1, 9);
    expect(flagIsSubset(f1, f2)).toBe(true);
    /* f1 is NOT a subset of f2 in the upstream argument order. */
    expect(flagIsSubset(f2, f1)).toBe(false);
  });

  it("flag_is_equal", () => {
    const a = new Uint8Array(2);
    const b = new Uint8Array(2);
    flagsInit(a, 3, 12);
    flagsInit(b, 3, 12);
    expect(flagIsEqual(a, b)).toBe(true);
    flagOn(b, 1);
    expect(flagIsEqual(a, b)).toBe(false);
  });
});

describe("wipe/setall/negate/copy", () => {
  it("behaves like the C memset/loop versions", () => {
    const f = new Uint8Array(2);
    flagSetall(f);
    expect(Array.from(f)).toEqual([0xff, 0xff]);
    flagWipe(f);
    expect(Array.from(f)).toEqual([0, 0]);
    flagsInit(f, 1, 10);
    flagNegate(f);
    expect(flagHas(f, 1)).toBe(false);
    expect(flagHas(f, 10)).toBe(false);
    expect(flagHas(f, 2)).toBe(true);
    expect(flagCount(f)).toBe(14);

    const dst = new Uint8Array(2);
    flagCopy(dst, f);
    expect(flagIsEqual(dst, f)).toBe(true);
  });
});

describe("union/inter/diff", () => {
  it("flag_union ORs and reports changes", () => {
    const a = new Uint8Array(1);
    const b = new Uint8Array(1);
    flagsInit(a, 1);
    flagsInit(b, 2);
    expect(flagUnion(a, b)).toBe(true);
    expect(flagsTestAll(a, 1, 2)).toBe(true);
    expect(flagUnion(a, b)).toBe(false); /* already a superset */
  });

  it("flag_inter ANDs but returns INEQUALITY, not mutation (quirk)", () => {
    const a = new Uint8Array(1);
    const b = new Uint8Array(1);
    a[0] = 0b001;
    b[0] = 0b011;
    /* a & b leaves a unchanged, yet upstream returns true (a != b). */
    expect(flagInter(a, b)).toBe(true);
    expect(a[0]).toBe(0b001);
    /* Equal inputs return false. */
    const c = new Uint8Array(1);
    c[0] = 0b001;
    expect(flagInter(a, c)).toBe(false);
  });

  it("flag_diff clears flags2 bits and reports intersection", () => {
    const a = new Uint8Array(1);
    const b = new Uint8Array(1);
    flagsInit(a, 1, 2, 3);
    flagsInit(b, 2, 5);
    expect(flagDiff(a, b)).toBe(true);
    expect(flagsTestAll(a, 1, 3)).toBe(true);
    expect(flagHas(a, 2)).toBe(false);
    expect(flagDiff(a, b)).toBe(false); /* nothing left to remove */
  });
});

describe("comp_union/comp_inter/comp_diff (port extensions)", () => {
  it("flagCompUnion ORs the complement", () => {
    const a = new Uint8Array(1);
    const b = new Uint8Array(1);
    flagsInit(a, 1);
    flagsInit(b, 1, 2);
    /* a |= ~b: everything except flags 1,2 joins; 1 already set. */
    expect(flagCompUnion(a, b)).toBe(true);
    expect(flagHas(a, 1)).toBe(true);
    expect(flagHas(a, 2)).toBe(false);
    expect(flagsTestAll(a, 3, 4, 5, 6, 7, 8)).toBe(true);
    expect(flagCompUnion(a, b)).toBe(false);
  });

  it("flagCompInter mutates like diff", () => {
    const a = new Uint8Array(1);
    const b = new Uint8Array(1);
    flagsInit(a, 1, 2);
    flagsInit(b, 2);
    expect(flagCompInter(a, b)).toBe(true);
    expect(flagHas(a, 1)).toBe(true);
    expect(flagHas(a, 2)).toBe(false);
    expect(flagCompInter(a, b)).toBe(false);
  });

  it("flagCompDiff mutates like inter but reports actual change", () => {
    const a = new Uint8Array(1);
    const b = new Uint8Array(1);
    a[0] = 0b001;
    b[0] = 0b011;
    /* a &= b leaves a unchanged: no change reported (unlike flagInter). */
    expect(flagCompDiff(a, b)).toBe(false);
    expect(a[0]).toBe(0b001);
    a[0] = 0b101;
    expect(flagCompDiff(a, b)).toBe(true);
    expect(a[0]).toBe(0b001);
  });
});

describe("variadic helpers (rest parameters instead of FLAG_END)", () => {
  it("flags_test / flags_test_all", () => {
    const f = new Uint8Array(2);
    flagsInit(f, 3, 11);
    expect(flagsTest(f, 1, 2, 3)).toBe(true);
    expect(flagsTest(f, 1, 2)).toBe(false);
    expect(flagsTestAll(f, 3, 11)).toBe(true);
    expect(flagsTestAll(f, 3, 11, 12)).toBe(false);
  });

  it("flags_clear / flags_set report changes", () => {
    const f = new Uint8Array(1);
    expect(flagsSet(f, 1, 2)).toBe(true);
    expect(flagsSet(f, 1, 2)).toBe(false);
    expect(flagsClear(f, 2, 3)).toBe(true);
    expect(flagsClear(f, 2, 3)).toBe(false);
    expect(flagHas(f, 1)).toBe(true);
  });

  it("flags_init wipes then sets", () => {
    const f = new Uint8Array(1);
    flagsInit(f, 1, 2, 3);
    flagsInit(f, 5);
    expect(flagCount(f)).toBe(1);
    expect(flagHas(f, 5)).toBe(true);
  });

  it("flags_mask keeps only the given flags (flag_inter quirk applies)", () => {
    const f = new Uint8Array(1);
    flagsInit(f, 1, 2, 3);
    expect(flagsMask(f, 2, 3, 4)).toBe(true);
    expect(flagHas(f, 1)).toBe(false);
    expect(flagsTestAll(f, 2, 3)).toBe(true);
    expect(flagHas(f, 4)).toBe(false);
    /* Masking again: result equals mask minus flag 4 -> inequality true. */
    expect(flagsMask(f, 2, 3, 4)).toBe(true);
    /* Masking with the exact same set -> equal bytes -> false. */
    expect(flagsMask(f, 2, 3)).toBe(false);
  });
});

describe("FlagSet wrapper", () => {
  it("forFlags sizes like bitflag name[FLAG_SIZE(MAX)]", () => {
    expect(FlagSet.forFlags(39).size).toBe(5); /* OF_MAX-style */
    expect(FlagSet.forFlags(8).size).toBe(1);
    expect(FlagSet.forFlags(9).size).toBe(2);
  });

  it("mirrors the functional API", () => {
    const a = FlagSet.forFlags(16);
    const b = FlagSet.forFlags(16);
    a.init(1, 9);
    b.init(9);
    expect(a.has(1)).toBe(true);
    expect(a.count()).toBe(2);
    expect(a.isSubset(b)).toBe(true); /* b subset of a */
    expect(b.isSubset(a)).toBe(false);
    expect(a.isInter(b)).toBe(true);
    expect(a.diff(b)).toBe(true);
    expect(a.has(9)).toBe(false);
    a.copy(b);
    expect(a.isEqual(b)).toBe(true);
    const c = a.clone();
    expect(c.isEqual(a)).toBe(true);
    c.on(2);
    expect(a.has(2)).toBe(false);
    a.wipe();
    expect(a.isEmpty()).toBe(true);
    a.setall();
    expect(a.isFull()).toBe(true);
    a.negate();
    expect(a.isEmpty()).toBe(true);
  });

  it("iterates set flags in ascending order", () => {
    const f = FlagSet.forFlags(24);
    f.init(2, 9, 17);
    expect(Array.from(f)).toEqual([2, 9, 17]);
    expect(f.next(10)).toBe(17);
    expect(f.next(18)).toBe(NO_FLAG);
  });
});
