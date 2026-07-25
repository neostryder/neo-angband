TRAPS parity independent adversarial review
Date: 2026-07-25
Branch reviewed: parity/p1-traps
Base: parity/p1-rng

Overall verdict: ISSUE. The ordinary walk and level-transition paths contain
several real fixes, and the focused tests pass, but this is not yet C-faithful
as a whole. Delayed traps miss a live involuntary-movement path; disarming
misses the C no_light penalty; initial level-entry feeling suppression is not
covered; the non-persist town cache is not saved; generation WALL flag clearing
is explicitly deferred; and blind-forget remains undone. The supplied
TRAPS_FIX.diff is also a composite patch containing unrelated RNG, monster,
store, and web changes, contrary to the brief's ownership boundary.

1. TRF_DELAY live firing: ISSUE

The normal movePlayer path is correct: packages/core/src/game/context.ts:969-975
calls onPlayerLeaving after vacating the old square, and
packages/core/src/game/trap.ts:728-731 calls hitTrap(oldGrid, 1). This covers
ordinary walking and the teleport paths that use movePlayer.

It does not cover all live player movement. packages/core/src/game/thrust.ts:40-44
uses monsterSwap and then assigns actor.grid directly. The player swap path at
packages/core/src/game/thrust.ts:132-151 only conditionally calls
onPlayerPostMove after inspecting the old square; when the player is the source
occupant, the swap has moved the player to next but c.mon(grid) is no longer the
player, so even that post-move hook is skipped. It never calls onPlayerLeaving.
C monster_swap calls player_leaving for a player swap
(reference/src/mon-util.c:503-515 and the player branches below it). Thus a
force/thrust movement can miss both the landing post-move effects and a delayed
trap on the square being left. The direct movePlayer test in
packages/core/src/game/trap.test.ts does not cover this.

2. square_set_feat trap destruction: APPROVE

packages/core/src/game/trap.ts:184-196 implements the live onFeatSet hook and
destroys traps when squarePlayerTrapAllowed becomes false. The hook is installed
from the live session at packages/core/src/session/game.ts:1374-1375 and on
level replacement. This matches the character_dungeon branch of
reference/src/cave-square.c:1250-1268. Generation deliberately has a separate
flag path; that is reviewed under item 6.009.

3. Disarm-on-walk: ISSUE

The branch correctly gates the walk auto-disarm on a disarmable, known trap,
no monster, walk rather than jump, and live trapsafe state at
packages/core/src/game/cave-cmd.ts:691-702. The success/failure/activation
messages at packages/core/src/game/trap.ts:685-696 match C
(reference/src/cmd-cave.c:788-900), and the two randint0(100) checks are in the
right order.

However, packages/core/src/game/trap.ts:670-678 penalizes blind, confused, and
hallucination but omits C's no_light(player) penalty. In C,
reference/src/cmd-cave.c:807-810 includes no_light, which is based on whether
the player square is seen (reference/src/cave-view.c:914-917). A player in
darkness but not TMD_BLIND therefore gets a different skill and RNG outcome.
The existing noLight helper in packages/core/src/game/cave-cmd.ts:316 is not
used by disarmAux.

There is a related decision-order issue in the same wrapper: the closed-door
branch at packages/core/src/game/cave-cmd.ts:625-640 runs before the trap branch
and has no squareIsKnown guard, whereas C's combined move_player condition at
reference/src/cmd-cave.c:1081-1088 requires square_isknown for both the known
trap and door cases.

4. only_partial feeling guard: ISSUE

The condition itself is correct. packages/core/src/world/view.ts:469-475
suppresses the feeling event exactly at the feeling_need crossing when
chunk.onlyPartial is true, matching reference/src/cave-view.c:840-855.
The normal changeLevel fresh-generation path sets the flag around updateFov at
packages/core/src/session/game.ts:2140-2142, and the persistent restore path
does the same at 2007-2009. Those are live paths.

The initial birth level-entry path is not covered. It populates and illuminates
the level at packages/core/src/session/game.ts:2485-2506 and returns without an
onlyPartial section; the first live FOV is then built at packages/web/src/main.ts:
5845. C's new-level display sets only_partial for the initial new-level display
too (reference/src/ui-display.c:2480-2522, reached by the new-level flow in
reference/src/game-world.c). So the patch has the right guard and two right
transition call sites, but not every live level-entry path.

