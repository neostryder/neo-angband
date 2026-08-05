# Every item that still needs porting

**Dated 2026-08-04.** This is the work list derived from
[DEFERRALS.md](DEFERRALS.md), which is the accounting of what was found. That
document explains *how* each verdict was reached and why 141 notes turned out to
be describing the build order rather than the port. This one is the checklist:
**59 items covering all 95 confirmed-absent citations**, ordered so that the
things a player would notice come before the things only a developer sees, and
so that the two items which unlock a dozen others come first of all.

A citation here is a `file:line` from `parity/reports/deferral-census.tsv` whose
verdict is `real` or `partial`. Nothing else is on this list — a `divergence`,
an `n-a` or a `note-is-fix` row is not work, and the reason is written next to
it in DEFERRALS.md's appendix.

## What "tiered" means here

| Tier | Test for membership |
|---|---|
| **0** | The list cannot claim to be complete until this is done |
| **1** | Unlocks other tiers; doing it later means doing downstream items twice |
| **2** | Changes what *happens* — mechanics, and in two cases the RNG draw order |
| **3** | Changes what the player is *told* — the numbers and text on screen |
| **4** | A whole mode nobody has begun |
| **5** | History, files and logs — real, but nothing a player sees mid-game |
| **6** | Wizard mode and dev tools, owed by the 100 %-including-wizard-mode mandate |
| **7** | A decision to take, not code to write |

Tier order is priority, not dependency; dependencies are named on the item.

Do not tick a box on the strength of having written the function. Every one of
these has a shape where the code exists and nothing reaches it — that is the
trap five separate memories in this repository were written about. A tick means
**the behaviour is reachable in play and a test constructs the case that used to
be wrong.**

---

## Tier 0 — Complete the census

- [ ] **0.1 Adjudicate the 331 ledger `deferred:` items.**
  `parity/reports/ledger-deferred-items.tsv` holds 331 items across 72 files
  that the keyword census structurally could not see: an entry under a
  `deferred:` key inherits its meaning from the key and mostly does not repeat
  the word. None has a verdict. The one file sampled came out ten stale to one
  real — and that one real was the live combat defect. **At the sampled rate
  roughly 30 more real items are in there, so this list is ~85 % of the true
  total, not 100 %.** Adjudicate with
  `node parity/tools/deferral-verdict.mjs --target parity/reports/ledger-deferred-items.tsv`,
  fold the `real` and `partial` ones into the tiers below, then bring the
  scanner under the ratchet the way the census already is.
  Sites: `parity/reports/ledger-deferred-items.tsv`

## Tier 1 — Foundations that unlock other rows

- [ ] **1.1 `notice_stuff` / `PN_*` — the one architectural gap.**
  There is no `noticeStuff` and no `PN_*` pipeline anywhere in the port. This is
  the root cause of both **2.5** (`PN_IGNORE` is set and never consumed) and
  **3.1** (the monster-message queue has nowhere to be flushed from). Build the
  notice pass first and both of those become a small join instead of a
  subsystem. Note that the sibling `PU_*` / `PR_*` update-and-redraw flags are
  *not* owed — the front end recomputes and repaints after every state-changing
  action, which is a ratified divergence with its mechanism recorded at
  `packages/core/src/game/known.ts:153`. `PN_*` is different: it is a queue of
  work, not a dirty bit, and nothing else does that work.
  Sites: `packages/core/src/game/context.ts:297`

- [ ] **1.2 Feed the combat layer into lore.**
  `hitChance` is ported (`packages/core/src/combat/hit.ts:60`) and
  `chanceOfMeleeHitBase` / `chanceOfMonsterHitBase` are right beside it. The
  lore layer simply never receives them, so **every** computed percentage in
  monster recall is missing, along with the spoiler files' hit-chance lines.
  One seam fixes **3.3**, **3.4** and half of **5.7** — eleven of the 95
  citations. Monster spells also need binding to the casting race before
  recall can state spell damage.
  Sites: `packages/core/src/mon/lore-describe.ts:22`

