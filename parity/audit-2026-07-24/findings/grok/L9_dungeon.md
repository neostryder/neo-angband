# L9_dungeon audit (dungeon gen / cave / trap)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: cave*, gen-*, generate*, list-dun/room/square/terrain/trap*, trap*.
Searched packages/ (excl. node_modules, dist, borg).

### L9_dungeon-001  Gen-time trap pick/power never runs; trapKinds not wired
sev: P1
concession: n
ref: reference/src/trap.c:356-394 (place_trap during generation: pick_trap + randcalc power in the gen RNG stream); reference/src/gen-util.c alloc_object TYP_TRAP calls place_trap mid-level
port: packages/core/src/session/boot.ts:180-217 (genDeps never sets trapKinds); packages/core/src/gen/util.ts:1177-1179 (without trapKinds only markTrap, no pick/power draws); packages/core/src/session/game.ts:1982-1989 (live generateLevel uses genDeps without traps)
expected: During generation, place_trap draws pick_trap + power into the level RNG stream so later object/monster placement and the final trap kind/power match C.
actual: Live genDeps omits trapKinds, so gen only records trap grids; no gen-stream pick/power draws. Level content after each trap site diverges from C's RNG stream.
why: Seeded level content and trap identities are not faithful; anything after a trap placement in the gen stream is desynced.
confidence: high

### L9_dungeon-002  populateFromLevel re-picks traps; discards Gen.traps
sev: P1
concession: n
ref: reference/src/trap.c:356-394 (place_trap is the only placer; gen placement is final)
port: packages/core/src/session/game.ts:1624-1629 (for trapGrids only: placeTrap(state, grid, -1, ...)); packages/core/src/gen/util.ts:274-279,1196-1197 (Gen.traps holds tidx+power when trapKinds present); packages/core/src/session/game.ts:2043-2054 (passes trapGrids, never g.traps); packages/core/src/game/trap.ts:333-354 (installTrap exists for gen-chosen kind/power)
expected: Kind and power chosen at generation are the live traps; no second pick_trap.
actual: Populate always calls placeTrap with tIdx=-1, re-drawing pick+power on the play RNG. Even if trapKinds were wired, g.traps would still be ignored.
why: Trap types/powers and post-gen play RNG diverge from upstream; installTrap path is dead on the live populate path.
confidence: high

### L9_dungeon-003  TRF_DELAY traps never fire (no player_leaving)
sev: P1
concession: n
ref: reference/src/mon-util.c:503-515 (player_leaving: hit_trap(grid1, 1) when player leaves a grid); reference/lib/gamedata/trap.txt "block fall trap" flags DELAY; reference/src/trap.c:511-513 (delayed gate)
port: packages/core/src/game/trap.ts:686-688 (onPlayerMoved only hitTrap(..., 0) on the NEW grid); packages/core/src/game/player-turn.ts:457-465 (movePlayer then onPlayerMoved(next) only); packages/core/src/game/context.ts:889-899,955-959 (monsterSwap/movePlayer never call hit_trap on the left grid)
expected: DELAY traps (e.g. block fall / ancient mechanism) activate when the player leaves their square, sealing granite behind them.
actual: Only delayed=0 (enter) is ever invoked on the live step path; DELAY traps never run their effects.
why: A normal dungeon trap type is inert; walk-off granite seal never happens.
confidence: high

### L9_dungeon-004  Trap OF save / TRAP_IMMUNE never consulted on live path
sev: P1
concession: n
ref: reference/src/trap.c:515-549 (player_is_trapsafe / player_of_has save_flags / OF_TRAP_IMMUNE learn); trap.txt save: lines (e.g. FEATHER for pits)
port: packages/core/src/session/game.ts:1343-1350 (trapDeps.env has expGain/msg/changeLevel only; no playerHasFlag, no disturb); packages/core/src/game/trap.ts:419-441 (trapImmune and saveFlags use env.playerHasFlag ?? false)
expected: Trap-immune equipment and trap save flags fully skip or save; equip_learn_flag on those OF flags.
actual: playerHasFlag is never set; every trap treats OF saves and TRAP_IMMUNE as false (TMD_TRAPSAFE alone still works via timed[]).
why: Boots of feather fall, trap immunity items, and kind save flags do nothing on traps in normal play.
confidence: high

### L9_dungeon-005  Town terrain not stored/restored without birth_levels_persist
sev: P1
concession: n
ref: reference/src/generate.c:1369-1373 (non-persist path: always cave_store town terrain when leaving depth 0); reference/src/gen-cave.c:2671-2703 (town_gen reloads chunk_find_name("Town") layout)
port: packages/core/src/session/game.ts:1871-2054 (without birth_levels_persist, every depth including 0 fully regenerates); packages/core/src/gen/cave.ts:2555-2558 (documents deferred town re-entry; regenerates every entry)
expected: Default play keeps the same town shop layout/stair grid across visits (terrain-only store via chunk_write); only residents re-roll.
actual: Leaving and returning to town regenerates a new layout (new store lots, stair position, ruins) every time unless birth_levels_persist is on.
why: Default town identity is unstable; shop doors and stair location change between visits.
confidence: high

