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
| `ModHooks` behaviour hooks | **7** (`packages/core/src/mod/hooks.ts:78`) |
| Named behaviour-dispatch points enumerated (tables/switches where the game looks up what to DO by key or index) | **25** |
| ...of those, a mod's CODE can add to or override | **5** |
| ...of those 5, reachable by a mod that is NOT compiled into the web bundle | **0** |
| `registry:*` capabilities with real, wired, tested code | **5** of 5 |
| Non-test callers of that registry host in a RELEASE build | **0** |
| Gamedata record files a mod can contribute to | **44** of upstream's 45 |
| ...of those, addressable PER RECORD (patch / replace / remove) | **24** |
| ...whole-file-replacement only, where a per-record patch is SILENTLY dropped | **20** |
| Resource categories a non-bundled mod can supply or override | **0** of 7 |

The one thing a mod installed from disk can do today, in a release build, is
**contribute gamedata JSON records**. That is real, it is layered properly, and
it reaches 24 record types per record and 20 more only as a whole file. Every
code and resource seam is closed to it.

---

## (a) Code

### The 7 behaviour hooks, and what each can change

`ModHooks` (`packages/core/src/mod/hooks.ts:78`) is a typed interface of optional
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

#### Real registries with a `register()` method — 5

| Registry | File | Entries | ADD | OVERRIDE | WRAP |
| --- | --- | --- | --- | --- | --- |
| `EffectRegistry` | `packages/core/src/effects/interpreter.ts:312` | **112** numeric codes | yes (string codes) | yes (`register` replaces, `:328`) | yes (`handlerFor(code)` `:323` returns the current handler, so a wrapper can call it) |
| `RoomRegistry` | `packages/core/src/gen/room.ts:2103` | **19** builders | yes | yes (`:2113` `map.set`) | yes (`get(name)` `:2117`) |
| `ActionRegistry` (player commands) | `packages/core/src/game/player-turn.ts:73` | **43** command codes in a fully-wired game | yes | yes (`:77`) | yes - and core already does this itself: `game/cave-cmd.ts:885` reads the prior `walk`/`jump` action and re-registers a wrapper |
| `DungeonProfiles` (cave builders + profiles) | `packages/core/src/gen/cave.ts:2758` | **9** builders (`:2839-2847`), **9** profiles (`:2854`) | `registerBuilder` `:2762` / `addProfile` `:2776` exist | yes, in principle | yes |
| `VocabularyRegistry` | `packages/core/src/mod/vocabulary.ts` | mod-owned, starts empty | yes | n/a | n/a |

The `ActionRegistry` count was measured as 34 distinct literal
`register("<code>")` calls across `packages/core/src` (none in
`packages/web/src`) plus the 9 codes that appear only in `STUBBED_COMMANDS`
(`game/player-turn.ts:703`, registered by the loop at `:736` with no literal):
`quaff`, `read`, `eat`, `use-staff`, `aim-wand`, `zap-rod`, `activate`, `look`,
`search`. Registration sites are `player-turn.ts:729-736`, `cave-cmd.ts:885-1108`,
`obj-cmd.ts:1473-1759`, `player-path.ts:1429-1433`, `ranged-cmd.ts:263-366`,
`spell-cmd.ts:291,351`, `pickup.ts:480-481`, `steal.ts:163`, and `trap.ts:754`
(which re-overrides `disarm`).

All four core registries are reachable through a deps bag rather than being module
constants - `deps.profiles` / `deps.rooms` at `gen/generate.ts:415,419`,
`ctx.registry.handlerFor(code)` at `game/effect-attack.ts:613`,
`processPlayer(state, registry)` at `game/player-turn.ts:772` - and three are
surfaced on the started game (`session/game.ts:396`, `:403`, `:507`). So the
plumbing for override genuinely exists.

**But: `DungeonProfiles` has no facade.** `REGISTRY_CAPABILITIES`
(`packages/core/src/mod/registry-host.ts:58`) covers `effect`, `room`, `command`,
`monster`, `vocab` - not cave profiles. So of the 5 registries, a mod is offered
4 (three of them plus the monster-turn hook), and the level-generation
ARCHITECTURE (which builder runs, which profile is chosen) is not among them.

