# What is not ported, and what was judged unnecessary

**Dated 2026-08-04. Every deferral note in this repository has a verdict.**

**Working the list?** [PORT_TODO.md](PORT_TODO.md) is the checklist derived from
this document — the same citations, tiered, with the two items that unlock a
dozen others first. This document is the *accounting*: why each verdict was
reached, and what was judged unnecessary rather than missing.

For most of this port's life "deferred" was written in a comment by whoever was
closing a lane, and nobody could tell afterwards which of those notes described a
hole and which described work that had since landed. The word appeared 439 times.
This document is the answer to "so what is actually missing", and it is backed by
a re-runnable census rather than by recollection.

```
node parity/tools/deferral-census.mjs             # rebuild the row list
node parity/tools/deferral-triage.mjs             # add the mechanical hint column
node parity/tools/deferral-verdict.mjs <ref> ...   # record one adjudication
node parity/tools/deferral-report.mjs             # regenerate the appendix below
node parity/tools/ledger-deferred-items.mjs       # the second tranche (see below)
```

## The headline

**141 of the 367 notes were describing a state of the code that no longer held,
and they have been rewritten.** The census is now 227 rows because 140 of those
notes no longer read as deferrals at all.

The notes were a fossil record of the build order, not a description of the port.
The single most common shape: core was built as a headless library first, so a
note says "the launcher analysis is deferred" or "calc_mana is deferred" and means
"the world layer that does this had not been written the week I wrote this line".
Both are ported. So is the quiver, the options menu, the target system, monster
shapechange, `pit.txt` selection, `message_lookup_by_name`, monster-vs-monster
melee, `react_to_slay` on the player's pack, `pack_overflow`, the fear block of
`mon_take_hit`, `generateStats`, the store's book expansion, O-combat, temporary
brands and slays, the elemental component of monster blows, and every one of the
twenty command codes the base registry registers as stubs.

A further 27 notes were not parity claims at all — a variable named `todo`, a
`setTimeout` "deferred a tick past focus", one mod that "defers to" another.

**What is genuinely missing is 68 citations, which collapse to 60 work items in
[PORT_TODO.md](PORT_TODO.md),** grouped below by what a player would notice. Two
are architectural (`notice_stuff` / `PN_*`, and the carried-weight total nothing
sums); the largest by volume is a debug log.

### Live defects this found

Both by re-reading a note that had handed its work to somebody else, and they
share a shape: **a function or a field that exists, is correct, and is wired to
nothing.**

**A retraction first, because it is the more useful finding.** This section
previously said *"`disturb()` has no callers"*, and that was wrong. It has eleven
importers and 24 call sites. The claim came from greping the port for the C's own
spelling, `disturb(player)`, which the port never writes — the same
failed-transliteration mistake that had already cost four wrong verdicts earlier in
this sweep, running in the opposite direction.

Worse, the same mistake was in the census that produced the claim: the C writes
both `disturb(player)` and `disturb(p)`, and greping one spelling found **38 sites
where there are 53**. The fifteen it could not see included the player's own
melee, a monster's blow landing or visibly missing, and the two run safety-stops
that are the entire point of the DTrap indicator.

Doing the census properly — [game/disturb-census.test.ts](../packages/core/src/game/disturb-census.test.ts),
which now derives it from the C rather than declaring it — found **twelve genuinely
absent sites**, all since wired:

| Upstream | What was missing |
|---|---|
| `player-attack.c:996` | the player's own melee did not disturb |
| `mon-attack.c:594` | a monster's blow CONNECTING (before damage, so a 0-damage effect blow was silent) |
| `mon-attack.c:721` | a visible monster MISSING you |
| `cmd-cave.c:1086` | a run walked the player onto their own detected traps |
| `cmd-cave.c:1150` | a run carried the player out of the detected-traps zone |
| `cmd-cave.c:1599`, `player-util.c:1609` | stepping onto a shop door |
| `cmd-pickup.c:430` | autopickup — an `env.disturb?.()` seam nothing ever supplied |
| `cave-view.c:852` | the mid-level object feeling, message and all (see below) |
| `game-world.c:794`, `:820` | word recall and deep descent activating |
| `game-world.c:1017` | arriving on a new level |

Note which instrument found what. A grep produced three wrong answers in a row.
The census — parse the C, count, reconcile both directions — produced the list
above, and it fails if either side changes. That is the difference between a search
and a measurement.

**The feeling reveal is worth its own line, because the near side of the seam was
tested.** `cave-view.c:849-853` announces the object feeling the moment the player
uncovers enough of a level. The port turned that into `events.signal("feeling")`,
and three tests in `world/fov.test.ts` proved it fires at exactly the right
crossing. **Nothing subscribed to it, in either host.** The event had test
subscribers and no production ones, so the message never reached a player and the
run never stopped — with a green suite over it. "The event fires" is not "the game
reacts", and a test that owns only one side of a seam cannot tell them apart.

**Nothing summed the player's carried weight** — fixed. `player.upkeep.totalWeight`
was set to 0 in `playerOutfit` and thereafter written only by the wizard's quantity
editor (`game/wizard.ts:1470-1471`); `calc_inventory`'s weight accumulation had no
port at all. So `calc_bonuses`' carrying-weight speed penalty
(`player/calcs.ts:1216`) could not fire at any load, the shield bash was short by
`trunc(totalWeight / 80)` (`combat/melee.ts:617`), and the character sheet's Burden
line read `0.0 lb` for every character.

Upstream does not recompute the total; it maintains a running one at four choke
points in `obj-gear.c` and re-sums the whole gear on load, and that is what the port
now does (`game/gear.ts`, plus the `load.c:1179-1185` re-sum in `session/game.ts` —
which is also the migration, since a character saved by any earlier build has a
stored total of zero). Proved by
[game/gear-weight.test.ts](../packages/core/src/game/gear-weight.test.ts), which
tests the three observable consequences rather than the accounting statements and
derives its ground truth by summing the gear: breaking any one of the four sites
kills at least one assertion.

How it hid is the interesting part. Its note read *"the running carried-weight
total (beyond the reset to 0); recomputing it belongs to the calc/inventory
owner"* — a deferral that names its successor instead of itself. The calc owner
never took it, and because the note called it an upkeep counter rather than a
mechanic, nothing about it looked like a gameplay bug. **A handoff with no
recipient reads as done to everyone who passes it.**

**The cursed weapon's combat terms** were the other, and they are fixed.
`object_to_hit` and `object_to_dam` (`obj-util.c:296-326`) add each **active
curse's** template bonus to the object's own, and the port returned `obj.toH` /
`obj.toD` alone. The comment excusing it — *"no object carries curses through
combat yet"* — had stopped being true: `GameObject.curses` is real and `applyCurse`
fills it during generation. Three shipped curses carry a combat penalty
(enveloping −5/−5, irritation −15/−15, air swing −20/0), so a cursed weapon's
to-hit and damage were wrong in play. Fixed, with the curse table threaded from
both live melee paths (`MeleeOptions.curses`) and the expected values derived from
the shipped pack in `combat/object-bonus-curses.test.ts`.

Note what it reproduces: `calc_bonuses` already folds a worn item's curse `to_h`
into `state->to_h`, and `py_attack_real` then adds `object_to_hit(weapon)` on top,
so upstream counts a cursed **weapon's** penalty twice. Core keeps the C's warts;
the `bug-fixes` mod is where that would be corrected.

The ledger line that carried the stale label — `combat-melee.yaml`'s
`object_to_hit, object_to_dam, object_weight_one (curse terms DEFERRED)` — has
been corrected too, which is why the census fell from 228 rows to 227 and the
`real` count from 86 to 85. Recording a verdict and leaving the lie in the file
is not a fix.

### The second tranche, measured: 331 items

The census greps for deferral *wording*, and the ledger's `deferred:` **list
items** mostly do not repeat the word:

```yaml
deferred:
  - Curse contributions to object_to_hit/to_dam/weight.
  - monster_attack_monster (monster-vs-monster melee).
```

Neither line was ever a census row, and both had stopped being true — the first
was the live defect above. The bare-key exclusion was right (a field name is not a
claim); the reasoning written next to it, that the entries underneath are "matched
on their own text", was wrong, which is the worse of the two errors.

