import { describe, expect, it } from "vitest";
import { TMD } from "../generated";
import { loc } from "../loc";
import { createDefaultRegistry } from "./player-turn";
import {
  LOOP_STATUS,
  decreaseTimeouts,
  processWorld,
  runGameLoop,
} from "./loop";
import { makeState } from "./harness";

describe("runGameLoop", () => {
  it("a normal-speed walk advances the game turn by 10 and returns for input", () => {
    const state = makeState({
      playerGrid: loc(15, 10),
      speed: 110,
      commands: [{ code: "walk", dir: 6 }],
    });
    state.actor.energy = state.z.moveEnergy; /* ready to act */

    const status = runGameLoop(state, createDefaultRegistry());

    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.actor.grid).toEqual(loc(16, 10));
    /* One normal action == move_energy / turn_energy(110) == 10 game turns. */
    expect(state.turn).toBe(10);
    expect(state.actor.energy).toBe(state.z.moveEnergy);
  });

  it("returns for input immediately when no command is queued", () => {
    const state = makeState({ commands: [] });
    state.actor.energy = state.z.moveEnergy;
    const status = runGameLoop(state, createDefaultRegistry());
    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.turn).toBe(0);
  });

  it("signals a level change when the player descends", () => {
    const state = makeState({ commands: [{ code: "descend" }] });
    state.actor.energy = state.z.moveEnergy;
    const status = runGameLoop(state, createDefaultRegistry());
    expect(status).toBe(LOOP_STATUS.LEVEL_CHANGE);
    expect(state.generateLevel).toBe(true);
  });
});

describe("process_world upkeep", () => {
  it("regenerates HP with the exact fixed-point formula when hurt and fed", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 500;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 5000; /* Full: PY_REGEN_NORMAL with fed bonus */

    processWorld(state);

    /* percent = 197 * (100 + floor(50/3)) / 100 = 228; gain = 1000*228 + 1442. */
    expect(p.chp).toBe(503);
    expect(p.chpFrac).toBe(32834);
  });

  it("does not regenerate HP at full health", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 1000;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 5000; /* fed, so no starvation damage confounds this */
    processWorld(state);
    expect(p.chp).toBe(1000);
    expect(p.chpFrac).toBe(0);
  });

  it("regenerates HP on the ten-turn cadence during the loop", () => {
    const state = makeState({
      playerGrid: loc(15, 10),
      commands: [{ code: "walk", dir: 6 }],
    });
    state.actor.energy = state.z.moveEnergy;
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 500;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 5000;

    runGameLoop(state, createDefaultRegistry());

    /* process_world ran once during the 10-turn advance (at turn 0). */
    expect(p.chp).toBeGreaterThan(500);
  });

  it("counts timed effects down (food is exempt)", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.AFRAID] = 5;
    p.timed[TMD.FOOD] = 5000;

    decreaseTimeouts(state);

    expect(p.timed[TMD.AFRAID]).toBe(4);
    expect(p.timed[TMD.FOOD]).toBe(5000);
  });
});
