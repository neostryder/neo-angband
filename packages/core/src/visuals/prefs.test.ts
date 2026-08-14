import { readFileSync } from "node:fs";
import { objectShortName } from "../obj/bind.js";
import { describe, expect, it } from "vitest";

import { COLOUR_RED, colorCharToAttr } from "../color.js";
import { TV } from "../generated/index.js";
import { messageLookupByName } from "../sound/engine.js";
import { FEAT, PARSE_ERROR } from "../generated/index.js";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { GlyphTable } from "./glyph-table.js";
import {
  DUMP_SEPARATOR,
  dumpFeatures,
  dumpFlavors,
  dumpMonsters,
  dumpObjects,
  glyphTableSink,
  parsePrefNum,
  prefErrorMessage,
  prefFooter,
  prefHeader,
  prefsSave,
  processPrefText,
  removeOldDump,
} from "./prefs.js";
import type { PrefDeps, PrefsFileIO } from "./prefs.js";
import { LIGHTING } from "./tile-prefs.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: CorePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as CorePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  trap: loadRecords("trap"),
};

const reg = bindCore(pack);
const deps: PrefDeps = {
  features: reg.features,
  objects: reg.objects,
  monsters: reg.monsters,
  traps: reg.traps,
};

function table(): GlyphTable {
  return new GlyphTable({
    features: reg.features.allFeatures(),
    kinds: reg.objects.kinds,
    races: reg.monsters.races,
    traps: reg.traps,
    flavors: reg.objects.flavors,
  });
}

function dumpDeps(t: GlyphTable) {
  return {
    table: t,
    objects: reg.objects,
    features: reg.features,
    monsters: reg.monsters,
  };
}

describe("parsePrefNum (parser.c strtol base 0)", () => {
  it("reads hex, octal, decimal and signs", () => {
    expect(parsePrefNum("0x8A")).toBe(0x8a);
    expect(parsePrefNum("017")).toBe(15);
    expect(parsePrefNum("-12")).toBe(-12);
    expect(parsePrefNum(" 42 ")).toBe(42);
  });
  it("stops at the first unusable character instead of rejecting the token", () => {
    /* strtol's leniency (parser.c L315-320 errors only when `z == tok`), and it
     * is load-bearing: every `monster:<player>` line in shockbolt/xtra-shb.prf
     * ends with a trailing `#` comment, and requiring a clean token dropped all
     * 132 of them. */
    expect(parsePrefNum("12x")).toBe(12);
    expect(parsePrefNum("0x87 #  ")).toBe(0x87);
    /* "0x" with no hex digits is the leading 0, and "08" stops before the 8. */
    expect(parsePrefNum("0x")).toBe(0);
    expect(parsePrefNum("08")).toBe(0);
  });

  it("rejects a token with no number in it at all", () => {
    expect(parsePrefNum("")).toBeNull();
    expect(parsePrefNum("   ")).toBeNull();
    expect(parsePrefNum("red")).toBeNull();
    expect(parsePrefNum("-")).toBeNull();
  });
});

