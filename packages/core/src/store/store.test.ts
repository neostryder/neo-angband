import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FEAT } from "../generated";
import { ObjRegistry } from "../obj/bind";
import { ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import type { ObjPackJson } from "../obj/types";
import { Rng } from "../rng";
import { StoreRegistry } from "./bind";
import { bindStoreRuntime, storeReset } from "./store";
import type { Store, StoreMaintContext } from "./store";
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
  };
  const stores = freshStores(rng);
  return { ctx: { rng, deps, maxDepth: 0, stores }, stores };
}

describe("store maintenance (store.c store_reset/store_maint)", () => {
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
