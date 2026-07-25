# W1 — `reference/src/obj-util.h` adjudication

Header: `reference/src/obj-util.h` (35 allow-list entries).  
Worktree: `C:\Repositories\na-wt-save` (`p3/w1-objutil`).  
Oracle: Angband 4.2.6 `reference/` (read-only). Adjudication only.

| C function | C line | verdict | evidence |
|---|---:|---|---|
| compare_items | 49 | PORTED | `objectListStandardCompare` in `packages/core/src/game/obj-list.ts:194` — unknown last, known artifacts first, unaware next, worthless after valuable, then tval/sval; live list path via `objectListSort` / web screens |
| is_artifact_created | 83 | PORTED | `ArtifactState.isCreated` `packages/core/src/obj/make.ts:748`; wired through make/save/knowledge (`state.artifacts`) |
| is_artifact_everseen | 85 | PORTED | `ArtifactState.isEverseen` `packages/core/src/obj/make.ts:767`; snapshot/restore in save path |
| is_artifact_seen | 84 | PORTED | `ArtifactState.isSeen` `packages/core/src/obj/make.ts:758`; snapshot/restore in save path |
| is_unknown | 40 | PORTED | `ObjectListEntry.unknown` `packages/core/src/game/obj-list.ts:48`; set for sensed-null-glyph grids (`square_sense_pile`) at `:102-113`, drives sort/colour |
| item_test | 39 | N/A | Declared only in `obj-util.h:39`; no definition anywhere under `reference/src/**/*.c` — dead public prototype (callers use `object_test` / `item_tester` callbacks) |
| lookup_artifact_name | 45 | PORTED | Exact-name lookup: `ObjRegistry.findArtifact` `packages/core/src/obj/bind.ts:473` and save history restore `packages/core/src/session/save.ts:699`. Fuzzy substring fallback is wizard/load convenience only; JSON save uses names/ids |
| lookup_ego_item | 46 | PORTED | `ObjRegistry.findEgo` `packages/core/src/obj/bind.ts:465` plus `EgoItem.possItems` kidx set (bind `:409-410`, make/effect-item use name+kidx). C's tval/sval gate is the poss-items membership check |
| mark_artifact_created | 86 | PORTED | `ArtifactState.markCreated` `packages/core/src/obj/make.ts:753`; used when artifacts are created/destroyed |
| mark_artifact_everseen | 88 | PORTED | `ArtifactState.markEverseen` `packages/core/src/obj/make.ts:771` |
| mark_artifact_seen | 87 | PORTED | `ArtifactState.markSeen` `packages/core/src/obj/make.ts:762` |
| obj_can_activate | 54 | PORTED | Activate command filter `packages/core/src/game/obj-cmd.ts:1167-1176` — has activation/artifact and `timeout === 0`; UI picker `packages/web/src/main.ts:1881-1897` lists equipped activations |
| obj_can_browse | 57 | PORTED | `playerObjectToBook` `packages/core/src/player/spell.ts:184` (class book tval/sval match); context menu book gate uses the same |
| obj_can_cast_from | 58 | PORTED | Book = `playerObjectToBook` + castable spells via `spellOkayToCast` / `spellBookCountSpells` (`spell.ts:220-233`); live cast `packages/core/src/game/spell-cmd.ts:237-249` |
| obj_can_fail | 71 | PORTED | `objCanFail` `packages/web/src/screens.ts:297` — device tval or wearable; drives OLIST_FAIL via `deviceFailColumn` `:307` |
| obj_can_fire | 63 | PORTED | Fire picker `packages/web/src/main.ts:2366-2369` (`tval === ammoTval`); core recheck `packages/core/src/game/ranged-cmd.ts:207-215` |
| obj_can_study | 59 | PORTED | Study path requires class book + `spellOkayToStudy` `packages/core/src/game/spell-cmd.ts:314-340` (`playerObjectToBook` + per-spell study filter) |
| obj_can_takeoff | 60 | MISSING | Sticky (`OF_STICKY`) gate absent on live takeoff/drop/wield-replace — see finding W1-obj-util-001 |
| obj_can_throw | 61 | PORTED | `throwCmd` `packages/web/src/main.ts:2398-2404` — any non-equipped item, or equipped melee weapon that is not sticky; core throw auto-takes-off equipped weapon `ranged-cmd.ts:311-316` |
| obj_can_wear | 62 | PORTED | `wieldSlot` `packages/core/src/game/gear.ts:205` returns slot or -1; wield picker filters `tvalIsWearable` `packages/web/src/main.ts:5613` |
| obj_has_charges | 51 | INLINED | Device use pre-check `packages/core/src/game/obj-cmd.ts:978-988` (`USE.CHARGE && pval <= 0`) plus empty-device path in `checkDevices` `:334-337` — same as `tval_can_have_charges && pval > 0` |
| obj_has_flag | 67 | INLINED | Sole C caller is `obj_can_takeoff`. Port uses `obj.flags.has(flag)` at sticky/flag sites; curse-template flags fold into bonuses/power separately (`calcs` curse loop, `power.ts:607-610`) |
| obj_is_activatable | 53 | PORTED | Equipped items with `obj.activation` listed for activate (`main.ts:1889-1890`); `objectUseKind` returns `"activatable"` when `obj.activation` set (`main.ts:1521`) |
| obj_is_known_artifact | 65 | PORTED | `liveObjectIsKnownArtifact` `packages/core/src/obj/artifact-known.ts:26` — artifact + `OBJ_NOTICE.ASSESSED`; same gate in `obj-list.ts:178` |
| obj_is_throwing | 64 | INLINED | `obj.flags.has(OF.THROWING)` in ranged combat (`packages/core/src/combat/ranged.ts:88,146,210,233,389`) — no separate helper needed |
| obj_is_useable | 68 | PORTED | Generic use `useGenericCmd` `packages/web/src/main.ts:4252-4292` (devices/consumables + worn activations); ammo use is separate fire path with `obj_can_fire` |
| obj_kind_can_browse | 56 | PORTED | `canBrowseBook` wired in `packages/core/src/session/game.ts:859` from class book keys; used by object generation to reject unreadable books |
| object_flags | 36 | INLINED | Plain copy of `obj.flags` — used as-is in `packages/core/src/obj/power.ts:460` and `wizDisplayItem` `packages/core/src/game/wizard.ts:1198` |
| object_flags_known | 37 | PORTED | Knowledge twin: `objectKnownShadow` intersects known flags (`packages/core/src/obj/known-object.ts:469-473`); wizard panel `flagsKnown` `wizard.ts:1199`; object-info uses shadow flags `:1672` |
| object_short_name | 48 | PORTED | Strip leading `& ` and `~`: `objDescNameFormat` `packages/core/src/obj/desc.ts:301` / bind helper `bind.ts:296`; also `objBaseName` `knowledge.ts:148` |
| object_test | 38 | INLINED | Item pickers apply a tester and skip null/money (`selectItemFrom` filters; floor/gear listing skips gold in object list). No named export — same tail-call-or-true shape |
| object_to_ac | 35 | PORTED | `objectToAc` `packages/core/src/obj/desc.ts:132` (base `toA` + curse object bonuses); live on assessed combat describe `:443` |
| objkind_byid | 44 | PORTED | `ObjRegistry.kindByIdx` `packages/core/src/obj/bind.ts:410` |
| print_custom_message | 80 | PORTED | `substituteTimedMessage` `packages/core/src/player/timed.ts:61` (`{name}`/`{kind}`/`{s}`/`{is}`); wired with live weapon desc in `session/game.ts:1550-1565` |
| verify_object | 78 | PORTED | `confirmYesNo` / `getCheck` for ignore-drop of equipped items `packages/web/src/main.ts:2048` (`Really take off and drop …?`); same get_check UI used elsewhere |

