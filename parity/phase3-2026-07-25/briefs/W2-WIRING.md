# W2 — Adjudicate the wiring suspects

You are working in `C:\Repositories\neo-angband` (or the worktree you were
given). `reference/` is the **read-only oracle** (original Angband 4.2.6). Never
modify anything under `reference/`.

## Why this exists

The 2026-07-24 parity audit's dominant defect shape was **correct logic sitting
in a helper the live path never calls**: a decoy restored into a dead local, a
Free Action hook never supplied, an `EF_SELECT` chooser built and never wired.
Every one passed its author's unit tests. Code review does not catch it, and
neither does a green suite.

`parity/phase3-2026-07-25/tools/census.mjs` now finds candidates mechanically. It
builds an import graph from the real entry points (`packages/web/src/main.ts` and
the CLI mains) plus a token-level reference graph, and classifies every port
symbol. Your job is to rule on the residue.

## Input

`parity/phase3-2026-07-25/reports/w2-wiring-suspects.tsv` — 212 rows, columns
`status name kind file line prodRefs testRefs reachableRefs selfRefs`:

| status | meaning |
|---|---|
| `MODULE-UNREACHABLE` (97) | the symbol's whole module is unreachable from any entry point |
| `TEST-ONLY` (58) | exported, and referenced only by test files |
| `ORPHAN` (48) | exported, referenced nowhere at all |
| `DEAD-LOCAL` (6) | module-local, never used in its own file |
| `REF-UNREACHABLE` (3) | referenced only by modules that are themselves unreachable |

Also `reports/w2-unreachable-modules.txt` — the 26 unreachable modules.

The tool over-reports by design. A verdict of "benign" is a perfectly good
outcome; an unjustified one is not.

## Verdicts

For **every** row, emit exactly one:

- **LIVE-VIA** — it *is* reached in normal play; the tool missed the path
  (dynamic dispatch through a registry or handler table, a string-keyed lookup,
  a re-export barrel, a worker entry). Cite the concrete call path from an entry
  point: `main.ts:NNN → x.ts:NNN → the symbol`.
- **BENIGN** — legitimately unreferenced, with the reason: a constant or table
  exported for completeness (e.g. the full `z-color.c` colour set, generated
  flag tables), a mod-API seam that ships unused by design, a save-format reader
  kept for compatibility, a CLI-only tool. Say which.
- **NOT-WIRED** — a finding. The C counterpart *is* reached during play (or in
  wizard mode, which is in scope), and the port's is not. Cite the C.

## Seeded leads — already verified against the C, confirm and complete them

1. **Wizard-mode commands.** `packages/core/src/game/wizard.ts` exports
   `wizCheatDeath`, `wizCreateAllArtifact`, `wizCreateAllArtifactFromTval`,
   `wizCreateAllObj`, `wizTweakItem`, `wizTeleportTo`, `wizStatItem`,
   `wizEditPlayerExp`, `wizEditPlayerStart`, `wizDropObject`,
   `wizCreateObjectFromArtifact`, `wizCreateObjectFromKind` — several of which
   the web wizard UI (`packages/web/src/wizard.ts`) never exposes. In the C these
   are live: `reference/src/cmd-core.c:135-137,171` registers
   `CMD_WIZ_CREATE_ALL_ARTIFACT`, `..._FROM_TVAL`, `CMD_WIZ_CREATE_ALL_OBJ`,
   `CMD_WIZ_TWEAK_ITEM` in the game command table, and `wiz_cheat_death()` is
   invoked from the death event handler at `reference/src/ui-display.c:2568-2573`.
   The standing mandate puts wizard mode and cheat options **in scope for exact
   parity**. Cross-check the port's full wizard command surface against the C's
   `CMD_WIZ_*` set and report every command the C has and the port cannot reach.
2. **`packages/mod-sdk/**` is unreachable from the running game.** Aaron's rule:
   the mod framework ships with the port but stays **unused** — meaning no mods
   are loaded, not that the loader is absent from boot. Decide whether the game
   can load a mod at all today, and report what is missing if not.
3. **`packages/content/**` is unreachable**: gamedata is parsed at build time and
   the compiled pack is committed. That is a ratified browser concession —
   expected `BENIGN`. (A separate stream is building the field-level test that
   keeps the committed pack honest.)
4. **Ranged-attack rune/brand learning** is test-only:
   `equipLearnOnRangedAttack` (`packages/core/src/obj/knowledge.ts:601`),
   `missileLearnOnRangedAttack` (`:561`), `learnBrandSlayFromLaunch`
   (`packages/core/src/combat/brand-slay.ts:337`), `learnBrandSlayFromThrow`
   (`:353`). In the C, `equip_learn_on_ranged_attack` and friends are called from
   the ranged-attack path (`reference/src/player-attack.c`). If the port's
   shoot/throw path does not call them, ranged rune learning silently never
   happens.
5. **`packages/core/src/game/energy.ts`**: `canAct`, `gainEnergy`, `spendEnergy`,
   `NORMAL_SPEED` are test-only; the live path uses `scheduler.ts` with
   `turnEnergy`. Verify `scheduler.ts` matches `reference/src/game-world.c`'s
   energy handling exactly, then rule on whether energy.ts is a dead duplicate
   (`BENIGN`, but say so) or the correct implementation being bypassed
   (`NOT-WIRED`).
6. **`packages/cli/src/wiz-stats.ts`** has no live caller, but `wiz-stats.c` is a
   wizard command in the C (`reference/src/wiz-stats.c`, reachable from the
   wizard menu). Rule on it.
7. **`packages/web/src/screens.ts`**: `packHandles` (`:233`) and `equipmentMenu`
   (`:387`) are orphaned. Determine whether the inventory/equipment screens the
   player actually sees use them, and if not, whether the live substitute matches
   the C's `ui-object.c` behaviour.
8. **Spell browsing**: `spellBookCountSpells`
   (`packages/core/src/player/spell.ts:221`) and `spellOkayToBrowse` (`:247`) are
   orphaned. Compare against the C's browse path
   (`reference/src/cmd-obj.c` / `ui-spell.c`).

## Method

- **C is the oracle.** Every `NOT-WIRED` cites `reference/...:line` showing the C
  counterpart is reached in normal play.
- **Verify by re-derivation.** Never trust a comment, a test name, or the
  symbol's own name.
- **Trace the live path** from an entry point. "It's exported from index.ts" is
  not a live path; a barrel re-export is not a caller.
- Read the code. Do not infer wiring from naming.

## Deliverable

`parity/phase3-2026-07-25/findings/W2-WIRING.md`:

1. A table with one row per input row: `status | symbol | file:line | verdict |
   evidence` — where evidence is the live call path (LIVE-VIA), the reason
   (BENIGN), or the C citation (NOT-WIRED). **All 212 rows must appear.**
2. Then one block per `NOT-WIRED`:
   ```
   ### W2-NNN  <symbol>
   port:      <path>:<line>
   ref:       reference/src/<file>.c:<line>
   c-path:    <how the C reaches it in normal play>
   port-gap:  <what the port does instead, or that nothing calls it>
   effect:    <the player-visible divergence>
   severity:  P0|P1|P2|P3
   confidence: high|medium|low
   ```
3. A short "tool blind spots" section: any *pattern* of live wiring the census
   could not see (dynamic registries, string keys, worker entries), so the tool
   can be improved rather than the same false positives re-triaged next time.

Do not fix anything in this task, and do not modify port source files —
adjudication only. Commit nothing.
