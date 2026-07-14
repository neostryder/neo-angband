# P7 - Mod Substrate + Agent API: Build Plan

> BUILD STATUS (2026-07-14): Phases 1, 3, 4, 5, 6 are DONE and pushed; phases
> 2 and 7 remain. RECONCILIATION: the pure-function substrate already lived in
> `packages/mod-sdk` (manifest / resolve / compose from the 2026-07-08 solo
> work), so those phases EXTENDED it rather than creating new `packages/core/
> src/mod/` files as first sketched below. What actually landed:
> - P7.1 (string ids): NEW `packages/core/src/mod/ids.ts` (ContentIdResolver) +
>   the whole save path converted to namespaced string ids; SAVE_VERSION 1->2,
>   v1 saves rejected (no migration - pre-1.0, and P7.2 changes the format
>   again). This one is in core because the save path needs the bound registries.
> - Manifest lifecycle fields (engine, optionalDependencies, loadAfter/Before,
>   saveSchema, capabilities, nondeterministic, ...) added to
>   `packages/mod-sdk/src/manifest.ts`.
> - P7.4 (resolve): `packages/mod-sdk/src/resolve.ts` extended with loadAfter/
>   loadBefore, optionalDependencies, and version-range checks (new dependency-
>   free `semver.ts`).
> - P7.3 (compose): NEW `packages/mod-sdk/src/patch.ts` - field-level ops
>   (set/merge/addFlag/removeFlag/add/mul) + same-field conflict detection.
>   Additive; the coarse deep-merge composePacks is unchanged. Wiring merged
>   field patches into registry bind is the one piece of P7.3 integration left.
> - P7.5 (capabilities): NEW `packages/mod-sdk/src/capabilities.ts`.
> - P7.6 (conflict report): NEW `packages/mod-sdk/src/conflicts.ts`.
> UPDATE (2026-07-14b): P7.2 DONE - NEW `packages/core/src/mod/save-blocks.ts`
> adds the manifest block (pack set + load order + core-owned one-way
> determinism ratchet), per-mod opaque bags (mod:<id>, migrateModBag seam), and
> the orphans store (orphans:<id>@<version>) with pure quarantine/rehydrate over
> the plain-JSON save; loadGame reconciles the mod set (rehydrate then
> quarantine) before deserializing, so a removed mod degrades gracefully instead
> of throwing. Quarantine is whole-entity granularity; finer sub-property
> granularity and the P-UI recoveries (town-return, home stash view) are
> documented follow-ups. No-v1-save-migration confirmed by the maintainer.
>
> P7.7 SPINE DONE (CANDIDATE, not yet frozen): NEW `packages/core/src/agent/`
> (types/perceive/act/controller/index) - the three capability-gated facades
> over the read model, ActionRegistry/PlayerCommand and the LOOP_STATUS.INPUT
> seam. Perceive returns fresh plain data (read-only AND sandbox-serializable,
> resolving the snapshot-vs-proxy fork). A sample agent drives commands
> end-to-end through the public facade (agent.test.ts) = the acceptance-gate
> verify. REMAINING before the maintainer-ratified FREEZE (AGENT_API_VERSION
> 0.1.0 -> 1.0): broaden perceive to the full section-3 surface (store/home
> stock, race/class spell tables, object flag/brand/slay detail, namespaced
> race/kind ids). Also outstanding: the small P7.3 registry-bind wiring
> (consume merged field-patches at bind time).

> STATUS: BUILD PLAN (2026-07-14). This is the executable sequencing of work
> that is already DESIGNED and RATIFIED in `../MODS.md` and `MOD_LIFECYCLE.md`
> (decision 19) and scoped in `../BORG_AS_MOD.md`. It invents no new design; it
> turns the ratified design into an ordered build with concrete seams, the
> existing port code each phase builds on, and the acceptance gate. Any genuinely
> new specific below is tagged [CANDIDATE] and needs the maintainer's nod before
> it becomes load-bearing. P8 (the Borg) rides on P7 and is planned separately in
> `../BORG_AS_MOD.md` sections 7-8.

## Why this order

Two hard constraints set the sequence:

1. **Save format is load-bearing and expensive to retrofit.** String-id
   serialization and namespaced save blocks must land first, because every
   later piece (per-mod bags, quarantine, provenance, profiles) references
   them, and because changing the on-disk shape after saves exist in the wild
   is painful. `MOD_LIFECYCLE.md` section 6 says this explicitly: seams and
   formats first, UI next, marketplace last.
