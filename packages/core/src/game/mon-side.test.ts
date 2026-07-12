/**
 * Live monster-melee blow effects: combat/mon-melee.ts driven by the real
 * MonBlowEnv (game/mon-side.ts) over a harness GameState. Exercises the
 * elemental resist split, damage reduction, the status / stat / theft handlers
 * and the unreduced-vs-reduced damage rule end to end.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
