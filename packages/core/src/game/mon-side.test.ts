/**
 * Live monster-melee blow effects: combat/mon-melee.ts driven by the real
 * MonBlowEnv (game/mon-side.ts) over a harness GameState. Exercises the
 * elemental resist split, damage reduction, the status / stat / theft handlers
 * and the unreduced-vs-reduced damage rule end to end.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ORIGIN, TMD, TV } from "../generated";
import { STAT } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { SKILL } from "../player/types";
import { bindConstants } from "../constants";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { ArtifactState, objectPrep, ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import type { GameObject } from "../obj/object";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { adj_dex_safe } from "../player/calcs";
import type { DefenderState, MonBlowEnv } from "../combat/mon-melee";
import { monMeleeAttack } from "../combat/mon-melee";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { makeMonBlowEnv } from "./mon-side";
import { gearAdd } from "./gear";
import { addMon, makeBlow, makeRace, makeState, plReg } from "./harness";
import type { RaceOverrides } from "./harness";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const projections = bindProjections(
  loadJson<{ records: ProjectionRecordJson[] }>("projection").records,
);

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
  artifacts: new ArtifactState(objReg.artifacts.length),
  noArtifacts: false,
};

const DEFENSE: DefenderState = { ac: 0, toA: 0 };

interface EnvOpts {
  resistLevel?: (t: number) => number;
  reduction?: () => { damRed: number; percDamRed: number };
  packSize?: number;
}

interface Setup {
  state: GameState;
  mon: import("../mon/monster").Monster;
  env: MonBlowEnv;
  msgs: string[];
}

/**
 * Run a single blow that is guaranteed to land: search fixed seeds until the
 * to-hit roll connects (deterministic - the same seed is always chosen), then
 * return the resolved attack. `configure` may tweak the fresh state/env before
 * the blow (skills, gold, pack, timers).
 */
function attackHit(
  build: (seed: number) => Setup,
  configure: (s: Setup) => void = () => {},
): { setup: Setup; result: ReturnType<typeof monMeleeAttack> } {
  for (let seed = 1; seed < 400; seed++) {
    const setup = build(seed);
    configure(setup);
    const result = monMeleeAttack(
      setup.state.rng,
      setup.mon,
      setup.state.actor.player,
      DEFENSE,
      { env: setup.env },
    );
    if (result.blows[0]?.hit) return { setup, result };
  }
  throw new Error("no hitting seed found");
}

function make(
  effect: string,
  method: string,
  dice: string,
  envOpts: EnvOpts = {},
  raceOverrides: RaceOverrides = {},
): (seed: number) => Setup {
  return (seed: number): Setup => {
    const state = makeState({ seed, playerGrid: loc(20, 12) });
    const race = makeRace({
      level: 50,
      blows: [makeBlow(method, effect, dice)],
      ...raceOverrides,
    });
    const mon = addMon(state, race, loc(19, 12));
    const msgs: string[] = [];
    /* Route env messages into `msgs`. */
    const env = buildEnvWithMsgs(state, mon, envOpts, msgs);
    return { state, mon, env, msgs };
  };
}

function buildEnvWithMsgs(
  state: GameState,
  mon: import("../mon/monster").Monster,
  opts: EnvOpts,
  msgs: string[],
): MonBlowEnv {
  const actor = basicPlayerActor(state, {
    ...(opts.resistLevel ? { resistLevel: opts.resistLevel } : {}),
    ...(opts.reduction ? { reduction: opts.reduction } : {}),
  });
  const factory = makeMonBlowEnv(state, {
    timed: plReg.timed,
    actor,
    projections,
    expDeps: { rng: state.rng },
    lifeDrainPercent: 10,
    adjDexSafe: adj_dex_safe,
    packSize: opts.packSize ?? constants.packSize,
    makeDeps,
    earthquake: (): void => {},
    msg: (t: string): void => {
      msgs.push(t);
    },
  });
  return factory(mon);
}

describe("live monster melee - elemental resist split", () => {
  it("takes the larger of physical vs elemental at resist 0", () => {
    const { setup } = attackHit(make("FIRE", "HIT", "20d1"));
    /* physical = adjust_dam_armor(20, ac+50) = 18; elemental (res 0) = 20. */
    expect(1000 - setup.state.actor.player.chp).toBe(20);
  });

  it("immune to fire falls back to the physical component only", () => {
    const { setup } = attackHit(
      make("FIRE", "HIT", "20d1", { resistLevel: () => 3 }),
    );
    /* elemental = 0 (immune), physical = 18. */
    expect(1000 - setup.state.actor.player.chp).toBe(18);
  });

  it("vulnerability amplifies the elemental component", () => {
    const { setup } = attackHit(
      make("FIRE", "HIT", "20d1", { resistLevel: () => -1 }),
    );
    /* elemental = 20 * 4 / 3 = 26 > physical 18. */
    expect(1000 - setup.state.actor.player.chp).toBe(26);
  });
});

