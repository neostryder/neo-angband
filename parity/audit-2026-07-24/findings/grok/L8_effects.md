# L8_effects audit (effects & projection)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: effect-handler*, effects*, list-effects/projections, project*.
Searched packages/ (excl. node_modules, dist, borg).

### L8_effects-001  EF_SELECT never prompts; always random for player origin
sev: P1
concession: n
ref: reference/src/effects.c:425-460 (EF_SELECT player origin: cmd_get_effect_from_list / get_effect_from_list, choice -2 random only when chosen)
port: packages/core/src/effects/interpreter.ts:487-500 (chooseEffect absent => choice=-2 always); packages/core/src/game/obj-cmd.ts:780-801 and packages/core/src/game/spell-cmd.ts:166-183 (attachGameEnv never sets chooseEffect); grep: chooseEffect only wired in interpreter.test.ts
expected: Player-origin EF_SELECT with 2+ sub-effects presents a menu (or abort/random); gamedata uses this for dual-breath devices and activations (object.txt effect:SELECT dice:2; activation.txt many SELECT chains).
actual: Live EffectContext never injects chooseEffect, so every player SELECT falls back to randint0(choice_count) without a prompt.
why: Staffs/activations that offer a choice (e.g. fire vs cold breath) always pick randomly; player cannot choose or cancel.
confidence: high

### L8_effects-002  WEAPON_DAMAGE expression base never bound for object/curse chains
sev: P1
concession: n
ref: reference/src/effects.c:308-315 (effect_value_base_weapon_damage: damroll(obj->dd,obj->ds)+obj->to_d); curse.txt "treacherous weapon" effect:DAMAGE dice:$B expr:B:WEAPON_DAMAGE:+ 0
port: packages/core/src/game/obj-cmd.ts:518-526 (buildObjectEffectChain baseValues only PLAYER_LEVEL/MAX_SIGHT/DUNGEON_LEVEL); packages/core/src/game/curse-tick.ts:77 (uses buildObjectEffectChain); packages/core/src/effects/effect.ts:529-530 (missing provider leaves expression base unset => 0)
expected: Treacherous-weapon curse (and any WEAPON_DAMAGE expr) deals the equipped weapon's rolled base damage each fire.
actual: Expression base evaluates as 0; the curse's DAMAGE effect deals 0 HP.
why: A live equipped curse does no self-damage; RNG and combat outcome diverge from C.
confidence: high

### L8_effects-003  MONSTER_PERCENT_HP_GONE expression base never bound for player spells
sev: P1
concession: n
ref: reference/src/effects.c:322-328 (effect_value_base_monster_percent_hp_gone from target_get_monster); class.txt vampire "Curse" dice:$Dd$S expr:S:MONSTER_PERCENT_HP_GONE:+ 50
port: packages/core/src/game/obj-cmd.ts:518-526; packages/core/src/game/spell-cmd.ts:161-165 (spellCast uses buildObjectEffectChain without MONSTER_PERCENT_HP_GONE / target)
expected: Curse spell die sides = (target maxhp-hp)*100/maxhp + 50 so wounded monsters take more damage.
actual: Missing provider => sides evaluate as 0+50 = 50 always; wound-scaling is lost.
why: Vampire class signature spell under-damages wounded targets and over-simplifies the die.
confidence: high

### L8_effects-004  PLAYER_HP expression base never bound (vampire shape self-damage)
sev: P1
concession: n
ref: reference/src/effects.c:317-320 (effect_value_base_player_hp); shape.txt vampire effect:DAMAGE dice:$B expr:B:PLAYER_HP:/ 4
port: packages/core/src/game/effect-general.ts:793-797 (handleSHAPECHANGE builds chain via buildObjectEffectChain without PLAYER_HP); packages/core/src/game/obj-cmd.ts:518-526
expected: Assuming vampire form deals chp/4 damage to the player (effect-msg "taking vampire form").
actual: Expression base is 0; transform deals 0 self-damage.
why: Shapechange cost is free vs upstream HP tax.
confidence: high

