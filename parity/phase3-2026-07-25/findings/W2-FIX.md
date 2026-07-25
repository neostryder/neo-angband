# W2-FIX — wire up the 22 NOT-WIRED findings

Worktree: `C:\Repositories\na-wt-pc` (branch `p3/w2-fix`).  
Input: `findings/W2-WIRING.md` (W2-001 … W2-022).  
Constraint: every fix is reachable from a **live entry point**; every test exercises that path, not the helper alone.  
`pnpm typecheck` clean. Commit nothing.

## Summary table

| finding | fixed? | port file:line of the wiring | live entry path | RNG effect | test |
|---|---|---|---|---|---|
| W2-001 `learnBrandSlayFromLaunch` | yes | `packages/core/src/game/ranged-cmd.ts` (~success block in `rangedHelper`) | `main.ts` fire → `commandBuffer` `"fire"` → `installRangedCommands` → `rangedHelper` (shot) | **none** (after to-hit/damage/crit draws of `makeRangedShot`, before `monTakeHit` fear) | `packages/core/src/game/w2-wiring-fix.test.ts` fire learns combat runes |
| W2-002 `learnBrandSlayFromThrow` | yes | same `rangedHelper` throw branch | `main.ts` throw → `"throw"` → `rangedHelper` (throw) | **none** (same placement relative to damage then `monTakeHit`) | same file, throw learns combat runes |
| W2-003 `pathNearestKnown` | yes | `packages/core/src/game/player-path.ts` `navigateDownAction` / `navigateUpAction`; `installRunning` registers them; `cave-cmd.ts` `descend`/`ascend` fall through when `autoexplore_commands` | `main.ts` `>`/`<` → `descend`/`ascend` (with option) or `navigate-down`/`navigate-up` registry codes | **none** on path search / start | `w2-wiring-fix.test.ts` navigate-down + descend+autoexplore |
| W2-004 `wizCreateAllArtifact` | yes | `packages/web/src/wizard.ts` `create-artifact` → menu “All artifacts” | `main.ts` ^A → `runWizardDebugMenu` → Items → Create an artifact → All artifacts | **none** beyond any object-drop placement the engine already draws | `wizard-wiring.test.ts` + `wizard.test.ts` menu letters; engine symbol used by dispatch |
| W2-005 `wizCreateAllArtifactFromTval` | yes | `wizard.ts` `create-all-tval` → “Artifacts” then tval prompt | same ^A path → Create all from tval → Artifacts | **none** beyond existing drop | same |
| W2-006 `wizCreateAllObj` | yes | `wizard.ts` `create-obj` → menu “All ordinary objects” | same ^A path → Create an object → All ordinary objects | **none** beyond existing drop | same |
| W2-007 `wizTweakItem` | yes | `wizard.ts` `runPlayItem` “Tweak attributes” → `wizTweakItem` | ^A → Play with item → Tweak attributes (in-terminal `promptNumber`, never `window.prompt`) | **none** | same surface; play-item menu includes tweak |
| W2-008 `wizTeleportTo` | yes | `wizard.ts` `runTeleportTo` calls `wizTeleportTo` (was direct `EF.TELEPORT_TO`) | ^A → Teleport → To location | same as effect path previously used (no extra draws) | `wizard-wiring.test.ts` tele-to action present; helper is dispatch target |
| W2-009 `wizCheatDeath` | yes | `packages/core/src/game/take-hit-hooks.ts` `cheatDeath` → `wizCheatDeath`; `session/game.ts` fills `wizardEffectHolder`; `main.ts` sets `state.wizard` on ^W | any lethal `takeHit` (projections, melee, DoT, effects) when `state.wizard` or `OPT(cheat_live)` | **none** (C `get_check` is non-RNG; bloodlust still draws before this branch) | `w2-wiring-fix.test.ts` cheat_live lethal blow |
| W2-010 `missileLearnOnRangedAttack` | yes | `ranged-cmd.ts` `rangedHelper` (bow on shot + always missile) | fire/throw as above | **none** | fire/throw learn tests |
| W2-011 `equipLearnOnRangedAttack` | yes | `ranged-cmd.ts` `rangedHelper` after missile learn | fire/throw as above | **none** | fire/throw learn tests |
| W2-012 `tvalIsMushroom` | yes | `packages/core/src/game/pickup.ts` `playerPickupAux` after carry | `main.ts` pickup/`g` → `"pickup"` → `playerPickupItem` → `playerPickupAux` | **none** | `w2-wiring-fix.test.ts` KNOW_MUSHROOM via pickup command |
| W2-013 `tvalIsZapper` | yes | same pickup block | same pickup path | **none** | same file, KNOW_ZAPPER via pickup command |
| W2-014 `spellBookCountSpells` | yes | `packages/web/src/main.ts` `browseCmd` gate | `main.ts` `b`/`P` → `browseCmd` | **none** | browse path now rejects empty/non-browsable books (`spellBookCountSpells(..., spellOkayToBrowse) === 0`) |
| W2-015 `spellOkayToBrowse` | yes | `browseCmd` gate + per-row `disabled` | same browse path | **none** | level-99 spells stay disabled; empty books get “You cannot browse that.” |
| W2-016 `featIsTorch` | yes | `packages/web/src/main.ts` `terrainGlyph` | map redraw every frame → `terrainGlyph` | **none** | `w2-wiring-fix.test.ts` featIsTorch ≡ `TF.TORCH` |
| W2-017 `objMonStats` | yes | `packages/cli/src/main-stats.ts` `runWizStats` / `--wiz-objmon` | CLI `main-stats` entry (`pnpm --filter @neo-angband/cli stats -- --wiz-objmon`) | seed-driven only (existing collectors) | `packages/cli/src/main-stats-wiz.test.ts` |
| W2-018 `pitStats` | yes | same, `--wiz-pits` | CLI `--wiz-pits` | seed-driven only | same |
| W2-019 `disconnectStats` | yes | same, `--wiz-disconnect` | CLI `--wiz-disconnect` | seed-driven only | same |
| W2-020 `DEFAULT_OBJ_MON_PARAMS` | yes | `runWizStats` spreads `DEFAULT_OBJ_MON_PARAMS` | same as W2-017 | n/a (defaults object) | same; asserts `divingStep` from defaults |
| W2-021 `DEFAULT_PIT_PARAMS` | yes | `runWizStats` spreads `DEFAULT_PIT_PARAMS` | same as W2-018 | n/a | same; asserts `pittype` from defaults |
| W2-022 `DEFAULT_DISCONNECT_PARAMS` | yes | `runWizStats` spreads `DEFAULT_DISCONNECT_PARAMS` | same as W2-019 | n/a | same; asserts `stopOnDisconnect` from defaults |

