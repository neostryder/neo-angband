# UT-monclass — 181 uncited upstream cases from five parse/ files

Batch: `parse/c-info.c` (44), `parse/r-info.c` (44), `parse/ptimed.c` (33),
`parse/k-info.c` (30), `parse/partrap.c` (30). Every case in the batch is
adjudicated below; no sampling.

## Where the cases landed

Upstream's parse handlers do two jobs in one function body: split the line, then
resolve names to enums, range-check numbers and look across records. The port
splits those, so a single upstream case usually has one assertion in each half:

| layer | port code | new test file |
| --- | --- | --- |
| line grammar + record assembly | `packages/content/src/{parser,records}.ts` + `src/specs/` | `packages/content/src/records-monclass.upstream.test.ts` (89 tests) |
| name/enum resolution, range checks, cross-record lookups | `packages/core/src/{mon,obj,player,world,effects}/…` | `packages/core/src/monclass.upstream.test.ts` (105 tests) |

The brief named one file; two were needed because `packages/content` has no
dependency on `packages/core` (no project reference, no import anywhere in
`packages/content/src`), so a content test physically cannot reach a binder.
Both files are new, so neither collides with the sibling lanes.

The effect / effect-yx / dice / expr / effect-msg cases are shared: upstream has
four near-identical copies of `grab_effect_data` plus its dice/expr handlers (in
`init.c` for class and trap, `obj-init.c` for object, `player-timed.c` for timed
effects), and the port has one `EffectBuilder`
(`packages/core/src/effects/effect.ts`). Those cases are asserted once there,
with all four upstream file names in the test title.

## Counts

| verdict | cases |
| --- | --- |
| PORTED-NEW | 149 |
| GAP, fixed | 18 |
| GAP, not fixed | 14 |
| **total** | **181** |

No case in this batch was PORTED-EXISTING or N/A: every one of the 181 had a
port behaviour to check, and none of them is about C machinery the port lacks.
(Four related cases were already cited before this lane —
`test_missing_record_header0` / `test_missing_header_record0` / `test_name0` /
`test_magic_repeated0` — and one of those citations turned out to be wrong; see
"What the brief and the ledger got wrong" below.)

Suite results after the work: `tsc -b` clean; `packages/content` +
`packages/core` **4038 tests in 230 files, all passing**; `packages/mod-sdk` +
`packages/linoleum` 175/175; `packages/cli` 38 passing + 1 skipped;
`packages/web` 435/435. (`packages/borg` not run — `think.test.ts` /
`foundation.test.ts` hang, per the brief.)

## GAPs

### G1 — a class may declare more than ten titles

- **ref**: `init.c` L3558-3573 `parse_class_title` fills
  `const char *title[10]` (`player.h` L313) and returns
  `PARSE_ERROR_TOO_MANY_ENTRIES` once it is full. `c-info.c test_title_bad0`.
- **port**: `player/bind.ts bindClass` did `titles: rec.title ? [...rec.title] : []`
  with no cap.
- **what differs**: an eleventh title was accepted and stored.
- **effect**: `player_class.titles[10]` and up are unreachable in play (the
  char-sheet indexes `lev / 5`), so extra titles are silently dead data rather
  than a visible divergence. A mod adding titles would get no diagnostic.
- **severity**: P3
- **fixed**: yes — `CLASS_MAX_TITLES = 10` and a throw naming
  `PARSE_ERROR_TOO_MANY_ENTRIES`.

### G2 — a repeated `dice:` line was refused where upstream overwrites

- **ref**: every dice handler `dice_free()`s the previous dice and stores the new
  one, with no repeated-directive check: `init.c` L3983-3985
  (`parse_class_dice`), `obj-init.c` L1947-1949 (`parse_object_dice`), `init.c`
  L1688-1690 (`parse_trap_dice`), `init.c` L1802-1810
  (`parse_trap_dice_xtra`), `player-timed.c` L503-505
  (`parse_player_timed_effect_dice`). `c-info.c test_dice0` and `k-info.c
  test_dice0` both parse a second `dice:` for one effect and assert
  `PARSE_ERROR_NONE` plus the NEW values; `ptimed.c test_effectdice0` does the
  same for `effect-dice:`.
