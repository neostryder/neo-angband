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

Current state of the project at version `0.14.0`. High level, what exists today:

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
- **No bundled mods.** A fresh install is Angband 4.2.6 and nothing else. Four
  first-party mods ride that framework, each in its own repository with its own
  release tags and tests, each installed through the mod manager's *Install a
  mod...* row at a pinned tag with every file checked against a SHA-256 that ships
  inside the game: `qol` (quality-of-life conveniences), `bug-fixes`,
  `neo-linoleum` (a second tile engine - loose packs of individually named PNGs with
  variant pools - plus the converter that builds one from any tilesheet, via
  `@rpgm-tools/neo-angband-linoleum`), and `borg` (the autoplayer). The game's own
  tile sets stay core content on the classic tilesheet engine.
- The Borg, in its own repository like every other mod: a faithful port of
  Angband's automatic player, driving the game through the same perceive/act agent
  API a third-party automation would use.

### Added

- **Mod authors can declare compatibility, and the engine resolves it.** A manifest
  gains `sections` (named parts of a mod, each independently switchable and each
  carrying a priority BAND rather than a numeric offset, so a part is placed
  absolutely instead of relative to whatever the list happens to hold), `group`
  (LOOT's idea, and the reason a mod can be sorted against mods that do not exist
  yet), and `compat` (prefer-mine / prefer-theirs, a `conflicts` warning that carries
  the author's required `because`, and `patches` for a section that exists only while
  the mod it patches is installed). One rule underneath all of it: an author has
  total authority over their own mod's contributions and none over the player's order
  or anyone else's mod - so a declared conflict warns and never refuses, which
  diverges from NeoForge and Factorio on purpose.
- **A sort that cannot fail.** `sortModOrder` proposes an order from four tiers -
  hard, player, author, group - and on a cycle drops the weakest edge and names it.
  It is deliberately separate from `resolveLoadOrder`, which enforces. `loadAfter` and
  `loadBefore` used to be hard constraints, so two mods each claiming priority
  refused to launch the whole set with neither author at fault.
- **A conflict report that sees more than content records.** Five composition layers
  can discard a contribution and the report covered one of them, which is worse than
  no report: an empty pane reads as "nothing conflicts". Claims are derived from what
  a mod actually contributes - refs in its files, keys its hooks factory returned,
  grafIDs claimed - rather than from a `touches` manifest field that would go stale.
- **A pinned surface for `ctx.core`** (`packages/core/mod-api-surface.json`,
  `tools/api-surface.mjs --update`, and a test that reads the same namespace object
  the host hands to a plugin). `MOD_API_VERSION` versions the plugin contract's
  *shape*, not the ~1700 engine exports an author spends all their time calling, so a
  rename could break every mod with no CI anywhere able to know. It fails in both
  directions on purpose: a baseline that tolerates additions goes stale, and then the
  removal check measures nothing. It is a ratchet, not a fence - it does not make the
  namespace stable, it makes a break visible to the person breaking it rather than to
  a player.
- **`docs/modding/MOD_COMPATIBILITY.md`** - the promise, stated: a data-only pack
  survives engine releases without being republished, and a pack that ships code gets
  a release's warning before an ABI bump strands it.

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

### Fixed

- **The Borg's decision ladder had never run.** Two of its test files hung
  indefinitely and were excluded from CI, so `think()` - the function that
  decides - was executed by nothing. The cause was in core, not the Borg: the
  per-think reseed went through `Rng.setState`, which is the SAVEFILE path and
  deliberately forces quick mode off to match load.c. That handed the generator
  an all-zero WELL table, which is a fixed point: every draw returned 0, and
  `borg_twitchy` retries on `dir == 0` without spending its counter (faithfully -
  the C does the same), so the first decision on a live level never returned.
  Core gains `Rng.reseed()`, which is the seed swap the C does by assigning
  `Rand_value`; the exclusions came off and the Borg's suite went from 138 tests
  to 161. The old RNG test asserted that two generators agree, which a generator
  stuck at zero satisfies - the new one asserts the spread.
- **The Borg never considered attacking with an artifact.** All 61 `BF_ACT_*`
  activation methods were missing from the attack dispatch. The enum carried
  every id, so `borg_attack` asked about each one, every one fell to
  `default: return 0`, and 0 is what "no such artifact" looks like. Transcribed
  from the C, including the five multi-element dragon activations and
  Holcolleth's sleep-II, which was not ported at all. A source census now fails
  if any `BF_*` id loses its case - a behavioural test cannot catch this, since
  without a host activation resolver every one of these branches legitimately
  returns 0.
- Two Borg "gaps" recorded in the last release were misreadings of the port, and
  the C settles both: neither `borg_decurse_any`'s command half nor
  `borg_test_stuff` computes a spell fail rate, so neither has any use for the
  `playerHas` seam. The unused parameters are gone and the reason is written
  where they were.
- `packages/web/src/mod-problems.ts` contained two literal NUL bytes as a dedup
  separator, which made ripgrep and git grep treat the file as binary and skip
  it. Same character, written as an escape.
- The monster death message is three whole sentences again, not one sentence with
  the verb interpolated. `You have killed/destroyed/slain %s.` is chosen correctly
  either way, but a spliced verb leaves no matchable literal, so the text census
  saw a missing message - and had been counting it present only because
  `packages/borg` carried the string in its message-PARSING table. Removing the
  Borg from the tree is what surfaced it. A whole sentence is also the unit
  translation needs.

