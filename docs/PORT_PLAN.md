# Neo Angband Port Plan

Status: ratified 2026-07-07. This is the governing plan for the port; changes land here first.

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
  Linoleum tile-pack support, AI-seam documentation, sample mods.
- **P8 - Borg**: port of the automatic player, built against the public
  command-queue API (proving the plugin surface).

## Working conventions

- The two seams the original got right survive as the engine's public API:
  the typed command queue (input) and the event bus (output).
- Every ported module records its upstream provenance in `parity/`
  (see `docs/PARITY.md`).
- `reference/` is read-only except for build artifacts; upstream fixes are
  cherry-picked deliberately, never ad hoc.
