RNG determinism parity review - Round 3

Independent review of parity/audit-2026-07-24/RNG_FIX_R3.diff against the
reference/ C oracle. Decision 6.2 is exact C RNG stream parity: the same seed,
draw order, and draw count.

1. ITEM 3 - birth/init phase order: APPROVE

The live web birth path now passes state.rng into runBirth at
packages/web/src/main.ts:5927-5940. historyFor also uses state.rng at
:5919-5923. The accepted birth snapshot is saved at :5953-5955 and restored
by bootGame at :585-600. The temporary `new Rng(seed)` at :5918 only supplies
the seed state to the existing live state.rng; no birth draw is made from that
temporary object. The actual birth draws use state.rng. The only other birth
Rng instances are the PREVIEW_SEED throwaways in birth.ts.

The resulting main-stream sequence verified in session/game.ts is:

  a. Birth UI history, random menu choices, random finish/race/class choices,
     and standard-roller draws on the live birth stream.
  b. The remaining generatePlayer birth draws after the UI accepts, before
     store reset, matching player-birth.c:1236-1269.
  c. At starting depth 0, createTownStores/storeReset: one owner draw per
     store followed by store maintenance, at game.ts:2297-2321.
  d. Optional seed_randart draw, at game.ts:2323-2335.
  e. Immediately next, seed_flavor draw, at game.ts:2336.
  f. player_outfit start-item draws, at game.ts:2344-2348.
  g. bootLevel/generateLevel draws, at game.ts:2350-2357.

This is store_reset -> seed_randart (when enabled) -> seed_flavor -> outfit ->
level generation, exactly matching player-birth.c:1269-1292 and
ui-game.c:757-760. flavorInit is called during wireGame after the outfit call,
but it uses its own quick Rng seeded by seed_flavor (obj/flavor.ts:119-120),
not the live main stream. It therefore does not insert a main-stream draw and
the Decision 6.2 draw order is exact. The web default depth is 0, so the town
store phase is live for a normal new character.

2. ITEM 6 - populate traps: APPROVE

placeTrap in gen/util.ts:1177-1199 has the required live behavior. With the
bound trap table it performs pickTrapKind once, rolls power once, marks the
grid, and appends one GenTrap containing tidx and power. The tryDoor site now
calls placeTrap at gen/cave.ts:613-617, and the allocation path calls the same
helper at gen/util.ts:1312-1318. chunkCopy copies both trap markers and their
GenTrap descriptors at gen/cave.ts:930-940.

populateFromLevel in session/game.ts:1639-1662 checks every trapGrid against a
descriptor and throws if a marker has no kind and power. It then calls
installTrap with the already chosen tidx and power; there is no placeTrap(-1)
fallback and no second pick/power draw. Therefore no bare marker is silently
lost on the live trapDeps path, and no pick/power pair is drawn twice on any
normal generation path.

The remaining marker-only behavior is explicitly confined to bare Gen/test
contexts where trapKinds is null (gen/util.ts:1178-1180). If such a level is
fed to populate with trapDeps null, the whole trap population block is skipped;
that is the existing no-trap-registry test seam, not normal play. A normal
bound game supplies reg.traps through genDeps (session/boot.ts:231-240) and
also supplies trapDeps, so every normal marker has a descriptor. The assertion
is consequently a correct invariant, not an over-strict normal-play crash.
The full session/game and generation tests completed without hitting it.

3. REGRESSION CHECKS: APPROVE

The previously approved items remain intact:

  - Store owner initialization remains one storeChooseOwner draw in
    storeReset, with the provisional bind owner not consuming RNG.
  - Store hints remain bound in pack.ts and use the main stream in the C order.
  - Rng.setState normalization remains modulo RAND_DEG with quick forced false.
  - All generation place_trap sites use placeTrap, including tryDoor.
  - Flavor assignment remains reverse file order and the names section fixture
    remains reversed to match C list construction.
  - storeShuffle retains the one-owner hardening and the multi-owner C loop.
  - birth.test.ts still injects a deterministic Rng into every runBirth call.
  - mon-cmd.ts is unchanged from the Round 2 cumulative patch: the extracted
    mon-cmd sections in RNG_FIX_R2.diff and RNG_FIX_R3.diff are byte-equal.

Item 9 is deliberately deferred pending the typed-message seam on the other
branch. It is noted, not re-flagged as a blocking issue.

4. SCOPE, ARTIFACTS, AND TEST CHANGES: APPROVE

packages/cli/baseline/stats-baseline.json is unmodified. packages/borg and
packages/linoleum are untouched. The worktree has no implementation changes
beyond the committed round-3 batch and the requested audit artifacts.

No test was relaxed. The test changes are dependency/expectation corrections:

  - birth.test.ts changes calls such as
    `runBirth(term, RACES, CLASSES)` to
    `runBirth(term, RACES, CLASSES, { rng: new Rng(1) })`, including quickstart
    and history cases.
  - flavor.test.ts changes
    `nameSections.set(rec.section, rec.word)` to
    `nameSections.set(rec.section, [...rec.word].reverse())`.
  - transact.test.ts replaces the incorrect RNG-free expectation
    `expect(ctx.rng.getState()).toEqual(before)` with a probe that models the
    C comment_accept draws:
    `if (probe.oneIn(3)) probe.randint0(6);`
    followed by equality with probe.getState().

No test was marked skip or only, and no assertion was removed. Verification in
this review: pnpm typecheck PASS; five focused test files PASS, 137 tests PASS.

OVERALL: APPROVABLE

The RNG-determinism batch is approvable under Decision 6.2. Items 3 and 6 are
fixed and verified, the six previously approved items did not regress, and
item 9 is a documented deliberate deferral rather than a blocking finding.
