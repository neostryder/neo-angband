# Changelog

All notable changes to Neo Angband are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-1.0: the API, save format, and mod interfaces may still
change between minor versions. This file is maintained going forward - each
notable change lands in the Unreleased section and moves under a version
heading when that version is cut.

## [Unreleased]

Current state of the project at version `0.1.0`. High level, what exists today:

- A TypeScript port of Angband 4.2.6, held faithful to the original, with the
  upstream C tree kept buildable in `reference/` as the golden-master oracle.
- A headless game engine (`@neo-angband/core`) with no UI dependencies, and
  the Angband 4.2.6 gamedata compiled to a schema-validated core content pack
  (`@neo-angband/content`).
- Front-end shells over the same core: a web + PWA app (`@neo-angband/web`),
  an installable offline experience, an optional Electron desktop wrapper
  (`@neo-angband/desktop`), and a terminal / developer harness
  (`@neo-angband/cli`).
- A mod framework (`@neo-angband/mod-sdk`): content packs, tile packs, and
  sandboxed scripted plugins, with the base game loaded as a pack itself.
- Bundled mods riding that framework: `qol` (quality-of-life conveniences),
  `bug-fixes`, and `neo-linoleum` (loose-pack tile conversion via
  `@neo-angband/linoleum`).
- The Borg (`@neo-angband/borg`): a faithful port of Angband's automatic
  player, shipped as a bundled mod on the perceive/act agent API.

[Unreleased]: https://github.com/neostryder/neo-angband
