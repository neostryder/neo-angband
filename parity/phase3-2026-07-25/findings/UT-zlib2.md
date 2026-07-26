# UT-zlib2 — the 47 uncited non-parse upstream cases

Batch: every uncited case outside `parse/` in `reports/ut-ledger.tsv` as of
`30ea7b47d`. 13 files, 47 cases, all 47 adjudicated individually.

**This was a REDO.** An earlier pass had dismissed z-textblock, z-queue and
z-util as "N/A" at FILE granularity with no per-case reasoning. Verdict on that
call, per file:

| file | old blanket call | correct call | why |
| --- | --- | --- | --- |
| `z-util` | N/A | **WRONG** | 10 of the 11 cases port exactly. `mean`, `variance` and the four `my_rational_*` helpers are live game arithmetic (obj-info damage readouts, randart power baselines, pathfinder penalties). They are now a real module, `packages/core/src/rational.ts`, with all 10 cases asserted. Only `z-util/util.c`'s 5 UTF-8/nds cases are genuinely N/A. |
| `z-textblock` | N/A | **WRONG** | All 4 cases port. The port already had a run-based textblock; it was private and untested, and it was missing `textblock_append_textblock` and `textblock_attrs` entirely. |
| `z-queue` | N/A | **right, but for the wrong reason** | The 6 `qp_*` cases are N/A — but not because a priority queue is C plumbing. It is because the port never ported `find_path`'s A*, which is GAP-1 below. The old call reached the right label while hiding a real gap. |

Ledger effect: uncited 530 → 483 (the remainder is all `parse/`, another lane).

---

## Per-case verdicts

Counts: **PORTED-NEW 16**, **PORTED-EXISTING 2**, **N/A 28**, **GAP 1**.

### z-util/rational.c (4) + z-util/meanvar.c (6) — all PORTED-NEW

New: `packages/core/src/rational.ts`, `packages/core/src/rational.upstream.test.ts`.

| case | verdict | evidence |
| --- | --- | --- |
| `test_rational_construct` | PORTED-NEW | `myRationalConstruct` (z-util.c L1694) |
| `test_rational_to_uint` | PORTED-NEW | `myRationalToUint` (L1722), incl. all four `UINT_MAX` saturation exits and the multiprecision remainder branch at L1751 |
| `test_rational_product` | PORTED-NEW | `myRationalProduct` (L1823), incl. the approximating overflow path L1834-L1911 |
| `test_rational_sum` | PORTED-NEW | `myRationalSum` (L1923), incl. the approximating path L1936-L2031 |
| `test_mean_trivial` | PORTED-NEW | `mean` (L1389), `size <= 0` exit |
| `test_mean_simple` | PORTED-NEW | `mean`, both rounding rules (nearest vs floor+fraction) |
| `test_mean_overflow` | PORTED-NEW | `mean` with `INT_MIN`/`INT_MAX` arrays |
| `test_variance_trivial` | PORTED-NEW | `variance` (L1516), `size <= 1` exit, all 4 flag combinations |
| `test_variance_simple` | PORTED-NEW | `variance`, all 7 upstream rows × 4 flag combinations × both rounding rules |
| `test_variance_overflow` | PORTED-NEW | `variance`, incl. the `INT_MAX` saturation with zeroed fraction |

Why these are not plumbing: `my_rational_*` is read by obj-info.c L435/L563/L725/
L1271-L1488 (the crit and damage-per-blow numbers printed on the inspect screen),
by player-path.c L135/L195/L269 (pathfinder terrain penalties), and
`mean`/`variance` by obj-randart.c L278-L282 (`store_base_power`'s power
baselines). The port previously had a **private, partial** copy in
`obj/object-info.ts` (native arithmetic only, no saturation) and a **second,
different** partial copy in `obj/randart-data.ts` (`Math.floor(sum/n)` and a
closed-form variance). Three implementations of the same C functions, none
tested, none saturating. Now one, tested, saturating.