## MISSING findings

### W1-obj-util-001  obj_can_takeoff
ref:      reference/src/obj-util.c:794-796 (`!obj_has_flag(obj, OF_STICKY)`); callers `cmd-obj.c:251` (takeoff filter), `:314` (wield into stickied slot), `:378` (drop equipped sticky)
port:     partial only — `objCanTakeoff` local in `packages/core/src/store/transact.ts:74` (store sell / home deposit); throw UI sticky filter `packages/web/src/main.ts:2400-2403`; digger skip `best-digger.ts:57`. **Not** on takeoff/drop/wield live paths
missing:  Takeoff (`obj-cmd.ts:1083-1105`, `main.ts:takeOffItem` filter `() => true`), drop (`obj-cmd.ts:1108` / `invenDrop` `:245-247` always takes off), and wield-replace (`invenWield` / do_cmd_wield) do not refuse `OF_STICKY` equipment. Sticky message on wear (`obj-cmd.ts:1061`) is present; enforcement is not
effect:   Sticky artifacts (e.g. The One Ring, `artifact.txt` STICKY) can be taken off, dropped, or replaced freely — players escape permanent-stick cursed gear
severity: P1
confidence: high

## Counts

| verdict | n |
|---|---:|
| PORTED | 28 |
| INLINED | 5 |
| N/A | 1 |
| MISSING | 1 |
| UNSURE | 0 |
| **total** | **35** |

---

## Gate notes (Opus, 2026-07-25)

**`obj_can_takeoff` (W1-obj-util-001) confirmed P1, and worth calling out as the
most consequential W1 finding so far.** `OF_STICKY` is checked in the store /
home / throw / digger paths but not on takeoff, drop, or wield-replace, so sticky
cursed equipment — The One Ring among others — can simply be removed. The curse
mechanic is defeated entirely, not merely mis-messaged. The wear-time message is
present, which is what makes the gap easy to miss by reading.
