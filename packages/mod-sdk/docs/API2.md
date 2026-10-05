# Mod API 2

API 2 is the set of calls a mod's code gets from the game: what it can read, what it can do, and what it hears. Every call returns plain data, a permission the player turned down comes back as a result you can check, and reads show the game as the player knows it. The types are in `@rpgm-tools/neo-angband-mod-sdk`, and the in-process host is in the web package (`packages/web/src/mod-api2-host.ts`).

Status: the types, the version check and the in-process host are built. The folder loader still loads API 1 plugins, and an API 2 mod reaches it wrapped as one (`api2Plugin` in `packages/web/src/mod-api2-shim.ts`). A manifest has no `api` field yet, and the Worker runtime keeps its own message protocol (see `PLUGIN_SANDBOX_DESIGN.md`). API 1 plugins run unchanged.

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

`view` is built from core's known world (`buildKnownWorld`): the monsters the player perceives, with health as the look command words it, the abilities the player has learned, the map as the player remembers it, and items as far as the player has identified them. A monster the player cannot see is not in any part of it, and changing that monster changes nothing a mod can read. A mimic the player takes for an object is not listed as a monster, and while the player hallucinates `monsters` is empty and `monstersHidden` is `"hallucinating"`. A monster's `id` is a handle given out on each level in the order the player first perceives monsters there, not the game's monster index, and the list runs nearest first. Timed effects show the grade name the status line prints, a recall or deep descent shows only that it is active, a recharging item shows the count its name gives (`charging`), `unknownRunes` is the name's `{??}`, and a remembered trap stays as the player last saw it. `world()` returns every part at once, with `null` for each part the mod has no permission for. The single-part calls answer `not-granted` instead.

Each value carries a `token` naming the input wait it was read at. `act.submit` takes that token, and a token from an older wait comes back `refused`. A `target` intent names its monster by the `id` the view gave it; an id for a monster the player does not perceive now is refused like any monster that cannot be targeted.

A monster's `visible` means eyesight: blindness, darkness and invisibility can leave a sensed monster listed with `visible: false`; infravision and see-invisible count when they let the player see it. A stationary monster first perceived during hallucination receives its sighting notification when the hallucination clears. Remembered item auras use the last observed object properties and the player's current rune knowledge, and remembered traps include only the traps the player perceived.

Shop visits and shop knowledge screens record stock and owner observations, and known-world reads at a shop's entrance refresh that shop. Other shops retain their last observations for the session, or return empty stock and an unnamed owner if they have not been inspected. Loading a game starts with unknown shop observations. A host that draws a shop screen calls `observeKnownStore(state, store)` to record the stock it shows.

### Panels

`ui.mount` takes the same panel grammar as Worker mods: `text`, `button`, `row` and `column` nodes under a panel `id` of lower-case words joined by hyphens. The host draws it, and `onAction` hears the `action` of each button the player uses. A mod in API 2 does not get a DOM element.

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
| `driver-changed` | who holds the keyboard |
| `hp` `mana` `gold` `experience` `playerlevel` `status` | `null` |
| `inventory` `equipment` `monsterlist` `itemlist` | `null` |
| `enter-store` | `null`: the player walked into a shop. |
| `leave-store` | `null`: the player left the shop. |
| `enter-world` | `null`: a game is starting to run. |
| `leave-world` | `null`: the game is stopping. |

A `null` payload is a notice that something changed: read the view for the new value. Level generation, bolts, missiles and explosions have no API 2 event, since they show things the player did not see.

## Hooks

An API 2 mod declares its hooks in `hooks(context)`. Each one gets plain, frozen data and returns plain data. The host composes them with every other mod's hooks in load order, the same way it composes API 1 hooks.

`messageText`, `screenText`, `characterBackground`, `objectInfoText`, `effectIntro` and `historyDisplay` restate text. `historyAdd` returns `{ keep, what?, expandUserInput? }`, and an entry is written only if every mod keeps it. `objectListTiebreak`, `saveNoiseScent` and `shapeLearnObviousFlagsDirectly` answer a question. `optionsChanged`, `abilityGained`, `monsterBecameVisible` and `artifactIdentified` tell the mod something happened.

These API 1 hooks have no API 2 form:

| Hook | Why | Instead |
| --- | --- | --- |
| `newCharacter`, `walkBlockedByDiggable`, `levelGenerated`, `partialStackMerge`, `packOverflowVictim`, `levelRevisited` | They pass live game objects or the whole game state. | API 1, until each gets a policy or a declaration in content. |
| `projectionRadius` | It runs for projections the player never sees. | API 1 for now. |
| `artifactCommit` | It runs when an artifact is generated, before the player has seen it. | `artifactIdentified` for what the player learns. |

## Storage

`store.prefs.get()` and `set(value)` hold one JSON value per mod. A mod that changes the shape of what it stores declares `prefs: { version, migrate(value, fromVersion) }`. The host stores the version beside the value, calls `migrate` once on the first read after an upgrade, and writes the result back. A value stored before the mod declared a version counts as version 0.

`store.character` holds one JSON value in the current character's save and answers `unavailable` until a character exists. Bring its shape forward with `migrateBag`.

## Network and credentials

`net.request({ url, method, headers, body })` sends a request to a host the manifest names. A header can hold `mod.net.credential("api-key")` in place of a string. The host fills in the value, and the mod never sees it. `net.credentials` sets, checks and removes credentials by name. A request to a host the manifest does not name answers `not-granted` with `network:<host>`. Any other failure is `refused` with one of the net problem codes (`timeout`, `too-large`, `redirect`, and the rest).

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
