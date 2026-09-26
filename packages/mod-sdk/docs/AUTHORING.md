# Authoring shortcuts: drafting a record that actually works

Adding a record to a pack is easy: it is JSON, and composition accepts it. Adding a record that works is harder, because the usual mistakes produce no error message:

- an object with no `alloc` is legal, loads cleanly, and never appears in the dungeon;
- a monster whose `base` is misspelled is legal, loads cleanly, and binds to nothing;
- a forty-first potion is legal, loads cleanly, and uses up the last unused flavour, so some other potion quietly stops being distinguishable.

The pipeline cannot report any of that, because it has no model of what a working record looks like. Core's own 3,279 records are that model, and the SDK compares your drafts against them.

Everything on this page is in `@rpgm-tools/neo-angband-mod-sdk` and needs no
game running.

## Two ways in, and the `import` is only one of them

An offline tool installs the package and imports it, which is what every example
below does. That path needs core's records from somewhere, and `coreRecords` in
those examples is that: the pack's JSON, keyed by file stem.

**A plugin inside a running game takes neither step.** A plugin resolves no bare
specifier, so the import would not work; and it does not need a copy of core's
records, because the game it is running in already composed them. Both arrive on
`ctx`:

```js
register(host, ctx) {
  const records = ctx.composedRecords;              // the coreRecords argument
  if (!records) return;
  const drafted = ctx.authoring.draftRecord(        // the imported barrel
    "object",
    { name: "& Sludge Dagger~", type: "sword", level: 20 },
    records,
  );
}
```

