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
  `bug-fixes`, and `neo-linoleum` (a second tile engine - loose packs of
  individually named PNGs with variant pools - plus the converter that builds
  one from any tilesheet, via `@neo-angband/linoleum`). The game's own tile sets
  stay core content on the classic tilesheet engine.
- The Borg (`@neo-angband/borg`): a faithful port of Angband's automatic
  player, shipped as a bundled mod on the perceive/act agent API.

### Added

- **An upstream text census, gated in CI** (`packages/cli/src/text-census.ts`,
  `pnpm --filter @neo-angband/cli census`). It enumerates every string literal
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
