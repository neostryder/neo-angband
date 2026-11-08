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
| `meta` | The mod's `id`, `flags` and `tier`, the API and game versions (`api`, `engine`), `newCharacter`, `granted(capability)`, `log`, its numeric settings (`settings`, `setSetting`), and the enabled mods (`mods`). | None |
| `view` | The known world: `world()`, `player()`, `monsters()`, `level()`, `input()`, and `isCurrent(token)`. | `state:player.read`, `state:monsters.read`, `state:map.read` and `state:interaction.read` for the single parts, or `state:*.read`; none for `world()` and `isCurrent` |
| `act` | `submit(token, intent)`, `answer(promptId, answer)`, and `controller`, which works only while the mod holds the keyboard. | `input:intent`, `input:prompt.reply`. `controller` needs `input:controller` and `state:interaction.read` as well as `input:intent`. `onKey` needs `input:observe`. |
| `events` | `on(name, listener)` and `off(subscription)`. | `event:<name>` |
| `hooks` | The hooks this game runs (`available`) and the ones this mod declared (`active`). | None |
| `content` | The mod's own files (`own`, `asset`), the running game's records (`records(file)`), and `lookup({ file, key })` by the key `recordKey` derives. | None |
| `ui` | Host-drawn panels (`mount`, `patch`) and the mod's key bindings (`keys`). | `ui:panel.mount`, `keymap:write` |
| `store` | `prefs`, kept apart from any character, and `character`, kept in the current character's save. | None |
| `net` | Requests to the hosts the manifest names, with credentials passed by reference. Present only when the manifest asks for a `network:` permission. | `network:<host>` |
| `manage` | Host-confirmed profile, save, option, character, content, repository, and detached wizard operations for Workers; broader legacy management for first-party in-process mods. | `profiles:manage`, `session:control`, `options:manage`, `saves:manage`, `mod:install`, `mod:session`, `mod:read`, `debug:wizard` |
| `truth` | Every monster and the real map. Any in-process mod or Worker the player allows it. | `state:map-actual.read`, or `state:monsters-actual.read` for monsters and races only |

### What `view` shows

`view` is built from core's known world (`buildKnownWorld`): the monsters the player perceives, with health as the look command words it, the abilities the player has learned, the map as the player remembers it, and items as far as the player has identified them. A monster the player cannot see is not in any part of it, and changing that monster changes nothing a mod can read. A mimic the player takes for an object is not listed as a monster, and while the player hallucinates `monsters` is empty and `monstersHidden` is `"hallucinating"`. A monster's `id` is a handle given out on each level in the order the player first perceives monsters there, not the game's monster index, and the list runs nearest first. Timed effects show the grade name the status line prints, a recall or deep descent shows only that it is active, a recharging item shows the count its name gives (`charging`), `unknownRunes` is the name's `{??}`, and a remembered trap stays as the player last saw it. `world()` returns every part at once, with `null` for each part the mod has no permission for. The single-part calls answer `not-granted` instead. `world().turn` is the game turn counter and is `null` without `state:turn.read` (or `state:*.read`). It moves only when game time passes, so a command that spent no time leaves it where it was.

Each value carries a `token` naming the input wait it was read at. `act.submit` takes that token, and a token from an older wait comes back `refused`. `isCurrent(token)` says whether that wait is still the current one. A `target` intent names its monster by the `id` the view gave it; an id for a monster the player does not perceive now is refused like any monster that cannot be targeted.

A monster's `visible` means eyesight: blindness, darkness and invisibility can leave a sensed monster listed with `visible: false`; infravision and see-invisible count when they let the player see it. A stationary monster first perceived during hallucination receives its sighting notification when the hallucination clears. Remembered item auras use the last observed object properties and the player's current rune knowledge, and remembered traps include only the traps the player perceived.

Shop visits and shop knowledge screens record stock and owner observations, and known-world reads at a shop's entrance refresh that shop. Other shops retain their last observations for the session, or return empty stock and an unnamed owner if they have not been inspected. Loading a game starts with unknown shop observations. A host that draws a shop screen calls `observeKnownStore(state, store)` to record the stock it shows.
### The controller

`act.controller` has `owns()`, `setStatus(status)`, `markNondeterministic()`, and `release(reason)`. Every call except `owns()` returns `refused` with the code `not-owner` unless the mod holds the keyboard. An API 2 definition takes the keyboard with its `controller` member, which needs `input:controller` and `state:interaction.read` in the manifest along with `input:intent`. One controller holds the keyboard at a time. `onKey` receives each key the player presses while the mod holds the keyboard and returns `{ kind: "keep" }` or `{ kind: "release" }`, and it needs `input:observe`. Answering prompts needs `input:prompt.reply`. `onDeath: "end"` lets an ordinary death end the run instead of starting the next character.

A controller can act in an open store. The host asks it for a decision at phase `store` and passes the `shop-buy`, `shop-sell` or `shop-exit` intent it returns to the shop screen.

### Panels

