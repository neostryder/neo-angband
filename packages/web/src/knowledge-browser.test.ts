/**
 * The two-pane knowledge browser (display_knowledge, ui-knowledge.c L733-1080).
 *
 * WHAT THIS EXISTS TO STOP COMING BACK. The port used to flatten every group into
 * one lettered menu. Known objects is several hundred rows; the alphabet runs out
 * at the fifty-second, so most of the screen was rows with a blank tag, and the
 * lettering was an invention in the first place - upstream's two menus are built
 * from iters whose `get_tag` is NULL over a `selections` that menu_init memsets to
 * NULL, so `display_menu_row` prints no tag on either side.
 *
 * So the assertions here are about the SHAPE of the screen rather than about any
 * one row: two panes with a divider, a rule under a Group/Name header, no `a) `
 * anywhere, and ESC meaning "back to the groups" in the right pane and "leave" in
 * the left one.
 *
 * No jsdom in this repo (see help.test.ts): a fake window plus a string-grid term,
 * the same fixtures overlay.test.ts uses.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { runGroupedBrowser, showMonsterKnowledge, type KnowledgeGroup } from "./knowledge";
import type { GlyphTerm } from "./term";
import type { MonsterLore, MonsterRace } from "@rpgm-tools/neo-angband-core";
import { COLOUR_RED, COLOUR_VIOLET, RF, colorToCss } from "@rpgm-tools/neo-angband-core";

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: { type: string; fn: (ev: Event) => void; capture: boolean }[] = [];
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

interface FakeTerm extends GlyphTerm {
  snapshot(): string[];
  /** The colour written to a cell, so a "which half is violet" claim is real. */
  colorAt(x: number, y: number): string;
}

function makeTerm(cols = 80, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const colors: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(""));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
      for (const row of colors) row.fill("");
    },
    print: (x: number, y: number, text: string, fg?: string) => {
      const row = grid[y];
      const crow = colors[y];
      if (!row) return;
      for (let i = 0; i < text.length && x + i < cols; i++) {
        row[x + i] = text[i] ?? " ";
        if (crow) crow[x + i] = fg ?? "";
      }
    },
    eraseToEol: (x: number, y: number) => {
      const row = grid[y];
      const crow = colors[y];
      if (!row) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) {
        row[cx] = " ";
        if (crow) crow[cx] = "";
      }
    },
    setCursor: () => undefined,
    onCellTap: () => undefined,
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
    colorAt: (x: number, y: number) => colors[y]?.[x] ?? "",
  } as unknown as FakeTerm;
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Three groups, the third with more members than any one screen would letter. */
function groups(): KnowledgeGroup<string>[] {
  return [
    { name: "Ring", rows: [{ label: "Ring of Digging", color: "w", member: "ring" }] },
    { name: "Amulet", rows: [{ label: "Amulet of Slow Digestion", color: "w", member: "amulet" }] },
    {
      name: "Potion",
      rows: Array.from({ length: 60 }, (_, i) => ({
        label: `Potion number ${String(i)}`,
        color: "w",
        member: `potion-${String(i)}`,
      })),
    },
  ];
}

