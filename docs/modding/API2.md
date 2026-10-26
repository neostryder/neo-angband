# Mod API 2

API 2 is the set of calls a mod's code gets from the game: what it can read, what it can do, and what it hears. Every call returns plain data, a permission the player turned down comes back as a result you can check, and reads show the game as the player knows it. The types are in `@rpgm-tools/neo-angband-mod-sdk`, and the in-process host is in the web package (`packages/web/src/mod-api2-host.ts`).

Status: the types, the version check, the in-process host, the Worker broker and the folder loader are built. The loader runs an in-process API 2 mod wrapped as a plugin (`api2Plugin` in `packages/web/src/mod-api2-shim.ts`), runs a Worker mod through the broker (see In a Worker), and runs API 1 plugins unchanged.

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

`checkApi2Definition`, the check `api2Plugin` runs, refuses a definition with neither `hooks` nor `start`, a member that is not a function, a `prefs.version` that is not a whole number from 1, and an `api` range this host's version does not satisfy.

## Versions

`api` is a semver range over the API's own version, `MOD_API2_VERSION` (now `2.0.0`). The game's version is for diagnostics only. The minor number rises when the API gains a call. The major number rises when an existing call changes or goes away, so `>=2.0.0 <3.0.0` (`MOD_API2_DEFAULT_RANGE`) is the range to declare.

A loader calls `apiRangeVerdict(range)` before importing any mod code. It returns `{ ok: true }`, or `ok: false` with a `code` and a `why` sentence naming both versions. The code is `malformed` when the range is missing or does not parse. It is `too-new` when every version the range names has a higher major number than this game's API, so the mod needs a newer game, and `too-old` when every one has a lower major number, so the mod needs an update. Any other miss is `outside`, such as `>=2.1.0 <3.0.0` on a game with API 2.0.0.

## Results

Every call returns a promise of an `Api2Result`. Check `ok` before using `value`:

| `reason` | When | Extra fields |
| --- | --- | --- |
| (none, `ok: true`) | The call worked. | `value` |
| `not-granted` | The mod lacks the permission the call needs. | `capability`, the string to ask for, and `message` |
| `unavailable` | Nothing to answer yet: no game running, no character, or a front end without that feature. | `message` |
| `refused` | The game turned the request down: a stale input token, a key already bound, a record that does not exist. | `code`, `message` |

A call never throws for a missing permission. `isNotGranted(result)` tells a missing permission apart from the other failures, and `mod.meta.granted(capability)` answers without making a call. Permissions use the same strings as API 1 (`state:monsters.read`, `input:intent`, `event:message`), typed as `Api2Capability`. A fault inside the host that is not a permission check still rejects the promise, as it would in API 1.

## The domains

| Domain | What it holds | Permission |
| --- | --- | --- |
| `meta` | The mod's `id`, `flags` and `tier`, the API and game versions (`api`, `engine`), `newCharacter`, `granted(capability)`, `log`, its numeric settings (`settings`, `setSetting`), and the enabled mods (`mods`). | None |
| `view` | The known world: `world()`, `player()`, `monsters()`, `level()`, `input()`, and `isCurrent(token)`. | `state:player.read`, `state:monsters.read`, `state:map.read` and `state:interaction.read` for the single parts, or `state:*.read`; none for `world()` and `isCurrent` |
| `act` | `submit(token, intent)`, `answer(promptId, answer)`, and `controller`, which works only while the mod holds the keyboard. | `input:intent`, `input:prompt.reply`; none for `controller` |
| `events` | `on(name, listener)` and `off(subscription)`. | `event:<name>` |
| `hooks` | The hooks this game runs (`available`) and the ones this mod declared (`active`). | None |
| `content` | The mod's own files (`own`, `asset`), the running game's records (`records(file)`), and `lookup({ file, key })` by the key `recordKey` derives. | None |
| `ui` | Host-drawn panels (`mount`, `patch`) and the mod's key bindings (`keys`). | `ui:panel.mount`, `keymap:write` |
| `store` | `prefs`, kept apart from any character, and `character`, kept in the current character's save. | None |
| `net` | Requests to the hosts the manifest names, with credentials passed by reference. Present only when the manifest asks for a `network:` permission. | `network:<host>` |
| `manage` | Profiles and session control. First-party mods only. | `profiles:manage`, `session:control` |
| `truth` | Every monster and the real map. Any in-process mod the player allows it. | `state:map-actual.read` |

