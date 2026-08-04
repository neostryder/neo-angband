# What is not ported, and what was judged unnecessary

**Dated 2026-08-04. Every deferral note in this repository has a verdict.**

For most of this port's life "deferred" was written in a comment by whoever was
closing a lane, and nobody could tell afterwards which of those notes described a
hole and which described work that had since landed. The word appeared 439 times.
This document is the answer to "so what is actually missing", and it is backed by
a re-runnable census rather than by recollection.

```
node parity/tools/deferral-census.mjs            # rebuild the row list
node parity/tools/deferral-triage.mjs            # add the mechanical hint column
node parity/tools/deferral-verdict.mjs <ref> ...  # record one adjudication
node parity/tools/deferral-report.mjs            # regenerate the appendix below
```

## The headline

**137 of 367 notes were describing a state of the code that no longer held.** The
notes are a fossil record of the build order, not a description of the port. The
single most common shape: core was built as a headless library first, so a note
says "the launcher analysis is deferred" or "calc_mana is deferred" and means
"the world layer that does this had not been written the week I wrote this line".
Both are ported. So is the quiver, the options menu, the target system, monster
shapechange, `pit.txt` selection, `message_lookup_by_name`, monster-vs-monster
melee, `react_to_slay` on the player's pack, `pack_overflow`, the fear block of
`mon_take_hit`, `generateStats`, the store's book expansion, and every one of the
twenty command codes the base registry registers as stubs.

A further 27 notes were not parity claims at all — a variable named `todo`, a
`setTimeout` "deferred a tick past focus", one mod that "defers to" another.

**What is genuinely missing is 95 citations that collapse to about 35 distinct
items,** listed next. None of them is a subsystem. The largest is a debug log.

## Genuinely not ported

Grouped by what a player would notice, worst first. Every line is backed by a row
in the appendix with the file, the C reference and the evidence.

### It changes what happens in play

- **`square_isempty` is weaker than upstream's** (`game/context.ts:1080`).
  `cave-square.c:604` rejects a player trap, a web, and any object; the port
  checks only passable / no monster / not the player, at 48 call sites. Placement
  loops can accept grids upstream rejects, which also moves RNG draws.
- **The `PN_IGNORE` notice pass is never run** (`game/context.ts:296`,
  `session/game.ts:551`, `obj/knowledge.ts:1364`). Becoming aware of an item kind
  sets the flag and nothing consumes it, so newly-ignored items are not dropped.
  The menu / `K` trigger of the same pass *is* reproduced.
- **Monster-vs-monster theft ignores `react_to_slay`** (`mon/steal.ts:234`,
  `mon-util.c:1548`). The player's own pack is protected correctly.
- **`alter` (`+`) has no chest or floor-trap branch** (`game/cave-cmd.ts:1045`).
  The note excused this because "alter is not wired to a shell key yet"; the
  shell has bound it since, which is what makes the gap reachable.
- **The chest `OF_TRAP_IMMUNE` rune is never learned** (`game/chest.ts:267`,
  `:345`) — the branch upstream learns in is empty in the port.
- **`known_only` does not exist** (`player-calcs-bonuses.yaml:78`). `obj-info.c`
  calls `calc_bonuses` with `known_only = true` at six sites; the port's
  object-inspect passes no such flag, so an unknown property of worn equipment
  can leak into an item-inspection comparison.
- **`pile_insert_end` is absent** (`game/gear.ts:1172`), so ordering inside a
  floor pile can differ from upstream's append-at-end.
- **`path_analyse`** (`game/known.ts:750`) and the **`list_object` / `oidx`
  bookkeeping** (`game/mon-place.ts:267`, `:328`, `game/floor.ts:18`).
- **`object_flag_is_known` at the three store sites** (`store/store.ts:232`,
  `:262`, `store-maint.yaml:34`) and **`store_init`'s runtime owner selection**
  (`store-price.yaml:21`).
- **The `OSTACK_LIST` stacking checks** (`obj/object.ts:923`, `:1000`): two
  objects the player cannot tell apart must not merge in a list context.
- **`cmd_disable_repeat_floor_item`** (`cmd-core.yaml:25`).
- The **monster-source decoy / target-monster branches of `EF_TOUCH`**
  (`game/project-cast.ts:684`).

### It changes what the player is told

- **`add_monster_message` has no queue** (`game/mon-message.ts:15`). The grammar
  is ported verbatim; the queue is not, so repeats never combine into
  "3 kobolds die." and deaths are not shown last. The root cause is that there is
  no `notice_stuff` / `PN_*` machinery at all, which is also why `PN_IGNORE`
  above has no consumer. **This is the one architectural item on the list.**
- **The killer's name is a race name, not `monster_desc(MDESC_DIED_FROM)`**
  (`effects/handlers.ts:78`, `game/effect-attack.ts:687`). Both halves exist —
  `MDESC_DIED_FROM` is defined at `mon/desc.ts:61` — and are not joined.
- **Monster recall has no computed percentages** (`mon/lore-describe.ts:22`,
  `:132`, `:138`, `:154`, `:846`, `:1299`, `web/knowledge.ts:1095`, `:1185`).
  The combat layer does not feed lore, so no hit-chance or spell-damage line
  appears. `hitChance` exists at `combat/hit.ts:60`.
- **Monster spells are not bound to the casting race** for recall
  (`mon-lore-describe.yaml:55`) — the same family.
- **`show_floor` for multiple objects** (`web/main.ts:5904`, `:5925`).
- **The knowledge browser's thematic grouping columns** (`web/screens.ts:872`,
  `gamedata.yaml:478` — this is `ui_knowledge.txt`). The browser is ported; the
  grouping the datafile defines is not.
- **The high-score entry cannot name the real killer** (`high-scores.yaml:96`).
- **The character sheet's launcher contribution is 0** (`game/ui-entry.ts:1392`,
  `ui-entry.yaml:133`), and `show_combined` / `EQUIPCMP_SCREEN` are compiled and
  bound but never iterated (`ui-entry.yaml:136`).
- **`update_sidebar`'s priority culling and from-bottom placement**
  (`ui-display.yaml:123`). The sidebar itself is drawn.
- **The birth screens answer help with a no-op** (`web/birth.ts:1051`).
- **Temporary brands/slays are not shown in object info**
  (`obj/object-info.ts:962`). The combat half is ported.
- **The shape-lore textblock chain** (`web/main.ts:3697`, `:3701`).
- **`monster_x_char` / `monster_x_attr`'s secondary glyph**
  (`mon/lore-describe.ts:1348`).
- **The flavour text shadow field** (`obj/known-object.ts:160`).
- **`object_list_format_name`'s own decoration** (`game-obj-list.yaml:44`).

### Whole modes that were never begun

- **Arena mode** (`mon/take-hit.ts:17`, `gen/cave.ts:31`, `gen/generate.ts:11`,
  `gen-cave.yaml:49` with `hard_centre_gen`, `game-mon-ranged.yaml:30`).
- **The quest system** (`gen/cave.ts:2833`, `gen/generate.ts:11`).
- **Persistent levels and the town builder's full store generation**
  (`gen/cave.ts:30`).
- **`room_of_chambers` / cavern callers** (`gen/gen-monster.ts:350`): the
  generator entry point exists and nothing calls it.

### History, notes and files

- **`history_find_artifact` / `history_lose_artifact`** are not wired
  (`player-history.yaml:79`); find-on-sight entries are blocked on remembered
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

### Wizard mode, owed by the 100 % mandate

