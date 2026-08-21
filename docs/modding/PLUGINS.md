# Mod plugins: shipping CODE in a mod folder

A mod that only changes records needs no code: drop `manifest.json` plus one
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

Only `plugin.js` is loaded by name. Everything else your code reaches itself:
scripts by importing them, everything else through `ctx.assetUrl`.

`manifest.json` must declare the **`plugin` facet** and `modApi`.

A mod that only runs code can say `"shape": "plugin"` and stop there. A mod that
contributes **both** records and code (the ordinary case, e.g. a new monster
plus the behaviour that makes it interesting) lists both facets:

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
it. It is stored with a `schema` number, whatever your manifest's `saveSchema`
was when it was written.

When you change the SHAPE of that data, bump `saveSchema` and ship a
`migrateBag`:

```js
export default {
  api: 1,
  hooks(ctx) { /* ... */ },

  // Called at mod-load time, BEFORE register(), when the bag in the save is
  // behind your manifest's saveSchema. Return the same data in the new shape.
  migrateBag(data, fromSchema, ctx) {
    if (fromSchema < 2) return { kills: Object.keys(data.killed ?? {}).length };
    return data;
  },
};
```

Only you can do this: nobody else knows what is in there. What the game does
around it:

| Situation | What happens |
|---|---|
| bag behind `saveSchema`, `migrateBag` present | it runs, and the schema is stamped forward |
| bag behind `saveSchema`, **no** `migrateBag` | the old data is kept **exactly as it was**, and the player is told your mod has data it may not understand. The schema is *not* stamped forward, so you would be handed old data labelled new |
| `migrateBag` throws, or returns nothing | the old bag stands, and the reason goes on your mod's row |
| bag **ahead** of `saveSchema` (the player rolled you back) | nothing is changed, and the player is told. A migration backwards is something only you could write |
| you declare no `saveSchema` | nothing happens, ever |

If you would rather branch on the schema inline than ship a migrator, you can:
the bag carries its own `schema` and you can read it. Omitting `migrateBag`
*after* bumping `saveSchema` is the case the game reports, because it cannot tell
that apart from an oversight.

## Why the engine is not imported

`ctx.core` **is** the engine: the same live module instance the game is running
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
| `flags` | **your** resolved rule toggles: `choices[flag] ?? rule.default`, sliced to the rules your own manifest declares |
| `core` | the live engine namespace: core's entire public API |
| `state` | the live `GameState` (present in `register`, absent in `hooks`) |
| `assetUrl` | `(path) => Promise<string \| null>`, a URL for one of *your* files |
| `data` | your own record files, parsed, keyed without `.json` |
| `prefs` | `{ get(), set(value) }`, one JSON value of **yours**, kept outside every save |
| `newCharacter` | whether this session's character was just created, rather than loaded |
| `log` | a diagnostic line; the host decides where it goes |

`flags` is sliced per mod on purpose: a mod must not be able to read or act on
another mod's toggles, or its behaviour would silently depend on which other mods
the player happened to enable.

### `state` is absent in `hooks`, and it always will be

The row above is easy to skim past and it is load-bearing. The host composes
every enabled mod's hooks **before it starts the game**, because the composed
`ModHooks` is an argument to `startGame`, so there is no `GameState` to hand you
yet, and there never can be. `hooks(ctx)` is a factory over your flags; anything
needing the live game belongs in `register(host, ctx)`, which runs once with the
game built.

If you need the engine at `hooks` time for something that is not the live game
(classifying option names, reading a constant), `ctx.core` is there and is the
same module instance the game runs on.

### Engine-wide settings you change through `ctx.core`, not through a hook

A few of the engine's decisions are not taken inside a turn and have no game
state to hang a hook on. Those are exposed as a **module-level policy** you set
once, and `hooks(ctx)` is where you set it: it is the earliest moment your code
runs, before `startGame`, and before boot reads anything.

The one that exists today:

| Call | Changes | Faithful default |
|---|---|---|
| `ctx.core.setPrefErrorPolicy(policy \| null)` | What a pref file does with a line it cannot parse. `{ continueAfterError, reportLimit }`, whether the rest of the file is still applied, and how many errors the player is told about. | `UPSTREAM_PREF_ERROR_POLICY`: stop at the first bad line, which is what `process_pref_file_named` does in 4.2.6. |

```js
hooks(ctx) {
  if (ctx.flags["mymod.forgivingPrefFiles"]) {
    ctx.core.setPrefErrorPolicy({ continueAfterError: true, reportLimit: 20 });
  }
  return {};
}
```

Three rules, and they are the same rules the rest of the mod system runs on:

- **Last load wins, and there is exactly one winner.** The host calls each
  enabled mod's `hooks` in load order, so the last mod to set a policy is the one
  that stands, the same promise the mod manager's row makes the player ("Move
  later (loads last, wins conflicts)"). There is nothing to fold: two policies
  cannot be merged into a third that is either of them, which is why this is not
  a `ModHooks` member. If your mod cares, say so in its README; a player who
  installs two mods with opinions about the same policy will get the later one.
- **Only set it when your flag is on.** Setting the faithful default explicitly
  is not the same as not setting it: it still makes your mod the winner, and
  still overrides a mod loaded before you. A patch the player switched off must
  not call at all.
- **Turning your mod off really does take it away.** A module-level value would
  otherwise outlive a mod being disabled, but disabling does not take effect
  inside one process. The manager prompts to save and reloads, and after the
  reload your `hooks` is never called, so nothing installs a policy and the
  engine is back on its faithful default. `setPrefErrorPolicy(null)` is the same
  seam for a test.

Guard the call if your `engine` range allows a version that predates the seam:
`typeof ctx.core.setPrefErrorPolicy === "function"`. The range is the gate; that
check is the seatbelt, and a `ctx.log` line when it fires is what stops a mod
being silently inert.