Two sub-behaviours are recorded N/A **within** otherwise-ported cases, both
documented in `rational.ts`: the 16-bit-limb multiprecision library itself
(`ini_u16n`/`mul_u16n`/`div_u16n`, z-util.c L1000-L1380) is replaced by BigInt,
and the C's `unsigned int` wraparound is not reproducible in JS. Every VALUE the
C returns, including its approximations and saturations, is.

### z-textblock/textblock.c (4) — all PORTED-NEW

New: `packages/core/src/obj/textblock.upstream.test.ts`. Production: `tbNew` /
`tbAppend` / `tbAppendC` exported (visibility only), plus `tbAppendTextblock`
(z-textblock.c L153) and `textblockAttrs` (L201) added.

| case | verdict | evidence |
| --- | --- | --- |
| `test_append` | PORTED-NEW | successive appends concatenate; empty textblock is `""` |
| `test_colour` | PORTED-NEW | `textblockAttrs` — the colour covers EVERY character of the run, as the C's `memset` at L132 does |
| `test_length` | PORTED-NEW | 32 × 7 chars, each window checked |
| `test_append_textblock` | PORTED-NEW | merge concatenates text AND attrs and leaves the SOURCE intact |

Correction to the brief: this file is **not** the wrapping engine. It exercises
only the accumulator. The wrapping rule
(`textblock_calculate_lines`, z-textblock.c L237, and `ui-output.c`) is not
touched by this upstream suite and remains uncovered — out of scope here.

`textblock_append`'s variadic formatting is not ported (the port's callers
interpolate before appending); what the case is actually about, concatenation
order, is.

### monster/monster.c (2)

| case | verdict | evidence |
| --- | --- | --- |
| `test_match_monster_bases` | **N/A** | `match_monster_bases` is DEAD UPSTREAM: mon-util.c:166's own comment says "This function is currently unused, except in a test... -NRM-", and the only references in all of `reference/src` are that definition, the prototype at mon-util.h:29, and the test. No production caller in 4.2.6, so omitting it cannot change reachable behaviour. Cross-confirmed by a W1-side lane independently. The existing assertions are kept as a **data** check on the shipped `monster_base` assignments. |
| `test_nearby_kin` | PORTED-EXISTING | `chooseNearbyInjuredKin` / `findAnyNearbyInjuredKin` (`game/mon-ranged.ts`) vs mon-util.c:907/885, which DO have live callers (effect-handler-attack.c:324 for MON_HEAL_KIN, mon-attack.c:169 gating the cast). The port test already mirrored the C assertion-for-assertion, including the LOS-blocked case and the 1000-draw distribution check; it was uncited only because its title lacked the `test_` prefix. |

Both were **strengthened** while citing them: the race lookups were fuzzy
(`.includes("scruffy")`, `/warg/i`, with `?? base === "canine"` fallbacks) and
could silently have tested a different monster. They now use `races[3]` and exact
names, exactly as the C's `&r_info[3]` and `t_add_monster(c, g, "wolf")` do. Both
still pass, which confirms the port's race array is index-aligned with `r_info`.

Correction to the brief: these two were called "the most likely real GAPs in your
batch". Neither is a gap — one is dead upstream, the other was already fully
ported.

### message/message.c (1)

| case | verdict | evidence |
| --- | --- | --- |
| `test_sound_lookup` | PORTED-NEW | `messageSoundName` / `messageLookupBySoundName` added to `sound/engine.ts` from message.c L349-361 / L325-341; asserted in `msg.upstream.test.ts` |

This case was previously recorded **BLOCKED**: the port shipped the table
(`MESSAGE_ENTRIES[i].sound`, generated from `list-message.h`) but neither
accessor. Both are declared public API at message.h L56-57 and, like
`match_monster_bases`, have no caller in `reference/src` outside the test — but
unlike it they read a table the port genuinely ships and uses for `sound.prf`, so
they were ported rather than written off. Three warts pinned: the compare is
`my_stricmp` (case-insensitive), MSG_MAX is excluded from the scan, and a MISS
returns `MSG_GENERIC` — not `-1` as the sibling `message_lookup_by_name` does —
so a caller cannot distinguish a miss from a real hit on MSG_GENERIC. The mapping
is also not one-to-one: MSG_GENERIC and MSG_BIRTH share the empty sound name and
the lower index always wins.

