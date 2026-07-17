import { describe, expect, it } from "vitest";
import { newGear, gearAdd, objectNew, TV } from "@neo-angband/core";
import type { GameObject, ObjectKind, StartedGame } from "@neo-angband/core";
import { findInven } from "./shop";

/**
 * find_inven (store.c L1515-1644): the count of a stackable equivalent already
 * carried in the pack, for the buy/take "(you have N)" prompt hint (gap 12.10).
 */
function mkObj(kind: ObjectKind, number: number, over: Partial<GameObject> = {}): GameObject {
  const o = objectNew(kind);
  o.tval = kind.tval;
  o.number = number;
  Object.assign(o, over);
  return o;
}

function gameWithPack(objs: GameObject[]): StartedGame {
  const gear = newGear();
  for (const o of objs) gear.pack.push(gearAdd(gear, o));
  return { state: { gear } } as unknown as StartedGame;
}

describe("findInven (store.c find_inven, gap 12.10)", () => {
  const potionKind = { tval: TV.POTION } as ObjectKind;
  const scrollKind = { tval: TV.SCROLL } as ObjectKind;
  const chestKind = { tval: TV.CHEST } as ObjectKind;
  const swordKind = { tval: TV.SWORD } as ObjectKind;

  it("sums the numbers of every matching-kind pack stack (kind-only tvals)", () => {
    const game = gameWithPack([mkObj(potionKind, 3), mkObj(potionKind, 2)]);
    expect(findInven(game, mkObj(potionKind, 1))).toBe(5);
  });

  it("ignores stacks of a different kind", () => {
    const game = gameWithPack([mkObj(potionKind, 3), mkObj(scrollKind, 9)]);
    expect(findInven(game, mkObj(potionKind, 1))).toBe(3);
  });

  it("returns 0 for chests (never stackable)", () => {
    const game = gameWithPack([mkObj(chestKind, 1)]);
    expect(findInven(game, mkObj(chestKind, 1))).toBe(0);
  });

  it("counts a wearable only when its bonuses match exactly", () => {
    const plus1 = mkObj(swordKind, 1, { toH: 1 });
    const plus0 = mkObj(swordKind, 1, { toH: 0 });
    const game = gameWithPack([plus1, plus0]);
    // A +0 probe matches only the +0 sword, not the +1 one.
    expect(findInven(game, mkObj(swordKind, 1, { toH: 0 }))).toBe(1);
  });

  it("returns 0 when nothing matches", () => {
    const game = gameWithPack([mkObj(scrollKind, 4)]);
    expect(findInven(game, mkObj(potionKind, 1))).toBe(0);
  });
});
