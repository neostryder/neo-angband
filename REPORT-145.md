# Issue #145: Touch-friendly control scheme for mobile/PWA play

The first increment is committed locally on `touch-controls`. The final required
verification sequence passed: build, the web/core test run, lint, then build.
The test run reported 523 passed files, one skipped file, 9579 passed tests and
nine skipped tests. Issue #145 remains incomplete.

## Commits and scope

- Implementation, inventory, design, changelog and browser proof:
  `266ca7d9f0a11643388241e4810a45ac21f53bee`.
- Base commit: `3efc3723d774a2b8ddc0cfb9c023d4694b71542e`.
- This report is recorded in a subsequent documentation commit. Its SHA is
  included in the final delivery alongside the implementation SHA.

No version changed. No push, tag or pull request was created. Files under
`reference/` were read and remain unchanged. Changed source and design files
use LF; added prose is plain ASCII. Raw terminal output below retains the
test runner's original characters.

## Inventory and design

[TOUCH_COMMAND_INVENTORY.md](docs/design/TOUCH_COMMAND_INVENTORY.md) contains
84 numbered entries: 72 upstream command-table rows, including conditional
Borg, two port commands and ten interaction families. It records both original
and roguelike bindings and the single-command, item/list, direction and target
shapes, including combinations and text, quantity, glyph and check adjuncts.
The upstream 4.2.6 tree is the authority for discrepancies.

[TOUCH_CONTROLS.md](docs/design/TOUCH_CONTROLS.md) maps every inventory entry to
the proposed scheme. A searchable command drawer opens temporary controls for
the actual pending question. Item sources and full-label choices, D-pad menu
navigation, an eight-way direction pad, target controls and native text fields
follow successive requests. Lifetime tokens reject stale and hidden answers.
Named replies bypass macros; explicit macro choices use normal expansion.
Existing command implementations retain prerequisites, inscriptions, effects,
turn costs, repeat and disturbance behavior.

Idle controls occupy two small launcher buttons. Prompt sheets appear when
needed and can be hidden. The final HUD design keeps critical vitals/status in
the QoL strip and moves details and turn summaries on demand. The new creature
ring and vital summaries are designed but not implemented in this increment.

## Landed

- A device-neutral command catalog with readiness checks, confirmed command
  closures, prompt contexts, selectable rows, source choices, direction/target
  replies, bounded text submission and stale-answer rejection.
- A phone control sheet with 48-pixel minimum button dimensions, searchable
  commands, explicit macros, menu navigation, native text entry, check answers,
  direction/target controls and a Keys fallback for unmodelled screen actions.
- Prompt producers for shared menus, item selection, aiming, checks, text and
  numbers, plus named title/birth choices and the existing interactive target
  loop. Game-screen fallback preserves access to remaining keyboard actions.
- Independent Desktop/Touch keymap persistence, including both keysets and mod
  ownership. Touch initializes from Desktop once. Explicit profile switching
  saves and reloads through the normal boot path; layout expansion is separate.
- Single-finger movement on release, a hold that opens the existing context
  menu without first moving, and two-finger cancellation of tap/hold recognition.
- Regression coverage for root command readiness, prompt lifetimes, successive
  item/direction/effect questions, source selection, keymap bypass, profile
  isolation and the actual touch gesture listener block.

## Recorded pain points

1. D-pad menu navigation: addressed in the first increment. Menus expose
   Up/Down/Left/Right, Select, Page up/down and Home/End, alongside named rows.
   Birth and the shared item/spell pickers were driven in the phone browser.
2. Adjustable font and tile size: relies on the existing QoL display controller
   and display options. No competing zoom implementation was added. The QoL
   `zoom-pan.ts` uses `setGrid`, `setCamera`, `setMapView` and `setSidebarExtent`
   for pinch, swipe and responsive reflow, including the fitted phone sidebar.
   End-to-end QoL integration and size-control discoverability are deferred:
   the browser proof used the base renderer, whose fixed grid remains small.
   This pass does not claim that font/tile sizing acceptance is complete.
3. Separate control/macro profiles: addressed for Desktop and Touch, with saved
   independent keymaps and layout expansion. Arbitrary named presets, per-mod
   associations, pins, handedness and import/export remain deferred.

## What gamepad issue #65 inherits