### z-queue/qp.c (6) — all N/A, and see GAP-1

Recorded per case at `game/player-path.ts` above `findPath`, where the reason
lives. Summary: `test_qp_trivial` and `test_qp_flush` are capacity-vs-occupancy
and free-callback element ownership; `test_qp_pushpop` is the
`qp_pushpop_int` fusion; `test_qp_resize` is manual reallocation plus the
`qp_isinvalid` heap-invariant debug check; the int-vs-`void*` payload split
across all six is a tagged union TS does not have. `test_qp_integer` and
`test_qp_pointer` assert the one genuinely behavioural property — pop order
equals a qsort by priority — and that is unreachable here only because of GAP-1,
not because it does not matter.

### z-file/path-normalize.c (7), z-file/filename-index.c (2) — all N/A

POSIX/Win32 filesystem-path semantics, compiled per-platform with entirely
different `#ifdef WINDOWS` / `UNIX` expectation tables, against `getcwd()` /
`GetCurrentDirectory()` / `getpwuid()`, plus the C caller-supplies-the-buffer
protocol (return 1 when too small, required size in an out-parameter, guard bytes
either side). The port runs in a browser and owns no filesystem. **Checked as the
brief asked:** no package's `src` implements path joining or normalisation; the
only path handling in the repo is node's own `path.join` in build/test tooling
(`content/src/compile.ts`, `data-exactness.test.ts`), which is not a port of
`path_normalize` and cannot inherit the bugs these cases pin. Per-case reasons in
`guard.upstream.test.ts`.

### z-virt/string.c (7), z-virt/mem.c (1), z-quark/quark.c (1), trivial/trivial.c (1) — all N/A

`string_make`/`string_append`/`string_free` are malloc-and-strcpy,
realloc-and-strcat, and free; all seven cases are about the NULL-pointer protocol
that exists only because the values are pointers (including
`test_string_append_null2`, where `append(NULL, NULL)` is NULL and not `""` — two
pointer states a TS `string` does not have). `test_realloc` is manual memory
management outright. `test_dedup` asserts POINTER equality from the
string-interning table (`quark_str(q1) == quark_str(q2)`), which exists so the C
can hold and save inscriptions as small integers; the port stores inscriptions as
plain JS strings (`obj/desc.ts` `obj_desc_inscrip`, `obj/ignore.ts`
`checkForInscrip`) where value equality is the only equality. `test_require` is
`require(1)`, a self-test of the C harness. Per-case reasons in
`guard.upstream.test.ts`.

### z-util/util.c (5) — all N/A

Correction to the brief, which described this file as `my_stristr`, `my_strcpy`
and `my_strcat` truncation semantics. It is none of those: it is
`utf8_clipto`/`utf8_fskip`/`utf8_rskip`/`utf32_to_utf8`/`hex_str_to_int`/
`strunescape`. (`my_stristr` is already covered in `guard.upstream.test.ts`;
`my_strcpy`/`my_strcat` have no upstream unit test at all.)

`utf8_fskip`/`utf8_rskip`/`utf32_to_utf8` are UTF-8 byte-buffer cursor arithmetic
and UTF-32→UTF-8 encoding; the port's strings are JS strings and its front end
receives a `KeyboardEvent` whose `key` is already a string. **One positive
finding inside this N/A:** `utf8_fskip`'s single non-UI caller is parser.c L279,
where a `char:` field must consume exactly one CHARACTER and anything but `:` or
end-of-line after it is `PARSE_ERROR_FIELD_TOO_LONG`. That behaviour **is**
ported and **is** correct — `packages/content/src/parser.ts` `takeChar` uses
`codePointAt`/`fromCodePoint` and raises `FIELD_TOO_LONG` in the same place.

