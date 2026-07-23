import { describe, expect, it } from "vitest";
import { newGear, gearAdd, objectNew, TV, FEAT } from "@neo-angband/core";
import type { GameObject, ObjectKind, StartedGame, Store } from "@neo-angband/core";
import { findInven, sortStoreStock, wrapCssRuns, SEL_ORIGINAL, SEL_ROGUE } from "./shop";

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
