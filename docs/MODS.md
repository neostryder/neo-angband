# The Mod System

> **To make a mod, [start with the tutorials](modding/tutorials/README.md).** There are seven short ones, and the first is two files. The design reference follows.

> This describes the target design of the mod system. Most of it, including the matrix below, says in the present tense what mods are meant to be able to do, and does not mark which rows are built. For the current state, with counts and `file:line` citations, read **`docs/modding/MOD_REACH.md`**, or the [summary table](modding/README.md#surface-status-complete-wip-not-yet) that a test checks against it; both say plainly what is missing.
>
> Two limits this notice used to name are now closed. Record layering once reached 24 of 44 record files and now reaches every record of every shipped file except `history`. Code seams were once reachable only by a mod compiled into the web bundle, and a mod folder now ships `plugin.js` and reaches them from wherever it was installed. `docs/modding/MOD_SEAMS.md` documents the behaviour seam.

Neo Angband is built to be modded: the base game is itself a pack, loaded through the same pipeline as any third-party mod. Every aspect of the game is open to mods, including capabilities that do not exist in the base game's resources.

## Getting a mod, in one paragraph

Press `Escape`, choose **Mods**, choose **Recommended mods...**, pick one, then choose **Install and enable**. The game fetches the mod from its own repository at a release tag, picking the newest release this build can run, which is not always the newest release there is. It checks the mod against the requirements every mod has to meet and records a digest of every byte that arrived, so it can tell you later whether the copy on your machine has changed. Then choose the reload it offers. That is all: you need no folder, account or extra tool.

The recommended list holds only repository addresses. Names, versions, descriptions and compatibility all come from each mod when the screen opens, so a mod can release an update without waiting for a new version of the game, and the game makes no claims of its own about what a mod contains.

You are not always offered a mod's newest release. A mod that ships code declares which builds of the game it was written for, and the game refuses a release outside that range instead of loading it ([modding/MOD_COMPATIBILITY.md](modding/MOD_COMPATIBILITY.md) explains why). The screen therefore looks back through up to eight of the mod's earlier releases and offers the newest one this build will run. When it skips a newer release, it tells you which one and why, and it suggests updating the game only when that would get you the newer release. If none of the releases it tried will run, the mod is refused and the screen says how many releases it checked. **Update installed mods** works the same way: it never offers an update this build would refuse to load, and a mod already on the newest release your game can run is shown as current rather than out of date.

Three more ways to add a mod are on the same screen, all behind **Allow third-party mods**:

- **Add from a registry address** - a list someone else maintains, in the same format.
- **Add from a repository address** - one mod, by `owner/repo` or a GitHub URL. A URL naming a tag (`github.com/owner/repo/tree/v1.2.0`) pins that version: the game installs exactly that version without looking for a nearer one, and refuses it rather than substituting another if it will not run here.
- **Import a mod from a file** - a `.zip`, either one you choose or one you have dropped into the game's own `mods/` folder, which the screen lists for you. The archive must hold one mod, with its `manifest.json` at the top of the zip or inside a single top-level folder, which is the layout GitHub's *Download ZIP* produces. The game looks no deeper than that, and refuses a zip holding two mods. After the install, a zip imported from the `mods/` folder is moved into `mods/imported/` and kept there, since it is your copy of someone else's download. A zip you picked from anywhere else stays where it was. The game never opens zips at startup; importing is something you do once, from this screen.

An imported mod keeps the `repository` its own manifest declares, so **Update
installed mods** has somewhere to ask about it. Importing a newer zip works too.

Two other routes exist and neither is the normal one. **A folder**: point the
game at a directory of mods (Chrome and Edge, or the desktop build's own
`mods/` folder) - this is how you work on a mod you are writing, and how an
external manager like Vortex or MO2 deploys into it. **A URL parameter**:
`?mods=qol,linoleum` overrides the enabled set for one session without
touching what is saved.

### Where each mod lives

Every first-party mod is a separate repository with its own issues, releases and
tests - file a bug about what a mod *does* there, and a bug about the mod
*system* against the game.

| Mod | Repository | What it is |
| --- | --- | --- |
| `qol` | [neo-angband-mod-qol](https://github.com/neostryder/neo-angband-mod-qol) | New conveniences ([docs](modding/QOL.md)). Angband's own `=` options are not part of it; they ship in core at their upstream defaults. |
| `bug-fixes` | [neo-angband-mod-bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes) | An unofficial patch set for upstream bugs core deliberately keeps ([docs](modding/BUG_FIXES.md)). |
| `linoleum` | [neo-angband-mod-linoleum](https://github.com/neostryder/neo-angband-mod-linoleum) | A second tile engine - loose packs of individually named PNGs - plus all six upstream tile sets converted to it: 9161 files of art that belongs to the mod. Not the source of the game's own tiles, which are core content ([docs](LINOLEUM.md)). |
| `borg` | [neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg) | Angband's automatic player, ported onto the agent API ([docs](BORG_AS_MOD.md)). |
| `feature-restoration` | [neo-angband-mod-feature-restoration](https://github.com/neostryder/neo-angband-mod-feature-restoration) | Mechanics later versions of Angband dropped, brought back one switch at a time, every switch off by default ([docs](modding/FEATURE_RESTORATION.md)). |
| `forge` | [neo-angband-mod-forge](https://github.com/neostryder/neo-angband-mod-forge) | An in-game workshop for building a mod from something that already exists - a monster, an item, a shop, a spell - without ever having to know it is JSON ([docs](https://github.com/neostryder/neo-angband-mod-forge#readme)). |
| `upstream-catchup` | [neo-angband-mod-upstream-catchup](https://github.com/neostryder/neo-angband-mod-upstream-catchup) | Changes upstream Angband accepted after the `4.2.6` tag core is pinned to, each cited by commit, every class of them off by default. A rebaseline onto a newer upstream tag makes every row in it redundant, and the mod is meant to expire then ([scope](modding/UPSTREAM_CATCHUP_MOD_SCOPE.md)). |
| `squire` | [neo-angband-mod-squire](https://github.com/neostryder/neo-angband-mod-squire) | An alternative autoplayer that runs one errand and hands the keyboard back, rather than playing the character for you. Each mission stops on its own terms - the target falls, a new creature appears, damage lands - and returns control immediately ([docs](https://github.com/neostryder/neo-angband-mod-squire#readme)). |

### Writing one

**[Start with the tutorials](modding/tutorials/README.md)** - seven short ones,
each teaching a single idea, the first of which is two files and about twenty
lines. They are the on-ramp; everything below is reference.

A mod is a folder with a `manifest.json`, and everything else is optional: data files to add or patch records, PNGs for a tile pack, or a single `plugin.js` for code. [modding/PLUGINS.md](modding/PLUGINS.md) covers the plugin ABI, and [modding/MOD_COMPATIBILITY.md](modding/MOD_COMPATIBILITY.md) covers what the engine promises your mod across releases.

## What is core, and what is a mod

The line between the two is sharp:

- **Core** contains two things only: faithful vanilla Angband, and the mod architecture itself (the registries, composition engine, sandbox, save namespacing and SDK described below).
- **Everything new is a mod.** Any feature, behavior or visual beyond parity, including the beyond-parity systems below and all UI-level quality-of-life, ships as a mod rather than in the port. Core provides the extension seams as part of the mod architecture, and mods provide the features built on them.
- **No mod ships with the game.** A fresh install is vanilla Angband. Each first-party mod lives in its own repository with its own release tags and tests, and arrives through the mod manager's *Install a mod...* row, using the same route, pinned origin and recorded digests as a third-party mod. See [Where each mod lives](#where-each-mod-lives) below.

  Keeping first-party mods out of the build is what tests the seams. If the project's own mods took a private path into the build, every defect in the install path would stay hidden behind mods that never used it. With nothing bundled, the download route, the folder code loader and the plugin ABI all have to work.
- **Cheaty mods are allowed.** A mod may add, patch, replace or remove anything, up to the rules that make the game Angband or a roguelike at all. The engine warns and labels (for example, by marking a save's profile non-reproducible) but never forbids. What players do to their own game is up to them.

## The moddable-surface matrix

The matrix sets out what mods should be able to do with each surface. "Add" means new records, "patch/replace" means overriding base records, and "extend" means introducing new behavior or record types.

Rows such as NPCs and dialogs, Quests and Networking describe what a mod can build, and core has no module for any of them. Core provides only the generic extension surface (command queue, event bus, string-keyed registries, the sandboxed plugin API, save namespaces, render hooks), and a mod builds an NPC, dialog, quest or networking system on top of it. The only related pieces in core are the upstream parity ones, the vanilla town with its shops and the win condition, and they are built on these same surfaces so mods can overhaul them.

> The matrix is the target. Today the "Add" column holds for 41 of the 44 record files and "Patch/replace" for 43 of 44, and the "Extend" column reaches eighteen capability-gated registries from a mod installed from disk or from a repository, as well as from one compiled into the web bundle. `docs/modding/MOD_REACH.md` lists, row by row with citations, what is still missing and which rows are thinner than they look, and its figures are the current ones.

| Surface | Add | Patch/replace | Extend |
|---|---|---|---|
| Terrain types | yes | yes | new terrain flags + handlers |
| Room templates and vaults | yes | yes | new room builders (scripted) |
| Dungeon generation profiles | yes | yes | new level generators |
| Objects, egos, artifacts | yes | yes | new object properties |
| Monsters and monster bases | yes | yes | new blow methods/effects, new AI hooks |
| Player races, classes, abilities | yes | yes | new ability mechanics |
| Effects | yes | yes | NEW effect opcodes registered at runtime |
| Commands and keymaps | yes | yes | new commands with energy/repeat rules |
| Shops | yes | yes | new services, pricing models, stock rules |
| NPCs and dialogs | yes | yes | new interaction verbs, dialog conditions |
| Quests | yes | yes | new trigger/objective/reward types |
| Messages, colors, UI panels | yes | yes | new panel types (scripted) |
| Tiles and glyphs | yes | yes | Linoleum packs, new render layers |
| Sounds | yes | yes | new sound events |
| Game constants (z_info) | n/a | yes | new constants namespaced per pack |
| Networking sessions | n/a | n/a | plugin transports and modes |

The design rules that keep the matrix true, each followed by its current state:

- Every registry accepts runtime registration and is keyed by namespaced string IDs rather than closed enums, and upstream's compiled dispatch tables (effects, commands) are ported as open handler registries. *Current state: this holds for effects and their descriptions, room builders, player commands, dungeon profiles, monster blow effects, monster turns, store behaviour, projections, glyphs, runes, tvals, randarts, messages, menus, UI entries, tiles and the mod vocabulary, eighteen capability-gated registries in all (`REGISTRY_CAPABILITIES`, `packages/core/src/mod/registry-host.ts`). It does not yet hold for the generated `as const` tables, and the census has never seen a dispatch with fewer than eight cases. `docs/modding/MOD_REACH.md` has the counts per registry.*
- New record types are supported: a pack may declare its own schemas, and scripted plugins may register loaders for them. The engine treats the base game's record types as pack-zero declarations rather than special cases. *Current state: the type list is open (any `*.json` stem composes), and core is pack zero with no special casing. Record checking runs on the load path as well as in the author's tool: `checkRecords` over `RECORD_BLUEPRINTS` works out what a record needs from core's own shipped data (`packages/mod-sdk/src/validate.ts`). It reports problems and never refuses a record, because the blueprint describes core's data rather than a closed schema, and a mod adding a new tval is doing something legal. A pack cannot yet declare a schema of its own for a record type it invents.*
- The base game must consume every surface through the same public API mods use. If core needs a private hook, the hook becomes public API instead. *Current state: this is enforced by structure. The first-party mods are built outside this repository against the published `@rpgm-tools/neo-angband-core`, so a private hook would fail to resolve. The plugin builder refuses any non-relative import, so a mod cannot reach the engine by name either and receives it as `ctx.core`.*

## Pack shapes

1. **Content packs** - declarative, schema-validated JSON: monsters, items, races, classes, effects, vaults, generation profiles, objectives. A pack that validates cannot corrupt the engine, which also makes content packs the intended route for AI-generated content: the output is data to validate rather than code to trust.
2. **Tile packs** - the Linoleum model, first-class: a manifest, individual image files (not tilesheets), exact named targets (`target:monster:core:farmer-maggot:asset:farmer_maggot_0`), optional family metadata and multi-resolution trees. A target with no tile renders as its glyph, never as silently substituted art.
3. **Scripted plugins** - for behavior that declarations cannot express. Scripts run sandboxed with explicit capability grants that say which APIs a plugin may touch, and they reach the engine only through the documented command, event and registry surfaces.

## Where a pack lives on disk

A mod is a folder:

```
Neo Angband/                 a self-contained install: the game's own folder
  Neo Angband.exe
  data/
    save/                    your characters
    mods/                    <- mods live here, right beside the program
      load-order.json        optional; owned by an external mod manager
      my-mod/
        manifest.json        identity, version, shape, dependencies, description
        monster.json         one file per kind of record the pack changes
        object.json
```

An installed copy keeps the same `mods/` folder under the OS user directory
instead; either way the mod manager's "Where mods come from" row names the exact
path. See [INSTALL.md](INSTALL.md#where-your-data-lives).

`manifest.json` is validated on load. Every other `.json` at the top level of the folder is a record contribution named after its record type, and `plugin.js`, if present, is code the host loads and runs. Nothing else is involved, so a mod's repository root is itself a mod folder, and the first-party mods are developed, tested and released without being converted into anything else.

`load-order.json` belongs to the external mod manager rather than the game. Its shape is `{ "order": ["mod-a", "mod-b"] }`. As with an active-plugin list in Vortex or MO2, a listed pack is loaded, and it loads in the listed position. This is the deploy target that the division of labour below assumes.

A manager and a player can disagree, so precedence works like this:

| Situation | Result |
| --- | --- |
| Listed in `load-order.json`, player has never touched it | Enabled |
| Player turned it off in the game | Stays off, permanently |
| Player turned it on in the game | Stays on, even if unlisted |
| `?mods=` in the URL (dev override) | Wins outright, verbatim |

A player's explicit choice outranks the file in both directions. Otherwise, turning off a deployed mod would look broken, because the file would switch it back on at the next launch.

Problems in the mods folder are reported and never stop the game. A hand-edited manifest, a half-copied folder or a `.txt` renamed to `.json` produces one line on the mod manager's "Where mods come from" screen, and the game still starts. A folder whose `manifest.json` gives a different id from the folder name is refused with an explanation, because the enabled set, the load order and a save's provenance all key off the manifest id.

Both builds can read a mods folder, but only the desktop build has one of its own. The desktop build reads the `mods/` directory beside the game at every launch. In a browser, the mod manager's "Choose a mods folder..." row asks you to pick one and remembers it, so later visits read the same folder without asking. Both builds run the same validator, so a mod behaves the same in each.

In a browser, the folder route has a few limits:

- You pick the folder yourself, once, because a web page is not allowed to browse your files uninvited. You can pick either a folder of mods or a single mod's folder.
- After a long gap the browser may ask for permission again. The mod manager's row then reads `NEEDS RECONNECTING`, so your mods do not seem to vanish when the folder quietly stops being read.
- The browser gives the game the folder's name but never its path, so only the name is shown.
- Firefox and Safari cannot pick a directory at all, because those browsers do not support it. Their players still get every mod on offer, since *Install a mod...* needs only a network request and the browser's own storage. The folder route is for a mod you are writing or one that was never published, and in those browsers the manager explains this instead of showing a row that does nothing.

## Identity and composition

- IDs are namespaced everywhere (`core:kobold`, `mypack:frost-wyrm`), so two packs cannot collide.
- Packs declare explicit dependencies and versions, and load order is resolved deterministically.
- Packs may add records, and may patch or replace records from packs they declare as dependencies. The base game (`core`) can be replaced, so a total conversion is a supported kind of mod.
- A pack may be divided into named **sections**: parts a player can switch off individually, that a compatibility claim can point at, and that a priority band can move independently of the rest of the pack.
- A pack may declare how it relates to another pack (`compat`): that the two conflict, that one of them should win, or that one of its sections is the compatibility patch for the other. These declarations are advisory. An author controls their own pack's contributions but not the player's load order or anyone else's pack, so even a declared conflict is a warning the player can ignore; the engine labels, and does not forbid. See `modding/MOD_LIFECYCLE.md` section 3.
- Savefiles embed the active pack manifest and per-entity provenance, so a save knows exactly which content produced it and can fail gracefully when a pack is missing or changed.
- **An engine release should not force a mod release.** A data-only pack loads across engine versions and reports what it could not apply instead of being refused, and a pack that ships code gets a deprecation release before an ABI bump strands it. `modding/MOD_COMPATIBILITY.md` covers the four gates that can strand a mod, what to put in `engine`, and the named subset of `ctx.core` the promise covers. The rest of `ctx.core` is an escape hatch: a plugin may call it, and a rename there can ship without a deprecation release.

## Beyond-parity systems are mods

The original game never had NPCs and dialog, quests, shops-as-systems or networking as general systems. Core includes none of them and no seams specific to them. Mods build them entirely on the generic extension surface every mod already uses:

- the serializable command queue (input) and event bus (output), which are the engine's public I/O API;
- string-keyed registries for the record and behavior types the base game itself declares (open to runtime registration);
- the sandboxed plugin runtime with capability grants;
- per-mod save namespaces (arbitrary private state);
- render/UI hooks.

That surface is meant to be enough for whole subsystems and full overhauls, such as a dialog engine, a quest tracker, a networked shared world or an economy, without core anticipating any of them. If a mod needs a hook core does not expose, the fix is to add that generic hook to the public API, and core still does not ship the feature.

Core does contain the upstream parity content that resembles these systems: the town, its shops and the Sauron/Morgoth win condition. They are built on the same generic surfaces (the base game is pack zero), so a mod can extend, replace or overhaul them. The statistical parity bar is measured on that upstream behavior alone.

## Determinism

The engine is deterministic in the same local sense the original is. It uses a seeded RNG whose full state is saved, so a reload resumes the exact same stream, and that (rather than whole-game replay) is what stops a reload from rerolling an outcome; see the save-scum policy. An unmodded run can also be reproduced from its start seed, which the port shows as a seed you can share, a bonus the original does not advertise.

Determinism holds by default and is lost only when something forces it. A mod may be nondeterministic (the wall clock, its own randomness, a network, an external AI agent), and adding, removing or updating mods mid-game breaks reproducibility from the seed. Core records this in a determinism mode that every save carries. A save starts deterministic, and the first time a determinism-affecting mod is enabled on it, core switches it to nondeterministic for good. Removing the mod later does not switch it back, so a save cannot be tainted and then cleaned. Mods can trigger this integrity flag but never reverse it. It is separate from the save-scum gameplay policy, which a mod may relax, and anti-scum still holds for core mechanics in both modes because they always draw from the saved seeded stream.

## The modding SDK

The SDK is the documented, versioned surface that mod authors build against, whether they are people or AI coding agents. An agent should be able to write a valid, working mod from the documentation alone.

- `docs/modding/`: the documentation set, covering getting started, pack anatomy, a schema reference generated from the engine's own validators, the handler registry catalog, dialog, quest and shop cookbooks, the tile-pack guide (see `docs/LINOLEUM.md`), the sandbox capability reference, and publishing guidance.
- Typed APIs: `@rpgm-tools/neo-angband-core` exports the same typed interfaces the base game is built from, so plugin authors get full TypeScript types.
- Validation-first tooling: `@rpgm-tools/neo-angband-mod-sdk` ships `neo-angband-mod-check` and `neo-angband-mod-build`. The check runs the same install-time rules the game enforces (manifest schema, capability grammar, engine range, file-list requirements) against a folder, so a green run means the game will accept the mod. The build compiles a mod's TypeScript into the `plugin.js` a folder distributes, and enforces the plugin ABI while doing it. There is no separate `neo-pack` CLI.
- Sample mods, kept in this repository as working documentation and tested in CI against every engine change so the SDK cannot quietly go stale. They live in `samples/`: the seven tutorial mods under `samples/tutorials/` (one per tutorial, each the finished form of what that tutorial builds), plus four front-end samples, `blueprint-view`, `command-dial`, `sprite-inventory` and `vitals-panel`. The first-party mods are not here; each lives in its own repository.
- For AI coding agents: machine-readable JSON Schemas for every record type, a generated registry and handler reference, a single-file agent context document (an `llms.txt`-style digest of the whole SDK), copy-pasteable worked examples for each surface, and validation errors phrased as fixes. Because content is declarative data rather than code, AI-authored content arrives as validated data and is never trusted as code.

## The AI seam

The engine defines a content-generator interface for names, lore, item flavor, level theming and future surfaces. Its default implementation is deterministic and procedural, and it is always available. This repository ships no AI provider and makes no network calls; a plugin may implement the interface against any backend. With nothing plugged in, the base game stays fully playable and unchanged.

## Trust model

- Content packs: validated data, lowest risk, freely shareable.
- Tile packs: validated manifests plus images, same posture.
- Scripted plugins: sandboxed and capability-scoped, but still code - the
  UI surfaces what a plugin can touch before enabling it.

## Licensing note for mod authors

The engine is dual-licensed (GPLv2 or the Angband license; see LICENSE.md).
Declarative content packs and tile packs are independent works - license
them as you wish. Distributed scripted plugins are safest treated as GPLv2
derivatives. Nothing in the license restricts services a plugin talks to;
network-side services remain entirely the service owner's.
