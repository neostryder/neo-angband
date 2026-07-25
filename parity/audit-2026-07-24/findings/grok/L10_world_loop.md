# L10_world_loop audit (world/loop/commands)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: cmd-*, game-event/input/world, debug/wizard/wiz-*, message/option/source/target, list-elements/message/options/parser-errors/randart-properties, hint.h.
Searched packages/ (excl. node_modules, dist, borg).

### L10_world_loop-001  Paralyzed / Knocked Out players can still take turns
sev: P0
concession: n
ref: reference/src/game-world.c:965-968 (process_player: TMD_PARALYZED or Stun "Knocked Out" pushes CMD_SLEEP so the turn is spent doing nothing)
port: packages/core/src/game/player-turn.ts:583-637 (processPlayer never injects sleep; waits on nextCommand); packages/core/src/game/player-turn.ts:538-548 (createDefaultRegistry never registers "sleep")
expected: While paralyzed or Knocked Out, process_player forces a full-energy sleep turn; the player cannot issue other commands until the status ends.
actual: The loop returns INPUT and the shell can push walk/cast/etc. while timed PARALYZED or Knocked Out is still >0. "sleep" is listed in COMMAND_INFO but has no action handler.
why: Paralysis and knockout fail to stop the player; free full turns while disabled is game-breaking.
confidence: high

### L10_world_loop-002  Detection MARK/SHOW fade runs every 10 game turns, not every player turn
sev: P1
concession: n
ref: reference/src/game-world.c:882-908 (process_player_cleanup after energy-using commands: clear MFLAG_NICE, drop MARK if !SHOW, always clear SHOW)
port: packages/core/src/game/loop.ts:357-358,582-583 (tickMonsterMarks only inside processWorld, gated by turn % 10); packages/core/src/game/player-turn.ts:583-637 (processPlayer never calls tickMonsterMarks); packages/core/src/game/known.ts:721-738
expected: Detection markers (MARK/SHOW) and NICE clear once per player energy turn after cleanup.
actual: Fade runs at most once every ten game turns with process_world, so monster detection from detect spells lasts much longer than upstream.
why: ESP/detect feedback and monster visibility after detection spells diverge from C; NICE handling is also delayed.
confidence: high

### L10_world_loop-003  Standing in a web does not clear the web on walk/run/jump
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1287-1297,1328-1336,1369-1377 (do_cmd_walk/jump/run: if square_iswebbed on player grid, msg "You clear the web.", remove web traps, spend move_energy, no move)
port: packages/core/src/game/player-turn.ts:382-469 (walkAction never checks web on current grid); packages/core/src/game/player-path.ts:831-855 (runStep goes straight to walkAction); packages/core/src/game/cave-cmd.ts:615-617 (documents web clear still on base action)
expected: Any walk/jump/run while standing on a web spends the turn clearing the web and does not move.
actual: Player can walk out of webs freely; web only matters if terrain/trap code elsewhere treats it as impassable (it is not).
why: Web traps (monster-spun) never pin the player; a normal dungeon hazard is inert.
confidence: high

### L10_world_loop-004  Walk onto known disarmable traps always triggers (no disarm-on-walk)
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1311-1312 (do_cmd_walk: move_player(dir, !(disarmable && trapsafe))); reference/src/cmd-cave.c:1079-1083 (move_player: known disarmable trap + disarm true -> do_cmd_alter_aux, not step)
port: packages/core/src/game/player-turn.ts:457-481 (walk/jump share body; documents disarm-on-walk deferred; onPlayerMoved -> hit_trap on any step); packages/core/src/game/cave-cmd.ts:615-618
expected: Default walk into a known, enabled player trap auto-disarms (alter) unless trapsafe/jump; jump deliberately steps on.
actual: Every walk onto a trap triggers it; jump is identical to walk.
why: Default walk into visible traps always sets them off instead of attempting disarm.
confidence: high

