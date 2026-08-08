import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import type { MassProduceVector } from "./mass-produce-vectors.js";
import { computeMassProduceVectors } from "./mass-produce-vectors.js";
import { massProduceFixtures } from "./mass-produce-vectors.fixtures.js";

const RECORDED = JSON.parse(
  readFileSync(new URL("./mass-produce-vectors.json", import.meta.url), "utf8"),
) as MassProduceVector[];

const COMPUTED = computeMassProduceVectors(massProduceFixtures());

/**
 * `mass_produce` had no test at all before the store registry work. These
 * vectors were recorded from the switch-based implementation and are replayed
 * against the registry, so a stack size or an RNG draw that moved is named.
 *
 * CHECK-ONLY: no regenerate-if-missing branch and no flag that rewrites the
 * file. The generator is a separate script a person runs deliberately.
 */
describe("mass_produce golden vectors", () => {
  it("sizes every object kind in the pack, under three seeds", () => {
    expect(RECORDED.length).toBeGreaterThan(1000);
    expect(COMPUTED).toHaveLength(RECORDED.length);
  });

  /**
   * A fixture where every stack is 1 would match forever, and `mass_produce`
   * leaves size 1 for every tval it does not handle. So this is the guard that
   * the evidence reaches the branches: real stacks, and the ammo arm - the only
   * one that ASSIGNS rather than adds, and the only one that can exceed 40.
   */
  it("is evidence that could fail: real stacks, and every arm reached", () => {
    const stacked = RECORDED.filter((v) => v.number > 1);
    expect(stacked.length).toBeGreaterThan(100);
    const tvals = new Set(stacked.map((v) => v.tval));
    /* One arm per branch of the switch: consumables, the armour/weapon arm
     * (which is skipped for an ego item), and ammo. The BOOK arm is NOT here,
     * and that is a measurement rather than an oversight - every book in the
     * 4.2.6 pack costs more than the arm's 500 ceiling, so no shipped book ever
     * mass-produces. The arm is faithful and unreachable with core data; a mod
     * that adds a cheap book reaches it. */
    for (const tval of [TV.FOOD, TV.POTION, TV.SCROLL, TV.SWORD, TV.SOFT_ARMOR]) {
      expect(tvals.has(tval), `no stacked vector with tval ${String(tval)}`).toBe(true);
    }
    expect(tvals.has(TV.MAGIC_BOOK)).toBe(false);
    const ammo = RECORDED.filter((v) => v.tval === TV.ARROW || v.tval === TV.BOLT);
    expect(ammo.some((v) => v.number >= 10)).toBe(true);
  });

  it("reproduces every recorded stack size and RNG position", () => {
    /* One deep-equal over the array would dump 1000+ rows on a single
     * divergence, so the mismatches are collected and reported by name. */
    const diffs: string[] = [];
    for (const [i, expected] of RECORDED.entries()) {
      const actual = COMPUTED[i];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        diffs.push(
          `${expected.kind} seed=${String(expected.seed)}: ` +
            `${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`,
        );
      }
    }
    expect(diffs).toEqual([]);
  });
});
