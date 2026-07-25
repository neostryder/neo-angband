# W5 — Data exactness findings

**Date:** 2026-07-25  
**Worktree:** `C:\Repositories\na-wt-pc` (`p3/data`)  
**Test:** `packages/content/src/data-exactness.test.ts`  
**Reader:** `packages/content/src/data-exactness.reader.ts` (independent of `parser.ts` / `records.ts`)  
**Oracle:** `reference/lib/gamedata/*.txt` (Angband 4.2.6, read-only)  
**Port side:** `packages/content/pack/*.json` (committed pack the game loads)

## Result

**Empty structural diff.** Independent re-parse of every compiled source matches the committed pack field-by-field and index-by-index.

| Check | Outcome |
|-------|---------|
| 44 pack files vs re-parse | **0 differences** |
| Flag / spell list tokenization (`strtok` on `" \|"`) | **identical** |
| Monster `base:` → `monster_base` name resolution | **all resolve** |
| Object `type:` → `object_base` tval (+ C `none` / TV_NONE) | **all resolve** |
| Allow-list entries needed | **none** |

Verification command (chunked, hard timeout as required):

```text
pnpm vitest run packages/content/src/data-exactness.test.ts --testTimeout=20000
```

**49 tests passed** in ~0.5s.

## Coverage

### Reference sources

`reference/lib/gamedata/` contains **45** `.txt` files.

| Status | Count | Files |
|--------|------:|-------|
| Compared against pack | 44 | every stem in `gamedataSpecs` / `pack/manifest.json` |
| Deferred (not in pack) | 1 | `old_class.txt` — retired class data; `packages/content/src/specs/index.ts` deliberately omits it |
| Non-data | — | `Makefile` (build glue, not gamedata) |

### Scale of comparison

| Metric | Value |
|--------|------:|
| Files compared | 44 |
| Records compared | **3 194** |
| Leaf fields compared (pack shape) | **~56 968** |

Leaf count is the number of primitive values (plus empty containers) under each record and header after independent compile — every scalar the structural diff walks.

### Per-file coverage

| File | Records | Leaf fields | Header |
|------|--------:|------------:|:------:|
| activation | 163 | 1 672 | |
| artifact | 138 | 2 786 | |
| blow_effects | 30 | 246 | |
| blow_methods | 19 | 166 | |
| body | 1 | 25 | |
| brand | 10 | 74 | |
| chest_trap | 7 | 51 | |
| class | 9 | 3 001 | |
| constants | 1 | 226 | |
| curse | 27 | 294 | |
| dungeon_profile | 9 | 636 | |
| ego_item | 107 | 1 288 | |
| flavor | 8 | 879 | |
| hints | 99 | 99 | |
| history | 165 | 660 | |
| monster | 624 | 18 329 | |
| monster_base | 56 | 350 | |
| monster_spell | 91 | 1 229 | |
| names | 2 | 1 190 | |
| object | 375 | 6 443 | |
| object_base | 34 | 152 | yes (`default`) |
| object_property | 79 | 1 146 | |
| p_race | 11 | 301 | |
| pain | 12 | 96 | |
| pit | 40 | 311 | |
| player_property | 44 | 275 | |
| player_timed | 53 | 573 | |
| projection | 56 | 546 | |
| quest | 2 | 8 | |
| realm | 4 | 20 | |
| room_template | 415 | 7 417 | |
| shape | 9 | 123 | |
| slay | 11 | 88 | |
| store | 8 | 329 | |
| summon | 17 | 87 | |
| terrain | 25 | 243 | |
| trap | 40 | 651 | |
| ui_entry | 47 | 246 | |
| ui_entry_base | 3 | 30 | |
| ui_entry_renderer | 5 | 27 | |
| ui_knowledge | 48 | 104 | |
| vault | 161 | 3 635 | |
| visuals | 1 | 404 | |
| world | 128 | 512 | |
| **total** | **3 194** | **~56 968** | |

