/**
 * PORT_TODO 5.9: the shops age while the player is in the dungeon, and the
 * days are spent on the way back into town.
 *
 * The pieces each have unit tests now - the accumulator in game/loop.test.ts,
 * store_update in store/store.test.ts - and neither would notice if the return
 * to town stopped calling it. This drives a real game down and back up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createModRegistryHost } from "../mod/registry-host.js";
import { FEAT } from "../generated/index.js";
import { priceItem } from "../store/price.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import type { GameState } from "../game/context.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  store: loadRecords("store"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
} as GamePack;

/** kind + count per non-home slot: changes exactly when the stock changes. */
function stockOf(state: GameState): string {
  return (state.stores ?? [])
    .filter((s) => s.feat !== FEAT.HOME)
    .map((s) => s.stock.map((o) => `${o.kind.kidx}x${o.number}`).join(","))
    .join("|");
}

describe("the return to town spends the accrued days (store.c:1422)", () => {
  it("changes the stock and zeroes daycount; a zero-day return does not", () => {
    const game = startGame(pack, { seed: 21, depth: 0 });
    const state = game.state;
    expect(state.stores, "fixture: the pack ships stores").toBeDefined();
    expect(stockOf(state), "fixture: the shops are stocked").not.toBe("");

    /* Down, then straight back up with no days accrued: the shops must be
     * exactly as they were. This is the control - without it, "the stock
     * changed" could just mean a town entry always restocks. */
    game.changeLevel(1);
    const before = stockOf(state);
    game.changeLevel(0);
    expect(stockOf(state), "no days away, no change").toBe(before);

    /* Down again, four store-days pass, and back up. */
    game.changeLevel(1);
    state.daycount = 4;
    game.changeLevel(0);

    expect(state.daycount, "store.c:1462 zeroes it after the update").toBe(0);
    expect(stockOf(state), "four days of maintenance moved the stock").not.toBe(
      before,
    );
  });
});

describe("fresh-town store behaviour registered by a plugin", () => {
  it("resolves a registered discount into the real initial stock and listing price", () => {
    const game = startGame(pack, { seed: 21, depth: 0 });
    const { state } = game;
    const behaviour = state.storeBehaviour;
    const stores = state.stores;
    expect(behaviour, "wireGame creates the live store registry").toBeDefined();
    expect(stores, "fixture: a town game has store stock").toBeDefined();
    if (!behaviour || !stores) throw new Error("missing store behaviour fixture");

    const stock = stores.flatMap((store) => store.stock);
    expect(stock.some((obj) => obj.discount !== undefined)).toBe(false);

    /* This is the same live facade a folder plugin receives after game boot.
     * The forced result is the #139 pattern, making both discount mutations
     * observable without depending on a probabilistic roll. */
    let rolls = 0;
    const host = createModRegistryHost(
      { stores: behaviour },
      { has: (capability: string): boolean => capability === "registry:store" },
    );
    const featureRestorationStylePlugin = {
      register(): void {
        host.stores.setDiscountRoll(() => {
          rolls++;
          return 50;
        });
      },
    };
    featureRestorationStylePlugin.register();
    expect(behaviour.discountRollHandler()).toBeTypeOf("function");

    /* main.ts resolves this one deferred batch immediately after plugin
     * registration. It is the real town stock that startGame created, not an
     * isolated massProduce object. */
    game.resolveInitialStoreDiscounts();
    const refreshedStores = state.stores ?? [];
    const discounted = refreshedStores.flatMap((store) => store.stock).filter((obj) => obj.discount === 50);
    expect(rolls).toBeGreaterThan(0);
    expect(discounted.length).toBeGreaterThan(0);

    const obj = discounted.find((candidate) => candidate.number > 1);
    expect(obj, "fixture: a mass-produced stack has more than one item").toBeDefined();
    if (!obj) throw new Error("missing stack fixture");
    expect(obj.number).toBeLessThanOrEqual(Math.trunc(obj.kind.base.maxStack / 2));

    const store = refreshedStores.find((candidate) => candidate.stock.includes(obj));
    expect(store, "discounted item remains in its real store").toBeDefined();
    if (!store) throw new Error("missing discounted item store");
    const discountedPrice = priceItem(
      game.booted.registries.objects,
      store,
      store.owner,
      obj,
      false,
      1,
      true,
      false,
    );
    delete obj.discount;
    const fullPrice = priceItem(
      game.booted.registries.objects,
      store,
      store.owner,
      obj,
      false,
      1,
      true,
      false,
    );
    obj.discount = 50;
    expect(discountedPrice).toBe(fullPrice - Math.trunc((fullPrice * 50) / 100));

    /* The handler stays on the same live registry for ordinary later store
     * maintenance, rather than being a one-off initial-stock substitute. */
    const initialRolls = rolls;
    game.changeLevel(1);
    state.daycount = 4;
    game.changeLevel(0);
    expect(rolls).toBeGreaterThan(initialRolls);
  });
});