describe("live monster melee - damage reduction and the unreduced crit", () => {
  it("applies player_apply_damage_reduction to the HP dealt", () => {
    const { setup } = attackHit(
      make("HURT", "HIT", "20d1", {
        reduction: () => ({ damRed: 5, percDamRed: 50 }),
      }),
    );
    /* adjust_dam_armor(20, 0) = 20; reduced = (20-5) - 50% = 8. */
    expect(1000 - setup.state.actor.player.chp).toBe(8);
  });

  it("feeds the UNREDUCED damage to the cut critical, reduced HP to the player", () => {
    const { setup } = attackHit(
      make("HURT", "CLAW", "50d1", {
        reduction: () => ({ damRed: 0, percDamRed: 90 }),
      }),
    );
    /* context->damage = 50 (unreduced) -> cut critical; HP = 50 - 90% = 5. */
    expect(1000 - setup.state.actor.player.chp).toBe(5);
    expect(setup.state.actor.player.timed[TMD.CUT]).toBeGreaterThan(0);
  });
});

describe("live monster melee - status effects", () => {
  it("poisons the player after the elemental component", () => {
    const { setup } = attackHit(make("POISON", "STING", "1d1"));
    expect(setup.state.actor.player.timed[TMD.POISONED]).toBeGreaterThan(0);
  });

  it("confuses the player", () => {
    const { setup } = attackHit(make("CONFUSE", "HIT", "1d1"));
    expect(setup.state.actor.player.timed[TMD.CONFUSED]).toBeGreaterThan(0);
  });

  it("blinds the player", () => {
    const { setup } = attackHit(make("BLIND", "HIT", "1d1"));
    expect(setup.state.actor.player.timed[TMD.BLIND]).toBeGreaterThan(0);
  });

  it("stuns the player with a heavy blow", () => {
    const { setup } = attackHit(make("HURT", "PUNCH", "50d1"));
    expect(setup.state.actor.player.timed[TMD.STUN]).toBeGreaterThan(0);
  });

  it("paralyzes when the saving throw fails (SKILL_SAVE 0)", () => {
    const { setup } = attackHit(make("PARALYZE", "HIT", "1d1"), (s) => {
      (s.state.actor.combat.skills as number[])[SKILL.SAVE] = 0;
    });
    expect(setup.state.actor.player.timed[TMD.PARALYZED]).toBeGreaterThan(0);
  });

  it("resists paralysis when the saving throw succeeds (SKILL_SAVE 100)", () => {
    const { setup } = attackHit(make("PARALYZE", "HIT", "1d1"), (s) => {
      (s.state.actor.combat.skills as number[])[SKILL.SAVE] = 100;
    });
    expect(setup.state.actor.player.timed[TMD.PARALYZED]).toBe(0);
    expect(setup.msgs).toContain("You resist the effects!");
  });
});

describe("live monster melee - stat drain", () => {
  it("drains strength (LOSE_STR)", () => {
    const { setup } = attackHit(make("LOSE_STR", "HIT", "1d1"), (s) => {
      s.state.actor.player.statCur[STAT.STR] = 18;
      s.state.actor.player.statMax[STAT.STR] = 18;
    });
    expect(setup.state.actor.player.statCur[STAT.STR]).toBeLessThan(18);
  });
});

describe("live monster melee - theft", () => {
  it("steals gold (EAT_GOLD)", () => {
    const { setup } = attackHit(
      make("EAT_GOLD", "TOUCH", "1d1"),
      (s) => {
        s.state.actor.player.au = 1000;
        /* Paralysed: no saving throw, the theft always lands. */
        s.state.actor.player.timed[TMD.PARALYZED] = 1;
      },
    );
    expect(setup.state.actor.player.au).toBeLessThan(1000);
    /* The stolen gold is attached to the monster's held pile (monster_carry),
     * as money with ORIGIN.STOLEN, so it drops on death. */
    expect(setup.mon.heldObj.length).toBeGreaterThan(0);
    const gold = setup.mon.heldObj[0]!;
    expect(gold.tval).toBe(TV.GOLD);
    expect(gold.origin).toBe(ORIGIN.STOLEN);
    expect(gold.pval).toBeGreaterThan(0);
  });

  it("steals a non-artifact pack item (EAT_ITEM)", () => {
    const { setup } = attackHit(
      make("EAT_ITEM", "TOUCH", "1d1", { packSize: 1 }),
      (s) => {
        /* One edible item at pack slot 0; packSize 1 forces the pick. */
        const food = objectPrep(
          new Rng(9),
          objReg,
          constants,
          objReg.kinds.find(
            (k) => k.tval === TV.FOOD && k.kidx < objReg.ordinaryKindCount,
          )!,
          0,
          "average",
        );
        food.number = 1;
        const handle = gearAdd(s.state.gear, food);
        s.state.gear.pack.push(handle);
        s.state.actor.player.timed[TMD.PARALYZED] = 1;
      },
    );
    expect(setup.state.gear.pack.length).toBe(0);
    /* The stolen item is carried by the monster (drops on death). */
    expect(setup.mon.heldObj.length).toBe(1);
    expect(setup.mon.heldObj[0]!.tval).toBe(TV.FOOD);
  });
});

