# Parser registry validation: G11–G19

## Result

Closed the parts of G12–G14 that depend only on parser state already present
in a `class.txt` record.  `compileGamedata` now has a small per-directive
validation hook and a configurable missing-parent error.  The class spec uses
them for book/spell capacities, the parser's parent checks, and
`book-properties:` allocation parsing.  This is intentionally **not** a
runtime-registry hook: the generic content compiler has no object, option,
message, brand, or slay registry with the same construction order as C.

New regression coverage is in
`packages/content/src/records.upstream.test.ts`; it fails without the new
specification behavior.

## Re-derived handler results

| Gap | Exact upstream condition and result | Disposition |
| --- | --- | --- |
| G11 `equip:` | Missing class header is `MISSING_RECORD_HEADER`; unknown tval is `UNRECOGNISED_TVAL`; unknown sval is `UNRECOGNISED_SVAL`; an option token that is neither a birth option nor `none` is `INVALID_OPTION`; min or max above 99 is `INVALID_ITEM_NUMBER`. [reference/src/init.c:3599-3656](../../../../reference/src/init.c#L3599-L3656) | Deferred: tval/sval and birth-option type are runtime registries. The numeric bound is inseparable from accepting the same directive and does not justify a partial, wrong-order check. |
| G12 class nesting | `book:` without allocated magic-book capacity is `TOO_MANY_ENTRIES`; `book-graphics:` and `book-properties:` with no book are `MISSING_RECORD_HEADER`; `spell:` without a book or beyond its declared spell count is `TOO_MANY_ENTRIES`. [reference/src/init.c:3732-3746](../../../../reference/src/init.c#L3732-L3746) [reference/src/init.c:3768-3815](../../../../reference/src/init.c#L3768-L3815) [reference/src/init.c:3834-3854](../../../../reference/src/init.c#L3834-L3854) | Closed. `effect:` and `desc:` require a spell and return `MISSING_RECORD_HEADER`. [reference/src/init.c:3871-3892](../../../../reference/src/init.c#L3871-L3892) The lead was wrong for `effect-yx:`, `dice:`, `expr:`, and `effect-msg:` with no effect: after a valid spell, C explicitly treats a missing effect/dice as `PARSE_ERROR_NONE`, so no rejection was added. [reference/src/init.c:3908-3939](../../../../reference/src/init.c#L3908-L3939) |
| G13 `book-properties:` range | C calls `grab_int_range(..., "to")` and returns `INVALID_ALLOCATION` on any failure. [reference/src/init.c:3799-3831](../../../../reference/src/init.c#L3799-L3831) `grab_int_range` requires the separator and rejects `INT_MIN`/`INT_MAX` endpoints to detect conversion overflow. [reference/src/datafile.c:323-372](../../../../reference/src/datafile.c#L323-L372) | Closed. The generic spec validates this exact integer-range form before records are emitted. |
| G14 book tval/capacity | C resolves a book tval before checking the capacity, so an unknown tval is `UNRECOGNISED_TVAL` and does not consume a book slot; valid excess books are `TOO_MANY_ENTRIES`. [reference/src/init.c:3735-3765](../../../../reference/src/init.c#L3735-L3765) Excess spells are likewise `TOO_MANY_ENTRIES`. [reference/src/init.c:3842-3868](../../../../reference/src/init.c#L3842-L3868) | Closed structural capacities; deferred the tval lookup because no object-tval registry is available to the compiler. This preserves C's lookup-before-capacity ordering rather than inventing a partial ordering. |
| G15 `msgt:` | After confirming a timed record exists, C sets the value from `message_lookup_by_name()` and returns `INVALID_MESSAGE` on a negative lookup. [reference/src/player-timed.c:167-179](../../../../reference/src/player-timed.c#L167-L179) | Deferred: the message-name table is not a content compiler registry. |
| G16 `fail:` | C requires a timed record, accepts only its five failure-code cases, resolves each flag against the corresponding object/player/element/timed table, and returns `INVALID_FLAG` for an unknown flag or other code. [reference/src/player-timed.c:181-244](../../../../reference/src/player-timed.c#L181-L244) | Deferred: all four lookup tables are runtime registries. |
| G17 timed `brand:` / `slay:` | C requires a timed record, scans registered brands/slays from index 1, and returns `UNRECOGNISED_BRAND` or `UNRECOGNISED_SLAY` on a miss. [reference/src/player-timed.c:361-404](../../../../reference/src/player-timed.c#L361-L404) | Deferred: brand/slay tables do not exist at generic compilation time. |
| G18 monster `plural:` | With a monster record, C assigns a string only when the optional value is nonempty; an empty present field sets `plural` to NULL. [reference/src/mon-init.c:1673-1689](../../../../reference/src/mon-init.c#L1673-L1689) | Already closed before this item: `packages/core/src/mon/bind.ts` normalizes only nonempty strings. No change made. |
| G19 monster drops/mimics | `drop:` validates tval, sval, min/max <= 99, then returns `UNRECOGNISED_SVAL` if the exact kind is absent. [reference/src/mon-init.c:1507-1536](../../../../reference/src/mon-init.c#L1507-L1536) `drop-base:` validates only tval and min/max <= 99. [reference/src/mon-init.c:1539-1560](../../../../reference/src/mon-init.c#L1539-L1560) `mimic:` validates tval/sval then returns `NO_KIND_FOUND` for a missing exact kind; it has no min/max fields. [reference/src/mon-init.c:1632-1654](../../../../reference/src/mon-init.c#L1632-L1654) | Deferred: this is three distinct object-registry paths. The lead incorrectly assigned item-count validation to `mimic:` and omitted its `NO_KIND_FOUND` result. |

## Decision required for the remaining registry gaps

Option A is to keep the content compiler structural and validate each value at
the existing object/player/session resolution seam.  That does not reproduce
the C load-time error boundary.  Option B is to add an explicit, ordered
registry-validation environment to `compileGamedata`, populated by a new
compiler bootstrap that builds the C-equivalent tval/sval, option, message,
brand, slay, and object-kind registries before parsing dependent files.  The
compiler must also preserve each handler's lookup order (for example, class
book tval before capacity), documented above.

Recommendation: choose Option B only as a dedicated compiler-architecture
task covering G11, G14's tval half, G15–G17, and G19 together.  Supplying one
ad-hoc table or validating after binding would produce a different parse
phase/error ordering from the handlers cited above.

## Verification

- `pnpm install --frozen-lockfile` — passed.
- `pnpm -r build` — passed.
- Focused `packages/content/src/records.upstream.test.ts` — passed.
- `npx vitest run --exclude "**/borg/**"` did not complete within the
  command runner's 124.6-second limit: `Exit code: 124`, output reached only
  `RUN v3.2.7 C:/Repositories/na-wt-parserreg`.  No suite-success claim is
  made.