`parity/tools/ledger-deferred-items.mjs` now scans those blocks structurally and
finds **331 items across 72 ledger files**. The one file
worked as a sample — `combat-melee.yaml`, 11 items — came out **ten stale, one
real**, which is the same rate as the first tranche and the reason the live defect
above sat unnoticed: it was in a list nobody re-read.

**Progress: 135 of 331 adjudicated** — `ui-display`, `ui-player`, `ui-entry`,
`wizard-debug`, `game-gear`, `obj-knowledge`, all four `store-*`,
`player-history`, `obj-desc`, `mon-lore`, `mon-lore-describe`,
`game-effect-terrain`, `game-effect-teleport`, `game-player-path` and
`game-mon-cmd`. The rate held: **47 `ported`, 19 `stale-doc`, 13 `divergence`,
5 `not-a-deferral`, 3 `n-a`, 2 `note-is-fix` against 28 `real` and 18
`partial`** — two rows in three were not owed work. The owed ones are what
matters, and they include both live defects above. 196 remain.

## Genuinely not ported

Grouped by what a player would notice, worst first. Every line is backed by a row
in the appendix with the file, the C reference and the evidence.

### It changes what happens in play

- **Nothing sums the player's carried weight** (`game-gear.yaml:77`,
  `store-transact.yaml:54`). `player.upkeep.totalWeight` is written in exactly two
  places — set to 0 at birth, and adjusted by the wizard — so the speed penalty for
  being overloaded (`player/calcs.ts:1216`) can never fire. See above.
- **`square_isempty` is weaker than upstream's** (`game/context.ts:1088`).
  `cave-square.c:604` rejects a player trap, a web, and any object; the port
  checks only passable / no monster / not the player, at 48 call sites. Placement
  loops can accept grids upstream rejects, which also moves RNG draws.
- **The `PN_IGNORE` notice pass is never run** (`game/context.ts:297`,
  `session/game.ts:542`, `obj/knowledge.ts:1366`). Becoming aware of an item kind
  sets the flag and nothing consumes it, so newly-ignored items are not dropped.
  The menu / `K` trigger of the same pass *is* reproduced.
- **Monster-vs-monster theft ignores `react_to_slay`** (`mon/steal.ts:234`,
  `mon-util.c:1548`). The player's own pack is protected correctly.
- **`alter` (`+`) has no chest or floor-trap branch** (`game/cave-cmd.ts:1045`).
  The note excused this because "alter is not wired to a shell key yet"; the
  shell has bound it since, which is what makes the gap reachable.
- **The chest `OF_TRAP_IMMUNE` rune is never learned** (`game/chest.ts:268`,
  `:346`) — the branch upstream learns in is empty in the port.
- ~~**`known_only` does not exist**~~ (`player-calcs-bonuses.yaml:78`) - CLOSED
  by PORT_TODO 2.6. `CalcBonusesOptions.knownOnly` is the flag, the session
  derives `p->known_state` beside `p->state`, and `prt_ac`, the character
  sheet's combat panel and the monster-recall colouring read it. The row's
  scoping was wrong in an instructive way: all three combat runes are granted
  at birth (`player-birth.c:1264-1267`), so the `to_a` / `to_h` / `to_d` gates
  never close and the two screens barely move. What `known_state` withholds is
  RESISTS and OBJECT FLAGS, and the reader that cares is
  `player_inc_check(..., lore = true)`.
- **`pile_insert_end` is absent** (`game/gear.ts:1173`), so ordering inside a
  floor pile can differ from upstream's append-at-end.
- **`path_analyse`** (`game/known.ts:750`) and the **known-object shadow cave**
  (`game/floor.ts:18`). ~~`list_object` / `oidx` bookkeeping~~ - re-adjudicated as
  a DIVERGENCE (`game/mon-place.ts:267`, `:328`): the port replaced upstream's
  `cave->objects[]` registry with a grid-keyed pile map plus `obj.mimickingMIdx`,
  and nothing observable depends on an oidx.
- **`object_flag_is_known` at the three store sites** (`store/store.ts:232`,
  `:262`, `store-maint.yaml:34`). `store_init`'s runtime owner selection turned
  out to be PORTED (`storeChooseOwner`, `store/store.ts:100`).
- **The `OSTACK_LIST` stacking checks** (`obj/object.ts:923`, `:1000`): two
  objects the player cannot tell apart must not merge in a list context.
- **`cmd_disable_repeat_floor_item`** (`cmd-core.yaml:25`).
- The **monster-source decoy / target-monster branches of `EF_TOUCH`**
  (`game/project-cast.ts:685`).

### It changes what the player is told

- ~~**`add_monster_message` has no queue**~~ (`game/mon-message.ts:15`) - CLOSED
  by PORT_TODO 3.1. This was called "the one architectural item on the list", and
  it was: the grammar was verbatim and every emit site printed its own sentence,
  so repeats never combined into "3 kobolds die.", a monster caught twice by one
  splash was described twice, and a death could be reported before the pain that
  caused it. `mon_msg[]`, `stack_message`, `redundant_monster_message`,
  `what_delay` and `show_monster_messages` are now ported whole, `PN_MON_MESSAGE`
  is the third `PN` bit, and `noticeStuff` drains it. What reading the C then
  turned up, and the item did not say: `player_kill_monster` calls `notice_stuff`
  ITSELF before the kill line (`mon-util.c:1046`, `:1055`) — two of upstream's
  fifteen `notice_stuff` sites, both unwired until now.
- **The killer's name is a race name, not `monster_desc(MDESC_DIED_FROM)`**
  (`effects/handlers.ts:78`, `game/effect-attack.ts:687`). Both halves exist —
  `MDESC_DIED_FROM` is defined at `mon/desc.ts:61` — and are not joined.
- ~~Monster recall has no computed percentages~~ - PORTED and wired:
  `meleeHitPercent` and `monsterHitPercent` at `web/main.ts:3650` and `:3652`,
  `breathProjection` at `:3659`, with `web/screens.test.ts:929` asserting the real
  melee percentage reaches the recall screen. Four interface comments still said
  `DEFERRED`, which is the whole reason this line was here.
- **Object and ego recall show no computed lines** (`web/knowledge.ts:1095`,
  `:1185`). `desc_obj_fake` and `desc_ego_fake` print a name and the record's lore
  text where upstream prints `object_info(OINFO_FAKE)` / `object_info_ego`'s flag
  and combat lines. The producer exists (`obj/object-info.ts`).
- **Monster spell and breath damage are not bound to the casting race**
  (`mon-lore-describe.yaml:55`). `deps.spellLoreDamage`
  (`mon/lore-describe.ts:149`) is a full override with no supplier anywhere, so
  `monSpellLoreDamage` returns 0 and upstream's `(N)` is omitted at every spell.
  Distinct from the two above: a `mon/spell.ts` binding, not a display call.
- ~~`show_floor` for multiple objects~~ - PORTED: `showFloorList`
  (`web/src/overlay.ts:301`), called at `web/main.ts:5967`.
- **The knowledge browser's thematic grouping columns** (`web/screens.ts:872`,
  `gamedata.yaml:478` — this is `ui_knowledge.txt`). The browser is ported; the
  grouping the datafile defines is not.
- **The high-score entry cannot name the real killer** (`high-scores.yaml:96`).
- **The character sheet's launcher contribution is 0** (`game/ui-entry.ts:1392`,
  `ui-entry.yaml:133`) — and the reach it calls deferred exists, at
  `player/calcs.ts:1246`. ~~`show_combined` / `EQUIPCMP_SCREEN` never iterated~~ -
  PORTED: `equipCmpCategories` (`game/ui-entry.ts:1965`) is iterated by
  `equipCmpSummary` (`game/equip-cmp.ts:391`), with the combined row asserted the
  same length as the columns (`game/equip-cmp.test.ts:116`).
- **`update_sidebar`'s priority culling and from-bottom placement**
  (`ui-display.yaml:124`). The sidebar itself is drawn.
- **The birth screens answer help with a no-op** (`web/birth.ts:1051`).
- **Temporary brands/slays are not shown in object info**
  (`obj/object-info.ts:962`). The combat half is ported.
