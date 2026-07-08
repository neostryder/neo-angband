/**
 * Simple math expressions, ported from reference/src/z-expression.c/h
 * (Angband 4.2.6).
 *
 * An expression is a base value function plus a list of (operator, operand)
 * operations applied to an accumulator strictly left to right; there is NO
 * operator precedence. The string form is prefix/space-delimited and must
 * start with an operator: "+ 1 2 3" means ((base + 1) + 2) + 3 and
 * "+ 2 * 3" means (base + 2) * 3. An operator with multiple following
 * operands is applied once per operand; negation ("n" or "N") is unary and
 * takes no operand.
 *
 * Number tokens are parsed with C strtol(str, &end, 0) semantics: base is
 * auto-detected, so "0x1A" is hex and "017" is OCTAL (15). Any token where
 * strtol consumes at least one character is treated as a value, even with
 * trailing junk ("5abc" is the value 5). Operands must fit in int16
 * (-32768..32767). Arithmetic is C int32: wrap on add/sub/mul, truncation
 * toward zero on division.
 *
 * Parsing appends at most EXPRESSION_MAX_OPERATIONS (50) operations per
 * call and silently drops the rest, as upstream. On a parse error nothing
 * is appended and the (negative) error code is returned.
 */

export const EXPRESSION_ERR_GENERIC = -1;
export const EXPRESSION_ERR_INVALID_OPERATOR = -2;
export const EXPRESSION_ERR_EXPECTED_OPERATOR = -3;
export const EXPRESSION_ERR_EXPECTED_OPERAND = -4;
export const EXPRESSION_ERR_DIVIDE_BY_ZERO = -5;
export const EXPRESSION_ERR_OPERAND_OUT_OF_BOUNDS = -6;

/** expression_base_value_f: returns the int32 the operations start from. */
export type ExpressionBaseValue = () => number;

interface ExpressionOperation {
  operator: number;
  operand: number;
}

/** Operator types (expression_operator_t). */
const OPERATOR_NONE = 0;
const OPERATOR_ADD = 1;
const OPERATOR_SUB = 2;
const OPERATOR_MUL = 3;
const OPERATOR_DIV = 4;
const OPERATOR_NEG = 5;

/** Parser states (expression_state_t). */
const STATE_START = 0;
const STATE_OPERATOR = 1;
const STATE_OPERAND = 2;

/** Parser input types (expression_input_t). */
const INPUT_INVALID = 0;
const INPUT_NEEDS_OPERANDS = 1;
const INPUT_UNARY_OPERATOR = 2;
const INPUT_VALUE = 3;

/** Allocation block size for the operations array (bookkeeping only). */
const EXPRESSION_ALLOC_SIZE = 5;

/** Maximum number of operations added by one parse call. */
export const EXPRESSION_MAX_OPERATIONS = 50;

/**
 * The parser state table, transcribed from z-expression.c. Cells hold the
 * next state, or a negative expression error code.
 */
const STATE_TABLE: readonly (readonly number[])[] = [
  // STATE_START
  [
    EXPRESSION_ERR_INVALID_OPERATOR,
    STATE_OPERATOR,
    STATE_START,
    EXPRESSION_ERR_EXPECTED_OPERATOR,
  ],
  // STATE_OPERATOR (found operator)
  [
    EXPRESSION_ERR_INVALID_OPERATOR,
    EXPRESSION_ERR_EXPECTED_OPERAND,
    EXPRESSION_ERR_EXPECTED_OPERAND,
    STATE_OPERAND,
  ],
  // STATE_OPERAND (found one operand)
  [
    EXPRESSION_ERR_INVALID_OPERATOR,
    STATE_OPERATOR,
    STATE_START,
    STATE_OPERAND,
  ],
];

const C_SPACE = " \t\n\v\f\r";

function digitValue(ch: string, base: number): number {
  let v: number;
  if (ch >= "0" && ch <= "9") v = ch.charCodeAt(0) - 0x30;
  else if (ch >= "a" && ch <= "z") v = ch.charCodeAt(0) - 0x61 + 10;
  else if (ch >= "A" && ch <= "Z") v = ch.charCodeAt(0) - 0x41 + 10;
  else return -1;
  return v < base ? v : -1;
}

