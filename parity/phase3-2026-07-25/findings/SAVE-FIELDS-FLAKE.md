# SAVE-FIELDS-FLAKE investigation

Date: 2026-07-26
Branch: `fix/save-fields-flake`
Investigated commit: `6dd2282ea`
Runtime: Node `v24.14.1`, Vitest `3.2.7`, Windows x64

## Result

**The reported failure did not reproduce in 10 full `packages/core` runs.**
All 10 runs passed 225 test files and 3,204 tests. In accordance with the
investigation constraint, no save/load production code and no guard semantics
were changed without a captured failure.

## Captured assertion text

There is no assertion text to report: none of the 10 runs failed. In
particular, the assertion at
`packages/core/src/session/save-fields.test.ts:873` never produced a non-empty
`failures` array, so no value of the expected
`<c block> -> <path>: wrote X, read back Y` form was observed.

Each run used:

```text
npx vitest run --root packages/core --reporter=default
```

Standard output and standard error were captured separately for every run, and
each Vitest process was subject to an external command timeout. The logs were
kept outside the repository under
`%TEMP%\neo-save-fields-flake\full-01.log` through `full-10.log`.

## Evidence

| Run | Guard file | Mutated-reload test | Full suite | Result |
|---:|---:|---:|---:|:---|
| 1 | 3,975 ms | 3,305 ms | 22.69 s | pass |
| 2 | 4,963 ms | 3,909 ms | 23.55 s | pass |
| 3 | 4,617 ms | 3,806 ms | 23.59 s | pass |
| 4 | 5,218 ms | 4,047 ms | 25.12 s | pass |
| 5 | 5,157 ms | 4,025 ms | 31.99 s | pass |
| 6 | 5,010 ms | 3,674 ms | 25.73 s | pass |
| 7 | 4,477 ms | 3,520 ms | 22.90 s | pass |
| 8 | 4,931 ms | 3,799 ms | 24.00 s | pass |
| 9 | 4,854 ms | 3,808 ms | 30.93 s | pass |
| 10 | 4,836 ms | 3,846 ms | 25.11 s | pass |

This is also 10 consecutive full-suite passes, exceeding the requested
six-consecutive-run proof threshold, but it is evidence only for the unchanged
code because there was no demonstrated fix.

Both recently added files,
`packages/core/src/rational.upstream.test.ts` and
`packages/core/src/obj/textblock.upstream.test.ts`, were present and passed in
all 10 runs. No `vitest.config.*` exists at the repository root or under
`packages/core`, and the root `package.json:15` only maps `test` to
`vitest run`; the repository does not explicitly disable isolation or select a
shared pool.

The specific mutated-reload test is declared at
`packages/core/src/session/save-fields.test.ts:855`. Its observed duration was
3,305-4,047 ms. No run reported a timeout. Those successful timings do not
prove that a timeout cannot occur under different machine load, and the
investigation rules require an actual timeout failure before accepting that
explanation.

## Root cause

**Not established.** With no failed path, wrong read-back value, timeout
message, or other failing assertion, there is not enough evidence to
distinguish test pollution, save-document ordering, a real loader defect, or
machine-load timing. Assigning any of those causes would be speculative.

## Changes

No production or test code was changed. The `BLOCKS` table, the guard
assertions, and `reference/` are untouched. This findings document is the only
repository change from the investigation.

If the flake recurs, preserve the complete default-reporter output. The first
non-empty `failures` entry (or an explicit timeout message) is the missing
evidence needed to continue with a field-specific production diagnosis.