- **The shape-lore textblock chain** (`web/main.ts:3697`, `:3701`).
- **The lore title does not recolour a unique with `purple_uniques`**
  (`mon/lore-describe.ts:1348`). Of that row's three claims only this one survived
  reading: the secondary glyph and the tile gating are the shell's, but
  `purple_uniques` is a live option (`generated/options.ts:25`) honoured by the map
  text layer and ignored by `loreTitle`.
- **Rune-learning messages still use the `ODESC_BASE` stand-in**
  (`obj/known-object.ts:160`). The real `object_desc` DID land - `describeObject`,
  `game/describe.ts:48` - but `objBaseName` (`obj/knowledge.ts:220`) is still "the
  kind's plain name" with `~` and `&` stripped, used by every rune message. The
  layering reason is real, so the fix is a seam rather than an import.
- **`equip_learn_flag` has no shape branch** (`obj-knowledge.yaml:98`), so gear
  merged into a shape is still learned from while shapechanged.
- ~~`object_list_format_name`'s own decoration~~ - PORTED:
  `objectListEntryName` (`game/obj-list.ts:289`) passes the summed count through
  `ODESC.ALTNUM` as upstream does. Only the shell-side "%3.3s" padding differs.

### Whole modes that were never begun

- **Arena mode** (`mon/take-hit.ts:17`, `gen/cave.ts:31`, `gen/generate.ts:11`,
  `gen-cave.yaml:49`, `game-mon-ranged.yaml:31`). `hard_centre_gen` is PORTED
  (`hardCentreGen`, `gen/cave.ts:1914`); only `arena_gen` remains.
- **The quest system** (`gen/cave.ts:2833`, `gen/generate.ts:11`).
- **Persistent levels and the town builder's full store generation**
  (`gen/cave.ts:30`).
- ~~`room_of_chambers` needs a caller~~ - CLOSED. The builder works
  (`gen.test.ts:2175` builds it, asserts true, and checks the chambers are
  connected and themed) AND `spreadMonsters`, whose note claimed no builder
  reached it, is called twice: `gen/cave.ts:1721` and `:1865`.

### History, notes and files

- **`history_find_artifact` / `history_lose_artifact`** ARE wired
  (`game/context.ts:687`, `:695`, installed by `wireGame`) - only the store
  PURCHASE site is missing (`store/transact.ts:26`); find-on-sight entries are blocked on remembered
  floor-pile contents (`:75`); there is **no player notes command** (`:91`).
- **`randart.log` / `randart.txt`** (`obj/randart.ts:38`). Upstream's `do_randart`
  writes it whenever randarts generate and `exit(1)`s if it cannot open it: 193
  `file_putf` sites. The largest single item here, and a debug log no player
  reads.
- **`options_save_custom` / `restore_custom` / `restore_maintainer`**
  (`options.yaml:76`) — per-user customised defaults in `ANGBAND_DIR_USER`. Now
  buildable: the host seam and the pref-file writer both exist.
- **`RANDNAME_TOLKIEN`** is not loaded (`obj-randart.yaml:51`), so randart names
  come from the port's own generator.
- The **spoiler files' missing lines** (`game/spoil.ts:93`, `:518`, `:519`,
  `:550`) and **`randart-build.ts:38`**'s timed-effects failure tables.

### Wizard mode: nothing owed. This section was wrong.

Every row here has been re-adjudicated to `ported`. **Wizard mode is built**:
`runPlayItem` with upstream's full `A/K/S/R/T/C/Q` submenu
(`web/src/wizard.ts:1894-1923`), `runChangeQuantity`, `runTweakItem` /
`runRerollItem` / `runCurseItem`, `runWriteMap` over `game/dump-level.ts`,
`runCollectObjMonStats` / `runCollectPitStats` / `runCollectDisconnectStats`,
`runStatItem` over `wizStatItem`, `runSpoilers` over the four `spoil*`
generators (`game/spoil.ts:255`, `:344`, `:453`, `:505`), and `ArtifactState`
(`obj/make.ts:736`) as `aup_info[]`, serialized in the save.

**Why this document said otherwise.** The verdicts rested on greps for a
camelCase transliteration of the C name — `changeItemQuantity`, `playItem` —
which the port never uses. A failed transliteration grep is not evidence of
absence, and four of the eight verdicts of that shape were wrong.
`parity/tools/deferral-crosscheck.mjs` now greps the port for the **C name**,
which this codebase reliably cites beside its port, and its output is a list of
leads for a reader rather than a verdict.

The one thing that looked like a wizard gap and is real is the **ENTER command
browser** (`web/wizard.ts:498`, `textui_action_menu_choose`), absent for every
command list rather than for debug mode. `world-kernel.yaml:27` stays open as a
decision.

### Dead, and a decision rather than a task

- **`project-path.yaml:58`**: a ported function whose only caller would be an
  absent UI branch. Wire it or cordon it — leaving it is the
  shipped-is-not-reachable trap.

## Judged unnecessary, with the mechanism

81 rows. These are not gaps, and each names *why* rather than asserting it.

- **The `PU_*` / `PR_*` dirty-flag pipeline does not exist and cannot** (50 rows
  of the `n-a` set are this or a layer boundary). The front end recomputes and
  repaints everything after every state-changing action, so there is no flag for
  a core write to set. `game/known.ts:153` states it at the site.
- **`obj->known` is synthesised, not stored** (31 `divergence` rows). Upstream
  gives every object a stripped twin; the port derives an equivalent shadow on
  demand from the player's cumulative rune knowledge
  (`obj/known-object.ts objectKnownShadow`) and `desc.ts` reads the shadow
  exactly where upstream reads the twin. `known-object.ts` carries the
  equivalence argument field by field.
- **`Rand_init`'s time/pid seeding** is deliberately replaced: the port seeds at
  the host and stores the seed in the save, which is what makes a run
  reproducible.
- **Upstream's `look` is a UI function with `CMD_NULL`** (`ui-knowledge.c:4169`),
  and **4.2.6 has no search command at all** — no `do_cmd_search`, no
  `CMD_SEARCH`. Those two of the twenty stub codes are correctly never replaced.
- **`monster_index_move`** exists only to serve `arena_gen`'s `memcpy`;
  **`expression_free`** is garbage collected; **`old_class.txt`** is retired data
  the 4.2.6 game does not load; **`pricing.log`** is behind a `PRICE_DEBUG` that
  upstream defines nowhere.
- **The panic save has no counterpart**, because the port autosaves
  continuously: there is no second artifact and no window in which one could be
  newer. Recorded on the CLI text census's `"A panic save exists.  Use it? "`.

## How to keep this honest

- `deferral-census.mjs` merges verdicts forward by (file, collapsed line text)
  and **names every verdict it drops**, because a dropped adjudication is
  normally good news (the note was rewritten) and must still be visible.
- `deferral-triage.mjs` writes a `hint`, never a verdict, and counts references
  so a symbol that is declared and never called reads as `dead-candidate` rather
  than as evidence of a port.
- `deferral-verdict.mjs` exits non-zero naming any reference that matched no row.
- The appendix below is generated. `deferral-report.test.ts` fails when it is
  stale, so this document cannot drift from the census. It also fails on a new
  deferral note with no verdict, and on a verdict with no evidence.
- `ledger-deferred-items.mjs` is deliberately NOT under that ratchet yet: 331
  items are unadjudicated, and a test asserting zero would just be turned off.
  Adjudicate them and then bring it under the same guard.
- `port-todo.test.ts` holds [PORT_TODO.md](PORT_TODO.md) to the same census:
  every file with an owed row must be cited by a work item, the stated totals
  must match, and a cited path must exist. It is keyed on **file**, not
  `file:line`, on purpose — a line-keyed guard fails on every unrelated edit
  above a citation, and a churning test gets turned off.
- **The hand-written `file:line` numbers in the prose above are the one part of
  this document that drifts, and they already have once**: rewriting the notes
  moved ten of them by a line or two, and nothing caught it until the two
  documents were diffed against the census by hand. Prefer the generated
  appendix and PORT_TODO.md's `Sites:` lines, which come from the TSV. When the
  prose and the appendix disagree, the appendix is right.

<!-- BEGIN GENERATED: deferral-report.mjs -->

## Appendix: every row, with its verdict

Generated from `parity/reports/deferral-census.tsv` (227 rows).

