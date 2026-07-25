# W2 Wiring Adjudication

All 212 input rows were adjudicated. Verdict totals: LIVE-VIA 30, BENIGN 160, NOT-WIRED 22.

| status | symbol | file:line | verdict | evidence |
|---|---|---|---|---|
| TEST-ONLY | cmdVerb | packages/core/src/cmd.ts:284 | BENIGN | BENIGN: pure command API/test seams; gameplay uses command objects and the queue. |
| TEST-ONLY | cmdSetArg | packages/core/src/cmd.ts:335 | BENIGN | BENIGN: pure command API/test seams; gameplay uses command objects and the queue. |
| TEST-ONLY | cmdGetArg | packages/core/src/cmd.ts:343 | BENIGN | BENIGN: pure command API/test seams; gameplay uses command objects and the queue. |
| TEST-ONLY | resetColorTable | packages/core/src/color.ts:221 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | COLOUR_TEAL | packages/core/src/color.ts:28 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | COLOUR_MUD | packages/core/src/color.ts:29 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | COLOUR_L_YELLOW | packages/core/src/color.ts:30 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | COLOUR_MAGENTA | packages/core/src/color.ts:31 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | COLOUR_L_VIOLET | packages/core/src/color.ts:33 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | COLOUR_L_PINK | packages/core/src/color.ts:34 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | COLOUR_MUSTARD | packages/core/src/color.ts:35 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | COLOUR_BLUE_SLATE | packages/core/src/color.ts:36 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | COLOUR_DEEP_L_BLUE | packages/core/src/color.ts:37 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | ATTR_MONO | packages/core/src/color.ts:51 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | ATTR_VGA | packages/core/src/color.ts:52 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | ATTR_BLIND | packages/core/src/color.ts:53 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | ATTR_HIGH | packages/core/src/color.ts:56 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | ATTR_METAL | packages/core/src/color.ts:57 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| ORPHAN | ATTR_MISC | packages/core/src/color.ts:58 | BENIGN | BENIGN: color.ts:10-59 is the complete upstream palette/attribute set; :221 resets the translation table. |
| TEST-ONLY | learnBrandSlayFromLaunch | packages/core/src/combat/brand-slay.ts:337 | NOT-WIRED | reference/src/player-attack.c:1255-1259; ranged-cmd.ts:112-119 has no launch-learning call |
| TEST-ONLY | learnBrandSlayFromThrow | packages/core/src/combat/brand-slay.ts:353 | NOT-WIRED | reference/src/player-attack.c:1296-1299; ranged-cmd.ts:112-119 has no throw-learning call |
| TEST-ONLY | RESOLVED_BLOW_EFFECTS | packages/core/src/combat/mon-melee.ts:600 | BENIGN | BENIGN: retained compatibility/generated/test seam; no missing player path found. |
| DEAD-LOCAL | STATE_BASE_DIGIT | packages/core/src/dice.ts:42 | BENIGN | BENIGN: legacy parser-state aliases; live dice parsing does not depend on these locals. |
| DEAD-LOCAL | STATE_DICE_DIGIT | packages/core/src/dice.ts:44 | BENIGN | BENIGN: legacy parser-state aliases; live dice parsing does not depend on these locals. |
| DEAD-LOCAL | STATE_SIDE_DIGIT | packages/core/src/dice.ts:46 | BENIGN | BENIGN: legacy parser-state aliases; live dice parsing does not depend on these locals. |
| DEAD-LOCAL | STATE_BONUS_DIGIT | packages/core/src/dice.ts:49 | BENIGN | BENIGN: legacy parser-state aliases; live dice parsing does not depend on these locals. |
| ORPHAN | EFFECT_VALUE_BASE_NAMES | packages/core/src/effects/effect.ts:371 | BENIGN | BENIGN: exported effect value-name introspection table; live effect resolution uses the registry. |
| TEST-ONLY | GAME_EVENT_TYPES | packages/core/src/events.ts:163 | BENIGN | BENIGN: event-name completeness list for typing/tests; dispatch uses registered event strings. |
| TEST-ONLY | countChests | packages/core/src/game/chest.ts:113 | BENIGN | BENIGN: pure chest count fixture; live chest state is maintained by generation/opening paths. |
| ORPHAN | ATTACK_HANDLER_CODES | packages/core/src/game/effect-attack.ts:740 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | DETECT_HANDLER_CODES | packages/core/src/game/effect-detect.ts:524 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | GENERAL_HANDLER_CODES | packages/core/src/game/effect-general.ts:1026 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | ITEM_HANDLER_CODES | packages/core/src/game/effect-item.ts:977 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | MELEE_HANDLER_CODES | packages/core/src/game/effect-melee.ts:518 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | MONSTER_HANDLER_CODES | packages/core/src/game/effect-monster.ts:285 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | SUMMON_HANDLER_CODES | packages/core/src/game/effect-summon.ts:161 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | TELEPORT_HANDLER_CODES | packages/core/src/game/effect-teleport.ts:614 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| ORPHAN | TERRAIN_HANDLER_CODES | packages/core/src/game/effect-terrain.ts:783 | BENIGN | BENIGN: live effect dispatch uses numeric handler tables; exported code arrays are completeness/introspection lists. |
| TEST-ONLY | canAct | packages/core/src/game/energy.ts:38 | BENIGN | BENIGN: scheduler.ts:67,114,149 is the live turn-energy path and imports turnEnergy; these helpers are test/convenience duplicates. |
| TEST-ONLY | gainEnergy | packages/core/src/game/energy.ts:46 | BENIGN | BENIGN: scheduler.ts:67,114,149 is the live turn-energy path and imports turnEnergy; these helpers are test/convenience duplicates. |
| TEST-ONLY | spendEnergy | packages/core/src/game/energy.ts:59 | BENIGN | BENIGN: scheduler.ts:67,114,149 is the live turn-energy path and imports turnEnergy; these helpers are test/convenience duplicates. |
| TEST-ONLY | NORMAL_SPEED | packages/core/src/game/energy.ts:32 | BENIGN | BENIGN: scheduler.ts:67,114,149 is the live turn-energy path and imports turnEnergy; these helpers are test/convenience duplicates. |
| TEST-ONLY | cycleStoreInclusion | packages/core/src/game/equip-cmp.ts:68 | BENIGN | BENIGN: pure comparison helper used by tests; store cycling uses the live inclusion list. |
| MODULE-UNREACHABLE | makeBlow | packages/core/src/game/harness.ts:82 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | makeRace | packages/core/src/game/harness.ts:108 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | makePlayer | packages/core/src/game/harness.ts:126 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | defaultCombat | packages/core/src/game/harness.ts:139 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | defaultDefense | packages/core/src/game/harness.ts:155 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | openField | packages/core/src/game/harness.ts:160 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | makeState | packages/core/src/game/harness.ts:185 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | addMon | packages/core/src/game/harness.ts:255 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | featureReg | packages/core/src/game/harness.ts:50 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | FLOOR | packages/core/src/game/harness.ts:51 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | GRANITE | packages/core/src/game/harness.ts:52 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | monReg | packages/core/src/game/harness.ts:54 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| MODULE-UNREACHABLE | plReg | packages/core/src/game/harness.ts:65 | BENIGN | BENIGN: headless test fixture module, not a gameplay entry point. |
| ORPHAN | monsterGroupIndex | packages/core/src/game/mon-group.ts:46 | BENIGN | BENIGN: group index/leader helpers are compatibility/test seams; live grouping stores indices directly. |
| TEST-ONLY | monsterGroupLeaderIdx | packages/core/src/game/mon-group.ts:51 | BENIGN | BENIGN: group index/leader helpers are compatibility/test seams; live grouping stores indices directly. |
| TEST-ONLY | monsterGroupChangeIndex | packages/core/src/game/mon-group.ts:230 | BENIGN | BENIGN: group index/leader helpers are compatibility/test seams; live grouping stores indices directly. |
| ORPHAN | MONSTER_LIST_SECTION_MAX | packages/core/src/game/mon-list.ts:34 | BENIGN | BENIGN: list-section limit aliases; live rendering uses computed sections. |
| ORPHAN | OBJECT_LIST_SECTION_MAX | packages/core/src/game/obj-list.ts:42 | BENIGN | BENIGN: list-section limit aliases; live rendering uses computed sections. |
| ORPHAN | pathNearestKnown | packages/core/src/game/player-path.ts:588 | NOT-WIRED | cmd-cave.c:1434,1480; ui-target.c:1509,1528; no live stair-search/nearest-known path caller |
| TEST-ONLY | pathfindDirectionTo | packages/core/src/game/player-path.ts:737 | BENIGN | BENIGN: pure pathfinding test seam; live movement uses its own path/step queue. |
| TEST-ONLY | targetSighted | packages/core/src/game/target.ts:329 | BENIGN | BENIGN: pure target predicate retained for tests; targeting updates visibility through target state. |
| TEST-ONLY | squareSetTrapTimeout | packages/core/src/game/trap.ts:581 | BENIGN | BENIGN: pure trap test seam; effects mutate trap state through handlers. |
| ORPHAN | wizCreateAllArtifact | packages/core/src/game/wizard.ts:416 | NOT-WIRED | reference/src/cmd-core.c:135; web wizard has no all-artifact action |
| ORPHAN | wizCreateAllArtifactFromTval | packages/core/src/game/wizard.ts:430 | NOT-WIRED | reference/src/cmd-core.c:136; web wizard has no all-artifacts-by-tval action |
| ORPHAN | wizCreateAllObj | packages/core/src/game/wizard.ts:448 | NOT-WIRED | reference/src/cmd-core.c:137; web wizard exposes only ordinary objects from tval |
| ORPHAN | wizTweakItem | packages/core/src/game/wizard.ts:930 | NOT-WIRED | reference/src/cmd-core.c:171; ui-wizard.c:1736-1760; no web wizard action calls wizTweakItem |
| ORPHAN | wizTeleportTo | packages/core/src/game/wizard.ts:1033 | NOT-WIRED | reference/src/cmd-core.c:170; ui-wizard.c:236-247; web wizard uses runTeleportTo:664-687 and emits EF.TELEPORT_TO directly |
| TEST-ONLY | wizCheatDeath | packages/core/src/game/wizard.ts:1077 | NOT-WIRED | ui-display.c:2780-2781 registers cheat_death; no web death-event handler or wizard action calls wizCheatDeath |
| TEST-ONLY | DUN | packages/core/src/generated/dun-profiles.ts:20 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | EQUIP | packages/core/src/generated/equip-slots.ts:23 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | HISTORY_TYPE_ENTRIES | packages/core/src/generated/history-types.ts:7 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | KIND_FLAG_ENTRIES | packages/core/src/generated/kind-flags.ts:7 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | PARSER_ERROR_ENTRIES | packages/core/src/generated/parser-errors.ts:7 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | PARSE_ERROR | packages/core/src/generated/parser-errors.ts:75 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | RANDART_PROPERTY_ENTRIES | packages/core/src/generated/randart-properties.ts:7 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| ORPHAN | ROOM_FLAG_ENTRIES | packages/core/src/generated/room-flags.ts:11 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| TEST-ONLY | TERRAIN_ENTRIES | packages/core/src/generated/terrain.ts:7 | BENIGN | BENIGN: generated enum/table export for code generation, serialization, and completeness; runtime uses generated maps/compiled data. |
| TEST-ONLY | subGuardi16 | packages/core/src/guard.ts:49 | BENIGN | BENIGN: pure geometry/guard helper and direction constants retained for tests/API compatibility. |
| TEST-ONLY | locOffset | packages/core/src/loc.ts:44 | BENIGN | BENIGN: pure geometry/guard helper and direction constants retained for tests/API compatibility. |
| TEST-ONLY | DDX_DDD | packages/core/src/loc.ts:94 | BENIGN | BENIGN: pure geometry/guard helper and direction constants retained for tests/API compatibility. |
| TEST-ONLY | DDY_DDD | packages/core/src/loc.ts:97 | BENIGN | BENIGN: pure geometry/guard helper and direction constants retained for tests/API compatibility. |
| TEST-ONLY | CLOCKWISE_DDD | packages/core/src/loc.ts:116 | BENIGN | BENIGN: pure geometry/guard helper and direction constants retained for tests/API compatibility. |
| REF-UNREACHABLE | slug | packages/core/src/mod/ids.ts:58 | LIVE-VIA | LIVE-VIA: main.ts:3805 -> saveGame -> game.ts:2884 -> ContentIdResolver -> mod/ids.ts:58. |
| TEST-ONLY | coreId | packages/core/src/mod/ids.ts:71 | BENIGN | BENIGN: mod-ID test/API helper; live save/load identity uses slug and ContentIdResolver. |
| TEST-ONLY | loreLearnSpellIfHas | packages/core/src/mon/lore.ts:126 | BENIGN | BENIGN: pure lore predicates retained for tests; live lore updates occur in observation/spell paths. |
| TEST-ONLY | loreIsFullyKnown | packages/core/src/mon/lore.ts:243 | BENIGN | BENIGN: pure lore predicates retained for tests; live lore updates occur in observation/spell paths. |
| TEST-ONLY | monsterHasSpells | packages/core/src/mon/predicate.ts:134 | BENIGN | BENIGN: predicate API retained for parity/tests; no live C call reaches the innate-only helper. |
| ORPHAN | monsterHasInnateSpells | packages/core/src/mon/predicate.ts:144 | BENIGN | BENIGN: predicate API retained for parity/tests; no live C call reaches the innate-only helper. |
| ORPHAN | objPackFromJson | packages/core/src/obj/bind.ts:1196 | BENIGN | BENIGN: save/pack JSON compatibility reader; runtime loading uses bound compiled pack data. |
| ORPHAN | IGNORE_IF_UNAWARE | packages/core/src/obj/ignore.ts:60 | BENIGN | BENIGN: ignore-policy mask completeness export; live decisions use the composed mask. |
| TEST-ONLY | missileLearnOnRangedAttack | packages/core/src/obj/knowledge.ts:561 | NOT-WIRED | reference/src/player-attack.c:1137,1258; ranged-cmd.ts:112-119 has no missile knowledge call |
| ORPHAN | equipLearnOnRangedAttack | packages/core/src/obj/knowledge.ts:601 | NOT-WIRED | reference/src/player-attack.c:1140; ranged-cmd.ts:112-119 has no equipment knowledge call |
| TEST-ONLY | getAutoinscription | packages/core/src/obj/knowledge.ts:1343 | BENIGN | BENIGN: pure knowledge/UI helper exercised by tests; display reads stored inscriptions. |
| ORPHAN | tvalIsMushroom | packages/core/src/obj/object.ts:78 | NOT-WIRED | reference/src/obj-gear.c:881; no pickup/flavor-awareness caller |
| ORPHAN | tvalCanHaveNourishment | packages/core/src/obj/object.ts:99 | BENIGN | BENIGN: C helper has no live call site; eating uses direct food/potion/mushroom cases. |
| ORPHAN | tvalIsZapper | packages/core/src/obj/object.ts:270 | NOT-WIRED | reference/src/obj-gear.c:884; no pickup/flavor-awareness caller |
| TEST-ONLY | objectPackTotal | packages/core/src/obj/object.ts:1002 | BENIGN | BENIGN: pure object-pack count helper retained for tests; live gear totals are maintained by the gear container. |
| ORPHAN | OSTACK_NONE | packages/core/src/obj/object.ts:864 | BENIGN | BENIGN: sentinel/boundary constant for object serialization and enum completeness. |
| DEAD-LOCAL | AMMO_RESCALER | packages/core/src/obj/power.ts:64 | BENIGN | BENIGN: legacy C-derived ammo-power constant; no active power path requires the unused alias. |
| REF-UNREACHABLE | addFlag | packages/core/src/obj/randart-build.ts:585 | LIVE-VIA | LIVE-VIA: main.ts:602 -> startGame -> game.ts:2374 -> randart.ts:513 -> randart-build.ts:585. |
| ORPHAN | ELEM_BASE_MAX | packages/core/src/obj/types.ts:40 | BENIGN | BENIGN: sentinel/boundary constant for object serialization and enum completeness. |
| TEST-ONLY | pointBuyCost | packages/core/src/player/birth.ts:134 | BENIGN | BENIGN: character-creation pure helper/test seam; live birth state applies the same calculation. |
| TEST-ONLY | incrementNameSuffix | packages/core/src/player/birth.ts:749 | BENIGN | BENIGN: character-creation pure helper/test seam; live birth state applies the same calculation. |
| TEST-ONLY | historyClear | packages/core/src/player/history.ts:60 | BENIGN | BENIGN: history reset helper used by tests; live history generation owns the state. |
| ORPHAN | spellBookCountSpells | packages/core/src/player/spell.ts:221 | NOT-WIRED | reference/src/ui-spell.c:231-238; main.ts:2327-2341 builds browse menu without count/gate filtering |
| ORPHAN | spellOkayToBrowse | packages/core/src/player/spell.ts:247 | NOT-WIRED | reference/src/ui-spell.c:322-324; main.ts:2331,2340-2341 uses bookSpellMenu and enables rows |
| TEST-ONLY | randomChanceScaled | packages/core/src/rng.ts:426 | BENIGN | BENIGN: deterministic RNG test seams; production randomness uses configured game RNG. |
| TEST-ONLY | RngStreams | packages/core/src/rng.ts:435 | BENIGN | BENIGN: deterministic RNG test seams; production randomness uses configured game RNG. |
| TEST-ONLY | writeSavefile | packages/core/src/save/buffer.ts:207 | BENIGN | BENIGN: low-level save-buffer round-trip compatibility/test helpers; live save/load uses session functions. |
| TEST-ONLY | readSavefile | packages/core/src/save/buffer.ts:254 | BENIGN | BENIGN: low-level save-buffer round-trip compatibility/test helpers; live save/load uses session functions. |
| TEST-ONLY | scoreRows | packages/core/src/score/display.ts:111 | BENIGN | BENIGN: pure score reporting seams; score submission/display uses high-score state. |
| TEST-ONLY | highscoreCount | packages/core/src/score/score.ts:191 | BENIGN | BENIGN: pure score reporting seams; score submission/display uses high-score state. |
| TEST-ONLY | GRAPHICS_MODE_HIGH_ID | packages/core/src/visuals/grafmode.ts:91 | BENIGN | BENIGN: visual preference/tile lookup test seams; web rendering reaches tile-prefs through display setup. |
| TEST-ONLY | parseTilePrefs | packages/core/src/visuals/tile-prefs.ts:411 | BENIGN | BENIGN: visual preference/tile lookup test seams; web rendering reaches tile-prefs through display setup. |
| TEST-ONLY | tileForFlavor | packages/core/src/visuals/tile-prefs.ts:455 | BENIGN | BENIGN: visual preference/tile lookup test seams; web rendering reaches tile-prefs through display setup. |
| TEST-ONLY | tileForProjection | packages/core/src/visuals/tile-prefs.ts:464 | BENIGN | BENIGN: visual preference/tile lookup test seams; web rendering reaches tile-prefs through display setup. |
| ORPHAN | featIsTorch | packages/core/src/world/chunk.ts:90 | NOT-WIRED | reference/src/ui-map.c:117; main.ts:4551-4559 selects lighting tiles directly and never calls featIsTorch |
| MODULE-UNREACHABLE | main | packages/content/src/compile.ts:25 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | CORE_NAMESPACE | packages/content/src/index.ts:12 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | parseSignature | packages/content/src/parser.ts:73 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | isValidRandom | packages/content/src/parser.ts:208 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | parseLine | packages/content/src/parser.ts:338 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | ParseError | packages/content/src/parser.ts:46 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | compileGamedata | packages/content/src/records.ts:155 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | dungeonProfileSpec | packages/content/src/specs/generate.ts:11 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | roomTemplateSpec | packages/content/src/specs/generate.ts:29 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | vaultSpec | packages/content/src/specs/generate.ts:46 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | gamedataSpecs | packages/content/src/specs/index.ts:58 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | constantsSpec | packages/content/src/specs/init.ts:11 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | worldSpec | packages/content/src/specs/init.ts:38 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | playerPropertySpec | packages/content/src/specs/init.ts:45 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | namesSpec | packages/content/src/specs/init.ts:59 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | trapSpec | packages/content/src/specs/init.ts:69 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | terrainSpec | packages/content/src/specs/init.ts:96 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | bodySpec | packages/content/src/specs/init.ts:120 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | historySpec | packages/content/src/specs/init.ts:130 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | pRaceSpec | packages/content/src/specs/init.ts:140 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | realmSpec | packages/content/src/specs/init.ts:170 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | shapeSpec | packages/content/src/specs/init.ts:183 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | classSpec | packages/content/src/specs/init.ts:210 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | flavorSpec | packages/content/src/specs/init.ts:250 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | hintsSpec | packages/content/src/specs/init.ts:261 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | summonSpec | packages/content/src/specs/misc.ts:12 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | chestTrapSpec | packages/content/src/specs/misc.ts:27 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | questSpec | packages/content/src/specs/misc.ts:45 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | playerTimedSpec | packages/content/src/specs/misc.ts:62 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | storeSpec | packages/content/src/specs/misc.ts:94 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | uiKnowledgeSpec | packages/content/src/specs/misc.ts:117 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | blowMethodsSpec | packages/content/src/specs/mon-init.ts:11 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | blowEffectsSpec | packages/content/src/specs/mon-init.ts:27 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | painSpec | packages/content/src/specs/mon-init.ts:45 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | monsterSpellSpec | packages/content/src/specs/mon-init.ts:61 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | monsterBaseSpec | packages/content/src/specs/mon-init.ts:85 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | monsterSpec | packages/content/src/specs/mon-init.ts:98 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | pitSpec | packages/content/src/specs/mon-init.ts:139 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | projectionSpec | packages/content/src/specs/obj-init.ts:11 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | objectBaseSpec | packages/content/src/specs/obj-init.ts:34 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | slaySpec | packages/content/src/specs/obj-init.ts:49 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | brandSpec | packages/content/src/specs/obj-init.ts:66 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | curseSpec | packages/content/src/specs/obj-init.ts:82 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | activationSpec | packages/content/src/specs/obj-init.ts:105 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | objectSpec | packages/content/src/specs/obj-init.ts:123 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | egoItemSpec | packages/content/src/specs/obj-init.ts:158 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | artifactSpec | packages/content/src/specs/obj-init.ts:183 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | objectPropertySpec | packages/content/src/specs/obj-init.ts:209 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | uiEntryBaseSpec | packages/content/src/specs/ui-entry.ts:44 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | uiEntrySpec | packages/content/src/specs/ui-entry.ts:51 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | uiEntryRendererSpec | packages/content/src/specs/ui-entry.ts:58 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | visualsSpec | packages/content/src/specs/visuals.ts:27 | BENIGN | BENIGN: build-time compiler/parser/spec tables; web pack.ts:4-13,25-37 consumes committed compiled pack JSON. |
| MODULE-UNREACHABLE | definePlugin | packages/web/src/agents/sandbox/worker-runtime.ts:122 | LIVE-VIA | LIVE-VIA: demo-sandbox/plugin.ts:17-20 -> worker-runtime entry; runWorkerRuntime:346 reaches this helper. |
| MODULE-UNREACHABLE | snapshotView | packages/web/src/agents/sandbox/worker-runtime.ts:155 | LIVE-VIA | LIVE-VIA: demo-sandbox/plugin.ts:17-20 -> worker-runtime entry; runWorkerRuntime:346 reaches this helper. |
| MODULE-UNREACHABLE | sandboxActions | packages/web/src/agents/sandbox/worker-runtime.ts:198 | LIVE-VIA | LIVE-VIA: demo-sandbox/plugin.ts:17-20 -> worker-runtime entry; runWorkerRuntime:346 reaches this helper. |
| MODULE-UNREACHABLE | createRuntimeHandler | packages/web/src/agents/sandbox/worker-runtime.ts:261 | LIVE-VIA | LIVE-VIA: demo-sandbox/plugin.ts:17-20 -> worker-runtime entry; runWorkerRuntime:346 reaches this helper. |
| MODULE-UNREACHABLE | runWorkerRuntime | packages/web/src/agents/sandbox/worker-runtime.ts:346 | LIVE-VIA | LIVE-VIA: demo-sandbox/plugin.ts:17-20 -> worker-runtime entry; runWorkerRuntime:346 reaches this helper. |
| MODULE-UNREACHABLE | SandboxCapabilityError | packages/web/src/agents/sandbox/worker-runtime.ts:131 | LIVE-VIA | LIVE-VIA: demo-sandbox/plugin.ts:17-20 -> worker-runtime entry; runWorkerRuntime:346 reaches this helper. |
| ORPHAN | defineTrustedPlugin | packages/web/src/agents/trusted/runtime.ts:44 | LIVE-VIA | LIVE-VIA: main.ts:6431 -> installTrusted -> packages/web/mods/demo-trusted/trusted.ts:24-26 -> defineTrustedPlugin. |
| TEST-ONLY | clearInputQueue | packages/web/src/input-queue.ts:77 | BENIGN | BENIGN: reset helpers are test teardown seams; live input/keymap stores remain wired. |
| TEST-ONLY | clearKeymaps | packages/web/src/keymap-store.ts:83 | BENIGN | BENIGN: reset helpers are test teardown seams; live input/keymap stores remain wired. |
| DEAD-LOCAL | TITLE_COLOR | packages/web/src/knowledge.ts:70 | BENIGN | BENIGN: unused local cosmetic color alias; knowledge rendering uses live color runs. |
| ORPHAN | packHandles | packages/web/src/screens.ts:233 | BENIGN | BENIGN: pure handle extractor; live UI uses packMenu/inventoryLines over the same gear.pack. |
| ORPHAN | equipmentMenu | packages/web/src/screens.ts:387 | BENIGN | BENIGN: alternate pure selector; live takeoff uses selectItemFrom/equipmentLines over the same equipment slots. |
| TEST-ONLY | autoinscriptionMenu | packages/web/src/screens.ts:905 | BENIGN | BENIGN: pure menu formatter exercised by tests; live item knowledge reads stored inscriptions. |
| REF-UNREACHABLE | collectLevel | packages/cli/src/stats.ts:221 | LIVE-VIA | LIVE-VIA: main-stats.ts:53-57 -> runStatsBatch -> stats.ts:291 -> collectLevel. |
| MODULE-UNREACHABLE | objMonStats | packages/cli/src/wiz-stats.ts:112 | NOT-WIRED | reference/src/cmd-core.c:132-133; main-stats.ts:53-57 does not dispatch wiz-stats.ts |
| MODULE-UNREACHABLE | pitStats | packages/cli/src/wiz-stats.ts:228 | NOT-WIRED | reference/src/cmd-core.c:133; main-stats.ts:53-57 does not dispatch wiz-stats.ts |
| MODULE-UNREACHABLE | disconnectStats | packages/cli/src/wiz-stats.ts:402 | NOT-WIRED | reference/src/cmd-core.c:132; main-stats.ts:53-57 does not dispatch wiz-stats.ts |
| MODULE-UNREACHABLE | DEFAULT_OBJ_MON_PARAMS | packages/cli/src/wiz-stats.ts:74 | NOT-WIRED | reference/src/cmd-core.c:133; wiz-stats.ts is not reachable from the port wizard command table |
| MODULE-UNREACHABLE | DEFAULT_PIT_PARAMS | packages/cli/src/wiz-stats.ts:193 | NOT-WIRED | reference/src/cmd-core.c:133; wiz-stats.ts is not reachable from the port wizard command table |
| MODULE-UNREACHABLE | DEFAULT_DISCONNECT_PARAMS | packages/cli/src/wiz-stats.ts:315 | NOT-WIRED | reference/src/cmd-core.c:132; wiz-stats.ts is not reachable from the port wizard command table |
| MODULE-UNREACHABLE | parseCapability | packages/mod-sdk/src/capabilities.ts:76 | LIVE-VIA | LIVE-VIA: main.ts:6239 -> CapabilitySet.fromManifest -> parseCapability. |
| MODULE-UNREACHABLE | CapabilityError | packages/mod-sdk/src/capabilities.ts:53 | LIVE-VIA | LIVE-VIA: main.ts:6239 -> CapabilitySet.fromManifest -> CapabilityError. |
| MODULE-UNREACHABLE | CapabilitySet | packages/mod-sdk/src/capabilities.ts:134 | LIVE-VIA | LIVE-VIA: main.ts:6239 -> CapabilitySet.fromManifest -> CapabilitySet. |
| MODULE-UNREACHABLE | mergePatch | packages/mod-sdk/src/compose.ts:74 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches mergePatch. |
| MODULE-UNREACHABLE | composePacks | packages/mod-sdk/src/compose.ts:108 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches composePacks. |
| MODULE-UNREACHABLE | ComposeError | packages/mod-sdk/src/compose.ts:71 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches ComposeError. |
| MODULE-UNREACHABLE | computeConflictReport | packages/mod-sdk/src/conflicts.ts:165 | LIVE-VIA | LIVE-VIA: pack.ts:150-151 -> computeConflictReport. |
| MODULE-UNREACHABLE | composeContentPacks | packages/mod-sdk/src/loader.ts:92 | LIVE-VIA | LIVE-VIA: pack.ts:206-237 -> composeContentPacks. |
| MODULE-UNREACHABLE | validateManifest | packages/mod-sdk/src/manifest.ts:118 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches validateManifest. |
| MODULE-UNREACHABLE | slugify | packages/mod-sdk/src/manifest.ts:244 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches slugify. |
| MODULE-UNREACHABLE | packRef | packages/mod-sdk/src/manifest.ts:252 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches packRef. |
| MODULE-UNREACHABLE | ManifestError | packages/mod-sdk/src/manifest.ts:115 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches ManifestError. |
| MODULE-UNREACHABLE | applyFieldPatch | packages/mod-sdk/src/patch.ts:87 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches applyFieldPatch. |
| MODULE-UNREACHABLE | composeFieldPatches | packages/mod-sdk/src/patch.ts:178 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches composeFieldPatches. |
| MODULE-UNREACHABLE | touchedFields | packages/mod-sdk/src/patch.ts:208 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches touchedFields. |
| MODULE-UNREACHABLE | PatchError | packages/mod-sdk/src/patch.ts:22 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches PatchError. |
| MODULE-UNREACHABLE | resolveLoadOrder | packages/mod-sdk/src/resolve.ts:61 | LIVE-VIA | LIVE-VIA: pack.ts:145 -> resolveLoadOrder, entered from main.ts:177. |
| MODULE-UNREACHABLE | ResolveError | packages/mod-sdk/src/resolve.ts:30 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches ResolveError. |
| MODULE-UNREACHABLE | satisfies | packages/mod-sdk/src/semver.ts:220 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches satisfies. |
| MODULE-UNREACHABLE | SemverError | packages/mod-sdk/src/semver.ts:31 | LIVE-VIA | LIVE-VIA: main.ts:177 -> pack.ts:206-237 -> mod-sdk composition/validation chain reaches SemverError. |


