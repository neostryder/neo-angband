<!-- GENERATED from packages/mod-sdk/src/standards.ts and src/checks/rules.ts - do not edit by hand. -->
<!-- Run: node packages/mod-sdk/bin/neo-angband-mod-check.mjs --write-docs -->

# What a mod must provide

Every rule below is code in `packages/mod-sdk/src/standards.ts`. The same function generates these docs, runs when the game installs a mod, and runs when `neo-angband-mod-check` checks your mod before you publish. If a rule changes, the text here changes with it, and a test fails if the two ever disagree.

Check your mod:

```
npx neo-angband-mod-check path/to/your-mod
```

## Required

A mod that fails any of these cannot work, and the game refuses to install it.

### Ship manifest.json at the root of the mod folder

`manifest-present`

It is how the game recognises a folder as a mod at all. A folder without one is not loaded, not listed, and not reported as broken - it is simply not a mod.

### Make manifest.json valid JSON

`manifest-json`

It is read before anything else. A trailing comma stops the whole mod loading.

### Declare id, name, version and shape, and nothing malformed

`manifest-fields`

These four are what the manager lists and what the loader keys everything by. The check uses the game's own validator, so a manifest that passes here passes at install too.

### Say where the mod lives, in `repository`

`declare-a-repository`

It identifies the mod however it was obtained. The game pins an installed mod to the repository it came from and will not let a different one replace it, so a mod that names no repository can be quietly overwritten by anything claiming its id. It is also the only way an update can ever be offered, and the only place a player can go to read about the mod. Archives need it just as checkouts do: a mod handed over as a zip is the same mod, and it should carry the same information about itself as the files fetched from its repository.

### Name the author

`credit-an-author`

The game shows it beside the mod's name, so a player can tell two mods of the same name apart and knows whose work they are about to run. Use the name you want shown. It shares a line with the mod's name and version, so keep it short and put anything longer in `description`.

### Declare the engine range the mod was written against

`engine-range`

Without it the mod is offered to every version of the game forever, including the one that changes something it depends on. With it, a player is told the mod is too old instead of watching it misbehave. Every mod that has shipped declared one, and the mods without one were the ones no check had covered.

### Request only capabilities the game knows

`capabilities-recognized`

A capability string is what the player reads before agreeing to install, and it is the gate the runtime opens. An unrecognized string, or a capability on a pack that cannot run code, is refused when the game loads the plugin, which is after the player has already installed it. This check calls CapabilitySet.fromManifest, the same function the loader calls, so a typo cannot pass here and then fail at load.

### Declare modApi if the mod ships plugin.js

`plugin-declares-modapi`

The host refuses an incompatible plugin before importing it, and it can only do that from the manifest, because a version check inside the module would run after the module's top-level code already had. Without modApi there is nothing to check against, and the mod's code is loaded unchecked.

### Say the mod contains code, if it ships plugin.js

`plugin-declares-facet`

The manager tells a player whether a mod is data or code, and that answer decides how much they are trusting. A mod shipping code while presenting as content is misleading whether or not the author meant it to be.

### Declare committed .zip archives in payload.archives

`archives-declared`

Only the manifest can say whether a .zip is a pack to unpack or a file to store as it is; a file list cannot. An undeclared archive is installed unopened, so the mod is present, listed and enabled, and does nothing.

## Recommended

Advice. None of these blocks an install; all of them are things players notice.

### Publish somewhere the game can check for updates

`updates-can-be-offered`

`repository` may name any host, and the game will install the mod from a zip either way - but the only host it can ASK for newer versions is GitHub. A mod published elsewhere is listed with a note saying it cannot be checked, and its players update it by hand or not at all. This is a limitation of the game, not a judgement about the host.

### Use a version the update check can order

`version-orderable`

Updates are offered by comparing versions. One that cannot be ordered against its predecessor is never reported as newer, so the mod silently stops updating.

### Write a description

`describe-itself`

It is the only thing a player has to decide by, since nothing else in the game knows what the mod does.

### State a licence

`state-a-licence`

A mod with no licence cannot legally be redistributed by anyone, including a player sharing their setup. Converting somebody else's art has its own terms on top of that.

## Fixed checks

`neo-angband-mod-check` also runs the checks below over the mod's archives, payload, manifest, code and records. They live in `packages/mod-sdk/src/checks/`. A `block` finding fails the check; `serious`, `warning` and `note` findings are reported and do not. A finding marked "could not check" covers a part of the mod the checker could not see, which is not the same as a part it found clean.

The game runs the 8 checks marked "run at install" when it installs a mod, and refuses the mod if one of them finds a `block` problem.

### Ship archives the game can open

