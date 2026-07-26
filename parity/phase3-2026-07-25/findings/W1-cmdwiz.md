# W1-cmdwiz — resumed lane findings

Resumed from WIP snapshot `c0558ee8d` (recovered mid-flight after a host
reboot, not written by me). Every hunk triaged against reference/src before
anything was extended, per the RESUME brief.

## Inherited-hunk table

| file | hunk | verdict | reference/src | test |
|---|---|---|---|---|
| core/game/obj-cmd.ts | `noLight` + `playerCanRead` (blind/no-light/confused/amnesia gate, exact order) | KEEP | player-util.c:1166-1197, cave-view.c:914-917 | obj-cmd.test.ts "quaff / read command gates" (5 its); mutation-verified |
| core/game/obj-cmd.ts | `quaff` registration wrapped in `gated(...)` (resume-shape gate before the potion pick) | KEEP | cmd-obj.c:917-931 (do_cmd_quaff_potion) vs :900-911 (do_cmd_eat_food, no gate) | obj-cmd.test.ts "do_cmd_quaff_potion is gated..." + "do_cmd_eat_food keeps NO shape gate"; mutation-verified |
| core/game/obj-cmd.ts | `read` registration: gate -> playerCanRead -> item pick, in that order | KEEP | cmd-obj.c:739-758 (do_cmd_read_scroll) | obj-cmd.test.ts "the read gate fires before the item filter..." + "a blind reader is refused even with no scroll at all"; mutation-verified |
| core/game/wizard.ts | `wizChangeItemQuantity` (do_cmd_wiz_change_item_quantity) | REWORK -> KEEP | cmd-wizard.c:484-575 | wizard.test.ts, 6 its (5 inherited + 1 added); mutation-verified. **Build-breaking bug found and fixed**: the hunk re-declared `export const MAX_PVAL = 32767` in wizard.ts, colliding with the pre-existing `MAX_PVAL` export in obj/types.ts (`obj-util.h` MAX_PVAL, already used by object.ts/mon-side.ts) — `tsc -b` failed with TS2308 ambiguous re-export. Fixed by deleting the duplicate declaration and importing the canonical constant from `../obj/types` instead. |
| core/game/wizard.test.ts | 6 its for wizChangeItemQuantity | KEEP (5) + added 1 | — | equipped-item-handle refusal (L494-497) had no test; added one, mutation-verified (see mutation table) |
| web/birth.ts | `discardStatWork()` on race/class re-pick ('*' random and letter-pick, not 'finish' or 'back') | KEEP | player-birth.c:1094-1114 (do_cmd_choose_race/class always call reset_stats+generate_stats+rolled_stats=false); ui-birth.c menu_question:812-836 (EVT_SELECT always re-pushes the choice command, even re-selecting the current row; ESC/BIRTH_BACK issues no command) | No test existed; added birth.test.ts "re-picking class after a point-buy discards the allocation"; mutation-verified |
| web/wizard.ts | `[q]uantity` menu row inserted at index 3 in `runPlayItem`, Accept/Reject indices shifted 3->4, 4->5 | REWORK (collateral regression found and fixed) | cmd-wizard.c:1675-1789 (do_cmd_wiz_play_item prompt is key-based, not position-based, so the port's own row order only has to be internally self-consistent) | **Broke a pre-existing test**: wizard-wiring.test.ts "W2-007 live tweak dispatch" pressed `"d"` for Accept, which is now the Change-quantity row, and hung (`promptNumber` never got matching input) — timed out at 5000ms. Fixed by updating the keypress to `"e"` (Accept's new letter). No test previously covered the `[q]uantity` row's action-index wiring itself; see mutation table / gap note below. |

All 6 inherited hunks land as KEEP. One (`wizChangeItemQuantity`) needed a
real fix (duplicate export breaking the build) before it qualified; one
(`web/wizard.ts` menu insert) needed a downstream test fixed before the suite
was green. Both are now clean and covered.

## Lane table (batch symbols)