## NOT-WIRED findings

### W2-001  learnBrandSlayFromLaunch
port:      packages/core/src/combat/brand-slay.ts:337
ref:       reference/src/obj-slays.c:613
c-path:    reference/src/player-attack.c:1255-1259
port-gap:  ranged-cmd.ts:112-119 has no launch-learning call
effect:    launched brands/slays are not learned
severity:  P1
confidence: high

### W2-002  learnBrandSlayFromThrow
port:      packages/core/src/combat/brand-slay.ts:353
ref:       reference/src/obj-slays.c:629
c-path:    reference/src/player-attack.c:1296-1299
port-gap:  ranged-cmd.ts:112-119 has no throw-learning call
effect:    thrown brands/slays are not learned
severity:  P1
confidence: high

### W2-003  pathNearestKnown
port:      packages/core/src/game/player-path.ts:588
ref:       reference/src/player-path.c:834
c-path:    cmd-cave.c:1434,1480; ui-target.c:1509,1528
port-gap:  no live stair-search/nearest-known path caller
effect:    auto-travel and target-panel stair jumps are absent
severity:  P2
confidence: high

### W2-004  wizCreateAllArtifact
port:      packages/core/src/game/wizard.ts:416
ref:       reference/src/cmd-wizard.c:728
c-path:    reference/src/cmd-core.c:135
port-gap:  web wizard has no all-artifact action
effect:    wizard create-all-artifacts is unavailable
severity:  P2
confidence: high

