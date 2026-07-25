# Neo Angband — Parity Correction Plan (2026-07-24)

Reconciliation of two independent, blind, end-to-end audits (Grok + Codex, with Terra
as a bonus third lens on L1-L3) of the TS port against `reference/` (Angband 4.2.x C).
Oracle = the C. Goal: correct every imperfection so nothing behaves or looks different
from the original Windows build, except unavoidable browser concessions.

## 1. Method & corpus

- 17 coverage lanes; every in-scope reference file bucketed into exactly one lane
  (335 engine+frontend files, 0 unassigned) plus data + asset lanes. Coverage is proven.
- **462 raw findings** (Grok 191, Codex 227, Terra 44) -> **189 distinct defects**
  (deduped by lane + reference file), of which **68 are cross-model-confirmed** (found
  independently by >=2 models = highest confidence).
- Severity of raw findings: P0=6, P1=121, P2=158, P3=177.
- Backing detail: `RECONCILE_DIGEST.md` (all findings, per lane, both models side by
  side) and `findings-merged.json`. Per-model per-lane files under `findings/<model>/`,
  with `raw/<lane>.<model>.log` salvage copies.

Confidence note: two P0s were re-verified by Claude directly against the C+port
(paralysis free-turn; Free Action melee bypass) and both reproduce. The models proved
precise and did not invent issues (see 2.1), so P0/P1 are treated as high-confidence;
each fix still re-derives against the C before landing.

## 2. Reconciliation notes

### 2.1 Prior @Gandalf 2026-07-21 audit — status of its headline P0s
The prior ledger is stale (as its own remediation doc warned). Cross-checked against
current code:
- **Silent death (no damage line / no "*** LOW HITPOINT WARNING! ***" / no "You die.")
  -> FIXED.** `packages/core/src/game/take-hit-hooks.ts` now binds the full take_hit
  consequences (message, bell, `diedFrom`, `totalWinner`) to every take_hit site. Our
  fresh audit correctly did NOT re-flag it. (Good: no false positive.)
- **qol.autoDig default-on -> OUT OF SCOPE this pass.** Mods were excluded (deferred to
  the mod phase per your instruction). Re-audit mod defaults separately.
- **Unique resurrection on reload (maxNum not re-derived from lore pkills) -> LIKELY
  STILL OPEN.** No `maxNum`/`pkill` handling in `packages/core/src/save/`. Neither model
  independently raised it this pass; flagged as VERIFY-DURING-FIX (item O-1).
- Object-knowledge acquisition -> PARTIALLY corroborated (rune-learn gaps in stores
  L11-006/007, flavor-tile L15-003); the exact "pickup never reveals bracket" needs a
  spot re-verify (item O-2).

### 2.2 Model behavior
- Grok: aggressive, deep on control-flow/logic lanes (world/loop 20, combat 13, dungeon).
- Codex: deep on RNG/util (31), save/load (20 P1s), UI (43), monsters; returned 0 on
  some lanes Grok covered (world/loop, score, tiles) — Grok carries those. Union used.
- Terra: L1-L3 only; corroborated color/hash/parse defects (3-model confirmation).

## 3. P0 — game-breaking (fix first). 5 distinct, all high-confidence.

### P0-1  Paralyzed / Knocked-Out player still gets turns  [VERIFIED]
- C: `game-world.c:966-968` — when `TMD_PARALYZED` or STUN=="Knocked Out",
  `cmdq_push(CMD_SLEEP)` spends the turn; player cannot act.
- Port: `game/player-turn.ts` never injects sleep (confirmed: no paralysis/sleep/
  CMD_SLEEP handling anywhere in the file); `"sleep"` is in COMMAND_INFO but has no
  action handler.
- Impact: free full turns while paralyzed/knocked out — trivializes the deadliest
  status in the game.
- **Fix:** in `processPlayer`, before requesting input, check
  `timed[PARALYZED] || stun grade == Knocked Out`; if set, consume a full-energy no-op
  turn (register a `sleep`/rest-one-turn action) and skip `nextCommand()`. Mirror the C
  ordering (this branch is after the detect-ore block, before command prep).

### P0-2  Monster-melee timed statuses bypass Free Action & protection flags  [VERIFIED]
- C: `mon-blows.c` melee_effect_timed calls `player_inc_timed(..., check=true)`, so
  `player_inc_check` (player-timed.c:923-956) lets OF_FREE_ACT block paralysis,
  OF_PROT_BLIND/CONF/FEAR block those, ELEM_POIS/OPP_POIS block poison, with
  equip_learn / smart-learn side effects.
