import { describe, expect, it, afterEach } from "vitest";
import { showLevelMap } from "./overlay";
import type { GlyphTerm } from "./term";
import type { Overview } from "./mapview";

// showTextScreen/selectFromMenu/promptDirection already exercise this repo's
// keydown-listener modal pattern end to end (see help.test.ts); showLevelMap
// (do_cmd_view_map, 'M') is new and gets the same treatment here, plus the
// touch-dismiss path (a synthetic pointerdown) it adds on top of that pattern.
//
// No jsdom is installed in this repo (help.test.ts explains why); a fake
// `window` + a plain-string-grid `term` stand in, exactly as help.test.ts's
// own fixtures do.

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ type: string; fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex(
        (l) => l.type === type && l.fn === fn && l.capture === capture,
      );
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

function makeTerm(cols = 20, rows = 12): GlyphTerm & { snapshot(): string[] } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        if (row) row[x + i] = text[i] ?? " ";
      }
    },
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
  } as unknown as GlyphTerm & { snapshot(): string[] };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

function tap(win: FakeWindow): void {
  win.dispatchEvent(new Event("pointerdown", { cancelable: true }));
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function overview(over: Partial<Overview> = {}): Overview {
  return {
    cells: [
      [{ ch: ".", css: "#c8c8d4" }, { ch: "#", css: "#8a8a94" }],
      [null, { ch: ".", css: "#c8c8d4" }],
    ],
    mapW: 2,
    mapH: 2,
    playerRow: 1,
    playerCol: 1,
    ...over,
  };
}

describe("showLevelMap (do_cmd_view_map modal)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("draws a COLOUR_WHITE box, the cell glyphs, and the player marker", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void showLevelMap(term, overview());
    const snap = term.snapshot();
    expect(snap[0]).toBe("+--+");
    expect(snap[3]).toBe("+--+");
    expect(snap[1]).toBe("|.#|");
    expect(snap[2]).toBe("| @|"); // playerRow=1,playerCol=1 -> screen (2,2), overwrites the '.'
  });

  it("centers the 'Hit any key to continue' footer on the last row", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(30, 10);
    void showLevelMap(term, overview());
    const snap = term.snapshot();
    const footer = "Hit any key to continue";
    const expectedStart = Math.floor((30 - footer.length) / 2);
    expect(snap[9]!.slice(expectedStart, expectedStart + footer.length)).toBe(footer);
  });

  it("resolves on any key press (anykey)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let resolved = false;
    const done = showLevelMap(term, overview()).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    press(win, "q"); // truly ANY key, not just Escape/Enter/Space
    await done;
    expect(resolved).toBe(true);
  });

  it("resolves on a tap (touch dismiss)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let resolved = false;
    const done = showLevelMap(term, overview()).then(() => {
      resolved = true;
    });
    tap(win);
    await done;
    expect(resolved).toBe(true);
  });

  it("degenerate mapW/mapH (<1) shows no box but still paints the footer, no throw", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(30, 10);
    expect(() =>
      void showLevelMap(term, overview({ cells: [], mapW: 0, mapH: 0, playerRow: 0, playerCol: 0 })),
    ).not.toThrow();
    const snap = term.snapshot();
    expect(snap[0]).toBe("");
    expect(snap[term.size().rows - 1]).toContain("Hit any key to continue");
  });

  it("removes both listeners once resolved (no leak into the next modal)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = showLevelMap(term, overview());
    press(win, "Escape");
    await done;
    // A second key/tap after resolution must not throw (listeners gone).
    expect(() => press(win, "x")).not.toThrow();
    expect(() => tap(win)).not.toThrow();
  });
});
