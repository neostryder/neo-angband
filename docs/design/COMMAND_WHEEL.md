# The command wheel, and controller input (#65)

This file was `GAMEPAD_CONTROLS.md` while the wheel was a controller surface.
It is not one any more: the wheel is the command surface all three input
methods share, and a pad is one of the three. What is still controller-specific
is everything around it - what a pad reports, how a stick becomes a direction,
what each button does by default, and the screen that remaps them - and those
sections still say so.

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

One surface, three ways in, and the same wheel behind all of them. A pad opens
it with the button bound to `role:commands`, a mouse with a right-click, a
finger with a long press. Every one of them gets the same rings, the same
icons, the same words, the same hub and the same commit rule; a player who
learns the wheel on one device has learned it on the others.

Only the pointing differs, and the hardware settles that rather than the
design: a stick has an angle, so a direction names a wedge outright; a pointer
has a position, so crossing a wedge selects it. What is deliberately NOT
allowed to differ is when a choice is taken, which is the next section.

### Point, then commit, on every device

The rule is one sentence: pointing and committing are two separate acts, and
letting go is never one of them.

- **Pad.** The stick points and Confirm presses.
- **Mouse.** Moving over a wedge points and a left-click commits.
- **Touch.** The long press that opens the wheel points at nothing; the finger
  that opened it lifts without choosing anything, and a second tap on a wedge
  commits.

Touch is the device this costs something. Press, drag to a wedge and release is
the phone's natural radial idiom, and it is one continuous gesture where this
rule asks for two. It is refused because abandoning the wheel has to be
possible, and once a finger is down, letting go is the only gesture it has
left: a release that chose a wedge would leave no release that cancelled one.
The same non-composition is why the pad is point-then-press rather than
release-to-select, so the cost is paid once and paid identically everywhere
rather than each device drifting into its own model.

Abandoning is therefore its own act too, and each device has one that is not a
commit: Escape on the keyboard, Cancel on the pad, and on a pointer either the
opening gesture again, or a press anywhere that is not a wedge. The hub is that
press's most useful target, because the centre of a radial is where cancel
lives in every shipped one: pressing it backs out of a group's ring to the
eight groups and closes the wheel from the groups, which is exactly what the
pad's Cancel button does, through the same function.

An open wheel owns the pointer for the whole viewport rather than for its own
circle. The map is underneath it, so a click that missed a wedge would
otherwise walk the character while the wheel was still up.

### What a pointer gesture means, in one rule

A right-click and a stationary press held 450 ms are the same gesture on
different hardware, so they resolve the same way, in this order:

1. A region painted over the map owns the cells it drew, and the gesture is
   that region's.
2. A live map grid answers with upstream's own context menu for that grid
   (`textui_process_click`, through `routeContextClick`). It KEEPS the gesture.
3. Anything else opens the wheel: the sidebar, the message and status lines,
   the letterbox margins outside the grid, and the whole screen while a modal
   owns it, where the wheel shows that prompt's own replies.

Rule 2 is the one that had to be settled rather than assumed, because a long
press was already bound there by the touch increment and a right-click by the
port of upstream's mouse routing. The wheel does not replace that menu and does
not subsume it. It coexists, and the split is upstream's own.

The reason is that they are not two presentations of one thing. The cave menu
is a menu ABOUT A GRID - Look At, Walk To, Jump Onto, Throw To - and
every entry needs the grid to mean anything. The wheel has no grid. Folding the
grid's entries into it would have made the pointer's wheel show something the
pad's wheel cannot show at all, which is the opposite of one surface for three
devices; and taking the gesture away from the grid would have removed a ported
upstream feature that has no other route, since upstream reaches it from the
mouse too.

What that costs is stated plainly: on the live game screen, a pointer over a
map grid gets the grid menu, so the wheel's pointer route there is the sidebar,
the status lines and the margins. Nothing that was bound before is displaced,
and every branch that opens the wheel is a branch where the gesture previously
did nothing at all.

A pad's wheel button has no pointer and so no grid under it. Rule 2 cannot
apply to it and it falls to rule 3, which is the whole of the difference
between the three devices.

