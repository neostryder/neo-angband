# Sprite Inventory

A worked example of `ModPlugin.screen`: the inventory, equipment and quiver drawn
as a grid of item cards instead of a lettered list, built from the screen's
**rows** rather than from its rendered text; the recall pages laid out into a
panel of the mod's own width, built from the screen's **paragraphs** rather than
from the rows the terminal would have cut them into; and the symbol legend drawn
from the screen's **glyphs**, one character to a cell, which is the key a tileset
mod already looks its sprites up by.

Its three siblings reimagine the map (`blueprint-view`), one HUD region
(`vitals-panel`) and one menu (`command-dial`). This one reimagines the *content*
of a full screen — the thing none of the other three could reach.

## Try it

Copy this folder into your `neo-angband-data/mods/` folder, enable it in the mod
manager (it asks for one capability, `ui:screen.replace`), reload, and press `i`,
`e`, `|` or `?` in game.

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
  for. A `lines` block is already broken at the terminal's width; re-flowing that
  means undoing the game's wrap and guessing which breaks were the game's.
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
- **A vector is not a compass string.** The visible-monster list publishes
  `values.dy`/`values.dx`, so the card panel draws an **arrow** pointing at the
  monster and prints its range. There is no way to get an arrow out of
  `" 3 N 2 W"` without parsing a compass back into the numbers it was made from —
  and `values.asleep` is a count where the terminal has the sentence
  `"(2 asleep)"`. `semantic.data.name` carries the game's own pluralisation, so
  the card says "3 kobolds" without this mod reimplementing English.
- **A screen with one command is still a screen with a command.** The monster
  list publishes `sort-exp` (`x`) as an action; pressing it calls
  `host.invoke("sort-exp")` and the **game** re-sorts and hands back the new
  view. A presenter that drew this list without it would silently take the
  sort toggle away.
- **A glyph is a sprite key, not a letter.** The symbol legend publishes
  `cells.glyph.text` as a *single character* — the same key a tileset mod already
  indexes its atlas by to draw that symbol on the map. So the legend can show the
  player the art they will actually meet in the dungeon instead of a page of
  ASCII. This sample ships no art, so it prints the lookup key (`U+006B` for
  `k`); a mod with a tileset changes one line and draws the kobold. The commands
  page is the same shape with `cells.key`, which is a keycap where the terminal
  has a field padded eleven wide.
- **The same page can be modelled in one half and finished in the other.** The
  symbols page's four glyph tables gave up their model; its opening paragraphs
  did not, and stayed on `lines` — upstream hand-wrapped `symbols.txt` and the
  port prints it verbatim, so unwrapping that prose would move every line break
  on a page parity pins byte for byte. This sample skips those rows, which is
  exactly what a `lines` block means: there is nothing there to reimagine.
- **It takes twenty-one screens and declines the rest.** The message history is
  still the game's own — and still works.
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

**The listings, the recall pages, the death screens, the character sheet, the
knowledge browser's recalls and the help pages have given up their models; the
rest have not.** `MODELLED_SCREENS` in `packages/web/src/screen-view.ts` names
the thirty-seven, and everything else arrives under the shared id `core:text`
with a single `lines` block of pre-wrapped rows — enough to reskin a frame, not
enough to reimagine a listing. The spell lists are the same gap's biggest
remaining piece.

A help page a **mod** supplies arrives under `core:text` too, and that is the
answer rather than an omission. What a mod hands in is a `.txt` split on
newlines: rows it wrapped itself, with no columns to address and no glyph or key
to publish. Giving it `core:help-symbols` would promise this sample a legend and
then hand it pre-wrapped prose, and a mod drawing sprites would render an empty
page with no way to tell why. A mod that wants its own page reimagined has the
better route already — its own `screen` presenter, which sees every view.

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

For the monster list the check is in `packages/web/src/screens.test.ts`, because
that is where a real `GameState` with real monsters lives: it loads **this
folder** by path, drives the real `showMonsterList` through the real seam, and
asserts that `"↘ 3"` reached the canvas — a string the game never produces, and
one this sample could only have drawn from `values.dy`/`values.dx`. Then it
presses `x` and checks the footer changed, so the sort moved **through the host**
rather than by the mod deciding for itself what "by experience" means.

For the help pages the checks are in `packages/web/src/help.test.ts`, because
those pages need no game state at all. Two of them assert a string the game
**never writes**: `"U+006B"`, the codepoint of the kobold's glyph cell, which
nothing but a one-character cell could have produced; and `"Monsters · 52"`, a
row count the terminal cannot show because it never computed one — its caption is
`"Monsters"` and nothing more. Both are checked against `screenBodyLines`' own
output first, so "the game also prints it" is ruled out rather than assumed. The
third is the recall pages' comparison again: the playing guide is laid out by the
sample and by `screenBodyLines` at 80 columns, and the narrower panel has to
produce more rows.

For the character sheet the check is in `packages/web/src/charsheet.test.ts`,
because that is where a real `GameState` lives: it loads **this folder** by path,
drives the real `showCharacterSheet` through the real seam, and asserts that not
one *composite* row the faithful terminal would have produced — a label joined to
its value, or a padded multi-field line — reached the canvas. Then it presses
`h` and checks that the page moved **through the host** rather than by the mod
deciding for itself what page two is.
