# Every item that still needs porting

**Dated 2026-08-04.** The work list derived from [DEFERRALS.md](DEFERRALS.md),
which is the accounting of what was found and how each verdict was reached.
This one is the checklist: **60 items covering all 79 confirmed-absent
citations**, ordered so the things a player would notice come before the things
only a developer sees, and so the two items that unlock a dozen others come
first of all.

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
> `ported` rose from 3 to 19. **Tier 0.2 below is the unfinished half of that
> sweep** — 21 rows still have an unread lead, so this list is not yet clean.

A citation here is a `file:line` from `parity/reports/deferral-census.tsv` whose
verdict is `real` or `partial`. A `divergence`, `n-a` or `note-is-fix` row is not
work, and its reason is in DEFERRALS.md's appendix.

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

- [ ] **0.1 Adjudicate the ledger `deferred:` items. 34 of 331 done.**
  `parity/reports/ledger-deferred-items.tsv` holds items the keyword census
  structurally could not see: an entry under a `deferred:` key inherits meaning
  from the key and mostly does not repeat the word. The 34 adjudicated so far
  (`ui-display.yaml`, `ui-player.yaml`) produced **9 real rows, 7 of them new**,
  and are folded into Tier 3 below. **297 remain.** Adjudicate with
  `node parity/tools/deferral-verdict.mjs --target parity/reports/ledger-deferred-items.tsv`,
  reading order from
  `node parity/tools/deferral-triage.mjs --target parity/reports/ledger-deferred-items.tsv --hint likely-real`
  (46 likely-real, 76 mixed, 64 no-symbol, 145 likely-stale). Then bring the
  scanner under the ratchet the way the census already is.
  Sites: `parity/reports/ledger-deferred-items.tsv`

- [ ] **0.2 Read the 21 remaining cross-check leads.**
  `node parity/tools/deferral-crosscheck.mjs --verdict real` lists every `real`
  row whose C symbol the port mentions somewhere else. Twelve have been read and
  seven of those overturned. The unread ones include `monster_x_attr` appearing
  in `packages/core/src/visuals/engine.ts:400`, `room_of_chambers` building
  successfully under test (`gen.test.ts:2175`), and `do_cmd_alter` in
  `packages/web/src/context-menu.ts`. **Until this is done, assume roughly a
  quarter of the items below are already built.**
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

- [ ] **1.2 Feed the combat layer into lore.**
  `hitChance` is ported (`packages/core/src/combat/hit.ts:60`) with
  `chanceOfMeleeHitBase` / `chanceOfMonsterHitBase` beside it; lore never
  receives them, so every computed percentage in monster recall is missing along
  with the spoilers' hit-chance lines. One seam fixes **3.3**, **3.4** and half
  of **5.6**. Monster spells also need binding to the casting race.
  Sites: `packages/core/src/mon/lore-describe.ts:22`

## Tier 2 — It changes what happens in play

- [ ] **2.1 `square_isempty` is weaker than upstream's.**
  `cave-square.c:604-608` rejects a player trap, a web and any object; the port
  checks only passable / no monster / not the player, **at 48 call sites**.
  Placement loops accept grids upstream rejects, which moves RNG draws — so this
  can shift a whole level's generation. Fix the predicate, then check the 48
  sites for any that wanted the weaker test. Wants a test constructing the three
  rejecting cases, not asserting today's answer.
  Sites: `packages/core/src/game/context.ts:1088`

- [ ] **2.2 Monster-vs-monster theft ignores `react_to_slay`.**
  `mon-util.c:1548`. The player's own pack is protected correctly
  (`packages/core/src/game/mon-side.ts:421`), so this is an asymmetry:
  `reactToSlay` is exported at `packages/core/src/combat/brand-slay.ts:121`,
  `state.slays` is available at the caller, and the condition sits there
  commented out.
  Sites: `packages/core/src/mon/steal.ts:32`, `:33`, `:231`, `:234`

- [ ] **2.3 `alter` (`+`) has no chest branch and no floor-trap branch.**
  `do_cmd_alter_aux` (`cmd-cave.c:969-992`). The note excused this because alter
  was unbound; the shell has bound it since
  (`packages/web/src/main.ts:8090` → `alterCmd`), which makes the gap reachable.
  *Cross-check lead unread: `do_cmd_alter` is named in
  `packages/web/src/context-menu.ts`.*
  Sites: `packages/core/src/game/cave-cmd.ts:1045`

- [ ] **2.4 The chest `OF_TRAP_IMMUNE` rune is never learned.**
  Two copies of the same empty branch.
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

- [ ] **2.9 `list_object` / `delist_object` oidx bookkeeping.**
  No object oidx registry (`game/known.ts:647`, `game/mon-place.ts:264`).
  `pushObject` itself is ported and called; what remains is the known-object
  shadow cave, the oidx bookkeeping and mimicked-object handling.
  Sites: `packages/core/src/game/mon-place.ts:267`, `:328`,
  `packages/core/src/game/floor.ts:18`

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

- [ ] **2.16 Autoinscription on store purchase, and the artifact history entry.**
  The autoinscription registry exists (`packages/core/src/game/context.ts:254`)
  and the purchase path does not apply it. `history_find_artifact` is wired
  everywhere else (`context.ts:687`, installed by `wireGame`) — the store
  purchase site (`store.c:1928`) is the one that is not.
  Sites: `packages/core/src/store/transact.ts:26`

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

