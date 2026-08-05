# Every item that still needs porting

**Dated 2026-08-04, last worked 2026-08-05.** The work list derived from
[DEFERRALS.md](DEFERRALS.md), which is the accounting of what was found and how
each verdict was reached. This one is the checklist, ordered so the things a
player would notice come before the things only a developer sees, and so the
items that unlock others come first of all.

**67 items covering all 111 confirmed-absent citations** — 31 closed, 36 open.
It started at 65; **2.20 and 1.3 were added by reading**, not by the census, and
both landed in tiers this file had already worked through — 2.20 in one it had
declared *closed*. **Seven of the thirty-one closures are retractions rather than
work** — **2.16** asked for a call upstream does not make, **2.1**'s own scope was
overstated by a factor of seven, and **2.15** and **2.13** were already built and
named by stale `DEFERRED` comments on NEIGHBOURING functions. That is now a
recognisable failure mode rather than an accident: a keyword census cannot tell a
stale note from a real absence, so an item whose evidence is a comment needs the
function read before any work is planned. 2.15's neighbourhood then yielded a real
gap, and 2.13's yielded four missing tests. Both are written up in place, because a
corrected item is worth more than a deleted one: the shape of the error is the
reusable part.

**5.2 is the seventh, and it is the *other* recurring shape.** The player-notes
command is fully built and fully tested; the row called it "confirmed absent by
reading" on the strength of a grep for `HIST_USER_INPUT`, which the port spells
`HIST.USER_INPUT`. That is the same **failed transliteration** that overturned
four wizard-tier verdicts, surfacing again in a tier nobody had swept for it — so
the sweep was not thorough, it was scoped to one tier. Every remaining row whose
evidence is "grep found no `SOME_C_IDENTIFIER`" is suspect until the port's own
spelling has been tried.

> ### Correction, same day: the first cut of this list put finished work on it
>
> Adjudicating the second tranche started by re-reading the wizard rows, and
> **the entire wizard-mode tier was already built.** `runPlayItem` with
> upstream's full `A/K/S/R/T/C/Q` submenu, `runChangeQuantity`, `runWriteMap`,
> the three Monte-Carlo collectors, `runStatItem`, `runSpoilers` over
> `spoilObjDesc` / `spoilArtifact` / `spoilMonDesc` / `spoilMonInfo`, and
> `ArtifactState` as `aup_info[]` serialized in the save. Nine items, all done.
>
> The cause was mine and it was mechanical: several verdicts rested on greps for
> a **camelCase transliteration** of the C name — `changeItemQuantity`,
> `playItem`, `storeInit`, `showFloor` — which the port never uses. It calls them
> `runChangeQuantity`, `runPlayItem`, `storeChooseOwner`, `showFloorList`. Four
> of the eight verdicts resting on that evidence shape were wrong: a 50 % error
> rate, in the direction of inventing work.
>
> `parity/tools/deferral-crosscheck.mjs` is the instrument that catches it: for
> every `real` row it greps the port for the **C name**, which this codebase
> reliably cites in a comment beside its port. `real` fell from 85 to 68 and
> `ported` rose from 3 to 19.

> ### Second correction: reading all 21 leads killed nine more items
>
> Tier 0.2 is now done, and the estimate it carried — "assume roughly a quarter
> of the items below are already built" — was close. Of 21 leads, **eight
> overturned**, and the ledger tranche overturned more. Closed on evidence:
> the monster-recall hit percentages (wired at `packages/web/src/main.ts:3650`
> and `:3652`, with `screens.test.ts:929` asserting the real number reaches the
> screen), `spreadMonsters`' missing caller (`gen/cave.ts:1721`, `:1865`),
> `list_object`'s oidx bookkeeping (a ratified substitution, not a gap),
> `equipCmpCategories`' iteration (`game/equip-cmp.ts:391`), find-on-sight
> history (`game/known.ts:461`), `dump_history` (`web/src/charsheet.ts:504`),
> the `'~'` knowledge menu, the town-book expansion, `store_stock_list`'s sort,
> `purchase_analyze` / `comment_accept`, and `apply_autoinscription`.
>
> **The same failure recurred and the same instrument caught it.** Four ledger
> notes asserted a seam was empty because "the ported timed registry carries no
> `oflag_dup` / `temp_resist` field" — it carries both (`obj/effects-info.ts:76`,
> `:80`), and `player_flags_timed` is ported at `player/calcs.ts:1100`. The gaps
> were real; every stated *reason* was wrong, and each one made the work look
> like a subsystem when it is one call.
>
> **And reading found a live gameplay defect nobody had recorded as one.**
> `p->upkeep->total_weight` is never summed — see **1.2**. It was sitting under a
> note that called it a display counter and handed ownership downstream.

A citation here is a `file:line` from `parity/reports/deferral-census.tsv` or
`parity/reports/ledger-deferred-items.tsv` whose verdict is `real` or `partial`.
A `divergence`, `n-a` or `note-is-fix` row is not work, and its reason is in
DEFERRALS.md's appendix. Both tranches are counted, because an item whose only
citation was a ledger row used to sit outside every guard.

## What "tiered" means here

| Tier | Test for membership |
|---|---|
| **0** | The list cannot be trusted until this is done |
| **1** | Unlocks other tiers; doing it later means doing downstream items twice |
| **2** | Changes what *happens* — mechanics, and in one case RNG draw order |
| **3** | Changes what the player is *told* — the numbers and text on screen |
| **4** | A whole mode nobody has begun |
| **5** | History, files and logs |
| **6** | **Closed.** Wizard mode is ported; see the correction above |
| **7** | A decision to take, not code to write |

Tier order is priority, not dependency; dependencies are named on the item.

Do not tick a box on the strength of having written the function — and do not
add one on the strength of a name not being found. A tick means **the behaviour
is reachable in play and a test constructs the case that used to be wrong.**

---

## Tier 0 — Make the list trustworthy

- [ ] **0.1 Adjudicate the ledger `deferred:` items. 135 of 331 done.**
  `parity/reports/ledger-deferred-items.tsv` holds items the keyword census
  structurally could not see: an entry under a `deferred:` key inherits meaning
  from the key and mostly does not repeat the word. Adjudicated so far:
`ui-display`, `ui-player`, `ui-entry`, `wizard-debug`, `game-gear`,
  `obj-knowledge`, all four `store-*`, `player-history`, `obj-desc`, `mon-lore`,
  `mon-lore-describe`, `game-effect-terrain`, `game-effect-teleport`,
  `game-player-path` and `game-mon-cmd`. That is **47 `ported`, 19 `stale-doc`,
  13 `divergence`, 5 `not-a-deferral`, 3 `n-a`, 2 `note-is-fix` against 28 `real`
  and 18 `partial`** — so **two rows in three were not owed work**, and the owed
  ones include the two live defects at **1.2** and **2.17**, both since FIXED —
  and 2.17's first verdict was wrong in a way worth reading, because the
  instrument was a grep. **196 remain.**
  Adjudicate with
  `node parity/tools/deferral-verdict.mjs --target parity/reports/ledger-deferred-items.tsv`,
  reading order from
  `node parity/tools/deferral-triage.mjs --target parity/reports/ledger-deferred-items.tsv --hint likely-real`.
  The fastest reading aid is
  `node parity/tools/deferral-crosscheck.mjs --target parity/reports/ledger-deferred-items.tsv --verdict ""`,
  which names the port file mentioning each row's C symbol. Then bring the
  scanner under the ratchet the way the census already is.
  Sites: `parity/reports/ledger-deferred-items.tsv`

- [x] **0.2 Read the 21 cross-check leads. Done — 0 unread.**
  `node parity/tools/deferral-crosscheck.mjs` now reports
  `0 UNREAD … 13 already read`, because a read lead is recorded by writing
  `LEAD READ` into the row's evidence. That marker is the point: without it the
  tool re-prints every lead forever, and a list that never shrinks is the same as
  no list — a row that stayed `real` after being read is indistinguishable from
  one nobody opened. Eight of the 21 overturned; see the second correction above.
  Sites: `parity/tools/deferral-crosscheck.mjs`

## Tier 1 — Foundations that unlock other rows

- [x] **1.1 `notice_stuff` / `PN_*` — the one architectural gap.** DONE.
  No `noticeStuff` and no `PN_*` pipeline anywhere. Root cause of both **2.5**
  (`PN_IGNORE` set and never consumed) and **3.1** (the monster-message queue
  has nowhere to be flushed from). The sibling `PU_*` / `PR_*` update-and-redraw
  flags are *not* owed — the front end recomputes and repaints after every
  state-changing action, a ratified divergence recorded at
  `packages/core/src/game/known.ts:153`. `PN_*` is different: a queue of work,
  not a dirty bit, and nothing else does that work.
  Sites: `packages/core/src/game/context.ts:297`

  **Built as upstream builds it**: `PlayerUpkeep.notice` is a real bitfield
  (`packages/core/src/player/player.ts:33`), `PN` is two constants
  (`packages/core/src/player/types.ts`), and `noticeStuff`
  (`packages/core/src/game/notice.ts`) is the only thing that clears a bit. Every
  one of upstream's eight `notice_stuff` call sites is wired — the two in
  `process_player` (`game/player-turn.ts`), the three in the world loop
  (`game/loop.ts`), and `on_new_level`'s own raise-then-drain at all four of the
  port's level-entry paths (`noticeNewLevel`). So are the raise sites — **17
  `|= PN.COMBINE` and 8 `|= PN.IGNORE`**, counted by grep, not estimated — across
  `gear.ts`, `obj-cmd.ts`, `effect-item.ts`, `world.ts`, `mon-side.ts`,
  `chest.ts`, `pickup.ts`, `wizard.ts`, `ignore-cmd.ts`, `notice.ts` and
  `session/game.ts`. Two of those (inscribe, uninscribe) raise both and so appear
  in both counts, as upstream does.

  **`PN_MON_MESSAGE` is deliberately absent, not forgotten.** There is no third
  constant, because `show_monster_messages` has no port (**3.1**) and a bit
  nothing raises and nothing consumes is exactly what made `PN_IGNORE` look
  ported for months. It goes in with the message queue or not at all.

  Two design points worth keeping:
  - **The order is load-bearing.** `ignore_drop` raises `PN_COMBINE` on its way
    out, and because the ignore branch runs first that combine happens in the
    *same* pass. Swapping the branches defers it a turn and breaks nothing
    visible — so `notice.test.ts` asserts it.
  - **An unbound combiner leaves the bit raised.** `combine_pack` needs z_info
    sizing that `GameState` does not carry, so it is a session-bound closure like
    `overflowPack`. Rather than clear a bit whose work it could not do,
    `noticeStuff` leaves `PN_COMBINE` set — a worldless harness *owes* the
    combine instead of silently forgetting it, which is the failure mode of every
    other optional seam in `context.ts`.

  **How it hid, and what it cost.** The comment that owned the notice mask said
  it "lives in `game/gear.ts`". It lived nowhere. The same shape recurred at the
  inscribe/uninscribe commands, whose omission was excused as "UI bookkeeping
  this port doesn't model (combine already runs lazily on the next
  `inven_carry`)" — `inven_carry` absorbs the *incoming* object and never runs
  `combine_pack`, and nothing about inscribing implies a later pickup. Both are
  the [[an-excuse-that-cites-a-sibling]] pattern, now the fourth and fifth
  instances. Live consequences, in descending order:
  1. **The pack was never combined except after a wield or takeoff.** Those two
     sites call `combine_pack` directly in the C, which is why they were ported;
     every one of the fourteen deferred sites was not. Identify two wands, drain
     one to match the other, uncurse, enchant, let a rod recharge — the stacks
     that became identical stayed in separate slots for the rest of the game.
  2. **Un-inscribing never re-merged.** A note is part of the mergeability test
     (`obj/object.ts:844`), so splitting a stack with `=g` and then removing it
     left two slots permanently.
  3. **Becoming aware of a kind dropped nothing** — that is **2.5**.

  13 tests in `packages/core/src/game/notice.test.ts`, each mutation-verified.
  One of them is end-to-end through the real `processPlayer` and names no line
  number at all, because the thing that was broken was not any single line. One
  line covered by no test is *marked as uncovered in the code*: `gearExcise`'s
  own `PN_COMBINE` (`gear.ts`) has exactly one caller, which raises the same bit
  itself, so deleting it kills nothing — measured, and recorded there rather than
  counted as coverage.

  > **Closed here too:** *the `PN_IGNORE` notice pass*, which used to be **2.5**,
  > and a live weight defect found while porting `uncurse_object`'s `PN_COMBINE`.
  > A curse can carry a weight modifier (`object_weight_one`, `obj-util.c`
  > L280-288), so removing one changes what the player carries; upstream tracks
  > `old_weight`/`new_weight` across the whole function (`effect-handler-general.c`
  > L182-237) and the port did not. This is the **fifth** `total_weight` choke
  > point, and it only became a defect when **1.2** made the running total real —
  > before that it adjusted a field nothing read. Same shape as
  > [[a-deferral-note-is-dated-evidence]]. Fixed at
  > `packages/core/src/game/effect-item.ts`.
  >
  > And `wiz_play_item_standard_upkeep` (`cmd-wizard.c` L370) had **no port at
  > all** at any of its six call sites — including one line past where **2.20**
  > stopped last session, whose own docblock said "L1708-1714" when the fourth
  > step is at L1715. All six are wired now through one helper in `wizard.ts`.

