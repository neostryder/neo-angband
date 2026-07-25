# Neo Angband Parity Findings - Terra (GPT-5.6 Terra)

Independent audit vs `reference/` (C oracle). Format per `parity/audit-2026-07-24/REVIEW_BRIEF.md`.
Findings are appended per lane below.

### L3_data-001  Retired class data has no compiled counterpart
sev: P3
concession: n
ref: reference/lib/gamedata/old_class.txt
port: NONE
expected: The provided old spellcasting class dataset remains available as an alternate class.txt-compatible data source.
actual: old_class.txt is deliberately excluded from gamedataSpecs and the core pack manifest.
why: The only reference gamedata file without a compiled counterpart cannot be selected or supplied by a content pack.
confidence: high

### L3_data-002  Quest data is dropped before game binding
sev: P0
concession: n
ref: reference/lib/gamedata/quest.txt:10
port: packages/web/src/pack.ts:374
expected: The Sauron and Morgoth quest records are bound at game startup, copied to a new player, and allow the Morgoth kill to set total_winner.
actual: loadGamePack omits quest.json even though CorePack and bindCore support it, so every new player gets an empty quest list.
why: The normal web game has no guardian quests or reachable victory condition.
confidence: high

### L3_data-003  Compiled chest-trap records are not the live trap source
sev: P3
concession: n
ref: reference/lib/gamedata/chest_trap.txt:30
port: packages/core/src/obj/chest.ts:58
expected: Chest trap definitions, including their effects and messages, are loaded from chest_trap.txt.
actual: The seven shipped definitions are duplicated as CHEST_TRAPS and chest_trap.json is never passed through loadGamePack or bound.
why: Content-pack changes to chest trap data have no effect, despite the compiled file being present.
confidence: high

### L3_data-004  World-map records are compiled but unreachable
sev: P3
concession: n
ref: reference/lib/gamedata/world.txt
port: packages/web/src/pack.ts:374
expected: World level depths, names, and up/down links are loaded for world-level navigation.
actual: world.json is included in the bundle but loadGamePack and CorePack expose no world-map field or consumer.
why: The compiled world data has no live behavior.
confidence: high

### L3_data-005  Gameplay hints are compiled but never supplied to shops
sev: P2
concession: n
ref: reference/lib/gamedata/hints.txt:14
port: packages/web/src/shop.ts:1
expected: The parsed hint list is available to the store UI, which can display a random hint as upstream does.
actual: hints.json is bundled but omitted from loadGamePack; the shop explicitly has no hints list.
why: The occasional visible store hint branch is permanently unreachable.
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
reference/lib/gamedata/hints.txt -> packages/content/pack/hints.json; packages/content/src/specs/init.ts
reference/lib/gamedata/history.txt -> packages/content/pack/history.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/monster.txt -> packages/content/pack/monster.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/monster_base.txt -> packages/content/pack/monster_base.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/monster_spell.txt -> packages/content/pack/monster_spell.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/names.txt -> packages/content/pack/names.json; packages/content/src/specs/init.ts; packages/core/src/session/boot.ts
reference/lib/gamedata/object.txt -> packages/content/pack/object.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/object_base.txt -> packages/content/pack/object_base.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/object_property.txt -> packages/content/pack/object_property.json; packages/content/src/specs/obj-init.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/old_class.txt -> NONE
reference/lib/gamedata/p_race.txt -> packages/content/pack/p_race.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/pain.txt -> packages/content/pack/pain.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/pit.txt -> packages/content/pack/pit.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/player_property.txt -> packages/content/pack/player_property.json; packages/content/src/specs/init.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/player_timed.txt -> packages/content/pack/player_timed.json; packages/content/src/specs/misc.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/projection.txt -> packages/content/pack/projection.json; packages/content/src/specs/obj-init.ts; packages/core/src/world/projection.ts
reference/lib/gamedata/quest.txt -> packages/content/pack/quest.json; packages/content/src/specs/misc.ts; packages/core/src/game/quest.ts
reference/lib/gamedata/realm.txt -> packages/content/pack/realm.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/room_template.txt -> packages/content/pack/room_template.json; packages/content/src/specs/generate.ts; packages/core/src/gen/room.ts
reference/lib/gamedata/shape.txt -> packages/content/pack/shape.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/slay.txt -> packages/content/pack/slay.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/store.txt -> packages/content/pack/store.json; packages/content/src/specs/misc.ts; packages/core/src/store/bind.ts
reference/lib/gamedata/summon.txt -> packages/content/pack/summon.json; packages/content/src/specs/misc.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/terrain.txt -> packages/content/pack/terrain.json; packages/content/src/specs/init.ts; packages/core/src/world/feature.ts
reference/lib/gamedata/trap.txt -> packages/content/pack/trap.json; packages/content/src/specs/init.ts; packages/core/src/world/trap.ts
reference/lib/gamedata/ui_entry.txt -> packages/content/pack/ui_entry.json; packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_entry_base.txt -> packages/content/pack/ui_entry_base.json; packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_entry_renderer.txt -> packages/content/pack/ui_entry_renderer.json; packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_knowledge.txt -> packages/content/pack/ui_knowledge.json; packages/content/src/specs/misc.ts; packages/core/src/mon/knowledge-groups.ts
reference/lib/gamedata/vault.txt -> packages/content/pack/vault.json; packages/content/src/specs/generate.ts; packages/core/src/gen/room.ts
reference/lib/gamedata/visuals.txt -> packages/content/pack/visuals.json; packages/content/src/specs/visuals.ts; packages/core/src/visuals/engine.ts
reference/lib/gamedata/world.txt -> packages/content/pack/world.json; packages/content/src/specs/init.ts