The browser's own context menu is suppressed before any branch can return, so a
right-click never opens it over the game whatever the gesture turns out to
mean.

One gap belongs to the term rather than to the wheel. A modal that owns cell
taps consumes the canvas `pointerdown` outright, which is what stops the
in-world tap-to-move and long-press handlers double-firing beneath an open
menu, and it also stops a long press inside such a modal from reaching rule 3.
A right-click reaches it, because `contextmenu` is not the event being
consumed. On a phone a prompt's replies already have the touch sheet, so the
loss is a shortcut rather than a route.

### One gesture, two meanings, decided by what is on screen

With no prompt open the wheel is the command catalogue: a ring of eight groups,
then a ring of that group's commands, taken from the same registry the keyboard
and the command browser use. Selecting one calls the existing confirmed-command
route, so a mod that adds a command gains a route on all three devices without
anything here knowing about it.

With a prompt open the catalogue is unreachable anyway, because the shell will
not start a command inside a prompt. So the same gesture shows THAT PROMPT'S
replies instead, minus the directions the stick is already pointing at. That is
what closes the completeness argument: Choose target and Closest at an aim
prompt, Free cursor and Recall in the target loop, the item sources, Yes and No
are all reachable from a pad with four buttons.

An empty wheel is refused rather than shown. With no prompt to answer and no
command startable - a death screen, the high scores, a turn still resolving -
every wedge would be inert, and a surface that swallows a gesture and does
nothing is worse than the gesture doing nothing.

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

A finger gets one adaptation, and it is a size rather than a layout. Same eight
wedges, same icons, same words, same angles: only the ring grows, until a wedge
clears the 44 pixels a touch target needs with room to spare. A mouse commits
on a pixel and a finger commits on a pad of them, which is a fact about hands
rather than a reason to draw a second design.

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

### What a command is CALLED

A `cmd:` binding names its command and does not press its key, so the name has
to exist for every command and has to survive the roguelike-keyset option being
turned on. `commandName` is the one definition of it: the original keyset's key
where the command has one, and the command's own label where it does not. A key
is one character or a caret pair and a label is words, so the two can never
collide.

The fallback half is not hypothetical. Center map is `o: null, r: "@"` - the one
table row whose only key belongs to the roguelike keyset - so it had no name at
all while the name was `key` alone, and a list built by filtering on `key`
dropped it. A player opening the mapping screen found the command missing rather
than merely awkward to bind. The eleven root commands that live outside the
cached keypress registry carry no key either, and the same fallback makes Help,
Save, Messages and the rest bindable for the first time.

A player keymap is left off that list deliberately. Its label carries the
macro's own action text, so the name changes when the macro is edited, and a
binding saved against it would come back pointing at nothing.

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

Geometry is measured from the live canvas rectangle in CSS pixels, so it follows
each resize while the browser applies the current device-pixel ratio to the DOM
overlay. At a 1280 by 820 viewport, the wheel's box is 520 by 520. A wedge is
111.8 by 111.8, or 120.7 with the selected wedge's scale applied. No pair of
wedges intersects and none intersects the hub. The icon draws at 48 pixels and
the word at 15. The wheel's computed `background-image` is `none`, its
`background-color` is `rgba(0, 0, 0, 0)` and its border width is 0: the filled
panel is gone rather than merely dimmed.

Read over both extremes of background. In the town at midday, over lit stone
floor, shop entrances and townspeople, every plate and every word held. On a
dungeon level in an unlit corridor, over near-black, the pale plate border was
what separated the wedges from the ground. The same eight icons read in both.

## Built, and not yet built

Built: capability detection and naming, derived default layouts, saved bindings
merged over defaults, the dead zone and eight-way resolution with hysteresis and
repeat, cross and hat decoding, the sampling loop, the routing table above, the
command wheel with both its rings on all three input methods, and the mapping
screen over every command the table holds.

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
- **A hold inside a modal, on touch.** The term's own tap owner consumes the
  canvas `pointerdown` while a modal is up, so a long press there cannot reach
  the wheel. A right-click can. Closing it means letting that owner decline a
  hold while still claiming a tap.
