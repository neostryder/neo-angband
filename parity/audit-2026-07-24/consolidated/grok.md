# Neo Angband Parity Findings - Grok

Independent audit vs `reference/` (C oracle). Format per `parity/audit-2026-07-24/REVIEW_BRIEF.md`.
Findings are appended per lane below.

## L1_rng_util

### L1_rng_util-001  color_char_to_attr: space/empty/unknown defaults wrong
sev: P1
concession: n
ref: reference/src/z-color.c:174-184
port: packages/core/src/color.ts:139-146
expected: color_char_to_attr('\0' or ' ') returns COLOUR_DARK (0); unknown char returns COLOUR_WHITE (1)
actual: colorCharToAttr(' ') returns COLOUR_SHADE (28) because Shade row invents char " "; empty/unknown return -1
why: Pref/glyph paths and any code relying on C defaults get shade or invalid attrs instead of dark/white
confidence: high

### L1_rng_util-002  color_text_to_attr: unknown name returns -1 not white
sev: P1
concession: n
ref: reference/src/z-color.c:191-201
port: packages/core/src/color.ts:148-156
expected: unknown colour name returns COLOUR_WHITE (1)
actual: colorTextToAttr returns -1; mon/bind.ts throws on dAttr < 0 instead of accepting white
why: Invalid or partial colour names fail hard (or paint as -1) instead of C's silent white fallback
confidence: high

### L1_rng_util-003  MAX_COLORS constant is 29; C is 32
sev: P3
concession: n
ref: reference/src/z-color.h:77-78
port: packages/core/src/color.ts:40
expected: MAX_COLORS 32, BASIC_COLORS 29 (arrays sized 32 with trailing slots)
actual: MAX_COLORS exported as 29; VISUALS_MAX_COLORS=32 lives only in visuals/engine.ts
why: Constant rename/size mismatch can desync anything sized to C MAX_COLORS (flicker tables are separate)
confidence: high

### L1_rng_util-004  attr_to_text not in core color module
sev: P3
concession: n
ref: reference/src/z-color.c:208-214
port: packages/cli/src/spoilers.ts:453-457 (local only); packages/core/src/color.ts:NONE
expected: attr_to_text(a) returns color_table[a].name for a < BASIC_COLORS else "Icky"
actual: Core exports no attrToText; only CLI spoilers reimplement locally
why: Spoiler/UI paths outside CLI lack the C helper; easy for other call sites to invent strings
confidence: high

### L1_rng_util-005  build_gamma_table / gamma_table absent
sev: P3
concession: ?
ref: reference/src/z-color.c:283-320
port: NONE
expected: build_gamma_table(gamma) fills gamma_table[256] for phosphor correction
actual: No gamma table; web uses angband_color_table RGB bytes directly
why: Native front ends that apply gamma look different if user gamma != identity; browser may not need it
confidence: med

### L1_rng_util-006  MULT_BG / BG_* background attr encoding missing
sev: P3
concession: ?
ref: reference/src/z-color.h:87-90
port: NONE (web term uses separate bg CSS, not MULT_BG packing)
expected: glyph attrs encode background via a + MULT_BG * BG_{BLACK,SAME,DARK}
actual: No MULT_BG constants or packing; map cells use optional separate bg field
why: Same-as-fg / dark-bg glyph modes used by some main-* front ends are not the same encoding
confidence: med

### L1_rng_util-007  flag_next sentinel is -1 not FLAG_END (0)
sev: P3
concession: n
ref: reference/src/z-bitflag.c:70-82
port: packages/core/src/bitflag.ts:10-15,100-106
expected: flag_next returns FLAG_END (0) when exhausted
actual: flagNext returns NO_FLAG (-1); callers must use NO_FLAG
why: Intentional API change; wrong comparison to 0 would mis-iterate flags
confidence: high

### L1_rng_util-008  flag_comp_* helpers invented without C symbols
sev: P3
concession: n
ref: reference/src/z-bitflag.h (no flag_comp_* declarations)
port: packages/core/src/bitflag.ts:267-321
expected: No flag_comp_union/inter/diff in 4.2.6 z-bitflag
actual: Port defines flagCompUnion/Inter/Diff as complement ops
why: Extra API with no upstream basis; risk of use where C has no equivalent
confidence: high

### L1_rng_util-009  buildid/score what stamps port version not Angband buildid
sev: P2
concession: n
ref: reference/src/buildid.c:37-38; reference/src/score.c (build_score uses buildid)
port: packages/core/src/score/score.ts:26,79; packages/core/src/index.ts:28
expected: buildid = "Angband 4.2.6"; score what[] keeps first 7 chars ("Angband")
actual: DEFAULT_BUILDID / ENGINE_VERSION = "0.1.0" stamped into score what
why: Hall of Fame / dump build markers do not match upstream buildid string
confidence: high

### L1_rng_util-010  do_cmd_version omits buildver header and copyright block
sev: P2
concession: n
ref: reference/src/ui-command.c:143-157; reference/src/buildid.c:37-55
port: packages/web/src/main.ts:4349-4360
expected: Header "You are playing 4.2.6. Type '?' for more info." plus full copyright textblock
actual: Modal shows "Neo Angband 0.1.0", port credit lines; no copyright string from buildid.c
why: Version screen text and legal notice diverge from C UI
confidence: high

### L1_rng_util-011  z-quark not ported; notes are plain strings
sev: P3
concession: n
ref: reference/src/z-quark.c:31-54
port: NONE (obj.note / AutoinscriptionRegistry use string | null)
expected: quark_add/quark_str intern inscriptions as size_t indices
actual: Inscriptions stored and saved as full strings
why: Observably equivalent text, but no shared quark table; save format and memory model differ
confidence: high

### L1_rng_util-012  z-queue module absent; gen uses unbounded IntQueue
sev: P3
concession: n
ref: reference/src/z-queue.c:32-97
port: packages/core/src/gen/cave.ts:689-701
expected: Fixed-capacity circular queue; q_push aborts if full
actual: Private growing array IntQueue for flood-fill only; no shared q_*/qp_* API
why: BFS capacity failure modes differ; no priority_queue port for other C call sites
confidence: high

### L1_rng_util-013  z-type point_set API not ported as shared type
sev: P3
concession: n
ref: reference/src/z-type.c:78-119
port: packages/core/src/loc.ts (loc helpers only); packages/core/src/game/target.ts:362-378 (Loc[])
expected: point_set_new/add/contains/size/dispose
actual: Targeting builds Loc[] inline; room light etc. reimplemented without point_set
why: Structural omission of the shared set type (logic re-derived per call site)
confidence: high

### L1_rng_util-014  Rand_simple not ported
sev: P3
concession: y
ref: reference/src/z-rand.c:579-592
port: packages/core/src/rng.ts:NONE
expected: Separate LCRNG for non-gameplay (temp filenames in z-file.c)
actual: No Rand_simple; browser uses other entropy for temps/storage keys
why: Only used for OS temp names; no gameplay stream impact in browser
confidence: high

### L1_rng_util-015  z-file filesystem layer not ported (browser store seam)
sev: P2
concession: y
ref: reference/src/z-file.h / z-file.c (path_build, ang_file, setuid, dirs)
port: packages/web/src/roster.ts; packages/web/src/score.ts; packages/core/src/session/save.ts (buffer + inject)
expected: Native paths, ang_file I/O, scores/saves under lib/user paths
actual: localStorage / injected ScoreStore / save buffers; no path_build/file_open
why: Unavoidable in browser; persistence model differs from C files
confidence: high

### L1_rng_util-016  z-form / z-virt not ported as modules
sev: P3
concession: y
ref: reference/src/z-form.c (vstrnfmt/strnfmt); reference/src/z-virt.c (mem_*/string_*)
port: NONE (JS strings + GC + template literals at call sites)
expected: Bounded format buffers and die-on-OOM allocators
actual: Language-native strings/arrays; format parity depends on each call site
why: Language runtime concession; call-site string drift must be audited elsewhere
confidence: high

### L1_rng_util-017  z-textblock incomplete (no shared wrap/to_file/text_out)
sev: P2
concession: n
ref: reference/src/z-textblock.h:38-72
port: packages/core/src/obj/object-info.ts:110-144; mon/lore-describe.ts; packages/web/src/charsheet.ts:294+
expected: textblock_append(_c), calculate_lines, to_file, text_out_* hooks
actual: Ad-hoc Textblock/LoreTextBuilder run lists; wrapping only in some UI; no text_out_e
why: Object/monster/shape recall presentation can drift on wrap, attrs, and dump output
confidence: high

### L1_rng_util-018  z-util largely partial (only guards + local helpers)
sev: P2
concession: n
ref: reference/src/z-util.c / z-util.h (utf8_*, my_str*, streq, strunescape, plog/quit, ...)
port: packages/core/src/guard.ts; scattered isAVowel/myStrcap/containsOnlySpaces
expected: Shared string/util API used game-wide
actual: Overflow guards only as module; string ops reimplemented locally and inconsistently
why: Risk of subtle string/case/UTF-8 mismatches vs single C implementation
confidence: med

### L1_rng_util-019  z-debug.h not mapped
sev: P3
concession: n
ref: reference/src/z-debug.h:22-23
port: NONE
expected: notreached assert(0); testonly annotation
actual: No equivalent macros; TS throws/asserts ad hoc
why: Debug-only; no normal-play impact
confidence: high

### L1_rng_util-020  guid module not mapped (only trivial eq)
sev: P3
concession: n
ref: reference/src/guid.c:22-25; guid.h:22-24
port: NONE
expected: guid type + guid_eq
actual: No guid type; equality is plain === where IDs exist
why: Trivial in C; omission is fine if no guid-typed save fields remain
confidence: high

### L1_rng_util-021  Shade color_table row invents index_char and name
sev: P2
concession: n
ref: reference/src/z-color.c:154-155 (color_table rest zero-init); L61 angband_color_table shade RGB
port: packages/core/src/color.ts:135-136
expected: color_table[28] zero-filled (no index_char/name); RGB only in angband_color_table
actual: COLOR_TABLE[28] = char " ", name "Shade", rgb 0x28...
why: Makes colorCharToAttr(' ') hit shade (finding 001); invents name lookup for "Shade"
confidence: high

### L1_rng_util-022  alloc_entry type not centralized from alloc.h
sev: P3
concession: n
ref: reference/src/alloc.h:29-37
port: packages/core/src/mon/make.ts:41-50; packages/core/src/obj/make.ts:192-198
expected: Shared alloc_entry {index,level,prob1,prob2,prob3}
actual: Separate MonAllocEntry / EgoAllocEntry interfaces (fields present, no single type)
why: Structural only if field semantics stay aligned
confidence: high

## MAP L1_rng_util
reference/src/alloc.h -> packages/core/src/mon/make.ts, packages/core/src/obj/make.ts (struct fields only)
reference/src/angband.h -> NONE (include umbrella; packages/core/src/index.ts is port barrel)
reference/src/buildid.c -> packages/core/src/index.ts (PARITY_BASELINE/ENGINE_VERSION), packages/core/src/score/score.ts (DEFAULT_BUILDID), packages/web/src/main.ts (versionCmd), packages/web/src/news.ts (BASELINE_VERSION)
reference/src/buildid.h -> packages/core/src/index.ts
reference/src/config.h -> NONE (path defaults; browser has no DEFAULT_*_PATH)
reference/src/guid.c -> NONE
reference/src/guid.h -> NONE
reference/src/h-basic.h -> NONE (platform types/PATH_SEP; JS runtime)
reference/src/randname.c -> packages/core/src/obj/randname.ts (also used by obj/flavor.ts, obj/randart.ts)
reference/src/randname.h -> packages/core/src/obj/randname.ts, packages/core/src/obj/randart.ts (RANDNAME_TOLKIEN)
reference/src/z-bitflag.c -> packages/core/src/bitflag.ts
reference/src/z-bitflag.h -> packages/core/src/bitflag.ts
reference/src/z-color.c -> packages/core/src/color.ts
reference/src/z-color.h -> packages/core/src/color.ts, packages/core/src/visuals/engine.ts (BASIC_COLORS/VISUALS_MAX_COLORS)
reference/src/z-debug.h -> NONE
reference/src/z-dice.c -> packages/core/src/dice.ts
reference/src/z-dice.h -> packages/core/src/dice.ts
reference/src/z-expression.c -> packages/core/src/expression.ts
reference/src/z-expression.h -> packages/core/src/expression.ts
reference/src/z-file.c -> packages/web/src/roster.ts, packages/web/src/score.ts, packages/core/src/session/save.ts (browser persistence seams; not a file API port)
reference/src/z-file.h -> same as z-file.c
reference/src/z-form.c -> NONE (call-site template strings)
reference/src/z-form.h -> NONE
reference/src/z-quark.c -> NONE (plain string notes)
reference/src/z-quark.h -> NONE
reference/src/z-queue.c -> packages/core/src/gen/cave.ts (private IntQueue only)
reference/src/z-queue.h -> packages/core/src/gen/cave.ts
reference/src/z-rand.c -> packages/core/src/rng.ts
reference/src/z-rand.h -> packages/core/src/rng.ts
reference/src/z-textblock.c -> packages/core/src/obj/object-info.ts, packages/core/src/mon/lore-describe.ts, packages/core/src/player/shape-lore.ts, packages/web/src/charsheet.ts (partial analogues)
reference/src/z-textblock.h -> same as z-textblock.c
reference/src/z-type.c -> packages/core/src/loc.ts (loc_*); point_set -> packages/core/src/game/target.ts (Loc[] reimpl)
reference/src/z-type.h -> packages/core/src/loc.ts
reference/src/z-util.c -> packages/core/src/guard.ts (add/sub_guardi*); scattered isAVowel/myStrcap/containsOnlySpaces in desc/effect modules
reference/src/z-util.h -> same as z-util.c
reference/src/z-virt.c -> NONE (GC / language alloc)
reference/src/z-virt.h -> NONE

## L2_init_parse

### L2_init_parse-001  flavor list walk order is file order; C is reverse (prepend)
sev: P1
concession: n
ref: reference/src/init.c:4239-4270 (parse_flavor_flavor prepends f->next = h); reference/src/obj-util.c:76-112 (flavor_assign_random walks flavors head-first)
port: packages/core/src/obj/bind.ts:1143-1168 (bindFlavors pushes file order); packages/core/src/obj/flavor.ts:160-189 (assignRandom walks work[] file order; comment claims this matches upstream)
expected: flavors linked list head is last-parsed flavor; flavor_assign_random choice=0 selects the last remaining random flavor of that tval in file order (reverse walk)
actual: reg.flavors and work[] are forward file order; choice=0 selects the first remaining random flavor of that tval
why: Same seed_flavor produces different ring/amulet/potion/etc colours and different scroll flavor pairing than C; visible every new character
confidence: high

### L2_init_parse-002  combat critical tables hard-coded; not live z_info from constants
sev: P2
concession: n
ref: reference/src/init.c:702-761,1006-1025 (parse/finish constants into z_info->*_crit_*); reference/src/player-attack.c:399-418 (critical_melee reads z_info)
port: packages/core/src/constants.ts:296-323 (bindConstants builds meleeCritical etc); packages/core/src/combat/hit.ts:138-178,239-254 (MELEE_CRIT / MELEE_CRIT_LEVELS literals; criticalMelee ignores Constants)
expected: critical_melee/shot and O-crit paths scale from z_info filled by constants.txt
actual: hit.ts embeds stock constants.txt numbers; bound Constants.meleeCritical is unused by combat
why: Stock pack matches today, but any constants.txt / pack edit to crit tables is ignored by live combat
confidence: high

### L2_init_parse-003  hints.txt compiled but not bound or used at runtime
sev: P2
concession: n
ref: reference/src/init.c:4336-4381 (hints_parser); reference/src/ui-store.c:120-158 (random_hint / prt_welcome one_in_(3) hint branch)
port: packages/content/src/specs/init.ts:261-266 (hintsSpec); packages/content/pack/hints.json exists; packages/core/src has no hints registry; packages/web/src/shop.ts:197-198 documents skipped hint branch
expected: global hints list from hints.txt; shop welcome may print comment_hint + random_hint()
actual: pack has hints.json but core/web never load it; shop always skips the hint path
why: Store greeter never gives datafile hints; missing init_arrays consumer for hints
confidence: high

### L2_init_parse-004  world.txt compiled but not bound; depth substitutes for level names
sev: P2
concession: n
ref: reference/src/init.c:1089-1197 (world_parser); reference/src/game-world.c:95-112 (level_by_name/depth); reference/src/generate.c:893-1028 (get_join_info / stored names use level_by_depth()->name)
port: packages/content/src/specs/init.ts:39-43 (worldSpec); packages/content/pack/world.json exists; packages/core/src/session/boot.ts CorePack/bindCore omit world; packages/core/src/game/context.ts:642-646 (levelCache keyed by depth number)
expected: world linked list of named levels; join/persist look up by level name from depth
actual: world.json never bound; persist/join identity is numeric depth only
why: Stock linear world is observationally similar; non-linear or multi-named worlds and C level-name keys diverge
confidence: high

