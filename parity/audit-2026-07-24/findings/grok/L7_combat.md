# L7_combat audit (combat / player-attack)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: player-attack.c / player-attack.h. Searched packages/ (excl. node_modules, dist, borg).

### L7_combat-001  Off-weapon brands/slays never applied in live melee
sev: P1
concession: n
ref: reference/src/player-attack.c:786-794 (for j = 2; j < body.count; improve_attack_modifier on slot_object)
port: packages/core/src/combat/melee.ts:407-409 (opts.offhand ?? []); packages/core/src/game/player-turn.ts:251-273 (attackMonster never passes offhand); packages/core/src/game/effect-melee.ts:91-103 (playerBlow same)
expected: Brands/slays on equipment slots after weapon and bow (rings, gloves, armor, etc.) compete via improve_attack_modifier and can set the blow brand/slay/verb and damage mult.
actual: MeleeOptions.offhand is only consumed inside pyAttackReal; no live caller ever supplies it (grep: only defined/used in melee.ts). Only the weapon and temporary brands/slays are considered.
why: Rings/gloves/other gear with brands or slays grant no melee damage or hit-verb change on the default attack path.
confidence: high

### L7_combat-002  Invisible melee targets never get the 50% to-hit penalty
sev: P1
concession: n
ref: reference/src/player-attack.c:104-109 (chance_of_melee_hit halves when !monster_is_visible); L763 test_hit(chance_of_melee_hit(...))
port: packages/core/src/game/player-turn.ts:260 (monVisible: true hardcoded in attackMonster); packages/core/src/game/effect-melee.ts:100 (same); packages/core/src/combat/melee.ts:243-249 (chanceOfMeleeHit implements the half correctly when monVisible is false)
expected: Melee against a non-visible monster uses chance/2 for test_hit (and monsterFled uses visibility).
actual: Live melee always passes monVisible: true, so invisible monsters are hit at full accuracy. Comment admits "treated as visible".
why: Walking into or otherwise meleeing an invisible foe is much easier than upstream; to-hit and RNG outcomes diverge.
confidence: high

### L7_combat-003  do_cmd_fire / do_cmd_throw never run player_confuse_dir
sev: P1
concession: n
ref: reference/src/player-attack.c:1349-1352 (do_cmd_fire: after cmd_get_target, player_confuse_dir(..., false)); L1392-1395 (do_cmd_throw same)
port: packages/core/src/game/ranged-cmd.ts:191-234 (fire), 279-325 (throw) use args.dir as-is; packages/web/src/main.ts:3065-3087 (aimDir) never confuses
expected: While confused, fire/throw randomize direction 75% of the time (always if dir was 5/"no direction" semantics per player_confuse_dir), emit "You are confused." when the dir changes, and draw the confuse RNG.
actual: Chosen aim direction is used verbatim; confused players fire and throw accurately with no confuse RNG draw on this path.
why: Confusion does not scramble missile aim; combat RNG stream and outcomes diverge in normal confused play.
confidence: high

### L7_combat-004  do_cmd_fire / do_cmd_throw skip player_get_resume_normal_shape
sev: P1
concession: n
ref: reference/src/player-attack.c:1318-1320 (do_cmd_fire), L1373-1375 (do_cmd_throw): require player_get_resume_normal_shape or abort
port: packages/core/src/game/ranged-cmd.ts:191-325 (no playerGetResumeNormalShape); packages/core/src/game/obj-cmd.ts:591-604 (helper exists for other cmds)
expected: A shapechanged player must confirm resume to normal form before firing or throwing; refuse cancels with no energy.
actual: Fire and throw proceed in any shape with no prompt and no forced resume.
why: Shapechange races/forms can shoot and throw while transformed; upstream forces normal form first.
confidence: high

### L7_combat-005  Ranged hit never teaches missile/equip/brand-slay knowledge
sev: P2
concession: n
ref: reference/src/player-attack.c:1137-1140 (missile_learn_on_ranged_attack + equip_learn_on_ranged_attack on hit); L1258-1259 (learn_brand_slay_from_launch in make_ranged_shot); L1299 (learn_brand_slay_from_throw)
port: packages/core/src/game/ranged-cmd.ts:126-163 (hit path has mon_take_hit only); missileLearnOnRangedAttack / equipLearnOnRangedAttack / learnBrandSlayFromLaunch / learnBrandSlayFromThrow never called from game/ (only tests / obj knowledge module)
expected: A successful shot/throw learns combat runes on the missile (and equip for shots) and brand/slay runes from the objects involved.
actual: Ranged combat never invokes those learn helpers on the live path (ranged-cmd comment lists them as DEFERRED).
why: Firing and throwing do not identify to-hit/to-dam or brand/slay runes the way upstream does.
confidence: high

### L7_combat-006  Melee learn-on-attack runs on miss/afraid and ignores real visibility
sev: P2
concession: n
ref: reference/src/player-attack.c:822-823 (equip_learn_on_melee_attack + learn_brand_slay_from_melee only after a successful hit inside py_attack_real); learn_brand_slay_helper uses monster_is_visible for slays
port: packages/core/src/game/player-turn.ts:240-275 (learnBrandSlayFromMelee always before pyAttack with visible: true; equipLearnOnMeleeAttack always after, even if every blow missed or was refused by fear)
expected: Learning runs once per successful blow only; slay runes require a visible monster; afraid early-out does not learn combat runes from the blow path.
actual: One learn pass always runs per attackMonster (and effect playerBlow) regardless of hit/miss/afraid, and mon is forced visible for slay learning.
why: Players can learn weapon combat/brand-slay knowledge from pure misses and from invisible targets; multi-blow per-hit learn cadence also differs.
confidence: high