### L10_world_loop-005  Stair depth uses +/-1; ignores stair_skip and dungeon_get_next_level
sev: P1
concession: n
ref: reference/src/cmd-cave.c:76,103 (ascend_to/descend_to = dungeon_get_next_level(player, depth, +/-1)); reference/src/player-util.c:54-73 (target = dlev + added * stair_skip, quest intermediate check, clamp)
port: packages/core/src/game/cave-cmd.ts:817-849 (targetDepth = depth + 1 / depth - 1 only)
expected: One stair hop advances by z_info->stair_skip levels (default 1) and stops early on quest levels between.
actual: Always changes depth by exactly 1; no quest intermediate stop, no stair_skip scaling.
why: With non-default stair_skip or quests between depths, destination level and quest encounter order diverge from C. Default stair_skip=1 masks the hop size but still misses quest stops.
confidence: high

### L10_world_loop-006  Stair commands omit force_descend and max-depth guards
sev: P1
concession: n
ref: reference/src/cmd-cave.c:70-74 (birth_force_descend: "Nothing happens!" on go_up); reference/src/cmd-cave.c:115-128 (max_depth-1 refuse; force_descend recalculates descend_to from max_depth and quest confirm); reference/src/cmd-cave.c:78-80 (cannot ascend when next level == current)
port: packages/core/src/game/cave-cmd.ts:817-849 (only feature-underfoot and depth===0 up checks)
expected: Force-descend blocks up stairs; deepest level blocks down; force-descend from shallower than max uses max_depth path with quest warning.
actual: Up works from any non-zero depth with an up stair; down works at max_depth-1; force_descend birth option is ignored on stairs.
why: Birth option force descent and bottom-of-dungeon rules are dead on the live stair path.
confidence: high

### L10_world_loop-007  Deep Descent failure never runs EF_DESTRUCTION
sev: P1
concession: n
ref: reference/src/game-world.c:815-830 (deep_descent hits 0: if target not deeper, msg explosion then effect_simple(EF_DESTRUCTION, ... "0", radius 5))
port: packages/core/src/game/loop.ts:476-493 (else branch only state.msg "You are thrown back in an explosion!"; comment says destruction "rides that handler" but nothing invokes it)
expected: At deepest reachable depth, deep descent explodes with *destruction* effects (terrain/monsters/objects).
actual: Message only; no destruction effect, no RNG for the effect chain.
why: Bottom-of-dungeon Deep Descent is a free no-op instead of a dangerous fail.
confidence: high

### L10_world_loop-008  Deep Descent target omits stair_skip multiply and quest intermediates
sev: P1
concession: n
ref: reference/src/game-world.c:817-819 (target_increment = (4/stair_skip)+1; target_depth = dungeon_get_next_level(player, max_depth, target_increment) => max_depth + increment*stair_skip with quest scan)
port: packages/core/src/game/loop.ts:480-484 (targetDepth = min(maxDepth + increment, maxDepth-1) without * stair_skip); packages/core/src/game/effect-general.ts:646-648 (same formula when arming)
expected: Destination = dungeon_get_next_level(max_depth, (4/stair_skip)+1), including stair_skip multiply and intermediate quest levels.
actual: Adds the increment once with no * stair_skip and no quest stop. Default stair_skip=1 makes hop size match but still skips quest intermediate logic.
why: Deep Descent landing depth can desync from C whenever stair_skip != 1 or a quest lies between max and target.
confidence: high

### L10_world_loop-009  Word of Recall from town skips player_set_recall_depth
sev: P1
concession: n
ref: reference/src/game-world.c:801-804 (from town: player_set_recall_depth then change to recall_depth); reference/src/player-util.c:79-92 (force_descend may bump recall to next below max; always MAX(recall, 1))
port: packages/core/src/game/loop.ts:466-470 (always p.recallDepth = p.maxDepth; targetDepth = that)
expected: Recall depth respects force_descend next-level bump and minimum depth 1 via player_set_recall_depth.
actual: Always maxDepth only; force_descend never advances one more level; no quest-aware next-level helper.
why: birth_force_descend recall destinations wrong; any prior recall_depth bookkeeping is overwritten without C's rules.
confidence: high

