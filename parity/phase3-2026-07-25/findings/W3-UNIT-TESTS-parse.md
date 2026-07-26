# W3 — adjudication of the 38 upstream `parse/` unit tests

**Date:** 2026-07-26
**Worktree:** `C:\Repositories\na-wt-parse` (`p4/ut-parse`, branched from `master` at `ced815427`)
**Upstream:** `reference/src/tests/parse/*.c` (38 files, 16 087 lines), Angband 4.2.6
**Compared against:** `packages/content/src/data-exactness.test.ts` (the W5 suite) —
see `parity/phase3-2026-07-25/findings/W5-DATA-EXACTNESS.md`

## The architectural fact that drives every verdict

Upstream has one C function per (file, directive) pair, and each does three
things at once: read the fields, resolve names to enum values / cross-record
pointers, and range-check. The port splits that in two:

| Layer | Module | What it does | Covered by W5? |
|---|---|---|---|
| Line grammar | `packages/content/src/parser.ts` | `parser.c` field tokenizing and typing | mechanism only, via `parser.test.ts` |
| Record assembly | `packages/content/src/records.ts` + `specs/*.ts` | `recordStart`, `header`, `repeat`, `childOf`, `orderKey` | **no** — port-supplied on both sides of the diff |
| Resolution / validation | `core/src/obj/bind.ts`, `mon/bind.ts`, `player/bind.ts`, `store/bind.ts`, `world/{feature,trap,projection}.ts`, `constants.ts` | flag-name→bit, tval/sval lookup, base inheritance, range checks | **no** — W5 stops at the pack |

So W5 subsumes exactly one of the three things an upstream `parse/` handler
test asserts: that a well-formed directive's value lands in the right field. It
proves that over 44 files / 3 194 records / 57 045 leaf fields — a strictly
larger set of well-formed cases than any upstream fixture. It cannot see
anything in rows 2 or 3 of that table.

**Consequence:** almost every upstream file is `PARTIAL`, because almost every
one carries at least a `test_missing_record_header0` (row 2) or a `*_bad0` (row
3). `SUBSUMED` is rare and I have only awarded it once. Under-claiming is the
safe direction, as instructed.

### Verdict definitions used below

- **SUBSUMED** — every case reduces to well-formed directive→field mapping.
- **PARTIAL** — the bulk is subsumed, but ≥1 case hits criterion 1–4.
- **PORT** — the file's centre of gravity is un-subsumed.

Criteria, from the brief: **(1)** error/rejection paths, **(2)**
`repeat`/`childOf`/`recordStart`/`header` metadata, **(3)** post-parse
resolution / flag-bit mapping / dice evaluation, **(4)** ordering and
interleaving.

## Counts

| Verdict | Count |
|---|---:|
| SUBSUMED | 1 |
| PARTIAL | 29 |
| PORT | 8 |
| **total** | **38** |

Ported in this branch: cases drawn from **17** of the 38 (all 8 `PORT` files
except `graphics.c`, plus 10 `PARTIAL` files). 21 files deferred — listed
explicitly in "Deferred" below.

## Adjudication — one row per file