### W2-005  wizCreateAllArtifactFromTval
port:      packages/core/src/game/wizard.ts:430
ref:       reference/src/cmd-wizard.c:746
c-path:    reference/src/cmd-core.c:136
port-gap:  web wizard has no all-artifacts-by-tval action
effect:    filtered create-all-artifacts is unavailable
severity:  P2
confidence: high

### W2-006  wizCreateAllObj
port:      packages/core/src/game/wizard.ts:448
ref:       reference/src/cmd-wizard.c:780
c-path:    reference/src/cmd-core.c:137
port-gap:  web wizard exposes only ordinary objects from tval
effect:    unfiltered create-all-objects is unavailable
severity:  P2
confidence: high

### W2-007  wizTweakItem
port:      packages/core/src/game/wizard.ts:930
ref:       reference/src/cmd-wizard.c:2698
c-path:    reference/src/cmd-core.c:171; ui-wizard.c:1736-1760
port-gap:  no web wizard action calls wizTweakItem
effect:    wizard item tuning is unavailable
severity:  P2
confidence: high

### W2-008  wizTeleportTo
port:      packages/core/src/game/wizard.ts:1033
ref:       reference/src/cmd-wizard.c:2673
c-path:    reference/src/cmd-core.c:170; ui-wizard.c:236-247
port-gap:  web wizard uses runTeleportTo:664-687 and emits EF.TELEPORT_TO directly
effect:    helper seam is bypassed; equivalent teleport effect currently exists
severity:  P3
confidence: high

