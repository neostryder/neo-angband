# Neo Angband parity gap audit (code-grounded, 2026-07-16)

Ground truth: reference/src (Angband 4.2.6 C oracle). Method: read each reference
file in full, diff behaviour against the port, report only concrete gaps with
file:line evidence on both sides. This file is the trustworthy completeness
baseline; the 144-item task checklist is NOT a gap list and must not be trusted.

Status legend: [ ] open, [x] closed+verified.

---

## Executive summary

What is SOLID (verified, not asserted):
- DATA/CONTENT ~100%: all 31 list-*.h enums + all gameplay content match upstream
  exactly (624 monsters, 375 objects, 138 artifacts, 107 egos, 161 vaults, 415 room
  templates - identical name sets). No content missing.
- ALGORITHMS faithful line-for-line: combat math, object power/value, randart pipeline,
  projection geometry, dungeon generation (19/19 rooms, 9/9 profiles), monster AI cores,
  112/112 effect handlers, 91/91 monster spells, targeting, pricing, scores, LOS/view.

The real debt is INTEGRATION + a few missing subsystems, NOT porting. Three buckets:
  A. Ported-but-unwired: faithful, tested code never connected in session/game.ts / loop.
  B. Missing subsystems: quiver, quest-monster spawn, note command, Home save, rest.
  C. Missing/incomplete UI screens: death tombstone, monster list, knowledge menus, etc.

### TIER 1 - game-breaking / core-loop (do first)
- 9.1  Quest monsters never spawn -> Sauron/Morgoth unreachable, win impossible.
- 10.1 Noise/scent never wired -> monsters can't track once LOS breaks (core AI dead).
- 11.1 Rest is a single-turn stub (no rest-until-healed) - everyday gameplay.
- 4.1  Quiver subsystem not implemented.
- 12.1 Home stash permanently lost on save/load.
- 11.3 Note command (:) absent.  11.2 Steal unreachable (engine done, no UI).
- 8.1/8.2 Monster spell-cast messages never appear.
- 7.1/7.7 Mimics don't lie in wait / gen mimics carry no object.
- 14.1/14.2 Death tombstone + real killer not recorded.

