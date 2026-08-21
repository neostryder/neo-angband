/**
 * Upstream unit tests from reference/src/tests/player/calc-inventory.c
 *
 * Mapping: calc_inventory -> calcInventory (game/gear.ts).
 *
 * The port's calcInventory implements the quiver-assignment half of
 * player-calcs.c:1023-1238. The pack/inven[] reorder half is intentionally a
 * no-op (gear.pack is the raw listing; display ordering is a UI concern), so
 * upstream's `pack_out` ORDER has no port counterpart. Its CONTENTS are still
 * asserted exactly, as an order-insensitive multiset: which stacks stay out of
 * the quiver, and with what counts after splits, is core behaviour.
 * See parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-player.md.
 *
 * Book kinds are synthesised from class.txt at init upstream
 * (init.c write_book_kind); the port does the same in
 * registerBookKinds (player/spell.ts), which this file calls so the
 * TV_MAGIC_BOOK / TV_NATURE_BOOK / TV_PRAYER_BOOK rows of upstream's fixtures
 * are present verbatim rather than skipped.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { OF, TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import { tvalIsAmmo } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import { registerBookKinds } from "../player/spell.js";
import { Rng } from "../rng.js";
import {
  calcInventory,
  gearAdd,
  gearGet,
  newGear,
  packSlotsUsed,
  wieldSlot,
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
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
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

/* init.c write_book_kind: the class books become real object kinds at init, so
 * lookup_kind(TV_MAGIC_BOOK, 1) resolves in upstream's setup_tests. Do the same
 * here; without it the book rows of upstream's fixtures cannot be built. */
registerBookKinds(reg, players.classes);

