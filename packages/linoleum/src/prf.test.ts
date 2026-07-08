import { describe, expect, it } from "vitest";
import {
  parseLegacySelectorLine,
  readLegacySelectors,
  removeLegacyInlineComment,
} from "./prf.js";

describe("removeLegacyInlineComment", () => {
  it("strips whitespace-hash comments to end of line", () => {
    expect(removeLegacyInlineComment("feat:FLOOR:lit:0x80:0xA1  # floor tile")).toBe(
      "feat:FLOOR:lit:0x80:0xA1",
    );
  });

  it("leaves lines without inline comments alone", () => {
    expect(removeLegacyInlineComment("monster:Grip, Farmer Maggot's dog:0x8E:0x9D")).toBe(
      "monster:Grip, Farmer Maggot's dog:0x8E:0x9D",
    );
  });

  it("does not treat a hash without leading whitespace as a comment", () => {
    expect(removeLegacyInlineComment("feat:A#B:lit:0x80:0x81")).toBe("feat:A#B:lit:0x80:0x81");
  });
});

describe("parseLegacySelectorLine", () => {
  it("parses a stateful feat line (5 fields -> variant)", () => {
    const entry = parseLegacySelectorLine("feat:FLOOR:lit:0x80:0xA1", null, "graf-xxx.prf", 0);
    expect(entry).not.toBeNull();
    expect(entry?.type).toBe("feat");
    expect(entry?.logicalValue).toBe("FLOOR");
    expect(entry?.variant).toBe("lit");
    expect(entry?.exactSelectorValue).toBe("FLOOR:lit");
    expect(entry?.compatibilitySelectorValue).toBe("FLOOR");
    expect(entry?.row).toBe(0x80 & 0x7f);
    expect(entry?.column).toBe(0xa1 & 0x7f);
  });

  it("parses a 4-field feat line with implicit * variant", () => {
    const entry = parseLegacySelectorLine("feat:NONE:0x85:0xA0", null, "graf.prf", 0);
    expect(entry?.variant).toBe("*");
    expect(entry?.exactSelectorValue).toBe("NONE:*");
  });

  it("joins colon-bearing logical values for GF selectors", () => {
    const entry = parseLegacySelectorLine(
      "GF:DARK | DARK_WEAK | HOLY_ORB | MANA:0:0x84:0x98",
      null,
      "graf.prf",
      0,
    );
    expect(entry?.type).toBe("GF");
    expect(entry?.logicalValue).toBe("DARK | DARK_WEAK | HOLY_ORB | MANA:0");
    expect(entry?.exactSelectorValue).toBe("DARK | DARK_WEAK | HOLY_ORB | MANA:0");
  });

  it("appends :when:<query> for conditioned selectors", () => {
    const entry = parseLegacySelectorLine(
      "monster:<player>:0x8C:0x80",
      "[AND [EQU $CLASS Warrior] [EQU $RACE Human] ]",
      "xtra-xxx.prf",
      3,
    );
    expect(entry?.exactSelectorValue).toBe(
      "<player>:when:[AND [EQU $CLASS Warrior] [EQU $RACE Human] ]",
    );
    expect(entry?.compatibilitySelectorValue).toBe("<player>");
  });

  it("rejects lines whose trailing fields are not 0xNN hex bytes", () => {
    // Real line from old/graf-xxx.prf: decimal coordinates are not exported.
    expect(parseLegacySelectorLine("object:none:<pile>:131:159", null, "graf.prf", 0)).toBeNull();
  });

  it("rejects unknown selector types and short lines", () => {
    expect(parseLegacySelectorLine("wibble:FLOOR:0x80:0xA1", null, "f.prf", 0)).toBeNull();
    expect(parseLegacySelectorLine("feat:FLOOR:0x80", null, "f.prf", 0)).toBeNull();
  });

  it("masks row and column with 0x7F", () => {
    const entry = parseLegacySelectorLine("monster:Farmer Maggot:0x9B:0x8B", null, "g.prf", 0);
    expect(entry?.row).toBe(27);
    expect(entry?.column).toBe(11);
  });
});

describe("readLegacySelectors", () => {
  it("applies a ?: condition to the next selector line only", () => {
    const entries = readLegacySelectors([
      {
        name: "xtra.prf",
        lines: [
          "?:[EQU $CLASS Mage]",
          "monster:<player>:0x8C:0x8A",
          "monster:<player>:0x8C:0x8B",
        ],
      },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.condition).toBe("[EQU $CLASS Mage]");
    expect(entries[1]?.condition).toBeNull();
  });

  it("consumes the condition even when the next line fails to parse", () => {
    const entries = readLegacySelectors([
      {
        name: "xtra.prf",
        lines: ["?:[EQU $CLASS Mage]", "object:none:<pile>:131:159", "feat:FLOOR:0x80:0xA1"],
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.condition).toBeNull();
  });

  it("carries a pending condition across file boundaries like the ps1", () => {
    const entries = readLegacySelectors([
      { name: "a.prf", lines: ["?:[EQU $CLASS Mage]"] },
      { name: "b.prf", lines: ["feat:FLOOR:0x80:0xA1"] },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.condition).toBe("[EQU $CLASS Mage]");
    expect(entries[0]?.exactSelectorValue).toBe("FLOOR:*:when:[EQU $CLASS Mage]");
  });

  it("skips blank, comment, and %: include lines without consuming order", () => {
    const entries = readLegacySelectors([
      {
        name: "graf.prf",
        lines: ["# comment", "", "%:xtra-xxx.prf", "feat:FLOOR:0x80:0xA1"],
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceOrder).toBe(0);
  });

  it("increments source order for parse failures too", () => {
    const entries = readLegacySelectors([
      {
        name: "graf.prf",
        lines: ["object:none:<pile>:131:159", "feat:FLOOR:0x80:0xA1"],
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceOrder).toBe(1);
  });
});