describe("runGroupedBrowser: the screen upstream draws", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("draws Group and Name panes with a rule and a divider", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runGroupedBrowser(term, "known objects", groups(), async () => undefined);
    const shot = term.snapshot();

    expect(shot[2]).toContain("Knowledge - known objects");
    expect(shot[4]).toContain("Group");
    expect(shot[4]).toContain("Name");
    /* Row 5 is the `=` rule; rows 6.. carry the `|` divider (L1229-1234). */
    expect(shot[5]).toMatch(/^=+$/u);
    expect(shot[6]).toContain("|");
    /* Both panes are painted at once, the inactive one included. */
    expect(shot[6]).toContain("Ring");
    expect(shot[6]).toContain("Ring of Digging");

    press(win, "Escape");
    await done;
  });

  it("letters nothing - not one row on either side", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = runGroupedBrowser(term, "known objects", groups(), async () => undefined);
    /* The exact defect: `a) `, `b) `, and past row 52 an empty tag and no way to
     * pick the row at all. There is no tag column here. */
    for (const line of term.snapshot()) expect(line).not.toMatch(/\b[a-zA-Z]\) /u);
    press(win, "Escape");
    await done;
  });

  it("ESC in the Name pane goes back to Group; ESC in Group leaves", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let closed = false;
    const done = runGroupedBrowser(term, "known objects", groups(), async () => undefined).then(
      () => {
        closed = true;
      },
    );
    press(win, "ArrowRight"); // into the Name pane
    press(win, "Escape"); // back one level, NOT out of the browser
    await tick();
    expect(closed).toBe(false);
    press(win, "Escape"); // now out
    await done;
    expect(closed).toBe(true);
  });

  it("choosing a group scopes the Name pane to it, and resets its cursor", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const recall = vi.fn(async () => undefined);
    const done = runGroupedBrowser(term, "known objects", groups(), recall);
    press(win, "ArrowDown"); // Ring -> Amulet
    press(win, "ArrowRight"); // into its names
    press(win, "Enter"); // read the row under the cursor
    await tick();
    /* o_cur = 0 on a group change (L885), so this is the Amulet group's
     * FIRST row and not whatever index the cursor held in the Ring group. */
    /* Second argument: the group the row was chosen from. desc_ego_fake heads
     * its page with `ego_grp_name(default_group_id(oid))` + the ego name
     * (ui-knowledge.c L1725-1727), so the browser has to hand it along - an ego
     * listed under two groups gets two different headers. */
    expect(recall).toHaveBeenCalledWith("amulet", "Amulet");
    press(win, "Escape");
    press(win, "Escape");
    await done;
  });

  it("wraps at both ends of a pane, so a 60-row group is one key from its end", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const recall = vi.fn(async () => undefined);
    const done = runGroupedBrowser(term, "known objects", groups(), recall);
    press(win, "ArrowUp"); // Ring -> wraps to Potion, the last group
    press(win, "ArrowRight");
    press(win, "ArrowUp"); // row 0 -> wraps to row 59
    press(win, "r"); // 'r'ecall, from ui-knowledge.c:1011
    await tick();
    expect(recall).toHaveBeenCalledWith("potion-59", "Potion");
    press(win, "Escape");
    press(win, "Escape");
    await done;
  });

  it("runs an xtra_act key in the Name pane, and only there", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const xtraAct = vi.fn(async () => true);
    const done = runGroupedBrowser(term, "known objects", groups(), async () => undefined, {
      xtraAct,
    });
    press(win, "{"); // still in the Group pane: not this pane's key
    await tick();
    expect(xtraAct).not.toHaveBeenCalled();
    press(win, "ArrowRight");
    press(win, "{");
    await tick();
    expect(xtraAct).toHaveBeenCalledWith("{", "ring");
    press(win, "Escape");
    press(win, "Escape");
    await done;
  });

  it("shows the row's own prompt when it has one (xtra_prompt)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const withHint: KnowledgeGroup<string>[] = [
      {
        name: "Combat",
        rows: [
          { label: "armour", color: "w", member: "a", hint: ", 'r'ecall, '{', '}'" },
          { label: "to-hit", color: "w", member: "b" },
        ],
      },
    ];
    const done = runGroupedBrowser(term, "runes", withHint, async () => undefined);
    press(win, "ArrowRight");
    const bottom = term.snapshot()[23] ?? "";
    expect(bottom).toContain(", 'r'ecall, '{', '}'");
    /* And the row with no prompt of its own gets the port's own legend rather
     * than a bare "<dir>, ESC" nobody can act on. */
    press(win, "ArrowDown");
    expect(term.snapshot()[23] ?? "").toContain("Enter or 'r' to read");
    press(win, "Escape");
    press(win, "Escape");
    await done;
  });

  it("returns at once when every group is empty", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    await runGroupedBrowser(
      term,
      "shapes",
      [{ name: "Only", rows: [] }],
      async () => undefined,
    );
    /* Nothing painted, nothing listening: an empty browser must not sit there
     * waiting for a key that has nothing to act on. */
    expect(term.snapshot().join("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The monster browser (do_cmd_knowledge_monsters, ui-knowledge.c L1309-1378)
// ---------------------------------------------------------------------------

/**
 * It used to have a renderer of its own, in main.ts, and that is what these
 * assert against coming back: the shared browser's Group label, `=` rule, `|`
 * divider and eight-column floor on the group pane, plus the two seams only
 * this screen supplies - display_knowledge's `otherfields` header and
 * mon_summary's line under the member list.
 */
function race(
  name: string,
  over: Partial<{ ridx: number; level: number; rarity: number; maxNum: number; dChar: string; dAttr: number; unique: boolean }> = {},
): MonsterRace {
  const unique = over.unique ?? false;
  return {
    name,
    ridx: over.ridx ?? 1,
    level: over.level ?? 1,
    rarity: over.rarity ?? 1,
    maxNum: over.maxNum ?? 100,
    dChar: over.dChar ?? "d",
    dAttr: over.dAttr ?? COLOUR_RED,
    flags: { has: (f: number) => unique && f === RF.UNIQUE },
  } as unknown as MonsterRace;
}

function lore(pkills: number, allKnown = false): MonsterLore {
  return { pkills, sights: 1, allKnown } as unknown as MonsterLore;
}

describe("showMonsterKnowledge (do_cmd_knowledge_monsters)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /* Every field here is load-bearing, and each one earned its value by a
   * mutation surviving without it: Sauron is DEAD where Smaug is alive, Smaug
   * has kills of his own so double-counting him is visible, and the Uniques
   * group holds two rows so the second is a unique the cursor is NOT on. */
  const sauron = { race: race("Sauron, the Sorcerer", { ridx: 8, unique: true, dChar: "p", maxNum: 0 }), lore: lore(1) };
  const smaug = { race: race("Smaug the Golden", { ridx: 9, unique: true, dChar: "D", maxNum: 1 }), lore: lore(3) };
  const kobold = { race: race("small kobold", { ridx: 2, dChar: "k" }), lore: lore(7, true) };
  /* Smaug is in BOTH groups, exactly as the C's per-race loop puts him: a unique
   * dragon matches "Uniques" by flag and "Dragons" by base. */
  const views = () => [
    { name: "Uniques", rows: [sauron, smaug] },
    { name: "Dragons", rows: [smaug, kobold] },
  ];

  it("draws the shared two-pane frame and the otherfields header", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = showMonsterKnowledge(term, views(), false, async () => undefined);
    const shot = term.snapshot();

    expect(shot[2]).toContain("Knowledge - monsters");
    expect(shot[4]).toContain("Group");
    expect(shot[4]).toContain("Name");
    expect(shot[5]).toMatch(/^=+$/u);
    expect(shot[6]).toContain("|");
    /* prt(otherfields, 4, 46): the header sits at 46 and puts Sym/Kills/Full
     * over the columns display_monster writes at 64 / 68 / 75. */
    expect(shot[4]!.slice(46)).toBe("                 Sym  Kills  Full");
    expect(shot[4]!.indexOf("Kills")).toBe(68);
    expect(shot[4]!.indexOf("Full")).toBe(75);

    press(win, "Escape");
    await done;
  });

  it("puts the group pane at display_knowledge's eight-column floor", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    /* Every group name here is shorter than eight, so a renderer that sized the
     * pane on the longest name alone would slide the Name column left.
     * g_name_len starts at 8 (ui-knowledge.c:745) and only grows. */
    const done = showMonsterKnowledge(
      term,
      [{ name: "Ants", rows: [kobold] }],
      false,
      async () => undefined,
    );
    expect(term.snapshot()[4]!.indexOf("Name")).toBe(11); // 8 + 3
    press(win, "Escape");
    await done;
  });

  it("writes the Sym / Kills / Full columns at 64 / 68 / 75", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = showMonsterKnowledge(term, views(), false, async () => undefined);
    press(win, "ArrowDown"); // the Dragons group: Smaug then the kobold
    await tick();
    const shot = term.snapshot();
    expect(shot[6]!.slice(64, 65)).toBe("D");
    expect(shot[6]!.slice(68, 73)).toBe("alive"); // a living unique
    expect(shot[6]!.slice(75, 78)).toBe("no");
    /* "%5d" - right-justified, so the tens column lands at 72 and not at 69. */
    expect(shot[7]!.slice(68, 73)).toBe("    7");
    expect(shot[7]!.slice(75, 78)).toBe("yes");
    press(win, "ArrowUp"); // back to Uniques, whose first row is a DEAD one
    await tick();
    /* max_num == 0 -> " dead", leading space and all (ui-knowledge.c:1140). */
    expect(term.snapshot()[6]!.slice(68, 73)).toBe(" dead");
    press(win, "Escape");
    await done;
  });

  it("mon_summary: uniques count, everyone else reports against the total", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = showMonsterKnowledge(term, views(), false, async () => undefined);
    /* Group 0, first member a unique -> the uniques form (ui-knowledge.c:1247-1250). */
    expect(term.snapshot()[22]).toContain("2 known uniques, 4 slain.");
    press(win, "ArrowDown");
    await tick();
    /* tkills is summed over l_list ONCE, so Smaug's three count once even though
     * he joins two groups: 1 + 3 + 7, not 1 + 3 + 3 + 7. */
    expect(term.snapshot()[22]).toContain("Creatures slain: 10/11 (in group/in total)");
    press(win, "Escape");
    await done;
  });

  it("purple_uniques recolours the symbol, not the name", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = showMonsterKnowledge(term, views(), true, async () => undefined);
    /* display_monster (:1188-1194) rewrites `a`, the symbol's attr. The name is
     * drawn with curs_attrs, which the option does not touch.
     * Row 7, not row 6: the cursor is on row 6, and runGroupedBrowser paints a
     * SELECTED row in the cursor colour instead of the row's own - so a name
     * wrongly turned violet would be invisible there. */
    expect(term.colorAt(64, 7)).toBe(colorToCss(COLOUR_VIOLET));
    expect(term.colorAt(11, 7)).not.toBe(colorToCss(COLOUR_VIOLET));
    press(win, "Escape");
    await done;
  });

  it("a rarity-0 race reads 'shape', not a kill count", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const shape = { race: race("Bear", { ridx: 40, rarity: 0, dChar: "q" }), lore: lore(3) };
    const done = showMonsterKnowledge(
      term,
      [{ name: "Quadrupeds", rows: [shape] }],
      false,
      async () => undefined,
    );
    expect(term.snapshot()[6]!.slice(68, 73)).toBe("shape");
    press(win, "Escape");
    await done;
  });

  it("Enter on a member recalls THAT row", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const seen: string[] = [];
    const done = showMonsterKnowledge(term, views(), false, async (row) => {
      seen.push(row.race.name);
    });
    press(win, "ArrowDown");   // Dragons
    press(win, "ArrowRight");  // into its names
    press(win, "ArrowDown");   // the kobold
    press(win, "Enter");
    await tick();
    expect(seen).toEqual(["small kobold"]);
    press(win, "Escape");
    press(win, "Escape");
    await done;
  });
});
