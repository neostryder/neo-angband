# Every item that still needs porting

**Dated 2026-08-04, last worked 2026-08-05.** The work list derived from
[DEFERRALS.md](DEFERRALS.md), which is the accounting of what was found and how
each verdict was reached. This one is the checklist, ordered so the things a
player would notice come before the things only a developer sees, and so the
items that unlock others come first of all.

**66 items covering all 111 confirmed-absent citations** — 8 closed, 58 open.
It started at 65; **2.18 was added by reading**,
not by the census, and it landed in the tier this file had already declared
closed. Two of the eight closures are retractions rather than work — **2.16** asked
for a call upstream does not make, and **2.1**'s own scope was overstated by a
factor of seven. Both are written up in place, because a corrected item is worth
more than a deleted one: the shape of the error is the reusable part.

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

- [ ] **1.1 `notice_stuff` / `PN_*` — the one architectural gap.**
  No `noticeStuff` and no `PN_*` pipeline anywhere. Root cause of both **2.5**
  (`PN_IGNORE` set and never consumed) and **3.1** (the monster-message queue
  has nowhere to be flushed from). The sibling `PU_*` / `PR_*` update-and-redraw
  flags are *not* owed — the front end recomputes and repaints after every
  state-changing action, a ratified divergence recorded at
  `packages/core/src/game/known.ts:153`. `PN_*` is different: a queue of work,
  not a dirty bit, and nothing else does that work.
  Sites: `packages/core/src/game/context.ts:297`

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

- [ ] **2.3 `alter` (`+`) has no chest branch and no floor-trap branch.**
  `do_cmd_alter_aux` (`cmd-cave.c:969-992`). The note excused this because alter
  was unbound; the shell has bound it since
  (`packages/web/src/main.ts:8090` → `alterCmd`), which makes the gap reachable.
  *Cross-check lead unread: `do_cmd_alter` is named in
  `packages/web/src/context-menu.ts`.*
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

- [ ] **2.5 Run the `PN_IGNORE` notice pass.** *(needs 1.1)*
  Set at `packages/core/src/session/game.ts:542`, never read, so becoming aware
  of a kind never drops the newly-ignored items. `ignoreDropTargets` exists
  (`packages/core/src/game/ignore-cmd.ts:45`) and the menu / `K` trigger *is*
  reproduced — only the become-aware trigger is missing.
  Sites: `packages/core/src/game/context.ts:297`,
  `packages/core/src/session/game.ts:542`,
  `packages/core/src/obj/knowledge.ts:1366`

- [ ] **2.6 `known_only` does not exist.**
  `obj-info.c` calls `calc_bonuses` with `known_only = true` at six sites; the
  port passes no such flag. `calcs.ts:606` says known_only callers "pass false so
  the derive stays pure" and `:721` lists it among what is deliberately not
  derived. **Wider than first scoped**: `prt_ac` and the character sheet's combat
  panel both read the real state, so an unlearned `+to_a` rune is included in the
  AC the player is shown (`ui-display.yaml:120`, `ui-player.yaml:75`).
  Sites: `parity/ledger/player-calcs-bonuses.yaml:78`,
  `parity/ledger/ui-display.yaml:120`, `parity/ledger/ui-player.yaml:75`

- [ ] **2.7 `pile_insert_end` is absent.**
  No pile links at all (`packages/core/src/game/gear.ts:134`), so ordering inside
  a floor pile can differ from upstream's append-at-end. There is a dedicated
  instrument saying so: `packages/core/src/game/pile.upstream.test.ts:28`.
  Sites: `packages/core/src/game/gear.ts:1173`

- [ ] **2.8 `path_analyse` is absent.**
  No `pathAnalyse` anywhere, so intervening-square terrain is never learned along
  a path.
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

- [ ] **2.11 The `OSTACK_LIST` stacking checks.**
  Two objects the player cannot tell apart must not merge in a list context, and
  a fully-known mismatch must block the merge. The shadow can answer both.
  Sites: `packages/core/src/obj/object.ts:923`, `:1000`

- [ ] **2.12 `cmd_disable_repeat_floor_item`.**
  `repeatAllowed` in `cmd.ts` is a static table property, not the runtime
  disable-for-this-item call.
  Sites: `parity/ledger/cmd-core.yaml:25`