#### Index-keyed handler arrays — 2

| Table | File | Entries | ADD | OVERRIDE | WRAP |
| --- | --- | --- | --- | --- | --- |
| `MONSTER_HANDLERS` (projection -> monster, `project-mon.c`) | `packages/core/src/mon/project-mon.ts:770` | 56 slots, 56 assigned | no (fixed length, `PROJ`-indexed) | **accidentally yes** | accidentally yes |
| `HANDLERS` (pref-file directives) | `packages/core/src/visuals/prefs.ts:484` | 12 | no | no | no |

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
These are the significant ones:

| What it dispatches | File | `case` labels |
| --- | --- | --- |
| **monster blow effects** (`mon-blows.c` `melee_effect_handler_f`) | `packages/core/src/combat/mon-melee.ts:460` | 26 |
| the SAME dispatch, a second time (`resolveBlowEffectLive`) | `packages/core/src/combat/mon-melee.ts:750` | 26 |
| projection -> feature (`project-feat.c`) | `packages/core/src/game/project-feat.ts:132` | 37 |
| projection -> object (`project-obj.c`) | `packages/core/src/game/project-obj.ts:88` | 11 |
| **store behaviour** | `packages/core/src/store/store.ts` (`storeWillBuy:235`, `massProduce:281` whose switch is at `:285`) | 27 |
| randart property construction | `packages/core/src/obj/randart-build.ts` | 111 |
| object naming / description | `packages/core/src/obj/object.ts`, `obj/desc.ts` | 74, 34 |
| object knowledge | `packages/core/src/obj/knowledge.ts` | 43 |
| effect info strings | `packages/core/src/effects/effect-info.ts` | 52 |
| UI entry types | `packages/core/src/game/ui-entry.ts` | 32 |
| web UI context-menu routing | `packages/web/src/main.ts` (6 `switch (items[idx]?.action)` sites) | - |

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
| `PROJECTION_ENTRIES` / `PROJ` | `generated/projections.ts:11` | **31** |
| `ELEMENT_ENTRIES` / `ELEM` | `generated/elements.ts:7` | **25** |
| `ROOM_ENTRIES` / `ROOM` | `generated/rooms.ts:7` | **19** |
| `DUN_PROFILE_ENTRIES` / `DUN` | `generated/dun-profiles.ts:7` | **9** |

Plus two more closed tables outside `generated/`:

| Table | File | Entries | Overridable |
| --- | --- | --- | --- |
| `COMMAND_INFO` (upstream `game_cmds[]`) | `packages/core/src/cmd.ts:165` | **112** | no (`ReadonlyMap`) |
| `SOUND_PREF_ENTRIES` (`MSG_` -> sound) | `packages/core/src/sound/sound-prefs-data.ts:23` | **149** | no |

Note the asymmetry with `ActionRegistry`: the LIVE player-command seam is a
registry a mod can override, but the faithful `cmd.ts` `COMMAND_INFO` table (112
entries) that the web loop does not drive is a closed constant.

#### Web UI tables — none reachable

`packages/web/src` holds roughly 22 named lookup tables. None is reachable from a
mod, and two are worth naming because they are what a UI mod would want:

- The **keypress -> command** table, `COMMANDS`,
  `packages/web/src/main.ts:7337` (62 entries, counted over lines 7337-7429;
  it "mirrors `cmd_lookup` exactly"). It is not exported and it is declared
  INSIDE the `window.addEventListener("keydown", …)` callback that opens at
  `main.ts:7149`, so it is re-created per keypress and unreachable from outside
  the closure even to a bundled mod. It is scanned linearly at `main.ts:7430`.
