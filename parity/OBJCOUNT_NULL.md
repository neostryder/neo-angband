# The pooled object-count null, measured

> ## ANSWERED, 2026-08-12: it was the instrument
>
> The pooled deficit was **the stats harness generating no spellbooks at all**,
> not the generator generating too few items. Spellbook kinds are not in
> `object.txt`; `write_book_kind` (init.c L208) synthesises one per class.txt
> `book:` record. `startGame` and `loadGame` call `registerBookKinds` for exactly
> that reason — **`runStatsBatch` never did**, so its allocation table held no
> books and every measured level was short 0.92 items the C oracle placed.
>
> | port objects/level vs the C oracle, 20 000 levels | delta |
> | ------------------------------------------------- | ------ |
> | as measured through this whole document            | −1.61% |
> | with book kinds registered in the harness          | −0.23% |
> | with `KF_GOOD` restored on dungeon books too       | **−0.10%** |
>
> Two fixes, one in the instrument and one in core:
>
> 1. **The harness.** `bindForGeneration` (packages/cli/src/stats.ts) is now the
>    one door every headless generation harness binds through: `bindCore` +
>    `registerBookKinds`, plus the `obj_kind_can_browse` foil main-stats' Human
>    Warrior implies. Four call sites needed the same two lines and all four were
>    missing them, which is why the fix is a door and not four patches.
> 2. **Core, a real defect the harness exposed.** `registerBookKinds` never
>    applied init.c L269-275, so dungeon spellbooks carried neither `KF_GOOD` nor
>    `EL_INFO_IGNORE`. Without `KF_GOOD` no dungeon book can be in the GREAT
>    allocation table, so none could ever come from a vault, a labyrinth or
>    cavern `TYP_GOOD`, a `DROP_GOOD` monster, or any `make_object` called with
>    `good`. Without `EL_INFO_IGNORE` acid and fire destroy books upstream
>    spares. This one shipped to players.
>
> **What survives:** the measured null width (1.155 ± 0.122 over 153 C-vs-C
> pairs) and the feeling nulls. Those are properties of the C oracle and the
> statistic, and a bug on the port side does not touch them.
>
> **What is superseded:** every conclusion below about *where the deficit lives*.
> The depth-band table, the "multiplicative, therefore in shared allocation"
> reading, and the generator-bisect costing were all reasoning about an artefact.
> They are left in place because the failure is the useful part — see
> [Ruled out first](#ruled-out-first-a-measurement-asymmetry-and-the-asymmetry-that-was-not-checked),
> which asserted the instrument had been cleared and had cleared only one way it
> could be wrong.
>
> **What is left open:** shadow books alone still run at about a third of
> upstream's rate (task #242). The other three book tvals now match to under 2%.

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

## Where it is: everywhere, and below every per-depth test's resolution

Per-depth object counts at seed 1337, 1000 runs (the rows the test already
prints):

| Band          | C items/level | port  | delta | relative |
| ------------- | ------------- | ----- | ----- | -------- |
| depths 1–6    | 17.62         | 17.38 | −0.24 | −1.3%    |
| depths 7–13   | 21.50         | 21.20 | −0.30 | −1.4%    |
| depths 14–20  | 25.17         | 24.67 | −0.50 | −2.0%    |
| **all 20**    | 21.62         | 21.27 | −0.35 | **−1.6%** |

**16 of 20 depths are negative** (the four positive ones are 1, 7, 8, 9, and the
largest is +0.08). The deficit is roughly constant as a *fraction*, drifting from
1.3% to 2.0% with depth, which is the signature of something multiplicative —
every level gets slightly fewer items — rather than a fault localised in one
depth band, one room type or one feature.

### Why no per-depth test ever caught it

The `resolves +/-` column is what each depth can detect at its own alpha. It runs
from ±0.75 at depth 1 to ±2.51 at depth 20. **The effect is inside that band at
every single depth**, and the largest per-depth |z| in the whole sweep is 2.88 at
depth 13, which does not clear the Bonferroni-corrected alpha of 1.25e-4. So the
twenty gated per-depth tests are not merely silent here — they *cannot* speak. A
1.6% shift is far below their resolution and always was.

That is the justification for the pooled row existing at all, and it is worth
being explicit about because the same fact cuts the other way on the next step.

### Ruled out first: a measurement asymmetry, and the asymmetry that was not checked

> **This section was wrong, and it is the most useful thing in the file.** What
> it says about money is still true. What it concluded from that — "the deficit
> is in the game, not in the instrument" — was false, and it stood for a day and
> steered the whole investigation into the generator.

A uniform proportional deficit is exactly what a counting mismatch would look
like, so that was checked before anything else. Money is excluded on **both**
sides — the port skips `TV_GOLD` before counting, and the C importer subtracts
the money kinds back out of `consumables` because the C double-books them. The
comparison is real items against real items.

That much holds. The error was in the word *first*: one instrument asymmetry was
checked and the instrument was then treated as cleared. **Clearing one way a
measurement can be wrong is not clearing the measurement.** The asymmetry that
was actually there was not in the counting at all — it was upstream of it, in
what the harness had to count. The two sides were not generating from the same
kind table, because `runStatsBatch` never registered the spellbook kinds.

The generalisable form: the counting code was compared line for line and the
*inputs to the counting code* were assumed identical. A comparison is only as
sound as the least-examined thing both sides share, and "both sides count the
same way" says nothing about whether both sides had the same things to count.

What would have caught it in minutes, and is now the first thing to do with any
distribution mismatch: **print the per-category breakdown before theorising about
the total.** One tval-by-tval diff showed four tvals at exactly zero against the
oracle's non-zero. There was never a 1.6% shortfall spread across everything;
there was a 100% shortfall in four categories and a small surplus everywhere
else, and the aggregate had been hiding it the entire time.

### What this does to the generator bisect

> Moot: there was no generator fault to bisect. Kept for the resolution
> argument, which is a real property of the test and still governs any future
> per-depth split.

The plan was to split by generator — classic, modified, cavern, labyrinth — and
find the guilty one. **That plan cannot work as a per-depth bisect.** Splitting
into four subsets divides the data four ways, and the effect is already below the
resolution of the *undivided* per-depth tests. Each cell would resolve less than
nothing.

The bisect has to be done at the pooled level instead: one Stouffer statistic per
generator, across depths, and each of those four needs its own C-vs-C null
measured the same way this one was. That is four more instruments, not four more
columns, and it should be costed before it is started.

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
