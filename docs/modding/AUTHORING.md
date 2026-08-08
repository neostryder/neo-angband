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

## The one that is currently an error: adding to `object`, `ego_item` or `vault`

**Measured, and it is a live limitation.** Composition merges a file per record
only when every record's name slugs to a unique ref. Three files fail that on
core's own data, because Angband's convention for a greater form is to reuse the
name with marks — `Acquirement` and `*Acquirement*`, `Little eruption` and
`Little eruption+`, and `ego_item` ships 23 names twice over:

| File | Records | A mod adding one record… |
|---|---|---|
| `object` | 375 | **replaces all 375** |
| `ego_item` | 107 | **replaces all 107** |
| `vault` | 162 | **replaces all 162** |
| `monster`, `artifact`, `curse`, `terrain`, `room_template`, … | — | adds one record, as expected |

The loader has always reported this in `problems`. `ModProject.build` promotes
it to an `error` finding, because a line in a list is not proportionate to
deleting every object in the game.

**Until that is fixed**, `patchFields` / `replace` / `remove` work normally on
all three — per-record identity for them is declared in
`packages/mod-sdk/src/record-key.ts` (`object` is `type + name`, so the Dagger is
`core:sword--dagger`) — so a mod can change any existing object, ego or vault.
Only *adding* one is blocked.

The fix is to key composition by `recordRefKeys` (which already exists, already
proves 0 unaddressable records across the shipped pack, and already carries the
pre-2026-08-08 refs as aliases) instead of by `slugify(name)`. Tracked
separately.

---

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
