TRAPS parity independent adversarial review, round 2
Date: 2026-07-25
Branch reviewed: parity/p1-traps
Base in worktree: 00a1756df (save/load batch)
Diff reviewed: parity/audit-2026-07-24/TRAPS_FIX_R2.diff
Oracle: reference/
Decision 6.2: same draw order and count as C

Overall verdict: ISSUE. The town persistence, disarm darkness arithmetic,
initial only_partial lifecycle, blind forget, and visibility-guard test are
fixed. The live thrust path still misses landing post-move effects for a
player who is the thrust source, and the checked branch still contains
divergent trap-immunity helpers relative to the merged player/combat master
implementation. The round-1 generation WALL-flag issue also remains.

1. TRF_DELAY on live movement: ISSUE

The leaving half is fixed. packages/core/src/game/context.ts:916 and :920
call onPlayerLeaving after monsterSwap moves a player, and :986 does the same
for movePlayer. installTraps consumes that hook at
packages/core/src/game/trap.ts:734-736 and calls hitTrap(oldGrid, 1).
Ordinary walk and jump use movePlayer at
packages/core/src/game/player-turn.ts:475, and the in-place teleport variants
use movePlayer or monsterSwap, so those paths now reach player_leaving.

The landing post-move half is not complete for force/thrust. In
packages/core/src/game/thrust.ts:141 and :156, the callback is gated by
c.mon(grid) < 0 after the swap. When the player is the source occupant at
grid, monsterSwap moves the player to next, so grid is no longer occupied by
the player and this condition is false. In addition, the live projection
wiring at packages/core/src/session/game.ts:1058-1059 calls thrustAway without
an onPlayerPostMove callback. Therefore a player pushed by force/thrust gets
the delayed-trap leave hook but not the landing post-move effects through this
live path. C project-mon.c:183-185 and :208-212 conditionally call
player_handle_post_move for the player-at-next swap case; the port does not
provide the corresponding live hook for the player-at-grid case requested by
this review.

Stairs and recall replace the level and place the player on the arrival level;
they are not in-level monster_swap movements in C, so their direct placement
does not constitute a missed player_leaving call. No other in-level gameplay
movement bypass was found beyond the thrust landing issue.

2. Disarm-on-walk no_light and known-square order: APPROVE

packages/core/src/game/trap.ts:670-687 now applies one C-style /10 penalty
when blind, no_light, confused, or hallucinating. no_light is exactly
!squareIsSeen(player_grid), matching cave-view.c:914-917. The power is depth/5,
the minimum chance is 2, and the two checks remain in C order at
packages/core/src/game/trap.ts:691 and :697. Darkness changes skill only; it
does not add a draw.

The walk wrapper requires squareIsKnown for the closed-door branch at
packages/core/src/game/cave-cmd.ts:678-682 and for the trap branch at :700-707.
The door/trap decision precedes disarmAux, so the two randint0(100) calls are
not moved or duplicated. The focused no_light test also distinguishes lit
success from dark failure without relaxing the live guard.

3. only_partial on initial birth entry: APPROVE

startGame sets onlyPartial before the initial host FOV at
packages/core/src/session/game.ts:2565-2568. If a host FOV is already wired,
startGame runs it under the flag and clears it; otherwise the web shell runs
the first FOV and clears it immediately at packages/web/src/main.ts:5885-5886.
The normal fresh-generation and persistent-restore level-entry paths likewise
set and clear it at packages/core/src/session/game.ts:2014-2016 and :2147-2149.

The feeling event remains suppressed only at the exact crossing in
packages/core/src/world/view.ts:475, where feelingSquares equals feelingNeed
and onlyPartial is true. The core and web clear paths cover both host-wired
and web-wired startup, so the flag is not left sticky on either side in the
live paths examined.

4. Town terrain persistence and save/load: APPROVE

Leaving non-persistent town stores a terrain/info-only copy at
packages/core/src/session/game.ts:1931. serializeGame writes it at
packages/core/src/session/save.ts:1211-1215 with a feature legend, and loadGame
restores it at packages/core/src/session/game.ts:3082-3085 through
deserializeChunk. ChunkSquaresData preserves name, and chunkWriteTerrain sets
the stored name to Town at packages/core/src/gen/cave.ts:2559-2563; the save
test verifies the Town name round-trip.