`wizard-debug.yaml:14`, `:87`, `:112`, `:139`, `:144`, `:147`, `:154`, `:164`,
`:166`, `:167`; `game/wizard.ts:68`; `web/wizard.ts:498`; `world-kernel.yaml:27`.
The two that block the others: **`play_item`'s menu shell is absent**, which is
why `do_cmd_wiz_change_item_quantity` has nowhere to live, and there is **no
artifact-created registry**, so the wizard artifact listing cannot mark what has
been generated. `dump_level`'s file half is now possible through `host/io.ts`.

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
  stale, so this document cannot drift from the census.

<!-- BEGIN GENERATED: deferral-report.mjs -->

## Appendix: every row, with its verdict

Generated from `parity/reports/deferral-census.tsv` (367 rows).

| verdict | meaning | rows |
| --- | --- | --- |
| `real` | Confirmed absent and owed | 85 |
| `partial` | Part ported; the note must say which part is not | 10 |
| `divergence` | Deliberately different, with the mechanism named | 31 |
| `n-a` | Not applicable to this port, with the mechanism named | 50 |
| `ported` | Done; the note was stale and has been rewritten | 3 |
| `stale-doc` | The note described a state of the code that no longer holds | 137 |
| `note-is-fix` | The wording sits inside a record of a FIX, not a gap | 24 |
| `not-a-deferral` | Ordinary English, not a parity claim | 27 |
| | **total** | **367** |

### `real` - Confirmed absent and owed (85)

- `packages/core/src/effects/handlers.ts:78` - monsterDesc and MDESC_DIED_FROM both exist (mon/desc.ts:61) and the killer name still falls back to race.name; the death cause reads "kobold" where upstream writes "a kobold"
- `packages/core/src/game/cave-cmd.ts:1045` - The premise is stale (web/src/main.ts:8090 binds "+" to alterCmd, main.ts:4501) which makes the gap reachable: alter still has no chest branch and no floor-trap disarm branch (do_cmd_alter_aux L969-992)
- `packages/core/src/game/chest.ts:267` - Second copy of the chest OF_TRAP_IMMUNE learn, same empty branch
- `packages/core/src/game/chest.ts:345` - Second copy of the chest OF_TRAP_IMMUNE learn, same empty branch
- `packages/core/src/game/context.ts:296` - PN_IGNORE is SET (session/game.ts:551) and nothing ever reads it, so becoming aware of a kind never triggers the ignore_drop pass. ignoreDropTargets exists (game/ignore-cmd.ts:45, called from web main.ts:3119 for the menu) - it is the notice pass that is missing
- `packages/core/src/game/context.ts:1080` - square_isempty (cave-square.c:604-608) rejects a player trap, a web and any object; the port checks only passable/no-monster/not-player, at 48 call sites. Placement loops can therefore accept grids upstream rejects, which also moves RNG draws
- `packages/core/src/game/effect-attack.ts:687` - monsterDesc(mon, MDESC_DIED_FROM) is available (mon/desc.ts:61) and unused here; effect-handler-attack.c:490 is one of three upstream killer-name sites
- `packages/core/src/game/gear.ts:1172` - pile_insert_end is genuinely absent - the port has no pile links (gear.ts:134). Ordering inside a floor pile can therefore differ from upstream's append-at-end
- `packages/core/src/game/known.ts:750` - path_analyse absent: no pathAnalyse anywhere in the port, so intervening-square terrain is never learned along a path.
- `packages/core/src/game/mon-message.ts:15` - The message QUEUE is genuinely absent - there is no notice_stuff / PN_MON_MESSAGE machinery, so repeats never combine ("3 kobolds die.") and deaths are not shown last. The grammar half is ported verbatim
- `packages/core/src/game/mon-place.ts:267` - list_object oidx bookkeeping absent (no listObject in the port).
- `packages/core/src/game/mon-place.ts:328` - Same absence, second site.
- `packages/core/src/game/project-cast.ts:684` - The monster-source decoy and target-monster branches of effect_handler_TOUCH are genuinely absent; a monster casting a touch effect cannot centre it on a decoy or another monster
- `packages/core/src/game/spoil.ts:93` - timedDesc / summonDesc unwired, so a handful of activation descriptions in the spoiler files read worse than upstream's. Dev tool, small
- `packages/core/src/game/spoil.ts:518` - Same root cause as the lore hit-chance gap: the combat layer does not feed lore, so every "chance to hit" line in the monster spoiler is absent
- `packages/core/src/game/spoil.ts:519` - Second half of the same line
- `packages/core/src/game/spoil.ts:550` - loreDescription has no upstream-style spoiler flag, so the spoiler text differs from wiz-spoil.c's
- `packages/core/src/game/ui-entry.ts:1392` - The launcher-slot reach plus KF_SHOOTS_ARROWS is genuinely absent, so this entry contributes 0 where upstream contributes the launcher's value
- `packages/core/src/game/wizard.ts:68` - The wiz-spoil.c spoiler entry points owed by the 100%-including-wizard-mode mandate; tracked with the wizard-debug.yaml rows
- `packages/core/src/gen/cave.ts:30` - The town builder's full store generation and persistent-level connectors
- `packages/core/src/gen/cave.ts:31` - Second half of the same claim; the single-combat arena level is generated elsewhere
- `packages/core/src/gen/cave.ts:2833` - Quest-system dungeon profile
- `packages/core/src/gen/gen-monster.ts:350` - room_of_chambers / cavern callers absent, so this generator entry point has no caller.
- `packages/core/src/gen/generate.ts:11` - Arena and quest level generation
- `packages/core/src/mon/lore-describe.ts:22` - The combat layer does not feed lore, so every hit-chance and spell-damage percentage in monster recall is absent. hitChance exists (combat/hit.ts:60) and the lore side simply never receives it
- `packages/core/src/mon/lore-describe.ts:132` - Same gap, second blow field
- `packages/core/src/mon/lore-describe.ts:138` - Same gap, second blow field
- `packages/core/src/mon/lore-describe.ts:154` - Same gap, breath default damage
- `packages/core/src/mon/lore-describe.ts:846` - hit_chance(chance_of_melee_hit_base(...)) - the port has both halves (combat/hit.ts:60, chanceOfMeleeHitBase) and does not join them for recall
- `packages/core/src/mon/lore-describe.ts:1299` - hit_chance(chance_of_monster_hit_base(...)) - same
- `packages/core/src/mon/lore-describe.ts:1348` - monster_x_char / monster_x_attr secondary glyph absent (0 sites).
- `packages/core/src/mon/steal.ts:32` - Monster-vs-monster theft still omits react_to_slay (mon-util.c:1548); the player path DOES apply it (game/mon-side.ts:421), so the note's "exactly as the EAT_ITEM blow already defers it" is no longer true
- `packages/core/src/mon/steal.ts:33` - Same claim, second line
- `packages/core/src/mon/steal.ts:231` - Same gap at the site
- `packages/core/src/mon/steal.ts:234` - The commented-out condition itself; reactToSlay is exported from combat/brand-slay.ts:121 and state.slays is available at the game caller
- `packages/core/src/mon/take-hit.ts:17` - The arena branch, with the rest of arena mode
- `packages/core/src/obj/knowledge.ts:1364` - The ignore-notice pass (PN_IGNORE) is the same gap as game/context.ts:296: the flag is set and never consumed
- `packages/core/src/obj/known-object.ts:160` - The flavour TEXT (adjective / scroll title) shadow field; flavour naming itself is ported (obj/flavor.ts) so this is narrow
- `packages/core/src/obj/make.ts:1238` - The book out-of-depth value boost out-parameter
- `packages/core/src/obj/object-info.ts:962` - The COMBAT half of temporary brands/slays is ported (combat/brand-slay.ts:141-201, player_has_temporary_brand/slay); only the object-info display of them is missing
- `packages/core/src/obj/object.ts:923` - OSTACK_LIST's unknown-item stacking checks: two objects the player cannot tell apart must not merge in a LIST context. The shadow can answer this, so it is owed rather than impossible
- `packages/core/src/obj/object.ts:1000` - OSTACK_LIST fully-known mismatch check, same site family
- `packages/core/src/obj/randart-build.ts:38` - The "property" branch needs the timed-effects failure tables; part of the randart generator's remaining edges
- `packages/core/src/obj/randart.ts:38` - randart.log / randart.txt: upstream's do_randart writes it whenever randarts generate and exit(1)s if it cannot. 193 file_putf sites
- `packages/core/src/session/game.ts:542` - Same gap as game/context.ts:296: PN_IGNORE is set here and never consumed, so nothing runs the ignore_drop pass
- `packages/core/src/store/store.ts:232` - object_flag_is_known absent (0 sites), so a store's buy check cannot gate on known flags.
- `packages/core/src/store/store.ts:262` - Same absence, second site.
- `packages/web/src/birth.ts:1051` - Upstream's birth screens offer help (ui-birth.c); the port answers the key with a no-op
- `packages/web/src/knowledge.ts:1095` - Same gap as the lore hit-chance percentages: the computed flag / combat lines are absent from monster recall
- `packages/web/src/knowledge.ts:1185` - Same for ego-item recall
- `packages/web/src/main.ts:3697` - Greying rather than omitting is a divergence forced by a real gap - the shape-lore textblock chain named on the next line
- `packages/web/src/main.ts:3701` - The shape-lore textblock chain for Shapechange effects
- `packages/web/src/main.ts:5904` - show_floor with multiple objects: upstream opens the floor list, the port defers to the screen and skips ignored objects
- `packages/web/src/main.ts:5925` - show_floor screen for multiple objects absent (0 showFloor sites).
- `packages/web/src/screens.ts:872` - The thematic monster_group columns of the upstream knowledge browser (the ui_knowledge.txt grouping) are not drawn; the flat list is the selectable membership only
- `packages/web/src/wizard.ts:498` - The command-list absence tracked with the wizard-mode rows
- `parity/ledger/cmd-core.yaml:25` - cmd_disable_repeat_floor_item has no port equivalent (0 references)
- `parity/ledger/game-obj-list.yaml:44` - object_list_format_name's own formatting (the count/label decoration the list screen applies) is still not reproduced, even though the entry carries the real object
- `parity/ledger/game-project-cast.yaml:52` - The monster decoy / target-monster branches of TOUCH, matching game/project-cast.ts:684
- `parity/ledger/gamedata.yaml:478` - ui_knowledge.txt: it defines the knowledge browser's thematic grouping, and the browser IS ported, so the grouping columns are missing (see web/src/screens.ts:872)
- `parity/ledger/gen-cave.yaml:49` - hard_centre_gen and arena_gen
- `parity/ledger/high-scores.yaml:96` - The real killer is not wired through GameState, so the score entry cannot name it
- `parity/ledger/mon-lore-describe.yaml:55` - Monster spells are not bound to the casting race, so recall cannot show spell damage - the same family as the lore hit-chance gap
- `parity/ledger/obj-randart.yaml:51` - RANDNAME_TOLKIEN from the names datafile is not loaded, so randart names come from artifactGenName's own generator
- `parity/ledger/options.yaml:76` - options_save_custom / restore_custom / restore_maintainer - the per-user customized-defaults files in ANGBAND_DIR_USER. Now buildable: the host seam and the pref-file writer both exist
- `parity/ledger/player-calcs-bonuses.yaml:78` - known_only has no port equivalent: obj-info.c calls calc_bonuses with known_only=true at six sites, and the port's object-inspect passes no such flag, so an unknown property of worn equipment can leak into the item-inspection analysis
- `parity/ledger/player-history.yaml:75` - find-on-sight history entries, blocked on the remembered floor-pile contents
- `parity/ledger/player-history.yaml:79` - history_find_artifact / history_lose_artifact are not wired
- `parity/ledger/player-history.yaml:91` - The player notes command
- `parity/ledger/project-path.yaml:58` - A ported function with no caller, because the UI branch that would call it is absent - worth deciding between wiring it and cordoning it
- `parity/ledger/store-maint.yaml:34` - Same absence, third site - the maintenance half.
- `parity/ledger/store-price.yaml:21` - store_init runtime owner selection absent (0 storeInit sites).
- `parity/ledger/ui-entry.yaml:133` - The launcher-slot reach plus KF_SHOOTS_ARROWS, same as game/ui-entry.ts:1392
- `parity/ledger/ui-entry.yaml:136` - The show_combined path and the EQUIPCMP_SCREEN iteration: the category is compiled and bound but never iterated
- `parity/ledger/wizard-debug.yaml:14` - No artifact-created registry, so the wizard artifact listing cannot mark what has been generated
- `parity/ledger/wizard-debug.yaml:87` - The shell follow-up for this wizard command
- `parity/ledger/wizard-debug.yaml:112` - dump_level + its file I/O; the host seam now makes the file half possible (host/io.ts)
- `parity/ledger/wizard-debug.yaml:139` - Owed by the 100%-including-wizard-mode mandate
- `parity/ledger/wizard-debug.yaml:144` - The wiz-stats histograms; heavy, but owed by the mandate
- `parity/ledger/wizard-debug.yaml:147` - The wiz-stats sampler
- `parity/ledger/wizard-debug.yaml:154` - do_cmd_wiz_change_item_quantity
- `parity/ledger/wizard-debug.yaml:164` - do_cmd_wiz_change_item_quantity absent (0 changeItemQuantity sites). Owed: the mandate is 100% parity INCLUDING wizard mode.
- `parity/ledger/wizard-debug.yaml:166` - The play_item menu shell is absent (0 playItem sites) - the reason the quantity action has nowhere to live.
- `parity/ledger/wizard-debug.yaml:167` - Same: play_item shell absent.
- `parity/ledger/world-kernel.yaml:27` - The monster-list scan replacement and what the note lists after it