- Port: `game/mon-side.ts:207` calls `playerIncTimed(..., check, { onMessage })` with
  **no `incCheck` hook**; `player/timed.ts:388` then treats a missing hook as
  always-allow. Confirmed by reading both.
- Impact: Free Action no longer prevents melee paralysis; protection flags and poison
  resist are inert vs melee — core defensive layer is dead.
- **Fix:** supply the `incCheck` hook (and equip_learn / update_smart_learn hooks) from
  `mon-side.ts` into `playerIncTimed`, wiring the `player_inc_check` fail table
  (FREE_ACT / PROT_BLIND/CONF/FEAR / ELEM_POIS + HALLU chaos resist). Ensure the RNG
  draw order in `player_inc_check` matches C.

### P0-3  Home retrieve charges gold (routed through storeBuy)
- C: `ui-store.c:729-733` pushes `CMD_RETRIEVE` for the Home; `store.c:1783-1852`
  `do_cmd_retrieve` copies stack to pack for FREE (no price, no au change, no
  ORIGIN_STORE).
- Port: `session/game.ts:2525` `buy` always calls `storeBuy` -> `store/transact.ts`
  always `priceItem` + `player.au -= price`. `web/src/shop.ts:732` "Home Take" uses
  `game.buy`. A correct `homeRetrieve` exists and is unit-tested but is **not wired**.
- Impact: high-value home stashes become unrecoverable without gold; the free-stash path
  is dead in play.
- **Fix:** route Home "Take" to `homeRetrieve` (not `storeBuy`) in `StartedGame.buy` /
  the shop UI; no price, no ORIGIN_STORE stamp, no shuffle/maint RNG draw.

### P0-4  Home stash destroys worthless gear (routed through storeSell)
- C: `ui-store.c:577` pushes `CMD_STASH`; `store.c:2009` `do_cmd_stash` -> `home_carry`
  (store.c:870): free, accepts any object, pack-style stacking, no fuel/timeout rewrite.
- Port: `session/game.ts:2530` `sell` always `storeSell` -> `storeCarry(...)` which
  gates on `object_value_real > 0` (after the stack was already detached — item lost),
  wipes inscriptions, refuels torches, clears rod timeouts, merges OSTACK_STORE.
  `homeStash`/`homeCarry` implemented+tested but not wired.
- Impact: stashing a worthless/shop-rejected item silently destroys it; home item state
  diverges from C.
- **Fix:** route Home "Drop" to `homeStash`/`homeCarry` (not `storeSell`); no value gate,
  no note/fuel/timeout rewrite, pack-style (OSTACK_PACK) stacking.

### P0-5  Quest records dropped -> Morgoth victory unreachable  [Codex + Terra]
- C: `player-quest.c` loads Sauron/Morgoth quests; birth copies them; `quest_check`
  completes the final guardian and can set `total_winner`.
- Port: `web/src/pack.ts:374-418` `loadGamePack` omits the `quest` field even though
  `quest.json` is compiled and `CorePack`/`bindCore` support it -> empty quest table.
- Impact: normal web game has no guardian quests and NO reachable win condition.
- **Fix:** include `quest.json` in `loadGamePack` -> `bindCore`; confirm birth copies
  quests to the player and `quest_check` wires the Morgoth kill to `total_winner`.

## 4. P1 — wrong mechanics / values / RNG (121 raw). Grouped by subsystem.

Prioritize the cross-model-confirmed (CMC) items. Full per-item detail in the digest.

**RNG / determinism (highest leverage — a wrong draw desyncs the whole seed):**
- Town store init burns an extra owner RNG draw per store (CMC grok+codex, `store.c`).
- Argument-evaluation-order draws (loc(randint0,randint0), stair handling) — from prior
  audit G01/G02; re-confirm draw order matches the C reference build.
- `djb2` hash differs for non-ASCII (CMC 3-model, `z-util.c`); negative random values
  parsed with wrong base (CMC 3-model, `parser.c`). Fix parse/hash to match C exactly.

**Combat / statuses / player action:**
- `player_is_trapsafe` ignores OF_TRAP_IMMUNE equipment (CMC, `player-util.c`).
- TMD_FASTCAST cast costs full turn, not 3/4 energy (CMC, `cmd-obj.c`).
- `do_cmd_run` not refused when confused (CMC, `cmd-cave.c`).
- Over-exertion CONFUSED/IMAGE/SCRAMBLE bypass player_inc_check; TMD_SCRAMBLE/SPRINT
  chains; monster ARC/SHORT_BEAM extra draw (grok L7/L8; prior T1/T2/A1/A2).
