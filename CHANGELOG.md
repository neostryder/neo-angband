# Changelog

All notable changes to Neo Angband are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-1.0: the API, save format, and mod interfaces may still
change between minor versions. This file is maintained going forward - each
notable change lands in the Unreleased section and moves under a version
heading when that version is cut.

**Only work that has SHIPPED appears here.** An entry is written when the code is
in the tree, never in advance of it: to a reader who did not write it, a
changelog describing intentions is indistinguishable from one describing
features, and they go looking for the feature. Work that is planned but not yet
implemented lives in [docs/PLANNED.md](docs/PLANNED.md).

`0.x` is the pre-release line and `1.0.0` is reserved for the public release.
Semver on `0.x` means a feature release bumps the MINOR number, so `0.9.0` is
followed by `0.10.0` rather than by `1.0.0`. The first-party mods follow the same
scheme and reach `1.0.0` with the game rather than ahead of it - and a mod whose
released tag is iterated takes a MINOR bump, because a published tag is pinned by
digest in the game's catalogue and must never be moved.

## [Unreleased]

### Added

- **A plugin can now ask the game what it is made of: `ctx.registries`.** Every
  race, object kind, feature, trap, store and projection the session actually runs
  on, bound, at its real index. Until now a plugin could see `ctx.state` - the
  monsters standing on the current level - which is enough to draw a frame and not
  enough to answer a question about a thing by index: what a creature you are
  merely remembering can do, what an item you have never picked up is worth, which
  kinds share a `tval`. It is the whole registry set rather than a curated slice,
  for the reason `ctx.core` is the whole namespace. **A mod's own content is in it
  on the same terms as core's**, because binding happens after every enabled mod
  composes and mods append, so nothing in a lookup tells a modded race from a core
  one. That is what lets a consumer treat modded and vanilla content identically
  without trying to.
  - The first consumer is the **Borg**, which had shipped since its port with its
    danger evaluator fed zeroes: `makeCoreResolvers` existed, was documented, and
    had no caller, because the race registry was not reachable from a plugin. It
    is now, so the Borg fears real monsters, including ones a mod added.

- **A tileset mod can supply tiles for content the pack has never heard of:
  `registry:tiles`.** A plugin registers one filler, which runs after every pref
  layer - the pack's own and each mod's - and writes through a door that only ever
  fills what nothing assigned. So it cannot repaint the tile set even by mistake,
  and two mods filling different blanks cannot fight over one. The loose-pack
  engine also hands a filler a `derive(donor, hue)`, which allocates a slot drawing
  an existing asset with its hue rotated; the tilesheet engine answers null,
  because its tiles are cells of a fixed atlas with no spare cell for a variant,
  and a filler copies the donor instead.

### Removed

- **The game no longer decides what a mod's monster looks like
  (`fillTilesFromKin`).** 0.22.0 gave an added creature the tile of a race sharing
  its `base`, and an added item the tile of a kind sharing its `tval`. It is gone
  one release later, on the rule that has not moved since the port started: the
  port adds nothing to 4.2.6. Angband 4.2.6 has no concept of a record a mod added,
  so it has no opinion about what one should look like, and "the lowest-index
  relative's picture" is a judgement rather than ported behaviour. It was also a
  judgement about art the game does not own - a tile set drawn in 2003 has no
  picture for content added twenty years later, and a relative's picture there is a
  confident lie where a letter was the honest answer.

  **Nothing is lost for a player who wants the behaviour**, and it got better on
  the way out: `neo-linoleum` 0.15.0 carries exactly that rule, restricted to its
  own packs, and gives the added creature a recoloured tile of its own rather than
  a pixel-identical copy of its cousin's. It is one switch in that mod's options,
  on by default. Under Angband's own tile sheets an added creature is a letter
  again, which is what it was before 0.22.0 and what a fixed atlas can honestly
  offer.

  For mod authors: **ship tiles with your content, and if you do not, say so in
  your description and point players at a tile mod that fills blanks.** Tutorials 2
  and 3 now say that where the tile question comes up, and neither treats
  neo-linoleum as a dependency - a content mod is complete in ASCII with no tile
  set at all. The removal and its replacement are recorded in
  [docs/modding/MOD_COMPATIBILITY.md](docs/modding/MOD_COMPATIBILITY.md) under
  "Removals taken knowingly", which is the fourth entry of exactly this shape and
  the first whose subject had shipped.

## [0.22.0] - 2026-08-20

