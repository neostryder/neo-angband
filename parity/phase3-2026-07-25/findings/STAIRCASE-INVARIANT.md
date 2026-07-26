# The staircase-reachability invariant

Date: 2026-07-25
Branch: `p3/s3-fix`
Task: #36 (was "~4% of depth-60 levels have no walk-reachable down stair")

Owner ruling, verbatim:

> There must never be a floor that doesn't have a reachable up AND down
> staircase (except town and Morgoth floors). Must be fixed.

## 1. The port was faithful; upstream is the problem

`alloc_stairs` (`reference/src/gen-util.c:629`) picks any `square_isempty` grid
and does **not** exclude vault interiors. `ensure_connectedness` is called with
`allow_vault_disconnect = true` at five of its six sites (`gen-cave.c:1271`,
`2836`, `3083`, `3693`, `3953`; only `3464` passes `false`), so the tunneller is
explicitly permitted to leave a vault sealed. A vault it never joined can
therefore swallow a staircase, and nothing in `cave_generate` checks — the only
post-build validation upstream performs is `chunk_validate_objects`
(`generate.c:1244`).

The port reproduces all of that exactly. `allocStairs` in
`packages/core/src/gen/util.ts` is a line-for-line match, including the
`walls = 3 -> 0` ladder and the absence of a vault test. **This was never a port
defect**, which is why the earlier framing ("the port leaves ~4% of deep levels
unreachable *despite* implementing ensure_connectedness at all six sites") was
looking for a bug that does not exist.

Note the asymmetry that makes it visible: `find_start` — the player's own spot —
*does* exclude vaults (`squareIsVault` in `findStart`). Only stairs may land in
one.

## 2. Measured incidence: 10.2%, and it is the UP stair

A profile-attributed sweep of 520 levels across depths 1-98, 40 seeds each:

| profile | n | down unreachable | up unreachable |
|---|---:|---:|---:|
| modified | 261 | 7 (6 in a vault) | **31 (28 in a vault)** |
| classic | 223 | 2 (1 in a vault) | **12 (9 in a vault)** |
| lair | 2 | 0 | 1 (1 in a vault) |
| cavern / gauntlet / hard centre / labyrinth / moria | 34 | 0 | 0 |
| **total** | **520** | **9** | **44** |

**53 stranded levels in 520 = 10.2%**, and 37 of the 53 had the orphaned stair
inside `SQUARE_VAULT`. The up/down asymmetry is not chance: `handle_level_stairs`
(`gen-cave.c:958`) allocates `rand_range(3, 4)` down stairs but only
`rand_range(1, 2)` up, so a single bad roll on the lone up stair strands the
floor, while three or four down stairs almost always leave one reachable.

The remaining cases (vault count 0 — e.g. depth 1 seed 501016) are a different
cause: the player's own region is cut off from everything, which `classic_gen`
permits because it never calls `ensure_connectedness` at all.

The earlier "~4% at depth 60" estimate was an undercount: it only tested the
**down** stair, which is the direction that is four times better protected.

## 3. The fix: repair, not re-roll, and not a loosened test

`ensureStairsReachable` (`gen/util.ts`), called inside `cave_generate`'s existing
retry loop (`gen/generate.ts`) next to the monster-maximum check.

For each direction the level actually has a stair in, it floods the region the
player can walk (passable + doors, which open, + rubble, which digs;
8-directional; walls excluded so the guarantee is not vacuous). If no stair of
that direction is reachable it places one inside the walkable region, choosing
the grid the way `alloc_stairs` does — best wall-adjacency tier first (3 -> 0, so
it lands in an alcove) and, within that tier, closest to the stranded stair it
stands in for, so it surfaces beside the vault that swallowed the original.

Three properties make this safe:

- **It draws no RNG.** Proven by RNG-state equality across the call, not by
  inspection — any draw through any entry point would advance the state.
- **It touches nothing on a healthy level.** Asserted on `featCount`.
- **It cannot mint a down stair on a Morgoth floor**, because it goes through
  `placeStairs`, which forces `FEAT_LESS` when `quest` or
  `depth >= maxDepth - 1` and `FEAT_MORE` at depth 0.

"Each direction it actually has one" is what exempts the two floors the owner
named, with **no depth special-casing**: the town has no up stair to reach
(`place_stairs` forces `FEAT_MORE` at depth 0) and Morgoth's floor has no down
stair (forced `FEAT_LESS`).

Fallback: when the walkable region holds nothing else that can host a stair, the
player's own grid is used. Upstream does exactly this under
`birth_connect_stairs` (`gen-util.c:427-433`), so it is a legal arrival state.
It fired once in ~230 generated levels and turns that level's full re-roll into a
one-grid change. If even that is unavailable the function returns false and
`cave_generate` re-rolls, the same treatment as a monster-maximum overflow.
Measured re-rolls after the fallback: **zero**.

## 4. Blast radius: 184 of 200 levels bit-identical

Terrain hash + monster count + object count over 200 levels (depths 1-80),
guarantee off vs on:

```
levels compared          : 200
bit-identical to upstream: 184
changed by the guarantee : 16 = 8.0 %
```

The 16 that changed are exactly the stranded ones. Because the repair spends no
RNG and adds one grid, monster and object placement is untouched even on those.

## 5. This is a deliberate deviation from upstream

Recorded here so a future parity audit does not "fix" it back. It is the first
gameplay-behaviour departure from 4.2.6 in the port: everything else that differs
is web-UI necessity or the mod system.

It could instead live in the bundled **bug-fixes mod**, which exists for exactly
this class of upstream defect, leaving core strictly faithful. That would be more
consistent with the exact-parity mandate — but it would also mean the stock game
still ships stranded floors, which is what the owner ruled out. Flagged for him;
the implementation is one self-contained function plus one call site, so moving
it later is cheap.

## 6. Tests

In `packages/core/src/gen/gen.test.ts`:

- `guarantees a reachable up AND down staircase on every floor` — depths
  0, 1, 2, 5, 10, 25, 40, 60, 80, 98, 99, 100 x 8 seeds, covering the town and
  both quest floors.
- `holds on the seeds that stranded the player before the guarantee` — the 12
  measured pre-fix failures, kept as named regressions.
- `generates fully-connected valid levels across the deep profile pool` —
  strengthened from down-only to the full invariant. This is the test that was
  failing at depth 60 seed 15004; that level had **4 down stairs, none
  reachable**.
- Four mechanical unit tests on a synthetic sealed-pocket level: the repair, the
  spot-choice rule, RNG-state equality (both the repair and the no-op path), the
  under-the-player fallback, the refuse-and-re-roll path, and the quest guard.

**Power validated**: with the one call site disabled, the three integration tests
fail (`depth 40 seed 13002`, `d1 seed 501016`, `depth 60 seed 15004`) and pass
with it restored.

Suites: `pnpm build` clean; core 2632/2632; content 92/92.

## 7. Still red on this branch, pre-existing

`packages/cli` has three failures that are **byte-identical before and after**
this work, inherited from commit `25ed848b13` (the RC1/RC3 batch):

- `parity.test.ts > reproduces the committed baseline exactly` — the port's own
  self-regression baseline, which the RC1/RC3 generation changes legitimately
  invalidate. Needs regenerating (this is the *port's* baseline, not the C
  oracle's — that one must never be regenerated from the port).
- `parity.test.ts > all golden scenarios pass` — `descend: monsterCount:
  expected 33, got 44`, same cause.
- `parity-c-stat.test.ts` — the species metric, retired in `NOISE-FLOOR.md`.
