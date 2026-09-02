# Command Dial

A worked example of `ModPlugin.menu`: the game menu drawn as a radial dial of
wedges instead of a lettered list, and resolved by naming a choice.

Its sibling samples reimagine things that are **drawn**: `blueprint-view` takes
the map, `vitals-panel` takes one HUD region. This one takes something that is
**asked**, which is a different kind of seam: a menu has an answer, so taking a
question means taking its input too.

## Try it

Copy this folder into your `data/mods/` folder, enable it in the mod
manager (it asks for one capability, `ui:menu.replace`), reload, and press `Esc`
in game.

## Menu presenter behavior

- `menu(ctx)` returns a presenter, and one presenter is offered *every* menu
  the game asks.
- It takes one question and declines the rest. `ask` returns `undefined` for
  every menu id but `core:game-menu`, so the inventory picker, the spell list,
  the mod manager and the birth screens are all still the game's own, and still
  work. That is the seam working, not a limitation: a dial is a good shape for
  six verbs and a terrible one for a thirty-mod list.
- It answers with a choice's stable `id`, never an index. A dial's order is
  its own; the game maps the id back to its own row.
- It reads meaning from `choice.semantic`, not from the label. The wedge for
  quitting is coloured from `semantic.ref === "quit"`, so it stays right in a
  translated build and after a `registry:menu` transformer renames the row.
- It handles its own input. When a presenter takes a question the host does
  not attach the menu's keydown listener at all, so there is nothing to fight
  with. That is what "taking a question means taking its input" buys.

## Three things about this seam that surprise people

Declining is normal. It is not a failure path and it costs nothing: the game
asks the question its own way, you drew nothing, and there is no surface left
half-owned. Take the screens you have a better idea for.

One grant covers every menu. There is no `ui:menu.core:spell-book.replace`;
~50 capability strings would be a consent list nobody could read. The player
consents to your presenter being *offered* all of them; which ones you actually
take is your choice, made per question.

Throwing costs you the seam, not one menu. Unlike `hud`, where a fault costs
one region, a presenter that throws is out for the rest of the session on every
menu. A presenter that throws on one question generally throws on all of them,
and a fault report every time the player opens anything is worse than one report
and out. This sample declines to answer with a disabled choice for the same
reason: the host would catch it, and a sample is what people copy.

## What this seam cannot do yet

A menu has no published region. `regions.ts` names the four parts of the
screen that *tile* it: messages, sidebar, map, status, and a dial floating over
a still-visible dungeon is by definition one that **overlaps**. So this sample
positions itself over the whole window and reads `question.style` to know whether
the game would have cleared the screen. Overlapping, ordered, mod-created,
transparent regions are the next increment of `MOD_REACH.md` gap 21, and the
Secret-of-Mana dial over a live map needs them.

The full screens are still `ScreenLine[]`. Inventory, the character sheet, the
knowledge browser and the rest answer with styled text on a grid, so there is no
model behind them for a different presentation to consume. That is the same gap's
biggest remaining piece.

## Where the checks are

`packages/web/src/sample-dial.node.test.ts` loads **this folder** by path,
validates the manifest, puts the plugin through the real menu install, and drives
it through the real `selectFromMenu`, including pressing keys at this mod's own
listener and asserting the index the caller gets back. It also asserts against
the source that the dial answers by `id` and reads `semantic.ref`, because a
sample that matched on the English word "Quit" would draw a correct-looking dial
and prove the opposite of the point.
