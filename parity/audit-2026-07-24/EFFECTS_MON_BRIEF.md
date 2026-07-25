# Effects + Monsters Parity Brief (worktree: C:\Repositories\na-wt-fx, branch parity/p1-effects-mon)

`reference/` is the ORACLE (Angband 4.2.x). Match the C exactly; cite the C file:line in a
comment for every change. Preserve faithful upstream bugs -- do NOT "improve" the C.

## SEED PARITY (Decision 6.2)
The base game must reproduce the C's EXACT RNG stream: same draw ORDER and COUNT. Some items
below ADD a draw the C makes and the port omits -- put it in the C's exact position. Never add
a draw the C does not make, and never reorder existing ones.

## IN SCOPE

### Effects / projection
1. **EF_SELECT never prompts; always randomises for the player** (grok+codex agree; the
   single most player-visible item here).
   C `effects.c:425-460`: for a PLAYER-origin EF_SELECT with 2+ sub-effects, the C calls the
   command/UI chooser (`cmd_get_effect_from_list` / `get_effect_from_list`); choice -2 (random)
   applies ONLY when the player actually picks random, and cancelling returns false.
   `ui-effect.c:34-180` (`textui_get_effect_from_list`) is the menu: rows named by
   `effect_get_menu_name` (`effects-info.c:583`) plus a "one of the following at random" row.
   Port: no live `chooseEffect` is ever injected (only unit tests supply one), so every
   player-origin SELECT silently falls through to `randint0(choice_count)`. Gamedata uses this
   for dual-breath devices/activations, so players are losing a real choice.
   FIX: implement the chooser UI and wire it into the live effect env; keep the C's RNG
   behavior (a draw ONLY when random is chosen) and honour cancel.
2. **PF_CHARM is never passed into project_m** (grok+codex agree).
   C `project-mon.c`: the nature-mage PF_CHARM animal boost is passed into `project_m`.
   Port never forwards it, so the boost never applies. FIX.
3. **PROJECT_INFO / square_isbelievedwall approximated by the real map** (grok+codex agree).
   C `project.c` uses the player's BELIEVED map (`square_isbelievedwall`) for PROJECT_INFO
   pathing, not ground truth. Port consults the real map, leaking knowledge and changing
   paths. FIX: use the believed-map predicate the C uses.
4. **WEAPON_DAMAGE expression base never bound for object/curse chains** (grok).
   C `effects.c:308-315` `effect_value_base_weapon_damage` = `damroll(obj->dd, obj->ds) + obj->to_d`.
   The "treacherous weapon" curse (`curse.txt`: `effect:DAMAGE dice:$B expr:B:WEAPON_DAMAGE:+ 0`)
   therefore deals the equipped weapon's rolled base damage. Port evaluates the base as 0, so
   the curse deals 0 HP -- and MISSES the damroll draws. FIX: bind the expression base
   (note: this ADDS the C's damroll draws in the C position).

### Monsters
5. **monster_attack_monster skips blow effects and armour** (grok+codex agree).
   C `mon-attack.c`: a monster attacking another monster still applies blow effects and the
   target's armour. Port skips both. FIX.
6. **process_monster_timed silently decrements instead of mon_dec_timed** (grok+codex agree).
   C `mon-move.c` routes timed decrements through `mon_dec_timed`, which fires the
   message/side-effect chain. Port decrements the counter directly, so wake/recover messages
   and side effects never happen. FIX.
7. **Monster swaps omit camouflage + visibility updates** (codex).
   C `mon-util.c:566` `monster_swap` updates camouflage awareness, moves mimicked objects, and
   refreshes monster visibility, light, distance and redraw state. Port `monsterSwap` only
   exchanges square occupants and coordinates. FIX to the C's full update set.
8. **Remaining L5 monster P1s.** Codex logged further monster P1s (see
   `parity/audit-2026-07-24/findings/codex/L5_monsters.md`) and grok logged more in
   `findings/grok/L5_monsters.md`. Work through them, EXCLUDING anything about the
   monster-vs-monster blow MESSAGE + its `randint0(num_messages)` draw (another stream owns
   `game/mon-cmd.ts` for that). For each: fix it, or state with evidence that it is already
   correct / stale.

## OUT OF SCOPE (other streams own these -- do not edit)
- `core/src/game/mon-cmd.ts` (mon-vs-mon blow message/draw -- RNG stream owns it).
- RNG plumbing: `core/src/rng.ts`, `core/src/store/**`, `core/src/obj/flavor.ts`,
  `core/src/session/boot.ts`, `core/src/gen/**`, `web/src/main.ts`, `web/src/shop.ts`,
  `web/src/birth.ts`.
- Save/load: `core/src/save/**`, `core/src/session/save.ts`.
- Colour/palette: `core/src/color.ts`, `core/src/visuals/**`, `web/src/ui-colors.ts`.
- Player/combat items: `core/src/combat/**`, `core/src/player/**` (except where an item above
  unavoidably requires a touch -- keep it minimal and SAY SO).
- Trap/dungeon generation (`core/src/gen/**`) -- a later stream owns it.
- Do NOT touch `packages/borg/**`, `packages/linoleum/**`, or
  `packages/cli/baseline/stats-baseline.json`.

## Rules
- ONLY edit files under `packages/`. Never relax a test to make it pass -- a test may only
  change if the C justifies it, and say why.
- For item 1, the chooser is UI: keep it behind the existing prompt/UI seam and do NOT couple
  game logic to the GlyphTerm renderer (the cell-grid render seam must stay swappable).
- If an item is already correct (the audit can be stale), say so with evidence instead of
  changing code.

## Verify (chunked, with timeouts; NEVER a monolithic `pnpm test`)
`packages/borg` think/foundation tests HANG (pre-existing) -- always exclude borg.
```
pnpm typecheck
timeout 600 pnpm vitest run packages/core/src/effects packages/core/src/mon --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/game --testTimeout=20000
timeout 600 pnpm vitest run packages/web --testTimeout=20000
```
Check each exit status (124 = hang: STOP and report which file).

## Report (stdout)
Per item: files changed, one-line summary, C citation matched, and whether it added/removed a
draw. Then test + typecheck results. Flag anything you could NOT do rather than forcing it.
End with: `EFFECTS_MON DONE <n>/8 tests <pass|fail>`. Do NOT commit or push. ASCII only.
