# Blueprint View — a worked front-end mod

A complete, runnable example of `ModPlugin.frontend`: it takes the dungeon
display away from the game's glyph terminal and draws a drafting-table
blueprint instead — walls as strokes, known floor as hatch,
remembered-but-unseen grids dimmed, and marks for monsters, objects and traps.

It draws inside the map rectangle the host publishes on every frame, so
everything around it — the message row, the sidebar, the status line, every
menu — is still the game's own screen and still readable with the mod on.

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

## The four things it demonstrates

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

**4. It draws in its region, not over the window.** Every frame carries
`frame.regions` — the named parts of the screen (`map`, `sidebar`, `messages`,
`status`) in both grid cells and CSS pixels. This canvas is positioned on
`regions.map.pixels` and re-positioned from every frame, so it follows a window
resize and a sidebar-mode change without listening for either. Everything
outside that rectangle is still core's, and still readable.

## Two things about the seam, stated because they surprised us

**The first frame is always the game's.** The host installs front ends during
the mod boot, which happens after the first `render()`. A front end must
tolerate starting on a later repaint rather than assuming it owns frame one.

**No region means draw nothing.** `regions` is optional on the frame, because a
host with no fitted surface has no geometry to give. This sample hides its
canvas in that case rather than falling back to the window — and that is not
politeness. Covering the window costs you the rest of the game: core does its
half correctly, stopping at the map and still drawing the sidebar, the status
line and every menu, but an opaque canvas over the lot means you cannot read
your hit points, see a message, or reach the Mods screen to turn the mod off
again. That is what this sample did before `regions` existed, and what any front
end that ignores them still does.

A front end is *allowed* to cover the window — an isometric or 3D view may well
want to, and nothing here prevents it. What the regions change is that it
becomes a decision taken knowing what is being covered.

**One thing is still wrong, and it is not this sample's.** A full-screen
overlay — the game menu, the Mods screen, inventory, the character sheet — is
painted across the whole terminal, *including* the map region a front end
legitimately holds. So with this mod on, those screens are clipped where its
canvas sits: legible and usable (you can reach Mods and turn it off, which is
the part that used to be impossible), but half of each row is behind the
blueprint. Both sides are doing the right thing; what is missing is that a full
screen has no region of its own. That is `MOD_REACH.md` gap 21, the UI seam.

## Where the checks are

`packages/web/src/sample-blueprint.node.test.ts` loads **this folder** by path,
validates the manifest, puts the plugin through the real front-end selection
against core as candidate zero, and records every canvas call it makes for one
`WorldFrame` built by the same producer `render()` uses. If the frame's shape
moves, that test fails rather than this sample rotting quietly.
