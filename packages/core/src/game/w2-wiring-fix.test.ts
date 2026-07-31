/**
 * Live-path tests for W2-FIX (phase3-2026-07-25): each assertion drives the
 * real command/registry or take_hit path, never the helper in isolation.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PF, TF, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson, ObjectKind } from "../obj/types.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { FlavorKnowledge } from "../obj/knowledge.js";
import { FlagSet } from "../bitflag.js";
import { OptionState } from "../player/options.js";
import { PF_SIZE } from "../player/types.js";
import { createDefaultRegistry } from "./player-turn.js";
import { installRangedCommands } from "./ranged-cmd.js";
import { installRunning } from "./player-path.js";
import { installCaveCommands } from "./cave-cmd.js";
import { installPickup } from "./pickup.js";
import { gearAdd, invenCarry } from "./gear.js";
import { floorCarry } from "./floor.js";
import { makeTakeHitHooks } from "./take-hit-hooks.js";
import { worldTakeHit } from "./world.js";
import { initTargetLoopUi, stepTargetLoop } from "./target-loop.js";
import { bindConstants } from "../constants.js";
import type { ConstantsJson } from "../constants.js";
import type { GameState } from "./context.js";
import type { PlayerState } from "../player/calcs.js";
import { addMon, makeRace, makeState, FLOOR, GRANITE, featureReg } from "./harness.js";
import { squareMemorize } from "./known.js";
import { featIsTorch } from "../world/chunk.js";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson);

const constants = bindConstants(load("constants") as ConstantsJson);

function withPflag(state: GameState, flag: number): void {
  const pflags = new FlagSet(PF_SIZE);
  pflags.on(flag);
  state.playerState = { pflags } as PlayerState;
}

function kindOfTval(tval: number): ObjectKind {
  const k = objReg.kinds.find(
    (kk): kk is ObjectKind => kk !== null && kk.tval === tval,
  );
  if (!k) throw new Error(`no kind for tval ${tval}`);
  return k;
}

function bareObject(tval: number): GameObject {
  const kind = kindOfTval(tval);
  const o = objectNew(kind);
  o.tval = kind.tval;
  o.sval = kind.sval;
  o.dd = kind.dd;
  o.ds = kind.ds;
  o.weight = kind.weight;
  o.number = 1;
  return o;
}

function armArcher(state: GameState): number {
  const p = state.actor.player;
  const bow = bareObject(TV.BOW);
  bow.toH = 5;
  bow.toD = 3;
  const bowHandle = gearAdd(state.gear, bow);
  const bowSlot = p.body.slots.findIndex((s) => s.type === "BOW");
  p.equipment[bowSlot] = bowHandle;

  const arrows = bareObject(TV.ARROW);
  arrows.toH = 4;
  arrows.toD = 2;
  arrows.number = 10;
  const handle = gearAdd(state.gear, arrows);

  state.actor.combat.ammoTval = TV.ARROW;
  state.actor.combat.numShots = 20;
  state.actor.combat.ammoMult = 2;
  return handle;
}

describe("W2-001/002/010/011 ranged learn-on-hit via fire/throw commands", () => {
  it("fire learns combat runes on ammo and launcher (live fire command)", () => {
    const state = makeState({ playerGrid: loc(5, 10) });
    const ammo = armArcher(state);
    state.actor.player.objKnown.toH = 0;
    state.actor.player.objKnown.toD = 0;
    addMon(state, makeRace({ ac: 0 }), loc(8, 10), { hp: 5000 });
    state.rng.randFix(100);

    const reg = createDefaultRegistry();
    installRangedCommands(reg);
    reg.get("fire")!(state, { code: "fire", args: { handle: ammo, dir: 6 } });

    expect(state.actor.player.objKnown.toH).toBe(1);
    expect(state.actor.player.objKnown.toD).toBe(1);
  });

  it("throw learns combat runes through the throw command", () => {
    const state = makeState({ playerGrid: loc(5, 10) });
    const flask = bareObject(TV.FLASK);
    flask.toH = 3;
    flask.toD = 2;
    flask.weight = 10;
    const handle = gearAdd(state.gear, flask);
    state.actor.player.objKnown.toH = 0;
    state.actor.player.objKnown.toD = 0;
    state.statInd = [16, 0, 0, 0, 0, 0];
    state.actor.combat.toH = 100;
    addMon(state, makeRace({ ac: 0 }), loc(8, 10), { hp: 5000 });
    state.rng.randFix(100);

    const reg = createDefaultRegistry();
    installRangedCommands(reg);
    reg.get("throw")!(state, { code: "throw", args: { handle, dir: 6 } });

    expect(state.actor.player.objKnown.toH).toBe(1);
    expect(state.actor.player.objKnown.toD).toBe(1);
  });
});

describe("W2-009 wizCheatDeath via take_hit live hooks", () => {
  it("cheat_live + lethal world hit prompts, then resumes the cheat path", () => {
    const state = makeState();
    state.options = new OptionState({ overrides: { cheat_live: true } });
    const p = state.actor.player;
    p.chp = 5;
    p.mhp = 50;
    p.msp = 10;
    p.csp = 3;
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    state.world!.takeHitHooks = makeTakeHitHooks(state);

    worldTakeHit(state, 100, "a test");

    expect(state.isDead).toBe(false);
    expect(state.pendingDeath?.killer).toBe("a test");
    expect(p.diedFrom).toBe("a test");
    state.pendingDeath!.resolve(false);
    expect(p.chp).toBe(p.mhp);
    expect(msgs.some((m) => m.includes("cheat death"))).toBe(true);
    expect(state.generateLevel).toBe(true);
    expect(state.targetDepth).toBe(0);
  });

  it("the same live seam can accept final death", () => {
    const state = makeState();
    state.options = new OptionState({ overrides: { cheat_live: true } });
    const p = state.actor.player;
    p.chp = 5;
    p.mhp = 50;
    p.totalWinner = true;
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    state.world!.takeHitHooks = makeTakeHitHooks(state);

    worldTakeHit(state, 100, "a dragon");
    expect(state.pendingDeath).toBeDefined();
    state.pendingDeath!.resolve(true);

    expect(state.isDead).toBe(true);
    expect(p.diedFrom).toBe("a dragon");
    expect(p.totalWinner).toBe(false);
    expect(msgs).toContain("You die.");
  });
});

describe("W2-012/013 mushroom and zapper ID on pickup command", () => {
  it("KNOW_MUSHROOM IDs a mushroom through the pickup command", () => {
    const state = makeState();
    state.flavorKnown = new FlavorKnowledge(objReg.ordinaryKindCount);
    const mushroom = bareObject(TV.MUSHROOM);
    expect(state.flavorKnown.isAware(mushroom.kind)).toBe(false);

    withPflag(state, PF.KNOW_MUSHROOM);

    floorCarry(state, state.actor.grid, mushroom);
    const msgs: string[] = [];
    const reg = createDefaultRegistry();
    installPickup(state, reg, {
      constants,
      env: { onPickup: (m) => msgs.push(m) },
    });
    reg.get("pickup")!(state, { code: "pickup" });

    expect(state.flavorKnown.isAware(mushroom.kind)).toBe(true);
    expect(msgs.some((m) => m === "Mushrooms for breakfast!")).toBe(true);
  });

  it("KNOW_ZAPPER IDs a wand through the pickup command", () => {
    const state = makeState();
    state.flavorKnown = new FlavorKnowledge(objReg.ordinaryKindCount);
    const wand = bareObject(TV.WAND);
    expect(state.flavorKnown.isAware(wand.kind)).toBe(false);

    withPflag(state, PF.KNOW_ZAPPER);

    floorCarry(state, state.actor.grid, wand);
    const reg = createDefaultRegistry();
    installPickup(state, reg, { constants });
    reg.get("pickup")!(state, { code: "pickup" });

    expect(state.flavorKnown.isAware(wand.kind)).toBe(true);
  });

  it("does not identify a mushroom while the live pickup combines a stack", () => {
    const state = makeState();
    state.flavorKnown = new FlavorKnowledge(objReg.ordinaryKindCount);
    const inPack = bareObject(TV.MUSHROOM);
    invenCarry(state.gear, inPack, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    const floorMushroom = bareObject(TV.MUSHROOM);
    withPflag(state, PF.KNOW_MUSHROOM);
    floorCarry(state, state.actor.grid, floorMushroom);

    const reg = createDefaultRegistry();
    installPickup(state, reg, { constants });
    reg.get("pickup")!(state, { code: "pickup" });

    expect(state.flavorKnown.isAware(inPack.kind)).toBe(false);
  });

  it("does not identify a wand while the live pickup combines a stack", () => {
    const state = makeState();
    state.flavorKnown = new FlavorKnowledge(objReg.ordinaryKindCount);
    const inPack = bareObject(TV.WAND);
    invenCarry(state.gear, inPack, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    const floorWand = bareObject(TV.WAND);
    withPflag(state, PF.KNOW_ZAPPER);
    floorCarry(state, state.actor.grid, floorWand);

    const reg = createDefaultRegistry();
    installPickup(state, reg, { constants });
    reg.get("pickup")!(state, { code: "pickup" });

    expect(state.flavorKnown.isAware(inPack.kind)).toBe(false);
  });
});

describe("W2-003 pathNearestKnown via navigate-down / descend+autoexplore", () => {
  function corridorWithDownstairs(state: GameState): void {
    for (let x = 0; x < state.chunk.width; x++) {
      for (let y = 0; y < state.chunk.height; y++) {
        state.chunk.setFeat(loc(x, y), GRANITE);
      }
    }
    for (let x = 1; x <= 10; x++) state.chunk.setFeat(loc(x, 5), FLOOR);
    state.chunk.setFeat(loc(10, 5), featureReg.byCodeName("MORE").fidx);
    for (let x = 0; x < state.chunk.width; x++) {
      for (let y = 0; y < state.chunk.height; y++) {
        squareMemorize(state, loc(x, y));
      }
    }
  }

  it("navigate-down walks toward a remembered downstairs", () => {
    const state = makeState({ playerGrid: loc(2, 5), w: 20, h: 12 });
    corridorWithDownstairs(state);

    const reg = createDefaultRegistry();
    installCaveCommands(reg);
    installRunning(reg);

    const used = reg.get("navigate-down")!(state, { code: "navigate-down" });
    expect(used).toBeGreaterThan(0);
    expect(state.actor.grid.x).toBeGreaterThan(2);
  });

  it("descend with autoexplore_commands reaches navigate-down", () => {
    const state = makeState({ playerGrid: loc(2, 5), w: 20, h: 12 });
    state.options = new OptionState({
      overrides: { autoexplore_commands: true },
    });
    corridorWithDownstairs(state);

    const reg = createDefaultRegistry();
    installCaveCommands(reg);
    installRunning(reg);

    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const used = reg.get("descend")!(state, { code: "descend" });
    expect(used).toBeGreaterThan(0);
    expect(msgs).not.toContain("I see no down staircase here.");
  });

  it("target-panel '>' moves the cursor to the nearest known downstairs", () => {
    const state = makeState({ playerGrid: loc(2, 5), w: 20, h: 12 });
    corridorWithDownstairs(state);
    const ui = initTargetLoopUi(state, 2, 5);
    const before = state.rng.getState();
    const step = stepTargetLoop(state, [], ui, ">");

    expect(step.bell).toBe(false);
    expect(step.ui).toMatchObject({ x: 10, y: 5 });
    expect(state.actor.grid).toEqual(loc(2, 5));
    expect(state.rng.getState()).toEqual(before);
  });

  it("target-panel stair search starts at the cursor, not the player", () => {
    const state = makeState({ playerGrid: loc(2, 5), w: 20, h: 12 });
    corridorWithDownstairs(state);
    for (let x = 11; x <= 16; x++) state.chunk.setFeat(loc(x, 5), FLOOR);
    state.chunk.setFeat(loc(16, 5), featureReg.byCodeName("MORE").fidx);
    for (let x = 11; x <= 16; x++) squareMemorize(state, loc(x, 5));

    const before = state.rng.getState();
    const step = stepTargetLoop(state, [], initTargetLoopUi(state, 14, 5), ">");

    /* ui-target.c:1509 searches from loc(x, y), the target cursor. */
    expect(step).toMatchObject({ bell: false, ui: { x: 16, y: 5 } });
    expect(state.actor.grid).toEqual(loc(2, 5));
    expect(state.rng.getState()).toEqual(before);
  });
});

describe("W2-016 featIsTorch is the live torch classifier", () => {
  it("classifies FLOOR the same way as TF.TORCH on the feature registry", () => {
    const floor = featureReg.byCodeName("FLOOR").fidx;
    expect(featIsTorch(featureReg, floor)).toBe(featureReg.featHas(floor, TF.TORCH));
  });
});
