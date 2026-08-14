import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import { ObjRegistry } from "./bind.js";
import { applyCurseAttributes, modifyWeightForCurse } from "./object.js";
import { objectPower } from "./power.js";
import { resetTvalRegistry, tvalRegistry } from "./tval-registry.js";
import type { PowerObject } from "./power.js";
import type { Curse, CurseObject, ObjPackJson } from "./types.js";
import {
  ELEM_MAX,
  newElemInfo,
  newKfFlags,
  newOfFlags,
  OBJ_MOD_MAX,
  zeroRv,
} from "./types.js";

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

/** A tval beyond everything core defines - a mod's own. */
const MOD_TVAL = 200;

describe("bow_multiplier reaches a MOD's launcher class", () => {
  afterEach(() => {
    resetTvalRegistry();
  });

  /* WHAT THIS PROVES. `bowMultiplier` read `obj.tval !== TV.BOW` while this
   * file's own header (L20-24) already documented the check as
   * `tvalIsLauncher` - the comment was right and the code was the bug. A mod
   * launcher therefore scored multiplier 1 no matter its pval, so it was
   * undervalued in every shop and mis-weighted in randart balance.
   *
   * THE LEVER IS `pval`, and that is what makes this a proof of ONE site
   * rather than of the widening in general. `obj.pval` is read in exactly one
   * place in power.ts - inside `bowMultiplier` - so two objects that differ
   * only in pval can differ in power only through that site. `tvalIsLauncher`
   * is consulted five times in this module, and the other four are held
   * constant by construction: `toDamagePower`'s second lot and
   * `damageDicePower`'s non-weapon boost depend on toD/brands/slays/blows,
   * which are identical here, `ammoDamagePower` returns 0 because the kind
   * carries no KF_SHOOTS_* flag, and `rescaleBowPower` divides both sides
   * alike. */
  it("ignores pval on a mod launcher before the widening, and reads it after", () => {
    const weak = blankPower(MOD_TVAL);
    weak.toD = 4;
    weak.pval = 2;
    const strong = blankPower(MOD_TVAL);
    strong.toD = 4;
    strong.pval = 5;

    /* BEFORE: pval is dead weight, because bow_multiplier bailed to 1. */
    const beforeWeak = objectPower(reg, weak);
    const beforeStrong = objectPower(reg, strong);
    expect(beforeWeak).toBe(beforeStrong);

    const inner = tvalRegistry().classes.handlerFor("tvalIsLauncher")!;
    tvalRegistry().classes.set(
      "tvalIsLauncher",
      (tval) => tval === MOD_TVAL || inner(tval),
    );

    /* AFTER: the converted site answers yes, so the multiplier is the pval. */
    const afterWeak = objectPower(reg, weak);
    const afterStrong = objectPower(reg, strong);
    expect(afterStrong).toBeGreaterThan(afterWeak);

    /* And the numbers, spelled out, so a change that merely PERTURBS power
     * cannot pass as this one. to_damage_power = 4*5/2 = 10 with no non-weapon
     * second lot (it is a launcher now); damage dice 0; extra_might multiplies
     * by the pval; rescale_bow_power divides by MAX_BLOWS (5). */
    expect({ weak: afterWeak, strong: afterStrong }).toEqual({
      weak: 4,
      strong: 10,
    });

    /* Core's own bow is untouched by the wrapping. */
    const bow = blankPower(TV.BOW);
    bow.toD = 4;
    bow.pval = 2;
    expect(objectPower(reg, bow)).toBe(4);
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