`checks/archive-unreadable` - block, packaging

A .zip whose directory cannot be read installs nothing, and nothing inside it can be checked.

### Keep every archive entry inside the mod folder

`checks/archive-path` - block, safety

An entry named with `..`, a leading slash, a drive letter or a backslash can write outside the folder it is unpacked into.

### Give each archive entry its own name

`checks/archive-duplicate` - block, safety

Two entries with one name, or names that differ only in case, unpack to one file, and which copy wins depends on the tool that unpacks them.

### Stay within the archive limits

`checks/archive-size` - block, packaging

The game unpacks at most 4,096 entries, 64 MB for one file and 128 MB in all, so a larger archive cannot be installed.

### Make archive headers match what the entries hold

`checks/archive-bomb` - block, safety

An entry that inflates far past its compressed size, past the size its header states, or into bytes another entry also claims is how an archive bomb fills a disk.

### Use plain stored or deflated files in archives

`checks/archive-entry-type` - block, safety

Symbolic links, encrypted entries and other compression methods either point outside the mod or cannot be read and checked.

### Let the checker inflate archive entries

`checks/archive-unmeasured` - warning, packaging, could not check

Without a deflate decoder the checker trusts each entry's stated size, so an entry that lies about it goes unmeasured.

### Use relative paths inside the mod folder

`checks/payload-path` - block, safety, run at install

A payload path that is absolute, uses a backslash, climbs out with `..`, or holds a character a file system refuses cannot be stored safely on every platform.

### Name files so they differ by more than case

`checks/payload-collision` - block, packaging, run at install

Windows and macOS treat `Plugin.js` and `plugin.js` as one file, so one of the two is lost when the mod is copied to a mods folder.

### Stay within the payload limits

`checks/payload-size` - block, packaging, run at install

The game stores at most 4,096 files, 64 MB for one file and 128 MB in all for a mod.

### Ship every file the manifest names

`checks/payload-incomplete` - block, functionality, run at install

A file listed in `payload.files` or `text.locales` that is not there leaves the mod without it, and the default locale has to be one of the listed locales.

### Make the runtime match the code the mod ships

`checks/entry-module` - block, functionality, run at install

A mod that runs code needs its entry module in the payload, and a data mod must not ship scripts the game would never run.

### Ship the screenshots and changelog the listing names

`checks/listing-files` - warning, content

The mod page shows these files, and a missing one leaves a gap where a player expects a picture or the release notes.

### Ask for at most 500 ms per turn

`checks/budget-ceiling` - block, functionality, run at install

`budget.msPerTurn` must be a number above 0 and at most 500; the game switches off a mod that keeps running past its budget.

### Declare a time budget for a mod that runs code

`checks/budget-default` - note, functionality

Without `budget.msPerTurn` a mod gets 50 ms per game turn, and an author who knows the mod needs more should say so.

### Declare an API range this game can run

`checks/api-range` - block, functionality, run at install

The game loads a mod only when its `api` range admits an API version the game implements for the mod's runtime.

### Keep load order consistent with dependencies

`checks/dependency-order` - block, functionality, run at install

A mod loads after its required dependencies, so naming one in `loadBefore`, naming a mod in both `loadAfter` and `loadBefore`, or naming itself makes an order that cannot exist.

### Request only capabilities your runtime can hold

`checks/capability-tier` - block, functionality

Some capabilities exist only for code running in the game's own page, so a Worker mod that asks for one can never be granted it.

### Leave management and hidden-state capabilities to the game's own mods

`checks/first-party-capability` - block, safety

Mod management and the real map under the player's memory are granted only to the first-party mods the game's build names.

### Ship modules the checker can parse

`checks/unparsed-module` - serious, functionality, could not check

A script that does not parse as a JavaScript module cannot be examined, and the game will most likely fail to load it too.

### Import only files the mod ships, by their full name

`checks/missing-module` - block, functionality

A relative import of a missing file, an extensionless path or a path outside the mod folder fails when the game loads the mod.

### Bundle package imports into the mod

`checks/unresolved-import` - serious, functionality, could not check

The game has no import map, so a bare package name does not load, and the checker cannot see the code it would bring in.

### Avoid import cycles between the mod's files

`checks/import-cycle` - serious, functionality

A mod loaded from a picked folder or from storage turns each file into a blob URL, and two files that import each other cannot both get one.

### Import modules by a fixed name

`checks/computed-import` - warning, safety, could not check

A dynamic `import()` of a computed specifier can load anything, and the checker cannot tell what.

### Load code only from the mod's own files

`checks/remote-import` - block, safety

An import from a URL, `data:` or `blob:` address, or through `importScripts` runs code that was never part of the reviewed payload.