A gamepad adapter can subscribe to the same context stack, enumerate the root
command catalog, use `canCommand`/`invokeCommand`, select rows by lifetime token,
switch item sources, answer directions, navigate targets, cancel and submit
text. The catalog is registered regardless of whether touch controls mount.
The adapter need not duplicate spell/item workflows or infer key sequences.
Controller discovery, dead zones, focus management, button mapping, haptics and
an optional controller text-entry interface remain specific to #65.

## Browser evidence

The requested `preview_start`, `resize_window`, `read_page` and
`javascript_tool` names were unavailable in this session. The available browser
tools drove the Vite server at `http://127.0.0.1:5178/`, read accessibility
structure and computed values, and used Chromium device emulation. Reload ran
after setting a 390 x 844 mobile viewport, Android user agent, coarse pointer
and five touch points. One final screenshot was captured and visually checked.

- A Human Mage was created through named title, race, class and stat controls,
  a native name field, history acceptance and Begin.
- Study selected First Spells and Magic Missile. Cast selected the book and
  spell, then opened Aim and Target. Canceling Target returned to Aim; canceling
  Aim kept turn 20 and SP unchanged. A subsequent cast selected the visible
  creature, advanced turn 20 to 30, spent one SP and killed the creature.
- Throw selected a ration, reached Aim, then canceled at unchanged turn 40.
- Real touch pointerdown kept position (34,1) and turn 30. Quick release moved
  to (35,1) at turn 40. A stationary hold opened the existing context menu;
  both hold and release kept position and turn unchanged. Two fingers produced
  neither movement nor a context action.
- Native text submitted a 9999-turn rest. Back / Stop halted it at turn 120;
  a later observation remained at turn 120 and position (35,1).
- The final browser error-console query returned zero errors. An early browser
  automation timeout followed a resume reload; subsequent observation found
  and verified the fix for stale command readiness. A failed timer helper call
  during touch instrumentation was replaced with a successful complete hold
  and release check. These were not reported as successful checks.

| Requested viewport | Reported CSS viewport | Item sheet | Smallest button | Horizontal overflow |
| --- | --- | --- | --- | --- |
| 390 x 844 | 390 x 845 | 378 x 550 | 53.79 x 48.00 | None |
| 320 x 740 | 320 x 740 | 308 x 475 | 53.79 x 48.00 | None |
| 844 x 390 | 845 x 390 | 520 x 223 | 53.79 x 48.00 | None |

Sheets scroll internally. The final Aim sheet was 378 x 325 pixels, starting
at approximately (6,461). The document was visible and the canvas backing size
was 389 x 844. [Final painted proof](docs/design/touch-controls-145.png).

The proof shows a readable prompt overlay and a very small base map. QoL was
not enabled in that browser, so font/tile resizing, pinch/pan and fitted sidebar
integration are not claimed as browser-verified. Both keysets and profile
isolation were tested in Vitest. The full multi-effect sequence used real prompt
producers in a focused test; it was not a high-level browser cast of every effect.

## Remaining work

Issue #145 still needs the eligibility-aware creature ring, QoL-integrated
vital summaries and resizing acceptance, semantic controls for all remaining
character/knowledge/store/editor screens, complete roster/shopping/recovery
and full-character phone acceptance, arbitrary saved presets and ergonomics.
The Keys fallback provides access but is not the final intuitive interaction.
Upstream count prefixes, literal backslash bypass, subwindow toggle and target
pathfinding remain pre-existing keyboard-shell parity gaps. They were recorded
rather than emulated with new game rules. Follow-up work is also recorded in
`docs/PLANNED.md`.

## Verification history

The first build could not find `tsc` because this worktree lacked dependencies.
`pnpm install --frozen-lockfile` installed them without a lockfile change. The
next build found exact-optional-property type errors; those were corrected.

The first full test run had seven failures in three files. Five were in the new
prompt tests: an assertion ran before the next asynchronous prompt existed,
leaving input listeners active and causing subsequent 5-second timeouts. An
unchanged isolated rerun reproduced five failures, so this was not dismissed
as parallel-load flakiness. Waiting on the actual next-prompt readiness fixed
the sequence; the isolated rerun then passed all six tests. The other failures
were a command-route census needing its new caller counted and a screen-action
field census matching the new prompt field. The latter field was named
`replies` to distinguish prompt answers from the existing screen-action model.
An additional root-command readiness test was included before the final run.