5. Town terrain store/restore and draw counts: ISSUE

The in-memory plumbing is sound. Leaving depth 0 stores terrain with
chunkWriteTerrain at packages/core/src/session/game.ts:1921-1924; re-entry
passes it as townLayout at 2019-2020; and packages/core/src/gen/cave.ts:2558-2629
copies terrain/sqinfo, finds the stair, illuminates, and places residents as
C town_gen does. chunkWriteTerrain has no RNG calls, and the stored re-entry
path does not rerun townGenLayout, so this does not add a layout draw.

The persistence is incomplete. GameState has townChunk at
packages/core/src/game/context.ts:553-557, but SavedGame and serializeGame in
packages/core/src/session/save.ts:820-1090 have no townChunk field, and the
load construction at packages/core/src/session/game.ts:2924-3030 does not
restore one. C wr_chunks saves the Town chunk even when birth_levels_persist is
off. Saving in the dungeon after leaving town therefore loses the cached town;
later town entry generates a new layout and consumes a different RNG stream.
This violates both stored/restored terrain and seed parity across a save
boundary.

6. L9 sweep

001 tryDoor placeTrap: APPROVE. packages/core/src/gen/cave.ts:610-620 calls
placeTrap on the trap branch, and packages/core/src/gen/util.ts:1176-1197
performs the C pick_trap and power roll. This is present in the branch base and
must not be duplicated by the trap patch.

004 trap OF/immune via live trapDeps: APPROVE. The live env at
packages/core/src/session/game.ts:1360-1372 derives playerHasFlag from the
live player flags and wires disturb. hitTrap consumes it at
packages/core/src/game/trap.ts:457-476. This is C-faithful to
reference/src/trap.c:511-539.

008 web clear before confuse-dir: APPROVE. Both walk and jump clear a standing
web before confusion at packages/core/src/game/player-turn.ts:383-399. The
wrapper has a matching guard at packages/core/src/game/cave-cmd.ts:645-654.
The player-turn location is the cleaner C ownership point; the wrapper copy is
redundant and is discussed under item 8.

009 mid-generation WALL clear: ISSUE. packages/core/src/world/chunk.ts:211-231
does not clear WALL_INNER, WALL_OUTER, or WALL_SOLID in setFeat during
generation; it defers all clearing to packages/core/src/gen/generate.ts:228-236
after the builder succeeds. C clears these flags immediately in the
non-character_dungeon branch of reference/src/cave-square.c:1263-1268.
The seed 15004 connectivity regression is evidence that a mid-generation
predicate observes the stale flags, not evidence that the C behavior is safe to
defer. End-of-builder cleanup leaves a real mid-builder divergence and can
change generation decisions or connectivity.

010 trap disturb wiring: APPROVE. hitTrap calls env.disturb before effects at
packages/core/src/game/trap.ts:469, and the live env supplies disturb at
packages/core/src/session/game.ts:1372. This matches reference/src/trap.c:525-526.

012 secret-door mineral handling: APPROVE. packages/core/src/world/chunk.ts:
325-334 defines rock as granite while excluding DOOR_ANY, and mineral wall as
magma, quartz, or that rock. This matches the C is_rock/is_mineral_wall
decision and does not classify secret doors as mineral walls.

013 squareIsWarded: APPROVE. packages/core/src/game/trap.ts:158-166 checks the
specific glyph-of-warding trap kind, not merely a glyph/decoy marker. This
matches reference/src/cave-square.c:751-755.

014 hitTrap after removal/death: APPROVE. The post-effect checks at
packages/core/src/game/trap.ts:504-509 stop processing when the square has no
traps or the player is dead, matching the C breaks in reference/src/trap.c.

015 monster light: APPROVE as a scope decision, but the divergence is real.
The skipped item is not implemented: packages/web/src/main.ts:4119-4122 passes
an empty light-source list to updateView. It is reasonably out of scope under
the brief's web/main ownership boundary, but it is not a parity fix.

