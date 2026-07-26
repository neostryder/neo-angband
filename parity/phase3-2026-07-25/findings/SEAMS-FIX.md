# SEAMS review — 2026-07-26

## Scope and result

All three reported items were re-derived from the read-only C oracle before
making any change.  No production change is warranted: item 1's proposed
pending-death seam is based on a false premise; item 2 is an already-modelled
core-state rule with a separate display integration concern; and item 3's live
utility callers and upstream unit coverage are already present in this branch.

## Item 1 — effect chains after death

**Verdict: report premise is false; no seam and no code change.**

`effect_do()` invokes a handler, copies its `ident` result, and unconditionally
advances through the remaining selected links.  It has no `is_dead` check or
early return after handler dispatch: [reference/src/effects.c:505-511](../../../reference/src/effects.c#L505-L511).
The only early returns in the relevant control path are invalid effects and an
abandoned `EF_SELECT`, not player death: [reference/src/effects.c:398-400](../../../reference/src/effects.c#L398-L400),
[reference/src/effects.c:437-461](../../../reference/src/effects.c#L437-L461).

Death is final inside `take_hit()` only for *subsequent damage applications*:
it first returns when `p->is_dead` is already set
([reference/src/player-util.c:204](../../../reference/src/player-util.c#L204)),
but it sets that flag only after emitting the death message
([reference/src/player-util.c:249-261](../../../reference/src/player-util.c#L249-L261)).
Consequently, a remaining non-damage effect handler still executes; a later
damage handler reaches `take_hit()` and is a no-op.  This is the C wart to keep.

The TypeScript interpreter already has the same chain shape: it calls the
handler then consumes the remaining links without inspecting player state in
`packages/core/src/effects/interpreter.ts:505-511`.  Its game-backed damage
path routes later hits through `takeHit()`, whose initial `isDead` guard is the
same C rule in `packages/core/src/player/take-hit.ts:132-133`.  Adding a
`pendingDead` predicate (including the related melee `willPlayerDie` pattern)
would incorrectly abandon C-visible non-damage tail effects.  No test was added
because the existing interpreter chain tests cover the precise walker; the
oracle establishes that death is not a control-flow return point.

## Item 2 — timed known-state presentation

**Verdict: no core arithmetic/state divergence; this is presentation and the
separate `known_state` lore seam, not a new timed-state seam.**

For normal timed changes, C consults `p->obj_k` only to suppress an otherwise
redundant notification for a known immunity or known worn-gear synonym; it does
not alter the timer: [reference/src/player-timed.c:828-843](../../../reference/src/player-timed.c#L828-L843).
The port has that exact notification-only hook in
`packages/core/src/player/timed.ts:319-331`; its bound runtime retains the
actual `p.timed` value and then supplies it to the status display.

The different `known_state` paths occur solely in `player_inc_check(..., lore)`
for monster-recall knowledge.  C explicitly reads `known_state` in lore mode
([reference/src/player-timed.c:930-996](../../../reference/src/player-timed.c#L930-L996))
and explicitly says active timed effects are known, so that one case has no
lore/non-lore distinction ([reference/src/player-timed.c:1005-1015](../../../reference/src/player-timed.c#L1005-L1015)).
This cannot justify changing timed arithmetic or inventing a second timer
array.  The port's absent full `known_state` remains a display/recall ownership
seam; its current `objKnown` queries correctly cover the C notification rule.

## Item 3 — textblock and z-util

**Verdict: real callers exist and are already covered; no new dead API was
introduced.**

| C facility | Real port caller | Status |
| --- | --- | --- |
| `textblock_new`, `textblock_append`, `textblock_append_c` | object-info renderer (`packages/core/src/obj/object-info.ts:133-173`) | Ported as its live colored-run model; upstream behaviours are covered by `packages/core/src/obj/textblock.upstream.test.ts`. C uses the same textblock API for object descriptions: [reference/src/obj-info.c:78-87](../../../reference/src/obj-info.c#L78-L87). |
| `textblock_append_textblock`, `textblock_attrs` | object-info model/test support | Ported and covered; the C API's append/copy and per-character attributes are exactly the upstream test target: [reference/src/tests/z-textblock/textblock.c:83-101](../../../reference/src/tests/z-textblock/textblock.c#L83-L101). The C engine also uses append-textblock in effect/object descriptions: [reference/src/effects-info.c:242-296](../../../reference/src/effects-info.c#L242-L296), [reference/src/obj-info.c:2135](../../../reference/src/obj-info.c#L2135). |
| `mean`, `variance` | randart baseline statistics (`packages/core/src/obj/randart-data.ts:251-255`) | Ported in `packages/core/src/rational.ts` and covered by `rational.upstream.test.ts`; C calls them while storing base artifact power: [reference/src/obj-randart.c:278-282](../../../reference/src/obj-randart.c#L278-L282). |
| `my_rational_construct`, `my_rational_to_uint`, `my_rational_product`, `my_rational_sum` | object combat information (`packages/core/src/obj/object-info.ts:733-740`) and path/randart arithmetic | Ported in `packages/core/src/rational.ts` and covered by `rational.upstream.test.ts`; C's object-info caller includes the remainder-preserving conversion: [reference/src/obj-info.c:595-606](../../../reference/src/obj-info.c#L595-L606). |

The C unit suites define five textblock cases
([reference/src/tests/z-textblock/textblock.c:13-108](../../../reference/src/tests/z-textblock/textblock.c#L13-L108)),
six mean/variance cases
([reference/src/tests/z-util/meanvar.c:536-545](../../../reference/src/tests/z-util/meanvar.c#L536-L545)),
and four rational cases
([reference/src/tests/z-util/rational.c:8-151](../../../reference/src/tests/z-util/rational.c#L8-L151)).
Their TypeScript counterparts already exist and exercise the live utility
implementations, so treating them as absent/dead infrastructure would be
incorrect.  The terminal wrapping/file-output parts of C textblock are not
port APIs because the TypeScript model deliberately exposes renderer-neutral
colored runs; no real caller needs that C-only surface.

## Verification

`pnpm install --frozen-lockfile` and `pnpm -r build` both completed successfully.

The mandated `npx vitest run --exclude "**/borg/**"` was observed to fail;
this change did not alter executable code.  Its final summary was **286 passed,
2 failed, 1 skipped files; 5191 passed, 3 failed, 1 skipped tests**.  The three
failures were 5-second timeouts in
`packages/core/src/gen/gen.test.ts` (`generates valid levels across the deep
profile pool` and `still allows a greater vault as the second room when a
staircase room precedes it`) and
`packages/core/src/obj/alloc.upstream.test.ts` (`get_obj_num_basic`), followed
by Vitest's unhandled `Timeout calling "onTaskUpdate"` worker error.  No passing
baseline is claimed.
