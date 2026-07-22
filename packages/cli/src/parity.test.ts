/**
 * SELF-REGRESSION guard - NOT an upstream parity check.
 *
 * It (1) re-runs a small fixed-seed stats batch and asserts it reproduces the
 * committed PORT-CAPTURED baseline EXACTLY (the port is bit-exact for a fixed
 * seed, so any drift in the port's own generation/allocation distributions
 * fails here), and (2) runs the golden scenarios and asserts every one passes.
 *
 * These baselines and expected constants were captured from the port itself, so
 * a green run here means "unchanged from the last accepted port behavior", NOT
 * "equal to Angband 4.2.6". The real cross-implementation parity check lives in
 * parity-c.test.ts (diffs the port against C main-stats output). Keep this batch
 * small - the full sweep stays a manual/CI script (pnpm --filter cli stats).
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import { BASELINE_PARAMS, deriveSeed, runStatsBatch } from "./stats";
import {
  EXACT_TOLERANCE,
  STATISTICAL_TOLERANCE,
  compareReports,
  formatCompareResult,
  loadBaseline,
} from "./baseline";
import { runScenarios } from "./scenarios";

const pack = loadGamePack();

describe("statistical parity harness", () => {
  it("reproduces the committed baseline exactly (self-regression guard)", () => {
    const baseline = loadBaseline();
    const fresh = runStatsBatch(pack, BASELINE_PARAMS);
    const result = compareReports(baseline, fresh, {
      tolerance: EXACT_TOLERANCE,
    });
    // Print every out-of-tolerance metric on failure for a fast diagnosis.
    expect(result.ok, formatCompareResult(result)).toBe(true);
  });

  it("is deterministic: two batches at the same seed are identical", () => {
    const a = runStatsBatch(pack, { ...BASELINE_PARAMS, runs: 1, depthMax: 3 });
    const b = runStatsBatch(pack, { ...BASELINE_PARAMS, runs: 1, depthMax: 3 });
    expect(a.depths).toEqual(b.depths);
  });

  it("collects the main-stats metrics with real signal", () => {
    const report = runStatsBatch(pack, { ...BASELINE_PARAMS, runs: 1, depthMax: 5 });
    // Every depth generated a level and placed monsters + objects.
    for (let d = 1; d <= 5; d++) {
      const m = report.depths[String(d)]!;
      expect(m.levels).toBe(1);
      expect(m.monsterTotal).toBeGreaterThan(0);
      expect(Object.keys(m.monsters).length).toBeGreaterThan(0);
      // A non-town level always carries a level feeling.
      const feelKeys = Object.keys(m.objFeeling).length + Object.keys(m.monFeeling).length;
      expect(feelKeys).toBeGreaterThan(0);
    }
  });

  it("deriveSeed is a pure, well-spread function of (base, run, depth)", () => {
    expect(deriveSeed(1, 0, 1)).toBe(deriveSeed(1, 0, 1)); // pure
    expect(deriveSeed(1, 0, 1)).not.toBe(deriveSeed(1, 0, 2)); // depth-sensitive
    expect(deriveSeed(1, 0, 1)).not.toBe(deriveSeed(1, 1, 1)); // run-sensitive
    expect(deriveSeed(1, 0, 1)).not.toBe(deriveSeed(2, 0, 1)); // seed-sensitive
    // uint32 range.
    const s = deriveSeed(0xdeadbeef, 7, 9);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(s)).toBe(true);
  });
});

describe("baseline comparator", () => {
  it("flags out-of-tolerance drift and passes within tolerance", () => {
    const baseline = runStatsBatch(pack, { ...BASELINE_PARAMS, runs: 1, depthMax: 3 });
    // A perturbed copy: bump one metric well past the exact tolerance.
    const perturbed = structuredClone(baseline);
    perturbed.depths["1"]!.monsterTotal += 5;
    const strict = compareReports(baseline, perturbed, { tolerance: EXACT_TOLERANCE });
    expect(strict.ok).toBe(false);
    expect(strict.diffs.some((d) => d.path === "depths.1.monsterTotal")).toBe(true);

    // The same drift is absorbed by a wide statistical tolerance.
    const loose = compareReports(baseline, perturbed, {
      tolerance: { ...STATISTICAL_TOLERANCE, abs: 10 },
    });
    expect(loose.ok).toBe(true);
  });

  it("reports a structural mismatch when depth sets differ", () => {
    const a = runStatsBatch(pack, { ...BASELINE_PARAMS, runs: 1, depthMax: 3 });
    const b = runStatsBatch(pack, { ...BASELINE_PARAMS, runs: 1, depthMax: 2 });
    const result = compareReports(a, b, { tolerance: EXACT_TOLERANCE });
    expect(result.ok).toBe(false);
    expect(result.structural.length).toBeGreaterThan(0);
  });
});

describe("golden scenarios", () => {
  it("all golden scenarios pass", () => {
    const results = runScenarios(pack);
    for (const r of results) {
      expect(r.ok, `${r.name}: ${r.failures.join("; ")}`).toBe(true);
    }
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});
