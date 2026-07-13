/**
 * Gap #58: the game (Escape) menu and death menu structure (game-menu.ts) and
 * their reachability through the shared selectFromMenu - every row reachable
 * by letter, by arrows+Enter, and by tap, with a hint on each row. The death
 * menu keeps ui-death.c death_actions' stable tag letters (i/m/v/n,
 * MN_CASELESS_TAGS).
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  gameMenuEntries,
  deathMenuEntries,
  GAME_MENU_FOOTER,
  DEATH_MENU_FOOTER,
} from "./game-menu";
import { selectFromMenu, menuLetter } from "./overlay";
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

function makeTerm(cols = 80, rows = 24): GlyphTerm & {
  snapshot(): string[];
  fireTap(col: number, row: number): void;
} {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  let tapCb: ((cell: { col: number; row: number }) => void) | null = null;
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
    onCellTap: (cb: ((cell: { col: number; row: number }) => void) | null) => {
      tapCb = cb;
    },
    fireTap: (col: number, row: number) => {
      tapCb?.({ col, row });
    },
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
  } as unknown as GlyphTerm & { snapshot(): string[]; fireTap(col: number, row: number): void };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const ASCII = /^[\x20-\x7e]*$/u;

describe("gameMenuEntries (the Escape menu structure)", () => {
  it("covers every required action with a hint, resume first, ASCII only", () => {
    const entries = gameMenuEntries();
    const actions = entries.map((e) => e.action);
    for (const required of [
      "resume", "character", "inventory", "equipment", "messages",
      "knowledge", "save", "options", "help", "switch", "new",
    ]) {
      expect(actions).toContain(required);
    }
    expect(actions[0]).toBe("resume");
    for (const e of entries) {
      expect(e.item.hint, `${e.action} needs a hint`).toBeTruthy();
      expect(e.item.label).toMatch(ASCII);
      expect(e.item.hint!).toMatch(ASCII);
    }
    expect(GAME_MENU_FOOTER).toMatch(ASCII);
  });

  it("every row is reachable by its letter", async () => {
    const entries = gameMenuEntries();
    for (let i = 0; i < entries.length; i++) {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = selectFromMenu(term, "Game menu", entries.map((e) => e.item), GAME_MENU_FOOTER);
      press(win, menuLetter(i));
      expect(await done).toBe(i);
    }
  });

  it("every row is reachable by arrows + Enter", async () => {
    const entries = gameMenuEntries();
    const target = entries.length - 1;
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = selectFromMenu(term, "Game menu", entries.map((e) => e.item), GAME_MENU_FOOTER);
    for (let i = 0; i < target; i++) press(win, "ArrowDown");
    press(win, "Enter");
    expect(await done).toBe(target);
  });

  it("every row is reachable by double tap; ESC resumes (null)", async () => {
    const entries = gameMenuEntries();
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = selectFromMenu(term, "Game menu", entries.map((e) => e.item), GAME_MENU_FOOTER);
      const row = 2 + 3; // BODY_TOP + index of "equipment"
      term.fireTap(1, row);
      term.fireTap(1, row);
      expect(await done).toBe(3);
    }
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = selectFromMenu(term, "Game menu", entries.map((e) => e.item), GAME_MENU_FOOTER);
      press(win, "Escape");
      expect(await done).toBeNull();
    }
  });

  it("shows the highlighted row's hint (teaches the keyboard shortcut)", () => {
    const entries = gameMenuEntries();
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void selectFromMenu(term, "Game menu", entries.map((e) => e.item), GAME_MENU_FOOTER);
    const hintRow = term.size().rows - 2;
    expect(term.snapshot()[hintRow]).toContain("ESC");
    press(win, "ArrowDown"); // Character sheet
    expect(term.snapshot()[hintRow]).toContain("'C'");
    press(win, "Escape");
  });
});

describe("deathMenuEntries (ui-death.c death_actions, reduced)", () => {
  it("keeps the upstream tag letters i/m/v/n and hints on every row", () => {
    const entries = deathMenuEntries();
    expect(entries.map((e) => [e.action, e.item.tag])).toEqual([
      ["info", "i"],
      ["messages", "m"],
      ["scores", "v"],
      ["new", "n"],
    ]);
    for (const e of entries) {
      expect(e.item.hint).toBeTruthy();
      expect(e.item.label).toMatch(ASCII);
    }
    expect(DEATH_MENU_FOOTER).toMatch(ASCII);
  });

  it("selects by tag, caselessly (MN_CASELESS_TAGS)", async () => {
    const entries = deathMenuEntries();
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = selectFromMenu(term, "You have died.", entries.map((e) => e.item));
      press(win, "v");
      expect(await done).toBe(2); // View scores
    }
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = selectFromMenu(term, "You have died.", entries.map((e) => e.item));
      press(win, "N");
      expect(await done).toBe(3); // New Game, uppercase tag
    }
  });
});
