# Presentation owner seam

## Status and name

Gap 21 is the presentation owner seam. It is not registry:menu. Registry:menu
transforms the semantic rows of a named menu, while this seam selects who
presents a region, a menu question, or a full-screen document.

The first increment is the HUD owner: messages, sidebar (the vitals), and
status. packages/web/src/hud-view.ts:52 is the closed list, and
packages/web/src/hud-runtime.ts:250 installs an owner for every member.
packages/web/src/main.ts:13667 installs those owners from the active plugins,
while packages/web/src/main.ts:8671 routes every live HUD frame through the
installed sink.

## Declaration and shape

A plugin declares a direct ModPlugin member, not a registry callback. The
member that applies depends on the surface:

| Surface | Declaration | Capability | Fine-grained decision |
| --- | --- | --- | --- |
| HUD message area | hud(ctx) returns a messages sink | ui:messages.replace | Per region |
| HUD vitals | hud(ctx) returns a sidebar sink | ui:sidebar.replace | Per region |
| Status line | hud(ctx) returns a status sink | ui:status.replace | Per region |
| Menu presentation | menu(ctx) returns a presenter | ui:menu.replace | ask(question) returns undefined to decline a question |
| Full-screen presentation | screen(ctx) returns a presenter | ui:screen.replace | show(view) returns undefined to decline a screen |

ui:*.replace covers the three HUD capabilities and the menu and screen
replacement capabilities. display:replace remains map-only. The SDK types are
published in packages/mod-sdk/src/hud.ts:113 and
packages/mod-sdk/src/screen.ts:333; the plugin members are declared in
packages/web/src/mod-plugin.ts:1114 through packages/web/src/mod-plugin.ts:1205.

Example shape:

    export default {
      api: 1,
      hud() {
        return {
          messages: { present(section, frame) { drawMessages(section, frame); } },
          sidebar: { present(section, frame) { drawVitals(section, frame); } },
          status: { present(section, frame) { drawStatus(section, frame); } },
        };
      },
    };

The corresponding manifest asks only for the regions the plugin draws:

    { "shape": "plugin", "capabilities": ["ui:messages.replace", "ui:sidebar.replace", "ui:status.replace"] }

## Host guarantees

- Core is candidate zero for every HUD region. The last eligible enabled plugin
  wins each individual region; core keeps every region nobody wins. The code
  builds core through the same hud() path in packages/web/src/hud-runtime.ts:76
  and selects owners in packages/web/src/hud-runtime.ts:250.

- The host chooses from manifests before calling hud(). A losing plugin is not
  constructed. A returned sink for an ungranted region is refused and reported.
  A selected plugin that declines a region returns it to core, not to an earlier
  claimant. These rules are implemented in packages/web/src/hud-runtime.ts:126
  through packages/web/src/hud-runtime.ts:288.

- A HUD sink receives an immutable section and its immutable full frame on every
  repaint. The frame contains semantic entry keys and values, terminal
  projection details, the named region, and the live region stack where the host
  has one. The data shape is packages/web/src/hud-view.ts:111 through
  packages/web/src/hud-view.ts:189; snapshots are made at
  packages/web/src/hud-runtime.ts:308.

- A draw fault removes only the failed HUD region for the rest of the session
  and immediately restores core drawing for it. The other HUD regions continue
  to use their existing owners. This is the per-region failure rule in
  packages/web/src/hud-runtime.ts:308.

- A menu or screen presenter is one session owner. It may decline individual
  questions or screens. An exception disables that presenter for the session and
  falls back to the terminal. The menu holder is
  packages/web/src/menu-runtime.ts:106; the screen holder and fallback are
  packages/web/src/screen-runtime.ts:109 and packages/web/src/screen-runtime.ts:177.

- Registry:menu remains a row seam. selectFromMenu first applies that row
  transform and then offers the resulting MenuQuestion to the menu presenter at
  packages/web/src/overlay.ts:1770 and packages/web/src/overlay.ts:2244. A row
  replacement and a presentation replacement therefore compose instead of
  racing.

## Full-screen compatibility and degradation

A screen presenter matches the stable ScreenView.id, table column keys, and
block kinds it understands. It must return undefined if the id, required block,
or required column is not recognised. The host then shows the core screen
unchanged. ScreenPresenter.show has that synchronous decline contract in
packages/mod-sdk/src/screen.ts:333, and showThroughPresenter enforces the
fallback in packages/web/src/screen-runtime.ts:177.

The host freezes a view before handing it over. Additive optional fields do not
require a presenter update. A new modelled screen gets a new core:<name> id,
which an older presenter declines. A screen without a semantic model is sent as
core:text with a lines block, so it can be frame-reskinned but must not be
treated as a specific listing. MODELLED_SCREENS and the core:text fallback are
the code-defined boundary at packages/web/src/screen-view.ts:490 and
packages/web/src/screen-view.ts:534.

If a presenter throws, returns an invalid handle, or its dismissal rejects, the
host reports the fault and resumes core presentation. A screen that fails while
open is offered back to core so the player is not left at a dead overlay. That
recovery is in packages/web/src/screen-runtime.ts:177 through
packages/web/src/screen-runtime.ts:266.

## Code-derived surface inventory

The counts below are deliberately different measurements. A terminal erase path
is a physical full-screen painter; a ScreenView id is a semantic document.
Adding them together would count the same screen twice.

