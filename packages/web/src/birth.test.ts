/**
 * Gap #58: the staged birth flow (ui-birth.c). Verifies the faithful stage
 * order QUICKSTART -> RACE -> CLASS -> ROLLER_CHOICE -> NAME -> FINAL_CONFIRM
 * (birth_stage enum L60-74 - NO sex/gender stage in 4.2.6), ESC as BIRTH_BACK
 * (step back one stage, prior cursor restored; stage-0 ESC keeps the default
 * character), and the faithful multi-column menu appearance: all_letters_nohjkl
 * row tags (h/j/k/l skipped), no invented Random/Finish rows, the light-blue
 * instruction header, the yellow stage hint, and the Self/RB/CB/EB/Best stat
 * tables with the "Total Cost:" line and the exact upstream prompts.
 */

import { describe, expect, it, afterEach } from "vitest";
import { runBirth } from "./birth";
import type { GlyphTerm } from "./term";
import type { PlayerClass, PlayerRace } from "@neo-angband/core";
import {
  colorToCss,
  COLOUR_L_BLUE,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "@neo-angband/core";

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
}

function makeTerm(cols = 70, rows = 24): TestTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const colors: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(""));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
      for (const row of colors) row.fill("");
    },
    print: (x: number, y: number, text: string, fg?: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        const crow = colors[y];
        if (row) row[x + i] = text[i] ?? " ";
        if (crow) crow[x + i] = fg ?? "";
      }
    },
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
    colorAt: (x: number, y: number) => colors[y]?.[x] ?? "",
  } as unknown as TestTerm;
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
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
});

describe("runBirth: faithful stage order (no sex stage)", () => {
  it("race -> class -> roller -> name -> confirm yields the full choice", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
    press(win, "Escape"); // stage 0: abandon, keep the default
    expect(await done).toBeNull();
  });

  it("ESC on the race stage (stage 0) keeps the default character (null)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES);
    await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("confirm's 'Go back' returns to the name prompt", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES);
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
});

describe("runBirth: faithful menu appearance (ui-birth.c menus)", () => {
  it("tags race rows from all_letters_nohjkl, skipping h/j/k/l", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90, 24);
    const done = runBirth(term, RACES11, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
});

describe("runBirth: point-based allocation stage (BIRTH_POINTBASED)", () => {
  it("buys stats, reports the choice, and takes the leftover-point gold path", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90); // wide enough for the untruncated centered prompt
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
});

describe("runBirth: quickstart stage (quickstart_allowed)", () => {
  const QUICK = { quickstart: { raceName: "Dwarf", className: "Mage" } };

  it("offers quickstart first and jumps straight to naming on accept", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, QUICK);
    await tick();
    expect(term.snapshot().join("\n")).toContain("Quick-start");
    press(win, "a"); // use the previous character
    await tick();
    expect(term.snapshot()[0]).toContain("name");
    press(win, "Enter");
    await tick();
    press(win, "a"); // confirm
    const choice = await done;
    expect(choice!.raceName).toBe("Dwarf");
    expect(choice!.className).toBe("Mage");
  });

  it("restores the prior character's stats on quickstart (load_roller_data)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, {
      quickstart: { raceName: "Dwarf", className: "Mage", stats: [17, 10, 10, 10, 16] },
    });
    await tick();
    expect(term.snapshot().join("\n")).toContain("same stats");
    press(win, "a"); // quick-start
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

  it("ESC from the name stage steps back to quickstart, not to unseen menus", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, QUICK);
    await tick();
    press(win, "a"); // quickstart
    await tick();
    press(win, "Escape"); // back out of the name prompt
    await tick();
    expect(term.snapshot().join("\n")).toContain("Quick-start");
    press(win, "Escape"); // stage 0 ESC: keep the default
    expect(await done).toBeNull();
  });

  it("'from scratch' proceeds to the race stage", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, QUICK);
    await tick();
    press(win, "b"); // choose everything from scratch
    await tick();
    expect(term.snapshot()[7]).toContain("Race affects stats");
    press(win, "Escape"); // back to quickstart
    await tick();
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("without a prior character there is no quickstart stage", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES, { quickstart: null });
    await tick();
    expect(term.snapshot().join("\n")).not.toContain("Quick-start");
    expect(term.snapshot()[7]).toContain("Race affects stats");
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

describe("runBirth: standard roller screen (roller_command)", () => {
  it("reroll exposes the 'previous roll' option, prev swaps it back", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
});

describe("runBirth: history-edit stage (get_history_command)", () => {
  it("accepts the supplied background and rides it as `history`", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90);
    const done = runBirth(term, RACES, CLASSES, {
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
    const done = runBirth(term, RACES, CLASSES);
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
    const done = runBirth(term, RACES, CLASSES);
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
