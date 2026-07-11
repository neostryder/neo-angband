import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASIC_COLORS,
  VISUALS_INVALID_COLOR,
  VISUALS_MAX_COLORS,
  VisualsColorCycle,
  VisualsFlicker,
  buildVisualsCycler,
  buildVisualsFlicker,
  createVisualsAnimator,
  animateMonsterAttr,
} from "./engine";
import type { VisualsRecord } from "./engine";
import {
  COLOUR_DARK,
  COLOUR_L_DARK,
  COLOUR_L_RED,
  COLOUR_RED,
  COLOUR_MAGENTA,
} from "../color";

const visuals = JSON.parse(
  readFileSync(new URL("../../../content/pack/visuals.json", import.meta.url), "utf8"),
) as { records: VisualsRecord[] };
const record = visuals.records[0]!;

describe("VisualsColorCycle", () => {
  it("attrForFrame indexes by frame % maxSteps", () => {
    const cycle = VisualsColorCycle.create("t", 3, VISUALS_INVALID_COLOR)!;
    cycle.setStep(0, 4);
    cycle.setStep(1, 8);
    cycle.setStep(2, 12);
    expect(cycle.attrForFrame(0)).toBe(4);
    expect(cycle.attrForFrame(1)).toBe(8);
    expect(cycle.attrForFrame(2)).toBe(12);
    // wraps
    expect(cycle.attrForFrame(3)).toBe(4);
    expect(cycle.attrForFrame(7)).toBe(8);
  });

  it("create returns null for a zero-step cycle", () => {
    expect(VisualsColorCycle.create("empty", 0, VISUALS_INVALID_COLOR)).toBeNull();
  });

  it("copy compresses out invalid colors and wraps over the real count", () => {
    const cycle = VisualsColorCycle.create("gap", 5, VISUALS_INVALID_COLOR)!;
    cycle.setStep(0, 4);
    // step 1 left invalid
    cycle.setStep(2, 7);
    // steps 3, 4 left invalid
    const copy = cycle.copy()!;
    expect(copy.maxSteps).toBe(2);
    expect(copy.steps).toEqual([4, 7]);
    expect(copy.attrForFrame(0)).toBe(4);
    expect(copy.attrForFrame(1)).toBe(7);
    expect(copy.attrForFrame(2)).toBe(4); // wraps over 2, not 5
  });

  it("copy of an all-invalid cycle is null", () => {
    const cycle = VisualsColorCycle.create("blank", 3, VISUALS_INVALID_COLOR)!;
    expect(cycle.copy()).toBeNull();
  });
});

describe("VisualsFlicker", () => {
  it("create requires at least BASIC_COLORS cycles and a nonzero width", () => {
    expect(VisualsFlicker.create(10, 3)).toBeNull();
    expect(VisualsFlicker.create(VISUALS_MAX_COLORS, 0)).toBeNull();
    expect(VisualsFlicker.create(BASIC_COLORS, 3)).not.toBeNull();
  });

  it("getAttrForFrame indexes [selection][frame % colorsPerCycle]", () => {
    const table = VisualsFlicker.create(VISUALS_MAX_COLORS, 3)!;
    table.setColor(4, 0, 10);
    table.setColor(4, 1, 11);
    table.setColor(4, 2, 12);
    expect(table.getAttrForFrame(4, 0)).toBe(10);
    expect(table.getAttrForFrame(4, 1)).toBe(11);
    expect(table.getAttrForFrame(4, 2)).toBe(12);
    expect(table.getAttrForFrame(4, 3)).toBe(10); // wraps
  });

  it("returns BASIC_COLORS for an out-of-range selection attr", () => {
    const table = VisualsFlicker.create(VISUALS_MAX_COLORS, 3)!;
    expect(table.getAttrForFrame(VISUALS_MAX_COLORS, 0)).toBe(BASIC_COLORS);
    expect(table.getAttrForFrame(100, 0)).toBe(BASIC_COLORS);
  });
});

describe("buildVisualsFlicker", () => {
  const flicker = buildVisualsFlicker(record.flicker ?? []);

  it("indexes the flicker table by the selection color's attr", () => {
    // flicker:d -> d, D, R  (COLOUR_DARK selects the d/D/R cycle)
    expect(flicker.getAttrForFrame(COLOUR_DARK, 0)).toBe(COLOUR_DARK);
    expect(flicker.getAttrForFrame(COLOUR_DARK, 1)).toBe(COLOUR_L_DARK);
    expect(flicker.getAttrForFrame(COLOUR_DARK, 2)).toBe(COLOUR_L_RED);
    expect(flicker.getAttrForFrame(COLOUR_DARK, 3)).toBe(COLOUR_DARK); // wraps
  });

  it("the last duplicate selection attr wins", () => {
    const built = buildVisualsFlicker([
      { color: "d", "flicker-color": ["w", "w", "w"] },
      { color: "d", "flicker-color": ["r", "g", "b"] },
    ]);
    expect(built.getAttrForFrame(COLOUR_DARK, 0)).toBe(COLOUR_RED);
    expect(built.getAttrForFrame(COLOUR_DARK, 1)).toBe(5); // green
  });
});

