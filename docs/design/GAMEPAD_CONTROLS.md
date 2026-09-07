# Controller input (#65)

## Scope and acceptance

The contract is the same 84-entry
[keyboard inventory](TOUCH_COMMAND_INVENTORY.md) the touch scheme was built
against. A player holding only a controller must be able to create a character,
explore, fight, cast, shop, browse information, configure the game and save,
with no keyboard and no pointer. Movement is the easy part. The hard parts are
the three the inventory calls out: supplying one of eight directions, choosing a
target on the map, and picking from a list that can run to dozens of rows.

This document describes the whole scheme and marks the part of it that is built.

## The shared prompt surface generalises, with one gap that had to be closed

The touch increment left `controlSurface` behind: a stack of prompt contexts,
each with a kind, a label, selectable rows, explicit replies and a token that
makes a stale answer fail. It also left `controlKey`, which puts one literal
reply through the input door with player keymaps bypassed. Both carry over
without change in shape, and the reasons are structural rather than incidental.

- The stack follows the real question. A cast is a book, then a spell, then
  possibly an aim, then possibly a target, and each stage pushes its own context
  as the command implementation reaches it. An adapter that answers whatever is
  on top is correct for every command without knowing any of them.
- The token makes a slow input safe. A controller repeat can fire between two
  frames of a prompt closing and its parent being restored, and an answer
  carrying the old token is refused rather than applied to the next question.
- `canCommand` is a live readiness guard, so a pad cannot start a command inside
  a prompt or while the game is busy.
- Replies are the prompt's own actions. Invoking one runs the code the keyboard
  would have run, so inscription checks, disabled rows, quantities and
  cancellation costs stay where they already are.

One thing did not generalise, and forcing it would have been the wrong result.
An action's MEANING was recoverable only by parsing its id back into the key it
wraps: the touch sheet found its compass by reading `Number(id.replace("key:",
""))`. A touchscreen can afford that, because it renders a labelled button and
the player reads which one is Cancel. A controller cannot: it has to know which
reply a stick pushed north-east answers, and which reply the Cancel button
answers, before it can route anything at all, and a second adapter reversing the
same string would have been a second definition of the same fact.

`ControlAction` therefore carries `direction` and `role`. A direction and a
Cancel are derived by the helper that already knows the key, so no caller
changed. `accept`, `next` and `previous` are stated by the caller, because the
key cannot settle them: `t` accepts a target inside the target loop and takes off
a ring at the game screen. The touch sheet now reads `action.direction` instead
of parsing, so the change removed a definition rather than adding one.

`ControlCommand` gained `key`, the command's original-keyset key, used as a
stable NAME. A saved binding has to survive the roguelike-keyset option being
turned on, and the row's own ordinal is an upstream table position that means
nothing on a mapping screen.

Two further limits are worth stating plainly rather than discovering later.
Rows cannot be traversed without choosing one, because a row's action IS its
selection, so cursor movement is arrow keys through the input door and rows are
read as labels. And a text context assumes a device that can type. Its
`submit(value)` takes a whole string, so it is device-neutral enough for a
controller to satisfy, but the scheme that produces the string is the
controller's own problem and is not yet built.

## What the scheme borrows, and from where

Every shipped controller port of a command-heavy game solves the same problem
the same way, and none of them solves it by mapping commands to buttons.

- A small always-on set of the highest-frequency verbs, plus a trigger-gated or
  shoulder-gated radial for everything else, is the shape Divinity: Original
  Sin 2, Baldur's Gate 3, Diablo 3 and Diablo 4 all converged on. Baldur's Gate
  3 removes the keyboard hotbar entirely on a controller rather than emulating
  it. The failure mode players report is not the wheel; it is chaining a wheel
  into a submenu into a list, which is why the wheel here is two levels and
  pages rather than nesting a third time.
- Caves of Qud, the closest existing case, uses a trigger held as a modifier to
  double the number of reachable buttons. That is exactly the second layer
  below.
- Pie menus were measured against linear menus at eight items, and came out
  faster with fewer errors, because every wedge is the same distance from the
  centre. Hierarchic marking menus were measured again for depth: eight items
  per level holds under a ten percent error rate to two levels and not beyond.
  Eight wedges and one level of nesting is therefore a measured ceiling rather
  than a taste, and a category with more than eight commands pages instead of
  subdividing.
