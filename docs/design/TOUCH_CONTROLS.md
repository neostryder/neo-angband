# Touch controls and shared command surface (#145)

## Scope and acceptance

The complete control contract is the 84-entry
[keyboard inventory](TOUCH_COMMAND_INVENTORY.md). A full mobile implementation
must permit character creation, shopping, exploration, combat, spell and item
effects, recovery, information browsing, configuration and saving with no
physical keyboard. This first increment proves successive prompt ownership.
It is not the completion of issue #145.

The hard case is Throw or Cast, followed by an item or book, another selection,
an aim prompt, an interactive target and possibly another effect prompt. The
surface must follow the live request, never replay a guessed string such as
`maa5`. Item availability, spell knowledge, inscriptions and direction costs
remain the existing command implementation's responsibility.

## Shared command and prompt surface

The shell registers root command IDs, labels, categories and confirmed command
closures on `controlSurface` for every device. `canCommand` and `invokeCommand`
share a live readiness guard; adapters cannot start a command inside a prompt.
The shell also exposes a stack of control contexts. Each context has an identity,
kind, label, selectable rows, current selection, and explicit actions. A handle
updates its own context and disposes it on completion. Only the top handle may
act. A stale row or a delayed double tap cannot answer the next question.
Gamepad input can subscribe to the same surface and submit the same actions.

The four shapes translate as follows:

| Shape | Touch presentation | Ownership and completion |
| --- | --- | --- |
| Single command | Named command in a searchable drawer, grouped by the real registry; common actions can be pinned | Calls the existing confirmed command route; command drawer closes before execution |
| Item/list | Scrollable full-label choices and a D-pad with Select; item source tabs remain explicit | Selection reaches the existing picker; filters, disabled rows, inscriptions, quantity and confirmation remain authoritative |
| Direction | Eight-way compass, optional Self, Cancel | A direction answers the current request only; no command is repeated on hold |
| Target | Compass/free cursor, Next/Previous, Player, Interesting, Recall, Select target and Cancel | Uses the existing target loop, including its path preview and knowledge restrictions |

Text and numeric answers are adjuncts to those shapes, not optional features.
Use a real browser text field and software keyboard for names, inscriptions,
counts, searches, glyphs and long-list tag entry. Keep limits, default values,
case, confirmation and cancellation in the existing prompt code. A glyph
answer is one key, not an automatically submitted command sequence. Complex
screens not yet described by a context retain an explicit Keys fallback with
navigation, punctuation, Control and named keys; those screens still need
semantic actions before the overall issue is complete.

The adapter emits one input at a time through `input-door.ts` with keymap
expansion bypassed for named semantic actions and prompt replies. Player macros
remain explicit choices, not a hidden remapping of a button labelled Throw.
Modal ownership and inscription checks must be shared with keyboard dispatch.
Stop must interrupt a run, rest or autoplayer without issuing a second action.
No timer may auto-confirm, select a target or retry an effect.

## Complete coverage map

Every inventory entry has a route in the final scheme:

| Entries | Route |
| --- | --- |
| 1-16, 28, 30-34, 40 | Items group and eligible object context actions; source-aware item picker, quantities, native text and effect prompts |
| 17-18, 22-27, 29, 61-66, 69-70, 75-76 | Explore/Actions group, compass and map tap; Rest choices or count; explicit Run and Repeat; Stop while continuing |
| 19-21, 43, 67, 82 | Look/Target group, target controls and locate compass; map coordinates from current display geometry |
| 35-38 | Magic group; book and spell lists with details, low-mana check, then actual effect requests |
| 39, 41-42, 44-50 | Information group; map, locality, character, knowledge, help and messages with scrolling, pages and screen actions |
| 51-60 | System group; options, save, quit, retirement checks, notes, version and preferences; upstream-only subwindows explicitly unavailable |
| 68, 71-72 | Advanced group; normal wizard/Borg gates and nested debug menus |
| 73-74 | Port/System group; swap and roster/new character |
| 77-78 | Commands launcher, Back, Select, More and Stop; Back is one level, not a new command |
| 79-80 | Advanced input; count/bypass parity gaps must land in the keyboard shell before semantic touch exposure; caret and Control supported |
| 81, 83-84 | Context-specific navigation and actions for menus, stores, home, screen tools, fields and macro editing |

## Map gestures and creature ring

Quick release on a map cell takes one step toward it, subject to mouse_movement
and the existing hazard confirmation. A press must not move on pointerdown.
After 450 ms, a stationary single-finger press opens the context menu without
spending a turn. Movement beyond the slop threshold, pointer cancellation or a
second finger cancels both tap and hold. A region painted above the map retains
input ownership. A held finger must not become a step when the menu closes.

The final creature ring uses the existing context classifier and visible
knowledge. At most six large wedges offer the currently applicable actions:
Look/Recall, Target, Melee when adjacent, Fire with a usable launcher/ammo,
Magic with a castable spell, and More for devices, Throw and eligible Steal.
The ordinary command prerequisites still run after selection. A wedge cannot
reveal an unseen monster or assert success before the engine checks it. Edges
shift the ring inward; narrow screens can use a two-column sheet with the same
actions. This increment retains the existing context menu presentation;
eligibility-aware ring layout remains follow-up work.

