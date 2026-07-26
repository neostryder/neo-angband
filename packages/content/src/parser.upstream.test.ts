/**
 * Port of the upstream unit test reference/src/tests/parse/parse.c
 * ("parse/parser"), which exercises reference/src/parser.c directly.
 *
 * Mapping to the port: upstream's `parser_reg()` spec validation is
 * `parseSignature()`, `parser_parse()` is `parseLine()`, and `parse_random()`
 * is `isValidRandom()`. The port keeps no parser object, so upstream's
 * `parser_priv` / `parser_setpriv` / `parser_getstate` cases have no
 * counterpart (recorded as a gap in
 * parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-parse.md).
 *
 * This file covers what the W5 data-exactness suite structurally cannot:
 * every input here is malformed or degenerate and so never appears in
 * reference/lib/gamedata/*.txt.
 */

import { describe, expect, it } from "vitest";

import { ParseError, isValidRandom, parseLine, parseSignature } from "./parser.js";
import type { DirectiveSignature } from "./parser.js";

/** A directive table, as parser_reg() would build one. */
function table(...fmts: string[]): (directive: string) => DirectiveSignature | undefined {
  const map = new Map<string, DirectiveSignature>();
  for (const fmt of fmts) {
    const sig = parseSignature(fmt);
    map.set(sig.directive, sig);
  }
  return (d) => map.get(d);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ParseError) return err.code;
    throw err;
  }
  throw new Error("expected a ParseError");
}

describe("parse/parser: parser_reg spec validation (parse.c test_reg0..reg5)", () => {
  /* Upstream returns -EINVAL from parser_reg(); the port throws
   * INVALID_SPEC from parse_specs()'s equivalent (parser.c:424-479). */
  it("rejects an empty format string (test_reg0)", () => {
    expect(codeOf(() => parseSignature(""))).toBe("INVALID_SPEC");
  });

  it("rejects a format string of only a space (test_reg1)", () => {
    expect(codeOf(() => parseSignature(" "))).toBe("INVALID_SPEC");
  });

  it("rejects a type with no name (test_reg2)", () => {
    expect(codeOf(() => parseSignature("abc int"))).toBe("INVALID_SPEC");
  });

  it("rejects an unknown field type (test_reg3)", () => {
    expect(codeOf(() => parseSignature("abc notype name"))).toBe("INVALID_SPEC");
  });

  it("rejects a mandatory field after an optional one (test_reg4)", () => {
    expect(codeOf(() => parseSignature("abc int a ?int b int c"))).toBe("INVALID_SPEC");
  });

  it("rejects any field after a str field (test_reg5)", () => {
    expect(codeOf(() => parseSignature("abc str foo int bar"))).toBe("INVALID_SPEC");
  });

  it("accepts int, sym and str registrations (test_reg_int/sym/str)", () => {
    expect(parseSignature("test-reg-int int foo").fields).toEqual([
      { type: "int", name: "foo", optional: false },
    ]);
    expect(parseSignature("test-reg-sym sym bar").fields).toEqual([
      { type: "sym", name: "bar", optional: false },
    ]);
    expect(parseSignature("test-reg-str str baz").fields).toEqual([
      { type: "str", name: "baz", optional: false },
    ]);
  });
});

describe("parse/parser: blank and comment lines (parse.c test_blank..comment1)", () => {
  const lookup = table("x int i");

  /* parser.c:502-511 skips leading isspace(), then drops "" and '#'. */
  it("accepts an empty line (test_blank)", () => {
    expect(parseLine("", lookup)).toBeNull();
  });

  it("accepts a line of only spaces (test_spaces)", () => {
    expect(parseLine("   ", lookup)).toBeNull();
  });

  it("accepts a comment (test_comment0)", () => {
    expect(parseLine("# foo", lookup)).toBeNull();
  });

  it("accepts an indented comment (test_comment1)", () => {
    expect(parseLine("  # bar", lookup)).toBeNull();
  });
});

