# W2-FIX review

I accept the gate result: the suite result is 1503/1504, with the intended
unrelated S-3 failure, and the ranged-learning order is correct. The targeted
review tests also pass (43/43), but several of those tests verify a menu or a
helper rather than the live shell path.

## Verdict table

| finding | verdict | evidence |
|---|---|---|
| W2-001 `learnBrandSlayFromLaunch` | APPROVED | Live path is `main.ts` fire -> command buffer `fire` -> `installRangedCommands` -> `rangedHelper`. The call follows `makeRangedShot`, before `describeObject` and `monTakeHit`; no RNG. The fire test reaches the real command, although it asserts combat knowledge rather than a brand/slay rune. |
| W2-002 `learnBrandSlayFromThrow` | APPROVED | Live path is `main.ts` throw -> command buffer `throw` -> `rangedHelper`; the call follows `makeRangedThrow`, including explosion damage, before `monTakeHit`; no RNG. The throw test reaches the real command, with the same limited assertion. |
| W2-003 `pathNearestKnown` | DEFECTIVE | `navigate-up/down` and the `autoexplore_commands` fallback are live, and the path search adds no RNG or extra turn beyond C's immediate `run_step`. However, the live web target loop still explicitly omits the C `<`/`>` nearest-stair branches: `packages/core/src/game/target-loop.ts:346-349` and `packages/web/src/main.ts:2457-2460`. The target-panel half of the finding remains unwired. The added test covers only the new command/fallback. |
| W2-004 `wizCreateAllArtifact` | APPROVED | `^A` -> debug menu -> Items -> `create-artifact` -> in-terminal mode menu -> `wizCreateAllArtifact` is live. Creation uses only the RNG already required by object creation; the wiring adds none. The added test checks menu/helper symbols, not dispatch. |
| W2-005 `wizCreateAllArtifactFromTval` | APPROVED | `^A` -> Items -> `create-all-tval` -> in-terminal Artifacts choice and tval prompt -> helper. No extra RNG. The test does not drive this dispatch branch. |
| W2-006 `wizCreateAllObj` | APPROVED | `^A` -> Items -> `create-obj` -> in-terminal All ordinary objects choice -> helper. No extra RNG. The test does not drive this dispatch branch. |
| W2-007 `wizTweakItem` | DEFECTIVE | The menu reaches `wizTweakItem` through `^A` -> Play with item -> Tweak attributes, using in-terminal prompts and no new RNG. But the web action prompts only `to_a`, `to_h`, and `to_d` (`packages/web/src/wizard.ts:933-939`); C also prompts every object modifier and the ego/artifact fields (`reference/src/cmd-wizard.c:2737-2845`). This is a partial command, not a faithful wiring of the helper's full behavior. The added test only imports the helper and checks the menu surface. |
| W2-008 `wizTeleportTo` | APPROVED | `^A` -> Teleport -> To location -> `runTeleportTo` -> `wizTeleportTo` is live. The passability check and `EF_TELEPORT_TO` call remain the C path; no new RNG. The test verifies the menu target/helper symbol, not the dispatched action. |
| W2-009 `wizCheatDeath` | NOT-ACTUALLY-FIXED | The lethal `takeHit` path reaches `cheatDeath`, but `state.confirmDie` is never assigned. Thus wizard/`cheat_live` deaths always cheat and cannot answer C's `get_check("Die? ")`. The branch also fails to set `diedFrom` before the prompt, whereas C does so at `reference/src/player-util.c:239-248`. The added test intentionally exercises the helper factory without a shell confirmation and therefore cannot prove the missing seam. No RNG is added, but the death chain is behaviorally incomplete. |
| W2-010 `missileLearnOnRangedAttack` | APPROVED | Live fire/throw commands call the launcher (shot) and missile (shot/throw) learning in the C order, before description and `monTakeHit`; no RNG. The real-command tests reach the path. |
| W2-011 `equipLearnOnRangedAttack` | APPROVED | Same live ranged path and exact position as C `reference/src/player-attack.c:1137-1140`; no RNG. The test reaches the command but does not isolate equipment knowledge. |
| W2-012 `tvalIsMushroom` | DEFECTIVE | The pickup command reaches the predicate and uses `PF.KNOW_MUSHROOM`, with no RNG. But C performs the awareness block only on a non-combining insertion (`reference/src/obj-gear.c:862-887`); the port checks the returned stack after every carry (`packages/core/src/game/pickup.ts:247-289`) and can identify/message a mushroom while combining. The test covers ordinary insertion only. |
| W2-013 `tvalIsZapper` | DEFECTIVE | Same live pickup path, correct `PF.KNOW_ZAPPER`, and no RNG, but the same missing `!combining` guard diverges from `reference/src/obj-gear.c:862-887`. The test covers ordinary insertion only. |
| W2-014 `spellBookCountSpells` | APPROVED | `b`/`P` -> `browseCmd` -> count gate is live from `main.ts`; it adds no RNG and rejects a book with zero browseable spells. There is no wiring-level browse test in the added suite; this verdict is from the source path. |
| W2-015 `spellOkayToBrowse` | APPROVED | The same live browse path uses the predicate both for the empty-book gate and for disabling level-99 rows; no RNG. The code matches `reference/src/ui-spell.c:221-327`, but the added tests do not drive the browse UI. |
| W2-016 `featIsTorch` | APPROVED | Map redraw -> `terrainGlyph` calls `featIsTorch` and applies the C `LIGHTING.TORCH/LIT/DARK` color transforms; no RNG. The added test checks the predicate against `TF.TORCH`, not `terrainGlyph`, but the render call is live. |
| W2-017 `objMonStats` | APPROVED | CLI `main-stats` parses `--wiz-objmon` and its `main()` calls `runWizStats` -> `objMonStats`; the collector's existing draws remain seed-driven and dispatch adds none. The test calls `runWizStats`, not the process entry, but the process path is present. |
| W2-018 `pitStats` | APPROVED | CLI `--wiz-pits` reaches `runWizStats` -> `pitStats`; no dispatch RNG is added. The test exercises the dispatch function, not `main()`. |
| W2-019 `disconnectStats` | APPROVED | CLI `--wiz-disconnect` reaches `runWizStats` -> `disconnectStats`; no dispatch RNG is added. The test exercises the dispatch function, not `main()`. |
| W2-020 `DEFAULT_OBJ_MON_PARAMS` | APPROVED | `runWizStats` spreads the default object/monster parameter set before overrides; live through `--wiz-objmon`, with no RNG from the spread. The test checks `divingStep`. |
| W2-021 `DEFAULT_PIT_PARAMS` | APPROVED | `runWizStats` spreads the default pit parameter set before overrides; live through `--wiz-pits`, with no RNG from the spread. The test checks `pittype`. |
| W2-022 `DEFAULT_DISCONNECT_PARAMS` | APPROVED | `runWizStats` spreads the default disconnect parameter set before overrides; live through `--wiz-disconnect`, with no RNG from the spread. The test checks `stopOnDisconnect`. |