### `partial` - Part ported; the note must say which part is not (10)

- `packages/core/src/game/context.ts:1153` - The held-object drop IS handled (the caller runs monster_death first, as the note says); the mimic and targeting bookkeeping remain
- `packages/core/src/game/floor.ts:18` - pushObject is ported and called (effect-general.ts:190, effect-terrain.ts:347); the known-object shadow cave, list_object/delist_object oidx bookkeeping and mimicked-object handling remain
- `packages/core/src/game/monster-turn.ts:1423` - Item pickup and group behaviour are ported (monsterCarry, mon-group.ts); the lore half is largely wired via loreLearnFlagIfVisible. Left partial because the note covers three subsystems at once and only names them collectively
- `packages/core/src/game/ui-entry.ts:26` - The gameplay half of player_flags_timed IS ported - calcs.ts:1094-1104 folds each active timed effect's oflagDup into state.flags. What is missing is ui-entry.c:928's separate timed cache, which lets the sheet mark a flag as temporary
- `packages/core/src/store/transact.ts:26` - Of the four named: the known twin is a divergence and total_weight IS maintained (gear.ts:1283, shown as Burden at char-sheet.ts:409). Autoinscription (the registry exists at game/context.ts:254) and history_find/lose_artifact are genuinely absent here
- `parity/ledger/game-mon-ranged.yaml:30` - The glyph-of-warding exclusion is available (TRF.GLYPH is handled at monster-turn.ts:1536); the arena exclusion goes with arena mode
- `parity/ledger/game-project-monster.yaml:50` - Targeting is wired; the mimic bookkeeping is not (same as game/context.ts:1153)
- `parity/ledger/mon-make.yaml:32` - monCreateDrop and updateMon are ported; monster lore is wired (including lore.txt). Level rating has no port equivalent (0 references)
- `parity/ledger/mon-timed.yaml:29` - The GRAMMAR is ported verbatim (game/mon-message.ts: get_subject, get_message_text, message_pain, the [singular|plural] state machine). What is absent is the QUEUE - add_monster_message -> mon_msg[] flushed by show_monster_messages from notice_stuff's PN_MON_MESSAGE - so repeats are not combined into a counted line and deaths are not shown last. Root cause is the missing notice_stuff/PN_* machinery, not this file.
- `parity/ledger/ui-display.yaml:123` - The sidebar IS drawn, by the front end on a canvas rather than with Term_* calls (web/src/main.ts sidebarModel). update_sidebar's screen-size priority culling and from-bottom placement are genuinely absent (game/display.ts:505 says so)

