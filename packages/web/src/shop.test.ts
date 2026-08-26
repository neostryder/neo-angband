import { describe, expect, it } from "vitest";
import { newGear, gearAdd, objectNew, TV, FEAT } from "@rpgm-tools/neo-angband-core";
import type { GameObject, ObjectKind, StartedGame, Store } from "@rpgm-tools/neo-angband-core";
import {
  findInven,
  sortStoreStock,
  wrapCssRuns,
  SEL_ORIGINAL,
  SEL_ROGUE,
  contextMenuPosition,
  paintContextMenu,
} from "./shop";

/**
 * find_inven (store.c L1515-1644): the count of a stackable equivalent already
 * carried in the pack, for the buy/take "(you have N)" prompt hint (gap 12.10).
 */
function mkObj(kind: ObjectKind, number: number, over: Partial<GameObject> = {}): GameObject {
  const o = objectNew(kind);
  o.tval = kind.tval;
  o.number = number;
  Object.assign(o, over);
  return o;
}

function gameWithPack(objs: GameObject[]): StartedGame {
  const gear = newGear();
  for (const o of objs) gear.pack.push(gearAdd(gear, o));
  return { state: { gear } } as unknown as StartedGame;
}

describe("findInven (store.c find_inven, gap 12.10)", () => {
  const potionKind = { tval: TV.POTION } as ObjectKind;
  const scrollKind = { tval: TV.SCROLL } as ObjectKind;
  const chestKind = { tval: TV.CHEST } as ObjectKind;
  const swordKind = { tval: TV.SWORD } as ObjectKind;

  it("sums the numbers of every matching-kind pack stack (kind-only tvals)", () => {
    const game = gameWithPack([mkObj(potionKind, 3), mkObj(potionKind, 2)]);
    expect(findInven(game, mkObj(potionKind, 1))).toBe(5);
  });

  it("ignores stacks of a different kind", () => {
    const game = gameWithPack([mkObj(potionKind, 3), mkObj(scrollKind, 9)]);
    expect(findInven(game, mkObj(potionKind, 1))).toBe(3);
  });

  it("returns 0 for chests (never stackable)", () => {
    const game = gameWithPack([mkObj(chestKind, 1)]);
    expect(findInven(game, mkObj(chestKind, 1))).toBe(0);
  });

  it("counts a wearable only when its bonuses match exactly", () => {
    const plus1 = mkObj(swordKind, 1, { toH: 1 });
    const plus0 = mkObj(swordKind, 1, { toH: 0 });
    const game = gameWithPack([plus1, plus0]);
    // A +0 probe matches only the +0 sword, not the +1 one.
    expect(findInven(game, mkObj(swordKind, 1, { toH: 0 }))).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    const game = gameWithPack([mkObj(scrollKind, 4)]);
    expect(findInven(game, mkObj(potionKind, 1))).toBe(0);
  });
});

/**
 * store_stock_list (store.c:779-808) display order: earlier_object in store mode
 * - decreasing tval, then increasing sval, then decreasing object_value. The
 * shell must apply this at display time (store_carry inserts unsorted), which is
 * what sortStoreStock does over the already-ported earlierObject comparator.
 */
describe("sortStoreStock (store_stock_list display order)", () => {
  function kind(tval: number, sval: number): ObjectKind {
    return { tval, sval } as ObjectKind;
  }
  function stockObj(tval: number, sval: number, value: number): GameObject {
    const o = objectNew(kind(tval, sval));
    o.tval = tval;
    o.sval = sval;
    (o as unknown as { _v: number })._v = value; // stashed for the price stub
    return o;
  }
  function storeWith(stock: GameObject[]): { game: StartedGame; store: Store } {
    const store = { feat: FEAT.STORE_GENERAL, stock } as unknown as Store;
    const game = {
      state: { gear: newGear(), actor: { combat: { ammoTval: 0 } } },
      // object_value proxy: the value stashed on the object.
      price: (_s: Store, o: GameObject) => (o as unknown as { _v: number })._v,
    } as unknown as StartedGame;
    return { game, store };
  }

  it("orders by decreasing tval, then increasing sval", () => {
    // Scrambled input; expect tval 6 before tval 4, and within a tval, sval asc.
    const a = stockObj(4, 2, 10);
    const b = stockObj(6, 5, 10);
    const c = stockObj(6, 1, 10);
    const { game, store } = storeWith([a, b, c]);
    const sorted = sortStoreStock(game, store);
    expect(sorted).toEqual([c, b, a]); // tval6/sval1, tval6/sval5, tval4/sval2
  });

  it("breaks equal tval+sval ties by decreasing value", () => {
    const cheap = stockObj(5, 3, 5);
    const dear = stockObj(5, 3, 99);
    const { game, store } = storeWith([cheap, dear]);
    expect(sortStoreStock(game, store)).toEqual([dear, cheap]);
  });
});

