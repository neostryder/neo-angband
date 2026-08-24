# The bug-fix mod (`bug-fixes`)

> **NOT BUNDLED.** The game ships no mods at all; this one lives in
> [neo-angband-mod-bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes)
> and installs through the mod manager's *Install a mod...* row, at a pinned tag.
> The tag is what stops the download changing under you; the install records a
> SHA-256 of the bytes that actually arrived, which is what later answers whether
> the copy on the machine has changed. No digest ships inside the game.
>
> STATUS: DESIGN OF RECORD + CHANGELOG. This page is the source of truth and
> public changelog for it. The mod DECLARES its fixes in `manifest.json` under
> `rules` (flag / title / description / default) and carries each fix's BODY as its
> own code: `plugin.ts` (the entry point), `stairs.ts`, `strings.ts`. It also ships
> one `sections` entry, `text-corrections`, whose payload is DATA rather than a
> hook - `object.json` and `artifact.json` - and which is switchable in the same
> menu. Nothing in
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
> **The menu lists three rules, not one per entry below.** Seven entries below are
> marked `IMPLEMENTED`. The six legacy per-bug flags were consolidated into three
> per-CLASS flags on 2026-08-15, which is the standing rule: one toggle
> per class of fix, never one per atomic fix. The mapping is in the mod's own
> `renamedRuleFlags`, so a player's saved choice survived the rename. The
> `text-corrections` section is a fourth switch beside them.
>
> RE-VERIFIED 2026-07-26. The whole catalogue was re-checked against
> `4.2.6..upstream/master` (161
> post-tag commits, inspected locally) and against the port source. **The
> previous "blocked-on / not yet ported" notes were largely wrong** and have been
> corrected per entry. Current state of the four `SPECIFIED` entries:
>
> - **#3 and #11 are READY** - the partial-absorb path and the quiver +
>   inscription recompute are ported; see each entry for the live `file:line`.
> - **#2 is NOT APPLICABLE** by construction (the port never persists store
>   stock, so there is no load-path re-roll). Its cited SHA was also simply
>   wrong - corrected in the entry.
> - **#9 stays open as a save/load INVARIANT to test, not a player toggle** -
>   upstream's own fix commit says loading may still perturb RNG state.
>
> Post-tag sweep: 161 commits classified, 2 already catalogued, 4 newly
> identified (none warranting a toggle without a port-specific repro), 155
> excluded as frontend/platform/build/docs/data/refactor/balance.
>
> RE-SWEPT 2026-08-24. `4.2.6..upstream/master` now holds **174** commits, 12 of
> them landed after the 2026-07-26 sweep. The four the 2026-07-26 line counts as
> "newly identified" were never written down, so the count could not be audited
> and is not recoverable from this page; the twelve since then are classified
> here instead, and any future sweep NAMES what it finds. Nine are borg, macOS
> packaging, cmake or compiler-warning commits and are excluded on the same
> frontend/platform/build grounds as before. The other three are entries 15, 16
> and 17 below.
>
> The same pass re-checked every entry that carried a "blocked-on" note against
> the port as it stands, and **all four of those notes were stale**. The
> subsystems they named are ported:
>
> - **#6 and #7 are `NOT APPLICABLE`** by construction. The port's piles are
>   arrays rather than a pointer-linked list, and its message line is derived
>   from the recall buffer rather than kept beside it, so neither upstream defect
>   can be expressed. Each entry names what would reopen it.
> - **#9 is `INVARIANT`, and is already TESTED** - two tests in
>   `packages/core/src/session/save.test.ts`, not merely a design intention. The
>   2026-07-26 line above calling it "an invariant to test" is satisfied.
> - **#10 already has the hardening it asks for**: `effectDo` validates every
>   link of the chain and degrades safely, with two tests.
> - **#11 is REPRODUCED**, so the repro that entry demanded before any gate now
>   exists, along with the arithmetic condition that makes the obvious repro a
>   dud.
>
> Open and tracked as issues: #3 (#115) and #11 (#116). Each needs a new core
> seam before the mod can carry it; #1 (neostryder/neo-angband#114) now has its
> write and display seams and is implemented under Text and history.

## Why this mod exists

The port tracks upstream Angband by TAGGED RELEASE and keeps core faithful to
the 4.2.6 tag, bugs included (PORT_PLAN.md decisions 2, 23, 24). It does NOT
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
(2026-07-26). Disable the mod again, or switch one
fix off, and that behaviour is faithful 4.2.6 again. It is authored and maintained by neostryder
as its own standalone pack, separate from the neo-linoleum tile mod
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
  carried as a known issue, with an optional mitigation of the mod's own.
