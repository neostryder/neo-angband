# Mod API 2

API 2 is the set of calls a mod's code gets from the game: what it can read, what it can do, and what it hears. Every call returns plain data, a permission the player turned down comes back as a result you can check, and reads show the game as the player knows it. The types are in `@rpgm-tools/neo-angband-mod-sdk`, and the in-process host is in the web package (`packages/web/src/mod-api2-host.ts`).

Status: the types, the version check, the in-process host and the Worker broker are built. The folder loader still loads API 1 plugins, and an in-process API 2 mod reaches it wrapped as one (`api2Plugin` in `packages/web/src/mod-api2-shim.ts`). A Worker mod is written against API 2 and reaches the same domains through the broker (see In a Worker). API 1 plugins run unchanged.

## A mod in API 2

A mod's code default-exports a definition:

```ts
import { defineApi2Mod } from "@rpgm-tools/neo-angband-mod-sdk";

export default defineApi2Mod({
  api: ">=2.0.0 <3.0.0",
  hooks: ({ flags }) => ({
    messageText: (raw) => (flags["shout"] ? raw.toUpperCase() : raw),
  }),
  async start(mod) {
    const monsters = await mod.view.monsters();
    if (!monsters.ok) {
      mod.meta.log(`no monster list: ${monsters.reason}`);
      return;
    }
    mod.meta.log(`${monsters.value.length} monsters in sight`);
  },
});
```

`hooks` is asked once when content composes and gets only the mod's id and flags. `start` runs when the game is ready and gets the API. `stop` runs before the mod is taken down, `migrateBag(data, fromSchema)` brings the mod's character data forward, and `prefs` declares how stored preferences migrate (see Storage).

## Versions

`api` is a semver range over the API's own version, `MOD_API2_VERSION` (now `2.0.0`). The game's version is for diagnostics only. The minor number rises when the API gains a call. The major number rises when an existing call changes or goes away, so `>=2.0.0 <3.0.0` (`MOD_API2_DEFAULT_RANGE`) is the range to declare.

A loader calls `apiRangeVerdict(range)` before importing any mod code. It returns `{ ok: true }` or a code with a sentence: `too-new` when the mod needs a newer game, `too-old` when the mod needs an update, `outside` when the range sits inside the same major but misses this version, and `malformed` when the range does not parse.

## Results

Every call returns a promise of an `Api2Result`. Check `ok` before using `value`:

| `reason` | When | Extra fields |
| --- | --- | --- |
| (none, `ok: true`) | The call worked. | `value` |
| `not-granted` | The mod lacks the permission the call needs. | `capability`, the string to ask for |
| `unavailable` | Nothing to answer yet: no game running, no character, or a front end without that feature. | `message` |
| `refused` | The game turned the request down: a stale input token, a key already bound, a record that does not exist. | `code`, `message` |

A call never throws for a missing permission. `isNotGranted(result)` tells a missing permission apart from the other failures, and `mod.meta.granted(capability)` answers without making a call. Permissions use the same strings as API 1 (`state:monsters.read`, `input:intent`, `event:message`), typed as `Api2Capability`.

## The domains

| Domain | What it holds | Permission |
| --- | --- | --- |
| `meta` | The mod's id, flags, settings, the API and game versions, `newCharacter`, the list of enabled mods, and `log`. | None |
| `view` | The known world: `world()`, `player()`, `monsters()`, `level()`, `input()`, and `isCurrent(token)`. | `state:<domain>.read` for each part |
| `act` | `submit(token, intent)`, `answer(promptId, answer)`, and `controller` while the mod holds the keyboard. | `input:intent`, `input:prompt.reply` |
| `events` | `on(name, listener)` and `off(subscription)`. | `event:<name>` |
| `hooks` | The hooks this game runs (`available`) and the ones this mod declared (`active`). | None |
| `content` | The mod's own files (`own`, `asset`), the running game's records (`records(file)`), and `lookup({ file, key })` by the key `recordKey` derives. | None |
| `ui` | Host-drawn panels (`mount`, `patch`) and the mod's key bindings (`keys`). | `ui:panel.mount`, `keymap:write` |
| `store` | `prefs`, kept apart from any character, and `character`, kept in the current character's save. | None |
| `net` | Requests to the hosts the manifest names, with credentials passed by reference. Present only when the manifest names a host. | `network:<host>` |
| `manage` | Profiles and session control. First-party mods only. | `profiles:manage`, `session:control` |
| `truth` | Every monster and the real map. The first-party autoplayer only. | None beyond the allowlist |

