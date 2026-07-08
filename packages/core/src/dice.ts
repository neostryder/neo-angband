/**
 * Dice expressions, ported from reference/src/z-dice.c/h (Angband 4.2.6).
 *
 * A dice object represents "B+XdYmZ" (base, dice, sides, m_bonus) parsed
 * from strings like "3+4d5M6", "d4", or "$B+$Dd$S". Uppercase names
 * starting with $ are variables; expressions are bound to them with
 * bindExpression and evaluated when the dice are rolled.
 *
 * Parser behavior replicated exactly from the upstream state machine:
 * - Spaces (C isspace) are skipped, concatenating what surrounds them
 *   ("1 1 +2d3" parses as base 11).
 * - Tokens (numbers, variable names) are truncated to 16 characters.
 * - A 'd' with no leading count means one die ("d6" is 1d6).
 * - 'M' doubles as the bonus marker and as a variable-name character; it is
 *   only treated as a name character while a variable name is being read.
 *   'm' is always the bonus marker.
 * - '-' is only accepted as the very first character (negative base).
 * - Characters that are none of [0-9A-Z$dmM+-&], C whitespace, or the
 *   terminator are silently IGNORED, as upstream ("1z+2d3" == "1+2d3").
 * - Numbers are parsed with C strtol base 0, so a leading 0 makes a number
 *   octal ("010+d4" has base 8).
 * - At most 4 distinct variables fit; on overflow the component keeps the
 *   error index -1 (upstream stores it and later reads out of bounds,
 *   undefined behavior; this port evaluates such a component as 0).
 *
 * The RNG is passed to roll/evaluate as a parameter; this module holds no
 * random state.
 */

import type { Expression } from "./expression";
import { strtolBase0 } from "./expression";
import type { Aspect, RandomValue, Rng } from "./rng";

/** Hard limit on the number of variables/expressions. */
const DICE_MAX_EXPRESSIONS = 4;

/** Max size for a token/number; longer tokens are truncated. */
const DICE_TOKEN_SIZE = 16;

/* String parser states (dice_state_t), 'A' through 'M' in the table. */
const STATE_START = 0; /* A */
const STATE_BASE_DIGIT = 1; /* B */
const STATE_FLUSH_BASE = 2; /* C */
const STATE_DICE_DIGIT = 3; /* D */
const STATE_FLUSH_DICE = 4; /* E */
const STATE_SIDE_DIGIT = 5; /* F */
const STATE_FLUSH_SIDE = 6; /* G */
const STATE_BONUS = 7; /* H */
const STATE_BONUS_DIGIT = 8; /* I */
const STATE_FLUSH_BONUS = 9; /* J */
const STATE_VAR = 10; /* K */
const STATE_VAR_CHAR = 11; /* L */
const STATE_FLUSH_ALL = 12; /* M */
const STATE_MAX = 13;

/* Parser input types (dice_input_t). */
const INPUT_AMP = 0;
const INPUT_MINUS = 1;
const INPUT_BASE = 2;
const INPUT_DICE = 3;
const INPUT_BONUS = 4;
const INPUT_VAR = 5;
const INPUT_DIGIT = 6;
const INPUT_UPPER = 7;
const INPUT_NULL = 8;
const INPUT_MAX = 9;

/**
 * The state table from dice_parse_state_transition, transcribed verbatim.
 * Row = state A..M, column = input (&, -, +, d, m, $, digit, upper, NUL).
 * '.' is an invalid transition.
 */
const STATE_TABLE: readonly string[] = [
  ".B.EHKB..", /* A: START */
  "..CE..B.C", /* B: BASE_DIGIT */
  "...EHKD..", /* C: FLUSH_BASE */
  "...E..D..", /* D: DICE_DIGIT */
  ".....KF..", /* E: FLUSH_DICE */
  "G...H.F.G", /* F: SIDE_DIGIT */
  "....H....", /* G: FLUSH_SIDE */
  ".....KI..", /* H: BONUS */
  "......I.J", /* I: BONUS_DIGIT */
  ".........", /* J: FLUSH_BONUS */
  ".......L.", /* K: VAR */
  "G.CEH..LM", /* L: VAR_CHAR */
  ".........", /* M: FLUSH_ALL */
];

/* Last-seen tracker (enum last_seen_e). */
const SEEN_NONE = 0;
const SEEN_BASE = 1;
const SEEN_DICE = 2;
const SEEN_SIDE = 3;
const SEEN_BONUS = 4;

const C_SPACE = " \t\n\v\f\r";

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isUpper(c: string): boolean {
  return c >= "A" && c <= "Z";
}

/** dice_input_for_char. */
function inputForChar(c: string): number {
  switch (c) {
    case "&":
      return INPUT_AMP;
    case "-":
      return INPUT_MINUS;
    case "+":
      return INPUT_BASE;
    case "d":
      return INPUT_DICE;
    case "M":
    case "m":
      return INPUT_BONUS;
    case "$":
      return INPUT_VAR;
    case "\0":
      return INPUT_NULL;
    default:
      break;
  }
  if (isDigit(c)) return INPUT_DIGIT;
  if (isUpper(c)) return INPUT_UPPER;
  return INPUT_MAX;
}

