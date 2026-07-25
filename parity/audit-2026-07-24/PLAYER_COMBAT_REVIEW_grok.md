# PLAYER_COMBAT independent adversarial review (Grok)

Worktree: `C:\Repositories\na-wt-pc` branch `parity/p1-player-combat`
Diff: `PLAYER_COMBAT_FIX.diff` (7 files, +66/-17)
Spec: `PLAYER_COMBAT_BRIEF.md`
Oracle: `reference/` (Angband 4.2.x)
Method: re-derive each item from the cited C, then walk the LIVE port call path (not just unit-export presence). Default: flag when uncertain.

Codex "no change needed" claims under extra scrutiny: items 3, 7, 8, 9, 10.

---

## SEED PARITY (decision 6.2) — items 2 and 5

### Item 2 (fire/throw confuse-dir draw)

C `player-attack.c:1349-1352` (fire) and `:1392-1395` (throw) call
`player_confuse_dir(player, &dir, false)` immediately after `cmd_get_target`.

C `player_confuse_dir` (`player-util.c:1353-1377`) when `TMD_CONFUSED`:
1. if `dir == 5` OR `randint0(100) < 75` (short-circuit: dir==5 skips the 100-draw)
2. then `dir = ddd[randint0(8)]`
3. message only when direction actually changed

Port `playerConfuseDir` (`packages/core/src/game/obj-cmd.ts:610-636`) matches that short-circuit and draw order.
Live wiring: `ranged-cmd.ts:216-219` (fire) and `:291-294` (throw) call it after dir resolution, before ranged_helper work — same relative position as C (after aim, before shot resolution).

Verdict: added draws are the C's draws, in the C's place, no extras.

### Item 5 (run refuse while confused)

C `do_cmd_run` (`cmd-cave.c:1380-1381`) calls `player_confuse_dir(..., true)`.
When confused + `too`: still performs the confuse RNG roll(s), then messages
"You are too confused." and returns true WITHOUT writing the randomized dir
(`player-util.c:1363-1366`).

Port `runAction` (`player-path.ts:887-894`) only enters when confused, then
`playerConfuseDir(..., true)` which draws then messages and returns original dir.
Draw count/order matches C for the confused case.

Verdict: seed-correct for the confuse draws. (Order vs web: see item 5 below.)

### Test fixture `player-turn-coercion.test.ts`

Quote of the edit:

```
+    /* C only emits the delayed flee message when monster_is_visible(mon)
+     * (player-attack.c:1023-1025); make this fixture explicitly visible. */
+    mon.mflag.on(MFLAG.VISIBLE);
```

Judgement: **C-aligned assertion / fixture correction, NOT a relaxation.**
After item 1, `monsterFled = fear && monVisible` (`melee.ts:725`) and
`py_attack` only messages when visible (`player-attack.c:1023-1025`). Without
`MFLAG.VISIBLE`, the test would fail under correct C rules. The assertion
(`flees in terror` must print) is unchanged and still requires the real effect;
the fixture was under-specified for the new visibility gate.

---

## Item 1 — Invisible melee to-hit half + flee visibility

**APPROVE**

C:
- `chance_of_melee_hit` (`player-attack.c:104-109`): `monster_is_visible(mon) ? chance : chance/2`
- fed into `test_hit` at L763
- delayed flee message gated on visibility at L1023-1025

Port combat math already halved on `monVisible` (`melee.ts:243-249`, `:725`).
Live callers previously forced `monVisible: true` / `visible: true`.

Diff fixes both live paths:
- `player-turn.ts:243-266` — `monsterIsVisible(target)` into learn + `pyAttack`
- `effect-melee.ts:91-106` — same for effect-handler `py_attack_real` path

No remaining production `monVisible: true` forced sites (only tests).

---

## Item 2 — fire/throw `player_confuse_dir`

**APPROVE**

C position and too=false: see SEED PARITY above.
Port: `ranged-cmd.ts:216-219`, `:291-294` + shared `playerConfuseDir`.

Draw: adds the C confuse draws only while `TMD.CONFUSED`; silent when not.

---

## Item 3 — Fire range ammo_mult; throw range formula (claimed no change)

**APPROVE** (already correct; claim holds under re-derive)