| verdict | meaning | rows |
| --- | --- | --- |
| `real` | Confirmed absent and owed | 53 |
| `partial` | Part ported; the note must say which part is not | 12 |
| `divergence` | Deliberately different, with the mechanism named | 32 |
| `n-a` | Not applicable to this port, with the mechanism named | 47 |
| `ported` | Done; the note was stale and has been rewritten | 26 |
| `stale-doc` | The note described a state of the code that no longer holds | 5 |
| `note-is-fix` | The wording sits inside a record of a FIX, not a gap | 25 |
| `not-a-deferral` | Ordinary English, not a parity claim | 27 |
| | **total** | **227** |

### `real` - Confirmed absent and owed (53)

- `packages/core/src/effects/handlers.ts:78` - LEAD READ. Still real, and the note's reason is stale: monsterDesc IS ported (mon/desc.ts) and MDESC_DIED_FROM is defined at mon/desc.ts:61. The port hardcodes "a monster" where upstream's killer_desc calls monster_desc(mon, MDESC_DIED_FROM), so the death cause loses both the article and the visibility gate ("something" for an unseen killer). The work is one call, not a subsystem
- `packages/core/src/game/cave-cmd.ts:1045` - LEAD READ, and the lead is a FALSE POSITIVE: web/src/context-menu.ts only names do_cmd_alter in a comment while routing "Attack"/"Alter" to this same core command (context-menu.ts:164-179), so it inherits the gap rather than filling it. The chest and floor-trap-disarm fall-through branches (do_cmd_alter_aux L969-992) are genuinely absent, and "+" is bound to alter at web/src/main.ts:8090
- `packages/core/src/game/chest.ts:268` - LEAD READ. Still real, and the note's reason is stale: equipLearnFlag IS ported (obj/knowledge.ts) and called at game/effect-general.ts:388, :401 and game/loop.ts:224, :225. Trap immunity simply is not learned from a chest trap - one call at an existing seam, not #13's worth of work
- `packages/core/src/game/chest.ts:346` - LEAD READ. Same as chest.ts:268: equipLearnFlag exists and is used elsewhere; this site does not call it
- `packages/core/src/game/context.ts:297` - PN_IGNORE is SET (session/game.ts:551) and nothing ever reads it, so becoming aware of a kind never triggers the ignore_drop pass. ignoreDropTargets exists (game/ignore-cmd.ts:45, called from web main.ts:3119 for the menu) - it is the notice pass that is missing
- `packages/core/src/game/context.ts:1088` - square_isempty (cave-square.c:604-608) rejects a player trap, a web and any object; the port checks only passable/no-monster/not-player, at 48 call sites. Placement loops can therefore accept grids upstream rejects, which also moves RNG draws
- `packages/core/src/game/effect-attack.ts:687` - LEAD READ. Same as effects/handlers.ts:78 and the same one-call fix: mon.race.name stands in for monster_desc(mon, MDESC_DIED_FROM), which drops the article and prints a raw race name on the tombstone. MDESC_DIED_FROM exists (mon/desc.ts:61)
- `packages/core/src/game/gear.ts:1173` - LEAD READ. Still real, and a dedicated instrument says so: game/pile.upstream.test.ts:28 states "pile_insert_end has NO port counterpart: nothing in the live port appends", and gear.ts:1094 cites it for the equip path only
- `packages/core/src/game/known.ts:750` - path_analyse absent: no pathAnalyse anywhere in the port, so intervening-square terrain is never learned along a path.
- `packages/core/src/game/project-cast.ts:685` - The monster-source decoy and target-monster branches of effect_handler_TOUCH are genuinely absent; a monster casting a touch effect cannot centre it on a decoy or another monster
- `packages/core/src/game/spoil.ts:93` - timedDesc / summonDesc unwired, so a handful of activation descriptions in the spoiler files read worse than upstream's. Dev tool, small
- `packages/core/src/game/spoil.ts:518` - Same root cause as the lore hit-chance gap: the combat layer does not feed lore, so every "chance to hit" line in the monster spoiler is absent
- `packages/core/src/game/spoil.ts:519` - Second half of the same line
- `packages/core/src/game/spoil.ts:550` - loreDescription has no upstream-style spoiler flag, so the spoiler text differs from wiz-spoil.c's
- `packages/core/src/game/ui-entry.ts:1392` - The launcher-slot reach plus KF_SHOOTS_ARROWS is genuinely absent, so this entry contributes 0 where upstream contributes the launcher's value
- `packages/core/src/gen/cave.ts:30` - The town builder's full store generation and persistent-level connectors
- `packages/core/src/gen/cave.ts:31` - Second half of the same claim; the single-combat arena level is generated elsewhere
- `packages/core/src/gen/cave.ts:2833` - Quest-system dungeon profile
- `packages/core/src/gen/generate.ts:11` - Arena and quest level generation
- `packages/core/src/mon/steal.ts:32` - LEAD READ. The claim stands but its comparison is FALSE and must be fixed in the comment: reactToSlay IS ported (combat/brand-slay.ts:152) and the player's EAT_ITEM blow DOES apply it (game/mon-side.ts:421), so "deferred exactly as the EAT_ITEM blow already defers it" describes a state that no longer holds. combat/mon-melee.ts:36 already records the true remainder
- `packages/core/src/mon/steal.ts:33` - Same claim, second line
- `packages/core/src/mon/steal.ts:231` - Same gap at the site
- `packages/core/src/mon/steal.ts:234` - LEAD READ. The one genuine remainder, and the whole of it: the monster-vs-monster theft path does not call reactToSlay (vs mon-util.c:1548), so a slay-bearing item cannot resist being stolen monster-from-monster. No RNG impact. The function is right there in combat/brand-slay.ts:152
- `packages/core/src/mon/take-hit.ts:17` - The arena branch, with the rest of arena mode
- `packages/core/src/obj/knowledge.ts:1366` - The ignore-notice pass (PN_IGNORE) is the same gap as game/context.ts:296: the flag is set and never consumed
- `packages/core/src/obj/make.ts:1238` - The book out-of-depth value boost out-parameter
- `packages/core/src/obj/object-info.ts:962` - The COMBAT half of temporary brands/slays is ported (combat/brand-slay.ts:141-201, player_has_temporary_brand/slay); only the object-info display of them is missing
- `packages/core/src/obj/object.ts:923` - OSTACK_LIST's unknown-item stacking checks: two objects the player cannot tell apart must not merge in a LIST context. The shadow can answer this, so it is owed rather than impossible
- `packages/core/src/obj/object.ts:1000` - OSTACK_LIST fully-known mismatch check, same site family
- `packages/core/src/obj/randart-build.ts:38` - The "property" branch needs the timed-effects failure tables; part of the randart generator's remaining edges
- `packages/core/src/obj/randart.ts:38` - LEAD READ. The lead (obj/randart-build.ts) is do_randart's generation half, which is fully ported; the file dumps are not. The maintainer has ruled to pursue parity here, so randart.txt (create_file / write_randart_entry, obj-randart.c L3057-L3215) and randart.log are both owed through the host seam, together with the second measurement pass (store_base_power / parse_frequencies, L3184-L3187) that exists only to populate the log
- `packages/core/src/store/store.ts:232` - LEAD READ. Still real: object_flag_is_known's answer IS available - game/equip-cmp.ts:413 synthesises the obj->known shadow for exactly this question - and the store's buy check does not use it
- `packages/core/src/store/store.ts:262` - LEAD READ. Same site, the buy-list loop: the flag test reads obj.flags directly with the object_flag_is_known gate commented out, so a store will buy on a flag the player has never learned
- `packages/web/src/birth.ts:1051` - Upstream's birth screens offer help (ui-birth.c); the port answers the key with a no-op
- `packages/web/src/knowledge.ts:1095` - LEAD READ. Still real: object_info's computed lines exist (obj/object-info.ts, which already calls chanceOfMeleeHitBase at :1090), and desc_obj_fake's recall still shows only the name and the kind's flavour text
- `packages/web/src/knowledge.ts:1185` - LEAD READ. Still real, same shape: object_info_ego's flag lines are not produced, so ego recall shows the name and lore text only
- `packages/web/src/main.ts:3697` - Greying rather than omitting is a divergence forced by a real gap - the shape-lore textblock chain named on the next line
- `packages/web/src/main.ts:3701` - The shape-lore textblock chain for Shapechange effects
- `packages/web/src/screens.ts:872` - The thematic monster_group columns of the upstream knowledge browser (the ui_knowledge.txt grouping) are not drawn; the flat list is the selectable membership only
- `packages/web/src/wizard.ts:498` - The command-list absence tracked with the wizard-mode rows
- `parity/ledger/cmd-core.yaml:25` - cmd_disable_repeat_floor_item has no port equivalent (0 references)
- `parity/ledger/game-project-cast.yaml:53` - The monster decoy / target-monster branches of TOUCH, matching game/project-cast.ts:684
- `parity/ledger/gamedata.yaml:478` - ui_knowledge.txt: it defines the knowledge browser's thematic grouping, and the browser IS ported, so the grouping columns are missing (see web/src/screens.ts:872)
- `parity/ledger/high-scores.yaml:96` - The real killer is not wired through GameState, so the score entry cannot name it
- `parity/ledger/mon-lore-describe.yaml:55` - Monster spells are not bound to the casting race, so recall cannot show spell damage - the same family as the lore hit-chance gap
- `parity/ledger/obj-randart.yaml:51` - RANDNAME_TOLKIEN from the names datafile is not loaded, so randart names come from artifactGenName's own generator
- `parity/ledger/options.yaml:76` - options_save_custom / restore_custom / restore_maintainer - the per-user customized-defaults files in ANGBAND_DIR_USER. Now buildable: the host seam and the pref-file writer both exist
- `parity/ledger/player-history.yaml:75` - find-on-sight history entries, blocked on the remembered floor-pile contents
- `parity/ledger/player-history.yaml:91` - The player notes command
- `parity/ledger/project-path.yaml:58` - A ported function with no caller, because the UI branch that would call it is absent - worth deciding between wiring it and cordoning it
- `parity/ledger/store-maint.yaml:34` - LEAD READ. Same object_flag_is_known gap as store/store.ts:232 and :262, reached through store maintenance
- `parity/ledger/ui-entry.yaml:133` - The launcher-slot reach plus KF_SHOOTS_ARROWS, same as game/ui-entry.ts:1392
- `parity/ledger/world-kernel.yaml:27` - The monster-list scan replacement and what the note lists after it