- **port**: `records.ts compileGamedata` threw
  `duplicate directive "dice" (not marked repeat in the spec)` for any second
  occurrence of a non-`repeat` directive.
- **what differs**: a gamedata file upstream accepts was rejected outright.
- **effect**: not reachable from shipped 4.2.6 data (no record repeats `dice:`
  on one effect — the compiler would already have failed), but it makes the
  compiler stricter than the format it claims to implement, which matters for
  the mod substrate.
- **severity**: P3
- **fixed**: yes — new `DirectiveDef.lastWins`, set on `dice` in the class,
  object and trap specs, on `dice-xtra` in the trap spec, and on `effect-dice`
  in the player_timed spec.
- **residual**: the same wart applies to the `dice` directive of the specs this
  lane does not own — `curse`, `activation`, `artifact` (no `dice`), `shape`,
  `monster_spell`, `chest_trap`, `ego_item`. Their upstream handlers are the
  same shape, so they need the same flag; left for the lanes that own
  `records-objterrain` and `records-misc` rather than reaching into their files.
  More broadly, nearly every scalar directive upstream (`level:`, `weight:`,
  `cost:` …) is a plain assignment and therefore last-wins, while the port
  refuses the repeat. Making that the default is a cross-cutting change to all
  44 specs and would silence the duplicate detection that `f-info.c
  test_name_bad0` and `c-info.c test_magic_repeated0` rely on, so it is reported
  rather than done.

### G3 — an empty flags line crashed three binders

- **ref**: every flags handler checks `parser_hasval()` first and returns
  `PARSE_ERROR_NONE` with the flag set untouched: `mon-init.c` L1316-1317
  (`parse_monster_flags`, and `parse_monster_flags_off` /
  `parse_monster_spells` alongside it), `init.c` L3672-3673
  (`parse_class_obj_flags` / `parse_class_play_flags`), `init.c` L1612-1614
  (`parse_trap_flags`). Asserted by `r-info.c test_flags0` / `test_flags_off0`,
  `c-info.c test_obj_flags0` / `test_player_flags0`, `partrap.c test_flags0`.
- **port**: the compiler correctly records a bare `flags:` as a presence marker
  (`true`) — that IS `parser_hasval() == false`. But `mon/bind.ts`
  `raceFlagsOn` / `raceFlagsOff` / `spellFlagsOn`, `player/bind.ts grabFlags`
  and `world/trap.ts parseTrapFlags` all called `line.split("|")` on it and
  threw `TypeError: line.split is not a function`.
- **what differs**: legal input became a hard crash during bind, not a parse
  error — the game would fail to start rather than report a bad line.
- **effect**: unreachable from shipped data (no gamedata file has an empty flag
  line), but any mod or user data file with one takes the whole registry down.
- **severity**: P2
- **fixed**: yes — `flagSegments()` in `mon/bind.ts` and a
  `typeof line !== "string"` skip in `player/bind.ts` and `world/trap.ts`.

### G4 — the Potion of Dragon Breath generated the wrong pile

- **ref**: `obj-init.c` L1838-1847 `parse_object_pile` plainly assigns
  `k->gen_mult_prob` and `k->stack_size`, so a record with two `pile:` lines
  keeps the LAST. `object.txt` L3678 / L3680 is exactly that: `pile:100:1d2`
  then `pile:70:1d3`. It is the only shipped record with two. `k-info.c
  test_pile0`.
- **port**: `obj/bind.ts bindKinds` read `rec.pile?.[0]`.
- **what differs**: `genMultProb` 100 instead of 70 and `stackSize` `1d2`
  instead of `1d3`.
- **effect**: real, in normal play. `obj/make.ts` L1298 tests
  `kind.genMultProb >= rng.randint1(100)`, so the port made every Potion of
  Dragon Breath a pile (upstream: 70% of the time) and capped the pile at 2
  (upstream: 3). The RNG draw itself is unchanged, so this does not shift the
  stream.
