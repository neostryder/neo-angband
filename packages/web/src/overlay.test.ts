import { describe, expect, it, afterEach } from "vitest";
import {
  showLevelMap,
  selectFromMenu,
  itemSelect,
  showTextScreen,
  promptNumber,
} from "./overlay";
import type { MenuItem, ItemMenuSource, ScreenLine } from "./overlay";
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

// --- selectFromMenu: tap-to-select + the S-tier opts (gap #58) -------------
// GlyphTerm.onCellTap is the new term seam: a modal registers a handler on
// open and clears it on resolve. The fake term here mimics that surface so
// the overlay's tap logic is tested without a canvas.
interface TapTerm extends GlyphTerm {
  snapshot(): string[];
  /** Simulate a tap that GlyphTerm would deliver for a canvas pointerdown. */
  fireTap(col: number, row: number): void;
  /** True while a modal has a registered tap handler. */
  hasTapHandler(): boolean;
}

function makeTapTerm(cols = 40, rows = 12): TapTerm {
  const base = makeTerm(cols, rows) as unknown as Record<string, unknown>;
  let tapCb: ((cell: { col: number; row: number }) => void) | null = null;
  base["onCellTap"] = (cb: typeof tapCb): void => {
    tapCb = cb;
  };
  base["fireTap"] = (col: number, row: number): void => {
    tapCb?.({ col, row });
  };
  base["hasTapHandler"] = (): boolean => tapCb !== null;
  return base as unknown as TapTerm;
}

const BODY_TOP = 2; // overlay.ts's list top row

describe("selectFromMenu: tap-to-select (gap #58 shared touch seam)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function items(): MenuItem[] {
    return [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }];
  }

  it("first tap on a row highlights it; a second tap selects it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTapTerm();
    const done = selectFromMenu(term, "Menu", items());
    term.fireTap(3, BODY_TOP + 1); // row of "Beta": highlight only
    expect(term.snapshot()[BODY_TOP + 1]).toContain(">b) Beta");
    let resolved: number | null | undefined;
    void done.then((v) => {
      resolved = v;
    });
    await tick();
    expect(resolved).toBeUndefined(); // still open after the first tap
    term.fireTap(3, BODY_TOP + 1); // tap the highlighted row: select
    expect(await done).toBe(1);
  });

  it("a tap on the footer row cancels like ESC", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTapTerm(40, 12);
    const done = selectFromMenu(term, "Menu", items());
    term.fireTap(0, 11); // rows-1 = the footer row
    expect(await done).toBeNull();
  });

  it("a tap on a disabled row neither highlights nor selects", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTapTerm();
    const list: MenuItem[] = [{ label: "Ok" }, { label: "No", disabled: true }];
    const done = selectFromMenu(term, "Menu", list);
    term.fireTap(3, BODY_TOP + 1);
    term.fireTap(3, BODY_TOP + 1); // even a double tap on a disabled row
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("tears the tap handler down on resolve (no leak into the game)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTapTerm();
    const done = selectFromMenu(term, "Menu", items());
    expect(term.hasTapHandler()).toBe(true);
    press(win, "a");
    await done;
    expect(term.hasTapHandler()).toBe(false);
    expect(() => term.fireTap(0, BODY_TOP)).not.toThrow();
  });

  it("keyboard-only callers on a term WITHOUT onCellTap still work (regression)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(); // the plain fake: no onCellTap at all
    const done = selectFromMenu(term, "Menu", items());
    press(win, "b");
    expect(await done).toBe(1);
  });
});

