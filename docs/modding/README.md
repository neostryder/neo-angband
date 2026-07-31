# Modding Neo Angband

Moddability is a ratified pillar of this project (PORT_PLAN.md decisions
13-21): every aspect of the game is open to mods, including capabilities
that do not exist in the base resources. The base game is itself a pack
("core", pack zero) loaded through the same pipeline your mod uses - if
core can do it, your mod can do it, redefine it, or delete it. Core is
parity plus the mod architecture only; everything else - including the
bundled neo-linoleum and QoL mods - is a mod (decisions 17-18). Cheaty
mods are allowed: the engine warns and labels, it does not forbid.

This directory is the modding SDK documentation set. It grows with the
engine; each page documents surfaces that exist and are tested. For the
overall design and the moddable-surface matrix, read `docs/MODS.md`.

## Contents

- This page: pack anatomy, manifests, and record composition (live today,
  backed by `@neo-angband/mod-sdk`).
- `MOD_LIFECYCLE.md`: how saves stay safe across install/update/
  uninstall, installing from git (and a future marketplace), multi-mod
  composition and conflict resolution, uninstall recovery, and the UX
  principles. RATIFIED (decision 19); not yet fully built.
- `MOD_SEAMS.md`: the CORE seams a mod reaches through - the `ModHooks`
  behaviour interface, its per-hook fold rules, and how a patch is turned
  on. Describes what is built.
- `MOD_REACH.md`: the MEASURED answer to "how much of the game can a mod
  actually make over today" - hook count, a census of the port's dispatch
  tables and which are mod-reachable, what data layering really supports,
  what resources are overridable, and the gap list. Read this before
  trusting a capability claim on any other page: this directory contains
  both design-of-record pages and built-today pages, and the two are not
  the same thing.
- `docs/LINOLEUM.md`: tile packs and converting the classic tilesets.
- `BUG_FIXES.md`: the bundled `bug-fixes` mod - its design of record and
  referenced changelog for upstream crash/corruption/save/determinism fixes
  that core deliberately does not carry (decision 24). Design of record;
  patches land with the mod runtime and the systems they touch.
- Coming as the engine lands them (P7 deliverables): handler registry
  catalog (effects, commands, room builders), the sandbox capability
  reference for scripted plugins, dialog/quest/shop cookbooks, the
  `neo-pack` validator/bundler, and publishing guidance.

## The bundled mods

Three mods ship with the game, all under `packages/web/mods/`, all OFF on
a fresh install (see `DEFAULT_ENABLED_MODS` - an untouched install is
faithful 4.2.6 with no mod loaded):

| id | shape | what it adds |
| --- | --- | --- |
| `qol` | content | Genuinely new conveniences, currently just auto-dig on walk. Built-in Angband `=` options are NOT here: they ship in core at their upstream defaults. See `QOL.md`. |
| `bug-fixes` | content | An unofficial patch set for upstream 4.2.6 bugs core deliberately keeps. See `BUG_FIXES.md`. |
| `neo-linoleum` | tiles | An ALTERNATIVE tile engine: the Linoleum loose-pack format (individual PNGs addressed by readable target maps, plus variant pools) and the converter that builds a pack from any legacy tileset. It does NOT supply the game's graphics - all five upstream tile sets (Original / Adam Bolt / David Gervais / Nomad / Shockbolt Dark and Light) are core content (`grafmode.c` / `lib/tiles/list.txt`) and appear in the Graphics screen with no mod enabled. It declares six packs, one per upstream set converted to a loose pack, so you can compare the two engines on identical art; packs you build yourself are yours. Declare a pack with `{ "grafID": >=100, "engine": "linoleum", "menuname": "...", "path": "..." }` - note `engine` is the FORMAT name and stays `linoleum`; `neo-linoleum` is the mod. See `docs/LINOLEUM.md`. |

Enable one in the in-app mod manager (game menu -> Mods), or with
`?mods=qol,bug-fixes,neo-linoleum` for a one-off.

**The mod is the unit you switch; its patches ride with it.** While a mod is
disabled its patches DO NOT EXIST - its code is never called, no hook is
installed, nothing appears in the menu, and core runs faithful 4.2.6. A mod that
changes BEHAVIOUR does so by default-exporting `ModHooks` from its own
`hooks.ts`; core holds one composed `ModHooks` and never learns which mod
supplied what (`docs/modding/MOD_SEAMS.md`).
Enabling the mod turns its whole patch set on at once,
and each patch is then individually switchable on that mod's own screen
(Mods -> the mod -> Fixes & tweaks), so you can take the set minus one.
That is all `default: true` on a rule means:
"on once its own mod is on" - never "on in a fresh install".

The `demo-*` directories alongside them are NOT shipped mods. They are the
framework proofs - one per SDK load path (a content pack that patches a core
monster, a sandboxed worker plugin, a trusted in-process plugin) - and exist
so all three paths stay exercised in dev and in the test suite. Discovery
drops them from release builds (`isShippedMod` in `mod-store.ts`), so a
player's mod manager lists exactly the three above.

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
- `fieldPatches` applies typed ops to dot-paths (`set`, `merge`,
  `addFlag`, `removeFlag`, `add`, `mul`) - see
  `packages/mod-sdk/src/patch.ts`.
- Modifying a record you do not own requires declaring its owner in
  `dependencies`; compose throws otherwise.

> **Measured limitation, read this before designing around the above.**
> Per-record addressing (`patches` / `replaces` / `removes` /
> `fieldPatches`) works on **24 of the 44 record files**. The other 20 -
> including `object`, `ego_item`, `vault`, `store`, `trap`, `brand`,
> `slay`, `object_base`, `projection` and `constants` - are whole-file
> passthrough only, because they either have no unique string `name` per
> record or core's own data contains duplicate names. A `patches` entry
> aimed at one of them is **silently dropped**: no error, no conflict-report
> line, the mod simply does nothing. `MOD_REACH.md` carries the full
> per-file list and the measurement.

Total conversions are the same mechanism at full throttle: depend on
`core`, replace or remove what you do not want, add your own world - within
the 24-file limit above.

### Adding things that do not exist in the base game

Two levels:

1. New records of existing types (the JSON above) - pure data, safe by
   construction, validated against the same schemas core uses.
2. New capabilities - new effect opcodes, new commands, new room
   builders, monster-AI overrides, new vocabulary terms. These go
   through the capability-gated registry host
   (`packages/core/src/mod/registry-host.ts`), and they require a
   **TRUSTED in-process** plugin (`<mod>/trusted.ts`), not the
   sandboxed Worker tier - a Worker is async by construction and cannot
   supply a handler that runs synchronously with live `rng` / `chunk` /
   `player` access deep inside the turn. The sandboxed tier keeps the
   reactive perceive/act/event surface and none of the registries.
   Trust is explicit: the plugin declares each `registry:*` capability
   in its manifest and the user consents at install.

> **Measured limitation.** Trusted-plugin discovery is a build-time glob
> over `packages/web/mods/` plus an `isShippedMod` allowlist
> (`packages/web/src/agents/trusted/discover.ts`), so today only a mod
> compiled into the web bundle can reach any registry. A mod installed from
> disk cannot - it can supply gamedata JSON only. And the registries cover
> five domains, not the whole engine; most of the port's dispatch tables
> have no registry at all. `MOD_REACH.md` has the census.

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
