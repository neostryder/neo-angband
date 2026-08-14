/**
 * The resize-must-not-blank-the-screen guard.
 *
 * `GlyphTerm.fit()` reallocates the cell grid whenever the window changes, and
 * it used to allocate an EMPTY one. That wiped the terminal on every resize and
 * left it wiped until something repainted - and the only repaint wired to
 * the size event is the game map. So a resize landing while a full-screen overlay
 * owned the screen erased that overlay, and the ResizeObserver fires once on
 * observe, i.e. right around the boot title screen: launching the game showed
 * an empty screen with the title modal still silently waiting on a key.
 *
 * (The first attempt at that bug gated the map repaint behind `modalDepth` -
 * see render-background.test.ts. That was half the fix: it stopped the town map
 * being painted OVER the title, but the blanking happened in fit() and so the
 * title screen went from wrong-picture to no-picture. Both halves are needed.)
 *
 * `carryGrid` is the pure part, unit-tested here. The class itself needs a real
 * canvas 2d context, which the node test environment has not got, so the call
 * site is pinned by reading the source - the same approach as
 * render-background.test.ts.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  blitCellAssets,
  expandTallDirty,
  glyphIsTall,
  setActiveCellTap,
  type Glyph,
  type GridPointerInput,
  type GridSurface,
  type RenderAssetRef,
} from "./term";
import { carryGrid } from "./term";

const TERM = readFileSync(new URL("./term.ts", import.meta.url), "utf8");

describe("carryGrid", () => {
  it("carries every cell when the dimensions are unchanged (the fixed 80x24 term)", () => {
    // The default term is a fixed 80x24 grid: a resize changes only the cell
    // size and letterbox offset, so nothing may be lost. This is the case that
    // covers the reported bug.
    const prev = Array.from({ length: 24 }, (_, y) =>
      Array.from({ length: 80 }, (_, x) => `${x},${y}`),
    );
    expect(carryGrid(prev, 24, 80)).toEqual(prev);
  });

  it("keeps a blank grid blank", () => {
    expect(carryGrid([], 2, 3)).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("keeps the overlapping rectangle when the grid shrinks (reflow mode)", () => {
    const prev = [
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ];
    expect(carryGrid(prev, 2, 2)).toEqual([
      ["a", "b"],
      ["d", "e"],
    ]);
  });

  it("fills the new cells with null when the grid grows", () => {
    expect(carryGrid([["a"]], 2, 3)).toEqual([
      ["a", null, null],
      [null, null, null],
    ]);
  });

  it("does not alias the previous rows (a later put must not write through)", () => {
    const prev = [["a", "b"]];
    const next = carryGrid(prev, 1, 2);
    next[0]![0] = "z";
    expect(prev[0]![0]).toBe("a");
  });
});

describe("GlyphTerm.fit", () => {
  it("carries the grid over instead of allocating a blank one", () => {
    expect(TERM).toMatch(/this\.grid = carryGrid\(this\.grid, this\.rows, this\.cols\)/);
    // The blank allocation is the regression. Nothing in the file may reintroduce it.
    expect(TERM).not.toMatch(/new Array<Glyph \| null>\(this\.cols\)\.fill\(null\)/);
  });

  it("still repaints from the carried grid before notifying size subscribers", () => {
    /* The paint that puts the carried cells back on the resized canvas has to
     * happen NOW and has to be a FULL one: cells have moved and changed size, so
     * the frame diff's record of what is on the canvas is worthless. `fullRepaint
     * = true` then a synchronous `flush()`, rather than the queued paint every
     * other mutator gets - a resize does not come from a frame of gameplay, and
     * leaving the window blank until some later task is what "the title screen
     * vanished" looked like. Size observers run only after that flush. */
    expect(TERM).toMatch(/carryGrid\(this\.grid[\s\S]{0,900}?this\.fullRepaint = true/);
    expect(TERM).toMatch(/this\.fullRepaint = true;[\s\S]{0,900}?this\.flush\(\)/);
    expect(TERM).toMatch(/this\.fit\(\);\s*const size = this\.size\(\);\s*for \(const listener of this\.sizeListeners\) listener\(size\)/);
  });
});

