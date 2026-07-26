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
- **Money is subtracted, and getting that wrong is a ~40% error.** The C's gold
  capture at `:624-626` is additive and does not `continue`, so a money object
  is accumulated into `gold[origin]` AND falls through into `consumables` - it
  is in both tables. The port's `collectLevel` deliberately skips `TV_GOLD`
  before counting, so the importer drops the money kinds to match. On the
  1000-run oracle money is 2.82M of 7.03M consumable entries.

Per-level squares are absent by construction: the C schema stores per-depth
aggregates, not per-run samples, so any mean test estimates the shared variance
from the port side. That is also what blocks a valid monster-species test, which
needs the LEVEL as the unit of observation - see
`parity/phase3-2026-07-25/findings/NOISE-FLOOR.md`.

### Open divergences this harness has surfaced

- **Object level feelings: the port's levels rate RICHER than upstream's.**
  Pooled across depths, G/df = 2.70 at 1000 levels per depth (p = 8.4e-25), and
  it STRENGTHENS with sample size, which is what makes it real. Object *count*
  matches within about 1% at every depth, so the bias is in the value of what is
  generated rather than the quantity. See
  `parity/phase3-2026-07-25/findings/OBJFEEL.md`.
- **Gold-by-origin classification differs.** Gold totals are close, but the port
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
pnpm --filter @neo-angband/cli build
pnpm --filter @neo-angband/cli stats:baseline
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
   pnpm --filter @neo-angband/cli build
   node --import ./register.mjs dist/main-cimport.js <stats.db> 20
   ```

   Review the human-readable diff against the current port any time with:

   ```
   node --import ./register.mjs dist/main-cparity.js 100 8
   ```
