/**
 * Upstream unit tests from reference/src/tests/object/attack.c
 *
 * Mapping:
 * - breakage_chance -> breakageChance (packages/core/src/combat/ranged.ts)
 * - object_prep of a longsword with base.breakPerc, then artifact path.
 *
 * Upstream fixture test_longsword has break_perc 50 on its object base
 * (unit-test-data.h). Port uses a synthetic ObjectKind with breakPerc 50.
 */

import { describe, expect, it } from "vitest";

import { FlagSet } from "../bitflag";
import { ELEM_MAX, KF_SIZE, OF_SIZE } from "../obj/types";
import type { Artifact, ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import { breakageChance } from "./ranged";

function makeKind(breakPerc: number): ObjectKind {
  return {
    name: "longsword",
    text: "",
    base: {
      name: "sword",
      tval: 23,
      next: null,
      attr: "w",
      flags: new FlagSet(OF_SIZE),
      kindFlags: new FlagSet(KF_SIZE),
      elInfo: Array.from({ length: ELEM_MAX }, () => ({ resLevel: 0, flags: 0 })),
      breakPerc,
      maxStack: 40,
      numSvals: 1,
    },
    next: null,
    kidx: 1,
    tval: 23,
    sval: 1,
    pval: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    toD: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    toA: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    ac: 0,
    dd: 1,
    ds: 5,
    weight: 30,
    cost: 0,
    flags: new FlagSet(OF_SIZE),
    kindFlags: new FlagSet(KF_SIZE),
    modifiers: [],
    elInfo: Array.from({ length: ELEM_MAX }, () => ({ resLevel: 0, flags: 0 })),
    brands: null,
    slays: null,
    curses: null,
    dAttr: 0,
    dChar: "/",
    allocProb: 20,
    allocMin: 0,
    allocMax: 100,
    level: 1,
    activation: null,
    effect: null,
    power: 0,
    effectMsg: null,
    visMsg: null,
    time: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    charge: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    genMultProb: 0,
    stackSize: { base: 1, dice: 0, sides: 0, mBonus: 0 },
    flavor: null,
    noteAware: 0,
    noteUnaware: 0,
    aware: true,
    tried: true,
    ignore: false,
    everseen: true,
  } as unknown as ObjectKind;
}

describe("object/attack (reference/src/tests/object/attack.c)", () => {
  // upstream: test_breakage_chance
  it("breakage-chance", () => {
    const kind = makeKind(50);
    const obj = objectNew(kind);

    expect(breakageChance(obj, true)).toBe(50);
    // miss squares the percent: 50*50/100 = 25
    expect(breakageChance(obj, false)).toBe(25);

    obj.artifact = { name: "test" } as Artifact;
    expect(breakageChance(obj, true)).toBe(0);
    expect(breakageChance(obj, false)).toBe(0);
  });
});
