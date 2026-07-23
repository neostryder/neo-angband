import { describe, expect, it } from "vitest";
import { FONT_8X12 } from "./font-8x12";

// FONT-1 regression guard: the terminal blits these glyphs as the faithful
// default (term.ts), so the generated data must stay byte-exact with the
// classic 8X12x.FON. If the extractor or the committed data drifts, the pinned
// bitmaps below fail. Regenerate with packages/web/scripts/extract-fon.py.
describe("FONT_8X12 (original Angband 8x12 bitmap)", () => {
  it("has the native 8x12 metrics and a full CP437 table", () => {
    expect(FONT_8X12.w).toBe(8);
    expect(FONT_8X12.h).toBe(12);
    expect(FONT_8X12.glyphs.length).toBe(256);
  });

  it("every glyph is h rows of 8-bit masks", () => {
    for (const rows of FONT_8X12.glyphs) {
      expect(rows.length).toBe(FONT_8X12.h);
      for (const mask of rows) {
        expect(mask).toBeGreaterThanOrEqual(0);
        expect(mask).toBeLessThanOrEqual(0xff);
      }
    }
  });

  it("blank glyphs are all-zero (space, and a control code)", () => {
    expect([...FONT_8X12.glyphs[32]!]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(FONT_8X12.glyphs[0]!.every((m) => m === 0)).toBe(true);
  });

  it("pins the exact bitmaps for '@', 'A', '#', '.'", () => {
    // bit 7 (0x80) is the leftmost pixel; e.g. '#' row 0x7e = " ###### ".
    expect([...FONT_8X12.glyphs[64]!]).toEqual([
      0, 0, 56, 68, 154, 170, 170, 156, 64, 60, 0, 0,
    ]); // @
    expect([...FONT_8X12.glyphs[65]!]).toEqual([
      0, 24, 36, 66, 66, 66, 126, 66, 66, 66, 0, 0,
    ]); // A
    expect([...FONT_8X12.glyphs[35]!]).toEqual([
      0, 0, 36, 36, 126, 36, 36, 126, 36, 36, 0, 0,
    ]); // #
    expect([...FONT_8X12.glyphs[46]!]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 48, 0, 0, 0,
    ]); // .
  });
});
