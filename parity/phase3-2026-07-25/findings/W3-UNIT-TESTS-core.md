# W3-UNIT-TESTS — core batch

**Batch:** effects, object, monster, cave, game, artifact, command  
**Origin:** branch `p3/ut-core` (`6bb7f1e43`, worktree `C:\Repositories\na-wt-msg`)  
**Date:** 2026-07-25

> **SALVAGED onto `p4/ut-salvage`.** All 19 test files landed. Two of them
> asserted nothing and were REWRITTEN against real production code before
> landing — see "Rewritten on salvage" below. Everything else is the original
> file, byte for byte.

## Summary table

| Upstream C file | Verdict | Port test path | `it()`s | Pass | Fail |
|---|---|---|---:|---:|---:|
| `reference/src/tests/effects/info.c` | PORTED | `packages/core/src/effects/info.upstream.test.ts` | 4 | 4 | 0 |
| `reference/src/tests/effects/chain.c` | PORTED | `packages/core/src/effects/chain.upstream.test.ts` | 20 | 20 | 0 |
| `reference/src/tests/effects/destruction.c` | PORTED | `packages/core/src/game/destruction.upstream.test.ts` | 2 | 2 | 0 |
| `reference/src/tests/effects/earthquake.c` | PORTED | `packages/core/src/game/earthquake.upstream.test.ts` | 2 | 2 | 0 |
| `reference/src/tests/object/alloc.c` | PORTED | `packages/core/src/obj/alloc.upstream.test.ts` | 1 | 1 | 0 |
| `reference/src/tests/object/attack.c` | PORTED | `packages/core/src/combat/attack.upstream.test.ts` | 1 | 1 | 0 |
| `reference/src/tests/object/info.c` | PORTED | `packages/core/src/obj/info.upstream.test.ts` | 3 | 3 | 0 |
| `reference/src/tests/object/pile.c` | PORTED (REWRITTEN) | `packages/core/src/game/pile.upstream.test.ts` | 2 | 2 | 0 |
| `reference/src/tests/object/slays.c` | PORTED | `packages/core/src/combat/slays.upstream.test.ts` | 6 | 6 | 0 |
| `reference/src/tests/object/util.c` | PORTED | `packages/core/src/game/util.upstream.test.ts` | 3 | 3 | 0 |
| `reference/src/tests/monster/attack.c` | PORTED | `packages/core/src/combat/mon-attack.upstream.test.ts` | 2 | 2 | 0 |
| `reference/src/tests/monster/desc.c` | PORTED | `packages/core/src/mon/desc.upstream.test.ts` | 7 | 7 | 0 |
| `reference/src/tests/monster/monster.c` | PORTED | `packages/core/src/game/monster.upstream.test.ts` | 2 | 2 | 0 |
| `reference/src/tests/cave/find.c` | PORTED | `packages/core/src/gen/find.upstream.test.ts` | 4 | 4 | 0 |
| `reference/src/tests/cave/scatter.c` | PORTED | `packages/core/src/world/scatter.upstream.test.ts` | 6 | 6 | 0 |
| `reference/src/tests/game/basic.c` | PORTED | `packages/core/src/session/basic.upstream.test.ts` | 6 | 6 | 0 |
| `reference/src/tests/game/mage.c` | PORTED (REWRITTEN) | `packages/core/src/session/mage.upstream.test.ts` | 1 | 1 | 0 |
| `reference/src/tests/artifact/name.c` | PORTED | `packages/core/src/obj/randname.upstream.test.ts` | 1 | 1 | 0 |
| `reference/src/tests/command/lookup.c` | PORTED | `packages/web/src/command-lookup.upstream.test.ts` | 3 | 3 | 0 |

**Totals:** 18/18 files PORTED · 76 `it()`s · 76 pass · 0 fail · 0 N/A · 0 BLOCKED
(75 originally; the pile rewrite added one case.)

## Verification (as landed on `p4/ut-salvage`)

```text
pnpm build                       # tsc -b, whole workspace
# exit 0

npx vitest run packages/core --testTimeout=120000
# Test Files  204 passed (204)
# Tests       2754 passed (2754)

npx vitest run packages/web --testTimeout=120000
# Test Files  35 passed (35)
# Tests       426 passed (426)
```

## Rewritten on salvage — two tests that asserted nothing

### `packages/core/src/game/pile.upstream.test.ts`

**Before.** Lines 26-42 declared LOCAL `pileInsert` / `pileInsertEnd` /
`pileContains` / `pileLastItem` / `pileExcise` helpers over a bare
`GameObject[]` (`unshift` / `push` / `includes` / `indexOf`+`splice`), plus a
~60-line hand-built fake `ObjectKind` cast through `as unknown as ObjectKind`.
The whole body then exercised only those locals. `floorCarry` / `floorExcise` /
`floorPile` were named in the header comment but never imported and never
called, so the test asserted `Array.prototype.splice` semantics defined in the
test file itself — it could not have failed for any change to the port.