C fire (`player-attack.c:1310-1311`):
```
int range = MIN(6 + 2 * player->state.ammo_mult, z_info->max_range);
int shots = player->state.num_shots;
```
`ammo_mult` is launcher might (`player-calcs` / port `calcs.ts:1233`), NOT `num_shots`.

Port fire (`ranged-cmd.ts:223-229`):
```
const range = Math.min(6 + 2 * state.actor.combat.ammoMult, state.z.maxRange);
```
Energy uses `numShots` separately (`:235-236`) — correct split.

C throw (`player-attack.c:1366,1402-1403`):
```
str = adj_str_blow[player->state.stat_ind[STAT_STR]];
weight = MAX(object_weight_one(obj), 10);
range = MIN(((str + 20) * 10) / weight, 10);
```

Port throw (`ranged-cmd.ts:319-326`): identical formula via `adj_str_blow` and
`state.statInd?.[STAT.STR]` (live `statInd` is maintained in `session/game.ts`).

Pre-diff HEAD already had both formulas; no change required. Live command path
uses these lines (not a dead export).

---

## Item 4 — FASTCAST 3/4 energy

**APPROVE**

C `cmd-obj.c:1164-1168`:
```
if (player->timed[TMD_FASTCAST])
  energy_use = (z_info->move_energy * 3) / 4;
else
  energy_use = z_info->move_energy;
```

Port `spell-cmd.ts:287-291`:
```
return (player.timed[TMD.FASTCAST] ?? 0) > 0
  ? Math.trunc((state.z.moveEnergy * 3) / 4)
  : state.z.moveEnergy;
```
Only on successful cast (`if (!cast) return 0` first) — matches C (`spell_cast` then set energy).

---

## Item 5 — `do_cmd_run` refuses when confused

**ISSUE** (mostly fixed; residual order gap)

Primary fix is correct:
- Message "You are too confused." via `too=true` (`obj-cmd.ts:623-625`)
- Confuse RNG still drawn (`obj-cmd.ts:617-619`)
- Wired on live run command (`player-path.ts:887-894`)

**ISSUE residual — web-before-confuse order** (`cmd-cave.c:1368-1381` vs `player-path.ts:887-894`):

C `do_cmd_run`:
1. get direction
2. if webbed: clear web, spend full move energy, return (NO confuse refuse)
3. THEN `player_confuse_dir(..., true)`

Port: confuse refuse runs first, returns 0 energy, never reaches web clear.

If player is both webbed and confused, C clears the web for a full turn;
port prints "You are too confused." and spends no energy / leaves web.
`file:line`: `packages/core/src/game/player-path.ts:887-894` (missing web branch before refuse; C at `cmd-cave.c:1368-1381`).

Not a seed-draw bug for the confuse roll itself, but a live behavioral miss vs C.

---

## Item 6 — `player_is_trapsafe` + OF_TRAP_IMMUNE

**ISSUE** (partial fix; live step-on-trap path still wrong)

C (`player-util.c:1073-1077`):
```
if (p->timed[TMD_TRAPSAFE]) return true;
if (player_of_has(p, OF_TRAP_IMMUNE)) return true;  /* p->state.flags */
return false;
```
One function; used by run/path AND `hit_trap`.

### What Codex fixed

`player-path.ts:60-69` now ORs timed TRAPSAFE, `playerState.flags` TRAP_IMMUNE,
and a raw equipment scan. Good for run stop / pathfinding trap forbid.

### What remains broken on LIVE play

1. **`hitTrap` does not see OF_TRAP_IMMUNE in live wiring**
   - `trap.ts:419-423` relies on `env.playerHasFlag?.(OF.TRAP_IMMUNE) ?? false`
   - `session/game.ts:1346-1366` builds `trapDeps.env` with `expGain`/`msg`/`changeLevel` only — **no `playerHasFlag`**
   - `installTraps` (`trap.ts:685-688`) steps onto traps via `onPlayerMoved` -> `hitTrap` with that deps object
   - Result: gear OF_TRAP_IMMUNE does NOT skip trap fire on step. Timed TMD_TRAPSAFE still works (checked directly).
   - `file:line`: `packages/core/src/session/game.ts:1358-1365` (missing hook); `packages/core/src/game/trap.ts:422-423`

