# L5_monsters audit (monsters / mon-*)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: list-mon-* headers + mon-*.c/h + monster.h. Searched packages/ (excl. node_modules, dist, borg).

### L5_monsters-001  Melee timed statuses ignore Free Action / Prot Blind/Conf/Fear / poison resist
sev: P0
concession: n
ref: reference/src/mon-blows.c:502-556 (melee_effect_timed calls player_inc_timed with check=true); reference/src/mon-blows.c:674-689 (POISON then player_inc_timed TMD_POISONED); reference/src/mon-blows.c:990-1025 (BLIND/CONFUSE/TERRIFY/PARALYZE); reference/src/player-timed.c:923-956 (player_inc_check fail table: OF_FREE_ACT / OF_PROT_BLIND / OF_PROT_CONF / OF_PROT_FEAR / ELEM_POIS)
port: packages/core/src/game/mon-side.ts:204-210 (incTimed); packages/core/src/player/timed.ts:379-402 (playerIncTimed: when check true and hooks.incCheck absent, always allows)
expected: Monster melee status application runs player_inc_timed(..., check=true) so Free Action blocks paralysis, Prot Blind/Conf/Fear block those, poison resist / OPP_POIS block poison, with equip_learn / update_smart_learn side effects from player_inc_check.
actual: makeMonBlowEnv.incTimed calls playerIncTimed with check=true but never supplies hooks.incCheck (or equip_learn / smart-learn hooks). playerIncTimed then treats missing incCheck as always-true. Free Action, Prot Blind/Conf/Fear, and poison resist never stop melee statuses. Hallucination chaos resist likewise skipped for HALLU.
why: Core defensive flags are useless against monster melee; Free Action no longer prevents melee paralysis (game-breaking).
confidence: high

### L5_monsters-002  Melee never calls update_smart_learn (player rune learn + birth_ai_learn)
sev: P1
concession: n
ref: reference/src/mon-blows.c:486 (elemental pure update_smart_learn type); L554 (timed of_flag); L605 (OF_HOLD_LIFE); L689 (ELEM_POIS); L705 (ELEM_DISEN); L1167 (ELEM_CHAOS); reference/src/mon-util.c:788- (update_smart_learn always equip_learn_flag/element then optional mon known_pstate)
port: packages/core/src/combat/mon-melee.ts:678-928 (resolveBlowEffectLive); packages/core/src/game/mon-side.ts:140-442 (no updateSmartLearn)
expected: After elemental / timed / exp-drain / disenchant / hallu blows, update_smart_learn teaches the player the corresponding rune and (under birth_ai_learn) updates mon->known_pstate.
actual: Live melee path never calls updateSmartLearn. Elemental melee does not equip_learn_element; OF_PROT_* / HOLD_LIFE / etc. are not learned from those blows via this path; birth_ai_learn monsters never learn from melee.
why: Identification and smart-monster AI diverge from upstream after ordinary melee.
confidence: high

### L5_monsters-003  monster_attack_monster skips blow effects and armor
sev: P1
concession: n
ref: reference/src/mon-attack.c:765-901 (monster_attack_monster: full melee_handler_for_blow_effect, test_hit vs t_mon->race->ac, stun critical)
port: packages/core/src/game/mon-cmd.ts:71-171
expected: Commanded (or mon-vs-mon) blows run the same RBE handlers as player melee (HURT armor reduce, elemental mon damage, timed mon effects, EAT_ITEM steal from mon, etc.) against target race AC.
actual: Port only rolls to-hit vs race AC, applies raw dice damage via monTakeHit, then optional mon stun. No adjust_dam_armor, no elemental/status/theft handlers, no lore blow counting, no hit-and-run blink.
why: Necromancer command combat and any mon-vs-mon use of this path deals wrong damage and wrong side effects.
confidence: high

### L5_monsters-004  make_ranged_attack omits lore_update after a cast
sev: P2
concession: n
ref: reference/src/mon-attack.c:468-484 (after cast: lore spell flags + cast counts, then lore_update)
port: packages/core/src/game/mon-ranged.ts:382-390
expected: lore_update re-derives innateFreqKnown / spellFreqKnown once castInnate/castSpell exceeds 50 (and other derived fields).
actual: lore.spellFlags and cast counters update, but loreUpdate is never called. Spell frequency never becomes "known" from observing casts until some other path calls loreUpdate.
why: Monster recall under-reports known spell frequency after many observed casts.
confidence: high

