# Moving a mod from API 1 to API 2

This guide takes an API 1 plugin (a `plugin.js` whose default export has `api: 1`) to mod API 2, in the order the work usually goes: check what can move, convert the manifest, change the shape of the code, then go through each part of the old `ctx`. [API2.md](API2.md) describes API 2 itself. The types are in `@rpgm-tools/neo-angband-mod-sdk`.

## What works on this build

The SDK has the API 2 types (`ModApi2`, `Api2ModDefinition`, `Api2Result`), the version check `apiRangeVerdict`, and the manifest converter `convertManifestV1`. The web host has an in-process API 2 host (`packages/web/src/mod-api2-host.ts`), `api2Plugin` (`packages/web/src/mod-api2-shim.ts`), which wraps an API 2 definition so it runs through the API 1 loader with the same permissions and the same hook composition, and a Worker broker (`packages/web/src/mod-worker/host.ts`) that serves a Worker mod the same API.

The folder loader runs an API 2 mod in either runtime. An in-process mod needs a schema 2 manifest with `"runtime": "in-process"` and an `api` range that admits API 2, such as `>=2.0.0 <3.0.0`; the loader wraps its default export with `api2Plugin`. A Worker mod needs `"runtime": "worker"`, the same kind of range and an `entry` (see Runtime tiers). A manifest whose range admits no API this build runs in that runtime is refused with a line such as `needs mod API >=3.0.0 <4.0.0 in runtime "in-process", which this build does not provide`. `neo-angband-mod-build` still refuses a default export without an integer `api`, so build an API 2 mod with your own bundler and check it with `neo-angband-mod-check`, which reads both kinds of default export.

## What to do

Only a mod that ships a `plugin.js` has anything to move. A data-only mod needs no change, because its records and patches carry no code API and neither do its tiles or text. Its manifest still reads in schema 1. Schema 2 is optional for it, and `ModProject.emit()` already writes schema 2.

If you do nothing yet, a plugin that declares `api: 1` keeps loading unchanged. The host marks it as running on a compatibility path and says so on the Mods screen and in the log. `MOD_API_MIN`, the oldest accepted API, is 1. Raising it takes two releases. The first release ships the new behavior and shows the compatibility-path line, and the second raises the floor. No release has raised it so far.

To move a mod that runs code onto API 2, follow these steps:

1. Look up each member of the old `ctx` in Step 1. Every member has a home in API 2 except `ctx.shared`, which holds values shared between mods, and `ctx.debug`, the retired public debug tools.
2. Convert the manifest (Step 2).
3. Change the code shape (Step 3), and set `api` to `>=2.0.0 <3.0.0` in the manifest and in the code's own `api`.
4. Work through Steps 4 to 11 to move reads, actions, events, hooks, and panels, along with storage and network calls.
5. Set the `engine` range to the first game version with API 2. That range is `>=1.23.0-beta.1` while 1.23.0 is in beta and `>=1.23.0` once it is released.
6. Check the folder or zip with `npx neo-angband-mod-check path/to/your-mod` and `pnpm mod-runner path/to/your-mod`. `neo-angband-mod-build` still refuses a default export without an integer `api`, so build the mod with your own bundler and then run `neo-angband-mod-check` on the result.
7. Release as usual. Run `npm run verify`, commit, tag with the mod's own version, and push the tag. A published tag is never moved, so a fix takes a minor bump of the mod's version.

The checklist at the bottom of this guide repeats these steps in short form.

## Step 1: find where each part of the old context went

Nearly every member of the old `ctx` has a home in API 2. Find each member your plugin uses in the table to see where it lives now and who can use it. "First-party only" means only the game's own mods get it. "In-process, needs `engine:access`" means an in-process mod the player gave `engine:access`, never a Worker. Only `ctx.shared` and `ctx.debug` have no home.