### `divergence` - Deliberately different, with the mechanism named (31)

- `packages/core/src/game/curse-tick.ts:98` - known-twin write; obj/known-object.ts synthesises the shadow on demand, so the object-info display reads the same value
- `packages/core/src/game/gear.ts:23` - obj->known is not persisted by design: obj/known-object.ts synthesises the shadow on demand from Player.objKnown and desc.ts reads it where upstream reads the twin. equip_cnt is a UI counter the port's screens do not need
- `packages/core/src/game/gear.ts:134` - Same: the known twin is synthesised, not stored (obj/known-object.ts objectKnownShadow)
- `packages/core/src/game/gear.ts:327` - The note already contains its own answer - objKnown.toA is 1 from birth, so the shadow at known-object.ts:446 yields the real toA and the twin write has no observable consumer
- `packages/core/src/game/gear.ts:373` - Same write, same reason (known-object.ts:446)
- `packages/core/src/game/gear.ts:980` - objectSimilar's equipped test: isEquipped is ported; the OSTACK_LIST knowledge checks read the synthesised shadow
- `packages/core/src/game/gear.ts:1054` - Knowledge twin synthesised on demand (obj/known-object.ts)
- `packages/core/src/game/gear.ts:1107` - pval bonuses are live; equip_cnt is upstream's equipment-count UI counter, which the port's character sheet derives directly from player.equipment
- `packages/core/src/game/gear.ts:1282` - Known-twin write, subsumed by the on-demand shadow
- `packages/core/src/game/known.ts:819` - Known twin synthesised on demand (obj/known-object.ts)
- `packages/core/src/game/known.ts:847` - Known twin synthesised on demand; monsterCarry itself is ported and called two lines below (known.ts:854)
- `packages/core/src/game/monster-turn.ts:1375` - The player-cave placeholder copy rides the knowledge subsystem, which the port models as synthesised knowledge rather than a second grid array
- `packages/core/src/game/target-loop.ts:42` - Documented approximation for a UI-only branch: the port reads the live floor pile and live projectability where upstream reads the remembered map. project.ts carries the same note
- `packages/core/src/gen/generate.ts:247` - The port's Connector carries grid + feat rather than a SQUARE info copy; matters only when persistent levels arrive
- `packages/core/src/obj/bind.ts:1324` - The known-object side is synthesised on demand (obj/known-object.ts) rather than bound as a second object
- `packages/core/src/obj/desc.ts:15` - The header's inline DEFERRED notes are all known-twin reads, which desc.ts now takes from objectKnownShadow
- `packages/core/src/obj/knowledge.ts:22` - Per-object twin replaced by on-demand synthesis (obj/known-object.ts objectKnownShadow)
- `packages/core/src/obj/knowledge.ts:727` - A known-twin display marking, subsumed by the shadow
- `packages/core/src/obj/knowledge.ts:746` - Same
- `packages/core/src/obj/knowledge.ts:1243` - Same
- `packages/core/src/obj/known-object.ts:9` - This module IS the divergence: the twin is synthesised on demand and desc.ts reads the shadow wherever upstream reads obj->known
- `packages/core/src/obj/object.ts:7` - Header points at obj-model.yaml; the model's absent twin is the synthesised shadow
- `packages/core/src/obj/object.ts:290` - Known-twin field
- `packages/core/src/obj/object.ts:388` - The explicit statement of the divergence: no persistent twin, synthesis instead (obj/known-object.ts)
- `packages/core/src/obj/object.ts:909` - Player-knowledge inputs come from Player.objKnown and the shadow
- `packages/core/src/obj/object.ts:1158` - Knowledge system read, answered by the shadow
- `packages/core/src/store/store.ts:368` - The obj->known pile is synthesised on demand (obj/known-object.ts)
- `parity/ledger/game-gear.yaml:71` - The known twin is synthesised on demand; the line's own "NOT deferred" clause lists what is live
- `parity/ledger/rng.yaml:40` - Rand_init's time/pid seeding is deliberately replaced: the port seeds from crypto/Math.random at the host and stores the seed in the save, which is what makes a run reproducible
- `parity/ledger/ui-entry.yaml:107` - Synthesised on demand (obj/known-object.ts)
- `parity/ledger/ui-entry.yaml:114` - The port folds merged curse data into the object's own flags, which the note states is equivalent

### `n-a` - Not applicable to this port, with the mechanism named (50)

