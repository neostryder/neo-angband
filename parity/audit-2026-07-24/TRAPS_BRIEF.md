# Traps + Dungeon Parity Brief (worktree: C:\Repositories\na-wt-trap, branch parity/p1-traps)

`reference/` is the ORACLE (Angband 4.2.x). Cite the C file:line in a comment for every change.
Preserve faithful upstream bugs -- do NOT "improve" the C.

## BRANCH CONTEXT — read first
This branch is cut from `parity/p1-rng`, which ALREADY fixed the trap RNG-stream items:
- `tryDoor` now calls the gen `placeTrap` (pick + power) instead of a bare `markTrap`
  (gen-cave.c:830-833), and
- `populateFromLevel` no longer re-draws kind/power for descriptor traps (trap.c:356-394).
Do NOT redo those. Verify they are present, then build on them.

## SEED PARITY (Decision 6.2)
The base game must reproduce the C's EXACT RNG stream: same draw ORDER and COUNT. Add a draw
ONLY where the C makes one and the port omits it; never reorder or duplicate.

## IN SCOPE
1. **TRF_DELAY traps never fire** (grok+codex agree).
   C: delayed traps fire via the `player_leaving` path (see `mon-util.c` + `trap.c` TRF_DELAY
   handling). The port has no `player_leaving` hook, so TRF_DELAY traps never trigger at all.
   FIX: wire the C's leaving path so delayed traps fire when the C fires them.
2. **square_set_feat does not destroy traps on non-trappable terrain** (grok+codex agree).
   C `cave-square.c`: changing a grid's feature to non-trappable terrain destroys any trap
   there. Port leaves the trap attached. FIX.
3. **Disarm-on-walk for known disarmable traps missing** (grok+codex agree).
   C `cmd-cave.c`: walking into a KNOWN disarmable trap attempts disarm (with the C's
   messages and RNG), rather than plain movement. FIX to the C's decision logic.
4. **only_partial feeling-reveal guard not modelled** (grok+codex agree).
   C `cave-view.c`: the level-feeling reveal is guarded by the only_partial condition. Port
   ignores it, revealing feeling in cases the C does not. FIX.
5. **Town terrain not stored/restored without birth_levels_persist** (grok+codex agree).
   C `generate.c:893-1028`: town layout handling / join info. Port loses town terrain when
   birth_levels_persist is off. FIX to the C behavior.
6. **Remaining L9 dungeon findings.** Work the rest from
   `parity/audit-2026-07-24/findings/grok/L9_dungeon.md` (12) and
   `parity/audit-2026-07-24/findings/codex/L9_dungeon.md` (17), skipping anything already
   fixed on this branch by the RNG stream (trap kind/power draws, populate re-draw). For each:
   fix it, or state with evidence that it is already correct / stale.

## OUT OF SCOPE (other agents are editing these in parallel — do NOT touch)
- `core/src/rng.ts`, `core/src/store/**`, `core/src/obj/flavor.ts`, `core/src/session/boot.ts`,
  `web/src/main.ts`, `web/src/shop.ts`, `web/src/birth.ts`, `web/src/pack.ts`,
  `core/src/game/mon-cmd.ts`  (RNG stream)
- `core/src/save/**`, `core/src/session/save.ts`  (save stream)
- `core/src/color.ts`, `core/src/visuals/**`, `core/src/msg.ts`, `web/src/ui-colors.ts`  (colour stream)
- `core/src/combat/**`, `core/src/player/**`  (player+combat stream)
- `core/src/effects/**`, `core/src/mon/**`  (effects+monsters stream)
- `core/src/game/ranged-cmd.ts`, `core/src/game/mon-message.ts`, `core/src/score/**`,
  `web/src/screens.ts`, `web/src/news.ts`  (message stream)
- Never touch `packages/borg/**`, `packages/linoleum/**`,
  `packages/cli/baseline/stats-baseline.json`.
Your territory: `core/src/gen/**`, `core/src/world/**`, and trap/dungeon logic in
`core/src/game/**` EXCEPT the files listed above. `core/src/session/game.ts` is shared -- if you
must edit it, keep the edit minimal and say exactly what you changed.

## Rules
- ONLY edit files under `packages/`. Never relax a test to pass -- a test may only change if
  the C justifies it, and say why.
- If an item is already correct (the audit can be stale), say so with evidence instead of
  changing code.

## Verify (chunked, with timeouts; NEVER a monolithic `pnpm test`)
`packages/borg` think/foundation tests HANG (pre-existing) -- always exclude borg.
```
pnpm typecheck
timeout 600 pnpm vitest run packages/core/src/gen packages/core/src/world --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/game packages/core/src/session --testTimeout=20000
timeout 600 pnpm vitest run packages/web --testTimeout=20000
```
Check each exit status (124 = hang: STOP and report which file).

## Report (stdout)
Per item: files changed, one-line summary, C citation matched, draw added/removed. Then test +
typecheck results. Flag anything you could NOT do rather than forcing it.
End with: `TRAPS DONE <n>/6 tests <pass|fail>`. Do NOT commit or push. ASCII only.
