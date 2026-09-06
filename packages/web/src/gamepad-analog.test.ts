import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPEAT, IDLE_HOLD, applyDeadZone, directionVector, resolveDirection,
  resolveHatAxis, stepHold,
} from "./gamepad-analog";
import type { AngbandDirection } from "./input-door";

describe("dead zone", () => {
  it("measures the vector rather than each axis, so a diagonal is not lost", () => {
    // Both axes are below an 0.3 axial threshold; the vector is not.
    const diagonal = applyDeadZone(0.28, -0.28);
    expect(diagonal.magnitude).toBeGreaterThan(0);
    expect(resolveDirection(0.28, -0.28)).toBe(9);
    expect(applyDeadZone(0.2, -0.2).magnitude).toBe(0);
  });
  it("rescales what is left of the range so the first movement is not a jump", () => {
    expect(applyDeadZone(0.3, 0).magnitude).toBe(0);
    expect(applyDeadZone(0.6, 0).magnitude).toBeCloseTo(0.5, 5);
    expect(applyDeadZone(0.9, 0).magnitude).toBe(1);
    // Worn sticks never reach the corner, so the outer edge saturates early.
    expect(applyDeadZone(1, 0).magnitude).toBe(1);
  });
  it("keeps the angle it was given while rescaling the length", () => {
    const reading = applyDeadZone(0.5, -0.5);
    expect(reading.x).toBeCloseTo(-reading.y, 10);
    expect(Math.hypot(reading.x, reading.y)).toBeCloseTo(reading.magnitude, 10);
  });
  it("treats a broken sample as centred rather than as a direction", () => {
    expect(applyDeadZone(Number.NaN, 0).magnitude).toBe(0);
    expect(resolveDirection(Number.NaN, Number.NaN)).toBeUndefined();
  });
});

describe("eight-way resolution", () => {
  const cases: readonly [number, number, AngbandDirection][] = [
    [0, -1, 8], [1, -1, 9], [1, 0, 6], [1, 1, 3],
    [0, 1, 2], [-1, 1, 1], [-1, 0, 4], [-1, -1, 7],
  ];
  it.each(cases)("resolves (%s, %s) to keypad %s", (x, y, expected) => {
    expect(resolveDirection(x, y)).toBe(expected);
  });
  it("agrees with the direction vectors the port already uses", () => {
    for (const [, , direction] of cases) {
      const [x, y] = directionVector(direction);
      expect(resolveDirection(x, y)).toBe(direction);
    }
  });
  it("holds the direction already chosen across a boundary, but yields to a real turn", () => {
    // 25 degrees clockwise of north is past the halfway line to north-east.
    const x = Math.sin((25 * Math.PI) / 180);
    const y = -Math.cos((25 * Math.PI) / 180);
    expect(resolveDirection(x, y)).toBe(9);
    expect(resolveDirection(x, y, 8)).toBe(8);
    // A deliberate turn crosses the whole widened wedge in one motion.
    expect(resolveDirection(1, -1, 8)).toBe(9);
  });
  it("keeps a held direction below the threshold that would have started one", () => {
    expect(resolveDirection(0.2, 0)).toBeUndefined();
    expect(resolveDirection(0.2, 0, 6)).toBe(6);
    expect(resolveDirection(0.05, 0, 6)).toBeUndefined();
  });
});

describe("hat switch", () => {
  it("decodes the eight positions a non-standard pad encodes on one axis", () => {
    expect(resolveHatAxis(-1)).toBe(8);
    expect(resolveHatAxis(-0.42857)).toBe(6);
    expect(resolveHatAxis(0.14286)).toBe(2);
    expect(resolveHatAxis(0.71429)).toBe(4);
  });
  it("reads the centre sentinel and a browser defect as no direction", () => {
    expect(resolveHatAxis(1.28571)).toBeUndefined();
    expect(resolveHatAxis(1227133568)).toBeUndefined();
    expect(resolveHatAxis(Number.NaN)).toBeUndefined();
  });
});

describe("hold and repeat", () => {
  it("answers nothing until a new direction survives a second sample", () => {
    const first = stepHold(IDLE_HOLD, 6, 0);
    expect(first.emit).toBeUndefined();
    const second = stepHold(first.state, 6, 16);
    expect(second.emit).toBe(6);
  });
  it("drops a one-frame bounce past centre on release", () => {
    let state = stepHold(IDLE_HOLD, 6, 0).state;
    state = stepHold(state, 6, 16).state;
    // The stick springs back and reports the opposite for exactly one sample.
    const bounce = stepHold(state, 4, 32);
    expect(bounce.emit).toBeUndefined();
    expect(stepHold(bounce.state, undefined, 48).state).toEqual(IDLE_HOLD);
  });
  it("waits out the initial delay, then repeats at the interval", () => {
    let state = stepHold(IDLE_HOLD, 2, 0).state;
    state = stepHold(state, 2, 16).state; // First answer.
    const emitted: number[] = [];
    for (let now = 32; now <= 700; now += 16) {
      const step = stepHold(state, 2, now);
      state = step.state;
      if (step.emit !== undefined) emitted.push(now);
    }
    expect(emitted[0]).toBeGreaterThanOrEqual(DEFAULT_REPEAT.initialDelayMs);
    expect(emitted[0]).toBeLessThan(DEFAULT_REPEAT.initialDelayMs + 32);
    const gaps = emitted.slice(1).map((at, index) => at - emitted[index]!);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(DEFAULT_REPEAT.intervalMs);
  });
  it("starts the delay again for a direction the player changed to", () => {
    let state = stepHold(IDLE_HOLD, 2, 0).state;
    state = stepHold(state, 2, 16).state;
    state = stepHold(state, 6, 400).state;      // Pending only.
    const turned = stepHold(state, 6, 416);
    expect(turned.emit).toBe(6);
    expect(stepHold(turned.state, 6, 480).emit).toBeUndefined();
  });
});
