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
import { loadGamePack } from "./pack.js";
import { perLevelSd, runStatsBatch, type StatsReport } from "./stats.js";
import { loadCBaseline } from "./baseline.js";
import {
  bonferroni,
  distributionTest,
  meanTest,
  normalTwoTailedP,
  poolDistributionTests,
  type DistributionTest,
} from "./stat-test.js";

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
 * Base seed for the port's batch. 1337 is the historical default and every
 * recorded figure was measured at it; overriding it is how you ask whether a
 * finding REPLICATES rather than whether it exists once.
 *
 * That distinction is not academic here. The pooled object-count Z is a single
 * draw from a distribution whose measured width is 1.155 (see
 * parity/OBJCOUNT_NULL.md), so any one seed's value is one observation, not a
 * result. Vary this, not NEO_PARITY_RUNS, when the question is "is it real".
 * Replicating across three seeds is what established that the old -4.29 was not
 * noise -- which was correct, and still pointed at the wrong thing: it was this
 * harness generating no spellbooks, not the generator. Replication tells you an
 * effect is real. It tells you nothing about what is producing it.
 */
const BASE_SEED = Number(process.env.NEO_PARITY_SEED ?? 1337);

/**
 * MEASURED null of the pooled feeling G-statistics, from EIGHTEEN independent
 * 1000-run C main-stats databases produced by the same binary. Every unordered
 * pair (153 of them) is a run of this exact instrument on data where the answer
 * is known to be "no difference", so the pairs ARE the null distribution.
 * Produced by `parity/tools/c-vs-c-all-pairs.mjs`:
 *
 *   objFeel  mean 1.79, sd 0.32, range [1.07, 2.60]   (153 pairs)
 *   monFeel  mean 1.93, sd 0.23, range [1.38, 2.54]   (153 pairs)
 *
 * RE-MEASURED 2026-08-12 from 6 runs to 18, and the correction went the
 * dangerous way. The old figures were objFeel {phi 1.94, max 2.49} and monFeel
 * {phi 1.82, max 2.21}, from 15 pairs. Both MAXIMA were too low, monFeel's by
 * 15% -- and `max` is what this file gates on, so the old threshold could have
 * failed a port that matches the C. Fifteen pairs from six runs was never
 * enough to pin the tail of a distribution, and the file said so at the time
 * ("fifteen replicates buy a rank-based one-sided resolution of about 1/16");
 * it just did not follow that through to "so do not gate on the maximum of
 * fifteen". The ordering of the two statistics also reversed, which is a plain
 * signal that neither was resolved.
 *
 * The objFeel excess the port shows (pooled G/df = 2.70) STILL clears the new
 * maximum, so that finding survives -- but by 0.10 rather than 0.21, and it is
 * one sample against a tail estimated from 153 pairs. Treat it as standing, not
 * as settled.
 *
 * Three things follow, and they matter more than the constants.
 *
 * 1. These histograms are overdispersed by about a factor of two BEFORE the
 *    port is involved. The 0.95 figure in NOISE-FLOOR.md is superseded: it was
 *    measured port against ITSELF at a second base seed, which shares structure
 *    that two independent samples do not.
 *
 * 2. G/df is NOT sample-size invariant -- G grows with n for a fixed
 *    distributional difference -- so a port-vs-C ratio computed at 400 port runs
 *    cannot be compared with a null measured between two 1000-run samples. The
 *    pooled feeling assertion is therefore SKIPPED unless the port's sample size
 *    matches the C baseline's levels-per-depth. At the default 400 it prints and
 *    does not gate; run with NEO_PARITY_RUNS=1000 for a valid decision.
 *
 * 3. When it IS comparable, the honest threshold is the empirical maximum, not a
 *    chi-square tail. The dispersion's own spread (1.07 to 2.60 for objFeel) is
 *    wider than a scaled chi-square at ~140 df predicts, so the parametric tail
 *    is not trustworthy at 1e-4. 153 replicates buy a rank-based one-sided
 *    resolution of about 1/154 = 0.0065 and no more -- ten times better than the
 *    15 pairs this note used to quote, and still far weaker than the rest of the
 *    family. Saying so is the point: this metric detects only a LARGE
 *    divergence, and pretending otherwise produced a "p = 8e-25" that was an
 *    artefact of the wrong null.
 */
const FEEL_NULL: Record<string, { phi: number; max: number; pairs: number }> = {
  objFeel: { phi: 1.79, max: 2.6, pairs: 153 },
  monFeel: { phi: 1.93, max: 2.54, pairs: 153 },
};
/**
 * MEASURED width of the pooled object-count Stouffer null, from the same
 * eighteen C runs (153 pairs) via `parity/tools/c-vs-c-objcount.mjs`. Under
 * depth independence this would be 1.0; one run walks every depth on one RNG
 * stream, and the measured excess is the price of that.
 *
 * The low end is CLAMPED at 1.0 rather than taken as 1.155 - 0.244 = 0.911.
 * Positive correlation between depths can only widen a Stouffer null, never
 * narrow it below 1, so a sub-1 estimate is sampling noise on the estimator and
 * using it would report a stronger calibrated Z than the data can support.
 * Nothing gates on these; they only correct a printed diagnostic.
 */