### `prefs`: the place for data that outlives a character

Your mod has two places to put data and they are not interchangeable.

| | lives in | dies when | for |
|---|---|---|---|
| save bag (`state.mods[id]`) | the character's save file | that character does | what happened to this character |
| `ctx.prefs` | the player's install | never, until you clear it | what this player likes |

`prefs` is one JSON value, replaced whole, scoped to your mod's id by the host:
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
  browser folder: a file's address there only exists once its text is final, and a
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

`ctx.assetUrl` only ever reaches **your own** folder: the id is fixed by the host,
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
side is behind: a too-new mod needs a newer game, a too-old one needs a mod
update, and "incompatible" on its own sends the player to the wrong place.

It is declared in the **manifest**, not only inside `plugin.js`, so an incompatible
plugin can be refused *before* it is imported. A version check inside the module
can only run after the module's top-level code has already executed, which is the
wrong order for code that came out of a folder anyone can write into.

## What has to be true before your code runs

In order, and all of it before the import:

1. the folder ships `plugin.js` (from the directory listing, with no probing);
2. the mod is **enabled**, since a disabled mod's code does not exist, the same rule as
   a disabled mod's patches;
3. the manifest declares the `plugin` facet (via `shape` or `facets`);
4. `modApi` matches;
5. the player has **consented** to every capability the manifest requests.

Then the module is imported and its default export is shape-checked.

Nothing about a bad plugin can stop the game booting. A hand-edited manifest, a
half-finished download, a plugin that throws at import or inside `hooks()`: each
becomes one line the mod manager shows, and the other mods carry on.

### Message types are declared as DATA, not in `register()`

`register()` runs after the game has been bound, **384 top-level statements
after**, measured rather than estimated, so a message type declared there is
declared after every record that could have named it. And a content-only pack has
no `register()` at all, so for the packs most likely to want one this was not
late, it was unreachable.

So if your pack's own spell, blow method, summon or projection carries a `msgt:`,
ship the type as a `message_type` record file instead:

```json
{ "records": [
  { "name": "SOULFIRE", "sound": "soulfire", "sounds": "sf_one sf_two" }
] }
```

`name` is the bare `MSG_` name a `msgt:` spells, `sound` is the `sound.prf` key
the type plays under, and `sounds` is the space-separated sample list bound to
it, all three, because a pack that could name a type and never bind a sample to
it would be half a capability. **No capability and no `plugin.js` are needed**: it
is a record file like any other, and gating one record file while a pack may
already add a projection, a monster, an artifact and an ego item ungated would be
a fence with no wall attached.

Declarations are additive, attributed to the pack that coined them, idempotent
across the new-game and load paths, and **never throw**: a refused declaration
loses one message type and reports it rather than taking the boot down.

`host.messages.define(...)` still exists and is still the right call for a type a
plugin coins at runtime, e.g. to re-point sounds. It is only the wrong place for
a type your own records name.

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

A complete worked example lives in **`samples/blueprint-view/`**, a folder you
can copy straight into a mods folder. It draws a blueprint of the dungeon from
the frame's semantic layers, and `packages/web/src/sample-blueprint.node.test.ts`
loads that folder by path and records what it draws, so the sample is checked
code rather than an illustration. It has also been run in the installed desktop
build, which is where the missing viewport geometry stopped being theoretical;
see **Where you may draw** below for what it now reads instead.

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

### Where you may draw: `frame.regions`

Every frame carries the named parts of the screen, so a front end no longer has
to guess where the map is:

```js
present(frame) {
  const box = frame.regions?.map?.pixels;
  if (!box) return;                       // no geometry: draw NOTHING
  canvas.style.left = `${box.x}px`;
  canvas.style.top = `${box.y}px`;
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  // ...
}
```

`regions` has `map`, and, depending on the player's sidebar mode, `messages`,
`sidebar` and `status`. Each carries `cells` (a rectangle of the character grid)
and `pixels` (CSS pixels in the game window's coordinate space, the space
`getBoundingClientRect()` answers in). `map` is yours while you hold the
display; the others are core's and are published so you can stay off them, or
cover them knowing what you are covering.

Three things worth knowing:

- **The names are roles, not places.** `sidebar` is the 13-column left column in
  the classic layout and a one-line header under the messages in the compact
  one, and it is **absent** when the player has turned the vitals off. Read it
  every frame rather than caching it: it moves on a resize, on a sidebar-mode
  change, and when a narrow window forces the compact layout.
- **`regions` is optional.** A host with no fitted surface has none to give.
  Treat that as "draw nothing", not as "fall back to the window": falling back
  reintroduces the defect below, intermittently.
- **The map is one column narrower than the screen.** That is upstream's own
  rule (`SCREEN_WID` reserves the rightmost column), not a rounding error.

**Two properties the four regions have today that will not hold forever.** They
tile the screen without overlapping, and the set is closed. Neither is a promise:
the UI seam (`MOD_REACH.md` gap 21) is decided to make a full screen **composed
of** regions rather than covering them, which means regions will overlap, gain a
stacking order, and be creatable by a mod: a floating window over a map that is
still being drawn is the whole point of it. Nothing in the code above changes
when that lands; code that *infers* disjointness does. Read `regions.map` and
draw in it; do not compute your rectangle by subtracting the others.

**Covering the window costs the player everything else on it.** Before regions
existed, running the sample in the installed build made this plain:
`display:replace` really does replace the map only: core stops drawing the
dungeon and goes on drawing the sidebar, the message line and every menu, but a
front end that covers the window paints over all of it, so you could not read
your hit points, see a message, or open the Mods screen to turn the mod off. You
would have had to edit the enabled set by hand.

A front end is still *allowed* to take the whole window; an isometric or 3D view
may want to. What the regions change is that it is now a decision, taken knowing
what is being covered, rather than the only thing a mod could do.

