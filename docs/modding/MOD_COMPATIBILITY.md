# What an engine release may break, and what it may not

This is the promise a mod author is owed: **which of my mods stop working when
the game updates, and what do I have to do about it?**

The short answer, and the target the rest of this document explains:

> A mod that is pure data should survive engine releases without being
> republished. A mod that ships code should survive patch and minor releases,
> and get a release's warning before an ABI change strands it.

Written down on 2026-08-02, after measuring how the four gates actually behaved.
Three of the four were stricter than they needed to be, and the fourth did not
exist.

## The four things that can strand a mod

| # | Gate | What it judges | On failure |
|---|---|---|---|
| 1 | `engine` | a semver range over `ENGINE_VERSION` | **warns** for data, **refuses** code |
| 2 | `modApi` | the plugin ABI, an integer | refuses outside the accepted window |
| 3 | a patch target | one `patches` / `fieldPatches` / `removes` ref | **skips that op**, keeps the mod |
| 4 | `ctx.core` | any of the engine's ~1950 exports | nothing. See below. |

### 1. `engine` is a label on data and a gate on code

`engine` says which builds the author *tested*. Until 2026-08-02 the host read
that as a demand and refused any pack outside it - so a pack of JSON went dark
because of a string in its manifest, which is ratified decision 18 ("the engine
labels, it does not forbid") applied backwards.

Now the range only **blocks** a pack that ships code, and `modApi` is the signal:
the manifest already requires it of exactly the packs with a `plugin.js`. Code is
what genuinely breaks across a release - it calls functions, and a renamed
function is a crash. A tile pack is data too, on the same reasoning: a stale
mapping loses individual tiles to the ASCII fallback, which the player can see,
and that beats a whole tileset going dark.

**What to write.** A minimum, not a caret:

```json
"engine": ">=0.13.0"
```

`^0.13.0` on a `0.x` version means *0.13.x only*, so it excludes 0.14.0 - which
is how an author accidentally opts into a warning on every minor release. A
two-sided range is for a mod that genuinely knows it breaks above some version.
Omitting the field entirely is a reasonable choice for a data pack, and the
core content pack does exactly that in spirit with `">=0.1.0"`.

#### A range this build fails is no longer the end of the road

Until 2026-08-21 a code pack whose newest release declared a range this build sits
outside was simply refused. The row read `will not run on this version` and stopped
there, even when the same repository still held a release that ran perfectly.
Installing that older release was possible the whole time by pasting a
`github.com/owner/repo/tree/<tag>` URL into **Add from a repository address**, so
what was missing was never the capability. Nothing looked, and nothing said.

Discovery now walks a repository's tags newest first and offers the newest release
this build will actually run. What that walk guarantees:

- **The same gate decides.** Each candidate is judged by the loader's own rule, so
  a version a screen offers is a version load time accepts. There is no second
  opinion about what "runnable" means: the install screen and *Update installed
  mods* share the one walk, because two walks would be two chances to disagree.
- **One manifest read in the ordinary case.** The loop stops at the first candidate
  it accepts, and the newest release is nearly always that candidate, so a mod that
  is keeping up costs exactly what it cost before. Manifests are read from
  `raw.githubusercontent.com`, which is unmetered, rather than from the API, whose
  sixty requests an hour a screenful of mod rows would spend on nothing but
  walking.
- **The walk is bounded at eight versions** (`MAX_VERSIONS_TRIED`). A mod whose
  last eight releases all want a newer game is telling the player to update the
  game, and that is what the refusal then says, along with how many releases were
  tried.
- **A pinned tag is never walked past.** A player who named a version is owed that
  version, so a pin that will not run is refused as a pin rather than quietly
  becoming a different install than the one that was asked for.
- **A data pack out of range is never walked past either,** because gate 1 lets it
  load. Its newest release is still the one offered, still carrying the line about
  the range.
- **The release that was passed over is named.** A player offered 0.14.4 while the
  mod's front page shows 0.15.0 would otherwise conclude the game is broken or the
  listing is stale, when the real answer is that 0.15.0 wants a newer game. The
  row, the detail pane and the refusal screen all say which newer release was
  stepped past and why.
- **"Update the game" is said only when a newer game is what would help.** Gate 1
  deliberately refuses to say which side is behind, because `>=0.24.0` wants a
  newer game and `<0.5.0` wants an older one, and a confident instruction would be
  wrong half the time on the one line a player acts on. A screen that has decided
  to offer an older release still has to answer the question, so it is answered
  separately and by probing: `newerGameCouldRun` tries the next nine patches, the
  next nine minors and the next nine majors above the running version, plus one
  far-future version for an open upper bound. Where none of those satisfies the
  range, both versions are named and nothing is advised, which is the same
  restraint the verdict itself shows.
- **An update is never offered that the loader would refuse.** *Update installed
  mods* counts only releases that run here, so a mod already sitting on the newest
  release this build can run reads as exactly that rather than as out of date, and
  the number of mods holding a release back for a newer game is shown beside it.
- **A manifest that could not be read keeps the optimistic answer.** Withholding an
  update over one failed request would be a claim about a mod made without asking,
  which is the failure the update screen was rebuilt to avoid. The install path
  runs the same walk with a live connection and steps back there.

**What this asks of an author.** A range stricter than the mod needs now costs a
player the mod's newest release rather than the mod itself. That is a smaller harm
and still a real one, so a two-sided range should be one that was meant. It also
means fixing a range in a new release reaches players immediately: the walk finds
the fixed release without the game having to update first.

### 2. `modApi` accepts a window

`MOD_API_VERSION` is what this host implements; `MOD_API_MIN` is the oldest it
still accepts. Everything in between loads, and anything below the current
version is reported to its author as running on a compatibility path.

Until 2026-08-02 the check was `declared !== MOD_API_VERSION`, so the day the
number moved, **every mod in existence stopped loading at once** - before any
author could react, for a change most of them were not affected by.

**A bump now takes two releases:**

1. Ship the new behaviour. Leave `MOD_API_MIN` where it is. Keep honouring the
   old contract for plugins that declared the old number - `LoadedModPlugin.api`
   carries what each one declared, which is what makes that possible. Authors
   start seeing the deprecation line.
2. Raise `MOD_API_MIN`. Delete the old path.

If a change genuinely cannot be conditioned on the declared version, both move
in one step - and that is a decision to take deliberately, which is the reason
there are two constants and a test that fails when they stop making sense.

### 3. A missing patch target costs the patch, not the mod

A `fieldPatch` at a record that no longer exists used to throw, and the host
answers a throw by dropping the whole pack. So a mod patching forty monsters
lost all forty - plus its code, its rules and its tiles - because one of the
forty had been renamed.

It is now one reported line on that mod's row, and everything else in the pack
still applies. The line says the target may have been renamed, because that is
the likeliest cause and an author who knows they got the ref right will
otherwise go looking in the wrong place.

This is the same behaviour the *other* half of the composer has had all along:
20 of core's 44 record files take a "passthrough" merge path that reported and
carried on, and 24 take a "composable" one that threw. Nobody chose that split;
it fell out of the shape of core's own records.

**A patch that applies cleanly can still name something that is not there,** and
until 2026-08-20 that was a *worse* outcome than a missing target: the composer
was satisfied, and the binder threw. A store's `normal` stock table is the case
that made it ordinary: `append` exists so mod A can stock an item mod B defines,
tutorial 2 teaches exactly that patch, and disabling mod B left an appended line
naming nothing. `bindStore` threw `store: unknown sval` from inside `bindCore`,
which the host runs at module top level, so one line of one shop's stock table
produced the crash screen and no game.

The rule is now gate 3's rule one layer down: the line is dropped, the mod is
told on its own row, and the rest of the store, and every other store, is
untouched. **Core's own data still throws,** and record provenance is what
separates them: an unresolvable entry in a store no pack has touched is core's
mistake and fails loudly, which is every store in a modless game.

This now covers every field of a store record a patch can reach. `normal`,
`always` and `buy` each lose the one entry that resolved to nothing. The
`store:` entrance feature is a scalar, so there is no entry to drop and nothing
left of the shop: the record survives with an entrance nothing matches, the shop
cannot be entered, and the mod is told. It is not removed from the store list,
because that list is consumed positionally: dropping a record would renumber
every store after it and move a saved game's stock between shops. The owner list
resolves no names at all and so has nothing to refuse; a patch that replaces it
with the wrong *shape* is a different problem, and one the composer now answers
one level up.

**A patch cannot make a field unreadable.** The composer already checked shape on
the load path with `field/type` in the record check, but that check reports and
never refuses, deliberately, because the blueprint it reads is a *measurement* of
core's records and an unlisted value is legal (a mod inventing a new tval is
doing something the mod system exists to allow). That is right for a statistic
and wrong for container-ness: every binder reads a list field by iterating it, so
a list field holding a string, a number or `null` is a `TypeError` inside
`bindCore` inside `startGame`: the crash screen, over one field. The composer now
**refuses exactly that class**: the field is put back to what the record had
before, the pack is told on its own row, and the rest of the patch lands.

