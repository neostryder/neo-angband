# EFFECTS_MON independent adversarial re-review R2 (Grok)

Worktree: `C:\Repositories\na-wt-fx` branch `parity/p1-effects-mon`
Diff reviewed: `EFFECTS_MON_FIX_R2.diff` + live worktree sources
Oracle: `reference/` (Angband 4.2.x)
Prior review: `EFFECTS_MON_REVIEW_grok.md` (approved 2,4,6; failed 1,3,7; 8 partial)
Method: re-derive each R2 claim against C citations and live call paths. Skeptical default.
Decision 6.1: in-terminal prompt on the 80x24 glyph grid via the existing UI seam.
Decision 6.2: same draw ORDER and COUNT as C.

---

## Scope notes (before the four fixes)

### mon-cmd.ts / items 5 and mon-cmd subset of 8

**End state is still deferred (items 5 and mon-cmd message/draw remain out of stream).**

- Live `packages/core/src/game/mon-cmd.ts` object hash = `d7b65d927da640c4f8fe5cbe9407121dc217ea75` (matches round-1 HEAD hash).
- File is the simplified mon-vs-mon path: `monTakeHit` + `MON_MSG.DIE` only; no `displayBlowMessageVsMonster`, no per-handler mon-target elemental/timed order, no `randint0(num_messages)`.
- R2 diff *does* contain a mon-cmd hunk (`index 43ee7dd6c..d7b65d927`): it **reverts** an intermediate mon-vs-mon blow implementation back to this deferred baseline. That is not implementing item 5/8; it is restoring the intentional block.
- **Verdict for blocked scope:** still BLOCKED / deferred as claimed. Do not score mon-vs-mon blows or mon-cmd blow-message draws against this stream.

### loreUpdate after wake/ignore (item 6 residual from R1)

**CORRECT vs C.**

- C `mon-move.c` L1771-1778: if obvious, `lore->ignore++` or `lore->wake++`, then `lore_update(mon->race, lore)`.
- Port `monster-turn.ts` L1667-1672: `loreCountU8(..., "ignore"|"wake")` then `loreUpdate(mon.race, lore)`.
- Closes the R1 residual on item 6. Not one of the four R2 failures, but confirmed.

### Forbidden / ownership surfaces

| Path | Touched in R2 diff? |
|------|---------------------|
| `packages/borg/**` | NO |
| `packages/linoleum/**` | NO |
| `packages/cli/baseline/**` | NO |
| `packages/core/src/game/mon-cmd.ts` | YES as **revert to deferred** (see above); end state deferred |

`packages/cli` parity tests known RED (S-2): ignored as instructed.

### Package hygiene (out of the four fixes, but in the same R2 diff)

R2 is not a four-hunk surgical patch. Adjacent surfaces also move: `color.ts`, save `diedFrom` handling, trap/web run path, store buy RNG probe, birth RNG session key, mon-cmd revert, etc. Those are not re-scored as the four R2 claims, but test edits there are quoted under SEED/TESTS below when they look like relaxations.

---

## 1. EF_SELECT chooser now LIVE — ISSUE (UI faithfulness / decision 6.1)

### (a) Live effect path, cancel, random-only draw — CORE LOGIC APPROVE

**Trace (live web path):**

1. `packages/web/src/main.ts` L645-668 installs `state.effectChooser` after boot, with live registries:
   - `projections`, `timedDesc`, `statName`, `summonDesc`, `foodFull`, `foodHungry`.
2. `buildEffectContext` (`effect-env.ts` L246-248) forwards `deps.chooseEffect ?? state.effectChooser` into `EffectContext.chooseEffect`.
3. Interpreter (`interpreter.ts` L475-508):
   - player + SELECT + `choiceCount >= 2` => UI path (not silent `randint0`);
   - missing chooser => `return false` (no draw);
   - `choice === -1` => `return false` (cancel, no draw);
   - `choice === -2` only then `env.rng.randint0(choiceCount)` (`effects.c` L457-458);
   - fixed index 0..n-1 runs that sub-effect only.

Matches `effects.c` L425-460 for cancel / random / no unrequested draw.

**Hosts without a chooser:** CLI / session do **not** install `effectChooser`. Headless player SELECT still cancels. Web is the claimed live path; that is acceptable for "chooser installed on the Vite host" if UI faithfulness were correct (it is not; see (b)).

