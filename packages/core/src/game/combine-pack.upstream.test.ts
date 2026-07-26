/**
 * Upstream unit tests from reference/src/tests/player/combine-pack.c
 *
 * Mapping: combine_pack -> combinePack (game/gear.ts).
 * Gear is the port's handle-based store; equipped items live on player.equipment
 * and non-equipped on gear.pack (with quiver view from calcInventory).
 * verify_gear walks gear.store in insertion order, which is the port's
 * equivalent of upstream's p->gear linked list for these fixtures.
 *
 * Book kinds are synthesised from class.txt at init upstream
 * (init.c write_book_kind); the port does the same in registerBookKinds
 * (player/spell.ts), called here so upstream's TV_MAGIC_BOOK rows are used
 * verbatim rather than substituted.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import type { Constants } from "../constants";
import { ORIGIN, TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { registerBookKinds } from "../player/spell";
import { Rng } from "../rng";
import {
  calcInventory,
  combinePack,
  gearAdd,
  newGear,
  wieldSlot,
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
const baseConstants = bindConstants(loadJson("constants"));

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

/* init.c write_book_kind, run at init upstream. */
registerBookKinds(reg, players.classes);

function human(): Player {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

/**
 * lookup_kind. NO fallback: upstream's populate_gear fails the test when a
 * fixture kind is missing, so a missing kind must throw rather than silently
 * substitute a different one (which would make the fixture a different test).
 */
function kind(tval: number, sval: number) {
  const k = reg.lookupKind(tval, sval);
  if (!k) throw new Error(`no kind tval=${tval} sval=${sval}`);
  return k;
}

interface InSlot {
  tval: number;
  sval: number;
  num: number;
  inscrip?: string;
  origin: number;
  originDepth: number;
  known?: boolean;
  equipped?: boolean;
}
interface OutSlot {
  tval: number;
  sval: number;
  num: number;
  origin: number;
  originDepth: number;
  equipped: boolean;
}

function makeObj(s: InSlot, seed = 1): GameObject {
  const obj = objectPrep(new Rng(seed), reg, baseConstants, kind(s.tval, s.sval), 0, "minimise");
  obj.number = s.num;
  obj.origin = s.origin;
  obj.originDepth = s.originDepth;
  if (s.inscrip) obj.note = s.inscrip;
  return obj;
}

function flushGear(gear: Gear, p: Player): void {
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
      if (slot < 0) throw new Error("cannot equip");
      p.equipment[slot] = h;
    } else {
      gear.pack.push(h);
    }
  }
}

/**
 * Master gear order: Map insertion order (gearAdd sequence), matching upstream
 * p->gear linked-list order for these tests.
 */
function gearList(gear: Gear, p: Player): Array<{ obj: GameObject; equipped: boolean }> {
  const out: Array<{ obj: GameObject; equipped: boolean }> = [];
  for (const [h, obj] of gear.store) {
    out.push({ obj, equipped: p.equipment.includes(h) });
  }
  return out;
}

/**
 * verify_gear (combine-pack.c:129-171) rendered as readable rows, so a
 * mismatch prints a diff instead of "expected false to be true". The port
 * cannot reference-compare object identity across the two calls the way
 * upstream does, so kind / number / origin / origin_depth / equipped are all
 * checked, exactly the fields upstream checks. ORIGIN_MIXED discards
 * origin_depth upstream (L167), so it is elided here too.
 */
function gearRows(gear: Gear, p: Player): string[] {
  return gearList(gear, p).map(({ obj, equipped }) => {
    const depth = obj.origin === ORIGIN.MIXED ? "-" : String(obj.originDepth);
    return `${obj.tval}/${obj.kind.sval} x${obj.number} origin=${obj.origin}@${depth}${
      equipped ? " EQUIPPED" : ""
    }`;
  });
}
function expectedRows(expected: OutSlot[]): string[] {
  return expected.map((e) => {
    /* Assert the fixture's kind resolves, exactly as upstream's lookup_kind. */
    kind(e.tval, e.sval);
    const depth = e.origin === ORIGIN.MIXED ? "-" : String(e.originDepth);
    return `${e.tval}/${e.sval} x${e.num} origin=${e.origin}@${depth}${
      e.equipped ? " EQUIPPED" : ""
    }`;
  });
}

/**
 * verify_stability (combine-pack.c:176-208): a second combine_pack over
 * unchanged gear must reproduce the first result. Returns the post-second-call
 * rows so the caller compares them against the same expectation.
 */
function stability(gear: Gear, p: Player, constants: Constants): string[] {
  combinePack(gear, constants);
  return gearRows(gear, p);
}