describe("parse/parser: syntax errors (parse.c test_syntax0..2, test_baddir)", () => {
  it("a missing str field is MISSING_FIELD (test_syntax0)", () => {
    const lookup = table("test-syntax0 str s0");
    expect(codeOf(() => parseLine("test-syntax0", lookup))).toBe("MISSING_FIELD");
  });

  it("a non-numeric int field is NOT_NUMBER (test_syntax1)", () => {
    const lookup = table("test-syntax1 int i0");
    expect(codeOf(() => parseLine("test-syntax1:a", lookup))).toBe("NOT_NUMBER");
  });

  it("strtok collapses the empty first field, so ::test hits int (test_syntax2)", () => {
    /* Upstream reports NOT_NUMBER, not MISSING_FIELD: strtok(_, ":") skips
     * the run of colons, so "test" is handed to the int field
     * (parser.c:221-353). */
    const lookup = table("test-syntax2 int i0 sym s1");
    expect(codeOf(() => parseLine("test-syntax2::test", lookup))).toBe("NOT_NUMBER");
  });

  it("an unregistered directive is UNDEFINED_DIRECTIVE (test_baddir)", () => {
    expect(codeOf(() => parseLine("test-baddir", table("other int i")))).toBe(
      "UNDEFINED_DIRECTIVE",
    );
  });
});

describe("parse/parser: sym, int, str fields (parse.c test_sym0..str0)", () => {
  it("reads one sym field (test_sym0)", () => {
    const lookup = table("test-sym0 sym foo");
    expect(parseLine("test-sym0:bar", lookup)?.values).toEqual({ foo: "bar" });
  });

  it("reads two sym fields (test_sym1)", () => {
    const lookup = table("test-sym1 sym foo sym baz");
    expect(parseLine("test-sym1:bar:quxx", lookup)?.values).toEqual({
      foo: "bar",
      baz: "quxx",
    });
  });

  it("reads two int fields (test_int0)", () => {
    const lookup = table("test-int0 int i0 int i1");
    expect(parseLine("test-int0:42:81", lookup)?.values).toEqual({ i0: 42, i1: 81 });
  });

  it("reads a negative int (test_int1)", () => {
    const lookup = table("test-int1 int i0");
    expect(parseLine("test-int1:-3", lookup)?.values).toEqual({ i0: -3 });
  });

  it("a str field takes the rest of the line, colons included (test_str0)", () => {
    const lookup = table("test-str0 str s0");
    expect(parseLine("test-str0:foo:bar:baz quxx...", lookup)?.values).toEqual({
      s0: "foo:bar:baz quxx...",
    });
  });
});

describe("parse/parser: optional fields (parse.c test_opt0)", () => {
  const lookup = table("test-opt0 sym s0 ?sym s1");

  it("an absent optional field is simply not present", () => {
    /* Upstream signals this through parser_hasval(); the port omits the
     * key from `values` (parser.c:558-566 breaks out of the field loop). */
    const parsed = parseLine("test-opt0:foo", lookup);
    expect(parsed?.values).toEqual({ s0: "foo" });
    expect("s1" in (parsed?.values ?? {})).toBe(false);
  });

  it("a present optional field is read", () => {
    expect(parseLine("test-opt0:foo:bar", lookup)?.values).toEqual({
      s0: "foo",
      s1: "bar",
    });
  });
});

describe("parse/parser: uint fields (parse.c test_uint0, test_uint1)", () => {
  const lookup = table("test-uint0 uint u0");

  it("reads a uint (test_uint0)", () => {
    expect(parseLine("test-uint0:42", lookup)?.values).toEqual({ u0: 42 });
  });

  it("rejects a leading '-' on a uint (test_uint1)", () => {
    /* parser.c only checks *tok == '-' before calling strtoul. */
    expect(codeOf(() => parseLine("test-uint0:-2", lookup))).toBe("NOT_NUMBER");
  });
});

