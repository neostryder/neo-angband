/**
 * P8.7 stores / shopping / home tests. Pure decision helpers are exercised
 * against hand-built StoreView / ItemView arrays (the preferred substrate per the
 * task brief), asserting the faithful thresholds, the exact home-power golden
 * values derived from borg-home-power.c, and the AgentCommands emitted.
 */

import { describe, expect, it } from "vitest";
import type {
  AgentView,
  ItemView,
  StoreView,
  StoreItemView,
} from "@neo-angband/core";
import { BorgWorld } from "../world/model";
import { makeScenarioView, makeFakeActions } from "../harness";
import { makeBorgRng } from "../rng";
import type { BorgContext } from "../context";
import { BI } from "../trait/trait-index";
import { TV, SVAL } from "../item/svals";
import {
  BORG_HOME,
  SHOP_TEMPLE,
  createStoreMemory,
  borgMinItemQuantity,
  borgPowerHome,
  borgObjectSimilar,
  borgStoreBuys,
  borgGoodBuy,
  borgGoodSell,
  borgCountSell,
  borgThinkShopBuyUseful,
  borgThinkShopBuy,
  borgThinkShopSellUseless,
  borgThinkShopSell,
  borgThinkHomeGrabUseless,
  borgThinkHomeSellUseful,
  borgChooseShop,
} from "./index";

/**
 * A partial where every field may also be explicitly undefined. SVAL table
 * lookups are `number | undefined` (noUncheckedIndexedAccess), so tests pass
 * those straight through as sval; the builders coalesce to a default.
 */
type PItem = { [K in keyof ItemView]?: ItemView[K] | undefined };

/** A complete ItemView from a partial. */
function item(p: PItem): ItemView {
  return {
    handle: p.handle ?? 1,
    label: p.label ?? "item",
    tval: p.tval ?? 0,
    sval: p.sval ?? 0,
    pval: p.pval ?? 0,
    number: p.number ?? 1,
    weight: p.weight ?? 0,
    ac: p.ac ?? 0,
    toA: p.toA ?? 0,
    toH: p.toH ?? 0,
    toD: p.toD ?? 0,
    dd: p.dd ?? 0,
    ds: p.ds ?? 0,
    ego: p.ego ?? false,
    artifact: p.artifact ?? false,
    flags: p.flags ?? [],
    modifiers: p.modifiers ?? [],
    brands: p.brands ?? [],
    slays: p.slays ?? [],
    resists: p.resists ?? [],
    curses: p.curses ?? [],
    egoName: p.egoName ?? null,
    artifactName: p.artifactName ?? null,
    activation: p.activation ?? false,
    timeout: p.timeout ?? 0,
    inscription: p.inscription ?? null,
    ...(p.value !== undefined ? { value: p.value } : {}),
  };
}

/** A store ware (ItemView + index/price). */
function ware(index: number, p: PItem & { price?: number }): StoreItemView {
  return { ...item(p), index, ...(p.price !== undefined ? { price: p.price } : {}) };
}

/** A store view. */
function store(
  feat: number,
  isHome: boolean,
  stock: StoreItemView[],
  purse = 30000,
): StoreView {
  return {
    feat,
    featName: isHome ? "Home" : "Store",
    isHome,
    owner: { name: "keeper", purse },
    stock,
  };
}

/** A BorgContext over a scenario view with inventory/equipment/stores overrides. */
function makeCtx(over: {
  inventory?: ItemView[];
  equipment?: Array<ItemView | null>;
  stores?: StoreView[];
  traits?: Partial<Record<BI, number>>;
  power?: number;
}): { ctx: BorgContext; act: ReturnType<typeof makeFakeActions> } {
  const base = makeScenarioView();
  const view: AgentView = {
    ...base,
    inventory: () => over.inventory ?? [],
    equipment: () => over.equipment ?? [],
    stores: () => over.stores ?? [],
  };
  const world = new BorgWorld();
  if (over.traits) {
    for (const [k, v] of Object.entries(over.traits)) {
      world.self.trait[Number(k) as BI] = v;
    }
  }
  world.self.power = over.power ?? 0;
  /* the C convention: -1 means "no goal". */
  world.self.goal.shop = -1;
  world.self.goal.ware = -1;
  world.self.goal.item = -1;
  const act = makeFakeActions();
  const ctx: BorgContext = { world, view, act, rng: makeBorgRng(1) };
  return { ctx, act };
}

