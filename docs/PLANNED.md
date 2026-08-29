# Planned, not yet implemented

**This file is the only place in the repository where work that has NOT landed is
written down.** `CHANGELOG.md` records what shipped and nothing else: an entry
appears there when the code is in the tree, never before. The two are easy to
blur, and blurring them is expensive in a public repository: a changelog that
describes intentions reads, to somebody who did not write it, exactly like a
changelog that describes features. They then look for the feature.

So the rule is one sentence. **If it works, it goes in the changelog. If it is
going to work, it goes here.**

What this file is *not*: it is not the plan. `docs/PORT_PLAN.md` holds the
ratified decisions and the shape of the project, and it outranks this file
wherever they touch. This is a worklist: the things known to be missing, with
enough of the evidence attached that picking one up does not mean rediscovering
why it matters.

An item leaves this file in exactly one of three ways: it lands (and is written
up in `CHANGELOG.md`), it is found not to apply (and says so, briefly, before it
goes), or it is found to be unreachable in the thing being ported (and says
that). "Still open" is not one of them, and neither is silence.

Last reviewed: 2026-08-23.

---

## Core fidelity

### The `finish_parse_*` hooks - audit complete

Upstream runs a finish hook after parsing many of its data files, a second pass
that orders, validates, back-fills or reverses what the parser built. The port
folds parse and finish together in a registry constructor, which means **a parity
test mirroring upstream's parser tests is structurally blind to the finish
hook**: it can pass in full while the finish pass is simply absent.

All 45 `finish_parse_*` hooks in the reference tree are now audited: 33 across
`init.c`, `obj-init.c` and `mon-init.c` (several gaps found and fixed there; see
`CHANGELOG.md`), and the remaining 12 - `generate.c`'s three level-generation
hooks plus nine singletons spread one each across `grafmode.c`, `mon-summon.c`,
`obj-chest.c`, `player-quest.c`, `player-timed.c`, `store.c`,
`ui-entry-renderers.c`, `ui-entry.c` and `ui-prefs.c`. **None of the 12 needed a
code change** - each is either already faithfully ported, a no-op upstream with
nothing to port, or a deliberate no-port-subject case the port already
documents. Recorded here so the next audit does not repeat the reading:

- `finish_parse_profile`, `finish_parse_room`, `finish_parse_vault`
  (`generate.c` L223, L450, L614) reverse a prepended parse list back to file
  order (`cave_profiles`), or leave it in reverse file order to match the
  prepend (`room_templates`, `vaults`). Order matters here: `random_room_template`,
  `random_vault` (`gen-room.c` L55-90) and `choose_profile`'s weighted pass
  (`generate.c` L813-880) are single-pass reservoir/weighted-reservoir samplers
  that draw from the RNG once per candidate walked, so a wrong order would be
  an RNG-stream defect, not merely a wrong pick - exactly the class of bug this
  file's RNG-drift caution exists for. `createDungeonProfiles`
  (`packages/core/src/gen/cave.ts` L3043) and `loadRoomTemplates` / `loadVaults`
  (`packages/core/src/gen/room.ts` L131, L159) already reproduce upstream's
  exact order and say so in their own comments; `gen.test.ts`'s "Round" vault
  case already pins a prior regression of exactly this kind. No RNG-position
  check was needed because there is no change to make.
- `finish_parse_grafmode` (`grafmode.c` L105): reverses the parsed list to file
  order, appends the hardcoded "None" fallback entry, and records the highest
  `grafID`. `packages/core/src/visuals/grafmode.ts` plus the generator that
  feeds it (`packages/core/scripts/gen-grafmode.mjs`) reproduce all three, in
  file order.
- `finish_parse_summon` (`mon-summon.c` L164): reverses the list to file order
  and resolves each `fallback:` name to an index. `SummonTable` in
  `packages/core/src/mon/summon.ts` does both - the constructor builds in file
  order, then a second pass resolves `fallbackName` through `nameToIdx`.
- `finish_parse_chest_trap` (`obj-chest.c` L262) and `finish_parse_stores`
  (`store.c` L314) do nothing upstream but destroy the parser: both write
  straight into a pre-sized or non-listed structure while parsing, so there is
  no finish-time logic to port.
