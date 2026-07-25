# W1 — Adjudication: `reference/src/cave.h`

Header: `reference/src/cave.h` (76 allow-list entries).  
Worktree: `C:\Repositories\na-wt-fx` (branch `p3/w1-cave`).  
Oracle: Angband 4.2.6 under `reference/` (read-only).  
Scope: every `c-api-allowlist.json` entry whose `header` is `reference/src/cave.h`. Nothing else.

## Table

| C function | C line | verdict | evidence |
|---|---:|---|---|
| `cave_connectors_free` | 434 | N/A | C: `cave.c:381` walks/frees a `connector` linked list (`mem_free` info + node). Port stores stair joins as plain `Connector[]` (`gen/util.ts` Gen.joins, `session/game.ts:1978-1980` freeze/restore); GC owns lifetime — no free helper. |
| `cave_forget_flow` | 246 | N/A | Declared only in `cave.h:246`; **no definition and no callers** anywhere under `reference/`. Dead header residue. Live flow clear is the zeroing pass inside `makeNoise` (`world/flow.ts:38-41`). |
| `cave_free` | 435 | N/A | C: `cave.c:395` frees every square/object/monster allocation. Port drops `Chunk` references (`session/game.ts` reassigns `state.chunk`, `cache.delete`); JS GC — no explicit free. |
| `cave_known` | 454 | MISSING | C: `cave-map.c:633-660`; after every town generate (`generate.c:1545-1547`) copies every non-interior-wall feat into `player->cave` (all exterior floors + walls). Port only runs `caveIlluminateKnown` on depth 0 (`session/game.ts:2145-2146`, `known.ts:124`) which, at night, **forgets floors**. No full-exterior town-knowledge pass. See W1-cave-001. |
| `cave_new` | 433 | PORTED | C: `cave.c:344`. Port: `new Chunk(features, height, width)` (`world/chunk.ts:146-161`); generation call sites e.g. `gen/cave.ts:1019`. |
| `cave_update_flow` | 245 | N/A | Declared only in `cave.h:245`; **no definition and no callers**. Dead header residue. Live path is `makeNoise` + `updateScent` from `game/loop.ts:434-435` (C `game-world.c` `make_noise` / `update_scent`, not these cave.h symbols). |
| `count_feats` | 448 | MISSING | C: `cave.c:644`; used by `do_cmd_open` / `close` / `disarm` (`cmd-cave.c:250,409,874-876`) to auto-set direction when exactly one matching adjacent grid exists. Port cave commands require `cmd.dir` (`cave-cmd.ts:544-547`); UI always prompts (`web/overlay.ts:276 getRepDir`, `web/main.ts:3194+`). Comment at `cave-cmd.ts:32` notes direction inference is not ported. See W1-cave-002. |
| `delist_object` | 437 | N/A | C: `cave.c:485` clears `c->objects[oidx]`. Port has no oidx registry; floor piles are `Map` lists (`game/floor.ts:18-21` documents oidx bookkeeping as replaced by the pile map). |
| `expose_to_sun` | 244 | PORTED | C: `cave-map.c:621`. Port: `exposeToSun` `game/project-feat.ts:87-94`, called from KILL_WALL / KILL_DOOR / FIRE / COLD paths (`:216,229,297,317`). Live on surface (`depth === 0`). |
| `get_feat_code_name` | 432 | PORTED | C: `cave.c:336` indexes `feat_code_list`. Port: `Feature.code` on every bound feature (`world/feature.ts:19,118`); reverse of `FEAT` / `features.get(fidx).code` (also `mod/ids.ts:234` feat id registry). |
| `list_object` | 436 | N/A | C: `cave.c:438` assigns oidx slots (and extends known list). Port: floor `Map` is the object list (`game/floor.ts:18-21`); no dual `c->objects[]` index. |
| `lookup_feat` | 430 | PORTED | C: `cave.c:285` by display name. Port: `FeatureRegistry.lookupByName` (`world/feature.ts:169-171`); used e.g. tile prefs. |
| `lookup_feat_code` | 431 | PORTED | C: `cave.c:315`. Port: `FeatureRegistry.lookupByCode` (`world/feature.ts:174-181`); wired in `visuals/tile-prefs.ts:184`. |
| `map_info` | 237 | PORTED | C: `cave-map.c:82` fills `grid_data` for UI. Port map draw in `packages/web/src/main.ts` (~4957+, comments cite `map_info` lighting) and overview `packages/web/src/mapview.ts`; agent `cellView` (`agent/perceive.ts:264-296`) is the structured grid summary. |
| `no_light` | 234 | PORTED | C: `cave-view.c:914` — player grid not `square_isseen`. Port: `noLight` in `game/cave-cmd.ts:317-319` and `game/chest.ts:79-80` (`!squareIsSeen(...)`); wired into lock/disarm skill penalties. |
| `object_lists_check_integrity` | 438 | N/A | C: `cave.c:503` debug `assert`s over dual object lists. Port has no dual oidx lists; integrity is not a runtime assert path. |
| `square_add_door` | 395 | PORTED | C: `cave-square.c:1347` → `FEAT_CLOSED`/`OPEN`. Port: `setFeat(FEAT.CLOSED/OPEN)` at gen (`gen/util.ts:1147`, rooms) and `PROJ.MAKE_DOOR` (`project-feat.ts:268`). |
| `square_add_glyph` | 392 | PORTED | C: `cave-square.c:1310` places warding/decoy trap. Port: `handleGLYPH` `game/effect-general.ts:156-194` (`placeTrap` + decoy bookkeeping). Live via effect interpreter. |
| `square_add_stairs` | 394 | PORTED | C: `cave-square.c:1337` depth/quest rules + random up/down. Port: `placeStairs` / `placeRandomStairs` `gen/util.ts:1204-1216` (same depth/quest/`randint0(100)<50` rules). |
| `square_add_trap` | 391 | PORTED | C: `cave-square.c:1304` → `place_trap(c,grid,-1,depth)`. Port: `placeTrap(state, grid, -1, depth, …)` (`project-feat.ts:279`, `game/trap.ts:358`); gen `gen/util.ts:1179`. |
| `square_add_web` | 393 | PORTED | C: `cave-square.c:1331`. Port: `handleWEB` `effect-general.ts:200-237` (`lookupTrap("web")` + `placeTrap`). |
| `square_changeable` | 356 | PORTED | C: `cave-square.c:868`. Port: `squareChangeable` in `effect-terrain.ts:173-180` and `quest.ts:110+`; gates destruction/earthquake. |
| `square_close_door` | 399 | PORTED | C: `cave-square.c:1361` → `FEAT_CLOSED`. Port: `closeAux` `cave-cmd.ts:308` `setFeat(FEAT.CLOSED)`; installed as `"close"` command. |
| `square_delete_object` | 377 | PORTED | C: `cave-square.c:1088` excise+delist+delete (+ note/light). Port: `floorExcise` then drop/delete at callers (`mon-death.ts:304-309` mimicked object; pickup, project-obj, effect-terrain, etc.). Note/light folded into global FOV/`noteSpots`. |
| `square_destroy_door` | 402 | PORTED | C: `cave-square.c:1382` remove lock + floor. Port: `PROJ.KILL_DOOR` / door branch of KILL_WALL `project-feat.ts:182-187,221-227` `setFeat(FEAT.FLOOR)` (locks destroyed via feat hook / trap side effect). |
| `square_destroy_rubble` | 412 | PORTED | C: `cave-square.c:1502`. Port: rubble arm of `PROJ.KILL_WALL` `project-feat.ts:154-159` `setFeat(FEAT.FLOOR)` (+ buried-object chance). |
| `square_destroy_wall` | 407 | PORTED | C: `cave-square.c:1419`. Port: `squareDestroyWall` `monster-turn.ts:1025-1027`, called from boring-wall path (`:1150`). |
| `square_disable_trap` | 404 | PORTED | C: `cave-square.c:1396` timeout 10 on player traps. Port: `disableTraps` `project-feat.ts:97-100`; also `squareSetTrapTimeout` `trap.ts:581`. Wired from `PROJ.KILL_TRAP`. |
| `square_dtrap_edge` | 355 | PORTED | C: `cave-square.c:841`. Port: `squareDtrapEdge` `display.ts:764-772`; drives DTrap status colour (`:754`). |
| `square_excise_all_imagined` | 375 | N/A | C: `cave-square.c:1051` purges `OBJ_NOTICE_IMAGINED` twins from the dual known cave. Port knowledge is `KnownMap` (`state.known`), not a shadow object cave; `OBJ_NOTICE.IMAGINED` is defined but never set. Dual-cave imagined objects do not exist. |
| `square_excise_object` | 373 | PORTED | C: `cave-square.c:1023`. Port: `floorExcise` `game/floor.ts:77-89`; used throughout pickup/project/death/effects. |
| `square_excise_pile` | 374 | PORTED | C: `cave-square.c:1031` walks pile and deletes all. Port: loop `floorExcise` over `[...floorPile(...)]` (e.g. `effect-terrain.ts:459-466,733-734`; `pushObject` `project-feat.ts:74-76`). |
| `square_feat` | 367 | PORTED | C: `cave-square.c:969` returns `&f_info[feat]`. Port: `Chunk.feature(grid)` `chunk.ts:197-199`. |
| `square_force_floor` | 413 | INLINED | C: `cave-square.c:1507` thin `set_feat(FLOOR)`. Sole interesting caller `push_object` (`obj-pile.c:1204`) does force_floor + open door; port `pushObject` (`project-feat.ts:70-78`) goes straight to `setFeat(FEAT.OPEN)` then restores. Elsewhere, `setFeat(FEAT.FLOOR)` is the force-floor. |
| `square_hasgoldvein` | 286 | PORTED | C: `cave-square.c:284` `TF_GOLD`. Port: `hasGoldVein` `effect-detect.ts:287-289` (`TF.GOLD`); live in `EF_DETECT_ORE`. |
| `square_holds_object` | 372 | INLINED | C: `cave-square.c:1015` pile membership. Port: `floorPile(...).includes` / `indexOf` at call sites (`effect-item.ts:283`, `floor.ts:85`). |
| `square_isbright` | 337 | PORTED | C: `cave-square.c:706` → `feat_is_bright`. Port: `featIsBright` `chunk.ts:94` + `isBrightSquare` `view.ts:198-199`; used by FOV, illuminate, project-feat. |
| `square_isdecoyed` | 344 | PORTED | C: `cave-square.c:757` decoy trap on grid. Port: `squareIsDecoyed` `monster-turn.ts:404-407` via `state.decoy`; used by monster AI. |
| `square_isdtrap` | 321 | PORTED | C: `cave-square.c:570` `SQUARE_DTRAP`. Port: `squareIsDtrap` `display.ts:759-760`; flag set by detect (`effect-detect.ts:200`). |
| `square_isfeel` | 310 | PORTED | C: `cave-square.c:482` `SQUARE_FEEL`. Port: `sqinfoHas(SQUARE.FEEL)` — set in `gen/generate.ts:264-265`, consumed in feeling reveal `view.ts:471-473`. |
| `square_isglow` | 304 | PORTED | C: `cave-square.c:432` `SQUARE_GLOW`. Port: `isGlow` `view.ts:194-195` / `sqinfoHas(GLOW)`; FOV lighting path. |
| `square_isinvis` | 312 | PORTED | C: `cave-square.c:498` `SQUARE_INVIS` (“unknown trap”). Port: `sqinfoHas(SQUARE.INVIS)` `display.ts:785` (same prt_terrain gate as C `ui-display.c:1191`). Flag is almost never set in either tree (wizard-only in C). |
| `square_isknownpassable` | 360 | PORTED | C: `cave-square.c:918`. Port: `squareIsKnownPassable` `player-path.ts:658-660`; explore/pathfinding. |
| `square_islockeddoor` | 348 | PORTED | C: `cave-square.c:783` `door_power > 0`. Port: `squareDoorPower(...) > 0` via `env.isLockedDoor` (`session/game.ts:1451-1452`, `cave-cmd.ts:70,275`). Live. |
| `square_ismark` | 303 | INLINED | C: `cave-square.c:424` reads `SQUARE_MARK` (only for wiz_light/dark temp mark). Port has `SQUARE.MARK` and `sqinfoHas`; `wizLightLevel` (`effect-terrain.ts:148`) does not use the mark/forget-misremembered phase — absorbed into that simplified body. |
| `square_ismemorybad` | 300 | PORTED | C: `cave-square.c:408`. Port: `squareMemoryBad` `known.ts:193-196`; used by map/detect (`effect-detect.ts:124`). |
| `square_ismineral` | 285 | PORTED | C: `cave-square.c:278`. Port: `Chunk.isMineralWall` `chunk.ts:339-344` (explicit comment cites the C name; census missed the rename). Live in dig/gen. |
| `square_ismon_restrict` | 316 | PORTED | C: `cave-square.c:530` `SQUARE_MON_RESTRICT`. Port: flag set `gen/room.ts:617`, cleared end-of-gen `gen/generate.ts:242`; read via `sqinfoHas`. |
| `square_isno_map` | 318 | PORTED | C: `cave-square.c:546`. Port: `sqinfoHas(SQUARE.NO_MAP)` gate in `mapArea` `effect-detect.ts:104`; set on gauntlet gen (`gen/cave.ts:1763`). |
| `square_isno_teleport` | 317 | PORTED | C: `cave-square.c:538`. Port: `sqinfoHas(SQUARE.NO_TELEPORT)` in `effect-teleport.ts:237,335,396,430,545`; set on special levels (`gen/cave.ts:1762+`). |
| `square_isnoflow` | 341 | PORTED | C: `cave-square.c:738` → `feat_is_no_flow`. Port: `featIsNoFlow` in `makeNoise` `flow.ts:65` (square form is a one-line wrap of the feat predicate). |
| `square_isnoscent` | 342 | PORTED | C: `cave-square.c:746`. Port: `featIsNoScent` in `updateScent` `flow.ts:109`. |
| `square_isoccupied` | 298 | INLINED | C: `cave-square.c:391` `mon != 0`. Port: `c.mon(grid) !== 0` / `squareMonster`+`squareIsPlayer` at gen and project sites (`gen/util.ts:383,395`; `project-feat.ts:264,308-309`). |
| `square_isproject` | 320 | PORTED | C: `cave-square.c:562` `SQUARE_PROJECT`. Port: set/clear/scan in `world/project.ts:603-635` and teleport land cleanup. |
| `square_issecrettrap` | 352 | INLINED | C: `cave-square.c:815` player-trap and not visible. Port: `noteSpotRevealTrap` (`trap.ts:446-451`) gates on `squareIsPlayerTrap` then `squareRevealTrap(..., always=false)` — same notice path as C `square_note_spot` without a named predicate. |
| `square_istrappable` | 278 | PORTED | C: `cave-square.c:220` → `feat_is_trap_holding`. Port: `Chunk.isTrapHolding` / `featIsTrapHolding` (`chunk.ts:50-55,290-291`); gen + glyph placement. |
| `square_isunlockeddoor` | 349 | INLINED | C: `cave-square.c:791` closed + power 0. Port: `isClosedDoor && !isLockedDoor` in disarm→lock branch `cave-cmd.ts:806-809` and lock command `:826-827`. |
| `square_iswebbable` | 330 | INLINED | C: `cave-square.c:644` floor and no trap. Port: WEB effect body `effect-general.ts:230-232` (`squareIsTrap` / `isFloor`). |
| `square_light_spot` | 239 | N/A | C: `cave-map.c:255` sets `PR_ITEMLIST` + `EVENT_MAP` UI point redraw. Browser terminal redraws the full map every frame; no per-grid event bus. Presentation seam documented in `known.ts` / `chunk.ts` headers. |
| `square_mark` | 424 | INLINED | C: `cave-square.c:1585` `SQUARE_MARK` on — only wiz_light/dark. Port `wizLightLevel` does not need the temp-mark phase; flag setter would be `sqinfoOn(SQUARE.MARK)`. |
| `square_note_spot` | 238 | PORTED | C: `cave-map.c:226` know pile, reveal secret traps, memorize. Port: `noteSpots` `known.ts:739-766` (memorize + `squareKnowPile` + `noteSpotRevealTrap`); runs after every FOV update. |
| `square_object` | 370 | PORTED | C: `cave-square.c:998` head of floor pile. Port: `floorPile` `game/floor.ts:57-63`. |
| `square_open_door` | 398 | PORTED | C: `cave-square.c:1351` remove lock + `FEAT_OPEN`. Port: `squareOpenDoor` `monster-turn.ts:1030-1033` (`removeDoorLock` + `setFeat(OPEN)`); player path `openAux` `cave-cmd.ts:279,286`. |
| `square_seemslikewall` | 346 | PORTED | C: `cave-square.c:769` `TF_ROCK`. Port: `seemsLikeWall` `effect-detect.ts:80-82`; also `wizLightLevel` skips `TF.ROCK` (`effect-terrain.ts:154`). |
| `square_set_obj` | 389 | PORTED | C: `cave-square.c:128x` raw `squares[][].obj =`. Port: pile head write via `pileInsert` / `floorExcise` on `state.floor` Map (`floor.ts:66-70`) — same structural role, different storage. |
| `square_set_trap` | 390 | PORTED | C: raw `squares[][].trap =`. Port: `installTrap` / `squareRemoveAllTraps` write `state.traps` Map (`trap.ts:358+`). |
| `square_shopnum` | 416 | PORTED | C: `cave-square.c:1512` returns store index (`shopnum - 1`). Port keys stores by entrance feat: `StoreRegistry.byFeat(feat)` (`store/bind.ts:123-124`); town doors placed with `TOWN_STORE_FEATS[n]` (`gen/cave.ts:2324-2327`). |
| `square_smash_door` | 400 | PORTED | C: `cave-square.c:1367`. Port: `squareSmashDoor` `monster-turn.ts:1036-1038`; monster bash path. |
| `square_smash_wall` | 408 | PORTED | C: `cave-square.c:1424` wall + adjacent mineral survival rolls. Port: `squareSmashWall` `monster-turn.ts:1048-1067` (same 4/10/20 one_in_ order). |
| `square_tunnel_wall` | 406 | PORTED | C: `cave-square.c:1414` → floor. Port: `twall` `cave-cmd.ts:401-406` `setFeat(FEAT.FLOOR)` (identical body to destroy_wall). Live dig path. |
| `square_unlock_door` | 401 | PORTED | C: `cave-square.c:1377` `set_door_lock(..., 0)`. Port: `removeDoorLock` removes the door-lock trap (`session/game.ts:1521-1523`); also KILL_TRAP unlock arm `project-feat.ts:251-253`. |
| `square_unmark` | 425 | INLINED | C: `cave-square.c:1589` off MARK — wiz_light cleanup / project-feat forget pairing. Port: wiz path simplified; project-feat uses `squareForget` / glow off rather than MARK. Setter would be `sqinfoOff(SQUARE.MARK)`. |
| `square_upgrade_mineral` | 411 | PORTED | C: `cave-square.c:1494` MAGMA→MAGMA_K / QUARTZ→QUARTZ_K. Port: inlined in streamer placement `gen/cave.ts:680-683` with explicit C-name comment. |
| `square_wasseen` | 309 | PORTED | C: `cave-square.c:474` `SQUARE_WASSEEN`. Port: `markWasseen` / feeling path `view.ts:221-227,470-481`. |
| `wiz_dark` | 242 | PORTED | C: `cave-map.c:488`. Port: `wizLightLevel(state, false)` `effect-terrain.ts:148-170` (+ `forgetMap`); `EF_DARKEN_LEVEL` and wizard command. |
| `wiz_light` | 241 | PORTED | C: `cave-map.c:417`. Port: `wizLightLevel(state, true)`; `EF_LIGHT_LEVEL` (`effect-terrain.ts:280+`) and `wizard.ts:1067`. |

