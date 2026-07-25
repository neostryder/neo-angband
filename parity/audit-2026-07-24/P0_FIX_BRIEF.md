# P0 Fix Execution Brief (Grok writer)

Implement the 5 game-breaking P0 fixes from `parity/audit-2026-07-24/PARITY_CORRECTION_PLAN.md`
(section 3 has full evidence with C file:line and port file:line). `reference/` is the ORACLE;
match the C exactly.

## Non-negotiable rules
- Match the C behavior/values/control-flow/strings exactly. Preserve upstream quirks.
- SEED PARITY: the base game must reproduce the C's exact RNG stream. Do NOT add, remove, or
  reorder any RNG draw. If a fix touches an RNG path, mirror the C draw order precisely.
- REUSE existing tested functions where the plan says they exist (homeRetrieve, homeStash/
  homeCarry, quest binding) - wire them into the live path; do not reimplement.
- Do NOT couple game logic to the GlyphTerm renderer; keep the cell-grid render seam intact.
- Minimal, surgical diffs. ASCII only. Do NOT commit or push - leave changes in the working tree.

## The 5 fixes
- **P0-1** `packages/core/src/game/player-turn.ts`: in processPlayer, when
  `timed[PARALYZED]` or STUN grade == "Knocked Out", consume a full-energy no-op turn
  (register/execute a `sleep` action) and skip nextCommand() - mirror game-world.c:966-968
  (branch is after the detect-ore block, before command prep). Add the missing `sleep`
  action handler.
- **P0-2** `packages/core/src/game/mon-side.ts` (incTimed, ~line 204) + `packages/core/src/
  player/timed.ts`: pass the `incCheck` hook (and equip_learn / update_smart_learn hooks)
  into playerIncTimed so player_inc_check runs (mon-blows.c melee_effect_timed uses
  check=true). Wire the fail table from player-timed.c:923-956 (OF_FREE_ACT, OF_PROT_BLIND/
  CONF/FEAR, ELEM_POIS/OPP_POIS, HALLU chaos resist). Preserve the exact RNG draw order of
  player_inc_check.
- **P0-3** `packages/core/src/session/game.ts` (buy, ~2525) + `packages/web/src/shop.ts`
  (~732): route Home "Take" to the existing `homeRetrieve` (free, no price, no ORIGIN_STORE
  stamp, no shuffle/maint RNG draw), NOT storeBuy. Mirror do_cmd_retrieve (store.c:1783).
- **P0-4** `packages/core/src/session/game.ts` (sell, ~2530) + `packages/web/src/shop.ts`
  (~795): route Home "Drop" to the existing `homeStash`/`homeCarry` (free, no value gate,
  no note/fuel/timeout rewrite, OSTACK_PACK stacking), NOT storeSell. Mirror do_cmd_stash ->
  home_carry (store.c:870, 2009).
- **P0-5** `packages/web/src/pack.ts` (loadGamePack, ~374): include `quest.json` in the pack
  so bindCore builds the quest table; confirm birth copies quests to the player and the
  Morgoth kill can set total_winner (player-quest.c). Do not invent - wire the existing path.

## After EACH fix
Run the relevant tests and report pass/fail, e.g.:
  pnpm vitest run packages/core/src/game    (P0-1)
  pnpm vitest run packages/core/src/player packages/core/src/game   (P0-2)
  pnpm vitest run packages/core/src/store packages/core/src/session  (P0-3/4)
  pnpm vitest run packages/core/src        (P0-5 / general)
At the end run `pnpm typecheck` (tsc -b). Fix any breakage your changes cause.

## Report back (to stdout)
For each P0: files changed, a one-line summary of the change, and the test result. Then a
final line: `P0 FIXES DONE <n>/5 tests <pass|fail>`. Leave all changes uncommitted in the tree.
