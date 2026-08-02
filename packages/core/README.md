# @rpgm-tools/neo-angband-core

The headless game engine behind [Neo Angband](https://github.com/neostryder/neo-angband) —
a TypeScript port of [Angband](https://angband.github.io/angband/) 4.2.6.

No renderer, no input, no DOM, no filesystem: rules, world, entities, effects,
generation and the save format, as plain modules. Runs in Node and in a browser.

```bash
npm install @rpgm-tools/neo-angband-core
```

## What it is for

Two audiences, and it is worth knowing which one you are:

- **Writing a Neo Angband mod.** A mod's plugin receives the running engine as
  `ctx.core`, so it never imports this package at runtime — but it wants the
  **types**, and its tests want a real engine to run against. That is what this
  package is for.
- **Building something else on Angband's rules.** A bot, a solver, a simulator, a
  different front end. The engine is headless on purpose and this is a supported
  use.

## Quick start

```ts
import { Rng, ENGINE_VERSION, PARITY_BASELINE } from "@rpgm-tools/neo-angband-core";

// The RNG is upstream's WELL1024a, seeded exactly as Rand_state_init does,
// so a seed reproduces a sequence across runs, platforms and save/load.
const rng = new Rng(1234);
console.log(rng.damroll(3, 6), rng.damroll(3, 6), rng.damroll(3, 6)); // 9 13 8

console.log(ENGINE_VERSION, PARITY_BASELINE); // 0.17.0 4.2.6
```

Two entry points:

| Import | What it holds |
| --- | --- |
| `@rpgm-tools/neo-angband-core` | The engine: rules, world, entities, effects, generation, saves |
| `@rpgm-tools/neo-angband-core/host` | The `HostIo` seam — the shape of `z-file.c`, for a front end that gives the engine real file and terminal I/O |

## The API is upstream's, deliberately

Neo Angband is an **exact-parity** port: the engine reproduces Angband 4.2.6's
behaviour, including its warts, and it is verified against the C rather than
against taste. Two consequences for anyone importing this package:

- **Names follow the C.** `damroll`, `mBonus`, `caveKnown`, `takeHit`,
  `objectDesc`. If you know `angband/src`, you already know your way around; if
  you expect a designed-from-scratch API, this is not one.
- **Bugs are reproduced, not fixed.** Upstream's faults are in here on purpose,
  with tests pinning them. Fixes live in a separate mod
  ([neo-angband-mod-bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes)),
  never in the engine.

**Game data is a separate concern.** This package is the rules; Angband's
gamedata (monsters, objects, dungeon profiles) is compiled into a content pack
that the host loads. So `@rpgm-tools/neo-angband-core` on its own can roll dice, run the
effect interpreter and read a save, but it cannot generate a populated level
without content handed to it.

## Versioning

`0.x` is the pre-release line and the API can change inside it; `1.0.0` is
reserved for the game's public release. `PARITY_BASELINE` is the upstream release
the port is verified against and moves independently of `ENGINE_VERSION`.

## Licence

Neo Angband keeps Angband's dual licence, as the Angband project asks of its
variants: **GNU GPL v2, or the Angband licence**, at your option. npm can only
carry one SPDX identifier, so the manifest says `GPL-2.0-only` — the more
restrictive of the two. The full text of both, and what it means for the bundled
art, is in [LICENSE.md](LICENSE.md).

Angband is the work of Ben Harrison, James E. Wilson, Robert A. Koeneke and the
Angband contributors. The port is by neostryder / RPGM Tools.