### L2_init_parse-005  parse_file user-dir override of gamedata not present
sev: P3
concession: y
ref: reference/src/datafile.c:87-110 (ANGBAND_DIR_USER filename.txt then ANGBAND_DIR_GAMEDATA)
port: packages/content/src/compile.ts:29-37 (reads only reference/lib/gamedata/*.txt)
expected: optional per-user <name>.txt in user dir overrides stock gamedata at parse time
actual: offline compile always uses reference/lib/gamedata only; no runtime user txt overlay
why: Browser has no ANGBAND_DIR_USER text tree; customization is pack/mod based instead
confidence: high

### L2_init_parse-006  datafile write/archive and randart file activate/deactivate unported
sev: P3
concession: y
ref: reference/src/datafile.c:482-697 (write_flags/mods/elements, file_archive, randart_file_exists, activate/deactivate_randart_file)
port: NONE as filesystem APIs; packages/core/src/obj/randart.ts regenerates in memory from seed
expected: user/archive dir file moves for randart.txt and flag dump writers
actual: no archive_user_pfx / file_move path; randarts are seed-derived in memory
why: Unavoidable without a real user filesystem; seed-faithful regen is the in-browser equivalent if do_randart matches
confidence: high

### L2_init_parse-007  get_parser_error_limit / multi-error parse_file reporting absent
sev: P3
concession: n
ref: reference/src/parser.c:637-658; reference/src/datafile.c:87-141 (collect first error, log up to PARSE_ERROR_LIMIT=20)
port: packages/content/src/records.ts:180-186 (compileGamedata throws on first ParseError)
expected: parse continues after errors up to limit; first error state restored for return
actual: first bad line aborts the compile with a thrown Error
why: Dev/mod compile UX only; does not change successful stock pack load
confidence: high

### L2_init_parse-008  bindConstants skips check_critical_levels strictly-increasing validation
sev: P3
concession: n
ref: reference/src/init.c:987-1025 (finish_parse_constants check_critical_levels)
port: packages/core/src/constants.ts:296-323 (bindConstants assigns levels with no cutoff ordering check)
expected: non-strictly-increasing melee/ranged crit cutoffs -> PARSE_ERROR_NON_SEQUENTIAL_RECORDS
actual: bad cutoffs bind silently; combat would walk a wrong ladder
why: Stock constants.txt is ordered; only matters for bad/modded data
confidence: high

### L2_init_parse-009  critical-level msg strings not resolved via message_lookup_by_name
sev: P3
concession: n
ref: reference/src/init.c:733-748 (message_lookup_by_name; invalid -> PARSE_ERROR_INVALID_MESSAGE; stores msgt int)
port: packages/content pack stores raw "HIT_GOOD" etc; packages/core/src/constants.ts:314 keeps string msg; packages/core/src/combat/hit.ts uses string HitType
expected: parse-time name->MSG_* index; unknown message name fails parse
actual: raw strings kept; invalid msg names not rejected at bind
why: Stock names match HitType; bad data fails later or silently mislabels
confidence: high

### L2_init_parse-010  PlayerProperty.bindui typed/stored incorrectly vs finish_parse_player_prop
sev: P3
concession: n
ref: reference/src/init.c:1292-1332,1351-1414 (bindui linked list; finish expands element templates and bind_player_ability_to_ui_entry_by_name)
port: packages/core/src/player/bind.ts:193-199,622-630 (bindui?: boolean; bindui: rec.bindui ?? false); packages/core/src/game/ui-entry.ts:1013-1034 (reads pack JSON object correctly)
expected: structured bindui retained through finish; element rows expanded into player_abilities with per-element UI names
actual: PlayerProperty.bindui is a boolean type but receives object or false; expansion for UI is only in ui-entry from raw pack; abilities.ts expands for display only
why: Dual paths mostly work for stock UI; PlayerProperty.bindui is not a faithful struct field
confidence: med

## MAP L2_init_parse
reference/src/datafile.c -> packages/content/src/records.ts (compile/run_parser analogue), packages/core/src/obj/bind.ts (grab_flag/rand/int/range/index), packages/core/src/player/bind.ts + packages/core/src/mon/bind.ts (grab_flag consumers); write_*/file_archive/activate_randart_file -> NONE (browser)
reference/src/datafile.h -> same as datafile.c; packages/core/src/generated/parser-errors.ts (parser_error_str via list)
reference/src/init.c -> packages/content/src/specs/init.ts (parser_reg fmt mirror), packages/content/src/compile.ts + packages/content/src/records.ts (init_arrays parse), packages/core/src/constants.ts (z_info scalars/crits), packages/core/src/player/bind.ts (p_race/class/history/body/realm/shape/property), packages/core/src/player/spell.ts (write_book_kind), packages/core/src/player/abilities.ts (element property expand), packages/core/src/obj/bind.ts (flavors + object domain finish), packages/core/src/world/trap.ts + packages/core/src/world/feature.ts (trap/feat bind), packages/core/src/effects/effect.ts (grab_effect_data / EffectBuilder), packages/core/src/session/boot.ts + packages/core/src/session/game.ts (init_angband/startGame), packages/core/src/game/ui-entry.ts (player_property bindui finish)
reference/src/init.h -> packages/core/src/constants.ts (angband_constants), packages/core/src/session/game.ts + boot.ts (init lifecycle); ANGBAND_DIR_* / play_again -> NONE or host-specific
reference/src/parser.c -> packages/content/src/parser.ts
reference/src/parser.h -> packages/content/src/parser.ts, packages/core/src/generated/parser-errors.ts

# ===== L3_data (programmatic diff) =====
See raw/l3_field_report.txt: missing=0 parseFail=0 across ALL gamedata files (field-faithful). 4 format nits in raw/l3_audit_report.txt.

# ===== L4_objects =====

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

# ===== L5_monsters =====

# L5_monsters audit (monsters / mon-*)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: list-mon-* headers + mon-*.c/h + monster.h. Searched packages/ (excl. node_modules, dist, borg).

### L5_monsters-001  Melee timed statuses ignore Free Action / Prot Blind/Conf/Fear / poison resist
sev: P0
concession: n
ref: reference/src/mon-blows.c:502-556 (melee_effect_timed calls player_inc_timed with check=true); reference/src/mon-blows.c:674-689 (POISON then player_inc_timed TMD_POISONED); reference/src/mon-blows.c:990-1025 (BLIND/CONFUSE/TERRIFY/PARALYZE); reference/src/player-timed.c:923-956 (player_inc_check fail table: OF_FREE_ACT / OF_PROT_BLIND / OF_PROT_CONF / OF_PROT_FEAR / ELEM_POIS)
port: packages/core/src/game/mon-side.ts:204-210 (incTimed); packages/core/src/player/timed.ts:379-402 (playerIncTimed: when check true and hooks.incCheck absent, always allows)
expected: Monster melee status application runs player_inc_timed(..., check=true) so Free Action blocks paralysis, Prot Blind/Conf/Fear block those, poison resist / OPP_POIS block poison, with equip_learn / update_smart_learn side effects from player_inc_check.
actual: makeMonBlowEnv.incTimed calls playerIncTimed with check=true but never supplies hooks.incCheck (or equip_learn / smart-learn hooks). playerIncTimed then treats missing incCheck as always-true. Free Action, Prot Blind/Conf/Fear, and poison resist never stop melee statuses. Hallucination chaos resist likewise skipped for HALLU.
why: Core defensive flags are useless against monster melee; Free Action no longer prevents melee paralysis (game-breaking).
confidence: high

### L5_monsters-002  Melee never calls update_smart_learn (player rune learn + birth_ai_learn)
sev: P1
concession: n
ref: reference/src/mon-blows.c:486 (elemental pure update_smart_learn type); L554 (timed of_flag); L605 (OF_HOLD_LIFE); L689 (ELEM_POIS); L705 (ELEM_DISEN); L1167 (ELEM_CHAOS); reference/src/mon-util.c:788- (update_smart_learn always equip_learn_flag/element then optional mon known_pstate)
port: packages/core/src/combat/mon-melee.ts:678-928 (resolveBlowEffectLive); packages/core/src/game/mon-side.ts:140-442 (no updateSmartLearn)
expected: After elemental / timed / exp-drain / disenchant / hallu blows, update_smart_learn teaches the player the corresponding rune and (under birth_ai_learn) updates mon->known_pstate.
actual: Live melee path never calls updateSmartLearn. Elemental melee does not equip_learn_element; OF_PROT_* / HOLD_LIFE / etc. are not learned from those blows via this path; birth_ai_learn monsters never learn from melee.
why: Identification and smart-monster AI diverge from upstream after ordinary melee.
confidence: high

### L5_monsters-003  monster_attack_monster skips blow effects and armor
sev: P1
concession: n
ref: reference/src/mon-attack.c:765-901 (monster_attack_monster: full melee_handler_for_blow_effect, test_hit vs t_mon->race->ac, stun critical)
port: packages/core/src/game/mon-cmd.ts:71-171
expected: Commanded (or mon-vs-mon) blows run the same RBE handlers as player melee (HURT armor reduce, elemental mon damage, timed mon effects, EAT_ITEM steal from mon, etc.) against target race AC.
actual: Port only rolls to-hit vs race AC, applies raw dice damage via monTakeHit, then optional mon stun. No adjust_dam_armor, no elemental/status/theft handlers, no lore blow counting, no hit-and-run blink.
why: Necromancer command combat and any mon-vs-mon use of this path deals wrong damage and wrong side effects.
confidence: high

### L5_monsters-004  make_ranged_attack omits lore_update after a cast
sev: P2
concession: n
ref: reference/src/mon-attack.c:468-484 (after cast: lore spell flags + cast counts, then lore_update)
port: packages/core/src/game/mon-ranged.ts:382-390
expected: lore_update re-derives innateFreqKnown / spellFreqKnown once castInnate/castSpell exceeds 50 (and other derived fields).
actual: lore.spellFlags and cast counters update, but loreUpdate is never called. Spell frequency never becomes "known" from observing casts until some other path calls loreUpdate.
why: Monster recall under-reports known spell frequency after many observed casts.
confidence: high

### L5_monsters-005  process_monster_timed silently decrements instead of mon_dec_timed
sev: P2
concession: n
ref: reference/src/mon-move.c:1800-1826 (mon_dec_timed for FAST/SLOW/HOLD/DISEN; STUN/CONF/CHANGED/FEAR with MON_TMD_FLG_NOTIFY); reference/src/mon-timed.c:161-216 (timer->0 emits message_end when NOTIFY)
port: packages/core/src/game/monster-turn.ts:1656-1676
expected: Expiry of stun/conf/fear/changed (and related) queues MON_MSG_NOT_DAZED / NOT_CONFUSED / NOT_AFRAID / etc. for obvious monsters; fear reduces by randint1(level/10+1) via mon_dec_timed.
actual: Timers are written as mTimed[idx] = v-1 (fear: manual subtract). No monDecTimed, no NOTIFY, no end messages ("is no longer stunned/confused/afraid", "speeds up", "can move again", etc.).
why: Visible status-expiry messaging and any mon_set_timed side cases are missing every monster turn.
confidence: high

### L5_monsters-006  Noise-based sleep reduction never messages wake-up
sev: P2
concession: n
ref: reference/src/mon-move.c:1768-1778 (mon_dec_timed SLEEP with NOTIFY; lore wake/ignore + lore_update)
port: packages/core/src/game/monster-turn.ts:1629-1638
expected: Reducing sleep to 0 via noise uses mon_dec_timed(..., NOTIFY) so obvious monsters print "wake[s] up." and lore_update runs.
actual: Raw mTimed[SLEEP] = next. No wake message on noise wake (aggravate path does msg separately). lore_update not called after wake/ignore counts.
why: Monsters wake silently from player noise; recall sleep knowledge may lag.
confidence: high

### L5_monsters-007  Melee death note uses bare race.name not MDESC_SHOW|MDESC_IND_VIS
sev: P2
concession: n
ref: reference/src/mon-attack.c:563-564,639 (ddesc = monster_desc MDESC_SHOW|MDESC_IND_VIS); mon-blows.c take_hit(..., context->ddesc)
port: packages/core/src/game/mon-side.ts:155 (takeHit(..., mon.race.name, ...))
expected: died_from / death note is "a kobold" / "an orc" / unique full name (forced visible indefinite).
actual: Bare race.name ("kobold", "Farmer Maggot") without article/grammar from monster_desc.
why: Tombstone, score, and death history strings diverge from upstream.
confidence: high

### L5_monsters-008  Protection from evil repel message uses race.name not MDESC_STANDARD
sev: P2
concession: n
ref: reference/src/mon-attack.c:561,605 (msg("%s is repelled.", m_name) with MDESC_STANDARD)
port: packages/core/src/combat/mon-melee.ts:1014 (env?.msg(`${mon.race.name} is repelled.`))
expected: "The kobold is repelled." (capitalized standard name).
actual: "kobold is repelled." (or uncapitalized unique name as stored).
why: Visible combat message drift on a common defensive buff path.
confidence: high

### L5_monsters-009  mon-msg stack/batch/history not ported; multi-mon messages never pluralize
sev: P2
concession: n
ref: reference/src/mon-msg.c:195-246 (stack_message), 248+ (add_monster_message), 318+ (get_subject count/invisible/offscreen), flush at end of projection
port: packages/core/src/game/mon-message.ts:8-13,102-109 (formats one visible count==1 line only; documents batching as deferred)
expected: Same race + same msg_code batches into "3 kobolds die." / shared pain lines; redundant mon+code suppressed via mon_message_hist; death delay ordering.
actual: Each mon message is formatted singly as it happens. Multi-monster balls/breaths produce N separate singular lines; no hist de-dupe.
why: Projection feedback is noisier and differently worded than upstream for multi-hit events.
confidence: high

### L5_monsters-010  Decoy-target cast witness path omitted in monster_can_cast
sev: P2
concession: n
ref: reference/src/mon-attack.c:123-145 (if target != player, require square_isview on mon, target, or a PROJECT_SHORT path grid)
port: packages/core/src/game/mon-ranged.ts:269-301 (monsterCanCast ends after projectable; comment admits witness deferred)
expected: When aiming a decoy out of player view with no visible path grid, the cast is aborted.
actual: Any projectable path to the decoy allows the cast regardless of player view.
why: Decoyed monsters can cast "in the dark" where C would refuse, changing AI and feedback.
confidence: high

## MAP L5_monsters
reference/src/list-mon-message.h -> packages/core/src/generated/mon-message.ts
reference/src/list-mon-race-flags.h -> packages/core/src/generated/mon-race-flags.ts
reference/src/list-mon-spells.h -> packages/core/src/generated/mon-spells.ts
reference/src/list-mon-temp-flags.h -> packages/core/src/generated/mon-temp-flags.ts
reference/src/list-mon-timed.h -> packages/core/src/generated/mon-timed.ts
reference/src/mon-attack.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts; packages/core/src/game/mon-side.ts
reference/src/mon-attack.h -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-ranged.ts; packages/core/src/game/mon-cmd.ts
reference/src/mon-blows.c -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-side.ts
reference/src/mon-blows.h -> packages/core/src/combat/mon-melee.ts; packages/core/src/game/mon-side.ts
reference/src/mon-desc.c -> packages/core/src/mon/desc.ts
reference/src/mon-desc.h -> packages/core/src/mon/desc.ts
reference/src/mon-group.c -> packages/core/src/game/mon-group.ts
reference/src/mon-group.h -> packages/core/src/game/mon-group.ts; packages/core/src/mon/monster.ts (GROUP_TYPE); packages/core/src/mon/types.ts (MON_GROUP roles)
reference/src/mon-init.c -> packages/core/src/mon/bind.ts; packages/content/src/specs/mon-init.ts
reference/src/mon-init.h -> packages/core/src/mon/bind.ts; packages/content/src/specs/mon-init.ts
reference/src/mon-list.c -> packages/core/src/game/mon-list.ts
reference/src/mon-list.h -> packages/core/src/game/mon-list.ts
reference/src/mon-lore.c -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts; packages/core/src/game/lore-color.ts
reference/src/mon-lore.h -> packages/core/src/mon/lore.ts; packages/core/src/mon/lore-describe.ts
reference/src/mon-make.c -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts; packages/core/src/gen/util.ts (gen-time place twin)
reference/src/mon-make.h -> packages/core/src/mon/make.ts; packages/core/src/game/mon-place.ts
reference/src/mon-move.c -> packages/core/src/game/monster-turn.ts; packages/core/src/game/scheduler.ts
reference/src/mon-move.h -> packages/core/src/game/monster-turn.ts
reference/src/mon-msg.c -> packages/core/src/game/mon-message.ts
reference/src/mon-msg.h -> packages/core/src/game/mon-message.ts; packages/core/src/generated/mon-message.ts
reference/src/mon-predicate.c -> packages/core/src/mon/predicate.ts; packages/core/src/game/monster-turn.ts (monsterIsDecoyed); packages/core/src/game/effect-mon-origin.ts (monsterIsDecoyed alternate)
reference/src/mon-predicate.h -> packages/core/src/mon/predicate.ts
reference/src/mon-spell.c -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-cast.ts; packages/core/src/game/mon-message.ts (spell_message)
reference/src/mon-spell.h -> packages/core/src/mon/spell.ts; packages/core/src/game/mon-cast.ts
reference/src/monster.h -> packages/core/src/mon/monster.ts; packages/core/src/mon/types.ts
reference/src/mon-summon.c -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts (summon_specific placement)
reference/src/mon-summon.h -> packages/core/src/mon/summon.ts; packages/core/src/game/mon-place.ts
reference/src/mon-timed.c -> packages/core/src/mon/timed.ts
reference/src/mon-timed.h -> packages/core/src/mon/timed.ts; packages/core/src/generated/mon-timed.ts
reference/src/mon-util.c -> packages/core/src/mon/take-hit.ts; packages/core/src/mon/steal.ts; packages/core/src/mon/make.ts (monster_carry); packages/core/src/game/known.ts (update_mon, become_aware); packages/core/src/game/mon-death.ts (monster_death, mon_take_nonplayer_hit, terrain damage); packages/core/src/game/mon-ranged.ts (injured kin helpers); packages/core/src/mon/spell.ts (update_smart_learn)
reference/src/mon-util.h -> packages/core/src/mon/take-hit.ts; packages/core/src/game/known.ts; packages/core/src/game/mon-death.ts

# ===== L6_player =====

# L6_player audit (player / player-*)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: list-equip/player-flags/timed/stats + player*.c/h. Searched packages/ (excl. node_modules, dist, borg).

### L6_player-001  player_is_trapsafe ignores OF_TRAP_IMMUNE equipment
sev: P1
concession: n
ref: reference/src/player-util.c:1073-1078 (player_is_trapsafe: TMD_TRAPSAFE OR player_of_has OF_TRAP_IMMUNE)
port: packages/core/src/game/player-path.ts:58-61 (playerIsTrapsafe); also packages/core/src/game/chest.ts:84 (local twin)
expected: Wearing OF_TRAP_IMMUNE (or any source that sets player_state.flags OF_TRAP_IMMUNE) makes the player trapsafe for run_test, find_path forbid_traps, and related path/run decisions.
actual: Local playerIsTrapsafe only tests timed[TMD.TRAPSAFE] > 0. OF_TRAP_IMMUNE from gear is ignored for running/pathfinding (trap activation in trap.ts can still honor OF via env.playerHasFlag when wired).
why: Trap-immunity items do not stop run/pathfind from treating visible traps as hazards or changing forbid_traps path selection.
confidence: high

### L6_player-002  player_can_cast omits no_light
sev: P1
concession: n
ref: reference/src/player-util.c:1096-1100 (player_can_cast: TMD_BLIND || no_light(p) blocks with "You cannot see!")
port: packages/core/src/game/spell-cmd.ts:100-116 (playerCanCast)
expected: Casting (and study, which calls player_can_cast first) fails when the player's own grid is unseen (no light), same message as blindness.
actual: playerCanCast checks total_spells, TMD_BLIND, and TMD_CONFUSED only. no_light is never evaluated (noLight exists in cave-cmd.ts/chest.ts but is not used here). Web canCast menu only gates on totalSpells > 0.
why: Casters can cast and study in complete darkness; fail rates and dungeon play diverge from upstream.
confidence: high

### L6_player-003  Scroll read never enforces player_can_read
sev: P1
concession: n
ref: reference/src/player-util.c:1166-1196 (player_can_read: blind / no_light / confused / amnesia); player_can_read_prereq used before 'r'
port: packages/core/src/game/obj-cmd.ts:1132-1135 ("read" only gated by shape + tvalIsScroll)
expected: Reading a scroll fails with "You can't see anything." / "You have no light to read by." / "You are too confused to read!" / "You can't remember how to read!" under those conditions.
actual: installObjCommands registers "read" with only playerGetResumeNormalShape + tval filter. No blind, no_light, confused, or amnesia check on the live path.
why: Scrolls work while blind, in the dark, confused, or amnesiac.
confidence: high

### L6_player-004  TMD_FASTCAST cast costs a full turn, not 3/4 energy
sev: P1
concession: n
ref: reference/src/cmd-obj.c:1163-1168 (after spell_cast success: if TMD_FASTCAST then energy_use = move_energy * 3 / 4 else move_energy)
port: packages/core/src/game/spell-cmd.ts:287-288 (always return state.z.moveEnergy; comment admits FASTCAST deferred)
expected: While FASTCAST is active, a successful cast spends (move_energy * 3) / 4.
actual: Cast always spends full move_energy regardless of timed[TMD.FASTCAST].
why: Fastcasting spells (class power / effects that set FASTCAST) grant no speed advantage.
confidence: high

### L6_player-005  do_cmd_run does not refuse when confused
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1380-1381 (do_cmd_run: player_confuse_dir(player, &dir, true) returns without starting run; "You are too confused.")
port: packages/core/src/game/player-path.ts:877-879 (runAction -> runStep with no confusion gate); packages/core/src/game/obj-cmd.ts:610-626 (playerConfuseDir has no `too` parameter)
expected: Starting a run while confused always fails with "You are too confused." and spends no energy / does not enter run state.
actual: Run starts and continues; each step goes through walkAction, which may randomize direction via playerConfuseDir(false semantics) instead of blocking the run.
why: Confused players can run (and pathfind steps via walk), scrambling movement vs upstream's hard block.
confidence: high

### L6_player-006  Pathfinder door penalties skip dark-skill and convert_turn_penalty
sev: P2
concession: n
ref: reference/src/player-path.c:126-155 (convert_turn_penalty via energy_per_move); L161-210 (unlocked PF_SCL then convert; locked uses calc_unlocking_chance(p, 7, cur_light < 1 && !PF_UNLIGHT) then convert)
port: packages/core/src/game/player-path.ts:370-377 (lockedPenalty: calcUnlockingChance(state, 7) only); L431 (unlocked = PF_SCL raw); packages/core/src/game/trap.ts:596-609 (calcUnlockingChance has no lock_unseen arg)
expected: In darkness (cur_light < 1 and not PF_UNLIGHT), lock skill is /10 for the path cost; all door/rubble penalties scale when energy_per_move != move_energy (extra moves).
actual: lockedPenalty never applies the lock_unseen /10; neither unlocked nor locked nor rubble penalties call convert_turn_penalty. Extra-move characters get wrong path costs through doors/rubble.
why: Pathfind/explore route choice and expected costs diverge for dark grids and MOVES gear.
confidence: high

### L6_player-007  weight_remaining never computed for character sheet
sev: P2
concession: n
ref: reference/src/player-calcs.c:1756-1765 (weight_remaining = 60 * adj_str_wgt[stat_ind STR] - total_weight - 1)
port: packages/core/src/game/char-sheet.ts:107,189,400 (weightRemaining optional, defaults 0); packages/web/src/screens.ts:417-439 (charSheetDeps does not supply weightRemaining); packages/core/src/player/calcs.ts has weightLimit only
expected: Char sheet Burden/Overweight columns use live weight_remaining (red when negative).
actual: No port of weight_remaining; web deps omit it so the sheet always uses 0 (Overweight "0.0 lb", burden color never overweight-red from this field).
why: Visible character-sheet burden/overweight is wrong in normal play.
confidence: high

### L6_player-008  player_set_timed notify suppression for known temp resists/flags often inert
sev: P3
concession: n
ref: reference/src/player-timed.c:828-839 (suppress notify when temp_resist already known-immune or oflag_syn already known from non-timed gear)
port: packages/core/src/player/timed.ts:309-333 (notifyQueries optional; absent => no suppression)
expected: Gaining a temporary resist the player already knows as immunity (or a timed flag synonym already known from gear) is silent.
actual: When callers omit hooks.notifyQueries (common; comment cites gap 4.8), messages always fire even when C would silence them.
why: Extra status spam / disturbance messaging vs upstream; durations still correct.
confidence: med

## MAP L6_player
reference/src/list-equip-slots.h -> packages/core/src/generated/equip-slots.ts
reference/src/list-player-flags.h -> packages/core/src/generated/player-flags.ts
reference/src/list-player-timed.h -> packages/core/src/generated/player-timed.ts
reference/src/list-stats.h -> packages/core/src/generated/stats.ts
reference/src/player.c -> packages/core/src/player/player.ts; packages/core/src/player/exp.ts; packages/core/src/player/calcs.ts (playerFlags, player_exp tables, playerHpAttr/playerSpAttr)
reference/src/player.h -> packages/core/src/player/types.ts; packages/core/src/player/player.ts; packages/core/src/generated/{stats,player-flags,player-timed}.ts
reference/src/player-birth.c -> packages/core/src/player/birth.ts; packages/core/src/player/exp.ts (rollHp); packages/core/src/session/game.ts (player_outfit / wield_all / accept flow)
reference/src/player-birth.h -> packages/core/src/player/birth.ts
reference/src/player-calcs.c -> packages/core/src/player/calcs.ts; packages/core/src/player/spell.ts (calcSpells, calcMana); packages/core/src/game/gear.ts (calcInventory)
reference/src/player-calcs.h -> packages/core/src/player/calcs.ts; packages/core/src/game/gear.ts
reference/src/player-class.c -> packages/core/src/player/bind.ts (PlayerRegistry classes / classByName)
reference/src/player-history.c -> packages/core/src/player/history.ts; packages/core/src/game/history.ts
reference/src/player-history.h -> packages/core/src/player/history.ts; packages/core/src/generated/history-types.ts
reference/src/player-path.c -> packages/core/src/game/player-path.ts
reference/src/player-path.h -> packages/core/src/game/player-path.ts
reference/src/player-properties.c -> packages/core/src/player/abilities.ts
reference/src/player-properties.h -> packages/core/src/player/abilities.ts
reference/src/player-quest.c -> packages/core/src/game/quest.ts
reference/src/player-quest.h -> packages/core/src/game/quest.ts
reference/src/player-race.c -> packages/core/src/player/bind.ts (PlayerRegistry races / raceByName)
reference/src/player-spell.c -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/player-spell.h -> packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/player-timed.c -> packages/core/src/player/timed.ts; packages/core/src/player/bind.ts (bindTimed)
reference/src/player-timed.h -> packages/core/src/player/timed.ts; packages/core/src/generated/player-timed.ts; packages/core/src/player/types.ts
reference/src/player-util.c -> packages/core/src/player/take-hit.ts; packages/core/src/player/best-digger.ts; packages/core/src/player/combat-regen.ts; packages/core/src/player/exp.ts (scramble); packages/core/src/game/loop.ts (regen); packages/core/src/game/world.ts (over_exert, update_light, digest, faint/starve); packages/core/src/game/player-turn.ts (energy_per_move, walk/rest); packages/core/src/game/obj-cmd.ts (player_confuse_dir); packages/core/src/game/player-path.ts (player_is_trapsafe, disturb)
reference/src/player-util.h -> same spread as player-util.c

# ===== L7_combat =====

# L7_combat audit (combat / player-attack)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: player-attack.c / player-attack.h. Searched packages/ (excl. node_modules, dist, borg).

### L7_combat-001  Off-weapon brands/slays never applied in live melee
sev: P1
concession: n
ref: reference/src/player-attack.c:786-794 (for j = 2; j < body.count; improve_attack_modifier on slot_object)
port: packages/core/src/combat/melee.ts:407-409 (opts.offhand ?? []); packages/core/src/game/player-turn.ts:251-273 (attackMonster never passes offhand); packages/core/src/game/effect-melee.ts:91-103 (playerBlow same)
expected: Brands/slays on equipment slots after weapon and bow (rings, gloves, armor, etc.) compete via improve_attack_modifier and can set the blow brand/slay/verb and damage mult.
actual: MeleeOptions.offhand is only consumed inside pyAttackReal; no live caller ever supplies it (grep: only defined/used in melee.ts). Only the weapon and temporary brands/slays are considered.
why: Rings/gloves/other gear with brands or slays grant no melee damage or hit-verb change on the default attack path.
confidence: high

### L7_combat-002  Invisible melee targets never get the 50% to-hit penalty
sev: P1
concession: n
ref: reference/src/player-attack.c:104-109 (chance_of_melee_hit halves when !monster_is_visible); L763 test_hit(chance_of_melee_hit(...))
port: packages/core/src/game/player-turn.ts:260 (monVisible: true hardcoded in attackMonster); packages/core/src/game/effect-melee.ts:100 (same); packages/core/src/combat/melee.ts:243-249 (chanceOfMeleeHit implements the half correctly when monVisible is false)
expected: Melee against a non-visible monster uses chance/2 for test_hit (and monsterFled uses visibility).
actual: Live melee always passes monVisible: true, so invisible monsters are hit at full accuracy. Comment admits "treated as visible".
why: Walking into or otherwise meleeing an invisible foe is much easier than upstream; to-hit and RNG outcomes diverge.
confidence: high

### L7_combat-003  do_cmd_fire / do_cmd_throw never run player_confuse_dir
sev: P1
concession: n
ref: reference/src/player-attack.c:1349-1352 (do_cmd_fire: after cmd_get_target, player_confuse_dir(..., false)); L1392-1395 (do_cmd_throw same)
port: packages/core/src/game/ranged-cmd.ts:191-234 (fire), 279-325 (throw) use args.dir as-is; packages/web/src/main.ts:3065-3087 (aimDir) never confuses
expected: While confused, fire/throw randomize direction 75% of the time (always if dir was 5/"no direction" semantics per player_confuse_dir), emit "You are confused." when the dir changes, and draw the confuse RNG.
actual: Chosen aim direction is used verbatim; confused players fire and throw accurately with no confuse RNG draw on this path.
why: Confusion does not scramble missile aim; combat RNG stream and outcomes diverge in normal confused play.
confidence: high

### L7_combat-004  do_cmd_fire / do_cmd_throw skip player_get_resume_normal_shape
sev: P1
concession: n
ref: reference/src/player-attack.c:1318-1320 (do_cmd_fire), L1373-1375 (do_cmd_throw): require player_get_resume_normal_shape or abort
port: packages/core/src/game/ranged-cmd.ts:191-325 (no playerGetResumeNormalShape); packages/core/src/game/obj-cmd.ts:591-604 (helper exists for other cmds)
expected: A shapechanged player must confirm resume to normal form before firing or throwing; refuse cancels with no energy.
actual: Fire and throw proceed in any shape with no prompt and no forced resume.
why: Shapechange races/forms can shoot and throw while transformed; upstream forces normal form first.
confidence: high

### L7_combat-005  Ranged hit never teaches missile/equip/brand-slay knowledge
sev: P2
concession: n
ref: reference/src/player-attack.c:1137-1140 (missile_learn_on_ranged_attack + equip_learn_on_ranged_attack on hit); L1258-1259 (learn_brand_slay_from_launch in make_ranged_shot); L1299 (learn_brand_slay_from_throw)
port: packages/core/src/game/ranged-cmd.ts:126-163 (hit path has mon_take_hit only); missileLearnOnRangedAttack / equipLearnOnRangedAttack / learnBrandSlayFromLaunch / learnBrandSlayFromThrow never called from game/ (only tests / obj knowledge module)
expected: A successful shot/throw learns combat runes on the missile (and equip for shots) and brand/slay runes from the objects involved.
actual: Ranged combat never invokes those learn helpers on the live path (ranged-cmd comment lists them as DEFERRED).
why: Firing and throwing do not identify to-hit/to-dam or brand/slay runes the way upstream does.
confidence: high

### L7_combat-006  Melee learn-on-attack runs on miss/afraid and ignores real visibility
sev: P2
concession: n
ref: reference/src/player-attack.c:822-823 (equip_learn_on_melee_attack + learn_brand_slay_from_melee only after a successful hit inside py_attack_real); learn_brand_slay_helper uses monster_is_visible for slays
port: packages/core/src/game/player-turn.ts:240-275 (learnBrandSlayFromMelee always before pyAttack with visible: true; equipLearnOnMeleeAttack always after, even if every blow missed or was refused by fear)
expected: Learning runs once per successful blow only; slay runes require a visible monster; afraid early-out does not learn combat runes from the blow path.
actual: One learn pass always runs per attackMonster (and effect playerBlow) regardless of hit/miss/afraid, and mon is forced visible for slay learning.
why: Players can learn weapon combat/brand-slay knowledge from pure misses and from invisible targets; multi-blow per-hit learn cadence also differs.
confidence: high

### L7_combat-007  show_damage never applied to player melee or ranged hit lines
sev: P2
concession: n
ref: reference/src/player-attack.c:853-860 (melee: dmg_text " (N)" when OPT show_damage); L1168-1179 (ranged same)
port: packages/web/src/main.ts:946-967 (onMelee: "You %s %s." with no damage suffix); packages/core/src/game/ranged-cmd.ts:131-133 (ranged hit line has no " (N)"); shield bash alone implements showDamage (melee.ts:615-618)
expected: With show_damage on, hit messages append " (damage)" before the period (and crit flavor on the same C message for melee).
actual: Player melee (except shield bash) and all ranged hits omit the damage suffix even when the option is set.
why: Visible combat feedback option does not work for the main player attack messages.
confidence: high

### L7_combat-008  Ranged hit on non-obvious monster never prints "finds a mark"
sev: P2
concession: n
ref: reference/src/player-attack.c:1156-1158 (if !visible: "The %s finds a mark.")
port: packages/core/src/game/ranged-cmd.ts:126-134 (always "Your %s %s %s." style; monObvious only affects to-hit math)
expected: Hitting a non-obvious monster prints the impersonal finds-a-mark line instead of the named hit verb line.
actual: Always names the monster and uses the hit verb; comment marks the branch DEFERRED.
why: Invisible/non-obvious ranged hits look and read wrong.
confidence: high

### L7_combat-009  Ranged crit flavor lines never printed
sev: P2
concession: n
ref: reference/src/player-attack.c:1033-1038 (ranged_hit_types texts for HIT_GOOD/GREAT/SUPERB); L1174-1176 append flavor on same message
port: packages/core/src/game/ranged-cmd.ts:133 (only verb line); no CRIT_FLAVOR for ranged
expected: Good/great/superb missile crits add "It was a good/great/superb hit!" to the hit message.
actual: makeRangedShot/Throw return the HitType but ranged-cmd never emits the flavor text.
why: Critical shots/throws lack the classic crit lines players see in C.
confidence: high

### L7_combat-010  Melee crit flavor is a second message, not one line with the hit
sev: P2
concession: n
ref: reference/src/player-attack.c:856-858 (single msgt: "You %s %s%s. %s" with flavor)
port: packages/web/src/main.ts:963-965 (say hit line, then separate say(flavor))
expected: One message: "You hit the kobold. It was a good hit!" (plus optional damage text).
actual: Two message-log entries: "You hit the kobold." then "It was a good hit!".
why: Message history and more-prompts differ from upstream for every melee crit.
confidence: high

### L7_combat-011  Target-out-of-range "Fire anyway?" not implemented
sev: P2
concession: n
ref: reference/src/player-attack.c:1070-1080 (DIR_TARGET + target_okay: if taim > range, get_check "Target out of range by N squares. Fire anyway?")
port: packages/core/src/game/ranged-cmd.ts:71-77,82 (uses target/path with no out-of-range confirm)
expected: Aimed fire/throw at a target beyond weapon range prompts; No aborts with no energy/missile consumption.
actual: Always projects up to range along the path; no prompt, no cancel path.
why: Players cannot refuse a long target shot; ammo/energy always commit.
confidence: high

### L7_combat-012  Afraid py_attack_real path does not equip_learn OF_AFRAID
sev: P2
concession: n
ref: reference/src/player-attack.c:752-755 (player_of_has OF_AFRAID: equip_learn_flag(OF_AFRAID) then refuse blow)
port: packages/core/src/combat/melee.ts:371-377 (afraid early return, no learn); packages/core/src/game/player-turn.ts:420-424 (walk obvious path does learn); invisible/tunnel-into-monster uses attackMonster afraid flag only
expected: Any py_attack_real refuse for fear also teaches the OF_AFRAID rune from equipment.
actual: Only the pre-attack obvious-monster walk gate learns OF_AFRAID; the invisible-monster / attackBlocker path prints fear via onMelee verb "afraid" without equipLearnFlag.
why: Fear from gear is not identified when the refuse happens inside py_attack_real.
confidence: high

### L7_combat-013  O-combat non-crit melee hit messages while C is silent
sev: P2
concession: n
ref: reference/src/player-attack.c:467-469 (o_critical_melee non-crit sets MSG_SHOOT_HIT); L704-711 melee_hit_types has no MSG_SHOOT_HIT so the message loop prints nothing
port: packages/core/src/combat/hit.ts:401 (oCriticalMelee non-crit msg "SHOOT_HIT"); packages/web/src/main.ts:963 (always "You %s %s." on hit)
expected: With birth_percent_damage, a non-critical melee hit leaves msg_type MSG_SHOOT_HIT and produces no "You hit..." line from melee_hit_types.
actual: Port still prints the normal hit line for every successful blow, including O non-crits.
why: O-combat birth option changes hit messaging vs upstream (extra lines / sounds).
confidence: med

## MAP L7_combat
reference/src/player-attack.c -> packages/core/src/combat/hit.ts (test_hit/hit_chance/crits/deadliness), packages/core/src/combat/melee.ts (melee hit/damage/py_attack*), packages/core/src/combat/ranged.ts (missile hit/damage/breakage/make_ranged_*), packages/core/src/combat/brand-slay.ts (improve_attack_modifier + object_to_hit/dam used by attack), packages/core/src/game/player-turn.ts (live py_attack wiring), packages/core/src/game/ranged-cmd.ts (ranged_helper/do_cmd_fire/throw/fire_at_nearest), packages/web/src/main.ts (melee hit message shell)
reference/src/player-attack.h -> same as player-attack.c (API surface: attack_result, hit_types, fire/throw/py_attack/test_hit/breakage/chance_*); no separate .h port file

# ===== L8_effects =====

# L8_effects audit (effects & projection)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: effect-handler*, effects*, list-effects/projections, project*.
Searched packages/ (excl. node_modules, dist, borg).

### L8_effects-001  EF_SELECT never prompts; always random for player origin
sev: P1
concession: n
ref: reference/src/effects.c:425-460 (EF_SELECT player origin: cmd_get_effect_from_list / get_effect_from_list, choice -2 random only when chosen)
port: packages/core/src/effects/interpreter.ts:487-500 (chooseEffect absent => choice=-2 always); packages/core/src/game/obj-cmd.ts:780-801 and packages/core/src/game/spell-cmd.ts:166-183 (attachGameEnv never sets chooseEffect); grep: chooseEffect only wired in interpreter.test.ts
expected: Player-origin EF_SELECT with 2+ sub-effects presents a menu (or abort/random); gamedata uses this for dual-breath devices and activations (object.txt effect:SELECT dice:2; activation.txt many SELECT chains).
actual: Live EffectContext never injects chooseEffect, so every player SELECT falls back to randint0(choice_count) without a prompt.
why: Staffs/activations that offer a choice (e.g. fire vs cold breath) always pick randomly; player cannot choose or cancel.
confidence: high

### L8_effects-002  WEAPON_DAMAGE expression base never bound for object/curse chains
sev: P1
concession: n
ref: reference/src/effects.c:308-315 (effect_value_base_weapon_damage: damroll(obj->dd,obj->ds)+obj->to_d); curse.txt "treacherous weapon" effect:DAMAGE dice:$B expr:B:WEAPON_DAMAGE:+ 0
port: packages/core/src/game/obj-cmd.ts:518-526 (buildObjectEffectChain baseValues only PLAYER_LEVEL/MAX_SIGHT/DUNGEON_LEVEL); packages/core/src/game/curse-tick.ts:77 (uses buildObjectEffectChain); packages/core/src/effects/effect.ts:529-530 (missing provider leaves expression base unset => 0)
expected: Treacherous-weapon curse (and any WEAPON_DAMAGE expr) deals the equipped weapon's rolled base damage each fire.
actual: Expression base evaluates as 0; the curse's DAMAGE effect deals 0 HP.
why: A live equipped curse does no self-damage; RNG and combat outcome diverge from C.
confidence: high

### L8_effects-003  MONSTER_PERCENT_HP_GONE expression base never bound for player spells
sev: P1
concession: n
ref: reference/src/effects.c:322-328 (effect_value_base_monster_percent_hp_gone from target_get_monster); class.txt vampire "Curse" dice:$Dd$S expr:S:MONSTER_PERCENT_HP_GONE:+ 50
port: packages/core/src/game/obj-cmd.ts:518-526; packages/core/src/game/spell-cmd.ts:161-165 (spellCast uses buildObjectEffectChain without MONSTER_PERCENT_HP_GONE / target)
expected: Curse spell die sides = (target maxhp-hp)*100/maxhp + 50 so wounded monsters take more damage.
actual: Missing provider => sides evaluate as 0+50 = 50 always; wound-scaling is lost.
why: Vampire class signature spell under-damages wounded targets and over-simplifies the die.
confidence: high

### L8_effects-004  PLAYER_HP expression base never bound (vampire shape self-damage)
sev: P1
concession: n
ref: reference/src/effects.c:317-320 (effect_value_base_player_hp); shape.txt vampire effect:DAMAGE dice:$B expr:B:PLAYER_HP:/ 4
port: packages/core/src/game/effect-general.ts:793-797 (handleSHAPECHANGE builds chain via buildObjectEffectChain without PLAYER_HP); packages/core/src/game/obj-cmd.ts:518-526
expected: Assuming vampire form deals chp/4 damage to the player (effect-msg "taking vampire form").
actual: Expression base is 0; transform deals 0 self-damage.
why: Shapechange cost is free vs upstream HP tax.
confidence: high

### L8_effects-005  PF_CHARM never passed into project_m (nature mage animal boost)
sev: P1
concession: n
ref: reference/src/project-mon.c:1344-1346 (charm = origin SRC_PLAYER && player_has(PF_CHARM)); L489-491 and status handlers: dam += dam/2 vs RF_ANIMAL when charm; class.txt nature mage player-flags includes CHARM
port: packages/core/src/game/effect-attack.ts:80 (playerCastSource only if env.charm !== undefined); packages/core/src/game/obj-cmd.ts:780-801 and spell-cmd.ts:166-183 never set GameEffectEnv.charm; packages/core/src/session/game.ts cast hooks never set charm
expected: Nature-mage player projections boost sleep/confuse/slow/hold/stun/poly vs animals by +50% power.
actual: charm is always false/undefined on the live cast path; animal boost never applies.
why: Nature mage class flag is a dead mechanic for projections.
confidence: high

### L8_effects-006  PROJ_MON_CLONE multiply_monster hook never wired on live projections
sev: P1
concession: n
ref: reference/src/project-mon.c project_monster_handler_MON_CLONE (multiply_monster); object.txt "Clone Monster" wand effect:BOLT_STATUS:MON_CLONE
port: packages/core/src/mon/project-mon.ts:673-676 (hMonClone calls hooks.multiplyMonster); packages/core/src/game/project-monster.ts:157-159 (forwards hook if present); packages/core/src/session/game.ts:998-1045 (cast.hooks.monster has no multiplyMonster; multiplyMonster only used for ambient breeders ~L1477)
expected: Clone Monster wand/spell/wonder path clones the target via multiply_monster after heal+haste.
actual: Handler runs heal/haste but multiplyMonster is absent, so no clone is placed.
why: Clone Monster devices do not clone; MON_CLONE projections are incomplete in normal play.
confidence: high

### L8_effects-007  EF_CURSE ignores show_damage and pain-with-damage path
sev: P2
concession: n
ref: reference/src/effect-handler-attack.c:1671-1698 (display_dam builds " dies! (%d)"; message_pain_show_damage when not dead)
port: packages/core/src/game/effect-melee.ts:210-229 (effectHit with fixed " dies!"; no show_damage branch; message_pain comment says deferred)
expected: With show_damage on, kill note includes damage and surviving hits use message_pain_show_damage.
actual: Always " dies!"; pain path is generic monTakeHit without damage display option.
why: Vampire Curse and similar direct-damage effects omit the combat feedback option.
confidence: high

### L8_effects-008  Monster-source EF_DAMAGE killer string is bare race name
sev: P2
concession: n
ref: reference/src/effect-handler-attack.c (monster_desc MDESC_DIED_FROM for SRC_MONSTER killer); project-player.c:848-849 same for projections
port: packages/core/src/game/effect-attack.ts:687-691 (killer = mon.race.name); packages/core/src/effects/handlers.ts:77-80 ("a monster" stand-in for base path)
expected: Death cause uses monster_desc grammar ("an orc", "Smeagol", etc.).
actual: Live monster EF_DAMAGE uses raw race.name (no article/indef); base path uses "a monster".
why: died_from / death dump strings diverge from upstream for monster-sourced damage effects.
confidence: high

### L8_effects-009  effect_describe / get_spell_info skip dice_roll RNG draws
sev: P3
concession: n
ref: reference/src/effects-info.c:344-351 (dice_roll which calls damroll, z-dice.c:579-591) when formatting effect descriptions
port: packages/core/src/effects/effect-info.ts:12-25, 519+ (Dice.randomValue / rvAverage; tests assert zero RNG draws)
expected: Inspecting/describing an effect chain advances the game RNG via damroll on dice_roll (upstream quirk).
actual: Display path never draws RNG (deliberate determinism).
why: Inspecting items/spells mid-game desyncs the RNG stream vs C if descriptions are shown during play.
confidence: high

### L8_effects-010  PROJECT_INFO / square_isbelievedwall approximated by real map
sev: P3
concession: ?
ref: reference/src/project.c:208-212, 272-276, 331-335 (PROJECT_INFO stops on square_isbelievedwall)
port: packages/core/src/world/project.ts:101-107 (INFO branch uses isProjectable on real map; comment DEFERRED); packages/core/src/game/target-loop.ts:38-42 documents same
expected: Targeting/UI path geometry respects player remembered walls.
actual: Path uses truth map; UI-only path until believed map is complete.
why: Target path display can leak true walls vs memory; not a combat project() default path.
confidence: high

### L8_effects-011  project_path decoy stop never matches (no decoy in path geometry)
sev: P3
concession: n
ref: reference/src/project.c:147, 216-218 (cave_find_decoy; PROJECT_STOP stops on decoy grid)
port: packages/core/src/world/project.ts:51-52, 109-112 (NO_DECOY sentinel (-1,-1) never matches)
expected: Bolts with PROJECT_STOP halt on a player decoy grid as on a monster.
actual: Path geometry ignores decoys; stop only on mon != 0. (Decoy destroy on hit is handled in castProjection onPlayer separately.)
why: A bolt aimed past a decoy may not stop on the decoy grid itself if no monster is there.
confidence: med

## MAP L8_effects
reference/src/effect-handler.h -> packages/core/src/effects/effect.ts (ENCH_*), packages/core/src/effects/interpreter.ts (EffectHandlerContext, effectCalculateValue), packages/core/src/effects/handlers.ts
reference/src/effect-handler-attack.c -> packages/core/src/effects/handlers.ts (DAMAGE base), packages/core/src/game/effect-attack.ts, packages/core/src/game/effect-melee.ts (CURSE/TAP_UNLIFE/melee-adjacent), packages/core/src/game/project-cast.ts (project_aimed/touch/cast* shapes)
reference/src/effect-handler-general.c -> packages/core/src/effects/handlers.ts (worldless general), packages/core/src/game/effect-general.ts, packages/core/src/game/effect-detect.ts, packages/core/src/game/effect-item.ts, packages/core/src/game/effect-monster.ts, packages/core/src/game/effect-summon.ts, packages/core/src/game/effect-teleport.ts, packages/core/src/game/effect-terrain.ts
reference/src/effects.c -> packages/core/src/effects/interpreter.ts (effect_do/simple/aim/valid), packages/core/src/effects/effect.ts (lookup/subtype/value bases), packages/core/src/game/effect-item.ts (rechargeFailureChance)
reference/src/effects.h -> packages/core/src/effects/effect.ts, packages/core/src/effects/interpreter.ts, packages/core/src/generated/effects.ts
reference/src/effects-info.c -> packages/core/src/effects/effect-info.ts (describe/avg/projection/menu), packages/core/src/obj/effects-info.ts (effect_summarize_properties)
reference/src/effects-info.h -> packages/core/src/effects/effect-info.ts, packages/core/src/obj/effects-info.ts, packages/core/src/obj/randart-build.ts (EFPROP)
reference/src/list-effects.h -> packages/core/src/generated/effects.ts (EFFECT_ENTRIES, EF)
reference/src/list-projections.h -> packages/core/src/generated/projections.ts (PROJECTION_ENTRIES, PROJ; elements from list-elements.h prepended)
reference/src/project.c -> packages/core/src/world/project.ts (project_path/projectable/computeProjection/project, PROJECT flags, GET_ANGLE_TO_GRID), packages/core/src/game/project-cast.ts (castProjection wiring), packages/core/src/world/projection.ts (adjustDam)
reference/src/project.h -> packages/core/src/world/project.ts, packages/core/src/world/projection.ts, packages/core/src/generated/projections.ts
reference/src/project-feat.c -> packages/core/src/game/project-feat.ts
reference/src/project-mon.c -> packages/core/src/mon/project-mon.ts (handlers), packages/core/src/game/project-monster.ts (project_m driver), packages/core/src/game/thrust.ts (thrust_away)
reference/src/project-obj.c -> packages/core/src/game/project-obj.ts (project_o, invenDamage)
reference/src/project-player.c -> packages/core/src/game/project-player.ts (project_p driver), packages/core/src/game/player-side.ts (project_player_handler_*), packages/core/src/world/projection.ts (adjustDam)

# ===== L9_dungeon =====

# L9_dungeon audit (dungeon gen / cave / trap)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: cave*, gen-*, generate*, list-dun/room/square/terrain/trap*, trap*.
Searched packages/ (excl. node_modules, dist, borg).

### L9_dungeon-001  Gen-time trap pick/power never runs; trapKinds not wired
sev: P1
concession: n
ref: reference/src/trap.c:356-394 (place_trap during generation: pick_trap + randcalc power in the gen RNG stream); reference/src/gen-util.c alloc_object TYP_TRAP calls place_trap mid-level
port: packages/core/src/session/boot.ts:180-217 (genDeps never sets trapKinds); packages/core/src/gen/util.ts:1177-1179 (without trapKinds only markTrap, no pick/power draws); packages/core/src/session/game.ts:1982-1989 (live generateLevel uses genDeps without traps)
expected: During generation, place_trap draws pick_trap + power into the level RNG stream so later object/monster placement and the final trap kind/power match C.
actual: Live genDeps omits trapKinds, so gen only records trap grids; no gen-stream pick/power draws. Level content after each trap site diverges from C's RNG stream.
why: Seeded level content and trap identities are not faithful; anything after a trap placement in the gen stream is desynced.
confidence: high

### L9_dungeon-002  populateFromLevel re-picks traps; discards Gen.traps
sev: P1
concession: n
ref: reference/src/trap.c:356-394 (place_trap is the only placer; gen placement is final)
port: packages/core/src/session/game.ts:1624-1629 (for trapGrids only: placeTrap(state, grid, -1, ...)); packages/core/src/gen/util.ts:274-279,1196-1197 (Gen.traps holds tidx+power when trapKinds present); packages/core/src/session/game.ts:2043-2054 (passes trapGrids, never g.traps); packages/core/src/game/trap.ts:333-354 (installTrap exists for gen-chosen kind/power)
expected: Kind and power chosen at generation are the live traps; no second pick_trap.
actual: Populate always calls placeTrap with tIdx=-1, re-drawing pick+power on the play RNG. Even if trapKinds were wired, g.traps would still be ignored.
why: Trap types/powers and post-gen play RNG diverge from upstream; installTrap path is dead on the live populate path.
confidence: high

### L9_dungeon-003  TRF_DELAY traps never fire (no player_leaving)
sev: P1
concession: n
ref: reference/src/mon-util.c:503-515 (player_leaving: hit_trap(grid1, 1) when player leaves a grid); reference/lib/gamedata/trap.txt "block fall trap" flags DELAY; reference/src/trap.c:511-513 (delayed gate)
port: packages/core/src/game/trap.ts:686-688 (onPlayerMoved only hitTrap(..., 0) on the NEW grid); packages/core/src/game/player-turn.ts:457-465 (movePlayer then onPlayerMoved(next) only); packages/core/src/game/context.ts:889-899,955-959 (monsterSwap/movePlayer never call hit_trap on the left grid)
expected: DELAY traps (e.g. block fall / ancient mechanism) activate when the player leaves their square, sealing granite behind them.
actual: Only delayed=0 (enter) is ever invoked on the live step path; DELAY traps never run their effects.
why: A normal dungeon trap type is inert; walk-off granite seal never happens.
confidence: high

### L9_dungeon-004  Trap OF save / TRAP_IMMUNE never consulted on live path
sev: P1
concession: n
ref: reference/src/trap.c:515-549 (player_is_trapsafe / player_of_has save_flags / OF_TRAP_IMMUNE learn); trap.txt save: lines (e.g. FEATHER for pits)
port: packages/core/src/session/game.ts:1343-1350 (trapDeps.env has expGain/msg/changeLevel only; no playerHasFlag, no disturb); packages/core/src/game/trap.ts:419-441 (trapImmune and saveFlags use env.playerHasFlag ?? false)
expected: Trap-immune equipment and trap save flags fully skip or save; equip_learn_flag on those OF flags.
actual: playerHasFlag is never set; every trap treats OF saves and TRAP_IMMUNE as false (TMD_TRAPSAFE alone still works via timed[]).
why: Boots of feather fall, trap immunity items, and kind save flags do nothing on traps in normal play.
confidence: high

### L9_dungeon-005  Town terrain not stored/restored without birth_levels_persist
sev: P1
concession: n
ref: reference/src/generate.c:1369-1373 (non-persist path: always cave_store town terrain when leaving depth 0); reference/src/gen-cave.c:2671-2703 (town_gen reloads chunk_find_name("Town") layout)
port: packages/core/src/session/game.ts:1871-2054 (without birth_levels_persist, every depth including 0 fully regenerates); packages/core/src/gen/cave.ts:2555-2558 (documents deferred town re-entry; regenerates every entry)
expected: Default play keeps the same town shop layout/stair grid across visits (terrain-only store via chunk_write); only residents re-roll.
actual: Leaving and returning to town regenerates a new layout (new store lots, stair position, ruins) every time unless birth_levels_persist is on.
why: Default town identity is unstable; shop doors and stair location change between visits.
confidence: high

### L9_dungeon-006  Live square_set_feat does not destroy traps on non-trappable terrain
sev: P1
concession: n
ref: reference/src/cave-square.c:1236-1262 (character_dungeon: if !square_player_trap_allowed then square_destroy_trap); reference/src/effect-handler-general.c EF_GRANITE / terrain changes use square_set_feat
port: packages/core/src/world/chunk.ts:201-211 (setFeat: feat_count + GLOW only); packages/core/src/game/effect-terrain.ts:235 (handleGRANITE setFeat GRANITE with no trap remove); packages/core/src/game/effect-terrain.ts:469-474 (square_destroy / DESTRUCTION setFeat without trap clear)
expected: Changing a grid to non-trap-holding terrain removes all traps on that grid.
actual: Traps remain in state.traps on granite/rubble/etc. after terrain effects (block-fall GRANITE, *destruction*, earthquake fills).
why: Traps can sit on illegal terrain; subsequent steps may re-trigger or leave ghosts; GRANITE seal fails to clear its own trap.
confidence: high

### L9_dungeon-007  Disarm-on-walk for known disarmable traps missing
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1058-1083,1311-1312 (move_player(dir, disarm): known disarmable trap + disarm true -> do_cmd_alter_aux / disarm, not step)
port: packages/core/src/game/player-turn.ts:472-481 (documents walk/jump share body; disarm-on-walk deferred); packages/core/src/game/cave-cmd.ts:615-618 (disarm-on-walk still on base action); packages/core/src/game/trap.ts:686-688 (any step onto player trap fires hitTrap)
expected: Walking onto a known, enabled player trap auto-disarms (alter) unless trapsafe/jump; jump deliberately steps on.
actual: Every walk onto a trap triggers it; jump is identical; no alter/disarm branch on walk.
why: Default walk into visible traps always sets them off instead of attempting disarm.
confidence: high

### L9_dungeon-008  Standing-in-web walk does not clear the web
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1288-1297 (do_cmd_walk: if square_iswebbed on player grid, remove web, spend turn, do not move)
port: packages/core/src/game/player-turn.ts:382-469 (walkAction never checks web on current grid); packages/core/src/game/cave-cmd.ts:616-617 (web clear noted as still on base action)
expected: Attempting to walk while webbed clears the web and ends the turn in place.
actual: Player walks out of webs normally; webs only block via other optional predicates.
why: Web spinner combat is much weaker; webs do not pin the player for a turn.
confidence: high

### L9_dungeon-009  Gen setFeat never clears WALL_INNER/OUTER/SOLID (C does)
sev: P2
concession: n
ref: reference/src/cave-square.c:1263-1268 (!character_dungeon: square_set_feat offs WALL_INNER/OUTER/SOLID); reference/src/gen-cave.c:742-756 (tunnel piercings use square_set_feat to floor)
port: packages/core/src/world/chunk.ts:201-211 (setFeat never clears wall gen flags); packages/core/src/gen/generate.ts:222-233 (clearGenerationFlags only after full builder success)
expected: Any setFeat during generation clears SQUARE_WALL_* flags on that grid immediately.
actual: Flags stick until end-of-level clearGenerationFlags; mid-gen grids can be floor yet still carry WALL_OUTER if only the flag is tested.
why: Predicates that key only on wall flags (not granite+flag) can mis-classify mid-generation; residual divergence risk.
confidence: med

### L9_dungeon-010  hit_trap never disturbs (run/rest cancel) on live path
sev: P2
concession: n
ref: reference/src/trap.c:525-526 (disturb(player) before trap messages/effects)
port: packages/core/src/game/trap.ts:431 (env.disturb?.()); packages/core/src/session/game.ts:1343-1350 (trapDeps.env omits disturb though disturb() exists in player-path.ts)
expected: Triggering a trap cancels running/resting/repeating commands.
actual: disturb hook is never installed for traps; run can continue after setting off a trap unless another path cancels it.
why: Running into traps does not stop the player the way C does.
confidence: high

### L9_dungeon-011  only_partial feeling reveal guard not modelled
sev: P3
concession: n
ref: reference/src/cave-view.c:849-854 (feeling_need reveal suppressed when p->upkeep->only_partial after fresh level full update)
port: packages/core/src/world/view.ts:447-456 (documents only_partial not modelled; feeling event can fire once more on level entry)
expected: Initial FOV after new level does not pop the feeling message via the only_partial guard.
actual: Feeling signal may fire on the first full view of a new level when feeling_need is reached immediately.
why: Extra feeling presentation on entry; no mechanical state divergence beyond the message/event.
confidence: high

### L9_dungeon-012  Chunk object-list / player knowledge cave (cave.c list) is structural reshape
sev: P3
concession: n
ref: reference/src/cave.c:438-479 (list_object / delist_object oidx tables); reference/src/cave-map.c:459-489 (square_memorize_traps copies to player->cave)
port: packages/core/src/game/floor.ts (Map piles); packages/core/src/game/trap.ts:10-16,356-383 (VISIBLE flag stands in for player cave trap memory); packages/core/src/game/known.ts (known feat/object maps)
expected: Dual real/known chunk with oidx-linked object lists and trap mirrors.
actual: Flat arrays + GameState maps; knowledge is feature/object known maps + VISIBLE on trap instances.
why: Save/UI structure differs but many live predicates are reimplemented; residual edge cases around imagined objects / trap memory remain possible.
confidence: med

## MAP L9_dungeon
reference/src/cave.c -> packages/core/src/world/chunk.ts (cave_new/feat bookkeeping); packages/core/src/world/scatter.ts (scatter/scatter_ext); packages/core/src/world/flow.ts (noise/scent from game-world, related); packages/core/src/game/floor.ts (list_object/pile half)
reference/src/cave.h -> packages/core/src/world/chunk.ts; packages/core/src/generated/square-flags.ts; packages/core/src/generated/terrain.ts; packages/core/src/generated/terrain-flags.ts
reference/src/cave-map.c -> packages/core/src/game/known.ts (note_spot/memorize/illuminate knowledge); packages/core/src/gen/cave.ts (caveIlluminate flag subset); packages/web/src/main.ts + packages/web/src/mapview.ts (map_info / grid_data_as_text presentation)
reference/src/cave-square.c -> packages/core/src/world/chunk.ts (feat_* + square predicates); packages/core/src/gen/util.ts (gen-time isempty/canputitem/stairs predicates); packages/core/src/game/cave-cmd.ts (isDiggable/secret door); packages/core/src/game/trap.ts (trap square_* predicates)
reference/src/cave-view.c -> packages/core/src/world/view.ts (los, updateView, lighting, CLOSE_PLAYER/VIEW/SEEN)
reference/src/gen-cave.c -> packages/core/src/gen/cave.ts (classic/modified/town/labyrinth/cavern/moria/lair/gauntlet/hard_centre builders, tunnel/streamer, illuminate, profile registry)
reference/src/gen-chunk.c -> packages/core/src/gen/cave.ts (chunk_copy, symmetry helpers used by multi-region); packages/core/src/gen/room.ts (symmetryTransform/vault_chunk); packages/core/src/session/game.ts (chunk_list / persist freeze as levelCache); packages/core/src/gen/generate.ts (chunkValidateObjects)
reference/src/generate.c -> packages/core/src/gen/generate.ts (generateLevel, placeFeeling, feelings, getJoinInfo, collectJoins); packages/core/src/gen/cave.ts (choose_profile / labyrinth_check); packages/core/src/session/game.ts (prepare_next_level / cave_store / quest spawns / town re-entry path)
reference/src/generate.h -> packages/core/src/gen/util.ts (Dun, Gen, SET_*/TYP_*, tunnel/streamer params); packages/core/src/gen/generate.ts; packages/core/src/gen/cave.ts (DunProfile types)
reference/src/gen-monster.c -> packages/core/src/gen/gen-monster.ts (mon_select, mon_restrict, mon_pit_hook, set_pit_type, get_vault_monsters, get_chamber_monsters, spread_monsters)
reference/src/gen-room.c -> packages/core/src/gen/room.ts (room builders, vault/template, nest/pit, chambers, huge, registry); packages/core/src/gen/util.ts (geometry helpers shared with gen-room)
reference/src/gen-util.c -> packages/core/src/gen/util.ts (placement, alloc_*, stairs, player spot, vault helpers, place_object/gold/trap/door)
reference/src/list-dun-profiles.h -> packages/core/src/generated/dun-profiles.ts
reference/src/list-room-flags.h -> packages/core/src/generated/room-flags.ts
reference/src/list-rooms.h -> packages/core/src/generated/rooms.ts
reference/src/list-square-flags.h -> packages/core/src/generated/square-flags.ts
reference/src/list-terrain.h -> packages/core/src/generated/terrain.ts
reference/src/list-terrain-flags.h -> packages/core/src/generated/terrain-flags.ts
reference/src/list-trap-flags.h -> packages/core/src/generated/trap-flags.ts
reference/src/trap.c -> packages/core/src/game/trap.ts (instances, place/hit/reveal/disarm, door locks); packages/core/src/world/trap.ts (bind kinds, lookup_trap)
reference/src/trap.h -> packages/core/src/world/trap.ts; packages/core/src/game/trap.ts; packages/core/src/generated/trap-flags.ts

# ===== L10_world_loop =====

# L10_world_loop audit (world/loop/commands)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: cmd-*, game-event/input/world, debug/wizard/wiz-*, message/option/source/target, list-elements/message/options/parser-errors/randart-properties, hint.h.
Searched packages/ (excl. node_modules, dist, borg).

### L10_world_loop-001  Paralyzed / Knocked Out players can still take turns
sev: P0
concession: n
ref: reference/src/game-world.c:965-968 (process_player: TMD_PARALYZED or Stun "Knocked Out" pushes CMD_SLEEP so the turn is spent doing nothing)
port: packages/core/src/game/player-turn.ts:583-637 (processPlayer never injects sleep; waits on nextCommand); packages/core/src/game/player-turn.ts:538-548 (createDefaultRegistry never registers "sleep")
expected: While paralyzed or Knocked Out, process_player forces a full-energy sleep turn; the player cannot issue other commands until the status ends.
actual: The loop returns INPUT and the shell can push walk/cast/etc. while timed PARALYZED or Knocked Out is still >0. "sleep" is listed in COMMAND_INFO but has no action handler.
why: Paralysis and knockout fail to stop the player; free full turns while disabled is game-breaking.
confidence: high

### L10_world_loop-002  Detection MARK/SHOW fade runs every 10 game turns, not every player turn
sev: P1
concession: n
ref: reference/src/game-world.c:882-908 (process_player_cleanup after energy-using commands: clear MFLAG_NICE, drop MARK if !SHOW, always clear SHOW)
port: packages/core/src/game/loop.ts:357-358,582-583 (tickMonsterMarks only inside processWorld, gated by turn % 10); packages/core/src/game/player-turn.ts:583-637 (processPlayer never calls tickMonsterMarks); packages/core/src/game/known.ts:721-738
expected: Detection markers (MARK/SHOW) and NICE clear once per player energy turn after cleanup.
actual: Fade runs at most once every ten game turns with process_world, so monster detection from detect spells lasts much longer than upstream.
why: ESP/detect feedback and monster visibility after detection spells diverge from C; NICE handling is also delayed.
confidence: high

### L10_world_loop-003  Standing in a web does not clear the web on walk/run/jump
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1287-1297,1328-1336,1369-1377 (do_cmd_walk/jump/run: if square_iswebbed on player grid, msg "You clear the web.", remove web traps, spend move_energy, no move)
port: packages/core/src/game/player-turn.ts:382-469 (walkAction never checks web on current grid); packages/core/src/game/player-path.ts:831-855 (runStep goes straight to walkAction); packages/core/src/game/cave-cmd.ts:615-617 (documents web clear still on base action)
expected: Any walk/jump/run while standing on a web spends the turn clearing the web and does not move.
actual: Player can walk out of webs freely; web only matters if terrain/trap code elsewhere treats it as impassable (it is not).
why: Web traps (monster-spun) never pin the player; a normal dungeon hazard is inert.
confidence: high

### L10_world_loop-004  Walk onto known disarmable traps always triggers (no disarm-on-walk)
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1311-1312 (do_cmd_walk: move_player(dir, !(disarmable && trapsafe))); reference/src/cmd-cave.c:1079-1083 (move_player: known disarmable trap + disarm true -> do_cmd_alter_aux, not step)
port: packages/core/src/game/player-turn.ts:457-481 (walk/jump share body; documents disarm-on-walk deferred; onPlayerMoved -> hit_trap on any step); packages/core/src/game/cave-cmd.ts:615-618
expected: Default walk into a known, enabled player trap auto-disarms (alter) unless trapsafe/jump; jump deliberately steps on.
actual: Every walk onto a trap triggers it; jump is identical to walk.
why: Default walk into visible traps always sets them off instead of attempting disarm.
confidence: high

### L10_world_loop-005  Stair depth uses +/-1; ignores stair_skip and dungeon_get_next_level
sev: P1
concession: n
ref: reference/src/cmd-cave.c:76,103 (ascend_to/descend_to = dungeon_get_next_level(player, depth, +/-1)); reference/src/player-util.c:54-73 (target = dlev + added * stair_skip, quest intermediate check, clamp)
port: packages/core/src/game/cave-cmd.ts:817-849 (targetDepth = depth + 1 / depth - 1 only)
expected: One stair hop advances by z_info->stair_skip levels (default 1) and stops early on quest levels between.
actual: Always changes depth by exactly 1; no quest intermediate stop, no stair_skip scaling.
why: With non-default stair_skip or quests between depths, destination level and quest encounter order diverge from C. Default stair_skip=1 masks the hop size but still misses quest stops.
confidence: high

### L10_world_loop-006  Stair commands omit force_descend and max-depth guards
sev: P1
concession: n
ref: reference/src/cmd-cave.c:70-74 (birth_force_descend: "Nothing happens!" on go_up); reference/src/cmd-cave.c:115-128 (max_depth-1 refuse; force_descend recalculates descend_to from max_depth and quest confirm); reference/src/cmd-cave.c:78-80 (cannot ascend when next level == current)
port: packages/core/src/game/cave-cmd.ts:817-849 (only feature-underfoot and depth===0 up checks)
expected: Force-descend blocks up stairs; deepest level blocks down; force-descend from shallower than max uses max_depth path with quest warning.
actual: Up works from any non-zero depth with an up stair; down works at max_depth-1; force_descend birth option is ignored on stairs.
why: Birth option force descent and bottom-of-dungeon rules are dead on the live stair path.
confidence: high

### L10_world_loop-007  Deep Descent failure never runs EF_DESTRUCTION
sev: P1
concession: n
ref: reference/src/game-world.c:815-830 (deep_descent hits 0: if target not deeper, msg explosion then effect_simple(EF_DESTRUCTION, ... "0", radius 5))
port: packages/core/src/game/loop.ts:476-493 (else branch only state.msg "You are thrown back in an explosion!"; comment says destruction "rides that handler" but nothing invokes it)
expected: At deepest reachable depth, deep descent explodes with *destruction* effects (terrain/monsters/objects).
actual: Message only; no destruction effect, no RNG for the effect chain.
why: Bottom-of-dungeon Deep Descent is a free no-op instead of a dangerous fail.
confidence: high

### L10_world_loop-008  Deep Descent target omits stair_skip multiply and quest intermediates
sev: P1
concession: n
ref: reference/src/game-world.c:817-819 (target_increment = (4/stair_skip)+1; target_depth = dungeon_get_next_level(player, max_depth, target_increment) => max_depth + increment*stair_skip with quest scan)
port: packages/core/src/game/loop.ts:480-484 (targetDepth = min(maxDepth + increment, maxDepth-1) without * stair_skip); packages/core/src/game/effect-general.ts:646-648 (same formula when arming)
expected: Destination = dungeon_get_next_level(max_depth, (4/stair_skip)+1), including stair_skip multiply and intermediate quest levels.
actual: Adds the increment once with no * stair_skip and no quest stop. Default stair_skip=1 makes hop size match but still skips quest intermediate logic.
why: Deep Descent landing depth can desync from C whenever stair_skip != 1 or a quest lies between max and target.
confidence: high

### L10_world_loop-009  Word of Recall from town skips player_set_recall_depth
sev: P1
concession: n
ref: reference/src/game-world.c:801-804 (from town: player_set_recall_depth then change to recall_depth); reference/src/player-util.c:79-92 (force_descend may bump recall to next below max; always MAX(recall, 1))
port: packages/core/src/game/loop.ts:466-470 (always p.recallDepth = p.maxDepth; targetDepth = that)
expected: Recall depth respects force_descend next-level bump and minimum depth 1 via player_set_recall_depth.
actual: Always maxDepth only; force_descend never advances one more level; no quest-aware next-level helper.
why: birth_force_descend recall destinations wrong; any prior recall_depth bookkeeping is overwritten without C's rules.
confidence: high

### L10_world_loop-010  on_new_level does not announce feeling or run search
sev: P1
concession: n
ref: reference/src/game-world.c:1047-1052 (on_new_level: if depth, display_feeling(false); then search(player))
port: packages/core/src/session/game.ts:2066-2073 (changeLevel end: updateBonuses + updateFov only); packages/web/src/main.ts:5291-5296 (LEVEL_CHANGE only changeLevel; no displayFeeling); packages/web/src/main.ts:3311-3316 (^F only)
expected: Every dungeon level entry auto-prints the feeling line and runs incidental search on the landing square.
actual: Feeling only on manual ^F; search() has no port; arrival is silent on both.
why: Level-entry feedback and free search on stairs/recall missing in normal play.
confidence: high

### L10_world_loop-011  Deeper level does not update recall_depth with max_depth
sev: P2
concession: n
ref: reference/src/game-world.c:1023-1025 (if max_depth < depth then max_depth = recall_depth = depth)
port: packages/core/src/session/game.ts:1859-1862 (only maxDepth = depth; no recallDepth assignment anywhere in game.ts)
expected: Reaching a new deepest depth sets both max_depth and recall_depth.
actual: Only maxDepth updates; recallDepth stays at prior value until some other path overwrites it.
why: Recall bookkeeping and displays that read recallDepth can lag max depth until a WoR activation path rewrites them.
confidence: high

### L10_world_loop-012  do_cmd_alter missing trap, chest, and close-door branches
sev: P1
concession: n
ref: reference/src/cmd-cave.c:974-999 (alter_aux: mon / diggable / closed door / disarmable trap / trapped chest / open chest / open door close / else spin)
port: packages/core/src/game/cave-cmd.ts:797-814 (alter: mon / diggable / closed door / else "You spin around." only)
expected: '+' alter disarms traps, opens/disarms chests, and closes open doors on the target grid.
actual: Those targets only spin; dedicated open/disarm commands still work, but alter is incomplete vs C (and walk uses alter_aux for doors/traps upstream).
why: Alter command and any path relying on full alter_aux (including faithful walk trap path) cannot match C.
confidence: high

### L10_world_loop-013  PF_SEE_ORE free detect-every-turn missing from process_player
sev: P1
concession: n
ref: reference/src/game-world.c:952-962 (process_player each turn: if PF_SEE_ORE and not image/confused/amnesia/stun/paralyzed/terror/afraid, effect_simple(EF_DETECT_ORE, ... range 3,3))
port: packages/core/src/game/player-turn.ts:583-637 (no SEE_ORE / DETECT_ORE call); packages/core/src/game/effect-detect.ts:291-292 (handler exists but not driven from the loop)
expected: Dwarves (and other SEE_ORE races) get a free ore detect pulse every player turn while clear-headed.
actual: SEE_ORE never fires on the live turn path; ore sense only if some other effect invokes DETECT_ORE.
why: Signature Dwarf racial ability is dead in normal play.
confidence: high

### L10_world_loop-014  Running first step into an adjacent known trap is not stopped
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1084-1088 (move_player: trap && running && !trapsafe -> disturb, energy_use=0, no step)
port: packages/core/src/game/player-path.ts:853-855 (runStep always walkAction); packages/core/src/game/player-turn.ts:457-465 (walkAction always moves then onPlayerMoved)
expected: Running toward a known trap stops before entering the grid and spends no energy.
actual: The first run step onto a visible trap walks in and triggers it; run_test only inspects after successful steps.
why: Running into known traps is unsafe vs C; same root as missing move_player trap/run branches.
confidence: high

### L10_world_loop-015  Leaving a DTRAP region while running does not abort the step
sev: P2
concession: n
ref: reference/src/cmd-cave.c:1146-1153 (move_player: running && !firststep && old_dtrap && !new_dtrap -> disturb, energy 0, return)
port: packages/core/src/game/player-turn.ts:382-469 (no SQUARE.DTRAP edge check); packages/core/src/game/player-path.ts (firstStep tracked but never used for dtrap)
expected: Runs stop at the edge of a detect-traps region without spending the exit step.
actual: Runs freely leave DTRAP areas; only the status display shows DTRAP.
why: Detect-traps border no longer interrupts running as in upstream.
confidence: high

### L10_world_loop-016  Core rest command is a single hold turn; sleep unregistered
sev: P1
concession: n
ref: reference/src/cmd-cave.c:1619-1668 (do_cmd_rest multi-turn with special REST_* counts and cmdq re-push); reference/src/cmd-cave.c:1675-1678 (do_cmd_sleep spends move_energy)
port: packages/core/src/game/player-turn.ts:487-548 (rest -> holdAction one move_energy; sleep not registered); packages/web/src/main.ts:3506+ (driveRest implements rest only in the web shell)
expected: Engine rest is multi-turn with REST_COMPLETE/ALL_POINTS/SOME_POINTS; sleep is a real energy command for paralysis path.
actual: Core registry rest is one idle turn; full rest lives only in web driveRest outside processPlayer; sleep has no handler (see also -001).
why: Non-web hosts and any path that dispatches registry "rest"/"sleep" diverge; paralysis path has no sleep target.
confidence: high

### L10_world_loop-017  Word of Recall / Deep Descent fire without disturb or command-queue flush
sev: P2
concession: n
ref: reference/src/game-world.c:794-795,820 (disturb + cmdq_flush on recall; disturb on deep descent)
port: packages/core/src/game/loop.ts:460-493 (sets generateLevel/targetDepth and messages only)
expected: Pending rest/run/repeats cancel and queue flushes so no extra action is lost or applied on the new level.
actual: generateLevel is set without disturb()/cmdq_flush equivalents on this path (web may clear some state later).
why: Recall/descent can leave rest/run/queued cmds in a dirty state across the level change.
confidence: med

### L10_world_loop-018  Tunnel success/fail messages drop "with your weapon/swap digger" clause
sev: P3
concession: n
ref: reference/src/cmd-cave.c:595-638 (messages include with_clause: hands / weapon / swap digger)
port: packages/core/src/game/cave-cmd.ts:418-459 (fixed strings without with_clause)
expected: "You have finished the tunnel with your weapon." (etc.)
actual: "You have finished the tunnel." / "You dig in the rubble." without digger phrase.
why: Visible message drift on a common action; minor.
confidence: high

### L10_world_loop-019  pack_overflow not run in process_player
sev: P2
concession: n
ref: reference/src/game-world.c:946-947 (process_player: pack_overflow(NULL) every command cycle)
port: packages/core/src/game/player-turn.ts:583-637 (no pack overflow); packages/core/src/game/gear.ts:20,387 (pack_overflow DEFERRED)
expected: Overfull pack auto-drops to floor before each command with the upstream messages/energy rules.
actual: Pack can remain over capacity until some other path forces it; no process_player overflow.
why: After forced overfill (e.g. some pickups), inventory state diverges until manual drop.
confidence: high

### L10_world_loop-020  hint.h store-hint list has no runtime port counterpart
sev: P3
concession: n
ref: reference/src/hint.h (struct hint; extern hints); store.c uses hints
port: packages/content/src/specs/init.ts:261 (hintsSpec parses data only); no packages/core consumer of a live hints linked list
expected: Runtime hint chain available for store/UI random tips as upstream.
actual: Data may be parsed into content packs but no core/source equivalent of the hint list API is used in play.
why: Store/hint flavor text path incomplete; low gameplay impact.
confidence: med

## MAP L10_world_loop
reference/src/cmd-cave.c -> packages/core/src/game/cave-cmd.ts, packages/core/src/game/player-turn.ts, packages/core/src/game/steal.ts, packages/core/src/game/player-path.ts (run/explore/pathfind), packages/web/src/main.ts (rest driveRest)
reference/src/cmd-core.c -> packages/core/src/cmd.ts, packages/core/src/game/player-turn.ts (processPlayer / bloodlust coercion)
reference/src/cmd-core.h -> packages/core/src/cmd.ts
reference/src/cmd-misc.c -> packages/core/src/game/wizard.ts (wizard entry), packages/web/src/main.ts (retire/note partial), packages/web/src/wizard.ts
reference/src/cmd-obj.c -> packages/core/src/game/obj-cmd.ts, packages/core/src/game/spell-cmd.ts (cast/study)
reference/src/cmd-pickup.c -> packages/core/src/game/pickup.ts
reference/src/cmds.h -> packages/core/src/cmd.ts (CommandCode / COMMAND_INFO)
reference/src/cmd-spoil.c -> packages/cli/src/spoilers.ts, packages/cli/src/main-spoil.ts
reference/src/cmd-wizard.c -> packages/core/src/game/wizard.ts, packages/web/src/wizard.ts, packages/cli/src/wiz-stats.ts (collect_*)
reference/src/debug.c -> NONE (no debug() facade; console/logging ad hoc)
reference/src/debug.h -> NONE
reference/src/game-event.c -> packages/core/src/events.ts
reference/src/game-event.h -> packages/core/src/events.ts
reference/src/game-input.c -> packages/web/src/overlay.ts (getCheck/getAimDir/...), packages/web/src/main.ts, packages/core/src/session/game.ts (injected getItem hooks)
reference/src/game-input.h -> packages/web/src/overlay.ts, packages/core/src/session/game.ts (seams; no single game-input module)
reference/src/game-world.c -> packages/core/src/game/loop.ts, packages/core/src/game/world.ts, packages/core/src/game/scheduler.ts, packages/core/src/game/energy.ts, packages/core/src/session/game.ts (on_new_level/changeLevel)
reference/src/game-world.h -> packages/core/src/game/loop.ts, packages/core/src/game/world.ts, packages/core/src/game/energy.ts
reference/src/hint.h -> packages/content/src/specs/init.ts (hintsSpec parse only); runtime list NONE
reference/src/list-elements.h -> packages/core/src/generated/elements.ts
reference/src/list-message.h -> packages/core/src/generated/message.ts
reference/src/list-options.h -> packages/core/src/generated/options.ts
reference/src/list-parser-errors.h -> packages/core/src/generated/parser-errors.ts
reference/src/list-randart-properties.h -> packages/core/src/generated/randart-properties.ts
reference/src/message.c -> packages/core/src/msg.ts, packages/web/src/messages.ts
reference/src/message.h -> packages/core/src/msg.ts, packages/core/src/generated/message.ts
reference/src/option.c -> packages/core/src/player/options.ts, packages/web/src/options.ts
reference/src/option.h -> packages/core/src/player/options.ts, packages/core/src/generated/options.ts
reference/src/source.c -> packages/core/src/effects/interpreter.ts (sourceNone/Player/Monster/Trap/Object/ChestTrap)
reference/src/source.h -> packages/core/src/effects/interpreter.ts
reference/src/target.c -> packages/core/src/game/target.ts, packages/core/src/game/target-loop.ts
reference/src/target.h -> packages/core/src/game/target.ts
reference/src/wizard.h -> packages/core/src/game/wizard.ts
reference/src/wiz-debug.c -> packages/core/src/game/wizard.ts (wiz_cheat_death / cure paths)
reference/src/wiz-spoil.c -> packages/cli/src/spoilers.ts
reference/src/wiz-stats.c -> packages/cli/src/wiz-stats.ts, packages/cli/src/stats.ts

# ===== L11_stores =====

# L11_stores audit (stores/shops — store.c / store.h)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: reference/src/store.c, reference/src/store.h.
Searched packages/ (excl. node_modules, dist, borg) for real implementors.

### L11_stores-001  Home retrieve is routed through storeBuy and charges gold
sev: P0
concession: n
ref: reference/src/ui-store.c:729-733 (store_purchase pushes CMD_RETRIEVE for FEAT_HOME); reference/src/store.c:1783-1852 (do_cmd_retrieve: no price_item, no au change)
port: packages/core/src/session/game.ts:2525-2528 (buy always calls storeBuy); packages/core/src/store/transact.ts:120-186 (storeBuy always priceItem + player.au -= price); packages/web/src/shop.ts:732-749 (Home Take uses game.buy, then "You bought ... for N gold")
expected: Retrieving from the Home copies the stack into the pack for free (do_cmd_retrieve); no gold, no ORIGIN_STORE stamp, no empty-store restock/shuffle.
actual: Live Home "Take/Buy" calls storeBuy: charges full shop sell price, can refuse with cannot-afford, stamps ORIGIN_STORE, and on emptying the home may one_in_(store_shuffle) + store_maint x10 (maint is a no-op for home but still draws RNG for the shuffle chance). homeRetrieve exists and is unit-tested but is not wired into StartedGame.buy.
why: The Home is paid storage / a gold sink; high-value stashes can be unrecoverable without enough au. Core free-stash path is dead on the play path.
confidence: high

### L11_stores-002  Home stash is routed through storeSell/storeCarry, not home_carry
sev: P0
concession: n
ref: reference/src/ui-store.c:577-581 (Home pushes CMD_STASH); reference/src/store.c:2009-2074 (do_cmd_stash -> home_carry); reference/src/store.c:870-894 (home_carry: OSTACK_PACK merge, accept any object, no value gate, no fuel/timeout rewrite)
port: packages/core/src/session/game.ts:2530-2543 (sell always storeSell); packages/core/src/store/transact.ts:297-353 (sellObject -> storeCarry(..., true)); packages/core/src/store/store.ts:346-399 (storeCarry: object_value_real gate, erase note, reset light fuel / timeouts, OSTACK_STORE merge); packages/web/src/shop.ts:795-811 (Home drop uses game.sell)
expected: Stashing uses home_carry: free, accepts worthless gear, pack-style stacking, no shop maintenance rewrites of fuel/charges.
actual: Live Home drop uses do_cmd_sell economics/path: store_carry rejects value_real <= 0 after gear_object_for_use already detached the stack (item is lost), wipes inscriptions, refills torches/lamps, clears rod timeouts, merges with OSTACK_STORE. homeStash/homeCarry are implemented and tested but not used by StartedGame.sell.
why: Worthless or shop-rejected home drops silently destroy gear; home stacking and item state diverge from C.
confidence: high

### L11_stores-003  Town store init burns an extra owner RNG draw per store
sev: P1
concession: n
ref: reference/src/store.c:340-357 (store_reset: owner starts NULL from store_init zalloc; store_shuffle does one store_choose_owner because while (o == store->owner) with o non-NULL exits); reference/src/store.c:1478-1501
port: packages/core/src/store/store.ts:140-170 (bindStoreRuntime always storeChooseOwner); packages/core/src/store/store.ts:665-671 (storeReset always storeShuffle again until owner identity differs); packages/core/src/store/store.ts:679-690 (createTownStores = bind all + storeReset); packages/core/src/session/game.ts:2133-2142 (live first town visit)
expected: First owner selection is a single randint0(n_owners) per store, then store_maint x10 consumes the same stream for stock.
actual: Each store draws owner once at bind, then store_shuffle draws again until a different owner object is chosen (always at least one more draw; expected ~n/(n-1) with n=4). All subsequent mass_produce / create_random / delete_random draws for initial stock are offset vs C for the same seed.
why: Town shopkeepers and the entire initial stock RNG stream diverge from upstream on every new game.
confidence: high

### L11_stores-004  Shop flavor comments use display Math.random, not the game RNG
sev: P1
concession: n
ref: reference/src/store.c:1717 (do_cmd_buy: one_in_(3) then ONE_OF(comment_accept) on the main RNG before empty-store restock); reference/src/store.c:491-508,1972 (purchase_analyze ONE_OF on main RNG); reference/src/ui-store.c:139-177 (prt_welcome one_in_ / randint draws on main RNG)
port: packages/web/src/shop.ts:180-190 (flavorPick/flavorOneIn = Math.random); packages/web/src/shop.ts:201-217 (prtWelcome); packages/web/src/shop.ts:745-748 (comment_accept after game.buy returns); packages/web/src/shop.ts:818-822 (sale reaction comments)
expected: Welcome, accept, and purchase_analyze lines advance z-rand; comment_accept is drawn inside do_cmd_buy before any empty-store shuffle/maint.
actual: All three use Math.random (zero game-RNG cost). comment_accept is emitted in the shell after storeBuy returns, so when a purchase empties the shop the C order is accept-draw then shuffle/maint, while the port runs shuffle/maint first with no accept draws on state.rng.
why: Any shop visit that prints flavor desyncs the subsequent game RNG stream (and empty-store restock order) from C; not a browser necessity.
confidence: high

### L11_stores-005  Empty-store restock omits shopkeeper retire / new-stock messages
sev: P2
concession: n
ref: reference/src/store.c:1756-1771 (if stock_num==0 after a reducing sale: one_in_(store_shuffle) -> "The shopkeeper retires." + shuffle, else "The shopkeeper brings out some new stock."; then maint x10)
port: packages/core/src/store/transact.ts:176-183 (shuffle chance + maint x10, no messages); packages/web/src/shop.ts:732-750 (only "You bought ... for N gold")
expected: Player sees the retire or new-stock line when a real shop is cleaned out.
actual: Restock still runs; messages are missing.
why: Visible store feedback on a dramatic stock wipe is gone.
confidence: high

### L11_stores-006  Live store_will_buy always treats runes as unknown
sev: P1
concession: n
ref: reference/src/store.c:531-536 (store_will_buy: worthless OK under birth_no_selling only when tval_has_variable_power && !object_runes_known(obj))
port: packages/core/src/session/game.ts:2511-2523 (txnKnow never sets runesKnown); packages/core/src/session/game.ts:2577-2580 (willBuy passes runesKnown=false); packages/core/src/store/transact.ts:312 (storeSell uses know.runesKnown ?? false)
expected: After runes are known, a worthless variable-power item is refused even with birth_no_selling.
actual: Live filter and sell path always pass runesKnown=false, so the no-selling exception stays open forever for those tvals.
why: birth_no_selling shop acceptance diverges once the player has identified the item.
confidence: high

### L11_stores-007  Buy/sell omit the full rune-learn loop
sev: P1
concession: n
ref: reference/src/store.c:1737-1742 (do_cmd_buy: object_flavor_aware then while (!object_fully_known) learn_unknown_rune + player_know_object); reference/src/store.c:1948-1953 (do_cmd_sell: same on the sold stack before gear_object_for_use)
port: packages/core/src/store/transact.ts:166-170,331-335 (only optional objectFlavorAware; comments mark rune loop DEFERRED)
expected: Transacting an item fully teaches every unknown rune on that object (and buy fully IDs the purchased copy).
actual: Flavor may become known; runes are not force-learned on the transaction path.
why: Items bought or sold can remain partially unknown vs C, changing later {??} / ego knowledge / power use.
confidence: high

### L11_stores-008  Maintenance deletes of store artifacts skip history_lose_artifact
sev: P1
concession: n
ref: reference/src/store.c:1090-1092 (store_delete_random: if obj->artifact history_lose_artifact); reference/src/store.c:1306-1310 (black-market cull of non-ok stock: same)
port: packages/core/src/store/store.ts:424-447 (storeDeleteRandom: no history hook); packages/core/src/store/store.ts:580-586 (black market cull: storeDelete only)
expected: When turnover or BM cleanup destroys an artifact the player previously sold into stock, character history records the loss.
actual: Artifact is removed from stock with no onArtifactLost / history_lose_artifact call (sell-reject path does fire onArtifactLost; maintenance does not).
why: Sold-then-turned-over artifacts vanish from history parity (and any UI that surfaces lost arts).
confidence: high

### L11_stores-009  store_will_buy flag-qualified buy rules skip object_flag_is_known
sev: P3
concession: n
ref: reference/src/store.c:549-552 (buy->flag set: require of_has && object_flag_is_known(player, obj, flag))
port: packages/core/src/store/store.ts:234-238 (if buy.flag and obj.flags.has(flag) return true; object_flag_is_known deferred)
expected: Flag-qualified buy entries only accept items the player already knows have that flag.
actual: Any object that merely carries the flag is accepted, even if the flag is unknown to the player.
why: Baseline store.txt uses only bare buy: tval lines (flag 0), so unreached in default data; mods using buy-flag would leak acceptance.
confidence: high

### L11_stores-010  store_carry always uses object_value_real (drops carried-object branch)
sev: P3
concession: n
ref: reference/src/store.c:921-925 (if object_is_carried(player, obj) value = object_value; else object_value_real)
port: packages/core/src/store/store.ts:356-360 (always objectValueReal)
expected: A still-carried object would be valued by apparent object_value when offered to store_carry.
actual: Always real value. Live do_cmd_sell detaches via gear_object_for_use before store_carry, so the carried branch is unused on the normal sell path (same as C in practice for sells).
why: Dead-branch divergence only; no normal-play impact unless a future caller passes a still-carried object.
confidence: med

## MAP L11_stores
reference/src/store.c -> packages/core/src/store/store.ts (maint, stock, will_buy, mass_produce, carry, reset/update/shuffle); packages/core/src/store/price.ts (price_item); packages/core/src/store/transact.ts (do_cmd_buy/sell/retrieve/stash, home_carry, purchase_analyze); packages/core/src/store/bind.ts (init_parse_stores / store_at-by-feat binding); packages/core/src/store/types.ts (struct store/owner/object_buy); packages/core/src/session/game.ts (createTownStores / storeUpdate / live buy-sell wiring); packages/web/src/shop.ts (ui-store presentation over store APIs: find_inven, store_stock_list, comments, runStore); packages/content/src/specs/misc.ts (store.txt FileSpec)
reference/src/store.h -> packages/core/src/store/types.ts; packages/core/src/store/store.ts; packages/core/src/store/price.ts; packages/core/src/store/transact.ts; packages/core/src/store/bind.ts (API surface for structs and exported store_* / do_cmd_*)

# ===== L12_saveload =====

# L12_saveload audit (save/load - save.c / load.c / savefile / save-charoutput)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: reference/src/load.c, save.c, save-charoutput.c, save-charoutput.h,
savefile.c, savefile.h.
Searched packages/ (excl. node_modules, dist, borg) for real implementors.

Live path: packages/core/src/session/save.ts (JSON serializeGame/loadGame) +
packages/core/src/save/integrity.ts (stamp trailer) + packages/web/src/main.ts
(localStorage roster). Binary primitives in packages/core/src/save/buffer.ts are
unit-tested only and are NOT used by the play save path (PORT_PLAN decision 9).

### L12_saveload-001  Monster known_pstate (AI learn memory) is not persisted
sev: P1
concession: n
ref: reference/src/save.c:231-235 (wr_monster writes known_pstate.flags[OF_SIZE] and known_pstate.el_info[ELEM_MAX].res_level); reference/src/load.c:301-305 (rd_monster restores both); reference/src/list-options.h:94-95 (birth_ai_learn default true)
port: packages/core/src/session/save.ts:319-368 (SavedMonster / serializeMonster omit knownPstate); packages/core/src/session/save.ts:371-408 (deserializeMonster leaves blankMonster empty knownPstate); packages/core/src/mon/monster.ts:47-54,118-122
expected: On save/load, each live monster retains the OF flags and elemental resist levels it has learned about the player (birth_ai_learn ON by default). C does not persist known_pstate.pflags (upstream gap; port matching that omission for pflags alone is correct).
actual: serializeMonster never writes flags/elInfo; deserializeMonster rebuilds from blankMonster, so every reload wipes smart-learn memory. remove_bad_spells / mon-ranged then treats the player as fully unknown again until re-learning draws resume.
why: Default birth option; post-reload monster spell choice and "forget 1/20" stream diverge from C for every long fight that crossed a save.
confidence: high

### L12_saveload-002  SIDEBAR_MODE is a global pref, not a per-character save field
sev: P2
concession: n
ref: reference/src/save.c:322-323 (wr_options: wr_byte SIDEBAR_MODE); reference/src/load.c:442-449 (rd_options restores SIDEBAR_MODE into the term when present)
port: packages/web/src/main.ts:856-881 (SIDEBAR_MODE_KEY in localStorage, not encodeSavedGame); packages/core/src/player/options.ts:204-212 (OptionState.snapshot has hitpointWarn/delayFactor/lazymoveDelay but no sidebar)
expected: Sidebar layout (Left/Top/None) is part of the character options block and round-trips with that savefile.
actual: Sidebar mode is a host-global localStorage key shared by every roster slot. Switching characters inherits the last character's sidebar; a transferred save does not carry it.
why: Visible UI chrome diverges from C per-character option semantics; not forced by the browser (could live in SavedGame.options or roster meta).
confidence: high

### L12_saveload-003  save_charoutput / CharOutput.txt has no port
sev: P3
concession: y
ref: reference/src/save-charoutput.c:25-48 (save_charoutput writes ANGBAND_DIR_USER/CharOutput.txt with race/class/mapName/dLvl/cLvl/isDead/killedBy); reference/src/savefile.c:391-392 (savefile_save always calls save_charoutput)
port: NONE
expected: Every successful save also refreshes CharOutput.txt (angband.live synopsis).
actual: No CharOutput writer, no equivalent export on persistSave. Roster meta (web/src/roster.ts / metaFromState) carries name/race/class/level/depth/alive for the in-app picker only.
why: angband.live / external tools cannot scrape a fixed synopsis file; browser has no ANGBAND_DIR_USER filesystem. Unavoidable as a raw path write; a downloadable/exportable equivalent is not implemented.
confidence: high

### L12_saveload-004  Live save format is JSON, not C block binary (by design)
sev: P3
concession: y
ref: reference/src/savefile.c:79-155,325-379 (magic "Save" + variant "VNLA" + named blocks with 28-byte headers, additive checksum, 'x' pad); reference/src/save.c / load.c (wr_*/rd_* payload bodies)
port: packages/core/src/session/save.ts:1-18,70,985-1146,1576-1582 (SAVE_VERSION JSON + stampSavefile); packages/web/src/main.ts:3714 (encodeSavedGame into localStorage)
expected: On-disk save is the 4.2.x block binary; old Angband saves would load (parity baseline does not require import of old files per PORT_PLAN decision 2/9).
actual: Live path writes versioned JSON (entity graph + namespaced ids) stamped with an FNV-1a trailer. Binary framing in packages/core/src/save/buffer.ts is implemented and unit-tested but not wired to serializeGame/saveGame. Upstream savefiles cannot load (explicit decision 9).
why: Browser/mod-lifecycle design choice (PORT_PLAN decision 9); not a silent bug. Semantic field coverage is audited separately; this records the format divergence.
confidence: high

### L12_saveload-005  Binary writeSavefile stamp is a numeric version, not variant "VNLA"
sev: P3
concession: n
ref: reference/src/savefile.c:81-82,405-406 (savefile_name = {'V','N','L','A'}; written as the second 4 bytes after magic)
port: packages/core/src/save/buffer.ts:207-209 (writeSavefile writes writeU32LE(out, version) after magic)
expected: Bytes 4..7 of a framed save are always ASCII "VNLA" (variant id). Versioning is per-block, not in the file header.
actual: writeSavefile puts a little-endian integer version (tests use 7, 1). readSavefile accepts any u32 and does not require "VNLA". Dead for the live path, but the module claims a faithful savefile.c framing port.
why: Any future use of buffer writeSavefile/readSavefile as a C-compatible interchange will fail header checks in real Angband.
confidence: high

### L12_saveload-006  No panic-save path (savefile_get_panic_name)
sev: P3
concession: y
ref: reference/src/savefile.h:53; reference/src/savefile.c:671-679 (savefile_get_panic_name builds ANGBAND_DIR_PANIC path)
port: NONE (web uses pagehide/visibilitychange autosave to the same roster slot: packages/web/src/main.ts:3722-3733,5799-5802)
expected: Crash / panic path can write a distinct panic save under the panic directory without clobbering the main savefile name resolution.
actual: No panic directory or alternate panic filename. Tab close / hide force-autosaves into the active slot (best-effort localStorage).
why: Browser has no crash-signal panic dir; forced autosave is the practical substitute. Logged as a missing API surface.
confidence: high

### L12_saveload-007  deserializeObject activation ignores ego.activation
sev: P3
concession: n
ref: reference/src/save.c:185-188 (wr_item writes obj->activation->index or 0); reference/src/load.c:223-227 (rd_item restores &activations[tmp16u]); reference/src/obj-make.c ego path (ego activation trumps object)
port: packages/core/src/session/save.ts:239-241 (activation: (artifact ? artifact.activation : null) ?? kind.activation); packages/core/src/obj/make.ts:625-629 (egoApplyMagic sets obj.activation = ego.activation)
expected: Load restores the activation pointer that was on the object (artifact, ego, or kind), matching the saved index.
actual: Re-derive is artifact.activation ?? kind.activation only; ego.activation is never consulted. Base 4.2.6 ego_item.txt has zero act: lines (impact is latent), but any mod ego or future data with activations would lose *activate* after reload while time still round-trips.
why: Incomplete re-derive vs C; low current content impact, real for mods.
confidence: high

### L12_saveload-008  History aIdx is a raw numeric index, not an artifact name
sev: P3
concession: n
ref: reference/src/save.c:1063-1067 (wr_history: artifact name string or ""); reference/src/load.c history loader (lookup by name)
port: packages/core/src/session/save.ts:562 (hist: p.hist.map spread, aIdx as number); packages/core/src/player/history.ts:37 (aIdx: number)
expected: History artifact references survive pack reorder via stable name (C) or namespaced id (port's SAVE_VERSION 2 rule for other content).
actual: hist[].aIdx is the runtime aidx integer with no ContentIdResolver remap. Same-pack reloads match; reordered/extended artifact tables can retarget LOST/FOUND lines.
why: Diverges from both C name stability and the port's own namespaced-id save rule used for objects/artifacts elsewhere.
confidence: high

## MAP L12_saveload
reference/src/load.c -> packages/core/src/session/save.ts (deserialize* / loadGame in packages/core/src/session/game.ts); packages/core/src/save/buffer.ts (rd_* primitives only; not live path)
reference/src/save.c -> packages/core/src/session/save.ts (serialize* / saveGame in packages/core/src/session/game.ts); packages/core/src/save/buffer.ts (wr_* primitives only; not live path)
reference/src/save-charoutput.c -> NONE
reference/src/save-charoutput.h -> NONE
reference/src/savefile.c -> packages/core/src/save/buffer.ts (framing primitives); packages/core/src/save/integrity.ts (port-only stamp); packages/core/src/session/save.ts + packages/core/src/session/game.ts (savefile_save/load semantics: JSON live path); packages/web/src/main.ts + packages/web/src/roster.ts (storage, character list meta, autosave)
reference/src/savefile.h -> packages/core/src/save/buffer.ts; packages/core/src/session/save.ts; packages/core/src/session/game.ts (LoadGameOptions.wizard = cheat_death)

# ===== L13_score_death =====

# L13_score_death audit (scoring / death / history types)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: reference/src/list-history-types.h, score.c, score.h, score-util.c.
Searched packages/ (excl. node_modules, dist, borg) for real implementors.

Live path: packages/core/src/score/{types,score,display}.ts (formula, table ops,
gating, row strings) + packages/web/src/score.ts (localStorage ScoreStore +
Hall of Fame screen) + packages/web/src/main.ts LOOP_STATUS.DEAD (enterScore
call site). History type enum: packages/core/src/generated/history-types.ts
(codegen from list-history-types.h); history runtime is player/history.ts
(player-history.c, not a lane ref file).

### L13_score_death-001  Winner retirement never stamps WINNING_HOW or death_knowledge bonuses before enter_score
sev: P1
concession: n
ref: reference/src/player-util.c:288-294 (death_knowledge: if total_winner then depth=0, died_from=WINNING_HOW, exp=max_exp, lev=max_lev, au+=10000000); reference/src/player-util.c:313 (enter_score after that prep); reference/src/score.h:37 (WINNING_HOW "Ripe Old Age"); reference/src/score.c:309 (build_score uses p->died_from); reference/src/score-util.c:59-63,284-307 (winners sort before non-winners via how==WINNING_HOW)
port: packages/web/src/main.ts:3371-3374 (retire sets diedFrom="Retiring" only); packages/web/src/main.ts:5260-5282 (DEAD path: historyUnmaskUnknown + enterScore with player.diedFrom as-is; no winner prep); packages/core/src/score/score.ts:77-93,264-284 (buildScore/enterScore faithfully use the how string they are given)
expected: A total_winner who retires is prepped by death_knowledge so the high-score record has how="Ripe Old Age", cur_dun=0, cur_lev=max_lev, gold includes +10000000, and highscore_where/cmp place that record ahead of every non-winner.
actual: Retire keeps diedFrom="Retiring" and totalWinner true (so the Retiring gate is bypassed and the score IS entered), but how stays "Retiring", depth/lev/au are not adjusted. Sorting treats the victory like any other death cause; gold and town-level display are wrong. WINNING_HOW exists only in types/sort helpers and is never written on the live path.
why: The canonical victory high-score path (retire after winning) produces wrong rank order and wrong Hall-of-Fame lines; total_points formula is unaffected (pts ignores gold) but winner precedence is how-based.
confidence: high

### L13_score_death-002  enter_score rejection messages are discarded on the live death path
sev: P2
concession: n
ref: reference/src/score.c:283-304 (msg "Score not registered for cheaters." / "for wizards." / "due to interruption." / "due to retiring." + EVENT_MESSAGE_FLUSH on each reject branch)
port: packages/core/src/score/score.ts:264-277 (enterScore returns {entered:false, reason} and never msgs); packages/web/src/main.ts:5272-5283 (const outcome = enterScore(...); void outcome;)
expected: A gated death shows the C rejection string and flushes messages before continuing the death UI.
actual: Core only returns a reason code; the shell throws the outcome away. Cheater/wizard/interrupt/retire non-winner deaths silently skip scoring with no player-visible notice.
why: Visible message drift on every non-scored death path; a faithful equivalent (msg from reason) is achievable in-browser.
confidence: high

### L13_score_death-003  High-score persistence is JSON localStorage, not scores.raw with lock files
sev: P3
concession: y
ref: reference/src/score.c:37-66 (highscore_read: ANGBAND_DIR_SCORES/scores.raw binary sizeof(high_score) records + regularize); reference/src/score.c:98-198 (highscore_write: scores.lok lock, scores.new, rename dance, setuid)
port: packages/core/src/score/types.ts:64-75 (ScoreStore seam); packages/web/src/score.ts:48-78 (createLocalStorageScoreStore: JSON array, regularize on read, no lock file)
expected: Fixed-width 128-byte ASCII records in scores.raw with atomic rewrite under scores.lok.
actual: Compact typed HighScore[] as JSON under localStorage key "neo-angband-scores". regularize-on-read and MAX_HISCORES cap match the defensive posture; locking/setuid/file rename cannot exist in the browser.
why: Unavoidable platform substitution; scoring math, order, and cap are ported in core. Logged so interchange with native scores.raw is not assumed.
confidence: high

### L13_score_death-004  build_score uid is always 0 (no OS player_uid)
sev: P3
concession: y
ref: reference/src/score.c:244 (strnfmt entry->uid "%7u", player_uid)
port: packages/core/src/score/score.ts:51-52,86 (uid: deps.uid ?? 0); packages/web/src/main.ts:3592-3602 (scoreBuildDeps never passes uid)
expected: Score records carry the host user id in the User column of the Hall of Fame.
actual: Every record uses uid 0. Display still prints "(User 0, ...)" faithfully for that value.
why: Browser has no getuid/player_uid; zero is the documented default. Cosmetic only.
confidence: high

### L13_score_death-005  highscore_valid accepts blank-what records with non-empty other fields
sev: P3
concession: n
ref: reference/src/score-util.c:166-186 (empty what[0]: valid only if pts/gold/turns/day/who/uid/p_r/p_c/cur_*/max_*/how are all empty); reference/src/tests/player/pscore.c:76-114
port: packages/core/src/score/score.ts:108-109 (if isEmpty(s) return true without scanning other fields)
expected: A record with what empty but e.g. pts set is invalid (and regularize zeros it).
actual: any HighScore with what=="" is treated as a valid empty regardless of leftover numeric/string fields. highscoreRegularize still drops isEmpty entries, so a clean compact list after regularize matches C's end state for typical corruption; the pure validity predicate does not.
why: Diverges from the C oracle API and the upstream unit tests; low live impact under typed JSON that rarely manufactures half-empty slots.
confidence: high

### L13_score_death-006  highscore_regularize sets irregular=true for every empty slot it drops
sev: P3
concession: n
ref: reference/src/score-util.c:218-220 (skip empty what without setting irregular); reference/src/score-util.c:211-215,225-237 (irregular only for invalid zeroing, gap-compacting copies, or out-of-order); reference/src/tests/player/pscore.c:425-436 (ordered non-empty + trailing empties => regularize returns false)
port: packages/core/src/score/score.ts:212-216 (if !valid || isEmpty: irregular=true; continue)
expected: A best-first list with only trailing empty padding is already regular; regularize returns false and leaves contents ordered.
actual: Any empty element in the input forces irregular=true even when non-empty prefix was already ordered. Compact live lists usually have no empties (flag stays correct); callers that pass padded arrays see a false positive irregular flag (web store discards the flag).
why: Return-value parity only; sort/drop results for non-empty records still match.
confidence: high

## MAP L13_score_death
reference/src/list-history-types.h -> packages/core/src/generated/history-types.ts (HISTORY_TYPE_ENTRIES + HIST enum; codegen scripts/codegen-lists.mjs)
reference/src/score.h -> packages/core/src/score/types.ts (MAX_HISCORES, WINNING_HOW, HighScore, ScoreStore, ScoreRow); packages/core/src/score/score.ts (API surface: buildScore, enterScore, highscore*)
reference/src/score.c -> packages/core/src/score/score.ts (totalPoints, buildScore, highscoreAdd, highscoreCount, enterScore, predictScore); packages/web/src/score.ts (highscore_read/write via ScoreStore + localStorage; display shell); packages/web/src/main.ts (enterScore on LOOP_STATUS.DEAD, scoreBuildDeps)
reference/src/score-util.c -> packages/core/src/score/score.ts (highscoreValid, highscoreCmp, highscoreRegularize, highscoreWhere)

# ===== L14_ui_frontend =====

# L14_ui_frontend audit (UI/display + Windows frontend)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane: ui-* / main.c / main-win.c / grafmode / win/* (see manifest L14_ui_frontend.ref.txt).
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary: web shell packages/web/src/{main,term,birth,charsheet,screens,overlay,
options,knowledge,shop,wizard,keymap*,context-menu,help,score,tiles,ui-colors,messages,...}.ts
plus core data models packages/core/src/{game/display,game/ui-entry,game/char-sheet,
game/mon-list,game/obj-list,game/equip-cmp,game/target*,game/wizard,visuals/*,score/*,
player/abilities,mon/lore-describe,mon/knowledge-groups,effects/effect-info}.ts.
Windows front-end (main-win.c, win/*) is replaced by the canvas GlyphTerm + Image/PNG path.

### L14_ui_frontend-001  Live sidebar stats omit equipment/timed stat_use (displayDeps underwires)
sev: P1
concession: n
ref: reference/src/ui-display.c:153-166 (prt_stat prints player->state.stat_use[stat] after calc_bonuses); reference/src/player-calcs.c (state.stat_use includes race+class+equip+shape+timed)
port: packages/web/src/main.ts:4605-4607 (displayDeps returns only timedEffects + unignoring); packages/core/src/game/display.ts:184-190,203,364 (defaultStatUse = race+class on statCur only; value = cnvStat(deps.statUse)); packages/web/src/screens.ts:416-438 (charSheetDeps DOES pass state.playerState.statUse)
expected: Sidebar STR/INT/WIS/DEX/CON show the full modified stat_use (rings of strength, etc.).
actual: Live HUD always falls back to race+class-only defaultStatUse. Character sheet ('C') is correct via charSheetDeps; the always-visible sidebar is not. state.playerState.statUse is computed every calcBonuses pass but never passed into displayDeps.
why: Default-path HUD lies about every worn/timed stat; immediately visible wrong vitals.
confidence: high

### L14_ui_frontend-002  Resting / repeat status line never receives isResting or nRepeats
sev: P1
concession: n
ref: reference/src/ui-display.c:957-1017 (prt_state: "Rest******" / "Repeat NNN" from player_is_resting + cmd_get_nrepeats)
port: packages/web/src/main.ts:4605-4607,4649-4658 (displayDeps omits isResting/restingCount/nRepeats; statusLineModel uses defaults false/0); packages/web/src/main.ts:3522,3411-3577 (rest sets state.resting live); packages/core/src/game/display.ts:661-707 (stateRuns only emits Rest/Repeat when deps set)
expected: While resting, status line shows Rest + count field (* / & / ! / digits); while a command repeats, "Repeat NNN".
actual: deps.isResting and deps.nRepeats always default false/0 on the live path, so prt_state is always the idle single-space reservation. Rest still runs and regens; the status chrome is blank.
why: Player cannot see rest/repeat state on the status line during the default R-rest path.
confidence: high

### L14_ui_frontend-003  EF_SELECT player choice UI missing; live path always randomizes
sev: P1
concession: n
ref: reference/src/ui-effect.c:34-180 (textui_get_effect_from_list: menu of effect_get_menu_name rows + "one of the following at random"); reference/src/effects-info.c:583 (effect_get_menu_name)
port: packages/core/src/effects/interpreter.ts:168-172,475-501 (chooseEffect optional; if absent choice=-2 then randint0); packages/content/pack/activation.json:2704+ and object.json SELECT chains (e.g. WAND_BREATH); packages/web/src (no textui_get_effect_from_list / chooseEffect injection anywhere)
expected: Activating a SELECT effect prompts Which effect? with named rows and optional random; choice is deterministic player input (RNG only if random picked).
actual: chooseEffect is never wired on the live effect env (only unit tests supply it). Player-origin SELECT with count>=2 falls through to random, drawing RNG and skipping the menu. effect_get_menu_name has no ported formatter (menuName strings sit unused in EFFECT_ENTRIES).
why: Wrong effect selection and extra RNG draws on stock SELECT activations/objects; player cannot choose breath element etc.
confidence: high

### L14_ui_frontend-004  Sidebar title ignores wizard mode and total_winner
sev: P2
concession: n
ref: reference/src/ui-display.c:173-187 (fmt_title: [=-WIZARD-=] if player->wizard; ***WINNER*** if total_winner or lev>PY_MAX_LEVEL)
port: packages/web/src/main.ts:4605-4607,3625,5428 (wizardMode lives in shell; never passed as displayDeps.wizard); packages/core/src/game/display.ts:138-142,210-211,253-255 (wizard/totalWinner default false; fmtTitle reads deps only, not Player.totalWinner)
expected: Wizard title and winner banner on the left sidebar when those flags are set.
actual: Title always uses class level title (or shape). player.totalWinner exists on Player and is used for tombstone/score, but displayDeps does not pass totalWinner: player.totalWinner or wizard: wizardMode.
why: Visible look-and-feel drift on wizard play and post-victory dungeon play.
confidence: high

### L14_ui_frontend-005  prt_moves never sees num_moves from calc_bonuses
sev: P2
concession: n
ref: reference/src/ui-display.c:1145 (prt_moves uses player->state.num_moves); player-calcs sets num_moves from OBJ_MOD_MOVES
port: packages/core/src/player/calcs.ts:382,1290-1291 (PlayerState.numMoves); packages/web/src/main.ts:4605-4607 (displayDeps omits numMoves); packages/core/src/game/display.ts:608-612
expected: Status line shows "Moves +N" / "Moves -N" when extra_moves nonzero.
actual: numMoves always defaults to 0 in resolveDeps; movement-bonus gear never lights the indicator (though player-turn energy math does read state.playerState.numMoves).
why: Status-line indicator missing for a real equipment bonus.
confidence: high

### L14_ui_frontend-006  Death menu omits Examine items (death_examine)
sev: P2
concession: n
ref: reference/src/ui-death.c:356-367 (death_actions includes { 'x', "Examine items", death_examine })
port: packages/web/src/game-menu.ts:11-16,134-160 (deathMenuEntries deliberately drops Examine items with comment "needs the get_item examine loop")
expected: After death, 'x' opens item examine over final gear.
actual: Row absent; player cannot inspect final inventory/equipment from the death menu (Information sheet is partial substitute only).
why: Missing death-flow action that is implementable with existing textui_get_item / inspect paths.
confidence: high

### L14_ui_frontend-007  history_display invents per-row colours not in the C
sev: P2
concession: n
ref: reference/src/ui-history.c:67-76 (prt(buf,...) default white for every row; only string " (LOST)" marks lost artifacts)
port: packages/web/src/screens.ts:1030-1055 (HIST_KNOWN_GOLD for ARTIFACT_KNOWN; DIM for ARTIFACT_LOST; comment admits "web-native enhancement")
expected: All history rows white; lost arts distinguished only by the " (LOST)" suffix text.
actual: Known artifacts render gold (COLOUR_YELLOW via UI_GOLD); lost arts render slate dim. Strings/layout match; colours do not.
why: Visible message/chrome drift on history and death history screens; faithful equivalent is plain white.
confidence: high

### L14_ui_frontend-008  Multi-term subwindows (PW_MESSAGE/INVEN/MONLIST/...) not modelled
sev: P2
concession: ?
ref: reference/src/ui-init.c:91-103 (default_window_flag[1..7] = PW_MESSAGE, PW_INVEN, PW_MONLIST, PW_ITEMLIST, PW_MONSTER|PW_OBJECT, PW_OVERHEAD, PW_PLAYER_2); ui-term.c multi-term; main-win.c multi-window
port: packages/web/src/term.ts:89-98 (single FIXED 80x24 GlyphTerm); packages/web/src/options.ts:11,35 (Subwindow setup row present but "no subwindows modelled")
expected: Optional auxiliary terminals mirror inventory, messages, mon list, overhead map, etc. while playing.
actual: One canvas term; those views only via modal keys (i/e/[/]/-P/M/...). Content exists; simultaneous subwindow furniture does not.
why: Layout/feel differs from multi-window native clients; browser can approximate with extra panels, so not purely unavoidable, but native multi-HWND is platform-specific.
confidence: high

### L14_ui_frontend-009  Screen dump is PNG download, not html_screenshot
sev: P3
concession: y
ref: reference/src/ui-command.c:295-560 (html_screenshot / do_cmd_save_screen: HTML or text term dump to path)
port: packages/web/src/main.ts:4310-4326 (canvas.toDataURL image/png download neo-angband-screen.png); packages/web/src/term.ts:354-362 (snapshotColored documents HTML-parity cell dump for tests only)
expected: ')' writes an HTML/text dump of attr/char cells.
actual: Browser downloads a PNG of the canvas. Cell-level HTML dump exists as snapshotColored for tests but is not the player command output.
why: No arbitrary filesystem write path; PNG is a reasonable browser substitute. Logged so dump interchange is not assumed.
confidence: high

### L14_ui_frontend-010  POSIX signal handlers (ui-signals) have no browser counterpart
sev: P3
concession: y
ref: reference/src/ui-signals.c:26-80+ (SIGHUP/SIGTSTP/SIGINT orderly save/suspend; signal_count)
port: NONE (packages/web has no signal install; pagehide/beforeunload may autosave separately in main.ts)
expected: HUP/INT/TSTP interrupt count and emergency save on native UNIX builds.
actual: No POSIX signals in the browser. Autosave on navigation is a different mechanism.
why: Unavoidable platform gap; not gameplay-visible on the web target.
confidence: high

### L14_ui_frontend-011  Windows native frontend (main-win / win/*) replaced by canvas stack
sev: P3
concession: y
ref: reference/src/main-win.c (WinMain, GDI terms, menus, DIB tiles); win/readdib.c, readpng.c, scrnshot.c, win-layout.c, win-menu.h, win-term.h; win/include png/zlib headers
port: packages/web/src/{main,term,tiles,font-16x24,options}.ts + packages/desktop (Electron shell only); browser Image/decode for PNG tiles (no readdib/GDI)
expected: Native Windows window chrome, .dib/.png loaders, screenshot GDI path, multi-window layout.
actual: Fixed 80x24 canvas, web font/tile atlases, Escape/localStorage prefs. win/include/* vendored third-party headers have no TS port (correct).
why: Target platform is browser (plus optional Electron); native Win32 is out of scope. Behavior of game UI is reimplemented; OS chrome is not.
confidence: high

### L14_ui_frontend-012  Death/in-game spoiler menu not on web (CLI only)
sev: P3
concession: n
ref: reference/src/ui-spoil.c:59-73 (do_cmd_spoilers menu); ui-death.c:363 (death_spoilers)
port: packages/cli/src/spoilers.ts + main-spoil.ts (spoiler generation); packages/web/src/game-menu.ts:14-16 (Spoilers row omitted)
expected: Death menu 's' / wizard spoilers create obj-desc.spo etc.
actual: Web death menu has no Spoilers row; CLI can generate spoilers. Content generators exist off the web live path.
why: Peripheral for normal play; still a missing death-menu action that could download text.
confidence: high

### L14_ui_frontend-013  do_cmd_pref (') always rejects the line
sev: P3
concession: n
ref: reference/src/ui-command.c / cmd-hidden do_cmd_pref: process a single pref-file directive into live prefs
port: packages/web/src/main.ts:4337-4346 (prefLineCmd prompts then always say "Pref command not recognized.")
expected: A valid pref line (keymap, color, etc.) is applied like process_pref_file one-liners.
actual: Key is live for shape but every non-empty line is rejected; options/keymaps use separate UI stores instead.
why: Cosmetic command surface without the C grammar backend; low impact if '=' menus cover prefs.
confidence: high

### L14_ui_frontend-014  Equippy chars use kind dAttr/dChar, not object_attr/object_char
sev: P2
concession: n
ref: reference/src/ui-display.c:269-294 (prt_equippy: object_attr(obj) / object_char(obj), including flavor when applicable)
port: packages/web/src/main.ts:4605-4607 (displayDeps omits objectAttr/objectChar); packages/core/src/game/display.ts:149-155,213-215,411-424 (default colorCharToAttr(kind.dAttr) + kind.dChar); map render in main.ts:4410-4422 DOES use flavor for floor/map objects
expected: Equipment row glyphs match map/inventory flavor-aware attr/char for unaware flavored wearables (rings/amulets).
actual: Equippy always uses base kind glyph/colour; map path is flavor-aware. Inconsistency on the same character view.
why: Visible wrong equippy colours for flavored worn items until identified.
confidence: med

### L14_ui_frontend-015  Study indicator colour ignores book carry check (default true)
sev: P3
concession: n
ref: reference/src/ui-display.c:1226-1245 (prt_study: COLOUR_WHITE if player_book_has_unlearned_spells else COLOUR_L_DARK)
port: packages/core/src/game/display.ts:144-147,212,715-719 (bookHasUnlearnedSpells defaults true); packages/web/src/main.ts:4605-4607 (never overrides)
expected: Study (N) is dark grey when the player has study slots but no book with unlearned spells in pack.
actual: Always white whenever newSpells > 0, even without a suitable book.
why: Minor status-line colour wrongness for casters mid-dungeon without books.
confidence: high

## MAP L14_ui_frontend
reference/src/grafmode.c -> packages/core/src/visuals/grafmode.ts; packages/core/src/visuals/grafmode-data.ts (codegen packages/core/scripts/gen-grafmode.mjs); packages/web/src/tiles.ts (mode select/load)
reference/src/grafmode.h -> packages/core/src/visuals/grafmode.ts (GraphicsMode, GRAPHICS_NONE, getGraphicsMode, isDhTile)
reference/src/list-ui-entry-renderers.h -> packages/core/src/generated/ui-entry-renderers.ts (codegen packages/core/scripts/codegen-lists.mjs)
reference/src/main.c -> packages/web/src/main.ts (browser entry/boot); packages/cli/src/main-*.ts (headless tools); packages/desktop/main.cjs (Electron host)
reference/src/main.h -> NONE (platform main prototypes; no shared TS header)
reference/src/main-win.c -> packages/web/src/main.ts + term.ts + tiles.ts + options.ts (canvas stand-in for Win32 GDI term/menus/graphics); packages/desktop/* (optional native shell)
reference/src/ui-birth.c -> packages/web/src/birth.ts; packages/core/src/player/birth.ts (roller/point-buy data)
reference/src/ui-birth.h -> packages/web/src/birth.ts (exports runBirth)
reference/src/ui-command.c -> packages/web/src/main.ts (redraw, retire, rest, screen dump, version, pref line, save/quit wiring)
reference/src/ui-command.h -> packages/web/src/main.ts
reference/src/ui-context.c -> packages/web/src/context-menu.ts; packages/web/src/main.ts (click routing)
reference/src/ui-context.h -> packages/web/src/context-menu.ts
reference/src/ui-curse.c -> packages/web/src/main.ts (curse_menu inclusion / remove-curse prompts ~L1620+)
reference/src/ui-curse.h -> packages/web/src/main.ts
reference/src/ui-death.c -> packages/web/src/main.ts (death flow/tombstone); packages/web/src/game-menu.ts (deathMenuEntries); packages/web/src/screens.ts (tombstoneLines); packages/web/src/charsheet.ts (death_file dump)
reference/src/ui-death.h -> packages/web/src/game-menu.ts; packages/web/src/main.ts
reference/src/ui-display.c -> packages/core/src/game/display.ts (sidebarModel/statusLineModel data); packages/web/src/main.ts (renderSidebar/renderStatusLine/map anim/see_floor)
reference/src/ui-display.h -> packages/core/src/game/display.ts (cnvStat, fmtTitle, exports)
reference/src/ui-effect.c -> NONE (chooseEffect seam in packages/core/src/effects/interpreter.ts only; no textui_get_effect_from_list UI)
reference/src/ui-effect.h -> NONE
reference/src/ui-entry.c -> packages/core/src/game/ui-entry.ts; packages/content/src/specs/ui-entry.ts + pack ui_entry*.json
reference/src/ui-entry.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-combiner.c -> packages/core/src/game/ui-entry.ts (combiners block)
reference/src/ui-entry-combiner.h -> packages/core/src/game/ui-entry.ts (UI_ENTRY_* special values)
reference/src/ui-entry-init.h -> packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts (buildUiEntryConfig)
reference/src/ui-entry-renderers.c -> packages/core/src/game/ui-entry.ts (render half); packages/core/src/generated/ui-entry-renderers.ts
reference/src/ui-entry-renderers.h -> packages/core/src/generated/ui-entry-renderers.ts; packages/core/src/game/ui-entry.ts
reference/src/ui-equip-cmp.c -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-equip-cmp.h -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-event.c -> NONE (browser KeyboardEvent / pointer; overlay key capture replaces ui_event queue)
reference/src/ui-event.h -> NONE
reference/src/ui-game.c -> packages/web/src/main.ts (command key tables / game loop commands); packages/web/src/wizard.ts (cmd_debug menus)
reference/src/ui-game.h -> packages/web/src/main.ts; packages/web/src/wizard.ts
reference/src/ui-help.c -> packages/web/src/help.ts
reference/src/ui-help.h -> packages/web/src/help.ts
reference/src/ui-history.c -> packages/web/src/screens.ts (historyLines); packages/web/src/main.ts / charsheet.ts (call sites)
reference/src/ui-history.h -> packages/web/src/screens.ts
reference/src/ui-init.c -> packages/web/src/main.ts (boot: prefs, knowledge, term size, single-term); packages/core/src/session/boot.ts / game.ts (engine init)
reference/src/ui-init.h -> packages/web/src/main.ts
reference/src/ui-input.c -> packages/web/src/overlay.ts (getCheck/getString/getRepDir/getAimDir); packages/web/src/messages.ts (paginateMessages/-more-); packages/web/src/input-queue.ts; packages/web/src/main.ts (inkey/command loop)
reference/src/ui-input.h -> packages/web/src/overlay.ts; packages/web/src/messages.ts
reference/src/ui-keymap.c -> packages/web/src/keymap-store.ts (add/find/remove/persist); packages/web/src/main.ts (keymap_find apply); packages/web/src/keymap-edit.ts (editor)
reference/src/ui-keymap.h -> packages/web/src/keymap-store.ts
reference/src/ui-knowledge.c -> packages/web/src/knowledge.ts; packages/web/src/main.ts (knowledge menu); packages/core/src/mon/knowledge-groups.ts; packages/content/src/specs/misc.ts (ui_knowledge parser)
reference/src/ui-knowledge.h -> packages/web/src/knowledge.ts
reference/src/ui-map.c -> packages/web/src/mapview.ts; packages/web/src/main.ts (map cell draw / graphics)
reference/src/ui-map.h -> packages/web/src/mapview.ts; packages/web/src/main.ts
reference/src/ui-menu.c -> packages/web/src/overlay.ts (selectFromMenu/menuNav); packages/web/src/birth.ts (all_letters_nohjkl); packages/web/src/ui-colors.ts (curs_attrs colours)
reference/src/ui-menu.h -> packages/web/src/overlay.ts
reference/src/ui-mon-list.c -> packages/web/src/screens.ts (monsterListScreenLines); packages/web/src/main.ts (showMonsterList); data half packages/core/src/game/mon-list.ts
reference/src/ui-mon-list.h -> packages/web/src/screens.ts; packages/core/src/game/mon-list.ts
reference/src/ui-mon-lore.c -> packages/core/src/mon/lore-describe.ts; packages/web/src/screens.ts / main.ts / knowledge.ts (display)
reference/src/ui-mon-lore.h -> packages/core/src/mon/lore-describe.ts
reference/src/ui-object.c -> packages/web/src/main.ts (get_item/inspect/ignore); packages/web/src/ignore-menu.ts; packages/web/src/overlay.ts (item menu); packages/web/src/screens.ts (inven/equip lines)
reference/src/ui-object.h -> packages/web/src/main.ts; packages/web/src/overlay.ts; packages/web/src/ignore-menu.ts
reference/src/ui-obj-list.c -> packages/web/src/screens.ts (objectListLines); packages/core/src/game/obj-list.ts; packages/web/src/main.ts (']' command)
reference/src/ui-obj-list.h -> packages/web/src/screens.ts; packages/core/src/game/obj-list.ts
reference/src/ui-options.c -> packages/web/src/options.ts; packages/web/src/keymap-edit.ts; packages/web/src/colors.ts; packages/web/src/ignore-menu.ts; packages/core/src/player/options.ts
reference/src/ui-options.h -> packages/web/src/options.ts
reference/src/ui-output.c -> packages/web/src/main.ts (verifyPanel/modify_panel camera); packages/web/src/overlay.ts (screen_save-style modals)
reference/src/ui-output.h -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-player.c -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts; packages/web/src/screens.ts (characterSheetLines); packages/core/src/game/ui-entry.ts (flag panels)
reference/src/ui-player.h -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts
reference/src/ui-player-properties.c -> packages/web/src/abilities.ts; packages/core/src/player/abilities.ts
reference/src/ui-player-properties.h -> packages/web/src/abilities.ts
reference/src/ui-prefs.c -> packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts; packages/web/src/colors.ts (color prefs); packages/web/public/tiles/**/*.prf
reference/src/ui-prefs.h -> packages/core/src/visuals/tile-prefs.ts
reference/src/ui-score.c -> packages/core/src/score/display.ts; packages/web/src/score.ts
reference/src/ui-score.h -> packages/core/src/score/display.ts; packages/core/src/score/types.ts
reference/src/ui-signals.c -> NONE (browser has no POSIX signal handlers; autosave is separate)
reference/src/ui-signals.h -> NONE
reference/src/ui-spell.c -> packages/web/src/overlay.ts (spell menu); packages/web/src/main.ts (cast/study/browse); packages/core/src/effects/effect-info.ts (spell_menu_browser damage summary); packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/ui-spell.h -> packages/web/src/overlay.ts; packages/web/src/main.ts
reference/src/ui-spoil.c -> packages/cli/src/spoilers.ts + main-spoil.ts (CLI only; web death menu omits)
reference/src/ui-spoil.h -> packages/cli/src/spoilers.ts
reference/src/ui-store.c -> packages/web/src/shop.ts; packages/web/src/main.ts (enter store); packages/core/src/store/*
reference/src/ui-store.h -> packages/web/src/shop.ts
reference/src/ui-target.c -> packages/web/src/main.ts + overlay.ts (target/look loops); packages/core/src/game/target.ts; packages/core/src/game/target-loop.ts
reference/src/ui-target.h -> packages/web/src/main.ts; packages/core/src/game/target.ts
reference/src/ui-term.c -> packages/web/src/term.ts (GlyphTerm 80x24); packages/web/src/font-16x24.ts
reference/src/ui-term.h -> packages/web/src/term.ts
reference/src/ui-visuals.c -> packages/core/src/visuals/engine.ts; packages/content/src/specs/visuals.ts + pack visuals.json
reference/src/ui-visuals.h -> packages/core/src/visuals/engine.ts; packages/core/src/visuals/index.ts
reference/src/ui-wizard.c -> packages/web/src/wizard.ts (debug command menus); packages/core/src/game/wizard.ts (engine actions)
reference/src/ui-wizard.h -> packages/web/src/wizard.ts
reference/src/win/include/libpng12/png.h -> NONE (vendored C header; browser uses native PNG decode)
reference/src/win/include/libpng12/pngconf.h -> NONE
reference/src/win/include/png.h -> NONE
reference/src/win/include/pngconf.h -> NONE
reference/src/win/include/zconf.h -> NONE
reference/src/win/include/zlib.h -> NONE
reference/src/win/readdib.c -> NONE (DIB loader; web uses Image/canvas for tiles)
reference/src/win/readdib.h -> NONE
reference/src/win/readpng.c -> packages/web/src/tiles.ts (PNG tile atlas load via browser Image)
reference/src/win/scrnshot.c -> packages/web/src/main.ts (screenDumpCmd PNG); term.snapshotColored for cell dump tests
reference/src/win/scrnshot.h -> packages/web/src/main.ts
reference/src/win/win-layout.c -> NONE (native multi-window layout; web single GlyphTerm + optional sidebar modes in main.ts)
reference/src/win/win-menu.h -> packages/web/src/game-menu.ts + options.ts (Graphics/menu bar stand-ins)
reference/src/win/win-term.h -> packages/web/src/term.ts

# ===== L15_tiles =====

# L15_tiles audit (tiles/graphics: lib/tiles + linoleum)
Auditor: grok. Method: re-derivation against reference C and assets (not prior ledgers).
Lane: reference/lib/tiles/** (list.txt, packs, PNG atlases, graf/flvr/xtra prefs, Makefiles).
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary:
- Catalog METADATA from list.txt is codegen'd into packages/core/src/visuals/grafmode-data.ts
  (scripts/gen-grafmode.mjs) and consumed via packages/core/src/visuals/grafmode.ts.
- Pref grammar (feat/trap/monster/object/flavor/GF/% include) is packages/core/src/visuals/tile-prefs.ts.
- Browser atlas load + blit is packages/web/src/tiles.ts; live map wiring is packages/web/src/main.ts
  (applyTileMode, tileDrawFor, terrainGlyph/objectIndex/monsterIndex/trapIndex).
- Enabled-pack registry is packages/web/mods/linoleum/manifest.json + packages/web/src/tile-mods.ts.
- Bundled free assets (verbatim SHA256 match to reference) live under packages/web/public/tiles/{old,
  adam-bolt,gervais,nomad}/. Shockbolt is deliberately not shipped.
- packages/linoleum is an offline converter (graf -> loose linoleum packs), not the play path.

Asset identity (reference vs packages/web/public/tiles): all 16 free-pack PNG/PRF files are
byte-identical (SHA256 MATCH). Shockbolt tree has no public/ counterpart.

### L15_tiles-001  Player map cell never uses graphics tile (always ASCII @)
sev: P1
concession: n
ref: reference/src/ui-map.c:282-330 (g->is_player: a/c from monster_x_attr/char of r_info[0] aka "<player>"; hp_changes_color only when !(a & 0x80)); reference/lib/tiles/*/graf-*.prf (monster:<player>:...) + %:xtra-*.prf race/class remaps
port: packages/web/src/main.ts:4943-4954 (player put always ch:"@" + playerMapAttr, no tileDrawFor / no tileForMonster); packages/core/src/visuals/tile-prefs.ts:441-444 (tileForMonster exists but unused for player)
expected: In graphics mode the player cell blits the <player> atlas tile (race/class-selected via xtra). ASCII @ + hp color only when the attr lacks the tile high bit.
actual: With any tile pack active the whole map can be tiles while the player remains a coloured "@". The TileMap entry for ridx 0 is never consulted for the player cell.
why: Immediately visible wrong player glyph on the default graphics path; race/class player portraits never appear.
confidence: high

### L15_tiles-002  Pref ?: expressions not implemented; xtra player race/class mapping discarded / last-wins
sev: P1
concession: n
ref: reference/src/ui-prefs.c:453-600 (process_pref_file_expr + parse_prefs_expr sets d->bypass from ?: lines; $RACE/$CLASS/$SYS); reference/src/ui-prefs.c:682-690 (parse_prefs_monster respects bypass); reference/lib/tiles/old/xtra-xxx.prf (66 conditioned monster:<player> lines) and peers
port: packages/core/src/visuals/tile-prefs.ts:367-407 (switch has no "?" / expr case; ?: lines fall to default skip); packages/web/src/tiles.ts:174-207 (loadTilePrefs loads %:xtra via loadFile into the same map)
expected: Only the monster:<player> line whose preceding ?: expression matches the live race/class is applied; others are bypassed. Graf default applies until a match overwrites.
actual: All ?: lines are ignored. Every monster:<player> in xtra is applied in file order, so the last line wins unconditionally (old pack: Paladin+Kobold 0xA9:0x91). Even if L15_tiles-001 were fixed, every class/race would share one wrong portrait. (Linoleum's offline prf.ts *does* capture conditions as :when: metadata for conversion only.)
why: Player tile identity is race/class-specific in every upstream pack; the live parser cannot select it.
confidence: high

### L15_tiles-003  Object map tiles ignore flavor_x (always kind tile)
sev: P1
concession: n
ref: reference/src/ui-object.c:87-111 (use_flavor_glyph then object_kind_attr/char -> flavor_x_attr/char[fidx] else kind_x_*); reference/src/ui-map.c:218-223 (floor objects use object_kind_attr/char); reference/lib/tiles/*/flvr-*.prf (flavor:N:attr:char, included from graf via %:flvr-*.prf)
port: packages/web/src/main.ts:4407-4424 (tile = tileForObject(tileMap, o.kind) only; flavor used for ASCII ch/css only); packages/core/src/visuals/tile-prefs.ts:447-461 (tileForFlavor exists, never called from main map path)
expected: Unidentified potions/mushrooms/rings/wands/etc. blit the assigned flavor tile; identified (or scroll-aware) kinds use kind tile.
actual: Graphics mode always blits the kind atlas cell. Flavor PRFs are parsed into TileMap.flavor but never read for floor objects, so many flavoured items show the wrong/generic kind tile while ASCII colour correctly uses the flavor.
why: Core look of inventory-on-floor graphics is wrong for the entire flavoured-object set.
confidence: high

### L15_tiles-004  Visible terrain tiles always LIGHTING.LOS (map_info lighting ignored)
sev: P2
concession: n
ref: reference/src/cave-map.c:93-129 (g->lighting = LIT default; in-view CLOSE_PLAYER + view_yellow_light -> TORCH; unlit UNLIGHT cases -> DARK; else LOS/LIT); reference/src/ui-map.c:180-181 (feat_x_attr[g->lighting][fidx]); reference/lib/tiles/*/graf-*.prf (per-feat torch/los/lit/dark rows; e.g. old FLOOR lit 0xA1 vs los 0xA2)
port: packages/web/src/main.ts:4911 (terrainGlyph(..., LIGHTING.LOS) for all seen grids); packages/web/src/main.ts:4877 (remembered-only correctly uses LIGHTING.LIT)
expected: Seen grids pick the feat tile for map_info's lighting (TORCH/LOS/LIT/DARK). All four free packs differentiate lit vs los (and dark vs los) for multiple feats.
actual: Every in-view cell forces LOS tiles. Torch-yellow mode never selects TORCH rows; dark/unlit in-view cases never select DARK. Remembered out-of-view path is correct (LIT).
why: Visible torch/dark terrain variants never appear even though prefs and TileMap store them.
confidence: high

### L15_tiles-005  Trap tiles always LIGHTING.LOS
sev: P2
concession: n
ref: reference/src/ui-map.c:98-99 (trap_x_attr[g->lighting][tidx]); reference/lib/tiles/old/graf-xxx.prf trap:glyph of warding:dark/lit/los/torch distinct cells
port: packages/web/src/main.ts:4387 (tileForTrap(..., LIGHTING.LOS) only)
expected: Trap graphic follows the same lighting index as the grid.
actual: Trap lighting variants are parsed but the live path always samples LOS.
why: Trap art that changes with light level never switches.
confidence: high

### L15_tiles-006  GF bolt / missile / explosion tiles never drawn on live path
sev: P2
concession: n
ref: reference/src/ui-display.c:1524-1553 (bolt_pict uses proj_to_attr/char when use_graphics != NONE); reference/src/ui-display.c:1559-1696,2760-2763 (EVENT_BOLT / EVENT_EXPLOSION / EVENT_MISSILE handlers); reference/lib/tiles/*/graf-*.prf (GF:* and per-element GF lines)
port: packages/core/src/visuals/tile-prefs.ts:292-345,463-470 (parse + tileForProjection); packages/web/src (no tileForProjection / no EVENT_BOLT|MISSILE animation blit in main.ts)
expected: Projectiles, breath bolts, and explosions animate with the pack's GF atlas cells (direction-sensitive).
actual: GF mappings are loaded into TileMap.gf but nothing in the web shell blits them. Combat projectiles have no graphics overlay (ASCII-only or instant resolution).
why: Large visible chunk of every graf-*.prf is dead on the play path.
confidence: high

### L15_tiles-007  Tile blit stretches atlas cells into font cell size (ignores mode cellWidth/Height as term metrics)
sev: P2
concession: n
ref: reference/lib/tiles/list.txt size lines + reference/src/grafmode.c:61-68 (cell_width/cell_height from size); native front ends size the term cell to the mode's tile pixel size so 1 map grid = 1 tile at native aspect
port: packages/web/src/tiles.ts:108-130 (drawTile scales source cellWidth x cellHeight into caller dw x dh); packages/web/src/term.ts:454-465 (paintCell always passes GlyphTerm cellW/cellH from the 80x24 letterboxed font grid)
expected: A 16x16 (or 32x32/8x8) pack paints square tile pixels; a 64x64 pack likewise. Map cell aspect matches the tileset.
actual: Tiles are always non-uniformly scaled into the current bitmap-font cell (e.g. 16x24-ish). Catalog cellWidth/cellHeight only crop the atlas source rectangle; they never drive terminal metrics.
why: Every graphics mode looks stretched/squashed vs upstream; aspect is wrong even when atlas coords are correct.
confidence: high

### L15_tiles-008  Double-height overdraw (Shockbolt rows 27-31) not applied on blit
sev: P2
concession: n
ref: reference/lib/tiles/list.txt:58-68 (extra:1:27:31 for Shockbolt Dark/Light); reference/src/grafmode.c:241-258 (is_dh_tile); native term dblh_hook draws tall tiles spanning two rows
port: packages/core/src/visuals/grafmode.ts:114-123 (isDoubleHeightTile faithful); packages/web/src/tiles.ts:20-21 (comments only); packages/web/src/main.ts tileDrawFor / term paintCell (single cell blit only, never calls isDoubleHeightTile)
expected: Tiles whose attr row is in [overdrawRow, overdrawMax] overdraw the cell above (double height).
actual: Helper exists and is unit-tested but the live renderer never uses it. URL-loaded Shockbolt (graf 5/6) would clip tall monsters/terrain to one cell.
why: Catalog extra data is incomplete on the only packs that need it.
confidence: high

### L15_tiles-009  Shockbolt pack assets not shipped (license); catalog + URL path only
sev: P2
concession: y
ref: reference/lib/tiles/shockbolt/{64x64.png,graf-shb-dark.prf,graf-shb-light.prf,flvr-shb.prf,xtra-shb.prf}; reference/lib/tiles/list.txt name 5/6
port: packages/core/src/visuals/grafmode-data.ts:67-89 (metadata present); packages/web/public/tiles/ (no shockbolt/); packages/web/mods/linoleum/manifest.json:11-16 (tilePacks 1-4 only); packages/web/src/tile-mods.ts:73 (filters directory==="shockbolt"); packages/web/public/tiles/CREDITS.md:38-46
expected: Upstream ships Shockbolt Dark/Light as selectable modes with on-disk assets.
actual: Metadata and linoleum converter config still know Shockbolt, but assets are absent and the Options menu never offers graf 5/6. Documented escape: ?tiles=<url>&graf=5|6 with a user-owned copy.
why: Unavoidable redistribution/licence limit (bespoke Shockbolt licence forbids other projects). Logged so "missing shockbolt" is not treated as an accidental omission.
confidence: high

### L15_tiles-010  Linoleum converter nomad tileWidth 8 disagrees with list.txt / game catalog 16x16
sev: P3
concession: n
ref: reference/lib/tiles/list.txt:52-56 (Nomad size:16:16:8x16.png); packages/core/src/visuals/grafmode-data.ts:55-65 (cellWidth/Height 16)
port: packages/linoleum/src/packs.ts:74-84 (tileWidth: 8, tileHeight: 16, resolution: 16)
expected: Converter that claims fidelity to legacy packs should extract with the same cell size the game uses (16x16). Atlas is 512x960 = 32x60 tiles at 16px (pref tile cols use 0..31 with high bit).
actual: Offline linoleum export for nomad uses 8x16 source rectangles, splitting each game tile. Live web path is unaffected (uses grafmode 16x16).
why: Converted linoleum nomad packs would mis-slice the sheet relative to graf-nmd.prf coordinates.
confidence: high

### L15_tiles-011  Install Makefiles have no runtime port counterpart
sev: P3
concession: y
ref: reference/lib/tiles/Makefile; reference/lib/tiles/*/Makefile (buildsys DATA install lists)
port: NONE
expected: Native install copies PNG/PRF into the tiles package tree.
actual: Browser ships static files under packages/web/public/tiles/ (and Vite public copy). No Makefile consumer.
why: Host packaging only; not a play-path defect. Concession: no make install in browser deploys.
confidence: high

## MAP L15_tiles
reference/lib/tiles/list.txt -> packages/core/src/visuals/grafmode-data.ts (codegen packages/core/scripts/gen-grafmode.mjs); packages/core/src/visuals/grafmode.ts (GraphicsMode, getGraphicsMode, isDoubleHeightTile, GRAPHICS_NONE)
reference/lib/tiles/Makefile -> NONE (install packaging; web uses public/tiles static ship)
reference/lib/tiles/adam-bolt/16x16.png -> packages/web/public/tiles/adam-bolt/16x16.png (byte-identical); packages/web/src/tiles.ts (TileSet Image load)
reference/lib/tiles/adam-bolt/flvr-new.prf -> packages/web/public/tiles/adam-bolt/flvr-new.prf (byte-identical); packages/core/src/visuals/tile-prefs.ts (flavor:); loaded via %: from graf-new.prf in packages/web/src/tiles.ts loadTilePrefs
reference/lib/tiles/adam-bolt/graf-new.prf -> packages/web/public/tiles/adam-bolt/graf-new.prf (byte-identical); packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts loadTilePrefs
reference/lib/tiles/adam-bolt/Makefile -> NONE
reference/lib/tiles/adam-bolt/xtra-new.prf -> packages/web/public/tiles/adam-bolt/xtra-new.prf (byte-identical); intended via %:xtra-new.prf include + ?: expr (see findings 001-002); packages/linoleum/src/prf.ts (offline condition capture only)
reference/lib/tiles/gervais/32x32.png -> packages/web/public/tiles/gervais/32x32.png (byte-identical); packages/web/src/tiles.ts
reference/lib/tiles/gervais/flvr-dvg.prf -> packages/web/public/tiles/gervais/flvr-dvg.prf (byte-identical); tile-prefs + loadTilePrefs % include
reference/lib/tiles/gervais/graf-dvg.prf -> packages/web/public/tiles/gervais/graf-dvg.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/gervais/Makefile -> NONE
reference/lib/tiles/gervais/xtra-dvg.prf -> packages/web/public/tiles/gervais/xtra-dvg.prf (byte-identical); % include + ?: (findings 001-002)
reference/lib/tiles/nomad/8x16.png -> packages/web/public/tiles/nomad/8x16.png (byte-identical); tiles.ts (game cell size 16x16 per list.txt)
reference/lib/tiles/nomad/flvr-nmd.prf -> packages/web/public/tiles/nomad/flvr-nmd.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/nomad/graf-nmd.prf -> packages/web/public/tiles/nomad/graf-nmd.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/nomad/Makefile -> NONE
reference/lib/tiles/nomad/xtra-nmd.prf -> packages/web/public/tiles/nomad/xtra-nmd.prf (byte-identical); % include + ?: (findings 001-002)
reference/lib/tiles/old/8x8.png -> packages/web/public/tiles/old/8x8.png (byte-identical); tiles.ts
reference/lib/tiles/old/flvr-xxx.prf -> packages/web/public/tiles/old/flvr-xxx.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/old/graf-xxx.prf -> packages/web/public/tiles/old/graf-xxx.prf (byte-identical); tile-prefs + loadTilePrefs
reference/lib/tiles/old/Makefile -> NONE
reference/lib/tiles/old/xtra-xxx.prf -> packages/web/public/tiles/old/xtra-xxx.prf (byte-identical); % include + ?: (findings 001-002)
reference/lib/tiles/shockbolt/64x64.png -> NONE in public (catalog only packages/core/src/visuals/grafmode-data.ts grafID 5/6; optional ?tiles= URL); packages/linoleum/src/packs.ts shockbolt-dark/light offline
reference/lib/tiles/shockbolt/flvr-shb.prf -> NONE in public (same); linoleum packs.ts prefFiles
reference/lib/tiles/shockbolt/graf-shb-dark.prf -> NONE in public; grafmode-data pref graf-shb-dark.prf; linoleum
reference/lib/tiles/shockbolt/graf-shb-light.prf -> NONE in public; grafmode-data pref graf-shb-light.prf; linoleum
reference/lib/tiles/shockbolt/Makefile -> NONE
reference/lib/tiles/shockbolt/xtra-shb.prf -> NONE in public; linoleum packs.ts prefFiles
(support) packages/web/mods/linoleum/manifest.json -> registers grafID 1-4 (old/adam-bolt/gervais/nomad) for Options
(support) packages/web/src/tile-mods.ts -> discoverEnabledTileModes / enabledTileModes
(support) packages/web/src/main.ts -> applyTileMode, tileDrawFor, map cell composition
(support) packages/linoleum/src/{packs,prf,convert,naming,targets,cli,index}.ts -> offline Linoleum loose-pack converter (not play path)

# ===== L16_sounds =====

# L16_sounds audit (sounds: lib/sounds + sound engine)
Auditor: grok. Method: re-derivation against reference C and assets (not prior ledgers).
Lane: reference/src/sound*.{c,h}, snd-sdl*, snd-win.h, reference/lib/sounds/** (mp3 pack + Makefile).
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary:
- Core engine (message->sound map, djb2 dedup, MAX_SOUNDS_PER_MESSAGE-1 cap, randint0 pick,
  lazy/preload load status) is packages/core/src/sound/engine.ts + types.ts.
- MSG name table is packages/core/src/generated/message.ts (from list-message.h).
- sound.prf mapping is codegen'd to packages/core/src/sound/sound-prefs-data.ts
  (packages/core/scripts/gen-sound-prefs.mjs from reference/lib/customize/sound.prf).
- Web platform hooks (HTMLAudioElement load/play/unload) are packages/web/src/sound.ts.
- Live wiring: packages/web/src/main.ts installWebSound + state.sound gated on use_sound;
  core emits via state.sound(MSG_*) from combat/ambient/msgt-equivalent paths.
- Default pack: packages/web/public/sounds/*.mp3 (213 files, SHA256 match to reference).

Verified equalities (no finding):
- All 213 reference/lib/sounds/*.mp3 are present under packages/web/public/sounds/ with
  identical SHA256 (full-set compare: match=213 mism=0).
- All 149 sound: directives in sound.prf match SOUND_PREF_ENTRIES type+sounds strings exactly.
- Every prf sample basename resolves to an on-disk mp3; every mp3 is referenced by the prf.
- play selection uses state.rng.randint0 (game RNG), matching C play_sound randint0.
- use_sound option normal:false; state.sound returns early when off (message.c sound()).
- MAX_SOUNDS_PER_MESSAGE=16 with cap at MAX-1 (15) preserved; prf max is 12 (MON_BITE).
- Ambient depth/day mapping in playAmbientSound matches game-world.c play_ambient_sound.

### L16_sounds-001  Web load marks LOADED without file_exists; blocks multi-extension fallback
sev: P2
concession: n
ref: reference/src/sound-core.c:145-164 (for each supported ext: only if file_exists set ERROR then load_sound_hook; continue until load_success); reference/src/snd-sdl.c:54-56 (try .mp3 then .ogg)
port: packages/core/src/sound/engine.ts:120-127 (calls loadSound(name, type) until true); packages/web/src/sound.ts:74-98 (always new Audio()+src, status=LOADED, return true; error only async)
expected: Missing .mp3 is skipped; existing .ogg is loaded on the next supported_files entry. A failed Mix_Load* on an existing file leaves room to try the next extension in the same load_sound call.
actual: The web hook returns true and sets LOADED for the first format (.mp3) without existence/decode proof. The core loop never tries .ogg. A 404 .mp3 may briefly be LOADED until the error event flips ERROR; .ogg is never attempted.
why: Ogg-only (or mp3-broken/ogg-present) user packs via ?sounds= stay silent; C would fall through. Default Dubtrain pack is all .mp3 so the stock path works.
confidence: high

### L16_sounds-002  Default .mp3 pack is exclusive under SDL Mix_PlayMusic; web overlaps samples
sev: P3
concession: ?
ref: reference/src/snd-sdl.c:54-56,188-190 (.mp3 => SDL_MUSIC; Mix_PlayMusic single stream, loops=1); reference/src/main-win.c:1281-1287 (per-sample MCI device can overlap for WIN_MP3)
port: packages/web/src/sound.ts:101-114 (each sample owns an HTMLAudioElement; play does not halt peers)
expected: Under the SDL backend every shipped sample is music: starting a new sound stops the previous. Under the Win MP3 path samples may overlap. Upstream backends already disagree.
actual: Web allows concurrent playback of distinct samples (hit+kill, ambient+action). Same sample restarts via currentTime=0 (closer to restart-music than multi-channel chunk).
why: Audible mix differs from SDL builds of the same pack. Serialization is achievable in-browser but Win MCI also overlaps; treated as platform-module variance, not a core map bug.
confidence: high

### L16_sounds-003  messageLookupByName is case-sensitive and ignores numeric MSG indices
sev: P3
concession: n
ref: reference/src/message.c:295-316 (strtoul numeric form when pe!=name; else my_stricmp against message_names)
port: packages/core/src/sound/engine.ts:37-41 (strict === against MESSAGE_ENTRIES[i].name only)
expected: "hit", "HIT", and "2" all resolve to MSG_HIT when loading sound prefs.
actual: Only exact-case names match. Lowercase or numeric type tokens are skipped (loadPrefs continues on idx<0).
why: Stock sound.prf uses exact uppercase names so the bundled map loads. Custom/hand-edited prefs that rely on case-insensitivity or numeric ids silently drop lines.
confidence: high

### L16_sounds-004  Pref tokenizer drops empty tokens; C keeps them as empty sample names
sev: P3
concession: n
ref: reference/src/sound-core.c:195-266 (strchr space walk; consecutive spaces yield a zero-length cur_token that still enters the pool/map)
port: packages/core/src/sound/engine.ts:149 (split(" ").filter(t => t.length > 0)); engine.test.ts:91-95 (asserts collapse to ["a","b"])
expected: "a  b" defines three entries: "a", "", "b" (empty name still gets a sound id if under the per-message cap).
actual: Port drops empties; double spaces never create a blank sample. Unit test documents the divergence as if it matched C.
why: Stock sound.prf has no double spaces (max impact none). Custom prefs with odd spacing would map different id lists / counts and change randint0 range.
confidence: high

### L16_sounds-005  Browser autoplay policy can swallow play() until a user gesture
sev: P2
concession: y
ref: reference/src/snd-sdl.c:177-198 (Mix_Play* plays immediately when the mixer is open); reference/src/message.c:368-374 (sound() only gated by use_sound)
port: packages/web/src/sound.ts:108-110 (void plat.audio.play().catch(() => {}))
expected: With use_sound on and a loaded sample, play_sound produces audible output without an extra unlock step.
actual: Browsers may reject HTMLMediaElement.play() before a user gesture; the rejection is swallowed and the game stays silent. Toggling use_sound or any prior key/click usually unlocks later plays.
why: Unavoidable browser security model; no native mixer equivalent. Logged so silent-on-first-enable is not blamed on the core map.
confidence: high

### L16_sounds-006  No open_audio equivalent of Mix_OpenAudio(22050, S16, stereo, 4096)
sev: P3
concession: y
ref: reference/src/snd-sdl.c:65-83 (open_audio_sdl: SDL_Init audio + Mix_OpenAudio 22050/AUDIO_S16/2/4096); reference/src/sound-core.c:376-380 (init_sound fails without successful open_audio_hook)
port: packages/web/src/sound.ts:71-126 (no openAudio/closeAudio hooks); packages/core/src/sound/engine.ts:230-236 (openAudio optional; missing hook still inits)
expected: Platform opens a 22050 Hz S16 stereo mixer before EVENT_SOUND is hooked; failure aborts sound init.
actual: Browser uses the UA default audio pipeline (typically 44.1/48 kHz). No open failure path; hooks always "succeed". Subtle resampling/latency differences only.
why: No raw mixer API in the browser; unavoidable host difference. Not a mapping or sample-selection defect.
confidence: high

### L16_sounds-007  print_sound_help / sound module registry not ported
sev: P3
concession: y
ref: reference/src/sound-core.c:60-72,356-370,431-437 (sound_modules[] sdl/win/cocoa; init_sound name select; print_sound_help)
port: NONE (web always uses createWebSoundHooks; no -s module CLI)
expected: CLI lists and selects platform sound modules by name.
actual: Single browser backend, installed from main.ts. No help text or module switch.
why: Host packaging / CLI surface only; browser has one audio API. No play-path sample map impact.
confidence: high

### L16_sounds-008  lib/sounds Makefile install rules have no make consumer
sev: P3
concession: y
ref: reference/lib/sounds/Makefile (DATA list of all 213 mp3; PACKAGE=sounds buildsys install)
port: NONE (assets shipped as packages/web/public/sounds/* via Vite static public/)
expected: Native install copies the sound pack into the game lib tree.
actual: Browser static hosting + optional ?sounds= base URL. No Makefile path.
why: Host packaging only (same class as tiles Makefiles). Assets themselves are present and byte-identical.
confidence: high

### L16_sounds-009  Runtime user sound.prf overrides not loadable (compile-time map only)
sev: P3
concession: n
ref: reference/src/sound-core.c:273-304 (register_sound_pref_parser + parse_prefs_sound during pref load; user customize can replace sound: lines); reference/lib/customize/sound.prf
port: packages/core/src/sound/sound-prefs-data.ts (generated SOUND_PREF_ENTRIES); packages/web/src/sound.ts:149 (engine.loadPrefs(SOUND_PREF_ENTRIES) only)
expected: A user/custom sound.prf can redefine message->sample lists at pref-load time without rebuilding the game.
actual: Only the baked 149-entry table is loaded. Sample *files* can be swapped via ?sounds=/baseUrl, but message mapping cannot be overridden at runtime.
why: Faithful equivalent (fetch+parse sound.prf) is achievable in-browser; stock map matches upstream so default play is correct.
confidence: high

### L16_sounds-010  snd-win.h Windows MCI module has no native port (web substitute only)
sev: P3
concession: y
ref: reference/src/snd-win.h:31 (init_sound_win); reference/src/main-win.c play_sound_win / load paths
port: NONE as Win MCI; substitute packages/web/src/sound.ts (HTMLAudio SoundHooks)
expected: Windows builds can use the win sound module when SDL is off.
actual: Browser port never loads MCI/PlaySound. HTMLAudio covers the platform half.
why: Unavoidable platform swap for a web target; core sound-core behavior is what must match.
confidence: high

## MAP L16_sounds
reference/src/sound.h -> packages/core/src/sound/types.ts (SoundStatus, SoundData, SoundFileType, SoundHooks, MAX_SOUNDS_PER_MESSAGE); packages/core/src/sound/engine.ts (API surface)
reference/src/sound-core.c -> packages/core/src/sound/engine.ts (SoundEngine: message_sound_define, load_sound, play_sound, init/close, loadPrefs); packages/core/src/sound/sound-prefs-data.ts (SOUND_PREF_ENTRIES from sound.prf); packages/core/src/sound/index.ts; packages/core/scripts/gen-sound-prefs.mjs; live emit packages/web/src/main.ts state.sound + packages/core/src/game/* state.sound calls; ambient packages/core/src/game/world.ts playAmbientSound
reference/src/snd-sdl.c -> packages/web/src/sound.ts (createWebSoundHooks / installWebSound: open/load/play/unload analogue via HTMLAudioElement; format order .mp3 then .ogg)
reference/src/snd-sdl.h -> packages/web/src/sound.ts (init_sound_sdl analogue: installWebSound wires hooks)
reference/src/snd-win.h -> NONE (Windows MCI module; web substitute packages/web/src/sound.ts)
reference/lib/sounds/Makefile -> NONE (install packaging; web uses public/sounds static ship)
(support) reference/lib/customize/sound.prf -> packages/core/src/sound/sound-prefs-data.ts (149 sound: lines; not in lane file list but is the msgt map oracle)
(support) packages/core/src/generated/message.ts -> MSG_* indices for lookup/play
(support) packages/core/src/msg.ts -> Messages.sound use_sound gate (facade; live path uses state.sound in main.ts)
(support) packages/web/src/main.ts -> installWebSound, use_sound gate, default baseUrl "sounds/"
reference/lib/sounds/amb_bell_metal1.mp3 -> packages/web/public/sounds/amb_bell_metal1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_metal2.mp3 -> packages/web/public/sounds/amb_bell_metal2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_tibet1.mp3 -> packages/web/public/sounds/amb_bell_tibet1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_tibet2.mp3 -> packages/web/public/sounds/amb_bell_tibet2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_tibet3.mp3 -> packages/web/public/sounds/amb_bell_tibet3.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_door_doom.mp3 -> packages/web/public/sounds/amb_door_doom.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_door_iron.mp3 -> packages/web/public/sounds/amb_door_iron.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_dungeon_echo.mp3 -> packages/web/public/sounds/amb_dungeon_echo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_dungeon_echowet.mp3 -> packages/web/public/sounds/amb_dungeon_echowet.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_chinese.mp3 -> packages/web/public/sounds/amb_gong_chinese.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_low.mp3 -> packages/web/public/sounds/amb_gong_low.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_strike.mp3 -> packages/web/public/sounds/amb_gong_strike.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_undertone.mp3 -> packages/web/public/sounds/amb_gong_undertone.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_guitar_chord.mp3 -> packages/web/public/sounds/amb_guitar_chord.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_pulse_low.mp3 -> packages/web/public/sounds/amb_pulse_low.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_thunder_rain.mp3 -> packages/web/public/sounds/amb_thunder_rain.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_thunder_roll.mp3 -> packages/web/public/sounds/amb_thunder_roll.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_aww.mp3 -> packages/web/public/sounds/id_bad_aww.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_dang.mp3 -> packages/web/public/sounds/id_bad_dang.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_hmm.mp3 -> packages/web/public/sounds/id_bad_hmm.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_hmph.mp3 -> packages/web/public/sounds/id_bad_hmph.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_ohh.mp3 -> packages/web/public/sounds/id_bad_ohh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_whoa.mp3 -> packages/web/public/sounds/id_ego_whoa.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_woohoo.mp3 -> packages/web/public/sounds/id_ego_woohoo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_yeah.mp3 -> packages/web/public/sounds/id_ego_yeah.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_yeah2.mp3 -> packages/web/public/sounds/id_ego_yeah2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_yes.mp3 -> packages/web/public/sounds/id_ego_yes.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_hey.mp3 -> packages/web/public/sounds/id_good_hey.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_hey2.mp3 -> packages/web/public/sounds/id_good_hey2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_hmm.mp3 -> packages/web/public/sounds/id_good_hmm.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_huh.mp3 -> packages/web/public/sounds/id_good_huh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_ooh.mp3 -> packages/web/public/sounds/id_good_ooh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_ooo.mp3 -> packages/web/public/sounds/id_good_ooo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_wow.mp3 -> packages/web/public/sounds/id_good_wow.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_attack_breath.mp3 -> packages/web/public/sounds/mco_attack_breath.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_attack_spray.mp3 -> packages/web/public/sounds/mco_attack_spray.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_chew.mp3 -> packages/web/public/sounds/mco_bite_chew.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_chomp.mp3 -> packages/web/public/sounds/mco_bite_chomp.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_dainty.mp3 -> packages/web/public/sounds/mco_bite_dainty.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_gnash.mp3 -> packages/web/public/sounds/mco_bite_gnash.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_hard.mp3 -> packages/web/public/sounds/mco_bite_hard.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_long.mp3 -> packages/web/public/sounds/mco_bite_long.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_munch.mp3 -> packages/web/public/sounds/mco_bite_munch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_regular.mp3 -> packages/web/public/sounds/mco_bite_regular.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_short.mp3 -> packages/web/public/sounds/mco_bite_short.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_small.mp3 -> packages/web/public/sounds/mco_bite_small.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_soft.mp3 -> packages/web/public/sounds/mco_bite_soft.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_card_shuffle.mp3 -> packages/web/public/sounds/mco_card_shuffle.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_castanet_trill.mp3 -> packages/web/public/sounds/mco_castanet_trill.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_ceramic_trill.mp3 -> packages/web/public/sounds/mco_ceramic_trill.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_click_vibra.mp3 -> packages/web/public/sounds/mco_click_vibra.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_creature_choking.mp3 -> packages/web/public/sounds/mco_creature_choking.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_creature_groan.mp3 -> packages/web/public/sounds/mco_creature_groan.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_creature_yelp.mp3 -> packages/web/public/sounds/mco_creature_yelp.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_cuica_rubbing.mp3 -> packages/web/public/sounds/mco_cuica_rubbing.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_low.mp3 -> packages/web/public/sounds/mco_dino_low.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_slur.mp3 -> packages/web/public/sounds/mco_dino_slur.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_talk.mp3 -> packages/web/public/sounds/mco_dino_talk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_yawn.mp3 -> packages/web/public/sounds/mco_dino_yawn.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dub_wobble.mp3 -> packages/web/public/sounds/mco_dub_wobble.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_frog_trill.mp3 -> packages/web/public/sounds/mco_frog_trill.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_hit_whip.mp3 -> packages/web/public/sounds/mco_hit_whip.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_croak.mp3 -> packages/web/public/sounds/mco_howl_croak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_deep.mp3 -> packages/web/public/sounds/mco_howl_deep.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_distressed.mp3 -> packages/web/public/sounds/mco_howl_distressed.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_high.mp3 -> packages/web/public/sounds/mco_howl_high.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_long.mp3 -> packages/web/public/sounds/mco_howl_long.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_liquid_squirt.mp3 -> packages/web/public/sounds/mco_liquid_squirt.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_man_mumble.mp3 -> packages/web/public/sounds/mco_man_mumble.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_mouse_squeaks.mp3 -> packages/web/public/sounds/mco_mouse_squeaks.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_rubber_thud.mp3 -> packages/web/public/sounds/mco_rubber_thud.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_scurry_dry.mp3 -> packages/web/public/sounds/mco_scurry_dry.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_shake_roll.mp3 -> packages/web/public/sounds/mco_shake_roll.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_snarl_short.mp3 -> packages/web/public/sounds/mco_snarl_short.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_spray_long.mp3 -> packages/web/public/sounds/mco_spray_long.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_squish_hit.mp3 -> packages/web/public/sounds/mco_squish_hit.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_squish_snap.mp3 -> packages/web/public/sounds/mco_squish_snap.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_strange_music.mp3 -> packages/web/public/sounds/mco_strange_music.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_strange_thwoink.mp3 -> packages/web/public/sounds/mco_strange_thwoink.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_thoing_backwards.mp3 -> packages/web/public/sounds/mco_thoing_backwards.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_thoing_deep.mp3 -> packages/web/public/sounds/mco_thoing_deep.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_thud_crash.mp3 -> packages/web/public/sounds/mco_thud_crash.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_tube_hit.mp3 -> packages/web/public/sounds/mco_tube_hit.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_bell_warn.mp3 -> packages/web/public/sounds/plc_bell_warn.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_die_laugh.mp3 -> packages/web/public/sounds/plc_die_laugh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_anvil.mp3 -> packages/web/public/sounds/plc_hit_anvil.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_anvil2.mp3 -> packages/web/public/sounds/plc_hit_anvil2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_arrow.mp3 -> packages/web/public/sounds/plc_hit_arrow.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_body.mp3 -> packages/web/public/sounds/plc_hit_body.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_groan.mp3 -> packages/web/public/sounds/plc_hit_groan.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_grunt.mp3 -> packages/web/public/sounds/plc_hit_grunt.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_grunt2.mp3 -> packages/web/public/sounds/plc_hit_grunt2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_hay.mp3 -> packages/web/public/sounds/plc_hit_hay.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_miss_arrow.mp3 -> packages/web/public/sounds/plc_miss_arrow.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_miss_arrow2.mp3 -> packages/web/public/sounds/plc_miss_arrow2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_miss_swish.mp3 -> packages/web/public/sounds/plc_miss_swish.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_aim_wand.mp3 -> packages/web/public/sounds/plm_aim_wand.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bang_ceramic.mp3 -> packages/web/public/sounds/plm_bang_ceramic.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bang_dumpster.mp3 -> packages/web/public/sounds/plm_bang_dumpster.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bang_metal.mp3 -> packages/web/public/sounds/plm_bang_metal.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_book_pageturn.mp3 -> packages/web/public/sounds/plm_book_pageturn.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bottle_clinks.mp3 -> packages/web/public/sounds/plm_bottle_clinks.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_canister.mp3 -> packages/web/public/sounds/plm_break_canister.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_glass.mp3 -> packages/web/public/sounds/plm_break_glass.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_glass2.mp3 -> packages/web/public/sounds/plm_break_glass2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_plates.mp3 -> packages/web/public/sounds/plm_break_plates.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_shatter.mp3 -> packages/web/public/sounds/plm_break_shatter.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_smash.mp3 -> packages/web/public/sounds/plm_break_smash.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_wood.mp3 -> packages/web/public/sounds/plm_break_wood.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cabinet_open.mp3 -> packages/web/public/sounds/plm_cabinet_open.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cabinet_shut.mp3 -> packages/web/public/sounds/plm_cabinet_shut.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chain_light.mp3 -> packages/web/public/sounds/plm_chain_light.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chest_latch.mp3 -> packages/web/public/sounds/plm_chest_latch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chest_unlatch.mp3 -> packages/web/public/sounds/plm_chest_unlatch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chimes_jangle.mp3 -> packages/web/public/sounds/plm_chimes_jangle.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_dry.mp3 -> packages/web/public/sounds/plm_click_dry.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_switch.mp3 -> packages/web/public/sounds/plm_click_switch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_switch2.mp3 -> packages/web/public/sounds/plm_click_switch2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_switch3.mp3 -> packages/web/public/sounds/plm_click_switch3.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_wood.mp3 -> packages/web/public/sounds/plm_click_wood.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_close_hatch.mp3 -> packages/web/public/sounds/plm_close_hatch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_dump.mp3 -> packages/web/public/sounds/plm_coins_dump.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_light.mp3 -> packages/web/public/sounds/plm_coins_light.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_pour.mp3 -> packages/web/public/sounds/plm_coins_pour.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_shake.mp3 -> packages/web/public/sounds/plm_coins_shake.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cork_pop.mp3 -> packages/web/public/sounds/plm_cork_pop.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cork_squeak.mp3 -> packages/web/public/sounds/plm_cork_squeak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_bolt.mp3 -> packages/web/public/sounds/plm_door_bolt.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_creak.mp3 -> packages/web/public/sounds/plm_door_creak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_creakshut.mp3 -> packages/web/public/sounds/plm_door_creakshut.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_dungeon.mp3 -> packages/web/public/sounds/plm_door_dungeon.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_echolock.mp3 -> packages/web/public/sounds/plm_door_echolock.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_entrance.mp3 -> packages/web/public/sounds/plm_door_entrance.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_knob.mp3 -> packages/web/public/sounds/plm_door_knob.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_latch.mp3 -> packages/web/public/sounds/plm_door_latch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_open.mp3 -> packages/web/public/sounds/plm_door_open.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_opening.mp3 -> packages/web/public/sounds/plm_door_opening.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_rusty.mp3 -> packages/web/public/sounds/plm_door_rusty.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_shut.mp3 -> packages/web/public/sounds/plm_door_shut.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_slam.mp3 -> packages/web/public/sounds/plm_door_slam.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_squeaky.mp3 -> packages/web/public/sounds/plm_door_squeaky.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_wooden.mp3 -> packages/web/public/sounds/plm_door_wooden.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_drop_boot.mp3 -> packages/web/public/sounds/plm_drop_boot.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_eat_bite.mp3 -> packages/web/public/sounds/plm_eat_bite.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_floor_creak.mp3 -> packages/web/public/sounds/plm_floor_creak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_floor_creak2.mp3 -> packages/web/public/sounds/plm_floor_creak2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_glass_break.mp3 -> packages/web/public/sounds/plm_glass_break.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_glass_breaking.mp3 -> packages/web/public/sounds/plm_glass_breaking.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_glass_smashing.mp3 -> packages/web/public/sounds/plm_glass_smashing.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_jar_ding.mp3 -> packages/web/public/sounds/plm_jar_ding.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_levelup.mp3 -> packages/web/public/sounds/plm_levelup.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_lock_case.mp3 -> packages/web/public/sounds/plm_lock_case.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_lock_distant.mp3 -> packages/web/public/sounds/plm_lock_distant.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_metal_clank.mp3 -> packages/web/public/sounds/plm_metal_clank.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_metal_sharpen.mp3 -> packages/web/public/sounds/plm_metal_sharpen.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_open_case.mp3 -> packages/web/public/sounds/plm_open_case.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_spell1.mp3 -> packages/web/public/sounds/plm_spell1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_spell2.mp3 -> packages/web/public/sounds/plm_spell2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_spell3.mp3 -> packages/web/public/sounds/plm_spell3.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_use_staff.mp3 -> packages/web/public/sounds/plm_use_staff.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_wood_thud.mp3 -> packages/web/public/sounds/plm_wood_thud.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_zap_rod.mp3 -> packages/web/public/sounds/plm_zap_rod.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_bowl.mp3 -> packages/web/public/sounds/pls_bell_bowl.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_chime_new.mp3 -> packages/web/public/sounds/pls_bell_chime_new.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_glass.mp3 -> packages/web/public/sounds/pls_bell_glass.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_hibell_soft.mp3 -> packages/web/public/sounds/pls_bell_hibell_soft.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_mute.mp3 -> packages/web/public/sounds/pls_bell_mute.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_sustain.mp3 -> packages/web/public/sounds/pls_bell_sustain.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_breathe_in.mp3 -> packages/web/public/sounds/pls_breathe_in.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_argoh.mp3 -> packages/web/public/sounds/pls_man_argoh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_gulp_new.mp3 -> packages/web/public/sounds/pls_man_gulp_new.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_oooh.mp3 -> packages/web/public/sounds/pls_man_oooh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_scream2.mp3 -> packages/web/public/sounds/pls_man_scream2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_sigh.mp3 -> packages/web/public/sounds/pls_man_sigh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_sniff.mp3 -> packages/web/public/sounds/pls_man_sniff.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_sob.mp3 -> packages/web/public/sounds/pls_man_sob.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_spit.mp3 -> packages/web/public/sounds/pls_man_spit.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_ugh.mp3 -> packages/web/public/sounds/pls_man_ugh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_yell.mp3 -> packages/web/public/sounds/pls_man_yell.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_blurk.mp3 -> packages/web/public/sounds/pls_tone_blurk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_clave6.mp3 -> packages/web/public/sounds/pls_tone_clave6.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_clavelo8.mp3 -> packages/web/public/sounds/pls_tone_clavelo8.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_conk.mp3 -> packages/web/public/sounds/pls_tone_conk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_elec.mp3 -> packages/web/public/sounds/pls_tone_elec.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_goblet.mp3 -> packages/web/public/sounds/pls_tone_goblet.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_guiro.mp3 -> packages/web/public/sounds/pls_tone_guiro.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_headstock.mp3 -> packages/web/public/sounds/pls_tone_headstock.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_scrape.mp3 -> packages/web/public/sounds/pls_tone_scrape.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_stick.mp3 -> packages/web/public/sounds/pls_tone_stick.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_desk.mp3 -> packages/web/public/sounds/sto_bell_desk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_ding.mp3 -> packages/web/public/sounds/sto_bell_ding.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_dingaling.mp3 -> packages/web/public/sounds/sto_bell_dingaling.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_jingles.mp3 -> packages/web/public/sounds/sto_bell_jingles.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_register1.mp3 -> packages/web/public/sounds/sto_bell_register1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_register2.mp3 -> packages/web/public/sounds/sto_bell_register2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_ringing.mp3 -> packages/web/public/sounds/sto_bell_ringing.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_shop.mp3 -> packages/web/public/sounds/sto_bell_shop.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_coins_countertop.mp3 -> packages/web/public/sounds/sto_coins_countertop.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_man_haha.mp3 -> packages/web/public/sounds/sto_man_haha.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_man_hey.mp3 -> packages/web/public/sounds/sto_man_hey.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_man_whoohaha.mp3 -> packages/web/public/sounds/sto_man_whoohaha.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ainu_song.mp3 -> packages/web/public/sounds/sum_ainu_song.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_bell_crystal.mp3 -> packages/web/public/sounds/sum_bell_crystal.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_bell_hand.mp3 -> packages/web/public/sounds/sum_bell_hand.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_bell_tone.mp3 -> packages/web/public/sounds/sum_bell_tone.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_chime_jangle.mp3 -> packages/web/public/sounds/sum_chime_jangle.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ghost_moan.mp3 -> packages/web/public/sounds/sum_ghost_moan.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ghost_oooo.mp3 -> packages/web/public/sounds/sum_ghost_oooo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ghost_wail.mp3 -> packages/web/public/sounds/sum_ghost_wail.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_gong_temple.mp3 -> packages/web/public/sounds/sum_gong_temple.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_laugh_evil2.mp3 -> packages/web/public/sounds/sum_laugh_evil2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_lion_growl.mp3 -> packages/web/public/sounds/sum_lion_growl.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_piano_scrape.mp3 -> packages/web/public/sounds/sum_piano_scrape.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)

# ===== L17_fonts_screens_help =====

# L17_fonts_screens_help audit (fonts / splash screens / help / pref customize)
Auditor: grok. Method: re-derivation against reference C and assets (not prior ledgers).
Lane: reference/lib/fonts/**, lib/screens/**, lib/help/**, lib/customize/**.
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary:
- Fonts: only reference/lib/fonts/16x24x.fon is embedded as packages/web/src/font-16x24.ts
  (regenerated by packages/web/scripts/extract-fon.py). GlyphTerm (packages/web/src/term.ts)
  blits FONT_16X24 for code points 0-255. All other .fon / .woff files are absent from the port.
- Screens: dead.txt + crown.txt art inlined in packages/web/src/screens.ts (DEAD_TOMB_ART /
  CROWN_ART + tombstoneLines / winnerLines). news.txt inlined in packages/web/src/news.ts.
  retire.txt is NOT embedded; retired deaths still use dead.txt art.
- Help: packages/web/src/help.ts is a curated browser (runHelp), not a show_file loader of
  lib/help/*.txt. Commands page is intentionally non-verbatim; symbols page is near-verbatim
  but diverges on monster letters and intro; no r_comm / r_index path.
- Customize: sound.prf is codegen'd (packages/core/scripts/gen-sound-prefs.mjs ->
  sound-prefs-data.ts). message.prf / font*.prf / user.prf are not loaded. pref.prf keymaps
  are only partially reimplemented in keymap.ts + main.ts (not process_pref_file).

Verified equalities (no finding):
- news.txt body lines match packages/web/src/news.ts NEWS array exactly (22 lines).
- crown.txt body after the "25" width hint matches CROWN_ART exactly (19 lines).
- dead.txt art matches DEAD_TOMB_ART after rstrip of trailing spaces (content identical;
  trailing pad only differs).
- 16x24x.fon re-extract equals committed font-16x24.ts byte-for-byte (extract-fon.py).
- sound.prf sound: directives are present as SOUND_PREF_ENTRIES (covered also by L16).
- tombstone field placement (rows 7..18, band [8,39], retired wording) matches
  display_exit_screen (ui-death.c L86-112) aside from the retire art background.

### L17_fonts_screens_help-001  Retire death screen draws dead.txt art, never retire.txt
sev: P2
concession: n
ref: reference/src/ui-death.c:74-76 (path_build retire.txt when died_from=="Retiring", else dead.txt); reference/lib/screens/retire.txt (20-line retirement art); reference/lib/screens/dead.txt (tombstone)
port: packages/web/src/screens.ts:1294-1419 (tombstoneLines always seeds DEAD_TOMB_ART; retired only changes epitaph text); packages/web/src/main.ts:3354,3907-3918 (comments claim retire branch; no retire art constant anywhere under packages/web/src)
expected: On retirement, display_exit_screen opens retire.txt as the background (a distinct ASCII piece), then centres the same epitaph fields including "Retired on Level N".
actual: retired=true still paints the RIP tombstone from dead.txt; only the "Killed"/"by" lines swap to "Retired on Level N". No retire art is embedded or selected.
why: Immediate wrong death/retirement look on the Q retire path; C and the port do not share the same memorial graphic.
confidence: high

### L17_fonts_screens_help-002  help.ts labels S as Save and V as hall of fame; live keys differ
sev: P2
concession: n
ref: reference/lib/help/commands.txt:37,39 (S See abilities; V Display version info); reference/src/ui-game.c cmd tables (S abilities, ^s save, V version)
port: packages/web/src/help.ts:116-118 (S "Save the game"; V "Display the hall of fame"); packages/web/src/main.ts:5415-5421 (^S autosave), 5559 (o:"S" -> showAbilitiesScreen), 5575 (o:"V" -> versionCmd)
expected: In-game help for the original keyset must match both commands.txt and the live keytable: S = See abilities, V = version, save is ^s (and Escape menu).
actual: helpCommandLines claims S saves and V opens the hall of fame. Both are wrong for this shell: plain S opens abilities; V is version; hall of fame is under knowledge (~); save is Ctrl-S / Escape menu.
why: Players following ? learn incorrect keys for core meta commands; help.test.ts drift guard only checks that listed keys exist, not that their descriptions match main.ts.
confidence: high

### L17_fonts_screens_help-003  symbols help assigns Xorn to lowercase x; drops X and N blanks
sev: P2
concession: n
ref: reference/lib/help/symbols.txt:78,88 (n Naga / N - ; x - / X Xorn/Xaren)
port: packages/web/src/help.ts:213-236 (MONSTERS: n Naga only; x "Xorn/Xaren"; no X entry, no N blank)
expected: symbols.txt two-column monster table: lowercase x is blank ("-"), uppercase X is Xorn/Xaren; uppercase N is blank ("-").
actual: Port has 52 monster rows vs 54 ref pairs; maps x -> Xorn/Xaren and omits X and N. A player looking up map glyph X cannot find it; x is wrong.
why: Visible in-game help error for two common high-level monster letters; contradicts the mon base symbols the port actually draws.
confidence: high

### L17_fonts_screens_help-004  Command help is a curated subset that omits many live keys listed in commands.txt
sev: P2
concession: n
ref: reference/lib/help/commands.txt:18-73 (full original keyset: R rest, Q retire, ~ knowledge, / identify symbol, [ mon list, : notes, ) screen dump, . run, etc.); reference/src/ui-help.c:470 (do_cmd_help opens index.txt -> commands.txt verbatim via show_file)
port: packages/web/src/help.ts:16-27,65-125 (curated list); packages/web/src/help.test.ts:37-44 (explicitly forbids "Rest for", "Retire character", "Check knowledge", "Take notes", "Dump screen" in help text); packages/web/src/main.ts:5530,5566-5578,5571 (R, /, ~, :, ), Q all wired live)
expected: ? shows the stock commands.txt summary for the active keyset (or a faithful subset that still documents every implemented command with correct names).
actual: helpCommandLines omits rest, retire, knowledge, symbol query, monster list, notes, screen dump, run/hold, steal, alter, and more even though main.ts implements them. Unit tests lock in the omissions.
why: In-game help actively under-documents a large set of working keys; diverges from the oracle help file and misleads players who open ?.
confidence: high

### L17_fonts_screens_help-005  No roguelike help tree (r_index.txt / r_comm.txt unused)
sev: P2
concession: n
ref: reference/lib/help/r_index.txt:21 (.. menu:: [a] r_comm.txt); reference/lib/help/r_comm.txt (full roguelike keyset summary); C loads r_index when rogue_like_commands is set (ui-help path)
port: packages/web/src/help.ts:298-302 (HELP_INDEX always Commands / Symbols / Playing guide; no roguelike branch); no r_comm content in packages/
expected: With rogue_like_commands on, do_cmd_help opens the roguelike index and r_comm.txt (hjkl movement, swapped fire/look/ignore keys, etc.).
actual: ? always shows the original-keyset curated list regardless of the option. Roguelike players never see r_comm.txt bindings (t fire, x look, O ignore, z aim, Z staff, ...).
why: Wrong help for an entire supported keyset option; players who switch keysets get original-keyset documentation.
confidence: high

### L17_fonts_screens_help-006  symbols help drops the slash-identify and user-pref notes though / is live
sev: P2
concession: n
ref: reference/lib/help/symbols.txt:14-19 (slash '/' identifies symbols; user pref file can remap symbols)
port: packages/web/src/help.ts:25-27,243-261 (explicitly strips those lines); packages/web/src/main.ts:3216-3222,5566 (querySymbolCmd wired to /)
expected: symbols page tells the player that / identifies any map character (commands.txt / symbols.txt).
actual: helpSymbolLines omits both the slash paragraph and the pref remapping note. / works in the shell but help never mentions it.
why: Core discoverability for map literacy is missing from the symbols page that claims to be near-verbatim.
confidence: high

### L17_fonts_screens_help-007  message.prf default colors never applied (BELL / HITPOINT_WARN / AFRAID stay white)
sev: P2
concession: n
ref: reference/lib/customize/message.prf (150 message: lines; non-white: BELL:o, HITPOINT_WARN:o, AFRAID:o); reference/src/ui-init.c process_pref_file("pref.prf") includes %:message.prf; message_color_define
port: packages/core/src/msg.ts:77-86 (colorDefine / typeColor exist); no loader of message.prf under packages/ (only msg.test.ts calls colorDefine); packages/web/src/main.ts:901-917 (say/msglog.push with no MSG type color)
expected: After boot prefs, MSG_BELL / MSG_HITPOINT_WARN / MSG_AFRAID render orange; other types white per message.prf.
actual: MessageLog colors map is empty at runtime. Low-HP warning, bell, and fear messages use the default white/UI color path. The three non-white stock overrides never load.
why: Visible message chrome drift on the warning path (*** LOW HITPOINT WARNING! *** and related typed messages).
confidence: high

### L17_fonts_screens_help-008  pref.prf Shift+numpad run keymaps not implemented (original keyset)
sev: P1
concession: n
ref: reference/lib/customize/pref.prf:123-203 (keymap-act:.N with {S}/{SK} numpad and arrows for original keyset mode 0 = run); reference/src/ui-init.c:50 process_pref_file("pref.prf")
port: packages/web/src/keymap.ts:53-70 (DIRS_ORIGINAL always kind "walk"; shiftKey only used for roguelike letter run); packages/web/src/main.ts:5611-5632 (resolveKey walk -> queueWalk; run only from "." runDirCmd prompt or roguelike Shift+letter)
expected: Holding Shift with numpad/arrow directions runs (.1-.9) in the original keyset, as shipped in pref.prf.
actual: Shift+numpad still walks one step. Original-keyset run requires the "." direction prompt (or a user keymap). Roguelike Shift+hjkl run works; original does not get the pref.prf run maps.
why: Core movement convenience for the default keyset is missing; differs from stock Angband play.
confidence: high

### L17_fonts_screens_help-009  pref.prf not loaded; Ctrl+direction alter and full keymap table absent
sev: P2
concession: n
ref: reference/lib/customize/pref.prf:206-356 (keymap-act:+N Ctrl+numpad alter; roguelike letter run/alter; stay-still 5/,; w0 on x); reference/src/ui-prefs.c process_pref_file
port: packages/web/src/main.ts:5532-5535,5577,5583-5588 (hardcoded x->swapWeapon, +->alter prompt, ./, hold, 5 hold); packages/web/src/keymap.ts (movement only); packages/web/src/main.ts:4338-4346 (prefLineCmd always "Pref command not recognized.")
expected: Boot loads pref.prf into the keymap tables; " opens a live pref-command parser; Ctrl+direction alters, etc.
actual: No process_pref_file of pref.prf. A subset is hand-wired; Ctrl+numpad alter and most of the file's input aliases are missing. The " pref line command is a stub that never parses.
why: Default keymaps and user pref editing diverge from the oracle customize path; only partial behavioral overlap.
confidence: high

### L17_fonts_screens_help-010  Alternate .fon fonts and font picker not ported (only 16x24x)
sev: P3
concession: ?
ref: reference/lib/fonts/*.fon (24 .fon + 16x16xw.woff); reference/lib/fonts/Makefile DATA list; reference/src/main-sdl.c:184 default_term_font "6x10x.fon"; main-sdl2.c DEFAULT_FONT "10x20x.fon"; font browser in main-sdl.c
port: packages/web/src/font-16x24.ts + term.ts FONT_16X24 only; packages/web/scripts/extract-fon.py can regenerate other sizes but no other font-*.ts ships; no font-selection UI
expected: Front ends ship the full font set and let the player pick a preset .fon (size/bold variants).
actual: Web hardcodes the 16x24 bitmap (faithful extract of 16x24x.fon). Other 23 .fon files and the .woff have no package counterparts and cannot be selected.
why: Look-and-feel / cell aspect differs from SDL defaults (6x10 / 10x20). Browser may reasonably fix one glyph set; marked concession uncertain because multi-font is achievable with the existing extractor.
confidence: high

### L17_fonts_screens_help-011  font-*.prf platform attr/char remaps not applied
sev: P3
concession: y
ref: reference/lib/customize/font.prf (includes font-win/sdl/x11/gcu/ibm by $SYS); font-win.prf feat:open floor:*:1:8 (centered-dot floors) and further feat remaps; loaded via process_pref_file
port: NONE for font*.prf content; ASCII map glyphs come from content pack / tile prefs, not font.prf
expected: Text-mode front ends apply system-specific feat attr/char overrides from font-*.prf.
actual: No font.prf include chain. Web never remaps floors to CP437 centered-dot via font-win.prf etc.
why: Pseudo-graphic wall/floor look from platform font prefs is absent. Partially unavoidable without a native $SYS font stack; tile mode is the web graphics path.
confidence: high

### L17_fonts_screens_help-012  user.prf race/class include chain not processed
sev: P3
concession: n
ref: reference/lib/customize/user.prf:13-79 (?:[EQU $RACE ... ] %:Race.prf and class includes); reference/src/ui-display.c:2669 process_pref_file("user.prf")
port: NONE (no user.prf loader under packages/)
expected: After birth, user.prf may load optional per-race/class pref overrides when those files exist in the user dir.
actual: user.prf is never read. Race/class-conditioned pref includes cannot apply.
why: Stock tree ships only the include skeleton (no Human.prf etc. in lib/customize), so impact is low unless the user adds files; still an unmapped customize path.
confidence: high

### L17_fonts_screens_help-013  news.txt $VERSION not left-padded to 8 columns
sev: P3
concession: n
ref: reference/src/ui-display.c:2460-2463 (strnfmt version_marker "%-8s", buildver)
port: packages/web/src/news.ts:23-24,94 (BASELINE_VERSION "4.2.6" substituted with bare replace, no width pad)
expected: $VERSION expands to an 8-character left-justified field so the mountain art after the version keeps column alignment.
actual: "4.2.6" is 5 characters; the remainder of that news line shifts left by three columns vs C.
why: Minor splash layout drift on the version line of the title screen.
confidence: high

### L17_fonts_screens_help-014  Title screen wait prompt is web-native, not File menu
sev: P2
concession: y
ref: reference/src/main-win.c (news then "[Choose 'New' or 'Open' from the 'File' menu]"); ui-display.c show_splashscreen dumps news.txt then returns to the frontend menu
port: packages/web/src/news.ts:103-106 ("[ Press any key to begin ]"); packages/web/src/main.ts:5954-5974 (maybeTitle)
expected: After news art, the desktop GUI waits on a File/New/Open style instruction (no auto-dungeon entry).
actual: Port shows a press-any-key (or tap) prompt, then continues into roster/birth. There is no File menu in a browser tab.
why: Unavoidable shell difference; logged so the prompt string is not treated as a core map bug. Flow still gates play behind a keypress.
confidence: high

### L17_fonts_screens_help-015  Help index is not index.txt (invented Playing guide; no show_file browser chrome)
sev: P3
concession: n
ref: reference/lib/help/index.txt:9-10,15-19,21-23 ((a) commands (b) symbols only; browser keys # % ? SPACE - / etc.; .. menu:: directives)
port: packages/web/src/help.ts:265-321 (three entries including "Playing guide"; selectFromMenu + showTextScreen without #/%/search)
expected: do_cmd_help runs show_file on index.txt with the full help-browser command set and only the two stock menus.
actual: Index is a hard-coded three-row menu; "Playing guide" is port-authored prose; no line/file search, half-page, or case-toggle commands from index.txt.
why: Peripheral help-browser chrome and an extra page; content for commands/symbols already diverges more severely (findings 002-006).
confidence: high

### L17_fonts_screens_help-016  16x16xw.woff has no web counterpart
sev: P3
concession: y
ref: reference/lib/fonts/16x16xw.woff (web/CSS font form of 16x16xw)
port: NONE under packages/
expected: Any HTML/CSS path that used the woff would ship it next to the .fon set.
actual: Canvas blit uses FONT_16X24 bitmaps only; the woff is unused and unshipped.
why: Not needed for the canvas terminal path; browser concession for the chosen render strategy.
confidence: high

### L17_fonts_screens_help-017  fonts Makefile install set not mirrored as multi-font package data
sev: P3
concession: ?
ref: reference/lib/fonts/Makefile (DATA = full .fon + woff list, PACKAGE = fonts)
port: packages/web/scripts/extract-fon.py (dev-time single-file regenerator); only font-16x24.ts is committed
expected: Install/package step ships every font in DATA for front ends.
actual: No package-level fonts/ tree; Makefile role reduced to a one-font extract script.
why: Same root cause as finding 010; documents the build/install gap for the lane MAP.
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
reference/lib/fonts/16x24x.fon -> packages/web/src/font-16x24.ts, packages/web/src/term.ts, packages/web/scripts/extract-fon.py, packages/web/src/font-16x24.test.ts
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
reference/lib/fonts/Makefile -> packages/web/scripts/extract-fon.py (partial; single-font regen only)
reference/lib/screens/crown.txt -> packages/web/src/screens.ts (CROWN_ART, winnerLines); packages/web/src/main.ts (showTombstone)
reference/lib/screens/dead.txt -> packages/web/src/screens.ts (DEAD_TOMB_ART, tombstoneLines); packages/web/src/main.ts (showTombstone)
reference/lib/screens/news.txt -> packages/web/src/news.ts (NEWS, showTitleScreen); packages/web/src/main.ts (maybeTitle)
reference/lib/screens/retire.txt -> NONE (retired path reuses DEAD_TOMB_ART; text-only branch in tombstoneLines)
reference/lib/help/commands.txt -> packages/web/src/help.ts (helpCommandLines; curated, not verbatim)
reference/lib/help/index.txt -> packages/web/src/help.ts (HELP_INDEX / runHelp; not show_file)
reference/lib/help/r_comm.txt -> NONE
reference/lib/help/r_index.txt -> NONE
reference/lib/help/symbols.txt -> packages/web/src/help.ts (helpSymbolLines; near-verbatim with errors)
reference/lib/customize/font.prf -> NONE
reference/lib/customize/font-gcu.prf -> NONE
reference/lib/customize/font-ibm.prf -> NONE
reference/lib/customize/font-sdl.prf -> NONE
reference/lib/customize/font-sdl2.prf -> NONE
reference/lib/customize/font-win.prf -> NONE
reference/lib/customize/font-x11.prf -> NONE
reference/lib/customize/message.prf -> NONE (msg.ts colorDefine API only; never loaded from prf)
reference/lib/customize/pref.prf -> packages/web/src/keymap.ts, packages/web/src/main.ts, packages/web/src/keymap-store.ts (partial hardcode; not process_pref_file)
reference/lib/customize/sound.prf -> packages/core/scripts/gen-sound-prefs.mjs, packages/core/src/sound/sound-prefs-data.ts, packages/core/src/sound/engine.ts, packages/web/src/sound.ts
reference/lib/customize/user.prf -> NONE