### What `view` shows

`view` is built from core's known world (`buildKnownWorld`): the monsters the player perceives, with health as the look command words it, the abilities the player has learned, the map as the player remembers it, and items as far as the player has identified them. A monster the player cannot see is not in any part of it, and changing that monster changes nothing a mod can read. A mimic the player takes for an object is not listed as a monster, and while the player hallucinates `monsters` is empty and `monstersHidden` is `"hallucinating"`. A monster's `id` is a handle given out on each level in the order the player first perceives monsters there, not the game's monster index, and the list runs nearest first. Timed effects show the grade name the status line prints, a recall or deep descent shows only that it is active, a recharging item shows the count its name gives (`charging`), `unknownRunes` is the name's `{??}`, and a remembered trap stays as the player last saw it. `world()` returns every part at once, with `null` for each part the mod has no permission for. The single-part calls answer `not-granted` instead.

Each value carries a `token` naming the input wait it was read at. `act.submit` takes that token, and a token from an older wait comes back `refused`. `isCurrent(token)` says whether that wait is still the current one. A `target` intent names its monster by the `id` the view gave it; an id for a monster the player does not perceive now is refused like any monster that cannot be targeted.

A monster's `visible` means eyesight: blindness, darkness and invisibility can leave a sensed monster listed with `visible: false`; infravision and see-invisible count when they let the player see it. A stationary monster first perceived during hallucination receives its sighting notification when the hallucination clears. Remembered item auras use the last observed object properties and the player's current rune knowledge, and remembered traps include only the traps the player perceived.

Shop visits and shop knowledge screens record stock and owner observations, and known-world reads at a shop's entrance refresh that shop. Other shops retain their last observations for the session, or return empty stock and an unnamed owner if they have not been inspected. Loading a game starts with unknown shop observations. A host that draws a shop screen calls `observeKnownStore(state, store)` to record the stock it shows.
### The controller

`act.controller` has `owns()`, `setStatus(status)`, `markNondeterministic()` and `release(reason)`. Every call but `owns()` answers `refused` with the code `not-owner` unless the mod holds the keyboard. An API 2 definition takes the keyboard with its `controller` member, which needs `state:interaction.read`, `input:intent` and `input:prompt.reply` in the manifest. `onKey` hears each key the player presses while the mod holds the keyboard and answers `{ kind: "keep" }` or `{ kind: "release" }`. `onDeath: "end"` lets an ordinary death end the run instead of starting the next character.

A controller can act in an open store. The host asks it for a decision at phase `store` and passes the `shop-buy`, `shop-sell` or `shop-exit` intent it returns to the shop screen.

### Panels

`ui.mount` takes the same panel grammar as Worker mods: `text`, `button`, `row` and `column` nodes under a panel `id`. The `id` and each button's `action` are lower-case letters, digits and hyphens, start with a letter, and run to 64 characters at most. A text holds up to 4096 characters, a row or column up to 32 children, and the tree nests up to 16 deep. The host draws the panel, and `onAction` hears the `action` of each button the player uses. `ui.patch` replaces the title (`null` removes it), the tree, or `visible`. A panel outside the grammar, a second panel with an id already mounted, or a patch to a panel that is not mounted comes back `refused` with the code `bad-panel`. A mod in API 2 does not get a DOM element.

### Title screen rows

A first-party mod with `ui:title` adds a row to the title screen with `ui.title.registerRow({ id, label, run })` and removes it with `ui.title.removeRow`. The `id` uses the same format as a panel `id`: lower-case letters, digits and hyphens, a letter first, 64 characters at most, and free among the mod's own rows. An id outside the format, such as `squire:new-character`, or one already in use comes back `refused` with the code `bad-title-row`. The result is the only sign, since nothing is logged and no row appears, so a mod checks it. `neo-angband-mod-check` flags a literal id outside the format as `checks/title-row-id`.

