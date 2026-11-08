# Mod API 2

API 2 is the set of calls a mod's code gets from the game: what it can read, what it can do, and what it hears. Every call returns plain data, a permission the player turned down comes back as a result you can check, and reads show the game as the player knows it. The types are in `@rpgm-tools/neo-angband-mod-sdk`, and the in-process host is in the web package (`packages/web/src/mod-api2-host.ts`).

The mod API has its own version number, which is not the game's. This game implements API 2.1.0, and a mod's `api` range is checked against that number alone, so a new game version can ship with the same API.

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

`api` is a semver range over the API's own version, `MOD_API2_VERSION` (now `2.1.0`). The game's version is for diagnostics only. The minor number rises when the API gains a call. The major number rises when an existing call changes or goes away, so `>=2.0.0 <3.0.0` (`MOD_API2_DEFAULT_RANGE`) is the range to declare.

A loader calls `apiRangeVerdict(range)` before importing any mod code. It returns `{ ok: true }`, or `ok: false` with a `code` and a `why` sentence naming both versions. The code is `malformed` when the range is missing or does not parse. It is `too-new` when every version the range names has a higher major number than this game's API, so the mod needs a newer game, and `too-old` when every one has a lower major number, so the mod needs an update. Any other miss is `outside`, such as `>=2.2.0 <3.0.0` on a game with API 2.1.0.

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
| `meta` | The mod's `id`, `flags`, and `tier`, the API and game versions (`api`, `engine`), `newCharacter`, `granted(capability)`, `log`, the mod's numeric settings (`settings`, `setSetting`), and the list of enabled mods (`mods`). | None |
| `view` | What the player knows of the world: `world()`, `player()`, `monsters()`, `level()`, `input()`, and `isCurrent(token)`. | `world()` and `isCurrent` need none. Each other part needs its own grant (`state:player.read`, `state:monsters.read`, `state:map.read`, or `state:interaction.read`), or `state:*.read` covers them all. |
| `act` | `submit(token, intent)`, `answer(promptId, answer)`, and `controller`, which works only while the mod holds the keyboard. | `input:intent` and `input:prompt.reply`. `controller` needs `input:controller` and `state:interaction.read` on top of `input:intent`. `onKey` needs `input:observe`. |
| `events` | `on(name, listener)` subscribes and `off(subscription)` unsubscribes. | `event:<name>` |
| `hooks` | `available` lists the hooks this game runs, and `active` lists the ones this mod declared. | None |
| `content` | The mod's own files (`own`, `asset`), the running game's records (`records(file)`), and `lookup({ file, key })`, which finds a record by the key `recordKey` derives. | None |
| `ui` | Panels the host draws (`mount`, `patch`) and the mod's key bindings (`keys`). | `ui:panel.mount`, `keymap:write` |
| `store` | `prefs`, stored outside any character, and `character`, stored in the current character's save. | None |
| `net` | Requests to the hosts the manifest names, with credentials passed by reference. The domain exists only when the manifest asks for a `network:` permission. | `network:<host>` |
| `manage` | For Workers, host-confirmed operations on profiles, saves, options, characters, content, and repositories, plus detached wizard operations. First-party in-process mods get broader legacy management. | `profiles:manage`, `session:control`, `options:manage`, `saves:manage`, `mod:install`, `mod:session`, `mod:read`, `debug:wizard` |
| `truth` | Every monster and the actual map, open to any in-process mod and to a Worker the player allows. | `state:map-actual.read`, or `state:monsters-actual.read` for monsters and races only |

### What `view` shows

`view` is built from core's known world (`buildKnownWorld`): the monsters the player perceives, with health as the look command words it, the abilities the player has learned, the map as the player remembers it, and items as far as the player has identified them. A monster the player cannot see is not in any part of it, and changing that monster changes nothing a mod can read. A mimic the player takes for an object is not listed as a monster, and while the player hallucinates `monsters` is empty and `monstersHidden` is `"hallucinating"`. A monster's `id` is a handle given out on each level in the order the player first perceives monsters there, not the game's monster index, and the list runs nearest first. Timed effects show the grade name the status line prints, a recall or deep descent shows only that it is active, a recharging item shows the count its name gives (`charging`), `unknownRunes` is the name's `{??}`, and a remembered trap stays as the player last saw it. `world()` returns every part at once, with `null` for each part the mod has no permission for. The single-part calls answer `not-granted` instead. `world().turn` is the game turn counter and is `null` without `state:turn.read` (or `state:*.read`). It moves only when game time passes, so a command that spent no time leaves it where it was.

Each value carries a `token` naming the input wait it was read at. `act.submit` takes that token, and a token from an older wait comes back `refused`. `isCurrent(token)` says whether that wait is still the current one. A `target` intent names its monster by the `id` the view gave it; an id for a monster the player does not perceive now is refused like any monster that cannot be targeted.

A monster's `visible` means eyesight: blindness, darkness and invisibility can leave a sensed monster listed with `visible: false`; infravision and see-invisible count when they let the player see it. A stationary monster first perceived during hallucination receives its sighting notification when the hallucination clears. Remembered item auras use the last observed object properties and the player's current rune knowledge, and remembered traps include only the traps the player perceived.

Shop visits and shop knowledge screens record stock and owner observations, and known-world reads at a shop's entrance refresh that shop. Other shops retain their last observations for the session, or return empty stock and an unnamed owner if they have not been inspected. Loading a game starts with unknown shop observations. A host that draws a shop screen calls `observeKnownStore(state, store)` to record the stock it shows.
### The controller

`act.controller` has `owns()`, `setStatus(status)`, `markNondeterministic()`, and `release(reason)`. Every call except `owns()` returns `refused` with the code `not-owner` unless the mod holds the keyboard. An API 2 definition takes the keyboard with its `controller` member, which needs `input:controller` and `state:interaction.read` in the manifest along with `input:intent`. One controller holds the keyboard at a time. `onKey` receives each key the player presses while the mod holds the keyboard and returns `{ kind: "keep" }` or `{ kind: "release" }`, and it needs `input:observe`. Answering prompts needs `input:prompt.reply`. `onDeath: "end"` lets an ordinary death end the run instead of starting the next character.

