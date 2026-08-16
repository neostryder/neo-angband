/**
 * Upstream unit tests from reference/src/tests/object/alloc.c
 *
 * Mapping:
 * - get_obj_num -> ObjAllocState.getObjNum (obj/make.ts)
 * - Upstream builds a 5-kind synthetic k_info table with known alloc_* and
 *   runs a G-test. Port: construct a tiny ObjRegistry + constants mirroring
 *   those five kinds, then assert the same distribution bounds.
 *
 * Note: getObjNum in the port always applies the great_obj level boost for
 * level > 0; the synthetic expected distribution below mirrors
 * compute_obj_num_expected from the C test.
 */

import { describe, expect, it } from "vitest";

import { FlagSet } from "../bitflag.js";
import { KF, TV } from "../generated/index.js";
import { KF_SIZE, OF_SIZE } from "./types.js";
import type { ObjectKind } from "./types.js";
import { Rng } from "../rng.js";
import { ObjAllocState } from "./make.js";
import type { Constants } from "../constants.js";

function makeKind(
  kidx: number,
  tval: number,
  allocMin: number,
  allocMax: number,
  allocProb: number,
  good: boolean,
): ObjectKind {
  const kindFlags = new FlagSet(KF_SIZE);
  if (good) kindFlags.on(KF.GOOD);
  return {
    name: `k${kidx}`,
    text: "",
    base: {
      name: `b${kidx}`,
      tval,
      next: null,
      attr: "w",
      flags: new FlagSet(OF_SIZE),
      kindFlags: new FlagSet(KF_SIZE),
      elInfo: [],
      breakPerc: 0,
      maxStack: 40,
      numSvals: 1,
    },
    next: null,
    kidx,
    tval,
    sval: 1,
    pval: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    toD: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    toA: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    ac: 0,
    dd: 1,
    ds: 1,
    weight: 1,
    cost: 0,
    flags: new FlagSet(OF_SIZE),
    kindFlags,
    modifiers: [],
    elInfo: [],
    brands: null,
    slays: null,
    curses: null,
    dAttr: 0,
    dChar: "?",
    allocProb,
    allocMin,
    allocMax,
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

/** Minimal registry duck-typed for ObjAllocState. */
function tinyReg(kinds: ObjectKind[]) {
  return {
    kinds,
    egos: [] as never[],
    artifacts: [] as never[],
  };
}

function computeGTest(ob: number[], ex: number[], ntotal: number): number {
  let result = 0;
  for (let i = 0; i < ob.length; i++) {
    if (!ob[i]) continue;
    if (ex[i] === 0) return 1e30;
    const oprob = ob[i]! / ntotal;
    result += oprob * Math.log(oprob / ex[i]!);
  }
  return 2 * result;
}

const CHI_TABLE = [10.82757, 13.81551, 16.26624, 18.46683, 20.51501];

function satisfiesChisq(v: number, ndof: number): boolean {
  if (ndof <= 0 || ndof > CHI_TABLE.length) return false;
  return v < CHI_TABLE[ndof - 1]!;
}

/**
 * Expected distribution matching compute_obj_num_expected (alloc.c).
 * Port getObjNum boosts level when level > 0 && oneIn(greatObj).
 */
function computeExpected(
  kinds: ObjectKind[],
  maxObjDepth: number,
  greatObj: number,
  level: number,
  good: boolean,
  tval: number,
): { ex: number[]; nnonzero: number } {
  const pboost = 1 / greatObj;
  const ex = new Array<number>(kinds.length).fill(0);
  for (let i = maxObjDepth; i >= 0; i--) {
    let mult: number;
    let boosted: number;
    if (i === 0) {
      mult = 1 - pboost;
      boosted = level;
    } else {
      mult = pboost / maxObjDepth;
      boosted = 1 + Math.trunc((level * maxObjDepth) / i);
      if (boosted > maxObjDepth) boosted = maxObjDepth;
    }
    let total = 0;
    for (const k of kinds) {
      if (good && !k.kindFlags.has(KF.GOOD)) continue;
      if (tval !== 0 && k.tval !== tval) continue;
      if (k.allocMin > boosted || k.allocMax < boosted) continue;
      total += k.allocProb;
    }
    if (!total) continue;
    for (let j = 0; j < kinds.length; j++) {
      const k = kinds[j]!;
      if (good && !k.kindFlags.has(KF.GOOD)) continue;
      if (tval !== 0 && k.tval !== tval) continue;
      if (k.allocMin > boosted || k.allocMax < boosted) continue;
      ex[j]! += (mult * k.allocProb) / total;
    }
  }
  let nnonzero = 0;
  for (const e of ex) if (e > 0) nnonzero++;
  return { ex, nnonzero };
}

describe("object/alloc (reference/src/tests/object/alloc.c)", () => {
  // upstream: test_get_obj_num_basic
  it("get_obj_num_basic", () => {
    const kinds = [
      makeKind(0, TV.LIGHT, 0, 1, 80, false),
      makeKind(1, TV.POTION, 0, 6, 40, false),
      makeKind(2, TV.WAND, 0, 6, 20, false),
      makeKind(3, TV.POTION, 0, 6, 10, true),
      makeKind(4, TV.WAND, 1, 6, 5, true),
    ];
    const constants = {
      maxObjDepth: 2,
      greatObj: 20,
    } as Constants;
    const alloc = new ObjAllocState(tinyReg(kinds) as never, constants);

    // Unsatisfiable tval.
    expect(
      alloc.getObjNum(new Rng(1), constants, 1, false, TV.CHEST),
    ).toBeNull();

    let ntrials = 0;
    for (const k of kinds) ntrials += k.allocProb;
    ntrials *= 30;

    const cases = [
      { level: 0, tval: 0, good: false },
      { level: 1, tval: 0, good: false },
      { level: 2, tval: 0, good: false },
      { level: 1, tval: 0, good: true },
      { level: 0, tval: TV.POTION, good: false },
      { level: 1, tval: TV.POTION, good: false },
      { level: 2, tval: TV.POTION, good: false },
      { level: 1, tval: TV.POTION, good: true },
    ];

    for (const cs of cases) {
      const histogram = new Array<number>(kinds.length).fill(0);
      const rng = new Rng(cs.level * 17 + cs.tval * 3 + (cs.good ? 1 : 0) + 99);
      for (let j = 0; j < ntrials; j++) {
        const kind = alloc.getObjNum(rng, constants, cs.level, cs.good, cs.tval);
        expect(kind).not.toBeNull();
        expect(cs.level >= kind!.allocMin).toBe(true);
        if (cs.good) expect(kind!.kindFlags.has(KF.GOOD)).toBe(true);
        if (cs.tval !== 0) expect(kind!.tval).toBe(cs.tval);
        const idx = kinds.indexOf(kind!);
        expect(idx).toBeGreaterThanOrEqual(0);
        histogram[idx]!++;
      }

      const { ex, nnonzero } = computeExpected(
        kinds,
        constants.maxObjDepth,
        constants.greatObj,
        cs.level,
        cs.good,
        cs.tval,
      );
      expect(nnonzero).toBeGreaterThanOrEqual(1);
      if (nnonzero === 1) {
        expect(Math.max(...histogram)).toBe(ntrials);
      } else {
        const g = computeGTest(histogram, ex, ntrials);
        expect(satisfiesChisq(g, nnonzero - 1)).toBe(true);
      }
    }
  });
});
