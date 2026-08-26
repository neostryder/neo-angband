# Core mod seams: how a mod changes the game

This page explains, in one place, the small set of CORE seams the first-party `qol`
and `bug-fixes` mods use, and why each one is byte-identical to faithful Angband
4.2.6 when no mod touches it. It is the answer to "what are the new core seams
and how do they work?".

Neither mod is bundled - both live in their own repositories and install like any
other. The paths cited below are paths inside those repositories. That matters for
reading this page: the seams are core's, the bodies are not in this tree, and the
`ctx.core` shape every citation shows is not a convention the first-party mods
follow by agreement - it is the only shape that resolves in a mod folder.

The guiding rule (PORT_PLAN.md decisions 2, 18, 23, 24): **core is a faithful
reproduction of Angband 4.2.6 - everything in official Angband is in core, at its
upstream defaults - and every new fix, tweak, or feature ships as a mod.** The
seams below are how a mod reaches into core WITHOUT core carrying the mod's
behaviour by default.

## 0. Grid rendering is a surface contract

The web shell's 80x24 renderer is now consumed as `GridSurface`
(`packages/web/src/term.ts`), rather than as the canvas-specific `GlyphTerm`.
It carries the operations a text grid actually needs: drawing cells and strings,
clearing, cursor control, invalidation, and an explicit `flush()` progress fence.
`GlyphTerm` is the first implementation, not the contract.

`Glyph.tile` and `Glyph.bgTile` carry a renderer-neutral `RenderAssetRef`; their
values do not accept a canvas context. A canvas adapter in `GlyphTerm` resolves
the existing tile packs, while another grid renderer can resolve the same asset
meaning differently without inventing Canvas2D just to satisfy a type.

Input, hit testing, logical readback, and resize notifications are deliberately
separate capabilities (`GridPointerInput`, `GridHitTest`, `GridReadback`, and
`SurfaceSizeEvents`). Pointer listeners return disposers, client-space hit tests
return `null` off-grid, and size observers run only after retained grid content
has been synchronously repainted. This preserves the old queued-paint and resize
ordering while leaving non-grid front ends to the later front-end seam.

> For an honest, measured account of how much of the game these seams can
> actually reach - and the much longer list of things they cannot - see
> `docs/modding/MOD_REACH.md`.

## 0a. Menu rows are front-end data

Every `selectFromMenu` caller declares a stable, non-localized id (for example
`core:game-menu`, `core:ignore`, or `core:knowledge-group`). Its rows arrive at
the one menu choke point with stable row ids and semantic data: `kind` says
whether the row is a command, item, category, toggle, or other choice, and
`ref`/`data` carry the target without requiring an alternative front end to
parse a display label.

Trusted plugin code with `registry:menu` can register a transformer per menu id.
`menus.handlerFor(id)` is the installed transform at that point in load order,
so a later mod wraps an earlier one instead of discarding it. A transformer that
throws, or returns anything other than an array of valid rows, is refused and
reported on that mod's row; the original menu still opens. This is a screen-data
seam, not a claim that a graphical or 3D front end is shipped: choosing a total
front end remains a later phase.

## 0b. The live world is a frame stream

`packages/web/src/world-view.ts` defines the renderer-neutral `WorldFrame` that
the extracted `world-render-data.ts`, invoked by the real `render()` path,
produces once per map repaint and passes through its
single `WorldFrameSink`. It contains the viewport
geometry and every in-bounds grid in order, including unknown grids; each cell
has player knowledge (`seen`, `remembered`, or `unknown`), a semantic terrain
feature id, ordered trap/object/monster/path layers, and the look cursor. The
player remains a separate, player-last layer because that is the upstream glyph
paint order, not because it is absent from the stream.

`ModPlugin.frontend?(ctx)` now selects that sink: the last enabled mod in load
order that declares it wins, and the lower candidates are not invoked. Return a
`WorldFrameSink` (the public type is importable with `import type { WorldFrame,
WorldFrameSink } from "@rpgm-tools/neo-angband-mod-sdk"`) or `undefined` to
leave the glyph frontend selected. A plugin receives a frozen, structurally
owned frame snapshot on each real repaint, so retaining it cannot retain or
mutate `state.actor.grid`; a throwing frontend falls back to the glyph sink and
is reported on that mod's row.

The frame also carries `regions`, the named parts of the screen (`map`,
`messages`, `sidebar`, `status`) in grid cells and in CSS pixels, computed by
`packages/web/src/regions.ts` from the same `viewport()` numbers `render()`
draws with, and projected through `GlyphTerm.metrics()`. `map` is the selected
front end's; the others are core's. This is what lets a replacement draw inside
the map rectangle instead of over the window, and it is optional on the frame
only because a host with no fitted surface has none to give. Absent means draw
nothing. See `PLUGINS.md` for the author-facing version.

At startup, `main.ts` performs its boot `render()` before it installs a selected
`ModPlugin.frontend`. Consequently, the first frame is always glyph-drawn, even
when a disk-loaded mod frontend will own later display renders. This is an
expected property of the seam: frontend authors must tolerate their display
starting on a subsequent repaint rather than receiving the boot frame.

With no replacement selected, the current `GlyphTerm` is that sink and consumes
the frame's optional `visual` fallback,
including the upstream terrain-under-foreground tile pass for visible path
markers over otherwise bare seen terrain, but a
future isometric or 3D front end consumes the registry ids and visibility rather
than parsing glyphs or CSS. `WorldVisual.asset` is the same renderer-neutral
asset reference used by the grid contract; it has no Canvas2D dependency. This
is host infrastructure. The Phase-4 control executes the extracted producer
that `main.ts` calls, compares its unmodded glyph-sink output to the pre-frame
`term.put` tuples across visible, remembered, unknown, path, cursor, and
player-last cases, and tees that one frame to an independent host sink by
reference. The Phase-5 disk fixture then loads two real plugin folders, proves
only the later one receives that production frame, and keeps an unmodded glyph
control.

## 1. `GameState.modHooks` - the behaviour seam

The one seam behind both first-party behaviour mods. `GameState.modHooks`
(`packages/core/src/game/context.ts`) is an optional `ModHooks`
(`packages/core/src/mod/hooks.ts`): a plain interface whose every member is an
OPTIONAL function. An absent member means "no mod touches that point", and core
takes its faithful path with one undefined check:

```ts
/* game/obj-list.ts - the whole shape of a seam read */
if (result === 0 && tiebreak) {
  result = tiebreak({ dy: ea.dy, dx: ea.dx }, { dy: eb.dy, dx: eb.dx });
}
```

**Absence, not falsity, is how a patch is off.** With no mod loaded the field is
not present, the optional call is never made, and the faithful branch is the only
branch that exists. No flag map is consulted because core holds no flag map.

### The seam replaced a flag registry, and why

