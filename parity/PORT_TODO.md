# Every item that still needs porting

The work list derived from [DEFERRALS.md](DEFERRALS.md), which is the
accounting of what was found and how each verdict was reached. This is the
checklist: closed items are the record of what has been fixed, and the
[Known remaining gaps](#known-remaining-gaps) section below names what is
still open.

**68 items covering all 13 confirmed-absent citations**, and all 68 are closed.
Restated for the record the test in `packages/cli/src/port-todo.test.ts`
checks: **68 items, 13 citations, 5 `real` + 8 `partial`**. All thirteen
citations live in the ledger tranche (`parity/reports/ledger-deferred-items.tsv`);
the keyword census (`parity/reports/deferral-census.tsv`) carries none open.
Two of the 68 (0.1, 0.2) adjudicate the list itself rather than porting
anything; the other 66 are ported, retracted (the citation named a gap that
turned out not to exist), or marked unreachable in upstream.

A citation is a `file:line` from `parity/reports/deferral-census.tsv` or
`parity/reports/ledger-deferred-items.tsv` whose verdict is `real` or
`partial`. A `divergence`, `n-a` or `note-is-fix` row is not owed work; see
[DIVERGENCES.md](DIVERGENCES.md) and DEFERRALS.md's appendix for why.

## What "tiered" means here

| Tier | Test for membership |
|---|---|
| **0** | The list cannot be trusted until this is done |
| **1** | Unlocks other tiers; doing it later means doing downstream items twice |
| **2** | Changes what *happens*: mechanics, and in one case RNG draw order |
| **3** | Changes what the player is *told*: the numbers and text on screen |
| **4** | A whole mode nobody had begun |
| **5** | History, files and logs |
| **6** | Wizard mode, closed |
| **7** | Items originally filed as "a decision to take, not code to write", closed once measured |

A tick means the behaviour is reachable in play and a test constructs the
case that used to be wrong, not merely that the function exists.

---

## Tier 0: Made the list trustworthy

- [x] **0.1 The ledger `deferred:` items are fully adjudicated.** All 343
  rows across 73 files in `parity/reports/ledger-deferred-items.tsv` have a
  verdict.
- [x] **0.2 The cross-check leads are fully read.** All 21 leads from
  `parity/tools/deferral-crosscheck.mjs` are marked read; 8 overturned a
  stale verdict.

## Tier 1: Foundations that unlocked other rows

- [x] **1.1 `notice_stuff` / `PN_*` notice pipeline.** Ported.
  `PlayerUpkeep.notice` is a real bitfield (`packages/core/src/player/player.ts:33`)
  and `noticeStuff` (`packages/core/src/game/notice.ts`) drains `PN.COMBINE`,
  `PN.IGNORE` and `PN.MON_MESSAGE` at all fifteen upstream call sites.
  Unlocked **2.5** and **3.1**.
  Sites: `packages/core/src/game/context.ts:297`, `packages/core/src/game/notice.ts`

- [x] **1.2 Nothing summed the player's carried weight.** Ported.
  `player.upkeep.totalWeight` is a running total maintained at the four
  upstream choke points in `packages/core/src/game/gear.ts`, with a load-time
  migration for saves from before this fix. Restores the carrying-weight
  speed penalty, shield-bash quality, and the character sheet's Burden line.
  Sites: `packages/core/src/game/gear.ts`, `packages/core/src/game/gear-weight.test.ts`

- [x] **1.3 Monster housekeeping ran on the wrong cadence.** Ported.
  `processPlayerCleanup` (`packages/core/src/game/player-turn.ts`) clears
  `MFLAG_NICE`/`MFLAG_MARK`/`MFLAG_SHOW` and `upkeep.dropping` after every
  player command instead of every ten game turns.
  Sites: `packages/core/src/game/loop.ts:361`, `packages/core/src/game/known.ts:977`

## Tier 2: Changes what happens in play

- [x] **2.1 `square_isempty` was weaker than upstream's.** Ported. The weak
  `context.ts` definition (missing the player trap, web and object checks) is
  deleted; all seven call sites use the strict predicate already faithful in
  `gen/util.ts` / `mon-place.ts`.
  Sites: `packages/core/src/game/context.ts:1088`

- [x] **2.2 Monster-vs-monster theft ignored `react_to_slay`.** Ported.
  `mon/steal.ts` calls `reactToSlay` via a required `thief` argument, so a
  slay-bearing item resists theft from any monster.
  Sites: `packages/core/src/mon/steal.ts:32`

- [x] **2.3 `alter` (`+`) was missing four branches and its fall-through was free.**
  Ported. The floor-trap disarm, trapped chest, closed chest and open-door
  branches are implemented, and the fall-through now always spends energy,
  matching upstream's anti-free-detection rule.
  Sites: `packages/core/src/game/cave-cmd.ts:1045`

- [x] **2.4 The chest `OF_TRAP_IMMUNE` rune was never learned.** Ported. Both
  branches previously read an env hook nothing supplied; the predicate is
  now answered from state, so it is reachable and the rune is learned.
  Sites: `packages/core/src/game/chest.ts:268`

- [x] **2.5 The `PN_IGNORE` notice pass never ran.** Ported (with **1.1**).
  Becoming aware of a kind now drops newly-ignored items; `ignoreDrop` moved
  from shell-only to core.
  Sites: `packages/core/src/game/context.ts:297`, `packages/core/src/session/game.ts:542`

- [x] **2.6 `known_only` did not exist.** Ported. `CalcBonusesOptions.knownOnly`
  gates object flags, resistances and to-a/to-h/to-d exactly as upstream's
  `known_state`; the monster-recall danger colouring now reads the known
  state instead of the real one.
  Sites: `packages/core/src/player/calcs.ts:634`, `packages/core/src/obj/known-object.ts:762`

- [x] **2.7 `pile_insert_end` had no port counterpart.** Ported. `wieldAll`
  collects split remainders into a temporary pile and appends it reversed,
  matching upstream's order; the floor's prepend and the pack's append are
  each pinned directly.
  Sites: `packages/core/src/game/gear.ts`

- [x] **2.8 `path_analyse` was absent.** Ported. A remembered wall between the
  player and a warm-blooded monster sensed by infravision is now
  un-remembered, matching upstream's LOS correction.
  Sites: `packages/core/src/game/known.ts:750`

- [x] **2.9 The known-object shadow cave had one memory per grid, not per object.**
  Ported. The player's memory of a grid's floor is a per-object pile
  (`KnownObject = { obj, sensed }`), fixing a knowledge leak in the `[`
  object list, a missing `<pile>` glyph, and ignore hiding an entire pile
  instead of just the ignored entries. Save format moved `SAVE_VERSION` 3→4
  with a migration for older saves.
  Sites: `packages/core/src/game/known.ts:131`, `packages/core/src/session/save.ts:1187`

- [x] **2.10 `object_flag_is_known` was missing at the store buy sites (with 5.8).**
  Ported. `storeWillBuy` takes the bound predicate as a required argument,
  closing the gate that let a store buy an item on a rune the player had
  never learned.
  Sites: `packages/core/src/store/store.ts:232`

- [x] **2.11 The `OSTACK_LIST` stacking checks.** Unreachable in upstream: no
  4.2.6 caller ever passes `OSTACK_LIST`. A ratchet test fails if any port
  code ever does.
  Sites: `packages/core/src/obj/object.ts:923`

- [x] **2.12 `cmd_disable_repeat_floor_item` had no port.** Ported.
  `repeat_prev_allowed` lives on `player.upkeep`; all eleven upstream disable
  sites are wired, including the floor case, which is an index that
  re-binds (rather than dangles, as upstream's pointer would) when the pile
  underneath it changes.
  Sites: `packages/core/src/game/cave-cmd.ts`, `parity/ledger/cmd-core.yaml:25`

- [x] **2.13 `EF_TOUCH`'s monster-source branches.** Already built at
  `handleTOUCH` (`packages/core/src/game/effect-attack.ts`); the citation had
  pointed at an unrelated function. Tests added, since none existed.
  Sites: `packages/core/src/game/project-cast.ts:685`

- [x] **2.14 Mimic bookkeeping had two unported arms.** Ported. `pushMimic`
  reproduces the scatter-and-relink (or destroy-both) rule when an object is
  created on a mimic's grid, and `deleteMonster`'s seventeen non-death
  removal paths now drop the mimicked object.
  Sites: `packages/core/src/game/project-feat.ts:96`, `packages/core/src/game/context.ts:1266`

- [x] **2.15 The book out-of-depth value boost.** The boost itself was
  already ported; the real gap was that player-dependent generation foils
  (`canBrowseBook`, `timedFoil`, `noSelling`) reached the store paths but not
  level generation. `GenObjectFoils` is now a required parameter, fixing the
  book-rejection, curse-foil and gold-inflation rolls during generation.
  Sites: `packages/core/src/obj/make.ts:1238`

- [x] **2.16 `history_find_artifact` on a store purchase.** Unreachable in
  upstream: `do_cmd_buy` makes no history call of any kind; the only call
  upstream makes is on the sell path, which is wired.
  Sites: `packages/core/src/store/transact.ts:26`

- [x] **2.17 Twelve of upstream's 53 `disturb()` sites had no port.** Ported.
  All twelve are wired, including the player's own melee, a monster's blow,
  the known-trap/DTrap run stops, and the object-feeling reveal event, which
  had test subscribers but no production ones.
  Sites: `parity/ledger/game-player-path.yaml:94`, `packages/core/src/game/disturb-census.test.ts`

- [x] **2.18 A commanded monster could not drop what it was carrying.** Ported.
  `commandedDrop` reproduces the upstream branch over the existing held-pile
  machinery.
  Sites: `packages/core/src/game/mon-cmd.ts:583`

- [x] **2.19 A commanded monster's blow.** Mostly already correct: the
  status-effect and poison behaviour matched upstream, including upstream's
  own dead teleport-tail code. Two real defects fixed: `SMASH_WALL` no
  longer shares `KILL_WALL`'s body, and both door-bash branches now clear
  the lock.
  Sites: `packages/core/src/game/cave-square.ts:1`, `packages/core/src/game/mon-cmd.ts:604`

- [x] **2.20 `do_cmd_wiz_play_item` skipped two of its four commit steps.**
  Ported. The wizard item editor now re-accounts carried weight and runs
  `object_touch` unconditionally, alongside the pre-existing equip-only
  wield-learn step.
  Sites: `packages/core/src/game/wizard.ts:1551`

- [x] **2.21 Two `mon_take_hit` branches no production caller could reach.**
  Ported. `coverTracksBroken` and `primaryGroupSize` are derived from live
  state in one place (`gameTakeHitHooks`) and wired at all four call sites,
  instead of being optional fields with no supplier.
  Sites: `packages/core/src/game/context.ts:1322`, `packages/core/src/mon/take-hit.ts:180`

## Tier 3: Changes what the player is told

- [x] **3.1 `add_monster_message` had no queue.** Ported.
  `packages/core/src/game/mon-message.ts` implements the batching, stacking
  and grammar; `PN_MON_MESSAGE` is the third `PN` bit, drained by `noticeStuff`.
  Sites: `packages/core/src/game/mon-message.ts`

- [x] **3.2 The killer's name was a bare race name.** Ported. Both death
  sites and the monster-projection death cause use
  `monsterDesc(mon, MDESC_DIED_FROM)` instead of the race name.
  Sites: `packages/core/src/game/effect-attack.ts:694`, `packages/core/src/game/project-cast.ts:136`

- [x] **3.3 Object and ego recall showed no computed lines.** Ported.
  `objectInfoEgo` / `describeEgo` (new `packages/core/src/obj/fake-object.ts`)
  print the blows/damage/digging/flag lines and the ego's granted-ability
  text; the unaware-flavoured-kind early return is handled too.
  Sites: `packages/core/src/obj/fake-object.ts`

- [x] **3.4 Monster spell and breath damage looked unbound from the casting
  race.** Not a gap. The default lore-damage path (`monSpellNonhpDamage`,
  `breathDam`) needs no override and has been wired since the recall viewer
  was built.
  Sites: `parity/ledger/mon-lore-describe.yaml:55`

- [x] **3.5 The sidebar's stat rows ignored equipment.** Ported. `statUse`
  now defaults from the live `calc_bonuses` result instead of race+class,
  matching the character sheet.
  Sites: `packages/core/src/game/display.ts:417`

- [x] **3.6 No `PF_*` intrinsic ability ever appeared on the character sheet.**
  Ported. `liveUiEntryDeps` supplies the live `pflags` at all four screen
  call sites.
  Sites: `packages/core/src/game/ui-entry.ts`

- [x] **3.7 Temporary resists never appeared in the resist grid (with 3.8).**
  Ported as one wiring fix; see **3.8**.
  Sites: `packages/core/src/game/ui-entry.ts:26`

- [x] **3.8 The timed-flag column read empty.** Ported. `liveTimedUiDeps` /
  `liveUiEntryDeps` supply the `timedElementEffect` and `timedObjectFlags`
  seams, both already-ported functions with no caller, at all four screen
  sites, with the `TMD_TRAPSAFE` split preserved.
  Sites: `packages/core/src/game/ui-entry.ts:26`

- [x] **3.9 The character sheet's launcher contribution was 0.** Ported,
  both halves: `UiEntryDeps.launcher` and the char-sheet's own launcher seam
  are both derived from the equipped bow/sling, fixing "Shoot to-dam" and
  ranged to-hit.
  Sites: `packages/core/src/game/ui-entry.ts:1489`

- [x] **3.10 `prt_moves` showed nothing.** Ported. Derived from
  `state.playerState.numMoves`.
  Sites: `packages/core/src/game/display.ts:212`

- [x] **3.11 `prt_state`'s repeat branch could never fire.** Ported. Reads
  `state.cmdQueue[0].repeatRemaining` instead of the unwired
  `CommandQueue.getNRepeats`.
  Sites: `packages/core/src/game/display.ts:220`

- [x] **3.12 The wizard and winner markers never showed.** Ported, on both
  the sidebar and the character sheet, derived from `state.wizard` and
  `player.totalWinner`.
  Sites: `packages/core/src/game/display.ts:222`, `packages/core/src/game/char-sheet.ts:210`

- [x] **3.13 The sheet's Resting line always read 0.** Ported. The lifetime
  resting-turn counter is now bumped alongside the per-rest counter, and the
  sheet reads it.
  Sites: `packages/web/src/main.ts:4962`

- [x] **3.14 The object glyph ignored flavour awareness.** Ported.
  `useFlavorGlyph` (`packages/core/src/visuals/object-glyph.ts`) is the
  single implementation of upstream's rule, including the scroll exception,
  used by all five draw sites that each previously had it wrong in a
  different way.
  Sites: `packages/core/src/visuals/object-glyph.ts:45`

- [x] **3.15 `feeling-need` was hardcoded.** Ported. The status-line `LF:`
  indicator now receives `constants.feelingNeed` like the other caller,
  sourced from `SHIPPED_FEELING_NEED` and checked against the shipped data
  file.
  Sites: `packages/core/src/constants.ts:159`

- [x] **3.16 The knowledge browser's thematic grouping columns.** Ported.
  The monster knowledge screen now goes through the shared
  `runGroupedBrowser` instead of a bespoke renderer, gaining the Group
  label, row divider, column width and `purple_uniques` colouring.
  Sites: `packages/web/src/knowledge.ts:1442`

- [x] **3.17 `update_sidebar`'s priority culling and from-bottom placement.**
  Ported. `SIDE_HANDLERS` and `sidebarLayout(termRows)` implement the
  priority table and from-bottom placement in core, replacing a shell-side
  implementation that dropped depth, speed and the health bar first instead
  of last on a small screen.
  Sites: `packages/core/src/game/display.ts:627`

- [x] **3.18 The ENTER command browser did not exist, for any command list.**
  Ported, including the nested wizard-debug tier. `buildCommandTable()` is
  the shared, module-level `cmds_all`; the browser
  (`packages/web/src/command-menu.ts`) mirrors
  `textui_action_menu_choose`/`cmd_menu`.
  Sites: `packages/web/src/command-menu.ts:1`

- [x] **3.19 The birth screens answered help with a no-op.** Ported.
  `openBirthHelp` opens the existing help browser and restores the stage's
  key listener and touch handler afterward.
  Sites: `packages/web/src/birth.ts:1115`

- [x] **3.20 Temporary brands and slays were not shown in object info.**
  Ported. `collectTotalBrandsSlays` reads the same bound
  `GameState.tempBrandSlay` the melee hooks use, instead of a private copy.
  Sites: `packages/core/src/obj/object-info.ts:974`

- [x] **3.21 The shape-lore textblock chain was missing its tail.** Ported.
  The two missing sections (`changeEffectText`, `triggeringSpells`) are
  supplied via `makeShapeLoreEnv` (`packages/core/src/game/shape-inspect.ts`);
  a separate stat-line bug (empty property names) is fixed by sharing one
  `lookupObjPropertyIn` implementation.
  Sites: `packages/core/src/game/shape-inspect.ts`

- [x] **3.22 The lore title did not recolour a unique with `purple_uniques`.**
  Ported. `LoreDeps.purpleUniques` is required and shared with the map
  glyph's own naming.
  Sites: `packages/core/src/mon/lore-describe.ts:1359`

- [x] **3.23 Rune-learning messages still used the `ODESC_BASE` stand-in.**
  Ported, for the six rune/flag/curse messages and the `{name}`/`{kind}`
  custom-message pair; `kindHasFlavor` reads the live seam with the tval
  test as fallback.
  Sites: `packages/core/src/obj/known-object.ts:167`

- [x] **3.24 `equip_learn_flag` had no shape branch.** Ported, for the three
  neighbouring functions that actually needed it
  (`equip_learn_on_defend`/`_on_ranged_attack`/`_on_melee_attack`), which now
  consult the bound shape's own to-a/to-h/to-dam when no worn item teaches
  the rune first.
  Sites: `packages/core/src/obj/knowledge.ts:693`

- [x] **3.25 Per-category priority overrides were not reconstructable.**
  Ported. `priority` is `childOf: ["category"]` in the content-spec
  compiler, matching upstream's override-vs-default branch (unused by any
  shipped data file today).
  Sites: `packages/content/src/specs/ui-entry.ts:52`

- [x] **3.26 Teleporting was silent.** Ported. All eleven missing sound
  and message pairs are wired via a shared `msgt` helper
  (`packages/core/src/msg.ts`), replacing thirteen hand-spelled call sites
  that had drifted out of sync.
  Sites: `packages/core/src/msg.ts`

- [x] **3.27 The `{tried}` and `{ignore}` name markers never appeared.**
  Ported. `knownDescOf` now reads the already-live `FlavorKnowledge` /
  `isIgnored` state; both markers appear and suppress correctly.
  Sites: `parity/ledger/obj-desc.yaml:65`

## Tier 4: Whole modes nobody had begun

- [x] **4.1 Arena mode.** Ported. Fixed the three of 29 `arena_level` sites
  that were missing an arena guard: `EF_TELEPORT`, `EF_ALTER_REALITY`, and
  the pre-arena level's persistence across a save/reload.
  Sites: `packages/core/src/game/effect-teleport.ts`, `parity/ledger/game-arena.yaml`

- [x] **4.2 The quest system.** Ported. Fixed five gaps: the runtime
  trap-door guard on quest levels, `player_set_recall_depth`, `on_new_level`'s
  dual assignment of `max_depth`/`recall_depth`, the `birth_no_recall` guard
  on `EF_RECALL`, and the quest-restore order on load.
  Sites: `packages/core/src/game/quest.ts`, `packages/core/src/game/effect-general.ts`

- [x] **4.3 Persistent levels, and the town builder's full store generation.**
  Ported. Fixed `get_min_level_size` (previously unproduced, causing
  generation aborts on some seeds), `lair_gen`'s persistent-level split, the
  `build_colors` stairs-per-region map, `EF_CREATE_STAIRS`'s
  `birth_levels_persist` refusal and check order, and the starting level's
  connector joins being discarded at boot.
  Sites: `packages/core/src/gen/generate.ts`, `packages/core/src/gen/cave.ts`

## Tier 5: History, files and logs

- [x] **5.2 The player notes command.** Already built (`noteCmd`,
  `packages/web/src/main.ts:4547`); the absence claim rested on a
  literal-C-name grep that missed the port's `HIST.USER_INPUT` spelling.
  Sites: `parity/ledger/player-history.yaml:91`

- [x] **5.3 `options_save_custom` / `restore_custom` / `restore_maintainer`.**
  Ported, both the file-format half and the read-side wiring (birth-stage
  defaults, the '=' editor). Also fixed the parser error limit (20, not 0)
  and the per-page reset-key gating.
  Sites: `packages/core/src/player/options-file.ts`

- [x] **5.4 `RANDNAME_TOLKIEN` is not loaded.** Already loaded via
  `randnameMake`/`names.json`; a missing wiring test (the corpus reaching
  `doRandart` in a real boot) is added.
  Sites: `packages/core/src/session/boot.ts:163`

- [x] **5.5 `randart.log` / `randart.txt`.** Ported: all 252 sites written
  across `obj-power.c` (59) and `obj-randart.c` (193). Fixed a live RNG-stream
  divergence found in the process: `artifactPower`'s curse-timeout rolls were
  skipped during generation, so randart sets differed from upstream's from
  the first cursed artifact onward. A saved randart character regenerates to
  the correct set on load.
  Sites: `packages/core/src/obj/randart-log.ts`, `packages/core/src/obj/randart.ts`

- [x] **5.6 The spoiler files' missing lines.** Ported for the
  `loreDescription` gate (title/kills/toughness/experience sections) and the
  melee hit-chance lines; the `timedDesc`/`summonDesc` seams are retracted
  as inert (no shipped item's spoiler text resolves through them).
  Sites: `packages/core/src/game/spoil.ts:93`

- [x] **5.7 The randart generator's `property` branch.** Already wired end
  to end (`buildCurseTimedFoil`, both `swapRandartSet` call sites); a
  missing wiring test is added.
  Sites: `packages/core/src/obj/object.ts:703`

- [x] **5.8 `object_flag_is_known` on the store's buy list.** Same fix as
  **2.10**: one gate, cited twice.
  Sites: `parity/ledger/store-maint.yaml:34`

- [x] **5.9 A store's stock did not age.** Already built end to end
  (`storeUpdate`, `packages/core/src/game/loop.ts:397`); nothing had ever
  exercised it in a test. Tests added.
  Sites: `packages/core/src/game/loop.ts:397`

## Tier 6: Wizard mode, closed

Wizard mode is fully ported: the item editor and its four commit steps, the
Monte-Carlo collectors, `runWriteMap`, the free-form effect prompt, the
edit-player queue chain, `quit_no_save`, `dump_level_map`, `query_feature`,
`peek_noise_scent`, the spoiler generators, and `ArtifactState` serialized
in the save. All fourteen `wizard-debug.yaml` items are `ported`.

## Tier 7: Originally "decisions to take", closed once measured

- [x] **7.1 `project-path`: wire it or cordon it.** Both halves of the
  offered decision were already resolved (the function is wired, and the UI
  branch exists). Reading it further found and fixed a real information
  leak: the targeting preview read the live map instead of the player's
  remembered one.
  Sites: `parity/ledger/project-path.yaml:58`

- [x] **7.2 Split the monster-turn partial into rows that can be closed.**
  Of the five bundled behaviours the row named, four were already live; the
  fifth (a message on decoy destruction missing from two call sites, and
  eight missing monster-lore flag learns) is now fixed.
  Sites: `packages/core/src/game/monster-turn.ts:1380`

- [x] **7.3 Decide the level-rating question.** Retracted: level rating
  (`add_to_monster_rating`, `obj_rating`, `chunk->feeling`) is fully ported
  and tested; there was no decision to make.
  Sites: `parity/ledger/mon-make.yaml:32`

- [x] **7.4 The world kernel's monster-list scan replacement.** Ported:
  fixed a live defect present since the port began: no monster's `light`
  field ever reached the map. `monsterLightSources`
  (`packages/core/src/game/known.ts`) supplies the view kernel's
  light-source scan, which had always received an empty list.
  Sites: `parity/ledger/world-kernel.yaml:27`

---

## Known remaining gaps

Thirteen citations are still open, all `real` or `partial` rows in the
ledger tranche (`parity/reports/ledger-deferred-items.tsv`), across ten
files:

- `parity/ledger/game-cave-cmd.yaml`: the steal command (`s`) has no
  shapechanged-player gate; `count_feats`' single-adjacent-door direction
  inference for `open` is absent. A third row in this file, disarming a
  locked door, is `partial` rather than fully open: it is not yet modelled
  as a trap instance, only the trap-disarm path exists.
- `parity/ledger/game-effect-melee.yaml`: `EF_MOVE_ATTACK`'s pass-through
  grids skip autopickup and disturb.
- `parity/ledger/game-effect-terrain.yaml`: the `birth_levels_persist`
  option on `CREATE_STAIRS`, and the `total_winner`/recall interplay, remain
  open (tracked with the RECALL ledger separately).
- `parity/ledger/game-known.yaml`: known traps are still per-grid memory
  rather than per-trap-instance; sense markers don't record which predicate
  sensed them, so a know/sense of one object class can clear another's.
- `parity/ledger/game-mon-ranged.yaml`: monster-vs-monster ranged casting
  always computes visibility from the player rather than the real target.
- `parity/ledger/game-pickup.yaml`: there is no `OFLOOR_VISIBLE` marking;
  every floor object is currently visible, so one can't yet be marked
  otherwise.
- `parity/ledger/game-player-path.yaml` has two remainders: the movement-speed
  class energy in the turn-penalty conversion, the digger-swap
  recalculation for rubble, and a dark/`PF_UNLIGHT` nuance in the lock
  penalty are unported; separately, the running torch-radius recompute, the
  running-into-a-trap auto-disarm nuance, and ignored floor objects not
  stopping a run are unported.
- `parity/ledger/obj-desc.yaml`: rune/flag learn-by-use messages use an
  approximate base name instead of the real object description.
- `parity/ledger/obj-value.yaml`: object pricing reads the real object
  instead of the player's partial knowledge of it, so a partially-identified
  item is overvalued.
- `parity/ledger/ui-display.yaml`: there is no top status bar at all
  (`update_topbar`/`SIDEBAR_TOP` and the short-form handlers have no port).

## What makes this list checkable

`packages/cli/src/port-todo.test.ts` fails if a file with a `real` or
`partial` census row is not cited somewhere in this document, if the stated
counts disagree with the census, if a cited path does not exist on disk, or
if a cited line on an open item has drifted off the note it points at. Tier
0's own unadjudicated backlog is deliberately not gated the same way: a
test asserting it at zero would be turned off before it went green, so both
numbers are written down in Tier 0 instead.

---

## What "zero open" does and does not mean

It means every citation this project has confirmed absent has been closed.
It does not mean the port is identical to Angband 4.2.6 in every respect.
Four things stand between "no open items" and "identical":

### 1. Things that are deliberately different, and stay different

The ledger census carries rows adjudicated `divergence` or `n-a`, each with
its mechanism named; see [DIVERGENCES.md](DIVERGENCES.md), which groups
them by whether a faithful transliteration was impossible, would have been
worse, or was simply not chosen. These are not owed work. The largest single
one is structural: `obj->known` is synthesised on demand rather than stored,
because the port has no persistent known-twin object. Others are forced by
the platform: upstream's `exit(1)` when `randart.log` cannot be opened has
no analogue in a browser tab, so the message goes to the caller and
generation continues.

### 2. Things nobody has looked at yet

The absence of an open item is evidence about what has been examined, not
about what is true. The list was built from deferral notes in the port's
own source and ledger, so it can only ever contain gaps somebody wrote down.
A whole subsystem that was ported cleanly and never annotated would appear
nowhere in this file whether it is faithful or not.

### 3. The measured parity claim is statistical, and covers generation

[docs/PARITY.md](../docs/PARITY.md) is the measurement, worth reading for
its limits rather than its greens. It compares 1000 generated levels per
depth against 1000 from the compiled C at α = 0.01 across depths 1-20, and
it measures generation. Formulas, messages, screens and keys are checked by
other lanes. One metric in that table, the monster species mix, is printed
and deliberately not gated, because the instrument is not good enough to
gate it: run against itself at a second seed the port reaches p = 2e-97.
Answering the species question properly is a measurement problem, not a
missing port, and is not on this list.

### 4. The frontend is a reimplementation, not a transliteration

Core is the port. The UI reproduces upstream's layouts, keys and messages,
but it is original code against a canvas rather than a port of `ui-*.c`
against curses, so "faithful" there is a claim about what the player sees,
checked by eye and by targeted tests, not by a function-for-function census.
Desktop is the parity bar; the web build is reduced by what a browser can
do.

### The honest one-line version

*Every gap this project has found and written down is closed.* That is a
real milestone and it is the strongest claim the evidence supports. It is
not "100% faithful", and the difference between those two sentences is
exactly the margin this file exists to keep visible.
