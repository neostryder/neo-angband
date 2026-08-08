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
- [WORKING_RECORD.md](./WORKING_RECORD.md) - why some comments cite documents
  that are not in this tree: the audit runs, briefs and build plans that built
  the port are kept privately, and this says what they concluded and where the
  conclusions live.
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

- [MODS.md](./MODS.md) - the mod system's TARGET design: content packs, tile
  packs, and scripted plugins, with the base game as a pack itself.
- [modding/MOD_REACH.md](./modding/MOD_REACH.md) - the MEASURED current state:
  what a mod can actually change today, with counts and citations, plus the gap
  list. Read this alongside MODS.md, which is the target.
- [BORG_AS_MOD.md](./BORG_AS_MOD.md) - scope and plan for shipping the Borg as
  a mod on the perceive/act agent API.
- [LINOLEUM.md](./LINOLEUM.md) - the manifest-backed, loose-pack Linoleum tile
  format.

### Modding guides ([modding/](./modding/))

- [modding/README.md](./modding/README.md) - the entry point to modding Neo
  Angband and the moddability pillar.
- [modding/MOD_LIFECYCLE.md](./modding/MOD_LIFECYCLE.md) - mod lifecycle,
  saves, and how mods compose.
- [modding/PLUGINS.md](./modding/PLUGINS.md) - the plugin ABI: one `plugin.js`,
  the engine handed in, and what it may reach.
- [modding/MOD_COMPATIBILITY.md](./modding/MOD_COMPATIBILITY.md) - what the
  engine promises a mod across releases, and the four ways a mod can be
  stranded by one.
- [modding/MOD_SEAMS.md](./modding/MOD_SEAMS.md) - the `ModHooks` behaviour
  seam, its per-hook fold rules, and why core stays faithful when untouched.
- [modding/MOD_REACH.md](./modding/MOD_REACH.md) - measured mod reach: hook
  count, the dispatch-table census, what data layering really supports, what
  resources are overridable, and the ranked gap list.
- [modding/BORG.md](./modding/BORG.md) - the Borg autoplayer mod and how to run
  it.
- [modding/QOL.md](./modding/QOL.md) - the first-party quality-of-life mod
  (`qol`): design of record and changelog.
- [modding/BUG_FIXES.md](./modding/BUG_FIXES.md) - the first-party bug-fix mod
  (`bug-fixes`): design of record and changelog.
