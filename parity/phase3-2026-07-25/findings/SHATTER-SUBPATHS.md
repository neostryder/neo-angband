# SHATTER sub-path coverage, and one divergence found while closing it

Date: 2026-07-26
C oracle: `reference/src/mon-blows.c:1086-1115` (`melee_effect_handler_SHATTER`),
`reference/src/effect-handler-attack.c:1290-1352` (`effect_handler_EARTHQUAKE`),
`reference/src/project-mon.c:87` (`thrust_away`).
Tests: `packages/core/src/game/mon-cmd.test.ts`

## Why this existed

Codex approved the M-1 deps-parity proof for SHATTER but recorded that it holds
only for the one config it ran — damage 50, target surviving the initial hit,
radius 4 — and named the untested sub-paths: `thrust_away` firing vs not firing,
the target dying mid-blow, and radius variation. Its warning was that the
approval must not be read as exhaustive proof. That was right, and this closes it.

## What the C does, in order

```c
context->damage = adjust_dam_armor(context->damage, context->ac);   /* L1092 */
if (monster_damage_target(context, false)) return;                  /* L1095 */
if (context->damage > 23) {                                         /* L1097 */
    int radius = context->damage / 12;                              /* L1098 */
    effect_simple(EF_EARTHQUAKE, source_monster(...), "0", 0, radius, ...);
}
if ((context->damage > 100)) {                                      /* L1105 */
    int value = context->damage - 100;
    if (randint1(value) > 40) {                                     /* L1107 */
        int dist = 1 + value / 40;                                  /* L1108 */
        thrust_away(context->mon->grid, target->grid, dist);
    }
}
```

Two boundaries are worth pinning exactly, because the plausible mistake at each
shifts it by one:

- `radius = damage / 12` is **integer division**. 47 gives 3 and 48 gives 4;
  rounding would give 4 for both.
- `randint1(value) > 40` **cannot fire while `value <= 40`**, i.e. never below
  damage 141. Writing `>= 40` would make damage 140 knock back one time in forty.

## The observable

Damage is a poor probe for the quake, because the quake damages the target too.
Terrain memory is exact: the handler clears `SQUARE_ROOM` / `VAULT` / `GLOW` /
`SEEN` for **every** grid within the radius *before* the 85% per-grid skip
(`effect-handler-attack.c:1337-1352`, `effect-terrain.ts:552-557`). So the
cleared set is exactly `{g : distance(centre, g) <= r}` and the radius reads off
directly with no sampling and no seed sensitivity.

For knockback, the level is generated at **town depth**, where the C's
EF_EARTHQUAKE short-circuits with a message and no draws
(`effect-handler-attack.c:1319-1326`). That isolates `thrust_away` as the only
thing that can move the target, and the only thing that can consume RNG.

## Coverage added — 6 tests

| test | pins |
|---|---|
| quiet at 23, radius 2 at 24 | the `> 23` gate, both sides |
| radius is `damage/12` truncated | 24→2, 47→3, 48→4, 60→5, 120→10 |
| fatal blow yields neither quake nor knockback draw | the `return` at L1095, via RNG-state equality with a fatal HURT control |
| knockback cannot fire at or below 140 | `> 40`, swept over 40 seeds |
| knockback fires above 140 and pushes away | the roll IS consulted (both outcomes required), direction, and `1 + value/40` |
| the roll is taken above 100, skipped at 100 | the `> 100` gate, via RNG-state (in)equality against HURT controls |

The fatal-blow test is worth singling out: asserting "no earthquake happened"
would be satisfied by an implementation that ran the knockback roll anyway.
Comparing the full RNG state against a **fatal HURT blow at the same damage and
seed** — which returns at exactly the same point in the C — proves instead that
*zero* further draws were taken, which is what L1095 actually guarantees.

## Mutation results — measured, not assumed

