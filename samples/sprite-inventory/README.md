# Sprite Inventory

A worked example of `ModPlugin.screen`: the inventory and equipment drawn as a
grid of item cards instead of a lettered list, built from the screen's **rows**
rather than from its rendered text.

Its three siblings reimagine the map (`blueprint-view`), one HUD region
(`vitals-panel`) and one menu (`command-dial`). This one reimagines the *content*
of a full screen — the thing none of the other three could reach.

## Try it

Copy this folder into your `neo-angband-data/mods/` folder, enable it in the mod
manager (it asks for one capability, `ui:screen.replace`), reload, and press `i`
or `e` in game.

## What it demonstrates

- **A list is a table, not text.** The card reads `row.cells.name.text`, addressed
  by column key. Before this seam existed the inventory arrived as
  `"a) a Potion of Cure Light Wounds       4.0 lb"` and a mod would have had to
  parse a name and a weight back out of a padded field — and break the day a pref
  file changed a colour or a translation changed a width.
- **The numbers are published beside the text.** `cells.weight.values.total` is
  the stack weight in tenths of a pound, the figure the column was formatted
  from, so the card prints `0.4 lb` its own way and could sort by it.
- **A row means something.** An empty equipment slot is `{kind: "slot"}` rather
  than an item, so it is drawn as an outline instead of as gear. Filled rows
  carry `{kind: "item", ref: <handle>}` — the *same* identity a pack picker's
  choices carry, so an item is one thing to you whether the game is listing it or
  asking you to pick one.
- **It takes two screens and declines the rest.** The character sheet, the
  knowledge browser, the message history and every prose page are still the
  game's own — and still work.
- **Colour survives the seam.** `row.color` is the object's own attr as CSS, so a
  card keeps whatever the player's pref file chose.

## Two things about this seam that surprise people

**A screen is dismissed, not answered.** `command-dial` declines a question by
resolving with `undefined`; here the promise means "the player closed it", so
there is no value left to decline with. `show` returns `undefined`
**synchronously** to decline and `{ dismissed }` to take it. Resolving
`dismissed` is the whole contract — a presenter that forgets is a game the player
cannot get back to.

**Throwing while a screen is open is survivable, but only just.** The host
catches it, reports your mod by name, drops the seam for the session, and shows
the screen itself — because a player left staring at a dead overlay has no way
out. That recovery exists so a bug is not a lost character; it is not a place to
be relaxed about.

## What this seam cannot do yet

**Only two screens have given up their models.** `MODELLED_SCREENS` in
`packages/web/src/screen-view.ts` names them. Everything else arrives under the
shared id `core:text` with a single `lines` block of pre-wrapped rows — enough to
reskin a frame, not enough to reimagine a listing. The character sheet, the
knowledge browser, the spell lists and the rest are the same gap's biggest
remaining piece.

**A screen has no published region.** It covers the window, because
overlapping, ordered, mod-created regions are still ahead in `MOD_REACH.md` gap
21. An inventory drawn as a panel beside a still-visible dungeon needs them.

## Where the checks are

`packages/web/src/sample-inventory.node.test.ts` loads **this folder** by path,
validates the manifest, puts the plugin through the real screen install, and
drives it through the real `showTextScreen` with a real `inventoryScreen` built
from a real game state — then presses a key and asserts the promise resolves. It
also asserts against the source that the sample reads `cells.name` and
`values.total` rather than slicing the rendered row, because a sample that parsed
the text would draw a correct-looking grid and prove the opposite of the point.
