import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compileGamedata } from "./records.js";
import type { FileSpec } from "./records.js";
import { uiEntrySpec, uiEntryBaseSpec } from "./specs/ui-entry.js";

const effectSpec: FileSpec = {
  name: "synthetic",
  upstream: ["src/none.c"],
  recordStart: "name",
  directives: [
    { fmt: "name str name" },
    { fmt: "level int level" },
    { fmt: "flags str flags", repeat: true },
    { fmt: "effect sym eff ?sym type", repeat: true },
    { fmt: "dice str dice", childOf: ["effect"] },
    { fmt: "expr sym name sym base str expr", childOf: ["effect"], repeat: true },
  ],
};

describe("compileGamedata", () => {
  it("splits records at the record-start directive", () => {
    const out = compileGamedata("name:first\nlevel:1\n\nname:second\nlevel:2\n", effectSpec);
    expect(out.records).toHaveLength(2);
    expect(out.records[0]).toEqual({ name: "first", level: 1 });
    expect(out.records[1]).toEqual({ name: "second", level: 2 });
  });

  it("skips comments and blank lines", () => {
    const out = compileGamedata("# header comment\n\nname:x\n# inner\nlevel:3\n", effectSpec);
    expect(out.records).toEqual([{ name: "x", level: 3 }]);
  });

  it("accumulates repeated directives into arrays in file order", () => {
    const out = compileGamedata("name:x\nflags:A | B\nflags:C\n", effectSpec);
    expect(out.records[0]).toEqual({ name: "x", flags: ["A | B", "C"] });
  });

  it("attaches childOf directives to the most recent parent instance", () => {
    const text = [
      "name:potion",
      "effect:HEAL_HP",
      "dice:20+4d8",
      "effect:CURE:CONFUSED",
      "expr:D:PLAYER_LEVEL:- 1 / 5 + 3",
    ].join("\n");
    const out = compileGamedata(text, effectSpec);
    expect(out.records[0]).toEqual({
      name: "potion",
      effect: [
        { eff: "HEAL_HP", dice: "20+4d8" },
        {
          eff: "CURE",
          type: "CONFUSED",
          expr: [{ name: "D", base: "PLAYER_LEVEL", expr: "- 1 / 5 + 3" }],
        },
      ],
    });
  });

  it("attaches childOf directives to the record when no parent exists yet", () => {
    const spec: FileSpec = {
      name: "synthetic",
      upstream: ["src/none.c"],
      recordStart: "name",
      directives: [
        { fmt: "name str name" },
        { fmt: "power-cutoff int power", repeat: true },
        { fmt: "lore str text", childOf: ["power-cutoff"], repeat: true },
      ],
    };
    const text = "name:spell\nlore:base lore\npower-cutoff:20\nlore:strong lore\n";
    const out = compileGamedata(text, spec);
    expect(out.records[0]).toEqual({
      name: "spell",
      lore: ["base lore"],
      "power-cutoff": [{ power: 20, lore: ["strong lore"] }],
    });
  });

  it("emits keys in spec order regardless of encounter order", () => {
    const out = compileGamedata("name:x\nflags:F\nlevel:9\n", effectSpec);
    expect(Object.keys(out.records[0] ?? {})).toEqual(["name", "level", "flags"]);
  });

  it("collects header directives seen before the first record", () => {
    const spec: FileSpec = {
      name: "synthetic",
      upstream: ["src/none.c"],
      recordStart: "name",
      header: ["default"],
      directives: [
        { fmt: "default sym label int value", repeat: true },
        { fmt: "name str name" },
      ],
    };
    const out = compileGamedata("default:max-stack:40\nname:x\n", spec);
    expect(out.header).toEqual({ default: [{ label: "max-stack", value: 40 }] });
    expect(out.records).toEqual([{ name: "x" }]);
  });

  it("compiles singleton files into exactly one record", () => {
    const spec: FileSpec = {
      name: "synthetic",
      upstream: ["src/none.c"],
      recordStart: null,
      directives: [{ fmt: "player sym label int value", repeat: true }],
    };
    const out = compileGamedata("player:max-sight:20\nplayer:max-range:20\n", spec);
    expect(out.records).toEqual([
      { player: [{ label: "max-sight", value: 20 }, { label: "max-range", value: 20 }] },
    ]);
  });

  it("lets ordinary repeated directives overwrite with the final value", () => {
    // parse_world_level in reference/src/init.c:1094-1107 assigns the parsed
    // values and returns PARSE_ERROR_NONE; it does not reject a repeated line.
    const out = compileGamedata("name:x\nlevel:1\nlevel:2\n", effectSpec);
    expect(out.records).toEqual([{ name: "x", level: 2 }]);
  });

  it("throws on directives appearing before the first record", () => {
    expect(() => compileGamedata("level:1\n", effectSpec)).toThrow(/before first record/);
  });

  it("throws on undefined directives, naming file and line", () => {
    expect(() => compileGamedata("name:x\nbogus:1\n", effectSpec)).toThrow(
      /synthetic\.txt:2.*UNDEFINED_DIRECTIVE/,
    );
  });

  it("records file and source provenance", () => {
    const out = compileGamedata("name:x\n", effectSpec);
    expect(out.file).toBe("synthetic");
    expect(out.source).toBe("lib/gamedata/synthetic.txt");
  });
});

