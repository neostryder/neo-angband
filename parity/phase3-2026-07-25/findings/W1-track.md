# W1 cluster lane (resumed) — cave-map / save / rune / autoinscribe

**Date:** 2026-07-26
**Worktree:** `C:\Repositories\na-wt-pc` (`p5/track`)
**Oracle:** Angband 4.2.6 under `reference/` (read-only; `git diff master -- reference/` empty)
**Inherited:** WIP snapshot `c8a0bda9e` (561+/86-, 13 files), not written by me.

---

## 1. Inherited-hunk triage

Every hunk of `c8a0bda9e`, with the reference line that decides it and the test
that proves it. Nothing was accepted on plausibility.

| file | hunk | verdict | decided by | proved by |
|---|---|---|---|---|
| `game/effect-terrain.ts` | `wizLightLevel(state, lit, full, isCurrentCave)` signature + neighbour loop restructure | **KEEP** | `cave-map.c:417-479` / `:490-546` — the two bodies differ only in `sqinfo_on` vs `sqinfo_off` of `SQUARE_GLOW` | `effect-terrain.test.ts` "wiz_dark memorizes exactly as wiz_light does" (M1) |
| `game/effect-terrain.ts` | memorize gate written as **`if (true)`** | **REWORK** → `if (!c.isFloor(a) \|\| squareIsVisibleTrap(state, a))` | `cave-map.c:439-440` / `:510-511` | "memorizes only non-floor neighbours, never plain floor" (M2) |
| `game/effect-terrain.ts` | `SQUARE.MARK` set on each memorized neighbour | **KEEP** | `cave-map.c:441` → `square_mark` `cave-square.c:1585` (no `c != cave` guard) | "refreshes a stale wall memory and clears MARK afterwards" (M4) |
| `game/effect-terrain.ts` | `!MARK && squareMemoryBad → squareForget` pass | **KEEP** | `cave-map.c:456-459` / `:527-530` | "forgets a misremembered grid this pass did not mark" (M3) |
| `game/effect-terrain.ts` | unmark sweep over `1..h-2`/`1..w-2` only (border MARK wart kept) | **KEEP** | `cave-map.c:463-470` / `:534-541` | M4 |
| `game/effect-terrain.ts` | `forgetMap()` call deleted from the unlit branch | **KEEP** | `wiz_dark` `cave-map.c:508-521` memorizes; nothing in 4.2.6 blanks the map | M1 |
| `game/effect-terrain.ts` | `full` threaded → `squareKnowPile` vs `squareSensePile` | **KEEP** | `cave-map.c:445-452`; handlers `effect-handler-general.c:3005`/`:3016` | "threads `full`" (M5) |
| `game/effect-terrain.ts` | `handleLIGHT_LEVEL`/`DARKEN_LEVEL` derive `full` from `ctx.value.base` | **KEEP** | `effect-handler-general.c:3005-3008` / `:3016-3018` | M5 |
| `game/effect-terrain.test.ts` | 8 new `wiz_light`/`wiz_dark` body tests | **KEEP** | as above | each verified to fail under M1-M5 |
| `game/effect-terrain.test.ts` | EF_DESTRUCTION expectation flipped to `knownObject(...) .not.toBeNull()` | **KEEP** | `square_forget` is terrain-only (`cave-square.c:1580-1583`); `effect-handler-attack.c:1206` forgets then `continue`s on the player grid; `map_info`'s object loop (`cave-map.c:155`) is **not** gated on `square_isknown` | M10 |
| `game/known.ts` | `squareForget` no longer deletes `known.objects` | **KEEP** | `cave-square.c:1580-1583` = `square_set_known_feat(FEAT_NONE)`, nothing else | `known.test.ts` "forgets the terrain but keeps the remembered pile and DTRAP mark" (M10) |
| `game/known.ts` | `forgetMap` deleted | **KEEP** | no such function in 4.2.6; only caller was the (wrong) unlit branch | M1 (and `grep -rn forgetMap packages/` is now comment-only) |
| `game/known.ts` | `state.autoinscribeAll?.()` tail in `updatePlayerObjectKnowledge` | **KEEP** | `obj-knowledge.c:1245-1247` | `save.test.ts` "update_player_object_knowledge tail-calls autoinscribe_ground + _pack" (M13) |
| `game/known.test.ts` | `forgetMap` describe → `squareForget` describe | **KEEP** | as above | M10 |
| `game/project-feat.ts` | `squareRemoveAllTraps(lock)` → `squareSetDoorLock(state, grid, 0, deps)` | **KEEP** | `cave-square.c:1377-1380` → `trap.c:706-726` keeps the trap at power 0 | `project-world.test.ts` "KILL_TRAP unlocks a locked door by ZEROING the lock" (M8) |
| `game/wizard.ts` | `wizLightLevel(state, true, true)` | **KEEP** | `cmd-wizard.c:2909` `wiz_light(cave, player, true)` | `wizard.test.ts` "is the `full` form: square_know_pile, not sense_pile" (M15) |
| `game/context.ts` | `runeNotes` / `autoinscribeObject` / `autoinscribeAll` state seams | **KEEP** | `obj-knowledge.c:414`; `obj-gear.c:868`; `store.c:1977`; `obj-knowledge.c:1246` | M12/M13/M14 |
| `obj/knowledge.ts` | `RuneNoteRegistry` + `runeNote` / `runeSetNote` | **KEEP** | `obj-knowledge.c:406-421`; the empty-note wart is real (`quark_add("")` returns nonzero, `z-quark.c:31-49`) | `save.test.ts` rune round-trip block (M6/M7) |
| `obj/knowledge.ts` | `runeName` | **KEEP** | `obj-knowledge.c:325-343`, verbatim | `web/knowledge.test.ts` "labels rows with rune_name" |
| `obj-cmd.ts` | `runeAddAutoinscription` (substring no-op, append, 79-char truncation) | **KEEP** | `obj-ignore.c:172-186` (`strstr`, `char current_note[80]`) | `obj-cmd.test.ts` "APPENDS…and is idempotent", "truncates…at 79 chars" |
| `obj-cmd.ts` | `runesAutoinscribe` + its call **before** the `if (!note)` return | **KEEP** | `obj-ignore.c:217-225` and the comment at `:258-259` | "stamps a known rune's note…kind note or not" |
| `obj-cmd.ts` | `runeAutoinscribe` (floor pile then gear) | **KEEP** | `obj-ignore.c:193-212` | "rune_autoinscribe stamps the floor pile AND the gear" |
| `obj-cmd.ts` | `autoinscribeGround` / `autoinscribePack` extracted | **KEEP** | `obj-ignore.c:340-359` | "autoinscribe_ground / autoinscribe_pack cover both lists" |
| `obj-cmd.ts` | use-command autoinscribe of the surviving stack | **KEEP** | `cmd-obj.c:717-719` `if (!none_left && !from_floor)` | "the use command autoinscribes the stack it did not consume" + the none-left counterpart |
| `game/pickup.ts` | `inven_carry` autoinscribe in the non-combining branch only | **KEEP** | `obj-gear.c:864-868` | `pickup.test.ts` two tests (M14) |
| `session/game.ts` | store-sell autoinscribe after the Home early return | **KEEP** | `store.c:1976-1977`; `do_cmd_stash` (`store.c:2009-2075`) has **no** such call | `save.test.ts` "selling part of a stack autoinscribes the remainder, and stashing does not" (M12) |
| `session/game.ts` | `objCmdDeps` extracted + `autoinscribeObject`/`autoinscribeAll` wired | **KEEP** | as above | M12/M13 |
| `session/game.ts` | arena `wizLightLevel(state, true, false, false)` | **KEEP** | `generate.c:1109` `wiz_light(chunk, p, false)`, unconditional on the arena path; `chunk != cave` there so it is GLOW-only | `arena.test.ts` glow/mark/known assertions (M17) |
| `session/game.ts` | `RuneNoteRegistry` in `startGame` + `loadGame` | **KEEP** | `obj-knowledge.c` rune_list lifetime | M6/M7 |
| `session/game.ts` | `save.runeNotes` restore loop | **REWORK** → resolve `runeKey` back to the live index | see GAP-2 | "survives a MUTATED reload" (M7) |
| `session/save.ts` | `SavedGame.runeNotes` + the `wr_ignore` rune block | **REWORK** → keyed by `runeKey`, not the raw index | see GAP-2 / GAP-4 | `save-fields.test.ts` + `save.test.ts` (M6) |
| `web/knowledge.ts` | `runeName` used for row labels and recall titles | **KEEP** | `ui-knowledge.c:2198` (`display_rune`), `:2219-2220` (`rune_lore`) | `web/knowledge.test.ts` |