## Tier 2 — It changes what happens in play

- [ ] **2.1 `square_isempty` is weaker than upstream's.**
  `cave-square.c:604-608` rejects a player trap, a web and any object; the port
  checks only passable / no monster / not the player, **at 48 call sites**.
  Placement loops therefore accept grids upstream rejects, which also moves RNG
  draws — so this one can shift a whole level's generation, not just one grid.
  Fix the predicate, then check the 48 sites for any that genuinely wanted the
  weaker test. Wants a test that constructs the three rejecting cases rather
  than asserting today's answer.
  Sites: `packages/core/src/game/context.ts:1088`

- [ ] **2.2 Monster-vs-monster theft ignores `react_to_slay`.**
  `mon-util.c:1548`. The player's own pack is protected correctly
  (`packages/core/src/game/mon-side.ts:421`), so this is an asymmetry, not an
  absence: `reactToSlay` is exported at
  `packages/core/src/combat/brand-slay.ts:121` and `state.slays` is available at
  the game caller. The condition is sitting there commented out.
  Sites: `packages/core/src/mon/steal.ts:32`, `:33`, `:231`, `:234`

- [ ] **2.3 `alter` (`+`) has no chest branch and no floor-trap branch.**
  `do_cmd_alter_aux` (`cmd-cave.c:969-992`). The note excused this because
  alter was not bound to a shell key; the shell has bound it since
  (`packages/web/src/main.ts:8090` → `alterCmd`), which is what makes the gap
  reachable rather than latent.
  Sites: `packages/core/src/game/cave-cmd.ts:1045`

- [ ] **2.4 The chest `OF_TRAP_IMMUNE` rune is never learned.**
  Two copies of the same empty branch — upstream learns the rune where the port
  does nothing.
  Sites: `packages/core/src/game/chest.ts:268`, `:346`

- [ ] **2.5 Run the `PN_IGNORE` notice pass.** *(needs 1.1)*
  The flag is set at `packages/core/src/session/game.ts:542` and nothing ever
  reads it, so becoming aware of an item kind never drops the newly-ignored
  items. `ignoreDropTargets` already exists
  (`packages/core/src/game/ignore-cmd.ts:45`) and the menu / `K` trigger of the
  same pass *is* reproduced — it is only the become-aware trigger that is
  missing.
  Sites: `packages/core/src/game/context.ts:297`,
  `packages/core/src/session/game.ts:542`,
  `packages/core/src/obj/knowledge.ts:1366`

- [ ] **2.6 `known_only` does not exist.**
  `obj-info.c` calls `calc_bonuses` with `known_only = true` at six sites; the
  port's object-inspect passes no such flag, so an unknown property of worn
  equipment can leak into an item-inspection comparison. Thread the flag rather
  than filtering afterwards — upstream's `calc_bonuses` branches on it in
  several places.
  Sites: `parity/ledger/player-calcs-bonuses.yaml:78`

- [ ] **2.7 `pile_insert_end` is absent.**
  The port has no pile links at all (`packages/core/src/game/gear.ts:134`), so
  ordering inside a floor pile can differ from upstream's append-at-end. Order
  is player-visible in the floor list and feeds **3.5**.
  Sites: `packages/core/src/game/gear.ts:1173`

- [ ] **2.8 `path_analyse` is absent.**
  No `pathAnalyse` anywhere, so intervening-square terrain is never learned
  along a path.
  Sites: `packages/core/src/game/known.ts:750`

- [ ] **2.9 `list_object` / `delist_object` oidx bookkeeping.**
  No `listObject` in the port. `pushObject` itself is ported and called
  (`packages/core/src/game/effect-general.ts:190`,
  `effect-terrain.ts:347`); what remains at its site is the known-object shadow
  cave, the oidx bookkeeping and mimicked-object handling.
  Sites: `packages/core/src/game/mon-place.ts:267`, `:328`,
  `packages/core/src/game/floor.ts:18`

