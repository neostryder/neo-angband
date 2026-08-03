<!-- GENERATED from packages/mod-sdk/src/standards.ts - do not edit by hand. -->
<!-- Run: node packages/mod-sdk/bin/neo-angband-mod-check.mjs --write-docs -->

# What a mod must provide

Every rule below is CODE, in `packages/mod-sdk/src/standards.ts`. The same
function that generated this page is the one the game runs when it installs a
mod, and the one `neo-angband-mod-check` runs for you before you publish. So
this page cannot fall behind the game: if a rule changes, this text changes with
it, and a test fails if it does not.

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

These four are what the manager lists and what the loader keys everything by. The check is the game's OWN validator, so this cannot pass here and fail there.

### Declare modApi if the mod ships plugin.js

`plugin-declares-modapi`

The host refuses an incompatible plugin BEFORE importing it, which it can only do from the manifest - a version check inside the module runs after the module's top-level code already has. Without modApi there is nothing to check against, and the mod's code is loaded on faith.

### Say the mod contains code, if it ships plugin.js

`plugin-declares-facet`

The manager tells a player whether a mod is data or code, and that answer decides how much they are trusting. A mod shipping code while presenting as content is misleading whether or not the author meant it to be.

### Declare committed .zip archives in payload.archives

`archives-declared`

Nothing can tell from a file list whether a .zip is a pack to UNPACK or a file to store as-is - only the manifest can say. An undeclared archive is installed unopened, so the mod is present, listed, enabled, and does nothing.

## Recommended

Advice. None of these blocks an install; all of them are things players notice.

### Declare the engine range the mod was written against

`engine-range`

Without it the mod is offered to every version of the game forever, including the one that changes the thing it depends on. With it, a player is told the mod is too old instead of watching it misbehave.

### Use a version the update check can order

`version-orderable`

Updates are offered by comparing versions. One that cannot be ordered against its predecessor is never reported as newer, so the mod silently stops updating.

### Write a description

`describe-itself`

It is the only thing a player has to decide by, since nothing else in the game knows what the mod does. A row with no description is a row nobody installs.

### State a licence

`state-a-licence`

A mod with no licence cannot legally be redistributed by anyone, including a player sharing their setup. Converting somebody else's art has its own terms on top of that.

