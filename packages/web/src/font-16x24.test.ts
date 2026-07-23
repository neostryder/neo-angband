import { describe, expect, it } from "vitest";
import { FONT_16X24 } from "./font-16x24";

// FONT-1 regression guard: the terminal blits these glyphs as the faithful
// default (term.ts), so the generated data must stay byte-exact with the classic
// 16X24x.FON (Aaron's ratified default, matching his installed Angband's main
// window). If the extractor or the committed data drifts, the pinned bitmaps
// below fail. Regenerate with packages/web/scripts/extract-fon.py.
describe("FONT_16X24 (original Angband 16x24 bitmap)", () => {
  it("has the native 16x24 metrics and a full CP437 table", () => {
    expect(FONT_16X24.w).toBe(16);
    expect(FONT_16X24.h).toBe(24);
    expect(FONT_16X24.glyphs.length).toBe(256);
  });

  it("every glyph is h rows of 16-bit masks", () => {
    for (const rows of FONT_16X24.glyphs) {
      expect(rows.length).toBe(FONT_16X24.h);
      for (const mask of rows) {
        expect(mask).toBeGreaterThanOrEqual(0);
        expect(mask).toBeLessThanOrEqual(0xffff);
      }
    }
  });

  it("blank glyphs are all-zero (space, and a control code)", () => {
    expect(FONT_16X24.glyphs[32]!.every((m) => m === 0)).toBe(true);
    expect(FONT_16X24.glyphs[0]!.every((m) => m === 0)).toBe(true);
  });

  it("pins the exact bitmaps for '@', 'A', '#', '.'", () => {
    // bit 15 (0x8000) is the leftmost pixel of the 16-wide cell.
    expect([...FONT_16X24.glyphs[64]!]).toEqual([
      0, 0, 0, 0, 992, 3096, 4100, 9178, 18426, 20082, 35890, 38962, 38946,
      39014, 40172, 20472, 18288, 8194, 6156, 2032, 0, 0, 0, 0,
    ]); // @
    expect([...FONT_16X24.glyphs[65]!]).toEqual([
      0, 0, 0, 0, 896, 896, 1728, 1728, 1728, 3168, 3168, 3168, 8176, 8176,
      12312, 12312, 12312, 24588, 24588, 0, 0, 0, 0, 0,
    ]); // A
    expect([...FONT_16X24.glyphs[35]!]).toEqual([
      0, 0, 0, 0, 792, 792, 824, 1584, 16380, 16380, 1584, 3168, 3168, 16380,
      16380, 3168, 7360, 6336, 6336, 0, 0, 0, 0, 0,
    ]); // #
    expect([...FONT_16X24.glyphs[46]!]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 384, 960, 960, 384, 0, 0,
      0, 0,
    ]); // .
  });
});
