# Authoring shortcuts: drafting a record that actually works

Adding a record to a pack has never been the hard part. It is JSON, and
composition takes it. Adding a record that **works** is the hard part, and it is
hard in a way no error message reaches:

- an object with no `alloc` is legal, loads cleanly, and never appears in the
  dungeon;
- a monster whose `base` is misspelled is legal, loads cleanly, and binds to
  nothing;
- a forty-first potion is legal, loads cleanly, and consumes the last unused
  flavour, so some other potion quietly stops being distinguishable.

Nothing in the pipeline can say any of that, because nothing in the pipeline
knows what a working record looks like. Core's own 3,279 records know, and the
SDK asks them.

Everything on this page is in `@rpgm-tools/neo-angband-mod-sdk` and needs no
game running.

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

`findings` holds what is still wrong with it — here, one hint that it has no
`desc`.

### Why "modelled on", not "assembled from defaults"

The first version of this built the shape from how often each field appears
across the whole file, and produced a sword carrying an `armor` block, because
59% of core's objects have one. **Field frequency across a file is not a fact
about any record in it.** So the shape is taken from core's nearest comparable
record and only the numbers are averaged.

A model never lends the fields that would confer behaviour or identity —
`flags`, `values`, `slay`, `brand`, `curse`, `effect`, `act`, `blow`, `spells`,
`name`, `desc`, `msg`. A template that quietly grants powers hands you an item
that does things you never asked for and would not think to look for.

---

## The pieces, separately

Every step of `draftRecord` is callable on its own.

| Call | Answers |
|---|---|
| `describeFile(file)` | what does a record of this kind contain? |
| `requiredFields(file)` | what do **all** of core's records here carry? |
| `fieldUsage(file)` | every field, most-used first, with its share |
| `templateRecord(file, scope)` | a starting record — `"required"`, `"common"` (default) or `"all"` |
| `peersFor(file, draft, records)` | which of core's records are comparable to this one |
| `suggestFields(file, draft, records)` | what core's comparable records would put in the gaps |
| `checkRecords(subject, all)` | every way these records will silently not work |
| `RECORD_BLUEPRINTS` | the raw measurement: per file, per field, count / types / range / observed values |

### "What should it cost?"

A price is not derivable from first principles — Angband's costs are hand-set —
but it **is** derivable from precedent, and precedent is what core's 375 objects
are. `suggestFields` narrows twice: to the same item type, then to the seven
records nearest in level. Only numeric fields are suggested; a name, a
description or a set of flags is a design decision.

With no comparable record it falls back to the file-wide median and says so in
the evidence line, so a weak suggestion is never dressed up as a strong one.

---

## What `checkRecords` finds

Two arguments, and the split is the whole design:

```ts
checkRecords(subject, all)
```

`subject` is what is **reported on** — your records. `all` is what they may
**resolve against** — core plus every loaded pack. Checking a mod against itself
would report every reference to core as broken.

Findings are graded, and **nothing here refuses anything**. The refusals live in
the manifest validator and the declared-field rule, where the rules are the
engine's own.

### It also runs when the GAME loads your mod

Since 2026-08-09 this is not only a build-time tool. `composeContentPacks` — the
function every host composes through — runs the same check over every pack it
loads and puts what it finds on that mod's own row in the mod manager, so a
player who installs your mod from a zip sees the same sentences you do. Three
differences from `build()`, all deliberate:

- **`warn` and above only.** A `hint` is drafting advice and belongs where you
  are looking at the draft. On a player's screen dozens of them would bury the
  one line that matters.
- **The base game is not reported on.** Core's own data raises warnings against
  core's own blueprint; those are upstream warts the port keeps on purpose.
- **A patch is checked as the record it produced**, not as you wrote it — so
  `{"speed": 120}` is not a record missing twenty fields.

The practical consequence: **your `build()` output is what your users will see.**
If it is clean at `warn`, their mod manager is quiet. There is nothing extra to
run and nothing to opt into.

