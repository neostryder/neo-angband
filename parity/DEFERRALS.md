# What is not ported, and what was judged unnecessary

**Dated 2026-08-04. Every deferral note in this repository has a verdict.**

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
and they have been rewritten.** The census is now 228 rows because 139 of those
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

**What is genuinely missing is 96 citations that collapse to about 35 distinct
items,** listed next. None of them is a subsystem. The largest is a debug log.

### One live defect this found and fixed

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
finds **331 items across 72 ledger files**, none yet adjudicated. The one file
worked as a sample — `combat-melee.yaml`, 11 items — came out **ten stale, one
real**, which is the same rate as the first tranche and the reason the live defect
above sat unnoticed: it was in a list nobody re-read.

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
  stale, so this document cannot drift from the census. It also fails on a new
  deferral note with no verdict, and on a verdict with no evidence.
- `ledger-deferred-items.mjs` is deliberately NOT under that ratchet yet: 331
  items are unadjudicated, and a test asserting zero would just be turned off.
  Adjudicate them and then bring it under the same guard.

<!-- BEGIN GENERATED: deferral-report.mjs -->

## Appendix: every row, with its verdict

Generated from `parity/reports/deferral-census.tsv` (228 rows).

| verdict | meaning | rows |
| --- | --- | --- |
| `real` | Confirmed absent and owed | 86 |
| `partial` | Part ported; the note must say which part is not | 10 |
| `divergence` | Deliberately different, with the mechanism named | 30 |
| `n-a` | Not applicable to this port, with the mechanism named | 47 |
| `ported` | Done; the note was stale and has been rewritten | 3 |
| `note-is-fix` | The wording sits inside a record of a FIX, not a gap | 25 |
| `not-a-deferral` | Ordinary English, not a parity claim | 27 |
| | **total** | **228** |

### `real` - Confirmed absent and owed (86)

- `packages/core/src/effects/handlers.ts:78` - monsterDesc and MDESC_DIED_FROM both exist (mon/desc.ts:61) and the killer name still falls back to race.name; the death cause reads "kobold" where upstream writes "a kobold"
- `packages/core/src/game/cave-cmd.ts:1045` - The premise is stale (web/src/main.ts:8090 binds "+" to alterCmd, main.ts:4501) which makes the gap reachable: alter still has no chest branch and no floor-trap disarm branch (do_cmd_alter_aux L969-992)
- `packages/core/src/game/chest.ts:268` - Second copy of the chest OF_TRAP_IMMUNE learn, same empty branch
- `packages/core/src/game/chest.ts:346` - Second copy of the chest OF_TRAP_IMMUNE learn, same empty branch
- `packages/core/src/game/context.ts:297` - PN_IGNORE is SET (session/game.ts:551) and nothing ever reads it, so becoming aware of a kind never triggers the ignore_drop pass. ignoreDropTargets exists (game/ignore-cmd.ts:45, called from web main.ts:3119 for the menu) - it is the notice pass that is missing
- `packages/core/src/game/context.ts:1088` - square_isempty (cave-square.c:604-608) rejects a player trap, a web and any object; the port checks only passable/no-monster/not-player, at 48 call sites. Placement loops can therefore accept grids upstream rejects, which also moves RNG draws
- `packages/core/src/game/effect-attack.ts:687` - monsterDesc(mon, MDESC_DIED_FROM) is available (mon/desc.ts:61) and unused here; effect-handler-attack.c:490 is one of three upstream killer-name sites
- `packages/core/src/game/gear.ts:1173` - pile_insert_end is genuinely absent - the port has no pile links (gear.ts:134). Ordering inside a floor pile can therefore differ from upstream's append-at-end
- `packages/core/src/game/known.ts:750` - path_analyse absent: no pathAnalyse anywhere in the port, so intervening-square terrain is never learned along a path.
- `packages/core/src/game/mon-message.ts:15` - The message QUEUE is genuinely absent - there is no notice_stuff / PN_MON_MESSAGE machinery, so repeats never combine ("3 kobolds die.") and deaths are not shown last. The grammar half is ported verbatim
- `packages/core/src/game/mon-place.ts:267` - list_object oidx bookkeeping absent (no listObject in the port).
- `packages/core/src/game/mon-place.ts:328` - Same absence, second site.
- `packages/core/src/game/project-cast.ts:685` - The monster-source decoy and target-monster branches of effect_handler_TOUCH are genuinely absent; a monster casting a touch effect cannot centre it on a decoy or another monster
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
- `packages/core/src/obj/knowledge.ts:1366` - The ignore-notice pass (PN_IGNORE) is the same gap as game/context.ts:296: the flag is set and never consumed
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
- `parity/ledger/combat-melee.yaml:57` - CORRECTED from stale-doc: the curse terms of object_to_hit / object_to_dam are absent (obj-util.c:296-310). object_weight_one's curse adjustment IS ported (obj/object.ts:791-797), which is what makes the other two clearly owed rather than impossible
- `parity/ledger/game-obj-list.yaml:45` - object_list_format_name's own formatting (the count/label decoration the list screen applies) is still not reproduced, even though the entry carries the real object
- `parity/ledger/game-project-cast.yaml:53` - The monster decoy / target-monster branches of TOUCH, matching game/project-cast.ts:684
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

