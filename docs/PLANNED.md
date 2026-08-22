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

Last reviewed: 2026-08-22.

---

## Core fidelity

### The remaining `finish_parse_*` hooks

Upstream runs a finish hook after parsing many of its data files, a second pass
that orders, validates, back-fills or reverses what the parser built. The port
folds parse and finish together in a registry constructor, which means **a parity
test mirroring upstream's parser tests is structurally blind to the finish
hook**: it can pass in full while the finish pass is simply absent.

Tracked as issue #1.

### `flavor.txt` records that interleave `fixed:` and `flavor:`

The compiled record splits the two directives into separate arrays, so the
file's true line order is not recoverable from the compiled shape. Nothing
shipped interleaves them today, so this is latent rather than live.

Tracked as issue #2.

### The targeting banner's remaining clauses

`target_display_help` builds its sentence from what the loop is offering, and
two clauses - and the `<click>` half - are never reached here because the
underlying commands are not implemented.

Tracked as issue #6.

### A long message split across the top line

Upstream splits a message longer than the display line at the rightmost space
and recurses on the rest; this port's pager treats one long message as a page
of its own instead. Nothing is lost from the recall screen, but a very long
message reads differently.

Tracked as issue #7.

## Mod resilience

The contract is in `docs/modding/MOD_COMPATIBILITY.md`, and its four gates are
what any of this has to satisfy. One area is known to be short of it.

### Bind-time resilience: the rest of the binders

Three are done. Store records are complete: every field a patch can reach
refuses a mod's unresolvable entry and attributes it; the ego `item:` list does
the same; and an artifact's `base-object` drops the whole record rather than
the field. The shared decision lives in `packages/core/src/mod/refusal.ts`, so
a further binder is a small job rather than a repeat of the reasoning.

**What is missing is the denominator.** No systematic pass has been made over
the remaining binders to find every field that resolves a NAME from a list a
mod can append to, which is the shape that makes this reachable.

Tracked as issue #8.

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
- **Catch-up mod content**, so the first-party mods cover what the gate assumed
  they cover. Tracked as issue #13.

### The input door does not know about IME composition

`browserKeydown` (`packages/web/src/input-door.ts`) reads no `isComposing`, so
while an input method is composing a character every intermediate keystroke is
dispatched to whatever screen owns the keyboard and read as a game command. A
mod panel is already safe; the game's own prompts (`getString` and its
callers) are not.

Tracked as issue #14.

### Two tabs of the game share one active-character key

`neo-angband-active` names the character every save is written to, and it
lives in `localStorage`, which every tab on the origin shares, so two tabs open
on the same character both autosave into the same slot with last writer wins
and no warning to the losing tab. The sandbox `ctx.wizard` runs in is already
defended against this; the ordinary two-tab case is not.

Tracked as issue #15.

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

### A player-visible speed control for a mod's autoplayer

`ModPlugin.controller`'s pump ticks on a plain constant,
`MOD_AUTOPLAYER_TICK_MS`. The debug agent seam (`?agent=`) already has a
`?speed=fast|normal|slow` URL param for the same pump shape; the mod-controller
path has no player-facing equivalent, and unattended-long-run resource
behaviour is also unmeasured.

Tracked as issue #21.
