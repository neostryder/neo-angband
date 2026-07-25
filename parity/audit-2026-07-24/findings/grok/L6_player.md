# L6_player audit (player / player-*)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: list-equip/player-flags/timed/stats + player*.c/h. Searched packages/ (excl. node_modules, dist, borg).

### L6_player-001  player_is_trapsafe ignores OF_TRAP_IMMUNE equipment
sev: P1
concession: n
ref: reference/src/player-util.c:1073-1078 (player_is_trapsafe: TMD_TRAPSAFE OR player_of_has OF_TRAP_IMMUNE)
port: packages/core/src/game/player-path.ts:58-61 (playerIsTrapsafe); also packages/core/src/game/chest.ts:84 (local twin)
expected: Wearing OF_TRAP_IMMUNE (or any source that sets player_state.flags OF_TRAP_IMMUNE) makes the player trapsafe for run_test, find_path forbid_traps, and related path/run decisions.
actual: Local playerIsTrapsafe only tests timed[TMD.TRAPSAFE] > 0. OF_TRAP_IMMUNE from gear is ignored for running/pathfinding (trap activation in trap.ts can still honor OF via env.playerHasFlag when wired).
why: Trap-immunity items do not stop run/pathfind from treating visible traps as hazards or changing forbid_traps path selection.
confidence: high

### L6_player-002  player_can_cast omits no_light
sev: P1
concession: n
ref: reference/src/player-util.c:1096-1100 (player_can_cast: TMD_BLIND || no_light(p) blocks with "You cannot see!")
port: packages/core/src/game/spell-cmd.ts:100-116 (playerCanCast)
expected: Casting (and study, which calls player_can_cast first) fails when the player's own grid is unseen (no light), same message as blindness.
actual: playerCanCast checks total_spells, TMD_BLIND, and TMD_CONFUSED only. no_light is never evaluated (noLight exists in cave-cmd.ts/chest.ts but is not used here). Web canCast menu only gates on totalSpells > 0.
why: Casters can cast and study in complete darkness; fail rates and dungeon play diverge from upstream.
confidence: high

### L6_player-003  Scroll read never enforces player_can_read
sev: P1
concession: n
ref: reference/src/player-util.c:1166-1196 (player_can_read: blind / no_light / confused / amnesia); player_can_read_prereq used before 'r'
port: packages/core/src/game/obj-cmd.ts:1132-1135 ("read" only gated by shape + tvalIsScroll)
expected: Reading a scroll fails with "You can't see anything." / "You have no light to read by." / "You are too confused to read!" / "You can't remember how to read!" under those conditions.
actual: installObjCommands registers "read" with only playerGetResumeNormalShape + tval filter. No blind, no_light, confused, or amnesia check on the live path.
why: Scrolls work while blind, in the dark, confused, or amnesiac.
confidence: high

### L6_player-004  TMD_FASTCAST cast costs a full turn, not 3/4 energy
sev: P1
concession: n
ref: reference/src/cmd-obj.c:1163-1168 (after spell_cast success: if TMD_FASTCAST then energy_use = move_energy * 3 / 4 else move_energy)
port: packages/core/src/game/spell-cmd.ts:287-288 (always return state.z.moveEnergy; comment admits FASTCAST deferred)
expected: While FASTCAST is active, a successful cast spends (move_energy * 3) / 4.
actual: Cast always spends full move_energy regardless of timed[TMD.FASTCAST].
why: Fastcasting spells (class power / effects that set FASTCAST) grant no speed advantage.
confidence: high

### L6_player-005  do_cmd_run does not refuse when confused
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1380-1381 (do_cmd_run: player_confuse_dir(player, &dir, true) returns without starting run; "You are too confused.")
port: packages/core/src/game/player-path.ts:877-879 (runAction -> runStep with no confusion gate); packages/core/src/game/obj-cmd.ts:610-626 (playerConfuseDir has no `too` parameter)
expected: Starting a run while confused always fails with "You are too confused." and spends no energy / does not enter run state.
actual: Run starts and continues; each step goes through walkAction, which may randomize direction via playerConfuseDir(false semantics) instead of blocking the run.
why: Confused players can run (and pathfind steps via walk), scrambling movement vs upstream's hard block.
confidence: high

### L6_player-006  Pathfinder door penalties skip dark-skill and convert_turn_penalty
sev: P2
concession: n
ref: reference/src/player-path.c:126-155 (convert_turn_penalty via energy_per_move); L161-210 (unlocked PF_SCL then convert; locked uses calc_unlocking_chance(p, 7, cur_light < 1 && !PF_UNLIGHT) then convert)
port: packages/core/src/game/player-path.ts:370-377 (lockedPenalty: calcUnlockingChance(state, 7) only); L431 (unlocked = PF_SCL raw); packages/core/src/game/trap.ts:596-609 (calcUnlockingChance has no lock_unseen arg)
expected: In darkness (cur_light < 1 and not PF_UNLIGHT), lock skill is /10 for the path cost; all door/rubble penalties scale when energy_per_move != move_energy (extra moves).
actual: lockedPenalty never applies the lock_unseen /10; neither unlocked nor locked nor rubble penalties call convert_turn_penalty. Extra-move characters get wrong path costs through doors/rubble.
why: Pathfind/explore route choice and expected costs diverge for dark grids and MOVES gear.
confidence: high

