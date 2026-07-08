import { describe, expect, it } from "vitest";
import { MFLAG } from "../generated";
import { loc } from "../loc";
import {
  givePlayerEnergy,
  processMonsters,
  resetMonsters,
} from "./scheduler";
import { addMon, makeRace, makeState } from "./harness";

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
