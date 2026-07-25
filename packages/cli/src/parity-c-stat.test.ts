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
import { bonferroni, distributionTest, meanTest } from "./stat-test";

const cbase = loadCBaseline();

/**
 * Port sample size. Each run generates one level per depth, so this is also the
 * number of sampled levels per depth. 200 x 8 depths is ~30s and resolves a mean
 * shift of roughly 3 monsters per level (about 7%) at the corrected alpha; the
 * C side contributes 200 levels per depth of its own.
 */
const PORT_RUNS = 200;
const DEPTH_MAX = 8;
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
    /* 4 tests per depth: density, species mix, object feeling, monster feeling.
     * Gold is asserted separately -- its per-origin classification is a known
     * open divergence and would otherwise mask the rest. */
    const alpha = bonferroni(ALPHA, depths.length * 4);
    const rows: Row[] = [];
    const report: string[] = [];

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
        rows.push({
          depth: d,
          metric,
          detail: `G=${t.g.toFixed(1)} df=${t.df}`,
          p: t.p,
        });
        report.push(
          `depth ${String(d).padStart(2)} ${metric.padEnd(8)} G=${t.g.toFixed(1)} ` +
            `df=${t.df} p=${t.p.toFixed(4)} cats=${t.categories} pooled=${t.pooled}` +
            (t.worst
              ? ` worst=${t.worst.category} obs=${t.worst.observed} exp=${t.worst.expected.toFixed(1)}`
              : ""),
        );
      }
    }

    const failures = rows.filter((r) => r.p < alpha);
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
