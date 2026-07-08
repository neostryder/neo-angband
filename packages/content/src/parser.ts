/**
 * Generic parser for Angband's gamedata record format.
 *
 * Faithful port of the line-level semantics of reference/src/parser.c
 * (Angband 4.2.6):
 *
 * - A line is `directive:field1:field2:...`. Leading whitespace is skipped;
 *   blank lines and lines starting with `#` are ignored.
 * - Each directive is registered with a format string like upstream
 *   parser_reg(), e.g. "name str name" or "effect sym eff ?sym type
 *   ?int radius ?int other". A `?` prefix marks an optional field; a
 *   mandatory field may not follow an optional one, and no field may
 *   follow a `str` field.
 * - int/uint/sym/rand fields are tokenized on `:` with strtok() semantics
 *   (consecutive colons collapse). `str` consumes the rest of the line,
 *   colons included. `char` consumes exactly one character (which may be
 *   a space or a colon) and then expects `:` or end of line.
 * - int uses strtol(_, _, 0) semantics (hex/octal prefixes accepted,
 *   trailing garbage ignored); uint additionally rejects a leading `-`.
 * - rand fields are validated against upstream parse_random() but the RAW
 *   dice string (e.g. "1+2d3M4") is preserved; it is never evaluated.
 */

export type FieldType = "int" | "uint" | "sym" | "str" | "char" | "rand";

export interface FieldSpec {
  readonly type: FieldType;
  readonly name: string;
  readonly optional: boolean;
}

export interface DirectiveSignature {
  readonly directive: string;
  readonly fields: readonly FieldSpec[];
}

export type ParseErrorCode =
  | "MISSING_FIELD"
  | "UNDEFINED_DIRECTIVE"
  | "FIELD_TOO_LONG"
  | "NOT_NUMBER"
  | "NOT_RANDOM"
  | "INVALID_SPEC";

/** Parse failure; `code` mirrors the upstream PARSE_ERROR_* it corresponds to. */
export class ParseError extends Error {
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.name = "ParseError";
    this.code = code;
  }
}

/** A successfully parsed line: the directive plus its named field values. */
export interface ParsedLine {
  readonly directive: string;
  /** Field name -> value, in signature order. Absent optionals are omitted. */
  readonly values: Readonly<Record<string, string | number>>;
}

const FIELD_TYPES: readonly string[] = ["int", "uint", "sym", "str", "char", "rand"];

function isFieldType(s: string): s is FieldType {
  return FIELD_TYPES.includes(s);
}

/**
 * Parse a registration format string exactly like upstream parse_specs():
 * `fmt ::= directive [type name]*` where `type` may carry a `?` prefix.
 */
export function parseSignature(fmt: string): DirectiveSignature {
  const tokens = fmt.split(" ").filter((t) => t.length > 0);
  const directive = tokens.shift();
  if (directive === undefined) {
    throw new ParseError("INVALID_SPEC", `empty format string`);
  }
  const fields: FieldSpec[] = [];
  while (tokens.length > 0) {
    const rawType = tokens.shift();
    if (rawType === undefined) {
      break;
    }
    const name = tokens.shift();
    if (name === undefined) {
      throw new ParseError("INVALID_SPEC", `type without name in "${fmt}"`);
    }
    const optional = rawType.startsWith("?");
    const typeName = optional ? rawType.slice(1) : rawType;
    if (!isFieldType(typeName)) {
      throw new ParseError("INVALID_SPEC", `unknown field type "${rawType}" in "${fmt}"`);
    }
    const prev = fields[fields.length - 1];
    if (prev !== undefined) {
      if (!optional && prev.optional) {
        throw new ParseError("INVALID_SPEC", `mandatory field after optional in "${fmt}"`);
      }
      if (prev.type === "str") {
        throw new ParseError("INVALID_SPEC", `field after str field in "${fmt}"`);
      }
    }
    fields.push({ type: typeName, name, optional });
  }
  return { directive, fields };
}