### Knowing when you are covered: `frame.stack`

`frame.regions` says where the map is. `frame.stack` says what is on top of it:
every region on screen, bottom to top, beginning with the four base tiles
`regions` names. A region later in the array is drawn over one earlier in it.
Find the entry whose `id` is `"map"`; if any entry after it overlaps its `cells`,
hide your display.

```js
function coveredUp(frame) {
  const stack = frame.stack;
  if (!stack) return false;                  // this host publishes none
  const at = stack.findIndex((r) => r.id === "map");
  if (at < 0) return true;                   // a stack that stopped naming the map
  const map = stack[at].cells;
  return stack.slice(at + 1).some((r) =>
    r.cells.col < map.col + map.cols && map.col < r.cells.col + r.cells.cols &&
    r.cells.row < map.row + map.rows && map.row < r.cells.row + r.cells.rows);
}
```

`samples/blueprint-view/plugin.js` ships exactly this. The game's own copy of the
question is `occludersOf` in `packages/web/src/regions.ts`, with
`regionsIntersect` (the four comparisons above) beside it. Neither is reachable
from a mod, and that is a property of how a mod is loaded rather than an
oversight: a module fetched from a mod folder cannot resolve a package by name,
so `neo-angband-mod-build` marks every bare specifier external and fails the
build on any that survive. **Types cross that line, because the build erases
them; functions do not.** Publishing these two through the SDK would therefore
publish a member no mod could import. So write your own as above: it is nine
lines, and keep the `undefined` case, which is the part worth copying.

**You will be told.** The game's own screens (the inventory, the knowledge
browser, the Mods screen you would use to turn this mod off) repaint the
terminal *without producing a world frame*, because a screen redraws from its own
key loop. So when the stack changes with nothing behind it, the host presents
your **last** frame again with `stack` updated. The cells will be the ones you
already drew; that is deliberate. Re-projecting the world from a shell that is
not in a repaint would be inventing a frame, and nothing has run that could have
changed the dungeon. The stack is the part that changed, and it is the part to
read.

The notification fires when the composite **changes**, not every time it is
recomputed: a listener on every recompose would double every repaint for news
that had not changed.

**There are THREE answers here, not two, and the third is the one worth writing
down.** An empty stack, or one whose entries do not overlap you, means nothing is
over you. A **missing** `stack` means this host publishes none, so nothing is
known, so draw, because `place()` already declines when there is no pixel
geometry to draw into. But a stack that **is** published and does **not contain
`"map"`** is a host that has stopped describing the map, and that is COVERED, not
clear. Collapsing that case into "nothing is over me" is how a mod canvas ends up
cheerfully painting over whatever replaced the map, for ever, with no error
anywhere.

A HUD region owner reads the same field on `HudFrame`, asking about its own
section's `region.name`.

**What this does not yet reach:** a mod *presenter* holding a screen does not
push a region, so the check above answers "nothing is over me" while a
presenter-owned screen is up. That is incompleteness, not wrongness: the
notification is correct for every region that *is* pushed, and today the
text-screen path is what pushes them.

## The HUD, region by region

`hud(ctx)` is the companion to `frontend(ctx)`. `frontend` is the dungeon; `hud`
is everything around it: the message line, the vitals, the status line, and
unlike the map, **it is owned one region at a time**:

```js
export default {
  api: 1,
  hud(ctx) {
    const canvas = makeMyPanel(globalThis.document);
    return {
      sidebar: {
        present(section, frame) {
          const box = section.region?.pixels;
          if (!box) return;                       // no geometry: draw nothing
          placeOn(canvas, box);
          for (const entry of section.entries) {
            draw(entry.key, textOf(entry), inkFor(entry.runs[0]?.color));
          }
        },
      },
    };
  },
};
```

Return a sink for each region you are taking and omit the rest; they stay the
game's and keep being drawn. `undefined` or `{}` declines everything, which is
the right answer on a host you cannot draw on: a *throwing* factory also loses
your regions but is reported as your fault, and "there is no document here" is
not a fault.

Each region needs its own capability, or the wildcard for all three:

```json
{ "shape": "plugin", "capabilities": ["ui:sidebar.replace"] }
```

`ui:messages.replace`, `ui:sidebar.replace`, `ui:status.replace`,
`ui:*.replace`. There is deliberately no `ui:map.replace`: the dungeon is
`display:replace`'s, and one region answering to two capabilities would be two
answers to "who draws this". The two do not cover each other in either
direction: holding the map does not let you draw the vitals, and holding the
whole interface does not let you draw the map.

**The capability is the claim.** The host picks each region's owner from the
*manifests*, before it calls anybody's `hud()`, so a mod that loses is never
constructed and cannot mount UI it will never draw into. Two consequences follow,
and both are worth knowing before you write the manifest:

- A sink for a region you did not ask for is **dropped and reported by name**.
- A region you won and then declined goes back to the **game**, not on to the
  next claimant. Ask for the regions you actually draw.

**What you get on every repaint** is your own `section` plus the whole `frame`,
both frozen and structurally yours, so retaining one to animate from is safe. The
frame is the context that changes what a section *means*: `frame.targeting` says
the message row is a look-description rather than a message, and `frame.layout`
(`"left" | "top" | "none"`) says whether the vitals are a column, a one-line
header, or turned off. Under `"none"` there is no `sidebar` section at all and
your sink is simply not called: the player turned the furniture off, which is a
choice to respect rather than one to style.

Read `entry.key`, one of `hp`, `sp`, `ac`, `depth`, `state`: the engine's own
`side_handlers[]` / `status_handlers[]` name minus its `prt_` prefix, and
`run.color`, its `COLOUR_*` attribute, which you resolve through
`ctx.core.COLOUR_L_GREEN` and friends **by name**, never by the number it
currently has. `run.css` and `entry.screen` are the faithful terminal's own
projection: there for a text-mode replacement, and the thing to ignore if you are
drawing your own.

