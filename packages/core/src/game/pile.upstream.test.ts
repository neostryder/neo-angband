/**
 * Upstream unit tests from reference/src/tests/object/pile.c
 * (suite object/pile, test_obj_piles).
 *
 * Mapping:
 * Upstream keeps a pile as a doubly-linked list of struct object and drives it
 * with the raw primitives of reference/src/obj-pile.c:
 *   pile_insert      obj-pile.c:167  prepend, *pile becomes obj
 *   pile_insert_end  obj-pile.c:188  append after pile_last_item
 *   pile_excise      obj-pile.c:209  unlink, special-casing the head
 *   pile_last_item   obj-pile.c:248  walk ->next; NULL for an empty pile
 *   pile_contains    obj-pile.c:268  walk ->next looking for the pointer
 *
 * The port stores a pile as an array on GameState.floor keyed by grid, newest
 * FIRST, exactly as upstream's square->obj list (floor.ts module header). The
 * live primitives are:
 *   floorPile    game/floor.ts:58   square_object: the pile, head first
 *   floorExcise  game/floor.ts:77   square_excise_object / pile_excise
 *   floorCarry   game/floor.ts:113  floor_carry (obj-pile.c:905), whose insert
 *                                   step is pile_insert (floor.ts:66/148)
 * so array index 0 is upstream's `*pile` pointer, and the last element is
 * upstream's pile_last_item. Array order carries what upstream's prev/next
 * pointers carry, so the C's link-integrity block (o1<->o2<->o4) becomes an
 * order assertion on the array.
 *
 * Two honest differences from the C test, both recorded rather than papered
 * over:
 *  - pile_insert_end has NO port counterpart: nothing in the live port appends
 *    to a floor pile (floor_carry always prepends). The upstream append cases
 *    are therefore reproduced by inserting in reverse, which reaches the same
 *    pile states, and the per-step "last item is the one just appended"
 *    assertions are replaced by the equivalent head/last/order assertions on
 *    the prepend path.
 *  - floorCarry is floor_carry, not bare pile_insert, so it merges a mergeable
 *    drop (obj-pile.c:925-935). The objects below therefore use DISTINCT kinds
 *    so objectSimilar's `obj1.kind !== obj2.kind` gate (object.ts) keeps them
 *    as four separate pile entries, which is what the C test needs. The merge
 *    behaviour itself is asserted separately at the end.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bindConstants } from "../constants.js";
import { TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { floorCarry, floorExcise, floorPile } from "./floor.js";
import { makeState } from "./harness.js";

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

/** A fresh ordinary object of a tval; distinct tvals never merge. */
function makeObj(tval: number): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

/** The grid every case below uses; makeState's openField holds objects. */
const GRID = loc(10, 10);