### L2_init_parse-001  Runtime user-file override and parser error flow are absent
sev: P3
concession: y
ref: reference/src/datafile.c:87
port: packages/content/src/compile.ts:31
expected: At runtime, parse_file first opens <user>/<filename>.txt, falls back to gamedata, parses line by line, logs up to the configured error limit, and preserves the first parser state.
actual: Gamedata is compiled to JSON before play from a supplied source directory; there is no runtime user-file fallback, parser-error limit, logging loop, or parser state.
why: Browser packs cannot directly reproduce the native user/gamedata filesystem lookup and diagnostic flow.
confidence: high

### L2_init_parse-002  Datafile archival and randart file movement are absent
sev: P3
concession: y
ref: reference/src/datafile.c:617
port: NONE
expected: The archive prefix, numbered/custom archive moves, and activate/deactivate randart file moves operate between user and archive directories.
actual: No equivalent archive or filesystem randart-file operations exist.
why: Native file moves and archive directories are unavailable in the browser storage model.
confidence: high

### L2_init_parse-003  Object value integer helpers accept C-rejected boundary values
sev: P3
concession: n
ref: reference/src/datafile.c:213
port: packages/core/src/obj/bind.ts:172
expected: find_value_arg and grab_int_range reject INT_MIN (-2147483648) and INT_MAX (2147483647), as well as values outside the C int range.
actual: The JavaScript regular-expression helpers accept those boundaries and any exactly represented larger decimal integer.
why: Modded values at C's rejected integer boundaries bind successfully instead of producing PARSE_ERROR_INVALID_VALUE.
confidence: high

### L2_init_parse-004  Parser hook/state API is not implemented
sev: P3
concession: n
ref: reference/src/parser.c:99
port: packages/content/src/parser.ts:338
expected: A parser owns registered callbacks, parsed typed values, private data, line/column/error state, and invokes the matching hook.
actual: parseLine is a stateless compiler helper returning a directive and scalar record; it has no hook registration, private data, parser state, or typed random-value result.
why: The reference reusable parser API cannot be used by port code or content extensions.
confidence: high

### L2_init_parse-005  Terrain look phrases lack C's trailing-space finalization
sev: P2
concession: n
ref: reference/src/init.c:2293
port: packages/core/src/world/feature.ts:132
expected: finish_parse_feat appends one space to every nonempty look-prefix and look-in-preposition that does not already end in a space.
actual: FeatureRegistry preserves the compiled text exactly.
why: A terrain record whose phrase omits its terminal space produces concatenated visible look text instead of C's separated phrase.
confidence: high