- `packages/core/src/combat/melee.ts:26` - Layer boundary, not a gap: combat/ returns the HitType key and the game layer formats the text (game/mon-message.ts, effect-melee.ts)
- `packages/core/src/combat/mon-melee.ts:163` - monVisible is supplied by the live env (MonBlowEnv.monVisible, game/mon-side.ts makeMonBlowEnv); the default only affects the worldless harness
- `packages/core/src/game/known.ts:153` - The note names its own mechanism: the front end runs updateView + noteSpots after every state-changing action, so there is no dirty-flag pipeline for a PU_/PR_ bit to set
- `packages/core/src/game/loop.ts:337` - A message on a seen trap re-arming; the port has no PR_ dirty-flag pipeline and the front end repaints unconditionally
- `packages/core/src/game/mon-death.ts:342` - PR_MONLIST is a redraw bit with no port equivalent (the front end repaints unconditionally); the note itself records quest_check as wired
- `packages/core/src/game/monster-turn.ts:1042` - Adjacent-decoy destruction on floors; no RNG, and the decoy itself is modelled
- `packages/core/src/game/monster-turn.ts:1052` - Same adjacent-decoy note, no RNG
- `packages/core/src/game/monster-turn.ts:1317` - Presentation only, no RNG; the port routes messages through the shell sink
- `packages/core/src/game/monster-turn.ts:1400` - A message, no RNG
- `packages/core/src/game/monster-turn.ts:1535` - "The decoy is destroyed!" message; no RNG
- `packages/core/src/game/monster-turn.ts:1667` - Lore note on OF_AGGRAVATE, no RNG; monster lore is otherwise wired
- `packages/core/src/game/monster-turn.ts:1700` - Message plumbing and lore; the messages route through the shell sink
- `packages/core/src/game/player-path.ts:95` - Sound and redraw halves; no RNG, and the port has no PR_ pipeline
- `packages/core/src/game/player-turn.ts:703` - Two of the 20 are correctly never replaced: upstream's "look" is a UI function with CMD_NULL (ui-knowledge.c:4169, bound by the shell to l/x at web main.ts:8039), and 4.2.6 has no search command at all - no do_cmd_search, no CMD_SEARCH
- `packages/core/src/game/project-cast.ts:10` - Layer boundary with live suppliers: session/game.ts:1223 supplies the monster hooks and :1289 the player hooks, so the "deferred consequences" all run in play
- `packages/core/src/game/project-cast.ts:31` - basicPlayerActor is the worldless view; the live path supplies the real actor (session/game.ts:1289)
- `packages/core/src/game/project-cast.ts:131` - CastHooks is the seam, supplied at session/game.ts:1223/:1289
- `packages/core/src/game/project-cast.ts:133` - ProjectMonsterHooks supplied at session/game.ts:1223
- `packages/core/src/game/project-cast.ts:135` - ProjectPlayerHooks supplied at session/game.ts:1289, onSideEffects via makePlayerSideEffects (game/player-side.ts:139)
- `packages/core/src/game/project-monster.ts:47` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/game/project-player.ts:16` - Same seam discipline; supplied at session/game.ts:1289. The killer-name half is tracked separately as the MDESC_DIED_FROM gap
- `packages/core/src/game/project-player.ts:85` - Supplied at session/game.ts:1289
- `packages/core/src/game/spoil.ts:352` - seed_randart only matters under birth_randarts and this is a dev tool; the note states the condition
- `packages/core/src/mon/project-mon.ts:42` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/mon/timed.ts:217` - Health-bar / monster-list redraw; the front end repaints unconditionally
- `packages/core/src/obj/desc.ts:621` - is_unknown's placeholder path belongs to the object-list screen, which the web layer draws (game/obj-list.ts + web screens)
- `packages/core/src/player/bind.ts:15` - Layer boundary: the raw effect chain is compiled by the effects domain, which is ported (effects/effect.ts) and wired at session boot
- `packages/core/src/player/birth.ts:394` - Kind-name refs are resolved by the session (outfitPlayer + tvalFindIdx at gear.ts:1300); the binding layer holding names is the design
- `packages/core/src/player/birth.ts:442` - Same: "deferred references" names the binding boundary
- `packages/core/src/player/birth.ts:445` - Same
- `packages/core/src/player/calcs.ts:446` - A caller-supplied global, not a gap
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
- `parity/ledger/effects-interpreter.yaml:134` - recharge_failure_chance IS in the obj domain, which is where the note says it belongs; the rest of the line is about GC and serialisation
- `parity/ledger/expression.yaml:31` - expression_free is garbage collected and the strtol saturation is documented in the helper; neither is reachable behaviour
- `parity/ledger/game-arena.yaml:16` - monster_index_move exists only to serve arena_gen's memcpy; the port's arena builder reads state.healthWho instead
- `parity/ledger/game-gear.yaml:68` - Pack overflow at birth: a birth kit cannot overflow, and packOverflow itself is ported and called (obj-cmd.ts:276, session/game.ts:806)
- `parity/ledger/gamedata.yaml:497` - old_class.txt is retired data the 4.2.6 game does not load
- `parity/ledger/player-model.yaml:53` - Starting-inventory kind-name refs are resolved by the session; a binding boundary
- `parity/ledger/ui-player.yaml:68` - The resist/ability/sustain grid is ported, in the separate module the note points at (characterGrid, ui-entry.ts:1863, drawn by web charsheet.ts:270)
- `parity/ledger/wizard-debug.yaml:163` - The action is reachable by another route already ported; upstream's separate entry point adds no behaviour
- `parity/ledger/wizard-debug.yaml:170` - Process lifetime belongs to the shell, which owns it in this port

### `ported` - Done; the note was stale and has been rewritten (3)

- `packages/core/src/game/cave-cmd.ts:36` - STALE. do_cmd_steal is game/steal.ts (installSteal registers "steal"), reachable on s / roguelike s via web/src/main.ts:4515 stealCmd. Grepping do_cmd_steal's port name, not the C name, is what showed it.
- `packages/core/src/obj/object.ts:918` - STALE. object_is_equipped is ported (isEquipped, 15 non-comment sites) and there IS player gear.
- `parity/ledger/player-history.yaml:46` - STALE on its own premise. dump_history is in the character dump (web/src/charsheet.ts:504 calls historyLines under the "[Player history]" header), and character-dump-to-file exists - dumpCharacterFile, now through the host seam.

### `stale-doc` - The note described a state of the code that no longer holds (137)