describe("buildVisualsCycler", () => {
  const cycler = buildVisualsCycler(record.cycle ?? []);

  it("parses the two shipped groups (flicker + fancy)", () => {
    expect(cycler.groupCount).toBe(2);
  });

  it("reproduces the flicker-group cycles", () => {
    // cycle:flicker:d -> d, D, R
    expect(cycler.getAttrForFrame("flicker", "d", 0)).toBe(COLOUR_DARK);
    expect(cycler.getAttrForFrame("flicker", "d", 1)).toBe(COLOUR_L_DARK);
    expect(cycler.getAttrForFrame("flicker", "d", 2)).toBe(COLOUR_L_RED);
    expect(cycler.getAttrForFrame("flicker", "d", 3)).toBe(COLOUR_DARK);
  });

  it("reproduces the fancy rainbow cycle (14 colors, wrapping)", () => {
    const rainbow = [4, 12, 3, 25, 11, 13, 20, 22, 18, 27, 6, 17, 16, 21];
    for (let f = 0; f < 30; f++) {
      expect(cycler.getAttrForFrame("fancy", "rainbow", f)).toBe(
        rainbow[f % rainbow.length],
      );
    }
  });

  it("returns BASIC_COLORS for an unknown group or cycle", () => {
    expect(cycler.getAttrForFrame("nope", "rainbow", 0)).toBe(BASIC_COLORS);
    expect(cycler.getAttrForFrame("fancy", "nope", 0)).toBe(BASIC_COLORS);
    expect(cycler.getAttrForFrame("", "", 0)).toBe(BASIC_COLORS);
  });

  it("a later group+name definition replaces an earlier one", () => {
    const built = buildVisualsCycler([
      { group: "g", name: "c", "cycle-color": ["r", "r"] },
      { group: "g", name: "c", "cycle-color": ["b", "b"] },
    ]);
    expect(built.getAttrForFrame("g", "c", 0)).toBe(6); // blue, not red
  });
});

describe("VisualsAnimator race cycles", () => {
  const animator = createVisualsAnimator(record);

  it("set/get a cycle for a race by ridx", () => {
    animator.setCycleForRace(5, "fancy", "rainbow");
    expect(animator.getAttrForRace(5, 0)).toBe(4);
    expect(animator.getAttrForRace(5, 1)).toBe(12);
  });

  it("returns BASIC_COLORS for a race with no cycle", () => {
    expect(animator.getAttrForRace(999, 0)).toBe(BASIC_COLORS);
  });

  it("ignores a set with an unknown group/cycle", () => {
    animator.setCycleForRace(7, "fancy", "does-not-exist");
    expect(animator.getAttrForRace(7, 0)).toBe(BASIC_COLORS);
  });
});

describe("animateMonsterAttr (do_animation)", () => {
  const animator = createVisualsAnimator(record);
  animator.setCycleForRace(3, "fancy", "rainbow");

  it("returns null for a non-animated monster", () => {
    const attr = animateMonsterAttr(animator, {
      ridx: 1,
      baseAttr: COLOUR_RED,
      attrMulti: false,
      attrFlicker: false,
      frame: 0,
      randint1: () => 1,
    });
    expect(attr).toBeNull();
  });

  it("RF_ATTR_MULTI rolls randint1(BASIC_COLORS - 1)", () => {
    const attr = animateMonsterAttr(animator, {
      ridx: 1,
      baseAttr: COLOUR_RED,
      attrMulti: true,
      attrFlicker: false,
      frame: 0,
      randint1: (n) => n, // return the max so we can assert it
    });
    expect(attr).toBe(BASIC_COLORS - 1);
  });

  it("RF_ATTR_FLICKER prefers the race color cycle", () => {
    const attr = animateMonsterAttr(animator, {
      ridx: 3,
      baseAttr: COLOUR_RED,
      attrMulti: false,
      attrFlicker: true,
      frame: 1,
      randint1: () => 1,
    });
    expect(attr).toBe(12); // rainbow[1]
  });

  it("RF_ATTR_FLICKER falls back to the flicker table for the base attr", () => {
    // ridx with no race cycle; base attr d selects the d/D/R flicker cycle.
    const attr = animateMonsterAttr(animator, {
      ridx: 50,
      baseAttr: COLOUR_DARK,
      attrMulti: false,
      attrFlicker: true,
      frame: 1,
      randint1: () => 1,
    });
    expect(attr).toBe(COLOUR_L_DARK);
  });

  it("RF_ATTR_FLICKER falls back to the static base attr when cycling misses", () => {
    // A base attr past the flicker table (>= VISUALS_MAX_COLORS) misses both
    // the race cycle and the flicker table, so the static attr is used.
    const attr = animateMonsterAttr(animator, {
      ridx: 50,
      baseAttr: 40,
      attrMulti: false,
      attrFlicker: true,
      frame: 0,
      randint1: () => 1,
    });
    expect(attr).toBe(40);
  });

  it("does not use MAGENTA by accident (sanity on distinct attrs)", () => {
    expect(COLOUR_MAGENTA).not.toBe(COLOUR_RED);
  });
});