| Surface family | Count | Derivation |
| --- | ---: | --- |
| HUD regions | 3 | HUD_SECTION_NAMES in packages/web/src/hud-view.ts:52 |
| Menu presentation seam | 1 | selectFromMenu offers every supported question through the one presenter path in packages/web/src/overlay.ts:2244 |
| Full-screen terminal erase paths | 33 | 31 region-declared paths plus 2 pending prompt paths in packages/web/src/main-regions.test.ts:215 and packages/web/src/main-regions.test.ts:279 |
| Full-screen compositor | 1 | Separate full-frame repaint, not a screen, in packages/web/src/main-regions.test.ts:195 |
| Modelled semantic screen ids | 40 | MODELLED_SCREENS in packages/web/src/screen-view.ts:490 |
| Unmodelled semantic fallback | 1 shared id | core:text in packages/web/src/screen-view.ts:534 |

The 33 code-derived full-screen terminal paths are:

- overlay.ts: paintViewOnTerminal > paint, paintLevelMapOnTerminal > paint,
  itemSelect > paint, selectFromMenu > askTerminalOnTerminal > paint,
  promptNumber > paint, promptText > paint.
- birth.ts: drawBirthSheet, paintBirthMenuOnTerminal > paint,
  paintPointBuyOnTerminal > paint, paintStandardRollerOnTerminal > paint.
- charsheet.ts: showCharacterSheet > paintSheetOnTerminal > paintNarrow,
  showCharacterSheet > paintSheetOnTerminal > paintWide.
- mod-browse.ts: installOne > result, openRegistry, paintWhile, showSource.
- main.ts: paintInstallChoiceOnTerminal > paint, showReportPage > paint,
  showUpdatePage > paint.
- colors.ts: runColorsEditor > paint.
- equip-cmp.ts: showEquipCmp > paint.
- knowledge.ts: runGroupedBrowser > browsePanels > paint.
- loading.ts: paintScene.
- monster-list.ts: showMonsterListOnTerminal > paint.
- news.ts: paintTitleArt.
- options.ts: optionToggleScreen > paint, runSidebarModePage > paint.
- prefs-ui.ts: getPrefPath, loadPrefFileHack.
- score.ts: showScoreScreen > showScoresOnTerminal > paint.
- shop.ts: runStore > paint.
- wizard.ts: drawWizItem, paintWizItemOnTerminal.

The first 31 paths are region-declared. The two pending paths are overlay.ts's
number and text prompts. The ratchet asserts the counts of 31, 2, and 34
including the compositor at packages/web/src/main-regions.test.ts:430.

The 40 modelled ids are core:inventory, core:equipment, core:quiver,
core:objects-in-view, core:monster-list, core:messages, core:player-history,
core:object-recall, core:object-comparison, core:monster-recall,
core:tombstone, core:winner, core:character, core:character-flags,
core:rune-recall, core:feature-recall, core:trap-recall, core:shape-recall,
core:artifact-recall, core:ego-recall, core:object-kind-recall,
core:equip-cmp-help, core:equip-cmp-select-help, core:help-commands,
core:help-symbols, core:help-guide, core:help-community, core:mod-updates,
core:mod-auto-sort, core:mod-capabilities, core:mod-conflicts,
core:mod-install-failure, core:mod-zip-import-failure, core:mod-session-load,
core:hall-of-fame, core:store-knowledge, core:update, core:report,
core:wizard-keylog, and core:wizard-item.

## Relationship to player layout

The mod seam and player layout must use the same ScreenRegion object. A HUD
section already carries section.region, and its frame carries the same live stack
used by the map: packages/web/src/hud-view.ts:111 and
packages/web/src/hud-view.ts:133. screenRegions() creates the named regions from
layout and terminal metrics in packages/web/src/regions.ts:181; main passes that
same result to the HUD frame in packages/web/src/main.ts:8205 and to the render
path in packages/web/src/main.ts:8671.

The player-layout work for issue #17 should therefore alter the region producer
and its placement state, not introduce a parallel player-only rectangle table.
The reconciliation point is the region identity, cells, pixels, and live stack:
a player move must cause the next HudFrame and any active presentation owner to
receive the updated object. Mod-created regions and player-rearranged core
regions must both remain members of the same stack, so compositing and pointer
routing continue to answer one question about one object.

The fixed 80 by 24 terminal is projected into the visual viewport by
GlyphTerm.fitFixed(), including while the title screen owns the full-screen
region. It uses one uniform cell scale and letterboxes the unused dimension;
it does not add a title-only canvas transform. Grid painting, region pixels,
and cellAt() therefore share the same cell metrics and the same snapped
device-pixel cell edges, so a title link's painted rectangle and its pointer hit
target cannot diverge on a narrow or short viewport.

## Landed and remaining work

Landed: the three HUD regions are separately replaceable, menus have a
presentation owner after row transformation, full screens have a presenter
fallback, and 40 semantic documents are modelled. The HUD is exercised through
the real owner runtime by packages/web/src/hud-runtime.test.ts and the
disk-loaded vitals sample by packages/web/src/sample-vitals.node.test.ts.

Remaining: the two prompt erase paths still need nested-safe region treatment;
unmodelled screens still share core:text and cannot be safely reimagined as
specific semantic listings; screens and menus outside their shared presenter
paths need to be brought to those paths; and player layout must finish its
region placement persistence without splitting the region object from the mod
owner seam.