- Fire range uses num_shots not ammo_mult; throw range formula wrong (prior R1/R2 —
  re-confirm; combat lane).

**Monsters:**
- `monster_attack_monster` skips blow effects and armor (CMC, `mon-attack.c`).
- `process_monster_timed` silently decrements instead of `mon_dec_timed` (CMC, `mon-move.c`).
- 7 further Codex P1s in mon (see digest L5).

**Effects / projection:**
- EF_SELECT never prompts — always randomizes for player origin (CMC, `effects.c` +
  `ui-effect.c`). Player loses the choice UI.
- PF_CHARM never passed into project_m (nature-mage animal boost) (CMC, `project-mon.c`).
- PROJECT_INFO / square_isbelievedwall approximated by the real map, not belief (CMC,
  `project.c`).

**Dungeon generation / traps (20 raw — large bucket):**
- Gen-time trap pick/power never runs; `trapKinds` not wired (CMC, `trap.c`).
- TRF_DELAY traps never fire — no player_leaving hook (CMC, `mon-util.c`).
- `square_set_feat` doesn't destroy traps on non-trappable terrain (CMC, `cave-square.c`).
- Disarm-on-walk for known disarmable traps missing (CMC, `cmd-cave.c`).
- Town terrain not stored/restored without birth_levels_persist (CMC, `generate.c`).
- only_partial feeling-reveal guard not modelled (CMC, `cave-view.c`).

**Player systems:** 10 P1s incl. Blackguard PF_COMBAT_REGEN gaps, timed grade chains
(digest L6).

**Save / load (21 raw, mostly Codex):**
- Monster `known_pstate` (AI learn memory) not persisted (CMC, `save.c`).
- No panic-save path (CMC, `savefile.h`).
- (JSON vs C-binary save format is by-design concession, not a defect — mark concession.)
- ~18 further field-coverage gaps (digest L12) — triage: gameplay-affecting vs cosmetic.

**Stores:** rune-learn loop omitted on buy/sell; store_will_buy treats runes as unknown
(grok L11-006/007) — ties into object-knowledge (O-2).

**UI live-path (P1 subset):**
- Sidebar stats omit equipment/timed stat_use (CMC, `ui-display.c`).
- EF_SELECT choice UI missing (CMC, `ui-effect.c`) — pairs with effects fix above.

## 5. P2 — look & feel / message drift (158 raw). Thematic strategy.

The largest bucket and the crux of "looks different." Group-fix by theme:
1. **Color/palette:** z-color defaults (COLOUR_DARK/WHITE fallbacks, MAX_COLORS 32 vs 29,
   Shade row metadata) (CMC 3-model); UI chrome uses invented pastel hex instead of the
   z-color palette; message.prf default colors (BELL/HITPOINT_WARN/AFRAID) never applied.
   -> Adopt the exact z-color table + fallbacks as the single palette source.
2. **Terminal fidelity:** RESOLVED (6.1). The fixed-80x24 grid is ALREADY the base in
   term.ts (findings claiming "responsive grid" are STALE — verify & drop). Remaining:
   inline prompts vs modal dialogs, ENTER/ESC key semantics. Keep the render seam intact.
3. **Message strings:** ~24+ string drifts (tunnel clauses, version screen, death menu,
   store greeter hints). -> Sweep against the C message strings; mechanical.
4. **Display/layout:** sidebar, stores, knowledge lists re-laid-out; equippy chars use
   kind not object attr/char; map tiles ignore flavor_x. -> per-item, from digest.

## 6. Decisions — RESOLVED by Aaron 2026-07-24

- **6.1 Terminal-fidelity target = FAITHFUL glyph terminal (core), renderer kept
  mod-swappable.** NOT a literal terminal emulator. The existing `GlyphTerm` canvas
  glyph-grid stays; make it faithful. IMPORTANT: `web/src/term.ts` ALREADY defaults to a
  FIXED 80x24 grid (reflow demoted to an opt-in flag for a future mobile mod), so P2
  "responsive grid" findings are largely STALE — re-verify and drop those. Remaining
  faithful-UI work: (a) exact z-color palette (drop invented pastel hex), (b) inline
  prompts instead of modal dialogs, (c) message-string drift.
  **HARD CONSTRAINT:** all faithful-UI fixes MUST preserve the cell-grid render seam (the
  game emits `Glyph {ch, fg, tile?}` cells; `GlyphTerm` is one consumer). Aaron will build
  a visual-overhaul MOD (canvas/PIXI) that plugs in as an alternative renderer of the same
  cell stream. Do not couple game logic to `GlyphTerm`; keep/strengthen the seam.
