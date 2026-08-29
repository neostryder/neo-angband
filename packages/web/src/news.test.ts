import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASIC_COLORS,
  colorToCss,
  colorTextToAttr,
  COLOUR_RED,
  COLOUR_MUD,
  COLOUR_WHITE,
  COLOUR_L_WHITE,
} from "@rpgm-tools/neo-angband-core";
import { ENGINE_VERSION, PARITY_BASELINE } from "@rpgm-tools/neo-angband-core";
import {
  paintTitleArt,
  parseNewsLine,
  shimmerCss,
  showTitleScreen,
  TITLE_SHIMMER_MS,
  titleKeyChoice,
  titleLines,
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
  /* The upstream File-menu rows. `canInstall: false` keeps this block about the
   * four rows that ARE ported; the fifth is not upstream's and is covered on its
   * own below. */
  const ALL = { canLoad: true, canOpen: true, canQuit: true, canInstall: false, canUpdate: false, updateReady: false };

  it("offers Profile / New / Open / Load / Quit, Profile first", () => {
    expect(titleRows(ALL).map((r) => r.choice)).toEqual(["profile", "new", "open", "load", "quit"]);
    expect(titleRows(ALL).map((r) => r.key)).toEqual(["p", "n", "o", "l", "q"]);
  });

  it("maps each row's letter, in either case", () => {
    for (const [key, want] of [
      ["p", "profile"],
      ["n", "new"],
      ["o", "open"],
      ["l", "load"],
      ["q", "quit"],
    ] as const) {
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
    const none = titleRows({
      canLoad: false,
      canOpen: false,
      canQuit: false,
      canInstall: false,
      canUpdate: false, updateReady: false,
    });
    expect(none.filter((r) => r.enabled).map((r) => r.choice)).toEqual(["profile", "new"]);
    expect(titleKeyChoice("l", none, false)).toBeNull();
    expect(titleKeyChoice("o", none, false)).toBeNull();
    expect(titleKeyChoice("q", none, false)).toBeNull();
    expect(titleKeyChoice("o", none, true)).toBeNull();
    expect(titleKeyChoice("x", none, true)).toBeNull();
    /* New is always live at the splash (main-win.c:2973), and so is Profile -
     * it is not a File-menu row at all, so EnableMenuItem never greys it. */
    expect(titleKeyChoice("n", none, false)).toBe("new");
    expect(titleKeyChoice("p", none, false)).toBe("profile");
  });

  it("lays the rows out centred, in order, without overlapping", () => {
    const spans = titleRowSpans(titleRows(ALL), 80);
    expect(spans.map((s) => s.row.choice)).toEqual(["profile", "new", "open", "load", "quit"]);
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
const NEWS_TXT = readFileSync(
  new URL("../../../reference/lib/screens/news.txt", import.meta.url),
  "utf8",
).split(/\r?\n/);

/** Drop the {colour} markup: a tag occupies NO columns (parseNewsLine). */
const strip = (s: string): string => s.replace(/\{[^}]*\}/gu, "");

/**
 * Per-row colour+glyph, resolved the way showTitleScreen paints it. At module
 * scope because two suites need it: the 'Neo' overlay's clearance checks and the
 * credit block's placement checks.
 */
function renderTitle(
  over: Partial<Parameters<typeof showTitleScreen>[1]> = {},
  deps?: Parameters<typeof showTitleScreen>[2],
): { ch: string; fg: string }[][] {
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
    void showTitleScreen(
      term as unknown as Parameters<typeof showTitleScreen>[0],
      {
        canLoad: true,
        canOpen: true,
        canQuit: true,
        canInstall: false,
        canUpdate: false, updateReady: false,
        ...over,
      },
      deps,
    );
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
  return grid;
}

/** One rendered row as plain text, trailing blanks trimmed. */
const rowText = (grid: { ch: string }[][], y: number): string =>
  (grid[y] ?? [])
    .map((c) => c.ch)
    .join("")
    .replace(/\s+$/u, "");

/** A blank 80x24 grid and a term stub that draws into it. */
function gridTerm(): {
  grid: { ch: string; fg: string }[][];
  term: Parameters<typeof paintTitleArt>[0];
} {
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
  };
  return { grid, term: term as unknown as Parameters<typeof paintTitleArt>[0] };
}

/**
 * The art has to be paintable WITHOUT the two answers the menu row needs.
 *
 * Reported from play: "why do I always see a town map draw before the title
 * screen every time Neo Angband first loads". The boot sequence paints the
 * loaded character's map and then entered maybeTitle, which awaited the update
 * check and the mod check before it could paint anything at all - and the
 * terminal coalesces its paint to the end of the task, so the map model was
 * flushed at that first await and the title arrived a network round trip later.
 * The flash lasted exactly as long as the checks did.
 */
describe("the title art paints before anything is known (the town-map flash)", () => {
  it("draws the same art rows the full title screen draws", () => {
    const { grid, term } = gridTerm();
    paintTitleArt(term);
    const full = renderTitle();

    /* Pinned to STATED text as well as to each other: "these two agree" is
     * satisfied by breaking both, so name something the art must contain. */
    const art = Array.from({ length: 23 }, (_, y) => rowText(grid, y)).join("\n");
    expect(art).toContain(ENGINE_VERSION);
    expect(art).toContain("^"); // the mountains in news.txt
    for (let y = 0; y < 23; y++) {
      expect(rowText(grid, y), `art row ${String(y)}`).toBe(rowText(full, y));
    }
  });

  it("leaves the menu row empty, so no row can move under the cursor", () => {
    /* The rows still arrive together once both checks answer. A row that appears
     * under the player's cursor a moment after the screen does is how a menu
     * gets mis-clicked, so the art is the only thing drawn early. */
    const { grid, term } = gridTerm();
    paintTitleArt(term);
    expect(rowText(grid, 23)).toBe("");
    expect(rowText(renderTitle(), 23)).toContain("(O)pen");
  });
});

describe("the 'Neo' overlay against news.txt (reference/lib/screens/news.txt)", () => {
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

/**
 * Whose game the title screen says this is.
 *
 * news.txt's `$VERSION` slot used to show Angband's release number, under art
 * that reads "Neo Angband" - so the screen named the wrong version of the wrong
 * program, and the port's own credit sat at the very foot of the screen where it
 * read as a footnote to Angband's links. Both moved: the port's version takes the
 * slot beside the title, its credit sits directly under the mountain scene, and
 * Angband's release is credited in grey down in the link block.
 *
 * The constraint that makes this breakable is the ROW BUDGET. Upstream's splash
 * prompt is pinned to row 23 on an 80x24 terminal (main-win.c:5476), news.txt is
 * 22 rows, and inserting the port credit makes 23 - exactly full. A second
 * inserted row would push the help line onto the prompt, which is why Angband's
 * credit takes over news.txt's blank spacer instead of being inserted.
 */
describe("title screen credits (whose version, and where)", () => {
  const SLATE = colorToCss(colorTextToAttr("slate"));

  it("shows the PORT's version in news.txt's $VERSION slot, not Angband's", () => {
    const slot = titleLines().find((l) => l.markup.includes(ENGINE_VERSION));
    expect(slot, `no line carries ${ENGINE_VERSION}`).toBeDefined();
    /* The regression this pins: the slot showing 4.2.6 under a "Neo Angband"
     * title. It must be the port's number there and nowhere near Angband's. */
    expect(strip(slot!.markup)).not.toContain(PARITY_BASELINE);
    expect(slot!.markup).not.toContain("$VERSION");
  });

  it("puts the port's credit directly under the mountain scene's ground ridge", () => {
    const lines = titleLines();
    /* The ridge is the last row with mountain carets; the credit is the next. */
    const ridge = lines.findLastIndex((l) => strip(l.markup).includes("^"));
    const credit = lines.findIndex((l) => l.markup.includes("neostryder"));
    expect(credit).toBe(ridge + 1);
    expect(lines[credit]!.centred).toBe(true);
  });

  it("credits Angband's release in grey, down in the link block", () => {
    const lines = titleLines();
    const idx = lines.findIndex((l) => l.markup.includes(PARITY_BASELINE));
    expect(idx).toBeGreaterThan(lines.findIndex((l) => l.markup.includes("rephial.org")));
    expect(lines[idx]!.markup).toContain("{slate}");
    const grid = renderTitle();
    expect(rowText(grid, idx)).toContain(`Angband ${PARITY_BASELINE}`);
    expect(grid[idx]!.find((c) => c.ch !== " ")!.fg).toBe(SLATE);
  });

  it("keeps the whole screen inside the row budget, above upstream's prompt row", () => {
    /* 23 painted rows (0-22), prompt at 23. One more line anywhere above and the
     * help row lands under the prompt - the failure this exists to catch. */
    const lines = titleLines();
    expect(lines.length).toBe(23);
    const grid = renderTitle();
    expect(rowText(grid, 22)).toContain("For help press");
    expect(rowText(grid, 23)).toContain("(N)ew");
  });

  it("moves the quote down a row rather than painting over it", () => {
    /* The insert shifts everything below the ridge; the quote must survive whole,
     * one row lower than news.txt has it. */
    const quote = NEWS_TXT.findIndex((l) => l.includes("When the world is old"));
    const grid = renderTitle();
    expect(rowText(grid, quote)).not.toContain("When the world is old");
    expect(rowText(grid, quote + 1)).toContain("When the world is old");
  });

  it("re-centres only the two lines the port adds", () => {
    /* news.txt's rows carry their centring as leading spaces; re-centring one
     * would shift it. Only the added lines, which have no padding, are centred. */
    const centred = titleLines().filter((l) => l.centred);
    expect(centred).toHaveLength(2);
    expect(centred.map((l) => strip(l.markup))).toEqual([
      "A port by neostryder / RPGM Tools",
      `Based on Angband ${PARITY_BASELINE} by the Angband developers`,
    ]);
  });
});

/*
 * The one row that is not upstream's.
 *
 * Every other title row maps to a File-menu item, and a row that does not apply
 * is GREYED because that is what EnableMenuItem does. This one has no File-menu
 * counterpart at all, so it is ABSENT under the desktop shell rather than greyed:
 * a permanent dead row there would be advertising something that is not coming.
 */
describe("the (I)nstall row", () => {
  const WEB = { canLoad: true, canOpen: true, canQuit: true, canInstall: true, canUpdate: false, updateReady: false };

  it("appears with its own key when installing is possible", () => {
    expect(titleRows(WEB).map((r) => r.choice)).toEqual([
      "profile",
      "new",
      "open",
      "load",
      "install",
      "quit",
    ]);
    expect(titleKeyChoice("i", titleRows(WEB), false)).toBe("install");
    expect(titleKeyChoice("I", titleRows(WEB), false)).toBe("install");
  });

  it("is ABSENT, not greyed, when it does not apply", () => {
    const rows = titleRows({ ...WEB, canInstall: false });
    expect(rows.map((r) => r.choice)).not.toContain("install");
    /* And 'i' then means nothing at all, rather than being a key that is
     * recognised and ignored. */
    expect(titleKeyChoice("i", rows, false)).toBeNull();
  });

  it("sits before Quit, which stays last", () => {
    /* Quit is last in main-win.c's File menu. Putting a non-File-menu row after
     * it would read as though upstream had one there. */
    expect(titleRows(WEB).at(-1)?.choice).toBe("quit");
  });

  it("has no Ctrl accelerator, because upstream has none to port", () => {
    expect(titleKeyChoice("i", titleRows(WEB), true)).toBeNull();
  });

  it("does not disturb the layout of the rows around it", () => {
    const spans = titleRowSpans(titleRows(WEB), 80);
    expect(spans.map((s) => s.row.choice)).toEqual([
      "profile",
      "new",
      "open",
      "load",
      "install",
      "quit",
    ]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThan(spans[i - 1]!.end);
    }
    expect(spans.at(-1)!.end).toBeLessThan(80);
  });
});

/**
 * The (U)pdate row: absent unless there is something to install, and shimmering
 * when there is, the way an RF_ATTR_MULTI monster does.
 */
describe("the (U)pdate row", () => {
  const READY = { canLoad: true, canOpen: true, canQuit: true, canInstall: false, canUpdate: true, updateReady: true };

  it("appears with its own key only when an update exists", () => {
    expect(titleRows(READY).map((r) => r.choice)).toEqual([
      "profile",
      "new",
      "open",
      "load",
      "update",
      "quit",
    ]);
    expect(titleKeyChoice("u", titleRows(READY), false)).toBe("update");
    expect(titleKeyChoice("U", titleRows(READY), false)).toBe("update");
  });

  it("is ABSENT, not greyed, when there is nothing to install", () => {
    /* A permanent dead "(U)pdate" says an update might arrive at any moment. */
    const rows = titleRows({ ...READY, canUpdate: false, updateReady: false });
    expect(rows.map((r) => r.choice)).not.toContain("update");
    expect(titleKeyChoice("u", rows, false)).toBeNull();
  });

  it("keeps Quit last", () => {
    expect(titleRows(READY).at(-1)?.choice).toBe("quit");
  });

  it("EVERY row still fits 80 columns with all seven present", () => {
    /* THE DEFECT THIS PREVENTS: the prompt is one line printed left to right and
     * clipped at `cols`, so an overflow eats the LAST row - (Q)uit. Nothing
     * would look broken; the screen would just stop offering a way out. Seven
     * rows (Profile always present, plus Install and Update) need more columns
     * than the old fixed three-space gap allows. */
    const all = titleRows({ ...READY, canInstall: true });
    expect(all).toHaveLength(7);
    const spans = titleRowSpans(all, 80);
    expect(spans.at(-1)!.row.choice).toBe("quit");
    expect(spans.at(-1)!.end).toBeLessThan(80);
    expect(spans[0]!.start).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeGreaterThan(spans[i - 1]!.end);
    }
  });

  it("keeps the roomy gap when the rows are few", () => {
    const spans = titleRowSpans(titleRows({ ...READY, canUpdate: false, updateReady: false }), 80);
    expect(spans[1]!.start - spans[0]!.end - 1).toBe(3);
  });

  it("has no Ctrl accelerator, because upstream has none to port", () => {
    expect(titleKeyChoice("u", titleRows(READY), true)).toBeNull();
  });
});

describe("the shimmer is a multi-hued monster's", () => {
  it("draws randint1(BASIC_COLORS - 1), so it is never COLOUR_DARK", () => {
    /* randint1 is 1-based upstream (ui-display.c L1445-1447). A row that blinked
     * to attr 0 would read as a rendering fault, not as an animation. */
    const asked: number[] = [];
    for (let i = 1; i <= 15; i++) {
      shimmerCss((n) => {
        asked.push(n);
        return i;
      });
    }
    expect(new Set(asked)).toEqual(new Set([BASIC_COLORS - 1]));
    expect(shimmerCss(() => 1)).not.toBe(shimmerCss(() => 2));
  });

  it("really paints the row, in a colour that is not the other rows'", () => {
    /* The rendered grid, not the row model: a row can exist in titleRows and
     * still never reach the screen. */
    let tick: (() => void) | null = null;
    const grid = renderTitle(
      { canUpdate: true, updateReady: true },
      {
        randint1: () => 4,
        setInterval: (fn) => {
          tick = fn;
          return 1;
        },
        clearInterval: () => undefined,
      },
    );
    const prompt = rowText(grid, 23);
    expect(prompt).toContain("(U)pdate");
    expect(prompt).toContain("(Q)uit");

    const at = prompt.indexOf("(U)pdate");
    const quitAt = prompt.indexOf("(Q)uit");
    const colourOf = (x: number): string => grid[23]?.[x]?.fg ?? "";
    expect(colourOf(at)).toBe(colorToCss(4));
    expect(colourOf(at)).not.toBe(colourOf(quitAt));

    /* And a frame later it is a different colour, which is the whole point. */
    expect(tick, "no shimmer timer was scheduled").toBeTruthy();
    (tick as unknown as () => void)();
    expect(rowText(grid, 23)).toContain("(U)pdate");
  });

  it("does not schedule a timer when there is no update to shimmer", () => {
    let scheduled = 0;
    renderTitle(
      { canUpdate: false, updateReady: false },
      {
        randint1: () => 4,
        setInterval: () => {
          scheduled++;
          return 1;
        },
        clearInterval: () => undefined,
      },
    );
    expect(scheduled).toBe(0);
  });

  it("lights up when the answer arrives AFTER the screen is painted", async () => {
    /* The title used to wait for the update check outright, on the rule that a
     * row must not appear under the player's cursor. The rule stands; the wait
     * did not - a cold api.github.com request cost 6.1s on the shipped build and
     * the screen sat unfinished for all of it. So the screen paints on time and
     * the answer, when it comes, lights a row that is already there. */
    let scheduled = 0;
    let ready: ((v: boolean) => void) | undefined;
    const grid = renderTitle(
      { canUpdate: true, updateReady: false },
      {
        randint1: () => 4,
        setInterval: () => {
          scheduled++;
          return 1;
        },
        clearInterval: () => undefined,
        updateReadyLater: new Promise<boolean>((resolve) => {
          ready = resolve;
        }),
      },
    );
    const before = rowText(grid, 23);
    expect(before).toContain("(U)pdate"); // the row is there without the answer
    expect(scheduled).toBe(0);

    ready?.(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toBe(1);
    /* NOTHING MOVED - the row is in the same place it was painted in. A late
     * answer that shifted the menu would be the mis-click this design avoids. */
    expect(rowText(grid, 23)).toBe(before);
  });

  it("a late answer of 'nothing there' schedules nothing", async () => {
    let scheduled = 0;
    renderTitle(
      { canUpdate: true, updateReady: false },
      {
        randint1: () => 4,
        setInterval: () => {
          scheduled++;
          return 1;
        },
        clearInterval: () => undefined,
        updateReadyLater: Promise.resolve(false),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toBe(0);
  });

  it("a late answer with no (U)pdate row on screen changes nothing", async () => {
    /* In a browser the row's presence really does depend on the answer, so this
     * is the case where honouring a late one WOULD move the layout. It does not
     * get honoured: no row, no shimmer. */
    let scheduled = 0;
    const grid = renderTitle(
      { canUpdate: false, updateReady: false },
      {
        randint1: () => 4,
        setInterval: () => {
          scheduled++;
          return 1;
        },
        clearInterval: () => undefined,
        updateReadyLater: Promise.resolve(true),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toBe(0);
    expect(rowText(grid, 23)).not.toContain("(U)pdate");
  });

  it("does not start a second timer over one that is already shimmering", async () => {
    let scheduled = 0;
    renderTitle(
      { canUpdate: true, updateReady: true },
      {
        randint1: () => 4,
        setInterval: () => {
          scheduled++;
          return 1;
        },
        clearInterval: () => undefined,
        updateReadyLater: Promise.resolve(true),
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduled).toBe(1);
  });

  it("is what main.ts hands the still-running check to", () => {
    /* The other half of the arrangement, and the half that only exists as a call
     * site: showTitleScreen can honour a late answer all it likes if nobody
     * passes it one. main.ts is the shell and cannot be imported (it boots a real
     * game at module scope), so this is read as text. */
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/updateReadyLater: updateProbe\.then\(/u);
    /* Bounded, and bounded SHORT - the point is that the screen no longer waits
     * out a network round trip. A cold api.github.com request measured 6.1s on
     * the shipped build; anything near that is the old behaviour with a number
     * on it. */
    const wait = /const TITLE_CHECK_WAIT_MS = (\d+);/u.exec(main);
    expect(wait?.[1], "TITLE_CHECK_WAIT_MS not found in main.ts").toBeTruthy();
    expect(Number(wait?.[1])).toBeLessThanOrEqual(1000);
    /* And only where a bound is safe: under a desktop shell the (U)pdate row is
     * drawn from updateHow rather than from the answer, so nothing moves. A
     * browser's row really does depend on the answer, and its probe is local. */
    expect(main).toMatch(
      /desktopBridge === null \? await updateOffer\(\) : await updateOfferSoon\(\)/u,
    );
    /* The late value says "did not answer", not "nothing there". Those are
     * different and this codebase has already shipped the bug where they were
     * not (#247). */
    expect(main).toMatch(/resolve\(\{ ok: false, reason: "The check has not answered yet\." \}\)/u);
  });

  it("runs on the same cadence as the game's own animation timer", () => {
    /* main.ts's ANIM_INTERVAL_MS. Stated in two files because main.ts imports
     * this one; asserted so the duplication cannot drift. */
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const m = /const ANIM_INTERVAL_MS = (\d+);/u.exec(main);
    expect(m?.[1], "ANIM_INTERVAL_MS not found in main.ts").toBeTruthy();
    expect(Number(m?.[1])).toBe(TITLE_SHIMMER_MS);
  });
});