- `DEBUG_MENU`, `packages/web/src/wizard.ts:463` (9 categories / 41 items):
  exported and not `readonly`, so a bundled mod could mutate it. Same
  accidental-seam caveat as `MONSTER_HANDLERS`.
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
| 1 | `EffectRegistry` (112) | **yes** (bundled only) |
| 2 | `RoomRegistry` (19) | **yes** (bundled only) |
| 3 | `ActionRegistry` (43) | **yes** (bundled only) |
| 4 | `GameState.monsterTurnHook` (1, all-or-nothing) | **yes** (bundled only) |
| 5 | `VocabularyRegistry` (mod-owned) | **yes** (bundled only) |
| 6 | `DungeonProfiles` builders (9) + profiles (9) | no - registry exists, no facade |
| 7 | `MONSTER_HANDLERS` (56) | accidental only - exported mutable array |
| 8 | prefs `HANDLERS` (12) | no - module-private |
| 9 | monster blow effects switch (26) | no |
| 10 | monster blow effects switch, live copy (26) | no |
| 11 | projection -> feature switch (37) | no |
| 12 | projection -> object switch (11) | no |
| 13 | store `storeWillBuy` / `massProduce` switches (27 cases) | no |
| 14 | randart property switch (111) | no |
| 15 | object naming / desc switches (74 + 34) | no |
| 16 | object knowledge switch (43) | no |
| 17 | effect info switch (52) | no |
| 18 | UI entry type switch (32) | no |
| 19 | `COMMAND_INFO` faithful command table (112) | no - `ReadonlyMap` |
| 20 | `MESSAGE_ENTRIES` / `MSG` (154) | no |
| 21 | `SOUND_PREF_ENTRIES` `MSG_` -> sound (149) | no |
| 22 | `MON_SPELL_ENTRIES` (93) | no |
| 23 | web keypress `COMMANDS` (62) | no - inside a closure |
| 24 | web context-menu `switch (action)` routing (6 sites) | no |
| 25 | web `DEBUG_MENU` (41) | accidental only - exported mutable |

5 yes, 2 accidental, 18 no. And every "yes" is bundled-only, so the
non-bundled figure is 0/25.

### The capability-gated registry host: real code, and who can reach it

`packages/core/src/mod/registry-host.ts` (258 lines) is not a design note. All
five facades delegate to live objects, the gating throws, the capability grammar
validates, and the host constructs it for real:

| Capability | Facade | Delegates to | Line |
| --- | --- | --- | --- |
| `registry:effect` | `EffectFacade` | `EffectRegistry.register` / `.isRegistered` | `:197-206` |
| `registry:room` | `RoomFacade` | `RoomRegistry.register` | `:207-212` |
| `registry:command` | `CommandFacade` | `ActionRegistry.register` / `.has` | `:213-222` |
| `registry:monster` | `MonsterFacade` | `GameState.monsterTurnHook` (`game/context.ts:686`) | `:223-230` |
| `registry:vocab` | `VocabFacade` | `VocabularyRegistry` | `:231-256` |

- Gating is real: `requireCap` throws `AgentCapabilityError` (`:165`);
  `requireTarget` throws when the host did not wire that registry (`:177`).
- The grammar is real and strict:
  `REGISTRY_RE = /^registry:(\*|effect|room|command|monster|vocab)$/`
  (`packages/mod-sdk/src/capabilities.ts:67`); an unrecognised capability is a hard
  error at parse, not a silent no-op.
- Host wiring is real, not test-only: `packages/web/src/main.ts:8187` constructs
  it with `{effects, rooms, commands, state, vocab}` and calls
  `plugin.register(host, ctx)`. Entered via `?trusted=<id>`
  (`main.ts:8242-8243`) OR from the persisted enabled-mod set with consent
  (`main.ts:8303`).
- Consent UI is real (`packages/web/src/capability-describe.ts` marks the four
  system domains `elevated`).

**And now the part that matters.** Both code-discovery paths are build-time Vite
globs over a directory inside the web package:

- trusted plugins: `import.meta.glob("../../../mods/*/trusted.ts")`,
  `packages/web/src/agents/trusted/discover.ts:19`
- behaviour hooks: `import.meta.glob("../mods/*/hooks.ts")`,
  `packages/web/src/mod-hooks.ts:48`

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

---

## (b) Data

This is the strongest area, and the numbers are good - with one measured hole
that is large and silent.

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
a mod's; `activePackSet()` is `[core, ...enabled content mods]` (`pack.ts:308-329`);
`mayModify` (`compose.ts:94-96`) is the only gate and is
`ownerPack === m.id || m.dependencies?.[ownerPack] !== undefined` - `"core"` is
not special-cased anywhere, and `compose.ts:13-17` says so. So a mod declaring
`"dependencies": { "core": "*" }` can patch, replace, or remove any core record.
Without the dependency, compose throws (`compose.ts:142-146`).

