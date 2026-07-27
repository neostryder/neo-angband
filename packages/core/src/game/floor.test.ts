import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
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
  OFLOOR,
  pileContains,
  pileLastItem,
  scanFloor,
  scanItems,
  USE_MODE,
} from "./floor";
import { invenCarry } from "./gear";
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
    const landed = dropNear(state, obj, 0, loc(12, 12), false, false);
    expect(landed).toEqual(loc(12, 12));
    expect(floorPile(state, loc(12, 12))).toEqual([obj]);
  });

  it("breaks a non-artifact when the breakage roll hits", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = makeObj(TV.POTION);
    let broke = false;
    const landed = dropNear(state, obj, 100, loc(12, 12), false, false, {
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
    const landed = dropNear(state, obj, 100, loc(12, 12), false, false);
    expect(landed).not.toBeNull();
  });

  it("lands within the 7x7 drop scan of the target", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Occupy the target so the scan has to pick a neighbour. */
    state.z.floorSize = 1;
    floorCarry(state, loc(12, 12), makeObj(TV.SWORD));
    const obj = makeObj(TV.POTION);
    const landed = dropNear(state, obj, 0, loc(12, 12), false, false);
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

describe("pileContains / pileLastItem (obj-pile.c L268 / L248)", () => {
  it("pileContains is true only for a member of the given array", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = makeObj(TV.POTION, 0);
    const b = makeObj(TV.POTION, 1);
    floorCarry(state, loc(10, 10), a);
    const pile = floorPile(state, loc(10, 10));
    expect(pileContains(pile, a)).toBe(true);
    expect(pileContains(pile, b)).toBe(false);
  });

  it("pileLastItem returns the tail, or null for an empty pile", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    expect(pileLastItem(floorPile(state, loc(10, 10)))).toBeNull();
    const potion = makeObj(TV.POTION);
    const sword = makeObj(TV.SWORD);
    /* pile_insert prepends, so the FIRST dropped item ends up at the tail. */
    floorCarry(state, loc(10, 10), potion);
    floorCarry(state, loc(10, 10), sword);
    expect(pileLastItem(floorPile(state, loc(10, 10)))).toBe(potion);
  });
});

describe("scanFloor (obj-pile.c scan_floor)", () => {
  it("applies the item tester when OFLOOR_TEST is set", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeObj(TV.POTION);
    const sword = makeObj(TV.SWORD);
    floorCarry(state, state.actor.grid, potion);
    floorCarry(state, state.actor.grid, sword);
    const found = scanFloor(state, 10, OFLOOR.TEST, (o) => o.tval === TV.SWORD);
    expect(found).toEqual([sword]);
  });

  it("excludes gold from a null-tester scan (object_test, obj-util.c L392)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const gold = makeObj(TV.GOLD);
    const potion = makeObj(TV.POTION);
    floorCarry(state, state.actor.grid, gold);
    floorCarry(state, state.actor.grid, potion);
    const found = scanFloor(state, 10, OFLOOR.TEST, null);
    expect(found).toEqual([potion]);
  });

  it("OFLOOR_TOP stops after the first accepted item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = makeObj(TV.POTION, 0);
    const b = makeObj(TV.POTION, 1);
    floorCarry(state, state.actor.grid, a);
    floorCarry(state, state.actor.grid, b);
    /* pile_insert prepends, so b (dropped last) is the head. */
    const found = scanFloor(state, 10, OFLOOR.TOP, null);
    expect(found).toEqual([b]);
  });

  it("OFLOOR_VISIBLE skips objects the env reports as ignored", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = makeObj(TV.POTION, 0);
    const b = makeObj(TV.POTION, 1);
    floorCarry(state, state.actor.grid, a);
    floorCarry(state, state.actor.grid, b);
    const found = scanFloor(state, 10, OFLOOR.VISIBLE, null, {
      isIgnored: (o) => o === b,
    });
    expect(found).toEqual([a]);
  });

  it("caps at maxSize", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    floorCarry(state, state.actor.grid, makeObj(TV.POTION, 0));
    floorCarry(state, state.actor.grid, makeObj(TV.POTION, 1));
    expect(scanFloor(state, 1, OFLOOR.NONE, null).length).toBe(1);
  });
});

