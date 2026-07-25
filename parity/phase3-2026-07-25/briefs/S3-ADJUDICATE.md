# Brief — adjudicate the S-3 fix batch on CODE evidence only

You are an independent adversarial reviewer. Repo root is the current working
directory. `reference/` is the authoritative Angband 4.2.6 C source and is
READ-ONLY — never modify anything under it.

## What you are judging

Commit `d6dcdbf46` on branch `p3/s3-fix` ("S3 fix attempt 1: RC1 + RC3 + six
prepend-order defects"). Read the diff with
`git show d6dcdbf46 --stat` then `git show d6dcdbf46`.

Its own description is in `parity/phase3-2026-07-25/findings/S3-FIX.md`.

## ABSOLUTE RULE: the statistic is withdrawn — do not use it

A prior review arbitrated this batch using `delta-G` on the per-depth monster
**species histogram** and concluded most changes "HURT". **That metric is
invalid and its verdicts are void.** Reasons:

1. Monster placement is **clustered** — a single pit or nest drops 20–60
   monsters of one theme onto one level. The G-test assumes independent
   observations, so the effective sample size is the number of LEVELS, not the
   number of monsters. G is therefore wildly overdispersed and its p-values are
   meaningless.
2. No noise floor was ever measured, so nobody knows whether a `delta-G` of
   ±100 is signal or seed noise. The same change swings from −260 to +297
   across depths with no consistent sign, which is what pure noise looks like.

**You must not cite `delta-G`, the G-test, p-values, or
`parity-c-stat.test.ts` output as evidence for or against any change.** If a
change is correct C parity, it stays correct even if the statistic gets worse.
Judge **only** whether the port's post-fix behaviour matches the C.

The project mandate is **exact parity**: the C source is the sole authority.

## Method

For each of the 8 changes below, answer: **does the post-fix port behave
identically to the C, and if not, exactly where does it diverge?** Cite
`reference/src/<file>.c:<line>` for every claim. Verify the citation says what
the claim says — do not trust `S3-FIX.md`'s own citations, re-read them.

Where behaviour depends on the RNG, state the **exact draw sequence** (which
function, which argument, in which order, how many times) for both C and port.

### The changes

1. **RC1** — `pickAndPlaceDistantMonster`, port `packages/core/src/gen/util.ts`,
   authority `reference/src/mon-make.c:1483-1520`. Check specifically: the
   iteration count implied by `while (--attempts_left)` with
   `attempts_left = 10000`; full-map vs interior-only coordinate range and the
   x-then-y draw order; the `(!character_dungeon) && square_ismon_restrict`
   guard (does the port gate it on generation-vs-play the same way?); strict
   `>` vs `>=` on the distance test; `break`-then-place vs return; and the
   exhaustion path.
2. **RC3** — generation `curNum`, port `packages/core/src/gen/util.ts`,
   authority `reference/src/mon-make.c:1030-1046`, unique gate at
   `reference/src/mon-make.c:257-258`. **Check this in particular:** C reads
   `if (new_mon->original_race) new_mon->original_race->cur_num++; else
   new_mon->race->cur_num++;`. Does the port's fix handle the
   `original_race` (shapechanged monster) branch, or does it unconditionally
   increment the current race? If it ignores `original_race`, that is a defect
   in the fix — report it. Also check for double-increment against the
   pre-existing level-local `placedUniques` guard and the `attachMonster` call
   in `packages/core/src/gen/cave.ts`.
3. **friends** and 4. **friends-base** reversal, port
   `packages/core/src/mon/bind.ts`. C builds these with
   `new->next = old_head` in `reference/src/mon-init.c:1563-1630`. Establish
   whether `finish_parse_monster`
   (`reference/src/mon-init.c:1756-1830`) — or ANY other code before the
   consumer walk — reverses these particular sub-lists. It reverses the *race
   record* list into `r_info`; that is not the same thing. Then decide whether
   the TS reversal makes the port match or breaks it. Consumers:
   `reference/src/mon-make.c:1385-1421`.
5. **drop / drop-base** combined single list, port
   `packages/content/src/records.ts`, `packages/content/src/specs/mon-init.ts`,
   `packages/core/src/mon/bind.ts`. C prepends BOTH directives to one
   `r->drops` list (`reference/src/mon-init.c:1507-1559`). Verify the port
   preserves one interleaved cross-directive stream and reverses it exactly
   once. Separately: the change adds a `drop-order` field to the compiled
   content pack. Assess whether the emitted pack still matches
   `reference/lib/gamedata/monster.txt` exactly. Note there is **no**
   `data-exactness` test in this checkout, so treat pack exactness as
   UNVERIFIED unless you verify it yourself by direct comparison.
6. **room templates / vaults** reversal. C:
   `reference/src/generate.c:450-461` (parser) and the pit finisher
   `reference/src/mon-init.c:2190-2220` which explicitly copies backwards into
   file order. Determine, per loader, whether the list reaching the consumer is
   in file order or reverse order in C, and whether the TS reversal matches.
7. **mimic kinds / preferred shapes** reversal. C reservoir walk:
   `reference/src/mon-make.c:902-915`. Note `one_in_(1)` semantics when
   deciding whether list order is observable at all.
8. **alternate spell messages** reversal. C:
   `reference/src/mon-init.c:1442-1502` and the consumer that selects a
   message.

## Verdicts

Use exactly one per change:

- **CORRECT** — post-fix port matches C. Cite the C and the port line.
- **DEFECT-IN-FIX** — the underlying finding is real but this implementation is
  wrong. State the precise correction.
- **NOT-A-DEFECT** — the pre-fix port already matched C; the "fix" introduces a
  divergence. Cite the C proving the original was right.
- **UNVERIFIABLE** — cannot be settled by reading C. Say what mechanical test
  would settle it (a concrete assertion, not "more sampling").

## Output

Write your report to
`parity/phase3-2026-07-25/findings/S3-ADJUDICATE.md`. Change no other file. Do
not commit. Structure: one section per change, verdict first, then the C
citations, then the port citations, then the divergence, then the correction.

Be adversarial. Assume each claim is wrong until the C says otherwise. If a
citation in `S3-FIX.md` does not support what it is cited for, say so
explicitly — that is a finding.
