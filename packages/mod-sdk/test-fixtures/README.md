# Fixtures for `neo-angband-mod-build`

Three tiny mod folders, each proving one rule of the plugin ABI. They exist because
the builder's guarantees used to be tested only against the real first-party mods,
which meant only the **passing** path was ever exercised: a rule that never sees a
violation is a rule nobody has watched work.

| Folder | What it proves |
| --- | --- |
| `ok-mod` | A well-formed plugin builds, and its own relative modules are bundled IN |
| `value-import-mod` | A **value** import of the engine is fatal, not silently inlined |
| `no-default-mod` | A module that default-exports nothing is fatal |

`value-import-mod` is the important one. Before the builder marked every package
specifier external, esbuild resolved that import (a mod repo has the engine as a
devDependency, so it is right there) and copied what it found into `plugin.js` —
exit 0, no warning, and a private duplicate of engine state inside the mod. The
guard whose entire job was to catch it could not fire, because there was no bare
import left to see.

These are not compiled by `tsc`: the package's `tsconfig.json` includes only `src`,
and they are excluded from the published tarball by `files`. `ok-mod`'s
`import type` of the engine is erased by esbuild without ever being resolved, which
is why this package needs no dependency on core to build them.
