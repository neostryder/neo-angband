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

Mods that provide panels add rows below the built-in panels. A panel stays in its saved place when its mod is not loaded and shows the mod's name with a Remove button. Loading the mod fills that place again; Remove takes the panel out of the layout. A mod's panel opens by itself the first time the mod or the feature that provides it is turned on. Close it and it stays closed until you turn it back on here. Turning off the mod feature that provides a panel takes the panel off screen, and turning the feature back on returns it to the same place.

A new install opens with the dungeon view alone, as the original does. The first few times you open a screen that can also be a panel (inventory, equipment, the monster and item lists, messages, the character sheet, monster and object recall), a note at the top of the dungeon view says so. Press `+`, or the `+` button at the top right, and that screen stays open beside the map. The notes stop once any panel is open. A layout with every panel off stays that way the next time you start the game.

## Rearranging panels

Panels can fill docked spaces or float above them inside the game viewport. Floating panels never open as separate desktop windows.

- **Move a panel: right-click and drag it.** Left-click is reserved for ordinary game input and for focusing a panel, so dragging always uses the right mouse button. While dragging, every other panel outlines the places it could accept the drop. The four edge zones **dock** the dragged panel against that edge, splitting that panel's space to make room. The middle of a panel holds two labeled targets: **Swap** trades the two panels' places, and **Tab** adds the dragged panel to that panel's space as a tab. Release over the zone you want.
- **Switch tabs: click a tab.** A space holding more than one panel shows a row of tabs in its title bar in place of the panel name. Clicking a tab shows that panel, and right-click-dragging a tab moves that one panel out of the group. Closing the shown panel shows the next tab.
- **Resize a panel: drag the thin bar between two panels** (the splitter). It
  turns the cursor into a resize arrow when you hover it. No panel can be
  resized down to nothing - each keeps a small minimum size, so a splitter
  drag always leaves both sides usable.
- **Close a panel from its own title bar**, with the small `x` in its corner -
  the same effect as unchecking it back in Subwindow setup.
- **Float a panel: click Float in its title bar.** Drag the floating panel by its title bar, resize it from its lower-right grip, or click Dock to return it to its last docked place. Drag its title bar onto a dock zone to dock, swap or add it as a tab.

Closing a panel hands its space to the panels beside it that are cramped. If none of them are, the dungeon view takes it. Turning a panel off and on again restores its last floating or docked place. A panel with no saved place uses its standard dock. If other panels already sit on that side of the dungeon view, the new one joins them and shares their space, so the dungeon view keeps its size. A disabled mod leaves a named placeholder in a floating panel as it does in a docked panel.

The dungeon view can move too. Drag the small grip in its top-right corner to dock it against another panel's edge, or drop it in the middle of a panel to trade places with it. It never closes, hides, floats or becomes a tab, so the map is always on screen.

## How panels look

Panel title bars, tabs and buttons use Angband's own 8x13 font and colours, the same ones the original draws its menus with. A mod you have allowed to change how the game looks can repaint them.

## Small windows

Shrink the window far enough and the panels run out of room to stay readable. Rather than squeezing them further, the game folds the most cramped panel into a tab beside the panel closest to it in shape: the monster list joins the item list, and messages join another wide strip along an edge. A notice at the top of the dungeon view names each pair and fades after a few seconds. Every panel stays one click away, and your arrangement is untouched, so widening the window puts each panel back where it was. The splitters hold still until then.

## Window features

Seven rows on the Subwindow setup screen switch parts of the panel system on and off, each on its own. **Tabs** (on by default) offers the Tab target when you drag one panel onto another. **Small windows** (on by default) folds cramped docked panels into tabs as described above; floating panels remain separate and stay within the viewport. **Lock dividers** (off by default) stops the splitters from moving, so a finished arrangement cannot be nudged by a stray drag. **Move the dungeon view** (on by default) shows the grip in the dungeon view's corner; with it off, the dungeon view stays where it is and other panels can still swap places with it. **Fit to content** (on by default) gives a panel that asks for a set height, such as a mod's quickbar, that height when it sits above or below another panel. Drag its divider to pick your own size instead, and double-click the divider to hand the size back to the panel. **Floating windows** (on by default) shows Float controls; with it off, floating panels appear docked at their remembered places, and their floating sizes and positions return when it is on again. **Panel tips** (on by default) shows those notes and the `+` button; `+` still keeps a screen open with it off.

## Where a panel opens

Until you move, resize, tab or float a panel, the game arranges the panels for you. Each one has its own side of the dungeon view: the inventory, equipment, monster and item lists and both recalls on the right, the map, overhead view and character panels on the left, the top bar above, and messages and status below. The same panels always get the same arrangement, whatever order you open them in, and closing one gives its room back to the rest. Once you arrange anything by hand, a newly opened panel docks beside the dungeon view and the others stay where you put them. A panel you close and open again goes back to its last place.

## Making an arrangement stick

Two different things save a layout, and they solve different problems.

**Save as my default / Restore my default**, the last two rows on the
Subwindow setup screen, keep one personal layout in your browser's own
storage - which panels are on, where they sit, and the map panel's own
graphics setting (below). **Save as my default** snapshots whatever you
currently have arranged; **Restore my default** brings it back, any time,
without asking anything of you. Nothing is saved until you press *Save as my
default* yourself, and there is nothing to restore until you have. This is
separate from the automatic arrangement described above - your own
saved default, once you make one, takes priority whenever a fresh panel needs
somewhere to go.

**Export subwindow layout** in the main Options Menu saves the arrangement as a JSON document named `<character>-subwindows.json`. The document includes registered mod blocks. **Import preferences** reads the document back in, which lets a layout move between installs or between the browser and desktop builds.

## The map panel's own graphics setting

The **Display dungeon map** panel has a graphics choice of its own, separate
from the main view's own **Graphics** menu (`Escape` -> **Graphics**). Open
**Subwindow setup** and select **Dungeon map graphics: {current mode}** to
choose ASCII or any installed tile pack for the map panel alone; the same
choice is also reachable as a dropdown right in the map panel's own title bar.

Because the two are independent settings, any combination works: ASCII in the
main view with a tile pack in the map panel, tiles in the main view with ASCII
in the map panel, or the same choice in both. The map panel's graphics choice
travels with your saved default and with a JSON layout export, the same as
everything else on this page.