Two things it deliberately does not do, both load-bearing:

- **A scalar written as the wrong scalar stays a finding.** `weight` as `"40"` is
  readable, some binders coerce it, and the measurement cannot prove otherwise.
- **A field the patch REMOVES is not put back.** Dropping a field is how a total
  conversion works: `replaces` swaps the whole record, and a monster rewritten
  as `{name, hp}` legitimately has no `flags`. Restoring an absent field would
  silently undo a supported feature. An absent required field is reported
  (`field/required`), and refusing a record the *mod itself owns* belongs in the
  binders; `docs/PLANNED.md` carries that.

**This is not a store-only rule.** An ego's `item:` list names specific base
kinds and takes the same `append`, so it had the same defect and now gets the
same answer: the line is dropped, the ego keeps its other candidates, and the
mod is told. The core-versus-mod decision lives in `packages/core/src/mod/
refusal.ts`, one `fieldOwner`, shared, precisely so that two binders cannot
reach different verdicts about the same provenance. A binder that resolves names
from a list a mod can append to should be reading from there rather than
inventing its own rule; `docs/PLANNED.md` tracks which ones still do not.

### 4. The handed-in namespaces are not covered by any of the above, and that is the honest gap

`ModPluginContext.core` is the **live core module namespace** - the whole engine,
around 1,950 runtime exports, deliberately not a curated slice (decision 18, and
because a curated list is the thing that drifts). The count is not maintained by
hand: `packages/core/mod-api-surface.json` is the recorded surface and
`mod-core-surface.test.ts` fails in BOTH directions against it, so a removal and
an addition are each a visible diff rather than a number somebody has to
remember to change here.