**A fault costs you one region.** If your `status` sink throws, the game resumes
drawing the status line for the rest of the session and says so by name; your
`sidebar` keeps drawing, and the player keeps their game.

**Draw bars from `entry.values`, never from the text.** An entry carries the
numbers its text was formatted from, so hit points arrive as
`{ current: 7, max: 34 }` beside `"HP   7/  34"`. Parsing the string works right
up until somebody loads a pref file, plays in another language, or a content pack
widens a field: it is the reverse-engineering this seam exists to end.

The convention is one rule and it is worth reading once. **`current` and `max`
TOGETHER mean the field is a proportion**, and `current / max` is meaningful.
Every other key is a plain named quantity. A field with two numbers that are *not*
a ratio deliberately avoids those names: a stat publishes `use` / `cur` / `max`,
because `118` is an encoding meaning 18/100 and a bar over it would report a maxed
character as 15%. So `if (v.current !== undefined && v.max !== undefined) drawBar()
else drawText()` is safe on every field, including ones added after you shipped.

Absent always means *the game does not know*, never zero: the monster health bar
publishes nothing while it reads `[----------]`, and `sp` is absent for a class
with no mana rather than `0/0`. The full per-field key list is on `HudValues` in
the SDK.

`samples/vitals-panel/` is a complete worked example: it takes `sidebar` alone
and leaves the rest of the screen to the game.

## `menu(ctx)`: ask the game's questions your own way

The third owner seam, and the one that is different in kind. A HUD section is
**drawn**; a menu is **asked**. So the boundary is not `present(frame)` but
`ask(question) → answer`, and taking a question means taking its input too: a
presentation that could not accept a choice would not be a presentation of a
menu.

```js
menu(ctx) {
  return {
    ask(question) {
      if (question.id !== "core:game-menu") return undefined;   // decline
      return drawDialAndWait(question);                          // → MenuAnswer
    },
  };
}
```

Gated by the single `ui:menu.replace` capability (or the wildcard
`ui:*.replace`). **One grant for every menu**, not one per menu id: there are
~50 of them, and 50 capability strings would be a consent list nobody could read.

**Declining is the normal case, not a failure path.** Your presenter is offered
every menu the game asks, and returns `undefined` from `ask` for the ones you
have no better way to present; the game then asks those its own way. A radial
dial for six command verbs genuinely has no opinion about the mod manager's
thirty-row list. Declining costs nothing: you drew nothing, and there is no
surface left half-owned.

**Answer by the choice's stable `id`, never by an index.** An index is a fact
about a layout, and if you have grouped the choices into the wedges of a dial you
have no index the game would recognise. Read `choice.semantic` (`{kind, ref}`) for
what a choice *means*, independent of its wording, and `question.id` to recognise
which question you are being asked.

The answers are `choose`, `cancel`, `command` and `options`. **`command` runs one
of `question.commands`**, the caller's own handler, exactly as the key would,
and the question is then asked *again* unless that handler resolved it. That is
how a reimagined store can offer "buy" without knowing what buying does. You
cannot invent those keys; they belong to whoever opened the menu.

**Throwing costs you the seam for the session, on every menu**, unlike `hud`,
where a fault costs one region. A presenter that throws on one question generally
throws on all of them, and one report beats a report every time the player opens
anything. Answers that cannot be honoured (an unknown choice id, a choice on a
browse-only question, a command key that was never offered) cost you *that menu
only*, and are reported.

