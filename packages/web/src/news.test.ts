import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colorToCss,
  colorTextToAttr,
  COLOUR_RED,
  COLOUR_MUD,
  COLOUR_WHITE,
  COLOUR_L_WHITE,
} from "@neo-angband/core";
import {
  parseNewsLine,
  showTitleScreen,
  titleKeyChoice,
  titleRows,
  titleRowSpans,
} from "./news";

describe("news title screen markup (news.txt {colour}...{/})", () => {
  it("colours bare text (outside any tag) COLOUR_WHITE", () => {
    expect(parseNewsLine("For help press '?' in-game")).toEqual([
      { text: "For help press '?' in-game", css: colorToCss(COLOUR_WHITE) },
    ]);
  });

  it("resolves a single {name}...{/} span by colour name", () => {
    expect(parseNewsLine("{red}Angband{/}")).toEqual([
      { text: "Angband", css: colorToCss(COLOUR_RED) },
    ]);
    expect(colorTextToAttr("red")).toBe(COLOUR_RED);
  });

  it("splits multiple spans on one line and returns to white after {/}", () => {
    expect(parseNewsLine("{mud}^^^{/}{red}_{/}  x")).toEqual([
      { text: "^^^", css: colorToCss(COLOUR_MUD) },
      { text: "_", css: colorToCss(COLOUR_RED) },
      { text: "  x", css: colorToCss(COLOUR_WHITE) },
    ]);
  });

  it("resolves the multi-word 'light slate' name used by the quote lines", () => {
    // news.txt draws the quote / website / forums in {light slate} = Light Slate.
    expect(parseNewsLine("{light slate}Website{/}")).toEqual([
      { text: "Website", css: colorToCss(COLOUR_L_WHITE) },
    ]);
    expect(colorTextToAttr("light slate")).toBe(COLOUR_L_WHITE);
  });

  it("preserves leading spaces (the art's baked-in centring)", () => {
    const runs = parseNewsLine("{mud}   ^   {/}");
    expect(runs).toEqual([{ text: "   ^   ", css: colorToCss(COLOUR_MUD) }]);
  });
});

/**
 * The title screen's keys are main-win.c's File menu (win/angband.rc:8-13),
 * because the splash itself takes no keys at all - it paints news.txt and waits
 * on that menu (main-win.c:5475). The screen it replaced advanced on ANY key,
 * including a bare Shift, and on a click anywhere.
 */