### L2_init_parse-006  Random-name word order is not reversed
sev: P1
concession: n
ref: reference/src/init.c:1476
port: packages/core/src/session/boot.ts:149
expected: Each names.txt word is prepended and finish_parse_names copies that linked-list order, so each section's indexed word array is reverse file order.
actual: bindCore stores each compiled word array in source file order.
why: The same RNG index selects a different random name or scroll title.
confidence: high

### L2_init_parse-007  Critical cutoff ordering is never validated
sev: P3
concession: n
ref: reference/src/init.c:986
port: packages/core/src/constants.ts:296
expected: constants finalization rejects melee or ranged critical tables whose non-final cutoffs are not strictly increasing.
actual: bindConstants copies critical level arrays without any sequential-cutoff check.
why: Invalid modded critical data loads and changes the first matching critical level instead of failing initialization.
confidence: high

### L2_init_parse-008  Parsed world map has no runtime implementation
sev: P3
concession: n
ref: reference/src/init.c:1089
port: NONE
expected: world.txt levels are loaded with depth/name/up/down links and finalization rejects references to nonexistent levels.
actual: world.json is compiled but no package binds, validates, or exposes its records to the running game.
why: The reference world-map data and its cross-reference validation are unavailable.
confidence: high

### L2_init_parse-009  Parsed hints have no runtime implementation
sev: P3
concession: n
ref: reference/src/init.c:4336
port: NONE
expected: hints.txt is loaded into the global hint list for the game to consume.
actual: hints.json is compiled but no runtime package loads or exposes it.
why: Upstream hint data cannot be displayed through the port's game initialization path.
confidence: high

## MAP L2_init_parse
reference/src/datafile.c -> packages/content/src/compile.ts; packages/core/src/obj/bind.ts
reference/src/datafile.h -> packages/content/src/compile.ts; packages/core/src/obj/bind.ts
reference/src/init.c -> packages/content/src/specs/init.ts; packages/core/src/constants.ts; packages/core/src/player/bind.ts; packages/core/src/player/spell.ts; packages/core/src/session/boot.ts; packages/core/src/session/game.ts; packages/core/src/world/feature.ts; packages/core/src/world/trap.ts
reference/src/init.h -> packages/core/src/constants.ts; packages/core/src/session/boot.ts; packages/core/src/session/game.ts
reference/src/parser.c -> packages/content/src/parser.ts; packages/content/src/records.ts
reference/src/parser.h -> packages/content/src/parser.ts

### L1_rng_util-001  flag_next uses a different exhaustion sentinel
sev: P3
concession: n
ref: reference/src/z-bitflag.c:70
port: packages/core/src/bitflag.ts:100
expected: Exhaustion returns FLAG_END (0).
actual: Exhaustion returns NO_FLAG (-1).
why: C-compatible callers comparing the result with FLAG_END observe different iteration termination.
confidence: high

### L1_rng_util-002  Variadic bitflag helpers do not honor FLAG_END termination
sev: P3
concession: n
ref: reference/src/z-bitflag.c:394
port: packages/core/src/bitflag.ts:328
expected: A zero argument terminates the list and later flags are ignored.
actual: Zero is processed or rejected and later rest arguments remain processed.
why: The exported helper semantics differ for valid C sentinel-terminated flag lists.
confidence: high

### L1_rng_util-003  FlagSet rejects valid zero-byte flag sets
sev: P3
concession: n
ref: reference/src/z-bitflag.c:114
port: packages/core/src/bitflag.ts:389
expected: A size-zero set is valid; empty and full tests return true and wipes are no-ops.
actual: new FlagSet(0) throws.
why: The port narrows the valid C flagset-size domain.
confidence: high

