import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { ELEM, OF, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { objectPrep } from "./make";
import {
  appendObjectCurse,
  buildCurseTimedFoil,
  objectCopy,
  objectPackTotal,
} from "./object";
import type { GameObject, PackTotalGear } from "./object";

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

/** A prepped ordinary object of the first kind with the given tval. */
function makeObj(tval: number): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(7), reg, constants, kind, 0, "average");
}

describe("object_copy (obj-pile.c L713)", () => {
  it("returns a value-equal but independent copy that shares the kind pointer", () => {
    const src = makeObj(reg.kinds[reg.ordinaryKindCount - 1]!.tval);
    src.grid = loc(3, 4);
    src.number = 2;
    src.pval = 5;
    src.brands = [false, true, false];
    src.slays = [false, false, true];
    src.curses = [
      { power: 0, timeout: 0 },
      { power: 10, timeout: 3 },
    ];
    src.flags.on(OF.SEE_INVIS);

    const copy = objectCopy(src);

    /* Same content-registry pointers (memcpy'd pointers upstream). */
    expect(copy.kind).toBe(src.kind);
    expect(copy.effect).toBe(src.effect);
    /* Value-equal per-instance fields. */
    expect(copy.number).toBe(2);
    expect(copy.pval).toBe(5);
    expect(copy.grid).toEqual(loc(3, 4));
    expect(copy.brands).toEqual(src.brands);
    expect(copy.slays).toEqual(src.slays);
    expect(copy.curses).toEqual(src.curses);
    expect(copy.flags.isEqual(src.flags)).toBe(true);
  });

  it("deep-copies the per-instance arrays so mutating the source never bleeds", () => {
    const src = makeObj(reg.kinds[reg.ordinaryKindCount - 1]!.tval);
    src.brands = [false, true];
    src.slays = [false, true];
    src.curses = [{ power: 1, timeout: 2 }];
    src.grid = loc(1, 1);

    const copy = objectCopy(src);

    /* Distinct array/loc/flag references. */
    expect(copy.brands).not.toBe(src.brands);
    expect(copy.slays).not.toBe(src.slays);
    expect(copy.curses).not.toBe(src.curses);
    expect(copy.modifiers).not.toBe(src.modifiers);
    expect(copy.elInfo).not.toBe(src.elInfo);
    expect(copy.flags).not.toBe(src.flags);
    expect(copy.grid).not.toBe(src.grid);

    /* Mutate the source in place; the copy is untouched. */
    src.brands[1] = false;
    src.slays[1] = false;
    src.curses[0]!.power = 99;
    src.modifiers[0] = 42;
    (src.grid as { x: number }).x = 9;
    src.flags.on(OF.SEE_INVIS);

    expect(copy.brands).toEqual([false, true]);
    expect(copy.slays).toEqual([false, true]);
    expect(copy.curses).toEqual([{ power: 1, timeout: 2 }]);
    expect(copy.modifiers[0]).toBe(0);
    expect(copy.grid).toEqual(loc(1, 1));
    expect(copy.flags.has(OF.SEE_INVIS)).toBe(false);
  });

  it("copies null slay/brand/curse arrays as null and draws no RNG", () => {
    const src = makeObj(reg.kinds[reg.ordinaryKindCount - 1]!.tval);
    src.brands = null;
    src.slays = null;
    src.curses = null;
    src.grid = null;

    const rng = new Rng(1);
    const before = rng.getState();
    const copy = objectCopy(src);
    expect(rng.getState()).toEqual(before);

    expect(copy.brands).toBeNull();
    expect(copy.slays).toBeNull();
    expect(copy.curses).toBeNull();
    expect(copy.grid).toBeNull();
  });
});

