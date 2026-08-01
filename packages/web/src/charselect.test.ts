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

  // ESC used to resume the most-recent living character, which made cancelling
  // the picker indistinguishable from choosing its top row and left no route back
  // to the title. It now goes back, whatever the roster holds.
  it("ESC goes back to the title, never into a game", async () => {
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = runCharacterSelect(term, [
        meta({ id: "dead1", name: "Ghost", alive: false }),
        meta({ id: "live1", name: "Alive" }),
      ]);
      press(win, "Escape");
      expect(await done).toEqual({ action: "back" });
    }
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = runCharacterSelect(term, [meta({ id: "dead1", alive: false })]);
      press(win, "Escape");
      expect(await done).toEqual({ action: "back" });
    }
  });

  it("the footer names every key this screen has, including where ESC goes", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "a1", name: "Alpha" })]);
    await tick();
    const footer = term.snapshot().join("\n");
    expect(footer).toContain("ESC title");
    expect(footer).toContain("Del delete");
    /* Export and import are the only way a character crosses between two copies
     * of the game, and a key nobody is told about is a feature nobody has. */
    expect(footer).toContain("Shift-X export");
    expect(footer).toContain("Shift-M import");
    press(win, "Escape");
    await done;
  });

  /* Carrying a character to another copy of the game (save-transfer.ts). Both
   * keys close the menu on a row the player did not choose, so both have to be
   * resolved before the row meanings - a bug there reads as "export resumed the
   * character instead of exporting it".
   *
   * The key registered is the CAPITAL, which is what a shifted press puts in
   * ev.key. The command layer tries commands[key] then commands[lowercased], so
   * registering the capital leaves lower-case x and m free to go on being row
   * selection tags (pinned below). */
  it("Shift-X exports the character the cursor is on", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [
      meta({ id: "a1", name: "Alpha" }),
      meta({ id: "b2", name: "Beta" }),
    ]);
    await tick();
    press(win, "ArrowDown");
    await tick();
    press(win, "X");
    expect(await done).toEqual({ action: "export", id: "b2" });
  });

  it("Shift-X does nothing on a tombstone, whose bytes are already gone", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "dead1", alive: false })]);
    await tick();
    press(win, "X");
    await tick();
    /* Still up, so the key was consumed rather than resolving anything. */
    press(win, "Escape");
    expect(await done).toEqual({ action: "back" });
  });

  it("Shift-M imports, whatever row the cursor happens to be on", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "a1", name: "Alpha" })]);
    await tick();
    press(win, "M");
    expect(await done).toEqual({ action: "import" });
  });

  it("Shift-M works with an EMPTY roster, which is when it is most needed", async () => {
    /* A player who has just installed the game and wants the character from
     * their other copy has no rows at all to stand on. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, []);
    await tick();
    press(win, "M");
    expect(await done).toEqual({ action: "import" });
  });

  it("leaves lower-case x and m as row selection tags", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const many = Array.from({ length: 25 }, (_, i) =>
      meta({ id: `c${String(i)}`, name: `Char${String(i)}` }),
    );
    const done = runCharacterSelect(term, many);
    await tick();
    press(win, "x"); // the 24th row: a, b, c ... x
    expect(await done).toEqual({ action: "resume", id: "c23" });
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

  it("Del on a living row asks first, then deletes that save", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [
      meta({ id: "a1", name: "Alpha" }),
      meta({ id: "b2", name: "Beta" }),
    ]);
    press(win, "ArrowDown"); // cursor onto Beta
    press(win, "Delete");
    await tick();
    /* Named the character, and said plainly that it cannot be undone. */
    expect(term.snapshot()[0]).toContain("Delete Beta the Human Warrior, level 3?");
    expect(term.snapshot().join("|")).toContain("There is no undo");
    press(win, "b"); // Delete this save PERMANENTLY
    expect(await done).toEqual({ action: "delete", id: "b2" });
  });

  it("Backspace also asks, and keeping the character returns to the list", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "a1", name: "Alpha" })]);
    press(win, "Backspace");
    await tick();
    expect(term.snapshot()[0]).toContain("Delete Alpha");
    press(win, "a"); // Keep this character
    await tick();
    expect(term.snapshot()[0]).toContain("Select a character");
    /* The row still plays: the delete request did not leak into the resume. */
    press(win, "a");
    expect(await done).toEqual({ action: "resume", id: "a1" });
  });

  it("Del on the New row is a no-op (there is no save behind it)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runCharacterSelect(term, [meta({ id: "a1", name: "Alpha" })]);
    press(win, "ArrowDown"); // cursor onto [ New character ]
    press(win, "Delete");
    await tick();
    expect(term.snapshot()[0]).toContain("Select a character");
    press(win, "Escape");
    expect(await done).toEqual({ action: "back" });
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