`ui.mount` takes the same panel grammar as Worker mods: `text`, `button`, `row` and `column` nodes under a panel `id`. The `id` and each button's `action` are lower-case letters, digits and hyphens, start with a letter, and run to 64 characters at most. A text holds up to 4096 characters, a row or column up to 32 children, and the tree nests up to 16 deep. The host draws the panel, and `onAction` hears the `action` of each button the player uses. `ui.patch` replaces the title (`null` removes it), the tree, or `visible`. A panel outside the grammar, a second panel with an id already mounted, or a patch to a panel that is not mounted comes back `refused` with the code `bad-panel`. A mod in API 2 does not get a DOM element. `ui.gameMenu.register(action, label, run)` adds a row to the game menu under `ui:menu.row`. In-process code may also use `registry:menu`; a Worker needs `ui:menu.row` for this callback door. A page opened with `ui.overlay` or `ui.mountPage` can set `closeAt` to `top-left`, `bottom-right` or `bottom-left` to move the host's close control off the page's own header buttons; the control is always drawn, and sits top right otherwise.

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

`engineHooks(context)` is the way to reach those. It returns the game's own hook members by name, and the game calls them with the live arguments it always passed. It is asked only when the mod has the `engine` domain: in-process first-party code or an explicit developer in-process run, with a declared `engine:access` grant, and never a Worker. First-party in-process code receives that declared grant by default, but a recorded player refusal removes it. Every engine domain read checks the grant again. Live objects already returned to page code remain live; these checks do not sandbox page execution. A name that already has an API 2 form is refused, so each hook is declared one way.

`engineTiles(context)` is the same door for a tile set. It returns a `filler` that supplies tiles for monsters and objects the pack does not draw, and a `player` provider that picks the player's tile from the character's shape, class, race and level. It needs `registry:tiles` and the `engine` domain, and a mod that also declares a `tileMap` table declares its filler in only one of the two.

`engine.registry` is the in-process door for what a mod registers with the game itself: effect handlers, projection handlers, commands and their verbs, rooms, profiles, blows, stores, menus, and the rest of what an API 1 `register(host, ctx)` was given as `host`. It requires `engine:access` and each domain's `registry:` grant. A Worker uses the separate data-only `mod.registry` declarations below, without `engine:access`.

## Policy tables

`policies(context)` returns changes as data: hook answers, and a few game registrations. The game applies them itself, without calling the mod, so a table works the same in a Worker and in process. Tables do not limit what a mod can change. An in-process mod keeps every hook function it has, and when it declares a function and a table for the same hook, the function is used.

Each table needs its matching registry permission, listed below, in either runtime. A missing grant skips only the tables that need it; the mod's other tables and hook functions remain available. In-process `registry:*` covers every table; Workers must name the individual grants, and a bare `*` grants nothing. The in-process host evaluates policies during guarded hook composition and reuses them for startup registrations. A factory that throws contributes no tables and does not stop the game from starting.

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

Workers granted `mod:authoring` can import `@rpgm-tools/neo-angband-mod-sdk/authoring`. The host stages the fixed authoring, blueprint, field, provenance, and reference modules as source alongside the mod's own modules. Functions such as `templateRecord`, `suggestFields`, and `checkRecords` execute inside the Worker on data the mod supplies. This library provides no installation, session-loading, or host-call path. The staging size and module limits include the library, and the host rechecks the grant before releasing the staged graph. Revocation stops the Worker; the library's local computation has the same CPU and memory limits as other Worker code.

Every Worker uses the vocabulary's Worker eligibility, including first-party Workers. The simple grants require an explicit player decision. The presenter paths below add menu, screen, map, and Mods-screen replacement as host-drawn data. Birth replacement, the broad interface wildcard, and engine access remain unavailable. Truth, management, content, spawning, and shared data use their separate bounded Worker operations.

Workers with `ui:messages.replace`, `ui:sidebar.replace`, or `ui:status.replace` can call the matching `mod.ui.messages.replace(lines)`, `mod.ui.sidebar.replace(lines)`, or `mod.ui.status.replace(lines)`. A line is `{ text, style? }`, with `style` from `normal`, `muted`, `warning`, `danger`, and `good`. The host draws text with `textContent`, accepts at most 64 lines, 512 characters per line, and 4096 characters per output, and accepts `null` to restore the game's region. The text can hide warnings or misstate character status.

Workers with `ui:region.create` can call `mod.ui.region.create({ id, rect: { col, row, cols, rows }, lines })` and `mod.ui.region.remove(id)`. Reusing an owned id updates its text and rectangle. The host validates the rectangle against the current character grid and allows at most eight text outputs per Worker, including named replacements. Output cannot receive input, choose a layer, or cover host dialogs. The broker's message and call-rate limits apply to every update. The host removes output on teardown and hides it on revocation, modal screens, or a host dialog.

Workers with `options:write` can call `await mod.options.set({ values, hitpointWarn, delayFactor, lazymoveDelay })`. The host accepts interface booleans and bounded delays only, validates the entire change before mutation, and rejects birth, cheat, score, and unknown options. This path does not expose `manage`.

