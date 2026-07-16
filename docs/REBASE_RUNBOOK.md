# Upstream Rebase Runbook

How to advance the port from its pinned upstream baseline (currently Angband
`4.2.6`) onto a future upstream release, using the parity ledger
(`parity/ledger/*.yaml`) as the reverse index from changed upstream sources to
affected port modules.

This is the operational companion to `docs/PARITY.md` (methodology) and
`parity/README.md` (ledger schema). It assumes the ledger has been reconciled
against the code (B3, done 2026-07-16), so a ledger entry's `status`, `baseline`,
`upstream[]` and `items` can be trusted as the map.

Prerequisites, once per rebase:

- A clean working tree and a fresh branch.
- The port test suites green at the current baseline (`pnpm -r test`).
- The B1 self-regression baseline reproducing integer-for-integer
  (`pnpm --filter @neo-angband/cli test`, the `parity.test.ts` EXACT guard).

If any of these is red before you start, fix that first; you cannot tell rebase
drift from a pre-existing failure otherwise.

--------------------------------------------------------------------------------

## Terms

- `reference/` -- a read-only checkout of the upstream Angband source at the
  pinned baseline tag. `reference/src/*.c|*.h` is the C golden master;
  `reference/lib/gamedata/*.txt` is the data master that `packages/content`
  compiles into the JSON pack.
- Pinned baseline tag -- the upstream version the port is currently faithful to.
  It appears in `parity/README.md`, in every ledger entry's `baseline:` field,
  and (informally) in `packages/cli/baseline/README.md`.
- Ledger entry -- one YAML file per port module under `parity/ledger/`, mapping
  a port `module:` to the `upstream[]` files/`items` it ports.

--------------------------------------------------------------------------------

## Step 1 -- Pull the new upstream tag into `reference/`

The pinned baseline is advanced by replacing the contents of `reference/` with
the new tag's tree. `reference/` has no `.git` of its own (it is a vendored
snapshot), so you refresh it explicitly.

1. Obtain the new upstream tree at the target tag (e.g. `4.3.0`) from a separate
   clone of upstream Angband. Do NOT git-merge it; you are replacing a snapshot.
2. Keep a copy of the OLD `reference/` tree for the diff in Step 2. The simplest
   way: copy the current `reference/` aside as `reference.old/` BEFORE you
   overwrite it (delete `reference.old/` when the rebase lands).

   ```sh
   cp -r reference reference.old            # baseline snapshot for diffing
   # replace reference/ with the new tag's tree (src/ + lib/gamedata/ at minimum)
   ```
3. Do not yet touch any `baseline:` fields or `parity/README.md`; the tag is
   advanced there only at Step 6, after the port is re-verified.

Scope note: the port only depends on `reference/src/**` (rules/formulas/tables)
and `reference/lib/gamedata/**` (content). Upstream platform backends
(`main-*.c`, `snd-sdl.c`, `ui-term.c`), the `z-*.c` framework, and dev-only
tooling (`wiz-*.c`, `*-spoil.c`, `main-stats.c`) are "not ported by design"
(see `parity/PUNCHLIST.md`); changes there rarely produce port work, but scan
them anyway in Step 2 in case a rule leaked out of a "UI" file.

--------------------------------------------------------------------------------

## Step 2 -- Diff new tag vs the pinned baseline

Enumerate exactly what upstream changed, at file and function granularity.

1. File-level churn:

   ```sh
   diff -rq reference.old/src reference/src
   diff -rq reference.old/lib/gamedata reference/lib/gamedata
   ```

   This lists added / removed / modified `.c`, `.h`, and `.txt` files.