The final four checks ran in the required order and all exited zero. Contrary
to the anticipated worktree failure, `test-collection.test.ts` passed: its
worktree assertion matches `.claude/worktrees/`, not this `_worktrees/` path.
The guard and runner exclusions were not modified.

The following blocks contain the complete captured terminal output, including
the failed attempts and both isolated results. Only line endings are normalized
to LF for the repository. No result is replaced with an expected result.

### Initial pnpm build

Exit code: 1.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

'tsc' is not recognized as an internal or external command,
operable program or batch file.
 ELIFECYCLE  Command failed with exit code 1.
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

### pnpm build after dependency installation

Exit code: 2.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

packages/web/src/command-menu.ts(135,9): error TS2322: Type '{ id: string; label: string; disabled: boolean | undefined; selected: boolean; run: () => void; }[]' is not assignable to type 'readonly ControlAction[]'.
  Type '{ id: string; label: string; disabled: boolean | undefined; selected: boolean; run: () => void; }' is not assignable to type 'ControlAction' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
    Types of property 'disabled' are incompatible.
      Type 'boolean | undefined' is not assignable to type 'boolean'.
        Type 'undefined' is not assignable to type 'boolean'.
packages/web/src/overlay.ts(1514,42): error TS2379: Argument of type '{ kind: "text"; label: string; detail: string | undefined; actions: ControlAction[]; text: { value: string; maxLength: number; submit: (value: string) => void; }; }' is not assignable to parameter of type 'ControlContext' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
  Types of property 'detail' are incompatible.
    Type 'string | undefined' is not assignable to type 'string'.
      Type 'undefined' is not assignable to type 'string'.
packages/web/src/overlay.ts(1870,9): error TS2322: Type '{ id: string; label: string; disabled: boolean | undefined; selected: boolean; run: () => void; }[]' is not assignable to type 'readonly ControlAction[]'.
  Type '{ id: string; label: string; disabled: boolean | undefined; selected: boolean; run: () => void; }' is not assignable to type 'ControlAction' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
    Types of property 'disabled' are incompatible.
      Type 'boolean | undefined' is not assignable to type 'boolean'.
        Type 'undefined' is not assignable to type 'boolean'.
packages/web/src/overlay.ts(2609,9): error TS2322: Type '{ id: string; label: string; disabled: boolean | undefined; selected: boolean; run: () => void; }[]' is not assignable to type 'readonly ControlAction[]'.
  Type '{ id: string; label: string; disabled: boolean | undefined; selected: boolean; run: () => void; }' is not assignable to type 'ControlAction' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
    Types of property 'disabled' are incompatible.
      Type 'boolean | undefined' is not assignable to type 'boolean'.
        Type 'undefined' is not assignable to type 'boolean'.
 ELIFECYCLE  Command failed with exit code 2.
```

### First sequence, step 1: pnpm build

Exit code: 0.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

```

### First sequence, step 2: pnpm exec vitest run packages/web/src packages/core/src

Exit code: 1.

