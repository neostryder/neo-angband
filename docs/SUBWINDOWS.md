# Subwindow tiling

Subwindows let you keep extra information on screen beside the main game view:
inventory, messages, the character sheet, a second copy of the map, and more,
each in its own panel that stays visible while you play. This page covers
opening them, rearranging them, and the two ways to make an arrangement stick.

## Turning panels on

`Escape` -> **Subwindow setup** (or `=` then `w` directly) opens a checklist,
one row per available panel:

| Panel | Shows |
| --- | --- |
| Display inven/equip | Inventory |
| Display equip/inven | Equipment |
| Display player (basic) | Character sheet: identity, stats, combat numbers |
| Display player (extra) | Character sheet: resistances, sustains, abilities |
| Display player (compact) | A condensed one-line character summary |
| Display player (topbar) | The same summary, docked as a strip |
| Display dungeon map | A second view of the level, with its own graphics setting (below) |
| Display messages | The scrolling message log |
| Display overhead view | The full-level overview map |
| Display monster recall | Details on the last monster looked at |
| Display object recall | Details on the last item looked at |
| Display monster list | Every visible monster, in one list |
| Display item list | Every visible floor item, in one list |
| Display status | The status line (afflictions, stance, and similar) |

Pressing `Enter` on a row toggles that panel on or off immediately - no reload
needed. An `X` marks a panel that is currently on, a `.` marks one that is off.

Nothing is on by default until you turn something on: a fresh install, or a
panel you have never touched, starts exactly like the single-window game
always has. Turning on your first panel places the whole set of panels
described in "The default arrangement" below, built around a large main view.

## Rearranging panels

Panels tile the window - there is no floating or overlapping, and every panel
always has a home that fills the available space.

- **Move a panel: right-click and drag it.** Left-click is reserved for ordinary game input and for focusing a panel, so dragging always uses the right mouse button. While dragging, every other panel outlines the places it could accept the drop. The four edge zones **dock** the dragged panel against that edge, splitting that panel's space to make room. The middle of a panel holds two labeled targets: **Swap** trades the two panels' places, and **Tab** adds the dragged panel to that panel's space as a tab. Release over the zone you want.
- **Switch tabs: click a tab.** A space holding more than one panel shows a row of tabs in its title bar in place of the panel name. Clicking a tab shows that panel, and right-click-dragging a tab moves that one panel out of the group. Closing the shown panel shows the next tab.
- **Resize a panel: drag the thin bar between two panels** (the splitter). It
  turns the cursor into a resize arrow when you hover it. No panel can be
  resized down to nothing - each keeps a small minimum size, so a splitter
  drag always leaves both sides usable.
- **Close a panel from its own title bar**, with the small `x` in its corner -
  the same effect as unchecking it back in Subwindow setup.

The main play view itself never moves, docks, closes or becomes a tab; every other panel arranges around it.

## Small windows

Shrink the window far enough and the panels run out of room to stay readable. Rather than squeezing them further, the game folds the most cramped panel into a tab beside the panel closest to it in shape: the monster list joins the item list, and messages join another wide strip along an edge. A message in the log names each pair. Every panel stays one click away, and your arrangement is untouched, so widening the window puts each panel back where it was. The splitters hold still until then.

## The default arrangement

The first panel you turn on brings a whole prebuilt layout with it, rather
than placing just that one panel alone: the character sheet and
inventory/equipment down the left side, the map beside the main view along the
top, and the monster list, item list, messages, and monster/object recall
tiled underneath. A panel with no earlier place of its own docks to a sensible
default edge instead of stacking. Turning a panel back off, then on again,
returns it to that same default spot unless you have moved it.

## Making an arrangement stick

Two different things save a layout, and they solve different problems.

**Save as my default / Restore my default**, the last two rows on the
Subwindow setup screen, keep one personal layout in your browser's own
storage - which panels are on, where they sit, and the map panel's own
graphics setting (below). **Save as my default** snapshots whatever you
currently have arranged; **Restore my default** brings it back, any time,
without asking anything of you. Nothing is saved until you press *Save as my
default* yourself, and there is nothing to restore until you have. This is
separate from the *shipped* default arrangement described above - your own
saved default, once you make one, takes priority whenever a fresh panel needs
somewhere to go.

**Save subwindow setup to pref file**, near the top of the main Options Menu
(alongside the other pref-file commands, not inside Subwindow setup itself),
exports the whole arrangement to a file instead of your browser's storage -
useful for carrying a layout between installs, or between the browser build
and the desktop app. **Load a user pref file** reads one back in.

## The map panel's own graphics setting

The **Display dungeon map** panel has a graphics choice of its own, separate
from the main view's own **Graphics** menu (`Escape` -> **Graphics**). Open
**Subwindow setup** and select **Dungeon map graphics: {current mode}** to
choose ASCII or any installed tile pack for the map panel alone; the same
choice is also reachable as a dropdown right in the map panel's own title bar.

Because the two are independent settings, any combination works: ASCII in the
main view with a tile pack in the map panel, tiles in the main view with ASCII
in the map panel, or the same choice in both. The map panel's graphics choice
travels with your saved default and with a pref-file export, the same as
everything else on this page.
