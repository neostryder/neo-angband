# Modding Neo Angband

Moddability is a ratified pillar of this project (PORT_PLAN.md decisions
13-15): every aspect of the game is open to mods, including capabilities
that do not exist in the base resources. The base game is itself a pack
("core", pack zero) loaded through the same pipeline your mod uses - if
core can do it, your mod can do it, redefine it, or delete it.

This directory is the modding SDK documentation set. It grows with the
engine; each page documents surfaces that exist and are tested. For the
overall design and the moddable-surface matrix, read `docs/MODS.md`.

## Contents

- This page: pack anatomy, manifests, and record composition (live today,
  backed by `@neo-angband/mod-sdk`).
- `MOD_LIFECYCLE.md`: how saves stay safe across install/update/
  uninstall, installing from git (and a future marketplace), multi-mod
  composition and conflict resolution, and the UX principles. CANDIDATE
  design pending ratification.
- `docs/LINOLEUM.md`: tile packs and converting the classic tilesets.
- Coming as the engine lands them (P7 deliverables): handler registry
  catalog (effects, commands, room builders), the sandbox capability
  reference for scripted plugins, dialog/quest/shop cookbooks, the
  `neo-pack` validator/bundler, and publishing guidance.

## Pack anatomy

A pack is a directory (or archive) with a manifest and content files:

```
my-frost-pack/
  pack.json          <- the manifest
  monster.json       <- contributions to the "monster" record file
  object.json        <- contributions to the "object" record file
  ...
```

### The manifest (`pack.json`)

```json
{
  "id": "frost",
  "name": "The Frost Depths",
  "version": "1.2.0",
  "shape": "content",
  "dependencies": { "core": "*" },
  "author": "You",
  "license": "CC-BY-4.0"
}
```

- `id`: lowercase kebab-case, unique among loaded packs. It becomes your
  namespace: a monster you add named "Frost Wyrm" is `frost:frost-wyrm`
  everywhere - in other packs, in tile-pack targets, in savefiles.
- `shape`: `content` (declarative JSON), `tiles` (Linoleum tile pack),
  or `plugin` (sandboxed script).
- `dependencies`: packs that must load before yours. Declaring a
  dependency is also a permission: you may only patch, replace, or
  remove records owned by packs you declare here.
- Load order is resolved deterministically (dependencies first,
  alphabetical ties), so the same pack set composes identically on
  every machine. Cycles and missing dependencies fail loudly at load.

### Record composition

Each content file may add, patch, replace, and remove records:

```json
{
  "records": [
    { "name": "Frost Wyrm", "hp": 400, "flags": ["COLD", "DRAGON"] }
  ],
  "patches": {
    "core:kobold": { "hp": 12, "desc": "A tougher little kobold." }
  },
  "replaces": {
    "core:grip-farmer-maggot-s-dog": { "name": "Grip", "hp": 50 }
  },
  "removes": ["core:fang-farmer-maggot-s-dog"]
}
```

- `records` adds new entries; your pack owns them.
- `patches` deep-merges onto an existing record: objects merge key by
  key, arrays and scalars are replaced whole, and an explicit `null`
  deletes a key.
- `replaces` swaps the record body wholesale (the ref and owner stay).
- `removes` deletes the record from the composed game.
- Every record in the running game carries provenance: which pack owns
  it and every pack that modified it, in order. Savefiles embed this,
  so a save knows exactly which content produced it.

Total conversions are the same mechanism at full throttle: depend on
`core`, replace or remove what you do not want, add your own world.

### Adding things that do not exist in the base game

Two levels:

1. New records of existing types (the JSON above) - pure data, safe by
   construction, validated against the same schemas core uses.
2. New capabilities - new effect opcodes, new commands, new record
   types with their own schemas, new UI panels, networked features.
   These are scripted plugins: they register handlers into the same
   string-keyed registries the engine's own systems use, sandboxed and
   capability-scoped. The engine never switches on closed enums, so a
   registered `frost:blizzard-teleport` effect is dispatched exactly
   like a core effect.

## Versioning and stability

`@neo-angband/mod-sdk` is the versioned surface mod authors build
against. Types are exported for TypeScript authors; everything is plain
JSON at rest. Breaking changes to pack semantics bump the SDK major
version and are called out in release notes.

## Licensing for mod authors

The engine is dual-licensed GPLv2-or-Angband-license (see LICENSE.md).
Declarative content packs and tile packs are your own independent works;
license them as you wish. Distributed scripted plugins are safest
treated as GPLv2 derivatives. See the note at the end of docs/MODS.md.