### L8_effects-005  PF_CHARM never passed into project_m (nature mage animal boost)
sev: P1
concession: n
ref: reference/src/project-mon.c:1344-1346 (charm = origin SRC_PLAYER && player_has(PF_CHARM)); L489-491 and status handlers: dam += dam/2 vs RF_ANIMAL when charm; class.txt nature mage player-flags includes CHARM
port: packages/core/src/game/effect-attack.ts:80 (playerCastSource only if env.charm !== undefined); packages/core/src/game/obj-cmd.ts:780-801 and spell-cmd.ts:166-183 never set GameEffectEnv.charm; packages/core/src/session/game.ts cast hooks never set charm
expected: Nature-mage player projections boost sleep/confuse/slow/hold/stun/poly vs animals by +50% power.
actual: charm is always false/undefined on the live cast path; animal boost never applies.
why: Nature mage class flag is a dead mechanic for projections.
confidence: high

### L8_effects-006  PROJ_MON_CLONE multiply_monster hook never wired on live projections
sev: P1
concession: n
ref: reference/src/project-mon.c project_monster_handler_MON_CLONE (multiply_monster); object.txt "Clone Monster" wand effect:BOLT_STATUS:MON_CLONE
port: packages/core/src/mon/project-mon.ts:673-676 (hMonClone calls hooks.multiplyMonster); packages/core/src/game/project-monster.ts:157-159 (forwards hook if present); packages/core/src/session/game.ts:998-1045 (cast.hooks.monster has no multiplyMonster; multiplyMonster only used for ambient breeders ~L1477)
expected: Clone Monster wand/spell/wonder path clones the target via multiply_monster after heal+haste.
actual: Handler runs heal/haste but multiplyMonster is absent, so no clone is placed.
why: Clone Monster devices do not clone; MON_CLONE projections are incomplete in normal play.
confidence: high

### L8_effects-007  EF_CURSE ignores show_damage and pain-with-damage path
sev: P2
concession: n
ref: reference/src/effect-handler-attack.c:1671-1698 (display_dam builds " dies! (%d)"; message_pain_show_damage when not dead)
port: packages/core/src/game/effect-melee.ts:210-229 (effectHit with fixed " dies!"; no show_damage branch; message_pain comment says deferred)
expected: With show_damage on, kill note includes damage and surviving hits use message_pain_show_damage.
actual: Always " dies!"; pain path is generic monTakeHit without damage display option.
why: Vampire Curse and similar direct-damage effects omit the combat feedback option.
confidence: high

### L8_effects-008  Monster-source EF_DAMAGE killer string is bare race name
sev: P2
concession: n
ref: reference/src/effect-handler-attack.c (monster_desc MDESC_DIED_FROM for SRC_MONSTER killer); project-player.c:848-849 same for projections
port: packages/core/src/game/effect-attack.ts:687-691 (killer = mon.race.name); packages/core/src/effects/handlers.ts:77-80 ("a monster" stand-in for base path)
expected: Death cause uses monster_desc grammar ("an orc", "Smeagol", etc.).
actual: Live monster EF_DAMAGE uses raw race.name (no article/indef); base path uses "a monster".
why: died_from / death dump strings diverge from upstream for monster-sourced damage effects.
confidence: high

### L8_effects-009  effect_describe / get_spell_info skip dice_roll RNG draws
sev: P3
concession: n
ref: reference/src/effects-info.c:344-351 (dice_roll which calls damroll, z-dice.c:579-591) when formatting effect descriptions
port: packages/core/src/effects/effect-info.ts:12-25, 519+ (Dice.randomValue / rvAverage; tests assert zero RNG draws)
expected: Inspecting/describing an effect chain advances the game RNG via damroll on dice_roll (upstream quirk).
actual: Display path never draws RNG (deliberate determinism).
why: Inspecting items/spells mid-game desyncs the RNG stream vs C if descriptions are shown during play.
confidence: high