Workers with `keymap:edit` get asynchronous `mod.keybindings.keyset()`, `list()`, `commands()`, `set(trigger, action, replace?)`, `remove(trigger)`, `capture()`, and `cancelCapture()`. Every operation uses the current keyset. Actions hold at most 256 characters. Replacing a conflicting binding requires `replace: true`. The host reserves Escape, control characters, modifier chords, F5, F11, and F12. Capture ends on a host dialog, cancellation, teardown, or a ten-second timeout. Revocation or an expired broker epoch drops a pending capture result.

Workers with `display:filter` can call `await mod.display.filter({ name, amount })` or pass `null` to clear their filter. The host accepts `grayscale`, `sepia`, and `invert` from 0 to 1, `brightness` and `contrast` from 0.25 to 2, and `saturate` from 0 to 2. The host constructs the filter, applies it to the game canvas, and suspends it during host dialogs. CSS text, resource URLs, and functions are not accepted. These Worker additions use serialized data and do not expose live presentation objects.

Worker presenter grants use `await mod.ui.menu.replace(describe, select)`, `await mod.ui.screen.replace(describe, select)`, `await mod.ui.management.replace(describe, select)`, and `await mod.display.replace(describe)`, under `ui:menu.replace`, `ui:screen.replace`, `screens:manage`, and `display:replace`, respectively. Passing `null` unregisters that presenter. These runtime additions require local types in TypeScript; the SDK's live presenter types describe the separate in-process contract. A Worker still cannot declare `definition.presentation` or `definition.birth`.

The callbacks execute only inside the Worker. The port carries callback ids, host-issued presentation ids, JSON snapshots, descriptions, and selection answers. Every callback gets `(input, presentationId)`. A description is `{ title, lines, rows: [{ id, label }] }`, with at most 64 lines and 64 uniquely named rows, 256 characters per title, line, or label, 64 characters per row id, and 32768 bytes total. Row ids contain letters, digits, underscores, hyphens, or colons. The host draws every string with `textContent` and fixed styles within the map rectangle. It retains Close and Use game screen controls. The most recently registered eligible Worker handles a family when no in-process presenter holds it. Replacement registration is limited to eight calls per second per Worker across these four methods, in addition to the broker limits.

For a menu, `describe` receives `{ id, title, footer, choices: [{ id, label, disabled }], browseOnly }`. The host omits the live detail callback and command keys. A row click calls `select({ action: rowId }, presentationId)` in the Worker. The Worker returns `{ kind: "choose", choice: originalChoiceId }` or `{ kind: "cancel" }`. The host rejects disabled, foreign, or browse-only choices. Menus with more than 64 choices fall back to the game. Command keys and detail panes remain available through Use game screen. For example:

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

The example keeps the original choices in a bounded Worker-local map keyed by the host's presentation id. A screen receives the JSON `ScreenView`, including its blocks and offered action ids. Its selection callback returns `null` or `{ kind: "dismiss" }` to close, or `{ kind: "refresh" }` to ask its Worker-local description callback again, up to 64 times per screen. This permits local tabs, sorting, and other presentation choices without a live host handler. Requests for game actions, including `{ action: originalActionId }`, decline the replacement and open the game's screen. Existing `ScreenHost.invoke` implementations can await prompts and commit mutations without checking the Worker grant again, so this bridge does not call them. Renaming, file export, and update actions need the game's own screen until those actions have guarded serialized transactions. The presenter yields before host prompts. Escape and Close dismiss it without delivering a key or action to the Worker. Permission and controller-consent dialogs are never offered to presenters, and Core screen ids remain host-owned.

The management path receives `{ id: "mods" }` and the same description grammar. A selected row produces a Worker-local selection callback; it grants no management operation. The host always draws Permissions and game controls above mod panels. That control declines the replacement so the game's Mods screen opens with mod panels suspended and all navigation Core-drawn, outside menu, screen, and text replacement. No Worker method can name another management screen, resolve a confirmation, or supply a permission decision.

The display callback receives `{ grid, viewport, map }`, where `map` is the map's character-grid rectangle. It returns an array of at most 512 `{ col, row, glyph, color }` records within 60000 bytes. Coordinates are integers from -32767 to 32767, relative to the map's top-left cell; out-of-map cells are clipped. A glyph contains one Unicode code point without control or formatting characters. Color is `normal`, `muted`, `warning`, `danger`, or `good`. The host requests at most ten frames per second with one request in flight and draws inert glyph elements over the game's own map. This grant supplies geometry, not hidden state or a canvas. Mods obtain known world data through separately granted view calls.

Every description and selection has a 250 ms deadline. Invalid, late, revoked, changed-binding, changed-session, or superseded answers decline the presentation; the game's renderer or screen remains the fallback. Map output expires after 250 ms and clears on a game-frame change or host dialog. Interactive presenters can own the gameplay modal offered to them, but Core questions hide and cancel them even inside an existing gameplay modal. No mod output enters the browser's top layer or receives permission-dialog input, reserved keys, DOM nodes, canvas objects, transferables, or shared buffers. `ui:birth.replace` stays closed because its current contract supplies a live mutable birth session, including acceptance; it needs a bounded command state machine with host-owned final acceptance. `ui:*.replace` includes birth and stays closed until every named family has a tested Worker mechanism.

