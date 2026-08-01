# The Mod System

> STATUS: TARGET DESIGN, not a description of the current build. This page is
> the ratified design of the mod system (PORT_PLAN.md decisions 13-21). Most of
> it - including the matrix below - states what mods are meant to be able to do,
> in the present tense, and a reader cannot tell from this page which rows are
> built. For the MEASURED current state, with counts and `file:line` citations,
> read **`docs/modding/MOD_REACH.md`**; it is deliberately blunt about what is
> absent. In short, as of 2026-07-29: gamedata records are real and layered
> (add / patch / replace / remove, on 24 of 44 record files), and every code and
> resource seam that exists is reachable only by a mod compiled into the web
> bundle. `docs/modding/MOD_SEAMS.md` documents the behaviour seam that is built.

Neo Angband is moddable by construction: the base game is itself a pack
loaded through the same pipeline as any third-party mod. Moddability is a
ratified pillar (PORT_PLAN.md decisions 13-21): every aspect of the game is
open to mods, including capabilities that do not exist in the base resources.

## What is core, and what is a mod

The dividing line (PORT_PLAN.md decisions 17-18) is deliberately sharp:

- **Core** is exactly two things: faithful Angband 4.2.6 parity, and the
  mod architecture itself (the registries, composition engine, sandbox,
  save namespacing, and SDK described below). Nothing else.
- **Everything new is a mod.** Any feature, behavior, or visual beyond
  parity - including the beyond-parity systems below and all UI-level
  quality-of-life - ships as a mod, never baked into the port. Core ships
  the extensibility SEAMS (part of the mod architecture); mods ship the
  features that ride them.
- **NO MOD SHIPS IN THE BOX.** A fresh install is Angband 4.2.6 and nothing
  else. The three first-party mods each live in their own repository, carry their
  own release tags and tests, and arrive through the mod manager's *Install a
  mod...* row - the same route, and the same digest verification, a third-party
  mod uses:
  - **`qol`** - genuinely new conveniences (`docs/modding/QOL.md`). Not Angband's
    own `=` options, which ship in core at their upstream defaults.
  - **`bug-fixes`** - an unofficial patch set for upstream bugs core deliberately
    keeps (`docs/modding/BUG_FIXES.md`).
  - **`neo-linoleum`** - an alternative loose-pack tile engine, NOT the source of
    the game's tile sets, which are core content from `lib/tiles/list.txt`. It
    ships all six upstream sets converted to loose packs: 9161 files of art that
    belongs to the mod. A converted pack is proven to draw pixel-for-pixel what
    its tilesheet draws (`docs/LINOLEUM.md`, decision 26).

  This is the load-bearing form of "the seams are real". A modding system whose
  author's own mods take a private path into the build is a modding system nobody
  has tested; bundling them would have hidden every defect in the install path
  behind three mods that never used it. Emptying the bundle is what forced the
  download route, the folder code loader and the plugin ABI to actually work.
- **Cheaty mods are allowed.** A mod may add, patch, replace, or remove
  anything - up to the rules that make the game Angband, or a roguelike at
  all. The engine warns and labels (for example, marking a save's profile
  non-reproducible); it never forbids. What players can do to their own
  game is their choice.

## The moddable-surface matrix

This is the contract for each surface. "Add" means new records,
"patch/replace" means overriding base records, "extend" means introducing
genuinely new behavior or record types.

Read the lower rows correctly (decision 22): rows like NPCs/dialogs, Quests,
and Networking are NOT core modules. Core provides only the generic
extension surface (command queue, event bus, string-keyed registries, the
sandboxed plugin API, save namespaces, render hooks); a MOD builds the
NPC, dialog, quest, or networking SYSTEM on it. The only related things in
core are the upstream parity pieces (the 4.2.6 town and its shops, the
win condition), implemented through these same surfaces so mods can
overhaul them. The matrix asserts what mods CAN do, not what core ships.

> The matrix is the TARGET. Measured against the code on 2026-07-29, the "Add"
> and "Patch/replace" columns hold for 24 of the 44 record files and are silently
> inert on the other 20; the "Extend" column holds for effects, room builders,
> and player commands only, and only for a mod compiled into the web bundle;
> Shops, Sounds, UI panels, and Game constants have no seam at all. Row by row,
> with citations: `docs/modding/MOD_REACH.md`.

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

How the engine is meant to keep this true (the design rules, with the measured
state of each noted):

- Every registry accepts runtime registration and is keyed by namespaced
  string IDs, never closed enums. Upstream's compiled dispatch tables
  (effects, commands) are ported as open handler registries.
  *Measured: true for effects (112 codes), room builders (19), and player
  commands (43). Not true for monster blow effects, projection-to-feature,
  projection-to-object, or store behaviour, which are `switch` statements, nor
  for the 31 generated `as const` tables.*
