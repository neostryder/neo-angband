/**
 * Hypothesis tests for cross-implementation distribution parity.
 *
 * Why this exists. The C-vs-TS parity gate used a fixed abs/rel tolerance
 * ("within 5%, or 2 whole monsters"), which is not a statement about the data:
 * monster count per generated level has a standard deviation around 17 on a mean
 * around 46, because the count depends on which rooms the level happens to grow.
 * At 100 sampled levels the standard error of the mean is therefore ~1.7, so a
 * ±2 window sits barely above one standard error and the gate flickers on noise.
 * That is exactly what happened: the S-2 "depth 6-8 density divergence" reported
 * four failures whose values all sit inside the port's own seed-to-seed spread
 * (measured 2026-07-25: depth 6 ranged 42.91-46.98 across four base seeds, with
 * the C's 46.47 inside that range).
 *
 * A tolerance cannot distinguish "the generators differ" from "not enough
 * levels were sampled". A hypothesis test can, and it states its own resolving power,
 * so the honest answer to a small sample is "no evidence of divergence yet, and
 * here is the effect size that could have been detected".
 *
 * Two tests, matched to the two shapes of metric:
 *   - a two-sample z-test on per-level MEANS (density, gold), with the variance
 *     estimated from the port side. Under the null hypothesis the two
 *     implementations are the same generator, so they share a variance, and only
 *     the port can report one -- the C `main-stats` database stores totals per
 *     level, not per-run samples.
 *   - a G-test (likelihood-ratio goodness of fit) on DISTRIBUTIONS -- monster
 *     species, level feelings, gold origin. One test over the whole histogram is
 *     the right instrument; 100 independent per-category tolerance checks are
 *     not, because at any sane per-test error rate a few of them fail by
 *     construction.
 *
 * Multiplicity is handled by the caller via `bonferroni`: with dozens of
 * (depth x metric) tests, an uncorrected 5% threshold produces a failure per
 * run and teaches everyone to ignore the gate.
 *
 * No external dependency: the numerics below are the standard Chebyshev erfc and
 * incomplete-gamma routines, accurate to ~1e-7 relative, which is far finer than
 * any decision made from these p-values.
 */

/** Complementary error function; fractional error < 1.2e-7 (Numerical Recipes). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 0.6419697923564902, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11,
    2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15,
  ];
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j--) {
    const tmp = d;
    d = ty * d - dd + cof[j]!;
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0]! + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** Two-tailed p-value for a standard normal deviate. */
export function normalTwoTailedP(z: number): number {
  return erfc(Math.abs(z) / Math.SQRT2);
}

/** ln(Gamma(x)) via the Lanczos approximation. */
function lnGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941678, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of cof) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310007 * ser) / x);
}

