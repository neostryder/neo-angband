# Mod Integration Plan - Wiring the Substrate into the Running Game

> STATUS: BUILD PLAN (2026-07-14). This is the bridge between P7 (the mod
> substrate + agent API, BUILT and tested) and P8 (the Borg). It fills the step
> that `MOD_LIFECYCLE.md` section 6 build-order leaves implicit: between "the
> engine seams exist" (item 1, done) and "the in-app mod manager UI" (item 2),
> the seams must actually be JOINED to the running game. Today they are not.
> It invents no new design - it realizes the architecture already ratified in
> `../MODS.md`, `MOD_LIFECYCLE.md` (decision 19), and the frozen agent API
> (`P7_BUILD_PLAN.md`). Genuinely new specifics are tagged [CANDIDATE].

## Why this exists: the audit finding (2026-07-14)

A three-part code audit established that the mod machinery is BUILT-BUT-NOT-WIRED:

- The running game loads exactly ONE hard-coded pack ("core") and binds it
  directly: `web/src/pack.ts` globs `content/pack/*.json`, and
  `session/game.ts` -> `session/boot.ts:bindCore(pack)` constructs every
  registry from that single pack. `boot.ts` itself notes it is "the natural
  place a mod-aware loader WILL LATER assemble registries from more than one
  pack in load order."
- `composePacks`, `resolveLoadOrder`, `computeConflictReport`, `applyFieldPatch`,
  and `CapabilitySet` have ZERO non-test callers. No package depends on
  `@neo-angband/mod-sdk`. A mod's patch/replace/remove/fieldPatch would have no
  runtime effect.
- The on-disk pack format (`{ id, name, version, engine, files: string[] }` +
  per-file `{ file, source, records: [] }`) is a DIFFERENT shape from the SDK's
  `PackContent = { manifest, files: Record<string, FileContribution> }`.
- `installController` (the agent seam the Borg rides) runs only in tests; the
  web/cli hosts never install it.
- Capability enforcement is one coarse install-time check; the per-facade
  `CapabilitySet.check()` the design calls for is unimplemented. The
  scripted-plugin sandbox runtime (the "escape hatch" for altering SYSTEMS) does
  not exist in code - it is documented and stubbed only.

Consequence: the game is genuinely data-driven (monsters, items, races, classes,
spell data, traps, vaults, room templates, dungeon profiles, terrain, most
attributes all live in external JSON keyed by the same file names the mod model
targets), but NONE of that is mod-addressable at runtime yet, and altering game
systems has no runtime path at all.

## Two waves

Wave 1 makes DATA modding and AGENT modding real - it is the smaller,
mechanical-to-moderate chunk, and it is what P8 (the Borg) actually needs.
Wave 2 makes SYSTEM modding real - the "massive alterations to systems" tier -
and is anchored by the scripted-plugin sandbox, the single largest piece.

---

> PROGRESS (2026-07-14): WAVE 1 COMPLETE (W1.1-W1.6), all pushed, 2382 tests.
> - W1.1 composeContentPacks (mod-sdk): base game + mods through one pipeline.
> - W1.2 base game loads as pack zero through compose (record-identical); verified.
> - W1.3 host discovers bundled mods (packages/web/mods/<id>/, ?mods=<id>); demo
>   demo-modtest provably patches a monster + adds one in the running game.
> - W1.4 capability enforcement on the perceive/act facades (state:<domain>.read
>   / command:add; wildcard-aware; absent caps = trusted host).
> - W1.5 host installs the agent controller (?agent=<id>) - the Borg seam;
>   demo-wanderer drives the real game through the frozen facade (verified: game
>   turn 0 -> 30k+, capability-gated CapabilitySet.fromManifest). Fixed a latent
>   frozen-facade bug (perceive threw on an unbound id; now omits per contract).
> - W1.6 GameState.events bus; state.msg/sound route through it; capability-gated
>   subscribeEvents mod-hook seam (event:<name>); verified msgCount 0 -> 2.
> DATA + AGENT + HOOK modding are now real and proven end-to-end.

