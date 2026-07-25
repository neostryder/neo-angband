# EFFECTS_MON independent adversarial review (Grok)

Worktree: `C:\Repositories\na-wt-fx` branch `parity/p1-effects-mon`
Diff reviewed: `EFFECTS_MON_FIX.diff` + live worktree (incl. untracked `effect-choice.ts`)
Oracle: `reference/` (Angband 4.2.x)
Method: re-derive each claim against C citations and live call paths. Skeptical default: flag if uncertain.
Codex claim: 6/8 done, items 5 + part of 8 blocked on `mon-cmd.ts`.

---

## Blocked scope (item 5 / mon-cmd message draw)

**CONFIRMED legitimate block.**

- `packages/core/src/game/mon-cmd.ts` is NOT in the fix diff and is unmodified on the branch.
- Working-tree object hash equals `HEAD:packages/core/src/game/mon-cmd.ts` (`d7b65d927da640c4f8fe5cbe9407121dc217ea75`).
- Do NOT count mon-vs-mon blow effects/armour (item 5) or mon-vs-mon blow message / `randint0(num_messages)` (item 8 mon-cmd subset) against this patch.

---

## Per-item verdicts

### 1. EF_SELECT player prompt — ISSUE

**What the patch did**

| Area | Location | Notes |
|------|----------|--------|
| Cancel if no chooser | `packages/core/src/effects/interpreter.ts` ~L481-503 | Player-origin SELECT, `choice_count >= 2`, missing `env.chooseEffect` => `return false` (no `randint0`) |
| Random only on -2 | same | Matches `effects.c` L457-458 |
| Seam | `context.ts` `effectChooser`; `effect-env.ts` forwards into `EffectContext.chooseEffect` | Data path exists |
| Menu rows helper | `packages/core/src/effects/effect-choice.ts` (new) | `effectChoiceRows` |
| Menu name | `effect-info.ts` `effectMenuName` | Raw `menuName` only |

**Live path re-derive (C)**

1. `effect_do` (`effects.c` L425-460): player + SELECT + count>=2 => UI chooser; -1 cancel; -2 then `randint0`.
2. UI: `textui_get_effect_from_list` (`ui-effect.c` L34-180): random row FIRST, labels from `effect_get_menu_name` (`effects-info.c` L583-714) with formatted subtypes.
3. `cmd_get_effect_from_list` when invoked from a command.

**Live path re-derive (port)**

1. Interpreter gate is correct **when** `chooseEffect` is injected (`interpreter.ts` L475-508).
2. `buildEffectContext` only forwards if `deps.chooseEffect ?? state.effectChooser` is set (`effect-env.ts` L246-248).
3. **No host installs the chooser.** Grep across `packages/`: only `context.ts`, `effect-env.ts`, interpreter, and unit tests. Zero hits in `packages/web/**`, `packages/cli/**`, or `session/game.ts`.
4. Therefore live player dual-breath / SELECT activations hit "no prompt seam" and **cancel** (`return false`) rather than prompt. That is a gameplay regression vs pre-patch silent random, and does not implement the brief ("implement the chooser UI and wire it into the live effect env").

**Further defects**

- `effectMenuName` returns the raw generated template (`effect-info.ts` L64-66), not the formatted menu string from `effect_get_menu_name` (projections, timed names, food states, etc.). Incomplete vs C L583-714.
- `effectChoiceRows` places `"one of the following at random"` **last** (`effect-choice.ts` L25-28). C places it **first** and remaps selection 0 -> -2 (`ui-effect.c` L56-62, L113-118). A host that mimics C menu indices will mis-map choices.
- Tests: see SEED PARITY / test edit section. Assertions are C-aligned for cancel and -2; they do not prove a live UI.

**Verdict: ISSUE** — core seam + cancel/-2 RNG policy are right; chooser is not live; menu name/order incomplete.
`interpreter.ts:492-497`, `effect-env.ts:246-248`, `effect-choice.ts:25-28`, `effect-info.ts:64-66`. No web/session wire-up.

---

### 2. PF_CHARM into project_m — APPROVE (with note)

