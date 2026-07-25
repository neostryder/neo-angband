M-1 mon-cmd.ts follow-up adversarial review
Reviewer: Codex
Date: 2026-07-25
Reference: C:\Repositories\neo-angband\reference\
Patch: C:\Repositories\neo-angband\parity\audit-2026-07-24\M1_FIX.diff
Decision gate: 6.2, exact RNG draw order and count

Overall verdict: ISSUE - not approvable under 6.2.

The approved draw order is preserved for the blow handlers themselves, but
SHATTER conditionally omits the C earthquake effect when deps is absent. The C
always calls EF_EARTHQUAKE for a surviving SHATTER hit with adjusted damage
greater than 23. EF_EARTHQUAKE consumes state-dependent RNG draws. Therefore
the same game state can consume different RNG streams depending on whether
the TypeScript call was wired with deps. This is a seed-parity failure.

Draw-order precheck

For a successful blow, the new code keeps the common sequence:

1. checkHit RNG, except for NONE, which bypasses the hit test.
2. randcalc of the blow dice.
3. Stun damage reduction, with no RNG.
4. Handler-specific work in the C order, followed by the shared
   mon_take_nonplayer_hit path and then critical stun processing if the target
   is still present.

The handler sequences verified against mon-blows.c are:

- NONE: message selection randint0(num_messages), then the message; no damage
  hit path.
- BLIND, CONFUSE, TERRIFY, PARALYZE: timed amount randint1(rlev) before
  display_blow_message_vs_monster; then non-player damage; then the monster
  timed increment if the target survived. This matches the C argument
  evaluation order.
- EXP_10, EXP_20, EXP_40, EXP_80: damroll(N, 6) before the message; then
  non-player damage. The rolled amount is unused for a monster target, as in C.
- ACID, ELEC, FIRE, COLD, POISON: armor and elemental calculation have no RNG;
  the message and non-player hit occur only when final damage is greater than
  zero. Poison has no additional timed roll for a monster target, matching the
  C early return.
- HURT: adjust_dam_armor first, then message selection, then
  mon_take_nonplayer_hit.
- EAT_ITEM: message, non-player hit, then steal_monster_item for a surviving
  target. The reservoir selection in getRandomMonsterObject uses oneIn(i),
  matching get_random_monster_object.
- SHATTER: adjust_dam_armor, message, non-player hit, EF_EARTHQUAKE when
  adjusted damage is greater than 23, then randint1(damage - 100) when damage
  is greater than 100. The first three and the knockback ordering are correct;
  the earthquake call is incorrectly deps-gated.
- Other player-only handlers: for a monster target, the C handlers stop after
  monster_damage_target (or only apply the timed monster status), so the
  port's damage/message behavior does not add an extra player-side RNG path.

The common non-player hit path also retains C's state-dependent sequence:
monster_wake(..., false, 0) is always called, including its randint0(100);
HOLD is not cleared; and monster_scared_by_damage supplies the post-hit fear
draws when applicable. Critical stun draws remain after the handler and only
when the target still occupies the saved grid.

1. Draw order and count: ISSUE

Problem: packages/core/src/game/mon-cmd.ts:413-415 contains:

  if (damage > 23 && deps) {
    monVsMonEarthquake(state, mon, Math.trunc(damage / 12), deps);
  }

At reference/src/mon-blows.c:1098-1102, the C unconditionally calls
effect_simple(EF_EARTHQUAKE, source_monster(...), ..., radius) after the
target survives. The earthquake implementation performs RNG draws over the
affected grids and may perform additional player/monster consequence draws.
Skipping the call when deps is absent changes the RNG stream for the same
game state. The knockback randint1 still runs, which makes the divergence
directly observable in subsequent draws. The port must execute an equivalent
EF_EARTHQUAKE path, with the same draw behavior, regardless of wiring.

2. M-1a typed monster blow message: APPROVE

packages/core/src/game/mon-cmd.ts:110-115 passes the selected method.msgt as
the second argument to state.msg and retains the existing sound call. The
message selection draw remains at line 77 and no draw was added by the typed
seam. The live seam in packages/core/src/session/game.ts and
packages/web/src/main.ts carries text plus type into MessageLog.add and
typeColor/renderer. This is C's msgt(method->msgt, ...) behavior at
reference/src/mon-blows.c:236.

3. M-1b monster effects, armor, death, wake, and fear: APPROVE

The HURT armor reduction is at packages/core/src/game/mon-cmd.ts:404-407 and
matches reference/src/mon-blows.c:655-665. Elemental armor and race
immunity/vulnerability handling is at mon-cmd.ts:384-403 and matches the
mon-target branch at reference/src/mon-blows.c:417-488. Timed monster mapping
and the pre-message timed roll are at mon-cmd.ts:346-360 and 433-441,
matching reference/src/mon-blows.c:502-556 and the BLIND/CONFUSE/TERRIFY/
PARALYZE handler argument evaluation. EAT_ITEM is at mon-cmd.ts:427-432 and
uses the midx >= 0 steal path required by reference/src/mon-blows.c:847-878.

monTakeNonplayerHit is the correct path. It is called at
packages/core/src/game/mon-cmd.ts:189-202 and the live session installs its
full deps at packages/core/src/session/game.ts:1212-1215. The implementation
at packages/core/src/game/mon-death.ts:396-432 matches
reference/src/mon-util.c:1199-1243: unique/arena cap, unconditional wake,
no HOLD clear, no become_aware, death/loot/delete, and post-hit fear.

4. M-1c blow lore: APPROVE

packages/core/src/game/mon-cmd.ts:484-502 matches
reference/src/mon-attack.c:872-898: visible attacker gating, the
obvious/damage/seen condition, uint8 cap, and lore_update. The counter update
and loreUpdate implementation perform no RNG draws.

5. Camouflage test correction: APPROVE

The changed assertion is exactly:

  expect(revealed).toBeNull();

at packages/core/src/game/mon-cmd.test.ts:286, with the camouflage flag also
asserted true at line 288. This is C-justified, not a relaxation: the C
mon_take_nonplayer_hit at reference/src/mon-util.c:1193-1245 never calls
become_aware, while mon_take_hit does so separately at reference/src/mon-util.c:
1277-1279. The test now checks that the target takes damage while remaining
camouflaged.

6. File scope: APPROVE

The only non-test files outside mon-cmd.ts in the patch are:

- packages/core/src/game/steal.ts: comment-only documentation changes.
- packages/core/src/mon/steal.ts: comment-only documentation changes.

The test file is intentionally changed for the camouflage assertion and new
coverage. packages/borg, packages/linoleum, and packages/cli/baseline have no
changed files. git diff --check is clean.

Verification performed

- pnpm exec vitest run packages/core/src/game/mon-cmd.test.ts: 17 tests passed.
- pnpm typecheck: passed.
- packages/cli parity tests were not used for this review, per the stated
  pre-existing S-2 red status.
