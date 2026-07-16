# Parity baseline

`stats-baseline.json` is a Monte-Carlo statistics report (see
`../src/stats.ts`) captured **from the TypeScript port itself** at the pinned
parameters in `BASELINE_PARAMS` (`../src/stats.ts`): `runs=3`, `depths=1..8`,
`seed=1337`, Human Warrior, no randarts.

## What it proves

- **Self-consistency / regression.** The port is bit-exact for a fixed seed, so
  a fresh batch at these parameters must reproduce this file **integer for
  integer**. The parity test (`../src/parity.test.ts`) enforces that with the
  `EXACT` tolerance. Any future change that shifts the generation or allocation
  distributions - a reordered RNG draw, a changed allocation table, a new
  monster/object, a tweaked feeling ladder - makes the fresh batch diverge and
  fails CI.

## What it does NOT prove

- **It is not a C-vs-TS distribution diff.** This baseline was produced by the
  port, so it cannot catch a bug the port and its baseline share. It is a
  self-regression guard, not a cross-implementation parity check. Do not read a
  green parity test as "verified equal to Angband 4.2.6" - only as "unchanged
  from the last accepted port behavior".

## Regenerating (after an intentional change)

```
pnpm --filter @neo-angband/cli build
pnpm --filter @neo-angband/cli stats:baseline
```

Review the diff before committing: it is the exact behavioral delta of your
change to the generator's output distributions.

## Upgrading to a true C-vs-TS parity check

The comparator (`../src/baseline.ts`) is deliberately implementation-agnostic:
it diffs two `StatsReport`s and keys off nothing port-specific. To turn this
into a real parity check against the C oracle:

1. Build the C `main-stats` tool from `reference/` with `USE_STATS` defined and
   run it: `angband -mstats -- -n<runs> -q` (see `reference/src/main-stats.c`
   `init_stats`, the `-n/-r/-s/-C/-R` options). It writes a SQLite database.
2. Export the same metrics this harness collects (monsters by race by depth,
   `obj_feelings` / `mon_feelings` by depth, gold by origin, item counts) from
   that database into this JSON shape (`StatsReport`), setting
   `meta.generatedBy` to `"c-main-stats"`.
3. Drop it in as `stats-baseline.json` (or load it alongside) and compare with
   the `STATISTICAL` tolerance preset and `normalizeByLevels: true` - the C and
   TS RNG streams differ, so only the **distributions** can match (within
   tolerance, per-level rates), never the exact integers. Tune the per-metric
   tolerances as the real distributions are brought into agreement.

Until step 3 is done, the parity claim this harness backs is precisely the
self-regression guarantee above - stated honestly so nobody overclaims parity.
