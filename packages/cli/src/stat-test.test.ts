/**
 * CALIBRATION of the clustered distribution test - the species-mix gate's
 * instrument, checked against data whose answer is known by construction.
 *
 * The species gate in `parity-c-stat.test.ts` decides a real question about the
 * generator, so the instrument behind it has to be shown to work before its
 * verdict means anything. That is the whole history of this metric: a plain
 * G-test was pointed at clustered monster counts, reported p = 2e-97 comparing
 * the port with ITSELF, and had to be withdrawn. The lesson was not "species is
 * unmeasurable" - it was "an instrument must be checked against a known null".
 *
 * So this file builds a synthetic generator with the same shape as monster
 * placement - most levels are an ordinary draw, one level in four grows a PIT
 * that dumps a large batch of one category - and runs the instrument on it three
 * ways:
 *
 *   1. two samples from the SAME generator, judged by the plain G-test. It must
 *      reject nearly always. That is the failure being fixed, reproduced here so
 *      the fix has something to be a fix OF.
 *   2. the same pairs judged by the corrected test. Its rejection rate must sit
 *      near the nominal alpha - that is what "valid gate" means.
 *   3. two samples from generators that genuinely DIFFER, judged by the
 *      corrected test. It must reject. A test that never fires is trivially
 *      calibrated and worth nothing.
 *
 * Everything here is driven by a seeded LCG, so there is no flake to tune around
 * and the numbers asserted are the numbers this code produces.
 */

import { describe, expect, it } from "vitest";
import {
  clusteredDistributionTest,
  distributionTest,
  type ClusterSample,
} from "./stat-test.js";

/** A tiny deterministic LCG (Numerical Recipes' ranqd1 constants). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CATEGORIES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
/** Ordinary per-monster category weights; sum 1. */
const BASE_P = [0.3, 0.2, 0.15, 0.12, 0.09, 0.07, 0.05, 0.02];

/**
 * One synthetic sample of `levels` levels.
 *
 * Each level places 40-60 items. One level in four is a "pit": a single
 * category takes an extra batch of 25-45 items on top. That is deliberately the
 * same shape as the real thing (`pit.txt` themes by monster base, and the fill
 * lands 20-60 of them at once), because the point is to reproduce the
 * overdispersion, not to be a general-purpose simulator.
 */
function sample(rand: () => number, levels: number, p: readonly number[]): ClusterSample {
  const counts: Record<string, number> = {};
  const countsSq: Record<string, number> = {};
  const countsXn: Record<string, number> = {};
  let totalSq = 0;

  const pick = (): number => {
    const u = rand();
    let acc = 0;
    for (let i = 0; i < p.length; i++) {
      acc += p[i]!;
      if (u < acc) return i;
    }
    return p.length - 1;
  };

  for (let l = 0; l < levels; l++) {
    const here = new Array<number>(CATEGORIES.length).fill(0);
    const n = 40 + Math.floor(rand() * 21);
    for (let i = 0; i < n; i++) {
      const idx = pick();
      here[idx] = (here[idx] ?? 0) + 1;
    }
    if (rand() < 0.25) {
      const theme = Math.floor(rand() * CATEGORIES.length);
      here[theme] = (here[theme] ?? 0) + 25 + Math.floor(rand() * 21);
    }
    const total = here.reduce((a, b) => a + b, 0);
    totalSq += total * total;
    for (let i = 0; i < CATEGORIES.length; i++) {
      const y = here[i]!;
      if (y === 0) continue;
      const k = CATEGORIES[i]!;
      counts[k] = (counts[k] ?? 0) + y;
      countsSq[k] = (countsSq[k] ?? 0) + y * y;
      countsXn[k] = (countsXn[k] ?? 0) + y * total;
    }
  }
  return { levels, counts, countsSq, countsXn, totalSq };
}

/** The real gate's shape: 1000 reference levels against 400 observed ones. */
const REF_LEVELS = 1000;
const OBS_LEVELS = 400;
const REPLICATES = 60;
const ALPHA = 0.01;

describe("clusteredDistributionTest calibration", () => {
  /** Both arms share one stream so the whole file is a single fixed sequence. */
  const rand = lcg(0x5eed1337);

  const nullPairs = Array.from({ length: REPLICATES }, () => ({
    obs: sample(rand, OBS_LEVELS, BASE_P),
    ref: sample(rand, REF_LEVELS, BASE_P),
  }));

  it("reproduces the failure: the PLAIN G-test rejects a sample against itself", () => {
    /* Same generator on both sides, so every rejection here is a false one. The
     * plain test treats each item as an independent observation, which the pit
     * batches make false, and it is wrong nearly every time. */
    const rejects = nullPairs.filter(
      ({ obs, ref }) => distributionTest(obs.counts, ref.counts).p < ALPHA,
    ).length;
    expect(rejects / REPLICATES).toBeGreaterThan(0.9);
  });

  it("is calibrated: the CORRECTED test holds its nominal error rate", () => {
    const ps = nullPairs.map(({ obs, ref }) => clusteredDistributionTest(obs, ref.counts).p);
    const rejects = ps.filter((p) => p < ALPHA).length;
    /* Nominal is 1%. The bound is 5 in 60 rather than 1 in 60 because a
     * first-order Rao-Scott correction is an approximation and 60 replicates
     * resolve a rate only to about +/-2%; what is being ruled out is the
     * hundred-fold miscalibration the plain test has, not a third decimal. */
    expect(rejects).toBeLessThanOrEqual(5);
    /* And the p-values must not be piled up at either end: a median near 0.5 is
     * what a correctly calibrated test produces under the null. */
    const median = [...ps].sort((a, b) => a - b)[Math.floor(ps.length / 2)]!;
    expect(median).toBeGreaterThan(0.15);
    expect(median).toBeLessThan(0.85);
  });

  it("measures the clustering rather than assuming it", () => {
    /* The design effect IS the thing the plain test gets wrong, so it is worth
     * asserting that it comes out at the magnitude the clustering implies
     * instead of collapsing to 1 (no correction) or exploding (no power). */
    const deffs = nullPairs.map(({ obs, ref }) => clusteredDistributionTest(obs, ref.counts).deff);
    const mean = deffs.reduce((a, b) => a + b, 0) / deffs.length;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(12);
  });

  it("still has power: it rejects a generator that really is different", () => {
    /* Move 4 points of probability mass from the largest category to the third.
     * This is a mix difference a player could in principle notice, and a gate
     * that cannot see it is decoration. */
    const shifted = [...BASE_P];
    shifted[0] = 0.26;
    shifted[2] = 0.19;
    let rejects = 0;
    for (let i = 0; i < REPLICATES; i++) {
      const obs = sample(rand, OBS_LEVELS, shifted);
      const ref = sample(rand, REF_LEVELS, BASE_P);
      if (clusteredDistributionTest(obs, ref.counts).p < ALPHA) rejects++;
    }
    expect(rejects / REPLICATES).toBeGreaterThan(0.8);
  });

  it("degrades safely on an empty or single-level sample", () => {
    const empty: ClusterSample = {
      levels: 0,
      counts: {},
      countsSq: {},
      countsXn: {},
      totalSq: 0,
    };
    expect(clusteredDistributionTest(empty, {}).p).toBe(1);
    expect(clusteredDistributionTest(empty, { a: 10 }).p).toBe(1);
    const one = sample(lcg(1), 1, BASE_P);
    /* One level is one cluster: the between-cluster variance is undefined, so
     * the test must decline rather than invent a design effect. */
    expect(clusteredDistributionTest(one, { a: 100, b: 100 }).p).toBe(1);
  });
});