### `partial` - Part ported; the note must say which part is not (12)

- `packages/core/src/game/context.ts:1161` - The held-object drop IS handled (the caller runs monster_death first, as the note says); the mimic and targeting bookkeeping remain
- `packages/core/src/game/floor.ts:18` - pushObject is ported and called (effect-general.ts:190, effect-terrain.ts:347); the known-object shadow cave, list_object/delist_object oidx bookkeeping and mimicked-object handling remain
- `packages/core/src/game/monster-turn.ts:1425` - Item pickup and group behaviour are ported (monsterCarry, mon-group.ts); the lore half is largely wired via loreLearnFlagIfVisible. Left partial because the note covers three subsystems at once and only names them collectively
- `packages/core/src/game/ui-entry.ts:26` - The gameplay half of player_flags_timed IS ported - calcs.ts:1094-1104 folds each active timed effect's oflagDup into state.flags. What is missing is ui-entry.c:928's separate timed cache, which lets the sheet mark a flag as temporary
- `packages/core/src/mon/lore-describe.ts:1348` - LEAD READ. Three claims, two of them the shell's by construction (the secondary glyph and the tile width/height gating are presentation state the headless lore model does not carry). The third is real and small: OPT(purple_uniques) IS a live option (generated/options.ts:25, honoured by the map text layer per visuals/map-text.test.ts:26) and the lore title does not recolour a unique's name with it
- `packages/core/src/session/game.ts:542` - LEAD READ. Half wired, half not. The scan half of ignore_drop IS ported (ignoreDropTargets, game/ignore-cmd.ts:45) and IS driven by the shell (web/src/main.ts:3119, applyIgnoreDrop, on the '=' and 'K' paths with the verify_object confirmation and the "!d" decline hack). What is missing is only the trigger: state.noticeIgnore is set here (session/game.ts:551) and read by nothing, which is PN_IGNORE and belongs to the notice_stuff gap rather than to ignore_drop
- `packages/core/src/store/transact.ts:26` - Of the four named: the known twin is a divergence and total_weight IS maintained (gear.ts:1283, shown as Burden at char-sheet.ts:409). Autoinscription (the registry exists at game/context.ts:254) and history_find/lose_artifact are genuinely absent here
- `parity/ledger/game-mon-ranged.yaml:31` - The glyph-of-warding exclusion is available (TRF.GLYPH is handled at monster-turn.ts:1536); the arena exclusion goes with arena mode
- `parity/ledger/game-project-monster.yaml:50` - Targeting is wired; the mimic bookkeeping is not (same as game/context.ts:1153)
- `parity/ledger/gen-cave.yaml:49` - CORRECTED from real. hard_centre_gen IS ported (hardCentreGen, gen/cave.ts:1914, a greater vault surrounded by four caverns). Only arena_gen remains, with the rest of arena mode
- `parity/ledger/mon-make.yaml:32` - monCreateDrop and updateMon are ported; monster lore is wired (including lore.txt). Level rating has no port equivalent (0 references)
- `parity/ledger/ui-display.yaml:124` - The sidebar IS drawn, by the front end on a canvas rather than with Term_* calls (web/src/main.ts sidebarModel). update_sidebar's screen-size priority culling and from-bottom placement are genuinely absent (game/display.ts:505 says so)

### `divergence` - Deliberately different, with the mechanism named (32)

- `packages/core/src/game/curse-tick.ts:98` - known-twin write; obj/known-object.ts synthesises the shadow on demand, so the object-info display reads the same value
- `packages/core/src/game/gear.ts:135` - Same: the known twin is synthesised, not stored (obj/known-object.ts objectKnownShadow)
- `packages/core/src/game/gear.ts:328` - The note already contains its own answer - objKnown.toA is 1 from birth, so the shadow at known-object.ts:446 yields the real toA and the twin write has no observable consumer
- `packages/core/src/game/gear.ts:374` - Same write, same reason (known-object.ts:446)
- `packages/core/src/game/gear.ts:981` - objectSimilar's equipped test: isEquipped is ported; the OSTACK_LIST knowledge checks read the synthesised shadow
- `packages/core/src/game/gear.ts:1055` - Knowledge twin synthesised on demand (obj/known-object.ts)
- `packages/core/src/game/gear.ts:1108` - pval bonuses are live; equip_cnt is upstream's equipment-count UI counter, which the port's character sheet derives directly from player.equipment
- `packages/core/src/game/gear.ts:1283` - Known-twin write, subsumed by the on-demand shadow
- `packages/core/src/game/known.ts:819` - Known twin synthesised on demand (obj/known-object.ts)
- `packages/core/src/game/known.ts:847` - Known twin synthesised on demand; monsterCarry itself is ported and called two lines below (known.ts:854)
- `packages/core/src/game/mon-place.ts:267` - LEAD READ. Re-adjudicated from real. list_object/delist_object is oidx bookkeeping for upstream's cave->objects[] registry, and the port replaced that registry rather than omitting it: state.floor is a pile map keyed by grid, and the mon<->obj mimicry link is obj.mimickingMIdx === mon.midx, which become_aware reads and the save persists. Nothing observable depends on an oidx. Ratified in game/floor.ts:19-21
- `packages/core/src/game/mon-place.ts:328` - LEAD READ. Same ratified substitution as mon-place.ts:267 - the pile map IS the object list
- `packages/core/src/game/monster-turn.ts:1377` - The player-cave placeholder copy rides the knowledge subsystem, which the port models as synthesised knowledge rather than a second grid array
- `packages/core/src/game/target-loop.ts:42` - Documented approximation for a UI-only branch: the port reads the live floor pile and live projectability where upstream reads the remembered map. project.ts carries the same note
- `packages/core/src/gen/generate.ts:249` - The port's Connector carries grid + feat rather than a SQUARE info copy; matters only when persistent levels arrive
- `packages/core/src/obj/bind.ts:1324` - The known-object side is synthesised on demand (obj/known-object.ts) rather than bound as a second object
- `packages/core/src/obj/desc.ts:15` - The header's inline DEFERRED notes are all known-twin reads, which desc.ts now takes from objectKnownShadow
- `packages/core/src/obj/knowledge.ts:22` - Per-object twin replaced by on-demand synthesis (obj/known-object.ts objectKnownShadow)
- `packages/core/src/obj/knowledge.ts:729` - A known-twin display marking, subsumed by the shadow
- `packages/core/src/obj/knowledge.ts:748` - Same
- `packages/core/src/obj/knowledge.ts:1245` - Same
- `packages/core/src/obj/known-object.ts:9` - This module IS the divergence: the twin is synthesised on demand and desc.ts reads the shadow wherever upstream reads obj->known
- `packages/core/src/obj/object.ts:7` - Header points at obj-model.yaml; the model's absent twin is the synthesised shadow
- `packages/core/src/obj/object.ts:290` - Known-twin field
- `packages/core/src/obj/object.ts:388` - The explicit statement of the divergence: no persistent twin, synthesis instead (obj/known-object.ts)
- `packages/core/src/obj/object.ts:909` - Player-knowledge inputs come from Player.objKnown and the shadow
- `packages/core/src/obj/object.ts:1158` - Knowledge system read, answered by the shadow
- `packages/core/src/store/store.ts:368` - The obj->known pile is synthesised on demand (obj/known-object.ts)
- `parity/ledger/game-gear.yaml:73` - The known twin is synthesised on demand; the line's own "NOT deferred" clause lists what is live
- `parity/ledger/rng.yaml:40` - Rand_init's time/pid seeding is deliberately replaced: the port seeds from crypto/Math.random at the host and stores the seed in the save, which is what makes a run reproducible
- `parity/ledger/ui-entry.yaml:107` - Synthesised on demand (obj/known-object.ts)
- `parity/ledger/ui-entry.yaml:114` - The port folds merged curse data into the object's own flags, which the note states is equivalent

