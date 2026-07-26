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
 * TWO upstream assertions have no port counterpart and are NOT faked:
 *
 * 1. Stack-wield object identity. Upstream inven_wield (obj-gear.c L947-968)
 *    splits the single wielded item OFF the stack and inserts it BEFORE the
 *    original in p->gear, so `obj` stays in the pack holding number-1 and a
 *    fresh object is equipped. The port's wieldObject (gear.ts L929-938) does
 *    the reverse: it wears the ORIGINAL handle and pushes the remainder onto
 *    the END of gear.pack. The counts are the same; the identity and the
 *    gear-list position of the remainder are not. Reported as UT-P-004, NOT
 *    worked around here.
 * 2. pack_overflow. Upstream calls combine_pack + pack_overflow(old) at the
 *    tail of inven_wield (obj-gear.c L1009-1010), so the two "full pack"
 *    overflow cases end with the displaced item on the FLOOR
 *    (square_object(cave, player->grid) == obj1) and no longer carried. The
 *    port DEFERS pack_overflow (documented at gear.ts L20 and L387), so those
 *    assertions are omitted and called out rather than replaced by something
 *    weaker that passes. Reported as UT-P-005.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject, StackLimits } from "../obj/object";
import type { Player } from "../player/player";
import { Rng } from "../rng";
import { floorCarry, floorObjectForUse, floorPile } from "./floor";
import {
  gearAdd,
  gearGet,
  invenCarry,
  packSlotsUsed,
  wieldSlot,
} from "./gear";
import type { Gear } from "./gear";
import { invenTakeoff, invenWield } from "./obj-cmd";
import type { GameState } from "./context";
import { makeState } from "./harness";

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
function wieldFromFloor(state: GameState, obj: GameObject): number {
  const { usable } = floorObjectForUse(state, obj, 1);
  const handle = invenCarry(state.gear, usable, limits);
  return invenWield(state, handle);
}

/** The same-kind pack stack of `n`, or undefined. Upstream's check_similar
 * compares object fields; the port's split copies the kind, so kind+count is
 * the observable equivalent (see UT-P-004 in the header). */
function packStack(state: GameState, kind: unknown, n: number): GameObject | undefined {
  return state.gear.pack
    .map((h) => gearGet(state.gear, h))
    .find((o): o is GameObject => !!o && o.kind === kind && o.number === n);
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
    const slot = invenWield(state, h);
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
    const slot = invenWield(state, h);
    /* One is worn; the other two stay in the pack. Upstream equips the SPLIT
     * and leaves the original stack; the port wears the original handle
     * (UT-P-004), so identity is asserted only through kind + count. */
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(packStack(state, obj.kind, 2)).toBeTruthy();
    expect(equipCnt(state.actor.player)).toBe(1);
    /* The remainder still occupies exactly one pack slot (L288). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
  });

  // upstream: test_inven_wield_pack_single_filled
  it("inven_wield pack/single/filled slot", () => {
    const state = makeState();
    emptyGear(state);
    const obj1 = setupObject(TV.SHIELD, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = invenWield(state, h1);
    const obj2 = setupObject(TV.SHIELD, 2, 1);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(invenWield(state, h2)).toBe(slot);
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
    const slot = invenWield(state, h1);
    const obj2 = setupObject(TV.GLOVES, 2, 2);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    const oldSlots = packSlotsUsed(state.gear, constants);
    invenWield(state, h2);
    /* One of the pair is worn; the other stays in the pack. */
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj2.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(packStack(state, obj2.kind, 1)).toBeTruthy();
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
    const slot = invenWield(state, h1);
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
    const slot = invenWield(state, h1);
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
    const slot = invenWield(state, h1);
    const obj2 = setupObject(TV.HARD_ARMOR, 1, 1);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    invenWield(state, h2);
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
    const slot = invenWield(state, h1);
    const obj2 = setupObject(TV.HELM, 2, 3);
    const h2 = gearAdd(state.gear, obj2);
    state.gear.pack.push(h2);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    invenWield(state, h2);
    /* One of the three is worn; two stay in the pack (L562-568). */
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj2.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(packStack(state, obj2.kind, 2)).toBeTruthy();
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* UT-P-005. Upstream ends here with pack_overflow having dropped the
     * displaced helm: !object_is_carried(obj1) (L570), pack_slots_used ==
     * old_slots (L574) and square_object == obj1 (L575). The port DEFERS
     * pack_overflow, so the helm is still carried and the pack is over
     * capacity by one. Pinned as the port's CURRENT behaviour so implementing
     * pack_overflow forces this expectation to be revisited. */
    expect(state.gear.pack).toContain(h1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots + 1);
    expect(packSlotsUsed(state.gear, constants)).toBeGreaterThan(constants.packSize);
    expect(floorPile(state, state.actor.grid)).toHaveLength(0);
  });

  // upstream: test_inven_wield_floor_full_overflow
  it("inven_wield floor/full pack/overflow", () => {
    const state = makeState();
    emptyGear(state);
    emptyFloor(state);
    const obj1 = setupObject(TV.BOW, 1, 1);
    const h1 = gearAdd(state.gear, obj1);
    state.gear.pack.push(h1);
    const slot = invenWield(state, h1);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    const obj2 = setupObject(TV.BOW, 2, 1);
    floorCarry(state, state.actor.grid, obj2);
    expect(wieldSlot(state.actor.player.body, obj2.tval, state.actor.player.equipment)).toBe(
      slot,
    );
    wieldFromFloor(state, obj2);
    expect(slotObject(state.actor.player, state.gear, slot)!.kind).toBe(obj2.kind);
    expect(slotObject(state.actor.player, state.gear, slot)!.number).toBe(1);
    expect(isEquipped(state.actor.player, h1)).toBe(false);
    expect(equipCnt(state.actor.player)).toBe(1);
    /* The floor item was taken (L602 floor_carry then L604 inven_wield). */
    expect(floorPile(state, state.actor.grid)).toHaveLength(0);
    /* UT-P-005 again: upstream drops the displaced bow (L611, L616-617); the
     * port keeps it and overflows the pack. Pinned, not hidden. */
    expect(state.gear.pack).toContain(h1);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots + 1);
  });

  // upstream: test_inven_wield_ring_none
  it("inven_wield ring none carried", () => {
    const state = makeState();
    emptyGear(state);
    const ring = setupObject(TV.RING, 1, 1);
    const h = gearAdd(state.gear, ring);
    state.gear.pack.push(h);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot = invenWield(state, h);
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
    const slot1 = invenWield(state, h1);
    const r2 = setupObject(TV.RING, 2, 1);
    const h2 = gearAdd(state.gear, r2);
    state.gear.pack.push(h2);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const slot2 = invenWield(state, h2);
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
    const slot1 = invenWield(state, h1);
    const r2 = setupObject(TV.RING, 2, 1);
    const h2 = gearAdd(state.gear, r2);
    state.gear.pack.push(h2);
    const slot2 = invenWield(state, h2);
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
    const slot3 = invenWield(state, h3);
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
