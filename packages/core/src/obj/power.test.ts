import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TV } from "../generated";
import { ObjRegistry } from "./bind";
import { applyCurseAttributes, modifyWeightForCurse } from "./object";
import { objectPower } from "./power";
import type { PowerObject } from "./power";
import type { Curse, CurseObject, ObjPackJson } from "./types";
import {
  ELEM_MAX,
  newElemInfo,
  newKfFlags,
  newOfFlags,
  OBJ_MOD_MAX,
  zeroRv,
} from "./types";

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

/** A blank PowerObject with the given tval; all bonuses/flags zeroed. */
function blankPower(tval: number): PowerObject {
  return {
    tval,
    toH: 0,
    toD: 0,
    toA: 0,
    ac: 0,
    dd: 0,
    ds: 0,
    weight: 0,
    pval: 0,
    modifiers: new Array<number>(OBJ_MOD_MAX).fill(0),
    brands: null,
    slays: null,
    flags: newOfFlags(),
    elInfo: newElemInfo(),
    curses: null,
    activation: null,
    kind: { power: 0, kindFlags: newKfFlags() },
    ego: null,
  };
}

describe("object_power (obj-power.c)", () => {
  it("rates a plain 1d4 melee weapon from its damage dice", () => {
    // damage_dice_power = dd*(ds+1)*DAMAGE_POWER/4 = 1*5*5/4 = 6; no other term.
    const sword = blankPower(TV.SWORD);
    sword.dd = 1;
    sword.ds = 4;
    sword.weight = 100;
    expect(objectPower(reg, sword)).toBe(6);
  });

  it("adds to_dam power for a melee weapon (no non-weapon second lot)", () => {
    // to_damage_power = to_d*5/2 = 10 (melee: no second lot); + dice 6 = 16.
    const sword = blankPower(TV.SWORD);
    sword.dd = 1;
    sword.ds = 4;
    sword.toD = 4;
    sword.weight = 100;
    expect(objectPower(reg, sword)).toBe(16);
  });

  it("rates a ring's +to_ac plus the flat jewelry bonus", () => {
    // to_ac_power = to_a*2/2 = 5; jewelry_power = +4; total 9.
    const ring = blankPower(TV.RING);
    ring.toA = 5;
    expect(objectPower(reg, ring)).toBe(9);
  });
});

/* ---- curse runtime (obj-curse.c) ---- */

/** A synthetic curse table [null, curse] with a single-purpose template. */
function synthCurses(obj: Partial<CurseObject>): (Curse | null)[] {
  const template: CurseObject = {
    weight: 0,
    toH: 0,
    toD: 0,
    toA: 0,
    flags: newOfFlags(),
    modifiers: new Array<number>(OBJ_MOD_MAX).fill(0),
    elInfo: newElemInfo(),
    effect: null,
    effectMsg: "",
    time: zeroRv(),
    ...obj,
  };
  const curse: Curse = {
    index: 1,
    name: "test curse",
    poss: [],
    obj: template,
    conflict: null,
    conflictFlags: newOfFlags(),
    desc: "",
  };
  return [null, curse];
}

describe("apply_curse_attributes (obj-curse.c)", () => {
  it("adds the curse's to_h/to_d/to_a into the object", () => {
    const curses = synthCurses({ toH: -3, toD: 2, toA: 1 });
    const obj = blankPower(TV.SWORD);
    obj.toH = 5;
    obj.toD = 5;
    obj.toA = 5;
    obj.curses = [{ power: 40, timeout: 0 }, { power: 40, timeout: 0 }];
    applyCurseAttributes(curses, -1, obj);
    expect(obj.toH).toBe(2);
    expect(obj.toD).toBe(7);
    expect(obj.toA).toBe(6);
  });

  it("nets a base resistance against a curse vulnerability to no resistance", () => {
    const el = newElemInfo();
    el[0]!.resLevel = -1; // curse is vulnerable to acid
    const curses = synthCurses({ elInfo: el });
    const obj = blankPower(TV.SOFT_ARMOR);
    obj.elInfo[0]!.resLevel = 1; // object resists acid
    obj.curses = [{ power: 40, timeout: 0 }, { power: 40, timeout: 0 }];
    applyCurseAttributes(curses, -1, obj);
    // resist + vulnerability nets to no resistance for the caller.
    expect(obj.elInfo[0]!.resLevel).toBe(0);
    // untouched elements stay zero.
    expect(obj.elInfo[ELEM_MAX - 1]!.resLevel).toBe(0);
  });

  it("skips the curse index requested (i)", () => {
    const curses = synthCurses({ toH: -3 });
    const obj = blankPower(TV.SWORD);
    obj.toH = 5;
    obj.curses = [{ power: 40, timeout: 0 }, { power: 40, timeout: 0 }];
    applyCurseAttributes(curses, 1, obj); // ignore curse 1
    expect(obj.toH).toBe(5);
  });
});

describe("modify_weight_for_curse (obj-curse.c)", () => {
  it("applies a flat additive weight delta", () => {
    const curses = synthCurses({ weight: 30 });
    expect(modifyWeightForCurse(curses, 1, 100)).toBe(130);
  });

  it("floors an additive reduction at zero", () => {
    const curses = synthCurses({ weight: -200 });
    expect(modifyWeightForCurse(curses, 1, 100)).toBe(0);
  });
});

describe("object_power curse recursion smoke test", () => {
  it("values an object carrying a real curse to a finite number", () => {
    if (reg.curses.length <= 1) return;
    const obj = blankPower(TV.SWORD);
    obj.dd = 1;
    obj.ds = 4;
    obj.weight = 100;
    obj.curses = reg.curses.map(() => ({ power: 0, timeout: 0 }));
    obj.curses[1] = { power: 100, timeout: 0 };
    const p = objectPower(reg, obj);
    expect(Number.isFinite(p)).toBe(true);
  });
});