None of W2-001…W2-022 was a wrong original finding. The C citations and the
underlying missing-wiring claims remain valid. The ranged-learning order is
also accepted exactly as stated by the gate.

## Defects requiring correction

### W2-003 — target-panel nearest-stair navigation remains absent

Port: `packages/core/src/game/target-loop.ts:346-349` and
`packages/web/src/main.ts:2457-2460`.

The new `navigate-up/down` actions correctly reproduce the C command callers at
`reference/src/cmd-cave.c:1408-1493`, and the `ascend`/`descend` fallback matches
`reference/src/cmd-cave.c:56-112`. However, the other required live caller is
still missing: C's target loop invokes `path_nearest_known` on `>` and `<` at
`reference/src/ui-target.c:1506-1542`, using the cursor grid as the search
start. The port's target loop sends those keys through the generic direction
handler and its own comment says nearest stairs are deferred.

Correction: add the target-loop `<`/`>` branches, calling
`pathNearestKnown(state, currentCursor, isDownstairs/isUpstairs)` and moving the
cursor to the returned destination (with the C bell-on-failure behavior), then
repaint the target panel. This is RNG-free and must not spend energy; it is a UI
cursor operation, unlike `navigate-up/down`.

### W2-007 — only three of the C tweak fields are surfaced

Port: `packages/web/src/wizard.ts:898-942`.