describe("player/combine-pack (reference/src/tests/player/combine-pack.c)", () => {
  // upstream: test_combine_pack_empty
  it("combine_pack empty", () => {
    const gear = newGear();
    const p = human();
    flushGear(gear, p);
    combinePack(gear, baseConstants);
    expect(gearRows(gear, p)).toEqual([]);
    expect(stability(gear, p, baseConstants)).toEqual([]);
  });

  // upstream: test_combine_pack_only_equipped
  it("combine_pack only equipped", () => {
    const gear = newGear();
    const p = human();
    flushGear(gear, p);
    const input: InSlot[] = [
      { tval: TV.SWORD, sval: 1, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: true },
      { tval: TV.BOW, sval: 2, num: 1, origin: ORIGIN.FLOOR, originDepth: 5, equipped: true },
      { tval: TV.SHIELD, sval: 1, num: 1, origin: ORIGIN.STORE, originDepth: 0, equipped: true },
      { tval: TV.CLOAK, sval: 1, num: 1, origin: ORIGIN.FLOOR, originDepth: 1, equipped: true },
      { tval: TV.SOFT_ARMOR, sval: 2, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: true },
    ];
    const expected: OutSlot[] = [
      { tval: TV.SWORD, sval: 1, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: true },
      { tval: TV.BOW, sval: 2, num: 1, origin: ORIGIN.FLOOR, originDepth: 5, equipped: true },
      { tval: TV.SHIELD, sval: 1, num: 1, origin: ORIGIN.STORE, originDepth: 0, equipped: true },
      { tval: TV.CLOAK, sval: 1, num: 1, origin: ORIGIN.FLOOR, originDepth: 1, equipped: true },
      { tval: TV.SOFT_ARMOR, sval: 2, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: true },
    ];
    populate(gear, p, input);
    combinePack(gear, baseConstants);
    expect(gearRows(gear, p)).toEqual(expectedRows(expected));
    expect(stability(gear, p, baseConstants)).toEqual(expectedRows(expected));
  });

  // upstream: test_combine_pack_mixed
  it("combine_pack mixed", () => {
    const gear = newGear();
    const p = human();
    flushGear(gear, p);
    const input: InSlot[] = [
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1, inscrip: "=g3", origin: ORIGIN.BIRTH, originDepth: 0 },
      { tval: TV.SCROLL, sval: 5, num: 3, origin: ORIGIN.FLOOR, originDepth: 3 },
      { tval: TV.WAND, sval: 3, num: 1, origin: ORIGIN.CHEST, originDepth: 4 },
      { tval: TV.SWORD, sval: 1, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: true },
      { tval: TV.ARROW, sval: 1, num: 38, origin: ORIGIN.BIRTH, originDepth: 0 },
      { tval: TV.FOOD, sval: 2, num: 4, origin: ORIGIN.STORE, originDepth: 0 },
      { tval: TV.SCROLL, sval: 5, num: 4, origin: ORIGIN.STORE, originDepth: 0 },
      { tval: TV.FOOD, sval: 2, num: 1, origin: ORIGIN.STORE, originDepth: 0 },
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1, inscrip: "@m1", origin: ORIGIN.STORE, originDepth: 0 },
      { tval: TV.ARROW, sval: 1, num: 6, origin: ORIGIN.STORE, originDepth: 0 },
      { tval: TV.SWORD, sval: 1, num: 1, origin: ORIGIN.FLOOR, originDepth: 1 },
    ];
    const expected: OutSlot[] = [
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: false },
      { tval: TV.SCROLL, sval: 5, num: 7, origin: ORIGIN.MIXED, originDepth: 0, equipped: false },
      { tval: TV.WAND, sval: 3, num: 1, origin: ORIGIN.CHEST, originDepth: 4, equipped: false },
      { tval: TV.SWORD, sval: 1, num: 1, origin: ORIGIN.BIRTH, originDepth: 0, equipped: true },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.MIXED, originDepth: 0, equipped: false },
      { tval: TV.FOOD, sval: 2, num: 5, origin: ORIGIN.STORE, originDepth: 0, equipped: false },
      { tval: TV.MAGIC_BOOK, sval: 1, num: 1, origin: ORIGIN.STORE, originDepth: 0, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 4, origin: ORIGIN.STORE, originDepth: 0, equipped: false },
      { tval: TV.SWORD, sval: 1, num: 1, origin: ORIGIN.FLOOR, originDepth: 1, equipped: false },
    ];
    populate(gear, p, input);
    combinePack(gear, baseConstants);
    expect(gearRows(gear, p)).toEqual(expectedRows(expected));
    expect(stability(gear, p, baseConstants)).toEqual(expectedRows(expected));
  });

  // upstream: test_combine_pack_4_2_3_assertion
  it("combine_pack 4.2.3 assertion", () => {
    const gear = newGear();
    const p = human();
    flushGear(gear, p);
    const input: InSlot[] = [
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.STORE, originDepth: 0 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 1 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 2 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 3 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 4 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 5 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 6 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 7 },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 8 },
      { tval: TV.SWORD, sval: 1, num: 8, inscrip: "@v9", origin: ORIGIN.FLOOR, originDepth: 9 },
      { tval: TV.SWORD, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 10 },
    ];
    const expected: OutSlot[] = [
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.STORE, originDepth: 0, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 1, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 2, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 3, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 4, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 5, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 6, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 7, equipped: false },
      { tval: TV.ARROW, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 8, equipped: false },
      { tval: TV.SWORD, sval: 1, num: 8, origin: ORIGIN.FLOOR, originDepth: 9, equipped: false },
      { tval: TV.SWORD, sval: 1, num: 40, origin: ORIGIN.FLOOR, originDepth: 10, equipped: false },
    ];
    populate(gear, p, input);
    calcInventory(gear, baseConstants);
    combinePack(gear, baseConstants);
    expect(gearRows(gear, p)).toEqual(expectedRows(expected));
    expect(stability(gear, p, baseConstants)).toEqual(expectedRows(expected));
  });
});
