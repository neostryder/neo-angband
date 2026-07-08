# Neo Angband Port Plan

Status: ratified 2026-07-07; amended 2026-07-08 (decisions 13-15: total
moddability guarantee, beyond-parity systems, networking seam). This is the
governing plan for the port; changes land here first.

## What this is

Neo Angband is a modern TypeScript port of [Angband](https://github.com/angband/angband),
holding strongly to its roots: full feature parity with the original, verified
statistically, plus a small set of deliberate enhancements. The focus is
randomization, exploration, and replayability.

The original C tree lives intact and buildable under `reference/` (parity
baseline: the `4.2.6` release tag). It is the golden-master oracle the port is
verified against. Original documentation stays under `reference/docs/`; port
documentation lives here under `docs/`.

## Ratified decisions

1. **Core stack**: a headless TypeScript engine (`@neo-angband/core`) that runs
   in browsers, Node, and wrapped desktop shells. No globals: the game is an
   instantiable context, multi-instance by construction.
2. **Parity bar**: feature parity with 4.2.6, statistically verified via
   distribution diffs against the C stats harness plus scripted golden
   scenarios. Not bit-exact; old savefiles do not import (an importer may come
   later).
3. **V1 target**: web + PWA. The classic multi-terminal-window interface is
   replaced by one modern, responsive, fullscreen-friendly surface. Classic
   keymaps preserved, fully remappable. Desktop (Tauri) and terminal builds
   follow from the same headless core.
4. **Enhancement budget for v1**: UI-level quality-of-life only (message log,
   searchable knowledge, item comparison, recaps). Zero rules changes.
5. **Behavior model**: declarative-first. Effects, abilities, and generation
   parameters are schema-validated data interpreted by the engine; a
   capability-scoped sandboxed scripting layer is the escape hatch for exotic
   behavior. This dissolves the C original's compiled-opcode chokepoints.
6. **Mod ecosystem**: everything loads as packs with namespaced IDs
   (`core:kobold`). The base game itself is pack zero. Tile packs follow the
   Linoleum model: manifest, individual images, exact named targets, honest
   glyph fallback. See `docs/MODS.md`.
7. **AI seam**: the engine defines a content-generator interface with a
   deterministic implementation. No AI provider ships in this repository;
   plugins fill the seam. Deterministic procgen is always first-class and the
   game never depends on AI.
8. **Persistence**: classic regenerate-on-stairs is the default; persistent
   levels are a first-class supported birth option. The save format treats
   both as equal citizens.
9. **Saves**: versioned, schema-validated, compressed JSON. Embeds the active
   pack manifest and per-entity content provenance, and serializes named RNG
   streams. Designed to survive modular and procedurally generated content.
10. **Dev tooling parity**: wizard/debug mode (early, it aids testing),
    spoiler generation, the stats harness (load-bearing for parity), and the
    Borg (phased last).
11. **License**: the upstream dual GPLv2-or-Angband-license statement is
    retained. See `LICENSE.md`.
12. **Upstream tracking**: the parity/provenance ledger (`parity/`) maps every
    port module to its upstream source so future upstream releases can be
    diffed, triaged, and merged with AI assistance.
13. **Total moddability guarantee** (ratified 2026-07-08): moddability is
    first-class over EVERY aspect of the game, not just the record types the
    base data happens to ship. Mods can add, patch, replace, and remove:
    terrain types, room templates, vaults, dungeon profiles, artifacts,
    objects, egos, monsters, classes, races, shops, effects, and any other
    registry the engine holds - and can introduce genuinely NEW capabilities
    that do not exist in the base resources (new effect opcodes, new commands,
    new UI panels, new record types with their own schemas). Concretely: every
    engine registry accepts runtime registration; behavior dispatch goes
    through handler registries keyed by string (never closed enums); the base
    game exercises the same surfaces it offers to mods. The moddable-surface
    matrix in `docs/MODS.md` is the checklist and each engine module is held
    to it in review.
14. **Beyond-parity systems** (ratified 2026-07-08): the engine grows three
    systems the original never had, built mod-first (the base game is just
    their smallest consumer): a world-NPC system (placeable characters with
    interactions and branching dialog, data-driven; upstream shopkeepers
    become its first users), a quest engine (declarative objectives,
    triggers, stages, and rewards; upstream's Sauron/Morgoth win condition is
    its first content), and moddable shops (inventory tables, pricing,
    services, and shopkeeper behavior as data + handlers). These are additive:
    the parity bar (decision 2) is measured with none of them active beyond
    upstream behavior.
15. **Networking seam** (ratified 2026-07-08, scope open): the deterministic
    engine plus serialized command streams is the networking foundation - a
    game is replayable and syncable by construction. The engine ships a
    transport-agnostic session interface so networked features can be built
    as plugins. Which first-party networked features ship (candidates:
    leaderboards, cross-device save sync, spectating/replays, cooperative or
    competitive variants) is an OPEN decision for Aaron; the seam itself is
    ratified. No networking is required to play; local-first always works.

## Phases

Each phase ends in something verifiable. Vertical slices over horizontal
completeness where possible.

- **P0 - Bootstrap** (this phase): fork, `reference/` restructure, monorepo
  scaffold, CI, parity ledger scaffolding, this plan.
- **P1 - Foundation**: RNG (named streams, seeded), dice/expression language,
  flags, the gamedata compiler (`reference/lib/gamedata/*.txt` to core pack),
  pack schemas.
- **P2 - World kernel**: grid/chunk model, FOV, the full level generation
  pipeline (profiles, rooms, vaults, tunnels), stats harness with
  generation-parity distribution checks.
- **P3 - Entities**: objects, monsters, player systems, the effect
  interpreter, combat, character birth. Wizard mode arrives here.
- **P4 - Game loop**: turn/energy engine, command queue, event bus, saves,
  town and stores, quests and the win condition (data-driven objective
  system).
- **P5 - Web UI**: glyph renderer, responsive single-surface layout, keymaps,
  PWA packaging, IndexedDB saves with export/import.
- **P6 - Parity closure**: full statistical verification against the C
  baseline, golden scenario suite, UI QoL features, documentation.
- **P7 - Mod ecosystem hardening**: sandboxed scripting, pack tooling,
  Linoleum tile-pack support, AI-seam documentation, sample mods, the
  moddable-surface matrix audit (decision 13), and the modding SDK
  documentation set (`docs/modding/`).
- **P8 - Borg**: port of the automatic player, built against the public
  command-queue API (proving the plugin surface).
- **P9 - Beyond parity**: the NPC/dialog system, quest engine, moddable
  shops (decision 14), and the networking session seam (decision 15).
  Design docs and registry stubs may land earlier wherever they cheaply
  shape architecture (for example shops in P4 built on the shop registry),
  but parity closure (P6) never depends on P9 features.

## Working conventions

- The two seams the original got right survive as the engine's public API:
  the typed command queue (input) and the event bus (output).
- Every ported module records its upstream provenance in `parity/`
  (see `docs/PARITY.md`).
- `reference/` is read-only except for build artifacts; upstream fixes are
  cherry-picked deliberately, never ad hoc.
