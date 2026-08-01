# Changelog

All notable changes to Neo Angband are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-1.0: the API, save format, and mod interfaces may still
change between minor versions. This file is maintained going forward - each
notable change lands in the Unreleased section and moves under a version
heading when that version is cut.

`0.x` is the pre-release line and `1.0.0` is reserved for the public release.
Semver on `0.x` means a feature release bumps the MINOR number, so `0.9.0` is
followed by `0.10.0` rather than by `1.0.0`. The first-party mods follow the same
scheme and reach `1.0.0` with the game rather than ahead of it - and a mod whose
released tag is iterated takes a MINOR bump, because a published tag is pinned by
digest in the game's catalogue and must never be moved.

## [Unreleased]

Current state of the project at version `0.12.0`. High level, what exists today:

- A TypeScript port of Angband 4.2.6, held faithful to the original, with the
  upstream C tree kept buildable in `reference/` as the golden-master oracle.
- A headless game engine (`@rpgm-tools/neo-angband-core`) with no UI dependencies, and
  the Angband 4.2.6 gamedata compiled to a schema-validated core content pack
  (`@rpgm-tools/neo-angband-content`).
- Front-end shells over the same core: a web + PWA app (`@rpgm-tools/neo-angband-web`),
  an installable offline experience, an optional Electron desktop wrapper
  (`@rpgm-tools/neo-angband-desktop`), and a terminal / developer harness
  (`@rpgm-tools/neo-angband-cli`).
- A mod framework (`@rpgm-tools/neo-angband-mod-sdk`): content packs, tile packs, and
  sandboxed scripted plugins, with the base game loaded as a pack itself.
- **No bundled mods.** A fresh install is Angband 4.2.6 and nothing else. Three
  first-party mods ride that framework, each in its own repository with its own
  release tags and tests, each installed through the mod manager's *Install a
  mod...* row at a pinned tag with every file checked against a SHA-256 that ships
  inside the game: `qol` (quality-of-life conveniences), `bug-fixes`, and
  `neo-linoleum` (a second tile engine - loose packs of individually named PNGs with
  variant pools - plus the converter that builds one from any tilesheet, via
  `@rpgm-tools/neo-angband-linoleum`). The game's own tile sets stay core content on
  the classic tilesheet engine.
- The Borg (`@rpgm-tools/neo-angband-borg`): a faithful port of Angband's automatic
  player, riding the perceive/act agent API as a mod rather than living in core.

### Added

- **A plugin builder in the mod SDK** (`neo-angband-mod-build`, shipped as a bin by
  `@rpgm-tools/neo-angband-mod-sdk`). It compiles a mod's TypeScript into the single
  `plugin.js` a mod folder distributes, and enforces the plugin ABI: no non-relative
  import survives into the output, the mod's own modules are bundled in, the default
  export is a valid plugin, and a committed `plugin.js` must be a current build of its
  source. Any mod repository can now build itself; it used to require a checkout of
  this one.
- **A `demo-hooks` framework proof** under `packages/web/mods/`. It is the only mod in
  the build with a `plugin.ts`, and it exists so the ModHooks discovery path and its
  guards stay exercised now that the real mods are downloads. Dev builds only.

- **An upstream text census, gated in CI** (`packages/cli/src/text-census.ts`,
  `pnpm --filter @rpgm-tools/neo-angband-cli census`). It enumerates every string literal
  the C hands to a player-facing call and fails the build if the port does not
  contain one without a documented reason. This exists because code review kept
  passing a port that play sessions then found to be missing messages - a
  reviewer can confirm what is there but cannot see what was never written.
  Every remaining absence is listed with its reason in `KNOWN_ABSENT`.

### Fixed

Found by that census, each with a covering test:

- `calc_bonuses`' ten encumbrance notices (heavy weapon / heavy bow / weapon
  attunement / armour weight against maximum SP) never fired: the derive was
  ported and the state diff at the end of the same function was not. Behind
  them, `PlayerState.cumberArmor` was never written by anything, so the armour
  messages could not have fired even once they existed.
- "You re-arrange your pack." - the quiver half of `calc_inventory`'s reorder
  notice was ported, the pack half was not.
