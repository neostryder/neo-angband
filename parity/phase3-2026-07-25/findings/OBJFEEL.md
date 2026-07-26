# objFeel: NOT ESTABLISHED. The null was mismeasured; see section 7 first.

> **Read section 7 before anything else.** Sections 1-6 were written against a
> null of 0.95 x df, measured port-against-ITSELF. The real null, measured
> between two independent 1000-run samples of the SAME upstream C binary, is
> **1.76 x df**. Every sigma figure below is inflated by that error, and the
> headline claim does not survive it at the harness's default sample size. The
> earlier sections are kept because their reasoning about POOLING and about
> quantity-versus-value is unaffected and still correct.

# (historical) objFeel: the divergence is real, and it is a depth BAND

Date: 2026-07-26
Code: `p3/s3-fix` @ `f2c50dbc8` (== `master` @ `78e2fe4c9`)
Task: #31
Sample: 400 port levels vs 1000 C levels per depth, depths 1-20

## 0. The question this answers

"Was the sample big enough to be certain objFeel is a true divergence?"

**Yes for the existence of the divergence — overwhelmingly. No for the per-depth
attribution, which was never a real finding.** Both halves matter, and the second
half is why this file replaces the "depths 11, 12" framing in task #31.

## 1. Pool the depths and the answer stops depending on the sample

`chi2` is additive over independent tests: `sum(G) ~ chi2(sum(df))` under the
null. The gate already does this for density (Stouffer over 20 depths, with an
uncorrected alpha, because it is ONE hypothesis) but not for the three G-test
metrics. Pooling asks "does objFeel differ **anywhere**", which is the question
actually at issue, and it is immune to the depth-hopping described in section 3.

Current code:

| band | sum G | df | G/df | p | sigma |
|---|---:|---:|---:|---:|---:|
| all 20 depths | 256.1 | 137 | 1.87 | 3.0e-9 | 5.8 |
| depths 1-9 | 49.3 | 57 | **0.86** | 0.76 | -0.7 |
| **depths 10-17** | **180.5** | **56** | **3.22** | **5.2e-15** | **7.6** |
| depths 18-20 | 26.3 | 24 | 1.10 | 0.34 | 0.4 |

The same pooling on the 2026-07-25 pre-RC1/RC3 run (`noise-floor-raw.txt`),
where a measured null is available for comparison:

| band | sum G | df | G/df |
|---|---:|---:|---:|
| NULL, port vs itself, all depths | 132.9 | 140 | **0.95** |
| REAL, port vs C, all depths | 316.9 | 135 | 2.35 (8.1 sigma) |
| null, depths 1-9 | 73.2 | 60 | 1.22 |
| real, depths 1-9 | 73.8 | 57 | 1.29 |
| null, depths 10-20 | 59.7 | 80 | 0.75 |
| real, depths 10-20 | 243.1 | 78 | 3.12 (8.7 sigma) |

Two things follow.

**The pooled null lands at 0.95 x df.** That is the textbook expectation, and it
is the licence to pool at all — it says the per-depth objFeel tests are mutually
independent and individually calibrated, so their G values may be added. Contrast
`species`, where the pooled null would run 3-5x df because of pit/nest
clustering (`NOISE-FLOOR.md`); there, pooling would inherit the same
overdispersion and be just as void. **objFeel is a sound metric and species is
not**, and this is the quantitative statement of that difference.

**Depths 1-9 are flat against the null on both runs.** Real 1.29 vs null 1.22 in
July's run, and 0.86 on current code. A divergence that were merely
under-sampled, or an artefact of the metric, would not switch off cleanly over
nine consecutive depths.

## 2. Direction: the port's levels are RICHER than the C's

The histogram bins are `calc_obj_feeling`'s return over 10 (`generate.c:711-734`):
bin 10 = `x <= 10`, 9 = `(10,40]`, 8 = `(40,160]`, 7 = `(160,640]`,
6 = `(640,2500]`, 5 = `(2500,10000]`, where `x = obj_rating / depth`. Lower bin =
better loot.

The largest G contributor at each depth in the band, port observed vs C rescaled:

| depth | worst bin | port | C (rescaled) | direction |
|---:|---:|---:|---:|---|
| 10 | 8 | 125 | 90.0 | port richer |
| 11 | 7 | 45 | 23.6 | port richer |
| 12 | 8 | 128 | 94.0 | port richer |
| 13 | 8 | 123 | 80.0 | port richer |
| 14 | 8 | 103 | 75.2 | port richer |
| 15 | 7 | 38 | 24.0 | port richer |
| 16 | 6 | 29 | 17.6 | port richer |
| 17 | 10 | 52 | 75.6 | port richer (fewer empty levels) |

**Eight of eight point the same way.** Seven show an excess in a richer bin and
depth 17 shows a deficit in the poorest bin; both mean the port's `obj_rating`
per unit depth runs high. This is a one-sided, systematic effect, not a scrambled
histogram — which is the strongest single argument that it is a real mechanism
and not sampling.

Note what the band structure then implies: a roughly constant multiplicative bias
in `obj_rating` is only *visible* through a binned statistic where the mass sits
near a bin edge. So the band 10-17 is where the distribution straddles a
threshold, not necessarily where the bias begins. Expect the true cause to be
depth-independent and to be measurable directly on `obj_rating` — see section 4.

## 3. Why the per-depth attribution was never a finding

The recorded depths have moved every time the generation stream moved:

- 2026-07-25 pre-RC1/RC3, under the corrected alpha: depths **13, 16, 19**.
- The same run judged against the measured null's maximum: **10-16, 19**.
- Current code, corrected alpha: depths **11, 12**.
- Current code, band: **10-17**, with 18-20 clean.

`13, 16, 19` and `11, 12` share not one depth. Nothing about object generation
changed between those runs — RC1/RC3 shifted the RNG stream (`25ed848b13`), which
re-rolls *which* levels get sampled, not the generator's object behaviour. So the
identity of the surviving depths is a property of the sample, and any
investigation scoped to "depth 11" would have been chasing a seed.