### TIER 2 - high-impact combat/economy/UI correctness
- 2.1/2.2/10.2 Regen modifiers (OF_REGEN, resting x2, impair, COMBAT_REGEN).
- 2.4 Monster fear from player attacks (monsters never flee you).
- 2.5 Melee side-effects: shield bash, vampiric, confusion brand, impact quake.
- 2.3 Movement energy_per_move (extra-moves items do nothing).
- 2.6 Ranged to-hit distance formula (diagonals under-penalized).
- 7.3 best_range for archers/breathers/casters (skews cast frequency + RNG).
- 8.9 monster_desc naming grammar (a/the/possessive/pronouns/offscreen).
- 4.2/6.2 minus_ac armor damage + acid halving wiring.
- 10.3/10.4 trapsafe + passive trap revelation.
- 14.20/14.21/14.22 Inventory weight, device fail%, spell-state labels.
- 14.17-14.19 Monster list screen ([).  14.8-14.12 Knowledge sub-category menus.
- 11.4 Keyboard-parity sweep (bind ~15 menu-only commands to faithful keys).

### TIER 3 - fidelity/RNG-stream/completeness
- Birth: point-buy auto-alloc, standard roller UI, history edit, roman suffix,
  birth_know_runes/flavors/start_kit consumption (1.1-1.12).
- Monster-cast/decoy branches across effects/projections (5.1-5.4, 6.x, 7.5, 8.x).
- Object: on-use XP, combine_pack sweep, obj->known twin sensing (4.3/4.4/4.8).
- Curse foil branches, temporary brands/slays, unreadable-book reject (3.2/3.3/3.6/3.5).
- Save fields: owner, daycount/store_update, full_name, died_from, messages (12.2-12.8).
- Char dump completeness, knowledge screens, options screens (14.6-14.34).
- Wizard/debug mode, spoiler generation, stats collection (15.1-15.5) + cheat options
  page (14.31) - maintainer confirmed IN SCOPE 2026-07-16.

### Accepted deviations (maintainer-ratified 2026-07-16; everything else is a gap)
RESCINDED 2026-07-16: wizard/debug mode and the cheat options page were previously
listed here as policy omissions. The maintainer never approved that. Both are now
OPEN GAPS: see cluster 15 (wizard mode) and 14.31 (cheat options page). The only
accepted deviations are:
- Subwindow setup, sidebar mode, redraw, toggle-windows: terminal-only mechanics
  with no canvas meaning. Web shell provides its own equivalents. N/A.
- Use auto-detect (U/X) deliberately split into per-type verbs. OK.
- The mod system (registries/seams) - additive, does not alter vanilla behaviour.
NOTE: auto_more IS a real gap (14.32 requires a -more- prompt subsystem); the
maintainer listed auto_more as a core option, so it must actually function.

---

## Cluster 1: player identity & birth

FAITHFUL: player-race.c, player-class.c, player-history.c, player-quest.c,
player-properties.c (no gaps found).

Gaps (all in player-birth.c / ui-birth.c):

- [ ] 1. HIGH - Point-based auto-allocation (generate_stats) not ported: point-buy
  starts at all-10s instead of the recommended per-class spread.
  C: player-birth.c:816-973 generate_stats (invoked L1101,1112).
  Port: player/birth.ts:14-16 (DEFERRED); web/src/birth.ts:131 resetStats() blank.
- [ ] 2. HIGH - Standard-roller interaction (roll display, reroll, previous-roll)
  entirely absent; stats rolled invisibly engine-side.
  C: ui-birth.c:872-999 roller_command; player-birth.c:1159-1208 do_cmd_roll_stats/
  do_cmd_prev_stats. Port: web/src/birth.ts:367-384 roller stage just advances.
- [ ] 3. MED - History-editing stage not ported (can't view/edit background).
  C: ui-birth.c:1498-1540 get_history_command + edit_text; player-birth.c:1219-1230.
  Port: web/src/birth.ts:7-8 HISTORY_CHOICE skipped.
- [ ] 4. MED - Roman-numeral dynastic name suffix absent (Name II, III...).
  C: player-birth.c:1060-1073 + 1336-1481. Port: ABSENT. Relevant to death->new
  character in same savefile.
- [ ] 5. MED - birth_know_runes / birth_know_flavors defined but never consumed at
  acceptance. C: player-birth.c:1261-1262, 1295-1296. Port: options exist
  (generated/options.ts:50-51) but no learnAllRunes/flavorSetAll in accept flow
  (session/game.ts:1725-1841).
- [ ] 6. MED - birth_start_kit not honoured; always full class kit.
  C: player-birth.c:612-617 player_outfit. Port: session/game.ts:1733 outfitPlayer
  called with no OutfitOptions; gear.ts:484 startKit defaults true.
- [ ] 7. MED - No birth-options ('='), random pick ('*'), or finish-random ('@')
  in birth flow. C: ui-birth.c:848-856, 660-777. Port: web/src/birth.ts none.
- [ ] 8. LOW - Start-item eopts birth-option exclusion not applied.
  C: player-birth.c:620-637. Port: gear.ts:515 DEFERRED.
- [ ] 9. LOW - Quickstart reduced to accept-or-scratch; Y/C/'=' distinctions
  collapsed. C: ui-birth.c:103-138. Port: web/src/birth.ts:286-320.
- [ ] 10. LOW - Name entry caps at 15 chars; upstream allows 31.
  C: option.h:23 PLAYER_NAME_LEN 32. Port: web/src/birth.ts:409 promptText(...,15).
- [ ] 11. LOW - Birth message-recall separator banner not written.
  C: player-birth.c:1245-1249. Port: ABSENT in accept flow.
- [ ] 12. LOW - options_init_cheat not called at acceptance.
  C: player-birth.c:1234. Port: ABSENT.

(Note: player_outfit gold deduction IS implemented at gear.ts:526 despite a stale
"deferred" docstring; roll_hp, get_ahw/history/money, quests reset, spell init,
learn_innate, birth runes all faithful.)

---

## Cluster 3: object generation, power, value, randarts, curses, slays

Verdict: unusually faithful (power math, value quadratic, randart pipeline,
apply_magic/ego all line-for-line incl. upstream quirks). Gaps:

- [ ] 3.1 MED - learn_brand_slay_from_throw passes wrong allow_off: throwing learns
  brand/slay runes from worn off-weapon gear (real bug). C: obj-slays.c:633
  (allow_off=false). Port: combat/brand-slay.ts:297 (allowOff=true).
- [ ] 3.2 MED - append_object_curse omits TIMED_INC "foiled by existing property"
  rejection; generation attaches curses upstream would reject. C: obj-curse.c:159-188.
  Port: obj/object.ts:593 (DEFERRED). Needs player-timed failure tables.
- [ ] 3.3 MED - artifact_curse_conflicts omits same TIMED_INC foil branch;
  remove_contradictory can't strip them. C: obj-curse.c:262-308 / obj-randart.c:2530.
  Port: obj/randart-build.ts:1371.
- [ ] 3.4 MED - object_value doesn't model obj->known partial-knowledge twin;
  variable-power items priced from fully-real object (over-values unknown-rune items
  at shops). C: obj-power.c:1253-1259. Port: obj/value.ts:181-183.
- [ ] 3.5 MED - make_object omits unreadable-book rejection loop; books drop at full
  rate, skips one_in_(5)+extra get_obj_num draws (RNG stream + drop freq). C:
  obj-make.c:1185-1195. Port: obj/make.ts:1189. Needs player class.
- [ ] 3.6 MED - Temporary brands/slays unimplemented (obj==NULL paths) in
  improve_attack_modifier + learn helpers; spell/potion brands give no multiplier or
  rune learning. C: obj-slays.c:378-381,404-406,501-503,558-560.
  Port: combat/brand-slay.ts:136-138,157-159,226,256 (DEFERRED).
- [ ] 3.7 LOW - make_gold omits birth_no_selling 5x inflation. C: obj-make.c:1310-1312.
  Port: obj/make.ts:1229. Only with no_selling option.
- [ ] 3.8 LOW - remove_contradictory_activation no-op; effect_summarize_properties
  (effects-info.c) not ported, redundant randart activations never stripped. C:
  obj-randart.c:2420-2525. Port: obj/randart-build.ts:1432.
- [ ] 3.U UNAUDITED - obj-init.c derived values (num_svals, artifact dummy kinds
  obj-init.c:118-162) not verifiable without the offline content-build tool. Verify.

---

## Cluster 5: effects system

Coverage: 112/112 EF_* handlers registered and real (not stubs). Player-cast paths
complete + faithful. All debt is the monster-cast/decoy sub-branches (tickets
#19 target-monster, #24 decoy), cross-cutting with clusters 6/7:

- [ ] 5.1 MED - EF_DAMAGE: monster-origin sub-branches missing (mon_take_nonplayer_hit
  for t_mon; square_destroy_decoy); port always damages player for monster origin. C:
  effect-handler-attack.c:466-492. Port: effects/handlers.ts:63-84.
- [ ] 5.2 MED - EF_TIMED_INC: monster->monster TMD->MON_TMD mapping + decoy destruction
  missing. C: effect-handler-general.c:576-628. Port: effects/handlers.ts:242-259.
- [ ] 5.3 MED - Attack family (BOLT/BEAM/BALL/BREATH/ARC/LASH/STRIKE/SWARM/TOUCH/
  PROJECT_LOS): monster-cast targeting refinements deferred (confused random dir,
  target-monster, decoy); resolveAimedTarget always aims at player. C:
  effect-handler-attack.c. Port: game/effect-attack.ts:18-24.
  (NOTE breath_dam + powerful-ball-radius are actually implemented - stale comment.)
- [ ] 5.4 LOW - Terrain LIGHT/DARKEN family: monster-target + decoy branches deferred.
  C: effect-handler-general.c. Port: game/effect-terrain.ts:324-328.
- [ ] 5.D DEP - SHAPECHANGE no-ops if player-shapes registry unwired
  (effect-general.ts:710; effect.ts:328); SUMMON depends on summon-type table
  injection (effect.ts:316). Confirm these are wired at runtime.

---

## Cluster 7: monster generation, movement AI, melee, summoning

Verdict: high fidelity (blows, make_attack_normal, critical, get_move/advance/
safety/hiding/flee, door/wall, multiply, summon, alloc, hp, drops all present +
RNG-faithful; monster_attack_monster IS ported in game/mon-cmd.ts). Gaps:

- [ ] 7.1 HIGH - Mimicking monsters not held in wait; take normal turns. C:
  mon-move.c:1947 (continue if monster_is_mimicking). Port: scheduler.ts:119
  (DEFERRED). monsterIsMimicking exists (predicate.ts:188) but never consulted.
- [ ] 7.2 MED - Monsters take no terrain damage (lava). C: mon-move.c:1972
  monster_take_terrain_damage. Port: scheduler.ts:124 (DEFERRED).
- [ ] 7.3 MED - best_range left = min_range for archers/breathers/casters (no +3 /
  breather MAX). C: mon-move.c:287-300. Port: monster-turn.ts:408. Also skews
  monster_can_cast chance*=2 distance (mon-ranged.ts:174).
- [ ] 7.4 MED - monster_near_permwall omitted from PASS/KILL_WALL beeline: (a) skips
  randint0(99)<5 RNG draw (desync), (b) wall-passers beeline into perm walls + stick.
  C: mon-move.c:416. Port: monster-turn.ts:485-488.
- [ ] 7.5 MED - Decoy target ignored by ranged/cast AI (movement AI honors decoys, so
  subsystems disagree). C: mon-attack.c:65-84. Port: mon-ranged.ts:56-61.
- [ ] 7.6 LOW - Placement-time drops moved to death; DROP_PIT/VAULT/SUMMON origins
  flattened to ORIGIN.DROP; never-killed monsters' drops never rolled (accepted RNG
  deviation). C: mon-make.c:1044-1046. Port: mon-place.ts:200-207 / mon-death.ts.
- [ ] 7.7 MED - Generation-spawned object-mimics have no mimicked object
  (mon.mimickedObj=0); with 7.1 they don't function as mimics at all. C:
  mon-make.c:1049-1051. Port: mon-place.ts:28-33.
- [ ] 7.8 LOW - react_to_slay pickup-safety not applied; monster grabs/crushes items
  that would hurt it. C: mon-move.c:1420-1421. Port: monster-turn.ts:1224-1226.
- [ ] 7.9 LOW - TMD_COVERTRACKS doesn't reduce monster sight. C: mon-move.c:95-97.
  Port: monster-turn.ts:252 (DEFERRED, needs player timed).
- [ ] 7.10 LOW - No disturb() before a monster casts. C: mon-attack.c:465.
  Port: mon-ranged.ts:254-255.
- [ ] 7.11 LOW - monster_death mimicked-object deletion + quest_check deferred. C:
  mon-util.c:958,1005. Port: mon-death.ts:264.

---

## Cluster 2: player mechanics (calcs/timed/attack/spell)

Verdict: core math modules faithful statement-for-statement. Gaps at
integration/game layer (many = unwired ported code):

- [ ] 2.1 HIGH - player_regen_mana omits OF_REGEN x2, resting x2, PF_COMBAT_REGEN
  mana degen, OF_IMPAIR_MANA /2, SP-degen->convert_mana_to_hp (Blackguard). C:
  player-util.c:487-530. Port: game/loop.ts:172-178.
- [ ] 2.2 MED - player_regen_hp omits OF_REGEN x2, resting x2, OF_IMPAIR_HP /2. C:
  player-util.c:456-464. Port: game/loop.ts:146-166.
- [ ] 2.3 MED - energy_per_move (num_moves / OBJ_MOD_MOVES) never applied; every step
  flat move_energy; extra-moves items do nothing. C: player-util.c:323-328. Port:
  game/player-turn.ts:130/153 (numMoves computed calcs.ts:1284 but unused).
- [ ] 2.4 MED - Player melee+ranged bypass full mon_take_hit: no fear generated, no
  "flees in terror"; ranged omits message_pain. C: player-attack.c:868,1191-1195.
  Port: combat/melee.ts:266-270, game/ranged-cmd.ts:116-124.
- [ ] 2.5 MED - Melee blow side-effects all absent: shield bash (PF_SHIELD_BASH),
  vampiric (TMD_ATT_VAMP), confusion brand (TMD_ATT_CONF), impact earthquake
  (OF_IMPACT), bloodlust over-exert, splash, shapechange blow substitution,
  COMBAT_REGEN pre-attack mana. C: player-attack.c:669-978,1002-1012. Port:
  game/player-turn.ts:108-121 (pyAttack only).
- [ ] 2.6 MED - Ranged to-hit distance uses Chebyshev max(|dx|,|dy|) not ay+ax/2;
  diagonal shots under-penalized. C: cave-view.c:38-46, player-attack.c:162. Port:
  game/ranged-cmd.ts:86-89 (correct distance() at loc.ts:62 unused).
- [ ] 2.7 LOW-MED - TMD_POWERSHOT missile piercing deferred; every shot stops at
  first monster. C: player-attack.c:1092-1095,1198-1201. Port: ranged-cmd.ts:129-130.
- [ ] 2.8 LOW-MED - player_inc_check learning/message omitted (equip_learn_flag,
  update_smart_learn, "You resist the effect!"). C: player-timed.c:945-953. Port:
  player/timed.ts:116-142.
- [ ] 2.9 LOW - player_set_timed notify-suppression (temp_resist/oflag_syn) +
  print_custom_message weapon-name substitution deferred. C: player-timed.c:828-843.
  Port: player/timed.ts:180-184.
- [ ] 2.10 LOW - player_attack_random_monster ("angrily lash out") not ported
  (confusion/aggravation aimless swing). C: player-util.c:794-813. Port: ABSENT.
- [ ] 2.11 LOW - spell fail default afraid check reads only timed[AFRAID], not
  player_of_has(OF_AFRAID). C: player-spell.c:424. Port: player/spell.ts:310.
- [x] 2.X FALSE ALARM (verified) - quaff/read/eat/use-staff/aim-wand/zap-rod/activate
  are NOT stubs at runtime. STUBBED_COMMANDS (player-turn.ts:184) is only the DEFAULT
  registry; installObjCommands (obj-cmd.ts:795, called session/game.ts:959) replaces
  them with real handlers, and the web shell wires them (main.ts:1161,3355). Item use
  works. The agent checked only the default registry, not the session install.

---

## Cluster 6: projections (project.c + feat/mon/obj/player)

Coverage: 56/56 PROJ types handled; geometry (path/blast/arc/falloff/thrust) faithful.
Gaps:

- [ ] 6.1 MED - PROJ_DARK_WEAK player blindness handler absent (cursed gear
  effect:SPOT:DARK_WEAK deals no blindness). C: project-player.c:607-619. Port:
  player-side.ts:439 (no case).
- [ ] 6.2 MED - PROJ_ACID minus_ac acid-halving never applied live: basicPlayerActor
  hardcodes minusAc:false. C: project-player.c:69. Port: project-cast.ts:195,
  game.ts:816.
- [ ] 6.3 LOW - Decoy hit-detection/destruction absent in project_p. C:
  project-player.c:822-825. Port: project-player.ts (deferred).
- [ ] 6.4 LOW - update_smart_learn absent for monster sources in project_p. C:
  project-player.c:852. Port: project-player.ts.
- [ ] 6.5 LOW-MED - KILL_TRAP project_o chest unlock absent. C: project-obj.c:355-370.
  Port: project-obj.ts:106.
- [ ] 6.6 LOW - Mimic reveal on object destruction absent. C: project-obj.c:561-565.
  Port: project-obj.ts:144.
- [ ] 6.7 LOW - protected_obj not threaded in projectObject. C: project-obj.c:537.
- [ ] 6.8 LOW - project_f empty-handler types set obvious=true vs C false (latent,
  not live). C: project-feat.c:581-675. Port: project-feat.ts:289-291.
- [ ] 6.9 LOW - expose_to_sun/is_daytime day-night terrain interplay absent. C:
  project-feat.c:181,334,363,473. Port: project-feat.ts:11-18.
- [ ] 6.10 LOW - arena_level unique-damage cap missing in project_m. C:
  project-mon.c:1044. Port: project-monster.ts:282.
- [ ] 6.11 LOW - LIGHT/SOUND player_inc_check message gating dropped (dazzled/noise
  shown even if resisted). C: project-player.c:259,328. Port: player-side.ts:224,262.
- [ ] 6.12 LOW - inven_damage obj->known twin + ignore_item_ok + gear_to_label letter
  deferred (display/knowledge only). C: project-obj.c:86-90,146,546-569. Port:
  project-obj.ts:16-17.

---

## Cluster 8: monster spells, timed, lore, grouping, naming

Coverage: 91/91 RSF_ spells present + data-driven executed; timed/predicate/lore
engines faithful. Gaps (mostly unwired hooks + naming):

- [ ] 8.1 HIGH - Monster spell-cast announcements never appear: message hook exists
  (mon-cast.ts:140) but installMonsterCasting (game.ts:924) passes no hooks. C:
  mon-spell.c:369. IMPACT: no "The X breathes fire / points at you" lines.
- [ ] 8.2 HIGH - Spell-message tag substitution + per-race alt messages not
  implemented ({name}/{pronoun}/{target}/{type}, ALTMSG_SEEN/UNSEEN/MISS, blind/miss
  selection). C: mon-spell.c:47-274. Port: ABSENT (data bound mon/bind.ts:705 unread).
- [ ] 8.3 MED - RSF_HEAL_KIN always pruned (hasInjuredKin never supplied);
  find_any_nearby_injured_kin/choose absent. C: mon-attack.c remove_bad_spells,
  mon-util.c:885. Port: mon-ranged.ts:113, game.ts:924.
- [ ] 8.4 LOW - "X tries to cast a spell, but fails." never shown (failMessage
  unwired). C: mon-attack.c:460. Port: mon-ranged.ts:250.
- [ ] 8.5 LOW - unset_spells + update_smart_learn not ported (only under ai_learn,
  off by default). C: mon-spell.c:470-561, mon-util.c:788. Port: ABSENT.
- [ ] 8.6 MED - Resisting a timed effect via race flag doesn't teach lore. C:
  mon-timed.c:107-110. Port: mon/timed.ts:102-103.
- [ ] 8.7 LOW - MON_TMD_CHANGED shapechange no-op unless shape hook threaded (faithful
  on wired path). C: mon-timed.c:196-207. Port: mon/timed.ts:171.
- [ ] 8.8 MED - monster_can_be_scared always group size 1; packs lack group fear-save.
  C: mon-predicate.c:296. Port: mon/predicate.ts:201-219, take-hit.ts:78.
- [ ] 8.9 MED - Full monster_desc not ported: no indefinite ("a kobold"), possessive
  ("the kobold's"), gendered pronouns, "(offscreen)", MDESC_CAPITAL. C:
  mon-desc.c:108-244. Port: ad-hoc "The <race>" (mon-message.ts:53, steal.ts:79,
  target.ts:413).
- [ ] 8.10 LOW - get_mon_name/plural_aux (list counts + pluralization) not ported. C:
  mon-desc.c:27-64. Port: ABSENT (mon-list.ts has data, not label).
- [ ] 8.11 LOW - spell_check_for_fail_rune (NEXUS rune on save) unwired. C:
  mon-spell.c:291-304,383. Port: mon-cast.ts:159.
- [ ] 8.12 LOW - disturb(player) on monster cast unwired. C: mon-spell.c:368,
  mon-attack.c:465. Port: mon-cast.ts:139.

---

## Cluster 10: cave state, world turn, terrain, traps

Verdict: los/view/lighting + process_world ordering faithful. Gaps:

- [ ] 10.1 HIGH - make_noise + update_scent never called in live loop; noise/scent
  heatmaps stay zero, so monsters CANNOT track through corridors / around corners once
  LOS breaks. Ported fns (world/flow.ts:31,90) called ONLY from tests. C:
  game-world.c:731-735. Port: game/loop.ts:332-333 (DEFERRED; comment is wrong -
  monster-turn.ts:257-269 DOES read the heatmaps).
- [ ] 10.2 MED - HP/mana regen omits resting x2 + equip/class modifiers (dup of
  2.1/2.2). C: player-util.c:436-530. Port: game/loop.ts:146-178.
- [ ] 10.3 MED - hit_trap ignores player_is_trapsafe (TMD_TRAPSAFE); trap-safe player
  still triggers floor traps (dead stub). C: trap.c:515-523. Port: game/trap.ts:322-325.
- [ ] 10.4 MED - No passive trap revelation when a grid becomes seen; invisible traps
  never spotted before stepping on them (outside detection). C: cave-map.c:236-238,
  cave-view.c:840-842. Port: game/known.ts:559-571, world/view.ts:453-476.
- [ ] 10.5 LOW - pick_trap/place_trap omit trapdoor legality guards
  (birth_levels_persist skip TRF_DOWN; arena forbids TRF_DOWN). C: trap.c:317-319,
  370-374. Port: game/trap.ts:227-230,248-274.

---

## Cluster 12: stores, targeting, save/load, scores

Verdict: targeting, price_item, stocking/maintenance, score.c all faithful (4.2.6
has no haggling/services - correct to omit). Save/load has real data-loss gaps:

- [ ] 12.1 HIGH - Store stock + HOME inventory never persisted; Home stash PERMANENTLY
  LOST across save/load (regenerated empty on load). C: save.c:744-765 wr_stores,
  load.c:1196-1262. Port: SavedGame has no stores field (save.ts:658-780);
  game.ts:1621-1641 rebuilds empty.
- [ ] 12.2 MED - Current shopkeeper (owner) not persisted; re-randomized each town
  build (changes sell price caps). C: save.c:754, load.c:1219. Port: store.ts:106-125.
- [ ] 12.3 MED - store_update (daycount restock + owner shuffle) unimplemented;
  daycount not serialized; stores fully re-rolled each town entry. C: store.c:1422-1463,
  save.c:963. Port: loop.ts:295 increments daycount but never read/saved (context.ts:316
  comment is wrong).
- [ ] 12.4 MED - Player full_name not modeled on Player nor persisted. C: save.c:422,
  load.c:661. Port: Player has no name field; buildScore pulls from external dep.
- [ ] 12.5 LOW-MED - player->died_from not modeled/persisted. C: save.c:424. Port:
  score dep only.
- [ ] 12.6 LOW - Dropped persisted player fields: resting_turn, skip_cmd_coercion,
  unignoring, opts.name_suffix, old_grid (only saved inside arena). C: save.c
  wr_player. Port: save.ts:412-498.
- [ ] 12.7 LOW - save_charoutput (CharOutput.txt) not ported. C: save-charoutput.c,
  savefile.c:392. Port: ABSENT.
- [ ] 12.8 LOW - Message log not persisted (reload = empty log). C: save.c:339-353,
  load.c:471-495. Port: no message field in SavedGame.
- [ ] 12.9 LOW - store_will_buy omits object_flag_is_known check (unreached at 4.2.6
  baseline data; matters only for flag-qualified mod buy rules). C: store.c:550-552.
  Port: store.ts:191-192.
- [ ] 12.10 LOW - find_inven (owned-quantity UI count) not ported. C: store.c:1515-1644.
  Port: ABSENT.

---

## Cluster 9: dungeon generation

Verdict: exceptionally faithful. Room builders 19/19, profiles 9/9 all present +
behaviorally ported (themed pits/nests/vault monsters NOT simplified). Gaps:

- [x] 9.1 HIGH - CLOSED (2026-07-16). Quest-monster placement wired: generateLevel now
  takes questSpawns (QuestSpawn[]) and places max_num of each after build/before feeling
  calc, skipping uniques already alive (cur_num>0). Caller questSpawnsForDepth (session/
  game.ts) resolves player.quests where level==depth via reg.monsters.races. Sauron/
  Morgoth now spawn; questCheck + populateFromLevel complete the win path. Tests:
  gen.test.ts "quest monster placement" (3, incl. no-spawn regression + unique skip).
  C: generate.c:1172-1191. tsc clean.
- [ ] 9.2 MED - place_trap selects no trap kind/level at gen time; only bare grid
  recorded (type punted to runtime). C: trap.c:356->275 pick_trap, gen-util.c:791.
  Port: gen/util.ts:1104-1107 (markTrap only). [Related to 10.3/10.4/10.5.]
- [ ] 9.3 MED - arena_gen builder not ported (arena levels unavailable). C:
  generate.c:1094-1113. Port: cave.ts:29 (deferred).
- [ ] 9.4 MED - Persistent levels: get_join_info / stair-join population inert;
  chunk.join stays empty; birth_levels_persist dungeons unsupported (build_staircase +
  cavern join stairs ported but dormant). C: generate.c:893,1203-1214. Port:
  generate.ts:69-80.
- [ ] 9.5 LOW - chunk_validate_objects not ported (no observed effect). C:
  generate.c:1244. Port: ABSENT.
- [ ] 9.6 LOW - sanitize_player_loc not ported (arrival fixup; newPlayerSpot avoids
  vaults at gen time). C: generate.c:1265-1339. Port: ABSENT.
- [ ] 9.7 DOC - cave.ts:26 stale comment claims moria/lair/gauntlet/hard_centre not
  enabled for choose(); they ARE live (cave.ts:2592-2621). Fix comment.
- [ ] 9.8 DEAD - simplified spreadMonsters in util.ts:1737-1772 shadowed by faithful
  gen-monster.ts:346 (maintenance hazard). Remove.

---

## Cluster 13: data tables + game content (GOOD NEWS)

Effectively 100%. All 31 list-*.h enums MATCH at count AND name level (codegen'd from
reference headers). All gameplay content matches upstream on record count + name sets:
624 monsters, 375 objects, 138 artifacts, 107 egos, 161 vaults, 415 room templates,
294 flavors, 40 pits, 40 traps, 27 curses, etc. No truncation, no enum drift.

- [ ] 13.1 LOW-MED - ui_knowledge.txt NOT compiled to pack: its 48 explicit
  monster-knowledge browser categories (order/names) absent; web/screens.ts derives
  grouping differently. Affects knowledge-menu grouping only, not balance. C:
  gamedata/ui_knowledge.txt. Port: content specs defer it.
- (old_class.txt correctly excluded - Angband itself doesn't load it. Not a gap.)

---

## Cluster 11: player command surface (engine broad; SHELL WIRING is the gap)

Core registry installs real handlers for nearly all commands. Of 72 canonical keypress
commands: 34 present+faithful, 15 menu-only (original key unbound/repurposed), 3 stubbed,
20 absent. The gaps are almost all in web/main.ts keyboard wiring (L3239-3463), not the
engine. Wizard/debug (~50 cmds) intentionally absent on web (Low).

HIGH:
- [ ] 11.1 HIGH - Rest (R) stubbed to single-turn hold; no do_cmd_rest N-turn /
  rest-until-recovered prompt. C: ui-game.c:142, do_cmd_rest/textui_cmd_rest. Port:
  player-turn.ts:212 (rest=holdAction), context-menu.ts:71-74; 'R' key unbound.
- [ ] 11.2 HIGH - Steal (s) unreachable: engine complete (steal.ts:162) but no shell
  path ('s' unbound, context entry disabled). C: ui-game.c:216. Port: context-menu.ts:16.
- [ ] 11.3 HIGH - Take notes (:) do_cmd_note (/say, /me) ABSENT everywhere. C:
  ui-game.c:211, cmd-misc.c:88. Port: ABSENT.

MED:
- [ ] 11.4 MED - Keyboard-parity systemic: ~15 implemented core commands reachable only
  via menus (keys unbound or repurposed): tunnel (T/^T), close (c), alter (+), explore
  (p, shadowed by cast), run original-keyset (./,), abilities (S, shadowed by save),
  center-map (^L/@), retire (Q), browse-book, ignore-item (k/^D), Ctrl-X save-quit.
  Classic-keyset players hit dead keys. Port: main.ts:3239-3463.
- [ ] 11.5 MED - Visible monster list ([) unwired (core mon-list.ts exists). Port:
  main.ts, context-menu.ts:112 disabled.
- [ ] 11.6 MED - Fire-at-nearest (h/TAB) quick-fire absent (full 'f' exists). C:
  ui-game.c:151.
- [ ] 11.7 MED - Jump / walk-into-trap (W,-) CMD_JUMP absent (no core cmd). C:
  ui-game.c:153, cmd-core.c:81. Port: context-menu.ts:16-17,135 disabled.
- [ ] 11.8 MED - Browse book standalone (b/P) only reachable inside cast/inspect flow.
  C: ui-game.c:173. Port: main.ts:1725.
- [ ] 11.9 MED - Repeat previous command (n/^V) absent. C: ui-game.c:223.
- [ ] 11.10 MED - View abilities (S) menu-only; 'S' repurposed to Save. C: ui-game.c:175.

LOW:
- [ ] 11.11 LOW - Assorted absent: Use auto-detect (U/X, deliberate split - ok),
  quiver listing (|), identify symbol (/), repeat level feeling (^F), show previous
  message single (^O), screen dump ()), version (V, repurposed), load pref line ("),
  deliberate walk (;), stand still (,), navigate-to-stairs, sleep. Bind where faithful.

---

## Cluster 14: player-facing screens (ui-*.c). 63 findings; grouped.

FAITHFUL: mode-0 char panels + stat table (incl drained "!" marker), background history,
history-event screen, monster recall CONTENT (field-for-field), object-list view, full
map (M), item-ignore menus, delay factor, hitpoint warning.

DEATH SCREEN (HIGH cluster):
- [ ] 14.1 HIGH - Tombstone/exit screen never rendered (dead.txt + centred fields);
  port jumps to scores. C: ui-death.c:63-113,387. Port: main.ts:3180-3226 ABSENT.
- [ ] 14.2 HIGH - Real killer not recorded: diedFrom hardcoded "the dungeon"; score
  entry gets placeholder. C: ui-death.c:107 (player->died_from). Port: main.ts:3198-3201.
  [Pairs with 12.5.]
- [ ] 14.3 MED - total_winner victory screen (crown.txt + "All Hail...") never shown.
  C: ui-death.c:119-156,381-384. Port: ABSENT.
- [ ] 14.4 MED - Death menu drops 4/9 actions (File dump, Examine items, History,
  Spoilers). C: ui-death.c:356-367. Port: game-menu.ts:123-142.
- [ ] 14.5 MED - Death "Information" shows char sheet only; no equip/inven/quiver/home
  -more- walk (OLIST_DEATH). C: ui-death.c:193-278. Port: main.ts:2451-2453.

CHARACTER DUMP ('f'):
- [ ] 14.6 MED - Char dump omits resist/ability flag grids, gear listings (equip/inven/
  quiver/home + object_info_chardump), history ledger, last-messages, options, randart
  seed. C: ui-player.c:987-1188. Port: charsheet.ts:169-173 (stat+panels+background only).
- [ ] 14.7 LOW - Char sheet mode-1 omits top-left Name/Race/HP/SP panel; resist grid
  lacks "abcdefgimnop@" slot-letter header. C: ui-player.c:905-909,399-401. Port:
  charsheet.ts:266-280,130-137.

KNOWLEDGE MENUS (HIGH cluster):
- [ ] 14.8 HIGH - Knowledge master menu offers 3/~12 sub-categories; object/rune/
  artifact/ego/feature/trap/shapechange/store omitted. C: ui-knowledge.c:3597-3613.
  Port: main.ts:1939-1949.
- [ ] 14.9 HIGH - No full "known objects" browser (per-kind recall, ignore column,
  {tried}, unaware flavored kinds); only autoinscription editor. C:
  ui-knowledge.c:2139. Port: main.ts:1965-1991.
- [ ] 14.10 MED - Rune-knowledge screen absent (data playerKnowsRune exists). C:
  ui-knowledge.c:2291. Port: ABSENT.
- [ ] 14.11 MED - Artifact-knowledge screen absent (known/created, fake recall). C:
  ui-knowledge.c:1740. Port: ABSENT.
- [ ] 14.12 MED - Ego-item knowledge screen absent. C: ui-knowledge.c:1827. Port: ABSENT.
- [ ] 14.13 LOW - Feature + trap knowledge screens absent. C: ui-knowledge.c:2460,2641.
- [ ] 14.14 LOW - Shapechange effects screen absent (shapeshift classes only). C:
  ui-knowledge.c:3140.
- [ ] 14.15 LOW-MED - Store/home contents browse (incl. Home while away) absent from
  knowledge menu. C: ui-knowledge.c:3662-3676. [Pairs with 12.1 Home persistence.]
- [ ] 14.16 LOW-MED - Monster-knowledge list flat, no monster_group grouping/summary
  ("N known uniques, M slain"), no Full/alive-dead/shape columns. C:
  ui-knowledge.c:1382,1303-1328. Port: screens.ts:623-660.

MONSTER LIST SCREEN ([) (HIGH cluster):
- [ ] 14.17 HIGH - Entire "list visible monsters" screen absent (no key/toolbar/renderer);
  view-model mon-list.ts exists, imported nowhere in web. C: ui-mon-list.c:388,349.
  Port: ABSENT. [Pairs with 11.5.]
- [ ] 14.18 HIGH - Grouped counts "You can see N monster(s)", per-race count, (asleep)
  markers unavailable. C: ui-mon-list.c:87-141.
- [ ] 14.19 MED - Monster list: LOS/ESP split ("aware of"), direction/distance offsets,
  sort-by-exp toggle ('x'), hallucination replacement all absent. C: ui-mon-list.c:
  294-308,112-121,410,209-225.

ITEM/SPELL MENUS (ui-object.c, ui-spell.c) (HIGH cluster):
- [ ] 14.20 HIGH - Inventory/equipment list omits WEIGHT column ("Nn.n lb"). C:
  ui-object.c:234-239,1358. Port: screens.ts:172-225.
- [ ] 14.21 HIGH - Device use picker omits FAIL% column ("Nnn% fail") for wand/rod/
  staff/activatable. C: ui-object.c:212-221. Port: main.ts:1356-1375,811-846.
- [ ] 14.22 HIGH - Spell cast menu collapses forgotten/unknown/difficult/(illegible)
  into one "(unknown)"; forgotten (recoverable) indistinguishable. C: ui-spell.c:81-103.
  Port: screens.ts:445-473; spellOkayToCast only tests LEARNED (spell.ts:232).
- [ ] 14.23 MED - Recharge picker FAIL% column absent. C: ui-object.c:223-232.
- [ ] 14.24 MED - Spell menu per-state colour coding lost (all DIM); " untried"
  indicator missing; study menu shows raw base fail not spell_chance. C:
  ui-spell.c:82-103,93-96,119-120. Port: screens.ts:472,478.
- [ ] 14.25 MED - Interactive drop has no "How many?" quantity prompt (partial stack);
  !d/!q/!k/!* "Really <verb>?" inscription confirmations not ported. C: cmd-obj.c:360,
  ui-object.c:634-679. Port: main.ts:1342-1352.
- [ ] 14.26 LOW - Item selection source-partition header/switch (Inven/Equip/Quiver/
  floor) absent; sources merged flat. C: ui-object.c:764-914. Port: main.ts:811-846.

CONTEXT MENU (ui-context.c):
- [ ] 14.27 MED - context_menu_cave "Recall Info" (monster lore) omitted though
  showRaceRecall exists. C: ui-context.c:450-453,607-614. Port: context-menu.ts:166-203.
- [ ] 14.28 MED - context_menu_object "Browse" spellbook omitted. C: ui-context.c:689.
  Port: context-menu.ts:254-256.
- [ ] 14.29 LOW - context menu: "Use" quick-use, "Drop All", in-store Sell/Stash
  relabel, per-instance ignore toggle, adjacent object_info block all omitted. C:
  ui-context.c:267,737-754,770,786-791.

OPTIONS MENU (ui-options.c):
- [ ] 14.30 MED - Keymap editor screen absent (users cannot rebind keys; only orig/
  roguelike presets). C: ui-options.c:2057. Port: keymap.ts resolver only. [Pairs 11.4.]
- [ ] 14.31 MED - Cheat options page absent (data exists options.ts:70-88). IN SCOPE
  per maintainer 2026-07-16: reproduce upstream page exactly, incl. noscore marking.
  C: ui-options.c:2042.
- [ ] 14.32 LOW - auto_more toggle is a no-op: no -more- prompt subsystem to gate
  (faithful message-pause/disturb absent). C: list-options.h. Port: options.ts:59-61.
- [ ] 14.33 LOW - Set movement delay (lazymove_delay), sidebar mode, subwindow setup,
  save/restore/reset option defaults, autoinscription entry from '{' all absent. C:
  ui-options.c:2049-2057,166-199.
- [ ] 14.34 LOW - Locate ('L') detailed sector banner reduced to plain "[r,c]". C:
  ui-knowledge.c:4242-4247. Port: mapview.ts:182-192.

NOTE: item-inspection CONTENT (object-info.ts) is a port of obj-info.c, outside the
ui-*.c oracle - covered faithful by cluster 4.

---

## Cluster 15: wizard/debug mode (added 2026-07-16; maintainer confirmed IN SCOPE)

Oracle: cmd-wizard.c, wiz-debug.c, ui-wizard.c, wiz-spoil.c, wiz-stats.c, wizard.h.
Engine layer game/wizard.ts already ports most do_cmd_wiz_* actions (audited header
lists exclusions). CLI ports spoilers (cli/spoilers.ts) + stats (cli/stats.ts). Gaps:

- [ ] 15.1 HIGH - Wizard-mode ENTRY absent on web: no debug-command menu / keymap
  entry, no "are you sure" confirm, no noscore marking, no in-game access to the
  ported wizard engine at all (main.ts:3205 deliberately omits it - rescinded). C:
  ui-game.c wizard toggle + ui-wizard.c menu (executor pins exact lines). Port:
  ABSENT in web/main.ts.
- [ ] 15.2 MED - Interactive wizard shells not ported (excluded per wizard.ts
  header): do_cmd_wiz_play_item, _display_item, _stat_item, _edit_player_start,
  and the do_cmd_wiz_collect_* stats collectors. C: cmd-wizard.c. Port: ABSENT.
- [ ] 15.3 MED - noscore flag not modeled/persisted: upstream marks the savefile
  (player->noscore NOSCORE_* bits) on wizard use / cheat-death / debug options so
  scores are invalidated; port has no equivalent, wizard use would score normally.
  C: wizard.h NOSCORE_*, score.c. Port: ABSENT (score.ts, save.ts).
- [ ] 15.4 LOW - Verify cli/spoilers.ts covers all four wiz-spoil.c spoiler files
  (obj/artifact/mon brief/mon full) field-for-field; wire a web-reachable trigger
  (upstream: death-screen Spoilers menu + debug menu). Pairs with 14.4.
- [ ] 15.5 LOW - Verify cli/stats.ts vs wiz-stats.c (diving/clearing modes, all
  tallies); expose via debug menu parity where upstream does.

---

## Cluster 4: object use, description, knowledge, gear/quiver, stacking, chests

FAITHFUL: obj-pile.c (stacking), obj-util.c, obj-chest.c, obj-info.c (incl O-combat),
obj-desc.c grammar engine, rune learn-by-use, flavor awareness, autoinscription. Gaps
concentrate in obj-gear.c (the unbuilt "playable shell" gear layer):

- [ ] 4.1 HIGH - Quiver subsystem NOT actually implemented: no quiver[] storage, no
  ammo-to-quiver routing; quiver_absorb_num/preferred_quiver_slot/object_is_in_quiver
  + inven_carry quiver branches absent (only constants.quiverSlotSize used). The 61
  "quiver" refs are comments/deferrals. C: obj-gear.c:163,649,1396. Port: gear.ts:22,
  player/player.ts:27 (explicitly deferred).
- [ ] 4.2 MED - minus_ac armor degradation absent: acid never damages worn armor (no
  slot pick, no to_a--, no "Your X is damaged", loses RNG draw). C: obj-gear.c:376-438
  (from project-player.c:69). Port: ABSENT (only the damage-halving bool modeled).
  [Pairs with 6.2.]
- [ ] 4.3 LOW-MED - object_learn_on_use XP gain missing on first identify-by-use. C:
  obj-knowledge.c:1925-1936 (cmd-obj.c:636,644). Port: obj-cmd.ts:691-703 (no expGain).
- [ ] 4.4 LOW-MED - combine_pack full sweep + inven_can_stack_partial absent: two
  identical stacks can coexist after takeoff; uneven partial merges never happen. C:
  obj-gear.c:1242,1183. Port: gear.ts:229, obj-cmd.ts:150-158.
- [ ] 4.5 LOW - object_desc omits {ignore} markers though ignore subsystem exists
  (stale docstring). C: obj-desc.c:537,630. Port: desc.ts:554,621 (ignore.ts:380 ready
  but unwired).
- [ ] 4.6 LOW - ignore predicates not wired into chest/floor consumers (chest_check
  ignore gate, floor-scan skip, empty-chest ignore mark). C: obj-chest.c:431,639-640,
  obj-pile.c:892,1316. Port: chest.ts:96,269-278.
- [ ] 4.7 LOW - object_pack_total + aggregate "(1st c)" / ODESC_ALTNUM messaging
  absent (UI messaging only). C: obj-gear.c:189. Port: ABSENT.
- [ ] 4.8 MED - obj->known per-object twin machinery deferred: object_set_base_known,
  object_sense/see/touch/grab progressive-ID hooks, update_player_object_knowledge not
  ported (known-object.ts synthesises a shadow on demand). Progressive floor item
  sensing + magical/cursed feelings not modelled. C: obj-knowledge.c:820-1218. Port:
  known-object.ts, knowledge.ts:22-27.