- `packages/core/src/game/context.ts:1161` - The held-object drop IS handled (the caller runs monster_death first, as the note says); the mimic and targeting bookkeeping remain
- `packages/core/src/game/floor.ts:18` - pushObject is ported and called (effect-general.ts:190, effect-terrain.ts:347); the known-object shadow cave, list_object/delist_object oidx bookkeeping and mimicked-object handling remain
- `packages/core/src/game/monster-turn.ts:1425` - Item pickup and group behaviour are ported (monsterCarry, mon-group.ts); the lore half is largely wired via loreLearnFlagIfVisible. Left partial because the note covers three subsystems at once and only names them collectively
- `packages/core/src/game/ui-entry.ts:26` - The gameplay half of player_flags_timed IS ported - calcs.ts:1094-1104 folds each active timed effect's oflagDup into state.flags. What is missing is ui-entry.c:928's separate timed cache, which lets the sheet mark a flag as temporary
- `packages/core/src/store/transact.ts:26` - Of the four named: the known twin is a divergence and total_weight IS maintained (gear.ts:1283, shown as Burden at char-sheet.ts:409). Autoinscription (the registry exists at game/context.ts:254) and history_find/lose_artifact are genuinely absent here
- `parity/ledger/game-mon-ranged.yaml:31` - The glyph-of-warding exclusion is available (TRF.GLYPH is handled at monster-turn.ts:1536); the arena exclusion goes with arena mode
- `parity/ledger/game-project-monster.yaml:50` - Targeting is wired; the mimic bookkeeping is not (same as game/context.ts:1153)
- `parity/ledger/mon-make.yaml:32` - monCreateDrop and updateMon are ported; monster lore is wired (including lore.txt). Level rating has no port equivalent (0 references)
- `parity/ledger/mon-timed.yaml:29` - The GRAMMAR is ported verbatim (game/mon-message.ts: get_subject, get_message_text, message_pain, the [singular|plural] state machine). What is absent is the QUEUE - add_monster_message -> mon_msg[] flushed by show_monster_messages from notice_stuff's PN_MON_MESSAGE - so repeats are not combined into a counted line and deaths are not shown last. Root cause is the missing notice_stuff/PN_* machinery, not this file.
- `parity/ledger/ui-display.yaml:124` - The sidebar IS drawn, by the front end on a canvas rather than with Term_* calls (web/src/main.ts sidebarModel). update_sidebar's screen-size priority culling and from-bottom placement are genuinely absent (game/display.ts:505 says so)

### `divergence` - Deliberately different, with the mechanism named (30)

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

### `ported` - Done; the note was stale and has been rewritten (3)

- `packages/core/src/game/cave-cmd.ts:36` - STALE. do_cmd_steal is game/steal.ts (installSteal registers "steal"), reachable on s / roguelike s via web/src/main.ts:4515 stealCmd. Grepping do_cmd_steal's port name, not the C name, is what showed it.
- `packages/core/src/obj/object.ts:918` - STALE. object_is_equipped is ported (isEquipped, 15 non-comment sites) and there IS player gear.
- `parity/ledger/player-history.yaml:46` - STALE on its own premise. dump_history is in the character dump (web/src/charsheet.ts:504 calls historyLines under the "[Player history]" header), and character-dump-to-file exists - dumpCharacterFile, now through the host seam.

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
- `parity/ledger/combat-melee.yaml:86` - The comment recording that this list was adjudicated and that ten of its eleven entries had stopped being true
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
