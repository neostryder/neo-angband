import { readFileSync } from "node:fs";
import { objectShortName } from "../obj/bind.js";
import { afterEach, describe, expect, it } from "vitest";

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
  prefErrorPolicy,
  prefsSave,
  processPrefText,
  removeOldDump,
  setPrefErrorPolicy,
  UPSTREAM_PREF_ERROR_POLICY,
} from "./prefs.js";
import type { PrefDeps, PrefSink, PrefsFileIO } from "./prefs.js";
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

/**
 * #272: the read loop's answer to a bad line, and the seam a mod moves it with.
 *
 * The port used to carry a 20-error cap (`PARSE_ERROR_LIMIT`) with an
 * environment override. There is no such thing in 4.2.6 - it stops at the FIRST
 * bad line - so the cap was an extension and it moved to the `qol` mod.
 */
describe("a bad line stops the file (ui-prefs.c L1225-1231)", () => {
  afterEach(() => setPrefErrorPolicy(null));

  /** A good line, a comment, a BAD line, then two more of each. */
  const TEXT = [
    "monster:scrawny cat:4:0x66",
    "# a comment",
    "feat:FLOOR:gloomy:4:37",
    "feat:GRANITE:*:4:38",
    "object:frobnicator:x:4:33",
  ].join("\n");

  const granite = FEAT["GRANITE"] as number;
  const cat = () => reg.monsters.raceByName("scrawny cat")!.ridx;

  it("core's default: nothing after line 3 is applied, and ONE error is reported", () => {
    const t = table();
    const untouched = t.featGlyph(LIGHTING.LOS, granite)!;
    const errors = processPrefText(TEXT, deps, glyphTableSink(t));

    /* print_error runs once and the `while` breaks (L1228). */
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      line: 3,
      col: 1,
      msg: "feat",
      error: PARSE_ERROR.INVALID_LIGHTING,
    });
    /* Line 1 was read before the bad one, so it stands... */
    expect(t.monsterGlyph(cat())).toEqual({ attr: 4, char: "f" });
    /* ...and line 4 was never read at all. THIS is the behaviour, not the count:
     * the loop breaks out of the file rather than merely stopping the report. */
    expect(t.featGlyph(LIGHTING.LOS, granite)).toEqual(untouched);
  });

  it("the default policy is 4.2.6's, and nothing has to install it", () => {
    expect(prefErrorPolicy()).toEqual(UPSTREAM_PREF_ERROR_POLICY);
    expect(UPSTREAM_PREF_ERROR_POLICY).toEqual({
      continueAfterError: false,
      reportLimit: 0,
    });
  });

  it("the mod seam restores the forgiving behaviour: every line applied, every error kept", () => {
    setPrefErrorPolicy({ continueAfterError: true, reportLimit: 0 });
    const t = table();
    const errors = processPrefText(TEXT, deps, glyphTableSink(t));

    expect(errors.map((e) => e.line)).toEqual([3, 5]);
    expect(t.monsterGlyph(cat())).toEqual({ attr: 4, char: "f" });
    expect(t.featGlyph(LIGHTING.LOS, granite)).toEqual({ attr: 4, char: "&" });
  });

  it("reportLimit caps the REPORT and never the file - the two axes are separate", () => {
    setPrefErrorPolicy({ continueAfterError: true, reportLimit: 1 });
    const t = table();
    const errors = processPrefText(TEXT, deps, glyphTableSink(t));

    /* One error collected, because that is all the player asked to be told... */
    expect(errors.map((e) => e.line)).toEqual([3]);
    /* ...and line 4 STILL applied, which is the whole difference from the cap
     * this replaced: `errorLimit: 1` would have thrown the rest of the file
     * away. */
    expect(t.featGlyph(LIGHTING.LOS, granite)).toEqual({ attr: 4, char: "&" });
  });

  it("setPrefErrorPolicy(null) puts core back on upstream's, mid-process", () => {
    setPrefErrorPolicy({ continueAfterError: true, reportLimit: 0 });
    expect(processPrefText(TEXT, deps, glyphTableSink(table()))).toHaveLength(2);
    setPrefErrorPolicy(null);
    expect(processPrefText(TEXT, deps, glyphTableSink(table()))).toHaveLength(1);
  });

  it("a per-call errorPolicy overrides whatever is installed", () => {
    setPrefErrorPolicy({ continueAfterError: true, reportLimit: 0 });
    const errors = processPrefText(TEXT, deps, glyphTableSink(table()), {
      errorPolicy: UPSTREAM_PREF_ERROR_POLICY,
    });
    expect(errors).toHaveLength(1);
  });

  it("a bad line in a `%` include does NOT stop the including file", () => {
    /* parse_prefs_load (ui-prefs.c L428-440) throws the nested result away -
     * `(void) process_pref_file(file, true, d->user)` - and returns
     * PARSE_ERROR_NONE regardless, so the outer `while` never sees a failure. */
    const t = table();
    const errors = processPrefText(
      "%:bad.prf\nfeat:GRANITE:*:4:38",
      deps,
      {
        ...glyphTableSink(t),
        loadFile: (n) =>
          n === "bad.prf"
            ? "monster:scrawny cat:4:0x66\nfeat:FLOOR:gloomy:4:37\nobject:frobnicator:x:4:33"
            : null,
      },
    );

    /* The nested file stopped itself at ITS first bad line (its line 2), so its
     * line 3 never ran - one error, carried up only so the caller can print it. */
    expect(errors.map((e) => e.line)).toEqual([2]);
    expect(t.monsterGlyph(cat())).toEqual({ attr: 4, char: "f" });
    /* And the OUTER file carried on past the `%`. */
    expect(t.featGlyph(LIGHTING.LOS, granite)).toEqual({ attr: 4, char: "&" });
  });

  it("every bundled tileset pref still parses clean, so no pack is truncated", () => {
    /* The stop is only invisible while nothing trips it. reset_visuals(true)
     * loads a graf file through this same loop (ui-prefs.c L1411), so one
     * unresolvable line would now cost a pack everything below it. */
    for (const rel of BUNDLED_TILE_PREFS) {
      const text = readFileSync(
        new URL(`../../../../reference/lib/tiles/${rel}`, import.meta.url),
        "utf8",
      );
      const errors = processPrefText(text, deps, glyphTableSink(table()), {
        vars: { RACE: "Hobbit", CLASS: "Ranger" },
      });
      expect(errors, `${rel} parses clean`).toEqual([]);
    }
  });
});