2. **Chest local copy still timed-only**
   - `chest.ts:84-86` still:
     `return (state.actor.player.timed[TMD.TRAPSAFE] ?? 0) > 0;`
   - Used at open/disarm chest (`:273`, `:345`). Equipment TRAP_IMMUNE still triggers chest traps.
   - Comment still says OF_TRAP_IMMUNE half is deferred (`:79-82`).
   - `file:line`: `packages/core/src/game/chest.ts:84-86`

3. Stale module header in `player-path.ts:31-32` still claims OF_TRAP_IMMUNE half is deferred (doc only).

Codex fixed the run/path helper and called the item done. The C function's primary combat-relevant use (`hit_trap` when you walk onto a trap) is still incomplete on the live session path. **Not APPROVE.**

---

## Item 7 — Over-exertion CONFUSED/IMAGE/SCRAMBLE through `player_inc_check` (claimed no change)

**APPROVE** (claim holds for the over-exert primitive + live world hooks)

C `player_over_exert` (`player-util.c:846-875`):
- SCRAMBLE / CONF / HALLU use `player_inc_timed(..., check=true)` (last arg true)

Port `playerOverExert` (`world.ts:259-301`):
```
inc(TMD.SCRAMBLE, ..., true);
inc(TMD.CONFUSED, ..., true);
inc(TMD.IMAGE, ..., true);
```
and `inc` calls `playerIncTimed(..., check, thooks)` with `thooks = state.world.timedHooks`.

Live world hooks (`session/game.ts:1515-1523`):
```
incCheck: (idx) => playerIncCheck(eff, worldIncQueries)
```
`makeIncCheckQueries` (`player-side.ts:65-78`) reads `playerState.flags` / `elInfo` / pflags / timed — the same derived state C's `player_inc_check` uses.

Fail data:
- CONFUSED: PROT_CONF (`player_timed.json`)
- IMAGE: RESIST CHAOS
- SCRAMBLE: RESIST NEXUS

Live proof path: `timed-transition.test.ts` drives `startGame` hooks, not a bare export.
Melee bloodlust SCRAMBLE goes `player-turn.ts:173-175` -> `playerOverExert` -> same world hooks.

**Residual (not the same bug, still note):** C `mon-util.c:1111-1114` on kill under bloodlust also does PY_EXERT_CONF / HALLU. Port mon-death has no bloodlust over-exert call — those effects never fire on kill. That is a missing feature / seed gap, not "applied unchecked." Default flag as residual, not a failure of Codex's "already routes through check=true" claim for the existing over-exert function.

---

## Item 8 — TMD_SCRAMBLE / SPRINT on-begin / on-end chains (claimed no change)

**APPROVE** (claim holds; live chains fire)

Pack data (`player_timed.json`):
- SPRINT `on-end-effect`: TIMED_INC_NO_RES SLOW dice 100
- SCRAMBLE `on-begin-effect`: SCRAMBLE_STATS; `on-end-effect`: UNSCRAMBLE_STATS

Bind (`player/bind.ts:711-730`) loads chains onto `TimedEffect`.

Runtime (`player/timed.ts:359-364`): `playerSetTimed` calls `hooks.onTransition` on 0<->positive.

Live wiring:
- World clock: `session/game.ts:1527-1528` onTransition -> `runTimedTransition`
- Effect interpreter: `session/game.ts:1105-1107` same
- `runTimedTransition` (`session/game.ts:1121-1144`) dispatches bound chain through live effect stack
- `decreaseTimeouts` (`loop.ts:322`) uses `playerDecTimed` with world timedHooks, so SPRINT natural lapse fires on-end

Live proof: `timed-transition.test.ts:116-164` via `startGame` — SCRAMBLE permutes stats and restores; SPRINT end applies SLOW.

Not merely exported: startGame path + world decrement path both supply onTransition.

---

## Item 9 — Blackguard PF_COMBAT_REGEN (claimed no change)

**APPROVE** (claim holds; complete vs all C sites)

C sites re-derived:

| C site | Behavior | Port live path |
|--------|----------|----------------|
| `player-util.c:216-222` take_hit | hp->mana; exclude poison / fatal wound / starvation | `take-hit.ts:102-130` exclusions + `take-hit-hooks.ts:71-78` formula; wired as sharedTakeHitHooks in session |
| `player-attack.c:1002-1005` | pre-blow 5% msp | `player-turn.ts:200-205` combatRegen hook |
| `player-spell.c:518-520` | convert_mana_to_hp on cast | `spell-cmd.ts:197-202` + `combat-regen.ts` |
| `player-util.c:499-521` regen mana | degen mana above half HP; lost SP -> HP x2 | `loop.ts:231-258` playerRegenMana |

