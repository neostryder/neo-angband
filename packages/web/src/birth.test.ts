/**
 * Gap #58: the staged birth flow (ui-birth.c). Verifies the faithful stage
 * order QUICKSTART -> RACE -> CLASS -> ROLLER_CHOICE -> NAME -> FINAL_CONFIRM
 * (birth_stage enum L60-74 - NO sex/gender stage in 4.2.6), ESC as BIRTH_BACK
 * (step back one stage, prior cursor restored; stage-0 ESC keeps the default
 * character - EXCEPT on the quick-start screen, whose only exit upstream is
 * KTRL('X'), see that describe block), and the faithful multi-column menu: all_letters_nohjkl
 * row tags (h/j/k/l skipped), no invented Random/Finish rows, the light-blue
 * instruction header, the yellow stage hint, and the Self/RB/CB/EB/Best stat
 * tables with the "Total Cost:" line and the exact upstream prompts.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { runBirth } from "./birth";
import { SCREEN_REGION_ID } from "./overlay";
import { liveRegionStack, resetRegionStack } from "./ui-stack";
import { initLaunchArgs, resetLaunchArgs } from "./launch";
import type { GlyphTerm } from "./term";
import type { BirthDeps } from "./birth";
import type { PlayerClass, PlayerPackRecords, PlayerRace } from "@rpgm-tools/neo-angband-core";
import {
  bindPlayer,
  HostDir,
  NULL_HOST,
  OPTION_ENTRIES,
  Rng,
  colorToCss,
  COLOUR_L_BLUE,
  COLOUR_YELLOW,
  optionsSaveCustomText,
  setHost,
} from "@rpgm-tools/neo-angband-core";
import type { HostIo } from "@rpgm-tools/neo-angband-core";

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

interface TestTerm extends GlyphTerm {
  snapshot(): string[];
  /** CSS colour written to the cell at (x, y), or "" if never printed. */
  colorAt(x: number, y: number): string;
  /** Deliver a tap to whatever handler is installed, or report that none is. */
  tap(row: number, col?: number): boolean;
}

/**
 * The REAL terminal size: 80x24 (term.ts FIXED_COLS/FIXED_ROWS), which is what
 * upstream lays the birth screens out for. It used to be 70 columns - below
 * POINTBUY_WIDE_MIN - so these tests only ever exercised the narrow fallback
 * while the game ran the wide layout.
 */
function makeTerm(cols = 80, rows = 24): TestTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const colors: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(""));
  let onTap: ((cell: { row: number; col: number }) => void) | null = null;
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
      for (const row of colors) row.fill("");
    },
    /* Term_erase(x, y, 255) + c_prt = erase-then-draw (ui-output.c:385-391).
     * print() is put_str and does NOT erase (ui-output.c:362-379); the two must
     * stay distinguishable in the fake or a prt site cannot be tested. */
    eraseToEol: (x: number, y: number) => {
      const row = grid[y];
      const crow = colors[y];
      for (let cx = Math.max(0, x); cx < cols; cx++) {
        if (row) row[cx] = " ";
        if (crow) crow[cx] = "";
      }
    },
    prt: (x: number, y: number, text: string, fg?: string) => {
      const row = grid[y];
      const crow = colors[y];
      for (let cx = Math.max(0, x); cx < cols; cx++) {
        if (row) row[cx] = " ";
        if (crow) crow[cx] = "";
      }
      for (let i = 0; i < text.length && x + i < cols; i++) {
        if (row) row[x + i] = text[i] ?? " ";
        if (crow) crow[x + i] = fg ?? "";
      }
    },
    print: (x: number, y: number, text: string, fg?: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        const crow = colors[y];
        if (row) row[x + i] = text[i] ?? " ";
        if (crow) crow[x + i] = fg ?? "";
      }
    },
    put: (x: number, y: number, glyph: { ch: string }) => {
      const row = grid[y];
      if (row && x >= 0 && x < cols) row[x] = glyph.ch;
    },
    /* THE REST OF `GridSurface`, and their absence was not harmless (#253).
     *
     * This double is cast through `unknown`, so nothing made it implement the
     * interface, and the birth screens only ever reached these four through an
     * optional call - `term.setCursor?.(...)` in selectFromMenu's paint, which
     * is there for exactly this kind of hand-written double. `?.` on a missing
     * method is a silent no-op, so the gap cost nothing and stayed invisible.
     *
     * A REGION SURFACE TAKES THAT SAFETY NET AWAY, because `clipSurface` always
     * defines `setCursor` - the `?.` then finds a function, and the wrapper
     * forwards to a host that has none. The result was a TypeError thrown inside
     * `runHelp`, swallowed by `openBirthHelp`'s own `.catch`, with the only
     * symptom being that '?' quietly did nothing. That is the same shape as the
     * `onCellTap` gap this double already carries a comment about, and the same
     * lesson: a double that lies about its interface tests a different object
     * from the one the game runs. */
    invalidate: () => {},
    flush: () => {},
    setCursor: () => {},
    hideCursor: () => {},
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
    colorAt: (x: number, y: number) => colors[y]?.[x] ?? "",
    /* The touch seam. It used to be absent, so every `term.onCellTap?.(...)`
     * in the birth screens was an optional call on undefined - which means the
     * tap handlers were never registered and never tested, and a screen that
     * forgot to re-install one after a modal would look fine here. */
    onCellTap: (fn: ((cell: { row: number; col: number }) => void) | null) => {
      onTap = fn;
    },
    tap: (row: number, col = 0) => {
      if (!onTap) return false;
      onTap({ row, col });
      return true;
    },
  } as unknown as TestTerm;
}

function press(win: FakeWindow, key: string, mods: { ctrl?: boolean } = {}): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & {
    key: string;
    ctrlKey: boolean;
  };
  ev.key = key;
  ev.ctrlKey = mods.ctrl === true;
  win.dispatchEvent(ev);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Row index of the first line whose text contains `needle`, or -1.
function rowOf(term: TestTerm, needle: string): number {
  return term.snapshot().findIndex((line) => line.includes(needle));
}

// The birth menus read only .name and .statAdj from a race/class, so these
// minimal stand-ins are cast to the full record types (the fields the flow
// touches are all present; the rest are never read on these paths).
const RACES = [
  { name: "Human", statAdj: [0, 0, 0, 0, 0] },
  { name: "Half-Elf", statAdj: [0, 1, -1, 1, -1] },
  { name: "Dwarf", statAdj: [2, -3, 2, -2, 2] },
] as unknown as PlayerRace[];
const CLASSES = [
  { name: "Warrior", statAdj: [3, -2, -2, 2, 2] },
  { name: "Mage", statAdj: [-3, 3, 0, 1, -2] },
] as unknown as PlayerClass[];

