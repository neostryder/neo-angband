# Mod API 2

API 2 is the set of calls a mod's code gets from the game: what it can read, what it can do, and what it hears. Every call returns plain data, a permission the player turned down comes back as a result you can check, and reads show the game as the player knows it. The types are in `@rpgm-tools/neo-angband-mod-sdk`, and the in-process host is in the web package (`packages/web/src/mod-api2-host.ts`).

Status: the types, the version check and the in-process host are built, but the folder loader does not run an API 2 mod yet. A manifest at schema 2 declares an `api` range. An in-process mod whose range admits API 1 (`1.0.0`) loads as an API 1 plugin, and one whose range admits only API 2 is refused with the problem that it needs a mod API this build does not provide. `api2Plugin` in `packages/web/src/mod-api2-shim.ts` wraps a definition as an API 1 plugin with `api: 1`, so the existing loader can register it with the same grants and hook composition, but the loader never calls it by itself. The Worker runtime declares the API `2.0.0-worker` and keeps its own message protocol (see `PLUGIN_SANDBOX_DESIGN.md` and `WORKER_ISOLATION.md`). That version is a prerelease, so no stable 2.x range admits it. API 1 plugins run unchanged.

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
| `truth` | Every monster and the real map. The first-party autoplayer only. | None beyond the allowlist |

### What `view` shows

`view` is built from core's known world (`buildKnownWorld`): the monsters the player perceives, with health as the look command words it, the abilities the player has learned, the map as the player remembers it, and items as far as the player has identified them. A monster the player cannot see is not in any part of it, and changing that monster changes nothing a mod can read. A mimic the player takes for an object is not listed as a monster, and while the player hallucinates `monsters` is empty and `monstersHidden` is `"hallucinating"`. A monster's `id` is a handle given out on each level in the order the player first perceives monsters there, not the game's monster index, and the list runs nearest first. Timed effects show the grade name the status line prints, a recall or deep descent shows only that it is active, a recharging item shows the count its name gives (`charging`), `unknownRunes` is the name's `{??}`, and a remembered trap stays as the player last saw it. `world()` returns every part at once, with `null` for each part the mod has no permission for. The single-part calls answer `not-granted` instead.

Each value carries a `token` naming the input wait it was read at. `act.submit` takes that token, and a token from an older wait comes back `refused`. `isCurrent(token)` says whether that wait is still the current one. A `target` intent names its monster by the `id` the view gave it; an id for a monster the player does not perceive now is refused like any monster that cannot be targeted.

A monster's `visible` means eyesight: blindness, darkness and invisibility can leave a sensed monster listed with `visible: false`; infravision and see-invisible count when they let the player see it. A stationary monster first perceived during hallucination receives its sighting notification when the hallucination clears. Remembered item auras use the last observed object properties and the player's current rune knowledge, and remembered traps include only the traps the player perceived.

Shop visits and shop knowledge screens record stock and owner observations, and known-world reads at a shop's entrance refresh that shop. Other shops retain their last observations for the session, or return empty stock and an unnamed owner if they have not been inspected. Loading a game starts with unknown shop observations. A host that draws a shop screen calls `observeKnownStore(state, store)` to record the stock it shows.
### The controller

`act.controller` has `owns()`, `setStatus(status)`, `markNondeterministic()` and `release(reason)`. Every call but `owns()` answers `refused` with the code `not-owner` unless the mod holds the keyboard. An API 2 definition has no member that takes the keyboard; in API 1 that is the plugin's `controller`.

### Panels

`ui.mount` takes the same panel grammar as Worker mods: `text`, `button`, `row` and `column` nodes under a panel `id`. The `id` and each button's `action` are lower-case letters, digits and hyphens, start with a letter, and run to 64 characters at most. A text holds up to 4096 characters, a row or column up to 32 children, and the tree nests up to 16 deep. The host draws the panel, and `onAction` hears the `action` of each button the player uses. `ui.patch` replaces the title (`null` removes it), the tree, or `visible`. A panel outside the grammar, a second panel with an id already mounted, or a patch to a panel that is not mounted comes back `refused` with the code `bad-panel`. A mod in API 2 does not get a DOM element.

## Events

An event arrives only when the player could know about it. `combat-outcome` reports outcomes against the player or a perceived monster in view; attacking an unseen monster does not reveal its position or outcome. A monster appears as `{ monster: id }` when the player perceived it as the event happened and as `"unseen"` otherwise, even when the event removed it (a kill). Movement or healing by a monster the player cannot perceive in view does not arrive. A movement omits `from` when the player did not perceive the monster at its origin before it moved. Damage and healing amounts are given only for the player, as `playerDamage` and `playerAmount`. Suppressed events assign no monster handles, and healing while the player was away from a persistent level emits no event.

