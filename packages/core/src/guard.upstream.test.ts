/**
 * Upstream unit tests from reference/src/tests/z-util/guard.c
 * (suite z-util/guard).
 *
 * Mapping: add_guardi → addGuardi; sub_guardi → subGuardi;
 * add_guardi16 → addGuardi16; sub_guardi16 → subGuardi16.
 * INT_MAX/INT_MIN/INT16 bounds come from guard.ts (32-bit / 16-bit rails).
 */

import { describe, expect, it } from "vitest";
import {
  addGuardi,
  addGuardi16,
  INT_MAX,
  INT_MIN,
  myStristr,
  subGuardi,
  subGuardi16,
} from "./guard";

describe("z-util/guard upstream", () => {
  // C: test_add_guardi
  it("add_guardi", () => {
    expect(addGuardi(0, 0)).toBe(0);
    expect(addGuardi(0, 1)).toBe(1);
    expect(addGuardi(1, 0)).toBe(1);
    expect(addGuardi(0, -1)).toBe(-1);
    expect(addGuardi(-1, 0)).toBe(-1);
    expect(addGuardi(3, 5)).toBe(8);
    expect(addGuardi(5, 3)).toBe(8);
    expect(addGuardi(-4, -7)).toBe(-11);
    expect(addGuardi(-7, -4)).toBe(-11);
    expect(addGuardi(6, -2)).toBe(4);
    expect(addGuardi(-2, 6)).toBe(4);
    expect(addGuardi(-8, 7)).toBe(-1);
    expect(addGuardi(7, -8)).toBe(-1);
    expect(addGuardi(INT_MAX, 0)).toBe(INT_MAX);
    expect(addGuardi(0, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX, -5)).toBe(INT_MAX - 5);
    expect(addGuardi(-5, INT_MAX)).toBe(INT_MAX - 5);
    expect(addGuardi(INT_MIN, 0)).toBe(INT_MIN);
    expect(addGuardi(0, INT_MIN)).toBe(INT_MIN);
    expect(addGuardi(INT_MIN, 7)).toBe(INT_MIN + 7);
    expect(addGuardi(7, INT_MIN)).toBe(INT_MIN + 7);
    /* Cases that would overflow. */
    expect(addGuardi(INT_MAX, 1)).toBe(INT_MAX);
    expect(addGuardi(1, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX - 3, 5)).toBe(INT_MAX);
    expect(addGuardi(5, INT_MAX - 3)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MIN, -1)).toBe(INT_MIN);
    expect(addGuardi(-1, INT_MIN)).toBe(INT_MIN);
    expect(addGuardi(INT_MIN + 6, -8)).toBe(INT_MIN);
    expect(addGuardi(-8, INT_MIN + 6)).toBe(INT_MIN);
    expect(addGuardi(INT_MIN, INT_MIN)).toBe(INT_MIN);
  });

  // C: test_sub_guardi
  it("sub_guardi", () => {
    expect(subGuardi(0, 0)).toBe(0);
    expect(subGuardi(0, 1)).toBe(-1);
    expect(subGuardi(1, 0)).toBe(1);
    expect(subGuardi(0, -1)).toBe(1);
    expect(subGuardi(-1, 0)).toBe(-1);
    expect(subGuardi(3, 5)).toBe(-2);
    expect(subGuardi(5, 3)).toBe(2);
    expect(subGuardi(-4, -7)).toBe(3);
    expect(subGuardi(-7, -4)).toBe(-3);
    expect(subGuardi(6, -2)).toBe(8);
    expect(subGuardi(-2, 6)).toBe(-8);
    expect(subGuardi(-8, 7)).toBe(-15);
    expect(subGuardi(7, -8)).toBe(15);
    expect(subGuardi(9, 9)).toBe(0);
    expect(subGuardi(-10, -10)).toBe(0);
    expect(subGuardi(INT_MAX, 0)).toBe(INT_MAX);
    expect(subGuardi(0, INT_MAX - 1)).toBe(-(INT_MAX - 1));
    expect(subGuardi(INT_MAX, 5)).toBe(INT_MAX - 5);
    expect(subGuardi(5, INT_MAX)).toBe(-(INT_MAX - 5));
    expect(subGuardi(INT_MIN, 0)).toBe(INT_MIN);
    expect(subGuardi(0, INT_MIN + 2)).toBe(-(INT_MIN + 2));
    expect(subGuardi(INT_MIN, -7)).toBe(INT_MIN + 7);
    expect(subGuardi(-7, INT_MIN)).toBe(-(INT_MIN + 7));
    expect(subGuardi(INT_MAX, INT_MAX)).toBe(0);
    expect(subGuardi(INT_MIN, INT_MIN)).toBe(0);
    /* Cases that would overflow. */
    expect(subGuardi(INT_MAX, -1)).toBe(INT_MAX);
    expect(subGuardi(INT_MAX - 3, -5)).toBe(INT_MAX);
    expect(subGuardi(INT_MAX, INT_MIN)).toBe(INT_MAX);
    expect(subGuardi(INT_MIN, 3)).toBe(INT_MIN);
    expect(subGuardi(INT_MIN + 6, 8)).toBe(INT_MIN);
    expect(subGuardi(INT_MIN, INT_MAX)).toBe(INT_MIN);
  });

  // C: test_add_guardi16
  it("add_guardi16", () => {
    expect(addGuardi16(0, 0)).toBe(0);
    expect(addGuardi16(0, 1)).toBe(1);
    expect(addGuardi16(1, 0)).toBe(1);
    expect(addGuardi16(0, -1)).toBe(-1);
    expect(addGuardi16(-1, 0)).toBe(-1);
    expect(addGuardi16(3, 5)).toBe(8);
    expect(addGuardi16(5, 3)).toBe(8);
    expect(addGuardi16(-4, -7)).toBe(-11);
    expect(addGuardi16(-7, -4)).toBe(-11);
    expect(addGuardi16(6, -2)).toBe(4);
    expect(addGuardi16(-2, 6)).toBe(4);
    expect(addGuardi16(-8, 7)).toBe(-1);
    expect(addGuardi16(7, -8)).toBe(-1);
    expect(addGuardi16(32767, 0)).toBe(32767);
    expect(addGuardi16(0, 32767)).toBe(32767);
    expect(addGuardi16(32767, -5)).toBe(32762);
    expect(addGuardi16(-5, 32767)).toBe(32762);
    expect(addGuardi16(-32768, 0)).toBe(-32768);
    expect(addGuardi16(0, -32768)).toBe(-32768);
    expect(addGuardi16(-32768, 7)).toBe(-32761);
    expect(addGuardi16(7, -32768)).toBe(-32761);
    /* Cases that would overflow. */
    expect(addGuardi16(32767, 1)).toBe(32767);
    expect(addGuardi16(1, 32767)).toBe(32767);
    expect(addGuardi16(32764, 5)).toBe(32767);
    expect(addGuardi16(5, 32764)).toBe(32767);
    expect(addGuardi16(32767, 32767)).toBe(32767);
    expect(addGuardi16(-32768, -1)).toBe(-32768);
    expect(addGuardi16(-1, -32768)).toBe(-32768);
    expect(addGuardi16(-32762, -8)).toBe(-32768);
    expect(addGuardi16(-8, -32762)).toBe(-32768);
    expect(addGuardi16(-32768, -32768)).toBe(-32768);
  });

  // C: test_sub_guardi16
  it("sub_guardi16", () => {
    expect(subGuardi16(0, 0)).toBe(0);
    expect(subGuardi16(0, 1)).toBe(-1);
    expect(subGuardi16(1, 0)).toBe(1);
    expect(subGuardi16(0, -1)).toBe(1);
    expect(subGuardi16(-1, 0)).toBe(-1);
    expect(subGuardi16(3, 5)).toBe(-2);
    expect(subGuardi16(5, 3)).toBe(2);
    expect(subGuardi16(-4, -7)).toBe(3);
    expect(subGuardi16(-7, -4)).toBe(-3);
    expect(subGuardi16(6, -2)).toBe(8);
    expect(subGuardi16(-2, 6)).toBe(-8);
    expect(subGuardi16(-8, 7)).toBe(-15);
    expect(subGuardi16(7, -8)).toBe(15);
    expect(subGuardi16(9, 9)).toBe(0);
    expect(subGuardi16(-10, -10)).toBe(0);
    expect(subGuardi16(32767, 0)).toBe(32767);
    expect(subGuardi16(0, 32766)).toBe(-32766);
    expect(subGuardi16(32767, 5)).toBe(32762);
    expect(subGuardi16(5, 32767)).toBe(-32762);
    expect(subGuardi16(-32768, 0)).toBe(-32768);
    expect(subGuardi16(0, -32766)).toBe(32766);
    expect(subGuardi16(-32768, -7)).toBe(-32761);
    expect(subGuardi16(-7, -32768)).toBe(32761);
    expect(subGuardi16(32767, 32767)).toBe(0);
    expect(subGuardi16(-32768, -32768)).toBe(0);
    /* Cases that would overflow. */
    expect(subGuardi16(32767, -1)).toBe(32767);
    expect(subGuardi16(32764, -5)).toBe(32767);
    expect(subGuardi16(32767, -32768)).toBe(32767);
    expect(subGuardi16(-32768, 3)).toBe(-32768);
    expect(subGuardi16(-32762, 8)).toBe(-32768);
    expect(subGuardi16(-32768, 32767)).toBe(-32768);
  });
});

/*
 * my_stristr (z-util.c:441). Given a real counterpart 2026-07-26 after W1-CITED
 * found lookupTrap (world/trap.ts) using a case-SENSITIVE `includes` where
 * trap.c:57 uses my_stristr, while mon/bind.ts had inlined the correct test.
 * Two implementations of one C function, one of them wrong.
 */
describe("myStristr (z-util.c:441)", () => {
  it("matches regardless of case on either side", () => {
    expect(myStristr("a Rune of Protection", "rune")).toBe(true);
    expect(myStristr("a rune of protection", "RUNE")).toBe(true);
    expect(myStristr("A RUNE OF PROTECTION", "Rune")).toBe(true);
  });

  it("is a substring test, anchored nowhere", () => {
    expect(myStristr("pit", "pit")).toBe(true);
    expect(myStristr("a spiked pit", "pit")).toBe(true);
    expect(myStristr("pitfall", "pit")).toBe(true);
    expect(myStristr("pit", "spiked pit")).toBe(false);
  });

  it("treats the empty pattern as present, as strstr does", () => {
    expect(myStristr("anything", "")).toBe(true);
  });
});
