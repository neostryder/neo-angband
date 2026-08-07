# Every item that still needs porting

**Dated 2026-08-04, last worked 2026-08-05.** The work list derived from
[DEFERRALS.md](DEFERRALS.md), which is the accounting of what was found and how
each verdict was reached. This one is the checklist, ordered so the things a
player would notice come before the things only a developer sees, and so the
items that unlock others come first of all.

**68 items covering all 75 confirmed-absent citations** — 65 closed, 3 open.

The largest single move it has ever made was **downward, on 2026-08-06: 100 to
87**, and none of it was work. Reading the seventeen `real` rows in the ledger
census as a group found that **thirteen described work that had already been
done** — the UI seams of PORT_TODO 3.5 through 3.13, every one of them wired,
and a take-notes command that exists. **A `real` verdict is dated evidence in
exactly the way a deferral note is**, and it is worse, because the owed-work
count is derived from it: the project had been carrying thirteen phantom
obligations and reporting them as the size of the remaining job. The lesson is
the cheap one — re-read the `real` pile before believing it, especially after a
tier closes.
The count has moved in both directions, and both directions were the process
working. It **went up** when seven ledger rows moved from unadjudicated to
`partial`, because a `partial` is a confirmed-absent citation — reading the
ledger finds work as often as it kills it, which is the whole reason Tier 0 sits
above the tiers that do the work. It comes **down** only when a row is retired
with the evidence written into the census itself: 3.1 retired two
(`packages/core/src/game/mon-message.ts` and `parity/ledger/mon-timed.yaml`),
122 to 120, 2.6 retired
`parity/ledger/player-calcs-bonuses.yaml` (120 to 119), and 5.9's neighbourhood
retired `parity/ledger/store-maint.yaml:34` — a row PORT_TODO 2.10 had already
fixed while its ledger prose went on saying otherwise (119 to 118). 5.4 retired
`parity/ledger/obj-randart.yaml:51` the same way (118 to 117), and 5.7 retired
`packages/core/src/obj/randart-build.ts:38` (117 to 116). **Four of those five
were rows whose gap had been closed while their note went on describing it.**
**4.3 then took it 116 to 100**, and the drop has two halves worth separating.
Some of it is 4.3's own: `gen-cave.yaml` was still asserting that labyrinth,
cavern, moria, lair, gauntlet and hard-centre generation were "NOT ported" and
that `town_gen` was "replaced by a minimal open, lit level", all of it built
long ago. The rest was **already true and merely unrecorded**: re-running
`ledger-deferred-items.mjs` retired sixteen verdicts whose bullets had been
REWRITTEN by earlier items (3.25's priority overrides, 5.9's `daycount`, and
others) without the census being regenerated afterwards. The generator carries
a verdict forward by its bullet's TEXT, so rewriting a bullet correctly retires
its verdict — but only when somebody runs it. **Re-run it whenever a ledger
`deferred:` bullet is edited**, or the count keeps quoting work already done.
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
| **7** | **Closed.** Was "a decision to take, not code to write" — and three of the four turned out to be unmeasured claims, two hiding live defects |

Tier order is priority, not dependency; dependencies are named on the item.

Do not tick a box on the strength of having written the function — and do not
add one on the strength of a name not being found. A tick means **the behaviour
is reachable in play and a test constructs the case that used to be wrong.**

---

## Tier 0 — Make the list trustworthy

- [ ] **0.1 Adjudicate the ledger `deferred:` items. 236 of 339 done, 40 of the
  73 ledger files complete.**
  `parity/reports/ledger-deferred-items.tsv` holds items the keyword census
  structurally could not see: an entry under a `deferred:` key inherits meaning
  from the key and mostly does not repeat the word.

  Files fully adjudicated, **listed from the TSV rather than appended to by
  hand** - the previous prose list named `ui-display` and `obj-power`, and
  neither is complete (five and three rows open respectively):
  `combat-melee`, `effects-interpreter`, `game-arena`, `game-cave-cmd`,
  `game-effect-detect`, `game-effect-env`, `game-effect-general`,
  `game-effect-melee`, `game-effect-monster`, `game-effect-summon`,
  `game-effect-teleport`, `game-effect-terrain`, `game-floor`, `game-gear`,
  `game-known`, `game-mon-cmd`, `game-mon-group`, `game-mon-list`,
  `game-player-path`, `game-player-side`, `game-thrust`, `game-trap`,
  `gen-cave`, `gen-framework`, `mon-lore`, `mon-lore-describe`,
  `mon-predicate`, `mon-take-hit`, `obj-desc`, `obj-knowledge`, `obj-value`,
  `player-history`, `session-save`, `store-bind`, `store-maint`, `store-price`,
  `store-transact`, `ui-entry`, `ui-player`, `wizard-debug`.

  The tally, **read from the TSV rather than carried forward**: **137 `ported`,
  35 `stale-doc`, 19 `divergence`, 13 `note-is-fix`, 10 `not-a-deferral`,
  9 `n-a`, 8 `partial` against **5** `real`**. **103 remain.**

  **The 2026-08-07 batch: the `partial` pile.** `partial` 21 -> 6, `ported`
  88 -> 104, and the row total moved 333 -> 338 because one row that bundled
  five separate claims was SPLIT: a row naming five things with five different
  answers can never be closed, and it had been open for that reason alone.

  **The 2026-08-07 batch: the `partial` pile, and three live defects behind
  it.** Read as a group, exactly as the `real` pile had been. `partial` fell 21
  to 17 - a smaller drop, because these rows already carried "LEAD READ"
  evidence from an earlier pass - but the reason it fell is the same and worth
  naming: **every blocker these rows cited had since closed.** 1.1, 2.9, 2.14,
  3.1, 3.2, 3.22 and 3.23 are all `[x]`, and seven rows were still waiting on
  them. A row that names its blocker inherits that blocker's expiry date.

  Three of the seven were not merely stale, they were hiding work:

  - `DETECT_TRAPS` **never identified chest traps at all**. The whole
    "scan all objects in the grid to look for traps on chests" loop
    (`effect-handler-general.c:1354-1376`) was absent, deferred to "object
    knowledge" - which shipped as 2.9. `obj.knownPval` IS `obj->known->pval`.
  - `search` tested chest knowledge **per GRID**, a documented reduction from
    when the port's object memory was one entry per grid. 2.9 made the
    remembered pile per object, so the exact `!obj->known` test is available and
    the recorded divergence (a chest dropped onto already-mapped floor had its
    trap found here but not upstream) is gone.
  - `DARKEN_AREA` named its target monster by **race name**, and the earthquake
    wrote its own `msg()` sentences instead of queueing `MON_MSG_QUAKE_DEATH` /
    `QUAKE_HURT`. Both comments said outright that the real thing was ported and
    could replace them. An unseen target now reads "something" as `MDESC_TARG`
    requires, and the quake lines stack, carry `show_damage`, and are gated by
    `add_monster_message`'s own visibility rule instead of a hand-rolled one.
    The pre-existing test for the darkness message had been pinning the WRONG
    behaviour: its victim was never `MFLAG_VISIBLE`, so it passed only because
    the stand-in named the race regardless.

  A second pass over the same pile closed six more rows and found three more
  live defects of the same shape - a comment saying the real thing was ported
  and could replace the stand-in, with nobody doing it:

  - The **recall title** showed a monster's DEFAULT glyph while the map showed
    the pref-file override, because `monster_x_attr` / `monster_x_char` were
    filed as "presentation state not modelled" when `visuals/glyph-table.ts`
    has held them all along. The tile-size gate they were grouped with is
    unconditionally true here, so it is omitted rather than deferred.
  - A **store could silently destroy an artifact.** `history_lose_artifact`
    fires from `store_delete_random` (`store.c:1091`) and the black-market
    purge (`:1307`), and neither was wired. It matters precisely because store
    generation never MAKES an artifact - the only one a shop can hold is one
    the player sold it, and turnover could then eat it with no log entry.
  - The **kill line** read "Kobold dies." where `mon-util.c:1050-1051` builds it
    with `monster_desc` under `MDESC_DEFAULT|MDESC_COMMA` and `my_strcap`.

  And one row was a **misreading of the C**: `store.c:1928` was filed as "store
  purchase of an artifact", but it sits inside `do_cmd_sell` and logs the
  artifact the PLAYER sold. `do_cmd_buy` has no history call at all, so nothing
  was ever owed there.

  Thirteen mutants across both passes, thirteen kills.

  **Then the same question, asked of the whole open pile.** If a row that names
  its blocker expires when the blocker closes, the cheapest next move is to grep
  the OPEN rows for blocker citations and check each one's status. Thirteen more
  rows fell out immediately: five citing PORT_TODO items that are `[x]` (5.3,
  5.4, 2.6, 3.15, 3.17 - three of those rows had already been rewritten to say
  "NOT DEFERRED ANY MORE" and were simply never given a verdict), and all eight
  citing task **#19**, the monster-spell layer, which has landed entire -
  `breathDam`, `resolveAimedTarget` with both paths, `EF_LASH`'s
  monster-target and decoy branches, `chooseAttackSpell` / `removeBadSpells`
  reached from the live monster turn, `findAnyNearbyInjuredKin` as the filter's
  DEFAULT rather than an unsupplied hook, and `onObject` / `onFeature` wired to
  the live floor and terrain. 200 -> 213 adjudicated, no feature work behind it.

  **What remains in the open pile is mostly two citations**: `#24` (object
  knowledge / ignore) and `#25` (presentation). Both have moved a long way - 2.9
  shipped the known-object pile, `obj/ignore.ts` is real, and the
  unconditional-repaint divergence is ratified - so the sweep continues there,
  one citation at a time rather than one file at a time. The first four `#24`
  rows checked all came back ported, and one of them was a **save-correctness
  claim that was wrong in the reassuring direction**: "killed-unique max_num
  zeroes are session-lifetime only" said a reloaded character could re-fight
  Grip. They cannot. No race-state save section was ever needed - the save
  carries the lore, and the load path re-derives `maxNum = 0` for every unique
  with `pkills > 0`, exactly as `load.c:532-535` does. The comment at
  `session/game.ts:989` had been repeating the row's claim inside the code.

  The fifth was another live defect. **`target_accept` treated a grid holding
  nothing but ignored junk as an interesting target** - the look/target scan
  stopped on it. Upstream walks the remembered pile PER OBJECT and applies
  `ignore_known_item_ok` (`target.c:347-353`); the port asked "does the player
  remember ANY object here", which cannot express the difference. Both halves it
  needed had landed - the per-object pile from 2.9 and `obj/ignore.ts` - and a
  `sensed` entry accepts unconditionally because it IS `unknown_item_kind`: you
  cannot have chosen to ignore what you have not identified.

  Two more rows shared a gap that **does not exist upstream**. Both deferred
  "find-ON-SIGHT" - `object_touch` firing the instant an artifact's pile becomes
  known. It does not: `object_touch` inside `square_know_pile` is gated on
  `loc_eq(grid, player->grid)` (`cave-square.c:1176-1182`), so upstream touches
  only the pile the player STANDS on. There is no discovery-at-a-distance to
  reproduce, the port's gate is the same one, and the reduced glyph-only
  `square_know_pile` the rows blamed for it stopped existing at 2.9.

  **`#24` is now clear: all twenty rows, and not one of them was owed.** Twelve
  came back `ported` on inspection with no work needed, seven had the work done
  in this pass or an earlier one, and one - `monster_race_track` - is a
  `divergence`: its entire body is `upkeep->monster_race = race` plus
  `PR_MONSTER`, which exists to tell a recall SUBWINDOW what to show, and this
  port opens the recall as a modal with the race under the cursor. The citation
  had outlived the subsystem by a wide margin: `obj/ignore.ts` supplies
  `isIgnored` at every site that asked for it, `describeObject` is used
  throughout `obj-cmd.ts`, `exposeToSun` runs on the town 4.3 built, and the
  whole `player_kill_monster` tail - experience, shape revert, dead uniques,
  kill history, drops, quest completion - is live behind `onPlayerKill`.

  **`#25` (presentation) went the same way**, and its rows were wrong in a
  specific direction: they assigned work to "the display layer" and the display
  layer then did it, without anyone coming back. `runTargetLoop` is the
  interactive targeting UI those rows deferred, `chooseItem` is the real "Get
  which item?" picker, `getSpellInfo` turned out to live in CORE rather than the
  shell it was assigned to, and **every interface option the options row listed
  as having "no wired reader" now has one** - `solid_walls`, `hybrid_walls`,
  `auto_more`, `animate_flicker`, `mouse_movement`, `rogue_like_commands`,
  `purple_uniques`. Two rows were also mis-scoped: `PN_IGNORE`'s notice pass
  landed with 1.1, and `MON_MSG_SHAPE_FAIL` rides the message table 3.1 built.

  What survives the sweep is a short, honest list: the `recharge_pow` failure
  RATE (a number no core path computes), `PROJECT_LOS_AWARE`'s notice nuance,
  the `!t` take-off confirmation and ring-slot choice, and the `cmd_get_target`
  retry.

  `real` fell from 17 to 4 on 2026-08-06 without a line of feature work: reading
  the pile as a group found thirteen rows describing work that had already been
  done. Eleven were the display seams of PORT_TODO 3.5-3.13 — every one supplied,
  several of them derived rather than defaulted precisely so no caller has to
  remember — plus a take-notes command that exists. See the header: a `real`
  verdict expires the same way a deferral note does, and it is the one that
  matters, because the owed-work count is computed from it.

  The complete-file count in the heading is derived the same way, and it has now
  drifted **twice**: it read 42 while the TSV said 34, having been incremented by
  hand across batches. Both numbers in that heading are computed from
  `ledger-deferred-items.tsv` (rows with no verdict; files with no such rows) and
  neither should ever be edited by hand again.

  **The 2026-08-06 batch: four files, 17 rows, and one live generation bug.**
  The four were chosen because Tier 4 had just been read end to end, so the
  context was already paid for. Fourteen of the 17 came back `stale-doc` or
  `note-is-fix` - the arena row claiming monster reproduction was unported (it
  is wired, and `monsterTurnMultiply` carries its own arena gate), the trap row
  claiming `playerHasFlag` defaults to no flags (the session supplies it), the
  gen-framework row claiming pits place any depth-appropriate monster
  (`buildPit` calls `setPitType` then `monPitHook`). Two were wrong about
  *upstream* rather than about the port: there are no arena banners in 4.2.6 -
  `EVENT_GEN_LEVEL_START`'s only subscriber is the `wiz-stats.c` statistics
  collector - and there are no themed levels and no streamer treasure nuances
  at all.

  That last row is the one that paid. Checking "no nuances beyond the
  magma/quartz upgrade" meant reading `build_streamer`, and `build_streamer`
  tests **`square_isrock`**, which is narrower than it reads: `TF_GRANITE &&
  !TF_DOOR_ANY`, and only `FEAT_GRANITE` and `FEAT_SECRET` carry `TF_GRANITE`.
  The port tested `isMagma || isQuartz || isGranite` - wider at both ends, so
  streamers overwrote existing veins **and destroyed secret doors**, on every
  classic / modified / moria / lair level in the game. Four more sites in
  `build_staircase_rooms` had the same substitution, where a secret door
  adjacent to a persistent-level join was being sealed with permanent wall.
  Upstream uses `square_isgranite` at two OTHER sites in the same file, so the
  two predicates are not interchangeable and the port was right at those.

  Fixing it moved the generation stream, and all twelve pinned stranded-stair
  seeds went stale at once - which `gen.test.ts` itself calls a behavioural
  regression rather than a stream shift, so it was measured instead of
  asserted. Over an identical 15,000-seed sweep: **137/15000 (0.91%) stranded
  before, 22/15000 (0.15%) after**, depth 1 going 24 to 0. The wart is retained
  and re-pinned with all 22.

  **The six-fold drop was left unexplained here, and has since been explained.**
  Re-running both sweeps and classifying each stranding by mechanism - is the
  sealed stair `SQUARE_VAULT`, and is the region it is sealed into vault to the
  last grid, which is the only thing `join_region` refuses to dig - splits them
  cleanly: **before, 137 = 33 upstream + 104 port defect; after, 22 = 22
  upstream + 0 port defect.** It was never a stream shift. A secret door is
  walkable and a magma vein is not, so every room whose only link to the level
  was a secret door got bricked up with its stairs inside, one of them 2,750
  grids of a depth-1 level. The 33 -> 22 residual is the stream shift, and it is
  small. `gen.test.ts`' control now runs that classifier on every seed, so a
  future stranding that is not upstream's fails the suite instead of being
  written off as a re-pin.

  The re-pin nearly shipped a second defect of its own: 22 hand-written
  direction labels ("both", "up stair sealed off") that were guesses. Derived,
  21 of the 22 strand upward only and exactly one strands downward. The tuple
  now carries the directions and the test **compares** them.

  **The second batch, same day: four more files, 13 rows, two more live
  defects — and both were EXCUSES THAT OUTLIVED THEIR SUBSYSTEM.** A failed
  teleport cast by a monster printed nothing, under a note saying the monster
  "puzzled" line was lore; the monster message queue landed at 3.1 and the row
  itself had already worked that out, one step short of making the call. And
  the monster-heal messages read "kobold looks healthier." with no article,
  standing in `mon.race.name` and a hardcoded "its" under a comment saying MDESC
  "rides the display layer" — `mon/desc.ts` has been ported for a long time. An
  unseen monster was named outright where upstream renders a pronoun, which is
  the separating case the test now uses. 4 mutations, 4 killed.

  The other eleven were stale: arenas guarded, `onKill` supplied, melee already
  routed through `monTakeHit`, store stock and monster held piles and the
  frozen-level cache and the mod manifest all in the save format, a character
  roster with real slots. Two took `n-a` for the same reason — `PR_MONLIST` /
  `PR_HEALTH` have no analogue in an immediate-mode renderer that recomputes
  every frame, though the `health_who` state they gate IS tracked.

  **Adjudicating a row is how the live defects get found.** `combat-melee.yaml:91`
  claimed arena mode was "not begun". Arena mode is finished — but reading
  `mon_take_hit` to prove it turned up **two of its branches that no production
  caller could reach**, both fixed at **2.18**. The row was wrong, and being
  wrong in that particular way is what surfaced them: a note that sends you to
  read a function you would not otherwise open pays for itself even when its
  claim is false.

  **Finish a file before starting another.** The first batch of this session took
  one row from each of five files and completed none of them, which reads as
  progress and is not: a part-adjudicated file still has to be re-opened and
  re-understood. The second batch closed all five.

  **What the batches keep finding is bundled rows.** `game-cave-cmd.yaml:59`
  names five things — steal, pathfinding, run, command repetition, direction
  inference — of which three are fully ported and two are not, so the row cannot
  be closed however much work is done. Same shape as **7.2**. When a row is
  `partial`, the evidence must name which part, or the next reader learns nothing.
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
  (`PN_IGNORE` set and never consumed) and **3.1** (the monster-message queue had
  nowhere to be flushed from — since closed). The sibling `PU_*` / `PR_*` update-and-redraw
  flags are *not* owed — the front end recomputes and repaints after every
  state-changing action, a ratified divergence recorded at
  `packages/core/src/game/known.ts:153`. `PN_*` is different: a queue of work,
  not a dirty bit, and nothing else does that work.
  Sites: `packages/core/src/game/context.ts:297`

  **Built as upstream builds it**: `PlayerUpkeep.notice` is a real bitfield
  (`packages/core/src/player/player.ts:33`), `PN` is three constants
  (`packages/core/src/player/types.ts` — the third arrived with 3.1), and
  `noticeStuff` (`packages/core/src/game/notice.ts`) is the only thing that
  clears a bit.

  **How many `notice_stuff` call sites, exactly.** `grep -rn notice_stuff
  reference/src/*.c` finds **fifteen**, not the eight this item first claimed —
  the claim was counting `game-world.c` and stopping there, which is the
  [[a-claim-wider-than-what-was-checked]] shape. The honest accounting:
  `game-world.c` has seven and all seven are covered — the two in
  `process_player` (`game/player-turn.ts`), the three in the world loop
  (`game/loop.ts`), `on_new_level` at all four of the port's level-entry paths
  (`noticeNewLevel`), and `on_leave_level`'s, which this port folds into the
  ENTRY path and documents as observationally identical (`session/game.ts:2176`).
  `mon-util.c` has two, both inside `player_kill_monster`, and **both were
  unwired until 3.1** — they are the flush that keeps a kill line behind the pain
  it caused. The remaining six are `obj-gear.c`'s trailing drain in
  `pack_overflow` (a within-turn ordering nuance; the port's `overflowPack` runs
  between the two `process_player` drains) and five in the store subsystem
  (`store.c`, `ui-store.c`), which raise no bit this port's stores can raise.

  The raise sites are wired too — **17
  `|= PN.COMBINE` and 8 `|= PN.IGNORE`**, counted by grep, not estimated — across
  `gear.ts`, `obj-cmd.ts`, `effect-item.ts`, `world.ts`, `mon-side.ts`,
  `chest.ts`, `pickup.ts`, `wizard.ts`, `ignore-cmd.ts`, `notice.ts` and
  `session/game.ts`. Two of those (inscribe, uninscribe) raise both and so appear
  in both counts, as upstream does.

  **`PN_MON_MESSAGE` was deliberately absent, and then it was earned.** This item
  left the third constant out on purpose: `show_monster_messages` had no port,
  and a bit nothing raises and nothing consumes is exactly what made `PN_IGNORE`
  look ported for months. It went in with the message queue, in **3.1**, in one
  change — which is what was promised here.

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

