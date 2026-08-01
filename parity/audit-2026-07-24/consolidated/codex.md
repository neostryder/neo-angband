# Neo Angband Parity Findings — Codex (GPT-5.6 high-effort)

Independent audit vs reference/ (C oracle). Consolidated from per-lane files.

# ===== L1_rng_util =====

### L1_rng_util-001  Ego allocation entry omits prob1
sev: P3
concession: n
ref: reference/src/alloc.h:34
port: packages/core/src/obj/make.ts:193-199
expected: alloc_entry includes index, level, prob1, prob2, and prob3.
actual: EgoAllocEntry omits prob1, although C initializes it.
why: The port's allocation entry shape is incomplete, even though prob1 is unused during live ego selection.
confidence: high

### L1_rng_util-002  Live build identity differs from C
sev: P2
concession: n
ref: reference/src/buildid.c:37-38
port: packages/core/src/score/score.ts:25,79; packages/web/src/main.ts:4354
expected: buildid is "Angband 4.2.6" and buildver is "4.2.6".
actual: Scores default to "0.1.0"; the version screen displays "Neo Angband 0.1.0".
why: Score metadata and visible version information do not match the upstream build identity.
confidence: high

### L1_rng_util-003  Copyright notice is omitted from version information
sev: P2
concession: n
ref: reference/src/buildid.c:43-55
port: packages/web/src/main.ts:4351-4358
expected: Version information includes the full upstream copyright and license notice.
actual: The port displays short credits and no copyright/license text.
why: The visible version/about information is materially different.
confidence: high

### L1_rng_util-004  Build identity header API is not preserved
sev: P3
concession: n
ref: reference/src/buildid.h:22-26
port: packages/core/src/index.ts:25-28
expected: Public VERSION_NAME, buildid, buildver, and copyright symbols are declared.
actual: The port exports PARITY_BASELINE and ENGINE_VERSION instead; build identity values are scattered or private.
why: Consumers cannot use the upstream buildid.h interface.
confidence: high

### L1_rng_util-005  Native configuration paths have no faithful runtime counterpart
sev: P3
concession: y
ref: reference/src/config.h:51-70
port: packages/content/src/compile.ts:25-39; packages/web/src/score.ts:48-78
expected: Default config, library, and data paths are "./lib/" and private user data defaults to "~/.angband".
actual: Build-time content uses repository-relative paths and browser persistence uses localStorage, with no equivalent path configuration.
why: Raw filesystem paths and home-directory storage are unavailable in the browser.
confidence: high

### L1_rng_util-006  guid_eq has no port counterpart
sev: P3
concession: n
ref: reference/src/guid.c:22-25
port: NONE
expected: guid_eq compares two unsigned guid values and returns equality.
actual: No generic guid_eq implementation exists; callers use numeric indices or registry lookups directly.
why: The low-level GUID utility is unmapped, although current gameplay does not require a standalone helper.
confidence: high

### L1_rng_util-007  GUID type and declarations are not ported
sev: P3
concession: n
ref: reference/src/guid.h:22-24
port: NONE
expected: guid is an unsigned int type with a public guid_eq declaration.
actual: No guid type or equivalent public declaration exists.
why: The upstream low-level identity API is absent.
confidence: high

### L1_rng_util-008  h-basic portability and macro layer is not represented centrally
sev: P3
concession: y
ref: reference/src/h-basic.h:39-197
port: NONE
expected: The header defines platform flags, path separators, C types, debugging macros, math macros, N_ELEMENTS, and ASCII conversion macros.
actual: TypeScript relies on the JavaScript runtime, standard library, and distributed helpers rather than a central portability header.
why: C preprocessor and native platform-header setup have no direct browser equivalent.
confidence: high

### L1_rng_util-009  randname_make buffer contract is not preserved
sev: P3
concession: y
ref: reference/src/randname.c:77-89
port: packages/core/src/obj/randname.ts:80-85
expected: randname_make receives a destination buffer and asserts buflen > max.
actual: randnameMake returns a dynamically sized string and has no buffer-length argument or assertion.
why: JavaScript strings do not expose a fixed writable buffer that can overflow.
confidence: high

### L1_rng_util-010  flagNext uses the wrong exhaustion sentinel
sev: P2
concession: n
ref: reference/src/z-bitflag.c:62-82
port: packages/core/src/bitflag.ts:41-42,94-105
expected: flag_next returns FLAG_END, which is 0, when no flag remains.
actual: flagNext returns NO_FLAG, which is -1.
why: The exported low-level API differs from C; internal callers were changed to compensate.
confidence: high

### L1_rng_util-011  Port invents complement bitflag operations
sev: P3
concession: n
ref: reference/src/z-bitflag.c:28-588
port: packages/core/src/bitflag.ts:267-320
expected: The C implementation provides only flag_union, flag_inter, and flag_diff; no complement-operation API exists.
actual: The port adds flagCompUnion, flagCompInter, and flagCompDiff with new behavior.
why: These exported operations have no reference basis and can expose non-upstream semantics.
confidence: high

### L1_rng_util-012  Invalid bitflag inputs throw where C asserts or has undefined behavior
sev: P3
concession: n
ref: reference/src/z-bitflag.c:198-207
port: packages/core/src/bitflag.ts:64-73,172-179
expected: flag_on checks only the C assertion that the computed offset is within size; flag 0 is not explicitly rejected.
actual: flagOn rejects flag 0 and invalid offsets with RangeError.
why: Error behavior for invalid low-level inputs is not faithful to the reference.
confidence: high

### L1_rng_util-013  Debug bitflag API is missing
sev: P3
concession: n
ref: reference/src/z-bitflag.h:90-97
port: packages/core/src/bitflag.ts:83-91,168-179
expected: flag_has_dbg and flag_on_dbg are available in debug builds and forward to the normal operations in NDEBUG builds.
actual: No flagHasDbg or flagOnDbg equivalents are exported.
why: Debug callers cannot use the upstream diagnostic API.
confidence: high

### L1_rng_util-014  Color domain and background constants
sev: P2
concession: n
ref: reference/src/z-color.h:77-90
port: packages/core/src/color.ts:40
expected: MAX_COLORS is 32, BASIC_COLORS is 29, and MULT_BG/BG_BLACK/BG_SAME/BG_DARK/BG_MAX are available.
actual: MAX_COLORS is 29 and the background encoding constants are absent.
why: The port collapses the full attribute domain and cannot represent the C background multiplier contract.
confidence: high

### L1_rng_util-015  Color lookup defaults differ
sev: P1
concession: n
ref: reference/src/z-color.c:165-202
port: packages/core/src/color.ts:140-155
expected: NUL and space map to COLOUR_DARK; unknown character and text names map to COLOUR_WHITE.
actual: Space maps to synthetic Shade index 28; unknown character and text names return -1; Shade also matches as a named color.
why: COLOR_TABLE includes Shade as a normal searchable row and the port uses -1 as its lookup failure value.
confidence: high

### L1_rng_util-016  Gamma correction is absent
sev: P2
concession: y
ref: reference/src/z-color.c:283-378
port: packages/core/src/color.ts:159-220
expected: build_gamma_table populates gamma_table[256] for terminal color conversion.
actual: No gamma table or build_gamma_table equivalent exists; CSS uses raw RGB values.
why: Browser rendering replaces the native terminal path, but native gamma-corrected behavior is not represented.
confidence: high

### L1_rng_util-017  Debug helpers are unmapped
sev: P3
concession: n
ref: reference/src/z-debug.h:22-23
port: NONE
expected: notreached expands to assert(0), and testonly is available as an annotation macro.
actual: No shared port helper or annotation maps these definitions.
why: The port contains scattered unreachable handling but no equivalent low-level debug contract.
confidence: high

### L1_rng_util-018  Dice lifecycle API is replaced by GC
sev: P3
concession: y
ref: reference/src/z-dice.h:29-30
port: packages/core/src/dice.ts:148-206
expected: dice_new allocates a dice object and dice_free releases it.
actual: Dice is a garbage-collected class with no explicit new/free API.
why: The browser/TypeScript object model replaces explicit allocation without an equivalent lifecycle boundary.
confidence: high

### L1_rng_util-019  Expression lifecycle API is replaced by GC
sev: P3
concession: y
ref: reference/src/z-expression.h:37-42
port: packages/core/src/expression.ts:193-216
expected: expression_new, expression_free, expression_copy, base-value binding, and evaluation are exposed as C APIs.
actual: Construction, copying, and evaluation are class methods; there is no expression_free API.
why: Explicit C ownership is replaced by garbage collection.
confidence: high

### L1_rng_util-020  Native file API is absent
sev: P1
concession: y
ref: reference/src/z-file.h:65-350
port: NONE
expected: Path building/normalization, file handles, locking, line and byte I/O, directory creation, and directory iteration are available.
actual: No port implementation exposes path_build, file_open, file_lock, file_getl, directory, or equivalent APIs. SaveWriter/SaveReader and browser storage are separate substitutes.
why: The browser port replaces native filesystem access with in-memory serialization, localStorage, and session save logic.
confidence: high

### L1_rng_util-021  Native file behavior is not reproduced
sev: P1
concession: y
ref: reference/src/z-file.c:176-1505
port: packages/core/src/save/buffer.ts:41-279; packages/core/src/session/save.ts:1575-1613; packages/web/src/score.ts:43-73
expected: C path normalization, temporary/save filename generation, file locking, newline/tab normalization, binary reads/writes, and directory scanning execute in the native filesystem.
actual: The cited port files serialize bytes or JSON and persist selected records in localStorage; they do not implement the C filesystem control flow.
why: Browser storage is a deliberate platform substitution, but native file semantics are unavailable.
confidence: high

### L1_rng_util-022  Bounded formatter is unmapped
sev: P2
concession: n
ref: reference/src/z-form.h:39-78
port: packages/core/src/obj/object-info.ts:269-273
expected: vstrnfmt/strnfmt/vformat/strnfcat/format/plog_fmt/quit_fmt support bounded C formatting and the documented extended sequences.
actual: Only a local sprintfS helper replacing %s exists; there is no reusable bounded formatter or equivalent format-sequence implementation.
why: Template strings and local helpers do not provide the C formatter's truncation, varargs, and format-specifier behavior.
confidence: high

### L1_rng_util-023  Quark interning is absent and empty-note behavior differs
sev: P2
concession: n
ref: reference/src/z-quark.c:31-53
port: packages/core/src/game/obj-cmd.ts:1161-1167
expected: quark_add("") returns a nonzero interned ID and quark_str retrieves the stored string.
actual: The port intentionally maps an empty inscription to null; no quark table or quark_str API exists.
why: C uses a nonzero empty quark, while the port changes the observable truthiness and rendering behavior.
confidence: high

### L1_rng_util-024  Generic FIFO and priority queues are unmapped
sev: P3
concession: n
ref: reference/src/z-queue.h:24-94
port: packages/web/src/input-queue.ts:36-80; packages/core/src/game/player-path.ts:80-102
expected: q_* implements a bounded uintptr FIFO and qp_* implements a resizable priority heap with push/pop/peek/pushpop semantics.
actual: The port has a DOM key queue and ad hoc JavaScript arrays, but no generic FIFO or priority-queue implementation matching the C API.
why: The available queues have different payload, overflow, scheduling, and priority semantics.
confidence: high

### L1_rng_util-025  Textblock API is only partially modeled
sev: P2
concession: y
ref: reference/src/z-textblock.h:38-68
port: packages/core/src/obj/object-info.ts:110-142; packages/core/src/mon/lore-describe.ts:81-94; packages/web/src/screens.ts:155-195
expected: A textblock stores text and per-character attributes and provides pict append, textblock concatenation, line calculation, file output, and text_out hooks.
actual: The port uses colored string runs and UI wrapping; textblock_calculate_lines, textblock_to_file, and text_out_* are not provided.
why: Headless/browser presentation splits logical runs and wrapping across separate modules, leaving the native output API absent.
confidence: high

### L1_rng_util-026  Rand_simple is missing
sev: P2
concession: y
ref: reference/src/z-rand.h:153; reference/src/z-rand.c:576-592
port: packages/core/src/rng.ts:119-468
expected: Rand_simple produces a time/process-derived value without disturbing the game RNG state.
actual: Rng exposes only instance streams and no Rand_simple equivalent.
why: The helper is used for nondeterministic temporary-name generation in the native file path, which has no browser equivalent.
confidence: high

### L1_rng_util-027  Global Rand_init contract is replaced
sev: P2
concession: y
ref: reference/src/z-rand.c:131-152
port: packages/core/src/rng.ts:119-154; packages/core/src/rng.ts:428-468
expected: Rand_init seeds the global RNG from time and process identity, switches Rand_quick to complex mode, and initializes global state.
actual: Rng requires an explicit seed; RngStreams provides named instances, with no global Rand_init or process-derived seed path.
why: The port deliberately replaces the global C stream and seed mutation with explicit browser-safe streams.
confidence: high

### L1_rng_util-028  point_set API is absent
sev: P2
concession: n
ref: reference/src/z-type.h:48-60; reference/src/z-type.c:78-119
port: packages/core/src/loc.ts:13-55; packages/core/src/game/target.ts:355-380
expected: point_set_new, add_to_point_set, point_set_size, and point_set_contains provide a dynamically growing deduplicatable point-set abstraction.
actual: Loc helpers exist, but no point-set type or shared API exists; consumers use raw Loc arrays.
why: Array-based replacements do not preserve the reusable point-set ownership and containment contract.
confidence: high

### L1_rng_util-029  UTF-8 and bounded string utility APIs are missing
sev: P2
concession: n
ref: reference/src/z-util.h:73-183
port: packages/core/src/guard.ts:24-54; packages/core/src/obj/randname.ts:38-42; packages/core/src/obj/object-info.ts:259-260
expected: UTF-8 cursor/clip/conversion helpers, case-insensitive comparisons, bounded copy/concat, escaping, vowel tests, and related utility functions are available.
actual: Only selected guard and vowel logic is distributed through unrelated modules; the UTF-8 and bounded string API surface is absent.
why: Native callers cannot rely on a common port equivalent with the C return values and truncation rules.
confidence: high

### L1_rng_util-030  djb2 hash differs for non-ASCII strings
sev: P2
concession: n
ref: reference/src/z-util.c:2043-2054
port: packages/core/src/sound/engine.ts:26-33
expected: djb2_hash hashes the sequence of C char bytes until NUL.
actual: djb2Hash iterates JavaScript UTF-16 code units with charCodeAt.
why: ASCII hashes agree, but UTF-8 byte sequences and non-ASCII code units produce different hash values.
confidence: high

### L1_rng_util-031  Custom allocation and string ownership wrappers are absent
sev: P3
concession: y
ref: reference/src/z-virt.h:21-47; reference/src/z-virt.c:30-109
port: NONE
expected: mem_alloc/mem_zalloc/mem_realloc fail through quit, preserve zero-length behavior, and string_make/string_append manage explicit ownership.
actual: No port wrapper exists; JavaScript objects and strings use garbage collection and native allocation.
why: Browser memory management replaces the C ownership and out-of-memory contract.
confidence: high

## MAP L1_rng_util
reference/src/alloc.h -> packages/core/src/mon/make.ts:42-52; packages/core/src/obj/make.ts:193-199
reference/src/angband.h -> packages/core/src/index.ts:11-22,41-69
reference/src/buildid.c -> packages/core/src/index.ts:25-28; packages/core/src/score/score.ts:25,79; packages/cli/src/spoilers.ts:64-69; packages/web/src/main.ts:4349-4358
reference/src/buildid.h -> packages/core/src/index.ts:25-28
reference/src/config.h -> packages/content/src/compile.ts:25-39; packages/web/src/score.ts:48-78
reference/src/guid.c -> NONE
reference/src/guid.h -> NONE
reference/src/h-basic.h -> NONE
reference/src/randname.c -> packages/core/src/obj/randname.ts:51-127
reference/src/randname.h -> packages/core/src/obj/randname.ts:19-24,80-85; packages/core/src/obj/flavor.ts:37-40; packages/core/src/obj/randart.ts:98-101
reference/src/z-bitflag.c -> packages/core/src/bitflag.ts:83-378
reference/src/z-bitflag.h -> packages/core/src/bitflag.ts:29-62,83-91,108-378
reference/src/z-color.c -> packages/core/src/color.ts
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
reference/src/z-quark.c -> NONE
reference/src/z-quark.h -> NONE
reference/src/z-queue.c -> NONE
reference/src/z-queue.h -> NONE
reference/src/z-rand.c -> packages/core/src/rng.ts
reference/src/z-rand.h -> packages/core/src/rng.ts
reference/src/z-textblock.c -> packages/core/src/obj/object-info.ts; packages/core/src/mon/lore-describe.ts; packages/web/src/screens.ts
reference/src/z-textblock.h -> packages/core/src/obj/object-info.ts; packages/core/src/mon/lore-describe.ts; packages/web/src/screens.ts
reference/src/z-type.c -> packages/core/src/loc.ts (loc subset); NONE (point_set subset)
reference/src/z-type.h -> packages/core/src/loc.ts (loc subset); NONE (point_set subset)
reference/src/z-util.c -> packages/core/src/guard.ts; packages/core/src/obj/randname.ts; packages/core/src/obj/object-info.ts; packages/core/src/sound/engine.ts; packages/core/src/mon/desc.ts
reference/src/z-util.h -> packages/core/src/guard.ts; packages/core/src/obj/randname.ts; packages/core/src/obj/object-info.ts; packages/core/src/sound/engine.ts; packages/core/src/mon/desc.ts
reference/src/z-virt.c -> NONE
reference/src/z-virt.h -> NONE

# ===== L2_init_parse =====

### L2_init_parse-001  Negative random values are parsed with the wrong base
sev: P1
concession: n
ref: reference/src/parser.c:126
port: packages/content/src/parser.ts:208
expected: parse_random() treats a leading minus as whole-expression negation and adjusts base by subtracting m_bonus and dice * (sides + 1); for -3d5 it produces base -6, dice 1, sides 5.
actual: isValidRandom() only validates and preserves the raw string, then packages/core/src/obj/bind.ts:107 parses that raw -3d5 with Dice as base -3, dice 1, sides 5; shipped object.txt:2308 reaches this path through bindKinds at obj/bind.ts:676.
why: Negative random object values roll as -2..2 instead of the C range -5..-1, changing live object statistics and damage.
confidence: high

### L2_init_parse-002  Terrain look prefixes and prepositions miss C's terminating spaces
sev: P2
concession: n
ref: reference/src/init.c:2293
port: packages/core/src/world/feature.ts:132
expected: finish_parse_feat() appends one trailing space to every nonempty look_prefix and look_in_preposition that does not already end in a space.
actual: FeatureRegistry stores joined terrain strings verbatim and never applies the finish step; known.ts:212 returns the raw value, so terrain.txt:175 "the entrance to the" lacks C's added space before the feature name.
why: Store and similar terrain descriptions render with visible word-spacing drift in normal look/target text.
confidence: high

