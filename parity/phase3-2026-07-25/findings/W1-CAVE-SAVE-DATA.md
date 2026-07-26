# W1 lane C — `cave-square.c` / `save.c` / `load.c` / `datafile.c`

**Date:** 2026-07-26
**Worktree:** `C:\Repositories\na-wt-csd` (`p4/w1-cavesave`)
**Oracle:** Angband 4.2.6 under `reference/` (read-only; `git diff master -- reference/` empty)
**Scope:** the 86 symbols in `w1-cavesave.tsv` — `cave-square.c` (24 non-static + 2 static),
`save.c` (16 + 6), `load.c` (16 + 7), `datafile.c` (15). Nothing else.

## Result

All 86 adjudicated. Per-file breakdown, so the arithmetic is checkable:

| File | symbols | `PRESENT-RENAMED` | `COVERED-IN-EFFECT` | `N/A-BY-SCOPE` | `GAP` |
|---|---:|---:|---:|---:|---:|
| `cave-square.c` | 26 | 11 | 10 | 3 | 2 |
| `save.c` | 22 | 20 | 0 | 1 | 1 |
| `load.c` | 23 | 2 | 19 | 1 | 1 |
| `datafile.c` | 15 | 2 | 3 | 10 | 0 |
| **Total** | **86** | **35** | **32** | **15** | **4** |

**4 GAP symbols across 3 findings**, all reported and **not** fixed (rule 8):

| id | symbols | one line |
|---|---|---|
| **W1-CAVE-SAVE-001** | `square_ismark` | `wizLightLevel` omits `wiz_light`/`wiz_dark`'s mark → forget-misremembered phase, and its memorize gate; `wiz_dark` additionally forgets the map where upstream memorizes it. |
| **W1-CAVE-SAVE-002** | `wr_ignore`, `rd_ignore` | The rune auto-inscription block is not saved. A character who inscribed runes loses those inscriptions on reload. |
| **W1-CAVE-SAVE-003** | `square_unlock_door` | Upstream keeps the "door lock" trap at power 0; the port deletes the trap. Narrow blast radius, but a real divergence. |

Note on table scope: the `save.c` table below also carries rows for `wr_item`,
`wr_monster`, `wr_randomizer`, `wr_messages`, `wr_player`, `wr_stores` and
`wr_chunks`, which are **not** among my 86 (the mechanical pass already matched
them). They are included because the new guard covers all 29 `wr_*` blocks and
the block map has to be complete to be enforceable; they are excluded from the
counts above.

Deliverables landed:

- **Citation comments** at every `PRESENT-RENAMED` / `COVERED-IN-EFFECT` counterpart
  (17 production files, comment-only — `git diff` shows zero non-comment additions
  outside the new test).
- **`packages/core/src/session/save-fields.test.ts`** — the C-derived save
  field-coverage guard (10 tests). Master had no such guard: `save.test.ts` is 43
  hand-written per-feature assertions, so a dropped field is silent there. Four
  bite proofs below.

---

# Problem 2 — `save.c` (22) / `load.c` (23): a shape mismatch

Upstream serialises to a binary block stream (`wr_byte`/`wr_u16b`/…) with a
per-block loader table (`savefile.c` `savefile_blocks[]`). The port writes one
JSON document to `localStorage` (decision 6.3 / 9). There is therefore by design
no `wr_monster`/`rd_monster` pair, and symbol presence is the wrong question.
The question adjudicated here is: **does the port round-trip every field this C
function writes/reads?**