| Level | Meaning | Examples |
|---|---|---|
| `error` | the record cannot work | a required field is absent; an artifact with no `base-object` |
| `warn` | it loads and will not do what it looks like it does | a dangling reference; no `alloc`; a field written as the wrong type |
| `hint` | worth a look | an unfamiliar field name (with a "did you mean"); no `desc`; nothing to attack with |

### Dangling references

`REFERENCE_EDGES` declares 37 fields that name another record — `object.type`
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
are not. They are all warnings or hints, because every one of them is legal —
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

Three things it deliberately does:

- **No filesystem.** `emit()` hands back paths and bytes; writing them is yours.
  The same builder works from a CLI, from a test, and from an in-game editor.
- **Checks the composed result**, not the draft. A patch that breaks a reference
  is invisible in your own files, because your files do not contain the record
  it broke.
- **Reports instead of throwing.** A missing dependency is an `error` finding,
  not a stack trace.

`build.ok` ignores warnings on purpose: every warning it can produce is
something core's own data does somewhere, so a builder that refused on them
would refuse to build Angband.

---

## What a mod can add a record to: 41 of 44 files

**Measured over the shipped pack**, and it used to be 24. Composition merges a
file per record when every record has a ref no sibling claims, and it asks
`packages/mod-sdk/src/record-key.ts` what a ref is — which is `name` for most
files and something else where upstream's identity is something else.

Until 2026-08-08 the test was "a unique `name`", and three files failed it on
core's own data, because Angband's convention for a greater form is to reuse the
name with marks — `Acquirement` and `*Acquirement*`, `Little eruption` and
`Little eruption+` — and `ego_item` ships 23 names twice over. So a mod adding
one object replaced all 375 of core's, one ego replaced all 107, one vault all
162. Those were the three files most worth adding to. They now merge per record:

| File | Records | A mod adding one record… |
|---|---|---|
| `object` | 375 | adds one — 376 |
| `ego_item` | 107 | adds one — 108 |
| `vault` | 162 | adds one — 163 |
| `store`, `flavor`, `brand`, `slay`, `object_base`, `trap`, `names`, … | — | adds one, keyed by whatever upstream keys it by |

**The three that still take a whole file, and why.** `constants` and `visuals`
are config singletons: their identity *is* the file, the host binds exactly one,
and "I shipped `constants.json`" means "use mine". `history` has no per-record
identity at all — a history record is `{chart:{chart,next,roll}, phrase}` and
every part of that is a value a mod would legitimately change. For those three,
`ModProject.build` still raises `file/whole-file-replacement` as an `error`,
because replacing the base game's copy of a file is not something to discover
from a line in a list.

### What a record is called

Refs did not move. The per-record identity was already what
`patchFields` / `replace` / `remove` used, so every ref that resolved before
still resolves:

- `object` is `type + name` — the Dagger is `core:sword--dagger`;
- `ego_item` is `name`, plus a `#` discriminator where core ships the name twice
  — `core:of-acid#shot-arrow`;
- `store` is its `STORE_*` code, `brand` and `slay` their `code`, `flavor` its
  base tval, and so on.

A record answers to **several** refs — its base key, its discriminated form, and
the pre-2026-08-08 lossy slug as an alias — so nothing an author wrote against an
older engine stops working. An alias is dropped where it would shadow a
*different* record's real name: `*Healing*`'s old ref is plain `Healing`'s
current one, and a record's own history must not cost another record its name.

That is **8 of the pack's 19 legacy aliases**, and it depends on core's data
rather than on the mark. `*Acquirement*` loses its alias, because core ships a
plain `Acquirement` scroll. `*Destruction*` keeps both of its — as a scroll and
as a staff — because core ships no plain `Destruction` at all, so there is
nothing for it to shadow. `of *Slay Orc*` loses its and `of *Slay Animal*` keeps
its, for the same reason. The full census is asserted row by row in
`record-key.test.ts`, so the count cannot drift back into prose.

