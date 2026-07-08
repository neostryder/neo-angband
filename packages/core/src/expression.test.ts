/**
 * Ports of the upstream unit tests in
 * reference/src/tests/z-expression/expression.c (suite z-expression), plus
 * extra checks pinning C-specific parser semantics. Replicating the
 * upstream suite is the parity evidence for expression.ts.
 */

import { describe, expect, it } from "vitest";
import {
  EXPRESSION_ERR_DIVIDE_BY_ZERO,
  EXPRESSION_ERR_EXPECTED_OPERAND,
  EXPRESSION_ERR_EXPECTED_OPERATOR,
  EXPRESSION_ERR_GENERIC,
  EXPRESSION_ERR_INVALID_OPERATOR,
  EXPRESSION_ERR_OPERAND_OUT_OF_BOUNDS,
  Expression,
  expressionTestCopy,
  strtolBase0,
} from "./expression";

describe("z-expression upstream suite", () => {
  it("alloc: copy is a value-equal deep copy", () => {
    const expr = new Expression();
    expr.addOperationsString("+ 1");
    const copy = expr.copy();
    expect(expressionTestCopy(expr, copy)).toBe(true);
  });

  it("parse-success", () => {
    const expr = new Expression();

    /* Basic operators. */
    expect(expr.addOperationsString("+ 1")).toBe(1);
    expect(expr.addOperationsString("- 1")).toBe(1);
    expect(expr.addOperationsString("* 1")).toBe(1);
    expect(expr.addOperationsString("/ 1")).toBe(1);

    /* Various negation situations. */
    expect(expr.addOperationsString("n")).toBe(1);
    expect(expr.addOperationsString("n n")).toBe(2);
    expect(expr.addOperationsString("n + 1")).toBe(2);
    expect(expr.addOperationsString("+ 1 n")).toBe(2);

    /* Multiple operands. */
    expect(expr.addOperationsString("+ 1 2 3")).toBe(3);

    /* Identity expression. */
    expect(expr.addOperationsString("")).toBe(0);

    /* Negative operands. */
    expect(expr.addOperationsString("+ -1")).toBe(1);
    expect(expr.addOperationsString("- -1")).toBe(1);
    expect(expr.addOperationsString("+ 1 -1")).toBe(2);
    expect(expr.addOperationsString("+ -1 1")).toBe(2);

    /* More complex examples. */
    expect(expr.addOperationsString("* 4 / 3 ")).toBe(2);
    expect(expr.addOperationsString("- 1 / 5 + 3")).toBe(3);
  });

  it("parse-failure", () => {
    const expr = new Expression();

    /* Basic problems (upstream also checks a NULL expression object). */
    expect(expr.addOperationsString(null)).toBe(EXPRESSION_ERR_GENERIC);

    /* Expressions must start with an operator. */
    expect(expr.addOperationsString("44 / 3")).toBe(
      EXPRESSION_ERR_EXPECTED_OPERATOR,
    );

    /* Can't have operators without operands. */
    expect(expr.addOperationsString("* + 4")).toBe(
      EXPRESSION_ERR_EXPECTED_OPERAND,
    );

    /* Invalid operator. */
    expect(expr.addOperationsString("+ 4 % 4")).toBe(
      EXPRESSION_ERR_INVALID_OPERATOR,
    );

    /* No operands after negation. */
    expect(expr.addOperationsString("n 4 + 1")).toBe(
      EXPRESSION_ERR_EXPECTED_OPERATOR,
    );

    /* Catch divide by zero. */
    expect(expr.addOperationsString("/ 0")).toBe(
      EXPRESSION_ERR_DIVIDE_BY_ZERO,
    );
    expect(expr.addOperationsString("/ 10 0")).toBe(
      EXPRESSION_ERR_DIVIDE_BY_ZERO,
    );

    /*
     * Too many operations (EXPRESSION_MAX_OPERATIONS). The upstream test
     * uses six adjacent C string literals, which concatenate into
     * "...9 0+ 1 2..." with no space at the seams; repeat() reproduces
     * that exact string.
     */
    expect(expr.addOperationsString("+ 1 2 3 4 5 6 7 8 9 0".repeat(6))).toBe(
      50,
    );
  });

  it("evaluate", () => {
    const expr = new Expression();

    /* Basic evaluation with base of zero. */
    expr.addOperationsString("+ 1 2 3");
    expect(expr.evaluate()).toBe(6);
    expr.addOperationsString("* 2");
    expect(expr.evaluate()).toBe(12);
    expr.addOperationsString("n");
    expect(expr.evaluate()).toBe(-12);
    expr.addOperationsString("- -3");
    expect(expr.evaluate()).toBe(-9);
    expr.addOperationsString("n / 3");
    expect(expr.evaluate()).toBe(3);

    /* Evaluate with base value function. */
    expr.setBaseValue(() => 9);
    expect(expr.evaluate()).toBe(9);
  });
});

