# W3-1 — Rebuild and widen the compiled-C statistical oracle

You are working in `C:\Repositories\neo-angband`. `reference/` is the **read-only
oracle** (original Angband 4.2.6 C source). Never modify anything under
`reference/`.

## Why

`packages/cli/src/parity-c.test.ts` compares the TypeScript port against a
baseline imported from the **real compiled C `main-stats` tool**
(`packages/cli/baseline/c-stats-baseline.json`). It is currently RED:

```
depths.6.monsterTotal: baseline=46.465 fresh=43.48 (allowed +/-2.32)
depths.6.monsters.63:  baseline=2.855  fresh=5     (allowed +/-2)
depths.7.monsterTotal: baseline=48.775 fresh=46.11 (allowed +/-2.44)
depths.8.monsterTotal: baseline=47.805 fresh=51    (allowed +/-2.39)
```

The existing baseline is 200 C runs over depths 1–20; the port side runs 100.
Before anyone touches the generator we need an oracle wide enough that a real
divergence cannot be confused with sampling noise. Note that two of those four
"fresh" values are exact integers, which is odd for a 100-sample mean — treat
the current numbers as unproven until you have re-measured.

**Do not** widen the test tolerance and **do not** regenerate the baseline from
the port. The baseline must come from compiled C.

## Task

1. **Build a stats-enabled Angband from a COPY of the reference.**
   - Copy `reference/` to `C:\Repositories\_c-oracle\src` (outside the repo).
   - In the copy only, `src/stats/db.c` names its output DB with a colon
     (`...T%02d:%02d.db`), illegal on Windows, so `sqlite3_open` fails. Change
     that colon to a hyphen. Windows-only tooling fix, zero gameplay effect.
   - The toolchain is MSYS2 mingw64: `C:\msys64\mingw64\bin` must be on PATH so
     CMake finds gcc. `cmake` and `ninja` are already on PATH.
   - Enable the GCU front end so CMake does not force the Windows front end
     (which disables stats), and disable the Borg:
     ```
     cmake -S C:/Repositories/_c-oracle/src -B C:/Repositories/_c-oracle/build -G Ninja ^
       -DSUPPORT_GCU_FRONTEND=ON -DSUPPORT_STATS_FRONTEND=ON -DSUPPORT_BORG=OFF
     ninja -C C:/Repositories/_c-oracle/build
     ```
   - If ncursesw is missing, install it via MSYS2 (`pacman -S
     mingw-w64-x86_64-ncurses`) or find another front end that leaves stats
     enabled. Report exactly what you did.

2. **Run the oracle at a wide sample.** From the build's game directory:
   `./angband -mstats -- -n1000 -q` (`-n` runs, `-q` quiet; see
   `reference/src/main-stats.c` `init_stats`). Each run descends every level
   once, so a depth's sample count equals the run count. If 1000 runs is
   impractical in the time available, run the largest N you can and report it —
   but do not go below 500.

3. **Import it** to a NEW file `packages/cli/baseline/c-stats-baseline-n<N>.json`
   (leave the existing baseline untouched so the delta is reviewable):
   ```
   pnpm --filter @neo-angband/cli build
   node dist/main-cimport.js <path-to-stats.db> 20
   ```
   Check `packages/cli/src/main-cimport.ts` for its exact output path/arguments
   and adjust rather than guessing; `sqlite3` is on PATH.

4. **Measure the port against it** at a matching sample size:
   `node dist/main-cparity.js <runs> <depthMax>`
   (see `packages/cli/src/main-cparity.ts`).

## Deliverable

Write `parity/phase3-2026-07-25/findings/W3-ORACLE.md` containing:

- exact build commands that worked, and any deviation from the recipe above;
- the C run count actually achieved, and the DB path;
- a per-depth table over the whole depth range: C mean monsters, port mean
  monsters, delta, and delta as a percentage;
- the same for gold total, gold-by-origin, and the object/monster level-feeling
  histograms;
- for the four S-2 deltas above: **is each one still present at the wider sample,
  and is it inside or outside sampling noise?** Give the standard error you used.
- a ranked list of every metric now diverging beyond noise, worst first. Do not
  attempt to fix the generator in this task — measurement only.

Commit nothing. Leave the new baseline JSON and the findings file on disk for
review.