- `packages/core/src/combat/brand-slay.ts:20` - Header points at combat-melee.yaml, whose own deferred list is now stale (monsterAttackMonster game/mon-cmd.ts:317, reactToSlay mon-side.ts:421, monsterCarry known.ts:854, smart-learn project-player.ts:171 all ported)
- `packages/core/src/combat/brand-slay.ts:57` - Curse terms are live: calcBonuses folds each worn item's curse template (calcs.ts curses option, player-calcs.c:2009-2023) and reg.objects.curses is passed at every session call site
- `packages/core/src/combat/brand-slay.ts:62` - Same as :57 - the curse traversal is wired, not deferred
- `packages/core/src/combat/index.ts:7` - core/src/index.ts:93 does `export * from "./combat/index.js"`
- `packages/core/src/combat/melee.ts:8` - calcBonuses is ported (calcs.ts:720) and called by session/game.ts refreshDerived/startGame/loadGame
- `packages/core/src/combat/melee.ts:65` - calcBonuses ported and live; see calcs.ts:720 and session/game.ts:697
- `packages/core/src/combat/mon-melee.ts:29` - All four named items are ported: monsterAttackMonster (mon-cmd.ts:317), react_to_slay on the player EAT_ITEM path (mon-side.ts:421), monsterCarry (known.ts:854), lore/smart-learn (loreLearnFlagIfVisible, project-player.ts:171). Only mon-vs-mon react_to_slay remains (mon/steal.ts:234)
- `packages/core/src/combat/mon-melee.ts:449` - Scope error, reads as a game gap: this is the WORLDLESS recording path. The live path applies elemental damage in full at mon-melee.ts:710 (env.elementalDam / invenDamage / resists)
- `packages/core/src/combat/ranged.ts:11` - The projectile path, ammo/quiver management, breakage and the fire/throw front ends are all ported (game/ranged-cmd.ts, gear.ts quiver subsystem)
- `packages/core/src/combat/ranged.ts:13` - missileLearnOnRangedAttack is ported (obj/knowledge.ts:637) and called at ranged-cmd.ts:164-167; learnBrandSlayFromLaunch at brand-slay.ts:337
- `packages/core/src/effects/effect.ts:8` - Both registries are injected in the live composition: summonNameToIdx and shapeNameToIdx at session/game.ts:1168 and :1178
- `packages/core/src/effects/effect.ts:315` - inject.summonNameToIdx is supplied by session/game.ts:1168
- `packages/core/src/effects/effect.ts:327` - inject.shapeNameToIdx is supplied by session/game.ts:1178
- `packages/core/src/game/cave-cmd.ts:1047` - alterCmd at web/main.ts:4493, bound to + at main.ts:8068
- `packages/core/src/game/char-sheet.ts:105` - weightLimit is ported (calcs.ts:493) and used at calcs.ts:1213
- `packages/core/src/game/char-sheet.ts:125` - Equipment and timed contributions are both computed: calcs.ts:844 (equipment modifiers) and the timed block driven by CalcBonusesOptions.timedEffects
- `packages/core/src/game/chest.ts:86` - ignoreItemOk is ported (obj/ignore.ts:380) and called from obj-cmd.ts:946 and session/game.ts:611
- `packages/core/src/game/context.ts:130` - calcBonuses ported; the explicit supply is a layer choice, not a deferral
- `packages/core/src/game/display.ts:112` - Equipment and timed contributions are computed by calcBonuses; hitpointWarn is supplied (display.ts:97, context.ts:329)
- `packages/core/src/game/effect-general.ts:25` - Monster-AI decoy targeting IS ported: monster-turn.ts:71-79 documents it and monsterIsDecoyed / squareIsDecoyed are at :399-410
- `packages/core/src/game/effect-general.ts:94` - trapDeps IS supplied in the live composition (session/game.ts:1698), so glyph and web creation are wired; only the worldless default no-ops
- `packages/core/src/game/effect-terrain.ts:424` - monsterDesc with MDESC_TARG is ported and used (mon-cmd.ts:102, mon-cmd.ts:330); this site can call it
- `packages/core/src/game/gear.ts:12` - The header's DEFERRED list is stale: quiver subsystem live (quiverAbsorbNum gear.ts:497, invenCarryNum :592, packSlotsUsed :448), known twin synthesised on demand
- `packages/core/src/game/gear.ts:1293` - Both halves are applied: flavour awareness via opts.onStartKind, collected at session/game.ts:2775 and applied at :2911; base-known via objectSetBaseKnown inside the shadow synthesis
- `packages/core/src/game/gear.ts:1338` - The seam IS supplied - session/game.ts:2775 pushes each start kind and :2911 calls objectFlavorAware once flavor_init has run
- `packages/core/src/game/harness.ts:138` - calcBonuses is ported; the harness supplies a fixed state on purpose
- `packages/core/src/game/loop.ts:85` - Level change on stairs/recall is ported and drives real generation (session/game.ts changeLevel); nothing about it is deferred
- `packages/core/src/game/mon-cast.ts:64` - Both subtype registries are injected in the live composition (session/game.ts:1168 summonNameToIdx, :1178 shapeNameToIdx); the fizzle path is now only an unknown-name guard
- `packages/core/src/game/mon-cast.ts:377` - Same: the injection is supplied, so this branch is a guard rather than a deferral
- `packages/core/src/game/mon-ranged.ts:267` - The decoy is modelled (GameState.decoy) and the monster AI targets it (monster-turn.ts:399-410)
- `packages/core/src/game/mon-side.ts:20` - react_to_slay IS applied on the player EAT_ITEM path (game/mon-side.ts:421). Only the monster-vs-monster theft (mon/steal.ts:234) still omits it
- `packages/core/src/game/monster-turn.ts:77` - Header points at game-monster-ai.yaml, whose deferred list is itself stale (spellcasting, breath and terrain damage are all wired)
- `packages/core/src/game/monster-turn.ts:735` - monsterHatesGrid is a real function (monster-turn.ts:383) called at :536, :601 and :652; it is not the constant false the note describes
- `packages/core/src/game/monster-turn.ts:1117` - monsterHatesGrid is live (monster-turn.ts:383), so dangerous terrain in the way IS considered
- `packages/core/src/game/obj-cmd.ts:21` - The rune knowledge system is ported (obj/knowledge.ts, equipLearnFlag called from six modules) and ignoreItemOk is called at obj-cmd.ts:946
- `packages/core/src/game/obj-cmd.ts:23` - Header list stale for the same reason
- `packages/core/src/game/player-turn.ts:14` - Every one of the 20 STUBBED_COMMANDS is replaced by a real action in the live composition (obj-cmd.ts installs eat/quaff/read/use-staff/aim-wand/zap-rod/activate; cave-cmd, ranged-cmd, spell-cmd, pickup and player-path the rest)
- `packages/core/src/game/player-turn.ts:685` - Level generation and depth change ARE wired (session/game.ts changeLevel, called by the descend/ascend actions)
- `packages/core/src/game/player-turn.ts:698` - stubAction is a base-registry placeholder, not a deferral: all 20 codes are re-registered for real before play
- `packages/core/src/game/player-turn.ts:729` - "the ported actions plus the deferred stubs" - the stubs are all replaced by installers
- `packages/core/src/game/project-cast.ts:217` - The target system IS ported - runTargetLoop / target-loop.ts, bound to l/x and to the aiming prompts in web main.ts. The shell resolves the target and passes the grid, which is a layer boundary, not a deferral
- `packages/core/src/game/project-feat.ts:16` - Header points at game-project-feat.yaml; pushObject, the trap deps and the decoy are all wired (effect-general.ts:190, session/game.ts:1698)
- `packages/core/src/game/ranged-cmd.ts:20` - Header list stale: the fire/throw front ends, ammo handling and breakage are all in game/ranged-cmd.ts and bound in the shell
- `packages/core/src/game/spell-cmd.ts:14` - The low-mana confirmation IS ported: web/src/main.ts:3341 asks "Attempt it anyway? ", the same prompt as cmd-obj.c:1151
- `packages/core/src/game/steal.ts:19` - objectGrab / objectSee ARE ported (obj/known-object.ts) and PR_GOLD is a redraw bit with no port equivalent; nothing here is owed
- `packages/core/src/game/ui-entry.ts:1200` - The note says the port's merged curse data already folds in, so the separate iteration is a divergence with an equivalence argument, not a deferral
- `packages/core/src/gen/generate.ts:70` - trapKinds IS supplied in the live composition, so place_trap picks a kind and rolls power; the "deferred bare-grid behaviour" is the worldless default
- `packages/core/src/gen/util.ts:16` - trapKinds IS supplied (session/boot.ts:239 passes reg.traps), so place_trap picks the kind and rolls the power in the generation stream; the trap domain is game/trap.ts
- `packages/core/src/mon/make.ts:10` - The world integration exists: monsterCarry, placeNewMonster, group and escort spawning are all called from gen/ and game/
- `packages/core/src/mon/make.ts:268` - Placement into a chunk is wired (gen/gen-monster.ts, game/mon-place.ts)
- `packages/core/src/mon/monster.ts:9` - Same: the world integration is built
- `packages/core/src/mon/predicate.ts:16` - monsterIsDecoyed IS ported, in the layer that has the live cave: game/monster-turn.ts:406, with squareIsDecoyed at :399
- `packages/core/src/mon/project-mon.ts:16` - Monster lore is wired (loreLearnFlagIfVisible, loreUpdate, the lore.txt file); the "late subsystems" clause is from the build order
- `packages/core/src/mon/steal.ts:29` - objectGrab / objectSee / the knowledge bookkeeping are ported (obj/known-object.ts)
- `packages/core/src/mon/timed.ts:16` - Monster shapechange IS ported: game/mon-shape.ts drives the MON_TMD_CHANGED timer and monster-turn.ts:1726 swaps the form
- `packages/core/src/mon/timed.ts:17` - "CHANGED is only set by an effect that is not ported yet" - the SHAPECHANGE monster spell is wired (game/mon-cast.ts:87, mon-shape.ts)
- `packages/core/src/mon/timed.ts:22` - Same block
- `packages/core/src/mon/types.ts:244` - summon.txt is bound and used: summons.nameToIdx feeds effect subtypes at session/game.ts:1168
- `packages/core/src/mon/types.ts:255` - pit.txt is bound and used: setPitType / monPitHook at gen/gen-monster.ts:205 and room.ts:1341
- `packages/core/src/msg.ts:12` - messageLookupByName IS ported (sound/engine.ts:77) and used by mon/bind.ts:602 and visuals/prefs.ts:397
- `packages/core/src/obj/ignore.ts:30` - The rune knowledge system is ported; ignoreItemOk is live at obj-cmd.ts:946 and session/game.ts:611
- `packages/core/src/obj/knowledge.ts:663` - The shapechange system is ported (player.shape, effect-general.ts:850); shape to_a can be read from the bound shape
- `packages/core/src/obj/make.ts:9` - Header list stale: applyCurse is live (obj/make.ts:1188) and the knowledge half is synthesised
- `packages/core/src/player/birth.ts:20` - Header points at player-birth.yaml, whose own list is stale (rollHp is called, the outfit knowledge seams are supplied at session/game.ts:2775/:2911)
- `packages/core/src/player/calcs.ts:21` - The same header already records calc_mana as ported two lines later; the curse registry is supplied by every session call site
- `packages/core/src/player/calcs.ts:266` - statAdd IS computed from equipment (calcs.ts:844, rune-gated); this helper excludes equipment BY DESIGN for the stat-index table, which is a different statement from "deferred"
- `packages/core/src/player/calcs.ts:362` - The launcher/weapon weight analysis is ported (calcs.ts:1240-1252 shots/might, weightLimit at :493)
- `packages/core/src/player/calcs.ts:379` - numShots is computed at calcs.ts:1240-1252
- `packages/core/src/player/calcs.ts:383` - ammoMult is computed at calcs.ts:1244-1247
- `packages/core/src/player/calcs.ts:385` - ammoTval is computed with the launcher analysis
- `packages/core/src/player/calcs.ts:387` - ac accumulates from equipment at calcs.ts:886
- `packages/core/src/player/calcs.ts:648` - isDaytime is real and supplied (game/world.ts isDaytime, passed at object-inspect.ts:89 and by the session)
- `packages/core/src/player/calcs.ts:650` - Same TODO: the world clock exists, so the note's condition is already met
- `packages/core/src/player/calcs.ts:703` - The "DEFERRED blocks" list is stale: shots/might, ac, statAdd, weightLimit and the timed fold are all computed here
- `packages/core/src/player/calcs.ts:811` - The learn-by-use rune system is ported: equipLearnFlag / equipLearnElement / missileLearnOnRangedAttack, called from loop.ts, mon-cast.ts, mon-side.ts, effect-general.ts and ranged-cmd.ts
- `packages/core/src/player/calcs.ts:1294` - calcMana IS ported (player/spell.ts:551) and called by the session; the note's own line 25 already says so
- `packages/core/src/player/options.ts:10` - The option menu IS ported: web/src/options.ts runOptionsMenu, bound to "=" at web/src/main.ts:8083
- `packages/core/src/player/player.ts:30` - The pack / quiver arrays are built: Gear.inven and Gear.quiver with calcInventory sizing them (game/gear.ts:92-112)
- `packages/core/src/player/timed.ts:32` - The knowledge queries ARE supplied: makeIncCheckQueries (game/player-side.ts), imported at session/game.ts:49 and passed on the live path
- `packages/core/src/player/timed.ts:129` - Same seam, supplied by makeIncCheckQueries
- `packages/core/src/player/timed.ts:154` - Same
- `packages/core/src/player/timed.ts:314` - Same
- `packages/core/src/player/types.ts:11` - The effects domain is ported and bound at session boot; the "later" is from the build order
- `packages/core/src/player/types.ts:324` - The notify-suppression queries are supplied (makeIncCheckQueries, game/player-side.ts)
- `packages/core/src/store/bind.ts:10` - Pricing, stock maintenance, buying/selling and town placement are all ported (store/price.ts, store-maint, store/transact.ts, gen/cave.ts town)
- `packages/core/src/store/bind.ts:95` - The expansion IS ported: store.ts:173-174 walks bound.alwaysBookTvals against the class book list
- `packages/core/src/store/store.ts:128` - Same: the expansion is at store.ts:173
- `packages/core/src/store/transact.ts:93` - Rune learning on transaction is LIVE on both sides per this file's own header (transact.ts:20-25)
- `packages/core/src/store/transact.ts:382` - Same: object_learn_unknown_rune runs on buy and sell
- `packages/core/src/store/types.ts:11` - obj/power.ts objectPower exists; gear.ts:1327 deducts via objectValueReal
- `packages/web/src/main.ts:1146` - Equipment statAdd IS computed (calcs.ts:844); the sidebar can read it
- `packages/cli/src/call-census.ts:16` - pack_overflow(NULL) IS wired: session/game.ts:806 calls packOverflow(state, 0, ...) at the game-world.c:947 position
- `parity/ledger/combat-melee.yaml:57` - The curse terms are live: calcBonuses folds each worn item's curse template and every session call site passes reg.objects.curses
- `parity/ledger/combat-melee.yaml:65` - The fear block IS ported line for line: mon/take-hit.ts:68-76 mirrors mon-util.c:1139-1173. Only the arena branch remains
- `parity/ledger/combat-melee.yaml:74` - Scope error: the elemental part is applied in full on the live path (combat/mon-melee.ts:710 env.elementalDam / invenDamage / resists); only the worldless recording path returns physical only
- `parity/ledger/combat-melee.yaml:89` - adjust_dam elemental rolls run on the live path (mon-melee.ts:710)
- `parity/ledger/effects-interpreter.yaml:70` - The monster-target and decoy branches are wired: game/effect-monster.ts, project-monster.ts and the decoy at effect-general.ts:199 / monster-turn.ts:399-410
- `parity/ledger/effects-interpreter.yaml:74` - Decoy destruction and the TMD->MON_TMD mapping are both ported (effect-general.ts:768 maps TMD.AFRAID to MON_TMD.FEAR)
- `parity/ledger/effects-interpreter.yaml:82` - summonNameToIdx is injected at session/game.ts:1168
- `parity/ledger/effects-interpreter.yaml:84` - shapeNameToIdx is injected at session/game.ts:1178
- `parity/ledger/game-cave-cmd.yaml:21` - alterCmd at web/main.ts:4493, bound to + at main.ts:8068
- `parity/ledger/game-cave-cmd.yaml:52` - pickLock supplied at session/game.ts:1716
- `parity/ledger/game-cave-cmd.yaml:57` - alterCmd at web/main.ts:4493, bound to + at main.ts:8068
- `parity/ledger/game-effect-attack.yaml:27` - resolveAimedTarget is ported and used at 15 sites
- `parity/ledger/game-gear.yaml:15` - The quiver is ported: packSlotsUsed (gear.ts:448) with the quiver discount, quiverAbsorbNum (:497), invenCarryNum (:592)
- `parity/ledger/game-gear.yaml:18` - quiverAbsorbNum returns a real nToQuiver, consumed at gear.ts:592 and :831
- `parity/ledger/game-gear.yaml:20` - total_weight IS maintained (gear.ts:1283) and displayed as Burden (char-sheet.ts:409)
- `parity/ledger/game-gear.yaml:58` - obj/power.ts objectPower exists; gear.ts:1327 deducts via objectValueReal
- `parity/ledger/game-loop.yaml:43` - All 20 stubbed codes are re-registered by the installers before play (obj-cmd, cave-cmd, ranged-cmd, spell-cmd, pickup, player-path); only "look" and "search" stay stubs, correctly - upstream's look is a UI function and 4.2.6 has no search command
- `parity/ledger/game-mon-group.yaml:48` - monster_can_see is plain los in the C
- `parity/ledger/game-mon-ranged.yaml:19` - The decoy target is ported (monster-turn.ts:399-410, monsterIsDecoyed)
- `parity/ledger/game-monster-ai.yaml:65` - monsterTakeTerrainDamage is ported and called by the scheduler (4 references)
- `parity/ledger/game-monster-ai.yaml:68` - Same: the scheduler calls it, so the site is no longer marked deferred
- `parity/ledger/game-obj-list.yaml:41` - object_desc IS ported - describeObject (obj/desc.ts) has 74 references across core and web
- `parity/ledger/game-project-cast.yaml:12` - Monster-spell targeting and the decoy effect are both wired (mon-cast.ts, effect-general.ts:199)
- `parity/ledger/game-project-cast.yaml:26` - The target system is ported (target-loop.ts runTargetLoop); the shell resolves and passes the grid
- `parity/ledger/game-project-cast.yaml:78` - damRed / percDamRed / minusAc are all computed (calcs.ts, gear.ts minusAc) and the live actor carries them; basicPlayerActor is the worldless view
- `parity/ledger/game-project-player.yaml:31` - Decoys ARE modelled: created by EF_GLYPH with the DECOY subtype at effect-general.ts:199, exactly as upstream, and targeted by the monster AI
- `parity/ledger/gen-rooms.yaml:53` - set_pit_type / monPitHook / pit.txt selection ARE ported: gen-monster.ts:205 and room.ts:1341/:1429
- `parity/ledger/message.yaml:16` - messageLookupByName is ported (sound/engine.ts:77) and used by mon/bind.ts:602 and visuals/prefs.ts:397
- `parity/ledger/mon-model.yaml:49` - Monster lore, drop kind resolution (monCreateDrop), colour-cycle visuals, shape-change behaviour and heatmaps are all ported (scentGrid and the heatmap references are live)
- `parity/ledger/mon-timed.yaml:39` - loreLearnFlagIfVisible is ported (mon/lore.ts:150) and called from monster-turn.ts:1294 and mon/timed.ts
- `parity/ledger/obj-randart.yaml:62` - The randart generator IS wired into startGame: birth_randarts is read at session/game.ts:599 and the seed is saved (:459)
- `parity/ledger/player-birth.yaml:32` - generateStats IS ported (player/birth.ts:167) and drives the web birth screen's auto-roller (web/src/birth.ts:1481, :1709)
- `parity/ledger/player-calcs-bonuses.yaml:46` - The weapon/launcher weight analysis is ported (calcs.ts:1240-1252, weightLimit :493)
- `parity/ledger/player-timed.yaml:44` - The notify-suppression queries ARE supplied (makeIncCheckQueries, game/player-side.ts), so the message is silenced as upstream silences it
- `parity/ledger/player-timed.yaml:50` - The lore / knowledge system is ported
- `parity/ledger/project-mon.yaml:43` - place_new_monster and EF_TELEPORT are both ported (mon/make.ts, effect-teleport.ts)
- `parity/ledger/store-bind.yaml:16` - The expansion IS ported (store.ts:173-174)
- `parity/ledger/store-bind.yaml:40` - Stock maintenance is ported (store-maint)
- `parity/ledger/store-price.yaml:27` - The store UI is ported (web/src/shop.ts) and store-bind's deferred list is stale
- `parity/ledger/store-transact.yaml:50` - Both halves are live per store/transact.ts:20-25: object_learn_unknown_rune runs on buy and on sell
- `parity/ledger/ui-display.yaml:78` - The options store is ported (player/options.ts, state.options) and hitpointWarn is supplied (game/display.ts:97)
- `parity/ledger/ui-display.yaml:93` - The options store is ported and persisted in the save
- `parity/ledger/ui-player.yaml:87` - weightLimit is ported (calcs.ts:493) and Burden shows the real value (char-sheet.ts:409 reads upkeep.totalWeight)
- `parity/ledger/ui-player.yaml:96` - Equipment and timed contributions are computed by calcBonuses (statAdd at calcs.ts:844, the timed fold at :1094-1104)
- `parity/ledger/ui-player.yaml:114` - The draw half IS ported, in the front end: charsheet.ts draws the panels and the Self/RB/CB/EB/Best columns (charsheet.ts:3, :12). Term_* positioning has no analogue in a canvas renderer