```text

 RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/touch-controls

 ❯ packages/web/src/screens.test.ts (123 tests | 1 failed) 800ms
     × is the WHOLE census: no other module publishes a screen's actions 46ms
(node:22568) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:20512) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13536) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:58096) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:4656) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:19740) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:59800) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:63120) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:56644) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:55664) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:59504) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:59532) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33536) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36128) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:62660) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:53764) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:61564) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
 ❯ packages/web/src/display-wiring.test.ts (9 tests | 1 failed) 17ms
     × is reached from the keydown handler, through the key-confirm gate 5ms
(node:59260) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:9476) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:42560) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:60672) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:54448) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:59084) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:10976) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:45788) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:29572) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
 ❯ packages/web/src/control-surface.test.ts (6 tests | 5 failed) 15035ms
     × selects item source, navigates without inscription digit collision, then aims (rogue=false) 6ms
     × selects item source, navigates without inscription digit collision, then aims (rogue=true) 2ms
     × hands aim to a target picker and can cancel the next aim without executing 5005ms
     × keeps book, spell, effect item, confirmation and direction answers distinct 5011ms
     × bounds native text replies and prevents a keymap from changing a named answer 5008ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > selects item source, navigates without inscription digit collision, then aims (rogue=false)
AssertionError: expected undefined to be 'Aim' // Object.is equality

- Expected:
"Aim"

+ Received:
undefined

 ❯ packages/web/src/control-surface.test.ts:59:53
     57|     invoke("Arrow");
     58|     await Promise.resolve();
     59|     expect(controlSurface.current()?.context.label).toBe("Aim");
       |                                                     ^
     60|     expect(controlSurface.invoke(previous.token, "row:0")).toBe(false);
     61|     invoke("NE");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/7]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > selects item source, navigates without inscription digit collision, then aims (rogue=true)
AssertionError: expected 'Ration' to be 'Flask' // Object.is equality

Expected: "Flask"
Received: "Ration"

 ❯ packages/web/src/control-surface.test.ts:54:88
     52|     })();
     53|     controlKey("ArrowDown");
     54|     expect(controlSurface.current()!.context.rows?.find((row) => row.s…
       |                                                                                        ^
     55|     invoke("Quiver");
     56|     const previous = controlSurface.current()!;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/7]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > hands aim to a target picker and can cancel the next aim without executing
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ packages/web/src/control-surface.test.ts:66:3
     64|   });
     65|
     66|   it("hands aim to a target picker and can cancel the next aim without…
       |   ^
     67|     const aim = getAimDir(term, false);
     68|     invoke("Choose target");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/7]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > keeps book, spell, effect item, confirmation and direction answers distinct
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ packages/web/src/control-surface.test.ts:75:3
     73|   });
     74|
     75|   it("keeps book, spell, effect item, confirmation and direction answe…
       |   ^
     76|     const book = selectFromMenu(term, "test:book", "Book", [{ label: "…
     77|     invoke("Book");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/7]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > bounds native text replies and prevents a keymap from changing a named answer
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ packages/web/src/control-surface.test.ts:93:3
     91|   });
     92|
     93|   it("bounds native text replies and prevents a keymap from changing a…
       |   ^
     94|     const resolver = vi.fn(() => [{ key: { key: "n", modifiers: { ctrl…
     95|     setKeymapResolver(resolver);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/7]⎯

 FAIL  packages/web/src/display-wiring.test.ts > the ENTER command browser > is reached from the keydown handler, through the key-confirm gate
AssertionError: expected 4 to be 3 // Object.is equality

- Expected
+ Received

- 3
+ 4

 ❯ packages/web/src/display-wiring.test.ts:119:58
    117|     /* Not a second copy of the inscription veto: the menu row and the…
    118|      * go through the one runConfirmedCommand. */
    119|     expect(src.match(/runConfirmedCommand\(/gu)?.length).toBe(3); // 1…
       |                                                          ^
    120|     expect(src.match(/keyConfirmCount\(/gu)?.length).toBe(1);
    121|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/7]⎯

 FAIL  packages/web/src/screens.test.ts > every action is on exactly one side of the prompt census > is the WHOLE census: no other module publishes a screen's actions
AssertionError: expected [ 'charsheet.ts', …(5) ] to deeply equal [ 'charsheet.ts', …(2) ]

- Expected
+ Received

  [
    "charsheet.ts",
+   "command-menu.ts",
+   "main.ts",
+   "overlay.ts",
    "screen-view.ts",
    "screens.ts",
  ]

 ❯ packages/web/src/screens.test.ts:2889:26
    2887|       .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    2888|       .filter((f) => /(^|[{,(]\s*|\n\s+)actions:\s*\S/u.test(readFileS…
    2889|     expect(files.sort()).toEqual(["charsheet.ts", "screen-view.ts", "s…
       |                          ^
    2890|   });
    2891| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/7]⎯


 Test Files  3 failed | 520 passed | 1 skipped (524)
      Tests  7 failed | 9571 passed | 9 skipped (9587)
   Start at  13:12:53
   Duration  183.24s (transform 416.65s, setup 0ms, import 740.88s, tests 347.00s, environment 50ms)

```

### First sequence, step 3: pnpm lint

Exit code: 0.

```text

> neo-angband@1.8.0 lint C:\Repositories\_worktrees\neo-angband\touch-controls
> eslint .

```

### First sequence, step 4: pnpm build

Exit code: 0.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

```

### Isolated reproduction: pnpm exec vitest run packages/web/src/control-surface.test.ts

Exit code: 1.

```text

 RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/touch-controls

 ❯ packages/web/src/control-surface.test.ts (6 tests | 5 failed) 15042ms
     × selects item source, navigates without inscription digit collision, then aims (rogue=false) 4ms
     × selects item source, navigates without inscription digit collision, then aims (rogue=true) 1ms
     × hands aim to a target picker and can cancel the next aim without executing 5015ms
     × keeps book, spell, effect item, confirmation and direction answers distinct 5011ms
     × bounds native text replies and prevents a keymap from changing a named answer 5008ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > selects item source, navigates without inscription digit collision, then aims (rogue=false)