- [x] **2.6 `known_only` does not exist.** DONE, **and the row's own example was
  the one number the flag can never hide.** Both halves matter.

  **What was built.** `CalcBonusesOptions.knownOnly` takes the known-twin view
  and opens exactly the five gates upstream puts behind the flag:
  `object_flags_known` instead of `object_flags` (1933-1939), the `el_info`
  res_level test (1985), and `to_a` / `to_h` / `to_d` (1997 / 2001 / 2004).
  `state->ac += obj->ac` (1996) is deliberately **not** gated — base armour is
  obvious on sight. The session derives `p->known_state` beside `p->state` on
  every `refreshDerived`, exactly as `update_bonuses` does
  (`player-calcs.c:2348-2349`), and once more at the end of `wireGame` so a
  loaded character is not shown true numbers until they next change a ring.

  It is a **function, not a boolean**: `known_only = true` with no way to ask
  what is known is not a state the derive can be in, so it is not a state the
  type can express. `PlayerActor.knownCombat` is **required** for the same
  reason — an optional field would let a caller supply `combat` alone and every
  display would silently fall back to the real state, which is the bug.

  **Three readers, all upstream's own.** `prt_ac` (`ui-display.c:307`), the
  character sheet's combat panel (`ui-player.c:736-768`, which also puts the
  weapon and launcher through `objectKnownShadow` because upstream reads
  `obj->known` there), and — the one that actually changes play — the monster
  recall's danger colouring. `player_inc_check` takes a `lore` argument whose
  entire job is to switch three checks from `state` to `known_state`
  (`player-timed.c:930-1000`), and `buildLoreColorState` was reading the real
  one.

  > **The correction.** The row said "an unlearned `+to_a` rune is included in
  > the AC the player is shown". It cannot be:
  > `do_cmd_accept_character` sets `obj_k->to_a = to_h = to_d = 1` at birth
  > (`player-birth.c:1264-1267`, under the comment *"Hack - player knows all
  > combat runes. Maybe make them not runes? NRM"*), so **all three combat
  > gates are permanently open** for an ordinary character. What `known_state`
  > really withholds is **resists and object flags**, which are learned by use —
  > and those are what the recall reads. The scoping sentence pointed at the two
  > screens that barely move and missed the one that does.
  >
  > The other path on which the combat gates DO close is an **unassessed**
  > object: `player_know_object` returns after the base properties for an item
  > the player has seen but never handled (`obj-knowledge.c:1033-1035`).

  A curse contributes nothing to the known state, and that is measured rather
  than assumed: `write_curse_kinds` (`obj-init.c:174-195`) gives every curse
  template a twin from `object_new()` and writes only its kind, sval and the
  ASSESSED bit, so its flags, `el_info` and combat numbers stay zero forever.

  16 mutations, 16 killed — but one only after its test was rewritten. The
  fixture for "`knownCombat` is the known derive" passed against a mutant that
  aliased it to `actor.combat`, because `refreshDerived` computes the known
  state **before** it reassigns `actor.combat`, so the alias held the previous
  turn's object and that object happened to carry the right answer. Two
  `updateBonuses` calls settle it. Same family as
  `a-fixture-value-that-cannot-disagree`.
  Sites: `packages/core/src/player/calcs.ts:634`,
  `packages/core/src/obj/known-object.ts:762`,
  `packages/core/src/game/lore-color.ts:44`

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

- [x] **2.9 The known-object shadow cave — the remembered PILE.** DONE. The
  remaining half of this row was that the player's memory of a grid's floor was
  ONE object. Upstream's `player->cave` holds a shadow object per remembered
  object, and three things read that list: `map_info`'s object loop
  (`cave-map.c:155-169`), `object_list_collect` (`obj-list.c:167`) and
  `forget_remembered_objects` (`cave-square.c:1104`). With one memory per grid
  none of them could be faithful.

  **The blocker was imaginary, and naming it is what unblocked the row.** A
  shadow needs a link to its original; upstream spends `obj->oidx` plus the
  whole `cave->objects[]` registry on that link because C cannot hold a pointer
  that survives a level and a savefile. **A JS reference is that link.** The
  registry the earlier scoping assumed had to be built first — 80 factory call
  sites — was never needed: `KnownObject` is `{ obj, sensed }`, `obj` IS what
  `ignore_known_item_ok` resolves oidx to (`obj-ignore.c:636-646`, which tests
  the ORIGINAL, not the shadow), and reference identity is what
  `forget_remembered_objects` compares.

  **Three player-visible defects, each proved by a test that fails without the
  fix.** All three had been invisible because the two consumers papered over
  the single memory by reading the LIVE floor pile — the level, not the
  player's knowledge of it:

  - **A knowledge leak in the `[` object list.** Any grid carrying a memory had
    its whole live pile listed, so an object dropped out of view onto a grid the
    player had once seen was announced the moment it landed. The reverse too: an
    object taken out of view vanished at once, where upstream keeps showing it
    until the grid is re-seen.
  - **The `<pile>` glyph never drew.** `grid_data.multiple_objects` had nothing
    to compute it from, and `ObjRegistry.pileKind` was bound, asserted in a test
    and read by **no production code** — shipped and unreachable. A grid holding
    two or more remembered items drew the top item instead of `&`.
  - **Ignore hid the wrong thing.** `"Item stays hidden"` (`cave-map.c:162`)
    SKIPS an ignored entry without consuming the `first_kind` slot, so upstream
    falls through to the object underneath. The port could only ask "is EVERY
    live object here ignored", so an ignored item lying on top of a wanted one
    hid both.

  Also fixed on the way: `forget_remembered_objects` now honours its predicate,
  so a know/sense of one object class no longer clears another class's memory;
  and a sensed marker correctly outranks an exact memory on the same grid
  (`ui-map.c:200-212` tests the stars before `first_kind`).

  **SAVE_VERSION 3 → 4, with the 3 → 4 step in the same commit.** A memory is
  saved as a LOCATOR into the saved floor (`[grid index, position in pile]`),
  not a copy — identity is what `forget_remembered_objects` compares, so a
  lookalike would make every pile forget itself the first time the player
  looked at it. That claim has its own test. A version-3 memory carried a kind
  and no link, so it widens to a one-element detached memory that draws exactly
  what version 3 drew and heals on the next sight of the grid; the round-trip
  test adds a `toV3` down-converter and asserts every remembered kind survives.

  Six mutations, six kills.
  Sites: `packages/core/src/game/known.ts:131`,
  `packages/core/src/game/known.ts:533`,
  `packages/core/src/session/save.ts:1187`

- [x] **2.10 `object_flag_is_known` at the store sites.** DONE — **with 5.8, which
  is the same line.** Both rows point at `storeWillBuy`'s buy-list branch, 2.10
  through the buy check and 5.8 "reached through maintenance"; there is one gate
  and it was commented out. Upstream needs BOTH conjuncts (store.c L550-551) and
  the port had only the first, so a store would buy on a rune the player had
  never learned.

  `object_flag_is_known` did not exist as a function — it was inlined, partially,
  in one place. It is now written once with all three of upstream's routes
  (`obj/known-object.ts:398`) and `storeWillBuy` takes the bound predicate as a
  **required** seventh argument, which is how the supplier set was enumerated:
  the compiler named seven call sites, two of them production.

  **Two things worth keeping.** First, the branch is unreachable on 4.2.6 data —
  every `buy:` line in `lib/gamedata/store.txt` is a bare tval and `buy-flag:`
  appears only in that file's own format comment — so the fix is for mod data and
  for the code being right, not for a bug a player can hit today. That was
  measured, not assumed from the port's comment saying so. Second, the third
  route (`obj->known->flags`) is **provably redundant in this port**:
  `objectKnownShadow` builds the shadow's flags as `obj.flags ∩ p->obj_k->flags`,
  so route 3 implies route 2, and the one branch that copies wholesale is gated on
  `objectFullyKnown` where route 1 has already returned. That is why
  `game/ui-entry.ts:1256` inlining only two of three routes is **complete rather
  than deficient** — it looked like a second gap until the shadow was read.

  Both conjuncts are mutation-verified: dropping either kills a different test.
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

- [x] **2.14 Mimic bookkeeping.** CLOSED. Two unported arms, both found by
  reading every `mimicked_obj` / `mimicking_m_idx` site in the C rather than
  trusting the row that grouped them — which is how 2.9 turned up the first one.

  **`push_object` had no mimic arm.** Upstream (`obj-pile.c:1213-1256`) treats
  an unrevealed mimic specially: it clears `mimic->mimicked_obj`, scatters
  outward from d=1, and on the first grid that takes the object it **moves the
  monster with it** (`monster_swap`) and re-links the pair — or, at d>=4,
  destroys BOTH. The port sent every object through `dropNear`, so a door
  created on a grid holding an unrevealed mimic separated the monster from the
  object it was pretending to be, leaving `obj.mimickingMIdx` pointing at a
  monster somewhere else. Now `pushMimic`
  (`packages/core/src/game/project-feat.ts:96`). Reachable through the
  door-creating effects (`game/effect-general.ts:190`,
  `game/effect-terrain.ts:347`).

  Keeping the `mimickedObj = 0` clear across the scatter is not hygiene. Two of
  `monster_swap`'s three readers cannot tell (both resolve through the
  monster's old grid, which `push_object` has emptied), but `update_mon` can:
  a monster still mimicking a non-ignored item KEEPS `MFLAG_VISIBLE` when it
  drops out of sight (`mon-util.c:429-433`). Leave the link up and the mimic is
  marked visible in transit. A mutation that drops the clear survived nine
  tests before that one was written.

  **`delete_monster_idx` never deleted the mimicked object**
  (`mon-make.c:385-387`). `monster_death` always has
  (`game/mon-death.ts`, `mon-util.c:957-961`) — but 17 of the 18 ways a monster
  leaves the level go through `deleteMonster` instead, including banishment
  (`game/effect-monster.ts:119`, `:152`). Any of them left the fake item on the
  floor forever, pointing at a monster index the next monster would reuse. Now
  handled at `packages/core/src/game/context.ts:1266`.

  The other two `mimicking_m_idx` sites in `obj-pile.c` were already closed:
  `object_stackable`'s "mimicked items do not stack" (`:406`) is ported at
  `obj/object.ts:1001` and IS reached through `objectMergeable`; the orphaning
  arm at `:338` belongs to the shadow registry the port replaced. The remaining
  eleven `mimicked_obj` sites in the C all have live ports —
  `monster_index_move` (`game/world.ts:690`), `mon_create_mimicked_object`
  (`game/mon-place.ts:335`), `monster_is_mimicking` (`mon/predicate.ts:190`),
  `update_mon`'s two (`game/known.ts:949`, `:972`), `move_mimicked_object`
  (`game/known.ts:1063`), `monster_swap`'s two — folded into one `moved()`
  helper that runs for each half (`game/context.ts:1197`) —
  `become_aware` (`game/known.ts:1022`), `monster_death`
  (`game/mon-death.ts:306`) and the save/load relink.

  NOT closed by this, and still deferred: `delete_monster_idx`'s **held-object**
  drop and its redraw requests. Those are a different subsystem, not mimicry.

  Tests: `packages/core/src/game/push-object.test.ts` (13). Seven mutations,
  seven kills — two of them only after a test was added to catch a survivor
  (the `mimickedObj` clear above, and the d>=4 cutoff, which the walled-in
  fixture could not distinguish from d>=5 because granite blocks the line of
  sight the scatter needs).
  Sites: `packages/core/src/game/context.ts:1266`,
  `packages/core/src/game/floor.ts:30`,
  `packages/core/src/game/project-feat.ts:96`,
  `parity/ledger/game-project-monster.yaml:49`

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

- [x] **2.18 A commanded monster cannot drop what it is carrying.** DONE, and
  the row was right about the shape of the error: the branch's own comment said
  monster-held objects "are not modelled", and every piece it needed already
  existed. `mon.heldObj` is a real pile, `monsterCarry` fills it from generated
  treasure / a TAKE_ITEM pickup / an EAT_ITEM theft, `monsterDeath` empties it
  onto the floor, and `getRandomMonsterObject` is the same `one_in_(i)`
  reservoir draw upstream makes. `commandedDrop` is now the eleven lines of
  `cmd-cave.c:1854-1868` over those pieces.

  Two details worth keeping:

  - **The empty pile still spends the turn.** Upstream `break`s out of the
    switch rather than returning, so a monster told to drop nothing stands
    there for a move. A `return 0` would have been the natural-looking mistake.
  - **`object_desc` runs AFTER `drop_near`, and the port is the safer of the
    two.** When the drop merges into a floor stack, `object_absorb` writes the
    new count into the PILE's object and leaves the dropped one untouched, so
    both read pre-merge values - except that upstream is reading a struct
    `floor_carry` has already freed. Same string, one of them by luck.

  > **The first version of the `held_m_idx` test could not fail.** It asserted
  > `obj.heldMIdx === 0` after an ordinary drop - and `floorCarry` sets that
  > field itself (`floor.ts:364`), so deleting upstream's `obj->held_m_idx = 0`
  > left it green. The line only matters when the carry FAILS, so the fixture
  > now walls off `drop_find_grid`'s entire 7x7 window and the object ends up
  > nowhere with nobody but L1858 to clear it. Same lesson as
  > `a-fixture-value-that-cannot-disagree`.

  **Two neighbouring ledger deferrals were retired in the same pass, both
  describing states that had ended and two of the three claims false outright**
  - see `parity/ledger/game-mon-cmd.yaml`. Monster names are a full
  `monster_desc` with upstream's own flag sets, the light-purple commanded
  highlight is `game/display.ts:396`, the mon-target timed statuses are ported
  and tested, and `blinked` is upstream **dead code** in
  `monster_attack_monster`: all four `context->blinked = true` sites are behind
  `if (context->p)` or behind a `monster_damage_target(context, true)` that
  returns first for a monster target.
  Sites: `packages/core/src/game/mon-cmd.ts:583`

- [x] **2.21 Two `mon_take_hit` branches no production caller could reach.** DONE
  — found while proving **0.1**'s `combat-melee.yaml:91` wrong, and both are the
  shape this list keeps re-learning: **an optional hook nothing passes is a
  branch that cannot run.**

  `MonTakeHitHooks` carried five optional fields. Two of them had **no
  production supplier at all**, and both were ported, tested, and dead:

  - **`coverTracksBroken`** — `p->timed[TMD_COVERTRACKS] = 0` (`mon-util.c:1285`)
    on every damaging hit. Zero suppliers; the only references outside the
    declaration were two lines in `mon/take-hit.test.ts` and a forwarding
    conditional in `project-monster.ts` fed by nobody. So a Ranger who cast
    Cover Tracks (`class.txt:1562`, level 20, in the port's content pack) kept
    the timer through combat and stayed unseen by distant monsters
    (`mon-ranged.ts:296` quarters their range, `monster-turn.ts:277` hides the
    player). Upstream takes it away on the first blow.
  - **`primaryGroupSize`** — `monster_primary_group_size` feeding
    `monster_can_be_scared`'s per-member fear save (`mon-predicate.c:296`). One
    supplier existed, `mon-death.ts:431`, and it is the **monster-on-monster**
    path (`mon-util.c:1242`). The player path defaulted to 1, so `count = 0`,
    so the save never fired for anything the player hit, and its `one_in_(20)`
    draws never reached the RNG stream.

  Fixed by deriving both from the live state in one place —
  `gameTakeHitHooks(state, mon)` in `game/context.ts` — rather than adding two
  more fields four call sites must remember. Wired at all four:
  `player-turn.ts` (via `buildMeleeHooks`, which feeds the pure combat layer's
  two calls), `effect-melee.ts`, `project-monster.ts`, `ranged-cmd.ts`. The dead
  `ProjectMonsterHooks.coverTracksBroken` forwarding field is deleted.

  > **The first census I wrote could not fail.** It asked whether each caller's
  > file *contained* the string `gameTakeHitHooks` — and the **import line** made
  > that true. Deleting the spread from all three game-layer call sites left it
  > green. It now counts `...gameTakeHitHooks(` occurrences against `monTakeHit(`
  > occurrences, and unwiring any one site fails it. Same lesson as
  > `a-guard-that-cannot-fire`, re-earned in the guard written for it.

  All six tests in `packages/core/src/game/mon-take-hit-hooks.test.ts` are
  mutation-verified: constant-1 group size, no-op cover-tracks, and unwiring
  each of the four suppliers each kill at least one. **Three source comments
  claiming arena mode was "not modelled" were corrected in the same pass**
  (`effect-melee.ts:23`, `mon/take-hit.ts:17`, `mon/predicate.ts:11`) — arena is
  finished, which is what `combat-melee.yaml:91` was wrong about.
  Sites: `packages/core/src/game/context.ts:1322`,
  `packages/core/src/mon/take-hit.ts:180`,
  `packages/core/src/game/player-turn.ts:185`

- [x] **2.19 A commanded monster's blow does nothing but damage to a monster.**
  DONE, and **the row's headline was already false while its footnote was the
  real defect.** Both halves are worth writing down, because they fail in
  opposite directions.

  **The headline — retracted.** The mon-target blow handlers do NOT reduce to
  damage plus the critical stun. `BLIND -> MON_TMD_STUN`,
  `CONFUSE -> MON_TMD_CONF`, `TERRIFY -> MON_TMD_FEAR` and
  `PARALYZE -> MON_TMD_HOLD` are ported at upstream's own amounts and tested.
  Poison against a monster carries no timed poison **upstream either**
  (`mon-blows.c:679-681` returns before the player-only tail), so naming it was
  a description of 4.2.6. And the "blinked teleport" **cannot happen**: all four
  `context->blinked = true` sites (`mon-blows.c:301`, `:795`, `:840`, `:863`)
  sit inside an `if (context->p)` arm or behind a
  `monster_damage_target(context, true)` that returns first for a monster
  target, so `monster_attack_monster`'s teleport tail at `mon-attack.c:887` is
  **upstream dead code**. Omitting it is exact, not reduced.

  **The footnote — real, and mis-described.** It said door bashing "does not
  roll the upstream broken-vs-open split". There is no such roll:
  `square_smash_door` always sets `FEAT_BROKEN`, and the open-vs-bash choice is
  a flag test the port already made. The two genuine defects were:

  - **`SMASH_WALL` shared `KILL_WALL`'s body.** A commanded smasher bored a
    corridor instead of blowing a hole, and — because `square_smash_wall`'s
    per-neighbour `one_in_(4 / 10 / 20)` survival rolls never happened — the
    RNG stream diverged from the *same monster smashing the same wall on its
    own turn*.
  - **Both door branches set the feature and left the lock.** A door's lock is
    a "door lock" trap on the grid, so a burst-open door kept a lock
    `square_door_power` would still report.

  > **The cause was structural, and the fix is the part that lasts.**
  > `monster-turn.ts` held a correct, **file-private** copy of all five
  > `cave-square.c` mutators; `mon-cmd.ts` had open-coded a degraded second
  > set. Neither could learn from the other. They are now one module,
  > `packages/core/src/game/cave-square.ts` — one body per C function, and the
  > C file finally has a name in the port. Same shape as
  > `neo-angband-duplicated-c-functions`.
  >
  > The commanded walk also read the door lock through a **different seam**
  > from the one the monster's own turn used (a threaded `TrapDeps` versus
  > `state.doorLockPower`), so a caller could supply one and not the other. One
  > seam now.

  10 mutations, 10 killed.
  Sites: `packages/core/src/game/cave-square.ts:1`,
  `packages/core/src/game/mon-cmd.ts:604`

## Tier 3 — It changes what the player is told

- [x] **3.1 `add_monster_message` has no queue.** DONE. The grammar was already
  verbatim — `get_subject`, `get_message_text`, `message_pain`, the
  `[singular|plural]` state machine — and every one of those was reachable, so
  the item read like a polish job. It was not: the BATCHING is the behaviour,
  and none of it existed.

  **What the port did instead.** Every emit site formatted one sentence and
  printed it where it happened. A fireball over a kobold pit produced eight
  identical "The kobold dies." lines in projection order; a monster caught twice
  by one splash was described twice; and a death could be reported before the
  pain that preceded it. Upstream has never done any of that, and the reason is
  one 200-entry array.

  **Ported whole** into `game/mon-message.ts`: `add_monster_message` /
  `add_monster_message_show_damage`, `stack_message` (with its saturating damage
  add), `redundant_monster_message` + `store_monster`, `message_flags`,
  `what_delay`, `show_message` and `show_monster_messages`. `PN_MON_MESSAGE` is
  the third `PN` bit — the one 1.1 deliberately left out until there was
  something to raise it — and `noticeStuff` drains it. The queue is a
  `WeakMap<GameState, ...>`, the closest thing to upstream's file statics that
  two games in one process can both have; it is transient and not serialised,
  exactly as `size_mon_msg` is.

  **Three things that had to be found by reading, not by grepping the item.**
  1. `player_kill_monster` calls `notice_stuff` ITSELF before saying the kill
     line (`mon-util.c:1046` and `:1055`, both commented "Make sure to flush any
     monster messages first"). Without that the direct kill line jumps ahead of
     every queued pain line — the player reads "Kobold dies." and only then "The
     rat cries out in pain." Wired at the port's two analogues,
     `game/ranged-cmd.ts` and `game/effect-melee.ts`, both tested.
  2. `ProjectMonsterHooks.message` had `delay?: boolean` and eight of its eleven
     call sites omitted it. Upstream writes the argument out at every single
     call. Made required and filled in, because a defaulted `delay` silently
     moves a line from the delayed pass into the immediate one and nothing
     fails.
  3. The timed-effect sink (`mon-timed.c:215`) had **no test at all** — deleting
     its body outright broke nothing. Found by mutation, now covered both ways.

  **Nineteen mutations, nineteen kills**, after the three survivors each earned a
  test rather than an excuse.

  **The `(offscreen)` tag, and the one line no test can reach.** `message_flags`
  reads `state.panelContains` for `MON_MSG_FLAG_OFFSCREEN`. Core cannot compute
  it — it has no idea how many rows the terminal gave the map — so `panelContains`
  (`game/display.ts`, `ui-output.c:689`) takes the camera as an argument and the
  shell binds `state.panelContains` from its own `viewport()`. The predicate is
  tested at all four edges plus the negative-coordinate case that upstream's
  UNSIGNED `(y - offset_y) < hgt` relies on. `mon-cast.ts`'s separate
  `panelContains` dep — which also had no supplier — is deleted and reads the
  state instead, so there is one camera and one place to bind it.

  **What is NOT covered:** the binding line itself in `packages/web/src/main.ts`.
  Nothing imports `main.ts`, so no vitest can see it — the same status as
  `state.sound` and every other wiring line in that file. Verifying it means
  driving the desktop build over CDP with a monster outside the panel, which has
  not been done. Said here rather than left to be assumed from "tested".

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

- [x] **3.3 Object and ego recall show no computed lines.**
  Both recalls now print what upstream prints. Browsing `~` → known objects and
  selecting a Short Sword used to give the name and the record's one-line
  flavour; it now gives the blows-per-round table, the average damage, the
  digging times and the flag lines — `object_info(OINFO_FAKE | OINFO_SUBJ)` over
  an `object_prep(EXTREMIFY)` throwaway. An ego row used to give the ego name
  and its `desc:` line; it now gives what that ego grants.

  **The item undercounted the work in the same way 3.26 did.** Two things it
  did not mention were missing outright, both because the only mode bit that
  reaches them is the one only `object_info_ego` sets, and nothing set it:
  - `object_info_ego` itself (`obj-info.c:2402`) — the whole producer, now
    `objectInfoEgo` in the new `packages/core/src/obj/fake-object.ts`;
  - **`describe_ego` (`obj-info.c:2281`) had never been ported at all.** The
    port's `objectInfo` carried the comment *"describe_ego is skipped for
    inspect (ego bit off)"* — true, and the reason the omission was invisible.
    Its five lines ("It provides one random higher resistance." and the rest)
    are the only place the game ever tells you what a random-pick ego rolls.

  Three more things that reading the C turned up, each measured rather than
  assumed:
  - **`ego->poss_items` is a stack, not a list.** Upstream PREPENDS every
    parsed entry (`obj-init.c:2322`, `:2350`), so the head `object_info_ego`
    describes the ego on is the kidx added **last** — and that is not
    recoverable from the port's `Set<number>`, because re-adding a kidx is a
    no-op there and a re-prepend upstream. `of *Slay Undead*` declares
    `type:sword|polearm` and then hafted `item:` lines, so it picks a hafted
    kind where the Set's first member is a sword. New `EgoItem.firstPossItem`,
    computed in `bind.ts` as upstream computes it.
  - **`get_known_flags` (`obj-info.c:2217`) had one of its two branches.** The
    port hardwired `flags = shadow.flags` — the `else`. Both arms are now
    written. Both are transcription rather than repair, and the measurement is
    in the comment: with the twin a full `object_copy` the EGO arm returns the
    same set as the other, and **every** base in the shipped `object_base.txt`
    carries zero object flags, so the TERSE diff removes nothing today. They
    are there so a mod that adds a base flag does not find half a function.
  - **The no-abilities fallback had three newlines where upstream has two**
    (`obj-info.c:2381`). Nothing printed that line until these recalls started
    running, which is exactly why it survived.

  And one adjacent hole the new screen made visible: `inspectExtras` in
  `main.ts` never supplied `summonDesc`, so an item that summons read
  "it summons ." The effect MENU has always had it; this list did not.

  **The one branch the engine cannot express.** For an unaware flavoured kind
  upstream's known twin is a blank `OBJECT_NULL`, so `object_info_out` returns
  at its very first line with "You do not know what this is." The port's
  knowledge shadow ALWAYS mirrors `obj.kind` (`objectKnownShadow`), so that
  branch is written at the call site and tested there — without it an
  unidentified potion would have leaked its full effect list.

  **Verified.** 18 core tests (`obj/fake-object.test.ts`) + 10 web tests
  (`knowledge-recall.test.ts`), fixtures FOUND by the property under test
  rather than named — "of Elvenkind" alone is three different egos and only two
  carry `RAND_HI_RES`. Two of them are guards built to be able to fire at all:
  no shipped ego carries two random-pick flags, so the else-if chain is tested
  against a constructed two-flag ego; and the one ego with `NO_FUEL` also turns
  `TAKES_FUEL` off, so `&&` vs `||` is tested by taking each half away.
  **17 mutations, 16 killed.** The survivor is `flags = obj.flags` →
  `shadow.flags` in the EGO arm, which is the equivalence documented above, not
  a hole. Three of the kills only arrived after the test earned them: the
  `&&`/`||` pair, the else-if chain, and the all-runes player inside
  `objectInfoEgo` — that last one *survived a core-only run* because this test
  file's module-level player already knows every rune, which is the scoped-file
  trap again.
  Sites: `packages/core/src/obj/fake-object.ts` (new),
  `packages/core/src/obj/object-info.ts:1725`, `:1777`, `:1836`,
  `packages/core/src/obj/bind.ts:958`, `packages/core/src/obj/types.ts:410`,
  `packages/web/src/knowledge.ts:1054`, `:1180`, `packages/web/src/main.ts:2020`

- [x] **3.4 Monster spell and breath damage are not bound to the casting race.**
  **NOT A GAP — the item was wrong, and its own reasoning is what made it
  wrong.** It went from "`deps.spellLoreDamage` has no supplier" to
  "`monSpellLoreDamage` returns 0 and the `(N)` is omitted at every spell."
  But `spellLoreDamage` is an *override*, not the producer. With it absent the
  default computes the damage from bound data (`lore-describe.ts:449`):
  `monSpellNonhpDamage` for ordinary damaging spells, needing **nothing**
  injected, and `breathDam` for breaths, needing only `breathProjection` —
  **supplied since `bd06e3539` (2026-07-13)** at `packages/web/src/main.ts:3679`,
  in the very commit that built the recall viewer. *An unsupplied optional is
  not evidence of an unreachable feature.* The item never opened the default.

  Verified rather than assumed, and with **derived** expectations rather than
  declared ones: `mon/lore-describe.test.ts:110` computes
  `min(avgHp / divisor, damageCap)` from the shipped projection record for the
  breath and `15 + 3*spellPower` / `trunc(spellPower/3) + 56` from
  `monster_spell.txt`'s dice for BA_ACID and BO_ACID, and pins that
  `armour_known` gates the breath number but not the dice one (upstream's
  `nonhp_dam` takes no hp). `web/screens.test.ts:907` repeats it through
  `monsterRecallLines`, including the negative case with `breathProjection`
  unwired.

  **The limit those green tests do not cover:** `screens.test.ts` rebuilds
  `recallDeps()` by hand rather than importing it, because nothing imports
  `main.ts` — a hand-written mirror. So the *values* are proven and the *shell
  binding line* is not; I read it instead, and `booted.registries.projections`
  is the same PROJ-indexed `bindProjections` array the fixture binds, so
  `projections?.[subtype]` resolves. Same status as `state.sound` and the
  `panelContains` binding at 3.1.
  Sites: `parity/ledger/mon-lore-describe.yaml:55`

- [x] **3.5 The sidebar's stat rows ignore equipment.**
  DONE. The row was exactly right, including the contradiction it named: a
  `+STR` ring moved the character sheet and left the sidebar alone.

  The fix is one line and it is the same shape as **3.10**'s: the dep was
  DERIVABLE, not merely unsupplied. `state.playerState` already carries the
  live `calc_bonuses` result — the shell reinstalls it on every equipment
  change (`session/game.ts:718`) and `numMoves` had already been rewired to
  read it — so `statUse` now defaults from there, and only a state with no
  `playerState` at all (the worldless test harness) falls back to race+class.
  Chasing the shell for a `displayDeps` line would have fixed the web and left
  every other host with the same bug.

  Nothing else in `prt_stat` was wrong: the reduced label, the yellow/green
  split, the `!` at col+3 and the six-char `cnv_stat` value are verbatim
  (`display.ts:417`), which is why only the number was off.

  Tests: three in `game/display.test.ts`, built through the real `calcBonuses`
  with a +5 STR item and the rune learned rather than a hand-written
  `statUse` array — one asserts the sidebar shows the worn value, one that it
  now agrees with the character sheet's Best column, one that the fallback
  still stands when `playerState` is absent. Mutation-checked (M16).

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

- [x] **3.14 The object glyph ignores flavour awareness.** CLOSED, and the item
  understated it: the map renderer already had the rule right, and every OTHER
  place that draws an object had it wrong, each in its own way.

  `use_flavor_glyph` (`ui-object.c:87-90`) is
  `kind->flavor && !(tval == TV_SCROLL && kind->aware)`. The scroll exception
  runs against intuition — a scroll's flavour is its unreadable TITLE, so
  awareness ENDS it, where a potion's flavour is what the potion looks like and
  awareness does not. Small enough to inline, and just wrong enough when
  inlined, which is why it now lives once at
  `packages/core/src/visuals/object-glyph.ts:45` and every consumer calls it.

  **How bad it looked.** Measured from the shipped pack rather than assumed:
  every flavoured kind carries colour `d` (dark) except scrolls (`w`), while
  flavour colours are Green, Violet, Light Blue, Light Umber. So a worn ring or
  amulet drew as a BLACK glyph anywhere the rule was skipped. Nothing leaked —
  the kind colours inside a tval are all identical, so the dark glyph told the
  player nothing they should not know — but the item was invisible.

  The five draw sites in the C (`object_char` / `object_kind_attr` /
  `object_kind_char` callers), each checked against the port:

  1. `prt_equippy` (`ui-display.c:285`) — the `objectAttr` / `objectChar` seam
     had a comment saying the flavour-aware version was "a presentation concern
     each shell supplies", and **no shell supplied it**. Now the DEFAULT
     (`game/display.ts:271`), so the seam is an override rather than a
     requirement. The seam stays for a front end with a pref-file TileMap,
     because upstream reads `flavor_x_attr` / `kind_x_attr`, not the record.
  2. `display_player_equippy` (`ui-player.c:365-367`) — the character sheet's
     resistance-panel row read `kind.dChar` and painted every slot a fixed
     white, so a Long Sword and a Ring of Speed were the same colour. Now
     `packages/web/src/charsheet.ts:215`.
  3. `ui-obj-list.c:131-141` — the `[` list gives the GLYPH the kind's own
     colour and only the NAME the line attribute, and an unknown entry is a RED
     asterisk. The port painted the glyph the line colour and never went red.
     Now `packages/web/src/screens.ts:1047`.
  4. `ui-equip-cmp.c:2107-2108` — `packages/core/src/game/equip-cmp.ts:468`.
  5. `ui-map.c:203-204` — already correct (`packages/web/src/main.ts:6478`),
     and its own comment claimed it was "THE one place the port decides how an
     object kind draws". It was not; that claim is what this item disproves.
     It now calls the shared rule instead of its own copy, as does the agent
     API's grid view (`packages/core/src/agent/perceive.ts:353`), which had a
     third copy.

  NOT done, and neither is a glyph bug: the port has no missile-flight
  animation at all, so `ui-display.c:1707`'s `print_rel(object_char(...))` has
  nothing to be wrong in; and the autoinscribe menu
  (`packages/web/src/screens.ts:993`) still reads `kind.dAttr`, left alone
  because it is a port-specific screen with no GameState in scope and I could
  not tie it to an upstream site.

  Tests: `packages/core/src/visuals/object-glyph.test.ts` (8) and the
  `prt_equippy` describe in `packages/core/src/game/display.test.ts` (3). Three
  mutations, three kills — one of them a verbatim restore of the old defaults.
  Sites: `packages/core/src/visuals/object-glyph.ts:45`,
  `packages/core/src/game/display.ts:232`,
  `parity/ledger/ui-display.yaml:116`

- [x] **3.15 `feeling-need` is hardcoded.** DONE.
  The row was right about the smell and one step off about the defect. The two
  `10`s are FALLBACKS, and both live call sites of `displayFeeling` were already
  passing `constants.feelingNeed`. The one place that was not is the one the row
  did not name: **`displayDeps()` in `main.ts` never supplied the dep at all**,
  so `prt_level_feeling` — the `LF:` indicator on the status line — read the
  fallback. A pack that changed `world:feeling-need` was obeyed by `^F` and
  ignored by the indicator sitting next to it.

  Fixed at the shell, and the two literals are now one exported
  `SHIPPED_FEELING_NEED` with its citation, checked against
  `reference/lib/gamedata/constants.txt` by a test that **parses the file** —
  a number typed into two places agrees with the data only until it doesn't.
  12 mutations (shared with 3.24), 12 killed. One survivor on the first pass, and
  it is the reason the guard above matters: **every existing `displayFeeling`
  test passed `feelingNeed: 10`, the same value as the fallback**, so all of them
  pass whether the argument is read or thrown away. Neutering the option survived
  them all. The new case uses 20 and 3, and asserts the answer changes in both
  directions. (The mutation also survived a first run because its test file was
  not in the run's file list — both faults at once.)
  Sites: `packages/core/src/constants.ts:159`, `parity/ledger/ui-display.yaml:97`

- [x] **3.16 The knowledge browser's thematic grouping columns.** DONE.
  **Half of this row had already been closed, and three artefacts still said
  otherwise.** `ui_knowledge.txt` is compiled, `bindMonsterCategories` parses it
  at boot, `monsterKnowledgeGroups` assigns every known race to every category
  it matches, and the shell has been drawing two panes off that for some time.
  The row, the `screens.ts` docblock it cited ("*deferred (a larger follow-up
  alongside object/artifact knowledge)*") and the `gamedata.yaml` ledger entry
  (`status: planned`, "*front-end/UI concern, not part of the core rules pack*")
  were all describing a state that had ended. All three now say what is true.

  **What was actually still wrong: monsters had a SECOND browser.** Every other
  knowledge screen goes through `runGroupedBrowser`, the faithful
  `display_knowledge` (`ui-knowledge.c:795`); monsters had a bespoke renderer in
  `main.ts`, and being the only copy that never learned what the shared one
  learned, it was missing:
  - the **`Group` label**, the `=` rule at row 5 and the `|` divider — the three
    things that make it look like the browser upstream draws (`:928-940`);
  - **`g_name_len`'s floor of 8** (`:808`), so a run of short category names slid
    the whole Name column left;
  - the header at `otherfields`' column 46 (it printed its own at 64, a column
    off from upstream's `"                 Sym  Kills  Full"`);
  - `OPT(player, purple_uniques)` on the symbol (`:1188-1194`).

  It goes through `runGroupedBrowser` now, and the two seams it needed are ones
  `display_knowledge` has always had and the port had never carried, because
  **monsters are the only caller that passes either**: `otherfields` and
  `g_funcs.summary`. `KnowledgeRow.suffix` — one annotation, for
  `display_rune`'s inscription — became `cells`, a list, which is what the
  member-display callbacks actually write.
  17 mutations, 17 killed — but **three of the first pass survived, and all
  three were the same fault: an assertion that could not fail.** The dedupe test
  gave its two-group monster ZERO kills, so double-counting him changed nothing;
  the kills test had no dead unique in it; and the purple-uniques test read the
  row under the CURSOR, which is painted in the cursor colour rather than the
  row's own, so a name wrongly turned violet was invisible there. The fixture is
  built to make each of those visible now.
  The flat `monsterKnowledgeMenu` is deleted. Its last caller was the greyed-out
  gate, which built an entire display list to ask whether it was empty; that is
  `knownMonsterEntries(...).length > 0`, which is what `count_known_monsters`
  does (`:1330`).
  Sites: `packages/web/src/knowledge.ts:1442`, `parity/ledger/gamedata.yaml:471`

- [x] **3.17 `update_sidebar`'s priority culling and from-bottom placement.** DONE.
  The row was right. `side_handlers[]` is now `SIDE_HANDLERS` — all 22 rows with
  their priorities, the four **NULL grouping rows included**, because those are
  culled and consume a row exactly like a drawn field does — and
  `sidebarLayout(termRows)` is `update_sidebar` (`ui-display.c:844-889`):
  `max_priority = y - 2`, the row counter a blank row also advances, and the
  negative-priority from-bottom arm.

  **It lives in core, not the shell.** The old split called this "a draw-half
  concern each shell applies", and what the shell applied was: walk the model
  top to bottom, hand-place the gaps from a `Set` of key names, stop when you run
  off the screen. Correct at 24 rows and **backwards below them** — it drops
  depth, speed and the monster health bar while keeping `class`, priority 22, the
  least important row upstream has. Inverting that is the entire reason the
  priorities exist ("*as the screen gets smaller, the rows start to disappear in
  the order of lowest to highest importance*", `:840-842`). Not reachable at the
  fixed 80×24 term, but 18 rows is `term.ts`'s reflow floor and reflow is a
  shipped opt-in.

  The from-bottom arm is ported although **no shipped entry has a negative
  priority**, and it is tested with a constructed table rather than hunted for in
  the shipped one. The table is exported, so a mod that supplies its own gets
  upstream's behaviour instead of a silent fall-through.
  12 mutations, 12 killed. The `SIDE_HANDLERS` transcription is checked by
  **parsing the real array out of `reference/src/ui-display.c`** rather than by a
  second transcription in the test file, so a priority typed wrong fails instead
  of two copies of one mistake agreeing. The shell's use of it is a source-text
  guard (`display-wiring.test.ts`) and says so at the top: `renderSidebar` is a
  closure in `main.ts`'s module body, and the failure it guards is not a wrong
  answer but an unused one.
  Sites: `packages/core/src/game/display.ts:627`, `parity/ledger/ui-display.yaml:128`

- [x] **3.18 The ENTER command browser does not exist, for any command list.** DONE.
  ENTER now opens `textui_action_menu_choose` (`ui-context.c:1268`) over
  `cmd_menu` (`:1157`): the `cmds_all` list names in a `window_make(19,4,58,11)`
  box, a chosen list's entries as `desc (key)` in a box two columns right and one
  row up per nesting level, ESC going back one level rather than out. It is the
  only route upstream offers to a nested command category, and a discoverable
  route to every command for a player who does not know the keys.

  **The obstacle was scope, and the scout call was right.** The port's `COMMANDS`
  table already WAS `cmds_all` flattened in upstream's order with both keysets on
  every row — but it was a `const` inside the keydown handler, rebuilt per
  keypress and reachable from nowhere. It is `buildCommandTable()` at module
  level now, behind one lazily-built instance, and **both** readers use it: the
  dispatcher and the browser. The two things it lacked are transcribed from the C
  — `cmd_info.desc` on all 62 rows, and which of the six lists each is in.

  **One copy of everything that could have become two.** `keyForKeyset` is the
  shared `key[mode]` rule; `runConfirmedCommand` is the shared
  `key_confirm_command` veto, so an inscription that refuses a key refuses the
  menu row too — which is upstream's own structure, since
  `textui_action_menu_choose` returns a `cmd_info` and its CALLER dispatches.
  The browser returns the command rather than running it, for exactly that
  reason. Two rows carry `cat: null` — `x` swap-weapon and numpad `5` — because
  they are port additions with no `cmd_info` behind them, and upstream's menu is
  `cmds_all` and nothing else.

  **The nested tier too**, which is the consequence the row itself named. The
  `cmd_hidden` placeholder "Debug mode commands (^A)" opens `cmd_debug`'s nine
  categories and each opens its own `cmd_debug_*` list — built from `wizard.ts`'s
  already-frozen `DEBUG_MENU` rather than transcribed a second time. Both routes
  into a debug command dispatch through one `runWizardDebugCommand`, so the menu
  is not a way around `player_can_debug_prereq` and the NOSCORE_DEBUG marking.
  Before this those categories were unreachable by any means.

  24 mutations, 24 killed. Six only after the tests earned it, and three of those
  are one fault: **a test that grades its own mirror.** The keyset rule was
  reimplemented in the test file, so "the browser ignores the keyset" survived;
  the fixture had no row with an absent `r` read under the ROGUELIKE keyset, so
  "absent means none, not same" survived; and the wiring guard accepted a handler
  that had stopped reading the shared table. `keyForKeyset` is one exported
  function now, called by the shell and by the tests.

  **Two defects came from printing the screens rather than reviewing the code.**
  The command box left its frame behind when it closed — the port has no
  `screen_save`/`screen_load`, so the redraw is a REQUIRED parameter rather than
  an optional one nobody would pass. And `^A` rendered as `[^A]`: a control key
  is not bracketed (`ui-event.c:317-321`), and the two forms are mutually
  exclusive upstream. A third thing the dump corrected was my own assertion
  rather than the code — the category names are COVERED by the command box, and
  only its frame at columns 19-20 stays visible, which is what the nesting indent
  is for.
  Sites: `packages/web/src/command-menu.ts:1`, `packages/web/src/main.ts:8138`,
  `packages/web/src/wizard.ts:498`

- [x] **3.19 The birth screens answer help with a no-op.** DONE.
  The row was right, and understated by one screen: the menu stages carried a
  `case "?"` commented *"Help is not wired into birth in this port: a recognized
  no-op"*, and the standard roller swallowed `?` in its `default` arm with no
  comment at all. Both now call the help browser, which has existed and been
  complete the whole time (`packages/web/src/help.ts`, `runHelp`) — **the port
  was advertising a key it ate.** `print_menu_instructions` is ported verbatim,
  so the header on every menu stage has been reading "'?' for help" since it
  landed.

  Its scope is exactly upstream's, checked rather than assumed: `do_cmd_help` is
  reachable from `menu_question` (`ui-birth.c:859-861`) and `roller_command`
  (`:925-926` → `:993-994`) and from **nowhere else** — `point_based_command`
  (`:1106`) has no help key and `textui_birth_quickstart` (`:103`) has none
  either, so a test asserts `?` does nothing on the point-buy screen. (The two
  context-menu `ACT_CTX_BIRTH_*_HELP` entries at `:443`/`:950` belong to 3.18,
  the ENTER command browser.)

  **Help does not change stage, so the stage is suspended, not resolved.** The
  `'='` treatment — resolve, let the caller re-enter — was the obvious thing to
  copy and is wrong here: re-entry rebuilds the stage from `initialCursor`, and
  on the roller it would discard the roll on screen and the `prev_roll` flag
  with it. `openBirthHelp` detaches the stage's keydown listener (it is
  registered first and calls `stopImmediatePropagation`, so leaving it attached
  would eat every key help needs), runs the modal, then re-arms listener AND tap
  and repaints. Both tests assert the screen comes back **byte-identical** and
  still answers keys.
  11 mutations, 10 killed. The survivor is a documented equivalence, noted at
  the line: nulling the tap before opening help is redundant *today* because
  `selectFromMenu` installs its own synchronously.
  One test-harness gap closed on the way: `birth.test.ts`'s fake terminal had no
  `onCellTap`, so every `term.onCellTap?.(...)` in the birth screens was an
  optional call on `undefined` and the touch handlers were never registered in a
  test at all. It has one now, and dropping either `installTap()` is a kill.
  Sites: `packages/web/src/birth.ts:1115`, `packages/web/src/birth.ts:868`

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

- [x] **3.21 The shape-lore textblock chain.**
  **The row described a state that had ended some time ago, and its citation
  pointed at a docblock making the same stale claim.** It said shapechange
  effects "have no lore chain" and that the port "greys the entry". Neither was
  true: `shapeLoreLines` has been a faithful port of `shape_lore`
  (`ui-knowledge.c:3111`) driving the browser for a long time, and the row is
  not greyed. *A deferral note is evidence about the day it was written.* The
  `main.ts` docblock it cited went further and was wrong about three greyed
  browsers, none of which is greyed for the reason it gave; rewritten.

  **What was actually missing: the tail.** Two of the chain's ten sections, and
  both are the exact trap 3.4 taught — an OPTIONAL env field whose default is
  INERT, so no supplier means the section silently is not there. Every shape
  page stopped after the misc flags. A player reading about Bear form was told
  what it does to their stats and nothing about how to enter or leave it.
  - `shape_lore_append_change_effects` (`:3043`) —
    `effect_describe(s->effect, "Changing into the shape ", 0, false)`. Bat form
    now says "Changing into the shape does 5 damage to the player."
  - `shape_lore_append_triggering_spells` (`:3059`) — every class's every book's
    every spell, hunting an `EF_SHAPECHANGE` into this shape. Bear form now says
    "The Druid spell, Bear Form, from [Creature Dominion] triggers the
    shapechange." All eight shipped shapechange spells across three classes now
    appear on the shape they reach.

  **The seams became CALLBACKS**, `changeEffectText?(shape)` /
  `triggeringSpells?(shape)`. They were bare strings, and one env serves the
  whole shape list — so no caller could have supplied them correctly for more
  than one shape, which is a fair part of why none supplied them at all. The
  supplier is `makeShapeLoreEnv` (new `packages/core/src/game/shape-inspect.ts`,
  the sibling of `object-inspect.ts`), so every shell gets the whole env rather
  than hand-assembling three easy fields and leaving the two hard ones off.

  **A separate defect the rendered page exposed, found by reading the output
  rather than the code.** Every shape's stat line read `Adds -3 to .` — an
  empty name. `shape-lore.ts` had its own copy of `lookup_obj_property` that
  omitted upstream's *"special case - stats count as mods"*
  (`obj-properties.c:207`), and the stat section looks stats up as MODs exactly
  as upstream does. `obj/power.ts` had the correct copy the whole time; only
  one of the two ever learned. There is now one implementation
  (`lookupObjPropertyIn`) and both call it. Fox reads "Adds -3 to strength",
  Pukel-man "Adds +4 to strength and +4 to constitution".

  **Verified.** 13 tests in `game/shape-inspect.test.ts`, expectations derived
  by walking `class.txt` rather than transcribing it. **12 mutations, 12
  killed** — but two only after the tests earned it, and both were the same
  fault: *a guard that cannot fire*. The shipped data has nine shapes and eight
  shapechange spells, and the only shape without one is `normal`, which the
  browser never lists — so both "no spell" negatives were passing by not
  running, and both are now built rather than hunted. A third mutation
  (dropping the `eff === SHAPECHANGE` check) survived the whole catalogue
  because no other effect carries a shape name as its subtype; that test now
  constructs a spell which CURES something called "bear". One redundant line
  was deleted rather than tested: an early-out on an empty effect list that
  `describeEffect` already handles, and which nothing could distinguish.
  Sites: `packages/core/src/game/shape-inspect.ts` (new),
  `packages/core/src/player/shape-lore.ts:70`, `:253`,
  `packages/core/src/obj/power.ts:216`, `packages/web/src/main.ts:3885`

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

- [x] **3.24 `equip_learn_flag` has no shape branch.** DONE — **and the row named
  the wrong function and the wrong direction.**
  `equip_learn_flag` (`obj-knowledge.c:2088`) has no shape branch **in 4.2.6
  either**: it walks the body slots and stops, exactly like the port. So the
  described defect — "gear merged into a shape is still learned from" — is not a
  defect and could not have been found by looking where the row pointed.

  The three functions that DO test `p->shape` are its neighbours, and **all three
  were missing their tail**: `equip_learn_on_defend` (`:1991`),
  `_on_ranged_attack` (`:2026`) and `_on_melee_attack` (`:2066`). The direction is
  the opposite of the row's: it is the SHAPE's own `to_a` / `to_h` / `to_d` that
  never taught their runes. A Druid in bear form — `+15` to-hit and `+15` to-dam
  — learned neither rune by fighting in it. `equipLearnOnDefend` even carried a
  comment noting it could read the bound shape.

  They are tails, not branches: upstream puts them after the slot loop, and the
  loop returns the moment the gear teaches, so the shape is consulted only when
  nothing worn did. `p.shape` is the bound record, so `lookup_player_shape` by
  name is a step this port does not need.
  12 mutations (shared with 3.15), 12 killed. Every case uses a **shipped** shape
  rather than a constructed one, so the numbers are the game's and each covers
  something a made-up shape would have let slide: Pukel-man is `to-h 0, to-d 5`,
  which is what makes "the two are independent" a claim that can fail; warg is
  `to-a 0`, which is what makes the `!== 0` guard one; and bat is `to-d -10`, so
  "a negative bonus is still a bonus" is not theory.
  Sites: `packages/core/src/obj/knowledge.ts:693`, `parity/ledger/obj-knowledge.yaml:98`

- [x] **3.26 Teleporting is silent.**
  DONE — and the row's own estimate was the thing to distrust. It said "three
  one-line calls." `grep -n 'MSG_TELEPORT\|MSG_TPOTHER\|MSG_TPLEVEL'
  reference/src/*.c` finds **eleven sites in three files**, and the two the row
  named as the whole job were the easy half.

  What the eleven are: two bare `sound()` calls inside `EF_TELEPORT` and
  `EF_TELEPORT_TO` (`effect-handler-general.c:2666`, `:2808`), one in
  `EF_JUMP_AND_BITE` (`effect-handler-attack.c:1746` — the jump is a teleport
  and upstream says so), four `msgt(MSG_TPLEVEL, …)` in the effect handlers
  (`:1171`, `:1178`, `:2909`, `:2915`) and four more in `process_world`
  (`game-world.c:799`, `:802`, `:824`, `:828`). The port had the text of every
  message and the sound of none.

  **What reading the C turned up that the row did not mention.** `msgt` is not
  "a message with a colour" — `message.c:428` is `message_add(buf, type)` **and
  then** `sound(type)`, and `msg()` is the silent one. That is the whole reason
  the function exists. The port has no `msgt`: **thirteen call sites spell the
  pair out by hand** as `state.msg(text, type)` followed by
  `state.sound(code)`, each also open-coding the name→code lookup. Predictably
  some sites wrote only the first half, and this family is all of them. So the
  fix is not eleven sound calls bolted on; it is `msgt` existing
  (`packages/core/src/msg.ts`) so the next site cannot half-write it.

  **A faithful `Messages.msgt` was already there and nothing called it**
  (`msg.ts:128`, sound included, only test subscribers). It cannot be the one
  the game uses — the live path is the shell's `state.msg` binding, which also
  runs the mod `messageText` hook and the renderer — so the free function
  `msgt(sinks, type, text)` is now core's spelling and the class is documented
  as the facade the architecture went around.

  One ordering divergence, written into the function: upstream is add → sound →
  display event, and the port's `state.msg` does the add and the event
  together, so the sound lands after both. The log order (what Ctrl-P shows) is
  exact; the sound event moves one slot later on the bus.

  Tests: fourteen across `effect-teleport`, `effect-general` and `effect-melee`
  asserting the code that reaches `state.sound`, including two negative cases
  where upstream returns before its `sound()` (a no-teleport grid, no room next
  to the victim) — a sound test that only ever asserts presence cannot catch an
  unconditional call. **Sixteen mutations, sixteen kills**, but only after
  three survivors earned tests: `teleportPlayer` and `teleportPlayerTo` are
  reachable only through `PROJ_NEXUS`'s random branches and nothing drove
  them, and my first `TELEPORT_LEVEL` test used the town, which can only sink —
  so the "rise up through the ceiling" arm was untested.
  Sites: `parity/ledger/game-effect-teleport.yaml:81`

- [x] **3.27 The `{tried}` and `{ignore}` name markers never appear.**
  DONE, and it is two lines — but the reason it sat this long is the reason
  worth recording. **Both ledger notes explained the absence by naming a
  missing subsystem, and both were wrong.** `obj-desc.yaml:65` said there was
  "no live tried seam on GameState"; `FlavorKnowledge.setTried` has been called
  on every device use since `obj-cmd.ts:1444`, its set is saved and restored
  with the character, and `wasTried` was sitting right next to it.
  `obj-desc.yaml:67` said there was "no ignore-name surface"; `state.isIgnored`
  is bound in `session/game.ts:618` and already drives pickup, running and
  projection. Nothing was missing except `knownDescOf`'s two reads. *An item
  that explains WHY something is absent is the one to distrust* — this is the
  same shape as the deferral notes retired at 0.1.

  What the player sees now: an unidentified wand you have already zapped reads
  `{tried}` and one you have never touched does not, and an item you told the
  game to ignore says `{ignore}` — suppressed while `K` unignoring is on,
  exactly as `ignore_item_ok` requires (`obj-ignore.c:624`).

  Tests: four in `game/describe.test.ts` driving the real `FlavorKnowledge` and
  the real `ignoreItemOk`, including the `!aware` gate (the marker must vanish
  when the kind becomes aware) and the worldless case where neither supplier is
  bound. Mutation-checked (M17, M18).
  Sites: `parity/ledger/obj-desc.yaml:65`, `:67`

- [x] **3.25 Per-category priority overrides are not reconstructable.** DONE.
  The row was right, and the fix turned out to be one line of spec plus the
  `priority_set` test it enables. `parse_entry_priority` (`ui-entry.c:2173`)
  branches on `last_category_index == -1`: a `priority` before any `category` is
  the record's default, one after a `category` overrides that category's own.
  The compiler flattened `priority` to a record scalar, so the second form could
  not survive compilation.

  **The mechanism already existed.** `DirectiveDef.childOf` attaches a directive
  to the most recent instance of another, and with no `requireParent` it falls
  back to the record — which is upstream's branch exactly. `priority` is now
  `childOf: ["category"]`, and `finish_parse`'s fill (`:2389`) honours
  `CategoryRef.prioritySet` instead of overwriting every category.

  **Measured, not assumed: this changes nothing the game shows.** Parsing both
  shipped files, `ui_entry.txt` and `ui_entry_base.txt` contain **zero**
  `priority`-after-`category` lines, and a test re-derives that from the files so
  the claim cannot go stale. It is a pack-extensibility fix, which is why it was
  correctly last by player-visibility. The older compiled shape — a bare category
  string — still reads, so a mod's pack built before this is not a crash.

  One unrelated wart fixed in passing: `negative_index` on index 0 returned
  JavaScript's `-0`, a value `get_priority_from_negative_index` cannot produce.
  8 mutations, 8 killed — the last only after the test earned it. "The scheme
  name is never resolved" survived because `parseInt("negative_index")` is NaN
  and falls back to a default that, on a record with no default, is also 0. The
  record has a non-zero default now.
  Sites: `packages/content/src/specs/ui-entry.ts:52`, `parity/ledger/ui-entry.yaml:140`

## Tier 4 — Whole modes nobody has begun

- [x] **4.1 Arena mode.** DONE — and every item the row named was already
  built. `mon_take_hit`'s arena branch is `arenaInterceptDeath` wired at five
  kill sites, `arena_gen` is the 6x6 build in `session/game.ts`, and the
  monster-ranged exclusion is `mon-ranged.ts:83`. So this closes on a **census
  of all 29 `arena_level` sites in 4.2.6**, one at a time, rather than on the
  row's list.

  **Three of the 29 were absent, and two of them mattered:**

  > **`EF_TELEPORT` had no arena guard** (effect-handler-general.c:2529-2530).
  > Phase Door and Teleportation worked inside single combat, which is the one
  > place upstream forbids them — the whole point of the arena is that you
  > cannot leave. Placement is not where a reader would guess: upstream's
  > distance `damroll` is a C **local initialiser**, evaluated before the
  > function body, so the roll is spent even when the refusal is about to
  > return. The port matches. That ordering is **recorded, not tested** — the
  > port's `effectSimple` does its own dice work around the handler and no
  > fixture here can tell the two placements apart (28 vs 30 draws, measured).
  >
  > **`EF_ALTER_REALITY` had no arena guard either**, under a comment saying
  > "arenas are not modelled". They were modelled when that was written.
  > Regenerating the level from inside single combat would have thrown away the
  > arena and the opponent. Upstream returns **before** setting `ident`, so an
  > arena use does not even identify the scroll; the port had `ident` first.
  >
  > **A save taken mid-fight lost the level behind it.** The pre-arena level
  > was a closure variable in `makeChangeLevel`, so winning after a reload
  > dumped the player onto a *fresh* level of the same depth. Upstream has no
  > separate mechanism for this: `prepare_next_level` takes the
  > persistent-level path for an arena too (`persist = OPT(...) ||
  > arena_level`, generate.c:1349), the pre-arena level goes into the
  > chunk_list, and the savefile carries it. It is now `state.arenaStash`,
  > serialized through the very same `serializeStoredLevel` the frozen-level
  > cache uses. A save without the key reloads with the old behaviour.

  The other 26 all matched, including the ones the row did not mention:
  `DESTRUCTION` and `EARTHQUAKE`'s town-or-arena no-ops, `RECALL`, `SUMMON`,
  the two monster effects, `TELEPORT_TO`, `TELEPORT_LEVEL`, the suspended
  Word of Recall, no trap doors, no monster summons, no breeding, the
  unique-or-arena damage clamp in both `mon_take_hit` and `project_mon`, no
  polymorph, and `on_new_level`'s two arena early-outs.

  One test of mine had to be thrown away first: it passed a `dice` option that
  `EffectSimpleParams` does not have, so it ran with no dice at all and still
  went green. `tsc` caught it; `vitest` alone never would have.
  Sites: `packages/core/src/game/effect-teleport.ts`,
  `packages/core/src/game/context.ts`,
  `packages/core/src/session/save.ts`, `packages/core/src/session/game.ts`,
  `parity/ledger/game-arena.yaml`, `parity/ledger/game-mon-ranged.yaml:31`

- [x] **4.2 The quest system.** DONE — and, for the third row running, what the
  row named was already built and what was broken was somewhere else.

  `player-quest.c` is ported whole: `bindQuests`, `playerQuestsReset`,
  `isQuest`, `buildQuestStairs` (with `square_changeable` reimplemented so the
  stagger loop matches), and `questCheck` including `total_winner` and the
  victory messages. So do the pieces around it — `dun.quest` reaches every
  builder, `questSpawns` places the guardians with the unique-already-alive
  skip, `dungeonGetNextLevel`'s quest scan is what keeps a player on 99 while
  Sauron lives, the crown screen is drawn, and the score gates on the winner
  flag. This closes on **a census of every `quest` / `is_quest` /
  `recall_depth` / `total_winner` site in 4.2.6** instead.

  **Five were absent. Four of them are player-visible, and three are one
  finding pulling the next out.**

  > **`TrapEnv.isQuest` was never supplied.** trap.c:310-311 forbids trap doors
  > on a quest level — the guardian's floor must not open under the player. The
  > *generation* path passed it (`gen/util.ts`, from `dun.quest`); the
  > **runtime** path — every trap created after generation — passed nothing, and
  > the optional seam defaulted to `false`. This is the seam-supplied-to-every-
  > path-but-one shape, and it is not cosmetic: dropping a kind also drops its
  > slice from `pick_trap`'s cumulative total, so the omission moved the whole
  > draw, not just the trapdoor.
  >
  > **`player_set_recall_depth` (player-util.c:79) was not ported at all.** The
  > countdown in `process_world` substituted `recallDepth = maxDepth`. That
  > threw away every other producer's answer — including the level a
  > persistent-levels player had *just been prompted for*, which the port asked
  > for and then ignored — skipped the force_descend step-down entirely, and
  > sent a character who had never descended to **depth 0**, regenerating the
  > town under them, where upstream's `MAX(recall_depth, 1)` sends them to 1.
  >
  > **And that fix could not stand alone.** `on_new_level` sets
  > `max_depth = recall_depth = depth` (game-world.c:1024) — *both*. The port
  > set only `max_depth`, at two sites. Nobody noticed because the substitution
  > above was papering over it: recall worked by accident, and removing the
  > paper is what exposed the missing producer. Both sites now assign the pair.
  >
  > **`EF_RECALL` had no `birth_no_recall` guard** (L1098-1102). Option #34,
  > "Word of Recall has no effect", was in the option table, offered at birth,
  > and read by nothing — the scroll worked exactly as normal for a player who
  > had chosen to give it up. The `!total_winner` exemption is there too: a
  > winner gets the scroll back, which is how they return to town to retire.
  >
  > **`rd_quests` (load.c:623-645) restored the wrong half.** Upstream calls
  > `player_quests_reset` FIRST and then overlays only `level` and `cur_num`;
  > name, race and max_num always come from the game's current quest table. The
  > port restored the whole array out of the savefile, so a stored race index
  > survived a shift in the monster table, and — as its own comment admitted —
  > a save written before the quest system **reloaded with no quests and no win
  > condition**. That is a documented limitation that had become a defect. The
  > over-count rejection is upstream's too.

  Everything else in the census matched, including the parts no row mentions:
  `square_add_stairs`, `place_stairs`'s "all stairs on an unfinished quest level
  go up", the four `size_percent = 100` overrides, `handle_level_stairs`,
  the room-template `>` case, `EF_TELEPORT_LEVEL`'s three quest branches, the
  `do_cmd_go_down` force_descend warning, the retire confirmation's winner
  branch, and `display_winner`.

  **12 mutations, 12 killed.** Two needed the test rewritten before they would
  die, and the reason is recorded in the code rather than hidden: both
  conjuncts of the force_descend guard are shadowed in play by
  `dungeonGetNextLevel`'s own clamp and quest scan, because `recall_depth`
  always equals `max_depth` under that option. They are kept because they are
  upstream's, and covered by a contract test that constructs the state play
  cannot.
  Sites: `packages/core/src/game/quest.ts`,
  `packages/core/src/game/effect-general.ts`,
  `packages/core/src/game/loop.ts`, `packages/core/src/session/game.ts`,
  `packages/core/src/session/save.ts`, `packages/core/src/gen/generate.ts:11`

- [x] **4.3 Persistent levels, and the town builder's full store generation.**
  DONE — but **both halves of the row's premise were already false, and what
  was actually broken was none of what it named.**

  The row said `Connector` carries grid + feat "rather than a copy of `SQUARE`
  info". It carries the info: `collectJoins` copies `c.info(grid).bits` into
  every connector. It also would not have mattered — **4.2.6 never reads those
  bytes.** `get_join_info` and `transform_join_list` both `mem_zalloc` fresh
  connectors and set only grid and feat; `build_staircase` reads only the grid.
  The bytes are written to the savefile (save.c L850-866), read back
  (load.c L1366-1379), and freed. They are carried here anyway, because that is
  what the original stores — but the comment now says so, instead of leaving the
  next reader to re-derive it.

  "The town builder's full store generation" was stale too: `town_gen_layout`
  is ported whole — lava streamers, the town-sized starburst, the north-wall
  stair search, the lot grid, all **eight** stores via `build_store`
  (`TOWN_STORE_FEATS`, Home included), `lot_is_clear` / `lot_has_shop`,
  `build_ruin` at 80% a lot, the cleared street and the day/night residents.

  **What was actually wrong — four things, three of them crashes:**

  > **`get_min_level_size` had no producer.** `ctx.minHeight` / `ctx.minWidth`
  > were threaded into every builder and **nothing computed them**, so a
  > persistent level was always built at its own random size. `build_staircase_rooms`
  > must place a room at every seeded connector and `quit()`s when one is off
  > the map (gen-cave.c L925-934) — so this is an abort, not a wrong layout.
  > **Measured before the fix: 5 of the first 40 seeds died on an ordinary walk
  > down**, no doctored fixture involved. Seed 8 is the one the test uses.
  >
  > **`lair_gen` ignored `dun.persist` entirely.** It split down the middle
  > wherever that fell, and handed each half the LEVEL-WIDE connector list —
  > so the half was asked to build a staircase room at a column outside itself.
  > `find_joinfree_vertical_seam` (splits on a pair of columns carrying no
  > stair) and `transform_join_list` (translate + clip into each half, order
  > preserved, info deliberately not carried) are now ported, and `lair_gen`
  > caches / swaps / restores `dun.join` around each half exactly as upstream.
  >
  > **`build_colors` / `clear_small_regions` had dropped their `stairs[]` map.**
  > Same shape as 5.5's missing table columns: the port left it out because
  > nothing read it, and nothing read it *because persistent levels were
  > dormant*. It is indexed by COLOUR, not grid — one staircase anywhere in a
  > region spares the whole region — and without it a persistent cavern half
  > that opened its connector stair into a pocket of fewer than nine grids had
  > that stair quietly walled back up. Not a crash: a level whose down
  > staircase does not exist.
  >
  > **`EF_CREATE_STAIRS` did not refuse under `birth_levels_persist`**, and
  > checked its two conditions in the wrong order. A staircase conjured after
  > generation is in no join list, so the neighbour it appears to lead to gets
  > built with no matching stair. The order matters on its own: upstream tests
  > the floor FIRST (L1979) and refuses second (L1985), so a blocked grid **in
  > an arena** — the one refusal the port did implement — named the wrong
  > reason.

  Everything else the row implied was missing is live and was already driven
  from `session/changeLevel`: the frozen-level cache and its save round-trip,
  `restore_monsters` over the elapsed turns, `compact_monsters`, the staircase
  rooms, `handle_level_stairs`' persistent minsep of 4 and its
  `chunk_find_adjacent` skip, `player_get_recall_depth`, the trap-door
  suppression, and `cave_illuminate` on a persistent town.

  **A fifth gap fell out of measuring the fourth.** Chasing why the
  `get_min_level_size` mutation "measure only the level above" would not die
  turned up the answer: the level above was contributing *nothing, on every
  seed*, because **`bootLevel` threw `g.joins` away**. `cave_generate`
  populates `chunk->join` for every level it builds, the first one included —
  so under persist the level a character starts on froze with an empty
  connector list and the first neighbour generated had nothing to align to. A
  surviving mutant is a question about the test; this one turned out to be a
  question about the code.

  Tests: 17 pure-function cases in `gen/join.test.ts` (`getMinLevelSize`,
  `findJoinfreeVerticalSeam`, `transformJoinList`), three
  `lair_gen`-under-persist cases in `gen/gen.test.ts`, four
  `EF_CREATE_STAIRS` cases, and four in `session/persist-levels.test.ts` that
  walk a real game 3→5→6→4 and **derive** the expected minimum from the frozen
  neighbours rather than declaring it. 16 mutations, **15 killed**. The
  survivor is recorded in the code as unkillable by construction rather than
  papered over: `find_joinfree_vertical_seam`'s `i += 2` skip is provably the
  same walk as `i++`, because the grid it skips fails the very next test.
  Sites: `packages/core/src/gen/generate.ts`, `packages/core/src/gen/cave.ts`,
  `packages/core/src/game/effect-terrain.ts`,
  `packages/core/src/session/boot.ts`,
  `packages/core/src/session/game.ts:2456`,
  `parity/ledger/gen-cave.yaml`, `parity/ledger/gen-framework.yaml`

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

- [x] **5.9 A store's stock does not age.** CLOSED as a RETRACTION — **it is
  built end to end, and nothing had ever run it.** The row said "there is no
  `daycount` in `packages/core` or `packages/web`". There are eight references:
  the accumulator (`game/loop.ts:397`), the field
  (`game/context.ts:434`), the consumer (`session/game.ts:2713-2714`), and the
  save round-trip (`session/save.ts:947`, `:1482`). `storeUpdate` had been
  written, with its per-day maintenance loop and its `one_in_(store_shuffle)`
  shopkeeper shuffle, and **not one test called it.**

  So this closes with the tests that would have answered the question by
  running the code — the state a row like this leaves behind is not "absent",
  it is "unmeasured", and those look identical from a grep:

  - `game/loop.test.ts` — a day accrues once per `10 * store_turns` below town
    and **never in town**, because `game-world.c:545-573` is an if/else and
    deferring the update is the whole point (the knowledge menu must not leak
    tomorrow's stock).
  - `store/store.test.ts` — zero days changes nothing **and draws no RNG**;
    several days turn the stock over and leave the home alone; and six days
    differ from one. That last is the control: one day already changes the
    snapshot, so "it changed" would pass a `store_update` that ignored the
    count entirely.
  - `session/store-aging-wiring.test.ts` — a real game, down and back up. A
    zero-day return leaves the shops identical; a four-day return moves them
    and zeroes `daycount`.

  5 mutations, 5 killed. **A sixth was dropped rather than faked**: removing
  `store_update`'s `feat === HOME` skip changes nothing, because `store_maint`
  opens with the same guard — and so does upstream (`store.c:1430` and
  `:1296-1298`). An unkillable mutation whose target is a faithful
  belt-and-braces disjunct is a fact to record, not a test to contrive.
  Sites: `packages/core/src/game/loop.ts:397`,
  `packages/core/src/session/game.ts:2713`,
  `parity/ledger/store-maint.yaml:54`

- [x] **5.3 `options_save_custom` / `restore_custom` / `restore_maintainer`.**
  DONE — and the row understated it: this is not one deferred file pair but
  **two persistences**, and the port only had one of them.

  `packages/core/src/player/options-file.ts` is option.c L207-328 whole: the
  writer's exact bytes (the three header lines, then description-comment +
  `option:name:yes|no` per option), the reader, `options_restore_maintainer`,
  and `options_init_defaults` in its order — table defaults, customised BIRTH,
  customised INTERFACE, *then* `delay_factor = 40` and `hitpoint_warn = 3`.

  **The read side is the feature, and it needed wiring in two places.**
  `startGame` now runs `optionsInitDefaults(host())` where upstream's
  `player_init` calls it (player.c:491), and birth.ts seeds its birth-choice map
  from `customPageDefaults("BIRTH")` before the first stage. Without the second,
  the '=' editor opens on the table every time and its own 's' key writes a file
  nothing reads — the savefile cannot carry this, because at birth there is no
  savefile. `session/options-custom-wiring.test.ts` boots a real game against a
  memory host and reads the live `OptionState`, including the FROZEN birth
  snapshot; `birth.test.ts` drives the '=' screen and asserts the row shows the
  file's value, not the table's.

  **Three live divergences surfaced on the way, all now fixed:**

  > **`get_parser_error_limit()` is 20, not 0.** `visuals/prefs.ts` carried
  > `opts.errorLimit ?? 0` under a comment reading "Upstream's default is 0
  > (ui-init.c / z-util), so every error is reported". The value is
  > `PARSE_ERROR_LIMIT` (parser.c:38) and it is in neither of those files. This
  > is **behavioural, not cosmetic**: ui-prefs.c:1222's loop `break`s on
  > reaching the limit, so upstream stops applying a pref file after its
  > twentieth bad line and the port applied every line to the end.
  >
  > **The CHEAT page offered `x`.** `optionToggleScreen` ran the
  > reset-to-defaults key for every non-read-only page. Upstream gives `cmd_keys`
  > containing `"SsRrXx"` to exactly two pages — OP_INTERFACE and
  > OPT_PAGE_BIRTH+10 (ui-options.c L333-348) — and the cheat page gets the
  > default `"YyNnTt"`. The keys are now gated on the page declaring
  > `OptionCustomDefaults`, which also gave s and r somewhere to live.
  >
  > **All three page prompts were one string.** The screen printed `"Set option
  > (y/n/t), 'x' to reset to defaults"` everywhere, which named a key it had and
  > omitted two it did not. Upstream has three (L331, L337, L342) and now so
  > does this.

  `packages/core/src/parser.ts` is new and is where the shared half of parser.c
  now lives: `parserErrorText`, the limit, `containsOnlySpaces`, the blank/comment
  skip, and a real `Strtok`. The tokeniser is reproduced rather than approximated
  because a `split(":")` reader gets three things wrong **in the direction that
  accepts malformed input** — `option:show_damage::yes` is
  PARSE_ERROR_INVALID_VALUE upstream and would have silently set the option here.
  `PrefError` is now an alias of the one `ParserState`.

  26 mutations across the two halves, 26 killed, plus **one recorded as
  unkillable by construction rather than faked**: `if (ok) writeBack(opts)` in
  customDefaultsFor, because a failed restore returns before touching `opts`, so
  writing the snapshot back is provably a no-op. The `errmsg`-threading in
  parseOptionLine is upstream's scruffiness reproduced deliberately — a handler
  error inherits whatever the last FIELD error left in `p->errmsg`, which is why
  the first bad line in a file reports an empty token.
  Sites: `packages/core/src/player/options-file.ts`,
  `packages/core/src/parser.ts`,
  `packages/core/src/session/game.ts:2776`,
  `packages/web/src/options.ts`, `packages/web/src/birth.ts`,
  `parity/ledger/options.yaml:76`

- [x] **5.4 `RANDNAME_TOLKIEN` is not loaded.** CLOSED as a RETRACTION — it is
  loaded, and it has been since before this row was written. `randnameMake` and
  `build_prob` are ported in `obj/randname.ts` and checked against an
  independent oracle (`obj/randname.upstream.test.ts`); the corpus ships as
  `names.json` section 1; `bootLevel` reads it into
  `CoreRegistries.nameSections` (`session/boot.ts:163-165`, reversing each
  section because `init.c:1476` PREPENDS); and `session/game.ts:3458-3461`
  hands `doRandart` the section-1 word list. `randart.ts`'s own module header
  says all of this. The row's evidence was a ledger line, not the code.

  One assertion was genuinely missing and is added, because it is the only one
  that could have caught the row being right: **`doRandart` takes the corpus as
  an ARGUMENT**, so every unit test above still passes if the live boot hands it
  an empty list and `artifactGenName` falls back to its own syllables — the
  classic "supplied is not read". `session/describe-wiring.test.ts` now boots a
  real game and asserts section 1 arrives with >100 entries that are all real
  words, and that generating with it produces a different name set than
  generating without.
  Sites: `packages/core/src/session/boot.ts:163`,
  `packages/core/src/session/game.ts:3458`,
  `parity/ledger/obj-randart.yaml:51`

- [ ] **5.5 `randart.log` / `randart.txt`. IN PROGRESS — the file exists and
  108 of its 233 emission sites are written. The remainder is MEASURED, not
  estimated.**
  Put to the maintainer on 2026-08-04 as port-it-or-omit-it; the answer was
  **pursue parity**, so it is a port with no asterisk.

  **The row's own count was low.** "193 `file_putf` sites" is the raw grep of
  obj-randart.c, and 19 of those go to `fff` — that is `write_randart_entry`,
  a different file. The real accounting, taken 2026-08-06:

  | | sites | done |
  |---|---|---|
  | `obj-power.c` `log_obj` — how a randart's POWER is worked out | 59 | **59** |
  | `obj-randart.c` `file_putf(log_file, …)` — the design loop | 174 | 52 |
  | `obj-randart.c` `file_putf(fff, …)` — `randart.txt` | 19 | 0 |

  DONE so far, and each part is load-bearing on its own:

  - **`obj/randart-log.ts`**, the sink. One module-level static, because that is
    exactly upstream's shape — `object_log` in obj-power.c and `log_file` in
    obj-randart.c are both statics, NULL for the whole game except inside
    do_randart, and `log_obj` opens with `if (!object_log) return;`. Threading a
    parameter through 233 sites would model as an argument something that is
    global in the original.
  - **The file lifecycle in `doRandart`.** Opened by truncating (which is what
    `MODE_WRITE` does), closed in a `finally` so a throw mid-generation cannot
    leave the static installed and narrate the next run into this one's buffer.
    Upstream's `exit(1)` on a failed open is **the one deliberate divergence**:
    a browser tab has no process to kill and a desktop player did not ask to
    lose a character over a log file, so the message goes to `onLogError` and
    generation continues. Both of upstream's messages are now emitted, which is
    why the text census's KNOWN_ABSENT entry for them is deleted.
  - **All 59 obj-power.c sites**, including `slay_power`'s `verbose` block. An
    open log IS upstream's `verbose` flag here: it is threaded from
    object_power's caller purely to gate four lines, every randart evaluation
    passes it, and nothing else calls slayPower with a log open.
  - **`count_weapon_abilities`, `count_bow_abilities`,
    `count_nonweapon_abilities`** (48 sites), with two upstream asymmetries
    reproduced and commented: both to-dam arms use a plain `else`, so a bonus of
    exactly 0 logs `"Subtracting 0"`, while the to-hit arms above them do test
    `< 0`.
  - **The `desc` / `name` columns of `flag_sets`, `element_sets` and
    `el_powers`**, restored to the port's tables. They had been dropped as
    unused — true only because the log they exist for had been dropped, which is
    the same shape as 7.4.

  **One upstream wart NOT reproduced, on purpose.** obj-power.c:994 passes an
  `int` to `"%p"`. That is undefined behaviour with no portable output, so there
  is nothing to be byte-identical to; the port prints the number the line plainly
  means. Recorded rather than normalised silently, because this repo's default
  is to keep C warts.

  **How the remainder is kept visible.** There is no compiled Angband here and no
  toolchain to build one, so a byte-for-byte diff of a real randart.log is not
  available and no such claim is made. `obj/randart-log.census.test.ts` extracts
  every format string from both C files, reduces each to its literal spans, and
  requires each span to appear in the port. obj-power.c must be at **zero**
  missing; obj-randart.c is a **two-way ratchet** at 122 distinct strings, so the
  number cannot drift up (a lost line) or down (finish the row and lower it).
  `obj/randart-log.test.ts` runs `doRandart` against a memory host and reads the
  file, which is the guard a fresh sink most needs.

  STILL TO WRITE: `count_modifiers`, `count_low_resists`, `count_high_resists`,
  `count_abilities`, `collect_artifact_data`, `parse_frequencies`,
  `store_base_power`, `artifact_power`, `get_base_item`, `artifact_prep`,
  `build_freq_table`, `try_supercharge`, the `add_*` family, `choose_ability`,
  `make_bad`, `design_artifact` — then the whole of `randart.txt`
  (`write_randart_entry` + `write_flags` / `write_mods` / `write_elements`, and
  `do_randart`'s `create_file` argument). The post-generation measurement pass
  (L3184-3187) comes back with `parse_frequencies`; it draws no RNG and exists
  only to print the closing statistics.
  Sites: `packages/core/src/obj/randart-log.ts`,
  `packages/core/src/obj/randart.ts`, `packages/core/src/obj/power.ts`,
  `packages/core/src/obj/randart-data.ts`

- [x] **5.6 The spoiler files' missing lines.** DONE — one half retracted on
  measurement, the other two built.
  The generators and their menu were already done (`runSpoilers`,
  `game/spoil.ts`). The row named three content gaps: `timedDesc` /
  `summonDesc`, the missing `loreDescription` spoiler flag, and the hit-chance
  lines at `:518` / `:519`. One was not a gap; the other two were, and the
  second turned out to shrink the third.

  > **The `timedDesc` / `summonDesc` half is RETRACTED, on three measurements
  > taken 2026-08-06.** The spoiler boot already holds `game.players.timed` and
  > `reg.monsters.summons`, so filling the two seams is three lines. I wrote
  > them and diffed `spoilObjDesc + spoilArtifact` whole against the shipped
  > pack: **zero bytes of difference.** Replaced them with sentinel strings and
  > counted: **zero occurrences** in either dump, so the callbacks are never
  > invoked and it is not a formatting coincidence. And the reason:
  > `spoilObjDesc` prints no effect text at all — upstream's basic-item table
  > is a stat grid — while of `spoilArtifact`'s **67 "When used" lines not one**
  > resolves to `EFINFO_TIMED` / `EFINFO_CURE` / `EFINFO_SUMM`. The 30
  > `TIMED_INC` and 25 `CURE` entries in `activation.json` belong to items
  > these two dumps do not describe.
  >
  > The chain below the seams is sound and the in-game inspect path exercises
  > it (`web/src/main.ts:1043`, `:2029`). Supplying them here would be correct
  > and **inert**, so the code carries the measurement instead of the change.
  >
  > **The `loreDescription` spoiler flag is DONE, and it was bigger than the
  > row said.** `spoilers` (`ui-mon-lore.c:90`) gates **four** sections, not
  > one: the title (L108-112), the kill counts (L114-116), the toughness block
  > (L124-125) and the experience reward (L128-129). The port had none of them
  > — `spoil.ts` passed no flag and sliced the first line off the result, which
  > removed the title and left three sections upstream never prints. Every one
  > is a statement about a player, and the dump has no player: *"You have
  > killed at least 7 of these creatures"*, *"You have a 0% chance to hit such
  > a creature in melee"*, *"worth 0 points for a 10th level character"*.
  >
  > `cheat_monster_lore` stays with the CALLER rather than moving inside the
  > flag as upstream has it (L101-102): `spoil.ts` already reveals the lore
  > copy it owns, and doing it twice is the same work for the same answer.
  >
  > 7 mutations, 7 killed — across two files on purpose. The
  > `mon/lore-describe.test.ts` cases prove the four gates, and would stay
  > green if `spoil.ts` stopped passing `true`; the new `game/spoil.test.ts` is
  > what kills that one. Both sets include the reverse control (flavour and
  > movement must survive), so a flag that suppressed too much fails too.
  >
  > **`:518` / `:519` are done too, and the spoiler flag had already halved
  > them.** `meleeHitPercent` fed `lore_append_toughness`' "you have a N%
  > chance to hit such a creature" — the section `spoilers` now suppresses — so
  > supplying it would be inert and it is deliberately still absent.
  > `monsterHitPercent` was the real one: `lore_append_attack` prints a
  > per-blow `(NdM, X%)` in BOTH views (`mon-lore.c:1710-1715`), so every blow
  > in the dump read **0%**, and the running centidamage total that multiplies
  > by it read zero with it. The headless boot has a player, so it is
  > `hit_chance(MAX(level,1) * 3 + power, ac + to_a)` against
  > `actor.defense` — upstream's REAL state, not the known one.
  >
  > 3 mutations, 3 killed, and the first version killed only one: "some
  > percentage is non-zero" passed against a formula that dropped the blow's
  > power AND against one measuring against no armour at all. The test now
  > boots the same headless game the spoiler boots, recomputes the expected
  > percentage per blow, and compares 25 whole monster blocks — with a guard
  > that fails if fewer than 25 were actually compared. `:518` and `:519` are the hit-chance lines, and
  they no longer wait on anything — the callbacks are wired for the *game* path
  (`packages/web/src/main.ts:3650`); a core-level dump has no player, so this
  needs a state-carrying spoiler variant rather than a seam.
  Sites: `packages/core/src/game/spoil.ts:93`, `:518`, `:519`, `:550`

- [x] **5.7 The randart generator's `property` branch.** CLOSED as a
  RETRACTION — **the sixth this session, and it was wired the whole way down.**

  The row read "needs the timed-effects failure tables". Every link exists:
  `player/bind.ts:733` binds each record's `fail` array; `buildCurseTimedFoil`
  turns it into the lookup; `curseTimedIncFoiled` (`obj/object.ts:703`) walks
  it for `TMD_FAIL_FLAG_OBJECT` / `_RESIST` / `_VULN` and skips
  `_PLAYER` / `_TIMED_EFFECT` exactly as `obj-curse.c:267-296` does;
  `artifactCurseConflicts` consults it; `doRandart` takes it; and **both**
  `swapRandartSet` call sites — birth (`session/game.ts:2882`) and load
  (`:3603`) — supply `buildCurseTimedFoil(players.timed)` next to the
  activation summarizer.

  What was missing is the assertion that would have caught the row being right,
  and it is the same one 5.4 was missing: the foil is an **optional argument**,
  and the unit tests in `obj/randart.test.ts` build a hand-written two-entry
  map. Nothing said the SHIPPED `player_timed` table yields a usable one, and
  nothing said the generator ever receives it.
  `session/describe-wiring.test.ts` now asserts both, the second by generating
  the same seed twice and differing only in the foil.

  > **The seed is measured, not assumed.** The first two seeds I tried produced
  > identical sets with and without the foil — most randart sets contain no
  > artifact whose own properties foil the curse it drew. Sweeping 1..60 found
  > 9 that do (1, 4, 15, 31, 36, 41, 47, 52, 58); the test uses seed 1. A test
  > pinned to either of the first two guesses would have asserted nothing while
  > looking exactly like this one.
  Sites: `packages/core/src/obj/object.ts:703`,
  `packages/core/src/session/game.ts:2882`,
  `packages/core/src/obj/randart-build.ts:38`

- [x] **5.8 `object_flag_is_known` on the store's buy list.** DONE, **as part of
  2.10 — it was never a second defect.** This row was split off "rather than
  closed with the rest of `store-maint.yaml:34`" on the theory that the
  maintenance path reached the gate separately. It does not: both rows name
  `packages/core/src/store/store.ts:262`, one line, one `if`. Fixing 2.10 fixed
  this by construction, and the split cost a row on the list for a year.
  **Two rows citing the same `file:line` are one row.** That prompted a sweep of
  every `Sites:` line in this file for citations shared by more than one item, and
  it came back with three: this pair, `game/context.ts:297` (1.1 and 2.5, closed
  together on purpose), and `gen/generate.ts:11`, shared by **4.1** and **4.2**
  because arena and quests sit under one `DEFERRED` comment — genuinely two
  features, not one row twice. So no further row dies this way, and the sweep is
  recorded here so nobody has to wonder whether it was run.
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

## Tier 7 — Decisions to take, not code to write. CLOSED

**The tier's own premise did not survive being read.** It held four rows on the
grounds that each needed a judgement call rather than work. Measuring them
found: one live defect on every level (**7.4** — no monster emitted light or
darkness), one live information leak (**7.1** — the targeting preview drew
terrain from the real map instead of the player's memory), one flat retraction
(**7.3** — level rating was ported before the row was written), and one genuine
bookkeeping task (**7.2**) whose split immediately turned up eight missing lore
learns and a message two call sites had dropped.

A one-line row invites the reader to trust its summary. **7.4 had no
description at all**, and it was the worst of the four.

- [x] **7.1 `project-path`: wire it or cordon it. DONE — the choice was
  false, because the UI branch exists.**
  The row said "a ported function whose only caller would be a UI branch that
  does not exist", so the decision offered was wire-or-cordon. Both halves were
  wrong. `squareIsBelievedWall` (`game/known.ts:342`, cave-square.c L901-912) is
  ported AND already wired — the effect path supplies it as `project()`'s
  `believedWall` hook (`game/project-cast.ts:361`). And the UI branch exists:
  `game/target-loop.ts` is the ported look/target loop.

  Which turned a bookkeeping question into a live one. `draw_path` colours the
  projected path from `square_isprojectable(player->cave, ...)` — the player's
  REMEMBERED map (ui-target.c:1149-1150) — and the port was reading the live
  chunk. For a known grid those agree until the terrain changes behind the
  player's back, and then the preview shows what is really there: a wall
  tunnelled out of sight still paints blue upstream, and a wall that appeared
  while the player was elsewhere paints white. An information leak, small but
  not cosmetic. Both copies of the predicate were fixed — the plain-terrain
  branch and the camouflaged-monster branch that masquerades as terrain — and
  fixing one and not the other is how a divergence survives its own fix.

  **The object half stays approximate and its reason has not expired**:
  `square_object(player->cave, ...)` needs a per-object remembered twin, which
  the port does not have.

  3 mutations, **2 killed**. The third is the `squareIsKnown(...) &&` conjunct,
  and it is **unkillable by construction**: `squareIsBelievedWall` already
  answers false for an unknown grid, so the two disagree only out-of-bounds,
  which a projected path never contains. Kept because upstream keeps it, and
  recorded in the test rather than killed by a fixture the caller never builds.
  Sites: `parity/ledger/project-path.yaml:58`

- [x] **7.2 Split the monster-turn partial into rows that can be closed. DONE
  — splitting it closed it.**
  The row asked for a bookkeeping split: the note "covers item pickup, group
  behaviour and lore at once and names them only collectively, which is why it
  is still `partial` when most of it is live". That diagnosis was exactly right,
  and doing the split is what surfaced what the collective phrasing was hiding.

  Taking the module's own NOTES clause by clause — *"react_to_slay pickup
  safety, the confused-move / door-burst / glyph-break / decoy-destroy UI
  messages and disturb, and the remaining monster-lore updates"*:

  - **`react_to_slay`** — ported, gating the pickup at `monsterTurnGrabObjects`.
  - **confused stumble, "You hear a door burst open!", "The rune of protection
    is broken!"** — all printed. The glyph one is the sharpest case: its own
    docblock called the message deferred UI *four lines above the code that
    prints it*.
  - **disturb** — runs at the tail, gated on `disturb_near`.
  - **decoy-destroy** — the one real message gap, and its cause was structural
    rather than missing work. `destroyDecoy` (`game/effect-mon-origin.ts`) has
    printed "The decoy is destroyed!" for **five** callers all along, gated on
    los-and-not-blind exactly as cave-square.c:1409. **Two sites went around
    it** and open-coded the body minus the message — `handleDRAIN_MANA`, and
    the monster branch in `monsterTurn`, which is *the commonest way a decoy
    actually dies*. Both now call the shared function.
  - **the lore** — the real gap, and it was real. `mon-move.c` carries **22**
    `rf_on(lore->flags, ...)`; the port carried **14**. The missing eight were
    RAND_25, RAND_50, KILL_BODY, MOVE_BODY, NEVER_MOVE (twice — once from a
    monster that holds its ground and once, the same flag, from one seen to
    move) and NEVER_BLOW's player branch, which the decoy branch beside it
    already had. Each is a line of monster recall that never filled in however
    long you watched. **Now 22 to 22**, counted per flag.

  **3 + 7 = 10 mutations, 10 killed.** Two fixtures failed against correct code
  first and both are recorded in the tests: the pushing monster needed an
  `mexp` gap before `monster_turn_try_push` would run at all, and the moving
  monster needed its DESTINATION marked seen, because `monsterSwap` calls
  `updateMon` and a monster that walks out of view is legitimately no longer
  visible by the time the tail of `monster_turn` runs.
  Sites: `packages/core/src/game/monster-turn.ts:1380`

- [x] **7.3 Decide the level-rating question. RETRACTED — there is no
  question. Level rating is ported end to end, and was before the row was
  written.**
  The claim was that "upstream's level *rating* has no port equivalent at all",
  offering a choice between porting it and recording it `n-a`. Neither applies:

  - `add_to_monster_rating` (mon-make.c L1112-1126) is wired in
    `game/mon-place.ts` for generation **and** for live summons and breeders,
    matching upstream's single `place_new_monster_one`;
  - `place_object` accumulates `obj_rating` in `gen/util.ts`;
  - and `gen/generate.ts:518` is upstream's own line —
    `chunk->feeling = calc_obj_feeling(chunk, p) + calc_mon_feeling(chunk)`
    (generate.c:1241) — with both halves ported at `:320` and `:343`.

  It is also *tested*, which is why this is a retraction rather than a
  discovery: `gen.test.ts` has the level-feeling lifecycle and asserts
  `mon_rating` accumulates exactly `level^2` plus the OOD bonus,
  `mon-place.test.ts` asserts the same for the live path, and
  `session/feeling-announce.test.ts` proves every arrival site announces it.
  19 of them run under a `-t feeling` filter and pass.

  **The lesson is the row's shape, not its content.** It bundled three subjects
  — `monCreateDrop`, `updateMon`, level rating — and was true about the first
  two. A reader checking the parts that were right had no reason to check the
  third. Same failure as **7.2**: a row that names several things collectively
  cannot be closed, and is not read either.
  Sites: `parity/ledger/mon-make.yaml:32`

- [x] **7.4 The world kernel's monster-list scan replacement. DONE — and it
  was never a decision. It was a live defect, on every level, since the port
  began.**
  This row had no description at all, which is how it sat in the "decide it"
  tier: nobody could tell from the title that anything was wrong. Reading it
  cost twenty minutes and found that **no monster in the game emitted light or
  darkness.**

  The kernel was never at fault. `world/view.ts` calcLighting is a faithful port
  of cave-view.c L696-719 — it takes a `sources` list, honours the sign through
  `add_light`'s two arms, and applies the `distance - radius > max_sight` gate.
  What it could not do is scan the monster array, because the view kernel is not
  allowed to know what a monster is. So the scan became a parameter, and **the
  parameter never got an argument**: `LightSource` had two consumers and no
  producer anywhere in the repository, `session/game.ts` passed a literal `[]`,
  and `updateView`'s own parameter defaulted to `[]` behind it. There was no
  arrangement of hosts under which a monster lit a grid — and the comment above
  the call site asserted the opposite ("a host that wants its own light sources
  still replaces this, **and the web does**"), which is exactly how the `[]`
  survived: a seam documented as host-supplied reads as deliberate rather than
  empty. The web does not replace it. Neither does the MCP session. Both were
  checked, and the comment now says so.

  **107 of the 624 shipped races carry a non-zero `light`** — 95 emit it (every
  townsperson's lantern, Grip, Fang, the Phoenix), 12 emit darkness (dark hound
  at depth 15 up to Ungoliant at 75). None of it reached the map.

  Fixed by `monsterLightSources` (`packages/core/src/game/known.ts`), which
  carries upstream's skips in upstream's order — empty slots, camouflaged
  monsters (an unrevealed mimic must not give itself away by glowing), then
  `light == 0`. It iterates `state.monsters` directly rather than calling
  context.ts's `monsterMax`/`monsterAt`, because context.ts imports known.ts at
  runtime and taking the values back would close the cycle.

  **The test is a wiring test on generated levels, and the fixture took three
  attempts** — worth recording, because the first two were wrong in opposite
  directions. Depth 5's nearest light-bearer stood 38 grids away, past
  `max_sight`, so the light maps came back byte-identical and the test failed
  against a *correct* fix. The town has bearers in arm's reach but is
  `SQUARE_GLOW` by day, so their own grid is never dark and the proof degrades
  from `0 -> lit` to `1 -> 2`. A sweep of 60 seeds found seed 2 / depth 4: six
  bearers in sight standing on unlit grids, the nearest a tamer at distance 8 —
  which is the real case this fixes, a lantern coming down a dark corridor.
  The sign needed its own fixture and is rarer still: a darkness-emitter must
  stand on a grid something *else* lights, or there is nothing to subtract
  from. 80 seeds x 7 depths found it once, a huorn at seed 11 / depth 36.
  **5 mutations, 5 killed**, including the `[]` that was the defect.
  Sites: `parity/ledger/world-kernel.yaml:27`

---

## What makes this list checkable

`packages/cli/src/port-todo.test.ts` fails if:

1. any file with a `real` or `partial` census row is not cited by a `Sites:`
   line here — so a confirmed gap cannot be adjudicated and then quietly left
   off the work list;
2. the counts stated at the top (**68 items, 75 citations, 55 `real` + 20
   `partial`**) disagree with the census — so a new `real` row in a file that
   already appears cannot hide inside an existing item. Note that the item count
   and the citation count are coupled here but are not the same measurement: 2.20
   and 1.3 were found by READING, not by the census, so they moved 65 to 67 while
   the citations stayed at 111. This guard is what forced that difference to be
   written down rather than absorbed - and it also caught a duplicate item NUMBER
   (two 2.18s, from adding one while one existed), because renumbering is the only
   way to keep an item referable. **It fired again on 2026-08-05 for the opposite
   reason**: adjudicating thirteen ledger rows turned seven of them `partial`,
   which RAISED the citation count 111 to 118 with no new item and no new work
   discovered by reading. A guard that only ever catches the count going down
   would have missed it;
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
