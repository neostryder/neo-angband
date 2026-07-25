# S3-BISECT — find which change helps and which hurts

You are working in worktree `C:\Repositories\na-wt-moncmd`, branch `p3/s3-fix`,
where the S-3 fix attempt is committed as `d6dcdbf46`. `reference/` is the
**read-only oracle**. Never modify anything under `reference/`.

## Why this task exists

The batch was **not merged.** Every change in it is individually justified against
the C — RC1 and RC3 are confirmed live defects, and the prepend order is
confirmed — but the measured result got **worse**, so at least one change is wrong,
incomplete, or unmasking something larger.

From your own before/after tables (400 port levels per depth, committed C
baseline, G-test of homogeneity on the species histogram):

| depth | before | after | verdict |
|---:|---:|---:|---|
| 1 | 74.2 | 50.4 | improved |
| 3 | 75.7 (p 0.62) | 118.8 (**p 0.0032**) | **regressed from passing to failing** |
| 4 | 80.4 (p 0.86) | 164.7 (**p 2.9e-5**) | **regressed from passing to failing** |
| 5 | 823.4 | 681.9 | improved |
| 8 | 534.7 | 651.0 | worse |
| 10 | 388.8 | 506.8 | worse |
| 11 | 504.8 | 752.1 | worse |
| 13 | 452.4 | 741.5 | much worse |
| 14 | 805.1 | 888.4 | worse |
| 20 | 928.5 | 721.7 | improved |

Net: worse. Depths 3 and 4 are the loudest signal — they were comfortably
*passing* and are now failing, so something introduced a **new** divergence at
shallow depths, where pits are rare and the likely culprits are the friends/drop
ordering or RC1's placement change.

This is the statistical gate doing its job: it stopped a plausible, C-cited,
type-checking, test-passing batch that would have made the game *less* like
upstream. Do not argue with the measurement.

## Task

**Bisect the batch. Measure each change alone.**

The changes, from `git show d6dcdbf46 --stat`:

1. RC1 — `packages/core/src/gen/util.ts` distant-monster placement
2. RC3 — generation `curNum` (`gen/util.ts`)
3. friends / friends-base reversal — `packages/core/src/mon/bind.ts`
4. drop / drop-base combined reversal — `mon/bind.ts` **plus the pack format
   change** in `packages/content/pack/monster.json`, `content/src/records.ts`,
   `content/src/specs/mon-init.ts`
5. room templates + vaults reversal — `packages/core/src/gen/room.ts`
6. mimic kinds + preferred shapes reversal — `mon/bind.ts`
7. alternate spell messages reversal — `mon/bind.ts`

For each, in isolation from `master`: apply only that change, run

```bash
pnpm vitest run packages/cli/src/parity-c-stat.test.ts --testTimeout=600000
```

and record the per-depth G/df/p table. Report a matrix: change × depth × delta-G
against the master baseline, and a per-change verdict of **HELPS / NEUTRAL /
HURTS**.

Notes on likely traps:

- A prepend reversal is **wrong** wherever the C's `*_finish` step already
  restores file order before use. Check each one again for that specifically —
  `mon-init.c` and `obj-init.c` both do this for some lists, and getting it
  backwards introduces exactly this kind of regression.
- The drop change altered the **committed pack format**. Re-run
  `packages/content/src/data-exactness.test.ts` (it re-parses
  `reference/lib/gamedata` and diffs every field) and report the result. A pack
  format change that makes that test pass while diverging from the reference is
  the worst possible outcome.
- RC1 changes how many RNG draws placement consumes. If it shifts the stream, it
  will move every later draw on the level, which can look like a species change
  without being one. Report its draw count against the C's explicitly.

## Then: the pit residual

Your telemetry found the real shape of the depth 5+ symptom, and it is
**presence/absence, not weighting**:

| depth | race | C | port |
|---:|---|---:|---:|
| 6 | ogre | 114 | **0** |
| 7 | warrior | 45 | **0** |
| 8 | ogre | 40 | **0** |
| 5 | warrior | 71 | 111 |

A count of 0 against 114 is not a mis-weighted draw. Either a pit profile the C
selects at that depth is never selected by the port, or it is selected and
populated from a different race set. Since the profile-selection logic
re-derives as faithful and no empty-hook failures were recorded, the next place
to look is **which races pass the pit's eligibility filter** — `mon_restrict` /
`mon_select` in `reference/src/gen-monster.c`, the flag/base/spell subset tests,
and the depth-rarity gate — compared with
`packages/core/src/gen/gen-monster.ts`.

Report what you find. Do **not** change pit weights or pit data.

## Deliverable

`parity/phase3-2026-07-25/findings/S3-BISECT.md`:

1. The bisect matrix and a HELPS/NEUTRAL/HURTS verdict per change.
2. The `data-exactness` result after the pack format change.
3. Your recommendation: which changes to keep, which to drop, which to redo — with
   the C citation for each recommendation.
4. The pit eligibility finding.

Leave `p3/s3-fix` as it is; work on scratch branches or by stashing. Commit
nothing to `p3/s3-fix`.