**C:** `project-mon.c` L1344-1346: `charm = (origin.what == SRC_PLAYER) ? player_has(player, PF_CHARM) : false`, then handler context.

**Port:**

- `playerCastSource` (`project-cast.ts` L103-109) sets `charm` from `opts.charm ?? playerState.pflags ?? race|class pflags`.
- `castProjection` forwards `source.charm` into mon origin (`project-cast.ts` L264-269).
- `project-monster` / mon handlers already consume `origin.charm` and `charmAnimalBoost`.

**Live path:** Player projections that go through `playerCastSource` + `castProjection` now carry charm on the live mon-project path. Nature-mage PF_CHARM is not only a unit-test option.

**Note (not blocking):** C computes charm inside `project_m` from live `player_has`. Port freezes it at cast-source construction. Equivalent for normal casts; exotic mid-cast pflag mutation would differ (unreachable in stock).

**Verdict: APPROVE** — `project-cast.ts:103-109`, live via `castProjection`.

---

### 3. PROJECT_INFO / square_isbelievedwall — ISSUE

**C:** `project.c` INFO branch uses `square_isbelievedwall` (`cave-square.c` L901-912): OOB wall; unknown not wall; known uses `!square_isprojectable(player->cave, grid)` (remembered map).

**Port predicate:** `squareIsBelievedWall` (`known.ts` L179-183) matches that logic via `knownFeat` + `featIsProjectable`. **Predicate itself APPROVE.**

**Wiring:**

- `world/project.ts`: `projectPath` / `projectable` / `computeProjection` take optional `believedWall`; INFO uses it; default still ground truth.
- `castProjection` passes `believedWall: (g) => squareIsBelievedWall(state, g)` (`project-cast.ts` L350).

**Live leak remains:**

- The only stock consumer of `PROJECT.INFO` found is **targeting paint** in `packages/web/src/main.ts` L2934-2940: `projectPath(..., PROJECT.THRU | PROJECT.INFO)` with **no** `believedWall` argument. Default = real map. Knowledge still leaks on the player-visible path.
- `game/target-loop.ts` L38-42 still documents the old approximation (stale comment; file not updated).

**Stream adjacency:** Editing `packages/core/src/world/project.ts` is exactly the traps-stream surface the brief warned about. Change is small and optional-callback shaped, but flag for merge conflicts / ownership.

**Verdict: ISSUE** — predicate correct; live targeting path still ground-truth.
`web/src/main.ts:2934-2940`, default in `world/project.ts:64` / L101.

---

### 4. WEAPON_DAMAGE expression base — APPROVE (seed careful)

**C:** `effects.c` L308-315: `effect_value_base_weapon_damage` = `damroll(obj->dd, obj->ds) + obj->to_d` (0 if no weapon). Bound as expression base; evaluated when dice extract components (`z-dice.c` `dice_random_value` L511-513 via `expression_evaluate`).

**Gamedata:** `curse.txt` / pack `curse.json` treacherous weapon: `DAMAGE` dice `$B` expr `B:WEAPON_DAMAGE:+ 0`.

**Port:** `buildObjectEffectChain` (`obj-cmd.ts` L524-532) binds:

```ts
WEAPON_DAMAGE: () => {
  const weapon = state.actor.weapon;
  return weapon ? state.rng.damroll(weapon.dd, weapon.ds) + weapon.toD : 0;
},
```

**Once-per-eval check (not double-draw):**

1. `Dice.roll` / `evaluate` call `randomValue()` **once** (`dice.ts` L411-419).
2. `randomValue` evaluates each expression component once (`component` -> `Expression.evaluate` -> single `baseValue()` call) (`expression.ts` L216-218).
3. Curse chain uses one base expression on `$B` only; dice/sides are not expressions.
4. Fire path: `curse-tick.ts` / `obj-cmd` `effectDo` -> one `dice.roll` per effect -> one damroll. Matches C position (expression base at dice_random_value time).

**Not a lazy-getter re-access hazard** on the fire path: no double `evaluate()` without a second dice roll.

