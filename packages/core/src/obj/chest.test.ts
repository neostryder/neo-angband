import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { Rng } from "../rng";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { objectPrep } from "./make";
import {
  CHEST_TRAPS,
  chestTrapName,
  isLockedChest,
  isTrappedChest,
  pickChestTraps,
  pickLevelGated,
  pickOneChestTrap,
  unlockChest,
} from "./chest";

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

/** A real chest object of the given kind name, for pval-model tests. */
function chestObj(name: string, seed = 1) {
  const sval = reg.lookupSval(TV.CHEST, name);
  const kind = reg.lookupKind(TV.CHEST, sval)!;
  expect(kind).toBeTruthy();
  const rng = new Rng(seed);
  return objectPrep(rng, reg, constants, kind, kind.level, "randomise");
}

describe("pick_one_chest_trap (obj-chest.c L359)", () => {
  it("consumes exactly one randint0 draw", () => {
    const rng = new Rng(7);
    pickOneChestTrap(rng, 5);
    // A second call on the same rng must draw again (state changes).
    const s1 = JSON.stringify(rng.getState());
    pickOneChestTrap(rng, 5);
    const s2 = JSON.stringify(rng.getState());
    expect(s1).not.toBe(s2);
  });

  it("replicates the upstream no-re-check quirk on a non-monotonic list", () => {
    // The shipped chest_trap.txt is sorted by ascending level, so the
    // count-qualifying entries are always a prefix of the unfiltered walk
    // and the quirk never actually diverges from a "filtered walk" in
    // practice. Force the divergence with a synthetic, non-monotonic list:
    // a high-level entry sorts FIRST, followed by two low-level entries.
    // count(level=1) is 2 (the two level-1 entries), but the walk itself
    // never re-checks level, so a pick of 0 lands on the high-level entry
    // that sorts first anyway - exactly the quirk in obj-chest.c L359-374.
    const list = [
      { level: 100, tag: "excluded-by-count-but-first-in-the-walk" },
      { level: 1, tag: "a" },
      { level: 1, tag: "b" },
    ] as const;

    // Find a seed whose randint0(2) draws 0 (lands on list[0]) and one that
    // draws 1 (lands on list[1], the first genuinely-qualifying entry).
    let seedZero = -1;
    let seedOne = -1;
    for (let seed = 1; seed < 100 && (seedZero < 0 || seedOne < 0); seed++) {
      const pick = new Rng(seed).randint0(2);
      if (pick === 0 && seedZero < 0) seedZero = seed;
      if (pick === 1 && seedOne < 0) seedOne = seed;
    }
    expect(seedZero).toBeGreaterThan(0);
    expect(seedOne).toBeGreaterThan(0);

    expect(pickLevelGated(new Rng(seedZero), 1, list).tag).toBe(
      "excluded-by-count-but-first-in-the-walk",
    );
    expect(pickLevelGated(new Rng(seedOne), 1, list).tag).toBe("a");
  });
});

describe("pick_chest_traps (obj-chest.c L381) determinism", () => {
  it("golden pval sequence for a level-5 chest (Small wooden chest)", () => {
    // Level 5 is <= 5, so only the first-pick branch and the one_in_(10)
    // short-circuit are reachable (the second-trap gate requires level>5).
    const got: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const rng = new Rng(seed);
      const obj = chestObj("Small wooden chest", seed);
      got.push(pickChestTraps(rng, obj));
    }
    expect(got).toEqual([
      8, 4, 1, 4, 8, 4, 1, 4, 2, 8, 4, 4,
    ]);
  });

  it("golden pval sequence for a level>45 chest (Large steel chest, level 55)", () => {
    // Level 55 > 45, so the third/fourth-trap branches are reachable too.
    const got: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const rng = new Rng(seed);
      const obj = chestObj("Large steel chest", seed);
      got.push(pickChestTraps(rng, obj));
    }
    expect(got).toEqual([
      48, 8, 1, 8, 32, 8, 1, 10, 2, 32, 10, 16,
    ]);
  });

  it("is a pure function of the rng stream (same seed -> same pval)", () => {
    const obj1 = chestObj("Small iron chest", 99);
    const obj2 = chestObj("Small iron chest", 99);
    expect(pickChestTraps(new Rng(99), obj1)).toBe(
      pickChestTraps(new Rng(99), obj2),
    );
  });
});

describe("chest predicates (obj-chest.c L297-350)", () => {
  it("isLockedChest / isTrappedChest across pval values", () => {
    const cases: Array<[number, boolean, boolean]> = [
      [0, false, false], // empty
      [1, true, false], // locked, no traps
      [-1, false, false], // unlocked
      [-8, false, false], // disarmed
      [2, true, true], // locked + trapped
      [6, true, true], // multiple traps
    ];
    for (const [pval, locked, trapped] of cases) {
      const obj = chestObj("Small wooden chest");
      obj.pval = pval;
      expect(isLockedChest(obj)).toBe(locked);
      expect(isTrappedChest(obj)).toBe(trapped);
    }
  });

  it("a non-chest object is never locked or trapped", () => {
    const obj = chestObj("Small wooden chest");
    obj.tval = 0;
    obj.pval = 6;
    expect(isLockedChest(obj)).toBe(false);
    expect(isTrappedChest(obj)).toBe(false);
  });

  it("chestTrapName across pval values", () => {
    const obj = chestObj("Small wooden chest");
    obj.pval = -1;
    expect(chestTrapName(obj)).toBe("unlocked");
    obj.pval = -8;
    expect(chestTrapName(obj)).toBe("disarmed");
    obj.pval = 0;
    expect(chestTrapName(obj)).toBe("empty");
    obj.pval = 1;
    expect(chestTrapName(obj)).toBe("locked");
    obj.pval = 2; // gas trap only
    expect(chestTrapName(obj)).toBe(CHEST_TRAPS[1]!.name);
    obj.pval = 2 | 4; // gas trap + poison needle/STR
    expect(chestTrapName(obj)).toBe("multiple traps");
  });

  it("unlockChest negates the pval", () => {
    const obj = chestObj("Small wooden chest");
    obj.pval = 6;
    unlockChest(obj);
    expect(obj.pval).toBe(-6);
    unlockChest(obj);
    expect(obj.pval).toBe(6);
  });
});