- [x] **1.2 Nothing summed the player's carried weight.** DONE (`505c38bae`).
  `player.upkeep.totalWeight` is set to `0` once, in `playerOutfit`
  (`packages/core/src/game/gear.ts:1284`), and thereafter written **only** by the
  wizard quantity editor (`packages/core/src/game/wizard.ts:1470`, `:1471`).
  `calc_inventory`'s weight accumulation has no port at all: there is no other
  writer anywhere in `packages/core` or `packages/web`, and nothing calls
  `objectWeightOne` over the pack. Three live consequences, in descending order
  of how much they matter:
  1. **The carrying-weight speed penalty never fires.**
     `packages/core/src/player/calcs.ts:1216` reads it as `j`, so
     `j > limit / 2` is never true and the player moves at full speed under any
     load. Weight management, a core mechanic, effectively does not exist.
  2. **Shield-bash quality is short by `trunc(totalWeight / 80)`** on every bash
     (`packages/core/src/combat/melee.ts:617`, fed from
     `packages/core/src/game/player-turn.ts:235`).
  3. **The character sheet's Burden line always prints `0.0 lb`**
     (`packages/core/src/game/char-sheet.ts:411`) and `weightRemaining` reports
     the whole capacity as free (`packages/web/src/screens.ts:491`).

  How it hid: the note that owned it called it "the running carried-weight total …
  recomputing it belongs to the calc/inventory owner", and the calc/inventory owner
  never took it. **A deferral that names its successor instead of itself is
  invisible to both of them.**

  **Fixed by porting upstream's own scheme, not by inventing one.** The C does not
  recompute the total; it maintains a running one at four choke points in
  `obj-gear.c` (`inven_carry` L845/L875, `gear_excise_object` L486,
  `gear_object_for_use` L541) and re-sums the whole gear in `load.c:1179-1185`. All
  five are now ported. The load re-sum is also the migration: a character saved by
  any earlier build has a stored total of `0`, and trusting it would leave them
  weightless for the rest of the game. `invenCarry` gained the player argument
  upstream's `inven_carry` already takes, and `Gear` carries the bound curse table
  so `object_weight_one` is exact rather than approximated.

  Proved by `packages/core/src/game/gear-weight.test.ts`, which tests the three
  consequences above rather than the accounting statements and derives its ground
  truth by summing the gear — because the failure mode of an incremental total is a
  mutation that goes around a choke point, and only an independent sum sees that.
  Breaking any one of the four sites kills at least one of its assertions.
  Sites: `parity/ledger/game-gear.yaml:77`,
  `parity/ledger/store-transact.yaml:54`

  > **Closed here:** *feed the combat layer into lore*, which used to be 1.2.
  > `meleeHitPercent` and `monsterHitPercent` are wired at
  > `packages/web/src/main.ts:3650` and `:3652`, and `breathProjection` at
  > `:3659`; `packages/web/src/screens.test.ts:929` asserts the real melee
  > percentage reaches the recall screen. Four interface comments still said
  > `DEFERRED`, which is what kept the item alive.

- [x] **1.3 `process_player_cleanup`'s monster housekeeping ran every ten game
  turns instead of after every player command.** DONE. Found by walking
  `notice_stuff`'s call sites for **1.1** — the two functions are neighbours in
  `game-world.c`.

  `tickMonsterMarks` (`packages/core/src/game/known.ts:977`) is called from
  `processWorld` (`packages/core/src/game/loop.ts:361`), which runs once per **ten**
  game turns. Upstream runs that block in `process_player_cleanup`
  (`game-world.c:867-892`), after **every** player command that spent energy. So a
  monster revealed by detection keeps its `MFLAG_MARK` for up to ten turns longer
  than it should, and `MFLAG_NICE` — the "don't act yet" grace flag — is cleared
  on the same wrong cadence.

  Three things have to move together, and the port currently conflates two of
  them:
  - The `MFLAG_NICE` + `MFLAG_MARK` loop is gated on `!p->upkeep->dropping`
    (L867); the `MFLAG_SHOW` clear at L903-908 is **not**. `tickMonsterMarks` does
    both in one function, so splitting it is part of the fix.
  - `upkeep->dropping` itself has no port. It is set by `ignore_drop`
    (`obj-ignore.c:687`) and cleared at L909, and **1.1** has just made the only
    thing that sets it reachable — so it can be added now without being a field
    nobody writes.
  - The energy accounting and `player_take_terrain_damage` halves of
    `process_player_cleanup` **are** ported, split across
    `game/player-turn.ts` (energy) and `game/loop.ts:613`/`:641` (terrain). The
    natural fix is one `processPlayerCleanup` holding all of it, called from the
    two places that call `playerTakeTerrainDamage` today.

  RNG-free: the housekeeping only clears flags and calls `updateMon`. So this is a
  pure timing correction, but a **perceptible** one — detection fades sooner and a
  FORCE_SLEEP monster starts using its ranged attacks when upstream lets it.

  All three moved. `tickMonsterMarks` is split into `tickMonsterNiceAndMark` and
  `clearMonsterShow` (`game/known.ts`), because one function could not express two
  different guards. `upkeep.dropping` is real, set by `ignoreDrop` and read once.
  And `processPlayerCleanup` (`game/player-turn.ts`) now holds the terrain damage
  as well, called at the end of every do-loop iteration including the
  bloodlust-coercion path — so `game/loop.ts` no longer does the cleanup's job one
  level out.

  **The old test could not have caught this.** `known.test.ts` called the
  housekeeping directly, twice, and asserted the fade logic — which was correct.
  Nothing asserted *when* it ran. The four new tests in
  `packages/core/src/game/player-turn.test.ts` drive `processPlayer` and never
  call the housekeeping themselves; one of them checks `state.turn` never moved,
  so a pass cannot be coming from `processWorld`'s cadence.

  Six mutations, six dead tests — but only after a fix: the free-command test
  first queued `[free, act]`, which ran both guards and so could not tell them
  apart. Removing the `if (energy_use)` guard left it green. It queues one free
  command now and asserts `needsInput`.
  Sites: `packages/core/src/game/loop.ts:361`,
  `packages/core/src/game/known.ts:977`

## Tier 2 — It changes what happens in play

- [x] **2.1 `square_isempty` was weaker than upstream's.** DONE — and **two of
  this item's own numbers were wrong**, in the direction of overstating it.

  **Not 48 call sites: seven, in five modules.** The 48 counted every occurrence
  of the identifier repo-wide, and there were *three* definitions sharing two
  spellings. `gen/util.ts:437` (generation-time, over `Gen`) and
  `mon-place.ts:153` (`squareIsEmptyLive`) were **already faithful**; only
  `context.ts`'s was weak.

  **So it could NOT shift level generation.** `gen/gen-monster.ts` and
  `gen/cave.ts` import the `gen/util.ts` predicate, which has the trap and object
  terms. The claim that this "can shift a whole level's generation" was an
  inference from the call count, not a reading of the imports.

  What was real, and is now fixed:
  - `context.ts`'s version tested **passable** / no monster / not the player. It
    was missing the player trap, the web *and* the object, and `square_isopen`
    requires **FLOOR**, not passable — so a rubble grid counted as empty.
  - The seven sites are `effect-terrain.ts:281`, `:292`, `:766`,
    `mon-ranged.ts:91`, `project-feat.ts:298`, `wizard.ts:1122`,
    `dump-level.ts:95`. Every one mirrors a genuine `square_isempty` call in the
    C (`effect-handler-general.c:2949`/`:2964`, `effect-handler-attack.c:1496`,
    `mon-attack.c:260`, `project-feat.c:283`, `cmd-wizard.c:2608`), so all seven
    wanted the strict test and none wanted the weak one.
  - The weak definition is **deleted**, not repaired: `squareIsEmptyLive` was
    already the faithful port, and the answer to a predicate with two definitions
    is not a third. `context.ts` could not host the strict version anyway —
    the trap and web terms need `game/trap.ts`, which imports `movePlayer` from
    `context.ts`.
  - **`squareIsEmptyLive`'s strict terms were themselves conditional.** It wrote
    `preds?.isPlayerTrap(grid)`, so the trap and web checks evaporated for any
    caller that passed no `preds` — which is every one of the seven. It now
    defaults to `trapPredicates(state)`, needing nothing but the state.

  Seven tests at the end of `mon-place.test.ts` construct each rejection
  (including one that asserts the rubble fixture really is passable, so the
  floor-vs-passable term cannot pass by accident) plus an acceptance case so the
  rejections mean something. Restoring `preds?.` fails the trap and web tests;
  restoring `isPassable` fails the rubble test.
  Sites: `packages/core/src/game/context.ts:1088`

