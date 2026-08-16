/**
 * 'M' DECLARES A REGION (#261 commit 5, risk 1).
 *
 * THE RISK WAS NOT THEORETICAL AND THIS IS THE SITE. `showLevelMap` is reached
 * by the DIRECT modal path from 'M' rather than through `showTextScreen`, and it
 * opened with `term.clear()`. While a modal is up, `renderBackground()` refuses
 * to call `render()`, and `render()` is the only thing that calls
 * `paintRegionStack()` - so this was the one full-screen erase that a mod could
 * neither survive nor be told about. A mod's window was drawn, the player
 * pressed 'M', and the window was gone with no exception, no console entry and
 * nothing to search for.
 *
 * WHAT THE FIX ACTUALLY BUYS, stated precisely because the overclaim is easy.
 * The level map still covers the terminal, and a region under it is still not
 * repainted while it is open - that is what a full-screen modal MEANS, and
 * `showViewOnTerminal` has the same property for every other screen. What
 * changes is that the covering is now DECLARED: `core:screen` is in the live
 * stack for exactly as long as the map is up, so `onStackChanged` fires, a
 * replacement front end stands its canvas down instead of floating it over the
 * middle of the overview, and it is told again when the map closes. That is the
 * whole mechanism #261 exists to provide, and this file is the assertion that
 * 'M' is now inside it rather than beside it.
 *
 * `overlay.test.ts` already pins the PICTURE the overview draws, at several
 * sizes. Nothing there changed and nothing here duplicates it: the painter's
 * body is untouched, which is the property `clipSurface` exists to have.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { showLevelMap, SCREEN_REGION_ID } from "./overlay";
import { liveRegionStack, resetRegionStack } from "./ui-stack";
import { onStackChanged } from "./ui-stack";
import type { Overview } from "./mapview";
import type { GlyphTerm } from "./term";

const COLS = 20;
const ROWS = 8;

/** The fake window `overlay.test.ts` uses, for the same reason: no jsdom here. */
function makeFakeWindow(): {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
} {
  const listeners: Array<{ type: string; fn: (ev: Event) => void }> = [];
  return {
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

function makeTerm(): GlyphTerm {
  const cells: string[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => " "));
  return {
    size: () => ({ cols: COLS, rows: ROWS }),
    invalidate: () => {},
    flush: () => {},
    clear: () => {
      for (const row of cells) row.fill(" ");
    },
    setCursor: () => {},
    hideCursor: () => {},
    put: (x: number, y: number, glyph: { ch: string }) => {
      const row = cells[y];
      if (row && x >= 0 && x < COLS) row[x] = glyph.ch;
    },
    print: (x: number, y: number, text: string) => {
      const row = cells[y];
      if (!row) return;
      for (let i = 0; i < text.length; i++) if (x + i < COLS) row[x + i] = text[i]!;
    },
    eraseToEol: (x: number, y: number) => {
      const row = cells[y];
      if (!row) return;
      for (let cx = Math.max(0, x); cx < COLS; cx++) row[cx] = " ";
    },
    prt: () => {},
    onCellTap: () => () => {},
  } as unknown as GlyphTerm;
}

function overview(): Overview {
  return {
    mapW: 2,
    mapH: 2,
    cells: [
      [{ ch: ".", css: "#fff" }, { ch: "#", css: "#fff" }],
      [{ ch: ".", css: "#fff" }, { ch: ".", css: "#fff" }],
    ],
    playerRow: 0,
    playerCol: 0,
  } as unknown as Overview;
}

let win: ReturnType<typeof makeFakeWindow>;

beforeEach(() => {
  resetRegionStack();
  win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("the level map is a region while it is open", () => {
  it("declares core:screen for exactly as long as it is up", async () => {
    /* THE ASSERTION THAT WAS MISSING. Before the fix this stack was EMPTY for
     * the whole time the overview was on screen - the one modal a mod could not
     * learn about, because nothing about it was ever published. */
    const term = makeTerm();
    expect(liveRegionStack()).toEqual([]);

    const done = showLevelMap(term, overview());
    expect(liveRegionStack().map((r) => r.id)).toEqual([SCREEN_REGION_ID]);
    /* The whole terminal, in the modal band - which is what a 4.2.6 screen is,
     * and is deliberately NOT shrunk. What it lacked was a rectangle at all. */
    expect(liveRegionStack()[0]).toMatchObject({
      layer: "modal",
      cells: { col: 0, row: 0, cols: COLS, rows: ROWS },
    });

    win.dispatchEvent(new Event("pointerdown"));
    await done;
    expect(liveRegionStack()).toEqual([]);
  });

  it("tells a subscriber on the way in AND on the way out", async () => {
    /* THE POINT OF DECLARING IT. `render()` does not run while this modal owns
     * the terminal, so a front end has no frame coming to tell it that it is
     * covered. The notification is the only channel there is, and a mod that is
     * told it is covered and never told otherwise is worse than one never told
     * at all - it would keep its canvas down for the rest of the session. */
    const term = makeTerm();
    const heard: string[][] = [];
    const off = onStackChanged((stack) => void heard.push(stack.map((r) => r.id)));
    try {
      const done = showLevelMap(term, overview());
      win.dispatchEvent(new Event("pointerdown"));
      await done;
    } finally {
      off();
    }
    expect(heard).toEqual([[SCREEN_REGION_ID], []]);
  });
});
