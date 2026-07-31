/**
 * Upstream unit tests from reference/src/tests/player/inven-wield.c
 *
 * Mapping:
 *   inven_wield (pack)  -> invenWield / wieldObject (game/obj-cmd.ts, gear.ts)
 *   inven_wield (floor) -> floorObjectForUse + invenCarry + invenWield
 *     (same path as do_cmd_wield in installObjCommands)
 *
 * equip_cnt / total_weight upkeep counters are deferred in the port; equipCnt
 * counts the filled equipment slots and total_weight has no counterpart, so
 * upstream's `old_weight == player->upkeep->total_weight` has nothing to
 * compare. Pack slot occupancy is checked via packSlotsUsed, exactly as
 * upstream's pack_slots_used.
 *
 * UT-P-004 and UT-P-005 (the stack-split identity and the pack_overflow tail)
 * were reported by the first pass of this file and are now FIXED in the port,
 * so upstream's assertions for both are asserted here for real:
 *
 * 1. Stack-wield object identity (obj-gear.c L947-968). inven_wield splits ONE
 *    item off the stack, links it into p->gear immediately AFTER the original
 *    (L961-963) and equips THAT; the original keeps number-1 and stays in the
 *    pack at its existing listing position. wieldObject's `split` argument
 *    ("inven_wield") selects this, as against wield_all's opposite split
 *    (player-birth.c L484-491). Upstream's `!object_is_equipped(obj) &&
 *    object_is_carried(obj) && obj->number == 2` and `check_similar(obj,
 *    split)` are asserted, plus the listing position the C's gear insertion
 *    implies.
 * 2. pack_overflow (obj-gear.c L1009-1010, L1345-1390). The two "full pack"
 *    overflow cases now end with the displaced item on the FLOOR
 *    (square_object(cave, player->grid) == obj1) and no longer carried, with
 *    pack_slots_used back at old_slots.
 *
 * `check_similar` (the C test's own helper, inven-wield.c L149-185) is ported
 * as checkSimilar below.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import {
  tvalIsArmor,
  tvalIsJewelry,
  tvalIsLight,
  tvalIsWeapon,
} from "../obj/object.js";
import type { GameObject, StackLimits } from "../obj/object.js";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types.js";
import type { Player } from "../player/player.js";
import { Rng } from "../rng.js";
import { floorCarry, floorObjectForUse, floorPile } from "./floor.js";
import {
  gearAdd,
  gearGet,
  invenCarry,
  packIsOverfull,
  packSlotsUsed,
  wieldSlot,
} from "./gear.js";
import type { Gear } from "./gear.js";
import { invenTakeoff, invenWield } from "./obj-cmd.js";
import type { GameState } from "./context.js";
import { describeObject } from "./describe.js";
import { makeState } from "./harness.js";

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
const constants = bindConstants(loadJson("constants"));
const limits: StackLimits = {
  quiverSlotSize: constants.quiverSlotSize,
  thrownQuiverMult: constants.thrownQuiverMult,
};

function setupObject(tval: number, sval: number, num: number): GameObject {
  const k = reg.lookupKind(tval, sval);
  if (!k) throw new Error(`no kind ${tval}/${sval}`);
  const obj = objectPrep(new Rng(1), reg, constants, k, 0, "randomise");
  obj.number = num;
  return obj;
}

function emptyGear(state: GameState): void {
  const p = state.actor.player;
  /* Take off all equipment into pack, then clear. */
  for (let i = 0; i < p.equipment.length; i++) {
    const h = p.equipment[i] ?? 0;
    if (h) invenTakeoff(state, h);
  }
  state.gear.store.clear();
  state.gear.pack = [];
  state.gear.quiver = [];
  state.gear.next = 1;
  p.equipment.fill(0);
}

function emptyFloor(state: GameState): void {
  state.floor.clear();
}

function isEquipped(p: Player, handle: number): boolean {
  return p.equipment.includes(handle);
}

function slotObject(p: Player, gear: Gear, slot: number): GameObject | null {
  return gearGet(gear, p.equipment[slot] ?? 0);
}

function equipCnt(p: Player): number {
  return p.equipment.filter((h) => h !== 0).length;
}

function fillPack(state: GameState): void {
  let slots = packSlotsUsed(state.gear, constants);
  while (slots < constants.packSize) {
    const obj = setupObject(TV.POTION, 1, 1);
    obj.note = `${slots}`;
    const h = gearAdd(state.gear, obj);
    state.gear.pack.push(h);
    slots++;
  }
}

