# W1 Adjudication — `reference/src/player-util.h`

Header: `reference/src/player-util.h` (35 allowlist entries).  
Worktree: `C:\Repositories\na-wt-fx` (branch `p3/w1-playerutil`).  
Oracle: Angband 4.2.6 under `reference/` (read-only).  
Method: re-derived each C body against the live port path (not name matching alone).

## Summary table

| C function | C line | verdict | evidence |
|---|---:|---|---|
| `dungeon_get_next_level` | 63 | INLINED | `reference/src/player-util.c:54-74`. No shared helper; stairs use `depth±1` (`packages/core/src/game/cave-cmd.ts:887,906`); deep descent uses `4/stairSkip+1` (`loop.ts:480`); teleport defaults `from+dir` (`effect-teleport.ts:427`). With shipped `stair-skip:1` the common path matches; force_descend stair targeting from `max_depth` and intermediate quest scan are not centralized. |
| `player_set_recall_depth` | 64 | PORTED | `reference/src/player-util.c:79-93`. Live in `packages/core/src/game/loop.ts:468-470` (`recallDepth = maxDepth` on town→dungeon recall). force_descend “next after max when not quest” bump is not present (birth option edge). |
| `player_get_recall_depth` | 65 | MISSING | `reference/src/player-util.c:100-136`. C prompts for a previously visited depth when `birth_levels_persist` and recalling from town (`effect-handler-general.c:1139-1141`). Port `handleRECALL` has no persist level picker; town recall always goes to `maxDepth`. |
| `dungeon_change_level` | 66 | PORTED | `reference/src/player-util.c:141-156`. `makeChangeLevel` / `game.changeLevel` (`packages/core/src/session/game.ts:1787+,2597`); sets depth, regenerates, store update on town return, autosave on arrive (`web/src/main.ts:5390-5395`). |
| `death_knowledge` | 69 | MISSING | `reference/src/player-util.c:281-318`. Death path does `historyUnmaskUnknown` + `enterScore` (`web/src/main.ts:5355-5381`) but not winner retirement package, `player_learn_all_runes`, or gear/home flavor-aware dump. |
| `player_best_digger` | 81 | PORTED | `reference/src/player-util.c:744-789`. `playerBestDiggerDigging` (`packages/core/src/player/best-digger.ts:39`) returns the DIGGING skill after the same pack-swap; live via `state.bestDiggerDigging` (`session/game.ts:682`) into tunnel (`cave-cmd.ts:430`). |
| `lookup_player_shape` | 85 | PORTED | `reference/src/player-util.c:971-982`. Shapes bound as `PlayerRegistry.shapes` (`player/bind.ts:527`); runtime assumes shape by index (`effect-general.ts:784`); resume uses `shape = null` for normal (`obj-cmd.ts:588`) instead of looking up `"normal"`. |
| `shape_name_to_idx` | 86 | PORTED | `reference/src/player-util.c:987-995`. Live injection `shapeNameToIdx` (`session/game.ts:976-980`) into effect builder (`effects/effect.ts:208-216,329`). |
| `player_shape_by_idx` | 87 | PORTED | `reference/src/player-util.c:1000-1011`. Index is array index into `shapes` / `EF_SHAPECHANGE` subtype (`effect-general.ts:784`). |
| `player_can_study` | 93 | INLINED | `reference/src/player-util.c:1120-1156`. Study path: `playerCanCast` then `newSpells <= 0` realm-noun message (`spell-cmd.ts:294-309`); web shell pre-checks (`main.ts:2263-2272`). |
| `player_can_read` | 94 | MISSING | `reference/src/player-util.c:1166-1197`. C gates scrolls on blind / no light / confused / amnesia (`cmd-obj.c:748-749`). Port `read` → `useAux` has no such gate (`obj-cmd.ts:1151-1154,704+`). |
| `player_can_fire` | 95 | INLINED | `reference/src/player-util.c:1206-1218`. Live checks for launcher/`ammoTval` in `ranged-cmd.ts:196-203,251-257` and web `fireCmd` (`main.ts:2360-2364`). |
| `player_can_refuel` | 96 | INLINED | `reference/src/player-util.c:1227-1240`. Equipped `TAKES_FUEL` light check in `refill` (`obj-cmd.ts:1224-1232`) and web `refuelItem` (`main.ts:1989-2000`). |
| `player_can_cast_prereq` | 97 | N/A | `reference/src/player-util.c:1246-1248`. C UI command-table prereq only (`ui-game.c`). Browser keymap has no pre-validation table; cast validates via `playerCanCast` (`spell-cmd.ts:101,241`). |
| `player_can_study_prereq` | 98 | N/A | `reference/src/player-util.c:1255-1257`. Same command-table glue; study path inlines the study gates. |
| `player_can_read_prereq` | 99 | N/A | `reference/src/player-util.c:1264-1271`. Command-table prereq; also special-cases `TMD_COMMAND` so `r` can release a commanded monster. Port mon-command path is separate (`mon-cmd.ts`); no shared prereq hook. |
| `player_can_fire_prereq` | 100 | N/A | `reference/src/player-util.c:1278-1280`. Command-table glue; fire path inlines the launcher check. |
| `player_can_refuel_prereq` | 101 | N/A | `reference/src/player-util.c:1287-1289`. Command-table glue; refill path inlines the light check. |
| `player_can_debug_prereq` | 102 | PORTED | `reference/src/player-util.c:1296-1307`. `confirmDebugGate` (`packages/web/src/wizard.ts:334-345`): NOSCORE_DEBUG short-circuit, confirm, then mark noscore; called from `runWizardDebugMenu` (`:353-359`). |
| `player_book_has_unlearned_spells` | 103 | MISSING | `reference/src/player-util.c:1315-1346`. Should scan pack/floor books for a study-able spell. Status line only takes a dep defaulting to `true` (`display.ts:147,212,718`); web `displayDeps()` never supplies a real scan (`main.ts:4701-4702`). |
| `player_resting_is_special` | 105 | PORTED | `reference/src/player-util.c:1382-1391`. `playerRestingIsSpecial` in `loop.ts:157-159`; mirrored in web `restingIsSpecial` (`main.ts:3498-3504`). Live for regen and rest UI. |
| `player_is_resting` | 106 | PORTED | `reference/src/player-util.c:1397-1401`. `playerIsResting` (`loop.ts:177-181`) gates noise/scent skip; driven by `state.resting` from web `driveRest`. |
| `player_resting_count` | 107 | INLINED | `reference/src/player-util.c:1406-1409`. `state.resting.count` (`context.ts:479`; web `driveRest` `main.ts:3617`). Display may pass `restingCount` for the status line. |
| `player_resting_set_count` | 108 | INLINED | `reference/src/player-util.c:1425-1445`. Web `driveRest` assigns `{ count, turnsRested }` with 9999 cap / special validation (`main.ts:3606-3618`). |
| `player_resting_cancel` | 109 | INLINED | `reference/src/player-util.c:1450-1455`. `disturb` deletes `state.resting` (`player-path.ts:99-102`); rest loop `finally` clears it (`main.ts:3673`). |
| `player_resting_can_regenerate` | 110 | PORTED | `reference/src/player-util.c:1461-1465`. `playerRestingCanRegenerate` (`loop.ts:167-171`) doubles HP/mana regen; live when web sets `state.resting`. |
| `player_resting_step_turn` | 111 | INLINED | `reference/src/player-util.c:1472-1489`. Web rest loop decrements count, bumps `turnsRested`, spends a hold turn (`main.ts:3644-3652`). |
| `player_resting_complete_special` | 112 | INLINED | `reference/src/player-util.c:1495-1520`. `restingCompleteSpecial` (`main.ts:3523-3550`) mirrors REST_ALL/COMPLETE/SOME conditions including `PF_COMBAT_REGEN` and timed/recall checks. |
| `player_get_resting_repeat_count` | 113 | INLINED | `reference/src/player-util.c:1530-1533`. Web module `restRepeatCount` (`main.ts:3495,3611-3612`). |
| `player_set_resting_repeat_count` | 114 | INLINED | `reference/src/player-util.c:1541-1544`. Same `restRepeatCount` write when `n > 1` (`main.ts:3611`). |
| `player_of_has` | 115 | PORTED | `reference/src/player-util.c:1549-1553`. Canonical live read: `playerOfHasWorld` (`world.ts:117-119` → `state.playerState.flags`); also local helpers in player-side/mon-side/effect-general; live combat/regen/fear paths use it. |
| `player_place` | 118 | PORTED | `reference/src/player-util.c:1574-1587`. `placePlayer` (`context.ts:1014-1017`); used on level populate (`session/game.ts:1634`) and arena. Arrival stair flags cleared on change (`session/game.ts:1808-1814`). |
| `player_handle_post_move` | 119 | PORTED | `reference/src/player-util.c:1598-1635`. Trap half: `onPlayerMoved` → `hitTrap` (`trap.ts:752-755`); FOV/`squareKnowPile` via `updateFov`/`noteSpots` (`known.ts:739-767`); store enter in shell after move (`main.ts:5405-5413`). Free `search()` is a separate entry (below). |
| `search` | 122 | MISSING | `reference/src/player-util.c:1680-1716`. Should auto-reveal adjacent secret doors and known chest traps after move / hold / new level. No port body; `"search"` remains a stub action; post-move does not call this logic. |
| `player_has_monster_in_view` | 123 | MISSING | `reference/src/player-util.c:1721-1733`. C only call sites: explore / navigate-up / navigate-down refuse with “Something is here.” (`cmd-cave.c:1428,1474,1525`). Port `exploreAction` (`player-path.ts:929-931`) has no such gate. Rest uses a looser `MFLAG.VISIBLE` check, not this function’s sites. |