### L2_init_parse-003  File loader semantics are replaced by precompiled input
sev: P3
concession: y
ref: reference/src/datafile.c:87
port: packages/content/src/compile.ts:25
expected: parse_file() first tries the user filename, falls back to standard gamedata, parses every line, reports errors up to the configured limit, and returns the first error; the browser path has no raw user filesystem.
actual: compile.ts reads only reference/lib/gamedata at build time, records.ts:155 aborts on the first ParseError, and runtime loading consumes compiled pack JSON with no user-file override or equivalent parse-error stream.
why: Raw filesystem customization and native file diagnostics cannot be exposed in the browser runtime; this is an unavoidable browser concession.
confidence: high

## MAP L2_init_parse
reference/src/datafile.c -> packages/content/src/compile.ts; packages/content/src/records.ts; packages/content/src/parser.ts; packages/core/src/obj/bind.ts; packages/core/src/player/bind.ts; packages/core/src/world/trap.ts
reference/src/datafile.h -> packages/content/src/parser.ts; packages/content/src/records.ts; packages/core/src/obj/bind.ts
reference/src/init.c -> packages/content/src/specs/init.ts; packages/core/src/constants.ts; packages/core/src/player/bind.ts; packages/core/src/obj/bind.ts; packages/core/src/world/feature.ts; packages/core/src/world/trap.ts
reference/src/init.h -> packages/core/src/constants.ts; packages/core/src/player/types.ts; packages/core/src/session/game.ts
reference/src/parser.c -> packages/content/src/parser.ts
reference/src/parser.h -> packages/content/src/parser.ts; packages/content/src/records.ts

# ===== L3_data =====

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

# ===== L4_objects =====

## MAP L4_objects

reference/src/list-ignore-types.h -> packages/core/src/obj/list-ignore-types.ts
reference/src/list-kind-flags.h -> packages/core/src/obj/list-kind-flags.ts
reference/src/list-object-flags.h -> packages/core/src/obj/list-object-flags.ts
reference/src/list-object-modifiers.h -> packages/core/src/obj/list-object-modifiers.ts
reference/src/list-origins.h -> packages/core/src/obj/list-origins.ts
reference/src/list-tvals.h -> packages/core/src/obj/list-tvals.ts
reference/src/obj-chest.c -> packages/core/src/obj/obj-chest.ts
reference/src/obj-chest.h -> packages/core/src/obj/obj-chest.ts
reference/src/obj-curse.c -> packages/core/src/obj/obj-curse.ts
reference/src/obj-curse.h -> packages/core/src/obj/obj-curse.ts
reference/src/obj-desc.c -> packages/core/src/obj/obj-desc.ts
reference/src/obj-desc.h -> packages/core/src/obj/obj-desc.ts
reference/src/object.h -> packages/core/src/obj/object.ts
reference/src/obj-gear.c -> packages/core/src/obj/obj-gear.ts
reference/src/obj-gear.h -> packages/core/src/obj/obj-gear.ts
reference/src/obj-ignore.c -> packages/core/src/obj/obj-ignore.ts
reference/src/obj-ignore.h -> packages/core/src/obj/obj-ignore.ts
reference/src/obj-info.c -> packages/core/src/obj/obj-info.ts
reference/src/obj-info.h -> packages/core/src/obj/obj-info.ts
reference/src/obj-init.c -> packages/core/src/obj/obj-init.ts
reference/src/obj-init.h -> packages/core/src/obj/obj-init.ts
reference/src/obj-knowledge.c -> packages/core/src/obj/obj-knowledge.ts
reference/src/obj-knowledge.h -> packages/core/src/obj/obj-knowledge.ts
reference/src/obj-list.c -> packages/core/src/obj/obj-list.ts
reference/src/obj-list.h -> packages/core/src/obj/obj-list.ts
reference/src/obj-make.c -> packages/core/src/obj/obj-make.ts
reference/src/obj-make.h -> packages/core/src/obj/obj-make.ts
reference/src/obj-pile.c -> packages/core/src/obj/obj-pile.ts
reference/src/obj-pile.h -> packages/core/src/obj/obj-pile.ts
reference/src/obj-power.c -> packages/core/src/obj/obj-power.ts
reference/src/obj-power.h -> packages/core/src/obj/obj-power.ts
reference/src/obj-properties.c -> packages/core/src/obj/obj-properties.ts
reference/src/obj-properties.h -> packages/core/src/obj/obj-properties.ts
reference/src/obj-randart.c -> packages/core/src/obj/obj-randart.ts
reference/src/obj-randart.h -> packages/core/src/obj/obj-randart.ts
reference/src/obj-slays.c -> packages/core/src/obj/obj-slays.ts
reference/src/obj-slays.h -> packages/core/src/obj/obj-slays.ts
reference/src/obj-tval.c -> packages/core/src/obj/obj-tval.ts
reference/src/obj-tval.h -> packages/core/src/obj/obj-tval.ts
reference/src/obj-util.c -> packages/core/src/obj/obj-util.ts
reference/src/obj-util.h -> packages/core/src/obj/obj-util.ts

# ===== L5_monsters =====

### L5_monsters-001  Ranged attacks ignore visibility when marking seen
sev: P2
concession: n
ref: reference/src/mon-attack.c:400
port: packages/core/src/game/mon-ranged.ts:317
expected: seen is true only when the player is not blind and the monster is visible.
actual: seen defaults to true, and the live installation does not pass a visibility value.
why: Blind players and unseen monsters can receive cast messages and lore credit.
confidence: high

### L5_monsters-002  Ranged attacks omit the unseen-target witness gate
sev: P2
concession: n
ref: reference/src/mon-attack.c:123
port: packages/core/src/game/mon-ranged.ts:291
expected: A non-player target is cast at only when the player can see the caster, target, or a path square.
actual: The port returns after range and projectability checks without testing witness visibility.
why: A monster can cast at an unseen decoy or other non-player target when C rejects the cast.
confidence: high

### L5_monsters-003  Melee smart-learning is absent
sev: P2
concession: n
ref: reference/src/mon-blows.c:486
port: packages/core/src/combat/mon-melee.ts:744
expected: Elemental, timed, disenchant, experience, and related blows call update_smart_learn for the attacker.
actual: Live melee blow handling applies effects but never updates the attacking monster's learned player resistances.
why: Smart monsters retain stale resistance knowledge and can repeatedly choose ineffective attacks.
confidence: high

### L5_monsters-004  Monster death cause uses the raw race name
sev: P2
concession: n
ref: reference/src/mon-attack.c:564
port: packages/core/src/game/mon-side.ts:155
expected: take_hit receives monster_desc(mon, MDESC_SHOW | MDESC_IND_VIS), such as the correct indefinite description.
actual: takeHit receives mon.race.name directly.
why: Death attribution and killer text differ for uniques, named monsters, and hidden monsters.
confidence: high

### L5_monsters-005  Melee disturbance timing and gating differ
sev: P2
concession: n
ref: reference/src/mon-attack.c:593
port: packages/core/src/combat/mon-melee.ts:988
expected: Every successful blow disturbs immediately; a miss disturbs only when its method reports misses.
actual: The melee driver does not disturb per blow; the caller applies a later visible-in-view end-of-turn gate.
why: Hits by unseen or off-view monsters may fail to interrupt running, while the timing of disturbance differs.
confidence: high

### L5_monsters-006  Light-emitting monsters do not advance melee lore when unseen
sev: P2
concession: n
ref: reference/src/mon-attack.c:569
port: packages/core/src/game/monster-turn.ts:1547
expected: Melee lore is analyzed when the monster is visible or its race emits light.
actual: Lore analysis is gated only by monsterIsVisible(mon).
why: Attacks from unseen light-emitting monsters do not update blow observations.
confidence: high

### L5_monsters-007  Monster-versus-monster blows skip C effect handlers
sev: P1
concession: n
ref: reference/src/mon-attack.c:798
port: packages/core/src/game/mon-cmd.ts:116
expected: monster_attack_monster dispatches melee handlers that apply armor reduction, elemental effects, statuses, theft, stat effects, and effect-specific damage.
actual: The port sends the raw rolled damage directly to monTakeHit and only handles stun separately.
why: Commanded monster attacks have incorrect damage and omit normal monster-blow mechanics.
confidence: high

### L5_monsters-008  Monster-versus-monster blow messages and RNG draws are missing
sev: P1
concession: n
ref: reference/src/mon-blows.c:225
port: packages/core/src/game/mon-cmd.ts:116
expected: Each handled monster-target blow calls display_blow_message_vs_monster, including its method action and randint0(num_messages) draw.
actual: Hit messages are not emitted and the action-message RNG draw is absent.
why: Visible combat text drifts and multi-message methods shift the RNG stream.
confidence: high

### L5_monsters-009  Monster-versus-monster lore is never analyzed
sev: P2
concession: n
ref: reference/src/mon-attack.c:872
port: packages/core/src/game/mon-cmd.ts:171
expected: Visible or light-emitting attacks increment blow observations and lore_update runs after the attack.
actual: monsterAttackMonster returns without recording blow observations or updating lore.
why: Commanded combat never teaches the player about the attacking race's blows.
confidence: high

### L5_monsters-010  Ranged casting does not run lore_update
sev: P2
concession: n
ref: reference/src/mon-attack.c:468
port: packages/core/src/game/mon-ranged.ts:383
expected: After a successful cast, lore_update derives known spell frequencies and other lore from the updated counters.
actual: The port increments spell flags and cast counters but never calls loreUpdate.
why: Derived spell-frequency knowledge remains stale after casting.
confidence: high

### L5_monsters-011  Live monster descriptions default to on-screen
sev: P2
concession: n
ref: reference/src/mon-desc.c:235
port: packages/core/src/mon/desc.ts:107
expected: A visible monster outside the current panel receives the " (offscreen)" suffix.
actual: panelContains defaults to a function that always returns true, and live callers commonly omit a panel predicate.
why: Offscreen monster names in live messages omit required C text.
confidence: med

### L5_monsters-012  AC knowledge learning occurs at the wrong point
sev: P3
concession: n
ref: reference/src/mon-attack.c:529
port: packages/core/src/combat/mon-melee.ts:204
expected: equip_learn_on_defend runs inside check_hit before each AC test.
actual: checkHit only performs the RNG hit test; the live caller performs one learning call after the whole attack.
why: AC knowledge timing differs and direct checkHit users do not learn defensive AC information.
confidence: high

### L5_monsters-013  Monster timed upkeep omits notification messages
sev: P2
concession: n
ref: reference/src/mon-move.c:1812
port: packages/core/src/game/monster-turn.ts:1656
expected: Timed upkeep decrements use mon_dec_timed with MON_TMD_FLG_NOTIFY for stun, confusion, changed, and fear effects.
actual: The port directly decrements timers and only performs shape reversion for CHANGED.
why: Visible status expiry, fear reduction, and shape-change notifications are missing from normal monster turns.
confidence: high

### L5_monsters-014  Seasonal monsters are disabled in live allocation
sev: P2
concession: n
ref: reference/src/mon-make.c:251
port: packages/core/src/mon/make.ts:182; packages/core/src/session/boot.ts:198
expected: RF_SEASONAL races are eligible during December 24 through December 26.
actual: The allocation table defaults seasonalAllowed to false, and live constructors omit the option.
why: Seasonal monsters never spawn in live games, including the Christmas date window.
confidence: high

### L5_monsters-015  Monster message batching and pluralization are missing
sev: P2
concession: n
ref: reference/src/mon-msg.c:252
port: packages/core/src/game/mon-message.ts:102; packages/core/src/game/mon-death.ts:392
expected: add_monster_message queues, stacks, de-duplicates, pluralizes, and displays monster messages with counts and average damage.
actual: The port formats and emits one visible monster at a time with no queue, stacking, de-duplication, or plural count.
why: Multi-monster projections produce different visible text and damage summaries.
confidence: high

### L5_monsters-016  Unique kill sound refinement is missing
sev: P2
concession: n
ref: reference/src/mon-msg.c:450
port: packages/core/src/game/mon-message.ts:152
expected: A MSG_KILL for a unique becomes MSG_KILL_UNIQUE, or MSG_KILL_KING for Morgoth.
actual: monMessageSoundType returns the repository message type without inspecting the monster race, and no live caller supplies the refinement.
why: Unique and Morgoth deaths use the generic kill sound or no typed kill sound.
confidence: high

### L5_monsters-017  Taunted monsters ignore the close-in override
sev: P1
concession: n
ref: reference/src/mon-move.c:232
port: packages/core/src/game/monster-turn.ts:437
expected: When TMD_TAUNT is active, get_move_find_range returns after setting min_range to 1.
actual: getMoveFindRange continues flee, power, and preferred-range calculations.
why: Taunted monsters choose different movement ranges and attack positioning.
confidence: high

### L5_monsters-018  Shapechanged uniques can be trampled
sev: P1
concession: n
ref: reference/src/mon-move.c:154
port: packages/core/src/game/monster-turn.ts:339
expected: monster_can_kill rejects a unique based on monster_is_unique, including its original race.
actual: monsterCanKill checks UNIQUE only on the current race.
why: A unique shapechanged into a non-unique form can be trampled.
confidence: high

### L5_monsters-019  Trampling bypasses monster deletion cleanup
sev: P1
concession: n
ref: reference/src/mon-move.c:1360
port: packages/core/src/game/monster-turn.ts:1238
expected: Trampling calls delete_monster before swapping, removing group, racial-count, target, command, held-object, and mimic state.
actual: The port directly nulls the victim slot and square without deletion bookkeeping.
why: Trampled monsters leave stale groups, counters, targets, commands, or inventory state.
confidence: high

### L5_monsters-020  Fear conversion bypasses HOLD rules
sev: P1
concession: n
ref: reference/src/mon-move.c:1672
port: packages/core/src/game/monster-turn.ts:1588
expected: Fear is cleared, then HOLD is increased through mon_inc_timed, applying resistance, minimum duration, MAX stacking, the timer cap, and notification.
actual: The port directly clears FEAR and adds to HOLD without resistance, minimum duration, cap, or notification.
why: Fear-paralyzed monsters can receive different hold durations and ignore RF_NO_HOLD.
confidence: high

### L5_monsters-021  Monster swaps omit camouflage and visibility updates
sev: P1
concession: n
ref: reference/src/mon-util.c:566
port: packages/core/src/game/context.ts:889
expected: monster_swap updates camouflage awareness, moves mimicked objects, refreshes monster visibility, light, distance, and redraw state.
actual: monsterSwap only exchanges square occupants and monster grid coordinates.
why: Moving or pushing monsters can retain stale mimic, awareness, visibility, and distance state.
confidence: high

### L5_monsters-022  Pain messages omit optional damage amounts
sev: P2
concession: n
ref: reference/src/mon-msg.c:132
port: packages/core/src/game/mon-message.ts:142
expected: message_pain_show_damage appends the damage amount, or an average for stacked messages.
actual: formatPainMessage returns only the graded pain text and the live message hook never appends damage.
why: Paths configured to show monster damage lose the numerical damage suffix.
confidence: high

### L5_monsters-023  Pushing does not teach body movement flags
sev: P3
concession: n
ref: reference/src/mon-move.c:1345
port: packages/core/src/game/monster-turn.ts:1229
expected: A visible push or trample records RF_KILL_BODY and RF_MOVE_BODY in monster lore.
actual: The port emits the push message but does not update either lore flag.
why: Visible pushing behavior is not learned by the player.
confidence: high

### L5_monsters-024  Erratic movement does not teach RAND flags
sev: P3
concession: n
ref: reference/src/mon-move.c:1087
port: packages/core/src/game/monster-turn.ts:991
expected: Visible RAND_25 and RAND_50 monsters record the corresponding lore flags while the cumulative chance is calculated.
actual: The port applies the chances without updating lore.
why: Erratic movement behavior remains undiscovered in monster knowledge.
confidence: high

### L5_monsters-025  NEVER_MOVE lore is not recorded after failed movement
sev: P3
concession: n
ref: reference/src/mon-move.c:1661
port: packages/core/src/game/monster-turn.ts:1575
expected: When a visible monster acts despite having no movement option, RF_NEVER_MOVE is learned.
actual: The port handles the later disturbance gate but does not set RF_NEVER_MOVE.
why: The player does not learn the monster's immobility behavior.
confidence: high

## MAP L5_monsters

reference/src/list-mon-message.h -> packages/core/src/generated/mon-message.ts
reference/src/list-mon-race-flags.h -> packages/core/src/generated/mon-race-flags.ts
reference/src/list-mon-spells.h -> packages/core/src/generated/mon-spells.ts
reference/src/list-mon-temp-flags.h -> packages/core/src/generated/mon-temp-flags.ts
reference/src/list-mon-timed.h -> packages/core/src/generated/mon-timed.ts
reference/src/mon-attack.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-side.ts
reference/src/mon-attack.h -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-blows.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-side.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-blows.h -> packages/core/src/mon/types.ts; packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-desc.c -> packages/core/src/mon/desc.ts; packages/core/src/game/mon-message.ts
reference/src/mon-desc.h -> packages/core/src/mon/desc.ts
reference/src/mon-group.c -> packages/core/src/game/mon-group.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-place.ts
reference/src/mon-group.h -> packages/core/src/game/mon-group.ts; packages/core/src/mon/types.ts
reference/src/mon-init.c -> packages/content/src/specs/mon-init.ts; packages/core/src/mon/bind.ts
reference/src/mon-init.h -> packages/content/src/specs/mon-init.ts
reference/src/mon-list.c -> packages/core/src/game/mon-list.ts
reference/src/mon-list.h -> packages/core/src/game/mon-list.ts; packages/core/src/mon/types.ts
reference/src/mon-lore.c -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts; packages/core/src/game/known.ts; packages/core/src/game/monster-turn.ts
reference/src/mon-lore.h -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts
reference/src/mon-make.c -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/mon-death.ts; packages/core/src/gen/gen-monster.ts; packages/core/src/session/boot.ts; packages/core/src/session/game.ts
reference/src/mon-make.h -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts
reference/src/mon-move.c -> packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-group.ts; packages/core/src/game/scheduler.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/context.ts
reference/src/mon-move.h -> packages/core/src/game/monster-turn.ts; packages/core/src/game/scheduler.ts
reference/src/mon-msg.c -> packages/core/src/game/mon-message.ts; packages/core/src/game/mon-death.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/monster-turn.ts; packages/core/src/session/game.ts; packages/core/src/mon/timed.ts
reference/src/mon-msg.h -> packages/core/src/generated/mon-message.ts; packages/core/src/game/mon-message.ts
reference/src/mon-predicate.c -> packages/core/src/mon/predicate.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/effect-mon-origin.ts
reference/src/mon-predicate.h -> packages/core/src/mon/predicate.ts
reference/src/mon-spell.c -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cast.ts; packages/core/src/mon/lore-describe.ts; packages/core/src/game/project-cast.ts
reference/src/mon-spell.h -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cast.ts
reference/src/monster.h -> packages/core/src/mon/monster.ts; packages/core/src/mon/types.ts; packages/core/src/game/context.ts; packages/core/src/generated/mon-race-flags.ts; packages/core/src/generated/mon-spells.ts; packages/core/src/generated/mon-timed.ts
reference/src/mon-summon.c -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/effect-summon.ts
reference/src/mon-summon.h -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts
reference/src/mon-timed.c -> packages/core/src/mon/timed.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/project-monster.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/mon-shape.ts
reference/src/mon-timed.h -> packages/core/src/generated/mon-timed.ts; packages/core/src/mon/timed.ts
reference/src/mon-util.c -> packages/core/src/mon/predicate.ts; packages/core/src/mon/lore.ts; packages/core/src/mon/make.ts; packages/core/src/mon/take-hit.ts; packages/core/src/mon/spell.ts; packages/core/src/mon/steal.ts; packages/core/src/game/known.ts; packages/core/src/game/mon-death.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/mon-side.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/scheduler.ts
reference/src/mon-util.h -> packages/core/src/mon/predicate.ts; packages/core/src/mon/lore.ts; packages/core/src/mon/make.ts; packages/core/src/mon/take-hit.ts; packages/core/src/mon/spell.ts; packages/core/src/mon/steal.ts; packages/core/src/game/known.ts; packages/core/src/game/mon-death.ts; packages/core/src/game/mon-place.ts; packages/core/src/game/mon-side.ts; packages/core/src/game/monster-turn.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/scheduler.ts

