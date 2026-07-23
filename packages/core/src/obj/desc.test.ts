/**
 * object_desc ignore markers (obj-desc.c L536-538 "ignore" inscription and
 * L627-630 gold " {ignore}"), gap 4.5: emitted when the caller supplies
 * KnownDesc.ignoreItemOk, omitted otherwise.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { KF, TV } from "../generated";
import { OBJ_NOTICE } from "./knowledge";
import { ObjRegistry } from "./bind";
import type { ObjPackJson, ObjectKind } from "./types";
import { objectNew } from "./object";
import { makeRuneEnv } from "./knowledge";
import type { RuneEnv } from "./knowledge";
import type { KnownDesc } from "./known-object";
import { ODESC, objectDesc } from "./desc";

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

const reg = new ObjRegistry({
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
} as ObjPackJson);

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

function makePlayer(): Player {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

function makeEnv(): RuneEnv {
  const rng = new Rng(7);
  return makeRuneEnv(
    () => null,
    (v) => rng.randcalcVaries(v),
    {
      brands: reg.brands,
      slays: reg.slays,
      curses: reg.curses,
      properties: reg.properties,
      elementNames: ["acid", "lightning", "fire", "frost"],
      msg: () => {},
    },
  );
}

function ordinaryKind(pred: (k: ObjectKind) => boolean): ObjectKind {
  const k = reg.kinds.find((kk) => kk.kidx < reg.ordinaryKindCount && pred(kk));
  if (!k) throw new Error("no matching ordinary kind");
  return k;
}

function mkObj(kind: ObjectKind) {
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.dd = kind.dd;
  obj.ds = kind.ds;
  obj.ac = kind.ac;
  obj.weight = kind.weight;
  obj.number = 1;
  return obj;
}

function descDeps(ignored: boolean): KnownDesc {
  return {
    isAware: () => true,
    isTried: () => false,
    ignoreItemOk: () => ignored,
  };
}

describe("object_desc ignore markers (obj-desc.c L536-538, L627-630; gap 4.5)", () => {
  it("appends the 'ignore' inscription marker for an ignored item", () => {
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      descDeps(true),
    );
    expect(name).toMatch(/\{ignore\}$/);
  });

  it("omits the marker when the item is not ignored", () => {
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      descDeps(false),
    );
    expect(name).not.toContain("ignore");
  });

  it("omits the marker when the caller supplies no ignoreItemOk (old behaviour)", () => {
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      { isAware: () => true, isTried: () => false },
    );
    expect(name).not.toContain("ignore");
  });

  it("gold gets the trailing ' {ignore}' (L630)", () => {
    const gold = mkObj(ordinaryKind((k) => k.tval === TV.GOLD));
    gold.pval = 32;
    const name = objectDesc(
      gold,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      descDeps(true),
    );
    expect(name).toBe(`32 gold pieces worth of ${gold.kind.name} {ignore}`);

    const plain = objectDesc(
      gold,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      descDeps(false),
    );
    expect(plain).toBe(`32 gold pieces worth of ${gold.kind.name}`);
  });

  it("an omniscient describe (p == null) never shows ignore markers", () => {
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL,
      null,
      makeEnv(),
      descDeps(true),
    );
    expect(name).not.toContain("ignore");
  });
});

describe("object_desc everseen marking (obj-desc.c L633-637)", () => {
  const markingDeps = (
    markedKinds: number[],
    markedEgos: number[],
  ): KnownDesc => ({
    isAware: () => true,
    isTried: () => false,
    markKindSeen: (kind) => markedKinds.push(kind.kidx),
    markEgoSeen: (ego) => markedEgos.push(ego.eidx),
  });

  it("marks an aware kind everseen for a real, non-spoiled describe", () => {
    const kinds: number[] = [];
    const egos: number[] = [];
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    objectDesc(obj, ODESC.PREFIX | ODESC.FULL, makePlayer(), makeEnv(), markingDeps(kinds, egos));
    expect(kinds).toContain(obj.kind.kidx);
  });

  it("does NOT mark on a spoiled describe (upstream !spoil guard)", () => {
    const kinds: number[] = [];
    const egos: number[] = [];
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL | ODESC.SPOIL,
      makePlayer(),
      makeEnv(),
      markingDeps(kinds, egos),
    );
    expect(kinds).toEqual([]);
  });

  it("does NOT mark on an omniscient (p == null) describe and stays RNG-free", () => {
    const kinds: number[] = [];
    const egos: number[] = [];
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.LIGHT));
    const rng = new Rng(4242);
    const before = rng.getState();
    objectDesc(obj, ODESC.PREFIX | ODESC.FULL, null, makeEnv(), markingDeps(kinds, egos));
    expect(kinds).toEqual([]);
    expect(egos).toEqual([]);
    expect(rng.getState()).toEqual(before); // marking never draws from the RNG
  });
});

/**
 * OD-01: the base damage-dice bracket "(XdY)" gates on p->obj_k->dd && ds
 * (obj-desc.c L381-382), which is emitted BEFORE the ASSESSED early-return
 * (L392-393) - so it must NOT wait on ASSESSED. Those "know dice" runes are
 * granted at birth (player_outfit, player-birth.c L584-596) and never learned by
 * use, so a real player (blankObjKnowledge sets dd=ds=ac=1) sees the base dice
 * of even an UNIDENTIFIED item. The port previously gated the dice bracket on
 * ASSESSED, hiding it until identify.
 *
 * The combat-BONUS and armour brackets (L395-427) are AFTER the ASSESSED
 * early-return, so they correctly still require ASSESSED - the two assertions
 * below guard both halves of the boundary.
 */