- [x] **2.2 Monster-vs-monster theft ignored `react_to_slay`.** DONE.
  `mon-util.c:1548`. Two of upstream's three `react_to_slay` sites were already
  ported — the player's own pack (`game/mon-side.ts:430`) and a monster's floor
  pickup (`game/monster-turn.ts:1363`) — so this was a lone asymmetry, and the
  comment excusing it cited those two as precedent for skipping it. **An excuse
  that points at code doing the opposite of what the excuse claims is how a gap
  survives review.**

  Fixed at the line that mirrors L1548 rather than in each env builder:
  `StealEnv` gained `thief(midx)` and `slays`, so `mon/steal.ts` calls
  `reactToSlay` itself. `thief` is **required**, unlike the two neighbouring
  thief seams, because it decides whether the theft happens at all — an optional
  version would silently strip the protection again.
  `packages/core/src/mon/steal.test.ts` proves it with a pair on the same seed
  and the same slay-bearing item, differing only in whether the thief's race
  carries the flag; deleting the guard fails the first on both assertions. Its
  default `thief` is a real monster, not null, so `react_to_slay` is actually
  invoked in every test that takes the monster path.
  Sites: `packages/core/src/mon/steal.ts:32`, `:33`, `:231`, `:234`

- [x] **2.3 `alter` (`+`) was missing FOUR branches, and its fall-through was
  free.** DONE — and this item's own count was short by two.
  `do_cmd_alter_aux` (`cmd-cave.c:951-1002`). The note excused this because alter
  was unbound; the shell has bound it since
  (`packages/web/src/main.ts:8090` → `alterCmd`), which made the gap reachable.

  **Not two branches: four.** The note said "the chest branch and the floor-trap
  branch". The missing ones were the floor-trap disarm (L984-986), the trapped
  chest (L987-988), the closed chest (L989-991) **and the open door**
  (L993-995) — so `+` on an open door said "You spin around." The close-door
  branch was simply not counted.

  **And the fall-through spent no energy, which upstream forbids in writing.**
  L961 sets `energy_use = move_energy` *before* the dispatch, and the comment
  above the function says why: *"This command must always take energy, to prevent
  free detection of invisible monsters."* Returning 0 on the "You spin around."
  branch made `+` a free probe of any adjacent square — exactly the thing that
  comment exists to stop. This is the most consequential line in the item and it
  was in neither the note nor the census.

  Confusion is applied up front here and the chest lookups use the *redirected*
  grid (L964-972), unlike `do_cmd_open`, which tests before and re-resolves
  after. Same RNG draw; different grid. Worth not copying the open/disarm shape.

  Six tests in `cave-cmd.test.ts`, six mutations, six dead tests — after two of
  my own fixtures turned out unable to fail:
  - the trapped-chest test first used a skill of 0 and asserted "still locked".
    Deleting the whole trapped branch left it green, because the openable path
    fails its roll too and leaves the chest locked as well. The discriminator has
    to be an outcome only one branch can produce: disarm **negates** `pval`, open
    zeroes it.
  - `do_cmd_disarm_chest` early-returns *"I don't see any traps"* unless the trap
    has been FOUND (`obj-chest.c:702-704`, `knownPval`), so the branch was a
    no-op in either direction until the fixture set it.
  - two more fixtures silently hit the darkness penalty: both aux functions
    divide the disarm skill by ten when `no_light`, and `makeState` never runs the
    view pass, so a "high skill" fixture still failed its roll. Recorded in the
    helper.

  *Cross-check lead READ:* `do_cmd_alter` is named in
  `packages/web/src/context-menu.ts:164`, which collapses upstream's
  "Attack"/"Alter" into one entry and relies on core resolving the grid — so the
  menu needed no change, and now behaves correctly because core does.
  Sites: `packages/core/src/game/cave-cmd.ts:1045`

- [x] **2.4 The chest `OF_TRAP_IMMUNE` rune was never learned.** DONE, and it
  was worse than "two copies of the same empty branch."

  **Both branches were UNREACHABLE, not merely empty.** Each read
  `env.playerHasFlag?.(OF.TRAP_IMMUNE)`, and *nothing in the repository ever
  supplied `playerHasFlag` to a chest env*: `session/game.ts` gives it to the
  trap env (`:1632`) and omits it from the chest env (`:1692`). Filling the
  bodies in would have produced dead code that reads as ported — so the
  predicate is now answered from the state, which no caller can forget.

  A near-miss worth recording: my first grep for `playerHasFlag` covered
  `game/**` and `web/**` and reported **no supplier anywhere**, which would have
  made floor-trap immunity look broken too. It is supplied — from `session/**`,
  which the grep never looked at. *A single-directory grep is not a census
  either.*

  Along the way, `player_of_has` had **three byte-identical private copies**
  (`effect-general.ts`, `mon-side.ts`, `player-side.ts`) and a fourth was about
  to be written; there is now one, `playerOfHas` in `game/context.ts`.

  Four tests in `chest.test.ts` set the state up through the real
  gear/equipment path rather than stubbing the env, so they would fail on the
  unreachable version. Their docblock records what they do **not** pin: swapping
  `playerOfHas` for `playerIsTrapsafe` leaves them green, because
  `equipLearnFlag` self-guards — measured, not assumed.
  Sites: `packages/core/src/game/chest.ts:268`, `:346`

- [x] **2.5 Run the `PN_IGNORE` notice pass.** DONE (with **1.1**).
  Set at `packages/core/src/session/game.ts:542`, never read, so becoming aware
  of a kind never dropped the newly-ignored items. `ignoreDropTargets` existed
  (`packages/core/src/game/ignore-cmd.ts:45`) and the menu / `K` trigger *was*
  reproduced — only the become-aware trigger was missing.
  Sites: `packages/core/src/game/context.ts:297`,
  `packages/core/src/session/game.ts:542`,
  `packages/core/src/obj/knowledge.ts:1366`

  `ignore_drop` itself is now core (`ignoreDrop`, `game/ignore-cmd.ts`), which is
  the part that mattered: the shell held the **only** copy of the queue-a-drop
  rule, so the pass could only ever run from a keypress. Both callers now share
  it, and `state.noticeIgnore` — a bespoke boolean that stood in for the bit — is
  gone in favour of the real `PN_IGNORE`.

  **The one thing core cannot do is confirm an equipped item.** Upstream asks
  `verify_object` inline (`obj-ignore.c` L666); every confirmation in this port is
  the shell's and asynchronous, and `notice_stuff` runs inside the synchronous
  turn loop. So `ignoreDrop` *returns* those targets rather than deciding them,
  and the notice pass leaves them alone — which is complete rather than a gap,
  since an untouched target is still ignore-eligible and the confirm-capable
  `=` / `K` pass offers it on the next press. What core must **not** do is write
  `"!d"` on the player's behalf; upstream only does that after a real refusal, and
  a test asserts core does not.

  Also ported here: `background_command` (`PlayerCommand.background`). Upstream's
  auto-drops are queued with `background_command = 2`, which exempts them from the
  bloodlust coercion roll (`cmd-core.c:360`). Without it `processPlayer` would
  draw `randint0(200)` for every auto-drop and move every later draw in the turn —
  asserted as a draw **count**, not as a property of the flag.

- [ ] **2.6 `known_only` does not exist.**
  `obj-info.c` calls `calc_bonuses` with `known_only = true` at six sites; the
  port passes no such flag. `calcs.ts:606` says known_only callers "pass false so
  the derive stays pure" and `:721` lists it among what is deliberately not
  derived. **Wider than first scoped**: `prt_ac` and the character sheet's combat
  panel both read the real state, so an unlearned `+to_a` rune is included in the
  AC the player is shown (`ui-display.yaml:120`, `ui-player.yaml:75`).
  Sites: `parity/ledger/player-calcs-bonuses.yaml:78`,
  `parity/ledger/ui-display.yaml:120`, `parity/ledger/ui-player.yaml:75`

- [x] **2.7 `pile_insert_end` is absent.** CLOSED as a RETRACTION — the row named
  the right function and got its mechanism **inverted**, in a way that would have
  caused a regression if acted on as written.

  It said ordering "inside a **floor** pile can differ from upstream's
  append-at-end". Upstream's floor does not append at the end. Census of the two
  primitives in 4.2.6:

  | site | primitive | order |
  |---|---|---|
  | `floor_carry` (obj-pile.c:960) | `pile_insert` | **prepend** |
  | `inven_carry` (obj-gear.c:867, via `gear_insert_end`) | `pile_insert_end` | append |
  | `calc_inventory` splits (player-calcs.c:1101, :1164) | `pile_insert_end` | append |
  | `load.c:1419` floor restore | `pile_insert_end` | append (saved order) |
  | `wield_all` (player-birth.c:503) | `pile_insert_end` | append |
  | `obj-knowledge.c:896, :927, :952` | `pile_insert_end` | the **known** cave |

  The port already matches every one of those: the floor is an array with newest
  FIRST (`floor.ts` `pile.unshift`), the pack is `gear.pack.push` at all three
  gear sites, `deserializeFloor` maps the saved array 1:1, and `wieldAll`'s
  docblock already records the deferred-append behaviour. The cited instrument
  (`pile.upstream.test.ts:28`) says the true thing in its own header — "nothing in
  the live port appends to a floor pile (floor_carry always prepends)" — which is
  parity, not a gap. The three `obj-knowledge.c` sites are the **known-object
  shadow cave** and belong to open item **2.9**, not here.

  Closed by ADDING the tests it lacked, because a retraction with no test is the
  next bug. What was genuinely untested was the **append** side — the item's real
  subject — plus the floor's prepend, which nothing pinned:
  - `inven_carry` APPENDS: `gear.test.ts` asserts the handle order `[a,b,c]`, not
    a length or membership (a prepend gives `[c,b,a]` and must be distinguishable).
  - `floor_carry` PREPENDS: a **negative control**, so that acting on this row's
    wording and "fixing" the floor into an append fails loudly.
  - `load.c:1419`: a save/load/re-save round trip comparing the pile's `kindId`
    order to the saved order.

  Mutation-verified: `pack.push`→`unshift` kills 1, `pile.unshift`→`push` kills 2
  (including the pre-existing upstream instrument), and reversing
  `deserializeFloor` kills 1. **My first draft of that last assertion compared
  `pile.map(...)` to `pile.map(...)` — a tautology that could not fail whatever
  the loader did.** It is now compared against the re-saved projection.
  Sites: `packages/core/src/game/gear.ts:1315`

