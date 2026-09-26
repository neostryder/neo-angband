<!-- GENERATED from packages/mod-sdk/src/standards.ts - do not edit by hand. -->
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
