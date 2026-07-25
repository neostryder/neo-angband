# SAVELOAD Field-Parity Review (independent adversarial)

Reviewer: Grok (did not author the patch)
Worktree: `C:\Repositories\na-wt-save` branch `parity/p1-saveload`
Diff under review: `parity/audit-2026-07-24/SAVELOAD_FIX.diff` (matches worktree unstaged)
Oracle: `reference/src/save.c`, `reference/src/load.c`, `reference/src/mon-make.c`
Spec: `SAVELOAD_BRIEF.md`
Stance: skeptical; default to ISSUE when incomplete or uncertain.

Changed files (8):
- `packages/core/src/session/save.ts`
- `packages/core/src/session/save.test.ts`
- `packages/core/src/session/game.ts`
- `packages/core/src/obj/make.ts`
- `packages/core/src/mod/ids.ts`
- `packages/core/src/mod/save-blocks.ts`
- `packages/core/src/gen/generate.ts`
- `packages/core/src/gen/util.ts`

Untouched as required: `packages/core/src/save/buffer.ts` (no header/magic/checksum/block-registry edits).
`SAVE_VERSION` remains `2` (additive optional JSON fields; no bump).

---

## Per-item verdicts

### (1) Monster known_pstate flags + el_info — APPROVE

C oracle:
- `save.c:231-235` writes `known_pstate.flags[OF_SIZE]` and `el_info[ELEM_MAX].res_level` only.
- `load.c:301-305` restores both into the monster body before `place_monster` (`load.c:1463`).
- No `known_pstate.pflags` byte is written or read.

Port:
- `serializeMonster` emits `knownPstateFlags` / `knownPstateElInfo` (`save.ts:386-387`).
- `deserializeMonster` restores onto a `blankMonster` before return (`save.ts:415-421`); load only then inserts into `state.monsters` (`game.ts:2937-2939`). No live AI path runs between restore and insertion.
- `pflags` is never serialized (correct omission).

Notes (not ISSUES):
- Old saves without the fields keep blank known_pstate (additive back-compat; no version bump needed).
- `if (data.knownPstateFlags)` treats a missing field as skip; a present zero-filled array is truthy and restores correctly.

---

### (2) Object effect-presence + activation index — APPROVE

C oracle:
- `save.c:113-117` effect-present byte; `save.c:184-188` activation index (0 if none).
- `load.c:153` reads effect byte; `load.c:223-226` sets `activation = &activations[tmp16u]` only when nonzero; `load.c:247-249` sets `effect = kind->effect` only when the byte is nonzero.

Port:
- Serializes `effectPresent: obj.effect !== null` and `activationIndex: obj.activation?.index ?? 0` (`save.ts:155-156`).
- Restores activation strictly from saved index when present (`save.ts:225-230`); effect/effectMsg only when `effectPresent` (`save.ts:253-254`).
- Old-save defaults: `effectPresent ?? true` and kind/artifact activation fallback when `activationIndex` is absent — preserves pre-fix behavior without a version bump.

No evidence of wrong index space: activations are 1-based with a null slot 0 (`obj/bind.ts`), matching C.

---

### (3) Artifact created + seen + everseen — APPROVE

C oracle:
- `save.c:674-688` / `load.c:1036-1059`: three bools + reserved byte per aidx.

Port:
- `ArtifactState` gains `seen` / `everseen`, `snapshotState()`, and restore of all three (`obj/make.ts`).
- Serialize as id lists `artifactsCreated` / `artifactsSeen` / `artifactsEverseen` (`save.ts:1167-1178`); load via `deserializeArtifactFlags` (`game.ts:2860-2878`).
- `reset()` clears created+seen, not everseen — matches `player-birth.c:407-408` (clears created+seen only).

Note: In both C and this port, almost nothing *sets* seen/everseen true at runtime (C `mark_artifact_seen`/`everseen` have no in-game true-setters beyond birth clear + load). Field round-trip is still correctly implemented; the dead writers are a pre-existing C/port gap, not introduced by this patch.

---

### (4) Decoy grid restored for cave_find_decoy / targeting — ISSUE

C oracle:
- `load.c:1497-1500`: while reading traps on the live cave, if trap kind is decoy, set `c->decoy = grid`.

