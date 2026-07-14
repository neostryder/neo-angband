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

> PROGRESS (2026-07-14): W1.1, W1.2, W1.3 DONE and pushed. The base game now
> loads through composeContentPacks as pack zero, and a bundled demo content
> pack (packages/web/mods/demo-modtest, enable with ?mods=demo-modtest) provably
> changes the running game: verified in-browser that it patches a core monster
> (Grip -> "Grip, the Cyber-Hound", hp 25 -> 250) and adds a new one (Modberry
> Slime), 624 -> 625 monsters, with the base game unchanged when disabled. DATA
> deep-modding (creatures, items, races, classes, spells, traps, vaults, ... -
> all the same compose model) is real. Remaining: W1.4 (capability enforcement),
> W1.5 (install agent controller in host - the Borg seam), W1.6 (event bus turn
> loop). SYSTEM modding (combat/AI/gen logic, new effect kinds) is Wave 2.

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
   the substantial builds; PROMPT AARON before launching Fable or any very-long-
   run agent there, per the standing rule (Fable is expensive to his usage).

## Relation to existing docs
- `../MODS.md` - the ratified moddability vision this realizes.
- `MOD_LIFECYCLE.md` - saves/install/compose/trust; section 6 build-order (this
  plan is the implicit step between items 1 and 2).
- `P7_BUILD_PLAN.md` - the substrate + frozen agent API Wave 1 wires in.
- `P8_BUILD_PLAN.md` - the Borg, which depends on W1.5.
- `../BORG_AS_MOD.md` - the agent read/write surface, validated by P8.
