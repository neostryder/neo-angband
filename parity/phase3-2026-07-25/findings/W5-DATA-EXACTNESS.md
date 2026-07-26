# W5 — Data exactness findings

**Date:** 2026-07-25 (reviewed and reworked; supersedes the unreviewed checkpoint)
**Worktree:** `C:\Repositories\na-wt-pc` (`p4/w5-data`, rebased onto `master`)
**Test:** `packages/content/src/data-exactness.test.ts`
**Reader:** `packages/content/src/data-exactness.reader.ts` (independent of `parser.ts` / `records.ts`)
**Oracle:** `reference/lib/gamedata/*.txt` + `reference/src/*.c` (Angband 4.2.6, read-only)
**Port side:** `packages/content/pack/*.json` (the committed pack the game loads)

## Review of the checkpoint commit

The first version of this work (`37eecacf7`, "checkpoint, unreviewed") did not
hold up:

1. **It did not typecheck.** `pnpm build` failed with two errors in the two new
   files. Both are fixed.
2. **It failed on `master`.** It was written against a pack that predated the
   `drop-order` order key (`b6f7cfafc`). Rebased onto `master`, the monster
   comparison reported 43 differences, because `toReaderSpec` dropped
   `DirectiveDef.orderKey` on the way into the reader. The reader now
   reimplements order groups independently.
3. **Its flags/spells test asserted nothing.** It compared raw flag strings and
   their token splits between the re-parse and the pack — but the field-level
   diff in the same file already asserts those strings are equal, and both sides
   were tokenized by the same function, so agreement was guaranteed. It also
   `continue`d past any path missing from the pack. Removed.
4. **Its independence was partial.** Format strings, `repeat`, `childOf`,
   `recordStart` and `header` all came from `gamedataSpecs` — port metadata — so
   a wrong format string would have made both sides agree. The format-string
   half of that hole is now closed by reading `parser_reg()` straight out of
   `reference/src/*.c`.
5. **`runExactnessAudit()` was exported but never asserted on.** Untested code
   that duplicated the comparison loop. Removed.

What was sound and kept: the line-level tokenizer (verified against
`parser.c:221-353`), `independentIsValidRandom` (verified against
`parse_random`, `parser.c:126-214`), `independentParseSignature` (verified
against `parse_specs`, `parser.c:424-479`), the record-assembly idioms, and the
deep field-and-index diff.

## Result

**Empty structural diff.** The independent re-parse of every compiled source
matches the committed pack field-by-field and index-by-index.

| Check | Outcome |
|-------|---------|
| 44 pack files vs re-parse | **0 differences** |
| Record counts vs raw record-start line counts | **all equal** |
| `drop-order` vs raw `drop:` / `drop-base:` file order | **all equal** |
| Spec format strings vs C `parser_reg()` | **all exact** |
| Directives in `.txt` not registered | **none** |
| Pack record-root keys not accounted for | **none** |
| Field-level allow-list entries needed | **none** |

## Coverage

`reference/lib/gamedata/` contains **45** `.txt` files.

| Status | Count | Files |
|--------|------:|-------|
| Compared against pack | 44 | every stem in `gamedataSpecs` / `pack/manifest.json` |
| Deferred (not in pack) | 1 | `old_class.txt` — retired class data; `specs/index.ts` deliberately omits it |
| Non-data | — | `Makefile` (build glue, not gamedata) |

| Metric | Value |
|--------|------:|
| Files compared | 44 |
| Records compared | **3 194** |
| Leaf fields compared (pack shape) | **57 045** |
| Distinct (file, directive) pairs occurring in the `.txt` sources | **453** |

### Per-file coverage

