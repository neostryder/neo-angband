import { describe, expect, it } from "vitest";
import {
  COLOR_TABLE,
  COLOUR_DEEP_L_BLUE,
  COLOUR_L_UMBER,
  COLOUR_SHADE,
  COLOUR_WHITE,
  MAX_COLORS,
  colorCharToAttr,
  colorTextToAttr,
  colorToCss,
} from "./color";

describe("color table", () => {
  it("has all 29 entries in upstream order", () => {
    expect(COLOR_TABLE).toHaveLength(MAX_COLORS);
    expect(COLOR_TABLE[0]?.name).toBe("Dark");
    expect(COLOR_TABLE[COLOUR_WHITE]?.rgb).toEqual([0xff, 0xff, 0xff]);
    expect(COLOR_TABLE[COLOUR_L_UMBER]?.rgb).toEqual([0xc0, 0x80, 0x40]);
    expect(COLOR_TABLE[COLOUR_DEEP_L_BLUE]?.char).toBe("Z");
    expect(COLOR_TABLE[COLOUR_SHADE]?.rgb).toEqual([0x28, 0x28, 0x28]);
  });

  it("attr chars are unique (except the shade placeholder)", () => {
    const chars = COLOR_TABLE.slice(0, COLOUR_SHADE).map((c) => c.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("looks up by char and name like upstream", () => {
    expect(colorCharToAttr("d")).toBe(0);
    expect(colorCharToAttr("W")).toBe(9);
    expect(colorCharToAttr("Z")).toBe(COLOUR_DEEP_L_BLUE);
    expect(colorCharToAttr("q")).toBe(-1);
    expect(colorTextToAttr("light umber")).toBe(COLOUR_L_UMBER);
    expect(colorTextToAttr("MAGENTA-PINK")).toBe(21);
    expect(colorTextToAttr("nope")).toBe(-1);
  });

  it("renders CSS hex strings", () => {
    expect(colorToCss(COLOUR_WHITE)).toBe("#ffffff");
    expect(colorToCss(COLOUR_L_UMBER)).toBe("#c08040");
    expect(colorToCss(999)).toBe("#ffffff");
  });
});
