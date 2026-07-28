# Census punch list

The live worklist for everything the two mechanical censuses found missing,
incomplete or wrong. Opened 2026-07-27 on Aaron's instruction: *"Please
systematically fix/complete the porting of anything you found missing,
incomplete, or wrong using the new census process. If it spans more than one
turn, keep a punch list, so we can stay on top of them across turns/
compactions."*

The two detectors:

```bash
pnpm --filter @neo-angband/cli census
```

```bash
pnpm --filter @neo-angband/cli call-census --shortfall --unmatched
```

Their allowlists (`text-census.test.ts` `KNOWN_ABSENT`,
`call-census.test.ts` `KNOWN_UNUSED`) are the ratchet, and they fail in both
directions. **This file is not a substitute for them** - an item is not done
until its allowlist entry is deleted and the suite is green. What this file adds
is the disposition Aaron gave for each block, so no future turn re-litigates it.

Start of work: 119 text absences, 24 tier-1 call findings (all accounted, 5 of
them tracked LEADs).

## Dispositions Aaron gave, 2026-07-27

| Block | Disposition |
| --- | --- |
| The 5 re-audited misclassifications | Verify each is now *correctly* ported, not merely present |
| Upstream string warts (spelling, double spaces) | Core keeps them **exactly**. One bug-fixes mod item: "Misc. string fixes" |
| wizard/debug prompts | Fix and port |
| `mon_pop` bound | Fix. **Exact parity** |
| mod-pack diagnostics | Correct |
| host-io | **Must not deviate from upstream** - port the equivalents, do not excuse |
| borg gate | Belongs in the borg mod |
| call-census LEADs | Fix |

## Blocks

Counts are text-census absences unless noted. Mark a box only when the
allowlist entry is deleted and the suite is green.

- [x] **A. Verify the 5 re-audited items** (0) - borg gate, uncurse message,
      chest `knownPval`, monster compaction, mod-pack diagnostics. Confirm each
      fires on the right event, not just that the string exists.
- [x] **B. `mon_pop`'s bound** (1) - "Too many monsters!"; exact parity at the
      `level_monster_max` cap, with tests. mon-make.c:646-682.
- [x] **C. Wizard/debug prompts** (32 -> 1) - cmd-wizard.c, wiz-debug.c,
      generate.c:831. The port's debug menu did not merely omit these: it
      PARAPHRASED them, which no census can see. 31 are now exact; the last is a
      recorded divergence (the cmdq_push-failure get_check, unreachable without a
      command queue). Aaron, 2026-07-28: "Paraphrasing is a deviation and is not
      permitted in this port."
- [ ] **D. Mod-pack diagnostics** (16) - the mod SDK's validation surface. One
      job, not sixteen `msg()` lines.
- [ ] **E. host-io** (39, the lore.txt dump moved in from J) - scorefile (8), `.prf` files (8), dumps (7), dev
      logs + wiz-stats (16). Port the equivalent against the port's real storage
      and download layers, and the CLI's `node:fs` writers.
- [x] **F. Store guard messages** (9) - reachable from a mod adding remote
      trade; the current UI is not an argument from the C.
- [x] **G. `move_player`'s known-grid blocked branch** (3) - route the run loop
      (player-path.c:2042) and the whirlwind (effect-handler-attack.c:1838)
      through the same block.
- [x] **H. `drop_near`'s `verbose`** (1) - thread through the port's 15
      `dropNear` call sites; `floorCarry` reports whether the stack is ignorable.
- [ ] **I. Single missing lines** (10 of 12 done) - and only two of the twelve
      really were one line; the rest were whole behaviours the message sat next
      to. DONE: the explore command's four gates, `Generation restarted`,
      `Failed to place player`, `That item is not within your reach`, the
      shapechange shop scream, `Keep this keymap? `, `Do you want to quit? `
      (the whole death menu), `Are you sure? ` (the entire `!`/`^` inscription
      safety net), `Cancelled.` (the run was uninterruptible), and the
      equip-cmp filter (`q`/`!`, plus a swallowed-key defect and a `?`-for-known-
      gear defect on the same screen). The force-name refusal is a re-derived
      DIVERGENCE (arg_force_name comes only from main.c's `-f` switch and a
      browser has no argv). LEFT: the glyph picker, which is the whole visuals
      editor - see the note below.
- [x] **J. Save-failure handling** (2 of 3; the third, `lore save failed!`, is a lore.txt dump and moved to block E) - a `localStorage` write can fail on
      quota; the port neither retries nor says so. ui-game.c:1091-1155.
