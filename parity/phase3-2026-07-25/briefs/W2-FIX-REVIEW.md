# W2-FIX review — adversarially verify the 22 wiring fixes

You are reviewing another engine's work. `reference/` is the **read-only oracle**
(original Angband 4.2.6). Never modify anything under `reference/`.

The change under review is in this worktree (`git diff master`): 12 files, ~526
insertions, claiming to fix all 22 `NOT-WIRED` findings in
`parity/phase3-2026-07-25/findings/W2-WIRING.md`. The author's own report is
`parity/phase3-2026-07-25/findings/W2-FIX.md`.

## What the gate already established — do not redo, but say if you disagree

- **The suite is genuinely green.** 1503 of 1504 tests pass in this worktree; the
  single failure is `parity-c-stat.test.ts`, which is red on purpose for an
  unrelated open finding (S-3, the monster species mix).
- **The ranged-learning order is correct.** The C's true sequence for a shot is:
  inside `make_ranged_shot`, `missile_learn_on_ranged_attack(p, bow)` then
  `learn_brand_slay_from_launch(p, ammo, bow, mon)`
  (`reference/src/player-attack.c:1258-1259`); then back in `ranged_helper`,
  `missile_learn_on_ranged_attack(p, obj)` for the ammo and
  `equip_learn_on_ranged_attack(p)` (`:1137-1140`); then `object_desc`, the
  messages, and `mon_take_hit`. The port reproduces exactly that order, and none
  of those calls draws RNG.

## A gate finding the author must address — verify and complete it

**`state.confirmDie` is declared and nothing assigns it.** The new cheat-death
hook reads `state.confirmDie?.()`, and `packages/core/src/game/context.ts:447`
declares it, but no shell sets it. Consequences to check:

- The C is `if ((p->wizard || OPT(p, cheat_live)) && !get_check("Die? "))`
  (`reference/src/player-util.c:246-248`). `get_check` defaults to **no**, so the
  C's default really is to cheat — the port's "absent means cheat" matches that.
- But with `confirmDie` never supplied, a wizard/`cheat_live` character can
  **never choose to die**: every death cheats. That is a change to normal
  wizard-mode behaviour, and arguably worse than the gap it replaced.
- The blocker is that `confirmDie` is synchronous while the web shell's
  in-terminal `getCheck` (`packages/web/src/overlay.ts:355`) returns a Promise.
  Note the precedent: the `EF_SELECT` fix solved the same synchronous-prompt
  problem with an in-terminal overlay on the GlyphTerm grid, after a
  `window.prompt` version was rejected under decision 6.1. **A `window.prompt`,
  `confirm()`, `alert()` or modal is not acceptable here either.**

Judge whether this is fixable within the current death chain or needs an async
seam, and say which. Do not accept "the hook exists" as fixed — this is the exact
defect class the 22 findings are made of.

## Then review everything else

Highest risk first:

1. **`packages/core/src/game/take-hit-hooks.ts`** carries the P0 death chain
   (message, bell, `diedFrom`, `totalWinner`). Verify every one of those still
   fires on every path, and that the new cheat-death branch cannot swallow a
   normal death. A regression here is a game-breaker.
2. **`packages/core/src/game/player-path.ts`** (+94) for `pathNearestKnown`
   against `reference/src/player-path.c:834` and its callers
   (`cmd-cave.c:1434,1480`; `ui-target.c:1509,1528`). Check the pathing
   semantics and that no extra RNG draw or turn cost appears.
3. **`packages/core/src/game/pickup.ts`** mushroom/zapper identification against
   `reference/src/obj-gear.c:881-884` — the right `KNOW_*` flag, at the right
   point in the pickup sequence.
4. **`packages/web/src/wizard.ts`** (+83) and **`main.ts`** (+44): every wizard
   command must prompt **in-terminal** like `reference/src/ui-wizard.c`, and the
   menu letters must match the C's set.
5. **`packages/cli/src/main-stats.ts`** (+139) wiz-stats entry points against
   `reference/src/wiz-stats.c`.
6. `context.ts`, `session/game.ts`, `cave-cmd.ts`, `wizard.ts`, `ranged-cmd.ts`.

For every fix, answer three questions:

- **Does a LIVE entry point reach it?** Trace from `packages/web/src/main.ts`
  (`index.html` loads `/src/main.ts`) or from command dispatch. "It is exported"
  and "a test calls it" are not live paths.
- **Does it change the RNG draw sequence?** The base game must reproduce the C's
  stream. State the sequence where it is not obviously unchanged.
- **Does the test prove the WIRING or just the helper?** A test that calls the
  helper directly proves nothing here — that is how these 22 findings arose.

Also flag: anything the author changed beyond the 22 findings; any fix whose
finding was actually wrong (say so, with the derivation); and any C behaviour the
fix silently improved on. Faithful means faithful, upstream bugs included.

## Deliverable

`parity/phase3-2026-07-25/findings/W2-FIX-REVIEW.md`:

1. Verdict table: `finding | APPROVED / DEFECTIVE / NOT-ACTUALLY-FIXED | evidence`,
   one row for all 22.
2. One block per defect: port file:line, what is wrong, the C citation, and the
   concrete correction.
3. A verdict on the whole change: **merge / merge after listed fixes / rework**.

Review only — do not modify port source files. Commit nothing.