None of the 8 cost anybody a working ref: every file carrying a legacy alias is
one that had *no* per-record addressing before the key table existed.

### Where a new record lands, and why it matters

At the **end**, after core's. That is not cosmetic. Upstream's `sval` is not a
field in the data — it is a counter, bumped per object base in file order
(`parse_object_type`, `reference/src/obj-init.c`), and `kidx` is the position in
the file. Appended, every one of core's 375 objects keeps its index, name, tval
and sval, and the new one takes the next free sval of its own base. Prepended,
every sword in the game would shift by one.

Composition appends because core is pack zero and a mod that declares `core` as
a dependency loads after it. `packages/web/src/mod-added-record.test.ts` binds
core's pack with and without one added object and asserts the whole table, not a
sample. The one thing that does move is the tail of dummy kinds `bindCore`
creates for special artifacts whose base sval `object.txt` never defines (the
Phial, the Star, the rings of power); their array index shifts by one and
nothing depends on it, because a savefile stores a namespaced string `kindId`
rather than a `kidx`.

---

## Shipping resources: sounds, a font, pref files, help pages, art

Records are not the only thing a mod folder can hold. Five other categories are
declared in one `resources` array in your manifest, each naming a `kind` and a
`path` **inside your mod folder**:

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
and two of the three places a mod can live have no path at all — a folder the
player picked, and a mod installed from a repository, which lives in the
browser's database. The host composes your path with your mod's own resolver.

| kind | what it is | several mods? |
| --- | --- | --- |
| `sound` | a **directory** of samples named as `sound.prf` names them, `.mp3` or `.ogg` | the last enabled one wins |
| `font` | a bitmap font, `{ "w", "h", "glyphs" }` — one scanline number per row | the last enabled one wins |
| `prefs` | a `.prf` in ui-prefs.c's own grammar; ASCII glyphs, colours and sound prefs apply at install, and TILE assignments layer over a graphics pack's own prefs on every map build | **all of them apply**, in load order |
| `help` | one page of plain text | per `slot` |
| `art` | one screen of `{colour}…{/}` markup | per `slot` |
| `locale` | one language, `slot` being its BCP 47 tag | per `slot` |

Three things that will otherwise cost you an afternoon:

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
you the pref file — not your records, not your sound pack, not the mod. But it is
never silent: whatever could not be used is written on your mod's row in the mod
manager, in a sentence saying what was wrong with it.

Three checks run, and the last one can only run on the player's machine:

1. **Your declaration**, at build time and again at load: an unknown kind, a path
   leaving your folder, an extension the kind cannot be, a slot no screen paints.
   A `slot` on a kind that has no slots is refused rather than ignored, because a
   silently dropped key is a belief of yours that would survive to ship.
2. **Your file list.** A mod read from a folder or installed from a repository
   arrives with every filename it holds, so a typo is caught without a single
   request. (Not available for a mod compiled into the app — check 3 catches
   those.)
3. **The machine.** Whether this build can play `.mp3` or `.ogg` at all, and
   whether your font JSON is structurally a font. Only opening the file can say.

The bundled `demo-resources` mod is a working example of four of the six, and
`packages/web/src/mod-resources.node.test.ts` reads it from disk in CI.

---

## Translating the game

English ships in the game and is what a player sees with no mod installed. A
translation is a `locale` resource — a JSON file whose `slot` is its language
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
the same fact and the check refuses them when they disagree — the slot decides
which language your file *is offered as*, and the tag decides what it *is*.

**You do not have to translate everything.** A missing id falls back through the
region (`pt-BR` → `pt`) to English, so a partial catalogue reads as part English
rather than as a screen of blanks.

### Patterns, not sentences you glue together

Messages are [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/)
— a subset, but the ordinary one, so ordinary translation tools can edit your
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
like `& Scroll~ titled #` — the `~` is an English pluralizer, the `&` becomes
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

