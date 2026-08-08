import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { FEAT, OF, TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import { OBJ_NOTICE, learnBirthObviousFlags, makeRuneEnv } from "../obj/knowledge.js";
import { ODESC, objectDesc } from "../obj/desc.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import { ArtifactState, ObjAllocState, objectPrep } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { ObjPackJson } from "../obj/types.js";
import { Rng } from "../rng.js";
import { StoreRegistry } from "./bind.js";
import {
  ANY_STORE,
  bindStoreRuntime,
  massProduce,
  registerCoreStoreBehaviour,
  StoreBehaviourRegistry,
  storeMaint,
  storeReset,
  storeUpdate,
  storeWillBuy,
} from "./store.js";
import type { Store, StoreMaintContext } from "./store.js";
import type { ObjectBuy, StoreRecordJson } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const objPack: ObjPackJson = {
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson;

const reg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));
const storeReg = new StoreRegistry(loadRecords<StoreRecordJson>("store"), reg);

function freshStores(rng: Rng): Store[] {
  return storeReg.stores.map((b) =>
    bindStoreRuntime(b, rng, constants.storeInvenMax),
  );
}

function context(): { ctx: StoreMaintContext; stores: Store[] } {
  const rng = new Rng(1234);
  const deps: MakeDeps = {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts: false,
  };
  const stores = freshStores(rng);
  return { ctx: { rng, deps, maxDepth: 0, stores }, stores };
}

describe("store maintenance (store.c store_reset/store_maint)", () => {
  /*
   * history_lose_artifact (store.c:1091 inside store_delete_random, and :1307
   * in the black-market purge). Store generation never makes an artifact, so
   * the only way one reaches a store's stock is the player selling it - and
   * then the store's own turnover can destroy it. do_cmd_buy's two
   * store_delete calls (L1754, L1847) deliberately do NOT log a loss, which is
   * why the hook lives on the two maintenance sites and not inside
   * storeDelete.
   */
  it("logs an artifact the store turns over as LOST", () => {
    const { ctx, stores } = context();
    storeReset(ctx);
    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL);
    if (!general) throw new Error("missing store");

    const art = reg.artifacts.find((a) => a) as NonNullable<
      (typeof reg.artifacts)[number]
    >;
    const sold = general.stock[0] as GameObject;
    sold.artifact = art;

    const lost: unknown[] = [];
    /* Turn the whole shop over until the planted stack is gone. */
    const withHook: StoreMaintContext = {
      ...ctx,
      onArtifactLost: (a): void => void lost.push(a),
    };
    for (let i = 0; i < 40 && general.stock.includes(sold); i++) {
      storeMaint(withHook, general);
    }
    expect(general.stock.includes(sold)).toBe(false);
    expect(lost).toContain(art);
  });

  it("does not log a loss for the ordinary stock it turns over", () => {
    const { ctx, stores } = context();
    storeReset(ctx);
    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL);
    if (!general) throw new Error("missing store");
    const lost: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      storeMaint({ ...ctx, onArtifactLost: (a): void => void lost.push(a) }, general);
    }
    expect(lost).toEqual([]);
  });

  it("stocks the town stores and leaves the home empty", () => {
    const { ctx, stores } = context();
    storeReset(ctx);

    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL);
    const home = stores.find((s) => s.feat === FEAT.HOME);
    if (!general || !home) throw new Error("missing store");

    // The general store is stocked, within its slot cap.
    expect(general.stock.length).toBeGreaterThan(0);
    expect(general.stock.length).toBeLessThanOrEqual(general.stockSize);
    // Every stack is a real, positive quantity.
    for (const obj of general.stock) {
      expect(obj.number).toBeGreaterThan(0);
      expect(obj.kind).toBeTruthy();
    }
    // Home is never maintained.
    expect(home.stock.length).toBe(0);
  });

  it("marks every stocked item ASSESSED so mundane items show no {??}", () => {
    // store.c L1216-1219 / L1274-1276: store stock is created with
    // obj->known->notice |= OBJ_NOTICE_ASSESSED and player_know_object, i.e. the
    // player knows everything about it. The port keeps the assessed bit on the
    // live object, where objectKnownShadow reads it to fill combat/mod details.
    // Without it, a mundane enchanted item (e.g. "Broad Sword (+5,+4)") would
    // wrongly show a "{??}" not-fully-known marker in the store; only an ego item
    // with an unlearned rune should. This asserts the bit is set on all stock.
    const { ctx, stores } = context();
    storeReset(ctx);
    for (const store of stores) {
      if (store.feat === FEAT.HOME) continue;
      for (const obj of store.stock) {
        expect(
          obj.notice & OBJ_NOTICE.ASSESSED,
          `${obj.kind.name} in store ${store.feat} not ASSESSED`,
        ).toBe(OBJ_NOTICE.ASSESSED);
      }
    }
  });

  it("shows no {??} on mundane light/dig/thrown store stock (birth-known flags)", () => {
    // player-birth.c L597-602: player_outfit marks every LIGHT / DIG / THROW /
    // CURSE_ONLY subtype flag known at birth (they are non-rune "on wield"
    // flags). Without that a store torch (LIGHT_2), digger (DIG_1) or thrown
    // item (THROWING) would read as not-fully-known and show a spurious "{??}".
    // A birthed player must see them clean; only genuine unlearned runes flag.
    const players = bindPlayer({
      races: loadRecords("p_race"),
      classes: loadRecords("class"),
      properties: loadRecords("player_property"),
      timed: loadRecords("player_timed"),
      shapes: loadRecords("shape"),
      bodies: loadRecords("body"),
      history: loadRecords("history"),
      realms: loadRecords("realm"),
    });
    const race = players.raceByName("Human")!;
    const p = blankPlayer(race, players.classByName("Warrior")!, players.bodies[race.body]!);
    learnBirthObviousFlags(p.objKnown.flags, reg.properties);

    const rng = new Rng(1234);
    const env = makeRuneEnv(() => null, (v) => rng.randcalcVaries(v), {
      brands: reg.brands, slays: reg.slays, curses: reg.curses,
      properties: reg.properties, elementNames: ["acid", "lightning", "fire", "frost"],
      msg: () => {},
    });
    const deps = { isAware: () => true, isTried: () => false };
    const { ctx, stores } = context();
    storeReset(ctx);
    const gen = stores.find((s) => s.feat === FEAT.STORE_GENERAL)!;
    const mode = ODESC.PREFIX | ODESC.FULL | ODESC.STORE;
    for (const obj of gen.stock) {
      // Mundane stock (no ego, no brands/slays, no non-flag runes) must be clean.
      if (obj.ego || obj.brands || obj.slays) continue;
      const name = objectDesc(obj, mode, p, env, deps);
      expect(name, `${obj.kind.name} should not show {??}`).not.toContain("{??}");
    }
  });

  it("always carries its staples at a full stack", () => {
    const { ctx, stores } = context();
    storeReset(ctx);

    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL);
    if (!general) throw new Error("no general store");

    for (const staple of general.alwaysTable) {
      const held = general.stock.find((o) => o.kind === staple);
      expect(held, `staple ${staple.name} missing`).toBeTruthy();
      expect(held?.number).toBe(staple.base.maxStack);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = context();
    storeReset(a.ctx);
    const b = context();
    storeReset(b.ctx);

    const countsA = a.stores.map((s) => s.stock.length);
    const countsB = b.stores.map((s) => s.stock.length);
    expect(countsA).toEqual(countsB);
  });
});

