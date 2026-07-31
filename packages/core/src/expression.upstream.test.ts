/**
 * Upstream unit tests from reference/src/tests/z-expression/expression.c
 * (suite z-expression/expression).
 *
 * Mapping: expression_new → `new Expression()`; expression_copy → copy;
 * expression_test_copy → expressionTestCopy; expression_add_operations_string
 * → addOperationsString (null maps to C NULL); expression_evaluate → evaluate.
 * GC replaces expression_free.
 */

import { describe, expect, it } from "vitest";
import {
  EXPRESSION_ERR_DIVIDE_BY_ZERO,
  EXPRESSION_ERR_EXPECTED_OPERAND,
  EXPRESSION_ERR_EXPECTED_OPERATOR,
  EXPRESSION_ERR_GENERIC,
  EXPRESSION_ERR_INVALID_OPERATOR,
  Expression,
  expressionTestCopy,
} from "./expression.js";

describe("z-expression/expression upstream", () => {
  // C: test_alloc
  it("alloc", () => {
    const expr = new Expression();
    expect(expr).not.toBeNull();
    expr.addOperationsString("+ 1");
    const copy = expr.copy();
    expect(expressionTestCopy(expr, copy)).toBe(true);
  });

  // C: test_parse_success
  it("parse-success", () => {
    const expr = new Expression();

    /* Test basic operators. */
    expect(expr.addOperationsString("+ 1")).toBe(1);
    expect(expr.addOperationsString("- 1")).toBe(1);
    expect(expr.addOperationsString("* 1")).toBe(1);
    expect(expr.addOperationsString("/ 1")).toBe(1);

    /* Test various negation situations. */
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

  // C: test_parse_failure
  it("parse-failure", () => {
    const expr = new Expression();

    /* Basic problems. */
    expect(expr.addOperationsString(null)).toBe(EXPRESSION_ERR_GENERIC);
    /* C also checks expression_add_operations_string(NULL, "+ 1"); no null
     * receiver in TS — covered by the null-string case above. */

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
    expect(expr.addOperationsString("/ 0")).toBe(EXPRESSION_ERR_DIVIDE_BY_ZERO);
    expect(expr.addOperationsString("/ 10 0")).toBe(
      EXPRESSION_ERR_DIVIDE_BY_ZERO,
    );

    /*
     * Too many operations (EXPRESSION_MAX_OPERATIONS). Upstream uses six
     * adjacent C string literals which concatenate into "...9 0+ 1 2..."
     * with no space at the seams; String.repeat reproduces that string.
     */
    expect(expr.addOperationsString("+ 1 2 3 4 5 6 7 8 9 0".repeat(6))).toBe(
      50,
    );
  });

  // C: test_evaluate
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
