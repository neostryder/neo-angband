# The Mod System

Neo Angband is moddable by construction: the base game is itself a pack
loaded through the same pipeline as any third-party mod.

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