| Event | Payload |
| --- | --- |
| `message` | `{ text, type }` |
| `dungeonlevel` | `{ depth, levelId, cause, arena }` |
| `combat-outcome` | `{ attacker, target, kind, hit, died, grid, playerDamage? }` |
| `motion` | `{ who, from?, to, kind }` |
| `heal` | `{ who, grid, playerAmount? }` |
| `player-command` | `{ code, dir?, phase, token }` |
| `driver-changed` | `{ kind: "player" }` or `{ kind: "controller", owner, label?, reason? }`: who holds the keyboard |
| `hp` `mana` `gold` `experience` `playerlevel` `status` | `null` |
| `inventory` `equipment` `monsterlist` `itemlist` | `null` |
| `enter-store` | `null`: the player walked into a shop. |
| `leave-store` | `null`: the player left the shop. |
| `enter-world` | `null`: a game is starting to run. |
| `leave-world` | `null`: the game is stopping. |

A `null` payload is a notice that something changed: read the view for the new value. Level generation, bolts, missiles and explosions have no API 2 event, since they show things the player did not see.

`events.on` answers `refused` with `unknown-event` for a name not in this table, `not-granted` without `event:<name>`, and `unavailable` before a game is running. The listener gets the payload alone.

## Hooks

An API 2 mod declares its hooks in `hooks(context)`. Each one gets plain, frozen data and returns plain data. The host composes them with every other mod's hooks in load order, the same way it composes API 1 hooks.

`messageText`, `screenText`, `characterBackground`, `objectInfoText`, `effectIntro` and `historyDisplay` restate text. `historyAdd` returns `{ keep, what?, expandUserInput? }`, and an entry is written only if every mod keeps it. `objectListTiebreak`, `saveNoiseScent` and `shapeLearnObviousFlagsDirectly` answer a question. `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified` tell the mod something happened.

These API 1 hooks have no API 2 form:

| Hook | Why | Instead |
| --- | --- | --- |
| `newCharacter`, `walkBlockedByDiggable`, `levelGenerated`, `partialStackMerge`, `packOverflowVictim`, `levelRevisited` | They pass live game objects or the whole game state. | An API 1 plugin. |
| `projectionRadius` | It runs for projections the player never sees. | An API 1 plugin. |
| `artifactCommit` | It runs when an artifact is generated, before the player has seen it. | `artifactIdentified` for what the player learns. |

## Storage

`store.prefs.get()` and `set(value)` hold one JSON value per mod, and `set(null)` removes it. A mod that changes the shape of what it stores declares `prefs: { version, migrate(value, fromVersion) }`, with `version` a whole number from 1. The host stores the version beside the value, calls `migrate` once on the first read after an upgrade, and writes the result back. A value stored before the mod declared a version counts as version 0.

`store.character` holds one JSON value in the current character's save, stamped with the manifest's `saveSchema`, and answers `unavailable` until a character exists. `migrateBag(data, fromSchema)` brings it forward when `saveSchema` rises.

## Network and credentials

`net.request({ url, method, headers, body, timeoutMs })` sends a request to a host the manifest names and answers `{ status, headers, body }` whatever the status. A header can hold `mod.net.credential("api-key")` in place of a string. The host puts the stored value in as the whole header value, and the mod never reads it back. `net.credentials` keeps credentials by name: `set(name, value, hosts)` stores one to be sent only to those hosts, `fromEnvironment(name, variables, hosts)` takes it from the first environment variable that is set (desktop app only, and the player is asked), `status(name)` says whether one is set and where it is kept (`os`, `environment` or `page`), and `remove(name)` deletes it. A credential call that fails answers `refused` with the code `credential`.

A request to a host the manifest does not name answers `not-granted` with `network:<host>`. Any other failure is `refused` with a net problem code: `timeout`, `too-large`, `redirect`, `unreachable` or `bad-request`. A credential that is not set gives `secret-missing`, and one not set up for the request's host gives `secret-host`.

## First-party seams

`manage` and `truth` exist only for a mod the loader names first-party, and they are absent from every other mod's API: test `if (mod.truth)` and there is nothing to request. `manage` belongs to the first-party presentation mod. `manage.profiles` lists and creates player profiles, sets which mods a profile enables, and switches profile, under `profiles:manage`. `manage.session` saves, exits to the title screen or quits under `session:control`, without asking the player to confirm, so a mod asks first in its own panel. `truth` belongs to the first-party autoplayer and needs no permission, and no wildcard grant reaches it. `truth.monsters()` lists every monster with exact hit points and speed, and `truth.level()` gives the real map. An autoplayer uses it to plan and still acts through `act`, on what the player knows.

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