describe("C semantics pinned beyond the upstream suite", () => {
  it("applies operations left to right with no precedence", () => {
    const expr = new Expression();
    expr.addOperationsString("+ 2 * 3");
    /* (0 + 2) * 3, not 0 + (2 * 3). */
    expect(expr.evaluate()).toBe(6);
  });

  it("division truncates toward zero (C integer division)", () => {
    const expr = new Expression();
    expr.setBaseValue(() => -7);
    expr.addOperationsString("/ 2");
    expect(expr.evaluate()).toBe(-3);
  });

  it("rejects operands outside int16 range", () => {
    const expr = new Expression();
    expect(expr.addOperationsString("+ 32768")).toBe(
      EXPRESSION_ERR_OPERAND_OUT_OF_BOUNDS,
    );
    expect(expr.addOperationsString("+ -32769")).toBe(
      EXPRESSION_ERR_OPERAND_OUT_OF_BOUNDS,
    );
    expect(expr.addOperationsString("+ 32767")).toBe(1);
    expect(expr.addOperationsString("+ -32768")).toBe(1);
  });

  it("parses number tokens with strtol base 0 (octal, hex, junk)", () => {
    /* strtol semantics shared by the dice parser. */
    expect(strtolBase0("017")).toEqual({ value: 15, consumed: 3 });
    expect(strtolBase0("0x1A")).toEqual({ value: 26, consumed: 4 });
    expect(strtolBase0("08")).toEqual({ value: 0, consumed: 1 });
    expect(strtolBase0("5abc")).toEqual({ value: 5, consumed: 1 });
    expect(strtolBase0("-12")).toEqual({ value: -12, consumed: 3 });
    expect(strtolBase0("-")).toEqual({ value: 0, consumed: 0 });
    expect(strtolBase0("n")).toEqual({ value: 0, consumed: 0 });

    /* A token with any leading digits is a value, even with junk. */
    const expr = new Expression();
    expect(expr.addOperationsString("+ 5abc")).toBe(1);
    expect(expr.evaluate()).toBe(5);
  });

  it("keeps parsed operations when the 50-op cap truncates", () => {
    const expr = new Expression();
    const parts: string[] = ["+"];
    for (let i = 0; i < 60; i++) parts.push("1");
    expect(expr.addOperationsString(parts.join(" "))).toBe(50);
    expect(expr.evaluate()).toBe(50);
  });

  it("appends nothing when a parse fails", () => {
    const expr = new Expression();
    expect(expr.addOperationsString("+ 1 2")).toBe(2);
    expect(expr.addOperationsString("/ 1 0")).toBe(
      EXPRESSION_ERR_DIVIDE_BY_ZERO,
    );
    expect(expr.evaluate()).toBe(3);
  });

  it("wraps arithmetic in int32 like C", () => {
    const expr = new Expression();
    expr.setBaseValue(() => 2147483647);
    expr.addOperationsString("+ 1");
    expect(expr.evaluate()).toBe(-2147483648);
  });
});