- Confirm on the bottom face button and cancel on the right face button is the
  arrangement a player arrives with. It is also the arrangement on every family
  once the labels are ignored: index 0 is the bottom button everywhere, and
  Nintendo prints B on it while Xbox prints A. The PlayStation regional
  reversal, where Circle confirmed in Japan, ended with the PlayStation 5 in
  2020, so there is one convention to follow rather than two. Labels come from
  the detected family; the layout does not.
- The one existing discussion of playing Angband on a pad concluded that key
  remapping alone cannot get there, because the game has separate commands for
  wands, staves, rods, scrolls, potions and activations. That conclusion is
  accepted and the answer is the wheel: the port adds nothing to the game's
  rules, so those commands stay separate and the controller reaches them through
  a surface rather than through consolidation.

## What the pad actually reports

Nothing here assumes a model of controller. The Gamepad API's `"standard"`
mapping is a claim about button INDICES, not a guarantee that the device has
them, and browsers disagree in ways that would break a per-model table:

- The same Xbox pad has been reported as 17 buttons and 4 axes by one browser
  and 11 buttons and 8 axes by another on a different operating system.
- A pad the browser cannot fit to the standard mapping still exposes usable
  buttons and axes, and may report its cross as a ninth AXIS rather than as four
  buttons.
- Steam Input re-presents every pad it handles under Valve's own vendor id, so
  the id string can describe hardware the player is not holding.

So capabilities are counted from the live sample: how many buttons, how many
axes, does the browser claim the standard arrangement. The device family is used
only to LABEL a button, never to assume one exists. A legend that says "press A"
on a pad whose index 0 is marked B is worse than no legend, and a LAYOUT guessed
from a rebranded id would be a pad that does the wrong thing.

Saved bindings are keyed on family, standard-or-not, and the two counts, rather
than on the id text, because the same physical pad produces different id text in
different browsers and keying on it would silently lose a player's mapping when
they opened the game somewhere else.

## Defaults, derived rather than tabulated

Defaults are computed from the counted capabilities. A pad with everything gets
a full layout; a pad with four buttons gets a playable one; neither is a special
case in a table.

| Standard index | Default | With the layer held |
| --- | --- | --- |
| 0 bottom face | Confirm | Cast a spell |
| 1 right face | Cancel or go back | Quaff a potion |
| 2 left face | Pick up objects | Read a scroll |
| 3 top face | Fire at nearest target | Throw an item |
| 4 left shoulder | Previous page or list | Go up staircase |
| 5 right shoulder | Next page or list | Go down staircase |
| 6 left trigger | Hold for second layer | |
| 7 right trigger | Command wheel | |
| 8 view | Controller legend and mapping | Character description |
| 9 menu | Escape, which opens the game menu | Rest for a while |
| 10 left stick click | Stand still | Display inventory listing |
| 11 right stick click | Look around | Display equipment listing |
| 12-15 | Cross, resolved as a direction | |

Shoulders page and triggers hold, which is the split a player already has. A pad
with shoulders but no triggers puts the wheel and the layer on the two remaining
face buttons. A pad with four buttons and nothing else gets Confirm, Cancel, the
wheel and the layer, and reaches every one of the 84 entries through the wheel.
A pad with three drops the layer rather than an essential role, because the
wheel is what makes the rest of the game reachable at all. No branch ever binds
a button the pad did not report.

## Directions

An analog stick answers a question with nine possible answers, so the resolution
is angular and the magnitude only decides whether the player meant it.

- **Scaled radial dead zone.** The magnitude of the vector is tested, not each
  axis on its own. An axial dead zone is what makes a cheap pad snap to the
  cardinals: at a 0.3 threshold a stick held exactly north-east at 40 percent
  deflection has both axes below it and reads as centred. What is left above the
  threshold is rescaled back into a full 0-to-1 range so the first movement past
  it is not a jump, and an outer edge below 1 saturates early because worn
  sticks do not reach the corners.
- **Eight capture sectors.** The angle falls into one of eight wedges centred on
  the compass directions. The wedge belonging to the direction ALREADY held is
  widened by twelve degrees, so a stick resting near a boundary does not
  alternate between two neighbours while the player watches the character refuse
  to commit. A deliberate turn crosses the whole widened wedge in one motion and
  costs nothing.
