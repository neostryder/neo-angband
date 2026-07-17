# Parity closure execution plan (2026-07-16)

MANDATE (maintainer, verbatim intent): 100% exact parity with Angband 4.2.6.
Everything ported, everything wired, everything running as if the user ran the
original C executable. Only permitted differences: (a) UI mechanics the web
platform necessitates, (b) the additive mod system. Wizard/debug mode and the
cheat options page ARE in scope.

Source of truth for WHAT to fix: parity/GAP_AUDIT.md (code-grounded, file:line
evidence). This file defines HOW: work packages (WP), waves, file ownership,
and acceptance criteria. Orchestrator = the planning model; executors = agent
sessions, one per WP.

## Shared rules for every executor

1. Oracle: reference/src (C) + reference/lib/gamedata. READ-ONLY. When the port
   and this plan disagree with the C source, the C source wins - report the
   discrepancy, do not improvise.
2. Faithful means: same branches, same order of RNG draws, same messages
   (exact strings), same magic numbers, upstream quirks preserved. Cite the C
   file:line in a doc comment on every ported function, matching existing style.
3. FILE OWNERSHIP IS A HARD LOCK. Edit only files in your WP's "Owned" list
   (plus creating new test files beside them). If closing a gap truly requires
   an edit outside your lock, implement everything you can inside it, and end
   your report with a WIRING-NEEDED item: exact file, location, and the code to
   insert. The wave-2/3 wiring packages apply those.
