# The bug-fix mod (`bug-fixes`)

> **NOT BUNDLED.** The game ships no mods at all; this one lives in
> [neo-angband-mod-bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes)
> and installs through the mod manager's *Install a mod...* row, at a pinned tag,
> verified against a digest that ships inside the game.
>
> STATUS: DESIGN OF RECORD + CHANGELOG. This page is the source of truth and
> public changelog for it. The mod DECLARES its fixes in `manifest.json` under
> `rules` (flag / title / description / default) and carries each fix's BODY as its
> own code: `plugin.ts` (the entry point), `stairs.ts`, `strings.ts`. Nothing in
> `packages/core/src` holds a `bugfix.*` string, the staircase repair, the
> duplicate-artifact guard, or the message rewriter - and now nothing in this
> repository holds the fixes either. Do not install the mod and the code does not
> exist on your machine.
>
> Each fix installs one member of `ModHooks`
> (`packages/core/src/mod/hooks.ts`) - a typed interface of OPTIONAL functions on
> `GameState.modHooks`. The host slices each enabled mod's resolved flags per mod,
> calls its entry point once in load order, and folds the results with
> `composeModHooks`; the in-app **Fixes & tweaks** submenu on this mod's own
> screen (mod manager -> Bug Fixes) lists each fix and toggles it, rebuilding the
> composed hooks live.
>
> This replaced an earlier flag-registry design in which each fix lived in core
> behind `if (modRuleEnabled(state, "bugfix.x"))`. That was rejected because a
> flag-gated fix is not excluded from core: core shipped the fix body, was tested
> on it, and carried the mod's flag name as a literal. `modRuleEnabled` is deleted;
> `modRules` survives only as the host's record of the player's choices and is
> opaque to core.
>
> The MOD is off on a fresh install, and while it is off **its fixes do not
> exist** - its entry point is never called, no hook is contributed,
> `GameState.modHooks` stays ABSENT, nothing appears in the menu, and core is
> byte-identical to 4.2.6. Enabling the mod turns the whole patch set on at once;
> each fix is then individually switchable, so a player can take the set minus
> one. See `docs/modding/MOD_SEAMS.md` for the seam contract, the per-hook fold
> rules, and the full default policy.
>
> The menu lists only fixes with a real, functional gate today - the five marked
> `IMPLEMENTED` below.
>
> RE-VERIFIED 2026-07-26 (`parity/mods-2026-07-26/BUGFIX-UPSTREAM-AUDIT.md`).
> The whole catalogue was re-checked against `4.2.6..upstream/master` (161
> post-tag commits, inspected locally) and against the port source. **The
> previous "blocked-on / not yet ported" notes were largely wrong** and have been
> corrected per entry. Current state of the five `SPECIFIED` entries:
>
> - **#1, #3, #11 are READY** - the port systems they need all exist. The old
>   claims that the `/say` note command, the partial-absorb path, and the
>   quiver + inscription recompute were unported are each false; see each entry
>   for the live `file:line`.
> - **#2 is NOT APPLICABLE** by construction (the port never persists store
>   stock, so there is no load-path re-roll). Its cited SHA was also simply
>   wrong - corrected in the entry.
> - **#9 stays open as a save/load INVARIANT to test, not a player toggle** -
>   upstream's own fix commit says loading may still perturb RNG state.
>
> Post-tag sweep: 161 commits classified, 2 already catalogued, 4 newly
> identified (none warranting a toggle without a port-specific repro), 155
> excluded as frontend/platform/build/docs/data/refactor/balance.

## Why this mod exists

The port tracks upstream Angband by TAGGED RELEASE and keeps core faithful to
the 4.2.6 tag, bugs included (PORT_PLAN.md decisions 2, 23, 24). We do NOT
cherry-pick post-tag commits, merged PRs, or issue fixes into core, because
that would make core diverge from the tag and turn every future upstream
re-sync into a rebase over local patches.

Instead, every such fix ships in this single opt-in mod - the model
players know from the Skyrim / Bethesda unofficial patches. It is a
`content`-shape pack (docs/MODS.md) that declares its patch flags in
`manifest.json` and carries their code in its own `plugin.ts`; id `bug-fixes`,
depending on `core`. The mod is **OFF on a fresh install**, like every mod
(`DEFAULT_ENABLED_MODS` is `[]`), so an untouched install is faithful,
buggy-as-shipped 4.2.6 - and while the mod is off, **none of its fixes exist**:
the host only invokes an ENABLED mod's entry point, so no hook is contributed,
there is nothing to switch and nothing listed in the menu.