/**
 * #275: an error raised inside a `%:` include is MARKED as such, so the caller
 * can do the two things upstream does with it and no more.
 *
 * `parse_prefs_load` (ui-prefs.c L429-441) is the whole argument:
 *
 *     file = parser_getstr(p, "file");
 *     (void)process_pref_file(file, true, d->user);
 *     return PARSE_ERROR_NONE;
 *
 * The cast to `void` IS the statement - the nested read's bool is discarded -
 * and `process_pref_file_named`'s own `return e == PARSE_ERROR_NONE`
 * (ui-prefs.c L1240) therefore reflects that file's OWN lines only. Meanwhile
 * the nested invocation has already run `print_error(path, p)` (L1228) with
 * ITS path, so the message the player sees names the included file.
 *
 * The port collected nested errors into the includer's array with nothing to
 * tell them apart, so the web layer's `errors.length === 0` failed the outer
 * file and its `prefErrorMessage(<outer path>, e)` named the wrong file. One
 * marker answers both, WITHOUT discarding the error - upstream still prints it.
 */
describe("a `%` include's errors are marked, not merged (ui-prefs.c L429-441)", () => {
  const granite = FEAT["GRANITE"] as number;

  /** A sink whose `%` include resolves out of a small map of files. */
  function sinkOver(t: GlyphTable, files: Readonly<Record<string, string>>): PrefSink {
    return { ...glyphTableSink(t), loadFile: (n) => files[n] ?? null };
  }

  it("names the INCLUDED file, not the includer", () => {
    const errors = processPrefText(
      "%:bad.prf\nfeat:GRANITE:*:4:38",
      deps,
      sinkOver(table(), { "bad.prf": "feat:FLOOR:gloomy:4:37" }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.fromInclude).toBe("bad.prf");
    /* print_error names the path the nested process_pref_file_named was given. */
    expect(prefErrorMessage("outer.prf", errors[0]!)).toBe(
      "Parse error in bad.prf line 1 column 1: feat: invalid lighting",
    );
  });

  it("is still COLLECTED - the marker changes propagation, never the report", () => {
    /* The easy way to fix the return value is to drop the error, and upstream
     * does not: the nested print_error has already put it on the message line. */
    const errors = processPrefText(
      "%:bad.prf",
      deps,
      sinkOver(table(), { "bad.prf": "feat:FLOOR:gloomy:4:37" }),
    );
    expect(errors.map((e) => ({ line: e.line, msg: e.msg, error: e.error }))).toEqual([
      { line: 1, msg: "feat", error: PARSE_ERROR.INVALID_LIGHTING },
    ]);
  });

  it("leaves a file's OWN error unmarked, so it still fails and still stops", () => {
    const t = table();
    const untouched = t.featGlyph(LIGHTING.LOS, granite)!;
    const errors = processPrefText(
      "feat:FLOOR:gloomy:4:37\nfeat:GRANITE:*:4:38",
      deps,
      sinkOver(t, {}),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.fromInclude).toBeUndefined();
    /* ui-prefs.c L1229's `break`: line 2 was never read. */
    expect(t.featGlyph(LIGHTING.LOS, granite)).toEqual(untouched);
  });

  it("two deep names the INNERMOST file, and the outer file still finishes", () => {
    /* Each level runs its own process_pref_file, so the print_error that fires
     * is the innermost one's. A marker applied on the way out would relabel it
     * with whichever include the error passed through last. */
    const t = table();
    const errors = processPrefText(
      "%:mid.prf\nfeat:GRANITE:*:4:38",
      deps,
      sinkOver(t, {
        "mid.prf": "%:inner.prf\nmonster:scrawny cat:4:0x66",
        "inner.prf": "feat:FLOOR:gloomy:4:37",
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.fromInclude).toBe("inner.prf");
    /* mid.prf was not stopped by inner.prf's error... */
    expect(t.monsterGlyph(reg.monsters.raceByName("scrawny cat")!.ridx)).toEqual({
      attr: 4,
      char: "f",
    });
    /* ...and neither was the outer file. */
    expect(t.featGlyph(LIGHTING.LOS, granite)).toEqual({ attr: 4, char: "&" });
  });

  it("marks each error with the file it came from when two includes both fail", () => {
    /* No policy needed: the `%` branch never reaches the stop, so a failing
     * include does not end the includer and the second one still runs. */
    const errors = processPrefText(
      "%:a.prf\n%:b.prf",
      deps,
      sinkOver(table(), {
        "a.prf": "feat:FLOOR:gloomy:4:37",
        "b.prf": "monster:no such monster:4:0x66",
      }),
    );
    expect(errors.map((e) => e.fromInclude)).toEqual(["a.prf", "b.prf"]);
  });
});

/** Every `.prf` under reference/lib/tiles, the files reset_visuals(true) reads. */
const BUNDLED_TILE_PREFS = [
  "adam-bolt/flvr-new.prf",
  "adam-bolt/graf-new.prf",
  "adam-bolt/xtra-new.prf",
  "gervais/flvr-dvg.prf",
  "gervais/graf-dvg.prf",
  "gervais/xtra-dvg.prf",
  "nomad/flvr-nmd.prf",
  "nomad/graf-nmd.prf",
  "nomad/xtra-nmd.prf",
  "old/flvr-xxx.prf",
  "old/graf-xxx.prf",
  "old/xtra-xxx.prf",
  "shockbolt/flvr-shb.prf",
  "shockbolt/graf-shb-dark.prf",
  "shockbolt/graf-shb-light.prf",
  "shockbolt/xtra-shb.prf",
] as const;

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
