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

Current state of the project at version `0.19.0`. High level, what exists today:

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

- **Authoring shortcuts, measured from core's own data.** `draftRecord("object",
  {name, type: "sword", level: 20}, core)` now returns a complete record - cost,
  weight, to-hit, `alloc` and graphics taken from core's own level-20 swords -
  together with the evidence for every number it chose and a list of what is
  still wrong with it. A price is not derivable from first principles, but it is
  derivable from precedent, and precedent is what core's 375 objects are. The
  shape is MODELLED on the nearest comparable record rather than assembled from
  file-wide field frequency, which produced a sword carrying an `armor` block
  because 59% of core's objects have one; a model never lends `flags`, `slay`,
  `brand`, `effect` or `values`, because a template that quietly grants powers
  hands an author an item that does things they never asked for. Every step is
  separately callable: `describeFile`, `requiredFields`, `fieldUsage`,
  `templateRecord`, `peersFor`, `suggestFields`. See `docs/modding/AUTHORING.md`.
- **`checkRecords`: every way a new record will silently do nothing, named.**
  A required field absent (`error`), a reference that names nothing, a field
  written as the wrong type, a missing `alloc` so the item never generates
  (`warn`), a misspelled field name with a "did you mean", a monster with
  nothing to attack with (`hint`). Plus the one nobody thinks of: Angband hands
  each object of a flavoured type its own flavour, and a mod that pushes a tval
  past its flavour supply makes some other item indistinguishable when
  unidentified - counted from the composed data, so a mod that adds flavours as
  well as objects gets the credit. Nothing here refuses anything; the refusals
  live where the rules are the engine's own.
- **A declared, measured reference graph.** `REFERENCE_EDGES` names 37 fields
  that point at another record - `object.type` into `object_base`,
  `monster.base` into `monster_base`, `ego_item.slay` into `slay`, and so on -
  and every edge is run over core's 3,279 records by its own test, so a wrong
  edge is a test failure rather than a false alarm in somebody's mod. References
  resolve against core PLUS the mod's own new records. An unresolved reference
  is a warning and never a refusal, because core's own data contains some:
  `artifact.txt` writes `soft armour` where `object_base.txt` and `list-tvals.h`
  write `soft armor`, and fourteen artifact base objects name svals `object.txt`
  never defines. Both are upstream 4.2.6's, reproduced exactly, and both are
  pinned by count so the exceptions cannot quietly grow.
- **`ModProject`: a whole mod assembled, composed and checked before it is
  written.** `modProject(manifest).declareField(...).add(...).patchFields(...)
  .build(corePack)` returns the mod folder's bytes, composition's own refusals,
  and the findings - measured on the COMPOSED result, because a patch that
  breaks a reference is invisible in the mod's own files. It touches no
  filesystem, so the same builder works from a CLI, a test, or an in-game
  editor, and it reports a missing dependency as a finding rather than throwing.
- **`RECORD_BLUEPRINTS`**, generated from the shipped pack: per record file, per
  field (nested fields and array elements included), how many of core's records
  carry it, which JSON shapes it takes, the range its numbers span, and the
  vocabulary its strings use where there is one. Derived rather than declared,
  for the same reason `CORE_RECORD_KEYS` is - and asserted to agree with it,
  file for file, since the day those two generated tables disagree is the day a
  field is an extension at one end and a core field at the other.

### Fixed

- **Adding a record to `object`, `ego_item` or `vault` silently deleted the base
  game's copy of that file, and now says so.** Composition merges a file per
  record only when every record's name slugs to a unique ref, and those three
  fail it on core's own data because Angband's convention for a greater form
  reuses the name with marks (`Acquirement` / `*Acquirement*`, `Little
  eruption` / `Little eruption+`) - and `ego_item` ships 23 names twice. The
  loader has always reported the whole-file replacement in `problems`;
  `ModProject.build` now promotes it to an `error`, because a line in a list is
  not proportionate to discarding all 375 of the game's objects. Patching,
  replacing and removing records in those files is unaffected and works
  per-record. Adding one remains blocked pending a change of composition's
  identity to `recordRefKeys`.

- **A mod's own vocabulary: namespaced, declared, and enforced.** A field a mod
  introduces is now written `"gore:bleed"` and declared in that mod's manifest
  under `fields`, with the record files it may appear on and an optional type.
  Namespaced because the alternative is a land grab - whoever ships first takes
  `bleed`, and every later mod either collides with it or works around it -
  and because qualifying by the declaring mod makes deliberate interop
  expressible in the same stroke. It is the rule the vocabulary registry
  already used for terms, so there is one rule rather than two. Declared
  because the declaration is what buys the error message: a namespaced key
  nothing declares, one written onto a file its declaration does not list, and
  one whose shape does not match its type are each stripped and reported by
  name. An *unqualified* key core does not know is no longer treated as a field
  at all - `atack` is a misspelling of `attack`, not a new attribute - and is
  reported with core's nearest real field named. That arm needs core's key
  table and so runs in the host; the namespace rule needs only the manifests
  and runs in the SDK. A dropped field costs the field, not the mod. The host's
  manifest allowlist was, as ever, the thing that would have quietly inverted
  the feature, and a test caught it.

- **A mod's added field survives on fifteen bound record types, not two.** Ego
  items, artifacts, terrain, traps, vaults, room templates, projections,
  stores, curses, object bases, monster bases, player races and player classes
  joined objects and monsters. One helper (`attachExt`) rather than the same
  three lines fifteen times, because `grep attachExt` is then a census of which
  record types carry mod fields - a type nobody wired up is visible as an
  absence instead of being indistinguishable from one with nothing to carry,
  which is precisely how the gap survived its first pass. The census is a test:
  it injects a sentinel into every record of each covered file and counts the
  survivors, since bound order is not record order and "record i becomes bound
  record i" would be a claim it was asserting by accident.

- **A mod can add a field core has never heard of, and read it at runtime.**
  Asked directly whether a mod could make a dagger `1d5` instead of `1d4` and
  give it a `bleed` key, the answer turned out to be two-thirds yes. Patching a
  value works end to end - the dagger really rolls 1d5 - and so does removing a
  key, which really takes THROWING off it. Adding one did not: it composed
  cleanly, reported no problem, landed in the composed record, and was then
  dropped by the binder. No error, no effect, which is the worst shape a gap
  can take. `ObjectKind.ext` and `MonsterRace.ext` now carry the keys core does
  not bind. `ext` is frozen, so one mod cannot rewrite what another reads, and
  absent entirely when nothing was added, so its presence means something. It
  holds ONLY the mod's keys - copying core's own fields in would invite a mod
  to read a pre-bind value that can disagree with the bound one forever without
  either being wrong. Which keys are core's is derived from core's own gamedata
  rather than declared, and re-derived by its test in both directions, so the
  boundary cannot drift as the pack grows. Core never reads `ext`: this is the
  DATA half of extending the game, and the behaviour half is already there in
  `registry:effect` and `registry:blow`. Objects and monsters are done and
  proven from disk; the remaining binders still drop an added key.

- **Every record of every gamedata file is now nameable by a mod.** Declaring a
  per-file key on 2026-07-29 stopped per-record patches being silently dropped,
  but a key per FILE is not every RECORD being addressable, and the difference
  was **73 records that no ref could name** - 61 of `ego_item`'s 107 among them,
  so a mod could not patch "of Acid" at all. Two unrelated causes, separated
  rather than papered over. The first was information the slug threw away:
  `slugify` collapses `*` and `+`, so `*Healing*` and `Healing` arrived as one
  key even though nothing about the data was ambiguous - the key now spells the
  marks out (`core:potion--star-healing-star`), which alone accounts for every
  collision in `object` and `vault` and 16 of `ego_item`'s. The second was names
  core genuinely repeats, which no care with the name can separate, so a file may
  now declare a DISCRIMINATOR: `ego_item` uses the item types an ego applies to,
  giving `core:of-acid#shot-arrow-bolt`. That is not an invented identity - it is
  upstream's own `lookup_ego_item(name, tval, sval)`.
  Nothing that resolved before stopped resolving: a record answers to several
  refs and the older slug is kept as an alias, dropped only where it would shadow
  another record's primary key - which is not hypothetical, since `*Healing*`'s
  legacy key is plain `Healing`'s real one. An ambiguous ref is refused with the
  refs that DO work listed, because "ambiguous" with no alternative is where an
  author gives up. Measured over the shipped pack: **0 unaddressable records**,
  asserted in both directions, with both controls run. Proven from disk by a real
  mod folder patching one "of Acid" out of the real `ego_item.json` and leaving
  the others untouched. `history` stays keyed by nothing on purpose - a history
  record is `{chart, phrase}` and every part of it is a value a mod would change
  - and an op against it is reported, never dropped.