# ===== L6_player =====

### L6_player-001  player_is_trapsafe ignores OF_TRAP_IMMUNE equipment
sev: P1
concession: n
ref: reference/src/player-util.c:1073-1078
port: packages/core/src/game/player-path.ts:58-61; packages/core/src/game/chest.ts:84
expected: Wearing OF_TRAP_IMMUNE, or any source that sets player_state.flags OF_TRAP_IMMUNE, makes the player trapsafe for run_test, find_path forbid_traps, and related path and run decisions.
actual: playerIsTrapsafe only tests timed TMD.TRAPSAFE. OF_TRAP_IMMUNE from gear is ignored for running and pathfinding, although trap activation can honor the flag when its environment is wired.
why: Trap-immunity items do not stop run and pathfind from treating visible traps as hazards or changing forbid_traps path selection.
confidence: high

### L6_player-002  player_can_cast omits no_light
sev: P1
concession: n
ref: reference/src/player-util.c:1096-1100
port: packages/core/src/game/spell-cmd.ts:100-116
expected: Casting and studying fail with "You cannot see!" when the player is blind or has no light.
actual: playerCanCast checks total_spells, TMD.BLIND, and TMD.CONFUSED only. no_light is never evaluated.
why: Casters can cast and study in complete darkness, changing spell use and dungeon play.
confidence: high

### L6_player-003  scroll read never enforces player_can_read
sev: P1
concession: n
ref: reference/src/player-util.c:1166-1196
port: packages/core/src/game/obj-cmd.ts:1132-1135
expected: Reading a scroll fails under blindness, no light, confusion, or amnesia with the corresponding upstream message.
actual: The live read command is registered with only the normal-shape and scroll-type checks; it does not call player_can_read.
why: Scrolls work while blind, in darkness, confused, or amnesiac.
confidence: high

### L6_player-004  TMD_FASTCAST cast costs a full turn, not 3/4 energy
sev: P1
concession: n
ref: reference/src/cmd-obj.c:1163-1168
port: packages/core/src/game/spell-cmd.ts:287-288
expected: A successful cast while TMD_FASTCAST is active spends move_energy * 3 / 4.
actual: Successful casts always return and spend the full state.z.moveEnergy; the FASTCAST reduction is deferred.
why: Fastcasting effects grant no speed advantage when spells are cast.
confidence: high

### L6_player-005  do_cmd_run does not refuse when confused
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1380-1381
port: packages/core/src/game/player-path.ts:877-879; packages/core/src/game/obj-cmd.ts:610-626
expected: Starting a run while confused prints "You are too confused.", spends no energy, and does not enter run state.
actual: runAction starts or continues the run without a confusion gate; walkAction can then randomize directions through playerConfuseDir.
why: Confused players can run and pathfind instead of being blocked as in upstream.
confidence: high

### L6_player-006  pathfinder penalties skip dark-skill and move-energy scaling
sev: P2
concession: n
ref: reference/src/player-path.c:125-155,161-210
port: packages/core/src/game/player-path.ts:370-391,431-433; packages/core/src/game/trap.ts:596-609
expected: Unlocked-door and rubble penalties pass through convert_turn_penalty; locked doors call calc_unlocking_chance with lock_unseen when cur_light < 1 and PF_UNLIGHT is absent, then also scale the result.
actual: lockedPenalty has no lock_unseen argument, and unlocked, locked, and rubble penalties are used without convert_turn_penalty.
why: Pathfinding route choices and expected costs diverge in darkness and for characters whose movement energy differs from a normal turn.
confidence: high

### L6_player-007  weight_remaining is never computed for the character sheet
sev: P2
concession: n
ref: reference/src/player-calcs.c:1756-1765
port: packages/core/src/game/char-sheet.ts:103-107,184-190,400; packages/web/src/screens.ts:417-439
expected: Character-sheet burden uses weight_remaining = 60 * adj_str_wgt[stat_ind STR] - total_weight - 1 and shows the overweight state when it is negative.
actual: weightRemaining is optional and defaults to 0; the web character-sheet dependencies do not supply it, so the sheet always displays zero and never gets this overweight-red state.
why: The visible character-sheet burden and overweight display is wrong in normal play.
confidence: high

### L6_player-008  known temporary resist and flag notifications are not suppressed by default
sev: P3
concession: n
ref: reference/src/player-timed.c:828-839
port: packages/core/src/player/timed.ts:309-333
expected: Gaining a temporary resistance already known as an immunity, or a timed flag synonym already known from non-timed gear, is silent.
actual: Notification suppression only runs when callers provide hooks.notifyQueries; common callers omit the hook, so the messages always fire even when the C code would suppress them.
why: Temporary-effect status spam and disturbance messaging differ from upstream even though durations remain correct.
confidence: med

### L6_player-009  random birth choices leave the character name at a fixed default
sev: P2
concession: n
ref: reference/src/player.c:375-381
port: packages/web/src/birth.ts:1350-1355,1651-1653
expected: The random birth-choice flow can call player_random_name, producing a 4-to-8 character capitalized Tolkien-style name before confirmation.
actual: finishRandom explicitly leaves name blank, and confirmation substitutes the fixed name "Adventurer" instead of drawing and capitalizing a random name.
why: The random-character flow and resulting player name visibly diverge from upstream.
confidence: high

## MAP L6_player
reference/src/list-equip-slots.h -> packages/core/src/generated/equip-slots.ts
reference/src/list-player-flags.h -> packages/core/src/generated/player-flags.ts
reference/src/list-player-timed.h -> packages/core/src/generated/player-timed.ts
reference/src/list-stats.h -> packages/core/src/generated/stats.ts
reference/src/player.c -> packages/core/src/player/player.ts; packages/core/src/player/exp.ts; packages/core/src/player/calcs.ts; packages/core/src/player/timed.ts; packages/web/src/birth.ts
reference/src/player.h -> packages/core/src/player/types.ts; packages/core/src/player/player.ts; packages/core/src/generated/stats.ts; packages/core/src/generated/player-flags.ts; packages/core/src/generated/player-timed.ts
reference/src/player-birth.c -> packages/core/src/player/birth.ts; packages/core/src/player/exp.ts; packages/core/src/session/game.ts
reference/src/player-birth.h -> packages/core/src/player/birth.ts
reference/src/player-calcs.c -> packages/core/src/player/calcs.ts; packages/core/src/player/spell.ts; packages/core/src/game/gear.ts; packages/core/src/game/char-sheet.ts
reference/src/player-calcs.h -> packages/core/src/player/calcs.ts; packages/core/src/game/gear.ts
reference/src/player-class.c -> packages/core/src/player/bind.ts
reference/src/player-history.c -> packages/core/src/player/history.ts; packages/core/src/game/history.ts
reference/src/player-history.h -> packages/core/src/player/history.ts; packages/core/src/generated/history-types.ts
reference/src/player-path.c -> packages/core/src/game/player-path.ts
reference/src/player-path.h -> packages/core/src/game/player-path.ts
reference/src/player-properties.c -> packages/core/src/player/abilities.ts
reference/src/player-properties.h -> packages/core/src/player/abilities.ts
reference/src/player-quest.c -> packages/core/src/game/quest.ts
reference/src/player-quest.h -> packages/core/src/game/quest.ts
reference/src/player-race.c -> packages/core/src/player/bind.ts
reference/src/player-spell.c -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts; packages/core/src/game/obj-cmd.ts
reference/src/player-spell.h -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/player-timed.c -> packages/core/src/player/timed.ts; packages/core/src/player/bind.ts
reference/src/player-timed.h -> packages/core/src/player/timed.ts; packages/core/src/generated/player-timed.ts; packages/core/src/player/types.ts
reference/src/player-util.c -> packages/core/src/player/take-hit.ts; packages/core/src/player/best-digger.ts; packages/core/src/player/combat-regen.ts; packages/core/src/player/exp.ts; packages/core/src/game/loop.ts; packages/core/src/game/world.ts; packages/core/src/game/player-turn.ts; packages/core/src/game/obj-cmd.ts; packages/core/src/game/player-path.ts
reference/src/player-util.h -> packages/core/src/player/take-hit.ts; packages/core/src/player/best-digger.ts; packages/core/src/player/combat-regen.ts; packages/core/src/player/exp.ts; packages/core/src/game/loop.ts; packages/core/src/game/world.ts; packages/core/src/game/player-turn.ts; packages/core/src/game/obj-cmd.ts; packages/core/src/game/player-path.ts

# ===== L7_combat =====

## MAP L7_combat
reference/src/player-attack.c -> packages/core/src/combat/player-attack.ts
reference/src/player-attack.h -> packages/core/src/combat/player-attack.ts

# ===== L8_effects =====

### L8_effects-001  EF_SELECT never presents the player choice
sev: P1
concession: n
ref: reference/src/effects.c:437-450
port: packages/core/src/effects/interpreter.ts:487-500
expected: A player-origin EF_SELECT with multiple sub-effects calls the command/UI chooser, and cancellation returns false; the random choice is used only for an explicit random selection.
actual: The live port has no chooseEffect injection outside tests, so the no-UI fallback always selects a random sub-effect for player-origin EF_SELECT.
why: Selectable player effects silently lose their choice semantics and consume RNG as if the player requested random selection.
confidence: high

### L8_effects-002  ICE damage ignores cold resistance
sev: P1
concession: n
ref: reference/src/project-player.c:53-57
port: packages/core/src/game/project-player.ts:179-191
expected: PROJ_ICE remaps to PROJ_COLD before reading the player's resistance level, so cold resistance, immunity, and vulnerability affect ice damage.
actual: The port learns using the remapped cold type but reads resLevel with the original ICE type; ICE is outside the elemental range check, so resLevel is forced to zero.
why: Ice attacks bypass the player's cold resistance calculation on the live projection path.
confidence: high

### L8_effects-003  PROJECT_STOP does not stop at the active decoy
sev: P1
concession: n
ref: reference/src/project.c:146-147,215-219
port: packages/core/src/world/project.ts:95-113
expected: project_path finds cave->decoy and stops a PROJECT_STOP path when it reaches that decoy after the initial grid.
actual: The port compares against a permanent (-1,-1) sentinel and never consults the live GameState.decoy.
why: The port already stores an active decoy, but bolts and other PROJECT_STOP paths can pass through it instead of terminating there.
confidence: high

### L8_effects-004  PROJECT_INFO uses live walls instead of believed walls
sev: P2
concession: n
ref: reference/src/project.c:203-212
port: packages/core/src/world/project.ts:101-107
expected: PROJECT_INFO stops on square_isbelievedwall, using the player's remembered terrain for targeting and information paths.
actual: Both the normal and PROJECT_INFO branches call c.isProjectable, and the port explicitly substitutes the live map for the remembered-wall test.
why: Targeting and information projections can stop at different grids and use live terrain where the C path uses remembered terrain.
confidence: high

### L8_effects-005  Object projection observes unseen or unknown objects
sev: P2
concession: n
ref: reference/src/project-obj.c:545-551
port: packages/core/src/game/project-obj.ts:193-197
expected: Destruction is obvious only when obj->known, the object is not ignored, and the square is seen.
actual: The port treats squareIsSeen as both the square visibility and the per-object known test, so a seen square makes an unrecognized object observed.
why: Object destruction, resistance messages, and obviousness can leak knowledge for objects whose C known twin is absent.
confidence: high

### L8_effects-006  Buried-object discovery ignores item ignore status
sev: P2
concession: n
ref: reference/src/project-feat.c:114-124
port: packages/core/src/game/project-feat.ts:160-179
expected: After rubble creates an object, the buried-object message and obvious flag require the created object to be non-ignored and the square to be seen.
actual: The port emits the message whenever an object was created on a seen rubble square, without checking state.isIgnored.
why: Ignored buried items still produce the discovery message and mark the projection obvious.
confidence: high

### L8_effects-007  Monster cloning has no live multiply hook
sev: P1
concession: n
ref: reference/src/project-mon.c:887-901
port: packages/core/src/mon/project-mon.ts:673-679
expected: PROJ_MON_CLONE heals and hastens the monster, then calls multiply_monster and reports MON_MSG_SPAWN on a seen successful clone.
actual: The port calls an optional multiplyMonster hook, but the live session monster hooks do not provide it, so no clone is spawned.
why: Clone projections retain the heal and speed effects but omit their defining monster-creation side effect.
confidence: high

### L8_effects-008  Monster polymorph has no live replacement hook
sev: P1
concession: n
ref: reference/src/project-mon.c:1189-1231
port: packages/core/src/game/project-monster.ts:324-356
expected: A failed save is reported, and a successful eligible polymorph replaces the monster with a new race at the same grid.
actual: The port delegates replacement to an optional polymorph hook, but the live session does not provide it, so every eligible polymorph falls through to the maintain-shape message.
why: PROJ_MON_POLY and chaos polymorph effects cannot change a monster's race in the live path.
confidence: high

### L8_effects-009  show_damage monster messages are missing
sev: P2
concession: n
ref: reference/src/project-mon.c:1111-1158
port: packages/core/src/game/project-monster.ts:226-263
expected: When the player attacks and show_damage is enabled, visible monster hit and pain messages use the show-damage variants with the damage amount.
actual: The port always invokes the ordinary message and messagePain hooks; the live session supplies no show-damage branch for monster projections.
why: The option changes player-facing ranged and projection combat output in C but has no effect on monster damage messages in the port.
confidence: high

### L8_effects-010  Surviving projected monsters are not refreshed
sev: P2
concession: n
ref: reference/src/project-mon.c:1455-1468
port: packages/core/src/game/project-monster.ts:201-203
expected: After projection side effects, a surviving monster runs update_mon and square_light_spot, with recall redraw as required.
actual: The port makes this an optional onUpdate hook, and the live session does not provide that hook.
why: Projection changes to monster state and visibility/light presentation are not synchronously refreshed after the effect.
confidence: high

### L8_effects-011  Monster-origin player damage loses C killer description
sev: P2
concession: n
ref: reference/src/effect-handler-attack.c:466-491
port: packages/core/src/game/effect-attack.ts:687-691
expected: SRC_MONSTER damage builds the killer string with monster_desc(MDESC_DIED_FROM), preserving the upstream article and descriptive qualifiers before take_hit.
actual: The port passes only mon.race.name, with no monster_desc formatting, and explicitly defers the upstream death-cause description.
why: Death attribution and damage messages from monster-origin EF_DAMAGE differ from the C wording and can omit the proper article or contextual description.
confidence: high

## MAP L8_effects
reference/src/effect-handler.h -> packages/core/src/effects/effect.ts; packages/core/src/effects/interpreter.ts
reference/src/effect-handler-attack.c -> packages/core/src/game/effect-attack.ts
reference/src/effect-handler-general.c -> packages/core/src/game/effect-general.ts; packages/core/src/game/effect-detect.ts; packages/core/src/game/effect-teleport.ts; packages/core/src/game/effect-terrain.ts; packages/core/src/game/effect-monster.ts; packages/core/src/game/effect-summon.ts; packages/core/src/game/effect-item.ts; packages/core/src/game/effect-melee.ts
reference/src/effects.c -> packages/core/src/effects/effect.ts; packages/core/src/effects/interpreter.ts; packages/core/src/effects/effect-info.ts
reference/src/effects.h -> packages/core/src/effects/effect.ts; packages/core/src/effects/interpreter.ts
reference/src/effects-info.c -> packages/core/src/effects/effect-info.ts; packages/core/src/obj/effects-info.ts
reference/src/effects-info.h -> packages/core/src/effects/effect-info.ts; packages/core/src/obj/effects-info.ts
reference/src/list-effects.h -> packages/core/src/generated/effects.ts
reference/src/list-projections.h -> packages/core/src/generated/projections.ts
reference/src/project.c -> packages/core/src/world/project.ts
reference/src/project.h -> packages/core/src/world/project.ts; packages/core/src/world/projection.ts
reference/src/project-feat.c -> packages/core/src/game/project-feat.ts
reference/src/project-mon.c -> packages/core/src/mon/project-mon.ts; packages/core/src/game/project-monster.ts
reference/src/project-obj.c -> packages/core/src/game/project-obj.ts
reference/src/project-player.c -> packages/core/src/game/project-player.ts; packages/core/src/game/player-side.ts

# ===== L9_dungeon =====

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

# ===== L10_world_loop =====

## MAP L10_world_loop

