# Mod plugins: shipping CODE in a mod folder

A mod that only changes records needs no code — drop `manifest.json` plus one
`<record-type>.json` per thing you change into a folder and you are done (see
[MODS.md](MODS.md)). This document is for the other kind: a mod that changes
*behaviour*.

> **The mod API is UNSTABLE until 1.0.** It will change and your plugin will stop
> loading when it does. That is deliberate: the alternative is a mod that
> half-works and a player who reports it as a game bug. See
> [Version contract](#version-contract).

## The shape

A mod is a **folder**, and it may hold as much as it needs to: several scripts,
records, images, sounds, data of its own.

```
mods/my-mod/
  manifest.json
  plugin.js          <- the entry point, default-exporting a plugin
  lib/dice.js        <- more scripts; import them relatively
  lib/format.js
  monster.json       <- a record contribution (needs the "content" facet too)
  tiles/orc.png      <- an image: await ctx.assetUrl("tiles/orc.png")
  data/spawns.json   <- your own data (nested .json is an asset, not a record)
  README.md
```

Only `plugin.js` is loaded by name. Everything else your code reaches itself —
scripts by importing them, everything else through `ctx.assetUrl`.

`manifest.json` must declare the **`plugin` facet** and `modApi`.

A mod that only runs code can say `"shape": "plugin"` and stop there. A mod that
contributes **both** records and code — the ordinary case, e.g. a new monster
plus the behaviour that makes it interesting — lists both facets:

```json
{ "shape": "content", "facets": ["content", "plugin"] }
```

`facets` must contain `shape`, so the two can never contradict each other. Either
spelling works (`shape` is just the primary kind, and what the mod manager
displays).

> Until 2026-07-29 `shape` was **exclusive**, and the loader gated code on
> `"plugin"` while composition gated records on `"content"`. A folder like the one
> above therefore could not work: declaring `plugin` dropped `monster.json`
> silently, and declaring `content` refused the code. If you wrote a mod against
> the older text and found half of it inert, that was this, and `facets` is the fix.

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "shape": "plugin",
  "modApi": 1,
  "affectsGameplay": true,
  "capabilities": ["registry:effect"],
  "description": "What this does, in your own words. The mod manager shows this."
}
```

`plugin.js`:

```js
export default {
  api: 1,

  // Behaviour: folded into the one ModHooks the engine consults.
  hooks(ctx) {
    if (!ctx.flags.myToggle) return undefined;   // a rule the player turned off
    return {
      messageText: (raw) => raw.replace("You have", "Thou hast"),
    };
  },

  // System overrides: capability-gated registries.
  register(host, ctx) {
    host.effects.register("MY_EFFECT", {
      handler: (context) => { /* runs inside effect_do, live state */ return true; },
    });
  },
};
```

Both members are optional. A plugin that declares neither is refused, because a
mod with no code simply ships no `plugin.js`.

## Why the engine is not imported

`ctx.core` **is** the engine — the same live module instance the game is running
on, passed in rather than imported.

This is not a limitation, it is the point. A bare specifier like
`import { tunnelAux } from "@neo-angband/core"` cannot resolve in a module fetched
from a folder, and bundling the engine into your plugin would give you your *own*
copy of every registry and singleton: your effect handler would land on a registry
the interpreter never consults, and your mod would appear to do nothing at all,
with no error anywhere. One instance, passed in, makes that failure impossible.

What `ctx` carries:

| Field | What it is |
|---|---|
| `id` | your mod's id, which is also its folder name |
| `api` | the ABI version the **host** implements |
| `engine` | the engine version, if you want to adapt rather than refuse |
| `flags` | **your** resolved rule toggles — `choices[flag] ?? rule.default`, sliced to the rules your own manifest declares |
| `core` | the live engine namespace: core's entire public API |
| `state` | the live `GameState` (present in `register`, absent in `hooks`) |
| `assetUrl` | `(path) => Promise<string \| null>` — a URL for one of *your* files |
| `data` | your own record files, parsed, keyed without `.json` |
| `log` | a diagnostic line; the host decides where it goes |

`flags` is sliced per mod on purpose: a mod must not be able to read or act on
another mod's toggles, or its behaviour would silently depend on which other mods
the player happened to enable.

## Several scripts

Split your plugin up however you like and import the pieces relatively:

```js
// plugin.js
import { roll } from "./lib/dice.js";
import { describe } from "./lib/format.js";
```

Two rules, both of them things a browser cannot do rather than choices:

- **Put the extension on.** `"./lib/dice.js"`, not `"./lib/dice"`. Extensionless
  resolution is a Node and bundler convenience; no browser has ever done it.
- **No cycles.** Two files that import each other cannot both be loaded from a
  browser folder — a file's address there only exists once its text is final, and a
  cycle needs both addresses at once. Move the shared part into a third file.

Anything else works, in as many subdirectories as you want. If a script is missing
or two import each other, the mod manager names *those* files, not your entry
point.

## Images, sounds, and your own data

Ask for a URL; do not build a path.

```js
register(host, ctx) {
  ctx.assetUrl("tiles/orc.png").then((url) => {
    if (url) { /* an <img>, a canvas draw, a texture */ }
  });
}

