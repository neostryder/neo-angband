import { afterEach, describe, expect, it, vi } from "vitest";
import { colorChannel, colorToCss, resetColorTable } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { runColorsEditor } from "./colors";

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(_type, fn, capture = false) {
      listeners.push({ fn, capture });
    },
    removeEventListener(_type, fn, capture = false) {
      const i = listeners.findIndex((l) => l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners]) l.fn(ev);
    },
  };
}

function makeTerm(cols = 80, rows = 24): GlyphTerm & { snapshot(): string[] } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    size: () => ({ cols, rows }),
    clear: () => { for (const row of grid) row.fill(" "); },
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

describe("runColorsEditor (do_cmd_colors / colors_modify)", () => {
  afterEach(() => {
    resetColorTable();
    delete (globalThis as { window?: unknown }).window;
  });

  it("shows the colour info, K/RGB line, and command prompt", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runColorsEditor(term, () => {});
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Command: Modify colors");
    expect(snap).toContain("Color = 0, Name = Dark, Index = d");
    expect(snap).toContain("K = 0x00 / R,G,B = 0x00,0x00,0x00");
    expect(snap).toContain("Command (n/N/k/K/r/R/g/G/b/B):");
  });

  it("r/g/b nudge the current colour's channels live", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runColorsEditor(term, () => {});
    // Colour 0 is Dark (#000000). Bump R, then G twice.
    press(win, "r");
    press(win, "g");
    press(win, "g");
    expect(colorChannel(0, 1)).toBe(1); // R
    expect(colorChannel(0, 2)).toBe(2); // G
    expect(colorToCss(0)).toBe("#010200");
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("R,G,B = 0x01,0x02,0x00");
  });

  it("n / N cycle the current colour", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runColorsEditor(term, () => {});
    press(win, "n"); // -> colour 1 (White)
    expect(term.snapshot().join("\n")).toContain("Color = 1, Name = White");
    press(win, "N"); // back to 0 (Dark)
    expect(term.snapshot().join("\n")).toContain("Color = 0, Name = Dark");
  });

  it("ESC persists and resolves", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const persist = vi.fn();
    const done = runColorsEditor(term, persist);
    press(win, "R"); // an edit
    press(win, "Escape");
    await done;
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
