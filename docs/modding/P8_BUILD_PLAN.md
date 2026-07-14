# P8 - The Borg as a Bundled Mod: Build Plan

> STATUS: BUILD PLAN (2026-07-14, DRAFT - awaiting Aaron's ratification of the
> sequencing and cost posture before any large agent spend). This turns the
> ratified scope in `../BORG_AS_MOD.md` (sections 7-8) into an ordered build on
> the now-FROZEN agent API (AGENT_API_VERSION 1.0.0, the P7 -> P8 gate). It
> invents no new design; any genuinely new specific is tagged [CANDIDATE] and
> needs the maintainer's nod before it becomes load-bearing.
>
> WHY THIS EXISTS: P8 is the largest single subsystem remaining (upstream
> `borg/` is 59 files, ~64k LOC). Building it is the acceptance test for P7: a
> faithful Borg that descends, fights, flees, shops, and dies or wins - driven
> ENTIRELY through the public agent API with no privileged core access - proves
> the facade is complete. Every later agent mod (third-party or AI) reuses that
> exact contract.

## Dependency: the Mod Integration Wave 1 (do first)

A 2026-07-14 code audit found the mod substrate is BUILT-BUT-NOT-WIRED: the
frozen agent controller runs only in tests, and the running host never installs
it. P8's Borg rides `installController` in the real host, which is
`MOD_INTEGRATION_PLAN.md` step W1.5. So Wave 1 of the integration plan lands
BEFORE P8. See `MOD_INTEGRATION_PLAN.md`.

## The gate this rides on (already done, but not yet wired - see W1.5)

- PERCEIVE: `createAgentView(state, buffer?, deps?)` returns fresh plain data
  covering the full BORG_AS_MOD section-3 read surface (player, race/class
  tables, items carried/floor/store, dungeon grid, monsters, stores/home,
  globals, message stream, turn counter).
- ACT: `createAgentActions(...)` - semantic command verbs, capability
  `command:add`.
- CONTROLLER: `installController(...)` at the `LOOP_STATUS.INPUT` seam;
  `ControllerOptions.viewDeps` carries the world-context resolver/registries.
- Contract is FROZEN and add-only from 1.0.0.

WIRING NOTE carried from P7.7: the agent-view resolver passed as
`viewDeps.resolver` must be built WITH player races/classes (from
`bindPlayer(pack.player)`) for `PlayerView.playerRaceId`/`playerClassId` to
populate. The save-path resolvers are intentionally separate and unchanged.

## Where the Borg lives [CANDIDATE]

- NEW package `packages/borg` (`@neo-angband/borg`), a BUNDLED mod. It depends
  on `@neo-angband/core` for the agent API TYPES only (AgentView / AgentActions
  / AgentController / installController) and on `@neo-angband/mod-sdk` for the
  manifest/capability shapes. It gets NO privileged core import - if the Borg
  needs a datum the facade does not expose, that is a P7 facade gap to close by
  an add-only 1.x bump, NOT a reach into core.
- Shape: a scripted plugin (capability-scoped) whose manifest declares
  `capabilities: ["state:*.read", "command:add"]` and nothing else. The mod
  host installs it via the controller seam.
- The Borg is configurable-speed (fast default) per the ratified decision; the
  controller decides how many game turns pass per Borg "think".

## Phase map (mirrors BORG_AS_MOD section 7 phased ordering)

Each P8.x is its own verified, pushed slice (typecheck + full vitest + origin
sync), same porter+independent-verify discipline as the engine port, with extra
verification weight on the danger/combat/flow/think cluster where fidelity risk
concentrates.

- **P8.1 - Walking skeleton.** The `packages/borg` package, manifest, controller
  install, and a TRIVIAL decision loop (e.g. descend-and-rest, or step toward
  stairs) that does nothing intelligent but proves the Borg can perceive the
  frozen view, choose a command, and drive the real game loop end-to-end with no
  privileged access. This is the smallest thing that exercises the whole seam;
  it de-risks everything after it. Includes the offline test harness that boots
  a level, installs the Borg, and steps N turns headless.
- **P8.2 - Tier A: io/message + item/inventory/store/spell model.** Port the
  message/prompt channel as a typed subscription and the item/inventory/store/
  spell model that reads near 1:1 off the READ API. Mechanical.
- **P8.3 - Tier B: trait vector + power/prepared scoring + model maintenance.**
  The `BI_*` trait derivation, power and prepared scoring, home valuation, map/
  monster/object model upkeep. Deterministic; fidelity matters because scoring
  drives every choice.
- **P8.4 - Danger math** (`borg-danger.c` + `borg-caution.c` inputs) - everything
  downstream needs it. FIDELITY-CRITICAL.
- **P8.5 - Flow / navigation** - BFS cost-field pathfinding (`borg-flow*.c`).
- **P8.6 - Combat** - attack / defend / projection / target selection
  (`borg-fight-attack.c` at 5,321 lines is the single hardest file).
  FIDELITY-CRITICAL.
- **P8.7 - Caution / escape / recover.**
- **P8.8 - Think ladders** (dungeon + store) + home/shop buy-sell. The think
  ordering is the Borg's personality; port faithfully.
- **P8.9 - Formulas DSL + `borg.txt`** - optional runtime tuning layer over the
  three scoring functions. The hard-coded equivalents are the default, so this
  is last and skippable for a first faithful build.

## Acceptance test (from BORG_AS_MOD section 8)

The bundled procedural Borg plays a faithful game - descends, fights, flees,
shops, and dies or wins - driven entirely through the public agent API, with no
privileged core access. A Borg that plays correctly proves the agent API is
complete.

## Cost posture [CANDIDATE - for Aaron's ratification]

Fable is expensive to Aaron's usage; use it sparingly. Proposed posture:
- P8.1 (skeleton), P8.2 (Tier A), P8.9 (formulas): mechanical/near-1:1 - build
  with Opus directly or a bounded Sonnet implementer against a locked spec.
- P8.3 (Tier B scoring): deterministic but fidelity-sensitive - Opus, with an
  independent verify pass.
- P8.4 / P8.6 / P8.8 (danger, combat, think - the fidelity cluster): the only
  places Fable is worth its cost, and only for the hardest single files. PROMPT
  AARON before launching Fable or any very-long-run agent, per standing rule.

## Recommended first step

Build P8.1 (the walking skeleton + headless harness) with cheap models now. It
is small, proves the frozen facade actually drives a real game, and surfaces any
remaining facade gap immediately - before a single line of the expensive
danger/combat/think work. Everything after P8.1 is sequenced by the phase map
above and gated on Aaron's cost-posture ratification.
