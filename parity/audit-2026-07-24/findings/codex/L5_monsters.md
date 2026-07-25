### L5_monsters-001  Ranged attacks ignore visibility when marking seen
sev: P2
concession: n
ref: reference/src/mon-attack.c:400
port: packages/core/src/game/mon-ranged.ts:317
expected: seen is true only when the player is not blind and the monster is visible.
actual: seen defaults to true, and the live installation does not pass a visibility value.
why: Blind players and unseen monsters can receive cast messages and lore credit.
confidence: high

### L5_monsters-002  Ranged attacks omit the unseen-target witness gate
sev: P2
concession: n
ref: reference/src/mon-attack.c:123
port: packages/core/src/game/mon-ranged.ts:291
expected: A non-player target is cast at only when the player can see the caster, target, or a path square.
actual: The port returns after range and projectability checks without testing witness visibility.
why: A monster can cast at an unseen decoy or other non-player target when C rejects the cast.
confidence: high

### L5_monsters-003  Melee smart-learning is absent
sev: P2
concession: n
ref: reference/src/mon-blows.c:486
port: packages/core/src/combat/mon-melee.ts:744
expected: Elemental, timed, disenchant, experience, and related blows call update_smart_learn for the attacker.
actual: Live melee blow handling applies effects but never updates the attacking monster's learned player resistances.
why: Smart monsters retain stale resistance knowledge and can repeatedly choose ineffective attacks.
confidence: high

### L5_monsters-004  Monster death cause uses the raw race name
sev: P2
concession: n
ref: reference/src/mon-attack.c:564
port: packages/core/src/game/mon-side.ts:155
expected: take_hit receives monster_desc(mon, MDESC_SHOW | MDESC_IND_VIS), such as the correct indefinite description.
actual: takeHit receives mon.race.name directly.
why: Death attribution and killer text differ for uniques, named monsters, and hidden monsters.
confidence: high

### L5_monsters-005  Melee disturbance timing and gating differ
sev: P2
concession: n
ref: reference/src/mon-attack.c:593
port: packages/core/src/combat/mon-melee.ts:988
expected: Every successful blow disturbs immediately; a miss disturbs only when its method reports misses.
actual: The melee driver does not disturb per blow; the caller applies a later visible-in-view end-of-turn gate.
why: Hits by unseen or off-view monsters may fail to interrupt running, while the timing of disturbance differs.
confidence: high

### L5_monsters-006  Light-emitting monsters do not advance melee lore when unseen
sev: P2
concession: n
ref: reference/src/mon-attack.c:569
port: packages/core/src/game/monster-turn.ts:1547
expected: Melee lore is analyzed when the monster is visible or its race emits light.
actual: Lore analysis is gated only by monsterIsVisible(mon).
why: Attacks from unseen light-emitting monsters do not update blow observations.
confidence: high

### L5_monsters-007  Monster-versus-monster blows skip C effect handlers
sev: P1
concession: n
ref: reference/src/mon-attack.c:798
port: packages/core/src/game/mon-cmd.ts:116
expected: monster_attack_monster dispatches melee handlers that apply armor reduction, elemental effects, statuses, theft, stat effects, and effect-specific damage.
actual: The port sends the raw rolled damage directly to monTakeHit and only handles stun separately.
why: Commanded monster attacks have incorrect damage and omit normal monster-blow mechanics.
confidence: high

### L5_monsters-008  Monster-versus-monster blow messages and RNG draws are missing
sev: P1
concession: n
ref: reference/src/mon-blows.c:225
port: packages/core/src/game/mon-cmd.ts:116
expected: Each handled monster-target blow calls display_blow_message_vs_monster, including its method action and randint0(num_messages) draw.
actual: Hit messages are not emitted and the action-message RNG draw is absent.
why: Visible combat text drifts and multi-message methods shift the RNG stream.
confidence: high

