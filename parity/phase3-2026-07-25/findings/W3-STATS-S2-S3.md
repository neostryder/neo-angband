# W3 — Statistical parity: S-2 resolved, S-3 opened

> **UPDATE 2026-07-25, wider oracle.** A fresh stats-enabled C build now provides
> **1000 levels per depth over depths 1–20** (see `W3-ORACLE.md`), replacing the
> 200-level, depth-1–8 baseline everything below was first measured against. At
> that sample size, with the port at 400 runs:
>
> - **Density is green at every depth 1–20**, and the pooled Stouffer test over
>   all 20 depths gives Z = −1.22, p = 0.22. **S-2 is definitively closed.** The
>   oracle stream's own report flagged depth 6 as still divergent, but it
>   estimated the standard error with a Poisson approximation
>   (`sqrt(mean/N)` ≈ 6.6), and the measured per-level standard deviation at that
>   depth is **21.6** — monster counts are heavily overdispersed because the count
>   follows whichever rooms the level grows. Its "57 metrics beyond noise" is
>   inflated by the same factor.
> - **The species mix diverges at every depth from 5 to 20**, G = 389–823 on
>   df = 138–209, p from 1.9e-15 down to 4.8e-98. Depths 1–4 pass.
> - **Object level feelings** also now fail at depths 11 and 12 (p = 3.1e-5,
>   6.9e-5), consistent with the same cause: the feeling is derived from what was
>   placed.
>
> The numbers in the S-3 section below are from the 200-level oracle; the
> conclusions are unchanged and the effect is now measured over 20 depths.

Measured 2026-07-25 against `packages/cli/baseline/c-stats-baseline.json`
(200 generated levels per depth, imported from the compiled C `main-stats`), with
the port at 200 runs, base seed 1337, depths 1–8.

## S-2 (monster density at depths 6–8) — NOT a divergence

The old gate (`parity-c.test.ts`, abs/rel tolerance) reported four failures:
`depth 6 total 46.465→43.48`, `depth 6 race 63 2.855→5`,
`depth 7 48.775→46.11`, `depth 8 47.805→51`.

**Per-level monster count has a standard deviation of 7–23** depending on depth,
because the count follows whichever rooms the level happens to grow. At 100
sampled levels the standard error of the mean is therefore 0.7–2.3, so a ±2
window is about one standard error — the gate was testing noise.

Seed-stability probe, four base seeds × 100 runs each:

| depth | C (200 levels) | port spread over 4 seeds | verdict |
|---|---|---|---|
| 6 | 46.47 | 42.91 – 46.98 | C inside the port's own spread |
| 7 | 48.77 | 45.43 – 48.87 | C inside |
| 8 | 47.80 | 47.77 – 51.00 | C inside |

At 200 runs with a two-sample z-test, every depth passes: worst is depth 6 at
z = −1.90, p = 0.058, against a Bonferroni-corrected α of 3.1e-4.

**S-2 is closed as a sampling artefact.** The tolerance gate was wrong, not the
generator. There is a hint of a small systematic (depths 2, 6 and 7 all read
low by 1.9–3.9) that is *not* significant at this sample size — worth
re-checking once the wider C oracle lands.

## S-3 (monster species mix) — a real, large divergence

The same run reveals what the tolerance gate could never see. Per-race rates are
small numbers, so a ±2 absolute window swallowed the entire species
distribution. A two-sample G-test of homogeneity over the whole histogram
instead:

| depth | G | df | p | worst contributor |
|---|---|---|---|---|
| 1 | 75.8 | 47 | 4.9e-3 | pass |
| 2 | 94.5 | 57 | 1.3e-3 | pass |
| 3 | 99.7 | 74 | 2.5e-2 | pass |
| 4 | 88.3 | 86 | 4.1e-1 | pass |
| 5 | 546.4 | 118 | **2.5e-56** | race 175 warrior: port 35, C ~0 |
| 6 | 590.1 | 126 | **4.1e-61** | race 175 warrior: port 36, C ~0 |
| 7 | 790.7 | 132 | **1.9e-94** | race 151 tengu: port 166, C 25.4 |
| 8 | 508.3 | 142 | **1.1e-42** | race 151 tengu: port 104, C 12.2 |

