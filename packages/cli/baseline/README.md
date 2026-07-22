# Parity baselines

Two baselines live here, and they prove very different things. Do not conflate
them.

## `c-stats-baseline.json` - REAL upstream parity (ground truth)

Imported from the compiled **C Angband 4.2.6 `main-stats`** tool
(`meta.generatedBy = "c-main-stats"`). This is upstream output, so the port is
diffed AGAINST it - it is the actual cross-implementation parity check the audit
(07 AUX-2) asked for. Enforced by `../src/parity-c.test.ts` with the
`STATISTICAL` tolerance and `normalizeByLevels` (the C and TS RNG streams differ
by design under D1 = B, so per-level RATES match, not exact integers).

Coverage: the cleanly-keyed generation metrics - monsters (total + per race),
level feelings (obj/mon), and gold (total + per origin). The object-kind
distribution is not yet imported (C splits it across several detail tables with a
remapped index); that is a documented next increment.

### Known honest deltas (surfaced by this harness, tracked for a later phase)

These persist as the run count grows, so they are real, not sampling noise:

- **Depth-6 monster density ~10% low** in the port vs upstream. Every other
  depth's density and every monster species distribution match within tolerance.
- **Gold-by-origin classification differs.** Gold totals are close, but the port
  assigns some gold to different `ORIGIN_*` buckets than upstream (e.g. origin 12
  at several depths). The gold TOTAL is guarded loosely so a gross gold
  regression cannot hide behind this; the per-origin split is a tracked finding.

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
   ./angband -mstats -- -n200 -q
   ```

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