function mage(): Player {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Mage")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

/**
 * lookup_kind. NO fallback: upstream's populate_gear fails the test outright
 * when a fixture kind is missing, so a missing kind must throw rather than
 * silently substitute a different one.
 */
function kind(tval: number, sval: number) {
  const k = reg.lookupKind(tval, sval);
  if (!k) throw new Error(`no kind ${tval}/${sval}`);
  return k;
}

interface InSlot {
  tval: number;
  sval: number;
  num: number;
  equipped?: boolean;
  note?: string;
}
interface OutSlot {
  tval: number;
  sval: number;
  num: number;
}

function makeObj(s: InSlot, seed = 1): GameObject {
  const obj = objectPrep(new Rng(seed), reg, constants, kind(s.tval, s.sval), 0, "minimise");
  obj.number = s.num;
  if (s.note) obj.note = s.note;
  return obj;
}

function flush(gear: Gear, p: Player): void {
  gear.store.clear();
  gear.pack = [];
  gear.quiver = [];
  gear.next = 1;
  p.equipment.fill(0);
}

function populate(gear: Gear, p: Player, slots: InSlot[]): void {
  for (const s of slots) {
    const obj = makeObj(s);
    const h = gearAdd(gear, obj);
    if (s.equipped) {
      const slot = wieldSlot(p.body, obj.tval, p.equipment);
      p.equipment[slot] = h;
    } else {
      gear.pack.push(h);
    }
  }
}

function packNonQuiver(gear: Gear): GameObject[] {
  const out: GameObject[] = [];
  for (const h of gear.pack) {
    if (gear.quiver?.includes(h)) continue;
    const obj = gearGet(gear, h);
    if (obj) out.push(obj);
  }
  return out;
}

/** A "tval/sval xN" tag, so a mismatch prints a readable diff. */
function tag(o: { tval: number; kind: { sval: number }; number: number }): string {
  return `${o.tval}/${o.kind.sval} x${o.number}`;
}
function tagExpected(e: OutSlot): string {
  return `${e.tval}/${e.sval} x${e.num}`;
}

/**
 * verify_pack (calc-inventory.c:136-174), CONTENTS half. Upstream also pins
 * upkeep->inven[] ORDER; the port has no inven[] (see the header), so the pack
 * is compared as a sorted multiset. Slot accounting (curr_slot +
 * slots_for_quiver == n_slots_used, L170) is asserted exactly.
 */
function packContents(gear: Gear): string[] {
  return packNonQuiver(gear).map(tag).sort();
}
function expectedContents(expected: OutSlot[]): string[] {
  return expected.map(tagExpected).sort();
}

/** verify_quiver (calc-inventory.c:177-229): the quiver slot layout, in order. */
function quiverLayout(gear: Gear): string[] {
  const q = gear.quiver ?? [];
  const out: string[] = [];
  for (let i = 0; i < constants.quiverSize; i++) {
    const h = q[i] ?? 0;
    if (!h) {
      out.push("-");
      continue;
    }
    const obj = gearGet(gear, h);
    out.push(obj ? tag(obj) : "MISSING");
  }
  return out;
}
function expectedQuiver(expected: OutSlot[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < constants.quiverSize; i++) {
    const e = expected[i];
    if (!e || e.tval === 0) out.push("-");
    else out.push(tagExpected(e));
  }
  return out;
}

/**
 * verify_stability (calc-inventory.c:231-263): a second calc_inventory over
 * unchanged gear must reproduce the first result. Upstream reads
 * player->state.ammo_tval off the global player inside earlier_object
 * (player-calcs.c:948-956), so BOTH calls see the same ammo preference, and the
 * port must therefore be handed IDENTICAL opts, or the two calls are different
 * experiments and the check measures the argument default instead.
 */
function stability(
  gear: Gear,
  opts: Parameters<typeof calcInventory>[2],
): { quiver: string[]; pack: string[] } {
  calcInventory(gear, constants, opts);
  return { quiver: quiverLayout(gear), pack: packContents(gear) };
}

/**
 * The slot budget upstream's verify_pack takes as `slots_for_quiver`
 * (calc-inventory.c:388-390, 474-476, 537-539, 603-605): the quiver's weighted
 * total rounded up to whole quiver_slot_size slots.
 */
function quiverSlots(total: number): number {
  return Math.trunc((total + constants.quiverSlotSize - 1) / constants.quiverSlotSize);
}

describe("player/calc-inventory (reference/src/tests/player/calc-inventory.c)", () => {
  // upstream: test_calc_inventory_empty
  it("calc_inventory empty", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    calcInventory(gear, constants);
    expect(packContents(gear)).toEqual([]);
    expect(quiverLayout(gear)).toEqual(expectedQuiver([]));
    expect(packSlotsUsed(gear, constants)).toBe(0);
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver([]),
      pack: [],
    });
  });

  // upstream: test_calc_inventory_only_equipped
  it("calc_inventory only equipped", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.SWORD, sval: 1, num: 1, equipped: true },
      { tval: TV.BOW, sval: 2, num: 1, equipped: true },
      { tval: TV.SHIELD, sval: 1, num: 1, equipped: true },
      { tval: TV.CLOAK, sval: 1, num: 1, equipped: true },
      { tval: TV.SOFT_ARMOR, sval: 2, num: 1, equipped: true },
    ]);
    calcInventory(gear, constants);
    expect(packContents(gear)).toEqual([]);
    expect(quiverLayout(gear)).toEqual(expectedQuiver([]));
    /* Equipped items occupy no pack slot (verify_pack L164-166, L170). */
    expect(packSlotsUsed(gear, constants)).toBe(0);
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver([]),
      pack: [],
    });
  });

  // upstream: test_calc_inventory_only_pack
  it("calc_inventory only pack", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.SCROLL, sval: 5, num: 3 },
      { tval: TV.WAND, sval: 3, num: 1 },
      { tval: TV.FOOD, sval: 2, num: 4 },
      { tval: TV.ROD, sval: 2, num: 2 },
      { tval: TV.POTION, sval: 4, num: 5 },
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1 },
      { tval: TV.LIGHT, sval: 1, num: 6 },
      { tval: TV.DIGGING, sval: 1, num: 1 },
      { tval: TV.FLASK, sval: 1, num: 1 },
      { tval: TV.STAFF, sval: 3, num: 1 },
    ]);
    calcInventory(gear, constants);
    /* Upstream pack_out (L318-330); ORDER is the deferred inven[] half. */
    const packOut: OutSlot[] = [
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1 },
      { tval: TV.FOOD, sval: 2, num: 4 },
      { tval: TV.FLASK, sval: 1, num: 1 },
      { tval: TV.POTION, sval: 4, num: 5 },
      { tval: TV.SCROLL, sval: 5, num: 3 },
      { tval: TV.ROD, sval: 2, num: 2 },
      { tval: TV.WAND, sval: 3, num: 1 },
      { tval: TV.STAFF, sval: 3, num: 1 },
      { tval: TV.LIGHT, sval: 1, num: 6 },
      { tval: TV.DIGGING, sval: 1, num: 1 },
    ];
    expect(packContents(gear)).toEqual(expectedContents(packOut));
    /* The uninscribed flask is not ammo, so nothing reaches the quiver. */
    expect(quiverLayout(gear)).toEqual(expectedQuiver([]));
    expect(packSlotsUsed(gear, constants)).toBe(packOut.length);
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver([]),
      pack: expectedContents(packOut),
    });
  });

  // upstream: test_calc_inventory_only_quiver
  it("calc_inventory only quiver", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.BOLT, sval: 1, num: 20 },
      /* spear */
      { tval: TV.POLEARM, sval: 1, num: 1, note: "@v1" },
      { tval: TV.SHOT, sval: 1, num: 27 },
      { tval: TV.ARROW, sval: 1, num: 15 },
    ]);
    /* require(of_has(obj->flags, OF_THROWING)) on the spear (L379): were the
     * spear not a throwing weapon the @v1 inscription would not send it to the
     * quiver and the whole fixture would be meaningless. */
    const spearH = gear.pack.find((h) => gearGet(gear, h)?.tval === TV.POLEARM)!;
    const spear = gearGet(gear, spearH)!;
    expect(spear.flags.has(OF.THROWING)).toBe(true);

    /* quiver_size, exactly as L376-386. */
    let quiverSize = 0;
    for (const h of gear.pack) {
      const obj = gearGet(gear, h)!;
      if (obj.tval === TV.POLEARM) {
        quiverSize += constants.thrownQuiverMult * obj.number;
      } else {
        quiverSize += obj.number;
      }
    }
    calcInventory(gear, constants);
    /* No launcher equipped, so ammunition orders by decreasing tval (L354-364). */
    const quivOut: OutSlot[] = [
      { tval: TV.BOLT, sval: 1, num: 20 },
      { tval: TV.POLEARM, sval: 1, num: 1 },
      { tval: TV.ARROW, sval: 1, num: 15 },
      { tval: TV.SHOT, sval: 1, num: 27 },
    ];
    expect(quiverLayout(gear)).toEqual(expectedQuiver(quivOut));
    expect(packContents(gear)).toEqual([]);
    expect(packSlotsUsed(gear, constants)).toBe(quiverSlots(quiverSize));
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver(quivOut),
      pack: [],
    });
  });

  // upstream: test_calc_inventory_equipped_pack_quiver
  it("calc_inventory equipped/pack/quiver", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.BOLT, sval: 1, num: 10 },
      { tval: TV.SCROLL, sval: 3, num: 4 },
      { tval: TV.SOFT_ARMOR, sval: 2, num: 1, equipped: true },
      /* dagger, inscribed for the quiver */
      { tval: TV.SWORD, sval: 1, num: 1, note: "@v2" },
      { tval: TV.POTION, sval: 2, num: 3 },
      { tval: TV.ARROW, sval: 2, num: 7 },
      { tval: TV.SHOT, sval: 1, num: 13 },
      { tval: TV.ARROW, sval: 1, num: 15 },
      { tval: TV.NATURE_BOOK, sval: 1, num: 1 },
      { tval: TV.SCROLL, sval: 1, num: 3 },
      { tval: TV.POTION, sval: 3, num: 1 },
      { tval: TV.PRAYER_BOOK, sval: 1, num: 1 },
      { tval: TV.BOLT, sval: 2, num: 5 },
      { tval: TV.SHOT, sval: 2, num: 3 },
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1 },
      /* sling */
      { tval: TV.BOW, sval: 1, num: 1, equipped: true },
      { tval: TV.POTION, sval: 5, num: 2 },
    ]);
    /* require(of_has(obj->flags, OF_THROWING)) on the dagger (L465). */
    const daggerH = gear.pack.find((h) => gearGet(gear, h)?.tval === TV.SWORD)!;
    expect(gearGet(gear, daggerH)!.flags.has(OF.THROWING)).toBe(true);

    /* quiver_size, exactly as L461-472. */
    let quiverSize = 0;
    for (const h of gear.pack) {
      const obj = gearGet(gear, h)!;
      if (obj.tval === TV.SWORD) {
        quiverSize += constants.thrownQuiverMult * obj.number;
      } else if (tvalIsAmmo(obj.tval)) {
        quiverSize += obj.number;
      }
    }

    /* A sling is equipped: player->state.ammo_tval is TV_SHOT, which
     * earlier_object reads off the global player (player-calcs.c:948-956). */
    const opts = { ammoTval: TV.SHOT };
    calcInventory(gear, constants, opts);
    const quivOut: OutSlot[] = [
      { tval: TV.SHOT, sval: 1, num: 13 },
      { tval: TV.SHOT, sval: 2, num: 3 },
      { tval: TV.SWORD, sval: 1, num: 1 },
      { tval: TV.BOLT, sval: 1, num: 10 },
      { tval: TV.BOLT, sval: 2, num: 5 },
      { tval: TV.ARROW, sval: 1, num: 15 },
      { tval: TV.ARROW, sval: 2, num: 7 },
    ];
    const packOut: OutSlot[] = [
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1 },
      { tval: TV.NATURE_BOOK, sval: 1, num: 1 },
      { tval: TV.PRAYER_BOOK, sval: 1, num: 1 },
      { tval: TV.POTION, sval: 3, num: 1 },
      { tval: TV.POTION, sval: 5, num: 2 },
      { tval: TV.POTION, sval: 2, num: 3 },
      { tval: TV.SCROLL, sval: 3, num: 4 },
      { tval: TV.SCROLL, sval: 1, num: 3 },
    ];
    expect(quiverLayout(gear)).toEqual(expectedQuiver(quivOut));
    expect(packContents(gear)).toEqual(expectedContents(packOut));
    expect(packSlotsUsed(gear, constants)).toBe(
      packOut.length + quiverSlots(quiverSize),
    );
    /* verify_stability with the SAME opts, so the second pass is the same
     * experiment (calc-inventory.c:231-263). */
    expect(stability(gear, opts)).toEqual({
      quiver: expectedQuiver(quivOut),
      pack: expectedContents(packOut),
    });
  });

  // upstream: test_calc_inventory_oversubscribed_quiver
  it("calc_inventory oversubscribed quiver", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.SHOT, sval: 2, num: 40 },
      { tval: TV.ARROW, sval: 1, num: 40 },
      { tval: TV.BOLT, sval: 1, num: 40 },
      { tval: TV.ARROW, sval: 1, num: 40 },
      { tval: TV.SHOT, sval: 2, num: 40 },
      { tval: TV.ARROW, sval: 2, num: 10 },
      /* short bow */
      { tval: TV.BOW, sval: 2, num: 1, equipped: true },
      { tval: TV.BOLT, sval: 3, num: 7 },
      { tval: TV.ARROW, sval: 3, num: 15 },
      { tval: TV.BOLT, sval: 1, num: 40 },
      { tval: TV.SHOT, sval: 1, num: 25 },
      { tval: TV.BOLT, sval: 2, num: 12 },
      { tval: TV.SHOT, sval: 3, num: 17 },
    ]);
    /* quiver_size, exactly as L526-535: all ammo, less the 57 that overflow. */
    let quiverSize = 0;
    for (const h of gear.pack) {
      const obj = gearGet(gear, h)!;
      if (tvalIsAmmo(obj.tval)) quiverSize += obj.number;
    }
    quiverSize -= 57;

    /* A short bow is equipped: ammo_tval is TV_ARROW. */
    const opts = { ammoTval: TV.ARROW };
    calcInventory(gear, constants, opts);
    const quivOut: OutSlot[] = [
      { tval: TV.ARROW, sval: 1, num: 40 },
      { tval: TV.ARROW, sval: 1, num: 40 },
      { tval: TV.ARROW, sval: 2, num: 10 },
      { tval: TV.ARROW, sval: 3, num: 15 },
      { tval: TV.BOLT, sval: 1, num: 40 },
      { tval: TV.BOLT, sval: 1, num: 40 },
      { tval: TV.BOLT, sval: 2, num: 12 },
      { tval: TV.BOLT, sval: 3, num: 7 },
      { tval: TV.SHOT, sval: 1, num: 25 },
      { tval: TV.SHOT, sval: 2, num: 40 },
    ];
    /* Upstream pack_out (L501-505): the stacks the full quiver cannot take. */
    const packOut: OutSlot[] = [
      { tval: TV.SHOT, sval: 2, num: 40 },
      { tval: TV.SHOT, sval: 3, num: 17 },
    ];
    expect(quiverLayout(gear)).toEqual(expectedQuiver(quivOut));
    expect(packContents(gear)).toEqual(expectedContents(packOut));
    expect(packSlotsUsed(gear, constants)).toBe(
      packOut.length + quiverSlots(quiverSize),
    );
    expect(stability(gear, opts)).toEqual({
      quiver: expectedQuiver(quivOut),
      pack: expectedContents(packOut),
    });
  });

  // upstream: test_calc_inventory_oversubscribed_quiver_slot
  it("calc_inventory oversubscribed quiver slot", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.BOLT, sval: 1, num: 10 },
      /* dagger */
      { tval: TV.SWORD, sval: 1, num: 1 },
      { tval: TV.ARROW, sval: 2, num: 7 },
      { tval: TV.SHOT, sval: 1, num: 13 },
      /* spear */
      { tval: TV.POLEARM, sval: 1, num: 1 },
      { tval: TV.ARROW, sval: 1, num: 15 },
      { tval: TV.BOLT, sval: 2, num: 5 },
      { tval: TV.SHOT, sval: 2, num: 3 },
    ]);
    /* Inscribe with more than one item targeting each slot, and total the
     * quiver size, exactly as L585-601. */
    let i = 0;
    let quiverSize = 0;
    for (const h of gear.pack) {
      const obj = gearGet(gear, h)!;
      if (tvalIsAmmo(obj.tval)) {
        obj.note = `@f${Math.floor(i / 2)}`;
        quiverSize += obj.number;
      } else {
        obj.note = `@v${Math.floor(i / 2)}`;
        if (i % 2 === 0) quiverSize += constants.thrownQuiverMult * obj.number;
      }
      i++;
    }
    calcInventory(gear, constants);
    const packOut: OutSlot[] = [{ tval: TV.SWORD, sval: 1, num: 1 }];
    const quivOut: OutSlot[] = [
      { tval: TV.BOLT, sval: 1, num: 10 },
      { tval: TV.ARROW, sval: 2, num: 7 },
      { tval: TV.POLEARM, sval: 1, num: 1 },
      { tval: TV.BOLT, sval: 2, num: 5 },
      { tval: TV.ARROW, sval: 1, num: 15 },
      { tval: TV.SHOT, sval: 1, num: 13 },
      { tval: TV.SHOT, sval: 2, num: 3 },
    ];
    expect(quiverLayout(gear)).toEqual(expectedQuiver(quivOut));
    expect(packContents(gear)).toEqual(expectedContents(packOut));
    expect(packSlotsUsed(gear, constants)).toBe(
      packOut.length + quiverSlots(quiverSize),
    );
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver(quivOut),
      pack: expectedContents(packOut),
    });
  });

  // upstream: test_calc_inventory_quiver_split_pile
  it("calc_inventory split pile for quiver", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [{ tval: TV.FLASK, sval: 1, num: 10, note: "@v1" }]);
    calcInventory(gear, constants);
    const packOut: OutSlot[] = [{ tval: TV.FLASK, sval: 1, num: 2 }];
    const quivOut: OutSlot[] = [
      { tval: 0, sval: 0, num: 0 },
      { tval: TV.FLASK, sval: 1, num: 8 },
    ];
    expect(quiverLayout(gear)).toEqual(expectedQuiver(quivOut));
    expect(packContents(gear)).toEqual(expectedContents(packOut));
    expect(packSlotsUsed(gear, constants)).toBe(packOut.length + 1);
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver(quivOut),
      pack: expectedContents(packOut),
    });
  });

  // upstream: test_calc_inventory_equipped_throwing_inscribed
  it("calc_inventory equipped throwing inscribed", () => {
    const gear = newGear();
    const p = mage();
    flush(gear, p);
    populate(gear, p, [
      { tval: TV.SWORD, sval: 1, num: 1, equipped: true, note: "@v1" },
    ]);
    calcInventory(gear, constants);
    /* An equipped item never enters the quiver, inscription or not. */
    expect(quiverLayout(gear)).toEqual(expectedQuiver([]));
    expect(packContents(gear)).toEqual([]);
    expect(packSlotsUsed(gear, constants)).toBe(0);
    expect(stability(gear, {})).toEqual({
      quiver: expectedQuiver([]),
      pack: [],
    });
  });
});