- **severity**: P2
- **fixed**: yes — `rec.pile?.[rec.pile.length - 1]`.

### G5 — timed-effect grades were never range- or order-checked

- **ref**: `player-timed.c` L262-265 rejects `grade_max <= 0` or
  `> 32767 / food_scl` (`PARSE_ERROR_INVALID_VALUE`, because a duration is an
  `int16_t` and 0 would collide with the implicit "off" grade), and L273-280
  rejects a maximum that does not exceed the highest so far.
  `ptimed.c test_badgrade0`.
- **port**: `player/bind.ts bindTimed` stored `max: g.max * foodScale` unchecked.
- **what differs**: a negative, zero, oversized or descending grade maximum
  bound silently.
- **effect**: `playerTimedGrade()` walks the grade list by ascending `max`; a
  descending or negative entry makes it pick the wrong grade, i.e. the wrong
  status name, colour and message. Unreachable from shipped data.
- **severity**: P3
- **fixed**: yes.

### G6 — an unknown `resist:` element became "no resist"

- **ref**: `player-timed.c` L340-352: `proj_name_to_idx` failure or an index
  past `ELEM_MAX` is `PARSE_ERROR_INVALID_VALUE`.
  `ptimed.c test_badresist0` (asserts only "not NONE").
- **port**: `(ELEM)[rec.resist] ?? -1` — the same value as "no resist declared".
- **what differs**: a typo in a resist name silently removed the temporary
  resistance instead of failing the load.
- **effect**: the effect would grant no elemental resistance. Unreachable from
  shipped data.
- **severity**: P3
- **fixed**: yes.

### G7 — an unknown `flag-synonym:` code became OF_NONE

- **ref**: `player-timed.c` L407-427: `code_index_in_array(obj_flags, code)`
  at or below `OF_NONE` is `PARSE_ERROR_INVALID_OBJ_PROP_CODE`.
  `ptimed.c test_badflagsyn0`.
- **port**: `(OF)[synonym.code] ?? 0`, i.e. OF_NONE, which is also "no synonym".
- **what differs**: the duplicated object flag was silently dropped.
- **effect**: the timed effect would not shadow its object flag on the
  character sheet. Unreachable from shipped data.
- **severity**: P3
- **fixed**: yes.

### G8 — an unresolvable effect subtype was stored as a negative number

- **ref**: `grab_effect_data`, `init.c` L191-196: `effect_subtype()` returning
  `< 0` is `PARSE_ERROR_INVALID_VALUE`.
  `ptimed.c test_badbegineffect0` / `test_badendeffect0`.
- **port**: `bindTimed`'s `parseChain` stored `effectSubtype(...)` even when
  negative. (`EffectBuilder`, which the other three parsers' equivalent goes
  through, already threw.)
- **what differs**: `on-begin-effect:CURE:XYZZY` bound with `subtype = -1`.
- **effect**: the effect would run against subtype -1, which no handler
  recognises. Unreachable from shipped data.
- **severity**: P3
- **fixed**: yes.

### G9 — an unknown timed-effect flag was ignored

- **ref**: `player-timed.c` L562-590: anything but `NONSTACKING` is
  `PARSE_ERROR_INVALID_FLAG`. `ptimed.c test_badflags0`.
- **port**: `(rec.flags ?? []).includes("NONSTACKING")` — an unknown flag was
  dropped, and a flag written `NONSTACKING | X` was not even seen, because
  upstream `strtok`s on `" |"` and the port compared whole lines.
- **what differs**: no diagnostic, and pipe-separated flags did not apply.
- **severity**: P3
- **fixed**: yes — tokenised on `/[ |]+/` with a throw on any other name.

### G10 — `lower-bound:` was never range-checked

