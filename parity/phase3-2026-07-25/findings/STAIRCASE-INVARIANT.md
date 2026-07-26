# Unreachable staircases: an upstream wart, carried by the bug-fixes mod

Date: 2026-07-25, **reversed and re-landed 2026-07-26**
Branch: `p3/s3-fix`
Task: #36 (was "~4% of depth-60 levels have no walk-reachable down stair"), #37

## 0. Outcome, and the reversal that produced it

This began as a core guarantee. It is now an **opt-in bug-fixes mod flag**,
`bugfix.stairsReachable`, default OFF, and **faithful core keeps the wart**.

The owner's first ruling (2026-07-25) was:

> There must never be a floor that doesn't have a reachable up AND down
> staircase (except town and Morgoth floors). Must be fixed.

It was implemented in core on that basis (commit `437ad97c3`). The next day, once
the measurement and the C citations below were in front of him, he reversed it:

> Did you fix the unreachable stairs bug? We can't fix bugs in the port. Those
> will belong in the bug fixes mod. I only said those couldn't exist because I
> thought that was how the C version worked. Core must retain all warts of the
> reference code.

The reversal is the correct call and the first ruling was made on a false premise
that **I supplied by omission**: I put the decision to him as "investigate and
fix" without first establishing whether vanilla actually holds the invariant. It
does not. Sections 1-2 are the evidence that should have come first.

**The lesson, recorded for future work:** a "core must never do X" requirement is
only safe to implement in core once `reference/src` has been read and confirmed
to agree. Where the reference disagrees, the requirement is a MOD, and the
divergence is a finding. Do not implement first and cite second.

Nothing about the mechanism below changed in the move — only who calls it.

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

Confirmed independently through the full session path (`startGame`, i.e. real
births rather than the bare generator): **12 stranded of 120 sampled = 10.0%**,
the same rate. Those seeds pin the end-to-end test in
`session/qol-defaults.test.ts`.

The earlier "~4% at depth 60" estimate was an undercount: it only tested the
**down** stair, which is the direction that is four times better protected.

## 3. The fix: repair, not re-roll, and not a loosened test

`ensureStairsReachable` (`gen/util.ts`), called inside `cave_generate`'s existing
retry loop (`gen/generate.ts`) **only when `deps.modRules["bugfix.stairsReachable"]`
is true**, next to the monster-maximum check.

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

## 4. Blast radius of turning the flag ON: 184 of 200 levels bit-identical

Terrain hash + monster count + object count over 200 levels (depths 1-80),
flag off vs on:

```
levels compared          : 200
bit-identical to upstream: 184
changed by the fix       : 16 = 8.0 %
```

The 16 that changed are exactly the stranded ones. Because the repair spends no
RNG and adds one grid, monster and object placement is untouched even on those.

Corroborated after the move to the mod: with the flag off, `packages/cli`'s
port-captured baselines (`parity.test.ts`, `stats-baseline.json`, the `descend`
golden) all pass **unchanged from the state they were re-pinned in while the
guarantee was still unconditional in core** — which is only possible if the
repair never moved the stream in either direction.

It is still a generation change, so a character played with the flag on is not
layout-identical to one played without it. The manifest description says so.

## 5. Where it lives now

- Flag: `bugfix.stairsReachable`, declared in
  `packages/web/mods/bug-fixes/manifest.json`, **default false**.
- Implementation: `ensureStairsReachable` in `packages/core/src/gen/util.ts`,
  called from `packages/core/src/gen/generate.ts` under the flag.
- Plumbing: `GenDeps.modRules` (new, mirroring `MakeDeps.modRules` from entry
  12), threaded at BOTH generation entry points —
  `session/boot.ts` `bootLevel` (the birth level; `BootLevelOptions.modRules`,
  fed automatically by `startGame`'s `...opts` spread) and `session/game.ts`
  `makeChangeLevel` (every later level).
- Documented as entry **13** in `docs/modding/BUG_FIXES.md`, including the
  "Our own port code" section, which previously recorded that nothing had ever
  needed migrating out of core. This is the first thing that did.

Both entry points matter: threading only `changeLevel` left the **birth** level
faithful while every subsequent level was repaired. The end-to-end test in
`session/qol-defaults.test.ts` is what caught that, and it exists specifically
because neither a unit test on `ensureStairsReachable` nor an all-flags-off RNG
comparison can detect a loose wire.

## 6. Tests

In `packages/core/src/gen/gen.test.ts`:

- `CONTROL: faithful core strands floors, exactly as upstream 4.2.6 does` — the
  12 measured stranded seeds, asserted to STILL be stranded with no flag. This is
  the guard on the 2026-07-26 ruling: if the repair is ever moved back into core
  unconditionally, or made default-on, this fails and its message says why.
- `bugfix.stairsReachable: a reachable up AND down staircase on every floor` —
  depths 0, 1, 2, 5, 10, 25, 40, 60, 80, 98, 99, 100 x 8 seeds, covering the town
  and both quest floors.
- `bugfix.stairsReachable: repairs every level faithful core strands` — the same
  12 seeds as the control, now repaired. Control + this pair is the power
  validation: same seeds, same generator, only the flag differs.
- `generates valid levels across the deep profile pool` — **weakened on purpose**.
  It used to assert reachability (as "fully-connected"), and depth 60 seed 15004
  — 4 down stairs, none reachable — is what opened this investigation. Asserting
  it would be asserting a property C does not have, so it now checks structural
  validity only and says why in a comment.
- Six mechanical unit tests on a synthetic sealed-pocket level: the repair, the
  spot-choice rule, RNG-state equality (both the repair and the no-op path), the
  under-the-player fallback, the refuse-and-re-roll path, and the quest guard.

In `packages/core/src/session/qol-defaults.test.ts`:

- `CONTROL: a faithful game (no modRules) is born on a stranded floor` and
  `with the flag on, the same seeds are born on a repaired floor` — three
  measured birth seeds covering both directions including a down-only case. The
  end-to-end plumbing guard described in section 5.
- `bugfix.stairsReachable: false` added to `ALL_FLAGS_OFF`, so the RNG-neutrality
  test covers the new flag.

In `packages/web/src/bug-fixes-mod.test.ts`: the manifest guard now expects five
flags, all default-false.

Suites: `pnpm build` clean; core **2636/2636**; content **92/92**; web
**423/423**; cli **38/39**.

## 7. The one still-red test, unrelated to this work

`packages/cli/src/parity-c-stat.test.ts` fails, and it is a true positive that
predates this branch's staircase work:

- 17 `species` divergences — the metric retired in `NOISE-FLOOR.md` as void
  (pits and nests drop 20-60 monsters of one theme per level, so the G-test's
  effective n is levels, not monsters; the port reaches p=2e-97 against
  *itself*). Whether to drop it from the gate's pass/fail set is an open
  decision for the owner.
- 2 real `objFeel` divergences, depths **11 and 12**, p=1.9e-5 — task #31. These
  MOVED (from depths 13/16/19) when RC1/RC3 shifted the generation stream in
  `25ed848b13`, so the per-depth attribution is stream-dependent and the noise
  floor wants re-measuring on current code before any single depth is trusted.

Verified byte-identical before and after the staircase migration (17 species + the
same two objFeel depths at the same p-values), which is further confirmation that
moving the repair out of core moved no RNG.
