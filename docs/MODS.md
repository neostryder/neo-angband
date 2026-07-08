# The Mod System

Neo Angband is moddable by construction: the base game is itself a pack
loaded through the same pipeline as any third-party mod. Moddability is a
ratified pillar (PORT_PLAN.md decisions 13-21): every aspect of the game is
open to mods, including capabilities that do not exist in the base resources.

## What is core, and what is a mod

The dividing line (PORT_PLAN.md decisions 17-18) is deliberately sharp:

- **Core** is exactly two things: faithful Angband 4.2.6 parity, and the
  mod architecture itself (the registries, composition engine, sandbox,
  save namespacing, and SDK described below). Nothing else.
- **Everything new is a mod.** Any feature, behavior, or visual beyond
  parity - including the beyond-parity systems below and all UI-level
  quality-of-life - ships as a mod, never baked into the port. Core ships
  the extensibility SEAMS (part of the mod architecture); mods ship the
  features that ride them.
- **Two mods are bundled** with the port, enabled by default and fully
  removable: **neo-linoleum** (the tile packs; see `docs/LINOLEUM.md`) and
  a **QoL mod** (curated fixes and UI quality-of-life). They are ordinary
  mods that happen to ship in the box - proof the seams are real, and the
  reference examples mod authors (and AI agents) learn from.
- **Cheaty mods are allowed.** A mod may add, patch, replace, or remove
  anything - up to the rules that make the game Angband, or a roguelike at
  all. The engine warns and labels (for example, marking a save's profile
  non-reproducible); it never forbids. What players can do to their own
  game is their choice.

## The moddable-surface matrix

This is the contract each engine module is held to. "Add" means new records,
"patch/replace" means overriding base records, "extend" means introducing
genuinely new behavior or record types.

| Surface | Add | Patch/replace | Extend |
|---|---|---|---|
| Terrain types | yes | yes | new terrain flags + handlers |
| Room templates and vaults | yes | yes | new room builders (scripted) |
| Dungeon generation profiles | yes | yes | new level generators |
| Objects, egos, artifacts | yes | yes | new object properties |
| Monsters and monster bases | yes | yes | new blow methods/effects, new AI hooks |
| Player races, classes, abilities | yes | yes | new ability mechanics |
| Effects | yes | yes | NEW effect opcodes registered at runtime |
| Commands and keymaps | yes | yes | new commands with energy/repeat rules |
| Shops | yes | yes | new services, pricing models, stock rules |
| NPCs and dialogs | yes | yes | new interaction verbs, dialog conditions |
| Quests | yes | yes | new trigger/objective/reward types |
| Messages, colors, UI panels | yes | yes | new panel types (scripted) |
| Tiles and glyphs | yes | yes | Linoleum packs, new render layers |
| Sounds | yes | yes | new sound events |
| Game constants (z_info) | n/a | yes | new constants namespaced per pack |
| Networking sessions | n/a | n/a | plugin transports and modes |

How the engine keeps this true:

- Every registry accepts runtime registration and is keyed by namespaced
  string IDs, never closed enums. Upstream's compiled dispatch tables
  (effects, commands) are ported as open handler registries.
- New record TYPES are supported: a pack may declare its own schemas, and
  scripted plugins may register loaders for them. The engine treats the base
  game's record types as pack-zero declarations, not engine specials.
- The base game must consume every surface through the same public API mods
  use. If core needs a private hook, the hook becomes public API instead.

## Pack shapes

1. **Content packs** - declarative, schema-validated JSON: monsters, items,
   races, classes, effects, vaults, generation profiles, objectives.
   Safe by construction: a pack that validates cannot corrupt the engine.
   This is also the intended lane for AI-generated content - generated
   output is data to validate, not code to trust.
2. **Tile packs** - the Linoleum model, first-class: a manifest, individual
   image files (not tilesheets), exact named targets
   (`target:monster:core:farmer-maggot:asset:farmer_maggot_0`), optional
   family metadata and multi-resolution trees. Honest fallback: uncovered
   targets render as glyphs, never as silently substituted art.
3. **Scripted plugins** - the escape hatch for behavior that declaration
   cannot express. Scripts run sandboxed with explicit capability grants
   (which APIs a plugin may touch); they interact with the engine only
   through the documented command/event/registry surfaces.

## Identity and composition

- Namespaced IDs everywhere: `core:kobold`, `mypack:frost-wyrm`. No
  collisions between packs by construction.