describe("processPrefText: the glyph directives write the GlyphTable", () => {
  it("monster: re-glyphs a race by name", () => {
    const t = table();
    const errors = processPrefText(
      "monster:filthy street urchin:0x04:0x5A",
      deps,
      glyphTableSink(t),
    );
    expect(errors).toEqual([]);
    const ridx = reg.monsters.raceByName("filthy street urchin")!.ridx;
    expect(t.monsterGlyph(ridx)).toEqual({ attr: 4, char: "Z" });
  });

  it("feat: with `*` lighting writes every variant", () => {
    const t = table();
    processPrefText("feat:FLOOR:*:4:37", deps, glyphTableSink(t));
    const fidx = FEAT["FLOOR"] as number;
    for (let j = 0; j < LIGHTING.MAX; j++) {
      expect(t.featGlyph(j, fidx)).toEqual({ attr: 4, char: "%" });
    }
  });

  it("feat: with one lighting keyword leaves the others alone", () => {
    const t = table();
    const fidx = FEAT["FLOOR"] as number;
    const before = t.featGlyph(LIGHTING.DARK, fidx)!;
    processPrefText("feat:FLOOR:los:4:37", deps, glyphTableSink(t));
    expect(t.featGlyph(LIGHTING.LOS, fidx)).toEqual({ attr: 4, char: "%" });
    expect(t.featGlyph(LIGHTING.DARK, fidx)).toEqual(before);
  });

  it("object:*:* writes every kind AND every flavour", () => {
    const t = table();
    processPrefText("object:*:*:4:63", deps, glyphTableSink(t));
    expect(t.kindGlyph(reg.objects.kinds[3]!.kidx)).toEqual({ attr: 4, char: "?" });
    expect(t.flavorGlyph(reg.objects.flavors[0]!.fidx)).toEqual({ attr: 4, char: "?" });
  });

  it("object: an unknown sval is silently accepted (the outdated-pref wart)", () => {
    const t = table();
    const errors = processPrefText(
      "object:potion:No Such Potion Of Nothing:4:33",
      deps,
      glyphTableSink(t),
    );
    expect(errors).toEqual([]);
  });

  it("object: an unknown tval IS reported", () => {
    const errors = processPrefText("object:frobnicator:x:4:33", deps, glyphTableSink(table()));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toBe(PARSE_ERROR.UNRECOGNISED_TVAL);
  });

  it("monster-base: re-glyphs every race sharing the base", () => {
    const t = table();
    const errors = processPrefText("monster-base:kobold:4:0x4B", deps, glyphTableSink(t));
    expect(errors).toEqual([]);
    const kobolds = reg.monsters.races.filter((r) => r.base.name === "kobold");
    expect(kobolds.length).toBeGreaterThan(1);
    for (const r of kobolds) {
      expect(t.monsterGlyph(r.ridx)).toEqual({ attr: 4, char: "K" });
    }
  });

  it("an invalid lighting keyword reports INVALID_LIGHTING with its line number", () => {
    const errors = processPrefText(
      "# comment\n\nfeat:FLOOR:gloomy:4:37",
      deps,
      glyphTableSink(table()),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      line: 3,
      col: 1,
      msg: "feat",
      error: PARSE_ERROR.INVALID_LIGHTING,
    });
  });

  it("print_error's text uses the generated parser_error_str, not a paraphrase", () => {
    const errors = processPrefText("feat:FLOOR:gloomy:4:37", deps, glyphTableSink(table()));
    expect(prefErrorMessage("user/Foo.prf", errors[0]!)).toBe(
      "Parse error in user/Foo.prf line 1 column 1: feat: invalid lighting",
    );
  });

  it("a non-numeric attr reports NOT_NUMBER", () => {
    const errors = processPrefText("monster:scrawny cat:red:0x63", deps, glyphTableSink(table()));
    expect(errors[0]!.error).toBe(PARSE_ERROR.NOT_NUMBER);
  });

  it("`?` bypasses every following directive until the next `?`", () => {
    const t = table();
    const fidx = FEAT["FLOOR"] as number;
    const before = t.featGlyph(LIGHTING.LOS, fidx)!;
    processPrefText(
      "?:[EQU $CLASS Mage]\nfeat:FLOOR:*:4:37\n?:1\nfeat:GRANITE:*:4:38",
      deps,
      glyphTableSink(t),
      { vars: { CLASS: "Ranger" } },
    );
    expect(t.featGlyph(LIGHTING.LOS, fidx)).toEqual(before);
    expect(t.featGlyph(LIGHTING.LOS, FEAT["GRANITE"] as number)).toEqual({
      attr: 4,
      char: "&",
    });
  });

  it("`%` pulls in another file through the sink's loadFile", () => {
    const t = table();
    processPrefText("%:more.prf", deps, {
      ...glyphTableSink(t),
      loadFile: (n) => (n === "more.prf" ? "monster:scrawny cat:4:0x66" : null),
    });
    const ridx = reg.monsters.raceByName("scrawny cat")!.ridx;
    expect(t.monsterGlyph(ridx)).toEqual({ attr: 4, char: "f" });
  });

  it("the optional sink halves receive inscribe / color / message lines", () => {
    const seen: string[] = [];
    processPrefText(
      "inscribe:potion:Cure Light Wounds:@q1\ncolor:5:0:10:20:30\nmessage:HIT:r",
      deps,
      {
        ...glyphTableSink(table()),
        addAutoinscription: (kidx, text) => seen.push(`inscribe ${kidx} ${text}`),
        colorTable: (i, k, r, g, b) => seen.push(`color ${i} ${k} ${r} ${g} ${b}`),
        messageColor: (i, a) => seen.push(`message ${i} ${a}`),
      },
    );
    const clw = reg.objects.lookupKind(
      TV.POTION,
      reg.objects.lookupSval(TV.POTION, "Cure Light Wounds"),
    )!;
    expect(seen).toEqual([
      `inscribe ${clw.kidx} @q1`,
      "color 5 0 10 20 30",
      `message ${messageLookupByName("HIT")} ${COLOUR_RED}`,
    ]);
  });
});

