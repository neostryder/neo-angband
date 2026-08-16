import { describe, expect, it } from "vitest";

import { ParseError, isValidRandom, parseLine, parseSignature } from "./parser.js";
import type { DirectiveSignature } from "./parser.js";

function table(...fmts: string[]): (directive: string) => DirectiveSignature | undefined {
  const map = new Map<string, DirectiveSignature>();
  for (const fmt of fmts) {
    const sig = parseSignature(fmt);
    map.set(sig.directive, sig);
  }
  return (d) => map.get(d);
}

describe("parseSignature", () => {
  it("parses a plain signature", () => {
    const sig = parseSignature("info int level int rarity");
    expect(sig.directive).toBe("info");
    expect(sig.fields).toEqual([
      { type: "int", name: "level", optional: false },
      { type: "int", name: "rarity", optional: false },
    ]);
  });

  it("parses optional fields marked with ?", () => {
    const sig = parseSignature("effect sym eff ?sym type ?int radius ?int other");
    expect(sig.fields.map((f) => f.optional)).toEqual([false, true, true, true]);
  });

  it("allows a directive with no fields", () => {
    expect(parseSignature("name").fields).toEqual([]);
  });

  it("rejects a mandatory field after an optional one", () => {
    expect(() => parseSignature("x ?int a int b")).toThrow(ParseError);
  });

  it("rejects any field after a str field", () => {
    expect(() => parseSignature("x str a int b")).toThrow(ParseError);
  });

  it("rejects unknown field types", () => {
    expect(() => parseSignature("x bogus a")).toThrow(ParseError);
  });
});

describe("parseLine", () => {
  const lookup = table(
    "name str name",
    "info int level int rarity",
    "spell-power uint power",
    "graphics char glyph sym color",
    "blow sym method ?sym effect ?rand damage",
    "values str values",
    "pair sym a sym b",
  );

  it("ignores blank lines and comments", () => {
    expect(parseLine("", lookup)).toBeNull();
    expect(parseLine("   \t ", lookup)).toBeNull();
    expect(parseLine("# a comment", lookup)).toBeNull();
    expect(parseLine("   # indented comment", lookup)).toBeNull();
  });

  it("parses int and uint fields", () => {
    expect(parseLine("info:5:10", lookup)?.values).toEqual({ level: 5, rarity: 10 });
    expect(parseLine("info:-3:0", lookup)?.values).toEqual({ level: -3, rarity: 0 });
    expect(parseLine("spell-power:20", lookup)?.values).toEqual({ power: 20 });
  });

  it("accepts strtol base-0 prefixes for numbers", () => {
    expect(parseLine("info:0x10:010", lookup)?.values).toEqual({ level: 16, rarity: 8 });
  });

  it("rejects a negative uint", () => {
    expect(() => parseLine("spell-power:-1", lookup)).toThrow(ParseError);
  });

  it("rejects a non-numeric int", () => {
    expect(() => parseLine("info:abc:1", lookup)).toThrow(ParseError);
  });

  it("str fields take the rest of the line, colons included", () => {
    const parsed = parseLine("name:Morgoth, Lord of Darkness: the Enemy", lookup);
    expect(parsed?.values["name"]).toBe("Morgoth, Lord of Darkness: the Enemy");
  });

  it("str fields keep leading and trailing spaces", () => {
    expect(parseLine("values:  padded  ", lookup)?.values["values"]).toBe("  padded  ");
  });

  it("char fields may hold a space, then a colon separator follows", () => {
    const parsed = parseLine("graphics: :w", lookup);
    expect(parsed?.values).toEqual({ glyph: " ", color: "w" });
  });

  it("char fields may hold a regular glyph", () => {
    expect(parseLine("graphics:.:w", lookup)?.values).toEqual({ glyph: ".", color: "w" });
  });

  it("char fields reject multi-character tokens", () => {
    expect(() => parseLine("graphics:ab:w", lookup)).toThrow(ParseError);
  });

  it("optional trailing fields may be absent", () => {
    expect(parseLine("blow:HIT", lookup)?.values).toEqual({ method: "HIT" });
    expect(parseLine("blow:HIT:HURT", lookup)?.values).toEqual({
      method: "HIT",
      effect: "HURT",
    });
  });

  it("rand fields keep the raw dice string without evaluating it", () => {
    const parsed = parseLine("blow:HIT:HURT:1+2d3M4", lookup);
    expect(parsed?.values["damage"]).toBe("1+2d3M4");
  });

  it("rejects malformed dice strings", () => {
    expect(() => parseLine("blow:HIT:HURT:2x6", lookup)).toThrow(ParseError);
  });

  it("throws on undefined directives", () => {
    expect(() => parseLine("bogus:1", lookup)).toThrow(ParseError);
  });

  it("throws on a missing mandatory field", () => {
    expect(() => parseLine("info:5", lookup)).toThrow(ParseError);
  });

  it("collapses consecutive colons for tokenized fields (strtok semantics)", () => {
    expect(parseLine("pair:x::y", lookup)?.values).toEqual({ a: "x", b: "y" });
  });

  it("tokenized fields may contain spaces", () => {
    expect(parseLine("pair:no trap:light umber", lookup)?.values).toEqual({
      a: "no trap",
      b: "light umber",
    });
  });
});

describe("isValidRandom", () => {
  it("accepts the upstream forms", () => {
    for (const s of ["0", "5", "-1", "1d5", "d4", "2d10", "1+2d3", "1+2d3M4", "M4", "2d3M4"]) {
      expect(isValidRandom(s), s).toBe(true);
    }
  });

  it("rejects malformed forms", () => {
    /* "3M10" is rejected upstream too: after a bare base value only
     * whitespace may follow; an m_bonus needs a "+" or dice first.
     * (Degenerate forms like "1dd5" are accepted upstream, so they are
     * accepted here as well.) */
    for (const s of ["", "x", "1d", "1+", "1+2+3", "1d2d3", "3M10", "1 2", "+5"]) {
      expect(isValidRandom(s), s).toBe(false);
    }
  });
});
