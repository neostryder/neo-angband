import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import {
  dropNear,
  floorCarry,
  floorExcise,
  floorObjectForUse,
  floorPile,
} from "./floor";
import { GRANITE, makeState } from "./harness";

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

/** A fresh plain object of the first ordinary kind of a tval. */
function makeObj(tval: number, nth = 0): GameObject {
  const kinds = reg.kinds.filter(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  const kind = kinds[nth];
  if (!kind) throw new Error(`no ordinary kind #${nth} for tval ${tval}`);
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

describe("floorCarry (obj-pile.c floor_carry)", () => {
  it("places an object on a floor grid and records its location", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.POTION);
    expect(floorCarry(state, loc(10, 10), obj)).toBe(true);
    expect(obj.grid).toEqual(loc(10, 10));
    expect(floorPile(state, loc(10, 10))).toEqual([obj]);
  });

  it("merges into a compatible stack instead of growing the pile", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = makeObj(TV.POTION);
    const b = makeObj(TV.POTION);
    floorCarry(state, loc(10, 10), a);
    expect(floorCarry(state, loc(10, 10), b)).toBe(true);
    const pile = floorPile(state, loc(10, 10));
    expect(pile.length).toBe(1);
    expect(pile[0]!.number).toBe(2);
  });

  it("newest drop sits at the head of the pile (pile_insert prepends)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeObj(TV.POTION);
    const sword = makeObj(TV.SWORD);
    floorCarry(state, loc(10, 10), potion);
    floorCarry(state, loc(10, 10), sword);
    expect(floorPile(state, loc(10, 10))[0]).toBe(sword);
  });

  it("fails on a grid that cannot hold objects", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.setFeat(loc(10, 10), GRANITE);
    expect(floorCarry(state, loc(10, 10), makeObj(TV.POTION))).toBe(false);
  });

  it("fails when the pile is full and nothing is ignored", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.z.floorSize = 2;
    floorCarry(state, loc(10, 10), makeObj(TV.POTION, 0));
    floorCarry(state, loc(10, 10), makeObj(TV.POTION, 1));
    expect(floorCarry(state, loc(10, 10), makeObj(TV.POTION, 2))).toBe(false);
  });

  it("evicts the oldest ignored object to make room", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.z.floorSize = 2;
    const old = makeObj(TV.POTION, 0);
    floorCarry(state, loc(10, 10), old);
    floorCarry(state, loc(10, 10), makeObj(TV.POTION, 1));
    const next = makeObj(TV.POTION, 2);
    const ok = floorCarry(state, loc(10, 10), next, {
      isIgnored: (o) => o === old,
    });
    expect(ok).toBe(true);
    const pile = floorPile(state, loc(10, 10));
    expect(pile).toContain(next);
    expect(pile).not.toContain(old);
  });
});

describe("dropNear (obj-pile.c drop_near)", () => {
  it("drops at the target grid when it is free", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.POTION);
    const landed = dropNear(state, obj, 0, loc(12, 12), false);
    expect(landed).toEqual(loc(12, 12));
    expect(floorPile(state, loc(12, 12))).toEqual([obj]);
  });

  it("breaks a non-artifact when the breakage roll hits", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.POTION);
    let broke = false;
    const landed = dropNear(state, obj, 100, loc(12, 12), false, {
      onBreak: (_o, b) => {
        broke = b;
      },
    });
    expect(landed).toBeNull();
    expect(broke).toBe(true);
    expect(floorPile(state, loc(12, 12)).length).toBe(0);
  });

  it("an artifact never breaks", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.SWORD);
    obj.artifact = reg.artifacts.find((a) => a) ?? null;
    expect(obj.artifact).not.toBeNull();
    const landed = dropNear(state, obj, 100, loc(12, 12), false);
    expect(landed).not.toBeNull();
  });

  it("lands within the 7x7 drop scan of the target", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Occupy the target so the scan has to pick a neighbour. */
    state.z.floorSize = 1;
    floorCarry(state, loc(12, 12), makeObj(TV.SWORD));
    const obj = makeObj(TV.POTION);
    const landed = dropNear(state, obj, 0, loc(12, 12), false);
    expect(landed).not.toBeNull();
    expect(Math.abs(landed!.x - 12)).toBeLessThanOrEqual(3);
    expect(Math.abs(landed!.y - 12)).toBeLessThanOrEqual(3);
    expect(floorPile(state, landed!)).toContain(obj);
  });
});

describe("floorObjectForUse / floorExcise", () => {
  it("splits part of a stack, leaving the rest on the floor", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.POTION);
    obj.number = 5;
    floorCarry(state, loc(10, 10), obj);
    const { usable, noneLeft } = floorObjectForUse(state, obj, 2);
    expect(noneLeft).toBe(false);
    expect(usable.number).toBe(2);
    expect(usable.grid).toBeNull();
    expect(obj.number).toBe(3);
    expect(floorPile(state, loc(10, 10))).toContain(obj);
  });

  it("taking the whole stack excises it from the pile", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.POTION);
    obj.number = 2;
    floorCarry(state, loc(10, 10), obj);
    const { usable, noneLeft } = floorObjectForUse(state, obj, 2);
    expect(noneLeft).toBe(true);
    expect(usable).toBe(obj);
    expect(floorPile(state, loc(10, 10)).length).toBe(0);
  });

  it("floorExcise removes exactly the given object", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = makeObj(TV.POTION, 0);
    const b = makeObj(TV.POTION, 1);
    floorCarry(state, loc(10, 10), a);
    floorCarry(state, loc(10, 10), b);
    expect(floorExcise(state, loc(10, 10), a)).toBe(true);
    expect(floorPile(state, loc(10, 10))).toEqual([b]);
    expect(floorExcise(state, loc(10, 10), a)).toBe(false);
  });
});
