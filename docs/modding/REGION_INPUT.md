# Input routed by region

**Ticket #276, gap 21, milestone 7. LANDED in `a2d8cd0ea`, 2026-08-14.** This
design was implemented as written: `regionInputAt` in `ui-stack.ts`, the
`RegionPointer` type and `input?` member in `frontend.ts`, and the three call
sites in `main.ts`, all covered by `region-input.node.test.ts` and
`main-region-input.test.ts`. What follows is now a historical design record:
read it for the *reasoning* (the cell-opaque ruling, the cost measurement, the
composition with `modalDepth` and `setActiveCellTap`), not as a to-do; section 9's
file-by-file plan and its RED-test listings describe a state the tree has since
moved past. Line numbers below were read on 2026-08-14 against
`work/parallel-2026-08-14` while four other streams edited the same tree, and
have not been re-verified against the landed commit.

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

**A region is opaque to input by CELL, not by rectangle.** Settled 2026-08-14.
This document designs to it and does not reopen it.

The reasoning, so the design follows it rather than works around it: a region is
already transparent *visually* wherever it did not write a cell: that is not a
flag and not an alpha, it is `region-surface.ts`'s entire implementation of
transparency. Making input agree means **"you own what you drew"** is one rule an
author never has to look up.

The rejected alternative, rectangle-opaque, creates a class of bug where a radial
dial with a transparent centre blocks tap-to-move across its whole bounding box,
a mod blocking input somewhere it visibly is not.

The known cost: **the compositor must retain per-region cell ownership, which it
does not do today.** Designing that retention is the bulk of what follows. It is
expensive rather than infeasible, and the cost is measured in section 1.

---

## 1. Per-region cell ownership

### Where it is captured: at paint time, at the write

Not declared up front. A declaration is a rectangle, and a rectangle is exactly
the model this rule rejects.

**`clipSurface` (`packages/web/src/region-surface.ts:75`) is the one choke point
every region write already passes through.** Every `put`, `print`, `eraseToEol`,
`prt` and `clear` a region performs goes through it, and each is *already*
bounds-checked there against the region's own rectangle. Ownership capture is a
witness added at those checks. It introduces no new traversal of the grid and no
second definition of "inside a region".

`clipSurface` grows one optional parameter:

```ts
/** Told, in region-local cells, about every cell this surface actually writes. */
export type CellWitness = (x: number, y: number) => void;

export function clipSurface(
  surface: ClippableSurface,
  cells: RegionCells,
  witness?: CellWitness,
): GridSurface
```

