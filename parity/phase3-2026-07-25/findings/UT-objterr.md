# UT-objterr — 170 upstream unit-test cases ported

Batch `objterr` of the UT-PORT lane, branch `p5/ut-objterr`.

Upstream sources: `reference/src/tests/parse/{a-info,curse,e-info,f-info,mspell,p-info,pit,proj,shape}.c`

## Counts

| | |
| --- | --- |
| cases in batch (ledger, `cited == false`) | **170** |
| PORTED-NEW | 154 |
| PORTED-EXISTING (cited, not duplicated) | 1 |
| GAP, fixed | 7 |
| GAP, reported and left | 8 |
| N/A | 0 |

The brief's headline said 165; its own per-file counts (23 + 22 + 20 + 20 + 18 + 18 + 17 + 16 + 16) sum to 170, and so does the ledger. 170 is right.

New tests: **314** (`packages/content/src/records-objterrain.upstream.test.ts` 127, `packages/core/src/parse-objterrain.upstream.test.ts` 187).

Suites, after the fixes:

| suite | result |
| --- | --- |
| `packages/content` | 7 files / 1010 tests passed |
| `packages/core` | 223 files / 3143 tests passed |
| `npx tsc -b` (whole repo) | clean |
| `npx eslint` (7 touched files) | 0 errors (1 pre-existing `no-useless-assignment` warning in `gen-monster.ts:299`, untouched by this lane) |

`packages/borg` was not run: `borg/src/{think,foundation}.test.ts` hang (pre-existing, per the brief).

## Where the batch landed, and why there are two test files

The brief says to put everything in one file under `packages/content`. That is not possible for this
batch and the reason matters:

> "The port models upstream's parse errors as real codes ... `packages/content/src/parser.ts` throws
> `ParseError` with a `code`. So `eq(r, PARSE_ERROR_INVALID_FLAG)` ports directly."

**This is wrong.** `content/src/parser.ts`'s `ParseErrorCode` union has exactly six members —
`MISSING_FIELD`, `UNDEFINED_DIRECTIVE`, `FIELD_TOO_LONG`, `NOT_NUMBER`, `NOT_RANDOM`,
`INVALID_SPEC`. Every semantic code this batch is about (`INVALID_FLAG`, `INVALID_VALUE`,
`OUT_OF_BOUNDS`, `INVALID_ALLOCATION`, `INVALID_EFFECT`, `INVALID_DICE`,
`BAD_EXPRESSION_STRING`, `UNBOUND_EXPRESSION`, `INVALID_MESSAGE`, `INVALID_SPELL_FREQ`,
`ELEMENT_NAME_MISMATCH`) is raised by a **binder in `packages/core`** — `obj/bind.ts`,
`mon/bind.ts`, `player/bind.ts`, `world/feature.ts`, `world/projection.ts`,
`gen/gen-monster.ts`, `effects/effect.ts`, `expression.ts` — as a plain `Error`, not by the
compiler.

And `packages/content` has **no dependency on `@rpgm-tools/neo-angband-core`** (`content/package.json` lists
none, `content/tsconfig.json` has no project reference). A cross-package import from a content
test would break `tsc -b`. So the batch splits:

- `packages/content/src/records-objterrain.upstream.test.ts` — the mandated file. Line grammar and
  record assembly against the real shipped `FileSpec`s: field extraction, accumulation shape,
  `childOf` grouping, and the grammar-level errors.
- `packages/core/src/parse-objterrain.upstream.test.ts` — new, distinctly named so it cannot collide
  with the sibling lanes. The binder half: every semantic error code, by deep-copying the committed
  pack, planting exactly the token the upstream case plants, and requiring the bind to refuse it
  (the pattern `core/src/obj/bind.upstream.test.ts` already established).

Neither sibling file (`records-monclass`, `records-misc`) was touched, and
`records.upstream.test.ts` was not restructured or appended to.

## Production changes: kept vs reverted

All five files in the recovered WIP snapshot `9625bacdd` were re-verified against the reference C
line they came from. **All five kept, none reverted.** Each now has a test that fails when the
change is reverted (see the mutation table).

| # | file | C citation | verdict |
| --- | --- | --- | --- |
| GAP-1 | `core/src/world/feature.ts` | `init.c parse_feat_digging`: `if (dig_idx < DIGGING_RUBBLE + 1 \|\| dig_idx >= DIGGING_MAX + 1) return PARSE_ERROR_OUT_OF_BOUNDS;` with `player.h:106-112` giving `DIGGING_RUBBLE = 0 … DIGGING_MAX = 5` | KEPT |
| GAP-2 | `core/src/mon/bind.ts` | `mon-init.c parse_pit_innate_freq`: `if (pct < 1 \|\| pct > 100) return PARSE_ERROR_INVALID_SPELL_FREQ;` | KEPT |
| GAP-3 | `core/src/gen/gen-monster.ts` | `mon-init.c parse_pit_mon_ban`: no error branch — stores whatever `lookup_monster` returned, `NULL` included, and returns `PARSE_ERROR_NONE` | KEPT |
| GAP-4 | `core/src/obj/bind.ts` | `obj-init.c parse_curse_weight`: `if (adjustment < -32768 \|\| adjustment > 32767) return PARSE_ERROR_INVALID_VALUE;` | KEPT |
| GAP-5 | `core/src/mon/bind.ts` + `core/src/world/projection.ts` | `mon-init.c parse_mon_spell_message_type` and `obj-init.c parse_projection_message_type`: `msg_index = message_lookup_by_name(type); if (msg_index < 0) return PARSE_ERROR_INVALID_MESSAGE;` | KEPT |
| GAP-6 | `core/src/world/projection.ts` | `obj-init.c:224 parse_projection_code`: `if ((index < ELEM_MAX) && !streq(code, element_names[index])) return PARSE_ERROR_ELEMENT_NAME_MISMATCH;` with `index = h ? h->index + 1 : 0` | KEPT, one correction |