### `n-a` - Not applicable to this port, with the mechanism named (47)

- `packages/core/src/game/known.ts:153` - The note names its own mechanism: the front end runs updateView + noteSpots after every state-changing action, so there is no dirty-flag pipeline for a PU_/PR_ bit to set
- `packages/core/src/game/loop.ts:338` - A message on a seen trap re-arming; the port has no PR_ dirty-flag pipeline and the front end repaints unconditionally
- `packages/core/src/game/mon-death.ts:342` - PR_MONLIST is a redraw bit with no port equivalent (the front end repaints unconditionally); the note itself records quest_check as wired
- `packages/core/src/game/monster-turn.ts:1044` - Adjacent-decoy destruction on floors; no RNG, and the decoy itself is modelled
- `packages/core/src/game/monster-turn.ts:1054` - Same adjacent-decoy note, no RNG
- `packages/core/src/game/monster-turn.ts:1319` - Presentation only, no RNG; the port routes messages through the shell sink
- `packages/core/src/game/monster-turn.ts:1402` - A message, no RNG
- `packages/core/src/game/monster-turn.ts:1537` - "The decoy is destroyed!" message; no RNG
- `packages/core/src/game/monster-turn.ts:1669` - Lore note on OF_AGGRAVATE, no RNG; monster lore is otherwise wired
- `packages/core/src/game/monster-turn.ts:1702` - Message plumbing and lore; the messages route through the shell sink
- `packages/core/src/game/player-path.ts:95` - Sound and redraw halves; no RNG, and the port has no PR_ pipeline
- `packages/core/src/game/player-turn.ts:710` - Two of the 20 are correctly never replaced: upstream's "look" is a UI function with CMD_NULL (ui-knowledge.c:4169, bound by the shell to l/x at web main.ts:8039), and 4.2.6 has no search command at all - no do_cmd_search, no CMD_SEARCH
- `packages/core/src/game/project-cast.ts:10` - Layer boundary with live suppliers: session/game.ts:1223 supplies the monster hooks and :1289 the player hooks, so the "deferred consequences" all run in play
- `packages/core/src/game/project-cast.ts:31` - basicPlayerActor is the worldless view; the live path supplies the real actor (session/game.ts:1289)
- `packages/core/src/game/project-cast.ts:131` - CastHooks is the seam, supplied at session/game.ts:1223/:1289
- `packages/core/src/game/project-cast.ts:133` - ProjectMonsterHooks supplied at session/game.ts:1223
- `packages/core/src/game/project-cast.ts:135` - ProjectPlayerHooks supplied at session/game.ts:1289, onSideEffects via makePlayerSideEffects (game/player-side.ts:139)
- `packages/core/src/game/project-monster.ts:47` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/game/project-player.ts:16` - Same seam discipline; supplied at session/game.ts:1289. The killer-name half is tracked separately as the MDESC_DIED_FROM gap
- `packages/core/src/game/project-player.ts:85` - Supplied at session/game.ts:1289
- `packages/core/src/game/spoil.ts:352` - seed_randart only matters under birth_randarts and this is a dev tool; the note states the condition
- `packages/core/src/mon/project-mon.ts:43` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/mon/timed.ts:218` - Health-bar / monster-list redraw; the front end repaints unconditionally
- `packages/core/src/obj/desc.ts:621` - is_unknown's placeholder path belongs to the object-list screen, which the web layer draws (game/obj-list.ts + web screens)
- `packages/core/src/player/bind.ts:15` - Layer boundary: the raw effect chain is compiled by the effects domain, which is ported (effects/effect.ts) and wired at session boot
- `packages/core/src/player/birth.ts:395` - Kind-name refs are resolved by the session (outfitPlayer + tvalFindIdx at gear.ts:1300); the binding layer holding names is the design
- `packages/core/src/player/birth.ts:443` - Same: "deferred references" names the binding boundary
- `packages/core/src/player/birth.ts:446` - Same
- `packages/core/src/player/exp.ts:17` - PU_/PR_ update flags have no port equivalent; the front end repaints unconditionally
- `packages/core/src/player/types.ts:128` - Binding boundary: the raw record is compiled by the effects domain at boot
- `packages/core/src/player/types.ts:146` - Same binding boundary
- `packages/core/src/player/types.ts:179` - Same, handed to the obj domain
- `packages/core/src/player/types.ts:181` - Same
- `packages/core/src/player/types.ts:200` - Same: tval/sval names resolved by the obj domain
- `packages/core/src/world/chunk.ts:10` - square_light_spot is a lighting refresh with no port equivalent; the front end recomputes and repaints every frame
- `packages/web/src/mapview.ts:71` - The rounding branches are dead code upstream; not porting dead code is the documented policy
- `parity/ledger/bitflag.yaml:54` - flag_has_dbg / flag_on_dbg are the C's debug-build assert wrappers around flag_has / flag_on. TypeScript's FlagSet asserts unconditionally (assertValidFlag), so the debug twin has nothing to add. Ratified N/A, not deferred.
- `parity/ledger/dice.yaml:38` - dice_free is manual deallocation. Nothing to port to a garbage-collected runtime. Ratified N/A, not deferred.
- `parity/ledger/effects-interpreter.yaml:138` - recharge_failure_chance IS in the obj domain, which is where the note says it belongs; the rest of the line is about GC and serialisation
- `parity/ledger/expression.yaml:31` - expression_free is garbage collected and the strtol saturation is documented in the helper; neither is reachable behaviour
- `parity/ledger/game-arena.yaml:16` - monster_index_move exists only to serve arena_gen's memcpy; the port's arena builder reads state.healthWho instead
- `parity/ledger/game-gear.yaml:70` - Pack overflow at birth: a birth kit cannot overflow, and packOverflow itself is ported and called (obj-cmd.ts:276, session/game.ts:806)
- `parity/ledger/gamedata.yaml:497` - old_class.txt is retired data the 4.2.6 game does not load
- `parity/ledger/player-model.yaml:53` - Starting-inventory kind-name refs are resolved by the session; a binding boundary
- `parity/ledger/ui-player.yaml:68` - The resist/ability/sustain grid is ported, in the separate module the note points at (characterGrid, ui-entry.ts:1863, drawn by web charsheet.ts:270)
- `parity/ledger/wizard-debug.yaml:163` - The action is reachable by another route already ported; upstream's separate entry point adds no behaviour
- `parity/ledger/wizard-debug.yaml:170` - Process lifetime belongs to the shell, which owns it in this port

### `ported` - Done; the note was stale and has been rewritten (26)