The helper is reached, but the UI stops after AC/to-hit/to-dam. C's
`do_cmd_wiz_tweak_item` prompts ego and artifact first and then loops over every
`OBJ_MOD_MAX` modifier before those three fields at
`reference/src/cmd-wizard.c:2737-2845`. The core helper already accepts
`ego`, `artifact`, and `modifiers` at `packages/core/src/game/wizard.ts:930-956`,
so the new wiring silently exposes only a subset of the command.

Correction: add in-terminal prompts for the ego/artifact selection and every
object modifier, pass all supplied values to `wizTweakItem`, and preserve the C
follow-up behavior (`ego_apply_magic`/artifact data and the accept/reject
upkeep). Any ego/artifact generation must retain the C RNG operations and their
order; the current scalar-only branch itself draws no RNG.

### W2-009 — cheat-death confirmation and pre-prompt death state are missing

Port: `packages/core/src/game/context.ts:447` declares `confirmDie`, but no
live shell assigns it; `packages/core/src/game/take-hit-hooks.ts:79-110` reads
it. The web precedent, `packages/web/src/overlay.ts:348-374`, is asynchronous
and in-terminal. A synchronous callback cannot be filled with that Promise, and
`window.prompt`, `confirm()`, `alert()`, or a modal is not an acceptable
replacement.

The C sequence is explicit: after the fatal damage and bloodlust branch, C
copies `kb_str` to `p->died_from` at `reference/src/player-util.c:239-245`,
then asks `get_check("Die? ")` at `:246-248`; only a final death clears
`total_winner` and sets `is_dead` at `:249-261`. The port's `onDeath` callback
does not run on a cheat, so a cheated blow loses the C `diedFrom` assignment.

Correction: this needs an async/pending-death seam in the current chain, not
just another optional synchronous field. Preserve the killer in player state
before suspending, render an inline GlyphTerm `[y/n]` prompt, and resume the
fatal decision with the answer. On resume, `yes` must continue the normal death
message/`totalWinner`/`isDead` path; `no` must invoke `wizCheatDeath`. The
pre-prompt `diedFrom` assignment must happen for both answers. The prompt and
state assignment add no RNG, and the bloodlust roll must remain before the
confirmation exactly as in C.

### W2-012 / W2-013 — pickup awareness runs on combining pickups

Port: `packages/core/src/game/pickup.ts:247-289`.

The C block is inside `if (!combining)` at `reference/src/obj-gear.c:862-887`:
flavor awareness and the mushroom message happen only after a new object is
inserted. The port discards that distinction and examines `gearGet(..., handle)`
after `invenCarry` for both full and partial/combining carries. That can trigger
the identification side effect on a combine where C would not.

Correction: have the carry operation return whether it inserted a new object (or
otherwise preserve the existing `combining` bit), and gate both `tvalIsMushroom`
and `tvalIsZapper` blocks on `!combining`. Keep the current flag predicates,
awareness call, message, and RNG-free placement for the non-combining branch.

## Change-scope issues

The diff also deletes unrelated tracked material: the effect coverage test
`packages/core/src/game/effect-coverage.test.ts`, and parity briefs/findings/tool
files including `c-api-allowlist.json`, `tools/c-api.mjs`,
`tools/gen-allowlist.mjs`, `findings/W2-WIRING.md`, and the S3/W1 review inputs.
Those deletions are outside the 22 wiring fixes and remove a regression guard and
review artifacts. They should be restored separately; the present untracked W2
reports do not make those deletions in `git diff master` in-scope.

## Whole-change verdict

**REWORK.** The ranged, browse, torch, wizard-teleport, and CLI-stat wiring is
substantially live and RNG-safe, but the P0 death chain is not faithful, the
confirmation seam is not implemented, target-panel stair navigation remains
missing, pickup has a combine-path divergence, and the change deletes unrelated
review/test files.
