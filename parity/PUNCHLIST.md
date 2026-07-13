# Parity Punch-list (path to true 1-for-1)

Baseline: Angband `4.2.6`. Every status below was VERIFIED by reading the actual
TypeScript function bodies (Jul 2026 audit), NOT by trusting the parity ledger -
which was found to be stale in both directions (it marked shipped features
"deferred" and vice versa). This file, not `ledger/*.yaml`, is the source of
truth for the gap-closing effort until the ledger is reconciled (a tracked task
below).

Legend: [x] done, [~] partial, [ ] gap. Tiers are recommended execution order.

## VERIFIED DONE (the ledger/old task-list understated these)

- [x] Stores fully visitable end-to-end: enter-store command, real
  buy/sell/pricing, black-market rules, stock creation + maintenance/restock.
- [x] Word of Recall + Deep Descent countdowns (yank up/down, depth math).
- [x] Ranged combat: `f` fire ammo, `v` throw, into core `combat/ranged.ts`.
- [x] Projected/spell damage to the PLAYER reduced by real equipment resists
  (`elInfo` res levels) + damage reduction from `calcBonuses` (`adjustDam` +
  `playerApplyDamageReduction` wired in `session/game.ts`).
- [x] Encumbrance / overweight speed penalty (`calcs.ts` weight block).
- [x] Monster breath damage scales with caster HP (`breathDam(type, hp)`).
- [x] Monster MOVEMENT AI: flow/sound/scent, fear-range math, staggering,
  group rousing/tracking, 5-dir step loop, monster-vs-monster push, ranged
  casting via the wired `monsterCast` hook.
- [x] Multiple save slots (per-character roster; built this pass).

## Tier 1 - Playability-critical (normal play is wrong/incomplete without these)  [ALL 7 GAPS PORTED + PUSHED this pass]

- [x] **Per-turn world clock** (`game/loop.ts` `processWorld`) - all VERIFIED gaps:
  - [x] food/hunger digestion (`decreaseTimeouts` forces FOOD decr=0)
  - [x] light-source fuel burn (torch/lantern timeout never decremented)
  - [x] damage-over-time: poison, cut, black-breath, starvation (`take_hit`
    exists but is never called by the clock; regen only zeroes healing)
  - [x] rod/ring/activatable recharge (`rechargeObjects` does not exist)
  - [x] ambient monster generation over time (`alloc_monster_chance`)
  - [x] timed-effect grade/wear-off messages: the clock's countdown now routes
    through `playerDecTimed`, so grade transitions and wear-off messages fire.
- [x] **Monster melee side-effects** (`combat/mon-melee.ts` +
  `game/monster-turn.ts`): only the PHYSICAL slice of a blow reaches HP. The
  elemental component (acid/fire/cold/elec/poison) and ALL status/stat/theft
  effects are computed into a `sideEffects` intent list that no caller consumes,
  and `player_apply_damage_reduction` is not applied on melee. Net: elemental
  monsters hit like plain physical and never poison/cut/stun/blind/drain/steal.
- [x] **calc_bonuses completeness** (`player/calcs.ts`):
  - [x] `calc_light` - `curLight` hard-set to 0; the shell papers over it with a
    constant `curLight: 2`. Light radius is never derived from the wielded light.
  - [x] timed buffs/debuffs folded into combat state - haste/heroism/blessing/
    slow have NO mechanical effect (speed + to-hit/dam/ac unchanged); they show
    only in char-sheet text.
- [x] **Monster loot drops** (`mon/take-hit.ts` onKill path): kills grant XP +
  lore but create zero objects. No `mon_create_drop`.
- [x] **Artifact generation** (`obj/make.ts`): `makeArtifact` returns `false`,
  `makeArtifactSpecial` returns `null` - pure stubs, so no artifact ever spawns.
- [x] **Item-target effects** (`game/effect-item.ts`): handler bodies are real
  but the `getItem` chooser seam is NEVER wired in production, so enchant /
  identify / recharge / remove-curse / brand-ammo / create-arrows / tap-device
  all no-op AND fail to consume the scroll/spell.
- [x] **Monster visibility model** (`game/known.ts`): no telepathy
  (`RF_TELEPATHY`), no infravision, no see-invisible. Invisible monsters are
  never revealed even with a see-invis item; ESP senses nothing out of LOS.

## Tier 2 - Faithful features players actively use  [ALL 14 GAPS PORTED + PUSHED]

- [x] Item inspection (`I`) + `object_info` combat/slay/brand/digger text
  (`obj/object-info.ts` + `game/object-inspect.ts`; `I` reuses selectTargetItem).
- [x] Effect damage in spell/device menus ("3d8 fire") via `effects/effect-info.ts`
  (`effect_avg_damage`/projection); per-row damage in the spell book menu.
- [x] Chests: `obj/chest.ts` + `game/chest.ts` - open/disarm, chest traps
  (`pickChestTraps` in make.ts), and chest loot; exploded chest drops nothing.
- [x] Object commands: inscribe (`{`) / uninscribe (`}`) / autoinscribe /
  refill (`F`) in `game/obj-cmd.ts`.
- [x] Ignore configuration menu + `ignore_drop` (`obj/ignore.ts` +
  `game/ignore-cmd.ts`; `=` temp toggle deprecated for options, `K` menu).
- [x] Interactive look/target `*` loop: grid cycling + look-at-grid prompts in
  `game/target-loop.ts` + main.ts rendering; `squareApparentName`.
- [x] Full-level map (`M`) and locate/scroll (`L`) - `web/src/mapview.ts`.
- [x] Floor object list (`]`) - `screens.ts` `objectListLines`.
- [x] Options/settings screen (`=`) - `web/src/options.ts`; wired the ignored
  readers (rogue_like_commands, use_sound [off by default, faithful], solid/hybrid
  walls, purple_uniques, animate_flicker, mouse_movement, hp_changes_color).