- [ ] **2.10 `object_flag_is_known` at the store sites.**
  Zero sites in the port, so a store's buy check cannot gate on known flags.
  Answerable from the synthesised shadow (`packages/core/src/obj/known-object.ts`).
  Sites: `packages/core/src/store/store.ts:232`, `:262`,
  `parity/ledger/store-maint.yaml:34`

- [ ] **2.11 `store_init`'s runtime owner selection.**
  Zero `storeInit` sites, so store owners are not selected at runtime the way
  upstream selects them.
  Sites: `parity/ledger/store-price.yaml:21`

- [ ] **2.12 The `OSTACK_LIST` stacking checks.**
  Two objects the player cannot tell apart must not merge in a list context,
  and a fully-known mismatch must block the merge. The shadow can answer both,
  which is what makes these owed rather than impossible.
  Sites: `packages/core/src/obj/object.ts:923`, `:1000`

- [ ] **2.13 `cmd_disable_repeat_floor_item`.**
  Zero references in the port.
  Sites: `parity/ledger/cmd-core.yaml:25`

- [ ] **2.14 `EF_TOUCH`'s monster-source branches.**
  The decoy and target-monster branches of `effect_handler_TOUCH` are absent, so
  a monster casting a touch effect cannot centre it on a decoy or on another
  monster.
  Sites: `packages/core/src/game/project-cast.ts:685`,
  `parity/ledger/game-project-cast.yaml:53`

- [ ] **2.15 Mimic bookkeeping.**
  Targeting is wired; the mimicked-object bookkeeping is not. Same absence at
  both sites.
  Sites: `packages/core/src/game/context.ts:1161`,
  `parity/ledger/game-project-monster.yaml:50`

- [ ] **2.16 The book out-of-depth value boost.**
  The out-parameter that carries an out-of-depth magic book's value boost is
  not passed back.
  Sites: `packages/core/src/obj/make.ts:1238`

- [ ] **2.17 Autoinscription on store purchase.**
  The autoinscription registry exists (`packages/core/src/game/context.ts:254`)
  and the purchase path does not apply it.
  Sites: `packages/core/src/store/transact.ts:26`

## Tier 3 — It changes what the player is told

- [ ] **3.1 `add_monster_message` has no queue.** *(needs 1.1)*
  The grammar is ported verbatim — `get_subject`, `get_message_text`,
  `message_pain` and the `[singular|plural]` state machine are all in
  `packages/core/src/game/mon-message.ts`. What is absent is
  `add_monster_message` → `mon_msg[]` flushed by `show_monster_messages` from
  `notice_stuff`'s `PN_MON_MESSAGE`. So repeats never combine into
  "3 kobolds die." and deaths are not shown last.
  Sites: `packages/core/src/game/mon-message.ts:15`,
  `parity/ledger/mon-timed.yaml:29`

- [ ] **3.2 The killer's name is a race name.**
  `monsterDesc(mon, MDESC_DIED_FROM)` is defined at
  `packages/core/src/mon/desc.ts:61` and unused at both death sites, so the
  death cause reads "kobold" where upstream writes "a kobold". The third site is
  the high-score entry, which cannot name the real killer at all because it is
  not wired through `GameState` — do that wiring once and all three land.
  `effect-handler-attack.c:490` is one of the three upstream sites.
  Sites: `packages/core/src/effects/handlers.ts:78`,
  `packages/core/src/game/effect-attack.ts:687`,
  `parity/ledger/high-scores.yaml:96`

- [ ] **3.3 Monster recall has no computed percentages.** *(needs 1.2)*
  No hit-chance line for either blow field, no breath default damage, and the
  same holes in the web recall and ego-item recall screens.
  Sites: `packages/core/src/mon/lore-describe.ts:22`, `:132`, `:138`, `:154`,
  `:846`, `:1299`, `packages/web/src/knowledge.ts:1095`, `:1185`

