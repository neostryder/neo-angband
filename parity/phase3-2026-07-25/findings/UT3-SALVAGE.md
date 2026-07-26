# UT3 salvage audit

Audited against current `master` (`827adf23f6e64257badc8ed08303cf0e8c4c16a3`) on 2026-07-26.
The three stale commits are reachable and were inspected directly with
`git show <commit>:<path>`.  No stale test file was applied: every upstream
suite has since landed on master in an equal-or-broader form.  Consequently
there are no new candidate findings, no `.todo` tests, and no port fixes or C
line-number fix claims in this salvage.

## Already covered

### `d483d0131` (`p3/ut-player`)

| Stale source | Already covered by current master |
| --- | --- |
| `game/calc-inventory.upstream.test.ts` | `game/calc-inventory.upstream.test.ts` (broader) |
| `game/combine-pack.upstream.test.ts` | `game/combine-pack.upstream.test.ts` (updated) |
| `game/digging.upstream.test.ts` | `game/digging.upstream.test.ts` (broader) |
| `game/inven-carry-num.upstream.test.ts` | `game/inven-carry-num.upstream.test.ts` (broader) |
| `game/inven-wield.upstream.test.ts` | `game/inven-wield.upstream.test.ts` (broader) |
| `game/pathfind.upstream.test.ts` | `game/pathfind.upstream.test.ts` (identical) |
| `game/util.upstream.test.ts` | `game/player-util.upstream.test.ts` (renamed; equivalent) |
| `player/birth.upstream.test.ts` | `player/birth.upstream.test.ts` (identical) |
| `player/history.upstream.test.ts` | `player/history.upstream.test.ts` (updated) |
| `player/playerstat.upstream.test.ts` | `player/playerstat.upstream.test.ts` (identical) |
| `player/timed.upstream.test.ts` | `player/timed.upstream.test.ts` (substantially broader) |
| `score/pscore.upstream.test.ts` | `score/pscore.upstream.test.ts` (updated) |

### `6bb7f1e43` (`p3/ut-core`)

All 19 suites are already covered.  The current files are the same-path
versions for `combat/attack`, `combat/mon-attack`, `combat/slays`,
`effects/chain`, `effects/info`, `game/destruction`, `game/earthquake`,
`game/monster`, `game/pile`, `gen/find`, `mon/desc`, `obj/alloc`, `obj/info`,
`obj/randname`, `session/basic`, `session/mage`, `world/scatter`, and
`web/command-lookup`.  `game/util.upstream.test.ts` is covered by the renamed
and equivalent `game/obj-util.upstream.test.ts`.  The identical current copies
were retained where applicable; changed current copies were checked by suite
name and are equal or broader.

### `0d05649f0` (`p3/ut-zlib`)

| Stale source | Already covered by current master |
| --- | --- |
| `core/src/dice.upstream.test.ts` | `core/src/dice.upstream.test.ts` (identical) |
| `core/src/expression.upstream.test.ts` | `core/src/expression.upstream.test.ts` (identical) |
| `core/src/guard.upstream.test.ts` | `core/src/guard.upstream.test.ts` (broader) |
| `core/src/msg.upstream.test.ts` | `core/src/msg.upstream.test.ts` (broader) |

## zlib-msg shared-file review

No non-test change from `0d05649f0` was carried forward.

- `packages/cli/src/parity-c.test.ts`: superseded by the current
  `parity-c-stat.test.ts` C-vs-TS statistical harness.
- `packages/cli/src/scenarios.ts`: the stale `descend` pin (`35`) conflicts
  with the master re-pin (`33`) after later generation work.
- `packages/cli/src/stats.ts`: stale patch removes variance collection and
  unique retirement required by the newer parity harness.
- `packages/core/scripts/codegen-lists.mjs`: stale patch removes the current
  `--check` drift gate.
- `packages/cli/baseline/stats-baseline.json`: stale self-captured baseline is
  superseded by master’s later re-pinned baseline and current C baseline setup.

## Kept / findings

No files were newly kept from these commits because all test coverage was
already present.  No open findings remain from this salvage audit.

## Verification maintenance

The exhaustive `session/save-fields.test.ts` scalar reload test consistently
exceeded Vitest's default five-second timeout during the full parallel suite
(while its assertions passed).  Its timeout is now 15 seconds; no test logic
or production code changed.  This is suite reliability maintenance, not a
reference-C parity claim.