### Changed

- **The later mod wins, on every layer and every hook.** The mod manager ships a row
  reading *"Move later (loads last, wins conflicts)"*, and that sentence was false of
  two layers. Tiles resolved FIRST-wins, so moving a tile mod later made it lose; and
  two of the seven `ModHooks` - `walkBlockedByDiggable` and `objectListTiebreak` -
  stopped at the first contributor with an opinion, so the later mod's rule never ran
  at all and both its author and its player believed it worked. Both hooks are asked
  in reverse load order now, `first-answer` is gone from the fold vocabulary, and
  `contestedSlots` picks the last claim for every discarding fold. Two folds are still
  not last-wins and forcing them would have been worse: `true` from `historyAdd` means
  "I have nothing to say about this entry", not "I insist it be written", so last-wins
  there would let a later mod's silence cancel an earlier mod's rule and break both.
  The invariant that actually holds is sharper - **no mod's opinion is ever discarded
  in favour of an earlier one** - and a test now asserts a behaviour slot and a record
  slot resolve to the same winner.
- **A missing patch target costs the patch, not the mod.** `composePacks` threw and
  the caller answers a throw by removing the whole mod, so a pack patching forty
  monsters lost all forty - plus its code, its rules and its tiles - because one
  record had been renamed. It takes an `onRefuse` reporter now. This also ended an
  asymmetry nobody chose: 20 of core's 44 record files take a merge path that reported
  and carried on, and 24 take one that threw. Same author mistake, two outcomes,
  decided by the shape of core's own data.
- **An `engine` range labels data and gates only code.** An out-of-range manifest used
  to refuse the whole pack, which is the "the engine labels, it does not forbid"
  ruling applied backwards: the range says what the author *tested*, and nothing in a
  data pack's manifest can make its JSON unloadable. It now blocks a pack that ships
  code, with `modApi` as the signal - required of exactly the packs with a `plugin.js`
  and impossible to set to buy leniency. Tile packs follow the data rule, which
  reverses the old comment's argument and answers it: a stale mapping loses individual
  tiles to the ASCII fallback, which the player can see, and that beats a whole
  tileset going dark on a patch its author never saw.
- **The plugin ABI has a deprecation window.** `modApi` was matched with `!==`, so the
  day the ABI bumped, every mod in existence would stop loading at once. `MOD_API_MIN`
  opens a range, and the two-release rule is: ship the behaviour, keep honouring the
  old contract, warn - *then* raise the floor. `LoadedModPlugin.api` records what each
  plugin declared, which is the mechanism without which the window is a promise
  nothing can keep.
- **The Borg left this repository, and is now installable.** It is in the
  catalogue at `v0.1.0`, so for the first time a player can actually run it -
  install, enable, and switch on the mod's own *Let the Borg play* toggle, which
  is a separate act from enabling the mod. `packages/borg` is gone; the port lives in
  [neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg) at
  `v0.1.0`, where it is a mod a player installs and switches on rather than a
  package with no importer. Its six runtime engine symbols now arrive as ESM live
  bindings filled from `ctx.core`, so `plugin.js` carries the whole Borg and not
  one byte of the engine - which the builder enforces and the mod's own tests
  measure. Two guards travelled with it and one is new: no file in the bundle may
  value-import the engine, and nothing may read an engine value at module top
  level, which exactly one site did.
- The plugin builder learned about `controller`. `validateModPlugin` in the host
  and `pluginProblem` in the SDK's builder are two hand-written copies of the same
  ABI check - deliberately, since the builder cannot import the front end - and
  they had drifted: the host accepted a controller-only plugin and the builder
  refused it as "would do nothing", which is precisely the Borg. A mod author only
  ever sees the builder, so the ABI had effectively not grown at all.
  `plugin-abi-agreement.test.ts` now reads both files and fails when the member
  lists or the message disagree.
- **The first-party mods take their gamedata from npm.** `qol` (v0.11.0) and
  `bug-fixes` (v0.12.0) each carried a hand-written `content.ts` that read the
  compiled pack out of a sibling checkout of this repository, because
  `@rpgm-tools/neo-angband-content` was not published; both files said in their own
  headers that they would collapse to one import the day it was. They have. The
  sparse checkout, `NEO_ANGBAND_REPO` and the plugin builder's dependency on a
  neighbouring working tree are gone from both, so each mod's CI now proves it
  against exactly what a third-party author would install. Their catalogue entries
  are re-pinned; `plugin.js` is byte-identical in both, and only `manifest.json`
  moved.
- **A mod can be an autoplayer.** `ModPlugin` gains `controller?(ctx)`: return an
  AgentController and the host binds it as the game's command provider. The host
  owns a single slot rather than letting mods call `ctx.core.installController`
  themselves, because that call swaps `state.nextCommand` and returns an
  uninstall that restores whatever preceded it - two mods doing it both succeed,
  the second silently wins, and unwinding out of order restores the wrong one.
  That is now a test in core rather than an assertion in a design document. The
  second autoplayer is refused by name; `command:add` is required and its absence
  is reported as that mod's fault. Optional member, so the ABI version stays 1 -
  but a controller-only plugin used to be rejected as "would do nothing", which
  is exactly the shape the Borg has.
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