### The 20-file hole (the important measured finding)

Per-record addressing requires that EVERY contributing pack's `records` be
name-keyed with unique string slugs (`recordsComposable`,
`packages/mod-sdk/src/loader.ts:68-77`). Files that fail that test are classified
as passthrough (`loader.ts:103-114`) and their per-record ops are **stripped from
the contribution before compose ever sees them** (`loader.ts:116-122`).

Measured over the shipped core pack: **24 composable, 20 passthrough.**

- **Composable (24)**: `activation`, `artifact`, `blow_effects`, `blow_methods`,
  `class`, `curse`, `dungeon_profile`, `monster`, `monster_base`,
  `monster_spell`, `object_property`, `p_race`, `pit`, `player_property`,
  `player_timed`, `quest`, `realm`, `room_template`, `shape`, `summon`,
  `terrain`, `ui_entry`, `ui_entry_base`, `ui_entry_renderer`.
- **Passthrough / whole-file only (20)**, for two different reasons:
  - `name` is not a string: `body`, `constants`, `flavor`, `hints`, `history`,
    `names`, `object_base` (`name` is `{tval,name}`), `pain`, `projection`,
    `store`, `trap` (`name` is `{name,desc}`), `ui_knowledge`, `visuals`,
    `world`.
  - core's own data has duplicate slugs: `brand` (`acid`), `chest_trap`
    (`poison-needle`), `ego_item` (28 duplicates), `object` (45 duplicates, e.g.
    `Searching`, `Light`, `Teleportation`), `slay` (`demons`), `vault` (3
    duplicates).

**The failure mode is silence.** A `patches` entry aimed at a passthrough file is
dropped with no error, no conflict-report line, and no visible effect
(`loader.ts:119`). The same is true of `removes`. So today a mod **cannot** patch
a single object, ego item, vault, trap, store, brand, slay, object base,
projection, or constant - it can only replace the whole file, destroying anything
another mod put there. `loader.ts:22-24` calls refining passthrough "W1.2" and
treats it as open, but says nothing about the duplicate-slug half, which is what
disqualifies `object` / `ego_item` / `vault`.

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
- **Provenance is discarded before core sees anything.**
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
  provenance … savefiles embed this" is therefore **not true today**; the ops and
  the conflict report exist, the runtime provenance does not reach core.
- **Load order is not the player's order.** `orderPacks` discards the incoming
  order (`packages/mod-sdk/src/loader.ts:80-84`) and resolves topologically with a
  LEXICOGRAPHIC tie-break (`packages/mod-sdk/src/resolve.ts:128-131`, `:142-144`).
  So between two independent mods patching the same record, `z-mod` always beats
  `a-mod` - while the conflict report tells the player "z-mod wins - drag to
  reorder" (`packages/mod-sdk/src/conflicts.ts:208-212`), which cannot change the
  outcome.

### Disk vs bundled data path

Both converge at `packages/web/src/pack.ts:118-124` into one `discoverMods()`
map, and `pack.ts:323-326` casts `mod.files` straight to `LoadedPack["files"]`
with no filtering of `records` / `patches` / `replaces` / `removes` /
`fieldPatches` - so **a disk mod has identical data expressive power to a bundled
one.** Divergences worth knowing:

| | disk | bundled |
| --- | --- | --- |
| manifest validation | `validateManifest`, folder name must equal `manifest.id` (`disk-packs.ts:300`, `:309-312`) | none - `modManifest` just fills defaults (`pack.ts:285-305`) |
| `load-order.json` | skipped (`disk-packs.ts:319-322`) | NOT skipped - only `manifest` is excluded (`pack.ts:105`), so it would bind as a record file named `load-order` |
| `demo-*` filter | none | `isShippedMod` drops them in release (`pack.ts:101`) |
| id collision | disk loses to a bundled pack of the same id, reported as a problem (`pack.ts:118-124`, `:145-148`) | wins |
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
  `enabledTileModes` (`packages/web/src/tile-mods.ts:98-149`) and layered over
  core by `composeTileModes` (`tile-catalog.ts:129-151`). A `linoleum`-engine
  pack may claim a NEW grafID (>= 100) and add a menu row
  (`tile-mods.ts:119-135`); a `tilesheet` pack may only re-skin a grafID core
  already knows (`tile-mods.ts:137-145`). Live example:
  `packages/web/mods/linoleum/manifest.json:11-18`.
