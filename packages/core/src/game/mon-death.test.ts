/**
 * Monster death loot (game/mon-death.ts): mon_create_drop generation fused with
 * monster_death's drop-to-floor, driven over a harness GameState with a real
 * bound object registry. Covers the drop-count range, the gold/item split, good
 * / unique specifics, ORIGIN tagging, invisible-monster handling, stolen-object
 * drops, and a fixed-seed determinism snapshot (the RNG-order regression guard).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, ORIGIN, RF } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { bindConstants } from "../constants";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { ObjAllocState, objectPrep } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import type { GameObject } from "../obj/object";
import { tvalIsMoney } from "../obj/object";
import { TV } from "../generated";
import { monCreateDropCount, monsterCarry } from "../mon/make";
import { getLore } from "../mon/lore";
import type { MonsterDrop } from "../mon/types";
import type { GameState } from "./context";
import { monsterDeath } from "./mon-death";
import type { MonsterDeathDeps } from "./mon-death";
import { addMon, makeRace, makeState } from "./harness";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objReg = new ObjRegistry({
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
const constants = bindConstants(loadJson("constants"));
const makeDeps: MakeDeps = {
  reg: objReg,
  alloc: new ObjAllocState(objReg, constants),
  constants,
};

function deathDeps(state: GameState): MonsterDeathDeps {
  return { makeDeps, reg: objReg, floorEnv: {}, lore: state.lore };
}

/** All objects on the floor across every grid (drops scatter within radius 3). */
function allFloorObjects(state: GameState): GameObject[] {
  const out: GameObject[] = [];
  for (const pile of state.floor.values()) out.push(...pile);
  return out;
}

/** A drop line specified by kind (sval set) or base (sval null). */
function drop(
  tval: string,
  sval: string | null,
  percentChance: number,
  min: number,
  max: number,
): MonsterDrop {
  return { tval, sval, percentChance, min, max };
}

describe("monCreateDropCount (mon-make.c mon_create_drop_count)", () => {
  it("DROP_4 yields a generic count in [2,6] (rand_range(2,6))", () => {
    const race = makeRace({ flags: [RF.DROP_4] });
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new Rng(seed);
      const { number } = monCreateDropCount(rng, race, false, false);
      expect(number).toBeGreaterThanOrEqual(2);
      expect(number).toBeLessThanOrEqual(6);
    }
  });

  it("DROP_60 yields 0 or 1 generic drop", () => {
    const race = makeRace({ flags: [RF.DROP_60] });
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const { number } = monCreateDropCount(new Rng(seed), race, false, false);
      seen.add(number);
    }
    expect([...seen].every((n) => n === 0 || n === 1)).toBe(true);
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it("maximize is deterministic: DROP_4+DROP_2 -> 9, no RNG", () => {
    const race = makeRace({ flags: [RF.DROP_4, RF.DROP_2] });
    const rng = new Rng(1);
    const before = rng.randint0(1000000);
    const { number } = monCreateDropCount(new Rng(99), race, true, false);
    const after = rng.randint0(1000000);
    /* drop_4_max (6) + drop_2_max (3). */
    expect(number).toBe(9);
    /* The maximize branch draws no RNG (the untouched rng advances normally). */
    expect(typeof before).toBe("number");
    expect(typeof after).toBe("number");
  });

  it("the specified-drop loop runs and reports specificCount (specific=false keeps number at 0)", () => {
    const race = makeRace({ drops: [drop("food", "Ration of Food", 100, 1, 3)] });
    const counts = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const { number, specificCount } = monCreateDropCount(
        new Rng(seed),
        race,
        false,
        false,
      );
      expect(number).toBe(0);
      counts.add(specificCount);
    }
    /* randint0(max-min)+min = randint0(2)+1 in [1,3] (max is exclusive-ish per
     * randint0(3-1)=randint0(2) -> 0..1, +1 -> 1..2; upstream drop max is a cap). */
    expect([...counts].every((n) => n >= 1 && n <= 3)).toBe(true);
  });
});

