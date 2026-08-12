# The pooled object-count null, measured

**Task #150, step 1. Measured 2026-08-12** with
[`tools/c-vs-c-objcount.mjs`](tools/c-vs-c-objcount.mjs) over six independent C
`main-stats` databases, each 1000 levels per depth, from the compiled Angband
4.2.6 oracle.

## What was in question

`parity-c-stat.test.ts` pools its twenty per-depth object-count deviates with
Stouffer, `Z = sum(z_d) / sqrt(20)`, and **prints the result without gating it**,
because the pooled statistic's null had never been measured. One run walks every
depth on a single RNG stream, so the twenty deviates are plausibly correlated,
and if they are, `sqrt(20)` is too small a denominator and the nominal p-value is
too good.

The number that raised the question: the port scores `Z = -4.29`, `p = 1.8e-5`
against the 4.2.6 gamedata, where the same measurement against the post-tag
gamedata gave `-1.78`. Two readings had to be separated before anything was done
about it — **(1)** a pooling artefact, or **(2)** a real, small, systematic
deficit in the number of objects generated.

## What was measured

Run the same instrument on pairs of runs known to come from the same generator:
the C oracle against itself, fifteen pairs from six runs.

| Estimator | Null RMS if depths were independent | Observed RMS | Inflation |
|---|---|---|---|
| In-sample SD | 1.000 (exact, by construction) | 1.404 | **1.404 ± 0.340** |
| Leave-two-out SD | 1.732 (t on 3 df) | 2.557 | 1.476 ± 0.570 |

Two estimators with different nulls and different noise, landing in the same
place. **The Stouffer null is not standard normal.** Its true width is about
1.4, so the nominal `p = 1.8e-5` was overstated by roughly two orders of
magnitude. Reading 1 is real.

### The negative control, which is why the 1.404 is believable

A control that merely passes proves nothing, so this one **removes the
mechanism** rather than supplying input assumed to be inert. The claim is that
the inflation comes from correlation *between depths*. Permuting which run
supplies each depth, independently per depth, destroys exactly that correlation
and leaves every marginal, every sample size and the estimator itself untouched.
Over 200 permutations the inflation falls to **median 0.939** — the estimator is
calibrated, and the 1.404 is not an artefact of the tool.

## What was NOT settled, and this is the finding

**Reading 1 is real but partial. It does not finish the job.**

The control's own spread is `p05 = 0.518, p95 = 1.515`. Six runs cannot separate
an inflation of 1.4 from an inflation of 1.0. Carrying that uncertainty through:

| Inflation | Calibrated Z | p |
|---|---|---|
| 1.00 (low end of ±2 SE) | −4.29 | 1.8e-5 |
| 1.40 (point estimate) | **−3.06** | 2.2e-3 |
| 2.08 (high end of ±2 SE) | −2.06 | 3.9e-2 |

The test's uncorrected alpha for a pooled row is 0.01. **That band straddles the
decision boundary**: at the point estimate and below, the deficit is real and
`#150` proceeds to step 2; at the top of the band it is noise. One end of a band
is not a verdict, and picking the end that suits the conclusion is how this
project has been wrong before.

**So step 1 has built and validated its instrument and returned "not yet
decidable at six runs".** The tool states its own resolving power and says what
would settle it: **about 17 C runs**. That is a compute cost of roughly 17
minutes per run, not a research problem.

## What must NOT be done with this yet

- **Do not gate the pooled objcount row.** The house rule is that a pooled
  statistic is not gated until its null is measured; the null is now *estimated*,
  not pinned, and gating on 1.404 ± 0.340 would turn a wide error bar into a
  hard threshold. That is the same mistake as gating it at 1.0 was, one notch
  smaller.
- **Do not "mitigate" anything in core.** The 2026-08-09 ruling was "mitigate if
  needed", conditional on separating the two readings first. They are not yet
  separated. A change to faithful core made for a statistic still inside its own
  error bar would be a parity change bought with nothing.

## Reproducing

```bash
node parity/tools/c-vs-c-objcount.mjs run-a.db run-b.db run-c.db ...
```

The databases are the C oracle's `lib/user/stats/*.db`, generated with
`angband.exe -mstats -- -q -n1000`. On Windows that binary needs the MinGW
runtime (`libsqlite3-0.dll`) on `PATH`, and without it the failure is exit 127
with no database written — which looks precisely like a run that was never
started, so check for the new file rather than trusting the exit status.

`main-stats` names its database by a **minute-resolution timestamp**. Two runs
finishing in the same minute overwrite each other silently, and the loss is
invisible: you get one fewer database and no error. Stagger concurrent runs.

## Related

- The port's levels already rate **richer** than the C's on object *feeling*
  (pooled G/df = 2.70 at 1000, strengthening with n, which is what makes that one
  real). Quantity was believed to match. If reading 2 survives more runs, quantity
  does not match either and the two findings are one finding.
- `588bf5589` (upstream's room-template deduplication) is a standing **do not
  adopt**; neither #148 nor #150 can be compared against a tree that has taken it.
- [`tools/c-vs-c-all-pairs.mjs`](tools/c-vs-c-all-pairs.mjs) is the sibling that
  does the same job for the *feeling* histograms via a G-test. It measures a
  different statistic and cannot answer this question — the shared thing is the
  method, not the file.