A rule `flag` is durable PLAYER STATE, not an internal name. The player's answer
is stored against that exact string in the host's own store, so replacing a flag
outright orphans their answer: the lookup misses, the rule falls back to its
declared `default`, and someone who deliberately turned your fix OFF gets it
back ON without being told. For a bug-fixes mod, whose defaults are all on, that
is the game quietly re-applying a change they had rejected.

So do not simply replace one. Map each retired flag to its current rule under
`renamedRuleFlags`:

```json
"renamedRuleFlags": {
  "bug-fixes.atomic-save": "bug-fixes.save-safety",
  "bug-fixes.atomic-crash": "bug-fixes.save-safety"
}
```

Every destination must be one of this manifest's current `rules`. The source
must NOT be — a flag you still declare is live, and consuming its stored choice
as retired would destroy a setting you are still exposing. Renaming a flag to
itself is refused for the same reason.

The host migrates its saved choices when it loads your enabled mod, before it
resolves defaults. Where several retired flags become one rule, the result is on
if ANY of them was on: turning off a fix the player had on would reintroduce a
bug they had chosen to be rid of, and re-enabling a sibling is the smaller
surprise — they can still turn the whole rule off. A choice already recorded for
the current flag wins outright, since it was made against the new release. The
old entries are then consumed, so loading again changes nothing.

---

## Knowing which mod a record came from

## Front-end groundwork

The host draws through a renderer-neutral `GridSurface`, and its existing canvas
terminal is merely one implementation. Menus are now declarative front-end data:
request `registry:menu` and use `host.menus.register("core:game-menu", fn)` to
rewrite one named menu's rows. The id is stable and never a localized title;
each row carries a stable id plus `semantic.kind`, optional `semantic.ref`, and
small scalar `semantic.data`, so an alternative layout works from meaning rather
than parsing its label. Call `host.menus.handlerFor(id)` before registering when
you need to wrap a transformer installed by an earlier mod. A failed transform
is reported and the unmodified menu stays openable.

`ModPlugin.frontend?(ctx)` is now the one map-display slot. The later enabled
frontend wins, and only that factory is invoked; return a `WorldFrameSink` or
`undefined` to preserve the glyph terminal. The host invokes the extracted
world-render-data producer from its actual map repaint and passes the winner a
frozen, renderer-neutral `WorldFrame` snapshot: grids retain semantic
terrain, trap, object, monster, and path ids plus seen/remembered/unknown state,
while the glyph projection is only the current terminal fallback (including its
terrain-under-foreground tile inputs, even for a path over otherwise bare seen
terrain). That makes the
world data ready for an isometric or 3D consumer. TypeScript mods can write
`import type { WorldFrame, WorldFrameSink } from
"@rpgm-tools/neo-angband-mod-sdk"`; it is type-only, so it does not violate the
folder-plugin no-bare-runtime-import rule. Its Phase-4 control
executes the same producer `main.ts` calls, checks the unmodded glyph sink's
pre-frame `term.put` tuples, and proves an independently owned host sink
receives that exact frame in the same call. The Phase-5 disk fixture proves the
later plugin receives it and an unmodded control preserves glyph painting. The
snapshot has no mutable player-grid alias, so a frontend can retain a frame
without retaining live game state.

Input follows the same staged rule. `UiInput` is available to host code through
the one input door and can represent a continuous direction (vector, magnitude,
angle) without translating it to a keyboard arrow. There is no front-end or
input-binding plugin member yet: do not depend on one until its capability and
disk-loaded integration path ship. Player keymaps keep precedence over any later
input consumer while the root owns input; an active modal, score screen, or run
interruption continues to receive the player's literal key first.

Every record the game binds carries `from` when a mod was involved:

```js
const race = ctx.core.lookupMonster(reg, "Modberry Slime");
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
that it agrees, file for file, with core's own generated `CORE_RECORD_KEYS` —
the day those two disagree is the day a field is an extension at one end and a
core field at the other.
