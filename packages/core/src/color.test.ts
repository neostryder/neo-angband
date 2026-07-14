import { describe, expect, it } from "vitest";
import {
  ATTR_BLIND,
  ATTR_DARK,
  ATTR_FULL,
  ATTR_HIGH,
  ATTR_LIGHT,
  ATTR_METAL,
  ATTR_MONO,
  ATTR_VGA,
  COLOR_TABLE,
  COLOUR_DARK,
  COLOUR_DEEP_L_BLUE,
  COLOUR_L_DARK,
  COLOUR_L_UMBER,
  COLOUR_L_WHITE,
  COLOUR_ORANGE,
  COLOUR_RED,
  COLOUR_SHADE,
  COLOUR_SLATE,
  COLOUR_UMBER,
  COLOUR_WHITE,
  COLOUR_YELLOW,
  MAX_COLORS,
  colorCharToAttr,
  colorTextToAttr,
  colorToCss,
  getColor,
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

  it("carries the color_translate matrix (z-color.c L66-155)", () => {
    // full mono vga blind lighter darker highlight metallic misc
    expect(COLOR_TABLE[COLOUR_ORANGE]?.translate).toEqual([
      3, 1, 3, 9, 11, 2, 11, 11, 3,
    ]);
    expect(COLOR_TABLE[COLOUR_UMBER]?.translate).toEqual([
      7, 1, 7, 8, 15, 8, 15, 15, 7,
    ]);
    // Shade (28) has no explicit row upstream -- zero-initialized in C.
    expect(COLOR_TABLE[COLOUR_SHADE]?.translate).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});

describe("getColor (get_color)", () => {
  it("applies the translate column n times", () => {
    // Red -[dark]-> Slate -[dark]-> Light Dark -[dark]-> Light Dark (fixed point).
    expect(getColor(COLOUR_RED, ATTR_DARK, 0)).toBe(COLOUR_RED);
    expect(getColor(COLOUR_RED, ATTR_DARK, 1)).toBe(COLOUR_SLATE);
    expect(getColor(COLOUR_RED, ATTR_DARK, 2)).toBe(COLOUR_L_DARK);
    expect(getColor(COLOUR_RED, ATTR_DARK, 3)).toBe(COLOUR_L_DARK);
  });

  it("applies the lighter column n times", () => {
    // Umber -[light]-> Light Umber -[light]-> Yellow (L_UMBER's "lighter" col).
    expect(getColor(COLOUR_UMBER, ATTR_LIGHT, 1)).toBe(COLOUR_L_UMBER);
    expect(getColor(COLOUR_UMBER, ATTR_LIGHT, 2)).toBe(COLOUR_YELLOW);
  });

  it("reduces to the 16-color (vga) and mono columns", () => {
    expect(getColor(COLOUR_WHITE, ATTR_MONO, 1)).toBe(1);
    expect(getColor(COLOUR_DARK, ATTR_MONO, 1)).toBe(COLOUR_DARK);
    expect(getColor(COLOUR_UMBER, ATTR_VGA, 1)).toBe(7);
  });

  it("honours blind, highlight, and metallic columns", () => {
    expect(getColor(COLOUR_ORANGE, ATTR_BLIND, 1)).toBe(COLOUR_L_WHITE);
    expect(getColor(COLOUR_WHITE, ATTR_HIGH, 1)).toBe(14);
    expect(getColor(COLOUR_WHITE, ATTR_METAL, 1)).toBe(COLOUR_YELLOW);
  });

  it("treats ATTR_FULL as a no-op regardless of n", () => {
    expect(getColor(COLOUR_ORANGE, ATTR_FULL, 0)).toBe(COLOUR_ORANGE);
    expect(getColor(COLOUR_ORANGE, ATTR_FULL, 5)).toBe(COLOUR_ORANGE);
  });

  it("passes graphical attrs (high bit set) through unchanged", () => {
    const graphical = 0x80 | COLOUR_RED;
    expect(getColor(graphical, ATTR_MONO, 3)).toBe(graphical);
    expect(getColor(graphical, ATTR_DARK, 1)).toBe(graphical);
  });
});
