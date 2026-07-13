import { describe, expect, it, afterEach } from "vitest";
import { showLevelMap, selectFromMenu, promptNumber } from "./overlay";
import type { MenuItem } from "./overlay";
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

// --- selectFromMenu's MenuItem.tag (stable/upstream letters) ---------------
// Added for the options-settings-screen gap (t2verify divergences #1/#2/#4):
// do_cmd_options' option_actions[] tags rows with STABLE, non-contiguous
// letters (a, b, i, d, h, ...) rather than their row position, and sets
// MN_CASELESS_TAGS so either case of the tag selects the row. MenuItem.tag
// lets a caller opt into that without disturbing any untagged menu (every
// other caller in this codebase), which the last test here guards.
describe("selectFromMenu: MenuItem.tag (upstream-stable, case-insensitive)", () => {
  function items(): MenuItem[] {
    return [
      { label: "User interface options", tag: "a" },
      { label: "Birth (difficulty) options", tag: "b" },
      { label: "Item ignoring setup", tag: "i" },
      { label: "Set base delay factor", tag: "d" },
      { label: "Set hitpoint warning", tag: "h" },
    ];
  }

  it("renders the tag as the row's letter, not its position", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Options Menu", items());
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("h) Set hitpoint warning");
    expect(snap).toContain("d) Set base delay factor");
    // No double-lettering: the label itself carries no parenthesized letter.
    expect(snap).not.toContain("h) (h)");
  });

  it("selects by the exact-case tag", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = selectFromMenu(term, "Options Menu", items());
    press(win, "h");
    expect(await done).toBe(4); // "Set hitpoint warning"
  });

  it("MN_CASELESS_TAGS: the uppercase tag also selects the row", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = selectFromMenu(term, "Options Menu", items());
    press(win, "D");
    expect(await done).toBe(3); // "Set base delay factor"
  });

  it("a tag does not collide with the untagged positional a..z fallback", async () => {
    // Untagged menus (every other caller) are unaffected: no item has a
    // .tag, so the exact-case LETTERS[idx] behaviour from before this gap
    // still applies verbatim.
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const untagged: MenuItem[] = [{ label: "First" }, { label: "Second" }];
    const done = selectFromMenu(term, "Untagged", untagged);
    press(win, "b");
    expect(await done).toBe(1); // positional: b) Second
  });
});

// --- selectFromMenu's detailToggleKey ('?' spell-description toggle) ------
// spell_menu_handler's '?' toggle (ui-spell.c L127-142, spell_menu_browser
// L147-208): the detail pane only renders while toggled on, and the toggle
// key itself never selects a row or closes the menu. Plain `detail` (no
// toggleKey) must keep behaving exactly as before this gap - the curse-
// removal and ability-browser callers rely on it always being shown.
describe("selectFromMenu: detailToggleKey ('?' description toggle)", () => {
  function items(): MenuItem[] {
    return [{ label: "Alpha" }, { label: "Beta" }];
  }
  const detail = (): { text: string }[] => [{ text: "the detail line" }];

  it("plain `detail` (no toggleKey) always renders, unaffected by this gap", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Menu", items(), undefined, { detail });
    expect(term.snapshot().join("\n")).toContain("the detail line");
  });

  it("starts hidden by default and '?' reveals it without selecting a row", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    const done = selectFromMenu(term, "Menu", items(), undefined, {
      detail,
      detailToggleKey: "?",
    });
    expect(term.snapshot().join("\n")).not.toContain("the detail line");
    press(win, "?");
    expect(term.snapshot().join("\n")).toContain("the detail line");
    // The toggle key must not have picked a row or closed the menu.
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("'?' toggles back off on a second press", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Menu", items(), undefined, {
      detail,
      detailToggleKey: "?",
    });
    press(win, "?");
    expect(term.snapshot().join("\n")).toContain("the detail line");
    press(win, "?");
    expect(term.snapshot().join("\n")).not.toContain("the detail line");
  });

  it("detailInitiallyShown: true starts visible (textui_book_browse's pure-browse mode)", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Menu", items(), undefined, {
      detail,
      detailToggleKey: "?",
      detailInitiallyShown: true,
    });
    expect(term.snapshot().join("\n")).toContain("the detail line");
  });

  it("normal letter selection still works with a toggle key configured", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = selectFromMenu(term, "Menu", items(), undefined, {
      detail,
      detailToggleKey: "?",
    });
    press(win, "b");
    expect(await done).toBe(1);
  });
});

// --- promptNumber (askfor_aux_numbers / do_cmd_hp_warn / do_cmd_delay) -----
describe("promptNumber (digit-only prompt, ui-options.c askfor_aux_numbers)", () => {
  it("shows the current value, subtitle, and accepts digits then Enter", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    const done = promptNumber(term, "Command: Base Delay Factor", 40, 0, 255,
      "Current base delay factor: 40 msec");
    let snap = term.snapshot().join("\n");
    expect(snap).toContain("Current base delay factor: 40 msec");
    expect(snap).toContain("> 40_");
    press(win, "Backspace");
    press(win, "Backspace");
    press(win, "9");
    press(win, "9");
    snap = term.snapshot().join("\n");
    expect(snap).toContain("> 99_");
    press(win, "Enter");
    expect(await done).toBe(99);
  });

  it("clamps to max on Enter (do_cmd_delay's MIN(val, 255))", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = promptNumber(term, "Command: Base Delay Factor", 0, 0, 255);
    press(win, "Backspace"); // clear the prefilled "0" before typing a fresh value
    for (const d of ["9", "9", "9"]) press(win, d);
    press(win, "Enter");
    expect(await done).toBe(255); // 999 clamped down to the max
  });

  it("ignores non-digit keys and Escape cancels with null", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = promptNumber(term, "Title", 3, 0, 9);
    press(win, "x");
    press(win, "-");
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});