**Counts: KEEP 27 · REWORK 3 · REVERT 0.**
The one hunk that would have shipped a live defect was the `if (true)` memorize
gate — it made the WIP's own new test a lie.

---

## 2. GAPs

### GAP-1 — `wiz_light` / `wiz_dark`: four divergences (`square_ismark` unported)

- **ref** `cave-map.c:417-479` / `:490-546`; `square_mark`/`square_unmark`
  `cave-square.c:1585/1589`; `square_ismark` `:424`; `square_forget` `:1580`.
- **port** `game/effect-terrain.ts` `wizLightLevel`, `game/known.ts`
  `squareForget`.
- **what differs** (before): every neighbour memorized including plain floor; no
  `square_mark` / forget-misremembered / unmark passes, so `SQUARE.MARK` was dead
  and a stale memory outside the pass survived; the unlit branch called a
  `forgetMap()` that has no upstream counterpart and blanked the whole remembered
  map plus every `SQUARE.DTRAP`; `full` was read only to pick the message, so lit
  always `know_pile`d and unlit never touched piles. Separately `squareForget`
  deleted the remembered object pile, which `square_forget` does not.
- **effect** P1. A Scroll of Darkness *erased* the player's map where upstream
  fills it in; clairvoyance remembered every floor grid it should not; *Destruction*
  and MAP_AREA silently dropped remembered objects.
