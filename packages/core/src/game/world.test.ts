import { describe, expect, it } from "vitest";
import { OF, TMD, TV } from "../generated";
import { loc } from "../loc";
import type { GameObject } from "../obj/object";
import { objectNew } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { MonAllocTable } from "../mon/make";
import type { MonPlaceDeps } from "./mon-place";
import { pickAndPlaceDistantMonster } from "./mon-place";
import {
  digestFood,
  isDaytime,
  processDamageOverTime,
  processFaintOrStarve,
  rechargeObjects,
} from "./world";
import { processWorld } from "./loop";
import { makeState, monReg } from "./harness";

/** A minimal held object for the light / recharge upkeep tests. */
function makeObj(tval: number, over: Partial<GameObject> = {}): GameObject {
  const kind = {
    name: "test item",
    dChar: "~",
    dAttr: "y",
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = tval;
  obj.number = 1;
  Object.assign(obj, over);
  return obj;
}

describe("is_daytime", () => {
  it("is true in the first half of the day and false in the second", () => {
    expect(isDaytime(0, 10000)).toBe(true);
    expect(isDaytime(49999, 10000)).toBe(true);
    expect(isDaytime(50000, 10000)).toBe(false);
    expect(isDaytime(99999, 10000)).toBe(false);
    expect(isDaytime(100000, 10000)).toBe(true);
  });
});

describe("process_world RNG determinism", () => {
  it("draws exactly one RNG value (the ambient-spawn roll) with no active effects", () => {
    const state = makeState();
    state.actor.player.timed[TMD.FOOD] = 5000; /* fed: no digest/starve draws */
    let draws = 0;
    const orig = state.rng.randint0.bind(state.rng);
    state.rng.randint0 = (n: number): number => {
      draws++;
      return orig(n);
    };
    processWorld(state);
    expect(draws).toBe(1);
  });

  it("draws the ambient-spawn roll unconditionally and spawns on a hit", () => {
    const state = makeState();
    state.actor.player.timed[TMD.FOOD] = 5000;
    state.z.allocMonsterChance = 1; /* one_in_(1) always hits */
    let calls = 0;
    state.world!.spawnAmbientMonster = (): boolean => {
      calls++;
      return true;
    };
    processWorld(state);
    expect(calls).toBe(1);
  });
});

describe("ambient monster generation", () => {
  it("places a distant monster past dis, drawing x-then-y per attempt", () => {
    const state = makeState({ w: 60, h: 40, playerGrid: loc(5, 5), seed: 7 });
    const deps: MonPlaceDeps = {
      table: new MonAllocTable(monReg.races, { maxDepth: 128 }),
    };
    /* Force a deterministic grid pick that lands far away on the first try. */
    const draws: number[] = [];
    const orig = state.rng.randint0.bind(state.rng);
    state.rng.randint0 = (n: number): number => {
      const v = orig(n);
      if (draws.length < 2) draws.push(n);
      return v;
    };
    const before = state.monsters.filter((m) => m).length;
    const placed = pickAndPlaceDistantMonster(state, loc(5, 5), 25, true, 1, deps);
    const after = state.monsters.filter((m) => m).length;
    /* x is drawn (width 60) before y (height 40). */
    expect(draws[0]).toBe(60);
    expect(draws[1]).toBe(40);
    if (placed) expect(after).toBe(before + 1);
  });
});

describe("damage over time", () => {
  it("poison deals 1 damage each applicable turn (RNG-free)", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 100;
    p.chp = 100;
    p.timed[TMD.POISONED] = 5;

    expect(processDamageOverTime(state)).toBe(false);
    expect(p.chp).toBe(99);
    expect(processDamageOverTime(state)).toBe(false);
    expect(p.chp).toBe(98);
  });

  it("a light cut deals 1 damage; poison then cut both tick", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 100;
    p.chp = 100;
    p.timed[TMD.POISONED] = 3;
    p.timed[TMD.CUT] = 4; /* a shallow cut (else-branch i = 1) */

    processDamageOverTime(state);
    /* poison (1) then cut (1). */
    expect(p.chp).toBe(98);
  });

  it("Black Breath draws three one_in_(2) rolls in order when active", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.BLACKBREATH] = 10;
    p.exp = 1000;

    const seen: number[] = [];
    const orig = state.rng.randint0.bind(state.rng);
    state.rng.randint0 = (n: number): number => {
      seen.push(n);
      return orig(n);
    };
    processDamageOverTime(state);
    /* Exactly three one_in_(2) = randint0(2) draws for the CON/STR/exp rolls. */
    expect(seen).toEqual([2, 2, 2]);
  });
});

