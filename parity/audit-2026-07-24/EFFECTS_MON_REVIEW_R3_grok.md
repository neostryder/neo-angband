# EFFECTS_MON independent adversarial re-review R3 (Grok)

Worktree: `C:\Repositories\na-wt-fx` branch `parity/p1-effects-mon`
Diff reviewed: `EFFECTS_MON_FIX_R3.diff` + live worktree sources
Oracle: `reference/` (Angband 4.2.x)
Prior review: `EFFECTS_MON_REVIEW_R2_grok.md`
Method: VERIFY ONLY what R2 failed or asked to re-check. Skeptical default.
Decision 6.1: in-terminal menu on the 80x24 glyph grid via the existing UI seam.
Decision 6.2: same draw ORDER and COUNT as C.

---

## Scope notes

### What R3 claimed to fix

1. EF_SELECT presentation: replace `window.prompt` with `selectFromMenu` on GlyphTerm.
2. Smart-learn draw order residual: always defer pure-element learn until after the full elemental sequence (including elemental_dam == 0 with physical > 0).
3. FOOD INC_TO mid-band menu label `"nourished"`.
4. Regression check on previously APPROVED PROJECT_INFO and monster_swap.
5. Ownership: mon-cmd deferred; no test relaxation; borg / linoleum / cli baseline untouched.

### mon-cmd / items 5 and mon-cmd subset of 8

**Still deferred (out of stream).**

- Live object hash = `d7b65d927da640c4f8fe5cbe9407121dc217ea75` (same R1/R2 deferred baseline).
- Not in the uncommitted R3 fix set (`git status` omits `mon-cmd.ts`).
- Still simplified mon-vs-mon: `monTakeHit` + `MON_MSG.DIE` only; no mon-target elemental/timed blow-message parity.
- Full-branch R3.diff still contains the earlier mon-cmd **revert-to-deferred** hunk vs main; that is ownership hygiene, not mon-cmd feature work.

### Forbidden / ownership surfaces

| Path | In R3.diff? | Working tree dirty? |
|------|-------------|---------------------|
| `packages/borg/**` | NO | NO |
| `packages/linoleum/**` | NO | NO |
| `packages/cli/baseline/**` | NO | NO |
| `packages/core/src/game/mon-cmd.ts` | YES as prior revert-to-deferred only | NO (hash unchanged) |

`packages/cli` parity tests known RED (S-2): ignored as instructed.

---

## 1. EF_SELECT presentation (decision 6.1) -- APPROVE

### (a) No window.prompt / confirm on the effect path -- APPROVE

- Repo search under `packages/`: **zero** `window.prompt` / `window.confirm` hits.
- R2 flag site (`main.ts` native prompt) is gone.

### (b) Menu renders through GlyphTerm / cell-grid seam -- APPROVE

Live install (`packages/web/src/main.ts` L643-682):

1. `state.effectChooser` is a **synchronous value seam** returning `pendingEffectChoice` (or -1).
2. `choosePlayerEffect` builds rows via `effectChoiceRows` and awaits `selectFromMenu(term, "Which effect?", ...)`.
3. Call sites (item verb / item ref / activate / cast) pre-present the menu, then `commandBuffer.push` + `advance()`; the interpreter reads the queued choice when it hits EF_SELECT.

`selectFromMenu` (`packages/web/src/overlay.ts` L618+):

- Takes a `GlyphTerm`.
- Paints with `term.clear()` + `term.print(...)` on the fixed grid (title, lettered rows, footer).
- ESC resolves `null`; letter / Enter resolve a row index.

`GlyphTerm` (`packages/web/src/term.ts` L1-16, L89-93, L108):

- Explicit 80x24 addressable **cell grid** (ui-term stand-in).
- Holds `grid: (Glyph | null)[][]`; print writes cells; canvas blits those cells.
- A future canvas/PIXI visual mod can reimplement `GlyphTerm.print/clear` without rewriting the effect chooser.

This is the existing in-terminal menu seam used by birth, shop, ignore, help, etc. It does **not** bypass the grid with a browser dialog.

### (c) Row ORDER and labels vs C -- APPROVE

**ORDER** (`effect-choice.ts` L28-31 vs `ui-effect.c` L56-62 / L113-118):

```
[
  { choice: -2, label: "one of the following at random", random: true },
  ...labels.map((label, choice) => ({ choice, label, random: false })),
]
```

Random first; fixed sub-effects map to choices 0..n-1. Unit lock: `effect-info.test.ts` L59-75.

**NAMES** (`effectMenuName` / `effects-info.c` L583-714):