/** dice_parse_state_transition. */
function stateTransition(state: number, input: number): number {
  if (state === STATE_MAX || input === INPUT_MAX) return STATE_MAX;
  const cell = (STATE_TABLE[state] as string)[input] as string;
  if (cell === ".") return STATE_MAX;
  return cell.charCodeAt(0) - 0x41; /* 'A' */
}

interface DiceExpressionEntry {
  name: string | null;
  expression: Expression | null;
}

/**
 * dice_t. Construction is dice_new (dice_free is garbage collected).
 */
export class Dice {
  private b = 0;
  private x = 0;
  private y = 0;
  private m = 0;
  private exB = false;
  private exX = false;
  private exY = false;
  private exM = false;
  private expressions: DiceExpressionEntry[] | null = null;

  /**
   * dice_reset: zero the values and clear (but keep) the expression table.
   */
  private reset(): void {
    this.b = 0;
    this.x = 0;
    this.y = 0;
    this.m = 0;
    this.exB = false;
    this.exX = false;
    this.exY = false;
    this.exM = false;
    if (this.expressions === null) return;
    for (const entry of this.expressions) {
      entry.name = null;
      entry.expression = null;
    }
  }

  /**
   * dice_add_variable: returns the index of the (possibly new) variable
   * name, or -1 when all DICE_MAX_EXPRESSIONS slots are taken.
   */
  private addVariable(name: string): number {
    if (this.expressions === null) {
      this.expressions = [];
      for (let i = 0; i < DICE_MAX_EXPRESSIONS; i++) {
        this.expressions.push({ name: null, expression: null });
      }
    }
    for (let i = 0; i < DICE_MAX_EXPRESSIONS; i++) {
      const entry = this.expressions[i] as DiceExpressionEntry;
      if (entry.name === null) {
        entry.name = name;
        return i;
      } else if (entry.name.toLowerCase() === name.toLowerCase()) {
        return i;
      }
    }
    return -1;
  }

  /**
   * dice_bind_expression: bind a deep copy of `expression` to a variable
   * name found during parsing. Returns the index bound, or -1 when the
   * name is unknown (case-insensitive lookup, as upstream my_stricmp).
   */
  bindExpression(name: string, expression: Expression): number {
    if (this.expressions === null) return -1;
    for (let i = 0; i < DICE_MAX_EXPRESSIONS; i++) {
      const entry = this.expressions[i] as DiceExpressionEntry;
      if (entry.name === null) continue;
      if (entry.name.toLowerCase() === name.toLowerCase()) {
        entry.expression = expression.copy();
        return i;
      }
    }
    return -1;
  }

  /**
   * dice_parse_string: parse a dice string into this object, resetting any
   * previous state. Returns true on success, false on a parse error.
   */
  parseString(string: string | null | undefined): boolean {
    if (string === null || string === undefined) return false;

    let token = "";
    let state = STATE_START;
    let lastSeen = SEEN_NONE;

    /* Reset all internal state, since this object might be reused. */
    this.reset();

    /* The string terminator is included as part of the parse. */
    for (let current = 0; current <= string.length; current++) {
      const ch = current < string.length ? (string[current] as string) : "\0";

      /* Skip spaces; this concatenates digits and variable names. */
      if (C_SPACE.includes(ch)) continue;

      const inputType = inputForChar(ch);

      switch (inputType) {
        case INPUT_AMP:
        case INPUT_BASE:
        case INPUT_DICE:
        case INPUT_VAR:
        case INPUT_NULL:
          state = stateTransition(state, inputType);
          break;

        case INPUT_MINUS:
        case INPUT_DIGIT:
        case INPUT_UPPER:
          /* Truncate tokens if they are too long to fit. */
          if (token.length < DICE_TOKEN_SIZE) token += ch;
          state = stateTransition(state, inputType);
          break;

        default:
          /* INPUT_BONUS and unrecognized characters: handled below or
           * silently ignored, as upstream. */
          break;
      }

      /*
       * 'M' doubles as the bonus marker and a variable-name character; it
       * is a name character only while a variable name is being read.
       */
      if (ch === "M") {
        if (state === STATE_VAR || state === STATE_VAR_CHAR) {
          if (token.length < DICE_TOKEN_SIZE) token += ch;
          state = stateTransition(state, INPUT_UPPER);
        } else {
          state = stateTransition(state, INPUT_BONUS);
        }
      } else if (ch === "m") {
        state = stateTransition(state, INPUT_BONUS);
      }

      /* Illegal transition. */
      if (state >= STATE_MAX) return false;

      let flush = true;

      switch (state) {
        case STATE_FLUSH_BASE:
          lastSeen = SEEN_BASE;
          break;

        case STATE_FLUSH_DICE:
          lastSeen = SEEN_DICE;
          /* A 'd' with no number before it is one die. */
          if (token.length === 0) token = "1";
          break;

        case STATE_FLUSH_SIDE:
          lastSeen = SEEN_SIDE;
          break;

        case STATE_FLUSH_BONUS:
          lastSeen = SEEN_BONUS;
          break;

        case STATE_FLUSH_ALL:
          /* Flush whatever comes after what we last saw. */
          if (lastSeen < SEEN_BONUS) lastSeen++;
          break;

        case STATE_BONUS:
          /* If we last saw dice, we are now seeing sides. */
          if (lastSeen === SEEN_DICE) lastSeen = SEEN_SIDE;
          else lastSeen = SEEN_BONUS;
          break;

        default:
          /* A state that should not flush anything. */
          flush = false;
          break;
      }

      if (flush && token.length > 0) {
        let value = 0;
        let isVariable = false;

        if (isUpper(token[0] as string)) {
          value = this.addVariable(token);
          isVariable = true;
        } else {
          /* C strtol(token, NULL, 0) then (int) cast. */
          value = strtolBase0(token).value | 0;
          isVariable = false;
        }

        switch (lastSeen) {
          case SEEN_BASE:
            this.b = value;
            this.exB = isVariable;
            break;
          case SEEN_DICE:
            this.x = value;
            this.exX = isVariable;
            break;
          case SEEN_SIDE:
            this.y = value;
            this.exY = isVariable;
            break;
          case SEEN_BONUS:
            this.m = value;
            this.exM = isVariable;
            break;
          default:
            break;
        }

        token = "";
      }
    }

    return true;
  }