Port attempt:
- `deserializeTraps` takes `onDecoy` and fires when `kind.name === "decoy" || kind.desc === "decoy"` (`save.ts:1445-1446`) — kind match is fine (`trap.json` name/desc are both "decoy").
- `loadGame` creates a **local** `let decoy: Loc | null = null` and passes a callback that assigns that local (`game.ts:2918-2929`).

**Bug: the local is never written into `GameState`.**

Evidence:
- `state` object construction (`game.ts:2932-3036`) never includes `decoy: decoy` (or any decoy field).
- No later assignment: `wireGame` / post-load path never sets `state.decoy`.
- Grep of `game.ts` shows the only load-path references are the local at 2919/2927; other `state.decoy` uses are change-level / arena stash only.

Consequence: after reload with a live decoy trap, `caveFindDecoy` / mon-ranged / effect handlers still see no decoy. Item (4) is incomplete — a dead store.

ISSUE: dead local decoy; not assigned to `state.decoy` — `packages/core/src/session/game.ts:2918-3036`.

---

### (5) Dead saves omit dungeon objects/monsters/traps/chunks — ISSUE (partial)

C oracle:
- Save early-outs: `wr_objects_aux`/`wr_monsters_aux`/`wr_traps_aux` (`save.c:878-879,919-920,938-939`), `wr_dungeon` after header (`save.c:968-969`), `wr_chunks` (`save.c:1005-1006`).
- Load early-outs: `rd_objects_aux`/`rd_monsters_aux`/`rd_traps_aux` (`load.c:1398-1400,1437-1439,1478-1480`); chunks only exist when written.

Port (save side) — largely correct:
- Omits `chunk`, `featLegend`, `monsters`, `groups`, `floor`, `traps`, `levelCache`, `currentJoins`, `known` when `state.isDead` (`save.ts:1142-1155,1181-1194,1215-1225`).
- Keeps dungeon depth via `dungeonDepth` (C still writes depth in the dungeon header).
- Keeps player, gear, lore, artifacts, rng (correct; C still dumps those).

Port (load side) — largely correct:
- Skips restoring dungeon entities when `save.isDead` (`game.ts:2920-2954`); dummy 1x1 chunk + optional depth.

**ISSUE — over-broad dead short-circuit in mod quarantine:**
- `quarantineSave` returns immediately for `out.isDead` without scanning gear/pack/equipment (`save-blocks.ts:336-342`).
- `rehydrateSave` likewise returns dead saves untouched (`save-blocks.ts:746`).
- Dead characters **still carry gear** (C and port). Skipping quarantine means a dead save with mod-owned inventory never orphans those objects; load with that mod absent can fail or mis-handle ids.
- Rationale comment ("C omits dungeon entities") does not justify skipping gear quarantine.

ISSUE: dead-save quarantine/rehydrate early-return skips still-present gear — `packages/core/src/mod/save-blocks.ts:336-342` and `:746`.

Type hygiene (non-blocking): `SavedGame.chunk` remains a required field while dead serialize omits it via `as SavedGame` (`save.ts:771,1260`). Load tolerates absence; the type lies.

---

### (6) Player load validation/repair — APPROVE

C oracle `load.c:766-839`:
1. Reject lev outside 1..PY_MAX_LEVEL.
2. `max_lev = max(max_lev, lev)`.
3. `max_depth < 0` -> 1; `recall_depth <= 0` -> `max_depth`.
4. If `chp >= 0`, `died_from = "(alive and well)"`.
5. Timed: read min(num, TMD_MAX); zero remainder or strip extras.

Port (`save.ts:654-680,690-691`):
- Throws on invalid lev (load fail equivalent).
- maxLev / maxDepth / recallDepth repairs match order and predicates.
- diedFrom repair uses `chp >= 0` (so chp==0 is "alive" for this rule — matches C).
- `timed.set(data.timed.slice(0, TMD_MAX))` on a blankPlayer zeroed array matches the JSON-container equivalent of C's stream bounds (no need to "strip bytes").

No missing repairs from the cited range identified.

---

### (7) History artifacts by NAME — APPROVE (minor note)