- [ ] **3.4 Monster spells are not bound to the casting race.** *(needs 1.2)*
  Which is why recall cannot show spell damage even once 3.3 lands.
  Sites: `parity/ledger/mon-lore-describe.yaml:55`

- [ ] **3.5 `show_floor` for multiple objects.**
  Zero `showFloor` sites: upstream opens the floor list, the port defers to the
  screen and skips ignored objects.
  Sites: `packages/web/src/main.ts:5904`, `:5925`

- [ ] **3.6 The knowledge browser's thematic grouping columns.**
  This is `ui_knowledge.txt` — the datafile defines the browser's thematic
  `monster_group` grouping, the browser itself is ported, and the grouping is
  not drawn. The flat list is the selectable membership only.
  Sites: `packages/web/src/screens.ts:872`, `parity/ledger/gamedata.yaml:478`

- [ ] **3.7 The character sheet's launcher contribution is 0.**
  The launcher-slot reach plus `KF_SHOOTS_ARROWS` is absent, so the entry
  contributes nothing where upstream contributes the launcher's value. The
  `show_combined` path and the `EQUIPCMP_SCREEN` iteration are the same family:
  the category is compiled and bound, and never iterated.
  Sites: `packages/core/src/game/ui-entry.ts:1392`,
  `parity/ledger/ui-entry.yaml:133`, `:136`

- [ ] **3.8 `update_sidebar`'s priority culling and from-bottom placement.**
  The sidebar *is* drawn, on a canvas by the front end rather than with `Term_*`
  calls. What is absent is the screen-size priority culling and the from-bottom
  placement, which `packages/core/src/game/display.ts:505` says so at.
  Sites: `parity/ledger/ui-display.yaml:124`

- [ ] **3.9 The birth screens answer help with a no-op.**
  `ui-birth.c` offers help on every birth screen; the port swallows the key.
  Sites: `packages/web/src/birth.ts:1051`

- [ ] **3.10 Temporary brands and slays are not shown in object info.**
  The combat half is ported and live
  (`packages/core/src/combat/brand-slay.ts:141-201`,
  `playerHasTemporaryBrand` / `Slay`); only the display of them is missing.
  Sites: `packages/core/src/obj/object-info.ts:962`

- [ ] **3.11 The shape-lore textblock chain.**
  Shapechange effects have no lore chain, and the port greys the entry rather
  than omitting it — a divergence forced by the real gap on the next line, so
  fixing the chain lets the divergence go too.
  Sites: `packages/web/src/main.ts:3697`, `:3701`

- [ ] **3.12 `monster_x_char` / `monster_x_attr`'s secondary glyph.**
  Zero sites.
  Sites: `packages/core/src/mon/lore-describe.ts:1348`

- [ ] **3.13 The flavour text shadow field.**
  The adjective / scroll-title shadow field. Flavour naming itself is ported
  (`packages/core/src/obj/flavor.ts`), so this is narrow.
  Sites: `packages/core/src/obj/known-object.ts:160`

- [ ] **3.14 `object_list_format_name`'s own decoration.**
  The count / label decoration the list screen applies is not reproduced, even
  though the entry carries the real object.
  Sites: `parity/ledger/game-obj-list.yaml:45`

- [ ] **3.15 `player_flags_timed`'s separate UI cache.**
  The gameplay half is ported —
  `packages/core/src/player/calcs.ts:1094-1104` folds each active timed
  effect's `oflagDup` into `state.flags`. What is missing is `ui-entry.c:928`'s
  separate timed cache, which is what lets the character sheet mark a flag as
  temporary rather than permanent.
  Sites: `packages/core/src/game/ui-entry.ts:26`

## Tier 4 — Whole modes nobody has begun