- `finish_parse_player_timed` (`player-timed.c` L655) is the same shape: it
  frees the parser's scratch state and nothing else, because `player_timed`
  writes directly into the static `timed_effects[TMD_MAX]` array as it parses.
- `finish_parse_quest` (`player-quest.c` L90): reverses the list to file order
  and stamps each record's `index`. `bindQuests`
  (`packages/core/src/game/quest.ts` L65) builds the array in file order with
  `index` set to the array position; `quest->index` has no other reader
  upstream (checked by grep), so there is nothing else riding on it.
- `finish_parse_ui_entry_renderer` (`ui-entry-renderers.c` L1660): resolves a
  `combined-renderer` name, backs the combiner in from the backend's default
  when `combine:` is absent, and pads `colors` / `labelcolors` / `symbols` out
  to the backend's default length when the record's own palette is shorter.
  All four are ported in `packages/core/src/game/ui-entry.ts` (`buildRenderers`,
  `combinerForRenderer`, `augmentColors`, `augmentSymbols`) - the combiner
  resolution is deliberately done live, at apply time, rather than baked in at
  parse, which the port's own comment records as an intentional improvement
  rather than a gap.
- `finish_parse_ui_entry` (`ui-entry.c` L2278): defaults an entry's label to its
  name when none was set, fills the shortened-label ladder, and back-fills a
  category's priority from the entry's default when the category never set one
  of its own. All three are in `buildEntries`
  (`packages/core/src/game/ui-entry.ts` L1008-1027), the priority back-fill
  citing a previously-fixed bug in its own comment.
- `finish_parse_prefs` (`ui-prefs.c` L1162): merges newly-parsed subwindow flags
  over the existing set, so a term the pref file never mentions keeps its prior
  flags. The port has one terminal and no persistent per-term state to merge
  into; `packages/core/src/visuals/prefs.ts` (`parseWindow`) already records
  this as a no-port-subject case, the same shape as `world`'s hook among the
  first 33.

Tracked as issue #1.

### The targeting banner's remaining clauses

`target_display_help` builds its sentence from what the loop is offering, and
two clauses are never reached here because the underlying commands are not
implemented: pathfinding to the selection, and ignoring the selected object.
Upstream omits each in exactly this case too, so the banner is not saying
anything false; it is just missing the two commands themselves. The `<click>`
half is not one of the gaps - a tap on the canvas already moves the cursor and
selects, and the banner names it.

Tracked as issue #6.

## Attribution

When a mod causes something, the game should say so; otherwise the reader blames
core for behaviour a mod produced. The character dump's `[Mods enabled]` block is
fixed. **The other surfaces have never been enumerated**: save provenance, log
lines, and the conflict pane are the three that are known to exist.

Tracked as issue #9.

## The tile seams

### Two mods answering for the player's cell is unreported

`registry:tiles` grew a player-tile door in the Unreleased line: a provider asked
once per frame the player is drawn, first non-null answer in load order winning.
That is the first tile seam where a CONTEST between two mods is possible, and
`mod-conflicts.ts` has no row for it yet.

Tracked as issue #10.

### No pixel has been seen through the transform

`remapToRamp` is measured byte for byte and the slot allocation is measured
through the real door, but nothing has photographed a mirrored, repainted tile on
screen. A taint on `getImageData` would fail silently by design, and that path
has never been observed either way.

Tracked as issue #11.

## Moddability reach

This was the "alpha gate", narrowed 2026-08-15. Renamed on 2026-08-21 because
the gate has been passed: `0.20.0` shipped as the initial public alpha on
2026-08-16, so **the alpha cut itself has left this file by landing** and the job
since then is each next minor or patch rather than reaching a cut. What was filed
under that heading and is still genuinely open is the moddability work the cut was
waiting on:

- **Gap 21, UI moddability.** The world is a separate seam (gap 9) and is done;
  everything else a mod might want to change about the interface is this.
  Tracked as issue #12.
- **Mod content coverage**, so the first-party mods exercise what the gate
  assumed they exercise. Tracked as issue #13. Unrelated to the
  `upstream-catchup` mod, which is a different sense of catching up and shipped
  on 2026-08-24.

