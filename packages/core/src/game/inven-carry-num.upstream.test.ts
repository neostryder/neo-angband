/**
 * Upstream unit tests from reference/src/tests/player/inven-carry-num.c
 *
 * Mapping: inven_carry_num -> invenCarryNum; inven_carry_okay is
 * `invenCarryNum(obj) > 0`.
 *
 * Upstream setup forces pack_size=5, quiver_size=3. We override the bound
 * constants accordingly. quiver_slot_size and thrown_quiver_mult come from pack.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import type { Constants } from "../constants.js";
import { TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject, StackLimits } from "../obj/object.js";
import { Rng } from "../rng.js";
import {
  calcInventory,
  gearAdd,
  invenCarry,
  invenCarryNum,
  newGear,
  packSlotsUsed,
} from "./gear.js";
import type { Gear } from "./gear.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objPack = {
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
const base = bindConstants(loadJson("constants"));

/** Upstream setup: pack_size=5, quiver_size=3. */
const z: Constants = {
  ...base,
  packSize: 5,
  quiverSize: 3,
};

const limits: StackLimits = {
  quiverSlotSize: z.quiverSlotSize,
  thrownQuiverMult: z.thrownQuiverMult,
};

function prep(tval: number, sval = 1, seed = 1): GameObject {
  const k = reg.lookupKind(tval, sval)!;
  return objectPrep(new Rng(seed), reg, base, k, 0, "randomise");
}

function copyObj(src: GameObject, number?: number, note?: string): GameObject {
  const obj = objectPrep(new Rng(1), reg, base, src.kind, 0, "minimise");
  /* shallow field copy of combat-relevant bits for stacking */
  obj.number = number ?? src.number;
  obj.flags = src.flags.clone();
  obj.toH = src.toH;
  obj.toD = src.toD;
  obj.toA = src.toA;
  obj.ac = src.ac;
  obj.dd = src.dd;
  obj.ds = src.ds;
  obj.modifiers = [...src.modifiers];
  obj.elInfo = src.elInfo.map((e) => ({ ...e }));
  obj.origin = src.origin;
  obj.originDepth = src.originDepth;
  if (note !== undefined) obj.note = note;
  else if (src.note) obj.note = src.note;
  return obj;
}

interface Cns {
  torch: GameObject;
  arrow: GameObject;
  shot: GameObject;
  flask: GameObject;
  inscribedFlask: GameObject;
  inscribedFlaskAlt: GameObject;
  treasure: GameObject;
}

function makeCns(): Cns {
  const torch = prep(TV.LIGHT, 1);
  const arrow = prep(TV.ARROW, 1);
  const shot = prep(TV.SHOT, 1);
  const flask = prep(TV.FLASK, 1);
  const inscribedFlask = copyObj(flask, 1, `@v${z.quiverSize - 1}`);
  const inscribedFlaskAlt = copyObj(flask, 1, "@v0");
  /* Treasure: any gold-like money tval stack */
  const treasure = prep(TV.GOLD, 1);
  treasure.number = 1;
  return { torch, arrow, shot, flask, inscribedFlask, inscribedFlaskAlt, treasure };
}

/**
 * fill_pack_quiver (inven-carry-num.c:142-283). Upstream aborts the test when
 * the pack is already full or when an insert did not end up carried; without
 * those guards a fixture that silently failed to fill would leave every later
 * expectation meaningless, so they are reproduced as assertions here.
 */
function fillPackQuiver(
  gear: Gear,
  cns: Cns,
  nPack: number,
  nArrow: number,
  nShot: number,
  nFlask: number,
): void {
  gear.store.clear();
  gear.pack = [];
  gear.quiver = [];
  gear.next = 1;

  /* pack_is_full() then inven_carry(); the object must end up carried. */
  const carry = (obj: GameObject): void => {
    expect(packSlotsUsed(gear, z)).toBeLessThan(z.packSize);
    const handle = invenCarry(gear, obj, limits);
    expect(gear.pack).toContain(handle);
    calcInventory(gear, z);
  };

  for (let i = 0; i < nPack; i++) {
    carry(copyObj(cns.torch, 1, `dummy${i}`));
  }

  let qslot = 0;
  let left = nArrow;
  while (left > 0) {
    let n = left;
    if (n > z.quiverSlotSize) n = z.quiverSlotSize;
    carry(copyObj(cns.arrow, n));
    left -= n;
    qslot++;
  }

  left = nShot;
  while (left > 0) {
    let n = left;
    if (n > z.quiverSlotSize) n = z.quiverSlotSize;
    carry(copyObj(cns.shot, n));
    left -= n;
    qslot++;
  }

  left = nFlask;
  while (left > 0) {
    let n = left;
    if (n * z.thrownQuiverMult > z.quiverSlotSize) {
      n = Math.trunc(z.quiverSlotSize / z.thrownQuiverMult);
    }
    /* Inscribed so it goes into the quiver (L253-262). */
    expect(qslot).toBeLessThan(z.quiverSize);
    carry(copyObj(cns.flask, n, `@v${qslot}`));
    left -= n;
    qslot++;
  }
}