**Caveats (non-blocking if matching C):**

- Any second `dice.randomValue()` / `roll` on the same bound chain draws again (C same: base fn always damrolls).
- Display paths that build a live chain via `buildObjectEffectChain` and call `randomValue` (e.g. inspect + effect-info) also damroll; C `expression_evaluate` of that base is likewise live. Port's effect-info "RNG-safe" claim is false once WEAPON_DAMAGE is bound with damroll — pre-existing architecture tension, not unique to this patch's fire path.

**Verdict: APPROVE** for the treacherous-weapon fire path seed position.
`obj-cmd.ts:524-532`.

---

### 5. monster_attack_monster blow effects/armour — BLOCKED (expected)

Not implemented here; lives in `mon-cmd.ts`. Unchanged (see above). **Out of scope for scoring.**

---

### 6. process_monster_timed via mon_dec_timed / mon_clear_timed — APPROVE (minor residual)

**C:** `mon-move.c` L1768-1826, fear convert L1672-1676.

**Port (`monster-turn.ts`):**

- Sleep reduction: `monDecTimed(..., SLEEP, ..., NOTIFY, sink)` L1657-1664.
- FAST/SLOW/HOLD/DISEN: `monDecTimed` flag 0 L1697-1698.
- STUN/CONF/CHANGED: NOTIFY + sink (+ shape hooks) L1700-1714.
- FEAR: **existing** `randint1(level/10+1)` preserved, then `monDecTimed` L1716-1718.
- Fear paralysis: `monClearTimed(FEAR, NOMESSAGE)` + `monIncTimed(HOLD, amount, NOTIFY)` L1609-1613.
- Messages: `monsterTimedMessage` -> `formatMonsterMessageByName` L1630-1634.

**RNG:**

- `monDecTimed` decreases only; `monSetTimed` sets `checkResist=false` on decrease — **no extra resist draws** on the decrement path. Good.
- Fear `randint1` only extra draw on that path remains the C one. Good.
- HOLD mon_inc on fear convert can hit resist-flag path (RF_NO_HOLD, no save dice) — same as C.

**Messages / lore:**

- Wake/recover end messages now fire for obvious monsters when timers hit 0 with NOTIFY. Yes in play if `state.msg` is set.
- C after noise sleep also `lore_update` (`mon-move.c` L1771-1778). Port still only `loreCountU8` for wake/ignore (`monster-turn.ts` L1669-1671) — **no `loreUpdate`**. Residual vs C; lower severity than silent decrements.

**Verdict: APPROVE** for the brief's core claim (mon_dec_timed + notify + fear randint1 preserved). Residual: missing `loreUpdate` after wake/ignore counts.
`monster-turn.ts:1657-1718`.

---

### 7. monster_swap full update set — ISSUE

**C:** `mon-util.c` L566-677: swap mons; for each camouflaged mon, awareness/mimic **before** `mon->grid = ...`; then `update_mon`; light upkeep; player branch; `square_light_spot` both grids.

**Port (`context.ts` L903-941):** exchanges squares and grids; then `moved()` does camouflage / `updateMon` / light; `updateMonsterDistances`; optional `updateFov` if light changed. Adds `moveMimickedObject` in `known.ts`.

**Defects vs C (camouflage witness):**

C for mon1 at grid1 -> grid2 (`mon-util.c` L591-593):

```
monster_is_in_view(mon) ||
(m2 >= 0 && los(cave, pgrid, grid2)) ||   // empty OR other mon: player LOS to dest
(m2 < 0 && los(cave, grid1, grid2))       // player on dest
```

Port (`context.ts` L925-927):

```
monsterIsInView(mon) ||
(other > 0 ? los(player, to) : los(from, to))
```

| Dest occupancy | C | Port |
|----------------|----|------|
| empty (0) | `los(player, dest)` | `los(from, to)` — **WRONG** |
| other mon (>0) | `los(player, dest)` | `los(player, dest)` — OK |
| player (-1) | `los(from, to)` | `los(from, to)` — OK |