- `NOT APPLICABLE` - the upstream bug cannot occur in the port, because of how
  the port is built rather than because anything was patched. Nothing to gate
  and no toggle to offer. Kept on this page anyway: an upstream bug the port
  cannot express is a fact about the port, and a later change that reintroduced
  the mechanism would need to know the guarantee used to hold. Each such entry
  names what would reopen it.
- `INVARIANT` - a property the port promises and TESTS, where upstream carries
  an open bug instead. Not a player toggle: switching it off would remove the
  guarantee rather than restore faithful behaviour. The entry names the tests
  that defend it, so deleting them has a visible cost.

The mod's switches (declared in `neo-angband-mod-bug-fixes/manifest.json`). Each
declares `default: true`, which means one thing only: ON once this mod is
enabled. It does not mean on in a fresh install, and it does not mean the flag
sits in core waiting to be switched - with the mod off the flag is absent
entirely. Enabling the mod gets you the whole patch set; individual switches are
then usable under Mods -> Bug Fixes -> Fixes & tweaks, so you can take the set
minus one.

**Three rule flags, one per CLASS of fix:**

| Flag | Covers |
|---|---|
| `bugfix.textAndHistory` | player-note history (entry 1, upstream #6665), the unique-kill history entry (entry 5, upstream #4245), and the misc. string fixes (entry 14) |
| `bugfix.stateIntegrity` | noise/scent in the save (entry 8, #4605), object-list ordering (entry 4, #4664) and duplicate artifacts (entry 12, #4510) |
| `bugfix.levelGeneration` | unreachable staircases (entry 13, no upstream issue) |

**Plus one section**, `text-corrections`, which is data rather than a hook: four
item descriptions that still describe a two-handed weapon rule Angband 4.2
dropped (the Two-Handed Great Flail, the Pike, the Trident 'of Wrath' and
Mundwine). Text only; no damage, weight or slot changes. (0.19.0 briefly also
folded the post-tag "Ossë" spelling correction into the Trident 'of Wrath'
replacement; retracted in 0.19.1 - that correction cites an accepted upstream
commit and now ships from the `upstream-catchup` mod instead. See entry 14.)

Six per-bug flags preceded the three: `bugfix.uniqueKillHistory`,
`bugfix.miscStrings`, `bugfix.noiseScentSave`, `bugfix.objectListOrder`,
`bugfix.duplicateArtifact` and `bugfix.stairsReachable`. They are retired names
in the manifest's `renamedRuleFlags`, which is what carried each player's saved
choice across the rename rather than silently resetting it. Entry notes below
still name the old flag where it explains which fix is which; the switch a
player sees is the class flag in the table.

---

## Fixes this mod carries

### 1. Player note truncation (`IMPLEMENTED`)

- References: upstream issue and PR **#6665**, merge commit
  `72aec1103ab8153911b503a10da5a1834c1e2b0a` ("Delay expanding
  user-supplied history notes", 2026-07-14). Not in the 4.2.6 baseline.
- Problem: `do_cmd_note` expands `/say` and `/me` before `history_add()` copies
  into its 80-byte event field. A long player name plus a full `/say` note loses
  the note tail and its closing quote in persisted history and character dumps.
- Implementation: under `bugfix.textAndHistory`, the mod's `historyAdd` hook
  replaces the faithful expanded text with the raw note and marks it for the
  mod's `historyDisplay` hook. Core persists that marker with the entry, and
  `screens.ts` uses the display hook through shared history rows for both the
  history screen and `dump_history` output. No hook preserves the exact 4.2.6
  expanded-and-truncated entry.
- Tests: `packages/core/src/mod/hooks.test.ts` covers the conjunctive writable
  write request and chained display hook; the mod's `plugin.test.ts` saves and
  reloads a 15-character player name with a 64-character `/say` payload and
  proves the toggle-on full expansion and toggle-off 79-character truncation.

### 2. Store-charge save-scum exploit (`NOT APPLICABLE`)

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

### 3. Stack-charge scramble on drop/pickup (`READY`)

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
- Port fix approach: apply the equivalent guard so a partial merge is refused
  when the SOURCE stack is already full.
- Port status (2026-07-26, re-verified): **READY**. The previous "DEFERRED /
  `objectAbsorbPartial` exists but is unused" note is WRONG and is retracted.
  The partial path IS live: `packages/core/src/game/gear.ts` tests
  `invenCanStackPartial(...)` and `:852` calls
  `objectAbsorbPartial(obj2, obj1, mode2, mode1, limits, ORIGIN.MIXED)` inside
  `combinePack`'s merge loop. That is the one live caller, and it is exactly the
  precondition the upstream draft guards.
- **WHICH STACK THE GUARD IS ON, corrected 2026-08-24.** This entry used to say
  the gated fix "adds the destination-at-`max_stack` refusal", which is wrong
  twice over. The destination guard is not missing: `inven_can_stack_partial`
  (`obj-gear.c:1227`) already refuses when the leading stack `obj1` is at
  `max_stack`, and the port reproduces it line for line at
  `packages/core/src/game/gear.ts:938`. And it is not what the upstream draft
  proposes: draconisPW's line tests `obj2`, the SOURCE, so the new refusal is
  "the stack being drained is itself already full", which the C does not check
  and the port therefore does not either. Describing it as the destination guard
  would have sent an implementer to write a line that is already there.
- Mechanism, traced 2026-08-24 and deterministic rather than random. With the
  destination holding 5 and the source holding a full 40, `objectAbsorbPartial`
  (`packages/core/src/obj/object.ts:1265-1269`) computes
  `difference = maxStack - largest`, which is zero, so `newsz1` and `newsz2`
  simply SWAP the two counts. `distributeCharges`
  (`packages/core/src/obj/object.ts:1289`) then moves charges by
  `trunc(source.pval * amt / source.number)`, and the truncation loses a
  fraction on every swap. Repeated drop-and-pickup re-runs `combinePack` and so
  re-runs the swap, which is what the reporter sees as charges wandering between
  the two stacks. No RNG is drawn on this path, so a gate here is RNG-free.
- Seam status: core has no `ModHooks` member a mod could refuse this on
  (`packages/core/src/mod/hooks.ts`), so the fix needs a new seam before the mod
  can carry it. Tracked as neostryder/neo-angband#115.

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
  at `packages/core/src/game/obj-list.ts`; flag `bugfix.objectListOrder`.
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
  `packages/core/src/session/game.ts`; flag `bugfix.uniqueKillHistory`. Core
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

### 6. Pile integrity failure crash (`NOT APPLICABLE`)

- References: issue **#4225** ("Pile integrity failure crash", open). No fix
  exists upstream; maintainer notes diagnostics need improving. Likely tied to
  monster drops outside player LOS.
- Port relevance: the port's object model should make this class of
  linked-list corruption structurally impossible (typed stores/handles rather
  than raw pile pointers). Track as a "cannot reproduce by construction" goal
  and add an integrity assertion in the object store.
- Port status (2026-08-24, re-verified): **NOT APPLICABLE** by construction, and
  the old "Blocked-on: full object-pile / drop system (not yet ported)" note is
  retracted. The pile and drop system IS ported -
  `packages/core/src/game/floor.ts` carries `floorPile`, `floorExcise`,
  `floorCarry`, `dropFindGrid` and `dropNear` - and the goal above turns out to
  have been met by the shape of the port rather than by any patch.
  Upstream's defect is a LINKED LIST losing its shape: `obj->next` and
  `obj->prev` walked by `pile_check_integrity`, which is where a cycle, an
  orphan or a dangling pointer can appear. The port has no such list. A grid's
  pile is a plain array (`floor: Map<number, GameObject[]>`,
  `packages/core/src/game/context.ts:205`), carried gear is a handle table
  (`store: Map<number, GameObject>` with index arrays,
  `packages/core/src/game/gear.ts:81`), and `GameObject`
  (`packages/core/src/obj/types.ts`) has no `next` or `prev` field at all. There
  are no pile pointers to corrupt, so there is nothing for an integrity
  assertion to assert and no toggle to offer a player.
- Kept on this page rather than deleted, for the same reason entry 2 is: an
  upstream bug that the port cannot express is a fact about the port worth
  recording, and a future change that reintroduced a pointer-linked pile would
  need to know this guarantee used to hold.

### 7. Missing messages in the main window (`NOT APPLICABLE`)

- References: issue **#3987** ("Missing messages", open, intermittent). A
  message (e.g. "You have found a trap.") is dropped from the main window
  while still present in message recall and the sub-window.
- Port fix approach: when the message-log display is wired, ensure the main
  window and the recall buffer draw from one source so they cannot diverge.
- Port status (2026-08-24, re-verified): **NOT APPLICABLE** by construction, and
  the old "Blocked-on: the message-log display layer" note is retracted. That
  layer is wired, and the fix approach above describes what it already does.
  `state.msg` (`packages/web/src/main.ts:2058`) is the single sink every
  `msg()` and `msgt()` in core and the shell passes through - the same one entry
  14's `messageText` hook hangs off, which is only sound because there is
  exactly one. It appends to one `MessageLog`, and the top status line is then
  DERIVED from that log rather than written beside it (`message =
  msglog.latest()`, in `say`). The scrollable recall (Ctrl-P,
  `messageHistoryScreen(msglog)`) reads the same object.
  So the main window cannot hold a different set of messages from the recall
  buffer: it holds the last element of it. Upstream's defect needs two stores
  that can disagree, and the port has one.
- What would reopen this: any change that gives the status line its own buffer,
  or a second sink that bypasses `state.msg`. The single-sink property is
  load-bearing for entry 14 as well, so it is worth stating rather than assuming.

### 8. Noise and scent not saved (`IMPLEMENTED`)

- References: issue **#4605** ("Noise and scent not saved", open). Low
  severity, genuine determinism gap.
- **"No upstream fix" expired 2026-08-18.** This entry used to say there was
  none. Commit `5c45eb9588b8227d4f1b1998e0a627ad7ee11a75` resolves the NOISE
  half of #4605 upstream, by a different route than this mod takes, and adds
  level-revisit behaviour the mod has no equivalent for. Entry 17 carries the
  detail; what matters here is that this fix is no longer ahead of upstream by
  default and the two designs now have to be compared rather than assumed
  identical. The scent half of #4605 is still unfixed upstream.
- Problem: player noise/scent fields are not persisted, so save/reload can
  change monster tracking behavior versus uninterrupted play.
- Port fix approach: persist the noise/scent fields in the save block.
- Implementation: the mod's `saveNoiseScent` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`, a one-line `true`), serving the
  live-level snapshot's `includeFlow` argument at
  `packages/core/src/session/save.ts`; core does the writing and the reading
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
  first turn) - back-compatible. The `levelCache` is an in-memory `Chunk`, so
  its live heatmaps do in fact freeze with a persistent level and are restored
  unchanged on re-entry; normal `processWorld` does not rebuild them until its
  next ten-turn tick. That is distinct from saving an in-play level, and is now
  handled by entry 17's opt-in upstream-catchup rule rather than by extending
  this save toggle to a second, incompatible policy.
  Tests in `world/chunk.test.ts` (snapshot/restore round-trip) and
  `session/save.test.ts` (full save round-trip: heatmaps absent + lost with no
  hook, present + restored with the hook installed).
- Note: complements the port's local-determinism guarantee (decision 22).

### 9. RNG perturbed by loading, general case (`INVARIANT`)

- References: issue **#6537** (open beyond the store-charge exploit of entry 2).
  Upstream keeps this open as a low-priority robustness item: "loading should
  not have unexpected side effects on the RNG state".
- Port relevance: the port persists full RNG state (decision 22) and must
  guarantee load touches no RNG stream. This is a design invariant for the save
  system rather than a discrete patch, but is tracked here for provenance.
- Port status (2026-08-24, re-verified): **SATISFIED AND PINNED**, and the old
  "Blocked-on: the save system (not yet ported)" note is retracted twice over.
  The save system is ported (`packages/core/src/session/save.ts`, which entry 8
  already patches), and the invariant is not merely designed - it is asserted by
  two tests in `packages/core/src/session/save.test.ts`:
  - "resumes the exact RNG stream (the anti-save-scum posture)" draws 20 values
    after a save point, loads the same save twice, and requires both loads to
    produce that identical sequence. A load that perturbed the stream would move
    the first draw and fail.
  - "preserves the RNG stream across a reordered-registry reload" compares
    `rng.getState()` before the save against the restored game's, on the nose,
    and additionally proves the guarantee does not depend on content ordering.
  Upstream keeps #6537 open because it cannot make this promise. The port can,
  and the tests are what make the claim checkable rather than aspirational.
- This entry stays as a NAMED INVARIANT, not a toggle. There is nothing for a
  player to switch: a mod that made loading perturb the RNG would be removing
  the guarantee, not fixing a bug. Its value is that the two tests above are now
  known to be the thing defending it, so deleting them has a visible cost.

### 10. "Bad effect passed to effect_do()" (`NO UPSTREAM FIX`, hardening present)

- References: issue **#6533** (open, opened 2026-03-07). Triggered by meleeing
  a vampire with an ego weapon; maintainer could not root-cause it and the save
  did not reproduce.
- Port fix approach: the port's effect interpreter should validate effect
  identifiers at dispatch and fail loudly with context in dev, degrade safely
  in release. Add a regression pin if a reproducer is ever found.
- Port status (2026-08-24, re-verified): **the hardening asked for is already
  present**, so this needs no patch and no toggle. `effectDo`
  (`packages/core/src/effects/interpreter.ts:461`) tests
  `isValidEffect(effect)` at the top of EVERY iteration of the chain, not once
  on entry, and an invalid identifier makes it report
  "Bad effect passed to effect_do(). Please report this bug." and return false
  rather than dispatching. That degrades safely by construction: an unhandled
  index cannot reach a handler. Two tests in
  `packages/core/src/effects/interpreter.test.ts` pin it - one on an invalid
  chain, and one on the separate case of a valid upstream code with no
  registered handler, which is skipped rather than treated as invalid.
- Deliberately NOT added: extra context in the message. The text is upstream's
  own, and this mod's standing rule for the `messageText` seam is that a hook
  may only restate a message, never change what one means (entry 14). Naming the
  offending effect index on screen would put text in front of a player that
  upstream never wrote. If a reproducer ever appears, the place for the detail
  is a dev-mode log or a test, not the message line.
- What is genuinely still open is upstream's own root cause, which upstream
  never found and whose save did not reproduce. There is nothing here to port
  until somebody can trigger it.

### 11. Quiver inscription change triggers pack overflow (`READY`, reproduced)

- References: issue **#4666** (open). Related design proposal #6512 (separate
  tval for throwing items) is unimplemented.
- Problem: changing an inscription that moves an item out of the quiver, with a
  full pack, mis-fires `pack_overflow()` and opens a minor no-turn drop
  exploit.
- Port status (2026-07-26, re-verified): **READY**, though it needs a repro
  first. The previous "quiver + inscription commands not yet ported" note is
  WRONG and is retracted - all three pieces are live: the full recompute is
  `calcInventory` (`packages/core/src/game/gear.ts`), the inscribe command
  is `inscribeItem` (`packages/web/src/main.ts`), and the overflow it can
  mis-fire is `packOverflow` (`packages/core/src/game/obj-cmd.ts`).
  Sequence before gating: reproduce the mis-fire against those three, THEN add
  the gate - this one is a suspected mis-fire rather than a proven one, so
  ordering matters.
- **REPRODUCED 2026-08-24.** It is no longer suspected. Driven through a real
  booted game and the real `processPlayer` and `state.overflowPack`, one
  zero-energy `inscribe` command sheds an item onto the floor:
  `energyUsed=0`, `totalEnergy` delta 0, and the messages
  "You re-arrange your quiver." / "Your pack overflows!" / "You drop a Dagger".
  A real `drop` costs `moveEnergy / 2`, 50 energy
  (`packages/core/src/game/obj-cmd.ts:1928`), so the exploit turns a 50-energy
  action into a free one, and `processPlayerCleanup` skips the terrain damage
  and monster tick as well because the energy is zero.
- **The arithmetic condition, which is why a naive repro reads as "cannot
  reproduce".** `packSlotsUsed` (`packages/core/src/game/gear.ts:552-576`)
  charges the quiver `ceil(quiverAmmo / quiverSlotSize)` pack slots, a throwing
  item counting `number * thrownQuiverMult`. Live constants are `packSize` 23,
  `quiverSlotSize` 40, `thrownQuiverMult` 5. Removing a throwing item of
  weighted cost 5 from a quiver of weighted total `Q` changes pack slots by
  `1 - (ceil(Q/40) - ceil((Q-5)/40))`. A lone throwing weapon in an otherwise
  empty quiver frees a whole quiver slot and nets ZERO, so it does not
  reproduce; it fires only when `ceil(Q/40) == ceil((Q-5)/40)`, for instance
  `Q = 50` (40 arrows, 5 bolts, one dagger at mult 5). Written down because the
  obvious repro is a dud.
- **The mis-fire is worse than the exploit, and is the half to fix first.**
  `packOverflow(state, 0, ...)` drops `state.gear.inven[length-1]`
  (`packages/core/src/game/obj-cmd.ts:295-298`), which need not be the item that
  moved. With a Small wooden chest in the pack - last under `earlierObject`
  (`packages/core/src/player/calcs.ts:1441-1507`, decreasing tval) - re-inscribing
  the dagger drops the CHEST and keeps the dagger. For a player that is an item
  vanishing for no stated reason.
- Seam status: no existing `ModHooks` member covers the free-command overflow
  trigger or `packOverflow`'s victim selection, so a seam is needed before a
  patch. Fits the existing `bugfix.stateIntegrity` class.
  Tracked as neostryder/neo-angband#116.

### 12. Duplicate artifacts (`IMPLEMENTED`, no upstream fix)

- References: issue **#4510** (open). Maintainer tightened artifact
  created/uncreated marking in commit `5c799b61a` (2020) but never found the
  cause; still open.
- Port fix approach: the port's artifact-generation path can enforce a single
  source of truth for "this artifact exists", making duplication impossible by
  construction; optional mitigation is a defensive re-check on creation.
- Implementation: the mod's `artifactCommit` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`, a one-line `!alreadyCreated`),
  serving core's commit branch at `packages/core/src/obj/make.ts`
  (`makeArtifact`); `MakeDeps` gains an optional `hooks: ModHooks`
  (`obj/make.ts`), threaded from the LIVE `state.modHooks` at the generation
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
  on faithful core 2026-08-06 over 15,000 levels (3,000 each at depths 1, 20, 40,
  50 and 60): **22 stranded levels, 0.15%**, all of them the UP stair, and all 22
  carrying the mechanism's signature - the sealed stair is `SQUARE_VAULT` and the
  region it is sealed into is vault to the last grid.
- **This entry used to read 53 in 520, 10.2%** (depths 1-98, 40 seeds each), with
  37 of the 53 inside `SQUARE_VAULT`. Both numbers were real and neither described
  upstream: the non-vault majority was the port's own `build_streamer` predicate
  bricking up secret doors, since fixed in `gen/cave.ts`, and the same sweep
  against the old predicate splits 137 stranded into 33 upstream and 104 port
  defect. A wart kept on purpose has to be re-measured after every generator
  change, or core ends up defending its own bugs.
- Root cause, in two halves:
  - `alloc_stairs` (`gen-util.c:629`) places a stair on any `square_isempty`
    grid and does **not** exclude vault interiors, while `ensure_connectedness`
    is called with `allow_vault_disconnect = true` at five of its six sites
    (`gen-cave.c:1263`, `2828`, `3075`, `3685`, `3945`; only `3456` passes
    `false`) - the tunneller is explicitly allowed to leave a vault sealed. So a
    vault it never joined can swallow a staircase, and nothing checks: the only
    post-build validation `cave_generate` runs is `chunk_validate_objects`
    (`generate.c:1238`). Note the asymmetry - `find_start`, the player's own
    spot, *does* exclude vaults; only stairs may land in one.
  - **The stair counts are asymmetric.** `handle_level_stairs`
    (`gen-cave.c:943`) takes the counts as parameters, and `classic_gen` passes
    `rand_range(3, 4)` down stairs against only `rand_range(1, 2)` up
    (`gen-cave.c:1273`). So one bad roll on the lone up stair strands the floor,
    while three or four down stairs almost always leave one reachable.
    `cavern_gen` is slightly kinder, passing `rand_range(1, 3)` down
    (`gen-cave.c:2183`), which does not change the shape of the problem.
  - **A third route, and the rarest: a corridor upstream planned and then
    refused to dig.** `join_region`'s two halves treat vault grids differently
    (`gen-cave.c:1925`, and the port's `joinRegion` line for line). The search
    that finds a crossing may *traverse* a vault grid when
    `allow_vault_disconnect` is set; the walk-back that turns the found path
    into floor refuses to break one. So a crossing whose only route was through
    a vault WALL gets recoloured as joined and left physically holed, and an
    **ordinary** region stays sealed with no vault grid anywhere in it. Observed
    once in 27,000 generated levels (d40 seed 400792, measured 2026-08-09 under
    task #148): one refused dig at (94,38) sealed a 385-grid region holding all
    three of the level's down staircases. This matters to a reader of this
    document because it is the one stranding shape that does **not** look like
    upstream's when you inspect the finished level - which is why
    `notUpstreamStranding` now tests for both routes, and why a stranded region
    without a vault in it is still not automatically a port defect.
- Port relevance: none of this is a port defect - `allocStairs` in
  `packages/core/src/gen/util.ts` is a line-for-line match including the
  `walls = 3 -> 0` ladder and the absence of a vault test. Faithful core
  reproduces the wart, per decision 24 and the 2026-07-26 ruling that core
  must retain all warts of the reference code.
- Implementation: the mod's `levelGenerated` hook
  (`neo-angband-mod-bug-fixes/plugin.ts`), whose body is
  `ensureStairsReachable` in the MOD's own file
  (`neo-angband-mod-bug-fixes/stairs.ts`) - core carries no staircase
  repair. It serves core's accept branch inside `cave_generate`'s existing retry
  loop (`packages/core/src/gen/generate.ts`); `GenDeps` gains an optional
  `hooks: ModHooks` (`gen/generate.ts`), threaded from the LIVE
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
    `gen.test.ts`).
  - `neo-angband-mod-bug-fixes/stairs.test.ts` carries the repair's own tests:
    the invariant across depths, the measured pre-fix failures as named
    regressions, and mechanical unit tests on a synthetic sealed-pocket level
    (repair, spot-choice rule, RNG-state equality on both paths, the
    under-the-player fallback, the refuse-and-re-roll path, the quest guard).
  - `packages/core/src/session/qol-defaults.test.ts` pins the end-to-end wire -
    that the session really hands `GameState.modHooks` to `cave_generate` - with
    a hook whose answer changes the outcome, because an all-neutral stream
    comparison cannot catch that wire coming loose.
- History: briefly lived in core as a guarantee (commit
  `437ad97c3`, 2026-07-25), moved to this mod on 2026-07-26 once upstream was
  confirmed to genuinely behave this way, and moved OUT of core entirely on
  2026-07-29 when the flag-registry design was replaced by `ModHooks` (it had
  still been a core function behind a flag until then). The full write-up is in
  the private working record (see [../WORKING_RECORD.md](../WORKING_RECORD.md));
  everything it concluded that a reader needs is in this entry.

### 14. Misc. string fixes (`IMPLEMENTED`, no upstream fix)

- References: none. Upstream does not treat its own message text as defective,
  so there is no issue, PR or commit to cite under the decision-24 referencing
  rule. Recorded against `reference/src` and against this port's own
  measurement, like entry 13.
- Scope: a single catch-all item covering spelling and extra-space cleanup in
  message text, filed under one item, 'Misc. string fixes'.
- Normalization rule: a convention already in majority use should not be
  'corrected' toward the minority form. Where a sentence break uses double
  spaces in most cases and single spaces in a few, the minority form is what
  gets normalized, not the reverse.
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
    definately, teh, loosing, and sixteen more - the 24 pairs in `MISSPELLINGS`,
    `neo-angband-mod-bug-fixes/strings.ts`):
    none. And the **gamedata descriptions**, which the message census structurally
    cannot see, swept three ways: the same known-misspelling list (0 hits), doubled
    words (1 hit, the room *named* "Dot dot dot"), and every post-4.2.6 upstream
    commit touching `lib/gamedata` (upstream's four description misspellings,
    `obiterate` / `can can` / `untramelled` / `threshhold`, were fixed by commit
    `736e4ad0e` in June 2020 and are already correct in the 4.2.6 baseline).
    The compiled `packages/content/pack/*.json`
    is the same corpus by construction, and the data-exactness gate keeps it so.
  - **The third sweep found ONE, and this entry used to say it found none.**
    Corrected 2026-08-24. The claim was "no spelling fixes at all" among
    post-4.2.6 commits touching `lib/gamedata`; commit `f1b1626f6` ("Correct
    spelling of Ossë", `lib/gamedata/artifact.txt`) is exactly that, and it
    reached upstream on the same day the sweep ran, which is how a correct
    census became a wrong sentence within a day of being written. It shipped
    here briefly as 0.19.0, then retracted in 0.19.1: an accepted upstream
    commit is `upstream-catchup`'s scope, not this mod's, the same rule this
    entry's own census exists to apply consistently. The correction now ships
    from the `upstream-catchup` mod instead. The lesson is the one entry 13
    already records about measurement: a census is true on the day it runs, so
    it has to name the commit range it swept, and be re-run rather than quoted.
- The `!` rows are the judgement call: pooled across terminators they are 3
  minority spellings of one convention, split by terminator they are 3 of 3 and
  the local majority. Pooled here, because the convention is "two spaces after a
  sentence" rather than "after a period". Dropping those three rows from
  `MISC_STRING_CORRECTIONS` is the whole change if that reading is wrong.
- Fix: `miscStringFix` (`neo-angband-mod-bug-fixes/strings.ts`), installed
  on the `messageText` hook (`neo-angband-mod-bug-fixes/plugin.ts`) and
  applied at the host's single message sink (`packages/web/src/main.ts`,
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

### 15. Blast radius larger than `dam_at_dist` can hold - SHIPPED in the upstream-catchup mod

Fixed upstream by commit `f0f6bd223b6b9faf0072b0ae7ffb34a812b97349`
("Projections: coerce blast radius to fit what dam_at_dist can handle",
2026-07-28), not in the 4.2.6 baseline - an accepted upstream commit belongs
in `upstream-catchup`, not here. The port carried the same gap
(`packages/core/src/world/project.ts`, `computeProjection`, no clamp on `rad`)
and it read worse than upstream's: a radius past `maxRange` collects grids the
damage table has no entry for, so the damage handed to every per-grid handler is
`undefined` and the first arithmetic done with it is `NaN`, where the C reads
stale memory instead.

Carried by `upstream-catchup` under `catchup.projections`, on the
`projectionRadius` hook (`MOD_SEAMS.md`), which core reads in `computeProjection`
before any geometry is built. Faithful default: with no mod contributing one the
field is absent and the radius is used exactly as given, which is 4.2.6's own
behaviour. Tracked as neostryder/neo-angband#117 (relabeled
`repo:mod-upstream-catchup`).

### 16. Shape flags learned only when equipment already carries them - MOVED to the upstream-catchup mod

Fixed upstream by commit `c8036c51537942a560e3d7f81749c431bbb4701f` ("On
shape change, learn shape's obvious flags", 2026-07-28), not in the 4.2.6
baseline - belongs in `upstream-catchup`, not here. Whether the port
(`packages/core/src/obj/knowledge.ts:802`) reproduces the defect or its rune
model already sidesteps it has NOT been checked; that verification is the
next step regardless of which mod eventually ships the fix. Tracked as
neostryder/neo-angband#118 (relabeled `repo:mod-upstream-catchup`). Not yet
built.

### 17. Noise not restored on reload, and stale flow on level revisit - IMPLEMENTED in the upstream-catchup mod

Fixed upstream by commit `5c45eb9588b8227d4f1b1998e0a627ad7ee11a75`
("Remember source location for last noise calculation in save file",
2026-08-18), not in the 4.2.6 baseline, and now carried by the
`upstream-catchup` mod's off-by-default `catchup.levelRevisitTracking` rule.
The core `levelRevisited` notification runs for both `levelCache` restoration
and a return from single combat; without it faithful core resumes the exact
cached `Chunk` flow arrays. The rule reproduces upstream's `generate.c` order:
after monster restoration, clear interior noise and age nonzero scent by
`floor(now / 10) - floor(frozenAt / 10)`, clearing a scent value that would
overflow `uint16_t`. Thus an out-of-play level can no longer direct a monster
toward the position the player occupied before leaving, nor retain an
un-aged scent trail; fresh flow is still made by the next ordinary world tick.

This is a real gameplay difference, not a cosmetic cache detail: monster AI
reads the heatmaps before `processWorld`'s next tick, which can be up to nine
turns after entry. It remains deliberately separate from entry 8's
`bugfix.stateIntegrity` / `bugfix.noiseScentSave` rule. That rule preserves
heatmaps across a save/reload; this rule deliberately discards/ages them across
time spent away, matching upstream. Upstream's source-location save/reload
design is also different from entry 8's heatmap persistence, so a future
re-sync must not collapse the toggles.

---

## Front-end-only, likely out of scope for a core TS port

- **#5931** macOS crash in `map_info()` (`EXC_BAD_ACCESS`, open). A core redraw
  path in the C client; the port's renderer is a separate implementation, so
  this specific crash likely does not carry over. Re-evaluate when the web
  renderer's map path is stress-tested.
  - Re-evaluated 2026-08-24, and "likely does not carry over" can be stated
    more firmly than that. `EXC_BAD_ACCESS` is a bad pointer dereference, and
    the port has no pointers to get wrong: `map_info`'s object loop is
    `floorDisplay` (`packages/core/src/game/floor.ts:110`), reading a
    `GameObject[]` off `state.floor`. An index that would be out of bounds
    yields `undefined` rather than a fault. So THIS crash cannot occur, and the
    entry stays only because the surrounding map path is worth watching.
  - What the map path can still get wrong is agreement between its two halves,
    and it has: the live path off `state.floor` and the remembered path off
    `state.known` once disagreed about `multiple_objects`, so a pile in sight
    drew its top item and turned into the pile glyph the moment it dimmed out
    of view. `floorDisplay` exists because both halves now call it. That is a
    divergence bug, not a memory bug, and it is the shape to look for here.
  - The stress test the entry asks for has still NOT been run. The map path has
    unit coverage (`packages/web/src/mapview.test.ts`,
    `world-render-data.test.ts`, `render-background.test.ts`,
    `level-map-region.node.test.ts`), which is not the same thing. Leaving this
    open, with the crash ruled out and the real risk named.

---

## Already fixed in the 4.2.6 baseline (recorded, NOT carried here)

Faithful core already reproduces these because they were fixed before the tag.
Listed so they are not mistaken for open bugs.

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

## The port's own code: what has been moved here

Decision 24 requires any bug the port's own code fixed relative to the tag to be
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
day as a guarantee, based on the mistaken assumption that vanilla could not
strand a floor. Once the reference source showed that it can and does, the
guarantee was withdrawn: core must retain all warts of the
reference code; a bug in the port itself belongs in the bug-fixes mod, not here.

Precedent worth keeping: a "core must never do X" requirement is only safe to
implement in core once `reference/src` has been read and confirmed to agree. If
the reference disagrees, the requirement belongs in a mod, and the finding
belongs in this file.
