/**
 * The behaviour proof: does the port GENERATE the same game as Angband 4.2.6?
 *
 * This is the only test in the repository that compares the port against real
 * compiled C output. The baseline (`baseline/c-stats-baseline.json`,
 * `meta.generatedBy = "c-main-stats"`) was imported from the upstream
 * `main-stats` tool; everything else in the suite either checks the port against
 * itself or checks code against a human's reading of the C.
 *
 * It supersedes the abs/rel tolerance gate that `parity-c.test.ts` used. That
 * gate could not distinguish a real divergence from an under-sampled one, and it
 * duly reported four "failures" (the S-2 depth 6-8 density findings) whose values
 * all sit inside the port's own seed-to-seed spread. Per-level monster count has
 * a standard deviation near 17 on a mean near 46, so ±2 is about one standard
 * error at 100 levels. Here every comparison is a hypothesis test that states its
 * own resolving power instead, Bonferroni-corrected across the whole matrix.
 *
 * The port keeps its own RNG stream from the C by design (decision D1 = B), so
 * only the DISTRIBUTIONS can agree, never the individual levels. What must agree:
 *   - monster density per level, per depth (two-sample z on the mean), plus a
 *     Stouffer combination of those deviates to catch a small systematic bias;
 *   - object and monster level feelings, POOLED across depths (summed G-tests);
 *   - gold per level, per depth (two-sample z).
 *
 * And what is measured but deliberately NOT gated: the monster species mix. It
 * is 2.5-5.0x overdispersed by pit/nest clustering, to the point that the port
 * reaches p = 2e-97 against ITSELF, so no threshold on it means anything. Its
 * rows are printed as a diagnostic. Answering the species question properly needs
 * a different instrument (one vector per level, permutation test over levels) and
 * is open work, not a settled matter. See the family note on the main test and
 * `parity/phase3-2026-07-25/findings/NOISE-FLOOR.md`.
 *
 * A failure here is a real finding about generation. The response is to fix the
 * generator -- never to widen a threshold, and never to re-record the C baseline
 * from the port.
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import { perLevelSd, runStatsBatch, type StatsReport } from "./stats";
import { loadCBaseline } from "./baseline";
import {
  bonferroni,
  distributionTest,
  meanTest,
  normalTwoTailedP,
  poolDistributionTests,
  type DistributionTest,
} from "./stat-test";

const cbase = loadCBaseline();

/**
 * Port sample size. Each run generates one level per depth, so this is also the
 * number of sampled levels per depth, and the C oracle contributes 1000 of its
 * own. 400 x 20 depths is a ~2 minute test that resolves a per-depth mean shift
 * of about 4.5 monsters; raise it when chasing a specific divergence:
 *   NEO_PARITY_RUNS=1000 pnpm vitest run packages/cli/src/parity-c-stat.test.ts
 */
const PORT_RUNS = Number(process.env.NEO_PARITY_RUNS ?? 400);
const DEPTH_MAX = 20;
const ALPHA = 0.01;

interface Row {
  depth: number;
  metric: string;
  detail: string;
  p: number;
}