- **ref**: `player-timed.c` L599-604 rejects anything outside 0..32767
  (`PARSE_ERROR_INVALID_VALUE`; a negative bound breaks the "is this effect
  active" test and the duration is an `int16_t`).
  `ptimed.c test_badlowerbound0`.
- **port**: `rec["lower-bound"] ?? 0`, unchecked.
- **effect**: a negative bound would make the effect read as permanently active.
  Unreachable from shipped data.
- **severity**: P3
- **fixed**: yes.

### G11 — `equip:` is not validated at all

- **ref**: `init.c` L3590-3663 `parse_class_equip` reports
  `PARSE_ERROR_UNRECOGNISED_TVAL`, `PARSE_ERROR_UNRECOGNISED_SVAL`,
  `PARSE_ERROR_INVALID_ITEM_NUMBER` (`min > 99 || max > 99`, L3653) and
  `PARSE_ERROR_INVALID_OPTION` (a name `lookup_option` misses, or one whose
  `option_type` is not `OP_BIRTH`). `c-info.c test_equip_bad0`.
- **port**: `bindClass` copies `tval`, `sval`, `min`, `max` and the split
  `eopts` verbatim; nothing is resolved or bounded.
- **what differs**: all four error codes are missing.
- **effect**: a bad starting-equipment line surfaces later as a failed item
  lookup at birth rather than at load. Unreachable from shipped data.
- **severity**: P3
- **fixed**: no. `tval`/`sval` need the `ObjRegistry`, which `bindPlayer` does
  not take (`registerBookKinds` in `player/spell.ts` is the existing seam for
  the class↔object crossing), and `eopts` needs the birth-option table with its
  `OP_BIRTH` type. Doing it properly means giving `bindClass` both, which is a
  restructure of the bind order rather than an edit.

### G12 — book / spell / effect lines out of order are silently tolerated

- **ref**: `c-info.c test_missing_magic0`, `test_missing_book0`,
  `test_missing_spell0`. Upstream reports a specific MIXTURE per directive:
  `book:` and `spell:` without the enclosing `magic:` / `book:` are
  `PARSE_ERROR_TOO_MANY_ENTRIES` (the num_books / num_spells counter is 0), while
  `book-graphics:`, `book-properties:`, `effect:`, `effect-yx:`, `dice:`,
  `expr:`, `effect-msg:` and `desc:` are `PARSE_ERROR_MISSING_RECORD_HEADER`
  (e.g. `parse_class_dice`, `init.c` L3952-3968, checks `!c`,
  `num_books < 1` and `num_spells < 1` in turn).
- **port**: `compileGamedata` attaches an orphan to the enclosing record and
  `bindClassMagic` returns an empty magic block when `magic:` is absent, so a
  file with the directives out of order compiles and binds to a class with no
  spells.
- **what differs**: nine error codes are missing, and the affected books/spells
  are silently dropped.
- **effect**: a malformed class.txt yields a spell-less caster instead of a
  load error. Unreachable from shipped data.
- **severity**: P3
- **fixed**: no. Reproducing this needs the records layer to know that `book`
  requires a live `magic` and that `spell` requires a live `book`, with a
  DIFFERENT error code per directive — i.e. per-directive prerequisite metadata
  plus a two-code error vocabulary. G2's new `requireParent` flag is the
  one-code version of this; extending it to carry the code, and to distinguish
  "parent absent" from "parent's declared capacity is zero", is a records-layer
  design change, not an edit.

### G13 — a malformed `book-properties:` allocation range binds 0..0

- **ref**: `init.c parse_class_book_properties` runs the range through
  `grab_int_range` and returns `PARSE_ERROR_INVALID_ALLOCATION` on failure.
  `c-info.c test_book_properties_bad0` plants `1 100` (no `to`).
- **port**: `player/spell.ts registerBookKinds` matches
  `/^(\d+)\s+to\s+(\d+)$/` and, on no match, leaves `allocMin`/`allocMax` at 0.
- **what differs**: no error; the book kind gets an empty allocation window.
- **effect**: the book would never generate in the dungeon. Note `obj/bind.ts`
  already has the faithful `grabIntRange` (with the INT_MIN/INT_MAX rejection
  `k-info.c test_alloc_bad0` asserts) — `registerBookKinds` simply does not use
  it. Unreachable from shipped data.
- **severity**: P3
- **fixed**: no — the fix is to route `registerBookKinds` through
  `grabIntRange`, which crosses `player` → `obj` and changes what a failing
  book does at a point the ObjRegistry is already half-built. Small but not
  safe to do blind; flagged for the owner of `player/spell.ts`.

### G14 — no book or spell capacity check, and no book tval check

- **ref**: `c-info.c test_book_bad0` asserts
  `PARSE_ERROR_UNRECOGNISED_TVAL` for `book:xyzzy:…` and
  `PARSE_ERROR_TOO_MANY_ENTRIES` once `magic:`'s book count is used up (a bad
  tval does NOT consume a slot); `test_spell_bad0` asserts
  `PARSE_ERROR_TOO_MANY_ENTRIES` once `book:`'s spell count is used up.
