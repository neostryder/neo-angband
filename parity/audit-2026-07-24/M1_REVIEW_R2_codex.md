M-1 mon-cmd.ts final re-review R2
Reviewer: Codex
Date: 2026-07-25
Oracle: C:\Repositories\neo-angband\reference\
Patch: C:\Repositories\neo-angband\parity\audit-2026-07-24\M1_FIX_R2.diff
Decision gate: 6.2, exact RNG draw order and count

OVERALL VERDICT: APPROVE

M-1 is approvable under Decision 6.2. The prior SHATTER wiring-dependent
draw-count defect is fixed. The remaining limitation is test breadth, not a
remaining deps gate: the equality test covers one fixed-damage seed and does
not exercise every SHATTER outcome branch.

1. SHATTER deps gate and parity test: APPROVE

The deps gate is gone. In packages/core/src/game/mon-cmd.ts:442-460, SHATTER
adjusts armor, emits the message, applies the non-player hit, and then runs
the earthquake solely when the surviving hit has damage > 23. There is no
"&& deps" condition. The live path uses the supplied registry at
mon-cmd.ts:221-235; the no-deps path creates a registry and registers the same
terrain handlers at mon-cmd.ts:237-261. The live session registers those
terrain handlers in session/game.ts:878-885.

The test at packages/core/src/game/mon-cmd.test.ts:370-412 is honest for the
path it claims to cover:

- The blow is fixed "50" damage, target AC is 0, and adjust_dam_armor leaves
  damage above the 23 threshold.
- The target starts at 500 HP, so the initial 50-damage
  mon_take_nonplayer_hit does not kill it; the earthquake call is reached.
- Depth is 5 and the test uses an open 60 by 40 field, so the real terrain
  earthquake handler runs its grid/monster processing rather than the town
  early return.
- The two runs use independent but identically seeded states, and
  Rng.getState() returns the full snapshot (quick, value, all 32 state words,
  stateI, fixed, and fixval). toEqual therefore compares the full RNG state,
  not merely one output or a draw counter.

The test is not exhaustive. Its fixed damage of 50 makes the damage > 100
randint1(damage - 100) and thrust_away success/failure branch
unreachable. It tests only radius 4, does not deliberately cover a target
that dies during the earthquake, and the HP assertions only prove HP fell;
they do not assert that the target remains registered after the earthquake.
Thus equality is directly demonstrated for seed 42, depth 5, fixed damage
50, a surviving initial hit, and radius 4. The untested SHATTER sub-paths are
knockback RNG plus thrust success/failure, target death during earthquake, and
other damage/radius values. The implementation routes both wiring variants
through the same terrain handler and the same post-earthquake knockback code,
so this coverage limitation does not recreate the prior wiring-dependent gate.

2. Previously approved regression items: APPROVE

The approved draw-order and behavior items remain intact in
packages/core/src/game/mon-cmd.ts:346-478:

- Timed handlers draw randint1(amount) before the blow message.
- EXP_10/20/40/80 draw damroll(N, 6) before the message.
- Elemental handlers emit the message and call the hit path only when final
  damage is greater than zero.
- HURT and SHATTER adjust damage for armor before the message.
- NONE is message-only and does not enter the damage path.
- SHATTER now preserves the C order: hit, earthquake when damage > 23, then
  the damage > 100 knockback roll and thrust path.

The typed monster-blow msgt is still passed to state.msg and the sound path
at mon-cmd.ts:111-117. monster_attack_monster still uses the monster-target
effects and defender racial armor at mon-cmd.ts:418-478. Damage uses
mon_take_nonplayer_hit, including C wake and post-hit fear, through
mon-cmd.ts:184-204 and mon-death.ts:383-434. Blow lore times_seen and the
lore_update call remain at mon-cmd.ts:520-538.

3. Scope and test changes: APPROVE

The changed files are exactly:

- packages/core/src/game/mon-cmd.ts
- packages/core/src/game/mon-cmd.test.ts
- packages/core/src/mon/steal.ts
- packages/core/src/game/steal.ts

The two steal.ts changes are comment-only. packages/borg,
packages/linoleum, and packages/cli/baseline have no changes. No test was
relaxed beyond the previously approved camouflage correction. The only
replaced assertion is:

  expect(revealed).toBe(target.midx);
  -> expect(revealed).toBeNull();

The other changed assertions are additions, quoted here for auditability:

  expect(target.mflag.has(MFLAG.CAMOUFLAGE)).toBe(true);
  expect(typed.some((m) => m.type === "MON_HIT" || m.type === blow.method?.msgt)).toBe(true);
  expect(sounds.length).toBeGreaterThan(0);
  expect(blowLine).toBeDefined();
  expect(softLost).toBeGreaterThan(0);
  expect(hardLost).toBeLessThan(softLost);
  expect(lore.blowTimesSeen[0] ?? 0).toBe(0);
  expect(lore.blowTimesSeen[0]).toBe(1);
  expect(rngWithout).toEqual(rngWith);
  expect(withDeps.target.hp).toBeLessThan(500);
  expect(withoutDeps.target.hp).toBeLessThan(500);

Verification:

- pnpm exec vitest run packages/core/src/game/mon-cmd.test.ts: 18 passed.
- The focused SHATTER test also passed.
- pnpm typecheck: passed.
- git diff --check: clean.
- packages/cli parity tests were ignored as requested because they are known
  red under S-2.