4. Do NOT commit. Do not run the dev server. Do not touch reference/**,
   rpgm/**, or anything outside C:\Repositories\neo-angband.
5. Tests: every gap closed gets vitest coverage citing the C lines it locks in.
   Extend the existing *.test.ts conventions.
6. Verification gate before you finish: `npx tsc -b packages/core` exits 0
   (plus `packages/web` type-check if you touched web), and
   `npx vitest run <the dirs you touched>` all green. Paste the tail of both.
7. Report format: per gap ID -> CLOSED (evidence: files, tests, C refs) or
   BLOCKED (why) or WIRING-NEEDED (exact edit). No completeness claims beyond
   the gap IDs assigned to you.
8. Hygiene: ASCII only. No personal names, no employer/product codenames in
   code, comments, tests, or docs. Attribution style already in the repo.

## Wave structure

- Wave 1 (parallel, disjoint file locks, engine-side): WP-1..WP-8.
- Wave 2 (sequential; owns session/game.ts, game/loop.ts, session/save.ts):
  WP-9 wiring, then WP-10 save/load.
- Wave 3 (sequential; owns web/main.ts + web screens): WP-11 commands,
  WP-12 screens A, WP-13 screens B + options + -more-, WP-14 wizard UI.
- Wave 4: full-suite verification, audit re-mark, parity doc rebuild, commits.

Orchestrator applies WIRING-NEEDED items in the wave that owns the target file,
verifies each wave (tsc + full vitest) before starting the next, and commits
per wave.

---

## WAVE 1

### WP-1 COMBAT (gaps 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 3.1, 3.6)
Owned: packages/core/src/combat/**, packages/core/src/game/player-turn.ts,
packages/core/src/game/ranged-cmd.ts, packages/core/src/player/timed.ts,
packages/core/src/player/spell.ts (+ new test files beside them).
Notes:
- 2.4: route player melee/ranged kills through the exported mon take-hit API
  (fear generation, "flees in terror", message_pain). Do NOT edit
  mon/take-hit.ts (WP-2 owns it) - call its exports.
- 2.5: full player_attack side-effect suite per player-attack.c:669-1012
  (shield bash, TMD_ATT_VAMP, TMD_ATT_CONF, OF_IMPACT quake, bloodlust,
  splash, shapechange blow substitution, COMBAT_REGEN pre-attack mana).
- 2.6: use loc.ts distance() (ay + ax/2) for ranged to-hit per cave-view.c:38.
- 2.10: player_attack_random_monster (player-util.c:794-813) - implement in
  player-turn.ts where confusion/aggravation resolves.
- 3.1/3.6: combat/brand-slay.ts allowOff fix + temporary brands/slays
  (obj-slays.c obj==NULL paths).

### WP-2 MONSTER (gaps 7.1-7.11, 8.2-8.12; 8.1 engine half)
Owned: packages/core/src/mon/**, packages/core/src/game/scheduler.ts,
packages/core/src/game/monster-turn.ts, packages/core/src/game/mon-ranged.ts,
packages/core/src/game/mon-cast.ts, packages/core/src/game/mon-cmd.ts,
packages/core/src/game/mon-death.ts, packages/core/src/game/mon-message.ts,
packages/core/src/game/steal.ts, packages/core/src/game/target.ts.
Notes:
- 8.9/8.10: port mon-desc.c in full (monster_desc grammar: articles,
  possessive, pronouns, offscreen, capital; get_mon_name/plural_aux) as
  mon/desc.ts; replace the ad-hoc "The <race>" call sites you own.
- 8.2: port the spell-message engine (mon-spell.c:47-274): tag substitution
  {name}/{pronoun}/{target}/{type}, ALTMSG_SEEN/UNSEEN/MISS, blind/miss
  selection, per-race alt messages (data already bound at mon/bind.ts:705).
- 8.1: implement the hook object mon-cast.ts expects so a one-line install in
  session/game.ts:924 activates messages -> WIRING-NEEDED with exact code.
- 7.6: the "accepted RNG deviation" is RESCINDED - restore placement-time drop
  rolls + true DROP_PIT/VAULT/SUMMON origins per mon-make.c:1044-1046.
- 7.1/7.7: mimics lie in wait (mon-move.c:1947) + generation mimics get their
  mimicked object (mon-make.c:1049-1051).

### WP-3 PROJECT-EFFECTS (gaps 5.1-5.4, 5.D, 6.1, 6.3-6.12)
Owned: packages/core/src/effects/**, packages/core/src/game/effect-*.ts,
packages/core/src/game/project-cast.ts, packages/core/src/world/project-*.ts
(wherever project-player/project-obj/project-feat/project-monster live).
Notes:
- The theme: monster-cast and decoy sub-branches. Monster-origin EF_DAMAGE
  (mon_take_nonplayer_hit), TMD->MON_TMD mapping, confused-direction /
  target-monster / decoy targeting in the attack family, decoy hit/destroy in
  project_p, LIGHT/DARKEN monster branches.
- 6.2 stays split: the armor-damage function lives in WP-4; you make
  project-player pass minus_ac through faithfully and emit WIRING-NEEDED for
  the live actor flag (session/game.ts:816).
- 5.D: verify shapechange + summon-table wiring at runtime; report findings.

### WP-4 GEAR-QUIVER (gaps 4.1, 4.2, 4.3, 4.4, 1.6, 1.8)
Owned: packages/core/src/obj/gear.ts, packages/core/src/obj/obj-cmd.ts,
packages/core/src/player/player.ts, packages/core/src/player/calcs.ts.
Notes:
- 4.1 is the big one: real quiver[] storage on the player, ammo routing
  (quiver_absorb_num, preferred_quiver_slot, object_is_in_quiver, inven_carry
  quiver branches, pack-slot accounting in calc_inventory), per
  obj-gear.c:163,649,1396 and player-calcs.c calc_inventory.
- 4.2: minus_ac per obj-gear.c:376-438 (slot pick RNG, to_a--, message,
  destroy-on-zero) exported for project-player (WP-3) and the wave-2 actor.
- 4.3: object_learn_on_use XP (obj-knowledge.c:1925-1936) at the obj-cmd use
  sites. 4.4: combine_pack full sweep + inven_can_stack_partial.
- 1.6/1.8: honour birth_start_kit and start-item eopts exclusion in outfit.

### WP-5 OBJECT-KNOWLEDGE (gaps 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.U, 4.5, 4.6,
4.7, 4.8)
Owned: packages/core/src/obj/** EXCEPT gear.ts and obj-cmd.ts (WP-4's locks).
Notes:
- 4.8 is the big one: per-object obj->known twin machinery
  (object_set_base_known, sense/see/touch/grab hooks,
  update_player_object_knowledge, floor sensing, magical/cursed feelings) per
  obj-knowledge.c:820-1218. Where live hooks belong in game files, emit
  WIRING-NEEDED.
- 3.2/3.3 need the TIMED_INC failure-foil tables from player-timed data.
- 3.4 hooks object_value to the known twin (obj-power.c:1253-1259).
- 3.5: unreadable-book rejection loop needs the player class - thread it as a
  MakeDeps field; callers pass it in wave 2 if needed (WIRING-NEEDED).

### WP-6 GEN-TRAPS (gaps 9.2-9.8, 10.3, 10.4, 10.5)
Owned: packages/core/src/gen/**, packages/core/src/game/trap.ts,
packages/core/src/game/known.ts, packages/core/src/world/view.ts.
Notes:
- 9.2: pick_trap kind/level selection at gen time (trap.c:275,317-374).
- 9.3: arena_gen builder; 9.4: get_join_info/stair joins for persistent
  levels (build_staircase already ported, dormant).
- 10.4: passive trap reveal when grids become seen (cave-map.c:236-238,
  cave-view.c:840-842) in known.ts/view.ts.
- 9.7 fix stale comment; 9.8 delete shadowed spreadMonsters.

### WP-7 BIRTH (gaps 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.9, 1.10, 1.11, 1.12)
Owned: packages/core/src/player/birth.ts, packages/web/src/birth.ts.
Notes:
- 1.1: generate_stats point-buy auto-allocation (player-birth.c:816-973).
- 1.2: standard-roller UI loop (roll display, reroll, previous-roll).
- 1.4: roman-numeral suffix (needed by death->new-char-in-same-save).
- 1.5/1.11/1.12 acceptance-flow pieces that live in session/game.ts:1725-1841
  -> implement engine helpers here + WIRING-NEEDED with exact code.

### WP-8 WIZARD-ENGINE (gaps 15.2, 15.4, 15.5; groundwork for 15.3)
Owned: packages/core/src/game/wizard.ts (+ test), packages/cli/src/**.
Notes:
- Port the excluded shells' ENGINE/DATA halves: do_cmd_wiz_play_item,
  _display_item, _stat_item, _edit_player_start, do_cmd_wiz_collect_* per
  cmd-wizard.c; interactive fronts come in WP-14.
- 15.4/15.5: field-for-field verification of cli/spoilers.ts vs wiz-spoil.c
  and cli/stats.ts vs wiz-stats.c; close any drift found; report coverage.
- Define the NOSCORE_* bit model (wizard.h) as exported constants + a Player
  field proposal -> WIRING-NEEDED (player.ts is WP-4's lock; save is WP-10).

## WAVE 2 (sequential)

### WP-9 WIRING (gaps 10.1, 2.1, 2.2, 10.2, 12.3 runtime half, 6.2 live flag,
8.1 install, 5.D fixes, 1.5/1.6/1.12 accept flow, + all wave-1 WIRING-NEEDED)
Owned: packages/core/src/session/game.ts, packages/core/src/game/loop.ts.
- 10.1: call make_noise/update_scent per game-world.c:731-735 in the live loop.
- 2.1/2.2: full player_regen_hp/mana per player-util.c:436-530 (OF_REGEN,
  resting x2, IMPAIR, PF_COMBAT_REGEN mana degen -> convert_mana_to_hp).
- 12.3: store_update on daycount per store.c:1422-1463.

### WP-10 SAVE-LOAD (gaps 12.1, 12.2, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9,
12.10, 15.3)
Owned: packages/core/src/session/save.ts, packages/core/src/store/** (or
store.ts location), session/game.ts load/rebuild sections.
- 12.1 store + Home persistence is the headline (wr_stores/rd_stores).
- 12.4/12.5: full_name + died_from on Player, persisted, feeding scores.
- 15.3: noscore bits persisted + score invalidation per upstream.

## WAVE 3 (sequential; web shell)

### WP-11 COMMANDS (gaps 11.1-11.11)
Owned: packages/web/src/main.ts, packages/web/src/context-menu.ts, plus core
rest-command implementation (player-turn rest path via WP-9's loop hooks).
- 11.1 do_cmd_rest full modes (n turns, & as-needed, ! HP+SP) + disturb rules.
- 11.4 keyboard-parity sweep: bind every dead classic/roguelike key faithfully.

### WP-12 SCREENS-A (gaps 14.1-14.19, 13.1, 12.7 UI half)
Owned: packages/web/src/main.ts (screens sections), packages/web/src/screens.ts,
packages/web/src/game-menu.ts, packages/web/src/charsheet.ts, new screen files.
- Death cluster (tombstone dead.txt, real killer, winner crown.txt, full death
  menu incl. dump/examine/history/spoilers), monster-list screen, knowledge
  menu completion (all ~12 sub-browsers), char-dump completeness.

### WP-13 SCREENS-B (gaps 14.20-14.34, incl. cheat options page 14.31 and the
-more- prompt subsystem making auto_more real)
Owned: packages/web/src/main.ts (menus sections), packages/web/src/screens.ts
(coordinate with WP-12 ordering), packages/web/src/context-menu.ts,
packages/web/src/keymap.ts, packages/web/src/mapview.ts.
- Weight column, fail% columns, spell-state labels/colours, quantity prompts,
  inscription confirmations, context-menu completion, keymap editor, cheat
  options page (with noscore marking), -more- gating, locate banner.

### WP-14 WIZARD-UI (gap 15.1 + remaining 15.x wiring)
Owned: packages/web/src/main.ts (debug section), new packages/web/src/wizard.ts.
- Wizard-mode entry with upstream confirm, noscore marking, full debug command
  menu fronting the WP-8 engine, spoiler triggers where upstream has them.

## WAVE 4 VERIFY
Full `npx tsc -b`, full `npx vitest run`, web build, live smoke (birth ->
town -> dungeon -> combat -> save/load -> death screen -> wizard mode), then
re-mark every gap in GAP_AUDIT.md with evidence, rebuild the parity summary,
and commit wave-by-wave. No completeness claim without this wave passing.