- **`registry:store` — a mod can change what shops buy and what they stock.**
  A mod could already add a store record and its own object types; it could not
  make the shop deal in them, because "what will this shop buy" and "how many
  does it stock" were `switch` statements. Both are a registry now, keyed the
  way each decision is actually made — stack size by object type, the buy rule
  per shop with a wildcard for "every shop". Core's own rule is registered under
  that wildcard, so a mod layers a rule on top of 4.2.6's instead of rewriting
  it. Two refusals are deliberate: an emptied registry refuses rather than
  letting every shop buy anything, and the stack limit stays core's so a mod
  cannot break a pile. `mass_produce` had no test at all before this; it now has
  1,167 golden vectors recorded from the old switch. Along the way that turned up
  a measurement worth keeping — no book in the 4.2.6 data is cheap enough to
  reach the mass-production rule for books, so that rule is faithful and dead
  until a mod adds a cheap book.
- **`registry:blow` — a mod can change what monster attacks do, and add its own
  kinds of attack.** `blow_effects.json` has always accepted a 31st record, but
  until now that record was data with no behaviour: the behaviour lived in two
  26-case `switch` statements. They are now one `BlowEffectRegistry` that both
  of the paths resolving a blow consult, so a modded attack cannot behave one
  way in the engine's recording path and another in the live game. A mod writes
  ONE description and the engine derives both handlers from it, or takes the
  handler currently installed and wraps it — so core's poison can be extended
  rather than reimplemented. Core keeps every 4.2.6 behaviour exactly, including
  the places where the two paths disagree about the order they roll dice in;
  what proves that is a set of 480 golden vectors recorded from the code before
  the registry existed and replayed against it, covering all 30 effects on both
  paths under two environments, with a probe that catches a change in the number
  of random values drawn even when nothing else moves.
- **The last three systems the port was missing: quests, arena mode, and
  persistent levels.** Quests now exist as a system rather than as two hard-coded
  monsters - the quest list, its save block, the level feeling it changes, and
  the five holes that were still open when the row was written. Arena mode
  arrives through `prepare_next_level`'s own branch, not through the dungeon
  profile list, which is why it is deliberately *not* selectable as a profile.
  Persistent levels keep the dungeon you left, and bring full town store
  generation with them.

- **`lore.txt`: monster memory that outlives the character.** What you learned
  about a monster is written out and read back, so a new character in the same
  install starts with the knowledge you earned - as upstream does.

- **Monsters emit light and darkness.** No monster in the game had ever lit a
  corridor or darkened one; the light-source field existed on the record and
  nothing read it. It is now on the mod API surface too, so a mod can give a
  monster its own glow.

