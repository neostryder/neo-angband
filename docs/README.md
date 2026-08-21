# Neo Angband documentation

Everything documenting the port: the plan and architecture, how to play and
install, and how to mod the game. Start with the top-level
[README](../README.md) for the project overview.

## If you are here to do one thing

| I want to... | Go to |
| --- | --- |
| **Play it** | [INSTALL.md](./INSTALL.md), or grab a build from [Releases](https://github.com/neostryder/neo-angband/releases) |
| **Get a mod** | [MODS.md - getting a mod](./MODS.md#getting-a-mod-in-one-paragraph) |
| **Write a mod** | [modding/README.md](./modding/README.md) |
| **Report something** | In the game: Escape menu -> *Report a problem* ([LOGGING.md](./LOGGING.md)). Or [open an issue](https://github.com/neostryder/neo-angband/issues/new/choose), or [the Discord](https://discord.gg/YegtwbHTBQ) |
| **Understand the parity claim** | [PARITY.md](./PARITY.md) |
| **Work on the port** | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| **Cut a release** | [RELEASING.md](./RELEASING.md) |

## Overview and plan

- [ARCHITECTURE.md](./ARCHITECTURE.md) - the monorepo layout and how the
  headless core, content, shells, and mods fit together.
- [PORT_PLAN.md](./PORT_PLAN.md) - the ratified port plan, roadmap, and the
  numbered project decisions.
- [PARITY.md](./PARITY.md) - what "feature parity with Angband 4.2.6,
  statistically verified (with no mods)" means, the numbers it currently holds
  at, and the one metric that is measured and deliberately not gated.
- [PLANNED.md](./PLANNED.md) - the only place work that has NOT landed is
  written down. `CHANGELOG.md` records what shipped and nothing else.
- [WORKING_RECORD.md](./WORKING_RECORD.md) - why some comments cite documents
  that are not in this tree: the construction record is kept privately, and this
  says what it concluded and where the conclusions live.
- [RELEASING.md](./RELEASING.md) - the release runbook: how a tag becomes npm
  packages and downloadable builds, and the save-migration obligation that comes
  with any change to the save format.
- [../parity/README.md](../parity/README.md) - the parity provenance ledger:
  which upstream sources each port module ports.

## Playing and installing

- [INSTALL.md](./INSTALL.md) - playing in a browser, installing the offline
  PWA, self-hosting the static site, and the desktop app.
- [LOGGING.md](./LOGGING.md) - where the game writes its log, how much a build
  logs and why that is decided by the version rather than by a setting, and what
  is in a problem report. Nothing is uploaded anywhere.
- [../SECURITY.md](../SECURITY.md) - what is worth reporting privately, and
  where to send it.

## Tools

- [MCP.md](./MCP.md) - the MCP server: an AI client plays the game through the
  frozen agent API.

## Modding

**Writing a mod? Start at
[modding/tutorials/README.md](./modding/tutorials/README.md).** Seven short
tutorials, the first of which is two files. Everything below is reference.

- [MODS.md](./MODS.md) - the mod system's TARGET design: content packs, tile
  packs, and scripted plugins, with the base game as a pack itself.
- [modding/MOD_REACH.md](./modding/MOD_REACH.md) - the MEASURED current state:
  what a mod can actually change today, with counts and citations, plus the gap
  list. Read this before trusting a capability claim on any other page.
- [BORG_AS_MOD.md](./BORG_AS_MOD.md) - why the Borg is a mod rather than core
  code, and what surface an autoplayer needs. Design rationale, not the mod's
  current state.
- [LINOLEUM.md](./LINOLEUM.md) - the manifest-backed, loose-pack Linoleum tile
  format.

### Modding guides ([modding/](./modding/))

Roughly in the order a mod author needs them.

- [modding/tutorials/](./modding/tutorials/README.md) - the beginner path: seven
  tiny mods, one idea each, each ending in something visible on screen.
- [modding/README.md](./modding/README.md) - the reference entry point: pack
  anatomy, manifests, record composition, namespaced fields of your own, and the
  built-today-versus-design status table.
- [modding/REQUIREMENTS.md](./modding/REQUIREMENTS.md) - exactly what a mod must
  provide to be installable. GENERATED from the rules the game enforces, so it
  cannot go stale.
- [modding/AUTHORING.md](./modding/AUTHORING.md) - the shortcuts: `draftRecord`,
  `checkRecords` and `ModProject`. Read before writing a record by hand.
- [modding/MOD_SEAMS.md](./modding/MOD_SEAMS.md) - the `ModHooks` behaviour
  seam, its per-hook fold rules, and why core stays faithful when untouched.
- [modding/PLUGINS.md](./modding/PLUGINS.md) - the plugin ABI: one `plugin.js`,
  the engine handed in, and what it may reach.
- [modding/MOD_COMPATIBILITY.md](./modding/MOD_COMPATIBILITY.md) - what the
  engine promises a mod across releases, and the four ways a mod can be
  stranded by one. Read before publishing.
- [modding/MOD_LIFECYCLE.md](./modding/MOD_LIFECYCLE.md) - mod lifecycle,
  saves, load order, conflict reporting, and how mods compose. Design of
  record; not yet fully built.
- [modding/MOD_REACH.md](./modding/MOD_REACH.md) - measured mod reach: hook
  count, the dispatch-table census, what data layering really supports, what
  resources are overridable, and the ranked gap list.

The first-party mods, one page each - each is its own repository, and none is
bundled:

- [modding/QOL.md](./modding/QOL.md) - `qol`, the quality-of-life mod.
- [modding/BUG_FIXES.md](./modding/BUG_FIXES.md) - `bug-fixes`, the unofficial
  patch set for upstream defects core deliberately keeps.
- [modding/FEATURE_RESTORATION.md](./modding/FEATURE_RESTORATION.md) -
  `feature-restoration`, mechanics later Angband versions dropped, brought back
  one toggle at a time.
- [modding/BORG.md](./modding/BORG.md) - `borg`, the autoplayer, and how to run
  it.

Designs that are written down and not built. Read the status banner on each
before building anything against it:

- [modding/REGION_INPUT.md](./modding/REGION_INPUT.md) - per-cell pointer-input
  ownership for the region stack.
- [modding/CLOUD_BACKUP_DESIGN.md](./modding/CLOUD_BACKUP_DESIGN.md) - a save
  backup folder as a `qol` feature, and the two host additions it needs.
- [modding/UPSTREAM_CATCHUP_MOD_SCOPE.md](./modding/UPSTREAM_CATCHUP_MOD_SCOPE.md) -
  what a mod for upstream's post-4.2.6 work would contain, and where its
  boundary against `bug-fixes` runs.