### What `view` shows

`view` is built from core's known world (`buildKnownWorld`): the monsters the player perceives, with health as the look command words it, the abilities the player has learned, the map as the player remembers it, and items as far as the player has identified them. A monster the player cannot see is not in any part of it, and changing that monster changes nothing a mod can read. `world()` returns every part at once, with `null` for each part the mod has no permission for. The single-part calls answer `not-granted` instead.

Each value carries a `token` naming the input wait it was read at. `act.submit` takes that token, and a token from an older wait comes back `refused`.

### Panels

`ui.mount` takes the same panel grammar as Worker mods: `text`, `button`, `row` and `column` nodes under a panel `id` of lower-case words joined by hyphens. The host draws it, and `onAction` hears the `action` of each button the player uses. A mod in API 2 does not get a DOM element.

## Events

An event arrives only when the player could know about it. `combat-outcome`, `motion` and `heal` come through when the player took part or the grid is in view. A monster appears as `{ monster: id }` while the player perceives it and as `"unseen"` otherwise, and movement or healing by a monster the player cannot see does not arrive. Damage and healing amounts are given only for the player, as `playerDamage` and `playerAmount`.

| Event | Payload |
| --- | --- |
| `message` | `{ text, type }` |
| `dungeonlevel` | `{ depth, levelId, cause, arena }` |
| `combat-outcome` | `{ attacker, target, kind, hit, died, grid, playerDamage? }` |
| `motion` | `{ who, from, to, kind }` |
| `heal` | `{ who, grid, playerAmount? }` |
| `player-command` | `{ code, dir?, phase, token }` |
| `driver-changed` | who holds the keyboard |
| `hp` `mana` `gold` `experience` `playerlevel` `status` | `null` |
| `inventory` `equipment` `monsterlist` `itemlist` | `null` |
| `enter-store` | `null`: the player walked into a shop. |
| `leave-store` | `null`: the player left the shop. |
| `enter-world` | `null`: a game is starting to run. |
| `leave-world` | `null`: the game is stopping. |

A `null` payload is a notice that something changed: read the view for the new value. Level generation, bolts, missiles and explosions have no API 2 event, since they show things the player did not see.

## Hooks

An API 2 mod declares its hooks in `hooks(context)`. Each one gets plain, frozen data and returns plain data. The host composes them with every other mod's hooks in load order, the same way it composes API 1 hooks. A mod can also give hook answers as data in `policies(context)`, which a Worker mod has to do for every hook that answers (see Policy tables).

`messageText`, `screenText`, `characterBackground`, `objectInfoText`, `effectIntro` and `historyDisplay` restate text. `historyAdd` returns `{ keep, what?, expandUserInput? }`, and an entry is written only if every mod keeps it. `objectListTiebreak`, `saveNoiseScent` and `shapeLearnObviousFlagsDirectly` answer a question. `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified` tell the mod something happened.

These API 1 hooks have no API 2 form:

| Hook | Why | Instead |
| --- | --- | --- |
| `newCharacter`, `walkBlockedByDiggable`, `levelGenerated`, `partialStackMerge`, `packOverflowVictim`, `levelRevisited` | They pass live game objects or the whole game state. | API 1, until each gets a policy or a declaration in content. |
| `projectionRadius` | It runs for projections the player never sees. | API 1 for now. |
| `artifactCommit` | It runs when an artifact is generated, before the player has seen it. | `artifactIdentified` for what the player learns. |

## Policy tables

`policies(context)` returns changes as data: hook answers, and a few game registrations. The game applies them itself, without calling the mod, so a table works the same in a Worker and in process. Tables do not limit what a mod can change. An in-process mod keeps every hook function it has, and when it declares a function and a table for the same hook, the function is used.