- **A lower release threshold than engage threshold.** The same reasoning
  applied to length instead of angle. Engaging is harder than staying engaged,
  which is the way round that cannot produce a step nobody asked for.
- **A new direction has to survive a second sample.** A released stick springs
  past centre and reports the opposite direction for a frame or two. One frame
  of latency is not perceptible; a step in the wrong direction in a game where a
  step can be fatal is.
- **Repeat is 250 ms then 120 ms.** The desktop text-typing default of half a
  second reads as hesitation on a stick, and the figures games use are shorter.
  This sits at the slow end of that range because a repeat here is a game turn.
- **A cross is read as a vector, not as four keys.** Holding two of its buttons
  gives a diagonal through the same resolver. A roguelike without diagonals is a
  different game.

## Where a direction goes

The four prompt shapes want different things from a stick, and only the shape
decides.

| Context | Direction | Confirm | Cancel | Shoulders |
| --- | --- | --- | --- | --- |
| Game screen | One step | Enter, which opens the command browser | Escape, which opens the game menu | Page keys |
| Direction or aim | Invokes that direction's own reply | Enter | The prompt's Cancel | Page keys |
| Target | Invokes that direction's own reply | Select target | The prompt's Cancel | Previous and next interesting target |
| Item or menu | Cardinals move the cursor; diagonals are dropped | Enter | The prompt's Cancel | Previous and next item source |
| Text | Nothing; the text prompt owns its caret | Enter | The prompt's Cancel | Page keys |

Confirm is Enter unless the prompt names its own accepting reply. The target
loop is why: Enter does not take a target there, so a pad that only knew about
Enter could aim at a monster and never fire. Confirm is deliberately NOT a
synonym for Yes on a confirmation, because the keyboard's Enter is not one
either, and a controller changes how a command is issued rather than what it
does.

A diagonal is dropped in a list rather than rounded to a cardinal, because the
player did not ask for the cardinal.

## The command wheel

One button, two meanings, decided by what is on screen.

With no prompt open it is the command catalogue: a ring of eight groups, then a
ring of that group's commands, taken from the same registry the keyboard and the
command browser use. Selecting one calls the existing confirmed-command route,
so a mod that adds a command gains a controller route without anything here
knowing about it.

With a prompt open the catalogue is unreachable anyway, because the shell will
not start a command inside a prompt. So the same button shows THAT PROMPT'S
replies instead, minus the directions the stick is already pointing at. That is
what closes the completeness argument: Choose target and Closest at an aim
prompt, Free cursor and Recall in the target loop, the item sources, Yes and No
are all reachable from a pad with four buttons.

Selection is point-then-press, not release-to-select. Both exist in shipped
software, but they do not compose: with release-to-select there is no gesture
left for abandoning the wheel, because letting go is how a player abandons one.

A wedge is placed by its angle rather than laid out in a grid, because the
measured advantage of a radial is that every choice is the same distance from
the centre, and that only holds if the position comes from the angle.

### What the first ring holds, and why

The first ring is not the command table's own grouping. `ui-game.c`'s lists -
Items, Action commands, Port, Manage items, Information, Utility, Hidden,
System - are the right shape for a keyboard help screen and the wrong shape for
a pad. Port is two rows and was taking an eighth of the ring; Hidden is
upstream's drawer for Version info and a pref-file line and was taking another;
Cast a spell sat twelve rows deep inside Information, behind Browse.

The split is by how often a hand reaches for a command during play. Seven groups
hold the fifty commands a character uses constantly, and the eighth is More.

| Group | Holds | Commands |
| --- | --- | --- |
| Use | Quaff, Read, Eat, Aim, Zap, Staff, Activate, Use | 8 |
| Magic | Cast, Browse, Study, Abilities | 4 |
| Fight | Fire, Nearest, Throw, Target, Closest, Look, Steal | 7 |
| Gear | Wear, Remove, Swap, Examine, Fuel, Inventory, Equipment, Quiver | 8 |
| Travel | Up, Down, Rest, Run, Explore, Walk, Stand, Repeat | 8 |
| Carry | Pickup, Drop, Ignore, Ignoring, Inscribe, Uninscribe, Autopickup | 7 |
| Map | Map, Monsters, Objects, Locate, Center, Symbol, Character, Knowledge | 8 |
| More | every command the seven do not claim, 25 of them, paged | 25 |