### L5_monsters-009  Monster-versus-monster lore is never analyzed
sev: P2
concession: n
ref: reference/src/mon-attack.c:872
port: packages/core/src/game/mon-cmd.ts:171
expected: Visible or light-emitting attacks increment blow observations and lore_update runs after the attack.
actual: monsterAttackMonster returns without recording blow observations or updating lore.
why: Commanded combat never teaches the player about the attacking race's blows.
confidence: high

### L5_monsters-010  Ranged casting does not run lore_update
sev: P2
concession: n
ref: reference/src/mon-attack.c:468
port: packages/core/src/game/mon-ranged.ts:383
expected: After a successful cast, lore_update derives known spell frequencies and other lore from the updated counters.
actual: The port increments spell flags and cast counters but never calls loreUpdate.
why: Derived spell-frequency knowledge remains stale after casting.
confidence: high

### L5_monsters-011  Live monster descriptions default to on-screen
sev: P2
concession: n
ref: reference/src/mon-desc.c:235
port: packages/core/src/mon/desc.ts:107
expected: A visible monster outside the current panel receives the " (offscreen)" suffix.
actual: panelContains defaults to a function that always returns true, and live callers commonly omit a panel predicate.
why: Offscreen monster names in live messages omit required C text.
confidence: med

### L5_monsters-012  AC knowledge learning occurs at the wrong point
sev: P3
concession: n
ref: reference/src/mon-attack.c:529
port: packages/core/src/combat/mon-melee.ts:204
expected: equip_learn_on_defend runs inside check_hit before each AC test.
actual: checkHit only performs the RNG hit test; the live caller performs one learning call after the whole attack.
why: AC knowledge timing differs and direct checkHit users do not learn defensive AC information.
confidence: high

### L5_monsters-013  Monster timed upkeep omits notification messages
sev: P2
concession: n
ref: reference/src/mon-move.c:1812
port: packages/core/src/game/monster-turn.ts:1656
expected: Timed upkeep decrements use mon_dec_timed with MON_TMD_FLG_NOTIFY for stun, confusion, changed, and fear effects.
actual: The port directly decrements timers and only performs shape reversion for CHANGED.
why: Visible status expiry, fear reduction, and shape-change notifications are missing from normal monster turns.
confidence: high

### L5_monsters-014  Seasonal monsters are disabled in live allocation
sev: P2
concession: n
ref: reference/src/mon-make.c:251
port: packages/core/src/mon/make.ts:182; packages/core/src/session/boot.ts:198
expected: RF_SEASONAL races are eligible during December 24 through December 26.
actual: The allocation table defaults seasonalAllowed to false, and live constructors omit the option.
why: Seasonal monsters never spawn in live games, including the Christmas date window.
confidence: high

### L5_monsters-015  Monster message batching and pluralization are missing
sev: P2
concession: n
ref: reference/src/mon-msg.c:252
port: packages/core/src/game/mon-message.ts:102; packages/core/src/game/mon-death.ts:392
expected: add_monster_message queues, stacks, de-duplicates, pluralizes, and displays monster messages with counts and average damage.
actual: The port formats and emits one visible monster at a time with no queue, stacking, de-duplication, or plural count.
why: Multi-monster projections produce different visible text and damage summaries.
confidence: high

### L5_monsters-016  Unique kill sound refinement is missing
sev: P2
concession: n
ref: reference/src/mon-msg.c:450
port: packages/core/src/game/mon-message.ts:152
expected: A MSG_KILL for a unique becomes MSG_KILL_UNIQUE, or MSG_KILL_KING for Morgoth.
actual: monMessageSoundType returns the repository message type without inspecting the monster race, and no live caller supplies the refinement.
why: Unique and Morgoth deaths use the generic kill sound or no typed kill sound.
confidence: high

### L5_monsters-017  Taunted monsters ignore the close-in override
sev: P1
concession: n
ref: reference/src/mon-move.c:232
port: packages/core/src/game/monster-turn.ts:437
expected: When TMD_TAUNT is active, get_move_find_range returns after setting min_range to 1.
actual: getMoveFindRange continues flee, power, and preferred-range calculations.
why: Taunted monsters choose different movement ranges and attack positioning.
confidence: high

