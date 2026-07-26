# Noise floor of the generation distribution metrics

Date: 2026-07-25
Code: `master` @ `a848f310e` (pre-fix), built with `pnpm build` before the run.
Probe: `packages/cli/src/noise-floor.probe.test.ts`
Raw output: `noise-floor-raw.txt`

## What was measured and why

`parity-c-stat.test.ts` compares the port's per-depth histograms against the C
oracle with a G-test. That only means something if we know how large G gets when
**nothing** is different. Nobody had ever measured that, so every G in this
project has been interpreted against an assumed null instead of a measured one.

The probe runs the port against **itself at two different seeds**, in the same
sample shape as the real comparison (1000 reference levels vs 400 observed
levels per depth, since G scales with n). Identical code, so every difference is
seed noise by construction. `G_null` is the result; `G_real` is the same depth's
port-vs-C value for comparison.

## Result 1 — the species metric is void

| | mean G_null | max G_null | mean G_real | mean G_real/G_null |
|---|---:|---:|---:|---:|
| species | **572.7** | **949.3** | 567.3 | **0.99** |

The port compared against itself produces G values **statistically
indistinguishable from, and on average very slightly larger than**, the port
compared against C. At depth 11 the port-vs-itself G is 949.3 on 201 df —
`p = 2e-97`. Against itself.

`G/df` runs **2.5–5.0** at every depth from 5 down, i.e. 3–5x overdispersion,
exactly as the clustering argument predicted: a single pit or nest drops 20–60
monsters of one theme onto one level, so the effective sample size is the number
of LEVELS, not the number of monsters, and a G-test that treats monsters as
independent observations is inflated by roughly that clustering factor.

Consequences, all of them load-bearing:

- **S-3 never existed.** The species divergence (`p` to 4.8e-98) is the same
  magnitude this metric produces from seed noise alone. Withdrawing it was
  correct; this is the quantitative proof rather than the argument.
