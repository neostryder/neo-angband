import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { OF } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { objectPrep } from "./make";
import { objectCopy } from "./object";
import type { GameObject } from "./object";

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