- [ ] **2.13 `EF_TOUCH`'s monster-source branches.**
  The decoy and target-monster branches, so a monster casting a touch effect
  cannot centre it on a decoy or another monster.
  Sites: `packages/core/src/game/project-cast.ts:685`,
  `parity/ledger/game-project-cast.yaml:53`

- [ ] **2.14 Mimic bookkeeping.**
  Targeting is wired; mimicked-object bookkeeping is not.
  Sites: `packages/core/src/game/context.ts:1161`,
  `parity/ledger/game-project-monster.yaml:50`

- [ ] **2.15 The book out-of-depth value boost.**
  The out-parameter carrying an out-of-depth magic book's value boost.
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

- [x] **2.18 `do_cmd_wiz_play_item` skipped two of its four commit steps.**
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

- [ ] **3.2 The killer's name is a race name.**
  `MDESC_DIED_FROM` is defined at `packages/core/src/mon/desc.ts:61` and unused
  at both death sites, so the cause reads "kobold" where upstream writes "a
  kobold". The third site is the high-score entry, which cannot name the killer
  at all because it is not wired through `GameState` — one wiring lands all
  three.
  Sites: `packages/core/src/effects/handlers.ts:78`,
  `packages/core/src/game/effect-attack.ts:687`,
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

- [ ] **3.6 No `PF_*` intrinsic ability ever appears on the character sheet.**
  `characterGrid` is called with no `UiEntryDeps` at any of its three call sites
  (`packages/web/src/charsheet.ts:270`, `:379`, `:651`), so `playerHas` falls back
  to reading `p.pflags` — and `Player` has no `pflags` field at all. The data
  exists: `PlayerState.pflags` is computed at
  `packages/core/src/player/calcs.ts:767`.
  Sites: `parity/ledger/ui-entry.yaml:128`

- [ ] **3.7 Temporary resists never appear in the resist grid.**
  Same two call sites: `timedElementEffect` defaults to `() => 0`
  (`game/ui-entry.ts:1347`), and the untimed value comes from `p.race.elInfo` plus
  the equipment cache rather than `state.elInfo`, so a temporary resist is not
  shown **at all** — a stronger gap than "mark it as temporary".
  **The note's reason was wrong and it made this look big:** it said the ported
  timed registry carries no `temp_resist`. It does — `packages/core/src/player/types.ts:315`
  and `obj/effects-info.ts:80` — and `player/calcs.ts:1172` already reads it into
  `state.elInfo`. Feeding the seam is the whole job.
  Sites: `parity/ledger/ui-entry.yaml:120`, `:124`

- [ ] **3.8 The timed-flag column reads empty.**
  `timedObjectFlags` defaults to an empty `FlagSet` (`game/ui-entry.ts:1342`, plus
  `OF_TRAP_IMMUNE` added directly), so `ui-entry.ts:1400` scores 0 for every timed
  OF dup and the sheet cannot mark a flag temporary rather than permanent. Same
  correction as 3.7: `oflagDup` **is** on the registry (`obj/effects-info.ts:76`,
  parsed at `player/bind.ts:760`) and `player_flags_timed` **is** ported, at
  `packages/core/src/player/calcs.ts:1100`, folding each active effect into
  `state.flags`. Both call sites pass no deps —
  `packages/web/src/charsheet.ts:270` and `packages/core/src/game/equip-cmp.ts:388`.
  Sites: `packages/core/src/game/ui-entry.ts:26`

- [ ] **3.9 The character sheet's launcher contribution is 0.**
  `packages/core/src/game/ui-entry.ts:1392` pushes 0 for `PF_FAST_SHOT` with the
  comment "deferred", and the reach it calls deferred **exists**:
  `packages/core/src/player/calcs.ts:1246` already reads the equipped launcher's
  `kind.kindFlags` for `KF.SHOOTS_ARROWS`. `launcher` also defaults to `null` at
  `game/char-sheet.ts:201` with no supplier. Depends on 3.6 — with `playerHas`
  false the branch is unreachable anyway.
  *`show_combined` / `EQUIPCMP_SCREEN` used to be folded in here and is now
  closed: `equipCmpCategories` (`game/ui-entry.ts:1965`) IS iterated by
  `equipCmpSummary` (`game/equip-cmp.ts:391`), and the combined row is asserted
  the same length as the columns (`game/equip-cmp.test.ts:116`).*
  Sites: `packages/core/src/game/ui-entry.ts:1392`,
  `parity/ledger/ui-entry.yaml:133`, `parity/ledger/ui-player.yaml:108`,
  `parity/ledger/ui-entry.yaml:132`

