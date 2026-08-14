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
| 4 | `ctx.core` | any of ~1800 engine exports | nothing. See below. |

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

### 4. `ctx.core` is not covered by any of the above, and that is the honest gap

`ModPluginContext.core` is the **live core module namespace** - the whole engine,
about 1900 runtime exports (1,898 as of 2026-08-12, up from 1,813 on 2026-08-09
when the localization layer landed - MOD_REACH gap 14 - two more when record
provenance did, gap 10, and one back down for the removal recorded below),
deliberately not a
curated slice (decision 18, and
because a curated list is the thing that drifts).

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

#### Removals taken knowingly

One row, and it is the shape the mechanism above is for.

| Version | Export | Why | What to use instead |
|---|---|---|---|
| unreleased (2026-08-12) | `optionFileErrorMessage` | Its whole subject is gone. The custom-options reader was a port of upstream **master**'s `struct parser` grammar; #149 rewrote it to 4.2.6's hand-rolled read loop, which has no `parser_state` to format - it emits three plain `msg()` lines instead. | `prefErrorMessage` (`visuals/prefs.ts`), which formats the identical `Parse error in %s line %d column %d: %s: %s` from the same `ParserState`. It was always the same function; this one was the duplicate. |

`parseCustomOptionsText` survives by name but **changed shape** in the same
commit: it returns `string[]` (the messages) rather than `ParserState[]`, and
its fourth `errorLimit` parameter is gone, because 4.2.6's reader has no error
cap. A plugin calling it for its own diagnostics gets a type error at build and
a different array at runtime. Recorded here rather than aliased: there is no
honest alias for "the same call now answers a different question."

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

**This does not make `ctx.core` stable.** It makes breaking it visible to the
person breaking it, in the repository where it happens, before it reaches a
player's browser. The remaining pressure valve is `ModHooks`, which is a closed
interface of seven members that the bug-fixes mod alone needed six of - if
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