### L10_world_loop-010  on_new_level does not announce feeling or run search
sev: P1
concession: n
ref: reference/src/game-world.c:1047-1052 (on_new_level: if depth, display_feeling(false); then search(player))
port: packages/core/src/session/game.ts:2066-2073 (changeLevel end: updateBonuses + updateFov only); packages/web/src/main.ts:5291-5296 (LEVEL_CHANGE only changeLevel; no displayFeeling); packages/web/src/main.ts:3311-3316 (^F only)
expected: Every dungeon level entry auto-prints the feeling line and runs incidental search on the landing square.
actual: Feeling only on manual ^F; search() has no port; arrival is silent on both.
why: Level-entry feedback and free search on stairs/recall missing in normal play.
confidence: high

### L10_world_loop-011  Deeper level does not update recall_depth with max_depth
sev: P2
concession: n
ref: reference/src/game-world.c:1023-1025 (if max_depth < depth then max_depth = recall_depth = depth)
port: packages/core/src/session/game.ts:1859-1862 (only maxDepth = depth; no recallDepth assignment anywhere in game.ts)
expected: Reaching a new deepest depth sets both max_depth and recall_depth.
actual: Only maxDepth updates; recallDepth stays at prior value until some other path overwrites it.
why: Recall bookkeeping and displays that read recallDepth can lag max depth until a WoR activation path rewrites them.
confidence: high

### L10_world_loop-012  do_cmd_alter missing trap, chest, and close-door branches
sev: P1
concession: n
ref: reference/src/cmd-cave.c:974-999 (alter_aux: mon / diggable / closed door / disarmable trap / trapped chest / open chest / open door close / else spin)
port: packages/core/src/game/cave-cmd.ts:797-814 (alter: mon / diggable / closed door / else "You spin around." only)
expected: '+' alter disarms traps, opens/disarms chests, and closes open doors on the target grid.
actual: Those targets only spin; dedicated open/disarm commands still work, but alter is incomplete vs C (and walk uses alter_aux for doors/traps upstream).
why: Alter command and any path relying on full alter_aux (including faithful walk trap path) cannot match C.
confidence: high

### L10_world_loop-013  PF_SEE_ORE free detect-every-turn missing from process_player
sev: P1
concession: n
ref: reference/src/game-world.c:952-962 (process_player each turn: if PF_SEE_ORE and not image/confused/amnesia/stun/paralyzed/terror/afraid, effect_simple(EF_DETECT_ORE, ... range 3,3))
port: packages/core/src/game/player-turn.ts:583-637 (no SEE_ORE / DETECT_ORE call); packages/core/src/game/effect-detect.ts:291-292 (handler exists but not driven from the loop)
expected: Dwarves (and other SEE_ORE races) get a free ore detect pulse every player turn while clear-headed.
actual: SEE_ORE never fires on the live turn path; ore sense only if some other effect invokes DETECT_ORE.
why: Signature Dwarf racial ability is dead in normal play.
confidence: high

### L10_world_loop-014  Running first step into an adjacent known trap is not stopped
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1084-1088 (move_player: trap && running && !trapsafe -> disturb, energy_use=0, no step)
port: packages/core/src/game/player-path.ts:853-855 (runStep always walkAction); packages/core/src/game/player-turn.ts:457-465 (walkAction always moves then onPlayerMoved)
expected: Running toward a known trap stops before entering the grid and spends no energy.
actual: The first run step onto a visible trap walks in and triggers it; run_test only inspects after successful steps.
why: Running into known traps is unsafe vs C; same root as missing move_player trap/run branches.
confidence: high