- [ ] **3.10 `prt_moves` shows nothing.**
  `PlayerState.numMoves` exists and is computed
  (`packages/core/src/player/calcs.ts:1307`), and `displayDeps` does not pass it,
  so `game/display.ts:209` defaults it to 0.
  Sites: `parity/ledger/ui-display.yaml:103`

- [ ] **3.11 `prt_state`'s repeat branch can never fire.**
  `cmd_get_nrepeats` has a port equivalent — `CommandQueue.getNRepeats`,
  `packages/core/src/cmd.ts:534` — and `nRepeats` defaults to 0 with no supplier,
  so `game/display.ts:712` is unreachable.
  Sites: `parity/ledger/ui-display.yaml:109`

- [ ] **3.12 The wizard and winner markers never show.**
  `wizard` and `totalWinner` default to false with no supplier, in both the
  sidebar (`game/display.ts:215-216`) and the character sheet
  (`game/char-sheet.ts:198-199`).
  Sites: `parity/ledger/ui-display.yaml:111`, `parity/ledger/ui-player.yaml:103`

- [ ] **3.13 The sheet's Resting line always reads 0.**
  Nothing supplies `restingTurn` and nothing increments `state.restingTurn`
  during play — only save and load touch it (`session/save.ts:1398`,
  `session/game.ts:3576`) — so `game/char-sheet.ts:395` shows 0 forever.
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

- [ ] **3.20 Temporary brands and slays are not shown in object info.**
  The combat half is ported and live
  (`packages/core/src/combat/brand-slay.ts:141-201`).
  Sites: `packages/core/src/obj/object-info.ts:962`

- [ ] **3.21 The shape-lore textblock chain.**
  Shapechange effects have no lore chain, and the port greys the entry rather
  than omitting it — a divergence forced by the real gap, so fixing the chain
  lets the divergence go too.
  Sites: `packages/web/src/main.ts:3697`, `:3701`

- [ ] **3.22 The lore title does not recolour a unique with `purple_uniques`.**
  Lead read, and only one of the row's three claims survived. The secondary glyph
  and the tile width/height gating are the shell's by construction — the headless
  lore model carries no tile state. But `purple_uniques` **is** a live option
  (`packages/core/src/generated/options.ts:25`) honoured by the map text layer,
  and `loreTitle` ignores it.
  Sites: `packages/core/src/mon/lore-describe.ts:1348`

- [ ] **3.23 Rune-learning messages still use the `ODESC_BASE` stand-in.**
  Re-scoped: the real `object_desc` **did** land — `describeObject`
  (`packages/core/src/game/describe.ts:48`) with the full `ODESC` mode set — but
  this path did not move to it. `objBaseName`
  (`packages/core/src/obj/knowledge.ts:220`) is still "the kind's plain name" with
  `~` and `&` stripped, used by every rune message (`:470`, `:520`, `:602`, `:725`,
  `:745`, `:801`). The layering reason is real (`knowledge.ts` is in `obj/`,
  `describeObject` is in `game/`), so the fix is a seam, not an import. Fold in
  the same file's other approximation while there: `kindHasFlavor`
  (`packages/core/src/obj/known-object.ts:163`) tests the tval instead of
  consulting `deps.hasFlavor`, which the interface notes agrees in practice for
  every shipped kind (`known-object.ts:121-124`) — a mod-facing hole, not a
  parity one.
  Sites: `packages/core/src/obj/known-object.ts:160`

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

- [ ] **5.2 The player notes command.**
  Confirmed absent by reading, and small: there is no `HIST_USER_INPUT` anywhere
  and no take-notes key bound, while the history entry types and the screen that
  shows them are both built.
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
2. the counts stated at the top (**66 items, 111 citations, 81 `real` + 30
   `partial`**) disagree with the census — so a new `real` row in a file that
   already appears cannot hide inside an existing item. Note that the item count
   and the citation count are coupled here but are not the same measurement: 2.18
   was found by reading, not by the census, so it moved 65 to 66 while the
   citations stayed at 111. This guard is what forced that difference to be
   written down rather than absorbed;
3. any path named in a `Sites:` line does not exist on disk — so a citation
   cannot rot into fiction after a rename.

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