### Mod logs

`mod.meta.log(message)` writes an `info` line on the channel `mod:<id>` in the game's log. A release build keeps warnings and errors only, so those lines stay out of the log until the level is raised. There are three ways to raise it: press `L` on the "Report a problem" page, which keeps the choice; launch the desktop game with `--log=info` (or `--log=debug`), which applies to that launch only; or add `?log=info` to the address of the web build. The desktop game writes the log to a file in the `logs` folder beside the saves, one file per launch, and the report page includes the tail.

## Events

An event arrives only when the player could know about it. `combat-outcome` reports outcomes against the player or a perceived monster in view; attacking an unseen monster does not reveal its position or outcome. A monster appears as `{ monster: id }` when the player perceived it as the event happened and as `"unseen"` otherwise, even when the event removed it (a kill). Movement or healing by a monster the player cannot perceive in view does not arrive. A movement omits `from` when the player did not perceive the monster at its origin before it moved. Damage and healing amounts are given only for the player, as `playerDamage` and `playerAmount`. Suppressed events assign no monster handles, and healing while the player was away from a persistent level emits no event.

| Event | Payload |
| --- | --- |
| `message` | `{ text, type }` |
| `dungeonlevel` | `{ depth, levelId, cause, arena }` |
| `combat-outcome` | `{ attacker, target, kind, hit, died, grid, playerDamage? }` |
| `motion` | `{ who, from?, to, kind }` |
| `heal` | `{ who, grid, playerAmount? }` |
| `player-command` | `{ code, dir?, args?, phase, token }` |
| `driver-changed` | `{ kind: "player" }` or `{ kind: "controller", owner, label?, reason? }`: who holds the keyboard |
| `hp` `mana` `gold` `experience` `playerlevel` `status` | `null` |
| `inventory` `equipment` `monsterlist` `itemlist` | `null` |
| `enter-store` | `null`: the player walked into a shop. |
| `leave-store` | `null`: the player left the shop. |
| `enter-world` | `null`: a game is starting to run. |
| `leave-world` | `null`: the game is stopping. |

`player-command` fires as the game loop takes a command from the player and before the command runs, so a `state:*` read in the listener still shows the world the command answered, and the command's effect arrives later as its own events (`motion`, `combat-outcome`, `hp`). It carries `dir` when the command has one. `args` keeps only `handle`, `floor`, `spell` and `index`, and only when each is a non-negative whole number. The commands an installed controller gives, the follow-up steps of a run or a repeat count, and shop buying and selling do not fire it.

A `null` payload is a notice that something changed: read the view for the new value. Level generation, bolts, missiles and explosions have no API 2 event, since they show things the player did not see.

`events.on` answers `refused` with `unknown-event` for a name not in this table, `not-granted` without `event:<name>`, and `unavailable` before a game is running. The listener gets the payload alone.

## Hooks

An API 2 mod declares its hooks in `hooks(context)`. Each one gets plain, frozen data and returns plain data. The host composes them with every other mod's hooks in load order, the same way it composes API 1 hooks. A mod can also give hook answers as data in `policies(context)`, which a Worker mod has to do for every hook that answers (see Policy tables).

`messageText`, `screenText`, `characterBackground`, `objectInfoText`, `effectIntro` and `historyDisplay` restate text. `historyAdd` returns `{ keep, what?, expandUserInput? }`, and an entry is written only if every mod keeps it. `objectListTiebreak`, `saveNoiseScent` and `shapeLearnObviousFlagsDirectly` answer a question. `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified` tell the mod something happened.

These API 1 hooks have no API 2 form:

| Hook | Why | Instead |
| --- | --- | --- |
| `newCharacter`, `walkBlockedByDiggable`, `levelGenerated`, `partialStackMerge`, `packOverflowVictim` | They pass live game objects or the whole game state. | `engineHooks`, or an API 1 plugin. |
| `levelRevisited` | It passes the restored level itself. | The `levelRevisitTracking` policy table. |
| `projectionRadius` | It runs for projections the player never sees. | The `projectionRadiusClamp` policy table. |
| `artifactCommit` | It runs when an artifact is generated, before the player has seen it. | `engineHooks`, or `artifactIdentified` for what the player learns. |