A controller can act in an open store. The host asks it for a decision at phase `store` and passes the `shop-buy`, `shop-sell` or `shop-exit` intent it returns to the shop screen.

### Panels

`ui.mount` uses the same panel grammar as Worker mods: `text`, `button`, `row`, and `column` nodes under a panel `id`. The panel `id` and each button's `action` use lower-case letters, digits, and hyphens, start with a letter, and are at most 64 characters long. A text node holds up to 4096 characters, a row or column takes up to 32 children, and the tree nests at most 16 deep. The host draws the panel and passes the `action` of each button the player uses to `onAction`. `ui.patch` replaces the title, the tree, or `visible`, and a `null` title removes the title. Mounting a panel outside the grammar or under an id that is already mounted, or patching a panel that is not mounted, returns `refused` with the code `bad-panel`. An API 2 mod gets no DOM element. To add a row to the game menu, call `ui.gameMenu.register(action, label, run)` with `ui:menu.row`. In-process code can also use `registry:menu`, while a Worker needs `ui:menu.row` for this callback. Pages opened with `ui.overlay` or `ui.mountPage` always show the host's close control, in the top right unless the page sets `closeAt` to `top-left`, `bottom-right`, or `bottom-left` to keep it clear of the page's own header buttons.

`ui.commands.register(id, verb, run, options?)` registers a command a bound key or the command menu can run. Pass `{ direction: true }` and the game asks for a direction first, with the prompt the open, close and tunnel commands use; `run` receives `{ dir }` with the keypad digit 1 to 9, and Escape runs nothing. A key bound with `ui.keys.bind` to such a command's id reaches it that way, so a command that needs a direction, such as spiking a door, has a key. Without the option `run` receives no direction. Pass `{ turn: true }` as well and the key runs the command inside the player's turn: `run` returns `{ energy }` (0 to 1000, 100 is one standard turn) and the game spends it, so the monsters answer. Without `turn` the return value is ignored and the command costs nothing.

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

To reach those hooks, use `engineHooks(context)`. It returns the game's own hook members by name, and the game calls each one with the same live arguments it has always passed. The game asks for them only when the mod has the `engine` domain, which requires in-process code (first-party, or an explicit developer in-process run) with a declared `engine:access` grant. A Worker never gets it. First-party in-process code holds the declared grant by default, and a recorded player refusal takes it away. Every read from the engine domain checks the grant again, but live objects already handed to page code stay live, so these checks do not sandbox page execution. A hook name that already has an API 2 form is refused, which keeps each hook declared one way.

`engineTiles(context)` is the same door for a tile set. It returns a `filler` that supplies tiles for monsters and objects the pack does not draw, and a `player` provider that picks the player's tile from the character's shape, class, race and level. It needs `registry:tiles` and the `engine` domain, and a mod that also declares a `tileMap` table declares its filler in only one of the two.

In-process code registers things with the game itself through `engine.registry`: effect handlers, projection handlers, commands and their verbs, rooms, profiles, blows, stores, menus, and everything else an API 1 `register(host, ctx)` received as `host`. It needs `engine:access` plus the `registry:` grant for each domain. Workers declare data-only entries in `mod.registry` instead, described below, and need no `engine:access`.

## Policy tables

`policies(context)` returns changes as data: hook answers, and a few game registrations. The game applies them itself, without calling the mod, so a table works the same in a Worker and in process. Tables do not limit what a mod can change. An in-process mod keeps every hook function it has, and when it declares a function and a table for the same hook, the function is used.

Each table needs its matching registry permission from the list below, in both runtimes. When a grant is missing, only the tables that need it are skipped, and the mod's other tables and hook functions stay available. In-process, `registry:*` covers every table. A Worker has to name each grant individually, and a bare `*` grants nothing. The in-process host evaluates the policies while it composes guarded hooks and reuses the results for startup registrations. If a factory throws, it contributes no tables, and the game still starts.

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

A Worker granted `mod:authoring` can import `@rpgm-tools/neo-angband-mod-sdk/authoring`. The host stages the fixed authoring, blueprint, field, provenance, and reference modules as source next to the mod's own modules, and calls such as `templateRecord`, `suggestFields`, and `checkRecords` run inside the Worker on data the mod supplies. The library cannot install anything, load a session, or call the host. Its modules count toward the staging size and module limits, and the host rechecks the grant before it releases the staged graph. Revocation stops the Worker. Until then, the library's local computation runs under the same CPU and memory limits as any other Worker code.

Worker eligibility comes from the vocabulary for every Worker, first-party Workers included, and each simple grant needs an explicit decision from the player. Menu, screen, birth, map, and Mods-screen replacement arrive through the presenter paths described below, as data the host draws. The `ui:*.replace` wildcard covers messages, sidebar, status, menu, screen, and birth, and nothing more. Map replacement, additional regions, and panels fall outside it. If the player explicitly refuses any covered family, that refusal overrides the wildcard. Workers have no engine access. Truth, management, content, spawning, and shared data each go through their own bounded Worker operation.

With `ui:messages.replace`, `ui:sidebar.replace`, or `ui:status.replace`, a Worker can replace the matching region by calling `mod.ui.messages.replace(lines)`, `mod.ui.sidebar.replace(lines)`, or `mod.ui.status.replace(lines)`. Each line is `{ text, style? }`, and `style` is one of `normal`, `muted`, `warning`, `danger`, and `good`. The host draws the text with `textContent` and accepts up to 64 lines, 512 characters per line, and 4096 characters per output. Pass `null` to give the region back to the game. Because the mod supplies the whole region, its text can hide warnings or misstate character status.

