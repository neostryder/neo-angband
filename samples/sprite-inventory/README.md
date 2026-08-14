# Sprite Inventory

A worked example of `ModPlugin.screen`: the inventory, equipment and quiver drawn
as a grid of item cards instead of a lettered list, built from the screen's
**rows** rather than from its rendered text — and the recall pages laid out into
a panel of the mod's own width, built from the screen's **paragraphs** rather
than from the rows the terminal would have cut them into.

Its three siblings reimagine the map (`blueprint-view`), one HUD region
(`vitals-panel`) and one menu (`command-dial`). This one reimagines the *content*
of a full screen — the thing none of the other three could reach.

## Try it

Copy this folder into your `neo-angband-data/mods/` folder, enable it in the mod
manager (it asks for one capability, `ui:screen.replace`), reload, and press `i`,
`e` or `|` in game.

## What it demonstrates

- **A list is a table, not text.** The card reads `row.cells.name.text`, addressed
  by column key. Before this seam existed the inventory arrived as
  `"a) a Potion of Cure Light Wounds       4.0 lb"` and a mod would have had to
  parse a name and a weight back out of a padded field — and break the day a pref
  file changed a colour or a translation changed a width.
- **The numbers are published beside the text.** `cells.weight.values.total` is
  the stack weight in tenths of a pound, the figure the column was formatted
  from, so the card prints `0.4 lb` its own way and could sort by it. Check
  `row.values` too: the quiver has no weight *column* (upstream's listing shows
  none) and publishes the number on the row instead, so a presenter that only
  read cells would lose the weight on the one screen a card grid most improves.
- **A row means something.** An empty equipment slot is `{kind: "slot"}` rather
  than an item, so it is drawn as an outline instead of as gear. Filled rows
  carry `{kind: "item", ref: <handle>}` — the *same* identity a pack picker's
  choices carry, so an item is one thing to you whether the game is listing it or
  asking you to pick one.
- **Prose is a paragraph, not a row.** The recall pages arrive as a `text` block
  whose paragraphs are unwrapped, so the card panel wraps them by **measuring**
  them at 360px — a width the game never chose and could not have pre-wrapped
  for. A `lines` block is already broken at 79 characters; re-flowing that means
  undoing the game's wrap and guessing which breaks were the game's.
- **Art and the writing on it are separate.** The tombstone arrives as an `art`
  block whose `lines` are the picture and whose `fields` are the epitaph — name,
  class, `level.values.level`, `gold.values.gold`, the killing blow. Upstream
  burns those into columns 8–39 of the ASCII stone; this sample draws its own
  stone, writes the character onto it, and never reads `lines` at all.
- **A number can be drawn as a shape.** The character sheet's stat rows publish
  `cells.eb.values.bonus` as an integer, so the card panel draws the equipment
  bonus as a **bar as long as the bonus**. There is no way to get that from
  `"STR!  18/100  +1  +0  +2"` — which is the whole argument for `values` in one
  picture. On the flag page the *columns* are the equipment slots and each
  carries the worn item's glyph in `column.glyph`, so the header of that grid is
  gear.
- **A screen can be acted on, and the game still does the acting.** The sheet
  publishes `view.actions` — rename, dump, page forward, page back — and `show`
  is handed a `host`. Pressing one of their keys calls `host.invoke(id)`, so the
  rename opens the *game's* prompt and the dump writes the *game's* file, and
  the promise hands back the view the player should see next. A presenter that
  took the sheet without this would have quietly taken three commands away.
- **A model with a small vocabulary pays off later.** The knowledge browser's
  seven recall pages — rune, feature, trap, shape, artifact, ego, object-kind —
  reach the same prose panel as the inspect pages, and *nothing in the panel
  changed to take them*. Adding them was seven strings in a list, because a
  `text` block is a `text` block whatever screen produced it.
- **It takes sixteen screens and declines the rest.** The help pages, the monster
  list and the message history are still the game's own — and still work.
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

**The listings, the recall pages, the death screens, the character sheet and the
knowledge browser's recalls have given up their models; the rest have not.**
`MODELLED_SCREENS` in `packages/web/src/screen-view.ts` names the twenty:
inventory, equipment, quiver, object list, message history, player history,
object recall, object comparison, monster recall, tombstone, winner, the
character sheet's two pages, and the knowledge browser's seven recalls (rune,
feature, trap, shape, artifact, ego, object-kind). Everything else arrives under
the shared id `core:text` with a single `lines` block of pre-wrapped rows —
enough to reskin a frame, not enough to reimagine a listing. The help pages, the
monster list and the spell lists are the same gap's biggest remaining piece.

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

For the prose panel the check is a comparison rather than a source scan: the same
`objectRecallScreen` view is laid out by the sample and by `screenBodyLines` at
80 columns, and the sample's narrower panel has to produce **more** rows. A
presenter that had quietly reused the game's own wrap could not.

For the tombstone the check is what did **not** reach the canvas: the sample
draws `"Frodo"`, and not one of the `art` block's own ASCII rows appears among
the strings it drew. The rows are taken from the block under test rather than
from a guess at what the stone looks like, so redrawing the art cannot quietly
retire the assertion.

For the character sheet the check is in `packages/web/src/charsheet.test.ts`,
because that is where a real `GameState` lives: it loads **this folder** by path,
drives the real `showCharacterSheet` through the real seam, and asserts that not
one *composite* row the faithful terminal would have produced — a label joined to
its value, or a padded multi-field line — reached the canvas. Then it presses
`h` and checks that the page moved **through the host** rather than by the mod
deciding for itself what page two is.
