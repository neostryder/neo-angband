# Mod reach: what a mod can actually change today (measured)

> STATUS: MEASUREMENT, not design of record. Every claim below is a grep count or
> a `file:line` citation taken from the source on 2026-07-29. Where something
> could not be determined by reading, it says "not determined" and says what would
> have to be run. Nothing here is rounded up.

## Why this page exists

The ratified requirement is broad: *"It needs to be designed for modding. Mods
will be able to override code, resources, images, data, etc. The whole game and
its systems must be capable of being made over through modding. These seams must
be abstracted for varied modding."*

`docs/MODS.md` describes that target. `docs/modding/README.md` and
`MOD_LIFECYCLE.md` describe surfaces at different stages of existence. This page
exists because those pages cannot tell the reader which is which, and because
this project's governing lesson is that **code review cannot find absence**: a
capability that was never built reads as done. So the method here is grep counts
and citations, and the rule is that a seam only a BUNDLED mod or a TEST can reach
is not a capability - it is called out as such.

## Headline

| | measured |
| --- | --- |
| `ModHooks` behaviour hooks | **8** (`packages/core/src/mod/hooks.ts:84`) |
| Switches of >= 8 cases in the tree, counted by a script | **34** (`tools/switch-census.json`, re-derived 2026-08-09 after gap 16; was 47 that morning and 50 before the three glyph decoders became one registry) |
| ...still `CANDIDATE` — a dispatch point a mod cannot reach | **0** (was 18 on the morning of 2026-08-09). See the caution below: zero candidates is the end of what this TOOL can see, not the end of closed dispatch |
| ...of those, a mod's CODE can add to or override | **all of them** (`profile`, `blow`, `store` 2026-08-08; `projection`, `glyph`, `effect-info`, `randart`, `tval`, `rune` 2026-08-09) |
| ...reachable by a mod that is NOT compiled into the web bundle | **every one**, proven by a mod folder written to disk and imported for real (`packages/web/src/mod-code.node.test.ts`) |
| `registry:*` capabilities with real, wired, tested code | **15** (`blow`, `command`, `effect`, `effect-info`, `glyph`, `menu`, `monster`, `profile`, `projection`, `randart`, `room`, `rune`, `store`, `tval`, `vocab`) — the list is `REGISTRY_CAPABILITIES` in `mod/registry-host.ts`, which is the one source the vocabulary has |
| Non-test callers of that registry host in a RELEASE build | **1** — `packages/web/src/main.ts:10256` calls it for every loaded mod plugin, which is the disk path |
| Gamedata record files a mod can contribute to | **44** of upstream's 45 |
| ...of those, addressable PER RECORD (patch / replace / remove) | **43** of 44 — 24 by a unique `name`, 19 by a declared key (`record-key.ts`); since 2026-08-08 the same key also decides what a record ADDED to those files is called |
| ...whole-file-replacement only | **1** (`history`, whose records hold no field that is not a value a mod would change; an op against it is REPORTED) |
| Individual records of the shipped pack that NO ref can name | **0** — was 73 before 2026-08-08, 61 of them in `ego_item` |
| A mod can ADD a field core has never heard of, and read it at runtime | **YES** (2026-08-08) — on **15** bound record types, not 2; was silently dropped by every binder before |
| ...bound record types that carry a mod's own fields | **15** of the 44 files — the other 29 have no bound counterpart a plugin can hold, or bind into a structure keyed by something other than the record; `mod/extension.test.ts` lists them by name |
| A mod's added field is NAMESPACED and DECLARED, so two mods cannot collide | **YES** (2026-08-08) — `"gore:bleed"`, declared in the manifest under `fields`; undeclared is stripped and reported |
| Gamedata record files a mod can ADD a record to without replacing the file | **41** of 44 (2026-08-08) — was 24. `object` (375 records), `ego_item` (107) and `vault` (162) joined the other 38 when composition stopped keying on `slugify(name)` and started keying on `recordRefKeys`. The 3 left are `constants` and `visuals` (config singletons, where whole-file IS the meaning) and `history` (no per-record identity). `ModProject.build` raises a whole-file replacement as an `error` rather than a line in a list |
| An author is TOLD what a new record needs, and what core's comparable records do | **YES** (2026-08-08) — `draftRecord` / `checkRecords` / `ModProject`, measured from core's 3,279 records; **37** declared reference edges, each run over the shipped pack (`docs/modding/AUTHORING.md`) |
| Resource categories a non-bundled mod can supply or override | **7** of 7 (2026-08-09) - tiles (gap 8), then sounds, fonts, pref files, help pages and art (gap 7), then UI strings, which needed an i18n layer to be supplied INTO before the field could honestly exist (gap 14) |

> **The numbers in this table predate 2026-08-08 and are being re-derived row by
> row, not edited.** The dispatch-point rows above are now DERIVED - `47` and
> `18` come from `tools/switch-census.json`, which a test regenerates and
> compares, so a switch cannot be added *or removed* without the denominator
> moving. The hand-counted "25 enumerated dispatch points" they replaced was
> the kind of figure that only ever gets smaller. Seven rows of the gap list have now been re-measured; **four
> had gone stale in the direction that matters** - reporting a capability as
> missing after it shipped, gap 2 for nine days after phase 2 landed - and one
> (gap 6) has since been built and closed.
> **Gap 12 (2026-08-09) is the sharpest instance so far and the tally above does
> not yet count it**: the row did not merely understate a capability, it said
> "no such code exists" about a checker that was built, exported and tested. What
> was missing was its only caller. A row can be wrong about the CODE and not just
> about the reach, and reading it as a work order would have built a second,
> weaker copy of what was already there.
> That ratio is the finding: this page has been under-reporting reach, which is
> exactly how a plan quietly narrows. Treat any figure here as a lead until
> its row below carries a re-measured date. The counting method is what needs
> rebuilding: a census script, so that a new `switch` cannot be added without
> appearing in the denominator.

What a mod installed from disk can do today, in a release build: **contribute
gamedata JSON records** (43 of 44 files per record, and every individual record
of the shipped pack is nameable by some ref), **supply a tile pack** that registers its own Graphics row, **run its own
code** through `plugin.js` with the engine passed in, and reach the fifteen
capability-gated registries - including, since 2026-08-08, **its own kind of
dungeon level** (`registry:profile`) and **its own kind of monster attack**
(`registry:blow`), and since 2026-08-09 **what its own projection does** to
terrain, floor items and the player (`registry:projection`) and **what a symbol
in its own vault means** (`registry:glyph`).

The sentence that used to close this paragraph said the problem that remained
was the game's behaviour living in `switch` statements with nothing to register
into. As of 2026-08-11 that is no longer true and saying so would be the
staleness this document keeps warning about: the census carries **0 `CANDIDATE`
rows**. What remains is not a backlog of closed dispatch but the caution below -
zero candidates is the end of what the TOOL can see, and a dispatch point that
never grew to eight cases was never in its field of view.

> A correction to this table's own history: the row above previously named
> `player` as one of the six registry capabilities. There is no `registry:player`
> - the only occurrence of that string in the tree is a test asserting it is
> REJECTED. The count reached six only when `profile` was added, seven with
> `blow`, and eight with `projection`.

---

## (a) Code

### The 8 behaviour hooks, and what each can change

`ModHooks` (`packages/core/src/mod/hooks.ts:83`) is a typed interface of optional
functions on `GameState.modHooks` (`packages/core/src/game/context.ts:712`). See
`MOD_SEAMS.md` for the fold rules. What each one can actually change:

| Hook | Core call site | What a mod can change with it | What it cannot |
| --- | --- | --- | --- |
| `walkBlockedByDiggable` | `game/cave-cmd.ts:680` | Take over a walk into an impassable grid and set its energy cost | Anything about a walk that is not blocked; and see the 0-energy note in `MOD_SEAMS.md` - the call site tests `dug > 0` (`game/player-turn.ts:493`), so a handled-for-free walk is not honoured |
| `objectListTiebreak` | `game/obj-list.ts:242` | The order of two floor-list entries that compared equal on every upstream key | Any earlier comparator key; monster list ordering |
| `levelGenerated` | `gen/generate.ts:473` | Inspect / repair / reject a finished level | The generation ALGORITHM (no builder, room, or profile is reachable from here); and it may draw no RNG |
| `artifactCommit` | `obj/make.ts:987` | Refuse an artifact commit on an object already carrying one | Artifact selection, allocation, or properties |
| `historyAdd` | `session/game.ts:872` | Suppress one `HIST.SLAY_UNIQUE` entry | Any other history write - `session/game.ts:829` (`Reached level N`) does not consult the hook |
| `saveNoiseScent` | `session/save.ts:1203` | Ask for the noise/scent heatmaps in the save | Anything else in the save payload |
| `messageText` | `packages/web/src/main.ts:1244` (host, not core) | Restate message text | What a message MEANS - restating only, by contract |

Honest reading of that table: the 7 hooks were each carved for one bundled patch.
They are correct and they are generic in shape, but their union is not a system
anyone could "make over the whole game" with. They are seven points, not a seam
layer.

### Dispatch tables: the census

Angband is heavily table-driven, so the natural way to override code is to
replace an entry in a lookup table. Below is every behaviour-dispatch point I
found, with what a mod can do to it. "Reachable" means a NON-bundled mod; where
only a bundled mod can reach it, that is stated.

#### Real registries with a `register()` method — 7

| Registry | File | Entries | ADD | OVERRIDE | WRAP |
| --- | --- | --- | --- | --- | --- |
| `EffectRegistry` | `packages/core/src/effects/interpreter.ts:312` | **112** numeric codes | yes (string codes) | yes (`register` replaces, `:328`) | yes (`handlerFor(code)` `:323` returns the current handler, so a wrapper can call it) |
| `RoomRegistry` | `packages/core/src/gen/room.ts:2103` | **19** builders | yes | yes (`:2113` `map.set`) | yes (`get(name)` `:2117`) |
| `ActionRegistry` (player commands) | `packages/core/src/game/player-turn.ts:73` | **43** command codes in a fully-wired game | yes | yes (`:77`) | yes - and core already does this itself: `game/cave-cmd.ts:885` reads the prior `walk`/`jump` action and re-registers a wrapper |
| `DungeonProfiles` (cave builders + profiles) | `packages/core/src/gen/cave.ts:2758` | **9** builders (`:2839-2847`), **9** profiles (`:2854`) | `registerBuilder` `:2762` / `addProfile` `:2776` exist | yes, in principle | yes |
| `VocabularyRegistry` | `packages/core/src/mod/vocabulary.ts` | mod-owned, starts empty | yes | n/a | n/a |
| `BlowEffectRegistry` | `packages/core/src/combat/mon-melee.ts` | **30** RBE_ effects | yes (`define` from one spec) | yes (`register` replaces) | yes (`handlerFor(name)` returns the installed handler) |
| `StoreBehaviourRegistry` | `packages/core/src/store/store.ts` | **27** tvals + the buy rule | yes | yes (per store feat, or the `*` wildcard) | yes (`willBuyFor(ANY_STORE)`) |

The `ActionRegistry` count was measured as 34 distinct literal
`register("<code>")` calls across `packages/core/src` (none in
`packages/web/src`) plus the 9 codes that appear only in `STUBBED_COMMANDS`
(`game/player-turn.ts:703`, registered by the loop at `:736` with no literal):
`quaff`, `read`, `eat`, `use-staff`, `aim-wand`, `zap-rod`, `activate`, `look`,
`search`. Registration sites are `player-turn.ts:729-736`, `cave-cmd.ts:885-1108`,
`obj-cmd.ts:1473-1759`, `player-path.ts:1429-1433`, `ranged-cmd.ts:263-366`,
`spell-cmd.ts:291,351`, `pickup.ts:480-481`, `packages/core/src/game/steal.ts:163`, and `packages/core/src/game/trap.ts:754`
(which re-overrides `disarm`).

All four core registries are reachable through a deps bag rather than being module
constants - `deps.profiles` / `deps.rooms` at `gen/generate.ts:415,419`,
`ctx.registry.handlerFor(code)` at `game/effect-attack.ts:613`,
`processPlayer(state, registry)` at `game/player-turn.ts:772` - and three are
surfaced on the started game (`session/game.ts:396`, `:403`, `:507`). So the
plumbing for override genuinely exists.

**Both gaps this paragraph used to name are closed.** `REGISTRY_CAPABILITIES`
(`packages/core/src/mod/registry-host.ts`) now covers `effect`, `room`,
`profile`, `blow`, `store`, `command`, `monster`, `projection` and `vocab`: the
level-generation ARCHITECTURE (which builder runs, which profile is chosen)
arrived with `registry:profile`, monster blow effects - which had no registry at
all, only two switches - arrived with `registry:blow`, and the three projection
sides arrived with `registry:projection`.

#### Index-keyed handler arrays — 2

| Table | File | Entries | ADD | OVERRIDE | WRAP |
| --- | --- | --- | --- | --- | --- |
| `MONSTER_HANDLERS` (projection -> monster, `project-mon.c`) | `packages/core/src/mon/project-mon.ts:770` | 56 slots, 56 assigned | no (fixed length, `PROJ`-indexed) | **accidentally yes** | accidentally yes |
| `HANDLERS` (pref-file directives) | `packages/core/src/visuals/prefs.ts:499` | 13 | **yes** (`sound:`, from disk, 2026-08-14) | n/a | n/a |

**SUPERSEDED TWICE — read this before the paragraph below it.** What follows was
written when `MONSTER_HANDLERS` was a mutable exported array. It was frozen under
gap 15 on 2026-08-08 (`Object.freeze` at `project-mon.ts:861`), so the
"accidental seam" it describes has not existed since; and on 2026-08-14 it became
a REAL seam, seeded into `MONSTER_HANDLERS_BY_CODE` and reached as
`host.projections.mon` under the existing `registry:projection` grant — the
fourth projection side, after feat, obj and player. The historical text is kept
because the measurement it belongs to was taken at a particular date and
rewriting it would falsify the record; the row in the current table above is the
one to believe.

`MONSTER_HANDLERS` is the one accidental override seam in the port: it is
`export const … : Array<MonHandler | null>` - `const` binds the reference, the
array itself is mutable - and it is re-exported publicly
(`packages/core/src/index.ts:49`). The lookup is a closed module constant
(`MONSTER_HANDLERS[ctx.type]`, `project-mon.ts:840`), so an assignment would take
effect. Nothing in the repo does this. It is not a designed capability, it is
missing readonly-ness, and it should be treated as a defect rather than a
feature: it is ungated, unordered, un-composable, and invisible to the conflict
report.

#### Switch-based dispatch — not overridable by anything, at any tier

A `switch` cannot be extended, replaced, or wrapped from outside the function.
**The list below is no longer the census; `tools/switch-census.json` is.** A
hand-written inventory of switches only ever gets smaller - converting one to a
registry gets its row updated, ADDING one gets no row at all, and the list
quietly stops being a census while still reading like one. Several rows here
have already gone stale that way. `node tools/switch-census.mjs` counts every
dispatch point of >= 8 arms in the tree (**38 rows, 513 size labels** as of
2026-08-15: 34 `SWITCH`, 2 `ARRAY_LOOKUP`, 2 `IF_CHAIN`) and
`packages/web/src/switch-census.test.ts` fails when the tree and the manifest
disagree, so a new dispatch cannot arrive unnoticed.

**All 38 carry a verdict**, and the distribution is the useful result rather
than the raw count. This table is derived from `tools/switch-census.json`, and
it had gone stale exactly the way the paragraph above warns a hand-written
inventory does - it read `51 switches` and `22 CANDIDATE` until 2026-08-11,
months after the conversions that emptied the candidate column, and then read
`34 switches / 463 case labels / UI 12` until 2026-08-15, months after the
widening that added six rows. A count in prose is not a measurement; re-derive it
from the JSON before quoting it:

| Class | Rows | What it means for a mod |
| --- | --- | --- |
| `CANDIDATE` | 0 | Content dispatch a mod cannot reach. **The backlog is empty** - see the caution below for what that does and does not mean. |
| `UI` | 14 | Menu-action and keypress routing; rows 23/24 above own them as a class. |
| `REACHABLE` | 6 | Already behind a registry - the arm is core's registered handler, which a mod wraps through `handlerFor`. |
| `HOST` | 4 | Host wiring: CLI flags and the host RPC. Not game content. |
| `PARSER` | 3 | Grammars: the dice syntax and `lore.txt` directives. Deliberately closed - a mod changing dice syntax invalidates every record in every pack. |
| `LOCALIZATION` | 3 | Index-to-string tables. Row 14 of the gap list replaces the strings wholesale; converting the switch would not help. |
| `CONTROL FLOW` | 3 | Numeric buckets and geometry. Not dispatch at all. |
| `INTERNAL` | 3 | The save format's block union, the mod system's own capability vocabulary and its consent descriptions - all three grow only when core does. |
| `DEBUG` | 2 | Wizard-mode menus. |

The verdicts live in `tools/switch-census.json` and the class counts are
asserted in `switch-census.test.ts` against a **closed vocabulary**, because a
typo'd class (`CANDIDTE - `) would otherwise drop a row out of the candidate
count without failing anything. Adjudicating the backlog is what produced rows
26-28 above: three dispatch points this document had never listed.

These are the significant ones:

| What it dispatches | File | `case` labels |
| --- | --- | --- |
| **monster blow effects** (`mon-blows.c` `melee_effect_handler_f`) | `packages/core/src/combat/mon-melee.ts:460` | 26 |
| the SAME dispatch, a second time (`resolveBlowEffectLive`) | `packages/core/src/combat/mon-melee.ts:750` | 26 |
| ~~projection -> feature (`project-feat.c`)~~ **now a registry a mod can write** (`PROJECT_FEAT_HANDLERS`, keyed by projection `code`, `registry:projection`) | `packages/core/src/game/project-feat.ts` | was 37 |
| ~~projection -> object (`project-obj.c`)~~ **now a registry a mod can write** (`PROJECT_OBJ_HANDLERS`, keyed by projection `code`, `registry:projection`) | `packages/core/src/game/project-obj.ts` | was 11 |
| ~~projection -> player (`project-player.c`)~~ **now a registry a mod can write** (`PLAYER_SIDE_HANDLERS`, keyed by projection `code`, `registry:projection`) | `packages/core/src/game/player-side.ts` | was 21 |
| **store behaviour** | `packages/core/src/store/store.ts` (`storeWillBuy:235`, `massProduce:281` whose switch is at `:285`) | 27 |
| randart property construction | `packages/core/src/obj/randart-build.ts` | 111 |
| object naming / description (`obj/desc.ts` only - see the correction below) | `packages/core/src/obj/desc.ts` | 34 |
| tval CLASS MEMBERSHIP, miscounted as naming until 2026-08-09 | `packages/core/src/obj/object.ts` | 74 |
| ~~object knowledge~~ **now a registry a mod can write** (`RuneRegistry`, six tables keyed on `rune.variety` and OBJ_MOD, plus `contribute`; `registry:rune`) | `packages/core/src/obj/knowledge.ts` | was 43 |
| effect info strings | `packages/core/src/effects/effect-info.ts` | 52 |
| ~~UI entry types~~ **now two registries a mod can write** (`UiEntryRegistry`: combiners keyed by `combine:` name, renderer backends keyed by `code:`; `registry:ui-entry`) | `packages/core/src/game/ui-entry.ts` | was 32, then 9 + 6 |
| web UI context-menu routing | `packages/web/src/main.ts` (6 `switch (items[idx]?.action)` sites) | - |

**Correction, 2026-08-09: `obj/object.ts`'s 74 cases are not naming.** They were
filed under "object naming / description" from the first census and carried that
label through four re-measurements. They are `obj-tval.c`'s class predicates -
`tvalIsUseable`, `tvalHasVariablePower`, `tvalIsWeapon`, `tvalIsArmor`,
`tvalIsWearable`, `tvalCanHaveFlavor`, `tvalIsBook` - and the failure they cause
is not a missing word, it is a mod-coined tval answering **false to every question
core asks about an item class**: its items are not weapons, cannot be worn, cannot
be flavoured, cannot be browsed as a book, and are priced by the flat-cost path.
That is the same blind spot as `obj/make.ts` and `obj/value.ts`, so it belongs to
gap 28 and the three are **one seam**, not two. Only `obj/desc.ts` (34) is
genuinely naming. Mis-shelving it made the naming gap look twice its size and hid
the tval gap at a third of its.

**Second correction, 2026-08-09: the census reported ONE row for `obj/knowledge.ts`
and the file had six closed decisions.** The row it saw was `modMessage`, 11
cases on OBJ_MOD. Beside it sat five switches on `rune.variety` — `runeDesc`,
`playerKnowsRune`, `objectHasRune`, `playerLearnRune`, `runeName` — each under
the eight-case threshold, and all five keyed on a **closed TypeScript union of
seven string literals**. A union is a harder closure than a switch: a switch has
a `default` arm a mod-coined key reaches and fails at, which is at least
somewhere to stand, while a union refuses the key at the type level so no arm is
ever reached at all. The census counts neither a union type's existence nor its
size, at any threshold.

That is the same lesson as gap 28 (5 switches recorded; 34 predicates and 408
call sites in the file) in a new shape, on the same day. **The census measures
SYNTAX; a gap is about REACH.** So the headline's "0 candidates" means the census
has nothing left to point at — not that the tree has no closed dispatch. A
one-line `tval === TV.STAFF` and a seven-literal union are both exactly as shut
to a mod as an eighty-case switch, and this page, not that tool, is where the
remainder is tracked. Gap row 29 (the 108 raw `tval === TV.X` comparisons) is the
current example.