// An 11-race list to exercise the all_letters_nohjkl tag assignment.
const RACES11 = [
  "Human", "Half-Elf", "Elf", "Hobbit", "Gnome", "Dwarf",
  "Half-Orc", "Half-Troll", "Dunadan", "High-Elf", "Kobold",
].map((name) => ({ name, statAdj: [0, 0, 0, 0, 0] })) as unknown as PlayerRace[];

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  setHost(NULL_HOST);
});

/** A HostIo whose USER directory is a Map (PORT_TODO 5.3). */
function memHost(files: Map<string, string>): HostIo {
  return {
    ...NULL_HOST,
    displayPath: (dir, name) => `${dir}/${name}`,
    exists: (dir, name) => dir === HostDir.USER && files.has(name),
    read: (dir, name) => (dir === HostDir.USER ? (files.get(name) ?? null) : null),
    write: (dir, name, text) => {
      if (dir !== HostDir.USER) return "create-failed";
      files.set(name, text);
      return "ok";
    },
  };
}

describe("runBirth: faithful stage order (no sex stage)", () => {
  it("race -> class -> roller -> name -> confirm yields the full choice", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    // The race menu: the instruction header, the yellow hint at row 7, and the
    // race column at RACE_COL=2 / TABLE_ROW=9.
    expect(term.snapshot()[1]).toContain("Please select your character traits");
    expect(term.snapshot()[7]).toContain("Race affects stats and skills");
    expect(rowOf(term, "a) Human")).toBe(9);
    press(win, "c"); // Dwarf (tag c)
    await tick();
    expect(term.snapshot()[7]).toContain("Class affects stats");
    expect(rowOf(term, "a) Warrior")).toBeGreaterThanOrEqual(9);
    press(win, "b"); // Mage
    await tick();
    expect(term.snapshot()[7]).toContain("Point-based is recommended");
    expect(term.snapshot().join("\n")).toContain("Standard roller");
    press(win, "b"); // Standard roller -> the interactive roll screen
    await tick();
    // The roller stat table with the EB column.
    expect(term.snapshot().join("\n")).toContain("EB");
    expect(term.snapshot().join("\n")).toContain("'r' to reroll");
    press(win, "Enter"); // accept the roll -> name (roller_command:986)
    await tick();
    expect(term.snapshot()[0]).toContain("name");
    for (const ch of "Durin") press(win, ch);
    press(win, "Enter");
    await tick();
    // FINAL_CONFIRM: an explicit accept step.
    expect(term.snapshot()[0]).toContain("Durin the Dwarf Mage");
    press(win, "a"); // Begin the adventure
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
    expect(choice!.className).toBe("Mage");
    expect(choice!.name).toBe("Durin");
    expect(choice!.roller).toBe("roller");
    // The accepted standard-roller stats ride as rolledStats (natural 8..17).
    expect(choice!.rolledStats).toHaveLength(5);
    for (const s of choice!.rolledStats!) {
      expect(s).toBeGreaterThanOrEqual(8);
      expect(s).toBeLessThanOrEqual(17);
    }
    // Point-buy `stats` is absent on the standard-roller path.
    expect(choice).not.toHaveProperty("stats");
  });

  it("never shows a sex/gender stage (removed: not in 4.2.6 ui-birth.c)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const seen: string[] = [];
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    const record = (): void => {
      seen.push(term.snapshot().join("\n"));
    };
    await tick(); record();                  // race
    press(win, "a"); await tick(); record(); // -> class
    press(win, "a"); await tick(); record(); // -> roller
    press(win, "a"); await tick(); record(); // Point-based -> points screen
    press(win, "Enter"); await tick(); record(); // accept allocation -> name
    press(win, "Enter"); await tick(); record(); // empty name -> confirm
    press(win, "a");
    const choice = await done;
    expect(choice).not.toBeNull();
    expect(choice).not.toHaveProperty("sex");
    for (const snap of seen) {
      expect(snap).not.toContain("Female");
      expect(snap).not.toContain("choose a sex");
    }
    // An empty name defaults to Adventurer, roller default is point-based.
    expect(choice!.name).toBe("Adventurer");
    expect(choice!.roller).toBe("point");
    // With no adjustments made, the allocation is every stat at the base of 10.
    expect(choice!.stats).toEqual([10, 10, 10, 10, 10]);
  });

  it("ESC on the class stage steps BACK to race with the prior cursor", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "b"); // pick Half-Elf
    await tick();
    expect(term.snapshot()[7]).toContain("Class affects stats");
    press(win, "Escape"); // BIRTH_BACK
    await tick();
    expect(term.snapshot()[7]).toContain("Race affects stats");
    // The cursor re-enters on the previously chosen race (Half-Elf, row 10),
    // drawn in the light-blue cursor colour (curs_attrs[CURS_KNOWN][1],
    // ui-menu.c L29-32).
    const heRow = rowOf(term, "b) Half-Elf");
    expect(heRow).toBe(10);
    expect(term.colorAt(2, heRow)).toBe(colorToCss(COLOUR_L_BLUE));
    press(win, "Escape"); // stage 0: BIRTH_RESET (start over), not an exit
    expect(await done).toBeNull();
  });

  it("ESC on the race stage (stage 0) means BIRTH_RESET - start over, not keep a default", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "Escape");
    // null is BIRTH_RESET (ui-birth.c:1661-1666: BIRTH_BACK off the first stage
    // -> BIRTH_QUICKSTART -> BIRTH_RESET), so the CALLER must re-enter birth.
    // Upstream has no ESC exit from creation at all - only KTRL('X') quits.
    expect(await done).toBeNull();
  });

  it("confirm's 'Go back' returns to the name prompt", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // race Human
    press(win, "a"); await tick(); // class Warrior
    press(win, "b"); await tick(); // Standard roller -> the roll screen
    press(win, "Enter"); await tick(); // accept the roll -> name
    for (const ch of "Bo") press(win, ch);
    press(win, "Enter");
    await tick();
    expect(term.snapshot()[0]).toContain("Bo the Human Warrior");
    press(win, "b"); // Go back
    await tick();
    expect(term.snapshot()[0]).toContain("name");
    press(win, "Enter"); // accept the remembered name again
    await tick();
    press(win, "a");
    expect((await done)!.name).toBe("Bo");
  });

  it("confirm's 'Start over' (S / BIRTH_RESET) restarts from the race screen", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // race Human
    press(win, "a"); await tick(); // class Warrior
    press(win, "b"); await tick(); // Standard roller -> the roll screen
    press(win, "Enter"); await tick(); // accept the roll -> name
    for (const ch of "Zed") press(win, ch);
    press(win, "Enter");
    await tick();
    expect(term.snapshot()[0]).toContain("Zed the Human Warrior");
    // Start over is row c in the fallback menu (Begin=a, Go back=b, Start over=c),
    // BIRTH_RESET: back to the race screen with every choice discarded.
    press(win, "c");
    await tick();
    expect(term.snapshot()[1]).toContain("Please select your character traits");
    expect(rowOf(term, "a) Human")).toBe(9);
    // A fresh full run now completes with a different character.
    press(win, "b"); await tick(); // Half-Elf
    press(win, "a"); await tick(); // Warrior
    press(win, "b"); await tick(); // Standard roller
    press(win, "Enter"); await tick(); // accept roll -> name (name was cleared)
    press(win, "Enter"); await tick(); // empty name -> confirm
    press(win, "a"); // Begin
    const choice = await done;
    expect(choice!.raceName).toBe("Half-Elf");
    expect(choice!.name).toBe("Adventurer"); // the cleared name defaulted
  });
});