2. Function/table-level churn, per modified file:

   ```sh
   diff -u reference.old/src/player-calcs.c reference/src/player-calcs.c
   ```

   Record, for each modified file, the set of changed FUNCTIONS and TABLES (the
   granularity the ledger's `items:` field uses). A changed function body, a
   changed constant table, a new/removed function, or a changed struct field all
   count. For `lib/gamedata/*.txt`, record which record types / directives
   changed (the ledger indexes these through `parity/ledger/gamedata.yaml`).

3. Write the result as a flat worklist of `(upstream path, changed item)` pairs.
   This is the input to Step 3. Example rows:

   ```
   src/player-calcs.c        weight_limit
   src/player-calcs.c        calc_bonuses (encumbrance branch)
   src/mon-move.c            get_move_find_hiding
   lib/gamedata/monster.txt  new record field: sleepiness
   ```

--------------------------------------------------------------------------------

## Step 3 -- Map changed upstream items to affected port modules (the ledger IS the reverse index)

For each `(path, item)` from Step 2, query the ledger to find the port
module(s) that port it. The ledger is a set of small YAML files, so plain grep
is the query engine.

1. Find every ledger entry that references the changed upstream file:

   ```sh
   grep -rl "path: src/player-calcs.c" parity/ledger
   ```

   Returns e.g. `parity/ledger/player-calcs.yaml` and
   `parity/ledger/player-calcs-bonuses.yaml`.

2. Narrow to the entry that ports the changed ITEM, by grepping the same files
   for the function/table name in their `items:` (and `notes:`) text:

   ```sh
   grep -rln "weight_limit" parity/ledger
   ```

   Returns `parity/ledger/player-calcs-bonuses.yaml`, whose `module:` field
   names the port artifact to edit:
   `module: packages/core/src/player/calcs.ts`.

3. For a `lib/gamedata/*.txt` change, the affected entry lives inside
   `parity/ledger/gamedata.yaml` (one record per pack file); grep it for the
   `.txt` name or the pack file:

   ```sh
   grep -n "monster.txt" parity/ledger/gamedata.yaml
   ```

   The gamedata entry points at `packages/content/pack/<x>.json` and its spec in
   `packages/content/src/specs/`; a downstream RULE that consumes the new field
   is then found by grepping the ledger for the consuming C function as in
   step 2.

4. Coverage / gap detection. If a changed upstream `path`/item returns NO ledger
   hit, that upstream code is unported (visible by absence, per `docs/PARITY.md`).
   Decide whether it is (a) newly relevant and must be ported (add a ledger
   entry), or (b) still "not ported by design" (record why). Never leave an
   unmatched changed item undecided.

Because ledger `status` was reconciled in B3, you can also read it as a risk
signal: a changed upstream item landing in a `verified` module is a
regression-test-covered surface; one landing in a `partial` module (e.g.
`game-monster-ai.yaml`, whose remaining deferral is `monster_take_terrain_damage`)
may intersect an already-open gap -- check the entry's notes before porting.

--------------------------------------------------------------------------------

## Step 4 -- Generate the migration worklist

Turn the Step 3 hits into a per-module worklist. One row per affected port
module:

```
module: packages/core/src/player/calcs.ts   (ledger: player-calcs-bonuses.yaml)
  upstream change: player-calcs.c weight_limit formula changed
  re-port:         weightLimit() + the encumbrance speed-penalty branch
  verify:          calcs.test.ts, bonuses.test.ts + B1 stats harness
  ledger update:   baseline 4.2.6 -> <newtag>; status verified -> ported until re-verified
```

Order the worklist by dependency (data/pack first, then core rules that consume
it, then game-layer glue), and by blast radius (a changed shared primitive such
as `rng.ts`, `dice.ts`, or a `world/projection` table touches many modules; do
those first and re-run the whole suite before the leaf modules).

--------------------------------------------------------------------------------

## Step 5 -- Re-port and re-verify

For each worklist row:

1. Re-port the change into the named port module, matching the new upstream
   source line-for-line (same formulas, same RNG draw order). Keep the port's
   documented intentional divergences (listed in the ledger entry's `notes:`)
   unless upstream changed the very thing a divergence was about.

2. Re-run the module's own vitest tests first (fast inner loop):

   ```sh
   pnpm --filter @neo-angband/core test -- calcs.test.ts bonuses.test.ts
   ```

   Update the tests where upstream legitimately changed expected behavior; a
   test that now encodes stale upstream numbers must be re-derived from the new
   `reference/` source, not "made to pass".

3. Re-run the B1 statistical harness (whole-level distributions):

   ```sh
   pnpm --filter @neo-angband/cli build
   pnpm --filter @neo-angband/cli test         # parity.test.ts EXACT self-regression guard
   ```

   - If your change was meant to be distribution-NEUTRAL (a refactor, a
     bug-fix that does not alter generation/allocation), the EXACT guard MUST
     still pass. A diff here means you perturbed the RNG stream or a table
     unintentionally -- investigate before proceeding.
   - If generation LEGITIMATELY changed (upstream changed an allocation table,
     a feeling ladder, a monster/object record, an RNG draw), the guard will
     fail by design. Confirm the diff is exactly the intended change (inspect
     the failing metrics reported by the comparator in `baseline.ts`), then
     regenerate the committed baseline:

     ```sh
     pnpm --filter @neo-angband/cli stats:baseline   # rewrites baseline/stats-baseline.json
     ```

     Re-run `pnpm --filter @neo-angband/cli test` to confirm the fresh baseline
     is now reproduced integer-for-integer. Commit the regenerated
     `stats-baseline.json` alongside the code change and note the reason in the
     commit and in `packages/cli/baseline/README.md` if the metric set changed.

4. Optionally re-run the golden scenarios and spoiler dumps as extra coverage:

   ```sh
   pnpm --filter @neo-angband/cli scenarios
   pnpm --filter @neo-angband/cli spoil -- --kind all --out /tmp/spoil.txt
   ```

5. When all touched modules are re-ported, run the full suite once
   (`pnpm -r test`) plus `pnpm -r typecheck` (or `tsc --noEmit` per package).

--------------------------------------------------------------------------------

## Step 6 -- Advance the pinned baseline and update the ledger

Only after the port is green at the new tag:

1. Content re-compile (if `lib/gamedata` changed):

   ```sh
   pnpm --filter @neo-angband/content build
   pnpm --filter @neo-angband/content compile   # rebuild packages/content/pack/*.json from reference/lib/gamedata
   ```

2. Bump the pinned tag in `parity/README.md` (the "pinned to the parity
   baseline (tag `4.2.6`)" line) to the new tag.

3. For every ledger entry you touched, set `baseline:` to the new tag and set
   `status:` to reflect the re-verification:
   - `verified` only if the re-ported behavior is implemented AND still covered
     by a real `verified-by` (a `packages/**/*.test.ts` or the B1 harness); if a
     test had to be dropped or the harness baseline is not yet re-confirmed, use
     `ported`.
   - `partial` if upstream added behavior you deferred (record the deferral in
     `notes:`).
   - Add a new ledger entry for any newly-ported upstream module (per the schema
     in `parity/README.md`), and update `notes:`/`items:` for any renamed or
     split upstream function.
   - Ledger entries whose upstream files were UNCHANGED keep their old
     `baseline:` value -- do not mass-bump untouched entries; the per-entry
     baseline is what makes the next rebase's diff scope precise.

4. Remove the `reference.old/` diffing copy. Run the structural checks used in
   B3 to confirm the ledger is still well-formed:
   - every doc has `module:` / `status:` / `baseline:`,
   - every `status: verified` doc has a `verified-by`,
   - `status` is one of `planned | partial | ported | verified`.

5. Commit: the `reference/` bump, the re-ported `packages/**` code and tests,
   the regenerated pack JSON and/or `stats-baseline.json`, and the ledger
   updates -- as one coherent "rebase onto <newtag>" change.

--------------------------------------------------------------------------------

## Worked micro-example (tracing one changed function through the ledger)

Hypothetical: upstream `4.3.0` tightens the carrying-capacity curve, changing
the `weight_limit()` table in `player-calcs.c`.

1. Step 2 diff:

   ```sh
   diff -u reference.old/src/player-calcs.c reference/src/player-calcs.c
   ```

   shows the `weight_limit` return table changed. Worklist row:
   `src/player-calcs.c  weight_limit`.

2. Step 3 ledger query (the reverse index):

   ```sh
   grep -rl "path: src/player-calcs.c" parity/ledger
   #  -> parity/ledger/player-calcs.yaml
   #  -> parity/ledger/player-calcs-bonuses.yaml
   grep -rln "weight_limit" parity/ledger
   #  -> parity/ledger/player-calcs-bonuses.yaml
   ```

   Open `player-calcs-bonuses.yaml`:

   ```yaml
   module: packages/core/src/player/calcs.ts
   status: verified
   baseline: 4.2.6
   upstream:
     - path: src/player-calcs.c
       items: [ ..., weight_limit, ... ]
   ```

   The port artifact to edit is `packages/core/src/player/calcs.ts`, function
   `weightLimit` (and the encumbrance speed-penalty branch that reads it).

3. Step 5 re-port + verify:

   ```sh
   # edit packages/core/src/player/calcs.ts weightLimit() to the 4.3.0 table
   pnpm --filter @neo-angband/core test -- calcs.test.ts bonuses.test.ts
   # calcs.test.ts pins the weight-limit values; re-derive them from the new
   # reference/ source, not by eyeballing the failure.
   pnpm --filter @neo-angband/cli test
   # weight_limit does not feed level generation, so the B1 EXACT guard should
   # STILL PASS; if it fails, the edit perturbed something it should not have.
   ```

4. Step 6 ledger update in `player-calcs-bonuses.yaml`:

   ```yaml
   status: verified          # implemented AND calcs.test.ts/bonuses.test.ts cover it
   baseline: 4.3.0           # this entry now pinned to the new tag
   ```

   `player-calcs.yaml` (skills/tables, unchanged by this diff) keeps
   `baseline: 4.2.6` until a future diff actually touches its upstream items.

The same three-move loop -- diff item, grep the ledger to the port module,
re-port and re-verify against that module's tests plus the B1 harness -- applies
to every changed upstream function, table, or gamedata record.