## MISSING findings

### W1-cave-001  cave_known
```
ref:      reference/src/cave-map.c:633
          callers: reference/src/generate.c:1545-1547 (every town entry)
port:     packages/core/src/game/known.ts:124 caveIlluminateKnown
          (session/game.ts:2145-2146, :2564 birth) — lighting-gated memorize/forget only
missing:  The full-exterior town knowledge pass: copy every feat whose 8-neighbours
          are not all non-projectable/bright into player map memory, independent of
          day/night. C runs this after generate so night towns still know floors;
          port's illuminate-only path forgets night floors and never re-knows them.
effect:   On a night town (birth/recall at night, or after dusk if that path runs
          only illuminate), the player map can miss floor tiles that C always shows
          as known town terrain.
severity: P2
confidence: high
```

### W1-cave-002  count_feats
```
ref:      reference/src/cave.c:644
          callers: reference/src/cmd-cave.c:250 (open), :409 (close), :874-876 (disarm)
port:     none as a helper; cave-cmd.ts:32 notes "count_feats direction inference (UI)"
          as not ported; commandGrid requires cmd.dir (cave-cmd.ts:544-547);
          web getRepDir always prompts (packages/web/src/overlay.ts:276)
missing:  When the player presses open/close/disarm without a direction and exactly
          one adjacent matching grid exists (one closed door, one open door, or one
          disarmable trap/unlocked door), C auto-selects that direction via
          count_feats + motion_dir. Port always demands an explicit direction.
effect:   Extra direction prompt on every open/close/disarm even when only one
          legal target is adjacent — classic Angband single-target auto-aim is gone.
severity: P2
confidence: high
```