describe("object/pile (reference/src/tests/object/pile.c)", () => {
  // upstream: test_obj_piles
  it("pile checking", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const o1 = makeObj(TV.POTION);
    const o2 = makeObj(TV.SCROLL);
    let o3 = makeObj(TV.SWORD);
    const o4 = makeObj(TV.SOFT_ARMOR);
    const pile = (): readonly GameObject[] => floorPile(state, GRID);
    const last = (): GameObject | null => pile()[pile().length - 1] ?? null;

    /* pile_last_item(NULL) == NULL (obj-pile.c:257-258). */
    expect(pile()).toEqual([]);
    expect(last()).toBeNull();

    /* pile_insert(&pile, o1): *pile == o1, last item == o1. */
    expect(floorCarry(state, GRID, o1)).toBe(true);
    expect(pile().includes(o1)).toBe(true);
    expect(pile().includes(o2)).toBe(false);
    expect(pile()[0]).toBe(o1);
    expect(last()).toBe(o1);
    /* floor_carry records the grid and forgets any holder (obj-pile.c:983). */
    expect(o1.grid).toEqual(GRID);
    expect(o1.heldMIdx).toBe(0);

    /*
     * Upstream then appends o2 and o3 to reach o1 <-> o2 <-> o3. The port only
     * prepends, so o3 and o2 go in ahead of o1's re-insert to reach the same
     * three-element pile in the same order.
     */
    floorExcise(state, GRID, o1);
    expect(floorCarry(state, GRID, o3)).toBe(true);
    expect(floorCarry(state, GRID, o2)).toBe(true);
    expect(floorCarry(state, GRID, o1)).toBe(true);

    expect(pile().includes(o1)).toBe(true);
    expect(pile().includes(o2)).toBe(true);
    expect(pile().includes(o3)).toBe(true);
    expect(pile().includes(o4)).toBe(false);
    expect(pile()[0]).toBe(o1);
    expect(last()).toBe(o3);
    /* Upstream: pile_last_item(pile)->prev == o2. Port: array order. */
    expect(pile()).toEqual([o1, o2, o3]);

    /* Excise from the top: obj-pile.c:216-222, *pile = next. */
    expect(floorExcise(state, GRID, o1)).toBe(true);
    expect(pile()[0]).toBe(o2);
    expect(pile().includes(o1)).toBe(false);
    expect(pile()).toEqual([o2, o3]);

    /* Now put it back (pile_insert -> head again). */
    expect(floorCarry(state, GRID, o1)).toBe(true);
    expect(pile()).toEqual([o1, o2, o3]);

    /* Excise from the end: obj-pile.c:225-239 unlinks prev->next. */
    expect(floorExcise(state, GRID, o3)).toBe(true);
    expect(pile()[0]).toBe(o1);
    expect(pile().includes(o3)).toBe(false);
    expect(last()).toBe(o2);
    /* Upstream: pile_last_item(pile)->prev == o1. Port: array order. */
    expect(pile()).toEqual([o1, o2]);
    /* pile_excise on an object that is not in the pile is a no-op here (the C
     * calls pile_integrity_fail; the port reports false). */
    expect(floorExcise(state, GRID, o3)).toBe(false);

    /*
     * Upstream: o3 = object_new(); pile_insert_end(o3); pile_insert_end(o4),
     * giving o1 <-> o2 <-> o3 <-> o4. Reached here by rebuilding head-first.
     */
    o3 = makeObj(TV.SWORD);
    floorExcise(state, GRID, o1);
    floorExcise(state, GRID, o2);
    expect(pile()).toEqual([]);
    expect(floorCarry(state, GRID, o4)).toBe(true);
    expect(floorCarry(state, GRID, o3)).toBe(true);
    expect(floorCarry(state, GRID, o2)).toBe(true);
    expect(floorCarry(state, GRID, o1)).toBe(true);
    expect(pile()).toEqual([o1, o2, o3, o4]);

    /* Try removing from the middle. */
    expect(floorExcise(state, GRID, o3)).toBe(true);
    expect(pile()[0]).toBe(o1);
    /*
     * Upstream link integrity after the middle excision:
     *   null(o1->prev); o1->next == o2; o2->prev == o1; o2->next == o4;
     *   null(o3->prev); null(o3->next); o4->prev == o2; null(o4->next)
     * i.e. exactly the ordered list o1, o2, o4 with o3 detached.
     */
    expect(pile()).toEqual([o1, o2, o4]);
    expect(pile().includes(o3)).toBe(false);
    expect(last()).toBe(o4);

    /* Emptying the pile removes the grid entirely (floor.ts:88). */
    floorExcise(state, GRID, o1);
    floorExcise(state, GRID, o2);
    floorExcise(state, GRID, o4);
    expect(pile()).toEqual([]);
    expect(last()).toBeNull();
  });

  /*
   * Not an upstream case, but the reason the objects above need distinct
   * kinds: floor_carry (obj-pile.c:925-935) absorbs a mergeable drop into the
   * stack it finds instead of calling pile_insert at all.
   */
  it("floor_carry merges a like object instead of growing the pile", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = makeObj(TV.POTION);
    const b = makeObj(TV.POTION);
    expect(floorCarry(state, GRID, a)).toBe(true);
    expect(floorCarry(state, GRID, b)).toBe(true);
    expect(floorPile(state, GRID)).toEqual([a]);
    expect(a.number).toBe(2);
  });
});