### L1_rng_util-004  Debug bitflag APIs are absent
sev: P3
concession: n
ref: reference/src/z-bitflag.h:90
port: NONE
expected: Debug builds expose flag_has_dbg and flag_on_dbg with out-of-range diagnostics.
actual: No equivalent debug entry points exist.
why: The C debug API and its invariant-failure behavior cannot be invoked.
confidence: high

### L1_rng_util-005  Color capacity is 29 rather than 32
sev: P2
concession: n
ref: reference/src/z-color.h:77
port: packages/core/src/color.ts:40
expected: MAX_COLORS is 32, including three zero-initialized trailing rows.
actual: MAX_COLORS is 29 and the live web color editor cycles only 0 through 28.
why: Palette extent and the visible color-editor behavior differ.
confidence: high

### L1_rng_util-006  Color character conversion has different space and unknown fallbacks
sev: P2
concession: n
ref: reference/src/z-color.c:165
port: packages/core/src/color.ts:139
expected: NUL and space map to dark (0), and any unknown character maps to white (1).
actual: Space maps to shade (28) and an unknown character maps to -1.
why: Invalid or blank display color input yields different attributes.
confidence: high

### L1_rng_util-007  Color-name conversion lacks the C white fallback
sev: P2
concession: n
ref: reference/src/z-color.c:191
port: packages/core/src/color.ts:148
expected: Unknown names return white (1), while an empty name matches the zero-initialized trailing entry.
actual: Unknown and empty names return -1.
why: Color-name parsing can propagate an invalid attribute instead of the C fallback.
confidence: high

### L1_rng_util-008  Shade has incorrect textual color metadata
sev: P2
concession: n
ref: reference/src/z-color.c:60
port: packages/core/src/color.ts:135
expected: Palette entry 28 has shade RGB but its color-table name and character remain zero-initialized.
actual: Entry 28 is named Shade with a space character.
why: Textual color translation and spoiler output differ from C.
confidence: high

### L1_rng_util-009  Gamma-table API is missing
sev: P3
concession: n
ref: reference/src/z-color.c:283
port: NONE
expected: A mutable 256-byte gamma_table and build_gamma_table(gamma) implement C's integer Taylor-series correction.
actual: No gamma table or builder exists.
why: The reference color gamma-correction behavior is unavailable.
confidence: high

### L1_rng_util-010  Background glyph constants are missing
sev: P3
concession: n
ref: reference/src/z-color.h:80
port: NONE
expected: MULT_BG, BG_BLACK, BG_SAME, BG_DARK, and BG_MAX are exported.
actual: No equivalent constants are exported.
why: The C foreground/background attribute encoding API is incomplete.
confidence: high

### L1_rng_util-011  Re-seeding resets the WELL index
sev: P3
concession: n
ref: reference/src/z-rand.c:104
port: packages/core/src/rng.ts:140
expected: Rand_state_init warms up from the existing state_i and does not reset it.
actual: stateInit sets stateI to zero before warm-up.
why: A second seed gives a different WELL state and subsequent random stream.
confidence: high

### L1_rng_util-012  Rand_normal does not preserve int16 return narrowing
sev: P3
concession: n
ref: reference/src/z-rand.c:287
port: packages/core/src/rng.ts:240
expected: The int16_t return narrows results outside the signed 16-bit range.
actual: The TypeScript function returns an unrestricted number.
why: Direct callers using large valid C integer arguments get a different result.
confidence: high

### L1_rng_util-013  Rand_init and Rand_simple are absent
sev: P3
concession: n
ref: reference/src/z-rand.c:131
port: NONE
expected: C exposes global quick-to-complex initialization and a time/PID-based simple RNG.
actual: Rng requires a supplied seed and has no Rand_simple equivalent.
why: These exported C RNG behaviors are unavailable to port consumers.
confidence: high

### L1_rng_util-014  Empty inscriptions are not interned
sev: P2
concession: n
ref: reference/src/z-quark.c:31
port: packages/core/src/game/obj-cmd.ts:1161
expected: quark_add("") returns a nonzero interned empty-string handle.
actual: An empty inscription is normalized to null.
why: Empty-note identity, truthiness, and object display differ.
confidence: high