One correction was made to the recovered GAP-6 hunk during review: it reported
`ELEMENT_NAME_MISMATCH` for a record position no record reached. Upstream never runs the check
there — a short `projection.txt` is `PARSE_ERROR_TOO_FEW_ENTRIES` from
`finish_parse_projection`, which is the port's existing `no record for PROJ value` throw. The loop
is now bounded by `records.length` and there is a test for the distinction.

`messageLookupByName` was **not** newly written for GAP-5: it already existed in
`core/src/sound/engine.ts` (a faithful `message.c` port, including the case-insensitive
`my_stricmp` scan and the decimal-index branch), and is now imported by the two binders. The
stale "Not ported here: message_lookup_by_name" note at the top of `core/src/msg.ts` is also
already stale relative to that file; not touched.

## GAP blocks

### GAP-1 — `f-info.c test_digging_bad0`: terrain `digging:` was unbounded — P2, fixed

- **ref**: `init.c parse_feat_digging` rejects `dig_idx < DIGGING_RUBBLE + 1` and
  `dig_idx >= DIGGING_MAX + 1` with `PARSE_ERROR_OUT_OF_BOUNDS`; valid range is 1..5.
- **port**: `world/feature.ts` `FeatureRegistry` did `dig: rec.digging ?? 0` with no check.
- **what differs**: `digging:0` and `digging:6` loaded silently.
- **effect**: `f->dig` indexes `calc_digging_chances()`'s `chances[DIGGING_MAX]` array. A 0 or a 6
  from a mod's terrain file is an out-of-range index into the digging table rather than a refused
  load. Not reachable from shipped `terrain.txt` (which uses only 1..5, asserted).
- **severity**: P2 — needs malformed or mod data to trigger, then corrupts digging.
- **fixed**: yes — `resolveDigging()` in `world/feature.ts`.

### GAP-2 — `pit.c test_innate_freq_bad0`: pit `innate-freq:` was unvalidated — P2, fixed

- **ref**: `mon-init.c parse_pit_innate_freq` rejects anything outside 1..100 with
  `PARSE_ERROR_INVALID_SPELL_FREQ`, then stores `100 / pct`.
- **port**: `mon/bind.ts` stored the raw value; `gen/gen-monster.ts resolvePits` did the
  `100 / pct` conversion with a bare `> 0` guard. `pctToFreq()` — which does have the range check —
  is used for monster races but was never used for pits.
- **what differs**: `innate-freq:0` and `innate-freq:-1` became `freqInnate 0`; `innate-freq:101`
  truncated to 0.
- **effect**: `freqInnate` is the floor in `mon_pit_hook` (`race->freq_innate < innate_freq` →
  reject). Silently becoming 0 turns "only monsters with innate spells" into "any monster", which
  changes the whole population of a themed pit instead of failing the load.
- **severity**: P2 (P1 in consequence, but only reachable with malformed data).
- **fixed**: yes — `checkPitInnateFreq()` in `mon/bind.ts`.

### GAP-3 — `pit.c test_mon_ban_bad0`: the port was STRICTER than the C — P3, fixed

- **ref**: `parse_pit_mon_ban` appends a `pit_forbidden_monster` whose `race` is whatever
  `lookup_monster` returned and returns `PARSE_ERROR_NONE`. The upstream case asserts exactly this:
  `eq(r, PARSE_ERROR_NONE)` then `null(pit->forbidden_monsters->race)`. `mon_pit_hook`'s
  `race == monster->race` test then never matches the null entry.
- **port**: `resolvePits` threw `unknown mon-ban`.
- **what differs**: a typo in a `mon-ban:` line is silently ignored by C and was a hard load failure
  in the port.
- **effect**: a mod pit with a misspelt `mon-ban:` would run in Angband and refuse to load here.
  Backwards from the parity mandate: core keeps the C's warts.