Promoted out of a category and onto the first ring: Cast, Browse, Study and
Abilities, which were behind Information; Rest, the stairs, Look and the two
targeting commands, which were inside a thirteen-row Action commands list; the
three item listings and Pick up, which were inside Manage items; the map, the
two visible-thing lists, Locate, Identify symbol, Character and Knowledge, which
were the back half of Information; Swap weapon, which was the whole of Port; and
Walk, Run, Stand, Explore, Repeat, Steal, Center map and Autopickup, which were
scattered across Hidden and System.

Demoted to More: the grid verbs - Disarm, Tunnel, Open, Close and Walk into a
trap - because 4.2's own movement opens a door, disarms a trap and handles the
hazard check when a character walks into one, so a pad reaches for them rarely;
and the whole of the save, quit, options, notes, version, pref-line, debug and
Borg tail, which a character touches a handful of times in a life.

More is a COMPLEMENT rather than a list. Anything the seven groups do not claim
is on it, in the order the command surface reports it, so a command added by a
mod, by a player keymap or by a later version of the table is reachable the
moment it exists and cannot be dropped by editing the split. Two levels still,
never three: More pages rather than reopening the old category tier.

### Icon first, one word beneath

Every item on every ring is a picture with a single word under it, and no item
is text-only. The word is the wedge's label; the hub carries the item's name in
full, so a wedge reading Nearest sits under a hub reading Fire at nearest
target. A name that will not reduce to one word is the signal that the command
belongs on the second level, and each of those is in More.

The icons are drawn rather than cut from a tileset, and the survey that settled
that is worth recording. Shockbolt's 64x64 sheet is the richest art the game
ships and it was checked first: it carries a true, recognisable picture for the
object NOUNS - potion, scroll, wand, staff, rod, food, mushroom, spell book,
sword, dagger, bow, arrow, armour, helm, boots, shield, cloak, gloves, ring,
amulet, lantern, torch, flask, pick, shovel, chest, gold and the item pile - and
map cells for stairs, doors and rubble. It carries nothing for the verbs and the
interface concepts, which are most of what a wheel is made of: look, target,
rest, run, explore, repeat, inscribe, ignore, drop, examine, locate, recentre,
options, help, save, messages, redraw, character and knowledge. About twenty of
the fifty-eight slots have a tile and the rest do not, and a ring that is one
third painted portraiture and two thirds flat marks reads as two designs rather
than one.

Three further facts pointed the same way. The wheel has to look the same for a
player rendering in ASCII, and the sheet is a 17.5 MB download fetched only when
that graphics mode is selected. The sheet's terms withhold permission to modify
it, and `packages/web/public/tiles/CREDITS.md` records that this repository
holds the sheets while the cut-up, per-tile form belongs to the linoleum mod, so
crops and downscales baked into the game's own furniture would cross a boundary
already written down. And a mark that stays readable at 30 pixels over an
arbitrary background wants a heavy silhouette and two flat tones, which is the
opposite of a painted 64 pixel render. The drawn set therefore models its
silhouettes on Angband's own objects without using the art.

### Legibility with nothing behind it

The wheel has no panel. Wedges draw straight onto the live canvas, so the ground
under them is a black corridor one moment and a torch-lit stone floor the next.
Four things carry legibility in a panel's place, each doing a different job.

- Every wedge is its own plate, sized to its art rather than to the ring, so the
  covered area is a fraction of what a full disc covered.
- Each plate carries a double edge: a pale inner border and a black outer ring.
  One of the two always separates the plate from the background, because no
  dungeon colour is both light and dark.
- Icons are two flat tones with no stroke thinner than 1.6 of their 24 unit box,
  which is the width that survives being drawn at 30 pixels over texture.
- The word under the icon carries its own dark halo, so it holds where the plate
  is at its most translucent.

## The mapping screen

Reached from its own button, and from the legend the connection notice points
at. It lists every button the pad actually reported, named as it is printed on
that family of device, with its base binding and its layer binding. A binding is
a role, a command, or nothing. Pressing a button on the pad highlights its row,
so a player does not have to match an index number to a thumb; the press that
does the highlighting is swallowed, so finding the Cancel button does not also
cancel the screen.

A role moves rather than duplicating: two buttons that both claim to be Cancel
is a pad with no Cancel a player can predict. A command may repeat, because
binding the same command twice is a choice somebody might make.

