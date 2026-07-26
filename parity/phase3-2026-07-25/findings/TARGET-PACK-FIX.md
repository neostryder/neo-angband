# Target and pack parity verification

## Scope and result

Both reported gaps were already fixed on the assigned branch before this pass.
I re-derived each behavior from the C oracle and added a regression that proves
the target-loop search uses the cursor rather than the player.  No core behavior
change was needed.

## Item 1: target-panel nearest stairs

The C handles `>` and `<` in the interactive target loop, calls
`path_nearest_known(player, loc(x, y), ...)` with the **cursor** position, moves
the cursor to `new_grid`, adjusts the panel/list, and rings the bell when no
path is found: `reference/src/ui-target.c:1506-1542`.

The port matches that sequence in `stepTargetLoop`: it gets the current cursor
grid, calls `pathNearestKnown` with the downstairs/upstairs predicate, updates
only the cursor, and reports a bell on failure.  The web input handler forwards
every target-panel key to that function, then repaints and plays the bell when
requested: `packages/core/src/game/target-loop.ts:417-438` and
`packages/web/src/main.ts:3222-3229`.

The regression in `packages/core/src/game/w2-wiring-fix.test.ts` places the
player nearer one downstairs but the cursor nearer another.  `>` selects the
one nearer the cursor, as C requires.  It also asserts unchanged player grid
and RNG state.  This operation is pathfinding/UI navigation only; the C branch
contains no RNG call or command queue/energy operation
(`reference/src/ui-target.c:1506-1542`), so
the expected draw sequence is unchanged (zero draws before and after).

## Item 2: NULL pack-overflow victim

With a NULL `obj`, C scans `upkeep->inven[1..pack_size]` for its first NULL and
drops the preceding entry: `reference/src/obj-gear.c:1358-1366`.
That listing is rebuilt from unassigned gear by repeatedly choosing the object
for which `earlier_object(first, current, false)` holds, not by master-gear
insertion order: `reference/src/player-calcs.c:1184-1222`.
Thus the invariant is: immediately before `pack_overflow(NULL)`, the derived
inventory view must be current and sorted by `earlier_object`; its final handle
is the victim.

The port now has that separate derived view (`gear.inven`), rebuilt by
`calcInventory()` with `earlierObject` selection in `packages/core/src/game/gear.ts:641-649`.
`packOverflow(..., 0, ...)` chooses its final element rather than the raw
`gear.pack` tail (`packages/core/src/game/obj-cmd.ts:260-285`).  The live
per-turn catch-all rebuilds the view before calling the NULL branch
(`packages/core/src/session/game.ts:693-713`), matching the C's update-before-
overflow placement in `reference/src/game-world.c:941-947`.

Checked combine/wield callers:

- `invenWield()` calls `combinePack()`, which rebuilds `gear.inven` before its
  explicit displaced-object overflow; it never uses the NULL victim
  (`packages/core/src/game/obj-cmd.ts:332-382`).
- Registered `takeoff` calls `combinePack()`, likewise rebuilding the view,
  then explicitly overflows the removed handle (`packages/core/src/game/obj-cmd.ts:1479-1509`).
- `wieldAll()` is the other `wieldObject()` caller; it does not call
  `packOverflow`, and its caller materializes inventory after outfit setup
  (`packages/core/src/game/gear.ts:1034-1048`, `packages/core/src/session/game.ts:593-600`).
- The only NULL caller is the per-turn `state.overflowPack` path above; the
  invocation occurs before command preparation in `processPlayer`
  (`packages/core/src/game/player-turn.ts:681-688`).

The existing live `process_player` regression intentionally inserts a sword
first (raw order) but verifies the sorted-last sword is dropped, covering the
invariant (`packages/core/src/game/obj-cmd.test.ts:156-175`).  No new RNG is
introduced by sorting or choosing the handle; any RNG in the later `drop_near`
path remains the pre-existing C behavior.