describe("title screen keys (main-win.c File menu)", () => {
  const ALL = { canLoad: true, canOpen: true, canQuit: true };

  it("offers New / Open / Load / Quit in the File menu's order", () => {
    expect(titleRows(ALL).map((r) => r.choice)).toEqual(["new", "open", "load", "quit"]);
    expect(titleRows(ALL).map((r) => r.key)).toEqual(["n", "o", "l", "q"]);
  });

  it("maps each row's letter, in either case", () => {
    for (const [key, want] of [["n", "new"], ["o", "open"], ["l", "load"], ["q", "quit"]] as const) {
      expect(titleKeyChoice(key, titleRows(ALL), false)).toBe(want);
      expect(titleKeyChoice(key.toUpperCase(), titleRows(ALL), false)).toBe(want);
    }
  });

  // main-win.c:4453-4455: KTRL('N') is New, KTRL('O') is Open, KTRL('X') is Exit.
  it("honours upstream's Ctrl accelerators, and Ctrl-X is Quit not 'x'", () => {
    expect(titleKeyChoice("n", titleRows(ALL), true)).toBe("new");
    expect(titleKeyChoice("o", titleRows(ALL), true)).toBe("open");
    expect(titleKeyChoice("x", titleRows(ALL), true)).toBe("quit");
    /* Bare 'x' is not a row. */
    expect(titleKeyChoice("x", titleRows(ALL), false)).toBeNull();
    /* Ctrl-L is not an upstream accelerator, so it is not one here. */
    expect(titleKeyChoice("l", titleRows(ALL), true)).toBeNull();
  });

  // The reported bug: "Even pressing a modifier key on the title screen advances
  // it to character selection."
  it("ignores modifier-only presses", () => {
    for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]) {
      expect(titleKeyChoice(key, titleRows(ALL), false)).toBeNull();
    }
  });

  it("ignores every other key, including Enter, Space and Escape", () => {
    for (const key of ["Enter", " ", "Escape", "a", "z", "F1", "ArrowDown"]) {
      expect(titleKeyChoice(key, titleRows(ALL), false)).toBeNull();
    }
  });

  // EnableMenuItem greys rows that do not apply (main-win.c:2957-2990); a greyed
  // item does nothing when picked.
  it("a disabled row is inert, by key and by accelerator", () => {
    const none = titleRows({ canLoad: false, canOpen: false, canQuit: false });
    expect(none.filter((r) => r.enabled).map((r) => r.choice)).toEqual(["new"]);
    expect(titleKeyChoice("l", none, false)).toBeNull();
    expect(titleKeyChoice("o", none, false)).toBeNull();
    expect(titleKeyChoice("q", none, false)).toBeNull();
    expect(titleKeyChoice("o", none, true)).toBeNull();
    expect(titleKeyChoice("x", none, true)).toBeNull();
    /* New is always live at the splash (main-win.c:2973). */
    expect(titleKeyChoice("n", none, false)).toBe("new");
  });

  it("lays the rows out centred, in order, without overlapping", () => {
    const spans = titleRowSpans(titleRows(ALL), 80);
    expect(spans.map((s) => s.row.choice)).toEqual(["new", "open", "load", "quit"]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThan(spans[i - 1]!.end);
    }
    /* Centred: the leading gap matches the trailing one within a column. */
    const lead = spans[0]!.start;
    const trail = 80 - 1 - spans[spans.length - 1]!.end;
    expect(Math.abs(lead - trail)).toBeLessThanOrEqual(1);
    /* Every span is a real label's worth of columns. */
    for (const s of spans) expect(s.end - s.start + 1).toBe(s.row.label.length);
  });
});

/**
 * The "Neo" overlay must match news.txt's own art (reported from the running
 * title screen: "the 'Neo' ... is currently one row shorter vertically and the
 * letters look squashed").
 *
 * Two independent facts have to hold, and the bug was a violation of the first:
 *
 * 1. FONT / HEIGHT. news.txt's "Angband" is figlet **standard**, whose capitals
 *    are five rows: the red block spans reference/lib/screens/news.txt rows 6-10
 *    (row 11 is only the 'g' descender, red columns 30-34, which is why the rule
 *    below keys off the capital's own left edge). The overlay was figlet **small**
 *    - four rows - so it stood a row short of its neighbour in a different family.
 * 2. CLEARANCE. The overlay is painted on top of the mountains with print(), which
 *    writes its SPACES too, so every column it touches is a column it destroys.
 *    Two of its rows clear the centre peak by exactly ONE column, so this is a
 *    real constraint and not a formality.
 *
 * Both are asserted against the reference file itself rather than against news.ts's
 * private NEWS copy, which also pins that copy as verbatim.
 */
