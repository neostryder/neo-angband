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
