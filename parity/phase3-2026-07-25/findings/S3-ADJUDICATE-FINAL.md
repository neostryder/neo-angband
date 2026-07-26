# S-3 fix batch — final adjudication

Date: 2026-07-25
Branch: `p3/s3-fix` (base `d6dcdbf46`)
Method: **code against `reference/`, plus mechanical tests.** The species
statistic has no vote — see `NOISE-FLOOR.md`.

## Why the earlier verdicts were discarded

`S3-BISECT.md` judged this batch by `delta-G` on the per-depth species
histogram and returned "HURTS / redo, do not merge" for RC1, RC3, friends and
room templates. That metric's measured noise is `mean G_null = 572.7`, `max
949.3` — the port against **itself** at a second seed reaches `p = 2e-97`. The
bisect's deltas were 17–35. Every one of those verdicts was a coin flip.

A second review (Opus via Copilot, code-only brief) returned **CORRECT for all
eight** changes. It was right about seven and wrong about RC3, for a reason
worth recording: it verified the C citation, which is accurate, but never
checked what the *port* does after generation. See RC3 below.

Two of the batch's changes also broke existing tests, which nobody had noticed
because the batch was only ever judged by the statistic and the suite was never
run against it. `master` passes `gen.test.ts` 69/69; `d6dcdbf46` fails 2.

## 1. RC1 — `pickAndPlaceDistantMonster` — CORRECT, and now proven

**C** (`reference/src/mon-make.c:1484-1505`): `int attempts_left = 10000;`
then `while (--attempts_left)`, so the body runs exactly **9,999** times. Each
iteration draws `randint0(c->width)` then `randint0(c->height)` — the **full**
map. Rejects non-empty grids; rejects `square_ismon_restrict` **only when
`!character_dungeon`**; accepts on strict `distance > dis`. No relaxation of
`dis`, no retry after exhaustion.

**Pre-fix port** sampled `randint0(width - 2) + 1` (interior only), imposed a
`maxSight + 1` distance floor C does not have, halved `dis` and restarted on
failure, and ran 10,000 iterations. Four real divergences.

**Post-fix port** matches C. The unconditional `MON_RESTRICT` rejection is
correct here because this copy is generation-only (all callers are in
`gen/cave.ts`, where `character_dungeon` is false); the port's separate live
copy at `game/mon-place.ts:739-767` was already correct and correctly omits
that test.

Proven mechanically, not by reading — three assertions in `gen.test.ts`
("pick_and_place_distant_monster search loop"): the first two draw **moduli**
equal `[width, height]` in that order; exhaustion costs exactly
`9,999 x 2 = 19,998` draws with no relaxation; `MON_RESTRICT` is rejected during
generation. **All three pass on the fix and all three fail on pre-fix master** —
moduli come back `[38, 23]`, and the old code *places a monster at
`dis = 10000`*, demonstrating the phantom fallback directly.

## 2. RC3 — generation `curNum` — DEFECT IN FIX, corrected

The underlying finding is **real**. C increments `race->cur_num` at placement
(`mon-make.c:1040-1041`), so `get_mon_num`'s unique gate
(`mon-make.c:257-258`) drops that unique from the very next weighted table. The
port's generation-time `getMonNum` gates on the shared `race.curNum`, which
generation never incremented — so the port kept *offering* an already-placed
unique, spent `pickAux` plus the 60%/10% harder-monster draws on it, and only
rejected it later at placement. That is a genuine RNG-stream divergence.

`race.curNum++` in `gen/util.ts` is the wrong remedy. The port does not
generate into the live cave: `gen/util.ts` `attachMonster` records uniques in a
**level-local** set, and the shared count is established once at the populate
boundary by `countMonsterRaces` (`session/game.ts:1664`, whose own comment
states the contract). Adding a second increment double-counts every monster on
a fresh level. `wipeMonsterCounts` then decrements only **once** per live
monster on the way out, so every descent leaks, and a unique that reaches
`curNum >= maxNum` is refused by `getMonNum` **for the rest of the game**.

Measured, not argued — `startGame(depth 3)` on the unmodified fix branch:

```
depth 3 giant white ant: curNum=14 live=7
depth 3 Fang, Farmer Maggot's Dog: curNum=2 live=1
... every race on the level at exactly 2x
```

**Correction applied.** The increment is removed. Generation instead passes its
level-local placed set into the selection gate: `getMonNum` takes an optional
`uniquePlaced` predicate (`mon/make.ts`), `Gen` exposes a pre-bound
`uniquePlaced` (`gen/util.ts`), and all seven generation call sites pass it.
Same effect on the allocation table as C's early increment, and therefore the
same RNG stream, without touching shared state the live cave owns.

Guarded by "cur_num tracks the live monster count" in `session/game.test.ts`,
which walks a descent through depths 3→7 and compares every race's `curNum`
against its live count. It **fails on the fix as written, passes on master, and
passes on the correction**.

## 3–4. friends / friends-base — CORRECT

`parse_monster_friends` prepends (`mon-init.c:1563-1630`), and
`finish_parse_monster` (`mon-init.c:1756-1830`) reverses only the **race record
list** into `r_info` — it does not touch `friends`, `friends_base`,
`mimic_kinds`, `shapes` or `spell_msgs`. Consumers therefore walk those
sub-lists in **reverse file order**. The port stores them in file order, so it
must reverse. It does. Correct.

## 5. drop / drop-base — CORRECT, with one piece still gated

C prepends **both** directives into one `r->drops` list
(`mon-init.c:1507-1559`), so the two must be combined into one stream and
reversed once, not reversed independently. The binder now does exactly that.

The pack-format half needs a caveat. The `monster.json` diff is **purely
additive**: 163 lines added, **zero removed**, all of it `drop-order` metadata —
so no existing drop data was altered. But of the 43 monsters carrying
`drop-order`, **none interleaves the two directives**: every one draws its
entries from a single directive kind. The metadata is therefore **inert for
vanilla content** — the metadata-less fallback (concatenate once, reverse once)
produces an identical result for every monster in the shipped pack.

So the binder change is the real parity fix and it is observable; the pack
metadata buys nothing today. Keep it only as forward support for mod packs that
*do* interleave, say so in a comment, and make sure the data-exactness work
(#21) and its directive-coverage guard (#27) know the field exists. Do not
describe it as a parity fix.

## 6. room templates / vaults — CORRECT (and the failing test was wrong)

`parse_vault_name` prepends (`generate.c:479-487`), `parse_room_name` prepends
(`generate.c:318-326`), and **neither finisher reverses**:
`finish_parse_vault` (`generate.c:614-618`) and `finish_parse_room`
(`generate.c:450-454`) each just assign `parser_priv(p)`. C therefore walks
both lists in reverse file order, and the port's reversal is right.

The vault test that broke was asserting the wrong thing. `vault.txt` gives
**two** records the name `Round` — a Lesser vault and an Interesting room — and
likewise for `Cross` and `Hourglass`. `vaults.find(v => v.name === "Round")`
silently depended on list order and returned the Interesting room (`hgt 9`)
once the loader was corrected. The selector now names the type it wants, which
is what the test's own title always said. This is a test defect, not a
tolerance being widened: C is still the authority and nothing about the
assertion's substance changed.

## 7–8. mimic kinds / preferred shapes, alternate spell messages — CORRECT

Same list-order argument as 3–4; neither sub-list is reversed by C before its
consumer walks it. Both are unobservable in the species statistic, which is
irrelevant either way now.

## Still open

The other broken test is **not** a regression and **not** resolved. `gen.test.ts`
"generates fully-connected valid levels across the deep profile pool" asserts a
walk-reachable down stair for 38 hand-picked seeds. A 250-seed sweep at depth 60
on **clean master** produces **9 unreachable layouts (~3.6%)**, so the assertion
was never an invariant — the chosen seeds simply dodged it, and the corrected
room order reshuffles which seeds land. Seed 15004 now fails.

That is its own finding, filed as task #36: the port leaves ~4% of deep levels
with no walkable route to a down stair **despite** implementing
`ensureConnectedness` at all six sites C calls it. It needs a decision rather
than a quiet edit, because loosening the assertion is exactly the shape of
change this project forbids.