describe("runBirth: faithful menu appearance (ui-birth.c menus)", () => {
  it("tags race rows from all_letters_nohjkl, skipping h/j/k/l", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90, 24);
    const done = runBirth(term, RACES11, CLASSES, { rng: new Rng(1) });
    await tick();
    const snap = term.snapshot().join("\n");
    // 11 races -> a,b,c,d,e,f,g,i,m,n,o (h/j/k/l skipped).
    expect(snap).toContain("a) Human");
    expect(snap).toContain("g) Half-Orc"); // index 6 -> g
    expect(snap).toContain("i) Half-Troll"); // index 7 -> i (h skipped)
    expect(snap).toContain("m) Dunadan"); // index 8 -> m
    expect(snap).toContain("n) High-Elf"); // index 9 -> n
    expect(snap).toContain("o) Kobold"); // index 10 -> o
    // No h/j/k/l tags appear.
    expect(snap).not.toContain("h) ");
    expect(snap).not.toContain("j) ");
    expect(snap).not.toContain("k) ");
    expect(snap).not.toContain("l) ");
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("has no invented Random / Finish menu rows", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    const snap = term.snapshot().join("\n");
    expect(snap).not.toContain("Random");
    expect(snap).not.toContain("Finish randomly");
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("draws the light-blue instruction header and the yellow stage hint", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    // print_menu_instructions: title at (QUESTION_COL=2, HEADER_ROW=1) light blue.
    expect(term.snapshot()[1]).toContain("Please select your character traits");
    expect(term.colorAt(2, 1)).toBe(colorToCss(COLOUR_L_BLUE));
    // The wrapped key legend mentions the highlighted keys.
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("movement keys");
    expect(snap).toContain("random menu item");
    // The stage hint at (QUESTION_COL=2, QUESTION_ROW=7) drawn in yellow.
    expect(term.snapshot()[7]).toContain("Race affects stats");
    expect(term.colorAt(2, 7)).toBe(colorToCss(COLOUR_YELLOW));
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("keeps the chosen race column visible on the class menu", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "c"); // Dwarf
    await tick();
    // The race column stays at RACE_COL=2 with Dwarf highlighted in the
    // light-blue cursor colour (curs_attrs[CURS_KNOWN][1]); the class column
    // is drawn at CLASS_COL=19.
    const snap = term.snapshot();
    const dwarfRow = rowOf(term, "c) Dwarf");
    expect(dwarfRow).toBe(11);
    expect(term.colorAt(2, dwarfRow)).toBe(colorToCss(COLOUR_L_BLUE));
    expect(snap[9]?.slice(19)).toContain("a) Warrior");
    press(win, "Escape"); await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  /**
   * #127: h/j/k/l are deliberately reserved as free movement keys on this menu
   * (all_letters_nohjkl, birth.ts's ALL_LETTERS_NOHJKL) - so upstream's own
   * roguelike keyset drives the cursor with them here too (target_dir_allow ->
   * process_dir, ui-target.c:99-108 remaps hjkl onto the same directions
   * arrows/numpad use, for every menu). Reported on Discord as "hjkl do nothing
   * on the race selection screen" even with the roguelike keyset on.
   */
  it("navigates the race list with j/k under the roguelike keyset (issue #127)", async () => {
    setHost(memHost(new Map([
      ["customized_interface_options.txt", optionsSaveCustomText({ rogue_like_commands: true }, "INTERFACE")],
    ])));
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "j"); await tick(); // down: Human -> Half-Elf
    press(win, "j"); await tick(); // down: Half-Elf -> Dwarf
    press(win, "k"); await tick(); // up: Dwarf -> Half-Elf
    press(win, "Enter"); await tick(); // pick the highlighted row (Half-Elf)
    // Same assertion shape as the letter-driven test above: the chosen race
    // stays visible in its own column, highlighted, once the class menu opens.
    const snap = term.snapshot();
    const halfElfRow = rowOf(term, "b) Half-Elf");
    expect(term.colorAt(2, halfElfRow)).toBe(colorToCss(COLOUR_L_BLUE));
    expect(snap[9]?.slice(19)).toContain("a) Warrior");
    press(win, "Escape"); await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("does not navigate the race list with j/k under the ORIGINAL keyset (default)", async () => {
    setHost(NULL_HOST);
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "j"); await tick(); // NOT navigation here - free for movement later
    press(win, "Enter"); await tick(); // still on row 0 (Human)
    const snap = term.snapshot();
    const humanRow = rowOf(term, "a) Human");
    expect(term.colorAt(2, humanRow)).toBe(colorToCss(COLOUR_L_BLUE));
    expect(snap[9]?.slice(19)).toContain("a) Warrior");
    press(win, "Escape"); await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

describe("runBirth: point-based allocation stage (BIRTH_POINTBASED)", () => {
  it("buys stats, reports the choice, and takes the leftover-point gold path", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90); // wide enough for the untruncated centered prompt
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "a"); await tick(); // Point-based -> the allocation screen
    // The Self/RB/CB/EB/Best/Cost table with the "Total Cost:" line. (These stub
    // race/class records carry no generate_stats spread, so the pool opens at
    // the base 0/20; with the full registry it opens seeded, Total Cost 20/20.)
    expect(term.snapshot().join("\n")).toContain("EB");
    expect(term.snapshot().join("\n")).toContain("Total Cost:  0/20");
    expect(term.snapshot().join("\n")).toContain("Starting gold: 1600"); // 600 + 50*20
    // The exact upstream prompt.
    expect(term.snapshot().join("\n")).toContain(
      "[up/down to move, left/right to modify, 'r' to reset, 'Enter' to accept]",
    );
    // Raise STR (cursor starts on row 0) by two points, then accept.
    press(win, "ArrowRight");
    press(win, "ArrowRight");
    expect(term.snapshot().join("\n")).toContain("Total Cost:  2/20");
    press(win, "Enter"); await tick(); // -> name
    expect(term.snapshot()[0]).toContain("name");
    press(win, "Enter"); await tick(); // empty name -> confirm
    press(win, "a"); // begin
    const choice = await done;
    expect(choice!.roller).toBe("point");
    expect(choice!.stats).toEqual([12, 10, 10, 10, 10]);
  });

  it("ESC from the allocation screen steps back to the roller choice", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "a"); await tick(); // Point-based -> allocation
    expect(term.snapshot().join("\n")).toContain("Total Cost:");
    press(win, "Escape"); await tick(); // BIRTH_BACK -> roller choice
    expect(term.snapshot()[7]).toContain("Choose how to generate"); // ROLLER_HINT
    press(win, "Escape"); await tick(); // -> class
    press(win, "Escape"); await tick(); // -> race
    press(win, "Escape"); // stage 0 -> keep default
    expect(await done).toBeNull();
  });

  it("'r' resets the pool after buying", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick();
    press(win, "a"); await tick();
    press(win, "a"); await tick(); // Point-based
    press(win, "ArrowRight"); // buy STR
    press(win, "ArrowRight");
    expect(term.snapshot().join("\n")).toContain("Total Cost:  2/20");
    press(win, "r"); // reset
    expect(term.snapshot().join("\n")).toContain("Total Cost:  0/20");
    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("re-picking class after a point-buy discards the allocation (player-birth.c do_cmd_choose_class:1105-1113)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "a"); await tick(); // Point-based -> allocation
    press(win, "ArrowRight");
    press(win, "ArrowRight");
    expect(term.snapshot().join("\n")).toContain("Total Cost:  2/20");
    press(win, "Enter"); await tick(); // accept -> name
    press(win, "Escape"); await tick(); // ESC steps back to allocation: no reset,
    // the prior buy is restored (ui-birth.c BIRTH_BACK issues no command).
    expect(term.snapshot().join("\n")).toContain("Total Cost:  2/20");
    press(win, "Escape"); await tick(); // -> roller choice
    press(win, "Escape"); await tick(); // -> class choice
    press(win, "b"); await tick(); // re-pick class (Mage): do_cmd_choose_class
    // reruns reset_stats + generate_stats unconditionally, discarding the buy.
    press(win, "a"); await tick(); // Point-based again -> a fresh allocation
    expect(term.snapshot().join("\n")).toContain("Total Cost:  0/20");
    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

/**
 * textui_birth_quickstart (ui-birth.c:103-136).
 *
 * These tests were rewritten on 2026-07-28 because they asserted the port's own
 * paraphrase rather than the C. The screen used to be a two-row menu under the
 * subtitle "Quick-start uses your previous choices" - which had no 'Y' row at
 * all, so the one thing quick-start exists for (replay the previous character AS
 * IS, without retyping its name) could not be done. The tests passed throughout,
 * because they checked for the paraphrase.
 */
describe("runBirth: quickstart stage (quickstart_allowed)", () => {
  const QUICK = { quickstart: { raceName: "Dwarf", className: "Mage" } };
  const PROMPT =
    "['Y': use as is; 'N': redo; 'C': change name/history; '=': set birth options]";

  beforeEach(() => {
    resetLaunchArgs();
  });

  it("draws upstream's header and prompt verbatim, over display_player(0)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    /* prt("New character based on previous one:", 0, 0). */
    expect(term.snapshot()[0]).toContain("New character based on previous one:");
    /* prt(prompt, Term->hgt - 1, ...): the bottom row, centred. */
    const rows = term.snapshot();
    expect(rows[rows.length - 1]).toContain(PROMPT);
    press(win, "x", { ctrl: true });
    expect(await done).toBeNull();
  });

  it("'Y' accepts the previous character as is - no name stage, no confirm", async () => {
    /* cmdq_push(CMD_ACCEPT_CHARACTER); next = BIRTH_COMPLETE (ui-birth.c:129). */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, {
      ...QUICK,
      rng: new Rng(1),
      previousName: "Aragorn II",
    });
    await tick();
    press(win, "Y");
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
    expect(choice!.className).toBe("Mage");
    /* The previous name with its suffix bumped, which is the whole point: no
     * prompt was shown and none was answered. */
    expect(choice!.name).toBe("Aragorn III");
  });

  it("accepts lower-case 'y' and 'n' and 'c' too", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "y");
    expect((await done)!.raceName).toBe("Dwarf");
  });

  it("'C' keeps the character and goes to the name stage", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "C");
    await tick();
    expect(term.snapshot()[0]).toContain("name");
    press(win, "Enter");
    await tick();
    press(win, "a"); // confirm
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
    expect(choice!.className).toBe("Mage");
  });

  it("ignores 'C' under arg_force_name (ui-birth.c:124)", async () => {
    /* `!arg_force_name && (ke.code == 'C' || ke.code == 'c')` - with the name
     * pinned the key matches nothing and the loop keeps waiting. It must NOT
     * fall through to some other action. */
    initLaunchArgs(["-f"]);
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "C");
    await tick();
    press(win, "c");
    await tick();
    /* Still the quick-start screen: nothing advanced. */
    expect(term.snapshot()[0]).toContain("New character based on previous one:");
    press(win, "Y");
    expect((await done)!.raceName).toBe("Dwarf");
  });

  it("restores the prior character's stats on quickstart (load_roller_data)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1),
      quickstart: { raceName: "Dwarf", className: "Mage", stats: [17, 10, 10, 10, 16] },
    });
    await tick();
    press(win, "C"); // keep the character, rename it
    await tick();
    press(win, "Enter"); // accept default name
    await tick();
    press(win, "a"); // confirm
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
    expect(choice!.className).toBe("Mage");
    expect(choice!.roller).toBe("point");
    expect(choice!.stats).toEqual([17, 10, 10, 10, 16]);
  });

  it("restores those stats on 'Y' as well, not only on 'C'", async () => {
    /* Upstream has already reloaded the character before the prompt is drawn -
     * the keys choose how much of it to keep, not whether it was loaded. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1),
      quickstart: { raceName: "Dwarf", className: "Mage", stats: [17, 10, 10, 10, 16] },
    });
    await tick();
    press(win, "Y");
    const choice = await done;
    expect(choice!.roller).toBe("point");
    expect(choice!.stats).toEqual([17, 10, 10, 10, 16]);
  });

  it("'*' at the interactive name prompt draws from opts.randomName (ui-input.c:1038)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, {
      ...QUICK,
      rng: new Rng(1),
      randomName: () => "Bilbo",
    });
    await tick();
    press(win, "C"); // to the name stage
    await tick();
    // get_character_name's own prompt (ui-input.c:1153) advertises '*'.
    expect(term.snapshot()[0]).toContain(
      "Enter a name for your character (* for a random name):",
    );
    press(win, "*");
    expect(term.snapshot().join("\n")).toContain("Bilbo");
    press(win, "Enter");
    await tick();
    press(win, "a"); // confirm
    const choice = await done;
    expect(choice!.name).toBe("Bilbo");
  });

  it("ESC from the name stage steps back to quickstart, not to unseen menus", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "C");
    await tick();
    press(win, "Escape"); // back out of the name prompt
    await tick();
    expect(term.snapshot()[0]).toContain("New character based on previous one:");
    press(win, "x", { ctrl: true }); // quit(NULL)
    expect(await done).toBeNull();
  });

  it("leaves birth on Ctrl-X and NOT on ESC (ui-birth.c:121-123)", async () => {
    /* Upstream's only exit from this screen is KTRL('X') -> quit(NULL); plain
     * ESCAPE is guarded by `terms_disconnecting`, which this one-terminal front
     * end has no equivalent of. So ESC here must do nothing at all. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "Escape");
    await tick();
    expect(term.snapshot()[0]).toContain("New character based on previous one:");
    press(win, "x", { ctrl: true });
    expect(await done).toBeNull();
  });

  it("'N' proceeds to the race stage", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "N"); // CMD_BIRTH_RESET -> BIRTH_RACE_CHOICE
    await tick();
    expect(term.snapshot()[7]).toContain("Race affects stats");
    press(win, "Escape"); // back to quickstart
    await tick();
    press(win, "x", { ctrl: true });
    expect(await done).toBeNull();
  });

  it("skips the name stage entirely under arg_force_name (ui-birth.c:1287)", async () => {
    /* `if (arg_force_name) next = BIRTH_HISTORY_CHOICE;` - no prompt is drawn
     * and none is answered, and arg_name becomes the character's name
     * (L1277-1279). */
    initLaunchArgs(["-f", "-uThorin"]);
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1), quickstart: null });
    await tick();
    press(win, "a"); await tick(); // race
    press(win, "a"); await tick(); // class
    press(win, "b"); await tick(); // standard roller
    press(win, "Enter"); await tick(); // accept the roll -> would be the name stage
    /* Straight to the final confirm, already named. */
    expect(term.snapshot()[0]).toContain("Thorin the");
    expect(term.snapshot()[0]).not.toContain("Enter a name");
    press(win, "a"); // Begin the adventure
    expect((await done)!.name).toBe("Thorin");
  });

  it("'@' finish-at-random uses arg_name, not a random one (ui-birth.c:711)", async () => {
    /* The arg_force_name arm generates NOTHING: a host that pinned the name did
     * not ask for a random one. Without the gate, randomName would win. */
    initLaunchArgs(["-f", "-uThorin"]);
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    /* finish_with_random_choices seeds a point-buy via generate_stats, which
     * reads calc_blows and the magic realm, so this path needs whole classes. */
    const FULL = [
      {
        name: "Warrior",
        statAdj: [3, -2, -2, 2, 2],
        minWeight: 30,
        attMultiply: 5,
        maxAttacks: 6,
        magic: { totalSpells: 0, books: [] },
      },
    ] as unknown as typeof CLASSES;
    const done = runBirth(term, RACES, FULL, {
      rng: new Rng(1),
      quickstart: null,
      randomName: () => "Randomly",
    });
    await tick();
    press(win, "@"); // finish the rest of the character at random
    await tick();
    press(win, "a"); // Begin the adventure
    expect((await done)!.name).toBe("Thorin");
  });

  it("without a prior character there is no quickstart stage", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1), quickstart: null });
    await tick();
    expect(term.snapshot()[0]).not.toContain("New character based on previous one:");
    expect(term.snapshot()[7]).toContain("Race affects stats");
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("'=' opens the birth-options editor and re-shows the quickstart screen", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    expect(term.snapshot()[0]).toContain("New character based on previous one:");
    // textui_birth_quickstart ('=', ui-birth.c:126): opens do_cmd_options_birth.
    press(win, "="); await tick();
    expect(term.snapshot().join("\n")).toContain("Birth options");
    // ESC leaves the editor; the SAME screen is shown again (next = current).
    press(win, "Escape"); await tick();
    expect(term.snapshot()[0]).toContain("New character based on previous one:");
    // Still live and usable: rename then finish.
    press(win, "C"); await tick();
    press(win, "Enter"); await tick(); // default name
    press(win, "a"); // confirm
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
    expect(choice!.className).toBe("Mage");
  });

  it("the birth-options editor OPENS ON the player's customised defaults", async () => {
    /* PORT_TODO 5.3, and the point of the whole row: options_init_defaults
     * restores OP_BIRTH from customized_birth_options.txt in player_init
     * (option.c:198), long before any stage runs, so what a previous character
     * saved with 's' is what this one's '=' screen shows. Without the seeding
     * the editor opens on the table every time and 's' writes a file nothing
     * reads. */
    const first = OPTION_ENTRIES.find((e) => e.type === "BIRTH")!;
    const inverted: Record<string, boolean> = {};
    for (const e of OPTION_ENTRIES) if (e.type === "BIRTH") inverted[e.name] = !e.normal;
    setHost(memHost(new Map([
      ["customized_birth_options.txt", optionsSaveCustomText(inverted, "BIRTH")],
    ])));

    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100);
    const done = runBirth(term, RACES, CLASSES, { ...QUICK, rng: new Rng(1) });
    await tick();
    press(win, "="); await tick();
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Birth options");
    /* The row shows the FILE's value, which is the opposite of the table's. */
    expect(snap).toMatch(
      new RegExp(`: ${first.normal ? "no " : "yes"}\\s+\\(${first.name}\\)`),
    );

    press(win, "Escape"); await tick();
    press(win, "C"); await tick();
    press(win, "Enter"); await tick();
    press(win, "a");
    /* ...and it rides out as the birth choice startGame freezes. */
    expect((await done)!.birthOptions?.[first.name]).toBe(!first.normal);
  });

  it("a choice made in this session still beats the customised file", async () => {
    const first = OPTION_ENTRIES.find((e) => e.type === "BIRTH")!;
    const inverted: Record<string, boolean> = { [first.name]: !first.normal };
    setHost(memHost(new Map([
      ["customized_birth_options.txt", optionsSaveCustomText(inverted, "BIRTH")],
    ])));

    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100);
    const done = runBirth(term, RACES, CLASSES, {
      ...QUICK,
      rng: new Rng(1),
      birthOptions: { [first.name]: first.normal },
    });
    await tick();
    press(win, "C"); await tick();
    press(win, "Enter"); await tick();
    press(win, "a");
    expect((await done)!.birthOptions?.[first.name]).toBe(first.normal);
  });
});