/**
 * C strtol(nptr, &endptr, 0) replica used by the expression and dice
 * parsers: optional whitespace, optional sign, then auto-detected base
 * ("0x"/"0X" prefix is hex, leading "0" is octal, otherwise decimal).
 * Returns the parsed value and the number of characters consumed; consumed
 * is 0 when no digits were found (endptr == nptr upstream). Long-overflow
 * saturation is not replicated (tokens here are at most 16 chars).
 */
export function strtolBase0(s: string): { value: number; consumed: number } {
  let i = 0;
  while (i < s.length && C_SPACE.includes(s[i] as string)) i++;
  let sign = 1;
  if (s[i] === "+" || s[i] === "-") {
    if (s[i] === "-") sign = -1;
    i++;
  }
  let base = 10;
  if (s[i] === "0") {
    if (
      (s[i + 1] === "x" || s[i + 1] === "X") &&
      i + 2 < s.length &&
      digitValue(s[i + 2] as string, 16) >= 0
    ) {
      base = 16;
      i += 2;
    } else {
      base = 8;
    }
  }
  let value = 0;
  let any = false;
  while (i < s.length) {
    const d = digitValue(s[i] as string, base);
    if (d < 0) break;
    value = value * base + d;
    any = true;
    i++;
  }
  if (!any) return { value: 0, consumed: 0 };
  return { value: sign * value, consumed: i };
}

/** expression_operator_from_token. */
function operatorFromToken(token: string): number {
  let result: number;
  switch (token[0]) {
    case "+":
      result = OPERATOR_ADD;
      break;
    case "-":
      result = OPERATOR_SUB;
      break;
    case "*":
      result = OPERATOR_MUL;
      break;
    case "/":
      result = OPERATOR_DIV;
      break;
    case "n":
    case "N":
      result = OPERATOR_NEG;
      break;
    default:
      return OPERATOR_NONE;
  }
  /* Reject if there is additional junk in the token after the operator. */
  return token.length > 1 ? OPERATOR_NONE : result;
}

/** expression_input_for_operator. */
function inputForOperator(operator: number): number {
  switch (operator) {
    case OPERATOR_ADD:
    case OPERATOR_SUB:
    case OPERATOR_MUL:
    case OPERATOR_DIV:
      return INPUT_NEEDS_OPERANDS;
    case OPERATOR_NEG:
      return INPUT_UNARY_OPERATOR;
    default:
      return INPUT_INVALID;
  }
}

/**
 * expression_t. Construction is expression_new; there is no expression_free
 * (garbage collected). operationsSize mirrors the upstream capacity
 * bookkeeping so expressionTestCopy can compare it faithfully.
 */
export class Expression {
  private baseValue: ExpressionBaseValue | null = null;
  private operations: ExpressionOperation[] = [];
  private operationsSize = EXPRESSION_ALLOC_SIZE;

  /** expression_copy: a deep copy sharing the base value function. */
  copy(): Expression {
    const copy = new Expression();
    copy.baseValue = this.baseValue;
    copy.operationsSize = this.operationsSize;
    copy.operations = this.operations.map((op) => ({ ...op }));
    return copy;
  }

  /** expression_set_base_value. */
  setBaseValue(fn: ExpressionBaseValue): void {
    this.baseValue = fn;
  }

  /**
   * expression_evaluate: applies the operations left to right with C int32
   * semantics. With no base value function, evaluation starts from zero.
   */
  evaluate(): number {
    let value = 0;
    if (this.baseValue !== null) value = this.baseValue() | 0;
    for (const op of this.operations) {
      switch (op.operator) {
        case OPERATOR_ADD:
          value = (value + op.operand) | 0;
          break;
        case OPERATOR_SUB:
          value = (value - op.operand) | 0;
          break;
        case OPERATOR_MUL:
          value = Math.imul(value, op.operand);
          break;
        case OPERATOR_DIV:
          value = Math.trunc(value / op.operand) | 0;
          break;
        case OPERATOR_NEG:
          value = -value | 0;
          break;
        default:
          break;
      }
    }
    return value;
  }