The single-depth p-values are also not what a reader assumes. `p = 1.9e-5` at
depth 12 is a *marginal* result here: the gate's Bonferroni threshold is
`0.01 / 80 = 1.25e-4`, so it clears by less than one order of magnitude, and the
measured null's observed maximum across 20 depths was `G = 14.9` on one replicate
only (`NOISE-FLOOR.md`'s own caveat). Per-depth, the honest statement was always
"probably something, at an unresolved depth". Pooled, it is 7.6 sigma.

## 4. What to do next

1. **Stop measuring `objFeeling` and measure `obj_rating` directly.** The feeling
   is `obj_rating` pushed through 9 hard thresholds and an integer division; it
   throws away almost all of the signal and turns a smooth bias into a band. The
   C oracle can emit mean `obj_rating` per depth, and a two-sample z on that
   (like density) would localise the bias to a percentage in one run instead of
   arguing about which depth crossed a threshold. **This is the highest-value
   step and it makes the rest cheap.**
2. Suspects, in order of how easily they are settled statically:
   - `object_value_real` — `make_object`'s `*value` out-param
     (`obj-make.c:1173, 1213, 1229`), which is the entire input to the rating.
     A few-percent bias here explains everything above.
   - ego / `good` / `great` roll rates in `make_object`, since an ego item's
     value is what moves `sqrating` (it is squared, so a 10% value bias becomes
     21% of rating).
   - ~~object *quantity* per level, i.e. the `alloc_objects` / room-loot
     calls.~~ **RULED OUT, measured — see section 6.**
   - **Already checked and faithful:** the accumulation itself.
     `placeObject` (`gen/util.ts:1287-1294`) matches `gen-util.c:509-540`
     including `Math.trunc` for C's truncation-toward-zero on the `rating / 100`
     halves, the `+/-2500000` clamp, and the saturating add
     (`chunk.ts:425-430`); `objFeeling` (`generate.ts:296`) matches
     `generate.c:722` including `Math.trunc` on the depth division.
3. ~~Add pooled variants of the G-test metrics to the gate.~~ **DONE** — see
   section 5.

## 6. Quantity is RULED OUT. The bias is in value per object

Date: 2026-07-26. This is the discrimination step, and it did not need the C
oracle rebuilt.

The C main-stats database already stores per-level object counts; they were just
never imported. `log_all_objects` (`main-stats.c:633-657`) sends every object to
either the `wearables_*` family (if `tval_has_variable_power`) or `consumables`,
so `wearables_count + consumables` is the total with no double-count. The port's
`objectTotal` was already collected. So a two-sample z on objects-per-level is
the same instrument as density, and it settles quantity directly.

**One trap, and it is a 40% error if missed.** The C's gold capture at
`main-stats.c:624-626` is additive and does NOT `continue`: a money object is
accumulated into `gold[origin]` and then *falls through* into the `consumables`
bucket at :656, so it is in both tables. The port's `collectLevel` deliberately
`continue`s on `TV_GOLD` before touching `objectTotal`. On the 1000-run oracle
money is 2.82M of 7.03M consumable entries, so importing `consumables` verbatim
would have inflated the C total by roughly 40% and manufactured a divergence out
of a bookkeeping difference. The importer subtracts the money kinds (identified
as `object_info.tval = 35`, `TV_GOLD` being last in `list-tvals.h`, asserted at
import time).

Result, with the C at 1000 levels per depth:

| runs | objFeel pooled G/df | objcount pooled Stouffer Z | worst single-depth objcount |
|---:|---:|---:|---:|
| 400 | 1.87 (p=2.9e-9) | -2.66 (p=7.9e-3) | z=-2.47 at depth 14 |
| 1000 | **2.70 (p=8.4e-25)** | **-1.78 (p=7.5e-2)** | z=-1.57 at depth 6 |

Read the two columns against each other. **objFeel strengthens as the sample
grows and objcount weakens.** That is the whole argument: a real distributional
difference grows with `n`, and one that shrinks with `n` was noise. The 400-run
`p = 0.0079` on the object count was a fluke that 2.5x the data dissolved.

So the port places the same NUMBER of objects per level as upstream — within
about 1% at every depth from 1 to 20 — and those objects nevertheless rate as
richer. `obj_rating` accumulates `object_value_real` (`gen-util.c:509-540`), and
the accumulation itself is already verified faithful (section 4). **The bias is
therefore in the VALUE of what is generated, not the count**, which leaves
exactly two live suspects:

1. `object_value_real` itself, i.e. `make_object`'s `*value` out-param
   (`obj-make.c:1173, 1213, 1229`). Note the leverage: `sqrating` squares the
   value, so a 10% value bias becomes a 21% rating bias.
2. the ego / `good` / `great` roll rates inside `make_object`, which change *what*
   gets made rather than how it is priced. The DB carries `wearables_egos` per
   level, so this one is also measurable without touching the oracle — the
   obvious next step, and cheaper than emitting `obj_rating`.

### What this changed in the gate

Object count per depth is now a gated metric (family 20 + 20 + 2 = 42,
`alpha = 2.38e-4`), so a future quantity regression cannot hide behind the
feeling histogram. The POOLED object count is printed but **not** gated: its
null has not been measured, and the 400-vs-1000 disagreement above is direct
evidence it is not calibrated — the 20 per-depth deviates are plausibly
correlated, since one run walks every depth on a single RNG stream. Gating it
when it was first added was a mistake, and the same one the `species` episode
already taught: a pooled statistic does not get gated until its null is measured.

## 5. The gate's pass/fail set, decided and landed

The owner chose option (a) on 2026-07-26. `parity-c-stat.test.ts` now gates:

| metric | how it is gated | why |
|---|---|---|
| density | per depth, corrected | a test on a MEAN, so a per-depth result is directly interpretable and a depth-localised density bug can genuinely exist |
| density | + Stouffer over depths, UNCORRECTED | one hypothesis, catches a small systematic bias invisible one depth at a time |
| objFeel | **pooled**, corrected | binned quantity; which depth lights up is a property of the seed |
| monFeel | **pooled**, corrected | same |
| species | **printed only, never asserted** | measured void: the port reaches p=2e-97 against ITSELF |

Family size for the Bonferroni correction is therefore `20 + 2 = 22`, not the 60
suggested when the decision was framed — that figure assumed the feeling metrics
stayed per-depth, which pooling supersedes. `alpha = 4.55e-4`.

Measured effect of the change, same code, same 400 runs:

```
before: 19 failures (17 species + objFeel at depths 11 and 12)
after :  1 failure  (objFeel pooled, G/df=1.87, p=2.91e-9)
```

`monFeel` pools to G/df = 1.27, p = 2.0e-2 — comfortably inside the corrected
threshold, so not a finding, but it is up from the 0.80 ratio recorded in
`NOISE-FLOOR.md` and worth watching rather than forgetting.

The species question is NOT closed by dropping it, and the code says so: it needs
a different instrument (one species-vector per LEVEL, then a permutation test
over levels) rather than a threshold on a clustered statistic. That is open work.


## 7. CORRECTION: the null was mismeasured, and the finding does not survive it

Date: 2026-07-26, later the same day. This section supersedes the strength of
every claim above.

### What was wrong

Sections 1 and 5 justify pooling with a measured null of **0.95 x df**, taken
from running the port against ITSELF at a second base seed. That is a weak null.
Two runs of one implementation share more than two independent samples do, and
using it as the reference for a port-versus-C comparison assumes the only
variation is sampling.

There are now two independent 1000-run C `main-stats` databases, produced by the
same binary (the second was built to emit `obj_ratings`, an additive change that
touches no generation code and consumes no RNG). Diffing them against each other
runs this exact instrument on data where the answer is known to be "no
difference", so the result IS the null:

| statistic | C-run-A vs C-run-B, pooled over 20 depths |
|---|---|
| `obj_feelings` | G = 244.6, df = 139, **G/df = 1.76** |
| `mon_feelings` | G = 238.2, df = 122, **G/df = 1.95** |

The tool is `parity/phase3-2026-07-25/tools/c-vs-c-null.mjs`.

**These histograms are overdispersed by nearly a factor of two before the port
is involved at all.** A pooled `G/df` near 1.8 on objFeel is therefore ordinary,
not an eight-sigma event.

### What the finding actually is, corrected

Applying the measured dispersion as a quasi-likelihood correction
(`G/phi` referred to `chi2(df)`):

| port runs | raw G/df | corrected G/phi/df | corrected p | verdict at alpha = 1.22e-4 |
|---:|---:|---:|---:|---|
| 400 (the harness default) | 1.87 | **1.06** | **0.29** | no evidence whatsoever |
| 1000 | 2.70 | **1.53** | **3.5e-5** | survives, by a factor of 3.5 |

Compare with what section 6 claimed for the same 1000-run data: `p = 8.4e-25`.
The corrected figure is twenty orders of magnitude weaker.

`monFeel` is comfortably clean either way -- 1.16 to 1.27 raw against a null of
1.95, i.e. LESS dispersed than upstream is against itself.

### Why this is not yet a finding

`phi` rests on **one replicate per metric**, so it is itself uncertain, and the
residual signal is inside that uncertainty: at `phi = 2.0` instead of 1.76 the
1000-run result becomes `G/phi/df = 1.35`, `p ~ 0.004`, which does not clear the
threshold. So the residual at 1000 runs cannot be distinguished from an
underestimated `phi`.

**Status: the objFeel divergence is a candidate, not an established divergence.**
The next step is to pin `phi` with several more 1000-run C passes and estimate it
from all pairs, with an uncertainty. Until then no generator code should be
changed on the strength of this.

### What survives from the earlier sections, unaffected

- **Pooling is still right.** The argument in section 3 -- that WHICH depths
  light up is a property of the seed, demonstrated by the recorded depths moving
  from {13,16,19} to {11,12} across an unrelated stream shift -- does not depend
  on the null's value. Pooling removes a seed-dependent choice; it just does not
  license an uncorrected p-value.
- **Quantity is still ruled out** (section 6). Object count matches within about
  1% at every depth, and the two C runs differ from each other by 1.44% on the
  same measure, so the port sits inside upstream's own run-to-run spread. Ego
  and artifact counts per level were added to the gate in the same pass and no
  depth reaches |z| = 2.
- **The direction claim (section 2) is weaker than it reads.** Eight-of-eight
  agreement on the sign was computed within the band that the mismeasured null
  selected, so it is partly conditioned on the thing being tested.

### And a dead end worth recording

The recommendation in section 4 -- "stop measuring the feeling and measure
`obj_rating` directly" -- was wrong, and the oracle patch that implemented it
proved why. `obj_rating`'s per-level distribution is extremely heavy-tailed: on
the C oracle its standard deviation runs about **fourteen times its mean** (depth
1: mean 682, SD 9617). A mean test on it has no power, and the mean's feeling bin
does not even match the modal per-level feeling at 85 of 100 depths, because rare
very rich levels drag the mean while leaving the mode ordinary. The binned
feeling is the ROBUST statistic here, which is presumably why upstream computes
it that way. A finer-grained instrument would need log-scale rating buckets or
quantiles, not a mean -- and the oracle would have to emit them.