### (b) UI FAITHFULNESS — ISSUE (browser dialog)

**Implementation is a native browser dialog, not an in-terminal menu.**

Evidence (`packages/web/src/main.ts` L642-660):

```
// comment: "uses the browser's synchronous prompt"
state.effectChooser = (first, count): number => {
  const rows = effectChoiceRows(...);
  const prompt = rows.map(...).join("\n");
  const answer = window.prompt(`Choose an effect:\n${prompt}`, "a");
  ...
};
```

| Requirement (decision 6.1 / C) | Port |
|--------------------------------|------|
| In-terminal menu on 80x24 glyph grid | **NO** — `window.prompt` modal |
| Existing prompt/UI seam (`textui_get_effect_from_list` style) | **NO** — bypasses GlyphTerm / overlay / cell-grid render |
| `ui-effect.c` L34-180 menu (screen_save, prt, menu_select, letters) | **NO** |
| Cancel => -1 | YES (`answer === null`) |
| Random row index 0 maps to -2 | YES via `effectChoiceRows` choice field |

**ISSUE:** this violates decision 6.1. Synchronous browser prompting is explicitly the wrong presentation class, even if engine cancel/random policy is correct. Flag: `packages/web/src/main.ts:660` (`window.prompt`).

C-faithful host would drive something equivalent to `textui_get_effect_from_list` through the existing term overlay/menu seam (same pattern as other in-game menus), not `window.prompt` / `confirm`.

### Row ORDER and names vs C

**ORDER — APPROVE.**

- C `ui-effect.c` L56-62, L113-118: random row first; selection 0 => -2; selection >0 => selection-1.
- Port `effect-choice.ts` L28-31:

```
[
  { choice: -2, label: "one of the following at random", random: true },
  ...labels.map((label, choice) => ({ choice, label, random: false })),
]
```

Random first; fixed rows 0..n-1. Unit test locks this (`effect-info.test.ts` L59-75). R1 reverse-order defect is fixed.

**NAMES — mostly formatted; residual label bug.**

- `effectMenuName` (`effect-info.ts` L73-131) now mirrors `effect_get_menu_name` (`effects-info.c` L583-714): FOOD/CURE/TIMED/STAT/SEEN/BOLT/SUMM/TELE/BALL/BREATH/LASH/etc.
- Live web deps pass real projection/timed/stat/summon/food tables.
- Residual vs C L630-637: EFINFO_FOOD subtype 3 (INC_TO) uses **"nourished"** when average is between hungry and full; port L90-95 uses **"satisfied"** for both subtype 2 and 3. Wrong menu string for INC_TO mid-band food. File:line: `effect-info.ts:95`.

Breath example locked by test: `"breathe a cone of fire"` / `"breathe a cone of frost"` — matches C projection player_desc formatting for EFINFO_BREATH.

### Verdict item 1

**ISSUE** — engine seam + random-first rows + cancel/-2 policy are live on the web host, but presentation is a **browser dialog**, which fails decision 6.1. Residual FOOD INC_TO label `"satisfied"` vs C `"nourished"`.

`web/src/main.ts:645-668` (especially L660), `effect-info.ts:95`.

---

## 2. PROJECT_INFO / squareIsBelievedWall on live targeting — APPROVE

### Predicate

`squareIsBelievedWall` (`known.ts` L179-183): OOB wall; unknown not wall; known uses `!featIsProjectable(knownFeat)` — matches `cave-square.c` L901-912.

### Live path (the R1 failure)

R1: `packages/web/src/main.ts` targeting paint called `projectPath(..., PROJECT.THRU | PROJECT.INFO)` with **no** `believedWall` (default ground truth leak).

R2 live paint (`main.ts` L2964-2970):

```
const path = projectPath(
  state.chunk,
  state.z.maxRange,
  state.actor.grid,
  cur,
  PROJECT.THRU | PROJECT.INFO,
  (grid) => squareIsBelievedWall(state, grid),
);
```

**LIVE targeting path now uses the believed map.** Knowledge-leak defect on the stock player-visible PROJECT_INFO consumer is fixed.

### Other PROJECT_INFO / projectPath callers

