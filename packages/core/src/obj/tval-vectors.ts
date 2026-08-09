/**
 * Golden vectors for the TVAL CLASS PREDICATES: MOD_REACH gap 28.
 *
 * WHY THIS EXISTS. `obj/object.ts` answers thirty-four questions about an item
 * class - is it a weapon, can it be worn, can it be flavoured, can it be browsed
 * as a book, does its price depend on its properties - and every one of them is
 * closed against a tval core was not compiled with. They are the port of
 * `obj-tval.c`, and there are **408 call sites** across `core` and `web`, so a
 * mod-coined tval currently answers *false to every question the game asks about
 * it*: its items are not weapons, cannot be worn, cannot be flavoured, take the
 * flat-cost pricing path and get no allocation behaviour.
 *
 * THE CENSUS COULD NOT SEE MOST OF THIS, and that is the point worth carrying
 * forward. `tools/switch-census.json` counts `switch` statements, so it recorded
 * five of these - the ones that happen to be written as switches - and missed
 * the twenty-nine written as `tval === TV.STAFF`. A single-comparison predicate
 * is exactly as closed to a mod as a fifteen-case switch; the census measures
 * SYNTAX and the gap is about REACH. The same five rows were also mis-shelved
 * under "object naming / description" for four re-measurements, corrected
 * 2026-08-09.
 *
 * WHY THE TABLE IS COMPLETE RATHER THAN SAMPLED. Every predicate is a pure
 * function of one small integer, and the integers are enumerated in
 * `TVAL_ENTRIES`. So the cross product IS the specification - there is no
 * sampling judgement to get wrong, no scenario grid that might never reach an
 * arm, and no RNG to probe. That makes this the cheapest evidence in the repo
 * and the strictest: a converted predicate that changes its answer for any tval
 * moves a row.
 *
 * The 2026-08-09 relaxation to gameplay parity does not loosen this one. These
 * paths draw nothing, so there is no stream to move; what a predicate decides is
 * whether the player can wield the item, and that is as player-visible as
 * anything in the game.
 */

import { TVAL_ENTRIES } from "../generated/tvals.js";
import * as tvalPredicates from "./object.js";

/**
 * One row: every predicate's answer for one tval, plus the tval's own name so a
 * diff names the item class rather than a bare number.
 */
export interface TvalVector {
  /** The `TV_*` code name, e.g. `"SWORD"`. */
  readonly tval: string;
  /** The numeric value the predicates were actually called with. */
  readonly value: number;
  /** Predicate name -> its answer. Every predicate, every time. */
  readonly answers: Readonly<Record<string, boolean>>;
}

/**
 * Every exported `tval*` predicate, discovered from the module rather than
 * listed by hand.
 *
 * A hand-written list is the classic way for this evidence to go quietly stale:
 * a predicate added later would simply never be recorded, and the vectors would
 * stay green while the new one was as closed as the rest. Discovery means the
 * count itself is a measurement, which is why the test asserts on it.
 */
export function tvalPredicateNames(): readonly string[] {
  return Object.keys(tvalPredicates)
    .filter((k) => /^tval(Is|Can|Has)/.test(k))
    .filter(
      (k) =>
        typeof (tvalPredicates as Record<string, unknown>)[k] === "function",
    )
    .sort();
}

/** Record every predicate's answer for every tval in `TVAL_ENTRIES`. */
export function computeTvalVectors(): TvalVector[] {
  const names = tvalPredicateNames();
  const fns = tvalPredicates as unknown as Record<
    string,
    (tval: number) => boolean
  >;
  return TVAL_ENTRIES.map((entry, value) => {
    const answers: Record<string, boolean> = {};
    for (const name of names) answers[name] = fns[name]!(value);
    return { tval: entry.name, value, answers };
  });
}
