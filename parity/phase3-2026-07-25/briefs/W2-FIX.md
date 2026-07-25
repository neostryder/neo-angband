# W2-FIX — wire up the 22 NOT-WIRED findings

You are working in the worktree you were given. `reference/` is the **read-only
oracle** (original Angband 4.2.6). Never modify anything under `reference/`.

Input: `parity/phase3-2026-07-25/findings/W2-WIRING.md`, findings `W2-001` …
`W2-022`. Each names a port symbol that exists and is correct but that **nothing
in the live path calls**, with the C citation showing the C does reach it.

This is the project's most persistent defect shape — correct logic in a helper
the live path never calls — so the standard for "fixed" is that a **live entry
point reaches it**, not that a helper exists or a unit test passes.

## Priority order

1. **The ranged-attack learning cluster** (W2-001, W2-002, W2-010, W2-011) — one
   site, four findings. `reference/src/player-attack.c:1137-1140` calls
   `missile_learn_on_ranged_attack(p, obj)` then `equip_learn_on_ranged_attack(p)`
   immediately after a successful hit, and `:1255-1259` / `:1296-1299` do the
   brand/slay learning for launch and throw. The port's
   `packages/core/src/game/ranged-cmd.ts` goes straight from
   `makeRangedShot`/`makeRangedThrow` to describing the object. Today, **shooting
   and throwing never learn runes, brands or slays** — a real gameplay
   divergence. Verified independently by the gate; this citation is correct.
2. **W2-009 `wizCheatDeath`** (P1) — `reference/src/ui-display.c:2568-2573`
   registers a death-event handler that calls `wiz_cheat_death()`. The port has
   the function and no caller.
3. **W2-012 / W2-013** — `reference/src/obj-gear.c:881-884` identifies mushrooms
   and wand/staff "zappers" on pickup. The port's predicates have no caller, so
   that identification never happens.
4. **W2-014 / W2-015** spell browsing, **W2-016** `featIsTorch`,
   **W2-003** `pathNearestKnown`.
5. **The wizard-command cluster** (W2-004…W2-008) — `reference/src/cmd-core.c:135-137,170-171`
   registers `CMD_WIZ_CREATE_ALL_ARTIFACT`, `..._FROM_TVAL`,
   `CMD_WIZ_CREATE_ALL_OBJ`, `CMD_WIZ_TELEPORT_TO`, `CMD_WIZ_TWEAK_ITEM`. Wizard
   mode and cheat options are **in scope** for exact parity by standing mandate.
6. **W2-017…W2-022** — the `wiz-stats` entry points
   (`reference/src/wiz-stats.c`, a wizard command upstream) and their parameter
   defaults.

## Hard constraints

- **RNG draw order.** The base game must reproduce the C's RNG stream exactly. For
  every call you add, state whether it draws RNG in the C and where it sits
  relative to neighbouring draws. If a wiring fix would change the draw sequence,
  it is wrong — find the position that matches the C. Say explicitly, per fix,
  what the resulting draw sequence is.
- **Wire the LIVE path.** Trace from `packages/web/src/main.ts` (the real entry —
  `index.html` loads `/src/main.ts`) or from the command dispatch, and say which
  entry point now reaches each symbol.
- **Faithful UI.** Decision 6.1: the terminal is a faithful fixed 80x24 glyph
  grid. Wizard commands must prompt **in-terminal** like the C's
  `ui-wizard.c` — never `window.prompt`, `alert`, or a modal. An earlier stream
  shipped a `window.prompt` and it was rejected.
- Do not "improve" anything. Preserve upstream bugs and message wording.
- If a finding turns out to be WRONG on inspection, say so with the derivation
  instead of forcing a fix. Five of ten findings in an earlier batch were already
  correct in the port, and reporting that was the right answer.

## Verification

- Add a test per fix that exercises it **through the live path**, not by calling
  the helper directly. A test that calls the helper proves nothing about wiring —
  that is precisely how these 22 findings came to exist.
- Chunked test runs with a hard timeout, never a monolithic `pnpm test`:
  `timeout 600 pnpm vitest run <paths> --testTimeout=20000`
  (`packages/borg/src/{think,foundation}.test.ts` hang — pre-existing, unrelated,
  never run them.)
- `pnpm typecheck` must be clean.

## Deliverable

1. The code changes.
2. `parity/phase3-2026-07-25/findings/W2-FIX.md`: a table of
   `finding | fixed? | port file:line of the wiring | live entry path | RNG effect | test`,
   one row for all 22, plus a note for any you judged already-correct or wrong.

Commit nothing.
