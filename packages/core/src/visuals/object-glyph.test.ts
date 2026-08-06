import { describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import type { ObjectKind } from "../obj/types.js";
import { objectKindGlyph, useFlavorGlyph } from "./object-glyph.js";

function kindOf(tval: number, dChar = "?", dAttr = "d"): ObjectKind {
  return { kidx: 1, tval, dChar, dAttr } as unknown as ObjectKind;
}
const OCHRE = { fidx: 7, char: "!", attr: "Light Umber" };

describe("use_flavor_glyph (ui-object.c:87-90)", () => {
  it("a kind with no flavour never uses one", () => {
    expect(useFlavorGlyph(kindOf(TV.SWORD), null, false)).toBe(false);
    expect(useFlavorGlyph(kindOf(TV.SWORD), undefined, true)).toBe(false);
  });

  it("a flavoured non-scroll uses its flavour whether or not the player is aware", () => {
    for (const tval of [TV.POTION, TV.RING, TV.AMULET, TV.WAND, TV.STAFF, TV.ROD]) {
      expect(useFlavorGlyph(kindOf(tval), OCHRE, false)).toBe(true);
      /* This is the half an inlined copy gets wrong: awareness does NOT end a
       * potion's flavour, because the flavour is what the potion looks like. */
      expect(useFlavorGlyph(kindOf(tval), OCHRE, true)).toBe(true);
    }
  });

  it("a scroll drops its flavour once the player is aware, and only then", () => {
    expect(useFlavorGlyph(kindOf(TV.SCROLL), OCHRE, false)).toBe(true);
    expect(useFlavorGlyph(kindOf(TV.SCROLL), OCHRE, true)).toBe(false);
  });
});

describe("object_kind_attr / object_kind_char (ui-object.c:97-112)", () => {
  it("reports the flavour's colour NAME, flagged as such", () => {
    const g = objectKindGlyph(kindOf(TV.POTION, "!", "d"), OCHRE, false);
    expect(g).toEqual({ char: "!", attr: "Light Umber", fromFlavor: true });
  });

  it("reports the kind's colour CHAR when the flavour does not apply", () => {
    const g = objectKindGlyph(kindOf(TV.SCROLL, "?", "w"), OCHRE, true);
    expect(g).toEqual({ char: "?", attr: "w", fromFlavor: false });
  });

  /* The two alphabets are the reason fromFlavor exists: "d" is a colour char
   * and "Light Umber" is a colour name, and feeding one to the other's
   * converter yields a silently wrong colour rather than an error. */
  it("never reports a flavour colour as a kind colour", () => {
    const unaware = objectKindGlyph(kindOf(TV.RING, "=", "d"), OCHRE, false);
    const aware = objectKindGlyph(kindOf(TV.RING, "=", "d"), OCHRE, true);
    expect(unaware.fromFlavor).toBe(true);
    expect(aware.fromFlavor).toBe(true);
    expect(unaware.attr).not.toBe("d");
  });
});