/**
 * PORT_TODO 3.25: ui_entry's `category` and `priority` are ordered with respect
 * to each other. parse_entry_priority (ui-entry.c:2173) branches on
 * `last_category_index == -1`: a priority BEFORE any category is the record's
 * default, and one AFTER a category overrides that category's own.
 *
 * The spec used to make `priority` a record scalar, which threw the ordering
 * away. Nothing in the shipped ui_entry.txt / ui_entry_base.txt uses the second
 * form - measured, both files have ZERO priority-after-category lines - so
 * these records are CONSTRUCTED. A test that only read the shipped files could
 * not tell the two specs apart.
 */
describe("ui_entry priority attaches to the preceding category", () => {
  it("a leading priority is the record default; a following one is that category's", () => {
    const out = compileGamedata(
      [
        "name:leading",
        "priority:7",
        "category:alpha",
        "category:beta",
        "",
        "name:following",
        "category:alpha",
        "priority:7",
        "category:beta",
        "",
      ].join("\n"),
      uiEntrySpec,
    );
    expect(out.records[0]).toEqual({
      name: "leading",
      priority: "7",
      category: [{ category: "alpha" }, { category: "beta" }],
    });
    /* The 7 belongs to alpha alone. beta, declared after it, gets nothing - and
     * the record has no default priority at all. */
    expect(out.records[1]).toEqual({
      name: "following",
      category: [{ category: "alpha", priority: "7" }, { category: "beta" }],
    });
  });

  it("a second priority under the same category replaces the first", () => {
    /* parse_entry_priority assigns, it does not accumulate (:2216-2220). */
    const out = compileGamedata(
      ["name:x", "category:alpha", "priority:1", "priority:2", ""].join("\n"),
      uiEntrySpec,
    );
    expect(out.records[0]).toEqual({
      name: "x",
      category: [{ category: "alpha", priority: "2" }],
    });
  });

  it("every shipped record still compiles to a bare default priority", () => {
    /* The guard on the claim that this changes nothing the game shows: if any
     * shipped record grew a per-category priority, the ledger note and the row
     * would both be wrong. */
    for (const file of ["ui_entry", "ui_entry_base"]) {
      const text = readFileSync(
        new URL(`../../../reference/lib/gamedata/${file}.txt`, import.meta.url),
        "utf8",
      );
      const out = compileGamedata(text, file === "ui_entry" ? uiEntrySpec : uiEntryBaseSpec);
      for (const rec of out.records) {
        const cats = rec["category"];
        if (!Array.isArray(cats)) continue;
        for (const c of cats) {
          expect(c, `${String(rec["name"])} has a per-category priority`).not.toHaveProperty(
            "priority",
          );
        }
      }
    }
  });
});