2. **The perceive/act facade must be FROZEN before the Borg.** P8's entire
   value is that a faithful Borg proves the facade is complete
   (`BORG_AS_MOD.md` section 8). So the facade is the last P7 deliverable and
   the gate between P7 and P8 - build it, freeze it, version it, then port the
   Borg against it without privileged access.

## What already exists to build on

The port is unusually ready for this (see `BORG_AS_MOD.md` section 4):

- **Save**: block-structured save/load (`session/save.ts`), a faithful port of
  `savefile.c` framing. P7 EXTENDS it (manifest tier + per-mod bags), it does
  not rewrite it.
- **Registries**: `ObjRegistry`, `bindMonsters`, `FeatureRegistry`,
  `RoomRegistry`, `DungeonProfiles`, the effect/command handler registries -
  already string-key-capable and runtime-registrable in several cases.
- **Read model**: `GameState` (`game/context.ts`) + `KnownMap` (`game/known.ts`)
  + the typed message stream (`msg.ts`) - the perceive surface in nascent form.
- **Act model**: the `ActionRegistry` (`game/player-turn.ts`, built-ins already
  replaceable + new codes addable) and the typed `CommandQueue` (`cmd.ts`).
- **Controller boundary**: `runGameLoop` returns `LOOP_STATUS.INPUT` when
  `nextCommand()` yields null - the exact perceive->think->act seam.
- **Bundled-mod precedent**: `neo-linoleum` (tile packs) already ships as a
  separate pack, proving the pack pipeline.

## Phases

Each phase is independently verifiable (typecheck + tests + a focused test
suite) and lands as its own commit(s). Phases 1-6 are the substrate; phase 7 is
the frozen agent API that gates P8.

### Phase 1 - String-id serialization (foundation)
Serialize every content cross-reference in the save as a namespaced string id
(`core:kobold`), never a numeric index; resolve to a runtime index at load.
- Touches: `session/save.ts` (every `*_idx` write/read for monsters, kinds,
  egos, artifacts, features, traps, curses, ...), the registries (add
  `idToIndex` / `indexToId` both directions, id being pack-namespaced).
- Base game ids are `core:*` (pack zero). Back-compat: existing numeric saves
  either (i) one-shot migrated on load via the current index tables, or
  (ii) declared unsupported pre-1.0. [CANDIDATE] Recommend (i) - a migration
  that reads the old index format once and rewrites as string-id.
- Verify: round-trip every entity type by id; a reordered registry still loads
  an old save correctly; determinism/golden saves unaffected in content.
- RISK: highest-leverage, touches the whole save. Do it first, alone, verified
  hard.

### Phase 2 - Namespaced save blocks + per-mod bags + orphans store
Extend the block save into the three tiers from `MOD_LIFECYCLE.md` section 1:
`manifest` block (pack id/version/hash/source + resolved load order), core
blocks (unchanged shape, string-id refs from phase 1), one `mod:<id>` opaque
bag per mod (versioned by `saveSchema`), and the `orphans:<id>@<version>` store.
- Touches: `session/save.ts` (block writer/reader), a new manifest type.
- Includes the quarantine mechanism (move mod-owned entities to orphans on
  missing/ shadowed mod) and the decision-8 one-time keep/purge prompt seam
  (core computes the orphan set + count; UI shows the prompt in phase 8/P-UI).
- Verify: a save with a mod bag round-trips; removing a mod quarantines its
  entities and reinstalling rehydrates them; a missing required dep refuses to
  load with a plain-language reason.

### Phase 3 - Field-level patch/merge composer
The `patches`/`replaces`/`removes` composition made field-granular
(`MOD_LIFECYCLE.md` section 3): a patch is field ops (`set`, `merge`, `addFlag`,
`removeFlag`, numeric `add`/`mul`) applied in load order; different-field
patches on the same record compose with zero conflict.
- Touches: a new `mod/compose.ts` (pure function: base record + ordered patch
  list -> merged record); the registries consume merged records at bind time.
- Verify: two mods patching different fields of `core:kobold` compose; same-field
  is a detected conflict; op semantics (addFlag/removeFlag/add/mul) exact.

### Phase 4 - Load-order + dependency resolver
Topological sort by `dependencies` + `loadAfter`/`loadBefore` (cycles rejected),
then user preference within remaining freedom (`MOD_LIFECYCLE.md` section 3).
- Touches: a new `mod/resolve.ts` (pure: pack manifests -> ordered list or a
  typed error); `pack.json` lifecycle fields (section 2 of the lifecycle doc).