- [x] **K. Borg gate** (2) - `do_cmd_try_borg` (cmd-misc.c:125-145) in the borg
      mod's activation path; it is what sets `NOSCORE_BORG`.
- [x] **L. Call-census LEADs** (5, call census) - `pile_contains`,
      `pile_last_item`, `object_pack_total`, `pack_is_full` (ui-store.c:662's
      flavor-leak guard), `target_sighted`.
- [x] **M. Savefile-name / panic-save divergences** (2) - re-question the
      "divergence" label per the standing rule.
- [x] **N. Misc. string fixes** (bug-fixes mod) - one mod patch collecting
      upstream's own typos and double spaces. Core is untouched by this.

## Progress log

Newest last. Each entry names the commit and what the census read afterwards.
Nothing goes here until it is committed.

- 2026-07-27 opened at `7fa03bd8d`: 119 absences, 24 tier-1. (An earlier note
  said 23; the allowlist at that commit has 24 entries.)
- 2026-07-27 - **A** and **B**. Two of the three re-audited items I claimed
  fixed last commit were still wrong at a level below the message. `mon_pop` is
  ported exactly (append below the cap, recycle only at it, the
  `character_dungeon` gate); `monster_index_move` did not exist and
  `compact_monsters` skipped the C's unconditional excise pass, so the port never
  closed a hole under either argument; `remove_object_curse` got its dropped
  `message` parameter back. 118 absences, 23 tier-1.
- 2026-07-27 - **L** and **M**. 4 of the 5 LEADs were real gaps, and two of
  them were live defects rather than missing wiring: the ground-reveal in
  update_player_object_knowledge announced every pile on the LEVEL instead of
  only what is underfoot (square_holds_object, obj-knowledge.c:1193), and the
  store let an unaware flavour be bought into a full pack whenever a slot would
  merge, which is exactly the leak ui-store.c:658-662 guards. object_pack_total
  now drives the split-stack aggregate at all three port sites (use, carry,
  drop) so "You have 6 Potions (1st a)." appears at all; targetSighted drives
  show_target / highlight_player, which were flagged no-op options.
  pile_last_item was the one genuine non-gap. **M**: both divergences
  re-derived from the C and upheld, with the reason rewritten to cite it.
  118 absences, 19 tier-1.
- 2026-07-27 - **I**, 4 of 12, and the biggest was not a message at all:
  `do_cmd_explore` (cmd-cave.c:1500) had only its pathfinding half, so explore
  ran while confused, cleared a web for free and ran with monsters in view. The
  two neighbouring web-clear blocks also filtered to TRF.WEB where upstream
  calls square_destroy_trap (all traps). `do_cmd_fire` gained
  item_is_available, which is what a second queued fire command hits when the
  ammo is already gone - it used to say "no suitable ammunition". Generation got
  two separate seams, deliberately not one: cheatMsg (cheat_room-gated restart
  narration, at all three rejection paths) and msg (new_player_spot's UNgated
  placement failure). 114 absences, 19 tier-1.
- 2026-07-27 - **G** and **H**. G was one message set; H was a wrong argument at
  five call sites. drop_near's signature is (…, grid, VERBOSE, prefer_pile) and
  the port had no verbose parameter at all, with preferPile sitting in that slot
  - so chest loot, acquirement, the nice-object drop and both missile drops were
  receiving the C's verbose value as prefer_pile. That is placement, not text:
  prefer_pile drops drop_find_grid's mixed-type penalty, so those objects were
  piling where upstream scatters them. floor_carry regained its `note` in/out
  parameter (obj-pile.c:906) so a merge into an ignored pile silences the
  landing. G: move_player's own known-grid branch says "blocking your way", not
  do_cmd_walk_test's "in the way!", and run_step is its ONLY route in 4.2.6 -
  the whirlwind is not a second one, contrary to the census note, because it
  tests square_ispassable first. 110 absences, 19 tier-1.
- 2026-07-27 - **F** done, and 4 of the 9 were the port SAYING SOMETHING ELSE
  rather than saying nothing: the shop screen had invented "That item is no
  longer in stock.", "You do not have enough gold.", "You cannot remove that -
  it is stuck to you." and "The shopkeeper does not want that." in place of
  upstream's wording, and the Home has its own line for the missing-item case.
  The other 5 are the store-presence guards, now in
  packages/core/src/store/store-cmd.ts and reached from the shop screen, which
  re-resolves store_at from the player's grid per transaction as each
  do_cmd_* does instead of trusting the Store it was opened with. Note
  do_cmd_retrieve is SILENT for a null store while do_cmd_stash speaks - the two
  conditions differ and collapsing them would invent a line. 101 absences,
  19 tier-1.