reference/src/cmd-cave.c -> packages/core/src/game/commands/cmd-cave.ts
reference/src/cmd-core.c -> packages/core/src/game/commands/cmd-core.ts
reference/src/cmd-core.h -> packages/core/src/game/commands/cmd-core.ts
reference/src/cmd-misc.c -> packages/core/src/game/commands/cmd-misc.ts
reference/src/cmd-obj.c -> packages/core/src/game/commands/cmd-obj.ts
reference/src/cmd-pickup.c -> packages/core/src/game/commands/cmd-pickup.ts
reference/src/cmds.h -> packages/core/src/game/commands/cmds.ts
reference/src/cmd-spoil.c -> packages/core/src/game/commands/cmd-spoil.ts
reference/src/cmd-wizard.c -> packages/core/src/game/commands/cmd-wizard.ts
reference/src/debug.c -> packages/core/src/game/debug.ts
reference/src/debug.h -> packages/core/src/game/debug.ts
reference/src/game-event.c -> packages/core/src/game/event.ts
reference/src/game-event.h -> packages/core/src/game/event.ts
reference/src/game-input.c -> packages/core/src/game/input.ts
reference/src/game-input.h -> packages/core/src/game/input.ts
reference/src/game-world.c -> packages/core/src/game/world.ts
reference/src/game-world.h -> packages/core/src/game/world.ts
reference/src/hint.h -> packages/core/src/game/hint.ts
reference/src/list-elements.h -> packages/core/src/world/list-elements.ts
reference/src/list-message.h -> packages/core/src/game/list-message.ts
reference/src/list-options.h -> packages/core/src/game/list-options.ts
reference/src/list-parser-errors.h -> packages/core/src/game/list-parser-errors.ts
reference/src/list-randart-properties.h -> packages/core/src/world/list-randart-properties.ts
reference/src/message.c -> packages/core/src/game/message.ts
reference/src/message.h -> packages/core/src/game/message.ts
reference/src/option.c -> packages/core/src/game/option.ts
reference/src/option.h -> packages/core/src/game/option.ts
reference/src/source.c -> packages/core/src/world/source.ts
reference/src/source.h -> packages/core/src/world/source.ts
reference/src/target.c -> packages/core/src/world/target.ts
reference/src/target.h -> packages/core/src/world/target.ts
reference/src/wizard.h -> packages/core/src/game/wizard.ts
reference/src/wiz-debug.c -> packages/core/src/game/wiz-debug.ts
reference/src/wiz-spoil.c -> packages/core/src/game/wiz-spoil.ts
reference/src/wiz-stats.c -> packages/core/src/game/wiz-stats.ts

# ===== L11_stores =====

### L11_stores-001  Home take/drop uses commercial buy/sell transactions
sev: P1
concession: n
ref: reference/src/store.c:1783-1852, 2009-2075
port: packages/web/src/shop.ts:732-800; packages/core/src/session/game.ts:2525-2535
expected: At HOME, taking an item runs do_cmd_retrieve with no gold change and dropping an item runs do_cmd_stash with no gold change, using home stock and home_carry.
actual: runStore calls game.buy for a HOME take and game.sell for a HOME drop; those facades route to storeBuy/storeSell, which price the item and debit or credit gold before using commercial store behavior.
why: Every normal home retrieval or stash can charge or award gold and follows the wrong stock path.
confidence: high

### L11_stores-002  Store flavor messages use the wrong RNG stream
sev: P1
concession: n
ref: reference/src/store.c:453-460, 491-507, 1717-1718
port: packages/web/src/shop.ts:189-190, 748, 818-822
expected: The accept roll and purchase_analyze ONE_OF selections consume the game randint stream in the C statement order.
actual: flavorOneIn and flavorPick use Math.random, so the game RNG is not advanced and the chosen comments are not reproducible from the game seed.
why: Store actions produce different random outcomes and leave the deterministic gameplay RNG stream misaligned.
confidence: high

### L11_stores-003  Shop transactions omit known-object and rune-learning updates
sev: P1
concession: n
ref: reference/src/store.c:1731-1742, 1823-1838, 1947-1953
port: packages/core/src/store/transact.ts:159-170, 331-335, 384-396; packages/core/src/store/store.ts:14-16
expected: Buying and selling copy the known object, propagate effects, make flavor aware, and repeatedly learn unknown runes until the object is fully known; home retrieval also copies and charge-splits the known twin.
actual: The port has no obj->known twin, only marks flavor awareness when supplied, and omits the effect propagation and rune-learning loops; home retrieval copies only the live object.
why: Identification, rune knowledge, and subsequent object descriptions or values diverge after ordinary shop transactions.
confidence: high

### L11_stores-004  No-selling buy test hardcodes runes as unknown
sev: P1
concession: n
ref: reference/src/store.c:524-556
port: packages/core/src/session/game.ts:2577-2580; packages/core/src/store/store.ts:222-239
expected: With birth_no_selling, a worthless variable-power item is accepted only when object_runes_known(obj) is false.
actual: The live willBuy path always passes false for runesKnown, so the port accepts the worthless variable-power item even after all of its runes are known.
why: No-selling mode permits sales that C rejects once the item's runes have already been identified.
confidence: high

### L11_stores-005  Store display sorting uses sale price instead of object_value
sev: P2
concession: n
ref: reference/src/store.c:779-807; reference/src/player-calcs.c:939-1003
port: packages/web/src/shop.ts:88-107
expected: store_stock_list repeatedly uses earlier_object with object_value(obj, 1) as the value tiebreaker, including the player's known-state rules for variable-power items.
actual: sortStoreStock supplies game.price(store, obj, false, 1), which uses objectValueReal for the purchase price and can include bonuses the player does not know.
why: Unidentified or partially identified stock can appear in a different order from the C store inventory.
confidence: high

### L11_stores-006  Maintenance drops artifacts without the C history-loss side effect
sev: P1
concession: n
ref: reference/src/store.c:1040-1095, 1300-1313
port: packages/core/src/store/store.ts:425-456, 574-582
expected: store_delete_random and black-market cleanup call history_lose_artifact before deleting an artifact from store stock.
actual: The port deletes the stock object without invoking any artifact-loss callback; only player sale wiring handles artifact found/lost callbacks.
why: An artifact sold into a store and later removed by maintenance disappears without updating artifact history/state.
confidence: high

## MAP L11_stores
reference/src/store.c -> packages/core/src/store/bind.ts, packages/core/src/store/price.ts, packages/core/src/store/store.ts, packages/core/src/store/transact.ts, packages/web/src/shop.ts, packages/core/src/session/game.ts
reference/src/store.h -> packages/core/src/store/types.ts, packages/core/src/store/bind.ts, packages/core/src/store/price.ts, packages/core/src/store/store.ts, packages/core/src/store/transact.ts

# ===== L12_saveload =====

### L12_saveload-001  save-charoutput.c has no port implementation
sev: P3
concession: n
ref: reference/src/save-charoutput.c:25
port: NONE
expected: save_charoutput() writes ANGBAND_DIR_USER/CharOutput.txt as {, race, class, mapName "Angband", dLvl, cLvl, isDead, killedBy, and }, returns false on any write/open/close failure, and is invoked by savefile_save() before the binary save.
actual: No packages/ implementation defines save_charoutput(), writes the CharOutput.txt schema, or invokes an equivalent short synopsis export during saving; packages/web/src/charsheet.ts only offers a different full character-dump download.
why: The angband.live-compatible character synopsis is absent from the live save path, so consumers expecting CharOutput.txt receive no equivalent output.
confidence: high

### L12_saveload-002  save-charoutput.h has no port interface
sev: P3
concession: n
ref: reference/src/save-charoutput.h:10
port: NONE
expected: The save-charoutput interface exposes bool save_charoutput(void) so savefile_save() can generate the short CharOutput.txt synopsis.
actual: No packages/ module exposes a corresponding save_charoutput interface or callable equivalent for the C short-output contract.
why: The declaration and its callable contract are unmapped, leaving the reference save hook without a port entry point.
confidence: high

### L12_saveload-003  Live save path does not use the C block savefile
sev: P1
concession: n
ref: reference/src/savefile.c:29-39,384-447,554-584
port: packages/core/src/session/save.ts:1575-1606; packages/core/src/session/game.ts:2683-2733; packages/web/src/main.ts:3709-3718; packages/core/src/save/buffer.ts:207-230
expected: Normal save/load uses the C byte stream: Save plus VNLA header, 28-byte block headers, the named saver/loader tables, payloads, and x padding; savefile_save and savefile_load operate on that stream.
actual: The live web path JSON-stringifies SavedGame, appends an FNV trailer, base64-encodes it, and stores it in localStorage; loadGame consumes that JSON object. The binary buffer helper is exported but has no live save/load caller.
why: The normal game cannot read or write the reference savefile format, so original savefiles and block-level compatibility behavior are unavailable.
confidence: high

### L12_saveload-004  Savefile variant header is replaced by an arbitrary numeric version
sev: P1
concession: n
ref: reference/src/savefile.c:79-82,404-407
port: packages/core/src/save/buffer.ts:203-210,254-260
expected: Every file starts with bytes 83,97,118,101 followed by the exact four bytes V,N,L,A.
actual: writeSavefile writes the caller-supplied numeric version as little-endian bytes after Save, and readSavefile only checks the first four magic bytes.
why: Even the otherwise matching binary helper is not wire-compatible with an Angband savefile and accepts a different file variant.
confidence: high

### L12_saveload-005  Block header validation is weaker than the C parser
sev: P1
concession: n
ref: reference/src/savefile.c:460-500
port: packages/core/src/save/buffer.ts:254-285
expected: check_header requires all eight file-header bytes; next_blockheader requires an exact 28-byte read and savefile_head[15] == 0 before reconstructing the name, version, and size.
actual: readSavefile checks only the four-byte Save magic, does not validate the VNLA bytes, does not reject a short block header before indexed reads, and accepts a 16-byte name with no terminating zero.
why: Wrong-variant and malformed block headers can enter the port parser instead of following the C rejection path.
confidence: high

### L12_saveload-006  Port rejects checksum mismatches that the C loader ignores
sev: P1
concession: n
ref: reference/src/savefile.c:525-540
port: packages/core/src/save/buffer.ts:249-281
expected: C load_block reads exactly b->size bytes and calls the loader; although the header carries a checksum, this upstream code does not compare buffer_check with it.
actual: readSavefile recomputes the payload sum and throws when it differs from the header check value.
why: A file accepted by the reference loader because of its upstream checksum omission is rejected by the port, changing corrupted-save control flow.
confidence: high

### L12_saveload-007  C saver and loader registries are not ported
sev: P1
concession: n
ref: reference/src/savefile.c:102-155,506-519,554-576; reference/src/savefile.h:85-133
port: packages/core/src/save/buffer.ts:188-196,254-286; packages/core/src/session/save.ts:984-1015
expected: The savefile owns the ordered description/rng/options/messages/.../history block saver and loader tables, selects a loader by exact name and version, and invokes each loader while reading the file.
actual: The port exposes generic SaveBlock and BlockLoader types and only splits bytes into blocks; it supplies no C block registry, no exact named loader dispatch, and the live serializer is one JSON object.
why: The reference block ordering, version selection, and per-block load control flow have no equivalent active implementation.
confidence: high

### L12_saveload-008  String writer changes C byte and terminator behavior
sev: P2
concession: n
ref: reference/src/savefile.c:252-260
port: packages/core/src/save/buffer.ts:79-85
expected: wr_string writes bytes until the first C NUL in str, then writes one terminating zero; the bytes are the supplied char sequence.
actual: putString iterates over every JavaScript code unit, masks each to its low byte, writes embedded NULs and later characters, then adds another zero.
why: Embedded NULs and non-ASCII names or text serialize to different payload bytes.
confidence: med

### L12_saveload-009  Truncated payload sizes are not rejected before checksum parsing
sev: P1
concession: n
ref: reference/src/savefile.c:525-537
port: packages/core/src/save/buffer.ts:264-285
expected: file_read must return exactly b->size before the loader can run; a short payload makes load_block fail.
actual: readSavefile takes subarray(pos, pos + size) without checking its length, sums the shorter result, and can accept a header whose declared payload extends past the input when the resulting sum matches.
why: Malformed or truncated files can be treated as parsed blocks instead of failing at the C read-length check.
confidence: high

### L12_saveload-010  C savefile public API and save status are unmapped
sev: P1
concession: ?
ref: reference/src/savefile.h:31-53; reference/src/savefile.c:384-447,631-657
port: packages/core/src/session/game.ts:2683-2733; packages/web/src/main.ts:3709-3718; packages/web/src/roster.ts:103-112; NONE for character_saved/savefile_save/savefile_load signatures
expected: character_saved is a global status flag; savefile_save(path) and savefile_load(path, cheat_death) return bool and perform the C file operations, while load completes the character state and applies cheat death.
actual: saveGame returns a SavedGame object, persistSave returns void and swallows storage exceptions, and loadGame takes an in-memory pack plus SavedGame and throws on unsupported versions. No character_saved flag or path-based C API exists.
why: Callers cannot observe the reference save result or invoke the reference path-based save/load contract; only a browser-specific substitute is available.
confidence: high

### L12_saveload-011  Description and panic-name APIs have no port counterpart
sev: P2
concession: n
ref: reference/src/savefile.h:45-53; reference/src/savefile.c:595-624,661-680
port: packages/web/src/roster.ts:15-30,61-112; NONE for savefile_get_description/savefile_get_panic_name
expected: savefile_get_description reads the description block and returns Invalid savefile for a bad header; savefile_get_panic_name builds the panic path and clears the result when it cannot fit or validate.
actual: The roster stores separate JSON metadata and base64 save bytes but exposes neither a description-block reader nor a panic-save-name builder.
why: Character-select metadata and panic-save routing do not implement the reference APIs or their failure strings.
confidence: high

### L12_saveload-012  Savefile header constants are not mapped
sev: P3
concession: n
ref: reference/src/savefile.h:21-23
port: packages/core/src/save/buffer.ts:23-30; packages/core/src/session/save.ts:62-70; NONE for FINISHED_CODE/ITEM_VERSION/EGO_ART_KNOWN
expected: The header exports FINISHED_CODE 255, ITEM_VERSION 5, and EGO_ART_KNOWN 0xffffffff for the save/load implementation.
actual: The port defines SAVEFILE_MAGIC, SAVEFILE_HEAD_SIZE, PAD_BYTE, and an unrelated JSON SAVE_VERSION 2, but no counterparts for those three C constants.
why: C consumers of these shared savefile constants have no mapped port values.
confidence: high

### L12_saveload-013  C binary save/load format is replaced by an incompatible JSON format
sev: P1
concession: n
ref: reference/src/save.c:49-1071; reference/src/load.c:99-1761
port: packages/core/src/session/save.ts:2-7,1575-1614; packages/core/src/session/game.ts:2682-2700,2728-3009; packages/web/src/main.ts:549-565,3709-3719
expected: The save path writes the C block records and the load path reads those records, including the C item, player, dungeon, object, monster, trap, store, and history fields.
actual: The port writes JSON.stringify(SavedGame) plus an FNV trailer and stores it as base64 in localStorage; loadGame accepts only SAVE_VERSION 2 and no port reader consumes the C block stream.
why: Existing Angband savefiles are not loadable and the byte-level field widths, sentinels, versioning, and corruption behavior no longer match the oracle.
confidence: high

### L12_saveload-014  Save description string is not reproduced by the live save path
sev: P2
concession: n
ref: reference/src/save.c:49-66
port: packages/web/src/main.ts:3686-3701
expected: wr_description writes either "%s, dead (%s)" or "%s, L%d %s %s, at DL%d" using the player full name, death cause, level, race, class, and depth.
actual: The port stores separate roster metadata fields and does not construct or persist the C description string; it uses the shell playerName and has no death-cause field in CharMeta.
why: Save/roster consumers expecting the exact upstream synopsis receive different data and formatting.
confidence: high

### L12_saveload-015  RNG quick/fixed state and state-index normalization diverge
sev: P1
concession: n
ref: reference/src/save.c:286-307; reference/src/load.c:388-415
port: packages/core/src/rng.ts:61-68,387-412
expected: C saves Rand_value, state_i, the 32-word WELL state, and padding; load reduces state_i modulo RAND_DEG and forces Rand_quick=false.
actual: RngState persists quick, fixed, and fixval, restores stateI directly without modulo, and loadGame restores that state unchanged at packages/core/src/session/game.ts:2810-2811.
why: A save taken in quick or fixed mode, or with an out-of-range state index, resumes with a different RNG mode or invalid indexing and changes subsequent draws.
confidence: high

### L12_saveload-016  Monster known player-state memory is not saved
sev: P1
concession: n
ref: reference/src/save.c:204-256; reference/src/load.c:259-352
port: packages/core/src/session/save.ts:319-340,342-368,371-408
expected: wr_monster writes known_pstate.flags and known_pstate.el_info for every monster, and rd_monster restores them before the monster becomes live.
actual: SavedMonster contains mflag but no knownPstate flags or elemental memory; deserializeMonster starts from blankMonster and never restores those fields.
why: Monsters forget learned player protections and resistances after a save/load, changing later spell and attack decisions.
confidence: high

### L12_saveload-017  Object activation and effect presence are not round-tripped
sev: P1
concession: n
ref: reference/src/save.c:113-118,184-192; reference/src/load.c:153-155,223-232,247-250
port: packages/core/src/session/save.ts:76-114,116-151,202-252
expected: C persists the per-object effect-present byte and activation index, then restores activation by that saved index and sets effect only when the saved byte is nonzero.
actual: SavedObject has no effect-present or activation field; deserializeObject always takes kind.effect and chooses artifact.activation or kind.activation.
why: Runtime objects with a distinct activation or absent effect are changed when loaded, so using an item can expose the wrong action or effect.
confidence: high

### L12_saveload-018  Zero-power curse timeout data is dropped
sev: P2
concession: n
ref: reference/src/save.c:163-172; reference/src/load.c:201-211
port: packages/core/src/session/save.ts:176-189,285-298
expected: When curses exists, C writes every curse entry's power and uint16 timeout, including entries whose power is zero.
actual: serializeCurseList emits only entries with power greater than zero, and deserializeCurseList recreates omitted entries with timeout zero.
why: A nonzero timeout attached to a zero-power curse does not survive a save/load, changing the object curse state.
confidence: med

### L12_saveload-019  Known object copies are omitted from gear and store saves
sev: P1
concession: n
ref: reference/src/save.c:715-741,744-764; reference/src/load.c:1122-1189,1196-1261
port: packages/core/src/session/save.ts:685-709,1037-1044,1343-1404; packages/core/src/session/game.ts:2797-2799,2838-2842
expected: C writes real gear and a separate known gear list, and writes a known-object followed by a real-object pair for every store item; load reconnects each known object to its real object.
actual: The port serializes one SavedObject per gear handle, floor pile, held object, and store item, with no known-object counterpart or known link.
why: Unidentified per-object properties and shop/home knowledge are collapsed into the real object and do not resume with C-equivalent knowledge.
confidence: high

### L12_saveload-020  Artifact seen and everseen flags are not persisted
sev: P1
concession: n
ref: reference/src/save.c:674-688; reference/src/load.c:1036-1059
port: packages/core/src/obj/make.ts:730-765; packages/core/src/session/save.ts:805-816,972-981,1406-1418; packages/core/src/session/game.ts:2782-2793
expected: C saves and loads created, seen, and everseen for every artifact, plus the reserved byte.
actual: ArtifactState contains only created flags and SavedGame carries only an artifactsCreated id list; seen and artifact-everseen have no serialized or restored representation.
why: Artifact knowledge state is reset or unavailable after load even though the C save preserves it.
confidence: high

### L12_saveload-021  Current decoy marker is lost on load
sev: P1
concession: n
ref: reference/src/load.c:1473-1505
port: packages/core/src/session/save.ts:676-683,1308-1337; packages/core/src/session/game.ts:2838-2842
expected: rd_traps sets the active cave decoy grid when it reads a decoy trap, so cave_find_decoy and monster targeting still see the decoy after reload.
actual: deserializeTraps rebuilds only the trap map and loadGame assigns it without setting GameState.decoy; SavedGame has no current-level decoy field.
why: A decoy present at save time stops functioning after reload, changing targeting, movement, and decoy destruction behavior.
confidence: high