/*
 * The EAT_ handlers' own RNG draw order/count (mon-blows.c
 * melee_effect_handler_EAT_GOLD / _EAT_ITEM / _EAT_FOOD / _EAT_LIGHT,
 * steal_player_item), called directly on the MonBlowEnv so the draw counts
 * aren't muddied by the to-hit / damage rolls in monMeleeAttack. Each pair of
 * tests below covers a "steal happens" branch and a "nothing to steal"
 * branch, per mon-blows.c: paralysis (TMD_PARALYZED) skips the saving-throw
 * draw entirely (a false-first `&&` operand, matching C's short-circuit), and
 * EAT_LIGHT always draws its "250+1d250" regardless of whether a light is
 * actually worn.
 */
describe("live monster melee - EAT_ handler RNG order (mon-blows.c)", () => {
  it("EAT_GOLD: paralysis skips the saving throw; the gold roll is the only draw", () => {
    const state = makeState({ seed: 7 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, {}, msgs);
    state.actor.player.au = 1000;
    state.actor.player.timed[TMD.PARALYZED] = 1;

    const randint0Spy = vi.spyOn(state.rng, "randint0");
    const randint1Spy = vi.spyOn(state.rng, "randint1");

    const blinked = env.eatGold();

    expect(randint0Spy).not.toHaveBeenCalled();
    expect(randint1Spy).toHaveBeenCalledTimes(1);
    expect(randint1Spy).toHaveBeenCalledWith(25);
    expect(blinked).toBe(true);
    expect(state.actor.player.au).toBeLessThan(1000);
    expect(mon.heldObj.length).toBeGreaterThan(0);
  });

  it("EAT_GOLD: still draws the gold roll (no blink) when the player is broke", () => {
    const state = makeState({ seed: 7 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, {}, msgs);
    state.actor.player.au = 0;
    state.actor.player.timed[TMD.PARALYZED] = 1;

    const randint0Spy = vi.spyOn(state.rng, "randint0");
    const randint1Spy = vi.spyOn(state.rng, "randint1");

    const blinked = env.eatGold();

    expect(randint0Spy).not.toHaveBeenCalled();
    expect(randint1Spy).toHaveBeenCalledTimes(1);
    expect(blinked).toBe(false);
    expect(state.actor.player.au).toBe(0);
    expect(mon.heldObj.length).toBe(0);
    expect(msgs).toContain("Nothing was stolen.");
  });

  it("EAT_GOLD: a successful saving throw draws the save plus the occasional-blink roll, no gold roll", () => {
    const state = makeState({ seed: 7 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, {}, msgs);
    state.actor.player.au = 1000;
    /* lev 100 forces adj_dex_safe[dex] + lev >= 100 > any randint0(100). */
    state.actor.player.lev = 100;

    const randint0Spy = vi.spyOn(state.rng, "randint0");
    const randint1Spy = vi.spyOn(state.rng, "randint1");

    env.eatGold();

    expect(randint0Spy).toHaveBeenCalledTimes(2);
    expect(randint1Spy).not.toHaveBeenCalled();
    expect(msgs).toContain("You quickly protect your money pouch!");
    expect(state.actor.player.au).toBe(1000);
  });

  it("EAT_ITEM: paralysis skips the saving throw; steals the only pack item in one draw", () => {
    const state = makeState({ seed: 11 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, { packSize: 1 }, msgs);
    state.actor.player.timed[TMD.PARALYZED] = 1;

    const food = objectPrep(
      new Rng(9),
      objReg,
      constants,
      objReg.kinds.find(
        (k) => k.tval === TV.FOOD && k.kidx < objReg.ordinaryKindCount,
      )!,
      0,
      "average",
    );
    food.number = 1;
    const handle = gearAdd(state.gear, food);
    state.gear.pack.push(handle);

    const randint0Spy = vi.spyOn(state.rng, "randint0");

    const result = env.eatItem();

    expect(randint0Spy).toHaveBeenCalledTimes(1);
    expect(randint0Spy).toHaveBeenCalledWith(1);
    expect(result.blinked).toBe(true);
    expect(state.gear.pack.length).toBe(0);
    expect(mon.heldObj.length).toBe(1);
  });

  it("EAT_ITEM: an empty pack still burns all ten tries and steals nothing", () => {
    const state = makeState({ seed: 11 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, { packSize: 5 }, msgs);
    state.actor.player.timed[TMD.PARALYZED] = 1;

    const randint0Spy = vi.spyOn(state.rng, "randint0");

    const result = env.eatItem();

    expect(randint0Spy).toHaveBeenCalledTimes(10);
    expect(result.blinked).toBe(false);
    expect(mon.heldObj.length).toBe(0);
  });

  it("EAT_ITEM: a successful saving throw draws exactly one roll and always blinks", () => {
    const state = makeState({ seed: 11 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, {}, msgs);
    state.actor.player.lev = 100;

    const randint0Spy = vi.spyOn(state.rng, "randint0");

    const result = env.eatItem();

    expect(randint0Spy).toHaveBeenCalledTimes(1);
    expect(result.blinked).toBe(true);
    expect(msgs).toContain("You grab hold of your backpack!");
  });

  it("EAT_FOOD: eats the only edible pack item in one draw", () => {
    const state = makeState({ seed: 13 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, { packSize: 1 }, msgs);

    const food = objectPrep(
      new Rng(9),
      objReg,
      constants,
      objReg.kinds.find(
        (k) => k.tval === TV.FOOD && k.kidx < objReg.ordinaryKindCount,
      )!,
      0,
      "average",
    );
    food.number = 1;
    const handle = gearAdd(state.gear, food);
    state.gear.pack.push(handle);

    const randint0Spy = vi.spyOn(state.rng, "randint0");

    env.eatFood();

    expect(randint0Spy).toHaveBeenCalledTimes(1);
    expect(state.gear.pack.length).toBe(0);
    expect(msgs.some((m) => m.includes("was eaten!"))).toBe(true);
  });

  it("EAT_FOOD: an empty pack burns all ten tries and eats nothing", () => {
    const state = makeState({ seed: 13 });
    const mon = addMon(state, makeRace({ level: 50 }), loc(19, 12));
    const msgs: string[] = [];
    const env = buildEnvWithMsgs(state, mon, { packSize: 5 }, msgs);

    const randint0Spy = vi.spyOn(state.rng, "randint0");

    env.eatFood();

    expect(randint0Spy).toHaveBeenCalledTimes(10);
    expect(msgs.length).toBe(0);
  });

  it("EAT_LIGHT: drains exactly one RNG value, identically whether or not a light is worn", () => {
    /* No light equipped: the drain roll still happens (effect_calculate_value
     * runs unconditionally before the "is there a light" check). */
    const stateA = makeState({ seed: 21 });
    const monA = addMon(stateA, makeRace({ level: 50 }), loc(19, 12));
    const envA = buildEnvWithMsgs(stateA, monA, {}, []);
    const spyA = vi.spyOn(stateA.rng, "randint1");

    envA.eatLight();

    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyA).toHaveBeenCalledWith(250);

    /* Same seed, a fueled light worn: same single draw, fuel is now spent. */
    const stateB = makeState({ seed: 21 });
    const monB = addMon(stateB, makeRace({ level: 50 }), loc(19, 12));
    const msgsB: string[] = [];
    const envB = buildEnvWithMsgs(stateB, monB, {}, msgsB);
    const light = objectPrep(
      new Rng(3),
      objReg,
      constants,
      objReg.kinds.find(
        (k) => k.tval === TV.LIGHT && k.kidx < objReg.ordinaryKindCount,
      )!,
      0,
      "average",
    );
    light.timeout = 5000;
    const handle = gearAdd(stateB.gear, light);
    const lightSlot = stateB.actor.player.body.slots.findIndex(
      (s) => s.type === "LIGHT",
    );
    stateB.actor.player.equipment[lightSlot] = handle;

    const spyB = vi.spyOn(stateB.rng, "randint1");

    envB.eatLight();

    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledWith(250);
    expect(light.timeout).toBeLessThan(5000);
    /* Same seed, same single draw either way: RNG consumption is invariant
     * across the "light present" branch, exactly as effect_handler_DRAIN_LIGHT
     * always calls effect_calculate_value before checking for an object. */
    expect(stateB.rng.getState()).toEqual(stateA.rng.getState());
    expect(msgsB).toContain("Your light dims.");
  });
});