- [x] **2.8 `path_analyse` is absent.** DONE — and this one's description was
  accurate, which after 2.3, 2.12 and 2.15 is worth saying.

  It is the correction that makes infravision honest: you sense a warm-blooded
  monster through grids you have never lit, so a remembered WALL between you and
  it cannot be real, and it gets un-remembered. Without it the player's map keeps
  contradicting what the player can see.

  Everything it needed already existed — `projectPath`, `featIsLos`,
  `squareForget`, `sqinfoOff` — so this was a missing CALL more than a missing
  function, and the call site said `path_analyse ... DEFERRED` a line above the
  place it belonged.

  Three details measured against the C rather than reasoned about:
  - the test reads the **remembered** feature (`square_allowslos(player->cave,
    ...)`, mon-util.c:224), not the live one. A grid whose memory is a wall is
    forgotten even when the live terrain is floor — that is the entire point, and
    substituting the live feat kills two tests;
  - an **unknown** grid counts as blocking. Upstream's `player->cave` holds
    `FEAT_NONE` there, and `name:unknown grid` in `terrain.txt` carries **no flags
    at all** — so no LOS — which means `path_analyse` clears `SQUARE_SEEN` on
    unknown intervening grids too. Treating unknown as transparent is the
    "helpful" reading and it is wrong; there is a test that pins it;
  - the loop stops at `path_n - 1`, excluding the monster's own grid.

  Five tests in `known.test.ts`, driven through `updateMon` rather than by calling
  `pathAnalyse` directly, because the gap was the wiring. Six mutations, six dead
  tests.
  Sites: `packages/core/src/game/known.ts:750`

- [ ] **2.9 The known-object shadow cave.**
  Re-scoped by reading. `pushObject` **is** ported and called
  (`packages/core/src/game/effect-general.ts:190`,
  `packages/core/src/game/effect-terrain.ts:347`), and `list_object` /
  `delist_object`'s oidx bookkeeping is now recorded as a **divergence** — the port
  replaced upstream's `cave->objects[]` registry with a grid-keyed pile map plus
  `obj.mimickingMIdx`, which `become_aware` reads and the save persists, so nothing
  observable depends on an oidx. What is left of the row is `player->cave`, the
  remembered floor-pile contents, and the mimicked-object half that rides it.
  Sites: `packages/core/src/game/floor.ts:18`

- [ ] **2.10 `object_flag_is_known` at the store sites.**
  The answer is available — `equip-cmp.ts:413` synthesises the `obj->known`
  shadow for exactly this question — and the store's buy check does not use it.
  Sites: `packages/core/src/store/store.ts:232`, `:262`,
  `parity/ledger/store-maint.yaml:34`

- [x] **2.11 The `OSTACK_LIST` stacking checks.** CLOSED as a RETRACTION —
  **nothing in Angband 4.2.6 ever passes `OSTACK_LIST`**, so all three checks are
  unreachable upstream too.

  One grep settles it. Every `OSTACK_*` argument in the C tree is PACK, QUIVER,
  MONSTER, STORE or FLOOR — `cmd-pickup.c:133`, `mon-util.c:1375`,
  `obj-gear.c:209`/`:211`/`:668`/`:771`/`:834`/`:1259`/`:1278`, `store.c:847` — and
  the only `mode &` tests outside `obj-pile.c` read STORE and QUIVER
  (`obj-gear.c:1196`, `:1216`). `OSTACK_LIST` is declared at `obj-pile.h:33`,
  tested three times (`obj-pile.c:409`, `:410`, `:485`) and **supplied never**: the
  object-list UI that presumably once passed it does not any more.

  The item's claim that "the shadow can answer both" was probably true and is
  beside the point — there is no caller for it to answer *for*. Its citation did
  pass the new line-rot guard, because it pointed at a genuine `DEFERRED:` note in
  the right function. **So the guard is not a filter for this failure mode**: an
  accurate note about an unreachable branch looks exactly like an accurate note
  about a live one. Only reading the callers separates them, which is what closed
  2.10 as well.

  Both notes rewritten from "DEFERRED" to the measurement, and the reachability
  claim is now a **ratchet** rather than a comment:
  `packages/core/src/obj/ostack-list.test.ts` fails the moment any port code
  passes `OSTACK_LIST`, which is the point at which the three checks come due. It
  deliberately asserts nothing about stacking behaviour — the port ignores the
  bit, so such a test would be a tautology dressed as coverage.

  Three mutations, three dead tests — after the guard-on-the-guard was fixed:
  it asserted `toContain("export const OSTACK_LIST")`, and renaming the constant
  to `OSTACK_LIST_RENAMED` left it green, because the new name **contains** the
  old one. A substring assertion about an identifier cannot tell a rename from a
  match.
  Sites: `packages/core/src/obj/object.ts:923`, `:1000`

- [x] **2.12 `cmd_disable_repeat_floor_item`.** DONE — and the item pointed at a
  class with no callers.

  `repeatAllowed` in `cmd.ts` is a static table property, not the runtime
  disable-for-this-item call — **true, and beside the point.** `cmd.ts`'s
  `CommandQueue` is a faithful port of upstream's whole ring buffer,
  `repeat_prev_allowed` and `disableRepeat` and the `cmdq_push_copy` gate
  included, and **nothing drives it**. `packages/core/src/mod/registry-host.ts:15`
  says so in as many words: *"cmd.ts CommandQueue is a faithful port the web loop
  does not drive."* Adding `cmd_disable_repeat_floor_item` there would have been
  exactly faithful and completely inert — the
  [[shipped-is-not-reachable]] shape, arrived at from the other direction.

  The repeat the player gets is the shell re-dispatching `lastRepeatCmd`, and it
  had **no gate at all**. So all **seven** `cmd_disable_repeat` sites and all
  **four** `cmd_disable_repeat_floor_item` sites were unported on the path that
  runs: taking the last of a stack, wielding, a full `combine_pack`, taking the
  last of a floor pile, creating a trap in wizard mode, leaving a store, the
  player changing grid (twice — `monster_swap` has two mirrored branches), an
  object destroyed by a projection at the player's feet, and a level change.

  **The floor case is worse in this port than in the C.** Upstream's guard exists
  to avoid dereferencing an object pointer the command still holds after the
  object was freed; its own comment says so. This port addresses a floor object as
  `args.floor`, an INDEX into the pile under the player. An index does not
  dangle — it **re-binds**. Quaff the first potion off a two-item pile and press
  the repeat key, and index 0 is the other object. `repeat.test.ts` asserts that
  re-binding directly, before asserting the guard, because if it were false the
  whole justification would be.

  `repeat_prev_allowed` lives on `player.upkeep` rather than in a module static,
  and the reason is written at the field: three of its writers are in
  `game/gear.ts`, which sits below `game/context.ts` and cannot see a GameState.
  The alternative was a `disableRepeat?: () => void` threaded through four call
  chains — a parameter every future caller has to remember. `combine_pack`'s
  disable rides a new `combinePackForPlayer` rather than a fourth parameter,
  because eleven of `combinePack`'s fourteen callers are tests with no Player.

  **One of the seven is genuinely not owed, and that is recorded as a finding:**
  `do_cmd_accept_character`'s disable (`player-birth.c:1309`, *"so we don't try to
  be born again"*) guards `CMD_BIRTH_*` sharing a queue with game commands. Birth
  is a shell flow here, not a registry command, so `lastRepeatCmd` can never hold
  a birth step.

  10 tests, 9 mutations. Two survived the first pass and both were fixed rather
  than explained away: the second `monster_swap` branch had no test (every other
  test entered through the first), and the L556 short-circuit turns out to be
  **unobservable** — clearing an already-false flag is a no-op, so no test could
  exist that deleting it would kill. That is marked in the code, not counted.

  > **Found on the way, and it had nothing to do with repeat:** `save.ts` wrote
  > `upkeep: { ...p.upkeep }` while its declared type named three fields. A spread
  > satisfies a narrower type by supplying MORE, so every transient added to
  > upkeep — `notice` and `dropping` earlier today, these two now — had been
  > silently widening the **save format**. The three fields are named explicitly
  > now. The save round-trip guard caught it, which is what it is for.
  Sites: `parity/ledger/cmd-core.yaml:25`

- [x] **2.13 `EF_TOUCH`'s monster-source branches.** CLOSED as a RETRACTION —
  **both branches were already built**, complete and in upstream's order, at
  `packages/core/src/game/effect-attack.ts` `handleTOUCH`. The decoy branch sources
  its ball at a trap and the target-monster branch at `mon->target.midx`, each
  citing its C line.

  The citation points at `castTouch`, a *different function in a different file*,
  whose docblock said the branches were "deferred (#19)". `castTouch` is the base
  player-centred touch and it is correct for it not to have them — they belong to
  the handler. **The same shape as 2.15: a stale note about a neighbouring
  function manufacturing an item.** Comment corrected.

  **But the retraction came with work, because a closed item with no test is the
  next bug.** There was no `EF_TOUCH` test of any kind. Four now, and they are
  worth reading for one reason: my first draft asserted *"the targeted monster is
  hit"* — declared from intuition — and it failed. Upstream sources the ball at
  the target monster ITSELF (`effect-handler-attack.c:431`) and `project_m` returns
  early for its own source (`project-mon.c:1382`, ported at
  `project-monster.ts:149`), so **the victim is exempt from the ball centred on
  it** and only its neighbours are struck. An upstream wart, and one only visible
  by deriving the expectation from the C. Every test now asserts a POSITIVE (a
  bystander adjacent to the intended centre takes damage) as well as the negative,
  so none of them can pass against an effect that did nothing.

  Reachability measured, not assumed: exactly **one** monster spell uses TOUCH in
  4.2.6 — `TRAPS` (`effect:TOUCH:MAKE_TRAP:3`, `monster_spell.txt:1050`) — and a
  monster spell is always `SRC_MONSTER`, so both branches are live. With a decoy
  deployed, a caster that would otherwise ring the *player* with traps rings the
  decoy, which is the entire point of a decoy.

  Four mutations, four dead tests.
  Sites: `packages/core/src/game/project-cast.ts:685`,
  `parity/ledger/game-project-cast.yaml:53`

- [ ] **2.14 Mimic bookkeeping.**
  Targeting is wired; mimicked-object bookkeeping is not.
  Sites: `packages/core/src/game/context.ts:1231`,
  `parity/ledger/game-project-monster.yaml:50`

