import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { ObjRegistry } from "./bind";
import { objectPrep } from "./make";
import type { ObjPackJson } from "./types";
import { objectValueBase, objectValueReal } from "./value";
import { Rng } from "../rng";

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

function firstOrdinaryKind(tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no ordinary kind for tval ${tval}`);
  return k;
}

function make(tval: number) {
  return objectPrep(new Rng(1), reg, constants, firstOrdinaryKind(tval), 0, "minimise");
}

describe("object_value_real (obj-power.c constant-price path)", () => {
  it("prices a constant-price item at kind.cost * qty", () => {
    const potion = make(TV.POTION);
    expect(objectValueReal(potion, 1)).toBe(potion.kind.cost);
    expect(objectValueReal(potion, 3)).toBe(potion.kind.cost * 3);
  });

  it("adds a per-charge premium for wands and staves", () => {
    const wand = make(TV.WAND);
    wand.pval = 10;
    wand.number = 1;
    const cost = wand.kind.cost;
    // total = cost*qty + floor(cost * charges / 20); charges = pval = 10.
    expect(objectValueReal(wand, 1)).toBe(cost + Math.floor((cost * 10) / 20));
  });

  it("returns 0 for a worthless (costless) kind", () => {
    const potion = make(TV.POTION);
    potion.kind = { ...potion.kind, cost: 0 };
    expect(objectValueReal(potion, 5)).toBe(0);
  });

  it("throws for variable-power items (object_power not yet ported)", () => {
    const sword = make(TV.SWORD);
    expect(() => objectValueReal(sword, 1)).toThrow(/object_power/);
  });
});

describe("object_value_base (obj-power.c)", () => {
  it("uses a flat per-tval estimate when the flavor is not aware", () => {
    expect(objectValueBase(make(TV.POTION), false)).toBe(20);
    expect(objectValueBase(make(TV.SCROLL), false)).toBe(20);
    expect(objectValueBase(make(TV.STAFF), false)).toBe(70);
  });

  it("uses the kind cost when the flavor is aware", () => {
    const potion = make(TV.POTION);
    expect(objectValueBase(potion, true)).toBe(potion.kind.cost);
  });
});
