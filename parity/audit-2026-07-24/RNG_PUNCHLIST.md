# RNG-Determinism Punch List (round 2) — Grok writer

Decision 6.2: the BASE GAME must reproduce the C's EXACT RNG stream (same seed -> same
dungeon and rolls; same draw ORDER and COUNT). `reference/` is the ORACLE.

Round 1 is committed on branch `parity/p1-rng` (WIP commit 60c358f4b). Codex's independent
review is at `parity/audit-2026-07-24/RNG_REVIEW_codex.md` -- READ IT; it cites C file:line
for every item below. Aaron's directive: KEEP the approved fixes, CORRECT the defects and
the additional breaks.

## KEEP AS-IS (Codex APPROVED, C-cited) — do not rework
- Fix 1 store init single owner draw (`store/store.ts:681,699-702`) vs store.c:340-355.
- Fix 4 RNG state save/load normalization (`rng.ts:414-418`) vs load.c:388-416.
- Fix 7 flavor reverse-walk (`obj/flavor.ts:179-191`) vs init.c:4239-4270 + obj-util.c:76-112.
- Fix 8 names reverse per section (`session/boot.ts:148-153`) vs init.c:1476-1479.
- The test edits in `store/transact.test.ts:449-454` and `obj/flavor.test.ts:41-43` are
  justified by the C; keep them.

## FIX THESE (Codex found real defects)
1. **Fix 2 — missing store hint draws.** `web/src/shop.ts:154-170`. C ui-store.c:156-158
   consumes `one_in_(3)` then a `randint0` for a hint whenever the hints list exists. The
   port skips that branch entirely because CorePack never binds hints, so main-stream draws
   are MISSING (not merely cosmetic). Bind `hints.json` into the pack (it is compiled but
   unbound -- same root cause as audit finding L2_init_parse-003) and perform the C draws in
   the C order.
2. **Fix 3 — birth must advance the REAL game stream.** `web/src/main.ts:5909` injects a
   fresh `new Rng(seed)`; birth's draws are then discarded when the modal ends, so the
   dungeon starts from the wrong stream position. C ui-birth.c (L465/678/696/842) advances
   the ONE global stream that gen then continues from. Wire birth to the actual game RNG
   instance so its draws persist. Also remove the unsafe `new Rng(1)` fallback at
   `birth.ts:1213` (or make it throw) so a missing RNG can never silently desync.
3. **Fix 5 — trap gen: tryDoor site still missing draws.** `core/src/gen/cave.ts:604-615`
   calls only `g.markTrap`; C gen-cave.c:830-833 calls `place_trap` there, consuming the
   pick_trap + randcalc power draws. Cover EVERY C place_trap call site, not just the
   room/allocation path.
4. **Fix 6 — populate drops marker traps / re-draws.** `core/src/session/game.ts:1649-1657`
   installs `level.traps` only when the descriptor list is non-empty and then ignores
   `trapGrids`, silently losing tryDoor marker traps; when the list IS empty it re-picks kind
   and power on the play stream (the exact double-draw this was meant to remove). After (3),
   ensure every generated trap carries kind+power and populate materializes them with NO
   second draw; assert no bare marker remains.
5. **Fix 9 — mon-vs-mon draw is in the wrong position.** `core/src/game/mon-cmd.ts:169-173`
   makes one unconditional draw after raw damage, before melee-effect handling. C draws
   INSIDE the selected effect handler (mon-blows.c:395-399, 477-480, 609-612, 645-647):
   timed effects evaluate their `randint1` amount BEFORE the message, and elemental handlers
   skip the message when final damage is zero (so no draw). Reproduce the exact per-handler
   order/count. Also emit the C message type.

## ALSO FIX (live main-stream breaks Codex found outside the 9)
6. `web/src/main.ts:5901` — `generateHistory` is seeded from `Date.now`. C
   player-birth.c:330-346 `get_history` consumes `randint1(100)` per history node on the MAIN
   stream (ui-birth.c:746-750 calls it). Use the game stream; preserve redraw/back behavior.
7. `web/src/main.ts:751` — `Math.random` for RF_ATTR_MULTI. C ui-display.c:1439-1446 draws
   `randint1(BASIC_COLORS - 1)` on the MAIN RNG per visible multi-coloured monster render.
   The "display randomness" comment is not oracle-faithful. Use the game stream.
8. `core/src/session/game.ts:2243` — `new Rng(opts.seed).randint0` for randart_seed. C
   player-birth.c:1283-1291 draws `seed_randart` then `seed_flavor` from the SAME main
   stream. Remove the separate RNG so the stream position matches.

## ALSO HARDEN (latent infinite loop)
9. `core/src/store/store.ts:100-102` — `storeShuffle` does
   `while (o === store.owner) o = storeChooseOwner(...)`. With a one-owner store this NEVER
   terminates (reachable from `transact.ts:239` empty-store restock and `store.ts:663`
   store_update). C store.c:1497-1498 shares the assumption, but the port must not spin on
   data it accepts. Keep the C draw behavior for the normal multi-owner case (do not change
   draw counts) while making the one-owner case terminate.
   Codex also flagged retry-shaped loops worth bounding: `obj/randname.ts:88` outer while and
   the title-collision retry at `obj/flavor.ts:226-228`. Only harden them if you can do so
   WITHOUT changing draw order/count for valid data.

## DO NOT
- Do NOT modify `packages/cli/baseline/stats-baseline.json`. It was deliberately reverted:
  Codex judged the 436-line rewrite an unjustified failure-baseline update. It may legitimately
  fail until the stream is C-faithful -- that failure is correct SIGNAL. If it still differs at
  the end, report the delta; do not re-record the golden.
- Do NOT touch `packages/borg/**` or `packages/linoleum/**` (out of scope: extensions).
- Do NOT relax a test to make it pass. A test may only change if the C justifies it -- say why.

## Verify (chunked, with timeouts; NEVER monolithic `pnpm test`)
`packages/borg` think/foundation tests HANG (pre-existing, not yours) -- exclude borg.
```
pnpm typecheck
timeout 600 pnpm vitest run packages/core/src/store packages/core/src/session --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/obj --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/gen packages/core/src/world --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/game packages/core/src/combat packages/core/src/mon packages/core/src/player --testTimeout=20000
timeout 600 pnpm vitest run packages/web --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/rng.test.ts packages/core/src/save packages/core/src/effects --testTimeout=20000
```
Check each run's exit status (124 = hang -> STOP and report which file).

## Report (stdout)
Per item: files changed, one-line summary, and the C citation you matched. Then the chunked
test results and typecheck. Flag anything you could NOT do rather than forcing it.
End with: `RNG ROUND2 DONE <n>/9 tests <pass|fail>`. Do NOT commit or push. ASCII only.