### L9_dungeon-006  Live square_set_feat does not destroy traps on non-trappable terrain
sev: P1
concession: n
ref: reference/src/cave-square.c:1236-1262 (character_dungeon: if !square_player_trap_allowed then square_destroy_trap); reference/src/effect-handler-general.c EF_GRANITE / terrain changes use square_set_feat
port: packages/core/src/world/chunk.ts:201-211 (setFeat: feat_count + GLOW only); packages/core/src/game/effect-terrain.ts:235 (handleGRANITE setFeat GRANITE with no trap remove); packages/core/src/game/effect-terrain.ts:469-474 (square_destroy / DESTRUCTION setFeat without trap clear)
expected: Changing a grid to non-trap-holding terrain removes all traps on that grid.
actual: Traps remain in state.traps on granite/rubble/etc. after terrain effects (block-fall GRANITE, *destruction*, earthquake fills).
why: Traps can sit on illegal terrain; subsequent steps may re-trigger or leave ghosts; GRANITE seal fails to clear its own trap.
confidence: high

### L9_dungeon-007  Disarm-on-walk for known disarmable traps missing
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1058-1083,1311-1312 (move_player(dir, disarm): known disarmable trap + disarm true -> do_cmd_alter_aux / disarm, not step)
port: packages/core/src/game/player-turn.ts:472-481 (documents walk/jump share body; disarm-on-walk deferred); packages/core/src/game/cave-cmd.ts:615-618 (disarm-on-walk still on base action); packages/core/src/game/trap.ts:686-688 (any step onto player trap fires hitTrap)
expected: Walking onto a known, enabled player trap auto-disarms (alter) unless trapsafe/jump; jump deliberately steps on.
actual: Every walk onto a trap triggers it; jump is identical; no alter/disarm branch on walk.
why: Default walk into visible traps always sets them off instead of attempting disarm.
confidence: high

### L9_dungeon-008  Standing-in-web walk does not clear the web
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1288-1297 (do_cmd_walk: if square_iswebbed on player grid, remove web, spend turn, do not move)
port: packages/core/src/game/player-turn.ts:382-469 (walkAction never checks web on current grid); packages/core/src/game/cave-cmd.ts:616-617 (web clear noted as still on base action)
expected: Attempting to walk while webbed clears the web and ends the turn in place.
actual: Player walks out of webs normally; webs only block via other optional predicates.
why: Web spinner combat is much weaker; webs do not pin the player for a turn.
confidence: high

### L9_dungeon-009  Gen setFeat never clears WALL_INNER/OUTER/SOLID (C does)
sev: P2
concession: n
ref: reference/src/cave-square.c:1263-1268 (!character_dungeon: square_set_feat offs WALL_INNER/OUTER/SOLID); reference/src/gen-cave.c:742-756 (tunnel piercings use square_set_feat to floor)
port: packages/core/src/world/chunk.ts:201-211 (setFeat never clears wall gen flags); packages/core/src/gen/generate.ts:222-233 (clearGenerationFlags only after full builder success)
expected: Any setFeat during generation clears SQUARE_WALL_* flags on that grid immediately.
actual: Flags stick until end-of-level clearGenerationFlags; mid-gen grids can be floor yet still carry WALL_OUTER if only the flag is tested.
why: Predicates that key only on wall flags (not granite+flag) can mis-classify mid-generation; residual divergence risk.
confidence: med

### L9_dungeon-010  hit_trap never disturbs (run/rest cancel) on live path
sev: P2
concession: n
ref: reference/src/trap.c:525-526 (disturb(player) before trap messages/effects)
port: packages/core/src/game/trap.ts:431 (env.disturb?.()); packages/core/src/session/game.ts:1343-1350 (trapDeps.env omits disturb though disturb() exists in player-path.ts)
expected: Triggering a trap cancels running/resting/repeating commands.
actual: disturb hook is never installed for traps; run can continue after setting off a trap unless another path cancels it.
why: Running into traps does not stop the player the way C does.
confidence: high

### L9_dungeon-011  only_partial feeling reveal guard not modelled
sev: P3
concession: n
ref: reference/src/cave-view.c:849-854 (feeling_need reveal suppressed when p->upkeep->only_partial after fresh level full update)
port: packages/core/src/world/view.ts:447-456 (documents only_partial not modelled; feeling event can fire once more on level entry)
expected: Initial FOV after new level does not pop the feeling message via the only_partial guard.
actual: Feeling signal may fire on the first full view of a new level when feeling_need is reached immediately.
why: Extra feeling presentation on entry; no mechanical state divergence beyond the message/event.
confidence: high