// data too - your own JSON, not a record contribution
const spawns = await fetch(await ctx.assetUrl("data/spawns.json")).then((r) => r.json());
```

On desktop that URL is an `http:` one under the shell's own server; in a browser
tab it is a `blob:`. A mod that hard-codes either is a mod that runs on one of the
two front ends. The URL lasts for the session, and asking twice gives you the same
one.

`ctx.assetUrl` only ever reaches **your own** folder — the id is fixed by the host,
and a path that climbs out of it is refused.

## Bare specifiers still do not work

`import { tunnelAux } from "@neo-angband/core"` cannot resolve from a folder, and
there is nothing to import: the engine is `ctx.core`, already live. That is the one
import a folder plugin cannot have, and the mod manager says so instead of
repeating the browser's message.

## Version contract

`modApi` is an integer and it must match the host **exactly**. There is no range,
because a range would imply a compatibility promise that does not exist before 1.0.

Every change to the ABI bumps it, and every plugin then stops loading until its
author republishes. When that happens the mod manager names both numbers and which
side is behind — a too-new mod needs a newer game, a too-old one needs a mod
update, and "incompatible" on its own sends the player to the wrong place.

It is declared in the **manifest**, not only inside `plugin.js`, so an incompatible
plugin can be refused *before* it is imported. A version check inside the module
can only run after the module's top-level code has already executed, which is the
wrong order for code that came out of a folder anyone can write into.

## What has to be true before your code runs

In order, and all of it before the import:

1. the folder ships `plugin.js` (from the directory listing — no probing);
2. the mod is **enabled** — a disabled mod's code does not exist, the same rule as
   a disabled mod's patches;
3. the manifest declares the `plugin` facet (via `shape` or `facets`);
4. `modApi` matches;
5. the player has **consented** to every capability the manifest requests.

Then the module is imported and its default export is shape-checked.

Nothing about a bad plugin can stop the game booting. A hand-edited manifest, a
half-finished download, a plugin that throws at import or inside `hooks()` — each
becomes one line the mod manager shows, and the other mods carry on.

## Capabilities

`register` reaches five registries, each gated by a capability your manifest must
declare **and** the player must consent to:

| Capability | What it opens |
|---|---|
| `registry:effect` | add a new effect code, or replace a core one — combat, healing, teleport, detection |
| `registry:room` | room and level builders, referenced from a dungeon profile |
| `registry:command` | what a player command *does* |
| `registry:monster` | a hook at the top of every monster's turn; return true to take the turn over |
| `registry:vocab` | declare genuinely new vocabulary (flags, stats, mod-coined kinds) and store per-entity values |

A facade you did not declare throws when you touch it, even if the player
consented to something else. Consent says the player allowed these domains; the
manifest says you asked for them; both must hold.

Plugin code runs **in process, synchronously**, with the same access to the rng,
the chunk, the player and the monster that core has — because a deep override
cannot cross an async, isolated Worker boundary. So it is trusted code, exactly as
it is in SKSE or Forge, and the consent prompt is the boundary. If your mod only
needs to react to events rather than override systems, the untrusted Worker tier
exists for that and needs no trust at all.

## Testing yours

Point the game at your folder and read the mod manager: it lists what was found,
and one line per pack it could not use. `Where mods come from` names the exact
directory.

The loader itself is covered by `packages/web/src/mod-code.test.ts` (the gates,
with the importer injected so an absence of execution can be asserted) and
`mod-code.node.test.ts` (a real folder on disk, a real dynamic import, a real
`ModHooks` coming back out). The second is the one worth copying if you want a
harness of your own.