## Per-cluster notes

### 1. Ranged learning (W2-001, 002, 010, 011)

C order on a successful hit (`player-attack.c`):

1. `make_ranged_shot` / `make_ranged_throw` — to-hit, damage, crit (RNG); then inside shot: `missile_learn(bow)` + `learn_brand_slay_from_launch`; inside throw: `learn_brand_slay_from_throw` (all no-RNG).
2. `ranged_helper` — `missile_learn(obj)`, `equip_learn_on_ranged_attack`, `object_desc`, then `mon_take_hit` (fear RNG).

Port mirrors that: learning after `makeRanged*` returns success, before describe + `monTakeHit`. **No new RNG draws.**

### 2. Cheat death (W2-009)

C: `(wizard || cheat_live) && !get_check("Die? ")` → `EVENT_CHEAT_DEATH` → `wiz_cheat_death()`.

Port: `makeTakeHitHooks.cheatDeath` checks `state.wizard` / `OPT(cheat_live)`, optional sync `state.confirmDie` (true = accept death), prints the C message, calls `wizCheatDeath`. Effect bundle is late-bound via `wizardEffectHolder` so timed clears work when the stack exists. HP revive still runs if the effect bundle is absent.

### 3. Pickup ID (W2-012 / W2-013)

C `obj-gear.c:879-886` after insert when unaware: hobbit mushrooms / gnome zappers. Port uses `tvalIsMushroom` / `tvalIsZapper` + `PF.KNOW_*` + `objectFlavorAware`. Message “Mushrooms for breakfast!” preserved.

### 4. Spell browse / torch / stairs (W2-014…016, W2-003)