### Ship only scripts the entry module uses

`checks/unreachable-code` - note, functionality

A script no import reaches is either dead weight or loaded some way the checker cannot follow.

### Declare every capability the code uses

`checks/undeclared-capability` - block, functionality

A host call that needs a capability the manifest does not request can never be granted, so that part of the mod never works.

### Request the capabilities the code checks for

`checks/capability-feature-test` - note, functionality

The game leaves members such as ctx.installMod out unless the manifest requests their capability, so code that tests for one first never runs without that request.

### Reach the mod API by fixed property names

`checks/computed-context-access` - warning, functionality, could not check

Reading `ctx[name]` or `host[name]` hides which host call is made, so the checker cannot match it to a capability.

### Keep the mod API in code the checker can follow

`checks/context-escapes` - warning, functionality, could not check

Passing `ctx` or the registry host to code outside the mod's own functions, or storing it where the checker cannot track it, hides the calls made through it.

### Default-export the plugin as an object

`checks/plugin-shape` - warning, functionality, could not check

The checker finds the methods the game calls through the entry module's default export, and without them it cannot tell which code receives the mod API.

### Keep the code within what the checker can trace

`checks/analysis-limit` - warning, functionality, could not check

The checker stops tracing after a fixed number of passes, and anything it did not reach is unchecked.

### Declare the same API in the code and the manifest

`checks/api-mismatch` - block, functionality

The game reads the API from the manifest and the plugin states it again in its `api` field, and a mod whose two answers disagree is refused when it loads.

### Do not run strings as code

`checks/dynamic-eval` - block, safety

`eval`, the `Function` constructor and string timers run code that is built at run time, which no review of the shipped files can see.

### Do not add script elements to the page

`checks/script-injection` - block, safety

A script element loads and runs code outside the mod's own modules, past every check on them.

### Do not start workers of your own

`checks/nested-worker` - serious, safety

A worker the mod starts runs outside the host's broker, so its network and storage use are not limited by the mod's capabilities.

### Send network requests through the mod API

`checks/direct-network` - serious, safety

`fetch`, `XMLHttpRequest`, WebSocket and the like skip the host broker, so neither the declared hosts nor the redirect limit applies to them.

### Declare every host the mod sends requests to

`checks/undeclared-network-host` - block, functionality

The host refuses a request to any host the manifest's `network:` capabilities do not cover.

### Use request URLs the checker can read

`checks/network-destination` - warning, safety, could not check

A URL built at run time cannot be compared with the declared hosts until the request is made.

### Use https for hosts outside this computer

`checks/insecure-transport` - warning, safety

A plain http request to a remote host can be read and changed by anyone on the network path.

### Keep keys and tokens out of the code

`checks/credential-in-code` - serious, safety

A key written into a script is readable by everyone who installs the mod; keep it in the host's secret store and refer to it as `{secret:name}`.

### Send credentials in headers, not URLs

`checks/credential-in-url` - warning, safety

A key or token in a query string ends up in server logs and redirect chains.

### Bind secrets only to hosts the manifest declares

`checks/secret-host` - block, functionality

The host refuses to keep a secret for a host the mod cannot reach, and a `{secret:...}` template must name a secret in lower-case words joined by hyphens.

### Ship JavaScript rather than WebAssembly

`checks/webassembly` - serious, safety

Compiled WebAssembly cannot be read as source, so a review of the mod cannot say what it does.

### Ship readable code

`checks/obfuscation` - serious, safety

Obfuscator-style names, strings written almost entirely in escape codes and text assembled from character codes hide what a script does from anyone reviewing it.

### Ship unminified code

`checks/minified-code` - warning, safety

Minified scripts are hard to review line by line; `neo-angband-mod-build` writes readable output.

### Check records against the base game

`checks/composition-unchecked` - note, content, could not check

A record, patch or removal means something only next to the game's own data and the mod's dependencies, so when the checker cannot find those it skips this part and says so.

### Make every patch, replacement and removal apply

`checks/composition-refused` - block, content

The loader refuses an operation whose target is missing or not the mod's to change, including a removal that would leave a reference dangling.

### Name only records that exist after composition

`checks/dangling-reference` - serious, content

A record that names a monster, item or chart the composed game does not have can fail when that part of the game is reached.

### Keep every history chart complete

`checks/history-chart` - block, content

Character creation rolls 1 to 100 on each chart and follows `next` to another chart, so a chart with no phrase at 100 or a link to a missing chart breaks it.

### Write records the game's blueprints recognise

`checks/record-check` - warning, content

The loader reports a record whose fields do not match what the game's own data uses, and the mod loads anyway.