### W2-009  wizCheatDeath
port:      packages/core/src/game/wizard.ts:1077
ref:       reference/src/ui-display.c:2568-2573
c-path:    ui-display.c:2780-2781 registers cheat_death
port-gap:  no web death-event handler or wizard action calls wizCheatDeath
effect:    wizard cheat-death recovery is unavailable
severity:  P1
confidence: high

### W2-010  missileLearnOnRangedAttack
port:      packages/core/src/obj/knowledge.ts:561
ref:       reference/src/obj-knowledge.c:1945
c-path:    reference/src/player-attack.c:1137,1258
port-gap:  ranged-cmd.ts:112-119 has no missile knowledge call
effect:    ranged ammo/launcher rune knowledge does not update
severity:  P1
confidence: high

### W2-011  equipLearnOnRangedAttack
port:      packages/core/src/obj/knowledge.ts:601
ref:       reference/src/obj-knowledge.c:2007
c-path:    reference/src/player-attack.c:1140
port-gap:  ranged-cmd.ts:112-119 has no equipment knowledge call
effect:    equipped rune knowledge does not learn from ranged attacks
severity:  P1
confidence: high

### W2-012  tvalIsMushroom
port:      packages/core/src/obj/object.ts:78
ref:       reference/src/obj-tval.c:59
c-path:    reference/src/obj-gear.c:881
port-gap:  no pickup/flavor-awareness caller
effect:    KNOW_MUSHROOM pickup identification is absent
severity:  P2
confidence: high

