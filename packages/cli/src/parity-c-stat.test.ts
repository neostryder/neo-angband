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
 *   - monster density per level, per depth (two-sample z on the mean);
 *   - the monster species mix, per depth (G-test over the histogram);
 *   - object and monster level feelings, per depth (G-test);
 *   - gold per level, per depth (two-sample z).
 *
 * A failure here is a real finding about generation. The response is to fix the
 * generator -- never to widen a threshold, and never to re-record the C baseline
 * from the port.
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import { perLevelSd, runStatsBatch, type StatsReport } from "./stats";
import { loadCBaseline } from "./baseline";
import { bonferroni, distributionTest, meanTest, normalTwoTailedP } from "./stat-test";

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
    /* 3 GATED tests per depth: density, object feeling, monster feeling.
     *
     * The species mix is measured and printed but NOT gated, because the G-test
     * is invalid for it and I had this wrong. Measured 2026-07-25: comparing the
     * port against ITSELF at a second base seed gives G = 350-860 over df =
     * 133-281 at depths 5-20 -- the same magnitude as port-vs-C (389-929), and at
     * depth 13 the port is further from itself (590) than from the C (452).
     *
     * The cause is clustering. Monster placement is not independent per monster:
     * a pit or nest drops 20-60 monsters of one theme into a single level, so the
     * effective sample size per depth is the number of LEVELS (400), not the
     * number of monsters (~20 000). A G-test that assumes one independent
     * observation per monster inflates the statistic by roughly the cluster size,
     * which is exactly the 3-5x we see. It is the same overdispersion that makes
     * the density standard deviation 21.6 where Poisson would say 6.6 -- correctly
     * accounted for in the mean test above, and wrongly ignored here.
     *
     * A valid species test needs the LEVEL as the unit of observation, e.g. a
     * permutation null over per-level species vectors. That is blocked on the C
     * side: main-stats' SQLite schema stores per-depth aggregates only
     * (`monsters(level, count, k_idx)` summed across runs), so per-run C samples
     * do not exist yet. Emitting them needs a change to the DB writer in the
     * oracle BUILD COPY, which is the next step.
     *
     * Gold is asserted separately -- its per-origin classification is a known
     * open divergence and would otherwise mask the rest. */
    const alpha = bonferroni(ALPHA, depths.length * 3);
    const rows: Row[] = [];
    const report: string[] = [];
    const densityZ: number[] = [];

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
        /* Species is measured but not gated (see the note above): the G-test is
         * invalid on clustered per-monster counts. Feelings ARE gated -- each
         * level contributes exactly one feeling sample, so those observations are
         * independent and the test holds. */
        if (metric !== "species") {
          rows.push({
            depth: d,
            metric,
            detail: `G=${t.g.toFixed(1)} df=${t.df}`,
            p: t.p,
          });
        }
        report.push(
          `depth ${String(d).padStart(2)} ${metric.padEnd(8)}${metric === "species" ? " [ungated]" : ""} G=${t.g.toFixed(1)} ` +
            `df=${t.df} p=${t.p.toFixed(4)} cats=${t.categories} pooled=${t.pooled}` +
            (t.worst
              ? ` worst=${t.worst.category} obs=${t.worst.observed} exp=${t.worst.expected.toFixed(1)}`
              : ""),
        );
      }
    }

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
      `(${ALPHA} Bonferroni-corrected over ${rows.length} tests), ` +
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
