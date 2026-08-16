/**
 * Replay the tval tables recorded on disk. MOD_REACH gap 28.
 *
 * These vectors were recorded BEFORE any tval registry existed. Their whole
 * value is that the fixture is older than the refactor - a test that computes
 * the answer twice in one process cannot fail across one, because agreement is
 * symmetric. See the header of `tval-vectors.ts` for why the predicate table is
 * the complete cross product rather than a sample, and why the kind table runs
 * over the real shipped pack rather than synthetic kinds.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TVAL_ENTRIES } from "../generated/tvals.js";
import { tvalVectorRegistry } from "./tval-vectors.fixtures.js";
import {
  computeTvalKindVectors,
  computeTvalVectors,
  tvalPredicateNames,
} from "./tval-vectors.js";
import type { TvalKindVector, TvalVector } from "./tval-vectors.js";

function load<T>(name: string): T[] {
  return JSON.parse(
    readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"),
  ) as T[];
}

describe("tval class predicates replay their recorded answers", () => {
  const golden = load<TvalVector>("tval-vectors");
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
      expect({ name, discriminates: trues > 0 && trues < fresh.length }).toEqual(
        { name, discriminates: true },
      );
    }
  });

  it("answers the same for every tval", () => {
    /* Compared row by row so a failure names the item class. */
    for (let i = 0; i < golden.length; i++) {
      expect(fresh[i]).toEqual(golden[i]);
    }
  });
});

describe("the two tval dispatches replay over the real object kinds", () => {
  const golden = load<TvalKindVector>("tval-kind-vectors");
  const fresh = computeTvalKindVectors(tvalVectorRegistry());

  it("covers every kind in the shipped pack", () => {
    expect(fresh.length).toBe(golden.length);
    expect(fresh.length).toBeGreaterThan(300);
  });

  it("reaches every arm of both dispatches", () => {
    /* `kindIsGood` has three arms plus a flag fallthrough and
     * `objectValueBase` has seven, and a table that only ever exercised one of
     * them would replay identically no matter what happened to the others.
     * These are the counts as recorded; they are asserted so a pack that
     * stopped shipping, say, any rod could not silently shrink the coverage. */
    expect(new Set(fresh.map((v) => v.valueBase)).size).toBeGreaterThanOrEqual(
      7,
    );
    const good = fresh.filter((v) => v.kindIsGood).length;
    expect({ good: good > 0 && good < fresh.length }).toEqual({ good: true });
  });

  it("decides the same for every kind", () => {
    for (let i = 0; i < golden.length; i++) {
      expect(fresh[i]).toEqual(golden[i]);
    }
  });
});