### L9_dungeon-012  Chunk object-list / player knowledge cave (cave.c list) is structural reshape
sev: P3
concession: n
ref: reference/src/cave.c:438-479 (list_object / delist_object oidx tables); reference/src/cave-map.c:459-489 (square_memorize_traps copies to player->cave)
port: packages/core/src/game/floor.ts (Map piles); packages/core/src/game/trap.ts:10-16,356-383 (VISIBLE flag stands in for player cave trap memory); packages/core/src/game/known.ts (known feat/object maps)
expected: Dual real/known chunk with oidx-linked object lists and trap mirrors.
actual: Flat arrays + GameState maps; knowledge is feature/object known maps + VISIBLE on trap instances.
why: Save/UI structure differs but many live predicates are reimplemented; residual edge cases around imagined objects / trap memory remain possible.
confidence: med

## MAP L9_dungeon
reference/src/cave.c -> packages/core/src/world/chunk.ts (cave_new/feat bookkeeping); packages/core/src/world/scatter.ts (scatter/scatter_ext); packages/core/src/world/flow.ts (noise/scent from game-world, related); packages/core/src/game/floor.ts (list_object/pile half)
reference/src/cave.h -> packages/core/src/world/chunk.ts; packages/core/src/generated/square-flags.ts; packages/core/src/generated/terrain.ts; packages/core/src/generated/terrain-flags.ts
reference/src/cave-map.c -> packages/core/src/game/known.ts (note_spot/memorize/illuminate knowledge); packages/core/src/gen/cave.ts (caveIlluminate flag subset); packages/web/src/main.ts + packages/web/src/mapview.ts (map_info / grid_data_as_text presentation)
reference/src/cave-square.c -> packages/core/src/world/chunk.ts (feat_* + square predicates); packages/core/src/gen/util.ts (gen-time isempty/canputitem/stairs predicates); packages/core/src/game/cave-cmd.ts (isDiggable/secret door); packages/core/src/game/trap.ts (trap square_* predicates)
reference/src/cave-view.c -> packages/core/src/world/view.ts (los, updateView, lighting, CLOSE_PLAYER/VIEW/SEEN)
reference/src/gen-cave.c -> packages/core/src/gen/cave.ts (classic/modified/town/labyrinth/cavern/moria/lair/gauntlet/hard_centre builders, tunnel/streamer, illuminate, profile registry)
reference/src/gen-chunk.c -> packages/core/src/gen/cave.ts (chunk_copy, symmetry helpers used by multi-region); packages/core/src/gen/room.ts (symmetryTransform/vault_chunk); packages/core/src/session/game.ts (chunk_list / persist freeze as levelCache); packages/core/src/gen/generate.ts (chunkValidateObjects)
reference/src/generate.c -> packages/core/src/gen/generate.ts (generateLevel, placeFeeling, feelings, getJoinInfo, collectJoins); packages/core/src/gen/cave.ts (choose_profile / labyrinth_check); packages/core/src/session/game.ts (prepare_next_level / cave_store / quest spawns / town re-entry path)
reference/src/generate.h -> packages/core/src/gen/util.ts (Dun, Gen, SET_*/TYP_*, tunnel/streamer params); packages/core/src/gen/generate.ts; packages/core/src/gen/cave.ts (DunProfile types)
reference/src/gen-monster.c -> packages/core/src/gen/gen-monster.ts (mon_select, mon_restrict, mon_pit_hook, set_pit_type, get_vault_monsters, get_chamber_monsters, spread_monsters)
reference/src/gen-room.c -> packages/core/src/gen/room.ts (room builders, vault/template, nest/pit, chambers, huge, registry); packages/core/src/gen/util.ts (geometry helpers shared with gen-room)
reference/src/gen-util.c -> packages/core/src/gen/util.ts (placement, alloc_*, stairs, player spot, vault helpers, place_object/gold/trap/door)
reference/src/list-dun-profiles.h -> packages/core/src/generated/dun-profiles.ts
reference/src/list-room-flags.h -> packages/core/src/generated/room-flags.ts
reference/src/list-rooms.h -> packages/core/src/generated/rooms.ts
reference/src/list-square-flags.h -> packages/core/src/generated/square-flags.ts
reference/src/list-terrain.h -> packages/core/src/generated/terrain.ts
reference/src/list-terrain-flags.h -> packages/core/src/generated/terrain-flags.ts
reference/src/list-trap-flags.h -> packages/core/src/generated/trap-flags.ts
reference/src/trap.c -> packages/core/src/game/trap.ts (instances, place/hit/reveal/disarm, door locks); packages/core/src/world/trap.ts (bind kinds, lookup_trap)
reference/src/trap.h -> packages/core/src/world/trap.ts; packages/core/src/game/trap.ts; packages/core/src/generated/trap-flags.ts
