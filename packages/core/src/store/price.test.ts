import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { FEAT, TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { ObjPackJson } from "../obj/types.js";
import { Rng } from "../rng.js";
import { priceItem } from "./price.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
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

/** A clean 1d4 melee weapon: object_power 6, object_value_real 66. */
function cleanWeapon(): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === TV.SWORD && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error("no sword kind");
  const obj = objectPrep(new Rng(1), reg, constants, kind, 0, "minimise");
  obj.dd = 1;
  obj.ds = 4;
  obj.toH = 0;
  obj.toD = 0;
  obj.toA = 0;
  obj.ac = 0;
  obj.weight = 100;
  obj.ego = null;
  obj.brands = null;
  obj.slays = null;
  obj.curses = null;
  obj.number = 1;
  obj.flags.wipe();
  for (const e of obj.elInfo) {
    e.resLevel = 0;
    e.flags = 0;
  }
  for (let i = 0; i < obj.modifiers.length; i++) obj.modifiers[i] = 0;
  return obj;
}

const GENERAL = { feat: FEAT.STORE_GENERAL };
const BLACK = { feat: FEAT.STORE_BLACK };
const OWNER = { maxCost: 30000 };

describe("price_item (store.c)", () => {
  it("sells a weapon to the player at its full value", () => {
    // real value 66; sell price = (66*100+50)/100 = 66.
    const obj = cleanWeapon();
    expect(priceItem(reg, GENERAL, OWNER, obj, false, 1, true, false)).toBe(66);
  });

  it("buys a weapon from the player at 2/3 of value", () => {
    // floor(66*2/3) = 44; (44*100+50)/100 = 44.
    const obj = cleanWeapon();
    expect(priceItem(reg, GENERAL, OWNER, obj, true, 1, true, false)).toBe(44);
  });

  it("pays nothing when birth_no_selling is set", () => {
    const obj = cleanWeapon();
    expect(priceItem(reg, GENERAL, OWNER, obj, true, 1, true, true)).toBe(0);
  });

  it("charges the black-market surcharge when selling", () => {
    // sell: real 66 -> *2 (black) = 132; (132*150+50)/100 = 198.
    const obj = cleanWeapon();
    expect(priceItem(reg, BLACK, OWNER, obj, false, 1, true, false)).toBe(198);
  });

  it("caps a buy price at the owner's purse", () => {
    // Shop-buy price would be 44; a tiny purse caps it.
    const obj = cleanWeapon();
    const poor = { maxCost: 10 };
    expect(priceItem(reg, GENERAL, poor, obj, true, 1, true, false)).toBe(10);
  });

  /**
   * Pre-4.2.6 mass_produce wrote obj->discount; object_value applied it, and
   * 3.0.6's price_item called object_value for the shop-selling price the
   * player sees. 4.2.6 dropped discounts and rewrote price_item to re-price
   * sell-to-player with object_value_real alone. Core restored the field and
   * objectValue's cut, but the store listing path must still honour discount
   * or the feature-restoration mod's roll never changes what the player pays.
   */
  it("sells a discounted item cheaper (obj.discount, pre-4.2.6 mass_produce)", () => {
    const full = cleanWeapon();
    const cut = cleanWeapon();
    cut.discount = 50;
    const fullPrice = priceItem(reg, GENERAL, OWNER, full, false, 1, true, false);
    const cutPrice = priceItem(reg, GENERAL, OWNER, cut, false, 1, true, false);
    // real 66; 50% off -> 33; (33*100+50)/100 = 33.
    expect(fullPrice).toBe(66);
    expect(cutPrice).toBe(33);
  });
});
