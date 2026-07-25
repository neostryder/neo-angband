### L3_data-001  old_class data has no compiled counterpart
sev: P3
concession: n
ref: reference/lib/gamedata/old_class.txt:1-5
port: packages/content/src/specs/index.ts:3-5 (and no packages/content/pack/old_class.json)
expected: The old spellcasting classes remain available as an alternate class.txt-compatible data source, as the file documents.
actual: The content specs explicitly defer old_class.txt and no compiled pack or manifest entry exists for it.
why: The browser content system cannot supply this alternate class dataset even though the upstream reference provides it.
confidence: high

### L3_data-002  Quest records are omitted from the live game pack
sev: P0
concession: n
ref: reference/src/player-quest.c:76-83,157-163,219-224; reference/lib/gamedata/quest.txt:10-18
port: packages/web/src/pack.ts:374-418
expected: The C parser loads the Sauron and Morgoth quest records, player birth copies them into quest history, and quest_check can complete the final guardian quest and win the game.
actual: loadGamePack returns no quest field, so bindCore receives no quest records and produces an empty quest table despite quest.json being compiled.
why: Normal web gameplay has no guardian quests and no reachable Morgoth victory condition.
confidence: high

### L3_data-003  Chest trap pack data is bypassed by a hardcoded table
sev: P3
concession: n
ref: reference/src/obj-chest.c:55-74; reference/lib/gamedata/chest_trap.txt:30-81
port: packages/core/src/obj/chest.ts:21-23,58-135; packages/web/src/pack.ts:374-418
expected: C parses chest_trap.txt into the linked chest_traps list, assigning pval order and using those records for trap selection and effects.
actual: The live chest module hardcodes all seven entries, and loadGamePack never passes chest_trap.json to it.
why: The shipped compiled chest-trap data and any content override have no effect on live chest behavior.
confidence: high

### L3_data-004  Store hints are compiled but never supplied or displayed
sev: P2
concession: n
ref: reference/src/ui-store.c:120-128,156-158; reference/lib/gamedata/hints.txt:14-88
port: packages/web/src/pack.ts:374-418; packages/web/src/shop.ts:197-199
expected: The C store greeting takes a one-in-three branch when hints is loaded, selects a random hint using the upstream RNG, and displays it.
actual: loadGamePack omits hints, and the shop explicitly skips the hint branch because no hints list is loaded.
why: Store greetings lack the visible hint messages and the corresponding upstream control flow and RNG draws.
confidence: high

### L3_data-005  World-map records are compiled but unreachable
sev: P3
concession: n
ref: reference/src/init.c:1087-1119,1122-1176; reference/lib/gamedata/world.txt:6-134
port: packages/web/src/pack.ts:374-418
expected: C parses the world records into the linked world map, resolves each up/down name, and validates the referenced levels.
actual: loadGamePack has no world field and no runtime world-map registry or consumer; world.json is only bundled as an unbound compiled file.
why: The port cannot use the reference world level names or links for world navigation.
confidence: high

## MAP L3_data
reference/lib/gamedata/activation.txt -> packages/content/pack/activation.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/artifact.txt -> packages/content/pack/artifact.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/blow_effects.txt -> packages/content/pack/blow_effects.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/blow_methods.txt -> packages/content/pack/blow_methods.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/body.txt -> packages/content/pack/body.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/brand.txt -> packages/content/pack/brand.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/chest_trap.txt -> packages/content/pack/chest_trap.json; packages/content/src/specs/misc.ts; packages/core/src/obj/chest.ts
reference/lib/gamedata/class.txt -> packages/content/pack/class.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/constants.txt -> packages/content/pack/constants.json; packages/content/src/specs/init.ts; packages/core/src/constants.ts
reference/lib/gamedata/curse.txt -> packages/content/pack/curse.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/dungeon_profile.txt -> packages/content/pack/dungeon_profile.json; packages/content/src/specs/generate.ts; packages/core/src/gen/cave.ts
reference/lib/gamedata/ego_item.txt -> packages/content/pack/ego_item.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/flavor.txt -> packages/content/pack/flavor.json; packages/content/src/specs/init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/hints.txt -> packages/content/pack/hints.json; packages/content/src/specs/init.ts; packages/web/src/shop.ts
reference/lib/gamedata/history.txt -> packages/content/pack/history.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/monster.txt -> packages/content/pack/monster.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/monster_base.txt -> packages/content/pack/monster_base.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/monster_spell.txt -> packages/content/pack/monster_spell.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/names.txt -> packages/content/pack/names.json; packages/content/src/specs/init.ts; packages/core/src/session/boot.ts
reference/lib/gamedata/object.txt -> packages/content/pack/object.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/object_base.txt -> packages/content/pack/object_base.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/object_property.txt -> packages/content/pack/object_property.json; packages/content/src/specs/obj-init.ts; packages/web/src/pack.ts
reference/lib/gamedata/old_class.txt -> NONE
reference/lib/gamedata/p_race.txt -> packages/content/pack/p_race.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/pain.txt -> packages/content/pack/pain.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/pit.txt -> packages/content/pack/pit.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/player_property.txt -> packages/content/pack/player_property.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/player_timed.txt -> packages/content/pack/player_timed.json; packages/content/src/specs/misc.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/projection.txt -> packages/content/pack/projection.json; packages/content/src/specs/obj-init.ts; packages/core/src/session/boot.ts
reference/lib/gamedata/quest.txt -> packages/content/pack/quest.json; packages/content/src/specs/misc.ts; packages/core/src/game/quest.ts; packages/web/src/pack.ts
reference/lib/gamedata/realm.txt -> packages/content/pack/realm.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/room_template.txt -> packages/content/pack/room_template.json; packages/content/src/specs/generate.ts; packages/core/src/gen/room.ts
reference/lib/gamedata/shape.txt -> packages/content/pack/shape.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/slay.txt -> packages/content/pack/slay.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/store.txt -> packages/content/pack/store.json; packages/content/src/specs/misc.ts; packages/core/src/store/bind.ts
reference/lib/gamedata/summon.txt -> packages/content/pack/summon.json; packages/content/src/specs/misc.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/terrain.txt -> packages/content/pack/terrain.json; packages/content/src/specs/init.ts; packages/core/src/world/feature.ts
reference/lib/gamedata/trap.txt -> packages/content/pack/trap.json; packages/content/src/specs/init.ts; packages/core/src/world/trap.ts
reference/lib/gamedata/ui_entry.txt -> packages/content/pack/ui_entry.json; packages/content/src/specs/ui-entry.ts; packages/web/src/pack.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_entry_base.txt -> packages/content/pack/ui_entry_base.json; packages/content/src/specs/ui-entry.ts; packages/web/src/pack.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_entry_renderer.txt -> packages/content/pack/ui_entry_renderer.json; packages/content/src/specs/ui-entry.ts; packages/web/src/pack.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_knowledge.txt -> packages/content/pack/ui_knowledge.json; packages/content/src/specs/misc.ts; packages/core/src/mon/knowledge-groups.ts
reference/lib/gamedata/vault.txt -> packages/content/pack/vault.json; packages/content/src/specs/generate.ts; packages/core/src/gen/room.ts
reference/lib/gamedata/visuals.txt -> packages/content/pack/visuals.json; packages/content/src/specs/visuals.ts; packages/core/src/visuals/engine.ts
reference/lib/gamedata/world.txt -> packages/content/pack/world.json; packages/content/src/specs/init.ts; packages/web/src/pack.ts