016 blind forget: ISSUE. It is explicitly not done. packages/core/src/world/
view.ts:464-480 clears SEEN/CLOSE_PLAYER for blind view updates but does not
perform the C blind forget of the current non-passable square. This remains a
live divergence and is not made harmless by the other FOV changes.

017 hallucination map rendering: APPROVE as a scope decision, but the
divergence is real. The web renderer remains outside this patch's intended
ownership and no hallucination rendering correction is present in the live
web path. It should not be reported as fixed.

7. Seed parity and draw audit: APPROVE for the trap generation order, with
scope caveats

The trap-relevant draw sequence is:

  * tryDoor always makes the C-equivalent randint0(100) door test; if that
    fails, it makes the randint0(500) trap test, in packages/core/src/gen/cave.ts:
    616-620.
  * On the trap branch, placeTrap makes exactly one pick_trap randint0 over
    cumulative rarity and one randomized randcalc power roll, in
    packages/core/src/gen/util.ts:1186-1195. These are the C draws and are
    already present in parity/p1-rng; the current trap-side populate path must
    not pick again.
  * populateFromLevel consumes the recorded tidx/power descriptors, so there
    is no second trap kind or power draw during live population.
  * town terrain copying in gen/cave.ts:2558-2591, setFeat/onFeatSet in
    world/chunk.ts, and onlyPartial FOV handling have no RNG calls. Stored town
    re-entry adds only the resident placement draws that C town_gen performs;
    it does not redraw the town layout.
  * Disarm attempts add the two conditional randint0(100) checks at
    packages/core/src/game/trap.ts:685-692. These are command-time C draws,
    not generation draws.

I found no trap-related draw added, removed, or reordered in gen/generate.ts or
world/chunk.ts. The supplied TRAPS_FIX.diff nevertheless includes unrelated
mon-vs-mon, birth RNG, store-hint, and web/display changes. Those are outside
the trap accounting and should not be attributed to this patch; their presence
also makes the supplied diff non-isolated.

8. Shared-file overlap and adjacent ownership: ISSUE

The shared session wiring is substantively correct: playerHasFlag and disturb
are live, caveDeps receives trapDeps/isTrapsafe, installChunkFeatHook is used,
townChunk is threaded, and onlyPartial is set on the two normal changeLevel
branches. The implementation is nevertheless not cleanly isolated.

The web-before-confuse fix is duplicated in player-turn.ts:383-399 and
cave-cmd.ts:645-654. The player-turn implementation is more C-faithful as the
do_cmd_walk/do_cmd_jump action boundary; the wrapper copy risks double handling
if either layer changes. The live trapsafe/OF wiring in session/game.ts is the
more faithful implementation because it derives from the current player state
and is consumed inside hitTrap.

More seriously, TRAPS_FIX.diff contains unrelated paths including
packages/core/src/game/mon-cmd.ts, packages/core/src/store/store.ts,
packages/core/src/session/boot.ts, and multiple packages/web files. Those
changes overlap other streams and violate the brief's stated adjacent-file
ownership. Review this branch as a composite patch, not as a clean traps-only
change.

9. Tests: APPROVE, but coverage is incomplete and one assertion is suspicious

The +41 trap tests add meaningful C-aligned assertions: delayed versus
immediate timing, trap destruction on granite, and exact glyph warding versus a
decoy. The +22 FOV tests assert suppression while onlyPartial is set. These
are positive parity assertions, not relaxations, and the focused suites pass.

Suspicious: packages/core/src/game/trap.test.ts contains the test named
"an invisible trap cannot be disarmed" but asserts only
expect(disarmAux(...)).toBeDefined(). That calls the low-level helper directly
and does not assert the live installTraps visibility guard or any disarm result;
the name overstates what is tested. The suite also lacks tests for thrust
leaving a delayed trap, the no_light penalty, auto-disarm-on-walk itself,
initial onlyPartial birth entry, town save/load, and immediate WALL flag
clearing.

Verification performed:

  pnpm typecheck                                  PASS
  pnpm vitest run core gen/world                  175 tests PASS
  pnpm vitest run core game/session               1205 tests PASS
  pnpm vitest run packages/web                   418 tests PASS
  focused trap and FOV files                     26 tests PASS

Passing tests do not change the ISSUE verdict because the missing paths above
are not covered by the added assertions.
