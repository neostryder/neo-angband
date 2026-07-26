/**
 * Parity-closure tests for the quiver subsystem and gear sweeps:
 * - 4.1 quiver storage + routing: object_is_in_quiver (obj-gear.c L163),
 *   preferred_quiver_slot (L1396), quiver_absorb_num (L649), the inven_carry
 *   quiver stack-mode branch (L832-834), pack_slots_used quiver accounting
 *   (L257-296), calc_inventory quiver assignment (player-calcs.c L1023-1238).
 * - 4.2 minus_ac (obj-gear.c L376-438).
 * - 4.4 combine_pack full sweep + inven_can_stack_partial (obj-gear.c
 *   L1242-1323, L1183-1236).
 * - 1.6 birth_start_kit honoured in player_outfit (player-birth.c L612-617).
 * - 1.8 start-item eopts birth-option exclusion (player-birth.c L619-637).
 * - earlier_object ordering (player-calcs.c L934-1003).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { ELEM, TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { EL_INFO_IGNORE } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject, StackLimits } from "../obj/object";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import { earlierObject } from "../player/calcs";
import { Rng } from "../rng";
import {
  calcInventory,
  combinePack,
  gearAdd,
  gearGet,
  invenCarry,
  invenCarryNum,
  minusAc,
  newGear,
  objectIsInQuiver,
  outfitPlayer,
  packSlotsUsed,
  preferredQuiverSlot,
  quiverAbsorbNum,
} from "./gear";
import type { Gear } from "./gear";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
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
const limits: StackLimits = {
  quiverSlotSize: constants.quiverSlotSize,
  thrownQuiverMult: constants.thrownQuiverMult,
};

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
});
const humanWarrior = () => {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  const body = players.bodies[race.body]!;
  return { race, cls, body };
};

/** First ordinary (non-artifact-dummy) kind of a tval. */
function firstOrdinaryKind(tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no ordinary kind for tval ${tval}`);
  return k;
}

function makeObj(tval: number, number = 1, seed = 1): GameObject {
  const obj = objectPrep(
    new Rng(seed),
    reg,
    constants,
    firstOrdinaryKind(tval),
    0,
    "minimise",
  );
  obj.number = number;
  return obj;
}

function kindByName(name: string, tval: number) {
  const k = reg.kinds.find((kk) => kk.name === name && kk.tval === tval);
  if (!k) throw new Error(`no kind ${name}`);
  return k;
}

/** A flask of oil (tval flask carries OF_THROWING). */
function makeFlask(number: number): GameObject {
  const obj = objectPrep(
    new Rng(1),
    reg,
    constants,
    kindByName("& Flask~ of oil", TV.FLASK),
    0,
    "minimise",
  );
  obj.number = number;
  return obj;
}

/** Push a stack straight into the pack list, bypassing inven_carry merging. */
function packAdd(gear: Gear, obj: GameObject): number {
  const h = gearAdd(gear, obj);
  gear.pack.push(h);
  return h;
}

/* ------------------------------------------------------------------ */
/* 4.1 preferred_quiver_slot (obj-gear.c L1396-1427)                    */
/* ------------------------------------------------------------------ */

describe("preferredQuiverSlot (obj-gear.c L1396)", () => {
  it("reads the @f<digit> inscription on ammo", () => {
    const arrows = makeObj(TV.ARROW, 10);
    arrows.note = "@f3";
    expect(preferredQuiverSlot(arrows)).toBe(3);
  });

  it("reads the @v<digit> throw inscription on a throwing item", () => {
    const flask = makeFlask(2);
    flask.note = "@v1";
    expect(preferredQuiverSlot(flask)).toBe(1);
  });

  it("uses 't' as the fire key under rogue-like commands", () => {
    const arrows = makeObj(TV.ARROW, 10);
    arrows.note = "@t4";
    expect(preferredQuiverSlot(arrows)).toBe(-1);
    expect(preferredQuiverSlot(arrows, true)).toBe(4);
  });

  it("returns -1 for non-quiver items and uninscribed ammo", () => {
    const potion = makeObj(TV.POTION);
    potion.note = "@f1";
    expect(preferredQuiverSlot(potion)).toBe(-1);
    expect(preferredQuiverSlot(makeObj(TV.ARROW, 5))).toBe(-1);
  });

  it("skips non-matching @ inscriptions and finds a later one", () => {
    const arrows = makeObj(TV.ARROW, 10);
    arrows.note = "@m2@f5";
    expect(preferredQuiverSlot(arrows)).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* 4.1 calc_inventory quiver assignment (player-calcs.c L1023-1238)     */
/* ------------------------------------------------------------------ */

describe("calcInventory (player-calcs.c calc_inventory)", () => {
  it("routes carried ammo into quiver slot 0", () => {
    const gear = newGear();
    const h = invenCarry(gear, makeObj(TV.ARROW, 30), limits);
    calcInventory(gear, constants);
    expect(gear.quiver![0]).toBe(h);
    expect(objectIsInQuiver(gear, h)).toBe(true);
    /* The stack stays on the master pack list (upstream: still on p->gear). */
    expect(gear.pack).toContain(h);
  });

  it("honours the @f inscription's preferred slot", () => {
    const gear = newGear();
    const arrows = makeObj(TV.ARROW, 10);
    arrows.note = "@f2";
    const h = invenCarry(gear, arrows, limits);
    calcInventory(gear, constants);
    expect(gear.quiver![2]).toBe(h);
    expect(gear.quiver![0]).toBe(0);
  });

  it("splits an inscribed throwing stack that overflows the slot", () => {
    /* 9 flasks x thrown_quiver_mult 5 = 45 > quiver_slot_size 40: nsplit = 8,
     * one flask splits back to the pack (player-calcs.c L1082-1107). */
    const gear = newGear();
    const flasks = makeFlask(9);
    flasks.note = "@v1";
    const h = packAdd(gear, flasks);
    calcInventory(gear, constants);
    expect(gear.quiver![1]).toBe(h);
    expect(gearGet(gear, h)!.number).toBe(8);
    /* The split-off remainder is a new pack stack of 1. */
    const others = gear.pack.filter((p) => p !== h);
    expect(others.length).toBe(1);
    expect(gearGet(gear, others[0]!)!.number).toBe(1);
  });

  it("fills remaining slots in earlier_object order (ammo ascending value)", () => {
    const gear = newGear();
    /* Two unlike arrow stacks (different notes make them non-stackable). */
    const a1 = makeObj(TV.ARROW, 5);
    a1.note = "first";
    const a2 = makeObj(TV.ARROW, 7);
    a2.note = "second";
    const h1 = packAdd(gear, a1);
    const h2 = packAdd(gear, a2);
    calcInventory(gear, constants);
    /* Equal kinds tie on every earlier_object key, so gear order stands. */
    expect(gear.quiver![0]).toBe(h1);
    expect(gear.quiver![1]).toBe(h2);
  });

  it("announces a re-arranged quiver only with character_dungeon", () => {
    const gear = newGear();
    const a1 = makeObj(TV.ARROW, 5);
    a1.note = "plain";
    const h1 = packAdd(gear, a1);
    calcInventory(gear, constants);
    expect(gear.quiver![0]).toBe(h1);

    /* Inscribe a second stack into slot 0's place via @f0 - the plain stack
     * moves and the message fires (player-calcs.c L1174-1182). */
    const a2 = makeObj(TV.ARROW, 6);
    a2.note = "@f0";
    packAdd(gear, a2);
    const msgs: string[] = [];
    calcInventory(gear, constants, {
      characterDungeon: true,
      msg: (t) => msgs.push(t),
    });
    expect(msgs).toContain("You re-arrange your quiver.");
  });

  it("non-ammo throwing items only enter their preferred (inscribed) slot", () => {
    const gear = newGear();
    const flask = makeFlask(2);
    /* Uninscribed: the ammo fill loop skips non-ammo (L1139 tval_is_ammo). */
    const h = packAdd(gear, flask);
    calcInventory(gear, constants);
    expect(gear.quiver!.every((q) => q === 0)).toBe(true);
    expect(objectIsInQuiver(gear, h)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 4.1 pack_slots_used quiver accounting (obj-gear.c L257-296)          */
/* ------------------------------------------------------------------ */

describe("packSlotsUsed (obj-gear.c pack_slots_used)", () => {
  it("counts a quivered ammo stack as quiver slots, not pack slots", () => {
    const gear = newGear();
    invenCarry(gear, makeObj(TV.ARROW, 30), limits);
    invenCarry(gear, makeObj(TV.POTION, 2), limits);
    /* Before calc_inventory, the arrows count as a regular pack slot. */
    expect(packSlotsUsed(gear, constants)).toBe(2);
    calcInventory(gear, constants);
    /* After: 30 quiver ammo -> ceil(30/40) = 1 slot, potions 1 slot. */
    expect(packSlotsUsed(gear, constants)).toBe(2);
  });

  it("aggregates quiver ammo across stacks into shared slot units", () => {
    const gear = newGear();
    const a1 = makeObj(TV.ARROW, 10);
    a1.note = "one";
    const a2 = makeObj(TV.ARROW, 10);
    a2.note = "two";
    packAdd(gear, a1);
    packAdd(gear, a2);
    calcInventory(gear, constants);
    /* 20 quiver ammo -> 0 full slots + 1 remainder slot, though the stacks
     * occupy two quiver slots (obj-gear.c L287-293). */
    expect(packSlotsUsed(gear, constants)).toBe(1);
  });

  it("weights throwing items by thrown_quiver_mult", () => {
    const gear = newGear();
    const flasks = makeFlask(8);
    flasks.note = "@v0";
    packAdd(gear, flasks);
    calcInventory(gear, constants);
    /* 8 flasks x 5 = 40 -> exactly one full quiver slot unit. */
    expect(packSlotsUsed(gear, constants)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 4.1 quiver_absorb_num / inven_carry_num (obj-gear.c L649, L749)      */
/* ------------------------------------------------------------------ */

describe("quiverAbsorbNum (obj-gear.c quiver_absorb_num)", () => {
  it("needs a free pack slot to open a new quiver slot (remainder 0)", () => {
    const gear = newGear();
    const arrows = makeObj(TV.ARROW, 10);
    /* Empty quiver: quiver_count % quiver_slot_size == 0, so adding anything
     * requires a pack slot (obj-gear.c L719-726). */
    expect(quiverAbsorbNum(gear, arrows, constants, 0).nToQuiver).toBe(0);
    const res = quiverAbsorbNum(gear, arrows, constants, 1);
    expect(res.nToQuiver).toBe(10);
    /* The 10 arrows consumed the offered pack slot. */
    expect(res.nAddPack).toBe(0);
  });

  it("absorbs into the remainder of a partially-filled quiver slot for free", () => {
    const gear = newGear();
    const inQuiver = makeObj(TV.ARROW, 30);
    const h = packAdd(gear, inQuiver);
    calcInventory(gear, constants);
    expect(gear.quiver![0]).toBe(h);
    /* 30 in the quiver: remainder 10 fits without any pack slot. */
    const more = makeObj(TV.ARROW, 10);
    const res = quiverAbsorbNum(gear, more, constants, 0);
    expect(res.nToQuiver).toBe(10);
    expect(res.nAddPack).toBe(0);
  });

  it("rejects non-ammo non-throwing items", () => {
    const gear = newGear();
    expect(
      quiverAbsorbNum(gear, makeObj(TV.POTION, 3), constants, 5).nToQuiver,
    ).toBe(0);
  });

  it("restricts a non-ammo throwing item to its preferred slot", () => {
    const gear = newGear();
    const flask = makeFlask(2);
    /* Uninscribed (desired_slot -1): no empty slot counts as usable space. */
    expect(quiverAbsorbNum(gear, flask, constants, 1).nToQuiver).toBe(0);
    flask.note = "@v1";
    expect(quiverAbsorbNum(gear, flask, constants, 1).nToQuiver).toBe(2);
  });
});

describe("invenCarryNum with a quiver (obj-gear.c inven_carry_num)", () => {
  it("accepts ammo the quiver can absorb", () => {
    const gear = newGear();
    const arrows = makeObj(TV.ARROW, 25);
    expect(invenCarryNum(gear, arrows, constants)).toBe(25);
  });

  /**
   * GR-01 (obj-gear.c:760-765): when the quiver expands into the last free pack
   * slot but still cannot hold the whole incoming stack, the >0 test must use
   * the DECREMENTED free-slot count (nAddPack), not the pre-call value. With one
   * free pack slot and a 60-arrow stack, the quiver absorbs 40 (one slot's worth,
   * consuming the last pack slot), so only 40 can be carried - the old code read
   * the stale nFreeSlot=1 and wrongly reported all 60.
   */
  it("does not over-report capacity when the quiver eats the last pack slot", () => {
    const gear = newGear();
    /* Fill 22 of 23 pack slots with non-ammo items (leaving one free). */
    for (let i = 0; i < 22; i++) packAdd(gear, makeObj(TV.LIGHT, 1, i + 1));
    expect(packSlotsUsed(gear, constants)).toBe(22); // nFreeSlot == 1

    /* A 60-arrow stack: the quiver takes 40 (one slot, expanding into the last
     * free pack slot); the remaining 20 have nowhere to go. */
    const arrows = makeObj(TV.ARROW, 60);
    expect(invenCarryNum(gear, arrows, constants)).toBe(40);
  });
});

/* ------------------------------------------------------------------ */
/* 4.1 inven_carry quiver stack mode (obj-gear.c L832-834)              */
/* ------------------------------------------------------------------ */

describe("invenCarry quiver stack-mode routing", () => {
  it("refuses a merge that would exceed the quiver's per-stack limit", () => {
    /* A quivered throwing stack merges under OSTACK_QUIVER: limit is
     * quiver_slot_size / thrown_quiver_mult = 8 flasks per slot. */
    const gear = newGear();
    const inQuiver = makeFlask(7);
    inQuiver.note = "@v0";
    const h = packAdd(gear, inQuiver);
    calcInventory(gear, constants);
    expect(gear.quiver![0]).toBe(h);

    const incoming = makeFlask(2);
    incoming.note = "@v0";
    const h2 = invenCarry(gear, incoming, limits);
    /* 7 + 2 = 9 > 8: no merge; a separate pack stack instead. Under plain
     * OSTACK_PACK (max_stack 40) they WOULD have merged. */
    expect(h2).not.toBe(h);
    expect(gearGet(gear, h)!.number).toBe(7);
    expect(gearGet(gear, h2)!.number).toBe(2);
  });

  it("still merges the same stacks under pack rules when not quivered", () => {
    const gear = newGear();
    const first = makeFlask(7);
    first.note = "@v0";
    const h = invenCarry(gear, first, limits);
    const incoming = makeFlask(2);
    incoming.note = "@v0";
    /* No calcInventory ran: not in the quiver, so OSTACK_PACK merges. */
    expect(invenCarry(gear, incoming, limits)).toBe(h);
    expect(gearGet(gear, h)!.number).toBe(9);
  });
});

/* ------------------------------------------------------------------ */
/* 4.2 minus_ac (obj-gear.c L376-438)                                   */
/* ------------------------------------------------------------------ */

describe("minusAc (obj-gear.c minus_ac)", () => {
  function armouredPlayer() {
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);
    const gear = newGear();
    const byType: Record<string, number> = {
      BODY_ARMOR: TV.SOFT_ARMOR,
      CLOAK: TV.CLOAK,
      SHIELD: TV.SHIELD,
      HAT: TV.HELM,
      GLOVES: TV.GLOVES,
      BOOTS: TV.BOOTS,
    };
    const worn: GameObject[] = [];
    for (let i = 0; i < body.count; i++) {
      const tval = byType[body.slots[i]!.type];
      if (tval === undefined) continue;
      const obj = makeObj(tval);
      obj.toA = 2; /* always damageable: ac + to_a > 0 */
      const h = gearAdd(gear, obj);
      player.equipment[i] = h;
      worn.push(obj);
    }
    return { player, gear, worn };
  }

  it("damages exactly one worn armour piece and reports it", () => {
    const { player, gear, worn } = armouredPlayer();
    const msgs: string[] = [];
    const updated = { count: 0 };
    const hit = minusAc(player, gear, new Rng(11), {
      msg: (t) => msgs.push(t),
      describe: () => "armour",
      updateBonuses: () => updated.count++,
    });
    expect(hit).toBe(true);
    expect(msgs).toEqual(["Your armour is damaged!"]);
    const damaged = worn.filter((o) => o.toA === 1);
    expect(damaged.length).toBe(1);
    expect(updated.count).toBe(1); /* PU_BONUS fired */
  });

  it("acid-proof armour is unaffected but still counts as an effect", () => {
    const { player, gear, worn } = armouredPlayer();
    for (const o of worn) {
      const el = o.elInfo[ELEM.ACID]!;
      el.flags |= EL_INFO_IGNORE;
    }
    const msgs: string[] = [];
    const hit = minusAc(player, gear, new Rng(11), {
      msg: (t) => msgs.push(t),
      describe: () => "armour",
    });
    expect(hit).toBe(true);
    expect(msgs).toEqual(["Your armour is unaffected!"]);
    expect(worn.every((o) => o.toA === 2)).toBe(true);
  });

  it("returns false when the picked slot is empty", () => {
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);
    const gear = newGear();
    /* Something carried (the L382 no-gear guard must not trip)... */
    invenCarry(gear, makeObj(TV.POTION), limits);
    /* ...but nothing worn: whichever armour slot is picked is empty. */
    expect(minusAc(player, gear, new Rng(3))).toBe(false);
  });

  it("returns false with no gear at all (the L382 crash guard)", () => {
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);
    expect(minusAc(player, newGear(), new Rng(3))).toBe(false);
  });

  it("draws the slot pick from the RNG (stream-faithful reverse scan)", () => {
    /* Same seed twice -> same slot; the pick is a pure function of the RNG
     * stream (one_in_(count--) from the last armour slot down, L397-407). */
    const a = armouredPlayer();
    const b = armouredPlayer();
    minusAc(a.player, a.gear, new Rng(99), {});
    minusAc(b.player, b.gear, new Rng(99), {});
    const idxA = a.worn.findIndex((o) => o.toA === 1);
    const idxB = b.worn.findIndex((o) => o.toA === 1);
    expect(idxA).toBe(idxB);
    expect(idxA).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ */
/* 4.4 combine_pack + inven_can_stack_partial (obj-gear.c L1242, L1183) */
/* ------------------------------------------------------------------ */

describe("combinePack (obj-gear.c combine_pack)", () => {
  it("merges two identical stacks that coexist after a takeoff", () => {
    const gear = newGear();
    const first = makeObj(TV.POTION, 2);
    const second = makeObj(TV.POTION, 3);
    const h1 = packAdd(gear, first);
    const h2 = packAdd(gear, second);
    const msgs: string[] = [];
    const combined = combinePack(gear, constants, { msg: (t) => msgs.push(t) });
    expect(combined).toBe(true);
    expect(msgs).toContain("You combine some items in your pack.");
    expect(gear.pack).toEqual([h1]);
    expect(gearGet(gear, h1)!.number).toBe(5);
    expect(gearGet(gear, h2)).toBeNull();
  });

  it("partial-merges uneven stacks, maximising the leading stack", () => {
    const gear = newGear();
    const lead = makeObj(TV.POTION, 30);
    const tail = makeObj(TV.POTION, 20);
    const h1 = packAdd(gear, lead);
    const h2 = packAdd(gear, tail);
    /* 50 > max_stack 40: no full merge; inven_can_stack_partial shifts items
     * so the leading stack hits the limit (obj-gear.c L1280-1301). */
    const combined = combinePack(gear, constants);
    expect(combined).toBe(false); /* shuffles are not announced */
    expect(gearGet(gear, h1)!.number).toBe(40);
    expect(gearGet(gear, h2)!.number).toBe(10);
    expect(gear.pack).toEqual([h1, h2]);
  });

  it("does not partial-merge into a stack already at its limit", () => {
    const gear = newGear();
    const lead = makeObj(TV.POTION, 40);
    const tail = makeObj(TV.POTION, 5);
    const h1 = packAdd(gear, lead);
    const h2 = packAdd(gear, tail);
    combinePack(gear, constants);
    expect(gearGet(gear, h1)!.number).toBe(40);
    expect(gearGet(gear, h2)!.number).toBe(5);
  });

  it("re-derives the quiver afterward (calc_inventory at L1307)", () => {
    const gear = newGear();
    const h = packAdd(gear, makeObj(TV.ARROW, 12));
    combinePack(gear, constants);
    expect(gear.quiver![0]).toBe(h);
  });
});

/* ------------------------------------------------------------------ */
/* 1.6 / 1.8 player_outfit birth options (player-birth.c L612-637)      */
/* ------------------------------------------------------------------ */

describe("outfitPlayer birth options", () => {
  it("honours birth_start_kit read from the option accessor (gap 1.6)", () => {
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);
    outfitPlayer(gear, player, reg, new Rng(7), constants, {
      opt: (name) => (name === "birth_start_kit" ? false : false),
    });
    /* Only 1 food (pack) + 1 light (wielded), as with startKit: false. */
    const lightSlot = body.slots.findIndex((s) => s.type === "LIGHT");
    expect(player.equipment[lightSlot]).not.toBe(0);
    expect(gear.pack.length).toBe(1);
    const food = gearGet(gear, gear.pack[0]!)!;
    expect(food.tval).toBe(TV.FOOD);
    expect(food.number).toBe(1);
  });

  it("excludes a start item whose eopts option is set (gap 1.8)", () => {
    const { race, cls, body } = humanWarrior();
    const potionItem = cls.startItems.find((si) => si.tval === "potion");
    expect(potionItem).toBeDefined();
    /* A synthetic option name, so the class's REAL eopts (birth_no_recall on
     * the Word of Recall scroll) stay out of the way. */
    const clsNoPotion = {
      ...cls,
      startItems: cls.startItems.map((si) =>
        si.tval === "potion" ? { ...si, eopts: ["birth_test_excl"] } : si,
      ),
    };
    const gear = newGear();
    const player = blankPlayer(race, clsNoPotion, body);
    outfitPlayer(gear, player, reg, new Rng(42), constants, {
      /* birth_start_kit ON (its upstream default), the exclusion SET. */
      opt: (name) =>
        name === "birth_start_kit" || name === "birth_test_excl",
    });
    const packTvals = gear.pack.map((h) => gearGet(gear, h)!.tval);
    expect(packTvals).not.toContain(TV.POTION);
    expect(packTvals).toContain(TV.FOOD);
  });

  it("real content: birth_no_recall strips the Word of Recall scroll", () => {
    /* The shipped Warrior kit carries eopts birth_no_recall on its scroll of
     * Word of Recall (class.txt), so the live data exercises the branch. */
    const { race, cls, body } = humanWarrior();
    const gear = newGear();
    const player = blankPlayer(race, cls, body);
    outfitPlayer(gear, player, reg, new Rng(42), constants, {
      opt: (name) =>
        name === "birth_start_kit" || name === "birth_no_recall",
    });
    const packTvals = gear.pack.map((h) => gearGet(gear, h)!.tval);
    expect(packTvals).not.toContain(TV.SCROLL);
    expect(packTvals).toContain(TV.POTION);
  });

  it("keeps the item when its plain eopts option is unset", () => {
    const { race, cls, body } = humanWarrior();
    const clsMarked = {
      ...cls,
      startItems: cls.startItems.map((si) =>
        si.tval === "potion" ? { ...si, eopts: ["birth_test_excl"] } : si,
      ),
    };
    const gear = newGear();
    const player = blankPlayer(race, clsMarked, body);
    outfitPlayer(gear, player, reg, new Rng(42), constants, {
      opt: (name) => name === "birth_start_kit",
    });
    const packTvals = gear.pack.map((h) => gearGet(gear, h)!.tval);
    expect(packTvals).toContain(TV.POTION);
  });

  it("NOT- prefixed eopts exclude when the option is UNSET (init.c L3619)", () => {
    const { race, cls, body } = humanWarrior();
    const clsNot = {
      ...cls,
      startItems: cls.startItems.map((si) =>
        si.tval === "potion" ? { ...si, eopts: ["NOT-birth_test_excl"] } : si,
      ),
    };
    const mk = (optValue: boolean) => {
      const gear = newGear();
      const player = blankPlayer(race, clsNot, body);
      outfitPlayer(gear, player, reg, new Rng(42), constants, {
        opt: (name) =>
          name === "birth_start_kit"
            ? true
            : name === "birth_test_excl"
              ? optValue
              : false,
      });
      return gear.pack.map((h) => gearGet(gear, h)!.tval);
    };
    expect(mk(false)).not.toContain(TV.POTION);
    expect(mk(true)).toContain(TV.POTION);
  });

  it("preserves the RNG stream: the count roll happens before exclusion", () => {
    /* Upstream rolls rand_range(min, max) BEFORE the eopts continue
     * (player-birth.c L607 vs L619), so an excluded item still consumes its
     * roll. Two outfits from the same seed - one excluding the potion - must
     * agree on every OTHER item's count. */
    const { race, cls, body } = humanWarrior();
    const clsMarked = {
      ...cls,
      startItems: cls.startItems.map((si) =>
        si.tval === "potion" ? { ...si, eopts: ["birth_test_excl"] } : si,
      ),
    };
    const counts = (excludePotion: boolean) => {
      const gear = newGear();
      const player = blankPlayer(race, clsMarked, body);
      outfitPlayer(gear, player, reg, new Rng(123), constants, {
        opt: (name) =>
          name === "birth_start_kit"
            ? true
            : name === "birth_test_excl"
              ? excludePotion
              : false,
      });
      const out = new Map<number, number>();
      for (const h of gear.pack) {
        const o = gearGet(gear, h)!;
        if (o.tval !== TV.POTION) out.set(o.tval, o.number);
      }
      return out;
    };
    expect(counts(true)).toEqual(counts(false));
  });
});

/* ------------------------------------------------------------------ */
/* earlier_object (player-calcs.c L934-1003)                            */
/* ------------------------------------------------------------------ */

describe("earlierObject (player-calcs.c earlier_object)", () => {
  it("handles null endpoints", () => {
    const potion = makeObj(TV.POTION);
    expect(earlierObject(null, potion)).toBe(true);
    expect(earlierObject(potion, null)).toBe(false);
  });

  it("sorts by decreasing tval", () => {
    const sword = makeObj(TV.SWORD);
    const potion = makeObj(TV.POTION);
    /* TV_SWORD (23) > TV_POTION (75)? No: potion tval is larger. The larger
     * tval comes FIRST (orig.tval < new.tval -> replace). */
    const bigger = sword.tval > potion.tval ? sword : potion;
    const smaller = bigger === sword ? potion : sword;
    expect(earlierObject(smaller, bigger)).toBe(true);
    expect(earlierObject(bigger, smaller)).toBe(false);
  });

  it("prefers usable ammo via state.ammo_tval", () => {
    const arrow = makeObj(TV.ARROW);
    const bolt = makeObj(TV.BOLT);
    expect(earlierObject(arrow, bolt, { ammoTval: TV.BOLT })).toBe(true);
    expect(earlierObject(bolt, arrow, { ammoTval: TV.BOLT })).toBe(false);
  });

  it("sorts ammo by INCREASING value, other items by decreasing value", () => {
    const a1 = makeObj(TV.ARROW);
    const a2 = makeObj(TV.ARROW);
    const cheapFirst = { objectValue: (o: GameObject) => (o === a1 ? 5 : 1) };
    expect(earlierObject(a1, a2, cheapFirst)).toBe(true);

    const p1 = makeObj(TV.POTION);
    const p2 = makeObj(TV.POTION);
    /* Same kind/sval: only the value branch separates them. */
    const richFirst = { objectValue: (o: GameObject) => (o === p2 ? 9 : 1) };
    expect(earlierObject(p1, p2, richFirst)).toBe(true);
    expect(earlierObject(p2, p1, richFirst)).toBe(false);
  });

  it("sorts lights by decreasing fuel (pval)", () => {
    const t1 = makeObj(TV.LIGHT);
    const t2 = makeObj(TV.LIGHT);
    t1.pval = 100;
    t2.pval = 500;
    expect(earlierObject(t1, t2)).toBe(true);
    expect(earlierObject(t2, t1)).toBe(false);
  });

  it("puts readable books first outside stores", () => {
    /* Book kinds live in the class data, not the object registry, so mark a
     * stand-in object browsable through the obj_can_browse hook. */
    const potion = makeObj(TV.POTION);
    const book = makeObj(TV.SWORD);
    const canBrowse = (o: GameObject) => o === book;
    expect(earlierObject(potion, book, { canBrowse })).toBe(true);
    expect(earlierObject(book, potion, { canBrowse })).toBe(false);
    /* In a store the book branch is skipped: plain tval ordering decides. */
    expect(earlierObject(potion, book, { canBrowse, store: true })).toBe(
      book.tval > potion.tval,
    );
  });
});