| Table | Where it applies | What `where` may name |
| --- | --- | --- |
| `messageText`, `characterBackground` | the same | nothing |
| `screenText` | `screenText` | `screen`, `part`, `column` |
| `objectInfoText` | `objectInfoText` | `section`, `tval`, `kind`, `aware` |
| `effectIntro` | `effectIntro`, on the intro's text | `effect`, `itemClass`, `aimed`, `activation`, `describedActivation` |
| `historyAdd` | `historyAdd` | `type`, `duplicate` |
| `historyDisplay` | `historyDisplay` | `type` |
| `objectListOrder` | `objectListTiebreak` | not a rule table |
| `saveNoiseScent`, `shapeLearnObviousFlagsDirectly` | the same | not a rule table |
| `storeDiscountRoll` | the stores' discount roll | not a rule table |
| `tileMap` | the mod's tile filler | not a rule table |

A text rule is `{ find, replace, match, where }`. `match` is `"exact"` (the whole text, and the default), `"substring"` (every occurrence) or `"prefix"`. Matching is literal text with no regular expressions, so a rule cannot stall a turn. Rules run in order, each on the text the one before it produced, and `where` limits a rule to call sites whose named fields equal the values given. A `historyAdd` rule may be `{ find, drop: true }` instead, which keeps a matching entry out of the history. `objectListOrder` lists the keys `dy`, `dx`, `-dy` and `-dx`: the first key that differs between two entries orders them, and a minus sign sorts that key high to low. The two switches take `true`.

`storeDiscountRoll` is `{ minCost, tiers }`. When a store stocks an object worth at least `minCost` (0 if left out), it tries each tier `{ oneIn, percent }` in order, and the first one-in-`oneIn` roll that comes up takes `percent` off that stack. The rolls come from the game's own random numbers, so a seeded game stays repeatable. If two mods declare a discount roll, the one that loads later is used.

`tileMap` lists rules of the form `{ monster, like, hue, packs }`, or `object` in place of `monster`. A rule gives a monster race or object kind the tile that the `like` index has now, turned `hue` degrees around the colour wheel when `hue` is set. It only fills a tile the pack leaves empty, so it never repaints anything a pack draws. `packs` limits a rule to those pack ids, and a pack that cannot recolour skips any rule with a `hue`.

A table holds up to 256 rules, `find` and `replace` up to 4096 characters each, and `where` up to 8 fields. A discount roll has 1 to 16 tiers, `oneIn` from 1 to 1000000 and `percent` from 1 to 99. An unknown table or field is refused, not ignored, and so are tables that break these limits; `checkApi2Policies` says why. A mod whose tables are refused gets none of them.

```ts
export default defineApi2Mod({
  api: ">=2.0.0 <3.0.0",
  policies: () => ({
    messageText: [{ find: "You feel", replace: "You sense", match: "prefix" }],
    objectListOrder: ["dy", "dx"],
    storeDiscountRoll: { minCost: 5, tiers: [{ oneIn: 25, percent: 25 }, { oneIn: 150, percent: 50 }] },
  }),
});
```

Each kind of table is one entry in `API2_POLICY_KINDS` (`packages/mod-sdk/src/api2/policies.ts`). The entry gives the table's name, the hook or registration it feeds, the check for its value, and what it installs; `checkApi2Policies` and `api2PolicyEffects` only walk that list. To add a kind, add its member to `Api2Policies` and its entry to the list, test it in `policies.test.ts`, and give it a row in the table above. A kind that feeds a registration the game has not installed from a table before also needs a target in `installApi2PolicyRegistrations` (`packages/web/src/mod-api2-shim.ts`).

## Storage

`store.prefs.get()` and `set(value)` hold one JSON value per mod. A mod that changes the shape of what it stores declares `prefs: { version, migrate(value, fromVersion) }`. The host stores the version beside the value, calls `migrate` once on the first read after an upgrade, and writes the result back. A value stored before the mod declared a version counts as version 0.

`store.character` holds one JSON value in the current character's save and answers `unavailable` until a character exists. Bring its shape forward with `migrateBag`.

## Network and credentials

`net.request({ url, method, headers, body })` sends a request to a host the manifest names. A header can hold `mod.net.credential("api-key")` in place of a string. The host fills in the value, and the mod never sees it. `net.credentials` sets, checks and removes credentials by name. A request to a host the manifest does not name answers `not-granted` with `network:<host>`. Any other failure is `refused` with one of the net problem codes (`timeout`, `too-large`, `redirect`, and the rest).

## In a Worker

Running in a Worker is a choice a mod makes for isolation. Its code runs apart from the game, and the game reaches it only through messages. It is not the only way for a mod to change the game, and nothing here limits what an in-process mod can do.