- Verify: correct order for a dep graph; cycle -> rejected; unmet required dep
  -> typed error naming the fix; last-in-wins order feeds the composer.

### Phase 5 - Capability model
The consent surface for `shape: plugin` mods: a manifest `capabilities` list
(`command:add`, `event:turn-start`, `state:*.read`, `network:<host>`, ...),
enforced by the runtime; content/tile packs request none.
- Touches: a new `mod/capabilities.ts` (grant set + a guard the facades check),
  `pack.json` `capabilities` + `nondeterministic` fields.
- Verify: a facade call without the granted capability throws a clear
  author-facing error; declared `nondeterministic:true` trips the determinism
  ratchet (already specced) exactly once and irreversibly.

### Phase 6 - Conflict-report computation
Pre-launch merged-content diff (`MOD_LIFECYCLE.md` section 3): every record
touched by more than one mod, which fields each touched, who wins; same-field
collisions highlighted with the one-line resolution.
- Touches: a new `mod/conflicts.ts` (pure: manifests + composed records ->
  report); reuses phases 3-4. This is data for the eventual manager UI.
- Verify: report lists additive vs override vs same-field-collision correctly.

### Phase 7 - The frozen agent API (perceive / act / controller) - THE GATE
The three capability-gated facades from `BORG_AS_MOD.md` section 5, built over
the seams above and the existing read/act models. This is what P8 rides.
- **Perceive facade**: a stable, versioned, READ-ONLY view of `GameState`
  covering the `BORG_AS_MOD.md` section-3 read surface + the typed message
  stream + turn counter. Must survive a plugin sandbox boundary (a serializable
  snapshot or a read-only proxy). Capability: `state:*.read`.
- **Act facade**: register actions into `ActionRegistry` and/or push typed
  commands as the section-3 semantic verbs (incl. set-target by monster id or
  grid). Capability: `command:add`.
- **Controller seam**: register a plugin as the `nextCommand` provider, invoked
  at the `LOOP_STATUS.INPUT` boundary each turn. Deterministic controllers draw
  the seeded RNG; `nondeterministic:true` ones trip the ratchet.
- **Sandbox** [CANDIDATE ordering]: scripted plugins run in a Web Worker with
  no ambient DOM/network/storage; the facades are the only bridge. The sandbox
  can land alongside phase 7 or just before P8 - it is required for a
  third-party plugin but the BUNDLED Borg could run in-process first to validate
  the facade shape, then be moved behind the sandbox. Recommend: freeze the
  facade in-process, stand up the sandbox before any UNTRUSTED plugin.
- **FREEZE + VERSION** the facade here. Validate it against the entire
  `BORG_AS_MOD.md` section-3 surface as a checklist before declaring P7 done.
- Verify: a trivial in-repo sample agent mod perceives state, sets a target,
  and drives a command end-to-end through the public facade with no privileged
  core access.

## Tooling (parallel to phases 1-6)
- `pack.json` schema + the lifecycle fields (all phases reference it).
- `neo-pack` CLI (validate + bundle), a sibling of `neo-linoleum`, so authors
  check a pack in CI before publishing. Can grow incrementally as phases land.

## Explicitly NOT in P7 (later, per the ratified docs)
- The in-app mod manager UI (list/enable/reorder/install-from-url/conflict view/
  capability consent/profiles) - `MOD_LIFECYCLE.md` section 6 step 2.
- The marketplace backend + in-app browser, and any Vortex/MO2 bridge - step 3.
- The Borg itself (P8) - rides the frozen phase-7 facade.

## Acceptance gate (P7 -> P8)
P7 is done when: (1) a modded save round-trips through string-ids + per-mod bags
with quarantine/rehydrate working; (2) two sample content mods compose via
field-level patches with a correct conflict report and dependency-resolved load
order; (3) a sample scripted agent mod drives a full turn through the FROZEN
perceive/act/controller facade under capability grants, with no privileged
access. Only then does the Borg port (P8) begin - and a Borg that plays
faithfully is the final proof the facade is complete.

## Suggested execution posture
Phases 1-2 are save-format-critical: build sequentially, verify hard, one at a
time (the same porter + independent-verify discipline used for the parity
slices). Phases 3-6 are mostly pure functions over manifests/records and can be
built in parallel by disjoint agents (distinct new files under `mod/`). Phase 7
is the architecture-critical freeze - do it deliberately, with the section-3
surface as an explicit checklist, and freeze only once a sample agent exercises
it. Given its size, P7 warrants its own focused session(s) rather than a tail
end of a parity run.