`ui:region.create` adds `mod.ui.region.create({ id, rect: { col, row, cols, rows }, lines })` and `mod.ui.region.remove(id)`. Calling create with an id the Worker already owns updates that output's text and rectangle. The host checks the rectangle against the current character grid and caps each Worker at eight text outputs, counting named replacements. A region takes no input, has no choice of layer, and never covers a host dialog. Every update counts against the broker's message and call-rate limits. Teardown removes the output, and revocation, a modal screen, or a host dialog hides it.

`options:write` allows `await mod.options.set({ values, hitpointWarn, delayFactor, lazymoveDelay })`. The call accepts interface booleans and bounded delays and nothing else. The host validates the whole change before applying any of it, and it rejects birth, cheat, score, and unknown options. `manage` is not reachable through this call.

`keymap:edit` provides asynchronous `mod.keybindings.keyset()`, `list()`, `commands()`, `set(trigger, action, replace?)`, `remove(trigger)`, `capture()`, and `cancelCapture()`, all acting on the current keyset. An action holds at most 256 characters, and overwriting a conflicting binding needs `replace: true`. Escape, control characters, modifier chords, F5, F11, and F12 belong to the host. A capture ends when a host dialog opens, on cancellation, on teardown, or after ten seconds. If revocation or an expired broker epoch arrives while a capture is pending, its result is dropped.

`display:filter` allows `await mod.display.filter({ name, amount })`, and passing `null` clears the Worker's filter. `grayscale`, `sepia`, and `invert` take amounts from 0 to 1, `brightness` and `contrast` from 0.25 to 2, and `saturate` from 0 to 2. The host builds the filter itself, applies it to the game canvas, and suspends it while a host dialog is open. CSS text, resource URLs, and functions are rejected. All of these Worker additions pass serialized data, and no live presentation object reaches the Worker.

Five presenter calls register Worker callbacks for host-drawn replacements: `await mod.ui.menu.replace(describe, select)` under `ui:menu.replace`, `await mod.ui.screen.replace(describe, select)` under `ui:screen.replace`, `await mod.ui.birth.replace(describe, select)` under `ui:birth.replace`, `await mod.ui.management.replace(describe, select)` under `screens:manage`, and `await mod.display.replace(describe)` under `display:replace`. Passing `null` unregisters a presenter. In TypeScript, declare local types for these runtime additions, because the SDK's live presenter types describe the separate in-process contract. A Worker still cannot declare `definition.presentation` or `definition.birth`.

Callbacks run only inside the Worker. The port carries callback ids, host-issued presentation ids, JSON snapshots, descriptions, and selection answers, and each callback is called with `(input, presentationId)`. A description is `{ title, lines, rows: [{ id, label }] }`. It holds at most 64 lines and 64 uniquely named rows, 256 characters for the title and for each line or label, 64 characters per row id, and 32768 bytes in total. Row ids may use letters, digits, underscores, hyphens, and colons. The host draws every string with `textContent` in fixed styles inside the map rectangle, and it keeps its own Close and Use game screen controls. When several eligible Workers register for one family, the most recent registration handles it, while legacy menu and screen presenters keep their existing precedence. Each Worker can make at most eight registration calls per second across these five methods, on top of the broker limits.

A menu's `describe` callback receives `{ id, title, footer, choices: [{ id, label, disabled }], browseOnly }`, without the live detail callback or command keys. Clicking a row calls `select({ action: rowId }, presentationId)` in the Worker, which answers `{ kind: "choose", choice: originalChoiceId }` or `{ kind: "cancel" }`. The host rejects a disabled, foreign, or browse-only choice. A menu with more than 64 choices falls back to the game. Command keys and detail panes stay available through Use game screen. For example:

```js
const offeredMenus = new Map();
await mod.ui.menu.replace(
  (menu, presentationId) => {
    const choices = menu.choices.filter((choice) => !choice.disabled);
    offeredMenus.clear();
    offeredMenus.set(presentationId, choices);
    return { title: menu.title, lines: [], rows: choices.map((choice, index) => ({ id: String(index), label: choice.label })) };
  },
  ({ action }, presentationId) => {
    const choice = offeredMenus.get(presentationId)?.[Number(action)];
    offeredMenus.delete(presentationId);
    return choice ? { kind: "choose", choice: choice.id } : { kind: "cancel" };
  },
);
```

The example stores the original choices in a bounded Worker-local map keyed by the host's presentation id. A screen presenter receives the JSON `ScreenView`, with its blocks and offered action ids. Its selection callback closes the screen by returning `null` or `{ kind: "dismiss" }`. Returning `{ kind: "refresh" }` calls the Worker-local description callback again, up to 64 times per screen, which is enough for local tabs, sorting, and other presentation choices with no live host handler. Any request for a game action, including `{ action: originalActionId }`, declines the replacement and opens the game's screen. The bridge never calls existing `ScreenHost.invoke` implementations, since they can await prompts and commit mutations without checking the Worker grant again. Renaming, file export, and update actions stay on the game's own screen until those actions have guarded serialized transactions. The presenter yields before any host prompt. Escape and Close dismiss it, and the Worker receives no key or action from either. Presenters are never offered permission or controller-consent dialogs, and Core screen ids stay host-owned.

The management presenter receives `{ id: "mods" }` and uses the same description grammar. Selecting a row runs a Worker-local selection callback and grants no management operation. The host always draws Permissions and game controls above mod panels. Choosing that control declines the replacement, and the game's Mods screen opens with mod panels suspended and all navigation drawn by Core, outside menu, screen, and text replacement. No Worker method can name another management screen, resolve a confirmation, or supply a permission decision.

The display callback receives `{ grid, viewport, map }`, where `map` is the map's rectangle in the character grid. It returns an array of at most 512 `{ col, row, glyph, color }` records within 60000 bytes. Coordinates are integers from -32767 to 32767, counted from the map's top-left cell, and cells outside the map are clipped. Each glyph is one Unicode code point with no control or formatting characters, and each color is `normal`, `muted`, `warning`, `danger`, or `good`. The host asks for at most ten frames per second with one request in flight and draws inert glyph elements over the game's own map. The grant gives the Worker geometry only, with no hidden state and no canvas. Known world data comes from separately granted view calls.

