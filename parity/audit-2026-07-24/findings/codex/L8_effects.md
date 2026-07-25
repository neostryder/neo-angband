### L8_effects-001  EF_SELECT never presents the player choice
sev: P1
concession: n
ref: reference/src/effects.c:437-450
port: packages/core/src/effects/interpreter.ts:487-500
expected: A player-origin EF_SELECT with multiple sub-effects calls the command/UI chooser, and cancellation returns false; the random choice is used only for an explicit random selection.
actual: The live port has no chooseEffect injection outside tests, so the no-UI fallback always selects a random sub-effect for player-origin EF_SELECT.
why: Selectable player effects silently lose their choice semantics and consume RNG as if the player requested random selection.
confidence: high

### L8_effects-002  ICE damage ignores cold resistance
sev: P1
concession: n
ref: reference/src/project-player.c:53-57
port: packages/core/src/game/project-player.ts:179-191
expected: PROJ_ICE remaps to PROJ_COLD before reading the player's resistance level, so cold resistance, immunity, and vulnerability affect ice damage.
actual: The port learns using the remapped cold type but reads resLevel with the original ICE type; ICE is outside the elemental range check, so resLevel is forced to zero.
why: Ice attacks bypass the player's cold resistance calculation on the live projection path.
confidence: high

### L8_effects-003  PROJECT_STOP does not stop at the active decoy
sev: P1
concession: n
ref: reference/src/project.c:146-147,215-219
port: packages/core/src/world/project.ts:95-113
expected: project_path finds cave->decoy and stops a PROJECT_STOP path when it reaches that decoy after the initial grid.
actual: The port compares against a permanent (-1,-1) sentinel and never consults the live GameState.decoy.
why: The port already stores an active decoy, but bolts and other PROJECT_STOP paths can pass through it instead of terminating there.
confidence: high

### L8_effects-004  PROJECT_INFO uses live walls instead of believed walls
sev: P2
concession: n
ref: reference/src/project.c:203-212
port: packages/core/src/world/project.ts:101-107
expected: PROJECT_INFO stops on square_isbelievedwall, using the player's remembered terrain for targeting and information paths.
actual: Both the normal and PROJECT_INFO branches call c.isProjectable, and the port explicitly substitutes the live map for the remembered-wall test.
why: Targeting and information projections can stop at different grids and use live terrain where the C path uses remembered terrain.
confidence: high

### L8_effects-005  Object projection observes unseen or unknown objects
sev: P2
concession: n
ref: reference/src/project-obj.c:545-551
port: packages/core/src/game/project-obj.ts:193-197
expected: Destruction is obvious only when obj->known, the object is not ignored, and the square is seen.
actual: The port treats squareIsSeen as both the square visibility and the per-object known test, so a seen square makes an unrecognized object observed.
why: Object destruction, resistance messages, and obviousness can leak knowledge for objects whose C known twin is absent.
confidence: high

### L8_effects-006  Buried-object discovery ignores item ignore status
sev: P2
concession: n
ref: reference/src/project-feat.c:114-124
port: packages/core/src/game/project-feat.ts:160-179
expected: After rubble creates an object, the buried-object message and obvious flag require the created object to be non-ignored and the square to be seen.
actual: The port emits the message whenever an object was created on a seen rubble square, without checking state.isIgnored.
why: Ignored buried items still produce the discovery message and mark the projection obvious.
confidence: high

### L8_effects-007  Monster cloning has no live multiply hook
sev: P1
concession: n
ref: reference/src/project-mon.c:887-901
port: packages/core/src/mon/project-mon.ts:673-679
expected: PROJ_MON_CLONE heals and hastens the monster, then calls multiply_monster and reports MON_MSG_SPAWN on a seen successful clone.
actual: The port calls an optional multiplyMonster hook, but the live session monster hooks do not provide it, so no clone is spawned.
why: Clone projections retain the heal and speed effects but omit their defining monster-creation side effect.
confidence: high

