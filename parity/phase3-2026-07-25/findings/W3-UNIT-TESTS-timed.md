# W3 unit tests — `player/timed.c` de-abridgement (Lane D)

Branch `p4/ut-timed`, worktree `C:/Repositories/na-wt-timed`. One file changed:
`packages/core/src/player/timed.upstream.test.ts`, **833 -> 1941 lines**.
**No production code was touched** (`git diff master -- packages/core/src/player/timed.ts`
is empty) — the two defects found are reported below, not fixed, per rule 8.

`reference/src/tests/player/timed.c` is 2614 lines and registers **14** test
cases. All 14 already existed in the port by name; the gap was depth, and in
four cases the port's case was testing a **different timed effect from the one
upstream uses**, so the distinguishing behaviour of that case was not covered at
all.

Verification:

```
$ timeout 900 pnpm build          # root tsc -b
  (clean, exit 0)
$ timeout 600 pnpm exec vitest run packages/core/src/player/timed.upstream.test.ts
  Test Files  1 passed (1)
       Tests  14 passed (14)
$ timeout 600 pnpm exec vitest run packages/core/src/player \
      packages/core/src/game/timed-transition.test.ts packages/core/src/effects
  Test Files  26 passed (26)
       Tests  366 passed (366)
$ git diff --stat master -- reference/
  (empty)
```

## Case inventory

Assertion counts are **runtime** `expect()` executions, measured by wrapping the
`vitest` `expect` import in a throwaway instrumented copy of the file (before =
the same instrumentation applied to `git show master:...`). The C column is
static `eq()`/`require()`/`null()`/`notnull()` sites plus the driving table's row
count, because the C's loop-driven cases have no fixed total.

| # | upstream case | C static asserts | C table rows | port before | port after | verdict |
|---|---|---|---|---|---|---|
| 1 | `name2idx0` | 3 | — | 3 | 3 | already complete |
| 2 | `timed_grade_eq0` | 6 | — | 114 | 114 | already complete |
| 3 | `set_timed0` (SLOW) | 10 | 52 | 330 | 330 | already complete (52/52 rows) |
| 4 | `set_timed1` (POISONED) | 10 | 52 | 70 | **282** | **fixed** — was 13/52 rows, now 52/52 |
| 5 | `set_timed2` (CUT pairs) | 70 | — | 653 | **2538** | **fixed** — see below |
| 6 | `set_timed3` (FOOD pairs) | 66 | — | 6 | **1518** | **fixed** — was testing STUN |
| 7 | `set_timed4` (OPP_ACID) | 11 | 104 | 7 | **660** | **fixed** — was testing FOOD; now 104/104 rows |
| 8 | `set_timed5` (SINVIS) | 12 | 104 | 658 | 658 | already complete (104/104 rows) |
| 9 | `set_timed6` (SPRINT/SCRAMBLE) | 78 | — | 5 | **88** | **partial** — was testing OPP_FIRE; see deferrals |
| 10 | `inc_check0` | 59 | — | 9 | **48** | **partial** — lore half not representable; see deferrals |
| 11 | `inc_timed0` (SLOW) | 10 | 80 | 4 | **496** | **fixed** — now 80/80 rows |
| 12 | `inc_timed1` (PARALYZED) | 10 | 80 | 5 | **494** | **fixed** — now 80/80 rows |
| 13 | `dec_timed0` (SLOW) | 10 | 28 | 5 | **179** | **fixed** — now 28/28 rows |
| 14 | `clear_timed0` (SLOW) | 10 | 12 | 52 | 52 | already complete (12/12 rows) |
| | **total** | | | **1921** | **7460** | 12 fixed or already complete, 2 partial |

Every upstream table is now transcribed row-for-row. The rows were generated
mechanically from `reference/src/tests/player/timed.c` by a parser that splits
each `{ ... },` initialiser and maps the C symbols
(`timed_effects[TMD_X].grade->next->max`, `.on_end`, `.on_increase`,
`.on_decrease`, `up_msg`, `NULL`) to the port's equivalents, so the row counts
are exact and not eyeballed: 52, 104, 80, 80, 28 — matching the C.

### The mismapped cases (the real find)

Four `it()` blocks carried an upstream case name but exercised a different
effect, which meant the *reason* the upstream case exists was untested:

| case | upstream effect | what the port tested | what was therefore uncovered |
|---|---|---|---|
| `set_timed3` | `TMD_FOOD` | `TMD_STUN`, 6 asserts | grades with **`down_msg`**, i.e. the `newGrade.grade < currentGrade.grade && newGrade.downMsg` branch of `playerSetTimed`, over all 36 FOOD grade pairs |
| `set_timed4` | `TMD_OPP_ACID` | `TMD_FOOD`, 7 asserts | the **`temp_resist` notify suppression** (`player-timed.c:828-833`) across all 104 rows |
| `set_timed6` | `TMD_SPRINT` / `TMD_SCRAMBLE` | `TMD_OPP_FIRE`, 5 asserts | the `on_begin_effect` / `on_end_effect` transition dispatch |
| `set_timed2` | CUT, all grade pairs | CUT, but only 2 of 4 `(notify, disturb)` combinations and **none** of the four boundary sub-blocks | at-maximum / below-minimum coercion within and across grades |

`set_timed2` was structurally present but abridged in three ways, all now closed:
only `(T,T)` and `(F,F)` of the four `(notify, disturb)` combinations were run;
the `if (s_l < s->max)` within-grade increase/decrease sub-blocks were absent;
and all four `!s->next` / `!s->grade` / `!e->next` / `!e->grade` boundary
sub-blocks were absent.

## Deferred, with reasons

1. **`inc_check0` — the `lore` half.** `player_inc_check(p, idx, lore)`
   (`player-timed.c:923-1029`) branches on `lore`: the lore path reads
   `p->known_state` and must not trigger learning, the non-lore path reads
   `p->state` and does. The port's `playerIncCheck(effect, queries, hooks?)`
   takes **one** query set and has no `lore` parameter, because the port has no
   `known_state` twin (documented deferral, `packages/core/src/player/player.ts:43`).
   Roughly half of the C's 59 assertion sites are lore assertions or the paired
   "learning did not happen" `require`s; they are not representable at this
   layer. The non-lore half is ported in full, across all five `TMD_FAIL_`
   codes. The `TMD_FAIL_FLAG_TIMED_EFFECT` block is complete rather than
   partial, because upstream states there is no lore/non-lore difference for it
   (`player-timed.c:1005-1010`). See defect **UT-T-001** below — this deferral
   has a live behavioural consequence.

2. **`set_timed6` — the downstream chain outcomes.** Upstream asserts on
   `player->timed[TMD_SLOW] > 0` after SPRINT lapses and on the
   `player->stat_map` permutation after SCRAMBLE begins/ends. Both are produced
   by `effect->on_begin_effect` / `on_end_effect`, which `player_set_timed`
   dispatches through `effect_do` (`player-timed.c:873-891`). The port routes
   that dispatch through the documented `onTransition` hook so `player/timed.ts`
   stays free of the effect interpreter, and `stat_map` is not part of
   `PlayerTimedTarget` (which models only `timed`). At this layer the port now
   asserts the result/message/disturb behaviour of all nine upstream
   transitions, that `onTransition` fires with the correct
   `(idx, begin, canDisturb)` **exactly** on a 0<->positive transition and never
   on a within-grade change, and a data guard that the chains are actually bound
   (`sprint.onEndEffect` deep-equals
   `[{ effect: EF.TIMED_INC_NO_RES, subtype: TMD.SLOW, dice: "100" }]`).
   The chain *outcomes* are already covered against the **real wired game** in
   `packages/core/src/game/timed-transition.test.ts` (4 tests, audit 01 T2),
   which asserts `p.timed[TMD.SLOW] > 0` after `playerClearTimed(sprint)` and
   the stat permutation/restoration for SCRAMBLE. Nothing is uncovered; the
   coverage is split across two layers.

3. **Two universally-dead upstream branches, deliberately not ported.**
   - `timed.c:713-751` (`else if (!s->grade)` nested inside `if (s_l < s->max)`)
     is unreachable for **any** effect: the implicit "off" grade always has
     `s_l == s->max == 0`, so the enclosing `s_l < s->max` is false there.
   - In `set_timed3`, both `else if (!s->grade)` (`timed.c:960-990`) and
     `else if (!e->grade)` (`timed.c:1188-1213`) are unreachable because the C's
     loops start at `grade->next`, so `grade >= 1` throughout.

   These are noted in comments at the corresponding points in the port rather
   than shipped as dead test code.

## Defects found — reported, NOT fixed

### UT-T-001 `player_inc_check`'s `lore` mode is not modelled; the lore caller reads the live state — MEDIUM

`player_inc_check(p, idx, true)` must resolve its fail conditions against
`p->known_state` (`player-timed.c:930-933, 962-965, 979-982, 993-996`), i.e.
against what the player has *learned*. Upstream's only `lore=true` caller is
`mon-lore.c:92` and `mon-lore.c:101`, which recolour a monster's spell recall.

The port's counterpart is `packages/core/src/game/lore-color.ts:49-71`, and it
builds its `PlayerIncCheckQueries` from `state.playerState` — the live derived
state (`ps.flags`, `ps.elInfo`, `ps.pflags`), the same source
`makeIncCheckQueries` (`packages/core/src/game/player-side.ts:65-83`) uses for
the **non-lore** callers. So both modes read `p->state`.

