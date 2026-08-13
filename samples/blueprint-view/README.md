# Blueprint View — a worked front-end mod

A complete, runnable example of `ModPlugin.frontend`: it takes the dungeon
display away from the game's glyph terminal and draws a drafting-table
blueprint instead — walls as strokes, known floor as hatch,
remembered-but-unseen grids dimmed, and marks for monsters, objects and traps.

It is a sample, not a way to play. Everything below the map — messages, the
sidebar, every menu — is still the game's own screen.

## Try it

Copy this folder into your mods folder, keeping the folder name
`blueprint-view` — a mod folder must be named for the `id` in its manifest, and
the game refuses it outright otherwise (`manifest says id "…"; rename the folder
to match`):

- **Desktop:** `neo-angband-data/mods/` beside the game.
- **Browser (Chrome/Edge):** the folder you picked with *Choose a mods folder…*
  on the Mods screen.

Start the game, open **Mods**, enable **Blueprint View**, and approve the
`display:replace` capability when asked — it is the one that says *"Draw the
dungeon itself"*. Answer **Reload now to apply** when the manager offers, and
the blueprint is drawing by the time the character is back on screen.

## The three things it demonstrates

**1. It reads the semantic layers, not the glyphs.** Every drawing decision
comes from `cell.visibility`, `cell.terrain.id` and `cell.overlays[].kind`.
Nothing reads `cell.visual`, which is the terminal's own projection. Parsing a
`#` back into "wall" would have been shorter and would have demonstrated the
opposite of the point — a front end that has to reverse-engineer characters is
not free of the terminal.

**2. It resolves terrain by CODE, not by index.** `FEAT` is generated from
`list-terrain.h`, so a content pack that adds terrain moves every index after
its insertion point. A mod that had memorised `21` for granite would quietly
start drawing something else as wall. `ctx.core.FEAT.GRANITE` cannot.

**3. It declines instead of throwing.** With no DOM there is nothing to draw
on, so `frontend()` returns `undefined` and the game's renderer keeps the slot.
A throwing factory would also lose the slot, but would be *reported as this
mod's fault* — and "there is no document here" is not a fault.

## Two things about the seam, stated because they surprised us

**The first frame is always the game's.** The host installs front ends during
the mod boot, which happens after the first `render()`. A front end must
tolerate starting on a later repaint rather than assuming it owns frame one.

**It owns the window, not a rectangle.** The seam hands a front end the
`WorldFrame` and no way to learn where the map's pixels are — cell size, the
letterbox offset and the grid dimensions are private to the terminal, and no
`ctx` member exposes them. Drawing *inside* the terminal's map rectangle would
mean guessing it, so this covers the window instead.

**And that costs you the rest of the game.** Running it in the installed build
showed what the gap actually means: core does its half correctly — it stops
drawing the map and keeps drawing the sidebar, the status line and every menu —
but this canvas is opaque and covers the lot. With it on you cannot read your
hit points, see a message, or open the Mods screen to turn it off again. So
treat it as a demonstration, not a way to play, and expect to disable it by
editing the enabled set rather than through a menu you can no longer see. The
missing viewport geometry is recorded in `docs/modding/MOD_REACH.md` under
gap 9; until it lands, every front end has this problem.

## Where the checks are

`packages/web/src/sample-blueprint.node.test.ts` loads **this folder** by path,
validates the manifest, puts the plugin through the real front-end selection
against core as candidate zero, and records every canvas call it makes for one
`WorldFrame` built by the same producer `render()` uses. If the frame's shape
moves, that test fails rather than this sample rotting quietly.