- **severity** P1 · **fixed: yes**
- **original report accuracy:** the findings file (W1-CAVE-SAVE-001) was
  **accurate** on all four items, and its flagged uncertainty #4 ("`forgetMap` is
  the whole unlit path") held. The **task message's** paraphrase — "the port
  clearing the wrong bit / inverting the sense" — is **wrong on mechanism**: the
  `GLOW` bit was already correct (`sqinfoOff` for unlit). The inversion was in
  what `wiz_dark` did *besides* the bit.
- Two pre-existing tests encoded the wrong behaviour and were corrected against
  the C, not the reverse: `wizard.test.ts` "lights and knows the level" asserted
  that open floor becomes known, and "wizQuerySquareFlag(flag=0) returns known
  grids" relied on that. `wiz_hack_map` scans `square_in_bounds_fully` grids only
  (`cmd-wizard.c:333`), the same range the port scans, so on an all-floor field
  the correct answer is *zero* known grids; the test now plants a granite pillar.

### GAP-2 — the `wr_ignore` rune auto-inscription block is not saved

- **ref** `save.c:586-605` (`max_runes`, `rune_note(k)`, `wr_s16b(k)` + `wr_string`),
  `load.c:934-945` (`rune_set_note(runeid, tmp)`); `obj-knowledge.c:406/414/234`;
  consumers `obj-ignore.c:172-225`, UI `ui-knowledge.c:2193-2280`.
- **port** the whole subsystem was absent: no rune-note store, no
  `rune_add_autoinscription` / `rune_autoinscribe` / `runes_autoinscribe`, no
  `{`/`}` keys on the rune knowledge screen, and `apply_autoinscription` was
  missing three of its four upstream call sites.
- **effect** P1 — silent loss of a player-authored setting on reload, and (before
  the call sites landed) a registered note only applied on the explicit `{`
  command, never on pickup, sale or rune learning.
- **severity** P1 · **fixed: yes**
- Landed: `RuneNoteRegistry` (`obj/knowledge.ts`), the three `obj-ignore.c`
  functions (`game/obj-cmd.ts`), the four `apply_autoinscription` call sites
  (`obj-gear.c:868` → `game/pickup.ts`; `store.c:1977` → `session/game.ts`;
  `cmd-obj.c:718` → `game/obj-cmd.ts`; `obj-knowledge.c:1246` → `game/known.ts`),
  `SavedGame.runeNotes`, and the screen's `display_rune` inscription column +
  `rune_xtra_prompt` / `rune_xtra_act`.