Enable the mod and you get the whole patch set at once - every fix comes on with
it. Each fix is then an individual toggle in this mod's Fixes & tweaks submenu, so
a player who wants the patch set minus one specific fix can opt that one out
(the project owner's ruling, 2026-07-26). Disable the mod again, or switch one
fix off, and that behaviour is faithful 4.2.6 again. It is authored and maintained by neostryder
(RPGM Tools) as its own standalone pack, separate from the neo-linoleum tile mod
(decision 26).

Balance and subjective changes are NOT bug fixes and do not belong here; they
live in the QoL mod (decision 18) or their own mod. This page tracks only
crash, data-corruption, save/load, determinism, and clear logic-error fixes.

## Referencing rule

Per decision 24, every entry MUST cite, directly and explicitly, the upstream
issue number, PR number, and commit SHA it derives from. The references below
were gathered from `angband/angband` on 2026-07-08 and each pinned SHA MUST be
re-verified against upstream at the time its patch is actually implemented (an
open PR may gain a different merge commit; an unmerged one-liner may change).

Baseline provenance: the port's baseline is the upstream `4.2.6` tag
(`091bd608ced492a4dc53d59cab17e14a001121c6`, pointing at commit
`f3082213b73f3e463e3d0d60bff4b00462beae6e`, tagged 2025-12-16). "In baseline"
below means a fix is an ancestor of that commit and is therefore already
reproduced by faithful core - it is recorded for the record, not carried by
this mod.

## Status legend

- `IMPLEMENTED` - the mod carries this fix: the corrected behaviour is the MOD's
  own code, installed on one `ModHooks` member when the fix's flag is on. The
  Implementation note names the mod file, the hook, the core call site the hook
  serves, and the flag; a vitest control asserts faithful 4.2.6 behaviour with no
  hook installed.
- `SPECIFIED` - fix understood and referenced; patch not yet written because
  the core system it touches is not yet ported (blocked-on noted).
- `READY` - the core system exists; the patch can be implemented now.
- `NO UPSTREAM FIX` - a genuine, still-open upstream bug with no accepted fix;
  carried as a known issue, with our own mitigation optional.

The mod's flags (each `bugfix.*` declared in
`neo-angband-mod-bug-fixes/manifest.json` under `rules`). Each declares
`default: true`, which means one thing only: ON once this mod is enabled. It does
not mean on in a fresh install, and it does not mean the flag sits in core
waiting to be switched - with the mod off the flag is absent entirely. Enabling
the mod gets you the whole patch set; individual patches are then switchable
under Mods -> Bug Fixes -> Fixes & tweaks, so you can take the set minus one:
`bugfix.uniqueKillHistory` (#4245), `bugfix.noiseScentSave` (#4605),
`bugfix.objectListOrder` (#4664), `bugfix.duplicateArtifact` (#4510),
`bugfix.stairsReachable` (no upstream issue - entry 13).

---

## Fixes this mod carries

### 1. Player note truncation (`SPECIFIED`) - the requested first fix

- References: upstream PR **#6665** ("Delay expanding user-supplied history
  notes", open/unmerged as of 2026-07-08); original report PR **#6656** ("Fix
  message truncation", commit `03e559c9c4358c4863368a8d30e17c6588d6967d`,
  closed unmerged in favor of #6665).
- Problem: a `/say` or `/me` note is truncated in the message log, the log
  sub-windows, and the permanent player-history / character dump whenever the
  expanded text (player name prepended, plus formatting) overflows the buffer.
  It silently corrupts persisted history data.
- Root cause: `do_cmd_note()` (`src/cmd-misc.c`) formats the note into a fixed
  `note[90]` buffer BEFORE storing it via `history_add()`, so the raw text
  plus the variable-length player name can overflow the buffer that the live
  message and the saved history entry share.
- Upstream fix approach (#6665): store the user's RAW text verbatim in the
  history entry, and expand ("Frodo says: ...") only at display time via a new
  shared helper `history_expand_user_input(note, p, buf, len, use_prefix)` in
  `src/player-history.c`. `history_display()` and `dump_history()`
  (`src/ui-history.c`) call the same helper with buffers widened to
  `PLAYER_NAME_LEN + 106`.
- Port fix approach: when the notes / player-history subsystem is ported, core
  reproduces the 4.2.6 truncation faithfully; this mod patches the history
  store to keep the raw note and moves expansion to the display layer, mirror-
  ing the helper above.
- Port status (2026-07-26, re-verified): **READY**. The previous "DEFERRED /
  not ported" note is WRONG and is retracted. `do_cmd_note` IS ported - the
  take-notes command is `packages/web/src/main.ts:3413`, and it calls
  `historyAdd(...)` with the fully-prefixed note at `main.ts:3445`, which is
  exactly the live truncation site. Display is
  `packages/web/src/screens.ts:1053`. The gated fix stores the raw text and
  moves expansion to those display paths.
- Upstream status (2026-07-26, re-verified): PR #6665 is **MERGED**, as
  `72aec1103ab8153911b503a10da5a1834c1e2b0a` ("Delay expanding user-supplied
  history notes", 2026-07-14), touching `src/cmd-misc.c`,
  `src/player-history.c`, `src/player-history.h`, `src/ui-history.c`. Verified
  reachable from `upstream/master`. The earlier "open/unmerged, track the PR for
  its eventual merge commit" note is obsolete - there is now an exact oracle
  diff to mirror.

### 2. Store-charge save-scum exploit (`SPECIFIED`)

- References: issue **#6537** ("Save, exit, reload perturbs RNG state"); fix
  PR **#6539** ("Plug exploit for charges in store"), merge commit
  `a7b240980f56a66ece0eb921dcfafcca5754d750` (merged 2026-03-24). NOT in the
  4.2.6 baseline.
  > SHA CORRECTED 2026-07-26. This entry previously cited
  > `4ce58ed04bc18702d445e6aa3f919c5844900f86`, which is a different commit
  > entirely - "SDL2: better error handling in pui-misc.c", authored 3 minutes
  > later the same day. The correct commit is `a7b24098`, whose message names
  > issue #6537 and whose diff touches `src/load.c`, `src/store.c`,
  > `src/store.h`. Both verified locally against `upstream/master`. This is
  > exactly the failure the re-verification rule below exists to catch.
- Problem: re-entering a store after save/reload re-triggered the store's
  charge-recharge RNG roll on wands/staves, letting a player save-scum charges
  up toward the maximum in object.txt.
- Root cause: `rd_stores_aux()` (`src/load.c`) calls `store_carry()` during
  load, and `store_carry()` rolls the RNG to recharge stackable-charge items.
- Upstream fix: `store_carry()` gains a `bool maintain` parameter; the
  recharge-on-carry logic is gated by it. Normal gameplay call sites
  (`store_create_random`, `store_create_item`, `do_cmd_sell`) pass
  `maintain = true`; the save loader passes `false`, so loading no longer
  re-rolls charges.
- Port relevance: directly reinforces the port's no-save-scum policy
  (decision 16). This mod applies the loader-side `maintain = false` behavior.
- Blocked-on: the town/store system AND the save system (neither yet ported).
- Port status (2026-07-16): DEFERRED - structurally prevented, no gate needed.
  The port's `storeCarry` (`store/store.ts`) already takes the `maintain`
  parameter from the fix and gates the charge re-roll on it. More to the point,
  the port does NOT persist store stock: it is regenerated per town visit
  (`session/game.ts` `refreshTownStores`) and a reload resumes the exact RNG
  state (decision 22), so re-entering a store after save/reload reproduces the
  identical stock and charges. There is no `rd_stores_aux` -> `store_carry`
  load path to re-roll, so the save-scum this fix targets cannot occur. If a
  persisted-stock loader is ever added, it must call `storeCarry(... false)`.

### 3. Stack-charge scramble on drop/pickup (`SPECIFIED`)

- References: residual edge case documented in the thread of issue **#6355**
  ("Can generate infinite charges on staves/wands", closed COMPLETED via PR
  **#6356**, merge commit `e0af0e158060a06aa8552bf76a8885be914d3e39`, IN the
  4.2.6 baseline). The residual case is NOT covered by #6356 and has no PR.
- Problem: repeatedly dropping and picking up a stack of 40+ charged
  wands/staves next to a smaller stack of the same kind randomly redistributes
  charges between the two stacks.
- Proposed fix (contributor draconisPW, 2025-10-08, never PR'd): in
  `inven_can_stack_partial()`, add
  `else if (obj2->number == obj2->kind->base->max_stack) return false;`.
- Port fix approach: when object-pile stacking is ported, apply the equivalent
  guard so a full destination stack refuses a partial merge.
- Port status (2026-07-26, re-verified): **READY**. The previous "DEFERRED /
  `objectAbsorbPartial` exists but is unused" note is WRONG and is retracted.
  The partial path IS live: `packages/core/src/game/gear.ts:851` tests
  `invenCanStackPartial(...)` and `:852` calls
  `objectAbsorbPartial(obj2, obj1, mode2, mode1, limits, ORIGIN.MIXED)` inside
  `combinePack`'s merge loop. That is the one live caller, and it is exactly the
  precondition the upstream draft guards. The gated fix adds the
  destination-at-`max_stack` refusal before `gear.ts:852`.

### 4. Object list ordering is not a strict total order (`IMPLEMENTED`)

- References: issue **#4664** ("Object list is not always correctly ordered",
  open). Candidate fix PR **#4668** was CLOSED WITHOUT MERGING (no effect on
  the repro), so there is no accepted upstream fix.
- Problem/root cause: `compare_items()` (`src/obj-util.c`) can return 1 for
  both `(a,b)` and `(b,a)` when both items are unknown, violating the strict
  weak ordering `qsort()` requires; the list order becomes unstable/wrong.
- Port fix approach: give the port's comparator a genuine strict weak ordering
  (stable tiebreak on a total key) so the list is deterministic - and re-derive
  the true root cause, since #4668 showed the two-unknowns case alone did not
  explain every report.
- Implementation: the mod's `objectListTiebreak` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`), serving core's comparator tiebreak
  at `packages/core/src/game/obj-list.ts:242`; flag `bugfix.objectListOrder`.
  Port status: the port's comparator is already a lexicographic strict weak order
  and feeds a guaranteed-STABLE `Array.sort`, and it already returns 0 for the
  two-unknowns case - so the port does not exhibit the qsort instability #4664
  reports. The hook adds a deterministic geometric total-key tiebreak (dy then
  dx) after the distance tiebreak, making the order a strict TOTAL order that
  stays correct even under a non-stable sort. No hook => the faithful
  distance-only tiebreak (`?? 0`, i.e. leave the entries equal). Tests in
  `game/obj-list.test.ts` (core's seam: equal-distance distinct entries stay
  order-equivalent with no hook; an installed hook breaks the tie) and
  `neo-angband-mod-bug-fixes/plugin.test.ts` (the mod's comparator and its flag
  gate).

### 5. Unique monster "returns" in the kill history (`IMPLEMENTED`, partial upstream)

- References: issue **#4245** ("Unique coming back to life?", open). The
  misleading death MESSAGE was fixed by PR **#6245** (merge commit
  `11f6811333eafe99717b9be0a12014a70d93a42b`, IN the 4.2.6 baseline), but the
  PR author states it does NOT fix the multiple-history-entries defect.
- Problem: a unique can produce multiple "you killed X" history entries via
  shape-change / projection death paths. Suspected: `monster_can_kill()`
  checks only current race (not `original_race`) and `monster_change_shape()`
  overwrites `original_race` without a null-check.
- Port fix approach: when monster shape-change + death bookkeeping is ported,
  guard `original_race` and dedupe unique-death history entries.
- Implementation: the mod's `historyAdd` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`, a one-line `!entry.duplicate`),
  serving core's `onPlayerKill` `HIST.SLAY_UNIQUE` write at
  `packages/core/src/session/game.ts:872`; flag `bugfix.uniqueKillHistory`. Core
  computes and passes `duplicate` and holds no opinion about it. The port's
  `monsterChangeShape` (`game/mon-shape.ts`) already carries the `original_race`
  null-check upstream's `monster_change_shape` lacks. This fix closes the
  remaining defect: a lethal blow on a unique whose `race.maxNum` is already 0
  (an already-dead unique re-reached via a shape-change / projection death path)
  no longer logs a duplicate "Killed X" entry. No hook => `?? true` => faithful
  4.2.6 logs one per lethal blow. Tests in `session/game.test.ts` (core's seam:
  two kills log two entries with no hook; an installed hook suppresses the
  second) and `neo-angband-mod-bug-fixes/plugin.test.ts` (the mod's predicate
  and its flag gate).
  Scope note: this is the ONLY `historyAdd` call site that consults the hook -
  core's other `historyAdd` writes are not routed through it, which matches the
  fix's scope but is worth knowing before reusing the hook.

### 6. Pile integrity failure crash (`NO UPSTREAM FIX`)

- References: issue **#4225** ("Pile integrity failure crash", open). No fix
  exists upstream; maintainer notes diagnostics need improving. Likely tied to
  monster drops outside player LOS.
- Port relevance: the port's object model should make this class of
  linked-list corruption structurally impossible (typed stores/handles rather
  than raw pile pointers). Track as a "cannot reproduce by construction" goal
  and add an integrity assertion in the object store.
- Blocked-on: full object-pile / drop system (not yet ported).

### 7. Missing messages in the main window (`NO UPSTREAM FIX`)

- References: issue **#3987** ("Missing messages", open, intermittent). A
  message (e.g. "You have found a trap.") is dropped from the main window
  while still present in message recall and the sub-window.
- Port fix approach: when the message-log display is wired, ensure the main
  window and the recall buffer draw from one source so they cannot diverge.
- Blocked-on: the message-log display layer (currently on-screen ledgered).

### 8. Noise and scent not saved (`IMPLEMENTED`)

- References: issue **#4605** ("Noise and scent not saved", open). Low
  severity, genuine determinism gap; no upstream fix.
- Problem: player noise/scent fields are not persisted, so save/reload can
  change monster tracking behavior versus uninterrupted play.
- Port fix approach: persist the noise/scent fields in the save block.
- Implementation: the mod's `saveNoiseScent` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`, a one-line `true`), serving the
  live-level snapshot's `includeFlow` argument at
  `packages/core/src/session/save.ts:1203`; core does the writing and the reading
  either way, in `packages/core/src/world/chunk.ts`
  (`snapshotSquares(includeFlow)` / `restoreSquares`, with optional `noise` /
  `scent` on `ChunkSquaresData`). Flag `bugfix.noiseScentSave`. Fold kind: this is
  an ANY hook - one mod asking for the data is enough, because the payload is
  additive and a second mod has nothing to object to.
  The port models noise/scent as `Chunk` heatmaps
  (`world/flow.ts`) that faithful core does NOT save (matching 4.2.6). With the
  flag on they ride the save and restore exactly, so a reload preserves the
  scent trail instead of starting it empty. The payload is self-describing:
  a faithful save omits both, so restore leaves them zeroed (rebuilt on the
  first turn) - back-compatible. The frozen `levelCache` snapshot stays faithful
  (out-of-play levels carry no live trail; they rebuild flow on re-entry).
  Tests in `world/chunk.test.ts` (snapshot/restore round-trip) and
  `session/save.test.ts` (full save round-trip: heatmaps absent + lost with no
  hook, present + restored with the hook installed).
- Note: complements the port's local-determinism guarantee (decision 22).

### 9. RNG perturbed by loading, general case (`SPECIFIED`)

- References: issue **#6537** (open beyond the store-charge exploit of entry 2).
  Upstream keeps this open as a low-priority robustness item: "loading should
  not have unexpected side effects on the RNG state".
- Port relevance: the port persists full RNG state (decision 22) and must
  guarantee load touches no RNG stream. This is a design invariant for the save
  system rather than a discrete patch, but is tracked here for provenance.
- Blocked-on: the save system (not yet ported).

### 10. "Bad effect passed to effect_do()" (`NO UPSTREAM FIX`)

- References: issue **#6533** (open, opened 2026-03-07). Triggered by meleeing
  a vampire with an ego weapon; maintainer could not root-cause it and the save
  did not reproduce.
- Port fix approach: the port's effect interpreter should validate effect
  identifiers at dispatch and fail loudly with context in dev, degrade safely
  in release. Add a regression pin if a reproducer is ever found.
- Blocked-on: none structurally (the effect interpreter exists); but with no
  reproducer this is a hardening entry, not a targeted patch.

### 11. Quiver inscription change triggers pack overflow (`SPECIFIED`)

- References: issue **#4666** (open). Related design proposal #6512 (separate
  tval for throwing items) is unimplemented.
- Problem: changing an inscription that moves an item out of the quiver, with a
  full pack, mis-fires `pack_overflow()` and opens a minor no-turn drop
  exploit.
- Port status (2026-07-26, re-verified): **READY**, though it needs a repro
  first. The previous "quiver + inscription commands not yet ported" note is
  WRONG and is retracted - all three pieces are live: the full recompute is
  `calcInventory` (`packages/core/src/game/gear.ts:655`), the inscribe command
  is `inscribeItem` (`packages/web/src/main.ts:1997`), and the overflow it can
  mis-fire is `packOverflow` (`packages/core/src/game/obj-cmd.ts:264`).
  Sequence before gating: reproduce the mis-fire against those three, THEN add
  the gate - this one is a suspected mis-fire rather than a proven one, so
  ordering matters.

### 12. Duplicate artifacts (`IMPLEMENTED`, no upstream fix)

- References: issue **#4510** (open). Maintainer tightened artifact
  created/uncreated marking in commit `5c799b61a` (2020) but never found the
  cause; still open.
- Port fix approach: the port's artifact-generation path can enforce a single
  source of truth for "this artifact exists", making duplication impossible by
  construction; optional mitigation is a defensive re-check on creation.
- Implementation: the mod's `artifactCommit` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`, a one-line `!alreadyCreated`),
  serving core's commit branch at `packages/core/src/obj/make.ts:987`
  (`makeArtifact`); `MakeDeps` gains an optional `hooks: ModHooks`
  (`obj/make.ts:1119`), threaded from the LIVE `state.modHooks` at the generation
  deps in `session/game.ts`, because the pure object layer has no `GameState` in
  scope. Flag `bugfix.duplicateArtifact`. Fold kind: a VETO hook - conjunctive,
  first refusal decides. The hook is contractually RNG-FREE (it runs on the main
  object stream) and this one is a pure read of the created flag core passes in;
  core refuses BEFORE `copyArtifactData` draws, so the veto changes the outcome
  without half-drawing.
  Port status: duplication is already impossible by construction for
  freshly-selected artifacts - the shared `ArtifactState` (`aup_info[]`, threaded
  through every `MakeDeps`) is the single source of truth and `make_artifact`
  already skips any `isCreated` candidate. The fix adds the defensive re-check
  the design calls for on the one remaining window: an object handed to
  `make_artifact` that ALREADY carries an artifact whose created-flag is set
  (the C `!obj->artifact` loop guard skips the scan, so control reaches the
  commit block) is refused rather than re-committed and re-marked a second time.
  No hook => faithful 4.2.6 re-commits it. Store generation deps
  (`allowArtifacts=false`) do not thread the hooks - artifact creation is inert
  there. Tests in `obj/make.test.ts` (core's seam: an already-created carried
  artifact is re-committed with no hook; a refusing hook clears it and reports
  failure) and `neo-angband-mod-bug-fixes/plugin.test.ts` (the mod's predicate
  and its flag gate).

### 13. Unreachable staircases (`IMPLEMENTED`, no upstream fix)

- References: none. There is no upstream issue, PR, or commit for this - it is a
  longstanding property of vanilla generation rather than a reported defect, so
  the decision-24 referencing rule has nothing to cite. Recorded instead against
  the reference source itself (all citations below are `reference/src`, the
  4.2.6 tag) and against the port's own measurement.
- Problem: a floor can have no staircase the player is able to walk to. Measured
  on faithful core over 520 levels (depths 1-98, 40 seeds each): **53 stranded
  levels, 10.2%**. 44 of the 53 were the UP stair; 37 had the orphaned stair
  sealed inside `SQUARE_VAULT`.
- Root cause, in two halves:
  - `alloc_stairs` (`gen-util.c:629`) places a stair on any `square_isempty`
    grid and does **not** exclude vault interiors, while `ensure_connectedness`
    is called with `allow_vault_disconnect = true` at five of its six sites
    (`gen-cave.c:1271`, `2836`, `3083`, `3693`, `3953`; only `3464` passes
    `false`) - the tunneller is explicitly allowed to leave a vault sealed. So a
    vault it never joined can swallow a staircase, and nothing checks: the only
    post-build validation `cave_generate` runs is `chunk_validate_objects`
    (`generate.c:1244`). Note the asymmetry - `find_start`, the player's own
    spot, *does* exclude vaults; only stairs may land in one.
  - `handle_level_stairs` (`gen-cave.c:958`) allocates `rand_range(3, 4)` down
    stairs but only `rand_range(1, 2)` up, so one bad roll on the lone up stair
    strands the floor, while three or four down stairs almost always leave one
    reachable. A separate minority of cases is the player's own region being cut
    off entirely, which `classic_gen` permits because it never calls
    `ensure_connectedness` at all.
- Port relevance: none of this is a port defect - `allocStairs` in
  `packages/core/src/gen/util.ts` is a line-for-line match including the
  `walls = 3 -> 0` ladder and the absence of a vault test. Faithful core
  reproduces the wart, per decision 24 and the owner's 2026-07-26 ruling
  ("Core must retain all warts of the reference code").
- Implementation: the mod's `levelGenerated` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`), whose body is
  `ensureStairsReachable` in the MOD's own file
  (`neo-angband-mod-bug-fixes/stairs.ts`) - core carries no staircase
  repair. It serves core's accept branch inside `cave_generate`'s existing retry
  loop (`packages/core/src/gen/generate.ts:473`); `GenDeps` gains an optional
  `hooks: ModHooks` (`gen/generate.ts:80`), threaded from the LIVE
  `state.modHooks` at the generation deps in `session/game.ts` (the same seam
  entry 12 uses). Flag `bugfix.stairsReachable`. Fold kind: a VETO hook -
  conjunctive, and note that every contributor still runs after an earlier one has
  REPAIRED the level, because a second mod's invariant is not satisfied by the
  first mod's repair; only a refusal short-circuits. Returning false re-rolls the
  level, the same treatment as a monster-maximum overflow. The hook is
  contractually RNG-FREE, which is what makes it safe to run on every level. For
  each
  direction the level actually HAS a stair in, it floods the region the player
  can walk (passable + doors, which open, + rubble, which digs; 8-directional,
  walls excluded so the guarantee is not vacuous) and, if no stair of that
  direction is reachable, places one in that region - choosing the grid the way
  `alloc_stairs` does (best wall-adjacency tier 3 -> 0, then closest to the
  stranded stair), so it surfaces beside the vault that swallowed the original.
  It goes through core's PUBLIC `placeStairs` (as do `squareIsEmpty`,
  `squareIsNoStairs`, `squareNumWallsAdjacent`, `FEAT` and `loc` - the same
  primitives a third-party level mod would reach for), so that helper's own
  overrides still apply and the fix **cannot** mint a down stair on Morgoth's
  floor. "Each direction it
  actually has one" is also what exempts the town and the quest floors with no
  depth special-casing. Fallback when the walkable region can host nothing else:
  the player's own grid, which upstream itself uses under `birth_connect_stairs`
  (`gen-util.c:427-433`); if even that is unavailable the level is rejected and
  re-rolled like a monster-max overflow (measured re-rolls after the fallback:
  zero).
