# S3-FIX — close the species-mix divergence

You are working in the worktree you were given. `reference/` is the **read-only
oracle** (original Angband 4.2.6). Never modify anything under `reference/`.

Inputs, both in `parity/phase3-2026-07-25/findings/`: `S3-ROOTCAUSE.md` (the
diagnosis) and `S3-REVIEW.md` (the adversarial review, which confirmed RC1 and
RC3, partly confirmed RC2, and found five more order defects). **The review is
authoritative where the two disagree.**

The measured symptom: the port's monster species mix diverges from a 1000-level
compiled-C oracle at every depth 5–20, G = 389–823 on df = 138–209, p to 4.8e-98,
while density and level feelings pass. Reproduce and re-measure with:

```bash
pnpm vitest run packages/cli/src/parity-c-stat.test.ts --testTimeout=600000
```

It prints a full per-depth table. `NEO_PARITY_RUNS=1000` raises the port sample.

## Fix in this order — the RNG stream matters

### 1. RC1 — `pickAndPlaceDistantMonster`

`packages/core/src/gen/util.ts:1811-1842` against
`reference/src/mon-make.c:1483-1520`. The C:

- draws a full-map location, `randint0(width)` by `randint0(height)`;
- rejects occupied grids;
- applies `SQUARE_MON_RESTRICT` while `!character_dungeon`;
- accepts `distance > dis` (so `dis == 0` accepts almost anywhere);
- loops `while (--attempts_left)` from 10000, i.e. **9,999 iterations**.

The port instead forces `maxSight + 1`, draws interior-only coordinates, omits the
restrict test, and halves the distance threshold after retries run out. Generation
callers at `gen/cave.ts:1092,1199,1377,1609,1672,1817,1821,2054` mostly pass
`dis == 0`.

**Do not touch `packages/core/src/game/mon-place.ts:739-765`** — the runtime twin
already has the C shape. Do not "unify" them by giving it the generation helper's
rules.

### 2. RC3 — generation never advances `race.curNum`

The C increments the racial count after a *successful* placement
(`mon-make.c:1041-1042`), and `get_mon_num` excludes a unique at or above
`max_num` (`:257-258`). Generation only tracks `placedUniques`
(`gen/util.ts:360-367`, `:1543-1558`), so a failed unique selection consumes
selection draws the C would never spend.

Increment at the successful-placement boundary, cover every generation placement
that bypasses `placeNewMonsterOne`, and **do not double-count the cave-symmetry
monster copies at `gen/cave.ts:950`**. Runtime placement already increments
`(originalRace ?? race).curNum` at `game/mon-place.ts:218`.

### 3. The prepend-order defects — `S3-REVIEW.md` section 3

The C's parsers head-insert, so it walks these lists in **reverse file order**
while the port stores file order. Six are live:

1. **`friends` and `friends-base`** (`mon-init.c:1589`, `:1626` →
   `mon/bind.ts:718-740`). Reversing each independently is correct here: the C
   keeps them as two separate lists.
2. **`drop` and `drop-base`** (`mon-init.c:1534-1559` → `mon/bind.ts:501-518`,
   `:708-710`). **Reversing each array is NOT sufficient** — the C keeps ONE
   interleaved list across both directives, and the port concatenates two arrays,
   so cross-directive interleaving is lost. Preserve a single combined source
   order and reverse that, or prove the pack format cannot interleave them.
3. **Room templates** (`generate.c:323` → `gen/room.ts:127-140`) and **vaults**
   (`:484` → `:148-160`).
4. **Mimic kinds** (`mon-init.c:1652` → `mon/bind.ts:743-746`) and **preferred
   shapes** (`:1666` → `:749-756`).
5. **Alternate spell messages** (`mon-init.c:1447` → `mon/bind.ts:481-499`,
   consumer `game/mon-message.ts:185-193`) — both return the first match, so
   duplicate same-spell overrides resolve differently.

Items 3 and 4 keep the same *distribution* — both sides reservoir-sample or
`randint0`-index — but a given RNG stream picks a **different candidate**. Under
decision 6.2 (the base game reproduces the C's seed exactly) that is a real
parity break, and no statistical test can see it, so fix it on the C's authority
rather than waiting for evidence.

Follow the precedent already in the tree: `obj/bind.ts:530-588` reverses slays,
brands, curses and activations explicitly for exactly this reason.

### 4. Re-measure, and only then look at pits

RC4 stands: the pit and nest logic re-derives as faithful, and the C's pit lists
are membership tests, not ordered weighted choices. **Do not tune pit weights or
data against the current histogram.** Re-run the statistical test after 1–3. If
pit-only races (`warrior`, `ogre`) are still divergent, add telemetry on pit
attempts, selected profile, and empty-pit failures by depth, and report it —
don't guess.

## Hard constraints

- **State the RNG draw sequence** for every change. Same draws, same order, same
  count as the C, or explain precisely why the C differs.
- Faithful means faithful: preserve upstream bugs.
- Verify with chunked runs and a hard timeout, never a monolithic `pnpm test`:
  `timeout 900 pnpm vitest run <paths> --testTimeout=30000`
  (`packages/borg/src/{think,foundation}.test.ts` hang — pre-existing, unrelated,
  never run them.) `pnpm typecheck` must be clean.
- Expect `packages/cli/src/parity.test.ts` (the port's self-regression baseline)
  to go red: these changes intentionally move generation. Do **not** regenerate
  that baseline — report the diff and leave it for the gate, which will re-record
  it in its own commit once the C comparison is green.

## Deliverable

`parity/phase3-2026-07-25/findings/S3-FIX.md`:

1. One block per fix: C citation, port file:line, what changed, and the resulting
   RNG draw sequence.
2. The **before/after statistical table** from `parity-c-stat.test.ts` — per
   depth, G, df, p — so the effect of the batch is measured, not asserted.
3. Anything still divergent, with your best evidence for where it lives.

Commit nothing.
