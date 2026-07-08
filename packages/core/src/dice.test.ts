/**
 * Ports of the upstream unit tests in reference/src/tests/z-dice/dice.c
 * (suite z-dice), plus extra checks pinning parser quirks. Replicating the
 * upstream suite is the parity evidence for dice.ts.
 */

import { describe, expect, it } from "vitest";
import { Dice } from "./dice";
import { Expression } from "./expression";
import { Rng } from "./rng";
import type { RandomValue } from "./rng";

describe("z-dice upstream suite", () => {
  it("alloc", () => {
    expect(new Dice()).not.toBeNull();
  });

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

    const rolled = dice.roll(rng, v);
    expect(v.base).toBe(8);
    expect(v.dice).toBe(2);
    expect(v.sides).toBe(3);
    expect(v.mBonus).toBe(0);
    /* base 8 plus 2d3. */
    expect(rolled).toBeGreaterThanOrEqual(10);
    expect(rolled).toBeLessThanOrEqual(14);
  });
});

describe("parser quirks pinned beyond the upstream suite", () => {
  it("silently ignores unrecognized characters, as upstream", () => {
    const dice = new Dice();
    expect(dice.parseString("1z+2d3")).toBe(true);
    expect(dice.testValues(1, 2, 3, 0)).toBe(true);
  });

  it("parses leading-zero numbers as octal (C strtol base 0)", () => {
    const dice = new Dice();
    expect(dice.parseString("010+d4")).toBe(true);
    expect(dice.testValues(8, 1, 4, 0)).toBe(true);
  });

  it("truncates tokens to 16 characters", () => {
    const dice = new Dice();
    expect(dice.parseString("$ THIS IS A REALLY BIG TOKEN AND WILL BE CLIPPED"))
      .toBe(true);
    expect(dice.testVariables("THISISAREALLYBIG", null, null, null)).toBe(
      true,
    );
  });

  it("evaluates an unbound variable component as zero", () => {
    const rng = new Rng(1);
    const dice = new Dice();
    expect(dice.parseString("$A+2d3")).toBe(true);
    const v: RandomValue = { base: -1, dice: -1, sides: -1, mBonus: -1 };
    dice.evaluate(rng, 1, "maximise", v);
    expect(v.base).toBe(0);
    expect(v.dice).toBe(2);
    expect(v.sides).toBe(3);
  });

  it("binds variables case-insensitively (my_stricmp)", () => {
    const dice = new Dice();
    const expression = new Expression();
    expression.setBaseValue(() => 5);
    expect(dice.parseString("$Ad6")).toBe(true);
    expect(dice.bindExpression("a", expression)).toBe(0);
    const v = dice.randomValue();
    expect(v.dice).toBe(5);
    expect(v.sides).toBe(6);
  });

  it("reuses a variable slot for a repeated name", () => {
    const dice = new Dice();
    const expression = new Expression();
    expression.setBaseValue(() => 7);
    expect(dice.parseString("$Ad$A")).toBe(true);
    expect(dice.bindExpression("A", expression)).toBe(0);
    const v = dice.randomValue();
    expect(v.dice).toBe(7);
    expect(v.sides).toBe(7);
  });

  it("resets state when an object is reused", () => {
    const dice = new Dice();
    expect(dice.parseString("$A+2d3M4")).toBe(true);
    expect(dice.parseString("5")).toBe(true);
    expect(dice.testValues(5, 0, 0, 0)).toBe(true);
    const v = dice.randomValue();
    expect(v).toEqual({ base: 5, dice: 0, sides: 0, mBonus: 0 });
  });

  it("dice_roll ignores m_bonus, dice_evaluate includes it", () => {
    const rng = new Rng(7);
    const dice = new Dice();
    expect(dice.parseString("2d1M10")).toBe(true);
    /* maximise: 0 + 2*1 + full m_bonus of 10. */
    expect(dice.evaluate(rng, 0, "maximise")).toBe(12);
    /* roll: base + XdY only; 2d1 is always 2. */
    expect(dice.roll(rng)).toBe(2);
  });
});
