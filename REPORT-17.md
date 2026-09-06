# Issue 17 report

Implementation commit: `276cfaff001556af252a40401e9b428223d2c152` (`Make panels follow the visual viewport (#17)`).
Report commit: `b18db91185ad8dbb653153acc0ea4d0ce936c8e4` (`Document layout region findings (#17)`).

## Pre-existing customizable-layout work

The repository already has a substantial mod-facing region system. It is not a
player layout editor.

- `packages/web/src/regions.ts` defines the four role-named base rectangles:
  `messages`, `sidebar`, `map`, and `status`. It projects each into both grid
  cells and CSS pixels, and defines the ordered `LiveRegion` stack.
- `packages/web/src/ui-stack.ts`, `region-surface.ts`, and `region-runtime.ts`
  provide placement, clipping, compositing, and painted-cell pointer ownership.
  `regionInputAt()` in `ui-stack.ts` deliberately covers pointer input only.
- `packages/web/src/main.ts` derives the base rectangles from `viewport()` and
  the three existing sidebar choices: Left, Top, and None. The player can choose
  those modes, but cannot place, resize, persist, or reorder any role.
- `packages/web/src/panel-runtime.ts` already provided a host-owned DOM panel
  and keyboard escape hatch for `ui:panel.mount`.
- `docs/modding/MOD_REACH.md`, row 21, records the open mod-facing work:
  independently replaceable HUD regions, menus, prompts, and screens are
  partly built, while remaining screen builders, full-screen erase declarations,
  menu presentation, and a focus model remain open.
- `docs/PLANNED.md` now records the missing player-facing half explicitly.

No persisted player region arrangement, drag or keyboard layout editor,
per-region size preference, or player-selected keyboard focus policy existed in
the tree before this change. The evidence is the role-only `ScreenRegions`
model, `viewport()`'s sidebar-only layout decision, and the absence of any
layout preference or editor outside those modes.

## Blockers

Cleared in this pass:

- A virtual keyboard could shrink `visualViewport` while the terminal still
  measured `window.innerWidth` and `window.innerHeight`. `GlyphTerm` now fits,
  positions, and projects region pixels from the visual viewport, and ignores a
  duplicate resize with unchanged dimensions.
- A panel container used a fixed `inset: 0` rectangle without tracking the
  visual viewport. `panel-runtime.ts` now updates its left, top, width, and
  height on visual-viewport resize and scroll, and removes those listeners when
  the panel closes.
- There was no runnable DOM-panel measurement subject. `samples/viewport-panel/`
  adds an editable modal sample with viewport readout and focused-field
  `scrollIntoView` behavior.

Still open, with specific work needed:

- A player layout schema must persist role identity, geometry, visibility, and
  ordering. It must replace the sidebar-only `viewport()` decision rather than
  layer a second coordinate system over it.
- A player editor needs to create and validate placements through the same
  `RegionSpec` and `LiveRegion` path as a mod. It also needs reset and invalid
  layout recovery behavior.
- Core screens still need region declarations, and menu presentation needs a
  region owner. The remaining census is documented in `docs/modding/MOD_REACH.md`
  row 21.
- Keyboard focus needs an explicit owner policy. Existing `regionInputAt()` can
  consume a painted pointer cell but cannot choose where Arrow keys or Enter go.

The issue 12 branch must reconcile at `ScreenRegions`, `LiveRegion`, and
`RegionSpec`: a player arrangement supplies the role's geometry and order, and
a mod replacement supplies that same role's painter. A mod must not create a
parallel HUD or screen placement system. Its replacement must be candidate
selection for the player-arranged region, with core remaining candidate zero.

## Measurements

The Browser pane controls named in the assignment were not available in this
environment. The measurement used the built Electron renderer over CDP, a real
disk-loaded `viewport-panel` mod, Electron's persisted `Fullscreen = 1` state,
and Chromium mobile device metrics. The device-metrics override does not emit a
VisualViewport event in Electron, so the measurement explicitly dispatched the
same `resize` event that a virtual keyboard supplies before reading computed
rectangles.

- Electron fullscreen: visual viewport 3491.8181 by 1963.6364 CSS pixels;
  panel and canvas rectangles were both exactly 3491.8181 by 1963.6364 at 0,0.
  Canvas backing store was 3841 by 2160 pixels.
- Phone mobile preset: 390 by 844.5454 CSS pixels; after the visual-viewport
  resize event, panel and canvas rectangles were both 390 by 844.5454 at 0,0.
  Canvas backing store was 1170 by 2533 pixels.
- Keyboard-resized viewport: 390 by 492.7273 CSS pixels; panel and canvas
  rectangles both became 390 by 492.7273 at 0,0. Canvas backing store became
  1170 by 1478 pixels. The visible height fell 351.8181 CSS pixels and neither
  surface retained the pre-keyboard height.

One final CDP screenshot was captured after the keyboard-resized measurement at
`C:\Temp\neo17-phone-keyboard-final.png` (51,611 bytes). It is a temporary
measurement artifact and is not part of the commit.

## Verification

Required order and real terminal output follow.

1. `pnpm build`

```text
> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\layout-regions
> tsc -b
```

2. `pnpm exec vitest run packages/web/src packages/core/src`

```text
RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/layout-regions

(node:58252) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:57620) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:59448) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:48244) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:43532) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12660) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26312) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:62232) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:62948) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:14180) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22212) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:56356) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
```

This broad command did not finish or print a result before its process tree was
terminated under shared parallel load. It did not report a named failure, so the
expected one `test-collection.test.ts` worktree failure was not observed and no
passing claim is made for this command. The changed files were rerun in
isolation:

```text
RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/layout-regions

Test Files  4 passed (4)
     Tests  79 passed (79)
  Start at  12:58:16
  Duration  3.40s (transform 4.89s, setup 0ms, import 9.73s, tests 44ms, environment 0ms)
```

3. `pnpm lint`

```text
> neo-angband@1.8.0 lint C:\Repositories\_worktrees\neo-angband\layout-regions
> eslint .
```

4. `pnpm build`

```text
> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\layout-regions
> tsc -b
```