Every description and selection has a 250 ms deadline. An answer that is invalid, late, revoked, superseded, or tied to a changed binding or session declines the presentation, and the game's renderer or screen takes over. Map output expires after 250 ms and clears when the game frame changes or a host dialog opens. An interactive presenter can own a gameplay modal offered to it, but Core questions hide and cancel it, even inside a gameplay modal that is already open. Mod output never enters the browser's top layer and never receives permission-dialog input, reserved keys, DOM nodes, canvas objects, transferables, or shared buffers.

The birth callback receives `{ kind: "birth", stepId, stage, draft, choices: [{ id, label, valueMax? }] }`. Creation runs race first, then class, then draft editing, with at most 64 steps and at most 64 races or classes. Larger catalogs use the game's screens. The Worker answers with the same description grammar, mapping offered choices to rows that hold only `id` and `label`. Clicking a row sends `select({ action: rowId, stepId }, presentationId)`, and the answer is `{ stepId, choice: offeredChoiceId, value? }`. Every step gets fresh opaque ids. A foreign choice, a stale step, an unknown field, or an invalid value declines the replacement, and that proposal is not applied. The host's birth session checks race, class, point-buy, and roller changes against the game's rules. Draft choices also cover bounded name and background proposals, random names, and regenerating or restoring the background. Only a choice with `valueMax` takes a string value. Names follow the game's name limit, backgrounds allow 1024 characters, and neither may contain control or formatting characters. Birth and score options stay locked, even with `options:manage`.

Review character requests a separate host-drawn modal with the actual name, race, class, stats, background, and every birth option, and all mod panels and drawing are suspended while it is open. Only its Start character button can call the host's acceptance step. The Worker has no accept operation and cannot supply or restyle this summary. Before acceptance, the host rechecks the grant, payload binding, game-state identity, and broker epoch, and confirms the draft is unchanged. Back to creation returns to editing, and Close cancels creation. Use game screen, or an invalid or expired proposal, opens the game's birth screens.

On desktop only, `backup:folder` gives a Worker `backupFolder.name()`, `choose()`, `forget()`, `list()`, `write(name, text)`, `writeSaved(fileId)`, `onSave(listener)`, and `off(subscription)`. The host takes the native authority handle from its measured installation, and the Worker cannot send a folder path, purpose, digest, or installation handle. The native folder picker names the mod. Each write raises another native confirmation naming the mod, the file, and the folder, then returns a single-use plan that only the host holds. The host rechecks authority and the Worker epoch before committing the plan. Plans expire after 30 seconds, and revocation invalidates their native authority. Files stay inside the desktop's per-installation subfolder. A custom `write` takes a plain ASCII `.neochar` filename of up to 255 characters and at most 32768 UTF-8 bytes of text. The host allows one pending operation and 16 requests per minute, and the desktop separately caps plan requests and commits at 32 per minute. The existing desktop limits of 200 files and 256 MiB per allocation also apply. Worker listings return file names with empty character metadata, never file text or paths. A browser-only host refuses this Worker mechanism.

Worker `onSave` delivers `{ id, name, size }` within the reply byte budget. The host keeps one latest file of up to 8 MiB per Worker, and this permission never releases its contents. `writeSaved(file.id)` has the desktop write those exact host-held bytes under the host's filename, so the Worker never pushes the file or a path through its smaller call envelope. In TypeScript, these runtime additions and the Worker notice shape need local types, because the SDK's name-and-text callback describes the separate in-process contract. The id stops working if the file's bytes or filename change, if the binding, session, or epoch changes, or on revocation or teardown. The host also rechecks the retained file after native confirmation. Larger custom uploads, and host files beyond 8 MiB, need a separate bounded mechanism.

A mod runs in a Worker for isolation. Its code runs apart from the game, and the game reaches it only through messages. Mods can also change the game in-process, and the Worker limits on this page do not restrict in-process mods.

A mod with `"runtime": "worker"` default-exports the same definition and gets the same domains, results and known-only data as an in-process mod. Its manifest names an `api` range that API 2 satisfies and the module to start in `entry`. Each call becomes a message to the game's broker (`packages/web/src/mod-worker/host.ts`), which serves it with the in-process host and posts back a copy of the answer. The Worker runs in a sandbox with no network and none of the game's storage ([WORKER_ISOLATION.md](WORKER_ISOLATION.md)).

Running there costs a mod these things:

- Hooks that answer inside a turn. A turn cannot pause for a Worker message, so any hook that returns an answer during a turn comes from `policies`. Inside a Worker, `hooks(context)` can declare only `optionsChanged`, `abilityGained`, `monsterBecameVisible`, and `artifactIdentified`, and the game passes each of them to the Worker without waiting for a reply. If `hooks(context)` supplies any other hook function, the Mods screen reports it and the game does not install it.
- Asynchronous calls. Every Worker call returns a promise, and every value the Worker receives is a copy. `meta.granted` is the one question the Worker answers locally.
- Management and truth reads. `manage` holds only the named serialized operations documented below. With either explicit truth grant, a Worker also gets `truth.level`, `truth.monsters`, `truth.race`, and `truth.storeKnowledge`, and each of those methods still requires its own grant.
- Files and the network. The sandbox cannot load anything, so `content.asset(path)` answers with a `data:` URL that holds the file's bytes. `net.credential(name)` hands the Worker only a reference. The game holds the credential value and adds it to the request once the request has left the Worker.
- A wildcard grant. A Worker holds the permissions the player granted, under their API 2 names. Requesting `"*"` grants nothing.

The broker refuses a message over 64 KB and any call past 200 in one second. It pings the Worker every second, and a Worker that leaves a ping unanswered for 5 seconds is stopped and switched off for the session, with the notice a mod that keeps failing gets. When the game asks the Worker to migrate its bag or its preferences and has no answer within 3 seconds, it goes on without one: the character keeps its old bag, the stored preferences stay as they were, and `store.prefs.get` answers `unavailable`. An answer that arrives after that is dropped. The Mod performance screen shows a Worker mod's reply time and network wait in their own columns, apart from its CPU time.