| Old ctx name | Where it lives now | Who can use it |
| --- | --- | --- |
| `ctx.id`, `ctx.engine`, `ctx.flags`, `ctx.newCharacter`, `ctx.log`, `ctx.mods`, `ctx.controllerArmed` | `meta.id`, `meta.engine`, `meta.flags`, `meta.newCharacter`, `meta.log`, `meta.mods`, `meta.controllerArmed` | Everyone |
| `ctx.api` | `meta.api`, which is a semver string instead of an integer | Everyone |
| `ctx.settings` | `meta.settings`, `meta.setSetting` | Everyone |
| `ctx.core`, `ctx.state`, `ctx.registries` | `engine.core`, `engine.state`, `engine.registries` | In-process, needs `engine:access` |
| `ctx.data`, `ctx.assetUrl`, `ctx.composedRecords` | `content.own`, `content.asset`, `content.records`, `content.lookup` | Everyone |
| `ctx.prefs`, `ctx.characterStore` | `store.prefs` (with an explicit prefs migration), `store.character` | Everyone |
| `ctx.snapshot`, `ctx.driver` | `view.input`, `view.input().driver` | Everyone with `state:interaction.read` |
| `ctx.knownLevel` | `view.level` | Everyone with `state:map.read` |
| `ctx.inspect` | `view.inspect` (`inspectItem` is `item`, `spellInfo` is `spell`) | Everyone with the `state:` permission for what each call reads, such as `state:inventory.read` for `item` and `state:spells.read` for `spell` |
| `ctx.knowledge` | `view.knowledge` (category and id select a recall page) | Everyone with `state:knowledge.read` |
| `ctx.options` | `view.options`, and `manage.options` for the first-party editor | `view.options` with `state:player.read`, and `manage.options` first-party only |
| `ctx.character` | `view.character`, `view.player().key`, and `events.on("run-end")` | Everyone with `state:player.read`, plus `event:run-end` for `events.on` |
| `ctx.intent` | `act.submit` (and `view.catalogue`) | Everyone with `input:intent` (`state:interaction.read` for `view.catalogue`) |
| `ctx.prompt` | `act.answer` | Everyone with `input:prompt.reply` |
| `ctx.controller` | `act.controller` | Everyone. The `controller` member needs `state:interaction.read`, `input:intent`, and `input:prompt.reply` (see Step 6) |
| `ctx.events` | `events.on`, `events.off`, with payloads that carry only what the player knows | Everyone with `event:<name>` |
| `ctx.keymaps` | `ui.keys` | Everyone with `keymap:write` |
| `ctx.ui` | `ui.mount`, `ui.patch`, and `presentation.panels` for first-party DOM panels | `ui:panel.mount` for `ui.mount` and `ui.patch`, and first-party only for `presentation.panels` |
| `ctx.title` | `ui.title`, and `presentation.title` | `ui.title` with `ui:title`, and `presentation.title` first-party only |
| `ctx.net` | `net.request`, `net.credentials` (credentials by opaque reference) | Everyone with `network:<host>` for each host the manifest names |
| `ctx.backupFolder` | `backupFolder` | Everyone with `backup:folder` |
| `ctx.display` | `presentation.display` | First-party only |
| `ctx.subwindows` | `presentation.subwindows` | First-party only |
| `ctx.tiles` | `presentation.tiles` | First-party only |
| `ctx.keyRepeat` | `presentation.keyRepeat` | First-party only |
| `ctx.authoring` | `manage.authoring` | First-party only, with `mod:authoring` |
| `ctx.keybindings` | `manage.keys` | First-party only |
| `ctx.look` | `manage.look` | First-party only |
| `ctx.saves` | `manage.saves` | First-party only |
| `ctx.session` | `manage.session` | First-party only |
| `ctx.profiles` | `manage.profiles` | First-party only |
| `ctx.installMod` | `manage.mods.planInstall`, `manage.mods.applyPlan` | First-party only |
| `ctx.reloadGame` | `manage.reloadGame` | First-party only |
| `ctx.loadModForSession` | `manage.loadForSession` | First-party only |
| `ctx.readMod` | `manage.mods.discover` | First-party only |
| `ctx.wizard` | `manage.wizard` | First-party only, with `debug:wizard` |
| `ctx.shared` | None, because values shared between mods are not in API 2 yet | No one |
| `ctx.debug` | None, because it is retired from public mods and debug tooling is first-party | No one |

The entries of the plugin object itself move onto the definition:

| Old plugin entry | Definition entry |
| --- | --- |
| `controller` | The definition's `controller(mod, input)` member, with `armed`, `onKey`, and `onDeath` |
| `register(host, ctx)` | `start(mod)`. While `start` runs, the registry host it was given is `mod.engine?.registry` (first-party or `engine:access`, in-process only) |
| `menu`, `screen`, `hud`, `birth` | The `presentation` member (`menu`, `screen`, `hud`, `birth`) and the `birth` member |
| Game-menu rows | The `actions` member, or `ui.gameMenu.register` |
| Title rows | The `titleActions` member, or `ui.title.registerRow` |

The hooks that pass live game objects stay reachable through `engineHooks(context)` (see Step 8).

Other mods cannot use any row marked first-party only, so a mod that needs only those rows can stay on API 1. `API1_CONTEXT_MAP` in `packages/web/src/mod-api2-shim.ts` names, for every member of the API 1 context, where it went in API 2 or why it has none.