describe("the dump writers (ui-prefs.c L178-386)", () => {
  it("dump_monsters writes 0x%02X for both fields", () => {
    const t = table();
    const line = dumpMonsters(dumpDeps(t)).split("\n")[0]!;
    const race0 = reg.monsters.races[0]!;
    const g = t.monsterGlyph(0)!;
    expect(line).toBe(
      `monster:${race0.name}:0x${g.attr.toString(16).toUpperCase().padStart(2, "0")}:0x${(
        g.char.codePointAt(0) ?? 0
      )
        .toString(16)
        .toUpperCase()
        .padStart(2, "0")}`,
    );
  });

  it("dump_objects leads with its `# Objects` header and strips `& ` / `~`", () => {
    const out = dumpObjects(dumpDeps(table()));
    expect(out.startsWith("# Objects\n")).toBe(true);
    expect(out).not.toMatch(/object:[^:]+:& /);
    expect(out).not.toMatch(/object:[^:]+:[^:]*~/);
  });

  it("dump_features names the terrain CODE and writes all four lighting rows", () => {
    const out = dumpFeatures(dumpDeps(table()));
    const floor = reg.features.get(FEAT["FLOOR"] as number);
    const attr = colorCharToAttr(floor.dAttr);
    const chr = floor.dChar.codePointAt(0);
    expect(out).toContain(`# Terrain: ${floor.name}\n`);
    expect(out).toContain(`feat:FLOOR:torch:${attr}:${chr}\n`);
    expect(out).toContain(`feat:FLOOR:los:${attr}:${chr}\n`);
    expect(out).toContain(`feat:FLOOR:lit:${attr}:${chr}\n`);
    expect(out).toContain(`feat:FLOOR:dark:${attr}:${chr}\n`);
  });

  it("dump_features skips mimics, as L250-251 does", () => {
    const out = dumpFeatures(dumpDeps(table()));
    for (const f of reg.features.allFeatures()) {
      if (f.mimic !== null) expect(out).not.toContain(`feat:${f.code}:`);
    }
  });

  it("dump_flavors puts a blank line after every entry", () => {
    const out = dumpFlavors(dumpDeps(table()));
    const f0 = reg.objects.flavors[0]!;
    expect(out).toContain(`# Item flavor: ${f0.text}\n`);
    expect(out).toMatch(new RegExp(`flavor:${f0.fidx}:\\d+:\\d+\\n\\n`));
  });

  it("a dump round-trips through the parser back into the same table", () => {
    const t = table();
    /* Change one glyph, dump, reset, re-parse: the change must come back. */
    const ridx = reg.monsters.raceByName("scrawny cat")!.ridx;
    t.setMonsterGlyph(ridx, { attr: 4, char: "Z" });
    const text = dumpMonsters(dumpDeps(t));
    t.reset();
    expect(t.monsterGlyph(ridx)!.char).not.toBe("Z");
    processPrefText(text, deps, glyphTableSink(t));
    expect(t.monsterGlyph(ridx)).toEqual({ attr: 4, char: "Z" });
  });

  it("objectShortName matches the C's & / ~ stripping", () => {
    expect(objectShortName("& Dagger~")).toBe("Dagger");
    expect(objectShortName("Potion~ of Cure Light Wounds")).toBe(
      "Potion of Cure Light Wounds",
    );
  });
});

