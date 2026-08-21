# Modding Neo Angband

> ## New to this? Don't start here.
>
> **[Make a mod](tutorials/README.md)** is the front door: seven short tutorials,
> the first of which is two files and takes about five minutes. This page is the
> reference: it enumerates, it does not teach.

Moddability is a ratified pillar of this project (PORT_PLAN.md decisions
13-21): every aspect of the game is open to mods, including capabilities
that do not exist in the base resources. The base game is itself a pack
("core", pack zero) loaded through the same pipeline your mod uses - if
core can do it, your mod can do it, redefine it, or delete it. Core is
parity plus the mod architecture only; everything else - the five first-party
mods included - is a mod (decisions 17-18). Cheaty mods are allowed: the engine
warns and labels, it does not forbid.

This directory is the modding SDK documentation set. It grows with the
engine; each page documents surfaces that exist and are tested. For the
overall design and the moddable-surface matrix, read `docs/MODS.md`.

**Just want to install one?** That is
[three keypresses](../MODS.md#getting-a-mod-in-one-paragraph), not this page.

**Writing one, and want to talk to someone?**
[The RPGM Tools Discord](https://discord.gg/YegtwbHTBQ) is the place - the
seams are new, and "can a mod do X" is exactly the question worth asking
before you build around an answer you guessed.

## Surface status: complete, WIP, not yet

This directory holds both **built-today** pages and **design-of-record** pages,
and an author who cannot tell which is which builds against the wrong one. Every
surface below carries one of three words, and they are meant literally:

- **Complete**: built, tested, and driven end to end at least once along the
  path a player's install actually uses. Write against it today.
- **WIP**: partly built. What exists is real and is not going to be taken away,
  but the surface does not yet cover everything its name suggests. Read the
  linked row before assuming the part you need is in.
- **Not yet**: there is no seam. Whatever the design pages say about it is a
  proposal. Do not build around it, and do not build a *workaround* either: a
  workaround reaches through something that was never a seam, and it is exactly
  what the real seam breaks when it lands. Ask on the Discord instead.

`MOD_REACH.md` is where each of these is measured, one row per capability; the
table below is an index into it. `modding-status.test.ts` reads both files and
fails if a status here stops matching the measurement there, so the two cannot
drift silently, which is the only reason a summary table like this is safe to
write down at all.

| What you want to do | Status | Measured in |
| --- | --- | --- |
| Change any value in any gamedata file, add a key, remove a key, on any record, including the ones with repeated names | **Complete** | gap 2 |
| Add records core has never seen: objects, monsters, egos, artifacts, and whole new item **classes** (tvals) | **Complete** | gap 20 |
| Extend a record with fields of your own, in your own namespace | **Complete** | gap 16 |
| Ship real **code** that runs in the game, installed from disk with no build step here | **Complete** | gap 1 |
| Change behaviour: the `ModHooks` points, plus the keyed registries listed in `MOD_REACH.md` §(c) | **Complete** | gap 3 |
| Monster combat: blow effects, recording and live paths, one registration for both | **Complete** | gap 4 |
| Store behaviour: the buy rule and stack sizes | **Complete** | gap 5 |
| Level generation: your own whole-cave builder and the profile that selects it | **Complete** | gap 6 |
| Vaults and room templates drawn with symbols core has never decoded | **Complete** | gap 17 |
| Random artifacts: reach the **generator**, not just ship a fixed artifact | **Complete** | gap 19 |
| An effect of your own that the game can **describe** to the player | **Complete** | gap 18 |
| Tile packs: register a Graphics row, ship your own art, either tile engine | **Complete** | gap 8 |
| Sounds, fonts, splash art, help text, and `.prf` effects, including classic TILE assignments layered over a graphics pack | **Complete** | gap 7 |
| Localization, not a string table; the structural seam | **Complete** | gap 14 |
| Have your records schema-checked before they reach the game | **Complete** | gap 12 |
| Survive a broken mod at boot, with the fault named and attributed | **Complete** | gap 13 |
| Know which mod added or changed a record, in the running game and in the save | **Complete** | gap 10 |
| Load order that means what the manager says it means | **Complete** | gap 11 |
| **Replace the front end**: draw the world yourself, any way you like | **Complete** | gap 9 |
| Know **where you may draw**: named regions, in grid cells and CSS pixels, on every frame | **Complete** | gap 9 |
| Drive the game programmatically: an autoplayer, a bot, a test harness | **Complete** | `BORG.md`, `ModPlugin.controller` |
| Menus: add, reorder, retitle and re-tag **rows** (`registry:menu`). How a menu is **presented** is not reachable | **WIP** | gap 21 |
| **Replace the UI**: the HUD, the status line, the message area, menu presentation, the ~50 full screens | **Not yet** | gap 21 |
| Own a HUD region (messages, vitals, status) with core drawing the ones you do not claim, or **create a region of your own**: ordered, overlapping, transparent, composited, and owning pointer input on the cells it paints | **WIP** | gap 21 |
| Retitle, regroup, reorder, re-tag or rebind an existing web keypress command (`registry:menu`); the command's closure stays shell-private | **Complete** | `MOD_REACH.md` row 23 |
| Rename one of your own rule flags without losing the player's saved choice (`renamedRuleFlags`) | **Complete** | `AUTHORING.md` |
| Rebind keys, or add a gamepad: `input-door.ts` is host infrastructure, not a seam | **Not yet** | `MOD_SEAMS.md` |
| Change the message table, the `MSG_`->sound map, or the pref-file handlers | **Complete** | `MOD_REACH.md` rows 20, 21, 8 |
| Change the monster spell table or the command table | **Not yet** | `MOD_REACH.md` rows 22, 19 |
| Install, update and uninstall UX: ratified in full, built in part | **WIP** | `MOD_LIFECYCLE.md` |

Two things this table deliberately does not do. It does not rank surfaces by how
much work they were, and it does not promise dates. A **Not yet** row is not a
queue position; some of them are one task away and some are a design argument
that has not been settled.

## Contents

- `tutorials/`: **the beginner path** - seven tiny mods, one idea each, each
  ending in something visible on screen. The finished mod for every tutorial is
  a real folder under `samples/tutorials/` that gets composed against the real
  game data on every test run, so a tutorial cannot quietly stop working.
  Start there if you have not written a mod for this game before.
- `FEATURE_RESTORATION.md`: bringing back mechanics that later versions of
  Angband dropped, without changing vanilla - the research rules that keep a
  restoration honest, and why restoration is the best available test of whether
  the mod system is real.
- This page: pack anatomy, manifests, and record composition (live today,
  backed by `@rpgm-tools/neo-angband-mod-sdk`).
- `REQUIREMENTS.md`: **exactly what a mod must provide**, and the one page here
  that cannot go stale - it is GENERATED from the rules the game enforces
  (`packages/mod-sdk/src/standards.ts`), and a test fails if the two ever
  disagree. Run those same rules against your own folder before publishing:
  `npx neo-angband-mod-check path/to/your-mod`. Start here.
- `AUTHORING.md`: the SHORTCUTS - `draftRecord` fills a new record from core's
  own comparable records (including its price), `checkRecords` names every way
  it will silently not work, and `ModProject` assembles a whole mod and composes
  it through the real pipeline before saying anything. Read this before writing
  a record by hand.
- `MOD_LIFECYCLE.md`: how saves stay safe across install/update/
  uninstall, installing from git (and a future marketplace), multi-mod
  composition and conflict resolution, uninstall recovery, and the UX
  principles. RATIFIED (decision 19); not yet fully built.
- `MOD_SEAMS.md`: the CORE seams a mod reaches through - the `ModHooks`
  behaviour interface, its per-hook fold rules, and how a patch is turned
  on. Describes what is built.
- `MOD_COMPATIBILITY.md`: what an engine release may and may not break, and
  what you have to do about it. The four gates that can strand a mod, what
  to write in `engine`, the two-release rule for an ABI bump, and the honest
  gap around `ctx.core`. Read this before publishing anything.
- `MOD_REACH.md`: the MEASURED answer to "how much of the game can a mod
  actually make over today" - hook count, a census of the port's dispatch
  tables and which are mod-reachable, what data layering really supports,
  what resources are overridable, and the gap list. Read this before
  trusting a capability claim on any other page: this directory contains
  both design-of-record pages and built-today pages, and the two are not
  the same thing.
- **Replacing the whole front end** (an 8/16-bit menu shell, isometric, full 3D,
  first-person, controller-driven) is a design that has been written down and
  measured, but **the seams for it do not exist yet**. Two facts from that work
  are worth knowing here: core is already headless and needs no change for any
  of it, and what stands in the way is `GlyphTerm`, which is both the surface
  and the input door. The plan itself is in the private working record (see
  [../WORKING_RECORD.md](../WORKING_RECORD.md)) because it is a proposal under
  argument rather than an API anyone can build against.
- `docs/LINOLEUM.md`: tile packs and converting the classic tilesets.
- `BUG_FIXES.md`: the `bug-fixes` mod - its design of record and
  referenced changelog for upstream crash/corruption/save/determinism fixes
  that core deliberately does not carry (decision 24). Design of record;
  patches land with the mod runtime and the systems they touch.
- Coming as the engine lands them (P7 deliverables): handler registry
  catalog (effects, commands, room builders), the sandbox capability
  reference for scripted plugins, dialog/quest/shop cookbooks, the
  `neo-pack` validator/bundler, and publishing guidance.

## The first-party mods

Five, **none of them bundled**, all OFF until enabled (see
`DEFAULT_ENABLED_MODS` - an untouched install is the faithful base game with no mod
loaded). Each lives in its own repository and arrives through the mod manager's
*Install a mod...* row:

| id | shape | where it lives | what it adds |
| --- | --- | --- | --- |
| `qol` | content | [own repo](https://github.com/neostryder/neo-angband-mod-qol) | Genuinely new conveniences, currently just auto-dig on walk. Built-in Angband `=` options are NOT here: they ship in core at their upstream defaults. See `QOL.md`. |
| `bug-fixes` | content | [own repo](https://github.com/neostryder/neo-angband-mod-bug-fixes) | An unofficial patch set for upstream bugs core deliberately keeps. See `BUG_FIXES.md`. |
| `neo-linoleum` | tiles | [own repo](https://github.com/neostryder/neo-angband-mod-linoleum) | An ALTERNATIVE tile engine: the Linoleum loose-pack format (individual PNGs addressed by readable target maps, plus variant pools). It does NOT supply the game's graphics - all five upstream tile sets (Original / Adam Bolt / David Gervais / Nomad / Shockbolt Dark and Light) are core content (`grafmode.c` / `lib/tiles/list.txt`) and appear in the Graphics screen with no mod enabled. It ships all six converted to loose packs, so you can compare the two engines on identical art. Declare a pack with `{ "grafID": >=100, "engine": "linoleum", "menuname": "...", "path": "..." }` - note `engine` is the FORMAT name and stays `linoleum`; `neo-linoleum` is the mod. Since its 0.15.0 it also carries the one rule the GAME used to hold: content a mod added, with no tile anywhere, is drawn from its nearest relative with the colour turned - under its own packs only, through `registry:tiles`. See `docs/LINOLEUM.md`. |
| `borg` | plugin | [own repo](https://github.com/neostryder/neo-angband-mod-borg) | An automatic player, driving the game through the same perceive/act API any third-party automation would use. The whole port lives there, with its own release tags and its own suite, including one that drives the BUILT `plugin.js`. Installing and enabling it does not hand it your character; its "Let the Borg play" toggle does. |
| `feature-restoration` | content + plugin | [own repo](https://github.com/neostryder/neo-angband-mod-feature-restoration) | Beloved Angband features that a later version quietly dropped, brought back one named toggle at a time, every toggle off by default. `Teleport Other` (content: a `fieldPatches` addition to the Priest, Paladin and Ranger's own books, who lost the spell somewhere between an earlier Angband and 4.2.6 while the Mage and the Rogue kept it) and store discounts (plugin: 4.2.6 dropped the discount roll entirely, so this restoration installs a `registry:store` discount-roll handler instead of patching data that no longer exists). |

**First-party is not a shortcut.** All five take the same route into the game as anybody else's mod, and that is on purpose: bundling the author's own mods would have hidden every defect in the install path behind mods that never used it. The download route, the folder code loader and the plugin ABI all work because nothing is exempt from them. What first-party buys is that these five are also the reference examples - read them to learn the seams.

Enable one in the in-app mod manager (game menu -> Mods), or with
`?mods=qol,bug-fixes,neo-linoleum` for a one-off.

**The mod is the unit you switch; its patches ride with it.** While a mod is
disabled its patches DO NOT EXIST - its code is never called, no hook is
installed, nothing appears in the menu, and core runs the faithful base game. A mod that
changes BEHAVIOUR does so by default-exporting `ModHooks` from its own
`plugin.ts`; core holds one composed `ModHooks` and never learns which mod
supplied what (`docs/modding/MOD_SEAMS.md`).
Enabling the mod turns its whole patch set on at once,
and each patch is then individually switchable on that mod's own screen
(Mods -> the mod -> Fixes & tweaks), so you can take the set minus one.
That is all `default: true` on a rule means:
"on once its own mod is on" - never "on in a fresh install".

The `demo-*` directories alongside them are NOT shipped mods. They are the
framework proofs - one per SDK load path (a content pack that patches a core
monster, a sandboxed worker plugin, a trusted in-process plugin) - and exist
so all three paths stay exercised in dev and in the test suite. Discovery
drops them from release builds (`isShippedMod` in `mod-store.ts`). Since nothing
else is bundled, a release build's discovered mod set is EMPTY and a player's mod
manager lists exactly what they installed - which is asserted, not assumed
(`mod-store.test.ts`, "a release build's content catalog is EMPTY").

One demo does carry its weight beyond being an example: `demo-hooks` is the only
mod in the build with a `plugin.ts`, so it is what keeps the ModHooks discovery
path and its guards from going vacuous now that the real mods have left. A glob
matching nothing passes every assertion about what it matched.

## Pack anatomy

A pack is a directory (or archive) with a manifest and content files:

```
my-frost-pack/
  manifest.json      <- the manifest; the file that makes this a mod
  monster.json       <- contributions to the "monster" record file
  object.json        <- contributions to the "object" record file
  ...
```

### The manifest (`manifest.json`)

```json
{
  "id": "frost",
  "name": "The Frost Depths",
  "version": "1.2.0",
  "shape": "content",
  "dependencies": { "core": "*" },
  "author": "You",
  "license": "CC-BY-4.0"
}
```

- `id`: lowercase kebab-case, unique among loaded packs. It becomes your
  namespace: a monster you add named "Frost Wyrm" is `frost:frost-wyrm`
  everywhere - in other packs, in tile-pack targets, in savefiles.
- `shape`: `content` (declarative JSON), `tiles` (Linoleum tile pack),
  or `plugin` (sandboxed script).
- `dependencies`: packs that must load before yours. Declaring a
  dependency is also a permission: you may only patch, replace, or
  remove records owned by packs you declare here.
- Load order is resolved deterministically (dependencies first,
  alphabetical ties), so the same pack set composes identically on
  every machine. Cycles and missing dependencies fail loudly at load.

### Record composition

Each content file may add, patch, replace, and remove records:

```json
{
  "records": [
    { "name": "Frost Wyrm", "hp": 400, "flags": ["COLD", "DRAGON"] }
  ],
  "patches": {
    "core:kobold": { "hp": 12, "desc": "A tougher little kobold." }
  },
  "replaces": {
    "core:grip-farmer-maggot-s-dog": { "name": "Grip", "hp": 50 }
  },
  "removes": ["core:fang-farmer-maggot-s-dog"]
}
```

- `records` adds new entries; your pack owns them.
- `patches` deep-merges onto an existing record: objects merge key by
  key, arrays and scalars are replaced whole, and an explicit `null`
  deletes a key.
- `replaces` swaps the record body wholesale (the ref and owner stay).
- `removes` deletes the record from the composed game.
- `fieldPatches` applies typed ops to dot-paths (`set`, `merge`,
  `addFlag`, `removeFlag`, `add`, `mul`, `append`, `removeValue`) - see
  `packages/mod-sdk/src/patch.ts`. `append` adds entries to a list
  without restating it, which is how a mod puts an item in a shop's
  stock; `removeValue` takes an entry out again.
- Modifying a record you do not own requires declaring its owner in
  `dependencies`; compose throws otherwise.

#### What a ref looks like when core ships the name twice

A ref is `<pack>:<slug of the record's identity>`. For most files that
identity is the record's `name`, so `core:kobold` is a monster and
`mypack:frost-wyrm` is yours. Two cases need more:

- **Files keyed by something other than `name`.** `store` is keyed by its
  `STORE_*` code, `brand` and `slay` by `code`, `object_base` by tval,
  `constants` by the file itself (`core:constants`, which is what a
  `fieldPatch` against a game constant targets). The full table is
  `packages/mod-sdk/src/record-key.ts`; the loader names the identity in
  every error it reports, so you rarely have to look it up.
- **Names core genuinely repeats.** `ego_item` ships "of Acid" more than
  once - one for melee weapons, one for ammunition - so `core:of-acid`
  names neither. Add a `#` and the item types it applies to:
  `core:of-acid#shot-arrow-bolt`. Write the plain ref and the loader
  refuses it *and lists the ones that work*, so the error tells you what
  to type.

The `*` and `+` in an Angband name are part of it: `*Healing*` is
`core:potion--star-healing-star`, distinct from `Healing`.

#### Adding your own fields to a core record

A patch is not limited to the fields core defines. You can introduce your own -
declare them in your manifest, and write them namespaced with your mod id.

```json
"fields": [
  { "name": "bleed", "files": ["object", "ego_item"], "type": "object",
    "label": "Bleed" }
]
```

```json
{
  "fieldPatches": {
    "core:sword--dagger": [
      { "op": "set", "path": "attack.hd", "value": "1d5" },
      { "op": "set", "path": "gore:bleed",
        "value": { "dice": "1d3", "turns": 5 } }
    ]
  }
}
```

The first op retunes a field core owns - the dagger now really rolls 1d5. The
second adds one core does not, and a plugin reads it back as
`kind.ext["gore:bleed"]`.

**Why namespaced.** Whoever ships first would otherwise take `bleed`, and every
later mod either collides with it or works around it. Qualifying by your mod id
makes the collision impossible, and makes deliberate interop possible in the
same stroke - writing `gore:bleed` from a different mod is unambiguously an
attempt to extend *gore's* field. It is the same rule the vocabulary registry
already uses for terms (`gore:luck`), so there is one rule, not two.

**Writing another mod's field.** To write `gore:bleed` from a mod other than
`gore`, declare `gore` in `dependencies` or `optionalDependencies`. Otherwise
the write is refused, the field is rolled back, and the fault names your mod;
later edits to that field made from the refused value are rolled back too.

**Why declared.** A namespaced key that no loaded mod declares is stripped at
composition and reported by name, and so is one written onto a file the
declaration does not list, or one whose shape does not match its `type`. The
declaration costs one manifest line and buys the error message: without it, a
typo looks exactly like a deliberate new field, so you would see your data
arrive and conclude the patch worked.

An *unqualified* key core does not know is not treated as a field at all -
`atack` is a misspelling of `attack`, not a new attribute - and the game reports
it with core's nearest real field named.

A dropped field costs the field, not the mod: everything else that patch did
still applies.

`ext` is absent entirely on an unmodded record, so its presence means a mod put
something there, and it holds ONLY your keys - core's own fields are never
copied into it, because a mod reading a pre-bind copy of a field it did not add
would be reading a value that can disagree with the bound one forever without
either being wrong. It is frozen, so one mod cannot rewrite what another reads.

`fields` entries take:

| key | required | meaning |
|---|---|---|
| `name` | yes | bare name, no colon - the namespace is added for you |
| `files` | yes | the record files it may appear on; a misplacement is an error |
| `type` | no | `string`, `number`, `boolean`, `object`, `array`, or `any` |
| `label`, `desc` | no | for a mod manager or a character sheet |

Core never reads `ext`. Data alone changes nothing: the game does not know
what "bleed" means, so a mod that adds the field also supplies the behaviour -
a `registry:effect` handler for what bleeding does, or a `registry:blow`
handler for a monster attack that applies it. Adding the field is what makes
the data half possible; the plugin is what makes it happen.

Which keys count as core's is measured from core's own gamedata rather than
declared (`packages/core/src/mod/record-keys.ts`, generated and re-derived by
its test in both directions), so the boundary cannot drift as the pack grows.

> **The old limitation here is gone, and this note replaces it.** Until
> 2026-07-29 a per-record op aimed at any of the 20 non-name-keyed files
> was silently dropped, and until 2026-08-08 a further 73 individual
> records - 61 of `ego_item`'s 107 among them - were addressable by no
> ref at all. Both are closed and measured: **every record of every
> shipped file is now reachable**, except `history`, whose records are
> `{chart, phrase}` with nothing in them that is not a value a mod would
> change. An op against `history` is reported, never dropped.
> `MOD_REACH.md` carries the measurement.

Total conversions are the same mechanism at full throttle: depend on
`core`, replace or remove what you do not want, add your own world.

### Adding things that do not exist in the base game

Two levels:

1. New records of existing types (the JSON above) - pure data, safe by
   construction, validated against the same schemas core uses.
2. New capabilities - new effect opcodes, new commands, new room
   builders, monster-AI overrides, new vocabulary terms. These go
   through the capability-gated registry host
   (`packages/core/src/mod/registry-host.ts`), and they require a
   **TRUSTED in-process** plugin - your mod folder's `plugin.js` - not the
   sandboxed Worker tier. A Worker is async by construction and cannot
   supply a handler that runs synchronously with live `rng` / `chunk` /
   `player` access deep inside the turn. The sandboxed tier keeps the
   reactive perceive/act/event surface and none of the registries.
   Trust is explicit: the plugin declares each `registry:*` capability
   in its manifest and the user consents at install. **Explicit is not
   the same as enforced**, and the difference is worth knowing before
   building on it: the capability gates the facade, while the same live
   registries also arrive ungated through `ctx.core`, `ctx.state` and
   `ctx.registries`, because a mod is meant to be able to read
   everything without declaring anything. PLUGINS.md's
   "What a capability gates, and what it does not" has the table of
   twins and the reason the boundary is the install rather than the
   list.

> **This limitation is CLOSED, and what follows is what replaced it.** Until the
> plugin ABI landed, both code paths were build-time Vite globs over
> `packages/web/mods/`, so only a mod compiled into the web bundle could reach a
> registry and a mod installed from disk could supply gamedata JSON and nothing
> else. That is no longer true. A mod folder ships `plugin.js` beside its
> `manifest.json`, the host loads it from wherever the folder is (a loopback URL
> on desktop, a rewritten module graph in a browser tab) and calls
> `register(host, ctx)` on it like any other - `packages/web/src/mod-plugin.ts`
> is the contract and `main.ts`'s `activeModCode().plugins` loop is the caller.
> The shipped `feature-restoration` mod reaches `registry:store` this way, from
> its own repository, through the same install route anyone's mod uses.
>
> What is still true: the registries cover a set of domains, not the whole
> engine, and most of the port's dispatch tables have no registry at all.
> `MOD_REACH.md` has the census, and it is the number to check before building
> on a capability claim.

## Versioning and stability

`@rpgm-tools/neo-angband-mod-sdk` is the versioned surface mod authors build
against. Types are exported for TypeScript authors; everything is plain
JSON at rest. Breaking changes to pack semantics bump the SDK major
version and are called out in release notes.

**`MOD_COMPATIBILITY.md` is the page that answers "will my mod still work".**
In one line: a data-only mod should survive engine releases without being
republished, and a mod that ships code gets a release's warning before an ABI
change strands it. That page has the mechanisms, the measurements behind them,
and the one place the promise does not yet hold (`ctx.core`).

## Licensing for mod authors

The engine is dual-licensed GPLv2-or-Angband-license (see LICENSE.md).
Declarative content packs and tile packs are your own independent works;
license them as you wish. Distributed scripted plugins are safest
treated as GPLv2 derivatives. See the note at the end of docs/MODS.md.