Common case: camouflaged mon steps into **empty** square. C reveals if player has LOS to the destination; port uses inter-grid LOS and can miss or false-positive differently.

**Order:** C checks camouflage while `mon->grid` is still the **old** cell, then assigns grid. Port assigns `mon.grid` first (L911-912), then checks `monsterIsInView` (MFLAG_VIEW from prior update). View bit is sticky enough that this may often match, but it is not C's order; combined with the empty-square LOS bug, awareness is not complete.

**Also incomplete vs C:** no player-swap branch (documented intentional for AI-only swaps); no `square_light_spot` / monlist redraw flags (presentation upkeep — may be deferred elsewhere).

**moveMimickedObject:** broadly follows C L522-560; known-twin / placeholder details thinner; RNG-free as claimed.

**Verdict: ISSUE** — empty-dest camouflage LOS predicate wrong; not full mon-util.c parity.
`context.ts:925-927` (and L911-912 order).

---

### 8. Remaining L5 subset (permitted) — MIXED

| Sub-item | Verdict | Evidence |
|----------|---------|----------|
| Smart-learn melee calls | **ISSUE** | `mon-side.ts` L147-158, L214, L252-260, L367, L463. C pure-element learn only if `pure_element` (`mon-blows.c` L485-487); port `elementalDam` always `learn(0, proj)` so **POISON learns during elementalDam AND again in `incTimed`**. C pure-element learn is **after** damage/inven; port learns **inside** `elementalDam` **before** `invenDamage`/`takeHit` (`mon-melee.ts` L690-699) — seed order wrong when `birth_ai_learn` draws. Timed path's extra post-`player_inc_timed` learn matches C L554; monIncHooks already mirror L946-948. |
| Taunt | **APPROVE** | `monster-turn.ts` L454-456 early return when `TMD.TAUNT`; matches `mon-move.c` L232-233. |
| Unique (kill-body) | **APPROVE** | `monsterCanKill` uses `monsterIsUnique(other)` (`monster-turn.ts` L357); C-aligned with original-race unique (`predicate.ts` L77-79). |
| Trample-delete | **APPROVE** (scope) | Push/kill uses `deleteMonster` instead of raw slot clear (`monster-turn.ts` L1257-1261). Pre-existing `deleteMonster` is a partial `delete_monster_idx` (drops/mimic deferred by comment) but is the correct call. |
| Fear convert | **APPROVE** | See item 6; mon_clear + mon_inc HOLD. |
| Swap | **ISSUE** | Same as item 7. |
| mon-cmd blow message/draw | **BLOCKED expected** | Unchanged; out of scope. |

---

## SEED PARITY (decision 6.2)

### Draws this patch ADDS (C makes them)

| Draw | Position | Matches C? |
|------|----------|------------|
| `damroll(dd,ds)` via WEAPON_DAMAGE base | Expression eval during effect dice_random_value / roll (curse fire) | YES — `effects.c` L308-315 |
| `updateSmartLearn` oneIn(2)/oneIn(100) when `birth_ai_learn` | After melee elemental/timed/drain/disen learn hooks | **PARTIAL** — intended adds, but extra/mis-ordered on poison + pure-element (see item 8) |

### Draws this patch REMOVES

| Draw | Position | Matches C? |
|------|----------|------------|
| `randint0(choice_count)` on player SELECT when no chooser / non-random choice | Was silent fallback; now cancel without draw | YES vs C (C does not roll until choice == -2). Live still has no chooser, so SELECT never rolls and never applies — behaviour change, stream-correct for cancel, incomplete for play. |

### Draws preserved (must not regress)

| Draw | Status |
|------|--------|
| Fear `randint1(level/10+1)` before fear decrement | PRESERVED |
| mon_dec path no new resist dice | OK |
| SELECT random only on choice -2 | OK when chooser present |

### Test edit `packages/core/src/effects/interpreter.test.ts` (+41/-~20)

**C-aligned assertions, not a relaxation.**

Old test accepted **both** `chooseEffect: () => -2` **and** absent chooser as success with one handler call (silent random).

New tests (quoted):