### `note-is-fix` - The wording sits inside a record of a FIX, not a gap (24)

- `packages/core/src/game/cave-cmd.ts:23` - The sentence records that player_best_digger IS now ported; "was deferred" is history, not a deferral.
- `packages/core/src/game/cave-cmd.ts:33` - Records that count_feats is NOW PORTED and that deferring it had been wrong; easy_open does not exist in 4.2.6.
- `packages/core/src/game/context.ts:816` - "exactly as when it was deferred" records that the curse tick is now installed by the session
- `packages/core/src/game/effect-teleport.ts:32` - The sentence says teleportMonster IS the backing that project-monster deferred - a record of the wiring, not a gap
- `packages/core/src/game/effect-terrain.ts:250` - Records a fixed crash (arena entry, out-of-bounds) and states that deferring to the caller's refresh is what upstream's flag does
- `packages/core/src/game/mon-group.ts:28` - The sentence records a CORRECTION to an earlier wrong claim about monster_can_see, not a deferral
- `packages/core/src/game/monster-turn.ts:24` - "NOW WIRED (was deferred)" is a record of the fix
- `packages/core/src/game/obj-cmd.ts:1736` - Records that the port routes this through combine_pack, which is what happens - a design record, not a gap
- `packages/core/src/game/player-path.ts:28` - "are wired (W2-003 navigate-up/down, explore, pathfind)" records the fix
- `packages/core/src/game/ranged-cmd.ts:24` - The sentence explicitly says the item "had been listed here as deferred, which is" wrong - a correction
- `packages/core/src/game/take-hit-hooks.ts:23` - Records that the port deliberately mirrors upstream's close_game ordering, and names where it happens
- `packages/core/src/obj/make.ts:19` - The sentence records that supercharge and apply_curse ARE ported, pointing at one remaining check in object.ts
- `packages/core/src/obj/make.ts:1235` - Explains why the current behaviour matches upstream at a site that was once a stub
- `packages/core/src/store/store.ts:156` - This line IS the expansion the other notes call deferred
- `packages/core/src/store/transact.ts:13` - The header's LIVE list records that both sides of the rune learn loop are now wired, and says the DEFERRED label is what made the asymmetry read as intentional
- `packages/core/src/store/transact.ts:24` - The sentence records the fix and why the stale label was harmful
- `packages/web/src/main.ts:8410` - Records the state of things before updateFov was wired
- `parity/ledger/game-effect-melee.yaml:44` - "Every formerly-deferred handler is now DONE"
- `parity/ledger/game-effect-teleport.yaml:37` - Records that teleportMonster is the backing for the hook
- `parity/ledger/game-monster-ai.yaml:40` - "NOW WIRED (were deferred)"
- `parity/ledger/obj-desc.yaml:44` - The sentence names objectKnownShadow as the replacement - the divergence, recorded
- `parity/ledger/obj-ignore.yaml:84` - Records that the menu-edit / 'K' trigger of PN_IGNORE IS reproduced directly. The separate become-aware trigger is the gap tracked at game/context.ts:296
- `parity/ledger/options.yaml:31` - Records that the options store replaced the scattered per-seam defaults
- `parity/ledger/store-bind.yaml:54` - Describes the bookseller's data shape, which the expansion at store.ts:173 consumes

### `not-a-deferral` - Ordinary English, not a parity claim (27)

- `packages/core/src/game/cave-cmd.ts:951` - Describes the fallback when the traps module is absent, not a missing feature; trap.ts registers the real disarm and session/game.ts:1698 supplies trapDeps
- `packages/core/src/game/context.ts:332` - Prose about why the options store is optional, and it states the fallback is exact; no feature is claimed absent
- `packages/core/src/game/pickup.ts:16` - Describes the behaviour when the module is not installed; installPickup replaces the stub and is called in the live composition
- `packages/core/src/player/options.ts:27` - Describes how seams read the store, and states the fallback is exact
- `packages/core/src/session/game.ts:898` - A note about JavaScript declaration order, not a parity claim
- `packages/core/src/session/game.ts:2975` - A note about the mod event flood, not a parity claim
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
