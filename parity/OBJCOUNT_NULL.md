# The pooled object-count null, measured

**Task #150, step 1. Measured 2026-08-12** with
[`tools/c-vs-c-objcount.mjs`](tools/c-vs-c-objcount.mjs) over **eighteen**
independent C `main-stats` databases, each 1000 levels per depth, from the
compiled Angband 4.2.6 oracle.

> **First measured at six runs, and six was not enough.** That pass returned an
> inflation of 1.404 ± 0.340 and a band wide enough to straddle the decision.
> Twelve more runs were generated and the estimate moved to **1.155 ± 0.122**.
> The six-run figure was high by two standard errors. It is left visible here
> because the lesson is the transferable part: the tool reported its own
> resolving power, that report said "about 17 runs", and following it changed
> the conclusion rather than confirming it.

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
the C oracle against itself, **153 pairs from 18 runs**.

| Estimator        | Null RMS if depths were independent | Observed RMS | Inflation         |
| ---------------- | ----------------------------------- | ------------ | ----------------- |
| In-sample SD     | 1.000 (exact, by construction)      | 1.155        | **1.155 ± 0.122** |
| Leave-two-out SD | 1.074 (t on 15 df)                  | 1.241        | **1.155 ± 0.124** |

Two estimators with different nulls, different bias structure and different
noise, agreeing to three decimal places. **The Stouffer null is not standard
normal** — but the inflation is about 1.16, not the 1.4 the first pass
suggested. The mean also settled to −0.15, which is what exchangeability
predicts and what the six-run pass (+1.01) could not show.

### The negative control, which is why the number is believable

A control that merely passes proves nothing, so this one **removes the
mechanism** rather than supplying input assumed to be inert. The claim is that
the inflation comes from correlation _between depths_. Permuting which run
supplies each depth, independently per depth, destroys exactly that correlation
and leaves every marginal, every sample size and the estimator itself untouched.
Over 200 permutations the inflation falls to **median 0.995** (`p05 = 0.714,
p95 = 1.308`) — the estimator is calibrated, and the 1.155 is not an artefact of
the tool.

## What this settles

**Reading 1 is real and small. It does not come close to accounting for the
port's −4.29.**

Carrying the ±2 SE band on the inflation through:

| Inflation                  | Calibrated Z | p      |
| -------------------------- | ------------ | ------ |
| 1.00 (low end)             | −4.29        | 1.8e-5 |
| **1.155** (point estimate) | **−3.71**    | 2.1e-4 |
| 1.40 (high end)            | −3.07        | 2.2e-3 |

The test's uncorrected alpha for a pooled row is 0.01. **Every point in that band
clears it.** Unlike the six-run pass, the conclusion no longer depends on where
in the band the truth sits — which is the only form in which this measurement is
worth anything.

The blunter statement: across all 153 C-vs-C pairs, **the largest |Z| ever
observed is 2.393**. The port's −4.29 is outside the entire empirical range of
the null, not merely in its tail.

**So reading 2 survives step 1: the pooled deficit is not a pooling artefact.**
That promotes #150 to a parity question about the generator, and by the standing
rule a parity defect is fixed in core, not mitigated in a mod.

## What must still NOT be done with it

- **Do not gate the pooled objcount row yet.** The null is now well estimated,
  but the thing being judged is still a single port sample. Gate it after the
  replication below, not before — a gate whose threshold and whose subject were
  fixed in the same pass has never been tested against anything.
- ~~**Do not touch core until the port's Z replicates.**~~ **Discharged
  2026-08-12** — it replicated at three seeds, see above. What that licenses is
  looking for the cause in core, not changing core: the finding is "fewer
  objects", and nothing yet says *where*.

## It replicates

Three base seeds, 1000 port runs each, against the same C baseline
(`NEO_PARITY_SEED`, added for exactly this):

| Base seed | Raw Z     | Calibrated (÷1.155) | Beyond the C-vs-C empirical max (2.393)? |
| --------- | --------- | ------------------- | ---------------------------------------- |
| 1337      | **−4.29** | −3.72               | yes                                       |
| 24601     | **−3.73** | −3.23               | yes                                       |
| 90210     | **−2.58** | −2.24               | marginally                                |
| mean      | **−3.53** | −3.06               |                                           |