- `packages/core/src/game/cave-cmd.ts:36` - STALE. do_cmd_steal is game/steal.ts (installSteal registers "steal"), reachable on s / roguelike s via web/src/main.ts:4515 stealCmd. Grepping do_cmd_steal's port name, not the C name, is what showed it.
- `packages/core/src/game/mon-message.ts:15` - CLOSED by PORT_TODO 3.1 (2026-08-05). The queue is ported whole into this file - add_monster_message / _show_damage, stack_message with its saturating damage add, redundant_monster_message + store_monster, message_flags, what_delay, show_message and show_monster_messages - PN_MON_MESSAGE is the third PN bit, and noticeStuff drains it. 25 tests in game/mon-msg-queue.test.ts; 19 mutations, 19 kills. Remaining gap is narrower and recorded in 3.1: nothing binds state.panelContains, so the "(offscreen)" tag never appears.
- `packages/core/src/game/wizard.ts:68` - CORRECTED from real. The wiz-spoil.c generators ARE ported - spoilObjDesc / spoilArtifact / spoilMonDesc / spoilMonInfo (game/spoil.ts:255, :344, :453, :505) - and reachable through runSpoilers (web/src/wizard.ts:373, case "spoilers" at :874), which writes the file through the host seam. The remaining spoiler gaps are content lines, tracked at spoil.ts:93 / :518 / :519 / :550
- `packages/core/src/gen/gen-monster.ts:350` - LEAD READ, and CORRECTED from real. The note says spreadMonsters is "not wired to a builder yet (room_of_chambers/cavern callers are deferred)". It is wired, twice: gen/cave.ts:1721 (the lair, after setPitType/monRestrict) and gen/cave.ts:1865. room_of_chambers is built too, and its builder asserts true in gen/gen.test.ts:2175
- `packages/core/src/mon/lore-describe.ts:846` - LEAD READ, and CORRECTED from real. Both halves the note calls unavailable exist and are wired: chanceOfMeleeHitBase (combat/melee.ts:242) and hitChance (combat/hit.ts:60), joined at web/src/main.ts:3650 as meleeHitPercent: (race) => getHitChance(chanceOfMeleeHitBase(state.actor.combat, state.actor.weapon), race.ac). web/src/screens.test.ts:929 asserts the real percentage reaches the recall screen. The seam default of 0 survives only for callers with no player - the core spoiler dump, tracked at game/spoil.ts:518
- `packages/core/src/mon/lore-describe.ts:1299` - LEAD READ, and CORRECTED from real. Same: monsterHitPercent is wired at web/src/main.ts:3652 as getHitChance(max(race.level,1)*3 + effect.power, defense.ac + defense.toA), which is chance_of_monster_hit_base (combat/mon-melee.ts:191) against the player's live defensive state
- `packages/core/src/obj/object.ts:918` - STALE. object_is_equipped is ported (isEquipped, 15 non-comment sites) and there IS player gear.
- `packages/web/src/main.ts:5904` - CORRECTED from real. show_floor for multiple objects IS ported: showFloorList (web/src/overlay.ts:301), an overlay over screen_save, called at main.ts:5967
- `packages/web/src/main.ts:5925` - CORRECTED from real. Same: showFloorList exists and is called. My "0 showFloor sites" was a transliteration grep
- `parity/ledger/game-obj-list.yaml:45` - CORRECTED from real. object_list_format_name IS ported: objectListEntryName (game/obj-list.ts:289) passes the summed stack count through ODESC.ALTNUM exactly as upstream and gates the name by knowledge via describeObject. Only the terminal "%3.3s" padding of the upstream DRAW code stays with the shell, which is front-end-agnostic
- `parity/ledger/mon-timed.yaml:29` - CLOSED by PORT_TODO 3.1 (2026-08-05). mon_set_timed still reports through an optional MonTimedMessageSink because mon/ sits below game/, but the sink the game supplies IS add_monster_message(mon, m_note, true) (game/monster-turn.ts monsterTimedMessage), so the line is stacked on the delayed pass exactly as mon-timed.c:215 does it. This sink had no test at all until 3.1 - deleting its body broke nothing - and now has two.
- `parity/ledger/player-calcs-bonuses.yaml:78` - CLOSED by PORT_TODO 2.6 (2026-08-06). CalcBonusesOptions.knownOnly opens the five gates upstream puts behind known_only (object_flags_known 1933-1939, el_info 1985, to_a/to_h/to_d 1997/2001/2004; state->ac 1996 is deliberately not gated), the session derives p->known_state beside p->state on every refreshDerived and once at the end of wireGame, and prt_ac, the character sheet combat panel and buildLoreColorState read it. 16 mutations, 16 kills. The row's own example was wrong: player-birth.c:1264-1267 grants all three combat runes at birth, so the to_a/to_h/to_d gates never close - what known_state withholds is resists and object flags, which is why the visible change is the monster recall colouring.
- `parity/ledger/player-history.yaml:46` - STALE on its own premise. dump_history is in the character dump (web/src/charsheet.ts:504 calls historyLines under the "[Player history]" header), and character-dump-to-file exists - dumpCharacterFile, now through the host seam.
- `parity/ledger/player-history.yaml:79` - CORRECTED from real. Both hooks ARE wired: onArtifactFound (game/context.ts:687-693, installed by wireGame, called from pickup.ts playerPickupAux) and onArtifactLost (:695-701, the destroy / abandon / store-discard paths). The store-PURCHASE site is the part still missing, tracked at store/transact.ts:26
- `parity/ledger/store-price.yaml:21` - CORRECTED from real. store_init's runtime owner selection IS ported: storeChooseOwner (store/store.ts:100, rng.randint0 over store.owners) called at :116, :120 and :700. My "0 storeInit sites" was a transliteration grep
- `parity/ledger/ui-entry.yaml:136` - CORRECTED from real, same bullet as ledger row :135. The EQUIPCMP_SCREEN category IS iterated: equipCmpCategories (game/ui-entry.ts:1965) is called by equipCmpSummary (game/equip-cmp.ts:391), one column per entry across all five categories plus a combined row of matching length (game/equip-cmp.test.ts:116). show_combined = false on CHAR_SCREEN1 is upstream's own character-screen behaviour
- `parity/ledger/wizard-debug.yaml:14` - CORRECTED from real. The artifact-created registry EXISTS: ArtifactState (obj/make.ts:736) is aup_info[] with isCreated / mark, one instance per game, serialized as artifactsCreated (session/save.ts:976, :1200, :1346)
- `parity/ledger/wizard-debug.yaml:87` - CORRECTED from real. The shell follow-up exists: runTweakItem (web/src/wizard.ts:2043), reached from the play-item T branch at :1914, alongside runRerollItem and runCurseItem
- `parity/ledger/wizard-debug.yaml:112` - CORRECTED from real. dump_level IS ported: game/dump-level.ts with its own test (dump-level.test.ts), driven by runWriteMap (web/src/wizard.ts, case "write-map" at :878)
- `parity/ledger/wizard-debug.yaml:139` - CORRECTED from real. The wiz-spoil.c generators ARE ported (game/spoil.ts:255, :344, :453, :505) and wired through runSpoilers (web/src/wizard.ts:373). "Deferred entirely" has not been true for some time
- `parity/ledger/wizard-debug.yaml:144` - CORRECTED from real. The three Monte-Carlo collectors ARE ported and wired: runCollectObjMonStats / runCollectPitStats / runCollectDisconnectStats (web/src/wizard.ts, cases at :883, :886, :889)
- `parity/ledger/wizard-debug.yaml:147` - CORRECTED from real. The wiz-stats sampler IS ported: wizStatItem (game/wizard.ts) driven by runStatItem (web/src/wizard.ts)
- `parity/ledger/wizard-debug.yaml:154` - CORRECTED from real. Same as :164 - runChangeQuantity (web/src/wizard.ts) is reached from the play-item Q branch at :1921
- `parity/ledger/wizard-debug.yaml:164` - CORRECTED from real. do_cmd_wiz_change_item_quantity IS ported: runChangeQuantity (web/src/wizard.ts), reached from the play-item submenu's Q/q branch (wizard.ts:1921). My "0 changeItemQuantity sites" was a grep for a camelCase name the port never uses
- `parity/ledger/wizard-debug.yaml:166` - CORRECTED from real. The play_item shell IS ported: runPlayItem (web/src/wizard.ts), case "play-item" at :779, with upstream's full A/K/S/R/T/C/Q submenu at :1894-1923 and the core-side session snapshot/restore/commit (wizPlayItemBegin / Reject / Accept, game/wizard.ts:61-63)
- `parity/ledger/wizard-debug.yaml:167` - CORRECTED from real. Same: the play_item shell exists, so the quantity action does have somewhere to live