describe("append_object_curse TIMED_INC foil (obj-curse.c L159-188)", () => {
  const poisonIdx = reg.curses.findIndex((c) => c?.name === "poison");
  const paralysisIdx = reg.curses.findIndex((c) => c?.name === "paralysis");
  /* The live failure tables from player_timed.txt: POISONED fails against
   * RES_POIS (code 2) and the OPP_POIS timed effect (code 5, NOT consulted by
   * the curse check); PARALYZED fails against OF_FREE_ACT (code 1). */
  const foil = buildCurseTimedFoil([
    {
      name: "POISONED",
      fail: [
        { code: 2, flag: "POIS" },
        { code: 5, flag: "OPP_POIS" },
      ],
    },
    { name: "PARALYZED", fail: [{ code: 1, flag: "FREE_ACT" }] },
  ]);

  it("has both curses in the pack", () => {
    expect(poisonIdx).toBeGreaterThan(0);
    expect(paralysisIdx).toBeGreaterThan(0);
  });

  it("rejects the poison curse on a poison-resisting object (TMD_FAIL_FLAG_RESIST)", () => {
    const obj = makeObj(TV.SOFT_ARMOR);
    obj.elInfo[ELEM.POIS]!.resLevel = 1;
    expect(
      appendObjectCurse(new Rng(3), obj, poisonIdx, 20, reg.curses, foil),
    ).toBe(false);
    /* check_object_curses freed the all-zero curse array (L170). */
    expect(obj.curses).toBeNull();
  });

  it("attaches the poison curse when the resist is absent (fail code 5 ignored)", () => {
    const obj = makeObj(TV.SOFT_ARMOR);
    expect(
      appendObjectCurse(new Rng(3), obj, poisonIdx, 20, reg.curses, foil),
    ).toBe(true);
    expect(obj.curses?.[poisonIdx]?.power).toBe(20);
  });

  it("without the foil tables the old (pre-gap-3.2) accept behaviour holds", () => {
    const obj = makeObj(TV.SOFT_ARMOR);
    obj.elInfo[ELEM.POIS]!.resLevel = 1;
    expect(
      appendObjectCurse(new Rng(3), obj, poisonIdx, 20, reg.curses),
    ).toBe(true);
  });

  it("rejects the paralysis curse on a free-action object (TMD_FAIL_FLAG_OBJECT)", () => {
    const obj = makeObj(TV.SOFT_ARMOR);
    obj.flags.on(OF.FREE_ACT);
    expect(
      appendObjectCurse(new Rng(3), obj, paralysisIdx, 20, reg.curses, foil),
    ).toBe(false);
    expect(obj.curses).toBeNull();
  });

  it("rejects via TMD_FAIL_FLAG_VULN when the object is vulnerable (L179-185)", () => {
    const vulnFoil = buildCurseTimedFoil([
      { name: "POISONED", fail: [{ code: 3, flag: "POIS" }] },
    ]);
    const obj = makeObj(TV.SOFT_ARMOR);
    obj.elInfo[ELEM.POIS]!.resLevel = -1;
    expect(
      appendObjectCurse(new Rng(3), obj, poisonIdx, 20, reg.curses, vulnFoil),
    ).toBe(false);
    /* Not vulnerable: the same foil lets it through. */
    const ok = makeObj(TV.SOFT_ARMOR);
    expect(
      appendObjectCurse(new Rng(3), ok, poisonIdx, 20, reg.curses, vulnFoil),
    ).toBe(true);
  });

  it("keeps existing curses when the new pick is foiled", () => {
    const obj = makeObj(TV.SOFT_ARMOR);
    expect(
      appendObjectCurse(new Rng(3), obj, paralysisIdx, 15, reg.curses, foil),
    ).toBe(true);
    obj.flags.on(OF.FREE_ACT); /* now foils further paralysis picks */
    expect(
      appendObjectCurse(new Rng(3), obj, paralysisIdx, 30, reg.curses, foil),
    ).toBe(false);
    expect(obj.curses?.[paralysisIdx]?.power).toBe(15);
  });
});

describe("object_pack_total (obj-gear.c L189)", () => {
  /** A gear view over `objs` with per-object labels and equipped set. */
  function view(
    objs: GameObject[],
    labels: string[],
    equipped: GameObject[] = [],
  ): PackTotalGear {
    return {
      gear: objs,
      isEquipped: (o) => equipped.includes(o),
      gearToLabel: (o) => labels[objs.indexOf(o)] ?? "",
    };
  }

  function potionStack(n: number): GameObject {
    const obj = makeObj(TV.POTION);
    obj.number = n;
    return obj;
  }

  it("totals all similar stacks including the query object itself (L202-207)", () => {
    const a = potionStack(3);
    const b = potionStack(2);
    const c = potionStack(1);
    const { total } = objectPackTotal(view([a, b, c], ["a", "b", "c"]), a, false);
    expect(total).toBe(6);
  });

  it("excludes the query object when it is equipped (L207)", () => {
    const a = potionStack(3);
    const b = potionStack(2);
    const { total } = objectPackTotal(
      view([a, b], ["a", "b"], [a]),
      a,
      false,
    );
    expect(total).toBe(2);
  });

  it("prefers quiver digits over pack letters for `first` (L222-243)", () => {
    const a = potionStack(1);
    const b = potionStack(1);
    const q = potionStack(1);
    const { first } = objectPackTotal(
      view([a, b, q], ["c", "a", "5"]),
      a,
      false,
    );
    expect(first).toBe(q);
  });

  it("picks the lowest pack letter when no quiver stack matches", () => {
    const a = potionStack(1);
    const b = potionStack(1);
    const { first } = objectPackTotal(view([a, b], ["c", "a"]), a, false);
    expect(first).toBe(b);
  });

  it("honours inscription compatibility unless ignoreInscrip (L208-212)", () => {
    const a = potionStack(3);
    const b = potionStack(2);
    a.note = "@q1";
    b.note = "=k";
    /* object_stackable: differing inscriptions do not stack. */
    expect(objectPackTotal(view([a, b], ["a", "b"]), a, false).total).toBe(3);
    /* object_similar: inscriptions ignored. */
    expect(objectPackTotal(view([a, b], ["a", "b"]), a, true).total).toBe(5);
  });
});