| mutation | result |
|---|---|
| `damage > 23` → `>= 23` | FAILS: "damage 23 must not shake the ground at all: expected 1 to be -1" |
| `Math.trunc(damage/12)` → `Math.round` | FAILS: "damage 47 -> radius 3: expected 4 to be 3" |
| run quake/thrust even when the target died | FAILS: "a dead target means no earthquake: expected 15 to be -1" |
| `randint1(value) > 40` → `>= 40` | FAILS: "seed 9: ... the target must not move: expected { x: 28, y: 20 } to deeply equal { x: 26, y: 20 }" |
| delete the knockback roll entirely | FAILS 2 tests: "some seed must roll randint1(100) > 40: expected 0 to be greater than 0", and the damage-102 draw divergence |
| `damage > 100` → `>= 100` | **PASSES — equivalent mutant, see below** |

### The `> 100` boundary cannot be measured, and that is stated in the test

At exactly damage 100, `value` is 0 and `randint1(0)` returns 1 **without
drawing**: `Rand_div` returns 0 for `m <= 1` before touching the generator, in
both implementations (`z-rand.c:176`, `rng.ts:187`). `1 > 40` and `1 >= 40` are
both false. So `>` and `>=` are behaviourally identical here and no test can
separate them — the `>` is pinned by reading the C, not by measurement. The same
short circuit covers 101, since `randint1(1)` also takes the `m <= 1` path.

What IS measurable is that the roll happens once the gate opens for real, so the
test adds a damage-102 case (`value` 2, `randint1(2)` draws) and requires the
draw to show up as an RNG divergence from the HURT control while still never
exceeding 40. The mutation that deletes the roll fails on exactly that
assertion. Recording the equivalence rather than claiming six-for-six bites.

### Loop vacuity

Both seed-sweep tests `continue` when the blow misses, so both could in principle
assert nothing. The 140 test therefore counts landings and asserts
`landed > 0`; the 200 test requires **both** a moved and a stayed outcome, which
cannot hold vacuously.

## Divergence found, REPORTED NOT FIXED — the worldless blow path

`packages/core/src/combat/mon-melee.ts:550-562`, `resolveBlowEffect`'s SHATTER
case, does **not** gate on the target dying:

```ts
case "SHATTER": {
  const hp = adjustDamArmor(baseDamage, ac);
  if (hp > 23) side.push({ kind: "earthquake", radius: Math.trunc(hp / 12) });
  if (hp > 100) {
    const value = hp - 100;
    if (rng.randint1(value) > 40) { ... }        /* <-- always drawn */
  }
```

It cannot gate on it: it is the pure "compute the effect, return intents" path,
and damage is applied by its caller afterwards
(`mon-melee.ts:1063-1072`). So when a SHATTER blow kills the player, this path
takes a `randint1(value)` draw that the C never takes, because the C returns
inside `monster_damage_target` at `mon-blows.c:1095`.

Scope, precisely:

- The **live** path is correct. `resolveBlowEffectLive` (`mon-melee.ts:876-888`)
  has `if (env.playerDied) return done(cd, reduced);` before both gates.
- The worldless path runs when `state.monBlowEnv` is unset
  (`game/monster-turn.ts:1548-1553`), i.e. headless drivers, not the session.
- It only bites on a **fatal** SHATTER blow at damage > 100, and it desynchronises
  the stream from that point on.

Under decision 6.2 (base game = exact same seed as C) this is a real divergence
wherever the worldless path is used for anything seed-comparable. It is not
fixable by adding a check in the same place — the path structurally does not know
whether the target died — so it needs the caller to apply damage before resolving
the tail, or the tail to move into the live path only. Filed rather than fixed
because the fix is a restructure, not an edit.

Note also `mon-cmd.ts:452`'s `damage > 100 && state.monsters[tMon.midx]`: the
liveness term is redundant, since `applyMonVsMonHit` returning false already
means the target survived. Harmless today (unreachable), but it is the shape that
would silently skip a draw the C takes if it ever became reachable.