- 2026-07-27 - **J**. The three messages were the visible end of a real
  defect: roster.ts's setItem SWALLOWED the quota error and returned void, so
  writeSlot / upsertMeta / markDead all claimed success while nothing was
  stored. A failed save could not be reported however carefully the code above
  it was written, and the player kept playing believing they were saved. The
  whole write path now reports, persistSave returns writeSlot's verdict rather
  than "we did not throw", exitToTitle goes through close_game's retry loop
  (prompt_failed_save = true), a failed death tombstone says "death save
  failed!", and a failing autosave says so once per run of failures rather than
  never. 6 tests over a quota-exhausting fake storage, 4 of which catch the
  swallow if it comes back. 99 absences, 19 tier-1.
- 2026-07-27 - **K** and **N**. K: do_cmd_try_borg is now
  packages/borg/src/activate.ts, in the mod where Aaron put it. The gate matters
  because it is what SETS NOSCORE_BORG - without it a Borg-driven character stays
  eligible for the high scores - and core already had NOSCORE.BORG and
  enterScore's report, so this was the only missing piece. Deliberately not
  key-bound: the Borg is not mounted in the shell yet, and whatever mounts it
  calls borgActivate first.
  N: MEASURED before building. 38 upstream literals put two spaces after a
  sentence; a sweep of every msg()/msgt()/get_check() literal for misspellings
  found ZERO. So the catch-all item is one narrow whitespace rule plus an
  exact-match table that is empty on purpose, behind bugfix.miscStrings, applied
  at the single message sink. Documented as BUG_FIXES.md entry 14 with the
  measurement, because a title like "Misc. string fixes" otherwise invites a
  pile of unexamined edits. 97 absences, 19 tier-1.
- 2026-07-27 - **I**, 2 more (6 of 12). Both were behaviour, not text: the
  keymap editor asked its own interpolated question instead of upstream's
  "Keep this keymap? " AND appended "[y/n] " at the call site rather than in the
  get_check helper, and do_cmd_hold had no shapechange gate at all
  (cmd-cave.c:1592-1598) - a shapechanged player could walk into a shop and
  trade, where upstream refuses and a non-Home shopkeeper screams. Found a
  second duplicated C function on the way (player_is_shapechanged exists twice
  with DIFFERENT bodies); used the existing export rather than adding a third,
  and spawned it as its own job. 95 absences, 19 tier-1.

- 2026-07-27 - lint, **I** (1 more, 7 of 12), and **N** re-measured and
  REVERSED. Root `pnpm lint` had been reporting 1404 parse errors since an agent
  worktree landed under the repo root: eslint.config.js now ignores
  `**/.claude/worktrees/**`, and the root command is 0 errors again.
  I: "Do you want to quit? " is death_screen's loop, and the loop was the work.
  Three of death_actions' nine rows were missing (Examine items, Spoilers, Quit)
  behind reasoning that did not survive re-reading the C - "Quit is meaningless
  in a browser tab", when the port has had a leave-play action all along. The
  four exits do not agree on confirming: KTRL('X') and KTRL('N') act at once,
  the Quit row and Escape both ask. Escape asking is a real behaviour change:
  upstream gives a dead character no way back to the map, and the port treated
  Escape as "park on the tombstone". selectFromMenu grew a ctrlCommands layer
  because KTRL('X') is 0x18 and must not collide with the 'x' Examine tag -
  mutation-proven: without it, Ctrl-X opens Examine and Ctrl-N picks New Game.
  Also fixed: death_new_game's get_check had lost its trailing space.
  N: the earlier pass got both the COUNT and the DIRECTION wrong. Not 38
  literals but 15, and upstream is consistent rather than sloppy - 15 double
  spaces after a period against 2 single, so the double space is the convention
  and collapsing it was a restyling. Per Aaron's rule the minority is what gets
  corrected, so the patch is now a four-row exact-match table normalizing UP,
  and the general whitespace rule is gone (it would have rewritten player-typed
  inscriptions at the sink).
  Spelling, answering Aaron's question directly: the earlier sweep covered ONLY
  C string literals. The gamedata descriptions are now swept too, three ways -
  a ~47-entry known-misspelling list (0 hits), doubled words (1 hit, the room
  *named* "Dot dot dot"), and every post-4.2.6 upstream commit touching
  lib/gamedata (zero spelling fixes). The AIngband correction Aaron remembered
  is upstream 736e4ad0e (2020-06-02): obiterate, "can can", untramelled,
  threshhold - all four already correct in the 4.2.6 baseline. 94 absences,
  19 tier-1.