Every row below is now mechanically enforced, not just asserted in prose. See
[the guard](#the-guard) — its `BLOCKS` table is this table in executable form.

## `save.c`

| C symbol | C line | verdict | evidence |
|---|---:|---|---|
| `wr_description` | 49 | N/A-BY-SCOPE | Writes one display string: `"<full_name>, L<lev> <race> <class>, at DL<depth>"` (`save.c:52-63`). Every input is separately persisted (`SavedPlayer.fullName/.lev/.raceName/.clsName`, `SavedGame.dungeonDepth`/`chunk.depth`), so the string is rebuilt on demand. Upstream uses it only for the savefile-list description (`savefile.c` header block). |
| `wr_item` (static) | 72 | PRESENT-RENAMED | `serializeObject` / `deserializeObject`, `session/save.ts:165/254`. All 52 write sites mapped: 31 field paths asserted present + 5 mutation-survival probes in the guard. `obj->oidx` (`save.c:76`) is N/A — the port has no `c->objects[]` index (`game/floor.ts:18-21` documents the pile Map as the object list). `tval`/`sval` names (`save.c:83-92`) collapse into `kindId`. |
| `wr_monster` (static) | 204 | PRESENT-RENAMED | `serializeMonster` / `deserializeMonster`, `session/save.ts:407/438`. All 21 write sites mapped incl. `known_pstate.flags` (`save.c:231`) → `knownPstateFlags` and `known_pstate.el_info[].res_level` (`save.c:234`) → `knownPstateElInfo`, and both `group_info[]` entries (`save.c:249-252`) → `groupInfo`. Port additionally saves `cdis`/`attr`/`target`/`minRange`/`bestRange`, which C recomputes — a superset, harmless. |
| `wr_trap` (static) | 261 | PRESENT-RENAMED | `SavedTrap` + `deserializeTraps`, `session/save.ts:799/1497`. All 7 write sites: `trap_info[t_idx].desc` → `trapId`, `grid.y/x` → `grid`, `power`, `timeout`, `flags[]`. |
| `wr_randomizer` | 286 | N/A-BY-SCOPE | Writes `Rand_value`, `state_i`, `STATE[RAND_DEG]` and 27 words of back-compat padding (`save.c:293-311`) — the internals of upstream's own RNG. The port persists its own `RngState` (`SavedGame.rng`); `save.test.ts` "resumes the exact RNG stream" proves the stream is identical after reload, which is the property `wr_randomizer` exists to give (decisions 16/22). |
| `wr_options` | 314 | PRESENT-RENAMED | `SavedGame.options` = `OptionStateData` (`player/options.ts:52-63`): `values` (the `option_name`/value loop, `save.c:327-333`), `birth`, `hitpointWarn`, `delayFactor`, `lazymoveDelay`. `SIDEBAR_MODE` (`save.c:320`) is a `ui-term.h` global, N/A. `rd_options`' `option_set(name, …)` name-keying is matched: the port keys options by name too, so an unknown option is skipped identically. |
| `wr_messages` | 339 | PRESENT-RENAMED | `serializeMessages` / `deserializeMessages` (`session/save.ts:1032/1052`) → `SavedGame.messages`. Both upstream quirks preserved and tested in `save.test.ts`: the 80-message cap (`save.c:344`) and the oldest-first dump order (`save.c:349`, the `i = num - 1` down-loop), and the per-entry repeat count is deliberately NOT written because `wr_messages` writes only `message_str`/`message_type`. Not one of my 86 (already matched mechanically); listed for block-map completeness. |
| `wr_monster_memory` | 356 | PRESENT-RENAMED | `SavedGame.lore` (`session/save.ts:1306`), keyed by monster race id. Upstream splits lore between the savefile (`pkills`/`thefts` only, `save.c:368-369`) and the user `lore.txt`; the JSON save carries the whole `MonsterLore` record, a strict superset. `MFLAG_SIZE` (`save.c:358`) and the `"No more monsters"` sentinel are binary framing. |
| `wr_object_memory` | 377 | PRESENT-RENAMED | The five `tmp8u` bits (`save.c:399-407`) map to: `aware` → `flavor.aware`, `tried` → `flavor.tried`, `everseen` → `everseen.kinds`, `kind_is_ignored_aware` → `ignore.kindAware`, `kind_is_ignored_unaware` → `ignore.kindUnaware`. The `OF_SIZE`/`OBJ_MOD_MAX`/`ELEM_MAX`/`brand_max`/`slay_max`/`curse_max` header bytes (`save.c:381-387`) are array-size checks `rd_object_memory` (`load.c:559-600`) uses to reject an incompatible savefile — self-describing in JSON. |
| `wr_quests` | 405 | PRESENT-RENAMED | `SavedPlayer.quests` (`session/save.ts:589`): `level` and `cur_num` per quest. `z_info->quest_max` is the array length. |
| `wr_player` | 418 | PRESENT-RENAMED | The biggest block: 54 write sites. 42 field paths asserted present + 24 mutation-survival probes. N/A parts, each with its citation: `player->body` name/count/slots (`save.c:456-461`) is always `bodies[race->body]` — `player-birth.c:376` and `main-stats.c:465` are its *only* assignments in the whole tree, so deriving it from the restored race (`deserializePlayer`, `save.ts:681`) is exact; the padding writes `wr_s16b(0)` (`:453`), `wr_u32b(0)` (`:463`) and the two `/* oops */` zeroes (`:486-487`); and the 8-word future-use tail (`:509`). `old_grid` (`:484-485`) → `SavedGame.arena.oldGrid`, written only while `arenaLevel` is set, matching upstream's single-combat use. |
| `wr_ignore` | 514 | **GAP** (partial) | Covered: `ignore_level[]` → `ignore.level`; ego `everseen` → `everseen.egos`; the per-ego `ITYPE_*` ignore bitmask (`save.c:534-541`) → `ignore.ego` as `"eidx:itype"` keys (`obj/ignore.ts:240,297`); `note_aware`/`note_unaware` (`save.c:552-585`) → `SavedGame.autoinscriptions`. **Not covered: the rune auto-inscription block** (`save.c:586-605` — `max_runes()`, `rune_note(k)`), which `rd_ignore` reads back through `rune_set_note` (`load.c:937-945`). See W1-CAVE-SAVE-002. |
| `wr_misc` | 610 | PRESENT-RENAMED | 19 write sites: `seed_randart` → `randartSeed`, `seed_flavor` → `seedFlavor`, `total_winner` → `player.totalWinner`, `noscore` → `player.noscore`, `is_dead` → `isDead`, `turn` → `turn`, and the whole `player->obj_k` rune-knowledge record (`save.c:634-673`) → `player.objKnown.{flags,modifiers,elInfo,brands,slays,curses,ac,toA,toH,toD,dd,ds}`. |
| `wr_artifacts` | 674 | PRESENT-RENAMED | `aup_info[].created/seen/everseen` → `artifactsCreated` / `artifactsSeen` / `artifactsEverseen`, each an id list rather than a by-`aidx` boolean array so the set survives pack reordering (`session/save.ts:1112/1124`). The fourth per-artifact byte (`save.c:686`) is a literal 0 read into nothing. |
| `wr_player_hp` | 692 | PRESENT-RENAMED | `SavedPlayer.playerHp` (`session/save.ts:522`). `PY_MAX_LEVEL` is the length; `rd_player_hp` (`load.c:1066-1088`) rejects a mismatch, and `PY_MAX_LEVEL` is a compile-time constant in both trees (`player/types.ts`). |
| `wr_player_spells` | 702 | PRESENT-RENAMED | `SavedPlayer.spellFlags` / `.spellOrder`. `total_spells` is the array length. |
| `wr_gear_aux` (static) | 715 | PRESENT-RENAMED | `SavedGame.gear` = `{next, pack, store}` plus `SavedPlayer.equipment` — upstream's `object_slot(player->body, obj)` byte (`save.c:724`) is exactly the port's equipment slot map. The `FINISHED_CODE` terminator is binary framing. |
| `wr_gear` | 737 | PRESENT-RENAMED / N/A | `wr_gear_aux(player->gear)` → `SavedGame.gear`. `wr_gear_aux(player->gear_k)`, the parallel *known*-gear list, is the `obj->known` twin the port deliberately does not keep (`obj/knowledge.ts:22-26`, ledgered in `parity/ledger/obj-knowledge.yaml`). |
| `wr_stores` | 744 | PRESENT-RENAMED | `serializeStores` / `deserializeStores`, `session/save.ts:1547/1567`: `store->owner->oidx` → `ownerIndex`, `store->stock` → `stock` (head-first), positional keying preserved. `wr_item(obj->known)` beside each `wr_item(obj)` (`save.c:762-763`) is the known twin again. |
| `wr_dungeon_aux` (static) | 774 | PRESENT-RENAMED | `Chunk.snapshotSquares()` → `ChunkSquaresData` (`world/chunk.ts:458-513`): `name`, `height`, `width`, `info[]`, `feat[]`, `feeling`, `feeling_squares`, `turn`. The RLE (`save.c:783-841`) is byte-stream compression; the JSON stores the arrays directly. `c->join` + its `0xff` sentinel (`save.c:846-865`) → `SavedGame.currentJoins` / `SavedStoredLevel.join`. `c->feat_count[]` is recomputed by `restoreSquares`. **The C comment at `save.c:770-772` states cost/when (noise/scent) are deliberately NOT saved — the port matches, and carries them only under the opt-in `bugfix.noiseScentSave` mod** (`save.test.ts` "bug-fixes #4605" asserts both directions). |
| `wr_objects_aux` (static) | 873 | PRESENT-RENAMED | `SavedGame.floor` (`session/save.ts:1244-1256`): pile order preserved head-first, keyed by grid. `c->obj_max` and the dummy `0xffff` terminator are framing. The second loop (`save.c:891-903`) writes known objects whose location is unknown and imagined twins — both belong to the shadow-cave model the port does not have. |
| `wr_monsters_aux` (static) | 915 | PRESENT-RENAMED | `SavedGame.monsters` + `.groups`. `cave_monster_max(c)` is the array length. |
| `wr_traps_aux` (static) | 933 | PRESENT-RENAMED | `SavedGame.traps`. `TRF_SIZE` and the dummy terminator trap are framing. |
| `wr_dungeon` | 959 | PRESENT-RENAMED | `player->depth` → `dungeonDepth` (dead saves) / `chunk.depth`, `daycount` → `daycount`, `player->grid` → `actor.grid`. `SQUARE_SIZE` (`:966`) is an array-size header. The `is_dead` early return at `save.c:968-969` is reproduced at `session/save.ts:1196-1199` and asserted by the guard's dead-save test. |
| `wr_objects` | 980 | PRESENT-RENAMED / N/A | `wr_objects_aux(cave)` → `floor`; `wr_objects_aux(player->cave)` is the shadow cave. |
| `wr_monsters` | 986 | PRESENT-RENAMED / N/A | Same split. |
| `wr_traps` | 992 | PRESENT-RENAMED / N/A | Same split. |
| `wr_chunks` | 1001 | PRESENT-RENAMED | `SavedGame.levelCache` (`SavedStoredLevel`, `session/save.ts:1652`) under `birth_levels_persist`, exercised by `persist-levels.test.ts`; and `SavedGame.townChunk`/`townFeatLegend` for the Town entry upstream stores even with the option OFF (`generate.c:1371-1373`). The per-chunk persist tail (`save.c:1029-1043`: name/turn/depth/feeling/obj_rating/mon_rating/good_item/height/width/feeling_squares/feat_count) is entirely inside `ChunkSquaresData`, `feat_count` recomputed. |
| `wr_history` | 1048 | PRESENT-RENAMED | `SavedPlayer.hist` (`SavedHistoryInfo`, `session/save.ts:601`): `type[]`, `turn`, `dlev`, `clev`, `a_info[a_idx].name` → `artifactName` (a *name*, matching `save.c:1063-1067`), `event`. `HIST_SIZE` and the length prefix are framing. |

## `load.c`

`load.c` is the mirror of `save.c` plus per-block **validation and repair**. The
serialisation half is adjudicated above; the rows below record whether the
repair logic is ported, which is the part a JSON reader can still get wrong.

| C symbol | C line | verdict | evidence |
|---|---:|---|---|
| `rd_item` (static) | 99 | PRESENT-RENAMED | `deserializeObject` (`session/save.ts:260`). Re-resolves kind/ego/artifact/origin-race by namespaced id rather than by name string, the port's stronger form of the same "data + pack, never code" contract. |
| `rd_options` | 424 | COVERED-IN-EFFECT | `OptionState` restore. `load.c:432-440` reads `delay_factor`/`hitpoint_warn`/`lazymove_delay` — all three in `OptionStateData` (`player/options.ts:52-63`) and all three mutation-probed by the guard. `load.c:452-462`'s name-keyed `option_set` loop tolerates unknown names; the port's name-keyed `values` record does the same. `SIDEBAR_MAX` clamp (`:445`) is UI. |
| `rd_object_memory` | 548 | COVERED-IN-EFFECT | The six size guards (`load.c:557-600`) reject a savefile whose `OF_SIZE`/`OBJ_MOD_MAX`/`ELEM_MAX`/`brand_max`/`slay_max`/`curse_max` exceed the build's. The port's equivalent is `SAVE_VERSION` rejection plus per-id resolution: an unresolvable brand/slay/curse id is quarantined by `mod/save-blocks.ts` rather than silently truncated. Same protective intent, stricter mechanism. |
| `rd_quests` | 623 | COVERED-IN-EFFECT | `player_quests_reset` then per-quest `level`/`cur_num` (`load.c:632-644`). Port: `blankPlayer` seeds the reset quest table and `deserializePlayer` (`save.ts:747`) overlays the saved rows. `save.test.ts` "round-trips the quest history and the total_winner flag" and "an old save without a `quests` field loads with no quests" cover both. |
| `rd_player` | 651 | PRESENT-RENAMED | `deserializePlayer` (`session/save.ts:681`). All four repairs ported, each with its citation already in the code: level range `1..PY_MAX_LEVEL` (`load.c:767-780` → `save.ts:692-694`), `max_lev < lev` (`:785` → `:696`), `max_depth < 0` and `recall_depth <= 0` (`:788-789` → `:705-708`), `died_from` reset when `chp >= 0` (`:791-793` → `:724`). The timed-effect truncation (`load.c:807-823`) is `save.ts:714`. |
| `rd_ignore` | 846 | **GAP** (partial) | See `wr_ignore` above and W1-CAVE-SAVE-002: the rune-note read loop (`load.c:937-945`) has no counterpart. The ignore-byte-count `strip_bytes` fallback (`:857-863`) and the `itype_size` change guard (`:882-887`) are binary-stream robustness with no JSON analogue. |
| `rd_misc` | 951 | COVERED-IN-EFFECT | Mirror of `wr_misc`, adjudicated above. Its only repair is the `noscore` read (`load.c:966`) — `save.test.ts` "wizard-mode load of a dead character resurrects and marks NOSCORE_WIZARD (savefile.c:647-651)" covers the live consequence. |
| `rd_artifacts` | 1036 | COVERED-IN-EFFECT | `deserializeArtifactsCreated` / `deserializeArtifactFlags` (`session/save.ts:1598/1613`). `load.c:1044-1047` errors when the file has more artifacts than the build; the port's id-list form makes that unrepresentable — an unknown artifact id is simply absent from the set. |
| `rd_player_hp` | 1066 | COVERED-IN-EFFECT | `load.c:1072-1076` rejects a `PY_MAX_LEVEL` mismatch. `PY_MAX_LEVEL` is a build constant in both trees (`player/types.ts`), and `playerHp` round-trips as a plain array (guard: `wr_player_hp` presence). |
| `rd_player_spells` | 1089 | COVERED-IN-EFFECT | `spellFlags`/`spellOrder` round-trip. `load.c:1096-1099`'s `total_spells` mismatch check is subsumed by class rebinding: `deserializePlayer` resolves the class by name and `blankPlayer` sizes the arrays from it. |
| `rd_gear_aux` (static) | 1124 | COVERED-IN-EFFECT | `deserializeGear` (`session/save.ts:1467`) + `player.equipment`. `load.c:1147-1160`'s "wield it into the slot the byte names, else pack it" logic is the same slot map. |
| `rd_gear` | 1167 | COVERED-IN-EFFECT | `player->gear` restored; `player->gear_k` is the known twin (N/A, ledgered). |
| `rd_stores_aux` (static) | 1196 | COVERED-IN-EFFECT | `deserializeStores` (`session/save.ts:1570`) — and it explicitly draws **no** RNG, so a store restore cannot perturb the recovered stream (decision 22). `save.test.ts` "persists the home stash, shop stock and the current owner across save/load". |
| `rd_dungeon_aux` (static) | 1287 | COVERED-IN-EFFECT | `Chunk.restoreSquares` (`world/chunk.ts:481`) + `deserializeChunk` (`save.ts:1631`), including the feature remap through `featLegend` — the port's answer to `load.c:1653-1678`, which remaps a saved feat index through the current feature table. `load.c:1366-1383`'s connector read is `deserializeLevelCache`'s `join` branch (`save.ts:1873-1877`). |
| `rd_dungeon` | 1508 | COVERED-IN-EFFECT | The header (`depth`/`daycount`/player grid/`square_size`) plus `is_dead` short-circuit; see `wr_dungeon`. The guard's dead-save test asserts the port's short-circuit shape. |
| `rd_objects_aux` (static) | 1394 | COVERED-IN-EFFECT | `deserializeFloor` (`session/save.ts:1480`). `load.c:1414-1428`'s oidx relinking is the shadow-cave bookkeeping the port replaces with the pile Map. |
| `rd_objects` | 1562 | COVERED-IN-EFFECT | As above; the `player->cave` pass is N/A. |
| `rd_monsters_aux` (static) | 1432 | COVERED-IN-EFFECT | `deserializeMonster` + `monsterGroupsVerify` — and `save.test.ts` "restores the player, world and entities exactly" runs `monsterGroupsVerify(rs)`, which is exactly the integrity `load.c:1461-1470` (`monster_group_integrity_check`) asserts. |
| `rd_monsters` | 1575 | COVERED-IN-EFFECT | As above. |
| `rd_traps_aux` (static) | 1473 | COVERED-IN-EFFECT | `deserializeTraps` (`session/save.ts:1497`), trap kind re-resolved by id. |
| `rd_chunks` | 1623 | COVERED-IN-EFFECT | `deserializeLevelCache` (`session/save.ts:1746`) + `townChunk` restore; `persist-levels.test.ts` "restores an identical frozen level on re-entry (option ON)". |
| `rd_history` | 1715 | COVERED-IN-EFFECT | `deserializePlayer`'s `hist` loop (`save.ts:726-741`), which looks the artifact up **by name** and drops an entry naming an artifact the pack no longer has — the id-stable form of `load.c:1749-1757`. `save.test.ts` "round-trips the character history log (player.hist), incl. a LOST entry". |
| `rd_null` | 1766 | N/A-BY-SCOPE | `load.c:1766-1768` is a two-line stub (`strip_bytes(0)`) registered so `savefile_blocks[]` can skip a retired block without a reader. There are no retired blocks in a JSON document with no block table. |

### Fields verified present but with a caveat worth flagging

- `ignore.ego` keys are `"<eidx>:<itype>"` and `ignore.kindAware`/`.kindUnaware`
  are raw `kidx` arrays (`obj/ignore.ts:297-310`), i.e. **raw content indices**,
  where every other reference in the save was converted to a namespaced id
  (`SAVE_VERSION` 2's stated rule, `save.ts:104-113`). A pack reorder would
  therefore mis-target ignore settings. This is outside my symbol scope
  (`obj-ignore.c`), so it is **reported, not fixed** — see "Out-of-scope defects".

---

# Problem 1 — `cave-square.c` (26): mostly renames, each body checked

Every predicate below was adjudicated on its **body**, not on a same-named
method existing. Where the port has no named function, the row names the
expression that *is* the predicate and the live call sites.

| C symbol | C line | verdict | evidence |
|---|---:|---|---|
| `square_istrappable` | 220 | PRESENT-RENAMED | C: `feat_is_trap_holding(feat)`. Port: `Chunk.isTrapHolding` (`world/chunk.ts:293`, now cited) over `featIsTrapHolding` (`chunk.ts:50` → `TF.TRAP`). Live at all three C call sites: `effect-handler-general.c:714` → `effect-general.ts:174` (EF_GLYPH's "no clear floor"), `trap.c:269` → `squarePlayerTrapAllowed` `game/trap.ts:270`, `obj-pile.c:1265` → the `onFeatSet` trap side effect (`trap.ts:198`). Flag identity verified: `TF.TRAP` index matches `list-terrain-flags.h`. |
| `square_isoccupied` | 391 | COVERED-IN-EFFECT | C: `square->mon != 0` (player is `-1`, monsters `>= 1`). Port inlines it as `squareMonster(state, grid) !== null \|\| squareIsPlayer(state, grid)` at `game/project-feat.ts:325-326` (now cited) — the cold-solidifies-lava branch, which is `project-feat.c:353` and `:463`, the only two live C callers. The third caller, `gen-util.c:1090`, is inside the ASCII level-dump debug printer (UI). |
| `square_ismark` | 424 | **GAP** | C: `sqinfo_has(info, SQUARE_MARK)`. `SQUARE.MARK` exists in the port (`generated/square-flags.ts:41`) and `sqinfoHas` can read it, but **no code does**. Its only purpose upstream is the `wiz_light`/`wiz_dark` forget-misremembered phase (`cave-map.c:453-458`, `:524-529`), which `wizLightLevel` does not implement. See W1-CAVE-SAVE-001. |
| `square_wasseen` | 474 | COVERED-IN-EFFECT | C: `sqinfo_has(info, SQUARE_WASSEEN)`; the only callers are `cave-view.c:845` and `:862`. Port: `c.sqinfoHas(grid, SQUARE["WASSEEN"])` at `world/view.ts:472` (now cited) with the matching set/clear at `view.ts:226` (`markWasseen`) and `:483`. |
| `square_isfeel` | 482 | COVERED-IN-EFFECT | C: `SQUARE_FEEL`. Port: set by `placeFeeling` (`gen/generate.ts:280`), read and cleared in the feeling reveal (`world/view.ts:473-474`, now cited). |
| `square_isinvis` | 498 | COVERED-IN-EFFECT | C: `SQUARE_INVIS`, the unknown-trap mark. Port: `sqinfoHas(grid, SQUARE.INVIS)` at `game/display.ts:787` (now cited), the same `prt_terrain` gate as `ui-display.c:1191`. The flag is wizard-only in both trees, so the read is the whole live surface. |
| `square_ismon_restrict` | 530 | COVERED-IN-EFFECT | C: `SQUARE_MON_RESTRICT`. Port: set by `generateMark` at `gen/room.ts:617` and `gen/gen-monster.ts:556`, read at `gen/util.ts:2040`, cleared end-of-gen at `gen/generate.ts:258` (now cited). Same lifecycle as `generate.c`. |
| `square_isno_teleport` | 538 | COVERED-IN-EFFECT | C: `SQUARE_NO_TELEPORT`. Port: `sqinfoHas(start, SQUARE.NO_TELEPORT)` at `game/effect-teleport.ts:238` (now cited), `:337`, `:398` — matching all three C callers (`effect-handler-general.c:2549`, `:2746`, `:2862`). |
| `square_isno_map` | 546 | COVERED-IN-EFFECT | C: `SQUARE_NO_MAP`. Port: the `mapArea` skip at `game/effect-detect.ts:104` (now cited); set on gauntlet generation (`gen/cave.ts:1763`). |
| `square_isnoflow` | 738 | PRESENT-RENAMED | C: `feat_is_no_flow(feat)`. Port: `featIsNoFlow` (`world/chunk.ts:103`, now cited), live in `makeNoise` (`world/flow.ts:66`). |
| `square_isnoscent` | 746 | PRESENT-RENAMED | C: `feat_is_no_scent(feat)`. Port: `featIsNoScent` (`world/chunk.ts:108`, now cited), live in `updateScent` (`world/flow.ts:111`). |
| `square_issecrettrap` | 815 | COVERED-IN-EFFECT | C: `!square_isvisibletrap && square_isplayertrap`; sole caller `cave-map.c:236` (`square_note_spot`). Port: `noteSpotRevealTrap` (`game/trap.ts:447`, now cited) checks only `squareIsPlayerTrap`, because the `!visible` half is absorbed into `squareRevealTrap` (`trap.ts:511-530`) — it counts only *newly*-revealed traps, so an already-visible grid is a silent no-op. **Flagged micro-divergence:** on a grid holding both a *visible* non-player trap (a glyph) and an *invisible* player trap, C's `square_isvisibletrap` is true for the whole grid and skips the reveal, while the port would reveal the player trap. Reaching that state needs a glyph cast onto an existing invisible trap; I did not find a code path that produces it, and I did not attempt to construct one. Low confidence that it is reachable at all; recorded rather than claimed. |
| `square_excise_pile` | 1031 | COVERED-IN-EFFECT | C: `object_pile_free(...)` then `square_set_obj(c, grid, NULL)`. Port: the caller-side loop `for (const obj of [...floorPile(state, grid)]) floorExcise(state, grid, obj)` at `game/effect-terrain.ts:486-500` (now cited, the `*DESTRUCTION` path) and `game/project-feat.ts:79-82` (`pushObject`, now cited). `floorExcise` deletes the Map entry when the pile empties (`game/floor.ts:95`), which *is* the `square_set_obj(NULL)`. |
| `square_excise_all_imagined` | 1051 | N/A-BY-SCOPE | Purges `OBJ_NOTICE_IMAGINED` twins from `player->cave`'s shadow object list. The port's knowledge layer is a per-grid glyph memory (`state.known.objects`, `game/known.ts`), not a shadow object cave; `OBJ_NOTICE.IMAGINED` is defined (`obj/knowledge.ts:60`) but **never set** anywhere in the port. Confirms the sibling lane's verdict in `W1-cave.md`. |
| `square_set_obj` | 1291 | N/A-BY-SCOPE | Sets the `square->obj` linked-list HEAD. Both C calls set it to `NULL` (`cave-square.c:1035`, `obj-pile.c:1201`). The port has no head pointer: the pile *is* the Map entry, so "set to NULL" is `state.floor.delete(key)` inside `floorExcise` (`game/floor.ts:95`, now cited). |
| `square_add_trap` | 1304 | PRESENT-RENAMED | C: `place_trap(c, grid, -1, c->depth)`. Port: `placeTrap(state, grid, -1, c.depth, env.trapDeps)` at `game/project-feat.ts:294` (now cited, `PROJ.MAKE_TRAP`) and the generation-time `placeTrap` (`gen/util.ts:1200`). |
| `square_add_web` | 1331 | PRESENT-RENAMED | C: `place_trap(c, grid, lookup_trap("web")->tidx, 0)`. Port: `placeTrap(state, grid, web.tidx, 0, trapDeps)` at `game/effect-general.ts:235` (now cited), inside `handleWEB`. |
| `square_add_door` | 1347 | PRESENT-RENAMED | C: `set_feat(closed ? FEAT_CLOSED : FEAT_OPEN)`. Port: `setFeat(FEAT.CLOSED)` at `game/project-feat.ts:282` (`PROJ.MAKE_DOOR`, now cited) and `gen/util.ts:1170` (`placeClosedDoor`); `setFeat(FEAT.OPEN)` at `project-feat.ts:76` (`pushObject`, the `closed=false` caller `obj-pile.c:1205`, now cited) and `gen/util.ts:1178`. |
| `square_close_door` | 1361 | PRESENT-RENAMED | C: asserts open, then `set_feat(FEAT_CLOSED)`. Port: `closeAux` `game/cave-cmd.ts:364` (now cited); the assertion becomes the `squareIsOpenDoor \|\| squareIsBrokenDoor` gate at `:350` with the broken-door message branch, matching `cmd-cave.c do_cmd_close_aux`. |
| `square_unlock_door` | 1377 | **GAP** (narrow) | C: `square_set_door_lock(c, grid, 0)` — `trap.c:706-726` *keeps* the "door lock" trap and sets its `power` to 0. Port (`game/project-feat.ts:251-253`, `PROJ.KILL_TRAP`, now cited with the divergence): `squareRemoveAllTraps(state, grid, lock.tidx)`, deleting the trap. `squareDoorPower` reads 0 either way, so `square_islockeddoor` agrees; the observable differences are that a power-0 lock is a live trap object for `square_istrap`/`squarePlayerTrapAllowed` and for the trap save block. See W1-CAVE-SAVE-003. |
| `square_destroy_door` | 1382 | PRESENT-RENAMED | C: remove all "door lock" traps, then `set_feat(FEAT_FLOOR)`. Port: `setFeat(FEAT.FLOOR)` at `game/project-feat.ts:237-240` (`PROJ.KILL_DOOR`, now cited). The lock removal is *not* dropped: `Chunk.setFeat` runs `onFeatSet` on the live cave (`world/chunk.ts:231`), which is `squareSetFeatTrapSideEffect` (`game/trap.ts:198`) destroying every trap on a grid that is no longer `squarePlayerTrapAllowed` — and `FEAT_FLOOR` with a trap on it fails that. This is the faithful port of `cave-square.c:1256-1259`. |
| `square_tunnel_wall` | 1414 | PRESENT-RENAMED | C: `set_feat(FEAT_FLOOR)`; sole caller `cmd-cave.c:510` inside `twall`. Port: `twall` (`game/cave-cmd.ts:460`, now cited) with the same `isDiggable \|\| isClosedDoor` precondition as `cmd-cave.c:504-508`. |
| `square_destroy_rubble` | 1502 | PRESENT-RENAMED | C: asserts rubble, then `set_feat(FEAT_FLOOR)`. Port: the rubble arm of `PROJ.KILL_WALL`, `game/project-feat.ts:166` (now cited), reached only under `c.isRubble(grid)` at `:160` — the assertion as a guard. |
| `square_force_floor` | 1507 | COVERED-IN-EFFECT | C: bare `set_feat(FEAT_FLOOR)`; sole interesting caller `push_object` (`obj-pile.c:1204`) does force_floor then `square_add_door(false)`. Port: `pushObject` (`game/project-feat.ts:73-76`, now cited) collapses the pair into one `setFeat(FEAT.OPEN)`. Verified equivalent: the intermediate `FEAT_FLOOR` is never observed (no `onFeatSet` consequence differs — FLOOR is trap-holding, so no trap is destroyed at that step), and its `feat_count` delta cancels. Elsewhere `setFeat(FEAT.FLOOR)` is the force-floor. |
| `forget_remembered_objects` (static) | 1106 | N/A-BY-SCOPE | Walks `player->cave`'s shadow pile and excises/deletes any known twin whose original left the grid (`cave-square.c:1106-1145`), called from `square_sense_pile` (`:1156`) and `square_know_pile` (`:1186`). The port's knowledge is one glyph per grid, so the whole walk collapses to the "nothing here any more → delete the entry" branch at the tail of `squareKnowPile` (`game/known.ts:349-353`) and `squareSensePile` (`:493-497`) — now cited on `squareKnowPile`. |
| `square_set_known_feat` (static) | 1274 | PRESENT-RENAMED | C: `player->cave->squares[y][x].feat = feat` behind a `c != cave` guard; the static setter for `square_memorize` (`:1576`) and `square_forget` (`:1582`). Port: `squareMemorize` writes `state.known.feat[idx] = chunk.feat(grid)` (`game/known.ts:99-105`, now cited) and `squareForget` writes `-1`. The `c != cave` guard is structural — there is exactly one known map. |

---

# Problem 3 — `datafile.c` (15): checked against W5

`packages/content/src/data-exactness.test.ts` independently re-parses all 44
shipped `reference/lib/gamedata/*.txt` files and diffs against the compiled pack
(3194 records, 57045 leaf fields, zero divergence), and additionally checks every
spec format string against the verbatim `parser_reg()` string in `reference/src/*.c`.
Read `W5-DATA-EXACTNESS.md`: much of `datafile.c` is covered **in effect**, and its
named residual holes are where a `datafile.c` symbol could still be a real gap.
I checked each against those holes. None of the 15 lands in one.

| C symbol | C line | verdict | evidence |
|---|---:|---|---|
| `run_parser` | 45 | COVERED-IN-EFFECT | C: `fp->init()` → `fp->run(p)` → `fp->finish(p)`, logging a finish error. Port: `compileGamedata(text, spec)` (`content/src/records.ts:171`, now cited) plus the per-spec loop in `compile.ts:33-43`. `init`/`finish` are the spec object and the record finalisation; a finish error is a thrown `Error`, i.e. a hard build failure rather than a `plog_fmt`. W5 covers the *output* of this pipeline field-by-field. |
| `parse_file_quit_not_found` | 71 | COVERED-IN-EFFECT | C: `parse_file` then `quit()` on `PARSE_ERROR_NO_FILE_FOUND`. Port: `readFileSync` in `compile.ts:36` throws on a missing file — the same fail-hard, one step earlier. W5's "44 pack files vs re-parse / all present" is the standing assertion that no source went missing. |
| `parse_file` | 87 | COVERED-IN-EFFECT | C: line loop feeding `parser_parse`. Port: the `lines` loop in `compileGamedata` (`records.ts:191-216`, now cited). **Two documented differences**, both unobservable on shipped 4.2.6 data: (a) C tries `ANGBAND_DIR_USER/<name>.txt` before `ANGBAND_DIR_GAMEDATA` (`datafile.c:96-105`) — user data-file overriding is the mod substrate's job here, and the compiler reads only `reference/lib/gamedata`; (b) C logs up to `get_parser_error_limit()` errors and returns the *first* (`datafile.c:113-141`), the port throws on the first. Both are stated in the code comment. |
| `cleanup_parser` | 144 | N/A-BY-SCOPE | `fp->cleanup()`, freeing the parser's `mem_alloc`'d tables. GC-owned in the port; there is no parser lifetime to end. |
| `lookup_flag` | 149 | PRESENT-RENAMED | C: linear scan of a `const char **` table from `FLAG_START`, returning `FLAG_END` on a miss. Port: the generated name→index records (`generated/*-flags.ts`) indexed directly — `grabFlag` (`obj/bind.ts:281`, now cited), `raceFlagsOn`/`raceFlagsOff`/`spellFlagsOn` (`mon/bind.ts:271,287,305`), `flagByName` (`store/bind.ts:37`). `undefined`/0 is the `FLAG_END` miss. **Not** in a W5 hole: W5 lists "C bitflag enum identity" as unverified for the *pack* (which stores names), but the port's name→index tables are codegenned from `list-*-flags.h` and independently guarded by `generated/codegen-drift.test.ts`. |
| `grab_base_and_int` | 410 | N/A-BY-SCOPE | **Dead code in 4.2.6.** Defined at `datafile.c:410`, declared at `datafile.h:48`, and `grep -rn grab_base_and_int reference/` returns exactly those two lines — zero callers anywhere in the tree. Nothing to port. |
| `grab_name` | 433 | PRESENT-RENAMED | C: scan `list[0..max)` for `what`, `msg()` + `PARSE_ERROR_GENERIC` on a miss. Port: `OBJ_MOD_NAMES.indexOf` / `ELEMENT_NAMES.indexOf` / the `OF` record probe at `obj/bind.ts:1155-1174` (now cited), and the same shape in `mon/bind.ts` and `player/bind.ts`. The miss throws instead of `msg`-ing, i.e. a build failure instead of a runtime warning. |
| `write_flags` | 482 | N/A-BY-SCOPE | A data-file *writer*. Two users: `obj-randart.c:3098` writes `randart.txt`, and `mon-lore.c:1799/1803` writes the user `lore.txt`. Neither artefact exists in the port: the randart spoiler file is an explicit deferral (`obj/randart.ts:38-45` — "Both are spoiler/log dumps that never affect any artifact field or RNG draw"), and lore lives in the JSON save (`SavedGame.lore`) instead of an external file. |
| `write_mods` | 520 | N/A-BY-SCOPE | Same: `randart.txt` only (`obj-randart.c:3101`). |
| `write_elements` | 569 | N/A-BY-SCOPE | Same: `randart.txt` only (`obj-randart.c:3104`). |
| `set_archive_user_prefix` | 617 | N/A-BY-SCOPE | Sets the per-user filename prefix for `ANGBAND_DIR_ARCHIVE`; called once from `ui-game.c`. There is no archive directory — the port is a browser build with `localStorage`. |
| `file_archive` | 626 | N/A-BY-SCOPE | Moves `ANGBAND_DIR_USER/<f>.txt` into `ANGBAND_DIR_ARCHIVE` with an index or suffix. No filesystem, no archive directory. |
| `randart_file_exists` | 658 | N/A-BY-SCOPE | Tests for `archive/randart_%08lx.txt` for the current `seed_randart`. The port's equivalent question — "do I already have the artifact set for this seed?" — is answered by regenerating deterministically from `SavedGame.randartSeed`, which `save.test.ts` "swaps the artifact set and persists the seed reproducibly" proves gives the identical set. |
| `activate_randart_file` | 673 | N/A-BY-SCOPE | Moves the archived randart file into place as `user/randart.txt` so `parse_file` will pick it up. Superseded by seed-based regeneration, as above. |
| `deactivate_randart_file` | 692 | N/A-BY-SCOPE | The inverse move. Same. |

---

# The guard

**`packages/core/src/session/save-fields.test.ts`** (new, 10 tests).

Master had **no** save field-coverage guard. `save.test.ts` (43 tests) is strong
per feature but every assertion is hand-written, so a field that stops being
written is silent there; and there was no `save → load → save` idempotence check
anywhere in the repo (`grep -rn "saveGame(restored\|idempot\|resave\|save2"` over
`packages/core/src/session/*.test.ts` and `mod/dehydrate-roundtrip.test.ts`
returned nothing). Three guards, one table:

1. **C side.** `reference/src/save.c` is re-read at test time; the `wr_byte` /
   `wr_u16b` / `wr_s16b` / `wr_u32b` / `wr_s32b` / `wr_string` call sites inside
   each brace-matched `wr_*` body are counted, and the table declares the
   expected count for all 29 blocks. A field added to or removed from upstream
   changes a count and fails, naming the block. Also asserted: the discovered
   block set equals the table's block set exactly (a new `wr_*` function fails),
   and each declared `save.c:<line>` really is that definition.
   *Honest limit, stated in the file:* it counts write **call sites**, so a new
   field inside an existing loop body is caught (new call site) but a widened
   loop bound is not.
2. **Port side.** 130 JSON paths into a real mid-game `saveGame()` document, one
   group per block, must all resolve. Plus: every block must be adjudicated
   (a port mapping, a conditional with a stated condition, an `na` scope rule, or
   a `gap`); exactly one `gap` is allowed and it must be `wr_ignore`; and a
   dedicated dead-save test asserts `dungeonDepth` present with `chunk`/
   `monsters`/`floor`/`traps`/`featLegend` absent, the shape of `save.c:965-971`.
3. **Loader.** `save → load → save` must be deep-equal, and 45 named scalar
   leaves must survive a **mutated** reload (write a value into the JSON, load,
   re-serialise, require the value back). Presence alone would pass a loader that
   ignores the field; mutation survival would not.

The idempotence test carves out exactly one field, and asserts the transform
rather than skipping it: `load.c:791-793` rewrites `died_from` to
`"(alive and well)"` whenever `chp >= 0`, so a living character's cause-of-death
string legitimately changes on every read. The test requires
`first.player.diedFrom === ""`, `second.player.diedFrom === "(alive and well)"`
and `first.player.chp >= 0`, then normalises and demands equality on everything
else.

## Bite proofs

| # | Break | Failure |
|---|---|---|
| 1 | Declare `wr_player: 55` instead of the real 54 (simulating upstream growing a field without the port noticing) | `each block still writes exactly the declared number of fields` — `- "wr_player": 55 / + "wr_player": 54` |
| 2 | Delete `...(state.restingTurn ? { restingTurn: state.restingTurn } : {})` from `serializeGame` (`save.ts:1274`) | `every declared field path resolves in a real mid-game save` — `expected [ 'wr_player -> restingTurn' ] to deeply equal []` |
| 3 | Make `deserializePlayer` ignore the saved value: `p.wordRecall = 0` | `every declared scalar leaf survives a mutated reload` — `"wr_player -> player.wordRecall: wrote 15, read back 0"` |
| 4 | Drop `mon.mspeed = data.mspeed` from `deserializeMonster` | `save -> load -> save is identical` — `- "mspeed": 109 / + "mspeed": 0` (and again for midx 2) |

All four reverted; `git diff -- packages/core/src/session/save.ts` after
restoration is `44 insertions(+), 0 deletions(-)` — the block-map comment only.

---

# GAPs (reported, not fixed)

## W1-CAVE-SAVE-001 — `wiz_light` / `wiz_dark` diverge four ways; `square_ismark` unported

**Symbol in scope:** `square_ismark` (`cave-square.c:424`).
**Port:** `wizLightLevel`, `packages/core/src/game/effect-terrain.ts:164-186`.
**C:** `wiz_light` `cave-map.c:417-479`, `wiz_dark` `cave-map.c:490-546`.
**Live via:** `EF_LIGHT_LEVEL` → `effect-terrain.ts:305`, `EF_DARKEN_LEVEL` →
`effect-terrain.ts:319`, wizard `wizLightLevel(state, true)` →
`game/wizard.ts:1141`, and `generate.c:1109` / `:1256` call
`wiz_light(chunk, p, false)` on town generation.

Four separate divergences:

1. **Memorize gate missing.** C memorizes a neighbour only when
   `!square_isfloor(c, a_grid) || square_isvisibletrap(c, a_grid)`
   (`cave-map.c:439-440`, `:510-511`). The port calls `squareMemorize(state, a)`
   unconditionally (`effect-terrain.ts:177`). Result: after clairvoyance the port
   remembers every plain floor grid; upstream remembers only non-floor terrain
   and visible traps.
2. **Mark / forget-misremembered phase missing.** C marks each memorized
   neighbour (`square_mark`, `cave-square.c:1585`), then for every processed grid
   does `if (!square_ismark(grid) && square_ismemorybad(grid)) square_forget(grid)`
   (`cave-map.c:453-458`, `:524-529`), then sweeps `square_unmark` over the whole
   map (`:462-469`, `:533-540`). None of it is ported, so a grid the player
   *mis*remembers and that this pass did not touch keeps its stale memory where
   upstream would blank it. **This is `square_ismark`'s only purpose upstream** —
   hence the GAP verdict on that symbol rather than INLINED.
3. **`wiz_dark` semantics inverted.** Upstream `wiz_dark` still memorizes terrain
   and object piles; it differs from `wiz_light` *only* in `sqinfo_off(SQUARE_GLOW)`
   vs `sqinfo_on` (`cave-map.c:508-521`). The port's unlit branch calls
   `forgetMap(state)` (`effect-terrain.ts:185`), erasing the whole remembered map
   and every `SQUARE.DTRAP` mark (`known.ts:504-515`). A Scroll of Darkness
   currently blinds the player's map where upstream would *fill it in*.
4. **`full` parameter not threaded.** C takes `bool full` and chooses
   `square_know_pile` vs `square_sense_pile` (`cave-map.c:448-452`, `:519-523`);
   `effect_handler_LIGHT_LEVEL`/`DARKEN_LEVEL` derive it from
   `context->value.base` (`effect-handler-general.c:3005`, `:3015`). The port
   reads `ctx.value.base` only to choose the *message*
   (`effect-terrain.ts:301-303`, `:315-317`) and then always know-piles when lit
   and never touches piles when unlit.

**To implement:** give `wizLightLevel(state, lit, full)` the C body — add the
`!isFloor || isVisibleTrap` gate around `squareMemorize`; add a `Set<number>` of
marked grid indices (or use `SQUARE.MARK` via `sqinfoOn`/`sqinfoOff`, which is
closer to upstream and would give `square_ismark` a real counterpart) filled at
each memorize, then the `!mark && squareMemoryBad → squareForget` pass, then the
unmark sweep; replace the `forgetMap` call with the same memorize path as the lit
branch, keeping only the `sqinfoOff(GLOW)` difference; and pass `full` through
from both handlers to select `squareKnowPile` vs `squareSensePile`.
`squareMemoryBad` (`known.ts:224-227`) and `squareSensePile` (`known.ts:483`)
already exist. The divergence is documented in a code comment at
`effect-terrain.ts:167-183`.

## W1-CAVE-SAVE-002 — rune auto-inscriptions are not saved

**Symbols in scope:** `wr_ignore` (`save.c:514`), `rd_ignore` (`load.c:846`).
**C write:** `save.c:586-605` — count the runes with a note
(`nrune = max_runes()`, `rune_note(k)`), `wr_u16b` the count, then for each
`wr_s16b(k)` + `wr_string(quark_str(rune_note(k)))`.
**C read:** `load.c:937-945` — `rd_u16b(&inscriptions)`, then per entry
`rd_s16b(&runeid)` + `rd_string(tmp)` + `rune_set_note(runeid, tmp)`.
**Supporting C:** `rune_note` `obj-knowledge.c:406`, `rune_set_note`
`obj-knowledge.c:414`, `max_runes` `obj-knowledge.c:234`; consumed by
`rune_add_autoinscription` / `rune_autoinscribe` / `runes_autoinscribe`
(`obj-ignore.c:177-225`) to append a player-chosen note to every object carrying
that rune, and edited from `ui-knowledge.c:2251-2274`.

**Port:** no rune-note store exists. `SavedGame.ignore`
(`IgnoreSettingsData`, `obj/ignore.ts:321-330`) has `level`, `ego`, `kindAware`,
`kindUnaware`, `unignoring` — no rune slot. `SavedGame.autoinscriptions` covers
only the per-**kind** `note_aware`/`note_unaware` half of `wr_ignore`. The
subsystem is an explicitly ledgered deferral: `obj/knowledge.ts:22-26` lists "rune
inscriptions (`rune_note`)" under DEFERRED, ledgered in
`parity/ledger/obj-knowledge.yaml`.

**What breaks:** a character who sets rune inscriptions loses all of them on
reload — silent data loss on a player-authored setting, the same class of bug as
gap 12.1 (the home stash). Because the whole subsystem is absent, this is not a
save-layer fix: the gap is the deferral, and the save block should land with it.

**To implement:** (1) a rune-note store parallel to `AutoinscriptionRegistry`
(`obj/knowledge.ts`), keyed by rune index, with `runeNote(i)` / `runeSetNote(i, s)`
and a `maxRunes()` that matches `obj-knowledge.c:234`; (2)
`rune_add_autoinscription`'s append-if-not-already-present logic
(`obj-ignore.c:176-188`) at the object-inscribe sites; (3) a `runeNotes` block in
`SavedGame` keyed by the **namespaced rune id**, not the raw index, to match
`SAVE_VERSION` 2's rule (`save.ts:104-113`); (4) a row for it in
`save-fields.test.ts` `BLOCKS` moving `wr_ignore` from `gap` to `port` — the
guard's "names the one known GAP and no other" test will then fail until the row
is updated, which is deliberate.

## W1-CAVE-SAVE-003 — `square_unlock_door` deletes the lock instead of zeroing it

**Symbol in scope:** `square_unlock_door` (`cave-square.c:1377`).
**C:** `square_set_door_lock(c, grid, 0)` → `trap.c:706-726`: if there is no
"door lock" trap on the grid, place one; then set `power = 0` on every lock
present. The trap object survives with power 0.
**Port:** `game/project-feat.ts:262-264` (`PROJ.KILL_TRAP`, the
`effect-handler` unlock path that mirrors `project-feat.c:239-247`) calls
`squareRemoveAllTraps(state, grid, lock.tidx)`, removing the trap entirely.
`state.removeDoorLock` (`session/game.ts:1536`) does the same.

**Why it is narrow but real:** `squareDoorPower` returns 0 either way, so
`square_islockeddoor` agrees, and the monster lock-picking path
(`monster-turn.ts:1197` → `setDoorLock(next, lockPower - 1)`) matches C
(`mon-move.c:1251`) because it goes through `squareSetDoorLock`, which re-places
a missing lock. The observable differences are downstream of the trap *object*
existing: `square_istrap` / `squarePlayerTrapAllowed` see a trap on the grid in C
and not in the port, and the trap save block writes one record in C and none in
the port. A closed door is not trap-holding terrain, so no player trap could
occupy the grid either way — which is why I judge the blast radius narrow rather
than nil. **I did not construct a divergent scenario**; the finding is the code
difference, and the ranking of its impact is my judgement, flagged as such.

**To implement:** replace the two `squareRemoveAllTraps(..., lock.tidx)` unlock
sites with `squareSetDoorLock(state, grid, 0, deps)`. Leave the
`square_open_door` / `square_smash_door` sites alone — those *do* remove the lock
upstream (`cave-square.c:1367`, `:1374`). The divergence is documented in a code
comment at `project-feat.ts:259-261`.

---

# Out-of-scope defects (reported, not fixed — rule 8)

**OOS-1: ignore settings and autoinscription kind keys use raw content indices.**
`IgnoreSettingsData.ego` is `"<eidx>:<itype>"` strings and `.kindAware` /
`.kindUnaware` are raw `kidx` arrays (`obj/ignore.ts:240-255, 297-311`). Every
other content reference in a version-2 save was converted to a namespaced id
precisely so a pack change cannot mis-target it (`save.ts:104-113`,
MOD_LIFECYCLE decision 1) — `SavedGame.autoinscriptions` does use `kindId`, so the
inconsistency is inside one feature. A pack reorder or a mod inserting egos/kinds
would silently apply the player's ignore settings to the wrong items. Owner:
`obj-ignore.c` / `obj/ignore.ts`, not in my symbol list. Fix shape: route the
snapshot/restore through `ContentIdResolver` like `serializeStores` does.

---

# Verification

Every command run from `C:\Repositories\na-wt-csd` on `p4/w1-cavesave`.

## Build

```text
$ timeout 900 pnpm build

> neo-angband@0.1.0 build C:\Repositories\na-wt-csd
> tsc -b

BUILD_EXIT=0
```

## Tests

The new guard alone:

```text
$ timeout 600 pnpm exec vitest run packages/core/src/session/save-fields.test.ts

 ✓ packages/core/src/session/save-fields.test.ts (10 tests) 1878ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

Everything the change touches (`session`, `world`, `gen`, `content`, plus the
`trap` / `known` / `effect-terrain` / `project-feat` suites for the files that
received citation comments):

```text
$ timeout 600 pnpm exec vitest run packages/core/src/session packages/core/src/world \
    packages/core/src/game/trap.test.ts packages/core/src/game/known.test.ts \
    packages/core/src/game/effect-terrain.test.ts packages/core/src/game/project-feat.test.ts \
    packages/core/src/game/display.test.ts packages/core/src/game/effect-detect.test.ts     packages/core/src/game/effect-teleport.test.ts packages/core/src/game/effect-general.test.ts     packages/core/src/game/cave-cmd.test.ts packages/core/src/game/floor.test.ts     packages/core/src/gen packages/content/src packages/core/src/obj

 Test Files  62 passed (62)
      Tests  1717 passed (1717)
   Duration  16.24s
EXIT=0
```

## Reference tree untouched

```text
$ git diff --stat master -- reference/
(empty)
```

## Change surface

```text
$ git diff --stat
 packages/content/src/records.ts           | 11 ++++++++
 packages/core/src/game/cave-cmd.ts        |  6 ++++-
 packages/core/src/game/display.ts         |  2 ++
 packages/core/src/game/effect-detect.ts   |  2 +-
 packages/core/src/game/effect-general.ts  |  4 +--
 packages/core/src/game/effect-teleport.ts |  3 ++-
 packages/core/src/game/effect-terrain.ts  | 19 +++++++++++++
 packages/core/src/game/floor.ts           |  7 +++++
 packages/core/src/game/known.ts           | 11 ++++++++
 packages/core/src/game/project-feat.ts    | 19 ++++++++++++-
 packages/core/src/game/trap.ts            |  5 ++++
 packages/core/src/gen/generate.ts         |  1 +
 packages/core/src/obj/bind.ts             | 10 ++++++-
 packages/core/src/session/save.ts         | 44 +++++++++++++++++++++++++++++++
 packages/core/src/world/chunk.ts          |  3 +++
 packages/core/src/world/flow.ts           |  2 ++
 packages/core/src/world/view.ts           |  2 ++
 17 files changed, 144 insertions(+), 7 deletions(-)

$ git diff -U0 -- packages/core/src packages/content/src | grep "^+" | grep -v "^+++" \
    | grep -vE "^\+\s*(/\*|\*|//)" | grep -vE "^\+\s*\*/"
(empty)
```

Every production change is a comment. The only new logic is the test file.

---

# Uncertainties, flagged

1. **`square_issecrettrap`'s micro-divergence may be unreachable.** The
   visible-glyph-plus-invisible-trap state I describe requires a glyph placed on
   a grid that already holds an invisible player trap. `effect_handler_GLYPH`
   checks only `square_istrappable` (terrain) and pushes objects, so nothing
   *forbids* it, but I did not find a path that produces it and did not try to
   build one. Recorded as a flagged note, not asserted as a bug.
2. **W1-CAVE-SAVE-003's impact ranking is judgement.** The code difference is
   certain; "narrow blast radius" is my assessment, and I did not construct a
   scenario where a player would notice.
3. **Guard 1 counts write call sites, not runtime fields.** A widened loop bound
   upstream (e.g. `ELEM_MAX` growing) would not change any count. Stated in the
   test file so the guard is not read as stronger than it is.
4. **W1-CAVE-SAVE-001's item 3 assumes `forgetMap` is the whole unlit path.** I
   traced `EF_DARKEN_LEVEL` → `wizLightLevel(state, false)` → `forgetMap` and
   found no second darken path (`grep -rn "wizLightLevel\|forgetMap"` over
   `packages/`), but I did not exhaustively audit every scroll/effect that could
   darken.
5. **`wr_gear`'s declared write count is 0** because both its writes happen
   inside `wr_gear_aux`. Correct, but it makes that row's guard-1 assertion
   vacuous; the row is carried by its `port` paths instead. Same for
   `wr_objects` / `wr_monsters` / `wr_traps`.
6. **I did not re-verify the sibling lane's `W1-cave.md` verdicts** except where
   they overlap my symbols (`square_ismark`, `square_isfeel`, `square_isinvis`,
   `square_ismon_restrict`, `square_isno_map`, `square_excise_all_imagined`,
   `square_add_*`, `square_close_door`, `square_destroy_door`,
   `square_destroy_rubble`, `square_force_floor`). On `square_ismark` I reach a
   **different verdict**: that lane recorded INLINED; I record GAP, because the
   flag's only upstream purpose — the forget-misremembered phase — is absent.
   That disagreement is deliberate and evidenced above.
