import { describe, expect, it } from "vitest";
import {
  GRAPHICS_MODES,
  GRAPHICS_MODE_CATALOG,
  GRAPHICS_MODE_HIGH_ID,
  GRAPHICS_MODE_NONE,
  GRAPHICS_NONE,
  getGraphicsMode,
  isDoubleHeightTile,
} from "./grafmode";
import { GRAPHICS_MODE_CATALOG as DATA } from "./grafmode-data";

describe("graphics-mode catalog", () => {
  it("parses the six shipped modes from list.txt, in order", () => {
    expect(GRAPHICS_MODE_CATALOG.length).toBe(6);
    expect(GRAPHICS_MODE_CATALOG.map((m) => m.grafID)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(GRAPHICS_MODE_CATALOG).toBe(DATA);
  });

  it("carries the metadata for a mode faithfully (Adam Bolt)", () => {
    const m = getGraphicsMode(2)!;
    expect(m.menuname).toBe("Adam Bolt's tiles");
    expect(m.directory).toBe("adam-bolt");
    expect(m.cellWidth).toBe(16);
    expect(m.cellHeight).toBe(16);
    expect(m.file).toBe("16x16.png");
    expect(m.pref).toBe("graf-new.prf");
    expect(m.alphablend).toBe(0);
    expect(m.overdrawRow).toBe(0);
    expect(m.overdrawMax).toBe(0);
  });

  it("carries the double-height rows for Shockbolt", () => {
    const m = getGraphicsMode(5)!;
    expect(m.alphablend).toBe(1);
    expect(m.overdrawRow).toBe(27);
    expect(m.overdrawMax).toBe(31);
  });

  it("appends the hardcoded GRAPHICS_NONE fallback at the end", () => {
    expect(GRAPHICS_MODES[GRAPHICS_MODES.length - 1]).toBe(GRAPHICS_MODE_NONE);
    expect(GRAPHICS_MODE_NONE.grafID).toBe(GRAPHICS_NONE);
    expect(GRAPHICS_MODE_NONE.menuname).toBe("None");
    expect(GRAPHICS_MODE_NONE.pref).toBe("none");
    expect(GRAPHICS_MODE_NONE.file).toBe("");
    expect(GRAPHICS_MODE_NONE.directory).toBe("");
  });

  it("high id is the max catalog grafID (None excluded)", () => {
    expect(GRAPHICS_MODE_HIGH_ID).toBe(6);
  });
});

describe("getGraphicsMode", () => {
  it("finds a mode by id", () => {
    expect(getGraphicsMode(3)?.menuname).toBe("David Gervais' tiles");
  });

  it("resolves GRAPHICS_NONE to the None fallback", () => {
    expect(getGraphicsMode(GRAPHICS_NONE)).toBe(GRAPHICS_MODE_NONE);
  });

  it("returns undefined for an unknown id", () => {
    expect(getGraphicsMode(99)).toBeUndefined();
  });
});

describe("isDoubleHeightTile", () => {
  const shockbolt = getGraphicsMode(5)!; // overdrawRow 27, overdrawMax 31
  const original = getGraphicsMode(1)!; // overdrawRow 0 -> no double-height

  it("is false for a non-tile attr (high bit clear)", () => {
    expect(isDoubleHeightTile(shockbolt, 0x1b)).toBe(false); // 27 without 0x80
  });

  it("is false when no mode is selected", () => {
    expect(isDoubleHeightTile(undefined, 0x80 | 27)).toBe(false);
  });

  it("is false for a mode without double-height tiles", () => {
    expect(isDoubleHeightTile(original, 0x80 | 27)).toBe(false);
  });

  it("is true for a tile row inside the double-height band", () => {
    expect(isDoubleHeightTile(shockbolt, 0x80 | 27)).toBe(true);
    expect(isDoubleHeightTile(shockbolt, 0x80 | 31)).toBe(true);
    expect(isDoubleHeightTile(shockbolt, 0x80 | 29)).toBe(true);
  });

  it("is false for a tile row outside the band", () => {
    expect(isDoubleHeightTile(shockbolt, 0x80 | 26)).toBe(false);
    // row 32 is not representable in the low 7 bits alongside a real tile,
    // but a row below the band is the meaningful boundary case.
    expect(isDoubleHeightTile(shockbolt, 0x80 | 10)).toBe(false);
  });
});