- **port**: `bindClassMagic` resolves the realm (that half IS ported and
  asserted) but keeps `tval` as a name and ignores `magic.books` /
  `book.spells` as capacities — `numBooks` and `numSpells` are stored but never
  compared against the number of records.
- **effect**: a class declaring more books or spells than it reserved binds all
  of them. Unreachable from shipped data.
- **severity**: P3
- **fixed**: no. The tval half needs the `ObjRegistry` (same reason as G11);
  the capacity half is cheap on its own but pointless in isolation, since the
  same records also drive `registerBookKinds`, which would then disagree about
  how many books exist.

### G15 — `msgt:` is never validated

- **ref**: `player-timed.c parse_player_timed_msgt` returns
  `PARSE_ERROR_INVALID_MESSAGE` when `message_lookup_by_name` fails.
  `ptimed.c test_badmsgt0`.
- **port**: `msgt: rec.msgt ?? "GENERIC"` — the name is kept as a string and
  resolved (or not) much later by the sound/message layer.
- **effect**: a typo'd message type degrades to no sound instead of failing the
  load. Unreachable from shipped data.
- **severity**: P3
- **fixed**: no — `TimedEffect.msgt` is a string by design across the port
  (`sound/engine.ts` resolves it), so validating here means either duplicating
  the message table lookup in `player/bind.ts` or changing the field's type.
  Deliberately left to whoever owns the msgt representation.

### G16 — `fail:` codes and flags are never validated

- **ref**: `player-timed.c parse_player_timed_fail` returns
  `PARSE_ERROR_INVALID_FLAG` both for an unknown flag name and for a code
  outside 1..5 (`TMD_FAIL_FLAG_OBJECT` … `TMD_FAIL_FLAG_TIMED_EFFECT`);
  the flag is looked up in a different table per code.
  `ptimed.c test_badfail0` walks all seven forms.
- **port**: `fail: (rec.fail ?? []).map((f) => ({ code: f.code, flag: f.flag }))`
  — both fields copied verbatim.
- **effect**: `obj/effects-info.ts` maps only OBJECT / RESIST / VULN, so an
  unknown code or flag silently contributes nothing to the failure check.
  Unreachable from shipped data.
- **severity**: P3
- **fixed**: no — the per-code flag table (`OF` / element names / `PF` / `TMD`)
  would have to be threaded into `bindTimed`, and `TimedFail.flag` is currently
  a string that three consumers re-resolve. Changing that is a representation
  change, not an edit.

### G17 — an unknown timed brand/slay code resolves to -1 silently

- **ref**: `player-timed.c` L380 / L403 scan the brand and slay tables and
  return `PARSE_ERROR_UNRECOGNISED_BRAND` / `PARSE_ERROR_UNRECOGNISED_SLAY` on
  a miss. `ptimed.c test_badbrand0` / `test_badslay0`.
- **port**: `player/timed.ts buildTempBrandSlay` uses `findIndex`, which
  returns -1 for an unknown code — indistinguishable from "no temporary brand".
- **effect**: the effect grants no temporary brand or slay. Unreachable from
  shipped data.