`MOD_API_VERSION` does not version it. It versions the *shape of the plugin
contract*: the members of `ModPlugin`, what the host passes, when it calls them.
A core function can be renamed without touching any of that, so the one number a
mod author checks says nothing about the surface they spend all their time
calling.

What exists now is not a fence but a **ratchet**:
`packages/core/mod-api-surface.json` records every runtime export, and
`mod-core-surface.test.ts` fails when the set changes in either direction.

- A **removal or rename** fails CI with the names, and the fix is either to keep
  the old name as an alias or to record the break here and take it knowingly.
- An **addition** also fails, with a one-line fix
  (`node tools/api-surface.mjs --update`). That is not pedantry: a baseline that
  tolerated additions would go stale, an export added in one release and removed
  in the next would never have been recorded, and the removal check would be
  measuring nothing.

#### There are two such namespaces now, watched the same way

`ctx.authoring` is the mod SDK's public barrel, 94 runtime exports, handed over
whole on exactly the terms `ctx.core` is and for exactly the same reason: a
curated subset of an authoring API is a second list to maintain, and the first
thing that happens to a curated list is that it lags the function somebody needs.

Until it was handed to a plugin, a rename inside the SDK was caught by `tsc -b`
over this repository, because every consumer of it was in the repository. That
stops being true the moment a plugin holds the namespace: a plugin ships as built
JavaScript and resolves no specifier, so the compiler never sees the call. The
second door therefore arrived carrying the first door's hole, and closes it the
same way. `packages/mod-sdk/mod-sdk-api-surface.json` is the recorded surface,
`mod-authoring-surface.test.ts` fails in both directions against it, and
`node tools/api-surface.mjs` checks and updates both baselines in one run.