## Counts

| Verdict | Count |
|---|---:|
| PORTED | 56 |
| INLINED | 9 |
| N/A | 9 |
| MISSING | 2 |
| UNSURE | 0 |
| **Total** | **76** |

Breakdown notes:
- **N/A (9):** C memory free (`cave_free`, `cave_connectors_free`), dead undeclared-body flow APIs (`cave_update_flow`, `cave_forget_flow`), oidx dual-list plumbing (`list_object`, `delist_object`, `object_lists_check_integrity`), dual-cave imagined purge (`square_excise_all_imagined`), UI point-redraw (`square_light_spot`).
- **INLINED (9):** thin flag/pile predicates and wiz MARK helpers absorbed at call sites (`square_force_floor`, `holds_object`, `isoccupied`, `issecrettrap`, `isunlockeddoor`, `iswebbable`, `ismark`, `mark`, `unmark`).
- **MISSING (2):** town full-knowledge pass (`cave_known`); open/close/disarm auto-direction (`count_feats`).

Adjudication only — port sources and `c-api-allowlist.json` were not modified.

---

## Gate notes (Opus, 2026-07-25)

**`count_feats` severity raised P2 -> P1.** I re-derived it: it is **not**
option-gated. `reference/src/cmd-cave.c:245-260` runs the count whenever the
command arrives without a direction, and does the same at `:409` (close, over
open doors) and `:874-876` (disarm, over disarmable traps and unlocked doors).
There is no `easy_open` option in `list-options.h` — upstream removed it, so the
auto-direction is unconditional 4.2.6 behaviour.

That makes it a divergence in **ordinary play, on every door and trap
interaction**: upstream opens the single adjacent closed door on `o` with no
prompt, and the port always asks for a direction. It changes the keystrokes the
game requires, which is squarely P1.

`cave_known` (P2) stands as reported.

**Rate check:** 76 entries -> 2 real gaps (2.6%). That confirms the worklist is
dominated by structural restructuring rather than absence, which is what the
per-header adjudication pass exists to separate. It also shows the census misses
renames that keep no morphological trace of the C name — `square_ismineral` ->
`isMineralWall` — so prefix-stripping alone will not close the gap; the residue
needs a reader.
