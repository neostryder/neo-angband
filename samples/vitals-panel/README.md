# Vitals Panel: a worked HUD mod

A complete, runnable example of `ModPlugin.hud`: it takes the **vitals** away
from the game's glyph terminal and draws them as a graphical panel instead:
each field labelled in its own typography, coloured through the mod's own
palette.

It takes **one region**. The message line, the status line, the map and every
menu are still the game's own screen, still being drawn, still readable. That is
the difference between this seam and `ModPlugin.frontend`: the map is one thing
with one owner, and the HUD is three things with three.

## Try it

Copy this folder into your mods folder, keeping the folder name `vitals-panel`:
a mod folder must be named for the `id` in its manifest, and the game refuses it
outright otherwise (`manifest says id "..."; rename the folder to match`):

- **Desktop:** `neo-angband-data/mods/` beside the game.
- **Browser (Chrome/Edge):** the folder picked with *Choose a mods folder...*
  on the Mods screen.

Start the game, open **Mods**, enable **Vitals Panel**, and approve the
`ui:sidebar.replace` capability when asked: it is the one that says *"Draw the
vitals panel - your hit points, food, armour and depth"*. Answer **Reload now to
apply**, and the panel is drawing by the time the character is back on screen.

## The four things it demonstrates

**1. It reads the field NAMES, not the printed text.** Every decision comes from
`entry.key`: `hp`, `sp`, `depth`, the engine's own `side_handlers[]` name minus
its `prt_` prefix. Matching on the string `"HP "` would have been shorter and
would have demonstrated the opposite of the point.

**2. It resolves colour by CODE, not by index.** `run.color` is the engine's
COLOUR_* attribute; this panel maps it through `ctx.core.COLOUR_L_GREEN` and
friends onto its own palette. It never reads `run.css`, which is the terminal's
resolved colour and would tie the panel to the terminal's palette, including
whatever a pref file did to it.

**3. It declines instead of throwing.** With no DOM there is nothing to draw on,
so `hud()` returns `undefined` and the game keeps the region. A throwing factory
would also lose the region, but would be *reported as this mod's fault*, and
"there is no document here" is not a fault.

**4. It draws in its region, not over the window.** The section carries
`region.pixels`: where the vitals are, in CSS pixels, and the canvas is
re-positioned from it on every frame, so it follows a window resize and a
sidebar-mode change without listening for either.

## Three things about the seam, stated because they were surprises

**The capability is the claim.** The host picks each region's owner from the
*manifests*, before it calls anybody's `hud()`, so a mod that loses does not get
constructed and cannot mount a canvas it will never draw into. Two consequences
follow. A sink for a region you did not ask for is dropped and reported. And a
region you *won* and then declined goes back to the game rather than to the next
claimant, so ask for the regions you actually draw.

**A fault costs you one region.** If this panel throws while drawing, the game
resumes drawing the vitals for the rest of the session and says so, by name. It
does not cost you the status line, and it does not cost the player their game.

**No vitals region means you are not called.** Under the *None* sidebar mode
(`=` → `(o)`) there is no vitals section at all, because the player turned the
furniture off. This sample does not put it back: that is a choice to respect,
not one to style.

## The bars, and the rule behind them

Hit points and spell points are drawn as proportional bars from `entry.values`:
`{ current: 7, max: 34 }`, and never from parsing `"HP   7/  34"`. That string is
a *rendering*: it changes when somebody loads a pref file, plays in another
language, or installs a content pack that widens a field.

The panel applies the general rule rather than a list of field names: **if an
entry has both `current` and `max`, it is a proportion and gets a bar; otherwise
draw the runs.** That is why a stat publishes `use` / `cur` / `max` instead. 118
is an encoding meaning 18/100, so a bar over it would report a maxed character as
15%. The loop asks for the pair, does not find it, and correctly draws text. A
panel written as `if (entry.key === "hp")` would pass a weaker test and would draw
nothing at all for a field a content pack adds.

Two details worth copying. The bar's colour still comes from `run.color`, because
the engine already decides that hit points go yellow below the warning line and
red below a tenth: re-deciding it here would disagree with the game the day the
player changes their `hitpoint_warn` option. And the fill is clamped: `chp > mhp`
is reachable for a moment after a big heal, and an unclamped bar would paint
outside its own region.

## Where the checks are

`packages/web/src/sample-vitals.node.test.ts` loads **this folder** by path,
validates the manifest, puts the plugin through the real HUD selection against
core as candidate zero, and records every canvas call it makes for one `HudFrame`
built by the same producer `render()` uses. If the frame's shape moves, that test
fails rather than this sample rotting quietly.