| # | Upstream file | Port target | Verdict | Not subsumed by W5 — which cases, and which criterion |
|--:|---|---|---|---|
| 1 | `a-info.c` (599) | `artifact` spec + `obj/bind.ts` | PARTIAL | `test_missing_record_header0`: 17 directives that need `name:` first — **(2)** the `recordStart` oracle. `test_badtval0/1` UNRECOGNISED_TVAL, `test_graphics_bad0` NOT_SPECIAL_ARTIFACT, `test_flags_bad0` (incl. `HATES_XYZZY`/`IGNORE_XYZZY` element-suffix forms), `test_values_bad0`, `test_alloc1/2` INVALID_ALLOCATION + OUT_OF_BOUNDS, `test_slay/brand/curse_bad0` — all **(1)**. Subsumed: name/level/weight/cost/attack/armor/act/time/msg/desc landing. |
| 2 | `blowe.c` (302) | `blow_effects` spec + `mon/bind.ts` | PARTIAL | missing-record-header (`lore-color-base/resist/immune`) — **(2)**. `test_effect_type_bad0` MISSING_BLOW_EFF_TYPE, `test_resist_bad0`, `test_lash_type_bad0` — **(1)**. `test_lore_color_*` pin colour-name→attr resolution — **(3)**. |
| 3 | `blowm.c` (200) | `blow_methods` spec + `mon/bind.ts` | PARTIAL | missing-record-header (`act:`) — **(2)**. `test_msg_bad0` INVALID_MESSAGE: msgt name→`MSG_*` mapping — **(1)+(3)**. `test_act0` `act:` accumulation — **(2)**. |
| 4 | `body.c` (183) | `body` spec + `player/bind.ts` | PARTIAL | missing-record-header (`slot:`) — **(2)**, and it pins `body:` (not `name:`) as the header. `test_slot_bad0` INVALID_FLAG: equip-slot name→index — **(1)+(3)**. `test_complete0` slot order/count — **(4)**. |
| 5 | `brand.c` (223) | `brand` spec + `obj/bind.ts` | PARTIAL | missing-record-header for 7 directives, pinning `code:` as the header — **(2)**. `test_resist_flag_bad0`, `test_vuln_flag_bad0`: `RF_*` name→bit — **(1)+(3)**. |
| 6 | `c-info.c` (1342) | `class` spec + `player/bind.ts` | **PORT** | The richest structural file. missing-record-header for 31 directives — **(2)**. `test_magic_repeated0` REPEATED_DIRECTIVE — **(2)**. `test_missing_magic0`/`_book0`/`_spell0` pin the whole `magic`→`book`→`spell`→`effect` prerequisite chain — **(2)**. `test_missing_effect0` pins that orphan `effect-yx`/`dice`/`expr`/`effect-msg` are *not* an error — **(2)**. `test_book_bad0`/`test_spell_bad0` TOO_MANY_ENTRIES (book/spell caps from `magic:` and `book:`) — **(1)**, no port counterpart (see gaps). `test_equip_bad0` (UNRECOGNISED_TVAL/SVAL, INVALID_ITEM_NUMBER, INVALID_OPTION), `test_title_bad0`, `test_player_flags_bad0`, `test_obj_flags_bad0`, `test_dice_bad0`, `test_expr_bad0` — **(1)**. |
| 7 | `curse.c` (728) | `curse` spec + `obj/bind.ts` | PARTIAL | missing-record-header, 14 directives — **(2)**. `test_missing_effect0`/`test_missing_dice0` — **(2)**. `test_type_bad0`, `test_weight_bad0` (INVALID_VALUE at ±32768), `test_effect_bad0`, `test_dice_bad0`, `test_expr_bad0` (BAD_EXPRESSION_STRING + UNBOUND_EXPRESSION), `test_flags_bad0`, `test_values_bad0`, `test_conflict_flags_bad0` — **(1)**. |
| 8 | `e-info.c` (757) | `ego_item` spec + `obj/bind.ts` | PARTIAL | missing-record-header, 16 directives — **(2)**. Nine INVALID_VALUE and seven OUT_OF_BOUNDS cases, plus `test_type_bad0` (UNRECOGNISED_TVAL **and** NO_KIND_FOR_EGO_TYPE), `test_item_bad0` (UNRECOGNISED_TVAL/SVAL), `test_flags_off_bad0`, `test_min_values_bad0`, `test_act_bad0`, `test_slay/brand/curse_bad0` — **(1)**. `test_order` is a plain MISSING_FIELD, subsumed by the generic parser. |
| 9 | `f-info.c` (462) | `terrain` spec + `world/feature.ts` | **PORT** | `test_code0` before `test_name0` and **`test_name_bad0` REPEATED_DIRECTIVE** together prove `code:` is the record header and `name:` is single-valued — **(2)**, the clearest single instance of W5's biggest hole. missing-header-record for 15 directives — **(2)**. `test_code_bad0`, `test_mimic_bad0`, `test_flags_bad0`, `test_digging_bad0` OUT_OF_BOUNDS, `test_resist_flag_bad0` — **(1)**. |
| 10 | `flavor.c` (137) | `flavor` spec + `obj/bind.ts` | PARTIAL | `test_kind_bad0` UNRECOGNISED_TVAL — **(1)**. `flavor:`/`fixed:` accumulation under one `kind:` — **(2)**. Field values subsumed (879 leaf fields in W5). |
| 11 | `graphics.c` (117) | `visuals/tile-prefs.ts`, `visuals/grafmode.ts` | **PORT** | Not a gamedata test at all: it drives `process_pref_file_command()` and loads every graphics mode's `.prf`. W5 covers `lib/gamedata/*.txt` only, so **none** of it is subsumed — **(1)+(3)**. Also surfaces a port gap: `monster-base:` prefs (`ui-prefs.c:1145`) are unhandled. **Deferred** (see below). |
| 12 | `h-info.c` (84) | `history` spec + `player/bind.ts` | PARTIAL | missing-record-header (`phrase:`), pinning `chart:` as the header — **(2)**. `phrase:` accumulation — **(2)**. `test_chart0` pins chart→next linkage — **(3)**. |
| 13 | `hints.c` (46) | `hints` spec + `session/boot.ts` | PARTIAL | Nearly subsumed. The one un-subsumed claim: upstream's `hints` list is in **reverse** file order (the parser prepends); the port's `boot.ts` keeps file order — **(4)**. Benign, because `ui-store.c prt_welcome` picks a hint at random, but it is not *proven* equivalent, so not SUBSUMED. |
| 14 | `k-info.c` (853) | `object` spec + `obj/bind.ts` | **PORT** | missing-record-header, 25 directives — **(2)**. `test_missing_effect0`/`test_missing_dice0` — **(2)**. 11 INVALID_ALLOCATION forms, 8 INVALID_VALUE forms, plus `test_type_bad0`, `test_flags_bad0`, `test_effect_bad0`, `test_dice_bad0`, `test_expr_bad0`, `test_slay/brand/curse_bad0` — **(1)**. Highest error-path density of any data file. |
| 15 | `lore.c` (48) | `monster` spec (single spec) | **SUBSUMED** | Its only test runs `lore_parser` over `monster.txt` and asserts PARSE_ERROR_NONE. The port has no second monster.txt parser — one `monsterSpec` registers all 33 directives — and W5 re-parses `monster.txt` in full, comparing 624 records / 18 406 leaf fields with zero divergence and asserting no unregistered directive occurs. That is strictly stronger than "it parses". |
| 16 | `mbase.c` (265) | `monster_base` spec + `mon/bind.ts` | PARTIAL | missing-record-header (glyph/pain/flags/desc) — **(2)**. `desc:` accumulation — **(2)**. `test_pain_bad0` OUT_OF_BOUNDS (pain index bound), `test_flags_bad0` — **(1)**. |
| 17 | `mspell.c` (631) | `monster_spell` spec + `mon/bind.ts` | PARTIAL | missing-record for 15 directives — **(2)**. **`test_misplaced_effect_deps0`** pins orphan effect deps as non-errors — **(2)**. `test_cutoff0` + `test_lore*` + `test_message_*` pin the `power-cutoff` child group — **(2)**. `test_name_bad0` INVALID_SPELL_NAME, `test_msgt_bad0`, `test_effect_bad0`, `test_dice_bad0`, `test_expr_bad0` — **(1)**. |
| 18 | `names.c` (94) | `names` spec + `obj/randname.ts` | PARTIAL | `test_section_bad0` OUT_OF_BOUNDS (`section >= RANDNAME_NUM_TYPES`) — **(1)**. `word:` accumulation under `section:` — **(2)**. Word values subsumed (1 190 leaf fields). |
| 19 | `objact.c` (487) | `activation` spec + `obj/bind.ts` | PARTIAL | missing-record-header, 9 directives — **(2)**. `test_missing_effect0`/`test_missing_dice0` — **(2)**. `test_effect_bad0`, `test_dice_bad0`, `test_expr_bad0` — **(1)**. |
| 20 | `objbase.c` (397) | `object_base` spec + `obj/bind.ts` | **PORT** | The **only** file with a header directive, and its `test_missing_record_header0` + `test_default0` + `test_default_passthrough0` are the direct oracle for the port's `header: ["default"]` / `recordStart: "name"` — **(2)**, exactly W5's named biggest hole. Plus `test_default_bad0` UNDEFINED_DIRECTIVE, `test_name_bad0` UNRECOGNISED_TVAL, `test_flags_bad0` — **(1)**. |
| 21 | `objprop.c` (463) | `object_property` spec + `obj/bind.ts` | PARTIAL | missing-record-header, 12 directives — **(2)**. `test_type_bad0` INVALID_PROPERTY, `test_subtype_bad0`, `test_id_type_bad0`, seven INVALID_OBJ_PROP_CODE probes (one per `type:`), `test_type_mult_bad0`, `test_missing_type0` MISSING_OBJ_PROP_TYPE — **(1)**. `test_code0` pins code→enum by type — **(3)**. |
| 22 | `p-info.c` (431) | `p_race` spec + `player/bind.ts` | PARTIAL | missing-record-header, 21 directives — **(2)**. `test_obj_flags_bad0`, `test_play_flags_bad0`, `test_values_bad0` — **(1)**. Stats/skills/hitdie/exp/infra/history/age/height/weight subsumed (301 leaf fields). |
| 23 | `pain.c` (130) | `pain` spec + `mon/bind.ts` | PARTIAL | missing-record-header (`message:`), pinning `type:` as the header — **(2)**. `message:` accumulation in file order — **(2)**. `test_message_bad0` TOO_MANY_ENTRIES at the 8th message — **(1)**, no port counterpart (see gaps). |
| 24 | `parse.c` (610) | `content/src/parser.ts` | **PORT** | The whole file. Spec validation (`reg0`–`reg5`), 19 NOT_RANDOM strings, NOT_NUMBER, FIELD_TOO_LONG, MISSING_FIELD, UNDEFINED_DIRECTIVE, strtok colon collapsing, optional fields, `char` fields holding `:` and non-ASCII — **(1)**, none of it reachable from shipped data. `test_rand0` additionally pins `parse_random` **evaluation** (12 forms, incl. whole-value negation) — **(3)**; this is where the port defect below was found. Highest-value file of the 38. |
| 25 | `partrap.c` (896) | `trap` spec + `world/trap.ts` | PARTIAL | missing-header-record, 19 directives — **(2)**. The `-xtra` twin family (`effect-xtra`/`effect-yx-xtra`/`dice-xtra`/`expr-xtra`) is a **second, independent child group in one record** — **(2)**, high value. `test_visibility_bad0`, `test_flags_bad0`, `test_effect_bad0`(×2), `test_dice_bad0`(×2), `test_expr_bad0`(×2), `test_save_bad0`, `test_msg_bad0`, `test_missing_effect*` — **(1)**. |
| 26 | `pit.c` (454) | `pit` spec + `mon/bind.ts` | PARTIAL | missing-record-header, 11 directives — **(2)**. `mon-base`/`mon-ban`/`color`/`flags-req`/`flags-ban` accumulation — **(2)**. `test_mon_base_bad0` INVALID_MONSTER_BASE, `test_mon_ban_bad0`, `test_flags_req/ban_bad0`, and three INVALID_SPELL_FREQ probes (`innate-freq`/`spell-req`/`spell-ban` reject freq 0) — **(1)**. |
| 27 | `pprop.c` (350) | `player_property` spec + `player/bind.ts` | PARTIAL | missing-record-header lists `name:` among the dependants, pinning `type:` as the header — **(2)**. `test_code_bad0` INVALID_PLAY_PROP_CODE, `test_bindui_bad0` — **(1)**. `test_complete_player/object/element0` pin type-dependent code resolution — **(3)**. `test_name_memleak0` is a C allocation concern with no TS counterpart. |
| 28 | `proj.c` (420) | `projection` spec + `world/projection.ts` | PARTIAL | missing-record-header, 14 directives, pinning `code:` as the header — **(2)**. **`test_code_mismatch0` ELEMENT_NAME_MISMATCH** — a cross-record invariant (the first `ELEM_MAX` projections must be in element order with matching names) that no field-level diff can express — **(1)+(4)**, high value. `test_msgt_bad0` — **(1)**. |
| 29 | `ptimed.c` (1067) | `player_timed` spec + `player/bind.ts` | PARTIAL | missing-record-header, 23 directives — **(2)**. **`on-begin-effect` and `on-end-effect` share one child group** (`effect-yx`/`effect-dice`/`effect-expr`/`effect-msg`, most-recent-parent-wins) — **(2)**, high value. `grade:` accumulation plus the implicit off grade — **(2)**. Fourteen distinct `*_bad0` probes: badname, badmsgt, badfail, badgrade, badresist, badbrand, badslay, badflagsyn, badbegineffect, badendeffect, badeffectdice, badeffectexpr, badflags, badlowerbound — **(1)**. |
| 30 | `r-info.c` (1077) | `monster` spec + `mon/bind.ts` | **PORT** | missing-header-record for 30 directives incl. `color-cycle:` — **(2)**. `test_base_bad0` INVALID_MONSTER_BASE, `test_blow_bad0` UNRECOGNISED_BLOW, `test_flags_bad0`/`flags_off_bad0`, six INVALID_SPELL_FREQ, three INVALID_SPELL_NAME, three `message*_bad0` INVALID_MESSAGE, `test_drop_bad0`/`drop_base_bad0` (UNRECOGNISED_TVAL/SVAL, six INVALID_ITEM_NUMBER), `test_friends_bad0`/`friends_base_bad0` INVALID_MONSTER_ROLE, `test_mimic_bad0` — **(1)**. `test_base0` post-`rf_union` flags — **(3)**. Drop/drop-base interleaving is the one ordering case W5 already covers. |
| 31 | `readstore.c` (127) | `store` spec + `store/bind.ts` | PARTIAL | `test_store_bad0`: `store:XYZZY` (unknown terrain code) **and** `store:FLOOR` (known code without the SHOP flag) both INVALID_VALUE — **(1)**, a cross-file invariant. `owner:`/`normal:`/`always:`/`buy:` accumulation — **(2)**. `test_store0` pins `stores + (shopnum - 1)` indexing — **(3)**. |
| 32 | `realm.c` (196) | `realm` spec + `player/bind.ts` | PARTIAL | missing-record-header (stat/verb/spell-noun/book-noun) — **(2)**. `test_stat_bad0` INVALID_SPELL_STAT: stat name→index — **(1)+(3)**. |
| 33 | `shape.c` (674) | `shape` spec + `player/bind.ts` | PARTIAL | missing-record-header, 18 directives — **(2)**. `test_blow0` pins `blow:` accumulation alongside the effect child group — **(2)**. `test_missing_effect0` — **(2)**. `test_obj_flags_bad0`, `test_player_flags_bad0`, `test_values_bad0`, `test_dice_bad0`, `test_expr_bad0` — **(1)**. |
| 34 | `slay.c` (335) | `slay` spec + `obj/bind.ts` | PARTIAL | missing-record-header, 8 directives, pinning `code:` — **(2)**. `test_race_flag_bad0` INVALID_FLAG, `test_base_bad0` INVALID_MONSTER_BASE, four INVALID_SLAY probes — **(1)**. `test_combined0` pins `race-flag` / `base` mutual exclusivity — **(1)**. |
| 35 | `ui_knowledge.c` (212) | `ui_knowledge` spec + `mon/knowledge-groups.ts` | PARTIAL | missing-record-header, pinning `monster-category:` — **(2)**. Three `mcat-include-*` accumulations — **(2)**. `test_include_base_bad0` INVALID_MONSTER_BASE, `test_include_flag_bad0`, `test_include_other_bad0` — **(1)**. |
| 36 | `v-info.c` (126) | `vault` spec + `gen/room.ts` | PARTIAL | `test_d0` is the only un-subsumed case and it is a good one: two `D:` rows must **concatenate with no separator** and keep leading/trailing spaces (`string_append`) — **(2) repeat + (3) post-parse join**. Everything else is field mapping (3 635 leaf fields in W5). |
| 37 | `world.c` (67) | `world` spec + `game/world.ts` | PARTIAL | `test_complete0` pins `"None"` in `up:`/`down:` → NULL and the level-chain resolution — **(3)**. Depth/name landing subsumed. |
| 38 | `z-info.c` (497) | `constants` spec + `core/src/constants.ts` | **PORT** | Entirely rejection paths and post-parse structure: 13 UNDEFINED_DIRECTIVE probes (one unknown label per section), 9 INVALID_VALUE probes (negative scalars, one per section) — **(1)**; 4 INVALID_MESSAGE probes on the critical-level `msgt` name — **(1)+(3)**, no port counterpart (see gaps); and the critical-level list append order — **(4)**. |