- Determinism: the repair draws NO RNG (asserted by RNG-state equality across
  the call), so turning the flag on leaves 184 of 200 measured levels
  bit-identical and changes the other 16 by one grid. It is still a generation
  change, so a character played with the flag on is not layout-identical to one
  played without it - the manifest description says so.
- Tests, split the way the code is:
  - `packages/core/src/gen/gen.test.ts` keeps the CONTROL that faithful core
    (no hook) really does strand the measured seeds, so moving the repair back
    into core fails the suite and says why (the failure message names the mod -
    `gen.test.ts:489`).
  - `neo-angband-mod-bug-fixes/stairs.test.ts` carries the repair's own tests:
    the invariant across depths, the measured pre-fix failures as named
    regressions, and mechanical unit tests on a synthetic sealed-pocket level
    (repair, spot-choice rule, RNG-state equality on both paths, the
    under-the-player fallback, the refuse-and-re-roll path, the quest guard).
  - `packages/core/src/session/qol-defaults.test.ts` pins the end-to-end wire -
    that the session really hands `GameState.modHooks` to `cave_generate` - with
    a hook whose answer changes the outcome, because an all-neutral stream
    comparison cannot catch that wire coming loose.
- History: briefly lived in core as an owner-ratified guarantee (commit
  `437ad97c3`, 2026-07-25), moved to this mod on 2026-07-26 once the owner
  learned upstream genuinely behaves this way, and moved OUT of core entirely on
  2026-07-29 when the flag-registry design was replaced by `ModHooks` (it had
  still been a core function behind a flag until then). Full write-up:
  `parity/phase3-2026-07-25/findings/STAIRCASE-INVARIANT.md`.