function makeKind(tval: number): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(7), reg, constants, kind, 0, "minimise");
}

/**
 * object_flag_is_known for a player who has learned nothing. Every existing case
 * below is about tvals and value, not flags, so they all take this; the
 * buy-flag cases at the bottom of the block supply their own.
 */
const NO_FLAGS_KNOWN = (): boolean => false;

describe("store_will_buy (store.c)", () => {
  const home = storeReg.byFeat(FEAT.HOME);
  const weapon = storeReg.byFeat(FEAT.STORE_WEAPON);
  const black = storeReg.byFeat(FEAT.STORE_BLACK);
  if (!home || !weapon || !black) throw new Error("missing store");

  it("home accepts anything, even a worthless item", () => {
    const potion = makeKind(TV.POTION);
    potion.kind = { ...potion.kind, cost: 0 };
    expect(storeWillBuy(reg, home, potion, true, false, false, NO_FLAGS_KNOWN)).toBe(true);
  });

  it("the black market (no buy list) buys any item of positive value", () => {
    const sword = makeKind(TV.SWORD);
    expect(black.buy).toBeNull();
    expect(storeWillBuy(reg, black, sword, false, false, false, NO_FLAGS_KNOWN)).toBe(true);
  });

  it("a listed store buys tvals on its list and refuses others", () => {
    const sword = makeKind(TV.SWORD);
    const potion = makeKind(TV.POTION);
    const buysSword = (weapon.buy ?? []).some((b) => b.tval === TV.SWORD);
    expect(buysSword).toBe(true);
    expect(storeWillBuy(reg, weapon, sword, false, false, false, NO_FLAGS_KNOWN)).toBe(true);
    // Potions are not on the weaponsmith's buy list.
    expect(storeWillBuy(reg, weapon, potion, false, false, false, NO_FLAGS_KNOWN)).toBe(false);
  });

  it("refuses an apparently worthless item at a normal store", () => {
    const general = storeReg.byFeat(FEAT.STORE_GENERAL);
    if (!general) throw new Error("no general store");
    const potion = makeKind(TV.POTION);
    potion.kind = { ...potion.kind, cost: 0 };
    // aware flavored + cost 0 -> object_value 0 -> worthless.
    expect(storeWillBuy(reg, general, potion, true, false, false, NO_FLAGS_KNOWN)).toBe(false);
  });

  /*
   * PORT_TODO 2.10 / 5.8: the buy-list flag branch (store.c L549-551).
   *
   * Upstream requires BOTH conjuncts - the object has the flag AND the player
   * knows it has the flag - and the port shipped only the first, with
   * object_flag_is_known commented out. A store would therefore buy on a rune
   * the player had never learned.
   *
   * No shipped 4.2.6 store reaches this: every `buy:` line in
   * lib/gamedata/store.txt is a bare tval, and `buy-flag:` appears only in that
   * file's format comment. The store here is built with a flag entry on purpose,
   * because the branch is reachable through mod data and "the shipped data does
   * not reach it" is not a statement about the code.
   */
  describe("the buy-list flag branch requires BOTH conjuncts", () => {
    /**
     * A weaponsmith rewritten to buy swords only if they are known to grant free
     * action. store_will_buy reads exactly `feat` and `buy`, so this is the whole
     * store as far as the function is concerned.
     */
    function fussyStore(): { feat: number; buy: ObjectBuy[] } {
      return { feat: weapon!.feat, buy: [{ tval: TV.SWORD, flag: OF.FREE_ACT }] };
    }

    it("refuses a sword whose free action the player has not learned", () => {
      const sword = makeKind(TV.SWORD);
      sword.flags.on(OF.FREE_ACT);
      expect(sword.flags.has(OF.FREE_ACT)).toBe(true); // fixture is non-vacuous
      expect(
        storeWillBuy(reg, fussyStore(), sword, false, false, false, NO_FLAGS_KNOWN),
      ).toBe(false);
    });

    it("buys the same sword once the free action is known", () => {
      const sword = makeKind(TV.SWORD);
      sword.flags.on(OF.FREE_ACT);
      expect(
        storeWillBuy(reg, fussyStore(), sword, false, false, false, (f) => f === OF.FREE_ACT),
      ).toBe(true);
    });

    it("refuses a sword that does not have the flag, however much is known", () => {
      const sword = makeKind(TV.SWORD);
      expect(sword.flags.has(OF.FREE_ACT)).toBe(false);
      expect(storeWillBuy(reg, fussyStore(), sword, false, false, false, () => true)).toBe(
        false,
      );
    });
  });
});