describe("runBirth: standard roller screen (roller_command)", () => {
  it("reroll exposes the 'previous roll' option, prev swaps it back", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "b"); await tick(); // Standard roller -> roll screen
    // Before any reroll the exact no-reroll prompt shows, without the prev clause.
    expect(term.snapshot().join("\n")).toContain("['r' to reroll or 'Enter' to accept]");
    expect(term.snapshot().join("\n")).not.toContain("previous roll");
    press(win, "r"); // reroll: save prev, roll fresh (do_cmd_roll_stats)
    expect(term.snapshot().join("\n")).toContain(
      "['r' to reroll, 'p' for previous roll or 'Enter' to accept]",
    );
    press(win, "p"); // do_cmd_prev_stats: swap in the stored previous roll
    press(win, "Enter"); await tick(); // accept -> name
    expect(term.snapshot()[0]).toContain("name");
    press(win, "Enter"); await tick(); // default name -> confirm
    press(win, "a");
    const choice = await done;
    expect(choice!.roller).toBe("roller");
    expect(choice!.rolledStats).toHaveLength(5);
  });

  it("ESC from the roll screen steps back to the roller choice", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "b"); await tick(); // Standard roller -> roll screen
    expect(term.snapshot().join("\n")).toContain("'r' to reroll");
    press(win, "Escape"); await tick(); // BIRTH_BACK -> roller choice
    expect(term.snapshot()[7]).toContain("Point-based is recommended");
    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