### L12_saveload-022  Dead saves include live dungeon state that C deliberately omits
sev: P1
concession: n
ref: reference/src/save.c:873-910,915-957,959-976,1001-1045; reference/src/load.c:1394-1427,1432-1471,1473-1505,1623-1697
port: packages/core/src/session/save.ts:1003-1057; packages/core/src/session/game.ts:2827-2842
expected: For a dead player, C skips dungeon objects, monsters, traps, and chunk-list payloads; the load functions likewise return without restoring those live collections.
actual: serializeGame always serializes chunk, floor, traps, monsters, groups, and level data, and loadGame always reconstructs them even when isDead is true.
why: Dead-character saves carry and restore gameplay state that the upstream death-save path intentionally excludes.
confidence: high

### L12_saveload-023  Persistent-level connector metadata is truncated and not remapped
sev: P1
concession: n
ref: reference/src/save.c:845-867,1027-1043; reference/src/load.c:1366-1383,1653-1678
port: packages/core/src/session/save.ts:852-856,1071-1080,1455-1458,1512-1514,1562-1565; packages/core/src/session/game.ts:2892-2900
expected: C persists each connector's x, y, feature, and every SQUARE_SIZE info byte, then restores all of those fields when birth_levels_persist is enabled.
actual: The port persists only x, y, and numeric feat for currentJoins and cached joins, drops connector info bytes, and restores feat directly without a feature-id remap.
why: Persistent-level stair/connector knowledge and terrain references can differ after reload or pack reordering.
confidence: high

### L12_saveload-024  Full monster lore is saved although C save.c persists only kills and thefts
sev: P2
concession: n
ref: reference/src/save.c:356-373; reference/src/load.c:498-544
port: packages/core/src/session/save.ts:735-740,1120-1145,1150-1183
expected: The save block contains only each race's pkills and thefts; rd_monster_memory restores those two counters and leaves the other lore fields to the normal lore source/defaults.
actual: The port serializes and restores every MonsterLore counter, blow memory, flags, spell flags, and knowledge booleans.
why: Reloading the port carries lore state that the C save/load pair does not, changing the scope and visibility of remembered monster knowledge.
confidence: high

### L12_saveload-025  History artifact references use unstable numeric indices
sev: P1
concession: n
ref: reference/src/save.c:1048-1069; reference/src/load.c:1715-1758
port: packages/core/src/player/history.ts:29-42; packages/core/src/session/save.ts:451-474,561-562
expected: C writes the artifact name for each history entry and rd_history resolves that name against the current artifact registry before storing a_idx.
actual: HistoryInfo stores aIdx as a raw number and serializePlayer copies it directly; load copies the number without resolving an artifact identity.
why: Reordered or extended artifact data can make a restored history entry refer to a different artifact than the one recorded.
confidence: high

### L12_saveload-026  Player load validation and repair rules are missing
sev: P1
concession: n
ref: reference/src/load.c:766-839
port: packages/core/src/session/save.ts:587-669; packages/core/src/session/game.ts:2734-2736
expected: C rejects player levels outside 1..PY_MAX_LEVEL, repairs max_lev/max_depth/recall_depth, resets the death cause for a nonnegative HP, bounds timed-effect counts, and skips unsupported timed entries.
actual: deserializePlayer assigns the saved values directly, copies arrays without count checks, and loadGame validates only the top-level SAVE_VERSION.
why: Malformed or older data can create invalid player state or later runtime failures instead of following the C load recovery path.
confidence: high

### L12_saveload-027  Remapped chunk data is mutated in place during load
sev: P1
concession: n
ref: reference/src/load.c:1307-1355
port: packages/core/src/session/save.ts:1426-1437
expected: C decodes each save stream into a new chunk, so reading the same source again applies the same source values and does not rewrite the saved input.
actual: deserializeChunk calls remapFeats(data.feats, featRemap) directly before restoreSquares, mutating the SavedGame payload's feature array.
why: Loading the same in-memory save twice with a nonidentity feature remap can remap already-remapped values a second time and produce a different level.
confidence: high

### L12_saveload-028  Missing artifact or ego references silently degrade instead of failing the item read
sev: P1
concession: n
ref: reference/src/load.c:137-151,238-245
port: packages/core/src/session/save.ts:210-215,217-252
expected: C treats an absent artifact or ego lookup as an item-read failure, and rejects an item whose kind cannot be found.
actual: deserializeObject maps an unknown artifact or ego id to null and continues; only an unknown kind throws.
why: A save with removed or mismatched artifact/ego definitions loads a changed item instead of following the C error path and preserving load integrity.
confidence: high

### L12_saveload-029  Port-only manifest, mod bags, and orphan blocks have no C save basis
sev: P3
concession: n
ref: reference/src/save.c:418-1070
port: packages/core/src/session/save.ts:818-842; packages/core/src/session/game.ts:2693-2700; packages/core/src/mod/save-blocks.ts:1-32
expected: The C save contains only the player/world blocks implemented by save.c and no pack manifest, opaque mod bag, or orphan quarantine record.
actual: The port adds manifest, mods, orphans, and orphan acknowledgement fields and mutates them during load reconciliation.
why: These are port-invented save semantics with no upstream reference field or control flow and they extend the persisted state beyond C parity.
confidence: high

## MAP L12_saveload
reference/src/save-charoutput.c -> NONE
reference/src/save-charoutput.h -> NONE
reference/src/load.c -> packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/save.c -> packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/savefile.c -> packages/core/src/save/buffer.ts; packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts; packages/web/src/roster.ts
reference/src/savefile.h -> packages/core/src/save/buffer.ts; packages/core/src/session/save.ts; packages/core/src/session/game.ts; packages/web/src/main.ts; packages/web/src/roster.ts

# ===== L13_score_death =====

## MAP L13_score_death
reference/src/list-history-types.h -> packages/core/src/player/history.ts
reference/src/score.c -> packages/core/src/score/score.ts
reference/src/score.h -> packages/core/src/score/score.ts
reference/src/score-util.c -> packages/core/src/score/score-util.ts

# ===== L14_ui_frontend =====

### L14_ui_frontend-001  Native module header has no browser counterpart
sev: P3
concession: y
ref: reference/src/main.h:24
port: NONE
expected: Native frontend module declarations and platform initialization interfaces.
actual: Browser startup uses direct TypeScript imports without a module header equivalent.
why: Native module selection is unavailable in the browser frontend.
confidence: high

### L14_ui_frontend-002  Main Windows frontend does not decode C background attributes
sev: P2
concession: n
ref: reference/src/main-win.c:2131
port: packages/web/src/term.ts:399
expected: Decode MULT_BG attributes and render BG_SAME, BG_DARK, or BG_BLACK backgrounds.
actual: Generic text output stores only foreground color unless a caller explicitly supplies a CSS background.
why: Cells using C background attributes can render with the wrong background.
confidence: high

### L14_ui_frontend-003  Native Windows frontend is replaced by browser rendering
sev: P3
concession: y
ref: reference/src/main-win.c:1
port: packages/web/src/main.ts:1; packages/web/src/term.ts:1
expected: Win32 windows, menus, fonts, preferences, native input, and native drawing are initialized by the Windows frontend.
actual: A browser canvas, DOM keyboard events, local storage, and modal overlays provide the frontend.
why: The native Win32 window and input model has no browser equivalent.
confidence: high

### L14_ui_frontend-004  Browser startup omits native command-line bootstrap
sev: P3
concession: y
ref: reference/src/main.c:278
port: packages/web/src/main.ts:5977
expected: Parse native command-line module, savefile, graphics, path, and new-game options before starting the selected frontend.
actual: Browser startup uses URL parameters, roster storage, and browser boot menus instead of native command-line parsing.
why: Native process launch options cannot be reproduced in a browser tab.
confidence: high

### L14_ui_frontend-005  Birth random choices use an independent RNG
sev: P1
concession: n
ref: reference/src/ui-birth.c:678
port: packages/web/src/birth.ts:1207
expected: Random birth choices consume the shared game RNG stream.
actual: Random birth choices use a new Date.now-seeded RNG.
why: Random outcomes and RNG sequencing diverge from seeded C gameplay.
confidence: high

### L14_ui_frontend-006  Random birth name is missing
sev: P2
concession: n
ref: reference/src/ui-birth.c:725
port: packages/web/src/birth.ts:1652
expected: Random completion calls player_random_name() and accepts the generated name.
actual: Random completion leaves the name empty and defaults it to Adventurer.
why: Random character creation produces a different visible and saved name.
confidence: high

### L14_ui_frontend-007  Birth help key is a no-op
sev: P2
concession: n
ref: reference/src/ui-birth.c:859
port: packages/web/src/birth.ts:946
expected: The birth menu '?' key opens do_cmd_help().
actual: The birth menu recognizes '?' and returns without opening help.
why: Players cannot reach the reference help screen from birth menus.
confidence: high

### L14_ui_frontend-008  Screen dump format and contents differ
sev: P2
concession: n
ref: reference/src/ui-command.c:540
port: packages/web/src/main.ts:4315
expected: Prompt for HTML or forum text, optionally include the monster-list subwindow, reset visuals, and write the terminal grid dump.
actual: Always downloads a PNG of the current canvas.
why: Player-requested screen dumps are not equivalent to the C output.
confidence: high

### L14_ui_frontend-009  Player context menu omits Use
sev: P2
concession: n
ref: reference/src/ui-context.c:267
port: packages/web/src/context-menu.ts:63
expected: The player context menu includes the generic Use command.
actual: The player context menu starts with Cast and has no Use entry.
why: Right-clicking the player cannot invoke the normal generic item-use command.
confidence: high

### L14_ui_frontend-010  Player context availability rules differ
sev: P2
concession: n
ref: reference/src/ui-context.c:269
port: packages/web/src/context-menu.ts:63
expected: Cast, Go Up, Go Down, and Explore are added only when their C predicates permit them; Explore depends on autoexplore_commands.
actual: Cast and stair commands are always rendered disabled when unavailable, and Explore is always rendered.
why: Menu contents and selectable command layout visibly diverge.
confidence: high

### L14_ui_frontend-011  Spellbook Browse is missing from object context menus
sev: P2
concession: n
ref: reference/src/ui-context.c:680
port: packages/web/src/context-menu.ts:257
expected: A browsable spellbook adds the Browse command and opens the spell menu.
actual: The object context menu omits Browse and offers only Cast and Study for books.
why: Right-clicking a spellbook cannot open the reference browse view.
confidence: high

### L14_ui_frontend-012  Single removable curse skips selection
sev: P2
concession: n
ref: reference/src/ui-curse.c:91
port: packages/web/src/main.ts:1683
expected: Any nonempty removable-curse list opens the curse menu, including one entry.
actual: The curse menu opens only when more than one removable curse exists.
why: The one-curse path does not preserve the C selection interaction or selected curse index.
confidence: high

### L14_ui_frontend-013  Retirement uses death artwork
sev: P2
concession: n
ref: reference/src/ui-death.c:75
port: packages/web/src/screens.ts:1294
expected: Retirement loads retire.txt while death loads dead.txt.
actual: The web tombstone always uses embedded dead artwork.
why: Retired characters display the wrong exit screen.
confidence: high

### L14_ui_frontend-014  Sidebar stats omit live equipment and timed modifiers
sev: P2
concession: n
ref: reference/src/ui-display.c:160
port: packages/core/src/game/display.ts:184
expected: Display player->state.stat_use, including equipment and timed effects.
actual: The live default derives statUse from only race and class adjustments.
why: Equipped or temporarily modified stats can display incorrectly.
confidence: high

### L14_ui_frontend-015  Moves indicator is never wired live
sev: P2
concession: n
ref: reference/src/ui-display.c:1147
port: packages/web/src/main.ts:4605
expected: Display player->state.num_moves as Moves +N or Moves -N when nonzero.
actual: displayDeps supplies no numMoves, so the model defaults to zero.
why: The live status line omits the C movement-speed indicator.
confidence: high

### L14_ui_frontend-016  Projectile animations are absent
sev: P2
concession: n
ref: reference/src/ui-display.c:1643
port: packages/web/src/main.ts:2259
expected: Bolt, beam, and missile event handlers draw transient glyphs with delay-factor timing.
actual: Fire and throw dispatch directly to core path processing with no transient UI animation.
why: Normal ranged and projection effects lose visible C frontend animation.
confidence: high

### L14_ui_frontend-017  Select effects fall back to random choice
sev: P1
concession: n
ref: reference/src/ui-effect.c:162
port: packages/core/src/effects/interpreter.ts:487
expected: EF_SELECT presents an effect menu, including the optional random entry, and returns the selected index.
actual: No live chooseEffect implementation is wired, so the interpreter selects randomly.
why: Player-controlled random-effect choices become automatic RNG choices.
confidence: high

### L14_ui_frontend-018  Object-list overflow summary is missing
sev: P2
concession: n
ref: reference/src/ui-obj-list.c:169
port: packages/web/src/screens.ts:962
expected: Limit the object-list section to available text-block height and emit ...and N others.
actual: Render every object row in a scrollable modal without the C overflow summary.
why: Crowded object lists show different information and interaction.
confidence: high

### L14_ui_frontend-019  Ability menu tags do not skip movement keys
sev: P2
concession: n
ref: reference/src/ui-player-properties.c:31
port: packages/web/src/overlay.ts:43
expected: Ability tags use all_letters_nohjkl, skipping h, j, k, and l.
actual: Menu tags use the contiguous alphabet including h, j, k, and l.
why: Letter selection addresses different abilities than the C UI.
confidence: high

### L14_ui_frontend-020  Spell menu tags do not skip movement keys
sev: P2
concession: n
ref: reference/src/ui-spell.c:249
port: packages/web/src/overlay.ts:43; packages/web/src/screens.ts:668
expected: Spell selection uses all_letters_nohjkl.
actual: Spell rows receive contiguous a-z menu tags.
why: Letter selection differs for spell cast, study, and browse menus.
confidence: high

### L14_ui_frontend-021  Subwindow setup is missing
sev: P2
concession: n
ref: reference/src/ui-options.c:2042
port: packages/web/src/options.ts:548
expected: The options menu exposes subwindow setup.
actual: The web options menu omits subwindow setup because no subwindows are modelled.
why: Users cannot configure the C frontend's simultaneous auxiliary windows.
confidence: high

### L14_ui_frontend-022  Advanced visual editing is missing
sev: P2
concession: n
ref: reference/src/ui-options.c:2059
port: packages/web/src/options.ts:507
expected: Save visuals opens per-entity visual editing and persistence.
actual: The web UI only selects a tile set or ASCII mode.
why: Individual glyph and color mappings cannot be edited from the UI.
confidence: high

### L14_ui_frontend-023  Preference commands are not parsed
sev: P2
concession: n
ref: reference/src/ui-prefs.c:1185
port: packages/web/src/main.ts:4343
expected: A typed preference directive is parsed and applied.
actual: Every preference-line command reports Pref command not recognized.
why: Valid C preference directives have no effect in the web frontend.
confidence: high

### L14_ui_frontend-024  Store flavor uses the wrong RNG and omits hints
sev: P1
concession: n
ref: reference/src/ui-store.c:139
port: packages/web/src/shop.ts:180
expected: Welcome and hint choices use the game RNG with the C one_in_ and randint0 draw order.
actual: Welcome text uses Math.random and omits the C hint branches.
why: Shop visits produce different flavor and advance no equivalent game RNG sequence.
confidence: high

### L14_ui_frontend-025  POSIX signal handling has no browser counterpart
sev: P3
concession: y
ref: reference/src/ui-signals.c:26
port: NONE
expected: Install SIGHUP, SIGTSTP, and SIGINT handlers for orderly save, suspend, and shutdown behavior.
actual: No browser implementation exists for these POSIX signal handlers.
why: Browser tabs do not expose the native POSIX signal model.
confidence: high

### L14_ui_frontend-026  Interactive spoilers are unavailable in the web UI
sev: P3
concession: n
ref: reference/src/ui-spoil.c:47
port: packages/web/src/wizard.ts:293; packages/cli/src/spoilers.ts:1
expected: The interactive UI exposes spoiler actions that generate the four spoiler files.
actual: Web wizard selection reports the feature as unavailable and generation exists only in CLI tooling.
why: Web users cannot invoke the reference spoiler workflow.
confidence: high

### L14_ui_frontend-027  Wizard graphics demo is not ported
sev: P3
concession: n
ref: reference/src/ui-wizard.c:78
port: packages/web/src/wizard.ts:273
expected: The wizard opens the projection graphics demonstration.
actual: The web action reports that the graphics demo is not ported.
why: The wizard lacks the reference projection-visual diagnostic.
confidence: high

### L14_ui_frontend-028  Wizard keylog is not ported
sev: P3
concession: n
ref: reference/src/ui-wizard.c:99
port: packages/web/src/wizard.ts:307
expected: Display recent keypresses with key codes and modifiers.
actual: The web shell does not record a keystroke log.
why: A browser KeyboardEvent stream could provide this debugging view.
confidence: high

### L14_ui_frontend-029  Native DIB frontend is replaced by browser decoding
sev: P3
concession: y
ref: reference/src/win/readdib.c:20
port: packages/web/src/tiles.ts:64
expected: Decode Windows DIB resources through the native Win32 DIB loader.
actual: Decode tile images through browser Image and canvas APIs.
why: This is an unavoidable platform-specific frontend substitution.
confidence: high

### L14_ui_frontend-030  Native PNG frontend is replaced by browser decoding
sev: P3
concession: y
ref: reference/src/win/readpng.c:20
port: packages/web/src/tiles.ts:64
expected: Decode PNG pixels, palettes, alpha, and masks through the native libpng path.
actual: Load PNG images through browser Image and canvas APIs.
why: Native libpng and Win32 bitmap ownership have no browser equivalent.
confidence: high

### L14_ui_frontend-031  Multi-window Win32 layout is not reproduced
sev: P3
concession: y
ref: reference/src/win/win-layout.c:41
port: packages/web/src/main.ts:4662
expected: Create and position distinct Win32 terminal, message, inventory, monster, object, and recall windows.
actual: Render a single fixed terminal canvas with modal overlays and a camera viewport.
why: The browser frontend has no native HWND layout model.
confidence: high

### L14_ui_frontend-032  Screenshot capture scope differs
sev: P3
concession: y
ref: reference/src/win/scrnshot.c:38
port: packages/web/src/main.ts:4315
expected: Capture the Win32 client area through GDI and write its pixels to PNG.
actual: Export the web canvas with canvas.toDataURL("image/png").
why: Browser capture covers the canvas only and cannot capture arbitrary native windows.
confidence: high

