# L4_objects audit (objects / obj-*)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: list-* headers + obj-*.c/h + object.h. Searched packages/ (excl. node_modules, dist, borg).

### L4_objects-001  EF_DETECT_TRAPS never identifies chest traps
sev: P1
concession: n
ref: reference/src/effect-handler-general.c:1356-1373 (scan floor piles for is_trapped_chest, object_see, set obj->known->pval = obj->pval); reference/src/obj-chest.c:444 (CHEST_TRAPPED requires known->pval)
port: packages/core/src/game/effect-detect.ts:180-209 (handleDETECT_TRAPS)
expected: Detect Traps walks every object on each scanned grid; for each non-ignored trapped chest whose known pval does not yet match the live pval, the player sees the chest and known->pval is set so trap names and disarm become available.
actual: Only floor-trap reveal + SQUARE_DTRAP mark. Comment claims "chest-trap identification rides obj knowledge" but there is no chest pile scan and no place to store known chest pval. Detection never teaches chest traps.
why: Detection spell/scroll/rod fails to reveal chest traps; player cannot learn trap state the C way.
confidence: high

### L4_objects-002  Chest known pval never tracked; disarm always treats traps as known
sev: P1
concession: n
ref: reference/src/obj-knowledge.c:1042-1043 (player_know_object never copies pval for chests); reference/src/obj-chest.c:702-707 (disarm requires known->pval); reference/src/obj-desc.c:361-365 (trap name gated on known->pval); reference/src/effect-handler-general.c:1364-1369; reference/src/project-obj.c:365
port: packages/core/src/obj/known-object.ts:438-440 (always skips chest pval on shadow); packages/core/src/game/chest.ts:110-112,325-332 (CHEST_TRAPPED / disarm omit known-pval gate); packages/core/src/obj/desc.ts:407-410
expected: Chest trap/lock state is learned only via detect, kill-trap unlock, store, birth, etc., by writing known->pval. Disarm of unknown traps says "I don't see any traps." Names show only once known.
actual: On-demand shadow never carries chest pval. chestCheck(CHEST_TRAPPED) returns any trapped chest. doCmdDisarmChest skips the known-pval branch and always attempts disarm. Descriptions never show "(gas trap)" etc. for unopened chests (only "(empty)" when pval is 0).
why: Players can disarm undetected chest traps and never see trap type in the name; diverges from core identification gameplay.
confidence: high

### L4_objects-003  pack_overflow not implemented; takeoff/wield can leave pack permanently overfull
sev: P1
concession: n
ref: reference/src/obj-gear.c:1338-1389 (pack_is_overfull / pack_overflow drops last inven item); reference/src/obj-gear.c:1009-1010 (inven_wield calls pack_overflow after takeoff); reference/src/game-world.c:947
port: packages/core/src/game/gear.ts:20-21,387; packages/core/src/game/obj-cmd.ts:191-198,206-216
expected: After takeoff/wield (or end-of-turn notice), if pack_slots_used > pack_size the game disturbs, messages "Your pack overflows!", drops the last inventory item near the player.
actual: invenTakeoff always pack.push(handle). invenWield takeoff path never calls pack_overflow. Module docs mark overflow DEFERRED. No packOverflow function exists in packages/.
why: Full pack + replace equipped item (or takeoff) leaves more than pack_size items with no forced drop; free extra capacity.
confidence: high

### L4_objects-004  Opening an empty chest does not set OBJ_NOTICE_IGNORE
sev: P2
concession: n
ref: reference/src/obj-chest.c:636-640 (after open, if pval==0 set obj->known->notice |= OBJ_NOTICE_IGNORE); also PN_IGNORE on successful open L633
port: packages/core/src/game/chest.ts:241-281 (doCmdOpenChest)
expected: Opened empty chests are marked ignored so floor autoignore/ignore_item_ok treats them as junk.
actual: doCmdOpenChest never sets obj.notice IGNORE (or known twin notice). Empty opened chests remain non-ignored unless the player manually ignores them.
why: Floor piles keep empty chests visible/interactable contrary to upstream auto-ignore.
confidence: high

### L4_objects-005  KILL_TRAP unlock does not set known chest pval
sev: P2
concession: n
ref: reference/src/project-obj.c:355-369 (unlock_chest then obj->known->pval = obj->pval before "Click!")
port: packages/core/src/game/project-obj.ts:171-185
expected: Disarm/unlock projection copies live pval into known twin so the chest's open/disarmed state is known.
actual: unlockChest only; comment acknowledges known->pval reveal but does not store it (and known-object synthesis never exposes chest pval anyway).
why: After magical unlock, C knows the chest state; port does not, compounding L4_objects-002.
confidence: high