### W2-013  tvalIsZapper
port:      packages/core/src/obj/object.ts:270
ref:       reference/src/obj-tval.c:353
c-path:    reference/src/obj-gear.c:884
port-gap:  no pickup/flavor-awareness caller
effect:    KNOW_ZAPPER wand/staff identification is absent
severity:  P2
confidence: high

### W2-014  spellBookCountSpells
port:      packages/core/src/player/spell.ts:221
ref:       reference/src/player-spell.c:299
c-path:    reference/src/ui-spell.c:231-238
port-gap:  main.ts:2327-2341 builds browse menu without count/gate filtering
effect:    empty/non-browsable books are offered instead of rejected
severity:  P2
confidence: high

### W2-015  spellOkayToBrowse
port:      packages/core/src/player/spell.ts:247
ref:       reference/src/player-spell.c:355-359
c-path:    reference/src/ui-spell.c:322-324
port-gap:  main.ts:2331,2340-2341 uses bookSpellMenu and enables rows
effect:    level-99 illegible spells can be presented as browseable
severity:  P2
confidence: high

### W2-016  featIsTorch
port:      packages/core/src/world/chunk.ts:90
ref:       reference/src/cave-square.c:148
c-path:    reference/src/ui-map.c:117
port-gap:  main.ts:4551-4559 selects lighting tiles directly and never calls featIsTorch
effect:    torch-flag terrain classification can diverge in display
severity:  P2
confidence: high

