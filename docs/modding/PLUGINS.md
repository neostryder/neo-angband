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

## Your own saved data, and changing its shape

You may keep whatever JSON you like in the player's save, under your mod's id
(`ctx.state.mods[ctx.id]`). The engine round-trips it verbatim and never reads
it. It is stored with a `schema` number — whatever your manifest's `saveSchema`
was when it was written.

When you change the SHAPE of that data, bump `saveSchema` and ship a
`migrateBag`:

```js
export default {
  api: 1,
  hooks(ctx) { /* … */ },

  // Called at mod-load time, BEFORE register(), when the bag in the save is
  // behind your manifest's saveSchema. Return the same data in the new shape.
  migrateBag(data, fromSchema, ctx) {
    if (fromSchema < 2) return { kills: Object.keys(data.killed ?? {}).length };
    return data;
  },
};
```

Only you can do this — nobody else knows what is in there. What the game does
around it:

| Situation | What happens |
|---|---|
| bag behind `saveSchema`, `migrateBag` present | it runs, and the schema is stamped forward |
| bag behind `saveSchema`, **no** `migrateBag` | the old data is kept **exactly as it was**, and the player is told your mod has data it may not understand. The schema is *not* stamped forward — you would be handed old data labelled new |
| `migrateBag` throws, or returns nothing | the old bag stands, and the reason goes on your mod's row |
| bag **ahead** of `saveSchema` (the player rolled you back) | nothing is changed, and the player is told. A migration backwards is something only you could write |
| you declare no `saveSchema` | nothing happens, ever |

If you would rather branch on the schema inline than ship a migrator, you can:
the bag carries its own `schema` and you can read it. Omitting `migrateBag`
*after* bumping `saveSchema` is the case the game reports, because it cannot tell
that apart from an oversight.

## Why the engine is not imported

`ctx.core` **is** the engine — the same live module instance the game is running
on, passed in rather than imported.

This is not a limitation, it is the point. A bare specifier like
`import { tunnelAux } from "@rpgm-tools/neo-angband-core"` cannot resolve in a module fetched
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
| `prefs` | `{ get(), set(value) }` — one JSON value of **yours**, kept outside every save |
| `newCharacter` | whether this session's character was just created, rather than loaded |
| `log` | a diagnostic line; the host decides where it goes |

`flags` is sliced per mod on purpose: a mod must not be able to read or act on
another mod's toggles, or its behaviour would silently depend on which other mods
the player happened to enable.

### `state` is absent in `hooks`, and it always will be

The row above is easy to skim past and it is load-bearing. The host composes
every enabled mod's hooks **before it starts the game**, because the composed
`ModHooks` is an argument to `startGame` — so there is no `GameState` to hand you
yet, and there never can be. `hooks(ctx)` is a factory over your flags; anything
needing the live game belongs in `register(host, ctx)`, which runs once with the
game built.

If you need the engine at `hooks` time for something that is not the live game —
classifying option names, reading a constant — `ctx.core` is there and is the
same module instance the game runs on.

### `prefs`: the place for data that outlives a character

Your mod has two places to put data and they are not interchangeable.

| | lives in | dies when | for |
|---|---|---|---|
| save bag (`state.mods[id]`) | the character's save file | that character does | what happened to this character |
| `ctx.prefs` | the player's install | never, until you clear it | what this player likes |

`prefs` is one JSON value, replaced whole, scoped to your mod's id by the host —
you cannot read another mod's, and passing a different id is not a thing you can
do. Setting `null` forgets it. Every failure is swallowed and logged rather than
thrown at you: a full disk must not take your mod down from inside a hook.

Where there is no storage at all, `prefs` still exists and simply never
remembers, so a mod written against it runs on a front end that has none.

Reach for `localStorage` yourself and you have hard-coded a browser into a mod
that would otherwise run anywhere the game does.

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

`import { tunnelAux } from "@rpgm-tools/neo-angband-core"` cannot resolve from a folder, and
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

## Front-end replacement

`frontend(ctx)` is an optional `plugin.js` member. It returns a sink for the
live map stream (or `undefined` to decline):

