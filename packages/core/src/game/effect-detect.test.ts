import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { EF, FEAT, MFLAG, RF, SQUARE, TRF, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import {
  EffectRegistry,
  sourceNone,
  sourcePlayer,
} from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { bindTraps } from "../world/trap.js";
import type { TrapRecordJson } from "../world/trap.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { GameState } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import type { CastContext } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import { registerDetectHandlers } from "./effect-detect.js";
import { knownFeat, knownObject, squareIsKnown, squareMemorize } from "./known.js";
import { floorCarry } from "./floor.js";
import { placeTrap, squareTrap } from "./trap.js";
import type { TrapDeps } from "./trap.js";
import { FLOOR, addMon, makeRace, makeState } from "./harness.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const projections = bindProjections(
  (loadJson("projection") as { records: ProjectionRecordJson[] }).records,
);
const trapKinds = bindTraps(
  (loadJson("trap") as { records: TrapRecordJson[] }).records,
);

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
const objReg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

function makeObj(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), objReg, constants, kind, 0, "average");
}

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerDetectHandlers(r);
  return r;
}

function trapDeps(): TrapDeps {
  return { kinds: trapKinds };
}

function env(
  state: GameState,
  msgs?: string[],
  deps?: TrapDeps,
): EffectContext {
  const cast: CastContext = {
    projections,
    maxRange: 20,
    playerActor: basicPlayerActor(state),
  };
  const base: EffectContext = {
    rng: state.rng,
    ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
  };
  return attachGameEnv(base, {
    state,
    cast,
    ...(deps ? { general: { properties: [], trapDeps: deps } } : {}),
  });
}

describe("EF_MAP_AREA (effect-handler-general.c L1201)", () => {
  it("memorizes interesting features and nearby walls, not plain floor", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.setFeat(loc(12, 10), FEAT.CLOSED);
    const used = registry().effectSimple(EF.MAP_AREA, env(state), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(used).toBe(true);
    /* The door is remembered; open floor is not (it is boring). */
    expect(knownFeat(state, loc(12, 10))).toBe(FEAT.CLOSED);
    expect(squareIsKnown(state, loc(11, 10))).toBe(false);
  });

  it("forgets misremembered grids in the mapped area", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, FEAT.CLOSED);
    squareMemorize(state, grid);
    state.chunk.setFeat(grid, FLOOR); /* the door is gone */
    registry().effectSimple(EF.MAP_AREA, env(state), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(squareIsKnown(state, grid)).toBe(false);
  });
});

describe("EF_READ_MINDS (L1286)", () => {
  it("maps around detection-marked monsters", () => {
    const state = makeState({ playerGrid: loc(5, 5), w: 60 });
    const mon = addMon(state, makeRace(), loc(40, 10));
    mon.mflag.on(MFLAG.MARK);
    state.chunk.setFeat(loc(41, 10), FEAT.CLOSED);
    const msgs: string[] = [];
    registry().effectSimple(EF.READ_MINDS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 3,
      x: 3,
    });
    expect(knownFeat(state, loc(41, 10))).toBe(FEAT.CLOSED);
    expect(msgs).toContain("Images form in your mind!");
  });
});

describe("EF_DETECT_TRAPS (L1321)", () => {
  it("reveals hidden traps and marks the region trap-detected", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    state.chunk.depth = 5; /* pick_trap refuses in town */
    const deps = trapDeps();
    placeTrap(state, loc(12, 10), -1, 5, deps);
    const trap = squareTrap(state, loc(12, 10))[0]!;
    trap.flags.off(TRF.VISIBLE);

    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_TRAPS, env(state, msgs, deps), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(trap.flags.has(TRF.VISIBLE)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(12, 10), SQUARE.DTRAP)).toBe(true);
    expect(msgs).toContain("You sense the presence of traps!");
  });

  it("still reports (and marks) when there is nothing to find", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_TRAPS, env(state, msgs, trapDeps()), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(msgs).toContain("You sense no traps.");
    expect(state.chunk.sqinfoHas(loc(11, 10), SQUARE.DTRAP)).toBe(true);
  });
});

describe("EF_DETECT_DOORS (L1398)", () => {
  it("turns secret doors into real remembered doors", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.chunk.setFeat(loc(12, 10), FEAT.SECRET);
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_DOORS, env(state, msgs, trapDeps()), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(state.chunk.feat(loc(12, 10))).toBe(FEAT.CLOSED);
    expect(knownFeat(state, loc(12, 10))).toBe(FEAT.CLOSED);
    expect(msgs).toContain("You sense the presence of doors!");
  });

  it("forgets doors that are no longer there", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, FEAT.CLOSED);
    squareMemorize(state, grid);
    state.chunk.setFeat(grid, FLOOR);
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_DOORS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(squareIsKnown(state, grid)).toBe(false);
    expect(msgs).toContain("You sense no doors.");
  });
});