Running in a Worker is a choice a mod makes for isolation. Its code runs apart from the game, and the game reaches it only through messages. It is not the only way for a mod to change the game, and nothing here limits what an in-process mod can do.

A mod with `"runtime": "worker"` default-exports the same definition and gets the same domains, results and known-only data as an in-process mod. Its manifest names an `api` range that API 2 satisfies and the module to start in `entry`. Each call becomes a message to the game's broker (`packages/web/src/mod-worker/host.ts`), which serves it with the in-process host and posts back a copy of the answer. The Worker runs in a sandbox with no network and none of the game's storage ([WORKER_ISOLATION.md](WORKER_ISOLATION.md)).

Running there costs a mod these things:

- Hooks that answer inside a turn. A turn cannot wait for a message, so every hook that returns an answer comes from `policies`. In a Worker, `hooks(context)` may declare only `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified`, and the game passes each one on without waiting. Any other hook function is reported on the Mods screen and not installed.
- Immediate answers. Every call returns a promise, and every value is a copy. `meta.granted` is the only question the Worker answers itself.
- `manage` contains only the named serialized operations documented below. A Worker with either explicit truth grant gets `truth.level`, `truth.monsters`, `truth.race`, and `truth.storeKnowledge`, subject to that method's grant.
- Files and the network. `content.asset(path)` answers a `data:` URL holding the file's bytes, since the sandbox can load nothing. `net.credential(name)` gives the Worker a reference only; the game keeps the value and adds it to the request after the request leaves the Worker.
- A wildcard grant. A Worker gets the permissions the player granted under their API 2 names, and `"*"` grants nothing.

The broker refuses a message over 64 KB and any call past 200 in one second. It pings the Worker every second, and a Worker that leaves a ping unanswered for 5 seconds is stopped and switched off for the session, with the notice a mod that keeps failing gets. When the game asks the Worker to migrate its bag or its preferences and has no answer within 3 seconds, it goes on without one: the character keeps its old bag, the stored preferences stay as they were, and `store.prefs.get` answers `unavailable`. An answer that arrives after that is dropped. The Mod performance screen shows a Worker mod's reply time and network wait in their own columns, apart from its CPU time.

The Worker proxy rejects an oversized call before sending it, and the broker returns a bounded error for an identifiable oversized or malformed call. A migration timeout starts a new epoch: the broker refuses calls from earlier epochs before running them and keeps each pending call's original epoch on its reply. When the Worker learns of a new epoch, it rejects its superseded pending calls, so an old reply cannot resolve a call in the new epoch.

The preview Worker ABI (`modApi: 2` with `workerEntry`) is retired. Its manifest still reads, and the loader refuses its code with a note to rebuild it against API 2. Its Worker-only permission names convert to API 2 names: `ui:panel` becomes `ui:panel.mount` and `state:model.read` becomes `state:player.read`. `prefs:read`, `prefs:write` and `asset:read` become nothing, since API 2 asks no permission for a mod's own preferences and files, and so do `command:submit`, `ui:region`, `query:snapshot`, `registry:declare`, `policy:install` and `hook:respond`, which have no API 2 form. `WORKER_CAPABILITY_ALIASES` in the SDK holds the whole table.

### Third-party mods and consent

A third-party (public) mod can use the features marked Yes in the table once the player grants the permissions its manifest declares. `input:intent` and `keymap:write` do not imply any of them. Mods that need a feature marked No must be first-party. Public API 2 code always runs in an isolated Worker, even when the manifest asks for page execution. The host checks each message against the mod's identity and grants, and it caps message and reply sizes, message rate, subscriptions, and UI count, such as eight panel mounts per mod. Public API 1 code is refused. For development, a lab build accepts `?labprocess=<mod-id>` to run a named folder mod in the game page if the mod declares and is granted `engine:access` and its content is approved. Under Node, the headless runner's `--unsafe-in-process` option does the same, and mod code then runs with the process's privileges. Neither opt-in makes a mod first-party.