- **But discovery is the same build-time glob plus `isShippedMod`**:
  `import.meta.glob("../mods/*/manifest.json")` at
  `packages/web/src/tile-mods.ts:183-199`, filtered at `:195`. And
  `tile-mods.ts` never imports `diskPacks()`, whose only consumers are content
  composition and enable-resolution (`pack.ts:118-124`, `:130`, `:145`, `:280`).
- `tilePacks` is also **not in the validated schema**: `PackManifest`
  (`packages/mod-sdk/src/manifest.ts:49-119`) has no such field;
  `tile-mods.ts:61-73` reads it loosely off the raw JSON.

**A concrete, measurable asymmetry worth fixing first.** On desktop the shell
already serves arbitrary pack files over loopback INCLUDING images (MIME table
`packages/desktop/src/main.ts:145-147` for `.png`/`.svg`/`.ico`, `:150-152` for
`.wav`/`.mp3`/`.ogg`; `/mods/` route at `:312-314`), and a disk `shape:"tiles"`
pack IS surfaced in the mod manager because `discoverContentModManifests`
(`pack.ts:178-187`) lists every non-plugin manifest from `discoverMods()`. So a
player can drop a tile pack in the mods folder, see it listed, enable it - and get
no new Graphics row, because `availableTileModes` (`main.ts:1044-1047`) comes from
the bundle-only glob. **The bytes are reachable; the registration is not.**

The non-mod escape hatch is `?tiles=<base-url>` + `?graf=<id>`
(`tiles.ts:178-187`, `main.ts:1005-1006`), which also unlocks the full catalog
(`tile-catalog.ts:109`). That is a user/URL affordance, not a mod path, and it
cannot add a grafID.

### Pref files (`.prf`) — parsed fully; not mod-suppliable

The `ui-prefs.c` grammar is ported: `packages/core/src/visuals/prefs.ts` (one
grammar over an injected `PrefSink`, `:84-90`; writer `prefsSave` `:727`;
`parseTilePrefsInto` `:969`), plus `visuals/tile-prefs.ts` and
`visuals/glyph-table.ts`. The UI is `packages/web/src/prefs-ui.ts`
(`processPrefFile` `:141-161`, "Load a user pref file" `:170-188`,
`dumpPrefFile` `:112-126`), resolving against the virtual `ANGBAND_DIR_USER`
(`packages/web/src/userdir.ts`).

A USER can load one. A MOD cannot - there is no manifest field and no discovery.
There is a recorded divergence at `prefs-ui.ts:134-139`: upstream also searches
`ANGBAND_DIR_CUSTOMIZE` and the graphics mode's directory; the port ships no
`lib/customize` tree and searches only the user location. Partial exception: a
TILE pack does supply `.prf` files, which `loadTilePrefs` fetches and follows
`%:` includes from (`tiles.ts:214-248`) - reachable only through the gated tile
discovery or `?tiles=`.

### Fonts — no loading or selection path at all

One hardcoded bitmap font, `FONT_16X24`
(`packages/web/src/font-16x24.ts:16`, generated from
`reference/lib/fonts/16x24x.fon`), installed as the terminal default at
`packages/web/src/term.ts:146`. A constructor escape hatch exists -
`bitmapFont?: BitmapFontData | null` (`term.ts:176-180`, applied `:192`) - with
**zero production callers**: the only construction site is
`new GlyphTerm(canvas)` (`main.ts:464`), no options object. No `setFont`, no font
fetch, no `font.prf` (mentioned only as a non-ported upstream file at
`packages/web/src/launch.ts:33-34`), no manifest field. A mod cannot supply a
font.

### Sounds — a full subsystem exists and assets ship; a mod still cannot supply one

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