C oracle:
- `save.c:1063-1067` writes artifact NAME string (or empty).
- `load.c:1744-1757` `lookup_artifact_name`; skip entry if name non-empty and unresolved.

Port:
- Serialize `artifactName` via `ids.artifactName(aIdx)` (raw `a.name`) (`save.ts:602-608`, `ids.ts:278-281`).
- Load exact name match; `continue` if missing (`save.ts:695-716`).
- Legacy `aIdx` tolerated for old JSON.

Minor note (not blocking): C `lookup_artifact_name` also has a fuzzy substring fallback (`obj-util.c:533-540`). Port is exact-only. Names the port itself writes are full names, so normal round-trip is fine; hand-mangled partial names diverge. Acceptable for this brief.

---

### (8) Connector x,y,feat + SQUARE_SIZE info + feat remap — APPROVE

C oracle:
- `save.c:850-866`: x, y, feat, then every `SQUARE_SIZE` info byte; sentinel `0xff`.
- `load.c:1366-1382`: restore same into fresh connector nodes.
- C does **not** remap connector feat indices (raw byte); brief's "remap" is port-specific content stability via `featLegend`/`featRemap`, which is appropriate here and applied to joins (`game.ts:3005`, `save.ts:1711-1714`).
- Brief cite `load.c:1653-1678` is chunk *metadata* (name/turn/depth/feeling/...), not connector feat remap — citation noise, not a port bug.

Port:
- Persist `info` padded to `SQUARE_SIZE` on `currentJoins` and level-cache joins (`save.ts:1190-1191,1652-1653`).
- Restore with copy + featRemap.
- `collectJoins` now copies square info bits (`gen/generate.ts:218-222`); `Connector.info?` on the type (`gen/util.ts:111-112`).

Notes:
- C `build_staircase` / join transforms also largely ignore `join->info` for placement (feat+grid only). Persisting info is still required field parity.
- Wrong line cite in `util.ts` comment (`save.c:1205-1211`; real save site is `save.c:850-866` / collect in `generate.c:1203-1214`). Cosmetic.

---

### (9) Chunk remap must not mutate source — APPROVE

C oracle: `load.c:1307-1355` builds a **new** cave (`cave_new`) and decodes into it.

Port was mutating `data.feats` in place. Fix:
- `remapFeats` returns a new array (`save.ts:1369-1375`).
- `deserializeChunk` builds `{ ...data, feats: remapFeats(...) }` when remap non-empty (`save.ts:1568-1574`).
- `deserializeKnown` also uses non-mutating remap.

Source JSON/`SavedGame` chunk data is no longer rewritten by load. APPROVE.

---

### (10) Killed uniques stay dead end-to-end — APPROVE

C oracle:
- `load.c:515-535`: reset max_num (100 / 1 for unique); for each lore row, if unique && nkill then `race->max_num = 0`.
- `mon-make.c:257` / placement refuse when `cur_num >= max_num`.

Port:
- Lore `pkills` already serialized (`save.ts` lore block; pre-existing).
- After `countMonsterRaces`, load re-derives (`game.ts:3042-3057`): unique && pkills>0 => `maxNum = 0`.
- Fresh `bindCore` on every `loadGame` starts uniques at `maxNum: 1` (`mon/bind.ts:783`), so the re-derive is necessary and correct.
- Kill path already sets `maxNum = 0` and increments pkills (`game.ts:753-786`).

Test `save.test.ts:174-201` save/loads with pkills=1 and asserts maxNum 0 vs 1 for spared unique. That is the real load path (serialize -> JSON -> loadGame -> registry), not a pure field unit test. Placement/gen already gate on maxNum elsewhere. APPROVE.

---

## Critical checks

### Changed test expectations in `save.test.ts` — JUSTIFIED (not relaxed)

**Change A** (`save.test.ts:599-600`): round-trip of custom `diedFrom` now forces `p.chp = -1` first.

```ts
/* load.c:791-793 preserves died_from only for a dead (negative-HP) save. */
p.chp = -1;
p.diedFrom = "a fruit bat";
```

C: if `chp >= 0`, always rewrite died_from. Without chp=-1 the expectation `"a fruit bat"` would be **wrong under C**. This is correcting the fixture to the C precondition, not relaxing the assert.