The Worker proxy rejects an oversized call before sending it, and the broker returns a bounded error for an identifiable oversized or malformed call. A migration timeout starts a new epoch: the broker refuses calls from earlier epochs before running them and keeps each pending call's original epoch on its reply. When the Worker learns of a new epoch, it rejects its superseded pending calls, so an old reply cannot resolve a call in the new epoch.

The preview Worker ABI (`modApi: 2` with `workerEntry`) is retired. Its manifest still reads, and the loader refuses its code with a note to rebuild it against API 2. Its Worker-only permission names convert to API 2 names: `ui:panel` becomes `ui:panel.mount` and `state:model.read` becomes `state:player.read`. `prefs:read`, `prefs:write` and `asset:read` become nothing, since API 2 asks no permission for a mod's own preferences and files, and so do `command:submit`, `ui:region`, `query:snapshot`, `registry:declare`, `policy:install` and `hook:respond`, which have no API 2 form. `WORKER_CAPABILITY_ALIASES` in the SDK holds the whole table.

### Third-party mods and consent

A third-party (public) mod can use the features marked Yes in the table once the player grants the permissions its manifest declares. `input:intent` and `keymap:write` do not imply any of them. Mods that need a feature marked No must be first-party. Public API 2 code always runs in an isolated Worker, even when the manifest asks for page execution. The host checks each message against the mod's identity and grants, and it caps message and reply sizes, message rate, subscriptions, and UI count, such as eight panel mounts per mod. Public API 1 code is refused. For development, a lab build accepts `?labprocess=<mod-id>` to run a named folder mod in the game page if the mod declares and is granted `engine:access` and its content is approved. Under Node, the headless runner's `--unsafe-in-process` option does the same, and mod code then runs with the process's privileges. Neither opt-in makes a mod first-party.

| Feature | Permissions | Available to public mods |
|---|---|---|
| Autoplayer controller | `input:controller`, `input:intent`, `state:interaction.read`. A controller from any author permanently makes the character unscorable and the save nondeterministic. | Yes |
| Watching gameplay keys (`onKey`) | `input:observe` | Yes |
| Commands | `command:add` | Yes |
| Rows on the title screen | `ui:title` | Yes |
| Rows in the game menu | `ui:menu.row` | Yes |
| Profile and session management | `profiles:manage`, `session:control` | Yes. The mod manages the profiles it owns, and the host confirms save, exit-to-title, and quit. |
| Content installation and session packs | `mod:install`, `mod:session` | Yes. Content plans are measured and need a separate host confirmation. Installed content carries no code or capabilities. |
| Repository metadata | `mod:read` | Yes. Each GitHub lookup needs confirmation and returns metadata and file names only. |
| Wizard testing | `debug:wizard` | Yes. Commands run only after the character becomes unscorable and saving stops permanently for this page, and the host confirms each one. |
| Game option management | `options:manage` | Yes. The host confirms each change. Birth and score options stay locked, and a cheat change persists an unscorable mark before it takes effect. |
| Character management | `saves:manage` | Yes. The player selects the characters, which carry opaque ids, and the host confirms load, rename, and delete. |
| Hidden state (truth) reads | `state:map-actual.read` or `state:monsters-actual.read` | Yes in Workers, with the grant and player consent. Every affected character is marked unscorable. |
| Raw engine access | none | No |
| Raw presentation replacement | none | No |
| Host-drawn menu and screen descriptions | `ui:menu.replace`, `ui:screen.replace` | Yes. Text is bounded and selections are opaque. Menus validate the original choices, and live screen actions fall back to the game. |
| Host-drawn map glyph commands | `display:replace` | Yes, for the map rectangle only. Commands have deadlines, and the host provides a fallback. |
| Host-drawn Mods screen | `screens:manage` | Yes. The host reserves its own recovery and permission controls on the screen. |
| Birth and UI replacement wildcard | `ui:birth.replace`, `ui:*.replace` | Yes. The mod proposes bounded, legal choices and the host owns final acceptance. The wildcard covers all six UI families. |
| Backup folder | `backup:folder` | Yes on desktop. Writes are bounded and natively confirmed, and they go to a per-installation subfolder. The Worker cannot supply a path. |

### Grants Workers cannot hold yet

A mod running in a Worker cannot hold the grants in the table below. The consent screen gives the reason for each refusal, and a mod that needs a refused grant in order to run does not start. The eight registry mechanisms accept declarations without the engine bridge prototype, which is still unwired.

| Grant | Why it is closed | What it needs |
| --- | --- | --- |
| `engine:access` | `writeSlot` writes the save bytes and the roster metadata in separate steps, and it can report a failure after the save has already changed. A live adapter built on that writer cannot meet the prototype's atomic commit contract. | An atomic persistence primitive, a production safe-point adapter, consequence marking, and Worker handle lifecycle tests run against that adapter. |
| `registry:*` | The wildcard also covers `monster`, `projection`, `effect-info`, and `rune`. A Worker holds those four only for the fixed policy tables that name them. Monster AI, projection handlers, and other callbacks that run inside a turn have no Worker mechanism. | A bounded, isolated mechanism for every domain the wildcard covers, in place before the wildcard opens. |

### Worker registry declarations

Any author can request `registry:effect`, `registry:room`, `registry:profile`, `registry:blow`, `registry:glyph`, `registry:randart`, `registry:vocab`, and `registry:menu`. A Worker with one of these grants gets `mod.registry.<domain>.declare(declaration)`, which returns `Promise<Api2Result<null>>`. Each method accepts exactly the fields listed in the table. A new identifier starts with the calling mod's id followed by `:`. Declarations cannot contain callbacks, engine objects, handles, paths, or transferable values.

