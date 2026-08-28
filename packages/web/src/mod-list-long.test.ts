/**
 * A LONG list in a menu that also shows a description pane - the mod manager with
 * more than a screenful of mods.
 *
 * Reported as "when the mod list gets long, make sure we can still scroll through
 * it while retaining visibility of the other text". Scrolling worked. What did not
 * was getting the list BACK once it had been squeezed, and the cause was a line of
 * display_scrolling that had never been ported:
 *
 *   *top = MIN(*top, n - rows_per_page);        ui-menu.c:199
 *
 * The port had only the two cursor-chasing tests, which move `top` toward the
 * cursor and never away from it. Upstream cannot notice the difference, because a
 * menu's region has a fixed page_rows for its whole life. This one is recomputed on
 * every paint from the height of the detail pane, so pressing '?' to hide the
 * description hands twenty rows to a thirty-mod list that goes on showing five,
 * with the rest of the pane blank. That is the "cannot scroll through it" half.
 *
 * The other half was the mod manager's own budget, written `Math.max(8, ...)`: a
 * floor on the PANE, sitting where a floor on the LIST was intended, and winning
 * over it on any short terminal.
 *
 * Asserted on painted rows rather than on `top`, because what a player can see is
 * the property in question and `top` is an implementation detail that could be
 * right while the paint is wrong.
 */

import { describe, expect, it, afterEach } from "vitest";
import { selectFromMenu } from "./overlay";
import type { MenuItem, ScreenLine } from "./overlay";
import { runModManager } from "./mods";
import { ModStore } from "./mod-store";
import type { CatalogMod } from "./mod-store";
import type { GlyphTerm } from "./term";

/* --- fakes (the shape overlay.test.ts uses; no jsdom in this repo) ------- */

interface FakeWindow {
  addEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const ls: Array<{ t: string; fn: (ev: Event) => void }> = [];
  return {
    addEventListener: (t, fn) => void ls.push({ t, fn }),
    removeEventListener: (t, fn) => {
      const i = ls.findIndex((l) => l.t === t && l.fn === fn);
      if (i >= 0) ls.splice(i, 1);
    },
    dispatchEvent: (ev) => {
      for (const l of [...ls].filter((x) => x.t === ev.type)) l.fn(ev);
    },
  };
}

interface FakeTerm extends GlyphTerm {
  snapshot(): string[];
}

function makeTerm(cols = 60, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    onCellTap: () => () => undefined,
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      const row = grid[y];
      if (!row) return;
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    eraseToEol: () => {},
    prt: () => {},
    setCursor: () => {},
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
  } as unknown as FakeTerm;
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/**
 * How many rows of the LIST are painted.
 *
 * Counted by the `x) ` tag prefix display_menu_row draws (ui-menu.c:577-585),
 * contiguously from BODY_TOP, rather than by matching row text: the detail pane
 * repeats the mod's id in its own first line, so a text match counts pane lines as
 * list rows and reports a squeezed list as a healthy one.
 */
function menuRowCount(term: FakeTerm): number {
  const snap = term.snapshot();
  let n = 0;
  for (let r = 2; r < snap.length; r++) {
    if (!/^\S\)\s/u.test(snap[r] ?? "")) break;
    n++;
  }
  return n;
}

/** Which `item-N` labels are on screen, in paint order. */
function itemsOnScreen(term: FakeTerm): string[] {
  return term
    .snapshot()
    .map((line) => /\bitem-(\d+)\b/u.exec(line)?.[0] ?? "")
    .filter(Boolean);
}

const ITEMS: MenuItem[] = Array.from({ length: 30 }, (_, i) => ({ label: `item-${i}` }));

function paneOf(n: number): ScreenLine[] {
  return Array.from({ length: n }, (_, i) => ({ text: `pane line ${i}`, color: "#fff" }));
}

