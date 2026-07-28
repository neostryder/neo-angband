import { describe, expect, it } from "vitest";

import {
  COLOUR_BLUE,
  COLOUR_L_RED,
  COLOUR_ORANGE,
  COLOUR_RED,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color";
import { monsterGlyph, playerGlyph } from "./map-text";
import type { MonsterGlyphInput } from "./map-text";

/** A plain monster over a plain floor: no display flags, no options. */
function base(over: Partial<MonsterGlyphInput> = {}): MonsterGlyphInput {
  return {
    under: { attr: COLOUR_WHITE, char: "." },
    desired: { attr: COLOUR_BLUE, char: "k" },
    monAttr: 0,
    attrMulti: false,
    attrFlicker: false,
    attrRand: false,
    attrClear: false,
    charClear: false,
    purpleUniques: false,
    shapeUnique: false,
    ...over,
  };
}

describe("monsterGlyph (grid_data_as_text's monster arms, ui-map.c L232-289)", () => {
  it("arm 4: an ordinary monster replaces both attr and char", () => {
    expect(monsterGlyph(base())).toEqual({ attr: COLOUR_BLUE, char: "k" });
  });

  it("arm 1: a high-bit (tile-code) slot wins over every option and flag", () => {
    const g = monsterGlyph(
      base({
        desired: { attr: 0x85, char: " " },
        purpleUniques: true,
        shapeUnique: true,
        attrMulti: true,
        monAttr: COLOUR_RED,
      }),
    );
    expect(g).toEqual({ attr: 0x85, char: " " });
  });

  it("arm 2: purple_uniques beats the multi/flicker animation for a unique", () => {
    const g = monsterGlyph(
      base({ purpleUniques: true, shapeUnique: true, attrMulti: true, monAttr: COLOUR_RED }),
    );
    expect(g).toEqual({ attr: COLOUR_VIOLET, char: "k" });
  });

  it("arm 2 needs the CURRENT form to be unique (monster_is_shape_unique)", () => {
    const g = monsterGlyph(base({ purpleUniques: true, shapeUnique: false }));
    expect(g.attr).toBe(COLOUR_BLUE);
  });

  it("arm 3: ATTR_RAND draws the colour rolled at birth, not the race colour", () => {
    const g = monsterGlyph(base({ attrRand: true, monAttr: COLOUR_ORANGE }));
    expect(g).toEqual({ attr: COLOUR_ORANGE, char: "k" });
  });

  it("arm 3: an unset mon->attr falls back to the x_attr slot", () => {
    const g = monsterGlyph(base({ attrFlicker: true, monAttr: 0 }));
    expect(g).toEqual({ attr: COLOUR_BLUE, char: "k" });
  });

  it("arm 6: ATTR_CLEAR keeps the colour of whatever it stands on", () => {
    const g = monsterGlyph(
      base({ attrClear: true, under: { attr: COLOUR_YELLOW, char: "," } }),
    );
    expect(g).toEqual({ attr: COLOUR_YELLOW, char: "k" });
  });

  it("arm 7: CHAR_CLEAR keeps the terrain glyph and takes the monster's colour", () => {
    const g = monsterGlyph(
      base({ charClear: true, under: { attr: COLOUR_YELLOW, char: "," } }),
    );
    expect(g).toEqual({ attr: COLOUR_BLUE, char: "," });
  });

  it("both clear flags: the monster is wholly invisible", () => {
    const under = { attr: COLOUR_YELLOW, char: "," };
    expect(monsterGlyph(base({ attrClear: true, charClear: true, under }))).toEqual(under);
  });

  it("arm 5: a high-bit grid under a clear-flagged monster forces both over", () => {
    const g = monsterGlyph(
      base({ attrClear: true, under: { attr: 0x82, char: "¡" } }),
    );
    expect(g).toEqual({ attr: COLOUR_BLUE, char: "k" });
  });
});

describe("playerGlyph (grid_data_as_text's is_player arm, ui-map.c L289-331)", () => {
  const slot = { attr: COLOUR_WHITE, char: "@" };

  it("takes BOTH attr and char from the race-0 x_attr slot when hp colour is off", () => {
    const g = playerGlyph({ attr: COLOUR_BLUE, char: "&" }, {
      hpChangesColor: false,
      chp: 1,
      mhp: 100,
    });
    expect(g).toEqual({ attr: COLOUR_BLUE, char: "&" });
  });

  it.each([
    [100, COLOUR_WHITE],
    [90, COLOUR_WHITE],
    [80, COLOUR_YELLOW],
    [70, COLOUR_YELLOW],
    [60, COLOUR_ORANGE],
    [50, COLOUR_ORANGE],
    [40, COLOUR_L_RED],
    [30, COLOUR_L_RED],
    [20, COLOUR_RED],
    [10, COLOUR_RED],
    [0, COLOUR_RED],
  ])("hp_changes_color: %i%% hp draws attr %i", (chp, expected) => {
    const g = playerGlyph(slot, { hpChangesColor: true, chp, mhp: 100 });
    expect(g.attr).toBe(expected);
  });

  it("negative hp lands on upstream's default arm (white), not red", () => {
    /* C's `chp * 10 / mhp` truncates toward zero, so -5/100 gives 0 -> RED;
     * only a decile below -1 reaches `default`. -50 hp of 100 gives -5. */
    expect(playerGlyph(slot, { hpChangesColor: true, chp: -50, mhp: 100 }).attr).toBe(
      COLOUR_WHITE,
    );
  });

  it("a tile-code slot suppresses the hp recolour entirely (L292)", () => {
    const g = playerGlyph({ attr: 0x81, char: " " }, {
      hpChangesColor: true,
      chp: 1,
      mhp: 100,
    });
    expect(g.attr).toBe(0x81);
  });
});