/**
 * perform_one_test (inven-carry-num.c:287-306). Returns the value so a failure
 * prints "expected 9 to be 20" rather than "expected false to be true".
 *
 * Upstream additionally cross-checks inven_carry_okay against n_expected. The
 * port has no separate inven_carry_okay: it IS `invenCarryNum(obj) > 0` (see
 * mon/steal.ts L104, the one live consumer), so that half of the C assertion
 * has no independent content here and is deliberately not faked.
 */
function carryNum(gear: Gear, obj: GameObject, nTry: number): number {
  const nOld = obj.number;
  obj.number = nTry;
  const got = invenCarryNum(gear, obj, z);
  obj.number = nOld;
  return got;
}

describe("player/inven-carry-num (reference/src/tests/player/inven-carry-num.c)", () => {
  const cns = makeCns();
  const q = z.quiverSlotSize;
  const mult = z.thrownQuiverMult;

  // upstream: test_carry_num_empty_pack_empty_quiver
  it("carry num empty/empty", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, 0, 0, 0, 0);
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 10)).toBe(10);
  });

  // upstream: test_carry_num_partial_pack_empty_quiver
  it("carry num partial/empty", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, z.packSize - 1, 0, 0, 0);
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    /* Not inscribed, so it goes into the remaining pack slot. */
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    /* Inscribed, so it goes into the quiver, taking one slot and expanding the
     * quiver into the remaining pack slot. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(Math.trunc(q / mult));
    expect(carryNum(gear, cns.treasure, 8)).toBe(8);
  });

  // upstream: test_carry_num_full_pack_empty_quiver
  it("carry num full/empty", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, z.packSize, 0, 0, 0);
    /* Fits because it stacks with torches already there. */
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    /* No pack slots left, so the quiver cannot expand and takes nothing. */
    expect(carryNum(gear, cns.arrow, q)).toBe(0);
    expect(carryNum(gear, cns.shot, q)).toBe(0);
    expect(carryNum(gear, cns.flask, q)).toBe(0);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(0);
    expect(carryNum(gear, cns.treasure, 15)).toBe(15);
  });

  // upstream: test_carry_num_empty_pack_partial_quiver
  it("carry num empty/partial", () => {
    const nArrowMiss = 8;
    const nShotMiss = 9;
    const nFlaskMiss = 2;
    const gear = newGear();

    /* First, with one quiver slot empty. */
    fillPackQuiver(gear, cns, 0, q - nArrowMiss, q - nShotMiss, 0);
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    /* Not inscribed, so it goes into the pack. */
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    /* Inscribed: into the one free quiver slot, remainder to a pack slot. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 3)).toBe(3);

    fillPackQuiver(
      gear,
      cns,
      0,
      q - nArrowMiss,
      0,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    /* Not inscribed; some combines with the quiver stack, the rest to the pack. */
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    /* Inscribed for a different slot than what is there, so some goes to the
     * remaining quiver slot and the rest to the pack. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 30)).toBe(30);

    fillPackQuiver(
      gear,
      cns,
      0,
      0,
      q - nShotMiss,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 1)).toBe(1);

    /* Then with all slots filled but with room in each stack. */
    fillPackQuiver(
      gear,
      cns,
      0,
      q - nArrowMiss,
      q - nShotMiss,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    /* Inscribed for the same slot as what is there, so it can combine. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 25)).toBe(25);
  });

  // upstream: test_carry_num_partial_pack_partial_quiver
  it("carry num partial/partial", () => {
    const nArrowMiss = 9;
    const nShotMiss = 8;
    const nFlaskMiss = 1;
    const gear = newGear();

    /* First, with one quiver slot empty; always leave one pack slot free. */
    fillPackQuiver(gear, cns, z.packSize - 3, q - nArrowMiss, q - nShotMiss, 0);
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    /* Not inscribed, so it goes into the remaining pack slot. */
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    /* Into the remaining quiver slot, which leaves no pack slot for the rest. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(Math.trunc(q / mult));
    expect(carryNum(gear, cns.treasure, 13)).toBe(13);

    fillPackQuiver(
      gear,
      cns,
      z.packSize - 3,
      q - nArrowMiss,
      0,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    /* Combines with the quiver stack; remainder to the empty pack slot. */
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(Math.trunc(q / mult));
    expect(carryNum(gear, cns.treasure, 6)).toBe(6);

    fillPackQuiver(
      gear,
      cns,
      z.packSize - 3,
      0,
      q - nShotMiss,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(Math.trunc(q / mult));
    expect(carryNum(gear, cns.treasure, 21)).toBe(21);

    /* Then with all slots filled but with room in each stack. */
    fillPackQuiver(
      gear,
      cns,
      z.packSize - 4,
      q - nArrowMiss,
      q - nShotMiss,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    /* Inscription now matches what is in the quiver, so it can combine, with
     * the remainder going to the empty pack slot. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 9)).toBe(9);
  });

  // upstream: test_carry_num_full_pack_partial_quiver
  it("carry num full/partial", () => {
    const nArrowMiss = 5;
    const nShotMiss = 4;
    const nFlaskMiss = 3;
    const gear = newGear();

    /* First, with one quiver slot empty. */
    fillPackQuiver(gear, cns, z.packSize - 2, q - nArrowMiss, q - nShotMiss, 0);
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(nArrowMiss + nShotMiss);
    expect(carryNum(gear, cns.shot, q)).toBe(nArrowMiss + nShotMiss);
    /* Not inscribed, so it only reaches the quiver by stacking - it cannot. */
    expect(carryNum(gear, cns.flask, q)).toBe(0);
    /* Into the empty quiver slot, but only as much as needs no new pack slot. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(
      Math.trunc((nArrowMiss + nShotMiss) / mult),
    );
    expect(carryNum(gear, cns.treasure, 2)).toBe(2);

    fillPackQuiver(
      gear,
      cns,
      z.packSize - 2,
      q - nArrowMiss,
      0,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(nArrowMiss + mult * nFlaskMiss);
    /* Goes to the empty quiver slot. */
    expect(carryNum(gear, cns.shot, q)).toBe(nArrowMiss + mult * nFlaskMiss);
    /* Only stacks with what is there; it will not take the empty slot. */
    expect(carryNum(gear, cns.flask, q)).toBe(nFlaskMiss);
    /* Inscribed differently than what is in the quiver, so it cannot stack;
     * some goes into the empty slot the inscription targets. */
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(
      Math.trunc(nArrowMiss / mult) + nFlaskMiss,
    );
    expect(carryNum(gear, cns.treasure, 41)).toBe(41);

    fillPackQuiver(
      gear,
      cns,
      z.packSize - 2,
      0,
      q - nShotMiss,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    /* Goes to the empty quiver slot. */
    expect(carryNum(gear, cns.arrow, q)).toBe(nShotMiss + nFlaskMiss * mult);
    expect(carryNum(gear, cns.shot, q)).toBe(nShotMiss + nFlaskMiss * mult);
    expect(carryNum(gear, cns.flask, q)).toBe(nFlaskMiss);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(
      Math.trunc(nShotMiss / mult) + nFlaskMiss,
    );
    expect(carryNum(gear, cns.treasure, 50)).toBe(50);

    /* Then with all slots filled but with room in each stack. */
    fillPackQuiver(
      gear,
      cns,
      z.packSize - 3,
      q - nArrowMiss,
      q - nShotMiss,
      Math.trunc((q - mult * nFlaskMiss) / mult),
    );
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(nArrowMiss);
    expect(carryNum(gear, cns.shot, q)).toBe(nShotMiss);
    expect(carryNum(gear, cns.flask, q)).toBe(nFlaskMiss);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(nFlaskMiss);
    expect(carryNum(gear, cns.treasure, 5)).toBe(5);
  });

  // upstream: test_carry_num_empty_pack_full_quiver
  it("carry num empty/full", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, 0, q, q, Math.trunc(q / mult));
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 17)).toBe(17);
  });

  // upstream: test_carry_num_partial_pack_full_quiver
  it("carry num partial/full", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, z.packSize - 4, q, q, Math.trunc(q / mult));
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(q);
    expect(carryNum(gear, cns.shot, q)).toBe(q);
    expect(carryNum(gear, cns.flask, q)).toBe(q);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(q);
    expect(carryNum(gear, cns.treasure, 36)).toBe(36);
  });

  // upstream: test_carry_num_full_pack_full_quiver
  it("carry num full/full", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, z.packSize - 3, q, q, Math.trunc(q / mult));
    expect(carryNum(gear, cns.torch, 3)).toBe(3);
    expect(carryNum(gear, cns.arrow, q)).toBe(0);
    expect(carryNum(gear, cns.shot, q)).toBe(0);
    expect(carryNum(gear, cns.flask, q)).toBe(0);
    expect(carryNum(gear, cns.inscribedFlask, q)).toBe(0);
    expect(carryNum(gear, cns.treasure, 24)).toBe(24);
  });

  /* wobbly's report: a thrown item inscribed for the quiver failed to displace
   * a full stack of ammunition despite an empty quiver slot. */
  // upstream: test_carry_num_wobbly_case_0
  it("carry num wobbly's case 0", () => {
    const gear = newGear();
    fillPackQuiver(gear, cns, z.packSize - 3, q + 5, 0, 0);
    expect(carryNum(gear, cns.inscribedFlaskAlt, q)).toBe(Math.trunc(q / mult));
  });
});