/**
 * store_update over the accrued days (store.c:1422-1464), PORT_TODO 5.9.
 *
 * The function was written and had no test. The row that tracked the gap said
 * there was no `daycount` anywhere in the port, which is how a built-and-unrun
 * feature reaches a work list - so these run it, at zero days and at several.
 */
describe("store_update: the days spent in the dungeon (store.c:1422)", () => {
  /** A snapshot that changes when the stock changes: kind + count per slot. */
  function stockOf(stores: Store[]): string {
    return stores
      .filter((s) => s.feat !== FEAT.HOME)
      .map((s) => s.stock.map((o) => `${o.kind.kidx}x${o.number}`).join(","))
      .join("|");
  }

  it("does nothing at all for zero days, and draws no RNG", () => {
    const { ctx, stores } = context();
    storeReset(ctx);
    const before = stockOf(stores);
    const rngBefore = ctx.rng.getState();

    storeUpdate(ctx, 0);

    expect(stockOf(stores)).toBe(before);
    /* `while (daycount--)` never enters its body, so not one draw happens -
     * which is what makes a town-to-town move free of stream drift. */
    expect(ctx.rng.getState()).toEqual(rngBefore);
  });

  it("turns the stock over across several days, and leaves the home alone", () => {
    const { ctx, stores } = context();
    storeReset(ctx);
    const home = stores.find((s) => s.feat === FEAT.HOME);
    if (!home) throw new Error("missing home");
    /* Put something in the home so "untouched" is a claim with a value behind
     * it rather than "still empty" - and hold the OBJECT, not the count:
     * store_maint replaces stock, and a replacement that happens to leave one
     * item would satisfy a length assertion. */
    const stashed = objectPrep(new Rng(3), reg, constants, reg.kinds[1]!, 0, "average");
    home.stock = [stashed];
    const before = stockOf(stores);

    storeUpdate(ctx, 5);

    expect(stockOf(stores), "five days of maintenance move the stock").not.toBe(
      before,
    );
    expect(home.stock, "the home is never maintained").toEqual([stashed]);
  });

  it("more days move the stock further than fewer", () => {
    /*
     * The control that makes the test above mean something. One day already
     * changes the snapshot, so "changed" alone would pass a mutant that
     * ignored the count and maintained once. Two runs from the SAME seed,
     * differing only in the day count, must diverge.
     */
    const one = context();
    storeReset(one.ctx);
    const many = context();
    storeReset(many.ctx);
    expect(stockOf(one.stores)).toBe(stockOf(many.stores));

    storeUpdate(one.ctx, 1);
    storeUpdate(many.ctx, 6);
    expect(stockOf(one.stores)).not.toBe(stockOf(many.stores));
  });
});