- [x] **2.15 The book out-of-depth value boost.** CLOSED as a RETRACTION — and
  reading it found a different, real gap in the same function.

  **Both halves of this item were already built.** The `*value` out-parameter and
  its 20 %-per-level out-of-depth boost are ported statement for statement
  (`obj/make.ts` `makeObject`), including upstream's INT32 saturation, and the one
  C caller that passes `value` — `place_object` — passes it
  (`gen/util.ts:1297`, feeding `obj_rating`). The book *rejection* is ported too.
  The citation exists because the function's docblock still said
  *"DEFERRED: book rejection (needs the player class)"* long after
  `deps.canBrowseBook` was added. **A stale note reads as a gap to a keyword
  census exactly as reliably as a real one.**

  **What WAS wrong is the wiring, and it is three things, not one.** The
  player-dependent generation foils — `canBrowseBook`, `timedFoil` and
  `noSelling` — were supplied to `refreshTownStores` and `makeStoreApi`, i.e. to
  both STORE paths, and to nothing else. Level generation took its `objDeps` from
  `genDeps` in `session/boot.ts`, which builds the bundle from the content pack
  alone. So on the path these foils exist for:
  - every book was browsable, so `obj_kind_can_browse`'s rejection
    (`obj-make.c` L1185-1195) never fired — a Warrior found Magic Books at the
    full rate;
  - `append_object_curse`'s TIMED_INC foil (`obj-curse.c` L159-188) never
    rejected a contradictory curse;
  - `make_gold`'s 5× dungeon inflation (`obj-make.c` L1310-1312) never applied to
    a generated floor pile, so `birth_no_selling` was half-on.

  Two of the three are **RNG draws** — a rejected book costs another
  `get_obj_num` and is accepted anyway one time in five; a foiled curse is not
  appended — so the generation stream itself was off upstream's.

  Fixed by making the answer **required**: `genDeps` takes a `GenObjectFoils`
  whose only "nothing to supply" value is the literal `"no-player"`. Three CLI
  stats callers and `bootLevel` say `"no-player"` out loud; the live level-change
  path passes `genFoilFields(state)`. That is a compile-time guard on the call
  site, which is what an optional property could never be.

  Guarded by `packages/core/src/session/gen-foils-wiring.test.ts` — the wiring,
  not the function, for the same reason `quiver-ammo-wiring.test.ts` exists. Both
  its mutations bite. It deliberately has NO behavioural test for the book
  predicate, and says why: spellbooks are not in `object.txt` in 4.2.6 at all
  (`write_book_kind`, `init.c:208`, appends one kind per class book), so
  `makeObject` with a book tval returns null against a registry-only fixture. A
  first draft measured 40 draws against 40 and would have read as "no
  difference" when the truth was "no book was ever picked".
  Sites: `packages/core/src/obj/make.ts:1238`

- [x] **2.16 `history_find_artifact` on a store purchase.** CLOSED — **there is
  no such call upstream, and the one that does exist is already ported.**

  `store.c` contains exactly one `history_find_artifact`, at **L1928**, and
  L1928 is inside **`do_cmd_sell`** (L1869–2008), not `do_cmd_buy` (L1650–1782).
  Its own comment says so: *"Update the auto-history if selling an artifact that
  was previously un-IDed. (Ouch!)"*. This item asked for the call on the
  **purchase** path, where upstream does not make it.

  And the sell path is wired: `session/game.ts:3162` (gear handle) and `:3207`
  (floor object) both call `state.onArtifactFound`, citing `store.c L1928`, and
  fire `onArtifactLost` when the store discards it (L1992).

  The whole-surface check, since a wrong path name is exactly the kind of error
  that hides a second one: `history_find_artifact` has **two** call sites
  upstream — `store.c:1928` and `obj-knowledge.c:971` (inside `object_touch`).
  `object_touch` is called from three places (`cave-square.c:1181`,
  `obj-knowledge.c:1012`, `cmd-wizard.c:1707`); the first two are ported at
  `game/known.ts:461` and `game/pickup.ts:303`. **The third was not** — see
  the wizard finding below, which this check is what surfaced.
  Sites: `packages/core/src/store/transact.ts:26`,
  `parity/ledger/player-history.yaml:160`

- [x] **2.20 `do_cmd_wiz_play_item` skipped two of its four commit steps.**
  NEW, found by walking every `object_touch` caller while closing 2.16 — in the
  tier the first correction at the top of this file declared **closed**.

  Upstream does four things under `if (object_changed)` (cmd-wizard.c
  L1685–1717): re-account `total_weight` when the number or unit weight changed
  *and the object is carried*; `object_touch`; then, **only if equipped**, clear
  the WORN notice and re-run `object_learn_on_wield`; then redraw. The port had
  only the third.

  - The weight step was excused as *"the total_weight / redraw upkeep is UI (the
    shell's)"* — **true when written, false now.** `upkeep.totalWeight` became a
    real running total in **1.2**, so the editor could change an item's quantity
    and leave the burden the speed penalty reads out of step. The sibling command
    `runChangeQuantity` had done the same arithmetic all along (`wizard.ts:1470`),
    so two halves of one wizard screen disagreed. **A deferral note is dated
    evidence, and a fix elsewhere can turn it into a defect.**
  - `object_touch` sits *between* the weight block and the equipped-only branch
    and is **not** gated on `equipped`, so an accepted edit to a pack item marked
    nothing assessed and logged no artifact find.

  `wizPlayItemAccept` now takes the `wizPlayItemBegin` snapshot, because the
  weight diff is against the pre-edit stack. Three tests in `wizard.test.ts`
  pin it, with ground truth from `gearTotalWeight` rather than from restating the
  arithmetic; dropping the weight block, the touch, or the `object_is_carried`
  gate each fails exactly one of them.
  Sites: `packages/core/src/game/wizard.ts:1551`

- [x] **2.17 Twelve of upstream's 53 `disturb()` sites had no port.** DONE
  (`505c38bae`+). **This item previously said "`disturb()` is exported and nothing
  calls it", and that was wrong.** It has eleven importers and 24 call sites, and
  all three things this item called absent — the disturb on taking damage, on a
  status message, and on a monster appearing behind you — were already wired
  (`game/take-hit-hooks.ts`, `session/game.ts` `timedHooks.onNotify`,
  `game/known.ts`). The claim came from greping the port for the C's own spelling,
  `disturb(player)`, which the port never writes: the failed-transliteration trap
  running in the opposite direction.

  The same narrow grep undercounted the **upstream** census, too — the C writes
  both `disturb(player)` and `disturb(p)`, so one spelling found 38 sites where
  there are **53**. The fifteen it could not see included the player's own melee,
  a monster's blow landing or visibly missing, and both run safety-stops that are
  the whole point of the DTrap indicator.

  Redone as a measurement rather than a search, twelve sites were genuinely
  absent, and all are now wired: `py_attack` (`player-attack.c:996`);
  `make_attack_normal`'s connecting blow and visible miss (`mon-attack.c:594`,
  `:721` — neither of which `take_hit` covers, so a 0-damage effect blow was
  silent); the known-trap and DTRAP-edge run stops (`cmd-cave.c:1086`, `:1150` —
  a run walked the player onto their own detected traps and out of the detected
  zone); the two store-door disturbs (`cmd-cave.c:1599`, `player-util.c:1609`);
  autopickup (`cmd-pickup.c:430`, an `env.disturb?.()` seam nothing ever
  supplied); the feeling reveal (`cave-view.c:852`, see the note below); word
  recall and deep descent activating (`game-world.c:794`, `:820`); and arriving on
  a new level (`:1017`).

  > **The feeling reveal deserves its own line, because the near side of the seam
  > was tested.** `cave-view.c:849-853` announces the object feeling the moment the
  > player uncovers enough of a level. The port made that
  > `events.signal("feeling")`, and three tests in `packages/core/src/world/fov.test.ts`
  > proved it fires at exactly the right crossing. **Nothing subscribed to it, in
  > either host** — the event had test subscribers and no production ones, so the
  > message never reached a player and the run never stopped, with a green suite
  > over it. Wired through core's `updateFov`, and the web's byte-identical private
  > copy of that closure — which is what had opted it out — is deleted.

  The instrument is `packages/core/src/game/disturb-census.test.ts`: it parses the
  C, counts both spellings, and reconciles the census against a written reading in
  both directions, so neither a new upstream site nor a deleted port call can pass.
  A grep gave three wrong answers in a row before it existed.
  Sites: `parity/ledger/game-player-path.yaml:94`

- [ ] **2.18 A commanded monster cannot drop what it is carrying.**
  `packages/core/src/game/mon-cmd.ts:720` no-ops `CMD_DROP` with the comment
  "Monster-held objects are not modelled". They **are**: `mon.heldObj` is a real
  pile, `monsterCarry` fills it, and `getRandomMonsterObject` is ported at
  `packages/core/src/mon/steal.ts:54` and used at `:148`.
  Sites: `parity/ledger/game-mon-cmd.yaml:62`

- [ ] **2.19 A commanded monster's blow does nothing but damage to a monster.**
  The monster-target branches of the mon-blow-effect handlers reduce to damage plus
  the critical stun, so blind / confuse / poison and the blinked teleport are lost
  when the victim is a monster. `square_smash_wall`'s neighbour scouring and
  upstream's broken-vs-open door split belong with it.
  Sites: `parity/ledger/game-mon-cmd.yaml:64`, `:68`

## Tier 3 — It changes what the player is told

- [ ] **3.1 `add_monster_message` has no queue.** *(needs 1.1)*
  The grammar is ported verbatim — `get_subject`, `get_message_text`,
  `message_pain`, the `[singular|plural]` state machine. What is absent is
  `add_monster_message` → `mon_msg[]` flushed by `show_monster_messages` from
  `PN_MON_MESSAGE`, so repeats never combine into "3 kobolds die." and deaths
  are not shown last.
  Sites: `packages/core/src/game/mon-message.ts:15`,
  `parity/ledger/mon-timed.yaml:29`

