### L9_dungeon-001  Generated traps do not perform C-time kind and power rolls
sev: P1
concession: n
ref: reference/src/gen-util.c:790-791; reference/src/trap.c:275-394; reference/src/gen-cave.c:821-834
port: packages/core/src/session/boot.ts:209-216; packages/core/src/gen/util.ts:1176-1198; packages/core/src/gen/cave.ts:610-615
expected: TYP_TRAP and try_door call place_trap during generation, which consumes the trap-kind and power RNG draws and records the selected trap.
actual: genDeps supplies no trapKinds, so placeTrap only marks a trap grid and performs no kind or power draw; tryDoor also only calls markTrap and never calls placeTrap.
why: Generated trap identity and power, as well as the C RNG draw order, are absent from dungeon generation.
confidence: high

### L9_dungeon-002  Populating a level re-picks and discards generated traps
sev: P1
concession: n
ref: reference/src/trap.c:356-394; reference/src/gen-cave.c:821-834
port: packages/core/src/session/game.ts:1571-1633; packages/core/src/gen/util.ts:1176-1198
expected: The trap kind and power chosen during generation remain attached to the generated level and are materialized without another random selection.
actual: LevelContent stores only trapGrids; populateFromLevel calls placeTrap for each grid, reusing live RNG and re-picking the trap, while any Gen.traps data is not consumed.
why: Level entry changes trap identity, power, and RNG state relative to the generation result.
confidence: high

### L9_dungeon-003  Delayed traps are never triggered when the player leaves
sev: P1
concession: n
ref: reference/src/mon-util.c:503-515; reference/src/trap.c:551-604
port: packages/core/src/game/player-turn.ts:457-465; packages/core/src/game/trap.ts:685-688; packages/core/src/game/context.ts:889-899
expected: Player movement calls player_leaving on the old grid, and that hook calls hit_trap(old_grid, 1), triggering delayed traps.
actual: Movement only calls onPlayerMoved for the new grid; its trap callback calls hitTrap on the new grid with mode 0, and monsterSwap has no leaving hook.
why: TRF_DELAY traps on the square being left do not fire in the port.
confidence: high

### L9_dungeon-004  Trap saving throws and trap immunity are not wired to live player state
sev: P1
concession: n
ref: reference/src/trap.c:515-549
port: packages/core/src/game/trap.ts:419-458; packages/core/src/session/game.ts:1329-1351
expected: hit_trap checks trapsafe and OF_TRAP_IMMUNE, then applies save_flags through the player's flags, armor, and saving throw.
actual: hitTrap queries optional env.playerHasFlag, but the live trap environment provides no playerHasFlag callback and no live trapsafe/save state.
why: Immune players can be affected and traps that should be saved against always proceed to their effects.
confidence: high

### L9_dungeon-005  Town terrain is regenerated instead of persisted
sev: P1
concession: n
ref: reference/src/generate.c:1347-1373; reference/src/gen-cave.c:2664-2704
port: packages/core/src/session/game.ts:1864-2054; packages/core/src/gen/cave.ts:2555-2558
expected: Leaving town stores the current Town chunk, and town_gen reuses that chunk and its stair on return.
actual: The normal transition uses persist=false and does not cache the town; the generator explicitly regenerates town on each entry.
why: Town terrain and its generated state do not persist across leaving and re-entering town.
confidence: high

### L9_dungeon-006  Changing terrain does not destroy traps on live squares
sev: P1
concession: n
ref: reference/src/cave-square.c:1236-1262
port: packages/core/src/world/chunk.ts:196-211; packages/core/src/game/effect-terrain.ts:235-235; packages/core/src/game/effect-terrain.ts:469-474
expected: A live square_set_feat on terrain that cannot hold traps calls square_destroy_trap before updating the square.
actual: Chunk.setFeat updates feature counts and the feature value only; it never removes state.traps when the new terrain is non-trappable.
why: Terrain destruction and alteration effects can leave trap instances on squares where the C implementation removes them.
confidence: high

### L9_dungeon-007  Walking onto a known disarmable trap does not enter disarm mode
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1058-1088
port: packages/core/src/game/player-turn.ts:457-481; packages/core/src/game/cave-cmd.ts:615-618
expected: Movement detects a known disarmable trap and routes the action through do_cmd_alter_aux, auto-repeating disarm rather than stepping onto it.
actual: The port moves to the destination and invokes the new-square trap callback; it has no movement branch that detects a known disarmable trap and disarms it.
why: Walking onto known traps follows the wrong action and can trigger the trap instead of disarming it.
confidence: high