A USER can point it elsewhere with `?sounds=<base-url>` (`main.ts:7619`). A MOD
cannot: `grep -rn "soundPacks|soundPack|fontPacks"` across `packages/` returns
zero hits - no manifest field, no discovery, no per-mod sound base.

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

### Localization — no seam

No i18n layer exists. `grep -rn "i18n|useTranslation|gettext|navigator.language|Intl\."`
over `packages/` (excluding `node_modules`) yields two hits, both unrelated
(`packages/linoleum/src/convert.ts:159`, `:161`, `Intl.Collator` for deterministic
sort). Every other `locale` hit is `localeCompare`. All UI text is inline TS
string literals. There is nothing a mod could supply strings through - which is
also worth noting against the standing "localization everywhere" intent.

**Net for resources: 0 of 7 categories** (tiles, prefs, fonts, sounds, UI
strings, help, art) is reachable by a non-bundled mod. Tiles is the only one with
a mod seam at all, and it is bundle-gated.

---

## (d) The gap list

Ranked by how much of "the whole game can be made over" each one unlocks.

| # | Capability | Today | What would have to exist |
| --- | --- | --- | --- |
| 1 | **A mod can supply CODE without being compiled into the app** | **no** | A runtime module-loading path (desktop: load a mod's JS from the mods folder; web: dynamic `import()` of a served URL, or an accepted "web is reduced" split). Everything below is blocked on this: 100% of the code seams that DO exist are behind two build-time `import.meta.glob`s (`mod-hooks.ts:48`, `agents/trusted/discover.ts:19`) plus `isShippedMod`. |
| 2 | **Per-record patching of the other 20 gamedata files** | **no** (silently dropped, `loader.ts:119`) | A stable per-record KEY that does not depend on a unique string `name` - a composite key for `object_base`/`trap`, and a synthetic index or `(tval, sval)` key for the 6 files whose names collide in core's own data (`object` 45 dups, `ego_item` 28, `vault` 3, `brand`, `slay`, `chest_trap`). Plus a loud error when an op targets a passthrough file, so it can never be silent again. |
| 3 | **Behaviour seams covering the game rather than 7 points** | **7 hooks** | Not more one-off hooks. The measured shape of the problem is that behaviour lives in ~20 `switch` statements (26-case blow effects ×2, 37-case project-feat, 27-case store, 11-case project-obj, …). Converting the significant ones into keyed registries of the `EffectRegistry` shape is the only mechanical route from 7 points to a layer. |
| 4 | **Monster combat is moddable** | **no** | `blow_effects.json` accepts a 31st record but its behaviour is `combat/mon-melee.ts:460` (and again `:750`). Needs a blow-effect registry, and needs the duplicated switch collapsed to one body first. |
| 5 | **Store behaviour is moddable** | **no** | There is no table to register into: `storeWillBuy` (`store/store.ts:235`) and `massProduce` (`:281`) are switches, and `StoreRegistry` is a `BoundStore[]` with linear scans (`store/bind.ts:129`). |
| 6 | **Level generation architecture is moddable** | **partial** | `DungeonProfiles` (`gen/cave.ts:2758`) already has `registerBuilder` / `addProfile`, and `dungeon_profile.json` is one of the 24 patchable files - but there is no `registry:profile` facade, so a mod cannot reach the builders. This is the cheapest real win on the list: the registry exists; only the facade and capability are missing. |
| 7 | **Resources: sounds / fonts / splash / help** | **no** | Manifest fields (`soundPacks`, `fontPacks`, …) plus discovery, and - on the desktop side only - nothing else, because the loopback server already serves images and audio from the mods folder (`packages/desktop/src/main.ts:145-152`, `:312-314`). |
| 8 | **A disk tile pack registers a Graphics row** | **no** (listed, enableable, inert) | `enabledTileModes` must read `diskPacks()` as well as the bundle glob; `tilePacks` must join the validated `PackManifest` schema. The bytes are already served. |
| 9 | **UI is moddable** | **no** | Menus are row-building FUNCTIONS (`game-menu.ts:56`, `:166`) and the 62-entry keypress table is declared inside a keydown closure (`main.ts:7337`, inside the handler opened at `:7149`), so there is nothing to register into even from inside the bundle. |
| 10 | **Provenance survives into the running game and the save** | **no** | `loader.ts:126-129` drops `owner`/`modifiedBy`; every `ContentIdResolver` uses `CORE_NS` (`mod/ids.ts:183`), so mod content is saved as `core:*`. Until this is fixed, a save cannot honestly say which content produced it, and `-2` localid suffixes make ids order-dependent (`ids.ts:142-146`). |
| 11 | **Load order means what the UI says it means** | **no** | `orderPacks` discards the given order (`loader.ts:80-84`); ties resolve lexicographically (`resolve.ts:128-131`). The conflict report already promises reordering works (`conflicts.ts:208-212`). |
| 12 | **Record schemas are validated** | **no** | `packages/mod-sdk/src/index.ts:5` claims it; no such code exists. The compile-time `FileSpec` machinery (`packages/content/src/records.ts`) is the obvious source to reuse at load time. |
| 13 | **A boot-time compose error is survivable** | **not determined** | `pack.ts:339` composes at module scope with no `try`. Determining the real behaviour needs a run with a deliberately bad patch ref and the console read. |
| 14 | **Localization** | **no** | No i18n layer at all; all UI text is inline literals. |
| 15 | **Accidental seams closed** | n/a | `MONSTER_HANDLERS` (`mon/project-mon.ts:770`) and `DEBUG_MENU` (`packages/web/src/wizard.ts:463`) are exported and mutable. They are ungated, unordered, and invisible to the conflict report - defects to close, not capabilities to document. |

---

## Is "hooks or connectors for every conceivable mod" achievable?

**No, and it should not be the goal.** The honest engineering reasons:

1. **"Every conceivable" is unfalsifiable.** There is no test that passes when it
   is met, so it can never be reported as done, and on this project a goal that
   cannot be measured has historically been reported as done anyway. That is the
   exact failure mode `docs/PARITY.md`'s census machinery was built to stop.
2. **A hook is not free.** Each one is a permanent public contract, a fold rule,
   a determinism obligation, and a line of core that must keep working while the
   port tracks upstream by tag. Seven of them already needed a per-hook fold
   spec. Hundreds would make core's behaviour a function of its extension points
   rather than of `reference/src`, which contradicts the parity mandate.
3. **The port's own structure sets the ceiling.** Faithful C is `switch`-shaped.
   Converting a switch into a registry is a real, reviewable change to core's
   shape - a deliberate, faithful-preserving refactor of ~20 sites, each of which
   must be proven behaviour-identical. That is finite work. "Every conceivable
   hook" is not.
4. **The thing actually blocking every mod today is not a missing hook.** It is
   that no mod outside `packages/web/mods/` can supply code at all. A hundred new
   hooks would change nothing for a third-party mod until gap #1 is closed.

### Proposed measurable replacement goal

Three numbers, each gated in CI so it cannot silently regress:

1. **Non-bundled reach = 1.0.** Every seam a bundled mod can reach, a mod
   installed from the mods folder can also reach. Measured as
   `seams reachable from disk / seams reachable from the bundle` - today 24
   record types and 0 code seams, so the ratio is far below 1. This is a
   ratchet the call-site census can carry.
2. **Dispatch coverage = a stated fraction of enumerated dispatch points.** The
   denominator is the 25 points in this document (kept current by a census
   script, so a new switch cannot be added without appearing). The numerator is
   the ones a mod can add to, override, or wrap. Today: 5/25, and 0/25 from
   disk. Pick a target, publish the fraction, and make the census a test.
3. **Zero silent no-ops.** Every mod-facing operation either takes effect or
   produces a named error the player can see. Today's worst offenders are the
   20 passthrough files (`loader.ts:119`), the inert disk tile pack
   (`main.ts:1044-1047`), and the `core:*` namespace on mod content
   (`mod/ids.ts:183`). This is the cheapest of the three to make true, and it is
   the one that protects a mod AUTHOR from spending a day on something the engine
   quietly ignored.

A goal of that shape can be reported honestly. "Hooks for every conceivable mod"
cannot.