Optional, so every existing caller (`regionSurface` at `ui-stack.ts:429`, and
`ui-stack.test.ts` / `region-surface.test.ts`'s doubles) compiles and behaves
unchanged.

Which calls claim, and which do not:

| Call | Claims | Why |
|---|---|---|
| `put(x, y, glyph)` | that one cell | it wrote a glyph |
| `print(x, y, text, ...)` | the clipped span `[from, to)` on row `y` | the same span it actually hands the host |
| `eraseToEol(x, y)` | `x .. cells.cols` on row `y` | see below |
| `clear()` | every cell of the rectangle | `clear()` is `rows` x `eraseRow` |
| `prt(x, y, ...)` | the erased row, then the printed span | it is composed of the two above |
| `setCursor` | nothing | a cursor occludes nothing; it does not change what a cell shows |

**An erase CLAIMS, and this is the load-bearing decision of the whole design.**
The temptation is to say an erase writes nothing so it owns nothing. That is
wrong, and `samples/sprite-inventory/plugin.js` is the proof: its `paint()`
opens with `surface.clear()` and its own comment says why:

> IT CLEARS FIRST, and that is what makes it opaque. Transparency here is not a
> flag and not an alpha - it is a cell that was not written - so a panel that
> wants a background asks for one, and a panel that wants the map showing through
> simply does not draw those cells.

An erased cell is blank; the map is *not* visible through it. Under
erase-does-not-claim, every panel with a background would be input-transparent
across its own background, which is the defect, unchanged, wearing a new
mechanism. Under erase-claims, the sample's panel becomes input-opaque with no
change to the sample at all, and the radial dial that leaves its centre alone
still lets the tap through. Both halves of the rule hold.

### Storage shape

A **flat `Int32Array` of one index per cell**, held by `ui-stack.ts` beside
`ordered` and `owners`:

```ts
/* Which region owns each cell of the frame currently on screen, as an index into
 * `frame` (the snapshot paintRegionStack took), or -1 for nobody. */
let ownership = new Int32Array(0);
let ownershipCols = 0;
let ownershipFrame: readonly LiveRegion[] = [];
```

An index into `paintRegionStack`'s existing `const frame = ordered` snapshot,
**not** a `LiveRegion` reference and **not** an id string:

- **Not an id.** Two screens may legitimately be open under the same id;
  `ui-stack.ts:117-123` already records that as the reason `owners` is keyed by
  object identity rather than by name. A plane of ids inherits that same defect.
- **Not object references.** An `Array<LiveRegion | undefined>` of 1920 slots is
  1920 pointers the GC scans every frame, for information that is one small
  integer. `Int32Array` is a fixed 7,680-byte allocation that never moves.
- **The `frame` snapshot is exactly the right array to index.**
  `paintRegionStack` already snapshots it, and `ui-stack.ts:340-363` records why:
  a `paint()` that changes the stack rebuilds `ordered` and `owners` mid-frame,
  and every region above the changed one silently missed a frame. The ownership
  plane must describe the frame that was painted, so it indexes the same
  snapshot for the same reason.

Reallocated only when `cols * rows` changes:

```ts
const { cols, rows } = host.size();
if (ownership.length !== cols * rows) ownership = new Int32Array(cols * rows);
ownershipCols = cols;
ownership.fill(-1);
ownershipFrame = frame;
```

### Cost per frame, measured

**Grid dimensions.** Production is the **fixed 80x24 grid**: `term.ts:307-308`
(`FIXED_COLS = 80`, `FIXED_ROWS = 24`), and `main.ts:727` constructs
`new GlyphTerm(canvas)` with no options, so `reflow` defaults to `false`
(`term.ts:459-461`). **1,920 cells.** Reflow mode is opt-in and is not what the
shell ships.

**Live regions, worst case observed rather than imagined.** `liveRegionStack()`
is `baseRegionStack` (**4** in the Left layout, 3 under sidebar `none`) plus one
entry per `pushRegion`. Counting what is actually in the tree:

- **Base: 4.** They have no `spec` and no `paint`, so `baseRegionStack`
  (`regions.ts:413`) builds `LiveRegion`s directly, so they never write through
  `clipSurface` and never claim a cell. Core's own `render()` writes them.
- **Core screens: 1 at a time**, from the 14 `pushRegion` sites in `birth.ts`,
  `charsheet.ts`, `mod-browse.ts` and `overlay.ts`, plus one in
  `region-runtime.ts`. Each is released on close.
  Nesting adds one per nested modal.
- **Mod regions: 1.** `samples/sprite-inventory:carried` is the only `regions()`
  declaration in the tree; `samples/blueprint-view` and `samples/vitals-panel`
  discuss regions in prose only; `samples/command-dial` uses the menu seam.

So the worst case I can point at is **6** (4 base + 1 open core screen + 1 mod
panel), of which **2 at most ever write through `clipSurface`**. The mechanism's
cost scales with **cells written**, not with region count, which is the property
that makes an unbounded future mod count survivable.

**Measured** (Node v24.15.0, the repo's baseline major; script in scratchpad, not
committed). The design as written, a witness *closure* called once per cell,
which is the real indirection, not a direct array store:

| Case | Per frame |
|---|---|
| `ownership.fill(-1)` alone, 1,920 cells | **0.041 µs** |
| Shipped sample: `clear()` of a 24x9 panel + 9 label prints = **414 cell marks** | **0.392 µs** |
| Pathological: 8 regions each claiming all 1,920 cells = 15,360 marks | **7.6 µs** |

0.392 µs is **0.0024 %** of a 16.7 ms frame. Allocation is 7,680 bytes, once.
The pathological case is 0.046 % of a frame and requires eight mods each
`clear()`ing the entire terminal every frame, at which point the compositing cost
dwarfs the bookkeeping.

**The retention is expensive in design attention and free at runtime.** There is
no measurement here that argues for the fallback in the "If it were infeasible" section.

### When it is invalidated

**Reset at the top of `paintRegionStack`, filled during it, read until the next
one.** The plane therefore always describes the frame currently on screen, which
is the only description that can make "you own what you drew" true.

Three cases that look like gaps and are not:

1. **A region whose `place()` moved between frames.** The plane is rebuilt from
   nothing each frame, so it moves with the rectangle. Nothing to invalidate.
2. **A core screen painting through `regionSurface` outside a frame.** A screen
   repaints from its own key loop, and `render()` does not run while it owns the
   terminal (`ui-stack.ts:140-147` records exactly this). Its writes go through
   `clipSurface` and would mark the plane, but no reset intervenes, so the plane
   describes a mixture. **This is harmless and must be stated rather than fixed:**
   every one of those screens is inside `openModal` (`main.ts:1861`), so
   `modalDepth > 0` and every pointer handler in `main.ts` has already returned
   before the plane is consulted. Do not add a reset for it: a second reset point
   is a second answer to "which frame is this".
3. **A mod region with no painter.** Unreachable: `regionDeclarationFault`
   (`region-runtime.ts:188`) refuses a declaration with no `paint`.

### Overdraw: a cell written by a low region and then by a high one

**It belongs to the higher one.** `paintRegionStack` iterates `frame` bottom to
top, so the last write to a cell is the topmost region's, and a plain
last-writer-wins store gives the right answer with no comparison at all.

This is not a convenience. It is the rule restated: what the player sees at
that cell is what the topmost writer drew, so that is who owns the tap. Any other
answer routes a tap to a region whose pixels are not there. It is also the same
invariant `topRegionAt` (`regions.ts:345`) already documents, "the composite has
to be a function of the region set, not of the order some Map happened to iterate
in", narrowed from rectangles to cells.

### What happens to `topRegionAt`

**It stays, unchanged, and it is still not the input router.** It answers "which
region's *rectangle* is on top here", which is the right question for a front end
asking about layout and the wrong question for a tap. `occludersOf` uses the same
rectangle model and is likewise untouched. Milestone 7 does not give
`topRegionAt` a production consumer; it gives the *cell* question one. Say so
plainly in the commit, because "topRegionAt now has a consumer" is the sentence
someone will otherwise write.

---

## 2. Which event classes route

Read off the source, not assumed. Every listener the shell attaches, in
registration order:

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

**Two classes route in this milestone: TAP and LONG-PRESS/CONTEXT.** They are
rows 1, 2 and 3: three listeners, two player-visible gestures, one shared
routing decision.

**Hover is OUT, and the reason is that it does not exist.** Row 5 is the only
`pointermove` on the canvas and it is a long-press cancel: it ignores every
pointer but the one holding the press, then compares the cell against
`longPressTarget`, and never asks who owns anything. There is no hover state
anywhere in the shell: no enter, no leave, no tooltip, no highlight. Routing
hover is therefore not *routing* at all; it is **adding a new event class**:
enter/leave bookkeeping so a region is told when the pointer arrives and when it
goes, a decision about whether a region is told about movement *within* itself, a
decision about what happens when a region moves out from under a stationary
pointer, and a repaint policy for whatever the region draws in response. Every
one of those is a design question with no existing answer in this shell.

Routing an existing event is a guard inserted into a handler that already runs.
Adding an event class is new state that has to be kept correct across resize,
relayout, region withdrawal and mod teardown. **They do not belong in one
milestone**, and the milestone whose defect is "tapping a panel walks the player"
is not the one to carry it. Hover is a later increment; the ownership plane
designed here is exactly what it will need, and it will need nothing else from
this milestone.

**Keyboard is not routed and will not be**, and that is published rather than
implied; see the "Out of scope: the focus model" section.

---

## 3. Composition with `setActiveCellTap`

**They already compose, by construction. `setActiveCellTap` wins, absolutely, and
region routing never sees the event. Nothing merges.**

The mechanism, verified in the source rather than inferred:

1. `GlyphTerm`'s own `pointerdown` listener is registered **in its constructor**
   (`term.ts:499`). `main.ts:727` constructs the term before it adds any of its
   own listeners, so the term's handler is **first** in the canvas's listener
   list, and the constructor comment says so in as many words: *"registered ONCE
   here, ahead of the shell's own canvas pointerdown listeners"*.
2. When an owner is registered it calls **`stopImmediatePropagation()`**
   (`term.ts:502`). Not `stopPropagation`, but *immediate*. No later listener on the
   canvas runs at all.
3. `setActiveCellTap` (`term.ts:173`) enforces the one-owner policy above that:
   registering a new owner disposes the previous one, so there is never more than
   one.

Region routing is added to handlers 1, 2 and 3 in the table above, all of them
*after* the term's in registration order. So while a `setActiveCellTap` owner
holds the tap, the region router is not consulted, is not reached, and cannot
disagree.

**Which is correct, not merely convenient.** Every one of the 31
`setActiveCellTap` call sites (`birth.ts`, `charsheet.ts`, `command-menu.ts`,
`knowledge.ts`, `monster-list.ts`, `news.ts`, `overlay.ts`, `shop.ts`) is a core
screen that owns the keyboard inside `openModal`. A screen that owns the keyboard
owns the pointer. A mod's decorative panel receiving taps *through* an open
inventory would be the same defect this milestone closes, pointed the other way.

**The one consequence worth stating in the author docs:** a mod region does not
receive taps while a core screen is up. That is not a limitation of the region
seam, it is the modal protocol, and the mod's panel is not interactive during a
modal for the same reason the map is not.

**The shape a mod's handler receives is the shape `setActiveCellTap`'s already
is.** `regionSurface` (`ui-stack.ts:444-466`) already translates a tap into
**region-local** cells for a core screen holding a region: *"a painter written
against the terminal reads taps in the same coordinates it draws in"*. A mod's
`input` handler receives region-local cells for the identical reason: `paint`'s
`(0, 0)` and `input`'s `(0, 0)` must be the same cell or the author is doing
arithmetic the host already did.

---

## 4. Composition with `modalDepth`

**Both survive. They are not two mechanisms for one idea: the collision is in
the word "modal" and nowhere else.**

| | `modalDepth` (`main.ts:1817`) | `RegionLayer "modal"` (`regions.ts:255`) |
|---|---|---|
| Answers | *is something else using the terminal and the keyboard right now* | *how high do I paint* |
| Set by | `openModal` (`main.ts:1861`), incremented/decremented around a screen | a mod naming a band in its declaration |
| Scope | the whole shell: every pointer handler and the key handler stand down | one region's position in `orderRegions`' bucket list |
| Grants input | yes, exclusively, to the modal | **no** |

`RegionLayer` is documented as paint order and only paint order; `regions.ts`
calls the bands *"bottom to top. Paint order, and the order `orderRegions`
concatenates in"*. `modalDepth` is documented as input ownership: *"while a
full-screen overlay owns the keyboard, the in-game key handler stands down,
exactly the single-owner input model of the upstream UI"*.

**A mod's `"modal"`-band region MUST NOT raise `modalDepth`, and refusing that is
the safety decision of this section.** If a band name could take the keyboard,
any mod could take the player's ability to reach the mod manager by declaring a
band, which is precisely the failure `regions.ts:246-249` records
`blueprint-view` causing (*"costing the player their hit points, their messages
and the Mods screen at once"*) and precisely what reserving the `system` band
exists to prevent. A band name is not consent.

**Stated cost:** a mod cannot build a true modal through the region seam. It gets
a rectangle that paints high and swallows taps on the cells it drew, and the
player keeps every key. A mod that genuinely needs to ask the player something
uses `menu()` or `screen()`, the seams that are *shaped* as taking input
(`mod-plugin.ts`: *"a menu is ASKED, so the boundary is `ask(question) -> answer`
rather than `present(frame)`"*).

**Rename nothing.** Renaming the band to `"top"` to end the word collision would
break every shipped `RegionDeclaration`, and the confusion it removes is one
sentence of documentation. That sentence is this section.

---

## 5. The unclaimed case

**A tap on a cell no region owns reaches core on exactly the path it takes today,
byte for byte.** The plane answers `-1`; the router returns `undefined`; the
handler runs the body it already runs.

The path, end to end:

1. `pointerdown` fires on the canvas.
2. `GlyphTerm`'s listener (`term.ts:499`) runs first. `this.tapCb` is null: no
   modal owner, so it returns immediately without calling
   `stopImmediatePropagation`. **Unchanged.**
3. `main.ts:8623` runs. `scoresOpen`/`dead`/`modalDepth` gates as today.
4. `term.cellAt(ev.clientX, ev.clientY)` -> `{ col, row }`, or `null` off-grid.
   **Unchanged**: this call already exists, it only moves two lines earlier.
5. **New:** `regionInputAt(col, row)` reads
   `ownership[row * ownershipCols + col]`. It is `-1`, so the function returns
   `undefined` and the handler does not return.
6. The `mouse_movement` option gate, the map-rect test, the `Math.sign` keypad
   arithmetic, `pendingChestAction`, `queueWalk(dir)`: **all unchanged, in the
   same order, with the same values.**

The only behavioural difference on an unclaimed cell is that `term.cellAt` now
runs before the `mouse_movement` check instead of after. Both are pure guards
that return without side effects; swapping them cannot change any outcome. It is
required because the region question needs a cell, and the region question must
be asked whether or not the player has tap-to-move switched on: a mod's panel
belongs to the mod either way.

**Assert this, do not assume it.** The test in section 8 covers the unclaimed cell as
its control, and it is the assertion that fails loudest if the plane is ever
filled too eagerly. A control that only ever passes is not evidence; this one has
a failure mode: a `clear()` that claimed the terminal instead of the rectangle
would kill every tap in the game, and this is the assertion that would see it.

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

### Ownership is POSITIONAL and TOTAL. There is no "handled".

`input` returns **`void`**. A `boolean` return was considered and is refused.

- **It would be a second answer to a question the rule already settles.** The
  rule is "you own what you drew". A handler returning `false` would say "I
  drew here but the tap is not mine", which produces a tap-through under visible
  mod pixels, the exact bug class the rectangle model was rejected for, now
  reachable by an author's typo rather than by geometry.
- **A missing `input` must not mean input-transparent.** `sprite-inventory` ships
  today with no `input` member. If absence meant "let the tap through", this
  milestone would close the defect for exactly zero shipped mods and would ship
  the defect under a new name. **Absence means the region owns its cells and
  swallows the pointer silently.** `input` supplies the *handler*, never the
  *ownership*.
- **The escape hatch is the one authors already have.** A region that wants the
  map tappable through it does not draw those cells. That is the same sentence
  that already governs what the player can see, which is the whole benefit of the
  ruling.

**Stated cost:** a purely decorative frame that draws a border becomes a thin dead
zone for taps. That is a real cost, it is small, and the alternative reintroduces
the defect. An author who minds draws no border.

### When a mod's `input` throws

**Find the existing rule rather than inventing one.** This codebase has three
containment precedents, and they are not interchangeable:

| Precedent | Where | Treatment |
|---|---|---|
| `hooks()` throwing **mid-turn** | `mod-hooks.ts:220-238` (`hookThrew`) | `reportModFault` + **`taintSession`**: the game stops saving, the player is told now |
| `place()` throwing | `ui-stack.ts:200-222` | faulted out of the stack until the next relayout |
| `paint()` throwing | `region-runtime.ts:223-243` | **ONCE, then out**: reported once, `broken = true`, handle released, region withdrawn |

**The mid-turn rule does not apply and must not be borrowed.** `taintSession`
exists because a hook throwing leaves the game state half-updated and every
further turn is time the player will lose (`mod-taint.ts:14-16`). A pointer
handler runs *between* turns, before any command is queued; nothing in the engine
is half-done. Stopping the player's saves because a mod's panel mishandled a tap
would be a punishment out of all proportion to the fault, and it is the kind of
over-application that makes an author distrust the seam.

**The rule is `paint()`'s, with one deliberate difference:**

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

**The difference: the region is NOT withdrawn, and its cells stay claimed.**
`paint()` withdraws because a region that has stopped drawing is a phantom
occluder: a replacement front end asking `occludersOf(stack, "map")` would stand
its canvas down for a rectangle showing nothing (`region-runtime.ts:31-40`). A
region whose *input* threw is still drawing correctly; withdrawing it would erase
working furniture over a pointer bug. And releasing only the *claim* would be
worse than either: the panel would still be visible, and taps on it would start
walking the player through it, **the defect reappearing as the failure mode of
its own fix.** A broken handler leaves a dead panel, which is legible; it must not
leave a hole.

Reported through the same `reportFault` every other region fault uses, so it lands
on that mod's row in the manager with the fix in the sentence.

---

## 7. The four-place ABI: it is NOT triggered, and here is the proof

**The four-place `ModPlugin` list does not apply here. This milestone does not
publish anything on `ModPlugin`, so the four-place agreement is not engaged.**
Adding the member anyway "for consistency" would be adding a `ModPlugin` member
with no purpose.

The agreement is machine-checked by `packages/mod-sdk/src/plugin-abi-agreement.test.ts`
(note: it lives in `packages/mod-sdk/src/`, not in `packages/web/src/`).
It reads both files as **text** and compares exactly two things:

```ts
// plugin-abi-agreement.test.ts:40, the host's member list
const body = /export interface ModPlugin \{([\s\S]*?)\n\}/u.exec(hostSrc)?.[1] ?? "";
return [...body.matchAll(/^\s{2}(\w+)\?\(/gmu)].map((m) => m[1]!).sort();

// :46, the builder's
const list = /for \(const name of \[([^\]]*)\]\)/u.exec(builderSrc)?.[1] ?? "";
```

`input?` on `RegionDeclaration` is invisible to both: the first regex is scoped to
the `ModPlugin` interface body, the second to the builder's literal array. The
do-nothing sentence is likewise a list of `ModPlugin` members and does not change.

And the builder **cannot** validate it even in principle:
`pluginProblem` (`packages/mod-sdk/bin/neo-angband-mod-build.mjs:326-348`) is
`typeof` checks on the plugin object. Reaching `input` would mean *calling*
`regions(ctx)` at build time with a context that does not exist. The declaration's
shape has always been the host's to validate at install, which is why
`regionDeclarationFault` exists at all.

**The places that DO need to agree are three, and they are different places:**

| # | File | What it needs |
|---|---|---|
| 1 | `packages/mod-sdk/src/frontend.ts` | `RegionPointer` interface + `input?` on `RegionDeclaration`, with the "absence is not transparency" note in the doc comment. `packages/mod-sdk/src/index.ts:201` re-exports the *type name* `RegionDeclaration` already; add `RegionPointer` beside it. |
| 2 | `packages/web/src/region-runtime.ts:155` (`regionDeclarationFault`) | one arm: `if (d.input !== undefined && typeof d.input !== "function") return \`region "${d.id}" has an input that is not a function; ...\``, placed after the `paint` check, reading `d` as `unknown` fields exactly as the existing arms do (`region-runtime.ts:159-165` explains why). |
| 3 | `packages/web/src/region-runtime.ts:208` (`specFor`) | forward `input` with the containment of section 6, onto `RegionSpec.input?`. |

Plus `RegionSpec` in `ui-stack.ts:65` gains `input?(pointer): void`, which is a
host-internal type and not part of any ABI.

**Two ratchets confirmed not to move:**

- `tools/api-surface.mjs` reads `packages/core/dist/index.js` and writes
  `packages/core/mod-api-surface.json`: **core's runtime exports only**. The SDK
  is not in it. (Do not run it with `--update`; there is nothing for it to say.)
- `MOD_COMPATIBILITY.md` records *removals*. An optional member is additive; no
  existing plugin changes meaning.

---

## 8. The test that proves it

A new **`packages/web/src/region-input.node.test.ts`**, the direct sibling of
`packages/web/src/sample-inventory-region.node.test.ts` (milestone 6's test) and
built the same way: **nothing mocked.** The declaration comes out of
`samples/sprite-inventory/plugin.js` on disk, the capability out of its real
manifest, `installRegions` is the shell's own installer, and the picture is read
off a real cell grid after a real `paintRegionStack`. Reuse that file's
`GridDouble`, `LAYOUT` (60x14, Left layout, sidebar 0..12, map at column 13),
`loadSample()`, `candidate()` and `paintLiveMap()` shapes.

### The RED assertion: the defect in its own terms

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

It is RED against today's code for a reason the reader can name: `regionInputAt`
is not exported from `ui-stack.ts`, so the shell cannot distinguish the panel's
top-left cell from the dungeon floor beside it, which is why the tap walks.

### Three assertions that keep it honest

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

A unit test on the compositor cannot see whether `main.ts` ever asks. That is the
failure this repository keeps re-learning (`main-regions.test.ts:63-67` names
#245, #246, #247), so a new **`packages/web/src/main-region-input.test.ts`** uses
the same instrument `main-regions.test.ts` and `display-wiring.test.ts` use: the
TypeScript AST over `main.ts`'s source, and is worth exactly what a source-text
guard is worth: it proves the call is written, not that the pixels moved.

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

**7. `packages/web/src/region-input.node.test.ts`** (new) and
**`packages/web/src/main-region-input.test.ts`** (new), per section 8.

**8. `samples/sprite-inventory/plugin.js`**: optional, and worth it. The panel
already has `carried[i].tag`; an `input` that logs the tapped row through
`ctx.log` turns the sample into the milestone's demonstration rather than its
passive beneficiary. **The sample must keep working with the member removed**, so
that "absence is not transparency" has a witness in the tree.

**9. Docs.** `docs/modding/MOD_REACH.md` row 21 states, today, that consequence
(4) is unbuilt and that `topRegionAt` has zero production consumers. That
sentence becomes false with step 6 and **must move in the same commit**. This
document is the reference it should point at.

> **Note for the implementing stream:** this document was written under a
> constraint that permitted creating this file and editing no other. Step 9 was
> therefore not done and is not "already handled".
>
> **Update, post-landing:** it was done, in `a2d8cd0ea` itself; that commit
> touched `docs/modding/MOD_REACH.md` directly rather than deferring to this
> file, which is why this note was left uncorrected until 2026-08-15.

### Verification order

`pnpm build` **first**: `packages/web` resolves `@rpgm-tools/neo-angband-mod-sdk`
through its `exports` map, which points at `dist/`. A `pnpm test` that skips the
build measures the SDK as it was last compiled, and step 3 is precisely a
cross-package type change. Then `pnpm test`, then `pnpm lint`. Do not run
`prettier`.

---

## Out of scope: the focus model

Milestone 7 as originally written also contains a **focus model**, a D-pad
walking a grid of item tiles inside a region. **It is not designed here, and it
needs its own ruling before anyone designs it.**

It collides with a decision already published to mod authors in
`packages/mod-sdk/src/frontend.ts:189-193`:

> THERE IS NO LIST OF KEYS YOU WANT, and its absence is a decision rather than an
> omission. A region that declared the keys it wanted would be a second answer to
> "what does this key do" standing beside `registry:command`, and the result of
> two answers is a mod that silently takes `i` away from the player.

A focus model is a region consuming **arrow keys and Enter** while the player
believes those keys still walk and confirm. That is not adjacent to the published
decision, it is the thing the decision refuses, arriving through a different door,
and the door matters, because the reason given is not about the *declaration
syntax*, it is about **two answers to "what does this key do"**. Routing keys
positionally rather than by declaration produces the same two answers; it only
makes the second one invisible, since nothing in the manifest or the plugin says
which keys were taken. Worse, pointer ownership is self-limiting: a tap has a
location, and a location has one topmost drawer, while focus is **stateful**: it
persists between events, it must survive a relayout that moves the region out from
under it, it must be lost when the region is withdrawn, and it needs a published
answer to "who has focus now" that both core and the mod agree on. None of that
state exists in this shell, and the single-owner keyboard model (`modalDepth`, and
`inputEvents` as *"the front end's single input door"*, `input-door.ts:1-8`) is
built on the assumption that it does not. `docs/modding/README.md:72` records the
same boundary from the other side: *"`input-door.ts` is host infrastructure, not a
seam."*

So: **focus is a separate seam requiring its own ruling.** The question for the
owner is not "should regions have focus" but "does a region get to take a
keystroke the player has bound to something else, and if so, what tells the player
it happened", and until that has an answer, designing the D-pad would be
designing around `frontend.ts:189-193` rather than to it. The ownership plane this
milestone builds is what a focus model would hit-test against, so nothing here
forecloses it.

---

## If the retention were infeasible

It is not, and the numbers in section 1 are why: 7,680 bytes allocated once, 0.392 µs per
frame on the shipped sample, 0.0024 % of a 60 Hz frame budget, with a per-frame
cost that scales with cells written rather than with region count. There is no
measurement in this document that argues for a fallback, so none is proposed and
**rectangle-opaque is not shipped quietly**. This section exists to record that
the question was asked and answered with a number, not skipped.

---

## Doctrine, with its scope stated

**"The port adds nothing" constrains CORE ONLY.** It is not an argument against
this milestone. Core gains no capability here: a tap on a cell no mod drew reaches
the same `queueWalk` on the same path with the same values (section 5), and upstream's
`mouse_movement` gate and `textui_process_click` routing are untouched. What
changes is that a mod's own furniture stops being transparent to the pointer,
which is a *mod* capability, and giving mods capabilities is the entire point of
the gap-21 programme. Faithful means **gameplay** parity, not code shape
(2026-08-09).