## Step 2: convert the manifest

Schema 2 wraps the manifest in a document: `{ "format": "neo-angband/mod/manifest", "schemaVersion": 2, "data": { ... } }`. The game reads a bare schema 1 manifest, a schema 1 document and a schema 2 document. `ModProject.emit()` already writes schema 2. For a hand-written manifest, run the converter once from a Node script in your mod's repository:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { convertManifestV1, modManifestFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";

const v1 = JSON.parse(readFileSync("manifest.json", "utf8"));
writeFileSync("manifest.json", serializeDocument(modManifestFormat, convertManifestV1(v1)));
```

`serializeDocument` validates the result and throws `DocumentValidationError` when it does not pass. `manifestToV2` does the same job for a `PackManifest` already in memory.

Before, the schema 1 manifest of `samples/tutorials/tutorial-06-add-an-option`:

```json
{
  "id": "tutorial-06-add-an-option",
  "name": "Tutorial 6: Add an Option",
  "version": "1.0.0",
  "shape": "plugin",
  "modApi": 1,
  "engine": ">=0.20.0",
  "author": "neostryder",
  "license": "GPL-2.0-only",
  "repository": "https://github.com/neostryder",
  "description": "...",
  "rules": [{ "flag": "tutorial-06-add-an-option.congratulate", "title": "...", "description": "...", "default": false }]
}
```

After, as the converter writes it (descriptions shortened here):

```json
{
  "format": "neo-angband/mod/manifest",
  "schemaVersion": 2,
  "data": {
    "id": "tutorial-06-add-an-option",
    "name": "Tutorial 6: Add an Option",
    "version": "1.0.0",
    "api": ">=1.0.0 <2.0.0",
    "runtime": "in-process",
    "engine": {
      "range": ">=0.20.0",
      "because": "Carried over from a schema 1 manifest, which gave no reason."
    },
    "description": "...",
    "author": "neostryder",
    "license": "GPL-2.0-only",
    "repository": "https://github.com/neostryder",
    "shape": "plugin",
    "rules": [{ "flag": "tutorial-06-add-an-option.congratulate", "title": "...", "description": "...", "default": false }]
  }
}
```

What the converter changes:

| Schema 1 | Schema 2 |
| --- | --- |
| `"modApi": 1`, `runtime` absent or `"in-process"` | `"runtime": "in-process"`, `"api": ">=1.0.0 <2.0.0"` |
| `"modApi": 2`, `"runtime": "worker"`, `workerEntry` | `"runtime": "worker"`, `"api": "2.0.0-worker"`, `entry` |
| No `modApi` and no `plugin` facet | `"runtime": "data"`, `"api": "*"` |
| `"engine": "<range>"` | `"engine": { "range", "because" }`, with the placeholder reason shown above |
| `dependencies` | `dependencies.required`, each as `{ "range" }` |
| `optionalDependencies` | `dependencies.optional` |
| A `compat` claim of `conflicts` with no `scope`, the only one for that mod, which is not also a dependency | `dependencies.conflicts`, as `{ "range"?, "because" }` |
| Every other `compat` claim | `compat`, unchanged |
| `changelog`, `screenshots` | `listing.changelog`, `listing.screenshots` |
| Every other field | Kept under the same name |

The converter throws `ManifestConversionError` for a mod that ships code without a `modApi` (add `"modApi": 1` first) and for any other `modApi` value.

After converting, replace the placeholder `because` under `engine` with the real reason the mod needs that game version, or remove `engine` if nothing needs it. A required or optional dependency can carry its own `because`. Schema 2 also adds `text` (a default locale and one strings file per locale), `listing.tags` and `budget`.

`budget.msPerTurn` is the time the mod asks for per game turn, above 0 and at most 500 milliseconds. The host does not read it yet, so every mod is held to the default of 50 ms. Only the synchronous part of each call into the mod is timed. A turn over the budget writes a warning to the log. A throw, a rejected promise, or a second turn over 500 ms within 200 game turns counts as a fault, and three faults within 200 game turns switch the mod off until the game next starts.

The validator also checks that the fields agree. A `data` mod has no `entry`, no `plugin` facet and no `.js` or `.mjs` file in its payload. An `in-process` mod's entry is `plugin.js`, a `worker` mod names its `entry`, and a mod that runs code lists `plugin` in `facets` when it lists facets at all. A mod id appears in at most one of `required`, `optional` and `conflicts`, and a mod cannot list itself.

The `api` range decides whether the mod loads. `>=1.0.0 <2.0.0` keeps it on API 1, which this build still loads. An API 2 mod declares `>=2.0.0 <3.0.0` (`MOD_API2_DEFAULT_RANGE`), in both the manifest and the code's own `api`. `apiRangeVerdict(range)` answers `{ ok: true }` or one of four codes: `too-new` (the mod needs a newer game), `too-old` (the mod needs an update), `outside` (the range misses this version for another reason) and `malformed`.

## Step 3: change the shape of the code

An API 2 mod default-exports an `Api2ModDefinition`:

| API 1 `ModPlugin` | API 2 `Api2ModDefinition` |
| --- | --- |
| `api: 1` | `api: ">=2.0.0 <3.0.0"` |
| `hooks(ctx)` | `hooks({ id, flags })` |
| `register(host, ctx)` | `start(mod)`, which may be async. A rejected promise is written to the mod's log. |
| `migrateBag(data, fromSchema, ctx)` | `migrateBag(data, fromSchema)`, which receives a copy |
| `uninstall()` | `stop()` |
| No equivalent | `prefs: { version, migrate }` (see Step 10) |

A definition declares `hooks`, `start` or both, and `prefs.version` is a whole number from 1.

Before:

```ts
import type { ModHooks, ModPluginContext, ModRegistryHost } from "@rpgm-tools/neo-angband-core";