describe("scanItems (obj-pile.c scan_items)", () => {
  const limits = {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  };

  it("orders inventory, equipment, quiver, then floor - order is behaviour", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const packItem = makeObj(TV.POTION, 0);
    invenCarry(state.gear, packItem, limits);
    const wielded = makeObj(TV.SWORD);
    const wieldHandle = invenCarry(state.gear, wielded, limits);
    /* Simulate invenWield's pack -> equipment move (obj-gear.c inven_wield). */
    state.gear.pack = state.gear.pack.filter((h) => h !== wieldHandle);
    state.actor.player.equipment[0] = wieldHandle;
    const floorItem = makeObj(TV.POTION, 1);
    floorCarry(state, state.actor.grid, floorItem);

    const found = scanItems(
      state,
      10,
      USE_MODE.INVEN | USE_MODE.EQUIP | USE_MODE.FLOOR,
      null,
    );
    expect(found).toEqual([packItem, wielded, floorItem]);
  });

  it("excludes gold from a null-tester scan", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const gold = makeObj(TV.GOLD);
    invenCarry(state.gear, gold, limits);
    const found = scanItems(state, 10, USE_MODE.INVEN, null);
    expect(found).toEqual([]);
  });

  it("the inventory pass excludes quivered handles (calc_inventory's disjoint split)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const packItem = makeObj(TV.POTION, 0);
    const packHandle = invenCarry(state.gear, packItem, limits);
    const quivered = makeObj(TV.POTION, 1);
    const quiverHandle = invenCarry(state.gear, quivered, limits);
    state.gear.quiver = [quiverHandle];

    const found = scanItems(state, 10, USE_MODE.INVEN, null);
    expect(found).toEqual([packItem]);
    expect(found).not.toContain(quivered);
    /* The quiver pass still finds it. */
    expect(packHandle).not.toBe(quiverHandle);
    const quiverFound = scanItems(state, 10, USE_MODE.QUIVER, null);
    expect(quiverFound).toEqual([quivered]);
  });

  it("stops at itemMax across all passes combined", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    invenCarry(state.gear, makeObj(TV.POTION, 0), limits);
    invenCarry(state.gear, makeObj(TV.POTION, 1), limits);
    floorCarry(state, state.actor.grid, makeObj(TV.POTION, 2));
    const found = scanItems(
      state,
      2,
      USE_MODE.INVEN | USE_MODE.FLOOR,
      null,
    );
    expect(found.length).toBe(2);
  });
});

describe("drop_near's verbose (obj-pile.c:1129-1155)", () => {
  it("announces a landing on the player's own grid", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    dropNear(state, makeObj(TV.POTION), 0, loc(5, 5), true, false);
    expect(msgs).toEqual(["You feel something roll beneath your feet."]);
  });

  it("says nothing when verbose is false", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    dropNear(state, makeObj(TV.POTION), 0, loc(5, 5), false, false);
    expect(msgs).toEqual([]);
  });

  it("says nothing for a landing away from the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    dropNear(state, makeObj(TV.POTION), 0, loc(12, 12), true, false);
    expect(msgs).toEqual([]);
  });

  it("says nothing for an ignored object, or one merged into an ignored pile", () => {
    /* dont_ignore = verbose && !ignore_item_ok (:1132), and floor_carry clears
     * it again when the drop merges into a stack the player ignores (:927-930). */
    const ignored = makeObj(TV.POTION);
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    state.msg = (text: string): void => void msgs.push(text);
    const env = { isIgnored: (o: GameObject): boolean => o.kind === ignored.kind };
    dropNear(state, ignored, 0, loc(5, 5), true, false, env);
    expect(msgs).toEqual([]);

    /* And the merge path: an un-ignored duplicate absorbed into that pile. */
    const dup = makeObj(TV.POTION);
    dropNear(state, dup, 0, loc(5, 5), true, false, env);
    expect(msgs).toEqual([]);
  });
});

describe("drop_near's prefer_pile (obj-pile.c drop_find_grid)", () => {
  /**
   * prefer_pile drops drop_find_grid's penalty for putting DIFFERENT kinds of
   * item on one square. This is the parameter the port used to receive the C's
   * `verbose` argument in, so several call sites had it backwards - which lands
   * objects on different grids from upstream, not just a different message.
   */
  function dropSecond(preferPile: boolean): { first: Loc; second: Loc | null } {
    const state = makeState({ playerGrid: loc(5, 5) });
    const sword = makeObj(TV.SWORD);
    const first = dropNear(state, sword, 0, loc(12, 12), false, preferPile)!;
    /* A different kind, so the mixed-type penalty is what decides. */
    const potion = makeObj(TV.POTION);
    const second = dropNear(state, potion, 0, loc(12, 12), false, preferPile);
    return { first, second };
  }

  it("piles a mixed item onto the target grid when preferPile is set", () => {
    const { first, second } = dropSecond(true);
    expect(first).toEqual(loc(12, 12));
    expect(second).toEqual(loc(12, 12));
  });

  it("pushes a mixed item off the target grid when preferPile is clear", () => {
    const { first, second } = dropSecond(false);
    expect(first).toEqual(loc(12, 12));
    expect(second).not.toBeNull();
    expect(second).not.toEqual(loc(12, 12));
  });
});