The SDK barrel is a considered surface rather than everything that happens to be
exported: `applyFieldPolicy` is deliberately kept out of its `index.ts`, and says
so in a comment there. A removal from it is recorded in the table below on the
same terms a core removal is.

#### Additions, which strand nobody

An added `ctx` field cannot break an existing plugin: it reads what it reads, and
a name it never mentions cannot change its meaning. So `MOD_API_VERSION` does not
move for one (its own doc comment says as much), and the additions are recorded
here for discoverability rather than as a warning.

| Version | Field | What it is |
|---|---|---|
| unreleased (2026-08-22) | `ctx.authoring` | The mod SDK's public barrel: blueprints, `peersFor`, `suggestFields`, `checkRecords`, `ModProject` and the rest of the authoring stack. Always present, because these are pure functions over data the caller supplies and there is no boot state they wait on. Ungated, on the reasoning `capability-gate-reach.test.ts` already pins for `ctx.core` and `ctx.registries`: nothing here reads game state, nothing mutates a registry, and every name is reachable to anybody who can install the published npm package. |
| unreleased (2026-08-22) | `ctx.composedRecords` | Every content record the running game was composed from, as JSON, keyed by pack-file stem with no extension. The UNBOUND twin of `ctx.registries`, and the shape the authoring functions above accept: `registries.monsters.races` is bound and carries neither the JSON key names nor the fields that bound to nothing, so a peer table cannot be built from it. Mod-added records are in it on the same terms as core's, each carrying its provenance. Absent during content composition, for the same reason `registries` is. |

#### Removals taken knowingly

Six rows, and they are the shape the mechanism above is for. Four of them are
one removal: the parse-error limit, which had no counterpart in Angband 4.2.6
and so had no business in a port. The sixth is the same shape a release later,
and the first one that had SHIPPED.

