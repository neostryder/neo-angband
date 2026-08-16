/**
 * Upstream unit tests from reference/src/tests/z-dice/dice.c
 * (suite z-dice/dice).
 *
 * Mapping: dice_new → `new Dice()`; dice_parse_string → parseString;
 * dice_test_values / dice_test_variables → testValues / testVariables;
 * dice_bind_expression → bindExpression; dice_evaluate / dice_roll take an
 * injected Rng (no global RNG state). GC replaces dice_free.
 */

import { describe, expect, it } from "vitest";
import { Dice } from "./dice.js";
import { Expression } from "./expression.js";
import { Rng } from "./rng.js";
import type { RandomValue } from "./rng.js";

describe("z-dice/dice upstream", () => {
  // C: test_alloc
  it("alloc", () => {
    expect(new Dice()).not.toBeNull();
  });

  // C: test_parse_success
  it("parse-success", () => {
    const dice = new Dice();

    /* Basic formatting. */
    expect(dice.parseString("1+2d3M4")).toBe(true);
    expect(dice.testValues(1, 2, 3, 4)).toBe(true);

    expect(dice.parseString("1+d3M4")).toBe(true);
    expect(dice.testValues(1, 1, 3, 4)).toBe(true);

    expect(dice.parseString("1+M4")).toBe(true);
    expect(dice.testValues(1, 0, 0, 4)).toBe(true);

    expect(dice.parseString("1+2d3")).toBe(true);
    expect(dice.testValues(1, 2, 3, 0)).toBe(true);

    expect(dice.parseString("1+d3")).toBe(true);
    expect(dice.testValues(1, 1, 3, 0)).toBe(true);

    expect(dice.parseString("2d3M4")).toBe(true);
    expect(dice.testValues(0, 2, 3, 4)).toBe(true);

    expect(dice.parseString("d3M4")).toBe(true);
    expect(dice.testValues(0, 1, 3, 4)).toBe(true);

    expect(dice.parseString("M4")).toBe(true);
    expect(dice.testValues(0, 0, 0, 4)).toBe(true);

    expect(dice.parseString("2d3")).toBe(true);
    expect(dice.testValues(0, 2, 3, 0)).toBe(true);

    expect(dice.parseString("d3")).toBe(true);
    expect(dice.testValues(0, 1, 3, 0)).toBe(true);

    expect(dice.parseString("1")).toBe(true);
    expect(dice.testValues(1, 0, 0, 0)).toBe(true);

    /* Multiple digits. */
    expect(dice.parseString("11+22d33M44")).toBe(true);
    expect(dice.testValues(11, 22, 33, 44)).toBe(true);

    /* Negative bases. */
    expect(dice.parseString("-1+d3")).toBe(true);
    expect(dice.testValues(-1, 1, 3, 0)).toBe(true);

    /* Basic formats with variables. */
    expect(dice.parseString("$A+$Bd$Cm$D")).toBe(true);
    expect(dice.testVariables("A", "B", "C", "D")).toBe(true);

    expect(dice.parseString("$A+d$Cm$D")).toBe(true);
    expect(dice.testVariables("A", null, "C", "D")).toBe(true);

    expect(dice.parseString("$A+m$D")).toBe(true);
    expect(dice.testVariables("A", null, null, "D")).toBe(true);

    expect(dice.parseString("$A+$Bd$C")).toBe(true);
    expect(dice.testVariables("A", "B", "C", null)).toBe(true);

    expect(dice.parseString("$A+d$C")).toBe(true);
    expect(dice.testVariables("A", null, "C", null)).toBe(true);

    expect(dice.parseString("$Bd$Cm$D")).toBe(true);
    expect(dice.testVariables(null, "B", "C", "D")).toBe(true);

    expect(dice.parseString("d$Cm$D")).toBe(true);
    expect(dice.testVariables(null, null, "C", "D")).toBe(true);

    expect(dice.parseString("m$D")).toBe(true);
    expect(dice.testVariables(null, null, null, "D")).toBe(true);

    expect(dice.parseString("$Bd$C")).toBe(true);
    expect(dice.testVariables(null, "B", "C", null)).toBe(true);

    expect(dice.parseString("d$C")).toBe(true);
    expect(dice.testVariables(null, null, "C", null)).toBe(true);

    expect(dice.parseString("$A")).toBe(true);
    expect(dice.testVariables("A", null, null, null)).toBe(true);

    /* Variable names. */
    expect(dice.parseString("$BASEd$SIDES")).toBe(true);
    expect(dice.testVariables(null, "BASE", "SIDES", null)).toBe(true);

    expect(dice.parseString("d$AMm4")).toBe(true);
    expect(dice.testVariables(null, null, "AM", null)).toBe(true);

    expect(dice.parseString("$MAGE+M1")).toBe(true);
    expect(dice.testVariables("MAGE", null, null, null)).toBe(true);

    /* Ignore spaces. */
    expect(dice.parseString(" 1 + 2 d 3 M 4 ")).toBe(true);
    expect(dice.parseString("1 1 +2d3M4")).toBe(true);
    expect(dice.parseString("$ BIG BASE +2d3M4")).toBe(true);

    /* Token truncation. */
    expect(
      dice.parseString("$ THIS IS A REALLY BIG TOKEN AND WILL BE CLIPPED"),
    ).toBe(true);

    /*
     * While this probably should be an error, it keeps things simpler to
     * just allow this. It might be useful for providing a placeholder,
     * since it has a value of zero.
     */
    expect(dice.parseString("-")).toBe(true);
  });

  // C: test_parse_failure
  it("parse-failure", () => {
    const dice = new Dice();

    /* Empty string. */
    expect(dice.parseString("")).toBe(false);

    /* Disallowed minus tokens. */
    expect(dice.parseString("1+-2d3M4")).toBe(false);
    expect(dice.parseString("1+2d-3M4")).toBe(false);
    expect(dice.parseString("1+2d3M-4")).toBe(false);
    expect(dice.parseString("-$A+d3")).toBe(false);

    /* Bad variable names. */
    expect(dice.parseString("$base+2d3")).toBe(false);
    expect(dice.parseString("$BASE$B+2d3")).toBe(false);
    expect(dice.parseString("$$BASE+2d3")).toBe(false);
    expect(dice.parseString("$1+2d3M4")).toBe(false);
    expect(dice.parseString("1$+2d3M4")).toBe(false);
    expect(dice.parseString("1+$2d3M4")).toBe(false);
    expect(dice.parseString("1+2$d3M4")).toBe(false);
    expect(dice.parseString("1+2d$3M4")).toBe(false);
    expect(dice.parseString("1+2d3$M4")).toBe(false);
    expect(dice.parseString("1+2d3M$4")).toBe(false);
    expect(dice.parseString("1+2d3M4$")).toBe(false);

    /* Early termination. */
    expect(dice.parseString("1+")).toBe(false);
    expect(dice.parseString("1+2")).toBe(false);
    expect(dice.parseString("1+d")).toBe(false);
    expect(dice.parseString("1+2d")).toBe(false);
    expect(dice.parseString("1+2d3M")).toBe(false);
    expect(dice.parseString("+2d3")).toBe(false);
  });

  // C: test_evaluate
  it("evaluate", () => {
    const rng = new Rng(42);
    const expression = new Expression();
    const dice = new Dice();
    const v: RandomValue = { base: 0, dice: 0, sides: 0, mBonus: 0 };

    expression.setBaseValue(() => 3);
    expect(expression.addOperationsString("* 3 - 1")).toBeGreaterThan(0);
    expect(dice.parseString("$A + 2d3")).toBe(true);
    expect(dice.bindExpression("A", expression)).toBeGreaterThanOrEqual(0);

    const value = dice.evaluate(rng, 1, "maximise", v);
    expect(value).toBe(14);
    expect(v.base).toBe(8);
    expect(v.dice).toBe(2);
    expect(v.sides).toBe(3);
    expect(v.mBonus).toBe(0);

    dice.roll(rng, v);
    expect(v.base).toBe(8);
    expect(v.dice).toBe(2);
    expect(v.sides).toBe(3);
    expect(v.mBonus).toBe(0);
  });
});