- [ ] **4.1 Arena mode.**
  The `mon_take_hit` arena branch, `hard_centre_gen` / `arena_gen`, the arena
  level generation, and the arena exclusion in monster ranged attacks (the
  glyph-of-warding half of that exclusion *is* available —
  `TRF.GLYPH` is handled at `packages/core/src/game/monster-turn.ts:1536`).
  Sites: `packages/core/src/mon/take-hit.ts:17`,
  `packages/core/src/gen/cave.ts:31`,
  `packages/core/src/gen/generate.ts:11`, `parity/ledger/gen-cave.yaml:49`,
  `parity/ledger/game-mon-ranged.yaml:31`

- [ ] **4.2 The quest system.**
  The quest dungeon profile and its generation.
  Sites: `packages/core/src/gen/cave.ts:2833`,
  `packages/core/src/gen/generate.ts:11`

- [ ] **4.3 Persistent levels, and the town builder's full store generation.**
  Note that `Connector` carries grid + feat rather than a copy of `SQUARE`
  info — a divergence that only starts to matter when persistent levels arrive,
  so decide it as part of this item rather than before it.
  Sites: `packages/core/src/gen/cave.ts:30`

- [ ] **4.4 `room_of_chambers` / cavern callers.**
  The generator entry point is ported and nothing calls it, so no level can
  contain the room. Shipped-is-not-reachable, in the generator.
  Sites: `packages/core/src/gen/gen-monster.ts:350`

## Tier 5 — History, notes, files and logs

- [ ] **5.1 `history_find_artifact` / `history_lose_artifact`.**
  Not wired at either the history layer or the store purchase path.
  Sites: `parity/ledger/player-history.yaml:79`,
  `packages/core/src/store/transact.ts:26`

- [ ] **5.2 Find-on-sight history entries.**
  Blocked on the remembered floor-pile contents, which is the same known-cave
  question as 2.9.
  Sites: `parity/ledger/player-history.yaml:75`

- [ ] **5.3 The player notes command.**
  Sites: `parity/ledger/player-history.yaml:91`

- [ ] **5.4 `options_save_custom` / `restore_custom` / `restore_maintainer`.**
  The per-user customised-defaults files in `ANGBAND_DIR_USER`. Now buildable:
  the host seam and the pref-file writer both exist. Watch the parser traps —
  there is one parse loop and it must not be stricter than `strtol`.
  Sites: `parity/ledger/options.yaml:76`

- [ ] **5.5 `RANDNAME_TOLKIEN` is not loaded.**
  So randart names come from `artifactGenName`'s own generator instead of the
  names datafile.
  Sites: `parity/ledger/obj-randart.yaml:51`

- [ ] **5.6 `randart.log` / `randart.txt`.**
  Upstream's `do_randart` writes it whenever randarts generate, and `exit(1)`s
  if it cannot open it. **193 `file_putf` sites — the largest single item on
  this list, and a debug log no player reads.** The 100 % mandate covers it, so
  the two honest options are to port it or to record a deliberate omission with
  the reasoning; it should not sit here as an open item indefinitely.
  Sites: `packages/core/src/obj/randart.ts:38`

- [ ] **5.7 The spoiler files' missing lines.** *(`:518` and `:519` need 1.2)*
  `timedDesc` / `summonDesc` are unwired, so a handful of activation
  descriptions read worse than upstream's; the hit-chance lines are the lore
  gap again; and `loreDescription` has no upstream-style spoiler flag, so the
  monster spoiler's text differs from `wiz-spoil.c`'s.
  Sites: `packages/core/src/game/spoil.ts:93`, `:518`, `:519`, `:550`

- [ ] **5.8 The randart generator's `property` branch.**
  Needs the timed-effects failure tables.
  Sites: `packages/core/src/obj/randart-build.ts:38`

## Tier 6 — Wizard mode, owed by the 100 % mandate

Do **6.1** and **6.2** first: they are the two prerequisites, and three of the
items below have nowhere to live until they exist.