| File | Records | Leaf fields | Directives used / registered | Header |
|------|--------:|------------:|:----------------------------:|:------:|
| constants | 1 | 226 | 17 / 17 | |
| object_base | 34 | 152 | 5 / 6 | yes (`default`) |
| object_property | 79 | 1 146 | 13 / 13 | |
| projection | 56 | 546 | 15 / 15 | |
| terrain | 25 | 243 | 16 / 16 | |
| object | 375 | 6 443 | 25 / 26 | |
| monster_base | 56 | 350 | 5 / 5 | |
| monster_spell | 91 | 1 229 | 15 / 16 | |
| blow_methods | 19 | 166 | 8 / 8 | |
| blow_effects | 30 | 246 | 10 / 10 | |
| monster | 624 | 18 406 | 32 / 33 | |
| ego_item | 107 | 1 288 | 14 / 17 | |
| artifact | 138 | 2 786 | 18 / 18 | |
| curse | 27 | 294 | 13 / 15 | |
| brand | 10 | 74 | 8 / 8 | |
| slay | 11 | 88 | 8 / 9 | |
| activation | 163 | 1 672 | 10 / 10 | |
| p_race | 11 | 301 | 22 / 22 | |
| class | 9 | 3 001 | 31 / 32 | |
| player_property | 44 | 275 | 6 / 6 | |
| player_timed | 53 | 573 | 17 / 20 | |
| shape | 9 | 123 | 14 / 19 | |
| body | 1 | 25 | 2 / 2 | |
| history | 165 | 660 | 2 / 2 | |
| names | 2 | 1 190 | 2 / 2 | |
| flavor | 8 | 879 | 3 / 3 | |
| pain | 12 | 96 | 2 / 2 | |
| pit | 40 | 311 | 12 / 12 | |
| room_template | 415 | 7 417 | 9 / 9 | |
| vault | 161 | 3 635 | 9 / 9 | |
| dungeon_profile | 9 | 636 | 7 / 7 | |
| store | 8 | 329 | 7 / 8 | |
| quest | 2 | 8 | 4 / 4 | |
| summon | 17 | 87 | 7 / 7 | |
| trap | 40 | 651 | 16 / 19 | |
| chest_trap | 7 | 51 | 9 / 10 | |
| realm | 4 | 20 | 5 / 5 | |
| world | 128 | 512 | 1 / 1 | |
| hints | 99 | 99 | 1 / 1 | |
| ui_entry_renderer | 5 | 27 | 7 / 10 | |
| ui_entry_base | 3 | 30 | 6 / 20 | |
| ui_entry | 47 | 246 | 12 / 20 | |
| ui_knowledge | 48 | 104 | 4 / 4 | |
| visuals | 1 | 404 | 4 / 4 | |
| **total** | **3 194** | **57 045** | **453 used** | |

"Directives used" counts distinct directives that actually occur in the `.txt`;
"registered" is the spec's table size. Used < registered is normal (upstream
registers optional directives the shipped data never exercises).

## Directive-coverage guard (task #27)

Five assertions, all in `describe("W5 directive coverage guard (task #27)")`:

1. **`.txt` → handled.** Every directive key occurring in a compiled
   `reference/lib/gamedata/<file>.txt` must be registered for that file's spec.
   Directive keys are extracted by `extractDirectiveSequence()`, which mirrors
   only the front of `parser_parse()` (leading-whitespace skip, blank/`#` drop,
   first `strtok(":")` token) and does no field parsing.
   Allow-list `UNHANDLED_TXT_DIRECTIVES`: **empty**. Stale entries also fail.
2. **pack → handled.** Every key the pack emits at record root (or in the
   header) must be a registered directive or a declared `orderKey`. This is the
   direction that catches `drop-order`, which is not an upstream directive at
   all but a key the pack's compiler generates.
   Allow-list `SYNTHETIC_PACK_KEYS`: one entry, `monster:drop-order` (below).
3. **Synthetic keys are declared on both sides.** Each `SYNTHETIC_PACK_KEYS`
   entry must be declared as an `orderKey` on the port spec *and* survive
   `toReaderSpec()` into the independent reader. Dropping it in that translation
   is exactly the `37eecacf7` defect.
4. **Spec format strings are the C format strings.** Every spec `fmt`, after
   `strtok(" ")` normalization, must equal a format string passed to
   `parser_reg()` in the C file the spec names as `upstream`.
5. **Programmatic registrations are derivable and complete.** See
   `PROGRAMMATIC_PARSER_REG` below.

### Allow-list entries and their justification

| List | Entry | Justification |
|------|-------|---------------|
| `DEFERRED_SOURCES` | `old_class` | Retired upstream class data, not compiled into the pack (`specs/index.ts`). The file's existence is asserted; its values are not compared. |
| `UNHANDLED_TXT_DIRECTIVES` | *(empty)* | Every directive appearing in every compiled file is registered. |
| `SYNTHETIC_PACK_KEYS` | `monster` / `drop-order` | C keeps `drop:` and `drop-base:` in a single `monster_drop` list — both `parse_monster_drop` and `parse_monster_drop_base` prepend to `r->drops` (`mon-init.c:1534,1558`) — so the two directives interleave. The pack splits them into per-directive arrays and records the original file order in `drop-order`. Declared via `orderKey` on both directives in `specs/mon-init.ts`. |
| `PROGRAMMATIC_PARSER_REG` | `src/ui-entry.c` | `ui-entry.c:2289-2292` registers `label1`…`labelN` with `parser_reg(p, format("label%d str label%d", i, i), ...)` for `i = 1..MAX_SHORTENED`, so no string literal exists to match. The entry does not excuse the family: it re-derives it from the same file (template regex, loop-bound regex, and `#define MAX_SHORTENED (10)`), and a further assertion requires the derivation to be non-empty and each spec naming that source to carry the whole family, not a prefix. One parser serves both `ui_entry_base.txt` and `ui_entry.txt` (`run_parse_ui_entry`, `ui-entry.c:2301`). |
| Field-level `ALLOW_LIST` | *(empty)* | No pack value differs from the independent re-parse. |