- 2026-07-27 - **I**, 1 more (8 of 12), and it was the largest single find of the
  whole punch list: "Are you sure? " is the `!` / `^` INSCRIPTION SAFETY NET, and
  the port had none of it. Two upstream functions, neither ported:
  key_confirm_command (ui-input.c:1995, called at ui-game.c:565 and four
  ui-context.c sites) scans WORN equipment for `^*` / `^<key>` and asks before a
  command key becomes a command; get_item_allow (ui-object.c:634, called from the
  item menu at :958 and ui-context.c:855) scans the CHOSEN object for `!<key>`
  plus `!*` unless the command is harmless, and asks verify_object's
  "Really <verb> <the object>? ". So `!q` on a Potion of Death, `^t` on your
  armour, `!*` on anything - the thing every player uses - did nothing at all.
  The census could only see one of the two strings because get_item_allow's
  prompt is assembled by strnfmt from fragments under the anchor floor, the same
  blindness that hid object_pack_total.
  Both are now packages/core/src/game/inscription-confirm.ts (13 tests) with the
  shell awaiting them, keeping two upstream warts: `^*` counts DOUBLE for the key
  '*' (the C reuses the "^*" buffer and overwrites only [1]), and only
  get_item_allow applies UN_KTRL_CAP, so a Ctrl-chord looks for `^` plus a
  control byte and asks nothing. Wired at every get_item site with its real cmd
  and its real IS_HARMLESS - inscribe has it, uninscribe pointedly does not
  (cmd-obj.c:196 vs :166). Fixed on the way: selectTargetItem was handing
  inscribe and uninscribe the CMD_NULL key 'A' instead of their own.
  VERIFIED LIVE, which earned its keep: the first wiring typechecked, passed 594
  web tests, and was broken. openModal's finally called render()
  unconditionally, so the confirmation modal's close painted the map over the
  item picker it had just approved - the invisible-title-screen bug one level in.
  It now calls renderBackground (which stands down while a modal remains) and the
  command runs after the modal closes. render-background.test.ts guards the new
  contract instead of the old literal. Proof: {!q} -> "Really quaff a Potion of
  Berserk Strength {!q}? [y/n]", "n" spends no turn; {^t} -> "Are you sure?
  [y/n]", "y" opens the take-off picker and it stays on screen.
  93 absences, 18 tier-1.

  A DETECTOR GAP worth knowing: neither census can see either function. The call
  census's C inventory does not cover ui-*.c at all, so key_confirm_command and
  get_item_allow appear in no tier - not even as unmatched. Anything else living
  only in the UI layer is invisible to both detectors.

  LEFT in I: "Cancelled." (ui-game.c:663 - check_for_player_interrupt, the
  any-key abort during a run / repeat / rest), the arg_force_name refusal, the
  glyph picker's "(up to 5 hex digits):", and the equip-cmp filter prompt.

- 2026-07-28 (2), block I: **the run could not be interrupted.** `run_step`
  re-queues CMD_RUN after every step (player-path.c, ported), so an entire run
  drained inside ONE synchronous runGameLoop call - the browser never got the
  event-loop turn it needs to deliver a keydown, and a keypress is upstream's
  only way to abort a run. Every step was invisible too (nothing drawn until the
  run ended). Same for a pathfind and for an auto-repeated dig's 99 repeats.
  `check_for_player_interrupt` (ui-game.c:645-666), the EVENT_CHECK_INTERRUPT
  handler process_player signals at game-world.c:937, was entirely absent - and
  invisible to both detectors for the reason recorded above.
  Now a host hook at upstream's site with the C's gate unchanged (running, a
  pending repeat, or a rest on a 128-game-turn boundary). A host that can poll
  the keyboard synchronously answers "go"/"cancel"; the browser cannot, so it
  answers "pause" and the loop returns LOOP_STATUS.PAUSE having consumed
  nothing - the queued continuation IS the resume point, so the shell pumps the
  run a step at a time and each step is drawn. No hook installed: nothing
  changes, which is what keeps the CLI harnesses, the borg and the tests driving
  a whole run in one call. The first turn of a call never pauses, or a resumed
  call would spin without stepping; "cancel" is still honoured immediately.
  Keys arriving mid-pump are swallowed AS the abort (that is EVENT_INPUT_FLUSH),
  and driveRest - which owns the rest lifecycle - now says "Cancelled." on its
  keypress arm, the only arm the C reports.
  Proven live: a run east from x=4 stops on its own at x=8; with a key dispatched
  3ms in it stops at x=6, row 0 reads exactly "Cancelled.", and the 's' opened no
  steal prompt. A 50-turn rest cancels the same way. Walking is unchanged.
  Also: a root vitest.config.ts. Agent worktrees live inside the repo, so
  vitest's default globs collected a second copy of every test file - 310
  duplicates, the whole suite run twice, a stale branch able to decide a run on
  master. `pnpm lint` had the same bug and the same fix.
  92 absences.