- Packs declare explicit dependencies and versions; load order is resolved
  deterministically.
- Packs may add records, and may patch or replace records from packs they
  declare as dependencies. The base game (`core`) is replaceable: total
  conversions are a supported shape, not a hack.
- Savefiles embed the active pack manifest and per-entity provenance, so a
  save knows exactly which content produced it and can fail gracefully when
  a pack is missing or changed.

## Beyond-parity systems (seams in core, features in mods)

Three systems the original never had. Per decision 18, core ships only the
extensibility SEAMS for them - registries, handler dispatch, and event
hooks that are part of the mod architecture - while the generalized
FEATURES beyond upstream parity ship as mods (bundled or third-party) on
those seams. The upstream behavior that IS parity - shops, the town, and
the Sauron/Morgoth win condition - stays in core as parity content. Each
system below is described by the seam core provides and the mod-space
feature it enables:

1. **World NPCs**: placeable characters with interaction menus and branching
   dialog, all declarative (dialog nodes, conditions on game state, effects
   on selection). Upstream's shopkeepers become the first NPCs; mods can
   populate the town, the dungeon, or a total conversion with speaking
   characters.
2. **Quest engine**: declarative quests - triggers (kill, reach, collect,
   talk, timer), stages, objectives, rewards, and failure states - with
   scripted escape hatches for exotic logic. Upstream's Sauron/Morgoth win
   condition is expressed as the first quest content.
3. **Moddable shops**: stock tables, pricing, buy/sell rules, and services
   as data + handlers, bound to NPC shopkeepers.

Parity note: the statistical parity bar is measured against upstream with
these systems exercising only upstream behavior. They are additive.

## Networking

The engine is deterministic (seeded named RNG streams) and fully driven by a
serializable command queue, so a game IS its seed plus its command stream.
That makes replay, spectating, synchronization, and server-side verification
possible without bespoke netcode in the core. The engine exposes a
transport-agnostic session interface; networked features - leaderboards,
save sync, spectating, shared-world variants - are built as plugins against
it. The core ships no network calls; local-first play always works offline.
Which first-party networked features ship is an open decision tracked in
PORT_PLAN.md decision 15.

## The modding SDK

The SDK is the documented, versioned surface mod authors - human and AI -
build against. Accessibility to AI coding agents is a first-class goal
(decision 20): an agent should be able to author a valid, working mod from
the documentation alone.

- `docs/modding/` - the documentation set (P7 deliverable): getting started,
  pack anatomy, schema reference generated from the engine's own validators,
  the handler registry catalog, dialog/quest/shop cookbooks, tile-pack guide
  (see `docs/LINOLEUM.md`), sandbox capability reference, and publishing
  guidance.
- Typed APIs: `@neo-angband/core` exports the same typed interfaces the base
  game is built from; plugin authors get full TypeScript types.
- Validation-first tooling: `neo-pack` (planned) scaffolds, validates, and
  bundles packs; validation errors point at the offending line of the
  author's JSON.
- Sample mods maintained in-repo as living documentation and CI-tested
  against every engine change, so the SDK cannot silently rot. The two
  bundled mods (neo-linoleum, QoL) are the largest such examples.
- AI-agent accessibility (decision 20): machine-readable JSON Schemas for
  every record type, a generated registry/handler reference, a single-file
  agent context document (an `llms.txt`-style digest of the whole SDK),
  copy-pasteable worked examples per surface, and validation errors phrased
  as actionable fixes. The declarative-first design (content is data, not
  code) is what makes AI-authored content safe: generated output is
  validated data, never trusted code.

## The AI seam

The engine defines a content-generator interface (names, lore, item flavor,
level theming, and future surfaces) with the deterministic procedural
implementation as the always-available default. This repository ships no AI
provider and no network calls. Plugins may implement the interface against
any backend. The base game must remain fully playable - and fully itself -
with the seam unfilled.

## Trust model

- Content packs: validated data, lowest risk, freely shareable.
- Tile packs: validated manifests plus images, same posture.
- Scripted plugins: sandboxed and capability-scoped, but still code - the
  UI surfaces what a plugin can touch before enabling it.

## Licensing note for mod authors

The engine is dual-licensed (GPLv2 or the Angband license; see LICENSE.md).
Declarative content packs and tile packs are independent works - license
them as you wish. Distributed scripted plugins are safest treated as GPLv2
derivatives. Nothing in the license restricts services a plugin talks to;
network-side services remain entirely the service owner's.