Every seed is negative, and the spread across them (SD 0.87) is what a null of
width 1.155 predicts. Three draws scattered about **−3.5**, not about 0. The
sign is unanimous and the weakest seed still lands outside the largest |Z| seen
in 153 C-vs-C pairs. **Reading 2 is confirmed: the port generates fewer objects
than 4.2.6 does.**

> **Do not combine the three into a √3 improvement.** They share one fixed C
> baseline, so the C-side error is common to all three and does not average
> down; the naive pooled "−5.3σ" is not available from this design. Varying the
> C side as well is a different and much more expensive experiment, and nothing
> here needs it — the per-seed numbers already clear the bar on their own.

## The port's own Z, and a trap in reading it

|                  | post-tag gamedata | 4.2.6 gamedata |
| ---------------- | ----------------- | -------------- |
| 400 port runs    | −2.66             | **−4.17**      |
| 1000 port runs   | −1.78             | **−4.29**      |

Under the post-tag data the statistic **shrank** with two and a half times the
evidence, which is the signature of noise and is why it was ungated. Under 4.2.6
it does not shrink. That change of behaviour, not the size of either number, is
what makes #150 a question worth asking.

> **`vitest run | grep` prints nothing, and exits 0.** Vitest intercepts
> `console.log` and the default reporter drops it for a passing test, so the
> whole report — the only output this test produces — vanishes. The first
> replication batch here returned `Test Files 1 passed` three times, exit code 0,
> and **contained no measurement at all**; it looks exactly like a batch that
> replicated cleanly. Pass `--disable-console-intercept=true`, and check for the
> `Stouffer` line rather than for a green run.
>
> Put the flag **before** the test path or write it as `=true`. Bare
> `--disable-console-intercept packages/cli/src/parity-c-stat.test.ts` consumes
> the path as the flag's value, so the filter disappears and the entire 502-file
> suite runs instead of the one file. It still passes, so nothing complains.

## Reproducing

```bash
node parity/tools/c-vs-c-objcount.mjs run-a.db run-b.db run-c.db ...
```

The databases are the C oracle's `lib/user/stats/*.db`, generated with
`angband.exe -mstats -- -q -n1000`. On Windows that binary needs the MinGW
runtime (`libsqlite3-0.dll`) on `PATH`, and without it the failure is exit 127
with no database written — which looks precisely like a run that was never
started, so check for the new file rather than trusting the exit status.

`main-stats` names its database by a **minute-resolution timestamp**, and it
creates the file when the run _starts_. Two runs starting in the same minute
overwrite each other silently, and the loss is invisible: you get one fewer
database and no error. Stagger concurrent runs — 100 seconds apart was enough
for three workers.

A run is ~17 minutes at `-n1000`, so eighteen databases is a few hours of one
machine and nothing else. Check each new file has 1000 levels at depth 1 before
using it; an interrupted run leaves a valid but empty database, and the tool
prints levels-per-depth for exactly that reason.

## A note on the feeling nulls, found while doing this

Re-running the sibling [`c-vs-c-all-pairs.mjs`](tools/c-vs-c-all-pairs.mjs) over
the same eighteen runs corrected the **gated** `FEEL_NULL` constants, which had
been measured from six runs / fifteen pairs:

|         | old (15 pairs)         | new (153 pairs)        |
| ------- | ---------------------- | ---------------------- |
| objFeel | phi 1.94, **max 2.49** | phi 1.79, **max 2.60** |
| monFeel | phi 1.82, **max 2.21** | phi 1.93, **max 2.54** |

Both maxima were too low, monFeel's by 15%, and `max` is what the test gates on
— so the old threshold could have failed a port that matches the C. The two
statistics also swapped order, which is a plain signal that neither was
resolved at fifteen pairs. The port's objFeel excess (2.70) still clears the new
maximum, so that finding stands, but by 0.10 rather than 0.21.

## Related

- The port's levels already rate **richer** than the C's on object _feeling_
  (pooled G/df = 2.70 at 1000, strengthening with n, which is what makes that one
  real). Quantity was believed to match. If reading 2 survives more runs, quantity
  does not match either and the two findings are one finding.
- `588bf5589` (upstream's room-template deduplication) is a standing **do not
  adopt**; neither #148 nor #150 can be compared against a tree that has taken it.
- [`tools/c-vs-c-all-pairs.mjs`](tools/c-vs-c-all-pairs.mjs) is the sibling that
  does the same job for the _feeling_ histograms via a G-test. It measures a
  different statistic and cannot answer this question — the shared thing is the
  method, not the file.