### L4_objects-006  Runtime chest trap table is hardcoded, not bound from pack chest_trap.json
sev: P3
concession: n
ref: reference/src/obj-chest.c:53-282 (chest_trap_parser loads chest_trap.txt into chest_traps list; pvals assigned 1,2,4,...)
port: packages/core/src/obj/chest.ts:21-24,58-135 (CHEST_TRAPS constant); packages/content/pack/chest_trap.json (compiled data unused by runtime)
expected: Live game uses the parsed gamedata table (moddable via chest_trap.txt / pack).
actual: Engine uses a hand-copied CHEST_TRAPS array. Stock 4.2.6 values match pack/chest_trap.json (re-derived: names, levels, effects, msgs, destroy/magic), so stock play matches today.
why: Latent mod/data drift: pack or gamedata changes will not affect gameplay until the hardcode is updated.
confidence: high

### L4_objects-007  object_similar still skips object_is_equipped after gear exists
sev: P3
concession: n
ref: reference/src/obj-pile.c:399-403 (equipped items never stack)
port: packages/core/src/obj/object.ts:884-889
expected: object_similar returns false if either object is equipped.
actual: Comment says "no player gear yet" and skips the check. Gear is live (game/gear.ts). Callers mostly only merge pack/floor stacks so default paths avoid the bug, but any merge that receives an equipped GameObject would wrongly allow stacking.
why: Incomplete port of stacking invariants; latent if a new path merges equipment.
confidence: med

### L4_objects-008  object_list_collect uses live floor piles gated by known-grid markers, not player-cave object array
sev: P2
concession: n
ref: reference/src/obj-list.c:156-230 (scan player->cave->objects[i], count from known kind vs live kind)
port: packages/core/src/game/obj-list.ts:10-16,83-134
expected: List is built from the player's memorised object array (known twins), with unknown kinds counting as 1 and ignore via ignore_known_item_ok.
actual: Port walks state.known.objects grid markers and enumerates live state.floor piles (plus null-glyph unknown entries). Documented as knowledge-model reduction. Can list live pile contents that differ from what the known cave would remember (order, multi-object grids, moved items).
why: Object list panel can disagree with C on what is listed/counts when knowledge and live floor diverge.
confidence: high