| Feature | Permissions | Available to public mods |
|---|---|---|
| Autoplayer controller | `input:controller`, `input:intent`, `state:interaction.read`; every author's controller permanently makes the character unscorable and the save nondeterministic | Yes |
| Watching gameplay keys (`onKey`) | `input:observe` | Yes |
| Commands | `command:add` | Yes |
| Rows on the title screen | `ui:title` | Yes |
| Rows in the game menu | `ui:menu.row` | Yes |
| Profile and session management | `profiles:manage`, `session:control` | Yes, mod-owned profiles and host-confirmed save, exit-to-title, and quit |
| Content installation and session packs | `mod:install`, `mod:session` | Yes, measured content plans and a separate host confirmation; no code or capabilities |
| Repository metadata | `mod:read` | Yes, confirmed GitHub lookups returning metadata and file names only |
| Wizard testing | `debug:wizard` | Yes, host-confirmed commands after the character becomes unscorable and saving stops permanently for this page |
| Game option management | `options:manage` | Yes, host-confirmed changes; birth and score options stay locked, and cheat changes persist an unscorable mark first |
| Character management | `saves:manage` | Yes, player-selected characters with opaque ids and host confirmation on load, rename, and delete |
| Hidden state (truth) reads | `state:map-actual.read` or `state:monsters-actual.read` | Workers: yes, by grant and consent; marks every affected character unscorable |
| Raw engine access | none | No |
| Raw presentation replacement | none | No |
| Host-drawn menu and screen descriptions | `ui:menu.replace`, `ui:screen.replace` | Yes, bounded text and opaque selections; menus validate original choices, and live screen actions fall back to the game |
| Host-drawn map glyph commands | `display:replace` | Yes, map rectangle only, with deadlines and host fallback |
| Host-drawn Mods screen | `screens:manage` | Yes, with reserved host recovery and permission controls |
| Birth and UI replacement wildcard | `ui:birth.replace`, `ui:*.replace` | No, the serialized birth state machine and host-owned acceptance are absent |

### Grants Workers cannot hold yet

A mod running in a Worker cannot hold the grants in this table. The consent screen explains each refusal. A mod that cannot run without a refused grant does not start. The eight registry mechanisms below accept declarations independently of the engine bridge prototype, which remains unwired.

| Grant | Why it is closed | What it needs |
| --- | --- | --- |
| `ui:birth.replace`, `ui:*.replace` | The serialized birth state machine and host-owned acceptance do not exist. The wildcard covers every replace family, including birth. | A serialized birth state machine and host-owned acceptance. The wildcard also needs every family it covers to be implemented. |
| `engine:access` | `writeSlot` writes save bytes and roster metadata separately and can report failure after changing the save. A live adapter cannot satisfy the prototype's atomic commit contract through that writer. | An atomic persistence primitive, a production safe-point adapter, consequence marking, and Worker handle lifecycle tests over that adapter. |
| `registry:*` | The wildcard also covers `monster`, `projection`, `effect-info`, and `rune`, which have no Worker mechanisms. | Every covered domain must have a bounded isolated mechanism before the wildcard opens. |
| `backup:folder` | The desktop shell owns the backup folder and relays requests through its own authority table. | A Worker grant for the folder. None exists. |

### Worker registry declarations

Every author can request `registry:effect`, `registry:room`, `registry:profile`, `registry:blow`, `registry:glyph`, `registry:randart`, `registry:vocab`, and `registry:menu`. A granted Worker receives `mod.registry.<domain>.declare(declaration)`, returning `Promise<Api2Result<null>>`. Each method accepts exactly the fields below. New identifiers start with the calling mod's id and `:`. A declaration contains no callbacks, engine objects, handles, paths, or transferable values.

| Domain | Declaration | Host behavior |
| --- | --- | --- |
| `effect` | `{ code, program }` | `code` is an owned string or an existing numeric effect code. A program has 1 to 16 `{ op: "heal" or "damage", amount }` or `{ op: "message", text }` operations. Amounts are integers from 0 to 10,000, and messages contain at most 160 characters. Healing clamps to maximum HP; damage uses the host's damage handler. |
| `room` | `{ name, primitive }` | `name` is an existing room key or an owned key. `primitive` selects `simple`, `circular`, `overlap`, `crossed`, or `large`. Existing room profiles can select overridden keys; adding a key alone does not add it to a profile. |
| `profile` | `{ name, base, minLevel, alloc }` | The host copies an existing profile under a new owned name, with minimum depth from 0 to 127 and selection weight from 0 to 100. Its builder, room parameters, and tunnel parameters remain the base profile's. |
| `blow` | `{ name, damage, obvious }` | `name` is an existing blow effect or an owned name. The host derives both recorded and live attacks from fixed integer damage from 0 to 10,000 and a boolean visibility flag. |
| `glyph` | `{ kind, glyph, source }` | `kind` is `template` or `vault`. Both symbols are single non-space characters. The host maps the target to an existing source symbol's terrain and population behavior. |
| `randart` | `{ table, key, toH, toD, toA }` | `table` is `abilities` or `prep`, `key` is an integer from 0 to 4095, and each combat stat is an integer from -100 to 100. The host sets those stats when the generator uses that key. Census, redundancy calculations, and arbitrary artifact callbacks remain unavailable. |
| `vocab` | `{ kind, term, label }` | The host stores an owned term and label in this connection's vocabulary. Kind names contain at most 64 characters. These declarations do not grow core flag arrays or statistics, expose another mod's terms, or persist entity values. Mods keep their own values through character storage. |
| `menu` | `{ id, rows: [{ id, label, hidden }] }` | Up to 64 rules rename or hide existing rows while preserving semantic targets and row order. Supported ids are `core:activate-item`, `core:browse-spell`, `core:cast-spell`, `core:context-grid`, `core:context-object`, `core:context-player-other`, `core:context-player`, `core:context-use-item`, `core:curse-removal`, `core:effect-choice`, `core:pickup`, `core:spell-book`, `core:study-spell`, `core:target-monster`, and `core:use-item`. Other menus, including permissions and the game menu, are refused. Adding game-menu actions requires `ui:menu.row`. |