### L6_player-007  weight_remaining never computed for character sheet
sev: P2
concession: n
ref: reference/src/player-calcs.c:1756-1765 (weight_remaining = 60 * adj_str_wgt[stat_ind STR] - total_weight - 1)
port: packages/core/src/game/char-sheet.ts:107,189,400 (weightRemaining optional, defaults 0); packages/web/src/screens.ts:417-439 (charSheetDeps does not supply weightRemaining); packages/core/src/player/calcs.ts has weightLimit only
expected: Char sheet Burden/Overweight columns use live weight_remaining (red when negative).
actual: No port of weight_remaining; web deps omit it so the sheet always uses 0 (Overweight "0.0 lb", burden color never overweight-red from this field).
why: Visible character-sheet burden/overweight is wrong in normal play.
confidence: high

### L6_player-008  player_set_timed notify suppression for known temp resists/flags often inert
sev: P3
concession: n
ref: reference/src/player-timed.c:828-839 (suppress notify when temp_resist already known-immune or oflag_syn already known from non-timed gear)
port: packages/core/src/player/timed.ts:309-333 (notifyQueries optional; absent => no suppression)
expected: Gaining a temporary resist the player already knows as immunity (or a timed flag synonym already known from gear) is silent.
actual: When callers omit hooks.notifyQueries (common; comment cites gap 4.8), messages always fire even when C would silence them.
why: Extra status spam / disturbance messaging vs upstream; durations still correct.
confidence: med

## MAP L6_player
reference/src/list-equip-slots.h -> packages/core/src/generated/equip-slots.ts
reference/src/list-player-flags.h -> packages/core/src/generated/player-flags.ts
reference/src/list-player-timed.h -> packages/core/src/generated/player-timed.ts
reference/src/list-stats.h -> packages/core/src/generated/stats.ts
reference/src/player.c -> packages/core/src/player/player.ts; packages/core/src/player/exp.ts; packages/core/src/player/calcs.ts (playerFlags, player_exp tables, playerHpAttr/playerSpAttr)
reference/src/player.h -> packages/core/src/player/types.ts; packages/core/src/player/player.ts; packages/core/src/generated/{stats,player-flags,player-timed}.ts
reference/src/player-birth.c -> packages/core/src/player/birth.ts; packages/core/src/player/exp.ts (rollHp); packages/core/src/session/game.ts (player_outfit / wield_all / accept flow)
reference/src/player-birth.h -> packages/core/src/player/birth.ts
reference/src/player-calcs.c -> packages/core/src/player/calcs.ts; packages/core/src/player/spell.ts (calcSpells, calcMana); packages/core/src/game/gear.ts (calcInventory)
reference/src/player-calcs.h -> packages/core/src/player/calcs.ts; packages/core/src/game/gear.ts
reference/src/player-class.c -> packages/core/src/player/bind.ts (PlayerRegistry classes / classByName)
reference/src/player-history.c -> packages/core/src/player/history.ts; packages/core/src/game/history.ts
reference/src/player-history.h -> packages/core/src/player/history.ts; packages/core/src/generated/history-types.ts
reference/src/player-path.c -> packages/core/src/game/player-path.ts
reference/src/player-path.h -> packages/core/src/game/player-path.ts
reference/src/player-properties.c -> packages/core/src/player/abilities.ts
reference/src/player-properties.h -> packages/core/src/player/abilities.ts
reference/src/player-quest.c -> packages/core/src/game/quest.ts
reference/src/player-quest.h -> packages/core/src/game/quest.ts
reference/src/player-race.c -> packages/core/src/player/bind.ts (PlayerRegistry races / raceByName)
reference/src/player-spell.c -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/player-spell.h -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/player-timed.c -> packages/core/src/player/timed.ts; packages/core/src/player/bind.ts (bindTimed)
reference/src/player-timed.h -> packages/core/src/player/timed.ts; packages/core/src/generated/player-timed.ts; packages/core/src/player/types.ts
reference/src/player-util.c -> packages/core/src/player/take-hit.ts; packages/core/src/player/best-digger.ts; packages/core/src/player/combat-regen.ts; packages/core/src/player/exp.ts (scramble); packages/core/src/game/loop.ts (regen); packages/core/src/game/world.ts (over_exert, update_light, digest, faint/starve); packages/core/src/game/player-turn.ts (energy_per_move, walk/rest); packages/core/src/game/obj-cmd.ts (player_confuse_dir); packages/core/src/game/player-path.ts (player_is_trapsafe, disturb)
reference/src/player-util.h -> same spread as player-util.c
