import { afterEach, describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import {
  resetTvalRegistry,
  tvalRegistry,
} from "../obj/tval-registry.js";
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

/** A tval beyond everything core defines - a mod's own. */
const MOD_TVAL = 200;

describe("the scroll exception reaches a MOD's scroll class", () => {
  afterEach(() => {
    resetTvalRegistry();
  });

  /* WHAT THIS PROVES, and why byte-identical golden vectors do not prove it.
   * Replaying `tval-vectors.json` unchanged is exactly what a no-op edit looks
   * like. This is the other half: the site used to read `kind.tval ===
   * TV.SCROLL`, so widening the scroll class through `registry:tval` moved
   * nothing here - a mod's identified scroll kept drawing as its unreadable
   * TITLE on the map, the equippy row, the character sheet and the agent grid,
   * while `desc.ts` (already on `tvalIsScroll`) named it as a scroll. Now the
   * two agree. */
  it("was blind to a widened class before the conversion, and answers now", () => {
    const modScroll = kindOf(MOD_TVAL, "?", "w");

    /* BEFORE the mod registers: a mod tval is not a scroll, so awareness does
     * not end its flavour - the potion/ring rule. */
    expect(useFlavorGlyph(modScroll, OCHRE, true)).toBe(true);
    expect(objectKindGlyph(modScroll, OCHRE, true).fromFlavor).toBe(true);

    /* A mod widens the class by WRAPPING, the idiom the registry header
     * prescribes. */
    const inner = tvalRegistry().classes.handlerFor("tvalIsScroll")!;
    tvalRegistry().classes.set(
      "tvalIsScroll",
      (tval) => tval === MOD_TVAL || inner(tval),
    );

    /* AFTER: the converted site answers yes where it answered no, so the mod's
     * identified scroll goes back to drawing as a scroll. */
    expect(useFlavorGlyph(modScroll, OCHRE, true)).toBe(false);
    expect(objectKindGlyph(modScroll, OCHRE, true)).toEqual({
      char: "?",
      attr: "w",
      fromFlavor: false,
    });

    /* Unaware is still the flavour, and core's own scroll is untouched - a
     * widening that broke either would be a different bug wearing this one's
     * clothes. */
    expect(useFlavorGlyph(modScroll, OCHRE, false)).toBe(true);
    expect(useFlavorGlyph(kindOf(TV.SCROLL), OCHRE, true)).toBe(false);
    expect(useFlavorGlyph(kindOf(TV.POTION), OCHRE, true)).toBe(true);
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