## Differences found

**None.**

No structural mismatch between the independent re-parse of `reference/lib/gamedata/<file>.txt` and `packages/content/pack/<file>.json`. The allow-list in the test file is empty.

## What the test does (method)

1. **Independent line parser** (`data-exactness.reader.ts`): reimplements `parser.c` line semantics (leading whitespace skip, `#` comments, `strtok(":")` fields, `str` rest-of-line, `char` single code point, `int`/`uint` via `strtol`-style scan, `rand` via `parse_random` validity with raw string kept).

2. **Independent record assembly**: record-start boundaries, `repeat` → arrays in file order, `childOf` → attach to most recent parent container (or record root when no parent instance yet — the monster_spell pre-cutoff lore idiom). Output key order is registration order.

3. **Format registration data** only comes from `gamedataSpecs` (the C `parser_reg` format strings + repeat/childOf metadata). The **engine** does not call `parseLine` / `compileGamedata` from `packages/content`.

4. **Deep diff** walks every record index and every field path; first mismatch fails the per-file test with path, reference value, and port value.

5. **Flags / list directives:** every payload that uses `|` lists is re-tokenized with C’s `strtok(s, " |")` rules and checked equal on both sides (raw string + token sequence).

6. **Base inheritance (C semantics, not pack merge):**
   - Monster `base:` must name a `monster_base` record (`lookup_monster_base`). Pack stores the reference, not the resolved glyph/flag union from `parse_monster_base` / `rf_union` — that is by design for the compile-time pack; the test proves the reference is always resolvable and that `flags-off` tokens are well-formed.
   - Object `type:` must name an `object_base` tval, or the special C tval `none` (TV_NONE) used by internal placeholders `<pile>`, `<unknown item>`, `<unknown treasure>`, `<curse object>` (`obj-tval.c`).

## What could not be compared (and why)

| Item | Why |
|------|-----|
| **Resolved runtime monster flags / glyphs after `base:` inheritance** | The committed pack deliberately stores unresolved `base:` (and optional `glyph` / `flags` / `flags-off`) rather than the post-`rf_union` C `monster_race`. Runtime load is responsible for applying base defaults the way `mon-init.c` does. Structural pack fidelity is fully compared; inheritance is checked as **resolvability**, not as flattened effective flags in the pack. |
| **Resolved object_base → kind defaults** | Same shape: pack keeps `type:` as tval name; C copies base flags into kinds at init. Not stored flattened in pack. |
| **`old_class.txt`** | Upstream retired data; not compiled into the pack (explicit deferral in `specs/index.ts`). File presence asserted; values not compared. |
| **C bitflag enum identity** (`RF_*`, `OF_*`, etc.) | Pack stores symbolic flag *names* as in the text. Mapping names → bit indices is engine work, not pack compile output. |
| **Dice / expression evaluation** | Pack (and both parsers) store raw dice/expression strings (`20d10`, `$Dd4`, expr bodies). Runtime evaluation lives in `z-dice` / `z-expression` ports — out of scope for pack structural exactness; grammar validity is enforced at parse. |
| **Index semantic use at runtime** (r_idx / k_idx as array indices into game tables) | Order of records is compared (index-by-index). Whether every consumer uses those indices identically is wiring (W2), not pack content. |

## Artifacts created

| Path | Role |
|------|------|
| `packages/content/src/data-exactness.reader.ts` | Independent re-parser |
| `packages/content/src/data-exactness.test.ts` | Vitest suite (normal package suite; run with the path above) |
| `parity/phase3-2026-07-25/findings/W5-DATA-EXACTNESS.md` | This report |

**Commit:** none (per brief).

## Conclusion

The build-time concession (no runtime parse of `lib/gamedata/*.txt` in the browser) is now guarded by a permanent, independent field-level re-parse. Presence is no longer the only check: values and indices match for all 44 compiled files (~3.2k records, ~57k leaf fields). No pack divergence to fix.