### L14_ui_frontend-033  Native libpng12 header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/libpng12/png.h:1
port: NONE
expected: Provide libpng12 declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no libpng12 header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-034  Native libpng12 configuration header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/libpng12/pngconf.h:1
port: NONE
expected: Provide libpng12 configuration declarations for the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no libpng12 configuration header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-035  Native PNG header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/png.h:1
port: NONE
expected: Provide libpng declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no PNG C header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-036  Native PNG configuration header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/pngconf.h:1
port: NONE
expected: Provide libpng configuration declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no PNG C header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-037  Native zconf header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/zconf.h:1
port: NONE
expected: Provide zlib configuration declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no zconf header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-038  Native zlib header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/zlib.h:1
port: NONE
expected: Provide zlib declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no zlib header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-039  Native DIB header has no direct counterpart
sev: P3
concession: y
ref: reference/src/win/readdib.h:1
port: NONE
expected: Expose DIBINIT and ReadDIB/FreeDIB declarations to the Windows frontend.
actual: The browser tile loader exposes browser image objects instead of DIB declarations.
why: Win32 bitmap handles and DIB memory ownership do not exist in the browser.
confidence: high

### L14_ui_frontend-040  Equipment quick filters are not implemented
sev: P2
concession: n
ref: reference/src/ui-equip-cmp.c:511
port: packages/web/src/equip-cmp.ts:16
expected: q and ! prompt for and apply the normal or inverted quick attribute filter.
actual: The web equipment comparison screen has no q or ! action.
why: Players cannot reproduce the reference filtered comparison view.
confidence: high

### L14_ui_frontend-041  Equipment comparison dump is not implemented
sev: P3
concession: n
ref: reference/src/ui-equip-cmp.c:511
port: packages/web/src/equip-cmp.ts:16
expected: d prompts for a file and writes the current equipment comparison dump.
actual: The web equipment comparison screen has no d action or file dump.
why: The reference comparison export is unavailable.
confidence: high

### L14_ui_frontend-042  Target navigation shortcuts are missing
sev: P2
concession: n
ref: reference/src/ui-target.c:1488
port: packages/core/src/game/target-loop.ts:345
expected: g pathfinds, the ignore key updates tracked objects, and >, <, and x select nearest stairs or unexplored areas.
actual: The web target loop handles neither these branches nor their state updates; the keys fall through to direction or unknown-key handling.
why: Normal target-mode navigation and ignore shortcuts behave differently.
confidence: high

### L14_ui_frontend-043  Object and ego knowledge recall omits computed details
sev: P2
concession: n
ref: reference/src/ui-knowledge.c:1791
port: packages/web/src/knowledge.ts:745
expected: Fake object and ego recalls render object_info and object_info_ego computed flag, combat, and ability lines.
actual: The web recalls show only the name plus available flavor or lore text.
why: Knowledge screens omit visible mechanical information supplied by the C recall.
confidence: high

## MAP L14_ui_frontend
reference/src/grafmode.c -> packages/core/src/visuals/grafmode.ts; packages/core/src/visuals/grafmode-data.ts
reference/src/grafmode.h -> packages/core/src/visuals/grafmode.ts
reference/src/list-ui-entry-renderers.h -> packages/core/src/generated/ui-entry-renderers.ts; packages/core/src/game/ui-entry.ts
reference/src/main.c -> packages/web/src/main.ts; packages/core/src/session/game.ts
reference/src/main.h -> NONE
reference/src/main-win.c -> packages/web/src/main.ts; packages/web/src/term.ts; packages/web/src/tiles.ts; packages/web/src/options.ts; packages/web/src/ui-colors.ts
reference/src/ui-birth.c -> packages/web/src/birth.ts; packages/web/src/main.ts
reference/src/ui-birth.h -> packages/web/src/birth.ts
reference/src/ui-command.c -> packages/web/src/main.ts; packages/web/src/term.ts
reference/src/ui-command.h -> packages/web/src/main.ts
reference/src/ui-context.c -> packages/web/src/context-menu.ts; packages/web/src/main.ts
reference/src/ui-context.h -> packages/web/src/context-menu.ts
reference/src/ui-curse.c -> packages/web/src/main.ts; packages/core/src/game/effect-item.ts
reference/src/ui-curse.h -> packages/web/src/main.ts
reference/src/ui-death.c -> packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-death.h -> packages/web/src/screens.ts
reference/src/ui-display.c -> packages/core/src/game/display.ts; packages/web/src/main.ts
reference/src/ui-display.h -> packages/core/src/game/display.ts
reference/src/ui-effect.c -> packages/core/src/effects/interpreter.ts
reference/src/ui-effect.h -> packages/core/src/effects/interpreter.ts
reference/src/ui-entry.c -> packages/core/src/game/ui-entry.ts; packages/content/src/specs/ui-entry.ts
reference/src/ui-entry.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-combiner.c -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-combiner.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-init.h -> packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/src/ui-entry-renderers.c -> packages/core/src/game/ui-entry.ts; packages/core/src/generated/ui-entry-renderers.ts
reference/src/ui-entry-renderers.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-equip-cmp.c -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-equip-cmp.h -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-event.c -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-event.h -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-game.c -> packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/ui-game.h -> packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/ui-help.c -> packages/web/src/help.ts; packages/web/src/main.ts
reference/src/ui-help.h -> packages/web/src/help.ts
reference/src/ui-history.c -> packages/core/src/player/history.ts; packages/web/src/screens.ts
reference/src/ui-history.h -> packages/core/src/player/history.ts; packages/web/src/charsheet.ts
reference/src/ui-init.c -> packages/web/src/main.ts
reference/src/ui-init.h -> packages/web/src/main.ts
reference/src/ui-input.c -> packages/web/src/main.ts; packages/web/src/overlay.ts; packages/web/src/input-queue.ts
reference/src/ui-input.h -> packages/web/src/main.ts; packages/web/src/input-queue.ts
reference/src/ui-keymap.c -> packages/web/src/keymap-store.ts; packages/web/src/keymap-edit.ts
reference/src/ui-keymap.h -> packages/web/src/keymap-store.ts
reference/src/ui-knowledge.c -> packages/web/src/knowledge.ts; packages/web/src/main.ts; packages/core/src/obj/knowledge.ts; packages/core/src/mon/lore-describe.ts
reference/src/ui-knowledge.h -> packages/web/src/knowledge.ts; packages/web/src/main.ts
reference/src/ui-map.c -> packages/web/src/mapview.ts; packages/web/src/main.ts
reference/src/ui-map.h -> packages/web/src/mapview.ts
reference/src/ui-menu.c -> packages/web/src/overlay.ts
reference/src/ui-menu.h -> packages/web/src/overlay.ts
reference/src/ui-mon-list.c -> packages/core/src/game/mon-list.ts; packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-mon-list.h -> packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-mon-lore.c -> packages/core/src/mon/lore-describe.ts; packages/web/src/screens.ts
reference/src/ui-mon-lore.h -> packages/core/src/mon/lore-describe.ts
reference/src/ui-object.c -> packages/core/src/obj/object-info.ts; packages/web/src/main.ts; packages/web/src/screens.ts; packages/web/src/ignore-menu.ts
reference/src/ui-object.h -> packages/web/src/main.ts; packages/web/src/ignore-menu.ts
reference/src/ui-obj-list.c -> packages/core/src/game/obj-list.ts; packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-obj-list.h -> packages/core/src/game/obj-list.ts; packages/web/src/screens.ts
reference/src/ui-options.c -> packages/web/src/options.ts; packages/web/src/keymap-edit.ts; packages/web/src/colors.ts; packages/web/src/ignore-menu.ts; packages/core/src/player/options.ts
reference/src/ui-options.h -> packages/web/src/options.ts; packages/core/src/player/options.ts
reference/src/ui-output.c -> packages/web/src/main.ts; packages/web/src/overlay.ts; packages/web/src/mapview.ts
reference/src/ui-output.h -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-player.c -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts; packages/web/src/screens.ts
reference/src/ui-player.h -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts
reference/src/ui-player-properties.c -> packages/core/src/player/abilities.ts; packages/web/src/abilities.ts
reference/src/ui-player-properties.h -> packages/core/src/player/abilities.ts; packages/web/src/abilities.ts
reference/src/ui-prefs.c -> packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts; packages/web/src/colors.ts; packages/web/src/keymap-store.ts; packages/web/src/main.ts
reference/src/ui-prefs.h -> packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts
reference/src/ui-score.c -> packages/core/src/score/display.ts; packages/core/src/score/score.ts; packages/web/src/score.ts
reference/src/ui-score.h -> packages/core/src/score/display.ts; packages/web/src/score.ts
reference/src/ui-signals.c -> NONE
reference/src/ui-signals.h -> NONE
reference/src/ui-spell.c -> packages/core/src/effects/effect-info.ts; packages/core/src/player/spell.ts; packages/web/src/screens.ts; packages/web/src/overlay.ts; packages/web/src/main.ts
reference/src/ui-spell.h -> packages/web/src/screens.ts; packages/web/src/overlay.ts; packages/web/src/main.ts
reference/src/ui-spoil.c -> packages/cli/src/spoilers.ts; packages/cli/src/main-spoil.ts; packages/web/src/wizard.ts
reference/src/ui-spoil.h -> packages/cli/src/spoilers.ts
reference/src/ui-store.c -> packages/core/src/store/store.ts; packages/core/src/store/price.ts; packages/core/src/store/transact.ts; packages/web/src/shop.ts
reference/src/ui-store.h -> packages/core/src/store/types.ts; packages/web/src/shop.ts
reference/src/ui-target.c -> packages/core/src/game/target.ts; packages/core/src/game/target-loop.ts; packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-target.h -> packages/core/src/game/target.ts; packages/core/src/game/target-loop.ts
reference/src/ui-term.c -> packages/web/src/term.ts; packages/web/src/font-16x24.ts
reference/src/ui-term.h -> packages/web/src/term.ts
reference/src/ui-visuals.c -> packages/core/src/visuals/engine.ts; packages/content/src/specs/visuals.ts; packages/web/src/main.ts; packages/web/src/tiles.ts
reference/src/ui-visuals.h -> packages/core/src/visuals/engine.ts; packages/core/src/visuals/index.ts
reference/src/ui-wizard.c -> packages/core/src/game/wizard.ts; packages/web/src/wizard.ts
reference/src/ui-wizard.h -> packages/core/src/game/wizard.ts; packages/web/src/wizard.ts
reference/src/win/include/libpng12/png.h -> NONE
reference/src/win/include/libpng12/pngconf.h -> NONE
reference/src/win/include/png.h -> NONE
reference/src/win/include/pngconf.h -> NONE
reference/src/win/include/zconf.h -> NONE
reference/src/win/include/zlib.h -> NONE
reference/src/win/readdib.c -> packages/web/src/tiles.ts
reference/src/win/readdib.h -> NONE
reference/src/win/readpng.c -> packages/web/src/tiles.ts
reference/src/win/scrnshot.c -> packages/web/src/main.ts
reference/src/win/scrnshot.h -> packages/web/src/main.ts
reference/src/win/win-layout.c -> packages/web/src/main.ts; packages/web/src/term.ts
reference/src/win/win-menu.h -> packages/web/src/game-menu.ts; packages/web/src/options.ts
reference/src/win/win-term.h -> packages/web/src/term.ts

# ===== L15_tiles =====

## MAP L15_tiles
reference/lib/tiles/adam-bolt/16x16.png -> packages/web/public/tiles/adam-bolt/16x16.png
reference/lib/tiles/adam-bolt/flvr-new.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/adam-bolt/graf-new.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/adam-bolt/Makefile -> NONE
reference/lib/tiles/adam-bolt/xtra-new.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/gervais/32x32.png -> packages/web/public/tiles/gervais/32x32.png
reference/lib/tiles/gervais/flvr-dvg.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/gervais/graf-dvg.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/gervais/Makefile -> NONE
reference/lib/tiles/gervais/xtra-dvg.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/list.txt -> packages/web/src/tiles.ts
reference/lib/tiles/Makefile -> NONE
reference/lib/tiles/nomad/8x16.png -> packages/web/public/tiles/nomad/8x16.png
reference/lib/tiles/nomad/flvr-nmd.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/nomad/graf-nmd.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/nomad/Makefile -> NONE
reference/lib/tiles/nomad/xtra-nmd.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/old/8x8.png -> packages/web/public/tiles/old/8x8.png
reference/lib/tiles/old/flvr-xxx.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/old/graf-xxx.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/old/Makefile -> NONE
reference/lib/tiles/old/xtra-xxx.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/shockbolt/64x64.png -> packages/web/public/tiles/shockbolt/64x64.png
reference/lib/tiles/shockbolt/flvr-shb.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/shockbolt/graf-shb-dark.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/shockbolt/graf-shb-light.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts
reference/lib/tiles/shockbolt/Makefile -> NONE
reference/lib/tiles/shockbolt/xtra-shb.prf -> packages/web/src/tiles.ts + packages/web/src/tile-mods.ts

# ===== L16_sounds =====

### L16_sounds-001  SDL mixer backend is replaced by HTMLAudio
sev: P2
concession: y
ref: reference/src/snd-sdl.c:65-80,177-198
port: packages/web/src/sound.ts:64-126
expected: Initialize SDL_mixer at 22050 Hz, S16, stereo, buffer 4096; load MP3 as music and OGG as chunks; play through SDL mixer.
actual: Use one HTMLAudioElement per sample with browser-controlled rate, channels, buffering, and playback behavior.
why: Native SDL mixer behavior cannot be reproduced exactly in a browser runtime.
confidence: high

### L16_sounds-002  First-format load prevents C-style fallback
sev: P2
concession: n
ref: reference/src/sound-core.c:127-167
port: packages/core/src/sound/engine.ts:120-130; packages/web/src/sound.ts:74-94
expected: Build the full sound path, check each extension with file_exists, call the platform hook only for existing files, and continue to the next extension after failure.
actual: Call the hook for every format without existence checks. The web hook returns true optimistically for the first format and only marks ERROR asynchronously after an audio error.
why: A missing or undecodable MP3 prevents fallback to an available OGG file.
confidence: high

### L16_sounds-003  Initialization succeeds without the C-required open hook
sev: P3
concession: y
ref: reference/src/sound-core.c:356-386
port: packages/core/src/sound/engine.ts:230-236; packages/web/src/sound.ts:138-150
expected: Select a sound module, require open_audio_hook, fail initialization if opening the platform audio system fails.
actual: SoundEngine.init succeeds when no openAudio hook exists; the web installer supplies no open hook.
why: Browser audio elements do not require a process-wide SDL-style mixer initialization.
confidence: high

### L16_sounds-004  C tokenizer preserves empty tokens but port filters them
sev: P3
concession: n
ref: reference/src/sound-core.c:195-210,250-266
port: packages/core/src/sound/engine.ts:146-150
expected: Split only at literal spaces; leading, repeated, or trailing spaces can produce empty sample names.
actual: Split on spaces and discard empty tokens.
why: Malformed or custom sound preference strings do not preserve the C mapping and sound-pool behavior.
confidence: high