- **Guard updated, not weakened.** `session/save-fields.test.ts`'s `wr_ignore`
  row lost its `gap` and gained `runeNotes[0][1]` in both `port` and `mutate`;
  the fixture now sets a rune note; and "names the one known GAP and no other"
  became "declares no known GAP: every save.c block is fully covered", asserting
  `[]`. The assertion is still exact — a row regaining a `gap` fails it.
- **original report accuracy: accurate**, and usefully so — it correctly said
  "this is not a save-layer fix: the gap is the deferral". A save-only fix would
  have been vacuous, since nothing could set a rune note.

### GAP-3 — `square_unlock_door` deleted the lock instead of zeroing it

- **ref** `cave-square.c:1377-1380` → `square_set_door_lock` `trap.c:706-726`.
- **port** `game/project-feat.ts` `PROJ.KILL_TRAP` called
  `squareRemoveAllTraps(grid, lock.tidx)`.
- **what differs** upstream keeps the "door lock" trap object and sets its
  `power` to 0; the port deleted it. `square_istrap` / `square_isplayertrap` and
  `wr_traps_aux` all see a trap upstream and none in the port.
- **effect** P2 — `squareDoorPower` reads 0 either way, so `square_islockeddoor`
  agreed; the divergence is the surviving trap record.
- **severity** P2 · **fixed: yes** (`squareSetDoorLock(state, grid, 0, deps)`).
- **original report accuracy: partly wrong.** The code difference was real and
  exactly as described. But it claimed `state.removeDoorLock`
  (`session/game.ts:1556`) "does the same" and implied a second site needing the
  same fix. It does not: `removeDoorLock` backs `square_open_door` /
  `square_smash_door` (`game/monster-turn.ts:1031/1037`), which **do** remove the
  lock upstream (`cave-square.c:1359`, `:1373`). `project-feat.c:241` is
  `square_unlock_door`'s only caller in the entire tree, so the one site was the
  whole surface.

### GAP-4 — ignore / aware state stored by raw content index