- [ ] **3.3 Monster recall has no computed percentages.** *(needs 1.2)*
  No hit-chance line for either blow field, no breath default damage, and the
  same holes in web recall and ego-item recall.
  Sites: `packages/core/src/mon/lore-describe.ts:22`, `:132`, `:138`, `:154`,
  `:846`, `:1299`, `packages/web/src/knowledge.ts:1095`, `:1185`

- [ ] **3.4 Monster spells are not bound to the casting race.** *(needs 1.2)*
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
  Same call sites: `timedElementEffect` defaults to `() => 0`
  (`game/ui-entry.ts:1347`), so a temporary resist is not shown at all — a
  stronger gap than the "mark it as temporary" one below. `timedObjectFlags`
  defaults to empty except `OF_TRAP_IMMUNE`.
  Sites: `parity/ledger/ui-entry.yaml:120`, `:124`

- [ ] **3.8 `player_flags_timed`'s separate UI cache.**
  The gameplay half is ported — `packages/core/src/player/calcs.ts:1094-1104`
  folds each active timed effect's `oflagDup` into `state.flags`. Missing is
  `ui-entry.c:928`'s separate timed cache, which is what lets the sheet mark a
  flag as temporary rather than permanent.
  Sites: `packages/core/src/game/ui-entry.ts:26`

- [ ] **3.9 The character sheet's launcher contribution is 0.**
  The launcher-slot reach plus `KF_SHOOTS_ARROWS` is absent, so the entry
  contributes nothing where upstream contributes the launcher's value; `launcher`
  also defaults to `null` at `game/char-sheet.ts:201` with no supplier. The
  `show_combined` path and `EQUIPCMP_SCREEN` iteration are the same family:
  compiled and bound, never iterated. `PF_FAST_SHOT` needs the same reach.
  Sites: `packages/core/src/game/ui-entry.ts:1392`,
  `parity/ledger/ui-entry.yaml:133`, `:136`, `parity/ledger/ui-player.yaml:108`,
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

- [ ] **3.22 `monster_x_char` / `monster_x_attr`'s secondary glyph.**
  *Cross-check lead unread: the primary glyph IS modelled
  (`packages/core/src/visuals/engine.ts:400`,
  `packages/core/src/agent/types.ts:432`), so scope this to the secondary before
  starting.*
  Sites: `packages/core/src/mon/lore-describe.ts:1348`

- [ ] **3.23 The flavour text shadow field.**
  The adjective / scroll-title shadow field; flavour naming itself is ported
  (`packages/core/src/obj/flavor.ts`), so this is narrow.
  Sites: `packages/core/src/obj/known-object.ts:160`

- [ ] **3.24 Per-category priority overrides are not reconstructable.**
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

- [ ] **4.4 Give `room_of_chambers` a caller.**
  Re-scoped: the builder **works** — `gen.test.ts:2175` builds it, asserts
  `true`, and checks the chambers are connected and themed. What is unproven is
  whether any dungeon profile's room list reaches it in play. Check the profiles
  before writing anything.
  Sites: `packages/core/src/gen/gen-monster.ts:350`

## Tier 5 — History, notes, files and logs

- [ ] **5.1 Find-on-sight history entries.**
  Blocked on remembered floor-pile contents — the same known-cave question as
  2.9.
  Sites: `parity/ledger/player-history.yaml:75`

- [ ] **5.2 The player notes command.**
  Sites: `parity/ledger/player-history.yaml:91`

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

- [ ] **5.6 The spoiler files' missing lines.** *(`:518`, `:519` need 1.2)*
  The generators and their menu are **done** (`runSpoilers`, `game/spoil.ts`).
  What is missing is content: `timedDesc` / `summonDesc` are unwired so some
  activation descriptions read worse than upstream's; the hit-chance lines are
  the lore gap; and `loreDescription` has no upstream-style spoiler flag.
  Sites: `packages/core/src/game/spoil.ts:93`, `:518`, `:519`, `:550`

- [ ] **5.7 The randart generator's `property` branch.**
  Needs the timed-effects failure tables.
  Sites: `packages/core/src/obj/randart-build.ts:38`

- [ ] **5.8 `history_lose_artifact`'s store-sale site.**
  Folded into 2.16 for the purchase half; the sale half rides
  `store_delete_random` / `store_maint`.
  Sites: `parity/ledger/store-maint.yaml:34`

## Tier 6 — Closed

Every wizard-mode row is now `ported`. See the correction at the top of this
file: `runPlayItem` with upstream's full submenu, `runChangeQuantity`,
`runWriteMap` over `game/dump-level.ts`, `runCollectObjMonStats` /
`runCollectPitStats` / `runCollectDisconnectStats`, `runStatItem` over
`wizStatItem`, `runTweakItem` / `runRerollItem` / `runCurseItem`, `runSpoilers`
over the four `spoil*` generators, and `ArtifactState` (`obj/make.ts:736`) as
`aup_info[]` serialized in the save. The one thing that looked like a wizard gap
and is not is the ENTER command browser, now **3.18**.

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
2. the counts stated at the top (**60 items, 79 citations, 68 `real` + 11
   `partial`**) disagree with the census — so a new `real` row in a file that
   already appears cannot hide inside an existing item;
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