| Domain | Declaration | Host behavior |
| --- | --- | --- |
| `effect` | `{ code, program }` | `code` is a string the mod owns or an existing numeric effect code. A program holds 1 to 16 operations, each one `{ op: "heal" or "damage", amount }` or `{ op: "message", text }`. Amounts are integers from 0 to 10,000, and a message is at most 160 characters long. Healing stops at maximum HP, and damage goes through the host's damage handler. |
| `room` | `{ name, primitive }` | `name` is an existing room key or a key the mod owns, and `primitive` is one of `simple`, `circular`, `overlap`, `crossed`, or `large`. Existing room profiles pick up keys that a declaration overrides. A newly added key appears in no profile on its own. |
| `profile` | `{ name, base, minLevel, alloc }` | The host copies an existing profile under a new name the mod owns. Minimum depth ranges from 0 to 127, and selection weight from 0 to 100. The copy keeps the base profile's builder, room parameters, and tunnel parameters. |
| `blow` | `{ name, damage, obvious }` | `name` is an existing blow effect or a name the mod owns. The host builds both the recorded attack and the live attack from a fixed integer damage of 0 to 10,000 and a boolean visibility flag. |
| `glyph` | `{ kind, glyph, source }` | `kind` is `template` or `vault`, and each of the two symbols is a single non-space character. The host gives the target symbol the terrain and population behavior of an existing source symbol. |
| `randart` | `{ table, key, toH, toD, toA }` | `table` is `abilities` or `prep`, `key` is an integer from 0 to 4095, and each combat stat is an integer from -100 to 100. Whenever the generator uses that key, the host sets those stats. Census, redundancy calculations, and arbitrary artifact callbacks are unavailable. |
| `vocab` | `{ kind, term, label }` | The host stores a term and label the mod owns in this connection's vocabulary. A kind name is at most 64 characters. A vocab declaration cannot grow the core flag arrays or statistics, expose another mod's terms, or persist values on entities. A mod keeps its own values in character storage. |
| `menu` | `{ id, rows: [{ id, label, hidden }] }` | Up to 64 rules rename or hide existing rows, and the rows keep their semantic targets and their order. Supported ids are `core:activate-item`, `core:browse-spell`, `core:cast-spell`, `core:context-grid`, `core:context-object`, `core:context-player-other`, `core:context-player`, `core:context-use-item`, `core:curse-removal`, `core:effect-choice`, `core:pickup`, `core:spell-book`, `core:study-spell`, `core:target-monster`, and `core:use-item`. The host refuses every other menu, including permissions and the game menu. Adding actions to the game menu needs `ui:menu.row`. |

The host validates the whole declaration and everything it references before it marks or installs anything. Before it accepts the first declaration in a domain, the host saves permanent unscorable and nondeterministic marks on the attached character. A session with no writable character cannot register declarations. An invalid declaration never reaches the save writer, and if writing the mark fails, nothing is installed. Authority is bound to the character identity and the player object. Once the mark write completes, and before it replies, the host checks the measured installation binding, plugin id, epoch, and live grant again. A pending request cannot widen its own grants.

A connection can make up to 32 declaration calls per second, with one call pending at a time. Across all eight domains it can hold 64 successful declarations and 256 KiB of retained declaration data, and copied profiles count toward that 256 KiB. Mark attempts are limited to four per second. Every request also falls under the broker's 64 KiB message limit and the existing reply quotas, along with the bridge copier's limits of depth 12 and 4,096 values. Copied base profiles get the same structural limits. A menu rule given more than 256 rows declines the input and keeps the original rows. Functions, classes, accessors, prototype keys, cycles, typed arrays, shared memory, and transferables are refused, and text fields reject control and formatting characters.

During a synchronous tick the game runs host primitives only and never asks the Worker to execute an effect or a generator. Installed behavior deactivates on revocation, on teardown, or when the epoch or binding changes. From then on, a replaced handler falls back to the host behavior it had before, a new effect declines, a new room returns failure, a new blow deals zero damage, a new glyph does nothing, and an inactive profile drops out of selection. If a Worker stalls, the broker heartbeat stops it and the same fallbacks apply. Vocabulary declarations stay private to the stopped connection that made them. Arbitrary callbacks are unavailable, and so is lossless compatibility with the live engine.

The game page draws the public consent dialog itself, as a native modal with system fonts and fixed wording that a mod's locale cannot replace. It shows the sanitized manifest name, the mod id, the repository, and the first 12 characters of the payload's SHA-256 digest. Every checkbox starts unchecked, even for permissions the player granted before. The player's decision is bound to every measured file, the execution tier, and the requested permissions, so a change to any of those needs a new decision, even at the same version. Every executable mod needs a measured binding, first-party code included, and first-party imports use the retained payload bytes. Decisions save atomically. If the save fails, the mod does not run. Players review and revoke grants on the Mods permission screen, and revoking a grant stops the running code.

A public controller needs a second, separate dialog before it starts playing, and that dialog appears every time a save is loaded or resumed. Profile roll-on does not accept it, and first-party roll-on also waits for session confirmation. Every controller candidate needs the current permission binding plus stored `input:controller` and `input:intent` grants. Escape or Ctrl-Z returns the keyboard to the player before any mod code sees the key. A controller can submit gameplay commands only: movement, running, resting, stairs, doors and traps, tunneling, item use, spells, looking and searching, shopping, targeting, and travel, plus ignore rules. The host refuses quit and retire, profile and session management, install, unknown commands, and any command that belongs to another mod. Input a mod sends outside the controller is accepted only shortly after an actual player action. Starting any controller, first-party ones included, permanently marks the character unscorable with `NOSCORE.BORG`, sets `modNoscore`, and marks the save nondeterministic. Saves and run reports list the 32 most recent controller identities in `autoplayers`. The separate `capabilityUse` summary keeps permanent provenance, never truncates it, and does not depend on mod-owned save bags.

## Seams outside the public API