### 14. Misc. string fixes (`IMPLEMENTED`, no upstream fix)

- References: none. Upstream does not treat its own message text as defective,
  so there is no issue, PR or commit to cite under the decision-24 referencing
  rule. Recorded against `reference/src` and against this port's own
  measurement, like entry 13.
- Requested by the owner as a single catch-all item ("Let's flag the string
  cleanup (spelling, extra spaces, etc.) for another bug-fixes mod fix. They can
  all be under one item 'Misc. string fixes'").
- Scope set by the owner: *"If all sentences use double spaces, those should not
  be 'corrected'. I am only interested in normalizing. If some use double and
  some single, whichever method is less frequently used should be corrected."*
- Problem, as MEASURED rather than assumed - this matters, because a catch-all
  title invites a pile of unexamined edits. Over the **577** distinct literals
  `reference/src` hands to `msg` / `msgt` / `get_check` / `get_string` /
  `get_quantity`:

  | sentence break | one space | two spaces |
  | -------------- | --------- | ---------- |
  | after `.`      | 2         | 15         |
  | after `!`      | 3         | 0          |
  | after `?`      | 0         | 0          |

  So upstream is not inconsistent about *wanting* the old two-space convention;
  it uses it 15 times out of 17 and slips twice. The minority form is what gets
  normalized, and the direction is UP to the double space. An earlier pass here
  claimed "38 literals" and collapsed them all to a single space - both the
  count and the direction were wrong.
  - **ZERO** misspellings, in two corpora. The message literals above, swept for
    the usual suspects (recieve, seperate, occured, acheive, neccessary,
    definately, teh, loosing, and ~40 more - `MISSPELLINGS` in mods/bug-fixes/strings.ts):
    none. And the **gamedata descriptions**, which the message census structurally
    cannot see, swept three ways: the same known-misspelling list (0 hits), doubled
    words (1 hit, the room *named* "Dot dot dot"), and every post-4.2.6 upstream
    commit touching `lib/gamedata` (no spelling fixes at all - upstream's four
    description misspellings, `obiterate` / `can can` / `untramelled` /
    `threshhold`, were fixed by commit `736e4ad0e` in June 2020 and are already
    correct in the 4.2.6 baseline). The compiled `packages/content/pack/*.json`
    is the same corpus by construction, and the data-exactness gate keeps it so.
- The `!` rows are the judgement call: pooled across terminators they are 3
  minority spellings of one convention, split by terminator they are 3 of 3 and
  the local majority. Pooled here, because the convention is "two spaces after a
  sentence" rather than "after a period". Dropping those three rows from
  `MISC_STRING_CORRECTIONS` is the whole change if that reading is wrong.
- Fix: `miscStringFix` (`neo-angband-mod-bug-fixes/strings.ts`), installed
  on the `messageText` hook (`neo-angband-mod-bug-fixes/plugin.ts`) and
  applied at the host's single message sink (`packages/web/src/main.ts:1244`,
  `state.msg`) so one hook covers every message core or the shell emits. Fold
  kind: a TRANSFORM hook - several mods' rewriters chain in load order, each
  seeing the previous one's output. A hook here may only RESTATE a message;
  changing what one MEANS would put text on screen upstream never wrote, and no
  census could see it, because the slot is filled. It is an exact-match table of
  four rows, NOT a rewrite rule: messages reach the sink already interpolated, so
  a general `". "` -> `".  "` would rewrite object inscriptions and character
  names the player typed. A fifth upstream instance ("Non-existent glyph
  requested. Please report this bug.") has no row because the port has no code
  path that emits it.
- Faithful default: with the mod off (or this fix off) the hook is absent and the
  sink is `?? raw`; with it on it is the identity for any string not in the table,
  so faithful core's text still reaches the screen byte-for-byte.
- Not gameplay: no message changes meaning; nothing about play changes.

---

## Front-end-only, likely out of scope for a core TS port

- **#5931** macOS crash in `map_info()` (`EXC_BAD_ACCESS`, open). A core redraw
  path in the C client; the port's renderer is a separate implementation, so
  this specific crash likely does not carry over. Re-evaluate when the web
  renderer's map path is stress-tested.

---

## Already fixed in the 4.2.6 baseline (recorded, NOT carried here)

Faithful core already reproduces these because they were fixed before the tag.
Listed so we do not mistake them for open bugs.

| Issue | Fix PR | Merge commit | Note |
|---|---|---|---|
| #5063 crash while monster commanded | #5353 | `12619f52dcba87329d51d7b82ab566d6222b984c` | clears `mon->target.midx` on command expiry |
| #6157 SIGABRT on mimic reveal | #5979 | `acefd754421a94623b8172e20551408107c49dfe` | adjusts `mimicking_m_idx` in `chunk_copy()` |
| #6355 infinite charges (main case) | #6356 | `e0af0e158060a06aa8552bf76a8885be914d3e39` | partial-merge charge transfer (residual edge case is entry 3) |
| #6022 SIGSEGV on death (crash) | #6023 | `45e4b574e63e7c358a17c77cfd5b1a2ef820533f` | only the crash; the score-lock-file root cause is packaging, irrelevant to the port |

---

## Explicitly NOT bug fixes (do not add here)

These are balance/subjective and belong in the QoL mod or their own mod, not
this one:

- **#5340** Throwing shots vs. sling damage (balance opinion).
- **#6210** Curse level for intentionally bad randarts (design judgment; a
  change would also break randart-from-seed determinism).