The host validates the entire declaration and its references before marking or installing it. Before the first accepted declaration for each domain, it saves permanent unscorable and nondeterministic marks for the attached character. A session without a writable character refuses registration. Invalid declarations never call the save writer. A failed mark installs nothing. The host binds authority to the character identity and player object, and it rechecks the measured installation binding, plugin id, epoch, and live grant after awaiting the mark and before replying. A pending request cannot widen its own grants.

The connection accepts at most 32 declaration calls per second, one pending call, 64 successful declarations across all eight domains, and 256 KiB of retained declaration data, including copied profiles. Mark attempts are capped at four per second. Requests also use the broker's 64 KiB message limit and existing reply quotas, plus the bridge copier's depth-12 and 4,096-value limits. Copied base profiles use the same structural limits. Menu rules decline input larger than 256 rows and retain the original rows. Functions, classes, accessors, prototype keys, cycles, typed arrays, shared memory, and transferables are refused. Text fields reject control and formatting characters.

The game runs only host primitives during synchronous ticks. It never asks the Worker to execute an effect or a generator. Revocation, a changed epoch or binding, and teardown deactivate installed behavior. Replaced handlers fall back to their earlier host behavior; new effects decline, new rooms return failure, new blows deal zero damage, new glyphs do nothing, and inactive profiles leave selection. A stalled Worker is stopped by the broker heartbeat and uses those same fallbacks. Vocabulary declarations stay private to their stopped connection. Arbitrary callbacks and lossless live-engine compatibility remain unavailable.

The game page draws the public consent dialog itself as a native modal with system fonts and fixed wording, and a mod's locale cannot replace it. The dialog shows the sanitized manifest name, mod id, repository, and the first 12 characters of the payload's SHA-256 digest. Every checkbox starts unchecked, including previously granted permissions. The player's decision is bound to every measured file, the execution tier, and the requested permissions. Changing those inputs calls for a new decision, even at the same version. Every executable mod, including first-party code, needs a measured binding, and first-party imports use the retained payload bytes. Decisions save atomically, and if saving fails the mod does not run. Players can review and revoke grants on the Mods permission screen, and revoking stops the running code.

A public controller also needs a second, separate dialog before it starts playing, every time a save is loaded or resumed. Profile roll-on does not accept that dialog, and first-party roll-on also waits for session confirmation. Every controller candidate needs the current permission binding and stored `input:controller` and `input:intent` grants. Escape or Ctrl-Z takes the keyboard back before any mod code sees the key. The controller can submit gameplay commands only, covering movement, running, resting, stairs, doors and traps, tunneling, item use, spells, looking and searching, shopping, targeting, and travel, as well as ignore rules. The host refuses quit and retire, profile and session management, install, and unknown commands, along with any command belonging to another mod. Input from the mod outside the controller is accepted only shortly after an actual player action. Starting any controller permanently marks the character unscorable with `NOSCORE.BORG`, sets `modNoscore`, and marks the save nondeterministic, including first-party controllers. Saves and run reports list the most recent 32 controller identities in `autoplayers`. The separate `capabilityUse` summary keeps permanent provenance without truncation or dependence on mod-owned save bags.

## Seams outside the public API

First-party in-process presentation also requires declared grants. `presentation.display` and `presentation.tiles` need `display:replace`; live `display.onKey`, `keyRepeat`, and `cancelInput` need `keymap:edit`. `presentation.subwindows` and `presentation.panels` need `ui:region.create`, and `sidebarHost` needs `ui:sidebar.replace` (or `ui:*.replace`). DOM overlay and page mounting need `ui:region.create`, `ui:screen.replace`, or `screens:manage`, as well as the existing `ui:panel.mount` grant. Title actions still need `ui:title`. Declared public presentation grants default to allowed for first-party in-process code, and recorded refusals override them, including wildcard declarations. Management grants still need their separate confirmation. Public Workers and developer in-process switches gain no live presentation objects through this seam. Live page objects remain outside Worker containment.

`manage` and `truth` are absent from a mod's API unless it holds them, so test `if (mod.truth)` before using it. `truth.monsters()` lists every monster's location and exact state, including unseen monsters, with a `perceived` flag. `truth.level()` gives the real map. `state:monsters-actual.read` opens only `monsters()` and `race()`; `state:map-actual.read` also opens both, plus `level()` and `storeKnowledge()`. `state:*.read` covers neither truth grant. After player consent, a controller or any other mod holding a truth grant may use hidden information in its decisions. Either truth grant permanently marks every affected character unscorable with `NOSCORE.DEBUG` and `modNoscore`, regardless of author. The host writes the mark and provenance to the save before returning hidden information. A missing or failed save write refuses the read. A truth read alone does not change determinism.

