import { describe, expect, it } from "vitest";
import {
  addGuardi,
  addGuardi16,
  INT16_MAX,
  INT16_MIN,
  INT_MAX,
  INT_MIN,
  subGuardi,
  subGuardi16,
} from "./guard";

describe("add_guardi / sub_guardi (z-util.c)", () => {
  it("adds and subtracts normally within range", () => {
    expect(addGuardi(5, 7)).toBe(12);
    expect(addGuardi(-5, 7)).toBe(2);
    expect(subGuardi(5, 7)).toBe(-2);
    expect(subGuardi(-5, -7)).toBe(2);
  });

  it("saturates at INT_MAX / INT_MIN on overflow", () => {
    expect(addGuardi(INT_MAX, 1)).toBe(INT_MAX);
    expect(addGuardi(INT_MAX, INT_MAX)).toBe(INT_MAX);
    expect(addGuardi(INT_MIN, -1)).toBe(INT_MIN);
    expect(subGuardi(INT_MIN, 1)).toBe(INT_MIN);
    expect(subGuardi(INT_MAX, -1)).toBe(INT_MAX);
  });
});

describe("add_guardi16 / sub_guardi16 (z-util.c)", () => {
  it("adds and subtracts normally within the int16 range", () => {
    expect(addGuardi16(100, 200)).toBe(300);
    expect(subGuardi16(100, 200)).toBe(-100);
  });

  it("saturates at 32767 / -32768 on overflow", () => {
    expect(addGuardi16(INT16_MAX, 1)).toBe(INT16_MAX);
    expect(addGuardi16(INT16_MAX, INT16_MAX)).toBe(INT16_MAX);
    expect(addGuardi16(INT16_MIN, -1)).toBe(INT16_MIN);
    expect(subGuardi16(INT16_MIN, 1)).toBe(INT16_MIN);
    expect(subGuardi16(INT16_MAX, -1)).toBe(INT16_MAX);
  });
});