**A menu still has no published region of its own**, though overlapping, ordered,
mod-created regions have since landed; see [`regions(ctx)`](#regionsctx-put-furniture-of-your-own-on-the-screen).
`regions.ts` names the four parts of the screen that tile it, and a floating menu
is by definition one that overlaps. `question.style` tells you whether the game
would have cleared the screen (`"screen"`) or drawn a box over a still-visible
map (`"overlay"`).

`samples/command-dial/` is a complete worked example: it takes the game menu and
declines every other question in the game.

## `screen(ctx)`: show the game's full screens your own way

The fourth owner seam, and the one that reaches the **content** rather than the
frame. Before it, the inventory arrived as `ScreenLine[]`, a row of characters
and a colour, so a mod wanting to draw items as sprite cards would have had to
parse `"a) a Potion of Cure Light Wounds       4.0 lb"` back into a name and a
weight, and would break the day a pref file changed a colour or a translation
changed a width. A screen now arrives as a **document of blocks**.

```js
screen(ctx) {
  return {
    show(view) {
      if (view.id !== "core:inventory") return undefined;        // decline
      const table = view.blocks.find((b) => b.kind === "table");
      drawCards(table.rows);            // row.cells.name.text, row.semantic, ...
      return { dismissed: whenThePlayerCloses() };
    },
  };
}
```

Gated by the single `ui:screen.replace` capability (or the wildcard
`ui:*.replace`), on the same bargain as `menu`: **one grant for every screen**,
and the fine choice made per screen by declining.

**A list is a `table`, and cells are addressed by column key.** Columns have
stable keys: `name`, `slot`, `weight`, `turn`, so you read `row.cells.name.text`
and never count characters. A column publishes three facts about the *terminal's*
layout, all of which you are free to ignore: `width` (the field width where
upstream fixed one), `gap` (columns of space before it, as the history screen writes
`"%10ld%7d'  %s"`, no gap before the depth and two before the note) and `pad`
(false where the game does **not** line the column up, as the object list's
location simply follows the name). They are published *beside* the data rather
than baked into it as padding, which is what makes both renderings possible from
one model.

**A row means something.** `row.semantic` is the same `{kind, ref}` a `MenuChoice`
carries, so an item is one thing to you whether the game is listing it or asking
you to pick one: an inventory row and its picker choice share an id. An empty
equipment slot is `{kind: "slot"}` rather than an item. `row.color` is the
object's own attr as CSS, and `row.tag` the letter the terminal would offer.

**Numbers come with the text.** `cell.values` follows the HUD's convention
exactly: `current` + `max` *together* mean a proportion; every other key is a
named quantity; absent means the game does not know it. A weight cell publishes
`{each, total, number}` in tenths of a pound, so you format it your own way.

**Check `row.values` as well as `cell.values`.** The model is allowed to carry
*more* than the rendering, never less, so a number the terminal has no column for
lives on the row: the quiver publishes its weight that way, the object list its
offset as `{dy, dx}` rather than only as `"2 N 0 W"`, the player history the
character level it never prints. Those are exactly the numbers a presenter needs
and a text screen cannot show.

**Prose arrives UNWRAPPED, in a `text` block.** `paragraphs` is a run stream per
paragraph, split where the game meant a break and nowhere else, so the object
recall, the object comparison and the monster recall hand you the text and let
*you* choose the width. That is the difference the block exists for: a `lines`
block has already been broken into terminal-width rows, and re-flowing those to a
panel of your own size means undoing the game's wrap first and guessing which
breaks were the game's and which were the sentence's. `block.color` is the
prose's default, for the parts no run speaks for.

`block.flow` names **which** of Angband's two wraps laid the prose out, for a
presenter that wants to reproduce the terminal rather than re-flow. Absent means
`textblock_calculate_lines`, which is every page but one; `"text-out"` means
`text_out_to_screen`, which is the character sheet's history and nothing else.
They differ by two columns and by whether a sentence's second space survives a
break, so a renderer that assumed one rule for both was wrong on one of them.
Most presenters can ignore this entirely: it matters only if you are wrapping
*as the terminal would* rather than at a width of your own.

**Art and the writing on it are separate.** An `art` block's `lines` are the
picture, the tombstone or the winner's crown, and its `fields` are the text the
game writes *onto* the picture. Upstream's tombstone is one drawing with the
character burned into columns 8-39 of it, so a presenter handed only the drawing
would have to know that to get the name back. Instead each field carries a stable
`key` (`name`, `title`, `class`, `level`, `exp`, `gold`, `death`, `killer`,
`date`), its `text`, and `values` where the text is a formatted number. The
`row`/`x1`/`x2` beside them are where the *faithful terminal* puts each one;
ignore them and draw a real gravestone. A field with no band is centred on the
full width, which is what upstream does for the winner's banner.

**A column can carry a picture, and a table can space itself.** The character
sheet's flag grid has one column per equipment slot, and upstream draws the *worn
item's* glyph over each. That is a fact about the column (what is in this slot),
so it arrives as `column.glyph` rather than as a first row you would have to know
to skip; draw the item's icon there. Two more layout facts published beside the
data rather than baked into it: `headerColor` is the header row's colour where the
game colours it, and `gapAfter` is the blank rows the faithful terminal leaves
under a table. A `text` block's `wrap` is the same idea for prose: the width
*upstream* wraps at (72 for the character history on an 80-column screen), always
a clamp and never a minimum. Ignore all four if you lay things out yourself.

**Not every screen has a model yet.** `MODELLED_SCREENS`
(`packages/web/src/screen-view.ts`) names the ones that do, today thirty-seven: the
inventory, the equipment, the quiver, the object list, the monster list, the
message history, the
player history, the object recall, the object comparison, the monster recall, the
tombstone, the winner, the character sheet's two pages (`core:character` and
`core:character-flags`), the knowledge browser's seven recall pages
(`core:rune-recall`, `core:feature-recall`, `core:trap-recall`,
`core:shape-recall`, `core:artifact-recall`, `core:ego-recall`,
`core:object-kind-recall`), the four help pages (`core:help-commands`,
`core:help-symbols`, `core:help-guide`, `core:help-community`), the
equipment-comparison screen's two help overlays (`core:equip-cmp-help`,
`core:equip-cmp-select-help`), the mod manager's four listings
(`core:mod-updates`, `core:mod-auto-sort`, `core:mod-capabilities`,
`core:mod-conflicts`), the hall of fame (`core:hall-of-fame`), the knowledge
menu's store view (`core:store-knowledge`), the update and report pages
(`core:update`, `core:report`), and wizard mode's two debug readouts
(`core:wizard-keylog`, `core:wizard-item`). Everything else arrives under the
shared id `core:text` with a single `lines` block of pre-wrapped rows: enough to
reskin a frame, not enough to reimagine a listing. **Check `view.id`.**

What is left under `core:text` is now mostly there on purpose. Every
`showTextScreen` call site in the mod manager was read one at a time in August
2026 and twenty-four of the thirty-two were ruled **prose**: warnings, outcome
reports, error explanations and a mod author's own description, which are
sentences a human reads and which a presenter gains nothing by addressing field
by field. The screens that are still genuinely unfinished are named in
`MOD_REACH.md` gap 21 rather than left for you to discover: the spell lists,
which belong to the menu seam; and the install-refusal screens, which are no
longer blocked by the model but are not yet wired to it (see the next section).

### Regions are stacked, and a screen is one of them

`ui-stack.ts` holds the live stack. `pushRegion` adds a region, the returned
handle's `release()` removes it, `relayoutStack` re-places every region when the
terminal changes shape, and `paintRegionStack` draws the ones that want a
painter, bottom band to top, each through a surface clipped to its own
rectangle.

`place(grid)` is called on **every** layout change, so its contract is narrow:
**return a rectangle and do no work.** Do not paint in it, do not read the game
in it, and do not throw from it: a resize can arrive between any two
keystrokes. It runs inside a try/catch so one author's mistake cannot take down
the relayout for every other region, and a region whose `place()` throws or
whose rectangle runs off the grid is recorded in `regionStackFaults()` rather
than silently omitted. A silently omitted region is a window that is simply not
there, with nothing to search for.

