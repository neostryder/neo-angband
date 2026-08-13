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

The frame also carries `regions` — the named parts of the screen (`map`,
`messages`, `sidebar`, `status`) in grid cells and in CSS pixels, computed by
`packages/web/src/regions.ts` from the same `viewport()` numbers `render()`
draws with, and projected through `GlyphTerm.metrics()`. `map` is the selected
front end's; the others are core's. This is what lets a replacement draw inside
the map rectangle instead of over the window, and it is optional on the frame
only because a host with no fitted surface has none to give — absent means draw
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

The one seam behind both bundled mods. `GameState.modHooks`
(`packages/core/src/game/context.ts:712`) is an optional `ModHooks`
(`packages/core/src/mod/hooks.ts:83`): a plain interface whose every member is an
OPTIONAL function. An absent member means "no mod touches that point", and core
takes its faithful path with one undefined check:

```ts
/* obj-list.ts:242 - the whole shape of a seam read */
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

That was rejected (the project owner, 2026-07-29) on the grounds that a
flag-gated fix is not excluded from core: **core shipped the fix body, core was
tested on it, and core carried the mod's own flag name as a string literal.**
Deleting the mod folder would not have deleted a line of it. `modRuleEnabled` is now GONE from core -
deliberately deleted rather than left unused, because a helper that exists is a
helper the next core function reaches for (see the tombstone comment at
`packages/core/src/game/context.ts:932`).

What core still contains, and cannot stop containing, is the SEAM ITSELF: one
named, documented extension point per behaviour a mod may override. That is the
price of behaviour modding at all. The difference that matters is that a seam is
generic, available to any mod, and holds no opinion about what plugs into it.

### The hooks, and the ONE core call site each serves

Each member of `ModHooks` documents its single call site, because a hook whose
call site is not written down is a hook nobody can verify is still wired - the
exact failure the call-site census exists to catch.

| Hook | Kind | Call site | Faithful answer when absent |
| --- | --- | --- | --- |
| `walkBlockedByDiggable(state, grid, deps)` | first-handler | `game/cave-cmd.ts:680` (`movementAutoDig`), reached from `game/player-turn.ts:493` | `?? 0` - bump the wall, spend nothing, draw no RNG |
| `objectListTiebreak(a, b)` | ordering | `game/obj-list.ts:242` | `?? 0`, i.e. leave the entries equal (stable sort keeps collect order) |
| `levelGenerated(gen, quest)` | veto | `gen/generate.ts:473` | accept the level as generated |
| `artifactCommit(aidx, alreadyCreated)` | veto | `obj/make.ts:987` | commit it unconditionally |
| `historyAdd(entry)` | veto | `session/game.ts:872` (the `HIST.SLAY_UNIQUE` path) | `?? true` - write every entry, duplicates included |
| `saveNoiseScent()` | any | `session/save.ts:1203` | `?? false` - omit the heatmaps, which is upstream's behaviour and upstream's bug |
| `messageText(raw)` | transform | `packages/web/src/main.ts:1244` (the HOST's single message sink, not core) | `?? raw` - show what core was given, warts and all |
| `optionsChanged(snapshot)` | notification | `packages/web/src/options.ts` (`notifyOptionsChanged`, at the end of `runOptionsMenu`) | nothing happens; core reads no answer |

`optionsChanged` is the odd one and worth reading twice: it is the only member
core does not ask a QUESTION. Every other hook's return value changes what the
engine does next, so the fold has to decide whose answer wins. This one is told
that the player has finished changing their settings, returns nothing, and folds
**all-observe** - every listening mod is told, in load order, and none can
overrule another, because two mods reacting to one fact are not in conflict.

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
`composeModHooks` (`packages/core/src/mod/hooks.ts:330`). This is the same
layering as content: core consumes a composed result, never the pack list.

"Later wins" is not a usable rule here, because the hooks differ in kind. What
`composeModHooks` actually does, per hook:

- **VETO hooks** (`levelGenerated`, `artifactCommit`, `historyAdd`) are
  **conjunctive**: every contributor runs and the **first refusal decides**
  (`hooks.ts:366`, `:374`, `:382`). This is the only safe fold - a mod that
  vetoes a duplicate artifact must not be overruled by a later mod that merely
  has no opinion. Note for `levelGenerated` specifically: every contributor still
  runs after an earlier one has REPAIRED the level, because a second mod's
  invariant is not satisfied by the first mod's repair; only a refusal
  short-circuits, since the level is being thrown away anyway.
- **TRANSFORM hooks** (`messageText`) **chain in load order**, each seeing the
  previous one's output (`hooks.ts:394`, a `reduce` over the contributors).
- **FIRST-HANDLER hooks** (`walkBlockedByDiggable`) stop at the **first
  non-`null`** (`hooks.ts:340-346`), so an earlier mod's handling wins and a later
  one cannot double-spend the same turn's energy.
- **ANY hooks** (`saveNoiseScent`) are **disjunctive** - `some()`
  (`hooks.ts:389`). One mod asking for the data is enough, because the data is
  additive and a second mod has nothing to object to.
- **ORDERING hooks** (`objectListTiebreak`) stop at the **first non-zero**
  answer (`hooks.ts:351-357`), the same way a lexicographic comparator chains.

`composeModHooks` returns `undefined` when nothing contributed (`hooks.ts:334`),
so the host leaves the field ABSENT rather than storing an empty object. That
keeps "no mod loaded" and "a mod loaded that touches nothing" indistinguishable
from core's side - which is the one thing the seam exists to guarantee.

### What happens when a hook throws

A hook is third-party code running inside a turn, so it can throw. The host wraps
each mod's contribution with `guardModHooks`
(`packages/core/src/mod/hooks.ts:258`) BEFORE folding it - guarding per mod is
what lets the fault be attributed, since the host holds the id and core does not.

A throw becomes that hook's **neutral answer**, which is per-hook and is the same
value core would have used with no mod loaded at all: `null` for
`walkBlockedByDiggable`, `0` for `objectListTiebreak`, `true` for the three vetoes
(`levelGenerated`, `artifactCommit`, `historyAdd`), `false` for `saveNoiseScent`,
and the raw string for `messageText`. So to the fold, a broken mod reads exactly
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

For the first-handler fold, the sentinel cannot be a value the hook might
legitimately want to return. `walkBlockedByDiggable` returns an ENERGY COST, and
`0` is a real energy cost - so if `0` meant "decline", a mod could not express
"I handled this action and it costs nothing". `null` keeps the two apart:
`hooks.ts:343` tests `energy !== null`, so a hook returning `0` HANDLES the walk
and stops the chain, while `null` passes it to the next mod.

Two honest caveats, both verified in the code rather than assumed:

- The **call site truncates the distinction today.** `movementAutoDig`
  (`cave-cmd.ts:680`) collapses a declining hook to `0` with `?? 0`, and
  `walkAction` (`player-turn.ts:493`) then tests `if (dug > 0)`. So a hook that
  returns `0` short-circuits the FOLD (a later mod does not get the walk) but
  still falls through to core's faithful bump. "Handled for zero energy" is
  expressible in `ModHooks` and in `composeModHooks`, and is not yet honoured by
  this one call site. A hook wanting to handle a walk must therefore return a
  positive energy cost.
- `objectListTiebreak` uses `0` rather than `null` as its "no opinion" answer,
  because there `0` is also the faithful answer ("these two entries are equal"),
  so the two readings agree and no third value is needed.

## 2. How a patch is turned on - and where the patch's CODE lives

A mod does not execute code to flip a flag, and core never sees a flag name at
all. The flags still exist, but they are now purely a **conversation between the
host and the mod**:

1. The mod DECLARES its patches in `manifest.json` under `rules`, each an entry
   of `{ "flag": "qol.autoDig", "title": "…", "description": "…", "default": true }`.
2. `packages/web/src/pack.ts` `loadEnabledModRuleDecls()` gathers the `rules` of
   every ENABLED mod, in load order.
3. `packages/web/src/mod-store.ts` `resolveModRules(decls, choices)` computes the
   effective map: for each declared rule, `choices[flag] ?? rule.default`. The
   player's choices come from each mod's **Fixes & tweaks** submenu and persist
   in `localStorage` (`neo:modRuleChoices`) - a client setting, like the
   enabled-mod set, NOT part of the savefile.
4. `packages/web/src/mod-hooks.ts` `resolveModRuleFlagsByMod()` SLICES that map
   per mod, then `activeModHooks()` (`mod-hooks.ts:159`) calls each enabled mod's
   entry point once, in load order, with only that mod's own flags, and folds the
   results with `composeModHooks`.
5. `packages/web/src/main.ts` passes the composed object to `startGame` /
   `loadGame` as `opts.modHooks` (`main.ts:756`, `main.ts:713`).

The entry point every behaviour mod default-exports from
`packages/web/mods/<id>/hooks.ts`:

```ts
export default function <mod>Hooks(
  flags: Readonly<Record<string, boolean>>,
): ModHooks;
```

It is discovered by a glob (`import.meta.glob("../mods/*/hooks.ts")`,
`mod-hooks.ts:71`) rather than a hardcoded list, so the host knows no mod's id
and no mod's flag names. A mod with no behaviour - the linoleum tile pack, and
every pure content mod - simply ships no `hooks.ts` and is never called.

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

**Default policy (the project owner's ruling, 2026-07-26; wording tightened 2026-07-27).**
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
- **Every mod itself is OFF on a fresh install**, including the bundled
  first-party ones (`DEFAULT_ENABLED_MODS` is `[]`, `mod-store.ts`). So an
  untouched install has no mod, therefore no patches, therefore faithful 4.2.6.

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

`startGame` and `loadGame` (`packages/core/src/session/game.ts:390`, `:3264`)
each accept an optional `modHooks` and store it on `GameState`. Absent =>
faithful core. The session threads the LIVE `state.modHooks` (read fresh, not
captured - `session/game.ts:967`) into the deps bags that the pure layers need it
in: `GenDeps.hooks` (`gen/generate.ts:80`) and `MakeDeps.hooks`
(`obj/make.ts:1119`), because those layers have no `GameState` in scope.

`modRules` still exists on `GameState` and is still seeded at start/load, but it
is now **OPAQUE to core**: nothing in `packages/core/src` reads it. It is the
RECORD of the player's choices, kept because it is what the Fixes & tweaks menu
is built from and what the host re-reads. Because core does not branch on it,
writing it alone is a no-op - so the live per-patch toggle
(`applyRuleLive`, `packages/web/src/main.ts:4956`) must REBUILD the hooks, and
must `delete game.state.modHooks` rather than assign `undefined` when nothing
contributes, so "no mod loaded" stays absent rather than becoming an empty object
core could detect.

Built-in Angband options are NOT set through any of this: they ship in core at
their upstream defaults (`OPTION_ENTRIES.normal`) and are restored from the save
on load. (This is what the removed `interfaceDefaults` seam used to do.)

## 4. `GameState.autoDigStep` - a plumbing indirection, not a mod seam

`walkAction` (`packages/core/src/game/player-turn.ts:493`) calls
`state.autoDigStep?.(state, next)` when a walk is blocked. This is NOT a second
mod seam and holds no mod's behaviour: the session installs it
(`session/game.ts:1670`) pointing at `movementAutoDig`
(`game/cave-cmd.ts:675`), whose entire body is the `walkBlockedByDiggable`
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
reimplemented: `movementTunnelTest` (`cave-cmd.ts:662`, RNG-free, which is what
lets the mod decline for free) and `tunnelAux` (one real `do_cmd_tunnel_aux`
attempt with the upstream roll, messages, and payouts).

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

## Where to look

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
| Bundled mods' own hook code | `neo-angband-mod-bug-fixes/plugin.ts`, `neo-angband-mod-qol/plugin.ts` |
| Per-mod Fixes & tweaks submenu | `packages/web/src/mods.ts` (`managePatches`) |
| Host wiring + message sink | `packages/web/src/main.ts` |
| Per-mod design | `docs/modding/QOL.md`, `docs/modding/BUG_FIXES.md` |
| Measured reach + gap list | `docs/modding/MOD_REACH.md` |