### Proof the guard catches a missing `drop-order`

Five mutations, each reverted immediately after:

| Mutation | Result |
|----------|--------|
| A — drop `orderKey` in `toReaderSpec` (the original defect) | 2 failed: `monster.txt field-level match` (43 diffs), `every synthetic pack key is declared as an orderKey the reader also generates` |
| B — remove `monster:drop-order` from `SYNTHETIC_PACK_KEYS` | 1 failed: `every key the pack emits at record root ...` |
| C — remove `orderKey: "drop-order"` from `specs/mon-init.ts` (i.e. from the handled set entirely) | 3 failed: field-level match plus both pack-side coverage guards |
| D — remove the `drop-base` directive from the monster spec | 5 failed, including `every directive occurring in a compiled .txt is registered` reporting `monster:drop-base` |
| E — change `armor-class int ac` to `armor-class uint ac` in the monster spec | 1 failed: `spec format strings are the verbatim parser_reg() strings`, reporting `spec: armor-class uint ac` / `C: armor-class int ac` |

Mutation E is the one the field diff alone cannot catch: both sides would have
parsed the value with the same wrong type and agreed.

## What is still not verified (residual holes)

| Item | Why |
|------|-----|
| **`repeat`, `childOf`, `recordStart`, `header`, `orderKey` metadata** | Not derivable from the C sources by text inspection — it is implicit in the handler bodies (`r->drops` prepend, "walk to the last effect", …). Still port-supplied on both sides of the diff. `repeat: false` is partly validated by the data (a second occurrence in one record throws), but `repeat: true` where C would overwrite is not detectable here. **This is the largest remaining hole.** |
| **Resolved runtime monster flags / glyphs after `base:` inheritance** | The pack deliberately stores the unresolved `base:` reference rather than the post-`rf_union` `monster_race`. Runtime load applies base defaults the way `mon-init.c` does. Inheritance is checked as *resolvability*, not as flattened effective flags. |
| **Resolved `object_base` → kind defaults** | Same shape: the pack keeps `type:` as a tval name; C copies base flags into kinds at init. |
| **`old_class.txt`** | Not compiled; presence asserted, values not compared. |
| **C bitflag enum identity** (`RF_*`, `OF_*`, …) | The pack stores symbolic flag *names* as they appear in the text. Mapping names to bit indices is engine work, not pack compile output. |
| **Dice / expression evaluation** | Both parsers store raw dice/expression strings; only grammar validity is enforced at parse. Evaluation lives in the `z-dice` / `z-expression` ports. |
| **Index semantics at runtime** | Record order is compared index-by-index. Whether every consumer uses those indices the way C does is wiring (W2), not pack content. |
| **`uint` fields with whitespace before a `-`** | C checks only `*tok == '-'`, so `" -5"` would reach `strtoul` and wrap; the reader throws `NOT_NUMBER` instead. No such value exists in 4.2.6 gamedata, and the divergence would surface as a loud failure rather than a silent pass. |

## Artifacts

| Path | Role |
|------|------|
| `packages/content/src/data-exactness.reader.ts` | Independent re-parser + `.txt` / `parser_reg` scanners |
| `packages/content/src/data-exactness.test.ts` | Vitest suite (67 tests) |
| `parity/phase3-2026-07-25/findings/W5-DATA-EXACTNESS.md` | This report |

## Verification

```text
pnpm build                                                          exit 0
vitest run packages/content/src/data-exactness.test.ts               67 passed / 0 failed
vitest run packages/content/src/{data-exactness,pack,parser,records}.test.ts
                                                                    159 passed / 0 failed
```

## Conclusion

The build-time concession (no runtime parse of `lib/gamedata/*.txt` in the
browser) is guarded by a permanent, independent field-level re-parse: 44 files,
3 194 records, 57 045 leaf fields, zero divergence. Format strings are now
checked against `parser_reg()` in the C sources rather than trusted, and a
directive-coverage guard fails if a directive in the data — or a generated key
in the pack — is not accounted for on both sides.