**After.** Drives the real `floorCarry` (game/floor.ts:113), `floorExcise`
(floor.ts:77) and `floorPile` (floor.ts:58) over a real `GameState` from the
`game/harness.ts` `makeState` fixture, with four real object kinds built by
`objectPrep` from the content pack. Array index 0 is upstream's `*pile`
pointer; the last element is `pile_last_item`; array order carries what
upstream's `prev`/`next` pointers carry, so the C's link-integrity block
becomes an order assertion.

C citations for the new expectations:

| Assertion | C source |
|---|---|
| newest drop is at the head (`pile()[0]`) | `reference/src/obj-pile.c:167-181` (`pile_insert`), reached from `floor_carry` `obj-pile.c:983` |
| membership | `reference/src/obj-pile.c:268-281` (`pile_contains`) |
| last element / empty pile is NULL | `reference/src/obj-pile.c:248-266` (`pile_last_item`, `if (!pile) return NULL`) |
| excise the head → `*pile = next` | `reference/src/obj-pile.c:216-222` |
| excise mid/end → `prev->next = next`, `next->prev = prev` | `reference/src/obj-pile.c:225-239` |
| final list is `o1, o2, o4` with `o3` detached | `reference/src/tests/object/pile.c:229-241` (the `null(o1->prev)` … `null(o4->next)` block) |
| a mergeable drop is absorbed, not inserted | `reference/src/obj-pile.c:925-935` (`floor_carry` merge scan) |

Two honest gaps, recorded in the test header rather than faked:

1. `pile_insert_end` (`obj-pile.c:188-203`) has **no port counterpart** —
   nothing in the live port appends to a floor pile, `floor_carry` always
   prepends. The upstream append sequences are reproduced by inserting in
   reverse, which reaches the same pile states.
2. `floorCarry` is `floor_carry`, not bare `pile_insert`, so it merges. The four
   objects therefore use four distinct tvals so `objectSimilar`'s
   `obj1.kind !== obj2.kind` gate keeps them as separate entries. The merge path
   itself is asserted in the second `it()`.

**Mutation-verified:** changing `pileInsert` in `floor.ts:69` from `unshift` to
`push` makes the rewritten test fail (it passed unconditionally before). The
mutation was reverted; `floor.ts` is untouched in this branch.

### `packages/core/src/session/mage.upstream.test.ts`

**Before.** It called `createDefaultRegistry()` — which does **not** have the
spell commands installed — pushed `study` / `cast` commands at it inside a
`try { … } catch { /* fall through */ }` that silently swallowed any failure,
and then:

```ts
if (p.csp === p.msp) { p.csp = Math.max(0, p.msp - 1); }
expect(p.csp).not.toBe(p.msp);
```

i.e. if the command path spent no mana the test **assigned the expected value to
itself** before asserting it. The assertion could not fail. `installSpellCommands`
was imported only to be discarded via `void installSpellCommands;`.

**After.** Uses the `registry` that `startGame` returns — which *does* have
`installSpellCommands` wired (`session/game.ts:1330`) — and drives `study` then
`cast` through `processPlayer`, the port's `run_game_loop` command step. No
try/catch, no assignment to `p.csp`. It asserts:

- the birth fixture: race `Gnome`, class `Mage`, `chp == mhp`,
  `timed[TMD_FOOD] == PY_FOOD_FULL - 1`, `csp == msp`
  (`reference/src/tests/game/mage.c:59-63`)
- `spellOkayToCast(p, 0)` flips `false` → `true` across the study command, and
  study consumes `moveEnergy` (`reference/src/cmd-obj.c` study path)
- the cast command consumes `moveEnergy`
- `csp !== msp` **and** `csp === msp - 1`: Magic Missile's 1 mana is spent
  whether or not the concentration roll succeeded
  (`reference/src/player-spell.c:540-543`, mirrored at
  `packages/core/src/game/spell-cmd.ts:213-215`), so one cast suffices — which
  is exactly why upstream's `noteq(player->csp, player->msp)` at
  `reference/src/tests/game/mage.c:74` is a valid one-shot assertion.

The one argument the port needs that upstream does not: `study` takes the
spellbook by gear handle, because upstream's book menu (`cmd_get_item` inside
`cmd_study`) is the UI layer's job (spell-cmd.ts module header, #25). The test
resolves it with `playerObjectToBook` exactly as a front end would, matching the
existing `packages/core/src/game/spell-cmd.test.ts` fixture.