`engineHooks(context)` is the way to reach those. It returns the game's own hook members by name, and the game calls them with the live arguments it always passed. It is asked only when the mod has the `engine` domain, which is every first-party mod and any other mod the player gave `engine:access`, and never in a Worker. A name that already has an API 2 form is refused, so each hook is declared one way.

`engineTiles(context)` is the same door for a tile set. It returns a `filler` that supplies tiles for monsters and objects the pack does not draw, and a `player` provider that picks the player's tile from the character's shape, class, race and level. It needs `registry:tiles` and the `engine` domain, and a mod that also declares a `tileMap` table declares its filler in only one of the two.

`engine.registry` is the door for what a mod registers with the game itself: effect handlers, projection handlers, commands and their verbs, rooms, profiles, blows, stores, menus and the rest of what an API 1 `register(host, ctx)` was given as `host`. It is that same host, and each member needs the same `registry:` permission it needs there (`registry:effect`, `registry:projection`, `registry:command` and so on; `neo-angband-mod-check` reports one the manifest lacks). It is present only for first-party mods and for a mod the player gave `engine:access`, never in a Worker, and only while `start` runs: the game builds it for the mod then, so `hooks`, `policies`, `engineHooks` and `engineTiles` do not see it. A mod reads `mod.engine?.registry` in `start` and installs what it needs.

## Policy tables

`policies(context)` returns changes as data: hook answers, and a few game registrations. The game applies them itself, without calling the mod, so a table works the same in a Worker and in process. Tables do not limit what a mod can change. An in-process mod keeps every hook function it has, and when it declares a function and a table for the same hook, the function is used.

Each table needs its matching registry permission, listed below, in either runtime. A missing grant skips only the tables that need it; the mod's other tables and hook functions remain available. `registry:*` covers every table, and a bare `*` grants nothing. The in-process host evaluates policies during guarded hook composition and reuses them for startup registrations. A factory that throws contributes no tables and does not stop the game from starting.

| Table | Where it applies | What `where` may name | Permission |
| --- | --- | --- | --- |
| `messageText`, `characterBackground` | the same | nothing | `registry:message` |
| `screenText` | `screenText` | `screen`, `part`, `column` | `registry:ui-entry` |
| `objectInfoText` | `objectInfoText` | `section`, `tval`, `kind`, `aware` | `registry:effect-info` |
| `effectIntro` | `effectIntro`, on the intro's text | `effect`, `itemClass`, `aimed`, `activation`, `describedActivation` | `registry:effect-info` |
| `historyAdd` | `historyAdd` | `type`, `duplicate` | `registry:message` |
| `historyDisplay` | `historyDisplay` | `type` | `registry:message` |
| `objectListOrder` | `objectListTiebreak` | not a rule table | `registry:tval` |
| `saveNoiseScent` | the same | not a rule table | `registry:monster` |
| `shapeLearnObviousFlagsDirectly` | the same | not a rule table | `registry:rune` |
| `projectionRadiusClamp` | `projectionRadius` | not a rule table | `registry:projection` |
| `levelRevisitTracking` | `levelRevisited` | not a rule table | `registry:monster` |
| `storeDiscountRoll` | the stores' discount roll | not a rule table | `registry:store` |
| `tileMap` | the mod's tile filler | not a rule table | `registry:tiles` |

A text rule is `{ find, replace, match, where }`. `match` is `"exact"` (the whole text, and the default), `"substring"` (every occurrence) or `"prefix"`. Matching is literal text with no regular expressions, so a rule cannot stall a turn. Rules run in order, each on the text the one before it produced, and `where` limits a rule to call sites whose named fields equal the values given. A `historyAdd` rule may be `{ find, drop: true }` instead, which keeps a matching entry out of the history. `objectListOrder` lists the keys `dy`, `dx`, `-dy` and `-dx`: the first key that differs between two entries orders them, and a minus sign sorts that key high to low. The two switches take `true`.