`SaveManifest.capabilityUse` and `RunReport.capabilityUse` carry `{ schema: 1, entries }`. Each entry records the host's measured installation consent binding, mod id, version, payload digest, capability, first activation's turn and depth, and consequence (`controller` or `hidden-information`). Unmeasured legacy callers record null installation, digest, or activation values rather than inventing measurements. The host deduplicates matching identities and consequences, retaining the first activation without truncating the summary. Revocation stops future truth reads and never clears marks or provenance. Old saves omit the summary and load unchanged; this build preserves a newer summary schema without interpreting or replacing it, while still applying existing score and determinism marks.

A first-party in-process mod that the game lets see the real map can ask for it while it runs, rather than declaring it in the manifest. Call `permissions.requestTruth(reason)` and the game shows its own question with your reason in it. On a yes you get the `truth` domain, the choice is remembered like one made in the Mods screen, and every character played while the mod holds it is marked the way debug mode marks it. On a no you get `{ ok: false, code: "declined" }`, and the next call asks again. `permissions.truthHeld()` tells you whether the mod already has it, and a mod that does is never asked. Other mods have no `permissions`, so check `if (mod.permissions)` first.

`meta.tier` reports measured identity separately from these permissions. A public mod with consent to `truth` still reports `"public"`.

`truth` is built for any in-process mod or Worker the player has allowed either truth grant. The Worker broker validates arguments, identity, and epoch, rechecks the grant at call time, awaits the permanent save mark before building a plain snapshot, and drops the reply if the grant is revoked or the epoch changes before delivery. A session without a character to save returns no hidden data. Truth replies share the 4 MiB reply cap and 200 calls per second cap; an oversized reply leaves the permanent mark intact. A Worker can hold `profiles:manage`, `session:control`, `options:manage`, and `saves:manage`, regardless of author, after separate Core confirmation. Its `manage` proxy contains only the operations below. Broader in-process management still requires a first-party mod whose `FIRST_PARTY_ORIGINS` entry names the capability. A mod that declares a permission it cannot hold loads without it, and the Mods screen says why.

The in-process `manage.profiles` lists and creates player profiles, sets which mods a profile enables, and switches profile, under `profiles:manage`. A mod-created copy carries only enabled-mod selections, with no consent decisions, pins, settings, or private preferences. Permission decisions must belong to the destination profile before the mod changes its enabled set or requests character creation there. Existing profiles are unchanged. `manage.session` saves, exits to the title screen or quits under `session:control`, without asking the player to confirm, so a mod asks first in its own panel.

Worker management calls are bounded JSON requests and allow one host operation at a time, with at most 32 requests per mod per minute. `manage.profiles.list/create/switchTo/rename` access only profiles the caller created, with a maximum of 64 profiles per mod. Creation accepts only a name, with no copy source. The SDK's current profile type does not declare the Worker `rename` method; The SDK declares `profiles.rename` as optional; callers check that it exists before using it. A character-creation switch requires the destination profile's own stored permission decisions and `saves:manage`; session decisions from another profile do not qualify. `manage.session.save`, `exitToTitle`, and `quit` each ask on the host dialog before using the game's save and exit path. A failed save refuses the exit. Engine access and raw presentation stay outside this management broker; the presenter paths expose data-only screen replacement.

Workers with `mod:install` get `manage.content.planInstall(source)` and `applyInstall(planId)`; `mod:session` provides `planSession(source)` and `applySession(planId)`. A source is `{ repo: "owner/repository" }`, with the same GitHub tag URLs the player door accepts, or a `Uint8Array` archive. The bootstrap serializes archive bytes as `{ archive: number[] }`; direct messages accept that shape too. An archive is limited to 12 KiB on the wire. Plans contain `id`, `modId`, `repository`, `version`, `digest`, `capabilities`, and `session`. The host retains one plan per Worker API for 60 seconds. Each apply attempt consumes it, including a decline, stale request, or wrong operation. The host dialog names the target id, repository, version, SHA-256 digest, and requested capabilities. The host remeasures its retained bytes after the dialog and refuses any change. A Worker cannot supply grants, a pre-approved plan, or a confirmation id. These runtime content methods need local TypeScript declarations until the SDK adds their types.

Both content paths use the player's archive validators and refuse executable files and all capability declarations. Installs arrive switched off and cannot replace any present mod id. Session packs use the mod-facing loader with `granted: []` and `contentOnly: true`, start on reload, and cannot reuse an installed id even from the same repository. Page-written `neo:sessionMods` records never authorize code or inherit installed consent, key-value storage, or credentials. Session effects on a character can remain after the archive is forgotten. Applying a plan does not reload the game.