Saved bindings are merged over the pad's current defaults rather than replacing
them, so a player who remapped two buttons and later plays a build that gained a
role keeps their two changes and picks up a working default for the rest.

## Discovery

There is no button event. `gamepadconnected` says a pad exists and nothing else,
and its state must be read from a fresh snapshot every frame. A pad is also
invisible until the player presses something on it, which is a fingerprinting
defence rather than an oversight, so there is genuinely nothing to sample before
then.

That would make the connection event the whole lifecycle, except that it has
been reported as unreliable, and a controller that stays dead until the page is
reloaded is indistinguishable from no controller support. So the loop samples at
animation rate while a pad is present and falls back to a once-a-second check
when none is.

## Coverage against the inventory

Every entry has a route.

| Entries | Route |
| --- | --- |
| 1-16, 28, 30-34, 40 | The Use, Gear and Carry rings; the item prompt is answered by cursor and Confirm, with the shoulders switching source and the wheel offering the rest of its replies |
| 17-18, 22-27, 29, 61-66, 69-70, 75-76 | The stick and the cross walk and answer direction prompts; the Travel ring holds the rest and More holds the grid verbs; Rest's count uses the text answer |
| 19-21, 43, 67, 82 | The target loop, with the stick on the cursor, Confirm on Select target, the shoulders on previous and next, and the remaining target actions in the wheel |
| 35-38 | The Magic ring; book and spell lists are ordinary item prompts; effect prompts arrive as their own contexts |
| 39, 41-42, 44-50 | The Map ring, and More for Help and the message history, then the screen's own navigation through the cursor and page keys |
| 51-60 | More; Escape on the menu button reaches the game menu directly |
| 68, 71-72 | More, with their normal gates |
| 73-74 | Swap weapon is on the Gear ring; the remaining port command is in More |
| 77-78 | Confirm at the game screen opens the command browser; Cancel is the prompt's own; Stop is a bindable role |
| 79-80 | Count prefixes and the literal keymap bypass are keyboard-shell parity gaps, not controller work |
| 81, 83-84 | Menu and store navigation through the cursor, page keys and the replies wheel; text answers need the entry scheme below |

No entry depends on the split above being right. More is the complement of the
seven curated rings, so every command reaches a wedge whatever the split does,
and `gamepad-wheel-plan.test.ts` asserts that against the real command table
rather than against a fixture.

## First-increment browser measurements

Driven through the shipped adapter with synthesised pad samples, because a
browser reports no controller until a physical button is pressed on one.

An Xbox pad reporting 17 buttons and 4 axes was named correctly and announced
`RT opens the command wheel`. An earlier build named it R2: `Wireless
Controller` is the whole of the name a PlayStation 4 pad reports through some
drivers and is also a substring of `Xbox Wireless Controller`, so vendor id now
settles the family before any name is consulted.

Two samples of the left stick held east took one step, from x 42 to 43, turn 20
to 30. Eighteen further samples, 288 ms of holding, took exactly one more step
to x 44 and turn 40: one repeat past the 250 ms delay rather than a burst.
Holding the cross down and left together stepped south-west, which is the
diagonal a cross only reaches as a vector.

The wheel opened on a ring of the eight command-table categories the first
increment used: Items 16, Action commands 13, Port 2, Manage items 5,
Information 12, Utility 3, Hidden 13, System 11. That grouping is superseded by
the seven-plus-More split above. Pointing east selected the third wedge and
Confirm opened it. The Items ring
reported `Page 1 of 2`. Selecting Wear or wield opened the real item prompt,
Confirm took the row, and the torch was wielded with the turn advancing 40 to
50. Opening the wheel while that prompt was up showed the prompt's own replies,
`Inven` and `Cancel`, and closing it left the prompt untouched. In the target
loop the same button showed all eight target actions: Select target, Next,
Previous, Free cursor, Player, Interesting, Help, Cancel. A keyboard `9` moved
the free cursor to 1 north 1 east and the stick pushed north-east moved it to 2
north 2 east, which is the pad answering a target prompt exactly as the keyboard
does.

The mapping screen listed all 17 buttons with Xbox names and both layers.
Pressing RB while a capture was armed highlighted the RB row and did nothing
else. Rebinding it to Rest through its row took effect immediately, opened the
real rest prompt, and persisted under the signature `xbox/standard/17/4`.
Restoring defaults put it back. A row bound to a literal key rendered blank
before this pass added an option for a binding the list does not otherwise
offer; it now reads `Key Escape`.