- **The monster message queue.** Upstream collects a turn's monster messages and
  prints them together - "you have slain 3 kobolds" rather than three separate
  lines. The port printed each one as it happened, which is the single biggest
  reason the message log did not *read* like Angband. It now goes on the same
  queue upstream uses.

- **`randart.log` and `randart.txt`.** The randart generator narrates its own
  design loop again: every `count_*`, `add_*`, and the whole power calculation,
  from 122 missing lines down to none. If you want to know why a random artifact
  came out the way it did, the answer is in the file.

- **Custom option sets that survive into your next character.**
  `options_save_custom` / `restore_custom` / `restore_maintainer` had nowhere to
  write; the options a player sets for their *next* character now persist.

- **The ENTER command browser**, the `purple_uniques` lore recolour, temporary
  brands and slays in object info, the launcher's contribution to the character
  sheet, and the timed-effect columns that had no supplier.

- **`registry:profile`: a mod can add its own kind of dungeon level.** A room
  builder makes a room; a dungeon *profile* decides which whole-cave builder runs
  at a depth. `ProfileFacade` opens the live `DungeonProfiles` registry to a
  trusted plugin, and `builder(key)` hands a core builder back so a mod can wrap
  core generation rather than reimplement it. Two refusals are deliberate: a
  profile naming an unregistered builder is rejected where the mistake is, not
  inside generation a level later; and profiles only append, because
  `choose_profile`'s weighted pass walks the list in order and inserting would
  change which profile the *base game* picks from the same seed. Proven by a
  sample mod written to a real folder and imported for real, asserting on the
  registry rather than on the mod's own report.

- **All six registry domains are now proven reachable from disk.** Effects,
  rooms, commands, monster AI, vocabulary and profiles each have a sample mod
  written to a folder and imported for real, asserting on the live registry.
  They had a bundled demo before, which proves the facade works but not that a
  mod a player installs can get to it.

- **`parity/DIVERGENCES.md`**: what this port deliberately does not match in
  4.2.6, and why - separate from what it has not got to yet.

- **"Where your characters live": the screen that says what would destroy a
  roster.** Everything this game saves is in browser storage - the roster in
  `localStorage`, the installed mods in IndexedDB - and on the desktop build that
  is just as true, because the shell serves the same bundle to a local origin. So a
  routine "clear browsing data", a disk cleaner, or a profile reset takes every
  character AND every mod at once, with no undo and, under a permanent-death rule,
  nothing to recover from. The new screen (Escape menu, or `Shift-W` on the
  character list) names the actual folder or origin, what is stored there now, the
  exact actions that would clear it, and how to export a backup.

  The character-select notice used to go SILENT once the origin was persistent,
  which is the normal desktop state - so the player with a full roster and the most
  to lose was told nothing. Persistence answers the browser's own eviction and
  nothing else; there is now always a line, and every version of it points here.

- **An exported character is not a restore point, and the game now enforces it.**
  Export/import exists so a character can move between surfaces, and the honest
  note in the format module said it could also be used to undo a death - which was
  true of a file and did not have to be true of the game. A character now carries a
  LINEAGE that survives the trip, so an import is refused when that character died
  in this roster (from a ledger that outlives the tombstone, since clearing a
  memorial is a legitimate thing to do), and refused when the copy already here has
  played at least as far. A file that IS further along takes its own slot back
  rather than becoming a second copy of itself. What this cannot police is a second
  install that never saw the death, or a hand-edited file - the same hole
  `cp save/Bilbo /tmp` has always opened in upstream Angband.

- **Installed mods are offered their updates, in both places you would look.**
  The catalogue row has said `[~] qol v0.11.0 -> v0.13.0  Enter to update` for as
  long as there have been two tags to compare - but the screen it lives on is
  called *Install a mod...*, which is not where anyone looks for something they
  already installed, and nothing else mentioned it. So a player updated the game,
  got a catalogue naming newer mods, and stayed on the old ones with no sign that
  anything had changed. The mod manager now carries the count on a row of its own
  (*Update installed mods... (3 available)*), the (U)pdate screen lists them
  beside the game update with `M` to take them, and the title-screen row shimmers
  for a waiting mod exactly as it does for a waiting build. `Update all` and the
  single-mod rows go through the same installer, digest check and summary as a
  first install.

  Which mods qualify is decided in one place (`classifyModTag`) that the
  catalogue row and the bulk action both read, because they must never disagree:
  a mod that is AHEAD of this build's catalogue - what a mod author testing their
  own release sees - is never offered as an update, since installing it would be
  a downgrade, and two tags that cannot be ordered are never guessed at.

  **Mod versions travel with the game build, and that is a deliberate limit.**
  The catalogue ships inside the build with a SHA-256 for every file, and that
  digest not having travelled over the same connection as the file is the whole
  reason downloading a mod is safe. So the check is local, instant and works
  offline - and it can never offer anything newer than the build knows. Updating
  the game is what brings newer mods within reach.

- **Three mod seams, so a mod can remember something.** A mod could already keep
  data with a CHARACTER - its save bag - and had nowhere at all to keep data
  about the PLAYER, so anything it learned died with the character. `ctx.prefs`
  is that second place, one JSON value per mod, held outside every save and
  scoped to the mod's own id. `ModHooks.optionsChanged` tells a mod when the
  player has finished changing their settings in the `=` menu (a notification,
  the first hook core does not read an answer from - folded `all-observe`, so
  every listening mod is told and none of them can overrule another).
  `ctx.newCharacter` says whether this session's character was just created or
  loaded from a save, which is the one thing a mod cannot work out for itself:
  turn 0 is not the answer, because the game autosaves the moment a character is
  born. Together they are what the QoL mod's *Remember my settings* is built
  from, and none of them names it.
