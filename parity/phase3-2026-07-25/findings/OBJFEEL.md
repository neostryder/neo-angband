# objFeel: the divergence is real, and it is a depth BAND, not depths 11-12

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
   - object *quantity* per level, i.e. the `alloc_objects` / room-loot calls.
     Ruled less likely: density parity passes and the pooled Stouffer is clean,
     but that is monsters, not objects.
   - **Already checked and faithful:** the accumulation itself.
     `placeObject` (`gen/util.ts:1287-1294`) matches `gen-util.c:509-540`
     including `Math.trunc` for C's truncation-toward-zero on the `rating / 100`
     halves, the `+/-2500000` clamp, and the saturating add
     (`chunk.ts:425-430`); `objFeeling` (`generate.ts:296`) matches
     `generate.c:722` including `Math.trunc` on the depth division.
3. ~~Add pooled variants of the G-test metrics to the gate.~~ **DONE** — see
   section 5.

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