### L10_world_loop-015  Leaving a DTRAP region while running does not abort the step
sev: P2
concession: n
ref: reference/src/cmd-cave.c:1146-1153 (move_player: running && !firststep && old_dtrap && !new_dtrap -> disturb, energy 0, return)
port: packages/core/src/game/player-turn.ts:382-469 (no SQUARE.DTRAP edge check); packages/core/src/game/player-path.ts (firstStep tracked but never used for dtrap)
expected: Runs stop at the edge of a detect-traps region without spending the exit step.
actual: Runs freely leave DTRAP areas; only the status display shows DTRAP.
why: Detect-traps border no longer interrupts running as in upstream.
confidence: high

### L10_world_loop-016  Core rest command is a single hold turn; sleep unregistered
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1619-1668 (do_cmd_rest multi-turn with special REST_* counts and cmdq re-push); reference/src/cmd-cave.c:1675-1678 (do_cmd_sleep spends move_energy)
port: packages/core/src/game/player-turn.ts:487-548 (rest -> holdAction one move_energy; sleep not registered); packages/web/src/main.ts:3506+ (driveRest implements rest only in the web shell)
expected: Engine rest is multi-turn with REST_COMPLETE/ALL_POINTS/SOME_POINTS; sleep is a real energy command for paralysis path.
actual: Core registry rest is one idle turn; full rest lives only in web driveRest outside processPlayer; sleep has no handler (see also -001).
why: Non-web hosts and any path that dispatches registry "rest"/"sleep" diverge; paralysis path has no sleep target.
confidence: high

### L10_world_loop-017  Word of Recall / Deep Descent fire without disturb or command-queue flush
sev: P2
concession: n
ref: reference/src/game-world.c:794-795,820 (disturb + cmdq_flush on recall; disturb on deep descent)
port: packages/core/src/game/loop.ts:460-493 (sets generateLevel/targetDepth and messages only)
expected: Pending rest/run/repeats cancel and queue flushes so no extra action is lost or applied on the new level.
actual: generateLevel is set without disturb()/cmdq_flush equivalents on this path (web may clear some state later).
why: Recall/descent can leave rest/run/queued cmds in a dirty state across the level change.
confidence: med

### L10_world_loop-018  Tunnel success/fail messages drop "with your weapon/swap digger" clause
sev: P3
concession: n
ref: reference/src/cmd-cave.c:595-638 (messages include with_clause: hands / weapon / swap digger)
port: packages/core/src/game/cave-cmd.ts:418-459 (fixed strings without with_clause)
expected: "You have finished the tunnel with your weapon." (etc.)
actual: "You have finished the tunnel." / "You dig in the rubble." without digger phrase.
why: Visible message drift on a common action; minor.
confidence: high

### L10_world_loop-019  pack_overflow not run in process_player
sev: P2
concession: n
ref: reference/src/game-world.c:946-947 (process_player: pack_overflow(NULL) every command cycle)
port: packages/core/src/game/player-turn.ts:583-637 (no pack overflow); packages/core/src/game/gear.ts:20,387 (pack_overflow DEFERRED)
expected: Overfull pack auto-drops to floor before each command with the upstream messages/energy rules.
actual: Pack can remain over capacity until some other path forces it; no process_player overflow.
why: After forced overfill (e.g. some pickups), inventory state diverges until manual drop.
confidence: high

### L10_world_loop-020  hint.h store-hint list has no runtime port counterpart
sev: P3
concession: n
ref: reference/src/hint.h (struct hint; extern hints); store.c uses hints
port: packages/content/src/specs/init.ts:261 (hintsSpec parses data only); no packages/core consumer of a live hints linked list
expected: Runtime hint chain available for store/UI random tips as upstream.
actual: Data may be parsed into content packs but no core/source equivalent of the hint list API is used in play.
why: Store/hint flavor text path incomplete; low gameplay impact.
confidence: med

