# @neo-angband/mod-sdk

The mod machinery for [Neo Angband](https://github.com/neostryder/neo-angband):
manifest schema and validation, the deterministic load-order resolver, and the
record-composition engine that merges packs.

```bash
npm install @neo-angband/mod-sdk
```

## Why it is a separate package

The base game loads its own content **through this pipeline, as pack zero**. That
is the point: there is no privileged path a mod cannot take, because the game
itself does not have one. This package is that pipeline, with no engine attached —
so a mod's build script or test can validate a manifest, resolve a load order or
compose records without pulling in a game.

## What is in it

| Area | Exports |
| --- | --- |
| Manifests | `validateManifest`, `PackManifest`, `PackShape`, `packFacets`, `hasFacet`, `packRef`, `slugify` |
| Load order | `resolveLoadOrder`, `satisfies` (the semver subset the manifests use) |
| Composition | `composePacks`, `composeContentPacks`, `mergePatch`, `applyFieldPatch`, `composeFieldPatches` |
| Conflicts | `computeConflictReport`, `RecordConflict`, `FieldTouch`, `RecordOverride` |
| Record identity | `recordKey`, `keySpecFor`, `KEYED_RECORD_FILES`, `RECORD_KEY_SPECS` |
| Capabilities | `CapabilitySet`, `parseCapability` — what a scripted plugin is allowed to reach |

```ts
import { validateManifest, ManifestError } from "@neo-angband/mod-sdk";

try {
  const manifest = validateManifest(JSON.parse(text));
  console.log(manifest.id, manifest.shape, manifest.modApi);
} catch (e) {
  if (e instanceof ManifestError) console.error(`bad manifest: ${e.message}`);
}
```

## The three pack shapes

- **content** — declarative JSON validated against the record schemas. Safe by
  construction: it cannot execute anything.
- **tiles** — a tile pack, either a tilesheet re-skin or a loose Linoleum pack.
- **plugin** — a scripted mod. It default-exports a `ModPlugin` and receives the
  running engine as `ctx.core`, because a module loaded out of a mod folder cannot
  resolve a bare specifier and a bundled copy of the engine would give the plugin
  its own registries while the game ran on another set.

A single mod may declare several of these as **facets**; `packFacets` is what
reads them.

## Related

- [`@neo-angband/core`](https://www.npmjs.com/package/@neo-angband/core) — the engine itself
- [docs/MODS.md](https://github.com/neostryder/neo-angband/blob/master/docs/MODS.md) — the full modding guide
- First-party mods: [qol](https://github.com/neostryder/neo-angband-mod-qol) ·
  [bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes) ·
  [neo-linoleum](https://github.com/neostryder/neo-angband-mod-linoleum) ·
  [borg](https://github.com/neostryder/neo-angband-mod-borg)

## Versioning

`0.9.x` is the pre-release line and the API can change inside it; `1.0.0` is
reserved for the game's public release.

## Licence

GNU GPL v2, or the Angband licence, at your option — Angband's dual licence, kept
as the Angband project asks of its variants. npm carries one SPDX identifier so the
manifest says `GPL-2.0-only`; both texts are in [LICENSE.md](LICENSE.md).
