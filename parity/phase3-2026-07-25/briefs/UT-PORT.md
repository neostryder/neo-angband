# UT — port a batch of upstream unit-test cases

You are in your own git worktree of `C:\Repositories\neo-angband`. `reference/` is
the **read-only oracle** (Angband 4.2.6). **Never modify anything under
`reference/`.** Never run `prettier` (no local config; it would inherit the
parent's and reformat the repo). Never run bare `pnpm test` —
`packages/borg/src/{think,foundation}.test.ts` hang. Target specific files with a
hard timeout and check the exit code (124 = hang).

## What you are doing

`parity/phase3-2026-07-25/reports/ut-ledger.tsv` lists all 849 upstream unit-test
case functions with a `cited` column. 530 are uncited: no port test names them.
Your batch is a slice of those.

A citation is how this project records "a human adjudicated this upstream case",
so your job per case is to reach one of these and make it findable by name:

- **PORTED** — a port test asserts the same thing. Add the upstream case name to
  the test's title or a comment so the ledger matches it next run. If an existing
  port test already covers it, cite it there rather than writing a duplicate.
- **N/A** — the case is about C machinery the port legitimately lacks. Record it
  in your findings file WITH the reason, and add the name in a comment at the
  nearest port location so it is not re-queued. Be specific — "different
  architecture" is not a reason. Acceptable: C manual memory management, a
  `parser`-object API the port replaced with a pure function, POSIX path/file
  semantics, the binary savefile format (the port ships a ratified JSON save).
- **GAP** — the port's behaviour differs from what the upstream case asserts.
  **This is the point of the exercise.** Fix the port to match the C, or if the
  fix needs a restructure rather than an edit, report it with the reason and
  leave it. Never change the test to match the port.

## The rule this brief exists for

**Never widen a tolerance, never adjust an expectation to make a test pass, and
never regenerate a baseline from the port.** If the port disagrees with upstream,
upstream is right by definition — this is an exact-parity port. Core retains ALL
warts of the reference C: if upstream has a bug, the port has that bug, and an
improvement belongs in a bundled mod, never in core.

And: **read the C yourself.** Do not port a case from its name or from a summary.
Read the upstream case body, work out what it actually asserts (including what it
asserts about ERROR CODES and about state left behind on failure), and assert that.

## Method notes for this area

- The port models upstream's parse errors as real codes:
  `packages/core/src/generated/parser-errors.ts` is generated from
  `list-parser-errors.h`, and `packages/content/src/parser.ts` throws `ParseError`
  with a `code`. So `eq(r, PARSE_ERROR_INVALID_FLAG)` ports directly.
- Record assembly (`recordStart` / `header` / `repeat` / `childOf`) lives in
  `packages/content/src/records.ts` driven by the shipped specs in
  `packages/content/src/specs/`. Use the REAL shipped spec, never a fixture — the
  point is to pin production metadata.
- Two existing files are your pattern; match their style:
  `packages/content/src/parser.upstream.test.ts` (directive/spec level) and
  `packages/content/src/records.upstream.test.ts` (record assembly, with the
  upstream case name in each title).
- The W5 data-exactness suite already proves the shipped gamedata parses to
  field-identical records. So a case whose input is WELL-FORMED and appears in
  `reference/lib/gamedata/*.txt` may genuinely be covered — check, and cite W5 if
  so. What W5 structurally cannot cover is malformed input, degenerate input, and
  directives that never appear in the shipped files. **That is where the value is,
  so start with the error cases.**

## Deliverable

1. Your new test file (named below), with one `it()` per upstream case you ported,
   each title naming the upstream case.
2. `parity/phase3-2026-07-25/findings/UT-<BATCH>.md`:
   - a table `upstream file | case | verdict (PORTED-NEW / PORTED-EXISTING / N/A /
     GAP) | evidence`, with **every case in your batch**, no sampling;
   - one block per GAP: `ref` / `port` / `what differs` / `effect` / `severity`
     (P0 breaks the game, P1 wrong in normal play, P2 edge case or secondary
     screen, P3 cosmetic) / `fixed: yes|no` + reason;
   - for every production change, a mutation table: the mutation, which of your
     tests caught it, and whether the pre-existing suite caught it too;
   - a closing count.
3. Run `pnpm build` and your package's suite. Report exact pass counts.
4. Commit on your branch. Do not push.

Report back the counts, every GAP, the mutation table, and anything in this brief
that turned out to be wrong.
