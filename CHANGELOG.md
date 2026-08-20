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

### Added

- **A mod can add one entry to a list.** Two new field-patch ops: `append`, which
  adds entries to the array at a dot-path without restating it, and `removeValue`,
  which drops entries deep-equal to a value. This closes the limitation recorded
  under 0.21.0: putting a modded item in a shop's stock is now a three-line patch,
  core's own stock list survives untouched, and two mods can both add to the same
  store because neither has to replace the other's list. `append` is treated as
  composing (like the flag ops) so two mods appending to one list is not a
  conflict; `removeValue` is order-dependent, because it can erase another mod's
  entry, so it is reported and the mod that loads last wins.
- **An added monster or item is drawn from its family in tile mode.** A tile set
  maps named monsters to pictures and has never heard of a mod's, so modded
  content used to stand out as a coloured letter among pictures — and the only
  fix available to an author was a pref file naming *atlas coordinates*, which are
  correct for one tile set and wrong for every other. A monster with no tile of
  its own now takes one from a race sharing its `base`, and an object kind from a
  kind sharing its `tval`, so a modded ant is an ant in every tile set at once.
  Restricted to records a mod ADDED, by provenance, so core's own drawing is
  untouched — including the object kinds that are deliberately blank because they
  are drawn by flavour. Runs in both tile engines. A pref file naming a specific
  tile still wins.
- Tutorial 2 now stocks its item in the Armoury, and its finished mod is checked
  against the real store binder — which is where an item name that does not
  resolve becomes an error rather than a shop that quietly lacks it.

### Fixed

- **Three field-patch ops silently destroyed data instead of failing.** An `add`
  or `mul` aimed at a path holding a list or a string treated it as `0` and wrote
  a number over it; a `merge` aimed at a list replaced the list with an object.
  All three now raise a patch error naming the path and what was actually there.
  This was not theoretical — a documentation example shipped an `add` against a
  store's stock list, which turned the list into a number while composition
  reported no problems at all.

### Changed

- Tutorial 3 no longer says an added monster is stuck as a coloured letter in tile
  mode, and no longer says a mod can carry its own art for its own monsters — a
  mod contributes a whole graphics mode, not one picture added to somebody else's
  set. Both claims had outgrown the code.

## [0.21.0] - 2026-08-19

Current state of the project at version `0.21.0` - the modding-onboarding
release. Nothing about the game's rules changed; what changed is how much you
have to read before you can modify them.

### Added

- **A `registry:store` discount-roll seam** (`StoreBehaviourRegistry.registerDiscountRoll`,
  `StoreFacade.setDiscountRoll`), alongside the existing stack-size seam. Lets a mod restore
  a store's price-discount roll; core installs no handler, so no store discounts anything
  by default.
- **`feature-restoration`** added to the recommended first-party mods
  ([mods/registry.json](mods/registry.json)): restores spells and mechanics later Angband
  versions quietly dropped, each behind its own opt-in toggle (default off).
- **Six modding tutorials** ([docs/modding/tutorials/](docs/modding/tutorials/README.md)),
  each teaching one idea and ending in a visible result - from changing a single value to
  running code behind a player-facing switch. Every tutorial's finished mod is a real folder
  under `samples/tutorials/`, composed against the shipped game data on every test run and
  checked against the game's own mods-folder reader, so a tutorial cannot go quietly stale
  and its finished mod cannot stop being installable. Copy any of the six into `mods/` to
  run them without typing anything.
- **[Feature restoration](docs/modding/FEATURE_RESTORATION.md)** written up as a named
  concept: vanilla stays vanilla, and dropped mechanics come back as optional mods - with the
  research rules (name the version, respect the modern surrounding system, one switch per
  feature, everything off by default) that keep a restoration honest.
- **The character dump names the enabled mods.** A dump is what players hand each other, and
  a mod's change is indistinguishable from a core bug in one. Written only when a mod is
  enabled, so an unmodded dump is unchanged.

### Changed

- **The README is rewritten for players rather than engineers.** What the project is, why you
  might want it, and how to play come first; parity methodology, architecture and provenance
  move behind links. A prominent "want to make a mod?" path now leads to a tutorial rather
  than to an API reference.
- **`AI_POLICY.md` renamed `AI_USAGE_POLICY.md`**, revised for a clearer disclosure section
  and a narrower, engineering-focused correctness claim.
- **The item and monster tutorials now say what a mod gets for free, and what it does not.**
  An item you add is eligible for every ego, brand, rune and quality enchantment that applies
  to its kind, from the moment the mod is on - a *Padded Jerkin of Resist Fire* needs nothing
  declared. A monster you add carries its own colour but inherits its glyph from its base, and
  in a tile set it keeps drawing as a letter until a mod supplies a tile. Both are now written
  down where the beginner meets them.

### Fixed

- **The tutorials' finished mods could not be installed.** All six shipped in folders whose
  names did not match their manifest ids, and the game refuses such a pack - so the one thing
  a reader is most likely to try, dropping the finished article into `mods/` to compare against
  their own, failed. The folders are renamed and the test suite now drives the game's real
  mods-folder reader rather than assembling the packs itself.
- **Two doc claims the code had already outgrown.** `docs/MODS.md` and
  `docs/modding/MOD_REACH.md` still said a mod installed from disk could supply data only and
  that record layering reached 24 of 44 files. Both gates closed some time ago - a mod folder
  ships `plugin.js` and reaches the capability registries from wherever it was installed
  from, and every record of every shipped file is addressable. The stale passages are marked
  as the before-picture rather than deleted, since the reasoning still explains the design.

### Known limitations

- **A mod cannot add one entry to a list.** Field patches can set, merge, add or remove a flag
  and do arithmetic, but they cannot append to an array - so putting a new item in a shop's
  stock means replacing that shop's whole list, and two mods cannot both do it. Everything
  else about an added item composes cleanly with other mods; this does not.

## [0.20.0] - 2026-08-16

The initial public alpha release.

### Added

- **A TypeScript port of Angband 4.2.6**, checked against the original C down
  to message text and screen layout. Parity is measured rather than merely
  asserted: the port is diffed against thousands of levels generated by the
  real compiled C, across a battery of statistical tests. See
  [docs/PARITY.md](docs/PARITY.md).
- **Web-first, desktop-best.** Play in any current browser, install it as an
  offline PWA, self-host it as static files, or run it as a desktop app for
  Windows, macOS and Linux - all from the same build. The desktop build is the
  recommended way to play: real saves in a real folder, no network, no browser
  reclaiming its storage.
- **Moddable by construction, and it ships no mods.** The base game is itself
  a content pack. Declarative, schema-validated packs for content,
  Linoleum-style tile packs, and sandboxed scripted plugins for the exotic -
  all installing through the same verified route as any third-party mod. See
  [docs/MODS.md](docs/MODS.md).
- **The Borg**, a faithful port of Angband's automatic player, riding the mod
  API as its own completeness proof.
- **Deterministic and seeded** generation throughout, with a save format built
  to survive modular content.

[Unreleased]: https://github.com/neostryder/neo-angband/compare/v0.21.0...HEAD
[0.21.0]: https://github.com/neostryder/neo-angband/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/neostryder/neo-angband/releases/tag/v0.20.0