## Deliverable 2 — what was ported

Four new files, 810 tests, all green. Each exercises the port's real production
code (`parseSignature`/`parseLine`/`isValidRandom`, `compileGamedata` over the
real shipped `FileSpec`s, `bindConstants`, `ObjRegistry`) — no local
reimplementation, no swallowed exceptions, no fallbacks.

| New file | Tests | Upstream files it draws from |
|---|---:|---|
| `packages/content/src/parser.upstream.test.ts` | 49 | `parse.c` (all 32 cases that have a port counterpart) |
| `packages/content/src/records.upstream.test.ts` | 680 | `a-info`, `blowe`, `blowm`, `body`, `brand`, `c-info`, `curse`, `e-info`, `f-info`, `h-info`, `k-info`, `mbase`, `mspell`, `objact`, `objbase`, `objprop`, `p-info`, `pain`, `partrap`, `pit`, `pprop`, `proj`, `ptimed`, `r-info`, `realm`, `shape`, `slay`, `ui_knowledge`, `v-info` (metadata cases only) |
| `packages/core/src/constants.upstream.test.ts` | 27 | `z-info.c` |
| `packages/core/src/obj/bind.upstream.test.ts` | 54 | `k-info`, `a-info`, `e-info`, `objbase`, `curse`, `objprop`, `flavor`, `slay`, `brand` (rejection paths only) |