- [ ] **6.1 `play_item`'s menu shell.**
  Zero `playItem` sites. This is the menu the wizard item commands hang off,
  and its absence is why 6.3 has nowhere to live.
  Sites: `parity/ledger/wizard-debug.yaml:166`, `:167`

- [ ] **6.2 An artifact-created registry.**
  Without it the wizard artifact listing cannot mark what has already been
  generated.
  Sites: `parity/ledger/wizard-debug.yaml:14`

- [ ] **6.3 `do_cmd_wiz_change_item_quantity`.** *(needs 6.1)*
  Zero `changeItemQuantity` sites.
  Sites: `parity/ledger/wizard-debug.yaml:154`, `:164`

- [ ] **6.4 `dump_level` and its file I/O.**
  The file half is now possible through the host seam
  (`packages/core/src/host/io.ts`).
  Sites: `parity/ledger/wizard-debug.yaml:112`

- [ ] **6.5 The `wiz-stats` sampler.**
  Sites: `parity/ledger/wizard-debug.yaml:147`

- [ ] **6.6 The `wiz-stats` histograms.**
  Heavy, and owed by the mandate.
  Sites: `parity/ledger/wizard-debug.yaml:144`

- [ ] **6.7 The `wiz-spoil.c` spoiler entry points.**
  The entry points themselves, as distinct from the spoiler *content* gaps in
  5.7.
  Sites: `packages/core/src/game/wizard.ts:68`

- [ ] **6.8 The wizard command list and its shell follow-ups.**
  The command-list screen, plus the shell follow-up one wizard command needs.
  Sites: `packages/web/src/wizard.ts:498`,
  `parity/ledger/wizard-debug.yaml:87`, `:139`

- [ ] **6.9 The monster-list scan replacement in the world kernel.**
  Sites: `parity/ledger/world-kernel.yaml:27`

## Tier 7 — Decisions to take, not code to write

- [ ] **7.1 `project-path`: wire it or cordon it.**
  A ported function whose only caller would be a UI branch that does not exist.
  Leaving it as it is, is the shipped-is-not-reachable trap; either wire the
  branch or move the function into the cordoned-dead-code list with the reason.
  Sites: `parity/ledger/project-path.yaml:58`

- [ ] **7.2 Split the monster-turn partial into rows that can be closed.**
  The note covers three subsystems at once — item pickup, group behaviour and
  lore — and names them only collectively, which is why it is still `partial`
  when most of what it describes is live (`monsterCarry`, `mon-group.ts`,
  `loreLearnFlagIfVisible`). A row that cannot be closed is a row nobody works.
  Sites: `packages/core/src/game/monster-turn.ts:1425`

- [ ] **7.3 Decide the level-rating question.**
  `monCreateDrop` and `updateMon` are ported and monster lore is wired
  including `lore.txt`; upstream's level *rating* has no port equivalent at all
  (zero references). Either port it or record it as `n-a` with the mechanism.
  Sites: `parity/ledger/mon-make.yaml:32`

---

## What makes this list checkable

`packages/cli/src/port-todo.test.ts` fails if:

1. any file with a `real` or `partial` census row is not cited by a `Sites:`
   line here — so a new confirmed gap cannot be adjudicated and then quietly
   left off the work list;
2. the counts stated at the top of this file (**59 items, 95 citations, 85
   `real` + 10 `partial`**) disagree with the census — so a new `real` row in a
   file that already appears cannot hide inside an existing item;
3. any path named in a `Sites:` line does not exist on disk — so a citation
   cannot rot into fiction after a rename.

The first guard is mutation-checked in the same file, because a coverage test
that cannot fail is the exact instrument this repository has been burned by
most often.

Tier 0 is deliberately **not** under that guard, and the reason is worth
writing down: 331 items are unadjudicated, and a test asserting zero would be
turned off within the day. The honest control is the sentence in 0.1 that says
this list is ~85 % of the true total.