describe("selectFromMenu: subtitle / hint / initialCursor / onHighlight / footer", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("renders the subtitle on the row under the title", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Choose a race", [{ label: "Human" }], undefined, {
      subtitle: "Race affects stats and skills.",
    });
    expect(term.snapshot()[1]).toBe("Race affects stats and skills.");
  });

  it("shows the highlighted row's hint above the footer and tracks the cursor", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Menu", [
      { label: "First", hint: "hint one" },
      { label: "Second", hint: "hint two" },
    ]);
    expect(term.snapshot()[10]).toBe("hint one"); // rows-2
    press(win, "ArrowDown");
    expect(term.snapshot()[10]).toBe("hint two");
  });

  it("initialCursor starts the cursor on that row; onHighlight reports moves", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    const seen: number[] = [];
    const done = selectFromMenu(
      term,
      "Menu",
      [{ label: "A" }, { label: "B" }, { label: "C" }],
      undefined,
      { initialCursor: 2, onHighlight: (i) => seen.push(i) },
    );
    expect(term.snapshot()[BODY_TOP + 2]).toContain(">c) C");
    press(win, "ArrowUp");
    press(win, "Enter");
    expect(await done).toBe(1);
    expect(seen).toEqual([2, 1]);
  });

  it("opts.footer overrides the positional footer", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 12);
    void selectFromMenu(term, "Menu", [{ label: "A" }], "[ positional ]", {
      footer: "[ from opts ]",
    });
    expect(term.snapshot()[11]).toBe("[ from opts ]");
  });
});

// --- menuNav numpad navigation + the store command-key layer ---------------
// The reference drives every menu cursor through target_dir_allow
// (ui-target.c:99-108): keypad digits and arrows are interchangeable, and for a
// vertical list keypad 7/8/9 move up, 1/2/3 down. event.key is the DIGIT when
// NumLock is on (the default), so a menu that only read Arrow* names was dead to
// the numpad - the "controls dead in menus" bug. The command layer is the store
// screen's p/g buy, s/d sell keys (ui-store.c:1097-1120) laid over selection.
describe("selectFromMenu: numpad navigation + command keys", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("numpad digits 8/2 move the cursor like ArrowUp/ArrowDown (NumLock-on)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(40, 12);
    const done = selectFromMenu(term, "Menu", [{ label: "A" }, { label: "B" }, { label: "C" }]);
    press(win, "2"); // numpad down -> B
    press(win, "2"); // -> C
    press(win, "8"); // numpad up -> B
    press(win, "Enter");
    expect(await done).toBe(1);
  });

  it("numpad 7/9 count as up and 1/3 as down (ddy-only, like the reference)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(40, 12);
    const done = selectFromMenu(term, "Menu", [{ label: "A" }, { label: "B" }, { label: "C" }]);
    press(win, "3"); // down-ish -> B
    press(win, "3"); // -> C
    press(win, "7"); // up-ish -> B
    press(win, "Enter");
    expect(await done).toBe(1);
  });

  it("a command key runs its handler and picks the returned row index", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(40, 12);
    // Mirrors the store: 's' sells (the last row), 'g' buys the highlighted row.
    const done = selectFromMenu(
      term,
      "Store",
      [{ label: "Sword" }, { label: "Shield" }, { label: "Sell..." }],
      undefined,
      { commands: { s: () => 2, g: (c) => c } },
    );
    press(win, "s");
    expect(await done).toBe(2);
  });

  it("a command key takes precedence over the same key's positional selection", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(40, 12);
    // 'b' is positionally row 1, but as a command it buys the cursor row (0).
    const done = selectFromMenu(term, "Menu", [{ label: "A" }, { label: "B" }], undefined, {
      commands: { b: (c) => c },
    });
    press(win, "b");
    expect(await done).toBe(0);
  });

  it("a command returning null consumes the key without resolving the menu", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(40, 12);
    const done = selectFromMenu(term, "Menu", [{ label: "A" }, { label: "B" }], undefined, {
      commands: { x: () => null },
    });
    let resolved: number | null | undefined;
    void done.then((v) => {
      resolved = v;
    });
    press(win, "x");
    await tick();
    expect(resolved).toBeUndefined(); // still open
    press(win, "Escape");
    expect(await done).toBeNull();
  });
});

describe("showTextScreen: numpad scrolling (menuNav)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("numpad 2/8 scroll the list like ArrowDown/ArrowUp", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(40, 12) as GlyphTerm & { snapshot(): string[] };
    void showTextScreen(term, "Long", Array.from({ length: 40 }, (_, i) => ({ text: `line ${i}` })));
    expect(term.snapshot()[BODY_TOP]).toBe("line 0");
    press(win, "2"); // numpad down
    expect(term.snapshot()[BODY_TOP]).toBe("line 1");
    press(win, "8"); // numpad up
    expect(term.snapshot()[BODY_TOP]).toBe("line 0");
  });
});