- **A log, with a level chosen by the build.** A finished release logs warnings
  and errors; a `0.x` pre-release and a per-commit `edge` build log what the game
  is doing as well. The level comes from `ENGINE_VERSION` rather than from the
  update channel, because a player who installed a beta and then set their
  channel to `stable` is still running the beta - and it starts answering `warn`
  by itself at `1.0.0`, the same way the default channel starts answering
  `stable`. On desktop each launch writes a file to `<game folder>/logs`, pruned
  to the last ten; in a browser the last 2,000 lines are held in memory. It can
  be overridden per launch with `?log=debug`, or from the report screen.
- **"Report a problem", in the Escape menu.** Writes a file naming the version
  and build, the platform, the size and pixel ratio of the window, the mods you
  have enabled, your character, and the last 500 log lines - after showing you
  that list, so the decision to send it is made having read what is in it.
  **Nothing is uploaded anywhere**: it lands in `<game folder>/logs` on desktop
  and downloads in a browser, and you choose who sees it. Your home directory is
  taken out of every path on the way in, including the JSON-escaped form that
  every logged Windows path actually arrives in.

### Changed

- **The working record left the public tree.** 218 files of construction notes,
  audit ledgers and planning material moved into a private repository. What
  public code *cites* stayed - the parity ledger behind the parity claim, the
  accounting those citations resolve to, and the machinery guards actually
  execute - because a comment citing a document the reader has is provenance,
  and the same comment citing nothing is an excuse. `docs/WORKING_RECORD.md`
  says which citations lead where and what they concluded.

- **`reference/` is the 4.2.6 tag, and something checks that it is.** The vendored
  upstream tree had drifted onto master; it is back on the official baseline with
  a guard, and four unowned Windows binaries are gone from the public tree.

- **The tiles the game serves are 4.2.6's, and are stored once.** The served tree
  had been built from upstream master, and twenty megabytes of tiles were
  committed twice; the served copy is now generated.


- **An imported mod zip is moved aside, not deleted.** It used to be unlinked once
  the mod was in storage, which is tidy and wrong: the zip is the player's copy of
  somebody else's work, and making the game's copy the only one leaves a player
  with nothing to go back to when a mod turns out to be broken. It now moves into
  `mods/imported/`, numbered rather than overwriting so importing v2 cannot destroy
  the archived v1, and the screen names where it went. The folder is skipped when
  the shell lists mod folders, so it never appears in the mod list as an empty pack.

- **Every mod is listed with its author: `Neo Linoleum (neostryder)`.** Who wrote a
  mod is the most useful single fact about a third-party one, and it used to be a
  line in a detail pane you had to open per row. It comes from the MANIFEST, never
  from the author register - the register is a standing this project has looked at,
  and the two must not be able to be read as each other. Where a row cannot fit
  both, the author is dropped whole rather than truncated: `Bug Fixes (neost...`
  attributes a mod to an account that does not exist.

- **A host directory is created on its first write, not at startup.** `save/`,
  `panic/` and `scores/` sat empty in every game folder for the life of an install,
  because the port creates all five `ANGBAND_DIR_*` at launch exactly as
  `init.c:411` does. Upstream carries the answer as its own comment - *"ToDo: Only
  create the directories when actually writing files"* - and that is now what
  happens. It is not a behaviour divergence: no caller can tell an absent directory
  from an empty one, since every reader already answers for a directory that is not
  there. The desktop shell's startup writability check is unaffected, so upstream's
  quit-rather-than-run-on behaviour is still in place.

- **Updates unpack in-process, with no external program on Windows or Linux.**
  The updater used to hand the archive to `tar`, and PATH does not promise which
  tar that is - a POSIX-style shell (Git Bash, MSYS2, Cygwin) puts GNU tar first,
  which cannot read zip at all and treats any `C:\...` path as a remote host.
  Pinning System32's copy fixed that instance and left the shape of it: a game
  depending on a program it does not ship, resolved on a machine nobody here can
  inspect. It now reads zip and tar.gz itself using `node:zlib`, which is inside
  the runtime Electron already is - handling symlinks, unix mode bits, the ustar
  prefix, and refusing a path or a link that leaves the staging folder. Verified
  against the real 0.16.0 artifacts: the Windows `.zip` and the Linux `.tar.gz`
  each extract **byte-for-byte identically to bsdtar** across 77 entries,
  including a 215 MB member streamed through inflate without buffering.
  **macOS still uses `/usr/bin/ditto`** - part of the OS, not something a player
  installs - because nobody on this project has a Mac to confirm the resulting
  bundle still launches. The swap script still needs a shell to outlive the
  process it is replacing; `powershell.exe` is now named absolutely, since that
  was the same PATH lookup one function below the one that was fixed.
- **The web build knows whether it is stale, instead of guessing.** The
  `(U)pdate` row used to appear only when a service worker took control, which is
  a different question: a worker can claim a page without the build changing, and
  a build can change without a page that stays open ever hearing about it. Each
  build now stamps an id into the bundle and writes the same id to
  `build-id.json`, which the page fetches with `cache: "no-store"` - so "the code
  running here is not the code the site is serving" is a string comparison. The
  file is kept out of the service worker's precache, because a cached freshness
  check answers with the stale build's own id and reports up-to-date forever. The
  page re-asks on a timer, when the tab comes back, and when the network returns,
  and taking the update asks the worker to fetch and activate before reloading -
  a bare reload was served the old build out of the worker's own cache.

Everything below came out of one play session on the 0.15.3 build.