Swapping to a pad reporting 4 buttons, 2 axes and no recognised layout produced
`Controller ready: 4 buttons, one stick, unrecognised layout. Button 3 opens the
command wheel`, and that pad's own third button opened the same wheel with the
same eight wedges.

At a 396-pixel ring the eight wedges measured 87 by up to 74 pixels with no pair
of wedges intersecting and none intersecting the hub. Those figures belong to
the text-wedge layout and are superseded below. The wheel is drawn over the live
canvas rather than replacing it.

## Second-increment browser measurements

The wheel redrawn icon-first, driven the same way, in a live game with Shockbolt
Light selected. This pass overrode `navigator.getGamepads` with a synthesised
pad rather than calling the diagnostic poll hook, so the shipped runtime's own
sampling loop drove every sample.

The first ring opened on Use, Magic, Fight, Gear, Travel, Carry, Map, More, and
reported no page counter, because the eight groups are exactly one ring. The
hub read `Commands` over the selected wedge's full name. Confirm on Use opened
Quaff, Read, Eat, Aim, Zap, Staff, Activate, Use, with the hub reading `Use` over
`Quaff a potion` - the one-word wedge and the full name at the same time. The
stick pushed north-west selected the eighth wedge, More, and Confirm opened it on
`Page 1 of 4`: Disarm, Tunnel, Open, Close, Trap, Options, Retire, Dump, then
Notes, Version, Pref, Alter, Stand, Debug, Borg, Help, then Save, Quit, Messages,
Previous, Feeling, Redraw, Wizard, Menu, then Browser. Twenty-five commands over
four pages, which is every command the seven curated rings do not claim.

Opening the wheel inside the target loop showed the prompt's own replies as
icons: Select, Next, Previous, Free, Player, Interesting, Help, Cancel, eight
wedges and eight drawn marks, with no reply left as bare text.

Geometry, measured from the live DOM at a 1280 by 820 viewport. The wheel's box
is 360 by 360 where it was up to 520 by 520, and the wedges occupy 351 by 354 of
it. A wedge is 77.4 by 77.4, or 83.6 with the selected wedge's scale applied. No
pair of wedges intersects and none intersects the hub, whose own box is 129.6 by
39.7. The icon draws at 33.4 pixels and the word at 11.2. The wheel's computed
`background-image` is `none`, its `background-color` is `rgba(0, 0, 0, 0)` and
its border width is 0: the filled panel is gone rather than merely dimmed.

Read over both extremes of background. In the town at midday, over lit stone
floor, shop entrances and townspeople, every plate and every word held. On a
dungeon level in an unlit corridor, over near-black, the pale plate border was
what separated the wedges from the ground. The same eight icons read in both.

## Built, and not yet built

Built: capability detection and naming, derived default layouts, saved bindings
merged over defaults, the dead zone and eight-way resolution with hysteresis and
repeat, cross and hat decoding, the sampling loop, the routing table above, the
command wheel with both its rings, and the mapping screen.

Not yet built, and required before the issue closes:

- **Text entry.** A controller cannot answer a name, an inscription, a note, a
  rest count or a search. Steering a cursor over an on-screen keyboard is the
  worst of the known options; the strongest is the daisy wheel, where the stick
  picks one of eight petals and a face button picks one of four characters
  within it, so any character is two actions rather than a dozen. That is the
  intended shape.
- **A legend on the game screen.** The connection notice names the wheel button
  once and then goes away. A persistent, dismissible legend is what makes the
  layout learnable.
- **Trigger axes.** A minority of pads report triggers as axes rather than as
  buttons. Those triggers are currently unreadable, which costs two inputs on
  those devices and nothing on the rest.
- **Rumble.** Available in Chromium, partial in Firefox, absent in Safari.
  Progressive enhancement at most, and never a channel that carries information
  nothing else carries.
- **The hat order.** Position zero is assumed to be north running clockwise,
  which is the conventional order but has not been confirmed against a physical
  pad. A player whose cross reads rotated has a working mapping screen.
- **Acceptance.** A full character played from birth to a death or a save, on a
  real controller, with the keyboard unplugged. Nothing short of that closes
  this.