### W2-017  objMonStats
port:      packages/cli/src/wiz-stats.ts:112
ref:       reference/src/wiz-stats.c:1666
c-path:    reference/src/cmd-core.c:132-133
port-gap:  main-stats.ts:53-57 does not dispatch wiz-stats.ts
effect:    wizard object/monster statistics has no port command path
severity:  P3
confidence: high

### W2-018  pitStats
port:      packages/cli/src/wiz-stats.ts:228
ref:       reference/src/wiz-stats.c:1855
c-path:    reference/src/cmd-core.c:133
port-gap:  main-stats.ts:53-57 does not dispatch wiz-stats.ts
effect:    wizard pit statistics has no port command path
severity:  P3
confidence: high

### W2-019  disconnectStats
port:      packages/cli/src/wiz-stats.ts:402
ref:       reference/src/wiz-stats.c:2962
c-path:    reference/src/cmd-core.c:132
port-gap:  main-stats.ts:53-57 does not dispatch wiz-stats.ts
effect:    wizard disconnect statistics has no port command path
severity:  P3
confidence: high

### W2-020  DEFAULT_OBJ_MON_PARAMS
port:      packages/cli/src/wiz-stats.ts:74
ref:       reference/src/wiz-stats.c:1666
c-path:    reference/src/cmd-core.c:133
port-gap:  wiz-stats.ts is not reachable from the port wizard command table
effect:    corresponding wizard statistics action is unavailable
severity:  P3
confidence: high

### W2-021  DEFAULT_PIT_PARAMS
port:      packages/cli/src/wiz-stats.ts:193
ref:       reference/src/wiz-stats.c:1855
c-path:    reference/src/cmd-core.c:133
port-gap:  wiz-stats.ts is not reachable from the port wizard command table
effect:    corresponding wizard statistics action is unavailable
severity:  P3
confidence: high

### W2-022  DEFAULT_DISCONNECT_PARAMS
port:      packages/cli/src/wiz-stats.ts:315
ref:       reference/src/wiz-stats.c:2962
c-path:    reference/src/cmd-core.c:132
port-gap:  wiz-stats.ts is not reachable from the port wizard command table
effect:    corresponding wizard statistics action is unavailable
severity:  P3
confidence: high

## Tool blind spots

The census is static and misses package-alias imports, nested calls inside pack composition, worker entry points, and event/registry dispatch. Those were manually traced. Content compiler/spec sources are intentionally build-time inputs to committed pack JSON. The mod SDK is present in the web boot path and can compose bundled packs when enabled; default plugin settings do not imply the loader is absent. The CLI wizard statistics module remains unreachable from the port wizard command surface.