- **6.3 Save format = JSON stays (RATIFIED by Aaron 2026-07-25).** The port keeps its JSON
  `SavedGame` (base64 + FNV trailer) in localStorage; the C block-binary savefile format
  (`Save`+`VNLA` header, 28-byte block headers, named saver/loader tables) is an ACCEPTED
  BROWSER CONCESSION (no filesystem). Findings L12-003/004/005/006/007/009/010/013 are
  therefore CONCESSION, not defects -- close them as such. What must still match the C is
  WHICH FIELDS are saved/restored (see the save/load field items, stream B).

- **6.2 Base-game determinism = EXACT same-seed-as-C.** Same seed must reproduce the
  reference build's dungeon and rolls. => all RNG-order / extra-draw P1s (store-init draw,
  arg-eval-order G01/G02, ARC/SHORT_BEAM extra draw, etc.) are MUST-FIX. **Mod seed-parity
  contract:** mods that perturb RNG detach seed-parity (declare it); mods that only touch
  interface/visual/QoL without touching RNG preserve seed-parity. Consistent with the
  determinism ratchet.

## 7. P3 — minor / peripheral (177 raw)

Structural omissions (z-quark interning, point_set, gamma table, guid type), stale
DEFERRED comments, spoiler/help/pref-file peripherals, non-ASCII edge cases. Batch by
category; most are low-risk mechanical additions or documentation. Full list in digest.

## 7.5 SCOPE BOUNDARY (Aaron, 2026-07-25): extensions are NOT part of the port

The port = the original game, minus extensions. Extensions (Borg, linoleum) are handled
AFTER the port is confirmed complete. Consequences for this plan:

- **packages/borg — OUT OF SCOPE.** Not a parity target, not a gate. Excluded from the
  parity test gate.
- **packages/linoleum — OUT OF SCOPE** (standalone tile-conversion/authoring tooling;
  nothing in web/ or core/ imports it at runtime). The 2 L15 findings that target
  linoleum are DEFERRED. The other 9 L15 findings are IN scope: they concern the game
  faithfully rendering the original lib/tiles packs, which is part of the port.
- **PRE-EXISTING DEFECT, out-of-scope but must be recorded:** packages/borg/src/
  think.test.ts and foundation.test.ts HANG (infinite loop, ~100% CPU, never return).
  Verified to hang at ea7746494 (pre-P0), on master, and on the RNG branch -- so it is
  long-standing and unrelated to the parity fixes. This is why a monolithic `pnpm test`
  appeared to run for 6 hours. Any prior claim of a fully green suite was wrong for
  these two files. Fix when the Borg phase starts.
- **SCOPE LEAK — RESOLVED** (c50d765d4, pushed): the Borg was extracted from the game
  shell (import, `agentId === "borg"` construction, borg-only tick default, workspace
  dep). `packages/borg/**` kept untouched for the later mod phase; mod framework and the
  generic agent/sandbox/plugin seams left intact.

- **SEAMS ARE IN PORT SCOPE** (Aaron 2026-07-25): the port must ship every seam mods need,
  *including* what a Borg mod requires; only the BUILDING and VALIDATION of mods is
  deferred. `DEMO_AGENTS` stays (seam registry/harness, not a mod).

- **OPEN SEAM WORK ITEM (S-1) — static content read for agent mods.** The perceive facade
  gates 10 DYNAMIC domains (player, monsters, map, inventory, floor, target, messages,
  stores, spells, constants) but exposes NO static content/registry read. The bundled Borg
  obtained static monster-race facts (flags, level, sleep, spellPower, freqInnate,
  freqSpell, blows/spells by ridx) through `makeCoreResolvers` reading
  `booted.registries.monsters.races` DIRECTLY — privileged shell access that never went
  through the seam. This is a pre-existing gap, not a regression from the extraction: a
  Borg-class mod still runs via the `defaultResolveMonsterFacts` fallback
  (packages/borg/src/resolvers.ts:82, derived from MonsterView) but with degraded danger
  calculations. FIX: add a capability-gated static-content read (e.g. `state:content.read`
  with a `monsterRace(ridx)` lookup) to the perceive facade + sandbox serializer. Seam-only
  change; no game-logic or parity risk. Schedule as port work, before "port complete".

