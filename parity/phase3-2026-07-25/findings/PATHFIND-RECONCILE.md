# Pathfind reconcile

## Decision record

| Disagreement | Winner | Evidence |
| --- | --- | --- |
| Flat, whole-level distance storage versus lazily allocated 16x16 patches in `findPath` | Patched implementation | `find_path` declares `struct pfdistances_patched` and initializes it before the search ([`reference/src/player-path.c:1079`](../../../reference/src/player-path.c#L1079), [`reference/src/player-path.c:1139`](../../../reference/src/player-path.c#L1139)); it initializes the start patch and initializes each newly reached patch ([`reference/src/player-path.c:1146`](../../../reference/src/player-path.c#L1146), [`reference/src/player-path.c:1171-1173`](../../../reference/src/player-path.c#L1171-L1173)).  Path reconstruction explicitly skips neighbors with no allocated patch ([`reference/src/player-path.c:750-774`](../../../reference/src/player-path.c#L750-L774)), so a flat array is not behavior-equivalent. |
| `find_path` A* versus the whole-field `prepare_pfdistances` route | Patched A* | Upstream says equal-cost routes may produce different paths and then defines `find_path` as the separate routine ([`reference/src/player-path.c:1063-1069`](../../../reference/src/player-path.c#L1063-L1069)).  The chosen port retains the last-neighbor/`qp_pushpop_int` flow from the A* loop ([`reference/src/player-path.c:1252-1282`](../../../reference/src/player-path.c#L1252-L1282)). |
| Class-based heap versus function-level priority-queue transcription | Function-level transcription | The C heap’s `down_heap` uses its asymmetric two-child comparisons ([`reference/src/z-queue.c:139-181`](../../../reference/src/z-queue.c#L139-L181)) and `qp_pushpop_int` has distinct equality behavior ([`reference/src/z-queue.c:410-431`](../../../reference/src/z-queue.c#L410-L431)).  `z-queue.ts` now carries the recovered generic function-level API under the reference-mirroring filename. |
| WIP claim that there was no `energy_per_move` hook at pathfinding penalties | Corrected; apply the conversion | `convert_turn_penalty()` calls `energy_per_move()` and rounds the standard-turn penalty into movement turns ([`reference/src/player-path.c:125-153`](../../../reference/src/player-path.c#L125-L153)); the port already implements that hook, corresponding to upstream’s `energy_per_move` ([`reference/src/player-util.c:323-328`](../../../reference/src/player-util.c#L323-L328)).  `player-path.ts` now uses `energyPerMove()` through `convertTurnPenalty()` for unlocked doors, locked doors, and rubble. |

There were no post-`f8e534ee4` master changes to `player-path.ts` to reapply.  The patched implementation therefore wins every pathfinder behavior disagreement; no C evidence contradicted it.

## WIP comment audit

- Kept and verified: the patched-distance helpers model the allocation, clearing, lookup, and reconstruction protocol in [`reference/src/player-path.c:604-786`](../../../reference/src/player-path.c#L604-L786).
- Kept and verified: equal-cost path identity is behaviorally significant because upstream documents that `find_path` may differ from `pfdistances_to_path` ([`reference/src/player-path.c:1063-1067`](../../../reference/src/player-path.c#L1063-L1067)); the recovered queue tests cover the heap tie cases from [`reference/src/z-queue.c:139-181`](../../../reference/src/z-queue.c#L139-L181) and [`reference/src/z-queue.c:410-431`](../../../reference/src/z-queue.c#L410-L431).
- Kept and verified: the `add_grid > 0` versus later `add_grid >= 0` observation is the source’s actual control flow ([`reference/src/player-path.c:1252`](../../../reference/src/player-path.c#L1252), [`reference/src/player-path.c:1280`](../../../reference/src/player-path.c#L1280)); boundary grids cannot become feasible because patch initialization uses `square_in_bounds_fully` ([`reference/src/player-path.c:674-676`](../../../reference/src/player-path.c#L674-L676)).
- Corrected: the carried `convert_turn_penalty` divergence note was false about the absent hook.  It now describes and implements the upstream conversion.
- Corrected: stale comments naming `queue.ts` now name `z-queue.ts`.  No WIP comment claim was dropped.

## `do_cmd_pathfind` and cave FIFO

`pathfindAction` still validates the destination, calls `findPath(state, state.actor.grid, dest)`, and starts the resulting path.  This matches the C call site: `do_cmd_pathfind` obtains the point, rejects confusion, calls `find_path(player, player->grid, grid, &steps)`, then stores destination/count and invokes `run_step(0)` when positive ([`reference/src/cmd-cave.c:1551-1565`](../../../reference/src/cmd-cave.c#L1551-L1565)).

`packages/core/src/gen/cave.ts` remains unchanged.  Its local FIFO corresponds to the separate `struct queue` API (`q_new`, `q_push`, and `q_pop`; [`reference/src/z-queue.c:32-106`](../../../reference/src/z-queue.c#L32-L106)), while the recovered shared file transcribes the priority-queue API.  Replacing it would require changing capacity/overflow behavior or expanding the shared API; behavior-neutrality was not proven, so no change was made.

## Verification

```
pnpm install --frozen-lockfile
pnpm -r build
npx vitest run --exclude "**/borg/**"
```

The final Vitest run completed successfully: **289 passed files, 1 skipped file; 5212 passed tests, 1 skipped test** (260.18 s).