export default {
  api: 1,
  hooks(ctx: ModPluginContext): ModHooks | undefined {
    if (ctx.flags["my-mod.shout"] !== true) return undefined;
    return { messageText: (raw) => raw.toUpperCase() };
  },
  register(_host: ModRegistryHost, ctx: ModPluginContext): void {
    ctx.log("started");
  },
  uninstall(): void {},
};
```

After:

```ts
import type { Api2ModDefinition } from "@rpgm-tools/neo-angband-mod-sdk";

export default {
  api: ">=2.0.0 <3.0.0",
  hooks: ({ flags }) =>
    flags["my-mod.shout"] === true ? { messageText: (raw) => raw.toUpperCase() } : undefined,
  start(mod) {
    mod.meta.log("started");
  },
  stop() {},
} satisfies Api2ModDefinition;
```

Import the SDK with `import type` and check the object with `satisfies`. `defineApi2Mod(definition)` returns its argument and gives the same check, but it is a value import, and a module loaded from a mod folder cannot resolve a package by name. `neo-angband-mod-build` refuses any such import left in `plugin.js`.

## Step 4: handle results instead of exceptions

In API 1 a permission the player refused shows up as a missing `ctx` member (`ctx.ui` is undefined) or as an `AgentCapabilityError` thrown by the call. In API 2 every domain is present and every method returns a promise of an `Api2Result`. Check `ok` before reading `value`:

```ts
const monsters = await mod.view.monsters();
if (monsters.ok) {
  mod.meta.log(`${monsters.value.length} monsters in view`);
} else if (monsters.reason === "not-granted") {
  mod.meta.log(`monster count is off: it needs ${monsters.capability}`);
} else {
  mod.meta.log(monsters.message);
}
```

A failure is `not-granted` (with the `capability` to ask for), `unavailable` (no game yet, no character yet, or a front end without the feature) or `refused` (with a `code`). Every failure has a `message`. `isNotGranted(result)` in the SDK makes the same check as `result.reason === "not-granted"`, though code built with `neo-angband-mod-build` has to write the comparison out for the import reason in Step 3. `mod.meta.granted("event:message")` answers whether a permission is granted without making a call. A fault that is not a permission problem still rejects the promise.

## Step 5: move reads to `view` and `content`

| API 1 | API 2 | Permission |
| --- | --- | --- |
| `ctx.state.actor.player`, `ctx.character.key()` | `view.player()` | `state:player.read` |
| `ctx.state.monsters`, `ctx.inspect` | `view.monsters()`, `view.world()` | `state:monsters.read` |
| `ctx.knownLevel()` | `view.level()` | `state:map.read` |
| `ctx.snapshot()`, `ctx.driver()` | `view.input()` (`token`, `driver`, `phase`, `messagePending`, `prompt`) | `state:interaction.read` |
| All of the above at once | `view.world()`, with `null` for each part the mod may not read | Each part's own |
| `ctx.registries`, `ctx.composedRecords` | `content.records(file)`, `content.lookup({ file, key })` | None |
| `ctx.data`, `ctx.assetUrl(path)` | `content.own()`, `content.asset(path)` | None |
| `ctx.core` | None | |

`view` shows the game as the player knows it. It lists only the monsters the player perceives, with a health band (`unhurt` to `almost`) in place of hit points, the race's base speed in place of its current speed, and only the flags and spells the player's monster memory has learned. Items show what the player has identified, and the level is the remembered map, never the real one. An API 1 mod that read `ctx.state` saw every monster on the level and its exact hit points, so code that counted or tracked hidden monsters has no direct translation.

Before:

```ts
const state = ctx.state;
if (!state) return;
const p = state.actor.player;
ctx.log(`HP ${p.chp}/${p.mhp}`);
const wounded = state.monsters.filter((m) => m !== null && m.hp < m.maxhp);
ctx.log(`${wounded.length} wounded monsters on the level`);
const cat = ctx.registries?.monsters.races.find((r) => r.name === "Scrawny cat");
ctx.log(`found at depth ${String(cat?.level)}`);
```

After:

```ts
const player = await mod.view.player();
if (player.ok) mod.meta.log(`HP ${player.value.hp}/${player.value.maxHp}`);
const monsters = await mod.view.monsters();
if (monsters.ok) {
  const wounded = monsters.value.filter((m) => m.health !== "unhurt");
  mod.meta.log(`${wounded.length} wounded monsters in view`);
}
const cat = await mod.content.lookup({ file: "monster", key: "scrawny-cat" });
if (cat.ok) mod.meta.log(`found at depth ${String(cat.value["depth"])}`);
```

`content.records(file)` returns the records the running game was composed from, mod records included, as JSON. The field names are the JSON names (`depth`, `hit-points`), not the names on the bound objects in `ctx.registries` (`level`, `avgHp` and so on). `content.lookup` finds a record by the key the SDK's `recordKey` derives, which for a named record is a slug of the name (`Scrawny cat` becomes `scrawny-cat`). An unknown file answers `refused` with `unknown-file`, and an unknown key `refused` with `unknown-record`.

`ctx.core` has no API 2 counterpart. Engine functions are not reachable, and constants such as `ctx.core.TV` are not handed over: `KnownItem.tval` is a plain number, so a mod that compared against `TV.SWORD` keeps that number itself.

## Step 6: move actions to `act`

`ctx.intent.submit(token, intent)` becomes `act.submit(token, intent)` (permission `input:intent`), and `ctx.prompt.reply(id, answer)` becomes `act.answer(promptId, answer)` (permission `input:prompt.reply`). The token comes from `view.input()` or `view.world()`. When the game turns the intent down (a stale token, for one), the answer is `refused` with the game's code and reason.

Before:

```ts
const snap = ctx.snapshot?.();
if (!snap || !ctx.intent) return;
const result = ctx.intent.submit(snap.token, { kind: "stop-resting" });
if (!result.accepted) ctx.log(result.reason ?? "refused");
```

After:

```ts
const input = await mod.view.input();
if (!input.ok) return;
const done = await mod.act.submit(input.value.token, { kind: "stop-resting" });
if (!done.ok) mod.meta.log(done.message);
```

An API 2 definition takes the keyboard with its `controller(mod, input)` member, which needs `state:interaction.read`, `input:intent`, and `input:prompt.reply` in the manifest. `armed(context)` tells the game whether the mod is ready. `onKey` hears each key the player presses while the mod holds the keyboard and answers `{ kind: "keep" }` or `{ kind: "release" }`. With `onDeath: "end"`, an ordinary death ends the run, and with the default, `"reincarnate"`, the next character starts. Only one autoplayer holds the keyboard at a time.

`act.controller` has `owns()`, `setStatus(status)`, `markNondeterministic()`, and `release(reason)`. Every call except `owns()` answers `refused` with `not-owner` unless the mod holds the keyboard. An autoplayer plans from the known-world `view` and acts through `act`, and consent to `truth` does not let hidden information into its decisions.

## Step 7: move event listeners

API 1 calls a listener with the event name first, and `ctx.events.on` throws when the permission is missing. API 2 calls the listener with the payload only and answers with a subscription to pass to `off`. Each event still needs `event:<name>`.

Before:

```ts
ctx.events?.on("message", (_type, data) => {
  if (data.msg?.startsWith("You feel")) ctx.log(data.msg);
});
```

After:

```ts
const sub = await mod.events.on("message", (event) => {
  if (event.text.startsWith("You feel")) mod.meta.log(event.text);
});
if (!sub.ok) return;
// later
await mod.events.off(sub.value);
```

The payloads change as well:

| Event | API 1 payload | API 2 payload |
| --- | --- | --- |
| `message` | `{ msg, type }`, where `msg` may be null | `{ text, type }` |
| `combat-outcome` | Every outcome, with `seen`, exact `damage`, and monsters by index | Only outcomes the player took part in or saw. `playerDamage` only when the target is the player. |
| `heal` | Every heal, with `seen` and `amount` | Only heals the player saw. `playerAmount` only for the player. |
| `motion` | Every move, with `seen` | Only moves the player saw. |
| `player-command` | `{ code, dir?, args?, repeats?, phase, token }` | `{ code, dir?, phase, token }` |
| `dungeonlevel`, `driver-changed` | Unchanged | Unchanged |
| `hp`, `mana`, `gold`, `experience`, `playerlevel`, `status`, `inventory`, `equipment`, `monsterlist`, `itemlist`, `enter-store`, `leave-store`, `enter-world`, `leave-world` | Nothing | `null`. Read `view` for the new value. |

In API 2 a monster appears as `{ monster: id }` while the player perceives it and as `"unseen"` otherwise, and a move or heal by an unseen monster is not delivered.

Those 21 events are all API 2 delivers. `events.on` answers `refused` with `unknown-event` for any other name, including `map`, `stats`, `ac`, `light`, `feeling`, `playermoved`, `bolt`, `missile`, `explosion`, `sound`, `bell`, `enter-death`, `leave-death`, `enter-birth` and the level-generation events (`gen-level-start` and the rest). The SDK states the reason for the generation events and for bolts and missiles: they show things the player did not see, such as how a level was built or the path of a bolt out of view.

## Step 8: move hooks

An API 2 mod returns its hooks from `hooks({ id, flags })`, which is asked once when content composes. Each hook gets plain, frozen data and returns plain data, and the host composes it with every other mod's hooks in load order, as it does for API 1. Hooks are synchronous and the API is asynchronous, so a hook cannot call `view`. Keep what a hook needs in your module and update it from `start` or from events.

```ts
let log: (message: string) => void = () => {};

