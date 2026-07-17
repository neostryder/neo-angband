import { describe, expect, it } from "vitest";
import { MFLAG, RF, SQUARE } from "../generated";
import { loc } from "../loc";
import type { MonsterDeathDeps } from "./mon-death";
import { installNonplayerHitDeps } from "./mon-death";
import { updateMonsterDistances } from "./context";
import {
  givePlayerEnergy,
  processMonsters,
  resetMonsters,
} from "./scheduler";
import { addMon, featureReg, makeRace, makeState } from "./harness";

describe("processMonsters energy bookkeeping", () => {
  it("energizes a ready monster and spends move_energy, marking it handled", () => {
    const state = makeState();
    const mon = addMon(state, makeRace(), loc(20, 10), { energy: 100 });

    processMonsters(state, 0);

    /* +turn_energy(110) = +10, then -move_energy(100). */
    expect(mon.energy).toBe(10);
    expect(mon.mflag.has(MFLAG.HANDLED)).toBe(true);
  });

  it("energizes but does not run a monster below move_energy", () => {
    const state = makeState();
    const mon = addMon(state, makeRace(), loc(20, 10), { energy: 50 });

    processMonsters(state, 0);

    /* Gains a turn of energy but does not act (no move_energy spent). */
    expect(mon.energy).toBe(60);
    expect(mon.grid).toEqual(loc(20, 10));
    expect(mon.mflag.has(MFLAG.HANDLED)).toBe(true);
  });

  it("does not touch a monster below minimum_energy", () => {
    const state = makeState();
    const slow = addMon(state, makeRace(), loc(20, 10), { energy: 100 });

    /* Only monsters with >= 120 energy act this pass. */
    processMonsters(state, 120);

    expect(slow.energy).toBe(100);
    expect(slow.mflag.has(MFLAG.HANDLED)).toBe(false);
  });

  it("does not reprocess a handled monster within one game turn", () => {
    const state = makeState();
    const mon = addMon(state, makeRace(), loc(20, 10), { energy: 100 });

    processMonsters(state, 0);
    const afterFirst = mon.energy;
    processMonsters(state, 0);
    expect(mon.energy).toBe(afterFirst);

    resetMonsters(state);
    expect(mon.mflag.has(MFLAG.HANDLED)).toBe(false);
    /* Re-enabled: gains another turn of energy (10 -> 20). */
    processMonsters(state, 0);
    expect(mon.energy).toBe(afterFirst + 10);
  });
});

describe("mimics lie in wait (mon-move.c L1947)", () => {
  it("a mimicking monster spends energy but never takes its turn", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 5 }), loc(17, 10), { energy: 100 });
    /* monster_is_mimicking: camouflaged with a mimicked object. */
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1;
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);

    let acted = false;
    state.monsterTurnHook = (): boolean => {
      acted = true;
      return true;
    };

    processMonsters(state, 0);

    /* Energy was spent (the continue is after the deduction)... */
    expect(mon.energy).toBe(10);
    expect(mon.mflag.has(MFLAG.HANDLED)).toBe(true);
    /* ...but the turn never ran. */
    expect(acted).toBe(false);
  });

  it("a revealed mimic (no CAMOUFLAGE) acts normally", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 5 }), loc(17, 10), { energy: 100 });
    mon.mimickedObj = 1; /* camouflage cleared: no longer mimicking. */
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);

    let acted = false;
    state.monsterTurnHook = (): boolean => {
      acted = true;
      return true;
    };

    processMonsters(state, 0);
    expect(acted).toBe(true);
  });
});

describe("terrain damage after the monster turn (mon-move.c L1972)", () => {
  const LAVA = featureReg.byCodeName("LAVA").fidx;

  /* monsterTakeTerrainDamage only touches the death deps on a kill; a
   * surviving monster never reads them, so inert stubs suffice here (the
   * full kill path is covered in mon-death.test.ts). */
  const stubDeps = {
    makeDeps: null,
    reg: null,
    floorEnv: {},
    lore: new Map(),
  } as unknown as MonsterDeathDeps;

  it("a monster standing on lava takes 100 + 1d100 fire damage after acting", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ level: 5 }), loc(17, 10), {
      energy: 100,
      hp: 400,
    });
    state.chunk.setFeat(mon.grid, LAVA);
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);
    updateMonsterDistances(state);
    state.monsterTurnHook = (): boolean => true; /* keep it on the lava */
    installNonplayerHitDeps(state, stubDeps);

    processMonsters(state, 0);

    const dam = 400 - mon.hp;
    expect(dam).toBeGreaterThanOrEqual(101);
    expect(dam).toBeLessThanOrEqual(200);
  });

  it("a fire-immune monster is unharmed, and no deps means no damage", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const immune = addMon(state, makeRace({ level: 5, flags: [RF.IM_FIRE] }), loc(17, 10), {
      energy: 100,
      hp: 400,
    });
    state.chunk.setFeat(immune.grid, LAVA);
    state.chunk.sqinfoOn(immune.grid, SQUARE.VIEW);
    updateMonsterDistances(state);
    state.monsterTurnHook = (): boolean => true;
    installNonplayerHitDeps(state, stubDeps);

    processMonsters(state, 0);
    expect(immune.hp).toBe(400);
  });
});

describe("givePlayerEnergy", () => {
  it("adds turn_energy for the player's speed", () => {
    const normal = makeState({ speed: 110 });
    givePlayerEnergy(normal);
    expect(normal.actor.energy).toBe(10);

    const fast = makeState({ speed: 120 });
    givePlayerEnergy(fast);
    expect(fast.actor.energy).toBe(20);
  });
});