- [x] **3.2 The killer's name is a race name.** DONE. `MDESC_DIED_FROM` was
  defined and unused at both death sites, so the cause read "kobold" where
  upstream writes "a kobold" — `MDESC_SHOW | MDESC_IND_VIS` is the indefinite
  article an ordinary monster gets and a unique does not.

  Two sites, both now `monsterDesc(mon, MDESC_DIED_FROM)`:
  `game/effect-attack.ts:694` (`effect-handler-attack.c:490`) and
  `monsterCastSource` in `game/project-cast.ts:136` — the latter is where every
  monster projection's death cause comes from (`project-player.c:849`), so it was
  handing out the literal string `"a monster"` for all of them.

  **The item's third site was wrong, in the helpful direction.** It said the
  high-score entry "cannot name the killer at all because it is not wired through
  GameState". It is wired: `take-hit-hooks.ts:68` writes `p.diedFrom = killer` and
  `score.ts:98` reads it as `how`. Fixing the two death sites fixed the score row
  with them, and a test walks that chain end to end rather than trusting it.

  Two neighbouring claims CHECKED rather than taken:
  - `effects/handlers.ts`'s `"a monster"` is not a deferral, it is a layering
    fallback — that layer has no monster registry, and the game override supplies
    the name. Its comment said "deferred (8.9)" and had outlived the wiring;
    rewritten.
  - the `Killed <unique>` history line (`session/game.ts:951`) uses `race.name`
    directly under a note claiming `MDESC_DIED_FROM` for a unique is just the race
    name. Read `monsterDesc`: the unique branch returns `stripPhrase(race.name)`,
    and with no `MDESC_POSS` that is the bare name. **The note is right**, and it
    is now right on evidence rather than assertion.

  One deliberate deviation, written at the call site: `monster_desc` appends
  " (offscreen)" when the monster is off the panel, and upstream's death sites
  pass the real panel — so upstream CAN write "Killed by a dragon (offscreen)".
  The port leaves the panel predicate at its default, because plumbing viewport
  state into core for one string is not worth it; the ledger row for the panel
  argument covers it.

  Five tests, three mutations, all three bite — including one that swaps
  `MDESC_DIED_FROM` for `MDESC.SHOW` and so produces the definite article.
  Sites: `packages/core/src/effects/handlers.ts:78`,
  `packages/core/src/game/effect-attack.ts:694`,
  `parity/ledger/high-scores.yaml:96`

- [ ] **3.3 Object and ego recall show no computed lines.**
  Re-scoped down to what survived reading: monster recall's percentages **are**
  wired (see the closed note under 1.2). What is still bare is the object side —
  `desc_obj_fake` (`ui-knowledge.c:1938`) and `desc_ego_fake` (`:1789`) print
  only a name and the record's lore text, where upstream prints
  `object_info(OINFO_FAKE)` / `object_info_ego`'s flag and combat lines. The
  producer exists: `packages/core/src/obj/object-info.ts` already calls
  `chanceOfMeleeHitBase` at `:1090`.
  Sites: `packages/web/src/knowledge.ts:1095`, `:1185`

- [ ] **3.4 Monster spell and breath damage are not bound to the casting race.**
  `deps.spellLoreDamage` (`packages/core/src/mon/lore-describe.ts:149`) is a full
  override with **no supplier anywhere**, so `monSpellLoreDamage` returns 0 and
  upstream's `(N)` is omitted at every spell. Distinct from 3.3: this one is a
  `mon/spell.ts` binding, not a display call.
  Sites: `parity/ledger/mon-lore-describe.yaml:55`

- [ ] **3.5 The sidebar's stat rows ignore equipment.**
  `displayDeps` (`packages/web/src/main.ts:6815`) never supplies `statUse`, and
  the default (`game/display.ts:189`) is race+class adj over `statCur` with **no
  equipment or timed contribution**. The character sheet *does* get the computed
  value (`charSheetDeps` → `ps.statUse`, `packages/web/src/screens.ts:479`), so a
  `+STR` ring changes the sheet and not the sidebar.
  Sites: `parity/ledger/ui-display.yaml:100`

- [x] **3.6 No `PF_*` intrinsic ability ever appears on the character sheet.**
  DONE — and this item was **accurate in every particular**, including the three
  call sites, which by this session's own filter is what a sound row looks like:
  it named where, not why.

  `playerHas` fell back to reading `p.pflags`, a field `Player` genuinely does not
  have, so it answered false for every `PF_*`. `PlayerState.pflags` was computed
  and live the whole time (`player/calcs.ts:418`); it had no route to the grid.

  Closed by `liveUiEntryDeps` (`game/ui-entry.ts`), which supplies **all three**
  `UiEntryDeps` seams from the live state and is now used at all four screen call
  sites — `charsheet.ts:270`, `:379`, `:651` and `equipCmpDeps()`.

  > **This corrected an incomplete close of mine.** The first pass at **3.7/3.8**
  > wired the timed pair into `equipCmpDeps()` only, leaving the character sheet's
  > three `characterGrid` calls untouched — and the character sheet is the screen
  > those two items are about. Reading 3.6 one item later is what surfaced it. A
  > single builder for all three seams is the fix for the class of mistake, not
  > just this instance: wiring a subset is exactly what went wrong twice.
  Sites: `parity/ledger/ui-entry.yaml:128`

- [x] **3.7 Temporary resists never appear in the resist grid.** DONE, together
  with **3.8** — one wiring fix, and **both items blamed the wrong thing**.

  The `UiEntryDeps.timedElementEffect` seam existed and defaulted to `() => 0`
  under a comment saying *"temp_resist is not on the ported timed registry"*. It
  is: `TimedEffect.tempResist` (`packages/core/src/player/types.ts:341`). What was
  missing was a supplier — `equipCmpDeps()` in `packages/web/src/main.ts` returned
  `{ packs, inspectExtras, playerName }` and **no `entryDeps` at all**, so both
  timed seams took their harness defaults in every game.

  See **3.8** for the fix, the tests and the guard; they are the same change.
  Sites: `parity/ledger/ui-entry.yaml:120`

- [x] **3.8 The timed-flag column reads empty.** DONE — with **3.7**, as one
  wiring fix.

  `UiEntryDeps.timedObjectFlags` defaulted to an empty `FlagSet` under a comment
  saying *"no timed OF-flag dups are ported"*. **`player_flags_timed` is ported**,
  at `packages/core/src/player/calcs.ts:1097`, over the same `oflagDup` field this
  seam needs. The PORT_TODO header had already recorded that fact for a different
  item; this row and its comment both still asserted the opposite.

  **The real gap was call sites that passed no deps at all.**
  `liveTimedUiDeps` derives both seams from the live bound timed table, and
  `liveUiEntryDeps` wraps it with the third seam so a screen gets all three at
  once. Both are now passed at all four call sites.

  **The first pass at this was incomplete and 3.6 caught it.** It wired
  `equipCmpDeps()` and left `charsheet.ts`'s three `characterGrid` calls — the
  character sheet being the screen this item and 3.7 actually describe. "One
  builder, not two literals" was the right instinct applied at one of four places;
  the correction is in 3.6.

  Upstream's TRAPSAFE split is preserved and tested in both halves:
  `player_flags_timed` skips `TMD_TRAPSAFE` (player.c:310-320) so the
  `OF_TRAP_IMMUNE` learning hack can tell timed from innate, and `resolveUiDeps`
  adds it back from `p.timed` directly. Either half alone looks right, so both are
  asserted.

  **The wiring is guarded by the TYPE, not by a test, and the limit is measured.**
  `EquipCmpDeps.entryDeps` was optional, which is what let the omission compile;
  it is required now, and dropping it is a compile error (verified). Passing `{}`
  deliberately still typechecks and no test catches it — checked, and written at
  the field rather than implied away, because guarding it would need a nominal
  type for one field.

  Five tests in `ui-entry.test.ts`, four mutations on the builder, all four bite.
  One drives `characterGrid` twice — deps supplied versus omitted — so what is
  asserted is the grid cell a player reads, not the builder's return value.
  Sites: `packages/core/src/game/ui-entry.ts:26`

- [x] **3.9 The character sheet's launcher contribution is 0.** DONE, both halves.
  The row's own wording was the tell — "the reach it calls deferred **exists**".
  It did: `player/calcs.ts` had been reading the equipped launcher's
  `kind.kindFlags` for the ammo tval all along. The reach is three lines of
  body-slot walk, now shared once as `obj/knowledge.ts equippedLauncher`
  (documented against `equipped_item_by_slot_name(p, "shooting")`, and equating
  "shooting" with slot type `BOW` exactly where calcs.ts already equates them).
  - **ui-entry**: `UiEntryDeps.launcher`, and the PF_FAST_SHOT push is now
    ui-entry.c L974-984's `p->lev / 3` when the slot holds an arrow-firer. The
    `liveUiEntryDeps` seam list is a **ratchet** test now — `Object.keys(deps)`
    is pinned, so the next seam added to `UiEntryDeps` and not wired here fails
    rather than silently taking a default.
  - **char-sheet**: `launcher: deps.launcher ?? null` had **no supplier anywhere**
    (`screens.ts charSheetDeps` never mentions the field), so "Shoot to-dam" and
    the ranged "To-hit" read as if every character were unarmed with a bow in
    hand. `meleeWeapon` one line above had always defaulted to the live actor;
    this seam was the odd one out. Now **derived** in `resolveDeps`, which already
    holds the state — so no caller has to remember it.
  The item named the char-sheet seam, so both halves were in scope; the fix is not
  the ui-entry line alone. The 3.6 dependency is discharged — `playerHas` reads
  the computed pflags.
  Mutation-verified: reverting the char-sheet default kills 1, the hardcoded 0
  kills 1, dropping the `KF_SHOOTS_ARROWS` check kills 1, and un-supplying the
  seam in `liveUiEntryDeps` kills 2. The `lev / 3` truncation is asserted at 29
  as well as 30, so a rounding change is visible.
  *`show_combined` / `EQUIPCMP_SCREEN` used to be folded in here and is now
  closed: `equipCmpCategories` (`game/ui-entry.ts:1965`) IS iterated by
  `equipCmpSummary` (`game/equip-cmp.ts:391`), and the combined row is asserted
  the same length as the columns (`game/equip-cmp.test.ts:116`).*
  Sites: `packages/core/src/game/ui-entry.ts:1489`,
  `parity/ledger/ui-entry.yaml:133`, `parity/ledger/ui-player.yaml:108`,
  `parity/ledger/ui-entry.yaml:132`

- [x] **3.10 `prt_moves` shows nothing.** DONE.
  `resolveDeps` already holds the `GameState`, so the fix is to **derive rather
  than default**: `numMoves: deps.numMoves ?? state.playerState?.numMoves ?? 0`
  (`game/display.ts:212`). No caller has to remember anything.
  Sites: `parity/ledger/ui-display.yaml:103`

- [x] **3.11 `prt_state`'s repeat branch can never fire.** DONE — **and the item
  named the wrong mechanism.** `CommandQueue.getNRepeats` (`cmd.ts:534`) is a
  faithful port that **nothing drives**, so wiring the cited answer would have
  produced a permanent 0 by a longer route and looked fixed. The live repeat count
  is `repeatRemaining` on `state.cmdQueue`, which `queueCommandRepeat` populates:
  `nRepeats: deps.nRepeats ?? state.cmdQueue?.[0]?.repeatRemaining ?? 0`
  (`game/display.ts:220`). Third time a row's stated *reason* has pointed at
  undriven code while its *claim* was correct.
  Sites: `parity/ledger/ui-display.yaml:109`

- [x] **3.12 The wizard and winner markers never show.** DONE, both screens.
  Derived on each resolver from the state that already carries them —
  `state.wizard` and `player.totalWinner` — in the sidebar (`game/display.ts:222`,
  `:223`) and the sheet (`game/char-sheet.ts:210`, `:211`). `fmt_title`'s
  precedence is asserted: wizard outranks winner.
  Sites: `parity/ledger/ui-display.yaml:111`, `parity/ledger/ui-player.yaml:103`