> PROGRESS (2026-07-14): W2.1 COMPLETE (scripted-plugin Web Worker sandbox),
> pushed, 2402 tests. UNTRUSTED plugin code now drives the running game across a
> real Worker boundary, capability-scoped, never touching GameState.
> - protocol.ts: host<->worker message envelope + ViewSnapshot (structured-clone
>   safe); reserved codes carry the two set-target verbs across the thread.
> - serialize.ts: perceive-side gate - only capability-granted domains are put in
>   the snapshot (sparse map = seen/remembered cells + floor objects).
> - worker-runtime.ts (runs IN the worker): definePlugin author API, AgentView
>   reconstruction (ungranted domain throws on read), pure act command builder,
>   network globals neutered as an import side effect (restored only for
>   network:*). createRuntimeHandler is transport-injectable for tests.
> - host.ts: the async<->sync bridge - the controller yields null until the
>   worker replies, then surfaces the pending command; set-target commands apply
>   to live target.c and re-request transparently. Reuses the W1.5 tick pump.
> - discover.ts: bundled plugins via Vite ?worker glob (one module worker each).
> - demo-sandbox: a bundled plugin granted ONLY player+monsters read + command:add
>   (deliberately narrow, to prove least privilege). Verified live: resumed a
>   character and the sandboxed plugin drove the game turn 0 -> 1850+, zero
>   errors, player moving, from inside the Worker.
> - Fixed installController: it required the state:*.read wildcard at install,
>   which defeated least privilege for a controller that reads only a subset.
>   Now it requires command:add; reads are gated per domain by the perceive
>   facade at read time (W1.4). Backward compatible; new test added.
> NEXT: W2.2 (expose Effect/Room/Command/Monster registries to sandboxed plugins
> under the capability gate - overriding SYSTEMS, not just data).