describe("runBirth: menu_question '*' random and '@' finish", () => {
  it("'*' on the race menu picks a random race and advances to class", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "*"); // select a race at random (ui-birth.c:841)
    await tick();
    expect(term.snapshot()[7]).toContain("Class affects stats");
    press(win, "Escape"); await tick(); // back to race
    press(win, "Escape"); // stage 0 -> keep default
    expect(await done).toBeNull();
  });

  it("'@' finishes the character at random and jumps to confirm", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    // finish_with_random_choices seeds a default point-buy via generate_stats,
    // which reads calc_blows (minWeight/attMultiply/maxAttacks) and the class
    // magic realm, so the '@' path needs fully-formed classes.
    const FULL_CLASSES = [
      {
        name: "Warrior",
        statAdj: [3, -2, -2, 2, 2],
        minWeight: 30,
        attMultiply: 5,
        maxAttacks: 6,
        magic: { totalSpells: 0, books: [] },
      },
      {
        name: "Mage",
        statAdj: [-3, 3, 0, 1, -2],
        minWeight: 40,
        attMultiply: 2,
        maxAttacks: 4,
        magic: { totalSpells: 1, books: [{ realm: { stat: 1 } }] },
      },
    ];
    const done = runBirth(
      term,
      RACES,
      FULL_CLASSES as unknown as typeof CLASSES,
      { rng: new Rng(1) },
    );
    await tick();
    press(win, "@"); // finish with random choices (ui-birth.c:851)
    await tick();
    // finish_with_random_choices jumps to BIRTH_FINAL_CONFIRM.
    expect(term.snapshot()[0]).toContain(" the ");
    press(win, "a"); // begin
    const choice = await done;
    expect(choice).not.toBeNull();
    // The default point-buy (generate_stats) supplies the stats.
    expect(choice!.roller).toBe("point");
    expect(choice!.stats).toHaveLength(5);
  });

  it("'@' also fills the name from player_random_name (ui-birth.c:725), via opts.randomName", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const FULL_CLASSES = [
      {
        name: "Warrior",
        statAdj: [3, -2, -2, 2, 2],
        minWeight: 30,
        attMultiply: 5,
        maxAttacks: 6,
        magic: { totalSpells: 0, books: [] },
      },
      {
        name: "Mage",
        statAdj: [-3, 3, 0, 1, -2],
        minWeight: 40,
        attMultiply: 2,
        maxAttacks: 4,
        magic: { totalSpells: 1, books: [{ realm: { stat: 1 } }] },
      },
    ];
    const done = runBirth(
      term,
      RACES,
      FULL_CLASSES as unknown as typeof CLASSES,
      { rng: new Rng(1), randomName: () => "Frodo" },
    );
    await tick();
    press(win, "@");
    await tick();
    expect(term.snapshot()[0]).toContain("Frodo the ");
    press(win, "a");
    const choice = await done;
    expect(choice!.name).toBe("Frodo");
  });

  it("without opts.randomName, '@' leaves the name at the confirm default", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const FULL_CLASSES = [
      {
        name: "Warrior",
        statAdj: [3, -2, -2, 2, 2],
        minWeight: 30,
        attMultiply: 5,
        maxAttacks: 6,
        magic: { totalSpells: 0, books: [] },
      },
      {
        name: "Mage",
        statAdj: [-3, 3, 0, 1, -2],
        minWeight: 40,
        attMultiply: 2,
        maxAttacks: 4,
        magic: { totalSpells: 1, books: [{ realm: { stat: 1 } }] },
      },
    ];
    const done = runBirth(
      term,
      RACES,
      FULL_CLASSES as unknown as typeof CLASSES,
      { rng: new Rng(1) },
    );
    await tick();
    press(win, "@");
    await tick();
    press(win, "a");
    const choice = await done;
    expect(choice!.name).toBe("Adventurer");
  });
});

