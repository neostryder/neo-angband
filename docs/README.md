# Neo Angband documentation

Everything documenting the port: the plan and architecture, how to play and
install, and how to mod the game. Start with the top-level
[README](../README.md) for the project overview.

## Overview and plan

- [ARCHITECTURE.md](./ARCHITECTURE.md) - the monorepo layout and how the
  headless core, content, shells, and mods fit together.
- [PORT_PLAN.md](./PORT_PLAN.md) - the ratified port plan, roadmap, and the
  numbered project decisions.
- [PARITY.md](./PARITY.md) - what "feature parity with Angband 4.2.6,
  statistically verified" means and how it is enforced.
- [PARITY_CLOSURE.md](./PARITY_CLOSURE.md) - the worklist for closing every
  remaining gap against the 4.2.6 tag.
- [REBASE_RUNBOOK.md](./REBASE_RUNBOOK.md) - how to advance the port from its
  pinned baseline onto a future upstream release using the parity ledger.
- [../parity/README.md](../parity/README.md) - the parity provenance ledger:
  which upstream sources each port module ports.

## Playing and installing

- [INSTALL.md](./INSTALL.md) - playing in a browser, installing the offline
  PWA, self-hosting the static site, and the desktop app.

## Modding

- [MODS.md](./MODS.md) - the mod system: content packs, tile packs, and
  scripted plugins, with the base game as a pack itself.
- [BORG_AS_MOD.md](./BORG_AS_MOD.md) - scope and plan for shipping the Borg as
  a bundled mod on the perceive/act agent API.
- [LINOLEUM.md](./LINOLEUM.md) - the manifest-backed, loose-pack Linoleum tile
  format.

### Modding guides ([modding/](./modding/))

- [modding/README.md](./modding/README.md) - the entry point to modding Neo
  Angband and the moddability pillar.
- [modding/MOD_LIFECYCLE.md](./modding/MOD_LIFECYCLE.md) - mod lifecycle,
  saves, and how mods compose.
- [modding/MOD_SEAMS.md](./modding/MOD_SEAMS.md) - the small set of core seams
  the bundled mods use, and why each stays faithful when untouched.
- [modding/MOD_INTEGRATION_PLAN.md](./modding/MOD_INTEGRATION_PLAN.md) - wiring
  the mod substrate into the running game.
- [modding/BORG.md](./modding/BORG.md) - the bundled Borg autoplayer mod and
  how to run it.
- [modding/QOL.md](./modding/QOL.md) - the bundled quality-of-life mod
  (`qol`): design of record and changelog.
- [modding/BUG_FIXES.md](./modding/BUG_FIXES.md) - the bundled bug-fix mod
  (`bug-fixes`): design of record and changelog.
- [modding/P7_BUILD_PLAN.md](./modding/P7_BUILD_PLAN.md) - build plan for the
  mod substrate and agent API.
- [modding/P8_BUILD_PLAN.md](./modding/P8_BUILD_PLAN.md) - build plan for the
  Borg as a bundled mod.