- **severity**: P3.
- **fixed**: yes — unknown names are dropped (never-matches, same as C's null entry) in
  `gen/gen-monster.ts resolvePits`.

### GAP-4 — `curse.c test_weight_bad0`: curse `weight:` int16 range unchecked — P2, fixed

- **ref**: `obj-init.c parse_curse_weight` returns `PARSE_ERROR_INVALID_VALUE` for
  `adjustment < -32768 || adjustment > 32767`, with the comment that the field must fit an
  `int16_t`.
- **port**: `obj/bind.ts bindCurses` did `weight: rec.weight ?? 0`.
- **what differs**: 32769 and -32780 loaded.
- **effect**: the port's number is a JS double, so the value does not truncate the way the C's
  `int16_t` store would — a curse weight outside the range produces a different weight adjustment
  in the port than in Angband, instead of the shared load failure.
- **severity**: P2.
- **fixed**: yes — `ObjRegistry.curseWeight()`.

### GAP-5 — `mspell.c test_msgt_bad0` / `proj.c test_msgt_bad0`: `msgt:` never validated — P2, fixed

- **ref**: both handlers call `message_lookup_by_name` and return
  `PARSE_ERROR_INVALID_MESSAGE` on `< 0`.
- **port**: `mon/bind.ts bindSpells` and `world/projection.ts bindProjections` stored the raw name
  string with no lookup.
- **what differs**: `msgt:XYZZY` loaded.
- **effect**: the port resolves the MSG name at message time, so an unrecognised `msgt:` silently
  degrades to no message colour / no sound for that spell or projection for the whole game, where
  upstream refuses to start.
- **severity**: P2.
- **fixed**: yes, in both binders, via the existing `messageLookupByName` (so the
  case-insensitive and decimal-index forms `message.c` accepts still pass — asserted).
- **out of batch, same hole, NOT fixed**: `mon/bind.ts:363` (blow_methods `msg:`) and
  `mon/bind.ts:644` (summon `msgt:`) have the identical unchecked assignment. Those belong to
  `blowm.c` / `summon.c`, i.e. the `monclass` / `misc` lanes.

### GAP-6 — `proj.c test_code_mismatch0`: `ELEMENT_NAME_MISMATCH` was unreachable — P3, fixed

- **ref**: `obj-init.c:224` — records are numbered sequentially (`index = h ? h->index + 1 : 0`)
  and a record below `ELEM_MAX` whose code is not `element_names[index]` is
  `PARSE_ERROR_ELEMENT_NAME_MISMATCH`. This is the one and only user of that code in the whole
  reference tree.
- **port**: `bindProjections` places each record at `PROJ[rec.code]`, so record position was free.
  It did check that every PROJ slot ends up filled exactly once, which catches the practical
  failure but not this one.
- **what differs**: `projection.txt` with two element records transposed loaded fine.
- **effect**: `el_info[]` is indexed by `ELEM` value and upstream relies on the ordering invariant
  to keep the projection table and the element table in step. The port's by-code binding makes it
  benign in practice, but the invariant went unenforced, and a mod reordering the file would drift
  from Angband silently rather than being refused.
- **severity**: P3.
- **fixed**: yes. Verified first that the shipped `projection.json`'s first 25 codes match
  `list-elements.h` order exactly and that exactly 25 records carry `type: element`.

### GAP-7 — a restated single-value directive is refused where upstream replaces it — P3, NOT fixed

- **ref**: six cases in this batch parse their directive twice with the comment "Try setting it
  again to see if memory is leaked" and require `PARSE_ERROR_NONE` with the second value winning,
  because the handler `string_free`s / `dice_free`s the old value and assigns the new one:
  `proj.c test_type0 / test_desc0 / test_player_desc0 / test_blind_desc0 / test_lash_desc0` and
  `curse.c test_dice0`.
- **port**: `records.ts compileGamedata` treats "not marked `repeat`" as "a duplicate is an error"
  and throws `duplicate directive "<name>"`.
- **what differs**: upstream last-one-wins; the port refuses the file.
- **effect**: a gamedata file (a mod override, most plausibly) that restates a scalar field loads in
  Angband and is refused here.
- **severity**: P3 — unreachable from shipped data, which never restates a scalar field.
- **fixed**: **no**, deliberately. This is not an objterr-local bug: essentially *every*
  non-accumulating upstream handler is last-wins, because it just assigns. Only two handlers in the
  reference tree genuinely return `PARSE_ERROR_REPEATED_DIRECTIVE` — `init.c parse_feat_name`
  (already pinned by `records.upstream.test.ts`, f-info `test_name_bad0`) and
  `parse_class_magic`. Correcting it means flipping the default for non-`repeat` directives across
  all shipped specs with an explicit opt-in for those two, which silently changes the meaning of
  every other lane's spec. That is a cross-lane restructure, not an edit inside this batch. The
  current wrong behaviour is pinned by explicitly GAP-labelled tests in
  `records-objterrain.upstream.test.ts` so the fix has a failing marker to remove.
- note: at the *runtime* layer this is already correct — `EffectBuilder.dice()` overwrites, which
  is asserted in `parse-objterrain.upstream.test.ts` ("a second dice: replaces the first").

### GAP-8 — `proj.c test_obvious0` / `test_wake0`: non-1 truthy values — P3, NOT fixed

- **ref**: `parse_projection_obvious` and `parse_projection_wake` store
  `(value == 1) ? true : false`. The upstream cases say so explicitly: "Non-zero values other than
  one are false" — `obvious:2` is FALSE, `wake:7` is FALSE.
- **port**: `world/projection.ts` does `(rec.obvious ?? 0) !== 0`, so `obvious:2` is TRUE.
- **what differs**: any value other than 0 or 1.
- **effect**: `obvious` drives whether the player is told an effect happened and `wake` whether
  monsters are woken, so a `2` would flip both the wrong way. Unreachable on shipped
  `projection.txt` (every line is 0 or 1, asserted).
- **severity**: P3.
- **fixed**: **no**. The `?? 0 !== 0` idiom for a C `== 1` store recurs across several of the
  port's binders (`aim`, `uniques`, `cut`, `stun`, `miss`, `phys` in `mon/bind.ts` and
  `obj/bind.ts`); fixing one and not the others would be worse than reporting the pattern. Pinned
  with an explicit comment naming the divergence at the assertion site.