/** C isspace() for the default locale. */
function isCSpace(code: number): boolean {
  return (
    code === 0x20 || // space
    code === 0x09 || // \t
    code === 0x0a || // \n
    code === 0x0b || // \v
    code === 0x0c || // \f
    code === 0x0d // \r
  );
}

const INT_MAX = 2147483647;

interface NumberScan {
  readonly value: number;
  readonly end: number;
  readonly negative: boolean;
}

function digitValue(ch: string, base: number): number | null {
  let v: number;
  const code = ch.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) {
    v = code - 0x30;
  } else if (code >= 0x41 && code <= 0x5a) {
    v = code - 0x41 + 10;
  } else if (code >= 0x61 && code <= 0x7a) {
    v = code - 0x61 + 10;
  } else {
    return null;
  }
  return v < base ? v : null;
}

/**
 * C strtol/strtoul-style number scan. With `base0` the base is inferred
 * from a 0x/0 prefix as strtol(_, _, 0) does; otherwise base 10.
 * Returns null when no digits were consumed (endptr == nptr in C).
 */
function scanNumber(s: string, start: number, base0: boolean): NumberScan | null {
  let i = start;
  while (i < s.length && isCSpace(s.charCodeAt(i))) {
    i++;
  }
  let negative = false;
  const sign = s[i];
  if (sign === "+" || sign === "-") {
    negative = sign === "-";
    i++;
  }
  let base = 10;
  if (base0 && s[i] === "0") {
    const next = s[i + 1];
    const afterPrefix = s[i + 2];
    if (
      (next === "x" || next === "X") &&
      afterPrefix !== undefined &&
      digitValue(afterPrefix, 16) !== null
    ) {
      base = 16;
      i += 2;
    } else {
      base = 8;
    }
  }
  const digitsStart = i;
  let value = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === undefined) {
      break;
    }
    const d = digitValue(ch, base);
    if (d === null) {
      break;
    }
    value = value * base + d;
    i++;
  }
  if (i === digitsStart) {
    return null;
  }
  return { value: negative ? -value : value, end: i, negative };
}

