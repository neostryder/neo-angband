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

/**
 * MEASURED dispersion of the pooled feeling G-statistics under a true null.
 *
 * There are two independent 1000-run C main-stats databases, produced by the
 * same binary. Diffing them against each other runs this exact instrument on
 * data where the answer is known to be "no difference", so the result IS the
 * null: `parity/phase3-2026-07-25/tools/c-vs-c-null.mjs` reports
 *
 *   obj_feelings  C-A vs C-B pooled: G/df = 1.76 over 20 depths
 *   mon_feelings  C-A vs C-B pooled: G/df = 1.95 over 20 depths
 *
 * These histograms are therefore overdispersed by nearly a factor of two before
 * the port is involved at all, and a pooled G/df near 1.8 is ORDINARY. This
 * supersedes the 0.95 figure from NOISE-FLOOR.md, which was measured port
 * against ITSELF at a second base seed -- a weaker null, since two runs of one
 * implementation share structure that two independent samples do not.
 *
 * Applied as a quasi-likelihood correction (G/phi referred to chi2(df)). It is
 * ONE replicate per metric, so phi is itself uncertain; more C runs would pin
 * it. Erring toward the measured value is the conservative choice, because the
 * alternative is claiming a divergence that two runs of upstream also show.
 */
const FEEL_DISPERSION: Record<string, number> = { objFeel: 1.76, monFeel: 1.95 };
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
     * The gated family. Decided in two steps: species was ungated on 2026-07-25
     * (a848f310e), and the two feeling metrics were switched from per-depth to
     * POOLED on 2026-07-26 after the noise floor was measured.
     *
     *   - density, per depth        -> `depths.length` tests, corrected
     *   - object count, per depth   -> `depths.length` tests, corrected
     *   - ego count, per depth      -> `depths.length` tests, corrected
     *   - artifact count, per depth -> `depths.length` tests, corrected
     *   - objFeel, POOLED           -> 1 test, corrected
     *   - monFeel, POOLED           -> 1 test, corrected
     *   - species                   -> 0 tests. Printed only, never asserted.
     *   - pooled density (Stouffer) -> 1 test at the UNCORRECTED alpha
     *   - pooled object count       -> 0 tests. Printed only; null not measured.
     *
     * Object count joined the family on 2026-07-26, to answer whether the pooled
     * objFeel excess (the port's levels rate RICHER than the C's) comes from
     * generating MORE objects or from generating more VALUABLE ones. obj_rating
     * is driven by object_value_real (gen-util.c:509-540), so quantity and value
     * are separable causes and objectTotal isolates the first. ANSWER: quantity
     * matches. No depth exceeds |z| = 1.6 at 1000 runs and the pooled deviate
     * shrinks as the sample grows. So the bias is in value per object, and this
     * metric now serves to keep it that way. It is gated per depth for the same
     * reason density is: it is a test on a mean, and a depth-localised quantity
     * bug is a real possibility (a room type that only appears deep). See
     * findings/OBJFEEL.md.
     *
     * Ego and artifact counts joined on 2026-07-26 for the same investigation,
     * one step further in. With quantity matched and value diverging, the
     * question is what carries the value, and obj_rating is driven by
     * object_value_real squared (gen-util.c:509-540), so a handful of ego or
     * artifact drops moves it far more than ordinary items do. These are
     * COUNTS, small per level and roughly Poisson, so a mean test on them has
     * real power -- unlike a mean test on obj_rating itself, whose per-level
     * standard deviation runs about fourteen times its mean on the C oracle. A
     * heavy-tailed variable's mean is not a usable parity instrument, which is
     * exactly why upstream bins the rating into a feeling in the first place.
     *
     * Why species is not gated, and I had this wrong originally. Comparing the
     * port against ITSELF at a second base seed gives G = 350-860 over df =
     * 133-281 at depths 5-20 -- the same magnitude as port-vs-C (389-929), and at
     * depth 13 the port is further from itself (590) than from the C (452).
     * The cause is clustering: a pit or nest drops 20-60 monsters of one theme
     * into a single level, so the effective sample size per depth is the number
     * of LEVELS (400), not of monsters (~20 000), and a G-test assuming one
     * independent observation per monster inflates by roughly the cluster size --
     * exactly the 3-5x observed. It is the same overdispersion that makes the
     * density standard deviation 21.6 where Poisson would say 6.6: correctly
     * accounted for in the mean test above, and wrongly ignored here.
     *
     * A valid species test needs the LEVEL as the unit of observation, e.g. a
     * permutation null over per-level species vectors. That is BLOCKED on the C
     * side: main-stats' SQLite schema stores per-depth aggregates only
     * (`monsters(level, count, k_idx)` summed across runs), so per-run C samples
     * do not exist yet. Emitting them needs a change to the DB writer in the
     * oracle BUILD COPY. So this is an open question, not a settled one.
     *
     * Why the FEELINGS are pooled rather than per-depth. Density stays per-depth
     * because it is a test on a MEAN, so a per-depth result is directly
     * interpretable and a depth-localised density bug (a room type that only
     * appears deep, say) can genuinely exist. The feelings are histograms of a
     * BINNED quantity -- calc_obj_feeling pushes obj_rating through nine
     * thresholds and an integer division (generate.c:711-734) -- so a smooth
     * systematic bias is only visible where the mass straddles a bin edge, and
     * WHICH depths those are is a property of the RNG stream. Measured: the
     * surviving objFeel depths moved from {13,16,19} to {11,12} when RC1/RC3
     * shifted the stream in 25ed848b13, sharing not one depth, while the pooled
     * excess stayed put. See poolDistributionTests for the additivity argument.
     *
     * Both pooled feeling tests are corrected by their MEASURED dispersion
     * (FEEL_DISPERSION above), because two independent 1000-run samples of the
     * same C binary pool to G/df = 1.76 and 1.95 respectively. Pooling is still
     * the right move -- it removes the seed-dependent choice of depth -- but the
     * uncorrected p-value it produces is not believable, and correcting it costs
     * the objFeel finding most of its claimed strength. That is the honest
     * number, so it is the one asserted.
     *
     * Gold is asserted separately -- its per-origin classification is a known
     * open divergence and would otherwise mask the rest. */
    const alpha = bonferroni(ALPHA, 4 * depths.length + 2);
    const rows: Row[] = [];
    const report: string[] = [];
    const densityZ: number[] = [];
    const objCountZ: number[] = [];
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

      /* Object count per level. Money is excluded on BOTH sides -- the port
       * skips TV_GOLD before counting and the C importer subtracts the money
       * kinds back out of `consumables`, which the C double-books (see
       * c-stats.ts). So this is the count of real items only. */
      const objSd = perLevelSd(p, "objectTotal");
      const objCount = meanTest({
        refMean: b.objectTotal / b.levels,
        refN: b.levels,
        portMean: p.objectTotal / p.levels,
        portN: p.levels,
        sd: objSd,
        alpha,
      });
      rows.push({
        depth: d,
        metric: "objcount",
        detail: `z=${objCount.z.toFixed(2)}`,
        p: objCount.p,
      });
      objCountZ.push(objCount.z);
      report.push(
        `depth ${String(d).padStart(2)} objcount C=${(b.objectTotal / b.levels).toFixed(2)} ` +
          `port=${(p.objectTotal / p.levels).toFixed(2)} delta=${objCount.delta.toFixed(2)} ` +
          `sd=${objSd.toFixed(1)} z=${objCount.z.toFixed(2)} p=${objCount.p.toFixed(4)} ` +
          `(resolves +/-${objCount.resolution.toFixed(2)})`,
      );

      /* Ego and artifact counts per level: the countable drivers of rating. */
      for (const metric of ["egos", "artifacts"] as const) {
        const sd = perLevelSd(p, metric);
        const t = meanTest({
          refMean: b[metric] / b.levels,
          refN: b.levels,
          portMean: p[metric] / p.levels,
          portN: p.levels,
          sd,
          alpha,
        });
        rows.push({ depth: d, metric, detail: `z=${t.z.toFixed(2)}`, p: t.p });
        report.push(
          `depth ${String(d).padStart(2)} ${metric.padEnd(9)}C=${(b[metric] / b.levels).toFixed(3)} ` +
            `port=${(p[metric] / p.levels).toFixed(3)} delta=${t.delta.toFixed(3)} ` +
            `sd=${sd.toFixed(2)} z=${t.z.toFixed(2)} p=${t.p.toFixed(4)} ` +
            `(resolves +/-${t.resolution.toFixed(3)})`,
        );
      }

      for (const [metric, key] of [
        ["species", "monsters"],
        ["objFeel", "objFeeling"],
        ["monFeel", "monFeeling"],
      ] as const) {
        const t = distributionTest(
          p[key] as Record<string, number>,
          b[key] as Record<string, number>,
        );
        /* Held for the pooled assertion; the per-depth row printed below is a
         * diagnostic only. `species` is held nowhere -- `pooling` has no key for
         * it, so it is neither pooled nor gated (see the family note above). */
        pooling[metric]?.push(t);
        report.push(
          `depth ${String(d).padStart(2)} ${metric.padEnd(8)}${metric === "species" ? " [ungated]" : ""} G=${t.g.toFixed(1)} ` +
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
      const t = poolDistributionTests(pooling[metric] ?? [], FEEL_DISPERSION[metric] ?? 1);
      rows.push({
        depth: -1,
        metric: `${metric}-pooled`,
        detail: `G=${t.g.toFixed(1)} df=${t.df} G/df=${t.ratio.toFixed(2)} over ${t.k} depths`,
        p: t.p,
      });
      report.push(
        `POOLED ${metric.padEnd(8)} G=${t.g.toFixed(1)} df=${t.df} ` +
          `G/df=${t.ratio.toFixed(2)} (measured C-vs-C null ${t.dispersion.toFixed(2)}) ` +
          `-> G/phi/df=${(t.ratio / t.dispersion).toFixed(2)} p=${t.p.toExponential(2)} ` +
          `over ${t.k} depths (alpha=${alpha.toExponential(2)})`,
      );
    }
    report.push(
      `species: printed, NOT gated -- the G-test is invalid on clustered ` +
        `per-monster counts (the port reaches p=2e-97 against ITSELF). A valid ` +
        `per-level test is blocked on the C oracle emitting per-run samples.`,
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

    /*
     * Same Stouffer combination for object count -- PRINTED, NOT GATED, because
     * its null has not been measured and this house rule has been learned the
     * hard way twice (species, then the feeling G-tests): a pooled statistic is
     * not gated until its null is measured, because pooling inherits any
     * correlation between the things pooled. I gated this one when I added it
     * and that was wrong. The evidence that it is not calibrated is direct: at
     * PORT_RUNS=400 it returned Z=-2.66 p=7.9e-3, and at 1000 -- two and a half
     * times the data -- it WEAKENED to Z=-1.78 p=7.5e-2. A real effect grows
     * with n (objFeel pooled went 1.87 -> 2.70 over the same two runs); one that
     * shrinks is noise, and the 20 per-depth deviates are plausibly correlated
     * since one run walks every depth on one RNG stream.
     *
     * The per-depth object-count tests ARE gated: they are two-sample mean tests,
     * the same instrument as density, whose calibration was established when S-2
     * was closed.
     */
    const objStouffer =
      objCountZ.reduce((a, b) => a + b, 0) / Math.sqrt(Math.max(objCountZ.length, 1));
    const objStoufferP = normalTwoTailedP(objStouffer);
    report.push(
      `pooled objcount (Stouffer over ${objCountZ.length} depths): Z=${objStouffer.toFixed(2)} ` +
        `p=${objStoufferP.toExponential(2)} -- DIAGNOSTIC ONLY, null not yet measured`,
    );

    const failures = rows.filter((r) => r.p < alpha || r.metric === "density-pooled");
    const summary =
      `C-vs-TS generation parity, alpha=${alpha.toExponential(2)} ` +
      `(${ALPHA} Bonferroni-corrected over ${depths.length} per-depth tests each ` +
      `of density, object count, ego count and artifact count + 2 pooled ` +
      `feeling tests = ${4 * depths.length + 2}; species not gated), ` +
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