## MAP L4_objects
reference/src/list-ignore-types.h -> packages/core/src/generated/ignore-types.ts (ITYPE + IGNORE_TYPE_ENTRIES; scripts/codegen-lists.mjs)
reference/src/list-kind-flags.h -> packages/core/src/generated/kind-flags.ts (KF + KIND_FLAG_ENTRIES)
reference/src/list-object-flags.h -> packages/core/src/generated/object-flags.ts (OF + OBJECT_FLAG_ENTRIES; OF_NONE prepended)
reference/src/list-object-modifiers.h -> packages/core/src/generated/object-modifiers.ts (OBJ_MOD + stats 0-4 + STEALTH..)
reference/src/list-origins.h -> packages/core/src/generated/origins.ts (ORIGIN + ORIGIN_ENTRIES)
reference/src/list-tvals.h -> packages/core/src/generated/tvals.ts (TV + TVAL_ENTRIES)
reference/src/obj-chest.c -> packages/core/src/obj/chest.ts (pval model, pick_chest_traps, predicates, names, hardcoded CHEST_TRAPS); packages/core/src/game/chest.ts (chest_check, count_chests, chest_trap, chest_death, open/disarm); packages/content/src/specs/misc.ts + pack/chest_trap.json (data compile only)
reference/src/obj-chest.h -> packages/core/src/obj/chest.ts (CHEST_QUERY, ChestTrapEntry API)
reference/src/obj-curse.c -> packages/core/src/obj/object.ts (append/remove/copy curses, conflict, weight, apply_curse_attributes); packages/core/src/game/curse-tick.ts (do_curse_effect + timeout loop)
reference/src/obj-curse.h -> packages/core/src/obj/object.ts; packages/core/src/game/curse-tick.ts
reference/src/obj-desc.c -> packages/core/src/obj/desc.ts (object_desc + helpers)
reference/src/obj-desc.h -> packages/core/src/obj/desc.ts (ODESC flags)
reference/src/object.h -> packages/core/src/obj/types.ts (kind/ego/artifact/brand/slay/curse/activation/base structs, element ranges); packages/core/src/obj/object.ts (GameObject live instance); packages/core/src/generated/origins.ts (ORIGIN enum)
reference/src/obj-gear.c -> packages/core/src/game/gear.ts (slots, carry, quiver, combine_pack, outfit); packages/core/src/game/obj-cmd.ts (inven_wield/takeoff/drop); packages/core/src/obj/object.ts (object_pack_total); packages/core/src/generated/equip-slots.ts
reference/src/obj-gear.h -> packages/core/src/game/gear.ts; packages/core/src/generated/equip-slots.ts
reference/src/obj-ignore.c -> packages/core/src/obj/ignore.ts (quality mapping, ignore_level_of, object_is_ignored, IgnoreSettings); packages/core/src/game/ignore-cmd.ts; packages/web/src/ignore-menu.ts (UI); packages/core/src/obj/knowledge.ts (AutoinscriptionRegistry pieces)
reference/src/obj-ignore.h -> packages/core/src/obj/ignore.ts; packages/core/src/generated/ignore-types.ts
reference/src/obj-info.c -> packages/core/src/obj/object-info.ts (object_info_out body); packages/core/src/game/object-inspect.ts (session glue); packages/core/src/obj/effects-info.ts (activation summaries)
reference/src/obj-info.h -> packages/core/src/obj/object-info.ts
reference/src/obj-init.c -> packages/content/src/specs/obj-init.ts (parser specs); packages/core/src/obj/bind.ts (ObjRegistry binding); packages/content/src/parser.ts + records.ts + compile.ts; packages/content/pack/*.json
reference/src/obj-init.h -> packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/src/obj-knowledge.c -> packages/core/src/obj/knowledge.ts (rune learn-by-use); packages/core/src/obj/known-object.ts (on-demand known shadow, sense/see/touch); packages/core/src/game/known.ts (player cave knowledge / update_player_object_knowledge glue); packages/core/src/obj/artifact-known.ts
reference/src/obj-knowledge.h -> packages/core/src/obj/knowledge.ts; packages/core/src/obj/known-object.ts
reference/src/obj-list.c -> packages/core/src/game/obj-list.ts
reference/src/obj-list.h -> packages/core/src/game/obj-list.ts
reference/src/obj-make.c -> packages/core/src/obj/make.ts (prep, alloc, apply_magic, make_object/gold/artifacts); packages/core/src/obj/artifact-fake.ts (make_fake_artifact); packages/core/src/obj/chest.ts (pick_chest_traps via apply_magic)
reference/src/obj-make.h -> packages/core/src/obj/make.ts
reference/src/obj-pile.c -> packages/core/src/obj/object.ts (similar/stackable/mergeable/absorb/origin_combine); packages/core/src/game/floor.ts (floor_carry, drop_near, piles); packages/core/src/game/gear.ts (object_split); packages/core/src/game/pickup.ts
reference/src/obj-pile.h -> packages/core/src/obj/object.ts (OSTACK_*); packages/core/src/game/floor.ts
reference/src/obj-power.c -> packages/core/src/obj/power.ts (object_power); packages/core/src/obj/value.ts (object_value / object_value_real / object_value_base)
reference/src/obj-power.h -> packages/core/src/obj/power.ts (INHIBIT_*, AMMO_RESCALER constants)
reference/src/obj-properties.c -> packages/core/src/obj/make.ts (create_obj_flag_mask); packages/core/src/obj/knowledge.ts (flag_message, sustain_flag); packages/core/src/obj/power.ts (lookup_obj_property)
reference/src/obj-properties.h -> packages/core/src/obj/types.ts (OFT/OFID/OBJ_PROPERTY enums, OF_SIZE); packages/core/src/generated/object-flags.ts + object-modifiers.ts + kind-flags.ts + tvals.ts
reference/src/obj-randart.c -> packages/core/src/obj/randart.ts (do_randart, design_artifact, create set); packages/core/src/obj/randart-build.ts (abilities, prep, freqs); packages/core/src/obj/randart-data.ts; packages/core/src/obj/randname.ts; packages/core/src/generated/randart-properties.ts
reference/src/obj-randart.h -> packages/core/src/obj/randart.ts; packages/core/src/obj/randart-build.ts
reference/src/obj-slays.c -> packages/core/src/combat/brand-slay.ts (react/improve/learn brand-slay); packages/core/src/obj/object.ts (copy_slays, copy_brands, same_monsters_slain)
reference/src/obj-slays.h -> packages/core/src/combat/brand-slay.ts; packages/core/src/obj/object.ts
reference/src/obj-tval.c -> packages/core/src/obj/object.ts (tval_is_* predicates); packages/core/src/obj/bind.ts (tval_find_idx, tval_find_name)
reference/src/obj-tval.h -> packages/core/src/obj/object.ts; packages/core/src/obj/types.ts (SV_UNKNOWN); packages/core/src/generated/tvals.ts
reference/src/obj-util.c -> packages/core/src/obj/flavor.ts (flavor_init); packages/core/src/obj/object.ts (weight, distribute_charges); packages/core/src/game/obj-cmd.ts (get_use_device_chance, number_charging, obj_can_*); packages/core/src/obj/recharge.ts; packages/core/src/obj/artifact-known.ts; packages/core/src/gen/util.ts (convert_depth_to_origin); packages/core/src/obj/bind.ts (lookup_kind, lookup_sval); packages/core/src/game/obj-list.ts (compare_items for list sort)
reference/src/obj-util.h -> packages/core/src/obj/flavor.ts; packages/core/src/game/obj-cmd.ts; packages/core/src/obj/object.ts; packages/core/src/obj/types.ts (MAX_PVAL)