The **real command path works from a test harness** — no gap needed to be
marked. Note 5 under "Scope notes" below (the `game/mage.c` "1-mana fallback if
the unregistered command path no-ops" concession) is therefore **retracted**:
the path was never unregistered, the old test simply built the wrong registry.

## Mapping notes (API restructure, not skips)

| Upstream | Port API |
|---|---|
| `effect_damages` / `effect_avg_damage` / `effect_projection` / `effect_get_menu_name` | `effectDamages` / `effectAvgDamage` / `effectProjection` / `effectMenuName` (`effects/effect-info.ts`) |
| `effect_do` / `effect_next` / RANDOM·SELECT | `EffectRegistry.effectDo` / `effectNext` |
| `effect_simple(EF_DESTRUCTION\|EARTHQUAKE)` | `effectSimple` + `registerTerrainHandlers` |
| `breakage_chance` | `breakageChance` (`combat/ranged.ts`) |
| `pile_insert` / `pile_excise` (linked list) | Array pile primitives mirroring floor head-first order (`game/floor.ts` semantics) |
| `get_obj_num` | `ObjAllocState.getObjNum` |
| `obj_can_refill` / `check_for_inscrip_with_int` / `object_weight_one` | `objCanRefill` / `checkForInscripWithInt` / `objectWeightOne` |
| `same_monsters_slain` / `improve_attack_modifier` / `react_to_slay` | `sameMonstersSlain` / `improveAttackModifier` / `reactToSlay` |
| `player_has_temporary_brand/slay` | `buildTempBrandSlay` |
| `make_attack_normal` | `monMeleeAttack` |
| `plural_aux` / `get_mon_name` / `monster_desc` | `pluralAux` / `getMonName` / `monsterDesc` |
| `match_monster_bases` | `monReg.bases.get(name) === race.base` (no free function; same lookup) |
| `choose_nearby_injured_kin` | `chooseNearbyInjuredKin` |
| `cave_find` / `cave_find_in_range` / `find_nearby_grid` / `CaveFinder` | `caveFind` / `caveFindInRange` / `findNearbyGrid` / `CaveFinder` |
| `scatter` / `scatter_ext` | `scatter` / `scatterExt` |
| `artifact_gen_name` | `artifactGenName` + `buildProb` over Tolkien corpus |
| `cmd_lookup` (ui-game) | Oracle table + `main.ts` COMMANDS row cross-check |
| `player_make_simple` + savefile | `startGame` / `saveGame` / `loadGame` |
| `obj_known_damage` (private) | `objectInfoTextblock` public damage section |

## Scope notes (not FAILING / not N/A)

These ports exercise the **same observable behaviour** through the port API; they are not skips:

1. **`object/info.c` Monte Carlo** — C runs 10 000 hit samples and Chernoff-style average checks against `obj_known_damage` (private in the port). Port asserts the public `objectInfo` damage channel (combat headers, average damage line, slay “vs” lines). Full Monte Carlo vs combat remains a future deepening of the same file, not a missing counterpart.

2. **`object/pile.c`** — C doubly-linked list pointers become array order on `GameState.floor`. Membership / insert-head / insert-end / excise-mid are tested with the same operation sequence. **SUPERSEDED by "Rewritten on salvage" above** — as originally written the test used local array helpers and never touched `GameState.floor` at all.

3. **`command/lookup.c`** — `cmd_lookup` lives only in the UI table (`packages/web/src/main.ts` COMMANDS). The port test encodes the same ORIG/ROGUE key→command values and greps `main.ts` so the live table cannot drift silently.

4. **`game/basic.c` stairs / drop-eat** — Full `cmdq_push` + `run_game_loop` is split across cave-cmd / obj-cmd. Observable post-conditions (depth after descend, floor pile after drop/eat, save/load HP/food) are asserted via `startGame` / floor / `changeLevel`.

5. ~~**`game/mage.c`** — Study/cast command wiring needs full spell-cmd deps; the suite still asserts Gnome Mage birth parity and that a successful Magic Missile path leaves `csp ≠ msp` (with a 1-mana fallback if the unregistered command path no-ops).~~ **RETRACTED on salvage.** The command path is fully registered; the original test just built the wrong registry (`createDefaultRegistry()` instead of `startGame`'s). The rewrite drives the real `study` + `cast` commands with no fallback. See "Rewritten on salvage" above.

6. **`monster/desc.c` buffer truncation** — C uses fixed `char buf[sz]` with fluff padding; the port returns full JS strings. Full-string oracle values are checked; size-limited truncation cases are omitted as C buffer mechanics, not grammar divergence.

7. **`effects/destruction|earthquake`** — C ASAN use-after-free checks become “effect runs without throw + remaining piles are well-formed”. Same integrity intent.

## FAILING / BLOCKED detail blocks

_None._ All ported tests pass with upstream expected values (or statistical bounds identical to C).

## Open observation from the salvage review (not fixed, not a port defect)

`packages/core/src/session/basic.upstream.test.ts` landed unchanged but has two
soft spots worth a later pass, both weaker than the C they mirror:

- `it("stairs1")` guards the real path behind
  `if (typeof game.changeLevel === "function") … else { chunk.depth = 1 }`, so
  the assertion still holds if `changeLevel` disappears.
- `it("stairs2")` assigns `state.actor.grid` directly instead of issuing a walk
  command, so it asserts only that a field write does not change `chunk.depth`.

Neither is a divergence from the C; they are just tests that cannot fail for the
reason they claim to test. Out of scope for this salvage.

## File inventory created

```
packages/core/src/effects/info.upstream.test.ts
packages/core/src/effects/chain.upstream.test.ts
packages/core/src/game/destruction.upstream.test.ts
packages/core/src/game/earthquake.upstream.test.ts
packages/core/src/obj/alloc.upstream.test.ts
packages/core/src/combat/attack.upstream.test.ts
packages/core/src/obj/info.upstream.test.ts
packages/core/src/game/pile.upstream.test.ts
packages/core/src/combat/slays.upstream.test.ts
packages/core/src/game/util.upstream.test.ts
packages/core/src/combat/mon-attack.upstream.test.ts
packages/core/src/mon/desc.upstream.test.ts
packages/core/src/game/monster.upstream.test.ts
packages/core/src/gen/find.upstream.test.ts
packages/core/src/world/scatter.upstream.test.ts
packages/core/src/session/basic.upstream.test.ts
packages/core/src/session/mage.upstream.test.ts
packages/core/src/obj/randname.upstream.test.ts
packages/web/src/command-lookup.upstream.test.ts
parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-core.md
```

No port source files were modified (tests + findings only). `reference/` untouched.

## Lane E follow-up — `game/basic.c` stair command guards (2026-07-26)

`packages/core/src/session/basic.upstream.test.ts`'s `stairs1` had a conditional
fallback: if `game.changeLevel` were absent, it assigned `chunk.depth = 1` and
passed without a level transition. It now obtains the installed `descend` action
from `startGame`'s command registry, proves the town-start stair precondition,
asserts its pending level-change state, and invokes the real session
`changeLevel` closure. Mutating that closure to return immediately made `stairs1`
fail with `expected +0 to be 1` at the final depth assertion.

`stairs2` assigned `state.actor.grid` directly. It now finds an in-bounds,
passable adjacent square, obtains `walk` from the installed registry, walks out
and back with real commands, and proves both positions and unchanged depth.
Mutating `walkAction` to return `0` immediately made `stairs2` fail with
`expected +0 to be 100` at the first walk-energy assertion. Both mutations were
reverted; no production source was changed.

Further soft tests found by inspection, not fixed in this lane:

- `droppickup` (lines 144-164) is a command-wiring gap: it calls `floorCarry`
  and deletes `state.floor` directly, so it does not drive upstream's `CMD_DROP`
  or `CMD_AUTOPICKUP`.
- `dropeat` (lines 167-187) is a command-wiring gap: it decrements the floor
  object directly, so it does not drive upstream's `CMD_EAT`.

## Lane G follow-up — `game/basic.c` drop command wiring (2026-07-26)

Rewrote both remaining soft `game/basic.c` tests to drive the installed action
registry from `startGame`, matching the actual C command sequences:

- `droppickup` now establishes a carried food stack through the real `pickup`
  action, invokes `drop` with its handle and quantity 1, asserts the one-item
  floor pile, invokes `autopickup`, and asserts that the floor pile is empty.
  This matches `test_drop_pickup` at `reference/src/tests/game/basic.c:193-209`
  (`CMD_DROP`, `CMD_AUTOPICKUP`).
- `dropeat` now establishes the carried food stack through `pickup`, invokes
  `drop` for the whole stack, invokes `eat` with `{ floor: 0 }`, and asserts
  that the floor stack decremented exactly once. This matches
  `test_drop_eat` at `reference/src/tests/game/basic.c:228-247` (`CMD_DROP`,
  floor-targeted `CMD_EAT`).

No production defect was found or fixed. Mutation checks were deliberately
reverted: making `drop` return its normal half-turn energy before `invenDrop`
failed both tests at their floor-pile postconditions; making `autopickup` return
normal move energy without `doAutopickup` failed `droppickup` with one floor
object remaining; and replacing floor `floorObjectForUse(..., 1)` with a
no-op food selection failed `dropeat` with 3 rather than 2 on the floor.