`records.upstream.test.ts` is the one worth describing. It transcribes the
`test_missing_record_header0` line list verbatim from **27** upstream files (the
28th, `objbase.c`, gets its own block because `object_base` is the only file
with a header directive), and for each line asserts both directions: rejected
before any record, accepted after the record header. **All 27 specs' declared
`recordStart` values are now confirmed against the C**, including the four
non-obvious ones (`terrain`→`code`, `player_property`→`type`, `pain`→`type`,
`body`→`body`). It then pins, from the named upstream tests:

- `object_base`'s `header: ["default"]` (`objbase.c` `test_default0` /
  `test_default_passthrough0` / `test_missing_record_header0`);
- `repeat: false` rejection (`f-info.c` `test_name_bad0`, `c-info.c`
  `test_magic_repeated0`);
- the class `magic`→`book`→`spell`→`effect` `childOf` chain, and that a second
  `spell:` attaches to the *later* book (`c-info.c`);
- orphan effect dependencies as non-errors (`c-info.c test_missing_effect0`,
  `mspell.c test_misplaced_effect_deps0`);
- the `power-cutoff` child group (`mspell.c test_cutoff0` / `test_lore0`);
- `player_timed`'s two-parent child group (`ptimed.c`);
- `trap`'s independent `effect` / `effect-xtra` groups (`partrap.c`);
- `D:` and `message:` accumulation in file order (`v-info.c test_d0`,
  `pain.c test_message0`).