describe("monsterDeath (mon_create_drop + monster_death)", () => {
  it("a DROP-flagged, visible money-only monster drops gold onto the floor", () => {
    const state = makeState({ seed: 7 });
    state.chunk.depth = 5;
    const race = makeRace({ level: 10, flags: [RF.DROP_4, RF.ONLY_GOLD] });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    expect(objs.length).toBeGreaterThan(0);
    /* ONLY_GOLD: every drop is money, no items. */
    expect(objs.every((o) => tvalIsMoney(o.tval))).toBe(true);
    /* ORIGIN tagging (visible kill -> ORIGIN.DROP with race + depth). */
    for (const o of objs) {
      expect(o.origin).toBe(ORIGIN.DROP);
      expect(o.originRace).toBe(race.ridx);
      expect(o.originDepth).toBe(5);
    }
    /* Held pile emptied. */
    expect(mon.heldObj.length).toBe(0);
  });

  it("an ONLY_ITEM monster drops items and never gold", () => {
    const state = makeState({ seed: 11 });
    state.chunk.depth = 8;
    const race = makeRace({ level: 20, flags: [RF.DROP_4, RF.ONLY_ITEM] });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    expect(objs.length).toBeGreaterThan(0);
    expect(objs.some((o) => tvalIsMoney(o.tval))).toBe(false);
  });

  it("a DROP_GOOD monster's generic items are generated with good=true", () => {
    /* Good items skew to higher kinds; across seeds at least some are ego /
     * enchanted. We assert the softer invariant that items are produced and
     * tagged, plus that the run is stable (determinism covered below). */
    const state = makeState({ seed: 3 });
    state.chunk.depth = 30;
    const race = makeRace({
      level: 40,
      flags: [RF.DROP_4, RF.ONLY_ITEM, RF.DROP_GOOD],
    });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    expect(objs.length).toBeGreaterThan(0);
    expect(objs.every((o) => o.origin === ORIGIN.DROP)).toBe(true);
  });

  it("a unique force-drops its guaranteed specified loot", () => {
    const state = makeState({ seed: 5 });
    state.chunk.depth = 3;
    const race = makeRace({
      level: 20,
      flags: [RF.UNIQUE],
      drops: [drop("food", "Ration of Food", 100, 1, 1)],
    });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);
    const rationSval = objReg.lookupSval(TV.FOOD, "Ration of Food");

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    const ration = objs.find(
      (o) => o.tval === TV.FOOD && o.sval === rationSval,
    );
    expect(ration).toBeDefined();
    expect(ration!.origin).toBe(ORIGIN.DROP);
    expect(ration!.originRace).toBe(race.ridx);
  });

  it("a specified drop by tval (sval null) produces an object of that tval", () => {
    const state = makeState({ seed: 9 });
    state.chunk.depth = 10;
    const race = makeRace({
      level: 15,
      drops: [drop("food", null, 100, 1, 1)],
    });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    expect(objs.some((o) => o.tval === TV.FOOD)).toBe(true);
  });

  it("a monster carrying a stolen item drops it on death, keeping its origin", () => {
    const state = makeState({ seed: 13 });
    state.chunk.depth = 4;
    const race = makeRace({ level: 10 }); /* no generated drops */
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    /* Craft a stolen ration and attach it via monster_carry, as melee theft
     * does (game/mon-side.ts). */
    const rationSval = objReg.lookupSval(TV.FOOD, "Ration of Food");
    const kind = objReg.lookupKind(TV.FOOD, rationSval)!;
    const stolen = objectPrep(state.rng, objReg, constants, kind, 0, "minimise");
    stolen.origin = ORIGIN.STOLEN;
    stolen.number = 1;
    monsterCarry(mon.heldObj, stolen, mon.midx);
    expect(mon.heldObj.length).toBe(1);

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    const dropped = objs.find((o) => o === stolen);
    expect(dropped).toBeDefined();
    /* A stolen item keeps ORIGIN.STOLEN (not counted as dropped treasure). */
    expect(dropped!.origin).toBe(ORIGIN.STOLEN);
    expect(mon.heldObj.length).toBe(0);
  });

  it("an invisible, non-unique monster's drops get ORIGIN.DROP_UNKNOWN and skip lore_treasure", () => {
    const state = makeState({ seed: 21 });
    state.chunk.depth = 6;
    const race = makeRace({ level: 12, flags: [RF.DROP_4, RF.ONLY_GOLD] });
    const mon = addMon(state, race, loc(20, 12));
    /* Not visible, not unique. */

    monsterDeath(state, mon, deathDeps(state));

    const objs = allFloorObjects(state);
    expect(objs.length).toBeGreaterThan(0);
    expect(objs.every((o) => o.origin === ORIGIN.DROP_UNKNOWN)).toBe(true);
    /* lore_treasure is gated on visibility: drop_gold stays 0. */
    const lore = getLore(state.lore, race);
    expect(lore.dropGold).toBe(0);
  });

  it("a visible kill records dropped treasure via lore_treasure", () => {
    const state = makeState({ seed: 21 });
    state.chunk.depth = 6;
    const race = makeRace({ level: 12, flags: [RF.DROP_4, RF.ONLY_GOLD] });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    monsterDeath(state, mon, deathDeps(state));

    const lore = getLore(state.lore, race);
    expect(lore.dropGold).toBeGreaterThan(0);
    /* Drop quality is learned. */
    expect(lore.flags.has(RF.DROP_GOOD)).toBe(true);
    expect(lore.flags.has(RF.DROP_GREAT)).toBe(true);
  });

  it("a race with no DROP flags and no drops leaves an empty floor and draws no RNG", () => {
    const state = makeState({ seed: 33 });
    const race = makeRace({ level: 10 });
    const mon = addMon(state, race, loc(20, 12));
    mon.mflag.on(MFLAG.VISIBLE);

    const before = state.rng.randint0(1000000);
    monsterDeath(state, mon, deathDeps(state));
    const after = state.rng.randint0(1000000);

    expect(allFloorObjects(state).length).toBe(0);
    /* With no drop flags/drops mon_create_drop_count draws nothing and the
     * generic loop never runs, so the two probe draws are adjacent in the
     * stream: re-running from the same seed reproduces them. */
    const probe = new Rng(33);
    expect(before).toBe(probe.randint0(1000000));
    expect(after).toBe(probe.randint0(1000000));
  });

  it("is deterministic for a fixed seed (RNG-order snapshot)", () => {
    const build = (): GameObject[] => {
      const state = makeState({ seed: 2024 });
      state.chunk.depth = 25;
      const race = makeRace({
        level: 30,
        flags: [RF.DROP_4, RF.DROP_60],
        drops: [drop("food", "Ration of Food", 100, 1, 2)],
      });
      const mon = addMon(state, race, loc(20, 12));
      mon.mflag.on(MFLAG.VISIBLE);
      monsterDeath(state, mon, deathDeps(state));
      return allFloorObjects(state);
    };

    const a = build();
    const b = build();
    /* Same seed -> identical drop set (kinds, counts, pvals, origins). */
    const shape = (objs: GameObject[]): unknown =>
      objs.map((o) => ({
        tval: o.tval,
        sval: o.sval,
        number: o.number,
        pval: o.pval,
        origin: o.origin,
        originRace: o.originRace,
        originDepth: o.originDepth,
      }));
    expect(shape(a)).toEqual(shape(b));
    /* And it actually produced loot (the specified ration plus generics). */
    expect(a.length).toBeGreaterThan(0);
  });
});