describe("parse/parser: char fields (parse.c test_char0..char2)", () => {
  it("reads a single character and rejects two (test_char0)", () => {
    const lookup = table("test-char0 char c");
    expect(parseLine("test-char0:C", lookup)?.values).toEqual({ c: "C" });
    expect(codeOf(() => parseLine("test-char0:CC", lookup))).toBe("FIELD_TOO_LONG");
  });

  it("a char field may itself be a colon (test_char1)", () => {
    /* "test-char1:::34:::lala": c0 is ':', then the following ':' is the
     * separator; likewise for c1. parser.c:262-300 takes exactly one
     * character and then requires ':' or end of line. */
    const lookup = table("test-char1 char c0 int i0 char c1 str s");
    expect(parseLine("test-char1:::34:::lala", lookup)?.values).toEqual({
      c0: ":",
      i0: 34,
      c1: ":",
      s: "lala",
    });
  });

  it("a char field holds one non-ASCII code point, two is too long (test_char2)", () => {
    /* Upstream only runs this under a UTF-8 locale (and never on Windows);
     * the port is always UTF-16 so the case is unconditional. */
    const lookup = table("test-char2 char c int i");
    expect(parseLine("test-char2:£:3", lookup)?.values).toEqual({
      c: "£",
      i: 3,
    });
    expect(codeOf(() => parseLine("test-char2:££:3", lookup))).toBe(
      "FIELD_TOO_LONG",
    );
  });
});

describe("parse/parser: rand fields (parse.c test_rand0, test_rand1)", () => {
  const lookup = table("test-rand0 rand r0");

  /* Every form upstream's test_rand0 feeds parse_random(). The port stores
   * the raw string and only validates it here; the RandomValue components
   * upstream also asserts are evaluated in a later layer, which is where
   * the port diverges - see the "parse_random negation" gap in
   * parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-parse.md. */
  const accepted = [
    "2d3",
    "7",
    "d8",
    "M9",
    "3+d10",
    "6+M4",
    "d8M2",
    "4d6M3",
    "9+2d12",
    "7+d2M4",
    "5+3d20M1",
    "-10+4d8M2",
  ];

  it("accepts every form parse_random() accepts (test_rand0)", () => {
    for (const s of accepted) {
      expect(isValidRandom(s), s).toBe(true);
      expect(parseLine(`test-rand0:${s}`, lookup)?.values).toEqual({ r0: s });
    }
  });

  it("reads two rand fields in one line (test_rand1)", () => {
    const two = table("test-rand1 rand r0 rand r1");
    expect(parseLine("test-rand1:2d3:4d5", two)?.values).toEqual({
      r0: "2d3",
      r1: "4d5",
    });
  });
});

describe("parse/parser: malformed rand fields (parse.c test_rand_bad0)", () => {
  const lookup = table("test-rand-bad0 rand r0");

  /* The 20 rejected strings from test_rand_bad0, grouped by its own
   * comments. parse_random() is reference/src/parser.c:126-214. */
  const rejected: Array<readonly [string, string]> = [
    [" ", "empty strings are invalid"],
    ["a", "non-integers are invalid"],
    ["ad10", "non-integers are invalid"],
    ["8dc", "non-integers are invalid"],
    ["Ma", "non-integers are invalid"],
    ["829683929682968396829683928", "overflow of any component is invalid"],
    ["8+1924726926926829462782936363d1", "overflow of any component is invalid"],
    ["5d2938626926810682748296287296823962", "overflow of any component is invalid"],
    ["M728468357283683793784367389463839483373", "overflow of any component is invalid"],
    ["8-3d7M4", "a '-' anywhere but the front is invalid"],
    ["8+-3d4", "a '-' anywhere but the front is invalid"],
    ["8+7d-6", "a '-' anywhere but the front is invalid"],
    ["8+3d6M-1", "a '-' anywhere but the front is invalid"],
    ["8+4d", "missing values are invalid"],
    ["10+M", "missing values are invalid"],
    ["8dM1", "'d' or 'M' in the wrong place is invalid"],
    ["8M3", "'d' or 'M' in the wrong place is invalid"],
    ["8+Md3", "'d' or 'M' in the wrong place is invalid"],
    ["8+7d4M3+8", "too many values is invalid"],
  ];

  it.each(rejected)("rejects %j (%s)", (s) => {
    expect(isValidRandom(s)).toBe(false);
    expect(codeOf(() => parseLine(`test-rand-bad0:${s}`, lookup))).toBe("NOT_RANDOM");
  });

  it("covers every string upstream rejects", () => {
    /* test_rand_bad0 makes exactly 19 parser_parse() calls, all asserting
     * PARSE_ERROR_NOT_RANDOM, and no two of its literals are equal. */
    expect(new Set(rejected.map(([s]) => s)).size).toBe(19);
  });
});