- **severity**: P3
- **fixed**: no — the resolution deliberately happens at session-install time
  (the brand and slay tables live in the `ObjRegistry`, which `bindPlayer` does
  not see), so the check belongs at that seam, in the session wiring, not in
  `bindTimed`. Same layering reason as G11.

### G18 — an empty `plural:` bound to `true` instead of null

- **ref**: `mon-init.c` L1673-1690 `parse_monster_plural`: with the field
  present but zero-length, `r->plural` is explicitly set to NULL.
  `r-info.c test_plural0`.
- **port**: `plural: rec.plural ?? null` — the compiler's presence marker for a
  bare `plural:` is `true`, which is not `null` or `undefined`, so it survived.
- **what differs**: `MonsterRace.plural` held the boolean `true`.
- **effect**: `mon/desc.ts` treats a non-null `plural` as the plural noun, so a
  race with an empty `plural:` line would be described as "true" in the plural.
  Unreachable from shipped data (every `plural:` in monster.txt has text).
- **severity**: P2 if reached, P3 as shipped.
- **fixed**: yes — `typeof rec.plural === "string" && rec.plural.length > 0`.

### G19 — monster `drop:` / `drop-base:` / `mimic:` are not validated

- **ref**: `mon-init.c` `parse_monster_drop` /
  `_drop_base` / `_mimic` report `PARSE_ERROR_UNRECOGNISED_TVAL`,
  `PARSE_ERROR_UNRECOGNISED_SVAL` and `PARSE_ERROR_INVALID_ITEM_NUMBER`
  (anything above 99 for min or max). `r-info.c test_drop_bad0`,
  `test_drop_base_bad0`, `test_mimic_bad0`.
- **port**: `MonsterDrop` and `MonsterMimic` keep `tval` / `sval` as NAMES
  (`mon/types.ts` L171-183) and `bindDrop` copies `min` / `max` unbounded; the
  game layer (`game/mon-death.ts`, `game/mon-place.ts`, `gen/util.ts`) resolves
  the names when it needs a kind.
- **what differs**: three error codes missing; a bad name surfaces as a failed
  lookup during monster death or placement.
- **effect**: unreachable from shipped data.
- **severity**: P3
- **fixed**: no — `bindMonsters` takes no `ObjRegistry` by design (the
  monster domain binds before the object domain in the session wiring), so this
  check belongs where the names are resolved. Same layering reason as G11/G17.

## Mutation table

Each row: revert one production change, then run this lane's two new test files
and, separately, the rest of `packages/content` + `packages/core`.

| # | mutation (revert of) | caught by this lane's tests | caught by the pre-existing suite |
| --- | --- | --- | --- |
| M1 | records.ts: drop `lastWins` (revert G2) | YES | only via the `needsParent` leg this lane added to `records.upstream.test.ts` (`accepts "effect-dice:2d20" after the record header`) - not independent coverage |
| M2 | records.ts: drop `requireParent` (revert the ptimed orphan fix) | YES | no |
| M3 | obj/bind.ts: take the FIRST pile line (revert G4) | YES | no |
| M4 | mon/bind.ts: flagSegments splits unconditionally (revert G3, monster) | YES | no |
| M5 | mon/bind.ts: plural falls through the presence marker (revert G18) | YES | no |
| M6 | player/bind.ts: grabFlags splits unconditionally (revert G3, class) | YES | no |
| M7 | world/trap.ts: parseTrapFlags splits unconditionally (revert G3, trap) | YES | no |
| M8 | player/bind.ts: drop the grade range check (revert G5a) | YES | no |
| M9 | player/bind.ts: drop the grade ascending check (revert G5b) | YES | no |
| M10 | player/bind.ts: drop the resist validation (revert G6) | YES | no |
| M11 | player/bind.ts: drop the flag-synonym validation (revert G7) | YES | no |
| M12 | player/bind.ts: drop the timed flags validation (revert G9) | YES | no |
| M13 | player/bind.ts: drop the lower-bound range check (revert G10) | YES | no |
| M14 | player/bind.ts: drop the class title cap (revert G1) | YES | no |
| M15 | player/bind.ts: drop the effect subtype check (revert G8) | YES | no |