```js
export default {
  api: 1,
  frontend(ctx) {
    return {
      present(frame) {
        // frame.cells: semantic terrain/occupant layers and visibility,
        // not terminal characters that need reverse-parsing.
      },
    };
  },
};
```

The manifest must request **`display:replace`**, and the player must approve it:

```json
{ "shape": "plugin", "capabilities": ["display:replace"] }
```

Declaring `frontend` without it is reported by name and the game keeps drawing.
It is deliberately not a `registry:` domain and **`registry:*` does not cover
it**: an override grant changes one named game system among many, while this one
means everything the player sees of the dungeon comes from the mod. That is the
same reasoning that makes `controller` require `command:add`.

For TypeScript, import the public data contract type-only from the SDK:
`import type { WorldFrame, WorldFrameSink } from
"@rpgm-tools/neo-angband-mod-sdk"`. The build erases that import, so a folder
plugin still has no bare runtime dependency. There is one slot and the **last
eligible mod in load order wins**; earlier frontend factories are not called.
The host hands the winner a frozen, structurally owned snapshot per real map
repaint. It is safe to retain for an animation frame, but cannot expose or
mutate the live player-grid object. A frontend that throws loses its display
attempt and the game's own renderer resumes.

**The game's renderer competes in that same list, as candidate zero.** It
declares `frontend` and `display:replace` exactly as a mod does, and it wins
whenever no mod outranks it - it is not a fallback the selection falls through
to. That is what makes the seam's claim checkable rather than aspirational: if
it could not express the front end the game already ships, "a mod can replace
the front end" would be a claim about a shape nobody had built through it.

This replaces the map display only. Menus still use `registry:menu`, and input
still enters through the host's device-neutral input door; gamepad bindings and
whole-screen ownership are later seams.

## Capabilities

The `GridSurface` rendering contract is host infrastructure, not a registry
capability. `frontend` is a direct `ModPlugin` member because it selects one
display owner rather than registering an independent game behaviour - and it is
gated by `display:replace`, its own capability kind, for the same reason.

The live `WorldFrame` in
`packages/web/src/world-view.ts`: `render()` invokes the extracted
`world-render-data.ts` with the actual map-knowledge reads and passes its
frame to a `WorldFrameSink`; the default glyph terminal
is that sink and consumes its fallback visual
projection, including the terrain-under-foreground tile inputs for a path over
otherwise bare seen terrain. The frame
carries semantic feature/trap/object/monster ids,
visibility, ordered layers, cursor, and player placement, so a selected front
end can make an isometric or 3D view without decoding terminal glyphs.
The Phase-4 control executes the same producer used by `render()`, checks its
unmodded pre-frame glyph tuples, and tees that exact frame to an independent
host sink in the same call.
The selected frontend receives a frozen copy of that frame; the unselected and
absent paths leave the exact glyph sink active.

The same is true of `UiInput` in `packages/web/src/input-door.ts`. It is the
single device-neutral route by which keyboard and keymap input reaches screens;
its direction carries an analog vector and angle. It does not grant a plugin a
binding registry in this phase. Stored player keymaps are evaluated first when
the root owns input; score pages, modals, and run interruption retain their
existing literal-key gates, so a mod must not use injected input to outrank the
player's chosen mapping or an active screen.

`register` reaches fifteen registries, each gated by a capability your manifest must
declare **and** the player must consent to:

