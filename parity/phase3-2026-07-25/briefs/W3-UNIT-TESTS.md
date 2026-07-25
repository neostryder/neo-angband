# W3-5 — Port upstream's own unit tests into the port's suite

You are working in `C:\Repositories\neo-angband`. `reference/` is the
**read-only oracle** (original Angband 4.2.6). Never modify anything under
`reference/`.

## Why

`reference/src/tests/` is 86 C files and ~35 000 lines of **upstream's own unit
tests**, carrying exact expected values written by the people who wrote the
game. The 2026-07-24 parity audit excluded it as "build tooling", which left the
single densest oracle in the repository unused.

Porting these converts upstream assertions into permanent port assertions. When
a ported test fails, that is a **parity finding**, not a test to be adjusted.

## Your batch

**BATCH: `<BATCH>`** — port only the test files under those directories.

Read `reference/src/tests/unit-test.h`, `unit-test-data.h`, `test-utils.c/h`, and
`README` first: they define the `NTESTS`/`TEST_FN` harness, the shared fixtures
(`test_monster_base`, `test_object_*`, and so on), and the setup/teardown
contract. Those fixtures are part of the oracle — port the *values* faithfully.

## How

For each C test file:

1. Read it fully and identify what it asserts.
2. Find the port code under test. Then choose a verdict:
   - **PORT IT** — the behaviour exists in the port. Write a vitest file next to
     the port code under test, named `<subject>.upstream.test.ts`, with one
     `it()` per upstream `TEST_FN` and the **same expected values**. Head the
     file with a comment citing the C file it came from, and cite the specific C
     test name on each `it()`.
   - **N/A** — the test targets C-only infrastructure with no port counterpart
     (manual memory management in `z-virt`, POSIX file I/O in `z-file`, string
     interning in `z-quark`, allocation macros). Record it as N/A with a
     one-line reason. Do **not** invent a port abstraction just to host a test.
   - **BLOCKED** — the behaviour should exist in the port but you cannot find it.
     That is a **parity finding**: record it with the C file:line and what is
     missing. Do not paper over it with a test that asserts the port's current
     behaviour.
3. Keep upstream's expected values **exactly**. If a ported test fails, do not
   change the expectation and do not change port code to suit the test in this
   task — record it as a FAILING finding with the C citation and the port's
   actual value. Fixing is a separate, reviewed step.
4. Where upstream tests a function the port structures differently (a C function
   split across TS modules, or vice versa), test the same *observable behaviour*
   through the port's real API. Note the mapping in the file header comment.

## Constraints

- Faithful means faithful: preserve upstream bugs and oddities. If an upstream
  test encodes surprising behaviour, the port must reproduce it.
- Do not modify existing port source files in this task. Tests only.
- Verify with chunked runs and a hard timeout, never a monolithic `pnpm test`:
  `timeout 600 pnpm vitest run <your new test paths> --testTimeout=20000`
  (`packages/borg/src/{think,foundation}.test.ts` hang — pre-existing, unrelated,
  never run them).
- Typecheck before you finish: `pnpm typecheck`.

## Deliverable

1. The new `*.upstream.test.ts` files.
2. `parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-<BATCH>.md` with a table:
   one row per upstream C test file → verdict (PORTED / N/A / BLOCKED), the port
   test path, the number of `it()`s written, and how many pass vs fail.
3. Below the table, one block per FAILING or BLOCKED test:
   ```
   ### UT-NNN  <upstream test name>
   ref:      reference/src/tests/<file>.c:<line>
   port:     <path>:<line>
   expected: <upstream's expected value>
   actual:   <the port's value>
   why:      <the divergence, derived from the C>
   severity: P0|P1|P2|P3
   ```

Commit nothing.