describe("object_desc dice bracket gates on obj_k->dd/ds, not ASSESSED (OD-01)", () => {
  const plainDeps: KnownDesc = { isAware: () => true, isTried: () => false };
  const diceWeapon = () =>
    mkObj(
      ordinaryKind(
        (k) => k.kindFlags.has(KF.SHOW_DICE) && k.dd > 0 && k.ds > 0,
      ),
    );

  it("shows an unidentified weapon's damage dice but NOT its combat bonus", () => {
    const obj = diceWeapon();
    obj.notice = 0; // NOT assessed
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      plainDeps,
    );
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);
    expect(name).toContain(`(${obj.dd}d${obj.ds})`); // dice: before the gate
    expect(name).not.toContain("(+0,+0)"); // bonus: after the ASSESSED gate
  });

  it("adds the combat-bonus bracket once the weapon is assessed", () => {
    const obj = diceWeapon();
    obj.notice = OBJ_NOTICE.ASSESSED;
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL,
      makePlayer(),
      makeEnv(),
      plainDeps,
    );
    expect(name).toContain(`(${obj.dd}d${obj.ds})`);
    expect(name).toContain("(+0,+0)");
  });
});

/**
 * obj_desc_aware (obj-desc.c L565): in ODESC_STORE mode a mundane item whose
 * runes are all known shows NO "{??}"; only an item with an unlearned rune does.
 * Store stock is created ASSESSED (store.c L1216-1219), and the player knows the
 * combat runes from birth (player-birth.c L1265-1267), so an enchanted-but-plain
 * weapon like "Broad Sword (+5,+4)" must have runes-known and no marker. This is
 * the parity fix for the spurious "{??}" Aaron saw on mundane store weapons.
 */
describe("object_desc store {??} only on unlearned runes (OD-STORE)", () => {
  const storeDeps: KnownDesc = { isAware: () => true, isTried: () => false };

  it("shows no {??} for a mundane enchanted weapon assessed in a store", () => {
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.SWORD));
    obj.notice = OBJ_NOTICE.ASSESSED; // store stock is assessed
    obj.toH = 5;
    obj.toD = 4;
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL | ODESC.STORE,
      makePlayer(),
      makeEnv(),
      storeDeps,
    );
    expect(name).toContain("(+5,+4)");
    expect(name).not.toContain("{??}");
  });

  it("still shows {??} when a combat rune is not known", () => {
    // A player who has NOT learned the to-hit rune sees the enchanted weapon as
    // not-fully-known: the shadow's to_h (0) diverges from the real +5.
    const p = makePlayer();
    p.objKnown.toH = 0;
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.SWORD));
    obj.notice = OBJ_NOTICE.ASSESSED;
    obj.toH = 5;
    obj.toD = 4;
    const name = objectDesc(
      obj,
      ODESC.PREFIX | ODESC.FULL | ODESC.STORE,
      p,
      makeEnv(),
      storeDeps,
    );
    expect(name).toContain("{??}");
  });
});