describe("faint and starvation", () => {
  it("a starving player takes (100 - food) / 10 damage", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 100;
    p.chp = 100;
    p.timed[TMD.FOOD] = 10; /* Starving grade */

    expect(processFaintOrStarve(state)).toBe(false);
    expect(p.chp).toBe(91); /* (100 - 10) / 10 = 9 */
  });
});

describe("food digestion", () => {
  it("digests food each 100-turn tick and fires the hunger grade message", () => {
    const msgs: string[] = [];
    const state = makeState({ worldMsgs: msgs });
    const p = state.actor.player;
    p.timed[TMD.FOOD] = 1510; /* just above the Hungry threshold (1500) */
    state.turn = 0; /* turn % 100 === 0 */

    digestFood(state);

    expect(p.timed[TMD.FOOD]).toBe(1500); /* dropped by turn_energy(110)*100/100 */
    expect(msgs).toContain("You are getting hungry.");
  });

  it("does not digest off the 100-turn cadence", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.FOOD] = 5000;
    state.turn = 5; /* turn % 100 !== 0 */

    digestFood(state);

    expect(p.timed[TMD.FOOD]).toBe(5000);
  });
});

describe("light fuel burn", () => {
  it("burns a torch out with a message and deletes it (OF_BURNS_OUT)", () => {
    const msgs: string[] = [];
    const state = makeState({ worldMsgs: msgs });
    const p = state.actor.player;
    p.timed[TMD.FOOD] = 5000; /* avoid starvation confusion */
    state.chunk.depth = 1; /* in the dungeon: fuel always burns */

    const lightSlot = p.body.slots.findIndex((s) => s.type === "LIGHT");
    expect(lightSlot).toBeGreaterThanOrEqual(0);
    const torch = makeObj(TV.LIGHT, { timeout: 1 });
    torch.flags.on(OF.BURNS_OUT);
    const handle = 11;
    state.gear.store.set(handle, torch);
    p.equipment[lightSlot] = handle;

    processWorld(state);

    expect(msgs).toContain("Your light has gone out!");
    expect(p.equipment[lightSlot]).toBe(0); /* the torch was consumed */
  });

  it("does not burn fuel in town during the day", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.FOOD] = 5000;
    state.chunk.depth = 0; /* town */
    state.turn = 0; /* daytime */

    const lightSlot = p.body.slots.findIndex((s) => s.type === "LIGHT");
    const lantern = makeObj(TV.LIGHT, { timeout: 100 });
    const handle = 12;
    state.gear.store.set(handle, lantern);
    p.equipment[lightSlot] = handle;

    processWorld(state);

    expect(lantern.timeout).toBe(100); /* unburned by daylight */
  });
});

describe("recharge objects", () => {
  it("recharges a pack rod and fires the recharged notice on a full charge", () => {
    const msgs: string[] = [];
    const state = makeState({ worldMsgs: msgs });
    const rod = makeObj(TV.ROD, { timeout: 1 });
    rod.time = { base: 10, dice: 0, sides: 0, mBonus: 0 };
    rod.note = "!!"; /* inscribed for the recharge notice */
    const handle = 21;
    state.gear.store.set(handle, rod);
    state.gear.pack.push(handle);

    rechargeObjects(state);

    expect(rod.timeout).toBe(0); /* one charge unit consumed the timeout */
    expect(msgs.some((m) => m.includes("has recharged"))).toBe(true);
  });

  it("counts a rod down without a notice while still charging", () => {
    const state = makeState();
    const rod = makeObj(TV.ROD, { timeout: 30, number: 5 });
    rod.time = { base: 10, dice: 0, sides: 0, mBonus: 0 };
    const handle = 22;
    state.gear.store.set(handle, rod);
    state.gear.pack.push(handle);

    rechargeObjects(state);

    /* number_charging = min(ceil(30 / 10), 5) = 3, so timeout drops by 3. */
    expect(rod.timeout).toBe(27);
  });
});

describe("timed effect wear-off via the clock", () => {
  it("counts a timed effect to zero and fires its on-end message", () => {
    const msgs: string[] = [];
    const state = makeState({ worldMsgs: msgs });
    const p = state.actor.player;
    p.timed[TMD.AFRAID] = 1;
    p.timed[TMD.FOOD] = 5000;

    processWorld(state);

    expect(p.timed[TMD.AFRAID]).toBe(0);
    expect(msgs).toContain("You feel bolder now.");
  });
});