```ts
it("rolls randomly only when the chooser selects the random row", () => {
  ...
  const done = registry.effectDo(
    selectChain(),
    { rng: new Rng(11), chooseEffect: () => -2 },
    { origin: sourcePlayer() },
  );
  expect(done).toBe(true);
  expect(calls).toHaveLength(1);
});

it("cancels when a player select has no prompt seam", () => {
  ...
  const done = registry.effectDo(
    selectChain(),
    { rng: new Rng(11) },
    { origin: sourcePlayer() },
  );
  expect(done).toBe(false);
  expect(calls).toHaveLength(0);
});
```

Justified by `effects.c` L437-450 (cancel) and L457-458 (random only on -2). Tightens fidelity; does not weaken checks.

---

## Forbidden / ownership surfaces

| Path | Touched? |
|------|----------|
| `packages/borg/**` | NO |
| `packages/linoleum/**` | NO |
| `packages/cli/baseline/stats-baseline.json` | NO |
| `packages/core/src/game/mon-cmd.ts` | NO (confirmed) |

**Adjacent streams (flag):**

| File | Concern |
|------|---------|
| `packages/core/src/world/project.ts` | Traps stream owns path geometry; optional `believedWall` API change. |
| `packages/core/src/game/project-cast.ts` | Projection cast stream adjacency. |
| `packages/core/src/game/known.ts` | Knowledge/map stream adjacency (`squareIsBelievedWall`, `moveMimickedObject`). |
| `packages/core/src/game/context.ts` | Shared game state / swap; parallel branches touch this often. |
| `packages/core/src/game/obj-cmd.ts` | Object-use stream; WEAPON_DAMAGE bind is effects-appropriate. |

None of these look like accidental full rewrites of another stream's WIP; they are targeted. Still merge-risk hotspots.

---

## Files changed (worktree)

```
packages/core/src/effects/effect-info.ts
packages/core/src/effects/effect-choice.ts          (new, untracked)
packages/core/src/effects/interpreter.ts
packages/core/src/effects/interpreter.test.ts
packages/core/src/game/context.ts
packages/core/src/game/effect-env.ts
packages/core/src/game/known.ts
packages/core/src/game/mon-side.ts
packages/core/src/game/monster-turn.ts
packages/core/src/game/obj-cmd.ts
packages/core/src/game/project-cast.ts
packages/core/src/index.ts
packages/core/src/world/project.ts
```

---

## OVERALL VERDICT

**FAIL (partial progress; not ship-ready as "6 of 8 done").**

| Item | Verdict |
|------|---------|
| 1 EF_SELECT prompt | **ISSUE** — not live; menu incomplete |
| 2 PF_CHARM | **APPROVE** |
| 3 PROJECT_INFO believed map | **ISSUE** — predicate OK; live targeting still leaks |
| 4 WEAPON_DAMAGE | **APPROVE** |
| 5 mon-vs-mon blows | **BLOCKED expected** (mon-cmd untouched) |
| 6 mon_dec_timed | **APPROVE** (minor lore_update gap) |
| 7 monster_swap | **ISSUE** — empty-dest LOS wrong |
| 8 L5 subset | **MIXED** — taunt/unique/trample/fear OK; smart-learn order/double-call ISSUE; mon-cmd part blocked |

**Score against claimed "6 done":** of the six non-blocked claimed items, only **2, 4, 6** fully clear review. **1, 3, 7** fail adversarial check. **8** is only partial.

**Highest-priority fixes before merge:**

1. Wire a host `effectChooser` (web/session) using `effectChoiceRows` with C row order and formatted names; until then player SELECT is broken cancel.
2. Pass `believedWall` into the live `projectPath` call in `web/src/main.ts` (and any other PROJECT_INFO callers).
3. Fix swap camouflage witness: `other >= 0` use `los(player, to)`; check before or with C's occupancy rules; prefer C grid-assign order.
4. Gate pure-element `learn` on pure-element only; move learn after damage; do not learn on poison elementalDam.

---

Reviewer: Grok (did not author the patch). ASCII only.
END REVIEW