Every one of the fifteen production changes is pinned: reverting it fails this lane's tests, and (M1's caveat aside) nothing in the 4038-test pre-existing content + core suite noticed any of them. That is the measure of how much of this batch was invisible before.

Method: revert one change, run (a) only `records-monclass.upstream.test.ts` + `monclass.upstream.test.ts`, then (b) `packages/content` + `packages/core` with those two files `--exclude`d; restore; repeat. Harness and raw log kept out of the repo.

## What the brief and the ledger got wrong

1. **"`eq(r, PARSE_ERROR_INVALID_FLAG)` ports directly."** It does not. The
   content-layer `ParseError.code` union has exactly six members —
   `MISSING_FIELD`, `UNDEFINED_DIRECTIVE`, `FIELD_TOO_LONG`, `NOT_NUMBER`,
   `NOT_RANDOM`, `INVALID_SPEC` — which are the codes `parser.c` itself can
   raise. Every other `PARSE_ERROR_*` in these five files comes from a handler
   body and therefore from a core binder, which reports it as a plain `Error`
   whose message names the code. `packages/core/src/generated/parser-errors.ts`
   is a name/description table, not something either layer throws.

2. **The one-file instruction is not satisfiable.** `packages/content` has no
   dependency on `packages/core` (no project reference in `tsconfig.json`, no
   `@rpgm-tools/neo-angband-*` import anywhere in `packages/content/src`), and
   `tsc -b` typechecks test files, so a content test cannot import a binder.
   Two files, both new.

3. **`parse/ptimed.c test_missing_effect0` was recorded as cited, wrongly.**
   The ledger keys on the case NAME, and `records.upstream.test.ts` cites
   `test_missing_effect0` for `c-info.c`, where orphan effect dependencies are
   `PARSE_ERROR_NONE`. ptimed's case of the same name asserts the opposite:
   all four of `player-timed.c`'s effect-detail handlers return
   `PARSE_ERROR_MISSING_RECORD_HEADER` when `ps->e` is NULL (L480, L496, L524,
   L557). The port tolerated the orphan, so this was a real GAP hiding behind a
   green ledger row. Fixed with the new `DirectiveDef.requireParent` flag on
   the four player_timed effect-detail directives.
   - **Residual**: upstream's `effect-expr` guard is `!ps->e || !ps->e->dice`,
     so `on-begin-effect:DAMAGE` followed by `effect-expr:…` with no
     `effect-dice:` between them is also `MISSING_RECORD_HEADER`. The port only
     checks for the parent effect, because the records layer has no notion of
     "a sibling directive must already be present on the parent". Not fixed;
     unreachable from shipped data.
   - This also required a 6-line change to the existing
     `records.upstream.test.ts`: its `HEADER_CASES` loop asserted every
     dependent line is accepted "after the record header", which was its own
     extrapolation from upstream's test (upstream only asserts they fail
     BEFORE a record) and is now false for ptimed. Added an optional
     `needsParent` prefix, used only by the player_timed entry.

4. **The ledger over-credits by name.** Re-running `ut-ledger.mjs` after this
   lane takes global UNCITED from 530 to 224. Only 181 of those 306 are this
   batch; the other 125 are cases in OTHER upstream files that happen to share
   a name with one this lane cited (`test_dice0`, `test_effect0`, `test_flags0`,
   `test_desc0` … recur across most of `parse/`). Those 125 have NOT been
   adjudicated by anyone. The ledger needs a `file:case` key, not `case`, before
   its count can be read as coverage.

5. Confirmed correct in the brief: the `records.upstream.test.ts` /
   `parser.upstream.test.ts` style guidance; "use the REAL shipped spec"; and
   "start with the error cases" — every one of the 32 GAPs-and-fixes above came
   from a malformed or degenerate input, and none from a well-formed one, exactly
   as predicted.

## Per-case verdicts

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
