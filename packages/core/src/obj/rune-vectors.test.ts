/**
 * Replay the recorded rune vectors (`rune-vectors.json`, 99 runes and 16
 * modifier message pairs) against whatever answers those questions now.
 *
 * WHY THIS FILE IS THE EVIDENCE and `rune-registry.test.ts` is not: these rows
 * were recorded BEFORE `RuneRegistry` existed, by the six closed switches
 * themselves. A test that ran the current code twice and compared it to itself
 * would agree across any refactor at all.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TV } from "../generated/tvals.js";
import { recordRuneVectors } from "./rune-vectors.js";
import { runeVectorWorld } from "./rune-vectors.fixtures.js";
import type { RuneVectors } from "./rune-vectors.js";

const recorded = JSON.parse(
  readFileSync(new URL("./rune-vectors.json", import.meta.url), "utf8"),
) as RuneVectors;

describe("rune golden vectors", () => {
  const now = recordRuneVectors(runeVectorWorld(), TV.RING);

  it("every rune still has the same name, description and behaviour", () => {
    expect(now.runes).toEqual(recorded.runes);
  });

  it("every modifier still prints the same lines on wield, both signs", () => {
    expect(now.modMessages).toEqual(recorded.modMessages);
  });

  /*
   * The three checks below are about the GRID, not the code: they are what stop
   * the two assertions above from passing vacuously if the fixture ever stopped
   * reaching the thing it measures. Every one of them has a real failure it is
   * modelled on - see `a-fixture-that-cannot-reach-the-code` and
   * `a-grid-dimension-that-does-not-vary-the-input`.
   */

  it("covers every variety, and reaches each one more than once", () => {
    const byVariety = new Map<string, number>();
    for (const r of now.runes) {
      byVariety.set(r.variety, (byVariety.get(r.variety) ?? 0) + 1);
    }
    expect([...byVariety.keys()].sort()).toEqual([
      "brand",
      "combat",
      "curse",
      "flag",
      "mod",
      "resist",
      "slay",
    ]);
    /* A variety reached once could be a coincidence of pack ordering. */
    for (const [variety, count] of byVariety) {
      expect({ variety, atLeast: count >= 3 }).toEqual({
        variety,
        atLeast: true,
      });
    }
  });

  it("objectHasRune actually discriminates, in both directions", () => {
    /* The failure this exists for: an object that answers `true` to everything
     * makes every `hasOnLoaded: true` meaningless, and one that answers `false`
     * to everything makes the whole column meaningless the other way.
     *
     * The bare object is a real, object_prep'd Ring of STRENGTH, so it honestly
     * carries two runes of its own - the +STR modifier and the SUST_STR flag.
     * That is the stronger result: 2 rather than 0 proves `objectHasRune` is
     * reading the item in front of it and not returning a constant. */
    expect({
      loadedTrue: now.runes.filter((r) => r.hasOnLoaded).length,
      bareTrue: now.runes.filter((r) => r.hasOnBare).length,
      bareKeys: now.runes.filter((r) => r.hasOnBare).map((r) => r.key),
      total: now.runes.length,
    }).toEqual({
      loadedTrue: 99,
      bareTrue: 2,
      bareKeys: ["mod:strength", "flag:sustain strength"],
      total: 99,
    });
  });

  it("the modifier grid separates sign-sensitive arms from sign-blind ones", () => {
    /* Eleven modifiers print a second line, and two of those eleven print the
     * SAME line for both signs (infravision, light). A positive-only grid could
     * not tell a sign-blind arm from a sign-sensitive one, and a grid where
     * every row looked alike could not tell either from no arm at all. */
    const withLine = now.modMessages.filter((m) => m.positive.length > 1);
    const signBlind = withLine.filter(
      (m) => m.positive[1] === m.negative[1],
    );
    expect({
      total: now.modMessages.length,
      withLine: withLine.length,
      signBlind: signBlind.length,
    }).toEqual({ total: 16, withLine: 11, signBlind: 2 });
  });
});