Re-entry passes the stored chunk as townLayout at
packages/core/src/session/game.ts:2025-2027 and :2082. The stored branch of
townGen at packages/core/src/gen/cave.ts:2583-2615 copies terrain and info,
finds the existing stairs, illuminates, and places the C town residents. It
does not call townGenLayout. The depth-0 profile selection is RNG-free, and
the only re-entry draws are resident placement draws that C town_gen also
performs. serializeGame/loadGame also preserve the main RNG state, so the
stored terrain does not consume layout draws across a save boundary.

This addition does not conflict with the save/load batch: townChunk is an
optional field alongside levelCache/currentJoins, with its own feature legend,
and is restored before the normal live wiring is rebuilt.

5. L9-016 blind-forget: APPROVE

packages/core/src/game/known.ts:700-710 now implements the C check in
cave-view.c:894-897: while blind, if the remembered current feature is known
and non-passable, squareForget removes it. It uses the remembered feature,
not the live feature, which is the important C knowledge distinction.
packages/core/src/world/view.ts has no knowledge import or knowledge access;
it remains geometry/FOV-only and leaves this mutation to noteSpots.

6. Visibility-guard test rewrite: APPROVE

The old assertion was:
  expect(disarmAux(state, loc(6, 5), d)).toBeDefined();
It was replaced by a live installTraps/processPlayer test named
"installTraps refuses to disarm an invisible trap (visibility guard)". The
new assertions at TRAPS_FIX_R2.diff:503-514 verify the trap is invisible, the
trap remains, energyUsed is zero, and the refusal message is emitted. This is
what the test name claims and is stronger than the old low-level helper check.
No test assertion was relaxed elsewhere in the supplied diff. The added
squareMemorize calls make the door tests satisfy C's known-square precondition.

7. Trap-immunity duplicate resolution: ISSUE

The checked branch still has separate timed-only helpers at
packages/core/src/game/player-path.ts:59 and
packages/core/src/game/chest.ts:84. It also adds equivalent fallback/closure
logic at packages/core/src/game/cave-cmd.ts:634-638 and
packages/core/src/session/game.ts:1437-1440. These are divergent from the
single C player_is_trapsafe implementation in the merged master version
(packages/core/src/game/trap.ts:86 there), which also considers derived and
equipment OF_TRAP_IMMUNE. In this worktree, chest/path behavior can therefore
disagree with the trap and disarm-on-walk paths. The R2 diff does not modify
chest.ts or player-path.ts, but the branch being reviewed still contains the
leftover duplicate and is not cleanly resolved against master.

8. RNG, scope, and carry-over checks

RNG/order: APPROVE for the requested R2 additions. No generation/layout RNG
call was added by the town or only_partial changes. The stored-town path
avoids townGenLayout and does not redraw its layout. The disarm implementation
retains exactly the two conditional randint0(100) calls in C order. The
TRAPS_FIX_R2.diff has no paths under packages/borg, packages/linoleum, or
packages/cli, and no baseline file was changed.

Round-1 carry-over: ISSUE. The generation WALL flag clearing defect remains.
packages/core/src/world/chunk.ts:226-228 still does not clear
SQUARE.WALL_INNER, WALL_OUTER, or WALL_SOLID during setFeat. The only clearing
is still the end-of-builder pass at packages/core/src/gen/generate.ts:234-243
and :401. The R2 comment claims immediate generation clearing, but the code
does not implement it, so mid-generation predicates can still observe stale
flags.

Verification performed:
  pnpm typecheck: PASS
  pnpm exec vitest run packages/core/src/game/trap.test.ts
    packages/core/src/game/cave-cmd.test.ts
    packages/core/src/game/known.test.ts
    packages/core/src/session/game.test.ts
    packages/core/src/session/save.test.ts
    packages/core/src/world/fov.test.ts
    packages/core/src/game/thrust.test.ts
  Result: 7 files, 165 tests PASS

The known packages/cli parity.test.ts and parity-c.test.ts red tests were not
used to change this verdict, per the request's S-2 exception.