Observable consequence: a player who is wearing an unidentified item granting
`PROT_CONF` sees the monster-recall text for a confusion attack already coloured
as harmless, before learning the flag. Upstream would keep it dangerous-coloured
until `known_state` picks the flag up. It cannot leak the other way (the port
never treats an unknown flag as known), so it is an information leak in monster
recall, not a mechanical divergence in what actually lands.

Root cause is the pre-existing deferred `known_state` twin
(`packages/core/src/player/player.ts:43`), so this is a wiring consequence of a
known gap rather than a new bug in `timed.ts`. Fixing it needs the `known_state`
twin plus a `lore` parameter (or a second query set) on `playerIncCheck` —
outside Lane D's scope.

### UT-T-002 `set_timed3`/`set_timed4`/`set_timed6` were testing the wrong effect — test defect, FIXED here

Not a production defect, but worth recording as the reason the abridgement was
invisible: because each block still carried the correct upstream case name and
passed, an inventory by case name showed 14/14 present. It took reading the C
case bodies to see that `set_timed3` never touched `TMD_FOOD`. Any future
"ported case count" claim about this file should be read as a count of names,
not of behaviour, unless the effect under test was checked too.

## Bite-proofs (rule 6)

Four breaks, each in `packages/core/src/player/timed.ts`, each reverted with
`git checkout` afterwards (verified: `git diff master -- .../timed.ts` empty).

For each break I also ran the **pre-existing** tests — master's
`timed.upstream.test.ts` plus `timed.test.ts` and `timed-custom.test.ts`, 41
tests — to show the break is caught *only* by the new coverage. **All four
breaks pass all 41 pre-existing tests.**

### Proof 1 — `set_timed3` (the FOOD `down_msg` grade branch)

Chosen because `set_timed3` is the only case that exercises grades carrying a
`down_msg`, and it was the most heavily abridged (6 -> 1518 assertions).

Break: drop `notify = true` from the downward-grade branch of `playerSetTimed`.

```
  } else if (newGrade.grade < currentGrade.grade && newGrade.downMsg) {
    say(newGrade.downMsg, effect.msgt);
-   notify = true;
```

```
   ✓ set_timed0    ✓ set_timed1    ✓ set_timed2
   × set_timed3
     → expected false to be true // Object.is equality
   ✓ set_timed4 ✓ set_timed5 ✓ set_timed6 ✓ inc_check0
   ✓ inc_timed0 ✓ inc_timed1 ✓ dec_timed0 ✓ clear_timed0
AssertionError: expected false to be true // Object.is equality
```

Pre-existing tests with the same break: `Test Files 3 passed (3) / Tests 41 passed (41)`.
Master's `set_timed4` FOOD stub only ever called with `notify = true`, so the
dropped `notify = true` was invisible to it; the new `notify: false` downward
rows are what bite.

### Proof 2 — `inc_timed1` (the NONSTACKING guard)

Chosen because `inc_timed1`'s entire reason to exist is `TMD_FLAG_NONSTACKING`,
and 32 of its 80 rows are the blocked-increase groups; the port had 5 assertions.

Break: off-by-one in the guard, `> 0` -> `> 1`.

```
-  if (effect.nonStacking && p.timed[effect.index]! > 0) {
+  if (effect.nonStacking && p.timed[effect.index]! > 1) {
```

```
   × inc_timed1
     → expected true to be false // Object.is equality
AssertionError: expected true to be false // Object.is equality
```

Pre-existing tests: `Test Files 3 passed (3) / Tests 41 passed (41)`. Both old
nonstacking tests set the duration to 4 or 5 before re-increasing, so `> 1` still
blocked them; the new rows with `inn: 1` are what bite.

### Proof 3 — `dec_timed0` (forced notify on lapse)

Chosen because `player_dec_timed`'s only behaviour of its own is forcing
`notify` when the effect lapses (`player-timed.c:1101-1105`), and the port had 5
assertions for a 28-row table.

Break: the lapse boundary, `newValue > 0` -> `newValue >= 0`.

```
   const newValue = p.timed[effect.index]! - v;
-  if (newValue > 0) {
+  if (newValue >= 0) {
```

```
   × dec_timed0
AssertionError: expected false to be true // Object.is equality
```

Pre-existing tests: `Test Files 3 passed (3) / Tests 41 passed (41)`. The old
tests only decremented *past* zero (2 - 5 = -3), never *to* exactly zero, so the
`>= 0` boundary was untested; the new `{ inn: 90, dec: 90, notify: F,
notified: T }` row is what bites.

