RNG determinism parity review - Round 2
Independent review of parity/audit-2026-07-24/RNG_FIX_R2.diff

Decision 6.2 requires the base game to reproduce the C RNG stream exactly:
the same seed, draw order, and draw count. The cited files under reference/
were treated as the oracle. This review is source-derived; passing tests do not
replace a C-vs-port stream trace.

ROUND-1 COMPLAINTS

1. APPROVE - store init extra owner draw

packages/core/src/store/store.ts:146-155 leaves the bound owner as a
non-random placeholder, and :689-695 performs exactly one storeChooseOwner
draw before the ten maintenance calls. This matches store.c:340-355, where a
fresh store has no current owner and store_shuffle accepts its first choice.
No extra bind-time draw remains.

2. APPROVE - store hint draws

packages/web/src/pack.ts:387-389 binds hints.json. packages/core/src/session/
boot.ts:170-175 preserves the H records in file order. packages/web/src/
shop.ts:184-191 performs one_in_(2), then the hints one_in_(3), then
randint0(comment_hint), then the random_hint reservoir one_in_ sequence. The
level-gated owner/title branch at :194-208 follows the C else-if order. This
matches ui-store.c:121-172, including the hint draws on the main game RNG.

3. ISSUE - birth does not preserve the C continuous stream and seed order

The post-birth snapshot handoff itself is present: packages/core/src/session/
boot.ts:303-307 accepts rngState, and packages/web/src/main.ts:5947-5953
stores the birth snapshot. However, packages/web/src/main.ts:5916 creates a
separate new Rng(seed), rather than advancing the live game's state.rng as the
punch list required. More importantly, packages/core/src/session/game.ts:
2252 draws seed_randart, :2267-2273 runs level generation, and :2417-2420
draws seed_flavor. C player-birth.c:1283-1292 draws seed_randart immediately
followed by seed_flavor, before the later prepare_next_level generation in
ui-game.c:757-760. The port therefore inserts generation draws between the two
seed draws. Town store reset is also deferred to game.ts:2469, after the same
generation path, whereas player-birth.c:1269-1270 resets stores before both
seeds. This is not exact stream parity.

The display color path now uses state.rng at packages/web/src/main.ts:762-767,
and the Date.now uses still present in main.ts are metadata/UI timestamps, not
RNG draws. The PREVIEW_SEED Rng instances in birth.ts:1233-1238 and :1329-1343
are throwaway preview calculations, but main.ts:5916 is a live birth-stream
Rng and remains a problem.

4. APPROVE - RNG save/load normalization

packages/core/src/rng.ts:406-418 reduces stateI modulo RAND_DEG and forces
quick false while restoring the WELL state. This matches load.c:388-417 and
does not alter the normal saved C stream.

5. APPROVE - all generation place_trap sites

packages/core/src/gen/cave.ts:611-617 now calls placeTrap for tryDoor, so the
gen stream consumes both pick_trap and power. The other C site,
gen-util.c:790-791, is covered by the existing placeTrap calls in
packages/core/src/gen/util.ts:1310-1317; room and vault callers also use that
same helper. packages/core/src/session/boot.ts:231-240 threads reg.traps into
generation, so the live base path has trap kinds available. The C calls at
gen-cave.c:830-833 and gen-util.c:790-791 are therefore covered.

6. ISSUE - populate can still lose a bare trapGrid and retains a redraw fallback

packages/core/src/session/game.ts:1651-1660 installs descriptors when
level.traps is nonempty but then ignores every level.trapGrids entry. Thus any
level containing both a descriptor trap and a bare marker silently loses the
bare marker. If descriptors are empty, the fallback at :1658-1659 calls the
live placeTrap and spends the pick/power draws a second time. The normal
trapKinds-bound path avoids that fallback, but the code does not assert that
every trapGrid has a descriptor, so the stated no-bare-marker guarantee is not
implemented.

7. APPROVE - birth.test.ts RNG injection

Every runBirth call in packages/web/src/birth.test.ts now supplies
new Rng(1), including quickstart and history cases. This is justified by the
production guard in packages/web/src/birth.ts:1212-1215: a missing RNG must
throw because ui-birth.c advances the main stream. The edits provide a
deterministic test dependency; they do not add a silent fallback or merely
mask a missing-RNG failure.

8. APPROVE - mon-cmd.ts was not silently replaced

The R2 diff is localized to imports, helper functions, and the existing
monsterAttackMonster block at packages/core/src/game/mon-cmd.ts:196-367.
The pre-existing command, movement, spell, door, and release paths remain
present after the attack block. No unrelated wholesale deletion or dropped
export is visible in the diff against its stated base.

9. ISSUE - mon-vs-mon RNG placement is fixed, but the requested C message type is not

The draw order in packages/core/src/game/mon-cmd.ts:244-328 now matches the
cited handlers: timed randint1 amounts and EXP damrolls precede the message;
elemental blows call the message and hit only when final damage is positive;
HURT/SHATTER adjust before the message; NONE only selects the message. This
matches mon-blows.c:395-399, :477-480, :609-612, and :645-647 for RNG order
and count.

It is nevertheless an ISSUE against the requested fix because
mon-cmd.ts:77-80 sends method->msgt through state.sound, while state.msg only
accepts text. The web sink at packages/web/src/main.ts:924-932 emits message
type 0. The C msgt type is not emitted with the monster message. This is not
itself an RNG draw, but the requested per-handler fix is incomplete.

ADDITIONAL EXPLICIT CHECKS

Store shuffle: APPROVE. packages/core/src/store/store.ts:108-115 has a special
branch only for owners.length <= 1. The one-owner branch calls randint0(1),
which consumes no WELL value just as C Rand_div(m <= 1) at z-rand.c:168-176.
For two or more owners, the retry loop is draw-identical to store.c:1493-1500.

Protected artifacts and scope: APPROVE. stats-baseline.json is not modified,
and neither packages/borg/** nor packages/linoleum/** is touched by the R2
diff or current worktree status.

TESTS

- pnpm typecheck: PASS.
- Focused store/session/game/web birth run: 84 files, 1265 tests PASS.
- RNG/flavor/generation run: 5 files, 119 tests PASS.

OVERALL

ISSUE - not approvable under Decision 6.2. The store hints, owner initialization,
save/load normalization, trap generation call sites, flavor order, name order,
storeShuffle hardening, birth test injection, and mon-cmd file integrity checks
pass. The birth stream still has the wrong continuous ordering and a separate
live birth RNG; populate still has a silent bare-marker loss path and a
fallback that can redraw; and the mon-vs-mon change does not emit the C message
type. The stats baseline and out-of-scope packages remain untouched.
