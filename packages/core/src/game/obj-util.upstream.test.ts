/**
 * Upstream unit tests from reference/src/tests/object/util.c
 *
 * NOTE the filename: upstream has two `tests/.../util.c` files. This is the
 * OBJECT one; the player one is game/player-util.upstream.test.ts.
 *
 * Mapping:
 * - obj_can_refill -> objCanRefill (game/obj-cmd.ts)
 * - check_for_inscrip_with_int -> checkForInscripWithInt (game/pickup.ts)
 * - object_weight_one -> objectWeightOne (obj/object.ts) with curse table
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bindConstants } from "../constants.js";
import { FlagSet } from "../bitflag.js";
import { OF, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "../obj/bind.js";
import type { Curse, ObjPackJson } from "../obj/types.js";
import { OF_SIZE } from "../obj/types.js";
import {
  objectNew,
  objectWeightOne,
  type CurseData,
  type GameObject,
} from "../obj/object.js";
import { objectPrep } from "../obj/make.js";
import { checkForInscripWithInt } from "./pickup.js";
import { invenCarry } from "./gear.js";
import { invenWield, objCanRefill } from "./obj-cmd.js";
import { makeState } from "./harness.js";
import type { GameState } from "./context.js";

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

function kindByName(name: string, tval: number) {
  const k = reg.kinds.find((kk) => kk.name === name && kk.tval === tval);
  if (!k) throw new Error(`no kind named ${name} of tval ${tval}`);
  return k;
}

function makeNamed(name: string, tval: number): GameObject {
  return objectPrep(new Rng(3), reg, constants, kindByName(name, tval), 0, "average");
}

function carry(state: GameState, obj: GameObject): number {
  return invenCarry(state.gear, state.actor.player, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
}

function equip(state: GameState, obj: GameObject): number {
  return invenWield(state, carry(state, obj), constants);
}

describe("object/util (reference/src/tests/object/util.c)", () => {
  // upstream: test_obj_can_refill
  it("obj_can_refill", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const torch = makeNamed("& Wooden Torch~", TV.LIGHT);
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    lantern.timeout = 7500;
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    const rod = makeNamed("Treasure Location", TV.ROD);
    rod.timeout = 50;

    // Torches cannot be refilled (equipped torch lacks TAKES_FUEL).
    equip(state, torch);
    expect(objCanRefill(state, torch)).toBe(false);

    // Equip a lantern instead.
    const lantern2 = makeNamed("& Lantern~", TV.LIGHT);
    lantern2.timeout = 7500;
    // Replace light: take off torch path — just make a fresh state with lantern.
    const state2 = makeState({ playerGrid: loc(5, 5) });
    equip(state2, lantern2);

    expect(objCanRefill(state2, torch)).toBe(false);
    expect(objCanRefill(state2, lantern)).toBe(true);
    lantern.timeout = 0;
    expect(objCanRefill(state2, lantern)).toBe(false);
    lantern.timeout = 7500;
    expect(objCanRefill(state2, flask)).toBe(true);
    expect(objCanRefill(state2, rod)).toBe(false);
  });

  // upstream: test_basic_check_for_inscrip_with_int
  it("basic_check_for_inscrip_with_uint", () => {
    const obj = makeNamed("& Wooden Torch~", TV.LIGHT);

    // No inscription.
    expect(checkForInscripWithInt(obj, "=g").count).toBe(0);

    // No match for the search string.
    obj.note = "@m1@b1@G1";
    expect(checkForInscripWithInt(obj, "=g").count).toBe(0);

    // Match without a following integer.
    obj.note = "=g@m1@b1@G1";
    expect(checkForInscripWithInt(obj, "=g").count).toBe(0);

    // One match with integer 5.
    obj.note = "=g5@m1@b1@G1";
    let r = checkForInscripWithInt(obj, "=g");
    expect(r.count).toBe(1);
    expect(r.value).toBe(5);

    // Two matches: first integer wins (8).
    obj.note = "@m1@b1=g8@G1=g5";
    r = checkForInscripWithInt(obj, "=g");
    expect(r.count).toBe(2);
    expect(r.value).toBe(8);
  });

  // upstream: test_object_weight_one
  it("object_weight_one", () => {
    // Synthetic object with a full 0..4 curse table as in setup_tests.
    const torchKind = kindByName("& Wooden Torch~", TV.LIGHT);
    const obj = objectNew(torchKind);

    obj.number = 1;
    obj.weight = 100;
    expect(objectWeightOne(obj)).toBe(100);
    obj.number = 10;
    expect(objectWeightOne(obj)).toBe(100);
    obj.weight = -5;
    expect(objectWeightOne(obj)).toBe(0);

    const mkCurseObj = (weight: number, mult = false): Curse => {
      const flags = new FlagSet(OF_SIZE);
      if (mult) flags.on(OF.MULTIPLY_WEIGHT);
      return {
        name: "c",
        index: 0,
        poss: [],
        conflict: null,
        conflictFlags: new FlagSet(OF_SIZE),
        desc: "",
        obj: {
          weight,
          flags,
          toA: 0,
          toH: 0,
          toD: 0,
          modifiers: [],
          elInfo: [],
        },
      } as unknown as Curse;
    };

    // Index layout matches unit-test setup: 0 unused, 1 no-effect, 2 -1 add,
    // 3 +3 add, 4 *90, 5 *120.
    const curses: (Curse | null)[] = [
      null,
      mkCurseObj(0),
      mkCurseObj(-1),
      mkCurseObj(3),
      mkCurseObj(90, true),
      mkCurseObj(120, true),
    ];
    const cd: CurseData[] = curses.map(() => ({ power: 0, timeout: 0 }));
    obj.curses = cd;

    // Curse 1 active (weight 0): no change.
    cd[1]!.power = 1;
    obj.weight = 100;
    expect(objectWeightOne(obj, curses)).toBe(100);
    obj.weight = -5;
    expect(objectWeightOne(obj, curses)).toBe(0);

    // Curse 2: additive -1
    cd[1]!.power = 0;
    cd[2]!.power = 1;
    obj.weight = 100;
    expect(objectWeightOne(obj, curses)).toBe(99);
    obj.weight = -5;
    expect(objectWeightOne(obj, curses)).toBe(0);
    obj.weight = 0;
    expect(objectWeightOne(obj, curses)).toBe(0);
    obj.weight = 1;
    expect(objectWeightOne(obj, curses)).toBe(0);

    // Curse 3: additive +3
    cd[2]!.power = 0;
    cd[3]!.power = 1;
    obj.weight = 100;
    expect(objectWeightOne(obj, curses)).toBe(103);
    obj.weight = -5;
    expect(objectWeightOne(obj, curses)).toBe(3);
    obj.weight = 0;
    expect(objectWeightOne(obj, curses)).toBe(3);
    obj.weight = 32767;
    expect(objectWeightOne(obj, curses)).toBe(32767);

    // Two additives
    cd[2]!.power = 1;
    cd[3]!.power = 1;
    obj.weight = 100;
    expect(objectWeightOne(obj, curses)).toBe(100 - 1 + 3);

    // Multiplicative 90%
    cd[2]!.power = 0;
    cd[3]!.power = 0;
    cd[4]!.power = 1;
    obj.weight = 80;
    expect(objectWeightOne(obj, curses)).toBe(Math.trunc((80 * 90 + 50) / 100));
    obj.weight = -5;
    expect(objectWeightOne(obj, curses)).toBe(0);
    obj.weight = 0;
    expect(objectWeightOne(obj, curses)).toBe(0);

    // Multiplicative 120%
    cd[4]!.power = 0;
    cd[5]!.power = 1;
    obj.weight = 80;
    expect(objectWeightOne(obj, curses)).toBe(Math.trunc((80 * 120 + 50) / 100));
    obj.weight = -5;
    expect(objectWeightOne(obj, curses)).toBe(1);
    obj.weight = 0;
    expect(objectWeightOne(obj, curses)).toBe(1);
    obj.weight = 32767;
    expect(objectWeightOne(obj, curses)).toBe(32767);

    // Two multiplicative
    cd[4]!.power = 1;
    cd[5]!.power = 1;
    obj.weight = 80;
    const mid = Math.trunc((80 * 90 + 50) / 100);
    expect(objectWeightOne(obj, curses)).toBe(Math.trunc((mid * 120 + 50) / 100));
  });
});
