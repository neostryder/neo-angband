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
- [ ] **E. host-io** (38) - scorefile (8), `.prf` files (8), dumps (6), dev
      logs + wiz-stats (16). Port the equivalent against the port's real storage
      and download layers, and the CLI's `node:fs` writers.
- [x] **F. Store guard messages** (9) - reachable from a mod adding remote
      trade; the current UI is not an argument from the C.
- [x] **G. `move_player`'s known-grid blocked branch** (3) - route the run loop
      (player-path.c:2042) and the whirlwind (effect-handler-attack.c:1838)
      through the same block.
- [x] **H. `drop_near`'s `verbose`** (1) - thread through the port's 15
      `dropNear` call sites; `floorCarry` reports whether the stack is ignorable.
- [ ] **I. Single missing lines** (4 of 12 done) - each a small fix in a
      function that already exists. DONE: the explore command's four gates,
      `Generation restarted`, `Failed to place player`, `That item is not within
      your reach`. LEFT: the shapechange shop scream, `Cancelled.`,
      `Are you sure? `, `Keep this keymap? `, `Do you want to quit? `, the
      force-name refusal, the glyph picker, the equip-cmp filter.
- [x] **J. Save-failure handling** (2 of 3; the third, `lore save failed!`, is a lore.txt dump and moved to block E) - a `localStorage` write can fail on
      quota; the port neither retries nor says so. ui-game.c:1091-1155.
- [ ] **K. Borg gate** (2) - `do_cmd_try_borg` (cmd-misc.c:125-145) in the borg
      mod's activation path; it is what sets `NOSCORE_BORG`.
- [x] **L. Call-census LEADs** (5, call census) - `pile_contains`,
      `pile_last_item`, `object_pack_total`, `pack_is_full` (ui-store.c:662's
      flavor-leak guard), `target_sighted`.
- [x] **M. Savefile-name / panic-save divergences** (2) - re-question the
      "divergence" label per the standing rule.
- [ ] **N. Misc. string fixes** (bug-fixes mod) - one mod patch collecting
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