- FOOD / CURE / TIMED / STAT / SEEN / BOLT / SUMM / TELE / BALL / BREATH / LASH / etc. mirror C's `effect_get_menu_name` switch.
- Live web deps pass projections, timedDesc, statName, summonDesc, foodFull, foodHungry (`main.ts` L647-657).
- Stock SELECT data always places SELECT first with fixed dice (`"2"`, `"4"`, `"5"`, ... in object/activation packs); pre-prompt uses `randomValue()` (no RNG) and only runs when `dice==0 && sides==0 && base>=2`, so it does not steal the engine's later choiceCount path.

Prompt string `"Which effect?"` matches C's default in `effect_menu_select` (`ui-effect.c` L109).

**Non-blocking note (not a 6.1 failure):** letter tags use full a-z (`menuLetter` / `LETTERS`), while C's effect menu uses `all_letters_nohjkl`. Same shared overlay convention as other web menus; stock SELECT lists are small (random + 2..5 effects) so selection letters stay in a-f range.

### (d) ESC / cancel / random draw policy -- APPROVE

Trace:

1. UI ESC => `selectFromMenu` null => `pendingEffectChoice = -1` (`main.ts` L680).
2. `advance()` => `runGameLoop` => item/spell path => `effectDo`.
3. Interpreter (`interpreter.ts` L475-508):
   - player + SELECT + `choiceCount >= 2` => `env.chooseEffect(...)`.
   - `choice === -1` => `return false` (no `randint0`).
   - missing chooser => `return false` (no unrequested draw).
   - `choice === -2` only then `env.rng.randint0(choiceCount)` (`effects.c` L457-458).
4. `obj-cmd` use path restores tentative charge/timeout deduction when `!used` (`obj-cmd.ts` L832-840); post-deduct only when `used` (L862+). Cancel does not burn charges.

Matches `effects.c` L425-460.

### Verdict item 1

**APPROVE** -- decision 6.1 closed. Engine cancel/random/order already good in R2; presentation is now an in-terminal GlyphTerm menu via `selectFromMenu`.

`web/src/main.ts:643-682`, `web/src/overlay.ts:618+`, `web/src/term.ts`, `effects/effect-choice.ts`, `effects/interpreter.ts:475-508`.

---

## 2. Smart-learn draw order (decision 6.2) -- APPROVE

### Live order (pure elemental)

`applyElemental` (`mon-melee.ts` L680-704) + `makeMonBlowEnv` (`mon-side.ts` L147-228):

1. pure flavor message (if pure)
2. `adjustDamArmor` physical (no learn)
3. `elementalDam` => `adjustDam` (may draw) then **always** `pendingPureElement = proj` for non-POIS (no immediate learn)
4. if elemental_dam > 0: `invenDamage` (per-item draws)
5. if contextDamage > 0: reduction, blow message (`randint0(num_messages)`), `takeHit`
6. `finishElemental()` => `updateSmartLearn` (may `oneIn(2)` / `oneIn(100)` under `birth_ai_learn`)

Matches C `melee_effect_elemental` (`mon-blows.c` L417-487): adjust_dam -> optional inven_damage -> optional message/take_hit -> **always** pure-element `update_smart_learn`.

### R2 residual (elemental_dam == 0, physical > 0) -- FIXED

R2 failed because zero elemental damage called `learn` **inside** `elementalDam` before message/takeHit.

R3 always defers via pending + `finishElemental` after the complete sequence, **including** the zero-elemental / positive-physical path. Comment at `mon-side.ts` L147-150 is now accurate.

### pure_element gating -- APPROVE (stock call graph)

C learns only if `pure_element && context->p` (L485-487).

Port:

- ACID/ELEC/FIRE/COLD: `applyElemental(..., pure=true)` => non-POIS pending => learn in `finishElemental`.
- POISON: `applyElemental(..., pure=false)` with `PROJ.POIS` => **no** pending; `finishElemental` is a no-op.

No other `elementalDam` callers. Equivalent to pure_element gating for stock blows.

### POISON not double-learned -- APPROVE

C `melee_effect_handler_POISON` (L674-689):

1. elemental with `pure_element=false` (no learn inside)
2. if alive: `player_inc_timed(TMD_POISONED, ...)`
3. `update_smart_learn(..., ELEM_POIS)` once

Port (`mon-melee.ts` L747-753 + `mon-side.ts` L209-227, L239-274):

1. `elementalDam(POIS)` does not set pending / does not learn
2. if alive: `incTimed(POISONED, ...)` then `learn(0, ELEM.POIS)` once

Death early-exit: both skip poison learn if dead after elemental damage.

### Draw COUNT/ORDER summary (birth_ai_learn on)

| Case | C | Port | Order vs C |
|------|---|------|------------|
| Pure ACID/ELEC/FIRE/COLD, elemental_dam > 0 | learn after take_hit | finishElemental after takeHit | MATCH |
| Pure, elemental_dam == 0, physical > 0 | learn after take_hit | finishElemental after takeHit | MATCH (R2 residual closed) |
| Pure, both damages 0 | learn after empty damage block | finishElemental at end | MATCH |
| POISON | 1 learn after inc_timed only | 1 learn after incTimed only | MATCH |
| Timed BLIND/etc. | learn in inc_check + post handler | monIncHooks + post-incTimed learn | MATCH class |