- [x] Help browser (`?`) - `web/src/help.ts` (describes the port's real keys).
- [x] Character history: `player/history.ts` + `game/history.ts` runtime log
  (birth/level/unique-kill/artifact/death) + `~` screen.
- [x] Spell-description browse surface (`?` toggle in cast/study; spell->text
  + avg-damage summary).
- [x] Curse-removal UI / equipment-comparison / abilities browser / context menu
  (`player/abilities.ts`, `game/equip-cmp.ts`, web abilities/equip-cmp/context-menu).
- [x] S-tier menu / char-select / char-sheet polish: shared tap-aware menu
  component (touch parity), discoverable game + death menus, staged birth flow
  (no gender stage, per 4.2.6), faithful wide char-sheet columns/colors + history.
  Blocked follow-ups: EB equipment stat_add, get_history population, mode-1 grid.

## Tier 3 - Monster behavior depth (all VERIFIED)

- [ ] Terrain manipulation by AUTONOMOUS monsters: OPEN/BASH door, KILL/SMASH
  wall (only `PASS_WALL` phases through; open/bash/dig exists only on the
  player-commanded/possessed path).
- [ ] Breeders multiply (`multiply_monster` + `num_repro` cap; constants defined
  but never read).
- [ ] Aggravation (`OF_AGGRAVATE`) never consulted in game-turn code.
- [~] Fleeing: afraid monsters walk straight away; no find_hiding / find_safety
  / swerve.
- [ ] Monsters pick up / crush floor items (`TAKE_ITEM` / `KILL_ITEM`).
- [ ] Thieving blows actually steal (`EAT_ITEM` / `EAT_GOLD` intents unconsumed).
- [x] Mimic reveal (`become_aware`, `game/known.ts`): clears MFLAG_CAMOUFLAGE,
  learns RF_UNAWARE, drops a mimicked floor object when present, and messages;
  installed at every `becomeAware?` hook (mon/take-hit.ts, game/project-monster.ts,
  game/mon-ranged.ts, game/effect-melee.ts, game/mon-cmd.ts) plus the direct
  reveal-before-attack paths (game/player-turn.ts walkAction, game/cave-cmd.ts
  open/disarm, game/monster-turn.ts trample/did-something, game/mon-place.ts
  multiplyMonster's revealed-child fix). The RF_MIMIC_INV give-a-copy sub-branch
  stays deferred (no object_copy port yet); object-mimic placement itself is
  still unported so mon.mimickedObj is always 0 in live play.
- [ ] Monster recall (lore) shows spell/breath NAMES but always `0` damage
  (`spellLoreDamage` dep never provided).

## Tier 4 - Generation depth

- [~] Town: functional lit/walled surface with all 8 shop entrances + stair +
  player start, BUT compact placeholder layout, no townsfolk, no day/night.
  Needs faithful `town_gen_layout` + population.
- [ ] Themed pits/nests (`set_pit_type`/`mon_pit_hook`/`pit.txt`).
- [ ] Level feelings (`place_feeling`/`calc_*_feeling`).
- [ ] Vault racial-glyph monster restriction (`get_vault_monsters`).
- [ ] Alternate generators (all delegate to `modified_gen`, disabled):
  labyrinth, cavern, moria, lair, gauntlet, hard_centre, arena; + build_moria /
  build_room_of_chambers / build_huge.

## Tier 5 - Systems / edge / later (mostly ledger-sourced; re-verify before build)

- [ ] Quests: quest state not modelled.
- [ ] Multi-item floor pickup menu (headless picks pile head now).
- [ ] Inscription-driven ignore/pickup behavior.
- [ ] Starting gold too high (`object_value_real` deduction at outfit; likely
  quick now that obj-value is complete).
- [ ] Point-buy birth roller + quickstart (classic roller works).
- [ ] Overcast penalties, cast-in-dark penalty, `convert_mana_to_hp`.
- [ ] Door lock/jam commands, running/pathfind key binding + `disturb()` from
  external events, `do_cmd_steal`, swap-digger.
- [ ] Day/night surface lighting; RECALL/CREATE_STAIRS persistence interplay.
- [ ] O-combat mode, per-object curse traversal for bonuses, randart name RNG
  parity + `birth_randarts` wiring.
- [ ] Knowledge/ID depth: per-object `obj->known` twin, rune learn-by-use
  populating `obj_k`, awareness-propagation side effects.
- [ ] `color_table` translation matrix (accessibility/lighting modes).
- [ ] UI-data packs still `planned`: `ui_entry*.json`, `ui_knowledge.json`,
  `visuals.json`; `old_class.json` (retired data).

## Tracked hygiene task

- [ ] **Reconcile the parity ledger** (`ledger/*.yaml`) against this verified
  list: correct stale `status`/`deferred` fields (e.g. ranged/stores/recall/
  breath/projection-defense/encumbrance are DONE; add `savefile.c` cross-ref;
  close `session-save.yaml`'s "single save only"). The ledger is the rebase map
  for future upstream releases, so it must match reality.

## Not ported by design (N-A)

- Platform backends (`main-*.c`, `snd-sdl.c`, `ui-term.c`) - replaced by the web
  shell. C infrastructure (`z-*.c`, `datafile.c`, `guid.c`, framework files) -
  replaced by native TS + build-time JSON codegen. Dev-only tooling
  (`wiz-*.c`, `*-spoil.c`, `main-stats.c`, `debug.c`, `save-charoutput.c`) -
  gated behind a wizard flag, unreachable in faithful play.
