# W3-UNIT-TESTS — batch zlib-msg

Batch directories: `z-dice`, `z-expression`, `z-util`, `z-quark`, `z-queue`,
`z-textblock`, `z-virt`, `z-file`, `trivial`, `message`.

Originally written on branch `p3/ut-zlib` (`0d05649f0`, worktree
`C:\Repositories\na-wt-trap`). **SALVAGED onto `p4/ut-salvage`**: the four test
files and this findings entry landed; the same commit's `packages/cli/src/stats.ts`,
`scenarios.ts`, `baseline/stats-baseline.json`, `parity-c.test.ts` and
`packages/core/scripts/codegen-lists.mjs` edits were DROPPED — they reverted
merged master work (the `perLevelSd` / `monsterTotalSq` / `goldSq` parity-gate
API, the re-pinned baselines, `kill_all_monsters` unique retirement and the
`codegen-lists --check` drift guard). Dropping `stats.ts` is what keeps
`tsc -b` clean: `packages/cli/src/parity-c-stat.test.ts` on master imports
`perLevelSd`, so merging that commit as-is fails with TS2305.

Reference: read-only `reference/src/tests/…`.

## Summary table

| Upstream C file | Verdict | Port test path | `it()`s | Pass | Fail |
|---|---|---|---:|---:|---:|
| `z-dice/dice.c` | PORTED | `packages/core/src/dice.upstream.test.ts` | 4 | 4 | 0 |
| `z-expression/expression.c` | PORTED | `packages/core/src/expression.upstream.test.ts` | 4 | 4 | 0 |
| `z-util/guard.c` | PORTED | `packages/core/src/guard.upstream.test.ts` | 4 | 4 | 0 |
| `z-util/util.c` | N/A | — | 0 | — | — |
| `z-util/meanvar.c` | BLOCKED | — | 0 | — | — |
| `z-util/rational.c` | BLOCKED | — | 0 | — | — |
| `z-quark/quark.c` | N/A | — | 0 | — | — |
| `z-queue/qp.c` | N/A | — | 0 | — | — |
| `z-textblock/textblock.c` | ~~N/A~~ **CORRECTED: BLOCKED** | — | 0 | — | — |
| `z-virt/mem.c` | N/A | — | 0 | — | — |
| `z-virt/string.c` | N/A | — | 0 | — | — |
| `z-file/filename-index.c` | N/A | — | 0 | — | — |
| `z-file/path-normalize.c` | N/A | — | 0 | — | — |
| `trivial/trivial.c` | N/A | — | 0 | — | — |
| `message/message.c` | PORTED | `packages/core/src/msg.upstream.test.ts` | 12 | 10 + 2 `it.fails` | 0 |

**Totals as landed:** 24 `it()`s across 4 files, of which 2 are `it.fails`
pins for UT-001 and UT-002 (below).

```text
npx vitest run packages/core/src/dice.upstream.test.ts \
  packages/core/src/expression.upstream.test.ts \
  packages/core/src/guard.upstream.test.ts \
  packages/core/src/msg.upstream.test.ts --testTimeout=30000
# Test Files  4 passed (4)
# Tests       24 passed (24)
```

The original entry claimed `pnpm typecheck` clean; **that claim was false** on
`p3/ut-zlib` — the `stats.ts` edit removed the `perLevelSd` export that
`packages/cli/src/parity-c-stat.test.ts` imports, so `tsc -b` failed with
TS2305. Verified clean only after dropping that edit:

```text
pnpm build   # tsc -b
# exit 0
```

### How UT-001 / UT-002 landed without weakening the assertion

Neither is fixed here (production code untouched). Both upstream assertions are
kept verbatim, moved into their own `it.fails()` case, with the C citation and
the finding ID in the test:

- `packages/core/src/msg.upstream.test.ts`
  `it.fails("lookup:  by printed number, the C strtoul path [UT-001]")`
- `packages/core/src/msg.upstream.test.ts`
  `it.fails("bell:  EVENT_BELL carries a NULL message [UT-002]")`

