### L6_player-001  player_is_trapsafe ignores OF_TRAP_IMMUNE equipment
sev: P1
concession: n
ref: reference/src/player-util.c:1073-1078
port: packages/core/src/game/player-path.ts:58-61; packages/core/src/game/chest.ts:84
expected: Wearing OF_TRAP_IMMUNE, or any source that sets player_state.flags OF_TRAP_IMMUNE, makes the player trapsafe for run_test, find_path forbid_traps, and related path and run decisions.
actual: playerIsTrapsafe only tests timed TMD.TRAPSAFE. OF_TRAP_IMMUNE from gear is ignored for running and pathfinding, although trap activation can honor the flag when its environment is wired.
why: Trap-immunity items do not stop run and pathfind from treating visible traps as hazards or changing forbid_traps path selection.
confidence: high

### L6_player-002  player_can_cast omits no_light
sev: P1
concession: n
ref: reference/src/player-util.c:1096-1100
port: packages/core/src/game/spell-cmd.ts:100-116
expected: Casting and studying fail with "You cannot see!" when the player is blind or has no light.
actual: playerCanCast checks total_spells, TMD.BLIND, and TMD.CONFUSED only. no_light is never evaluated.
why: Casters can cast and study in complete darkness, changing spell use and dungeon play.
confidence: high

### L6_player-003  scroll read never enforces player_can_read
sev: P1
concession: n
ref: reference/src/player-util.c:1166-1196
port: packages/core/src/game/obj-cmd.ts:1132-1135
expected: Reading a scroll fails under blindness, no light, confusion, or amnesia with the corresponding upstream message.
actual: The live read command is registered with only the normal-shape and scroll-type checks; it does not call player_can_read.
why: Scrolls work while blind, in darkness, confused, or amnesiac.
confidence: high

### L6_player-004  TMD_FASTCAST cast costs a full turn, not 3/4 energy
sev: P1
concession: n
ref: reference/src/cmd-obj.c:1163-1168
port: packages/core/src/game/spell-cmd.ts:287-288
expected: A successful cast while TMD_FASTCAST is active spends move_energy * 3 / 4.
actual: Successful casts always return and spend the full state.z.moveEnergy; the FASTCAST reduction is deferred.
why: Fastcasting effects grant no speed advantage when spells are cast.
confidence: high

### L6_player-005  do_cmd_run does not refuse when confused
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1380-1381
port: packages/core/src/game/player-path.ts:877-879; packages/core/src/game/obj-cmd.ts:610-626
expected: Starting a run while confused prints "You are too confused.", spends no energy, and does not enter run state.
actual: runAction starts or continues the run without a confusion gate; walkAction can then randomize directions through playerConfuseDir.
why: Confused players can run and pathfind instead of being blocked as in upstream.
confidence: high

### L6_player-006  pathfinder penalties skip dark-skill and move-energy scaling
sev: P2
concession: n
ref: reference/src/player-path.c:125-155,161-210
port: packages/core/src/game/player-path.ts:370-391,431-433; packages/core/src/game/trap.ts:596-609
expected: Unlocked-door and rubble penalties pass through convert_turn_penalty; locked doors call calc_unlocking_chance with lock_unseen when cur_light < 1 and PF_UNLIGHT is absent, then also scale the result.
actual: lockedPenalty has no lock_unseen argument, and unlocked, locked, and rubble penalties are used without convert_turn_penalty.
why: Pathfinding route choices and expected costs diverge in darkness and for characters whose movement energy differs from a normal turn.
confidence: high

### L6_player-007  weight_remaining is never computed for the character sheet
sev: P2
concession: n
ref: reference/src/player-calcs.c:1756-1765
port: packages/core/src/game/char-sheet.ts:103-107,184-190,400; packages/web/src/screens.ts:417-439
expected: Character-sheet burden uses weight_remaining = 60 * adj_str_wgt[stat_ind STR] - total_weight - 1 and shows the overweight state when it is negative.
actual: weightRemaining is optional and defaults to 0; the web character-sheet dependencies do not supply it, so the sheet always displays zero and never gets this overweight-red state.
why: The visible character-sheet burden and overweight display is wrong in normal play.
confidence: high