export default {
  api: ">=2.0.0 <3.0.0",
  hooks: () => ({
    monsterBecameVisible: (monster) => log(`${monster.race} (${monster.look}) comes into view`),
    artifactIdentified: (found) => log(`identified ${found.name}`),
    objectListTiebreak: (a, b) => a.dy - b.dy || a.dx - b.dx,
    historyAdd: (entry) => ({ keep: !entry.duplicate }),
  }),
  start(mod) {
    log = (message) => mod.meta.log(message);
  },
} satisfies Api2ModDefinition;
```

`monsterBecameVisible` receives a `KnownMonster`: race, grid, health band, look statuses, and the flags and spells the player has learned, with no hit points. `artifactIdentified` receives `{ name, artifactIndex }`. API 1 hooks on this build receive the same values. Both hooks used to hand over the live `Monster`, and the live object with its `Artifact`, so API 1 code that read other fields off them needs changing either way.

`historyAdd` returns a decision, `{ keep, what?, expandUserInput? }`, in place of changing the entry it was given and returning a boolean. An entry is written only if every mod keeps it. `objectListTiebreak` keeps its `{ dy, dx }` arguments, but `ctx.core.objectListStandardCompare` has no API 2 form, so the comparison is written in the mod. The other hooks with an API 2 form keep their API 1 arguments as plain data: `messageText`, `screenText`, `characterBackground`, `objectInfoText`, `effectIntro`, `historyDisplay`, `saveNoiseScent`, `shapeLearnObviousFlagsDirectly`, `optionsChanged` and `abilityGained`. `mod.hooks.available` lists the hooks this game runs, and `mod.hooks.active` the ones the mod declared.

These hooks have no API 2 form:

| Hook | Why | Meanwhile |
| --- | --- | --- |
| `levelRevisited` | It passes the restored level itself. | The `levelRevisitTracking` policy table for noise and scent tracking, or keep the mod on API 1. |
| `newCharacter`, `walkBlockedByDiggable`, `levelGenerated`, `partialStackMerge`, `packOverflowVictim` | They pass live game objects or the whole game state. | `engineHooks(context)` in an in-process mod with the `engine` domain, or keep the mod on API 1. For the mod's own setup at the start of a life, `meta.newCharacter` tells `start` whether the character was just created. It cannot change the game state the way `newCharacter` can. |
| `projectionRadius` | It runs for projections the player never sees. | The `projectionRadiusClamp` policy table for a clamp at the maximum range, or keep the mod on API 1. |
| `artifactCommit` | It runs when an artifact is generated, before the player has seen it. | `engineHooks(context)` with the `engine` domain, `artifactIdentified` for what the player learns, or keep the mod on API 1. |

## Step 9: move panels and keys

`ctx.ui.openPanel` hands over a shadow root to fill with HTML. API 2 has no DOM: `ui.mount(panel, onAction)` takes a tree of `text`, `button`, `row` and `column` nodes, the host draws it, and `onAction` hears the `action` of each button the player uses. It needs the `ui:panel.mount` permission.

Before:

```ts
if (!ctx.ui) return;
const panel = ctx.ui.openPanel({ id: "notes", label: "Notes" });
panel.root.innerHTML = `<p>Saved.</p><button id="clear">Clear</button>`;
panel.root.getElementById("clear")?.addEventListener("click", () => ctx.prefs.set(null));
```

After:

```ts
const shown = await mod.ui.mount(
  {
    id: "notes",
    title: "Notes",
    root: {
      type: "column",
      children: [
        { type: "text", text: "Saved." },
        { type: "button", label: "Clear", action: "clear" },
      ],
    },
  },
  (action) => {
    if (action === "clear") void mod.store.prefs.set(null);
  },
);
if (shown.ok) await mod.ui.patch(shown.value.panelId, { visible: false });
```

A panel `id` and each button `action` are lower-case letters, digits and hyphens, starting with a letter, up to 64 characters. A text or label holds up to 4096 characters, a row or column up to 32 children, and the tree nests up to 16 levels deep. The host places the panel and styles it, and mounting an id that is already mounted answers `refused` with `bad-panel`. `ui.patch` changes the title, replaces the tree or hides and shows the panel. Tiled panel kinds (`ctx.ui.registerPanelKind`) have no API 2 form.

`ctx.keymaps` becomes `ui.keys`, with `bind(trigger, action)`, `list()` and `remove(trigger)` under the same `keymap:write` permission. `bind` answers `refused` with `trigger-taken` for a key that is not free in the current keyset. There is no `rebind` or `isBindableTriggerKey`: remove the binding and bind again.

## Step 10: move storage

`ctx.prefs` becomes `store.prefs` and `ctx.characterStore` becomes `store.character`, each with `get()` and `set(value)`. Both hold JSON, and `set(null)` removes the value. `store.character` answers `unavailable` until a character exists.

A mod that changes the shape of its stored preferences declares `prefs: { version, migrate(value, fromVersion) }`. The host keeps the version beside the value, calls `migrate` on the first read of an older value and writes the result back. A value stored without a version, which includes everything an API 1 mod wrote through `ctx.prefs`, arrives with `fromVersion` 0, so a player's API 1 preferences carry over.

Character data keeps using `saveSchema` in the manifest and `migrateBag`, which now gets a copy of the data and no `ctx`.

Before:

```ts
const colour = ctx.prefs.get() as string | null;
ctx.prefs.set(colour ?? "red");
ctx.characterStore?.set({ kills: 3 });
```

After:

```ts
export default {
  api: ">=2.0.0 <3.0.0",
  prefs: {
    version: 1,
    migrate: (value, fromVersion) => (fromVersion === 0 ? { colour: value } : value),
  },
  migrateBag: (data, fromSchema) => (fromSchema < 2 ? { kills: data } : data),
  async start(mod) {
    const prefs = await mod.store.prefs.get();
    if (prefs.ok && prefs.value === null) await mod.store.prefs.set({ colour: "red" });
    await mod.store.character.set({ kills: 3 });
  },
} satisfies Api2ModDefinition;
```

## Step 11: move network requests

`ctx.net` becomes `net`, present when the manifest names at least one host with `network:<host>`, `network:local` or `network:*`. `net.request({ url, method, headers, body, timeoutMs })` answers with `{ status, headers, body }` for any HTTP status. A header that needs a secret takes `mod.net.credential("name")` as its value, and the host fills in the whole header value from the credential of that name. `net.credentials` has `status`, `set`, `fromEnvironment` and `remove`, the jobs of `ctx.net.secrets`. A request to a host the manifest does not name answers `not-granted` with `network:<host>`, and any other failure answers `refused` with a net problem code.

```ts
if (!mod.net) return;
const response = await mod.net.request({
  url: "https://example.com/runs",
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": mod.net.credential("api-key") },
  body: JSON.stringify({ depth: 5 }),
});
if (!response.ok) mod.meta.log(response.message);
```

## Step 12: the rest of the context

| API 1 | API 2 |
| --- | --- |
| `ctx.id`, `ctx.engine`, `ctx.flags`, `ctx.newCharacter`, `ctx.log` | `meta.id`, `meta.engine`, `meta.flags`, `meta.newCharacter`, `meta.log` |
| `ctx.api` (an integer) | `meta.api`, a version string such as `"2.0.0"` |
| `ctx.settings.get`, `ctx.settings.all`, `ctx.settings.set` | `meta.settings()`, `meta.setSetting(id, value)`. An unknown id answers `refused` with `unknown-setting`. |
| `ctx.mods()` | `meta.mods()` |
| `ctx.options` | The `optionsChanged` hook, after the player changes an option |
| `ctx.profiles`, `ctx.session` | `manage.profiles`, `manage.session`, first-party only |

`meta.engine` is for diagnostics: decide on `meta.api`, never on the game version. `manage` exists only for the game's own mods: the build lists each one by its repository (`FIRST_PARTY_ORIGINS`), and a mod gets `manage` when it came from that repository with its files unchanged, was listed for that capability, and the player allowed it on its own confirmation screen. `truth` goes to any in-process mod the player allows, with a consent line saying the mod sees what the character has not found. A Worker mod gets neither. Test `mod.manage` and `mod.truth` before use, because they are absent from a mod that does not hold them.

## Runtime tiers

An in-process mod runs in the game's own page. API 2 built through the in-process host goes through the same permissions and facades as API 1 and hands the mod copies of data, but it does not isolate the code: the module still runs in the page with the page's own access, as an API 1 plugin does ([PLUGINS.md](PLUGINS.md)).

A Worker mod runs in an opaque-origin Worker inside a sandboxed frame, and talks to the game only through a message port ([WORKER_ISOLATION.md](WORKER_ISOLATION.md)). Its manifest declares `"runtime": "worker"`, an `api` range such as `>=2.0.0 <3.0.0` and the module to start in `entry`, and the module default-exports the same definition an in-process API 2 mod does. Each call becomes a message to the game's broker, which answers it with the in-process host under the permissions the player granted.

The older Worker interface, declared in schema 1 as `"modApi": 2` with a `workerEntry`, is retired. Its manifest still reads (the converter above gives it `"api": "2.0.0-worker"`, a prerelease no stable range admits), but the loader will not run its code: the Mods screen asks for it to be rebuilt as an API 2 Worker mod. To rebuild one, write it as a definition with `hooks`, `start` and the domains it needs, rename its permissions as [API2.md](API2.md) ("In a Worker") lists, and set `api` to `>=2.0.0 <3.0.0`.

Moving a mod into a Worker costs it these things:

- The DOM. A Worker has no document, so drawing goes through host-drawn panels (`ui.mount`).
- The network. The page's policy refuses every connection and the Worker's network globals are deleted before the mod loads. A mod that names a host reaches it through `net`, which the game performs for it; `net.credential` hands the Worker a reference, never the secret.
- The game's storage. The opaque origin gives the Worker none of the game's IndexedDB, Cache Storage or files. Preferences and the character's bag go through `store`, and a mod's own files through `content.asset`.
- Imports by package name. A Worker mod imports only its own files by relative path, with no import cycles, at most 256 script files and 16,777,216 characters of source. Bundle a package in.
- `import.meta.url` and computed dynamic imports of the mod's own files, because each module is a `data:` URL. Read files through `content.asset`.
- `eval`, nested Workers and `BroadcastChannel`.
- Live objects of any kind. Everything crosses the port as structured-clone data, and every call returns a promise.
- Hooks that answer inside a turn. A turn cannot wait for a message, so a Worker declares those answers as `policies` tables, and `hooks(context)` may name only `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified`. Any other hook function is not installed and is reported on the Mods screen.
- `manage` and `truth`, and a wildcard grant: a `"*"` permission grants a Worker nothing.

A message over 64 KB is refused, and a Worker that answers no ping for 5 seconds is switched off for the session. [API2.md](API2.md) has the limits and what happens to a migration that takes over 3 seconds.

## Checklist

1. Find each part of the old context in Step 1's table. A mod that needs only first-party rows stays on API 1.
2. Convert the manifest with `convertManifestV1` and fix the `engine` reason it writes.
3. Set `api` to `>=2.0.0 <3.0.0` in the manifest and in the definition, and default-export the definition with `satisfies Api2ModDefinition`.
4. Rename `register` to `start` and `uninstall` to `stop`, drop `ctx` from `migrateBag`, and give `hooks` only `{ id, flags }`.
5. Check `ok` on every call result, and handle `not-granted` by switching off the feature that needs it.
6. Replace `ctx.state`, `ctx.core` and `ctx.registries` reads with `view` and `content`, and expect only what the player knows.
7. Move listeners to `events.on`, read the payload alone, and drop events API 2 does not deliver.
8. Update `monsterBecameVisible`, `artifactIdentified` and `historyAdd` to their new arguments and return values.
9. Rebuild panels as `ui.mount` trees and keymaps as `ui.keys`.
10. Declare `prefs` with a migration that reads version 0, so existing preferences carry over.