- [x] **3.13 The sheet's Resting line always reads 0.** DONE — **and it was two
  defects, not one.** The reader was an absent supplier like the rest
  (`char-sheet.ts:198`). The writer was missing outright: upstream's
  `player_resting_step_turn` bumps **two** counters (player-util.c:1487-1488) and
  the web rest loop bumped one. `turnsRested` is the per-rest x2-regen gate;
  `player->resting_turn` is the lifetime total the sheet shows, reset only at
  birth. Fixed at `packages/web/src/main.ts:4962`. Because that write is the
  **only** writer and `main.ts` is covered by source-text tests rather than unit
  tests, it is ratcheted at `web/src/rest-steal-note.test.ts:38` — and the ratchet
  was verified by deleting the line.
  Sites: `parity/ledger/ui-player.yaml:85`

- [ ] **3.14 The object glyph ignores flavour awareness.**
  Nothing supplies `objectAttr` / `objectChar`, so `game/display.ts:432` uses
  `kind.dAttr` / `kind.dChar` and an unaware potion shows the kind's colour
  rather than its flavour colour.
  Sites: `parity/ledger/ui-display.yaml:116`

- [ ] **3.15 `feeling-need` is hardcoded.**
  The constant IS loaded (`packages/core/src/constants.ts:113`, mapped at `:185`)
  and both consumers hardcode 10 (`game/display.ts:206`,
  `game/cave-cmd.ts:179`). Equals shipped data today, so a pack or mod that
  changes it is silently ignored.
  Sites: `parity/ledger/ui-display.yaml:97`

- [ ] **3.16 The knowledge browser's thematic grouping columns.**
  This is `ui_knowledge.txt` — the datafile defines the browser's `monster_group`
  grouping, the browser is ported, the grouping is not drawn.
  Sites: `packages/web/src/screens.ts:872`, `parity/ledger/gamedata.yaml:478`

- [ ] **3.17 `update_sidebar`'s priority culling and from-bottom placement.**
  The sidebar itself is drawn, on a canvas. The screen-size priority culling and
  from-bottom placement are absent, as `game/display.ts:505` says.
  Sites: `parity/ledger/ui-display.yaml:124`

- [ ] **3.18 The ENTER command browser does not exist, for any command list.**
  `textui_action_menu_choose` / `cmd_menu` (`ui-context.c:1176-1215`). Upstream's
  nested command categories are reachable only through it, which is why the
  debug menu's categories look absent — but the gap is general, not
  wizard-specific (`packages/web/src/wizard.ts:492-499` states this).
  Sites: `packages/web/src/wizard.ts:498`

- [ ] **3.19 The birth screens answer help with a no-op.**
  `ui-birth.c` offers help on every birth screen; the port swallows the key.
  Sites: `packages/web/src/birth.ts:1051`

- [x] **3.20 Temporary brands and slays are not shown in object info.** DONE.
  The item was right, and its own "the combat half is ported and live" note was
  the tell: the predicate existed, but `session/game.ts` built a **private**
  `buildTempBrandSlay` for the melee hooks alone, so obj-info could not reach
  one. Fix: one bound instance on `GameState.tempBrandSlay` (required field, so
  every state literal must supply it), the melee hooks now read it instead of
  building their own, and `obj-info.c:1130-1142`'s two gathering loops are ported
  into `collectTotalBrandsSlays` behind the same `if (weapon)` gate, with
  `appendBrand`/`appendSlay` promoted to `obj/object.ts`.
  Two instructive misses are recorded in the test rather than tidied away: a
  `/acid/i` grep over the textblock is **green before the fix** (the dagger's own
  flavour text says "acid"), and a `console.log` probe that printed nothing led me
  to conclude the brand never reached the text — vitest does not surface stdout
  from a passing test. The assertion is now a before/after **diff**, run inside
  the test. Mutation-verified: neutering the gathering loop kills 1 test, passing
  the *bound* timed table instead of the raw pack records kills 4.
  Sites: `packages/core/src/obj/object-info.ts:974`

- [ ] **3.21 The shape-lore textblock chain.**
  Shapechange effects have no lore chain, and the port greys the entry rather
  than omitting it — a divergence forced by the real gap, so fixing the chain
  lets the divergence go too.
  Sites: `packages/web/src/main.ts:3720`, `:3701`

- [x] **3.22 The lore title does not recolour a unique with `purple_uniques`.**
  DONE. The row's own triage was right: of its three claims only `purple_uniques`
  was a real gap, and the reason it went unported is that it had been lumped into
  one `DEFERRED:` note with two things that genuinely are the shell's — the
  secondary glyph (`monster_x_attr`, the pref-file override table) and its
  `tile_width == 1 && tile_height == 1` gate. A headless model has nothing for
  either to read; it has everything for the option.
  Fix: `LoreDeps.purpleUniques`, **required** and named exactly as
  `visuals/map-text.ts` already names it, so the lore title and the map glyph
  cannot disagree on the same screen. `loreTitle` now takes `deps` and applies
  `COLOUR_VIOLET` to a unique's title glyph (ui-mon-lore.c L56-60), char
  unchanged. Making the field required is what found the suppliers: the four
  compile errors were the complete set, so there was no wiring to guess at.
  The upstream `optional_attr` half of L58-59 stays out with the secondary glyph
  it belongs to, and the note now says which half is which rather than lumping
  them.
  Test fixtures are derived from the pack, not declared: the test picks a unique
  whose own `d_attr` is not already violet and asserts that it found one, so a
  content change that erases the contrast fails loudly instead of making the
  assertion vacuous. Mutation-verified: ignoring the option kills 1, dropping the
  `!UNIQUE` guard kills 1, inverting the `"The "` prefix kills 3.
  Sites: `packages/core/src/mon/lore-describe.ts:1359`

- [x] **3.23 Rune-learning messages still use the `ODESC_BASE` stand-in.** DONE,
  and the row's stated REASON was wrong in a way worth recording. It said "the
  layering reason is real (`knowledge.ts` is in `obj/`, `describeObject` is in
  `game/`)". Opening `game/describe.ts` settles it: line 9 is
  `import { ODESC, objectDesc } from "../obj/desc.js"`. The real `object_desc`
  lives **next door in `obj/`**; `describeObject` is only a GameState wrapper. The
  obstacle was never the directory — it was the `KnownDesc` bundle, which is
  assembled from GameState fields (`isAware`, `options`, `hasFlavor`,
  `flavorText`, `everseen`). A seam was still the right shape, for a different
  reason than the one given.
  Three consumers, and the item named only the first:
  1. **The six rune / flag / curse messages.** `RuneEnv.describeBase`, supplied
     at the one real `makeRuneEnv` call (the other two in `session/game.ts` are
     the documented placeholders `wireGame` replaces). Six upstream `ODESC_BASE`
     calls in obj-knowledge.c, six `baseName` sites here — a 1:1 mapping.
  2. **`print_custom_message`'s `{name}` and `{kind}`** (`session/game.ts`, the
     temporary-brand begin/end lines). Upstream uses **two different functions**:
     `{name}` is `object_desc(ODESC_PREFIX | ODESC_BASE)` (so it carries the
     article) and `{kind}` is `object_kind_name(kind, easy_know=true)`, which is
     exactly `obj_desc_name_format(kind->name, NULL, false)`. The port passed
     `w.kind.name` for both — **raw**, not even marker-stripped, so a kind named
     `& Long Bow~` printed its `&` and `~` to the player. Both now exact.
  3. **`kindHasFlavor`** now reads the live `deps.hasFlavor` with the tval test as
     the fallback. The interface note claiming the two "agree in practice" is
     true of 4.2.6's object.txt and false for a mod that adds a kind of a
     flavoured tval without a flavour — a mod-facing hole, as the row said.
  On the tests, an honest accounting. The full suite was **green before the fix**:
  nothing exercised either path with a name that could show a difference. After
  wiring, a mutation making `baseName` ignore the seam entirely killed **nothing**
  — the first tests proved the seam was SUPPLIED, which is a different claim from
  "the six sites read it". Behavioural tests now cover `objectLearnOnWield` and
  the `{name}`/`{kind}` pair; the other five message sites need a curse record, a
  timed equip pass or an element property to fire, so instead of five fixtures
  there is one **source-level ratchet**: `objBaseName` must be referenced exactly
  once, inside the dispatcher. Verified it fires — reverting any individual site
  to `objBaseName(obj)` fails it. That guard is structural, not behavioural, and
  is labelled as such in the test: it proves nothing bypasses the seam, not that
  the seam yields the right string.
  Sites: `packages/core/src/obj/known-object.ts:167`

- [ ] **3.24 `equip_learn_flag` has no shape branch.**
  `packages/core/src/obj/knowledge.ts:716-732` walks every body slot with no
  shapechange test at all, so gear merged into a shape is still learned from while
  shapechanged. `shapeLearnOnAssume` (`obj/knowledge.ts:758`) is already there for
  the other half.
  Sites: `parity/ledger/obj-knowledge.yaml:98`

- [ ] **3.26 Teleporting is silent.**
  `MSG_TELEPORT`, `MSG_TPOTHER` and `MSG_TPLEVEL` all exist in the generated table
  with their sound names (`packages/core/src/generated/message.ts:18`, `:23`,
  `:33`) and are used **nowhere** — `packages/core/src/game/effect-teleport.ts`
  emits no sound at all, while seventeen other sites do call `state.sound`. Three
  one-line calls.
  Sites: `parity/ledger/game-effect-teleport.yaml:81`

- [ ] **3.27 The `{tried}` and `{ignore}` name markers never appear.**
  Two seams that exist on `KnownDesc` and are never supplied.
  `packages/core/src/game/describe.ts:21` hardcodes `isTried: () => false`, so the
  in-store "{tried}" marker is dead (`obj/desc.ts:553` is ready for it). And
  `ignore_item_ok` **is** ported (`packages/core/src/obj/ignore.ts:380`) and used at
  `packages/core/src/game/obj-cmd.ts:946`, but `knownDescOf` never passes it as
  `KnownDesc.ignoreItemOk`, so `obj/desc.ts:537` never emits "{ignore}" either.
  Sites: `parity/ledger/obj-desc.yaml:65`, `:67`

- [ ] **3.25 Per-category priority overrides are not reconstructable.**
  The pack compiler erases the intra-record order of category vs priority lines,
  so a priority override attached to a category cannot be reproduced. A compiler
  fix, not a renderer one.
  Sites: `parity/ledger/ui-entry.yaml:140`

## Tier 4 — Whole modes nobody has begun