### L8_effects-010  PROJECT_INFO / square_isbelievedwall approximated by real map
sev: P3
concession: ?
ref: reference/src/project.c:208-212, 272-276, 331-335 (PROJECT_INFO stops on square_isbelievedwall)
port: packages/core/src/world/project.ts:101-107 (INFO branch uses isProjectable on real map; comment DEFERRED); packages/core/src/game/target-loop.ts:38-42 documents same
expected: Targeting/UI path geometry respects player remembered walls.
actual: Path uses truth map; UI-only path until believed map is complete.
why: Target path display can leak true walls vs memory; not a combat project() default path.
confidence: high

### L8_effects-011  project_path decoy stop never matches (no decoy in path geometry)
sev: P3
concession: n
ref: reference/src/project.c:147, 216-218 (cave_find_decoy; PROJECT_STOP stops on decoy grid)
port: packages/core/src/world/project.ts:51-52, 109-112 (NO_DECOY sentinel (-1,-1) never matches)
expected: Bolts with PROJECT_STOP halt on a player decoy grid as on a monster.
actual: Path geometry ignores decoys; stop only on mon != 0. (Decoy destroy on hit is handled in castProjection onPlayer separately.)
why: A bolt aimed past a decoy may not stop on the decoy grid itself if no monster is there.
confidence: med

## MAP L8_effects
reference/src/effect-handler.h -> packages/core/src/effects/effect.ts (ENCH_*), packages/core/src/effects/interpreter.ts (EffectHandlerContext, effectCalculateValue), packages/core/src/effects/handlers.ts
reference/src/effect-handler-attack.c -> packages/core/src/effects/handlers.ts (DAMAGE base), packages/core/src/game/effect-attack.ts, packages/core/src/game/effect-melee.ts (CURSE/TAP_UNLIFE/melee-adjacent), packages/core/src/game/project-cast.ts (project_aimed/touch/cast* shapes)
reference/src/effect-handler-general.c -> packages/core/src/effects/handlers.ts (worldless general), packages/core/src/game/effect-general.ts, packages/core/src/game/effect-detect.ts, packages/core/src/game/effect-item.ts, packages/core/src/game/effect-monster.ts, packages/core/src/game/effect-summon.ts, packages/core/src/game/effect-teleport.ts, packages/core/src/game/effect-terrain.ts
reference/src/effects.c -> packages/core/src/effects/interpreter.ts (effect_do/simple/aim/valid), packages/core/src/effects/effect.ts (lookup/subtype/value bases), packages/core/src/game/effect-item.ts (rechargeFailureChance)
reference/src/effects.h -> packages/core/src/effects/effect.ts, packages/core/src/effects/interpreter.ts, packages/core/src/generated/effects.ts
reference/src/effects-info.c -> packages/core/src/effects/effect-info.ts (describe/avg/projection/menu), packages/core/src/obj/effects-info.ts (effect_summarize_properties)
reference/src/effects-info.h -> packages/core/src/effects/effect-info.ts, packages/core/src/obj/effects-info.ts, packages/core/src/obj/randart-build.ts (EFPROP)
reference/src/list-effects.h -> packages/core/src/generated/effects.ts (EFFECT_ENTRIES, EF)
reference/src/list-projections.h -> packages/core/src/generated/projections.ts (PROJECTION_ENTRIES, PROJ; elements from list-elements.h prepended)
reference/src/project.c -> packages/core/src/world/project.ts (project_path/projectable/computeProjection/project, PROJECT flags, GET_ANGLE_TO_GRID), packages/core/src/game/project-cast.ts (castProjection wiring), packages/core/src/world/projection.ts (adjustDam)
reference/src/project.h -> packages/core/src/world/project.ts, packages/core/src/world/projection.ts, packages/core/src/generated/projections.ts
reference/src/project-feat.c -> packages/core/src/game/project-feat.ts
reference/src/project-mon.c -> packages/core/src/mon/project-mon.ts (handlers), packages/core/src/game/project-monster.ts (project_m driver), packages/core/src/game/thrust.ts (thrust_away)
reference/src/project-obj.c -> packages/core/src/game/project-obj.ts (project_o, invenDamage)
reference/src/project-player.c -> packages/core/src/game/project-player.ts (project_p driver), packages/core/src/game/player-side.ts (project_player_handler_*), packages/core/src/world/projection.ts (adjustDam)