### L9_dungeon-008  Standing in a web does not clear the web on movement
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1287-1297
port: packages/core/src/game/player-turn.ts:457-465; packages/core/src/game/cave-cmd.ts:615-618
expected: A movement command from a webbed square removes all web traps, spends movement energy, and ends the command.
actual: The port has no pre-move web check; movement proceeds to the destination and only checks traps on the new square.
why: Web traps remain and the player can move through the web without the C clearing action.
confidence: high

### L9_dungeon-009  Generation setFeat does not clear wall-generation square flags
sev: P2
concession: n
ref: reference/src/cave-square.c:1263-1268
port: packages/core/src/world/chunk.ts:196-211; packages/core/src/gen/generate.ts:222-233
expected: During generation, set_feat clears SQUARE_WALL_INNER, SQUARE_WALL_OUTER, and SQUARE_WALL_SOLID immediately when setting a feature.
actual: Chunk.setFeat never clears those flags; generate.ts performs a later cleanup pass instead.
why: Intermediate generation predicates observe stale wall flags and the flag-clearing control flow and timing differ from C.
confidence: high

### L9_dungeon-010  Trap disturbance is omitted from the live trap environment
sev: P2
concession: n
ref: reference/src/trap.c:515-526
port: packages/core/src/game/trap.ts:419-431; packages/core/src/session/game.ts:1329-1351
expected: A non-immune player who triggers a trap is disturbed before the trap effect runs.
actual: hitTrap calls optional env.disturb, but the live trap environment does not provide disturb.
why: Trap activation does not interrupt running or repeating movement as in C.
confidence: high

### L9_dungeon-011  Feeling messages ignore the only_partial view guard
sev: P3
concession: n
ref: reference/src/cave-view.c:836-859
port: packages/core/src/world/view.ts:440-456; packages/core/src/world/view.ts:470-477
expected: Newly felt terrain produces the feeling message only when upkeep.only_partial is false.
actual: The port explicitly does not model only_partial and emits the feeling event whenever the feeling count threshold is reached.
why: Partial-view updates can produce feeling messages that C suppresses.
confidence: high

### L9_dungeon-012  Secret doors are incorrectly treated as strong mineral walls
sev: P1
concession: n
ref: reference/src/cave-square.c:236-240; reference/src/cave-square.c:278-282; reference/src/cave-square.c:698-700
port: packages/core/src/world/chunk.ts:302-305; packages/core/src/gen/util.ts:437-440; packages/content/pack/terrain.json:1
expected: square_isrock excludes any TF_DOOR_ANY feature, so a secret door is not a mineral or strong wall.
actual: isMineralWall returns true for any granite feature, and the shipped SECRET terrain has GRANITE and DOOR_ANY flags.
why: Secret doors take strong-wall behavior in generation and tunneling predicates where C excludes them.
confidence: high

### L9_dungeon-013  Any glyph trap is treated as a warding glyph
sev: P1
concession: n
ref: reference/src/cave-square.c:751-755
port: packages/core/src/game/trap.ts:154-156; packages/content/pack/trap.json:1
expected: square_iswarded is true only when the specific trap named glyph of warding is present.
actual: squareIsWarded checks only TRF_GLYPH, and the shipped decoy trap also has the GLYPH flag.
why: Decoys incorrectly block or alter summon eligibility as if they were glyphs of warding.
confidence: high

### L9_dungeon-014  Removed traps do not stop hitTrap processing
sev: P1
concession: n
ref: reference/src/trap.c:551-604
port: packages/core/src/game/trap.ts:460-493
expected: After each trap effect, C stops if the trap was removed from the square or the player died.
actual: The port checks only state.isDead; if an effect removed the trap, processing continues through later effects and cleanup using the stale trap instance.
why: One-time and chained trap behavior can continue after C would stop.
confidence: high

### L9_dungeon-015  Live monster light sources are never supplied to view updates
sev: P1
concession: n
ref: reference/src/cave-view.c:650-719
port: packages/core/src/world/view.ts:312-354; packages/web/src/main.ts:4117-4122
expected: calc_lighting scans live non-hidden monsters with race light data and adds their light sources before view calculation.
actual: The web updateView call always passes an empty sources array, and no live code constructs monster light sources from race data.
why: Light-emitting monsters do not illuminate nearby dungeon squares.
confidence: high

