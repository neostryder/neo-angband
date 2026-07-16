# Bundled bug-fix mod (`bug-fixes`)

> STATUS: DESIGN OF RECORD + CHANGELOG. This page is the source of truth and
> public changelog for the bundled bug-fix mod. The mod package now exists
> (`packages/web/mods/bug-fixes/`, a TRUSTED `plugin`-shape pack) and carries
> the fixes marked IMPLEMENTED below. Each fix lives in ported core as its
> faithful 4.2.6 branch plus an off-by-default corrected branch guarded by a
> named `GameState.modRules` flag (core, `game/context.ts` `modRuleEnabled`);
> the plugin turns those flags on at register() through the capability-gated
> `ModRegistryHost.rules` facade (capability `registry:rules`). With the mod
> disabled no flag is set and core is byte-identical to 4.2.6.

## Why this mod exists

The port tracks upstream Angband by TAGGED RELEASE and keeps core faithful to
the 4.2.6 tag, bugs included (PORT_PLAN.md decisions 2, 23, 24). We do NOT
cherry-pick post-tag commits, merged PRs, or issue fixes into core, because
that would make core diverge from the tag and turn every future upstream
re-sync into a rebase over local patches.

Instead, every such fix ships in this single BUNDLED, opt-in mod - the model
players know from the Skyrim / Bethesda unofficial patches. It is a
`plugin`-shape pack (docs/MODS.md), id `bug-fixes`, depending on `core`. It is
enabled by default and fully removable; removing it returns the game to
faithful, buggy-as-shipped 4.2.6 behavior. It is authored and maintained by
neostryder (RPGM Tools) as its own standalone pack, separate from the
neo-linoleum tile mod (decision 26).

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

- `IMPLEMENTED` - the mod carries this fix: a gated corrected branch is in core
  and the plugin enables its flag. The Implementation note names the core file
  and the flag; a vitest control asserts faithful 4.2.6 behavior with the flag
  off.
- `SPECIFIED` - fix understood and referenced; patch not yet written because
  the core system it touches is not yet ported (blocked-on noted).
- `READY` - the core system exists; the patch can be implemented now.
- `NO UPSTREAM FIX` - a genuine, still-open upstream bug with no accepted fix;
  carried as a known issue, with our own mitigation optional.