| Version | Export | Why | What to use instead |
|---|---|---|---|
| unreleased (2026-08-12) | `optionFileErrorMessage` | Its whole subject is gone. The custom-options reader was a port of upstream **master**'s `struct parser` grammar; #149 rewrote it to 4.2.6's hand-rolled read loop, which has no `parser_state` to format - it emits three plain `msg()` lines instead. | `prefErrorMessage` (`visuals/prefs.ts`), which formats the identical `Parse error in %s line %d column %d: %s: %s` from the same `ParserState`. It was always the same function; this one was the duplicate. |
| unreleased (2026-08-14) | `PARSE_ERROR_LIMIT` | The port's own cap of 20 parse errors per file. A citation sweep (#268) found no `PARSE_ERROR_LIMIT`, no `get_parser_error_limit` and no error COUNT anywhere in 4.2.6 - `process_pref_file_named` (`ui-prefs.c` L1225-1231) `break`s on the FIRST bad line - so it was an improvement the port had added, and the port adds nothing (#272). | Nothing in core: the number was never a fact about Angband. A mod that wants a cap chooses its own and passes it as `PrefErrorPolicy.reportLimit` to `setPrefErrorPolicy` (`visuals/prefs.ts`). The `qol` mod uses 20, so a player sees the familiar behaviour. |
| unreleased (2026-08-14) | `getParserErrorLimit` | The reader for the above, including a `PARSE_ERROR_LIMIT` environment override that no upstream build has. Removed with its subject (#272). | `prefErrorPolicy()`, which answers with the policy in force - `UPSTREAM_PREF_ERROR_POLICY` unless a mod installed another. It answers a richer question, because one number could not express both "keep reading" and "keep reporting". |
| unreleased (2026-08-14) | `setParserErrorLimit` | The test seam for the above. Nothing in the game ever called it, and its subject is gone (#272). | `setPrefErrorPolicy(policy \| null)`, which is a real seam rather than a test hook: it is the documented way a mod changes what a bad pref line costs, and `null` restores 4.2.6's behaviour. |
| unreleased (2026-08-14) | `parseParserErrorLimitEnv` | Parsed `PARSE_ERROR_LIMIT` out of the environment with C's `strtol` rules, so a host could set the cap without owning the rule. There is no cap and no environment variable (#272). | Nothing. A mod that wants its policy configurable owns that decision, and `ctx.prefs` is where a mod keeps a player's answer to it. |
| 0.23.0 | `fillTilesFromKin` | The port's own rule that a mod-added monster with no tile is drawn with the tile of a race sharing its `base`, and an added object kind with a kind sharing its `tval`. Shipped in 0.22.0 and removed one release later: 4.2.6 has no concept of a record a mod added, so it has no opinion about what one should look like, and "the lowest-index relative's picture" is authored taste rather than ported behaviour. It also made that call on behalf of tile sets the game does not own - a pack drawn in 2003 has no art for content added twenty years later, and a sibling's picture there is a confident lie where a letter was an honest answer. The port adds nothing (#272, again). | The seam it became: `registry:tiles`. A tileset mod registers a filler through `host.tiles.register`, reads what the game is made of through `ctx.registries`, and writes through a door that refuses any tile something else assigned (`TileFill`). `neo-linoleum` 0.15.0 carries exactly the rule that used to be here, applied to linoleum packs only. Its three supporting types went with it (`KinTileDeps`, `KinTileFill`, `KinTileDerivation`); being types, they never appeared in the surface list at all. |

`parseCustomOptionsText` survives by name but **changed shape** on 2026-08-12: it
returns `string[]` (the messages) rather than `ParserState[]`, and its fourth
`errorLimit` parameter is gone, because 4.2.6's reader has no error cap. A plugin
calling it for its own diagnostics gets a type error at build and a different
array at runtime. Recorded here rather than aliased: there is no honest alias for
"the same call now answers a different question."

`CellView.trap` survives by name but **changed meaning**, unreleased
(2026-08-21). It used to be "this grid holds any trap record" and it is now
`square_isdisarmabletrap`: a VISIBLE PLAYER trap that is not already disabled.

Recorded here rather than kept and supplemented with a second field, because the
old answer was not a different question - it was the wrong answer to this one. The
trap list is also where a closed door's LOCK lives (`square_set_door_lock`, flagged
`LOCK | INVISIBLE`), along with a glyph of warding, a web and a decoy. None of
those is a trap a player can see or the `disarm` command will act on, so a mod
reading the old field got a locked door presented as something to disarm - and
`disarm` refuses it without spending a turn, which turns a plausible decision into
a hang. The old meaning also contradicted the view's own rule, stated on the
neighbouring `trapGlyph`: a trap the player has not found is not on the screen and
so is not in the view.

**What to do about it.** A mod that used `trap` to decide whether to disarm needs
no change and stops hanging. A mod that used it to ask "is there anything in the
trap list here" - a map overlay counting glyphs of warding, say - now gets `false`
for a glyph and needs the trap layer instead: `trapGlyph` is present for exactly
the traps the player can see, glyph included.

`ProcessPrefOptions` **changed shape** for the same reason and in the same
direction (#272, unreleased 2026-08-14): its `errorLimit?: number` is now
`errorPolicy?: PrefErrorPolicy`. A plugin that called
`processPrefText(text, deps, sink, { errorLimit: 0 })` gets a type error at
build, and the fix is `{ errorPolicy: { continueAfterError: true, reportLimit: 0 } }`.
Not aliased, because the old field could not say what the new one has to: a
single number conflated "stop applying the file" with "stop collecting errors",
and the second is the one a player wants bounded. Four names arrived with it:
`PrefErrorPolicy`, which is a type and so never appears in the surface list, and
the three runtime exports `UPSTREAM_PREF_ERROR_POLICY`, `prefErrorPolicy()` and
`setPrefErrorPolicy()`.

`msgt(sinks, type, text)` likewise **keeps its name and signature but no longer
touches `sinks.sound`** (#239, unreleased 2026-08-13). It used to call both
halves by hand; the host's `msg` sink is now `msgt` itself, so calling both
would play the sound twice. Nothing breaks at build time and the common case is
unchanged - a plugin that calls `msgt(ctx.state, "HUNGRY", "...")` still gets
message *and* sound, because the state's sink supplies it. What changed is a
plugin that binds its **own** non-sounding `msg` into a `MessageSinks` and
relied on `msgt` to reach `sound` separately: that now goes quiet, and the fix
is to make its sink typed-aware with the exported `messageSound(type)`, the same
one-line rule `web/src/main.ts` uses. Not aliasable: two functions differing only
in whether they double-fire is worse than one rule.

One more shape change, in the SDK rather than in `ctx.core`: `ParsedCapability`
gained a `{ kind: "display"; action: "replace" }` variant (#140, unreleased
2026-08-13), because `ModPlugin.frontend` now requires `display:replace`. Nothing
that *builds* a capability string breaks; what breaks is a plugin that
`switch`es exhaustively over `parseCapability`'s result in TypeScript, which
gets a compile error naming the new arm. That is the intended outcome - a mod
rendering the capability list to its own UI should be told a kind exists that it
does not describe. Additive at runtime: an older build simply never emits it.

The same thing happened once more, for the same reason and with the same
consequence: `ParsedCapability` gained `{ kind: "ui"; region: string; action:
"replace" }` and `ContestedLayer` gained `"hud"` (#253, unreleased 2026-08-13),
because `ModPlugin.hud` requires `ui:<region>.replace` and the conflict report
now has a slot per HUD region. An exhaustive `switch` over either gets a compile
error naming the new arm, which is the intended outcome. `ModPlugin` itself only
gained an optional member, so no existing plugin's shape changes.

Two more SDK additions, and this pair breaks nothing at all, recorded because
the entries above establish that a shape change gets written down whether or not
it strands anybody, and a page that only lists the painful ones stops being a
record. `WorldFrame` and `HudFrame` each gained an **optional** `stack`
(`readonly LiveRegion[] | undefined`), and `LiveRegion` / `RegionLayer` are now
exported from the SDK (#261, unreleased 2026-08-14). An optional member added to
an interface a plugin *receives* cannot break a plugin: nothing that reads a
frame stops compiling, and a host that publishes no stack simply leaves it
`undefined`, which the seam gives a distinct meaning to on purpose, so a front
end must not read a missing stack as "nothing is covering me". See
[PLUGINS.md](PLUGINS.md#knowing-when-you-are-covered-framestack). Note the
asymmetry with the `ParsedCapability` rows above: those broke exhaustive
`switch`es because a plugin *inspects* a capability, and nobody exhaustively
switches over a frame.

One SDK **removal**, and it is the first on this page that removes a name rather
than reshaping one: `applyFieldPolicy` is gone from the package index (#285,
unreleased 2026-08-15). It arrived public by accident: the index said
`export * from "./fields.js"`, and it was unusable and dangerous in the same
breath. The function judges a namespace trespass from a `FieldProvenance` map
built during composition, and the accessor that builds one (`fieldProvenanceOf`)
was never exported. So the only form an outside caller could write was the
three-argument one, whose defaults are empty maps: it strips undeclared keys,
finds no recorded writer for anything, judges no write a trespass, and hands back
a fault list indistinguishable from a clean pass. **A gate that reports success
while checking nothing is worse than no gate**, because the caller stops looking.
The two provenance parameters are now required as well, so the same mistake is a
compile error inside the SDK. Nothing in this repository or in the four mod
repositories called it, so no author is stranded; the door to the rule is
`composeContentPacks`, which supplies both maps and always did.
`checkUnqualified`, `declaredFields`, `fieldOwner`, `isExtensionKey` and
`FIELD_TYPES` are unaffected, and are now named explicitly rather than swept up
by a wildcard, which is what let this one out in the first place.

Two **field renames** that the export ratchet cannot see, and that is exactly why
they are written here (#283, unreleased 2026-08-15). The ratchet compares the set
of exported NAMES; it says nothing about the shape of what a name hands back. The
ui-entry config a plugin gets from `buildUiEntryConfig` changed two fields:

| Was | Now | Why not aliased |
|---|---|---|
| `UiEntry.combinerIndex: number` (1-based into core's nine) | `UiEntry.combinerName: string` | The slot was the bug. It is a coordinate into core's own compiled table, so a combiner a mod registers has none, and keeping the index would have frozen the table at nine and made `registry:ui-entry` inert. Keeping BOTH would mean two identities for one thing and a rule about which wins. |
| `RendererInfo.backendIndex: number` (0..5), `RendererInfo.combinerIndex: number` | `RendererInfo.backendName: string`, `RendererInfo.combinerName: string` | Same reason, and the same fix: read the name. `RendererInfo` is now an exported TYPE as well, which it was not before, and a plugin writing a renderer backend needs to name it. |

Nothing else about `UiEntryConfig` moved, and a plugin that only calls
`characterGrid`, `equipCmpSummary`, `applyRenderer` or `combineValues` is
unaffected: every one of those gained an OPTIONAL trailing registry argument and
behaves exactly as before when it is omitted.

**This does not make `ctx.core` stable.** It makes breaking it visible to the
person breaking it, in the repository where it happens, before it reaches a
player's browser. The remaining pressure valve is `ModHooks`, which is a closed
interface of eight members that the bug-fixes mod alone needed six of - if
authors keep reaching past it into `ctx.core`, that is the signal to grow the
seam, not to fence the namespace.

## What is *not* a compatibility mechanism

- **Save data.** A mod's own bag in the player's save is migrated by the mod, via
  `ModPlugin.migrateBag` and `saveSchema`. Core round-trips the bag verbatim and
  never reads it, so only the mod knows what its own data means.
- **Load order.** Nothing here changes who wins a conflict. That is
  MOD_LIFECYCLE.md section 3, and the answer is always the mod that loads last.

## Who finds out first

The **mod canary** (`.github/workflows/mod-canary.yml`) runs the curated list
against this build daily and whenever the list changes: every repository in
`mods/registry.json` is discovered the way the game discovers it, and its manifest
is put through this build's gates. So an engine release that would strand a
curated mod shows up here rather than in a player's install - the automated
equivalent of SMAPI's compatibility list, and the reason a release can be held
rather than apologised for.

That covers curated mods only. A mod nobody has listed finds out the same way
every mod always has, which is why the gates above are built to degrade rather
than refuse.

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
- **NeoForge and Factorio both BLOCK** on a declared incompatibility. This engine
  does not, per decision 18. An author's declaration is shown with their reason
  and never overrides the player's setup.