Current state of the project at version `0.22.0` - the mod-resilience release.
Nothing about the game's rules changed. What changed is that a mod can now add
one line to a list instead of restating it, that a mod's own content is drawn
rather than lettered, and that thirteen defects are fixed - four of them ways one
line of one mod could take the whole game down at boot, which now cost that mod
its line and nothing else.

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
  content used to stand out as a coloured letter among pictures, and the only
  fix available to an author was a pref file naming *atlas coordinates*, which are
  correct for one tile set and wrong for every other. A monster with no tile of
  its own now takes one from a race sharing its `base`, and an object kind from a
  kind sharing its `tval`, so a modded ant is an ant in every tile set at once.
  Restricted to records a mod ADDED, by provenance, so core's own drawing is
  untouched, including the object kinds that are deliberately blank because they
  are drawn by flavour. Runs in both tile engines. A pref file naming a specific
  tile still wins.
- Tutorial 2 now stocks its item in the Armoury, and its finished mod is checked
  against the real store binder, which is where an item name that does not
  resolve is caught, rather than becoming a shop that quietly lacks it.
- **A seventh tutorial: add an artifact.** The one shape the first six did not
  cover, and the last of the three examples a player asked for by name. An
  artifact is a layer over an item the game already ships rather than an item of
  its own, so it gets its own page: what `base-object` is, why an artifact's
  `name` is only half a name and carries none of the `&` and `~` decoration an
  ordinary item's does, and the trap that a wrong `tval` is reported while a
  wrong `sval` silently invents a placeholder base object, because that is the
  behaviour the Phial, the Star and the Arkenstone depend on. Its finished mod
  is a real folder like the other six, bound by the real object registry rather
  than read back as JSON.

### Fixed

- **A mod's artifact naming a base object that is not there costs the artifact,
  not the game.** Third instance of the store binder's defect, and the first
  where the right size of the drop is the whole record: a shop with one fewer
  stock line is a shop and an ego with one fewer candidate base is an ego, but an
  artifact with no base kind is not an artifact, because every number on it is an
  adjustment to a kind that has to exist. So a mod-contributed artifact whose
  `base-object` resolves to nothing is dropped whole and reported against that
  mod through the same mod-manager path the store and ego drops already use, and
  core's own still throws the message it always threw. Index-safe in the
  direction that matters: core's pack composes first and mods append, so no core
  artifact can sit behind a mod's and a savefile's core artifacts keep their
  numbers. An invalid `flags`, `values` or `act` token on a mod's artifact still
  throws and is recorded in [docs/PLANNED.md](docs/PLANNED.md).
