/**
 * Gap #58: the enriched character-select screen (charselect.ts). Living rows
 * resume, tombstones are dimmed memorials with a Leave/Delete sub-menu, ESC
 * resumes the most-recent living character (or starts New when none), the
 * last row is always New, and every row carries a hint.
 */

import { describe, expect, it, afterEach } from "vitest";
import { runCharacterSelect } from "./charselect";
import type { CharMeta } from "./roster";
import type { GlyphTerm } from "./term";

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

function makeTerm(cols = 80, rows = 16): GlyphTerm & { snapshot(): string[] } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
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

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function meta(over: Partial<CharMeta>): CharMeta {
  return {
    id: "id-x",
    name: "Fred",
    race: "Human",
    cls: "Warrior",
    sex: "",
    level: 3,
    depth: 2,
    maxDepth: 3,
    turn: 1000,
    alive: true,
    updatedAt: Date.now() - 5 * 60000,
    ...over,
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("runCharacterSelect", () => {
  it("a living row resumes that character", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [
      meta({ id: "a1", name: "Alpha" }),
      meta({ id: "b2", name: "Beta" }),
    ]);
    press(win, "b");
    expect(await done).toEqual({ action: "resume", id: "b2" });
  });

  it("the last row is always New", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "a1" })]);
    expect(term.snapshot().join("\n")).toContain("[ New character ]");
    press(win, "b"); // the row after the single roster entry
    expect(await done).toEqual({ action: "new" });
  });

  it("ESC resumes the most-recent living character, or New when none", async () => {
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = runCharacterSelect(term, [
        meta({ id: "dead1", name: "Ghost", alive: false }),
        meta({ id: "live1", name: "Alive" }),
      ]);
      press(win, "Escape");
      expect(await done).toEqual({ action: "resume", id: "live1" });
    }
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = runCharacterSelect(term, [meta({ id: "dead1", alive: false })]);
      press(win, "Escape");
      expect(await done).toEqual({ action: "new" });
    }
  });

  it("a tombstone offers Leave/Delete; Delete resolves, Leave returns to the list", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "dead1", name: "Ghost", alive: false })]);
    press(win, "a"); // the tombstone
    await tick();
    expect(term.snapshot()[0]).toContain("Ghost has died.");
    press(win, "a"); // Leave the tombstone
    await tick();
    expect(term.snapshot()[0]).toContain("Select a character");
    press(win, "a"); // the tombstone again
    await tick();
    press(win, "b"); // Delete this record
    expect(await done).toEqual({ action: "delete", id: "dead1" });
  });

  it("rows carry hints: roster detail for the living, memorial for the dead", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [
      meta({ id: "a1", name: "Alpha", level: 7, depth: 4 }),
      meta({ id: "dead1", name: "Ghost", alive: false }),
    ]);
    const hintRow = term.size().rows - 2;
    expect(term.snapshot()[hintRow]).toContain("Level 7 Warrior - 200' (L4), last played 5m ago");
    press(win, "ArrowDown");
    expect(term.snapshot()[hintRow]).toContain("(deceased) - memorial only");
    press(win, "Escape");
    await done;
  });
});
