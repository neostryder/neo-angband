import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FEAT, TV } from "../generated";
import { gearAdd, invenCarry, newGear, objectCopyAmt } from "../game/gear";
import type { Gear } from "../game/gear";
import { ObjRegistry } from "../obj/bind";
import { ArtifactState, ObjAllocState, objectPrep } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import type { GameObject, StackLimits } from "../obj/object";
import type { ObjPackJson } from "../obj/types";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { Rng } from "../rng";
import { StoreRegistry } from "./bind";
import { priceItem } from "./price";
import { bindStoreRuntime, storeReset } from "./store";
import type { Store, StoreMaintContext } from "./store";
import { homeRetrieve, homeStash, storeBuy, storeSell } from "./transact";
import type { StoreRecordJson } from "./types";

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

const limits: StackLimits = {
  quiverSlotSize: constants.quiverSlotSize,
  thrownQuiverMult: constants.thrownQuiverMult,
};

/** A fresh stocking context, a born Human Warrior, and an empty pack. */
function setup(): {
  ctx: StoreMaintContext;
  stores: Store[];
  player: Player;
  gear: Gear;
} {
  const rng = new Rng(1234);
  const deps: MakeDeps = {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts: false,
  };
  const stores = storeReg.stores.map((b) =>
    bindStoreRuntime(b, rng, constants.storeInvenMax),
  );
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  const body = players.bodies[race.body]!;
  const player = blankPlayer(race, cls, body);
  return { ctx: { rng, deps, maxDepth: 0, stores }, stores, player, gear: newGear() };
}

/** A fresh, minimised ordinary object of a tval. */
function makeObj(tval: number): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(7), reg, constants, kind, 0, "minimise");
}

const NO_SELL = { aware: true, noSelling: false };

describe("storeBuy (store.c do_cmd_buy)", () => {
  it("pays the marked price, pockets the item, and debits gold", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL)!;

    const item = general.stock[0]!;
    const expected = priceItem(
      reg,
      general,
      general.owner,
      objectCopyAmt(item, 1),
      false,
      1,
      true,
      false,
    );
    player.au = expected + 1000;
    const before = player.au;

    const res = storeBuy(ctx, general, item, 1, player, gear, NO_SELL);

    expect(res.ok).toBe(true);
    expect(res.price).toBe(expected);
    expect(player.au).toBe(before - expected);
    expect(gear.pack.length).toBe(1);
    expect(res.bought!.number).toBe(1);
  });

  it("refuses when the player cannot afford it (no gold spent)", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL)!;

    player.au = 0;
    const res = storeBuy(ctx, general, general.stock[0]!, 1, player, gear, NO_SELL);

    expect(res.ok).toBe(false);
    expect(res.failure).toBe("cannot-afford");
    expect(player.au).toBe(0);
    expect(gear.pack.length).toBe(0);
  });

  it("refuses when the pack has no room", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const general = stores.find((s) => s.feat === FEAT.STORE_GENERAL)!;
    const item = general.stock[0]!;

    /* Fill every pack slot with a kind that cannot stack with the item. */
    const fillTval = item.tval === TV.FOOD ? TV.POTION : TV.FOOD;
    for (let i = 0; i < constants.packSize; i++) {
      gear.pack.push(gearAdd(gear, makeObj(fillTval)));
    }

    player.au = 1_000_000;
    const res = storeBuy(ctx, general, item, 1, player, gear, NO_SELL);

    expect(res.ok).toBe(false);
    expect(res.failure).toBe("no-room");
    expect(player.au).toBe(1_000_000);
  });
});

describe("storeSell (store.c do_cmd_sell)", () => {
  it("sells a sword to the weaponsmith for gold and empties the pack slot", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const weapon = stores.find((s) => s.feat === FEAT.STORE_WEAPON)!;

    const handle = invenCarry(gear, makeObj(TV.SWORD), limits);
    player.au = 0;

    const res = storeSell(ctx, weapon, handle, 1, player, gear, NO_SELL);

    expect(res.ok).toBe(true);
    expect(res.price!).toBeGreaterThan(0);
    expect(player.au).toBe(res.price);
    expect(res.noneLeft).toBe(true);
    expect(gear.pack.length).toBe(0);
    /* The store now holds the sold sword. */
    expect(weapon.stock.some((o) => o.tval === TV.SWORD)).toBe(true);
  });

  it("refuses an item not on the store's buy list (item retained)", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const weapon = stores.find((s) => s.feat === FEAT.STORE_WEAPON)!;

    const handle = invenCarry(gear, makeObj(TV.POTION), limits);
    player.au = 42;

    const res = storeSell(ctx, weapon, handle, 1, player, gear, NO_SELL);

    expect(res.ok).toBe(false);
    expect(res.failure).toBe("refused");
    expect(player.au).toBe(42);
    expect(gear.pack.length).toBe(1);
  });

  it("under birth_no_selling gives the item away for zero gold", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const weapon = stores.find((s) => s.feat === FEAT.STORE_WEAPON)!;

    const handle = invenCarry(gear, makeObj(TV.SWORD), limits);
    player.au = 50;

    const res = storeSell(ctx, weapon, handle, 1, player, gear, {
      aware: true,
      noSelling: true,
    });

    expect(res.ok).toBe(true);
    expect(res.price).toBe(0);
    expect(player.au).toBe(50);
    /* The item still leaves the pack and lands in the store. */
    expect(gear.pack.length).toBe(0);
    expect(weapon.stock.some((o) => o.tval === TV.SWORD)).toBe(true);
  });
});

describe("home stash / retrieve (store.c do_cmd_stash / do_cmd_retrieve)", () => {
  it("round-trips an item through the home with no gold changing hands", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const home = stores.find((s) => s.feat === FEAT.HOME)!;

    const handle = invenCarry(gear, makeObj(TV.SWORD), limits);
    player.au = 100;

    const stash = homeStash(home, handle, 1, player, gear, constants);
    expect(stash.ok).toBe(true);
    expect(gear.pack.length).toBe(0);
    expect(home.stock.length).toBe(1);
    expect(player.au).toBe(100);

    const retrieve = homeRetrieve(home, home.stock[0]!, 1, gear, constants);
    expect(retrieve.ok).toBe(true);
    expect(retrieve.noneLeft).toBe(true);
    expect(gear.pack.length).toBe(1);
    expect(home.stock.length).toBe(0);
    expect(player.au).toBe(100);
  });

  it("home_carry merges compatible stacks", () => {
    const { ctx, stores, player, gear } = setup();
    storeReset(ctx);
    const home = stores.find((s) => s.feat === FEAT.HOME)!;

    const f1 = makeObj(TV.FOOD);
    f1.number = 2;
    homeStash(home, invenCarry(gear, f1, limits), 2, player, gear, constants);

    const f2 = makeObj(TV.FOOD);
    f2.number = 3;
    homeStash(home, invenCarry(gear, f2, limits), 3, player, gear, constants);

    expect(home.stock.length).toBe(1);
    expect(home.stock[0]!.number).toBe(5);
  });
});