### L9_dungeon-016  Blindness does not forget the current non-passable square
sev: P2
concession: n
ref: reference/src/cave-view.c:889-897
port: packages/core/src/world/view.ts:483-510; packages/web/src/main.ts:4120-4122; packages/core/src/game/known.ts:696-710
expected: While blind, update_view forgets the current square if it is known and non-passable before updating the view.
actual: updateView has no blindness-forget step, and noteSpots retains seen squares without removing that memory.
why: Blind players retain remembered terrain where C deliberately forgets the current blocked square.
confidence: high

### L9_dungeon-017  Hallucination map rendering is absent
sev: P2
concession: n
ref: reference/src/cave-map.c:179-187
port: packages/web/src/main.ts:4380-4397; packages/web/src/main.ts:4819-4895
expected: During hallucination, an empty map square occasionally displays a random monster or object using the map RNG path.
actual: The port's map indexes and rendering have no hallucination or TMD_IMAGE branch and render only actual known objects, monsters, and terrain.
why: Hallucinating players never see the C random map hallucinations, and the corresponding RNG behavior is missing.
confidence: high

## MAP L9_dungeon
reference/src/cave.c -> packages/core/src/world/chunk.ts; packages/core/src/world/scatter.ts; packages/core/src/gen/util.ts; packages/core/src/game/world.ts; packages/core/src/game/floor.ts; packages/core/src/world/view.ts
reference/src/cave.h -> packages/core/src/world/chunk.ts; packages/core/src/world/feature.ts; packages/core/src/generated/square-flags.ts; packages/core/src/generated/terrain.ts; packages/core/src/generated/terrain-flags.ts; packages/core/src/gen/util.ts
reference/src/cave-map.c -> packages/core/src/game/known.ts; packages/core/src/gen/cave.ts; packages/web/src/main.ts; packages/web/src/mapview.ts
reference/src/cave-square.c -> packages/core/src/world/chunk.ts; packages/core/src/gen/util.ts; packages/core/src/game/cave-cmd.ts; packages/core/src/game/trap.ts
reference/src/cave-view.c -> packages/core/src/world/view.ts; packages/web/src/main.ts
reference/src/gen-cave.c -> packages/core/src/gen/cave.ts; packages/core/src/gen/room.ts; packages/core/src/gen/util.ts; packages/core/src/session/game.ts
reference/src/gen-chunk.c -> packages/core/src/gen/cave.ts; packages/core/src/gen/room.ts; packages/core/src/gen/generate.ts; packages/core/src/session/game.ts
reference/src/generate.c -> packages/core/src/gen/generate.ts; packages/core/src/gen/cave.ts; packages/core/src/session/game.ts; packages/core/src/session/boot.ts
reference/src/generate.h -> packages/core/src/gen/util.ts; packages/core/src/gen/generate.ts; packages/core/src/gen/cave.ts
reference/src/gen-monster.c -> packages/core/src/gen/gen-monster.ts; packages/core/src/gen/room.ts; packages/core/src/gen/util.ts
reference/src/gen-room.c -> packages/core/src/gen/room.ts; packages/core/src/gen/util.ts
reference/src/gen-util.c -> packages/core/src/gen/util.ts; packages/core/src/gen/cave.ts; packages/core/src/gen/generate.ts; packages/core/src/world/chunk.ts
reference/src/list-dun-profiles.h -> packages/core/src/generated/dun-profiles.ts
reference/src/list-room-flags.h -> packages/core/src/generated/room-flags.ts
reference/src/list-rooms.h -> packages/core/src/generated/rooms.ts
reference/src/list-square-flags.h -> packages/core/src/generated/square-flags.ts
reference/src/list-terrain.h -> packages/core/src/generated/terrain.ts
reference/src/list-terrain-flags.h -> packages/core/src/generated/terrain-flags.ts
reference/src/list-trap-flags.h -> packages/core/src/generated/trap-flags.ts
reference/src/trap.c -> packages/core/src/game/trap.ts; packages/core/src/world/trap.ts; packages/core/src/session/game.ts; packages/core/src/game/player-turn.ts
reference/src/trap.h -> packages/core/src/world/trap.ts; packages/core/src/game/trap.ts; packages/core/src/generated/trap-flags.ts