describe.skipIf(!cbase)("C-vs-TS generation parity (upstream 4.2.6 main-stats)", () => {
  const base = cbase as StatsReport;
  const depths = Object.keys(base.depths)
    .map(Number)
    .filter((d) => d <= DEPTH_MAX)
    .sort((a, b) => a - b);

  const port = runStatsBatch(loadGamePack(), {
    runs: PORT_RUNS,
    depthMin: base.meta.depthMin,
    depthMax: DEPTH_MAX,
    baseSeed: 1337,
    race: "Human",
    class: "Warrior",
    randarts: false,
  });

  it("is generated from real C output, not the port itself", () => {
    expect(base.meta.generatedBy).toBe("c-main-stats");
  });

  it("matches upstream generation distributions at alpha=0.01 (Bonferroni)", () => {
    /*
     * The gated family, decided 2026-07-26 after the noise floor was measured
     * (parity/phase3-2026-07-25/findings/NOISE-FLOOR.md, OBJFEEL.md):
     *
     *   - density, per depth       -> `depths.length` tests, corrected
     *   - objFeel, POOLED          -> 1 test, corrected
     *   - monFeel, POOLED          -> 1 test, corrected
     *   - species                  -> 0 tests. PRINTED ONLY, never asserted.
     *   - pooled density (Stouffer)-> 1 test at the UNCORRECTED alpha
     *
     * Density stays per-depth because it is a test on a MEAN, so a per-depth
     * result is directly interpretable and a depth-localised density bug (a room
     * type that only appears deep, say) is a thing that can actually exist. The
     * two feeling metrics are histograms of a BINNED quantity, where which depth
     * lights up is a property of the seed rather than the generator, so they are
     * pooled -- see poolDistributionTests for the full argument and the measured
     * calibration that licenses it.
     *
     * `species` is excluded from pass/fail entirely, NOT because it is
     * inconvenient but because it was measured to be void: the port compared
     * against ITSELF reaches p = 2e-97 on it, since pits and nests drop 20-60
     * monsters of one theme onto a single level and the G-test counts monsters as
     * independent. Its rows are still printed, and it remains a real question
     * worth a real instrument -- one species-vector per LEVEL, then a permutation
     * test over levels. Until someone builds that, gating on it only teaches
     * everyone to ignore a red suite.
     *
     * Gold is asserted separately below -- its per-origin classification is a
     * known open divergence and would otherwise mask the rest.
     */
    const alpha = bonferroni(ALPHA, depths.length + 2);
    const rows: Row[] = [];
    const report: string[] = [];
    const densityZ: number[] = [];
    /** Per-depth G-tests held for pooling, keyed by metric. */
    const pooling: Record<string, DistributionTest[]> = { objFeel: [], monFeel: [] };

    for (const d of depths) {
      const b = base.depths[String(d)];
      const p = port.depths[String(d)];
      if (!b || !p) continue;

      const sd = perLevelSd(p, "monsterTotal");
      const density = meanTest({
        refMean: b.monsterTotal / b.levels,
        refN: b.levels,
        portMean: p.monsterTotal / p.levels,
        portN: p.levels,
        sd,
        alpha,
      });
      rows.push({ depth: d, metric: "density", detail: `z=${density.z.toFixed(2)}`, p: density.p });
      densityZ.push(density.z);
      report.push(
        `depth ${String(d).padStart(2)} density  C=${(b.monsterTotal / b.levels).toFixed(2)} ` +
          `port=${(p.monsterTotal / p.levels).toFixed(2)} delta=${density.delta.toFixed(2)} ` +
          `sd=${sd.toFixed(1)} z=${density.z.toFixed(2)} p=${density.p.toFixed(4)} ` +
          `(resolves +/-${density.resolution.toFixed(2)})`,
      );

      for (const [metric, key] of [
        ["species", "monsters"],
        ["objFeel", "objFeeling"],
        ["monFeel", "monFeeling"],
      ] as const) {
        const t = distributionTest(
          p[key] as Record<string, number>,
          b[key] as Record<string, number>,
        );
        /* Held for the pooled assertion; the per-depth row below is a printed
         * diagnostic only. `species` is held nowhere -- it is neither pooled nor
         * gated (see the family note above). */
        pooling[metric]?.push(t);
        report.push(
          `depth ${String(d).padStart(2)} ${metric.padEnd(8)} G=${t.g.toFixed(1)} ` +
            `df=${t.df} p=${t.p.toFixed(4)} cats=${t.categories} pooled=${t.pooled}` +
            (t.worst
              ? ` worst=${t.worst.category} obs=${t.worst.observed} exp=${t.worst.expected.toFixed(1)}`
              : ""),
        );
      }
    }

    /* The two GATED distribution metrics, pooled across depths. The per-depth
     * rows above stay in the printout so a real divergence can still be
     * localised by eye; only these two are asserted. `ratio` is the number to
     * read: 1.0 is exactly the null expectation. */
    for (const metric of ["objFeel", "monFeel"] as const) {
      const t = poolDistributionTests(pooling[metric] ?? []);
      rows.push({
        depth: -1,
        metric: `${metric}-pooled`,
        detail: `G=${t.g.toFixed(1)} df=${t.df} G/df=${t.ratio.toFixed(2)} over ${t.k} depths`,
        p: t.p,
      });
      report.push(
        `POOLED ${metric.padEnd(8)} G=${t.g.toFixed(1)} df=${t.df} ` +
          `G/df=${t.ratio.toFixed(2)} p=${t.p.toExponential(2)} over ${t.k} depths ` +
          `(measured null ratio ~0.95; alpha=${alpha.toExponential(2)})`,
      );
    }
    report.push(
      `species: PRINTED ONLY, not gated -- measured void (the port reaches ` +
        `p=2e-97 against itself; pit/nest clustering). See NOISE-FLOOR.md.`,
    );

    /* Pooled density check (Stouffer). A per-depth test is blind to a small
     * SYSTEMATIC bias -- 3% low at every depth is invisible one depth at a time
     * but is exactly the kind of divergence that matters, and combining the
     * per-depth deviates recovers roughly sqrt(k) times the power. This is one
     * hypothesis, so it takes the uncorrected alpha. */
    const stouffer =
      densityZ.reduce((a, b) => a + b, 0) / Math.sqrt(Math.max(densityZ.length, 1));
    const stoufferP = normalTwoTailedP(stouffer);
    report.push(
      `pooled density (Stouffer over ${densityZ.length} depths): Z=${stouffer.toFixed(2)} ` +
        `p=${stoufferP.toExponential(2)} (alpha=${ALPHA})`,
    );
    if (stoufferP < ALPHA) {
      rows.push({
        depth: -1,
        metric: "density-pooled",
        detail: `Stouffer Z=${stouffer.toFixed(2)} over ${densityZ.length} depths`,
        p: stoufferP,
      });
    }

    const failures = rows.filter((r) => r.p < alpha || r.metric === "density-pooled");
    const summary =
      `C-vs-TS generation parity, alpha=${alpha.toExponential(2)} ` +
      `(${ALPHA} Bonferroni-corrected over ${depths.length} per-depth density ` +
      `tests + 2 pooled feeling tests = ${depths.length + 2}; species not gated), ` +
      `port runs=${PORT_RUNS}\n` +
      report.join("\n") +
      (failures.length
        ? `\n\nSIGNIFICANT DIVERGENCE:\n` +
          failures
            .map((f) => `  depth ${f.depth} ${f.metric}: ${f.detail} p=${f.p.toExponential(2)}`)
            .join("\n")
        : "");
    /* Always emit the table: a green run should still tell us the effect size we
     * could have detected, so "no evidence of divergence" is never mistaken for
     * "proven identical". */
    console.log(summary);
    expect(failures, summary).toEqual([]);
  }, 300_000);

  it("matches upstream gold per level", () => {
    const alpha = bonferroni(ALPHA, depths.length);
    const failures: string[] = [];
    for (const d of depths) {
      const b = base.depths[String(d)];
      const p = port.depths[String(d)];
      if (!b || !p) continue;
      const t = meanTest({
        refMean: b.gold / b.levels,
        refN: b.levels,
        portMean: p.gold / p.levels,
        portN: p.levels,
        sd: perLevelSd(p, "gold"),
        alpha,
      });
      if (t.p < alpha) {
        failures.push(
          `depth ${d} gold: C=${(b.gold / b.levels).toFixed(1)} ` +
            `port=${(p.gold / p.levels).toFixed(1)} z=${t.z.toFixed(2)} ` +
            `p=${t.p.toExponential(2)}`,
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 300_000);
});