### L1_rng_util-015  Queue invariant failures are not preserved
sev: P3
concession: n
ref: reference/src/z-queue.c:32
port: packages/core/src/gen/cave.ts:689
expected: Fixed-capacity push overflow and empty pop abort.
actual: The substitute grows dynamically and empty pop returns undefined.
why: The queue invariant-failure semantics differ.
confidence: high

### L1_rng_util-016  Trailing textblock newlines add a blank rendered line
sev: P2
concession: n
ref: reference/src/z-textblock.c:311
port: packages/web/src/screens.ts:167
expected: textblock_calculate_lines drops the final zero-length line.
actual: wrapRuns emits an empty ScreenLine for a trailing newline.
why: Textblock output with a final newline has an extra visible blank line.
confidence: high

### L1_rng_util-017  Randart variance omits C saturation and exact arithmetic
sev: P1
concession: n
ref: reference/src/z-util.c:1625
port: packages/core/src/obj/randart-data.ts:248
expected: The calculation uses exact multiprecision intermediate values and clamps the result to INT_MAX.
actual: JavaScript-number arithmetic can lose integer precision and returns an unclamped value.
why: Large or modded artifact power values produce a different live varPower.
confidence: high

### L1_rng_util-018  Build identity strings are absent
sev: P3
concession: n
ref: reference/src/buildid.c:37
port: NONE
expected: buildid is "Angband 4.2.6", buildver is "4.2.6", and the C copyright text is linked into the program.
actual: No port build-identity module or equivalent exported strings exist.
why: Consumers cannot display the upstream build/version identity.
confidence: high

### L1_rng_util-019  GUID equality API is absent
sev: P3
concession: n
ref: reference/src/guid.c:22
port: NONE
expected: guid is an unsigned integer with guid_eq(a, b) equality.
actual: No equivalent guid type or equality function is implemented.
why: This C entity-identity API has no port counterpart.
confidence: high

### L1_rng_util-020  C configuration path defaults are absent
sev: P3
concession: y
ref: reference/src/config.h:51
port: NONE
expected: The configured default config, lib, and data paths are "./lib/" and Unix has a private user path.
actual: No filesystem-path configuration counterpart exists.
why: Browser storage and bundled assets cannot expose the C filesystem layout directly.
confidence: high

### L1_rng_util-021  C point-set API is absent
sev: P3
concession: n
ref: reference/src/z-type.c:78
port: NONE
expected: point_set_new, add_to_point_set, point_set_size, point_set_contains, and disposal implement a growable location collection.
actual: loc.ts ports the loc helpers but has no point_set counterpart.
why: The reference reusable location-set API is unavailable.
confidence: high

### L1_rng_util-022  C file abstraction is absent
sev: P3
concession: y
ref: reference/src/z-file.c:1
port: NONE
expected: ang_file and path/file helpers provide C filesystem, directory, and locking operations.
actual: No equivalent low-level file abstraction is implemented.
why: Browser execution cannot faithfully provide native filesystem and advisory-lock APIs.
confidence: high

### L1_rng_util-023  C printf-formatting abstraction is absent
sev: P3
concession: n
ref: reference/src/z-form.c:1
port: NONE
expected: format, vformat, strnfmt, vstrnfmt, and related bounded C formatting helpers are available.
actual: No C-compatible formatting module exists; callers use JavaScript template strings.
why: Formatting width, precision, and truncation semantics cannot be invoked.
confidence: high

### L1_rng_util-024  Quark interning API is not ported
sev: P3
concession: n
ref: reference/src/z-quark.c:21
port: NONE
expected: quark_add interns strings to stable nonzero handles and quark_str resolves handles.
actual: Object notes use nullable strings directly with no quark table or handles.
why: The C shared-string identity API is missing beyond the empty-inscription difference.
confidence: high

### L1_rng_util-025  Priority queue API is not ported
sev: P3
concession: n
ref: reference/src/z-queue.c:116
port: NONE
expected: q_new, q_push, q_pop, q_push_int, and q_pop_int provide fixed-capacity min-priority queues.
actual: gen/cave.ts has only an array FIFO substitute.
why: The C generic and priority queue behaviors are unavailable.
confidence: high

