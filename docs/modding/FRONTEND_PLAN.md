# Replacing the whole front end from a mod

**This is a PLAN, not a shipped API.** Nothing described here exists yet. It is
written down so a mod author can see where the seams are going, and so the work
can be argued with before it is built rather than after.

The goal is one sentence: **a mod can replace the entire user interface** — an
8- or 16-bit RPG menu shell, an isometric view, a fully 3D dungeon with a free or
restricted camera, a first-person Wizardry-style view, a controller-driven layout
— and the current glyph terminal becomes the first implementation of that
interface rather than a privileged one.

---

## What is already true, measured

The good news is larger than expected, and worth stating precisely because it
bounds the work.

**Core needs no changes at all.** `packages/core` is headless. It talks to the
outside through seams (`state.msg`, `state.sound`, `state.updateFov`,
`panelContains`) and contains no reference to a canvas, a glyph, or a colour. A
3D front end does not require the port to move.

**The precedent for the seam exists.** `ModPlugin.controller?` already does the
exact thing a front-end seam needs to do: one winner, capability-gated,
host-installed, refused rather than silently overwritten when two mods claim it
(`packages/web/src/mod-plugin.ts:327`). A `frontend?` member is the same shape.

**The split has been proven once, in the right place.** `mapview.ts` separates
the full-level map into *pure data and geometry* (`buildOverview`, `panLocate`)
from the drawing, with the live-state accessors injected as closures. It is
unit-testable in isolation and knows nothing about how the result is painted.
That is the pattern the rest of the UI needs; it is not speculative.

## What is in the way, measured

`packages/web` is **47,075 lines across 93 non-test files**, and it conflates two
different jobs: the *shell* (screen flow, what a command means, which key does
what) and the *renderer* (the glyph grid). Three specific obstacles:

**1. `GlyphTerm` is a class, not an interface.** It is reached from **22
non-test files with 198 references**. Every screen constructs its output by
calling concrete methods — `put`, `print`, `prt`, `eraseToEol`, `setCursor`,
`cellRect`. A mod cannot substitute anything for it because there is no type to
implement.

**2. There is no input door — there are fifty.** `window.addEventListener("keydown", …)`
appears **50 times across 13 files**. Every modal screen grabs the global keydown
itself, usually inside `new Promise(resolve => …)`. This is the single biggest
obstacle and it is not obvious from reading any one file.

It matters most for the thing that looks easiest: **controller support**. A
gamepad produces no `keydown` event. Today a mod wanting one would have to
synthesise `KeyboardEvent`s and dispatch them at `window` — which breaks the
moment two screens are listening at once, which is exactly when a modal is open.
Fifty listeners is fifty places for that to go wrong.

**3. `render()` resolves the world straight to glyphs.** `main.ts:6975` walks the
viewport and writes `Glyph` objects. There is no intermediate "what is at this
grid" model that a different renderer could consume. It is called from 56 sites.

---

## The shape of the answer

The temptation is a large set of hooks — one for the inventory screen, one for
the map, one for the status bar. That is unbounded and it does not work: every
new UI idea needs a hook nobody wrote, and the hooks that exist half-fit.

**The tractable version is the opposite: one total-replacement interface.** A mod
registers a front end. It owns the display root, receives the game as *data*, and
returns *intent*. What it does in between — glyphs, sprites, polygons, DOM
widgets — is entirely its business, and the engine never asks.

Five phases, ordered so each is useful on its own.

### Phase 1 — `Surface`, and `GlyphTerm` as its first implementation

Extract an interface from `GlyphTerm` and make the canvas terminal implement it.
Twenty-two files change a type import; behaviour is identical and every existing
test still passes unchanged.

On its own this makes a *different glyph renderer* moddable — WebGL, a DOM grid,
a different font engine. It does not yet allow a different paradigm. It is
mechanical, low-risk, and it is the floor everything else stands on.

### Phase 2 — one input door

Replace the 50 scattered listeners with a single dispatcher that owns the global
listener and routes to whatever is on top of a screen stack.

**This is the phase that unlocks controller support**, because with one door a
key, a gamepad button, a touch gesture and a mod-synthesised action are four
producers of the same `UiInput` value, and the screen underneath cannot tell them
apart. It is also the phase that gets strictly more expensive with every screen
added between now and whenever it happens.

It is the largest mechanical change of the five and the one most likely to
surface latent bugs — fifty ad-hoc listeners are fifty subtly different answers
to "who gets this key", and unifying them will find the ones that disagree.

### Phase 3 — screens as data

Today a screen is a promise around a listener that paints as a side effect.
Reify it: a screen *declares what it is* — a menu with these rows, an item picker
over this list, a text page, a two-panel browser — and the surface decides how to
draw it.

This is what makes **menu reimagining** possible without a mod reimplementing 93
files. An 8-bit shell implements "draw a menu" once and gets every menu in the
game.

### Phase 4 — the world as data

Split `render()`: a producer that answers *what is at each grid* (terrain,
remembered vs. seen, object, monster, player, lighting, target path) and a
consumer that turns that into glyphs. `mapview.ts` already demonstrates the
split works and stays testable.

**Isometric, 3D and first-person live here.** Such a front end consumes the world
view and never sees a glyph. Note what this does *not* require: no change to how
the game decides what the player knows, because that is core's job and core
already answers it.

### Phase 5 — `ModPlugin.frontend?`

The seam itself, modelled on `controller?`: one winner, capability-gated in the
manifest, installed by the host, refused when two mods claim it. **The default
front end registers through the same door**, so it is one implementation among
others rather than the special case everything else works around.

---

## What this costs, honestly

Phases 1 and 2 touch nearly every file in `packages/web`. Phase 3 touches every
screen. Phase 4 touches `main.ts`'s largest function. This is weeks of work, not
days, and most of it is not new behaviour — it is moving existing behaviour
behind a line.

Two things it does **not** cost:

- **The parity claim is untouched.** Core does not change. What the player sees
  does not change; only who draws it does.
- **It is not all-or-nothing.** Each phase is independently useful and
  independently shippable.

## The recommended split

**Phases 1 and 2 before 1.0. Phases 3–5 after.**

Phases 1 and 2 are the ones that get harder with every screen written in the
meantime, and phase 2 alone delivers the controller support that is currently
impossible rather than merely unbuilt. Phases 3–5 are additive: they can land in
a later release without redoing 1 and 2, and a mod author reading this can build
against a stable floor while they wait.