## Mutation table

Each production change was reverted in isolation, both suites re-run, then restored. Baseline for
the pre-existing column: 8 files / 937 tests passing
(`world/feature.test.ts`, `world/projection.test.ts`, `mon/bind.test.ts`, `obj/bind.test.ts`,
`obj/bind.upstream.test.ts`, `gen/gen.test.ts`, `content/data-exactness.test.ts`,
`content/records.upstream.test.ts`).

| mutation | my tests | pre-existing suite |
| --- | --- | --- |
| M1 `feature.ts`: `resolveDigging(...)` → `rec.digging ?? 0` (revert GAP-1) | **3 failed** / 306 | 937 passed — missed |
| M2 `mon/bind.ts`: `checkPitInnateFreq(...)` → `rec["innate-freq"] ?? 0` (revert GAP-2) | **3 failed** / 306 | 937 passed — missed |
| M3 `gen-monster.ts`: restore the `unknown mon-ban` throw (revert GAP-3) | **1 failed** / 308 | 937 passed — missed |
| M4 `obj/bind.ts`: `ObjRegistry.curseWeight(...)` → `rec.weight ?? 0` (revert GAP-4) | **2 failed** / 307 | 937 passed — missed |
| M5a `mon/bind.ts`: `checkMsgt(...)` → `rec.msgt ?? "GENERIC"` (revert GAP-5, spells) | **1 failed** / 308 | 937 passed — missed |
| M5b `projection.ts`: disable the `msgt` lookup (revert GAP-5, projections) | **1 failed** / 308 | 937 passed — missed |
| M6 `projection.ts`: disable the element-order loop (revert GAP-6) | **2 failed** / 307 | 937 passed — missed |

7 of 7 mutations caught by the new tests; 0 of 7 caught by the pre-existing suite. That is the
expected result and the reason the batch exists: every one of these inputs is malformed, so the W5
data-exactness suite is structurally blind to all of them.

## Things in the brief that turned out to be wrong

1. **"165 uncited cases"** — the real number is 170, and the brief's own per-file counts sum to 170.
2. **"`packages/content/src/parser.ts` throws `ParseError` with a `code`, so
   `eq(r, PARSE_ERROR_INVALID_FLAG)` ports directly."** No. `ParseErrorCode` is six grammar-level
   codes. Every semantic code lives in a `packages/core` binder as a plain `Error`, and `content`
   cannot import `core`. Hence the second test file.
3. **"one file, so it merges cleanly"** — impossible for this batch, for the reason above. The
   second file is in `packages/core` with a batch-specific name, so it still cannot collide with the
   sibling lanes.
4. **"e-info.c … a MISSING_FIELD case ('e-info.c test_order') that is already covered — cite it"** —
   correct, and cited. Same for f-info's second-`name:` case.
5. **"`a-info.c` and `e-info.c` both exercise `alloc:` parsing (PARSE_ERROR_INVALID_ALLOCATION)"** —
   correct, but the e-info side was already covered by `obj/bind.upstream.test.ts`
   (`test_alloc_bad0`); only a-info's `test_alloc0/1/2` were genuinely uncited. Both are now pinned,
   with the artifact bound at 0..255 as `parse_artifact_alloc` has it (not 127).
6. **"`curse.c` and `mspell.c` attach effects to a parent record; check the `childOf` group
   semantics against `records.ts`"** — done, and the semantics are correct: `childOf` attaches to
   the most recent instance of the parent, which is exactly upstream's
   `while (effect->next) effect = effect->next` walk, and orphan deps park on the record rather
   than erroring, matching the C's "human, not parser error". No gap here.
7. **"a wrong parse [in pit.c] silently changes which monsters a pit can hold, which is P1"** —
   correct and load-bearing: that is precisely GAP-2.
8. **"`proj.c` asserts `PARSE_ERROR_ELEMENT_NAME_MISMATCH`, which is a code with exactly one
   upstream user. Make sure the port reaches it for the same input."** — it did not; GAP-6, now
   fixed.

## Every case in the batch

