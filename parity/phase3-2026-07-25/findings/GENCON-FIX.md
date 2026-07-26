# GENCON — connectedness call-site adjudication

Date: 2026-07-26
Branch: `findings/gencon`

## Verdict

No core change is required.  The lead is false: the port executes
`ensureConnectedness()` at all six semantic C call sites, in the same order
and with the same boolean argument.  The apparent fifth TypeScript call site
is intentional sharing of C's otherwise duplicate `modified_chunk()` and
`moria_chunk()` bodies; each runtime path reaches it once.

The task anchor names `reference/src/generate.c`, but that file contains no
call sites in this oracle.  The declaration is in
`reference/src/generate.h:334`; all implementation and call sites are in
`reference/src/gen-cave.c`.  The C routine takes only the chunk and
`allow_vault_disconnect`, colours regions, and joins them
(`reference/src/gen-cave.c:2058-2076`).

## Complete call-site accounting

| C runtime path | C call, guard, and arguments | Port counterpart | Result |
| --- | --- | --- | --- |
| `classic_gen` | After at least two rooms have been built (otherwise the generator returns), it draws the permanent boundary, calls traditional tunnelling, then `ensure_connectedness(c, true)` (`reference/src/gen-cave.c:1257-1272`). | `classicGen()` draws the boundary, calls `doTraditionalTunneling()`, then `ensureConnectedness(g, true)` (`packages/core/src/gen/cave.ts:1096-1100`). | Exact. |
| `modified_chunk` | Once the room-building loop completes, it frees the room map, tunnels, then calls `ensure_connectedness(c, true)` before restoring the boundary to granite (`reference/src/gen-cave.c:2818-2842`). | `modifiedChunk()` tunnels, calls `ensureConnectedness(g, true)`, then restores granite (`packages/core/src/gen/cave.ts:1164-1168`). | Exact. |
| `moria_chunk` | The same sequence and arguments appear in its own C copy: tunnel then `ensure_connectedness(c, true)`, then granite boundary (`reference/src/gen-cave.c:3071-3089`). | `moriaGen()` reaches the same `modifiedChunk()` helper through `modifiedStyleGen()` (`packages/core/src/gen/cave.ts:1172-1196`, `1234-1238`), so it executes the preceding port call once. | Exact; one shared source call represents two C runtime calls. |
| `hard_centre_gen` | After the five chunks are assembled, bounded with permanent rock, and `connect_caverns()` runs, it unconditionally calls `ensure_connectedness(c, false)` before freeing chunks and placing stairs (`reference/src/gen-cave.c:3456-3477`). | `hardCentreGen()` bounds, calls `connectCaverns()`, then `ensureConnectedness(g, false)` before stairs (`packages/core/src/gen/cave.ts:2049-2060`). | Exact. |
| `lair_gen` | After successful normal/lair chunks are copied and the enclosing permanent boundary is drawn, it calls `ensure_connectedness(c, true)` before stairs (`reference/src/gen-cave.c:3681-3697`). | `lairGen()` copies chunks, draws the boundary, then calls `ensureConnectedness(g, true)` before stairs (`packages/core/src/gen/cave.ts:1737-1744`). | Exact. |
| `gauntlet_gen` | After successful component generation, assembly, and boundary drawing, it calls `ensure_connectedness(c, true)` before object allocation (`reference/src/gen-cave.c:3941-3959`). | `gauntletGen()` performs the same assembly and calls `ensureConnectedness(g, true)` before allocation (`packages/core/src/gen/cave.ts:1886-1893`). | Exact. |

There are no conditional `ensure_connectedness` guards at these sites beyond
the preceding generation-success/early-return paths noted in the table.  In
particular, the C call itself is unconditional on each reachable path.

## Statistical oracle

No generation code changed, so there is no before/after distribution shift to
report.  The compiled-C statistical oracle passed in the required full run:
`packages/cli/src/parity-c-stat.test.ts` — 3 tests passed.  Its numbers are
therefore unchanged by this findings-only commit.

## Required verification

* `pnpm install --frozen-lockfile` — passed.
* `pnpm -r build` — passed.
* `npx vitest run --exclude "**/borg/**"` — failed after 361.31 s: 285 files
  passed, 3 failed, 1 skipped; 5191 tests passed, 3 failed, 1 skipped.  The
  failures were 5-second timeouts in
  `packages/cli/src/parity.test.ts`,
  `packages/linoleum/src/authoring.test.ts`, and
  `packages/core/src/gen/gen.test.ts`; Vitest also reported an
  `onTaskUpdate` worker timeout.  This is the observed result, not a claimed
  successful baseline.