### L7_combat-007  show_damage never applied to player melee or ranged hit lines
sev: P2
concession: n
ref: reference/src/player-attack.c:853-860 (melee: dmg_text " (N)" when OPT show_damage); L1168-1179 (ranged same)
port: packages/web/src/main.ts:946-967 (onMelee: "You %s %s." with no damage suffix); packages/core/src/game/ranged-cmd.ts:131-133 (ranged hit line has no " (N)"); shield bash alone implements showDamage (melee.ts:615-618)
expected: With show_damage on, hit messages append " (damage)" before the period (and crit flavor on the same C message for melee).
actual: Player melee (except shield bash) and all ranged hits omit the damage suffix even when the option is set.
why: Visible combat feedback option does not work for the main player attack messages.
confidence: high

### L7_combat-008  Ranged hit on non-obvious monster never prints "finds a mark"
sev: P2
concession: n
ref: reference/src/player-attack.c:1156-1158 (if !visible: "The %s finds a mark.")
port: packages/core/src/game/ranged-cmd.ts:126-134 (always "Your %s %s %s." style; monObvious only affects to-hit math)
expected: Hitting a non-obvious monster prints the impersonal finds-a-mark line instead of the named hit verb line.
actual: Always names the monster and uses the hit verb; comment marks the branch DEFERRED.
why: Invisible/non-obvious ranged hits look and read wrong.
confidence: high

### L7_combat-009  Ranged crit flavor lines never printed
sev: P2
concession: n
ref: reference/src/player-attack.c:1033-1038 (ranged_hit_types texts for HIT_GOOD/GREAT/SUPERB); L1174-1176 append flavor on same message
port: packages/core/src/game/ranged-cmd.ts:133 (only verb line); no CRIT_FLAVOR for ranged
expected: Good/great/superb missile crits add "It was a good/great/superb hit!" to the hit message.
actual: makeRangedShot/Throw return the HitType but ranged-cmd never emits the flavor text.
why: Critical shots/throws lack the classic crit lines players see in C.
confidence: high

### L7_combat-010  Melee crit flavor is a second message, not one line with the hit
sev: P2
concession: n
ref: reference/src/player-attack.c:856-858 (single msgt: "You %s %s%s. %s" with flavor)
port: packages/web/src/main.ts:963-965 (say hit line, then separate say(flavor))
expected: One message: "You hit the kobold. It was a good hit!" (plus optional damage text).
actual: Two message-log entries: "You hit the kobold." then "It was a good hit!".
why: Message history and more-prompts differ from upstream for every melee crit.
confidence: high

### L7_combat-011  Target-out-of-range "Fire anyway?" not implemented
sev: P2
concession: n
ref: reference/src/player-attack.c:1070-1080 (DIR_TARGET + target_okay: if taim > range, get_check "Target out of range by N squares. Fire anyway?")
port: packages/core/src/game/ranged-cmd.ts:71-77,82 (uses target/path with no out-of-range confirm)
expected: Aimed fire/throw at a target beyond weapon range prompts; No aborts with no energy/missile consumption.
actual: Always projects up to range along the path; no prompt, no cancel path.
why: Players cannot refuse a long target shot; ammo/energy always commit.
confidence: high

### L7_combat-012  Afraid py_attack_real path does not equip_learn OF_AFRAID
sev: P2
concession: n
ref: reference/src/player-attack.c:752-755 (player_of_has OF_AFRAID: equip_learn_flag(OF_AFRAID) then refuse blow)
port: packages/core/src/combat/melee.ts:371-377 (afraid early return, no learn); packages/core/src/game/player-turn.ts:420-424 (walk obvious path does learn); invisible/tunnel-into-monster uses attackMonster afraid flag only
expected: Any py_attack_real refuse for fear also teaches the OF_AFRAID rune from equipment.
actual: Only the pre-attack obvious-monster walk gate learns OF_AFRAID; the invisible-monster / attackBlocker path prints fear via onMelee verb "afraid" without equipLearnFlag.
why: Fear from gear is not identified when the refuse happens inside py_attack_real.
confidence: high

### L7_combat-013  O-combat non-crit melee hit messages while C is silent
sev: P2
concession: n
ref: reference/src/player-attack.c:467-469 (o_critical_melee non-crit sets MSG_SHOOT_HIT); L704-711 melee_hit_types has no MSG_SHOOT_HIT so the message loop prints nothing
port: packages/core/src/combat/hit.ts:401 (oCriticalMelee non-crit msg "SHOOT_HIT"); packages/web/src/main.ts:963 (always "You %s %s." on hit)
expected: With birth_percent_damage, a non-critical melee hit leaves msg_type MSG_SHOOT_HIT and produces no "You hit..." line from melee_hit_types.
actual: Port still prints the normal hit line for every successful blow, including O non-crits.
why: O-combat birth option changes hit messaging vs upstream (extra lines / sounds).
confidence: med

## MAP L7_combat
reference/src/player-attack.c -> packages/core/src/combat/hit.ts (test_hit/hit_chance/crits/deadliness), packages/core/src/combat/melee.ts (melee hit/damage/py_attack*), packages/core/src/combat/ranged.ts (missile hit/damage/breakage/make_ranged_*), packages/core/src/combat/brand-slay.ts (improve_attack_modifier + object_to_hit/dam used by attack), packages/core/src/game/player-turn.ts (live py_attack wiring), packages/core/src/game/ranged-cmd.ts (ranged_helper/do_cmd_fire/throw/fire_at_nearest), packages/web/src/main.ts (melee hit message shell)
reference/src/player-attack.h -> same as player-attack.c (API surface: attack_result, hit_types, fire/throw/py_attack/test_hit/breakage/chance_*); no separate .h port file