| C symbol | verdict | evidence |
|---|---|---|
| `do_cmd_quaff_potion` | PORTED | obj-cmd.ts `quaff` registration; obj-cmd.test.ts |
| `do_cmd_read_scroll` | PORTED | obj-cmd.ts `read` registration + `playerCanRead`; obj-cmd.test.ts |
| `cmd_get_arg_item` / `cmd_set_arg_item` | PORTED (substituted) | wizChangeItemQuantity's `handle !== undefined` branch reproduces the CMD_OK-vs-not fork: handle present == arg pre-supplied (do_cmd_wiz_play_item's `cmd_set_arg_item` before push) -> equipped-item check runs; handle absent == "prompt for it" path, which upstream's own `get_item(... USE_INVEN\|USE_QUIVER\|USE_FLOOR)` (no USE_EQUIP) means the equipped branch can't fire anyway. Verified against cmd-wizard.c:490-506 and :1781-1789. |
| `cmd_get_arg_number` / `cmd_set_arg_number` | PORTED (substituted) | wizChangeItemQuantity takes `quantity` as a plain parameter; the CMD_OK-failure prompt path (cmd-wizard.c:522-537) is replicated by the web caller prompting *before* calling the core fn (web/wizard.ts `promptNumber`) |
| `cmd_get_arg_choice` / `cmd_set_arg_choice` | PORTED (substituted) | `params.update ?? true` matches `cmd_get_arg_choice(...) != CMD_OK \|\| update` (arg absent treated as true) |
| `cmd_get_arg_string` / `cmd_set_arg_string` | N/A | No caller in my batch exercises the string arg; family-wide substitution (typed params replace the tagged union + CMD_OK sentinel) is architectural, not behavior-changing. Not independently re-audited beyond the item/number/choice accessors above — see mutation-table note. |
| `cmd_get_arg_direction` / `cmd_set_arg_direction` | N/A | Same substitution; direction commands are outside this batch (not do_cmd_quaff/read/wiz-quantity/birth/track_object) |
| `cmd_get_arg_target` / `cmd_set_arg_target` | N/A | Same; targeting commands are target.ts's territory (#25/ledgered), out of this batch |
| `cmd_get_arg_point` / `cmd_set_arg_point` | N/A | Same; no caller in this batch |
| `cmd_disable_repeat_floor_item` | N/A | Defends against a stale/reused `struct object *` pointer after a floor item is freed (cave-view.c comment: "avoids access to dangling object references"). The port's gear handles are monotonically increasing (`gear.next`, never reused — gear.ts:77-111) and floor objects are plain GC'd JS references (floor.ts:292-306 `floorObjectForUse`); neither can alias a freed slot, so the class of bug this hack guards against cannot occur. The port's own repeat-last-command (main.ts:4300-4320, `lastRepeatCmd`) has no equivalent restriction and doesn't need one. |
| `track_object` / `track_object_kind` / `track_object_cancel` | N/A | These route "which object populates the tracked-item subwindow" through `upkeep->object`/`object_kind` + a `PR_OBJECT` redraw flag. The port's item-inspection path (object-inspect.ts) takes the `GameObject` directly as a parameter into a pure describe/render call — same pattern already used for `monster_race_track` (target.ts:16-21, ledgered as "lore's"). No global mutable pointer + dirty-flag scheduler exists in the port to route through. |
| `do_cmd_wiz_change_item_quantity` | PORTED | wizard.ts `wizChangeItemQuantity`; wizard.test.ts (6 its); wired at web/wizard.ts runPlayItem `[q]` action |
| `do_cmd_wiz_quit_no_save` / `wiz_confirm_quit_no_save` | **GAP** | See GAP-1 below |
| `do_cmd_wiz_collect_disconnect_stats` / `do_cmd_wiz_collect_obj_mon_stats` / `do_cmd_wiz_collect_pit_stats` (+ ~70 wiz-stats.c/wiz-spoil.c internal statics: add_stats, mean_and_stdv, dump_covar_*, tunnel/grid-count aggregates, scan_for_objects/monsters, spoiler_out_n_chars, etc.) | **GAP** (bundled) | See GAP-2 below |
| `wiz_proj_demo` / `wiz_display_keylog` | **GAP** (bundled, cosmetic) | See GAP-3 below |
| `wiz_create_item` / `wiz_create_item_subdisplay` / `wiz_create_item_subaction` / `wiz_create_item_display` / `wiz_create_item_action` / `get_art_name` / `proj_display` | N/A | Hierarchical Menu browse-by-tval-then-sval UI (ui-menu.c callback plumbing). Port's create-object/create-artifact flows (web/wizard.ts `dispatchDebug` "create-obj"/"create-artifact") replace the two-level browse with a direct kidx/aidx prompt feeding the same `wizCreateObj`/`wizCreateArtifact` core functions — same capability, different (non-browsing) input method. Not a behavior gap the player's session outcome differs by. |
| `wiz_create_artifact` / `wiz_create_nonartifact` / `wiz_acquire_good` / `wiz_acquire_great` / `wiz_create_all_for_tval` / `wiz_learn_all_object_kinds` / `wiz_phase_door` | N/A | Each is a literal one-line "shim" (ui-wizard.c:443-506) that pushes a command with a hardcoded default argument, existing only so C's static keybinding table can bind a zero-arg function pointer. Verified each hardcoded default is reachable in the port with the same value: `wizAcquire({quantity, great})` prompted (web/wizard.ts:493,500 covers good=false/great=true); `wizLearnObjectKinds({level:100})` wired (web/wizard.ts:535); `wizTeleportRandom({range:10})` and `{range:100}` both wired (web/wizard.ts:551,555, phase-door and its long-range sibling). |
| `wiz_create_all_for_tval` distinct from `CMD_WIZ_CREATE_ALL_OBJ_FROM_TVAL` itself | N/A | (see above; the command itself is outside this batch's AREA-WORKED-NO-CANDIDATE list, already matched) |

## GAP blocks

### GAP-1: `do_cmd_wiz_quit_no_save` / `wiz_confirm_quit_no_save`
- ref: cmd-wizard.c:2149-2152 (`quit("user choice")`), ui-wizard.c:432-437 (confirm dialog)
- port: no counterpart in packages/core or packages/web
- what differs: upstream's debug menu offers an immediate abandon-without-saving
  exit (confirmed with "Really quit without saving? "); the port has nothing
  equivalent
- effect: a wizard-mode user cannot abandon a test session without triggering
  whatever save path the shell normally takes on quit
- severity: P2 (debug-only menu entry, but a real player-reachable wizard
  command per the exact-parity mandate)
- fixed: no — this interacts with the save-scum policy (death-terminal,
  no-save-scumming) and needs an explicit decision on what "quit without
  saving" should do in a session-persistent web/PWA shell before it's coded,
  not just a mechanical port. Flagging as a follow-up rather than guessing.

### GAP-2: wiz-stats.c / wiz-spoil.c debug-statistics tooling (bundled)
- ref: cmd-wizard.c do_cmd_wiz_collect_disconnect_stats:585,
  do_cmd_wiz_collect_obj_mon_stats:622, do_cmd_wiz_collect_pit_stats:671, plus
  ~70 internal statics across wiz-stats.c (covariance matrices, tunnel/grid
  aggregates, level-generation batch simulation) and wiz-spoil.c
  (spoiler_out_n_chars)
- port: none
- what differs: a whole developer-only "run N simulated levels and dump
  balance statistics" feature is absent
- effect: none on normal or wizard-mode play; only removes a QA/balance-testing
  tool
- severity: P2 (wizard-mode command family, but zero gameplay reach — it's a
  batch analysis tool that writes to a file)
- fixed: no — disproportionate to this lane (thousands of lines of dev
  tooling); recommend a dedicated lane if this is ever prioritized

### GAP-3: `wiz_proj_demo` / `wiz_display_keylog` (bundled)
- ref: ui-wizard.c:78-93 (PROJ_ type tile/glyph browser), :99-131 (keypress log
  display)
- port: none
- what differs: two debug-only display screens (graphics-tile preview,
  keystroke history) are missing
- effect: none — pure read-only diagnostic screens, no state touched
- severity: P3 (cosmetic/debug)
- fixed: no — lowest priority in the batch, purely visual debug aids

## Mutation table

| mutation | test that caught it | pre-existing suite also caught it? |
|---|---|---|
| obj-cmd.ts: un-gate `quaff` (drop `gated(...)`) | "do_cmd_quaff_potion is gated by player_get_resume_normal_shape" | no (new in this WIP) |
| obj-cmd.ts: neuter `playerCanRead` gate call (`if (false) return 0`) | 5 of the 5 "quaff / read command gates" its (blind/no-light/confused/amnesia/order) | no (new in this WIP) |
| wizard.ts: swap `(MAX_PVAL*number)/pval` operand order | "caps the count so scaled charges cannot exceed MAX_PVAL" | no (new in this WIP) |
| wizard.ts: disable the equipped-handle check (`if (false && ...)`) | "refuses a supplied equipped-item handle..." (added by me — none of the 5 inherited its exercised this branch) | no |
| web/birth.ts: strip all `discardStatWork()` calls | "re-picking class after a point-buy discards the allocation" (added by me — no inherited test covered this) | no |
| web/wizard.ts: menu-index shift (Accept moved d->e) | pre-existing wizard-wiring.test.ts "W2-007 live tweak dispatch" (timed out, not a normal assertion failure) | yes — caught by the PRE-EXISTING suite, not a new test; this is the collateral-regression catch, not a mutation I injected deliberately |

Note: the `web/wizard.ts` action-index wiring itself (which numeric row maps
to which handler) has no dedicated assertion beyond the tweak-dispatch
end-to-end test above; I verified it by direct code reading (array literal
order matches the `action === N` checks) rather than by writing a new
Change-quantity-specific web-layer integration test — building a full
GameState+gear harness in packages/web/src/wizard.test.ts (whose existing
harness is intentionally minimal) was judged disproportionate given
wizChangeItemQuantity's core-level behavior is already mutation-tested.

## Build / suite results

- `pnpm build` (tsc -b): **failed initially** — TS2308 ambiguous `MAX_PVAL`
  re-export from wizard.ts colliding with obj/types.ts. Fixed (see inherited-
  hunk table). Clean after fix.
- `npx vitest run packages/core/src` (hard-timed, no bare `pnpm test`): 222
  files / 2971 tests passed.
- `npx vitest run packages/web/src`: **1 test timed out initially**
  (wizard-wiring.test.ts "W2-007 live tweak dispatch", 5000ms) due to the
  menu-index shift. Fixed (keypress `d`->`e`). Clean after fix: 35 files / 436
  tests passed.

## Closing count

- Inherited hunks: 6/6 KEEP (2 required a fix before qualifying: one build
  break, one downstream test regression).
- Batch symbols: 2 PORTED (quaff/read) + do_cmd_wiz_change_item_quantity
  PORTED = 3 PORTED; 3 track_object family N/A; 6 cmd_get/set_arg family N/A;
  1 cmd_disable_repeat_floor_item N/A; ~14 ui-wizard.c shim/browse-menu
  symbols N/A; 2 GAP bundles + 1 GAP single = 3 GAP findings covering ~75
  individual C symbols (do_cmd_wiz_quit_no_save + confirm, the wiz-stats.c/
  wiz-spoil.c cluster, wiz_proj_demo/wiz_display_keylog).
- Tests added: 3 (obj-cmd.test.ts had 5 already covering quaff/read;
  wizard.test.ts +1 equipped-handle refusal; birth.test.ts +1 discard-on-
  repick; wizard-wiring.test.ts fixed, not added).
- Bugs found and fixed beyond the named batch: 1 build-breaking duplicate
  export (wizard.ts MAX_PVAL), 1 test-hang regression (wizard-wiring.test.ts
  stale keypress).