/**
 * The store selection strings must match store_menu_set_selections
 * (ui-store.c L797-806) verbatim, both keysets: they tag / pick stock rows and
 * are deliberately disjoint from the command keys (p/g/s/d/l/x/...), so a
 * selection letter can never fire a command. Verified live in-browser
 * (a,c,f,h,j,m,n,o,q,r,u,v on the General Store), pinned here against drift.
 */
describe("store selection strings (store_menu_set_selections)", () => {
  it("matches the original keyset string exactly", () => {
    expect(SEL_ORIGINAL).toBe("acfhjmnoqruvyzABDFGHJKLMNOPQRSTUVWXYZ");
  });
  it("matches the roguelike keyset string exactly", () => {
    expect(SEL_ROGUE).toBe("abcfmnoqrtuvyzABDFGHJKLMNOQRSUVWXYZ");
  });
  it("never intersects the store command keys (p/g/s/d/l/x and I)", () => {
    for (const sel of [SEL_ORIGINAL, SEL_ROGUE]) {
      for (const cmd of "pgsdlxI") expect(sel.includes(cmd)).toBe(false);
    }
  });
});

/**
 * store_display_help word-wraps the command legend (text_out) to the store
 * width, carrying each run's colour across the break. wrapCssRuns is that
 * wrapper; check it breaks on spaces, keeps colours, and never exceeds width.
 */
describe("wrapCssRuns (store help legend wrapping)", () => {
  it("wraps on spaces without exceeding the width", () => {
    const runs = [{ text: "one two three four five", color: "#fff" }];
    const lines = wrapCssRuns(runs, 9);
    for (const ln of lines) {
      const len = ln.reduce((n, r) => n + r.text.length, 0);
      expect(len).toBeLessThanOrEqual(9);
    }
    // Reassembling the lines yields the original words in order.
    expect(lines.map((ln) => ln.map((r) => r.text).join("")).join(" ")).toBe(
      "one two three four five",
    );
  });

  it("preserves per-run colours across a wrap boundary", () => {
    const runs = [
      { text: "green ", color: "#0f0" },
      { text: "white words here", color: "#fff" },
    ];
    const lines = wrapCssRuns(runs, 8);
    const flat = lines.flat();
    expect(flat.some((r) => r.color === "#0f0" && r.text.includes("green"))).toBe(true);
    expect(flat.some((r) => r.color === "#fff")).toBe(true);
  });
});

/**
 * A newline used to be wrapped as an ordinary character, and the terminal has no
 * glyph for U+000A, so it painted as a solid block. Third-party mod descriptions
 * contain real paragraph breaks, so this is player-visible input the wrapper does
 * not get to reject.
 */
describe("wrapCssRuns (newlines end lines instead of painting as blocks)", () => {
  it("turns a paragraph break into a blank line and emits no \\n anywhere", () => {
    const lines = wrapCssRuns(
      [{ text: "are not touched here.\n\nEnable it and you get", color: "#fff" }],
      40,
    );
    const texts = lines.map((ln) => ln.map((r) => r.text).join(""));
    for (const t of texts) expect(t).not.toContain("\n");
    expect(texts).toContain("");
    // The blank line sits between the two paragraphs, not at either end.
    const blank = texts.indexOf("");
    expect(blank).toBeGreaterThan(0);
    expect(blank).toBeLessThan(texts.length - 1);
    expect(texts[blank - 1]).toBe("are not touched here.");
    expect(texts[blank + 1]).toBe("Enable it and you get");
  });

  it("treats a single newline as a hard break with no blank line", () => {
    const lines = wrapCssRuns([{ text: "first\nsecond", color: "#fff" }], 40);
    expect(lines.map((ln) => ln.map((r) => r.text).join(""))).toEqual(["first", "second"]);
  });

  it("treats CRLF and a lone CR as the same break, leaving no stray \\r", () => {
    for (const eol of ["\r\n", "\r"]) {
      const lines = wrapCssRuns([{ text: `first${eol}second`, color: "#fff" }], 40);
      expect(lines.map((ln) => ln.map((r) => r.text).join(""))).toEqual(["first", "second"]);
    }
  });

  it("does not spend width on the newline, and still wraps each paragraph", () => {
    const lines = wrapCssRuns([{ text: "aaa bbb\nccc ddd", color: "#fff" }], 4);
    expect(lines.map((ln) => ln.map((r) => r.text).join(""))).toEqual([
      "aaa",
      "bbb",
      "ccc",
      "ddd",
    ]);
  });

  it("keeps each paragraph's colour when the break falls between runs", () => {
    const lines = wrapCssRuns(
      [
        { text: "green\n", color: "#0f0" },
        { text: "white", color: "#fff" },
      ],
      40,
    );
    expect(lines).toEqual([[{ text: "green", color: "#0f0" }], [{ text: "white", color: "#fff" }]]);
  });
});

