import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FEAT, MFLAG, MON_TMD } from "../generated";
import { loc } from "../loc";
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