An earlier build did this with a string-keyed flag registry:
`GameState.modRules` (a `Record<string, boolean>`) read by a core helper
`modRuleEnabled(state, name)`, so a ported core function was written as
`if (modRuleEnabled(state, "bugfix.objectListOrder")) { corrected } else { faithful }`.

That was rejected (2026-07-29) on the grounds that a
flag-gated fix is not excluded from core: **core shipped the fix body, core was
tested on it, and core carried the mod's own flag name as a string literal.**
Deleting the mod folder would not have deleted a line of it. `modRuleEnabled` is now GONE from core -
deliberately deleted rather than left unused, because a helper that exists is a
helper the next core function reaches for (see the tombstone comment in
`packages/core/src/game/context.ts`).

What core still contains, and cannot stop containing, is the SEAM ITSELF: one
named, documented extension point per behaviour a mod may override. That is the
price of behaviour modding at all. The difference that matters is that a seam is
generic, available to any mod, and holds no opinion about what plugs into it.

### The hooks, and the ONE core call site each serves

Each member of `ModHooks` documents its single call site, because a hook whose
call site is not written down is a hook nobody can verify is still wired - the
exact failure the call-site census exists to catch.

The `Fold` column uses the code's own vocabulary. `MOD_HOOK_FOLDS`
(`packages/core/src/mod/hooks.ts`) is keyed by `keyof ModHooks`, so a hook added
to the interface without a fold does not compile, and the conflict report the mod
manager draws is rendered from that same table. Call sites are named by file and
by the symbol that reads the hook rather than by line: a line number in a
document has no test behind it and rots on the next commit.