- **ref** `save.c:399-407` (`wr_object_memory`: aware / tried / everseen /
  kind_is_ignored_aware / _unaware, written positionally by `kidx`),
  `save.c:530-541` (`wr_ignore`'s ego block, positionally by `eidx`),
  `load.c:602-620` / `:872-892` (read back positionally).
- **port** `SavedGame.flavor.{aware,tried}` and `everseen.kinds` were `kidx[]`;
  `everseen.egos` was `eidx[]`; `SavedGame.ignore.{kindAware,kindUnaware}` were
  `kidx[]` and `.ego` was `"<eidx>:<itype>"` strings.
- **what differs** nothing, under a fixed content pack — and that is the point
  below. Under a pack change the player's ignore choices and flavour awareness
  re-target onto different items.
- **effect** P1 for the mod substrate, P3 for pure-core play.
- **severity** P1 · **fixed: yes** — all five blocks now key by namespaced id
  (`serializeIgnore` / `deserializeIgnore` / `deserializeFlavor` /
  `deserializeEverseen` in `session/save.ts`, plus `ContentIdResolver.egoIdOrNull`).
  `ignore_level[]` deliberately stays an array: it is keyed by the compiled
  `ITYPE_*` enum, not by content. `SAVE_VERSION` 2 → **3**; older saves are
  rejected, as the existing policy comment already specifies.
- **original report accuracy: partly wrong, and under-scoped.**
  1. It framed this as an internal inconsistency ("every other content reference
     was namespaced"), implying a parity defect. It is not: **upstream C is also
     positional here**, so the raw-index keying was *faithful* to `save.c`. The
     fix is a port-format / MOD_LIFECYCLE requirement, justified by the brief's
     own rule that the ratified JSON document — not the C byte layout — is the
     contract; behaviour under the shipped pack is unchanged.
  2. It named only `ignore.ego` / `.kindAware` / `.kindUnaware`. `flavor.aware`,
     `flavor.tried`, `everseen.kinds` and `everseen.egos` had the same defect and
     are fixed too (mutations M9 and M11 are separate bites).

### GAP-5 (new) — a "known" labyrinth is not revealed

- **ref** `gen-cave.c:1529-1530`, `:1593-1596` (`known = lit && randint0(depth) < 25`
  → `p->upkeep->light_level = true`); consumed at `generate.c:1255-1258` as
  `wiz_light(chunk, p, false)` then cleared.
- **port** `gen/cave.ts:1391` had `void known;` with a comment claiming player
  upkeep is not modelled.
- **effect** P1 in shallow play: at depth ≤ 25 `randint0(depth) < 25` always
  holds, so **every** shallow labyrinth is a known maze upstream and arrives
  perma-lit. The port arrived dark.
- **severity** P1 · **fixed: yes** — `Gen.lightLevel` (`gen/util.ts`), set by
  `labyrinthGen`, consumed in `session/game.ts`'s level-entry path as
  `wizLightLevel(state, true, false, false)` and cleared, mirroring
  `generate.c:1255-1258`. `isCurrentCave = false` is exact: `chunk` is not yet
  `cave` at that point, so `square_memorize` / `square_know_pile` /
  `square_forget` all short-circuit and the call is GLOW-only.
- Proved by `gen/gen.test.ts` "sets light_level for a KNOWN maze…" (M16).

### GAP-6 (new) — the rune knowledge screen had no inscription UI

- **ref** `display_rune` `ui-knowledge.c:2193-2204` (yellow `inscrip` at column
  47), `rune_xtra_prompt` `:2235-2244`, `rune_xtra_act` `:2247-2280`.
- **port** `web/knowledge.ts` `showRuneKnowledge` was recall-only.
- **effect** P2 (secondary screen), but load-bearing: without it GAP-2's whole
  subsystem is unreachable by a player.
- **severity** P2 · **fixed: yes** — `MenuItem.suffix` (`web/overlay.ts`) for the
  column-47 yellow annotation, `KnowledgeRow.hint` carrying the per-row
  `rune_xtra_prompt` string, and an inscribable `showRuneKnowledge` driving
  `selectFromMenu` directly with `{` / `}` commands (the `{` branch is
  `rune_xtra_act`'s `askfor_aux` sequence: seed with the current note, clear, set,
  then `rune_autoinscribe`). Wired in `web/main.ts`.
- **Known approximation, stated:** upstream's prompt string is appended to the
  menu's own prompt line; the port surfaces it as the row's `hint` line. Same
  per-row conditionality, different line.

---

## 3. Lane table — the remaining batch symbols

`awk -F'\t' '($6=="AREA-WORKED-NO-CANDIDATE"||$6=="NO-TRACE")' …/w1-triage.tsv |
grep -E 'cave\.c|cave-(map|view)\.c|save\.c|load\.c|rune|inscri'`. Every
`wr_*`/`rd_*` row in that output was already adjudicated in
`W1-CAVE-SAVE-DATA.md` and is not repeated; `wr_ignore` / `rd_ignore` move from
GAP to PORTED here. Rows below are the rest.

| C symbol | file:line | verdict | evidence |
|---|---|---|---|
| `wr_ignore` | `save.c:514` | **PORTED** (was GAP) | rune block → `SavedGame.runeNotes`; see GAP-2 |
| `rd_ignore` | `load.c:846` | **PORTED** (was GAP) | `loadGame`'s `runeKey → index` restore; see GAP-2 |
| `rune_note` | `obj-knowledge.c:406` | PORTED | `RuneNoteRegistry.get` / `runeNote` |
| `rune_set_note` | `obj-knowledge.c:414` | PORTED | `RuneNoteRegistry.set` / `runeSetNote`; `set(i, "")` stores and `set(i, null)` deletes, matching `quark_add("") != 0` (`z-quark.c:31-49`) |
| `max_runes` | `obj-knowledge.c:234` | COVERED-IN-EFFECT | `buildRuneList(env).length` |
| `rune_name` | `obj-knowledge.c:325` | PORTED | `runeName`, the C switch verbatim |
| `rune_index` | `obj-knowledge.c:198` (static) | COVERED-IN-EFFECT | Its only job is `(variety, index) → rune-list index` so `player_learn_rune` can look the rune up (11 call sites, all `obj-knowledge.c:1381-1600`). The port's learners take the rune's variety directly — `playerLearnCombat/Mod/Resist/FlagRune/Brand/Slay/Curse` (`obj/knowledge.ts:183-282`) — so there is no index to resolve. |
| `cleanup_rune` | `obj-knowledge.c:214` (static) | N/A-BY-SCOPE | `mem_free(rune_list)`; the rune list is a returned array, GC-owned. |
| `rune_add_autoinscription` | `obj-ignore.c:172` (static) | PORTED | `runeAddAutoinscription`; both warts kept (substring `strstr`, 79-char `my_strcat` truncation) |
| `rune_autoinscribe` | `obj-ignore.c:193` | PORTED | `runeAutoinscribe` (`game/obj-cmd.ts`), floor pile then gear, gated on `player_knows_rune` |
| `runes_autoinscribe` | `obj-ignore.c:217` (static) | PORTED | `runesAutoinscribe`, called from `applyAutoinscription` before the `!note` return (`:258-259`) |
| `autoinscribe_ground` | `obj-ignore.c:340` | PORTED | `autoinscribeGround` |
| `autoinscribe_pack` | `obj-ignore.c:352` | PORTED | `autoinscribePack` |
| `display_rune` | `ui-knowledge.c:2193` (static) | PORTED | `runeKnowledgeGroups` row label + `suffix` (yellow, col 47) |
| `rune_var_name` | `ui-knowledge.c:2206` (static) | PORTED | `RUNE_GROUP_TEXT` indexed by `runeGroupIndex` (`web/knowledge.ts`) |
| `rune_xtra_prompt` | `ui-knowledge.c:2235` (static) | PORTED | per-row `hint`, `'}'` only when the rune carries a note |
| `rune_xtra_act` | `ui-knowledge.c:2247` (static) | PORTED | `showRuneKnowledge`'s `{` / `}` commands |
| `dump_autoinscriptions` | `ui-prefs.c:218` | N/A-BY-SCOPE | Writes `inscribe:<tval>:<name>:<note>` lines into the user pref file under `ANGBAND_DIR_USER` via `file_putf`. The port is a browser build with no user pref file and no `dump_*` writer at all (`grep -rn "dump_features\|dumpPrefs\|\.prf"` over `packages/` finds only *bundled, read-only* `sound.prf` / `graf-*.prf` data). Autoinscriptions live in the JSON save (`SavedGame.autoinscriptions`), which is strictly more durable than the aware-only pref dump. |
| `parse_prefs_inscribe` | `ui-prefs.c:930` (static) | N/A-BY-SCOPE | The reader half of the same absent pref file. |
| `get_feat_code_name` | `cave.c:336` | N/A-BY-SCOPE | Its **only** caller in the tree is `ui-prefs.c:271` inside `dump_features`, the same pref-file writer. (The inverse direction — code name → feature — is live as `FeatureRegistry.byCodeName`, `world/feature.ts:157`.) |
| `cave_connectors_free` | `cave.c:381` | N/A-BY-SCOPE | `mem_free` walk over a `struct connector` list; the port's joins are a GC'd array (`Gen.joins`). |
| `object_lists_check_integrity` | `cave.c:503` | N/A-BY-SCOPE | Asserts `obj->oidx == i` across `c->objects[]` and the `player->cave` twin. The port has neither an `oidx` array (the pile Map *is* the object list, `game/floor.ts:18-21`) nor a persistent known twin, so there is no invariant to violate. Its live caller `square_know_pile` (`cave-square.c:1169`) is ported without it. |
| `cave_room_aux` | `cave-map.c:354` (static) | PORTED | `light_room`'s flood-fill helper, inlined as `add()` in `lightRoom` (`game/effect-terrain.ts:100-107`): same `seen` set, `square_in_bounds`, `square_isroom` gate and insertion order. |
| `strunescape` | `z-util.c:706` | N/A-BY-SCOPE | Grep artifact ("st**runesc**ape"). Its only callers are the Nintendo DS front end (`nds/nds-buttons.c:165`, `nds/nds-screenkeys.c:77`) and its own unit test — a native front end. |
| `array_filler` | `gen-cave.c:1739` (static) | N/A-BY-SCOPE | Grep artifact (`cave\.c` matches `gen-cave.c`). A `memset`-over-`int[]` helper; the port uses `Array.prototype.fill`. |
| `join_regions` | `gen-cave.c:2038` (static) | PORTED | `joinRegion` / `ensureConnectedness` (`gen/cave.ts:803/863`), including the `allow_vault_disconnect` parameter. |
| `find_joinfree_vertical_seam` | `gen-cave.c:984` (static) | **GAP (out of lane)** | see OOS-1 |
| `transform_join_list` | `gen-cave.c:1060` (static) | **GAP (out of lane)** | see OOS-1 |

**Count: 4 GAPs from the batch closed (2 of them the reported `wr_ignore`/`rd_ignore`
pair), 2 new GAPs found and closed (GAP-5, GAP-6), 17 PORTED / COVERED, 7
N/A-BY-SCOPE with a specific reason, 2 GAPs referred out of lane.**

---

## 4. Out-of-scope, reported not fixed

**OOS-1 — persistent-level lair/gauntlet join transforms are unported.**
`gen-cave.c:3569-3610` (`lair_gen`) and the gauntlet path take, under
`dun->persist`, `left_width = 1 + find_joinfree_vertical_seam(...)` and then
`transform_join_list(...)` per half; the port's `lairGen` implements only the
non-persistent branch (`gen/cave.ts:1645-1646`, `const leftWidth = xSize / 2`),
which is C's `assert(cached_join == NULL)` arm. Under `birth_levels_persist` a
lair/gauntlet level therefore splits down the middle regardless of where the
incoming stair connectors are, and C's "return NULL if either half < 4 wide"
rejection is absent. These two symbols reached my batch only because the batch
regex `cave\.c` also matches `gen-cave.c`; the owner is the generation /
persistent-levels lane. Not fixed.

---

## 5. Mutation table

Every production change reverted one at a time; the named test must fail.
"pre-existing?" = whether the suite *before this lane* also caught it.

| # | mutation | caught by | pre-existing suite caught it? |
|---|---|---|---|
| M1 | `wiz_dark` skips `squareMemorize` (the old `forgetMap` inversion) | `effect-terrain.test.ts` "wiz_dark memorizes exactly as wiz_light does" | no |
| M2 | memorize gate back to `if (true)` | "memorizes only non-floor neighbours, never plain floor" (+ the forget test) | no |
| M3 | forget-misremembered pass removed | "forgets a misremembered grid this pass did not mark" | no |
| M4 | unmark sweep removed | "refreshes a stale wall memory and clears MARK afterwards" | no |
| M5 | `full` not threaded (always `know_pile`) | "threads `full`: know_pile when full, sense_pile otherwise" | no |
| M6 | `runeNotes` not written to the save | `save-fields.test.ts` "every declared field path resolves…" + "…survives a mutated reload" | no (this was the declared GAP) |
| M7 | loader ignores the saved rune notes | `save-fields.test.ts` "save -> load -> save is identical" + `save.test.ts` mutated-reload test | no |
| M8 | `square_unlock_door` deletes the lock | `project-world.test.ts` "KILL_TRAP unlocks a locked door by ZEROING the lock" | no |
| M9 | `ignore.kindAware/Unaware` written by raw `kidx` | `save.test.ts` "writes ids for flavor…" + "reloads against a reordered kind registry" | no |
| M10 | `squareForget` deletes the remembered pile again | `known.test.ts` "keeps the remembered pile and DTRAP mark" + `effect-terrain.test.ts` destruction test | it *passed* before — the old expectation asserted the C-wrong behaviour |
| M11 | `flavor.aware/tried` written by raw `kidx` | `save.test.ts` "reloads against a reordered kind registry" | no |
| M12 | store sell does not autoinscribe the remainder | `save.test.ts` "selling part of a stack autoinscribes the remainder, and stashing does not" | no |
| M13 | `update_player_object_knowledge` drops its autoinscribe tail | `save.test.ts` "tail-calls autoinscribe_ground + _pack" | no |
| M14 | `inven_carry` does not autoinscribe on pickup | `pickup.test.ts` "autoinscribes a newly-inserted object" | no |
| M15 | wizard light passes `full=false` | `wizard.test.ts` "is the `full` form: square_know_pile, not sense_pile" | no |
| M16 | labyrinth `known` does not set `light_level` | `gen/gen.test.ts` "sets light_level for a KNOWN maze…" | no |
| M17 | arena level not `wiz_lit` | `arena.test.ts` arena round trip | no |
| M18 | rune UI loses the inscription column | `web/knowledge.test.ts` "shows the autoinscription yellow at column 47" | no |

18 mutations, 18 caught, 0 escapes.

---

## 6. Verification

All commands from `C:\Repositories\na-wt-pc` on `p5/track`.

```text
$ timeout 900 pnpm build
> tsc -b
BUILD_EXIT=0

$ timeout 1800 pnpm exec vitest run packages/core packages/content packages/web
 Test Files  263 passed (263)
      Tests  4313 passed (4313)
EXIT=0
```

`packages/borg` is excluded deliberately: `borg/src/{think,foundation}.test.ts`
hang (pre-existing, per the brief). Nothing in this lane touches `packages/borg`.

```text
$ git diff --stat master -- reference/
(empty)
```

Change surface (on top of the WIP snapshot):

```text
 packages/core/src/game/arena.test.ts          |  18 ++-
 packages/core/src/game/effect-terrain.ts      |   6 +-
 packages/core/src/game/obj-cmd.test.ts        | 158 +++++++++++++++++-
 packages/core/src/game/pickup.test.ts         |  43 +++++
 packages/core/src/game/project-world.test.ts  |  41 ++++-
 packages/core/src/game/wizard.test.ts         |  55 ++++++-
 packages/core/src/gen/cave.ts                 |   8 +-
 packages/core/src/gen/gen.test.ts             |  24 +++
 packages/core/src/gen/util.ts                 |   9 ++
 packages/core/src/mod/ids.ts                  |   4 +
 packages/core/src/obj/knowledge.ts            |  24 ++-
 packages/core/src/session/game.ts             |  35 +++-
 packages/core/src/session/save-fields.test.ts |  22 ++-
 packages/core/src/session/save.test.ts        | 213 +++++++++++++++++++++++-
 packages/core/src/session/save.ts             | 222 +++++++++++++++++++++++---
 packages/web/src/knowledge.test.ts            |  63 +++++++-
 packages/web/src/knowledge.ts                 | 137 +++++++++++++++-
 packages/web/src/main.ts                      |  12 +-
 packages/web/src/overlay.ts                   |  17 ++
 19 files changed, 1046 insertions(+), 65 deletions(-)
```

---

## 7. Uncertainties, flagged

1. **`SAVE_VERSION` 3 rejects existing version-2 saves.** That follows the policy
   already written into the constant's comment ("the game is pre-1.0… loadGame
   rejects them and the host starts a fresh game"), and I did not add a migration.
   If any live save on Pages matters, that is a decision for neostryder, not a code
   question.
2. **GAP-4 is not a parity fix.** Upstream is positional too. I fixed it because
   the task named it and because the port's ratified JSON document has a stated
   id-keying rule; the reasoning is recorded in `serializeIgnore`'s doc comment so
   a later reader does not mistake it for a C-derived change.
3. **The rune prompt line is an approximation.** Upstream appends
   `rune_xtra_prompt`'s string to the menu prompt; the port shows it as the row's
   hint line. Conditionality is identical, placement is not.
4. **The `runesAutoinscribe` empty-note edge is not representable.** Upstream
   `rune_set_note(i, "")` yields a live note whose append is a no-op but which
   still blocks the kind autoinscription and offers `'}'`. The port's
   `obj.note: string \| null` treats `""` as falsy throughout, so a combined
   inscription of `""` collapses to `null`. Pre-existing limit of the note field,
   not introduced here; the registry itself does distinguish `set(i, "")` from
   `set(i, null)`.
5. **`Gen.lightLevel` is consumed at level entry, not inside `generateLevel`.**
   Upstream consumes it in `cave_generate` before the chunk becomes `cave`; the
   port consumes it in `session/game.ts` after the chunk is installed and passes
   `isCurrentCave = false` to reproduce the short-circuit. Behaviourally
   equivalent (GLOW only, no memorize), but it is a placement difference and is
   commented as such.
6. **`square_issecrettrap`'s micro-divergence** flagged in `W1-CAVE-SAVE-DATA.md`
   was not revisited; it is not in this batch.
