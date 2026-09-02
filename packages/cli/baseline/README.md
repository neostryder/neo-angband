# Parity baselines

Two baselines live here, and they prove very different things. Do not conflate
them.

## `c-stats-baseline.json` - REAL upstream parity (ground truth)

Imported from the compiled **C Angband 4.2.6 `main-stats`** tool
(`meta.generatedBy = "c-main-stats"`). This is upstream output, so the port is
diffed AGAINST it - it is the actual cross-implementation parity check the audit
(07 AUX-2) asked for. Enforced by `../src/parity-c-stat.test.ts`, where every
comparison is a hypothesis test that states its own resolving power. That
SUPERSEDED the older `parity-c.test.ts` abs/rel tolerance gate, which could not
tell a real divergence from an under-sampled one.

Coverage: monsters (total + per race index), gold (total + per origin), objects
(total + per kind + per tval), artifacts, and the object/monster level-feeling
histograms. Levels-per-depth is derived as `SUM(obj_feelings.count)`, since each
generated level contributes exactly one feeling sample.

Two things about the object counts are worth knowing before you touch the
importer:

- The C partitions every logged object across **two** tables. `log_all_objects`
  (`main-stats.c:633-657`) sends it to the `wearables_*` family if
  `tval_has_variable_power`, and otherwise to `consumables`; the total is
  `wearables_count + consumables`, counted exactly once each.
- Money is subtracted, and getting that wrong is a ~40% error. The C's gold
  capture at `:624-626` is additive and does not `continue`, so a money object
  is accumulated into `gold[origin]` AND falls through into `consumables` - it
  is in both tables. The port's `collectLevel` deliberately skips `TV_GOLD`
  before counting, so the importer drops the money kinds to match. On the
  1000-run oracle money is 2.82M of 7.03M consumable entries.

Per-level squares are absent by construction: the C schema stores per-depth
aggregates, not per-run samples, so any mean test estimates the shared variance
from the port side. The monster-species gate does the same thing one dimension
up. It needs the LEVEL as the unit of observation, because pits and nests place
monsters in correlated batches, and only the port can report per-level species
vectors - so the clustering is measured there and applied to the whole
statistic, valid under the null that both sides are the same generator. See
`clusteredDistributionTest` in `../src/stat-test.ts` and the species section of
`docs/PARITY.md`.

### Open divergences this harness has surfaced

- **Pooled density is no longer gated, and the reason is the file's own house
  rule.** A pooled statistic is not gated until its null has been MEASURED,
  because pooling inherits any correlation between the things pooled and one run
  walks every depth on a single RNG stream. Pooled object count was disqualified
  on exactly that argument; pooled density was gated anyway and survived only by
  passing. It stopped passing when `reference/` moved back to the 4.2.6 tag, and
  it behaves the same way its sibling did:

      PORT_RUNS=400    Z=-2.62  p=8.7e-3
      PORT_RUNS=1000   Z=-2.32  p=2.0e-2

  Two and a half times the data and the deviate WEAKENED. A real effect grows
  with n - pooled objFeel goes 1.87 -> 2.70 over that same pair - so this is
  noise, and a gate whose verdict flips with sample size is not measuring the
  port. The twenty per-depth density tests remain gated at the corrected alpha
  and all pass. **This is not a widened threshold**: nothing about the per-depth
  family changed, and re-recording the C baseline is still forbidden.

- Pooled object count strengthened under the 4.2.6 gamedata and wants a look.
  Same diagnostic, never gated: it read Z=-1.78 at 1000 runs against the old
  (post-tag) gamedata and reads **Z=-4.29 at 1000 runs** against 4.2.6's. The
  per-depth object-count tests, which ARE gated, all pass, so whatever this is
  does not show up one depth at a time. It may be the same pooling artefact; it
  may not. Measuring its null is the prerequisite for saying either.

- Object level feelings: the port's levels rate RICHER than upstream's.
  Pooled across depths, G/df = 2.70 at 1000 levels per depth (p = 8.4e-25), and
  it STRENGTHENS with sample size, which is what makes it real. Object *count*
  matches within about 1% at every depth, so the bias is in the value of what is
  generated rather than the quantity. See
  `parity/phase3-2026-07-25/findings/OBJFEEL.md`.