/** Floor path of do_cmd_wield: take 1 from floor, carry, wield. */
function wieldFromFloor(
  state: GameState,
  obj: GameObject,
  msgs?: string[],
): number {
  const { usable } = floorObjectForUse(state, obj, 1);
  const handle = invenCarry(state.gear, usable, limits);
  return wield(state, handle, msgs);
}

/** invenWield with the real constants, optionally collecting its messages. */
function wield(state: GameState, handle: number, msgs?: string[]): number {
  return invenWield(
    state,
    handle,
    constants,
    msgs ? { msg: (t) => msgs.push(t) } : {},
  );
}

/** The same-kind pack stack of `n`, or undefined. */
function packStack(state: GameState, kind: unknown, n: number): GameObject | undefined {
  return state.gear.pack
    .map((h) => gearGet(state.gear, h))
    .find((o): o is GameObject => !!o && o.kind === kind && o.number === n);
}

/**
 * check_similar (the upstream test's own helper, inven-wield.c L149-185): the
 * split and the remainder must agree on kind, flags, el_info, the
 * weapon/armour/jewelry/light combat block, ego, curses and inscription.
 * obj->number is deliberately NOT compared (they differ).
 */
function checkSimilar(obj1: GameObject | null, obj2: GameObject | null): true {
  expect(obj1).toBeTruthy();
  expect(obj2).toBeTruthy();
  const a = obj1!;
  const b = obj2!;
  expect(a.kind).toBe(b.kind);
  /* of_is_equal(obj1->flags, obj2->flags) (L154). */
  expect(a.flags.isEqual(b.flags)).toBe(true);
  expect(a.elInfo.map((e) => [e.resLevel, e.flags & (EL_INFO_HATES | EL_INFO_IGNORE)])).toEqual(
    b.elInfo.map((e) => [e.resLevel, e.flags & (EL_INFO_HATES | EL_INFO_IGNORE)]),
  );
  if (
    tvalIsWeapon(a.tval) ||
    tvalIsArmor(a.tval) ||
    tvalIsJewelry(a.tval) ||
    tvalIsLight(a.tval)
  ) {
    expect([a.ac, a.dd, a.ds, a.toH, a.toD, a.toA]).toEqual([
      b.ac,
      b.dd,
      b.ds,
      b.toH,
      b.toD,
      b.toA,
    ]);
    expect(a.modifiers).toEqual(b.modifiers);
    expect(a.ego).toBe(b.ego);
    expect(a.curses).toEqual(b.curses);
  }
  if (a.note && b.note) expect(a.note).toBe(b.note);
  return true;
}

/** gear.pack as readable "<sval> x<number>" rows, so an order assertion reads. */
function packRows(state: GameState): string[] {
  return state.gear.pack.map((h) => {
    const o = gearGet(state.gear, h);
    return o ? `${o.tval}/${o.sval} x${o.number}${o.note ? `#${o.note}` : ""}` : "-";
  });
}