- **The terminal paints what changed, not the screen.** Every drawing call used
  to hit the canvas immediately, so one move of the player cost **1,469 cell
  paints** - a `fillRect` and a `drawImage` each - plus a full-canvas fill, for
  an 80x24 grid that had changed in about a dozen places. Angband is turn-based,
  so that landed on every keypress. The grid is now diffed against what is
  actually on the canvas and flushed once at the end of the task: the same twenty
  moves cost **140 cell paints** and no full-canvas fill, a **3.4 ms median with
  a 12.4 ms tail down to 1.7 ms and 2.2 ms** (measured in a browser through
  `__neo.paints()`; `term-overdraw.test.ts` gates it). The canvas also asks for
  `alpha: false` now, which lets the compositor skip blending it.
- **The knowledge browser is upstream's two-pane screen** - Group on the left,
  Name on the right, a `|` between them and a `=` rule above (`display_knowledge`,
  ui-knowledge.c L1050-1240). The port had been flattening every group into one
  lettered list, which for known objects is several hundred rows: the alphabet ran
  out at the fifty-second and the rest could not be picked at all. Upstream letters
  **nothing** on this screen - both its menus are built from iters whose `get_tag`
  is NULL - because choosing a group first is what keeps the member list short.
- **The book and spell pickers draw over the map** instead of blanking it, in the
  right-aligned box `item_menu` uses (ui-object.c L1198-1215) and the spell menu's
  own region (ui-spell.c:229). Casting a spell used to clear the terminal, so the
  monster you were casting at disappeared while you chose.
- **ESC goes back one level.** The game menu is a loop now: closing Mods, Options,
  Knowledge or any other screen it opened returns to the menu you opened it from
  rather than dropping you into the dungeon. Its cursor also stays where you left
  it, for the session.
- **Lists wrap at both ends.** Down on the last row lands on the first and up on
  the first lands on the last, which is what `menu_handle_keypress`'s
  `is_valid_row` loop does upstream and what the port had been missing - on a list
  taller than the screen the only way back to the top was to hold a key.
- **Space turns a mod on or off** from the list, on the row under the cursor, and
  the cursor follows the mod it just moved (the catalogue sorts enabled-first, so
  toggling one reorders the list under you). Space is the same shortcut in a mod's
  *Fixes & tweaks* and *Parts of this mod* screens.
- **Installing a mod offers to enable it** in the same action, with the consent
  prompt and the non-scoring warning still in the way. The mod also appears in the
  list immediately: the sources are re-read after a download, where before a
  freshly installed mod was invisible until a reload nobody had asked for yet.
- The four first-party mods' descriptions are rewritten as short paragraphs.
  neo-linoleum's was 1,625 characters in one block.
- The macOS instructions are the ones that work. *Right-click -> Open* was the
  standard answer for a decade and Apple removed the bypass in **macOS 15
  Sequoia**; the route is System Settings -> Privacy & Security -> **Open Anyway**,
  and it only appears after a blocked launch. Asserted in `packaging.test.ts`
  against all three places that carry it.

### Fixed

Six days of parity work against the 4.2.6 golden master turned up defects a
player could feel. The ones worth naming:

- **Free Action did not stop a paralysing breath.** The flag was checked on the
  melee path and not on the breath path.

- **A resisted breath said nothing, while the same flag resisted in melee said
  everything.** Two paths, one rule, and only one of them told you.

- **A Wand of Polymorph did nothing at all.**

- **Banishing a monster destroyed the artifact it was carrying**, and **a store
  could quietly destroy the artifact you sold it.** Both are unrecoverable in a
  permadeath game.

- **A decoy did not stop a bolt**, which is the one thing a decoy is for.

- **A cursed bow's to-hit penalty never reached the shot.**

- **A monster draining another monster drained the player instead.**

- **Streamers were destroying secret doors on every classic level.**

- **Word of Recall could send you to level 1 by accident.**

- **Phase Door worked inside single combat** - the one place it must not.

- **Persistent levels crashed roughly one descent in eight.**

- **Auto-ignore judged an item by stats the player could not see**, and the
  ignore menus listed every ego and kind in the game rather than the ones you
  had met.

- **Remove Curse read the curses you *had*, not the ones you knew about**, and a
  **store bought on runes the player had never learned.** Both leaked knowledge
  the character has not earned.

- **The look scan stopped on a grid holding nothing but ignored junk.**

- **The targeting preview drew walls the player had never seen.**

- **A mimic keeps its object now, and loses it when it dies.**

- **Eight things you could watch a monster do and learn nothing from**, and a
  bear that never taught you it hits harder: monster lore was not being recorded
  from what happened in front of you.

- **Every blow in the monster spoiler claimed a 0% chance to land**, and the
  spoiler files were generated with no player at all - so "how many have you
  killed" was always zero.

- **A short screen dropped the depth and kept the class**, and the birth screens
  advertised a help key they then ate.

- **"Killed by a kobold", not "Killed by kobold."**

- **A monster told to drop something had nothing to drop.**


- **A ghost of the previous screen survived every full-screen change.** Cell
  metrics are whole CSS pixels and the canvas carries `setTransform(dpr, ...)`,
  so on a fractional device-pixel ratio a cell's edge landed part-way through a
  device pixel. Repainting the cell covered only part of that pixel and the
  renderer repaints only cells that changed, so the neighbour owning the other
  half was never touched and the stale half survived indefinitely. Title screen
  to update page and back left 118,452 differing pixels against a clean paint of
  the same screen - 1.43% of the canvas, in a lattice of cell outlines, with a
  measured seam pitch of 47.24 and 71.55 device pixels. Cell edges are now
  rounded to whole device pixels, which also makes neighbours tile exactly;
  snapping outward instead would have erased the residue by letting every cell
  overwrite a pixel of each neighbour. No extra cells are painted, so the
  overdraw budget is untouched. Invisible at a ratio of 1 or 2, which is why
  every earlier test missed it.
- **A missing extractor reported `spawn ditto ENOENT`.** The update screen prints
  that string verbatim, so it named nothing the player could act on. It now says
  which tool is missing and what it was needed for. Only macOS can still reach
  it - see *Updates unpack in-process* above.
