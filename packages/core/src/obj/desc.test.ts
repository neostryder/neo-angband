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
import { TV } from "../generated";
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