AssertionError: expected undefined to be 'Aim' // Object.is equality

- Expected:
"Aim"

+ Received:
undefined

 ❯ packages/web/src/control-surface.test.ts:59:53
     57|     invoke("Arrow");
     58|     await Promise.resolve();
     59|     expect(controlSurface.current()?.context.label).toBe("Aim");
       |                                                     ^
     60|     expect(controlSurface.invoke(previous.token, "row:0")).toBe(false);
     61|     invoke("NE");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > selects item source, navigates without inscription digit collision, then aims (rogue=true)
AssertionError: expected 'Ration' to be 'Flask' // Object.is equality

Expected: "Flask"
Received: "Ration"

 ❯ packages/web/src/control-surface.test.ts:54:88
     52|     })();
     53|     controlKey("ArrowDown");
     54|     expect(controlSurface.current()!.context.rows?.find((row) => row.s…
       |                                                                                        ^
     55|     invoke("Quiver");
     56|     const previous = controlSurface.current()!;

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > hands aim to a target picker and can cancel the next aim without executing
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ packages/web/src/control-surface.test.ts:66:3
     64|   });
     65|
     66|   it("hands aim to a target picker and can cancel the next aim without…
       |   ^
     67|     const aim = getAimDir(term, false);
     68|     invoke("Choose target");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > keeps book, spell, effect item, confirmation and direction answers distinct
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ packages/web/src/control-surface.test.ts:75:3
     73|   });
     74|
     75|   it("keeps book, spell, effect item, confirmation and direction answe…
       |   ^
     76|     const book = selectFromMenu(term, "test:book", "Book", [{ label: "…
     77|     invoke("Book");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯

 FAIL  packages/web/src/control-surface.test.ts > real prompt producers through the control surface > bounds native text replies and prevents a keymap from changing a named answer
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ packages/web/src/control-surface.test.ts:93:3
     91|   });
     92|
     93|   it("bounds native text replies and prevents a keymap from changing a…
       |   ^
     94|     const resolver = vi.fn(() => [{ key: { key: "n", modifiers: { ctrl…
     95|     setKeymapResolver(resolver);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯


 Test Files  1 failed (1)
      Tests  5 failed | 1 passed (6)
   Start at  13:17:21
   Duration  19.65s (transform 2.10s, setup 0ms, import 4.44s, tests 15.04s, environment 0ms)

```

### pnpm build after prompt-test corrections

Exit code: 0.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

```

### Isolated corrected test: pnpm exec vitest run packages/web/src/control-surface.test.ts

Exit code: 0.

```text

 RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/touch-controls


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  13:19:01
   Duration  4.18s (transform 1.92s, setup 0ms, import 4.01s, tests 7ms, environment 0ms)

```

### pnpm build after birth controls

Exit code: 0.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

```

### Final sequence, step 1: pnpm build

Exit code: 0.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

```

### Final sequence, step 2: pnpm exec vitest run packages/web/src packages/core/src

Exit code: 0.

```text

 RUN  v4.1.11 C:/Repositories/_worktrees/neo-angband/touch-controls

(node:5016) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:61676) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:45088) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:56912) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32280) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:52172) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:44268) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:57368) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:46836) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:61244) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26716) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:4796) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:3988) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:33804) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:3916) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:58508) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26048) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:60836) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:61244) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:48648) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:41836) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26344) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:50528) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:47864) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26308) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22100) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  523 passed | 1 skipped (524)
      Tests  9579 passed | 9 skipped (9588)
   Start at  13:30:14
   Duration  111.32s (transform 55.36s, setup 0ms, import 333.19s, tests 193.39s, environment 74ms)

```

### Final sequence, step 3: pnpm lint

Exit code: 0.

```text

> neo-angband@1.8.0 lint C:\Repositories\_worktrees\neo-angband\touch-controls
> eslint .

```

### Final sequence, step 4: pnpm build

Exit code: 0.

```text

> neo-angband@1.8.0 build C:\Repositories\_worktrees\neo-angband\touch-controls
> tsc -b

```
