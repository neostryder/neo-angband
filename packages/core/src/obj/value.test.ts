import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { ObjRegistry } from "./bind";
import type { KnownDesc } from "./known-object";
import type { RuneEnv } from "./knowledge";
import { makeRuneEnv, OBJ_NOTICE, playerLearnAllRunes } from "./knowledge";
import { objectPrep } from "./make";
import type { ObjPackJson } from "./types";
import { objectValue, objectValueBase, objectValueReal } from "./value";
import { Rng } from "../rng";

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

function firstOrdinaryKind(tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no ordinary kind for tval ${tval}`);
  return k;
}

function make(tval: number) {
  return objectPrep(new Rng(1), reg, constants, firstOrdinaryKind(tval), 0, "minimise");
}

describe("object_value_real (obj-power.c constant-price path)", () => {
  it("prices a constant-price item at kind.cost * qty", () => {
    const potion = make(TV.POTION);
    expect(objectValueReal(reg, potion, 1)).toBe(potion.kind.cost);
    expect(objectValueReal(reg, potion, 3)).toBe(potion.kind.cost * 3);
  });

  it("adds a per-charge premium for wands and staves", () => {
    const wand = make(TV.WAND);
    wand.pval = 10;
    wand.number = 1;
    const cost = wand.kind.cost;
    // total = cost*qty + floor(cost * charges / 20); charges = pval = 10.
    expect(objectValueReal(reg, wand, 1)).toBe(
      cost + Math.floor((cost * 10) / 20),
    );
  });

  it("returns 0 for a worthless (costless) kind", () => {
    const potion = make(TV.POTION);
    potion.kind = { ...potion.kind, cost: 0 };
    expect(objectValueReal(reg, potion, 5)).toBe(0);
  });
});

describe("object_value_real (obj-power.c variable-power path)", () => {
  it("prices a weapon from its power via value = power*(power+5)", () => {
    // A 1d4 weapon has power 6, so value = 6*(6+5) = 66 for a single item.
    const sword = make(TV.SWORD);
    sword.dd = 1;
    sword.ds = 4;
    sword.toH = 0;
    sword.toD = 0;
    sword.toA = 0;
    sword.ac = 0;
    sword.weight = 100;
    sword.ego = null;
    sword.brands = null;
    sword.slays = null;
    sword.curses = null;
    sword.flags.wipe();
    for (const e of sword.elInfo) {
      e.resLevel = 0;
      e.flags = 0;
    }
    for (let i = 0; i < sword.modifiers.length; i++) sword.modifiers[i] = 0;
    expect(objectValueReal(reg, sword, 1)).toBe(66);
    expect(objectValueReal(reg, sword, 2)).toBe(132);
  });

  it("never rounds a positive-power wearable down to worthless", () => {
    const cloak = make(TV.CLOAK);
    expect(objectValueReal(reg, cloak, 1)).toBeGreaterThan(0);
  });
});

describe("object_value_base (obj-power.c)", () => {
  it("uses a flat per-tval estimate when the flavor is not aware", () => {
    expect(objectValueBase(make(TV.POTION), false)).toBe(20);
    expect(objectValueBase(make(TV.SCROLL), false)).toBe(20);
    expect(objectValueBase(make(TV.STAFF), false)).toBe(70);
  });

  it("uses the kind cost when the flavor is aware", () => {
    const potion = make(TV.POTION);
    expect(objectValueBase(potion, true)).toBe(potion.kind.cost);
  });
});

describe("object_value (obj-power.c dispatch)", () => {
  it("prices an aware flavored kind at its real cost", () => {
    const potion = make(TV.POTION);
    expect(objectValue(reg, potion, 2, true)).toBe(potion.kind.cost * 2);
  });

  it("prices an unaware flavored kind at the flat base guess", () => {
    const potion = make(TV.POTION);
    expect(objectValue(reg, potion, 2, false)).toBe(20 * 2);
  });

  it("prices a variable-power item by object_power regardless of awareness", () => {
    const cloak = make(TV.CLOAK);
    expect(objectValue(reg, cloak, 1, false)).toBe(objectValueReal(reg, cloak, 1));
  });
});

describe("object_value via the known twin (obj-power.c L1257-1259, gap 3.4)", () => {
  const players = bindPlayer({
    races: loadJson<{ records: unknown[] }>("p_race").records,
    classes: loadJson<{ records: unknown[] }>("class").records,
    properties: loadJson<{ records: unknown[] }>("player_property").records,
    timed: loadJson<{ records: unknown[] }>("player_timed").records,
    shapes: loadJson<{ records: unknown[] }>("shape").records,
    bodies: loadJson<{ records: unknown[] }>("body").records,
    history: loadJson<{ records: unknown[] }>("history").records,
    realms: loadJson<{ records: unknown[] }>("realm").records,
  } as Parameters<typeof bindPlayer>[0]);

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

  const deps: KnownDesc = { isAware: () => false, isTried: () => false };

  it("prices an assessed item with unknown combat runes below its real value", () => {
    const sword = make(TV.SWORD);
    sword.toH = 8;
    sword.toD = 8;
    sword.notice |= OBJ_NOTICE.ASSESSED;
    const p = makePlayer();
    const env = makeEnv();

    const knownPrice = objectValue(reg, sword, 1, false, { p, env, deps });
    const realPrice = objectValue(reg, sword, 1, false);
    /* The fresh player knows no to-hit/to-dam runes, so the twin carries
     * zeroes there and the priced power is lower. */
    expect(knownPrice).toBeLessThan(realPrice);
  });

  it("prices a fully-known item exactly like the real object", () => {
    const sword = make(TV.SWORD);
    sword.toH = 8;
    sword.toD = 8;
    sword.notice |= OBJ_NOTICE.ASSESSED;
    const p = makePlayer();
    const env = makeEnv();
    playerLearnAllRunes(p, env);

    expect(objectValue(reg, sword, 1, false, { p, env, deps })).toBe(
      objectValue(reg, sword, 1, false),
    );
  });

  it("constant-price kinds are unaffected by the knowledge context", () => {
    const potion = make(TV.POTION);
    const p = makePlayer();
    const env = makeEnv();
    expect(objectValue(reg, potion, 2, false, { p, env, deps })).toBe(
      objectValue(reg, potion, 2, false),
    );
  });
});