### Borg's PF_COMBAT_REGEN rest check is still not wired

One arm of the Borg's `borg_check_rest` asks a player-class flag, PF_COMBAT_REGEN,
and `PlayerView` had object flags and derived skills but no way to answer "does
this player's class have flag X" - class-definition data, not anything gear or
level derives. `PlayerView.classFlags` (agent API 1.3.0) closes that half: PF_*
codes off the class's own flag set (`p.cls.pflags`, class.txt's `player-flags:`
lines), COMBAT_REGEN for a Blackguard among them.

**What is still not done**: the seam is in this tree, but `neo-angband-mod-borg`
depends on a published `@rpgm-tools/neo-angband-core` version rather than a
local link, so the mod cannot consume or test against `classFlags` until a core
release ships with it - and wiring the Borg's own check to read it is separate
work in that repository, still open.

Tracked as issue #34.

### The input door does not know about IME composition

`browserKeydown` (`packages/web/src/input-door.ts`) reads no `isComposing`, so
while an input method is composing a character every intermediate keystroke is
dispatched to whatever screen owns the keyboard and read as a game command. A
mod panel is already safe; the game's own prompts (`getString` and its
callers) are not.

Tracked as issue #14.

### Two `help.test.ts` cases fail only in a full run

Observed twice in one sitting and then not again with no change to the tree
between the runs, and the suspect is a read of the generated tile tree racing
its own generator. This suite is the gate on every commit, which is why a case
that fails one run in two is worth closing rather than living with.

Tracked as issue #16.

### A mod panel has never been driven on a phone or in Electron fullscreen

`ui:panel.mount`'s ownership, invariant and escape-hatch logic have unit tests
and were probed in the shipping desktop build over CDP, but a virtual
keyboard's effect on the canvas and Electron's fullscreen behavior have not
been measured, because both need a mod that mounts a panel and the first one
is still being written.

Tracked as issue #17.

### A mod that installs a mod is not recorded as having done so

`ctx.installMod` lands an archive through the same door the player's own zip
import uses, so the arriving mod is keyed, digested, listed and consented to
identically - and identically means the stored record does not say a mod put
it there.

Tracked as issue #18.

### There is no isolation tier a mod's own `plugin.js` could run in

A mod's code runs in the page's realm with `ctx.core`, `ctx.state`,
`ctx.registries`, `document`, `fetch` and IndexedDB. That is true of an installed
mod and it is equally true of one loaded for a session (2026-08-21), and the
session tier is deliberately not sold as being safer than it is. The only tier in
this tree that actually fences is the autoplayer sandbox
(`packages/web/src/agents/sandbox/`): a Web Worker, a versioned message protocol,
a view snapshot serialised per granted domain, and `fetch`/`XMLHttpRequest`/
`WebSocket` neutered in the worker unless `network:*` is granted. It is real
isolation and it hosts a CONTROLLER, not a mod.

**Why the same shape does not extend to a plugin, measured against the ABI rather
than guessed at.** `hooks(ctx)` is called before `startGame` and must RETURN
FUNCTIONS, which the composed `ModHooks` then calls synchronously inside the turn
loop; `register(host, ctx)` mutates a live state object and installs handlers by
identity; `ctx.core` is a live namespace whose registry singletons are shared
objects. `postMessage` copies data and cannot carry a function, a DOM node, an
accessor or object identity, so a proxy over the boundary turns every one of those
synchronous calls into an asynchronous one, and the turn loop cannot await inside
itself. `SharedArrayBuffer` does not rescue it: blocking the main thread on a
worker would freeze the frame, needs cross-origin isolation, and still does not
transfer live object semantics.

So a worker-hosted plugin needs a DIFFERENT ABI - snapshots in, declarative
actions out - and that is the load-bearing objection rather than the cost:
**isolation that changes the execution model does not test the artifact.** An
author asking to try their own `plugin.js` would be running a different program
from the one they ship, and a testing tool that gives false confidence is worse
than one that admits what it is.