| Hook | Fold | Call site | Faithful answer when absent |
| --- | --- | --- | --- |
| `walkBlockedByDiggable(state, grid, deps)` | `last-answer` | `game/cave-cmd.ts` (`movementAutoDig`), reached from `walkAction` in `game/player-turn.ts` | `?? null` - bump the wall, spend nothing, draw no RNG |
| `objectListTiebreak(a, b)` | `last-answer` | `game/obj-list.ts` | `?? 0`, i.e. leave the entries equal (stable sort keeps collect order) |
| `projectionRadius(rad, maxRange)` | `chained` | `world/project.ts` (`computeProjection`, reached through `ProjectParams.resolveRadius`, which `game/project-cast.ts` fills from `state.modHooks`) | the radius as given, unchecked against `max_range` |
| `levelGenerated(gen, quest)` | `all-must-agree` | `gen/generate.ts` | accept the level as generated |
| `artifactCommit(aidx, alreadyCreated)` | `all-must-agree` | `obj/make.ts` | commit it unconditionally |
| `historyAdd(entry)` | `all-must-agree` | `session/game.ts` (the `HIST.SLAY_UNIQUE` path) | `?? true` - write every entry, duplicates included |
| `historyDisplay(entry, playerName)` | `chained` | `packages/web/src/screens.ts` (the HOST's shared history rows, not core) | `?? entry.what` - show the stored text unchanged |
| `saveNoiseScent()` | `any-yes` | `session/save.ts` | `?? false` - omit the heatmaps, which is upstream's behaviour and upstream's bug |
| `shapeLearnObviousFlagsDirectly()` | `any-yes` | `obj/knowledge.ts` (`shapeLearnOnAssume`) | `?? false` - never learn a shape's obvious flag directly, the 4.2.6-era gap this hook exists to let a mod close |
| `levelRevisited(chunk, frozenAt, now)` | `all-observe` | `session/game.ts` (persistent-level and single-combat restore paths) | nothing: resume the frozen chunk unchanged |
| `messageText(raw)` | `chained` | `packages/web/src/main.ts` (the HOST's single message sink, not core) | `?? raw` - show what core was given, warts and all |
| `optionsChanged(snapshot)` | `all-observe` | `packages/web/src/options.ts` (`notifyOptionsChanged`, at the end of `runOptionsMenu`) | nothing happens; core reads no answer |

`optionsChanged` and `levelRevisited` are the notification members: core does
not ask either a QUESTION. Every other hook's return value changes what the
engine does next, so the fold has to decide whose answer wins. A notification
returns nothing and folds **all-observe** - every listening mod is told, in load
order, and none can overrule another. `levelRevisited` passes the live restored
chunk plus unrounded turn endpoints, so a tracking mod can reproduce the engine's
world-tick boundary exactly. `optionsChanged` is the host-owned case: it tells a
mod that the player has finished changing settings.

Three details that are contract, not implementation:

- It fires **only when something actually changed**. A player who opened the `=`
  menu and pressed ESC has not changed anything, and a hook named for a change
  must not fire for one that did not happen.
- Each mod gets **its own copy** of the snapshot. A mod that keeps the object it
  was handed - which is exactly what a mod persisting settings does - must not
  find it edited later by the mod that ran after it.
- It is fired by the **host**, from one chokepoint inside `runOptionsMenu`
  rather than from that function's four callers. `OptionState` is the pure port
  of `option.c` and has no idea a menu exists; and a hook wired at each call site
  is a hook the fifth call site forgets, silently.

Two of these are contractually **RNG-FREE** (`levelGenerated`, `artifactCommit`):
they run inside the generation and object pipelines, where one extra draw does
not merely change a value, it desynchronises every draw after it and a seed stops
reproducing its dungeon. Core hands them no `rng`. A mod can still break the
contract by reaching for a global, so the suite pins it by running generation
with a hook installed and asserting the level is bit-identical.

`walkBlockedByDiggable` is RNG-free only on its DECLINE path, which is a stronger
and more easily broken requirement: faithful core bumps the wall without drawing,
so a hook that rolls a dig check and then declines has already moved the stream.

### The fold rule, which differs per hook

Two enabled mods may both want the same hook. Core deliberately holds exactly ONE
`ModHooks` and knows nothing about mod identity, ordering, or enablement; the host
collects each enabled mod's contributions in LOAD order and folds them with
`composeModHooks` (`packages/core/src/mod/hooks.ts`). This is the same
layering as content: core consumes a composed result, never the pack list.

One rule holds across every fold: **no mod's opinion is ever discarded in favour
of an earlier mod's.** Where a fold has to pick a single answer, the LAST mod in
load order supplies it, which is what the mod manager's own "Move later (loads
last, wins conflicts)" row promises. Where a fold combines answers, nothing is
discarded and there is nothing for load order to decide. Per fold:

- **`all-must-agree`** (`levelGenerated`, `artifactCommit`, `historyAdd`) is
  **conjunctive**: every contributor runs and the **first refusal decides**. This
  is the only safe fold - a mod that vetoes a duplicate artifact must not be
  overruled by a later mod that merely has no opinion. Note for `levelGenerated`
  specifically: every contributor still runs after an earlier one has REPAIRED
  the level, because a second mod's invariant is not satisfied by the first mod's
  repair; only a refusal short-circuits, since the level is being thrown away
  anyway.
- **`chained`** (`messageText`, `projectionRadius`, `historyDisplay`) chains in
  load order, each contributor seeing the previous one's output: a `reduce`
  over the contributors. Two mods narrowing one blast for two unrelated reasons
  both get their narrowing, and the last one still speaks last.
- **`last-answer`** (`walkBlockedByDiggable`) asks the contributors in **REVERSE**
  load order and stops at the first non-`null`, so the LAST mod's handling wins
  and two mods cannot double-spend one turn's energy. The reversal is the whole
  mechanism, and reading the loop as forward inverts the rule.
- **`any-yes`** (`saveNoiseScent`, `shapeLearnObviousFlagsDirectly`) is
  **disjunctive**, a `some()`. One mod asking for the data is enough, because
  the data is additive and a second mod has nothing to object to.
- **`last-answer` for a comparator** (`objectListTiebreak`) is the same reversal
  read as a lexicographic chain: the last mod's ordering is the primary key and
  earlier mods break only the ties it leaves. Still a total order, and still
  later-wins.
- **`all-observe`** (`optionsChanged`, `levelRevisited`) runs every contributor in load order and
  reads no answer, so there is nothing to win.

`composeModHooks` returns `undefined` when nothing contributed,
so the host leaves the field ABSENT rather than storing an empty object. That
keeps "no mod loaded" and "a mod loaded that touches nothing" indistinguishable
from core's side - which is the one thing the seam exists to guarantee.

### What happens when a hook throws

A hook is third-party code running inside a turn, so it can throw. The host wraps
each mod's contribution with `guardModHooks`
(`packages/core/src/mod/hooks.ts`) BEFORE folding it - guarding per mod is
what lets the fault be attributed, since the host holds the id and core does not.

A throw becomes that hook's **neutral answer**, which is per-hook and is the same
value core would have used with no mod loaded at all: `null` for
`walkBlockedByDiggable`, `0` for `objectListTiebreak`, `true` for the three vetoes
(`levelGenerated`, `artifactCommit`, `historyAdd`), `false` for `saveNoiseScent`
and `shapeLearnObviousFlagsDirectly`, the raw string for `messageText`,
the entry's stored text unchanged for `historyDisplay`, and the radius as given
for `projectionRadius`. So to the fold, a broken mod reads exactly
like a mod with no opinion at that point, and the other mods' answers stand.
`levelGenerated` accepting is the one worth naming: rejecting on a throw would
re-roll the level, throw again, and re-roll until `cave_generate` gave up - one
broken hook would make the game unable to reach any level.

The hook is then **not called again** for the rest of the session - per (mod,
hook), so the mod's other hooks keep working.

Letting the throw escape instead was not the safer option, though it looked like
it: it does not undo what the mod already did before throwing, it abandons the
rest of the turn's bookkeeping, and it reaches the shell as a bare exception from
a function that did not know a mod was inside it - a frozen screen with no name
on it.

**Guarding is only half the job**, and the other half is the host's:
`packages/web/src/mod-taint.ts` treats a mid-turn fault as terminal for the
session. It refuses every further save (the gate is in `persistSave`, not
`autosave`, because a level change, `S`, the options screen and `pagehide` all
force a save too), puts the fault on the mod's row in the manager, and puts up a
modal naming the mod and offering a reload. Before this existed, the *only* thing
protecting the file was that the autosave sits at the turn's TAIL, so the
exception unwound past it.

### Why `null` is the decline sentinel, and not `0` or `false`

For the `last-answer` fold, the sentinel cannot be a value the hook might
legitimately want to return. `walkBlockedByDiggable` returns an ENERGY COST, and
`0` is a real energy cost - so if `0` meant "decline", a mod could not express
"I handled this action and it costs nothing". `null` keeps the two apart: the
fold tests `energy !== null`, so a hook returning `0` HANDLES the walk and stops
the chain, while `null` passes it to the next mod.

Two details worth stating, both read off the code rather than assumed:

- **Zero energy is honoured end to end.** `movementAutoDig` returns the hook's
  answer with `?? null`, and `walkAction` tests `dug !== null`. So a mod may
  consume a blocked walk and charge nothing, and it will not fall through to
  core's faithful bump. This used to be `?? 0` against a `dug > 0` test, which
  made "handled for free" and "no mod answered" the same answer and silently
  discarded the first - the hook interface documented a case the engine could
  not express. If you are writing a mod that consumes a blocked walk without
  spending a turn, return `0`, not `null`.
- `objectListTiebreak` uses `0` rather than `null` as its "no opinion" answer,
  because there `0` is also the faithful answer ("these two entries are equal"),
  so the two readings agree and no third value is needed.

## 2. How a patch is turned on - and where the patch's CODE lives

A mod does not execute code to flip a flag, and core never sees a flag name at
all. The flags still exist, but they are now purely a **conversation between the
host and the mod**:

1. The mod DECLARES its patches in `manifest.json` under `rules`, each an entry
   of `{ "flag": "qol.autoDig", "title": "...", "description": "...", "default": true }`.
2. `packages/web/src/pack.ts` `loadEnabledModRuleDecls()` gathers the `rules` of
   every ENABLED mod, in load order.
3. `packages/web/src/mod-store.ts` `resolveModRules(decls, choices)` computes the
   effective map: for each declared rule, `choices[flag] ?? rule.default`. The
   player's choices come from each mod's **Fixes & tweaks** submenu and persist
   in `localStorage` (`neo:modRuleChoices`) - a client setting, like the
   enabled-mod set, NOT part of the savefile.
4. `packages/web/src/mod-hooks.ts` `resolveModRuleFlagsByMod()` SLICES that map
   per mod, then `activeModHooks()` calls each enabled mod's entry point once, in
   load order, with only that mod's own flags, and folds the results with
   `composeModHooks`.
5. `packages/web/src/main.ts` passes the composed object to `startGame` /
   `loadGame` as `opts.modHooks`.

The entry point is the mod's `plugin.js` (`plugin.ts` before it is built), which
default-exports a `ModPlugin`. Its `hooks` member is the behaviour half:

```ts
export default defineModPlugin({
  hooks(ctx) {
    // ctx.flags holds THIS mod's own rule flags, and nothing else.
    // ctx.state is deliberately absent here - see PLUGINS.md.
    return { /* ModHooks members */ };
  },
});
```

An earlier ABI had each mod default-export a bare
`(flags) => ModHooks` from its own `hooks.ts`. That signature is **gone** rather
than kept as a second option, so there is one entry point to document and one to
test. A mod compiled into the build is discovered by a glob over
`packages/web/mods/*/plugin.ts`, and a mod installed from disk or from a
repository has its `plugin.js` loaded from wherever its folder is; both arrive at
the same adapter and the same `composeModHooks`, so the host knows no mod's id
and no mod's flag names. A mod with no behaviour - every pure content mod -
simply ships no `hooks` member, or no plugin at all, and is never called. (The
linoleum tile mod was the stock example until its 0.15.0, which added a
`plugin.js` holding the kin rule core handed over. It still contributes no turn
hook: a tile filler is `register()`'s business.)

Three rules make this shape work, and they are the contract a third-party
behaviour mod must keep (spelled out in the header of
`neo-angband-mod-bug-fixes/plugin.ts`):

1. **The mod reads its OWN flags.** Its flag map is sliced per mod so a mod
   cannot read, or act on, another mod's toggles - its behaviour cannot silently
   depend on which other mods the player enabled.
2. **Never return a function that self-disables.**
   `historyAdd: (e) => flags.x ? !e.duplicate : true` behaves the same but is
   wrong: an installed hook is a promise to core that
   something wants that point, and under `composeModHooks` a present-but-
   opinionless hook still runs - and for the first-handler hooks can shadow
   another mod's.
3. **A disabled mod is never called at all.** `enabledModIds()` drives the loop,
   so returning `{}` means "enabled, but every patch off".

**The patch bodies are the mods' code, not core's.** There is no `bugfix.*` or
`qol.*` string in `packages/core/src` outside comments, no staircase repair, no
duplicate-artifact guard, and no message rewriter. `ensureStairsReachable` lives
at `neo-angband-mod-bug-fixes/stairs.ts`; `miscStringFix` at
`neo-angband-mod-bug-fixes/strings.ts`; the auto-dig at
`neo-angband-mod-qol/plugin.ts`. Delete a mod folder and its behaviour goes
with it.

**Default policy (2026-07-26; wording tightened 2026-07-27).**
The mod is the unit the player installs and switches; a patch is a part of a mod,
never a separate thing to install. Two layers, in this order:

- **A disabled mod's patches DO NOT EXIST.** Not "exist but default off" -
  `enabledModIds()` drives hook discovery, so a disabled mod's entry point is
  never invoked, contributes no hook, and `composeModHooks` returns `undefined`
  when nothing contributed, leaving `GameState.modHooks` absent and every core
  call site on its faithful path. There is nothing to toggle and nothing appears
  in the menu.
- **Enabling a mod turns its whole patch set ON, at once.** Enable `bug-fixes`
  and you get every fix in it; enable `qol` and you get every tweak in it. Each
  patch is then INDIVIDUALLY switchable in that mod's own Fixes & tweaks submenu,
  so a player can take the set minus one specific patch. That per-patch switch is
  the only reason the toggles exist.
- **Every mod itself is OFF on a fresh install**, the first-party ones included
  (`DEFAULT_ENABLED_MODS` is `[]`, `mod-store.ts`). So an untouched install has
  no mod, therefore no patches, therefore faithful 4.2.6.

So `default: true` on a rule means exactly one thing: **"on once its own mod is
enabled"**. It never means "on in a fresh install", and it never means a flag sits
in core waiting to be switched - core has no flag to switch.

> An earlier build implemented rules with a trusted in-process plugin plus a
> `registry:rules` capability and a `RulesFacade`. That was removed in favour of
> the declarative manifest field above. `registry:*` capabilities are documented
> for other, genuinely code-carrying trusted-plugin seams (effect / room /
> command / monster / vocab); see `MOD_REACH.md` for which of those have real,
> mod-reachable code today rather than a design note.

## 3. `StartGameOptions` / `LoadGameOptions`: `modHooks`, and the now-opaque `modRules`

`startGame` and `loadGame` (`packages/core/src/session/game.ts`) each accept an
optional `modHooks` and store it on `GameState`. Absent => faithful core. The
session threads the LIVE `state.modHooks` - read fresh, not captured - into the
deps bags that the pure layers need it in: `GenDeps.hooks`
(`gen/generate.ts`) and `MakeDeps.hooks` (`obj/make.ts`), because those layers
have no `GameState` in scope.

`modRules` still exists on `GameState` and is still seeded at start/load, but it
is now **OPAQUE to core**: nothing in `packages/core/src` reads it. It is the
RECORD of the player's choices, kept because it is what the Fixes & tweaks menu
is built from and what the host re-reads. Because core does not branch on it,
writing it alone is a no-op - so the live per-patch toggle
(`applyRuleLive`, `packages/web/src/main.ts`) must REBUILD the hooks, and
must `delete game.state.modHooks` rather than assign `undefined` when nothing
contributes, so "no mod loaded" stays absent rather than becoming an empty object
core could detect.

Built-in Angband options are NOT set through any of this: they ship in core at
their upstream defaults (`OPTION_ENTRIES.normal`) and are restored from the save
on load. (This is what the removed `interfaceDefaults` seam used to do.)

## 4. `GameState.autoDigStep` - a plumbing indirection, not a mod seam

`walkAction` (`packages/core/src/game/player-turn.ts`) calls
`state.autoDigStep?.(state, next)` when a walk is blocked. This is NOT a second
mod seam and holds no mod's behaviour: the session installs it
(`session/game.ts`) pointing at `movementAutoDig`
(`game/cave-cmd.ts`), whose entire body is the `walkBlockedByDiggable`
hook read plus `?? null`. It exists only so the movement code need not import the
dig internals. With no hook installed it returns `null` having drawn no RNG, and
the walk falls through to the faithful bump.

`null` is the only value that falls through. A **number is honoured, including
`0`** - a mod that handles the walk and charges nothing. This used to be `?? 0`
against a `dug > 0` test at the call site, which made "handled for free" and "no
mod answered" the same answer and quietly discarded the first: the hook interface
documented a case the engine could not express. If you are writing a mod that
consumes a blocked walk without spending a turn, return `0`, not `null`.

The two core primitives a digging mod needs are public and reused rather than
reimplemented: `movementTunnelTest` (`cave-cmd.ts`, RNG-free, which is what
lets the mod decline for free) and `tunnelAux` (one real `do_cmd_tunnel_aux`
attempt with the upstream roll, messages, and payouts).

## 4a. `simulateLoadout` - a loadout the character is not wearing

Every seam above this one lets a mod CHANGE the game. This one lets a mod ASK a
question the engine could not previously be asked: what would this character be,
wearing something else?

`calc_bonuses` (`packages/core/src/player/calcs.ts`) answers that for the gear
the character has on, and every read surface derives from it - `GameState
.playerState`, `PlayerActor.combat`, `PlayerView`. There was no version for a
loadout nobody is in. A caller wanting one had to sum the candidate item's own
bonuses, which is a second implementation of `calc_bonuses`, blind to the
interactions (a ring of strength changing the blow count, a cuirass costing a
caster half their mana, weight costing speed), and free to drift from the first
with nothing able to notice.

```js
const sim = view.simulateLoadout({ wield: [{ from: "gear", handle }] });
if (sim) {
  sim.delta.ac;            // armour class difference
  sim.delta.maxSp;         // what it costs a caster
  sim.delta.resists;       // per element, ELEM order
  sim.after.player.blows;  // the frozen PlayerView for that loadout
  sim.after.stats;         // every field of upstream's player_state
}
```

Four things about it:

- **It runs the REAL derive.** `state.derivedFor`, installed by `wireGame`, is
  `calc_bonuses` with `update: false` over the same options bag the live refresh
  uses - the bound timed table and the curse registry travel with it. That is
  deliberately the only source: a derive assembled by a caller would have to
  guess at both, and a hypothetical loadout measured with a thinner bag than the
  live one is worse than no answer, because it looks like an answer. Where no
  session installed one (the worldless harness), the accessor is absent and the
  function returns `null`.
- **It writes nothing.** Not the state, not the player, not the gear, not any
  object. `update: false` is what keeps `calc_bonuses`' own two faithful side
  effects (zeroing `TMD_FASTCAST` on a stun grade, the town-light redraw flag)
  out of it. A test asserts the live `PlayerState` object is the same object
  afterwards, not merely an equal one.
- **The change is expressed in slots and gear references, not equipment
  arrays.** `wield` routes each item through the engine's own `wield_slot`, so
  the second of a pair of rings lands in the second ring slot exactly as it would
  in play; `carry` takes something into the pack; `remove` empties a slot into the
  pack; `release` gives a stack up entirely, emptying its slot when the handle
  names worn gear. A reference is a gear handle, or a shop and a stock index for a
  ware (which is not in the gear and so has no handle), or a `GameObject` for a
  caller inside the engine. A reference that names nothing is skipped and reported
  in `unresolved`, because a decision ladder evaluating a hundred candidates must
  not die on one stale handle.
- **The answer is the whole surface, not a score.** Two consumers want different
  halves: an autoplayer reduces it to one number, and a player comparing two items
  wants to see which resist was traded for which. A scalar can serve the first and
  never the second, and the two must not be able to disagree about the underlying
  derive - so `before`, `after` and `delta` carry every field of `player_state`
  plus max hitpoints, max mana, the armour encumbrance and the carried weight.
  `neo-angband-mod-borg` consumes a fraction of it today.

The accessor lives on `AgentView`, which is what makes the `ItemView`s in the
answer built with the same `AgentViewDeps` the live view's are. That is a
correctness property rather than a convenience: an object carrying `value` in one
read and not the other would change what an agent decides about the same object
depending on which read produced it. The exported `simulateLoadout(state, change,
opts)` is the same function for a caller inside the engine.

## 4b. `ctx.ui.openPanel` - a piece of web page above the game

Every UI seam before this one draws with the same seven methods onto the same
character grid. This one hands a mod a shadow root and stops. It exists because
the shape a grid cannot carry is a FORM: fields with a caret, a list with a
scrollbar, a table the player sorts by clicking a column. `RegionSurface`
publishes `size`, `clear`, `print`, `prt`, `eraseToEol`, `setCursor` and
`hideCursor`, and a text editor built out of those is a caret, a tab order and a
focus model reimplemented inside a terminal - three things that exist in every
browser already and in none of this codebase.

```js
// register(host, ctx) - the context that carries `ui`
const panel = ctx.ui.openPanel({ id: "editor", modal: true, label: "Monster editor" });
panel.root.innerHTML = `<style>:host{all:initial}</style><input id="name">`;
panel.root.getElementById("name").focus();   // and it can actually be typed into
await panel.closed;                          // the player is done, however they finished
```

Six things about it, and the first two are the ones that will surprise you:

- **Escape is the player's, and you cannot have it.** The input door closes the
  topmost panel on a real Escape before your panel is offered the key, and focus
  goes back to the game rather than back to whatever your panel had focused. Use
  another key for your own "back". A modal panel also carries a close control the
  host draws, outside your shadow root, because this game is played on touch and
  a phone has no Escape key. What that buys the player is a way out of a panel
  that has stopped responding; it is not a defence against a mod that means harm,
  and nothing here pretends to be - see the last bullet.
- **A non-modal panel's container takes NO pointer events.** It is a
  full-viewport rectangle, so any other answer would be an invisible layer eating
  every tap meant for the dungeon underneath. Style `pointer-events: auto` onto
  the elements you want clickable, which is exactly what the game's own touch
  action bar does with its buttons. `modal: true` takes the pointer, takes the
  focus on mount, and gets `role="dialog"`; a plain panel takes neither and gets
  `role="group"`.
- **The keyboard is decided per keystroke, by where the caret is.** The game's
  front end has ONE keydown registration - `window`, capture phase, installed at
  import - and every modal handler behind it calls `stopImmediatePropagation`. So
  a real field is unusable on this page unless the door stands down, and the door
  stands down for a key whose composed path runs through the top panel before it
  reaches the game's canvas. Put the caret in your field and your field gets the
  keys; click back on the map and the game does. This is the one thing the
  capability grants that a mod could not already do.
- **It fails OPEN, and the invariants are checked on the keystroke.** You hold
  the shadow root, so you hold `root.host`, so you can detach the container, move
  it, or make it a parent of the game's own canvas. Each of those is checked as
  the key arrives, not once at mount, and any of them CLOSES the panel and gives
  the keyboard back. A panel that is not the top of the stack is inert. The bias
  is deliberate: a suppression path that errs towards suppressing is a game that
  has stopped responding to the keyboard, and a player cannot tell that from a
  crash.
- **The player closing a panel puts your mod on a short pause.** Nothing stops a
  `closed` continuation from opening a replacement, and a mod that does that in a
  loop would turn the one key that gets the player out into a key that makes the
  panel flicker. Closing your own panel costs you nothing, so an authoring tool's
  ordinary step-to-step navigation is unaffected. At most eight panels are open
  at once, for the same reason: Escape closes one, so the count is the number of
  presses back to the game.
- **The shadow root is hygiene, not a sandbox, and the docs will not say
  otherwise.** Styles do not cross it in either direction, so your `#title`
  cannot collide with anything and your stylesheet cannot restyle the
  accessibility live-regions or the touch bar by accident. It is closed, so
  another mod cannot read your panel's fields out of `element.shadowRoot`. That
  is the extent of it. Your code and every other mod's runs in the page's own
  realm, so none of this contains anybody, and an iframe would not either - it
  would fence the half that draws a form while the half holding `ctx.core` sat
  outside it, at the price of turning one authoring tool into two programs and a
  message protocol, and of putting the keyboard somewhere the host can no longer
  offer a way out of. The capability is a DECLARATION the player reads, the same
  as every other capability in this system (see `PLUGINS.md`, "What a capability
  gates").

The panels a mod has open come down when the mod set changes, after every
plugin's `uninstall()` and before the save - so your last moment on a live state
can still read what the player typed into one, and nobody is left looking at a
mod's interface over a game that is reloading. New panels are refused from the
moment teardown begins. There is no other lifecycle: as everywhere else in this
system, disabling a mod re-composes the page, and a panel not mounted on the way
back up is not mounted.

## 4c. `ctx.installMod` - a mod handing the game a mod

`ModProject` has emitted a mod folder's exact bytes since it was written, and its
own header named the caller it was waiting for: "a builder that returned paths
and contents is equally usable from a CLI, from a test, and from an in-game mod
editor." There was no in-game anything, because nothing a mod could reach turned
bytes into an installed mod. `HostDir` has no `MODS` entry, `RAW_FS_OPS` has no
`mkdir`, the desktop shell's loopback server has no write route into `mods/`, and
an install lands in IndexedDB rather than on a filesystem at all.

```js
if (!ctx.installMod) return;                      // no grant, or no door
const { files } = project.emit();                 // manifest.json + one file per record file
const bytes = zipSync(Object.fromEntries(files.map((f) => [f.path, enc(f.contents)])));
const outcome = await ctx.installMod(bytes);
if (!outcome.ok) show(outcome.problem);           // one whole sentence, always
show(outcome.lines.join("\n"));                   // the manager's own wording, either way
if (outcome.ok) await ctx.reloadGame?.();         // save, tear down, come back on the same character
```

Five things about it:

- **It is CONTENT ONLY, and that is what makes the grant proportionate.** An
  archive that ships code - `.js`, `.mjs`, `.cjs`, `.ts`, `.wasm`, under any name,
  not just `plugin.js` - is refused, and so is one whose manifest asks for any
  capability. Without that, "may install a mod" would mean "may write a program,
  install it, and have the player enable something it authored", which is a far
  larger sentence than the one on the consent list. With it, the grant is what it
  says: this mod may add records, patches and removals to your library.
- **Installing is not enabling, and you have to tell the player so.** What you
  install lands switched off, because no mod is ever enabled by default in this
  game. The player finds it on the Mods screen, reads its own capability list,
  and turns it on; and enabling a mod takes effect on RELOAD. So the monster your
  builder just wrote is not in the dungeon this turn, and a tool that implies
  otherwise has made the player think it is broken.
- **The origin is pinned on first import and compared forever after.** A zip is
  the one door where the game cannot go and ask where a mod came from, so what the
  manifest SAYS is the only provenance there is - and pinning it makes the first
  install the moment of trust. The consequence for a builder is concrete: persist
  the `repository` string with your draft and emit the same one every time, or
  your second install of your own mod is refused. Do not invent a plausible
  GitHub URL the player does not own; that pins their work to somebody else's
  repository, and the update check will later go and ask that repository for tags.
- **This install is recorded as YOURS, not as the player's own.** The mod that
  arrives through this door gets `InstalledModMeta.installedByModId` set to your
  own id, alongside the `repo`, `tag` and per-file digest every install already
  records. That is a DIFFERENT fact from the origin pin above: the origin says
  where the bytes claim to come from, this says who asked the game to fetch
  them. The mod manager's detail pane shows it as `Installed by: <your id>`, so a
  player who used a mod-building tool can tell which of their mods it actually
  wrote. A zip the player picked themselves never sets this field, which is what
  makes its absence mean "the player did this" rather than "unknown".
- **A refusal is a value, never a throw.** Everything comes back as `{ok: false,
  problem}` with one whole sentence in it, including a failure inside IndexedDB,
  because the caller is a mod that will be putting the answer in front of a
  player. And the bytes are copied before anything asynchronous runs, so what was
  inspected is what is stored even though you still hold the array you passed.
- **`lines` is the host's own wording, and printing it is the right default.**
  Every outcome carries the lines the Mods screen itself prints for that same
  install, built by the same functions - the headline, the closing reassurance
  that nothing else was touched, and under a standards refusal one row per unmet
  requirement plus the advice under them. A mod that writes its own sentence
  teaches the player a second vocabulary for one concept, and a failure that reads
  differently depending on which door the archive came through is a failure they
  cannot look up. `problem` is still there for a log or a one-line row.

Then apply it:

- **`ctx.reloadGame()` is behind the same capability, because installing and
  applying are one act.** Content composes at load, so what you just installed is
  not in the game and will not be until the page comes back. This is the game's own
  mod-change sequence: every plugin's `uninstall()` runs, the autoplayer hands the
  keyboard back, the live character is written down, and the session resumes that
  character rather than landing on the title screen. Calling `location.reload()`
  yourself skips all four, and the third is the player's progress. It is not a
  permission - a plugin reaches `location` with no grant at all - it is the four
  steps you cannot do for yourself. What you installed is still switched OFF when
  the game comes back, so the reload applies a session load and puts an install in
  front of the player rather than into their game; say which.

Everything else is `installModFromZip`'s and is not reimplemented at this door:
the third-party consent switch is read at the moment of use, so a player turning
third-party mods off turns this off with it; the archive is read under the same
ceilings and the same zip-slip check; and `checkMod` runs the same standards
inspection an author's own `neo-angband-mod-check` runs, so a mod your builder
emitted fails for the same reasons in the same words as a mod somebody
downloaded.

## 4d. `ctx.loadModForSession` - a mod handing the game a mod to TRY

The same door with the library step removed, behind its own capability
(`mod:session`). What it changes is where the archive is kept and for how long:
session storage instead of IndexedDB, and it composes into the game on the next
reload without waiting to be switched on.

```js
if (!ctx.loadModForSession) return;               // no grant, or no door
const outcome = await ctx.loadModForSession(bytes);
if (!outcome.ok) show(outcome.problem);
else if (!outcome.survivesReload) show("this browser will not keep it across the reload");
else show(`${outcome.id} is loaded for this session - reload to try it`);
```

Four things about it, and the first is the one to say to the player:

- **What is temporary is the MOD, not what it does.** The archive is forgotten
  when the game is closed. The records were as real as any other pack's while
  they were loaded, so a character that met them keeps whatever they did to it -
  and next launch, with the pack gone, that character's mod-owned monsters and
  items belong to something that is not installed. The game handles that (it
  quarantines them rather than resolving them wrongly), but the values a player
  saw at save time can differ from the ones they see afterwards, because a
  pack's PATCHES live in the composition and not in the save. So: do not stage
  content under a character somebody is playing seriously, and say so.

  A patch is the harder half of that, because it leaves nothing for quarantine
  to catch. Quarantine works by noticing an entity whose OWN namespace has gone
  missing; a session pack that only PATCHES an existing record - re-pricing a
  core sword's damage, say - never gives that record a namespace of its own, so
  the sword still reads as core's and nothing is ever quarantined. The composed
  value from save time is simply gone on the next load, silently, unless the
  save can say so on its own. It does: the manifest records the content digest
  of every present session or permanently INSTALLED pack this host can measure
  at save time (`mismatchedNamespaces` / `reconcilePackManifest`,
  `packages/core/src/mod/save-blocks.ts`), and a load that finds a namespace
  still present but its recorded digest no longer matching the current one says
  so, the same way a save updated across a format change says so
  (`describePackMismatch`, `packages/web/src/save-recovery.ts`). Session packs
  carry the whole-archive digest made at staging; an installed pack's recorded
  per-file digests are prefetched from IndexedDB before the synchronous boot
  path and combined into its current pack digest (`presentPackDigests`,
  `packages/web/src/pack.ts`). This is discoverability, not prevention - a
  patch that changed and a patch that is simply gone read the same to the
  digest, and the fix is the same for both: stage or install the pack again,
  or accept what is now composed.
- **It is CONTENT ONLY, on exactly the same terms `installMod` is.** Code under
  any extension is refused, and so is an archive whose manifest asks for a
  capability. A mod may not hand the engine another mod's code to run - the
  player consented to YOUR mod, not to whatever you chose to execute - and that
  refusal is permanent by design rather than pending an isolation tier. The
  honest limit of it is worth knowing: it stops the ENGINE being the vehicle, and
  it is not a fence around a plugin that means to load code some other way, since
  a plugin runs in the page. See PLUGINS.md, "What a capability gates".
- **A reload is still what applies it.** Content composes at load. Nothing you
  stage is in the game this turn, and the mod manager offers the reload on the way
  out.
- **`mod:session` is not `mod:install`, and neither grant carries the other.**
  The install line is proportionate because what arrives waits to be switched on;
  this one does not wait. `grantCovers` compares the action so the two consent
  sentences cannot be swapped.

Everything else is shared with the install door and is not reimplemented: the
third-party switch read at the moment of use, the zip ceilings, the zip-slip
check, `checkMod`'s standards inspection, and the origin pin against an installed
copy of the same id. A staged copy of an id you already have SHADOWS the installed
one for the session, and the collision appears on that mod's row.

**A session mod is never invisible.** It is listed in the mod manager marked
`SESSION ONLY`, and its detail screen offers `Drop it` instead of the ordinary
on/off - because it is on by having been staged rather than by a stored choice,
and dropping the archive is the only thing that actually stops it.

## 4e. `ctx.debug` - conjuring a thing, and paying for it

This one is unusual and worth reading before using: it adds almost no ability and
a great deal of honesty. Every primitive behind it is already on `ctx.core` -
`wizCreateObj`, `wizSummonNamed`, `wizDropObject`, and under those `makeObject`,
`dropNear` and `placeNewMonsterLive` - and the gate they all check, `debugEnabled`,
reads a `debug` boolean out of a deps bag the CALLER assembles. So a mod could
always pass `{ debug: true, ... }` and conjure whatever it liked, with no
capability, and leave no mark on the character at all.

```js
if (!ctx.debug) return;
const outcome = await ctx.debug.spawnMonster("Snarl, Farmer Maggot's other dog");
if (!outcome.ok) show(outcome.problem);
```

Four things about it:

- **What the capability buys is the MARK, not the power.** The first use in a
  character asks the game's own debug question - the same two warning lines and
  the same confirmation `^A` asks, through the same function - and accepting sets
  the same `NOSCORE.DEBUG` bit, which is permanent and which invalidates the
  score. The confirmation runs BEFORE anything is placed, so there is no path
  where something has arrived in a character the player did not agree to spend.
  That is what keeps "the debug commands mark your character" a true sentence
  about this game rather than one with a mod-shaped hole in it.
- **And the second thing it buys is a line on the consent list.** `debug:spawn`
  is its own capability kind with no wildcard over it, so a player asking which
  of their mods can conjure things reads the answer off one line and no broader
  grant can carry it along.
- **The question is asked on the GAME SCREEN, which your own modal panel would be
  covering.** So the first spawn in a character is refused, by name, while one of
  your modal panels is up - a refusal the player can read beats a prompt they
  cannot see, and the natural flow does not hit it, because a builder showing the
  player the dungeon has already closed its panel. After the character is marked
  there is nothing to ask and the panel does not matter.
- **Placement is the game's and there are no coordinates.** An item is dropped at
  the player's feet through `dropNear`; a creature is scattered near them with the
  engine's own ten attempts at a legal spot. A mod that could name a grid could
  put a monster inside a wall, and "does the thing I just wrote work" does not
  depend on where it lands. Ask by NAME rather than by index where you can: an
  index is a fact about a registry, and the registry moved when another mod was
  enabled.

## 4f. `ctx.wizard`: the whole debug set, on a session that is not being saved

`debug:wizard`. Everything `^A` can do, driven from a mod's own screen instead of
from a text menu, and priced differently from `debug:spawn` in a way that is worth
reading before either is requested.

```js
if (!ctx.wizard) return;
const save = ctx.wizard.attached();   // who is about to stop being saved
if (!confirmWithThePlayer(save?.name)) return;
ctx.wizard.sandbox();                 // one way, and the gate on everything else
ctx.wizard.goToDepth(40);
ctx.wizard.spawnCreature("Bag Wraith", 3);
ctx.wizard.grantExperience(50000);
```

- **The commands are not new and are not reimplemented.** `game/wizard.ts` already
  holds the forty-odd `do_cmd_wiz_*` functions, ported and faithful, and until this
  landed the only front end for them was a text menu a mod cannot drive. Every
  method here is a name, an argument check and one call into the function the `^A`
  menu dispatches to, through the same live `WizardDeps`. Where a method looks thin
  that is the property being kept: a second implementation of "give the player
  experience" would be a second set of rules about levelling up.
- **`sandbox()` is the price, and the host checks it rather than trusting the mod.**
  Every command refuses until it has been called, and it cannot be undone. What it
  does is detach the page from its save slot, which is the single thing every write
  to a character consults - the turn-tail autosave, the level-change save, `S`, the
  options screen, `pagehide` and the death save all end up there. A page attached to
  no slot writes nowhere. The attachment lives in that page's own memory, so no
  other window can put it back.
- **Which is why this seam is SAFER for the character on disk than `debug:spawn`
  is, not more dangerous.** Spawning happens to the character the player is
  actually playing and costs them the score of that character for good. This one
  refuses to touch a character that is still being written down at all. A consent
  line describing it as "more debug commands" would have the risk exactly
  backwards, so it does not.
- **What it costs is the session, and the mod has to say so.** The character on disk
  keeps whatever the last save left. The autosave runs at the tail of a turn and
  throttles to three seconds, so what is lost is at most three seconds of TURNS -
  not three seconds of sitting in a menu, which takes none. Afterwards the session
  plays on in memory, and reloading the page lands on the character select with the
  character waiting as it was. `attached()` exists so the question the player is
  asked can name them.
- **There is no re-attach, and the absence is the feature.** Re-attaching would mean
  writing a cheated character over the save it was detached from, which is the one
  outcome the mechanism exists to make unreachable.
- **Dropping the active id is not the whole guarantee**, because that key lives in
  storage every tab on the origin shares. A second tab reaching the character select
  and resuming somebody writes a real slot id back into it, and a page that had
  given up its save - and has since been cheated freely - would be silently
  re-attached to a real character. The death path is the worse half of that: it does
  not overwrite the slot, it DESTROYS the slot's bytes and records a death in a
  ledger that deliberately outlives the tombstone, so a monster killing the cheated
  character would delete a real one. Detaching therefore also throws a one-way latch
  in the page's own memory, which both doors into slot storage check and which no
  other tab can see or clear.
- **Why not fork the save into a branded copy instead**, which is the other obvious
  shape. A fork is a real, resumable second character in the roster, and that is
  what this game deliberately does not have: death is terminal, a slot's bytes are
  destroyed when its character dies, and the death ledger outlives even the
  tombstone so that clearing a memorial cannot launder a resurrection. A branded
  fork made at dungeon level 40 and left in the roster is a restore point whatever
  the brand says, and the brand is the part a player can ignore. A fork also has to
  be swept up later, which means a purge at boot, which means a purge that can be
  missed. Detaching has none of those properties because it never writes anything.
- **`sandbox()` takes the debug mark itself, and does not pose the game's own
  question.** `ctx.debug` asks because it acts on a character that is still being
  saved and the mark is permanent for that character. Here the character has already
  stopped being written down, so the question has no consequence left to warn about -
  and it would have to be posed on the character grid, underneath whatever the mod
  is drawing, which is the refusal `debug:spawn` has to carry. Detaching is the
  consent moment; the mod asks for it in its own words on its own screen, and the
  bit is then simply true.
- **`catalogue()` is readable BEFORE `sandbox()`**, and it is the one thing here
  that is. Listing is reading, and deciding what to test is exactly how a player
  decides whether to detach at all - a browser that only filled in after they had
  agreed would be asking them to agree to something they cannot see. Each entry
  carries `from`, the pack that added the record, absent for the base game's own.
  That is what lets a browser put a mod author's own content first without keeping
  its own list of what vanilla contains.
- **Placement is the game's and there are no coordinates**, on the same terms as
  `debug:spawn`.

## 5. Doors that are exported but deliberately CLOSED

An exported mutable table is an extension point whether anyone meant it to be one
or not. Two were found this way and are now frozen at runtime, not merely typed
`readonly` - a mod folder ships plain `plugin.js`, so the type binds nobody there:

| Table | Where | Why it is closed |
| --- | --- | --- |
| `MONSTER_HANDLERS` (56 slots) | `core/src/mon/project-mon.ts` | Exported for the parity test that counts the slots. |
| `DEBUG_MENU` (9 categories) | `web/src/wizard.ts` | Upstream's own `cmd_debug_*` tables; the parity tests assert their letters. Frozen **deeply** - the rows anyone would want to add live in `commands`, one level down. |

The reason is not tidiness. A mod assigning into one of these patches core from
*outside* the mod system, so the patch:

- has no ordering against another mod's patch (nothing composed it);
- appears in no manifest, so no menu, save or report can name it;
- **survives disabling the mod that added it**, which contradicts the rule that a
  disabled mod's patches do not exist.

Both are covered by tests that assert the write THROWS, and both were
mutation-proven by removing the freeze. If you need to change what one of these
tables does, ask for a hook in `core/src/mod/hooks.ts`, where contributions
compose, order and disable properly. That request is a reasonable one - a closed
door here is not a refusal, it is a redirection to the door with hinges.

## Why this is safe for a faithful port

- **Absence is the default, at every level.** No mod enabled => no entry point
  called => nothing contributed => `composeModHooks` returns `undefined` =>
  `GameState.modHooks` absent => every call site is one `?.` away from the exact
  4.2.6 line. There is no map to mis-key and no flag to leak.
- **Core holds no mod's name and no mod's fix body.** The seam is generic; the
  patch is the mod's own module.
- **The generation and object hooks are RNG-free by contract**, so a seed still
  means the same dungeon, and a level that needed no repair is bit-identical to
  one generated with no mod at all.
- **Choices are a client setting, not saved** - a save is portable and does not
  bake in a mod's behaviour; the same character plays faithfully if the mod is
  removed.
- **Turning a patch off is a true revert, not an approximation**, because the
  faithful path is the only path core ever compiled.

## Input-door groundwork

`packages/web/src/input-door.ts` owns the only browser `keydown` listener. It
normalizes keyboard and queued keymap output into `UiInput`; a future gamepad or
touch adapter submits the same value. `UiDirection` deliberately includes a
continuous `x`/`y` vector, magnitude, and clockwise angle, so analog input may
remain at (for example) 37 degrees until a legacy direction prompt elects to
quantize it. Before the player-keymap resolver runs, the host keeps its three
prior ownership gates: score pages, modal depth, and an active run-interrupt
pump receive the literal key rather than a queued expansion. This is host infrastructure, not a registry or plugin capability
yet. The player's stored keymap is resolved before screen subscribers, so a
later mod input consumer cannot silently take a player-selected binding.

## Where to look

| Concern | File |
| --- | --- |
| The `ModHooks` interface + per-hook fold rules | `packages/core/src/mod/hooks.ts` |
| `GameState.modHooks` field, `modRuleEnabled` tombstone | `packages/core/src/game/context.ts` |
| Start/load seam + live-hook threading into deps | `packages/core/src/session/game.ts` |
| Deps-bag hook fields (no `GameState` in scope) | `packages/core/src/gen/generate.ts`, `packages/core/src/obj/make.ts` |
| Auto-dig indirection + public dig primitives | `packages/core/src/game/cave-cmd.ts`, `player-turn.ts` |
| Manifest `rules` type + validation | `packages/mod-sdk/src/manifest.ts` |
| Rule discovery | `packages/web/src/pack.ts` (`loadEnabledModRuleDecls`) |
| Choice persistence + resolver | `packages/web/src/mod-store.ts` |
| Per-mod hook discovery + fold | `packages/web/src/mod-hooks.ts` |
| The first-party mods' own hook code (their repositories, not this tree) | `neo-angband-mod-bug-fixes/plugin.ts`, `neo-angband-mod-qol/plugin.ts` |
| Per-mod Fixes & tweaks submenu | `packages/web/src/mods.ts` (`managePatches`) |
| DOM panels: the layer, the invariants, the way out | `packages/web/src/panel-runtime.ts` |
| The content-only install door, and its session sibling | `packages/web/src/install-runtime.ts` |
| The session tier: staging, the lifetime, and what it is worth | `packages/web/src/mod-session.ts` |
| Conjuring, and the debug mark that pays for it | `packages/web/src/spawn-runtime.ts` |
| The one keydown registration, and the door's stand-down | `packages/web/src/input-door.ts` |
| Host wiring + message sink | `packages/web/src/main.ts` |
| Per-mod design | `docs/modding/QOL.md`, `docs/modding/BUG_FIXES.md` |
| Measured reach + gap list | `docs/modding/MOD_REACH.md` |
