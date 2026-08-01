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
- [PARITY_CLOSURE.md](./PARITY_CLOSURE.md) - the closed worklist that took the
  port to 4.2.6 parity: 16 items, all done, kept for provenance.
- [REBASE_RUNBOOK.md](./REBASE_RUNBOOK.md) - how to advance the port from its
  pinned baseline onto a future upstream release using the parity ledger.
- [../parity/README.md](../parity/README.md) - the parity provenance ledger:
  which upstream sources each port module ports.

## Playing and installing

- [INSTALL.md](./INSTALL.md) - playing in a browser, installing the offline
  PWA, self-hosting the static site, and the desktop app.

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
- [modding/MOD_SEAMS.md](./modding/MOD_SEAMS.md) - the `ModHooks` behaviour
  seam, its per-hook fold rules, and why core stays faithful when untouched.
- [modding/MOD_REACH.md](./modding/MOD_REACH.md) - measured mod reach: hook
  count, the dispatch-table census, what data layering really supports, what
  resources are overridable, and the ranked gap list.
- [modding/MOD_INTEGRATION_PLAN.md](./modding/MOD_INTEGRATION_PLAN.md) - wiring
  the mod substrate into the running game.
- [modding/BORG.md](./modding/BORG.md) - the Borg autoplayer mod and how to run
  it.
- [modding/QOL.md](./modding/QOL.md) - the first-party quality-of-life mod
  (`qol`): design of record and changelog.
- [modding/BUG_FIXES.md](./modding/BUG_FIXES.md) - the first-party bug-fix mod
  (`bug-fixes`): design of record and changelog.
- [modding/P7_BUILD_PLAN.md](./modding/P7_BUILD_PLAN.md) - build plan for the
  mod substrate and agent API.
- [modding/P8_BUILD_PLAN.md](./modding/P8_BUILD_PLAN.md) - build plan for the
  Borg as a mod.