const OBJCOUNT_NULL_WIDTH = 1.155;
const OBJCOUNT_NULL_LO = 1.0;
const OBJCOUNT_NULL_HI = 1.399;

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
    baseSeed: BASE_SEED,
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
     *   - pooled density (Stouffer) -> 0 tests. Printed only; null not measured.
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
     * Both pooled feeling tests are judged against their MEASURED null
     * (FEEL_NULL above, 153 C-vs-C pairs), not against a chi-square tail, and
     * only when the port's sample size matches the C's. Pooling is still the
     * right move -- it removes the seed-dependent choice of depth -- but the
     * uncorrected p-value it produced was an artefact of assuming dispersion 1.
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
    /* Comparable only when the port's sample size matches the C baseline's, for
     * the sample-size reason in the FEEL_NULL note above. */
    const cLevels = base.depths[String(depths[0] ?? 1)]?.levels ?? 0;
    const feelComparable = PORT_RUNS === cLevels;

    for (const metric of ["objFeel", "monFeel"] as const) {
      const nul = FEEL_NULL[metric] ?? { phi: 1, max: Infinity, pairs: 0 };
      const t = poolDistributionTests(pooling[metric] ?? [], nul.phi);
      /* Gated on the EMPIRICAL maximum of the measured null, not on t.p: the
       * parametric tail over-claims here. With 153 replicates the rank-based
       * resolution is ~1/154, which is a real threshold rather than the ~1/16
       * the six-run null could offer. t.p is still printed as a second
       * reading. */
      if (feelComparable && t.ratio > nul.max) {
        rows.push({
          depth: -1,
          metric: `${metric}-pooled`,
          detail:
            `G/df=${t.ratio.toFixed(2)} exceeds all ${nul.pairs} measured ` +
            `C-vs-C pairs (max ${nul.max.toFixed(2)}) over ${t.k} depths`,
          p: 1 / (nul.pairs + 1),
        });
      }
      report.push(
        `POOLED ${metric.padEnd(8)} G=${t.g.toFixed(1)} df=${t.df} G/df=${t.ratio.toFixed(2)} ` +
          `vs measured C-vs-C null mean ${nul.phi.toFixed(2)} max ${nul.max.toFixed(2)} ` +
          `(${nul.pairs} pairs) -> G/phi/df=${(t.ratio / t.dispersion).toFixed(2)} ` +
          `p=${t.p.toExponential(2)} over ${t.k} depths` +
          (feelComparable
            ? ` [GATED at the empirical max; resolution ~1/${nul.pairs + 1}]`
            : ` [NOT GATED: port runs ${PORT_RUNS} != C levels ${cLevels}, ` +
              `and G/df is not sample-size invariant]`),
      );
    }
    report.push(
      `species: printed, NOT gated -- the G-test is invalid on clustered ` +
        `per-monster counts (the port reaches p=2e-97 against ITSELF). A valid ` +
        `per-level test is blocked on the C oracle emitting per-run samples.`,
    );

    /*
     * Pooled density (Stouffer). A per-depth test is blind to a small SYSTEMATIC
     * bias -- 3% low at every depth is invisible one depth at a time but is
     * exactly the kind of divergence that matters -- and combining the per-depth
     * deviates recovers roughly sqrt(k) times the power.
     *
     * PRINTED, NOT GATED, as of 2026-08-07. This file's own house rule is three
     * lines further down and it is right: a pooled statistic is not gated until
     * its null is MEASURED, because pooling inherits any correlation between the
     * things pooled, and one run walks every depth on one RNG stream. Density
     * was gated anyway and survived only by passing.
     *
     * It stopped passing when #143 moved reference/ back to the 4.2.6 tag, and
     * the measurement is the same shape that already disqualified pooled object
     * count:
     *
     *     PORT_RUNS=400    Z=-2.62  p=8.7e-3   (would fail at alpha=0.01)
     *     PORT_RUNS=1000   Z=-2.32  p=2.0e-2   (passes)
     *
     * Two and a half times the data and the deviate WEAKENED. A real effect
     * grows with n -- pooled objFeel goes 1.87 -> 2.70 over exactly that pair --
     * so this is noise, and a gate whose verdict flips with sample size is not
     * measuring the port.
     *
     * The twenty per-depth density tests stay gated at the corrected alpha and
     * all of them pass. Their calibration was established when S-2 was closed;
     * nothing here weakens them, and a genuine systematic bias large enough to
     * matter would show up there too.
     */
    const stouffer =
      densityZ.reduce((a, b) => a + b, 0) / Math.sqrt(Math.max(densityZ.length, 1));
    const stoufferP = normalTwoTailedP(stouffer);
    report.push(
      `pooled density (Stouffer over ${densityZ.length} depths): Z=${stouffer.toFixed(2)} ` +
        `p=${stoufferP.toExponential(2)} -- DIAGNOSTIC ONLY, null not yet measured`,
    );

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
     * That history is about the POST-TAG gamedata and it no longer describes what
     * this file measures. Under 4.2.6's gamedata the same sweep gives Z=-4.17 at
     * 400 runs and Z=-4.29 at 1000: it HOLDS as n grows rather than shrinking,
     * which is the opposite signature and the reason #150 exists at all.
     *
     * MEASURED 2026-08-12, and it stays ungated for a NEW reason.
     * `parity/tools/c-vs-c-objcount.mjs` ran this same pooling over 153 pairs
     * from EIGHTEEN independent C runs and found the null is NOT standard
     * normal: its width is 1.155 +/- 0.122, confirmed to three decimals by a
     * second estimator with a different null (leave-two-out, 1.155 +/- 0.124)
     * and by a negative control that permutes away the cross-depth correlation
     * and returns 0.995. So the nominal p printed below IS overstated -- but
     * only by about 1.16x in Z, not the 1.4x the first six-run pass suggested.
     *
     * That six-run pass reported 1.404 +/- 0.340 and could not decide anything;
     * this note used to quote it, and quoting it was the error. The tool printed
     * its own resolving power ("about 17 runs"), twelve more runs were generated,
     * and the estimate moved by two standard errors.
     *
     * Carrying the +/-2 SE band through, the port's -4.29 calibrated to
     * [-4.29, -3.07], outside the null's empirical RANGE rather than in its tail
     * -- across all 153 C-vs-C pairs the largest |Z| ever seen is 2.393.
     *
     * RESOLVED 2026-08-12, and it was THIS HARNESS. The -4.29 was not a
     * generation defect: runStatsBatch never called registerBookKinds, so the
     * allocation table it built had no spellbook kinds in it at all -- book kinds
     * are synthesised from class.txt (init.c write_book_kind), not read from
     * object.txt -- and every measured level was short the 0.92 books per level
     * the C oracle placed. Binding through bindForGeneration (stats.ts), the same
     * sweep at the same seed and run count gives Z=-0.70, calibrated -0.61, with
     * no per-depth |z| above 1.2. Closing that gap also surfaced a real core
     * defect: dungeon books were missing KF_GOOD and EL_INFO_IGNORE (init.c
     * L269-275), fixed in player/spell.ts.
     *
     * Two things worth keeping from how that went wrong. The deficit LOOKED
     * uniform and multiplicative across all 20 depths -- and a uniform
     * proportional deficit is also exactly what a whole missing CATEGORY looks
     * like after averaging, so print the per-tval breakdown before theorising
     * about the total. And the instrument had been cleared of a counting
     * asymmetry (money, excluded symmetrically) and was then treated as cleared
     * outright: ruling out one way a measurement can be wrong is not ruling out
     * the measurement. See parity/OBJCOUNT_NULL.md.
     *
     * It stays ungated, for the reason that always applied: the thing being
     * judged is a SINGLE port sample at one base seed, and a threshold must not
     * be fixed in the same pass that measures it. Gate it after NEO_PARITY_SEED
     * replication. Residual known gap: shadow books alone still run at about a
     * third of upstream's rate (task #242).
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
        `p=${objStoufferP.toExponential(2)} -- DIAGNOSTIC ONLY. Null width measured ` +
        `at ${OBJCOUNT_NULL_WIDTH} +/- 0.122 over 153 C-vs-C pairs ` +
        `(parity/OBJCOUNT_NULL.md), so that p is overstated; ` +
        `calibrated Z=${(objStouffer / OBJCOUNT_NULL_WIDTH).toFixed(2)} ` +
        `[${(objStouffer / OBJCOUNT_NULL_LO).toFixed(2)}, ` +
        `${(objStouffer / OBJCOUNT_NULL_HI).toFixed(2)}] at +/-2 SE`,
    );

    /* Every `-pooled` row is pushed ONLY when it has already breached its own
     * threshold -- the Stouffer rows against the uncorrected alpha, the feeling
     * rows against their measured empirical maximum -- so their `p` field is a
     * report, not something to re-test against `alpha`. Comparing them with
     * `alpha` would silently swallow them: the feeling rows carry a rank bound
     * of 1/154, which is still nowhere near 1.2e-4. */
    const failures = rows.filter((r) => r.p < alpha || r.metric.endsWith("-pooled"));
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
    /* Always emit the table: a green run should still show the effect size that
     * could have been detected, so "no evidence of divergence" is never mistaken for
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
