import { describe, expect, it } from "vitest";
import { commandWheelDiameter } from "./gamepad-wheel-geometry";

const WEDGE_SHARE = 0.215;

describe("command wheel geometry", () => {
  it("uses the live desktop surface instead of the former 360px cap", () => {
    expect(commandWheelDiameter({ width: 1280, height: 820 }, false)).toBe(520);
  });

  it("changes with the canvas when the window resizes", () => {
    expect(commandWheelDiameter({ width: 1280, height: 820 }, false)).toBe(520);
    expect(commandWheelDiameter({ width: 700, height: 500 }, false)).toBe(360);
  });

  it("keeps a phone wedge above the 44px touch target", () => {
    const diameter = commandWheelDiameter({ width: 375, height: 812 }, true);
    expect(diameter).toBe(300);
    expect(diameter * WEDGE_SHARE).toBeGreaterThanOrEqual(44);
  });

  it("uses CSS surface pixels so density does not enlarge the overlay", () => {
    const surface = { width: 1280, height: 820 };
    expect(commandWheelDiameter(surface, false)).toBe(520);
  });
});