## MAP L16_sounds
reference/src/snd-sdl.c -> packages/web/src/sound.ts; packages/core/src/sound/engine.ts
reference/src/snd-sdl.h -> packages/web/src/sound.ts; packages/core/src/sound/types.ts
reference/src/snd-win.h -> packages/web/src/sound.ts
reference/src/sound.h -> packages/core/src/sound/types.ts; packages/core/src/sound/engine.ts
reference/src/sound-core.c -> packages/core/src/sound/engine.ts; packages/web/src/sound.ts
reference/lib/sounds/Makefile -> packages/web/package.json; packages/web/public/sounds/
reference/lib/sounds/amb_bell_metal1.mp3 -> packages/web/public/sounds/amb_bell_metal1.mp3
reference/lib/sounds/amb_bell_metal2.mp3 -> packages/web/public/sounds/amb_bell_metal2.mp3
reference/lib/sounds/amb_bell_tibet1.mp3 -> packages/web/public/sounds/amb_bell_tibet1.mp3
reference/lib/sounds/amb_bell_tibet2.mp3 -> packages/web/public/sounds/amb_bell_tibet2.mp3
reference/lib/sounds/amb_bell_tibet3.mp3 -> packages/web/public/sounds/amb_bell_tibet3.mp3
reference/lib/sounds/amb_door_doom.mp3 -> packages/web/public/sounds/amb_door_doom.mp3
reference/lib/sounds/amb_door_iron.mp3 -> packages/web/public/sounds/amb_door_iron.mp3
reference/lib/sounds/amb_dungeon_echo.mp3 -> packages/web/public/sounds/amb_dungeon_echo.mp3
reference/lib/sounds/amb_dungeon_echowet.mp3 -> packages/web/public/sounds/amb_dungeon_echowet.mp3
reference/lib/sounds/amb_gong_chinese.mp3 -> packages/web/public/sounds/amb_gong_chinese.mp3
reference/lib/sounds/amb_gong_low.mp3 -> packages/web/public/sounds/amb_gong_low.mp3
reference/lib/sounds/amb_gong_strike.mp3 -> packages/web/public/sounds/amb_gong_strike.mp3
reference/lib/sounds/amb_gong_undertone.mp3 -> packages/web/public/sounds/amb_gong_undertone.mp3
reference/lib/sounds/amb_guitar_chord.mp3 -> packages/web/public/sounds/amb_guitar_chord.mp3
reference/lib/sounds/amb_pulse_low.mp3 -> packages/web/public/sounds/amb_pulse_low.mp3
reference/lib/sounds/amb_thunder_rain.mp3 -> packages/web/public/sounds/amb_thunder_rain.mp3
reference/lib/sounds/amb_thunder_roll.mp3 -> packages/web/public/sounds/amb_thunder_roll.mp3
reference/lib/sounds/id_bad_aww.mp3 -> packages/web/public/sounds/id_bad_aww.mp3
reference/lib/sounds/id_bad_dang.mp3 -> packages/web/public/sounds/id_bad_dang.mp3
reference/lib/sounds/id_bad_hmm.mp3 -> packages/web/public/sounds/id_bad_hmm.mp3
reference/lib/sounds/id_bad_hmph.mp3 -> packages/web/public/sounds/id_bad_hmph.mp3
reference/lib/sounds/id_bad_ohh.mp3 -> packages/web/public/sounds/id_bad_ohh.mp3
reference/lib/sounds/id_ego_whoa.mp3 -> packages/web/public/sounds/id_ego_whoa.mp3
reference/lib/sounds/id_ego_woohoo.mp3 -> packages/web/public/sounds/id_ego_woohoo.mp3
reference/lib/sounds/id_ego_yeah.mp3 -> packages/web/public/sounds/id_ego_yeah.mp3
reference/lib/sounds/id_ego_yeah2.mp3 -> packages/web/public/sounds/id_ego_yeah2.mp3
reference/lib/sounds/id_ego_yes.mp3 -> packages/web/public/sounds/id_ego_yes.mp3
reference/lib/sounds/id_good_hey.mp3 -> packages/web/public/sounds/id_good_hey.mp3
reference/lib/sounds/id_good_hey2.mp3 -> packages/web/public/sounds/id_good_hey2.mp3
reference/lib/sounds/id_good_hmm.mp3 -> packages/web/public/sounds/id_good_hmm.mp3
reference/lib/sounds/id_good_huh.mp3 -> packages/web/public/sounds/id_good_huh.mp3
reference/lib/sounds/id_good_ooh.mp3 -> packages/web/public/sounds/id_good_ooh.mp3
reference/lib/sounds/id_good_ooo.mp3 -> packages/web/public/sounds/id_good_ooo.mp3
reference/lib/sounds/id_good_wow.mp3 -> packages/web/public/sounds/id_good_wow.mp3
reference/lib/sounds/mco_attack_breath.mp3 -> packages/web/public/sounds/mco_attack_breath.mp3
reference/lib/sounds/mco_attack_spray.mp3 -> packages/web/public/sounds/mco_attack_spray.mp3
reference/lib/sounds/mco_bite_chew.mp3 -> packages/web/public/sounds/mco_bite_chew.mp3
reference/lib/sounds/mco_bite_chomp.mp3 -> packages/web/public/sounds/mco_bite_chomp.mp3
reference/lib/sounds/mco_bite_dainty.mp3 -> packages/web/public/sounds/mco_bite_dainty.mp3
reference/lib/sounds/mco_bite_gnash.mp3 -> packages/web/public/sounds/mco_bite_gnash.mp3
reference/lib/sounds/mco_bite_hard.mp3 -> packages/web/public/sounds/mco_bite_hard.mp3
reference/lib/sounds/mco_bite_long.mp3 -> packages/web/public/sounds/mco_bite_long.mp3
reference/lib/sounds/mco_bite_munch.mp3 -> packages/web/public/sounds/mco_bite_munch.mp3
reference/lib/sounds/mco_bite_regular.mp3 -> packages/web/public/sounds/mco_bite_regular.mp3
reference/lib/sounds/mco_bite_short.mp3 -> packages/web/public/sounds/mco_bite_short.mp3
reference/lib/sounds/mco_bite_small.mp3 -> packages/web/public/sounds/mco_bite_small.mp3
reference/lib/sounds/mco_bite_soft.mp3 -> packages/web/public/sounds/mco_bite_soft.mp3
reference/lib/sounds/mco_card_shuffle.mp3 -> packages/web/public/sounds/mco_card_shuffle.mp3
reference/lib/sounds/mco_castanet_trill.mp3 -> packages/web/public/sounds/mco_castanet_trill.mp3
reference/lib/sounds/mco_ceramic_trill.mp3 -> packages/web/public/sounds/mco_ceramic_trill.mp3
reference/lib/sounds/mco_click_vibra.mp3 -> packages/web/public/sounds/mco_click_vibra.mp3
reference/lib/sounds/mco_creature_choking.mp3 -> packages/web/public/sounds/mco_creature_choking.mp3
reference/lib/sounds/mco_creature_groan.mp3 -> packages/web/public/sounds/mco_creature_groan.mp3
reference/lib/sounds/mco_creature_yelp.mp3 -> packages/web/public/sounds/mco_creature_yelp.mp3
reference/lib/sounds/mco_cuica_rubbing.mp3 -> packages/web/public/sounds/mco_cuica_rubbing.mp3
reference/lib/sounds/mco_dino_low.mp3 -> packages/web/public/sounds/mco_dino_low.mp3
reference/lib/sounds/mco_dino_slur.mp3 -> packages/web/public/sounds/mco_dino_slur.mp3
reference/lib/sounds/mco_dino_talk.mp3 -> packages/web/public/sounds/mco_dino_talk.mp3
reference/lib/sounds/mco_dino_yawn.mp3 -> packages/web/public/sounds/mco_dino_yawn.mp3
reference/lib/sounds/mco_dub_wobble.mp3 -> packages/web/public/sounds/mco_dub_wobble.mp3
reference/lib/sounds/mco_frog_trill.mp3 -> packages/web/public/sounds/mco_frog_trill.mp3
reference/lib/sounds/mco_hit_whip.mp3 -> packages/web/public/sounds/mco_hit_whip.mp3
reference/lib/sounds/mco_howl_croak.mp3 -> packages/web/public/sounds/mco_howl_croak.mp3
reference/lib/sounds/mco_howl_deep.mp3 -> packages/web/public/sounds/mco_howl_deep.mp3
reference/lib/sounds/mco_howl_distressed.mp3 -> packages/web/public/sounds/mco_howl_distressed.mp3
reference/lib/sounds/mco_howl_high.mp3 -> packages/web/public/sounds/mco_howl_high.mp3
reference/lib/sounds/mco_howl_long.mp3 -> packages/web/public/sounds/mco_howl_long.mp3
reference/lib/sounds/mco_liquid_squirt.mp3 -> packages/web/public/sounds/mco_liquid_squirt.mp3
reference/lib/sounds/mco_man_mumble.mp3 -> packages/web/public/sounds/mco_man_mumble.mp3
reference/lib/sounds/mco_mouse_squeaks.mp3 -> packages/web/public/sounds/mco_mouse_squeaks.mp3
reference/lib/sounds/mco_rubber_thud.mp3 -> packages/web/public/sounds/mco_rubber_thud.mp3
reference/lib/sounds/mco_scurry_dry.mp3 -> packages/web/public/sounds/mco_scurry_dry.mp3
reference/lib/sounds/mco_shake_roll.mp3 -> packages/web/public/sounds/mco_shake_roll.mp3
reference/lib/sounds/mco_snarl_short.mp3 -> packages/web/public/sounds/mco_snarl_short.mp3
reference/lib/sounds/mco_spray_long.mp3 -> packages/web/public/sounds/mco_spray_long.mp3
reference/lib/sounds/mco_squish_hit.mp3 -> packages/web/public/sounds/mco_squish_hit.mp3
reference/lib/sounds/mco_squish_snap.mp3 -> packages/web/public/sounds/mco_squish_snap.mp3
reference/lib/sounds/mco_strange_music.mp3 -> packages/web/public/sounds/mco_strange_music.mp3
reference/lib/sounds/mco_strange_thwoink.mp3 -> packages/web/public/sounds/mco_strange_thwoink.mp3
reference/lib/sounds/mco_thoing_backwards.mp3 -> packages/web/public/sounds/mco_thoing_backwards.mp3
reference/lib/sounds/mco_thoing_deep.mp3 -> packages/web/public/sounds/mco_thoing_deep.mp3
reference/lib/sounds/mco_thud_crash.mp3 -> packages/web/public/sounds/mco_thud_crash.mp3
reference/lib/sounds/mco_tube_hit.mp3 -> packages/web/public/sounds/mco_tube_hit.mp3
reference/lib/sounds/plc_bell_warn.mp3 -> packages/web/public/sounds/plc_bell_warn.mp3
reference/lib/sounds/plc_die_laugh.mp3 -> packages/web/public/sounds/plc_die_laugh.mp3
reference/lib/sounds/plc_hit_anvil.mp3 -> packages/web/public/sounds/plc_hit_anvil.mp3
reference/lib/sounds/plc_hit_anvil2.mp3 -> packages/web/public/sounds/plc_hit_anvil2.mp3
reference/lib/sounds/plc_hit_arrow.mp3 -> packages/web/public/sounds/plc_hit_arrow.mp3
reference/lib/sounds/plc_hit_body.mp3 -> packages/web/public/sounds/plc_hit_body.mp3
reference/lib/sounds/plc_hit_groan.mp3 -> packages/web/public/sounds/plc_hit_groan.mp3
reference/lib/sounds/plc_hit_grunt.mp3 -> packages/web/public/sounds/plc_hit_grunt.mp3
reference/lib/sounds/plc_hit_grunt2.mp3 -> packages/web/public/sounds/plc_hit_grunt2.mp3
reference/lib/sounds/plc_hit_hay.mp3 -> packages/web/public/sounds/plc_hit_hay.mp3
reference/lib/sounds/plc_miss_arrow.mp3 -> packages/web/public/sounds/plc_miss_arrow.mp3
reference/lib/sounds/plc_miss_arrow2.mp3 -> packages/web/public/sounds/plc_miss_arrow2.mp3
reference/lib/sounds/plc_miss_swish.mp3 -> packages/web/public/sounds/plc_miss_swish.mp3
reference/lib/sounds/plm_aim_wand.mp3 -> packages/web/public/sounds/plm_aim_wand.mp3
reference/lib/sounds/plm_bang_ceramic.mp3 -> packages/web/public/sounds/plm_bang_ceramic.mp3
reference/lib/sounds/plm_bang_dumpster.mp3 -> packages/web/public/sounds/plm_bang_dumpster.mp3
reference/lib/sounds/plm_bang_metal.mp3 -> packages/web/public/sounds/plm_bang_metal.mp3
reference/lib/sounds/plm_book_pageturn.mp3 -> packages/web/public/sounds/plm_book_pageturn.mp3
reference/lib/sounds/plm_bottle_clinks.mp3 -> packages/web/public/sounds/plm_bottle_clinks.mp3
reference/lib/sounds/plm_break_canister.mp3 -> packages/web/public/sounds/plm_break_canister.mp3
reference/lib/sounds/plm_break_glass.mp3 -> packages/web/public/sounds/plm_break_glass.mp3
reference/lib/sounds/plm_break_glass2.mp3 -> packages/web/public/sounds/plm_break_glass2.mp3
reference/lib/sounds/plm_break_plates.mp3 -> packages/web/public/sounds/plm_break_plates.mp3
reference/lib/sounds/plm_break_shatter.mp3 -> packages/web/public/sounds/plm_break_shatter.mp3
reference/lib/sounds/plm_break_smash.mp3 -> packages/web/public/sounds/plm_break_smash.mp3
reference/lib/sounds/plm_break_wood.mp3 -> packages/web/public/sounds/plm_break_wood.mp3
reference/lib/sounds/plm_cabinet_open.mp3 -> packages/web/public/sounds/plm_cabinet_open.mp3
reference/lib/sounds/plm_cabinet_shut.mp3 -> packages/web/public/sounds/plm_cabinet_shut.mp3
reference/lib/sounds/plm_chain_light.mp3 -> packages/web/public/sounds/plm_chain_light.mp3
reference/lib/sounds/plm_chest_latch.mp3 -> packages/web/public/sounds/plm_chest_latch.mp3
reference/lib/sounds/plm_chest_unlatch.mp3 -> packages/web/public/sounds/plm_chest_unlatch.mp3
reference/lib/sounds/plm_chimes_jangle.mp3 -> packages/web/public/sounds/plm_chimes_jangle.mp3
reference/lib/sounds/plm_click_dry.mp3 -> packages/web/public/sounds/plm_click_dry.mp3
reference/lib/sounds/plm_click_switch.mp3 -> packages/web/public/sounds/plm_click_switch.mp3
reference/lib/sounds/plm_click_switch2.mp3 -> packages/web/public/sounds/plm_click_switch2.mp3
reference/lib/sounds/plm_click_switch3.mp3 -> packages/web/public/sounds/plm_click_switch3.mp3
reference/lib/sounds/plm_click_wood.mp3 -> packages/web/public/sounds/plm_click_wood.mp3
reference/lib/sounds/plm_close_hatch.mp3 -> packages/web/public/sounds/plm_close_hatch.mp3
reference/lib/sounds/plm_coins_dump.mp3 -> packages/web/public/sounds/plm_coins_dump.mp3
reference/lib/sounds/plm_coins_light.mp3 -> packages/web/public/sounds/plm_coins_light.mp3
reference/lib/sounds/plm_coins_pour.mp3 -> packages/web/public/sounds/plm_coins_pour.mp3
reference/lib/sounds/plm_coins_shake.mp3 -> packages/web/public/sounds/plm_coins_shake.mp3
reference/lib/sounds/plm_cork_pop.mp3 -> packages/web/public/sounds/plm_cork_pop.mp3
reference/lib/sounds/plm_cork_squeak.mp3 -> packages/web/public/sounds/plm_cork_squeak.mp3
reference/lib/sounds/plm_door_bolt.mp3 -> packages/web/public/sounds/plm_door_bolt.mp3
reference/lib/sounds/plm_door_creak.mp3 -> packages/web/public/sounds/plm_door_creak.mp3
reference/lib/sounds/plm_door_creakshut.mp3 -> packages/web/public/sounds/plm_door_creakshut.mp3
reference/lib/sounds/plm_door_dungeon.mp3 -> packages/web/public/sounds/plm_door_dungeon.mp3
reference/lib/sounds/plm_door_echolock.mp3 -> packages/web/public/sounds/plm_door_echolock.mp3
reference/lib/sounds/plm_door_entrance.mp3 -> packages/web/public/sounds/plm_door_entrance.mp3
reference/lib/sounds/plm_door_knob.mp3 -> packages/web/public/sounds/plm_door_knob.mp3
reference/lib/sounds/plm_door_latch.mp3 -> packages/web/public/sounds/plm_door_latch.mp3
reference/lib/sounds/plm_door_open.mp3 -> packages/web/public/sounds/plm_door_open.mp3
reference/lib/sounds/plm_door_opening.mp3 -> packages/web/public/sounds/plm_door_opening.mp3
reference/lib/sounds/plm_door_rusty.mp3 -> packages/web/public/sounds/plm_door_rusty.mp3
reference/lib/sounds/plm_door_shut.mp3 -> packages/web/public/sounds/plm_door_shut.mp3
reference/lib/sounds/plm_door_slam.mp3 -> packages/web/public/sounds/plm_door_slam.mp3
reference/lib/sounds/plm_door_squeaky.mp3 -> packages/web/public/sounds/plm_door_squeaky.mp3
reference/lib/sounds/plm_door_wooden.mp3 -> packages/web/public/sounds/plm_door_wooden.mp3
reference/lib/sounds/plm_drop_boot.mp3 -> packages/web/public/sounds/plm_drop_boot.mp3
reference/lib/sounds/plm_eat_bite.mp3 -> packages/web/public/sounds/plm_eat_bite.mp3
reference/lib/sounds/plm_floor_creak.mp3 -> packages/web/public/sounds/plm_floor_creak.mp3
reference/lib/sounds/plm_floor_creak2.mp3 -> packages/web/public/sounds/plm_floor_creak2.mp3
reference/lib/sounds/plm_glass_break.mp3 -> packages/web/public/sounds/plm_glass_break.mp3
reference/lib/sounds/plm_glass_breaking.mp3 -> packages/web/public/sounds/plm_glass_breaking.mp3
reference/lib/sounds/plm_glass_smashing.mp3 -> packages/web/public/sounds/plm_glass_smashing.mp3
reference/lib/sounds/plm_jar_ding.mp3 -> packages/web/public/sounds/plm_jar_ding.mp3
reference/lib/sounds/plm_levelup.mp3 -> packages/web/public/sounds/plm_levelup.mp3
reference/lib/sounds/plm_lock_case.mp3 -> packages/web/public/sounds/plm_lock_case.mp3
reference/lib/sounds/plm_lock_distant.mp3 -> packages/web/public/sounds/plm_lock_distant.mp3
reference/lib/sounds/plm_metal_clank.mp3 -> packages/web/public/sounds/plm_metal_clank.mp3
reference/lib/sounds/plm_metal_sharpen.mp3 -> packages/web/public/sounds/plm_metal_sharpen.mp3
reference/lib/sounds/plm_open_case.mp3 -> packages/web/public/sounds/plm_open_case.mp3
reference/lib/sounds/plm_spell1.mp3 -> packages/web/public/sounds/plm_spell1.mp3
reference/lib/sounds/plm_spell2.mp3 -> packages/web/public/sounds/plm_spell2.mp3
reference/lib/sounds/plm_spell3.mp3 -> packages/web/public/sounds/plm_spell3.mp3
reference/lib/sounds/plm_use_staff.mp3 -> packages/web/public/sounds/plm_use_staff.mp3
reference/lib/sounds/plm_wood_thud.mp3 -> packages/web/public/sounds/plm_wood_thud.mp3
reference/lib/sounds/plm_zap_rod.mp3 -> packages/web/public/sounds/plm_zap_rod.mp3
reference/lib/sounds/pls_bell_bowl.mp3 -> packages/web/public/sounds/pls_bell_bowl.mp3
reference/lib/sounds/pls_bell_chime_new.mp3 -> packages/web/public/sounds/pls_bell_chime_new.mp3
reference/lib/sounds/pls_bell_glass.mp3 -> packages/web/public/sounds/pls_bell_glass.mp3
reference/lib/sounds/pls_bell_hibell_soft.mp3 -> packages/web/public/sounds/pls_bell_hibell_soft.mp3
reference/lib/sounds/pls_bell_mute.mp3 -> packages/web/public/sounds/pls_bell_mute.mp3
reference/lib/sounds/pls_bell_sustain.mp3 -> packages/web/public/sounds/pls_bell_sustain.mp3
reference/lib/sounds/pls_breathe_in.mp3 -> packages/web/public/sounds/pls_breathe_in.mp3
reference/lib/sounds/pls_man_argoh.mp3 -> packages/web/public/sounds/pls_man_argoh.mp3
reference/lib/sounds/pls_man_gulp_new.mp3 -> packages/web/public/sounds/pls_man_gulp_new.mp3
reference/lib/sounds/pls_man_oooh.mp3 -> packages/web/public/sounds/pls_man_oooh.mp3
reference/lib/sounds/pls_man_scream2.mp3 -> packages/web/public/sounds/pls_man_scream2.mp3
reference/lib/sounds/pls_man_sigh.mp3 -> packages/web/public/sounds/pls_man_sigh.mp3
reference/lib/sounds/pls_man_sniff.mp3 -> packages/web/public/sounds/pls_man_sniff.mp3
reference/lib/sounds/pls_man_sob.mp3 -> packages/web/public/sounds/pls_man_sob.mp3
reference/lib/sounds/pls_man_spit.mp3 -> packages/web/public/sounds/pls_man_spit.mp3
reference/lib/sounds/pls_man_ugh.mp3 -> packages/web/public/sounds/pls_man_ugh.mp3
reference/lib/sounds/pls_man_yell.mp3 -> packages/web/public/sounds/pls_man_yell.mp3
reference/lib/sounds/pls_tone_blurk.mp3 -> packages/web/public/sounds/pls_tone_blurk.mp3
reference/lib/sounds/pls_tone_clave6.mp3 -> packages/web/public/sounds/pls_tone_clave6.mp3
reference/lib/sounds/pls_tone_clavelo8.mp3 -> packages/web/public/sounds/pls_tone_clavelo8.mp3
reference/lib/sounds/pls_tone_conk.mp3 -> packages/web/public/sounds/pls_tone_conk.mp3
reference/lib/sounds/pls_tone_elec.mp3 -> packages/web/public/sounds/pls_tone_elec.mp3
reference/lib/sounds/pls_tone_goblet.mp3 -> packages/web/public/sounds/pls_tone_goblet.mp3
reference/lib/sounds/pls_tone_guiro.mp3 -> packages/web/public/sounds/pls_tone_guiro.mp3
reference/lib/sounds/pls_tone_headstock.mp3 -> packages/web/public/sounds/pls_tone_headstock.mp3
reference/lib/sounds/pls_tone_scrape.mp3 -> packages/web/public/sounds/pls_tone_scrape.mp3
reference/lib/sounds/pls_tone_stick.mp3 -> packages/web/public/sounds/pls_tone_stick.mp3
reference/lib/sounds/sto_bell_desk.mp3 -> packages/web/public/sounds/sto_bell_desk.mp3
reference/lib/sounds/sto_bell_ding.mp3 -> packages/web/public/sounds/sto_bell_ding.mp3
reference/lib/sounds/sto_bell_dingaling.mp3 -> packages/web/public/sounds/sto_bell_dingaling.mp3
reference/lib/sounds/sto_bell_jingles.mp3 -> packages/web/public/sounds/sto_bell_jingles.mp3
reference/lib/sounds/sto_bell_register1.mp3 -> packages/web/public/sounds/sto_bell_register1.mp3
reference/lib/sounds/sto_bell_register2.mp3 -> packages/web/public/sounds/sto_bell_register2.mp3
reference/lib/sounds/sto_bell_ringing.mp3 -> packages/web/public/sounds/sto_bell_ringing.mp3
reference/lib/sounds/sto_bell_shop.mp3 -> packages/web/public/sounds/sto_bell_shop.mp3
reference/lib/sounds/sto_coins_countertop.mp3 -> packages/web/public/sounds/sto_coins_countertop.mp3
reference/lib/sounds/sto_man_haha.mp3 -> packages/web/public/sounds/sto_man_haha.mp3
reference/lib/sounds/sto_man_hey.mp3 -> packages/web/public/sounds/sto_man_hey.mp3
reference/lib/sounds/sto_man_whoohaha.mp3 -> packages/web/public/sounds/sto_man_whoohaha.mp3
reference/lib/sounds/sum_ainu_song.mp3 -> packages/web/public/sounds/sum_ainu_song.mp3
reference/lib/sounds/sum_bell_crystal.mp3 -> packages/web/public/sounds/sum_bell_crystal.mp3
reference/lib/sounds/sum_bell_hand.mp3 -> packages/web/public/sounds/sum_bell_hand.mp3
reference/lib/sounds/sum_bell_tone.mp3 -> packages/web/public/sounds/sum_bell_tone.mp3
reference/lib/sounds/sum_chime_jangle.mp3 -> packages/web/public/sounds/sum_chime_jangle.mp3
reference/lib/sounds/sum_ghost_moan.mp3 -> packages/web/public/sounds/sum_ghost_moan.mp3
reference/lib/sounds/sum_ghost_oooo.mp3 -> packages/web/public/sounds/sum_ghost_oooo.mp3
reference/lib/sounds/sum_ghost_wail.mp3 -> packages/web/public/sounds/sum_ghost_wail.mp3
reference/lib/sounds/sum_gong_temple.mp3 -> packages/web/public/sounds/sum_gong_temple.mp3
reference/lib/sounds/sum_laugh_evil2.mp3 -> packages/web/public/sounds/sum_laugh_evil2.mp3
reference/lib/sounds/sum_lion_growl.mp3 -> packages/web/public/sounds/sum_lion_growl.mp3
reference/lib/sounds/sum_piano_scrape.mp3 -> packages/web/public/sounds/sum_piano_scrape.mp3

