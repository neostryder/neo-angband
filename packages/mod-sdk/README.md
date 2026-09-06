# @rpgm-tools/neo-angband-mod-sdk

The mod machinery for [Neo Angband](https://github.com/neostryder/neo-angband):
manifest schema and validation, the deterministic load-order resolver, and the
record-composition engine that merges packs.

```bash
npm install @rpgm-tools/neo-angband-mod-sdk
```

Full authoring docs ship in `docs/`, starting with
[`docs/tutorials/README.md`](docs/tutorials/README.md).

## Why it is a separate package

The base game loads its own content **through this pipeline, as pack zero**. That
is the point: there is no privileged path a mod cannot take, because the game
itself does not have one. This package is that pipeline, with no engine attached,
so a mod's build script or test can validate a manifest, resolve a load order or
compose records without pulling in a game.

## Tools

Two command-line tools ship in this package. They are the validate and bundle
halves of authoring, living next to the schema they enforce. There is no
separate `neo-pack` CLI.

### `neo-angband-mod-check`

Runs the same rules the game enforces at install against a folder:

```
npx neo-angband-mod-check path/to/your-mod
```

That includes the manifest schema, the capability grammar (`parseCapability` /
`CapabilitySet.fromManifest`), the engine range, and the file-list rules a
schema cannot see (a `plugin.js` with no `modApi`, a committed zip that is not
declared in `payload.archives`). Exit 0 means the game will accept the mod.

### `neo-angband-mod-build`

Compiles a mod's TypeScript into the `plugin.js` its folder distributes, and
enforces the plugin ABI while doing it: no bare imports, one bundled file, a
default export that looks like a `ModPlugin`. `--check` verifies a committed
`plugin.js` is current without writing.

Scaffolding a new mod repository (CI, license files, GitHub workflows) is not
a package concern and is not provided here. A new mod is a folder with a
`manifest.json`; the check is what says whether that folder will install.

## Exports

| Area | Exports |
| --- | --- |
| Manifests | `validateManifest`, `PackManifest`, `PackShape`, `packFacets`, `hasFacet`, `packRef`, `slugify` |
| Load order | `resolveLoadOrder` (enforces), `satisfies` (the semver subset the manifests use) |
| Auto-sort | `sortModOrder` (proposes, and cannot fail), `collectSortEdges`, `SortPin`, `SortTier`, `PACK_GROUPS` |
| Sections | `resolveSectionState`, `expandSections`, `sectionFlag`, `PackSection`, `SECTION_BANDS`: the named parts of a mod |
| Compatibility | `PackCompat`, `COMPAT_CLAIMS`: what an author may claim about another mod (never binding) |
| Composition | `composePacks`, `composeContentPacks`, `mergePatch`, `applyFieldPatch`, `composeFieldPatches` |
| Conflicts | `computeConflictReport` (records), `contestedSlots` / `describeContested` (every other layer), `Fold`, `foldDiscards` |
| Record identity | `recordKey`, `keySpecFor`, `KEYED_RECORD_FILES`, `RECORD_KEY_SPECS` |
| Capabilities | `CapabilitySet`, `parseCapability`: what a scripted plugin is allowed to reach |

```ts
import { validateManifest, ManifestError } from "@rpgm-tools/neo-angband-mod-sdk";

try {
  const manifest = validateManifest(JSON.parse(text));
  console.log(manifest.id, manifest.shape, manifest.modApi);
} catch (e) {
  if (e instanceof ManifestError) console.error(`bad manifest: ${e.message}`);
}
```

## The three pack shapes

- **content**: declarative JSON validated against the record schemas. Safe by
  construction: it cannot execute anything.
- **tiles**: a tile pack, either a tilesheet re-skin or a loose Linoleum pack.
- **plugin**: a scripted mod. It default-exports a `ModPlugin` and receives the
  running engine as `ctx.core`, because a module loaded out of a mod folder cannot
  resolve a bare specifier and a bundled copy of the engine would give the plugin
  its own registries while the game ran on another set.

A single mod may declare several of these as **facets**; `packFacets` is what
reads them.

## Related

- [`@rpgm-tools/neo-angband-core`](https://www.npmjs.com/package/@rpgm-tools/neo-angband-core): the engine itself
- [docs/MODS.md](https://github.com/neostryder/neo-angband/blob/master/docs/MODS.md): the full modding guide
- First-party mods: [qol](https://github.com/neostryder/neo-angband-mod-qol),
  [bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes),
  [linoleum](https://github.com/neostryder/neo-angband-mod-linoleum),
  [borg](https://github.com/neostryder/neo-angband-mod-borg)

## Versioning

Standard Semantic Versioning as of `1.0.0`, the game's public release: a
breaking API change is a MAJOR bump, a backward-compatible feature is MINOR,
and a fix is PATCH. `0.x` was the pre-release line, where the API could
change inside a MINOR bump.

## Licence

GNU GPL v2, or the Angband licence, at your option: Angband's dual licence, kept
as the Angband project asks of its variants. npm carries one SPDX identifier so the
manifest says `GPL-2.0-only`; both texts are in [LICENSE.md](LICENSE.md).