/**
 * menu_dynamic_calc_location (ui-menu.c:1123-1148): context_menu_store_item's
 * own call (ui-store.c L1041) always passes mx=1, my=the selected stock row's
 * own screen row, so the popup opens beside the item it is for.
 */
describe("contextMenuPosition (menu_dynamic_calc_location, ui-menu.c:1123-1148)", () => {
  it("opens one column right and one row below (mx, my) when there is room", () => {
    expect(contextMenuPosition(1, 10, 80, 24, 10, 3)).toEqual({ col: 2, row: 11 });
  });

  it("pins to the bottom of the screen instead of running off it", () => {
    expect(contextMenuPosition(1, 21, 80, 24, 10, 3)).toEqual({ col: 2, row: 20 });
  });

  it("moves to the top-right corner when there is no room above either", () => {
    expect(contextMenuPosition(1, 2, 80, 5, 10, 3)).toEqual({ col: 69, row: 1 });
  });

  it("pulls the box left of the right edge instead of running past it", () => {
    expect(contextMenuPosition(15, 5, 20, 24, 10, 3)).toEqual({ col: 9, row: 6 });
  });

  it("never returns a negative column or row, even for a box wider than the screen", () => {
    expect(contextMenuPosition(1, 5, 5, 24, 10, 3)).toEqual({ col: 0, row: 6 });
  });
});

/**
 * #128: itemContext used to print its labels with bare term.print() calls and
 * no backdrop, so whatever the stock list had already painted on those same
 * rows - an item's name, weight, price - kept showing through past the
 * label's own length, making the popup unreadable. paintContextMenu's
 * blank-then-print must leave nothing of that behind within the popup's own
 * footprint.
 */
describe("paintContextMenu (context_menu_store_item's backdrop, #128)", () => {
  function fakeGrid(cols: number, rows: number): {
    cells: string[][];
    print: (x: number, y: number, text: string, fg?: string, bg?: string) => void;
  } {
    const cells: string[][] = Array.from({ length: rows }, () => Array(cols).fill(" "));
    return {
      cells,
      print(x, y, text) {
        for (let i = 0; i < text.length; i++) {
          const cx = x + i;
          if (cx >= 0 && cx < cols && y >= 0 && y < rows) cells[y]![cx] = text[i]!;
        }
      },
    };
  }

  it("erases the stock row's leftover text behind and around each label", () => {
    const grid = fakeGrid(40, 10);
    // Simulate paint() having already drawn stock rows across the rows the
    // popup is about to occupy - a name, then weight and price further right,
    // exactly what store_display_entry / paint() draws on those rows.
    grid.print(0, 4, "c) A Longsword (+0,+0)      3.2 lb   45 gold");
    grid.print(0, 5, "d) A Potion of Cure Light Wounds     1 gold");

    const entries = [
      { key: "l", label: "Examine" },
      { key: "p", label: "Buy" },
    ];
    const boxCol = 2;
    const boxRow = 4;
    const boxWidth = Math.max(...entries.map((e) => e.label.length)) + 3 + 2;
    paintContextMenu(grid, entries, boxCol, boxRow, boxWidth, 0);

    for (let e = 0; e < entries.length; e++) {
      const row = grid.cells[boxRow + e]!.join("");
      const label = `${entries[e]!.key}) ${entries[e]!.label}`;
      // The label itself prints exactly as expected...
      expect(row.slice(boxCol, boxCol + label.length)).toBe(label);
      // ...and nothing of the old stock row survives behind or past it,
      // anywhere within the popup's own width - the bug this regresses.
      const afterLabel = row.slice(boxCol + label.length, boxCol + boxWidth);
      expect(afterLabel.trim()).toBe("");
      const leftMargin = row.slice(Math.max(0, boxCol - 1), boxCol);
      expect(leftMargin.trim()).toBe("");
    }
  });
});