describe("runBirth: history-edit stage (get_history_command)", () => {
  it("accepts the supplied background and rides it as `history`", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1),
      historyFor: () => "You are the only child of a Serf.",
    });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "a"); await tick(); // Point-based
    press(win, "Enter"); await tick(); // accept allocation -> name
    press(win, "Enter"); await tick(); // default name -> history stage
    expect(term.snapshot().join("\n")).toContain("Accept character history?");
    expect(term.snapshot().join("\n")).toContain("only child of a Serf");
    press(win, "a"); await tick(); // "Accept this background" -> confirm
    press(win, "a"); // begin
    const choice = await done;
    expect(choice!.history).toBe("You are the only child of a Serf.");
  });

  it("without historyFor the history stage is skipped (name -> confirm)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "a"); await tick(); // Point-based
    press(win, "Enter"); await tick(); // accept -> name
    press(win, "Enter"); await tick(); // default name -> confirm directly
    expect(term.snapshot()[0]).toContain(" the ");
    press(win, "a");
    const choice = await done;
    expect(choice).not.toHaveProperty("history");
  });
});

describe("runBirth: per-row race/class stat detail (race_help/class_help)", () => {
  it("shows the highlighted race's help block and updates on move", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    // race_help (ui-birth.c L241-302): the stat-adjustment table
    // (stat_names_reduced) plus the skill_help block, drawn in the aux column.
    const human = term.snapshot().join("\n");
    expect(human).toMatch(/Str:\s+\+0/);
    expect(human).toContain("Hit/Shoot/Throw:");
    expect(human).toContain("Infravision:");
    press(win, "ArrowDown"); // Half-Elf: INT +1
    expect(term.snapshot().join("\n")).toMatch(/Int:\s+\+1/);
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The birth screens sit on display_player, not on a summary list      */
/* ------------------------------------------------------------------ */

describe("birth screens draw the real character sheet", () => {
  /**
   * These are source guards, not renders: the panels only appear when the shell
   * supplies BirthDeps (a bound player registry), which these unit tests do not
   * have. What can go wrong without a guard is the SHAPE - the screens once drew
   * characterSheetLines (the phone list) down the left column, so the point-buy
   * and confirm screens showed one column of "Label: value" instead of upstream's
   * five panels at their anchors, with no combat/skills panel and no history.
   * The layout itself is covered where it is implemented (charsheet.test.ts,
   * which now runs at the real 80x24).
   */
  const src = readFileSync(new URL("./birth.ts", import.meta.url), "utf8");

  it("paints display_player_xtra_info's panels, not a list column", () => {
    expect(src).toContain("drawPlayerXtraInfo(term, sheet.panels, sheet.history)");
    // The point-buy and roller screens both go through it.
    expect(src.match(/drawBirthPanels\(term, /gu)?.length).toBeGreaterThanOrEqual(2);
    // And the old list-in-a-column renderer is gone for good.
    expect(src).not.toContain("drawInfoColumn");
  });

  it("uses the C's own prompts on the name, history and confirm stages", () => {
    // get_character_name (ui-input.c:1153), get_history_command (ui-birth.c:1508)
    // and get_confirm_command (ui-birth.c:1548) - verbatim.
    expect(src).toContain('"Enter a name for your character (* for a random name): "');
    expect(src).toContain('"Accept character history? [y/n]"');
    expect(src).toContain(
      "to step back, 'S' to start over, or any other key to continue]",
    );
  });

  it("draws the sheet under each of those prompts", () => {
    // display_player(0) at BIRTH_NAME_CHOICE / HISTORY_CHOICE / FINAL_CONFIRM
    // (ui-birth.c:1707/1721/1733).
    expect(src.match(/drawBirthSheet\(/gu)?.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * PORT_TODO 3.19: '?' on a birth screen opens the help browser.
 *
 * Upstream has exactly two keyboard help sites in birth - menu_question
 * (ui-birth.c:859-861) and roller_command (:925-926 -> :993-994) - and
 * point_based_command has none. Both live INSIDE the stage's own input loop and
 * leave the stage alone, so what these tests check is not only that help opens
 * but that the screen behind it comes back byte-identical and still responds to
 * keys: the stage's listener is suspended while the modal runs, and a stage that
 * failed to re-arm it would be a dead birth screen.
 */
describe("runBirth: '?' opens help and returns to the same screen", () => {
  it("race menu: the cursor, the screen and the keyboard all survive help", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    // Move off the initial cursor, so "the cursor survived" is a real claim:
    // re-entering the stage would put it back on row 0 (Human).
    press(win, "ArrowDown");
    press(win, "ArrowDown");
    await tick();
    expect(term.colorAt(2, 11)).toBe(colorToCss(COLOUR_L_BLUE)); // Dwarf highlighted
    const before = term.snapshot().join("\n");

    press(win, "?");
    await tick();
    const help = term.snapshot().join("\n");
    expect(help).toContain("Angband Help");
    expect(help).toContain("Available commands");
    // The birth menu is gone while help is up - this is a modal, not an overlay.
    expect(help).not.toContain("Please select your character traits");

    press(win, "Escape"); // ESC at the help index exits help
    await tick();
    expect(term.snapshot().join("\n")).toBe(before);
    expect(term.colorAt(2, 11)).toBe(colorToCss(COLOUR_L_BLUE));
    // The TOUCH handler has to come back too - the help overlay nulls it on the
    // way out, so a stage that only re-armed its keyboard listener would leave
    // a tablet with no way to pick a race at all.
    expect(term.tap(-1)).toBe(true); // a row outside the column: registered, no-op

    // And the stage takes keys again: Enter picks the row the cursor is on.
    press(win, "Enter");
    await tick();
    expect(term.snapshot()[7]).toContain("Class affects stats");
    press(win, "a");
    await tick();
    press(win, "a"); // point-based
    await tick();
    press(win, "Enter"); // accept the allocation
    await tick();
    press(win, "Enter"); // default name
    await tick();
    press(win, "a"); // begin
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
  });

  it("standard roller: help is not a reroll, and 'p' is still on offer after it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(7) });
    await tick();
    press(win, "a"); await tick();  // Human
    press(win, "a"); await tick();  // Warrior
    press(win, "b"); await tick();  // Standard roller
    press(win, "r"); await tick();  // one reroll, so the 'p' clause is showing
    const before = term.snapshot().join("\n");
    expect(before).toContain("'p' for previous roll");

    press(win, "?");
    await tick();
    expect(term.snapshot().join("\n")).toContain("Angband Help");
    press(win, "Escape");
    await tick();
    // Byte-identical: the same roll, and the same prompt - so neither the stats
    // nor roller_command's static prev_roll was reset by opening help.
    expect(term.snapshot().join("\n")).toBe(before);
    expect(term.tap(-1)).toBe(true); // the footer-tap handler is back too

    press(win, "Enter"); // the roll help did not disturb is the one accepted
    await tick();
    expect(term.snapshot()[0]).toContain("name");
    press(win, "Enter"); await tick();
    press(win, "a");
    const choice = await done;
    expect(choice!.rolledStats).toHaveLength(5);
  });

  it("point-based has no help key (point_based_command does not offer one)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    void runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    press(win, "a"); await tick();  // Human
    press(win, "a"); await tick();  // Warrior
    press(win, "a"); await tick();  // Point-based
    const before = term.snapshot().join("\n");
    expect(before).toContain("'r' to reset");
    press(win, "?");
    await tick();
    expect(term.snapshot().join("\n")).not.toContain("Angband Help");
    expect(term.snapshot().join("\n")).toBe(before);
  });

  /**
   * Gap #5: do_cmd_help (ui-help.c:476) reads rogue_like_commands LIVE off the
   * player being built, not a fixed default - so the birth screen's help has
   * to open the roguelike command summary once that is the keyset in effect,
   * exactly like the running game's own '?' already does (help.ts's
   * runHelp). Before this fix runBirth's openBirthHelp always called
   * runHelp(term) with no keyset argument, so it defaulted to the original
   * keyset's summary regardless of rogue_like_commands.
   */
  it("shows the ROGUELIKE command summary when that keyset is the customised default", async () => {
    setHost(memHost(new Map([
      ["customized_interface_options.txt", optionsSaveCustomText({ rogue_like_commands: true }, "INTERFACE")],
    ])));

    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    void runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();

    press(win, "?"); await tick(); // the race menu's help key
    press(win, "a"); await tick(); // "Available commands", the index's first row
    press(win, "PageDown"); await tick(); // row 'h' is past the first screenful
    const page = term.snapshot().join("\n");
    // r_comm.txt-only text: the original-keyset table has no such row (its 'h'
    // is "Fire default ammo at target").
    expect(page).toContain("(walk - west)");
  });

  it("shows the ORIGINAL command summary by default (rogue_like_commands off)", async () => {
    setHost(NULL_HOST);
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    void runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();

    press(win, "?"); await tick();
    press(win, "a"); await tick();
    press(win, "PageDown"); await tick();
    const page = term.snapshot().join("\n");
    expect(page).not.toContain("(walk - west)");
    expect(page).toContain("Fire default ammo at target"); // commands.txt's 'h'
  });
});

/* ------------------------------------------------------------------ */
/* The birth SHEET PREVIEW, against the real shipped pack.            */
/* ------------------------------------------------------------------ */

/**
 * Every other test in this file omits `opts.deps`. That is not a small gap: with
 * no deps, `buildPreview` returns before it constructs its GameState, so the one
 * birth path that builds a state -- and the only one that calls into core's
 * character-sheet renderers -- was never executed by any test.
 *
 * It stayed unexecuted while 0b2c72530 (2026-08-06) gave core the known-state
 * twin. char-sheet.ts began reading `state.actor.knownCombat` and
 * `state.runeEnv`; birth.ts's hand-built `previewState` supplied neither, and
 * its `as unknown as GameState` cast meant tsc said nothing. (N)ew game threw
 * "Cannot read properties of undefined (reading 'slotObject')", then
 * "(reading 'toD')", and died at the crash reporter -- on a green suite, for
 * five days, shipped to the early channel.
 *
 * So this block's job is NOT to assert a layout; the tests above already do
 * that. Its job is to RUN the preview with real records, so that the next time a
 * sheet renderer reads a new GameState field, it fails here.
 */
describe("runBirth: the sheet preview builds a usable GameState", () => {
  function packRecords<T>(name: string): T[] {
    return (
      JSON.parse(
        readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
      ) as { records: T[] }
    ).records;
  }

  /* The real bound race/class/body/history records, not stand-ins: a stand-in is
   * how the production object drifted from its consumers in the first place. */
  const players = bindPlayer({
    races: packRecords("p_race"),
    classes: packRecords("class"),
    properties: packRecords("player_property"),
    timed: packRecords("player_timed"),
    shapes: packRecords("shape"),
    bodies: packRecords("body"),
    history: packRecords("history"),
    realms: packRecords("realm"),
  } as PlayerPackRecords);

  /* The same two lookups the real host performs -- registry.bodies[race.body]
   * and registry.historyChart(race) -- rather than an approximation of them.
   * A first draft reached for a `race.history` field that does not exist, which
   * threw inside the race screen and never got near the sheet at all. */
  const realDeps: BirthDeps = {
    bodyFor: (raceName) => {
      const race = players.races.find((r) => r.name === raceName);
      return race ? (players.bodies[race.body] ?? null) : null;
    },
    historyChartFor: (raceName) => {
      const race = players.races.find((r) => r.name === raceName);
      return race ? players.historyChart(race) : null;
    },
    properties: packRecords("player_property"),
    elementNames: [],
  };

  it("draws the point-based stat table and panels without throwing", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, players.races, players.classes, {
      rng: new Rng(1),
      deps: realDeps,
    });
    await tick();
    press(win, "a"); await tick(); // first race
    press(win, "a"); await tick(); // first class
    press(win, "a"); await tick(); // Point-based -> the screen that draws the sheet

    /* The stat table is the preview's own output: reaching it at all means
     * charSheetDeps / statTable / characterPanels all ran on previewState. */
    const screen = term.snapshot().join("\n");
    expect(screen).toContain("Total Cost");
    /* And the panels really rendered, rather than the compact no-deps fallback
     * that silently replaces them when buildPreview returns null. */
    expect(screen).toMatch(/Age|Height|Weight/u);

    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    press(win, "Escape"); await tick();
    void done;
  });
});

/**
 * #253: THE BIRTH SCREENS DECLARE A RECTANGLE.
 *
 * `main-regions.test.ts` lists these four sites as regions, and a list is a
 * CLAIM. Its own guard is source text - it checks that birth.ts calls
 * `pushRegion` somewhere - which cannot tell a screen that declares itself from
 * a neighbour that does. This is the other half: the stack read through the
 * shipped path, at each stage, while the screen is actually up.
 *
 * WHAT IT BUYS, stated precisely because the overclaim is easy. Birth still
 * covers the whole terminal and still repaints itself from its own key loop, so
 * nothing underneath it is redrawn while it is open - that is what a full-screen
 * modal MEANS. What changes is that the covering is DECLARED, so `onStackChanged`
 * fires and a replacement front end stands its canvas down instead of floating it
 * over the middle of the race menu. Before this, birth was invisible to every
 * mod on the display: it erased the terminal four screens deep and published
 * nothing at all.
 */
describe("birth is a region while it is on screen (#253)", () => {
  const ids = (): string[] => liveRegionStack().map((r) => r.id);

  it("declares core:screen at every stage that erases the terminal", async () => {
    resetRegionStack();
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    expect(ids()).toEqual([]);

    const done = runBirth(term, RACES, CLASSES, { rng: new Rng(1) });
    await tick();
    /* The race menu (birthMenu). The whole terminal, in the modal band - which
     * is what a 4.2.6 screen is, and is deliberately NOT shrunk. What it lacked
     * was a rectangle at all. */
    expect(ids()).toEqual([SCREEN_REGION_ID]);
    expect(liveRegionStack()[0]).toMatchObject({
      layer: "modal",
      cells: { col: 0, row: 0, cols: 90, rows: 24 },
    });

    press(win, "a"); await tick(); // Human -> the class menu
    expect(ids()).toEqual([SCREEN_REGION_ID]);
    press(win, "a"); await tick(); // Warrior -> the roller-choice menu
    expect(ids()).toEqual([SCREEN_REGION_ID]);
    press(win, "a"); await tick(); // Point-based -> the allocation screen
    expect(ids()).toEqual([SCREEN_REGION_ID]);
    /* The name stage, which is the one that has no key loop of its own: the
     * sheet is painted by `drawBirthSheet` and the prompt outlives that paint,
     * so the region has to span both. `nameStage` exists to be that boundary. */
    press(win, "Enter"); await tick();
    expect(term.snapshot()[0]).toContain("name");
    expect(ids()).toEqual([SCREEN_REGION_ID]);

    press(win, "Enter"); await tick(); // default name -> the final confirm
    press(win, "a"); // begin
    await done;
    /* AND NOTHING IS LEFT BEHIND. A screen that pushed and never popped is a
     * phantom occluder: a front end told it is covered and never told otherwise
     * keeps its canvas down for the rest of the session, which is worse than
     * never having been told. */
    expect(ids()).toEqual([]);
  });

  it("declares one for the standard roller and for the history stage too", async () => {
    resetRegionStack();
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, {
      rng: new Rng(1),
      historyFor: () => "You are the only child of a Serf.",
    });
    await tick();
    press(win, "a"); await tick(); // Human
    press(win, "a"); await tick(); // Warrior
    press(win, "b"); await tick(); // Standard roller -> the roll screen
    expect(term.snapshot().join("\n")).toContain("'r' to reroll");
    expect(ids()).toEqual([SCREEN_REGION_ID]);

    press(win, "Enter"); await tick(); // accept the roll -> name
    press(win, "Enter"); await tick(); // default name -> the history stage
    expect(term.snapshot().join("\n")).toContain("Accept character history?");
    /* The history stage paints through a callback the CALLER owns, and a
     * callback that kept its own reference to the terminal would have gone on
     * erasing it from inside a screen that had just declared a rectangle - a
     * conversion that looks done and is not. */
    expect(ids()).toEqual([SCREEN_REGION_ID]);

    press(win, "a"); await tick(); // accept the background -> confirm
    press(win, "a");
    await done;
    expect(ids()).toEqual([]);
  });
});