`storeDiscountRoll` is `{ minCost, tiers }`. When a store stocks an object worth at least `minCost` (0 if left out), it tries each tier `{ oneIn, percent }` in order, and the first one-in-`oneIn` roll that comes up takes `percent` off that stack. The rolls come from the game's own random numbers, so a seeded game stays repeatable. If two mods declare a discount roll, the one that loads later is used.

`tileMap` lists rules of the form `{ monster, like, hue, packs }` or `{ monster, cell, packs }`, with `object` in place of `monster`. A rule gives a monster race or object kind the tile that the `like` index has now, turned `hue` degrees around the colour wheel when `hue` is set. It only fills a tile the pack leaves empty, so it never repaints anything a pack draws. `packs` limits a rule to those pack ids, and a pack that cannot recolour skips any rule with a `hue`. A `cell` rule names a spot on a tile sheet instead of a donor: `[column, row]`, each from 0 to 127. It only works on a pack that is a fixed tile sheet, so it has to list its `packs`, it cannot also take a `hue`, and any other pack skips it.

Two more tables are plain switches. `projectionRadiusClamp: true` keeps a blast from growing past the maximum projection range, which is what upstream's `project()` does. `levelRevisitTracking: true` makes a level you come back to forget its old noise and age its scent by the world ticks you were away, the way upstream's `age_scent()` and `forget_noise()` do. The game applies both itself, so the mod never sees the level or the projection.

Both runtimes install registrations in the selected mod order. A later discount roll replaces an earlier one, and tile fillers run in that order, so the first filler for an empty tile wins.

A table holds up to 256 rules, `find` and `replace` up to 4096 characters each, and `where` up to 8 fields. A discount roll has 1 to 16 tiers, `oneIn` from 1 to 1000000 and `percent` from 1 to 99. An unknown table or field is refused, not ignored, and so are tables that break these limits; `checkApi2Policies` says why. A mod whose tables are refused gets none of them.

The host bounds intermediate text to 16384 characters and text work to a budget of 1048576 characters per table call, checking before it allocates replacements. If the input exceeds the text limit or a table exceeds either bound, the table returns the original text. A history table keeps the original entry unchanged in that case.

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

Each kind of table is one entry in `API2_POLICY_KINDS` (`packages/mod-sdk/src/api2/policies.ts`). The entry gives the table's name, its registry permission, the hook or registration it feeds, the check for its value, and what it installs; `checkApi2Policies` and `api2PolicyEffects` only walk that list. To add a kind, add its member to `Api2Policies` and its entry to the list, test it in `policies.test.ts`, and give it a row in the table above. A kind that feeds a registration the game has not installed from a table before also needs a target in `installApi2PolicyRegistrations` (`packages/web/src/mod-api2-shim.ts`).

## Storage

`store.prefs.get()` and `set(value)` hold one JSON value per mod, and `set(null)` removes it. A mod that changes the shape of what it stores declares `prefs: { version, migrate(value, fromVersion) }`, with `version` a whole number from 1. The host stores the version beside the value, calls `migrate` once on the first read after an upgrade, and writes the result back. A value stored before the mod declared a version counts as version 0.

Concurrent reads share a pending migration. A preference write or clear while the migration waits takes precedence, and the waiting reads receive the current value instead of overwriting it with the older migration result.

`store.character` holds one JSON value in the current character's save and answers `unavailable` until a character exists. Bring its shape forward with `migrateBag`.

## Network and credentials

`net.request({ url, method, headers, body, timeoutMs })` sends a request to a host the manifest names and answers `{ status, headers, body }` whatever the status. A header can hold `mod.net.credential("api-key")` in place of a string. The host puts the stored value in as the whole header value, and the mod never reads it back. `net.credentials` keeps credentials by name: `set(name, value, hosts)` stores one to be sent only to those hosts, `fromEnvironment(name, variables, hosts)` takes it from the first environment variable that is set (desktop app only, and the player is asked), `status(name)` says whether one is set and where it is kept (`os`, `environment` or `page`), and `remove(name)` deletes it. A credential call that fails answers `refused` with the code `credential`.

