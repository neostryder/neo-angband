/**
 * The two-pane knowledge browser (display_knowledge, ui-knowledge.c L1050-1240).
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
import { runGroupedBrowser, type KnowledgeGroup } from "./knowledge";
import type { GlyphTerm } from "./term";

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
}

function makeTerm(cols = 80, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      const row = grid[y];
      if (!row) return;
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    eraseToEol: (x: number, y: number) => {
      const row = grid[y];
      if (!row) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
    },
    setCursor: () => undefined,
    onCellTap: () => undefined,
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
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
    /* o_cur = 0 on a group change (L1153-1160), so this is the Amulet group's
     * FIRST row and not whatever index the cursor held in the Ring group. */
    /* Second argument: the group the row was chosen from. desc_ego_fake heads
     * its page with `ego_grp_name(default_group_id(oid))` + the ego name
     * (ui-knowledge.c L1801), so the browser has to hand it along - an ego
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
    press(win, "r"); // 'r'ecall, from ui-knowledge.c:1072
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