### Test gate for port work (use this, not `pnpm test`)
Run CHUNKED with hard timeouts, excluding borg. A monolithic run hides hangs:
```
timeout 600 pnpm vitest run packages/core/src/<area> --testTimeout=20000
```
Chunks that are green as of 2026-07-25 (219 files): store+session, obj, gen+world,
game+combat+mon+player, web, cli+content+linoleum, and rng/save/effects/score/sound/
visuals/mod. Always check ${PIPESTATUS[0]} (124 = hang), not $? after a pipe.

## 7.6 DEFERRED: the `game/mon-cmd.ts` follow-up stream (M-1)

`packages/core/src/game/mon-cmd.ts` became a contention point: the RNG stream owned it for
the mon-vs-mon message draw, so the effects/monsters stream was BLOCKED from the items whose
implementation lives in the same file. Do these together in ONE dedicated pass, after the RNG
stream and the colour stream have merged (the colour stream builds the typed-message seam this
needs):

- **M-1a** RNG item 9 residual: emit the C `msgt` message TYPE with the monster message.
  Draw ORDER/COUNT is already correct and Codex-approved (mon-blows.c:395-399, 477-480,
  609-612, 645-647); only the type is missing because `state.msg` took text only. The colour
  stream's typed-message plumbing (MSG type through `state.msg` -> web log -> `typeColor`)
  makes this small.
- **M-1b** effects/monsters item 5: `monster_attack_monster` must apply blow EFFECTS and the
  target's ARMOUR (C mon-attack.c:765-901, mon-blows.c:225). Currently skipped.
- **M-1c** the remaining monster-vs-monster P1s from the L5 findings that were blocked by the
  same exclusion.

## 7.7 MEASURED UPSTREAM DIVERGENCE the code audit MISSED (S-2, P1)

Discovered 2026-07-25 while gating the RNG merge. `packages/cli/src/parity-c.test.ts` is the
ONE genuinely non-self-referential check in the repo: it runs the port live (fixed seed) and
compares against `packages/cli/baseline/c-stats-baseline.json`, imported from the compiled C
`main-stats` tool (the test even asserts "is generated from real C output, not the port
itself"). IT IS RED, and has been:

```
depths.6.monsterTotal: baseline=46.465 fresh=43.48  (allowed +/-2.32)
depths.6.monsters.63 : baseline=2.855  fresh=5      (allowed +/-2)
depths.7.monsterTotal: baseline=48.775 fresh=46.11  (allowed +/-2.44)
depths.8.monsterTotal: baseline=47.805 fresh=51     (allowed +/-2.39)
```

VERIFIED IDENTICAL at c50d765d4 (before the RNG batch) and db109880a (after), so the RNG
determinism work neither caused nor fixed it. This is a REAL monster density/species
divergence from upstream at depths 6-8 -- exactly the class of defect that reading code
cannot find, and NEITHER Grok NOR Codex flagged it across 462 findings. Statistical harnesses
catch what code review cannot.

ACTION: treat as an open P1. Investigate monster allocation/density at depth 6-8
(`obj-make`/`mon-make` alloc tables, `get_mon_num` level scaling, pit/group placement) against
the C. Do NOT "fix" it by widening the tolerance or regenerating the C baseline.

### stats-baseline.json policy (settled)
`packages/cli/src/parity.test.ts`'s "reproduces the committed baseline exactly
(self-regression guard)" is SELF-REFERENTIAL (port vs its own recorded output, zero tolerance).
It is ALSO red, with identical numbers at c50d765d4 and db109880a, i.e. the committed baseline
was already stale before today. Re-recording it is legitimate ONLY once we believe current
generation is correct -- and parity-c above proves we do NOT. So the baseline stays reverted
and this guard stays red on purpose. Re-record it (in its own commit, with the C-vs-TS delta
demonstrated) only after S-2 is closed.

## 8. Open items to verify during fix
- **O-1** Unique resurrection on reload — re-derive maxNum from saved lore pkills? (save/).
- **O-2** Object-knowledge on pickup/sight (objectTouch/See/Sense) — bracket reveal + rune
  sweep of jewelry/artifacts.
- **O-3** Re-audit mod defaults (qol.autoDig etc.) in the mod phase (out of scope here).

## 9. Suggested execution order
1. P0-1..P0-5 (game-breaking, small and localized; mostly wiring existing tested code).
2. RNG-determinism P1s (gate 6.2 first) — they invalidate seed reproduction.
3. Remaining P1s by subsystem (traps, effects, monsters, combat, save/load).
4. P2 after 6.1 decision (palette + messages are mechanical; terminal fidelity is the big
   one).
5. P3 batch cleanup.
6. Then mods (QoL / bug-fixes) on the now-faithful base.