/** Regularized incomplete gamma Q(a,x) = 1 - P(a,x). */
function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new RangeError(`gammaQ(${a}, ${x})`);
  if (x === 0) return 1;
  const gln = lnGamma(a);
  if (x < a + 1) {
    /* Series representation for P(a,x). */
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  /* Continued fraction (modified Lentz) for Q(a,x). */
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Upper-tail probability of a chi-square statistic with `df` degrees of freedom. */
export function chiSquareUpperTail(x: number, df: number): number {
  if (df <= 0) return 1;
  if (x <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

/** One mean comparison. */
export interface MeanTest {
  /** Difference of means, port minus reference. */
  delta: number;
  /** Standard error of that difference. */
  se: number;
  /** Standardised deviate. */
  z: number;
  /** Two-tailed p-value. */
  p: number;
  /**
   * The smallest |delta| this sample could have called significant, i.e. the
   * test's resolving power. Reported so a pass never reads as "identical" when
   * it only means "a difference this small could not have been seen".
   */
  resolution: number;
}

/**
 * Two-sample z-test on per-level means, with a shared standard deviation
 * estimated from the port side (valid under the null hypothesis that both
 * implementations are the same generator).
 *
 * `sd` is the per-level standard deviation, not the standard error.
 */
export function meanTest(args: {
  refMean: number;
  refN: number;
  portMean: number;
  portN: number;
  sd: number;
  /** Significance level used only to report `resolution`. Default 0.05. */
  alpha?: number;
}): MeanTest {
  const { refMean, refN, portMean, portN, sd } = args;
  const alpha = args.alpha ?? 0.05;
  const delta = portMean - refMean;
  const se = sd * Math.sqrt(1 / Math.max(refN, 1) + 1 / Math.max(portN, 1));
  const z = se > 0 ? delta / se : 0;
  /* Critical |z| for the two-tailed alpha, by bisection on erfc -- avoids
   * hard-coding 1.96 so a Bonferroni-shrunk alpha is handled correctly. */
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normalTwoTailedP(mid) > alpha) lo = mid;
    else hi = mid;
  }
  return { delta, se, z, p: normalTwoTailedP(z), resolution: se * hi };
}

/** One distribution comparison. */
export interface DistributionTest {
  /** Likelihood-ratio statistic. */
  g: number;
  df: number;
  p: number;
  /** Categories compared after pooling rare ones. */
  categories: number;
  /** Categories folded into a pooled bucket because their expectation was small. */
  pooled: number;
  /** The single largest contributor to G, for diagnosis. */
  worst: { category: string; observed: number; expected: number } | null;
}

/**
 * Two-sample G-test (likelihood-ratio test of homogeneity) over a 2 x k
 * contingency table: are these two histograms draws from the same distribution?
 *
 * Deliberately NOT a goodness-of-fit test against the reference as if it were
 * exact. The C baseline is itself a finite sample (200 generated levels per
 * depth), so treating its proportions as known truth understates the variance and
 * inflates G -- by roughly a factor of two when both samples are the same size.
 * The homogeneity form puts both samples' sampling error into the expectations,
 * which is the honest question anyway: "do these two generators agree", not "does
 * the port match a fixed table".
 *
 * Categories whose combined count falls below `minExpected` are pooled into one
 * bucket, the standard remedy for the chi-square family's behaviour in sparse
 * cells: with ~620 monster races, most species are individually far too rare to
 * test alone, but their collective weight still matters and pooling keeps it in
 * the statistic instead of discarding it.
 *
 * Degrees of freedom are (categories - 1), from (2-1)(k-1).
 */
export function distributionTest(
  observed: Readonly<Record<string, number>>,
  reference: Readonly<Record<string, number>>,
  opts: { minExpected?: number } = {},
): DistributionTest {
  const minExpected = opts.minExpected ?? 5;
  const refTotal = Object.values(reference).reduce((a, b) => a + b, 0);
  const obsTotal = Object.values(observed).reduce((a, b) => a + b, 0);
  if (refTotal <= 0 || obsTotal <= 0) {
    return { g: 0, df: 0, p: 1, categories: 0, pooled: 0, worst: null };
  }
  const n = refTotal + obsTotal;

  const keys = new Set([...Object.keys(reference), ...Object.keys(observed)]);
  let pooledObs = 0;
  let pooledRef = 0;
  let pooled = 0;
  const cells: { key: string; obs: number; ref: number }[] = [];
  for (const k of keys) {
    const ref = reference[k] ?? 0;
    const obs = observed[k] ?? 0;
    /* Pool on the column total: a category is testable when the two samples
     * together supply enough mass, regardless of which side supplied it. */
    if (ref + obs < minExpected * 2) {
      pooledObs += obs;
      pooledRef += ref;
      pooled++;
    } else {
      cells.push({ key: k, obs, ref });
    }
  }
  /* The pooled bucket is always kept, even when small. Dropping it would break
   * the marginal totals the expectations are built from, and G could then come
   * out NEGATIVE -- which it did, for the depth-2 object feelings, before this
   * was fixed. */
  if (pooled > 0) {
    cells.push({ key: `<pooled:${pooled}>`, obs: pooledObs, ref: pooledRef });
  }

  let g = 0;
  let worst: DistributionTest["worst"] = null;
  let worstContrib = 0;
  for (const c of cells) {
    const col = c.obs + c.ref;
    if (col <= 0) continue;
    const expObs = (col * obsTotal) / n;
    const expRef = (col * refTotal) / n;
    /* A cell with a zero count contributes nothing (0 * ln 0 -> 0). */
    const contrib =
      2 *
      ((c.obs > 0 ? c.obs * Math.log(c.obs / expObs) : 0) +
        (c.ref > 0 ? c.ref * Math.log(c.ref / expRef) : 0));
    g += contrib;
    if (contrib > worstContrib) {
      worstContrib = contrib;
      /* Report the reference count rescaled to the port's sample size, so the
       * reader can compare "expected" against "observed" directly. */
      worst = { category: c.key, observed: c.obs, expected: (c.ref * obsTotal) / refTotal };
    }
  }
  const df = Math.max(cells.length - 1, 0);
  return { g, df, p: chiSquareUpperTail(g, df), categories: cells.length, pooled, worst };
}

/** Bonferroni-corrected significance level for `k` simultaneous tests. */
export function bonferroni(alpha: number, k: number): number {
  return k > 0 ? alpha / k : alpha;
}

/** One metric's evidence pooled across every depth. */
export interface PooledTest {
  /** Sum of the per-depth G statistics. */
  g: number;
  /** Sum of the per-depth degrees of freedom. */
  df: number;
  p: number;
  /**
   * `g / df`. The most interpretable number here, but read it against the
   * MEASURED null rather than against 1.0: chi-square has mean `df`, so 1.0 is
   * the theoretical expectation, and these histograms do not meet it. Two
   * independent 1000-run samples of the same C binary give ratio 1.76 on
   * obj_feelings and 1.95 on mon_feelings, so a port ratio of 1.8 is ORDINARY,
   * not an eight-sigma finding. See `dispersion`.
   */
  ratio: number;
  /** How many per-depth tests contributed. */
  k: number;
  /** The dispersion `phi` the p-value was corrected by; 1 means uncorrected. */
  dispersion: number;
}

/**
 * Pool one metric's per-depth G-tests into a single hypothesis.
 *
 * Why this exists. A per-depth gate answers "does this metric differ AT DEPTH
 * d", which is not the question anyone is asking, and it answers it badly: the
 * feeling metrics are histograms of a binned quantity, so a smooth systematic
 * bias only becomes visible at whatever depths happen to straddle a bin edge.
 * That set is a property of the RNG stream, not of the generator. Measured
 * 2026-07-26: the surviving objFeel depths moved from {13, 16, 19} to {11, 12}
 * when an unrelated change shifted the stream, sharing not one depth, while the
 * POOLED excess stayed put. Chasing the per-depth identity is chasing a seed.
 *
 * Chi-square is additive over independent tests, so `sum(G) ~ chi2(sum(df))`.
 * Pooling therefore costs nothing and buys roughly `sqrt(k)` times the power
 * against a systematic bias -- the same argument the Stouffer combination makes
 * for density, and the same reason it is ONE hypothesis taking an uncorrected
 * alpha.
 *
 * The additivity assumes the per-depth tests are independent, which is not free:
 * within a run the port generates one level per depth from a single sequential
 * RNG stream. That assumption was therefore MEASURED rather than asserted -- and
 * the first measurement of it was WRONG, so read this carefully.
 *
 * The port compared against ITSELF at two seeds pools objFeel to G = 132.9 on
 * 140 df, a ratio of 0.95, which looks like the textbook expectation. It is not
 * the null for a port-vs-C comparison. Two runs of one implementation share every
 * structural quirk that implementation has; two independent samples do not. The
 * real null, measured between six 1000-run C `main-stats` databases -- 15
 * unordered pairs, `tools/c-vs-c-all-pairs.mjs` -- is:
 *
 *     objFeel  G/df  mean 1.94  sd 0.31  range 1.56-2.49
 *     monFeel  G/df  mean 1.82  sd 0.18  range 1.45-2.21
 *
 * roughly TWICE the port-vs-itself figure. Hence the `dispersion` parameter: pass
 * the measured phi and this returns `chi2(G/phi, df)`. Leaving it at 1 asserts
 * phi = 1, which for these histograms is false. Note also that G/df is NOT
 * sample-size invariant -- G grows with n for a fixed distributional difference --
 * so a ratio measured at 400 runs cannot be judged against a null measured
 * between two 1000-run samples. See
 * `parity/phase3-2026-07-25/findings/NOISE-FLOOR.md` ("The null was mismeasured")
 * and `OBJFEEL.md` sections 7-9.
 *
 * The same measurement is why `species` is NOT pooled and NOT gated: it runs
 * 2.5-5.0x overdispersed per depth because a single pit or nest drops 20-60
 * monsters of one theme onto one level, so its effective sample size is levels
 * rather than monsters. Pooling inherits that inflation exactly; it would turn a
 * void metric into a confidently void metric.
 */
export function poolDistributionTests(
  tests: readonly DistributionTest[],
  dispersion = 1,
): PooledTest {
  let g = 0;
  let df = 0;
  for (const t of tests) {
    g += t.g;
    df += t.df;
  }
  const phi = dispersion > 0 ? dispersion : 1;
  return {
    g,
    df,
    /*
     * Quasi-likelihood correction: G/phi is referred to chi2(df), where phi is
     * the MEASURED dispersion of this statistic under a true null. Without it
     * the p-value assumes phi = 1, which for these histograms is simply false
     * -- two independent 1000-run samples of the SAME C binary pool to
     * G/df = 1.76 on obj_feelings and 1.95 on mon_feelings
     * (parity/phase3-2026-07-25/tools/c-vs-c-null.mjs). Reporting an
     * uncorrected p here would overstate every result by many orders of
     * magnitude.
     */
    p: chiSquareUpperTail(g / phi, df),
    ratio: df > 0 ? g / df : 0,
    dispersion: phi,
    k: tests.length,
  };
}