### L1_rng_util-026  Textblock API is only partially ported
sev: P3
concession: n
ref: reference/src/z-textblock.c:21
port: packages/core/src/obj/object-info.ts:121
expected: textblocks support colored append, padding, concatenation, wrapping, line calculation, and rendering callbacks.
actual: The port has narrow run-stream and web wrapping adapters without the C textblock API.
why: Most reference textblock operations cannot be invoked or composed.
confidence: high

### L1_rng_util-027  C allocation wrappers are absent
sev: P3
concession: y
ref: reference/src/z-virt.c:30
port: NONE
expected: Allocation, zero-allocation, reallocation, string-copy, and append wrappers implement C null and out-of-memory semantics.
actual: No equivalent module exists; JavaScript garbage collection and strings are used directly.
why: C manual-memory behavior cannot be reproduced in the browser runtime.
confidence: high

### L1_rng_util-028  Debug assertion macros are absent
sev: P3
concession: n
ref: reference/src/z-debug.h:22
port: NONE
expected: notreached asserts false and testonly is available as an annotation macro.
actual: No matching debug support module is exported.
why: The C debug API is incomplete.
confidence: high

### L1_rng_util-029  Aggregating angband header has no port counterpart
sev: P3
concession: n
ref: reference/src/angband.h:18
port: NONE
expected: A single header exports the low-level, mid-level, configuration, event, message, and player interfaces.
actual: TypeScript consumers must import separate modules and no aggregate equivalent exists.
why: The C public include surface is not reproduced.
confidence: high

### L1_rng_util-030  Basic C compatibility header has no port counterpart
sev: P3
concession: y
ref: reference/src/h-basic.h:147
port: NONE
expected: C platform types, path separators, math macros, and character conversion macros are defined together.
actual: TypeScript and JavaScript primitives replace them without a compatibility module.
why: C preprocessing and platform-header behavior cannot be represented directly in TypeScript.
confidence: high

