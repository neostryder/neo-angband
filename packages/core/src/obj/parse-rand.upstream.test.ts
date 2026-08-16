/**
 * parse_random negation (parser.c:126-213), the `rand` field type.
 *
 * The negation is not dice negation. `parse_random` strips a leading '-', parses
 * the remainder as a POSITIVE value, and only then adjusts (parser.c:207-211):
 *
 *     base *= -1;  base -= m_bonus;  base -= dice * (sides + 1);
 *
 * The comment there gives the reason: "the random components are always
 * positive, so the base must be adjusted as necessary". The base is shifted down
 * far enough that `base + XdY (+ m_bonus)` spans the negated interval, rather
 * than the sign binding to the base token alone.
 *
 * This is not academic. `ego_item.txt:692`, "of Backbiting", carries
 * `combat:-26+d25:-26+d25:0`. Upstream gives base -52, dice 1, sides 25, so
 * to_h/to_d land in -51..-27. Binding the sign to the base gives -26 + 1d25,
 * i.e. -25..-1 -- an ego roughly half as punishing as upstream's. Found by the
 * W3-5 parse adjudication (findings/W3-UNIT-TESTS-parse.md, D1).
 */

import { describe, expect, it } from "vitest";
import { parseRand } from "./bind.js";

/** Hand-traced through parse_random, one row per interesting shape. */
const CASES: ReadonlyArray<{
  readonly str: string;
  readonly base: number;
  readonly dice: number;
  readonly sides: number;
  readonly mBonus: number;
  readonly why: string;
}> = [
  { str: "10", base: 10, dice: 0, sides: 0, mBonus: 0, why: "plain base" },
  { str: "2d6", base: 0, dice: 2, sides: 6, mBonus: 0, why: "dice only" },
  { str: "3+2d4", base: 3, dice: 2, sides: 4, mBonus: 0, why: "base + dice" },
  { str: "d25", base: 0, dice: 1, sides: 25, mBonus: 0, why: "bare d implies one die (:146-150)" },
  {
    str: "-5",
    base: -5,
    dice: 0,
    sides: 0,
    mBonus: 0,
    why: "no random part, so the adjustment subtracts nothing",
  },
  {
    str: "-2d6",
    base: -14,
    dice: 2,
    sides: 6,
    mBonus: 0,
    why: "0 - 2*(6+1); spans -12..-2, the negation of 2..12",
  },
  {
    str: "-26+d25",
    base: -52,
    dice: 1,
    sides: 25,
    mBonus: 0,
    why: "ego_item.txt:692 'of Backbiting'; -26 - 1*(25+1); spans -51..-27",
  },
];

describe("parseRand / parse_random (parser.c:126-213)", () => {
  for (const c of CASES) {
    it(`${c.str} -> base ${c.base}, ${c.dice}d${c.sides}${c.mBonus ? `M${c.mBonus}` : ""} (${c.why})`, () => {
      expect(parseRand(c.str)).toEqual({
        base: c.base,
        dice: c.dice,
        sides: c.sides,
        mBonus: c.mBonus,
      });
    });
  }

  /* The property the C's adjustment exists to produce: negating a value negates
   * its whole interval, rather than just shifting its floor. */
  it("a negated value spans exactly the negation of the positive interval", () => {
    for (const positive of ["2d6", "26+d25", "5", "3+2d4"]) {
      const p = parseRand(positive);
      const n = parseRand(`-${positive}`);
      const pMin = p.base + (p.dice > 0 ? p.dice : 0);
      const pMax = p.base + p.dice * p.sides;
      const nMin = n.base + (n.dice > 0 ? n.dice : 0);
      const nMax = n.base + n.dice * n.sides;
      expect([nMin, nMax], `interval for -${positive}`).toEqual([-pMax, -pMin]);
    }
  });
});
