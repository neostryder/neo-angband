# Independent P0 parity review

Overall verdict: ISSUE: P0-2 has a fail-table ordering and monster-learning
parity defect. P0-3 and P0-4 also retain incorrect Home result messages. The
core transaction routing, quest wiring, and P0-1 sleep behavior are otherwise
correct. No GlyphTerm coupling was introduced.

P0-1: APPROVE

The port checks paralysis and the Knocked Out stun grade before selecting a
command, appends a sleep command, and the sleep action returns moveEnergy. This
matches game-world.c:965-968 and cmd-cave.c:1675-1679. Appending preserves the
C queue behavior when a command is already pending; the queued command is not
replaced or reordered. The path performs no RNG draw, uses no renderer, and
does not reimplement a status transition. The only edge is that a deliberately
partial/headless GameState with no world.timedTable cannot recognize Knocked
Out; the live session supplies that table.

P0-2: ISSUE: packages/core/src/player/timed.ts:240 and packages/content/pack/player_timed.json:203-211 preserve source order, but C prepends fail records at reference/src/player-timed.c:235-239. Therefore C checks OPP_POIS before POIS, while the port checks POIS first. If both protections are active, the port calls equipLearnElement(POIS) before returning; C returns on OPP_POIS and does not make that learn call. This is a behavior/control-flow mismatch on the newly active incCheck path.

The new hook correctly reuses playerIncTimed/playerIncCheck and wires object
learn, element learn, smart learn, and the monster resist message. The fail
check itself has no RNG draw, and the smart-learn draws it does make are in the
C check position. However, the port still does not perform the separate
post-increase update_smart_learn(context->mon, ..., of_flag, 0, -1) from
reference/src/mon-blows.c:548-555. The melee port cases call incTimed but have
no equivalent hook (for example packages/core/src/combat/mon-melee.ts:744-750).
That omits both learning and any associated RNG draws when birth_ai_learn is
enabled. No GlyphTerm coupling is present. Edge cases include poison with both
POIS and OPP_POIS, and all timed melee effects whose of_flag should teach the
attacking monster.

P0-3: ISSUE: packages/web/src/shop.ts:750 emits `You have ${bought}.`, which
does not match the C retrieve result. do_cmd_retrieve calls inven_carry with
message=true (reference/src/store.c:1840-1847); inven_carry reports the final
merged pack total and slot label (reference/src/obj-gear.c:893-920). The port
message omits the label and can report the pre-merge quantity/name. The core
route in packages/core/src/session/game.ts:2543-2554 is otherwise correct:
homeRetrieve is reused, price is zero, and no store origin, maintenance,
shuffle, or RNG draw is introduced. The UI has no renderer coupling.

P0-4: ISSUE: packages/web/src/shop.ts:813 emits `You drop ${name}.`, but C
do_cmd_stash describes the detached object and includes its gear label at
reference/src/store.c:2053-2070. Thus the live Home Drop path still diverges in
the result string, especially for partial stacks or equipped/quiver items.
The core gear route at packages/core/src/session/game.ts:2563-2585 correctly
reuses homeStash/homeCarry, accepts worthless objects, preserves pack stacking,
and avoids store value/note/fuel/timeout logic and RNG. The floor route at
2603-2618 performs the matching room check before detaching and calls
homeCarry. No GlyphTerm coupling is present.

P0-5: APPROVE

Adding quest records at packages/web/src/pack.ts:385 reaches bindCore's existing
bindQuests path. The existing birth call at packages/core/src/session/game.ts:2285-2288
copies the bound quests to the player, and the existing kill seam at
packages/core/src/session/game.ts:775-780 calls questCheck. questCheck preserves
the C ordering and sets totalWinner on the last guardian at
packages/core/src/game/quest.ts:178-203. Loading the quest table is data wiring
only: it adds no RNG draws, does not reimplement quest logic, and has no
renderer dependency. Partial non-web packs may still intentionally omit quests
because CorePack.quest is optional; the web pack now supplies it.

Test evidence: targeted core tests passed (63 tests across player-turn, store
transactions, quest, and session game); packages/web/src/shop.test.ts passed
(12 tests); pnpm typecheck passed.
