# W5 — Data exactness: an independent re-parse of every gamedata file

You are working in `C:\Repositories\neo-angband`. `reference/` is the
**read-only oracle** (original Angband 4.2.6). Never modify anything under
`reference/`.

## Why

The port does not parse `lib/gamedata/*.txt` at runtime. `packages/content`
compiles those files into a JSON pack at build time and the compiled pack is
what the game loads — a legitimate browser concession, but it means **nothing
currently proves the committed pack still matches the reference data**. An
audit-time one-off diff reported "no missing records"; presence is not value,
and a one-off is not a guard.

## Task

Write a committed vitest test that makes the concession honest.

1. Read **every** file in `reference/lib/gamedata/*.txt` (45 of them) directly
   from `reference/`, with a reader written for this test — deliberately
   independent of `packages/content`'s parser, so a parser bug cannot hide by
   being on both sides of the diff. The C parsers are the spec:
   `reference/src/init.c`, `obj-init.c`, `mon-init.c`, and `parse.c` /
   `datafile.h` for the `name:`/`code:`/directive grammar, including:
   - continuation and repeated directives that append rather than replace;
   - `flags:` lists split on `|` and whitespace;
   - dice/expression values (`z-dice.c`, `z-expression.c` grammar);
   - `base:` inheritance for monsters and object kinds — resolve it the way the
     C does, not by assuming defaults;
   - files that define *lists* whose order is semantic (the index a record
     lands at is data: monster r_idx, object k_idx, terrain, colours).

2. Diff, **field by field and index by index**, against the compiled pack the
   game actually loads (see how `packages/cli/src/pack.ts` `loadGamePack` and
   `packages/content` produce and consume it).

3. Report every difference with file, record name, field, reference value, and
   port value. An empty diff is the pass condition. Where the port *must*
   legitimately differ, encode that as an explicit, commented allow-list entry
   naming the reason — never by loosening the comparison.

Put the test where it will run in the normal suite (a `packages/content`
`*.test.ts` is the natural home; it may read `reference/` via a relative path —
other tests already do).

## Constraints

- Faithful means faithful: if the reference data has an oddity, the port must
  have the same oddity. Do not "correct" reference values.
- Do not modify the compiled pack to make the test pass. If the pack is wrong,
  report it — the fix is a separate, reviewed change.
- Verify with a chunked run and a hard timeout, never a monolithic `pnpm test`:
  `timeout 600 pnpm vitest run <your test path> --testTimeout=20000`.
  (`packages/borg/src/{think,foundation}.test.ts` hang — pre-existing, unrelated,
  do not run them.)

## Deliverable

1. The test file, passing or failing **honestly** — a red test that reports real
   data divergence is a better outcome than a green one that compares nothing.
2. `parity/phase3-2026-07-25/findings/W5-DATA-EXACTNESS.md` with: which
   reference files are covered, how many records and fields the test compares,
   every difference found (or an explicit "none"), and anything you could not
   compare and why.

Commit nothing.