describe("EF_DETECT_STAIRS / EF_DETECT_ORE (L1467 / L1519)", () => {
  it("remembers stairs in range", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.setFeat(loc(12, 10), FEAT.LESS);
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_STAIRS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(knownFeat(state, loc(12, 10))).toBe(FEAT.LESS);
    expect(msgs).toContain("You sense the presence of stairs!");
  });

  it("remembers gold veins and forgets mined-out ones", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.setFeat(loc(12, 10), FEAT.MAGMA_K);
    const gone = loc(13, 10);
    state.chunk.setFeat(gone, FEAT.MAGMA_K);
    squareMemorize(state, gone);
    state.chunk.setFeat(gone, FLOOR);

    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_ORE, env(state, msgs), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(knownFeat(state, loc(12, 10))).toBe(FEAT.MAGMA_K);
    expect(squareIsKnown(state, gone)).toBe(false);
    expect(msgs).toContain("You sense the presence of buried treasure!");
  });

  it("detects silently from a none origin", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.setFeat(loc(12, 10), FEAT.MAGMA_K);
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_ORE, env(state, msgs), {
      origin: sourceNone(),
      y: 5,
      x: 5,
    });
    expect(knownFeat(state, loc(12, 10))).toBe(FEAT.MAGMA_K);
    expect(msgs).toEqual([]);
  });
});

describe("object detection (L1682-L1761)", () => {
  it("DETECT_OBJECTS learns the pile head, SENSE_OBJECTS only that something is there", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const potion = makeObj(TV.POTION);
    floorCarry(state, loc(12, 10), potion);
    const msgs: string[] = [];

    registry().effectSimple(EF.SENSE_OBJECTS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(knownObject(state, loc(12, 10))).toEqual({ seen: false, money: false });
    expect(msgs).toContain("You sense the presence of objects!");

    registry().effectSimple(EF.DETECT_OBJECTS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(knownObject(state, loc(12, 10))).toEqual({
      seen: true,
      kidx: potion.kind.kidx,
    });
    expect(msgs).toContain("You detect the presence of objects!");
  });

  it("gold detection ignores non-money and vice versa", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    floorCarry(state, loc(12, 10), makeObj(TV.POTION));
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_GOLD, env(state, msgs), {
      origin: sourcePlayer(),
      y: 5,
      x: 5,
    });
    expect(msgs).toContain("You detect no gold.");
    expect(knownObject(state, loc(12, 10))).toBeNull();
  });
});

describe("monster detection (detect_monsters L1768)", () => {
  it("DETECT_EVIL marks evil monsters in range for display", () => {
    const state = makeState({ playerGrid: loc(10, 10), w: 60 });
    const evil = addMon(state, makeRace({ flags: [RF.EVIL] }), loc(15, 10));
    const good = addMon(state, makeRace(), loc(14, 10));
    const far = addMon(state, makeRace({ flags: [RF.EVIL] }), loc(50, 10));
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_EVIL, env(state, msgs), {
      origin: sourcePlayer(),
      y: 10,
      x: 10,
    });
    expect(evil.mflag.has(MFLAG.MARK)).toBe(true);
    expect(evil.mflag.has(MFLAG.SHOW)).toBe(true);
    expect(good.mflag.has(MFLAG.MARK)).toBe(false);
    expect(far.mflag.has(MFLAG.MARK)).toBe(false);
    expect(msgs).toContain("You sense the presence of evil creatures!");
  });

  it("DETECT_INVISIBLE_MONSTERS finds only the unseen", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ghost = addMon(state, makeRace({ flags: [RF.INVISIBLE] }), loc(13, 10));
    const orc = addMon(state, makeRace(), loc(12, 10));
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_INVISIBLE_MONSTERS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 10,
      x: 10,
    });
    expect(ghost.mflag.has(MFLAG.MARK)).toBe(true);
    expect(orc.mflag.has(MFLAG.MARK)).toBe(false);
    expect(msgs).toContain("You sense the presence of invisible creatures!");
  });

  it("reports the empty result when aware", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    registry().effectSimple(EF.DETECT_VISIBLE_MONSTERS, env(state, msgs), {
      origin: sourcePlayer(),
      y: 10,
      x: 10,
    });
    expect(msgs).toContain("You sense no monsters.");
  });
});