function containsOnlySpaces(s: string, from: number): boolean {
  for (let i = from; i < s.length; i++) {
    if (!isCSpace(s.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

/**
 * Validate a random-value (dice) string. Faithful port of parse_random()
 * in reference/src/parser.c; only validity is reported, the raw string is
 * what gets stored.
 */
export function isValidRandom(s: string): boolean {
  let pos = 0;
  let i = 0;
  let minI = 1;
  if (s[0] === "-") {
    pos++;
  }
  for (;;) {
    const c = s[pos];
    if (c === "d") {
      if (i > 2) {
        return false;
      }
      if (i < 2) {
        /* 'd' with no preceding number implies one die. */
        i = 2;
      }
      minI = 3;
      pos++;
    } else if (c === "M") {
      if (i === 2) {
        return false;
      }
      i = 3;
      minI = 4;
      pos++;
    } else {
      const scan = scanNumber(s, pos, false);
      if (scan === null) {
        /* Trailing garbage or not enough values are not accepted. */
        if (!containsOnlySpaces(s, pos) || i < minI) {
          return false;
        }
        break;
      }
      if (scan.value > INT_MAX || (scan.negative && scan.value !== 0) || s[pos] === "+") {
        return false;
      }
      pos = scan.end;
      if (i === 0) {
        if (s[pos] === "d") {
          i = 1;
        } else if (s[pos] === "+") {
          pos++;
          minI = 3;
        } else {
          if (!containsOnlySpaces(s, scan.end)) {
            return false;
          }
          break;
        }
      } else if (i === 4) {
        return false;
      }
      i++;
    }
  }
  return true;
}

/**
 * Cursor over one line, replicating the strtok() usage in parser_parse().
 */
class Tokenizer {
  private readonly s: string;
  private pos = 0;

  constructor(s: string) {
    this.s = s;
  }

  /** strtok(_, ":"): skip leading colons, take up to the next colon. */
  nextToken(): string | null {
    while (this.pos < this.s.length && this.s[this.pos] === ":") {
      this.pos++;
    }
    if (this.pos >= this.s.length) {
      return null;
    }
    const start = this.pos;
    while (this.pos < this.s.length && this.s[this.pos] !== ":") {
      this.pos++;
    }
    const tok = this.s.slice(start, this.pos);
    if (this.pos < this.s.length) {
      this.pos++; /* consume the delimiter, as strtok() does */
    }
    return tok;
  }

  /** strtok(_, ""): the untouched rest of the line, or null at the end. */
  rest(): string | null {
    if (this.pos >= this.s.length) {
      return null;
    }
    const tok = this.s.slice(this.pos);
    this.pos = this.s.length;
    return tok;
  }

  /**
   * A char field: exactly one character (possibly a space or a colon),
   * then a `:` separator or end of line. Anything else is FIELD_TOO_LONG.
   */
  takeChar(fieldName: string): string | null {
    if (this.pos >= this.s.length) {
      return null;
    }
    const cp = this.s.codePointAt(this.pos);
    /* pos is in bounds, so a code point exists. */
    const ch = String.fromCodePoint(cp ?? 0);
    this.pos += ch.length;
    if (this.pos < this.s.length) {
      if (this.s[this.pos] === ":") {
        this.pos++;
      } else {
        throw new ParseError("FIELD_TOO_LONG", fieldName);
      }
    }
    return ch;
  }
}

/**
 * Parse one line against a set of registered directives.
 *
 * Returns null for blank lines and comments. Throws ParseError for
 * undefined directives, missing mandatory fields, malformed numbers and
 * malformed dice strings, mirroring parser_parse().
 */
export function parseLine(
  line: string,
  lookup: (directive: string) => DirectiveSignature | undefined,
): ParsedLine | null {
  let start = 0;
  while (start < line.length && isCSpace(line.charCodeAt(start))) {
    start++;
  }
  if (start >= line.length || line[start] === "#") {
    return null;
  }
  const t = new Tokenizer(line.slice(start));
  const directiveTok = t.nextToken();
  if (directiveTok === null) {
    throw new ParseError("MISSING_FIELD", "missing directive");
  }
  const sig = lookup(directiveTok);
  if (sig === undefined) {
    throw new ParseError("UNDEFINED_DIRECTIVE", directiveTok);
  }
  const values: Record<string, string | number> = {};
  for (const field of sig.fields) {
    let tok: string | null;
    if (field.type === "char") {
      tok = t.takeChar(field.name);
    } else if (field.type === "str") {
      tok = t.rest();
    } else {
      tok = t.nextToken();
    }
    if (tok === null) {
      if (!field.optional) {
        throw new ParseError("MISSING_FIELD", field.name);
      }
      break;
    }
    if (field.type === "int") {
      const scan = scanNumber(tok, 0, true);
      if (scan === null) {
        throw new ParseError("NOT_NUMBER", field.name);
      }
      values[field.name] = scan.value;
    } else if (field.type === "uint") {
      if (tok[0] === "-") {
        throw new ParseError("NOT_NUMBER", field.name);
      }
      const scan = scanNumber(tok, 0, true);
      if (scan === null || scan.negative) {
        throw new ParseError("NOT_NUMBER", field.name);
      }
      values[field.name] = scan.value;
    } else if (field.type === "rand") {
      if (!isValidRandom(tok)) {
        throw new ParseError("NOT_RANDOM", field.name);
      }
      values[field.name] = tok;
    } else {
      /* sym, str, char: stored verbatim */
      values[field.name] = tok;
    }
  }
  return { directive: sig.directive, values };
}