First-party in-process presentation needs declared grants too. `presentation.display` and `presentation.tiles` need `display:replace`. Live `display.onKey`, `keyRepeat`, and `cancelInput` need `keymap:edit`. `presentation.subwindows` and `presentation.panels` need `ui:region.create`, and `sidebarHost` needs `ui:sidebar.replace` (or `ui:*.replace`). DOM overlay and page mounting need `ui:region.create`, `ui:screen.replace`, or `screens:manage`, together with the existing `ui:panel.mount` grant. Title actions still need `ui:title`. For first-party in-process code, declared public presentation grants are allowed by default, and a recorded refusal overrides that default, wildcard declarations included. Management grants still go through their own confirmation. Public Workers and developer in-process switches get no live presentation objects through this seam, and live page objects stay outside Worker containment.

A mod's API has `manage` and `truth` only when the mod holds them, so check `if (mod.truth)` before calling anything on it. `truth.monsters()` returns the location and exact state of every monster, unseen ones included, each with a `perceived` flag. `truth.level()` returns the actual map. `state:monsters-actual.read` unlocks `monsters()` and `race()` and nothing else. `state:map-actual.read` unlocks those two as well as `level()` and `storeKnowledge()`. Neither truth grant is covered by `state:*.read`. Once the player consents, a controller or any other mod holding a truth grant may base its decisions on hidden information. Either truth grant permanently marks every affected character unscorable with `NOSCORE.DEBUG` and `modNoscore`, whoever wrote the mod. The host writes that mark and its provenance to the save before it returns any hidden information, and if the save write is missing or fails, the read is refused. A truth read by itself leaves determinism unchanged.

`SaveManifest.capabilityUse` and `RunReport.capabilityUse` both hold `{ schema: 1, entries }`. An entry records the host's measured installation consent binding, the mod id, version, payload digest, and capability, the turn and depth of the first activation, and the consequence, either `controller` or `hidden-information`. Unmeasured legacy callers write null for installation, digest, or activation values. The host merges entries with matching identities and consequences, keeps the first activation, and never truncates the summary. Revoking a grant stops later truth reads but leaves marks and provenance in place. Old saves have no summary and load unchanged. When this build finds a newer summary schema, it keeps that summary as it is without reading or replacing it, and it still applies the existing score and determinism marks.

A first-party in-process mod that the game lets see the real map can ask for it while it runs, rather than declaring it in the manifest. Call `permissions.requestTruth(reason)` and the game shows its own question with your reason in it. On a yes you get the `truth` domain, the choice is remembered like one made in the Mods screen, and every character played while the mod holds it is marked the way debug mode marks it. On a no you get `{ ok: false, code: "declined" }`, and the next call asks again. `permissions.truthHeld()` tells you whether the mod already has it, and a mod that does is never asked. Other mods have no `permissions`, so check `if (mod.permissions)` first.

`meta.tier` reports measured identity separately from these permissions. A public mod with consent to `truth` still reports `"public"`.

Any in-process mod or Worker that the player has allowed either truth grant gets a `truth` object. For each call, the Worker broker validates the arguments, identity, and epoch, then checks the grant again. It waits for the permanent save mark before it builds a plain snapshot, and it drops the reply if the grant is revoked or the epoch changes before delivery. A session with no character to save returns no hidden data. Truth replies count against the shared 4 MiB reply cap and the 200 calls per second cap, and a reply that exceeds the size cap still leaves the permanent mark in place. After a separate Core confirmation, a Worker by any author can hold `profiles:manage`, `session:control`, `options:manage`, and `saves:manage`. Its `manage` proxy has only the operations listed below. Broader in-process management needs a first-party mod whose `FIRST_PARTY_ORIGINS` entry names the capability. When a mod declares a permission it cannot hold, it loads without that permission and the Mods screen shows the reason.

With `profiles:manage`, the in-process `manage.profiles` lists and creates player profiles, sets which mods a profile enables, and switches profiles. A copy made by a mod carries over the enabled-mod selections and nothing else: no consent decisions, pins, settings, or private preferences. The destination profile must already have its own permission decisions before a mod changes that profile's enabled set or requests character creation in it. Existing profiles stay unchanged. With `session:control`, `manage.session` saves, exits to the title screen, or quits without asking the player to confirm, so a mod should ask first in its own panel.

Worker management calls are bounded JSON requests. The host runs one operation at a time and accepts at most 32 requests per mod per minute. `manage.profiles.list/create/switchTo/rename` reach only the profiles the calling mod created, up to 64 per mod. Creating a profile takes a name and nothing else, so a new profile cannot be copied from an existing one. The SDK's current profile type has no declaration for the Worker `rename` method and marks `profiles.rename` as optional, so check that it exists before calling it. Switching profiles during character creation needs `saves:manage` and the destination profile's own stored permission decisions. Session decisions made under another profile do not count. `manage.session.save`, `exitToTitle`, and `quit` each show a host dialog before going through the game's save and exit path, and if the save fails, the exit is refused. This broker gives no engine access or raw presentation. For screen replacement, the presenter paths accept data only.

A Worker with `mod:install` can call `manage.content.planInstall(source)` and `applyInstall(planId)`. With `mod:session` it gets `planSession(source)` and `applySession(planId)`. A source is either `{ repo: "owner/repository" }`, which takes the same GitHub tag URLs as the player door, or a `Uint8Array` archive. The bootstrap sends archive bytes as `{ archive: number[] }`, and direct messages can use that shape as well. An archive can be at most 12 KiB on the wire. A plan holds `id`, `modId`, `repository`, `version`, `digest`, `capabilities`, and `session`. The host keeps one plan per Worker API for 60 seconds, and any apply attempt uses it up, whether the player declines, the request is stale, or the operation is the wrong one. The host dialog shows the target id, repository, version, SHA-256 digest, and requested capabilities. After the dialog, the host measures its retained bytes again and refuses the apply if anything changed. A Worker has no way to pass in grants, a pre-approved plan, or a confirmation id. The SDK has no types for these runtime content methods yet, so declare them locally in TypeScript.