`paint(surface)` is optional, and its absence is the normal case for core: a
screen that owns the keyboard repaints itself when a key arrives. Give your
region a painter when you want it redrawn every frame: a HUD window over a
live map.

A core screen occupies `core:screen` on the `modal` band and its rectangle is
the whole terminal. **That is not a placeholder and it will not shrink.** A mod
that wants a panel declares its own region rather than asking core to make room;
shrinking core's screens would move pictures that upstream-cited parity tests
pin byte for byte, for the benefit of no mod. To find out whether anything is
over the map before you draw on it, read `frame.stack`; see
[Knowing when you are covered](#knowing-when-you-are-covered-framestack). Core's
own version of the question is `occludersOf` (`packages/web/src/regions.ts`),
which is host-internal and returns `undefined`, not `[]`, when you name a region
that is not in the stack, so a typo reads as a question you cannot answer rather
than as good news. Your own copy should keep that distinction.

### Standing aside for the game's own prompt

A screen's `actions` are the game's own commands, and some of them ask the player
a question on the faithful terminal underneath you. The character sheet's `c`
(rename) opens a name prompt; its `f` (dump to file) asks for a filename. Your
overlay is on top of that terminal. If you keep drawing, the player is answering
a question they cannot see, and the rename reaches `persistSave()`, so **two
keystrokes, `c` then Enter, wrote the save with nothing visible on screen at
all.** Escape was the only key that got out without writing it.

The fix is *not* a rule against prompting inside `ScreenHost.invoke`. That would
make the actions a mod can offer a strict subset of the game's, which is the
opposite of what this seam is for. Instead **the game announces the prompt before
it lands**: a presenter that can stand aside is told what is coming, awaited while
it animates out, and given its screen back afterwards.

    show(view, host) {
      return {
        dismissed,
        yieldTerminal(request) {
          // request: a PromptRequest while the game needs the terminal,
          //          null when you can take it back.
          canvas.style.display = request === null ? "block" : "none";
        },
      };
    }

The request says what is being asked (`label`), which of your `actions` led there
(`action`), a stable identity you can match on without parsing prose (`id`, e.g.
`"charsheet:rename"`), how much of the terminal it needs (`extent`: `"line"` for a
row-0 prompt, `"screen"` for one that clears the grid) and the rectangle it will
land in (`clip`). A `"line"` prompt only needs row 0, so you may keep drawing
everything below it.

**Whatever you return is awaited**, so a fade-out is legitimate and the prompt
will not land until it has finished. There is no timeout.

`yieldTerminal` is optional, and omitting it is not an error, but it is reported
once, by name, with the member to add spelled out in the sentence, and the game
draws its prompt over your screen anyway. It never refuses to run the command:
your actions are not a smaller set than the game's.

**It is on the published type**, in both copies: `ScreenShown` in the host's
`packages/web/src/screen-view.ts` and in the SDK's
`packages/mod-sdk/src/screen.ts`, together with the vocabulary of the
announcement, `PromptRequest` and `PromptExtent`. For TypeScript, take all three
type-only from the SDK, which the build erases like any other type import:

```ts
import type {
  PromptRequest,
  ScreenPresenter,
  ScreenShown,
} from "@rpgm-tools/neo-angband-mod-sdk";
```

It was not always, and what that cost is worth knowing because it is invisible:
until 2026-08-14 the member was declared only on a host-local `YieldingScreen`
and the mechanism worked anyway. Not publishing a member does not stop a mod
implementing it: `tsc` accepts `show: () => ({ dismissed, yieldTerminal })`
against a `ScreenShown | undefined` return with no cast and no excess-property
error. What it stops is *learning that the member exists*, and *being told when
you get it wrong*: `yieldTerminal(request: string)` compiled and was handed a
`PromptRequest` at runtime.

`packages/mod-sdk/src/screen-abi-agreement.test.ts` holds the two copies in
agreement: the member list, `yieldTerminal`'s signature character for character,
the sentence above, and `PromptRequest`'s own field list and types. It reads both
**files**; importing both types would prove nothing, because two structurally
identical interfaces are one type to the compiler, which is the same blindness
that let the member ship unpublished.

**Every action in the `SCREEN_PROMPTS` census is announced.** `charsheet.ts`
covers `core:character` and `core:character-flags` (`rename`, `file`); `main.ts`
covers `core:report`'s `describe` and `core:update`'s `mods`. The last of those is
the interesting one: `mods` opens a whole nested page (`showModUpgrades`) whose
own screens come back round to the presenter that is *already* holding
`core:update`. While you are stood aside you are simply not offered them; the
game shows those itself, because re-offering would ask you to draw over the very
terminal you just cleared.

### A row with a paragraph

`ScreenRow.detail` is prose attached to one row of a table. It is a
`ScreenProse`, the same `{ paragraphs, indent?, wrap?, flow?, color? }` a
`text` block is made of, so a presenter that can already draw a prose block can
draw a detail, and one that only wants the record can ignore it.

The rule for telling the two apart has not changed, and it is why `detail` is
shaped this way: **structure is what has keys; prose is what has paragraphs.**
Anything you need to reach by name is a cell, addressed by its column key. A
detail has no key and is not addressable, and that is deliberate: if you find
yourself parsing a detail, the thing you are parsing is a column the screen has
not declared yet, and that is a bug to report rather than a string to split. The
ids behind a dependency cycle like `A -> B -> A` are on `semantic.data`, where
`autoSortScreen` already puts them.

A detail never affects layout beyond its own row. It is not consulted when
column widths are computed, so a long paragraph cannot widen a column or move
the row above it, and a row without a detail is laid out identically whether or
not its neighbours have one. It also introduces no third wrapping rule: it is
laid out by the same function a `text` block is, and says which of Angband's two
algorithms it wants through the same `flow` field.

This was added because three screens (the install refusal, a dropped auto-sort
suggestion, a declared-conflict claim) are each **a record with a paragraph
attached**, and had been stuck at `lines` because there was nowhere to put the
paragraph. Cutting it into row fragments would have made them `lines` wearing a
costume: a presenter would still have had to know that some rows continue
others.

The seven recall pages are all `text` blocks, and they are seven ids rather than
one on purpose: a mod that draws an artifact's page as a plaque and a trap's as a
warning card has to be able to tell them apart, and a shared id cannot. If you
only want to restyle prose, match on all seven (or on `block.kind === "text"`)
and you are done: nothing in a prose panel needs to know which of them it has.

**A screen is dismissed, not answered**, which is the one shape difference from
`menu`. `show` declines by returning `undefined` **synchronously** and takes the
screen by returning `{ dismissed }`, a promise you resolve when the player closes
it. There is no answer value left to decline with once the promise means "they
closed it", and deciding never needs to be async anyway, since you match on `view.id`.
Resolving `dismissed` is the whole contract: a presenter that forgets is a game
the player cannot get back to.

**Some screens can be acted on, and those hand you a way back in.** Most screens
are only dismissed. The character sheet is not: upstream offers renaming, a
character dump and the page cycle from the same modal, and a presenter that took
the sheet without being able to reach them would quietly take those commands away
from the player. The visible-monster list is the other one: a single action,
`sort-exp` (`x`), which flips the sort between depth and experience. So `view.actions` publishes them as data: a stable `id`
(`rename`, `file`, `page-next`, `page-prev`), the `key` the *faithful terminal*
listens for, and the game's own `label`, and `show(view, host)` hands you a
`ScreenHost` whose `invoke(id)` runs one.

```js
show(view, host) {
  if (view.id !== "core:character") return undefined;
  let shown = view;
  const onKey = (ev) => {
    const action = shown.actions && shown.actions.find((a) => a.key === ev.key);
    if (!action) return;
    host.invoke(action.id).then((next) => {
      if (!next) return close();   // the game has taken the screen back
      shown = next;                // the same sheet renamed, or the other page
      paint(shown);
    });
  };
  ...
}
```

`invoke` runs the **game's** code: a rename still opens the game's prompt, a dump
still writes the game's file, and resolves with what the player should be looking
at next: usually the same screen with new content, or the next page. `undefined`
means the game has taken the screen back; resolve `dismissed` when you see it. An
id this engine has not got is a no-op that hands the current view back, so asking
for a newer command can never close the player's screen. `host` arrives only where
`actions` does, and it is a second parameter rather than a field of the view
because a view is frozen data and a way back into the game cannot be.

**Throwing costs you the seam for the session**, as with `menu`. If you throw
while a screen is *open*, or reject `dismissed`, the game reports you by name and
**shows the screen itself**: a player left staring at a dead overlay has no way
out. That recovery exists so a bug is not a lost character, not as a place to be
relaxed.

**A screen has no published region either.** It covers the window, for the same
reason a floating menu does.

`samples/sprite-inventory/` is a complete worked example: it draws the inventory,
the equipment and the quiver as item cards, lays the recall pages out into a
panel of its own width by measuring them, and declines every other screen.

## `regions(ctx)`: put furniture of your own on the screen

The fifth owner seam, and **the only one nobody wins.**

The other four each answer *who gets it*, because the map, a HUD region, the menu
seam and the screen seam are each one thing and two mods cannot both have it. A
region is not one thing. Two mods that both declare a region are not in
contention at all: they are two pieces of furniture, and they **coexist**, each
at its own band, in load order. "Last load wins" appears here only in its
ordinary form: within a band, the later-loaded region draws on top.

```js
export default {
  api: 1,
  regions(ctx) {
    return [{
      id: "carried",
      layer: "overlay",
      place: (grid) => ({ x: grid.cols - 18, y: 1, w: 17, h: 1 }),
      paint: (surface) => surface.put(0, 0, `Carried ${weight()} lb`),
    }];
  },
};
```

Requires **`ui:region.create`**. Note that `ui:*.replace` does **not** grant it:
the wildcard ranges over which of the *game's* regions changes hands, and adding
one of your own is a different sentence for the player to agree to. Declaring
`regions()` without the capability is reported by name with the fix in the
sentence, rather than silently drawing nothing.

**Your id is namespaced.** Declare `"carried"` and the live stack carries
`my-mod:carried`. That is a correctness rule rather than tidiness: a mod naming
its region `map` would put a second `map` in the stack, and `occludersOf` answers
about the **first** match, so a front end's one question would quietly start
being answered about somebody else's rectangle.

**The unit of failure is the declaration, not the mod.** A rectangle with no
`paint`, a band that does not exist, a duplicate name, a `paint` that throws on
its first frame, and each costs exactly that one region, is reported once, and
leaves your others and every other mod's alone.

**A faulting region is withdrawn, not left empty.** This is the one place the
mechanical answer is wrong: `ui-stack.ts` leaves a faulted core screen in the
composite, which is right for something that still owns the keyboard. Your
decorative panel has no such claim: left in the stack it is a phantom
**occluder**, and a replacement front end asking `occludersOf(stack, "map")`
would stand its canvas down for a region that has drawn nothing since the first
frame. So the handle is released and the region vanishes *with* a message rather
than persisting without one.

**`place(grid)` must be cheap, total and pure.** It runs for every open region on
every frame and on every resize. No game reads, no painting, no allocation you
can avoid. Return the rectangle for a terminal of that size; one that runs off
the grid is recorded in `regionStackFaults()` rather than drawn.

**The `system` layer is reserved to the game** and asking for it is refused with
its own sentence rather than a generic bad-band one: it is a real band, it is
the top one, and the reason you may not have it is a reason rather than a typo.
The mod manager and a fault report have to be drawable *above* a mod, including
above one that has gone wrong. Use `"overlay"` for furniture, or `"modal"` for
something that takes the player's attention.

## Capabilities

The `GridSurface` rendering contract is host infrastructure, not a registry
capability. `frontend` is a direct `ModPlugin` member because it selects one
display owner rather than registering an independent game behaviour - and it is
gated by `display:replace`, its own capability kind, for the same reason. `hud`
is the same shape one level finer: a direct member because it selects an owner,
and gated by `ui:<region>.replace` - per region, because a mod drawing hit points
as a bar has no business taking the message log with it, and because a player
consenting deserves to be told which part of their screen is changing hands.
`menu` is the third, gated by `ui:menu.replace` - and deliberately NOT per menu
id, because the unit a player can weigh is "the game's menus", not fifty
individual screens. All three `ui:*` grants and `display:replace` are separate
kinds in both directions: a mod holding the dungeon cannot draw the vitals, and a
mod holding every menu cannot draw the dungeon.

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
| `registry:effect` | add a new effect code, or replace a core one: combat, healing, teleport, detection |
| `registry:room` | room and level builders, referenced from a dungeon profile |
| `registry:profile` | whole-cave builders and dungeon profiles: a new *kind* of level, and which kind you get at a depth |
| `registry:blow` | what a monster's attacks do to you, and new kinds of attack: `define()` takes one description and the engine derives both of the handlers it needs |
| `registry:store` | what a shop will buy, and how many of a thing it stocks |
| `registry:command` | what a player command *does*, and what it is CALLED: `commands.register(code, action)` for the behaviour, `commands.setVerb(code, verb)` for the verb the `!`-inscription confirm reads. Skip the verb and a player who has inscribed `!z` on a Potion of Death is asked "Really **do that with** your Potion of Death?" instead of your command's own name; `commands.verbFor(code)` returns what is installed, so a later mod can wrap an earlier one's |
| `registry:monster` | a hook at the top of every monster's turn; return true to take the turn over |
| `registry:projection` | what a projection does to terrain, floor items and the player: `projections.feat` / `.obj` / `.player`, one projection `code` at a time. This is the behaviour half of adding your own element: the `projection.json` record makes it exist, these three make it *do* something |
| `registry:ui-entry` | what a `combine:` or an `entry-renderer:` `code:` *means* on the second character screen and the equipment comparison: `uiEntry.combiners.set("my-mod:worst-of", ...)` (how a row's per-slot values reduce to the one that colours its label) and `uiEntry.backends.set("my-mod:bars", ...)` (how a value becomes a cell symbol and colour). Adding a `ui_entry.json` ROW needs no capability; a row naming a combiner or renderer nothing answers for draws as an empty row rather than failing, so this is what makes your row mean something |
| `registry:glyph` | what one character of a room-template or vault layout means when the level is drawn: `glyphs.set("vault", "Q", ...)`. The behaviour half of shipping a vault with a symbol core has never seen |
| `registry:effect-info` | what the game *says* about an effect: `effectInfo.text` (the menu row and the recall sentence), `.summary` (the object properties an activation grants), `.subtype` (the named subtypes it accepts) and `.request` (which item it prompts for). This is the description half of `registry:effect`: without it your new effect works and the game has nothing to say about it |
| `registry:tval` | what an item CLASS *is*: `tval.classes` (keyed on the predicate's own name, so `handlerFor("tvalIsWeapon")` returns core's arm and a mod ORs its own tval into it), `.good` (whether a template counts as good for allocation) and `.valueBase` (what an unidentified item of the class is worth) and `.basename` (what the class is CALLED - without it every message, menu row and shop line naming the class reads the literal "(nothing)"). Shipping a new *item* needs no capability; this is the class |
| `registry:randart` | how RANDOM artifacts are built: `randart.abilities` (what a power does), `.prep` (what an item class starts with), `.census` (which frequency bucket it feeds) and `.redundancy` (whether an activation duplicates something the artifact already has). Shipping a *fixed* artifact needs no capability; this is the generator |
| `registry:rune` | what a RUNE is: the unit of object knowledge. `rune.desc` (the recall line), `.name` (the display decoration), `.knows` / `.learn` (the knowledge pair, handed the player so YOUR mod keeps the store, since core never grew a slot for it), `.objectHas` (whether an item carries it) and `.modMessage` (the "You feel stronger!" line, keyed on the modifier). Plus `.contribute`, which is how your rune gets into the list every consumer enumerates, and without it the six tables above are handlers nothing ever calls |
| `registry:vocab` | declare genuinely new vocabulary (flags, stats, mod-coined kinds) and store per-entity values |
| `registry:menu` | rewrite one stable menu id's semantic rows. `menus.handlerFor(id)` returns the earlier transformer, so a later mod wraps it before calling `menus.register(id, ...)`; a throw or a non-row-array result is reported against that mod and leaves the original menu usable |

A facade you did not declare throws when you touch it, even if the player
consented to something else. Consent says the player allowed these domains; the
manifest says you asked for them; both must hold.

### Overwriting and extending: yours, core's, or somebody else's

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

  // Core's FIRE, extended. `previous` is core's handler, or, if a mod loaded
  // before yours already replaced it, THEIRS. You do not need to know which.
  const previous = host.projections.player.handlerFor("FIRE");
  host.projections.player.set("FIRE", (ctx) => {
    previous(ctx);
    ctx.msg("Your cloak smoulders.");
  });
}
```

`handlerFor` is on every facade in the table above: `blows.handlerFor`,
`stores.willBuyFor`, `profiles.builder`. Reach for it before reimplementing
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
the chunk, the player and the monster that core has, because a deep override
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
