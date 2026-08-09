/**
 * Replay the tval class-predicate table recorded on disk. MOD_REACH gap 28.
 *
 * These vectors were recorded BEFORE any tval registry existed. Their whole
 * value is that the fixture is older than the refactor - a test that computes
 * the answer twice in one process cannot fail across one, because agreement is
 * symmetric. See the header of `tval-vectors.ts` for why the table is the
 * complete cross product rather than a sample.
 */

import { describe, expect, it } from "vitest";

import golden from "./tval-vectors.json" with { type: "json" };
import { computeTvalVectors, tvalPredicateNames } from "./tval-vectors.js";
import { TVAL_ENTRIES } from "../generated/tvals.js";

describe("tval class predicates replay their recorded answers", () => {
  const fresh = computeTvalVectors();

  it("records every predicate and every tval", () => {
    /* The counts are the measurement, not decoration. A predicate dropped from
     * `object.ts` - or one added and never recorded - would otherwise leave the
     * per-row comparisons below perfectly green while the table quietly stopped
     * covering the code. Both numbers move only in a commit that says so. */
    expect({
      predicates: tvalPredicateNames().length,
      tvals: TVAL_ENTRIES.length,
    }).toEqual({ predicates: 34, tvals: 36 });

    expect(fresh.length).toBe(golden.length);
    expect(Object.keys(fresh[0]!.answers)).toEqual(
      Object.keys(golden[0]!.answers),
    );
  });

  it("every predicate discriminates - none is all-true or all-false", () => {
    /* A predicate that answered the same for every tval could not disagree with
     * its own fixture no matter how it broke: 36 recorded `false`s and 36 fresh
     * `false`s match whether the body is upstream's or `return false`. Measured
     * rather than assumed - today the thinnest is one tval (tvalIsChest and
     * friends) and the table would notice that one flipping. */
    for (const name of tvalPredicateNames()) {
      const trues = fresh.filter((v) => v.answers[name]).length;
      expect({ name, trues: trues > 0 && trues < fresh.length }).toEqual({
        name,
        trues: true,
      });
    }
  });

  it("answers the same for every tval", () => {
    /* Compared row by row so a failure names the item class. */
    for (let i = 0; i < golden.length; i++) {
      expect(fresh[i]).toEqual(golden[i]);
    }
  });
});