## MISSING findings

### W1-player-util-001  death_knowledge
```
ref:      reference/src/player-util.c:281
port:     packages/web/src/main.ts:5355 (historyUnmaskUnknown); :5371 (enterScore); player/history.ts:198
missing:  On death, C also (1) for total winners sets depth 0, died_from WINNING_HOW, exp/lev to max, +10M gold; (2) player_learn_all_runes; (3) object_flavor_aware + known effect/activation for every gear and home item; then history unmask + enter_score.
effect:   Death memorial / char dump can leave inventory and home items unidentified; retiring winners do not get the C retirement package before scoring.
severity: P2
confidence: high
```

### W1-player-util-002  player_get_recall_depth
```
ref:      reference/src/player-util.c:100
port:     none (recall always maxDepth: loop.ts:468-470; handleRECALL has no persist branch)
missing:  When birth_levels_persist is on and the player recalls from town, C prompts for a previously visited depth (chunk_list) and writes recall_depth; cancel aborts activation.
effect:   With persistent levels, Word of Recall from town cannot choose a visited depth and always targets maxDepth.
severity: P2
confidence: high
```

### W1-player-util-003  player_can_read
```
ref:      reference/src/player-util.c:1166
port:     none on the read path (obj-cmd.ts "read" → useAux)
missing:  Gate that refuses scroll reading when blind, without light, confused, or under amnesia, with the C messages.
effect:   Players can read scrolls while blind, in the dark, confused, or amnesiac — wrong normal-play behaviour.
severity: P1
confidence: high
```