A request to a host the manifest does not name answers `not-granted` with `network:<host>`. Any other failure is `refused` with a net problem code: `timeout`, `too-large`, `redirect`, `unreachable` or `bad-request`. A credential that is not set gives `secret-missing`, and one not set up for the request's host gives `secret-host`.

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

The Worker proxy rejects an oversized call before sending it, and the broker returns a bounded error for an identifiable oversized or malformed call. A migration timeout starts a new epoch: the broker refuses calls from earlier epochs before running them and keeps each pending call's original epoch on its reply. When the Worker learns of a new epoch, it rejects its superseded pending calls, so an old reply cannot resolve a call in the new epoch.

The preview Worker ABI (`modApi: 2` with `workerEntry`) is retired. Its manifest still reads, and the loader refuses its code with a note to rebuild it against API 2. Its Worker-only permission names convert to API 2 names: `ui:panel` becomes `ui:panel.mount` and `state:model.read` becomes `state:player.read`. `prefs:read`, `prefs:write` and `asset:read` become nothing, since API 2 asks no permission for a mod's own preferences and files, and so do `command:submit`, `ui:region`, `query:snapshot`, `registry:declare`, `policy:install` and `hook:respond`, which have no API 2 form. `WORKER_CAPABILITY_ALIASES` in the SDK holds the whole table.

## Seams outside the public API

`manage` and `truth` are absent from a mod's API unless it holds them, so test `if (mod.truth)` before using it. `truth.monsters()` lists every monster with exact hit points and speed, and `truth.level()` gives the real map. An autoplayer plans from the known-world `view` and acts through `act`, using only what the player knows. Consent to `truth` does not allow hidden information to influence its decisions.

`meta.tier` reports measured identity separately from these permissions. A public mod with consent to `truth` still reports `"public"`.

`truth` is built for any in-process mod the player has allowed `state:map-actual.read`. `manage` is built only for a first-party mod whose `FIRST_PARTY_ORIGINS` entry names the capability (see section 4 of `MOD_LIFECYCLE.md`). A mod that declares one it may not hold loads without it, and the Mods screen says why.

`manage.profiles` lists and creates player profiles, sets which mods a profile enables, and switches profile, under `profiles:manage`. `manage.session` saves, exits to the title screen or quits under `session:control`, without asking the player to confirm, so a mod asks first in its own panel.


## Moving from API 1

Most of the API 1 context has a direct home in API 2. `API1_CONTEXT_MAP` in `packages/web/src/mod-api2-shim.ts` names every member and where it went, or why it has no API 2 form. [MIGRATING_TO_API2.md](MIGRATING_TO_API2.md) walks through the move one domain at a time, including the members API 2 does not have. The main changes:

| API 1 | API 2 |
| --- | --- |
| `ctx.id`, `ctx.flags`, `ctx.settings`, `ctx.mods`, `ctx.log`, `ctx.newCharacter` | `meta` |
| `ctx.state`, `ctx.core`, `ctx.registries` | `view` for reads, `act` for commands, `content.records` for data |
| `ctx.inspect`, `ctx.knownLevel`, `ctx.character` | `view.monsters`, `view.level`, `view.player` |
| `ctx.snapshot`, `ctx.intent`, `ctx.prompt` | `view.input`, `act.submit`, `act.answer` |
| `ctx.events.on(type, (type, data) => ...)` | `events.on(name, (payload) => ...)`, which returns a subscription |
| `ctx.ui` (a DOM element) | `ui.mount` with the panel grammar |
| `ctx.keymaps`, `ctx.keybindings` | `ui.keys` |
| `ctx.prefs`, `ctx.characterStore` | `store.prefs`, `store.character` |
| `ctx.data`, `ctx.assetUrl`, `ctx.composedRecords` | `content.own`, `content.asset`, `content.records` |
| `ctx.net` | `net`, with credentials by reference |
| `ctx.profiles`, `ctx.session` | `manage`, first-party only |