Object and monster level feelings pass at every depth. Density passes at every
depth. It is specifically **which monsters** are chosen, from depth 5 down.

### Ruled out

- **Index misalignment.** Correlation of the C histogram against the port
  shifted by −2…+2 peaks sharply at shift 0 (0.99 at depth 1, 0.94 at depth 6),
  and the names line up (29 = wild dog dominant at depth 1, 99 = snaga at 6).
  `<player>` occupies index 0 on both sides.
- **Out-of-depth monsters in general.** Mean placed race level matches closely
  (depth 6: C 3.99 vs port 3.97; depth 8: C 4.71 vs port 4.81), and both sides
  place a similar tail above the `get_mon_num` level cap. The port is not
  generally generating monsters that are too deep.
- **`get_mon_num` itself.** `packages/core/src/mon/make.ts:156` is a faithful
  line-for-line port of `reference/src/mon-make.c:221`, including the OOD boost,
  the town/seasonal/unique/FORCE_DEPTH gates, and the harder-monster retries at
  p<60 and p<10. The rarity weighting `(100/rarity) * (1 + level/10)` matches.

### Fixed here: harness fidelity (was masking the real signal)

`runStatsBatch` did not mirror `kill_all_monsters`
(`reference/src/main-stats.c:557-560`), which **zeroes `max_num` for every unique
it kills** — so in the C a unique generated at any depth is retired for the rest
of that descent. The port let uniques recur at every depth of a run, e.g. Fang at
depth 4: port 63 per 200 levels against the C's 13.

Fixing it cleared depths 1–4 entirely (depth 4 went from p = 1.5e-8 to p = 0.41).
That is a harness bug rather than a game bug, and it is exactly why an oracle
harness needs the same scrutiny as the code it measures.

### Still open — the remaining depth 5–8 divergence

The surviving signature is **lumpy**: whole species present on one side and
absent on the other, in blocks of tens.

- depth 6, C only: `homunculus ×34`, `quasit ×25`, `rogue ×21`, `hairy mold ×33`,
  `disenchanter mold ×27`, `clear mushroom patch ×16`, `half-orc ×16`
- depth 6, port only: `ogre ×40`, `warrior ×36`, `killer brown beetle ×28`,
  `uruk ×20`, `blacklock mage ×16`, `black ogre ×15`
- depth 7–8: the port over-places `tengu` by 6–8×

Lumps of this size are the signature of **themed room population** — pits and
nests place tens of monsters of one theme in a single room — not of a subtly
wrong probability weight, which would shift many species slightly. `warrior`,
`rogue`, `mage`, `priest` are the human-class monsters a "person" pit draws from,
and both sides place *some* of them, just different ones.

**Prime suspects, in order:** pit/nest theme selection (`set_pit_type` and
`pit.txt` weighting), the `mon_restrict` filter pits install via
`get_mon_num_prep`, and pit/nest room frequency in the room profile draw. Next
after those: group/friends placement (`place_friends`) and escort generation.

## What changed in the harness

- `packages/cli/src/stat-test.ts` — new: Chebyshev `erfc`, incomplete-gamma
  chi-square tail, two-sample mean z-test that reports its own resolving power,
  and a two-sample G-test of homogeneity with sparse-cell pooling. Deliberately
  the homogeneity form: treating the C's 200 levels as exact truth inflates G by
  roughly 2×.
- `packages/cli/src/stats.ts` — per-level sums of squares
  (`monsterTotalSq`, `goldSq`) plus `perLevelSd`, so a comparison can compute a
  standard error instead of guessing a tolerance; and the `kill_all_monsters`
  unique retirement above.
- `packages/cli/src/parity-c-stat.test.ts` — new gate, Bonferroni-corrected,
  which prints the full table on success as well as failure so a pass never reads
  as "identical" when it only means "we could not have detected a difference this
  small".
- `packages/cli/src/parity-c.test.ts` — deleted. Superseded: its tolerance could
  not tell an under-sampled metric from a divergent one, and it was permanently
  red for the wrong reason while missing S-3 completely.

`parity-c-stat.test.ts` is **red on purpose** until S-3 closes.
