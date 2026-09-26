# Input routed by region

Landed in `a2d8cd0ea` on 2026-08-14 (ticket #276, gap 21, milestone 7). The implementation follows this design: `regionInputAt` in `ui-stack.ts`, the `RegionPointer` type and `input?` member in `frontend.ts`, and the three call sites in `main.ts`, all covered by `region-input.node.test.ts` and `main-region-input.test.ts`. The rest of this file is kept as a design record. It explains why input ownership is per cell rather than per rectangle, what that costs at runtime, and how it fits with `modalDepth` and `setActiveCellTap`. Section 9's file-by-file plan and its RED-test listings describe the tree as it was before the change landed. Line numbers were read on 2026-08-14 against `work/parallel-2026-08-14` while four other lines of work were editing the same tree, and they have not been re-checked against the landed commit.

---
## The defect this closes

`packages/web/src/regions.ts:345` exports `topRegionAt`. It is tested and it has
**zero production consumers**. `RegionDeclaration`
(`packages/mod-sdk/src/frontend.ts:206`) has no input member of any kind.

`main.ts`'s tap-to-move handler (`packages/web/src/main.ts:8623`) gates on
`scoresOpen`, `dead`, `modalDepth`, the `mouse_movement` option and the map
rectangle, and on nothing else:

```ts
canvas.addEventListener("pointerdown", (ev) => {
  if (scoresOpen || dead || modalDepth > 0) return; // a modal owns input
  if (!(state.options?.get("mouse_movement") ?? true)) return;
  const cell = term.cellAt(ev.clientX, ev.clientY);
  if (!cell) return;
  const { col, row } = cell;
  const vp = viewport();
  const sx = col - vp.mapOriginX;
  const sy = row - vp.mapTop;
  if (sx < 0 || sy < 0 || sx >= vp.mapCols || sy >= vp.mapRows) return; // HUD tap
  ...
```

The map rectangle is the only spatial question asked. A mod's `overlay`-band
region drawn over the map is inside that rectangle, so:

- **tapping a mod's own panel walks the player's character**, and
- a long-press there (`main.ts:8683`, via `contextClickGrid` at `main.ts:2788`,
  which repeats the identical map-rect test) opens the game's context menu for
  the dungeon square *underneath* the panel.

Both are live today. `samples/sprite-inventory` ships a real `regions()` panel
(`samples/sprite-inventory/plugin.js:633`) that exhibits both.

---

## The rule

A region owns input on the cells it drew, not across its whole rectangle.

This matches how regions already behave visually. A region is transparent wherever it did not write a cell. There is no transparency flag and no alpha channel: an unwritten cell is the whole of `region-surface.ts`'s transparency implementation. With input following the same rule, an author only has one rule to remember: you own what you drew.

Rectangle ownership would let a radial dial with a transparent centre block tap-to-move across its entire bounding box, so a mod would block input in places where nothing of it is visible.

The cost is that the compositor has to record which region owns each cell, which it did not do before this change. Most of this document is about that retention. It takes real design work but is not infeasible, and section 1 measures what it costs at runtime.

---
## 1. Per-region cell ownership

### Where it is captured: at paint time, at the write

Ownership is recorded while a region paints rather than declared up front, because a declaration is a rectangle and the rule is about cells.

`clipSurface` (`packages/web/src/region-surface.ts:75`) is the one function every region write already passes through. Every `put`, `print`, `eraseToEol`, `prt` and `clear` a region performs goes through it, and each is already bounds-checked there against the region's own rectangle. Ownership capture is a witness added at those checks, so it needs no new pass over the grid and no second definition of "inside a region".

`clipSurface` gains one optional parameter:

```ts
/** Told, in region-local cells, about every cell this surface actually writes. */
export type CellWitness = (x: number, y: number) => void;

export function clipSurface(
  surface: ClippableSurface,
  cells: RegionCells,
  witness?: CellWitness,
): GridSurface
```

The parameter is optional, so every existing caller (`regionSurface` at `ui-stack.ts:429`, and the doubles in `ui-stack.test.ts` and `region-surface.test.ts`) compiles and behaves as before.

Which calls claim cells:

| Call | Claims | Why |
|---|---|---|
| `put(x, y, glyph)` | that one cell | it wrote a glyph |
| `print(x, y, text, ...)` | the clipped span `[from, to)` on row `y` | the same span it actually hands the host |
| `eraseToEol(x, y)` | `x .. cells.cols` on row `y` | see below |
| `clear()` | every cell of the rectangle | `clear()` is `rows` x `eraseRow` |
| `prt(x, y, ...)` | the erased row, then the printed span | it is composed of the two above |
| `setCursor` | nothing | a cursor occludes nothing; it does not change what a cell shows |

**An erase claims its cells**, and this is the most important decision in the design. It is tempting to say an erase writes nothing and so owns nothing, but `samples/sprite-inventory/plugin.js` shows why that is wrong. Its `paint()` opens with `surface.clear()`, and its own comment explains why:

> IT CLEARS FIRST, and that is what makes it opaque. Transparency here is not a flag and not an alpha - it is a cell that was not written - so a panel that wants a background asks for one, and a panel that wants the map showing through simply does not draw those cells.

An erased cell is blank, and the map does not show through it. If erasing did not claim, every panel with a background would let taps through its own background, which is the original defect under a different mechanism. Because erasing does claim, the sample's panel blocks input with no change to the sample, while a radial dial that leaves its centre untouched still lets taps through at the centre.
### Storage shape

Ownership is a flat `Int32Array` with one index per cell, held by `ui-stack.ts` beside `ordered` and `owners`:

```ts
/* Which region owns each cell of the frame currently on screen, as an index into
 * `frame` (the snapshot paintRegionStack took), or -1 for nobody. */
let ownership = new Int32Array(0);
let ownershipCols = 0;
let ownershipFrame: readonly LiveRegion[] = [];
```

Each entry is an index into `paintRegionStack`'s existing `const frame = ordered` snapshot, rather than an id string or a `LiveRegion` reference. Ids do not work because two screens may legitimately be open under the same id: `ui-stack.ts:117-123` gives that as the reason `owners` is keyed by object identity rather than by name, and a plane of ids would have the same problem. Object references would work, but an `Array<LiveRegion | undefined>` of 1920 slots is 1920 pointers for the GC to scan every frame to hold what is one small integer, while an `Int32Array` is a fixed 7,680-byte allocation that never moves.

The `frame` snapshot is the array to index because `paintRegionStack` already takes it, and `ui-stack.ts:340-363` records why: a `paint()` that changes the stack rebuilds `ordered` and `owners` mid-frame, and every region above the changed one silently missed a frame. The ownership plane has to describe the frame that was painted, so it indexes the same snapshot for the same reason.

The array is reallocated only when `cols * rows` changes:

```ts
const { cols, rows } = host.size();
if (ownership.length !== cols * rows) ownership = new Int32Array(cols * rows);
ownershipCols = cols;
ownership.fill(-1);
ownershipFrame = frame;
```
### Cost per frame

Production runs the fixed 80x24 grid, 1,920 cells: `term.ts:307-308` sets `FIXED_COLS = 80` and `FIXED_ROWS = 24`, and `main.ts:727` constructs `new GlyphTerm(canvas)` with no options, so `reflow` defaults to `false` (`term.ts:459-461`). Reflow mode is opt-in and is not what the shell ships.

`liveRegionStack()` is `baseRegionStack` (4 regions in the Left layout, 3 under sidebar `none`) plus one entry per `pushRegion`. What the tree contains today:

- Base regions: 4. They have no `spec` and no `paint`, so `baseRegionStack` (`regions.ts:413`) builds their `LiveRegion`s directly. They never write through `clipSurface` and never claim a cell; core's own `render()` draws them.
- Core screens: 1 at a time, plus one more per nested modal. They come from the 14 `pushRegion` sites in `birth.ts`, `charsheet.ts`, `mod-browse.ts` and `overlay.ts`, plus one in `region-runtime.ts`, and each screen releases its region on close.
- Mod regions: 1. `samples/sprite-inventory:carried` is the only `regions()` declaration in the tree. `samples/blueprint-view` and `samples/vitals-panel` mention regions only in prose, and `samples/command-dial` uses the menu seam.

That makes the largest case in the tree 6 regions (4 base, 1 open core screen, 1 mod panel), and at most 2 of them ever write through `clipSurface`. The cost scales with cells written rather than with region count, so an unbounded number of future mods does not multiply it.

Timings below are from Node v24.15.0, the repo's baseline major, using a witness closure called once per cell as the design specifies, which is the real indirection, rather than a direct array store. The benchmark script is not committed.

| Case | Per frame (microseconds) |
|---|---|
| `ownership.fill(-1)` alone, 1,920 cells | 0.041 |
| Shipped sample: `clear()` of a 24x9 panel + 9 label prints = 414 cell marks | 0.392 |
| Pathological: 8 regions each claiming all 1,920 cells = 15,360 marks | 7.6 |

0.392 microseconds is 0.0024% of a 16.7 ms frame, and the 7,680-byte allocation happens once. The pathological case is 0.046% of a frame and needs eight mods each calling `clear()` on the entire terminal every frame, at which point compositing costs far more than this bookkeeping.

The retention takes design effort but costs almost nothing at runtime, and none of these numbers supports the fallback discussed under "If the retention were infeasible".
### When it is invalidated

The plane is reset at the top of `paintRegionStack`, filled while it runs, and read until the next call, so it always describes the frame currently on screen. That is the only state in which "you own what you drew" can be true.

Three cases might look like gaps:

1. **A region whose `place()` moved between frames.** The plane is rebuilt from nothing each frame, so it moves with the rectangle and nothing needs invalidating.
2. **A core screen painting through `regionSurface` outside a frame.** A screen repaints from its own key loop, and `render()` does not run while it owns the terminal (`ui-stack.ts:140-147` records this). Its writes go through `clipSurface` and mark the plane with no reset in between, so the plane describes a mixture. This is harmless: every one of those screens is inside `openModal` (`main.ts:1861`), so `modalDepth > 0` and every pointer handler in `main.ts` has already returned before the plane is consulted. It gets no extra reset, because a second reset point would give two different answers to which frame the plane describes.
3. **A mod region with no painter.** This cannot happen: `regionDeclarationFault` (`region-runtime.ts:188`) refuses a declaration with no `paint`.

### Overdraw: a cell written by a low region and then by a high one

The cell belongs to the higher region. `paintRegionStack` iterates `frame` bottom to top, so the topmost region writes a cell last, and a plain last-writer-wins store gives the right answer with no comparison at all.

This follows from the rule itself: the player sees what the topmost writer drew at that cell, so that region gets the tap, and any other answer would send a tap to a region whose pixels are not there. It is also the invariant `topRegionAt` (`regions.ts:345`) already documents, "the composite has to be a function of the region set, not of the order some Map happened to iterate in", applied to cells instead of rectangles.
### What happens to `topRegionAt`

`topRegionAt` stays as it is and does not become the input router. It answers which region's rectangle is on top at a point, which is the right question for a front end asking about layout and the wrong one for a tap. `occludersOf` uses the same rectangle model and is also untouched. Milestone 7 gives a production consumer to the cell question, not to `topRegionAt`, so `topRegionAt` still has none.

---

## 2. Which event classes route

Every listener the shell attaches, in registration order, as it appears in the source:

| # | Where | Event | Target | What it does |
|---|---|---|---|---|
| 0 | `term.ts:499` (GlyphTerm constructor) | `pointerdown` | canvas | delivers to the active `setActiveCellTap` owner; `preventDefault()` + **`stopImmediatePropagation()`** |
| 1 | `main.ts:8634` | `pointerdown` | canvas | **tap-to-move** |
| 2 | `main.ts:8689` | `contextmenu` | canvas | **desktop right-click -> context menu** |
| 3 | `main.ts:8731` | `pointerdown` | canvas | **touch long-press** (450 ms) -> same context menu; a second finger while one is pending is ignored |
| 4 | `main.ts:8758`, `:8759` | `pointerup`, `pointercancel` | canvas | cancel the long-press timer if the lifting pointer is the one that started it (#277); nothing else |
| 5 | `main.ts:8760` | `pointermove` | canvas | for the pressing pointer only, cancel the long-press if that finger left the cell; **no hit-testing** |
| - | `main.ts:4350`, `:4416`, `:7647` | `pointerdown` | canvas | transient per-loop taps (targeting, locate); every one raises `modalDepth` first (`main.ts:4298`) |
| - | `main.ts:7674` | `pointerdown` | window, capture | dismiss-on-click for one transient prompt |
| - | `main.ts:8378` and 8 others | `keydown` | `inputEvents` | keyboard; **never** the canvas |

Two classes of event route in this milestone: tap, and long-press/context. They are rows 1, 2 and 3 of the table, two player-visible gestures across three listeners, and all three share one routing decision.

Hover is out of scope because the shell has no hover handling to route. Row 5 is the only `pointermove` on the canvas, and it exists to cancel a long-press: it ignores every pointer except the one holding the press, compares the cell against `longPressTarget`, and never asks who owns anything. The shell has no hover state anywhere, with no enter or leave events, no tooltip and no highlight. Supporting hover would mean adding a new event class. That needs enter/leave bookkeeping so a region hears when the pointer arrives and when it leaves, a decision about whether a region hears about movement within itself, a decision about what happens when a region moves out from under a stationary pointer, and a repaint policy for whatever the region draws in response. The shell has no existing answer to any of those.

Routing an existing event is a guard inserted into a handler that already runs. Adding an event class is new state that has to stay correct across resize, relayout, region withdrawal and mod teardown. The two do not belong in one milestone, and this milestone exists to stop taps on a panel from walking the player. Hover can come later, and the ownership plane built here is the only thing from this milestone it will need.

Keyboard input is not routed and will not be; see the "Out of scope: the focus model" section.

---
## 3. Composition with `setActiveCellTap`

The two already compose without any merging: `setActiveCellTap` always wins, and region routing never sees the event.

How that works in the source:

1. `GlyphTerm` registers its own `pointerdown` listener in its constructor (`term.ts:499`). `main.ts:727` constructs the term before adding any listeners of its own, so the term's handler is first in the canvas's listener list, as the constructor comment says: *"registered ONCE here, ahead of the shell's own canvas pointerdown listeners"*.
2. When an owner is registered, that handler calls `stopImmediatePropagation()` (`term.ts:502`) rather than `stopPropagation`, so no later listener on the canvas runs at all.
3. `setActiveCellTap` (`term.ts:173`) allows only one owner: registering a new owner disposes the previous one.

Region routing goes into handlers 1, 2 and 3 in the table above, all registered after the term's. While a `setActiveCellTap` owner holds the tap, the region router is never reached, so it cannot disagree.

This is also the right behaviour. All 31 `setActiveCellTap` call sites (`birth.ts`, `charsheet.ts`, `command-menu.ts`, `knowledge.ts`, `monster-list.ts`, `news.ts`, `overlay.ts`, `shop.ts`) are core screens that own the keyboard inside `openModal`, and a screen that owns the keyboard owns the pointer too. A mod's decorative panel taking taps through an open inventory would be the same defect this milestone fixes, in the other direction.

One consequence belongs in the author docs: a mod region does not receive taps while a core screen is up. That comes from the modal protocol rather than from the region seam, and the mod's panel is inactive during a modal for the same reason the map is.

A mod's handler receives taps in the same shape `setActiveCellTap` already uses. `regionSurface` (`ui-stack.ts:444-466`) already translates a tap into region-local cells for a core screen holding a region: *"a painter written against the terminal reads taps in the same coordinates it draws in"*. A mod's `input` handler gets region-local cells for the same reason. `paint`'s `(0, 0)` and `input`'s `(0, 0)` are the same cell, so the author never redoes arithmetic the host has already done.

---
## 4. Composition with `modalDepth`

Both stay. They share the word "modal" but do different jobs:

| | `modalDepth` (`main.ts:1817`) | `RegionLayer "modal"` (`regions.ts:255`) |
|---|---|---|
| Answers | *is something else using the terminal and the keyboard right now* | *how high do I paint* |
| Set by | `openModal` (`main.ts:1861`), incremented/decremented around a screen | a mod naming a band in its declaration |
| Scope | the whole shell: every pointer handler and the key handler stand down | one region's position in `orderRegions`' bucket list |
| Grants input | yes, exclusively, to the modal | **no** |

`RegionLayer` is documented as paint order and nothing else; `regions.ts` calls the bands *"bottom to top. Paint order, and the order `orderRegions` concatenates in"*. `modalDepth` is documented as input ownership: *"while a full-screen overlay owns the keyboard, the in-game key handler stands down, exactly the single-owner input model of the upstream UI"*.

A mod's `"modal"`-band region never raises `modalDepth`, and that is what keeps the player safe here. If a band name could take the keyboard, any mod could stop the player reaching the mod manager just by declaring that band. `regions.ts:246-249` records `blueprint-view` causing that failure (*"costing the player their hit points, their messages and the Mods screen at once"*), and reserving the `system` band exists to prevent it.

The cost is that a mod cannot build a true modal through the region seam. It gets a rectangle that paints high and swallows taps on the cells it drew, while the player keeps every key. A mod that needs to ask the player something uses `menu()` or `screen()`, the seams built for taking input (`mod-plugin.ts`: *"a menu is ASKED, so the boundary is `ask(question) -> answer` rather than `present(frame)`"*).

The band keeps its name. Renaming it to `"top"` to end the clash of words would break every shipped `RegionDeclaration`, and documenting the difference, as above, removes the confusion at far lower cost.

---
## 5. The unclaimed case

A tap on a cell no region owns reaches core along exactly the path it took before this change. The plane answers `-1`, the router returns `undefined`, and the handler runs the body it already had.

The full path:

1. `pointerdown` fires on the canvas.
2. `GlyphTerm`'s listener (`term.ts:499`) runs first. `this.tapCb` is null because no modal owns the tap, so it returns at once without calling `stopImmediatePropagation`, as before.
3. `main.ts:8623` runs, with the same `scoresOpen`/`dead`/`modalDepth` gates as before.
4. `term.cellAt(ev.clientX, ev.clientY)` returns `{ col, row }`, or `null` off the grid. This call already existed; it only moves two lines earlier.
5. New: `regionInputAt(col, row)` reads `ownership[row * ownershipCols + col]`, finds `-1` and returns `undefined`, so the handler carries on.
6. The `mouse_movement` option gate, the map-rect test, the `Math.sign` keypad arithmetic, `pendingChestAction` and `queueWalk(dir)` all run unchanged, in the same order and with the same values.

On an unclaimed cell the only difference in behaviour is that `term.cellAt` now runs before the `mouse_movement` check instead of after it. Both are pure guards that return without side effects, so swapping them cannot change any outcome. The swap is needed because the region check needs a cell, and it has to run whether or not the player has tap-to-move switched on, since a mod's panel belongs to the mod either way.

The test in section 8 uses the unclaimed cell as its control, and that is the assertion that fails if the plane is ever filled too eagerly. A `clear()` that claimed the whole terminal instead of its own rectangle would kill every tap in the game, and this check would catch it.

---
## 6. The API a mod author writes

### The type

In `packages/mod-sdk/src/frontend.ts`, beside `RegionSurface`:

```ts
/**
 * A pointer landing on a cell YOUR region drew.
 *
 * Coordinates are REGION-LOCAL, the same ones `paint` draws in: (0, 0) is your
 * rectangle's top-left, not the terminal's. The host has already done the
 * arithmetic; doing it again is how a panel that moves on resize starts
 * answering about the wrong cell.
 */
export interface RegionPointer {
  readonly col: number;
  readonly row: number;
  /** How the player asked. `tap` is a click or a touch; `context` is a
   *  right-click or a long-press. There is no `hover`: see REGION_INPUT.md. */
  readonly kind: "tap" | "context";
}

export interface RegionDeclaration {
  readonly id: string;
  readonly layer: ModRegionLayer;
  place(grid: { readonly cols: number; readonly rows: number }): RegionCells;
  paint(surface: RegionSurface): void;
  /**
   * A pointer landed on a cell you drew. OPTIONAL, and its absence does not mean
   * the tap goes through you - see below.
   */
  input?(pointer: RegionPointer): void;
}
```

### Ownership is positional and total

`input` returns `void`. There is no `boolean` "handled" result, so a region cannot pass a tap through a cell it drew.

A `false` return would mean "I drew here but the tap is not mine", which puts a tap-through under visible mod pixels. That is the class of bug rectangle ownership causes, except that an author's typo would trigger it instead of geometry.

A missing `input` does not make a region input-transparent either. `sprite-inventory` ships with no `input` member, and if absence let taps through, this change would fix the defect for none of the shipped mods. A region without `input` still owns its cells and swallows the pointer silently: `input` supplies the handler, never the ownership.

A region that wants the map tappable through it uses the option it already has for visibility, which is not drawing those cells.

The cost is that a purely decorative frame that draws a border becomes a thin strip where taps do nothing. That cost is small, and the alternative brings back the defect. An author who minds can leave the border out.
### When a mod's `input` throws

The codebase already has three ways of containing a mod fault, and they are not interchangeable:

| Precedent | Where | Treatment |
|---|---|---|
| `hooks()` throwing **mid-turn** | `mod-hooks.ts:220-238` (`hookThrew`) | `reportModFault` + **`taintSession`**: the game stops saving, the player is told now |
| `place()` throwing | `ui-stack.ts:200-222` | faulted out of the stack until the next relayout |
| `paint()` throwing | `region-runtime.ts:223-243` | **ONCE, then out**: reported once, `broken = true`, handle released, region withdrawn |

The mid-turn rule does not apply here. `taintSession` exists because a hook that throws leaves game state half-updated, so every later turn is time the player will lose (`mod-taint.ts:14-16`). A pointer handler runs between turns, before any command is queued, so nothing in the engine is half-done. Stopping the player's saves because a mod's panel mishandled a tap would be far out of proportion to the fault, and would give authors a reason to distrust the seam.

`input` follows `paint()`'s rule, with one difference:

```ts
input: (pointer) => {
  if (inputBroken) return;
  try {
    declaration.input!(pointer);
  } catch (error) {
    /* ONCE, and then off. A handler that throws on one tap throws on all of
     * them, and a fault report per tap is a worse experience than one report
     * and a panel that no longer responds. */
    inputBroken = true;
    reportFault(
      modId,
      `its "${declaration.id}" region failed while handling a tap, so that panel no ` +
        `longer responds to the pointer; it is still drawn, and taps on it still do ` +
        `not reach the game. input(pointer) must not throw`,
      error,
    );
  }
},
```

The difference is that the region is not withdrawn and its cells stay claimed. `paint()` withdraws a region because one that has stopped drawing is a phantom occluder: a replacement front end asking `occludersOf(stack, "map")` would stand its canvas down for a rectangle showing nothing (`region-runtime.ts:31-40`). A region whose `input` threw is still drawing correctly, and withdrawing it would remove a working panel over a pointer bug. Releasing only the claim would be worse than either: the panel would stay visible while taps on it walked the player through it, which is the original defect again. A broken handler therefore leaves a panel that is drawn but ignores taps.

The fault goes through the same `reportFault` every other region fault uses, so it appears on that mod's row in the manager, and the message says what the author has to fix.

---
## 7. The four-place ABI does not apply

The four-place `ModPlugin` agreement is not engaged, because this change publishes nothing on `ModPlugin`. Adding a member there for consistency would add a `ModPlugin` member with no purpose.

The agreement is machine-checked by `packages/mod-sdk/src/plugin-abi-agreement.test.ts`, which lives in `packages/mod-sdk/src/`, not in `packages/web/src/`. It reads both files as text and compares exactly two things:

```ts
// plugin-abi-agreement.test.ts:40, the host's member list
const body = /export interface ModPlugin \{([\s\S]*?)\n\}/u.exec(hostSrc)?.[1] ?? "";
return [...body.matchAll(/^\s{2}(\w+)\?\(/gmu)].map((m) => m[1]!).sort();

// :46, the builder's
const list = /for \(const name of \[([^\]]*)\]\)/u.exec(builderSrc)?.[1] ?? "";
```

`input?` on `RegionDeclaration` is invisible to both: the first regex only looks inside the `ModPlugin` interface body, and the second only at the builder's literal array. The do-nothing sentence is also a list of `ModPlugin` members and stays as it is.

The builder could not validate `input` anyway. `pluginProblem` (`packages/mod-sdk/bin/neo-angband-mod-build.mjs:326-348`) is `typeof` checks on the plugin object, and reaching `input` would mean calling `regions(ctx)` at build time with a context that does not exist. The host has always validated the declaration's shape at install, which is why `regionDeclarationFault` exists.

Three places do need to agree, and they are not the four ABI places:

| # | File | What it needs |
|---|---|---|
| 1 | `packages/mod-sdk/src/frontend.ts` | `RegionPointer` interface + `input?` on `RegionDeclaration`, with the "absence is not transparency" note in the doc comment. `packages/mod-sdk/src/index.ts:201` re-exports the *type name* `RegionDeclaration` already; add `RegionPointer` beside it. |
| 2 | `packages/web/src/region-runtime.ts:155` (`regionDeclarationFault`) | one arm: `if (d.input !== undefined && typeof d.input !== "function") return \`region "${d.id}" has an input that is not a function; ...\``, placed after the `paint` check, reading `d` as `unknown` fields exactly as the existing arms do (`region-runtime.ts:159-165` explains why). |
| 3 | `packages/web/src/region-runtime.ts:208` (`specFor`) | forward `input` with the containment of section 6, onto `RegionSpec.input?`. |

`RegionSpec` in `ui-stack.ts:65` also gains `input?(pointer): void`, but that is a host-internal type and not part of any ABI.

Two ratchets stay where they are:

- `tools/api-surface.mjs` records runtime exports only, and a type is not one. `RegionPointer` is a type and `RegionDeclaration.input` is a member of one, so neither baseline moves for this work. The tool watches two surfaces, `packages/core/mod-api-surface.json` and `packages/mod-sdk/mod-sdk-api-surface.json` (the second since `ctx.authoring` landed), and neither records types.
- `MOD_COMPATIBILITY.md` records removals. An optional member is additive, and no existing plugin changes meaning.

---
## 8. The test that proves it

A new `packages/web/src/region-input.node.test.ts` sits beside `packages/web/src/sample-inventory-region.node.test.ts` (milestone 6's test) and is built the same way, with nothing mocked. The declaration comes from `samples/sprite-inventory/plugin.js` on disk and the capability from its real manifest, `installRegions` is the shell's own installer, and the picture is read off a real cell grid after a real `paintRegionStack`. It reuses that file's `GridDouble`, `LAYOUT` (60x14, Left layout, sidebar 0..12, map at column 13), `loadSample()`, `candidate()` and `paintLiveMap()` shapes.
### The RED assertion

```ts
it("MILESTONE 7: a tap on the mod's panel does not walk the player", async () => {
  const plugin = await loadSample();
  const term = new GridDouble();
  relayoutStack({ cols: COLS, rows: ROWS, base: LAYOUT });
  withFakeDocument(() => {
    plugin.screen!(CONTEXT)!.show(inventoryView([item("a", "a Potion of Cure Light Wounds")]));
  });
  installRegions([candidate(plugin)], () => CONTEXT, () => {}, { cols: COLS, rows: ROWS });
  paintLiveMap(term);
  paintRegionStack(term);

  /* TODAY'S GATE, written out as the predicate main.ts applies and nothing more:
   * `main.ts:8633-8635` and `contextClickGrid` at `:2793-2795` both compute it.
   * This is what "the tap walks the player" MEANS, so the test states it rather
   * than describing it. */
  const map = LAYOUT.map.cells;
  const wouldWalk = (col: number, row: number): boolean =>
    col >= map.col && row >= map.row &&
    col < map.col + map.cols && row < map.row + map.rows;

  /* The panel's top-left cell. It is inside the map rectangle - which is the
   * whole defect - and the sample DREW it, because paint() opens with clear(). */
  const panel = liveRegionStack().find((r) => r.id === "sprite-inventory:carried")!;
  const col = panel.cells.col;
  const row = panel.cells.row;
  expect(wouldWalk(col, row), "the fixture stopped exercising the defect").toBe(true);
  expect(term.cells[row]![col], "the sample stopped drawing this cell").not.toBe(null);

  /* THE ASSERTION. RED today: `regionInputAt` does not exist, so the shell has
   * no answer to this question at all and the tap becomes a step. */
  const owner = regionInputAt(col, row);
  expect(owner?.region.id).toBe("sprite-inventory:carried");
  expect(owner?.local).toEqual({ col: 0, row: 0 }); // region-local, as paint() draws
});
```

The assertion fails against the code before this change because `regionInputAt` is not exported from `ui-stack.ts`. The shell cannot tell the panel's top-left cell from the dungeon floor beside it, which is why the tap walks.
### Three more assertions

```ts
it("leaves an unclaimed map cell exactly as it was, the control", () => {
  /* This control has a failure mode, which is what makes it worth writing: a
   * clear() that claimed the TERMINAL instead of the rectangle would kill every
   * tap in the game, and nothing else in this file would notice. */
  const map = LAYOUT.map.cells;
  expect(regionInputAt(map.col, map.row + map.rows - 1)).toBeUndefined();
});

it("does NOT claim a cell inside its rectangle that it did not draw", () => {
  /* THE RULING, and the case the shipped sample cannot exercise because its
   * place() sizes rows to its content and its clear() fills them. A hand-written
   * ring region is legitimate HERE, because the subject is the compositor's rule
   * rather than the shipped path - which the test above owns. */
  // a 5x5 region that draws only its border: the centre stays the live map,
  // and a tap there must reach core.
});

it("gives an overdrawn cell to the HIGHER region", () => {
  /* Two overlay regions, later-loaded on top, both writing one cell. The answer
   * must be the one whose glyph is on screen - anything else routes a tap to
   * pixels that are not there. */
});
```

### The shipped-path pin

A unit test on the compositor cannot tell whether `main.ts` ever asks. That gap has caused repeated bugs in this repository (`main-regions.test.ts:63-67` names #245, #246 and #247), so a new `packages/web/src/main-region-input.test.ts` uses the same instrument as `main-regions.test.ts` and `display-wiring.test.ts`: the TypeScript AST over `main.ts`'s source. Like any source-text guard, it proves the call is written, not that the pixels moved.

```ts
/* All three routable handlers ask, and ask BEFORE they decide. The ordering is
 * the assertion: a region check after the map-rect test is a check that never
 * runs on the cells that matter, and it would pass a presence-only assertion. */
for (const handler of [tapHandler, contextHandler, longPressHandler]) {
  expect(handler).toContain("regionInputAt(");
  expect(handler.indexOf("regionInputAt(")).toBeLessThan(handler.indexOf("vp.mapCols"));
}
/* And that the option gate did not swallow it: a mod's panel is the mod's
 * whether or not the player has tap-to-move switched on. */
expect(tapHandler.indexOf("regionInputAt(")).toBeLessThan(tapHandler.indexOf("mouse_movement"));
```

---
## 9. File-by-file implementation plan

Ordered so each step compiles and the suite stays green. Steps 1-4 are inert:
nothing consults the plane until step 6.

**1. `packages/web/src/region-surface.ts`**: the witness.
- After the `ClippableSurface` type (~:37): add `export type CellWitness`.
- `clipSurface` (:75): third optional parameter `witness?: CellWitness`.
- `eraseRow` (:84): after the bounds check, `if (witness) for (let x2 = Math.max(0, x); x2 < cells.cols; x2++) witness(x2, y);`
- `put` (:133): after `if (!inside(x, y)) return;`, `witness?.(x, y);`
- `print` (:138): after `const to = ...; if (to <= from) return;`, `if (witness) for (let x2 = from; x2 < to; x2++) witness(x2, y);`
- `clear` and `prt` need nothing: they are composed of the above.
- `setCursor` deliberately does not witness. Comment it, or someone adds it later.

**2. `packages/web/src/ui-stack.ts`**: the plane, and the read.
- `RegionSpec` (:65): add `input?(pointer: { col: number; row: number; kind: "tap" | "context" }): void;` with a comment that ownership is positional and this only supplies the handler.
- Module state, beside `owners` (:123): `ownership`, `ownershipCols`, `ownershipFrame` as in section 1.
- `paintRegionStack` (:338): after `const frame = ordered; const by = owners;`, size/reset the plane and set `ownershipFrame = frame`. Inside the loop, replace `clipSurface(host, region.cells)` (:379) with a witness-carrying call bound to that region's index in `frame`.
- `resetRegionStack` (:317): clear all three, or a test leaks a frame into the next.
- **New export** `regionInputAt(col, row)`, returning `{ region, spec, local } | undefined`. `spec` comes from the existing `owners` map: the entry is already there, no new lookup table.

**3. `packages/mod-sdk/src/frontend.ts`**: the author-facing type.
- `RegionPointer` before `RegionDeclaration` (~:205).
- `input?` on `RegionDeclaration` after `paint` (:217).
- Extend the interface's doc block (:176-205) with the paragraph the "THERE IS NO
  LIST OF KEYS YOU WANT" block at :189-193 now needs beside it: **pointer input
  is positional, keyboard input is not offered.**

**4. `packages/mod-sdk/src/index.ts`**: add `RegionPointer` to the type re-export
list at :201.

**5. `packages/web/src/region-runtime.ts`**: validate and contain.
- `regionDeclarationFault` (:155): the `input` type arm, after the `paint` arm at :188.
- `specFor` (:208): `let inputBroken = false;` beside `let broken = false;`, and the
  `input` wrapper of section 6: reported once, handler off, **region and claim retained**.

**6. `packages/web/src/main.ts`**: the three call sites. This is the commit that
closes the defect; everything before it is unobservable.
- **Tap, `:8623`.** Move `const cell = term.cellAt(...)` and its null check above
  the `mouse_movement` gate at `:8628`. Insert between them:
  ```ts
  /* A region owns the cells it DREW. A mod's panel over the map is the mod's,
   * and the tap stops here rather than becoming a step through it (#276). */
  const owner = regionInputAt(cell.col, cell.row);
  if (owner) {
    ev.preventDefault();
    owner.spec.input?.({ ...owner.local, kind: "tap" });
    return;
  }
  ```
- **Context menu, `:8668`.** After the `modalDepth` gate at `:8670` and before
  `contextClickGrid` at `:8671`: the same block with `kind: "context"`, driven off
  `term.cellAt(ev.clientX, ev.clientY)`.
- **Long-press, `:8683`.** Same, after the gate at `:8684`, before
  `contextClickGrid` at `:8685`. Placing it before the timer is set means a
  long-press on a panel never *arms*, so `cancelLongPress` needs nothing.
- Add `regionInputAt` to the `./ui-stack` import at `:344`.
- Leave `contextClickGrid` (`:2788`) alone. It answers "which dungeon grid", and
  callers 2 and 3 have already returned before they reach it.

**7. `packages/web/src/region-input.node.test.ts`** (new) and **`packages/web/src/main-region-input.test.ts`** (new), per section 8.

**8. `samples/sprite-inventory/plugin.js`**: optional, but worth doing. The panel already has `carried[i].tag`, so an `input` that logs the tapped row through `ctx.log` turns the sample into a demonstration of the milestone rather than a passive beneficiary. The sample must keep working with the member removed, so the tree still has an example showing that a missing `input` does not make a region transparent.

**9. Docs.** `docs/modding/MOD_REACH.md` row 21 says consequence (4) is unbuilt and that `topRegionAt` has zero production consumers. Step 6 makes that sentence false, so it changes in the same commit and points at this document. That update landed in `a2d8cd0ea` together with the rest of the change.
### Verification order

Run `pnpm build` first. `packages/web` resolves `@rpgm-tools/neo-angband-mod-sdk` through its `exports` map, which points at `dist/`, so a `pnpm test` without a build tests the SDK as it was last compiled, and step 3 is a cross-package type change. Then run `pnpm test`, then `pnpm lint`. Do not run `prettier`.

---

## Out of scope: the focus model

Milestone 7 as first written also included a focus model: a D-pad walking a grid of item tiles inside a region. It is not designed here, because it conflicts with a rule already published to mod authors in `packages/mod-sdk/src/frontend.ts:189-193`:

> THERE IS NO LIST OF KEYS YOU WANT, and its absence is a decision rather than an omission. A region that declared the keys it wanted would be a second answer to "what does this key do" standing beside `registry:command`, and the result of two answers is a mod that silently takes `i` away from the player.

A focus model means a region consuming arrow keys and Enter while the player believes those keys still walk and confirm. That is what the published rule refuses, arriving by a different route. The rule's stated reason is the risk of two answers to "what does this key do", and that risk does not depend on how the keys are claimed. Routing keys by position instead of by declaration produces the same two answers and only hides the second, since nothing in the manifest or the plugin says which keys were taken.

Focus is also harder than pointer ownership, which limits itself: a tap has a location, and a location has one topmost drawer. Focus is stateful. It persists between events, has to survive a relayout that moves the region out from under it, has to be lost when the region is withdrawn, and needs a published answer to "who has focus now" that core and the mod agree on. None of that state exists in the shell, and the single-owner keyboard model (`modalDepth`, and `inputEvents` as *"the front end's single input door"*, `input-door.ts:1-8`) is built on the assumption that it does not. `docs/modding/README.md:72` states the same boundary from the other side: *"`input-door.ts` is host infrastructure, not a seam."*

Focus therefore needs a seam of its own. The open question for that seam is whether a region may take a keystroke the player has bound to something else, and if so, what tells the player it happened. Until that is answered, a D-pad design would be working around `frontend.ts:189-193` rather than following it. The ownership plane built here is what a focus model would hit-test against, so nothing here rules one out.

---
## If the retention were infeasible

It is feasible, as section 1 shows: 7,680 bytes allocated once, 0.392 microseconds per frame on the shipped sample, 0.0024% of a 60 Hz frame budget, and a per-frame cost that scales with cells written rather than with region count. Nothing measured argues for a fallback, so none is proposed, and rectangle ownership is not shipped quietly in its place.

---
## Core parity

"The port adds nothing" applies to core only, and core gains no capability here. A tap on a cell no mod drew reaches the same `queueWalk` along the same path with the same values (section 5), and upstream's `mouse_movement` gate and `textui_process_click` routing are untouched. What changes is that a mod's own panels stop being transparent to the pointer. That is a mod capability, and adding mod capabilities is what the gap-21 work is for. Faithful means gameplay parity, not code shape.
