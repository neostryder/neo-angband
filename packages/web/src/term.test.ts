/**
 * The resize-must-not-blank-the-screen guard.
 *
 * `GlyphTerm.fit()` reallocates the cell grid whenever the window changes, and
 * it used to allocate an EMPTY one. That wiped the terminal on every resize and
 * left it wiped until something repainted - and the only repaint wired to
 * `onResize` is the game map. So a resize landing while a full-screen overlay
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

  it("still repaints from the carried grid, and still notifies onResize", () => {
    // redraw() is what puts the carried cells back on the resized canvas; the
    // onResize callback is how the shell repaints the map when no overlay is up.
    expect(TERM).toMatch(/carryGrid\(this\.grid[\s\S]{0,600}?this\.redraw\(\)/);
    expect(TERM).toMatch(/this\.fit\(\);\s*this\.onResize\?\.\(this\.size\(\)\)/);
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
