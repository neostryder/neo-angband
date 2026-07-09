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

This is the contract for each surface. "Add" means new records,
"patch/replace" means overriding base records, "extend" means introducing
genuinely new behavior or record types.

Read the lower rows correctly (decision 22): rows like NPCs/dialogs, Quests,
and Networking are NOT core modules. Core provides only the generic
extension surface (command queue, event bus, string-keyed registries, the
sandboxed plugin API, save namespaces, render hooks); a MOD builds the
NPC, dialog, quest, or networking SYSTEM on it. The only related things in
core are the upstream parity pieces (the 4.2.6 town and its shops, the
win condition), implemented through these same surfaces so mods can
overhaul them. The matrix asserts what mods CAN do, not what core ships.

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

## Beyond-parity systems are mods, not core (decision 22)

NPCs and dialog, quests, shops-as-systems, and networking are things the
original never had as generalized systems. The port does NOT build them, or
feature-specific seams for them, into core. They are built entirely by mods
on the GENERIC extension surface every mod already uses:

- the serializable command queue (input) and event bus (output) - the
  engine's public I/O API;
- string-keyed registries for the record and behavior types the base game
  itself declares (open to runtime registration);
- the sandboxed plugin runtime with capability grants;
- per-mod save namespaces (arbitrary private state);
- render/UI hooks.

That surface is deliberately powerful enough to build whole subsystems and
full system overhauls - a dialog engine, a quest tracker, a networked
shared world, an economy - without core anticipating any of them. If a mod
needs a hook core does not expose, the fix is to make that generic hook part
of the public API, never to ship the feature.

What core DOES contain is the upstream parity content that happens to
resemble these systems - the town, its shops, and the Sauron/Morgoth win
condition. These are implemented THROUGH the generic moddable surfaces (the
base game is pack zero), so a mod can extend, replace, or overhaul them.
The statistical parity bar (PORT_PLAN.md decision 2) is measured on that
upstream behavior alone.

## Determinism (decision 22)

The engine is deterministic in the same LOCAL sense the original is: it uses
a seeded RNG whose full state is persisted in the save, so a reload resumes
the exact stream (this, not whole-game replay, is what makes reload-reroll
impossible - see the save-scum policy). Unmodded runs are additionally
reproducible from their start seed, which the port exposes as a shareable
seed - a free bonus the original does not advertise.

Determinism is PRESERVED BY DEFAULT and degraded only when forced. A mod may
be nondeterministic (wall clock, its own randomness, a network, an external
AI agent), and any mid-game add/remove/update of mods breaks
reproducibility-from-seed. When that happens core does not just shrug: every
save carries a core-owned DETERMINISM MODE (decision 22). A save starts
DETERMINISTIC; the first time a determinism-affecting mod is enabled on it,
core flips it to NONDETERMINISTIC seamlessly and IRREVERSIBLY - removing the
mod later never restores the deterministic mode, so a save cannot be tainted
and then cleansed. This is core integrity metadata that mods can trigger but
never reverse; it is distinct from the save-scum gameplay policy (which a mod
may relax). Anti-scum itself holds in both modes for core mechanics, which
always draw from the saved seeded stream.

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