### L5_monsters-018  Shapechanged uniques can be trampled
sev: P1
concession: n
ref: reference/src/mon-move.c:154
port: packages/core/src/game/monster-turn.ts:339
expected: monster_can_kill rejects a unique based on monster_is_unique, including its original race.
actual: monsterCanKill checks UNIQUE only on the current race.
why: A unique shapechanged into a non-unique form can be trampled.
confidence: high

### L5_monsters-019  Trampling bypasses monster deletion cleanup
sev: P1
concession: n
ref: reference/src/mon-move.c:1360
port: packages/core/src/game/monster-turn.ts:1238
expected: Trampling calls delete_monster before swapping, removing group, racial-count, target, command, held-object, and mimic state.
actual: The port directly nulls the victim slot and square without deletion bookkeeping.
why: Trampled monsters leave stale groups, counters, targets, commands, or inventory state.
confidence: high

### L5_monsters-020  Fear conversion bypasses HOLD rules
sev: P1
concession: n
ref: reference/src/mon-move.c:1672
port: packages/core/src/game/monster-turn.ts:1588
expected: Fear is cleared, then HOLD is increased through mon_inc_timed, applying resistance, minimum duration, MAX stacking, the timer cap, and notification.
actual: The port directly clears FEAR and adds to HOLD without resistance, minimum duration, cap, or notification.
why: Fear-paralyzed monsters can receive different hold durations and ignore RF_NO_HOLD.
confidence: high

### L5_monsters-021  Monster swaps omit camouflage and visibility updates
sev: P1
concession: n
ref: reference/src/mon-util.c:566
port: packages/core/src/game/context.ts:889
expected: monster_swap updates camouflage awareness, moves mimicked objects, refreshes monster visibility, light, distance, and redraw state.
actual: monsterSwap only exchanges square occupants and monster grid coordinates.
why: Moving or pushing monsters can retain stale mimic, awareness, visibility, and distance state.
confidence: high

### L5_monsters-022  Pain messages omit optional damage amounts
sev: P2
concession: n
ref: reference/src/mon-msg.c:132
port: packages/core/src/game/mon-message.ts:142
expected: message_pain_show_damage appends the damage amount, or an average for stacked messages.
actual: formatPainMessage returns only the graded pain text and the live message hook never appends damage.
why: Paths configured to show monster damage lose the numerical damage suffix.
confidence: high

### L5_monsters-023  Pushing does not teach body movement flags
sev: P3
concession: n
ref: reference/src/mon-move.c:1345
port: packages/core/src/game/monster-turn.ts:1229
expected: A visible push or trample records RF_KILL_BODY and RF_MOVE_BODY in monster lore.
actual: The port emits the push message but does not update either lore flag.
why: Visible pushing behavior is not learned by the player.
confidence: high

### L5_monsters-024  Erratic movement does not teach RAND flags
sev: P3
concession: n
ref: reference/src/mon-move.c:1087
port: packages/core/src/game/monster-turn.ts:991
expected: Visible RAND_25 and RAND_50 monsters record the corresponding lore flags while the cumulative chance is calculated.
actual: The port applies the chances without updating lore.
why: Erratic movement behavior remains undiscovered in monster knowledge.
confidence: high

### L5_monsters-025  NEVER_MOVE lore is not recorded after failed movement
sev: P3
concession: n
ref: reference/src/mon-move.c:1661
port: packages/core/src/game/monster-turn.ts:1575
expected: When a visible monster acts despite having no movement option, RF_NEVER_MOVE is learned.
actual: The port handles the later disturbance gate but does not set RF_NEVER_MOVE.
why: The player does not learn the monster's immobility behavior.
confidence: high

## MAP L5_monsters