**Third instance, 2026-08-14 (#260), and the nastiest of the three, because it
made the census's denominator drift DOWNWARD with nobody writing it down.** The
tool asserts that converted files are ABSENT from `switch-census.json`, which
correctly catches a conversion that was claimed but never made. It could not
catch a dispatch that was merely RESHAPED — an if/else chain over an enum, or a
lookup into a module-level const array, is exactly as shut as a switch and
scored zero. So a file could leave the census by being FIXED or by being
RESHAPED and the two looked identical. It now counts all three shapes, tagged
`SWITCH` / `IF_CHAIN` / `ARRAY_LOOKUP`, and the ratchet asserts the difference
directly: `project-feat.ts` has zero rows of any kind (a real conversion), while
a merely reshaped file keeps exactly one row under a different kind.
`ui-entry.ts` was that worked example — and on 2026-08-15 (#283) it became a
registry, so it left the census a SECOND time, this time meaning it. The ratchet
now names `host/args.ts` and `target-loop.ts` as the still-reshaped pair, and
asserts `ui-entry.ts` absent alongside `project-feat.ts`. Row 18 above records
both halves.

The other thing gap 16 turned up is a CALLER, not a dispatch. `runeGroupIndex`
(`packages/web/src/knowledge.ts:545`) grouped runes for the knowledge browser and
was exhaustive by construction over the closed union, so it needed no `default`.
Opening the type meant a mod's rune would have been silently DROPPED from that
screen — learnable, describable and invisible. It now falls into "Other",
upstream's own catch-all group, where `flag` already lives. Letting a mod NAME
its own group is gap 9's business, not a second UI seam invented on the way past.

Two things stand out. **Monster blows are the clearest gap**: `blow_effects.json`
has 30 records and a mod can add a 31st, but the behaviour of each is a hardcoded
switch, so a new blow effect record is data with no handler. (The duplicated
26-case switch is separately worth knowing about - two bodies of one dispatch that
agree only by inspection.) **Store behaviour has no table at all**:
`StoreRegistry` (`packages/core/src/store/bind.ts:129`) is a `BoundStore[]` with
linear `byFeat` / `byName` scans, and what a store WILL BUY and how it stocks are
switches.

#### Generated `as const` tables — 31 files, none overridable

`packages/core/src/generated/` holds 31 codegen'd tables (from
`reference/src/list-*.h`, "Do not edit"). All are exported, all `as const`, none
frozen, none mutated anywhere in the repo, and all are module-level closed
constants with no deps-bag indirection - so **ADD / OVERRIDE / WRAP is "no" for
every one**. The largest:

| Table | File | Entries |
| --- | --- | --- |
| `MESSAGE_ENTRIES` / `MSG` (the `MSG_` table) | `generated/message.ts:7` | **154** |
| `EFFECT_ENTRIES` / `EF` | `generated/effects.ts:11` | **112** |
| `RANDART_PROPERTY_ENTRIES` | `generated/randart-properties.ts:7` | **95** |
| `MON_SPELL_ENTRIES` / `RSF` (monster spells) | `generated/mon-spells.ts:7` | **93** |
| `MON_RACE_FLAG_ENTRIES` / `RF` | `generated/mon-race-flags.ts:7` | **85** |
| `MON_MESSAGE_ENTRIES` | `generated/mon-message.ts:7` | **63** |
| `PLAYER_TIMED_ENTRIES` / `TMD` | `generated/player-timed.ts:7` | **53** |
| `OPTION_ENTRIES` / `OPT` (birth + all options) | `generated/options.ts:7` | **46** |
| `OBJECT_FLAG_ENTRIES` / `OF` | `generated/object-flags.ts:11` | **39** |
| `TVAL_ENTRIES` / `TV` | `generated/tvals.ts:7` | **36** |
| `PROJECTION_ENTRIES` / `PROJ` | `generated/projections.ts:11` | **31** (closed as a TABLE, open as a BIND - see below) |
| `ELEMENT_ENTRIES` / `ELEM` | `generated/elements.ts:7` | **25** |
| `ROOM_ENTRIES` / `ROOM` | `generated/rooms.ts:7` | **19** |
| `DUN_PROFILE_ENTRIES` / `DUN` | `generated/dun-profiles.ts:7` | **9** |

**`PROJ` is the exception, as of 2026-08-08.** The generated table is still
closed - it is upstream's enum and every value in it is a number the port hard
codes - but `bindProjections` no longer requires a record's `code` to be in it.
A code the enum has never heard of is appended after the 56 compiled-in slots,
in record order, so a mod can add a projection. This was not a missing feature
but a **crash**: the bind threw `projection: unknown code X`, and composition
merges `projection.json` per record (keyed by `code`), so the record arrived
intact and took the game down - the one content change that did.

Two things are still refused, because they would break core rather than extend
it: a new projection may not be `type: "element"` (the first 25 slots are
`list-elements.h` and `el_info[]` is indexed by ELEM value, so a new element
would be one the player could never resist), and a `code` that is not a plain own
property of the enum object - `code: "constructor"` previously resolved through
`Object.prototype` and bound at index `function Object()`, which a mod-supplied
code is what makes reachable. `world/projection.test.ts` asserts the whole
compiled-in table is byte-identical with and without an added projection, and
both refusals, and the control (a pack MISSING a projection still fails).

Plus two more closed tables outside `generated/`:

| Table | File | Entries | Overridable |
| --- | --- | --- | --- |
| `COMMAND_INFO` (upstream `game_cmds[]`) | `packages/core/src/cmd.ts:165` | **112** | no (`ReadonlyMap`) |
| `SOUND_PREF_ENTRIES` (`MSG_` -> sound) | `packages/core/src/sound/sound-prefs-data.ts:23` | **149** | no |

Note the asymmetry with `ActionRegistry`: the LIVE player-command seam is a
registry a mod can override, but the faithful `cmd.ts` `COMMAND_INFO` table (112
entries) that the web loop does not drive is a closed constant.

One field of it is separately reachable, and only one: the **verb**. `CommandVerbTable`
(`packages/core/src/cmd.ts:316`) is seeded per game from `COMMAND_INFO`'s verbs
and published on `GameState.commandVerbs`; `host.commands.setVerb(code, verb)`
names a mod's own command so the `!`-inscription confirm reads "Really dance with
your Potion of Death? " instead of the generic fallback (#284). That is a UI
string, not an entry: `repeat_allowed`, `can_use_energy` and `auto_repeat_n`
belong to the closed table and stay there, and `COMMAND_INFO` is still a
`ReadonlyMap` nothing writes.

#### Web UI tables — none reachable

`packages/web/src` holds roughly 22 named lookup tables. None is reachable from a
mod, and two are worth naming because they are what a UI mod would want:

- The **keypress -> command** table, `COMMANDS`,
  `packages/web/src/main.ts:7337` (62 entries, counted over lines 7337-7429;
  it "mirrors `cmd_lookup` exactly"). It is not exported and it is declared
  INSIDE the `window.addEventListener("keydown", …)` callback that opens at
  `packages/web/src/main.ts:7149`, so it is re-created per keypress and unreachable from outside
  the closure even to a bundled mod. It is scanned linearly at `packages/web/src/main.ts:7430`.
- `DEBUG_MENU`, `packages/web/src/wizard.ts:463` (9 categories / 41 items):
  exported and not `readonly`, so a bundled mod could mutate it. Same
  accidental-seam caveat as `MONSTER_HANDLERS`. **Both claims are stale:** both
  were frozen under gap 15 on 2026-08-08 (`deepFreezeMenu` at `packages/web/src/wizard.ts:520`,
  `Object.freeze` at `project-mon.ts:861`).
- The game menu and death menu are FUNCTIONS that build rows
  (`packages/web/src/game-menu.ts:56`, `:166`), not tables, so there is nothing to
  register into.

User-editable-but-not-mod-editable: keymaps (`packages/web/src/keymap-store.ts:20`,
localStorage) and the colour table (`packages/web/src/colors.ts`, localStorage +
`.prf`).

#### The denominator, stated so it can be audited

The headline "25 named behaviour-dispatch points, 5 mod-reachable" is this list.
It counts places where the game looks up **what to DO** by key or index -
deliberately NOT the pure data tables (`OF`, `TV`, `SQUARE`, flag lists), which a
mod would reach through records, not code.

| # | Dispatch point | Mod's code can add / override / wrap? |
| --- | --- | --- |
| 1 | `EffectRegistry` (112) | **yes**, from disk (re-measured 2026-08-08) |
| 2 | `RoomRegistry` (19) | **yes**, from disk (re-measured 2026-08-08) |
| 3 | `ActionRegistry` (43) | **yes**, from disk (re-measured 2026-08-08) |
| 4 | `GameState.monsterTurnHook` (1, all-or-nothing) | **yes**, from disk (re-measured 2026-08-08) |
| 5 | `VocabularyRegistry` (mod-owned) | **yes**, from disk (re-measured 2026-08-08) |
| 6 | `DungeonProfiles` builders (9) + profiles (9) | **yes** (`registry:profile`, 2026-08-08) |
| 7 | `MONSTER_HANDLERS` (56) | **yes** (`registry:projection`, 4th side, 2026-08-14) |
| 8 | prefs `HANDLERS` (13) | **yes** — a mod's `.prf` reaches `sound:` from disk (2026-08-14); the other 12 stay module-private |
| 9 | monster blow effects, recording path (30) | **yes** (`registry:blow`, 2026-08-08) |
| 10 | monster blow effects, live path (30) | **yes** — the SAME registry entry, which is the point |
| 11 | `PROJECT_FEAT_HANDLERS` (37, keyed by `code`) | **yes** (`registry:projection`, 2026-08-09) |
| 12 | `PROJECT_OBJ_HANDLERS` (11, keyed by `code`) | **yes** — the SAME registry, second side |
| 13 | store buy rule + `massProduce` (27 tvals) | **yes** (`registry:store`, 2026-08-08) |
| 14 | randart property switches (87 + 15 + 14 + 9 = 125) | **yes** (`registry:randart`, 2026-08-09) |
| 15 | object naming: `obj_desc_get_basename` (34) | **yes** (`registry:tval`, 2026-08-09) |
| 16 | object knowledge: `modMessage` (11) **plus five `rune.variety` switches the census could not see** | **yes** (`registry:rune`, 2026-08-09) |
| 17 | effect info switches (20 + 20 + 12 + 9 + 8 = 69) | **yes** (`registry:effect-info`, 2026-08-09) |
| 18 | UI entry dispatch (**was** a 32-case switch, then a 9-entry lookup array + a 6-arm if-chain) | **yes** (`registry:ui-entry`, 2026-08-15) |
| 19 | `COMMAND_INFO` faithful command table (112) | no - `ReadonlyMap`, but see the note: **parity artefact today**; its `verb` field alone is reachable (`registry:command`, `setVerb`, 2026-08-15) |
| 20 | `MESSAGE_ENTRIES` / `MSG` (154) | **yes** (`registry:message`, 2026-08-14) |
| 21 | `SOUND_PREF_ENTRIES` `MSG_` -> sound (149) | **yes** (`registry:message`, 2026-08-14) |
| 22 | `MON_SPELL_ENTRIES` (93) | **yes** (`monSpells` + `declareModMonsterSpells`, #281, 2026-08-15) |
| 23 | web keypress `COMMANDS` (63) | **yes** (`registry:menu`, 2026-08-14) — `core:keypress-command-table` publishes each command's label, category and bindings; the shell keeps its runnable closure |
| 24 | web context-menu `switch (action)` routing (6 sites) | **half**: rows yes (`registry:menu`), behaviour no |
| 25 | web `DEBUG_MENU` (41) | no - **deep-frozen on purpose**; struck from the count, see below |
| 26 | room/vault template GLYPH decoders (23 + 16 + 13) | **yes** (`registry:glyph`, 2026-08-09) |
| 27 | ~~`project_p` player side effects~~ **now `PLAYER_SIDE_HANDLERS`** (was 21) | **yes** — the SAME registry, third side |
| 28 | `tval`: 34 class predicates + `kindIsGood` + `objectValueBase` + the base NAME | **yes** (`registry:tval`, 2026-08-09) |
| 8a | `message_type` records -> sound samples (the content-pack door) | **yes** (2026-08-14) — samples now bind on the `already` and `refused` paths too, so a pack with no `plugin.js` can re-point MSG_HIT |
| — | A mod RENAMES one of its own rule flags without silently losing the player's saved choice | **yes** (#280, 2026-08-14) — declare `renamedRuleFlags` as retired flag -> current declared rule; the host rewrites its own rule-choice store when it loads the enabled mod, OR-folding many retired flags into one current flag. LISTED, not counted: it is a host/mod-state seam, not a dispatch point, so counting it would inflate the denominator this table exists to measure |

**Row 23 closed through the EXISTING menu registry, not a second input
registry** (2026-08-14). `commandTable()` keeps the memoised shell rows and
sends a declarative projection to `registry:menu` as
`core:keypress-command-table`: stable ordinal id, label, category, original and
roguelike bindings, control binding. **The `act` closure never crosses that
boundary.** A transformed known id maps back to its original closure; an
invented id has no shell action, and rather than resolving to whichever source
row shares its ordinal, the picker simply asks again. `chooseCommand` now calls
`selectFromMenu` for its category and command lists, so the registry can
retitle, reorder and re-tag what the player sees while the faithful
scrolling-box skin survives as the terminal fallback — that is what the new
`terminalPicker` option on `SelectMenuOptions` is for. The no-mod proof extracts
the real `buildCommandTable` declaration out of `main.ts` by AST and EVALUATES
it, then checks all 63 labels in order, so it measures the shipped table rather
than a copy of it. **The row also said 62 commands; the table has 63.**

**24 yes, 1 half, 2 no, of 27 counted** (re-counted 2026-08-15 against the code,
row by row; 28 rows are listed and row 25 is struck from the count — see the
corrections below). Row 22 closed on 2026-08-15 (#281); rows 7, 20, 21 and 8
closed on 2026-08-14. The tally is re-run when a row moves, which is the whole
point of the corrections below.
Row 8a is that same day's second half; it is LISTED rather than counted, because
it is a door into row 21 rather than a dispatch point of its own, and counting a
door twice is exactly how this tally drifted before. This is
a count of the ROWS above, which is the only
form of the tally anyone can check by reading the column; earlier versions mixed
rows with merged capabilities and the arithmetic quietly drifted. Every "yes" is
reachable FROM DISK, so the non-bundled figure is 16/16 of the reachable seams
rather than 0 - rows 9 and 10 are one capability delivered twice on purpose, two
bodies of one dispatch, and a registry only one of them consulted would be worse
than none, and rows 11/12/27 are one capability delivered three times for the
same reason.

**Row 8 read "no - module-private", and the reason was a stale comment.**
`sound:` was never module-private — it was ABSENT. Upstream registers
`parse_prefs_sound` into the same parser as the other fifteen directives
(`reference/src/ui-prefs.c:1157`); the port dropped it because it had no mixer,
and the comment justifying that (in `prefs.ts`'s unknown-directive branch)
claimed the bundled prf files carried `sound:` lines. Measured 2026-08-14: **no
`.prf` this port ships carries one.** The 447 of them live in
`reference/lib/customize/sound.prf`, which is a BUILD input to
`gen-sound-prefs.mjs` and which nothing parses at runtime. So restoring the
directive is a PORT, not an addition, and the doctrine question never arose.
The lesson generalises past this row: a census answer inherited from a comment
is an answer about the comment.

**The tally above was wrong for five days, in the same file, three lines from
the table that disproved it.** It read "17 yes, 2 accidental, 9 no". Counting
the column gives 18 yes. The missing one is row 26, which the paragraph below
corrects to "yes" and which was then never added back to the arithmetic — the
correction was written and the sum was not re-run. That is worth more than an
apology: a hand-maintained tally three lines from its own source data still
drifted, and the only reason anyone noticed is that the rows were re-read
against the code on 2026-08-14 rather than against this document.

**Two rows were also mislabelled, and in the direction that invents seams.**
Rows 7 (`MONSTER_HANDLERS`) and 25 (`DEBUG_MENU`) both read "accidental only —
exported mutable array". Neither is: `packages/core/src/mon/project-mon.ts:801`
is `Object.freeze`d behind an IIFE with a comment saying it is deliberately not
a mod seam, and `packages/web/src/wizard.ts:520` is built by `deepFreezeMenu`.
Both were shut under gap 15 on 2026-08-08. A stale "no" under-reports the work;
a stale "accidental" **advertises a seam that does not exist**, and an author
could have planned a mod against either. They are counted as "no" above, which
is what they are.

**Not re-derived: the "16/16 of the reachable seams" figure below.** It was
computed when the tally said 17, it counts merged capabilities rather than rows,
and nobody has worked it out again. It is left as written rather than adjusted
to match, because a number nudged to agree with a corrected total is worse than
one openly marked as unverified. See #259.

**Rows 7, 20 and 21 closed on 2026-08-14, and each carried a lesson worth more
than the row.**

*Row 21 (`SOUND_PREF_ENTRIES`) was not only a producer problem — it was an
ORDERING problem, and that half was invisible to inspection.* `installWebSound`
runs at `packages/web/src/main.ts:8845`; a plugin's `register()` runs at `:10851` (the trusted
path, inside `installTrusted`) and `:11039` (the folder loop). A registry read
only at install time would have been read BEFORE every mod that can write to it —
correct-looking code that works for nobody. That is the second of #159's two
documented failure modes, and `soundPrefRegistry.onAdd(...)` is what makes the
engine take later contributions.

> *The three line numbers in that paragraph were `:8821` and `:10985` until
> 2026-08-14, and re-measuring them at HEAD moved every one.* The LESSON is
> unchanged and is the part to remember — `installWebSound` still runs first, by
> roughly two thousand statements — but a `file:line` in prose is the part of
> this document that rots, and it rots silently. Prefer the ordering claim to
> the coordinates.

*Row 20 (`MESSAGE_ENTRIES`) was a crash, not a missing feature.* A `msgt:` naming
a type core had not heard of threw `PARSE_ERROR_INVALID_MESSAGE` and took the
whole bind down. `MSG` is now closed as a TABLE and open as a LOOKUP — the same
split `PROJ` has — so a registered name resolves at index 154 and up and all five
consumers widen at once. **No save impact, and it was verified rather than
assumed:** `checkMsgt` returns the NAME, every consumer types it `string`, and
resolution to a number happens at message time, so nothing a save holds is
renumbered and disabling the mod cannot corrupt one. That is what made these two
rows different in kind from row 22 — where `RSF` was a bit position that IS
persisted. **That difference is gone as of #269**; see the row 22 correction
below.

*Row 22 (`MON_SPELL_ENTRIES`) — the blocker was the SAVE, and it is removed
(#269, 2026-08-14).* Row 22 stayed "no" while `PROJ`, `MSG` and
`SOUND_PREF_ENTRIES` opened, and the discriminator was never the table: it was
that monster lore persisted the player's spell knowledge as RSF **bit
positions**, so appending a slot renumbered what an existing character already
held. A message type resolves to a number at message time and nothing a save
holds indexes it; an `RSF` slot IS the index. Three options went to the owner and
**(A) was chosen** — convert the persistence, do not append. "Just append to RSF
now" was rejected outright as silent corruption of existing characters.

`SavedLore.spellFlags: number[]` (the raw `FlagSet` bytes) is now
`SavedLore.spellsKnown: string[]` (RSF names), at `SAVE_VERSION` 5 with the
`V4_TO_V5` step that reads every version-4 savefile. `lore.txt` had been
name-keyed all along (`writeLoreEntries`), so this is the savefile half catching
up rather than a new idea. A name cannot be renumbered; a name this build does
not have is dropped rather than landing on whatever now occupies its old index;
a build whose table is larger, smaller or reordered reads back exactly what was
written.

**The control is what makes this a measurement rather than a claim.**
`session/lore-spells.test.ts` renumbers the RSF table by inserting one entry and
reads the same pre-existing knowledge under both schemes: the byte-keyed read
turns `["BR_FIRE", "HASTE"]` into `["BR_ELEC", "HOLD"]`, and the name-keyed read
is unmoved. A round-trip test that only exercised the happy path would have
passed against the shape this removed.

**#269 left the row "no" and the tally unchanged** — it opened nothing; it
removed the reason opening was unsafe. Appending to `MON_SPELL_ENTRIES` became
a question about the table (sizing `RSF_SIZE`, the `create_mon_spell_mask` type
expressions, the spell effect and message data a new entry would need) and no
longer a question about whether it eats saved characters. That remaining work
is what #281 closed.

*Row 22 (`MON_SPELL_ENTRIES`) is OPEN (#281, 2026-08-15).* The name table from
step one (`mon/spell-registry.ts`) is wired end to end:

- **Declaration step** — `mon/spell-declarations.ts` / `declareModMonsterSpells`,
  called from `bindCore` immediately after `declareModMessageTypes` and before
  `bindMonsters`, with `monSpells.clear()` at the head of each bind so one
  character's mods cannot leak into the next. `CorePack.monsterSpells` is the
  pack field (same `unknown[]` shape as `messageTypes`). Ordering is pinned by
  `mon/spell-declarations.test.ts`.
- **Four name→index sites** resolve through `spellIndexOf` rather than raw
  `RSF`: `spellFlagsOn`, `bindSpells`, `bindAltMsgs` in `mon/bind.ts`, and
  `orSpellFlags` in `gen/gen-monster.ts`.
- **Live FlagSet sizing** — production reads of the module-captured `RSF_SIZE`
  const are now `rsfSize()` in `gen/gen-monster.ts`, `mon/bind.ts`,
  `mon/lore.ts`, `mon/lore-describe.ts`, `mon/lore-file.ts`, `mon/predicate.ts`,
  `mon/spell.ts`, and `session/save.ts`. Test files that assert a fact about the
  compiled table still import `RSF_SIZE` deliberately.
- **`monSpellsOfTypes`** walks mod entries via `monSpells.typeAt` after the
  compiled prefix, so `innateMask` / `breathOrInnateMask` /
  `monsterHasNonInnateSpells` see a mod's `RST_` expression.
- **Lore serializers** — `serializeLoreSpells` / `deserializeLoreSpells` bound
  on `rsfMax()` and resolve through `spellNameAt` / `spellIndexOf`. A mod spell
  name round-trips; a name this build does not have is still dropped (#269's
  contract). Pinned by `session/lore-spells.test.ts`.
- **End-to-end** — `mon/spell-declarations.test.ts` boots a real pack with one
  extra `monster_spell` record and a `monsterSpells` declaration through
  `bindCore`, and checks the race flag bit, the name round-trip, and the
  `RST_BOLT` mask placement.

**The one number to check twice** is where a mod's first spell lands.
`MON_SPELL_ENTRIES` has 93 rows for 91 spells, because row 0 is `RSF_NONE` and
row 92 is the `RSF_MAX` end marker — so the first mod slot is **92**, the
sentinel's own index, not 93. The inverted enum answers `"MAX"` at 92, which is
why reading `RSF_FLAG_NAMES` by position has to stop at the callers rather than
be corrected inside them. Both facts are pinned by
`mon/spell-registry.test.ts`, not left to this paragraph.

**The same defect one table over is fixed too (#273, 2026-08-14).**
`SavedLore.flags` (`MON_RACE_FLAG_ENTRIES`, 85); `SavedObject.flags`,
`SavedPlayer.objKnown.flags` and `SavedMonster.knownPstateFlags`
(`OBJECT_FLAG_ENTRIES`, 39); `modifiers` (`OBJECT_MODIFIER_ENTRIES` via
`OBJ_MOD`, 16 — **not** `OBJECT_FLAG_ENTRIES`, as this paragraph previously
said); and `elInfo` (`ELEMENT_ENTRIES`, 25) all persisted raw positions until
`SAVE_VERSION` 6. They are names now, with the `V5_TO_V6` step that reads every
version-5 savefile and a four-way renumber control
(`session/save-flag-names.test.ts`).

**And the tally is still unchanged.** None of the four is a counted switch row,
and the row that does cover them — the 31 generated `as const` tables — never
gave persistence as its blocker. Its blocker is that every one is a
module-level closed constant with no deps-bag indirection, and #273 does not
touch that. Removing a blocker is not opening a seam. What changed is that
appending to or reordering `RF`, `OF`, `OBJ_MOD` or `ELEM` is now a question
about the table and no longer a question about whether it eats saved
characters.

**Still persisted as positions, and out of #273's scope:** `SavedMonster.mflag`
(MFLAG), `SavedTrap.flags` (TRF), `SavedMonster.mTimed` (MON_TMD),
`SavedPlayer.timed` (TMD), `.skills`, the STAT-indexed stat arrays, and the
square `info` flags in the chunk snapshot. **The sweep found seven more of the
same kind than the ticket named** — #269's note said the defect was live "one
table over" and it was live eleven tables over. Recorded here for the same
reason the previous version of this paragraph was: findable is the point.

*Row 7 (`MONSTER_HANDLERS`) — and the ticket's own description of it was wrong.*
It said a mod's projection "does literally nothing to a monster". Measured, the
monster took 34 damage: `project_m`'s driver applies `ctx.dam` whether or not a
handler ran. What had no way to happen was everything TYPE-SPECIFIC — resistance,
immunity, scaled damage, fear, stun, confusion, polymorph, teleport, the
"unaffected" line, obviousness. A mod's projection could only ever be an untyped
hit for exactly its dice. The corrected claim is narrower and the control that
proves it is stronger.

**One gap opened by closing these, now closed (#266), and THE ORDER WAS
MEASURED.** `registry:message` let a plugin declare a message type, and the only
door to that facade is the `ModRegistryHost` a host builds for `register()`.
Wrapping `messageTypes.lookup` and booting a real game with a monster spell
carrying `msgt: PROBE_FLARE` put the resolution at `mon/bind.ts:609`
(`checkMsgt`), under `bindMonsters` inside `bindCore` (`session/boot.ts`), under
`startGame` (`session/game.ts:3042`) —
and `startGame` did not return, it threw `PARSE_ERROR_INVALID_MESSAGE`. Parsing
`main.ts` puts that call at top-level statement 182 (`const game = bootGame()`)
and the earliest `register()` at statements 561 and 566, all direct children of
the module. **384 top-level statements separate the two.** A message type
declared in `register()` is declared after every record that could have named it.

Worse than late: for a pack with no `plugin.js` there is no `register()` at all,
so the capability was **unreachable** rather than merely mistimed — and that is
most of the packs that want one, because a message type is what a spell or a
sound pack ships, not what a systems mod ships.

The answer is the one `bindProjections` already gives. A mod's new `PROJ` code
works because `projection.json` is pack DATA that arrives through composition,
not a plugin call, so it exists before the binder asks. Message types now do the
same: `declareModMessageTypes`
(`packages/core/src/mod/message-declarations.ts`) appends a pack's
`message_type` records — name, `sound.prf` key, and the sample list, because a
content-only sound pack that could name a type and never bind a sample to it
would be half a capability — after the 154 compiled slots and before
`bindMonsters` and `bindProjections` run. `MESSAGE_ENTRIES` itself stays
generated from upstream's `list-message.h`: **core adds nothing.**

**No capability gate, deliberately.** `registry:*` gates trusted in-process CODE.
These are records, and a content pack can already add a projection, a monster, an
artifact and an ego item with no capability at all; gating one record file and
not the other twenty would be a fence with no wall attached.

**Nothing in the pass throws.** Every refusal `MessageTypeRegistry` makes is a
name that already resolves somewhere (a compiled-in `MSG_`, a numeric index, an
earlier pack's declaration) or one that can never resolve at all, so the record
naming it binds or fails on its own merits either way — and a message type is
never what should stop a game from booting. A refused declaration loses one
message type and reports it.

**Two of these 21 "yes" rows have now been checked for reachability IN PRACTICE
rather than in principle, and both were defective.** Row 21's registry was
readable and writable and was read before anything could write to it; #266's
capability had a door only code could open, in a family whose typical author
ships no code. That is the measured fact and it is the whole of it — **the other
19 are not hereby suspect**, because nothing has been measured about them. What
it does say is that "a registry exists and a mod can call it" is a weaker claim
than it reads as, and the two checks that were run are the only two that have
been.

**Row 25 is struck from the count, and kept in the table.** `DEBUG_MENU` is the
wizard-mode menu. `packages/web/src/wizard.ts:508-518` says in the source that the table must
match the C exactly because parity tests count its letters, `switch-census.json`
already classes both `wizard.ts` rows as DEBUG, and a mod extends wizard mode
through the command seam instead. So the "gap" consists entirely of the project
having deliberately closed a hole it had named — counting that as an open gap
dilutes the ones that are real. Struck rather than deleted, because a row that
vanishes from a denominator is indistinguishable from a row nobody looked at:
the three finished states are *closed*, *not applicable* and *deliberately
shut*, and "removed from the table" is not one of them.

**Row 23's stated blocker was stale, and the row is much cheaper than it read.**
It said the command table is "declared INSIDE the keydown callback, re-created
per keypress, unreachable from outside the closure" at `packages/web/src/main.ts:7337`. That code
is gone. It is now module-level and memoised — `buildCommandTable` at
`packages/web/src/main.ts:8104`, `commandTable` at `:8288`, with a header
comment at `:8095-8102` saying so. The row is still "no", but for a different
and smaller reason: neither symbol is exported, and `chooseCommand`
(`command-menu.ts:259`) uses its own `runMenu` rather than the `selectFromMenu`
choke point, so `registry:menu` does not reach the command browser either. That
is an export-plus-registry job, not a refactor.

**Row 24 was reading as "nothing", and it is half closed.** `registry:menu`
ships, is capability-gated (`REGISTRY_CAPABILITIES.menu`,
`packages/core/src/mod/registry-host.ts:166`; `MenuRegistry` at
`packages/web/src/menu-registry.ts:47`) and reaches all six sites through
`selectFromMenu`'s stable ids: add, reorder, relabel, retag and remove all work
today. What does NOT work is attaching BEHAVIOUR to a row a mod invented —
`overlay.ts:1511-1513` maps the chosen row's stable id back through
`originalIndex` and returns SILENTLY for a row the transformer invented, while
the presenter path refuses out loud at `:1805-1810`. Gap 21 further down states
this correctly, so until now table (a) and the gap list contradicted each other.

**Row 18 was reshaped rather than converted, and that is why the census stopped
seeing it** (#260). The 32-case switch this row was written about no longer
exists, and `ui-entry.ts` was absent from `switch-census.json` entirely — which
read exactly like a conversion until somebody checked. It was not one:
`COMBINERS` was a 9-entry module const that `combinerLookup` linear-scanned by
name, and it was as shut to a mod as the switch it replaced. The census now
counts lookup arrays and if/else chains as well as switches, so this row got a
successor row.

**And on 2026-08-15 it was converted for real** (#283). `UiEntryRegistry`
(`packages/core/src/game/ui-entry-registry.ts`) is two name-keyed tables — nine
combiners and six renderer backends — built per game in `wireGame`, published on
`GameState.uiEntry`, and reached by a mod through `registry:ui-entry`. The
census row is gone the way `project-feat.ts`'s went: zero rows of any of the
three kinds, asserted in `switch-census.test.ts` rather than claimed here.

Two things about the shape are worth stating, because both were traps:

- **The live key is the NAME, resolved at compute/apply time.** Lookup was
  always by name at parse, but STORAGE afterwards was by position — a 1-based
  `combinerIndex` and a 0..5 `backendIndex` — so reordering either core table
  silently retargeted every built config. Keeping the slot as the long-lived
  identity would also have frozen core's tables at nine and six and made a
  post-wire `register()` inert: a registered handler has no slot. `UiEntry`
  carries `combinerName` and `RendererInfo` carries `backendName` /
  `combinerName` instead. Neither index was ever written to a save — nothing
  under `packages/core/src/save/` reads either field — so this was a code change
  and not a save migration.
- **Survival is preserved, not replaced.** A combiner name nothing answers for
  still resolves to `ABSENT_COMBINER` and a backend name nothing answers for
  still returns the empty-cell row, which is #271's guarantee. Opening a table is
  not licence to make a typo fatal again;
  `ui-entry-unknown-combiner.test.ts` still holds that end.

The proof that a mod can reach it is `ui-entry-registry-wiring.test.ts`, which
starts a real game, registers through the capability-gated facade AFTER the
wiring, renders a real `characterGrid` and a real `equipCmpSummary`, and asserts
the CELL changed — against two controls (core's combiner, and the same pack with
nothing registered) that agree with each other, so a subject matching either
would not have counted. It also asserts the ORDERING half: a registration made
after the config was built still takes effect, which is the failure row 21 made.

**Before that it was shut rather than fatal, which was a different row
entirely** (#271, 2026-08-14). `combinerLookup` returning 0 for an unknown name used to reach
`combinerFuncs`, which threw `bad combiner index 0` — and the PARSE path never
threw, so a pack with one typo'd `combine:` line **loaded clean** and then took
the session down on the first value or render use: the character sheet, or the
equip-comparison screen. Upstream is no defence for that.
`ui_entry_combiner_get_funcs` (`reference/src/ui-entry-combiner.c:111-120`) also
returns 0 and its callers `assert(0)` (`ui-entry.c:694-696`, `:892-894`), which
under NDEBUG is undefined behaviour, not a diagnostic; the port had converted it
into an unconditional throw, which is strictly worse for a player. An
unresolvable index or name now yields `ABSENT_COMBINER` (`:477`) —
`init`/`accum`/`finish`/`vec` all `UI_ENTRY_VALUE_NOT_PRESENT` — so the row reads
as "nothing here" and the screen still draws. Same answer the projection bind
reached for an unknown code on 2026-08-09. Six tests hold it
(`ui-entry-unknown-combiner.test.ts`), the fourth of which rebuilds the shipped
`ui_entry` records with every `combine:` replaced by a name nothing knows and
asserts `characterGrid` still returns a full grid. **The row stayed "no" on that
day:** survival is not reach, `COMBINERS` still had nine names and no mod could
add a tenth. #283 is what changed the answer, and the survival behaviour above is
unchanged by it.

**The renderer half was an edge the widened census could not reach, and it went
in the same commit.** `applyRenderer` sat beside `COMBINERS` in the same file and
was a **6**-arm `if (backend === UI_ENTRY_RENDERER.X)` chain, not 8. It was
exactly as closed to a mod as an 87-case switch and it stayed invisible, because
dropping the threshold below 8 reopens a false-positive flood — the naive version
of the detector fired on 122 rows of ordinary control flow, RNG tables and colour
palettes. So this row was half-derived and half read by hand. The six arms are
now six `UiEntryBackendRender` functions in `UiEntryRegistry.backends`, keyed by
the name a renderer record's `code:` field writes. The empty-cell fallthrough
survives, and is now the answer for a backend name nothing answers for — the
renderer-side twin of `ABSENT_COMBINER`. **The tool's limit has not moved**; only
this instance of it has, and a six-arm chain elsewhere in the tree is still
invisible to the census.

**Row 19 is a parity artefact, not a gap a player can observe.** `COMMAND_INFO`
(`packages/core/src/cmd.ts:165`) is still a `ReadonlyMap`, but `new CommandQueue`
has NO production caller — the web shell drives `commandBuffer`
(`packages/web/src/main.ts:6053`) into the `ActionRegistry`, which row 3 already scores yes.
Extending `COMMAND_INFO` today changes nothing anyone can see. It is NOT struck,
because `game/display.ts:293` carries PORT_TODO 3.11 pointing at
`CommandQueue.getNRepeats`: if that lands, the row becomes sharp, and a
`registry:command` mod's code is silently dropped at `cmd.ts:543-544`
(`if (!info) return;`) and refused at `:488`. Counted as "no" so that it stays
visible, and labelled so nobody scopes it as urgent.

**One field of row 19 WAS observable, and is now closed** (#284). `cmd_verb`
reads a command's verb, and `get_item_allow` puts it in the "Really %s %s? " an
inscribed item demands (`game/inscription-confirm.ts:111`) — a path the web
shell absolutely does drive, from `main.ts`'s `allowChosenItem`. Because
`COMMAND_INFO` is keyed by the closed `CommandCode` union and a mod's code is a
free string, every such prompt for a mod's command read "Really **do that with**
your Potion of Death?". `CommandVerbTable` (`cmd.ts:316`) fixes exactly that one
field and nothing else, and the fix was deliberately NOT a conversion of the
command table: `CommandQueue` still has no production constructor, the dispatch
still belongs to `ActionRegistry`, and this row stays "no" for everything but
the verb.

**Row 26 was stale for a day, and this is what that looks like.** The glyph
decoders became a registry on 2026-08-09 and gap row 17 below said so, while
this row still read "no" - the same document disagreeing with itself, in the
direction that under-reports the work. It is corrected here rather than quietly:
`tools/switch-census.json` is the derived denominator precisely because this
table is maintained by hand, and `switch-census.test.ts` now asserts that
`gen/room.ts` and the four effect-info files are ABSENT from the census, so a
conversion cannot be claimed here without having been made in the code.

#### The projection family, and the day it spent converted but unreachable

Rows 11, 12 and 27 are the three `project_f` / `project_o` / `project_p` handler
tables. They became keyed registries on 2026-08-08/09, each with a documented
override field - and for a day **all three read that field from an object
nothing ever wrote.** `session/game.ts` built its `ProjectFeatEnv` as
`{ makeDeps }` and called `makePlayerSideEffects` without `playerHandlers`, so
the compiled-in table won every time. This document recorded two of the three as
**yes** on the strength of the field existing, which is the whole failure in one
sentence: a field a mod cannot set is not a seam a mod can use.

The producer landed 2026-08-09 as `registry:projection`
(`game/projection-handlers.ts`): one `ProjectionHandlerRegistry` per game,
seeded with core's 69 handlers, published on `GameState.projectionHandlers`, and
handed to the engine BY IDENTITY - `wireGame` passes the live Maps, so a handler
installed by a plugin's `register()`, which runs after the wiring, is dispatched
to on the next projection.

**Composition is per CODE, not per table.** A mod calls
`host.projections.player.set("FIRE", h)`, and `handlerFor(code)` returns whatever
is installed at that moment - core's, or an earlier mod's - so mod B wraps mod
A's handler exactly as mod A wraps core's. The override fields are typed as whole
tables and a whole table cannot compose: the second mod to hand one over would
discard the first, along with its brand-new projection, silently.

Proven twice, because "installed" and "consulted" are different claims:
`mod-code.node.test.ts` loads a mod folder from disk and runs the real
`projectFeature` over the table it wrote into; `packages/core/src/session/
projection-registry-wiring.test.ts` starts a real game and fires a real
projection through `wireGame`'s own `CastContext`, with a control run first that
watches core's handler do core's job.

Two live defects surfaced from actually using the seam, both of them the same
shape as the one above - an optional nobody supplied:

- `castProjection` handed `project_o` the env WITHOUT the bound projection
  table, so a mod's own projection could burn terrain and not objects. The
  terrain hook had been given it; the object hook had not.
- `PlayerSideDeps.msg` was never supplied by `wireGame`, so **every** message
  `project_p` prints - thirty-odd lines, plus every timed effect's own message -
  was dropped in the live game. Every harness that exercised the arms supplied
  it, and the one caller that matters did not.

### The capability-gated registry host: real code, and who can reach it

`packages/core/src/mod/registry-host.ts` is not a design note. All thirteen facades
delegate to live objects, the gating throws, the capability grammar validates,
and the host constructs it for real:

| Capability | Facade | Delegates to | Line |
| --- | --- | --- | --- |
| `registry:effect` | `EffectFacade` | `EffectRegistry.register` / `.isRegistered` | `:197-206` |
| `registry:room` | `RoomFacade` | `RoomRegistry.register` | `:207-212` |
| `registry:profile` | `ProfileFacade` | `DungeonProfiles` (`gen/cave.ts:2952`) | — |
| `registry:blow` | `BlowFacade` | `BlowEffectRegistry` (`GameState.blowEffects`, built per game in `wireGame`) | — |
| `registry:store` | `StoreFacade` | `StoreBehaviourRegistry` (`GameState.storeBehaviour`, built per game in `wireGame`) | — |
| `registry:command` | `CommandFacade` (`:405-427`) | `ActionRegistry.register` / `.has`, plus `CommandVerbTable.set` / `.verbFor` (`GameState.commandVerbs`, built per game in `wireGame`) | `:1106-1125` |
| `registry:monster` | `MonsterFacade` | `GameState.monsterTurnHook` (`game/context.ts:686`) | `:223-230` |
| `registry:projection` | `ProjectionFacade` (three sides) | `ProjectionHandlerRegistry` (`GameState.projectionHandlers`, built per game in `wireGame`) | — |
| `registry:ui-entry` | `UiEntryFacade` (two tables) | `UiEntryRegistry` (`GameState.uiEntry`, built per game in `wireGame`) | — |
| `registry:glyph` | `GlyphFacade` | `GlyphRegistry` (`RoomRegistry.glyphs`, `gen/glyph.ts`) | — |
| `registry:effect-info` | `EffectInfoFacade` (four tables) | `EffectInfoRegistry` (`effects/effect-info-registry.ts`, module-level) | — |
| `registry:randart` | `RandartFacade` (four tables) | `RandartRegistry` (`obj/randart-registry.ts`, module-level) | — |
| `registry:tval` | `TvalFacade` (four tables) | `TvalRegistry` (`obj/tval-registry.ts`, module-level) | — |
| `registry:vocab` | `VocabFacade` | `VocabularyRegistry` | `:231-256` |

- Gating is real: `requireCap` throws `AgentCapabilityError` (`:165`);
  `requireTarget` throws when the host did not wire that registry (`:177`).
- The grammar is real and strict:
  `REGISTRY_RE = /^registry:(\*|effect-info|effect|room|profile|blow|store|command|monster|projection|ui-entry|glyph|randart|rune|tval|vocab|menu|message)$/`
  (`packages/mod-sdk/src/capabilities.ts`); an unrecognised capability is a hard
  error at parse, not a silent no-op.
- Host wiring is real, not test-only: `packages/web/src/main.ts:8187` constructs
  it with `{effects, rooms, commands, state, vocab}` and calls
  `plugin.register(host, ctx)`. Entered via `?trusted=<id>`
  (`packages/web/src/main.ts:8242-8243`) OR from the persisted enabled-mod set with consent
  (`packages/web/src/main.ts:8303`).
- Consent UI is real (`packages/web/src/capability-describe.ts` marks the four
  system domains `elevated`).

**And now the part that matters.** Both code-discovery paths are build-time Vite
globs over a directory inside the web package:

- trusted plugins: `import.meta.glob("../../../mods/*/trusted.ts")`,
  `packages/web/src/agents/trusted/discover.ts:19`
- behaviour hooks: `import.meta.glob("../mods/*/hooks.ts")`,
  `packages/web/src/mod-hooks.ts:71`

`import.meta.glob` patterns must be static and are resolved and inlined at bundle
time (acknowledged at `packages/web/src/mod-store.ts:75-79`). Both are then
filtered by `isShippedMod(id)`, which is `dev || !id.startsWith("demo-")`
(`packages/web/src/mod-store.ts:81-83`).

Consequences, measured:

1. **A mod must be a directory inside `packages/web/mods/` at build time to
   supply ANY code.** There are exactly 6. Only `bug-fixes` and `qol` ship a
   `hooks.ts`; only `demo-trusted` ships a `trusted.ts`.
2. **In a release build, `demo-trusted` is dropped from discovery**, so the
   registry host has **zero non-test callers in production**. This is precisely
   the pattern the project has been bitten by before: declared, threaded,
   supplied only by a demo and by tests. The code is genuinely correct and
   genuinely unreachable by any shipped or third-party mod.
3. **The disk mod path is DATA-ONLY.** `packages/web/src/disk-packs.ts` models a
   pack as `{manifest, files}` of parsed JSON (`:51-54`) and binds only `*.json`
   (`:315-329`); the desktop index is the same (`packages/desktop/src/main.ts:270-283`);
   the browser picked-folder reader is the same
   (`packages/web/src/mod-folder.ts:366-368`). There is no dynamic `import()`,
   no code loading, and no plugin path in any of them.
4. **The CLI host has no mod path at all**: `packages/cli/src/pack.ts:35-80`
   reads `packages/content/pack` with `readFileSync` and never calls
   `composeContentPacks`.

Adjacent surfaces that DO exist but are a different tier, so they should not be
counted toward code override:

- `command:add` - the UNTRUSTED Worker/sandbox act facade
  (`packages/core/src/agent/act.ts:36`, `agent/controller.ts:44`). It lets an
  agent ISSUE commands; it does not change what a command does.
- `GameState.monsterTurnHook` (`packages/core/src/game/context.ts:686`) is a
  SINGLE hook, not a table: a mod replaces the top of every monster's turn or
  nothing. It cannot override one monster's AI, or one spell.
- `event:<name>` / `state:<domain>.read` / `network:<host>`
  (`packages/mod-sdk/src/capabilities.ts:63-65`).
- The event bus (`packages/core/src/events.ts`, 65 event types) - emitted from
  4 sites in `msg.ts` and 1 in `main.ts:1252`. Observation, not override.
  **CITATION NEEDS MANUAL RE-VERIFICATION (#289):** `packages/web/src/main.ts`
  has no `.emit(` call at line 1252 today - the only two live sites are
  `:1717` (`state.events?.emit("message", ...)`) and `:8950`
  (`soundEvents.emit("sound", ...)`). Re-check which one this claim meant (or
  whether the "1 site in main.ts" count itself is now stale, since two exist)
  before correcting the citation - not corrected here because neither
  candidate could be confirmed as the one this sentence originally meant.

---

## (b) Data

This is the strongest area, and as of 2026-08-08 the numbers carry no asterisk:
every record of every shipped file is nameable by some ref, and every op either
takes effect or is reported. The hole this section used to describe - "large and
silent" - closed in two steps, per-file keys on 2026-07-29 and the 73-record
residue on 2026-08-08. See gap 2.

### What a pack may contribute

There is **no allowlist of record types**. A record type is the file stem of any
`*.json` in the pack folder: `PackContent.files` is
`Record<string, FileContribution>` (`packages/mod-sdk/src/compose.ts:56-60`),
iterated blindly at `compose.ts:115`. Discovery is "every `*.json` except the
manifest" - bundled at `packages/web/src/pack.ts:103-108`, disk at
`packages/web/src/disk-packs.ts:314-329`. The desktop index builder states it
outright: "a pack's record files are named after the record type and there is no
fixed list" (`packages/desktop/src/main.ts:220-222`).

Three declarations bound it in practice:

| Bound | Count | Where |
| --- | --- | --- |
| upstream `.txt` gamedata files | **45** | `reference/lib/gamedata/` |
| the port compiles / ships | **44** | `packages/content/src/specs/index.ts:58-103` (`old_class.txt` deliberately not compiled, `:4-5`) |
| the WEB host actually binds | **42** | `packages/web/src/pack.ts:476-525` (38 stems) + `:432-440` (3 `ui_entry*`) + `:395-401` (`visuals`) |
| contributable to the composer but **bound by nothing** (silently inert) | **2** | `chest_trap` - hardcoded instead at `packages/core/src/obj/chest.ts:21` - and `world`, which has no consumer |

### Add / override / patch / remove — tested against the code, not the docs

`FileContribution` (`packages/mod-sdk/src/compose.ts:35-54`) supports four ops
plus field-level ops:

| Op | Semantics | Code |
| --- | --- | --- |
| `records` | ADD whole records; the contributing pack owns them | `compose.ts:122-132` |
| `patches` | PARTIAL delta, deep merge - objects merge per key, arrays and scalars replace whole, explicit `null` deletes a key | `mergePatch` `compose.ts:74-92`, applied `:147` |
| `replaces` | whole-record swap, ref and owner preserved | `compose.ts:147-148` |
| `removes` | DELETE the record from the composed game | `compose.ts:170-181` |
| `fieldPatches` | typed ops on dot-paths: `set`, `merge`, `addFlag`, `removeFlag`, `add`, `mul` | `FieldOp` `packages/mod-sdk/src/patch.ts:25-40`, `applyFieldPatch` `:87-135`, applied `compose.ts:153-168` |

So the answer to "only ADD, or also OVERRIDE / PATCH / REMOVE" is **all four,
plus field ops** - genuinely, with a live in-repo example
(`packages/web/mods/demo-modtest/monster.json:2-8` patches three fields of
`core:grip-farmer-maggot-s-dog`).

**Same id from two packs: both are kept, not overridden.** Refs are namespaced by
the CONTRIBUTING pack (`const ref = packRef(pid, name)`, `compose.ts:127`;
`PackRef = "<pack>:<slug>"`, `packages/mod-sdk/src/manifest.ts:9`), so
`core:kobold`, `amod:kobold` and `bmod:kobold` are three records. The
duplicate-rejection branch at `compose.ts:128-130` is scoped to one pack and one
file and is unreachable across packs. Override happens ONLY through the explicit
ops above, plus whole-file passthrough where the last provider in load order wins
the file (`packages/mod-sdk/src/loader.ts:131-138`).

**Core is pack zero with no special casing.** `coreLoadedPack()`
(`packages/web/src/pack.ts:61-69`) makes core a `LoadedPack` identical in shape to
a mod's; `activePackSet()` is `[core, ...enabled content mods]` (`packages/web/src/pack.ts:308-329`);
`mayModify` (`compose.ts:94-96`) is the only gate and is
`ownerPack === m.id || m.dependencies?.[ownerPack] !== undefined` - `"core"` is
not special-cased anywhere, and `compose.ts:13-17` says so. So a mod declaring
`"dependencies": { "core": "*" }` can patch, replace, or remove any core record.
Without the dependency, compose throws (`compose.ts:142-146`).

### The 20-file hole (closed 2026-08-08; it is now a 3-file floor)

Composition happens in two phases. Per-record COMPOSITION requires that every
contributing pack's `records` have a ref no sibling claims (`recordsComposable`,
`packages/mod-sdk/src/loader.ts`, asking `recordRefKeys` from `record-key.ts`);
files that fail that test are classified passthrough and keep whole-file
`records` semantics.

Measured over the shipped core pack: **41 composable, 3 passthrough**
(`loader.test.ts`, "the shipped pack", which reads
`packages/content/pack` and asserts the split by name).

- **Composable (41)**: every record file except the three below.
- **Passthrough / whole-file only (3)**, for two different reasons:
  - a config SINGLETON, where the file is the identity and the host binds one,
    so "I shipped this file" means "use mine": `constants`, `visuals`.
  - no per-record identity at all: `history` - a history record is
    `{chart:{chart,next,roll}, phrase}` and every part of it is a value a mod
    would legitimately change. An op against it is REPORTED, not dropped.

**IT WAS 24 AND 20, AND THE LINE THAT DECIDED IT ASKED FOR A UNIQUE `name`.**
That single condition is what made `object` (375 records), `ego_item` (107) and
`vault` (162) unmergeable: all three carry a `name` and core's own data repeats
it, because Angband's convention for a greater form is the same name with a mark
(`Acquirement` / `*Acquirement*`) and `ego_item` ships 23 names twice. So a mod
adding ONE object replaced all 375 - the three files most worth adding to were
the three a mod could only take over wholesale. Composition now keys by
`recordRefKeys`, the identity `record-key.ts` already declared and already proved
unique over the shipped pack, and all three merge per record.

**No ref that resolved stopped resolving.** For the 19 files that moved out of
passthrough the refs are the ones `applyPassthroughOps` already used
(`core:sword--dagger`, `core:of-acid#shot-arrow`, `core:store-general`); for the
24 that were already composable the key differs from the old `slugify(name)` only
where a `*` or `+` appears in a name, and the old form is registered as an alias.
An alias is dropped where it would shadow a DIFFERENT record's primary key -
`*Healing*`'s legacy ref is plain `Healing`'s.

**Which is 8 of the pack's 19 legacy aliases, not one** (corrected 2026-08-08:
this line said "in exactly one case" and the number had never been counted). The
rule turns on core's data, not on the mark: `*Acquirement*` loses its alias
because a plain `Acquirement` scroll exists, `*Destruction*` keeps both of its
because no plain `Destruction` does, `of *Slay Orc*` loses its and
`of *Slay Animal*` keeps its. The 8 are `*Enchant Armour*`, `*Remove Curse*`,
`*Acquirement*`, `*Healing*`, `*Enlightenment*`, `of *Slay Orc*`,
`of *Slay Troll*` and `Little eruption+`, censused row by row in
`record-key.test.ts`. None of them cost a working ref: every file carrying a
legacy alias is one that had no per-record addressing at all before the key
table existed.

The rule's own reachable case is narrower still, and worth naming because the
first two tests written for it could not fail: lookup consults the table before
the alias map, and the alias is skipped anyway when the plain record is declared
first — which is how core's `object.json` is written. What the rule actually
prevents is a pack declaring the starred form first whose plain record a later
pack removes; without it the old ref goes live on the starred record and a patch
lands on the wrong item. `loader.test.ts` tests that arrangement with a fixture,
and the control was run.

**That was the failure mode, and it is closed.** The paragraph here used to read
"a `patches` entry aimed at a passthrough file is dropped with no error, no
conflict-report line, and no visible effect", and it stayed on the page after it
stopped being true - which is how two reviewers came to file the same
non-existent P1. What is true now:

- **Whole-file `records` semantics are unchanged for a config singleton**, and
  deliberately: a mod that ships `constants.json` means "use mine", and the host
  binds one. `ModProject.build` raises that as an `error`, because replacing the
  base game's copy of a file is not something to discover from a line in a list.
- **Per-record ops apply on top**, in load order, keyed by the declared per-file
  identity in `record-key.ts` - `store` by its `STORE_*` code, `object_base` by
  tval, `trap` by the `{name,desc}` pair, `constants` by the file - through
  `composePacks` for the 41, and `applyPassthroughOps` (`loader.ts`) for the 3.
- **The duplicate-slug half** - the part the old note correctly said nothing
  addressed - is closed too, in two pieces: `keySlug` keeps the `*` and `+` that
  `slugify` dropped (which was the whole of `object`'s and `vault`'s problem, and
  16 of `ego_item`'s), and a declared DISCRIMINATOR separates the names core
  genuinely repeats (`core:of-acid#shot-arrow-bolt`). Measured over the shipped
  pack: **0 records that no ref can name**, down from 73.
- **`history` is the one file with no per-record identity**, on purpose: a
  history record is `{chart:{chart,next,roll}, phrase}` and every part of that is
  a value a mod would change. An op against it is REPORTED, not dropped.

So a mod can now patch a single object, ego item, vault, trap, store, brand,
slay, object base, projection or constant - and where a ref is genuinely
ambiguous, the refusal names the refs that are not.

### Data-bound registries a record patch reaches

Because most of the game's content is bound from the pack, a data patch does
reach a great deal. `bindCore()` (`packages/core/src/session/boot.ts:149-191`)
builds `CoreRegistries` (`:112-146`, 14 fields) from the composed pack. Record
counts, from `packages/content/pack/*.json`:

| Content | Records |
| --- | --- |
| `monster` | 624 |
| `room_template` | 415 |
| `object` | 375 |
| `history` (charts) | 165 |
| `activation` (object activations) | 163 |
| `vault` | 161 |
| `artifact` | 138 |
| `ego_item` | 107 |
| `monster_spell` | 91 |
| `object_property` | 79 |
| `projection` | 56 |
| `monster_base` | 56 |
| `player_timed` | 53 |
| `ui_knowledge` | 48 |
| `ui_entry` | 47 |
| `player_property` (abilities) | 44 |
| `trap` | 40 |
| `pit` | 40 |
| `object_base` | 34 |
| `blow_effects` | 30 |
| `curse` | 27 |
| `terrain` | 25 |
| `blow_methods` | 19 |
| `summon` | 17 |
| `pain` | 12 |
| `p_race` | 11 |
| `slay` / `brand` | 11 / 10 |
| `class` (class magic) | 9 |
| `shape` (shapechanges) | 9 |
| `dungeon_profile` (cave profiles) | 9 |
| `store` | 8 |
| `ui_entry_renderer` | 5 |
| `realm` (magic realms) | 4 |
| `quest` | 2 |

That is roughly 3,800 records across ~34 bound tables - a real and substantial
data surface. The catch, repeated because it is the crux: for 20 of the 44 files
the only way to touch one record is to replace the file.

### Validation and failure modes

- **There is no schema validation of records at all.**
  `packages/mod-sdk/src/index.ts:5` describes content packs as "schema-validated
  declarative JSON"; grep finds no such code. `validateManifest`
  (`packages/mod-sdk/src/manifest.ts:128-198`) validates only the MANIFEST. The
  `FileSpec` machinery in `packages/content/src/records.ts` is compile-time
  (`.txt` -> `.json`) and never runs on a mod's JSON. (That in-code doc claim is
  a source comment, not a `docs/` page, so it is reported here rather than
  edited.)
- **Compose errors are uncaught at boot.** `packages/web/src/pack.ts:339` is a
  module-scope `const composed = composeContentPacks(activePacks);` with no
  `try`. A single stale patch ref in any enabled mod throws `ComposeError` at
  import time. Whether that surfaces as a usable error or a blank page is **not
  determined** - it needs a real run with `?mods=<bad>` and the console read.
- **Binder validation is the only content check, and it throws hard**: ~40
  `throw new Error` sites in `packages/core/src/obj/bind.ts` (e.g. `:777`
  unknown tval, `:868` unrecognised brand, `:970` no kind for ego type) and
  `packages/core/src/mon/bind.ts` (`:729` invalid base, `:755` unrecognised
  blow, `:472` pain out of bounds). Removing a core record something else
  references fails here, after compose.
- **Name-lookup shadowing, with no uniqueness check.** `racesByName` is built
  with `Map.set` in record order (`packages/core/src/mon/bind.ts:646-650`), so
  `raceByName("kobold")` returns the LAST record with that name - a mod-added
  `kobold` silently shadows core's for every `lookup_monster` caller
  (`mon/bind.ts:712-713`), while both records still exist and both are
  spawnable.
- **Provenance is discarded before core sees anything** - the BEFORE picture,
  closed 2026-08-10; gap 10 in the table below is what replaced it.
  `packages/mod-sdk/src/loader.ts:126-129` maps `ComposedRecord` -> `r.value`,
  dropping `owner` and `modifiedBy`. `ContentIdResolver` is then constructed with
  the default `CORE_NS` at every call site
  (`packages/core/src/mod/ids.ts:183`; callers `session/game.ts:3226`, `:3312`,
  `packages/web/src/main.ts:7928`, `:8036`), so **a mod-added monster is saved
  under the `core:` namespace** - contradicting `ids.ts:10` ("The namespace is
  the owning pack") and `ids.ts:33`. Worse, `IdTable` disambiguates duplicate
  localids with an order-dependent `-2` suffix (`ids.ts:142-146`), so a
  name collision with core makes save ids depend on load order.
  `docs/modding/README.md`'s claim that "every record in the running game carries
  provenance … savefiles embed this" was therefore **not true** for as long as that
  paragraph stood; the ops and the conflict report existed, the runtime
  provenance did not reach core. It is true as of 2026-08-10, with the one
  exception gap 10's closure note names: a patch that RENAMES a core record
  still moves that record's id.
- **Load order is not the player's order.** `orderPacks` discards the incoming
  order (`packages/mod-sdk/src/loader.ts:80-84`) and resolves topologically with a
  LEXICOGRAPHIC tie-break (`packages/mod-sdk/src/resolve.ts:128-131`, `:142-144`).
  So between two independent mods patching the same record, `z-mod` always beats
  `a-mod` - while the conflict report tells the player "z-mod wins - drag to
  reorder" (`packages/mod-sdk/src/conflicts.ts:208-212`), which cannot change the
  outcome.

### Disk vs bundled data path

Both converge at `packages/web/src/pack.ts:118-124` into one `discoverMods()`
map, and `packages/web/src/pack.ts:323-326` casts `mod.files` straight to `LoadedPack["files"]`
with no filtering of `records` / `patches` / `replaces` / `removes` /
`fieldPatches` - so **a disk mod has identical data expressive power to a bundled
one.** Divergences worth knowing:

| | disk | bundled |
| --- | --- | --- |
| manifest validation | `validateManifest`, folder name must equal `manifest.id` (`disk-packs.ts:300`, `:309-312`) | none - `modManifest` just fills defaults (`packages/web/src/pack.ts:285-305`) |
| `load-order.json` | skipped (`disk-packs.ts:319-322`) | NOT skipped - only `manifest` is excluded (`packages/web/src/pack.ts:105`), so it would bind as a record file named `load-order` |
| `demo-*` filter | none | `isShippedMod` drops them in release (`packages/web/src/pack.ts:101`) |
| id collision | disk loses to a bundled pack of the same id, reported as a problem (`packages/web/src/pack.ts:118-124`, `:145-148`) | wins |
| unreadable record file | one problem line, pack survives (`disk-packs.ts:326-328`) | n/a (build-time glob) |

---

## (c) Resources

### Tiles — the one resource seam that exists, and it is bundle-gated

- The seam: `TileBlitter`, `packages/web/src/tiles.ts:80-96`
  (`menuname` / `ready` / `onReady` / `drawTile`).
- Two engines behind it: the tilesheet atlas engine `TileSet`
  (`packages/web/src/tiles.ts:103-176`, built by `createTileRenderer` `:193-204`)
  and the loose-pack engine `LinoleumPack`
  (`packages/web/src/linoleum-pack.ts:284`, loaded by `loadLinoleumPack`
  `:422-456`). The render path is engine-agnostic
  (`packages/web/src/main.ts:1074-1128`, `:1141-1149`).
- The registry of tile modes is CORE, as it should be (this was a ratified
  correction): `packages/core/src/visuals/grafmode-data.ts`, generated from
  `lib/tiles/list.txt`, 6 catalog modes; `get_graphics_mode` port at
  `visuals/grafmode.ts:81-106`. Four packs' art ships
  (`BUNDLED_TILE_DIRECTORIES`, `packages/web/src/tile-catalog.ts:47-52`);
  Shockbolt's two modes are filtered out of the menu for licence reasons
  (`tile-catalog.ts:41-45`, `:99-113`).
- A `shape:"tiles"` mod CAN register a tileset: `tilePacks[]` is read by
  `enabledTileModes` (`packages/web/src/tile-mods.ts`) and layered over core by
  `composeTileModes` (`tile-catalog.ts`). A `linoleum`-engine pack may claim a NEW
  grafID (>= 100) and add a menu row; a `tilesheet` pack may only re-skin a grafID
  core already knows. Live example:
  `packages/web/mods/linoleum/manifest.json:11-18`.

**RESOLVED 2026-07-30 (gap 8 below).** Both halves of this section's complaint are
fixed, and both fixes were needed together:

- **Discovery now reads the mods DIRECTORY as well as the bundle glob.**
  `mergeModSources` (`tile-mods.ts`) merges `diskPacks()` into the bundled glob,
  first-wins on id collision - the same rule `pack.ts` applies to the same two
  sources. `discover()` also resolves the enabled set through the one shared reader
  (`mod-store.readEnabledModIds`), which the tile surface previously did NOT do: it
  passed no `diskOrder`, so a tiles mod an external manager deployed was composed
  as content and contributed no Graphics row - enabled by one answer and disabled by
  the other, in the same launch.
- **`tilePacks[].path` is now MOD-relative, and both engines take a resolver.** The
  field used to be a site-root-relative URL base, which only a bundled mod can
  know: a picked folder has no URL for its files until their bytes are wrapped in a
  `blob:`, and an installed mod lives in IndexedDB. `PackFileResolver`
  (`pack-files.ts`) is the seam; `tilePackResolver` composes a mod's source with its
  `path`; `createTileRenderer`/`loadTilePrefs` and `loadLinoleumPack` all take one,
  so the field cannot mean one thing per engine.
- **`tilePacks` is in the validated schema**: `PackTilePack` +
  `validateTilePacks` (`packages/mod-sdk/src/manifest.ts`), which also refuses the
  old site-path form of `path` rather than letting it 404 into ASCII in silence.

Measured, not asserted: `tile-mods.test.ts` registers a Graphics row for a pack
that is only in the mods directory and proves its art resolves through the report's
`assetUrl`; `tiles.test.ts` pins the tilesheet engine's two reads (atlas and
`graf-*.prf` + its `%:` includes) to the same resolver. Eight mutations, each
failing a named test.

The desktop side of the asymmetry that made this worth fixing first: the shell
already serves arbitrary pack files over loopback INCLUDING images (MIME table
`packages/desktop/src/main.ts:145-147` for `.png`/`.svg`/`.ico`, `:150-152` for
`.wav`/`.mp3`/`.ogg`; `/mods/` route at `:312-314`), and a disk `shape:"tiles"`
pack was already surfaced in the mod manager by `discoverContentModManifests`
(`pack.ts`). The bytes were reachable; only the registration was not.

The non-mod escape hatch is `?tiles=<base-url>` + `?graf=<id>`
(`tiles.ts:178-187`, `packages/web/src/main.ts:1005-1006`), which also unlocks the full catalog
(`tile-catalog.ts:109`). That is a user/URL affordance, not a mod path, and it
cannot add a grafID.

### Pref files (`.prf`) — parsed fully; mod-suppliable since gap 7

The `ui-prefs.c` grammar is ported: `packages/core/src/visuals/prefs.ts` (one
grammar over an injected `PrefSink`, `:84-90`; writer `prefsSave` `:727`;
`parseTilePrefsInto` `:969`), plus `visuals/tile-prefs.ts` and
`visuals/glyph-table.ts`. The UI is `packages/web/src/prefs-ui.ts`
(`processPrefFile` `:141-161`, "Load a user pref file" `:170-188`,
`dumpPrefFile` `:112-126`), resolving against the virtual `ANGBAND_DIR_USER`
(`packages/web/src/userdir.ts`).

A USER can load one, and since gap 7 a MOD can too: `prefs` is one of the seven
resource kinds, and `applyPrefText` (`prefs-ui.ts`) runs a mod's `.prf`
through the same grammar, the same sink and the same deps as a user's, returning
the errors against the contributing mod's row rather than saying them on a
message line that does not exist yet at boot. This heading and this sentence said
"not mod-suppliable" until 2026-08-14, which was stale by gap 7 and is exactly
the kind of claim a reader would have believed.

`%:` includes ARE followed on that path since #278. They were not, and the
reason given was that the grammar's `loadFile` is synchronous while a mod's
files resolve through a resolver that may mint a blob or read IndexedDB - true,
and not a reason, because the reading can happen BEFORE the parse rather than
during it, which is what `loadTilePrefs` has always done for a pack's own
`%:flvr-*.prf`. `preloadPrefIncludes` walks a mod's pref text for `%:` names,
reads them transitively to the parser's own depth bound, and hands the parse a
map it can answer synchronously. An include resolves against the DIRECTORY OF
THE DECLARED RESOURCE, at every depth, so a mod keeps its pref files in one
folder; a name that does not resolve is a quiet skip, exactly as upstream's
`parse_prefs_load` discards a nested read (ui-prefs.c L438). The bytes come back
out of `applyPrefText` with the faults, because the same text is replayed into
every freshly built tile map (#153) and a replay without them would be the same
silent skip one function over.

There is a recorded divergence at `prefs-ui.ts:134-139`: upstream also searches
`ANGBAND_DIR_CUSTOMIZE` and the graphics mode's directory; the port ships no
`lib/customize` tree and searches only the user location. Partial exception: a
TILE pack does supply `.prf` files, which `loadTilePrefs` fetches and follows
`%:` includes from (`tiles.ts`) - reachable only through the gated tile
discovery or `?tiles=`.

### Fonts — CLOSED 2026-08-09 (what follows is the BEFORE picture)

One hardcoded bitmap font, `FONT_16X24`
(`packages/web/src/font-16x24.ts:16`, generated from
`reference/lib/fonts/16x24x.fon`), installed as the terminal default at
`packages/web/src/term.ts:146`. A constructor escape hatch exists -
`bitmapFont?: BitmapFontData | null` (`term.ts:176-180`, applied `:192`) - with
**zero production callers**: the only construction site is
`new GlyphTerm(canvas)` (`packages/web/src/main.ts:727`), no options object. No `setFont`, no font
fetch, no `font.prf` (mentioned only as a non-ported upstream file at
`packages/web/src/launch.ts:33-34`), no manifest field. A mod cannot supply a
font.

**True until gap 7 closed**, and the escape hatch could not have had a caller:
the sole construction site is at module scope and a mod's font arrives from a
fetch. So the terminal grew `setBitmapFont`, which also clears the glyph cache
(keyed `code:colour`, with no font in the key) and re-runs the layout, since the
cell size comes from the font. A mod declares a `font` resource and the JSON is
checked for being structurally a font - cell size in range, one scanline number
per declared row - before it is installed.

### Sounds — CLOSED 2026-08-09; the subsystem always existed, the door did not

Correcting a common assumption: this is present and wired.

- Core (`sound-core.c` port): `packages/core/src/sound/engine.ts` (`SoundEngine`,
  `playSound` `:268`, `loadPrefs` `:287`, `setHooks` `:185`), `sound/types.ts:61-66`.
- The `MSG_` -> sound map is generated from `reference/lib/customize/sound.prf`:
  `packages/core/src/sound/sound-prefs-data.ts` (149 entries), generator
  `packages/core/scripts/gen-sound-prefs.mjs:18`.
- Platform half: `packages/web/src/sound.ts` (`createWebSoundHooks` `:64-127`,
  `HTMLAudioElement`, `.mp3` then `.ogg`; `installWebSound` `:138-152`).
- Wiring: `packages/web/src/main.ts:7602-7634`, base URL defaults to the bundled
  pack (`:7619`), gated on `use_sound`, off by default (`:7633-7634`).
- Assets DO ship: `packages/web/public/sounds/` carries the Dubtrain CC-BY pack.

A USER can point it elsewhere with `?sounds=<base-url>`. A MOD could not: no
manifest field, no discovery, no per-mod sound base. **Gap 7 supplied the door
and nothing else** - `WebSoundOptions.baseUrl` now also takes a function, asked
per sample load rather than captured at install, because the engine is installed
at module scope and a mod's pack is a fetch away. Precedence is `?sounds=` (the
user, now, in this tab) over a mod over the bundled default.

### Other assets

| Asset | Loaded how | Mod override |
| --- | --- | --- |
| Splash / title art (`news.txt`) | inlined as a TS constant, `packages/web/src/news.ts:31` (+ overdrawn "Neo" `:58-76`); not fetched | no |
| Help (`lib/help/*.txt`) | NOT fetched or bundled - curated inline TS data, stated at `packages/web/src/help.ts:20-36` | no |
| Keymaps | localStorage `neo-angband:keymaps`, edited in game (`packages/web/src/keymap-store.ts:1-26`); upstream's pref-file keymaps are not read from a file | no (user only) |
| Colour table | in-game RGB editor -> localStorage (`packages/web/src/colors.ts:1-35`); also writable by a loaded `.prf` | no (user only) |
| User files (dumps, `.prf`) | real virtual `ANGBAND_DIR_USER`, `packages/web/src/userdir.ts:1-35` | no |
| PWA icons | `packages/web/public/icons/` | no |
| Mod `screenshots` | declared at `packages/mod-sdk/src/manifest.ts:117-118` and **dead** - no consumer outside `dist/` and tests | n/a |

### Localization — CLOSED 2026-08-09 (what follows is the BEFORE picture)

No i18n layer exists. `grep -rn "i18n|useTranslation|gettext|navigator.language|Intl\."`
over `packages/` (excluding `node_modules`) yields two hits, both unrelated
(`packages/linoleum/src/convert.ts:159`, `:161`, `Intl.Collator` for deterministic
sort). Every other `locale` hit is `localeCompare`. All UI text is inline TS
string literals. There is nothing a mod could supply strings through - which is
also worth noting against the standing "localization everywhere" intent.

**That was accurate and it under-described the problem.** The layer now exists
(`packages/core/src/i18n/`) and it has two halves, because this game ASSEMBLES
the words it prints rather than storing them - see gap 14 below for the argument
and for what a locale can and cannot change. `locale` is the seventh resource
kind, so a translation arrives through the same door as a sound pack. What is
NOT done is converting the port's remaining UI literals, which is mechanical
follow-up rather than a hole in the seam.

**Net for resources: 6 of 7 categories** (tiles, prefs, fonts, sounds, help, art)
are reachable by a non-bundled mod as of 2026-08-09. The seventh is UI strings,
which has nothing to be supplied INTO until an i18n layer exists - gap 14.

This paragraph used to read "1 of 7", and it predicted the shape of the fix:
"a manifest field, a merge that reads the mods directory as well as the bundle,
and a resolver so the mod's own bytes are what load". Two of the three were right
and were reused rather than rebuilt - `discoverMods` is now shared with tile
discovery instead of copied, and the resolver is the same `PackFileResolver` both
tile engines take. The third was wrong in the PLURAL: not a manifest field per
category but one `resources` array with a `kind`, so the merge rule, the version
gate, the conflict wording and the load-time check are written once for all of
them. Gap 7 in the table below says what a resource is checked for before it is
used, and what a failed check costs.

---

## (d) The gap list

Ranked by how much of "the whole game can be made over" each one unlocks.

| # | Capability | Today | What would have to exist |
| --- | --- | --- | --- |
| 1 | **A mod can supply CODE without being compiled into the app** | **YES** (closed; re-measured 2026-08-08) | Done, and nothing below is blocked on it any more. `packages/web/src/mod-plugin.ts` loads a `plugin.js` sitting beside a mod's `manifest.json`, with the engine **passed in** rather than imported, so a mod installed from disk runs real code. The `import.meta.glob` in `mod-hooks.ts` remains, but it is now the path for the *bundled demo* mods only, not the only door. This row read "**no**" with "everything below is blocked on this" for long enough to misdirect planning - the rest of this table is re-derived, not edited. |
| 2 | **Per-record patching of the other 20 gamedata files** | **CLOSED 2026-08-08** (phase 1 2026-07-29, residue 2026-08-08) | This row said "silently dropped, `loader.ts:119`" for nine days after that stopped being true, and the stale wording cost two reviewers a duplicate P1 each - see the header of `record-key.ts`. What is actually built: `loader.ts` applies per-record ops to passthrough files in a second phase against the winning array, keyed by the explicit per-file table in `packages/mod-sdk/src/record-key.ts` (19 files declared, 24 keyed by `name`), and an op that cannot be honoured produces a named line in `ComposedContent.problems` plus an attributed `faults` entry. **But a key declared per FILE is not every RECORD being addressable**, and the difference was 73 records: 61 of `ego_item`'s 107 - so "of Acid" could not be patched at all - plus 10 in `object` and 2 in `vault`. Two different causes, separated rather than papered over. (a) INFORMATION THE SLUG THREW AWAY: `slugify` drops `*` and `+`, so `*Healing*` and `Healing` arrived as one key; `keySlug` now spells the marks out, which alone fixes every `object` and `vault` collision and 16 of `ego_item`'s. (b) GENUINELY REPEATED NAMES: `ego_item` ships "of Acid" twice, so a declared DISCRIMINATOR appends the item types it applies to - `core:of-acid#shot-arrow-bolt` - which is not a guess but upstream's own `lookup_ego_item(name, tval, sval)`. A record answers to SEVERAL refs, and the pre-2026-08-08 slug is kept as an alias except where it would shadow another record's primary key, so nothing that resolved before stopped resolving. Result, asserted over the real pack: **0 unaddressable records** in every keyed file. `history` remains keyed by nothing on purpose - `{chart, phrase}` is all values a mod would change - and an op against it is reported. An ambiguous ref now REPLIES WITH THE REFS THAT WORK, because "ambiguous" with no alternative is where an author gives up. Proof: `record-key.test.ts` asserts zero-unaddressable in both directions and both controls were run (dropping `item.tval` from the discriminator, and reverting `keySlug`, each fail exactly their own tests); reach is proven from disk in `mod-code.node.test.ts` by a real mod folder patching one "of Acid" out of the REAL `ego_item.json` and leaving the others alone. |
| 3 | **Behaviour seams covering the game rather than 7 points** | **CLOSED 2026-08-15** — 7 hooks + 7 registries, 0 `CANDIDATE` rows in `tools/switch-census.json` as of this stamp (re-verified, not just recalled: `node tools/switch-census.mjs` and `switch-census.test.ts` both agree). Stamped explicitly rather than left as a bare description, per the gate's own rule that a row is closed when it SAYS so, not when nothing is left to point at. | Not more one-off hooks. The measured shape of the problem is that behaviour lives in `switch` statements; converting the significant ones into keyed registries of the `EffectRegistry` shape is the only mechanical route from 7 points to a layer. Blow effects went first and are done (row 4), which also established the method: record golden vectors from the code BEFORE the refactor, then replay them against it. Store (27) followed, then the whole projection family: project-feat (37), project-obj (11) and project-player (21), so a mod's projection now reaches terrain, objects AND the player. Then the three room/vault glyph decoders (16 + 13 + 23), which is where a mod's own VAULT stopped being a picture and started being a place - see row 17. Remaining is a counted list rather than a phrase, and as of 2026-08-11 that list is empty: **0 `CANDIDATE` rows** in `tools/switch-census.json` (was 18 here, and 21 before that). The randart and object naming/desc families this row last named as the largest remaining went through the same conversion as the rest; what is left in the census is UI routing, parsers, host wiring and localization, none of which this row is about. Converting is only half the work - a converted table with no producer is still unreachable, which is what row 17 and `registry:projection` both exist to close. |
| 4 | **Monster combat is moddable** | **CLOSED 2026-08-08** | `blow_effects.json` accepts a 31st record but its behaviour is a 26-case switch in `resolveBlowEffect` and again in `resolveBlowEffectLive` (`combat/mon-melee.ts`). **These are not duplicates.** Same 26 case labels, but 171 lines against 219, and they do different jobs: the first records side-effect *intents* for the worldless path, the second applies HP, messages and elemental reduction for real through `MonBlowEnv`. So "collapse the duplicated switch to one body first" - which this row used to say - describes a large, parity-sensitive refactor that would buy no modding capability. What was actually needed - and is now built - is ONE registry keyed by blow-effect name that BOTH bodies consult. `BlowEffectRegistry` (`combat/mon-melee.ts`) holds a `{record, live}` handler per effect; core seeds it with its 30 at boot (`registerCoreBlowEffects`, called from `wireGame`), and a mod reaches it through `registry:blow`. A mod normally writes ONE description and `blowEffect()` derives both halves, so the two paths cannot drift; `handlerFor(name)` hands back the installed handler, so wrapping core is possible instead of only replacing it. The 26-case switches were lifted case by case with nothing rewritten - including the places where the two paths disagree about RNG ORDER, which is a port wart core keeps. What proves it: `blow-vectors.json`, 480 scenarios recorded from the code BEFORE the registry existed and replayed against it, covering 30 effects x both paths x two envs that flip every branch, with a probe draw that catches a change in the NUMBER of random values even when nothing else moves. Reach is proven from disk (`mod-code.node.test.ts`), by a real `monMeleeAttack` on both paths. |
| 5 | **Store behaviour is moddable** | **CLOSED 2026-08-08** | `StoreBehaviourRegistry` (`store/store.ts`) replaces both switches, keyed the way each decision is actually made: stack size by TVAL, the buy rule by store FEAT with an `ANY_STORE` wildcard, because upstream has one body every shop shares. Core registers its own rule under the wildcard, so `willBuyFor(ANY_STORE)` hands it back and a mod layers on top instead of reimplementing the worthless-item and buy-list logic. Two refusals are deliberate: an empty registry REFUSES rather than becoming permissive ("nobody decides" must not read as "every shop buys anything"), and the `maxStack` clamp stays in core, so a mod's stack rule cannot break a pile. Reached on both paths that ask - store maintenance and the sell command - because a seam supplied to every path but one is how a mod comes to work in town and not in the shop. Proof: 1,167 `mass_produce` golden vectors recorded before the refactor (the function had NO test at all), plus behavioural tests against the real pack and a from-disk mod that changes what a shop buys. `StoreRegistry`'s linear `byFeat`/`byName` scans remain, and are lookup rather than behaviour. |
| 6 | **Level generation architecture is moddable** | **CLOSED 2026-08-08** | `registry:profile` now exists: `ProfileFacade` (`mod/registry-host.ts`) over the live `DungeonProfiles` (`gen/cave.ts:2952`), so a mod registers its own whole-cave builder and adds the profile that selects it. `builder(key)` hands back a core builder, so a mod can WRAP core generation instead of reimplementing it. Two refusals are deliberate: a profile naming an unregistered builder is rejected at `addProfile` rather than exploding inside generation a level later, and `addProfile` only appends, because `choose_profile`'s running-total `randint0` walks the list in order and inserting would change which profile CORE picks from the same seed. Proven by a mod written to a real folder and imported for real (`packages/web/src/mod-code.node.test.ts`), asserting on the registry rather than on the mod's own report. |
| 7 | **Resources: sounds / fonts / splash / help** | **CLOSED 2026-08-09** | **ONE `resources` array with a `kind`, not the seven separate manifest fields this row proposed.** Seven fields would each need their own validator, discovery pass, merge rule and conflict wording - four chances per category to disagree with the other six - and the eighth category would arrive to find no shared shape to join. `packages/mod-sdk/src/resources.ts` holds the kind registry; adding a category is a row there plus a consumer, and everything between the manifest and that consumer is already written. `tilePacks` STAYS AS IT IS: it ships, mods declare it, and it carries three fields no other kind has (the catalog serial it renders as, which renderer draws it, its Graphics-menu label), so folding it in would either widen every entry with fields six kinds cannot use or break every published tiles mod. Five kinds, each with a consumer wired in the same commit, because a kind the game never reads is exactly the failure `engine` spent months in before anything evaluated it - authors fill a field in and believe it. `sound` a directory of samples, into the SoundEngine that already existed (only `?sounds=` could aim it before); `font` a bitmap font JSON, into `GlyphTerm`'s `bitmapFont`, which had been on the options object since the terminal was written **with zero callers** - and could not have had one, because the sole construction site is at module scope and a mod's font is a fetch away, so the terminal grew `setBitmapFont`; `prefs` a `.prf` through the SAME ui-prefs.c grammar a user's file goes through; `help` a page, replacing one of core's by id or adding its own; `art` the title screen. **`art` is `.txt` only, and that is the honest half.** `.png` was in the list while it was being written and came out: nothing paints a bitmap into the title screen - the terminal is a glyph grid and blitting across it is front-end work - so accepting one would have meant a mod that validates, loads, verifies and then silently does nothing. Upstream's own splash IS text (`lib/screens/news.txt`), so a conversion drawing in ASCII is doing the most faithful possible thing. The credits are APPENDED to a mod's art rather than woven at core's row indices, because `SPACER_ROW` is 20 and a twelve-row splash would never reach it - the Angband credit would have vanished without a word. **AND THE RESOURCES ARE CHECKED WHEN THEY LOAD**, which this row did not ask for and is the half that matters: three checks, cheapest first. (1) The DECLARATION (`resourceComplaint`, pure, same verdict on every machine): an unknown kind, a `..` in a path, an extension the kind cannot be, a slot no screen paints, a slot on a kind that has none - refused rather than dropped, because an ignored key is an author believing something that survives to ship. It also refuses a top-level `.json`, which is a real cross-file collision: `sortPackFiles` sorts by path shape alone, so `font.json` would go to the record composer, find no content file by that name, and leave the mod loaded with no font and no complaint. (2) The INVENTORY, free, and the one that catches the mistake authors actually make - a disk pack arrives with a list of every file it holds, so a mistyped filename is a set lookup rather than a request. Absent for a bundled mod, whose files are copied rather than enumerated, which is why absence means "no inventory" and not "empty". (3) The RUNTIME, injected so every decision is reachable from a test: whether this build can play `.mp3` or `.ogg` at all, and whether a font JSON is structurally a font - cell size in range and one scanline number per declared row, because a font is the single resource whose failure is total. **A failed check costs the RESOURCE, never the mod** - ratified decision 18 read through: a resource is data of the least dangerous sort, and taking a mod's records away over an undecodable splash would be a punishment with no offence behind it. But it is never silent either: every refusal goes to `reportModFault`, so it lands on that mod's row beside everything else known about it. A resource that falls back quietly is indistinguishable from a mod that does nothing, which is the bug report no author can reproduce. Proof: `resources.test.ts` (23) for the pure rules and the arbitration - a shadowed contribution is invisible by construction and only a test can see one; `mod-resources.test.ts` (21) for the host decisions, including a build that can play neither format, a font that parses and is not a font, a throwing probe becoming a refusal rather than a crashed boot, and the engine gate at this door; `mod-resources.node.test.ts` (8) from REAL FILES - the bundled `demo-resources` mod's art, help page and pref file, plus a font and a sound pack written to a temp folder. **Two defects the tests found, not review**: the gate was being handed `engine` without `modApi`, so a code pack out of range would have been waved through at this door while the content and code doors refused it; and `modManifest` dropped `resources` entirely, so anything reading a NORMALISED manifest would have been told the mod supplies nothing - the third time `manifest-allowlist.test.ts` has caught exactly that. And the demo mod's `.prf` is parsed by the real grammar against the real registries in CI, which caught its first draft using a feature NAME where the grammar wants its CODE - every line of it would have failed silently on a player's machine. |
| 8 | **A disk tile pack registers a Graphics row** | **YES** (closed 2026-07-30) | Done. `mergeModSources` merges `diskPacks()` into the glob; `tilePacks[].path` became MOD-relative and both engines take a `PackFileResolver`, so a pack in a picked folder or installed from a repository reaches its own bytes; `tilePacks` joined the validated schema as `PackTilePack`. See section (c) above. |
| 9 | **The FRONT END is replaceable** — how the WORLD is drawn (row 21 is the UI) | **YES — seam 2026-08-11, geometry 2026-08-13, both photographed in the installed build** | The old evidence was stale: the command table is module-level and cached, not inside a keydown closure. Phase 1 extracts `GridSurface` from `GlyphTerm` (`packages/web/src/term.ts`) and makes tiles `RenderAssetRef` data. Phase 2 replaces the 50 production `window` keydown registrations with the single `input-door.ts` browser adapter; existing screens subscribe through its compatibility facade while input crosses the door as a device-neutral `UiInput`. Keyboard and queued keymap values preserve current behavior, and `UiDirection` retains vector, magnitude, and angle for a controller or radial menu without manufacturing an Arrow key. Phase 3 gives every `selectFromMenu` caller a stable non-title id and semantic rows, with `registry:menu` at the shared choke point; a later mod wraps the installed transformer with `handlerFor(id)`, and a failed transform leaves the original menu usable. Phase 4 routes `render()`'s live map-knowledge reads through the importable `world-render-data.ts` producer, which creates one `WorldFrame` with semantic terrain/object/trap/monster/path layers and knowledge state before handing that exact object to one host `WorldFrameSink`. Its executable control checks the unmodded pre-frame glyph tuples, including terrain-under-path tile input, and an independent sink receives the same produced frame. Phase 5 landed the seam itself on 2026-08-11: `ModPlugin.frontend` exists, one winner is selected, and a disk-loaded plugin's front end receives real `WorldFrame` fields under test. What is NOT yet proven is that seam on the SHIPPED path -- the headless proof over the built bundle and fresh in-game pixels are still owed -- so this remains IN PROGRESS and is not a claim that a 3D front end ships. Phase 5 also shipped a defect worth recording: the boot `render()` ran before the frontend slot was initialised, which threw on module evaluation and stopped the UNMODDED game from starting (fixed in 51173001c, guarded by main-boot-order.test.ts). The first frame is therefore always glyph-drawn; a front end must tolerate starting on a later repaint. Phase 5 was finished on 2026-08-13 with the two things its task named and the landing had not done: the seam is **capability-gated** (`display:replace`, its own capability kind - `registry:*` does not carry it, and a mod declaring `frontend` without it is refused by name while the game keeps drawing), and **core's own renderer now registers through the same door** as candidate zero of the same list, winning by the ordinary last-in-load-order rule rather than being a fallback the selection falls through to. That second half is what makes the seam's claim checkable: a seam that could not express the front end the game already ships would be a promise about a shape nobody had built through it. Three disk fixtures prove it, the third of which asks for `registry:*`, declares `frontend`, sorts LAST, and throws from its factory - so it would own the map under last-wins alone, and a gate that silently stopped working fails there rather than passing quietly. **2026-08-13, the sample:** the fixtures prove a frame ARRIVES - each pushes what it received into a global and an assertion reads it back - which is not the same as proving a mod can put something on the screen with it. `samples/frontend-blueprint/` is a copyable mod folder that draws the dungeon as a blueprint from `visibility`/`terrain`/`overlays` and never touches `cell.visual`, and `sample-blueprint.node.test.ts` loads THAT FOLDER by path, runs it through the real selection against core as candidate zero, and records every canvas call for a frame built by the same producer `render()` uses. Building it surfaced a genuine hole, recorded here rather than papered over: **a front end is never told where the map's pixels are.** Cell size, the letterbox offset and the grid dimensions are private to `GlyphTerm` and no `ModPluginContext` member exposes them, so a replacement that wanted to draw INSIDE the existing layout has to guess the rectangle. The seam's own motivating cases (isometric, 3D) take the whole window and do not care, which is why this was invisible until something drew. Publishing viewport geometry is the remaining work on this gap, alongside the in-build pixels. **2026-08-13, the in-build pixels, and they were worth the trip.** The sample was deployed to a real `neo-angband-data/mods/` folder beside the 0.19.0 desktop build, enabled through the manager's own consent flow (`display:replace` granted at the "Draw the dungeon itself" prompt), applied by the manager's own reload, and photographed drawing a loaded character's level over CDP, with an unmodded control of the same character at the same position in the same process. It drew: its own label reads back the frame it was handed (`66x22 from WorldFrame (1452 cells)`, and 66x22 = 1452), the four floor items the control shows as `? ? $ !` are its four object marks, and the control confirms no monster was in view, which is why there is no monster mark - the sample's mark table is right, not lucky. **Two things only the shipped path could find.** (1) **The sample would not load at all.** It shipped in `samples/frontend-blueprint/` declaring id `blueprint-view`, and `readPack` refuses a folder whose name and manifest id disagree - correctly, since the enabled set, the load order and a save's provenance all key off the id. Every test passed throughout, because they reach the plugin by PATH and the path is the whole subject of the rule. The folder is now `samples/blueprint-view/` and the first assertion in `sample-blueprint.node.test.ts` is that its basename equals its manifest id. (2) **A front end covers the window, and everything else on it.** Core keeps its half of `display:replace` exactly: the map area of its canvas goes blank and it goes on drawing the sidebar, the status line and every menu - photographed separately from the composite. But with no viewport geometry the mod can only cover the whole window, so all of that is painted over. Hit points, messages and the game menu are invisible, INCLUDING the Mods screen a player would use to turn the mod off; recovering means editing the enabled set by hand. So the second half of this gap is not a refinement, it is what stands between `display:replace` and a front end anybody can play: **until viewport geometry is published, a front-end mod is a demonstration.** **2026-08-13, the owner's correction, and this row was named wrong from the start.** The owner, on seeing the blueprint sample: "it kind of feels like a skin/tileset replacement... I have merged the concepts of UI and front end. They are related, but not the same. I want both to be moddable." He is right, and this row's old title (**UI is moddable**) is exactly the conflation. What phases 1–5 built is the FRONT END: `WorldFrame` is the dungeon and nothing else. The UI — the HUD sidebar, the status line, the message area, menus, prompts, and the full-screen views — was never in it, and a measurement of what a mod can reach there today is row 21. So this row keeps the world and hands the rest over, rather than claiming a reach it does not have. The one thing that moves BETWEEN them is the remaining work named above: publishing viewport geometry is really the question "who owns which rectangle", which is a LAYOUT question and therefore shared. Whichever row builds a region model, both spend it. **2026-08-13, the region model, and this row is now YES.** The owner ruled that the region model gets built here rather than shipping geometry-only and leaving it to row 21 - an API we intended to replace within one task would break every mod written against it. What shipped: `packages/web/src/regions.ts` names the parts of the screen (`messages`, `sidebar`, `map`, `status`) and gives each a rectangle in BOTH units - grid cells, and CSS pixels in the window's own coordinate space - from the numbers `viewport()` already computes; `GlyphTerm.metrics()` publishes the cell size and letterbox offset that were private for five phases and are the half a mod cannot compute for itself; `WorldFrame.regions` carries the lot to whoever holds the display, as an ADDED OPTIONAL field, which by the ABI rule in `mod-plugin.ts` is not a bump. **The names are ROLES, not places.** `sidebar` is the 13-column left column in one layout, a one-line header under the messages in another, and ABSENT in the third - a mod that had asked for "columns 0-12" would be right in one of three and would draw over the map in another. `regions.test.ts` drives all three layouts and asserts, among other things, that no cell is ever claimed by two regions, which is what makes "draw in your region" mean anything. `main-regions.test.ts` is the join that keeps the table honest: it reads main.ts's own source and pins that the status line, the message row, the compact vitals and the sidebar are drawn at the same expressions the regions are built from, because a region table that quietly stopped matching the renderer would hand every front end a rectangle over somebody else's furniture and nothing would look wrong until a mod drew there. **The sample was rewritten and re-photographed** (0.19.0+regions desktop build, fresh character, mod enabled through the manager's own consent flow, reload applied): `samples/blueprint-view` now positions its canvas from `frame.regions.map.pixels` every frame, and its label reads back `map region: 66x22 cells at 13,1` - the Left layout's map exactly. The sidebar (`High-Elf / Believer / Priest`, LEVEL, HP, SP, `Town`) and the status line (`Light 3 Study (1) Fed 89 % Down staircase`) are core's and both readable with the mod on, where before the same mod hid them. And the thing that made the old behaviour fatal is gone: the game menu opens and `j) Mods` is legible, so a player can turn a front end off from inside the game instead of editing the enabled set by hand. Two tests hold it: the sample is placed at the region it was given, and it draws NOTHING when it is given none - a fallback to the window would put the defect back intermittently, which is worse than always. Also closed here, unrelated but found by the same change: `world-view.ts`'s live frame and the SDK's public one were assumed structurally identical by `frontend-runtime.ts`'s adapter and nothing checked it; a compile-time check now compares assignability AND key sets, since an optional field added to one side only stays assignable both ways - verified by deleting `regions` from the SDK side and watching `tsc -b` fail. **What is NOT closed, measured in the same session and handed to row 21:** a full-screen overlay (the game menu, the Mods screen, inventory, the character sheet) is painted across the WHOLE terminal, including the map region a front end legitimately holds, so with a front end active those screens are clipped where its canvas sits. Legible, usable, and wrong. The front end is behaving correctly - it holds its region - and so is core; what is missing is that full screens have no region of their own, which is row 21's subject and not something to invent a second mechanism for here. |
| 10 | **Provenance survives into the running game and the save** | **CLOSED 2026-08-10** | `composeContentPacks` now stamps every composed record with the pack that ADDED it and the packs that CHANGED it (`mod-sdk/src/provenance.ts`, reserved key `$from`), and only when there is something to say: a base-game record nothing touched is still returned by reference, which is the no-op `loader.ts` promises in its header. Core reads it in `attachExt` (`core/src/mod/extension.ts`) - the ONE helper all fifteen binders already call - so every bound record type carries `from` in a single change and `extension.test.ts`'s census covers provenance for free. `brand` and `slay` were wired into that census at the same time, because a save writes brand and slay ids and the census had both uncovered; a claim that provenance reaches the save would otherwise have been wider than its mechanism. `ContentIdResolver` then namespaces PER RECORD instead of per resolver, so a mod's monster is `demo-modtest:modberry-slime` and never `core:modberry-slime`. **The `-2` suffix problem dissolved rather than being fixed**: a mod's record no longer collides with core's, so the suffix is confined to core's own duplicate names, which are frozen data. **No save-format change and no SAVE_VERSION bump.** `IdTable.index` reproduces the pre-0.19.0 id for every record and consults it only when the exact id misses, so a character carrying a mod's sword written as `core:frost-brand` still loads. It is the old algorithm run forwards, not a fuzzy match: a "same localid in any namespace" rule would hand back the wrong record exactly when two packs share a name. Proven from a real folder in CI (`packages/web/src/mod-provenance.node.test.ts`) over `demo-modtest`, which both adds a monster and patches one of core's, with an unmodded control asserting the whole game pack carries no stamp anywhere. **What this did NOT fix, now pinned as a deliberately-current test in the same file:** a localid is derived from the record's NAME, so a mod that RENAMES a core record still moves core's id - `core:grip-farmer-maggot-s-dog` becomes `core:grip-the-cyber-hound`, and a save written before that mod was installed cannot resolve it. Pre-existing, independent of provenance, and it needs a rule of its own ("a record's id is fixed by the pack that DEFINED it, and a patch cannot move it"). Tracked separately. |
| 11 | **Load order means what the UI says it means** | **YES** (closed; re-measured 2026-08-08) | Stale in the direction that matters. `resolveLoadOrder` (`packages/mod-sdk/src/resolve.ts:73`) now keeps a per-id map of the caller's input position and breaks every Kahn tie on it - frontier seeded in input order, and re-insertion placed by the same key - with the comment stating the intent outright: deterministic "without the resolver imposing an order the player did not choose". `orderPacks` (`loader.ts:207`) hands its packs straight through. Both ends of the chain supply the player's order: the installed order is kept by `mod-store.ts`, and an external manager's `load-order.json` is read and filtered to ids that resolved (`disk-packs.ts:113`). Two tests assert the tie-break by name (`resolve.test.ts:33`, `compose.test.ts:124`). |
| 12 | **Record schemas are validated** | **CLOSED 2026-08-09 — the mechanism existed, the reach did not** | **This row was half wrong, and the wrong half is the one worth recording.** It said `packages/mod-sdk/src/index.ts:5` claims schema validation and "no such code exists". The claim was real; so was the code. `checkRecords` over `RECORD_BLUEPRINTS` — 4,630 lines of field shapes, types, ranges and required-ness MEASURED from core's own 3,279 shipped records rather than hand-written — was fully built, exported and thoroughly tested. Its only caller was `ModProject.build`: **the mod BUILDER**, a tool nobody but the author runs. A mod installed from a zip, hand-edited in the mods folder, or produced by any other tool had never been near it, which is the same shape as a control enforced on save and not on load. The row's proposed fix — derive a key+type table from `packages/content`'s `FileSpec` — would have built a second, weaker checker beside the one already there. What was needed was a CALLER. `packages/mod-sdk/src/validate.ts` now holds the subject selection that used to live inside `ModProject.build`, and both the builder and `composeContentPacks` call it, so the two cannot disagree about what a mod is answerable for. Four decisions carry the row. (1) **A patch is checked as the record it PRODUCED.** A patch body is `{"speed": 120}` — no `name`, none of the twenty fields every core monster has — so checking patches as written would put a required-field error on every legitimate patch in existence; membership is decided by `recordRefKeys`, the identity composition itself uses, not by a second spelling of it. (2) **The base game is not reported on.** Core's own data raises 65 warnings against core's own blueprint, almost all `reference/dangling` on artifact `base-object` refs that are upstream warts the port keeps on purpose; putting those on a player's screen at every boot, with no mods installed, would bury every real line. `packs[0]` is the base game — the convention `composeDroppingBroken` already keeps. (3) **`warn` and above at load, everything in the builder.** A `hint` is drafting advice and belongs where the author is sitting in front of the draft. (4) **REPORT, NEVER REFUSE.** A blueprint is a measurement, not a specification, and its own header says a mod coining a new tval or slay code is doing something legal — so a finding costs neither the record nor the mod. Findings ride a THIRD list on `ComposedContent`, kept apart from `problems`/`faults`, because a fault is an op the composer refused and a finding is about a record that composed perfectly and will not do what its author thinks. Proof: `packages/mod-sdk/src/validate.test.ts` composes against the REAL content pack (12 cases, including that core alone is silent AND that the exclusion rather than the checker is what makes it silent, that a well-formed mod is silent, that a switched-off section is not reported on but a switched-on one is, and that the builder's warnings and the loader's are the same set); `packages/web/src/pack-records-checked.test.ts` drives `diskPackStatus()` — the reader the mod manager calls — so the line is proven to reach a row a player can read. Control run: deleting the one line in `pack.ts` that maps findings onto rows fails exactly the three reach assertions and leaves both silence controls green. **One thing running it corrected in the tests themselves**: `mod-visibility.test.ts` stood a bare `{name: "Survivor Hound"}` in for "the forty records that ARE fine", and it drew four warnings of its own. A record standing in for the ones that are fine cannot be one that is not. |
| 13 | **A boot-time compose error is survivable** | **CLOSED 2026-08-09 — run, not claimed** | Held open since 2026-08-08 on two counts, and both are now answered by `packages/web/src/pack-survives-broken-mod.test.ts`, which drives the REAL readers (`composedRecords`, `diskPackStatus`, `presentNamespaces` — the three `main.ts` calls) rather than the module-private `composition()`. (1) The composer: a mod whose dependency is missing, two such mods at once, and a hard `ping <-> pong` cycle each leave the base game composed, the offender dropped, named on its own row, and absent from `presentNamespaces` — which matters beyond cosmetics, because that set is what `loadGame` reconciles a save's mod-lifecycle blocks against. A good mod loaded alongside a broken one survives, which is the greedy-fallback failure a coarser implementation would pass every other assertion with. Control: putting `composeContentPacks` back at the call site fails exactly those five and leaves the baseline and the six producer rows green. (2) The rest of the chain: `discoverMods` (`packages/web/src/pack.ts:134`) reads `pack.manifest.id` with no guard and is reached from module scope, so a `DiskPack` with a non-object manifest would be a blank page one layer EARLIER than the composer. It cannot happen — both producers of a `DiskPackReport`, the mods folder and the IndexedDB installs, go through `readOnePack`, which calls `validateManifest` inside a `try` and returns null on a throw. **No guard was added at `packages/web/src/pack.ts:134`, deliberately**: it could never fire, and a check that cannot fail reads as protection while quietly being the reason nobody re-asks. The invariant is proven at the producer instead — null, an array, a string, a number and an id-less object are each rejected and named, with a good mod in the same directory as the control. **A correction the row itself needs**: it said "install a mod with a bad patch ref", and that stopped throwing when `composePacks` gained its `onRefuse` reporter (row 198). A missing patch target now costs the patch and gets a line. What is left for `composeDroppingBroken` to catch is `resolveLoadOrder` — a missing dependency, a duplicate id, a cycle — because those are statements about the SET of enabled mods, where there is no single op to skip and dropping a pack is the only move that makes the rest loadable. The closing condition written in 2026-08-08 would have tested a path that no longer fails. |
| 14 | **Localization** | **CLOSED 2026-08-09** | The row was accurate - `grep -rn "i18n|gettext|LOCALE"` over `packages/*/src` returned one hit and it was a `localeCompare` in a sort comment - but it under-described the problem, and the owner named the missing half before the work started: *"I don't think simple string replacements will cut it for everything. Some will require structural changes."* That is exactly right, and this game has the sharpest possible case of it. **Angband does not store the words it prints; it ASSEMBLES them.** An object's name leaves `obj-desc.c` as a pattern - `"& Scroll~ titled #"` - and the rules that turn it into "3 Scrolls titled xyzzy" are English's: `~` appends `s` (or `es` after s/h/x), `&` becomes `a` or `an` by the vowel that follows, `|kni|fe|ves|` picks an irregular arm, and the count goes in front. A translator handed that pattern and asked to replace its words cannot express a Japanese counter, a German case ending, or Polish's three plural forms; a translator handed the finished English sentence has already lost the count. **So the layer has two halves** (`packages/core/src/i18n/`). MESSAGES: `t(id, english, args)`, where the English is written at the CALL SITE and is required - which keeps the sentence next to the code that prints it and makes a missing catalogue entry impossible rather than merely unlikely. The patterns are an ICU subset, chosen and not invented, so a catalogue for this game is a catalogue in the ordinary sense that ordinary translation tools already edit: `{n, plural, ...}`, `{g, select, ...}`, `{n, selectordinal, ...}`, `{n, number}`, `=0` exact arms, `#`, and ICU's `'{` quoting. **The plural CATEGORIES are not core's to know**: they come from `Intl.PluralRules`, so a Polish catalogue writes `few` and `many` and an Arabic one gets all six, while core never learns what those are. `n === 1 ? a : b` - the obvious shortcut - is wrong in most of the world's languages and is the commonest way a localization is broken from the inside. FORMS: named FUNCTIONS a locale replaces outright, a closed `TextForms` interface rather than an open record so the set is enumerable and a translator's mistake is a type error. `objectNameFormat` and `objectNamePrefix` are the first two, and `coreForms()` hands back English's implementation so a locale can WRAP rather than reimplement - the affordance `registry:blow`'s `handlerFor` already gives. **Delivery is gap 7's seam**, which is why that row landed first: `locale` is the seventh resource kind, merged by slot (the BCP 47 tag), so two mods may translate two languages and two translations of one language are settled by load order. The file is JSON and therefore carries DATA - tag, the language's own name, direction, messages - and the check refuses a file whose own `tag` disagrees with the `slot` that declared it, because the slot is what arbitrates and the tag is what the game switches to, and a file saying `de` behind a slot saying `fr` would be offered as French and read as German. A translation needing FORMS ships a `plugin.js` and calls `registerLocale` itself, through the ordinary code path with the ordinary consent, because it is code. **Parity is preserved by construction and measured**: with no locale installed, `t` returns the call-site English and `objDescNameFormat` runs the same English body it always did, and `desc-vectors.test.ts` - the golden set over the whole shipped pack - is untouched. `registerSourceForms` keeps core's own grammar in a cell `resetLocales()` cannot clear, because a reset that left the game unable to pluralise a sword would look like a bug in the seam. **And the terminal is a fixed grid**, which is a localization problem that is not about words at all: `textCells`/`truncateToCells`/`padToCells` (i18n/text.ts) count EAST ASIAN WIDTH, because an ideograph occupies two cells and a combining mark occupies none, and `String.length` counts UTF-16 units and is wrong twice over. WHAT IS DONE AND WHAT IS NOT: the layer, the delivery, the structural seam, the width arithmetic, and a first set of real call sites (the help index's labels and page titles) are done and proven from disk - the bundled `demo-resources` mod ships an `en-XA` pseudo-locale, and `mod-resources.node.test.ts` reads it off the tree, registers it, and asserts the help index comes back in it. **The port's remaining UI literals are NOT converted**, and that is a bounded, mechanical follow-up rather than a gap in the seam: an unconverted literal is a string that is not translatable yet - visible, greppable, and no worse than it was. A pseudo-locale is the tool for finding them, which is why the demo ships one: anything still in plain ASCII on a screen is a string the code forgot to route through the translator. |
| 16 | **A mod can EXTEND a record, not only retune it** | **YES** (2026-08-08; namespacing and declaration added the same day; trespass gate 2026-08-14) | Measured on request: of the three operations an author expects - patch a value, remove a key, add a key - the first two worked end to end (a dagger patched to `1d5` really rolls it; dropping `flags` really removes THROWING) and the third did not. A new key composed cleanly, reported no problem, landed in the composed record, and was then dropped by the binder, so an author got no error and no effect. Fifteen bound record types now carry the keys core does not bind (`attachExt`, `mod/extension.ts`), frozen, absent entirely when a mod added none. Which keys are core's is DERIVED from core's own gamedata (`mod/record-keys.ts`, generated) rather than hand-listed, and its test re-derives it from the pack in both directions. `mod/extension.test.ts` is a CENSUS - it injects a sentinel into every record of each covered file and counts the survivors, because the failure this guards against is an absence, and per-type tests cannot see one. THE FIELD IS NAMESPACED, DECLARED AND PROTECTED AGAINST TRESPASS: `"gore:bleed"` is declared in the owner mod's manifest under `fields` with the files it may appear on and an optional type; another pack may write it only after declaring `gore` as a dependency or optional dependency. Undeclared, misfiled or misshapen is stripped and reported by name; a trespassing write is refused, restores the last permitted value from before the first trespass, and faults the writer - later edits to that field are also rolled back because they were computed from poisoned input (`mod-sdk/src/fields.ts`). An unqualified key core does not know is reported as a probable misspelling with core's nearest real field named, which needs core's key table and therefore runs in the host (`packages/web/src/pack.ts`). Core never reads `ext`: it is the data half of extending the game, and the behaviour half is `registry:effect` / `registry:blow`. Proven from disk, declared and undeclared, including nested, arithmetic and coarse-merge trespasses followed by permitted writes, in the same test file. |
| 15 | **Accidental seams closed** | **YES** (closed; re-measured 2026-08-08) | Done. `MONSTER_HANDLERS` (`mon/project-mon.ts:801`) is now `readonly` and built by an IIFE, and `DEBUG_MENU` (`packages/web/src/wizard.ts:514`) is `readonly` and passed through `deepFreezeMenu`. Neither is a silent, unordered back door any more. Note the distinction this row exists to make: these were closed *as defects*. Reaching either one is a capability that must arrive as a gated, ordered, conflict-visible registry - see rows 3 and 9 - never by unfreezing these. |
| 17 | **A vault or room template can use a symbol core has never heard of** | **CLOSED 2026-08-09** | `vault.json` and `room_template.json` have always accepted a new record, so a mod could always ship a vault - but only one drawn with the symbols `build_room_template` and `build_vault` already decoded, because those were three closed switches (gen-room.c L1195, L1445, L1523; 16 + 13 + 23 cases). A symbol they did not know became plain floor: **no error, no effect**, and no way for an author to find out except by staring at the level. `GlyphRegistry` (`gen/glyph.ts`) is keyed by decoder and character, with the two passes upstream actually runs - `terrain`, then `populate` once the room's walls exist - and a mod reaches it through `registry:glyph`. Two things are deliberate. The two alphabets stay SEPARATE, because upstream's are: `+` is a closed door in a room template and a SECRET door in a vault, and unifying them would be a parity change wearing a tidiness costume. And the glyphs upstream accepts and does nothing with (`9` in a template's first pass, `/` and `;` in a vault) are registered as explicit no-ops, so `glyphs(kind)` reports the true alphabet - an authoring tool listing what a vault may contain would otherwise be missing them. What proves it: **5,994 golden vectors** recorded from the code BEFORE the registry existed - every room template and every vault of the shipped pack, plus four synthetic ones spelling out the glyphs the pack does not use, at three seeds x three depths - replaying the whole chunk, every placement, and a probe draw that catches a changed DRAW COUNT. The depth list carries a 127 because the first control run broke a vault's `>` and PASSED: with only 5 and 60 in the grid, the dungeon-bottom arm was never reached. Reach is proven from disk (`mod-code.node.test.ts`) by a real mod folder shipping a vault with a `Q` in it, asserted on the CHUNK; the same file keeps the BEFORE picture as a test, so the seam's value is measured rather than asserted. |
| 18 | **A mod's effect can SAY what it does** | **CLOSED 2026-08-09** | `registry:effect` has always let a mod register a handler for a brand-new effect code and have it DO something. What no mod could do was let the game describe it, because five closed switches stood between an effect and every word the player reads about it: `effectMenuName` and `effect_describe`'s body (both keyed on the EFINFO_* flag, 20 cases each), the activation-property summary walker (keyed on the effect code, 12), `effect_subtype`'s named-subtype decoding (keyed on the effect index, 9) and `requestForEffect` (which item an effect prompts for, 8). **69 cases.** The failure was silent in all five directions: a blank row in the activate/cast menu, nothing at all in object recall, an activation that could never be recognised as duplicating an intrinsic property, an effect that accepted no named subtype (only a bare integer), and an item-consuming effect that could not ask for an item. `EffectInfoRegistry` (`effects/effect-info-registry.ts`) is four tables under three keys - the EFINFO_* flag, the effect code, the effect index - reached through `registry:effect-info`. Two things are deliberate. The tables stay SEPARATE, because upstream's keys are: twenty flags describe a hundred and twelve effects, and collapsing them would force a mod to register the same behaviour three times under three spellings. And the registry is MODULE-LEVEL, which is legitimate only because of the 2026-08-09 ruling that a mod toggle takes effect on the next reload - the table a disabled mod registered into is gone because the module instance is. What proves it: **11,530 golden vectors** recorded from the code BEFORE the registry existed - every one of the 112 effects at five subtypes x three dice shapes x two radius/other shapes x two device-skill boosts, every TMD name through six activation arms, and every effect index against 25 subtype names - replaying the exact strings. No RNG probe, and that is measured rather than forgotten: this path substitutes `Dice.randomValue()` for upstream's `dice_roll` at every site precisely so rendering cannot perturb the stream, so there is no Rng to probe. Reach is proven from disk (`mod-code.node.test.ts`) by a real mod folder giving its own `SOULFIRE` effect a menu row and a recall sentence, asserted on the STRINGS a player would read; the same file wraps a core flag to show composition, and keeps the BEFORE picture - both strings empty, nothing complaining - as a test. Making that reachable took two changes beyond the switches: `describeEffect` used to skip a mod's effect on its `edesc === null` branch before the registry was ever consulted, and `itemTargetRequest` skipped a string effect code outright. A seam its own callers walk past is not a seam. |
| 19 | **A mod can reach the RANDOM artifact generator** | **CLOSED 2026-08-09** | `artifact.json` has always accepted a new record, so a mod could always ship a FIXED artifact. Reaching the GENERATOR was a different thing: four closed switches decided every property a randart can have - `add_ability_aux` keyed on the `ART_IDX` ability (**87 cases, the biggest dispatch the switch census has ever recorded**), `artifact_prep` keyed on the base item's tval (15), the item-class census keyed on tval (14), and the activation-redundancy test keyed on the `EFPROP` kind (9). **125 cases.** The failure was the worst kind: a mod-coined ability index took `add_ability_aux`'s default arm, which is a bare `break`, so the design loop SPENT POWER on the ability and the artifact got nothing - no error, no effect, and no way for an author to find out except by generating a few hundred artifacts and staring at them. `RandartRegistry` (`obj/randart-registry.ts`) is four tables under three keys, reached through `registry:randart`. What proves it: **834 golden vectors** recorded from the code BEFORE the registry existed (commit `d4a771153`) - three whole artifact sets field by field, every `ART_IDX` at two seeds and two target powers, every item class through `artifact_prep` including the three tvals that take its DEFAULT arm, and the frequency census - with an RNG probe on every per-arm vector, because a changed draw count is invisible in the artifact and diverges every artifact after it. The control was run: one throwaway `randint0` in `ART_IDX.BOW_MIGHT`, changing no artifact field, fails the replay and names the probe. **Reachability took one more change than the conversion.** The `addFlag` / `addMod` / `addResist` / `addBrand` / `addToHit` primitives a handler needs were exported from `randart-build.ts` but that module was never re-exported from core's index, so none of them were in `ctx.core`: a mod could register a handler and had no way to write its body. `index.ts` exports `randart-build.js` and `randart-data.js` now. Reach is proven from disk (`mod-code.node.test.ts`) by a real mod folder coining ability index 500 and running the real `add_ability_aux` over it, asserted on the ARTIFACT; the same file wraps a core ability to show composition and keeps the BEFORE picture - the artifact comes back untouched - as a test. |
| 21 | **The UI is replaceable** — the HUD, the messages, the menus, the prompts, the full screens (row 9 is the world) | **NO, and DEFERRED past alpha (neostryder's ruling, 2026-08-15).** Real progress stands, not zero: the region stack, overlap/transparency, mod-created regions and per-cell input routing are built and tested (`ui-stack.ts`, `region-surface.ts`, #276), and the prompt seam (#258, `yieldTerminal`) is real, not a stub. What remains — roughly 13 of ~50 screen builders still unmodelled, ~20 of 33 full-screen `term.clear()` sites still undeclared, menu *presentation* (only content is reachable today), and a hover/focus input model nobody has scoped yet — is real, bounded, medium-effort work, explicitly held for a post-alpha pass rather than gating the release on a perfect port. See `alpha-waits-for-total-moddability` (superseded 2026-08-15: "any gap from a perfect port" is no longer the gate; moddability is judged sufficient for release as-is). | Split out of row 9, whose title claimed this and whose work never touched it. What a mod reaches today, layer by layer, read off the source rather than remembered: **HUD sidebar** — core already produces it as DATA (`sidebarModel` + `sidebarLayout`, the `update_sidebar` port), and the shell draws it in `renderSidebar`, a closure inside `main.ts` with no seam of any kind on it; `display-wiring.test.ts` exists precisely because that closure is unreachable from a test. **Status line** and **message area** — same shape, drawn from `main.ts`. **Menus** — `registry:menu` reaches menu CONTENT at the `selectFromMenu` choke point: a mod may add, reorder, retitle and re-tag ROWS. It reaches no part of how a menu is PRESENTED, so a console-RPG frame, a radial dial or a floating window is out of reach even though the rows are already semantic. **Full screens** (inventory, equipment, character sheet, knowledge, spell browse, ignore setup, tombstone, ~50 builders in `screens.ts`) — these are the worst case, because their model is already flattened: every builder answers `ScreenLine[]`, styled text on a grid. There is nothing for a different presentation to consume; a mod handed those lines would be parsing a rendering, not reading a model. **Layout** — `viewport()` is private to `main.ts` (cells) and cell size / letterbox offset are private to `GlyphTerm` (pixels), so nothing outside knows where any region is. What would have to exist, as a CANDIDATE shape rather than a decision: (a) **named regions** — map, HUD, status, messages, overlay — with published geometry, and core registered as candidate zero for EACH, so a mod claims one or more regions and every region it does not claim keeps being drawn by core. That is the same trick row 9 already used to make its own claim checkable, and it is what makes "let the standard UI shine through, or replace every element" a property of the seam instead of a burden on the mod author. It also retires row 9's remaining defect for free: a `display:replace` mod that claims the map region gets the map rectangle and stops covering the sidebar. (b) **A semantic frame per region**, the `WorldFrame` treatment applied to the rest: the HUD as fields rather than placed text, a menu as a question with choices rather than rows, a full screen as its core model rather than `ScreenLine[]`. `screens.ts` is where most of that work is, because the flattening happens there and core's real models (`characterPanels`, `statTable`, gear lists) are already behind it. (c) **A capability of its own** (`ui:replace`, granted per region), separate from `display:replace`, so taking over the character sheet is not the same grant as taking over the dungeon. Owner's stated intent, 2026-08-13: console-RPG menus and status screens, radial menus, full redesigns into popup windows, and a Dragon Quest-style side panel. Those are the acceptance cases; none of them is expressible today. **2026-08-13, what row 9 built and what it left here.** Half of candidate (a) exists: `packages/web/src/regions.ts` names `messages` / `sidebar` / `map` / `status` and publishes each one's rectangle in cells and CSS pixels, and every `WorldFrame` carries them. That is the LAYOUT half, and it is shared - this row does not need to invent it, only to extend it. What row 9 did NOT build, deliberately, is per-region OWNERSHIP: core is candidate zero for the map because `installFrontend` already selects one owner for the map, and there is nothing to be candidate zero FOR on the other regions until the HUD is a model rather than a closure. That is this row's first job, and it comes before the fun parts. **A NEW gap, measured in the installed build rather than reasoned about**, and it is this row's: a full-screen overlay is drawn across the WHOLE terminal - the game menu, the Mods screen, inventory, the character sheet, every `screens.ts` builder - including the map region a front end holds, so with a front end active those screens are visibly clipped where its canvas sits. Photographed 2026-08-13 with `blueprint-view` active: the menu is legible and `j) Mods` reachable, so it is no longer fatal, but the right-hand half of every row is behind the mod's canvas. Both sides are behaving correctly, which is the tell: the missing thing is that a full screen has no region of its own. Whatever this row builds has to answer what happens to the map region when a screen takes the terminal - the honest candidates being that a full screen IS a region (and the map's stands down while it is up), or that a screen is composed of regions rather than covering them. **DECIDED 2026-08-13 by the owner: a screen is COMPOSED of regions and does not cover them.** The stand-down candidate was rejected against the acceptance cases, not on taste. The overhaul the owner has in mind is the map filling the ENTIRE screen with standalone windows floating over it — borders, scrollable contents, an inventory drawn as sprites or tiles where moving the selection (mouse hover, or a controller D-pad) raises a tooltip or fills a detail pane inside the same window, and a Secret-of-Mana radial command dial (Wear/wield, Magic, Zap, Aim, Use, Fire) superimposed over the map with transparency, its second tier either radiating out of the chosen wedge or replacing the first tier in place. Every one of those needs the map to still be drawn UNDERNEATH, which a full-screen region that makes the map stand down forbids by construction. Four consequences follow, and each changes what a region IS rather than adding to it. **(1) Regions overlap, and are ORDERED.** The four names row 9 shipped tile the screen and cannot overlap; a floating window is *defined* by sitting over another region, so regions need a stacking order and the model has to stop assuming disjointness — `regions.test.ts` asserts today that no cell is claimed twice, which is right for the base layout and wrong as a global invariant. **(2) A mod CREATES regions**, it does not only claim the four core names. A radial dial is not `messages` / `sidebar` / `map` / `status`, and neither is a detail pane inside an inventory window. Names stay roles; the set stops being closed. **(3) A region can be transparent**, so the map's `present` keeps running while a screen is up, and compositing — who draws, in what order, over what — becomes part of the seam instead of a property of a takeover. **(4) Input routes to the region under the point.** A hover tooltip and a D-pad walking a grid of item tiles are both hit-testing against a region's own contents, which is the first thing that turns `input-door.ts` from host infrastructure into a mod seam. It also settles candidate (b) as REQUIRED rather than optional: an inventory drawn as sprites cannot be assembled from `ScreenLine[]`, so getting `screens.ts` to give up its real models is not a nice-to-have inside this row — it is the precondition for every acceptance case above. **2026-08-13, step 1 landed: the HUD is a model.** `packages/web/src/hud-view.ts` gives the vitals, the message line and the status line the `WorldFrame` treatment — a frame of named sections, each a list of keyed entries whose runs carry the engine's own `COLOUR_*` attribute beside the css the terminal resolves it to, plus the rectangle the terminal is allowed to draw in and the published region that rectangle plays the role of. `renderSidebar`, `renderCompactVitals` and `renderStatusLine` are gone from `main.ts`; what is left there is an adapter that reads core's models and a single `glyphHudFrameSink` that consumes the frame, so there is no second draw path for a HUD cell. Two things this bought immediately. The layout rules — which fields survive a short screen, where the compact header's separators fall, how far a run may reach, what the targeting loop takes over — are now executable (`hud-view.test.ts` drives them across three layouts and four sizes), where before they lived behind a canvas boot and only a source-text guard could look at them. And the region table finally has something to be checked against: every section carries its region, so "core draws its own furniture inside the rectangles core publishes" is an assertion rather than an argument, at every layout and size. Equivalence was measured rather than asserted: the new path was diffed against `HEAD`'s four draw loops over 4000 randomized frames, and both negative controls (widening the reserved last column; dropping the separator a blank field still charges for) failed it. **Still NO for a mod**, which is why this row is still open: nothing yet lets a plugin receive that frame. Per-region ownership is the next step, and it is now unblocked — there is finally something for a mod to be candidate zero *against* on a region that is not the map. **2026-08-13, step 2 landed: the HUD has OWNERS, one per region.** `ModPlugin.hud(ctx)` returns a sink for each region it is taking — `messages`, `sidebar`, `status` — and `packages/web/src/hud-runtime.ts` selects each region's owner independently, last enabled claimant in load order, with core's terminal as candidate zero for all three through the same call any mod makes. Candidate (c) is built and is per region as designed: `ui:<region>.replace` with a `ui:*.replace` wildcard, a separate capability KIND from `display:replace` in both directions — a mod holding the dungeon cannot draw the vitals and a mod holding the whole interface cannot draw the dungeon, asserted rather than assumed. The consent list names the part (`"Draw the vitals panel — your hit points, food, armour and depth"`), because a grant a player cannot picture is a grant they cannot weigh. Three design points that are decisions rather than details. **The capability IS the claim**, so selection reads the manifests and finishes before anybody's `hud()` is called — the rule `installFrontend` needs so a loser cannot mount a canvas it will never draw into, which per-region ownership would have broken if a claim could only be learned by calling. Its price is stated rather than hidden: a region a mod won and then declined goes back to the game, not on to the next claimant. **A sink for an ungranted region is dropped and reported**, or the capability would be advisory — nothing stops a returned object carrying three keys when its manifest asked for one. **A fault costs one region**: a throwing `status` sink loses the status line for the session and leaves the vitals drawing, because losing your hit points to a mod that draws the clock would be a bigger blast radius than the grant. Along the way, a defect in the shipped map seam: `frontendWorldFrameSink` was rebuilt inside `render()`, so its "this front end faulted, stop calling it" memory was discarded on every repaint and a persistently throwing mod was re-entered and re-reported once per frame. Both sinks are now built once per selection (`liveWorldSink` / `liveHudSink`), and `hud-runtime.test.ts` presents twice and asserts one report. **The proof is a mod, not a fixture**: `samples/vitals-panel/` is a real folder plugin that takes `sidebar` alone and redraws the vitals as a canvas panel on `section.region.pixels`, keyed on `entry.key` and coloured from `run.color` through `ctx.core.COLOUR_*`; `sample-vitals.node.test.ts` loads it from disk through the real selection and asserts it never touches `run.css` or `entry.screen`. **What is NOT closed, and this row stays NO for all of it**: menus, prompts and the ~50 `screens.ts` builders are untouched, so candidate (b) is one third done; the four consequences of the composition ruling — overlapping ordered regions, mod-created regions, transparency, input routed by region — are all unbuilt, and the full-screen-overlay defect above is still live. One limit the sample surfaced and it is named rather than worked around: a HUD entry carries its TEXT, not its numbers (`"HP 20/20"`, no `{current, max}`), so a mod can restyle the vitals and cannot draw a proportional bar without parsing a rendering. Values on the entries is the next increment. **2026-08-13, step 3 landed: the entries carry their NUMBERS.** `SidebarField` and `StatusIndicator` gained `values` in core (`display.ts`), carried unchanged through `hud-view.ts` to every entry and through the cross-plugin snapshot, and mirrored on the SDK's public `HudEntry`. It is deliberately ONE convention rather than a per-field API: **`current` and `max` together mean the field is a PROPORTION**, every other key is a plain named quantity, and a field whose two numbers are not a ratio must not use those names. That is what lets a consumer write `if (v.current !== undefined && v.max !== undefined) drawBar() else drawText()` once and be right on a field a content pack adds after it shipped — and it is why a stat publishes `use`/`cur`/`max` (118 is an encoding meaning 18/100; `use / max` would report a maxed character as 15%) and a drained character publishes `level`/`maxLevel`. Absent means THE GAME DOES NOT KNOW, never zero: the monster health bar publishes nothing while it reads `[----------]`, because `{current: 0, max: 10}` there would draw as "about to die", and `sp` is absent for a class with no mana rather than `0/0` — two facts that are not the same fact. Two numbers are published where core's own field is deliberately BLANK (`speed` at 110, whose text upstream suppresses) because 110 is a known number rather than a missing one, and the level feeling publishes its INDICES rather than the digits it prints, which are inverted by two different constants (`10 - mon`, `11 - obj`). The producer's own risk — a field's numbers going missing looks like nothing at all, since the terminal never reads them and the screen is identical — is pinned by both placement paths (`placements` and `flowEntries`) being asserted, and by the sample. `samples/vitals-panel` now draws hit points and spell points as real bars, coloured from the engine's own attribute and clamped (a big heal can put `chp` above `mhp` for a moment), and `sample-vitals.node.test.ts` asserts the RULE rather than the field: `hp` gets a bar, `str` with its three non-ratio numbers gets text, and the fill is `round(width * 7/20)` of the track. **2026-08-13, step 4 landed: a menu is a QUESTION, and a mod can ask it.** `ModPlugin.menu(ctx)` returns a presenter; `packages/web/src/menu-view.ts` gives every menu a renderer-neutral `MenuQuestion` (title, subtitle, footer, choices with their stable ids and `MenuSemantics`, the command keys the caller handles itself, the initial cursor, `browseOnly`, and a live `detail(index)` callback), and `menu-runtime.ts` selects one presenter by the same last-in-load-order rule the other two seams use. **The seam is different in kind and that is the whole design**: a HUD section is DRAWN, a menu is ASKED, so the boundary is `ask(question) -> answer` rather than `present(frame)`, and taking a question means taking its input - a presentation that could not accept a choice would not be a presentation of a menu. Four decisions that are decisions rather than details. **ONE grant, `ui:menu.replace`, for every menu** - not one per menu id, because ~50 capability strings would be a consent list nobody could read; the fine choice is made per QUESTION instead, where a presenter returns `undefined` to decline the ones it has no better way to ask. Declining is the expected case and costs nothing, which is also why the HUD's "the capability IS the claim" rule does not need to hold here: a declined menu leaves no surface half-owned. **An answer names a choice's stable `id`, never an index** - an index is a fact about a layout, and a presenter that groups its choices into the wedges of a dial has none the game would recognise; `selectFromMenu` already maps ids back to the caller's own row because a `registry:menu` transformer could reorder rows before any of this. **CORE IS NOT A CANDIDATE**, the one place this does not mirror its siblings: core's way of asking is `selectFromMenu`'s own body, a function rather than a presenter object, and every decline and every fault falls into it - a candidate that always declined could never win, because winning is what declining means. **A fault costs the SEAM, not one menu**, the opposite of the HUD's rule and for a stated reason: a presenter that throws on one question generally throws on all of them, so one report and out beats a fault report every time the player opens anything. Answers that cannot be honoured (unknown choice id, a choice on a browse-only question, an unoffered command key) cost that menu only and are reported. The risk this shape invites is a SECOND COPY of the caller's command-key rules - `MENU_REFRESH` and `MENU_CLOSE` are numbers and must be checked before the "it returned a row index" branch - so `menu-runtime.test.ts` drives the same command down the keydown path AND the presenter path in one test and asserts they agree on the resolved value and on the cursor the handler saw. **The proof is a mod**: `samples/command-dial/` presents `core:game-menu` as a radial dial, answers by id, colours the quit wedge from `semantic.ref` rather than the English label, handles its own keys (legitimately - the host attaches no listener for a question a presenter took), and DECLINES every other menu; `sample-dial.node.test.ts` loads it from disk, drives the full round trip, and asserts the declined `core:spell-book` is still answered by the game's own lettered list. **Still open in this row**: the ~50 `screens.ts` builders (candidate (b)'s biggest piece), and all four consequences of the composition ruling - overlapping ordered regions, mod-created regions, transparency, input routed by region. The menu seam names its own share of that: a menu has no published REGION, so a dial over a still-visible dungeon is not yet expressible and `question.style` is the stopgap. **2026-08-13, step 5 landed: a SCREEN is a document, and two of them have given up their models.** `ModPlugin.screen(ctx)` returns a presenter; `packages/web/src/screen-view.ts` gives a screen a renderer-neutral `ScreenView` - a list of BLOCKS - and `screen-runtime.ts` selects one presenter by the same last-in-load-order rule the other three seams use, gated by one grant (`ui:screen.replace`) with the choice made per screen. **The point is the TABLE block.** A list is columns with stable keys and rows whose cells are addressed BY THAT KEY, so a presenter reads `row.cells.name.text` and never learns that an inventory row is `a) ` then a name padded to 45 then a weight. A row carries the SAME identity a `MenuChoice` does - `core:gear:<handle>` and `{kind: "item", ref: handle}`, asserted equal to `packMenu`'s - because an inventory listing and an inventory picker are the same objects seen twice and a mod should not need two vocabularies for them; and a cell carries `values` under the HUD's convention unchanged, so a weight publishes `{each, total, number}` in tenths of a pound and the presenter formats it its own way. **The column widths are PUBLISHED rather than baked into the text**, which is the trick that lets one model serve both renderings: upstream's listings line up because `OLIST_WEIGHT` writes at a fixed offset, so a faithful terminal needs the width, and a presenter with a proportional font ignores it. **ONE renderer, and core's own painting goes through it**: `inventoryLines` is now `screenBodyLines(inventoryScreen(state))`, so the model and the shipped rows cannot part - the lesson from the HUD, where a model beside a hand-laid copy of the same rows was two transcriptions and the unwatched one rotted. A regression the tests caught while this was being written: the lettered-column indent was derived from "does any row have a tag", which silently un-indents the whole equipment listing on a character wearing nothing, so `tagged` is now a required fact about the TABLE - a layout fact that changes with the data is not a layout fact. **A screen is DISMISSED, not answered**, the one shape difference from the menus: `show` declines by returning `undefined` SYNCHRONOUSLY and takes the screen by returning `{dismissed}`, because once the promise means "the player closed it" there is no value left to decline with. A presenter that throws, that returns no dismissal to wait on, or that dies with the screen OPEN loses the seam for the session AND the game shows the screen itself - a player left staring at a dead overlay has no way out, so this is the one recovery that repeats work rather than dropping it. **How much is actually modelled is DATA rather than a claim**: `MODELLED_SCREENS` names `core:inventory` and `core:equipment`, `screen-view.test.ts` DERIVES that list from the `freezeView` calls that exist - so adding an id without building it fails, and building one without listing it fails - and every other screen arrives under the shared id `core:text` with a single `lines` block of pre-wrapped rows, which is enough to reskin a frame and not enough to reimagine a listing. **The proof is a mod**: `samples/sprite-inventory/` draws both listings as item cards, reads `cells.name` and `values.total` and `semantic.kind === "slot"` rather than the rendered row or the English wording, and declines every other screen; `sample-inventory.node.test.ts` drives it through the real `showTextScreen` and builds its fixture from the game's own exported `INVENTORY_COLUMNS` / `EQUIPMENT_COLUMNS`, so a renamed key cannot leave the sample passing against a vocabulary the game stopped using. **Still open in this row**: the other ~48 screen builders (`characterSheetLines`, the knowledge browser, the spell lists, the monster and object lists, the tombstone), and all four consequences of the composition ruling - overlapping ordered regions, mod-created regions, transparency, input routed by region. A screen still has no published REGION, so an inventory panel beside a still-visible dungeon is not expressible and the full-screen-overlay defect above is still live. **2026-08-13, step 5b (first pass): every LISTING has given up its model.** Four more screens are modelled - `core:quiver`, `core:objects-in-view`, `core:messages`, `core:player-history` - taking `MODELLED_SCREENS` from two to six, and each of them was chosen for the same reason: a list is the shape a presenter most wants and `ScreenLine[]` least gives it. Three things this pass established that step 5 had not. **A column publishes THREE facts about the terminal, not one.** `width` was not enough to reproduce upstream's layouts from a generic renderer: `history_display` writes `"%10ld%7d'  %s"` - no gap before the depth and two before the note - and the object list writes `"%s %s   %s"`, where the location FOLLOWS the name rather than sitting under a column stop. So a column now also carries `gap` (columns of space before it, one by default) and `pad` (false where the game does not line the column up at all). Without them the choice was to change the rendering or leave the screens on `lines`, and changing the rendering to suit the model would have been the port adding something. **The model may carry MORE than the rendering, never less**, and that is now a stated rule with three instances: the quiver publishes its weight as row `values` although upstream's quiver listing has no weight column, the object list publishes its offset as `{dy, dx}` as well as `"2 N 0 W"` (a compass string cannot be turned back into a map marker without parsing English and guessing a sign convention), and the player history publishes `clev`, which the screen never prints. `samples/sprite-inventory` was extended to the quiver to prove the row-level path is reachable - a presenter reading only `cell.values` would have silently lost the weight on the one screen where the terminal cannot show it either. **The `tagged` regression happened again, in its other form, and was caught the same way.** The column HEADER was emitted after the empty-rows check, so a character with no history at all lost the `"      Turn   Depth  Note"` header that upstream prints unconditionally - a table's columns are a fact about the table, not about the rows it holds today, exactly as its letters are. An existing test covered that case and failed; the derived `MODELLED_SCREENS` check also failed, because its regex was pinned to a newline after `freezeView({` and went blind to a call that fits on one line - a derived check a reformat can blind is a declared check wearing a disguise, and it is now whitespace-tolerant. Rendering equivalence for all four screens is carried by the 20-odd tests those builders already had, which passed unchanged; the NEW tests assert only what the model carries beyond the rendering and the two layout facts that are now declared rather than inferred. **Still open in this row**: the screens that are not listings - `characterSheetLines` (whose `showCharacterSheet` is a hand-painted modal with two display modes that never reaches `showTextScreen` at all, so it is a bigger job than a builder swap), the knowledge browser, `spellBrowseLines`, `monsterRecallLines` and the other `Textblock` pages (a `text` block, which would let a presenter re-wrap prose the game currently wraps for it), `tombstoneLines`/`winnerLines` (an `art` block), `help.ts`, `equip-cmp.ts`. Every prose dialog in `mods.ts` / `mod-browse.ts` is arguably FINISHED at `lines` and that judgement still has to be made per screen and recorded. Found and not fixed: `lookLines` has no caller and no test - dead since the target picker replaced it, and left for the orphan sweep (#228) rather than adjudicated here. All four consequences of the composition ruling - overlapping ordered regions, mod-created regions, transparency, input routed by region - remain unbuilt, and the full-screen-overlay defect above is still live. **2026-08-13, step 5b-ii (first group): the PROSE pages give up their models, and the wrapper that laid them out turns out to have been wrong since it was written.** Three more screens are modelled - `core:object-recall` (the 'I' inspect, the context menu's Inspect, the store's Examine and one side of the equipment comparison, all four the same page of the same object seen from four places), `core:object-comparison` and `core:monster-recall` - taking `MODELLED_SCREENS` from six to nine. They are the pages built from a core `Textblock`, and what they now publish is a `text` block: **paragraphs of coloured runs, UNWRAPPED**, split where the core emitted a '\n' and nowhere else. That is the whole point of the block and it is not a cosmetic difference from `lines`: a `lines` block has already been broken into 79-character rows, so a presenter with a panel of its own width - or a proportional font, where "79 characters" is not a width at all - can only re-flow it by undoing the game's wrap first and guessing which breaks were the game's and which were the sentence's. Given the paragraph there is nothing to undo. **ONE renderer again**, the same discipline `inventoryLines` follows: `wrapRuns` is now `screenBodyLines` applied to a `text` block rather than a second hand-rolled wrapper beside the model, and `charsToLine` is deleted. **AND THAT MOVE FOUND A PORT DEFECT, in the function it moved.** Reproducing `wrapRuns` exactly inside the renderer made an existing `text`-block test disagree with it, so the two were traced against 4.2.6's `text_out_to_screen` (ui-output.c L279-347) rather than argued about: upstream wraps on `(x >= wrap - 1) && (ch != L' ')`, so a space landing ON the boundary column is written rather than wrapped on and only the following non-space takes the break. The port scanned backwards from `end - 1` and so never looked at that space, which pushed a word that fit EXACTLY onto the next line - "one two three four five" at width 10 broke as "three" / "four five" where 4.2.6 gives "three four" / "five". Every recall page, every object description and every lore paragraph has been wrapping one word early in that case since the port had recall pages. Fixed in core (a port defect is core's to correct; the `bug-fixes` mod is for upstream's own bugs), with the upstream trace written into the test and a negative control that moves the boundary by one so "never wrap" cannot pass. It was invisible for a reason worth keeping: **10,213 tests passed both before and after the fix**, because no test had ever put a word on the boundary - the case only exists at one specific length, and prose fixtures are written for their content. **The proof is the sample, and it is a comparison rather than a source scan.** `samples/sprite-inventory` now takes the three recall ids and lays their paragraphs out into a 360px panel by MEASURING them through `measureText`; `sample-inventory.node.test.ts` runs the same view through the sample and through `screenBodyLines` at 80 columns and asserts the narrower panel produced MORE rows, which a presenter quietly reusing the game's wrap could not. One existing source assertion had to be narrowed and the narrowing is the interesting part: a blanket ban on `.text.split(` was there to stop the sample parsing a formatted CELL, and word-wrapping a paragraph's run is not that, so the check now names cells instead of banning a method. **Three screens were LOOKED AT AND LEFT, which is the judgement this step owed rather than a shortfall.** `spellBrowseLines` is not a screen at all - it is `selectFromMenu`'s `detail(i)` panel inside the cast/browse menu, so it belongs to the MENU seam and modelling it as a screen would have been wrong; that a menu's detail is still `ScreenLine[]` is a real gap and it is the menu seam's, not this one's. The knowledge browser's rune, feature, trap and shape recalls build `[title, blank, description]` by hand and push the description as ONE line, so the terminal TRUNCATES a long one at `cols - 1` instead of wrapping it - a second finding, not fixed here, because correcting it changes what the player sees and deserves its own adjudication against upstream's `textblock` path. And `objectFakeRecall` / `artifactFakeRecall` / `egoFakeRecall` render the same `Textblock` through `recallBodyLines(textblockToString(tb))`, a THIRD path that flattens to a string and drops every run colour - the knowledge browser's object recall is monochrome where the 'I' inspect of the same object is not. All three are recorded here and none is claimed done. **Still open in this row**: `characterSheetLines`, whose `showCharacterSheet` is a hand-painted modal with two display modes and its own key handling that never reaches `showTextScreen` at all, so it is a seam problem rather than a builder swap; the knowledge browser's own pages (the three paths above); `help.ts`; `monsterListScreenLines`. Every prose dialog in `mods.ts` / `mod-browse.ts` is arguably FINISHED at `lines` and that judgement still has to be made per screen and recorded. All four consequences of the composition ruling - overlapping ordered regions, mod-created regions, transparency, input routed by region - remain unbuilt, and the full-screen-overlay defect above is still live. **2026-08-13, step 5b-iii (first group): the DEATH SCREENS, and an `art` block that publishes the writing apart from the picture.** `core:tombstone` and `core:winner` are modelled, taking `MODELLED_SCREENS` from nine to eleven. The interesting part is not that they were converted but WHAT the conversion had to separate: upstream's tombstone is `dead.txt` with the character's name, class, level, experience, gold and killing blow OVERWRITTEN into columns 8-39 of it by `put_str_centred` (ui-death.c L40-56), so the finished picture has the epitaph burned in and a presenter handed only that picture would have to know the band and the row numbers to get a name back out. So `ScreenArtBlock` grew `fields`: each one a stable `key` (`name`, `title`, `class`, `level`, `exp`, `gold`, `death`, `killer`, `date`), its `text`, `values` where the text is a formatted number, and the `row`/`x1`/`x2` the faithful terminal needs - published beside the data rather than baked into it, exactly as a table column publishes `width`. A field with NO band is centred on the full terminal width, which is not a special case but literally `put_str_centred(i, 0, wid, ...)` - what `display_winner` does for its banner. **ONE renderer again**: `put_str_centred` moved out of `screens.ts` and into `screen-view.ts`, `tombstoneLines` and `winnerLines` are now `screenBodyLines` over their views, and the existing upstream-cited parity tests for both passed UNCHANGED, which is the evidence the picture did not move on the player's screen. The `art` block had been declared since step 5 with no producer; this is its first. **The proof is what did NOT reach the canvas.** `samples/sprite-inventory` draws its own stone and writes `Frodo` onto it, reading `fields` by key and the level and gold from `values`; the test asserts that not one of the block's own ASCII rows appears among the strings the sample drew, and takes those rows from the block under test rather than from a guess about the art, so redrawing `dead.txt` cannot quietly retire the assertion. **Still open in this row**: `characterSheetLines`, whose `showCharacterSheet` is a hand-painted modal with two display modes and its own key handling that never reaches `showTextScreen` at all, so it is a seam problem rather than a builder swap - and it is now the LARGEST remaining screen; the knowledge browser's own pages on the three paths above; `help.ts`; `monsterListScreenLines`; and the per-screen judgement on every prose dialog in `mods.ts` / `mod-browse.ts`. All four consequences of the composition ruling remain unbuilt, and the full-screen-overlay defect above is still live. **2026-08-13, step 5b-iv: the CHARACTER SHEET, both pages, and the first screen a presenter can ACT on.** `core:character` (display_player mode 0: the stat table, the five panels, the history) and `core:character-flags` (mode 1: the four resist / ability / hindrance / modifier regions and the sustains block) take `MODELLED_SCREENS` from eleven to thirteen. Two things here were not builder swaps. **First, the SEAM.** `showCharacterSheet` is a hand-painted modal with two display modes and its own key handling that never reached `showTextScreen`, so no presenter was ever offered the sheet at all - it is now offered its view directly through `showThroughPresenter`, and falls back to the terminal on a decline or a fault exactly as `showTextScreen` does. **Second, ACTIONS.** Upstream's `do_cmd_change_name` (ui-player.c L1219-1289) offers renaming, a character dump and the page cycle from inside the same modal, so a presenter that took the sheet and could not reach them would quietly take three commands away from the player. `ScreenView.actions` publishes them as data - stable `id`, the key the FAITHFUL TERMINAL listens for, the game's own label - and `show(view, host)` hands over a `ScreenHost` whose `invoke(id)` runs one and resolves with the view the player should see next: the renamed sheet, the other page, or `undefined` for "the game has taken it back". An unknown id is a no-op returning the current view, so a presenter built against a later engine cannot close the player's character sheet by asking for a command this one has not got. `installScreen`'s adapter was dropping the second argument and now forwards it, which would otherwise have left every action unreachable with no error anywhere. **Four model additions, each a layout fact published BESIDE the data** rather than baked into it: `ScreenColumn.glyph` (the flag grid's columns ARE the equipment slots, and upstream draws the worn item's glyph over each - a fact about the column, not a first row to skip), `ScreenTableBlock.headerColor`, `ScreenTableBlock.gapAfter` (the blank row between panels, rather than a fake all-empty row that says nothing), and `ScreenTextBlock.wrap` (text_out_wrap = 72 for the history, a clamp on the terminal width and never a minimum). **ONE renderer, again**: `characterSheetLines`, `characterGridLines`, `statHeaderLine`, `statRowLine`, `historyBlockLines` and the wide layout's per-panel blits are all now `screenBodyLines` / the new `screenBlockLines` over the model, `wrapPlain` is deleted, and the whole existing upstream-cited suite for the sheet passed UNCHANGED - which is the evidence the player's screen did not move. **The proof is again what did NOT reach the canvas**: `samples/sprite-inventory` draws the sheet as panels, reading `cells.eb.values.bonus` as a BAR (a thing no re-reading of "STR!  18/100  +1" could give) and `column.glyph` for the slots, and the test asserts that not one COMPOSITE row the faithful terminal would have produced - a label joined to its value, or a padded multi-field line - appears among the strings it drew, with that set taken from the view under test. It also presses 'h' and asserts the page moved THROUGH the host. **Still open in this row**: the knowledge browser's own pages on the three paths above; `help.ts`; `monsterListScreenLines`; the equip-cmp picker/filter overlays; and the per-screen judgement on every prose dialog in `mods.ts` / `mod-browse.ts`. All four consequences of the composition ruling remain unbuilt, and the full-screen-overlay defect above is still live. **2026-08-13, step 5b-v: the KNOWLEDGE BROWSER, all seven recall pages, and two defects the player could see.** `core:rune-recall`, `core:feature-recall`, `core:trap-recall`, `core:shape-recall`, `core:artifact-recall`, `core:ego-recall` and `core:object-kind-recall` take `MODELLED_SCREENS` from thirteen to twenty - seven ids rather than one, because a mod that draws an artifact page as a plaque and a trap page as a warning card has to be able to tell them apart. This row was NOT a builder swap either. All seven end at the same upstream call, `textui_textblock_show` (ui-output.c L155), and it does two things the port was not doing. **(1) It WRAPS**: `textblock_calculate_lines` (z-textblock.c L238) breaks the run stream at the region width, while the port pushed each description as ONE `ScreenLine` and `showTextScreen` slices a line at `cols - 1` - so any description longer than the terminal had its TAIL CUT OFF, on the rune, feature, trap and shape pages. **(2) It KEEPS COLOUR**: `display_area` (ui-output.c L100) writes `attrs[]` per character, while the artifact / ego / object-kind recalls flattened through `textblockToString` and painted the page one colour - which is why the browser object recall was monochrome where the `I` inspect of the SAME object was not. A third correction comes out in the wash: the rune / feature / trap / shape lores pass `header = NULL` and put the capitalised name in the BODY, but the port draws a title row on every screen AND kept the name as body line 0, so the player read it twice; the name is only the title now. `recallBodyLines` is deleted and all seven go through `proseBlock` / `textParagraphs` and the ONE renderer. `samples/sprite-inventory` takes all seven and NOTHING IN ITS PROSE PANEL CHANGED to accept them - adding them was seven strings in a list, which is what a model with a small vocabulary buys. **Recorded here, then measured and closed as #255 on 2026-08-13**: the note filed at the time said the renderer wrapped at `cols - 1` (79) where upstream wraps at 80. The premise was wrong and finding that out was the deliverable - the port matched `textblock_calculate_lines` on 1041 of 1041 shipped descriptions at 80 columns. The real defect was a CITATION: `textBlockLines` implemented `textblock_calculate_lines` while its comment named `text_out_to_screen`, which is why reasoning from the comment produced a false bug report. Measuring instead of reading turned up three genuine ones - the hard-split arm took `cols - 1` where the C takes `cols` (unreachable at 80, reachable by a mod re-rendering at 16); a paragraph ending exactly on a break lost its blank row; and the character sheet history was two columns wide of 4.2.6 and re-flowed, because it is the ONE page on the other algorithm. **2026-08-13, step 5b-vi, part one: the VISIBLE-MONSTER LIST.** `core:monster-list` takes `MODELLED_SCREENS` from twenty to twenty-one, and it is the screen where reading numbers instead of text pays most obviously: a row publishes `values.dy`/`values.dx`, so a presenter can draw an ARROW at the monster, and no arrow is recoverable from `" 3 N 2 W"` without parsing a compass back into the vector it was made from. `values.asleep` is a count where the terminal has the sentence `"(2 asleep)"`, `semantic.ref` is the race a tileset mod looks a sprite up by, and `semantic.data.name` is the game own pluralisation (`get_mon_name`) so a card can say "3 kobolds" without a mod reimplementing English. **The layout question this row had to answer**: the C pads the name with `"%-*s%s"` at a width computed per row (`full_width = max_width - 2 - len(location) - 1`), which LOOKS per-row and is not - the total is `max_width - 1` on every row, because the width shrinks by exactly what the location adds, and upstream own comment says the point of it is to "align the location to the right" (ui-mon-list.c L156). So the model is a fixed name column plus a right-aligned location column, which reproduces the C byte for byte while the name cell arrives UNPADDED. The one place they part is clipping - the C clips at that row own `full_width`, which is more generous on a row whose location is shorter than the section longest - and that is measured rather than argued: the widest name-plus-tag the shipped pack can generate clears the narrowest 80-column name column by 14, and a test fails if a content mod ever closes that gap. **The seam moved out of `main.ts`.** This screen has an ACTION (`sort-exp`, the `x` toggle at ui-mon-list.c L410,456), so it needs a `ScreenHost`, and a seam that only exists inside the game entry point is a seam nothing can drive - the character sheet host wiring was untestable for exactly as long as it lived there. `packages/web/src/monster-list.ts` now holds both ways of showing it. **The sample takes it**, which is the test: `samples/sprite-inventory` draws the list as cards with a compass arrow, and `screens.test.ts` loads that folder by path, drives the real `showMonsterList` through the real seam against a real `GameState` with a real monster, and asserts `"↘ 3"` reached the canvas - a string the game never produces. Then it presses `x` and checks the footer changed, so the GAME re-sorted and handed back the new view. **2026-08-14, step 5b-vi finished, and the scope it was written against was short by six screens.** `MODELLED_SCREENS` goes from twenty-one to **thirty-seven**: the four help pages, the equip-cmp screen's two help overlays, the mod manager's four listings, the hall of fame, the knowledge store view, the update and report pages, and wizard mode's two debug readouts. **The step was scoped from a list and the list was wrong**, which is the finding worth keeping: a sweep of every OTHER file in `packages/web/src` turned up `score.ts`, `main.ts`'s `showStoreKnowledge`, both wizard readouts and the two shell pages, none of which the step named. Three of those were a different KIND of gap - `score.ts`, `drawWizItem` and the two shell pages called `term.clear()` / `term.print()` and never reached `showThroughPresenter` at all, so they were invisible to a mod rather than merely flat, and invisible to a grep for screen call sites too. **THE HALL OF FAME IS THE ONE THAT MATTERED**: a leaderboard is the first thing a UI-replacing mod rebuilds, `HighScore` already carries a field per column, and `scoreRow` joined them into three prose strings before anything could see them. The fix went into CORE - one `ScoreRow.fields` extraction that the three display lines are then built FROM - because publishing the fields as a second independent read beside the strings is the two-transcriptions failure, and the copy nobody looks at is the one that rots. **Two more screens were prose only because a PRODUCER had destroyed their structure**, which is now its own row (#256): `mod-install.ts` flattened `checkMod`'s `{title, problem}[]` into a string that `mod-browse.ts` then split back apart and re-wrapped - the process re-parsing a rendering it produced two frames earlier - and `mod-conflicts.ts` described every `ContestedSlot` into `string[]` before the pane saw it. Both now carry the records beside the sentences, with the sentences DERIVED from the records so the two cannot part, and `core:mod-conflicts` is a table. **Saying so was half the work, as this row said it would be**: all 32 `showTextScreen` call sites in the mod manager were read one at a time and twenty-four are genuinely prose, each with the reason in the source. **A NEW KIND OF BLOCKER appeared and is counted separately**: the install-refusal screens stay at `lines` not because of their data, which now arrives intact, but because a `table` row is exactly one terminal row and cannot wrap, while four of five bullets the shipped requirement set produces are longer than the width the screen wraps to. That is the block VOCABULARY, and it belongs to `screen-view.ts`. **Byte-identical rendering was the acceptance criterion throughout**, against output captured from the real producers before each change and asserted as full `ScreenLine` objects rather than `.text`, so a coloured cell emitting a `runs` array where a plain coloured line used to go would show; one check was verified by BREAKING IT ON PURPOSE, because a snapshot that has never failed is not a snapshot. Two rows could not be reproduced and are reported rather than adjusted: the store view's header (a `tagged` table renders its header on the data grid, which would move `Store Inventory` from column 0 to 3), and the symbols page's intro, which stays on `lines` because upstream hand-wrapped that file and reproducing its breaks from a paragraph needed a wrap clamp chosen to fit the answer. **The playing guide and the community page went the other way** and publish their prose unwrapped, moving seven paragraphs' line breaks and no words - a trade available only because both are PORT ADDITIONS with no upstream layout to be faithful to. **Still open in this row**: overlapping, ordered, mod-created, transparent regions and compositing, and input routed by region - both now DESIGNED in seven staged commits (#261), neither built; a PROMPT SEAM (#258), because `ScreenHost.invoke` holds when the game's answer is a new view and breaks when its answer is to ask the player something, which the character sheet's `rename` and `file` have done since they shipped; and the spell lists, which belong to the menu seam. The full-screen-overlay defect above is still live, and the design reframes it: both sides were behaving correctly, and what was missing was that a screen had no rectangle at all, so nothing could learn it was being covered. **2026-08-14, milestone 6 landed: three of the four consequences are built, and the fourth is the one left.** Regions overlap and are ORDERED by band (`RegionLayer`: `base`/`overlay`/`modal`/`system`, later-declared on top within a band, `system` reserved to the game); a mod CREATES regions (`ModPlugin.regions()`, `ui:region.create` — a distinct capability ACTION that `ui:*.replace` deliberately does not cover, published across all four ABI sites in #267); a region is TRANSPARENT wherever it did not write, with `clipSurface` DROPPING an outside write rather than clamping it onto a neighbour. `ui-stack.ts` is the live stack and the compositor, `paintRegionStack` is pinned on the AST as the literal last statement of `render()`, and `samples/sprite-inventory` ships a real `regions()` panel that draws on the character grid with no DOM at all. Five owner runtimes are wired in `main.ts`, and core is candidate zero for every base region it is not out-claimed on. **What is NOT built is consequence (4), input routed by region**: `topRegionAt` exists, is tested, and has ZERO production consumers, and `RegionDeclaration` has no input member of any kind. The cost is measurable rather than theoretical — `main.ts`'s tap-to-move handler gates on `modalDepth` and the map rectangle and on nothing else, so **tapping a mod's own overlay region walks the player's character**, and a long-press there opens the game's context menu for the dungeon square underneath it. **The full-screen-overlay defect is now PARTLY closed, and the remainder is counted**: `showViewOnTerminal` and `showLevelMap` declare regions, so a front end is told and `blueprint-view` stands down — but of the four screens photographed above, only the inventory goes through that path. **2026-08-14, #253: ten more screens declare their rectangle** — all four birth screens (and `drawBirthSheet`, which took all four of its callers to convert), both of the character sheet's own terminal painters, and all four of the mod browser's wait screens. **20 of the 33 enumerated `term.clear()` sites are still full-screen erases nothing can learn about**; four of those 20 are the PROMPTS, which is where this row and #258 meet, and two more are `main.ts`'s own report and update pages. **This closes no seam and this row stays open**: converting a screen gives a mod nothing it could not reach before, it removes a reason the screen could not coexist with one. The remainder is `main-regions.test.ts`'s `TERM_CLEAR_PENDING`, which is now a VALUE rather than a list of comments, so the count above is derived from the table rather than recounted by hand. **2026-08-14, #276: input is ROUTED BY REGION — built.** `clipSurface` records the cells each painter writes, erases included, and `regionInputAt` answers with the topmost painted owner in region-local coordinates. Tap, desktop context-click and touch long-press ask that cell question before core movement or context routing, so **tapping a mod's own panel no longer walks the player's character**; a region with no `input` handler still consumes pointers on its painted cells, which is what makes the shipped `sprite-inventory` sample correct without changing it. Pointer input is positional ONLY — keyboard focus stays out of scope, because a region that took keys would be a second answer to what a player command means. `topRegionAt` remains the rectangle/layout helper rather than the input router. The design is `docs/modding/REGION_INPUT.md`, ruled cell-opaque (a region is opaque to input exactly where it PAINTED, so sight and touch obey one rule) and written independently by two model families that converged on every load-bearing decision. Two corrections this row owed: the tap handler does NOT gate on `modalDepth` and the map rectangle alone — it also checks `scoresOpen`, `dead` and `mouse_movement` — and candidate-zero is not one universal runtime, `hud-runtime.ts` supplies it for HUD regions while the map's lives in `frontend-runtime.ts`. **A note on this row's own bookkeeping:** the "14 milestones, 13 done" figure that has been quoted in status reports was recorded in NO artefact in this repository when that was written. **Re-measured 2026-08-14, and the figure had already decayed:** `MOD_REACH.md` now contains the word "milestone" five times and `CHANGELOG.md` twice, so a reader who trusted the sentence above would be counting against a tree that had moved under it — which is the exact failure the sentence was warning about. The GitHub issue list is still empty. A 14-item list can be RECONSTRUCTED from this row's dated steps plus milestones 6 and 7, and it happens to fit, but that is an inference. A number nothing in the tree states is a number that cannot go stale visibly. |
| 20 | **A mod can teach core a new ITEM CLASS** | **CLOSED 2026-08-09** | `object.json` has always accepted a new record, so a mod could always ship a new ITEM. Making core recognise a new item CLASS - a tval - was a different thing entirely, and **the switch census could see almost none of it.** The census counts `switch` statements; `obj/object.ts` exports **34 class predicates** ported from `obj-tval.c`, and the 29 written as `tval === TV.STAFF` are exactly as closed to a mod as the 5 written as switches. **408 call sites** across `core` and `web` ask these questions, and a mod-coined tval answered **no to every one**: its items were not weapons, could not be worn, could not be flavoured, could not be browsed as a book, had no charges and no timeout. Plus two dispatches: `kindIsGood` (`obj-make.c`), so a new class could never be good on the strength of its own plusses, and `objectValueBase` (`obj-power.c`), whose `default: return 0` means a shop shows an unidentified item of an unknown class as **worthless**. The five census rows were also shelved under "object naming / description" through four re-measurements - a verdict can have the right CLASS and the wrong SUBJECT, which is why `switch-census.test.ts` stayed green over the error. `TvalRegistry` (`obj/tval-registry.ts`) is three tables reached through `registry:tval`, and `classes` is **keyed on the exported predicate's own name** (`"tvalIsWeapon"`), so there is no translation table between what a mod writes and what core calls - and `tval-registry.test.ts` DERIVES its expectations from the module's exports, so a predicate added later and forgotten fails instead of silently answering `false` forever. What proves the conversion: **1,224 golden answers** (36 tvals x 34 predicates, the complete cross product rather than a sample - these are pure functions of one small integer, so there is no sampling judgement to get wrong) plus **389 real object kinds** through both dispatches, all recorded before the registry existed (commits `22eb08009`, `16f8599c5`). No RNG probe, and that is measured: nothing on these paths draws. Controls all run and restored - widening `tvalIsBolt` to accept ARROW fails and names ARROW; changing `objectValueBase`'s WAND arm from 50 to 51 fails; dropping one arm fails the derived check by name; unwiring the host target throws "did not wire"; a mod without the capability throws at the gate. Reach is proven from disk (`mod-code.node.test.ts`) by a real mod folder coining tval 200, WRAPPING three class predicates and registering both dispatches, then read back through the REAL exported predicates - the same functions the 408 call sites call, not the table. |

---

## The goal: every dispatch point in this document becomes moddable

**A correction, recorded 2026-08-08.** An earlier revision of this page argued
that "hooks or connectors for every conceivable mod" was not achievable and
should not be the goal, and proposed three metrics *instead of* it. The owner's
ruling is that this was never the project's decision:

> "That whole decision of limiting modding was something you had previously
> fabricated and imposed on me. I don't want to release a game that can only be
> modded in ways that it has been modded."

The ratified position is PORT_PLAN decisions 13-15, the **total moddability
guarantee**, and it stands. Every gap in the list above is work to be done, not
a boundary to be documented. This section used to be the boundary; it is now the
plan.

### How "everything is moddable" is made falsifiable

The one sound point in the old argument was that an unmeasurable goal gets
reported as done without being done. The answer is not to shrink the goal. It is
to make the goal testable, and the owner supplied the mechanism:

> "If you feel compelled to only do what CI can test, then create sample mods
> that use all of the seams and build your tests with them."

That works because **a sample mod that exercises a seam is a test that fails when
the seam does not exist.** It cannot pass vacuously, it cannot pass from inside
the bundle if it is installed from disk, and it is the same artifact a
third-party author would write - so it proves reach rather than asserting it.

So each seam lands with a sample mod that uses it, and the sample mods are run
from disk in CI. `MOD_CANARY=1` already runs bundled mods through `discoverMod`;
this extends that pattern to every seam rather than the content path alone.

### The three numbers, as progress measures

These are how progress is reported. They are **not** a replacement for the goal:

1. **Non-bundled reach = 1.0.** Every seam a bundled mod can reach, a mod
   installed from the mods folder can also reach. `seams reachable from disk /
   seams reachable from the bundle`.
2. **Dispatch coverage.** Denominator is the enumerated dispatch points in this
   document, kept current by a census script so a new `switch` cannot be added
   without appearing. Numerator is the ones a mod can add to, override or wrap.
   **The target is the whole denominator.**
3. **Zero silent no-ops.** Every mod-facing operation either takes effect or
   produces a named error the author can see. A seam that quietly ignores a mod
   costs an author a day and teaches them the engine is not worth their time.

### What this costs, stated honestly

Each seam is a permanent public contract with a fold rule and a determinism
obligation, and converting a faithful `switch` into a registry is a real refactor
that must be proven behaviour-identical. That is the price of the guarantee, and
it is finite: the denominator above is a list, not an abstraction. Core keeps
every 4.2.6 wart - a registry changes *who can register*, never what the
unmodded game does, and the parity harness is what proves it.