The mod's flags (each `bugfix.*` set by `packages/web/mods/bug-fixes/trusted.ts`):
`bugfix.uniqueKillHistory` (#4245), `bugfix.noiseScentSave` (#4605),
`bugfix.objectListOrder` (#4664), `bugfix.duplicateArtifact` (#4510).

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
- Blocked-on: the notes command + player-history subsystem (not yet ported).
- Port status (2026-07-16): DEFERRED. The player-history STORE is ported
  (`player/history.ts`, event text faithfully truncated to 79 chars =
  `event[80]`), but `do_cmd_note` (the `/say` `/me` note command, cmd-misc.c)
  and the `ui-history.c` display-expansion layer are shell concerns and are NOT
  ported, so there is no live truncation site to gate yet. When the note command
  lands, the fix (store raw text, expand at display) belongs there.
- Note: #6665 is a maintainer-authored alternate that is still unreviewed and
  unmerged, so this entry tracks the PR for its eventual merge commit rather
  than freezing on today's diff.

### 2. Store-charge save-scum exploit (`SPECIFIED`)

- References: issue **#6537** ("Save, exit, reload perturbs RNG state"); fix
  PR **#6539** ("Plug exploit for charges in store"), merge commit
  `4ce58ed04bc18702d445e6aa3f919c5844900f86` (merged 2026-03-24). NOT in the
  4.2.6 baseline (`behind_by: 78`).
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
- Blocked-on: inventory/object-pile stacking (partially present via gear; the
  full pile-merge path is not yet ported).
- Port status (2026-07-16): DEFERRED. The partial-merge path this fix guards
  (`inven_can_stack_partial` / `object_absorb_partial`) is not wired into live
  play: `objectAbsorbPartial` (`obj/object.ts`) exists but is unused, and every
  live merge site (floor / gear / store / monster) uses full-stack
  `objectMergeable`, which already refuses a merge whose combined total exceeds
  `max_stack` (leaving two stacks). So the charge scramble cannot occur, and
  there is no ported `can_stack_partial` precondition to add the guard to. When
  the partial path is wired, add the destination-at-`max_stack` guard there.

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
- Implementation: `packages/core/src/game/obj-list.ts`
  (`objectListStandardCompare`), flag `bugfix.objectListOrder`. Port status: the
  port's comparator is already a lexicographic strict weak order and feeds a
  guaranteed-STABLE `Array.sort`, and it already returns 0 for the two-unknowns
  case - so the port does not exhibit the qsort instability #4664 reports. The
  flag adds a deterministic geometric total-key tiebreak (dy then dx) after the
  distance tiebreak, making the order a strict TOTAL order that stays correct
  even under a non-stable sort. Off => the faithful distance-only tiebreak.
  Tests in `game/obj-list.test.ts` (control: equal-distance distinct entries are
  order-equivalent with the flag off; corrected: the total key breaks the tie
  antisymmetrically).

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
- Implementation: `packages/core/src/session/game.ts` (`onPlayerKill`, the
  ported `player_kill_monster` / `HIST_SLAY_UNIQUE` slice), flag
  `bugfix.uniqueKillHistory`. The port's `monsterChangeShape`
  (`game/mon-shape.ts`) already carries the `original_race` null-check upstream's
  `monster_change_shape` lacks. This flag closes the remaining defect: a lethal
  blow on a unique whose `race.maxNum` is already 0 (an already-dead unique
  re-reached via a shape-change / projection death path) no longer logs a
  duplicate "Killed X" entry. Off => faithful 4.2.6 logs one per lethal blow.
  Tests in `session/game.test.ts` (control: two kills log two entries with the
  flag off; corrected: the second, already-dead kill logs nothing).

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
- Implementation: `packages/core/src/world/chunk.ts`
  (`snapshotSquares(includeFlow)` / `restoreSquares`, with optional `noise` /
  `scent` on `ChunkSquaresData`) plus `packages/core/src/session/save.ts` (the
  live-level snapshot passes `modRuleEnabled(state, "bugfix.noiseScentSave")`),
  flag `bugfix.noiseScentSave`. The port models noise/scent as `Chunk` heatmaps
  (`world/flow.ts`) that faithful core does NOT save (matching 4.2.6). With the
  flag on they ride the save and restore exactly, so a reload preserves the
  scent trail instead of starting it empty. The payload is self-describing:
  a faithful save omits both, so restore leaves them zeroed (rebuilt on the
  first turn) - back-compatible. The frozen `levelCache` snapshot stays faithful
  (out-of-play levels carry no live trail; they rebuild flow on re-entry).
  Tests in `world/chunk.test.ts` (snapshot/restore round-trip) and
  `session/save.test.ts` (full save round-trip: heatmaps absent + lost with the
  flag off, present + restored with it on).
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
- Blocked-on: inventory/quiver + inscription commands (not yet ported).
- Port status (2026-07-16): DEFERRED. The quiver model and the
  inscription-driven `calc_inventory` / `pack_overflow` recomputation this bug
  lives in are not ported (the quiver path in `game/gear.ts` is explicitly a
  documented deferral), so there is no live mis-fire site to gate. Revisit when
  the quiver + inscription commands land.

### 12. Duplicate artifacts (`IMPLEMENTED`, no upstream fix)

- References: issue **#4510** (open). Maintainer tightened artifact
  created/uncreated marking in commit `5c799b61a` (2020) but never found the
  cause; still open.
- Port fix approach: the port's artifact-generation path can enforce a single
  source of truth for "this artifact exists", making duplication impossible by
  construction; optional mitigation is a defensive re-check on creation.
- Implementation: `packages/core/src/obj/make.ts` (`makeArtifact`; `MakeDeps`
  gains an optional live `modRules`, threaded from `state.modRules` at the
  live generation deps in `session/game.ts`), flag `bugfix.duplicateArtifact`.
  Port status: duplication is already impossible by construction for
  freshly-selected artifacts - the shared `ArtifactState` (`aup_info[]`, threaded
  through every `MakeDeps`) is the single source of truth and `make_artifact`
  already skips any `isCreated` candidate. The flag adds the defensive re-check
  the design calls for on the one remaining window: an object handed to
  `make_artifact` that ALREADY carries an artifact whose created-flag is set
  (the C `!obj->artifact` loop guard skips the scan, so control reaches the
  commit block) is refused rather than re-committed and re-marked a second time.
  Off => faithful 4.2.6 re-commits it. Store generation deps
  (`allowArtifacts=false`) do not thread the flag - artifact creation is inert
  there. Tests in `obj/make.test.ts` (control: an already-created carried
  artifact is re-committed with the flag off; corrected: it is refused and
  cleared with the flag on).

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

## Our own port code: nothing to move here

Decision 24 requires any bug our port code fixed relative to the tag to be
moved OUT of core and INTO this mod. Audit result (2026-07-08): the only
non-faithful shortcut in core was the "everything known" rune convention, and
it has been REVERTED to faithful (runes unknown by default) in commit
`7970af462`, not relocated - because a shortcut that granted unearned bonuses
is not a "fix" players would want as an option. The two remaining ledgered
divergences (no global RNG singleton; Linoleum generated-by header text) are
unavoidable port artifacts under decision 23(a), not bug fixes. So there is
currently nothing to migrate into this mod.