What would fence the host without changing the plugin's execution model is a
per-plugin JS realm sharing the thread, so hooks stay synchronous and `document`,
`fetch` and `ctx.core` reach the plugin only when the host hands them over. No
such primitive is available: the ShadowRealm proposal is not shipped in any
browser this game targets, and a userland "realm" built out of proxies would be a
reimplementation of the host, which is the thing that would then need auditing.
Recorded as the shape to build if the platform ever grows it, not as work waiting
on somebody here.

**What is still worth doing without any of it**: the session tier's own
confirmation names the digest of the bytes it is about to run, and nothing
re-asks when a re-staged draft changes them.

Tracked as issue #19.

### A save written under session-only content is loadable but not reproducible

`loadGame` quarantines live entities whose namespace is absent, which covers a
pack going away. What it cannot see is a pack that PATCHED a record in a
namespace that is still present: the patched value is simply gone on reload,
because the patch lived in the composition and the composition is not
reproducible. A degraded outcome rather than corruption, and the same gap
exists for a permanently installed pack that is later removed.

Tracked as issue #20.

### An autoplayer's real long-run resource behaviour is still unmeasured

`ModPlugin.controller`'s pump has no tick cap by design - a "let it play" mod
is supposed to keep going, unlike the debug agent and plugin seams' manual-test
safety caps. The pump itself now has a player-visible speed control (Mods ->
the autoplaying mod's own screen -> Autoplayer speed, `packages/web/src/mods.ts`),
matching the debug agent seam's `?speed=` tiers.

**Measured, 2026-08-22**: the turn-loop/controller/message-drain path itself -
`installController` plus `runGameLoop`, the same shape the host's pump drives -
holds no memory across 20 million simulated turns (`process.memoryUsage().heapUsed`
sampled every 500k turns with a forced GC between samples; flat at ~34MB from
turn 500k through turn 19.5M on the worldless test harness, `game/harness.ts`).
That rules out the pump and the agent-facade plumbing as a leak source.

**Still unmeasured**: this used the worldless harness - no dungeon generation,
no level changes, no monsters, and a scripted bounce-in-place controller rather
than a real decision-making agent. A real "let it play" mod generates many
dungeon levels over an hours-long run (each a fresh `Chunk` the old one must be
freed behind), keeps its own remembered-world state (a Borg's map/monster/object
memory grows with what it has seen), and runs inside a browser tab whose
`render()`/canvas/animation-frame path is a second resource surface core's tests
cannot see at all. None of those are exercised here, and a real run - a browser
tab with the Borg actually playing for several real hours - is what would close
this the rest of the way.

Tracked as issue #21.

### main.ts's menu and picker arguments still bypass the translator

The `en-XA` pseudo-locale sweep (`docs/modding/AUTHORING.md`'s tool for
finding strings the translator never reaches) now covers every screen under
`packages/web/src`, main.ts included: its combat text, `say()` status
messages and `confirmYesNo`/`getCheck` prompts all route through `t()`.

What is left in main.ts is a different shape, and a field-name grep does not
see it: the title, footer, prompt and empty-list strings handed positionally
to `selectFromMenu`, `selectItemFrom`, `itemSelect` and `showTextScreen` -
"Quality ignore menu", "Drop which item?", "You have nothing to drop.",
"[ a-z to choose, ESC to cancel ]" and their neighbours. Roughly forty of
them, all in the same two argument positions, so the pass is mechanical
except for one case that is not: `chooseBook` builds its prompt by splicing
a verb into "\<Verb\> which book?", and a language that inflects the verb or
orders the sentence differently cannot express that with a verb slot. That
one needs an id per command rather than a wrapper.

Tracked as issue #95.

## Mod sharing

### Shareable mod-set snapshots

Player/testing profiles (neo-angband#163) each carry their own independent
enabled set and capability consents, so switching mod loadouts locally is
switching profiles - but nothing about a profile ever leaves the browser,
carries a mod's version, or carries flag choices or options. A full design
for a portable, versioned snapshot - mod ids, versions, origins, per-mod flag
choices, and an optional birth/game-options section, plus the two Mods-menu
actions to make one and load one - is at docs/MOD_PROFILES.md.

Tracked as issue #87.