- [ ] **4.1 Arena mode.**
  The `mon_take_hit` arena branch, `arena_gen`, the arena level generation, and
  the arena exclusion in monster ranged attacks. `hard_centre_gen` is **done**
  (`hardCentreGen`, `packages/core/src/gen/cave.ts:1914`); the
  glyph-of-warding half of the exclusion is available
  (`game/monster-turn.ts:1536`).
  Sites: `packages/core/src/mon/take-hit.ts:17`,
  `packages/core/src/gen/cave.ts:31`, `packages/core/src/gen/generate.ts:11`,
  `parity/ledger/gen-cave.yaml:49`, `parity/ledger/game-mon-ranged.yaml:31`

- [ ] **4.2 The quest system.**
  Sites: `packages/core/src/gen/cave.ts:2833`,
  `packages/core/src/gen/generate.ts:11`

- [ ] **4.3 Persistent levels, and the town builder's full store generation.**
  `Connector` carries grid + feat rather than a copy of `SQUARE` info — a
  divergence that only starts to matter when persistent levels arrive, so decide
  it as part of this item.
  Sites: `packages/core/src/gen/cave.ts:30`

## Tier 5 — History, notes, files and logs

- [x] **5.2 The player notes command.** CLOSED as a RETRACTION — **it is built,
  and "confirmed absent by reading" was neither.** `noteCmd`
  (`packages/web/src/main.ts:4547`) is a complete `do_cmd_note`: the `"Note: "`
  prompt at 69 chars (`char tmp[70]`), the empty / space-first rejection
  (cmd-misc.c:100), `/say` and `/me` formatted exactly, the stored `"-- "` prefix
  with the echoed line dropping it (`say(note.slice(3))`, cmd-misc.c:111), and
  `historyAdd(..., HIST.USER_INPUT, ...)` stamped off live state. `':'` is bound
  (ui-game.c:211). All six behaviours already had tests
  (`web/src/rest-steal-note.test.ts:54-75`).
  **Both halves of the stated reason were false, from one grep.** "There is no
  `HIST_USER_INPUT` anywhere" is true only of that literal spelling — the port
  writes `HIST.USER_INPUT`, an enum member rather than a C macro — and the key
  bound follows from the same code the grep missed. This is the
  **failed-transliteration** shape that already cost four wizard-tier verdicts,
  recurring in a tier that had not been swept for it: a C identifier that does not
  survive into the port's spelling proves nothing by its absence. Found while
  ratcheting 3.13, in the same test file.
  Sites: `parity/ledger/player-history.yaml:91`,
  `parity/ledger/player-history.yaml:158`

- [ ] **5.9 A store's stock does not age.**
  There is no `daycount` in `packages/core` or `packages/web`, so the
  return-to-town multi-day maintenance — one `store_update` per elapsed day, and
  the shopkeeper-shuffle probability that rides it — never runs. Stock is frozen
  for as long as the player is in the dungeon.
  Sites: `parity/ledger/store-maint.yaml:54`

- [ ] **5.3 `options_save_custom` / `restore_custom` / `restore_maintainer`.**
  The per-user customised-defaults files in `ANGBAND_DIR_USER`. Buildable now:
  the host seam and the pref-file writer both exist. Watch the parser traps —
  one parse loop, and it must not be stricter than `strtol`.
  Sites: `parity/ledger/options.yaml:76`

- [ ] **5.4 `RANDNAME_TOLKIEN` is not loaded.**
  Randart names come from `artifactGenName`'s own generator instead of the names
  datafile.
  Sites: `parity/ledger/obj-randart.yaml:51`

- [ ] **5.5 `randart.log` / `randart.txt`.**
  Upstream's `do_randart` writes it whenever randarts generate and `exit(1)`s if
  it cannot open it. **193 `file_putf` sites — the largest single item here.**
  Put to the maintainer on 2026-08-04 as port-it-or-omit-it; the answer was
  **pursue parity**, so it is a port with no asterisk. The `exit(1)` goes through
  the host seam rather than killing the process.
  Sites: `packages/core/src/obj/randart.ts:38`

- [ ] **5.6 The spoiler files' missing lines.**
  The generators and their menu are **done** (`runSpoilers`, `game/spoil.ts`).
  What is missing is content: `timedDesc` / `summonDesc` are unwired so some
  activation descriptions read worse than upstream's; and `loreDescription` has no
  upstream-style spoiler flag. `:518` and `:519` are the hit-chance lines, and
  they no longer wait on anything — the callbacks are wired for the *game* path
  (`packages/web/src/main.ts:3650`); a core-level dump has no player, so this
  needs a state-carrying spoiler variant rather than a seam.
  Sites: `packages/core/src/game/spoil.ts:93`, `:518`, `:519`, `:550`

- [ ] **5.7 The randart generator's `property` branch.**
  Needs the timed-effects failure tables.
  Sites: `packages/core/src/obj/randart-build.ts:38`

- [ ] **5.8 `object_flag_is_known` on the store's buy list.**
  Kept here rather than closed with the rest of `store-maint.yaml:34`: the store's
  buy check reads `obj.flags` directly with the gate commented out
  (`packages/core/src/store/store.ts:262`), so a store will buy on a flag the
  player has never learned. Same defect as **2.10**, reached through maintenance.
  Sites: `parity/ledger/store-maint.yaml:34`

## Tier 6 — Closed

**Wizard mode, all of it.** Every row in `wizard-debug.yaml` — the prose census
and all fourteen `deferred:` bullets — is now `ported`. `runPlayItem` with
upstream's full submenu, `runChangeQuantity`, `runWriteMap` over
`game/dump-level.ts`, all three Monte-Carlo collectors, `runStatItem`,
`runTweakItem` / `runRerollItem` / `runCurseItem`, `runSpoilers` over the four
`spoil*` generators, `wiz_display_item` with `prt_binary`
(`web/src/wizard.ts:1752`, `:1829`), the free-form effect prompt (`:1338`), the
edit-player queue chain (`:1397`), `quit_no_save` (`:200`), `dump_level_map`
(`:1544`), `query_feature` (`:1601`), `peek_noise_scent` (`:1633`),
`NOSCORE.JUMPING` with `choose_profile`'s one-shot clear
(`game/context.ts:494`), and `ArtifactState` (`obj/make.ts:736`) as `aup_info[]`
serialized in the save **and marked at the create site**
(`game/wizard.ts:397`). The one thing that looked like a wizard gap and is not is
the ENTER command browser, now **3.18**.

**Closed by Tier 0.2 and the ledger tranche**, each on named evidence in
`parity/reports/*.tsv`: monster-recall percentages and breath damage; object
`store_init` owner selection; `show_floor`; `object_list_format_name`; the
artifact history hooks; `hard_centre_gen`; `room_of_chambers`, whose builder
passes `gen.test.ts:2175` **and** whose `spreadMonsters` caller exists
(`gen/cave.ts:1721`, `:1865`); `list_object`'s oidx bookkeeping, a ratified
substitution — the pile map *is* the object list; `EQUIPCMP_SCREEN` iteration;
find-on-sight history (`game/known.ts:461`); `dump_history`
(`web/src/charsheet.ts:504`); the `'~'` knowledge menu; the bookseller's
town-book expansion; `store_stock_list`'s display sort; `purchase_analyze` and
`comment_accept`; `apply_autoinscription`; the OF_STICKY curse propagation;
temporary brands and slays reaching `improveAttackModifier`; `object_learn_on_use`'s
XP; and the birth-kit gold deduction, `eopts` exclusion and pack-overflow
handling.

## Tier 7 — Decisions to take, not code to write

- [ ] **7.1 `project-path`: wire it or cordon it.**
  A ported function whose only caller would be a UI branch that does not exist.
  Leaving it is the shipped-is-not-reachable trap.
  Sites: `parity/ledger/project-path.yaml:58`

- [ ] **7.2 Split the monster-turn partial into rows that can be closed.**
  The note covers item pickup, group behaviour and lore at once and names them
  only collectively, which is why it is still `partial` when most of it is live
  (`monsterCarry`, `mon-group.ts`, `loreLearnFlagIfVisible`). A row that cannot
  be closed is a row nobody works.
  Sites: `packages/core/src/game/monster-turn.ts:1425`

- [ ] **7.3 Decide the level-rating question.**
  `monCreateDrop` and `updateMon` are ported and monster lore is wired including
  `lore.txt`; upstream's level *rating* has no port equivalent at all. Port it or
  record it as `n-a` with the mechanism.
  Sites: `parity/ledger/mon-make.yaml:32`

- [ ] **7.4 The world kernel's monster-list scan replacement.**
  Sites: `parity/ledger/world-kernel.yaml:27`

---

## What makes this list checkable

`packages/cli/src/port-todo.test.ts` fails if:

1. any file with a `real` or `partial` census row is not cited by a `Sites:`
   line here — so a confirmed gap cannot be adjudicated and then quietly left
   off the work list;
2. the counts stated at the top (**67 items, 111 citations, 81 `real` + 30
   `partial`**) disagree with the census — so a new `real` row in a file that
   already appears cannot hide inside an existing item. Note that the item count
   and the citation count are coupled here but are not the same measurement: 2.20
   and 1.3 were found by READING, not by the census, so they moved 65 to 67 while
   the citations stayed at 111. This guard is what forced that difference to be
   written down rather than absorbed - and it also caught a duplicate item NUMBER
   (two 2.18s, from adding one while one existed), because renumbering is the only
   way to keep an item referable;
3. any path named in a `Sites:` line does not exist on disk — so a citation
   cannot rot into fiction after a rename;
4. **any cited LINE has drifted off the note it points at** — the neighbourhood
   of an open item's `packages/...:N` citation must still mention a word from the
   item's title, or `deferred` / `TODO`. Added 2026-08-05 after measuring the
   damage: 2 of 28 port-cited lines on open items had drifted, and **both were
   shifted by that same day's commits** (`gear.ts` gained the `PN_COMBINE` lines,
   `main.ts` an ignore-drop block). One of them was **2.7**, whose citation was
   then used to decide what to read next. Guard 3 could not see it: the path kept
   existing while every line in the file moved.

   2 of 28, not the systemic breakage it looked like from the first two examples —
   so this is a ratchet on a narrow problem. Its own limit is written into the
   test: the `deferred` fallback is permissive enough that a citation pointing at
   a module docblock still passes, and dropping the fallback was tried and
   produces four FALSE failures on correct citations.

The first guard is mutation-checked in the same file, because a coverage test
that cannot fail is the exact instrument this repository has been burned by most
often.

**No guard catches the failure that actually happened here.** All three of the
above were green while the list carried nine finished wizard items, because they
check that owed rows are *covered*, never that a covered row is still *owed*.
`deferral-crosscheck.mjs` is the answer, and it is a reading aid rather than a
test: its output is leads, and a lead needs a human. Tiers 0.1 and 0.2 are
deliberately **not** under the ratchet — 297 items are unadjudicated, and a test
asserting zero would be turned off within the day. The honest control is that
both numbers are written down here.
