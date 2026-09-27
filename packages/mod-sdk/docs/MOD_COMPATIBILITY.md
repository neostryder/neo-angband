# What an engine release may break, and what it may not

If you publish mods, you want to know which of them stop working when the game updates, and what you have to do about it.

> A mod that is pure data should survive engine releases without being republished. A mod that ships code should survive patch and minor releases, and get a release's warning before an ABI change strands it. That ABI includes a named subset of `ctx.core`; the rest of that namespace is an escape hatch.

These rules date from 2026-08-02. Before then, three of the four gates below were stricter than they needed to be, and the fourth, `ctx.core`, had no gate at all.
## The four things that can strand a mod

| # | Gate | What it judges | On failure |
|---|---|---|---|
| 1 | `engine` | a semver range over `ENGINE_VERSION` | **warns** for data, **refuses** code |
| 2 | `modApi` | the plugin ABI, an integer | refuses outside the accepted window |
| 3 | a patch target | one `patches` / `fieldPatches` / `removes` ref | **skips that op**, keeps the mod |
| 4 | `ctx.core` | a guaranteed name disappearing; any other export a plugin actually calls | nothing happens at load time. A guaranteed name can only be removed from the engine with an alias or a two-release ABI bump; see below. |

### 1. `engine` is a label on data and a gate on code

`engine` records which builds the author tested, and for a data pack the game treats it as information only. Until 2026-08-02 the host refused any pack outside its range, so a pack of pure JSON stopped loading over one string in its manifest.

The range only blocks a pack that ships code. The game tells the two apart by `modApi`, which the manifest requires of every pack with a `plugin.js` and of no other. Code is what breaks across a release, because it calls functions and a renamed function is a crash. Tile packs count as data: a stale mapping loses individual tiles to the ASCII fallback, which the player can see, and that is better than a whole tileset failing to load.

**What to write.** A minimum, not a caret:

```json
"engine": ">=0.13.0"
```

On a `0.x` version, `^0.13.0` means 0.13.x only, so it excludes 0.14.0 and earns the mod a warning on every minor release. Use a two-sided range only when the mod is known to break above some version. A data pack can leave the field out entirely; the core content pack comes close to that with `">=0.1.0"`.

#### A range this build fails is no longer the end of the road

Until 2026-08-21, a code pack whose newest release declared a range outside this build was refused outright. The row read `will not run on this version`, even when the same repository held an older release that would run. You could install that release by pasting a `github.com/owner/repo/tree/<tag>` URL into **Add from a repository address**, but the game never looked for it or mentioned it.

Discovery now walks a repository's tags newest first and offers the newest release this build will run. The walk follows these rules:

- **The loader's own rule judges each candidate**, so any version a screen offers is one the loader accepts. The install screen and *Update installed mods* share the same walk, so they cannot disagree about what runs.
- **Usually only one manifest is read.** The walk stops at the first candidate it accepts, which is nearly always the newest release, so a mod that keeps up costs no more than before. Manifests come from `raw.githubusercontent.com`, which is unmetered, rather than from the GitHub API, whose limit of sixty requests an hour a single screen of mod rows could use up.
- **The walk stops after eight versions** (`MAX_VERSIONS_TRIED`). If a mod's last eight releases all want a newer game, the refusal tells the player to update the game and says how many releases were tried.
- **A pinned tag is never walked past.** If the player named a version and it will not run, the pin is refused rather than swapped for a different release.
- **A data pack out of range is not walked past either,** because gate 1 lets it load. Its newest release is offered, with the warning about the range.
- **The skipped release is named.** The row, the detail pane and the refusal screen all say which newer release was passed over and why. Without that, a player offered 0.14.4 while the mod's front page shows 0.15.0 would assume the game or the listing is broken, when 0.15.0 simply wants a newer game.
- **"Update the game" appears only when a newer game would help.** Gate 1 does not say which side is behind, since `>=0.24.0` wants a newer game and `<0.5.0` wants an older one. A screen offering an older release answers that question separately by probing: `newerGameCouldRun` tries the next nine patches, the next nine minors and the next nine majors above the running version, plus one far-future version for an open upper bound. If none of those satisfies the range, the screen names both versions and gives no advice.
- **No update is offered that the loader would refuse.** *Update installed mods* counts only releases that run on this build, so a mod already on the newest runnable release shows as current rather than out of date. Beside that, the screen shows how many mods have a newer release waiting on a newer game.
- **If a manifest cannot be read, the update is still offered.** One failed request is no evidence that the release will not run. The install path repeats the walk over a live connection and steps back to an older release there if it needs to.