Two fingers belong to the shipped QoL zoom/pan controller. Touch controls must
not create a competing pinch recognizer or consume its gesture. The QoL mod's
`zoom-pan.ts` uses `ctx.display.setGrid`, `setCamera`, `setMapView` and
`setSidebarExtent`, and handles two-finger pinch and swipe. Its grid activates
for gameplay and uses a narrow-screen floor, with the sidebar fitted as a
paged top strip. The display seam is described in
`docs/modding/MOD_REACH.md` rows 9 and 21 and implemented in `main.ts`'s display
host and `mod-plugin.ts`. Controls measure their own CSS pixels; map hit tests
continue through `term.cellAt` and the current viewport rather than stale tile
dimensions. Font and tile adjustment relies on that existing QoL path and the
existing display options. This increment does not add another zoom preference.

## HUD and reachability

Idle play has a small Controls launcher and an always-reachable Back/Stop
affordance, with safe-area padding. Expanded controls are temporary sheets,
bounded by viewport height and internally scrollable. Closing a sheet restores
the map area. Never put twenty fixed buttons in one unwrapping bottom row.

The final HUD keeps only critical HP, SP and active danger/status visible in
the QoL top strip. Full stats, equipment, resistances, messages and target
details are on demand. A turn summary appears after damage or resource/status
change and fades after reading; severe warnings and unanswered prompts persist.
An open prompt replaces the action drawer and stays visible until answered.
Target controls use a shallow sheet so the map and projection path remain
visible. Optional hand preference mirrors the controls, not the map.

This increment changes the action HUD, not the QoL status renderer. Automatic
vital summaries, status-strip changes and handedness remain follow-up work.

## Saved profiles

Desktop and Touch are distinct saved control/macro profiles. Preserve existing
desktop storage keys for backward compatibility. On first use, initialize the
Touch keymaps from Desktop once, then persist independently, including mod
ownership metadata and both original/rogue tables. A phone must not overwrite
desktop bindings when the keymap editor saves. Layout expansion preference is
also per profile. Device detection selects a default; explicit selection wins.
Switch profiles by saving the current profile and reloading the normal boot
path so mod registration and ownership reconciliation run in the new profile.

Follow-up named presets should store a label, pinned stable command IDs,
handedness, button size, macros and an optional mod configuration association.
Changing mods must not delete another preset. Imports validate schema/version,
show unavailable command IDs and never execute macros. Sync/export and arbitrary
named per-mod presets are beyond the two-profile first increment.

## What issue #65 inherits

A controller adapter inherits the root command catalog and readiness guard,
the current context stack and stale-handle guard,
labels and choices for item/menu prompts, eight-way direction semantics,
target actions, cancellation, and literal reply dispatch through the input door.
It can map the D-pad to navigation, A to Select, B to Back, shoulder buttons to
source/page switching, and a stick to direction without duplicating command
logic. A future analog ring may use the existing `UiDirection` vector and angle.
Controller discovery, dead zones, focus policy, haptics and mapping UI remain
specific to #65. A gamepad text-entry overlay can answer the same text context.

## Verification and remaining acceptance

Exercise item selection to aim to target, aim cancellation back to the aim
prompt, final command cancellation, nested effect item selection, empty lists,
disabled rows, inscription checks, both keysets and profile isolation. Verify
touch navigation in birth and stores, long-press without movement, two-finger
cancellation and Stop during recovery. Measure viewport bounds and target sizes
with browser computed values under touch emulation and Android user agent after
reload. A single final capture establishes painted pixels.

Full-character phone play is the remaining release criterion. The first pass
must report unsupported semantic screens, ring/HUD work and upstream parity
gaps separately, without treating keyboard fallback as the finished design.

## First-increment browser measurements

The Android-emulated browser reported a coarse pointer and five touch points
at 390 x 845, 320 x 740 and 845 x 390 CSS-pixel viewports. Item sheets measured
378 x 550, 308 x 475 and 520 x 223 pixels, respectively, with internal scrolling
and no document-level horizontal overflow. The smallest measured button was
53.79 x 48.00 pixels. The final Aim sheet measured 378 x 325 pixels.

The browser drove a Human Mage through birth, study, book/spell selection,
aiming and target selection. Target cancellation returned to Aim; final aim
cancellation did not spend a turn in the tested spell and throw commands.
The successful Magic Missile spent one SP and advanced the turn from 20 to 30.
Quick release advanced one cell; holding and two-finger input spent no turn.
Back / Stop halted a 9999-turn rest at turn 120, with the position unchanged.

[The final phone capture](touch-controls-145.png) shows the painted canvas and
item-to-aim controls. The browser used the base renderer without the external
QoL mod, so its fixed 80 x 24 grid remains small. This validates prompt controls,
not QoL font sizing, pinch/pan or fitted sidebar integration. That integration
and full-character phone acceptance remain required before closing #145.
