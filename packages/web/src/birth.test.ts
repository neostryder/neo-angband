/**
 * Gap #58: the staged birth flow (ui-birth.c). Verifies the faithful stage
 * order QUICKSTART -> RACE -> CLASS -> ROLLER_CHOICE -> NAME -> FINAL_CONFIRM
 * (birth_stage enum L60-74 - NO sex/gender stage in 4.2.6), ESC as BIRTH_BACK
 * (step back one stage, prior cursor restored; stage-0 ESC keeps the default
 * character), the upstream stage hints, and the recorded roller choice.
 */

import { describe, expect, it, afterEach } from "vitest";
import { runBirth } from "./birth";
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

function makeTerm(cols = 70, rows = 16): GlyphTerm & { snapshot(): string[] } {
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

const RACES = [
  { name: "Human", statAdj: [0, 0, 0, 0, 0] },
  { name: "Half-Elf", statAdj: [0, 1, -1, 1, -1] },
  { name: "Dwarf", statAdj: [2, -3, 2, -2, 2] },
];
const CLASSES = [
  { name: "Warrior", statAdj: [3, -2, -2, 2, 2] },
  { name: "Mage", statAdj: [-3, 3, 0, 1, -2] },
];

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("runBirth: faithful stage order (no sex stage)", () => {
  it("race -> class -> roller -> name -> confirm yields the full choice", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(90); // wide enough for the untruncated stage hints
    const done = runBirth(term, RACES, CLASSES);
    await tick();
    expect(term.snapshot()[0]).toContain("choose a race");
    // The upstream stage hint is the subtitle.
    expect(term.snapshot()[1]).toContain("Race affects stats and skills");
    press(win, "c"); // Dwarf
    await tick();
    expect(term.snapshot()[0]).toContain("choose a class");
    expect(term.snapshot()[1]).toContain("Class affects stats");
    press(win, "b"); // Mage
    await tick();
    expect(term.snapshot()[0]).toContain("choose a stat roller");
    expect(term.snapshot()[1]).toContain("Point-based is recommended");
    expect(term.snapshot().join("\n")).toContain("Standard roller");
    press(win, "b"); // Standard roller
    await tick();
    expect(term.snapshot()[0]).toContain("name");
    for (const ch of "Durin") press(win, ch);
    press(win, "Enter");
    await tick();
    // FINAL_CONFIRM: an explicit accept step.
    expect(term.snapshot()[0]).toContain("Durin the Dwarf Mage");
    press(win, "a"); // Begin the adventure
    expect(await done).toEqual({
      raceName: "Dwarf",
      className: "Mage",
      name: "Durin",
      roller: "roller",
    });
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
    await tick(); record();
    press(win, "a"); await tick(); record();
    press(win, "a"); await tick(); record();
    press(win, "a"); await tick(); record();
    press(win, "Enter"); await tick(); record();
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
  });

  it("ESC on the class stage steps BACK to race with the prior cursor", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES);
    await tick();
    press(win, "b"); // pick Half-Elf
    await tick();
    expect(term.snapshot()[0]).toContain("choose a class");
    press(win, "Escape"); // BIRTH_BACK
    await tick();
    expect(term.snapshot()[0]).toContain("choose a race");
    // The cursor re-enters on the previously chosen race.
    expect(term.snapshot().join("\n")).toContain(">b) Half-Elf");
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
    press(win, "a"); await tick();
    press(win, "a"); await tick();
    press(win, "a"); await tick();
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
    expect(term.snapshot()[0]).toContain("choose a race");
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
    expect(term.snapshot()[0]).toContain("choose a race");
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

describe("runBirth: per-row race/class stat detail (race_help/class_help)", () => {
  it("shows the highlighted race's stat adjustments and updates on move", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runBirth(term, RACES, CLASSES);
    await tick();
    expect(term.snapshot().join("\n")).toContain("STR +0");
    press(win, "ArrowDown"); // Half-Elf
    expect(term.snapshot().join("\n")).toContain("INT +1");
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});
