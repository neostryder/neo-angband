# Mod plugins: shipping CODE in a mod folder

A mod that only changes records needs no code: drop `manifest.json` plus one
`<record-type>.json` per thing you change into a folder and you are done (see
[../MODS.md](https://github.com/neostryder/neo-angband/blob/master/docs/MODS.md)). This document is for the other kind: a mod that changes
*behaviour*.

> **A breaking mod API change is now a MAJOR version bump.** Before 1.0, the
> API could change on any minor release; from 1.0.0 on, a plugin written
> against the current API keeps loading across patch and minor releases, and
> the deprecation window described below still gives an author a release's
> warning before a real break lands. See [Version contract](#version-contract).

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

Every member is optional, and the two above are only the two most common. The
full set is `hooks`, `register`, `controller`, `frontend`, `hud`, `menu`,
`screen` and `regions`, plus `migrateBag` and `uninstall`. A plugin is refused
only when ALL eight of the first group are absent, because a mod with no code
simply ships no `plugin.js` - so a plugin whose only member is `frontend`, or
`controller`, or `regions`, loads fine. `migrateBag` deliberately does not count
as code of its own: a plugin that can only migrate a bag it never writes has
nothing to migrate.

## Your own saved data, and changing its shape

You may keep whatever JSON you like in the player's save, under your mod's id.
The engine round-trips it verbatim and never reads it. It is stored with a
`schema` number, whatever your manifest's `saveSchema` was when it was written.

**The bag is not on `ctx.state`.** `GameState` does not carry the bags at all;
they live on the `StartedGame` the host holds, which is what `saveGame` reads.
Your handle on your own bag is the `data` argument `migrateBag` is given, and the
value the host writes back for you. Reaching for `ctx.state.mods` finds nothing,
because there is no such field.

**`migrateBag` is not a WRITE seam.** It only brings an old bag forward at
mod-load time; it gives you no way to write a new one during play. For that,
use `ctx.characterStore` (neo-angband#171): `get()` and `set(value)` on your
own bag, live, keyed to the actual character rather than to a fingerprint of
one. Before this existed, a mod that needed to remember something about a
character had to approximate a save key from birth-fixed facts (name, race,
class, birth stats) and keep it in `ctx.prefs` instead. That store covers the
whole install rather than one character, so it collides between two
characters who happen to match on all of those facts. `ctx.characterStore.set()`
stamps your write with whatever `saveSchema` your manifest currently declares,
so `migrateBag` still sees a coherent number on the next load.

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

`ctx.core` is the engine: the same live module instance the game is running on, handed to your plugin instead of imported.

A bare specifier like `import { tunnelAux } from "@rpgm-tools/neo-angband-core"` cannot resolve in a module fetched from a folder. Bundling the engine into your plugin would be worse: you would get your own copy of every registry and singleton, so your effect handler would land on a registry the interpreter never consults, and your mod would do nothing at all, with no error anywhere. Passing in the one live instance rules that failure out.

What `ctx` carries:

| Field | What it is |
|---|---|
| `id` | your mod's id, which is also its folder name |
| `api` | the ABI version the **host** implements |
| `engine` | the engine version, if you want to adapt rather than refuse |
| `flags` | **your** resolved rule toggles: `choices[flag] ?? rule.default`, sliced to the rules your own manifest declares |
| `core` | the live engine namespace: core's entire public API. A named subset is guaranteed; the rest is an escape hatch. See [MOD_COMPATIBILITY.md](MOD_COMPATIBILITY.md) |
| `state` | the live `GameState`. Handed to `register`, `migrateBag`, `controller` and every display seam; **never** to `hooks`, because the host composes hooks before a game exists |
| `assetUrl` | `(path) => Promise<string \| null>`, a URL for one of *your* files |
| `data` | your own record files, parsed, keyed without `.json` |
| `prefs` | `{ get(), set(value) }`, one JSON value of **yours**, kept outside every save |
| `newCharacter` | whether this session's character was just created, rather than loaded |
| `registries` | the whole bound `CoreRegistries`: every race, kind, feature, trap, store, projection, room, profile, constant, quest and hint this session actually runs on (absent during content composition) |
| `log` | a diagnostic line; the host decides where it goes |
| `backupFolder` | `{ name(), choose(), forget(), write(name, text), onSave(fn), list() }`, a player-chosen folder for automatic save backups. Present only when your manifest declared `backup:folder` and the platform can offer a folder picker; absent everywhere else, so test for it instead of assuming it. `list()` (#24) returns every `.neochar` file currently in the folder, identified cheaply by lineage and character name/level, without decoding or importing any of them |
| `debug` | `{ spawnObject(kind), spawnMonster(race) }`, conjuring one item or creature into the live game. Present only when your manifest declared `debug:spawn` and there is a game to conjure into. The first use in a character asks the game's own debug question and marks that character permanently, so tell the player before they press your button |
| `wizard` | the game's whole debug set: depth, experience, gold, stats, acquirement, mapping, plus a catalogue of every item, creature and artifact this game has and which pack added each. Present only when your manifest declared `debug:wizard` and there is a game to drive. No method works until you call `sandbox()`, which detaches the session from its save slot and cannot be undone: the character on disk keeps whatever the last save left, and nothing after that is written. Call `attached()` first to get the name to use in the question you put to the player. See `MOD_SEAMS.md` section 4f |
| `installMod` | `(bytes) => Promise<{ok, id, version, lines} \| {ok, problem, lines}>`, installing a content mod from the bytes of an archive. Present only when your manifest declared `mod:install`. Code is refused, and what you install arrives switched off: the player enables it, and a mod takes effect on reload. `lines` is the wording the Mods screen prints for the same outcome, per-requirement rows included, so print it instead of writing your own wording for the same result |
| `reloadGame` | `() => Promise<void>`, the game's own mod-change reload: every plugin's `uninstall()` runs, the autoplayer's keyboard is handed back, the live character is written down, and the session resumes on that character. Present on the same terms as `installMod`, because an install does nothing until the game reloads. It is not a permission (a plugin can reach `location` regardless), but `location.reload()` skips all four steps, and the third one is the player's progress |
| `loadModForSession` | `(bytes) => Promise<{ok, id, version, survivesReload} \| {ok, problem}>`, loading a content mod for this session only. Present only when your manifest declared `mod:session`. Code is refused on the same terms. The mod is on from the next reload without waiting to be switched on, and the archive is forgotten when the game closes, but what it did to a character is not, so tell the player that |
| `ui` | `{ openPanel(spec), openPanels }`, panels of real HTML instead of character cells. Present only when your manifest declared `ui:panel.mount`; absent everywhere else, so test for it. See `MOD_SEAMS.md` section 4b. The two things that catch most authors out are that Escape belongs to the player and that a non-modal panel's container takes no pointer events |
| `keyRepeat` | `() => { isRepeat, reportedRepeat, intervalMs, ageMs } \| null`, the host's own classification of the most recent root-screen keydown as a key-repeat or a fresh press. Ungated, like `subwindows`; `null` until the root handler has classified a keydown this session. Read-only for now: nothing suppresses or changes a command based on it yet (#35) |
| `characterStore` | `{ get(), set(value) }`, this mod's own live per-character storage: the same save bag `migrateBag` migrates, read and written during play instead of only at mod-load time. Scoped by mod id like `prefs`, and ungated. Present only once there is a live character. A write is stamped with your manifest's current `saveSchema` (0 if you declare none), which is the number `migrateBag` reads back on a later load (#171) |

`flags` is sliced per mod so that one mod cannot read or act on another mod's toggles. Otherwise a mod's behaviour would depend on which other mods the player happened to enable.

### `state` is absent in `hooks`, and it always will be

The host composes every enabled mod's hooks before it starts the game, because the composed `ModHooks` is an argument to `startGame`. There is no `GameState` to hand you at that point, and there never can be. Treat `hooks(ctx)` as a factory over your flags, and put anything that needs the live game in `register(host, ctx)`, which runs once after the game is built.

If you need the engine at `hooks` time for something other than the live game (classifying option names, reading a constant), `ctx.core` is available and is the same module instance the game runs on.

### `registries` is the content, where `state` is the level

These two are easy to confuse, and some mods cannot be written without the second.

`state` is this level: the monsters standing on it, the objects lying on it, the player. Read it to draw a frame or to answer a question about something in front of the player right now.

`registries` is what the game is made of: `registries.monsters.races` is every race the pack defines, at its real `ridx`; `registries.objects.kinds` is every object kind, at its real `kidx`; and features, traps, stores and projections are there on the same terms. You need it whenever your question is about a thing by index instead of by presence: what a creature you only remember can do, what an item you have never seen is worth, which kinds share a `tval`.

```js
register(host, ctx) {
  const races = ctx.registries?.monsters.races;
  if (!races) return;                 // composition time, or an older host
  const byRidx = new Map(races.map((r) => [r.ridx, r]));
}
```

- It is the whole `CoreRegistries`, not a curated slice, for the same reason `ctx.core` is the whole namespace: a curated list drifts out of date. See section 4 of MOD_COMPATIBILITY.md.
- A mod's content is in it on the same terms as core's. Binding runs after every enabled mod has composed its content, and mods append, so a monster a mod added is a `MonsterRace` at a real `ridx` and an item a mod added is an `ObjectKind` at a real `kidx`. Nothing in a lookup tells them apart; the only marker is the optional `from` provenance field, and most consumers should not read it. That is why modded content works the same as vanilla content with no extra work from anyone. Without it, every consumer would keep its own table of core's content and ignore everything a mod added.
- Guard it. It is absent during content composition (that is when it is being built) and on any host older than 2026-08-21, so `if (!ctx.registries) return;` is the pattern, the same one `ctx.backupFolder` uses.
- It is the read seam, but it is not read-only. These are the live objects the engine runs on, so `registries.rooms`, `registries.profiles` and `registries.rooms.glyphs` carry the same mutators the capability-gated facades write through. Use the facade and declare the capability; [What a capability gates, and what it does not](#what-a-capability-gates-and-what-it-does-not) explains why the gate cannot stop you and why declaring still matters.

### Authoring: `ctx.authoring` and `ctx.composedRecords`

These two are for a mod that writes content instead of playing it. A tool that helps an author draft a monster needs two things the seams above cannot give it: the functions that know what a well-formed record looks like, and the records the game was actually composed from.

`ctx.authoring` is the mod SDK's public barrel, live and always present. `RECORD_BLUEPRINTS` and `blueprintFor` carry every field's measured shape, type set and range; `fieldUsage` and `requiredFields` say how common a field is; `peersFor` builds a table of comparable records along with a sentence saying why they are comparable; `suggestFields` proposes a value with its reason; `checkRecords` and `COMPANION_RULES` validate at the same three levels the running game uses; and `ModProject` assembles and emits a mod folder. It is ungated, because these are pure functions over data you pass in.

`ctx.composedRecords` is the unbound counterpart of `ctx.registries`: every record the running game composed, as JSON, keyed by pack-file stem with no extension.

```js
register(host, ctx) {
  const records = ctx.composedRecords;
  if (!records) return;               // composition time, or an older host
  const { peers, because } = ctx.authoring.peersFor(
    "monster",
    { name: "Warg matriarch", base: "canine", depth: 22 },
    records,
  );
  ctx.log(`${peers.length} comparable monsters: ${because}`);
}
```

- Use `composedRecords`, not `registries`, for anything the SDK takes. Every `records` parameter in the authoring functions is keyed by file stem and holds raw JSON. `registries.monsters.races` is bound: the binder resolved `base` into a pointer and dropped the string, so you cannot build a peer table grouped on `base` from it, or ask about a field that bound to nothing.
- Mod-added records are in it on the same terms as core's, just as in `registries`, and each carries its provenance. A draft based on another mod's sword depends on that mod, and provenance lets you see that when the base is chosen instead of at install time.
- Guard `composedRecords`, not `authoring`. The records are absent during content composition, for the same reason `registries` is. The barrel waits on nothing and is present on every context. An older host has neither, so `if (!ctx.composedRecords) return;` covers both.
- It holds record objects only. Passthrough files can carry arrays and scalars; the host narrows through the SDK's own `composedObjects` before handing the records over, so the authoring functions never meet an element they cannot read.

### Filling tiles

`registry:tiles` is the seam for one narrow thing: **a picture for content the
loaded tile pack has never heard of.** No tile set was built knowing about your
mod, so in tile mode a creature you added is a coloured letter standing in a
tiled dungeon, and the only portable alternative used to be one pref file per
tile set naming atlas coordinates, which is unmaintainable.

```js
register(host, ctx) {
  host.tiles.register((fill) => {
    if (fill.pack.engine !== "linoleum") return;   // only packs you know
    const races = ctx.registries?.monsters.races;
    if (!races) return;
    for (const race of races) {
      if (fill.monsterTile(race.ridx)) continue;   // somebody drew it already
      const donor = fill.monsterTile(0);
      if (donor) fill.fillMonster(race.ridx, fill.derive(donor, 90) ?? { ...donor });
    }
  });
}
```

- You cannot repaint the tile set. `fillMonster` / `fillObject` write only where nothing is assigned and return `false` otherwise. Every pref layer (the pack's own, then each enabled mod's) runs before any filler, so a tile an author named is never treated as a blank. It also means two mods cannot fight: whichever asks first for an index gets it, and neither can undo the other.
- `derive(donor, hue)` may return `null`, and usually does. It asks the engine for a tile that draws the donor's asset with its hue rotated. A tilesheet cannot provide one, because its tiles are cells of a fixed atlas with no spare cell for a variant, so it always returns `null`. A loose pack can, unless the donor's asset is not one of its own. Fall back to a plain copy.
- Check `fill.pack`. A tileset mod's rule fits its own art and is only a guess about anyone else's, so declining packs you do not own is normal.
- Core does not decide which content gets a tile. It used to: 0.22.0 shipped a rule in core that drew a mod-added monster from a race sharing its `base`, and 0.23.0 removed it, because Angband 4.2.6 has no concept of a mod-added record and the port adds nothing. That rule now lives in `linoleum`, which is the worked example. Note what it leaves alone: rings, amulets, mushrooms and food are drawn by flavour, so their kind slots are blank on purpose, and an older pack has no art for content added after it was drawn. A letter is the right result in both cases, so the rule is restricted to records a mod added, by provenance.

If you are shipping content rather than tiles, draw your own tiles for it. A filler is a fallback for mods that do not, and it has no way to know what you intended.

### Repainting a tile, and drawing the player's own cell

Two more features live on the same `registry:tiles` seam. Neither fills a blank; both start from a tile that already has a picture.

`fill.transform(donor, spec)` is the sibling of `derive`, for when rotating the donor's hue is not what you want. `derive` keeps the donor's colours and turns them, which does nothing to grey; `transform` replaces the palette. Each pixel is indexed by brightness into a ramp you supply, darkest first, and repainted with the colour at that index, so the result is in your colours whatever the donor's were, grey donors included. Alpha is left untouched, so the silhouette matches the donor's exactly. It can also mirror the picture horizontally, independently of the ramp. Like `derive`, it returns `null` on a fixed tilesheet (no spare cell for a variant) and in the same two other cases; fall back to a plain copy.

```js
const tile = fill.transform(donor, { mirror: true, ramp: [[20, 10, 30], [90, 40, 110], [180, 120, 220]] });
```

`tiles.player(provider)` answers a different question, once per frame instead of once per map build: given who the character is right now, is there a tile that fits better than the pack's own player picture? The player is race 0 in the monster tile table and every shipped pack assigns it, so there is no blank here for a filler to write into. The provider is asked instead, and `null` means no, which is also the result when no provider is installed. The first non-null answer in load order wins, so two such mods can coexist.

```js
host.tiles.player((view) => {
  if (!view.shape) return null;          // normal shape: let the pack draw it
  return shapeTileFor(view.shape, view.level, view.cls, view.race);
});
```

The view you get (`shape`, `level`, `cls`, `race`) is a set of named facts, not the live player record, so a render-time hook has nothing to mutate. Because the provider runs inside the render path, it must be a lookup: allocate the tiles your answers need during the fill (with `transform`) and read that table here. A provider that throws loses that frame's answer and nothing else.

### Reading a monster's tile: `ctx.tiles`

`registry:tiles` above is the WRITE side: supplying art the loaded pack has
never heard of. `ctx.tiles` is the READ side, for a mod that wants to draw a
monster's existing tile art somewhere of its own - a portrait in a dialog, a
sidebar row, anything outside the dungeon grid itself.

```js
register(host, ctx) {
  const painted = ctx.tiles?.active && ctx.tiles.hasMonsterTile(race.ridx)
    ? ctx.tiles.drawMonster(myCanvas.getContext("2d"), race.ridx, 0, 0, 32, 32)
    : false;
  if (!painted) drawAsciiGlyphInstead(race);
}
```

- **`ctx.tiles.active`** is true when a graphics/tileset mode, rather than
  ASCII, is the current display mode. False in ASCII mode, always - there is
  nothing to paint.
- **`ctx.tiles.hasMonsterTile(ridx)`** answers whether the ACTIVE pack assigns
  this race a tile at all (core's own `tileForMonster`), without touching a
  canvas. False in ASCII mode, and false for a race the pack has never drawn -
  an old pack with no art for content added since, say.
- **`ctx.tiles.drawMonster(ctx2d, ridx, dx, dy, dw, dh)`** paints the race's
  tile onto a 2D canvas context you own, at `(dx, dy)` scaled to `(dw, dh)`,
  composited over a neutral floor tile - the same terrain-then-foreground blit
  the dungeon view itself draws a monster standing on open ground with.
  Returns `true` when art was drawn; `false` (ASCII mode, no tile for this
  race, or its image has not finished loading yet) means fall back to your own
  ASCII glyph.
- **Entirely ungated**, the same reasoning `display` and `subwindows` carry:
  this is read-only art the page already fetched (the active pack's own
  images), not a capability over the game or the platform.
- **Absent on an older host.** `ctx.tiles` did not exist before neo-angband#256;
  guard it with `ctx.tiles?.` and degrade to the ASCII glyph, the same shape
  every other optional `ctx` door already uses.

### Engine-wide settings you change through `ctx.core`, not through a hook

A few engine decisions are not made inside a turn and have no game state to hang a hook on. Those are exposed as a module-level policy you set once, from `hooks(ctx)`, which is the earliest point your code runs: before `startGame`, and before boot reads anything.

There is one so far:

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

The same rules apply here as in the rest of the mod system:

- Last load wins, and there is only one winner. The host calls each enabled mod's `hooks` in load order, so the last mod to set a policy is the one that stands, which matches what the mod manager's row tells the player ("Move later (loads last, wins conflicts)"). Two policies cannot be merged into a third that is either of them, which is why this is not a `ModHooks` member. If your mod cares, say so in its README; a player who installs two mods with opinions about the same policy gets the later one.
- Only set it when your flag is on. Setting the faithful default explicitly is not the same as leaving it alone: it still makes your mod the winner and still overrides a mod loaded before yours. If the player switched your patch off, do not call it at all.
- Disabling your mod removes the policy. A module-level value could outlive a mod being disabled, but disabling never takes effect inside one process: the manager prompts to save and reloads, and after the reload your `hooks` is not called, so nothing installs a policy and the engine is back on its faithful default. `setPrefErrorPolicy(null)` does the same reset for a test.

Guard the call if your `engine` range allows a version that predates the seam: `typeof ctx.core.setPrefErrorPolicy === "function"`. The range is the real gate and the check is a backup. Write a `ctx.log` line when the check fails, so your mod is not silently inert.

### `prefs`: the place for data that outlives a character

Your mod has two places to put data and they are not interchangeable.

| | lives in | dies when | for |
|---|---|---|---|
| your save bag (through `migrateBag`) | the character's save file | that character does | what happened to this character |
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

`import { tunnelAux } from "@rpgm-tools/neo-angband-core"` cannot resolve from a folder, and you do not need it: the engine is already live as `ctx.core`. It is the one import a folder plugin cannot have, and when a plugin tries it, the mod manager explains this instead of showing the browser's own error.

## Version contract

`modApi` is an integer, and the host accepts a window: everything from `MOD_API_MIN` up to `MOD_API_VERSION` inclusive (`packages/web/src/mod-plugin.ts`). A plugin inside the window but below the current version loads and is reported as DEPRECATED, which gives its author a release's warning before the minimum moves past it. Today `MOD_API_MIN` and `MOD_API_VERSION` are both `1`, so the window is one value wide and behaves like an exact match, but the code checks a window, and `MOD_COMPATIBILITY.md` documents the two-release rule built on it.

Outside the window the plugin does not load, and the mod manager names both numbers and which side is behind: a too-new mod needs a newer game, and a too-old one needs a mod update. A bare "incompatible" would send the player to the wrong place.

It is declared in the manifest, not only inside `plugin.js`, so an incompatible plugin can be refused before it is imported. A version check inside the module only runs after the module's top-level code has already executed, which is too late for code loaded from a folder anyone can write into.

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

`register()` runs after the game has been bound (384 top-level statements after), so a message type declared there is declared after every record that could have named it. A content-only pack has no `register()` at all, so the packs most likely to need a message type could not declare one there anyway.

So if your pack's own spell, blow method, summon or projection carries a `msgt:`, ship the type as a `message_type` record file instead:

```json
{ "records": [
  { "name": "SOULFIRE", "sound": "soulfire", "sounds": "sf_one sf_two" }
] }
```

`name` is the bare `MSG_` name a `msgt:` uses, `sound` is the `sound.prf` key the type plays under, and `sounds` is the space-separated sample list bound to it. The record carries all three so that a pack can bind samples to the type it names, not just name it. No capability and no `plugin.js` are needed. It is a record file like any other, and a pack can already add a projection, a monster, an artifact and an ego item without a capability, so gating this one record file would protect nothing.

Declarations are additive, attributed to the pack that coined them, and idempotent across the new-game and load paths. They never throw: a refused declaration loses that one message type and reports it instead of stopping the boot.

`host.messages.define(...)` still exists and is still the right call for a type a plugin coins at runtime, for example to re-point sounds. It is only the wrong place for a type your own records name.

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

A complete worked example lives in `samples/blueprint-view/`, a folder you can copy straight into a mods folder. It draws a blueprint of the dungeon from the frame's semantic layers. `packages/web/src/sample-blueprint.node.test.ts` loads that folder by path and records what it draws, so the sample is tested code. It has also been run in the installed desktop build, which is where the missing viewport geometry showed up as a real problem; see [Where you may draw](#where-you-may-draw-frameregions) below for what it reads now.

The manifest must request `display:replace`, and the player must approve it:

```json
{ "shape": "plugin", "capabilities": ["display:replace"] }
```

Declaring `frontend` without it is reported by name, and the game keeps drawing. It is not a `registry:` domain, and `registry:*` does not cover it: an override grant changes one named game system among many, while this one means everything the player sees of the dungeon comes from the mod. `controller` requires `command:add` for the same reason.

For TypeScript, import the public data contract type-only from the SDK: `import type { WorldFrame, WorldFrameSink } from "@rpgm-tools/neo-angband-mod-sdk"`. The build erases that import, so a folder plugin still has no bare runtime dependency. There is one slot, and the last eligible mod in load order wins; earlier frontend factories are not called. The host hands the winner a frozen, structurally owned snapshot per real map repaint. You can keep it for an animation frame, but it cannot expose or mutate the live player-grid object. A frontend that throws loses that display attempt, and the game's own renderer takes over again.

The game's own renderer is candidate zero in the same list. It declares `frontend` and `display:replace` the same way a mod does, and it wins whenever no mod outranks it; the selection never falls through to it as a fallback. So the seam is proven against a real front end: the one the game ships is built through it.

This replaces the map display only. Menus still use `registry:menu`, and input still enters through the host's device-neutral input door; gamepad bindings and whole-screen ownership are later seams.

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

The four regions currently tile the screen without overlapping, and the set is closed. Neither will stay true. The UI seam (`MOD_REACH.md` gap 21) makes a full screen composed of regions instead of covering them, so regions will overlap, gain a stacking order, and be creatable by a mod; the purpose is a floating window over a map that is still being drawn. Nothing in the code above changes when that lands, but code that infers disjointness breaks. Read `regions.map` and draw in it; do not compute your rectangle by subtracting the others.

Covering the window costs the player everything else on it. Before regions existed, running the sample in the installed build showed the problem: `display:replace` replaces the map only, so core stops drawing the dungeon but goes on drawing the sidebar, the message line and every menu. A front end that covered the window painted over all of that, so the player could not read their hit points, see a message, or open the Mods screen to turn the mod off, and had to edit the enabled set by hand.

A front end may still take the whole window, and an isometric or 3D view may want to. With regions, that is a choice made knowing what gets covered, instead of the only option a mod had.

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

`samples/blueprint-view/plugin.js` ships this function. The game's own version is `occludersOf` in `packages/web/src/regions.ts`, with `regionsIntersect` (the four comparisons above) beside it. Neither is reachable from a mod, because of how mods are loaded: a module fetched from a mod folder cannot resolve a package by name, so `neo-angband-mod-build` marks every bare specifier external and fails the build if any survive. Types cross that line because the build erases them; functions do not. Publishing these two through the SDK would publish members no mod could import, so write your own as above. It is nine lines; keep the `undefined` case in particular.

The host tells you when the stack changes. The game's own screens (the inventory, the knowledge browser, the Mods screen you would use to turn this mod off) repaint the terminal without producing a world frame, because a screen redraws from its own key loop. So when the stack changes with no new frame behind it, the host presents your last frame again with `stack` updated. The cells are the ones you already drew. Projecting a fresh world frame from a shell that is not in a repaint would mean inventing one, and nothing has run that could have changed the dungeon. Only the stack changed, so that is the part to read.

The notification fires when the composite changes, not every time it is recomputed, since notifying on every recompose would double every repaint with no new information.

A stack can give you three answers. An empty stack, or one whose entries do not overlap you, means nothing is over you. A missing `stack` means this host publishes none, so nothing is known; draw anyway, because `place()` already declines when there is no pixel geometry to draw into. A stack that is published but does not contain `"map"` comes from a host that has stopped describing the map, and you should treat that as covered. If you treat it as clear, your canvas keeps painting over whatever replaced the map, indefinitely, with no error anywhere.

A HUD region owner reads the same field on `HudFrame`, asking about its own section's `region.name`.

One gap remains: a mod presenter holding a screen does not push a region, so the check above reports nothing over the map while a presenter-owned screen is up. The notification is correct for every region that is pushed; today the text-screen path is what pushes them.

## The HUD, region by region

`hud(ctx)` is the companion to `frontend(ctx)`. `frontend` covers the dungeon; `hud` covers everything around it (the message line, the vitals and the status line), and unlike the map it is owned one region at a time:

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

Return a sink for each region you are taking and omit the rest; those stay the game's and keep being drawn. Returning `undefined` or `{}` declines everything, which is the right answer on a host you cannot draw on. A factory that throws also loses your regions, but it is reported as your mod's fault, and having no document to draw on is not a fault.

Each region needs its own capability, or the wildcard for all three:

```json
{ "shape": "plugin", "capabilities": ["ui:sidebar.replace"] }
```

`ui:messages.replace`, `ui:sidebar.replace`, `ui:status.replace`, `ui:*.replace`. There is no `ui:map.replace`: the dungeon belongs to `display:replace`, and one region answering to two capabilities would give two answers to who draws it. The two do not cover each other in either direction: holding the map does not let you draw the vitals, and holding the whole interface does not let you draw the map.

The capability is the claim. The host picks each region's owner from the manifests before it calls anybody's `hud()`, so a mod that loses is never constructed and cannot mount UI it will never draw into. That has two consequences for your manifest:

- A sink for a region you did not ask for is dropped and reported by name.
- A region you won and then declined goes back to the game, not on to the next claimant. Ask only for the regions you actually draw.

On every repaint you get your own `section` plus the whole `frame`, both frozen and structurally yours, so keeping one to animate from is safe. The frame tells you what a section means: `frame.targeting` says the message row is a look description instead of a message, and `frame.layout` (`"left" | "top" | "none"`) says whether the vitals are a column, a one-line header, or turned off. Under `"none"` there is no `sidebar` section at all and your sink is not called, because the player turned the vitals off.

Read `entry.key` (one of `hp`, `sp`, `ac`, `depth`, `state`), which is the engine's own `side_handlers[]` / `status_handlers[]` name minus its `prt_` prefix, and `run.color`, its `COLOUR_*` attribute. Resolve the colour through `ctx.core.COLOUR_L_GREEN` and friends by name, never by the number it currently has. `run.css` and `entry.screen` are the faithful terminal's own projection: useful for a text-mode replacement, and safe to ignore if you are drawing your own.

A fault costs you one region. If your `status` sink throws, the game resumes drawing the status line for the rest of the session and reports your mod by name; your `sidebar` keeps drawing, and the player keeps their game.

Draw bars from `entry.values`, never from the text. An entry carries the numbers its text was formatted from, so hit points arrive as `{ current: 7, max: 34 }` beside `"HP   7/  34"`. Parsing the string works only until somebody loads a pref file, plays in another language, or installs a content pack that widens a field.

The convention is a single rule. `current` and `max` together mean the field is a proportion, and `current / max` is meaningful. Every other key is a plain named quantity. A field with two numbers that are not a ratio avoids those names: a stat publishes `use` / `cur` / `max`, because `118` is an encoding meaning 18/100, and a bar over it would show a maxed character at 15%. So `if (v.current !== undefined && v.max !== undefined) drawBar() else drawText()` is safe on every field, including ones added after you shipped.

A missing value always means the game does not know, never zero: the monster health bar publishes nothing while it reads `[----------]`, and `sp` is absent for a class with no mana instead of `0/0`. The full per-field key list is on `HudValues` in the SDK.

`samples/vitals-panel/` is a complete worked example: it takes `sidebar` alone and leaves the rest of the screen to the game.

## `menu(ctx)`: ask the game's questions your own way

`menu(ctx)` is the third owner seam, and it works differently from the first two: a HUD section is drawn, while a menu is asked. The boundary is `ask(question) -> answer`, and taking a question means handling the player's choice as well as drawing the menu.

```js
menu(ctx) {
  return {
    ask(question) {
      if (question.id !== "core:game-menu") return undefined;   // decline
      return drawDialAndWait(question);                          // -> MenuAnswer
    },
  };
}
```

It is gated by the single `ui:menu.replace` capability (or the wildcard `ui:*.replace`). One grant covers every menu instead of one per menu id: there are about 50 of them, and 50 capability strings would make a consent list nobody could read.

Declining is the normal case. Your presenter is offered every menu the game asks and returns `undefined` from `ask` for the ones it has no better way to present; the game then asks those its own way. A radial dial for six command verbs has no reason to touch the mod manager's thirty-row list. Declining costs nothing: you drew nothing, and nothing is left half-owned.

Answer by the choice's stable `id`, never by an index. An index describes a layout, and once you have grouped the choices into the wedges of a dial you have no index the game would recognise. Read `choice.semantic` (`{kind, ref}`) for what a choice means independent of its wording, and `question.id` to recognise which question you are being asked.

The answers are `choose`, `cancel`, `command` and `options`. `command` runs one of `question.commands`, the caller's own handler, exactly as pressing the key would, and the question is then asked again unless that handler resolved it. That is how a reimagined store can offer "buy" without knowing what buying does. You cannot invent those keys; they belong to whoever opened the menu.

Throwing costs you the seam for the session, on every menu, whereas in `hud` a fault costs one region. A presenter that throws on one question usually throws on all of them, and one report is better than a report every time the player opens anything. Answers that cannot be honoured (an unknown choice id, a choice on a browse-only question, a command key that was never offered) cost you that menu only, and are reported.

A menu still has no published region of its own, although overlapping, ordered, mod-created regions have since landed; see [`regions(ctx)`](#regionsctx-put-furniture-of-your-own-on-the-screen). `regions.ts` names the four parts of the screen that tile it, and a floating menu overlaps by definition. `question.style` tells you whether the game would have cleared the screen (`"screen"`) or drawn a box over a still-visible map (`"overlay"`).

`samples/command-dial/` is a complete worked example: it takes the game menu and
declines every other question in the game.

## `screen(ctx)`: show the game's full screens your own way

`screen(ctx)` is the fourth owner seam, and it reaches the content of a screen where the others reach the frame. Before it existed, the inventory arrived as `ScreenLine[]`, rows of characters and colours, so a mod that wanted to draw items as sprite cards would have had to parse `"a) a Potion of Cure Light Wounds       4.0 lb"` back into a name and a weight, and would break the day a pref file changed a colour or a translation changed a width. A screen now arrives as a document of blocks.

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

It is gated by the single `ui:screen.replace` capability (or the wildcard `ui:*.replace`), on the same terms as `menu`: one grant covers every screen, and you choose per screen by declining.

A list is a `table`, and cells are addressed by column key. Columns have stable keys (`name`, `slot`, `weight`, `turn`), so you read `row.cells.name.text` and never count characters. A column also publishes three facts about the terminal's layout, all of which you are free to ignore: `width` (the field width where upstream fixed one), `gap` (columns of space before it; the history screen writes `"%10ld%7d'  %s"`, with no gap before the depth and two before the note) and `pad` (false where the game does not line the column up, as with the object list's location, which simply follows the name). These are published beside the data instead of being baked into it as padding, so both a terminal rendering and your own can come from one model.

`row.semantic` is the same `{kind, ref}` a `MenuChoice` carries, so an item is the same thing to you whether the game is listing it or asking you to pick it: an inventory row and its picker choice share an id. An empty equipment slot is `{kind: "slot"}` instead of an item. `row.color` is the object's own attr as CSS, and `row.tag` is the letter the terminal would offer.

Numbers come with the text. `cell.values` follows the HUD's convention: `current` and `max` together mean a proportion, every other key is a named quantity, and a missing key means the game does not know the value. A weight cell publishes `{each, total, number}` in tenths of a pound, so you can format it your own way.

Check `row.values` as well as `cell.values`. The model may carry more than the rendering, never less, so a number the terminal has no column for lives on the row: the quiver publishes its weight that way, the object list publishes each offset as `{dy, dx}` as well as `"2 N 0 W"`, and the player history includes the character level it never prints. Those are the numbers a presenter needs and a text screen cannot show.

Prose arrives unwrapped, in a `text` block. `paragraphs` is a run stream per paragraph, split where the game meant a break and nowhere else, so the object recall, the object comparison and the monster recall hand you the text and let you choose the width. A `lines` block, by contrast, has already been broken into terminal-width rows, and re-flowing those to a panel of your own size means undoing the game's wrap first and guessing which breaks were the game's and which were the sentence's. `block.color` is the prose's default colour, for the parts no run sets.

`block.flow` names which of Angband's two wrapping routines laid the prose out, for a presenter that wants to reproduce the terminal instead of re-flowing. Absent means `textblock_calculate_lines`, which covers every page but one; `"text-out"` means `text_out_to_screen`, used only for the character sheet's history. The two differ by two columns and by whether a sentence's second space survives a line break, so a renderer that assumed one rule for both was wrong on one of them. Most presenters can ignore this; it matters only if you are wrapping the way the terminal does instead of at a width of your own.

An `art` block keeps the picture and the text on it separate. Its `lines` are the picture (the tombstone or the winner's crown), and its `fields` are the text the game writes onto the picture. Upstream's tombstone is one drawing with the character's details burned into columns 8-39, so a presenter handed only the drawing would have to know that to get the name back. Instead, each field carries a stable `key` (`name`, `title`, `class`, `level`, `exp`, `gold`, `death`, `killer`, `date`), its `text`, and `values` where the text is a formatted number. The `row`/`x1`/`x2` beside them are where the faithful terminal puts each one; ignore them and draw a real gravestone. A field with no band is centred on the full width, as upstream does for the winner's banner.

A column can carry a picture, and a table can carry its spacing. The character sheet's flag grid has one column per equipment slot, and upstream draws the worn item's glyph over each. That glyph describes the column (what is in this slot), so it arrives as `column.glyph` instead of as a first row you would have to know to skip; draw the item's icon there. Two more layout facts are published beside the data: `headerColor` is the header row's colour where the game colours it, and `gapAfter` is the number of blank rows the faithful terminal leaves under a table. A `text` block's `wrap` does the same for prose: it is the width upstream wraps at (72 for the character history on an 80-column screen), always an upper bound and never a minimum. Ignore all four if you lay things out yourself.

Not every screen has a model yet. `MODELLED_SCREENS` (`packages/web/src/screen-view.ts`) names the ones that do, thirty-nine today: the inventory, the equipment, the quiver, the object list, the monster list, the message history, the player history, the object recall, the object comparison, the monster recall, the tombstone, the winner, the character sheet's two pages (`core:character` and `core:character-flags`), the knowledge browser's seven recall pages (`core:rune-recall`, `core:feature-recall`, `core:trap-recall`, `core:shape-recall`, `core:artifact-recall`, `core:ego-recall`, `core:object-kind-recall`), the four help pages (`core:help-commands`, `core:help-symbols`, `core:help-guide`, `core:help-community`), the equipment-comparison screen's two help overlays (`core:equip-cmp-help`, `core:equip-cmp-select-help`), the mod manager's four listings (`core:mod-updates`, `core:mod-auto-sort`, `core:mod-capabilities`, `core:mod-conflicts`), the hall of fame (`core:hall-of-fame`), the knowledge menu's store view (`core:store-knowledge`), the update and report pages (`core:update`, `core:report`), and wizard mode's two debug readouts (`core:wizard-keylog`, `core:wizard-item`). Everything else arrives under the shared id `core:text` with a single `lines` block of pre-wrapped rows, which is enough to reskin a frame but not to reimagine a listing, so check `view.id`.

Most of what remains under `core:text` is prose. Of the thirty-two `showTextScreen` call sites in the mod manager as of August 2026, twenty-four show prose: warnings, outcome reports, error explanations and a mod author's own description, which a presenter gains nothing by addressing field by field. The screens that still need a model are listed in `MOD_REACH.md` gap 21: the spell lists, which belong to the menu seam, and the install-refusal screens, which the model can now represent but which are not yet wired to it (see the next section).

### Regions are stacked, and a screen is one of them

`ui-stack.ts` holds the live stack. `pushRegion` adds a region, the returned
handle's `release()` removes it, `relayoutStack` re-places every region when the
terminal changes shape, and `paintRegionStack` draws the ones that want a
painter, bottom band to top, each through a surface clipped to its own
rectangle.

`place(grid)` is called on every layout change, so its contract is narrow: return a rectangle and do no work. Do not paint in it, read the game in it, or throw from it, because a resize can arrive between any two keystrokes. It runs inside a try/catch so one author's mistake cannot break the relayout for every other region, and a region whose `place()` throws or whose rectangle runs off the grid is recorded in `regionStackFaults()` instead of being silently omitted, which would leave a missing window with nothing to search for.

`paint(surface)` is optional, and core usually leaves it out: a screen that owns the keyboard repaints itself when a key arrives. Give your region a painter when you want it redrawn every frame, such as a HUD window over a live map.

A core screen occupies `core:screen` on the `modal` band, and its rectangle is the whole terminal, permanently. A mod that wants a panel declares its own region instead of asking core to make room, because shrinking core's screens would move pictures that upstream-cited parity tests pin byte for byte, and no mod would gain from it. To find out whether anything is over the map before you draw on it, read `frame.stack`; see [Knowing when you are covered](#knowing-when-you-are-covered-framestack). Core's own version of that check is `occludersOf` (`packages/web/src/regions.ts`), which is host-internal and returns `undefined`, not `[]`, when you name a region that is not in the stack, so a typo shows up as a question with no answer instead of as good news. Keep that distinction in your own copy.

### Standing aside for the game's own prompt

A screen's `actions` are the game's own commands, and some of them ask the player a question on the faithful terminal underneath your overlay. The character sheet's `c` (rename) opens a name prompt, and its `f` (dump to file) asks for a filename. If your overlay keeps drawing, the player is answering a question they cannot see, and because the rename reaches `persistSave()`, two keystrokes (`c` then Enter) once wrote the save with nothing visible on screen at all. Escape was the only key that got out without writing it.

Forbidding prompts inside `ScreenHost.invoke` would make the actions a mod can offer a strict subset of the game's, which defeats the purpose of the seam. The game announces the prompt before it lands instead: a presenter that can stand aside is told what is coming, awaited while it animates out, and given its screen back afterwards.

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

Whatever you return is awaited, so a fade-out works, and the prompt does not land until it finishes. There is no timeout.

`yieldTerminal` is optional. Leaving it out is not an error, but it is reported once by name, with the member to add spelled out, and the game draws its prompt over your screen anyway. The command always runs, so your actions are never a smaller set than the game's.

It is on the published type in both copies: `ScreenShown` in the host's `packages/web/src/screen-view.ts` and in the SDK's `packages/mod-sdk/src/screen.ts`, together with the types that describe the announcement, `PromptRequest` and `PromptExtent`. For TypeScript, import all three type-only from the SDK, which the build erases like any other type import:

```ts
import type {
  PromptRequest,
  ScreenPresenter,
  ScreenShown,
} from "@rpgm-tools/neo-angband-mod-sdk";
```

Until 2026-08-14 the member was declared only on a host-local `YieldingScreen`, and the mechanism worked anyway, which made the gap easy to miss. An unpublished member does not stop a mod implementing it: `tsc` accepts `show: () => ({ dismissed, yieldTerminal })` against a `ScreenShown | undefined` return with no cast and no excess-property error. What it prevents is finding out that the member exists, and getting an error when you get it wrong: `yieldTerminal(request: string)` compiled, and was handed a `PromptRequest` at runtime.

`packages/mod-sdk/src/screen-abi-agreement.test.ts` keeps the two copies in agreement: the member list, `yieldTerminal`'s signature character for character, the doc-comment sentence that describes it, and `PromptRequest`'s own field list and types. It reads both source files, because importing both types would prove nothing: two structurally identical interfaces are one type to the compiler, which is the same blind spot that let the member ship unpublished.

Every action in the `SCREEN_PROMPTS` census is announced. `charsheet.ts` covers `core:character` and `core:character-flags` (`rename`, `file`); `main.ts` covers `core:report`'s `describe` and `core:update`'s `mods`. The `mods` action opens a whole nested page (`showModUpgrades`) whose own screens would come back round to the presenter that is already holding `core:update`. While you are standing aside you are not offered them; the game shows those itself, because offering them would ask you to draw over the terminal you just cleared.

### A row with a paragraph

`ScreenRow.detail` is prose attached to one row of a table. It is a
`ScreenProse`, the same `{ paragraphs, indent?, wrap?, flow?, color? }` a
`text` block is made of, so a presenter that can already draw a prose block can
draw a detail, and one that only wants the record can ignore it.

The rule for telling the two apart is unchanged, and it explains the shape of `detail`: structure is what has keys, and prose is what has paragraphs. Anything you need to reach by name is a cell, addressed by its column key. A detail has no key and cannot be addressed. If you find yourself parsing one, what you are parsing is a column the screen has not declared yet, so report it as a bug instead of splitting the string. The ids behind a dependency cycle like `A -> B -> A` are on `semantic.data`, where `autoSortScreen` already puts them.

A detail never affects layout beyond its own row. It is not consulted when column widths are computed, so a long paragraph cannot widen a column or move the row above it, and a row without a detail is laid out the same whether or not its neighbours have one. It adds no third wrapping rule either: it is laid out by the same function as a `text` block, and chooses between Angband's two algorithms through the same `flow` field.

Three screens needed this: the install refusal, a dropped auto-sort suggestion, and a declared-conflict claim. Each is a record with a paragraph attached, and they had been stuck at `lines` because there was nowhere to put the paragraph. Cutting the paragraph into row fragments would have left them as `lines` in all but name, since a presenter would still have had to know that some rows continue others.

The seven recall pages are all `text` blocks, and they have seven ids instead of one so that a mod can tell them apart, for example to draw an artifact's page as a plaque and a trap's as a warning card. If you only want to restyle prose, match on all seven (or on `block.kind === "text"`); nothing in a prose panel needs to know which one it has.

The player dismisses a screen instead of answering it, which is the one difference in shape from `menu`. `show` declines by returning `undefined` synchronously, and takes the screen by returning `{ dismissed }`, a promise you resolve when the player closes it. Once the promise means "they closed it", there is no answer value left to decline with, and the decision never needs to be async anyway, since you match on `view.id`. Resolving `dismissed` is the whole contract: if your presenter never resolves it, the player cannot get back to the game.

Some screens can be acted on, and those give you a way back into the game. Most screens are only dismissed, but the character sheet also offers renaming, a character dump and the page cycle from the same modal, as upstream does, and a presenter that took the sheet without reaching those would quietly take the commands away from the player. The visible-monster list has a single action, `sort-exp` (`x`), which flips the sort between depth and experience. `view.actions` publishes these as data: a stable `id` (`rename`, `file`, `page-next`, `page-prev`), the `key` the faithful terminal listens for, and the game's own `label`. `show(view, host)` hands you a `ScreenHost` whose `invoke(id)` runs one.

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

`invoke` runs the game's code (a rename still opens the game's prompt, and a dump still writes the game's file) and resolves with what the player should see next: usually the same screen with new content, or the next page. `undefined` means the game has taken the screen back; resolve `dismissed` when you see it. An id this engine does not know is a no-op that hands the current view back, so asking for a newer command can never close the player's screen. `host` arrives only where `actions` does, and it is a second parameter instead of a field of the view because a view is frozen data and a way back into the game cannot be.

Throwing costs you the seam for the session, as with `menu`. If you throw while a screen is open, or reject `dismissed`, the game reports your mod by name and shows the screen itself, so the player is never left staring at a dead overlay with no way out. That recovery exists so a bug does not cost a character; do not rely on it as normal behaviour.

**A screen has no published region either.** It covers the window, for the same
reason a floating menu does.

`samples/sprite-inventory/` is a complete worked example: it draws the inventory,
the equipment and the quiver as item cards, lays the recall pages out into a
panel of its own width by measuring them, and declines every other screen.

## `regions(ctx)`: put furniture of your own on the screen

`regions(ctx)` is the fifth owner seam, and the only one with no winner. The other four each decide who gets something, because the map, a HUD region, the menu seam and the screen seam are each a single thing that two mods cannot both have. Regions work differently: when two mods both declare one, they do not compete. They are two pieces of furniture that coexist, each at its own band, in load order. Load order matters here only in the ordinary sense that, within a band, the later-loaded region draws on top.

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

It requires `ui:region.create`. `ui:*.replace` does not grant it: that wildcard covers which of the game's own regions change hands, and adding a region of your own is a separate thing for the player to agree to. Declaring `regions()` without the capability is reported by name, with the fix spelled out, instead of silently drawing nothing.

Your id is namespaced: declare `"carried"` and the live stack holds `my-mod:carried`. This matters for correctness. A mod naming its region `map` would put a second `map` in the stack, and `occludersOf` answers about the first match, so a front end's one question could quietly start being answered about somebody else's rectangle.

Failure is per declaration, not per mod. A rectangle with no `paint`, a band that does not exist, a duplicate name, or a `paint` that throws on its first frame each costs that one region, is reported once, and leaves your other regions and every other mod's alone.

A faulting region is withdrawn instead of being left empty. This differs from core: `ui-stack.ts` leaves a faulted core screen in the composite, which is right for something that still owns the keyboard. A decorative panel has no such claim. Left in the stack it would be a phantom occluder, and a replacement front end asking `occludersOf(stack, "map")` would hide its canvas for a region that has drawn nothing since its first frame. So the handle is released, and the region disappears with a message instead of lingering without one.

`place(grid)` must be cheap, total and pure. It runs for every open region on every frame and on every resize: no game reads, no painting, and no allocation you can avoid. Return the rectangle for a terminal of that size; a rectangle that runs off the grid is recorded in `regionStackFaults()` instead of being drawn.

The `system` layer is reserved for the game. Asking for it is refused with its own message instead of a generic bad-band one, because it is a real band (the top one) and the refusal is intentional, not a sign of a typo. The mod manager and fault reports have to be drawable above every mod, including one that has gone wrong. Use `"overlay"` for furniture, or `"modal"` for something that needs the player's attention.

## Capabilities

The `GridSurface` rendering contract is host infrastructure, not a registry capability. `frontend` is a direct `ModPlugin` member because it selects one display owner instead of registering an independent game behaviour, and for the same reason it has a capability kind of its own, `display:replace`. `hud` has the same shape one level finer: a direct member because it selects an owner, gated per region by `ui:<region>.replace`, because a mod that draws hit points as a bar has no business taking the message log as well, and a player giving consent should be told which part of the screen is changing hands. `menu` is the third, gated by `ui:menu.replace` for all menus at once, because the unit a player can weigh is "the game's menus", not fifty individual screens. All three `ui:*` grants and `display:replace` are separate kinds in both directions: a mod holding the dungeon cannot draw the vitals, and a mod holding every menu cannot draw the dungeon.

`ui:` has three actions, and the action is compared as well as the region. `replace` hands over something the game already draws. `region.create` adds a rectangle of the game's own character grid beside it. `panel.mount` puts real HTML on the page above the game, reached through `ctx.ui` instead of a `ModPlugin` member, because a panel opens when the player asks for one instead of being declared once at load. `ui:*.replace` covers neither of the other two: the wildcard covers which of the game's regions change hands, and adding furniture or mounting a web page are separate things for a player to agree to.

`mod:` has two actions, and neither grant includes the other. `mod:install` puts a content pack in the player's library switched off. Because it waits there, one line on a consent list is a fair price for it: the player still meets the new mod on the Mods screen and still reads its own list. `mod:session` loads one for the rest of the session, on from the next reload, with none of those steps, so it grants more and cannot be covered by the install grant. `grantCovers` compares the action, the same rule `ui:` needed (#261). Both refuse code, and both refuse an archive whose manifest asks for a capability, so neither can be used to run code a mod wrote.

A session-only load is limited in lifetime, not in privilege. A session-loaded pack composes into the game on the same terms as an installed one. Only the archive is short-lived: what the records did to a character, and anything a mod wrote while they were loaded, outlives the session exactly as it would have if the mod had been installed. What the session tier does give a player is that it cannot accumulate: the mod is listed and marked, it can be dropped, and closing the game forgets it.

That lifetime is a strong convention, not an enforced boundary. The archive lives in `sessionStorage`, which survives a reload (that is what makes the tier work, since a reload is what applies a mod). A browser also restores it when it restores a closed or crashed window, and a window the page itself opens inherits a copy of it. So "gone when you close the game" is what normally happens, not a guarantee. The mitigation is visibility: a session mod is always on the list, always marked, and always droppable, so it can never sit there unnoticed.

`ui:panel.mount` is not a fence around the DOM. Your `plugin.js` runs in the page's own realm, so `document` is available to it with or without any capability, and a mod that never declares this can still append an element to the body. What the grant carries is a line the player reads first, a container the host owns and can take away, and one thing a mod cannot do without it: stand the game's input door down, so a real `<input>` inside your panel can be typed into instead of the keystrokes being read as game commands.

`WorldFrame` in `packages/web/src/world-view.ts` is live. `render()` calls the extracted `world-render-data.ts` with the real map-knowledge reads and passes the resulting frame to a `WorldFrameSink`. The default glyph terminal is that sink, and it consumes the frame's fallback visual projection, including the terrain-under-foreground tile inputs for a path over otherwise bare seen terrain. The frame carries semantic feature, trap, object and monster ids, visibility, ordered layers, the cursor and player placement, so a selected front end can build an isometric or 3D view without decoding terminal glyphs. As a control, the host runs the same producer `render()` uses, checks its unmodded pre-frame glyph tuples, and tees that exact frame to an independent host sink in the same call. The selected frontend receives a frozen copy of that frame; when no frontend is selected, or none exists, the glyph sink stays active unchanged.

The same is true of `UiInput` in `packages/web/src/input-door.ts`. It is the
single device-neutral route by which keyboard and keymap input reaches screens;
its direction carries an analog vector and angle. A plugin that declares and is
granted `keymap:write` receives `ctx.keymaps` during a live game. `bind()` claims
only a free trigger; `entries()` lists only bindings the calling mod owns; and
`rebind()` and `remove()` can change only those owned bindings. A plugin cannot
read, overwrite, or remove the player's bindings or another mod's bindings. A
player change clears the mod claim, and bindings still owned by a departing mod
are removed during host teardown. Stored player keymaps are evaluated first when
the root owns input; score pages, modals, and run interruption retain their
existing literal-key gates, so a mod must not use injected input to outrank the
player's chosen mapping or an active screen.

`register` reaches eighteen registries, each gated by a capability your manifest must declare and the player must consent to. `REGISTRY_CAPABILITIES` (`packages/core/src/mod/registry-host.ts`) defines the vocabulary, and the table below summarises it:

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
| `registry:tval` | what an item CLASS *is*: `tval.classes` (keyed on the predicate's own name, so `handlerFor("tvalIsWeapon")` returns core's arm and a mod ORs its own tval into it), `.good` (whether a template counts as good for allocation), `.valueBase` (what an unidentified item of the class is worth), `.valueAdjust` (a post-computation nudge to `object_value_real`'s own faithful result - `{ reg, obj, qty, baseValue, totalAc }` in, a possibly-different number out; unregistered is a no-op) and `.basename` (what the class is CALLED - without it every message, menu row and shop line naming the class reads the literal "(nothing)"). Shipping a new *item* needs no capability; this is the class |
| `registry:randart` | how RANDOM artifacts are built: `randart.abilities` (what a power does), `.prep` (what an item class starts with), `.census` (which frequency bucket it feeds) and `.redundancy` (whether an activation duplicates something the artifact already has). Shipping a *fixed* artifact needs no capability; this is the generator |
| `registry:rune` | what a rune is: the unit of object knowledge. `rune.desc` (the recall line), `.name` (the display decoration), `.knows` / `.learn` (the knowledge pair, handed the player so your mod keeps the store, since core has no slot for it), `.objectHas` (whether an item carries it) and `.modMessage` (the "You feel stronger!" line, keyed on the modifier). Plus `.contribute`, which puts your rune into the list every consumer enumerates; without it, the six handlers above are never called |
| `registry:vocab` | declare genuinely new vocabulary (flags, stats, mod-coined kinds) and store per-entity values |
| `registry:message` | message TYPES: `messages.define(name, sound?)` coins one and returns its number, `.lookup(name)` finds an existing one, `.types()` lists what has been added, `.addSounds(...)` attaches sounds. Adding a `message_type.json` RECORD needs no capability, the same way adding an item does; this is the code half, for a type your own plugin raises |
| `registry:menu` | rewrite one stable menu id's semantic rows. `menus.handlerFor(id)` returns the earlier transformer, so a later mod wraps it before calling `menus.register(id, ...)`; a throw or a non-row-array result is reported against that mod and leaves the original menu usable. `menus.addAction("core:game-menu", action, label, handler)` adds a namespaced, runnable row to the Escape Game menu; it is the door for a mod-owned callback rather than a rewrite of a core action |
| `registry:tiles` | supply tiles for content the loaded tile pack does not draw, which in practice means content a mod added. `tiles.register(filler)` installs one filler per mod; every registered filler runs, in load order, after the pack's own prefs and every mod's. A filler can only write where nothing is assigned, so it cannot repaint the tile set and two mods cannot fight over an index. The same seam also offers repainting in place (`fill.transform`, a mirror and/or a palette remap over an existing tile) and the player's own cell (`tiles.player`, asked once per frame what the character's cell should show). See [Filling tiles](#filling-tiles) and [Repainting a tile, and drawing the player's own cell](#repainting-a-tile-and-drawing-the-players-own-cell) |

Touching a facade you did not declare throws, even if the player consented to something else. Consent means the player allowed these domains, and the manifest means you asked for them; you need both.

### What a capability gates, and what it does not

The rule above is accurate, but narrower than it looks: the gate is on the facade, not on the registry behind it. A `registry:*` capability is a declaration, and what it gives you is real but limited:

- the player sees the list, in plain language, before consenting;
- the conflict report and the manager row are built from it;
- an author who forgot to declare a domain gets a clear throw with the capability name in it, instead of a silent surprise later.

It does not fence off the registry. Your `register(host, ctx)` is handed three sets of objects with no capability check at all, because a mod is meant to be able to look at everything without declaring anything:

| Handed to you ungated | The gated facade it is the twin of |
|---|---|
| `ctx.registries.rooms`, `.profiles`, `.rooms.glyphs` | `registry:room`, `registry:profile`, `registry:glyph` |
| `ctx.state.blowEffects`, `.storeBehaviour`, `.projectionHandlers`, `.uiEntry`, `.commandVerbs`, `.monsterTurnHook` | `registry:blow`, `registry:store`, `registry:projection`, `registry:ui-entry`, `registry:command`, `registry:monster` |
| `ctx.core.tvalRegistry()`, `.runeRegistry()`, `.randartRegistry()`, `.effectInfoRegistry()`, `.messageTypes`, `.soundPrefRegistry` | `registry:tval`, `registry:rune`, `registry:randart`, `registry:effect-info`, `registry:message` |

`ctx.authoring` and `ctx.composedRecords` are ungated too, for a different reason: they are not twins of any gated facade. The barrel is pure functions over data you pass in, and the records are content the player already has, in the shape it was read in. Neither is a second route to a gated facade.

Those are the same live objects, by identity, not copies. `ctx.core` also exports `createModRegistryHost` itself, which grants every domain when called without a capability set, so anything holding the namespace is one call away from an ungated host.

That follows from how plugins run. A trusted plugin runs in-process, synchronously, holding the engine namespace, because that is the only way a handler can touch the live `rng`, `chunk` and `player` deep inside a turn (the reasoning is in `packages/core/src/mod/registry-host.ts`, under WHY IN-PROCESS AND TRUSTED). Nothing reachable from that namespace can be withheld from code already inside it, and a read-only view over `ctx.registries` would close three of the fifteen twins above while looking as though it had closed all of them. `packages/web/src/capability-gate-reach.test.ts` tests both halves: the gate refusing, and the twin reaching.

The same holds for other capability families in the in-process tier. `state:<domain>.read` gates the perceive facade's accessors per domain, but `ctx.state` is the whole live `GameState`. `network:<host>` gates the act facade's request helper, but a plugin is an ES module in the game's own page with the global `fetch` in scope.

These capabilities are enforced in the sandboxed Worker tier. That tier is isolated by construction: it gets the reactive perceive / act / event surface across a message boundary and none of `ctx.core`, `ctx.state` or `ctx.registries`, so there is no twin to reach, and a denied domain stays denied. The same capability string therefore means containment on one side of that boundary and declaration on the other; this section is about the in-process tier.

For in-process plugins, the real boundary is the install. A mod is code, nobody in this project reviews it, and the player makes that decision with the toggle on the Mods screen (`packages/web/src/mod-consent.ts`). So the consent screen shows the in-process warning for any mod that ships code, whatever its declared list says, and the manager row for a plugin that declares nothing says so instead of looking reassuring.

So declare what you override. The throw is not the only reason: the declaration is what the player reads and what the conflict report is built from. If you reach a registry around its facade, the player has consented to a mod that did not say what it does, and the manager cannot see the clash to report it.

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

That transformer changes presentation only: a row it invents has no core action
behind it. To add a **runnable** row of your own, declare `registry:menu` and
use `addAction` instead. The host namespaces `action` by your mod id, appends
the row to the Escape Game menu, and calls only your handler when the player
selects it. The handler begins in the selection gesture, so it may open a
browser folder picker.

```js
register(host, ctx) {
  host.menus.addAction(
    "core:game-menu",
    "choose-backup-folder",
    "Choose backup folder...",
    async () => {
      const name = await ctx.backupFolder?.choose();
      ctx.log(name ? `Using backup folder: ${name}` : "Backup folder unchanged.");
    },
  );
}
```

`core:game-menu` is the only action location in this API version. A callback
that throws is reported against its mod and returns the player to the Game menu;
it never falls through to a similarly positioned core row.

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