### L8_effects-008  Monster polymorph has no live replacement hook
sev: P1
concession: n
ref: reference/src/project-mon.c:1189-1231
port: packages/core/src/game/project-monster.ts:324-356
expected: A failed save is reported, and a successful eligible polymorph replaces the monster with a new race at the same grid.
actual: The port delegates replacement to an optional polymorph hook, but the live session does not provide it, so every eligible polymorph falls through to the maintain-shape message.
why: PROJ_MON_POLY and chaos polymorph effects cannot change a monster's race in the live path.
confidence: high

### L8_effects-009  show_damage monster messages are missing
sev: P2
concession: n
ref: reference/src/project-mon.c:1111-1158
port: packages/core/src/game/project-monster.ts:226-263
expected: When the player attacks and show_damage is enabled, visible monster hit and pain messages use the show-damage variants with the damage amount.
actual: The port always invokes the ordinary message and messagePain hooks; the live session supplies no show-damage branch for monster projections.
why: The option changes player-facing ranged and projection combat output in C but has no effect on monster damage messages in the port.
confidence: high

### L8_effects-010  Surviving projected monsters are not refreshed
sev: P2
concession: n
ref: reference/src/project-mon.c:1455-1468
port: packages/core/src/game/project-monster.ts:201-203
expected: After projection side effects, a surviving monster runs update_mon and square_light_spot, with recall redraw as required.
actual: The port makes this an optional onUpdate hook, and the live session does not provide that hook.
why: Projection changes to monster state and visibility/light presentation are not synchronously refreshed after the effect.
confidence: high

### L8_effects-011  Monster-origin player damage loses C killer description
sev: P2
concession: n
ref: reference/src/effect-handler-attack.c:466-491
port: packages/core/src/game/effect-attack.ts:687-691
expected: SRC_MONSTER damage builds the killer string with monster_desc(MDESC_DIED_FROM), preserving the upstream article and descriptive qualifiers before take_hit.
actual: The port passes only mon.race.name, with no monster_desc formatting, and explicitly defers the upstream death-cause description.
why: Death attribution and damage messages from monster-origin EF_DAMAGE differ from the C wording and can omit the proper article or contextual description.
confidence: high

## MAP L8_effects
reference/src/effect-handler.h -> packages/core/src/effects/effect.ts; packages/core/src/effects/interpreter.ts
reference/src/effect-handler-attack.c -> packages/core/src/game/effect-attack.ts
reference/src/effect-handler-general.c -> packages/core/src/game/effect-general.ts; packages/core/src/game/effect-detect.ts; packages/core/src/game/effect-teleport.ts; packages/core/src/game/effect-terrain.ts; packages/core/src/game/effect-monster.ts; packages/core/src/game/effect-summon.ts; packages/core/src/game/effect-item.ts; packages/core/src/game/effect-melee.ts
reference/src/effects.c -> packages/core/src/effects/effect.ts; packages/core/src/effects/interpreter.ts; packages/core/src/effects/effect-info.ts
reference/src/effects.h -> packages/core/src/effects/effect.ts; packages/core/src/effects/interpreter.ts
reference/src/effects-info.c -> packages/core/src/effects/effect-info.ts; packages/core/src/obj/effects-info.ts
reference/src/effects-info.h -> packages/core/src/effects/effect-info.ts; packages/core/src/obj/effects-info.ts
reference/src/list-effects.h -> packages/core/src/generated/effects.ts
reference/src/list-projections.h -> packages/core/src/generated/projections.ts
reference/src/project.c -> packages/core/src/world/project.ts
reference/src/project.h -> packages/core/src/world/project.ts; packages/core/src/world/projection.ts
reference/src/project-feat.c -> packages/core/src/game/project-feat.ts
reference/src/project-mon.c -> packages/core/src/mon/project-mon.ts; packages/core/src/game/project-monster.ts
reference/src/project-obj.c -> packages/core/src/game/project-obj.ts
reference/src/project-player.c -> packages/core/src/game/project-player.ts; packages/core/src/game/player-side.ts