reference/src/list-mon-message.h -> packages/core/src/generated/mon-message.ts
reference/src/list-mon-race-flags.h -> packages/core/src/generated/mon-race-flags.ts
reference/src/list-mon-spells.h -> packages/core/src/generated/mon-spells.ts
reference/src/list-mon-temp-flags.h -> packages/core/src/generated/mon-temp-flags.ts
reference/src/list-mon-timed.h -> packages/core/src/generated/mon-timed.ts
reference/src/mon-attack.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-side.ts
reference/src/mon-attack.h -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-blows.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-side.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-blows.h -> packages/core/src/mon/types.ts; packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-desc.c -> packages/core/src/mon/desc.ts; packages/core/src/game/mon-message.ts
reference/src/mon-desc.h -> packages/core/src/mon/desc.ts
reference/src/mon-group.c -> packages/core/src/game/mon-group.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-place.ts
reference/src/mon-group.h -> packages/core/src/game/mon-group.ts; packages/core/src/mon/types.ts
reference/src/mon-init.c -> packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/src/mon-init.h -> packages/content/src/specs/mon-init.ts
reference/src/mon-list.c -> packages/core/src/game/mon-list.ts
reference/src/mon-list.h -> packages/core/src/game/mon-list.ts; packages/core/src/mon/types.ts
reference/src/mon-lore.c -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts; packages/core/src/game/known.ts; packages/core/src/game/monster-turn.ts
reference/src/mon-lore.h -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts
reference/src/mon-make.c -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/mon-death.ts; packages/core/src/gen/gen-monster.ts; packages/core/src/session/boot.ts; packages/core/src/session/game.ts
reference/src/mon-make.h -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts
reference/src/mon-move.c -> packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-group.ts; packages/core/src/game/scheduler.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/context.ts
reference/src/mon-move.h -> packages/core/src/game/monster-turn.ts; packages/core/src/game/scheduler.ts
reference/src/mon-msg.c -> packages/core/src/game/mon-message.ts; packages/core/src/game/mon-death.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/monster-turn.ts; packages/core/src/session/game.ts; packages/core/src/mon/timed.ts
reference/src/mon-msg.h -> packages/core/src/generated/mon-message.ts; packages/core/src/game/mon-message.ts
reference/src/mon-predicate.c -> packages/core/src/mon/predicate.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/effect-mon-origin.ts
reference/src/mon-predicate.h -> packages/core/src/mon/predicate.ts
reference/src/mon-spell.c -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cast.ts; packages/core/src/mon/lore-describe.ts; packages/core/src/game/project-cast.ts
reference/src/mon-spell.h -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cast.ts
reference/src/monster.h -> packages/core/src/mon/monster.ts; packages/core/src/mon/types.ts; packages/core/src/game/context.ts; packages/core/src/generated/mon-race-flags.ts; packages/core/src/generated/mon-spells.ts; packages/core/src/generated/mon-timed.ts
reference/src/mon-summon.c -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/effect-summon.ts
reference/src/mon-summon.h -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts
reference/src/mon-timed.c -> packages/core/src/mon/timed.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/project-monster.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/mon-shape.ts
reference/src/mon-timed.h -> packages/core/src/generated/mon-timed.ts; packages/core/src/mon/timed.ts
reference/src/mon-util.c -> packages/core/src/mon/predicate.ts; packages/core/src/mon/lore.ts; packages/core/src/mon/make.ts; packages/core/src/mon/take-hit.ts; packages/core/src/mon/spell.ts; packages/core/src/mon/steal.ts; packages/core/src/game/known.ts; packages/core/src/game/mon-death.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/mon-side.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/scheduler.ts
reference/src/mon-util.h -> packages/core/src/mon/predicate.ts; packages/core/src/mon/lore.ts; packages/core/src/mon/make.ts; packages/core/src/mon/take-hit.ts; packages/core/src/mon/spell.ts; packages/core/src/mon/steal.ts; packages/core/src/game/known.ts; packages/core/src/game/mon-death.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/mon-side.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/scheduler.ts