**Change B** (`save.test.ts:620-621`): old save missing `diedFrom` now expects `"(alive and well)"` instead of `""`.

```ts
/* load.c:791-793 repairs an alive save's cause to this exact string. */
expect(rp.diedFrom).toBe("(alive and well)");
```

Alive `startGame` character has chp >= 0; C repair **always** yields that exact string. Old expectation `""` was non-C. Tightening, not relaxing.

Verdict: both changes are C-justified.

### Save FORMAT not changed — APPROVE

- No edits under `packages/core/src/save/` (buffer/header/checksum/block registry untouched).
- `SAVE_VERSION` still 2; new fields are optional JSON with defaults.
- JSON container remains the ratified concession (brief OUT OF SCOPE).

### RNG draw order/count — APPROVE

- No new RNG draws in save/load or in the gen edits (info bit copy only).
- `deserializeStores` path unchanged in spirit; no extra rolls introduced by this patch.

### `gen/**` edits — APPROVE logic; FLAG merge-conflict risk

- Minimal: optional `Connector.info` + `collectJoins` copies `c.info(grid).bits`.
- Correct for field coverage (generate.c:1203-1214).
- **Merge-conflict risk: HIGH** — another agent owns `packages/core/src/gen/**` on a parallel branch. Expect conflicts on `generate.ts` / `util.ts` and on any `Connector` construction sites (`join.test.ts` etc. still build `{grid,feat}` only, which remains valid because `info` is optional).

### Save-version bump — NOT needed; old-save handling OK

Additive optional fields with documented fallbacks:
| Field | Missing-old-save behavior |
| --- | --- |
| knownPstate* | blank (unlearned) |
| effectPresent / activationIndex | previous kind/artifact defaults |
| artifactsSeen / Everseen | all false |
| hist artifactName | legacy aIdx path |
| join.info | omit info |
| dead-omitted chunk/monsters/... | only when isDead |

No SAVE_VERSION bump required. Explicit old-save handling is present and consistent with the brief ("bump ONLY if unavoidable").

---

## Summary table

| # | Topic | Verdict |
| --- | --- | --- |
| 1 | known_pstate flags + el_info (no pflags) | APPROVE |
| 2 | effect byte + activation index | APPROVE |
| 3 | artifact created/seen/everseen | APPROVE |
| 4 | decoy grid | **ISSUE** `game.ts:2918-3036` dead local, never `state.decoy` |
| 5 | dead omit dungeon | **ISSUE** quarantine/rehydrate over-skip gear (`save-blocks.ts:336-342,746`); core omit otherwise OK |
| 6 | player load validation/repair | APPROVE |
| 7 | history artifact by name | APPROVE |
| 8 | connector info + feat remap | APPROVE |
| 9 | chunk remap non-mutating | APPROVE |
| 10 | uniques stay dead e2e | APPROVE |

---

## OVERALL VERDICT: **REJECT / NEEDS FIX**

Eight of ten items re-derive cleanly against C. Two defects block approval:

1. **Hard fail on (4):** decoy restore is a no-op (local variable never reaches `GameState.decoy`). This is exactly the L12-021 symptom the patch claimed to fix.
2. **Fail on (5) side-effect:** dead-save quarantine short-circuit is broader than C's dungeon skip and breaks mod orphan handling for still-serialized gear.

Required before re-review:
- Assign discovered decoy into `state.decoy` (e.g. `decoy` field on the GameState literal, or `state.decoy = decoy` after construction). Prefer a regression test: place decoy trap, save, load, assert `caveFindDecoy` / `state.decoy`.
- Narrow `quarantineSave`/`rehydrateSave` dead handling to "missing dungeon arrays are OK", not "skip all quarantine". Gear/player-side entities must still quarantine.

Non-blocking follow-ups:
- Mark `SavedGame.chunk` (and siblings) optional when `isDead`, drop the `as SavedGame` cast.
- Gen parallel-branch merge plan for `Connector.info`.
- Optional: history fuzzy name lookup parity with `lookup_artifact_name`.

Test expectations for died_from: **approved as C-faithful**, not relaxed.

Format / buffer / RNG / version-bump: clean.

---

End of review. ASCII only.
