import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_PREF_IDS as SDK_COLOR_IDS, colorTableFormat, parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import { COLOR_PREF_IDS, colorChannel, colorToCss, resetColorTable } from "@rpgm-tools/neo-angband-core";
import type { GlyphTerm } from "./term";
import { loadColorPrefs, runColorsEditor, saveColorPrefs } from "./colors";

describe("color table document", () => {
  it("uses the same palette names in core and the SDK", () => {
    expect(COLOR_PREF_IDS).toEqual(SDK_COLOR_IDS);
  });
  afterEach(() => {
    resetColorTable();
    vi.unstubAllGlobals();
  });

  it("converts the old tuple array to named RGBA rows and round-trips", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    store.set("neo-angband:colors", JSON.stringify([[0, 1, 2, 3]]));
    loadColorPrefs();
    expect(colorChannel(0, 1)).toBe(1);
    const raw = store.get("neo-angband:colors")!;
    const parsed = parseDocument(raw, colorTableFormat);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.colors[0]).toEqual({ name: "dark", kv: 0, color: { red: 1, green: 2, blue: 3, alpha: 255 } });
    expect(serializeDocument(colorTableFormat, parsed.data, { compact: true })).toBe(raw);
    expect(saveColorPrefs()).toBe(true);
    expect(store.get("neo-angband:colors")).toBe(raw);
  });

  it("does not overwrite a future document", () => {
    const future = JSON.stringify({ format: colorTableFormat.format, schemaVersion: 99, data: {} });
    const store = new Map([["neo-angband:colors", future]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    expect(() => loadColorPrefs()).not.toThrow();
    expect(saveColorPrefs()).toBe(false);
    expect(store.get("neo-angband:colors")).toBe(future);
  });

  it("preserves an imported alpha channel when saving the palette", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    const data = {
      colors: colorTableFormat.sample!.colors.map((row, index) => ({
        ...row,
        color: { ...row.color, alpha: index === 0 ? 128 : row.color.alpha },
      })),
    };
    store.set("neo-angband:colors", serializeDocument(colorTableFormat, data, { compact: true }));
    loadColorPrefs();
    expect(saveColorPrefs()).toBe(true);
    const parsed = parseDocument(store.get("neo-angband:colors")!, colorTableFormat);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.colors[0]?.color.alpha).toBe(128);
  });
});

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
    onCellTap: () => () => undefined,
    size: () => ({ cols, rows }),
    clear: () => { for (const row of grid) row.fill(" "); },
    /* Term_erase(x, y, 255) + c_prt = erase-then-draw (ui-output.c:385-391).
     * print() is put_str and does NOT erase (ui-output.c:362-379); the two must
     * stay distinguishable in the fake or a prt site cannot be tested. */
    eraseToEol: (x: number, y: number) => {
      const row = grid[y];
      if (row) for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
    },
    prt: (x: number, y: number, text: string, _fg?: string) => {
      const row = grid[y];
      if (!row) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
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
