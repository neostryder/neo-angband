/**
 * How an object KIND draws, ported from reference/src/ui-object.c
 * (Angband 4.2.6) L82-131: use_flavor_glyph, object_kind_attr /
 * object_kind_char, and the object_attr / object_char wrappers over them.
 *
 * This is one rule with four consumers in the port - the map renderer, the
 * status-line equippy row, the character sheet's resistance-panel equippy row,
 * and the agent API's grid view - and each of them used to answer it for
 * itself, or not at all. The rule is small enough to inline and just different
 * enough (the scroll exception) that an inlined copy reads correct while being
 * wrong, so it lives here once.
 *
 * Deliberately takes the flavour and the awareness bit rather than a
 * GameState: `visuals` is the presentation layer and must not reach into the
 * game, and every caller already holds both. The attr/char helpers answer from
 * GAMEDATA only. Upstream reads flavor_x_attr[fidx] / kind_x_attr[kidx], the
 * pref tables - a caller that has a TileMap should ask it first and fall back
 * to these, which is what the web renderer does.
 */

import { tvalIsScroll } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";

/** The parts of a flavour this decision needs (obj/flavor.ts AssignedFlavor). */
export interface GlyphFlavor {
  fidx: number;
  char: string;
  /** A colour NAME ("Light Blue"), where a kind's dAttr is a colour CHAR. */
  attr: string;
}

/**
 * use_flavor_glyph (ui-object.c:87-90):
 *
 *   return kind->flavor && !(kind->tval == TV_SCROLL && kind->aware);
 *
 * A flavoured kind draws as its flavour until the player knows what it is. The
 * scroll exception runs the other way to the intuition: a scroll's flavour is
 * its unreadable TITLE, not its appearance, so once the player is aware of the
 * kind the scroll goes back to drawing as a scroll ("Identified scrolls should
 * use their own tile"). Every other flavoured kind keeps its flavour glyph
 * whether or not the player is aware, because for a potion or a ring the
 * flavour IS what the thing looks like.
 *
 * The tval test goes through `tvalIsScroll` rather than `=== TV.SCROLL`, so a
 * mod that widens the scroll class through `registry:tval` gets the exception
 * here too. `desc.ts` already asked the same question that way, and the two
 * disagreeing meant a mod scroll read as a scroll but still DREW as its title.
 */
export function useFlavorGlyph<F extends GlyphFlavor>(
  kind: ObjectKind,
  flavor: F | null | undefined,
  aware: boolean,
  /* A type predicate ON THE FLAVOUR, not a bare boolean: a caller that keeps
   * the result in a const gets `flavor` narrowed to non-null wherever the
   * const is true, which is what every caller then reads. Returning bare
   * boolean would push each of them back to a `!` or a second `!!flavor`
   * check - the duplication this module exists to remove. */
): flavor is F {
  return !!flavor && !(tvalIsScroll(kind.tval) && aware);
}

/**
 * object_kind_attr (ui-object.c:97-101), answered from gamedata: the flavour's
 * colour name when use_flavor_glyph, else the kind's own colour char.
 *
 * The two are not the same alphabet - a flavour carries "Light Blue" and a
 * kind carries "d" - so the caller converts with colorTextToAttr or
 * colorCharToAttr respectively, which is why this returns the raw spec and a
 * discriminator rather than a number.
 */
export function objectKindGlyph(
  kind: ObjectKind,
  flavor: GlyphFlavor | null | undefined,
  aware: boolean,
): { char: string; attr: string; fromFlavor: boolean } {
  if (useFlavorGlyph(kind, flavor, aware)) {
    return { char: flavor.char, attr: flavor.attr, fromFlavor: true };
  }
  return { char: kind.dChar, attr: kind.dAttr, fromFlavor: false };
}