# ===== L17_fonts_screens_help =====

### L17_fonts_screens_help-001  Missing 10x14x bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/10x14x.fon
port: NONE
expected: The 10x14x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-002  Missing 10x14xb bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/10x14xb.fon
port: NONE
expected: The 10x14xb Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The bold 10x14 font choice and exact glyph raster are unavailable.
confidence: high

### L17_fonts_screens_help-003  Missing 10x20x bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/10x20x.fon
port: NONE
expected: The 10x20x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-004  Missing 12x18x bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/12x18x.fon
port: NONE
expected: The 12x18x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-005  Missing 12x24x bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/12x24x.fon
port: NONE
expected: The 12x24x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-006  Missing 16x16x bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/16x16x.fon
port: NONE
expected: The 16x16x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-007  Missing 16x16xw bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/16x16xw.fon
port: NONE
expected: The 16x16xw Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-008  Missing 16x16xw web font
sev: P3
concession: n
ref: reference/lib/fonts/16x16xw.woff
port: NONE
expected: The 16x16xw webfont asset is available for the wide 16x16 font variant.
actual: No WOFF asset, CSS face, or font selection path exists.
why: The wide web font variant is unavailable.
confidence: high

### L17_fonts_screens_help-009  Missing 5x8 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/5x8x.fon
port: NONE
expected: The 5x8x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-010  Missing 6x10 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/6x10x.fon
port: NONE
expected: The 6x10x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-011  Missing 6x12 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/6x12x.fon
port: NONE
expected: The 6x12x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-012  Missing 6x13 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/6x13x.fon
port: NONE
expected: The 6x13x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-013  Missing 6x13xb bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/6x13xb.fon
port: NONE
expected: The 6x13xb Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The bold 6x13 font choice and exact glyph raster are unavailable.
confidence: high

### L17_fonts_screens_help-014  Missing 7x13 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/7x13x.fon
port: NONE
expected: The 7x13x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-015  Missing 7x13xb bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/7x13xb.fon
port: NONE
expected: The 7x13xb Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The bold 7x13 font choice and exact glyph raster are unavailable.
confidence: high

### L17_fonts_screens_help-016  Missing 8x12 default bitmap font
sev: P2
concession: n
ref: reference/lib/fonts/8x12x.fon
port: packages/web/src/term.ts:113
expected: main-win.c selects 8X12x.FON as DEFAULT_FONT and renders its 8x12 glyph cells.
actual: The reference asset has no port counterpart and GlyphTerm hardwires FONT_16X24.
why: The normal Windows default font size and glyph raster differ on the live path.
confidence: high

### L17_fonts_screens_help-017  Missing 8x12xb bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/8x12xb.fon
port: NONE
expected: The 8x12xb Windows FNT bitmap glyph asset is available as a selectable bold font.
actual: No port asset or loader counterpart exists.
why: The bold 8x12 font choice and exact glyph raster are unavailable.
confidence: high

### L17_fonts_screens_help-018  Missing 8x13 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/8x13x.fon
port: NONE
expected: The 8x13x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-019  Missing 8x16 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/8x16x.fon
port: NONE
expected: The 8x16x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-020  Missing 8x8 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/8x8x.fon
port: NONE
expected: The 8x8x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-021  Missing 8x8xb bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/8x8xb.fon
port: NONE
expected: The 8x8xb Windows FNT bitmap glyph asset is available as a selectable bold font.
actual: No port asset or loader counterpart exists.
why: The bold 8x8 font choice and exact glyph raster are unavailable.
confidence: high

### L17_fonts_screens_help-022  Missing 9x15 bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/9x15x.fon
port: NONE
expected: The 9x15x Windows FNT bitmap glyph asset is available as a selectable Angband font.
actual: No port asset or loader counterpart exists.
why: The port cannot select or render this reference font.
confidence: high

### L17_fonts_screens_help-023  Missing 9x15xb bitmap font
sev: P3
concession: n
ref: reference/lib/fonts/9x15xb.fon
port: NONE
expected: The 9x15xb Windows FNT bitmap glyph asset is available as a selectable bold font.
actual: No port asset or loader counterpart exists.
why: The bold 9x15 font choice and exact glyph raster are unavailable.
confidence: high

### L17_fonts_screens_help-024  Missing font packaging manifest
sev: P3
concession: n
ref: reference/lib/fonts/Makefile
port: NONE
expected: The font package DATA list includes every reference font and the package build installs them.
actual: No port-side font package manifest or equivalent build asset list exists.
why: The missing font set has no reproducible packaging or selection inventory.
confidence: high

### L17_fonts_screens_help-025  News version marker is not padded
sev: P2
concession: n
ref: reference/src/ui-display.c:2463
port: packages/web/src/news.ts:94
expected: The C replaces $VERSION with a left-justified 8-character field using %-8s.
actual: The port replaces $VERSION with the bare string 4.2.6 and emits no padding.
why: The splash line is not byte-for-byte equivalent to the C output.
confidence: high

### L17_fonts_screens_help-026  News screen adds a non-C wait prompt
sev: P2
concession: ?
ref: reference/src/ui-display.c:2425
port: packages/web/src/news.ts:103
expected: show_splashscreen draws news.txt and returns to the normal event-driven UI without adding a prompt line.
actual: The port adds [ Press any key to begin ] and blocks boot until a key or pointer event.
why: Splash control flow and visible text differ from the upstream screen.
confidence: high

### L17_fonts_screens_help-027  Retirement uses the death tombstone art
sev: P2
concession: n
ref: reference/src/ui-death.c:75
port: packages/web/src/screens.ts:1401
expected: display_exit_screen loads retire.txt when died_from is Retiring and dead.txt otherwise.
actual: tombstoneLines always starts from DEAD_TOMB_ART; retired only changes the epitaph text.
why: Retiring a character shows the wrong full-screen background.
confidence: high

### L17_fonts_screens_help-028  Commands help is curated and has wrong live labels
sev: P2
concession: n
ref: reference/lib/help/commands.txt
port: packages/web/src/help.ts:65
expected: The commands page reproduces the full original keyset table, including the C meanings for S as See abilities and V as Display version info.
actual: The port omits many table entries and labels S as Save the game and V as Display the hall of fame.
why: In-game help gives incomplete and incorrect command guidance.
confidence: high

### L17_fonts_screens_help-029  Help index is not the reference index
sev: P2
concession: n
ref: reference/lib/help/index.txt
port: packages/web/src/help.ts:298
expected: The index shows the reference introduction, browser commands, and exactly the commands and symbols menu entries.
actual: The port uses a generated menu, omits the index text and browser controls, and adds a Playing guide entry.
why: The live help index has different content and navigation choices.
confidence: high

### L17_fonts_screens_help-030  Roguelike command help is not selected
sev: P2
concession: n
ref: reference/lib/help/r_comm.txt
port: packages/web/src/help.ts:298
expected: With rogue_like_commands enabled, do_cmd_help opens the roguelike command summary from r_index.txt.
actual: runHelp always offers the same Original keyset curated page and never selects r_comm.txt.
why: Roguelike players receive the wrong key bindings in help.
confidence: high

### L17_fonts_screens_help-031  Roguelike help index is not implemented
sev: P2
concession: n
ref: reference/lib/help/r_index.txt
port: packages/web/src/help.ts:298
expected: The roguelike help index links to r_comm.txt and symbols.txt.
actual: No roguelike index or mode-dependent menu exists.
why: The reference roguelike help entry point is unreachable.
confidence: high

### L17_fonts_screens_help-032  Symbols help is paraphrased and reordered
sev: P2
concession: n
ref: reference/lib/help/symbols.txt
port: packages/web/src/help.ts:244
expected: The symbols page preserves the reference introduction, table order, slash-identification note, and user-pref-file note.
actual: The port paraphrases the introduction, reorders feature rows, and omits the slash and user-pref notes.
why: The symbols reference is visibly and behaviorally different in the live help browser.
confidence: high

### L17_fonts_screens_help-033  Font preference dispatcher is missing
sev: P2
concession: n
ref: reference/lib/customize/font.prf
port: NONE
expected: reset_visuals loads font.prf and conditionally includes the system-specific font remapping file.
actual: No pref-file dispatcher or conditional $SYS include path exists in the web port.
why: Reference font-dependent terrain attr/char remappings cannot be applied.
confidence: high

### L17_fonts_screens_help-034  GCU font remapping is missing
sev: P3
concession: n
ref: reference/lib/customize/font-gcu.prf
port: NONE
expected: GCU text mode remaps open floor to attr 0x01 and char 0xb7.
actual: No GCU pref counterpart or equivalent remapping exists.
why: The GCU reference display mapping is unavailable.
confidence: high

### L17_fonts_screens_help-035  IBM font remapping is missing
sev: P3
concession: n
ref: reference/lib/customize/font-ibm.prf
port: NONE
expected: IBM mode applies the listed pseudo-graphic attr/char mappings for floors, walls, veins, rubble, and lava.
actual: No IBM pref counterpart or equivalent remapping exists.
why: The IBM reference terrain glyph mapping is unavailable.
confidence: high

### L17_fonts_screens_help-036  SDL font remapping is missing
sev: P3
concession: n
ref: reference/lib/customize/font-sdl.prf
port: NONE
expected: SDL mode provides the reference centered-dot floor remapping options for the bundled FNT or Unicode font.
actual: No SDL pref counterpart or equivalent remapping exists.
why: The SDL reference floor glyph choices are unavailable.
confidence: high

### L17_fonts_screens_help-037  SDL2 font remapping is missing
sev: P3
concession: n
ref: reference/lib/customize/font-sdl2.prf
port: NONE
expected: SDL2 mode remaps the open floor to attr 1 and char 7 for the bundled font.
actual: No SDL2 pref counterpart or equivalent remapping exists.
why: The SDL2 reference floor glyph mapping is unavailable.
confidence: high

### L17_fonts_screens_help-038  Windows font remapping is missing
sev: P2
concession: n
ref: reference/lib/customize/font-win.prf
port: packages/web/src/main.ts:4452
expected: Windows text mode remaps the open floor to attr 1 and char 8 after font.prf is loaded.
actual: terrainGlyph uses the feature dAttr and dChar directly and has no font-win remap.
why: The normal Windows text-mode terrain glyph output differs.
confidence: high

### L17_fonts_screens_help-039  X11 font remapping is missing
sev: P3
concession: n
ref: reference/lib/customize/font-x11.prf
port: NONE
expected: X11 mode applies the open-floor and treasure-vein attr/char remappings.
actual: No X11 pref counterpart or equivalent remapping exists.
why: The X11 reference terrain glyph mapping is unavailable.
confidence: high

### L17_fonts_screens_help-040  Message preference colors are not loaded
sev: P2
concession: n
ref: reference/lib/customize/message.prf
port: packages/web/src/main.ts:908
expected: The message pref parser defines each MSG type color, including orange BELL and HITPOINT_WARN and white defaults.
actual: state.msg records every message as type 0 and the web log renders without loading message.prf type colors.
why: Typed message color behavior from the reference is lost on the live message path.
confidence: high

### L17_fonts_screens_help-041  Default pref grammar is not implemented
sev: P2
concession: n
ref: reference/lib/customize/pref.prf
port: packages/web/src/main.ts:4338
expected: The default pref file loads movement, running, tunneling, stay-still, swap-equipment, message, sound, and system-specific mappings through the C parser.
actual: The port hardcodes selected command branches and reports every entered pref line as not recognized; it does not parse or load the file.
why: Pref-file behavior and user customizations cannot reproduce the reference path.
confidence: high

### L17_fonts_screens_help-042  Sound selection is off the game RNG stream
sev: P2
concession: n
ref: reference/lib/customize/sound.prf
port: packages/web/src/main.ts:5828
expected: SoundEngine play_sound calls the game's randint0 for each mapped sound choice, as sound-core.c:320 does.
actual: installWebSound omits randint0, so SoundEngine uses its Math.random default.
why: Sound choice order is not reproducible and does not consume the same RNG stream as C.
confidence: high

### L17_fonts_screens_help-043  Web sound loading does not try the next format
sev: P2
concession: n
ref: reference/lib/customize/sound.prf
port: packages/web/src/sound.ts:74
expected: C checks each supported extension in order and only stops after a load hook succeeds.
actual: The web hook marks the first candidate LOADED optimistically and an error marks the sample failed without trying the next format.
why: A pack with only the second supported format does not play its mapped sounds.
confidence: high

### L17_fonts_screens_help-044  User pref include dispatcher is missing
sev: P3
concession: n
ref: reference/lib/customize/user.prf
port: NONE
expected: The user pref loader conditionally includes race and class files, including the Half-Troll and short Necro/BG fallbacks.
actual: No user pref-file loader or conditional include implementation exists.
why: User race/class preference overrides cannot be applied.
confidence: high

## MAP L17_fonts_screens_help
reference/lib/fonts/10x14x.fon -> NONE
reference/lib/fonts/10x14xb.fon -> NONE
reference/lib/fonts/10x20x.fon -> NONE
reference/lib/fonts/12x18x.fon -> NONE
reference/lib/fonts/12x24x.fon -> NONE
reference/lib/fonts/16x16x.fon -> NONE
reference/lib/fonts/16x16xw.fon -> NONE
reference/lib/fonts/16x16xw.woff -> NONE
reference/lib/fonts/16x24x.fon -> packages/web/src/font-16x24.ts, packages/web/src/term.ts
reference/lib/fonts/5x8x.fon -> NONE
reference/lib/fonts/6x10x.fon -> NONE
reference/lib/fonts/6x12x.fon -> NONE
reference/lib/fonts/6x13x.fon -> NONE
reference/lib/fonts/6x13xb.fon -> NONE
reference/lib/fonts/7x13x.fon -> NONE
reference/lib/fonts/7x13xb.fon -> NONE
reference/lib/fonts/8x12x.fon -> NONE
reference/lib/fonts/8x12xb.fon -> NONE
reference/lib/fonts/8x13x.fon -> NONE
reference/lib/fonts/8x16x.fon -> NONE
reference/lib/fonts/8x8x.fon -> NONE
reference/lib/fonts/8x8xb.fon -> NONE
reference/lib/fonts/9x15x.fon -> NONE
reference/lib/fonts/9x15xb.fon -> NONE
reference/lib/fonts/Makefile -> NONE
reference/lib/screens/crown.txt -> packages/web/src/screens.ts
reference/lib/screens/dead.txt -> packages/web/src/screens.ts
reference/lib/screens/news.txt -> packages/web/src/news.ts
reference/lib/screens/retire.txt -> packages/web/src/screens.ts
reference/lib/help/commands.txt -> packages/web/src/help.ts
reference/lib/help/index.txt -> packages/web/src/help.ts
reference/lib/help/r_comm.txt -> packages/web/src/help.ts
reference/lib/help/r_index.txt -> packages/web/src/help.ts
reference/lib/help/symbols.txt -> packages/web/src/help.ts
reference/lib/customize/font.prf -> NONE
reference/lib/customize/font-gcu.prf -> NONE
reference/lib/customize/font-ibm.prf -> NONE
reference/lib/customize/font-sdl.prf -> NONE
reference/lib/customize/font-sdl2.prf -> NONE
reference/lib/customize/font-win.prf -> NONE
reference/lib/customize/font-x11.prf -> NONE
reference/lib/customize/message.prf -> packages/web/src/main.ts, packages/core/src/msg.ts
reference/lib/customize/pref.prf -> packages/web/src/main.ts, packages/web/src/keymap.ts, packages/web/src/keymap-store.ts
reference/lib/customize/sound.prf -> packages/core/src/sound/sound-prefs-data.ts, packages/core/src/sound/engine.ts, packages/web/src/sound.ts
reference/lib/customize/user.prf -> NONE