- 2026-07-28 (3), block I: **the equip-cmp quick filter, plus two defects on the
  same screen.** `prompt_for_easy_filter` (ui-equip-cmp.c:1229) was written off
  in both module headers as a "UI convenience ... not present in this scoped
  port" - a self-issued divergence, and wrong: q / ! is a default part of the
  screen on every platform. Ported faithfully: the 4 capitalisation attempts
  (only 3 for a 3-character stat code, because the 4th writes two characters and
  the `threec` guard stops first), the 2-char column label vs the 3-char stat
  label, and the five category selectors - resistances val >= 1, abilities
  val != 0, hindrances val == 0 (INVERTED: for a hindrance the wanted state is
  off), modifiers val > 0 - with `!` as each one's complement. The model gained
  `vals[]` (equippable.vals) and `label3`, and filters before it sorts.
  Two defects found by opening the screen and pressing keys:
  1. Every nested overlay was DEAD. Each overlay listens on window in the
     capture phase, and this screen's handler - registered first - opens with
     stopImmediatePropagation(), so 'x' opened the compare picker and then ate
     every letter typed into it, and ESC closed the whole screen from underneath
     it. Now detached around nested overlays, the way charsheet.ts already did it
     for its rename prompt. Confirmed broken live first, then fixed.
  2. The grid printed '?' down every column for fully-known mundane gear - a
     Dagger, two torches and soft leather armour, all unknown. equipCmpSummary
     never passed object_fully_known to computeObjectValues, so it read p->obj_k
     alone. This is exactly the defect fixed for the character sheet's resist
     grid (task #93); the screen nobody re-checked still had it.
  Learned in passing, and left faithful: an UNKNOWN value is a huge positive int,
  so unidentified gear satisfies "resists X" in upstream too.
  Proven live: 'q' + "ac" (lowercase, capitalisation attempt 3) empties the list;
  '!' + "Ac" restores all four rows; "zz" reports "Did not find attribute with
  that name; filter unchanged" with the list intact; return alone clears; and the
  compare picker now advances from the first item to the second.
  91 absences.

  LEFT in I: the arg_force_name refusal (ui-player.c:1250 - gated on a
  command-line switch, so the honest question is what its equivalent is here),
  and the glyph picker's "(up to 5 hex digits):" - which is not a prompt but the
  WHOLE visuals editor (ui-knowledge.c glyph_command + display_glyphs: 'v' opens
  a per-entry glyph picker in the knowledge menus, arrows cycle colour, 'i' takes
  a hex code point, 'c'/'p' copy-paste, and each row shows its attr/char). The
  port has no runtime x_attr/x_char override layer at all - TileMap covers the
  graphics mapping only - so this needs that layer, the renderer reading it, and
  the picker UI. Sized, not started.

- 2026-07-28 (4), block I: the **arg_force_name refusal** re-derived and recorded
  as a divergence rather than a gap. The flag is set at exactly one place -
  main.c:436, the `-f` command-line switch - and exists so a HOST can pin the
  character name; the four readers are ui-birth.c:711/1287 (skip the name step),
  ui-player.c:1250 (refuse the rename, the missing message), ui-input.c:1342 and
  ui-options.c:66 (auto-name the dump / pref file instead of asking). A browser
  build is launched by opening a page: there is no argv and the port has no
  deployment-config layer for one to map onto, so the flag cannot become true.
  The rename it guards is ported (charsheet.ts 'c'), and the two file-name arms
  belong with the other dumps in block E. Deliberately NOT invented a URL
  parameter for it - that would be a new feature, not a port.
  Block I is now down to the glyph picker alone, and that one is a subsystem:
  the port has no runtime x_attr/x_char override layer (TileMap is the graphics
  mapping only), so it needs that layer, the renderer reading it, and the picker
  UI. Aaron's call whether that lands before the remaining blocks.

- 2026-07-28 (5), block **C**: the wizard/debug prompts, on Aaron's ruling that
  **paraphrasing is a deviation** and the strings must be exact transcriptions.
  This block was never really "32 missing prompts". The port's debug surface
  *answered its own questions in its own words*, which is the one failure mode
  neither census can detect - a paraphrase occupies the slot the literal should
  hold, so the string reads as absent while the feature looks done. Measured
  across the surface:
  - **Invented prompts** (17): "Create object of which kind (kidx)?" for
    `Create which object (0-%d)? `, "Jump to which dungeon level?" for
    `Jump to level (0-%d): `, "Which race index?" for `Which monster? `,
    "Curse power (0 removes it)?" for `Enter curse power (0 removes): `,
    "Reroll: 0 normal, 1 good, 2 excellent?" for the get_com
    `Roll as [n]ormal, [g]ood, or [e]xcellent? `, and so on.
  - **Invented MESSAGES** (11), where upstream prints its own line or nothing:
    "Cured." for `You feel *much* better!`; "Allocated." / "Monsters banished." /
    "You have lit up the level." / "You feel more experienced." /
    "Pushed any pile off your square." where the C is SILENT; "Changes
    rejected." / "Changes accepted." for `Changes ignored.` and for nothing.
  - **Invented STRUCTURE**: the play-item session was a row menu instead of
    upstream's one get_com line
    `[a]ccept [s]tatistics [r]eroll [t]weak [c]urse [q]uantity [k]nown? `, and
    was missing [s]tatistics and [k]nown entirely; "Edit player" was a field
    PICKER where upstream walks STR/INT/WIS/DEX/CON -> Gold -> Experience in
    sequence with EDIT_PLAYER_BREAK cancel semantics; the two map QUERY commands
    printed a count instead of highlighting the panel through wiz_hack_map; and
    "Noise and scent" asked for one depth instead of stepping 0..99 then 0..49
    with `Depth %d: ` between each.
  - Every prompt also used the wrong INPUT primitive: promptNumber clears the
    screen and draws a titled editor, where get_string / get_quantity keep the
    screen and ask on row 0. overlay.ts now has real `getString` (with
    askfor_aux's 80-column length restriction) and `getQuantity`.
  Four behaviour defects fell out of doing it properly:
  1. **The shared quantity prompt appended to its default instead of replacing
     it.** shop.ts had a hand-rolled get_quantity; its default is "1", so typing
     3 asked for 13 (clamped to the max). askfor_aux's `firsttime` rule is that a
     default is a suggestion you type OVER. That was live in the STORE's "Buy how
     many?" - the one copy is now in overlay.ts and both callers use it.
  2. **wizJumpLevel set NOSCORE_JUMPING unconditionally.** The C sets it only
     inside `if (choose_gen)` (cmd-wizard.c:1365), and the bit is not a cheat
     marker at all: choose_profile consumes it as the one-shot signal to ask
     which profile to build. So the port both mis-flagged the savefile and could
     never reach `Profile name (eg classic): `.
  3. **`Profile name (eg classic): ` was unreachable**, and with it the whole
     wizard profile override (generate.c:824-836). ChooseProfileOptions now takes
     the name, generate threads it, the session consumes it once (clearing it,
     as the C clears the bit), and the jump command asks for it.
  4. **wizCheatDeath never cancelled a pending recall or deep descent**
     (wiz-debug.c:56-74). Both are counters on the player, so a cheated death
     left a word of recall ticking that would then fire from the town you were
     just returned to. That is what the census entry for
     `The air around you stops swirling...` was sitting on - the pattern now
     measures 8 for 8.
  The four commands whose menu row presets an argument (`Acquire good/great`,
  `Create all from tval`, `Learn object kinds`, `Random near/far`) are written the
  way the C writes them - one function, `if (arg absent) ask` - so their prompts
  are live rather than dead code waiting for a keymap layer.
  Ratchet: **packages/web/src/wizard-prompts.test.ts** holds every exact literal
  with its C line AND the 36 paraphrases it replaced, over a comment-STRIPPED
  read of the source (the docblocks quote the paraphrases deliberately). Plus
  live drives that read row 0.
  Proven live in the browser: ^W -> `Are you sure you want to enter wizard mode? `
  -> ^A -> the danger confirm -> Items -> Acquire good shows
  `How many good objects? 1`, typing 3 gives `3` (not 13) and drops three
  objects; Query -> Feature -> 'f' paints 651 '*' glyphs over the panel's floors
  with `Press any key.` in the log and restores the map on a keypress; Play with
  item draws the real wiz_display_item screen (description row 2, `combat = `
  row 4, `kind = ` row 5, `number = ` row 6, the ruled `+---FLAGS---+` row 16,
  vertical flag labels 17-21, the two prt_binary rows 22-23) under the exact
  get_com line, and [s]tatistics asks
  `Roll for [n]ormal, [g]ood, or [e]xcellent treasure? ` then
  `Depth for treasure (0-127): `.
  Also cleared 2 stale call-census tier-1 entries: `lookup_artifact_name` and
  `lookup_ego_item` were ported-but-never-called and the tweak command now uses
  both. 91 -> 59 absences (the allowlist is now 59 literals across 8 reasons:
  block E's host-io set, block D's mod diagnostics, and 4 derived divergences).

- 2026-07-28 (6), block **C** closed: ui-wizard.c's three browsable screens, the
  part of the block that is UI STRUCTURE rather than text and that no census can
  see (none of the three emits a literal the extractor collects).
  - `wiz_create_item` (ui-wizard.c:376): the two-level creator behind 'c' and
    'C'. A tval menu ("What kind of object?" / "What kind of artifact?") over
    object_base_name, then a per-tval submenu ("What kind of %s?" /
    "Which artifact %s? ") over object_kind_name or a make_fake_artifact
    object_desc, each with its "All ..." row; artifact mode lists only tvals that
    HAVE an artifact, and a submenu holds at most 60 rows, both upstream bounds.
    object_base_name and object_kind_name were not ported at all; both are now
    thin calls onto objDescNameFormat, which was.
  - `wiz_display_keylog` (L96): the keypress ring, most recent first, in the C's
    `    %-12s (code=%lu mods=%u)` layout under
    "Previous keypresses (top most recent):" and closed by
    "Press any key to continue.". The shell now keeps a KEYLOG_SIZE=8 ring and
    renders the modifier prefixes keypress_to_text uses (`^x`, `{^SAM}x`). The
    `code` column is the browser's key code point, not upstream's keycode_t -
    this host has no keycode space of its own, and the screen exists to show what
    THIS host actually received.
  - `wiz_proj_demo` (L78): the "PROJ_ types display" menu - every projection by
    its list-projections.h code with the five bolt glyphs in that projection's
    colour, dotted rule on every odd row.
  Both create commands keep their own get_string prompt for the argument-absent
  path, so the menu and the command-level prompt both exist, as in the C.

  **A live defect found by driving the new menu, and the biggest one of the
  session:** menu tag letters were matched CASE-INSENSITIVELY for every menu.
  get_cursor_key (ui-menu.c:480-509) matches exactly unless the menu sets
  MN_CASELESS_TAGS, and only three upstream menus do (death ui-death.c:397,
  options ui-options.c:2074, spell ui-spell.c:250) - because plenty of tables use
  both cases of a letter as DIFFERENT rows. The debug command menu is the worst
  case: 'c' Create an object vs 'C' Create an artifact, 'v' Acquire great vs 'V'
  Create all from tval, and 14 upper-case rows in total ('C' 'V' 'A' 'W' 'H' 'E'
  'G' 'M' 'S' 'P' 'D' 'F' 'T' 'X') that could not be reached by their own letter
  at all - each one silently ran the lower-case command instead. Pressing 'C'
  gave "What kind of object?". Now: exact by default, `caselessTags` opt-in set
  on the death and option menus (the port's counterparts of the C's flagged
  menus). This was invisible to the whole suite because the tests asserted the
  caseless behaviour.
  Proven live: 'C' opens "What kind of artifact?" -> "Which artifact Bows?" with
  "Long Bow 'Belthronding'" in the list; 'c' -> "What kind of object?" ->
  "What kind of Diggers?" with Shovel / Pick / Mattock / All Diggers, ESC
  returning to the tval menu; 'G' draws the PROJ table with ACID / ELEC / FIRE
  and the dotted rules; 'L' shows the last eight keypresses with their codes.

- 2026-07-28, block E part 1 (the scorefile) at `65219b3a8`: **91 -> 51 became
  59 -> 51.** highscore_write (score.c:98-198) is not "write scores.raw": it
  takes a lock, stages scores.new, rotates scores.raw to scores.old, renames the
  staged file into place, rolls back if the rename fails, drops the lock, and
  has a message for every step. The port's store was ONE setItem inside
  `try {} catch {}` with the comment "scores are a nicety, never fatal". Each
  step maps onto a storage key (`<key>.lok` = another TAB writing the same
  table, `.new` = the staged write, `.old` = the rotated table), and file_close's
  flush becomes the READ-BACK - the interesting one, because a quota-truncated
  setItem does not throw, so reading the value back is the only way to see it.
  That is precisely what the empty catch was hiding. Also fixed: read() promised
  to "trust the shape loosely" while highscoreRegularize reads `what` unguarded,
  so a stored `[null]` crashed the Hall of Fame. `score-store.test.ts` drives
  all eight messages by making the matching storage operation fail.

- 2026-07-28, block E part 2 (the dumps) at `edf2ef544`: **51 -> 45.** The port
  had no user directory, and that absence had eaten four things: get_file's
  whole prompt, the READ side (a pref file the game writes and later loads
  cannot exist if the only sink is the Downloads folder), text_lines_to_file's
  staged write with the one message its callers print, and any way to see what
  the game had written. `packages/web/src/userdir.ts` is now a real virtual
  ANGBAND_DIR_USER (one storage key per file, file_exists / write / read /
  delete / move, plus z-textblock.c:703's rotation); the download is the EXPORT
  on top of the file, not the file.
  - `get_file` (ui-input.c:1335) asks "File name: " over the untouched screen,
    refuses an empty or space-led answer, asks "Replace existing file? " when
    the name is taken, and prints "Saving as user/<name>." All five dump call
    sites go through it, as upstream's one hook does.
  - The character dump ('f' + the death menu) runs dump_save and reports
    "Failed to create file %s.new"; player_safe_name (player.c:389) was a regex
    approximation and is now ported.
  - The screen dump was a PNG of the canvas plus the invented "Screen dump
    saved." It now asks "Dump as (H)TML or (F)orum text? " and writes real
    html_screenshot output (ui-command.c:295) - colour runs, entity escaping,
    the forum-mode space quirk, both wrappers. A PNG cannot be pasted into a
    ladder entry, which is the whole point of the command.
  - The wizard's "Write map" wrote NOTHING: it printed a row/column count from
    `wizDumpLevelMap`, a function upstream does not have, standing in for one it
    does. dump_level (gen-util.c:987) is now in core with its glyph precedence
    and its dist[] '*' marking; the stand-in is deleted.
  Two allowlist entries turned out to be census-INVISIBLE rather than done: the
  anchors of "Failed to create file %s" and "Level dumped to %s.html" are
  contained in messages that now exist, so the detector cannot track their own
  call sites (prefs_save, dump_level_simple) separately. Still owed, tracked
  here rather than there.

- 2026-07-28, block E part 3 (spoilers) at `c63464964`: **45 -> 42.** Both
  spoiler entry points (debug menu, death menu) answered with the invented
  "Spoilers are generated by the headless CLI tooling." - untrue of the game the
  player is holding. do_cmd_spoilers (ui-spoil.c:59) is a four-row menu writing
  one file per row. The four generators were already faithful but sat in
  packages/cli; wiz-spoil.c is in the game binary, so they move to
  core/game/spoil.ts (PARITY_BASELINE moved to core/src/version.ts so a core
  module can cite it without importing the barrel). writeUserFileChecked now
  distinguishes file_open failing ("Cannot create spoiler file.") from
  file_close failing ("Cannot close spoiler file.").
  Verified live for all three parts: `)` -> h -> Enter -> "HTML screen dump
  saved." with 22KB of real markup in user/dump.html; `C` -> f -> "Saving as
  user/Adventurer.txt." -> "Character dump successful.", and a second `f`
  offering "Replace existing file? "; ^A -> Files -> M -> both prompts ->
  "Level dumped to user/level.html." with the real ASCII map inside; ^A ->
  Files -> `"` -> the four exact spoiler rows -> 30KB of
  "Spoiler File -- Basic Items (Angband 4.2.6)".

  **Block E, still owed** (the remaining 42 includes these):
  - The .prf group (5 census strings + "Cannot open '%s'."): prefs_save's
    writer with its dump_separator markers and remove_old_dump, the dump
    functions, process_pref_file's parser and its two error reports, and the
    option/visuals menu rows that drive them. The user directory (part 2) is the
    prerequisite and now exists.
  - The four VISUALS dumps and "Visual attr/char tables reset." are blocked on
    the same runtime x_attr/x_char override layer block I's glyph picker needs.
    That coupling is now measured, not guessed: dump_monsters and friends write
    monster_x_attr/monster_x_char, which the port does not have.
  - The dev-log group (15): pricing.log / randart.log / stats.log and the
    wiz-stats disconnect report (disconnect.html via dump_level_simple, which
    part 2 unblocked).