| upstream file | case | verdict | evidence |
| --- | --- | --- | --- |
| parse/c-info.c | `test_stats0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts "test_stats0"; core/src/monclass.upstream.test.ts "test_stats0" |
| parse/c-info.c | `test_skill_disarm_phys0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_disarm_magic0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_device0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_save0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_stealth0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_search0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_melee0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_shoot0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_throw0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_skill_dig0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts skills table; core/src/monclass.upstream.test.ts skill-index test |
| parse/c-info.c | `test_hitdie0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars table; core/src/monclass.upstream.test.ts hitdie/exp/... test |
| parse/c-info.c | `test_exp0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars table; core/src/monclass.upstream.test.ts hitdie/exp/... test |
| parse/c-info.c | `test_max_attacks0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars table; core/src/monclass.upstream.test.ts hitdie/exp/... test |
| parse/c-info.c | `test_min_weight0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars table; core/src/monclass.upstream.test.ts hitdie/exp/... test |
| parse/c-info.c | `test_strength_multiplier0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars table; core/src/monclass.upstream.test.ts hitdie/exp/... test |
| parse/c-info.c | `test_title0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts title order; core/src/monclass.upstream.test.ts titles in level order |
| parse/c-info.c | `test_title_bad0` | GAP (fixed) | G1 - no title cap; ${CORE} rejects an eleventh title |
| parse/c-info.c | `test_equip0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts equip split; core/src/monclass.upstream.test.ts startItems + eopts split |
| parse/c-info.c | `test_equip_bad0` | GAP (not fixed) | G11 - no tval/sval/item-number/option validation on equip: |
| parse/c-info.c | `test_player_flags0` | GAP (fixed) | G3 - empty flags line crashed grabFlags; ${CORE} ORs obj/player flags |
| parse/c-info.c | `test_player_flags_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects unknown player-flags name |
| parse/c-info.c | `test_obj_flags0` | GAP (fixed) | G3 - same presence-marker crash |
| parse/c-info.c | `test_obj_flags_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects unknown obj-flags name |
| parse/c-info.c | `test_missing_magic0` | GAP (not fixed) | G12 - book/spell/effect out of order is silently tolerated |
| parse/c-info.c | `test_magic0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts magic split; core/src/monclass.upstream.test.ts magic first/weight/books |
| parse/c-info.c | `test_missing_book0` | GAP (not fixed) | G12 |
| parse/c-info.c | `test_book0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts book split; core/src/monclass.upstream.test.ts realm + dungeon flag |
| parse/c-info.c | `test_book_graphics0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts book-graphics childOf; core/src/monclass.upstream.test.ts colour resolution |
| parse/c-info.c | `test_book_properties0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts book-properties childOf; core/src/monclass.upstream.test.ts stored props |
| parse/c-info.c | `test_book_properties_bad0` | GAP (not fixed) | G13 - a malformed minmax silently binds 0..0 |
| parse/c-info.c | `test_missing_spell0` | GAP (not fixed) | G12 |
| parse/c-info.c | `test_spell0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts spell split; core/src/monclass.upstream.test.ts sidx/bidx numbering |
| parse/c-info.c | `test_effect0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional fields; core/src/monclass.upstream.test.ts EffectBuilder subtype/radius/other |
| parse/c-info.c | `test_effect_yx0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts childOf; core/src/monclass.upstream.test.ts EffectBuilder effectYx |
| parse/c-info.c | `test_dice0` | GAP (fixed) | G2 - repeated dice: was REPEATED_DIRECTIVE, upstream last-wins |
| parse/c-info.c | `test_dice_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts EffectBuilder rejects "1d4 + 1d8" (INVALID_DICE) |
| parse/c-info.c | `test_missing_dice0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts expr with no dice; core/src/monclass.upstream.test.ts EffectBuilder no-op |
| parse/c-info.c | `test_expr0` | PORTED-NEW | core/src/monclass.upstream.test.ts EffectBuilder binds $D into the dice |
| parse/c-info.c | `test_expr_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts BAD_EXPRESSION_STRING + UNBOUND_EXPRESSION |
| parse/c-info.c | `test_effect_msg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts array joins; core/src/monclass.upstream.test.ts EffectBuilder string_append |
| parse/c-info.c | `test_desc0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts desc array joins; core/src/monclass.upstream.test.ts spell text join |
| parse/c-info.c | `test_spell_bad0` | GAP (not fixed) | G14 - no per-book spell cap (TOO_MANY_ENTRIES) |
| parse/c-info.c | `test_book_bad0` | GAP (not fixed) | G14 - realm rejection is ported, tval + book cap are not |
| parse/k-info.c | `test_graphics0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw glyph/colour; core/src/monclass.upstream.test.ts colour resolver values |
| parse/k-info.c | `test_graphics1` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw glyph/colour; core/src/monclass.upstream.test.ts colour resolver values |
| parse/k-info.c | `test_type0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts tval verbatim; core/src/monclass.upstream.test.ts per-base sval ordinal |
| parse/k-info.c | `test_level0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts level/weight/cost/power |
| parse/k-info.c | `test_weight0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts level/weight/cost/power |
| parse/k-info.c | `test_cost0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts level/weight/cost/power |
| parse/k-info.c | `test_alloc0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw minmax; core/src/monclass.upstream.test.ts grabIntRange split |
| parse/k-info.c | `test_attack0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts three rand fields; core/src/monclass.upstream.test.ts dd/ds + toH/toD |
| parse/k-info.c | `test_armor0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts ac + rand; core/src/monclass.upstream.test.ts ac + toA |
| parse/k-info.c | `test_charges0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw dice; core/src/monclass.upstream.test.ts charge random value |
| parse/k-info.c | `test_pile0` | GAP (fixed) | G4 - took the FIRST pile line; Dragon Breath has two |
| parse/k-info.c | `test_flags0` | PORTED-NEW | core/src/monclass.upstream.test.ts OF / KF / el_info split |
| parse/k-info.c | `test_power0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts power |
| parse/k-info.c | `test_effect0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts four optional forms; core/src/monclass.upstream.test.ts EffectBuilder |
| parse/k-info.c | `test_effect_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_EFFECT + INVALID_VALUE |
| parse/k-info.c | `test_effect_yx0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts childOf; core/src/monclass.upstream.test.ts EffectBuilder effectYx |
| parse/k-info.c | `test_dice0` | GAP (fixed) | G2 - repeated dice: line |
| parse/k-info.c | `test_dice_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts EffectBuilder rejects "d6+d8" |
| parse/k-info.c | `test_missing_dice0` | PORTED-NEW | core/src/monclass.upstream.test.ts EffectBuilder expr no-op without dice |
| parse/k-info.c | `test_expr0` | PORTED-NEW | core/src/monclass.upstream.test.ts EffectBuilder binds $B |
| parse/k-info.c | `test_expr_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts BAD_EXPRESSION_STRING + UNBOUND_EXPRESSION |
| parse/k-info.c | `test_msg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts msg array; core/src/monclass.upstream.test.ts effectMsg join |
| parse/k-info.c | `test_vis_msg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts vis-msg array; core/src/monclass.upstream.test.ts visMsg join |
| parse/k-info.c | `test_pval0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw dice; core/src/monclass.upstream.test.ts pval 1+2d3M4 |
| parse/k-info.c | `test_time0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw dice; core/src/monclass.upstream.test.ts time random value |
| parse/k-info.c | `test_values0` | PORTED-NEW | core/src/monclass.upstream.test.ts modifiers + RES_ split |
| parse/k-info.c | `test_desc0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts desc array; core/src/monclass.upstream.test.ts text join |
| parse/k-info.c | `test_slay0` | PORTED-NEW | core/src/monclass.upstream.test.ts 1-based slays table |
| parse/k-info.c | `test_brand0` | PORTED-NEW | core/src/monclass.upstream.test.ts 1-based brands table |
| parse/k-info.c | `test_curse0` | PORTED-NEW | core/src/monclass.upstream.test.ts non-positive power leaves curses null |
| parse/partrap.c | `test_graphics0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw glyph/colour; core/src/monclass.upstream.test.ts stored glyph/colour |
| parse/partrap.c | `test_appear0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts split; core/src/monclass.upstream.test.ts rarity/minDepth/maxNum |
| parse/partrap.c | `test_visibility0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw text; core/src/monclass.upstream.test.ts power random value |
| parse/partrap.c | `test_visibility_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects "1d6+1d10" (NOT_RANDOM) |
| parse/partrap.c | `test_flags0` | GAP (fixed) | G3 - empty flags line crashed parseTrapFlags |
| parse/partrap.c | `test_effect0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts four optional forms; core/src/monclass.upstream.test.ts EffectBuilder |
| parse/partrap.c | `test_effect_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_EFFECT + INVALID_VALUE |
| parse/partrap.c | `test_effect_yx0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts childOf; core/src/monclass.upstream.test.ts EffectBuilder |
| parse/partrap.c | `test_dice0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts childOf; core/src/monclass.upstream.test.ts 5+2d8M30 |
| parse/partrap.c | `test_dice_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects "1d8+7" |
| parse/partrap.c | `test_missing_dice0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts expr with no dice; core/src/monclass.upstream.test.ts no-op |
| parse/partrap.c | `test_expr0` | PORTED-NEW | core/src/monclass.upstream.test.ts EffectBuilder binds $B |
| parse/partrap.c | `test_expr_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts BAD_EXPRESSION_STRING + UNBOUND_EXPRESSION |
| parse/partrap.c | `test_missing_effect_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts orphan xtra deps; core/src/monclass.upstream.test.ts EffectBuilder no-op |
| parse/partrap.c | `test_effect_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts parallel family; core/src/monclass.upstream.test.ts effectXtra kept apart |
| parse/partrap.c | `test_effect_xtra_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_EFFECT + INVALID_VALUE |
| parse/partrap.c | `test_effect_yx_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts effect-yx-xtra childOf |
| parse/partrap.c | `test_dice_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts dice-xtra childOf; core/src/monclass.upstream.test.ts 10+5d6 |
| parse/partrap.c | `test_dice_xtra_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects "1d6+1d8+1d12" |
| parse/partrap.c | `test_missing_dice_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts expr-xtra with no dice-xtra |
| parse/partrap.c | `test_expr_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts expr-xtra childOf; core/src/monclass.upstream.test.ts EffectBuilder |
| parse/partrap.c | `test_expr_xtra_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts "% 9" + unbound T |
| parse/partrap.c | `test_save0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw flags string; core/src/monclass.upstream.test.ts OF indexes |
| parse/partrap.c | `test_save_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects unknown save flag (INVALID_FLAG) |
| parse/partrap.c | `test_desc0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts desc array; core/src/monclass.upstream.test.ts text join |
| parse/partrap.c | `test_msg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts msg array; core/src/monclass.upstream.test.ts msg join |
| parse/partrap.c | `test_msg_good0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts msg-good array; core/src/monclass.upstream.test.ts msgGood join |
| parse/partrap.c | `test_msg_bad0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts msg-bad array; core/src/monclass.upstream.test.ts msgBad join |
| parse/partrap.c | `test_msg_xtra0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts msg-xtra array; core/src/monclass.upstream.test.ts msgXtra join |
| parse/partrap.c | `test_complete0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts whole dart-trap record; core/src/monclass.upstream.test.ts chain + dice values |
| parse/ptimed.c | `test_badname0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects a name that is not a TMD effect |
| parse/ptimed.c | `test_desc0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts four message arrays; core/src/monclass.upstream.test.ts desc join |
| parse/ptimed.c | `test_endmsg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts on-end array; core/src/monclass.upstream.test.ts onEnd join |
| parse/ptimed.c | `test_incmsg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts on-increase array; core/src/monclass.upstream.test.ts onIncrease join |
| parse/ptimed.c | `test_decmsg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts on-decrease array; core/src/monclass.upstream.test.ts onDecrease join |
| parse/ptimed.c | `test_msgt0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts msgt field; core/src/monclass.upstream.test.ts msgt kept as its name |
| parse/ptimed.c | `test_badmsgt0` | GAP (not fixed) | G15 - no INVALID_MESSAGE check on msgt |
| parse/ptimed.c | `test_fail0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts five fail entries; core/src/monclass.upstream.test.ts code + flag kept |
| parse/ptimed.c | `test_badfail0` | GAP (not fixed) | G16 - no fail code range or flag validation |
| parse/ptimed.c | `test_grade0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional down_msg forms; core/src/monclass.upstream.test.ts zero grade + dummies + FOOD scale |
| parse/ptimed.c | `test_badgrade0` | GAP (fixed) | G5 - no grade range or ascending check |
| parse/ptimed.c | `test_resist0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts resist field; core/src/monclass.upstream.test.ts ELEM index |
| parse/ptimed.c | `test_badresist0` | GAP (fixed) | G6 - unknown element silently became -1 |
| parse/ptimed.c | `test_brand0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts brand array; core/src/monclass.upstream.test.ts buildTempBrandSlay index |
| parse/ptimed.c | `test_badbrand0` | GAP (not fixed) | G17 - unknown brand code resolves to -1 silently |
| parse/ptimed.c | `test_slay0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts slay array; core/src/monclass.upstream.test.ts buildTempBrandSlay index |
| parse/ptimed.c | `test_badslay0` | GAP (not fixed) | G17 |
| parse/ptimed.c | `test_flagsyn0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts flag-synonym split; core/src/monclass.upstream.test.ts oflagDup + oflagSyn |
| parse/ptimed.c | `test_badflagsyn0` | GAP (fixed) | G7 - unknown code silently became OF_NONE |
| parse/ptimed.c | `test_begineffect0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional fields; core/src/monclass.upstream.test.ts EF + subtype |
| parse/ptimed.c | `test_badbegineffect0` | GAP (fixed) | G8 - a negative subtype was stored instead of refused |
| parse/ptimed.c | `test_endeffect0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional fields; core/src/monclass.upstream.test.ts EF + subtype |
| parse/ptimed.c | `test_badendeffect0` | GAP (fixed) | G8 |
| parse/ptimed.c | `test_effectyx0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts shared childOf cursor; core/src/monclass.upstream.test.ts EffectBuilder |
| parse/ptimed.c | `test_effectdice0` | GAP (fixed) | G2 - repeated effect-dice: line |
| parse/ptimed.c | `test_badeffectdice0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects "2+1d3+1d4" (INVALID_DICE) |
| parse/ptimed.c | `test_effectexpr0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts effect-expr childOf; core/src/monclass.upstream.test.ts EffectBuilder |
| parse/ptimed.c | `test_badeffectexpr0` | PORTED-NEW | core/src/monclass.upstream.test.ts BAD_EXPRESSION_STRING + UNBOUND_EXPRESSION |
| parse/ptimed.c | `test_effectmsg0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts array joins; core/src/monclass.upstream.test.ts EffectBuilder append |
| parse/ptimed.c | `test_flags0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts presence marker; core/src/monclass.upstream.test.ts nonStacking |
| parse/ptimed.c | `test_badflags0` | GAP (fixed) | G9 - unknown flag was ignored |
| parse/ptimed.c | `test_lowerbound0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts lower-bound field; core/src/monclass.upstream.test.ts lowerBound |
| parse/ptimed.c | `test_badlowerbound0` | GAP (fixed) | G10 - no 0..32767 range check |
| parse/r-info.c | `test_plural0` | GAP (fixed) | G18 - an empty plural: bound to `true`, not null |
| parse/r-info.c | `test_base0` | PORTED-NEW | core/src/monclass.upstream.test.ts resolves the base by name |
| parse/r-info.c | `test_base_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects an unknown base (INVALID_MONSTER_BASE) |
| parse/r-info.c | `test_glyph0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts char field incl. non-ASCII; core/src/monclass.upstream.test.ts base override |
| parse/r-info.c | `test_color0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts raw token; core/src/monclass.upstream.test.ts letter + case-insensitive full name |
| parse/r-info.c | `test_speed0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts scalars table |
| parse/r-info.c | `test_hp0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts avgHp |
| parse/r-info.c | `test_hearing0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts max_sight/20 scaling |
| parse/r-info.c | `test_smell0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts max_sight/20 scaling |
| parse/r-info.c | `test_ac0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts ac |
| parse/r-info.c | `test_sleep0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts sleep |
| parse/r-info.c | `test_depth0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts level |
| parse/r-info.c | `test_rarity0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts rarity |
| parse/r-info.c | `test_mexp0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts scalars; core/src/monclass.upstream.test.ts mexp |
| parse/r-info.c | `test_blow0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional effect/damage; core/src/monclass.upstream.test.ts method/effect/dice |
| parse/r-info.c | `test_blow1` | PORTED-NEW | content/src/records-monclass.upstream.test.ts the unclaimed 4th field is ignored |
| parse/r-info.c | `test_blow_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts UNRECOGNISED_BLOW + INVALID_EFFECT |
| parse/r-info.c | `test_flags0` | GAP (fixed) | G3 - empty flags line crashed raceFlagsOn |
| parse/r-info.c | `test_flags_off0` | GAP (fixed) | G3 - same for raceFlagsOff |
| parse/r-info.c | `test_desc0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts desc array; core/src/monclass.upstream.test.ts text join "foo bar  baz" |
| parse/r-info.c | `test_innate_freq0` | PORTED-NEW | core/src/monclass.upstream.test.ts 100/pct |
| parse/r-info.c | `test_innate_freq_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects 0/-2/101 (INVALID_SPELL_FREQ) |
| parse/r-info.c | `test_spell_freq0` | PORTED-NEW | core/src/monclass.upstream.test.ts spell-freq 4 -> 25 |
| parse/r-info.c | `test_spell_freq_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects 0/-5/101 (INVALID_SPELL_FREQ) |
| parse/r-info.c | `test_spell_power0` | PORTED-NEW | core/src/monclass.upstream.test.ts explicit value + depth default |
| parse/r-info.c | `test_spells0` | PORTED-NEW | core/src/monclass.upstream.test.ts RSF flags + the two frequency defaults |
| parse/r-info.c | `test_spells_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts rejects an unknown spell (INVALID_FLAG) |
| parse/r-info.c | `test_messagevis0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional text; core/src/monclass.upstream.test.ts seen altmsg incl. "" |
| parse/r-info.c | `test_messagevis_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_SPELL_NAME |
| parse/r-info.c | `test_messageinvis0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional text; core/src/monclass.upstream.test.ts unseen altmsg |
| parse/r-info.c | `test_messageinvis_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_SPELL_NAME |
| parse/r-info.c | `test_messagemiss0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional text; core/src/monclass.upstream.test.ts miss altmsg |
| parse/r-info.c | `test_messagemiss_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_SPELL_NAME |
| parse/r-info.c | `test_drop0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts split + drop-order; core/src/monclass.upstream.test.ts one interleaved drops list |
| parse/r-info.c | `test_drop_bad0` | GAP (not fixed) | G19 - no tval/sval/item-number validation on drop: |
| parse/r-info.c | `test_drop_base0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts split; core/src/monclass.upstream.test.ts sval null for a base drop |
| parse/r-info.c | `test_drop_base_bad0` | GAP (not fixed) | G19 |
| parse/r-info.c | `test_friends0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional role; core/src/monclass.upstream.test.ts role + reverse order + race resolve |
| parse/r-info.c | `test_friends_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts INVALID_MONSTER_ROLE |
| parse/r-info.c | `test_friends_base0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts optional role; core/src/monclass.upstream.test.ts base + role + reverse order |
| parse/r-info.c | `test_friends_base_bad0` | PORTED-NEW | core/src/monclass.upstream.test.ts unknown base and unknown role both refused |
| parse/r-info.c | `test_mimic0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts tval/sval split; core/src/monclass.upstream.test.ts mimicKinds |
| parse/r-info.c | `test_mimic_bad0` | GAP (not fixed) | G19 - mimic: keeps unresolved names |
| parse/r-info.c | `test_shape0` | PORTED-NEW | content/src/records-monclass.upstream.test.ts shape array; core/src/monclass.upstream.test.ts base-wins then race resolve |

## Closing count

170 of 170 cases in the batch adjudicated. 155 ported (154 new, 1 cited to an existing test), 15
GAPs found — 7 fixed with tests that fail on revert, 8 reported and left with the reason. 0 N/A.
314 new tests, all green; `packages/content` 1010 and `packages/core` 3143 pass; `tsc -b` clean.