- **A hybrid mod appeared twice in the manager.** `qol` and `bug-fixes` declare
  `facets: ["content", "plugin"]`, so each is listed once by the content discovery
  and once by the plugin discovery - both correct, neither aware of the other, and
  nothing joined them back up. Install all four mods and the list showed six rows.
  `buildCatalog` now merges by id, keeping the most privileged kind so a mod that
  runs code is not labelled "(content)".
- **A long mod description could take the whole screen.** The detail pane was
  sized from its own content with the list floored at ONE row, so neo-linoleum's
  own screen rendered as a title, *Disable*, and thirty lines of prose - with no
  way to reach *Move earlier*, *Move later* or *Back*, and no way to scroll the
  prose either. The pane is capped now, says so when it cuts, and a *Read the full
  description* row opens the whole thing in a viewer that scrolls.
- **A paragraph break in a mod's description painted as two solid blocks.** The
  word-wrap behind the detail pane broke on the space character and treated
  everything else as ordinary text, so a newline was carried into the output line
  and the terminal - which has no glyph for U+000A - drew it as a filled cell.
  `qol`'s manifest has a real blank line between its two paragraphs, so its row
  read "are not touched here." followed by two blocks and then "Enable it and you
  get...", and it has looked that way since **0.16.0**, when that description
  landed. A description is written by the MOD AUTHOR, so "do not put newlines in
  it" was never an answer available to the game. `wrapCssRuns` splits the run
  stream on newlines first now and wraps each paragraph on its own, emitting an
  empty line where the break was; `\r\n` and a lone `\r` are the same break, so a
  manifest written on Windows cannot leave a stray carriage return behind either.
  The store help legend is the only other caller and has no newlines in it at all,
  so nothing there changes.
