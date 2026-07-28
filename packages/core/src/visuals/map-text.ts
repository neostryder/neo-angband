/**
 * The monster and player arms of grid_data_as_text, ported from
 * reference/src/ui-map.c L232-331 (Angband 4.2.6).
 *
 * SCOPE. Upstream resolves a whole map cell in one function: terrain from
 * feat_x_attr, then trap, then object, then monster-or-player, all layered onto
 * one (attr, char) pair. The port's web shell layers those four in its own
 * render loop (main.ts render(), one index map per layer), so what needs to
 * live in core is the part that is not simple "last writer wins": the monster
 * branch, whose seven arms READ the glyph already under the monster, and the
 * player branch, which takes its colour from the x_attr table's race-0 slot.
 * Everything here is pure, so both are directly testable.
 *
 * What upstream does that the port's layered loop still cannot express is
 * recorded in parity/CENSUS_PUNCHLIST.md (block O: map_info has no port, so
 * hallucination glyphs, the multi-object pile kind and the unknown-item/gold
 * kinds are absent) - it is measured there rather than excused here.
 *
 * Determinism: no RNG. ATTR_RAND's per-monster colour is rolled once at birth
 * (mon-make.c place_new_monster_one), and the flicker/multi frame colour is the
 * caller's animator; this module only selects between values it is handed.
 */

import { COLOUR_L_RED, COLOUR_ORANGE, COLOUR_RED, COLOUR_VIOLET, COLOUR_WHITE, COLOUR_YELLOW } from "../color";
import type { GlyphPair } from "./glyph-table";

/**
 * The high bit upstream reserves for "this slot holds a graphics tile code,
 * not a colour attr" (ui-map.c L246 `da & 0x80`, L275 `a & 0x80`). The port
 * keeps tile codes in a separate TileMap (see glyph-table.ts), so in practice
 * this is only set when a pref file wrote a high-bit attr into the ASCII
 * table; the branches are ported anyway so that case behaves as upstream.
 */
const ATTR_TILE_BIT = 0x80;

/** The inputs grid_data_as_text's monster branch reads. */
export interface MonsterGlyphInput {
  /** The (attr, char) already resolved for this grid: terrain, then trap/object. */
  under: GlyphPair;
  /** monster_x_attr[race->ridx] / monster_x_char[race->ridx]. */
  desired: GlyphPair;
  /**
   * mon->attr: the animated colour do_animation last wrote for an
   * ATTR_MULTI/ATTR_FLICKER monster, or the colour ATTR_RAND rolled at birth.
   * 0 means "none set", which upstream falls back from to `da` (L259).
   */
  monAttr: number;
  attrMulti: boolean;
  attrFlicker: boolean;
  attrRand: boolean;
  attrClear: boolean;
  charClear: boolean;
  /** OPT(player, purple_uniques). */
  purpleUniques: boolean;
  /** monster_is_shape_unique(mon) (mon-predicate.c L100). */
  shapeUnique: boolean;
}

/**
 * grid_data_as_text's `g->m_idx > 0` branch (ui-map.c L232-289), in upstream's
 * exact arm order. The returned attr is also what upstream stores back into
 * `mon->attr` (L288), which the monster-list sidebar then reads.
 *
 * The arms, in order:
 *  1. `da & 0x80` - a special (tile) code in the slot wins outright.
 *  2. purple_uniques on a currently-unique monster: violet, monster's char.
 *  3. ATTR_MULTI / ATTR_FLICKER / ATTR_RAND: `mon->attr` if set, else `da`.
 *  4. Neither ATTR_CLEAR nor CHAR_CLEAR: an ordinary monster, both overridden.
 *  5. `a & 0x80` - a bizarre (tile) grid under the monster: both overridden.
 *  6. not CHAR_CLEAR: keep the grid's attr, take the monster's char.
 *  7. not ATTR_CLEAR: take the monster's attr, keep the grid's char.
 *
 * Arms 6 and 7 are why an ATTR_CLEAR monster shows in the colour of whatever
 * it is standing on, and a CHAR_CLEAR monster is invisible except for its
 * colour tinting the terrain glyph.
 */
export function monsterGlyph(input: MonsterGlyphInput): GlyphPair {
  const { under, desired } = input;

  if (desired.attr & ATTR_TILE_BIT) {
    return { attr: desired.attr, char: desired.char };
  }
  if (input.purpleUniques && input.shapeUnique) {
    return { attr: COLOUR_VIOLET, char: desired.char };
  }
  if (input.attrMulti || input.attrFlicker || input.attrRand) {
    return { attr: input.monAttr ? input.monAttr : desired.attr, char: desired.char };
  }
  if (!input.attrClear && !input.charClear) {
    return { attr: desired.attr, char: desired.char };
  }
  if (under.attr & ATTR_TILE_BIT) {
    return { attr: desired.attr, char: desired.char };
  }
  if (!input.charClear) {
    return { attr: under.attr, char: desired.char };
  }
  if (!input.attrClear) {
    return { attr: desired.attr, char: under.char };
  }
  /* Both flags set: upstream falls out of the if-chain leaving the grid's own
   * attr and char untouched - a monster you cannot see at all. */
  return { attr: under.attr, char: under.char };
}

/**
 * grid_data_as_text's `g->is_player` branch (ui-map.c L289-331). The player's
 * glyph is r_info[0] ("<player>" in monster.txt) read through the SAME x_attr
 * table as every monster, so a pref file or the glyph picker can re-map the
 * '@'. hp_changes_color recolours by HP decile, but only when the slot does
 * not hold a tile code (L292 `!(a & 0x80)`).
 */
export function playerGlyph(
  /** monster_x_attr[0] / monster_x_char[0]. */
  desired: GlyphPair,
  opts: { hpChangesColor: boolean; chp: number; mhp: number },
): GlyphPair {
  let attr = desired.attr;
  if (opts.hpChangesColor && !(attr & ATTR_TILE_BIT)) {
    /* Upstream's `player->chp * 10 / player->mhp` is integer division on
     * possibly-negative chp; Math.trunc reproduces C's truncation. mhp is
     * never 0 in a live game, but a 0 guard keeps this total for tests. */
    const decile = opts.mhp > 0 ? Math.trunc((opts.chp * 10) / opts.mhp) : 10;
    switch (decile) {
      case 10:
      case 9:
        attr = COLOUR_WHITE;
        break;
      case 8:
      case 7:
        attr = COLOUR_YELLOW;
        break;
      case 6:
      case 5:
        attr = COLOUR_ORANGE;
        break;
      case 4:
      case 3:
        attr = COLOUR_L_RED;
        break;
      case 2:
      case 1:
      case 0:
        attr = COLOUR_RED;
        break;
      default:
        attr = COLOUR_WHITE;
        break;
    }
  }
  return { attr, char: desired.char };
}