`hex_str_to_int`'s only caller in the whole tree is z-util.c L764, inside
`strunescape`; `strunescape`'s only callers are `src/nds/nds-buttons.c:165` and
`src/nds/nds-screenkeys.c:77`, the Nintendo DS front end's config parser. The
port has no NDS front end and does no runtime `.prf` unescaping (sound and colour
preferences ship pre-parsed). Both unreachable.

---

## GAP-1 — find_path substitutes a different upstream algorithm

- **ref**: `find_path` (player-path.c L1069) runs **A\*** with a Chebyshev
  heuristic over a binary-heap priority queue (`qp_new` / `qp_push_int` /
  `qp_pushpop_int` / `qp_pop_int`, z-queue.c) and a lazily-initialised patched
  distance array. `do_cmd_pathfind` (cmd-cave.c L1563) calls it.
- **port**: `findPath` (`game/player-path.ts` L553) instead composes upstream's
  OTHER pair — `prepare_pfdistances` (L307, a plain FIFO relaxation over `q_*`)
  and `pfdistances_to_path` (L506, a backtrack over the finished field). Both
  halves are themselves faithful ports; the substitution is at the top.
- **what differs**: both return a MINIMUM-cost path (the heuristic is admissible
  because every step costs at least `PF_SCL`), so the turncount and destination
  always agree. When several paths TIE on cost, the step sequence can differ —
  upstream says so itself at L1063-L1067: "the path returned by find_path() may
  be different than that returned by pfdistances_to_path()".
- **effect**: travelling to a clicked destination can walk a different, equally
  long route than the reference build would. Visible as the character's path
  across the level; not a cost, turn-count or reachability difference.
- **severity**: **P2** — equal-cost tie-breaking on a secondary behaviour, no
  wrong outcome in normal play.
- **fixed**: **no**. Closing it means porting the A*, the patched-distance array
  (`initialize_patch` / `set_patched_distance` / `patched_distances_to_path`,
  L604-L833) and a priority queue with matching sift order — a restructure, not
  an edit, which the brief says to report and leave. Recorded at the `findPath`
  doc comment. Not demonstrated against a C oracle: no reference build is
  available in this worktree, so this rests on upstream's own documented
  statement that the two routines disagree, plus the fact that the port has no
  priority queue at all.

One adjacent observation, **not** claimed as a GAP of this batch: the port's
`effect-info.ts` returns a plain string from `describeEffect`, so the
`textblock_append_textblock` site at obj-info.c L2135 becomes a string concat and
upstream's digit-colouring is lost. That is a pre-existing, deliberately
documented reduction in `effect-info.ts` ("Divergences by design"), and it is why
`tbAppendTextblock` currently has no production caller. Under the exact-parity
mandate it should be revisited, but it belongs to the effects/display lane.

---

## Mutation table

Applied against `packages/core`, one at a time, reverted after each. "new" =
tests added by this batch; "pre-existing" = the suite before it.
Baseline: all 8 target files green.

| # | mutation | caught by new | caught by pre-existing |
| --- | --- | --- | --- |
| M1 | `mean`: drop the negative-magnitude floor/complement (frac path) | `rational.upstream` | NO |
| M2 | `variance`: drop the `sum^2/size` CEILING adjustment (z-util.c L1591) | `rational.upstream` | NO |
| M3 | `variance`: drop the `INT_MAX` saturation | `rational.upstream` | NO |
| M4 | `my_rational_to_uint`: drop the first `UINT_MAX` saturation | NO — **equivalent mutant** | NO |
| M5 | `approximate()`: drop the round-to-nearest step | `rational.upstream` | NO |
| M6 | `my_rational_construct`: skip the gcd reduction | `rational.upstream` | NO |
| M7 | `message_lookup_by_sound_name`: miss returns `-1` not `MSG_GENERIC` | `msg.upstream` (`test_sound_lookup`, new block) | NO |
| M8 | `message_sound_name`: `> MSG.MAX` instead of `>= MSG.MAX` | NO — **equivalent mutant** | NO |
| M9 | `tbAppendTextblock`: alias the source's runs instead of copying | `textblock.upstream` (after strengthening) | NO |
| M10 | `textblockAttrs`: one attr per RUN instead of per character | `textblock.upstream` | NO |
| M11 | `ratToUint` adapter: drop the remainder wiring | NO | **NO — real coverage hole** |