Formula check take_hit: `(MAX(msp,10)*65536)/mhp * dam` left-associative — matches hooks (`take-hit-hooks.ts:77`).

No missing C COMBAT_REGEN site found. Already wired; no change needed.

---

## Item 10 — Monster ARC / SHORT_BEAM extra draw (claimed no change)

**APPROVE** (claim holds; draw counts match C)

C `effect_handler_ARC` (`effect-handler-attack.c:811-814`):
```
if (SRC_MONSTER) {
  flg |= PROJECT_PLAY;
  target = player->grid;   /* NO randint */
}
```
C `effect_handler_SHORT_BEAM` (`:867-870`): same direct `player->grid`.

Contrast BALL (`:626-628`): confused mon does `randint1(100)` then maybe `randint1(9)`.

Port (`effect-attack.ts:243-275`):
```
const grid = source.isMonster
  ? env.state.actor.grid
  : resolveAimedTarget(...).grid;
```
Does not call `monsterGetTarget` / `resolveAimedTarget` for monster ARC/SHORT_BEAM — so no `randint1(100)` accuracy roll (`effect-mon-origin.ts:124`).

Draw count (monster source, unconfused): **C 0 targeting draws; port 0 targeting draws.**
(Damage dice draws remain; not targeting.)

Live guard: `effect-attack.test.ts:239-268` spies randint1 and asserts 100 never appears, player takes damage.

---

## OVERALL VERDICT

**CONDITIONAL FAIL / partial accept — do not treat the lane as closed.**

| # | Item | Verdict |
|---|------|---------|
| 1 | Invisible melee half + flee visibility | APPROVE |
| 2 | Fire/throw confuse_dir (+ seed) | APPROVE |
| 3 | Fire/throw range formulas | APPROVE (no change; verified) |
| 4 | FASTCAST 3/4 energy | APPROVE |
| 5 | Run refuses when confused | ISSUE (web-before-confuse order) |
| 6 | player_is_trapsafe OF_TRAP_IMMUNE | ISSUE (hitTrap live + chest still broken) |
| 7 | Over-exert inc_check | APPROVE (no change; verified) |
| 8 | SCRAMBLE/SPRINT on-begin/on-end | APPROVE (no change; verified) |
| 9 | PF_COMBAT_REGEN complete | APPROVE (no change; verified) |
| 10 | ARC/SHORT_BEAM draw count | APPROVE (no change; verified) |

**Score:** 8 APPROVE, 2 ISSUE (5 residual, 6 substantive).

### The five "no change" claims

| # | Codex claim | Independent result |
|---|-------------|-------------------|
| 3 | already correct | CONFIRMED |
| 7 | already correct | CONFIRMED for over-exert path (+ residual mon-death bloodlust CONF/HALLU unwired) |
| 8 | already correct | CONFIRMED on live world + interpreter paths |
| 9 | already correct | CONFIRMED all C sites |
| 10 | already correct | CONFIRMED; 0 extra targeting draws |

These five were not skip-work lies; the code matches the C on the live paths cited.

### Must-fix before merge

1. **Item 6 (blocking):** wire `playerHasFlag` (or equivalent `player_of_has` on `playerState.flags`) into live `trapDeps.env` in `session/game.ts`, and fix `chest.ts` local `playerIsTrapsafe` to honour OF_TRAP_IMMUNE the same way as C's single function.
2. **Item 5 (minor but real):** if webbed, clear web / spend energy before confuse refuse, matching `cmd-cave.c:1368-1381`.

### Seed parity summary

- Item 2: confuse draws added in C position — good.
- Item 5: confuse draws present on refuse path — good; web order not seed-related.
- Fixture edit in `player-turn-coercion.test.ts`: **C-aligned, not a relaxation.**

### Reviewer note on skepticism

Item 6 is the classic "fixed one local helper, left the real live call site" pattern. Run/path `playerIsTrapsafe` was updated; the session still never supplies `playerHasFlag` to `hitTrap`, so trap-immune boots do not protect when you step on a trap. That alone is enough to reject "item 6 done."

ASCII only. No commit/push by this review.
)