Both content paths run the player's archive validators, which reject executable files and any capability declarations. An install arrives switched off and cannot replace a mod id that is already present. A session pack loads through the mod-facing loader with `granted: []` and `contentOnly: true`, starts on reload, and cannot take an installed id, even one from the same repository. A `neo:sessionMods` record written by a page never authorizes code and inherits no installed consent, key-value storage, or credentials. Changes a session pack makes to a character can stay after the archive is forgotten. Applying a plan does not reload the game.

`manage.readMod(address)` under `mod:read` returns the discovered metadata and the payload file names. It returns no file text and installs nothing. Repository planning and lookup ask the player before contacting GitHub. They go through the existing discovery and install resolution with these limits: HTTPS only, to `api.github.com` and `raw.githubusercontent.com` under the selected repository, no credentials, a 15-second timeout per request, at most 32 fetches, 1 MiB per response, 4 MiB in total, and 128 payload files. In the browser, a redirect fails the fetch. On desktop, a metadata lookup needs native approval for a separate repository identity, then passes through the native relay's destination, redirect-hop, and DNS checks, and it cannot use the calling mod's credentials. If native authority is missing or declined, the lookup fails closed. A metadata reply is capped at 64 KiB, and archive expansion is capped at 4 MiB total and 128 entries. This path gives no access to arbitrary URLs and does not authorize a mod's own network calls.

`await manage.wizard()` under `debug:wizard` shows a host dialog and returns a local asynchronous proxy for the existing wizard methods. Each call through the proxy gets its own host confirmation and takes bounded arguments. Before any wizard reply or command, the host detaches the slot, latches the roster's permanent write surrender, verifies both, and sets `NOSCORE.DEBUG` on the live character. If that verification fails, the mod gets no wizard access. Save writes stay off for that page from then on, even if a slot is attached later, and reloading ends the detached test session. No host function or live engine object crosses the channel.

`manage.options.get/set` reads options and proposes a validated transaction. The player confirms every change. A cheat change states its permanent scoring consequence, and the host persists `NOSCORE.DEBUG` and `modNoscore` before it changes the cheat option. Birth and score options stay locked. `manage.saves.list` opens a host-drawn picker of up to 128 roster entries, with every character choice unchecked. Only the entries the player selects come back, each with a fresh opaque id that expires at the next selection or profile/session change. A raw slot id never works. `load`, `rename`, and `delete` each ask again, and deleting the active slot is refused even after the player confirms. `load(id, { resumeAutoplayer: true })` still waits for the separate controller consent dialog when the resumed character boots.

With `profiles:manage`, a Worker can call `manage.mods.snapshot()`, which returns its own `{ id, name }` and nothing more. For its own id it can request `disable`, `setSettingValue`, or `setSectionChoice`. It can also select itself with `setConflictOverride` and withdraw third-party consent with `setThirdPartyConsent(false)`. Each change goes through a host-drawn confirmation that names the caller and the changes. The approval is bound to the current measured payload and configuration, so a changed plan, a revoked grant, or a stale epoch cancels the operation. No Worker method records permissions, resolves confirmation ids, enables code, copies scoped storage, or installs mods.

Snapshot, subscription, and refresh responses on the mod-facing side leave out stored consent, settings, payload digests, and pending confirmations. A mod cannot resolve a confirmation or change the third-party consent switch. Recording permissions always asks the host for a decision, even when the mod already holds every requested grant, and that request alone never turns a session grant into a stored decision.

`manage.screens.take({ mods })` draws the mod manager instead of the game's own, under `screens:manage`. Each handler is a function that returns when the player closes the screen, and the game opens it from both the game menu and the title screen. If the handler throws or rejects, the game's own Mods screen opens instead. Name only the screens the mod draws; today the mod manager is the only one a mod can take, and a call that names another is refused. A second mod cannot take a screen that is already held, and the hold ends when the mod stops.


## Worker spawning and shared data

Under `debug:spawn`, a consenting Worker gets `debug.spawnObject(kind, count?)` and `debug.spawnMonster(race, count?)`. Both take a known content id, name, or registry index, plus a count from 1 to 16. Every request opens a native dialog naming the mod by display name and id, the content, and the count. If the player declines, nothing changes. Before anything spawns, the host writes `NOSCORE.DEBUG`, `modNoscore`, and the `spawn` consequence to the character's save. A failed writer, a revoked grant, a changed measured binding, or a stale epoch stops the spawn. The host allows four spawn requests per mod per minute and shows one spawn dialog at a time. Spawned things appear near the character. `debug:wizard` is not available to Workers.

`shared.read(publisherId, name)` under `shared:read` reads JSON that another mod has explicitly published. It cannot reach private preferences, key/value storage, save bags, or the caller's own publications. `shared.publish(name, version, value)` and `shared.withdraw(name)` under `shared:publish` always take the publisher id from the host connection. A published value is visible to every other mod with `shared:read`, and those mods can keep it or pass it on through their own grants. Publishing transfers no permissions. Every call takes and returns deep copies, so there are no live references or subscription callbacks.

A Worker shared entry name is 1 to 64 lowercase letters, digits, dots, hyphens, or underscores, and it starts with a letter or digit. A version is a nonnegative safe integer. Each mod can publish up to 32 entries of at most 16 KiB of JSON each, and its reads and writes together are capped at 16 calls per second. The first publication in a Worker session records and persists `shared-write` once. It shows no player dialog and does not disqualify the score, but it needs a character with a working save writer. Shared and spawn calls also count against the broker's message and reply limits.

The version 1 `capabilityUse` summary keeps `spawn` and `shared-write` next to `controller` and `hidden-information`. Controller history can be truncated while the summary stays whole. Revocation and mod-bag removal leave recorded consequences in place. Older saves need no migration, and a summary with an unknown newer schema is left unchanged.

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
| `ctx.net` | `net`, with credentials passed by reference |
| `ctx.profiles`, `ctx.session` | `manage`, with Workers limited to the bounded operations above |