### L5_monsters-005  process_monster_timed silently decrements instead of mon_dec_timed
sev: P2
concession: n
ref: reference/src/mon-move.c:1800-1826 (mon_dec_timed for FAST/SLOW/HOLD/DISEN; STUN/CONF/CHANGED/FEAR with MON_TMD_FLG_NOTIFY); reference/src/mon-timed.c:161-216 (timer->0 emits message_end when NOTIFY)
port: packages/core/src/game/monster-turn.ts:1656-1676
expected: Expiry of stun/conf/fear/changed (and related) queues MON_MSG_NOT_DAZED / NOT_CONFUSED / NOT_AFRAID / etc. for obvious monsters; fear reduces by randint1(level/10+1) via mon_dec_timed.
actual: Timers are written as mTimed[idx] = v-1 (fear: manual subtract). No monDecTimed, no NOTIFY, no end messages ("is no longer stunned/confused/afraid", "speeds up", "can move again", etc.).
why: Visible status-expiry messaging and any mon_set_timed side cases are missing every monster turn.
confidence: high

### L5_monsters-006  Noise-based sleep reduction never messages wake-up
sev: P2
concession: n
ref: reference/src/mon-move.c:1768-1778 (mon_dec_timed SLEEP with NOTIFY; lore wake/ignore + lore_update)
port: packages/core/src/game/monster-turn.ts:1629-1638
expected: Reducing sleep to 0 via noise uses mon_dec_timed(..., NOTIFY) so obvious monsters print "wake[s] up." and lore_update runs.
actual: Raw mTimed[SLEEP] = next. No wake message on noise wake (aggravate path does msg separately). lore_update not called after wake/ignore counts.
why: Monsters wake silently from player noise; recall sleep knowledge may lag.
confidence: high

### L5_monsters-007  Melee death note uses bare race.name not MDESC_SHOW|MDESC_IND_VIS
sev: P2
concession: n
ref: reference/src/mon-attack.c:563-564,639 (ddesc = monster_desc MDESC_SHOW|MDESC_IND_VIS); mon-blows.c take_hit(..., context->ddesc)
port: packages/core/src/game/mon-side.ts:155 (takeHit(..., mon.race.name, ...))
expected: died_from / death note is "a kobold" / "an orc" / unique full name (forced visible indefinite).
actual: Bare race.name ("kobold", "Farmer Maggot") without article/grammar from monster_desc.
why: Tombstone, score, and death history strings diverge from upstream.
confidence: high

### L5_monsters-008  Protection from evil repel message uses race.name not MDESC_STANDARD
sev: P2
concession: n
ref: reference/src/mon-attack.c:561,605 (msg("%s is repelled.", m_name) with MDESC_STANDARD)
port: packages/core/src/combat/mon-melee.ts:1014 (env?.msg(`${mon.race.name} is repelled.`))
expected: "The kobold is repelled." (capitalized standard name).
actual: "kobold is repelled." (or uncapitalized unique name as stored).
why: Visible combat message drift on a common defensive buff path.
confidence: high

### L5_monsters-009  mon-msg stack/batch/history not ported; multi-mon messages never pluralize
sev: P2
concession: n
ref: reference/src/mon-msg.c:195-246 (stack_message), 248+ (add_monster_message), 318+ (get_subject count/invisible/offscreen), flush at end of projection
port: packages/core/src/game/mon-message.ts:8-13,102-109 (formats one visible count==1 line only; documents batching as deferred)
expected: Same race + same msg_code batches into "3 kobolds die." / shared pain lines; redundant mon+code suppressed via mon_message_hist; death delay ordering.
actual: Each mon message is formatted singly as it happens. Multi-monster balls/breaths produce N separate singular lines; no hist de-dupe.
why: Projection feedback is noisier and differently worded than upstream for multi-hit events.
confidence: high