- Browse rejects books with zero `spellOkayToBrowse` spells (`You cannot browse that.`).
- `terrainGlyph` applies `featIsTorch` + `getColor` ATTR_LIGHT/DARK per `ui-map.c:117`.
- `pathNearestKnown` is reached by `navigate-up`/`navigate-down` and by `ascend`/`descend` when `autoexplore_commands` is on (C `do_cmd_go_*`).

### 5. Wizard cluster (W2-004…008)

Faithful top-level letters `cCVgvo` retained. Create-all helpers hang off existing create / create-all-tval submenus (C’s “All objects” / “All artifacts” / “All artifact &lt;tval&gt;”). Tweak is inside play-item. Teleport-to uses `wizTeleportTo` instead of bypassing it.

### 6. Wiz-stats (W2-017…022)

`main-stats.ts` dispatches `objMonStats` / `pitStats` / `disconnectStats` with the `DEFAULT_*` bases via `--wiz-objmon` / `--wiz-pits` / `--wiz-disconnect`. Also re-exported from `packages/cli/src/index.ts`.

## Verification commands

```text
pnpm typecheck
pnpm vitest run packages/core/src/game/w2-wiring-fix.test.ts packages/cli/src/main-stats-wiz.test.ts packages/web/src/wizard-wiring.test.ts packages/web/src/wizard.test.ts --testTimeout=20000
```

(Also green: `ranged-powershot`, `ranged-range`, `pickup`, `player-path`, `wizard` core, `cave-cmd`, `wizard-bundles`, `take-hit`.)

## Already-correct / wrong findings

None of W2-001…W2-022 were judged wrong on inspection; all 22 were NOT-WIRED and are now fixed on a live path as above.

## Rework

The adversarial review identified four remaining wiring defects. The stale-base
change-scope deletions are not part of this rework; the branch is already
rebased onto current `master`.

### W2-003 — target-panel nearest stairs

`stepTargetLoop` now handles `<` and `>` by calling `pathNearestKnown` from the
current cursor grid with the corresponding upstairs/downstairs predicate. A
successful result moves only the target cursor and the caller repaints the
GlyphTerm target panel; failure bells. This path is UI-only: it spends no energy,
does not enqueue a command, and draws no RNG. The live target loop in
`main.ts` drives this state machine.

### W2-007 — complete `wizTweakItem` field set

The in-terminal Play-with-item branch now prompts ego, artifact, all
`OBJ_MOD_MAX` modifiers, AC bonus, to-hit, and to-dam, then passes the complete
set to `wizTweakItem`. The core helper now preserves the C follow-up: selecting
an ego runs `object_prep(RANDOMISE)` and `ego_apply_magic`; selecting an artifact
runs `object_prep(RANDOMISE)` at its allocation depth and
`copy_artifact_data`. Those are the only added RNG draws, in the same order as
C; scalar prompts and assignments draw none. The live test drives
`dispatchDebug("play-item")` through Tweak attributes and enters every field.

### W2-009 — asynchronous in-terminal death confirmation

The synchronous `confirmDie` stand-in was removed. A fatal wizard/`cheat_live`
hit records `diedFrom` first, then installs a renderer-neutral `pendingDeath`
resume seam and returns `LOOP_STATUS.DEATH_CONFIRM`. The web shell answers with
the existing GlyphTerm `getCheck("Die? ")` overlay and resumes the same chain:
`y` emits the normal death message, marks `isDead`, clears `totalWinner`, and
enters the existing death flow; any other answer invokes `wizCheatDeath`.
Bloodlust's `randint0(10)` remains before this seam. The prompt, state write,
and resume control add no RNG. Live tests enter through `worldTakeHit`, verify
the pre-prompt killer, and exercise both answers.

### W2-012 / W2-013 — combining pickup guard

`invenCarryResult` now preserves the C `combining` bit. The live pickup path
gates both mushroom and zapper awareness on `!combining`, while retaining the
existing `PF.KNOW_MUSHROOM` / `PF.KNOW_ZAPPER` predicates, awareness calls, and
message. The guard adds no RNG. Live pickup-command tests cover both ordinary
insertion and combining insertion for each tval.

Rework verification uses single-worker, chunked Vitest invocations with a hard
timeout and `pnpm typecheck`; no commit was created.