### Proof 4 — `set_timed4` (the `temp_resist` notify suppression)

Chosen because this is the behaviour the mismapped `set_timed4` never tested at
all, and it is a two-term conjunction whose terms the 104-row table separates.

Break: the suppression conjunction, `&&` -> `||`.

```
       effect.tempResist !== -1 &&
-      q.knownResist(effect.tempResist) &&
-      q.isImmune(effect.tempResist)
+      (q.knownResist(effect.tempResist) || q.isImmune(effect.tempResist))
```

```
   × set_timed4
AssertionError: expected false to be true // Object.is equality
```

Pre-existing tests: `Test Files 3 passed (3) / Tests 41 passed (41)`.
`timed-custom.test.ts` sets both terms true, and `set_timed5` sets both false, so
neither separates `&&` from `||`; the new table's `immune: false` rows cycle
through all three ways the C's `randint0(3)` makes the conjunction fail
(`state=0/obj_k=0`, `state=3/obj_k=0`, `state=0/obj_k=1`) and rows 2 and 3 are
what bite.

## Notes on fidelity choices

- **Randomised C setup made deterministic.** `set_timed4` and `set_timed5` use
  `randint0(3)` to pick one of three ways for the notify-suppression predicate to
  fail. Both ported blocks cycle through all three deterministically instead, so
  the coverage is a superset of any single C run and the test cannot flake.
- **`rand_range` values differ from the C's.** The loop cases use the port's
  seeded `Rng`, so the concrete durations are not the C's. The property under
  test (which grade band a value falls in, and the relation between old and new)
  is preserved, which is what the C's `rand_range(s_l, s->max)` is for.
- **Empty-string messages.** The port binds an absent `on-end` /
  `on-increase` / `on-decrease` to `""` (`bind.ts:716-718`, `joinLines`), and
  `playerSetTimed` guards on truthiness, matching
  `print_custom_message`'s `if (!string) return;` (`obj-util.c:1128`). Where the
  C table names a NULL message (`OPP_ACID.on_decrease`, `SINVIS.on_decrease`),
  the ported row therefore expects *no* message; an explicit
  `expect(onDec).toBe("")` precondition is asserted so the row is not silently
  vacuous.
- **Preconditions ported, not assumed.** Every C `require(...)` guarding a
  table's meaning is ported: `temp_resist != -1`, `oflag_syn && oflag_dup !=
  OF_NONE`, `s_l <= s->max`, `e_l <= e->max`, `nonStacking` true for PARALYZED
  and false for SLOW, and the `notnull(f)` fail-chain searches (now
  `expect(...).toBeDefined()` plus an exact flag-name check).
- **`FOOD` grade scaling verified.** The C multiplies FOOD grade maxima by
  `z_info->food_value` at parse time (`player-timed.c:320-322`) but does **not**
  scale `lower_bound` (`player-timed.c:591-611`). The port matches
  (`bind.ts:638,651` scale, `lowerBound` unscaled), so `set_timed3`'s bands are
  `[1,100] [101,400] [401,800] [801,1500] [1501,9000] [9001,10000]`. Checked
  because a mismatch here would have made the whole FOOD loop test the wrong
  numbers.

## Things I am not certain about

- **`set_timed6` `canDisturb` semantics.** Upstream passes `source_none()` when
  `can_disturb` is true and `source_player()` otherwise
  (`player-timed.c:878-889`); the port collapses this to a `canDisturb` boolean
  on the `onTransition` hook. I assert the boolean arrives correctly, but I did
  **not** verify that the port's chain runner then makes the same
  `source_none()`/`source_player()` choice — that lives in `session/game.ts`'s
  `runTimedTransition` and is outside this file. Worth a targeted check by
  whoever owns the effect-source wiring.
- **`set_timed6` assertion count (88) is not comparable to the C's 78 static
  sites.** Much of the C's count is `for (i = 0; i < STAT_MAX; ++i)
  eq(player->stat_map[i], i);` loops, which have no counterpart at this layer
  (deferral 2). I did not attempt to make the numbers line up; treat row 9 of
  the inventory as "partial" and read the deferral, not the number.
- **`inc_check0`'s 48 vs the C's 59** likewise mixes ported and
  not-representable assertions. I judge the non-lore half complete, but that is
  a judgement about which C lines are lore-only, not a mechanical count.
- **One assertion is beyond upstream**, flagged in the test as such: that a
  *positive* `res_level` must not inhibit a `TMD_FAIL_FLAG_VULN` check. The C
  test only sets `-1`; I added the positive case because `player-timed.c:974-977`
  explicitly comments on the resist/vuln asymmetry, so it seemed worth pinning.
  It is an addition, not a port.