| Caller | Flags | believedWall? | Leak? |
|--------|-------|---------------|-------|
| `web/src/main.ts` targeting paint | THRU\|INFO | YES (`squareIsBelievedWall`) | NO |
| `project-cast.ts` L350 `castProjection` | via `computeProjection` | YES | NO (also sets for INFO geometry) |
| `world/project.ts` default | INFO uses arg; default = `!c.isProjectable` | default ground-truth only if caller omits | OK when no INFO |
| `monster-turn.ts` L318 | PROJECT.ROCK (not INFO) | N/A | N/A |
| `ranged-cmd.ts` L82 | flg `0` (not INFO) | N/A | N/A |
| `project.test.ts` | tests | ground-truth helper | N/A |

No remaining stock **PROJECT_INFO** caller found that omits `believedWall`. Default still ground-truth when INFO is set without a callback; that is only a footgun for future callers, not a current leak.

### Residual comment debt (non-blocking)

`target-loop.ts` L37-42 still documents the old "live projectability / deferred believed wall" approximation. Runtime path is fixed in `main.ts`; comment is stale only.

### Verdict item 2

**APPROVE** — `web/src/main.ts:2964-2970`, `project-cast.ts:350`, `known.ts:179-183`.

---

## 3. monster_swap camouflage order + empty-dest LOS — APPROVE

### R1 defects and R2 status

| R1 defect | C (`mon-util.c`) | R2 port (`context.ts` L922-935) |
|-----------|------------------|----------------------------------|
| Empty dest used `los(from,to)` | empty/other mon: `los(cave, pgrid, dest)` (L591-593 / L638-640) | `other >= 0 ? los(c, state.actor.grid, to) : los(c, from, to)` |
| Player on dest | `los(from, to)` when m2/m1 < 0 | `other < 0` => `los(from, to)` |
| grid assign before witness | camouflage **before** `mon->grid = ...` (L591-600) | witness/mimic **then** `mon.grid = to` (L932-934) |

Empty-destination case: `m2 === 0` => `other >= 0` => `los(player, dest)`. Matches C. R1 wrong predicate fixed.

### Full C update set vs port order

For each camouflaged mon (C L586-608 / L633-655):

1. witness / become_aware OR move_mimicked_object — **present**, before grid assign
2. `mon->grid = dest` — **present**
3. `update_mon(..., true)` — **present** (`updateMon`)
4. light race => PU_UPDATE_VIEW | PU_MONSTERS — port: `lightChanged` then `state.updateFov?.(state)`
5. PR_MONLIST redraw — **not** set as a discrete flag (presentation upkeep; FOV/distances cover much of visibility)
6. After both mons: `square_light_spot` both grids — **not** present as named calls
7. Player-on-square branch — intentionally absent (documented AI mon-mon swaps; player not swapped here)