### Deferred, with verdicts recorded

21 files. Every one is `PARTIAL` (or `PORT` for `graphics.c`) in the table
above and its metadata cases *are* covered by `records.upstream.test.ts`; what
is deferred is their **row-3 rejection paths** in the non-object bind modules,
plus `graphics.c` entirely.

| Deferred | Verdict | What is still unported |
|---|---|---|
| `graphics.c` | PORT | The whole file: pref-file command handling and per-mode `.prf` loading (`visuals/tile-prefs.ts`). Different subsystem from the rest of this lane; also blocked on the `monster-base:` gap below. |
| `r-info.c`, `mbase.c`, `mspell.c`, `blowe.c`, `blowm.c`, `pain.c`, `pit.c` | PORT / PARTIAL | `mon/bind.ts` rejection paths (~40 probes): INVALID_MONSTER_BASE, UNRECOGNISED_BLOW, INVALID_SPELL_FREQ/NAME, INVALID_MESSAGE, INVALID_ITEM_NUMBER, INVALID_MONSTER_ROLE, pain OUT_OF_BOUNDS. A `packages/core/src/mon/bind.upstream.test.ts` is the natural home. |
| `c-info.c`, `p-info.c`, `ptimed.c`, `shape.c`, `pprop.c`, `realm.c`, `body.c`, `h-info.c` | PORT / PARTIAL | `player/bind.ts` rejection paths: INVALID_FLAG, INVALID_OPTION, INVALID_ITEM_NUMBER, INVALID_SPELL_STAT, INVALID_PLAY_PROP_CODE, equip-slot names, grade parsing. |
| `f-info.c`, `partrap.c`, `proj.c` | PORT / PARTIAL | `world/{feature,trap,projection}.ts` rejection paths, and in particular `proj.c test_code_mismatch0` (ELEMENT_NAME_MISMATCH), which is the single highest-value item left. |
| `readstore.c` | PARTIAL | `store/bind.ts`: the two `test_store_bad0` INVALID_VALUE cases. |
| `names.c` | PARTIAL | `test_section_bad0` OUT_OF_BOUNDS. |
| `world.c` | PARTIAL | `"None"` → NULL and level-chain resolution. |
| `hints.c` | PARTIAL | Reverse-order claim (benign; see row 13). |