**What this means for authors.** A range stricter than the mod needs now costs players your newest release instead of the whole mod. That still hurts, so only write a two-sided range you mean. It also means a corrected range in a new release reaches players straight away, because the walk finds it without the game having to update first.
### 2. `modApi` accepts a window

`MOD_API_VERSION` is what this host implements; `MOD_API_MIN` is the oldest it
still accepts. Everything in between loads, and anything below the current
version is reported to its author as running on a compatibility path.

Until 2026-08-02 the check was `declared !== MOD_API_VERSION`, so the day the number moved, every mod stopped loading at once, before any author could react and whether or not the change affected them.

**A bump now takes two releases:**

1. Ship the new behaviour. Leave `MOD_API_MIN` where it is. Keep honouring the old contract for plugins that declared the old number; `LoadedModPlugin.api` carries what each one declared, which is what makes that possible. Authors start seeing the deprecation line.
2. Raise `MOD_API_MIN`. Delete the old path.

If a change cannot be conditioned on the declared version, both constants move in one step. A test fails when the two constants stop making sense together.

### 3. A missing patch target costs the patch, not the mod

A `fieldPatch` aimed at a record that no longer exists used to throw, and the host answers a throw by dropping the whole pack. A mod patching forty monsters lost all forty, along with its code, its rules and its tiles, because one of the forty had been renamed.

Now it is one reported line on that mod's row, and the rest of the pack still applies. The line suggests the target may have been renamed, since that is the likeliest cause.

The composer's other merge path always behaved this way. Of core's 44 record files, 20 take a "passthrough" path that reported and carried on, and 24 take a "composable" path that threw. The split was never chosen; it follows from the shape of core's own records.

A patch can apply cleanly and still name something that does not exist. Until 2026-08-20 that was worse than a missing target, because the composer accepted it and the binder threw. Store stock tables made this common: `append` exists so mod A can stock an item that mod B defines, tutorial 2 teaches exactly that patch, and disabling mod B left an appended line in the `normal` table naming nothing. `bindStore` threw `store: unknown sval` from inside `bindCore`, which the host runs at module top level, so one line in one shop's stock table brought up the crash screen instead of the game.

Binders now apply gate 3's rule: the line is dropped, the mod is told on its own row, and the rest of that store and every other store are untouched. Core's own data still throws. Record provenance tells the two apart: an unresolvable entry in a store no pack has touched is core's mistake and fails loudly, and in a game with no mods that covers every store.

This covers every field of a store record that a patch can reach. `normal`, `always` and `buy` each lose only the entry that resolved to nothing. The `store:` entrance feature is a scalar, so there is no single entry to drop: the record stays with an entrance that matches nothing, the shop cannot be entered, and the mod is told. The record stays in the store list because that list is read by position, and removing one would renumber every later store and move a saved game's stock between shops.
The owner list resolves no names, so it has no per-entry miss to drop, but the field can go missing entirely. That is a different failure from the wrong-shape case the composer handles (see "A patch cannot make a field unreadable" below). A `replaces` body on a record a mod owns may drop `owner:` as part of a total conversion, and the composer's shape guard does not restore an absent field, so `owner: undefined` used to reach `rec.owner.map` as a bare `TypeError` naming no pack. The store binder now guards the field itself: a missing or malformed owner list becomes an empty list and is reported against whichever pack is responsible, like every other field on the record (#8).