`updateMonsterDistances(state)` runs after both `moved()` calls (distance half of C's player PU_DISTANCE when player moves; for mon-mon still useful for mon->cdis).

Mimic path calls `moveMimickedObject` (RNG-free as before).

### Verdict item 3

**APPROVE** for the R1-failed camouflage witness predicate and grid-assign order.
`context.ts:922-941`.

Residual (non-blocking for this claim): no explicit `square_light_spot` / monlist redraw flags; player-swap branch still out of this function's design. Same class of presentation residuals as R1 notes, not the empty-dest LOS bug.

---

## 4. Smart-learn pure-element order / poison double-learn — ISSUE (residual seed order)

### What R2 changed (`mon-side.ts`)

- `pendingPureElement` + learn deferred into `takeHit` when elemental result > 0.
- `elementalDam`: **no learn for `PROJ.POIS`**; for other projs, `result > 0` => pending, else immediate `learn(0, proj)`.
- `incTimed`: after `playerIncTimed`, learn OF flags / `ELEM.POIS` / `ELEM.CHAOS` (timed path).
- Drain/disen still learn after their side effects.

### (a) Learning gated on pure_element — APPROVE for call graph

C `melee_effect_elemental` L484-487: learn only if `pure_element && context->p`.

Port call sites (`mon-melee.ts`):

- ACID/ELEC/FIRE/COLD: `applyElemental(..., pure=true)` => non-POIS projs => learn path.
- POISON: `applyElemental(..., pure=false)` + `proj === PROJ.POIS` => **no** learn inside `elementalDam`.

No other callers of `elementalDam`. Equivalent to pure_element gating for stock blows.

### (b) POISON no longer double-learned — APPROVE

C `melee_effect_handler_POISON` L674-689:

1. `melee_effect_elemental(..., pure_element=false)` — no learn inside.
2. if alive: `player_inc_timed(TMD_POISONED, ...)`.
3. `update_smart_learn(..., ELEM_POIS)` once.

Port:

1. `elementalDam(POIS)` does not learn.
2. if alive: `incTimed(POISONED, ...)` then `learn(0, ELEM.POIS)` once at L271.

Double-learn fixed. Death early-exit: both skip poison learn if dead after elemental damage (`mon-melee.ts` L746-749).

### (c) Draw ORDER with birth_ai_learn — PARTIAL; residual ISSUE

C pure-element sequence (`mon-blows.c` L448-487):

1. `adjust_dam` (may draw)
2. if `elemental_dam > 0`: `inven_damage` (per-item draws)
3. if `context->damage > 0`: blow message (`randint0(num_messages)`), then `take_hit`
4. **always** (pure_element): `update_smart_learn` — may `oneIn(2)` / `oneIn(100)` when `birth_ai_learn`

Port common path (`elemental_dam > 0`):

1. `elementalDam` => `adjustDam`, set pending
2. `invenDamage`
3. message + `takeHit` => learn after `take_hit`

**Matches C for the common pure-element case** (learn after inventory damage and takeHit). R1 "learn inside elementalDam before inven/takeHit" is fixed when elemental damage is positive.

**Residual seed-order defect when `elemental_dam == 0` but physical damage still hits:**

C still runs message + `take_hit` (if physical > 0) **then** learn at function end.

Port (`mon-side.ts` L223-226):

```
if (proj !== PROJ.POIS) {
  if (result > 0) pendingPureElement = proj;
  else learn(0, proj);   // IMMEDIATE
}
```

So when immune/zero elemental but `method.phys` leaves physical damage:

1. learn draws (`oneIn(2)` / `oneIn(100)`) **first**
2. then blow-message `randint0`
3. then takeHit

That inverts C and breaks decision 6.2 for `birth_ai_learn` on immune/zero-elemental pure blows. Comment at L147-150 claiming "zero elemental damage has no later side effect to wait behind" is **false** whenever physical damage remains.

Correct shape: always defer pure-element learn until **after** the whole `applyElemental` sequence (after optional inven + optional message/takeHit), not "pending only if result > 0".

File:line: `mon-side.ts:223-226` (and missing post-`applyElemental` flush in `mon-melee.ts` L689-701).

### Draw-count summary (birth_ai_learn on)

| Case | C learn calls | Port learn calls | Order vs C |
|------|---------------|------------------|------------|
| Pure ACID/ELEC/FIRE/COLD, elemental_dam > 0 | 1 after take_hit | 1 after takeHit | MATCH |
| Pure, elemental_dam == 0, physical > 0 | 1 after take_hit | 1 before message/takeHit | **MISORDER** |
| Pure, both damages 0 | 1 after empty damage block | 1 at end of elementalDam | OK (no intervening draws) |
| POISON | 1 after inc_timed only | 1 after incTimed only | MATCH |
| Timed BLIND/etc. | learn in inc_check + post handler | monIncHooks + post-incTimed learn | MATCH class |

### Verdict item 4

**ISSUE** — (a) and (b) fixed; common (c) path fixed; residual pure-element learn-before-message/takeHit when elemental damage is 0 still violates exact C draw order under `birth_ai_learn`.

`mon-side.ts:223-226`, interaction with `mon-melee.ts:689-701`.

---

## SEED PARITY (decision 6.2) — R2 delta

### Draws / order this R2 fix set corrects

| Item | Was (R1) | Now |
|------|----------|-----|
| SELECT `randint0` only on choice -2 | OK in core; never reached live | OK; web can reach -2 |
| SELECT cancel | return false no draw | OK |
| PROJECT_INFO | UI path ground-truth (not seed; knowledge) | believed map |
| Pure-element learn before inven/takeHit | wrong when elemental > 0 | fixed when elemental > 0 |
| Poison double learn | elementalDam + incTimed | incTimed only |

### Remaining seed hazard introduced/left by item 4 residual

| Draw | When | Status |
|------|------|--------|
| `updateSmartLearn` oneIn(2)/oneIn(100) | pure element, elemental_dam==0, physical>0 | **before** blow message randint0 — WRONG vs C |

### Tests — effects-stream assertions not relaxed

`interpreter.test.ts` (still C-aligned, not relaxed):

```
it("rolls randomly only when the chooser selects the random row", () => {
  ...
  expect(done).toBe(true);
  expect(calls).toHaveLength(1);
});

it("cancels when a player select has no prompt seam", () => {
  ...
  expect(done).toBe(false);
  expect(calls).toHaveLength(0);
});
```

`effect-info.test.ts` adds order/name lock (tightens, does not relax):

```
expect(rows.map((row) => row.choice)).toEqual([-2, 0, 1]);
expect(rows.map((row) => row.label)).toEqual([
  "one of the following at random",
  "breathe a cone of fire",
  "breathe a cone of frost",
]);
```

### Out-of-scope test changes in the same R2 diff (quoted; look relaxed or behaviour-shifted)

These are **not** effects+mon claim tests, but the user asked that no test was relaxed — several R2 assertions change or vanish:

1. `session/game.test.ts` (approx. from diff):  
   `- expect(rp.diedFrom).toBe("(alive and well)");`  
   `+ expect(rp.diedFrom).toBe("");`  
   Paired with save deserialize dropping load.c L791-793 alive repair. **Looks like a fidelity regression + assertion rewrite**, not a tighten.

2. `store/transact.test.ts`:  
   Removed probe that expected buy-path `oneIn(3)` / optional `randint0(6)`; now  
   `expect(ctx.rng.getState()).toEqual(before);`  
   ("RNG-free"). **Changes expected draw count** for that path.

3. `player-turn-coercion` / web-clear path: entire  
   `expect(used).toBe(state.z.moveEnergy);`  
   `expect(squareIsWebbed(...)).toBe(false);`  
   `expect(messages).toEqual(["You clear the web."]);`  
   **test removed** with the web-clear branch code.

4. Color tests: unknown attr/text now expect `-1` instead of white/shade fallbacks; table length claims simplified. Behaviour change, not an effects+mon relaxation.

**Effects-stream tests for items 1-4 are not relaxed.** Broader R2 package does rewrite other assertions.

---

## Per-item scoreboard (R2 claims only)

| # | Claim | Verdict |
|---|-------|---------|
| 1 | EF_SELECT live chooser | **ISSUE** — live engine path OK; **browser `window.prompt` violates 6.1**; residual FOOD INC_TO name |
| 2 | PROJECT_INFO believed map on live targeting | **APPROVE** |
| 3 | monster camouflage order + empty-dest `los(player,dest)` | **APPROVE** |
| 4 | Smart-learn pure after damage; poison once; seed order | **ISSUE** — poison/double-learn + common path fixed; residual order when elemental_dam==0 |

Previously approved items 2/4/6 from R1 stream numbering (PF_CHARM, WEAPON_DAMAGE, mon_dec_timed) were not re-broken by inspection of the R2 fix sites; item 6 residual `loreUpdate` is now present and correct.

---

## OVERALL VERDICT

**Not approvable as "four R2 failures closed".**

- **2 of 4** R2 fixes fully clear adversarial review (PROJECT_INFO, monster_swap camouflage).
- **Item 1** fails decision **6.1** hard: implementation is a **native browser dialog**, not an in-terminal glyph-grid menu. Engine cancel/random/order is otherwise good.
- **Item 4** fails decision **6.2** on a residual pure-element path (elemental_dam == 0, physical > 0): smart-learn draws still fire before blow-message/takeHit.

**Highest-priority remaining fixes:**

1. Replace `window.prompt` with an in-terminal effect menu on the existing GlyphTerm/overlay seam (`ui-effect.c` L34-180 shape: random-first rows, letter selections, ESC => -1). Keep `effectChoiceRows` + `effectMenuName` as the data source. Fix FOOD INC_TO mid-band label to `"nourished"`.
2. Defer pure-element `updateSmartLearn` until after the full `applyElemental` sequence always (not only when `elemental_dam > 0` pending on takeHit).

**mon-cmd / items 5 + mon-cmd part of 8:** still deferred; end-state hash matches round-1 deferred baseline.  
**borg / linoleum / cli baseline:** untouched.  
**cli parity RED (S-2):** ignored.

Reviewer: Grok (did not author the patch). ASCII only.
END REVIEW R2