## Port gaps and defects found — reported, not fixed

### D1 (defect, gameplay-visible) — `rand` fields are evaluated with `z-dice` semantics instead of `parse_random`

Angband has **two** dice-string parsers, and they disagree on a leading `-`:

- `parse_random()` (`reference/src/parser.c:126-214`) backs `rand`-typed
  fields. Its last step is:
  ```c
  if (negative) {
      bonus->base *= -1;
      bonus->base -= bonus->m_bonus;
      bonus->base -= bonus->dice * (bonus->sides + 1);
  }
  ```
  i.e. the leading `-` negates the **whole** value, and the base is adjusted so
  the positive dice roll lands in the negative range.
- `dice_parse_string()` (`reference/src/z-dice.c`) treats `-` as part of the
  base token only.

`packages/core/src/obj/bind.ts:107` `parseRand()` — the function every
`rand`-typed field goes through (`time`, `attack hd`/`to-h`/`to-d`,
`armor to-a`, `pval`, `charges`, `pile stack`, `combat th`/`td`/`ta`) — uses
`new Dice().parseString(value)`, i.e. the `z-dice` parser. Nothing in the port
implements `parse_random`'s negation.

Reachable in shipped data, once: `ego_item.txt:692`, "of Backbiting",
`combat:-26+d25:-26+d25:0`.