### L5_monsters-010  Decoy-target cast witness path omitted in monster_can_cast
sev: P2
concession: n
ref: reference/src/mon-attack.c:123-145 (if target != player, require square_isview on mon, target, or a PROJECT_SHORT path grid)
port: packages/core/src/game/mon-ranged.ts:269-301 (monsterCanCast ends after projectable; comment admits witness deferred)
expected: When aiming a decoy out of player view with no visible path grid, the cast is aborted.
actual: Any projectable path to the decoy allows the cast regardless of player view.
why: Decoyed monsters can cast "in the dark" where C would refuse, changing AI and feedback.
confidence: high

## MAP L5_monsters
reference/src/list-mon-message.h -> packages/core/src/generated/mon-message.ts
reference/src/list-mon-race-flags.h -> packages/core/src/generated/mon-race-flags.ts
reference/src/list-mon-spells.h -> packages/core/src/generated/mon-spells.ts
reference/src/list-mon-temp-flags.h -> packages/core/src/generated/mon-temp-flags.ts
reference/src/list-mon-timed.h -> packages/core/src/generated/mon-timed.ts
reference/src/mon-attack.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/mon-side.ts
reference/src/mon-attack.h -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-blows.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-side.ts
reference/src/mon-blows.h -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-side.ts
reference/src/mon-desc.c -> packages/core/src/mon/desc.ts
reference/src/mon-desc.h -> packages/core/src/mon/desc.ts
reference/src/mon-group.c -> packages/core/src/game/mon-group.ts
reference/src/mon-group.h -> packages/core/src/game/mon-group.ts; packages/core/src/mon/monster.ts (GROUP_TYPE); packages/core/src/mon/types.ts (MON_GROUP roles)
reference/src/mon-init.c -> packages/core/src/mon/bind.ts; packages/content/src/specs/mon-init.ts
reference/src/mon-init.h -> packages/core/src/mon/bind.ts; packages/content/src/specs/mon-init.ts
reference/src/mon-list.c -> packages/core/src/game/mon-list.ts
reference/src/mon-list.h -> packages/core/src/game/mon-list.ts
reference/src/mon-lore.c -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts; packages/core/src/game/lore-color.ts
reference/src/mon-lore.h -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts
reference/src/mon-make.c -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts; packages/core/src/gen/util.ts (gen-time place twin)
reference/src/mon-make.h -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts
reference/src/mon-move.c -> packages/core/src/game/monster-turn.ts; packages/core/src/game/scheduler.ts
reference/src/mon-move.h -> packages/core/src/game/monster-turn.ts
reference/src/mon-msg.c -> packages/core/src/game/mon-message.ts
reference/src/mon-msg.h -> packages/core/src/game/mon-message.ts; packages/core/src/generated/mon-message.ts
reference/src/mon-predicate.c -> packages/core/src/mon/predicate.ts; packages/core/src/game/monster-turn.ts (monsterIsDecoyed); packages/core/src/game/effect-mon-origin.ts (monsterIsDecoyed alternate)
reference/src/mon-predicate.h -> packages/core/src/mon/predicate.ts
reference/src/mon-spell.c -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-cast.ts; packages/core/src/game/mon-message.ts (spell_message)
reference/src/mon-spell.h -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-cast.ts
reference/src/monster.h -> packages/core/src/mon/monster.ts; packages/core/src/mon/types.ts
reference/src/mon-summon.c -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts (summon_specific placement)
reference/src/mon-summon.h -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts
reference/src/mon-timed.c -> packages/core/src/mon/timed.ts
reference/src/mon-timed.h -> packages/core/src/mon/timed.ts; packages/core/src/generated/mon-timed.ts
reference/src/mon-util.c -> packages/core/src/mon/take-hit.ts; packages/core/src/mon/steal.ts; packages/core/src/mon/make.ts (monster_carry); packages/core/src/game/known.ts (update_mon, become_aware); packages/core/src/game/mon-death.ts (monster_death, mon_take_nonplayer_hit, terrain damage); packages/core/src/game/mon-ranged.ts (injured kin helpers); packages/core/src/mon/spell.ts (update_smart_learn)
reference/src/mon-util.h -> packages/core/src/mon/take-hit.ts; packages/core/src/game/known.ts; packages/core/src/game/mon-death.ts
