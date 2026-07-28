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
- [ ] **C. Wizard/debug prompts** (32) - cmd-wizard.c, wiz-debug.c,
      generate.c:831. The port's debug menu drives most without asking for
      parameters.
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
- [ ] **I. Single missing lines** (8 of 12 done) - each a small fix in a
      function that already exists. DONE: the explore command's four gates,
      `Generation restarted`, `Failed to place player`, `That item is not within
      your reach`. LEFT: the shapechange shop scream, `Cancelled.`,
      `Are you sure? `, `Keep this keymap? `, `Do you want to quit? `, the
      force-name refusal, the glyph picker, the equip-cmp filter.
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