| Capability | What it opens |
|---|---|
| `registry:effect` | add a new effect code, or replace a core one — combat, healing, teleport, detection |
| `registry:room` | room and level builders, referenced from a dungeon profile |
| `registry:profile` | whole-cave builders and dungeon profiles — a new *kind* of level, and which kind you get at a depth |
| `registry:blow` | what a monster's attacks do to you, and new kinds of attack — `define()` takes one description and the engine derives both of the handlers it needs |
| `registry:store` | what a shop will buy, and how many of a thing it stocks |
| `registry:command` | what a player command *does* |
| `registry:monster` | a hook at the top of every monster's turn; return true to take the turn over |
| `registry:projection` | what a projection does to terrain, floor items and the player — `projections.feat` / `.obj` / `.player`, one projection `code` at a time. This is the behaviour half of adding your own element: the `projection.json` record makes it exist, these three make it *do* something |
| `registry:glyph` | what one character of a room-template or vault layout means when the level is drawn — `glyphs.set("vault", "Q", ...)`. The behaviour half of shipping a vault with a symbol core has never seen |
| `registry:effect-info` | what the game *says* about an effect — `effectInfo.text` (the menu row and the recall sentence), `.summary` (the object properties an activation grants), `.subtype` (the named subtypes it accepts) and `.request` (which item it prompts for). This is the description half of `registry:effect`: without it your new effect works and the game has nothing to say about it |
| `registry:tval` | what an item CLASS *is* — `tval.classes` (keyed on the predicate's own name, so `handlerFor("tvalIsWeapon")` returns core's arm and a mod ORs its own tval into it), `.good` (whether a template counts as good for allocation) and `.valueBase` (what an unidentified item of the class is worth) and `.basename` (what the class is CALLED - without it every message, menu row and shop line naming the class reads the literal "(nothing)"). Shipping a new *item* needs no capability; this is the class |
| `registry:randart` | how RANDOM artifacts are built — `randart.abilities` (what a power does), `.prep` (what an item class starts with), `.census` (which frequency bucket it feeds) and `.redundancy` (whether an activation duplicates something the artifact already has). Shipping a *fixed* artifact needs no capability; this is the generator |
| `registry:rune` | what a RUNE is — the unit of object knowledge. `rune.desc` (the recall line), `.name` (the display decoration), `.knows` / `.learn` (the knowledge pair, handed the player so YOUR mod keeps the store — core never grew a slot for it), `.objectHas` (whether an item carries it) and `.modMessage` (the "You feel stronger!" line, keyed on the modifier). Plus `.contribute`, which is how your rune gets into the list every consumer enumerates — without it the six tables above are handlers nothing ever calls |
| `registry:vocab` | declare genuinely new vocabulary (flags, stats, mod-coined kinds) and store per-entity values |
| `registry:menu` | rewrite one stable menu id's semantic rows. `menus.handlerFor(id)` returns the earlier transformer, so a later mod wraps it before calling `menus.register(id, ...)`; a throw or a non-row-array result is reported against that mod and leaves the original menu usable |

A facade you did not declare throws when you touch it, even if the player
consented to something else. Consent says the player allowed these domains; the
manifest says you asked for them; both must hold.

### Overwriting and extending — yours, core's, or somebody else's

Every registry here is keyed, and you write **one key at a time**. That is what
makes two mods able to touch the same system: the last one to write a key wins
that key, and every other key either mod wrote survives. Handing over a whole
table instead would mean the second mod loaded silently erased the first.

Each facade also hands back what is installed *right now*, so extending is the
same move as replacing:

```js
register(host) {
  // Your own element, given a body.
  host.projections.player.set("frost:rime", (ctx) => {
    ctx.msg("The rime bites deeper than cold.");
    ctx.incTimed(TMD_SLOW, 5, true);
  });

  // Core's FIRE, extended. `previous` is core's handler — or, if a mod loaded
  // before yours already replaced it, THEIRS. You do not need to know which.
  const previous = host.projections.player.handlerFor("FIRE");
  host.projections.player.set("FIRE", (ctx) => {
    previous(ctx);
    ctx.msg("Your cloak smoulders.");
  });
}
```

`handlerFor` is on every facade in the table above (`blows.handlerFor`,
`stores.willBuyFor`, `profiles.builder`, …). Reach for it before reimplementing
anything: a wrapper survives a core change that a copy does not.

Menus are declared by stable ids such as `core:game-menu` and
`core:knowledge-group`, never their localized titles. Each row has a stable
`id` plus `semantic: { kind, ref?, data? }`: a command wheel can use a command
row's `ref`, while an inventory grid can use an item row without reverse-parsing
the label. A transformer receives those rows, may add/remove/reorder/relabel,
and returns the replacement row array:

```js
register(host) {
  const previous = host.menus.handlerFor("core:game-menu");
  host.menus.register("core:game-menu", (id, rows) => [
    ...(previous ? previous(id, rows) : rows),
    { id: "my-mod:rest", label: "Rest", semantic: { kind: "command", ref: "rest" } },
  ]);
}
```

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