| | `to_h` / `to_d` random_value | effective range |
|---|---|---|
| C (`parse_random`) | `base -52, dice 1, sides 25` | −51 … −27 |
| port (`Dice`) | `base -26, dice 1, sides 25` | −25 … −1 |

Verified empirically against the port's own `parseRand`:
`parseRand("-26+d25")` → `{"base":-26,"dice":1,"sides":25,"mBonus":0}`.
"of Backbiting" is therefore roughly 26 points less punishing than upstream.

Not fixed, per instructions. `parse.c test_rand0`'s twelve
component-level assertions are the oracle; `parser.upstream.test.ts` asserts
only the *validity* half of that test and says so in a comment.

### D2 (defect, build-time only) — `grabIntRange` misses the overflow rejection

`grab_int_range` (`reference/src/datafile.c:329-333, 352-355`) rejects
`lv1 <= INT_MIN || lv1 >= INT_MAX` on both ends. `packages/core/src/obj/bind.ts:120`
matches `/^\s*(-?\d+)\s+to\s+(-?\d+)\s*$/` with no magnitude bound, so the
three overflowing forms in `k-info.c test_alloc_bad0`
(`"-8989999988989898889389 to 1"`, `"1 to 3892867393957396729696739023"`,
`"1119392572692029396720296 to 3399268202846826927928487928482968283293"`)
are accepted where upstream returns INVALID_ALLOCATION. Not reachable from
shipped data. Named and deliberately not asserted in
`bind.upstream.test.ts`; the other eight forms are.

### G1 (gap) — no `monster-base:` pref-file line

`ui-prefs.c:1145` registers `monster-base sym name int attr int char`.
`packages/core/src/visuals/tile-prefs.ts` handles `feat`, `trap`, `monster`,
`object`, `flavor`, `GF` and `%` only. `graphics.c test_defaults`' first
assertion has no port counterpart.

### G2 (gap) — critical-level `msgt` names are never validated or mapped

`init.c parse_constants_melee_critical_level` resolves the message name via
`message_lookup_by_name` and returns PARSE_ERROR_INVALID_MESSAGE on a miss
(`z-info.c test_bad_m_crit_level` probes `XYZZY`). `constants.ts:314` copies
`rec["<section>-level"]` straight through, and `CriticalLevel.msg` stays a raw
string all the way into `combat/hit.ts`. No validation, no name→`MSG_*` map.

