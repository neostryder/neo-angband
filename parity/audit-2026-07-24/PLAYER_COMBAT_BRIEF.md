# Player + Combat Parity Brief (worktree: C:\Repositories\na-wt-pc, branch parity/p1-player-combat)

`reference/` is the ORACLE (Angband 4.2.x). Match the C exactly; cite the C file:line in a
comment for every change. Preserve faithful upstream bugs -- do NOT "improve" the C.

## SEED PARITY (Decision 6.2)
The base game must reproduce the C's EXACT RNG stream: same draw ORDER and COUNT. Several
items below ADD a draw that the C makes and the port omits -- add it in the C's position.
Never add a draw the C does not make, and never reorder existing ones.

## IN SCOPE
1. **Invisible melee targets never get the to-hit penalty** (L7_combat, grok).
   C `player-attack.c:104-109`: `chance_of_melee_hit` HALVES the chance when
   `!monster_is_visible`; L763 feeds that into `test_hit`. Port always passes
   `monVisible: true` (its own comment admits "treated as visible"), so invisible monsters
   are hit at full accuracy. FIX: pass real visibility; also use it where `monsterFled`
   depends on visibility.
2. **do_cmd_fire / do_cmd_throw never run player_confuse_dir** (L7_combat, grok).
   C `player-attack.c:1349-1352` (fire) and `:1392-1395` (throw) call
   `player_confuse_dir(..., false)` after `cmd_get_target`. While confused this randomizes
   the direction (with its RNG draw) and messages accordingly. Port uses the chosen aim
   direction verbatim -- confused players fire/throw accurately and the draw is MISSING.
   FIX: call the confuse-dir equivalent in the C position on both paths.
3. **Fire range uses num_shots instead of ammo_mult; throw range formula wrong**
   (prior audit R1/R2 -- re-derive from the C before changing).
   Oracle: the range computation in `player-attack.c` for fire (ammo multiplier) and throw.
   FIX both formulas to the C.
4. **TMD_FASTCAST cast costs a full turn, not 3/4 energy** (L6_player, grok+codex agree).
   C `cmd-obj.c`: casting under FASTCAST consumes 3/4 of a turn's energy. Port charges a
   full turn. FIX the energy cost.
5. **do_cmd_run does not refuse when confused** (L6_player, grok+codex agree).
   C `cmd-cave.c`: running is refused while confused (with the C's message). Port allows it.
   FIX.
6. **player_is_trapsafe ignores OF_TRAP_IMMUNE equipment** (L6_player, grok+codex agree).
   C `player-util.c`: trapsafe accounts for OF_TRAP_IMMUNE from equipment as well as the
   timed effect. Port checks only the timed effect. FIX.
7. **Over-exertion CONFUSED / IMAGE / SCRAMBLE bypass player_inc_check** (prior T1/T2).
   C applies these through `player_inc_timed(..., check=true)` so `player_inc_check`
   (`player-timed.c:923-956`) lets protection flags/resists block them. Port applies them
   unchecked. FIX: route through the checked path (the shared incCheck queries already exist
   -- see `game/mon-side.ts` for the pattern used by the melee fix) and preserve
   `player_inc_check`'s RNG draw order.
8. **TMD_SCRAMBLE / SPRINT on-begin / on-end chains are dead** (prior T2).
   C runs the on-begin/on-end effect chains for these timed effects
   (`player-timed.c` + `list-player-timed.h`). Port never fires them. FIX.
9. **Blackguard PF_COMBAT_REGEN gaps** (prior C1 / L6_player).
   C `player-util.c:216-222` converts lost hitpoints into rage-mana for PF_COMBAT_REGEN,
   excluding poison / fatal wound / starvation. Part of this is already wired in
   `game/take-hit-hooks.ts` (combatRegenReward) -- VERIFY it matches the C and fix any
   remaining unwired PF_COMBAT_REGEN behavior (e.g. the mana-drain-on-regen side, if the C
   has it). Report what was already correct rather than duplicating it.
10. **Monster ARC / SHORT_BEAM inject an extra draw** (prior A1/A2).
    C's arc/short-beam handling draws a specific number of times; the port adds an extra
    draw. Re-derive from `mon-spell.c` / `project.c` and remove the extra draw so the stream
    matches. THIS IS A DRAW-COUNT FIX -- be precise.

## OUT OF SCOPE (other streams own these -- do not edit)
- RNG/determinism plumbing: `core/src/rng.ts`, `core/src/store/**`, `core/src/obj/flavor.ts`,
  `core/src/session/boot.ts`, `core/src/gen/**`, `core/src/game/mon-cmd.ts`,
  `web/src/main.ts`, `web/src/shop.ts`, `web/src/birth.ts`.
- Save/load: `core/src/save/**`, `core/src/session/save.ts`.
- Colour/palette: `core/src/color.ts`, `core/src/visuals/**`, `web/src/ui-colors.ts`.
- Effects/monster AI internals: `core/src/effects/**`, `core/src/mon/**` (except where an
  item above unavoidably requires it -- if so, keep the edit minimal and SAY SO).
- Do NOT touch `packages/borg/**`, `packages/linoleum/**`, or
  `packages/cli/baseline/stats-baseline.json`.

## Rules
- ONLY edit files under `packages/`. Never relax a test to make it pass -- a test may only
  change if the C justifies it, and you must say why.
- If an item turns out to be already correct (the audit can be stale), say so with evidence
  instead of changing code.

## Verify (chunked, with timeouts; NEVER a monolithic `pnpm test`)
`packages/borg` think/foundation tests HANG (pre-existing) -- always exclude borg.
```
pnpm typecheck
timeout 600 pnpm vitest run packages/core/src/combat packages/core/src/player --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/game --testTimeout=20000
timeout 600 pnpm vitest run packages/web --testTimeout=20000
```
Check each exit status (124 = hang: STOP and report which file).

## Report (stdout)
Per item: files changed, one-line summary, C citation matched, and whether it added/removed a
draw. Then test + typecheck results. Flag anything you could NOT do rather than forcing it.
End with: `PLAYER_COMBAT DONE <n>/10 tests <pass|fail>`. Do NOT commit or push. ASCII only.