`it.fails` was chosen over `skip`/`todo` because it is an active ratchet:
vitest reports an `it.fails` case that starts PASSING as a failure, so the day
the port is fixed the suite says so and the marker gets promoted back to a
plain `it()`. No existing repo convention was found for this (grep over
`packages/**/*.test.ts` for `it.fails` / `it.skip` / `it.todo` found only
`describe.skipIf(!cbase)` for the missing-C-baseline gates), so this is the
convention this batch establishes.

One side effect worth recording: the surviving green `lookup` case still
asserts `messageLookupByName(String(MSG_MAX)) === -1` and
`… (MSG_MAX + 1) === -1`, which pass **vacuously** in the port — it rejects
every numeral, not only the out-of-range ones. Those two assertions only become
meaningful once UT-001 is fixed. Noted in the test.

### N/A reasons (one line each)

| File | Reason |
|---|---|
| `z-util/util.c` | C buffer UTF-8 clip/skip, utf32 conversion, `hex_str_to_int`, `strunescape` — no JS counterpart (strings are immutable UTF-16). |
| `z-quark/quark.c` | String interning (`quark_add` / `quark_str`); port stores notes as plain `string \| null`. |
| `z-queue/qp.c` | Priority heap (`qp_*`) has no shared port API (only unrelated command FIFO / private flood-fill queues). |
| `z-textblock/textblock.c` | **This N/A is WRONG and is retracted.** The port does have a textblock analogue: `LoreTextBuilder` (`packages/core/src/mon/lore-describe.ts:81-95`) maps `textblock_append` / `textblock_append_c` onto coloured runs. It is a reduction (no `textblock_calculate_lines` / `textblock_to_file` / wrap logic), so the correct verdict is BLOCKED-partial, not N/A. Porting `reference/src/tests/z-textblock/textblock.c` is left OPEN; it is out of scope for this salvage. |
| `z-virt/mem.c` | Manual `mem_alloc` / `mem_realloc` / `mem_free` — GC / JS runtime. |
| `z-virt/string.c` | Explicit `string_make` / `string_append` ownership — GC / JS strings. |
| `z-file/filename-index.c` | POSIX/Windows path filename index — no port path module. |
| `z-file/path-normalize.c` | POSIX/Windows `path_normalize` (cwd, home, UNC) — browser/Node paths not ported as C API. |
| `trivial/trivial.c` | C unit-test harness smoke (`ok` / `require`); not game behaviour. |

### Message suite notes

- **format** (`test_msg`): C `msg()` printf formatting is intentionally not
  ported (callers use template strings). The `it("format")` feeds the
  already-formatted expected strings into `Messages.msg()` and asserts the
  same log + EVENT_MESSAGE counters.
- **sound_lookup** (`test_sound_lookup`): not written as an `it()` —
  `message_sound_name` / `message_lookup_by_sound_name` are not ported as
  functions (table data only in `MESSAGE_ENTRIES`). Recorded BLOCKED below.

---

## FAILING / BLOCKED detail