describe("prefs_save / remove_old_dump (ui-prefs.c L75-146, L391-421)", () => {
  function fakeIO(initial: Record<string, string> = {}): PrefsFileIO & {
    files: Record<string, string>;
    failWrite?: boolean;
  } {
    const files: Record<string, string> = { ...initial };
    const io = {
      files,
      failWrite: false,
      read: (path: string): string | null => files[path] ?? null,
      write: (path: string, text: string): boolean => {
        if (io.failWrite) return false;
        files[path] = text;
        return true;
      },
    };
    return io;
  }

  it("writes header, body and footer around the marker pair", () => {
    const io = fakeIO();
    expect(prefsSave(io, "Foo.prf", () => "monster:x:1:2\n", "Save monster attr/chars")).toBe(
      true,
    );
    const out = io.files["Foo.prf"]!;
    expect(out).toContain(`${DUMP_SEPARATOR} begin Save monster attr/chars\n`);
    expect(out).toContain("monster:x:1:2\n");
    expect(out).toContain(`${DUMP_SEPARATOR} end Save monster attr/chars\n`);
  });

  it("APPENDS to a file that has no dump with this title", () => {
    const io = fakeIO({ "Foo.prf": "# hand written\nmonster:kept:1:2\n" });
    prefsSave(io, "Foo.prf", () => "monster:new:3:4\n", "T");
    expect(io.files["Foo.prf"]).toContain("# hand written");
    expect(io.files["Foo.prf"]).toContain("monster:kept:1:2");
    expect(io.files["Foo.prf"]).toContain("monster:new:3:4");
  });

  it("REPLACES a previous dump with the same title and keeps the rest", () => {
    const io = fakeIO();
    prefsSave(io, "Foo.prf", () => "monster:old:1:2\n", "T");
    io.files["Foo.prf"] = `# keep me\n${io.files["Foo.prf"]!}`;
    prefsSave(io, "Foo.prf", () => "monster:new:3:4\n", "T");
    const out = io.files["Foo.prf"]!;
    expect(out).toContain("# keep me");
    expect(out).not.toContain("monster:old:1:2");
    expect(out).toContain("monster:new:3:4");
    /* Exactly one marker pair survives. */
    expect(out.split(`${DUMP_SEPARATOR} begin T`)).toHaveLength(2);
  });

  it("leaves another title's dump untouched", () => {
    const io = fakeIO();
    prefsSave(io, "Foo.prf", () => "monster:a:1:2\n", "A");
    prefsSave(io, "Foo.prf", () => "monster:b:3:4\n", "B");
    prefsSave(io, "Foo.prf", () => "monster:a2:5:6\n", "A");
    const out = io.files["Foo.prf"]!;
    expect(out).toContain("monster:b:3:4");
    expect(out).toContain("monster:a2:5:6");
    expect(out).not.toContain("monster:a:1:2");
  });

  it("returns false when the file cannot be written (drives 'Failed to save %s.')", () => {
    const io = fakeIO();
    io.failWrite = true;
    expect(prefsSave(io, "Foo.prf", () => "x\n", "T")).toBe(false);
  });

  it("removeOldDump returns null when there is no marker pair to strip", () => {
    expect(removeOldDump("# nothing here\n", "T")).toBeNull();
  });

  it("removeOldDump drops the end marker too, not just the body", () => {
    const text = `a\n${prefHeader("T")}body\n${prefFooter("T")}b\n`;
    const out = removeOldDump(text, "T")!;
    expect(out).toBe("a\nb\n");
  });
});