Notes on the four that were not caught:

- **M4 is genuinely equivalent in JS.** The C's first guard exists to stop
  `result *= scale` from wrapping an `unsigned int`; with no wraparound, anything
  above `UINT32_MAX` is caught by the very next guard. The guard is kept for
  fidelity to L1734, not because a test can distinguish it.
- **M8 is genuinely equivalent** because the generated table carries the
  `MSG_MAX` sentinel with `sound: null`, exactly as `list-message.h` does, so
  index `MSG_MAX` returns null either way and `MSG_MAX + 1` still trips `>`.
- **M9 was initially uncaught** — the first version of the test only checked that
  appending to the destination did not grow the source, which aliasing survives.
  Strengthened to mutate a destination run in place and assert the source is
  untouched; now caught. Recorded because the weak version is the kind of test
  that would have passed a broken port.
- **M11 is a real coverage hole, and it is pre-existing.** No obj-info test
  asserts a FRACTIONAL crit-dice value, so the remainder that
  `oCalcCrits` feeds into `fracDice` is unobserved. The old private `ratToUint`
  had the same hole. `myRationalToUint`'s remainder is thoroughly covered by
  `test_rational_to_uint`; what is untested is the 3-line adapter and the
  O-combat crit readout downstream of it. Needs a real O-combat item fixture,
  which belongs to the obj-info lane.

---

## Production changes: kept / reverted

All kept; each defended against a specific reference line and backed by a test
with a mutation proof.

| change | reference | test | mutation |
| --- | --- | --- | --- |
| NEW `core/src/rational.ts` | z-util.c L1389, L1516, L1679, L1694, L1722, L1823, L1923 | `rational.upstream.test.ts`, 10 cases | M1-M6 |
| `obj/object-info.ts`: private rational copy → shared module | same | 308 pre-existing `src/obj` tests unchanged and green | M11 (hole noted) |
| `obj/object-info.ts`: `tbNew`/`tbAppend`/`tbAppendC` exported | z-textblock.c L57/L166/L179 | `textblock.upstream.test.ts` | visibility only, no behaviour |
| `obj/object-info.ts`: NEW `tbAppendTextblock`, `textblockAttrs` | z-textblock.c L153, L201 | `textblock.upstream.test.ts` | M9, M10 |
| `obj/randart-data.ts`: private `mean`/`variance` → shared module | obj-randart.c L278-L282 calling z-util.c L1389/L1516 with a non-NULL frac | `randart.test.ts` (22) green; `rational.upstream.test.ts` | M1-M3 |
| `sound/engine.ts`: NEW `messageSoundName`, `messageLookupBySoundName` | message.h L56-57, message.c L325-341, L349-361 | `msg.upstream.test.ts` `test_sound_lookup` | M7, M8 |

`tbAppendTextblock`, `textblockAttrs`, `messageSoundName` and
`messageLookupBySoundName` are **NOT-WIRED**: faithful ports of declared upstream
API with no port caller yet (upstream has no caller for the two message ones
either). Flagged rather than hidden.

---

## Counts

- 47 cases in batch, 47 adjudicated: 16 PORTED-NEW, 2 PORTED-EXISTING, 28 N/A, 1 GAP.
- Ledger: uncited 530 → 483; all 47 now cite.
- New test files 2 (`rational.upstream.test.ts` 10 cases,
  `obj/textblock.upstream.test.ts` 5); modified test files 3
  (`msg.upstream.test.ts`, `game/monster.upstream.test.ts`,
  `guard.upstream.test.ts`).
- `pnpm build` clean. `packages/core`: **224 files / 2973 tests, all passing**.
- 11 mutations applied: 7 caught by new tests, 2 equivalent mutants, 1 caught
  only after strengthening the test, 1 uncaught and reported as a pre-existing
  coverage hole.
- Brief corrections: 3 (z-util/util.c contents, z-textblock scope,
  monster/monster.c "most likely GAPs").