**A patch cannot make a field unreadable.** The record check already tested shape on the load path with `field/type`, but that check only reports, because the blueprint it reads is a measurement of core's records and a value outside it can be legal (a mod inventing a new tval is using the mod system as intended). That works for scalar values and fails for lists: every binder reads a list field by iterating it, so a list field holding a string, a number or `null` becomes a `TypeError` inside `bindCore` inside `startGame`, and one field brings up the crash screen. The composer now refuses that one case: the field goes back to what the record had before, the pack is told on its own row, and the rest of the patch applies.

It leaves two cases alone:

- A scalar of the wrong type is only reported. `weight` as `"40"` is readable, some binders coerce it, and the measurement cannot prove it is wrong.
- A field the patch removes is not put back. Dropping fields is how a total conversion works: `replaces` swaps the whole record, and a monster rewritten as `{name, hp}` has no `flags`. Restoring the field would undo a supported feature. An absent required field is reported (`field/required`). Refusing a record that the mod itself owns is the binders' job, and the store binder's `owner:` guard above does that where it is reachable today.

Egos get the same treatment as stores. An ego's `item:` list names specific base kinds and accepts the same `append`, so it had the same defect and now behaves the same way: the line is dropped, the ego keeps its other candidates, and the mod is told. The core-versus-mod check lives in one shared `fieldOwner` in `packages/core/src/mod/refusal.ts`, so two binders cannot judge the same provenance differently. Any binder that resolves names from a list a mod can append to should use it rather than a rule of its own.
A pass over every binder (#8) found six more cases of the same shape and fixed them the same way: an artifact's `flags:` and `values:` tokens, a curse's `type:` entries, a monster's `base:` (the whole race, like the artifact's `base-object:`), `friends-base:`, `friends:` and `shape:` (one entry each), and a terrain feature's `mimic:`. Two fields did not need it. An artifact's `act:` resolves the way upstream's `findact` does, silently to nothing, and it does that on core's own data too, so refusing a mod's version would make the same mistake louder for mods than for core. The trap binder resolves no names from an appendable list, only from fixed compiled tables.

`composePacks`'s `fieldPatches` loop also called `applyFieldPatch` without going through `refuse()`, so a malformed op (an `append` with `value` instead of `values`, say) took down the whole pack, or every installed mod when the raw error named none of them. It is now refused the same way a missing patch target is.
### 4. `ctx.core` is handed over whole; a named subset of it is guaranteed

`ModPluginContext.core` is the live core module namespace: the whole engine, 1,974 runtime exports, rather than a curated slice that would drift out of date. `packages/core/mod-api-surface.json` records the surface, and `mod-core-surface.test.ts` fails on any difference in either direction, so every removal and every addition shows up as a diff.

`MOD_API_VERSION` does not cover this namespace. It versions the plugin contract itself: the members of `ModPlugin`, what the host passes, and when it calls them. A core function can be renamed without changing any of that, so the number a mod author checks says nothing about the functions their plugin calls most.

The namespace is too wide to promise all of it: forbidding the removal of any of 1,974 names would freeze the port. First-party plugins call 23 of those names at runtime, and those 23 are the part of `ctx.core` that the compatibility promise covers.
| Export | `typeof` | Called by |
|---|---|---|
| `DDGRID` | object | feature-restoration |
| `FEAT` | object | bug-fixes, borg |
| `MON_RACE_FLAG_ENTRIES` | object | borg |
| `MON_SPELL_ENTRIES` | object | borg |
| `OptionState` | function | qol |
| `REST_COMPLETE` | number | borg |
| `RSF` | object | borg |
| `Rng` | function | borg |
| `TV` | object | borg |
| `describeLookGrid` | function | qol |
| `gearObjectForUse` | function | feature-restoration |
| `knownPile` | function | qol |
| `loc` | function | bug-fixes |
| `movementTunnelTest` | function | qol |
| `parseTilePrefs` | function | upstream-catchup |
| `placeStairs` | function | bug-fixes |
| `playerConfuseDir` | function | feature-restoration |
| `setPrefErrorPolicy` | function | qol |
| `squareIsEmpty` | function | bug-fixes |
| `squareIsNoStairs` | function | bug-fixes |
| `squareIsVisibleTrap` | function | qol |
| `squareNumWallsAdjacent` | function | bug-fixes |
| `tunnelAux` | function | qol |

By mod, qol calls 7 of these, bug-fixes 6, borg 7, feature-restoration 3 and upstream-catchup 1. linoleum and forge call none: linoleum reaches the game through `host.tiles` and `ctx.registries`, and forge holds `ctx.core` without reading a name from it.

`packages/core/mod-core-guaranteed.json` holds the list, and `mod-core-guaranteed.test.ts` fails if any of those names is missing from the namespace a plugin receives or its `typeof` has changed. Removing one is a compatibility break that needs either an alias under the old name or the two-release `modApi` path; updating `mod-api-surface.json` alone does not cover it.
Everything else on `ctx.core` is an escape hatch. A plugin may call it, but a rename or removal of an unguaranteed name can ship in any release, recorded in the table below. Use a seam (`ModHooks`, `ctx.registries`, a capability-gated facade) when one exists; calling an unguaranteed name ties the plugin to that engine release.

For the rest of the namespace, the only mechanism is the ratchet described above: `packages/core/mod-api-surface.json` records every runtime export, and `mod-core-surface.test.ts` fails when the set changes in either direction.

- A removal or rename of an unguaranteed name fails CI and lists the names. The fix is to keep the old name as an alias, or to record the break in the removals table below and ship it. A guaranteed name cannot take the second route.
- An addition also fails, and the fix is one command: `node tools/api-surface.mjs --update`. Additions have to be recorded because an export added in one release and removed in the next would otherwise never appear in the baseline, and its removal would go unnoticed.

#### There are two such namespaces now, watched the same way

`ctx.authoring` is the mod SDK's public barrel, 94 runtime exports, handed over whole for the same reason as `ctx.core`: a curated subset would be a second list to maintain, and it would lag behind whatever function an author needs next. It has the ratchet but no guaranteed subset.

Before plugins received it, a rename inside the SDK was caught by `tsc -b` over this repository, because every consumer was in the repository. A plugin ships as built JavaScript and resolves no specifier, so the compiler never sees its calls. The SDK therefore gets the same ratchet as core: `packages/mod-sdk/mod-sdk-api-surface.json` records the surface, `mod-authoring-surface.test.ts` fails on a change in either direction, and `node tools/api-surface.mjs` checks and updates both baselines in one run.

The SDK barrel names its exports one by one instead of re-exporting everything: `applyFieldPolicy` is left out of its `index.ts`, and a comment there says why. A removal from the barrel is recorded in the table below on the same terms as a core removal.

#### Additions, which strand nobody

An added `ctx` field cannot break an existing plugin, because a plugin never reads a name it does not know about. `MOD_API_VERSION` does not move for one (its doc comment says so), and additions are listed here so authors can find them.
| Version | Field | What it is |
|---|---|---|
| unreleased (2026-08-22) | `ctx.authoring` | The mod SDK's public barrel: blueprints, `peersFor`, `suggestFields`, `checkRecords`, `ModProject` and the rest of the authoring stack. Always present, since these are pure functions over data the caller supplies and need no boot state. Not capability-gated, for the same reasons `capability-gate-reach.test.ts` records for `ctx.core` and `ctx.registries`: nothing here reads game state or mutates a registry, and anyone can get every name by installing the published npm package. |
| unreleased (2026-08-22) | `ctx.composedRecords` | Every content record the running game was composed from, as JSON, keyed by pack-file stem without the extension. It is the unbound counterpart of `ctx.registries` and the shape the authoring functions above accept. `registries.monsters.races` is bound, so it has neither the JSON key names nor the fields that bound to nothing, and a peer table cannot be built from it. Mod-added records appear on the same terms as core's, each with its provenance. Absent during content composition, for the same reason `registries` is. |
| unreleased (2026-08-22) | `ctx.reloadGame` | The game's own mod-change reload, so a mod that installed something can apply it: every plugin's `uninstall()` runs, the autoplayer hands the keyboard back, the live character's state is recorded, and the session resumes that character instead of returning to the title screen. It sits behind `mod:install` rather than a capability of its own, because content composes at load, and an install that cannot be followed by a reload leaves the player with something the running game will never load. A plugin can already reach `location` without any grant, so this adds no new power to reload; it performs the four steps a mod cannot take for itself. |
| unreleased (2026-08-22) | `ctx.installMod(...).lines` | A field on both arms of the existing install outcome: the wording the Mods screen prints for that outcome, including one row per unmet requirement with the author's advice under each. A mod built in the game fails a requirement in the same words as a downloaded mod. `problem` is unchanged and is still one complete sentence. |
| unreleased (2026-09-01) | `ModRegistryHost.menus.addAction` | A capability-gated additive companion to `menus.register`: a plugin declaring `registry:menu` can add one labelled, namespaced callback row to `core:game-menu`. Existing menu transformers keep their behaviour, and an existing plugin neither calls nor observes the new method, so this is a backward-compatible API addition and does not move `MOD_API_VERSION`. |
| unreleased (2026-09-05) | `ctx.keymaps.entries`, `.rebind`, and `.remove` | The existing `keymap:write` facade now records an owner for each binding it creates. A mod can enumerate, replace, and remove only its own bindings in the active keyset; it cannot learn, overwrite, or remove player bindings or another mod's. Player keymap edits clear a claim, and the mod-change teardown removes claims that remain, so a disabled mod has no surviving keyboard binding. Existing `bind` remains free-trigger-only, so this is a backward-compatible API addition and does not move `MOD_API_VERSION`. |
| unreleased (2026-09-02) | API-2 Worker ABI | `modApi: 2` plus `runtime: "worker"` and a mod-relative `workerEntry` selects a dedicated module Worker booted by host code, instead of importing `plugin.js` into the renderer. Its independently versioned protocol starts with immutable init data, logs, async preferences, own-asset bytes, bag migration, semantic commands, render-coalesced state and display snapshots, and host-rendered declarative panels. The intended final surface also adds versioned read snapshots, host-cached policies for synchronous paths, async hook decisions with validated patches, declarative registry/content and tile declarations, cached frontend/HUD/region display lists, semantic keymap/debug/wizard/storage operations, and mediated mod lifecycle actions. API-1 remains as trusted compatibility code for now; the plan is to move every shipped mod to API-2 rather than keep both APIs permanently. |

#### Removals taken knowingly

Four of the six rows are one removal: the parse-error limit, which had no counterpart in Angband 4.2.6 and so did not belong in a port. `fillTilesFromKin` is the same kind of removal, and the first of these to have shipped in a release.

| Version | Export | Why | What to use instead |
|---|---|---|---|
| unreleased (2026-08-12) | `optionFileErrorMessage` | Its whole subject is gone. The custom-options reader was a port of upstream **master**'s `struct parser` grammar; #149 rewrote it to 4.2.6's hand-rolled read loop, which has no `parser_state` to format - it emits three plain `msg()` lines instead. | `prefErrorMessage` (`visuals/prefs.ts`), which formats the identical `Parse error in %s line %d column %d: %s: %s` from the same `ParserState`. It was always the same function; this one was the duplicate. |
| unreleased (2026-08-14) | `PARSE_ERROR_LIMIT` | The port's own cap of 20 parse errors per file. A citation sweep (#268) found no `PARSE_ERROR_LIMIT`, no `get_parser_error_limit` and no error COUNT anywhere in 4.2.6 - `process_pref_file_named` (`ui-prefs.c` L1225-1231) `break`s on the FIRST bad line - so it was an improvement the port had added, and the port adds nothing (#272). | Nothing in core: the number was never a fact about Angband. A mod that wants a cap chooses its own and passes it as `PrefErrorPolicy.reportLimit` to `setPrefErrorPolicy` (`visuals/prefs.ts`). The `qol` mod uses 20, so a player sees the familiar behaviour. |
| unreleased (2026-08-14) | `getParserErrorLimit` | The reader for the above, including a `PARSE_ERROR_LIMIT` environment override that no upstream build has. Removed with its subject (#272). | `prefErrorPolicy()`, which answers with the policy in force - `UPSTREAM_PREF_ERROR_POLICY` unless a mod installed another. It answers a richer question, because one number could not express both "keep reading" and "keep reporting". |
| unreleased (2026-08-14) | `setParserErrorLimit` | The test seam for the above. Nothing in the game ever called it, and its subject is gone (#272). | `setPrefErrorPolicy(policy \| null)`, which is a real seam rather than a test hook: it is the documented way a mod changes what a bad pref line costs, and `null` restores 4.2.6's behaviour. |
| unreleased (2026-08-14) | `parseParserErrorLimitEnv` | Parsed `PARSE_ERROR_LIMIT` out of the environment with C's `strtol` rules, so a host could set the cap without owning the rule. There is no cap and no environment variable (#272). | Nothing. A mod that wants its policy configurable owns that decision, and `ctx.prefs` is where a mod keeps a player's answer to it. |
| 0.23.0 | `fillTilesFromKin` | The port's own rule that a mod-added monster with no tile is drawn with the tile of a race sharing its `base`, and an added object kind with a kind sharing its `tval`. Shipped in 0.22.0 and removed in 0.23.0: 4.2.6 has no concept of a mod-added record and so no opinion about how one should look, and borrowing the lowest-index relative's picture is a style choice rather than ported behaviour. It also made that choice for tile sets the game does not own: a pack drawn in 2003 has no art for content added twenty years later, and a sibling's picture there misleads where a plain letter does not. The port adds nothing (#272). | It became a seam, `registry:tiles`. A tileset mod registers a filler through `host.tiles.register`, reads what the game contains through `ctx.registries`, and writes through `TileFill`, which rejects any tile that something else already assigned. `neo-linoleum` 0.15.0 carries the rule that used to live here, applied to linoleum packs only. Its three supporting types were removed with it (`KinTileDeps`, `KinTileFill`, `KinTileDerivation`); as types, they never appeared in the surface list. |

`parseCustomOptionsText` keeps its name but changed shape on 2026-08-12. It returns `string[]` (the messages) instead of `ParserState[]`, and its fourth parameter, `errorLimit`, is gone because 4.2.6's reader has no error cap. A plugin calling it for its own diagnostics gets a type error at build and a different array at runtime. There is no alias, because the call now returns different data and an alias could not give back the old result.

`CellView.trap` keeps its name but changed meaning (unreleased, 2026-08-21). It used to mean "this grid holds any trap record"; it now matches `square_isdisarmabletrap`, a visible player trap that is not already disabled.

The field was changed in place, with no second field alongside it, because the old value was simply wrong. The trap list also holds a closed door's lock (`square_set_door_lock`, flagged `LOCK | INVISIBLE`), a glyph of warding, a web and a decoy. None of those is a trap the player can see or that `disarm` will act on, so a mod reading the old field saw a locked door as something to disarm. `disarm` refuses it without spending a turn, so a mod that kept choosing to disarm would hang. The old meaning also broke the rule stated on the neighbouring `trapGlyph`: a trap the player has not found is not on the screen, so it is not in the view.

**What to do about it.** A mod that used `trap` to decide whether to disarm needs no change and no longer hangs. A mod that used it to ask whether anything in the trap list is here (a map overlay counting glyphs of warding, say) now gets `false` for a glyph and should read `trapGlyph` instead, which is present for every trap the player can see, glyphs included.

`ProcessPrefOptions` changed shape for the same reason (#272, unreleased 2026-08-14): `errorLimit?: number` is now `errorPolicy?: PrefErrorPolicy`. A plugin that called `processPrefText(text, deps, sink, { errorLimit: 0 })` gets a type error at build, and the fix is `{ errorPolicy: { continueAfterError: true, reportLimit: 0 } }`. There is no alias, because one number mixed up "stop applying the file" with "stop collecting errors", and only the second is something a player wants capped. Four names arrived with it: the type `PrefErrorPolicy`, which as a type never appears in the surface list, and the runtime exports `UPSTREAM_PREF_ERROR_POLICY`, `prefErrorPolicy()` and `setPrefErrorPolicy()`.
`msgt(sinks, type, text)` keeps its name and signature but no longer touches `sinks.sound` (#239, unreleased 2026-08-13). It used to call both sinks itself; the host's `msg` sink is now `msgt`, so doing both would play the sound twice. Nothing breaks at build time, and the common case is unchanged: a plugin that calls `msgt(ctx.state, "HUNGRY", "...")` still gets the message and the sound, because the state's sink supplies it. The change affects a plugin that binds its own non-sounding `msg` into a `MessageSinks` and relied on `msgt` to call `sound` separately. That plugin now goes quiet, and the fix is to make its sink type-aware with the exported `messageSound(type)`, the same one-line rule `web/src/main.ts` uses. There is no alias, because two functions that differ only in whether they play the sound twice would be worse than one rule.

In the SDK rather than `ctx.core`, `ParsedCapability` gained a `{ kind: "display"; action: "replace" }` variant (#140, unreleased 2026-08-13), because `ModPlugin.frontend` now requires `display:replace`. Code that builds a capability string is unaffected. A plugin that `switch`es exhaustively over `parseCapability`'s result in TypeScript gets a compile error naming the new arm, which is intended: a mod that shows the capability list in its own UI should learn that a kind exists it does not describe. At runtime the change is additive, and an older build never emits the new variant.

`ParsedCapability` changed again in the same way: it gained `{ kind: "ui"; region: string; action: "replace" }`, and `ContestedLayer` gained `"hud"` (#253, unreleased 2026-08-13), because `ModPlugin.hud` requires `ui:<region>.replace` and the conflict report now has a slot for each HUD region. An exhaustive `switch` over either type gets a compile error naming the new arm, as intended. `ModPlugin` itself only gained an optional member, so no existing plugin's shape changes.

Two more SDK additions break nothing and are listed because every shape change is recorded, whether or not it strands anyone. `WorldFrame` and `HudFrame` each gained an optional `stack` (`readonly LiveRegion[] | undefined`), and `LiveRegion` and `RegionLayer` are now exported from the SDK (#261, unreleased 2026-08-14). An optional member on an interface a plugin receives cannot break it, because code that reads a frame still compiles. A host that publishes no stack leaves it `undefined`, and that has its own meaning, so a front end must not treat a missing stack as "nothing is covering me". See [PLUGINS.md](PLUGINS.md#knowing-when-you-are-covered-framestack). The `ParsedCapability` changes above broke exhaustive `switch`es because plugins inspect capabilities; plugins do not switch exhaustively over frames.
One SDK change removes a name rather than reshaping it: `applyFieldPolicy` is gone from the package index (#285, unreleased 2026-08-15). It became public by accident through `export * from "./fields.js"`, and outside the SDK it was both unusable and dangerous. The function judges a namespace trespass from a `FieldProvenance` map built during composition, and the accessor that builds one (`fieldProvenanceOf`) was never exported. An outside caller could therefore only use the three-argument form, whose defaults are empty maps: it strips undeclared keys, finds no recorded writer for anything, judges no write a trespass, and returns a fault list that looks exactly like a clean pass, so the caller trusts a check that never ran. The two provenance parameters are now required too, so the same mistake is a compile error inside the SDK. Nothing in this repository or the four mod repositories called it, so no author is stranded; the way to apply the rule is `composeContentPacks`, which supplies both maps and always has. `checkUnqualified`, `declaredFields`, `fieldOwner`, `isExtensionKey` and `FIELD_TYPES` are unaffected, and the index now names them explicitly instead of using the wildcard that let `applyFieldPolicy` out.

Two field renames are invisible to the export ratchet, which compares only the set of exported names and not the shape of what each one returns (#283, unreleased 2026-08-15). The ui-entry config a plugin gets from `buildUiEntryConfig` changed two fields:

| Was | Now | Why not aliased |
|---|---|---|
| `UiEntry.combinerIndex: number` (1-based into core's nine) | `UiEntry.combinerName: string` | The index is a position in core's own compiled table, so a combiner a mod registers has none; keeping it would have fixed the table at nine entries and made `registry:ui-entry` useless. Keeping both would give one thing two identities and need a rule about which wins. |
| `RendererInfo.backendIndex: number` (0..5), `RendererInfo.combinerIndex: number` | `RendererInfo.backendName: string`, `RendererInfo.combinerName: string` | Same reason and same fix: read the name. `RendererInfo` is now also an exported type, which a plugin writing a renderer backend needs in order to name it. |

Nothing else in `UiEntryConfig` changed. A plugin that only calls `characterGrid`, `equipCmpSummary`, `applyRenderer` or `combineValues` is unaffected: each gained an optional trailing registry argument and behaves as before when it is omitted.
Outside the guaranteed subset, `ctx.core` can change in any release; the ratchet makes each break visible in this repository before it reaches a player's browser. The guarantee covers a top-level name and its `typeof`, so nested keys on a guaranteed object (`FEAT.MORE`, `TV.SWORD`, `RSF.BR_FIRE`) are recorded like any other shape change. `ModHooks` is a closed interface of eight members, and the bug-fixes mod alone uses six of them. If authors keep calling unguaranteed `ctx.core` names to get past it, the answer is to grow the seam or add names to the guaranteed subset, rather than restricting the namespace.
## What is *not* a compatibility mechanism

- **Save data.** A mod's own bag in the player's save is migrated by the mod, via
  `ModPlugin.migrateBag` and `saveSchema`. Core round-trips the bag verbatim and
  never reads it, so only the mod knows what its own data means.
- **Load order.** Nothing here changes who wins a conflict. That is
  MOD_LIFECYCLE.md section 3, and the answer is always the mod that loads last.

## Who finds out first

The **mod canary** (`.github/workflows/mod-canary.yml`) runs the curated list against this build daily and whenever the list changes: every repository in `mods/registry.json` is discovered the way the game discovers it, and its manifest is put through this build's gates. An engine release that would strand a curated mod shows up in the canary rather than in a player's install. It does the job of SMAPI's compatibility list automatically, and it lets a release be held back before it ships.

That covers curated mods only. A mod nobody has listed finds out the same way every mod always has, which is why the gates above degrade instead of refusing.

## Prior art, and where this deliberately differs

- **[SMAPI](https://github.com/Pathoschild/SMAPI)** (Stardew Valley) is the model
  for most of this: it rewrites mods' compiled code for renamed members, detects
  an incompatible mod and disables it with a clear message rather than letting it
  crash the game, and publishes a live compatibility list. The lesson taken here
  is the *ordering* - degrade, report, and only refuse what genuinely cannot run.
  Not taken: the IL rewriting, which has no equivalent for a JavaScript module
  and would be the wrong tool anyway.
- **[Factorio](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html)**
  supplies migrations in two flavours - JSON to rename a prototype, Lua to fix up
  a loaded save - and remembers per save which have run. `migrateBag` is the
  second of those. The first is the shape a core-side rename alias would take if
  one is ever needed; nothing needs it yet, because core's record names are
  upstream Angband's and the parity mandate keeps them still.
- **NeoForge and Factorio both block** on a declared incompatibility. This engine does not: an author's declaration is shown with their reason and never overrides the player's setup.