> PROGRESS (2026-07-14): W2.2 COMPLETE (registry override via a TRUSTED
> in-process tier), pushed, 2415 tests. A plugin now overrides game SYSTEMS -
> effect handlers, room builders, player-command actions, and monster AI - under
> a capability gate.
> - ARCHITECTURE DECISION (surfaced to and confirmed by the maintainer): deep system
>   override needs a SYNCHRONOUS handler with live rng/chunk/player access, deep
>   in the turn. A Web Worker (W2.1) is async + isolated and cannot supply one
>   (SharedArrayBuffer/Atomics needs cross-origin-isolation headers a static host
>   cannot send, and would freeze the main thread per effect regardless). So deep
>   override is a TRUSTED, in-process capability - as in every real modding
>   system - with explicit per-capability manifest declaration + user consent.
>   The untrusted Worker keeps the reactive perceive/act/event tier (W2.1).
>   Electron was raised as a distribution track (easier install, filesystem mods,
>   native perf); it is orthogonal - the same web app ships to Pages AND Electron
>   and the W2.2 facade is identical on both. Electron wrapper is a later track.
> - core/mod/registry-host.ts: createModRegistryHost({effects,rooms,commands,
>   state}, caps) - four capability-gated facades. New caps registry:effect |
>   registry:room | registry:command | registry:monster (+ registry:* wildcard),
>   added to mod-sdk CapabilitySet. Absent caps = trusted host (all granted),
>   matching the perceive/act/controller convention.
> - The real seams: EffectRegistry.register (effects/interpreter.ts, already
>   override-capable), RoomRegistry.register (gen/room.ts, open by design),
>   ActionRegistry.register (game/player-turn.ts - the LIVE decision-13 player
>   command seam; the cmd.ts CommandQueue is a faithful port the web loop does
>   not drive), and a NEW GameState.monsterTurnHook consulted at the top of
>   monsterTurn (returns true = takes the whole turn before any AI RNG; absent =
>   byte-identical core AI). Session surfaces the EffectRegistry on StartedGame.
> - Host: web ?trusted=<id> loads an in-process plugin (trusted/{runtime,
>   discover}.ts, mods/<id>/trusted.ts), builds the gated host, calls
>   plugin.register. demo-trusted overrides all four under all four caps.
> - PROVEN LIVE: demo-trusted installed (all four facades exercised, lastError
>   null); a brand-new "demo-wave" command (nonexistent in core) executed in the
>   real turn loop and emitted its message. The monster-AI seam is proven by a
>   core unit test WITH A CONTROL (hook true -> monster frozen; hook false ->
>   monster closes on the player) because idle town monsters take no AI turns.
> NEXT: W2.3 (vocabulary extension - new flags/stats/effect-kinds/room-keys from
> packs at runtime), then W2.4 (in-app mod manager UI). Consider the Electron
> distribution track alongside.
>
> PROGRESS (2026-07-14): W2.3 COMPLETE (vocabulary extension), pushed, 2422 tests.
> A pack can now introduce GENUINELY NEW vocabulary at runtime, per family:
> - EFFECT KINDS: EffectRegistry already dispatches string effect codes; W2.3
>   wired session/game.ts's EffectBuilderInjections.lookupEffect to
>   effects.isRegistered so a mod effect NAME resolves in effect/pack text (not
>   just by direct code). Only fires after effect_lookup fails a core name, so
>   core effect text is byte-identical. CONSTRAINT (documented, found via test):
>   effect text is colon-delimited (name:type:radius:other), so a text-nameable
>   mod effect code must be COLON-FREE (like upstream EF_ names); the registry
>   still accepts any string key for direct dispatch.
> - ROOM KEYS: already open strings (RoomRegistry validates lazily at get); a mod
>   builder key dispatches identically. Proven in W2.2 (demo:void).
> - FLAGS + STATS: ARCHITECTURE DECISION (best-judgment, faithfulness-first; to be
>   reviewed with the maintainer). The faithful engine stores flags in fixed-capacity
>   bitsets (bitflag.ts, sized from RF_MAX/OF_MAX at bind) and stats in fixed
>   arity (STAT_MAX=5, with the OBJ_MOD offset + str/int/wis/dex/con names baked
>   across calcs/char-sheet/randart/birth). Growing that arity to admit a mod flag
>   or a 6th stat would fight the byte-identical guarantee AND be capacity-bounded.
>   So mod flags/stats live in a PARALLEL, mod-owned store (core/mod/vocabulary.ts
>   VocabularyRegistry): a mod DECLARES terms (any kind) and stores per-entity
>   VALUES, serialized into its own save bag (engine never interprets it). This is
>   UNBOUNDED and byte-identical to core when unused. The honest trade: unmodified
>   core code paths do not read a mod term - but core cannot know what a brand-new
>   stat MEANS anyway, so the mod supplies both the term AND its behaviour,
>   consuming its values through the W2.2 hooks (AI/effect/command) it controls.
>   The core-arity path (reserved-headroom bitsets so unmodified core reads mod
>   flags) is deliberately NOT built; noted as possible future work if a concrete
>   need appears.
> - core/mod/registry-host.ts: NEW vocab facade + registry:vocab capability
>   (+ registry:* covers it); mod-sdk CapabilitySet vocabulary extended.
> - PROVEN: 6 vocabulary unit tests (declare/value/persist round-trip) + 1 effect-
>   name wiring test with a control; PROVEN LIVE via ?trusted=demo-trusted - the
>   mod declared a brand-new stat (demo:luck) and flag (demo:cursed) and stored
>   player demo:luck=10 (window.__neoTrusted.vocab), installed clean under
>   registry:vocab. Turn-loop consumption (hook reads/writes the terms) is proven
>   by core unit tests since idle town monsters take no AI turns.
>
> PROGRESS (2026-07-15): W2.4 COMPLETE (in-app mod manager), pushed, 2434 tests.
> THE MOD FRAMEWORK IS NOW FEATURE-COMPLETE (W1 + W2.1-2.4); only P8 (the Borg)
> remains before it rides the finished framework.
> - web/src/mod-store.ts: ModStore over a StorageLike - the enabled set (shares
>   pack.ts's neo:enabledMods key+schema), per-mod capability CONSENT, and named
>   PROFILES; pure buildCatalog merges content/sandbox/trusted manifests with
>   enable+consent state; consentSatisfied. web/src/capability-describe.ts:
>   plain-language consent copy per capability, flagging elevated grants
>   (system override / network / broad reads). Both fully unit-tested.
> - web/src/mods.ts: runModManager - a canvas overlay (overlay.ts helpers,
>   launched via openModal) to list mods, enable/disable, reorder load order,
>   consent to plugin capabilities, view P7.6 conflicts (humanLines), and manage
>   profiles. Hung off the Escape game menu ("Mods" row, game-menu.ts).
> - INSTALL-FROM-URL is surfaced HONESTLY: the static web build inlines mods at
>   build time and has no runtime code loader, so the row explains that URL/folder
>   install is a DESKTOP (Electron) capability rather than faking it - documenting
>   the surface difference, not leaving a dead button. (This is a concrete item
>   the Electron ship track must deliver for full cross-surface mod parity.)
> - main.ts: the ?plugin/?trusted URL blocks refactored into installSandbox/
>   installTrusted; boot now ALSO auto-installs every persisted-enabled, CONSENTED
>   plugin (content already composes via pack.ts from the same key). So the
>   manager's choices actually take effect on reload.
> - PROVEN: +12 unit tests (mod-store 8, capability-describe 4). PROVEN LIVE: with
>   NO ?trusted url param, a persisted+consented trusted plugin auto-installs at
>   boot (window.__neoTrusted installed, vocab declared); revoking its consent in
>   the store makes boot skip it. Clean boot, no console errors.
> NEXT: P8 (the Borg) rides the finished framework. In parallel, the EXPANDED ship
> track (the maintainer, 2026-07-14): optional Electron wrapper + how-to docs (Electron /
> PWA install / static hosting) + a parity matrix (play + mods + a11y) across all
> three surfaces; accessibility first-class; Electron must also deliver the
> filesystem/URL mod install the web build cannot.

## Wave 1 - Integrate the substrate (before P8)

Each W1.x is its own verified, pushed slice (typecheck + full vitest + origin
sync). The acceptance proof is behavioral, not just tests: a demo pack that
patches core data must visibly change the running game.

- **W1.1 - Compose seam in core.** A loader step that takes the resolved pack
  set (manifests + per-file raw record arrays), runs `resolveLoadOrder` then
  `composePacks`, and returns composed per-file record arrays that the existing
  `bindCore` assembly consumes unchanged. The base game runs through this path
  as "pack zero." REGRESSION BAR: with only core loaded, the composed output is
  record-identical to today and all 2367 tests still pass. This inserts compose
  BETWEEN raw-file load and structured-pack assembly; registries are untouched.
- **W1.2 - Pack-shape reconciliation.** An adapter between the on-disk pack
  format and the SDK `PackContent`/`FileContribution` model, so a second pack's
  `records`/`patches`/`replaces`/`removes`/`fieldPatches` actually apply through
  W1.1. Reconcile or wrap the flat `files: string[]` manifest into a
  `PackContent`. [CANDIDATE: adapt at load time vs. change the compiler output
  shape - lean adapt, to keep the compiled core pack stable.]
- **W1.3 - Multi-pack load in the host.** The web (and cli) host discovers more
  than one pack, resolves order, composes, and binds. Ship a small demo mod pack
  in-repo that patches a monster and/or item. PROOF: booting with the demo pack
  enabled shows the changed creature/item in the actual game; disabling it
  reverts. This is the deliverable that answers "is it really moddable."
- **W1.4 - Capability enforcement on the real path.** `CapabilitySet.fromManifest`
  is built from each loaded plugin manifest and consulted by the perceive/act
  facades (not only at controller install). `state:*.read` / `command:add` /
  `event:<name>` gate what a mod can see and do.
- **W1.5 - Install the agent controller in the host.** The running web/cli app
  installs a controller via the frozen seam so in-process agent mods attach.
  This is the seam P8's Borg rides; building it here de-risks P8. The agent-view
  resolver is built WITH player races/classes (the P7.7 wiring note).
- **W1.6 - Turn loop through the event bus.** Route the live turn loop through
  the `GameEvents` bus and expose a mod subscription seam gated by
  `event:<name>`. Also lights up first-class typed sound/messages (the standing
  TODO in `web/src/messages.ts`).

### Wave 1 acceptance
A demo content pack changes core data visibly in the shipped game, is enabled/
disabled by load order, and reports conflicts via the existing conflict report;
an in-process agent controller drives the game in the real host within its
declared capabilities.

---

## Wave 2 - Deep system modding (the "massive alterations" tier)

The design already exposes the right internal registries (`EffectRegistry`,
`RoomRegistry`, `CommandQueue`, `MonsterRegistry` all have `.register`); they are
core-only today because no runtime can hand them to a mod. Wave 2 builds that
runtime and opens those registries under the capability gate.

- **W2.1 - Scripted-plugin sandbox runtime.** A capability-scoped Web Worker
  host. The perceive facade already returns plain serializable data (built for
  exactly this boundary); act crosses back as message-passed `AgentCommand`s.
  Nondeterminism labeled per decision 19 (allowed, warned, not barred).
- **W2.2 - Expose registries to sandboxed plugins.** Effect handlers, room/level
  builders, command handlers, and monster hooks become registerable by a
  sandboxed plugin through the capability gate, so a mod can override combat/
  generation/AI/scoring logic - not just data.
- **W2.3 - Vocabulary extension.** Let packs contribute new flags / stats /
  effect-kinds / room-keys at runtime alongside the codegen vocabulary, so
  genuinely NEW systems (not just recombinations of existing ones) are possible.
  This is the deepest item and the true test of "extremely permissive."
- **W2.4 - In-app mod manager UI** (`MOD_LIFECYCLE.md` section 6 item 2): list,
  enable/disable, reorder, install-from-url, conflict view, capability consent,
  profiles. Consumes the now-wired pipeline.

### Wave 2 acceptance
A sandboxed third-party plugin - within only its declared capabilities -
overrides an effect handler, registers a new room builder, and adds a new flag,
and all three take effect in the running game; revoking a capability blocks the
corresponding action.

---

## Sequencing and cost posture [CANDIDATE - ratify before big spend]

1. Wave 1 in order (W1.1 -> W1.6), each pushed. Cheap to moderate; Opus/Sonnet,
   no Fable.
2. P8 (the Borg) rides W1.5 - see `P8_BUILD_PLAN.md`.
3. Wave 2, W2.1 first (the sandbox is the gate for the rest). W2.1/W2.2/W2.3 are
   the substantial builds; PROMPT the maintainer before launching Fable or any very-long-
   run agent there, per the standing rule (Fable is expensive to his usage).

## Relation to existing docs
- `../MODS.md` - the ratified moddability vision this realizes.
- `MOD_LIFECYCLE.md` - saves/install/compose/trust; section 6 build-order (this
  plan is the implicit step between items 1 and 2).
- `P7_BUILD_PLAN.md` - the substrate + frozen agent API Wave 1 wires in.
- `P8_BUILD_PLAN.md` - the Borg, which depends on W1.5.
- `../BORG_AS_MOD.md` - the agent read/write surface, validated by P8.
