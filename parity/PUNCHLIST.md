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

## Tier 1 - Playability-critical (normal play is wrong/incomplete without these)

- [ ] **Per-turn world clock** (`game/loop.ts` `processWorld`) - all VERIFIED gaps:
  - [ ] food/hunger digestion (`decreaseTimeouts` forces FOOD decr=0)
  - [ ] light-source fuel burn (torch/lantern timeout never decremented)
  - [ ] damage-over-time: poison, cut, black-breath, starvation (`take_hit`
    exists but is never called by the clock; regen only zeroes healing)
  - [ ] rod/ring/activatable recharge (`rechargeObjects` does not exist)
  - [ ] ambient monster generation over time (`alloc_monster_chance`)
  - [~] timed-effect grade/wear-off messages: machinery real in
    `player/timed.ts` but the clock's countdown bypasses it, so effects expire
    silently.
- [ ] **Monster melee side-effects** (`combat/mon-melee.ts` +
  `game/monster-turn.ts`): only the PHYSICAL slice of a blow reaches HP. The
  elemental component (acid/fire/cold/elec/poison) and ALL status/stat/theft
  effects are computed into a `sideEffects` intent list that no caller consumes,
  and `player_apply_damage_reduction` is not applied on melee. Net: elemental
  monsters hit like plain physical and never poison/cut/stun/blind/drain/steal.
- [ ] **calc_bonuses completeness** (`player/calcs.ts`):
  - [ ] `calc_light` - `curLight` hard-set to 0; the shell papers over it with a
    constant `curLight: 2`. Light radius is never derived from the wielded light.
  - [ ] timed buffs/debuffs folded into combat state - haste/heroism/blessing/
    slow have NO mechanical effect (speed + to-hit/dam/ac unchanged); they show
    only in char-sheet text.
- [ ] **Monster loot drops** (`mon/take-hit.ts` onKill path): kills grant XP +
  lore but create zero objects. No `mon_create_drop`.
- [ ] **Artifact generation** (`obj/make.ts`): `makeArtifact` returns `false`,
  `makeArtifactSpecial` returns `null` - pure stubs, so no artifact ever spawns.
- [ ] **Item-target effects** (`game/effect-item.ts`): handler bodies are real
  but the `getItem` chooser seam is NEVER wired in production, so enchant /
  identify / recharge / remove-curse / brand-ammo / create-arrows / tap-device
  all no-op AND fail to consume the scroll/spell.
- [ ] **Monster visibility model** (`game/known.ts`): no telepathy
  (`RF_TELEPATHY`), no infravision, no see-invisible. Invisible monsters are
  never revealed even with a see-invis item; ESP senses nothing out of LOS.

## Tier 2 - Faithful features players actively use (all VERIFIED)

- [ ] Item inspection (`I`) + `object_info` combat/slay/brand/digger text
  (`core/game/describe.ts` only returns the name; no inspect command in shell).
- [ ] Effect damage in spell/device menus ("3d8 fire") - menus show only
  Lv/Mana/fail%; no `effect_avg_damage`/projection.
- [ ] Chests: spawn but cannot be opened - no `do_cmd_open_chest`, no chest
  traps, no chest loot.
- [~] Object commands: use/quaff/read/wield/etc. work; inscribe / uninscribe /
  autoinscribe / refill (fuel) are declared but unhandled, no shell keys.
- [ ] Ignore configuration menu + `ignore_drop` (core only applies stored
  settings; no UI).
- [~] Interactive look/target `*` loop: a distance-sorted list picker works, but
  no grid cycling, look-at-grid prompts, or path drawing.
- [ ] Full-level map (`M`) and locate/scroll (`L`) - neither command exists.
- [ ] Floor object list (`]`) - core `obj-list.ts` exists but shell has no key.
- [ ] Options/settings screen (`=`) - values modeled in core, no UI to view/set;
  also wire the readers that ignore their option (`rogue_like_commands`,
  `solid_walls`, `purple_uniques`, `auto_more`, ...).
- [ ] Help browser (`?`).
- [ ] Character history: `history_add` runtime log (artifact finds, level
  notes) not recorded + no history screen.
- [~] Menus/screens: only a 4-item Escape menu (Resume/Save/Switch/New); no
  curse-removal UI, equipment-comparison, abilities browser, or context menu.

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
- [ ] Mimic reveal (`become_aware` is an uninstalled optional hook; camouflage
  flag never cleared, so mimics never unmask in play).
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