/**
 * The store-behaviour registry, against the real pack.
 *
 * Reach is proven from disk in `packages/web/src/mod-code.node.test.ts`; these
 * are the tests that a registered handler actually DECIDES - that overriding it
 * changes what a shop buys and what it stocks, rather than merely sitting in a
 * map nothing consults.
 */
describe("store behaviour registry (store_will_buy / mass_produce)", () => {
  function seeded(): StoreBehaviourRegistry {
    const b = new StoreBehaviourRegistry();
    registerCoreStoreBehaviour(b);
    return b;
  }

  it("core's rules are in the registry, not hardcoded around it", () => {
    const b = seeded();
    expect(b.willBuyFor(ANY_STORE)).not.toBeNull();
    /* Every tval the switch used to name, and no more. */
    expect(b.massProduceTvals().length).toBe(27);
    expect(b.massProduceFor(TV.POTION)).not.toBeNull();
    expect(b.massProduceFor(TV.RING)).toBeNull();
  });

  it("a per-store override decides the sale, and only for that store", () => {
    const b = seeded();
    const general = { feat: FEAT.STORE_GENERAL, buy: null };
    const alchemy = { feat: FEAT.STORE_ALCHEMY, buy: null };
    const sword = makeKind(TV.SWORD);

    /* Core: a general store with no buy list buys anything of value. */
    expect(
      storeWillBuy(reg, general, sword, false, false, false, NO_FLAGS_KNOWN, b),
    ).toBe(true);

    b.registerWillBuy(FEAT.STORE_GENERAL, () => false);
    expect(
      storeWillBuy(reg, general, sword, false, false, false, NO_FLAGS_KNOWN, b),
    ).toBe(false);
    /* The other shop is untouched: the key really is per store. */
    expect(
      storeWillBuy(reg, alchemy, sword, false, false, false, NO_FLAGS_KNOWN, b),
    ).toBe(true);
  });

  it("wraps core's buy rule instead of reimplementing it", () => {
    const b = seeded();
    const core = b.willBuyFor(ANY_STORE);
    expect(core).not.toBeNull();
    let asked = 0;
    b.registerWillBuy(ANY_STORE, (ctx) => {
      asked += 1;
      /* Refuse swords, defer everything else to 4.2.6's own rule. */
      return ctx.obj.tval === TV.SWORD ? false : core!(ctx);
    });
    const store = { feat: FEAT.STORE_GENERAL, buy: null };
    expect(
      storeWillBuy(reg, store, makeKind(TV.SWORD), false, false, false, NO_FLAGS_KNOWN, b),
    ).toBe(false);
    expect(
      storeWillBuy(reg, store, makeKind(TV.POTION), true, false, false, NO_FLAGS_KNOWN, b),
    ).toBe(true);
    expect(asked).toBe(2);
  });

  it("a stack rule a mod installs sizes the object for real", () => {
    const b = seeded();
    const potion = makeKind(TV.POTION);
    b.registerMassProduce(TV.POTION, () => 7);
    massProduce(reg, new Rng(1), potion, b);
    expect(potion.number).toBe(7);
  });

  it("the maxStack clamp stays core's, so a mod cannot break a pile", () => {
    const b = seeded();
    const potion = makeKind(TV.POTION);
    b.registerMassProduce(TV.POTION, () => 99999);
    massProduce(reg, new Rng(1), potion, b);
    expect(potion.number).toBe(potion.kind.base.maxStack);
  });

  it("an unregistered tval leaves the stack at 1, as the switch default did", () => {
    const b = seeded();
    const ring = makeKind(TV.RING);
    massProduce(reg, new Rng(1), ring, b);
    expect(ring.number).toBe(1);
  });

  /**
   * "Nobody decides" must not read as "every shop buys anything". An emptied
   * registry is a broken host, and a permissive default would turn that into a
   * silent economy change rather than an obvious refusal.
   */
  it("refuses rather than becoming permissive when no rule is installed", () => {
    const empty = new StoreBehaviourRegistry();
    expect(
      storeWillBuy(
        reg,
        { feat: FEAT.HOME, buy: null },
        makeKind(TV.POTION),
        true,
        false,
        false,
        NO_FLAGS_KNOWN,
        empty,
      ),
    ).toBe(false);
  });
});
