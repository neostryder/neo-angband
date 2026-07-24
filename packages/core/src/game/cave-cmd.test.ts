import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FEAT, MFLAG, MON_TMD, SQUARE } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import type { Rng } from "../rng";
import { SKILL } from "../player/types";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { ArtifactState, ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { tvalIsMoney } from "../obj/object";
import {
  DIGGING,
  calcDiggingChances,
  installCaveCommands,
  squareDigging,
  squareIsDiggable,
  squareIsOpenDoor,
} from "./cave-cmd";
import { floorPile } from "./floor";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import type { PlayerCommand } from "./context";

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

const constants = bindConstants(loadJson("constants"));

function makeDeps(): MakeDeps {
  const reg = new ObjRegistry(objPack);
  return {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts: false,
  };
}

/** A state, a registry with the cave commands, and a one-command runner. */
function setup(deps = {}): {
  state: GameState;
  run: (cmd: PlayerCommand) => number;
} {
  const state = makeState({ playerGrid: loc(5, 5) });
  const registry = createDefaultRegistry();
  installCaveCommands(registry, deps);
  const run = (cmd: PlayerCommand): number => {
    const commands = [cmd];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
    return processPlayer(state, registry).energyUsed;
  };
  return { state, run };
}

/** Raise the DIGGING skill so digs succeed / keep it 0 so they cannot. */
function setDigging(state: GameState, value: number): void {
  state.actor.combat = {
    ...state.actor.combat,
    skills: state.actor.combat.skills.map((v, i) =>
      i === SKILL.DIGGING ? value : v,
    ),
  };
}

describe("calcDiggingChances (player-calcs.c)", () => {
  it("matches the upstream formulas and floors at zero", () => {
    const c = calcDiggingChances(50);
    expect(c[DIGGING.RUBBLE]).toBe(400);
    expect(c[DIGGING.MAGMA]).toBe(160);
    expect(c[DIGGING.QUARTZ]).toBe(60);
    expect(c[DIGGING.GRANITE]).toBe(10);
    expect(c[DIGGING.DOORS]).toBe(27);
    expect(calcDiggingChances(0).every((v) => v === 0)).toBe(true);
  });
});

describe("open / close doors", () => {
  it("opens a closed door and spends a full turn", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    const energy = run({ code: "open", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    expect(squareIsOpenDoor(state, loc(6, 5))).toBe(true);
  });

  it("walking into a closed door opens it without stepping (move_player bump-to-open, cmd-cave.c L1079-1083)", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    const energy = run({ code: "walk", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    /* The alter branch opens the door and returns; the player stays put. */
    expect(state.actor.grid).toEqual(loc(5, 5));
  });

  it("closes an open door", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.OPEN);
    const energy = run({ code: "close", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
  });

  it("a broken door cannot be closed", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.BROKEN);
    run({ code: "close", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.BROKEN);
  });

  it("opening with nothing there costs no turn", () => {
    const { run } = setup();
    expect(run({ code: "open", dir: 6 })).toBe(0);
  });

  it("a locked door resists until the pickLock seam succeeds", () => {
    let picked = false;
    const { state, run } = setup({
      env: {
        isLockedDoor: (): boolean => true,
        pickLock: (): boolean => picked,
      },
    });
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    run({ code: "open", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
    picked = true;
    run({ code: "open", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
  });

  it("a monster in the way is attacked instead", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 1000 });
    const energy = run({ code: "open", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.hp).toBeLessThan(1000); // harness combat always connects
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
  });

  it("a camouflaged monster in the way is revealed instead of attacked (do_cmd_open, cmd-cave.c L293-298)", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 1000 });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mTimed[MON_TMD.SLEEP] = 20;

    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };

    const energy = run({ code: "open", dir: 6 });

    expect(energy).toBe(state.z.moveEnergy);
    expect(revealed).toBe(mon.midx);
    expect(mon.hp).toBe(1000); // not attacked
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0); // monster_wake(mon, false, 100)
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED); // door untouched
  });
});