### `stale-doc` - The note described a state of the code that no longer holds (5)

- `packages/core/src/mon/lore-describe.ts:22` - LEAD READ. "The two hit-chance callbacks are the remaining integration seams for the combat layer (still default to 0 unwired)" is no longer true: web/src/main.ts:3650 and :3652 wire both, and web/src/screens.test.ts:929 asserts the real melee percentage reaches the recall screen. breathProjection is wired at main.ts:3659 too
- `packages/core/src/mon/lore-describe.ts:132` - The interface comment marks meleeHitPercent DEFERRED. It is not: web/src/main.ts:3650 supplies getHitChance(chanceOfMeleeHitBase(state.actor.combat, state.actor.weapon), race.ac). The 0 default survives only for callers with no player, which is the core spoiler dump (game/spoil.ts:518)
- `packages/core/src/mon/lore-describe.ts:138` - Same: monsterHitPercent is supplied at web/src/main.ts:3652 from chance_of_monster_hit_base against the player's live defence
- `packages/core/src/mon/lore-describe.ts:154` - breathProjection is supplied: web/src/main.ts:3659, (subtype) => projections?.[subtype]. Breath damage no longer shows as 0 in play
- `packages/core/src/obj/known-object.ts:160` - LEAD READ. The note says "the flavour TEXT (adjective / scroll title) remains unavailable". It is available: flavorInit is ported (obj/flavor.ts:111), AssignedFlavor carries flavor->text (flavor.ts:42), the assignment is installed by wireGame (game/describe.ts:26) and desc.ts:173 reads it through deps.flavorText. What remains is only the local approximation - kindHasFlavor tests the tval instead of consulting deps.hasFlavor - which the interface itself notes agrees in practice for every shipped kind (known-object.ts:121-124)

### `note-is-fix` - The wording sits inside a record of a FIX, not a gap (25)

- `packages/core/src/combat/mon-melee.ts:29` - The rewritten header: it records that all four formerly-listed items are ported and names the one that is not (mon/steal.ts:234)
- `packages/core/src/game/cave-cmd.ts:23` - The sentence records that player_best_digger IS now ported; "was deferred" is history, not a deferral.
- `packages/core/src/game/cave-cmd.ts:33` - Records that count_feats is NOW PORTED and that deferring it had been wrong; easy_open does not exist in 4.2.6.
- `packages/core/src/game/context.ts:824` - "exactly as when it was deferred" records that the curse tick is now installed by the session
- `packages/core/src/game/effect-teleport.ts:32` - The sentence says teleportMonster IS the backing that project-monster deferred - a record of the wiring, not a gap
- `packages/core/src/game/effect-terrain.ts:250` - Records a fixed crash (arena entry, out-of-bounds) and states that deferring to the caller's refresh is what upstream's flag does
- `packages/core/src/game/mon-group.ts:28` - The sentence records a CORRECTION to an earlier wrong claim about monster_can_see, not a deferral
- `packages/core/src/game/monster-turn.ts:24` - "NOW WIRED (was deferred)" is a record of the fix
- `packages/core/src/game/obj-cmd.ts:1736` - Records that the port routes this through combine_pack, which is what happens - a design record, not a gap
- `packages/core/src/game/player-path.ts:28` - "are wired (W2-003 navigate-up/down, explore, pathfind)" records the fix
- `packages/core/src/game/ranged-cmd.ts:24` - The sentence explicitly says the item "had been listed here as deferred, which is" wrong - a correction
- `packages/core/src/game/take-hit-hooks.ts:23` - Records that the port deliberately mirrors upstream's close_game ordering, and names where it happens
- `packages/core/src/obj/make.ts:1235` - Explains why the current behaviour matches upstream at a site that was once a stub
- `packages/core/src/store/store.ts:156` - This line IS the expansion the other notes call deferred
- `packages/core/src/store/transact.ts:13` - The header's LIVE list records that both sides of the rune learn loop are now wired, and says the DEFERRED label is what made the asymmetry read as intentional
- `packages/core/src/store/transact.ts:24` - The sentence records the fix and why the stale label was harmful
- `packages/web/src/main.ts:8410` - Records the state of things before updateFov was wired
- `parity/ledger/combat-melee.yaml:91` - The comment recording that this list was adjudicated and that ten of its eleven entries had stopped being true
- `parity/ledger/game-effect-melee.yaml:44` - "Every formerly-deferred handler is now DONE"
- `parity/ledger/game-effect-teleport.yaml:37` - Records that teleportMonster is the backing for the hook
- `parity/ledger/game-monster-ai.yaml:40` - "NOW WIRED (were deferred)"
- `parity/ledger/obj-desc.yaml:44` - The sentence names objectKnownShadow as the replacement - the divergence, recorded
- `parity/ledger/obj-ignore.yaml:84` - Records that the menu-edit / 'K' trigger of PN_IGNORE IS reproduced directly. The separate become-aware trigger is the gap tracked at game/context.ts:296
- `parity/ledger/options.yaml:31` - Records that the options store replaced the scattered per-seam defaults
- `parity/ledger/store-bind.yaml:55` - Describes the bookseller's data shape, which the expansion at store.ts:173 consumes

### `not-a-deferral` - Ordinary English, not a parity claim (27)

- `packages/core/src/game/cave-cmd.ts:951` - Describes the fallback when the traps module is absent, not a missing feature; trap.ts registers the real disarm and session/game.ts:1698 supplies trapDeps
- `packages/core/src/game/context.ts:333` - Prose about why the options store is optional, and it states the fallback is exact; no feature is claimed absent
- `packages/core/src/game/pickup.ts:16` - Describes the behaviour when the module is not installed; installPickup replaces the stub and is called in the live composition
- `packages/core/src/player/options.ts:28` - Describes how seams read the store, and states the fallback is exact
- `packages/core/src/session/game.ts:898` - A note about JavaScript declaration order, not a parity claim
- `packages/core/src/session/game.ts:2976` - A note about the mod event flood, not a parity claim
- `packages/web/src/charselect.ts:130` - Describes the shell's own command hook, not a parity claim
- `packages/web/src/main.ts:3605` - Records that a utility is deliberately unbound; nothing upstream is missing
- `packages/web/src/main.ts:8349` - A setTimeout, chosen because the fault surfaces inside core
- `packages/web/src/mod-browse.ts:1057` - A variable named `todo`
- `packages/web/src/mod-browse.ts:1059` - A variable named `todo`
- `packages/web/src/mod-catalogue.ts:449` - A variable named `todo`
- `packages/web/src/mod-catalogue.ts:450` - A variable named `todo`
- `packages/web/src/mod-code.ts:207` - "rather than deferring to it" is about which layer reports a mod error
- `packages/web/src/mod-taint.ts:64` - "must defer" is about deferring to a tick, not a parity claim
- `packages/web/src/mod-zip-source.ts:129` - A one-tick setTimeout around a Chrome focus/change ordering quirk
- `packages/web/src/pwa.ts:29` - The beforeinstallprompt event, which is literally called a deferred prompt
- `packages/web/src/pwa.ts:51` - Same event
- `packages/web/src/userdir.ts:222` - A one-tick setTimeout around the same Chrome quirk
- `packages/cli/src/host-node.ts:50` - Quotes init.c's own "ToDo" comment as evidence about upstream
- `packages/desktop/src/main.ts:1133` - A variable named `todo`
- `packages/desktop/src/main.ts:1135` - A comment about that variable
- `packages/desktop/src/main.ts:1142` - Same variable
- `packages/desktop/src/main.ts:1146` - Same variable
- `packages/desktop/src/main.ts:1191` - Same variable
- `packages/mod-sdk/src/sort.ts:216` - A mod-conflict reason string: one mod "defers to" another
- `parity/ledger/gamedata.yaml:5` - A structural comment about the document layout

<!-- END GENERATED -->