- New record TYPES are supported: a pack may declare its own schemas, and
  scripted plugins may register loaders for them. The engine treats the base
  game's record types as pack-zero declarations, not engine specials.
  *Measured: the type list really is open (any `*.json` stem composes) and core
  really is pack zero with no special casing. Per-pack SCHEMAS do not exist -
  there is no record-schema validation at all.*
- The base game must consume every surface through the same public API mods
  use. If core needs a private hook, the hook becomes public API instead.
  *Measured, and now structurally: the first-party mods are built OUTSIDE this
  repository against the published `@rpgm-tools/neo-angband-core`, so a private
  hook is not merely discouraged, it does not resolve. The plugin builder refuses
  any non-relative import outright, so a mod cannot even reach the engine by name -
  it receives it as `ctx.core`.*

## Pack shapes

1. **Content packs** - declarative, schema-validated JSON: monsters, items,
   races, classes, effects, vaults, generation profiles, objectives.
   Safe by construction: a pack that validates cannot corrupt the engine.
   This is also the intended lane for AI-generated content - generated
   output is data to validate, not code to trust.
2. **Tile packs** - the Linoleum model, first-class: a manifest, individual
   image files (not tilesheets), exact named targets
   (`target:monster:core:farmer-maggot:asset:farmer_maggot_0`), optional
   family metadata and multi-resolution trees. Honest fallback: uncovered
   targets render as glyphs, never as silently substituted art.
3. **Scripted plugins** - the escape hatch for behavior that declaration
   cannot express. Scripts run sandboxed with explicit capability grants
   (which APIs a plugin may touch); they interact with the engine only
   through the documented command/event/registry surfaces.

## Where a pack lives on disk

A mod is a **folder**. That is the whole format:

```
Neo Angband/                 a self-contained install: the game's own folder
  Neo Angband.exe
  neo-angband-data/
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

`manifest.json` is validated on load. Every other `.json` at the top level of
the folder is a record contribution, named after the record type - and `plugin.js`,
if present, is code the host loads and runs. That is the whole format: a mod's
repository root IS a mod folder, which is why the first-party mods can be developed,
tested and released without ever being translated into something else.

**`load-order.json` belongs to the mod manager, not to the game.** Its shape is
`{ "order": ["mod-a", "mod-b"] }`, and being listed means two things at once, the
way an active-plugin list does in Vortex or MO2: the pack is **loaded**, and it
loads **in that position**. This is the deploy target the division of labour
below assumes.

Precedence, because a manager and a player can disagree:

| Situation | Result |
| --- | --- |
| Listed in `load-order.json`, player has never touched it | Enabled |
| Player turned it off in the game | Stays off, permanently |
| Player turned it on in the game | Stays on, even if unlisted |
| `?mods=` in the URL (dev override) | Wins outright, verbatim |

A player's explicit decision outranks the file in both directions. Without that,
turning off a deployed mod would look broken: the file would put it back on the
next launch.

**Failures are reported, never fatal.** A mods directory is player-supplied data,
so a hand-edited manifest, a half-copied folder, or a `.txt` renamed to `.json`
produces one line in the mod manager's "Where mods come from" screen and the game
still starts. A folder whose `manifest.json` claims a different id than the folder
name is refused with an explanation, because every other surface - the enabled
set, the load order, a save's provenance - keys off the manifest id.

**Both builds can read a mods folder; only the desktop build knows where its own
is.** The desktop build has a `mods/` directory beside the game and reads it at
every launch. In a browser, the mod manager's "Choose a mods folder..." row asks you
for one - and remembers it, so later visits read the same folder without asking
again. It goes through the identical validator, so a mod behaves the same on both.

The narrower reductions in a browser, precisely:

- You pick the folder once; a page may not go looking through a filesystem
  uninvited. Pick either a folder of mods or one mod's own folder.
- The browser may need permission again after a long gap. The mod manager's row
  then reads `NEEDS RECONNECTING`, because a folder that silently stopped being
  read is the failure that looks like the mods vanished.
- The page is told the folder's *name*, never its path, so only the name is shown.
- Firefox and Safari cannot pick a directory at all - the capability does not
  exist in those engines, so there is no workaround to find. **Nothing is missing
  from a Firefox or Safari player's mod list because of it**: *Install a mod...*
  needs only a network request and the browser's own storage, and that is how every
  mod on offer arrives. The folder route is for a mod you are writing, or one that
  was never published. The manager says exactly this rather than offering a dead
  row.

## Identity and composition

- Namespaced IDs everywhere: `core:kobold`, `mypack:frost-wyrm`. No
  collisions between packs by construction.
- Packs declare explicit dependencies and versions; load order is resolved
  deterministically.
- Packs may add records, and may patch or replace records from packs they
  declare as dependencies. The base game (`core`) is replaceable: total
  conversions are a supported shape, not a hack.
- A pack may be divided into named **sections** - parts a player can switch off
  individually, a compatibility claim can point at, and a priority band can move
  independently of the rest of the pack.
- A pack may declare what it thinks about ANOTHER pack (`compat`): that it
  conflicts with it, that one of them should win, or that one of its sections IS
  the compatibility patch for it. **None of it binds.** An author has total
  authority over their own pack's contributions and none over the player's load
  order or anyone else's pack, so even a declared conflict is a warning the
  player can walk past (decision 18: the engine labels, it does not forbid).
  See `modding/MOD_LIFECYCLE.md` section 3.
- Savefiles embed the active pack manifest and per-entity provenance, so a
  save knows exactly which content produced it and can fail gracefully when
  a pack is missing or changed.

## Beyond-parity systems are mods, not core (decision 22)

NPCs and dialog, quests, shops-as-systems, and networking are things the
original never had as generalized systems. The port does NOT build them, or
feature-specific seams for them, into core. They are built entirely by mods
on the GENERIC extension surface every mod already uses:

- the serializable command queue (input) and event bus (output) - the
  engine's public I/O API;
- string-keyed registries for the record and behavior types the base game
  itself declares (open to runtime registration);
- the sandboxed plugin runtime with capability grants;
- per-mod save namespaces (arbitrary private state);
- render/UI hooks.

That surface is deliberately powerful enough to build whole subsystems and
full system overhauls - a dialog engine, a quest tracker, a networked
shared world, an economy - without core anticipating any of them. If a mod
needs a hook core does not expose, the fix is to make that generic hook part
of the public API, never to ship the feature.

What core DOES contain is the upstream parity content that happens to
resemble these systems - the town, its shops, and the Sauron/Morgoth win
condition. These are implemented THROUGH the generic moddable surfaces (the
base game is pack zero), so a mod can extend, replace, or overhaul them.
The statistical parity bar (PORT_PLAN.md decision 2) is measured on that
upstream behavior alone.

## Determinism (decision 22)

The engine is deterministic in the same LOCAL sense the original is: it uses
a seeded RNG whose full state is persisted in the save, so a reload resumes
the exact stream (this, not whole-game replay, is what makes reload-reroll
impossible - see the save-scum policy). Unmodded runs are additionally
reproducible from their start seed, which the port exposes as a shareable
seed - a free bonus the original does not advertise.

Determinism is PRESERVED BY DEFAULT and degraded only when forced. A mod may
be nondeterministic (wall clock, its own randomness, a network, an external
AI agent), and any mid-game add/remove/update of mods breaks
reproducibility-from-seed. When that happens core does not just shrug: every
save carries a core-owned DETERMINISM MODE (decision 22). A save starts
DETERMINISTIC; the first time a determinism-affecting mod is enabled on it,
core flips it to NONDETERMINISTIC seamlessly and IRREVERSIBLY - removing the
mod later never restores the deterministic mode, so a save cannot be tainted
and then cleansed. This is core integrity metadata that mods can trigger but
never reverse; it is distinct from the save-scum gameplay policy (which a mod
may relax). Anti-scum itself holds in both modes for core mechanics, which
always draw from the saved seeded stream.

## The modding SDK

The SDK is the documented, versioned surface mod authors - human and AI -
build against. Accessibility to AI coding agents is a first-class goal
(decision 20): an agent should be able to author a valid, working mod from
the documentation alone.

- `docs/modding/` - the documentation set (P7 deliverable): getting started,
  pack anatomy, schema reference generated from the engine's own validators,
  the handler registry catalog, dialog/quest/shop cookbooks, tile-pack guide
  (see `docs/LINOLEUM.md`), sandbox capability reference, and publishing
  guidance.
- Typed APIs: `@rpgm-tools/neo-angband-core` exports the same typed interfaces the base
  game is built from; plugin authors get full TypeScript types.
- Validation-first tooling: `neo-pack` (planned) scaffolds, validates, and
  bundles packs; validation errors point at the offending line of the
  author's JSON.
- Sample mods maintained in-repo as living documentation and CI-tested
  against every engine change, so the SDK cannot silently rot. The QoL and
  bug-fixes mods are the largest such examples; neo-linoleum's sources and
  tests are here too, though the mod itself installs from its own repository.
- AI-agent accessibility (decision 20): machine-readable JSON Schemas for
  every record type, a generated registry/handler reference, a single-file
  agent context document (an `llms.txt`-style digest of the whole SDK),
  copy-pasteable worked examples per surface, and validation errors phrased
  as actionable fixes. The declarative-first design (content is data, not
  code) is what makes AI-authored content safe: generated output is
  validated data, never trusted code.

## The AI seam

The engine defines a content-generator interface (names, lore, item flavor,
level theming, and future surfaces) with the deterministic procedural
implementation as the always-available default. This repository ships no AI
provider and no network calls. Plugins may implement the interface against
any backend. The base game must remain fully playable - and fully itself -
with the seam unfilled.

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