describe("GridSurface contract", () => {
  it("keeps the shared contract and asset value free of Canvas2D", () => {
    const contract = TERM.slice(
      TERM.indexOf("export interface RenderAssetRef"),
      TERM.indexOf("/** Canvas-only adapter"),
    );
    expect(contract).toContain("export interface GridSurface");
    expect(contract).toContain("export interface RenderAssetRef");
    expect(contract).not.toContain("CanvasRenderingContext2D");
    expect(TERM).not.toContain("redraw(): void");
  });

  it("can be implemented as a grid without any canvas member", () => {
    const surface: GridSurface = {
      size: () => ({ cols: 1, rows: 1 }), invalidate: () => undefined, flush: () => undefined,
      clear: () => undefined, setCursor: () => undefined, hideCursor: () => undefined,
      put: () => undefined, print: () => undefined, eraseToEol: () => undefined, prt: () => undefined,
    };
    expect(surface.size()).toEqual({ cols: 1, rows: 1 });
  });

  it("replaces the active modal tap by disposing the previous subscription", () => {
    const listeners: ((cell: { col: number; row: number }) => void)[] = [];
    const input: GridPointerInput = {
      onCellTap(listener) {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    setActiveCellTap(input, () => undefined);
    setActiveCellTap(input, () => undefined);
    expect(listeners).toHaveLength(1);
    setActiveCellTap(input, null);
    expect(listeners).toHaveLength(0);
  });
});

/**
 * prt's erase (ui-output.c: prt = Term_erase(col, row, 255) then the string).
 *
 * Reported from play as "the text overlaps on this shop": the buy/sell
 * confirmation prints "Price: 450" onto row 1, which is the shopkeeper line, and
 * the port used print() - which writes ten characters and leaves the rest of the
 * row alone - so the row read "Price: 450the Great (Gnome)". Upstream never has
 * this problem because every one of its one-line prompts goes through prt.
 *
 * Pinned by reading the source, like the fit() call site above: GlyphTerm needs a
 * real canvas 2d context that the node environment has not got. So this asserts
 * the SHAPE - erase first, then write - and that the store's confirmation calls
 * it. It cannot assert pixels, and that screen still wants a human look.
 */
function bodyOf(src: string, signature: string): string {
  const at = src.indexOf(signature);
  expect(at, `${signature} is missing`).toBeGreaterThan(-1);
  const end = src.indexOf("\n  }", at);
  expect(end, `${signature} body is unterminated`).toBeGreaterThan(at);
  return src.slice(at + signature.length, end);
}

describe("prt erases to end of line before writing (ui-output.c)", () => {
  it("GlyphTerm.prt erases, then prints, in that order", () => {
    const src = bodyOf(TERM, "prt(x: number, y: number, text: string, fg: string): void {");
    expect(src).toContain("this.eraseToEol(x, y)");
    expect(src).toContain("this.print(x, y, text, fg)");
    /* Order is the whole point: printing then erasing would blank what it wrote. */
    expect(src.indexOf("eraseToEol")).toBeLessThan(src.indexOf("this.print"));
  });

  it("eraseToEol blanks from x to the last column, not one cell", () => {
    const src = bodyOf(TERM, "eraseToEol(x: number, y: number): void {");
    expect(src).toContain("cx < this.cols");
    expect(src).toContain("= null");
  });

  it("the store confirmation draws both of its rows with prt", () => {
    /* Row 0 goes over the message line and row 1 over the shopkeeper line
     * (ui-store.c:563 and :566 are both prt), so BOTH need the erase. */
    const shop = readFileSync(new URL("./shop.ts", import.meta.url), "utf8");
    const at = shop.indexOf("function storeConfirm(");
    expect(at).toBeGreaterThan(-1);
    const src = shop.slice(at, shop.indexOf("\n}", at));
    expect(src).toContain("term.prt(0, 1, `Price:");
    expect(src).toContain("term.prt(0, 0, prompt");
    /* And no prompt row still uses the non-erasing print. */
    expect(src).not.toContain("term.print(0, 0,");
    expect(src).not.toContain("term.print(0, 1,");
  });
});

/**
 * The prt/put_str census (2026-07-29), pinned so a converted site cannot quietly
 * revert to print(). The behaviour itself is exercised in overlay.test.ts's
 * "row-0 prompts erase the line they draw on"; these are the wiring pins for the
 * sites whose surface no unit test drives, in the shape exit-to-title.test.ts
 * established (read the source, assert the call is there).
 *
 * The bar for conversion was: the C function this site mirrors is prt/c_prt AND
 * the port draws it over content that is still on the row. Sites that mirror
 * put_str/c_put_str, and sites drawn immediately after term.clear() (where the
 * erase is a provable no-op), were left on print() - see the "must NOT erase"
 * block below, which is the half of the census that keeps this from being a
 * blanket rewrite.
 */
const WEB = (name: string): string =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("prt census: every converted prompt site (2026-07-29)", () => {
  it("overlay.ts row-0 prompts all use prt", () => {
    const src = WEB("overlay.ts");
    /* textui_get_check ui-input.c:1271; get_com_ex :1427; get_rep_dir :1512;
     * askfor_aux's caller prt :1153/:1189/:1357; prt("", 0, 0) :1275 etc. */
    expect(src).toContain('term.prt(0, 0, buf.slice(0, cols - 1), FG)'); // getCheck
    expect(src).toContain('term.prt(0, 0, prompt.slice(0, cols - 1), FG)'); // getAimDir/getKeyInline
    expect(src).toContain('term.prt(0, 0, "Direction or <click> (Escape to cancel)? "');
    expect(src).toContain('term.prt(0, row, prompt.slice(0, cols - 1), FG)'); // promptTextInline
    expect(src).toContain('term.prt(0, 0, "File name: ", FG)'); // get_file_text
    expect(src).toContain('term.prt(0, row, "", FG)'); // clearPromptRow = prt("", 0, 0)
    /* The hand-rolled erases these replaced must not come back. */
    expect(src).not.toContain('" ".repeat(cols - 1)');
    expect(src).not.toContain('" ".repeat(Math.max(0, cols - 1))');
  });

  it("the 'L' locate banner uses prt (it lands on the message row render() just drew)", () => {
    expect(WEB("main.ts")).toContain("term.prt(0, 0, banner.slice(0, cols - 1), UI_TEXT)");
  });

  it("the store per-item command prompt uses prt (it lands on statusMsg)", () => {
    expect(WEB("shop.ts")).toContain(
      "term.prt(0, 0, `(Enter to select, ESC) Command for ${name}:`",
    );
  });

  it("the keymap editor's four row-0 prompts use prt, not padEnd", () => {
    const src = WEB("keymap-edit.ts");
    /* ui-options.c:594 "Key: ", :647 "Action: %s", :603/:613 the ack lines,
     * and the get_check confirmation at ui-input.c:1271. */
    expect(src.match(/term\.prt\(0, 0,/gu)?.length).toBe(4);
    expect(src).not.toContain("term.print(0, 0,");
    /* padEnd(cols - 1) was the hand-rolled erase, and it left the last column. */
    expect(src).not.toContain("padEnd(cols - 1)");
  });

  it("the pref-file screens' prt(\"\", row - 1, 0) really erases", () => {
    const src = WEB("prefs-ui.ts");
    /* ui-options.c:53 and :1211. print("", ...) drew nothing, so the call was a
     * no-op and the row above the heading was never cleared. */
    expect(src.match(/term\.prt\(0, row - 1, ""/gu)?.length).toBe(2);
    expect(src).not.toContain('term.print(0, row - 1, ""');
  });

  it("the quickstart screen's two prts (ui-birth.c) use prt", () => {
    const src = WEB("birth.ts");
    expect(src).toContain('term.prt(0, 0, "New character based on previous one:"');
    expect(src).toContain("term.prt(col, rows - 1, PROMPT.slice(");
  });
});

describe("prt census: the sites that must NOT erase (put_str, ui-output.c:362-379)", () => {
  it('msg_flush\'s "-more-" stays a Term_putstr', () => {
    /* ui-input.c:393 is `Term_putstr(x, 0, -1, a, "-more-")`, appended one column
     * past the message text (:575). prt there would erase the message it follows. */
    const src = WEB("main.ts");
    expect(src.match(/term\.print\(page\.length \+ 1, 0, "-more-", MORE_COLOR\)/gu)?.length).toBe(2);
    expect(src).not.toContain('term.prt(page.length + 1, 0, "-more-"');
  });

  it("askfor_aux's field paint stays print (its erase is BOUNDED, ui-input.c:891)", () => {
    /* Term_erase(x, y, (int)len) clears len cells, not to the end of the row:
     * whatever is further right belongs to the screen underneath. */
    const src = WEB("overlay.ts");
    const at = src.indexOf("function paintLineEdit(");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toContain("term.print(x, y,");
    expect(body).not.toContain("term.prt(");
  });

  it("showLevelMap's box border stays print (prt would erase across the border)", () => {
    /* window_make draws a bordered box; an erase-to-end-of-line on any interior
     * row would take the right-hand '|' with it. */
    /* `paintLevelMapOnTerminal`, not `showLevelMap`: the overview became a
     * REGION in #261 commit 5, so `showLevelMap` is now the two-line wrapper
     * that pushes the rectangle and `paintLevelMapOnTerminal` is the painter -
     * the same `show*`/`paint*` split `showViewOnTerminal` already had. The
     * painter's body is UNCHANGED, which is what this assertion is about; only
     * the name of the function enclosing it moved. */
    const src = WEB("overlay.ts");
    const at = src.indexOf("function paintLevelMapOnTerminal(");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).toContain("term.print(mapW + 1, r + 1,");
    expect(body).not.toContain("term.prt(");
  });

  it("the title screen's art stays print (prt would wipe the mountains)", () => {
    /* news.ts paints news.txt row by row and then lays the "Neo" block OVER it.
     * Drawing on top of existing art is put_str-shaped by intent: an erase to end
     * of line on any of those rows would take the mountains to the right with it -
     * which is exactly what news.test.ts's caret-survival assertion checks from
     * the other side. */
    const src = WEB("news.ts");
    expect(src).not.toContain("term.prt(");
    expect(src).toContain("term.print(NEO_COL, y,");
  });

  it("the colour editor stays print end to end (colors_modify is all Term_putstr)", () => {
    /* ui-options.c:876-930: only the "Command: Modify colors" heading is a prt
     * (:883) and it is drawn straight after clear_from, so every draw on that
     * screen is put_str semantics. */
    const src = WEB("colors.ts");
    expect(src).not.toContain("term.prt(");
    expect(src).toContain('term.print(0, 14, "Command (n/N/k/K/r/R/g/G/b/B): "');
  });
});

/**
 * The transparency guard: a foreground tile must be blitted OVER the terrain
 * tile, not over the cell's flat background colour.
 *
 * Measured on the shipped art before the fix: the Shockbolt player tile
 * (64x64.png row 3 col 7) is 2171 of 4096 pixels fully transparent and another
 * 743 partially so, and the single-pass blit put all of that straight onto
 * UI_BG - so the player stood in a black hole in the middle of a tiled floor.
 *
 * Upstream never draws one tile per cell. grid_data_as_text saves the terrain
 * attr/char into (tap, tcp) "for the transparency effects" BEFORE the trap,
 * object, monster and player arms overwrite (ap, cp) (ui-map.c L186-189), and
 * Term_pict blits the terrain tile first, then the foreground tile only when the
 * pair differs (main-sdl.c L5511-5540).
 */
describe("blitCellAssets (Term_pict's terrain-then-foreground pass)", () => {
  /** Renderer-neutral assets are resolved by the renderer, not the grid value. */
  const rec = (name: string): RenderAssetRef => ({ kind: "test", data: name });
  const renderer = (refusals = new Set<string>()) => ({
    draw: (_ctx: CanvasRenderingContext2D, asset: RenderAssetRef, px: number, py: number, w: number, h: number) => {
      const name = String(asset.data);
      log.push(`${name}@${px},${py}+${w}x${h}`);
      return !refusals.has(name);
    },
  });
  const CTX = null as unknown as CanvasRenderingContext2D;
  const cell = (g: Partial<Glyph>): Glyph => ({ ch: "@", fg: "#fff", ...g });
  let log: string[];

  it("draws the terrain tile first and the foreground tile second", () => {
    log = [];
    const drew = blitCellAssets(
      renderer(),
      CTX,
      cell({ bgTile: rec("floor"), tile: rec("player") }),
      32,
      48,
      16,
      24,
    );
    expect(log).toEqual(["floor@32,48+16x24", "player@32,48+16x24"]);
    expect(drew).toBe(true);
  });

  it("draws only the foreground tile when the terrain IS the top layer", () => {
    /* Upstream's `if ((tap[i] == ap[i]) && (tcp[i] == cp[i])) continue;` - the
     * caller expresses that by leaving bgTile off an uncovered terrain cell. */
    log = [];
    expect(blitCellAssets(renderer(), CTX, cell({ tile: rec("floor") }), 0, 0, 16, 24)).toBe(true);
    expect(log).toEqual(["floor@0,0+16x24"]);
  });

  it("still draws the foreground tile when the terrain tile refuses", () => {
    /* A pack that maps the monster but not the floor it stands on must not lose
     * the monster. Both engines can return false per tile: the tilesheet while
     * its atlas is still fetching, a loose pack for any target it has no art
     * for. */
    log = [];
    const drew = blitCellAssets(
      renderer(new Set(["floor"])),
      CTX,
      cell({ bgTile: rec("floor"), tile: rec("player") }),
      0,
      0,
      16,
      24,
    );
    expect(log).toEqual(["floor@0,0+16x24", "player@0,0+16x24"]);
    expect(drew).toBe(true);
  });

  it("reports NOT drawn when only the terrain drew, so the ASCII glyph survives", () => {
    /* The whole degradation contract: a cell whose real content would not blit
     * falls back to its text glyph rather than showing scenery alone. */
    log = [];
    const drew = blitCellAssets(
      renderer(new Set(["player"])),
      CTX,
      cell({ bgTile: rec("floor"), tile: rec("player") }),
      0,
      0,
      16,
      24,
    );
    expect(log).toEqual(["floor@0,0+16x24", "player@0,0+16x24"]);
    expect(drew).toBe(false);
  });

  it("draws nothing and reports NOT drawn for a plain text cell", () => {
    log = [];
    expect(blitCellAssets(renderer(), CTX, cell({}), 0, 0, 16, 24)).toBe(false);
    expect(blitCellAssets(renderer(), CTX, null, 0, 0, 16, 24)).toBe(false);
  });
});

/**
 * pr_drw (ui-term.c L915-960): a double-height tile paints into the cell ABOVE
 * its anchor, so the frame diff cannot treat cells as independent.
 *
 * THE TWO SMEARS THIS PREVENTS, and each rule exists for exactly one of them:
 *
 *  - a tall tile LEAVES. Painting only its anchor clears only the anchor, and
 *    the upper half stays on the canvas over whatever is there now.
 *  - the cell ABOVE a tall tile changes. Painting it clears the rect the tall
 *    tile's upper half occupies, and the anchor's own glyph did not change, so
 *    nothing repaints it - the monster loses its head.
 *
 * Asserted on the pure expansion rather than through the canvas because there is
 * no jsdom here (see term-overdraw.test.ts) and because a pixel assertion would
 * pass on a renderer that simply repainted everything.
 */
describe("expandTallDirty (pr_drw's two-directional dependency)", () => {
  const COLS = 4;
  const ROWS = 4;
  const k = (x: number, y: number): number => y * COLS + x;
  const tallAt = (...cells: [number, number][]) => {
    const set = new Set(cells.map(([x, y]) => k(x, y)));
    return (x: number, y: number): boolean => set.has(k(x, y));
  };
  const run = (dirty: [number, number][], isTall: (x: number, y: number) => boolean) => {
    const set = new Set(dirty.map(([x, y]) => k(x, y)));
    expandTallDirty(set, COLS, ROWS, isTall);
    return [...set].sort((a, b) => a - b);
  };

  it("leaves a frame with no tall tile in it completely alone", () => {
    /* The guard on the paint-count budget in term-overdraw.test.ts: an ASCII or
     * one-cell-tile frame must not pay anything for this. */
    expect(run([[1, 2], [3, 0]], () => false)).toEqual([k(3, 0), k(1, 2)].sort((a, b) => a - b));
  });

  it("dirties the cell above a changed tall anchor", () => {
    expect(run([[1, 2]], tallAt([1, 2]))).toEqual([k(1, 1), k(1, 2)].sort((a, b) => a - b));
  });

  it("dirties an UNCHANGED tall anchor when the cell above it repainted", () => {
    /* The rule that is easy to forget: the anchor's own glyph did not change, so
     * the plain diff never names it, and repainting (1,1) erases its top half. */
    expect(run([[1, 1]], tallAt([1, 2]))).toEqual([k(1, 1), k(1, 2)].sort((a, b) => a - b));
  });

  it("propagates through a stack of tall tiles to a fixed point", () => {
    /* Rule two pulls in (1,2), which is tall, so rule one pulls in (1,1), which
     * is tall, so rule one pulls in (1,0). A single pass would stop short. */
    expect(run([[1, 3]], tallAt([1, 3], [1, 2], [1, 1]))).toEqual([
      k(1, 0),
      k(1, 1),
      k(1, 2),
      k(1, 3),
    ]);
  });

  it("does not walk off the top of the grid", () => {
    expect(run([[2, 0]], tallAt([2, 0]))).toEqual([k(2, 0)]);
  });
});

describe("glyphIsTall", () => {
  const ref = (tall: boolean): RenderAssetRef => ({ kind: "test", data: null, tall });

  it("is true when EITHER layer overdraws - a tall terrain tile counts", () => {
    expect(glyphIsTall({ ch: " ", fg: "#fff", bgTile: ref(true) })).toBe(true);
    expect(glyphIsTall({ ch: " ", fg: "#fff", tile: ref(true) })).toBe(true);
  });

  it("is false for a short tile, a bare glyph, and nothing at all", () => {
    expect(glyphIsTall({ ch: " ", fg: "#fff", tile: ref(false) })).toBe(false);
    expect(glyphIsTall({ ch: "@", fg: "#fff" })).toBe(false);
    expect(glyphIsTall(null)).toBe(false);
  });
});