- **The macOS bundle was never sealed.** With no Apple Developer identity,
  electron-builder skips signing and says so in its own log ("skipped macOS
  application code signing"). Measured against the artifacts rather than
  inferred: the **0.15.3** arm64 zip contains **zero `_CodeSignature` seals** - no
  `Contents/_CodeSignature/CodeResources` on the app, and none on any of its four
  helper executables (GPU, Renderer, Plugin, and the plain helper), each of which
  is a separate binary macOS wants signed. The 0.16.0 zip has nine. Apple Silicon
  refuses an arm64 binary that is not validly signed and reports it as *"is
  damaged and can't be opened"*. The bundle is ad-hoc signed and verified after
  packaging now (`codesign --deep --sign -`, confirmed in the release log for
  both architectures). **This is a launch defect, not the cause of the
  slow-on-an-M4 report.** It was first written up as one - an app that reads as a
  bad download pushes people onto the Intel build and Rosetta 2, so a signing
  fault surfaces as a speed complaint - and that chain needs Rosetta 2 to exist.
  It is being withdrawn: macOS 27 deletes it during installation and macOS 28
  keeps it only for a named set of old games. A Mac without Rosetta cannot run
  the Intel build slowly, so the slowness was the arm64 build running natively,
  and the overdraw fix above is what addresses it.
- **A macOS download says which Mac it is for.** The release page carried
  `Neo.Angband-0.16.0-arm64.dmg` and `Neo.Angband-0.16.0.dmg`, and the second one
  is the **Intel** build: electron-builder's default artifact name interpolates
  the architecture only when it is not x64, so the Intel file is the unlabelled
  one. Next to an explicitly-labelled arm64 file that reads as "the normal one",
  or as universal - there is no universal build - and with Rosetta 2 being
  withdrawn it is the file that will not launch. All four macOS artifacts now
  carry their architecture (`-arm64-mac` / `-x64-mac`), and `mac.artifactName`
  is asserted to contain `${arch}`.
- **An 0.x release is published as a pre-release.** The workflow has always
  created a draft, and that is a statement about who has pressed publish, not
  about the software. Publishing an 0.x tag without `--prerelease` marks it
  *Latest release*, which is what the repository sidebar, the API and every
  "download the latest" link follow - so an alpha would present as the stable
  build. The flag is conditional on a `0.` prefix and stops applying at 1.0.0.
- **`compareSemver` ordered numeric prerelease identifiers as text, so
  `1.0.0-edge.9` outranked `1.0.0-edge.10`.** It was a *documented* limitation -
  the header said pack authors needing exact prerelease ordering should not rely
  on it - and that was honest while nothing did. The `early` channel names builds
  `-edge.<n>`, so the tenth build of a day would never have been offered to
  anyone running the ninth: the game would have reported itself up to date
  indefinitely, and the symptom would have looked like a broken update check
  rather than a comparator. Implemented to the spec now (semver item 11.4):
  dot-separated identifiers, numeric compared numerically and ranking below
  alphanumeric, a longer list beating its own prefix. The spec's own example
  chain is asserted, and *sorted* as well as compared pairwise - a
  non-transitive comparator passes every adjacent pair.
- Toggling anything in the mod manager no longer throws the cursor back to the top
  of the list.

### Removed

- **1,442 tags.** This repository's history descends from Angband's, so every
  upstream tag - `2.0alpha`, `4.2.6`, and 1,400-odd `4.2.1-190-g5c16b9e7`
  development tags - was a real ancestor of `master` and had been pushed along
  with it, burying the release tags among fifteen hundred. The tag list is the
  release list now. They remain in upstream Angband and in a backup taken first;
  `docs/RELEASING.md` says why `git push --tags` must never be run here.

### Added

- **Three update channels, chosen with `C` on the update screen.** `stable` is
  finished releases, `beta` adds pre-releases - which is every `0.x` version
  this project has - and `early` is a build of every commit on master, published
  by CI within minutes of a push. They are inclusive downward, so a player on
  beta is still offered `1.0.0` when it ships.
  - **There is no `draft` channel, and there cannot be one.** GitHub hides draft
    releases from unauthenticated callers, so a player's game cannot see one at
    all; the only way to change that would be to ship a credential inside the
    game. A draft is a staging area, and `beta` is the published-but-not-final
    state GitHub actually provides.
  - While the engine is `0.x`, `stable` selects nothing - every release is
    flagged pre-release - so new installs start on `beta` and switch to
    `stable` on their own at `1.0.0`. A default of `stable` today would mean a
    fresh install never offers an update and never says why.
  - `early` builds are tagged `v<next-patch>-edge.<run>`, which sorts above the
    last release and below the next one. **The patch has to be bumped before the
    suffix**: a prerelease sorts *below* its own triple, so `0.16.0-edge.1`
    would be older than the `0.16.0` already installed and would never be
    offered. Only one edge release exists at a time; the previous one is deleted,
    tag and all, once its replacement is up.
  - Leaving `early` means going backwards to the slower channel's newest build.
    The screen calls that a move rather than an update, because "0.16.0 is
    available" shown to someone running `0.16.1-edge.9` reads as a bug.
  - The **(U)pdate row is now always present on the desktop**, and shimmers only
    when a build is actually waiting. It previously appeared only when there was
    something to install, reasoned as "a dead row would say an update might
    arrive at any moment". On the desktop both halves of that turned out false:
    an update can arrive at any moment, since the game asks at every launch, and
    the row is the only door to the channel setting - so hiding it left the
    setting reachable only in the moments changing it mattered least.
- **The game updates itself, from a shimmering row on the title screen.** When a
  newer version has been published, the title screen grows a **(U)pdate** row
  that cycles colour the way an `RF_ATTR_MULTI` monster does - the same
  `randint1(BASIC_COLORS - 1)` on the same 250 ms tick, from a display-only RNG
  so a splash left open cannot perturb the game's. Pressing `U` downloads the
  archive for this machine, checks its SHA-256 against the digest GitHub
  published for that asset, and swaps it in on restart.
  - **electron-builder's own updater could not have done this.** It has no
    support for the `portable` target and hands macOS to Squirrel.Mac, which
    validates the code signature - so the supported library would have covered
    NSIS and AppImage users and nobody else: not the folder install these docs
    recommend, and no Mac, since this project ad-hoc signs. Swapping a directory
    needs neither, and it is one path on all three platforms.
  - **The order is the safety property.** Outgoing files are moved aside, the new
    ones are moved in, and only then is the old copy deleted - by a script that
    outlives the app, because a program cannot replace its own running
    executable. `neo-angband-data` is never moved on any path. A real swap of
    real files, including the rollback, is asserted in
    `update-swap.integration.test.ts` rather than inferred from the script text.
  - **A single-file portable launch says so instead of lying.** `portable.exe`
    and an AppImage unpack to a temp folder, so swapping it would show a progress
    bar, restart, and change nothing. Those - and a read-only install - are
    offered the download instead.
  - Nothing is trusted: the download host must be this repository's own release
    assets, an archive with no digest is refused rather than installed, and the
    renderer names an operation, never a path to swap in.
- **The browser stops reloading itself out from under you.** A newly deployed
  build used to take over the moment it arrived, defended on the grounds that
  play is autosaved. That is true and beside the point: mid-fight it is a screen
  flash, a lost message log and a resumed turn nobody asked for. The reload still
  happens silently at the title screen, where it is invisible; anywhere else it
  waits behind the same (U)pdate row.
- **A save is converted forward, never rejected.** Every version of the save
  format below the current one now has a conversion step
  (`packages/core/src/session/save-migrate.ts`), and `saveMigrationsAreComplete()`
  fails the build if `SAVE_VERSION` is raised without one. This closes the
  highest-cost defect in the game: `loadGame` used to throw on any version
  mismatch, the web boot caught it with a bare `catch`, and a player whose
  character was completely intact was told *"Could not read the save; starting a
  new game"* - then the throwaway game it started autosaved over the slot it had
  just failed to read. A save from a **newer** build now says so and asks you to
  update (`SaveFromFutureError`), and a save that cannot be opened for any
  reason is left byte-for-byte alone. Proved by round trip: a real save is
  walked backwards into the version-1 and version-2 shapes and migrated forward
  again, and the result must equal what it started as.
- **Downloadable builds.** A tag now builds the desktop app for Windows, macOS
  and Linux and attaches them, plus the static site as a zip, to a draft GitHub
  Release with notes cut from this file (`.github/workflows/release.yml`,
  `tools/changelog-section.mjs`). Before this, a tag published three npm
  packages and nothing a player could run; the only install path was
  `git clone && pnpm install`, which is a developer preview rather than a public
  alpha. The builds are not code-signed and every release page says so.
- **A crash says what happened instead of going black.** `bootGame()` runs at
  module top level and the whole UI is `await`ed menus, so a throw during boot
  or a rejected promise in any menu left a canvas that never painted - with the
  explanation in a console the player does not have open. A DOM overlay
  (`packages/web/src/crash-screen.ts`) now catches `error` and
  `unhandledrejection`, leads with the fact that saved characters were not
  touched, and offers the stack as one copyable block with the version in it.
  The desktop shell covers the three cases the page cannot: a dead renderer
  process, a wedged one, and a failed load.
- **The engine is no longer exempt from its own containment rule.** A mod hook
  throwing mid-turn was caught, named and stopped the session saving; a *port
  bug* throwing mid-turn did none of that. What protected the save was the
  accident of the exception unwinding past the tail autosave - and `S`, a level
  change and pagehide all write too, so a player who hit a bug and pressed S to
  be safe wrote the half-finished turn over their character. `runGameLoop` is
  now wrapped, and a core fault taints the session exactly as a mod fault does,
  with a notice worded for a bug in the game rather than one in a mod.
- **Issue templates, and a way to reach a person.** Four forms (a parity
  difference, a bug, the mod system, an idea) that ask for the version, the
  surface and the enabled mods, so a report does not cost a round trip to
  become actionable. `config.yml` points at the RPGM Tools Discord for anything
  that is a question rather than a report, and at the right repository for a
  bug in a specific mod. Plus `SECURITY.md` and a PR template.
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

### Fixed

- **The Linux build could not name its own executable.** The first run of the
  release workflow built Windows and macOS and failed on Linux with
  *"executableName contains characters that cannot be safely used in file
  paths: @rpgm-toolsneo-angband-desktop"* - electron-builder derives that name
  from the package `name`, and ours is scoped. Windows and macOS take theirs
  from `productName`, which is exactly why nobody found it: two thirds of the
  matrix went green and the draft release looked plausible until you counted the
  files in it. `linux.executableName` is set now.

  The fix for that shipped broken, and the second failure is the more
  instructive one. It used `desktopName` and `synchronizeDesktopName`, neither
  of which exists - the option is `syncDesktopName` - and `LinuxConfiguration`
  sets `additionalProperties: false`, so electron-builder rejected the whole
  configuration. It validates the entire object on **every** platform, so a bad
  key under `linux` failed Windows and macOS too: the first attempt built two
  platforms of three, the second built none.

  The test written to prevent exactly this asserted `linux.desktopName` was
  truthy, and passed - the config and the test were written in the same minute
  by the same hand with the same wrong key, so the test agreed with its author
  instead of with the tool. `packages/desktop/src/packaging.test.ts` now
  validates the config against **electron-builder's own `scheme.json`**, which
  ships inside the package being configured and moves when it moves.

  Then a third: with the schema satisfied, the Linux job reached
  `FpmTarget.checkOptions()` and stopped on *"Please specify project
  homepage"* - the `.deb` target wants packaging metadata no other target asks
  for. Three tags to find three problems in one config file, each one hidden
  behind the last, is what a build configuration costs when the only thing that
  exercises it is a release. The requirements are now read off
  `computeFpmMetaInfoOptions()` and checked together, and the whole thing was
  verified by running electron-builder locally until it got past every gate -
  which is what should have happened before the first tag.

### Changed

- **The game itself says where to get help.** A fourth page under `?`:
  the version you are running, the Discord, the issue tracker, the contact
  address, what makes a report useful, and the promise that saves survive an
  update. Every one of those lived only in a README that a player who
  downloaded a build has never opened, and `?` is where someone goes when they
  are stuck.
- **The mods screen speaks English, and fits.** The row for a mod was built by
  concatenation and then SLICED at column 80 by the menu, so a mod called "Bug
  Fixes (unofficial patch set)" with both save ratchets set built an 85-column
  row and what a player saw was the name, the version, the kind, and none of the
  three warnings. The name is elided now and every badge survives; `NOT WORKING`
  is the only badge on a broken row, because a mod that is not running is not
  affecting this game's determinism either. `mod-viewport.test.ts` measures this
  by painting the real manager at 80 columns and at 400 and requiring the rows to
  be identical, so the failure names the string and how much of it was lost -
  which is not something a `length <= 76` assertion in a test can do without
  every caller remembering the three columns the row tag takes.

  The wording went with it: "Requests 2 capability(ies)" is nobody's English,
  and "Non-deterministic: enabling this permanently marks the save
  non-reproducible" is three pieces of jargon about a decision the next keypress
  makes. They are now "Asks for 2 permissions" and "Permanent once on: the same
  seed stops giving the same game."
- **A mod you turned on and then uninstalled gets a row saying so.** It used to
  print `enabled mod "x" not found; skipping` to the console on every launch and
  show an empty mod list - reproducible by reinstalling the game over a profile
  that had mods enabled, which is what an updating alpha tester does. The row
  offers the one useful action.
- **The action rows on the mods screen stopped moving.** They were lettered
  positionally, so installing a mod shifted every one of them down and the key
  that meant *Install a mod...* yesterday meant *Auto-sort* today. They carry
  fixed digit tags now, the way upstream pins the rows that must stay put
  (`option_actions[]`, `ui-options.c`). *Install a mod...* is also the first
  action rather than the fourth: the list above it is empty on a fresh install,
  so the row under an empty list should be the one that ends the emptiness.
- **The parity claim is back, with its asterisk.** README states it again
  because it is now measured at full power: 1000 levels per depth from the port
  against 1000 from the real compiled C, depths 1-20, 82 hypothesis tests
  Bonferroni-corrected at alpha = 0.01 - and on both level-feeling metrics the
  port sits closer to the C than two runs of the C sit to each other. The
  asterisk is load-bearing and states three things: **with no mods enabled**, not
  bit-exact, and the monster species mix is measured and *not* gated because the
  G-test rejects the port against itself at p = 2e-97 on pit-clustered counts.
  `docs/PARITY.md` carries the table.
- **`pnpm c:parity` stopped reporting a verdict it cannot reach.** It compared
  means against a fixed band at 30 runs and printed `parity: FAIL` with 119
  diffs - a number that is an artefact of the instrument, on an instrument whose
  own replacement documents why it cannot separate a real divergence from an
  under-sampled one. It is now framed as the diagnostic it is, and names the
  command that actually decides.
- **`dist-desktop/` is emptied before it is filled**, so the folder holds the
  build you just made rather than every build you have ever made. A
  `Neo Angband-0.1.0-portable.exe` from July had been sitting beside the current
  one for a month, indistinguishable in a file listing except by a version
  number nobody reads before double-clicking.
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
