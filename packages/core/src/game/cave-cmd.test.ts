import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { FEAT, MFLAG, MON_TMD, SQUARE, TRF, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import type { Rng } from "../rng.js";
import { SKILL } from "../player/types.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ArtifactState, ObjAllocState, objectPrep } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { tvalIsMoney } from "../obj/object.js";
import { OptionState } from "../player/options.js";
import {
  DIGGING,
  calcDiggingChances,
  installCaveCommands,
  squareDigging,
  squareIsDiggable,
  countFeats,
  squareIsOpenDoor,
  squareIsUnlockedDoor,
} from "./cave-cmd.js";
import { floorCarry, floorPile } from "./floor.js";
import { squareMemorize } from "./known.js";
import { createDefaultRegistry, processPlayer } from "./player-turn.js";
import { addMon, makeRace, makeState } from "./harness.js";
import type { GameState } from "./context.js";
import type { PlayerCommand } from "./context.js";
import type { GameObject } from "../obj/object.js";
import { placeTrap, squareIsDisarmableTrap, squareTrap } from "./trap.js";
import { bindTraps } from "../world/trap.js";
import type { TrapKind, TrapRecordJson } from "../world/trap.js";
import { chestCheck } from "./chest.js";
import { CHEST_QUERY } from "../obj/chest.js";

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
  it("auto-selects one known closed door without a direction (cmd-cave.c:245-260)", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));

    expect(run({ code: "open" })).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
  });

  it("does not auto-select when zero or multiple known doors are candidates", () => {
    const { state, run } = setup();
    expect(run({ code: "open" })).toBe(0);

    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    state.chunk.setFeat(loc(4, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    squareMemorize(state, loc(4, 5));
    expect(run({ code: "open" })).toBe(0);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
    expect(state.chunk.feat(loc(4, 5))).toBe(FEAT.CLOSED);
  });

  it("opens a closed door and spends a full turn", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    const energy = run({ code: "open", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    expect(squareIsOpenDoor(state, loc(6, 5))).toBe(true);
  });

  it("walking into a closed door opens it without stepping (move_player bump-to-open, cmd-cave.c L1079-1083)", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    /* square_isknown gate (cmd-cave.c:1079): only a known door auto-opens. */
    squareMemorize(state, loc(6, 5));
    const energy = run({ code: "walk", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    /* The alter branch opens the door and returns; the player stays put. */
    expect(state.actor.grid).toEqual(loc(5, 5));
  });

  it("closes an open door", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.OPEN);
    squareMemorize(state, loc(6, 5));
    const energy = run({ code: "close", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
  });

  it("auto-selects one known open door without a direction (cmd-cave.c:409)", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.OPEN);
    squareMemorize(state, loc(6, 5));

    expect(run({ code: "close" })).toBe(state.z.moveEnergy);
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
    squareMemorize(state, loc(6, 5));
    run({ code: "open", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
    picked = true;
    run({ code: "open", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
  });

  it("walking into a locked door re-queues the walk (move_player auto-repeat, cmd-cave.c L1079-1083)", () => {
    const { state, run } = setup({
      env: { isLockedDoor: (): boolean => true, pickLock: (): boolean => false },
    });
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    const energy = run({ code: "walk", dir: 6 });
    /* The pick fails: the door stays locked, the player does not step, the turn
     * is spent, and the walk re-queues (cmd_set_repeat(99), one attempt spent). */
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
    expect(state.actor.grid).toEqual(loc(5, 5));
    expect(state.cmdQueue).toHaveLength(1);
    expect(state.cmdQueue?.[0]).toMatchObject({
      code: "walk",
      dir: 6,
      repeatRemaining: 98,
    });
  });

  it("walking into a locked door that opens does not re-queue", () => {
    const { state, run } = setup({
      env: { isLockedDoor: (): boolean => true, pickLock: (): boolean => true },
    });
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    run({ code: "walk", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    expect(state.cmdQueue ?? []).toHaveLength(0);
  });

  it("the walk-into-locked-door repeat stops when the budget is exhausted", () => {
    const { state, run } = setup({
      env: { isLockedDoor: (): boolean => true, pickLock: (): boolean => false },
    });
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    /* Last of the 99 attempts (budget 0): the pick fails but does not re-queue. */
    run({ code: "walk", dir: 6, repeatRemaining: 0 });
    expect(state.cmdQueue ?? []).toHaveLength(0);
  });

  it("a monster in the way is attacked instead", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    const mon = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 1000 });
    const energy = run({ code: "open", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.hp).toBeLessThan(1000); // harness combat always connects
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
  });

  it("a camouflaged monster in the way is revealed instead of attacked (do_cmd_open, cmd-cave.c L293-298)", () => {
    const { state, run } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
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
    squareMemorize(state, loc(6, 5));
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
    squareMemorize(state, loc(6, 5));
    const energy = run({ code: "tunnel", dir: 6 });
    expect(energy).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.GRANITE);
  });

  it("digging out a gold vein drops treasure on the floor", () => {
    const { state, run } = setup({ makeDeps: makeDeps() });
    setDigging(state, 2000);
    state.chunk.depth = 5;
    state.chunk.setFeat(loc(6, 5), FEAT.MAGMA_K);
    squareMemorize(state, loc(6, 5));
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
    squareMemorize(state, loc(6, 5));
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
    squareMemorize(state, loc(6, 5));
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
    squareMemorize(state, loc(6, 5));
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

  it("auto-selects one known unlocked door for disarm (cmd-cave.c:874-876)", () => {
    const { rng } = recordingRng({ mBonus: 4, randint0: [0] });
    const { state, run, locked, power } = lockSetup(rng);
    squareMemorize(state, loc(6, 5));

    expect(run({ code: "disarm" })).toBe(state.z.moveEnergy);
    expect(locked.has("6,5")).toBe(true);
    expect(power()).toBe(4);
  });
});

describe("alter / stairs", () => {
  it("alter opens a door or digs a wall by what is there", () => {
    const { state, run } = setup();
    setDigging(state, 2000);
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    run({ code: "alter", dir: 6 });
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.OPEN);
    state.chunk.setFeat(loc(4, 5), FEAT.MAGMA);
    squareMemorize(state, loc(4, 5));
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

describe("countFeats (cave.c:644-679)", () => {
  it("counts only KNOWN adjacent matches, and reports the last one", () => {
    const { state } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    state.chunk.setFeat(loc(4, 5), FEAT.CLOSED);

    /* Unknown terrain never counts: the C requires square_isknown and then
     * tests the player's memory, not the live map (cave.c:664-668). */
    expect(countFeats(state, (s, g) => s.chunk.isClosedDoor(g), false).count).toBe(0);

    squareMemorize(state, loc(6, 5));
    const one = countFeats(state, (s, g) => s.chunk.isClosedDoor(g), false);
    expect(one.count).toBe(1);
    expect(one.grid).toEqual(loc(6, 5));

    squareMemorize(state, loc(4, 5));
    expect(countFeats(state, (s, g) => s.chunk.isClosedDoor(g), false).count).toBe(2);
  });

  it("includes the player's own grid only when `under` is set (ddgrid_ddd[8])", () => {
    const { state } = setup();
    /* The player stands on a known open door; nothing else adjacent matches. */
    state.chunk.setFeat(loc(5, 5), FEAT.OPEN);
    squareMemorize(state, loc(5, 5));

    expect(countFeats(state, (s, g) => squareIsOpenDoor(s, g), false).count).toBe(0);
    const under = countFeats(state, (s, g) => squareIsOpenDoor(s, g), true);
    expect(under.count).toBe(1);
    expect(under.grid).toEqual(loc(5, 5));
  });

  it("combines with count_chests, including an underfoot chest", () => {
    /* count_chests owns the chest scan (obj-chest.c:459-483), including the
     * player's square; cmd-cave.c:250 adds that count to count_feats. */
    const chestDeps = { makeDeps: makeDeps() };
    const { state, run } = setup({ chestDeps });
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    squareMemorize(state, loc(6, 5));
    const chestKind = chestDeps.makeDeps.reg.lookupKind(
      TV.CHEST,
      chestDeps.makeDeps.reg.lookupSval(TV.CHEST, "Small wooden chest"),
    )!;
    const chest = objectPrep(state.rng, chestDeps.makeDeps.reg, constants, chestKind, 0, "average");
    chest.pval = 1;
    floorCarry(state, state.actor.grid, chest);
    const feats = countFeats(state, (s, g) => s.chunk.isClosedDoor(g), false);
    expect(feats.count).toBe(1);
    /* cmd-cave.c:250 adds both counts; it must prompt rather than choose the
     * adjacent door when the chest underfoot is the second candidate. */
    expect(run({ code: "open" })).toBe(0);
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
  });

  it("treats a closed door with no lock power as unlocked (cave-square.c:791)", () => {
    const { state } = setup();
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    expect(squareIsUnlockedDoor(state, loc(6, 5))).toBe(true);
    state.chunk.setFeat(loc(6, 5), FEAT.OPEN);
    expect(squareIsUnlockedDoor(state, loc(6, 5))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * dungeon_get_next_level (player-util.c:1147) at the stair commands.
 *
 * The port used to set targetDepth to depth +/- 1 directly, so the quest scan
 * never ran: stairs down from Sauron's level delivered the player straight to
 * Morgoth. The seam that was meant to carry this (getNextLevel) existed but
 * nothing wired it.
 * ------------------------------------------------------------------ */
describe("stairs go through dungeon_get_next_level", () => {
  /** A state on `depth` standing on the matching staircase. */
  function onStair(depth: number, feat: number): ReturnType<typeof setup> {
    const s = setup();
    s.state.chunk.depth = depth;
    s.state.chunk.setFeat(loc(5, 5), feat);
    return s;
  }

  it("stops the descent on an outstanding quest level (player-util.c:1163-1165)", () => {
    const { state, run } = onStair(99, FEAT.MORE);
    state.actor.player.quests = [
      { name: "Sauron", level: 99, race: 0, maxNum: 1, curNum: 0 },
    ];

    expect(run({ code: "descend" })).toBe(state.z.moveEnergy);
    /* is_quest(99) is true, so the loop returns 99 - the player stays. */
    expect(state.targetDepth).toBe(99);
  });

  it("descends normally once the quest is cleared (level reset to 0)", () => {
    const { state, run } = onStair(99, FEAT.MORE);
    state.actor.player.quests = [
      { name: "Sauron", level: 0, race: 0, maxNum: 1, curNum: 1 },
    ];

    run({ code: "descend" });
    expect(state.targetDepth).toBe(100);
  });

  it("refuses to descend from max_depth - 1 (cmd-cave.c:115-119)", () => {
    const { state, run } = onStair(0, FEAT.MORE);
    state.chunk.depth = state.z.maxDepth - 1;
    expect(run({ code: "descend" })).toBe(0);
    expect(state.generateLevel).toBe(false);
  });

  it("force_descend measures the drop from max_depth (cmd-cave.c:121-128)", () => {
    const { state, run } = onStair(2, FEAT.MORE);
    state.actor.player.maxDepth = 40;
    state.options = new OptionState({
      overrides: { birth_force_descend: true },
    });

    run({ code: "descend" });
    expect(state.targetDepth).toBe(41);
  });

  it("force_descend makes up staircases do nothing (cmd-cave.c:70-74)", () => {
    const { state, run } = onStair(5, FEAT.LESS);
    const msgs: string[] = [];
    state.msg = (t): void => void msgs.push(t);
    state.options = new OptionState({
      overrides: { birth_force_descend: true },
    });

    expect(run({ code: "ascend" })).toBe(0);
    expect(state.generateLevel).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * do_cmd_alter_aux's full dispatch (cmd-cave.c:951-1002). PORT_TODO 2.3.
 *
 * FOUR branches were missing, not the two the deferral note named, and the
 * fall-through spent no energy - which upstream's own comment above the function
 * exists to forbid ("This command must always take energy, to prevent free
 * detection of invisible monsters").
 *
 * The pre-existing alter test covered the two branches that WERE there. Nothing
 * asserted the absence of the other five behaviours, which is why they survived
 * the deferral note being marked reachable.
 * ------------------------------------------------------------------ */
describe("alter's remaining branches (do_cmd_alter_aux L974-997)", () => {
  const trapKinds = bindTraps(
    (
      JSON.parse(
        readFileSync(
          new URL("../../../content/pack/trap.json", import.meta.url),
          "utf8",
        ),
      ) as { records: TrapRecordJson[] }
    ).records,
  );

  function alterSetup(): {
    state: GameState;
    run: (cmd: PlayerCommand) => number;
    chestDeps: { makeDeps: MakeDeps; env: { msg: (t: string) => void } };
    msgs: string[];
  } {
    const msgs: string[] = [];
    /* chestDeps carries its OWN env (ChestEnv), separate from the cave-cmd env:
     * doCmdOpenChest / doCmdDisarmChest read deps.env, not the command layer's.
     * Without it every chest message is silently dropped, which is how the
     * discriminating assertion below first came back with an empty log. */
    const chestDeps = {
      makeDeps: makeDeps(),
      env: { msg: (t: string) => msgs.push(t) },
    };
    const { state, run } = setup({
      chestDeps,
      trapDeps: { kinds: trapKinds, env: { msg: (t: string) => msgs.push(t) } },
      env: { msg: (t: string) => msgs.push(t) },
    });
    /* Both do_cmd_disarm_aux and do_cmd_open_chest divide the disarm skill by ten
     * when `no_light` - !square_isseen on the PLAYER's own grid
     * (cave-view.c:914-917). makeState never runs the view pass, so without this
     * the harness silently applies the darkness penalty and a "high skill"
     * fixture still fails its roll. Measured: this is what made two of the tests
     * below fail on their first run. */
    state.chunk.sqinfoOn(state.actor.grid, SQUARE["SEEN"]);
    return { state, run, chestDeps, msgs };
  }

  function putChest(
    state: GameState,
    chestDeps: { makeDeps: MakeDeps },
    grid: Loc,
    pval: number,
  ): GameObject {
    const kind = chestDeps.makeDeps.reg.lookupKind(
      TV.CHEST,
      chestDeps.makeDeps.reg.lookupSval(TV.CHEST, "Small wooden chest"),
    )!;
    const chest = objectPrep(
      state.rng,
      chestDeps.makeDeps.reg,
      constants,
      kind,
      0,
      "average",
    );
    /* pval > 0 is a locked chest with that trap mask; < 0 is unlocked-and-empty
     * (obj-chest.c). Set explicitly rather than trusting the roll. */
    chest.pval = pval;
    floorCarry(state, grid, chest);
    return chest;
  }

  it("closes an open door (L993-995)", () => {
    const { state, run } = alterSetup();
    state.chunk.setFeat(loc(6, 5), FEAT.OPEN);
    squareMemorize(state, loc(6, 5));

    expect(run({ code: "alter", dir: 6 })).toBe(state.z.moveEnergy);

    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.CLOSED);
  });

  it("disarms a floor trap (L984-986)", () => {
    const { state, run } = alterSetup();
    const pit = trapKinds.find((k: TrapKind) => k.desc === "pit")!;
    placeTrap(state, loc(6, 5), pit.tidx, 5, { kinds: trapKinds });
    /* placeTrap leaves a trap HIDDEN; square_isdisarmabletrap wants TRF_VISIBLE
     * (cave-square.c:823), which the port reads through squareIsVisibleTrap. A
     * fixture without this reads as "no trap", so the assertion below is here to
     * make the fixture prove itself rather than let the test pass empty. */
    for (const t of squareTrap(state, loc(6, 5))) t.flags.on(TRF.VISIBLE);
    squareMemorize(state, loc(6, 5));
    expect(
      squareIsDisarmableTrap(state, loc(6, 5)),
      "fixture: a disarmable trap is there",
    ).toBe(true);
    /* Enough skill that the roll cannot fail and leave the trap in place. */
    setSkill(state, SKILL.DISARM_PHYS, 200);

    expect(run({ code: "alter", dir: 6 })).toBe(state.z.moveEnergy);

    expect(squareIsDisarmableTrap(state, loc(6, 5))).toBe(false);
  });

  it("opens a closed chest (L989-991)", () => {
    const { state, run, chestDeps } = alterSetup();
    /* pval 1 is LOCKED and untrapped (isTrappedChest is `pval > 0 && pval !== 1`,
     * obj/chest.ts), so this is the openable-not-trapped case and it picks the
     * right branch of the C's order. do_cmd_open_chest's success is unlock_chest,
     * which sets pval to 0 - it does not empty the chest in the same command. */
    const chest = putChest(state, chestDeps, loc(6, 5), 1);
    expect(
      chestCheck(state, loc(6, 5), CHEST_QUERY.OPENABLE),
      "fixture: an openable chest is there",
    ).toBe(chest);
    expect(
      chestCheck(state, loc(6, 5), CHEST_QUERY.TRAPPED),
      "fixture: and NOT a trapped one, or the earlier branch would win",
    ).toBe(null);
    setSkill(state, SKILL.DISARM_PHYS, 200);

    expect(run({ code: "alter", dir: 6 })).toBe(state.z.moveEnergy);

    expect(chest.pval, "unlocked by do_cmd_open_chest").toBe(0);
  });

  it("prefers a TRAPPED chest over an openable one, as the C order does", () => {
    /* L987-991: the trapped branch is tested first, and a chest with trap bits is
     * BOTH trapped and openable - so the order is the only thing that decides.
     *
     * TWO FIXTURE MISTAKES OF MINE ARE BURIED HERE, both caught by mutation.
     * The first draft used a skill of 0 and asserted "still locked": with the
     * branch deleted the openable path ALSO fails its roll and leaves it locked,
     * so removing the trapped branch entirely killed no test. The second was
     * knownPval: do_cmd_disarm_chest early-returns "I don't see any traps"
     * unless the chest's trap has been FOUND (obj-chest.c:702-704), so the
     * branch was a no-op either way. The discriminator has to be an outcome only
     * ONE branch can produce - disarm negates pval, open zeroes it. */
    const { state, run, chestDeps, msgs } = alterSetup();
    /* pval 3 = locked (bit 0) plus the first trap bit (2). pval 1 would be
     * locked-and-untrapped, which is the case the previous test uses. */
    const chest = putChest(state, chestDeps, loc(6, 5), 3);
    chest.knownPval = chest.pval; /* the trap has been found */
    expect(
      chestCheck(state, loc(6, 5), CHEST_QUERY.TRAPPED),
      "fixture: the chest reads as trapped",
    ).toBe(chest);
    expect(
      chestCheck(state, loc(6, 5), CHEST_QUERY.OPENABLE),
      "fixture: and openable too, so the ORDER is what decides",
    ).toBe(chest);
    setSkill(state, SKILL.DISARM_PHYS, 2000);

    expect(run({ code: "alter", dir: 6 })).toBe(state.z.moveEnergy);

    /* obj-chest.c:747 negates pval on a successful disarm; a successful OPEN
     * would have unlocked it to 0 and then emptied it. */
    expect(chest.pval, "disarmed, not opened").toBe(-3);
    expect(msgs).toContain("You have disarmed the chest.");
    expect(msgs).not.toContain("You have picked the lock.");
  });

  it("spends a FULL TURN on the fall-through, so '+' is not a free probe", () => {
    /* L961: energy_use is set before the dispatch, and the C says why - a
     * zero-energy fall-through lets the player sweep every adjacent square for
     * invisible monsters at no cost. This returned 0. */
    const { state, run, msgs } = alterSetup();
    /* Plain floor: no monster, not diggable, no door, no trap, no chest. */
    expect(state.chunk.feat(loc(6, 5))).toBe(FEAT.FLOOR);

    expect(run({ code: "alter", dir: 6 })).toBe(state.z.moveEnergy);

    expect(msgs).toContain("You spin around.");
  });
});