### W1-player-util-004  player_book_has_unlearned_spells
```
ref:      reference/src/player-util.c:1315
port:     display.ts:147,718 (dep only; defaults true); web displayDeps never computes it
missing:  Scan of inventory/floor books for any spell_okay_to_study when new_spells > 0; drives Study status colour (white vs dark).
effect:   Status line “Study (N)” stays bright white even when no carried book has a learnable spell (cosmetic).
severity: P3
confidence: high
```

### W1-player-util-005  search
```
ref:      reference/src/player-util.c:1680
port:     none (called from player_handle_post_move, do_cmd_hold, on_new_level)
missing:  Adjacent secret-door reveal (place_closed_door + message) and trapped-chest pval discovery after every move, stand-still, and level entry (when not blind/no-light/confused/image).
effect:   Secret doors are not found by walking/holding nearby; chest traps are not auto-noticed on adjacent known chests — only detect/open/disarm paths remain.
severity: P2
confidence: high
```

### W1-player-util-006  player_has_monster_in_view
```
ref:      reference/src/player-util.c:1721
port:     none at explore/navigate sites (exploreAction at player-path.ts:929)
missing:  obvious+in-view monster screen that aborts explore/navigate-up/navigate-down with “Something is here.”
effect:   Explore (and any future navigate-up/down wiring) can start a path while a known monster is in view.
severity: P2
confidence: high
```

## Counts

| verdict | count |
|---|---:|
| PORTED | 13 |
| INLINED | 11 |
| N/A | 5 |
| MISSING | 6 |
| UNSURE | 0 |
| **Total** | **35** |

Adjudication only — allowlist JSON and port sources were not modified; nothing committed.

---

## Gate notes (Opus, 2026-07-25)

**`search` (W1-player-util-005) severity raised P2 -> P1.** Verified against the
C: `reference/src/player-util.c:1680-1715` reveals adjacent secret doors
(`place_closed_door` + "You have found a secret door.") and discovers traps on
adjacent known chests, gated only on blind / no-light / confused / hallucinating.
It is called from three live sites — `player-util.c:1634`
(`player_handle_post_move`), `cmd-cave.c:1586` (`do_cmd_hold`), and
`game-world.c:1052`.

The port reveals secret doors **only** through `EF_DETECT_DOORS`
(`packages/core/src/game/effect-detect.ts:227`); `squareIsSecretDoor`
(`game/cave-cmd.ts:207`) is used only to decide diggability. So walking past a
secret door never finds it, and chest traps are never noticed passively.

That is a missing mechanic rather than an edge case: the generator places secret
doors, upstream players find them by walking, and in the port they stay hidden
unless the player happens to have a detection source or digs. Level layouts are
effectively different. P1.