## MAP L1_rng_util
reference/src/alloc.h -> packages/core/src/mon/make.ts; packages/core/src/obj/make.ts
reference/src/angband.h -> NONE
reference/src/buildid.c -> NONE
reference/src/buildid.h -> NONE
reference/src/config.h -> NONE
reference/src/guid.c -> NONE
reference/src/guid.h -> NONE
reference/src/h-basic.h -> NONE
reference/src/randname.c -> packages/core/src/obj/randname.ts
reference/src/randname.h -> packages/core/src/obj/randname.ts
reference/src/z-bitflag.c -> packages/core/src/bitflag.ts
reference/src/z-bitflag.h -> packages/core/src/bitflag.ts
reference/src/z-color.c -> packages/core/src/color.ts; packages/web/src/colors.ts
reference/src/z-color.h -> packages/core/src/color.ts
reference/src/z-debug.h -> NONE
reference/src/z-dice.c -> packages/core/src/dice.ts
reference/src/z-dice.h -> packages/core/src/dice.ts
reference/src/z-expression.c -> packages/core/src/expression.ts
reference/src/z-expression.h -> packages/core/src/expression.ts
reference/src/z-file.c -> NONE
reference/src/z-file.h -> NONE
reference/src/z-form.c -> NONE
reference/src/z-form.h -> NONE
reference/src/z-quark.c -> packages/core/src/game/obj-cmd.ts
reference/src/z-quark.h -> packages/core/src/game/obj-cmd.ts
reference/src/z-queue.c -> packages/core/src/gen/cave.ts
reference/src/z-queue.h -> packages/core/src/gen/cave.ts
reference/src/z-rand.c -> packages/core/src/rng.ts; packages/core/src/session/game.ts
reference/src/z-rand.h -> packages/core/src/rng.ts
reference/src/z-textblock.c -> packages/core/src/obj/object-info.ts; packages/web/src/screens.ts
reference/src/z-textblock.h -> packages/core/src/obj/object-info.ts; packages/web/src/screens.ts
reference/src/z-type.c -> packages/core/src/loc.ts
reference/src/z-type.h -> packages/core/src/loc.ts
reference/src/z-util.c -> packages/core/src/guard.ts; packages/core/src/obj/randart-data.ts; packages/core/src/sound/engine.ts
reference/src/z-util.h -> packages/core/src/guard.ts; packages/core/src/obj/randart-data.ts; packages/core/src/sound/engine.ts
reference/src/z-virt.c -> NONE
reference/src/z-virt.h -> NONE

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
reference/lib/gamedata/hints.txt -> packages/content/pack/hints.json; packages/content/src/specs/init.ts
reference/lib/gamedata/history.txt -> packages/content/pack/history.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/monster.txt -> packages/content/pack/monster.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/monster_base.txt -> packages/content/pack/monster_base.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/monster_spell.txt -> packages/content/pack/monster_spell.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/names.txt -> packages/content/pack/names.json; packages/content/src/specs/init.ts; packages/core/src/session/boot.ts
reference/lib/gamedata/object.txt -> packages/content/pack/object.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/object_base.txt -> packages/content/pack/object_base.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/object_property.txt -> packages/content/pack/object_property.json; packages/content/src/specs/obj-init.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/old_class.txt -> NONE
reference/lib/gamedata/p_race.txt -> packages/content/pack/p_race.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/pain.txt -> packages/content/pack/pain.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/pit.txt -> packages/content/pack/pit.json; packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/player_property.txt -> packages/content/pack/player_property.json; packages/content/src/specs/init.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/player_timed.txt -> packages/content/pack/player_timed.json; packages/content/src/specs/misc.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/projection.txt -> packages/content/pack/projection.json; packages/content/src/specs/obj-init.ts; packages/core/src/world/projection.ts
reference/lib/gamedata/quest.txt -> packages/content/pack/quest.json; packages/content/src/specs/misc.ts; packages/core/src/game/quest.ts
reference/lib/gamedata/realm.txt -> packages/content/pack/realm.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/room_template.txt -> packages/content/pack/room_template.json; packages/content/src/specs/generate.ts; packages/core/src/gen/room.ts
reference/lib/gamedata/shape.txt -> packages/content/pack/shape.json; packages/content/src/specs/init.ts; packages/core/src/player/bind.ts
reference/lib/gamedata/slay.txt -> packages/content/pack/slay.json; packages/content/src/specs/obj-init.ts; packages/core/src/obj/bind.ts
reference/lib/gamedata/store.txt -> packages/content/pack/store.json; packages/content/src/specs/misc.ts; packages/core/src/store/bind.ts
reference/lib/gamedata/summon.txt -> packages/content/pack/summon.json; packages/content/src/specs/misc.ts; packages/core/src/mon/bind.ts
reference/lib/gamedata/terrain.txt -> packages/content/pack/terrain.json; packages/content/src/specs/init.ts; packages/core/src/world/feature.ts
reference/lib/gamedata/trap.txt -> packages/content/pack/trap.json; packages/content/src/specs/init.ts; packages/core/src/world/trap.ts
reference/lib/gamedata/ui_entry.txt -> packages/content/pack/ui_entry.json; packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_entry_base.txt -> packages/content/pack/ui_entry_base.json; packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_entry_renderer.txt -> packages/content/pack/ui_entry_renderer.json; packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/lib/gamedata/ui_knowledge.txt -> packages/content/pack/ui_knowledge.json; packages/content/src/specs/misc.ts; packages/core/src/mon/knowledge-groups.ts
reference/lib/gamedata/vault.txt -> packages/content/pack/vault.json; packages/content/src/specs/generate.ts; packages/core/src/gen/room.ts
reference/lib/gamedata/visuals.txt -> packages/content/pack/visuals.json; packages/content/src/specs/visuals.ts; packages/core/src/visuals/engine.ts
reference/lib/gamedata/world.txt -> packages/content/pack/world.json; packages/content/src/specs/init.ts