A mod with `"runtime": "worker"` default-exports the same definition and gets the same domains, results and known-only data as an in-process mod. Its manifest names an `api` range that API 2 satisfies and the module to start in `entry`. Each call becomes a message to the game's broker (`packages/web/src/mod-worker/host.ts`), which serves it with the in-process host and posts back a copy of the answer. The Worker runs in a sandbox with no network and none of the game's storage ([WORKER_ISOLATION.md](WORKER_ISOLATION.md)).

Running there costs a mod these things:

- Hooks that answer inside a turn. A turn cannot wait for a message, so every hook that returns an answer comes from `policies`. In a Worker, `hooks(context)` may declare only `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified`, and the game passes each one on without waiting. Any other hook function is reported on the Mods screen and not installed.
- Immediate answers. Every call returns a promise, and every value is a copy. `meta.granted` is the only question the Worker answers itself.
- `manage` and `truth`. No Worker mod gets either.
- Files and the network. `content.asset(path)` answers a `data:` URL holding the file's bytes, since the sandbox can load nothing. `net.credential(name)` gives the Worker a reference only; the game keeps the value and adds it to the request after the request leaves the Worker.
- A wildcard grant. A Worker gets the permissions the player granted under their API 2 names, and `"*"` grants nothing.

The broker refuses a message over 64 KB and any call past 200 in one second. It pings the Worker every second, and a Worker that leaves a ping unanswered for 5 seconds is stopped and switched off for the session, with the notice a mod that keeps failing gets. When the game asks the Worker to migrate its bag or its preferences and has no answer within 3 seconds, it goes on without one: the character keeps its old bag, the stored preferences stay as they were, and `store.prefs.get` answers `unavailable`. An answer that arrives after that is dropped. The Mod performance screen shows a Worker mod's reply time and network wait in their own columns, apart from its CPU time.

The preview Worker ABI (`modApi: 2` with `workerEntry`) is retired. Its manifest still reads, and the loader refuses its code with a note to rebuild it against API 2. Its Worker-only permission names convert to API 2 names: `ui:panel` becomes `ui:panel.mount` and `state:model.read` becomes `state:player.read`. `prefs:read`, `prefs:write` and `asset:read` become nothing, since API 2 asks no permission for a mod's own preferences and files, and so do `command:submit`, `ui:region`, `query:snapshot`, `registry:declare`, `policy:install` and `hook:respond`, which have no API 2 form. `WORKER_CAPABILITY_ALIASES` in the SDK holds the whole table.

## First-party seams

`manage` and `truth` exist only for mods the game's own build names as first-party, and they are absent from every other mod's API: test `if (mod.truth)` and there is nothing to request. `truth.monsters()` lists every monster with exact hit points and speed, and `truth.level()` gives the real map. An autoplayer uses it to plan and still acts through `act`, on what the player knows.

## Moving from API 1

Most of the API 1 context has a direct home in API 2. `API1_CONTEXT_MAP` in `packages/web/src/mod-api2-shim.ts` lists every member and where it went. The main changes:

| API 1 | API 2 |
| --- | --- |
| `ctx.state`, `ctx.core`, `ctx.registries` | `view` for reads, `act` for commands, `content.records` for data |
| `ctx.inspect`, `ctx.knownLevel`, `ctx.character` | `view.monsters`, `view.level`, `view.player` |
| `ctx.snapshot`, `ctx.intent`, `ctx.prompt` | `view.input`, `act.submit`, `act.answer` |
| `ctx.events.on(type, (type, data) => ...)` | `events.on(name, (payload) => ...)`, which returns a subscription |
| `ctx.ui` (a DOM element) | `ui.mount` with the panel grammar |
| `ctx.keymaps` | `ui.keys` |
| `ctx.prefs`, `ctx.characterStore` | `store.prefs`, `store.character` |
| `ctx.data`, `ctx.assetUrl`, `ctx.composedRecords` | `content.own`, `content.asset`, `content.records` |
| `ctx.profiles`, `ctx.session` | `manage`, first-party only |

`ctx.display`, `ctx.subwindows`, `ctx.tiles` and `ctx.keyRepeat` have no API 2 form, since they reach the host's own drawing and timing. Knowledge-menu contents, values shared between mods, the backup folder and mod installation are not in API 2 yet.