- The invisible-monster ranged hit ("The <missile> finds a mark."), and its gate
  corrected to `monster_is_obvious` so a camouflaged mimic is not named.
- Walking into UNKNOWN terrain used the known-grid wording and, more
  importantly, did not memorize the grid - upstream maps a wall you bump into
  blind, which is how a player feels along an unlit corridor. The known-grid
  branch now also reconciles stale map memory.
- Starting consumables read by flavour ("a Clear Flask") because
  `object_flavor_aware` was not applied to the class starting kit.

Documentation accuracy:

- Saves are in `localStorage`, not IndexedDB as the docs stated - a different
  quota and different browser controls.
- `docs/INSTALL.md` advertised in-app text/tile scaling that does not exist.

### Changed

- **`@rpgm-tools/neo-angband-content` reaches its own pack.** `0.11.0` published
  the compiled gamedata — 45 files, 2.0 of its 2.3 MB — and declared no `exports`
  subpath for it, so the one thing that package exists to do threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED` at every consumer. `0.12.0` adds `./pack` (a
  Node loader with the pack directory, load order from the manifest, and a
  missing-file error that names what IS there) and `./pack/*.json` for bundlers.
  The tarball check that should have caught it was resolving each target path
  itself and importing the file, which bypasses the exports map entirely; it now
  installs into a real `node_modules` and imports by bare specifier, and fails
  when any shipped directory is reached by no subpath.
- **The project version is checked everywhere it is written down.**
  `node tools/version.mjs` prints all fourteen sites and fails on drift — it found
  the CHANGELOG two releases behind on its first run. `set` refuses any number
  that is not one of the three semver successors of the current one, and refuses
  `1.0.0` without `--release`. The package manifests are discovered by scanning
  `packages/`, so a new package is covered the day it is created.
- **The lint backlog is zero and is now a gate.** 136 warnings, sorted by whether
  the rule was right about a faithful C port: `no-useless-assignment` (37 hits,
  all C-style default-init locals) and `no-dupe-else-if` (7 hits, 6 of them fresh
  RNG rolls the rule reads as duplicates) are off with the counts recorded; the
  rest were fixed and promoted to error. 51 dead imports gone, and
  `reportUnusedDisableDirectives` is on so a disable comment cannot rot into a
  false claim. Deliberate exceptions carry a per-site reason naming the C
  function — or the gap, which is how three unwired Borg paths became visible.
- **The Borg reaches the engine through one file.** Its destination is its own mod
  repository, where the plugin builder refuses a bundled copy of the engine, so
  every bare value import is a line that has to change on the way out. Measured:
  37 files mention the package and 28 are `import type`, which compiles to
  nothing. The real coupling was six symbols across eight files, and they now come
  through `core-api.ts`, with a census test that fails if a second file grows one.
- **The game bundles no mods.** `qol` and `bug-fixes` moved to their own
  repositories, joining `neo-linoleum`; `FIRST_PARTY_MOD_IDS` is empty and a release
  build's discovered mod set is empty with it. All three are in the catalogue and
  install the same way a third-party mod does. Bundling the author's own mods had been
  hiding every defect in the install path behind three mods that never used it.
- **The mods-folder screen stopped claiming a browser without a directory picker has
  a fixed mod list.** It said "every mod here is one bundled into the app - fully
  manageable, but a fixed set"; both halves are false. Downloading a mod needs only a
  network request and the browser's own storage, so Firefox and Safari install mods
  like anything else, and the screen now says so. The "N bundled with the game" clause
  is dropped when N is zero rather than sitting on screen as a permanent zero.

- README and `docs/INSTALL.md` are repositioned for an alpha that asks for
  testers: what is unfinished, how to report a difference from the original, and
  running your own build from source first, since a hosted build changes under
  you and cannot be pinned in a bug report. The "full feature parity,
  statistically verified" claim is gone - that framing kept being wrong.
- `docs/INSTALL.md` now carries a full inventory of upstream's display levers
  and where each one is here, including the three that are genuinely missing
  (window resize for a larger map, the tile width/height multiplier, and
  subwindows).
- The options menu follows upstream's own `option_actions[]` order.

[Unreleased]: https://github.com/neostryder/neo-angband
