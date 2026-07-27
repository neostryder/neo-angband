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
- [ ] **F. Store guard messages** (9) - reachable from a mod adding remote
      trade; the current UI is not an argument from the C.
- [ ] **G. `move_player`'s known-grid blocked branch** (3) - route the run loop
      (player-path.c:2042) and the whirlwind (effect-handler-attack.c:1838)
      through the same block.
- [ ] **H. `drop_near`'s `verbose`** (1) - thread through the port's 15
      `dropNear` call sites; `floorCarry` reports whether the stack is ignorable.
- [ ] **I. Single missing lines** (12) - each a small fix in a function that
      already exists.
- [ ] **J. Save-failure handling** (3) - a `localStorage` write can fail on
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