/* ------------------------------------------------------------------ *
 * borg_min_item_quantity (borg-store-sell.c:281).
 * ------------------------------------------------------------------ */

describe("borgMinItemQuantity", () => {
  it("trades 1 when poor (gold < 250)", () => {
    const { ctx } = makeCtx({ traits: { [BI.GOLD]: 100 } });
    expect(borgMinItemQuantity(ctx, item({ tval: TV.ARROW, number: 10, value: 1 }))).toBe(1);
  });
  it("trades up to 5 ammo when flush", () => {
    const { ctx } = makeCtx({ traits: { [BI.GOLD]: 300 } });
    expect(borgMinItemQuantity(ctx, item({ tval: TV.ARROW, number: 10, value: 1 }))).toBe(5);
    expect(borgMinItemQuantity(ctx, item({ tval: TV.ARROW, number: 3, value: 1 }))).toBe(3);
  });
  it("trades up to 3 food when flush", () => {
    const { ctx } = makeCtx({ traits: { [BI.GOLD]: 300 } });
    expect(borgMinItemQuantity(ctx, item({ tval: TV.FOOD, number: 10, value: 1 }))).toBe(3);
    expect(borgMinItemQuantity(ctx, item({ tval: TV.FOOD, number: 2, value: 1 }))).toBe(2);
  });
  it("trades 1 for expensive items (value > 5)", () => {
    const { ctx } = makeCtx({ traits: { [BI.GOLD]: 300 } });
    expect(borgMinItemQuantity(ctx, item({ tval: TV.ARROW, number: 10, value: 50 }))).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * borg_power_home golden values (borg-home-power.c).
 * ------------------------------------------------------------------ */

describe("borgPowerHome", () => {
  it("values an empty home at 0", () => {
    const { ctx } = makeCtx({ stores: [store(0, true, [])] });
    expect(borgPowerHome(ctx)).toBe(0);
  });

  it("rewards one telepathy item at +1000 (aux1 ladder)", () => {
    const { ctx } = makeCtx({
      stores: [
        store(0, true, [
          ware(0, { tval: TV.AMULET, flags: ["TELEPATHY"], value: 100 }),
        ]),
      ],
    });
    expect(borgPowerHome(ctx)).toBe(1000);
  });

  it("penalises a duplicate stack (-50000) atop the ladder", () => {
    /* two telepathy amulets: ladder(2)=1500, one duplicate -> -50000. */
    const { ctx } = makeCtx({
      stores: [
        store(0, true, [
          ware(0, { tval: TV.AMULET, number: 2, flags: ["TELEPATHY"], value: 100 }),
        ]),
      ],
    });
    expect(borgPowerHome(ctx)).toBe(1500 - 50000);
  });

  it("rewards resist poison at +5000", () => {
    const { ctx } = makeCtx({
      stores: [
        store(0, true, [
          ware(0, {
            tval: TV.SOFT_ARMOR,
            resists: [{ element: "POIS", level: 1 }],
            value: 100,
          }),
        ]),
      ],
    });
    expect(borgPowerHome(ctx)).toBe(5000);
  });

  it("rewards spare word-of-recall scrolls (100 each, capped at 5)", () => {
    /* aux2: num_recall loop 100 * min(5, n). */
    const { ctx } = makeCtx({
      stores: [
        store(0, true, [
          ware(0, {
            tval: TV.SCROLL,
            sval: SVAL.scroll.word_of_recall,
            number: 8,
            value: 100,
          }),
        ]),
      ],
    });
    expect(borgPowerHome(ctx)).toBe(500);
  });
});

/* ------------------------------------------------------------------ *
 * borg_object_similar (borg-store-sell.c:75).
 * ------------------------------------------------------------------ */

describe("borgObjectSimilar", () => {
  it("stacks two identical potions", () => {
    const a = item({ tval: TV.POTION, sval: 5, number: 1 });
    const b = item({ tval: TV.POTION, sval: 5, number: 1 });
    expect(borgObjectSimilar(a, b)).toBe(true);
  });
  it("rejects different svals", () => {
    const a = item({ tval: TV.POTION, sval: 5 });
    const b = item({ tval: TV.POTION, sval: 6 });
    expect(borgObjectSimilar(a, b)).toBe(false);
  });
  it("rejects at the max-stack limit (40)", () => {
    const a = item({ tval: TV.POTION, sval: 5, number: 39 });
    const b = item({ tval: TV.POTION, sval: 5, number: 1 });
    expect(borgObjectSimilar(a, b)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * borg_store_buys (borg-store-sell.c:701).
 * ------------------------------------------------------------------ */

describe("borgStoreBuys", () => {
  it("general store (0) buys food, not rings", () => {
    expect(borgStoreBuys(item({ tval: TV.FOOD }), 0)).toBe(true);
    expect(borgStoreBuys(item({ tval: TV.RING }), 0)).toBe(false);
  });
  it("magic shop (5) buys rings", () => {
    expect(borgStoreBuys(item({ tval: TV.RING }), 5)).toBe(true);
  });
  it("black market (6) buys light; anything with no_selling", () => {
    expect(borgStoreBuys(item({ tval: TV.LIGHT }), 6)).toBe(true);
    expect(borgStoreBuys(item({ tval: TV.RING }), 6)).toBe(false);
    expect(borgStoreBuys(item({ tval: TV.RING }), 6, { noSelling: true })).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * borg_good_buy (borg-store-buy.c:68).
 * ------------------------------------------------------------------ */

describe("borgGoodBuy", () => {
  it("rejects enchanted ammo before clevel 35", () => {
    const { ctx } = makeCtx({ traits: { [BI.CLEVEL]: 10, [BI.MAXCLEVEL]: 10 } });
    const arrow = ware(0, { tval: TV.ARROW, toH: 3 });
    expect(borgGoodBuy(ctx, arrow, 3, 0)).toBe(false);
  });
  it("accepts plain ammo", () => {
    const { ctx } = makeCtx({ traits: { [BI.CLEVEL]: 10, [BI.MAXCLEVEL]: 10 } });
    const arrow = ware(0, { tval: TV.ARROW });
    expect(borgGoodBuy(ctx, arrow, 3, 0)).toBe(true);
  });
  it("rejects black-market non-special buys while poor", () => {
    const { ctx } = makeCtx({ traits: { [BI.CLEVEL]: 10, [BI.MAXCLEVEL]: 10, [BI.GOLD]: 100 } });
    const wand = ware(0, { tval: TV.WAND, sval: SVAL.wand.wonder });
    expect(borgGoodBuy(ctx, wand, 6, 0)).toBe(false);
  });
  it("accepts a black-market Potion of Healing (special list)", () => {
    const { ctx } = makeCtx({ traits: { [BI.CLEVEL]: 10, [BI.MAXCLEVEL]: 10, [BI.GOLD]: 100 } });
    const pot = ware(0, { tval: TV.POTION, sval: SVAL.potion.healing });
    expect(borgGoodBuy(ctx, pot, 6, 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * borg_good_sell (borg-store-sell.c:816).
 * ------------------------------------------------------------------ */

describe("borgGoodSell", () => {
  it("sells a valued weapon a weapon shop buys (low level)", () => {
    const { ctx } = makeCtx({ traits: { [BI.MAXCLEVEL]: 5 } });
    const sword = item({ tval: TV.SWORD, value: 100 });
    expect(borgGoodSell(ctx, sword, 2)).toBe(true); /* shop 2 = weapon shop */
  });
  it("does not sell to a shop that will not buy the type", () => {
    const { ctx } = makeCtx({ traits: { [BI.MAXCLEVEL]: 5 } });
    const sword = item({ tval: TV.SWORD, value: 100 });
    expect(borgGoodSell(ctx, sword, 0)).toBe(false); /* general store */
  });
  it("never sells a worthless (0-value) weapon", () => {
    const { ctx } = makeCtx({ traits: { [BI.MAXCLEVEL]: 5 } });
    const sword = item({ tval: TV.SWORD, value: 0 });
    expect(borgGoodSell(ctx, sword, 2)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Step 3 -- buy from shop (planning + acting).
 * ------------------------------------------------------------------ */

describe("borgThinkShopBuyUseful + borgThinkShopBuy", () => {
  it("targets and buys an item the power seam approves", () => {
    const stores = [
      store(0, false, [
        ware(0, { tval: TV.FOOD, sval: SVAL.food.ration, number: 5, value: 1, price: 10 }),
      ]),
    ];
    const { ctx, act } = makeCtx({
      stores,
      power: 1000,
      traits: { [BI.GOLD]: 300, [BI.FOOD]: 5, [BI.LIGHT]: 3, [BI.MAXCLEVEL]: 10 },
    });
    const mem = createStoreMemory();
    const deps = { mem, buyShopEval: () => 1100 };

    expect(borgThinkShopBuyUseful(ctx, deps)).toBe(true);
    expect(ctx.world.self.goal.shop).toBe(0);
    expect(ctx.world.self.goal.ware).toBe(0);

    const cmd = borgThinkShopBuy(ctx, 0, deps);
    expect(cmd).not.toBeNull();
    expect(cmd).toMatchObject({ code: "shop-buy", args: { index: 0 } });
    /* goal cleared, purchase recorded. */
    expect(ctx.world.self.goal.ware).toBe(-1);
    expect(mem.boughtNum).toBe(0);
  });

  it("does not buy when the power seam shows no gain (conservative default)", () => {
    const stores = [
      store(0, false, [
        ware(0, { tval: TV.FOOD, sval: SVAL.food.ration, number: 5, value: 1, price: 10 }),
      ]),
    ];
    const { ctx } = makeCtx({
      stores,
      power: 1000,
      traits: { [BI.GOLD]: 300, [BI.FOOD]: 5, [BI.LIGHT]: 3, [BI.MAXCLEVEL]: 10 },
    });
    expect(borgThinkShopBuyUseful(ctx)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Step 2 -- sell to shop (planning + acting).
 * ------------------------------------------------------------------ */

describe("borgThinkShopSellUseless + borgThinkShopSell", () => {
  it("targets and sells a weapon to the weapon shop", () => {
    const inv = [item({ handle: 42, tval: TV.SWORD, value: 100 })];
    const stores = [
      store(0, false, []), /* general */
      store(0, false, []), /* armoury */
      store(0, false, []), /* weapon (index 2) */
    ];
    const { ctx, act } = makeCtx({
      inventory: inv,
      stores,
      power: 1000,
      traits: { [BI.MAXCLEVEL]: 5 },
    });
    const mem = createStoreMemory();
    const deps = { mem, sellEval: () => 1000 };

    expect(borgThinkShopSellUseless(ctx, deps)).toBe(true);
    expect(ctx.world.self.goal.shop).toBe(2);
    expect(ctx.world.self.goal.item).toBe(0);

    const cmd = borgThinkShopSell(ctx, 2, deps);
    expect(cmd).toMatchObject({ code: "shop-sell", args: { handle: 42 } });
    expect(mem.soldNum).toBe(0);
    expect(ctx.world.self.goal.item).toBe(-1);
  });

  it("sells nothing without a power seam (conservative default)", () => {
    const inv = [item({ handle: 42, tval: TV.SWORD, value: 100 })];
    const stores = [store(0, false, []), store(0, false, []), store(0, false, [])];
    const { ctx } = makeCtx({ inventory: inv, stores, power: 1000, traits: { [BI.MAXCLEVEL]: 5 } });
    expect(borgThinkShopSellUseless(ctx)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Step 6 -- grab useless home item (pure home power, no seam).
 * ------------------------------------------------------------------ */

describe("borgThinkHomeGrabUseless", () => {
  it("grabs a duplicate that drags home power down", () => {
    const dup = { tval: TV.SOFT_ARMOR, sval: 3, value: 10 };
    const stores = [
      store(0, true, [ware(0, dup), ware(1, dup), ware(2, dup)]),
    ];
    const { ctx } = makeCtx({ stores });
    expect(borgThinkHomeGrabUseless(ctx)).toBe(true);
    expect(ctx.world.self.goal.shop).toBe(BORG_HOME);
    /* all three removals tie; the last wins (equality does not skip). */
    expect(ctx.world.self.goal.ware).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * Step 1 -- stash to home (home power computed; player gate is a seam).
 * ------------------------------------------------------------------ */

describe("borgThinkHomeSellUseful", () => {
  it("stashes a home-improving item into an empty home (with the player-power seam)", () => {
    const inv = [item({ handle: 7, tval: TV.AMULET, flags: ["TELEPATHY"], value: 100 })];
    const stores = [store(0, true, [])];
    const { ctx } = makeCtx({ inventory: inv, stores, power: 500 });
    const deps = { sellHomeBadEval: () => 500 };
    const r = borgThinkHomeSellUseful(ctx, deps);
    expect(r.chosen).toBe(true);
    expect(ctx.world.self.goal.shop).toBe(BORG_HOME);
    expect(ctx.world.self.goal.item).toBe(0);
  });

  it("stashes nothing without the player-power seam (conservative default)", () => {
    const inv = [item({ handle: 7, tval: TV.AMULET, flags: ["TELEPATHY"], value: 100 })];
    const stores = [store(0, true, [])];
    const { ctx } = makeCtx({ inventory: inv, stores, power: 500 });
    expect(borgThinkHomeSellUseful(ctx).chosen).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * borg_choose_shop immediate shopping (borg-think-store.c:87).
 * ------------------------------------------------------------------ */

describe("borgChooseShop", () => {
  it("bails out in the dungeon", () => {
    const { ctx } = makeCtx({ traits: { [BI.CDEPTH]: 5 } });
    expect(borgChooseShop(ctx)).toBe(false);
  });

  it("buys healing immediately at the temple when cut", () => {
    const stores = [
      store(0, false, []), /* 0 general */
      store(0, false, []), /* 1 armoury */
      store(0, false, []), /* 2 weapon */
      store(0, false, [
        ware(0, { tval: TV.POTION, sval: SVAL.potion.cure_critical, value: 20, price: 20 }),
      ]), /* 3 temple */
    ];
    const { ctx } = makeCtx({
      stores,
      power: 1000,
      traits: { [BI.CDEPTH]: 0, [BI.ISCUT]: 1, [BI.GOLD]: 300, [BI.FOOD]: 5, [BI.LIGHT]: 3, [BI.MAXCLEVEL]: 10 },
    });
    const deps = { mem: createStoreMemory(), buyShopEval: () => 1100 };
    expect(borgChooseShop(ctx, deps)).toBe(true);
    expect(ctx.world.self.goal.shop).toBe(SHOP_TEMPLE);
  });
});

/* ------------------------------------------------------------------ *
 * borg_count_sell (borg-store-sell.c:1163).
 * ------------------------------------------------------------------ */

describe("borgCountSell", () => {
  it("counts a valuable non-protected item when the seam keeps power", () => {
    const inv = [item({ tval: TV.SWORD, value: 5000 })];
    const { ctx } = makeCtx({
      inventory: inv,
      power: 1000,
      traits: { [BI.GOLD]: 0, [BI.CLEVEL]: 20, [BI.MAXCLEVEL]: 20 },
    });
    expect(borgCountSell(ctx, { sellEval: () => 1000 })).toBe(1);
  });

  it("does not count protected consumables (Potion of Speed)", () => {
    const inv = [item({ tval: TV.POTION, sval: SVAL.potion.speed, value: 5000 })];
    const { ctx } = makeCtx({
      inventory: inv,
      power: 1000,
      traits: { [BI.GOLD]: 0, [BI.CLEVEL]: 20, [BI.MAXCLEVEL]: 20 },
    });
    expect(borgCountSell(ctx, { sellEval: () => 1000 })).toBe(0);
  });
});
