import { describe, expect, it } from "vitest";
import {
  EXTRACT_ENERGY,
  NORMAL_ENERGY,
  NORMAL_SPEED,
  canAct,
  gainEnergy,
  spendEnergy,
  turnEnergy,
} from "./energy";

/** Count how many actions an actor of `speed` takes over `turns` game turns. */
function countActions(speed: number, turns: number, moveEnergy = NORMAL_ENERGY): number {
  let energy = 0;
  let actions = 0;
  for (let t = 0; t < turns; t++) {
    energy = gainEnergy(energy, speed, moveEnergy);
    while (canAct(energy, moveEnergy)) {
      actions++;
      energy = spendEnergy(energy, moveEnergy);
    }
  }
  return actions;
}

describe("energy arithmetic", () => {
  it("matches upstream extract_energy: normal speed gains 10, +10 gains 20", () => {
    expect(EXTRACT_ENERGY[NORMAL_SPEED]).toBe(10);
    expect(turnEnergy(NORMAL_SPEED)).toBe(10);
    expect(turnEnergy(NORMAL_SPEED + 10)).toBe(20);
    expect(NORMAL_ENERGY).toBe(100);
  });

  it("takes ten game turns for one normal-speed action", () => {
    expect(countActions(NORMAL_SPEED, 10)).toBe(1);
    expect(countActions(NORMAL_SPEED, 100)).toBe(10);
  });

  it("a +10 speed actor acts about twice as often as a normal one", () => {
    const normal = countActions(NORMAL_SPEED, 1000);
    const fast = countActions(NORMAL_SPEED + 10, 1000);
    expect(normal).toBe(100);
    expect(fast).toBe(200);
    expect(fast).toBe(normal * 2);
  });

  it("canAct triggers exactly at move_energy", () => {
    expect(canAct(99)).toBe(false);
    expect(canAct(100)).toBe(true);
    expect(canAct(101)).toBe(true);
  });

  it("respects a non-default move_energy (turn_energy scales with it)", () => {
    expect(turnEnergy(NORMAL_SPEED, 50)).toBe(5);
    /* Both threshold and gain scale by move_energy, so the cadence is
     * unchanged: still one normal-speed action per ten game turns. */
    expect(countActions(NORMAL_SPEED, 10, 50)).toBe(1);
    expect(countActions(NORMAL_SPEED, 20, 50)).toBe(2);
  });
});