  /** Evaluate one component, resolving a bound expression if needed. */
  private component(value: number, isExpression: boolean): number {
    if (!isExpression) return value;
    if (
      this.expressions !== null &&
      value >= 0 &&
      value < DICE_MAX_EXPRESSIONS &&
      (this.expressions[value] as DiceExpressionEntry).expression !== null
    ) {
      const expr = (this.expressions[value] as DiceExpressionEntry)
        .expression as Expression;
      return expr.evaluate();
    }
    return 0;
  }

  /**
   * dice_random_value: extract a random_value, evaluating any bound
   * expressions. Deterministic (no RNG involved).
   */
  randomValue(): RandomValue {
    return {
      base: this.component(this.b, this.exB),
      dice: this.component(this.x, this.exX),
      sides: this.component(this.y, this.exY),
      mBonus: this.component(this.m, this.exM),
    };
  }

  /**
   * dice_evaluate: fully evaluate via randcalc under an aspect. When `out`
   * is passed, the random_value used is written into it (the upstream out
   * parameter).
   */
  evaluate(rng: Rng, level: number, aspect: Aspect, out?: RandomValue): number {
    const rv = this.randomValue();
    if (out !== undefined) {
      out.base = rv.base;
      out.dice = rv.dice;
      out.sides = rv.sides;
      out.mBonus = rv.mBonus;
    }
    return rng.randcalc(rv, level, aspect);
  }

  /**
   * dice_roll: evaluate as base + XdY (m_bonus is reported in `out` but
   * not rolled, as upstream).
   */
  roll(rng: Rng, out?: RandomValue): number {
    const rv = this.randomValue();
    if (out !== undefined) {
      out.base = rv.base;
      out.dice = rv.dice;
      out.sides = rv.sides;
      out.mBonus = rv.mBonus;
    }
    return rv.base + rng.damroll(rv.dice, rv.sides);
  }

  /** dice_test_values: compare the raw parsed values (not expressions). */
  testValues(
    base: number,
    diceCount: number,
    sides: number,
    bonus: number,
  ): boolean {
    let success = true;
    success &&= this.b === base;
    success &&= this.x === diceCount;
    success &&= this.y === sides;
    success &&= this.m === bonus;
    return success;
  }

  /**
   * dice_test_variables: check that each component uses the named variable
   * (or, when null, does not use a variable). Requires that at least one
   * variable was parsed, as upstream (expressions table must exist).
   */
  testVariables(
    base: string | null,
    diceName: string | null,
    sides: string | null,
    bonus: string | null,
  ): boolean {
    if (this.expressions === null) return false;
    const check = (
      wanted: string | null,
      isExpr: boolean,
      index: number,
    ): boolean => {
      if (wanted === null) return !isExpr;
      if (!isExpr || index < 0) return false;
      const entry = this.expressions?.[index];
      if (entry === undefined || entry.name === null) return false;
      return entry.name.toLowerCase() === wanted.toLowerCase();
    };
    let success = true;
    success &&= check(base, this.exB, this.b);
    success &&= check(diceName, this.exX, this.x);
    success &&= check(sides, this.exY, this.y);
    success &&= check(bonus, this.exM, this.m);
    return success;
  }
}