- **The entire `S3-BISECT.md` matrix is void.** Its verdicts ("RC1 HURTS, mean
  delta-G +25.0", "RC3 HURTS +34.6", "friends HURTS +23.1", "room templates
  HURTS +17.0") are differences of 17–35 against a metric whose own noise is
  **±570 with a range of 950**. Every one of those verdicts is a coin flip.
  Nothing may be accepted or rejected on their basis.
- The species histogram **cannot be used as a parity gate at all**, at any
  sample size that clustering survives. Fixing it would require aggregating per
  level (e.g. one species-vector per level, then a permutation test over levels)
  rather than pooling monsters.

## Result 2 — monster feeling shows no divergence

| | mean G_null | max G_null | mean G_real | mean G_real/G_null |
|---|---:|---:|---:|---:|
| monFeel | 8.2 | 19.8 | 6.6 | 0.80 |

`G/df` is ~1, so this metric is **not** overdispersed and the G-test is valid
for it — one value per level means independent observations. And `G_real` sits
*below* the noise floor at almost every depth. There is no monster-feeling
divergence to chase.

## Result 3 — object feeling is real, and wider than recorded

> **SUPERSEDED 2026-07-26 as a calibration, not as a signal.** The per-depth
> numbers below stand as measurements, but the null they are judged against is
> the WRONG null: it is the port against itself. See "The null was mismeasured"
> at the end of this document, and `OBJFEEL.md` sections 7-9 for the resolution.
> The finding itself turned out to be real — the cause was `parse_random`'s
> negation in the shipped data, not the generator.

| | mean G_null | max G_null | mean G_real | mean G_real/G_null |
|---|---:|---:|---:|---:|
| objFeel | 6.7 | **14.9** | 15.8 | **2.38** |

`G/df` is 0.2–2.1 — again no meaningful overdispersion, so this metric is
trustworthy. The measured null tops out at **14.9 across all 20 depths**, and
these depths exceed it:

| depth | G_real | p | G_real / G_null |
|---:|---:|---:|---:|
| 13 | 36.5 | 5.95e-6 | 7.7 |
| 16 | 34.7 | 3.02e-5 | 3.1 |
| 19 | 32.4 | 3.48e-5 | 2.5 |
| 10 | 26.4 | 4.24e-4 | **11.6** |
| 11 | 23.9 | 1.20e-3 | 2.8 |
| 14 | 20.7 | 4.16e-3 | 6.2 |
| 15 | 17.7 | 1.35e-2 | 14.4 |
| 12 | 17.4 | 8.02e-3 | 5.7 |

Under the strict Bonferroni the real test applies (20 depths x 4 metrics,
alpha = 0.01 -> 1.25e-4), the survivors are **depths 13, 16 and 19**. Depths 10,
11, 12, 14 and 15 clear the *measured* null's maximum but not the corrected
parametric threshold.

So the recorded finding — "object level feeling diverges at depths 11, 12, 16" —
is **real but mis-scoped**. Depth 16 holds. Depths 11 and 12 are weaker than
depths **13 and 19**, which were not recorded at all, and depth 10 has the
largest excess over its own null of any depth measured.

### Caveat on the null

This is **one** null replicate per depth (a single seed pair), so `max G_null`
= 14.9 is a rough read of the null's upper tail, not a calibrated critical
value. Before treating the boundary depths (10, 11, 12, 14, 15) as findings,
run the probe over several seed pairs and take a per-depth upper quantile.
Depths 13, 16 and 19 do not depend on that refinement — they survive the
corrected parametric test on their own.

## What to do with this

1. Object generation is the one live generation finding. Investigate value and
   quantity — `obj-make.c` allocation tables, ego/artifact rates, the good/great
   rolls — **not** monster selection.
2. Judge the S-3 fix batch (RC1, RC3, the prepend-order changes) purely on
   code-vs-C evidence. The statistic has no vote.
3. Keep this probe. Any future distribution gate must state its measured
   resolving power before its p-value is quoted.

## The null was mismeasured (added 2026-07-26)

Point 3 above was right and this document broke its own rule. A **port-vs-itself**
null is not the null for a **port-vs-C** comparison, and the difference is not
small.

Two runs of one implementation share every structural quirk that implementation
has: the same allocation tables walked in the same order, the same rounding, the
same tie-breaks. Two *independent* samples — the port and the C — do not. So
port-vs-itself measures seed noise alone and systematically UNDERSTATES how far
apart two correct implementations can land.

Measured, six 1000-run C `main-stats` databases → 15 unordered pairs
(`tools/c-vs-c-all-pairs.mjs`):

| pooled statistic | port vs itself (this doc) | **C vs C, 15 pairs** |
|---|---:|---:|
| objFeel G/df | 0.95 | **1.94** (sd 0.31, range 1.56–2.49) |
| monFeel G/df | — | **1.82** (sd 0.18, range 1.45–2.21) |

The real null is roughly **twice** the one this probe reports. Three further
consequences, each of which cost a wrong claim before it was noticed:

- **`G/df` is not sample-size invariant.** G grows with n for a fixed
  distributional difference, so a 400-run ratio cannot be compared with a null
  measured between two 1000-run samples. `parity-c-stat.test.ts` now skips the
  pooled feeling assertion unless `PORT_RUNS === cLevels`.
- **The parametric tail is untrustworthy out at 1e-4** for these histograms,
  because the null's observed spread exceeds what a scaled chi-square at ~140 df
  predicts. Fifteen replicates buy a rank-based one-sided resolution of about
  1/16 ≈ 0.06 and no more.
- Judging a statistic against a null this probe produces requires the
  quasi-likelihood correction `G/φ` referred to `chi2(df)`, with φ the measured
  dispersion. Reading G against `chi2(df)` directly assumes φ = 1, which for
  these histograms is simply false.

What this probe is still good for: **the species result**. Result 1 does not
depend on the calibration being right, because port-vs-itself G came out
*larger* than port-vs-C G (ratio 0.99) — a metric that cannot distinguish a
sample from itself is void whichever null you prefer. That is the finding worth
keeping, and it is why the probe survives.

The probe is now **opt-in** (`NEO_NOISE_PROBE=1`) rather than part of the default
`cli` glob: it asserts only that it ran, and its two `runStatsBatch` calls used to
sit at module scope, so the ~10 minutes they cost landed in vitest COLLECTION
where no per-test timeout applies and nothing reported as slow. Both batches now
run inside the test with an explicit timeout.