describe("tunnel", () => {
  it("a skilled digger removes magma; the wall becomes floor", () => {
    const { state, run } = setup();
    setDigging(state, 2000); // chance 7960 > any randint0(1600)
    state.chunk.setFeat(loc(6, 5), FEAT.MAGMA);
    expect(squareIsDiggable(state, loc(6, 5))).toBe(true);
    expect(squareDigging(state, loc(6, 5))).toBeGreaterThan(0);
    const energy = run({ code: "tunnel", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.FLOOR);
  });

  it("an unskilled digger chips away futilely (turn spent, wall stays)", () => {
    const { state, run } = setup();
    setDigging(state, 0);
    state.chunk.setFeat(loc(6, 5), FEAT.GRANITE);
    const energy = run({ code: "tunnel", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.GRANITE);
  });

  it("digging out a gold vein drops treasure on the floor", () => {
    const { state, run } = setup({ makeDeps: makeDeps() });
    setDigging(state, 2000);
    state.chunk.depth = 5;
    state.chunk.setFeat(loc(6, 5), FEAT.MAGMA_K);
    run({ code: "tunnel", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.FLOOR);
    const pile = floorPile(state, loc(6, 5));
    expect(pile.length).toBe(1);
    expect(tvalIsMoney(pile[0]!.tval)).toBe(true);
  });

  it("permanent rock cannot be tunneled", () => {
    const { state, run } = setup();
    setDigging(state, 2000);
    state.chunk.setFeat(loc(6, 5), FEAT.PERM);
    expect(run({ code: "tunnel", dir: 6 })).toBe(0);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.PERM);
  });
});

/**
 * cmd-core.c process_command auto_repeat_n = 99 for tunnel and friends: a dig
 * that fails but still has a chance re-queues the command so digging continues
 * across game turns without re-pressing the key; a dig that succeeds or is
 * hopeless does not (upstream `if (!more) disturb(player)`).
 */
describe("tunnel - auto-repeat (cmd_set_repeat 99)", () => {
  it("a failed dig with a chance re-queues the command with a decremented budget", () => {
    const { state, run } = setup();
    setDigging(state, 440); // granite chance = 440 - 40 = 400 (out of 1600)
    state.chunk.setFeat(loc(6, 5), FEAT.GRANITE);
    /* Force the 400-in-1600 roll to fail (chance > 0, so the dig continues). */
    state.rng.randint0 = (): number => 1500;
    const energy = run({ code: "tunnel", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.GRANITE); // still digging
    expect(state.cmdQueue).toHaveLength(1);
    expect(state.cmdQueue?.[0]).toMatchObject({
      code: "tunnel",
      dir: 6,
      repeatRemaining: 98, // seeded 99, one attempt spent
    });
  });

  it("a successful dig does not re-queue", () => {
    const { state, run } = setup();
    setDigging(state, 2000);
    state.chunk.setFeat(loc(6, 5), FEAT.MAGMA);
    run({ code: "tunnel", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.FLOOR);
    expect(state.cmdQueue ?? []).toHaveLength(0);
  });

  it("a hopeless dig (no chance) does not re-queue", () => {
    const { state, run } = setup();
    setDigging(state, 0); // granite chance floors at 0 -> chip futilely
    state.chunk.setFeat(loc(6, 5), FEAT.GRANITE);
    run({ code: "tunnel", dir: 6 });
    expect(state.cmdQueue ?? []).toHaveLength(0);
  });

  it("stops when the repeat budget is exhausted, even with a chance left", () => {
    const { state, run } = setup();
    setDigging(state, 440);
    state.chunk.setFeat(loc(6, 5), FEAT.GRANITE);
    state.rng.randint0 = (): number => 1500;
    /* The last of the 99 attempts (budget 0): the dig fails but does not
     * re-queue, matching cmd_set_repeat's exhaustion. */
    run({ code: "tunnel", dir: 6, repeatRemaining: 0 });
    expect(state.cmdQueue ?? []).toHaveLength(0);
  });
});

describe("tunnel - player_best_digger swap", () => {
  it("digs with the swapped-in best digger's DIGGING, not the wielded one", () => {
    const { state, run } = setup();
    setDigging(state, 0); // the wielded weapon cannot dig at all
    /* A pack shovel would grant a strong DIGGING via calc_bonuses. */
    state.bestDiggerDigging = (): number => 2000;
    state.chunk.setFeat(loc(6, 5), FEAT.MAGMA);
    run({ code: "tunnel", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.FLOOR);
  });

  it("without the swap hook only the wielded DIGGING decides (dig fails)", () => {
    const { state, run } = setup();
    setDigging(state, 0);
    state.chunk.setFeat(loc(6, 5), FEAT.MAGMA);
    run({ code: "tunnel", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.MAGMA);
  });
});

/** Set one combat skill without disturbing the others. */
function setSkill(state: GameState, skill: number, value: number): void {
  state.actor.combat = {
    ...state.actor.combat,
    skills: state.actor.combat.skills.map((v, i) => (i === skill ? value : v)),
  };
}

/** An Rng that records the m_bonus / randint0 / randint1 call order. */
function recordingRng(seq: {
  mBonus?: number;
  randint0?: number[];
  randint1?: number[];
}): { rng: Rng; log: string[] } {
  const log: string[] = [];
  let i0 = 0;
  let i1 = 0;
  const rng = {
    mBonus: (): number => {
      log.push("mBonus");
      return seq.mBonus ?? 0;
    },
    randint0: (): number => {
      log.push("randint0");
      return seq.randint0?.[i0++] ?? 0;
    },
    randint1: (): number => {
      log.push("randint1");
      return seq.randint1?.[i1++] ?? 1;
    },
  };
  return { rng: rng as unknown as Rng, log };
}

/** A closed door at (6,5), the player's grid lit, and a door-lock recorder. */
function lockSetup(rng: Rng): {
  state: GameState;
  run: (cmd: PlayerCommand) => number;
  msgs: string[];
  locked: Set<string>;
  power: () => number;
} {
  const state = makeState({ playerGrid: loc(5, 5) });
  state.rng = rng;
  state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN); // no_light penalty off
  state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
  const locked = new Set<string>();
  let recorded = -1;
  const key = (g: Loc): string => `${g.x},${g.y}`;
  state.setDoorLock = (g: Loc, p: number): void => {
    recorded = p;
    locked.add(key(g));
  };
  const msgs: string[] = [];
  const registry = createDefaultRegistry();
  installCaveCommands(registry, {
    env: {
      msg: (t: string): void => {
        msgs.push(t);
      },
      isLockedDoor: (g: Loc): boolean => locked.has(key(g)),
    },
  });
  const run = (cmd: PlayerCommand): number => {
    const commands = [cmd];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
    return processPlayer(state, registry).energyUsed;
  };
  return { state, run, msgs, locked, power: () => recorded };
}

describe("lock door (do_cmd_lock_door)", () => {
  /* Every energy-capable command now draws the bloodlust-coercion roll
   * before executing (cmd-core.c:373 randint0(200) < timed[TMD_BLOODLUST]),
   * so the sequences start with one extra randint0 (scripted 199: never
   * coerces at zero bloodlust). */
  it("locks the door on success: m_bonus then randint0(100), sets the power", () => {
    const { rng, log } = recordingRng({ mBonus: 3, randint0: [199, 0] });
    const { state, run, msgs, locked, power } = lockSetup(rng);
    setSkill(state, SKILL.DISARM_PHYS, 30); // i=30, power=3, j=27; 0 < 27 => lock
    const energy = run({ code: "lock", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    /* Coercion roll, then exact lock order with no retry draw. */
    expect(log).toEqual(["randint0", "mBonus", "randint0"]);
    expect(power()).toBe(3);
    expect(locked.has("6,5")).toBe(true);
    expect(msgs).toContain("You lock the door.");
  });

  it("failure with a high skill draws the keep-trying randint1(i)", () => {
    const { rng, log } = recordingRng({
      mBonus: 3,
      randint0: [199, 50], // coercion miss; 50 >= j (27) => failure
      randint1: [10], // > 5 => keep trying
    });
    const { state, run, msgs, locked } = lockSetup(rng);
    setSkill(state, SKILL.DISARM_PHYS, 30);
    run({ code: "lock", dir: 6 });
    expect(log).toEqual(["randint0", "mBonus", "randint0", "randint1"]);
    expect(locked.size).toBe(0); // door not locked
    expect(msgs).toContain("You failed to lock the door.");
  });

  it("failure with a low skill (i <= 5) draws no randint1", () => {
    const { rng, log } = recordingRng({ mBonus: 0, randint0: [199, 50] });
    const { state, run, locked } = lockSetup(rng);
    setSkill(state, SKILL.DISARM_PHYS, 5); // i=5, j=5; 50 >= 5 fail, i not > 5
    run({ code: "lock", dir: 6 });
    expect(log).toEqual(["randint0", "mBonus", "randint0"]);
    expect(locked.size).toBe(0);
  });

  it("the disarm command locks a closed, unlocked door (do_cmd_disarm L927-930)", () => {
    const { rng } = recordingRng({ mBonus: 4, randint0: [0] });
    const { state, run, locked, power } = lockSetup(rng);
    setSkill(state, SKILL.DISARM_PHYS, 30);
    run({ code: "disarm", dir: 6 });
    expect(locked.has("6,5")).toBe(true);
    expect(power()).toBe(4);
  });
});

describe("alter / stairs", () => {
  it("alter opens a door or digs a wall by what is there", () => {
    const { state, run } = setup();
    setDigging(state, 2000);
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    run({ code: "alter", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    state.chunk.setFeat(loc(4, 5), FEAT.MAGMA);
    run({ code: "alter", dir: 4 });
    expect(state.chunk.feat(loc(4, 5))).toBe(FEAT.FLOOR);
  });

  it("descend requires a down staircase underfoot", () => {
    const { state, run } = setup();
    expect(run({ code: "descend" })).toBe(0);
    expect(state.generateLevel).toBe(false);
    state.chunk.setFeat(loc(5, 5), FEAT.MORE);
    expect(run({ code: "descend" })).toBe(state.z.moveEnergy);
    expect(state.generateLevel).toBe(true);
  });

  it("ascend requires an up staircase and not being at the surface", () => {
    const { state, run } = setup();
    state.chunk.depth = 3;
    expect(run({ code: "ascend" })).toBe(0);
    state.chunk.setFeat(loc(5, 5), FEAT.LESS);
    expect(run({ code: "ascend" })).toBe(state.z.moveEnergy);
    expect(state.generateLevel).toBe(true);
  });
});
