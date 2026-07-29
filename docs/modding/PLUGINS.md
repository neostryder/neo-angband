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

```
mods/my-mod/
  manifest.json
  plugin.js        <- one ES module, default-exporting a plugin
  monster.json     <- records too, if you want both
```

`manifest.json` must declare `shape: "plugin"` and `modApi`:

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

## Why there are no imports

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
| `log` | a diagnostic line; the host decides where it goes |

`flags` is sliced per mod on purpose: a mod must not be able to read or act on
another mod's toggles, or its behaviour would silently depend on which other mods
the player happened to enable.

## One file, no relative imports

**Bundle your plugin into a single `plugin.js`.**

On the desktop build your folder is served over the loopback HTTP server, so a
relative `./helper.js` beside your plugin resolves fine. In a browser tab the
player's folder is a set of file handles with no location at all, so the plugin is
imported from a `blob:` URL — and a relative specifier then resolves against the
blob URL, which points at nothing.

If that is what broke, the mod manager says so rather than repeating the browser's
"Failed to fetch dynamically imported module", which points at your entry file
instead of the line that failed.

(Bare specifiers are unaffected either way, because there are none.)

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
3. the manifest says `shape: "plugin"`;
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