describe("player/inven-wield (reference/src/tests/player/inven-wield.c)", () => {
  // upstream: test_inven_wield_pack_single_empty
  it("inven_wield pack/single/empty slot", () => {
    const state = makeState();
    emptyGear(state);
    const obj = setupObject(TV.CLOAK, 1, 1);
    const h = gearAdd(state.gear, obj);
    state.gear.pack.push(h);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot = wield(state, h);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(isEquipped(state.actor.player, h)).toBe(true);
    expect(obj.number).toBe(1);
    expect(slotObject(state.actor.player, state.gear, slot)).toBe(obj);
    expect(equipCnt(state.actor.player)).toBe(1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots - 1);
  });

  // upstream: test_inven_wield_pack_stack_empty
  it("inven_wield pack/stack/empty slot", () => {
    const state = makeState();
    emptyGear(state);
    const obj = setupObject(TV.LIGHT, 1, 3);
    const h = gearAdd(state.gear, obj);
    state.gear.pack.push(h);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot = wield(state, h);
    /* The wielded one was split off (L262-268). `obj` is the ORIGINAL: it is
     * not equipped, is still carried, and holds 2. */
    expect(isEquipped(state.actor.player, h)).toBe(false);
    expect(state.gear.pack).toContain(h);
    expect(obj.number).toBe(2);
    const split = slotObject(state.actor.player, state.gear, slot);
    expect(split).not.toBe(obj);
    expect(isEquipped(state.actor.player, state.actor.player.equipment[slot]!)).toBe(true);
    checkSimilar(obj, split);
    expect(split!.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* The remainder still occupies exactly one pack slot (L271). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
  });

  /**
   * UT-P-004's observable half: the remainder keeps its LISTING position.
   * Upstream links the split in immediately AFTER the original (obj-gear.c
   * L961-963) and equips the split, so p->gear - and hence the pack listing -
   * keeps the original exactly where it was. Not an upstream test: upstream's
   * listing is upkeep->inven[], rebuilt by calc_inventory; the port's
   * gear.pack IS the listing, so the position is directly assertable and is
   * what the old wieldObject (equip the original, push the remainder to the
   * END) got wrong.
   */
  it("inven_wield pack/stack leaves the remainder at its listing position", () => {
    const state = makeState();
    emptyGear(state);
    /* A stack in the MIDDLE of a three-row pack, so "kept in place" and
     * "pushed to the end" are different answers. */
    const before = setupObject(TV.POTION, 1, 1);
    before.note = "before";
    const hBefore = gearAdd(state.gear, before);
    state.gear.pack.push(hBefore);
    const stack = setupObject(TV.LIGHT, 1, 3);
    const hStack = gearAdd(state.gear, stack);
    state.gear.pack.push(hStack);
    const after = setupObject(TV.POTION, 1, 1);
    after.note = "after";
    const hAfter = gearAdd(state.gear, after);
    state.gear.pack.push(hAfter);
    /* Precondition: the stack really is the middle row of three. */
    expect(state.gear.pack).toEqual([hBefore, hStack, hAfter]);

    const slot = wield(state, hStack);
    expect(slot).toBeGreaterThanOrEqual(0);
    /* The remainder is still the middle row, holding 2; nothing was appended. */
    expect(state.gear.pack).toEqual([hBefore, hStack, hAfter]);
    expect(packRows(state)).toEqual([
      `${TV.POTION}/1 x1#before`,
      `${TV.LIGHT}/1 x2`,
      `${TV.POTION}/1 x1#after`,
    ]);
  });

  // upstream: test_inven_wield_pack_single_filled
  it("inven_wield pack/single/filled slot", () => {
    const state = makeState();
    emptyGear(state);
    const obj1 = setupObject(TV.SHIELD, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    const obj2 = setupObject(TV.SHIELD, 2, 1);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(wield(state, h2)).toBe(slot);
    expect(isEquipped(state.actor.player, h2)).toBe(true);
    expect(obj2.number).toBe(1);
    expect(slotObject(state.actor.player, state.gear, slot)).toBe(obj2);
    /* The displaced shield is back in the pack, not equipped (L302-303). */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).toContain(h1);
    expect(equipCnt(state.actor.player)).toBe(1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
  });

  // upstream: test_inven_wield_pack_stack_filled
  it("inven_wield pack/stack/filled slot", () => {
    const state = makeState();
    emptyGear(state);
    const obj1 = setupObject(TV.GLOVES, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    const obj2 = setupObject(TV.GLOVES, 2, 2);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    const oldSlots = packSlotsUsed(state.gear, constants);
    wield(state, h2);
    /* The wielded one was split off (L334-341): obj2 keeps 1 and stays in the
     * pack; a fresh similar object with number 1 is worn. */
    expect(isEquipped(state.actor.player, h2)).toBe(false);
    expect(state.gear.pack).toContain(h2);
    expect(obj2.number).toBe(1);
    const split = slotObject(state.actor.player, state.gear, slot);
    expect(split).not.toBe(obj2);
    checkSimilar(obj2, split);
    expect(split!.number).toBe(1);
    /* The displaced gloves are back in the pack, not equipped (L340-341). */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).toContain(h1);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* Displaced gloves plus the leftover of the pair: one extra slot (L347). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots + 1);
  });

  // upstream: test_inven_wield_floor_single_empty
  it("inven_wield floor/single/empty slot", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj = setupObject(TV.BOOTS, 1, 1);
    floorCarry(state, state.actor.grid, obj);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot = wieldFromFloor(state, obj);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* Straight from floor to a body slot: the pack is untouched (L373). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    /* square_object(cave, player->grid) == NULL (L374). */
    expect(floorPile(state, state.actor.grid)).toHaveLength(0);
  });

  // upstream: test_inven_wield_floor_stack_empty
  it("inven_wield floor/stack/empty slot", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj = setupObject(TV.CROWN, 1, 4);
    floorCarry(state, state.actor.grid, obj);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot = wieldFromFloor(state, obj);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    /* square_object(cave, player->grid) == obj, with obj->number == 3 (L403). */
    const floor = floorPile(state, state.actor.grid);
    expect(floor).toHaveLength(1);
    expect(floor[0]!.kind).toBe(obj.kind);
    expect(floor[0]!.number).toBe(3);
  });

  // upstream: test_inven_wield_floor_single_filled
  it("inven_wield floor/single/filled slot", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj1 = setupObject(TV.AMULET, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const obj2 = setupObject(TV.AMULET, 2, 1);
    floorCarry(state, state.actor.grid, obj2);
    expect(wieldFromFloor(state, obj2)).toBe(slot);
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj2.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* The displaced amulet is carried but not equipped (L440-441). */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).toContain(h1);
    /* It takes one pack slot (L445), and the floor is empty (L446). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots + 1);
    expect(floorPile(state, state.actor.grid)).toHaveLength(0);
  });

  // upstream: test_inven_wield_floor_stack_filled
  it("inven_wield floor/stack/filled slot", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj1 = setupObject(TV.DIGGING, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const obj2 = setupObject(TV.HAFTED, 1, 3);
    floorCarry(state, state.actor.grid, obj2);
    /* Both take the weapon slot (L477). */
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    wieldFromFloor(state, obj2);
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj2.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    /* The displaced digger is carried but not equipped (L486-487). */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).toContain(h1);
    expect(equipCnt(state.actor.player)).toBe(1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots + 1);
    /* square_object == obj2 with obj2->number == 2 (L482-484, L493). */
    const floor = floorPile(state, state.actor.grid);
    expect(floor).toHaveLength(1);
    expect(floor[0]!.kind).toBe(obj2.kind);
    expect(floor[0]!.number).toBe(2);
  });

  // upstream: test_inven_wield_pack_full_no_overflow
  it("inven_wield pack/full pack/no overflow", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    /* Wear body armour, then put a second body armour in the pack BEFORE
     * filling it, so the swap needs no new pack slot (L503-517). */
    const obj1 = setupObject(TV.SOFT_ARMOR, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    const obj2 = setupObject(TV.HARD_ARMOR, 1, 1);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    wield(state, h2);
    expect(isEquipped(state.actor.player, h2)).toBe(true);
    expect(obj2.number).toBe(1);
    expect(slotObject(state.actor.player, state.gear, slot)).toBe(obj2);
    /* The displaced soft armour is carried but not equipped (L525-526). */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).toContain(h1);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* One out, one in: no change, so no overflow (L529). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    /* square_object(cave, player->grid) == NULL (L530): nothing was dropped. */
    expect(floorPile(state, state.actor.grid)).toHaveLength(0);
  });

  // upstream: test_inven_wield_pack_full_overflow
  it("inven_wield pack/full pack/overflow", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj1 = setupObject(TV.HELM, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    const obj2 = setupObject(TV.HELM, 2, 3);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    /* The name pack_overflow will use, taken from the port's own object_desc
     * BEFORE the drop (as the C does at L1372-1374). */
    const dropName = describeObject(state, obj1);
    const msgs: string[] = [];
    wield(state, h2, msgs);
    /* Wielded one is split off (L561-568): obj2 keeps 2 in the pack. */
    expect(isEquipped(state.actor.player, h2)).toBe(false);
    expect(state.gear.pack).toContain(h2);
    expect(obj2.number).toBe(2);
    const split = slotObject(state.actor.player, state.gear, slot);
    expect(split).not.toBe(obj2);
    checkSimilar(obj2, split);
    expect(split!.number).toBe(1);
    /* pack_overflow shed the displaced helm: !object_is_equipped(obj1) (L569),
     * !object_is_carried(obj1) (L570), pack_slots_used == old_slots (L574) and
     * square_object(cave, player->grid) == obj1 (L575). */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).not.toContain(h1);
    expect(gearGet(state.gear, h1)).toBeNull();
    expect(equipCnt(state.actor.player)).toBe(1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    expect(packIsOverfull(state.gear, constants)).toBe(false);
    const floor = floorPile(state, state.actor.grid);
    expect(floor).toHaveLength(1);
    expect(floor[0]).toBe(obj1);
    /* inven_wield's own MSG_WIELD line first (obj-gear.c L1005), then
     * pack_overflow's three messages in order (L1356, L1377, L1383), naming
     * the shed helm exactly as object_desc(ODESC_PREFIX | ODESC_FULL) does. */
    expect(msgs[0]).toMatch(/^You are wearing .+ \(.\)\.$/);
    expect(msgs.slice(1)).toEqual([
      "Your pack overflows!",
      `You drop ${dropName}.`,
      `You no longer have ${dropName}.`,
    ]);
  });

  // upstream: test_inven_wield_floor_full_overflow
  it("inven_wield floor/full pack/overflow", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj1 = setupObject(TV.BOW, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = wield(state, h1);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    const obj2 = setupObject(TV.BOW, 2, 1);
    floorCarry(state, state.actor.grid, obj2);
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    const dropName = describeObject(state, obj1);
    const msgs: string[] = [];
    wieldFromFloor(state, obj2, msgs);
    /* obj2 came off the floor as a single item, so it IS what is worn (L604-608). */
    expect(slotObject(state.actor.player, state.gear, slot)).toBe(obj2);
    expect(obj2.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* pack_overflow shed the displaced bow (L610-611, L616-617): it is neither
     * equipped nor carried, the pack is back at old_slots, and square_object
     * is obj1 - the floor holds the BOW1, not the bow that was picked up. */
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(state.gear.pack).not.toContain(h1);
    expect(gearGet(state.gear, h1)).toBeNull();
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    expect(packIsOverfull(state.gear, constants)).toBe(false);
    const floor = floorPile(state, state.actor.grid);
    expect(floor).toHaveLength(1);
    expect(floor[0]).toBe(obj1);
    expect(msgs[0]).toMatch(/^You are shooting with .+ \(.\)\.$/);
    expect(msgs.slice(1)).toEqual([
      "Your pack overflows!",
      `You drop ${dropName}.`,
      `You no longer have ${dropName}.`,
    ]);
  });

  // upstream: test_inven_wield_ring_none
  it("inven_wield ring none carried", () => {
    const state = makeState();
    emptyGear(state);
    const ring = setupObject(TV.RING, 1, 1);
    const h = gearAdd(state.gear, ring);
    state.gear.pack.push(h);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot = wield(state, h);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(state.actor.player.body.slots[slot]?.type).toBe("RING");
    expect(slotObject(state.actor.player, state.gear, slot)).toBe(ring);
    expect(ring.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots - 1);
  });

  // upstream: test_inven_wield_ring_one
  it("inven_wield ring one carried", () => {
    const state = makeState();
    emptyGear(state);
    const r1 = setupObject(TV.RING, 1, 1);
    const h1 = gearAdd(state.gear, r1);
    state.gear.pack.push(h1);
    const slot1 = wield(state, h1);
    const r2 = setupObject(TV.RING, 2, 1);
    const h2 = gearAdd(state.gear, r2);
    state.gear.pack.push(h2);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot2 = wield(state, h2);
    /* wield_slot picks the OTHER, empty ring slot (L671). */
    expect(slot2).not.toBe(slot1);
    expect(slotObject(state.actor.player, state.gear, slot2)).toBe(r2);
    expect(slotObject(state.actor.player, state.gear, slot1)).toBe(r1);
    expect(r1.number).toBe(1);
    expect(r2.number).toBe(1);
    expect(equipCnt(state.actor.player)).toBe(2);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots - 1);
  });

  // upstream: test_inven_wield_ring_two
  it("inven_wield ring two carried", () => {
    const state = makeState();
    emptyGear(state);
    const r1 = setupObject(TV.RING, 1, 1);
    const h1 = gearAdd(state.gear, r1);
    state.gear.pack.push(h1);
    const slot1 = wield(state, h1);
    const r2 = setupObject(TV.RING, 2, 1);
    const h2 = gearAdd(state.gear, r2);
    state.gear.pack.push(h2);
    const slot2 = wield(state, h2);
    const r3 = setupObject(TV.RING, 3, 1);
    const h3 = gearAdd(state.gear, r3);
    state.gear.pack.push(h3);
    const oldSlots = packSlotsUsed(state.gear, constants);
    /* Upstream calls inven_wield(obj3, slot1) to name WHICH ring is replaced,
     * then inven_wield(obj1, slot2) to replace the other. The port's
     * invenWield derives the slot from wieldSlot and takes no slot argument
     * (obj-cmd.ts L206-212), so "replace ring N" is not expressible in core:
     * upstream's second half is NOT portable and is not faked. What IS
     * checkable is that the third ring displaces one of the two, the other
     * stays worn, and the displaced ring returns to the pack. */
    const slot3 = wield(state, h3);
    expect([slot1, slot2]).toContain(slot3);
    expect(slotObject(state.actor.player, state.gear, slot3)).toBe(r3);
    expect(r3.number).toBe(1);
    const kept = slot3 === slot1 ? slot2 : slot1;
    const keptRing = slot3 === slot1 ? r2 : r1;
    const displaced = slot3 === slot1 ? h1 : h2;
    expect(slotObject(state.actor.player, state.gear, kept)).toBe(keptRing);
    expect(isEquipped(state.actor.player, displaced)).toBe(false);
    expect(state.gear.pack).toContain(displaced);
    expect(equipCnt(state.actor.player)).toBe(2);
    /* One ring out of the pack, one back in (L720). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
  });
});