### Verdict item 2

**APPROVE** -- decision 6.2 closed for pure-element order, poison once, and the zero-elemental residual.

`mon-side.ts:147-228,183-187,239-274`, `mon-melee.ts:680-704,727-753`.

---

## 3. FOOD INC_TO mid-band label "nourished" -- APPROVE

C `effects-info.c` L629-636 (INC_TO subtype 3): mid-band between hungry and full uses `"nourished"`.

Port `effect-info.ts` L90-102:

- subtype 2 (SET_TO) mid-band => `"satisfied"`
- subtype 3 (INC_TO) mid-band => `"nourished"`
- both use bloated / hungry bands with the same full/hungry thresholds

**APPROVE.** `effect-info.ts:90-102`.

---

## 4. Regression: PROJECT_INFO + monster_swap -- APPROVE (still good)

### PROJECT_INFO / squareIsBelievedWall

- Predicate `known.ts` L179-183 unchanged and correct vs `cave-square.c` L901-912.
- Live targeting paint (`main.ts` L2995-3001): `projectPath(..., PROJECT.THRU | PROJECT.INFO, (grid) => squareIsBelievedWall(state, grid))`.
- `project-cast.ts` L350: `believedWall: (grid) => squareIsBelievedWall(state, grid)`.

No reintroduction of ground-truth PROJECT_INFO leak on stock player-visible consumers.

**APPROVE.**

### monster_swap camouflage / empty-dest LOS

`context.ts` L922-941 still:

- empty dest / other mon: `los(c, state.actor.grid, to)` when `other >= 0`
- player-on-dest style: `los(from, to)` when `other < 0`
- camouflage witness / mimic **before** `mon.grid = to`
- then `updateMon`, light/FOV bookkeeping

**APPROVE** -- R2-approved fix undisturbed.

---

## 5. Ownership / tests / forbidden packages -- APPROVE (with deferred mon-cmd)

### mon-cmd.ts

- Hash still deferred baseline; not modified by R3 uncommitted fix set.
- Separate agent still owns mon-vs-mon blow parity (items 5 + mon-cmd part of 8).

### Tests not relaxed (effects/mon claims)

Quoted R3 assertion **tightenings** (not relaxations):

```
// interpreter.test.ts -- was: random when chooser is -2 OR absent
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

```
// effect-info.test.ts -- new lock (tightens)
expect(rows.map((row) => row.choice)).toEqual([-2, 0, 1]);
expect(rows.map((row) => row.label)).toEqual([
  "one of the following at random",
  "breathe a cone of fire",
  "breathe a cone of frost",
]);
```

No effects-stream expect was weakened to greenwash R3.

### packages/borg, packages/linoleum, packages/cli/baseline

Untouched in R3.diff and working tree.

### cli parity RED (S-2)

Ignored as instructed.

---

## Per-item scoreboard (R3 claims)

| # | Claim | Verdict |
|---|-------|---------|
| 1 | EF_SELECT in-terminal menu (decision 6.1) | **APPROVE** |
| 2 | Smart-learn order incl. zero-elemental residual (decision 6.2) | **APPROVE** |
| 3 | FOOD INC_TO mid-band `"nourished"` | **APPROVE** |
| 4 | PROJECT_INFO + monster_swap regressions | **APPROVE** (still good) |
| 5 | mon-cmd untouched; no relaxed tests; borg/linoleum/baseline clean | **APPROVE** (mon-cmd end-state still deferred) |

---

## OVERALL VERDICT

**APPROVABLE** as the effects+monsters batch for the in-stream claims, with items **5** and the **mon-cmd part of 8** still deferred to the separate mon-cmd stream.

R2 blockers are closed:

1. Decision **6.1**: EF_SELECT is an in-terminal GlyphTerm `selectFromMenu` overlay (no `window.prompt`).
2. Decision **6.2**: pure-element smart-learn is always after the complete elemental sequence, including elemental_dam == 0 with physical damage; poison is learned once after `incTimed`.

Previously approved PROJECT_INFO believed-map and monster_swap camouflage/LOS remain intact. Forbidden packages untouched. mon-cmd remains the deferred simplified baseline.

**Non-blocking residuals (do not block approval):**

- Shared menu letter alphabet is full a-z, not C's `all_letters_nohjkl` (repo-wide overlay convention).
- EF_SELECT is pre-prompted at the chain head for fixed counts (matches all stock SELECT objects/activations; dynamic dice counts intentionally skip pre-menu and cancel via missing pending => -1).
- No dedicated unit test for the `"nourished"` label or the zero-elemental smart-learn seed order (behavior verified by code trace against C).

Reviewer: Grok (did not author the patch). ASCII only.
END REVIEW R3