describe("showTextScreen: tap support (gap #58)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function longLines(n: number): ScreenLine[] {
    return Array.from({ length: n }, (_, i) => ({ text: `line ${i}` }));
  }

  it("taps scroll a scrolling screen (lower half down, upper half up)", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTapTerm(40, 12);
    void showTextScreen(term, "Long", longLines(40));
    expect(term.snapshot()[BODY_TOP]).toBe("line 0");
    term.fireTap(0, 10); // lower half: page down
    expect(term.snapshot()[BODY_TOP]).not.toBe("line 0");
    term.fireTap(0, 3); // upper half: page back up
    expect(term.snapshot()[BODY_TOP]).toBe("line 0");
  });

  it("a footer tap closes; a non-scrolling screen closes on any tap", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const scroller = makeTapTerm(40, 12);
    const doneA = showTextScreen(scroller, "Long", longLines(40));
    scroller.fireTap(0, 11); // footer row
    await doneA;
    expect(scroller.hasTapHandler()).toBe(false);

    const short = makeTapTerm(40, 12);
    const doneB = showTextScreen(short, "Short", longLines(2));
    short.fireTap(5, BODY_TOP); // body tap, nothing to scroll: close
    await doneB;
    expect(short.hasTapHandler()).toBe(false);
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

describe("itemSelect (get_item picker: menu_header + source switching)", () => {
  const inven: ItemMenuSource = {
    label: "Inven",
    items: [
      { label: "a Potion of Cure Light Wounds", tag: "a" },
      { label: "a Scroll of Phase Door", tag: "b" },
    ],
  };
  const equip: ItemMenuSource = {
    label: "Equip",
    items: [{ label: "a Long Sword", tag: "a" }],
  };
  const floor: ItemMenuSource = {
    label: "Floor",
    items: [{ label: "a Wooden Torch", tag: "a" }],
  };

  it("shows the prompt and the '(Inven: a-b, / for Equip, - for floor, ESC)' header", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(70);
    const done = itemSelect(term, "Quaff which item?", [inven, equip, floor]);
    const head = term.snapshot()[0] ?? "";
    expect(head).toContain("Quaff which item?");
    expect(head).toContain("(Inven: a-b, / for Equip, - for floor, ESC)");
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("selects by tag letter, resolving {source, index} into the original list", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(70);
    const done = itemSelect(term, "Quaff which item?", [inven, equip, floor]);
    press(win, "b"); // the Phase Door scroll
    expect(await done).toEqual({ source: 0, index: 1 });
  });

  it("switches to Equip with '/' (header becomes 'Equip: ... / for Inven')", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(70);
    const done = itemSelect(term, "Wield which item?", [inven, equip, floor]);
    press(win, "/"); // USE_INVEN -> USE_EQUIP
    const head = term.snapshot()[0] ?? "";
    expect(head).toContain("(Equip: a-a, / for Inven, - for floor, ESC)");
    press(win, "a"); // the Long Sword, now in the Equip source
    expect(await done).toEqual({ source: 1, index: 0 });
  });

  it("switches to the floor with '-' and back, and ESC cancels", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(70);
    const done = itemSelect(term, "Get which item?", [inven, floor]);
    press(win, "-"); // -> USE_FLOOR
    expect(term.snapshot()[0] ?? "").toContain("(Floor: a-a, / for Inven, ESC)");
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("opens on the first non-empty source when the initial one is empty", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(70);
    const empty: ItemMenuSource = { label: "Inven", items: [] };
    const done = itemSelect(term, "Take off which item?", [empty, equip], 0);
    expect(term.snapshot()[0] ?? "").toContain("(Equip: a-a,");
    press(win, "a");
    expect(await done).toEqual({ source: 1, index: 0 });
  });
});