## MAP L10_world_loop
reference/src/cmd-cave.c -> packages/core/src/game/cave-cmd.ts, packages/core/src/game/player-turn.ts, packages/core/src/game/steal.ts, packages/core/src/game/player-path.ts (run/explore/pathfind), packages/web/src/main.ts (rest driveRest)
reference/src/cmd-core.c -> packages/core/src/cmd.ts, packages/core/src/game/player-turn.ts (processPlayer / bloodlust coercion)
reference/src/cmd-core.h -> packages/core/src/cmd.ts
reference/src/cmd-misc.c -> packages/core/src/game/wizard.ts (wizard entry), packages/web/src/main.ts (retire/note partial), packages/web/src/wizard.ts
reference/src/cmd-obj.c -> packages/core/src/game/obj-cmd.ts, packages/core/src/game/spell-cmd.ts (cast/study)
reference/src/cmd-pickup.c -> packages/core/src/game/pickup.ts
reference/src/cmds.h -> packages/core/src/cmd.ts (CommandCode / COMMAND_INFO)
reference/src/cmd-spoil.c -> packages/cli/src/spoilers.ts, packages/cli/src/main-spoil.ts
reference/src/cmd-wizard.c -> packages/core/src/game/wizard.ts, packages/web/src/wizard.ts, packages/cli/src/wiz-stats.ts (collect_*)
reference/src/debug.c -> NONE (no debug() facade; console/logging ad hoc)
reference/src/debug.h -> NONE
reference/src/game-event.c -> packages/core/src/events.ts
reference/src/game-event.h -> packages/core/src/events.ts
reference/src/game-input.c -> packages/web/src/overlay.ts (getCheck/getAimDir/...), packages/web/src/main.ts, packages/core/src/session/game.ts (injected getItem hooks)
reference/src/game-input.h -> packages/web/src/overlay.ts, packages/core/src/session/game.ts (seams; no single game-input module)
reference/src/game-world.c -> packages/core/src/game/loop.ts, packages/core/src/game/world.ts, packages/core/src/game/scheduler.ts, packages/core/src/game/energy.ts, packages/core/src/session/game.ts (on_new_level/changeLevel)
reference/src/game-world.h -> packages/core/src/game/loop.ts, packages/core/src/game/world.ts, packages/core/src/game/energy.ts
reference/src/hint.h -> packages/content/src/specs/init.ts (hintsSpec parse only); runtime list NONE
reference/src/list-elements.h -> packages/core/src/generated/elements.ts
reference/src/list-message.h -> packages/core/src/generated/message.ts
reference/src/list-options.h -> packages/core/src/generated/options.ts
reference/src/list-parser-errors.h -> packages/core/src/generated/parser-errors.ts
reference/src/list-randart-properties.h -> packages/core/src/generated/randart-properties.ts
reference/src/message.c -> packages/core/src/msg.ts, packages/web/src/messages.ts
reference/src/message.h -> packages/core/src/msg.ts, packages/core/src/generated/message.ts
reference/src/option.c -> packages/core/src/player/options.ts, packages/web/src/options.ts
reference/src/option.h -> packages/core/src/player/options.ts, packages/core/src/generated/options.ts
reference/src/source.c -> packages/core/src/effects/interpreter.ts (sourceNone/Player/Monster/Trap/Object/ChestTrap)
reference/src/source.h -> packages/core/src/effects/interpreter.ts
reference/src/target.c -> packages/core/src/game/target.ts, packages/core/src/game/target-loop.ts
reference/src/target.h -> packages/core/src/game/target.ts
reference/src/wizard.h -> packages/core/src/game/wizard.ts
reference/src/wiz-debug.c -> packages/core/src/game/wizard.ts (wiz_cheat_death / cure paths)
reference/src/wiz-spoil.c -> packages/cli/src/spoilers.ts
reference/src/wiz-stats.c -> packages/cli/src/wiz-stats.ts, packages/cli/src/stats.ts