### G3 (gap) — no TOO_MANY_ENTRIES caps

Upstream enforces caps at parse time that the port does not:
`pain.c test_message_bad0` (8th `message:` in one pain record),
`c-info.c test_book_bad0` / `test_spell_bad0` (books beyond `magic:`'s count,
spells beyond `book:`'s count), `c-info.c test_missing_magic0` (a `book:` or
`spell:` with no `magic:` line). The port's `compileGamedata` has no notion of
a declared capacity. Build-time only, and W5 proves the shipped data stays
inside the caps, but it is a real behavioural difference for mod authors.

### G4 (gap, informational) — no parser state object

`parse.c test_priv` and `test_syntax0..2`'s `parser_getstate()` line/column
assertions have no counterpart: the port's `parseLine` is a pure function and
`compileGamedata` reports `file.txt:line` in the thrown message instead of
exposing a state struct. Column is not tracked.

### Benign representation difference (not a defect)

Upstream returns PARSE_ERROR_NONE and **discards** an `effect-yx` / `dice` /
`expr` / `effect-msg` that arrives before any `effect:` ("human, not parser,
error"). The port also does not error, but parks the orphan on the enclosing
record instead of dropping it. No shipped file contains such a line, and the
bind layer reads only the keys it expects, so nothing observable changes.
Asserted as-is (with the divergence named in a comment) in
`records.upstream.test.ts`.

## Verification

```text
timeout 900 pnpm build                                              exit 0, no output
vitest run packages/content/src/parser.upstream.test.ts             49 passed / 0 failed
vitest run packages/content/src/records.upstream.test.ts           680 passed / 0 failed
vitest run packages/core/src/constants.upstream.test.ts             27 passed / 0 failed
vitest run packages/core/src/obj/bind.upstream.test.ts              54 passed / 0 failed
vitest run packages/content/src \
           packages/core/src/constants{,.upstream}.test.ts \
           packages/core/src/obj/bind{,.upstream}.test.ts
                                          10 files, 994 passed / 0 failed
git diff --stat master -- reference/                                (empty)
```

LF endings confirmed on all four new files (`tr -dc '\r' | wc -c` → 0).

---

## Status update, 2026-07-26 (later the same day)

**D1 — FIXED, and it was worse than reported.** `parseRand` now reproduces
`parse_random`'s negation (`parser.c:207-211`). The adjudication named one
affected value ("of Backbiting") and flagged the blast radius as untraced; a grep
of the compiled pack for every negative `rand` value carrying a dice or `M`
component found **three**, because `attack` and `armor` are both `rand`-typed
(`obj-init.c:2161-2162`):

| where | value | upstream | port before |
|---|---|---|---|
| `object.txt:2273` ring "Reckless Attacks" | `armor:0:-8+4d3` | to_a -20..-12 | to_a **-4..+4** |
| `object.txt:2308` ring "Open Wounds" | `attack:0d0:0:-3d5` | to_d -15..-3 | base 0, **dice -3** |
| `ego_item.txt:692` "of Backbiting" | `combat:-26+d25` | -51..-27 | -26..-1 |

The first FLIPS SIGN: a ring upstream guarantees to be a liability could hand out
positive AC. The second held a NEGATIVE dice count, which suppressed three RNG
draws wherever that ring's `to_d` was rolled — which is why the fix moved the
generation stream and stale-dated two of the twelve seeds in `gen.test.ts`'s
STRANDED control list. Ten of twelve were unaffected, which is what distinguishes
a stream shift from a behavioural regression. Guard:
`packages/core/src/obj/parse-rand.upstream.test.ts` (8 cases; reverting the fix
fails 3 of them).

**D2 — FIXED.** `grabIntRange` now rejects an endpoint at `INT_MIN`/`INT_MAX`
inclusive, as `datafile.c:328-333` does and for the reason the C states. The
three overflowing forms of `k-info.c test_alloc_bad0` are asserted in
`obj/bind.upstream.test.ts` instead of being documented as a known divergence,
so all eleven of that test's forms are now covered.

G1-G4 remain open as recorded above.