- **#5984** Randart supercharge frequency rescaling (probability tuning).
- **#4451** Systematic recognition of temporary resists (consistency
  enhancement, not a defect).

---

## Our own port code: what has been moved here

Decision 24 requires any bug our port code fixed relative to the tag to be
moved OUT of core and INTO this mod.

Audit result (2026-07-08): the only non-faithful shortcut in core was the
"everything known" rune convention, and it has been REVERTED to faithful (runes
unknown by default) in commit `7970af462`, not relocated - because a shortcut
that granted unearned bonuses is not a "fix" players would want as an option.
The two remaining ledgered divergences (no global RNG singleton; Linoleum
generated-by header text) are unavoidable port artifacts under decision 23(a),
not bug fixes.

**Migrated 2026-07-26: entry 13, unreachable staircases.** This is the one and
only thing that has ever had to make the trip. It was added to core the previous
day as an owner-ratified guarantee, on the owner's understanding that vanilla
could not strand a floor. Once the reference source showed that it can and does
(10.2% of levels), the ruling was reversed:

> We can't fix bugs in the port. Those will belong in the bug fixes mod. I only
> said those couldn't exist because I thought that was how the C version worked.
> Core must retain all warts of the reference code.

Precedent worth keeping: a "core must never do X" requirement is only safe to
implement in core once `reference/src` has been read and confirmed to agree. If
the reference disagrees, the requirement belongs in a mod, and the finding
belongs in this file.