- **Acceptance.** A full character played from birth to a death or a save, on a
  real controller, with the keyboard unplugged. Nothing short of that closes
  this.

## Third-increment browser measurements

The wheel driven by all three input methods over one live game, a Human Novice
Mage standing in the town with Shockbolt Light selected. The pad samples came
from a synthesised `navigator.getGamepads`, so the shipped runtime's own loop
read every one of them rather than a diagnostic hook.

**Mouse, at a 1280 by 820 viewport.** A right-click on the sidebar opened the
wheel on Use, Magic, Fight, Gear, Travel, Carry, Map, More, with the hub reading
`Commands` over `Use - 8 commands`. The event's own `defaultPrevented` read true
in a listener behind the handler, so the browser's menu was suppressed rather
than merely unseen. Moving the pointer onto the Fight wedge moved the selection
and the hub to `Fight - 7 commands`; clicking it opened Fire, Nearest, Throw,
Target, Closest, Look, Steal; clicking Look ran the real command and the game
answered `You are on a down staircase, 0 N, 0 E.` with the wheel closed behind
it. A right-click over the MAP inside that target loop showed the loop's own
replies - Select, Next, Previous, Free, Player, Interesting, Help, Cancel -
rather than a grid menu, and a second right-click closed the wheel once, left
the prompt untouched, and did not reopen. With the loop cancelled, a right-click
on the player's own tile opened `Command for yourself`: Cast, Go Up, Go Down,
Explore, Look, Rest, Inventory, Character, Center Map, Other. Upstream's menu
still has that gesture.

Geometry over the live canvas: the wheel's box is 520 by 520, a wedge is 111.8
by 111.8 and 120.7 selected, the icon draws at 48 and the word at 15. Its
computed `background-image` is `none`, its `background-color` is `rgba(0, 0, 0,
0)` and its border width is 0. While the wheel is open the root's computed
`pointer-events` is `auto`, which is what stops a missed wedge reaching the map.

**Touch, at a 375 by 812 viewport under Android emulation, reloaded so the
load-time device gates re-ran.** The browser reported a coarse pointer and five
touch points, and the touch sheet installed. A press on the sidebar was not the
wheel at 250 ms and was the wheel at 550 ms, on the same eight groups with the
same hub. Lifting the finger that opened it left the wheel open and the player
on the same grid, so the release neither committed nor cancelled and no map tap
fired. A tap on Travel committed into Up, Down, Rest, Run, Explore, Walk, Stand,
Repeat; a press on the hub returned to the eight groups; a press on the hub
again closed the wheel; a press outside the wedges closed it too. A 520 ms press
on a MAP grid instead opened `You see some lava, 0 N, 1 E.` with Look At, Use
Item On, Cast On, Alter, Walk Towards and Throw To, and the player did not move.
A quick release two cells east did move, which is the control that says the same
harness reaches tap-to-move at all.

Touch geometry: the live canvas measurement resolves `--gp-size` to 300px and
draws a 64.5 wedge and 69.7 selected, a 108px hub, a 28.5 icon and a 10.8 word.
No pair of wedges intersects and none intersects the hub. The icon leads at that
size while the word stays above its 10-pixel floor.

**Gamepad.** An Xbox pad reporting 17 buttons and 4 axes announced `Controller
ready: 17 buttons, two sticks, d-pad, triggers. RT opens the command wheel.` RT
opened the same first ring over the same town. The stick pushed to 0.7, -0.7
selected Magic by angle; Confirm opened Cast, Browse, Study, Abilities; Cancel
returned to the eight groups, through the same function the pointer's hub calls.
A stick at 0.92, -0.38 selected Fight rather than Magic, which is the east
sector holding to its own 45 degrees rather than rounding up to the diagonal.

The keyless row is measured against the adapter rather than in the browser,
because it is a binding rather than a rendering: `gamepad-input.test.ts` binds
`cmd:Center map` to the top face button, polls the real adapter, and asserts the
command ran with no literal key crossing the input door.
