# W3-5 batch player — LANDED AND REVIEWED

13 files, 68 tests, all passing on `p4/ut-player`. `pnpm build` (root `tsc -b`)
clean.

The batch was originally written on `p3/ut-player` (`d483d0131`) by a stream that
died mid-run (Grok HTTP 402), so it shipped with no author's report and 3
failures. Every file has now been reviewed line-by-line against
`reference/src/tests/player/`, and the files were taken **individually** with
`git checkout d483d0131 -- <path>` off current master — the branch as a whole was
never merged (its merge-base `796e63fbd` is far behind and a merge would revert
a day's work on the parity gate).

`p4/ut-player` is based on `ced815427`. Master advanced to `df8e968bd`
(`p4/ammo-guard`, which guards the same `ammo_tval` session wiring referenced
below) while this ran; the base is an ancestor of it and none of the files here
overlap that commit, so it fast-forwards cleanly. No production code is touched:
the diff is 12 new test files, one rename, and this document.

## The three original failures

### UT-P-001  adjust_hp_precise saturation — CLOSED, was a real defect, fixed
Fixed on master in `276697879`. The C saturates its int32 fixed-point
ACCUMULATOR (`player-util.c:539-545`); it does NOT clamp `chp` to int16, so the
fixture's `-32768` is `INT32_MIN / 65536`. The test passes **unchanged**;
verified here, no edit to the file's expectations.

### UT-P-002 / UT-P-003  calc_inventory "not idempotent" — CLOSED, test bug
Not a port defect. The `verifyStability` helper passed `{ ammoTval }` on the
first `calcInventory` and **nothing** on the second, so the two calls were not
the same experiment — it measured the argument default. Upstream requires the
second pass to reproduce the first *given the same player state*
(`calc-inventory.c:231-263`), because `earlier_object` reads
`player->state.ammo_tval` off the global player (`player-calcs.c:952-959`).
Fixed by threading identical opts into both calls. No caching was added to
`gear.ts` (a `Gear.quiverOrder` cache was tried and deliberately reverted on
master); the live `state.playerState.ammoTval` wiring at the two
`session/game.ts` call sites is already correct.

## Name collision resolved

Master and the branch both had `packages/core/src/game/util.upstream.test.ts`,
ported from **different** upstream files. Both were renamed so the source is
unambiguous, matching the `<upstream-basename>.upstream.test.ts` convention:

| upstream C | port test |
| --- | --- |
| `reference/src/tests/object/util.c` | `game/obj-util.upstream.test.ts` (was master's `util.upstream.test.ts`, content unchanged, header updated) |
| `reference/src/tests/player/util.c` | `game/player-util.upstream.test.ts` (from the branch) |

## Per-file review

Tests that could not fail as written are called out; each rewrite cites the C
and was proven to bite by breaking the production path it covers.

### `game/calc-inventory.upstream.test.ts` — REWRITTEN (9 tests)
Four defects:
1. `expect(spear.flags.has(OF.THROWING) || true).toBe(true)` — `X || true` is a
   tautology. Upstream's `require(of_has(obj->flags, OF_THROWING))` (L379) is a
   real precondition: without OF_THROWING the `@v1` inscription would not send
   the spear to the quiver and the whole fixture is vacuous. Now asserted
   properly, and the same check added for the dagger (L465).
2. `hasKind(TV.MAGIC_BOOK)` guarded a **tautological else-branch** that built
   the expected pack **from the actual pack** and compared them. The premise was
   also wrong: the port does synthesise book kinds
   (`registerBookKinds`, `player/spell.ts` — the port of
   `init.c write_book_kind`); the test simply never called it. It now does, so
   `only pack` and `equipped/pack/quiver` use upstream's fixtures verbatim
   including the MAGIC_BOOK / NATURE_BOOK / PRAYER_BOOK rows. This is not
   cosmetic: three more pack items change `pack_slots_used`, which changes the
   `n_stack_split <= n_pack_remaining` split budget in `calcInventory`.
3. `oversubscribed quiver` replaced upstream's exact `pack_out`
   (`{SHOT,2,40}, {SHOT,3,17}`, L501-505) with
   `expect(overflow.length).toBeGreaterThanOrEqual(2)` — satisfied by almost any
   wrong answer. Now the exact multiset.
4. `kind()` silently fell back to "any ordinary kind of this tval" when
   `lookupKind` missed, so a fixture could quietly test a different object.
   Upstream's `populate_gear` fails the test instead; now it throws.

Also: `verifyPack`/`verifyQuiver`/`verifyStability` returned bare booleans, so
every failure printed `expected false to be true` — which is precisely why the
original batch could not tell a test bug from a port bug. They now return
readable rows compared with `toEqual`. Upstream's slot accounting
(`curr_slot + slots_for_quiver == n_slots_used`, L170) is asserted exactly,
using the C's own `quiver_size` loops rather than a value derived from the port.

**Proof it bites.**
- Inverting the ammo preference in `earlierObject` (`player/calcs.ts` L1351-1352,
  `player-calcs.c:948-956`) →
  `equipped/pack/quiver`: `expected [ '4/1 x10', '4/2 x5', '9/1 x1', …(7) ] to deeply equal [ '2/1 x13', '2/2 x3', '9/1 x1', …(7) ]`;
  `oversubscribed quiver`: `expected [ '4/1 x40', … ] to deeply equal [ '3/1 x40', … ]`.
- `nsplit = qSlot / mult` → `- 1` in `calcInventory` (`gear.ts` L658) →
  `split pile for quiver`: `expected [ '-', '27/1 x7', … ] to deeply equal [ '-', '27/1 x8', … ]`.

**Not portable:** upstream's `upkeep->inven[]` ORDER. `calcInventory` implements
only the quiver half; `gear.pack` is the raw listing and is deliberately not
re-sorted (display ordering is a UI concern, `gear.ts` L620-622). Pack CONTENTS
and counts are asserted as an order-insensitive multiset; the order is not
faked. `verify_quiver`'s `total != p->upkeep->quiver_cnt` check (L225) likewise
has no counterpart — the port keeps no `quiver_cnt` — but the same aggregate is
covered by the `pack_slots_used` assertion.

### `game/combine-pack.upstream.test.ts` — REWRITTEN (4 tests)
Same two structural problems: a silent `kind()` fallback, and STAFF stacks
standing in for upstream's two MAGIC_BOOK rows on the false premise that the
port has no book kinds. Now uses the real fixture. Boolean helpers replaced with
row diffs.

**Proof it bites.** `objectAbsorb(obj2, obj1, ORIGIN.MIXED)` → `obj2.origin` in
`combinePack` (`gear.ts` L792, `obj-gear.c:1242-1323`) → `combine_pack mixed`
fails on the origin row.

### `game/digging.upstream.test.ts` — REWRITTEN (1 test)
The original was **structurally incapable of failing.** It called
`playerBestDiggerDigging(equipment, gearObjects, weaponSlot, cb)` — which takes
plain arrays and holds no reference to the player — with a hand-written
"stand-in for calc_bonuses" callback, then asserted `p.chp`/`p.csp` unchanged.
Nothing in the exercised code could touch them, and the real tunnel command
(which is where the C's side effect would occur) was never invoked.

Rewritten to drive the actual command path: `installCaveCommands` +
`processPlayer` with `{ code: "tunnel", dir: 4 }` (upstream's
`cmdq_push(CMD_TUNNEL)` / direction 4, L190-193), then `findPath` over rubble.
`state.bestDiggerDigging` is wired from the **production** closure
(`session/game.ts` L688-709: `playerBestDiggerDigging` + `calcBonuses({ update:
false })`) rather than a stand-in — `update: false` is the property under test.
Two guards were added so the fixture cannot go vacuous: the swapped-in digger
must actually beat the wielded weapon's DIGGING, and the autoswap must actually
be reached (call counter) at both sites.

**Proof it bites.**
- `state.actor.player.chp -= 1` in `tunnelAux` (`cave-cmd.ts` L485) →
  `expected 49 to be 50`.
- `state.actor.player.csp -= 1` in `rubblePenalty` (`player-path.ts` L387) →
  `expected 29 to be 30`.

### `game/inven-carry-num.upstream.test.ts` — REWRITTEN (10 tests)
The three "partial quiver" tests each ported only the **first** of upstream's
**four** fill/assert blocks: 9 of 12 blocks were silently dropped, and
`n_flask_miss` never appeared at all — exactly the flask/thrown-item
interactions with the quiver, the hardest part of `inven_carry_num`. All 12
blocks are now present with upstream's formulas (`inven-carry-num.c:307-680`).

`fill_pack_quiver`'s `pack_is_full()` and `object_is_carried()` guards
(L169-283) were also missing, so a fixture that silently failed to fill would
have left every later expectation meaningless; they are now assertions.
`performOne` returned a boolean, hiding the numbers; it now returns the value.

Upstream's second `inven_carry_okay` cross-check has no independent content in
the port (`inven_carry_okay` *is* `invenCarryNum(obj) > 0`, `mon/steal.ts` L104)
and is deliberately not faked.

**Proof it bites.** Reverting the GR-01 guard in `invenCarryNum`
(`nAddPack > 0` → `>= 0`, `gear.ts` L567, `obj-gear.c:763`) → 6 of 10 fail,
e.g. `expected 40 to be 8`, `expected 40 to be 9`, `expected 40 to be +0`.
Four of those six are blocks the original file did not contain.

### `game/inven-wield.upstream.test.ts` — REWRITTEN (14 tests)
`expect(oldSlots).toBeGreaterThanOrEqual(0)` — `packSlotsUsed` is a count, so
this can never fail. It replaced upstream's real
`pack_slots_used(player) == old_slots + 1` (L445), which is now asserted.

The three "full pack" tests had also been re-fixtured away from upstream and
reduced to `expect(equipCnt(...)).toBe(1)` — true by construction after any
successful wield. They now use upstream's fixtures (`SOFT_ARMOR`→`HARD_ARMOR`;
`HELM 1`→`HELM 2 x3`; `BOW 1`→`BOW 2`) with the full portable assertion set, and
`floor/single/filled` / `floor/stack/filled` were realigned to upstream's
`TV_AMULET` and `TV_DIGGING`/`TV_HAFTED`.

**Proof it bites.** `objectSplit(obj, obj.number - 1)` → `- 2` in `wieldObject`
(`gear.ts` L931) → 3 tests fail with `expected 2 to be 1`.

**Not portable** (both reported below, not worked around):
`total_weight` (no counterpart), the stack-wield object identity (UT-P-004), the
`pack_overflow` tail (UT-P-005), and the second half of `ring_two` — upstream
`inven_wield(obj, slot)` takes the slot, so "replace ring N" is expressible;
the port's `invenWield(state, handle)` derives it (`obj-cmd.ts` L206-212). What
is checkable — the third ring displaces one of the two, the other stays worn,
the displaced one returns to the pack — is asserted.

### `player/timed.upstream.test.ts` — set_timed5 REWRITTEN (14 tests)
`set_timed5` exists to test notify suppression when a worn item is **known** to
supply the effect's synonymous object flag. The original ported only the
grade-UP path (where suppression is overridden by the up message anyway), so it
asserted nothing about suppression — its own comment admitted this. Upstream's
full 112-case table is now ported, including the grade-DOWN, same-grade-increase
and same-grade-decrease blocks where `has_known_flag` genuinely silences the
notification, plus the at-maximum block. Upstream's `randint0(3)` choice among
the three ways for the predicate to fail is covered deterministically by
cycling, so all three are exercised.

**Proof it bites.** Changing the suppression predicate from AND to OR in
`playerSetTimed` (`player/timed.ts` L327-330, `player-timed.c:838-843`) →
`set_timed5` fails.

**Reported, not filled in:** the other `timed.c` tests remain heavily abridged
(2614 C lines → 668 TS). `set_timed3` (360 C lines), `set_timed4` (226),
`set_timed6` (161), `inc_check0` (245), `inc_timed0` (164), `inc_timed1` (164)
and `dec_timed0` (102) are each compressed into a handful of assertions. What is
there is fixture-driven and sound — no tautologies — but coverage is a fraction
of upstream's. `set_timed0`, `set_timed1`, `set_timed2` and `clear_timed0` are
full ports.

### `score/pscore.upstream.test.ts` — STRENGTHENED (6 tests)
`expect(r2.scores[1]!.pts).toBeGreaterThanOrEqual(r2.scores[2]!.pts)` checked one
adjacent pair of a three-element list. Now the whole list's points are asserted
exactly and `highscoreCmp` ordering is checked across every adjacent pair.

Otherwise sound. The port stores typed fields where the C stores fixed-width
null-terminated strings, so the parts of `highscore_valid1` that probe string
encoding have no counterpart; the typed analogue (non-finite numerics) is
documented in the file header, and the ordering / insert / regularize logic is
exercised directly.

### `player/history.upstream.test.ts` — STRENGTHENED (1 test)
A faithful port, but upstream's assertions go vacuous if the chart walk only
ever takes one successor. Added a coverage check that both `A0 -> cb` and
`A1 -> cc` occur across the (deterministic, seeded) 100 iterations. Flagged as
non-upstream in the file.

### `game/player-util.upstream.test.ts` — LANDED AS-IS (2 tests)
All upstream fixture rows transcribed exactly, including the commented-out
`INT16_MIN` mana row correctly omitted. The port has no `upkeep->redraw` mask,
so `PR_HP`/`PR_MANA` are asserted through the predicate that sets them
(`p->chp != old_16`, `player-util.c:574-576`) — an exact translation, not a
weakening.

### `game/pathfind.upstream.test.ts` — LANDED AS-IS (1 test)
Exact 1:1 port. Keypad literals come from the C's `DIR_*` enum
(`cave.h:44-54`), verified; using the port's own constants would have been the
weaker choice.

### `player/birth.upstream.test.ts` — LANDED AS-IS (1 test)
### `player/playerstat.upstream.test.ts` — LANDED AS-IS (2 tests)
Exact 1:1 ports of `test_generate0`, `test_stat_inc`, `test_stat_dec`.

### `game/obj-util.upstream.test.ts` — RENAMED ONLY (3 tests)
Master's file, content unchanged; only the path and the header's upstream
reference were touched to resolve the collision.

## NEW candidate findings — reported, NOT fixed

### UT-P-004  inven_wield stack split reverses object identity and remainder position
- ref: `reference/src/obj-gear.c:947-968`; test `inven-wield.c:243-273`,
  `310-348`, `534-577`
- port: `packages/core/src/game/gear.ts:929-938` (`wieldObject`)
- Upstream splits the single wielded item OFF the stack
  (`object_split(obj, 1)`), inserts it into `p->gear` **immediately before** the
  original, and equips the split. The original object stays in the pack at its
  existing gear-list position holding `number - 1`.
- The port equips the **original** handle and pushes the remainder onto the
  **end** of `gear.pack`.
- Counts are identical. What differs is (a) object identity — upstream's
  `require(!object_is_equipped(obj) && obj->number == 2)` cannot hold in the
  port — and (b) the remainder's position in the pack listing. Since the port's
  `gear.pack` **is** the listing (it is not rebuilt by `calcInventory`, unlike
  upstream's `upkeep->inven[]`), (b) is observable: it changes label assignment
  and the order `combinePack`'s back-to-front sweep sees after a stack wield.
- severity: P3. Cosmetic for a single-item gear; affects listing order and
  combine order in a stocked pack.
- confidence: high on the mechanism, medium on the practical impact — I did not
  construct a scenario where the reordering changes a combine outcome.

### UT-P-005  pack_overflow is not called at the tail of inven_wield
- ref: `reference/src/obj-gear.c:1009-1010` and `1345-1390`; test
  `inven-wield.c:534-577`, `580-618`
- port: `packages/core/src/game/gear.ts:20` and `:387` (documented as DEFERRED)
- Upstream ends `inven_wield` with `combine_pack(player); pack_overflow(old);`,
  so wielding into a full pack drops the displaced item on the floor and it is
  no longer carried (`square_object(cave, player->grid) == obj1`,
  `pack_slots_used == old_slots`). The port keeps it and lets the pack sit one
  slot over `pack_size`.
- This is a **pre-existing, already-documented deferral on master**, not new
  code — surfaced here because these are the first tests to exercise it. Listed
  because it is the reason two upstream assertions are absent.
- The port's current behaviour is pinned by explicit assertions in the two
  tests, so implementing `pack_overflow` will force them to be revisited rather
  than silently diverging again.
- severity: P2. A real gameplay consequence (upstream drops an item; the port
  does not), reachable in ordinary play with a full pack.
- confidence: high.

## Uncertainties, flagged

- **`gearList` ordering in combine-pack.** The test walks `gear.store` insertion
  order as the stand-in for `p->gear`. For these four fixtures that is right
  (nothing is removed mid-test), but it is not a general equivalence, and it is
  the same ordering UT-P-004 says can diverge after a stack wield. If
  `combine_pack` is ever tested after a wield, this helper needs revisiting.
- **Book svals.** `registerBookKinds` assigns svals in class-table order with no
  book kinds in `object.txt`, so `lookup_kind(TV_MAGIC_BOOK, 1)` resolves to the
  same book in both implementations. I verified the algorithm matches
  `init.c:208-256` and that the port produces 5 magic books with distinct svals
  1..5 (`player/spell.test.ts`), but I did not diff the resolved book NAMES
  against a C build. If they differ, `only pack` / `equipped/pack/quiver` are
  testing a differently-named book at the same sval — the counts and slots would
  still be correct.
- **`registerBookKinds` and `ordinaryKindCount`.** `init.c write_book_kind`
  increments `z_info->ordinary_kind_max` (L224); the port's
  `registerBookKinds` pushes onto `reg.kinds` without bumping
  `reg.ordinaryKindCount` (set once in `ObjRegistry`, `obj/bind.ts:724`), so
  synthesised books sort as "special" kinds by the
  `kidx >= ordinaryKindCount` test (`obj/bind.ts:982`). I did not chase what
  that affects and it is **outside this batch's scope** — noting it as a lead,
  not a finding.
- **`inven-wield` fixture tvals.** Upstream's `floor/single/filled` uses
  `TV_AMULET` and `floor/stack/filled` uses `TV_DIGGING`/`TV_HAFTED`; the
  original port test used cloaks and helms. I realigned them to the C. Both
  choices exercise the same seam, so this is fidelity rather than a fix.
- **`gen.test.ts` flake.** `full level generation > generates valid levels
  across the deep profile pool` times out at 5000ms when the whole suite runs in
  parallel, and passes in 2357ms when run alone. Unrelated to this batch (the
  diff touches no generation code) and pre-existing.
