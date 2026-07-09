import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FEAT, TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import type { ObjPackJson } from "../obj/types";
import { Rng } from "../rng";
import { priceItem } from "./price";

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
});
