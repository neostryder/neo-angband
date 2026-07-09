import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { StoreRegistry } from "./bind";
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
const storeRecords = loadRecords<StoreRecordJson>("store");
const stores = new StoreRegistry(storeRecords, reg);

describe("StoreRegistry (store.c parsing / store_at)", () => {
  it("binds all eight 4.2.6 stores", () => {
    expect(stores.stores.length).toBe(8);
    expect(stores.byName("STORE_GENERAL")).not.toBeNull();
    expect(stores.byName("HOME")).not.toBeNull();
  });

  it("binds the general store faithfully", () => {
    const gen = stores.byName("STORE_GENERAL")!;
    expect(gen.feat).toBe(FEAT.STORE_GENERAL);

    // Four owners, in order, Bilbo first with a 5000 purse.
    expect(gen.owners.length).toBe(4);
    expect(gen.owners[0]!.index).toBe(0);
    expect(gen.owners[0]!.name).toBe("Bilbo the Friendly (Hobbit)");
    expect(gen.owners[0]!.maxCost).toBe(5000);

    // Always stocks nine specific kinds; the Wooden Torch is one of them.
    expect(gen.alwaysTable.length).toBe(9);
    const torch = gen.alwaysTable.find((k) => k.tval === TV.LIGHT);
    expect(torch?.name).toContain("Torch");
    // No deferred book expansion for the general store.
    expect(gen.alwaysBookTvals.length).toBe(0);

    // Six normal-table kinds, buy list of nine tvals, turnover/slots as data.
    expect(gen.normalTable.length).toBe(6);
    expect(gen.buy).not.toBeNull();
    expect(gen.buy!.length).toBe(9);
    expect(gen.buy!.map((b) => b.tval)).toContain(TV.LIGHT);
    expect(gen.buy!.every((b) => b.flag === 0)).toBe(true);
    expect(gen.turnover).toBe(2);
    expect(gen.normalStockMin).toBe(0);
    expect(gen.normalStockMax).toBe(4);
  });

  it("defers the bookseller's town-book always lines to store_init", () => {
    const book = stores.byName("STORE_BOOK")!;
    expect(book.feat).toBe(FEAT.STORE_BOOK);
    // Its four `always: <book tval>` lines have no sval: captured as tvals for
    // later town-book expansion, none resolved into alwaysTable yet.
    expect(book.alwaysBookTvals.length).toBe(4);
    expect(book.alwaysBookTvals.every((t) => t >= 0)).toBe(true);
    expect(book.alwaysTable.length).toBe(0);
  });

  it("binds the black market with no fixed tables and no buy list", () => {
    const black = stores.byName("STORE_BLACK")!;
    expect(black.feat).toBe(FEAT.STORE_BLACK);
    expect(black.alwaysTable.length).toBe(0);
    expect(black.normalTable.length).toBe(0);
    // No buy list means "buys anything" (store_will_buy).
    expect(black.buy).toBeNull();
    expect(black.normalStockMax).toBe(18);
  });

  it("binds the home as storage (placeholder owners, no stock or buy)", () => {
    const home = stores.byName("HOME")!;
    expect(home.feat).toBe(FEAT.HOME);
    expect(home.owners[0]!.name).toBe("Your home");
    expect(home.owners[0]!.maxCost).toBe(0);
    expect(home.alwaysTable.length).toBe(0);
    expect(home.normalTable.length).toBe(0);
    expect(home.buy).toBeNull();
  });

  it("store_at: looks a store up by entrance feature", () => {
    expect(stores.byFeat(FEAT.STORE_MAGIC)?.featName).toBe("STORE_MAGIC");
    expect(stores.byFeat(FEAT.FLOOR)).toBeNull();
  });
});
