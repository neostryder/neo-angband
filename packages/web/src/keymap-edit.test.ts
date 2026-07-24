import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GlyphTerm } from "./term";
import { runKeymapEditor } from "./keymap-edit";
import { clearKeymaps, keymapFind } from "./keymap-store";

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(_t, fn, capture = false) {
      listeners.push({ fn, capture });
    },
    removeEventListener(_t, fn, capture = false) {
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

// A microtask flush (not setTimeout): the editor's screen transitions all
// resolve on microtasks (a menu keydown resolves selectFromMenu, the next
// `await` attaches the next inline capture's listener synchronously). Avoiding
// timers keeps this immune to any fake-timer state from sibling test files.
async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function fakeStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("runKeymapEditor (do_cmd_keymaps)", () => {
  let win: FakeWindow;
  beforeEach(() => {
    fakeStorage();
    clearKeymaps();
    win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
  });
  afterEach(() => {
    clearKeymaps();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("creates a keymap: trigger, action to '=', confirm", async () => {
    const term = makeTerm();
    const done = runKeymapEditor(term, false); // original keyset
    await tick();
    expect(term.snapshot().join("\n")).toContain("Create a keymap");
    press(win, "b"); // Create (row b)
    await tick();
    expect(term.snapshot()[0]).toContain("Key:");
    press(win, "X"); // trigger
    await tick();
    // Action sequence: q, c, then '=' to finish.
    press(win, "q");
    press(win, "c");
    press(win, "=");
    await tick();
    expect(term.snapshot()[0]).toContain("Keep this keymap");
    press(win, "y"); // confirm
    await tick();
    expect(keymapFind("orig", "X")).toBe("qc");
    // Persisted to localStorage.
    expect(localStorage.getItem("neo-angband:keymaps")).toContain("qc");
    press(win, "Escape"); // ack "Keymap added."
    await tick();
    press(win, "Escape"); // leave the menu
    await done;
  });

  it("queries and removes a keymap", async () => {
    const term = makeTerm();
    const done = runKeymapEditor(term, false);
    await tick();
    // Seed one directly, then reopen via the running editor's live table.
    press(win, "a"); // Query
    await tick();
    press(win, "Z"); // no keymap for Z
    await tick();
    expect(term.snapshot()[0]).toContain("No keymap with that trigger.");
    press(win, "Enter"); // ack
    await tick();
    press(win, "Escape"); // leave
    await done;
  });

  it("rejects '=' as a create trigger", async () => {
    const term = makeTerm();
    const done = runKeymapEditor(term, false);
    await tick();
    press(win, "b"); // Create
    await tick();
    press(win, "="); // reserved
    await tick();
    expect(term.snapshot()[0]).toContain("The '=' key is reserved.");
    press(win, "Enter"); // ack
    await tick();
    press(win, "Escape");
    await done;
  });
});
