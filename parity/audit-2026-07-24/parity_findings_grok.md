# L3_data findings (gamedata *.txt vs pack *.json)

Audit method (re-derived 2026-07-24; not trusting prior maps):
- Real port path: packages/content compiler (src/parser.ts, src/records.ts,
  src/specs/*, src/compile.ts) emits packages/content/pack/*.json from
  reference/lib/gamedata/*.txt. C parse_file targets confirmed for every
  live gamedata stem; only old_class is absent from both C loaders and pack.
- Every C parser_reg format string (including multi-line string concatenation
  and ui_entry label1-label10 via MAX_SHORTENED=10 format loop) matches the
  TypeScript FileSpec directive list (44/44 specs, 0 imperfect).
- Recompiled all 44 specs from source; deep-equal vs committed pack: 0 diffs.
- Parsed every non-comment directive line (0 parse failures, 0 unregistered
  directives). Membership-checked 56968 field values from source lines
  against pack JSON (0 missing).
- Record order identity: monster 624, object 375, activation 163 (0 order
  mismatches). Spot-checked Morgoth combat (speed 140, hp 20000, ac 180,
  exp 60000, 4 blows, spell-freq 3), Mage Magic Missile nesting
  (BOLT_OR_BEAM/MISSILE dice $Dd4 expr D:PLAYER_LEVEL:- 1 / 5 + 3),
  constants world/melee-critical-level tables, quests, realms, brands,
  slays, vault D-row vs rows (0 mismatches), room_template row/D mismatches
  present in upstream data only.

Upstream data quirks preserved (NOT reported as port defects): room_template
rows vs D-line count mismatches (e.g. Sixpack rows:10 with 11 D lines);
duplicate chest_trap display names (poison needle, gas trap).

### L3_data-001  old_class.txt has no pack JSON (deferred; C also does not load)
sev: P3
concession: n
ref: reference/lib/gamedata/old_class.txt
port: packages/content/src/specs/index.ts:4-5 (deferred comment; not in gamedataSpecs)
expected: Lane lists this file; if it were live C gamedata it would need a pack. Upstream keeps it as retired reference data (rename to class.txt to use); no reference/src/*.c parse_file targets "old_class" (0 C source hits).
actual: No packages/content/pack/old_class.json; deliberately omitted from gamedataSpecs.
why: Unmapped lane file; gameplay impact none because C never loads old_class either.
confidence: high

### L3_data-002  object_property bindui not marked repeat though C accepts multiple
sev: P3
concession: n
ref: reference/src/obj-init.c:3401-3416 (parse_object_property_bindui calls bind_object_property_to_ui_entry_by_name per line); reference/lib/gamedata/object_property.txt:22-32 (comment: field can appear multiple times)
port: packages/content/src/specs/obj-init.ts:227 (bindui without repeat: true)
expected: Multiple bindui: lines on one property accumulate (C binds each in order).
actual: Spec stores a single bindui; a second bindui on the same record would throw duplicate-directive at compile time. Shipped object_property.txt has at most one bindui per record, so pack matches current data.
why: Latent packaging gap for mods or future multi-bindui properties; no defect on stock 4.2.6 data.
confidence: high

### L3_data-003  player_property bindui not marked repeat though C accumulates list
sev: P3
concession: n
ref: reference/src/init.c:1292-1332 (parse_player_prop_bindui prepends player_bound_ui linked list); reference/lib/gamedata/player_property.txt:21-31 (comment: can appear multiple times)
port: packages/content/src/specs/init.ts:55 (bindui without repeat: true)
expected: Multiple bindui: lines on one player property accumulate into a list (C).
actual: Spec stores a single bindui; a second bindui would fail compile. Shipped player_property.txt has at most one bindui per record, so pack matches current data.
why: Latent packaging gap for multi-bindui player properties; no defect on stock 4.2.6 data.
confidence: high

### L3_data-004  ui_entry priority not marked repeat though C allows per-category priorities
sev: P3
concession: n
ref: reference/src/ui-entry.c:2173-2221 (parse_entry_priority applies to default or last category); reference/lib/gamedata/ui_entry.txt:49-61 (category and priority can be set multiple times; priority after a category targets that category)
port: packages/content/src/specs/ui-entry.ts:39 (priority without repeat: true; shared by ui_entry and ui_entry_base)
expected: Multiple priority: lines are legal; a priority before any category sets the default, later ones attach to the last category.
actual: Spec stores a single scalar priority. A second priority line would throw at compile. category has repeat: true. Shipped ui_entry*.txt use at most one priority per record (default before categories), so pack matches current data.
why: Latent packaging gap for per-category priority overrides; no defect on stock 4.2.6 data.
confidence: high

## MAP L3_data
reference/lib/gamedata/activation.txt -> packages/content/pack/activation.json; packages/content/src/specs/obj-init.ts (activationSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_act)
reference/lib/gamedata/artifact.txt -> packages/content/pack/artifact.json; packages/content/src/specs/obj-init.ts (artifactSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_artifact)
reference/lib/gamedata/blow_effects.txt -> packages/content/pack/blow_effects.json; packages/content/src/specs/mon-init.ts (blowEffectsSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_eff)
reference/lib/gamedata/blow_methods.txt -> packages/content/pack/blow_methods.json; packages/content/src/specs/mon-init.ts (blowMethodsSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_meth)
reference/lib/gamedata/body.txt -> packages/content/pack/body.json; packages/content/src/specs/init.ts (bodySpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_body)
reference/lib/gamedata/brand.txt -> packages/content/pack/brand.json; packages/content/src/specs/obj-init.ts (brandSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_brand)
reference/lib/gamedata/chest_trap.txt -> packages/content/pack/chest_trap.json; packages/content/src/specs/misc.ts (chestTrapSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-chest.c (init_parse_chest_trap)
reference/lib/gamedata/class.txt -> packages/content/pack/class.json; packages/content/src/specs/init.ts (classSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_class)
reference/lib/gamedata/constants.txt -> packages/content/pack/constants.json; packages/content/src/specs/init.ts (constantsSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_constants)
reference/lib/gamedata/curse.txt -> packages/content/pack/curse.json; packages/content/src/specs/obj-init.ts (curseSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_curse)
reference/lib/gamedata/dungeon_profile.txt -> packages/content/pack/dungeon_profile.json; packages/content/src/specs/generate.ts (dungeonProfileSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/generate.c (init_parse_profile)
reference/lib/gamedata/ego_item.txt -> packages/content/pack/ego_item.json; packages/content/src/specs/obj-init.ts (egoItemSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_ego)
reference/lib/gamedata/flavor.txt -> packages/content/pack/flavor.json; packages/content/src/specs/init.ts (flavorSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_flavor)
reference/lib/gamedata/hints.txt -> packages/content/pack/hints.json; packages/content/src/specs/init.ts (hintsSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_hints)
reference/lib/gamedata/history.txt -> packages/content/pack/history.json; packages/content/src/specs/init.ts (historySpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_history)
reference/lib/gamedata/monster.txt -> packages/content/pack/monster.json; packages/content/src/specs/mon-init.ts (monsterSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_monster)
reference/lib/gamedata/monster_base.txt -> packages/content/pack/monster_base.json; packages/content/src/specs/mon-init.ts (monsterBaseSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_mon_base)
reference/lib/gamedata/monster_spell.txt -> packages/content/pack/monster_spell.json; packages/content/src/specs/mon-init.ts (monsterSpellSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_mon_spell)
reference/lib/gamedata/names.txt -> packages/content/pack/names.json; packages/content/src/specs/init.ts (namesSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_names)
reference/lib/gamedata/object.txt -> packages/content/pack/object.json; packages/content/src/specs/obj-init.ts (objectSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_object)
reference/lib/gamedata/object_base.txt -> packages/content/pack/object_base.json; packages/content/src/specs/obj-init.ts (objectBaseSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_object_base)
reference/lib/gamedata/object_property.txt -> packages/content/pack/object_property.json; packages/content/src/specs/obj-init.ts (objectPropertySpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_object_property)
reference/lib/gamedata/old_class.txt -> NONE (deferred; not in gamedataSpecs; C does not parse_file old_class)
reference/lib/gamedata/p_race.txt -> packages/content/pack/p_race.json; packages/content/src/specs/init.ts (pRaceSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_p_race)
reference/lib/gamedata/pain.txt -> packages/content/pack/pain.json; packages/content/src/specs/mon-init.ts (painSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_pain)
reference/lib/gamedata/pit.txt -> packages/content/pack/pit.json; packages/content/src/specs/mon-init.ts (pitSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-init.c (init_parse_pit)
reference/lib/gamedata/player_property.txt -> packages/content/pack/player_property.json; packages/content/src/specs/init.ts (playerPropertySpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_player_prop)
reference/lib/gamedata/player_timed.txt -> packages/content/pack/player_timed.json; packages/content/src/specs/misc.ts (playerTimedSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/player-timed.c (init_parse_player_timed)
reference/lib/gamedata/projection.txt -> packages/content/pack/projection.json; packages/content/src/specs/obj-init.ts (projectionSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_projection)
reference/lib/gamedata/quest.txt -> packages/content/pack/quest.json; packages/content/src/specs/misc.ts (questSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/player-quest.c (init_parse_quest)
reference/lib/gamedata/realm.txt -> packages/content/pack/realm.json; packages/content/src/specs/init.ts (realmSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_realm)
reference/lib/gamedata/room_template.txt -> packages/content/pack/room_template.json; packages/content/src/specs/generate.ts (roomTemplateSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/generate.c (init_parse_room)
reference/lib/gamedata/shape.txt -> packages/content/pack/shape.json; packages/content/src/specs/init.ts (shapeSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_shape)
reference/lib/gamedata/slay.txt -> packages/content/pack/slay.json; packages/content/src/specs/obj-init.ts (slaySpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/obj-init.c (init_parse_slay)
reference/lib/gamedata/store.txt -> packages/content/pack/store.json; packages/content/src/specs/misc.ts (storeSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/store.c (init_parse_stores)
reference/lib/gamedata/summon.txt -> packages/content/pack/summon.json; packages/content/src/specs/misc.ts (summonSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/mon-summon.c (init_parse_summon)
reference/lib/gamedata/terrain.txt -> packages/content/pack/terrain.json; packages/content/src/specs/init.ts (terrainSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_feat)
reference/lib/gamedata/trap.txt -> packages/content/pack/trap.json; packages/content/src/specs/init.ts (trapSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_trap)
reference/lib/gamedata/ui_entry.txt -> packages/content/pack/ui_entry.json; packages/content/src/specs/ui-entry.ts (uiEntrySpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/ui-entry.c (init_parse_ui_entry; also loads ui_entry_base then ui_entry)
reference/lib/gamedata/ui_entry_base.txt -> packages/content/pack/ui_entry_base.json; packages/content/src/specs/ui-entry.ts (uiEntryBaseSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/ui-entry.c (same init_parse_ui_entry, first parse_file)
reference/lib/gamedata/ui_entry_renderer.txt -> packages/content/pack/ui_entry_renderer.json; packages/content/src/specs/ui-entry.ts (uiEntryRendererSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/ui-entry-renderers.c (init_parse_ui_entry_renderer)
reference/lib/gamedata/ui_knowledge.txt -> packages/content/pack/ui_knowledge.json; packages/content/src/specs/misc.ts (uiKnowledgeSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/ui-knowledge.c (init_ui_knowledge_parser)
reference/lib/gamedata/vault.txt -> packages/content/pack/vault.json; packages/content/src/specs/generate.ts (vaultSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/generate.c (init_parse_vault)
reference/lib/gamedata/visuals.txt -> packages/content/pack/visuals.json; packages/content/src/specs/visuals.ts (visualsSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/ui-visuals.c (visuals_file_parser_init)
reference/lib/gamedata/world.txt -> packages/content/pack/world.json; packages/content/src/specs/init.ts (worldSpec); packages/content/src/records.ts; packages/content/src/parser.ts; C: reference/src/init.c (init_parse_world)
