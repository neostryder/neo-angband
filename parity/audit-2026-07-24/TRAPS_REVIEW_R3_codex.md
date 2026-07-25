TRAPS parity independent adversarial review, round 3
Date: 2026-07-25
Branch reviewed: parity/p1-traps
Diff reviewed: parity/audit-2026-07-24/TRAPS_FIX_R3.diff
Oracle: reference/
Decision 6.2: same draw order and count as C

Overall verdict: APPROVE

The three requested round-3 fixes are verified. The trap/dungeon batch is now
approvable for these reviewed items. No packages/borg, packages/linoleum, or
packages/cli files, and no cli baseline file, are touched by the supplied R3
diff. The known packages/cli parity reds were not used for this verdict.

1. TRF_DELAY landing half and movement hooks: APPROVE

The player-at-grid force/thrust case now fires the landing hook. In
packages/core/src/game/thrust.ts:143 and :158, the post-swap test is now
`c.mon(grid) < 0 || c.mon(next) < 0`. When the player was at `grid` before the
swap, the player is at `next` afterwards, so the second term is true. When the
player was at `next` before the swap, the first term is true after the swap.
The callback therefore runs after the occupancy swap and observes the live
landing grid.

The live project-mon projection supplies that callback at
packages/core/src/session/game.ts:1065-1070. It calls the installed
`state.onPlayerMoved` hook with the post-swap actor grid. The teleport-side
post-move hook at packages/core/src/session/game.ts:927-931 is also wired to
the same landing effect. The other live thrust callers in
packages/core/src/game/mon-side.ts:442-450 and
packages/core/src/game/player-side.ts:511-519 route through that teleport
post-move hook.

The leaving half remains intact. `monsterSwap` calls `onPlayerLeaving` after
moving a player at packages/core/src/game/context.ts:913-920, and `movePlayer`
does so at :980-986. `installTraps` maps that hook to `hitTrap(oldGrid, 1)` at
packages/core/src/game/trap.ts:744-750. The immediate landing half remains
`hitTrap(grid, 0)` at :752-755.

No in-level player movement path examined bypasses the landing hook. Ordinary
walk uses player-turn.ts:481-489; melee movement uses effect-melee.ts:322-324
and :397-399; terrain displacement uses effect-terrain.ts:640-642; teleport
movement uses effect-teleport.ts:197-204 plus its player post-move calls; and
force/thrust uses the callbacks above. Level-entry placement assignments are
level transitions or spawn placement, not in-level movement.

2. Duplicate trap-safety resolution: APPROVE

The single C-faithful predicate is packages/core/src/game/trap.ts:86-95,
`playerIsTrapsafe`. It checks timed `TMD.TRAPSAFE`, derived
`OF.TRAP_IMMUNE`, and the equipped objects' `OF.TRAP_IMMUNE` flags.

The former timed-only helpers are gone. `game/player-path.ts:43-50` imports
the canonical function and its callers use it at :226, :362, :570, :615, and
:714. `game/chest.ts:37` imports the same function and uses it at :264 and
:336. The cave command path imports it at
packages/core/src/game/cave-cmd.ts:56-64 and aliases only that function at
:635-637; the session wires that same function at
packages/core/src/session/game.ts:1447-1448. These are routing closures, not
timed-only copies.

Trap activation has one live `playerHasFlag` closure at
packages/core/src/session/game.ts:1372-1374. It supplies derived/equipment
flags to the trap environment, while `hitTrap` retains the C-shaped timed OR
`playerHasFlag(OF.TRAP_IMMUNE)` check and the same hook for arbitrary trap save
flags. The only other `playerHasFlag` occurrence is a test stub. The flagged
duplicates at player-path.ts:59, chest.ts:84, cave-cmd.ts:634-638, and the
old session fallback are therefore gone as divergent implementations.

3. WALL-flag carry-over: APPROVE

(a) The oracle does exactly the claimed conditional clear. Reference
`src/cave-square.c:1255-1268` clears WALL_INNER, WALL_OUTER, and WALL_SOLID in
the `else` branch of `if (character_dungeon)`, and does not clear them in the
live branch. The port implements the same generation/live split through the
chunk hook discriminator: packages/core/src/world/chunk.ts:227-237 leaves
the live `onFeatSet` branch intact and clears all three flags when the hook is
absent. Generation chunks are created without the hook; the live session
installs it at trap.ts:202-210 and session/game.ts:1383-1384, and reinstalls it
after every live chunk replacement at session/game.ts:1841, :1887, :1990,
and :2123. This matches the intended `character_dungeon` condition in the
port's architecture.

The end-of-builder sweep remains at packages/core/src/gen/generate.ts:233-243,
matching reference/src/generate.c:1193-1201 for flags that were explicitly
marked and were not later overwritten by setFeat.

(b) Moving `makeDeps()` inside the seed loop is a legitimate test-isolation
fix, not a weakened assertion. Before R3, gen.test.ts:346 created one shared
dependency graph and reused it for every independent seed. `makeDeps()` owns
mutable `ArtifactState`, object allocation state, and a fresh monster registry
whose races carry `curNum`; those values can affect mid-generation object and
monster placement. R3 constructs fresh dependencies at gen.test.ts:375-383
for each seed while retaining the same depths, seed values, loop counts, and
assertions at :385-390. In particular, the down-stair reachability assertion
was not removed or weakened.

(c) The mid-generation setFeat clear adds no RNG draw. The new code at
world/chunk.ts:230-237 only calls FlagSet.off for the three flags; it does not
read or call the RNG. The test-only makeDeps move also has no RNG call. Any
layout difference for a fixed seed can therefore only come from correcting a
generator predicate that previously read a stale WALL flag, which is the
intended semantic correction; no draw is added, removed, or reordered.

(d) The replacement comments are accurate. The chunk comment at
world/chunk.ts:209-215 describes the live hook, generation clear, and final
sweep. The test comment at gen.test.ts:375-382 accurately identifies mutable
cross-trial state and the seed-15004 consequence. The helper ordering comment
at world/chunk.ts:231-234 also matches setMarkedGranite/fillRectangle, which
call setFeat before generateMark.

4. Test, RNG, and scope checks

No test was relaxed. The only removed assertion in the R3 diff was:
`expect(disarmAux(state, loc(6, 5), d)).toBeDefined(); // aux itself works`
It was replaced by the live visibility-guard assertions that the trap is
invisible, remains present, consumes zero energy, and emits the refusal
message. The generation test changed dependency lifetime only; its assertions
remain unchanged.

No R3 production change adds, removes, or reorders an RNG draw in the reviewed
paths. Focused verification passed: 4 test files, 114 tests. `pnpm typecheck`
also passed.

Per-item verdicts:
1. APPROVE - TRF_DELAY landing and leaving movement hooks.
2. APPROVE - duplicate trap-safety resolution.
3. APPROVE - WALL-flag carry-over and isolated connectivity trials.