  /** expression_add_operation, including the capacity bookkeeping. */
  private addOperation(operation: ExpressionOperation): void {
    if (this.operations.length >= this.operationsSize) {
      this.operationsSize += EXPRESSION_ALLOC_SIZE;
    }
    this.operations.push(operation);
  }

  /**
   * expression_add_operations_string: parses a prefix-notation string and
   * appends its operations. Returns the number of operations added, or a
   * negative expression error code (in which case nothing is appended).
   * The upstream NULL string case maps to null/undefined.
   */
  addOperationsString(str: string | null | undefined): number {
    if (str === null || str === undefined) return EXPRESSION_ERR_GENERIC;

    /* Empty string is an identity operation. */
    if (str === "") return 0;

    const pending: ExpressionOperation[] = [];
    let count = 0;
    let parsedOperator = OPERATOR_NONE;
    let currentOperator = OPERATOR_NONE;
    let state = STATE_START;

    /* strtok with a single-space delimiter set. */
    const tokens = str.split(" ").filter((t) => t.length > 0);

    for (const token of tokens) {
      const { value, consumed } = strtolBase0(token);

      if (consumed === 0) {
        parsedOperator = operatorFromToken(token);
        const input = inputForOperator(parsedOperator);
        state = (STATE_TABLE[state] as readonly number[])[input] as number;
      } else {
        state = (STATE_TABLE[state] as readonly number[])[
          INPUT_VALUE
        ] as number;
      }

      /* Perform actions based on the new state. */
      if (state < STATE_START) {
        /* An error occurred, according to the state table. */
        return state;
      } else if (state === STATE_START) {
        /* Flush the operation for a unary operator. */
        pending.push({ operator: parsedOperator, operand: 0 });
        count++;
      } else if (state === STATE_OPERATOR) {
        /* Remember the operator, since it needs operands. */
        currentOperator = parsedOperator;
      } else if (state === STATE_OPERAND) {
        if (value < -32768 || value > 32767) {
          return EXPRESSION_ERR_OPERAND_OUT_OF_BOUNDS;
        }
        /* Try to catch divide by zero. */
        if (currentOperator === OPERATOR_DIV && value === 0) {
          return EXPRESSION_ERR_DIVIDE_BY_ZERO;
        }
        /* Flush the operator and operand pair. */
        pending.push({ operator: currentOperator, operand: value });
        count++;
      }

      /* Limit the number of operations, saving what we have. */
      if (count >= EXPRESSION_MAX_OPERATIONS) break;
    }

    for (const op of pending) this.addOperation(op);
    return count;
  }

  /** Internal snapshot for expressionTestCopy. */
  private snapshot(): {
    baseValue: ExpressionBaseValue | null;
    operations: ExpressionOperation[];
    operationsSize: number;
  } {
    return {
      baseValue: this.baseValue,
      operations: this.operations,
      operationsSize: this.operationsSize,
    };
  }

  /**
   * expression_test_copy: checks that b is a value-equal deep copy of a
   * (distinct objects, same base value function, same operations).
   */
  static testCopy(a: Expression | null, b: Expression | null): boolean {
    if (a === null || b === null) return false;
    const sa = a.snapshot();
    const sb = b.snapshot();
    let success = a !== b;
    success &&= sa.baseValue === sb.baseValue;
    success &&= sa.operations.length === sb.operations.length;
    success &&= sa.operationsSize === sb.operationsSize;
    success &&= sa.operations !== sb.operations;
    if (sa.operations.length !== sb.operations.length) return false;
    for (let i = 0; i < sa.operations.length; i++) {
      const opA = sa.operations[i] as ExpressionOperation;
      const opB = sb.operations[i] as ExpressionOperation;
      success &&= opA.operand === opB.operand;
      success &&= opA.operator === opB.operator;
    }
    return success;
  }
}

/** Function-style alias for upstream expression_test_copy. */
export function expressionTestCopy(
  a: Expression | null,
  b: Expression | null,
): boolean {
  return Expression.testCopy(a, b);
}