### UT-001  lookup (numeric name path)
ref:      reference/src/tests/message/message.c:521-526 (and message.c:304-309)
port:     packages/core/src/msg.upstream.test.ts:464 (`it.fails`); packages/core/src/sound/engine.ts:36-41
expected: `message_lookup_by_name("0")` … `"152"` return the integer index; C uses `strtoul` when the name parses as a number `< MSG_MAX`
actual:   `messageLookupByName(String(i))` returns `-1` for every decimal numeral (name table walk only; no numeric path)
why:      Port `messageLookupByName` compares against `MESSAGE_ENTRIES[i].name` only. Upstream also accepts a decimal string form of the MSG_ index.
severity: P2
status:   OPEN, pinned by `it.fails`. Dormant in the live port: `messageLookupByName` has no non-test caller (the C calls it from init.c:738/801/858/921, mon-init.c:164/606, mon-summon.c:79, obj-init.c:351, player-timed.c:176 while parsing `msgt:` directives; the port's content build resolves those elsewhere).

### UT-002  bell (EVENT_BELL null message)
ref:      reference/src/tests/message/message.c:443; reference/src/message.c:380-383
port:     packages/core/src/msg.upstream.test.ts:375 (`it.fails`); packages/core/src/msg.ts:140-142
expected: after `bell()`, event payload message pointer is NULL → test `lastbell == NULL`
actual:   port emits `{ msg: "", type: MSG_BELL }`; handler records `""`
why:      C `event_signal_message(EVENT_BELL, MSG_BELL, NULL)` vs TS `MessageEventData.msg: string` always materialised as empty string. Log side-effects (no message added) match; optional-message nullability does not.
severity: P3
status:   OPEN, pinned by `it.fails`. `Messages.sound()` (msg.ts:134-137) has the same `msg: ""`-for-NULL shape, so a fix should make `MessageEventData.msg` nullable for both EVENT_BELL and EVENT_SOUND.

### UT-003  sound_lookup
ref:      reference/src/tests/message/message.c:547-578; reference/src/message.c:325-361
port:     NONE (table: packages/core/src/generated/message.ts MESSAGE_ENTRIES)
expected: `message_sound_name(i)` returns list-message sound string (NULL out of range); `message_lookup_by_sound_name` reverse-maps (unknown → MSG_GENERIC); name pairs are self-consistent
actual:   no `messageSoundName` / `messageLookupBySoundName` exports; only the generated name/sound table exists
why:      Ledger note on msg.ts deferred these to the pref/sound loader; reverse-lookup helpers were never added. Inventing a test-only wrapper would not exercise a real API.
severity: P2

### UT-004  meanvar suite
ref:      reference/src/tests/z-util/meanvar.c (mean trivial/simple/overflow; variance trivial/simple/overflow)
port:     packages/core/src/obj/randart-data.ts:235-258 (private simplified mean/variance only)
expected: full `mean(a, n, frac*)` and `variance(a, n, unbiased, of_mean, frac*)` with rational fractional parts and INT_MIN/INT_MAX overflow cases from the C tests
actual:   private floor-only helpers for randart stats; not exported; no frac out-parameter or unbiased/of_mean flags
why:      Behaviour needed for randart/power paths exists only as a reduced private form; the public z-util API the unit tests target is missing.
severity: P2

### UT-005  rational suite
ref:      reference/src/tests/z-util/rational.c (construct, to_uint, product, sum)
port:     packages/core/src/obj/object-info.ts:680-726 (private ratConstruct/ratToUint/ratProduct/ratSum)
expected: exported `my_rational_construct` / `my_rational_to_uint` / `my_rational_product` / `my_rational_sum` matching all C cases including UINT_MAX overflow rails
actual:   private helpers scoped to O-combat object-info; not exported; UINT_MAX multiprecision paths intentionally omitted
why:      Same arithmetic family is used, but there is no shared z-util rational module to host the upstream unit suite.
severity: P2

### UT-006  lookup by name is case-SENSITIVE (NEW — found during the salvage, not fixed)
ref:      reference/src/message.c:306-308 — `if (my_stricmp(name, message_names[i]) == 0) return (int)i;`
port:     packages/core/src/sound/engine.ts:38 — `if (MESSAGE_ENTRIES[i]!.name === name) return i;`
expected: `message_lookup_by_name("generic")` / `"Generic"` return `MSG_GENERIC`; upstream compares case-INsensitively
actual:   `messageLookupByName("generic")` returns `-1`; only the exact upper-case table spelling matches
why:      `my_stricmp` was ported as `===`. Not covered by the upstream unit test (it only probes the canonical spellings), so no ported test catches it — recorded here instead of adding a non-upstream test.
severity: P3 while dormant (same no-live-caller situation as UT-001); becomes P2 the moment a `.prf` / gamedata `msgt:` reader is wired, because upstream's data files are parsed case-insensitively.