describe("a 30-row menu under a detail pane (display_scrolling, ui-menu.c:190-200)", () => {
  it("reclaims the list when the pane is hidden and the page GROWS", () => {
    /* THE DEFECT. Sit at the end of the list with a tall pane (six list rows),
     * then hide the pane with '?'. Nineteen more rows become available, and every
     * one of them must fill with an item - the old code left `top` where the short
     * page had put it and painted five items into a twenty-row space. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    let paneRows = 15;
    void selectFromMenu(term, "Mods", ITEMS, "[ footer ]", {
      detail: () => paneOf(paneRows),
      detailToggleKey: "?",
      detailInitiallyShown: true,
    });

    press(win, "End");
    const withPane = itemsOnScreen(term);
    expect(withPane.at(-1)).toBe("item-29"); // the cursor's row is visible
    expect(withPane.length).toBeLessThan(10); // a tall pane really is squeezing it

    paneRows = 0;
    press(win, "?"); // hide the description
    const wide = itemsOnScreen(term);
    /* 24 rows - BODY_TOP(2) - footer(1) = 21 rows of list, all of them items. */
    expect(wide.length).toBe(21);
    expect(wide[0]).toBe("item-9");
    expect(wide.at(-1)).toBe("item-29");
    /* And nothing blank in between: the list is contiguous. */
    expect(wide).toEqual(Array.from({ length: 21 }, (_, i) => `item-${9 + i}`));
  });

  it("keeps one row of context below the cursor while moving down", () => {
    /* ui-menu.c:193-195 - `if (cursor >= *top + (rows_per_page - 1))` scrolls one
     * row EARLY, so the row after the cursor is on screen. The port scrolled only
     * when the cursor had already reached the last row. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 10); // BODY_TOP 2, footer 1 -> 7 list rows
    void selectFromMenu(term, "Mods", ITEMS);

    for (let i = 0; i < 6; i++) press(win, "ArrowDown"); // cursor -> item-6
    const shown = itemsOnScreen(term);
    expect(shown).toContain("item-6"); // the cursor
    expect(shown).toContain("item-7"); // ...and the row beyond it
    expect(shown[0]).toBe("item-1"); // so the top scrolled by one
  });

  it("keeps one row of context above the cursor while moving back up", () => {
    /* ui-menu.c:190-191 - `if ((cursor <= *top) && (*top > 0)) *top = cursor - 1`. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 10);
    void selectFromMenu(term, "Mods", ITEMS);

    press(win, "End"); // bottom of a 30-item list
    for (let i = 0; i < 8; i++) press(win, "ArrowUp");
    const shown = itemsOnScreen(term);
    const cursorAt = 29 - 8;
    expect(shown).toContain(`item-${cursorAt}`);
    expect(shown).toContain(`item-${cursorAt - 1}`); // the row before it, too
  });

  it("never scrolls a list that already fits (MAX(top, 0))", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    void selectFromMenu(term, "Mods", ITEMS.slice(0, 4));
    press(win, "End");
    expect(itemsOnScreen(term)).toEqual(["item-0", "item-1", "item-2", "item-3"]);
  });

  it("shows the CURSOR's row even when a pane squeezes the list to one row", () => {
    /* Port-only territory: upstream's page_rows is never 1, and at that height its
     * two context-distance lines push `top` one PAST the cursor - painting the row
     * AFTER the selected one and nothing else. A geometry the C cannot reach still
     * has to paint something true.
     *
     * `minListRows: 1` is now what ASKS for that geometry. The default reserves
     * three rows of list (see the test below), which is the fix for a mod whose
     * description left one action row on screen - but the one-row arithmetic is
     * still reachable on a short terminal, so the invariant is still worth a test. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    void selectFromMenu(term, "Mods", ITEMS, "[ footer ]", {
      minListRows: 1,
      detail: () => paneOf(40),
    });
    expect(itemsOnScreen(term)).toEqual(["item-0"]);
    press(win, "ArrowDown");
    expect(itemsOnScreen(term)).toEqual(["item-1"]);
    press(win, "End");
    expect(itemsOnScreen(term)).toEqual(["item-29"]);
  });

  it("by default a pane cannot take the list below three rows", () => {
    /* THE DEFECT, from play: linoleum's description is a paragraph, and its
     * own manager screen rendered as a title, one action row, and thirty lines of
     * prose - with no way to reach Move earlier, Move later or Back, and no way to
     * scroll the prose either. The pane is what has somewhere else to be read. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    void selectFromMenu(term, "Mods", ITEMS, "[ footer ]", { detail: () => paneOf(40) });
    expect(itemsOnScreen(term)).toEqual(["item-0", "item-1", "item-2"]);
    /* And the cut is stated, not silent - the pane's last lines are where a mod's
     * two permanent-once-on warnings live. */
    expect(term.snapshot().some((l) => l.includes("more than fits here"))).toBe(true);
  });

  it("the pane is still on screen at every scroll position", () => {
    /* The other half of the request: scrolling must not cost the description. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    void selectFromMenu(term, "Mods", ITEMS, "[ footer ]", { detail: () => paneOf(8) });
    for (const step of ["ArrowDown", "End", "Home", "PageDown"]) {
      press(win, step);
      const snap = term.snapshot();
      expect(snap.some((l) => l.includes("pane line 0")), step).toBe(true);
      expect(snap.some((l) => l.includes("pane line 7")), step).toBe(true);
      expect(snap[23], step).toContain("[ footer ]");
    }
  });
});

/**
 * The missing half of the original report (#102): scrolling worked, but
 * nothing on screen said there was more to find. "It's not clear that there
 * are more mods below the fold if you just arrow down" - the cue has to show
 * up from plain arrow-key movement, not only after a page jump proves the
 * list was clipped.
 *
 * Every row already leaves its last column untouched (a label is sliced to
 * `cols - 1 - boxCol`, a suffix to `cols - 1 - sfx.col`), so that is where the
 * cue lives - a "^" on the topmost painted row when `top > 0`, a "v" on the
 * bottommost when items remain past it. `marginChar` reads exactly that
 * column back out of the painted grid.
 */
describe("the margin scroll cue (#102)", () => {
  const COLS = 60;

  function marginChar(term: FakeTerm, row: number): string {
    return term.snapshot()[row]?.[COLS - 1] ?? "";
  }

  it("shows neither cue when the whole list fits on screen", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(COLS, 24);
    void selectFromMenu(term, "Mods", ITEMS.slice(0, 4));
    for (let row = 0; row < 24; row++) {
      expect(marginChar(term, row), `row ${String(row)}`).toBe("");
    }
  });

  it("shows only the bottom cue at the very top of a long list", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(COLS, 10); // BODY_TOP 2, footer 1 -> 7 list rows
    void selectFromMenu(term, "Mods", ITEMS); // 30 items, cursor at item-0, top 0

    expect(marginChar(term, 2), "top row").toBe(""); // top === 0, nothing above
    expect(marginChar(term, 8), "bottom row").toBe("v"); // 23 more items below
  });

  it("raises the top cue from plain ArrowDown navigation, not just a page jump", () => {
    /* Mirrors "keeps one row of context below the cursor" above: six ArrowDown
     * presses land the cursor on item-6 and scroll `top` to 1, with no Home/End/
     * PageDown involved at all. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(COLS, 10);
    void selectFromMenu(term, "Mods", ITEMS);

    for (let i = 0; i < 6; i++) press(win, "ArrowDown");
    expect(itemsOnScreen(term)[0]).toBe("item-1"); // top did scroll to 1
    expect(marginChar(term, 2), "top row").toBe("^");
    expect(marginChar(term, 8), "bottom row").toBe("v"); // still 22 more below
  });

  it("drops the bottom cue and keeps the top one at the end of the list", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(COLS, 10);
    void selectFromMenu(term, "Mods", ITEMS);

    press(win, "End");
    expect(itemsOnScreen(term).at(-1)).toBe("item-29");
    expect(marginChar(term, 2), "top row").toBe("^"); // 29 items above
    expect(marginChar(term, 8), "bottom row").toBe(""); // nothing left below
  });

  it("moves the cues with the detail pane's own resize (mod-browse's showSource shape)", () => {
    /* mod-browse.ts's showSource opens with `detailInitiallyShown: true`, which
     * is what squeezes the "Recommended mods" list in the first place - so the
     * cue has to track a body height that is recomputed every paint, not one
     * fixed at open time. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(COLS, 24);
    void selectFromMenu(term, "Mods", ITEMS, "[ footer ]", {
      detail: () => paneOf(40),
      detailToggleKey: "?",
      detailInitiallyShown: true,
    });
    // minListRows defaults to 3, so the list is exactly item-0..2, cue below.
    expect(itemsOnScreen(term)).toEqual(["item-0", "item-1", "item-2"]);
    expect(marginChar(term, 2), "top row, squeezed").toBe("");
    expect(marginChar(term, 4), "bottom row, squeezed").toBe("v");

    press(win, "?"); // hide the description; the list widens
    expect(marginChar(term, 2), "top row, widened").toBe("");
    expect(marginChar(term, 22), "bottom row, widened").toBe("v"); // 30 items, 21 rows shown
  });
});

/* --- and the real screen, with a real catalogue ------------------------- */

function catalogOf(n: number): CatalogMod[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    name: `Mod number ${i}`,
    version: "1.0.0",
    shape: "content" as const,
    kind: "content" as const,
    enabled: false,
    capabilities: [],
    nondeterministic: false,
    affectsGameplay: false,
    consented: true,
    manifest: {
      id: `item-${i}`,
      name: `Mod number ${i}`,
      version: "1.0.0",
      shape: "content",
      description:
        "A description long enough to wrap several times over on a narrow pane, " +
        "so the budget that decides how much of it fits is actually exercised " +
        "rather than trivially satisfied by a one-line blurb.",
    } as CatalogMod["manifest"],
  }));
}

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function openManager(term: FakeTerm, mods: CatalogMod[]): Promise<void> {
  return runModManager(term, {
    store: new ModStore(fakeStorage()),
    listCatalog: () => mods,
    conflictLines: () => ({
      declared: [],
      contested: [],
      combined: [],
      declaredRows: [],
      contestedRows: [],
      combinedRows: [],
    }),
    requestReload: () => {},
  });
}

describe("the mod manager itself, with 30 mods", () => {
  it("keeps five rows of the list on a 14-row terminal", async () => {
    /* The budget was `Math.max(8, rows - 4 - min(items, 5))`. At 14 rows that is
     * 8 - the floor on the pane beating the floor on the list next to it - and
     * the thirty-mod list was painted TWO rows deep. Whichever has to give here
     * it is not the list: opening a mod shows all of its text anyway. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 14);
    const done = openManager(term, catalogOf(30));
    await Promise.resolve();

    expect(menuRowCount(term)).toBeGreaterThanOrEqual(5);
    /* And the description is still there - the point is that BOTH fit, not that
     * the pane lost. */
    expect(term.snapshot().some((l) => l.includes("Mod number 0"))).toBe(true);
    press(win, "Escape");
    await done;
  });

  it("says where in the list the cursor is, because five of thirty rows cannot", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    const done = openManager(term, catalogOf(30));
    await Promise.resolve();

    expect(term.snapshot().some((l) => l.includes("Mod 1 of 30"))).toBe(true);
    press(win, "ArrowDown");
    press(win, "ArrowDown");
    expect(term.snapshot().some((l) => l.includes("Mod 3 of 30"))).toBe(true);
    press(win, "Escape");
    await done;
  });

  it("scrolls to the action rows past the end of a long mod list", async () => {
    /* "Done", "Profiles...", "View conflicts" are appended as rows of the same
     * list, so a long catalogue puts them off screen. End must still reach them,
     * and the last of them is Done. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(60, 24);
    const done = openManager(term, catalogOf(30));
    await Promise.resolve();

    press(win, "End");
    expect(term.snapshot().some((l) => l.includes("Done"))).toBe(true);
    press(win, "Escape");
    await done;
  });
});