`ctx.composedRecords` is better than a shipped copy of the pack would be: it is
what THIS game composed, so every enabled mod's records are in it too, each
carrying its provenance. A tool drafting against a bundled snapshot could not see
them and would report a reference to another mod's sword as dangling. See
[PLUGINS.md](PLUGINS.md#authoring-ctxauthoring-and-ctxcomposedrecords) for the
guard rules and what each field is absent for.

## Writing another mod's extension field

Your mod may write `<owner>:<field>` only after declaring `<owner>` in
`dependencies` or `optionalDependencies`. Without that declaration the write
is refused, the field is rolled back, and the fault names your mod; later edits
to that field made from the refused value are rolled back too. Declare your own
fields under your own id as usual.

---

## The one-call version

```ts
import { draftRecord } from "@rpgm-tools/neo-angband-mod-sdk";

const { record, suggestions, findings, modelledOn } = draftRecord(
  "object",
  { name: "& Sludge Dagger~", type: "sword", level: 20 },
  coreRecords,          // { object: [...], object_base: [...], ... }
);
```

`record` comes back complete:

```json
{
  "type": "sword",
  "graphics": { "glyph": "|", "color": "W" },
  "level": 20,
  "weight": 140,
  "cost": 300,
  "alloc": { "common": 20, "minmax": "20 to 100" },
  "attack": { "hd": "3d5", "to-h": "0", "to-d": "0" },
  "name": "& Sludge Dagger~",
  "power": 8
}
```

`modelledOn` says `"& Katana~"`, and every number that was chosen carries its
evidence:

```
cost   = 300  <- the median of the 7 core object records closest to level 20 with type "sword"
weight = 140  <- the median of the 7 core object records closest to level 20 with type "sword"
```

`findings` holds what is still wrong with it: here, one hint that it has no
`desc`.

### Why "modelled on", not "assembled from defaults"

An earlier version built the shape from how often each field appears across the whole file, and produced a sword with an `armor` block because 59% of core's objects have one. How common a field is across a file says nothing about whether a particular record should have it, so the shape now comes from core's nearest comparable record and only the numbers are averaged.

The model never lends the fields that confer behaviour or identity: `flags`, `values`, `slay`, `brand`, `curse`, `effect`, `act`, `blow`, `spells`, `name`, `desc`, `msg`. Copying those would hand you an item that does things you never asked for and would not think to look for.

---

## The pieces, separately

Every step of `draftRecord` is callable on its own.

| Call | Answers |
|---|---|
| `describeFile(file)` | what does a record of this kind contain? |
| `requiredFields(file)` | what do **all** of core's records here carry? |
| `fieldUsage(file)` | every field, most-used first, with its share |
| `templateRecord(file, scope)` | a starting record: `"required"`, `"common"` (default) or `"all"` |
| `peersFor(file, draft, records)` | which of core's records are comparable to this one |
| `suggestFields(file, draft, records)` | what core's comparable records would put in the gaps |
| `checkRecords(subject, all)` | every way these records will silently not work |
| `RECORD_BLUEPRINTS` | the raw measurement: per file, per field, count / types / range / observed values |

### "What should it cost?"

Angband's costs are set by hand, so there is no formula for a price, but core's 375 objects give plenty of precedent. `suggestFields` narrows twice: first to the same item type, then to the seven records nearest in level. It suggests numeric fields only; a name, a description or a set of flags is a design decision.

With no comparable record it falls back to the file-wide median and says so in the evidence line, so you can tell a weak suggestion from a strong one.

---

## What `checkRecords` finds

`checkRecords` takes two arguments:

```ts
checkRecords(subject, all)
```

`subject` is the set of records it reports on, meaning yours. `all` is what they may resolve against: core plus every loaded pack. Checking a mod against itself alone would report every reference to core as broken.

Findings are graded, and `checkRecords` never refuses anything. Refusals happen in the manifest validator and the declared-field rule, which enforce the engine's own rules.

### It also runs when the GAME loads your mod

Since 2026-08-09 the check also runs at load time. `composeContentPacks`, the function every host composes through, runs it over every pack it loads and puts the findings on that mod's own row in the mod manager, so a player who installs your mod from a zip sees the same sentences you do. It differs from `build()` in three ways:

- Only `warn` and above are shown. A `hint` is drafting advice for when you are looking at the draft, and dozens of them on a player's screen would bury the one line that matters.
- The base game is not reported on. Core's own data raises warnings against core's own blueprint, and those are upstream warts the port keeps.
- A patch is checked as the record it produced rather than as you wrote it, so `{"speed": 120}` is not reported as a record missing twenty fields.

In practice, your users see what your `build()` output shows. If it is clean at `warn`, their mod manager stays quiet, and there is nothing extra to run or opt into.

| Level | Meaning | Examples |
|---|---|---|
| `error` | the record cannot work | a required field is absent; an artifact with no `base-object` |
| `warn` | it loads and will not do what it looks like it does | a dangling reference; no `alloc`; a field written as the wrong type |
| `hint` | worth a look | an unfamiliar field name (with a "did you mean"); no `desc`; nothing to attack with |

### Dangling references

`REFERENCE_EDGES` declares 37 fields that name another record: `object.type`
into `object_base`, `monster.base` into `monster_base`, `ego_item.slay` into
`slay`, `artifact.act` into `activation`, and so on. Every edge is measured
against core's own data by `references.test.ts`, so an edge that is wrong is a
test failure rather than a false alarm in your mod.

References resolve against **core plus your own new records**, so a mod that
adds an `object_base` and then an object of that new tval is not told its own
tval is missing.

An unresolved reference is a **warning, never a refusal**, and the reason is
recorded: core's own data contains references that do not resolve.
`artifact.txt` says `base-object:soft armour:...` while `object_base.txt` and
`list-tvals.h` both spell it `soft armor`; fourteen artifact base objects
(Phial, Arkenstone, several rings) name svals `object.txt` never defines. Those
are Angband 4.2.6's, reproduced exactly under the parity mandate. A rule strict
enough to reject them would reject Angband.

### Companion steps

`COMPANION_RULES` is the list of things the record is fine without and **you**
are not. They are all warnings or hints, because every one of them is legal:
an object with no `alloc` is exactly how core defines an item that only comes
from a store.

The one that is not a per-record rule: **flavour pressure.** Angband hands each
object of a flavoured type its own flavour (`potion`, `scroll`, `ring`,
`amulet`, `staff`, `wand`, `rod`, `mushroom`); past that point unidentified
items start sharing. Core ships 59 potion flavours for 41 potions, so there is
room for eighteen more before it bites. Counted from the composed data, so a mod
that adds flavours as well as objects gets the credit for them.

---

## Assembling a whole mod

`ModProject` is the same shortcuts wrapped around a manifest, and it composes
through the real pipeline before it says anything.

```ts
import { modProject, draftRecord } from "@rpgm-tools/neo-angband-mod-sdk";

const build = modProject({
  id: "sludge",
  name: "Sludge",
  version: "1.0.0",
  shape: "content",
  author: "you",
  repository: "https://github.com/you/sludge",
  engine: ">=0.19.0",
  dependencies: { core: "*" },
})
  .declareField({ name: "sludge", files: ["object"], type: "object" })
  .add("monster", draftRecord("monster", { name: "sludge fiend", base: "icky thing", depth: 25 }, core).record)
  .patchFields("object", "core:sword--dagger", [
    { op: "set", path: "sludge:sludge", value: { turns: 5 } },
  ])
  .build(corePack);

build.files;     // [{ path: "manifest.json", contents }, { path: "monster.json", contents }, ...]
build.findings;  // worst first
build.problems;  // composition's own refusals
build.ok;        // false if anything is at `error`
```

- The builder touches no filesystem. `emit()` hands back paths and bytes and leaves the writing to you, so the same builder works from a CLI, from a test and from an in-game editor.
- It checks the composed result rather than the draft. A patch that breaks a reference is invisible in your own files, because your files do not contain the record it broke.
- It reports problems instead of throwing. A missing dependency is an `error` finding, not a stack trace.

`build.ok` ignores warnings because every warning it can produce is something core's own data does somewhere, so a builder that refused on warnings would refuse to build Angband.

---

## What a mod can add a record to: 41 of 44 files

That count is taken over the shipped pack; it used to be 24. Composition merges a file record by record when every record has a ref no sibling claims. `packages/mod-sdk/src/record-key.ts` defines what a ref is: `name` for most files, and something else where upstream identifies records another way.

Until 2026-08-08 the test was "a unique `name`", and three files failed it on core's own data, because Angband names a greater form by reusing the name with marks: `Acquirement` and `*Acquirement*`, `Little eruption` and `Little eruption+`, and `ego_item` ships 23 names twice over. As a result a mod adding one object replaced all 375 of core's, one ego replaced all 107, and one vault all 162, in the three files most worth adding to. They now merge per record:

| File | Records | A mod adding one record... |
|---|---|---|
| `object` | 375 | adds one, 376 |
| `ego_item` | 107 | adds one, 108 |
| `vault` | 162 | adds one, 163 |
| `store`, `flavor`, `brand`, `slay`, `object_base`, `trap`, `names`, ... | - | adds one, keyed by whatever upstream keys it by |

`constants`, `visuals` and `history` still take a whole file. `constants` and `visuals` are config singletons: the file is their identity, the host binds exactly one, and shipping `constants.json` means "use mine". `history` has no per-record identity at all: a history record is `{chart:{chart,next,roll}, phrase}`, and a mod could legitimately change any part of it. For those three, `ModProject.build` still raises `file/whole-file-replacement` as an `error`, so an author cannot replace the base game's copy of a file without noticing.

### What a record is called

Refs did not change. `patchFields`, `replace` and `remove` already used the per-record identity, so every ref that resolved before still resolves:

- `object` is `type + name`, so the Dagger is `core:sword--dagger`;
- `ego_item` is `name`, plus a `#` discriminator where core ships a name twice, as in `core:of-acid#shot-arrow`;
- `store` is its `STORE_*` code, `brand` and `slay` their `code`, `flavor` its base tval, and so on.

A record answers to several refs: its base key, its discriminated form, and, as an alias, the lossy slug used before 2026-08-08, so refs written against an older engine keep working. An alias is dropped where it would shadow a *different* record's real name. `*Healing*`'s old ref, for example, is plain `Healing`'s current one, and an old alias must not take a name away from another record.

That drops **8 of the pack's 19 legacy aliases**, and which ones depends on core's data rather than on the mark. `*Acquirement*` loses its alias because core ships a plain `Acquirement` scroll. `*Destruction*` keeps both of its, as a scroll and as a staff, because core has no plain `Destruction` for them to shadow. `of *Slay Orc*` loses its alias and `of *Slay Animal*` keeps its own, for the same reason. `record-key.test.ts` asserts the full census row by row.

None of the 8 breaks a working ref: every file carrying a legacy alias had no per-record addressing before the key table existed.

### Where a new record lands, and why it matters

New records are appended after core's, and the position matters. In upstream, `sval` is a counter rather than a field in the data: it is bumped per object base in file order (`parse_object_type`, `reference/src/obj-init.c`), and `kidx` is the record's position in the file. Appended, every one of core's 375 objects keeps its index, name, tval and sval, and the new object takes the next free sval of its own base. Prepended, every sword in the game would shift by one.

Composition appends because core is pack zero and a mod that declares `core` as a dependency loads after it. `packages/web/src/mod-added-record.test.ts` binds core's pack with and without one added object and asserts the whole table, not a sample. The one thing that does move is the tail of dummy kinds `bindCore` creates for special artifacts whose base sval `object.txt` never defines (the Phial, the Star, the rings of power). Their array index shifts by one, and nothing depends on it, because a savefile stores a namespaced string `kindId` rather than a `kidx`.

### Your artifact and the `birth_randarts` option

An artifact your mod adds survives a character born with random artifacts turned on. Every other artifact in the game is redesigned into a different item, but yours keeps the name, the base object and the numbers you wrote.

`packages/core/src/obj/randart-mod-artifact.test.ts` tests this, and the cause is where your records sit in the file. Upstream's `design_artifact` looks up an artifact's base kind once, and its skip-the-fixed-artifacts loop never refreshes that lookup, so once the loop starts on a quest artifact it keeps skipping to the end of the array. Angband's two quest artifacts are the last two records in the file, and your records are appended after core's, which puts them past the point where the skipping starts. The port reproduces this quirk exactly, since core keeps every behavioural wart a player can observe.

This has two consequences for you. Your artifact is not randomized even in a random-artifact game, so players who chose that option to be surprised will still meet yours as you designed it. And the port does not promise this behaviour, so the same test also checks the converse: if the order records are bound in ever changes, it fails and names the reason.

---

## Shipping resources: sounds, a font, pref files, help pages, art

Records are not the only thing a mod folder can hold. Six other categories are
declared in one `resources` array in your manifest, each naming a `kind` and a
`path` **inside your mod folder**. The kinds are `sound`, `font`, `prefs`,
`help`, `art` and `locale` (`ResourceKind`,
`packages/mod-sdk/src/resources.ts`):

```json
"resources": [
  { "kind": "sound", "path": "sounds" },
  { "kind": "font",  "path": "fonts/terminal.json" },
  { "kind": "prefs", "path": "prefs/colours.prf" },
  { "kind": "help",  "path": "help/lore.txt", "slot": "lore", "name": "The lore" },
  { "kind": "art",   "path": "art/splash.txt", "slot": "splash" }
]
```

`path` is never a URL. You cannot know where the game is serving your mod from,
and two of the three places a mod can live have no path at all: a folder the
player picked, and a mod installed from a repository, which lives in the
browser's database. The host composes your path with your mod's own resolver.

| kind | what it is | several mods? |
| --- | --- | --- |
| `sound` | a **directory** of samples named as `sound.prf` names them, `.mp3` or `.ogg` | the last enabled one wins |
| `font` | a bitmap font, `{ "w", "h", "glyphs" }`, one scanline number per row | the last enabled one wins |
| `prefs` | a `.prf` in ui-prefs.c's own grammar; ASCII glyphs, colours and sound prefs apply at install, and TILE assignments layer over a graphics pack's own prefs on every map build | **all of them apply**, in load order |
| `help` | one page of plain text | per `slot` |
| `art` | one screen of `{colour}...{/}` markup | per `slot` |
| `locale` | one language, `slot` being its BCP 47 tag | per `slot` |

Four things that will otherwise cost you an afternoon:

- **A `.prf`'s `%:` includes resolve beside the file you declared.** They are
  followed (they were silently skipped before #278), to the same depth the
  parser allows, and every one of them, including an include's own includes,
  is looked up in the directory of the `path` in your manifest. So
  `prefs/colours.prf` saying `%:shared.prf` reads `prefs/shared.prf`. A name
  that does not resolve is skipped without a message, which is what upstream
  does; if a rule of yours is not taking effect, check the spelling of the
  include before anything else.
- **A `.json` resource must sit in a subdirectory.** A top-level `.json` is read
  as a record contribution, so `font.json` would be handed to the record
  composer, which has no content file by that name, and your mod would load with
  no font and no complaint anywhere. `fonts/font.json` is fine.
- **`art` is text, not an image.** The terminal is a glyph grid; nothing paints a
  bitmap into it. Upstream's own splash is text (`lib/screens/news.txt`), and
  `$VERSION` is substituted in yours exactly as it is in that one. Your art is
  clamped to 21 rows and the two credit lines are appended after it.
- **A `help` slot that matches one of the game's REPLACES that page**; any other
  slot adds one. The ids are `commands`, `symbols`, `guide`, `community`. Use one
  of those if your conversion's keys are not Angband's; use your own otherwise.

### What happens when a resource is wrong

Nothing is taken away except that resource. A pref file that will not parse costs
you the pref file, not your records, not your sound pack, not the mod. But it is
never silent: whatever could not be used is written on your mod's row in the mod
manager, in a sentence saying what was wrong with it.

Three checks run, and the last one can only run on the player's machine:

1. **Your declaration**, at build time and again at load: an unknown kind, a path
   leaving your folder, an extension the kind cannot be, a slot no screen paints.
   A `slot` on a kind that has no slots is refused rather than ignored, because a
   silently dropped key is a belief of yours that would survive to ship.
2. **Your file list.** A mod read from a folder or installed from a repository
   arrives with every filename it holds, so a typo is caught without a single
   request. (Not available for a mod compiled into the app; check 3 catches
   those.)
3. **The machine.** Whether this build can play `.mp3` or `.ogg` at all, and
   whether your font JSON is structurally a font. Only opening the file can say.

`demo-resources` is a working example of four of the six, and
`packages/web/src/mod-resources.node.test.ts` reads it from disk in CI. It is not
a mod you can install: the `demo-*` mods under `packages/web/mods/` are framework
proofs compiled into DEV builds only, and discovery strips them from a release
build (`isShippedMod`, `packages/web/src/mod-store.ts`). Read it in this
repository rather than looking for it in the game.

---

## Translating the game

English ships in the game and is what a player sees with no mod installed. A
translation is a `locale` resource, a JSON file whose `slot` is its language
tag:

```json
{
  "tag": "de",
  "name": "Deutsch",
  "messages": {
    "help.commands.label": "Verfügbare Befehle",
    "shop.stock": "{n, plural, one {# Gegenstand} other {# Gegenstände}}"
  }
}
```

`tag` must match the `slot` that declared the file. They are two statements of
the same fact and the check refuses them when they disagree: the slot decides
which language your file *is offered as*, and the tag decides what it *is*.

**You do not have to translate everything.** A missing id falls back through the
region (`pt-BR` -> `pt`) to English, so a partial catalogue reads as part English
rather than as a screen of blanks.

### Patterns, not sentences you glue together

Messages are [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/),
a subset, but the ordinary one, so ordinary translation tools can edit your
file:

| you write | you get |
| --- | --- |
| `{name}` | the value |
| `{n, number}` | grouped for your locale (`1.234.567` in German) |
| `{n, plural, one {# ring} other {# rings}}` | the right arm, `#` being the number |
| `{n, plural, =0 {nothing} other {#}}` | an exact value short-circuits the rules |
| `{g, select, male {Er} female {Sie} other {Es}}` | an exact match |
| `{n, selectordinal, one {#.} other {#.}}` | ordinals |
| `'{` | a literal brace |

**Use the plural arms your language actually has.** They come from the platform's
own rules, so Polish gets `one`/`few`/`many`/`other` and Arabic gets six, and the
game never has to know which. Writing a bare `{n} Ringe` and letting the number
do the work is the single most common way a translation ends up wrong.

### When words are not enough

Some text is *assembled*, not written. An object's name is built from a pattern
like `& Scroll~ titled #`. The `~` is an English pluralizer, the `&` becomes
`a`/`an` by the vowel after it, and the count goes in front. If your language
counts with a classifier, inflects for case, or has no plural `s`, no amount of
word replacement will get you there.

For that, a locale replaces the **function**. Those live in code, so a
translation that needs them ships a `plugin.js` alongside its JSON and calls
core's `registerLocale` with its own `forms`:

```js
export function register(host, ctx) {
  const core = ctx.core.coreForms();
  ctx.core.registerLocale({
    tag: "de",
    forms: {
      // English's machinery for everything except the nouns you care about
      objectNameFormat: (fmt, modstr, plural) =>
        fmt.includes("Scroll")
          ? (plural ? "Rollen" : "Rolle")
          : core.objectNameFormat(fmt, modstr, plural),
    },
  });
}
```

`coreForms()` is what makes this a small job rather than a rewrite: take
English's implementation, special-case what your language does differently, and
delegate the rest.

### Finding what is not translated yet

Not every string in the game has been routed through the translator yet. A
**pseudo-locale** is how you find the ones that have not: the bundled
`demo-resources` mod ships `en-XA`, readable English with every letter accented
and every string bracketed. Enable it, switch to it with `?lang=en-XA`, and
anything still in plain ASCII on the screen is a string that cannot yet be
translated. Those are worth reporting.

---

## Renaming a player-toggleable rule

A rule `flag` is durable player state. The player's choice is stored against that exact string in the host's own store, so replacing a flag outright orphans the choice: the lookup misses, the rule falls back to its declared `default`, and someone who turned your fix off gets it back on without being told. For a bug-fixes mod, whose defaults are all on, that means the game quietly re-applies a change the player had rejected.

So instead of simply replacing a flag, map each retired flag to its current rule under `renamedRuleFlags`:

```json
"renamedRuleFlags": {
  "bug-fixes.atomic-save": "bug-fixes.save-safety",
  "bug-fixes.atomic-crash": "bug-fixes.save-safety"
}
```

Every destination must be one of this manifest's current `rules`. A source must not be one: a flag you still declare is live, and treating its stored choice as retired would destroy a setting you still expose. Renaming a flag to itself is refused for the same reason.

The host migrates saved choices when it loads your enabled mod, before it resolves defaults. When several retired flags become one rule, the result is on if any of them was on. Turning off a fix the player had on would bring back a bug they chose to be rid of, whereas re-enabling a sibling is the smaller surprise, and they can still turn the whole rule off. A choice already recorded for the current flag wins outright, since it was made against the new release. The old entries are then consumed, so loading again changes nothing.

---

## Renaming a section or turning a rule into a section

Sections persist their choices separately from rules, under the owning mod and
the section's `id`. If you rename a section, or promote a `rules[]` entry into a
section so it can gate content, put its old names in the new section's
`renamedSectionFlags` list:

```json
"sections": [
  {
    "id": "text-corrections",
    "title": "Text corrections",
    "flag": "bugfix.textAndHistory",
    "renamedSectionFlags": ["bugfix.textAndHistory", "old-text-corrections"]
  }
]
```

Each name may find either a retired rule choice or a retired section choice. For
a previous section using its default flag, that name is its old `id`, which is
also the key the host stored; a previous section with a custom `flag` still uses
its old `id` for this purpose. Listing the current `flag` is valid and is how a
rule that became a section under the same name preserves its existing choice.

An explicit choice already stored for the current section wins. Otherwise the
host checks `renamedSectionFlags` in list order and copies the first matching
choice into the current section; if both stores happen to carry the same old
name, the old section choice wins. It consumes retired entries afterwards, so a
later load is unchanged. With no current or retired choice, the section uses its
declared `default` as usual.

---

## Front-end groundwork

The host draws through a renderer-neutral `GridSurface`, and the existing canvas terminal is one implementation of it. Menus are declarative front-end data. Request `registry:menu` and call `host.menus.register("core:game-menu", fn)` to rewrite one named menu's rows. The id is stable and is never a localized title. Each row carries a stable id plus `semantic.kind`, an optional `semantic.ref` and small scalar `semantic.data`, so an alternative layout can work from what a row means instead of parsing its label. If you need to wrap a transformer an earlier mod installed, call `host.menus.handlerFor(id)` before registering. A failed transform is reported, and the unmodified menu still opens.

`ModPlugin.frontend?(ctx)` is the single map-display slot. The frontend enabled later in load order wins, and only its factory is invoked; return a `WorldFrameSink`, or `undefined` to keep the glyph terminal. The host runs the world-render-data producer from its real map repaint and passes the winning frontend a frozen, renderer-neutral `WorldFrame` snapshot. Grids keep semantic terrain, trap, object, monster and path ids plus seen, remembered or unknown state. The glyph projection is only the current terminal fallback, including its terrain-under-foreground tile inputs, even for a path over otherwise bare seen terrain. The world data is therefore ready for an isometric or 3D consumer. TypeScript mods can write `import type { WorldFrame, WorldFrameSink } from "@rpgm-tools/neo-angband-mod-sdk"`; the import is type-only, so it does not break the folder-plugin rule against bare runtime imports. A control test runs the same producer `main.ts` calls, checks the unmodded glyph sink's pre-frame `term.put` tuples, and confirms that an independently owned host sink receives that exact frame in the same call. A disk fixture confirms that the later plugin receives the frame and that an unmodded control still paints glyphs. The snapshot has no mutable player-grid alias, so a frontend can keep a frame without keeping live game state.

Input is staged the same way. `UiInput` is available to host code through the single input door and can represent a continuous direction (vector, magnitude, angle) without translating it into a keyboard arrow. A plugin that declares `keymap:write` receives `ctx.keymaps` during a live game: `bind(trigger, action)` claims a free keyboard trigger, `entries()` lists only that mod's claims, and `rebind()` and `remove()` act only on those claims. A mod cannot inspect, replace or remove player bindings or another mod's bindings. A player edit takes ownership back, and when a mod is disabled or reloaded, host teardown first removes any bindings it still owns. `input-door.ts` stays host infrastructure and is not a capability. Player keymaps take precedence over any later input consumer while the root owns input; an active modal, score screen or run interruption still receives the player's literal key first.

## Knowing which mod a record came from

Every record the game binds carries `from` when a mod was involved. Reach a bound
record the way the binding exposes it - a monster race through the binding's
`races` array, an object kind through `registries.objects.kinds`, and so on;
there is no single `lookup` helper for every record type:

```js
const race = someBoundRace;   // e.g. from ctx.registries
race.from;            // { owner: "demo-modtest" }        - a mod ADDED it
someCoreRace.from;    // { owner: "core", modifiedBy: ["qol"] } - a mod CHANGED it
anotherCoreRace.from; // undefined                          - core's, untouched
```

`undefined` is the common case and it means "core's own, and nothing touched
it", exactly as `ext` does. So a plugin never has to tell "no mod" from "a mod
that left no mark", and a check like `if (race.from) ...` reads correctly.

`owner` is the pack that ADDED the record. A patch does not transfer ownership:
if your mod renames one of core's monsters, that monster is still core's - turn
your mod off and it is still there - so `owner` stays `core` and your id joins
`modifiedBy`. This matters beyond bookkeeping, because **`owner` is the
namespace a savefile stores the record under**. A monster your mod adds is saved
as `yourmod:its-name`; if it were saved as `core:its-name`, a player who removed
your mod would have a save asking the base game for content it has never heard
of, with nothing in the id to say who should have supplied it.

You do not write `from` and you cannot: it is stamped by the composer under a
reserved key that no mod can mint, because a mod's own fields must be namespaced
and the reserved key is not. Writing `"$from"` into your own JSON by hand is
ignored.

## Regenerating the blueprint table

`packages/mod-sdk/src/blueprints.ts` is generated from the shipped pack:

```bash
node packages/mod-sdk/scripts/gen-blueprints.mjs
```

Do not edit it by hand. `blueprints.test.ts` re-derives the whole table from
`packages/content/pack` and fails in both directions, and separately asserts
that it agrees, file for file, with core's own generated `CORE_RECORD_KEYS`:
the day those two disagree is the day a field is an extension at one end and a
core field at the other.