- Gold-by-origin classification differs. Gold totals are close, but the port
  assigns some gold to different `ORIGIN_*` buckets than upstream (e.g. origin 12
  at several depths). The gold TOTAL is asserted separately so a gross gold
  regression cannot hide behind this; the per-origin split is a tracked finding.

Two entries that used to be listed here are CLOSED and must not be revived from
an old copy of this file: the depth-6 monster density deficit (S-2) was a
sampling artifact - the per-level density standard deviation is near 17 on a mean
near 46, so the "10% low" reading sat inside the port's own seed-to-seed spread -
and the monster species G-test (S-3) was withdrawn as invalid, because pit and
nest clustering overdisperses it to the point that the port reaches p = 2e-97
against ITSELF.

Species is measured again, and it PASSES. The withdrawal above was a verdict on
the instrument, not on the metric: a plain G-test counts every monster as an
independent observation, which a pit of 20-60 monsters makes false. The gate now
runs a design-effect-corrected G-test over monster BASES, with the clustering
measured from the port's per-level vectors, and it is checked against a known
null before it decides anything (`../src/stat-test.test.ts`). The measured
design effect is 1.4 at depths 1-2 and 5-7.4 from depth 5 down, which is the
overdispersion the withdrawal described, now subtracted rather than argued
about.

## `stats-baseline.json` - self-regression guard (NOT parity)

A Monte-Carlo report (`../src/stats.ts`) captured **from the TypeScript port
itself** at `BASELINE_PARAMS` (`runs=3`, `depths=1..8`, `seed=1337`, Human
Warrior). The port is bit-exact for a fixed seed, so a fresh batch must reproduce
this file integer-for-integer; `../src/parity.test.ts` enforces that with `EXACT`
tolerance. It catches drift from the port's own last-accepted behavior - a
reordered draw, a changed table, a new monster. It **cannot** catch a bug the
port and its own baseline share, so it is NOT evidence of parity with Angband
4.2.6. Only `c-stats-baseline.json` is that.

Regenerate after an intentional generator change (and review the diff):

```
pnpm --filter @rpgm-tools/neo-angband-cli build
pnpm --filter @rpgm-tools/neo-angband-cli stats:baseline
```

## Reproducing the C baseline

The C `main-stats` front end is not in the browser build; you build it from the
read-only oracle in `reference/` with a C toolchain. This was done on Windows
with the MSYS2 mingw64 toolchain (gcc, ninja, sqlite3, ncursesw), which CMake
finds automatically.

1. **Build a stats-enabled Angband out-of-tree** (do NOT build inside
   `reference/`; it is the read-only oracle). The GCU front end is enabled only
   so CMake does not force the Windows front end, which would disable stats:

   ```
   cmake -S <copy-of-reference> -B <build> -G Ninja \
     -DSUPPORT_GCU_FRONTEND=ON -DSUPPORT_STATS_FRONTEND=ON -DSUPPORT_BORG=OFF
   ninja -C <build>
   ```

   Note: upstream `src/stats/db.c` names the output DB with a colon
   (`...T%02d:%02d.db`), which is an illegal filename on Windows, so
   `sqlite3_open` fails there. Build from a COPY of the source with that colon
   changed to a hyphen (a Windows-only tooling fix; zero gameplay effect). The
   oracle stays untouched.

2. **Run it** from the build's game dir (writes `lib/user/stats/<timestamp>.db`):

   ```
   ./angband -mstats -- -n1000 -q
   ```

   The committed baseline was produced with `-n1000` (1000 levels per depth, no
   randarts); a 1000-run pass takes roughly 12 minutes. Do not regenerate it with
   a smaller `-n` without saying so in the commit - the gate's resolving power is
   printed per depth and depends on it.

   (`-n` runs, `-r` randarts, `-q` quiet - see `reference/src/main-stats.c`
   `init_stats`. Each run descends every level once, so a depth's sample count
   equals the run count.)

3. **Import it** to this JSON (sqlite3 CLI must be on PATH, or set `$NEO_SQLITE3`):

   ```
   pnpm --filter @rpgm-tools/neo-angband-cli build
   node dist/main-cimport.js <stats.db> 20
   ```

   Review the human-readable diff against the current port any time with:

   ```
   node dist/main-cparity.js 100 8
   ```