### L6_player-008  known temporary resist and flag notifications are not suppressed by default
sev: P3
concession: n
ref: reference/src/player-timed.c:828-839
port: packages/core/src/player/timed.ts:309-333
expected: Gaining a temporary resistance already known as an immunity, or a timed flag synonym already known from non-timed gear, is silent.
actual: Notification suppression only runs when callers provide hooks.notifyQueries; common callers omit the hook, so the messages always fire even when the C code would suppress them.
why: Temporary-effect status spam and disturbance messaging differ from upstream even though durations remain correct.
confidence: med

### L6_player-009  random birth choices leave the character name at a fixed default
sev: P2
concession: n
ref: reference/src/player.c:375-381
port: packages/web/src/birth.ts:1350-1355,1651-1653
expected: The random birth-choice flow can call player_random_name, producing a 4-to-8 character capitalized Tolkien-style name before confirmation.
actual: finishRandom explicitly leaves name blank, and confirmation substitutes the fixed name "Adventurer" instead of drawing and capitalizing a random name.
why: The random-character flow and resulting player name visibly diverge from upstream.
confidence: high

## MAP L6_player
reference/src/list-equip-slots.h -> packages/core/src/generated/equip-slots.ts
reference/src/list-player-flags.h -> packages/core/src/generated/player-flags.ts
reference/src/list-player-timed.h -> packages/core/src/generated/player-timed.ts
reference/src/list-stats.h -> packages/core/src/generated/stats.ts
reference/src/player.c -> packages/core/src/player/player.ts; packages/core/src/player/exp.ts; packages/core/src/player/calcs.ts; packages/core/src/player/timed.ts; packages/web/src/birth.ts
reference/src/player.h -> packages/core/src/player/types.ts; packages/core/src/player/player.ts; packages/core/src/generated/stats.ts; packages/core/src/generated/player-flags.ts; packages/core/src/generated/player-timed.ts
reference/src/player-birth.c -> packages/core/src/player/birth.ts; packages/core/src/player/exp.ts; packages/core/src/session/game.ts
reference/src/player-birth.h -> packages/core/src/player/birth.ts
reference/src/player-calcs.c -> packages/core/src/player/calcs.ts; packages/core/src/player/spell.ts; packages/core/src/game/gear.ts; packages/core/src/game/char-sheet.ts
reference/src/player-calcs.h -> packages/core/src/player/calcs.ts; packages/core/src/game/gear.ts
reference/src/player-class.c -> packages/core/src/player/bind.ts
reference/src/player-history.c -> packages/core/src/player/history.ts; packages/core/src/game/history.ts
reference/src/player-history.h -> packages/core/src/player/history.ts; packages/core/src/generated/history-types.ts
reference/src/player-path.c -> packages/core/src/game/player-path.ts
reference/src/player-path.h -> packages/core/src/game/player-path.ts
reference/src/player-properties.c -> packages/core/src/player/abilities.ts
reference/src/player-properties.h -> packages/core/src/player/abilities.ts
reference/src/player-quest.c -> packages/core/src/game/quest.ts
reference/src/player-quest.h -> packages/core/src/game/quest.ts
reference/src/player-race.c -> packages/core/src/player/bind.ts
reference/src/player-spell.c -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts; packages/core/src/game/obj-cmd.ts
reference/src/player-spell.h -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/player-timed.c -> packages/core/src/player/timed.ts; packages/core/src/player/bind.ts
reference/src/player-timed.h -> packages/core/src/player/timed.ts; packages/core/src/generated/player-timed.ts; packages/core/src/player/types.ts
reference/src/player-util.c -> packages/core/src/player/take-hit.ts; packages/core/src/player/best-digger.ts; packages/core/src/player/combat-regen.ts; packages/core/src/player/exp.ts; packages/core/src/game/loop.ts; packages/core/src/game/world.ts; packages/core/src/game/player-turn.ts; packages/core/src/game/obj-cmd.ts; packages/core/src/game/player-path.ts
reference/src/player-util.h -> packages/core/src/player/take-hit.ts; packages/core/src/player/best-digger.ts; packages/core/src/player/combat-regen.ts; packages/core/src/player/exp.ts; packages/core/src/game/loop.ts; packages/core/src/game/world.ts; packages/core/src/game/player-turn.ts; packages/core/src/game/obj-cmd.ts; packages/core/src/game/player-path.ts