`manage.readMod(address)` under `mod:read` returns the discovered metadata and payload file names, with no file text or installation. Repository planning and lookup ask before contacting GitHub. Requests use the existing discovery and install resolution, with only HTTPS `api.github.com` and `raw.githubusercontent.com` destinations under the selected repository, no credentials, a 15-second request timeout, at most 32 fetches, 1 MiB per response, 4 MiB total, and 128 payload files. Browser fetches refuse redirects. Desktop metadata lookups use the native relay's destination, redirect-hop, and DNS checks after native approval for a separate repository identity; they cannot use the calling mod's credentials. A missing or declined native authority fails closed. A metadata reply is limited to 64 KiB. Archive expansion also has a 4 MiB total and 128-entry ceiling. This door does not authorize arbitrary URLs or a mod's own network calls.

`await manage.wizard()` under `debug:wizard` asks on the host dialog and returns a local asynchronous proxy for the existing wizard methods. Each proxy call has its own host confirmation and bounded arguments. Before any wizard reply or command, the host detaches the slot, latches the roster's permanent write surrender, verifies both, and sets `NOSCORE.DEBUG` on the live character. A failed proof returns no wizard access. Even a later slot attachment cannot resume save writes on that page. Reload ends the detached test session. No host function or live engine object crosses the channel.

`manage.options.get/set` reads options and proposes a validated transaction. Every change asks the player, cheat changes disclose their permanent scoring consequence, and the host persists `NOSCORE.DEBUG` and `modNoscore` before changing a cheat option. Birth and score options remain locked. `manage.saves.list` opens a host-drawn picker with unchecked character choices, limited to 128 roster entries. Only selected entries return, with fresh opaque ids that expire on the next selection or profile/session change. A raw slot id never works. `load`, `rename`, and `delete` each ask again; active-slot deletion remains refused after confirmation. `load(id, { resumeAutoplayer: true })` still waits for the separate controller consent dialog at the resumed character's boot.

Under `profiles:manage`, a Worker can read `manage.mods.snapshot()`, which returns only its own `{ id, name }`. It can request `disable`, `setSettingValue`, or `setSectionChoice` for its own id, select itself with `setConflictOverride`, or withdraw third-party consent with `setThirdPartyConsent(false)`. Every mutation uses a host-drawn confirmation naming the caller and changes. The host binds approval to the current measured payload and configuration; a changed plan, revoked grant, or stale epoch refuses the operation. No Worker method records permissions, resolves confirmation ids, enables code, copies scoped storage, or installs mods.

The mod-facing management snapshot, subscription, and refresh responses omit stored consent, settings, payload digests, and pending confirmations. Mods cannot resolve confirmations or change the third-party consent switch. Recording permissions always requests a host decision, even when every requested grant is already held; a session grant never becomes a stored decision through that request alone.

`manage.screens.take({ mods })` draws the mod manager instead of the game's own, under `screens:manage`. Each handler is a function that returns when the player closes the screen, and the game opens it from both the game menu and the title screen. If the handler throws or rejects, the game's own Mods screen opens instead. Name only the screens the mod draws; today the mod manager is the only one a mod can take, and a call that names another is refused. A second mod cannot take a screen that is already held, and the hold ends when the mod stops.


## Worker spawning and shared data

A consenting Worker receives `debug.spawnObject(kind, count?)` and `debug.spawnMonster(race, count?)` under `debug:spawn`. Each call takes a known content id, name, or registry index and a count from 1 to 16. The host asks for every request in a native dialog naming the mod by display name and id, the content, and the count. Declining changes nothing. Before spawning, the host writes `NOSCORE.DEBUG`, `modNoscore`, and the `spawn` consequence to the character's save. A failed writer, revoked grant, changed measured binding, or stale epoch prevents spawning. The host permits four spawn requests per mod per minute and one spawn dialog at a time. Placement stays near the character. `debug:wizard` stays unavailable to Workers.

`shared.read(publisherId, name)` under `shared:read` reads only another mod's explicitly published JSON. It cannot read private preferences, key/value storage, save bags, or the caller's own publications. `shared.publish(name, version, value)` and `shared.withdraw(name)` under `shared:publish` always use the publisher id from the host connection. Publication exposes the value to every other mod holding `shared:read`; recipients can retain it or send it elsewhere using their own grants. Publication transfers no permissions. Each call takes and returns deep copies, with no live references or subscription callbacks.

Worker shared entries have names of 1 to 64 lowercase letters, digits, dots, hyphens, or underscores, starting with a letter or digit. A version is a nonnegative safe integer. Each mod can publish at most 32 entries, each value is limited to 16 KiB of JSON, and reads and writes together are limited to 16 calls per second. The first publication records and persists `shared-write` once per Worker session, without a player dialog or score disqualification. A character with a working save writer is required for that first publication. Both shared and spawn calls also obey the broker's message and reply limits.

The version 1 `capabilityUse` summary retains `spawn` and `shared-write` alongside `controller` and `hidden-information`. Controller history can truncate without truncating the summary. Revocation and mod-bag removal do not clear recorded consequences. Older saves need no migration, and an unknown newer summary schema remains unchanged.

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
| `ctx.profiles`, `ctx.session` | `manage`; Workers receive the bounded operations below |