- **The look/target UI ran terrain prefixes into the name: "the entrance to
  theArmoury", "You are inan open door", "somelava".** `terrain.txt` writes every
  `look-prefix` and `look-in-preposition` without a trailing space, and upstream
  separates them from the name in `finish_parse_feat` (`init.c` L2256-2272),
  which appends a space to each non-empty one after the parse. The port copied
  the data faithfully and never ported that hook, so the targeting code's
  `<preposition><prefix><name>` concatenation had nothing between its parts.
  Ten features, three visible strings: the eight store entrances ("the entrance
  to the"), the open and broken doors ("in"), and lava ("some"), plus the
  stores' "at" preposition, which the same normalisation covers. Two comments in
  `known.ts` asserted this was upstream's own data rather than a missing hook
  and are corrected; the assertions that had encoded the unseparated values are
  now the test that would have caught it. A port defect rather than an upstream
  wart: upstream renders these lines correctly, so it belongs in core, not in
  `bug-fixes`.
- **The town laid out eight store lots no matter what the terrain data said, and
  three other post-parse hooks were absent.** `finish_parse_feat`'s trailing-space
  half landed above; the same hook also derives each shop entrance's `shopnum`
  from the order of the `SHOP` flags and counts them into `z_info->store_max`
  (`init.c` L2249-2257, L2275), and the port hard-coded that eight-feature list in
  `town_gen_layout` instead. So a mod that flags another terrain `SHOP` got a
  store with no door anywhere in town, unreachable for the whole game, and one
  that cleared a `SHOP` flag left a lot leading to a shop that no longer existed.
  `FeatureRegistry` now assigns `shopnum` in `FEAT` order and exposes
  `storeMax` / `shopFeats()`, and the town reads those. `TOWN_STORE_FEATS` stays
  as the shipped-data expectation with a test that fails if the two ever part.

  Audited the other twelve `finish_parse_*` hooks against the port at the same
  time. Two more were missing:

  - **A bad critical-level table was accepted in silence.**
    `finish_parse_constants` runs `check_critical_levels` (`init.c` L986-1020) over
    the melee and ranged cutoff tables and refuses the data when the cutoffs do
    not strictly increase, because the `power >= cutoff` walk can never reach a
    row whose cutoff did not rise. That critical grade simply stops happening and
    the damage multiplier is quietly wrong. `bindConstants` did no such check, and
    `melee-critical-level` is a top-level key of the constants record that a mod
    can replace wholesale. It now rejects, with the last row's cutoff exempt
    exactly as upstream leaves it (which is why the shipped tables can end in
    `-1`), and the `o-` tables unchecked exactly as upstream leaves them.
  - **Shopkeeper tips came out in the wrong order.** `parse_hint` prepends onto a
    list and `finish_parse_hints` publishes its head, so upstream's `hints` is in
    reverse `hints.txt` order; `bindCore` published file order. `random_hint`
    reservoir-samples over that list, so the draw count matched and the tip did
    not. Reversed at boot, the way `names.txt` already is for the same reason.

  The remaining ten are reproduced or have nothing to reproduce, recorded here so
  the next audit does not repeat the reading: `player_prop`'s per-element
  expansion and its `bindui` binding are ported (`player/abilities.ts`,
  `game/ui-entry.ts`), `names`' list-to-array reversal (`session/boot.ts`),
  `trap`'s list-to-array with `tidx` (`world/trap.ts`), `history`'s entry
  reversal and successor resolution (`player/bind.ts`), `p_race`'s `ridx` and
  `class`'s `cidx` (array index, `player/bind.ts`); `body`'s `equip_slots_max`
  padding is a no-op for a single 12-slot body and the port carries the real slot
  count; `world`'s level-reference validation has no port subject, since nothing
  binds `world.json`; `realm`, `shape` and `flavor` publish a list and free the
  parser, and `flavor`'s reverse order is reproduced at its reader
  (`obj/flavor.ts`).
- **A shop line naming a missing item took the whole game down.** `bindStore`
  threw on a stock entry it could not resolve, from inside `bindCore` →
  `startGame`, which the host runs at module top level, so the player got the
  crash screen and no game at all. The `append` field op made that reachable from
  an ordinary pair of mods and an ordinary click: mod A appends an item mod B
  defines to a store's `normal` table (tutorial 2 is exactly this patch), the
  player disables mod B, and the appended line now names nothing. A
  mod-contributed entry that resolves to nothing is now dropped and reported
  against the mod on its own row in the mod manager; the rest of the store and
  every other shop in town are untouched. **Core's own data still fails loudly:**
  the tolerance is decided per entry from the record's provenance, so an
  unresolvable line in a store no pack has touched throws exactly the message it
  always threw, which is every store in a modless game. Covers every field a
  patch can reach: `normal`, `always` (including its svalless book lines) and
  `buy` each lose one entry, and a `store:` entrance repointed at a feature that
  does not exist leaves the shop unenterable rather than taking the game down.
  The record keeps its place in the store list, because that list is read
  positionally and renumbering it would move a saved game's stock between shops.
  The owner list resolves no names and so has nothing to refuse.
- **The character dump called every installed content mod "(not installed)".** The
  `[Mods enabled]` block resolved each enabled id's version out of the two bundled
  PLUGIN registries only, so a mod carrying no `plugin.js` (most of them, and all
  of the tutorial mods) matched neither and printed the "(not installed)"
  fallback. A pack in the player's own mods folder was equally invisible whether it
  shipped code or not, since those registries glob the bundle rather than the
  folder. Measured in the running desktop build: two tutorial content packs
  enabled and demonstrably composed, both reported as not installed. The version
  now also resolves through the content-pack registry: every bundled pack plus
  everything from the mods directory, a picked folder, or a repository install,
  and "(not installed)" is kept for an id that genuinely resolves to nothing,
  which is a real state worth a line. This mattered because naming the mods is the
  block's entire purpose: a dump claiming a loaded mod is absent points the reader
  at core for behaviour a mod caused. The list also moved out of `main.ts` into
  `mod-summary.ts` so it is testable at all: the entry module cannot be imported,
  which is why a list that was wrong for every content-only mod stayed green.
- **Monster recall did not know what a monster's KIND implies.** Upstream unions
  each race's base flags into its lore at startup (`finish_parse_lore`), so a
  player who has never met a giant black ant still knows ants are animals with
  weird minds, and that ainu resist fire and cannot be confused. The port had
  the race half of that inheritance and not the lore half, which is exactly why
  nothing noticed, since the flags were on the race all along and simply never
  known. Measured against the shipped pack: 54 of the 56 monster bases carry
  flags, so recall was quieter than upstream's for every monster the player has
  not met. The wizard "wipe monster lore" command still loses them for good,
  because upstream's union runs once at startup and never again; the existing
  wipe test is what caught the first attempt putting it in the wrong place.
- **A curse could multiply an object's weight by a negative number.**
  `finish_parse_curse` refuses a curse that carries `MULTIPLY_WEIGHT` together
  with a negative weight adjustment, and the port had the parser-side weight
  check but not this one: it is a FINISH hook, and the port's own comment said
  as much while never implementing it, which is exactly the blindness a parity
  test written against upstream's parser tests cannot see. Core's own data now
  fails the same way upstream's does. A mod's curse instead loses the FLAG and
  is told: of the two halves, the flag is the one whose removal leaves a
  coherent curse (a plain additive weight reduction), and failing the parse for
  a mod would mean the crash screen and no game. Core ships no curse using the
  flag at all, so nothing shipped changes.
- **An ego's `item:` line naming a missing base item took the game down.** The
  same defect the store's stock table had, in a second file: `item:` names a
  specific base kind, `append` lets one mod add an entry to another pack's list,
  and "mod A gives an ego a base item mod B defines, player disables mod B" then
  reached `ego: unknown sval` out of `bindCore` inside `startGame`, the crash
  screen over one line of one ego. A mod-contributed line that resolves to
  nothing is now dropped from that ego's candidate list and reported against the
  mod; core's own still throws the message it always threw. Dropping one entry is
  the whole cost here, because `poss_items` is a set of candidates and an ego
  with one fewer candidate still works: it simply cannot land on the kind that
  went away, which is what the player asked for by disabling the pack that
  defined it. The core-versus-mod decision itself now lives in one place
  (`mod/refusal.ts`) rather than in each binder, so two binders cannot come to
  different answers about the same provenance.
- **A patch could make a field unreadable and take the game down at boot.** A
  field patch that wrote a scalar, or `null`, over a field core writes as a list
  or an object produced a record that composed perfectly and that no binder could
  read: the store binder's `rec.owner.map(...)` threw a `TypeError` from inside
  `bindCore` inside `startGame`, which the host runs at module top level, so the
  player got the crash screen and no game. The composer already checked this:
  the record check's `field/type` rule fired on it and named the mod, but that
  check reports and never refuses by design, because the blueprint it reads is a
  measurement of core's own records and an unlisted value is legal. Container-ness
  is the exception, since nothing can iterate a string, so the composer now
  refuses that one class: the field is put back to what the record had before, the
  pack is told on its own row, and the rest of the patch still lands. Two things
  it deliberately still allows: a scalar written as the wrong scalar (readable,
  and the measurement cannot prove otherwise), and a patch that REMOVES a field,
  because dropping fields is how a total conversion works and putting them back
  would undo it.
- **Randart games handed out the wrong gems.** flavor.txt writes a ring or
  amulet record's `fixed:` lines above its `flavor:` lines, and the binder bound
  them the other way round, so the flavour list was not in the file's order.
  That list is walked backwards by `flavor_assign_random` (it reproduces C's
  prepend-into-a-linked-list), which makes a flavour's position in it the thing
  that decides which ring it lands on. In an ordinary game nothing showed: a
  fixed flavour keeps its own sval and the random assignment skips it, so the
  random ones kept their relative order and every ring looked right. Under
  `birth_randarts` it did show: `flavor_reset_fixed` scrubs every fixed sval but
  the One Ring's, which drops seven more entries into the random pool at the
  wrong end of the list. The draw COUNT is identical either way, so the RNG
  stream never moved and no seed probe could have caught it; only the assignment
  itself differs, and a test now runs both orders against one seed to show that
  it does under randarts and does not without.
- **Three field-patch ops silently destroyed data instead of failing.** An `add`
  or `mul` aimed at a path holding a list or a string treated it as `0` and wrote
  a number over it; a `merge` aimed at a list replaced the list with an object.
  All three now raise a patch error naming the path and what was actually there.
  This was not theoretical: a documentation example shipped an `add` against a
  store's stock list, which turned the list into a number while composition
  reported no problems at all.

### Changed

- Tutorial 3 no longer says an added monster is stuck as a coloured letter in tile
  mode, and no longer says a mod can carry its own art for its own monsters. A
  mod contributes a whole graphics mode, not one picture added to somebody else's
  set. Both claims had outgrown the code.
- Cleaned up some artifacts in the documentation and in source comments: the
  prose now uses plain ASCII punctuation throughout.

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

[Unreleased]: https://github.com/neostryder/neo-angband/compare/v0.22.0...HEAD
[0.22.0]: https://github.com/neostryder/neo-angband/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/neostryder/neo-angband/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/neostryder/neo-angband/releases/tag/v0.20.0