describe("the 'Neo' overlay against news.txt (reference/lib/screens/news.txt)", () => {
  const NEWS_TXT = readFileSync(
    new URL("../../../reference/lib/screens/news.txt", import.meta.url),
    "utf8",
  ).split(/\r?\n/);

  /** Drop the {colour} markup: a tag occupies NO columns (parseNewsLine). */
  const strip = (s: string): string => s.replace(/\{[^}]*\}/gu, "");

  /** Per-row colour+glyph, resolved the way showTitleScreen paints it. */
  function renderTitle(): { ch: string; fg: string }[][] {
    const cols = 80;
    const rows = 24;
    const grid: { ch: string; fg: string }[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ ch: " ", fg: "" })),
    );
    const term = {
      size: () => ({ cols, rows }),
      clear: () => {
        for (const row of grid) for (let x = 0; x < cols; x++) row[x] = { ch: " ", fg: "" };
      },
      print: (x: number, y: number, text: string, fg: string) => {
        for (let i = 0; i < text.length && x + i < cols; i++) {
          grid[y]![x + i] = { ch: text[i] ?? " ", fg };
        }
      },
      prt: () => undefined,
      onCellTap: () => undefined,
      setCursor: () => undefined,
    };
    const listeners: ((ev: Event) => void)[] = [];
    (globalThis as { window?: unknown }).window = {
      addEventListener: (_t: string, fn: (ev: Event) => void) => listeners.push(fn),
      removeEventListener: () => undefined,
    };
    try {
      void showTitleScreen(term as unknown as Parameters<typeof showTitleScreen>[0], {
        canLoad: true,
        canOpen: true,
        canQuit: true,
      });
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
    return grid;
  }

  const RED = colorToCss(COLOUR_RED);

  it("paints over NO mountain caret, counting the art's spaces too", () => {
    /* print() writes spaces, so an art blank erases the '^' underneath just as a
     * glyph would. Every '^' in the file must survive to the rendered grid. */
    const grid = renderTitle();
    const survived: string[] = [];
    for (let y = 0; y < 24; y++) {
      const t = strip(NEWS_TXT[y] ?? "");
      for (let x = 0; x < t.length && x < 80; x++) {
        if (t[x] === "^" && grid[y]![x]!.ch !== "^") survived.push(`row ${y} col ${x}`);
      }
    }
    expect(survived, `the 'Neo' overlay erased mountain cells: ${survived.join("; ")}`).toEqual([]);
  });

  it("clears the centre peak by exactly ONE column on two rows", () => {
    /* The fact a future edit breaks silently: art rows 3 and 4 end at columns 36
     * and 35, and the peak's first caret on those news rows is at 37 and 36. Widen
     * the art, or move NEO_COL right, and it collides. */
    const grid = renderTitle();
    const tight: { row: number; lastArtCol: number; firstCaret: number }[] = [];
    for (const y of [3, 4]) {
      const t = strip(NEWS_TXT[y] ?? "");
      let lastArtCol = -1;
      for (let x = 0; x < 80; x++) {
        /* A red cell on a mountain row can only be the overlay: news.txt itself
         * has no red before row 6. */
        if (grid[y]![x]!.fg === RED) lastArtCol = x;
      }
      let firstCaret = -1;
      for (let x = lastArtCol + 1; x < t.length; x++) {
        if (t[x] === "^") {
          firstCaret = x;
          break;
        }
      }
      tight.push({ row: y, lastArtCol, firstCaret });
    }
    expect(tight).toEqual([
      { row: 3, lastArtCol: 36, firstCaret: 37 },
      { row: 4, lastArtCol: 35, firstCaret: 36 },
    ]);
  });

  it("is the same cap height as news.txt's own 'Angband' capital", () => {
    /* The capital A's five rows are the consecutive red rows that reach the red
     * block's LEFT EDGE (columns 15-19 as the diagonal walks out); the 'g'
     * descender row starts at column 30 and is not part of the cap height. */
    let capRows = 0;
    for (let y = 0; y < NEWS_TXT.length; y++) {
      const line = NEWS_TXT[y] ?? "";
      /* Red columns on this row, markup skipped. */
      const re = /\{([^}]*)\}/gu;
      let last = 0;
      let cur = "white";
      let col = 0;
      let minRed = Infinity;
      let m: RegExpExecArray | null;
      const emit = (text: string): void => {
        for (const ch of text) {
          if (cur === "red" && ch !== " ") minRed = Math.min(minRed, col);
          col++;
        }
      };
      while ((m = re.exec(line)) !== null) {
        emit(line.slice(last, m.index));
        cur = m[1] === "/" ? "white" : (m[1] ?? "");
        last = re.lastIndex;
      }
      emit(line.slice(last));
      if (minRed <= 19) capRows++;
      else if (capRows > 0) break; // past the capital
    }
    expect(capRows).toBe(5);

    /* The overlay's own height, read off the grid: consecutive rows from 0 that
     * carry red cells. Four here was the reported bug. */
    const grid = renderTitle();
    let artRows = 0;
    for (let y = 0; y < 24; y++) {
      if (grid[y]!.some((c) => c.fg === RED)) artRows++;
      else break;
    }
    expect(artRows).toBe(capRows);
  });

  it("still starts at row 0 (row 1 collides once the art is five rows tall)", () => {
    const grid = renderTitle();
    expect(grid[0]!.some((c) => c.fg === RED)).toBe(true);
  });
});
