/**
 * Line-grammar and record-assembly semantics pinned against five upstream
 * parse/ unit tests: class (c-info.c), monster (r-info.c), player_timed
 * (ptimed.c), object (k-info.c) and trap (partrap.c).
 *
 * The port splits each upstream parse handler in two. `compileGamedata`
 * (records.ts) + `parseLine` (parser.ts) do the half upstream does in
 * parser.c plus the field-splitting/attachment half of the handler bodies;
 * the name->enum resolution, range checks and cross-record lookups the same
 * handlers do inline land in the core binders. This file is the FIRST half:
 * every assertion here is about the shape of the compiled record. The second
 * half is packages/core/src/monclass.upstream.test.ts, which names the same
 * upstream cases where the substantive assertion is semantic.
 *
 * Every spec used here is the real shipped FileSpec from ./specs, so these
 * pin production metadata rather than a fixture.
 *
 * Cases from these five files that this port lane adjudicated as GAP or N/A
 * are named in the comment blocks below and in
 * parity/phase3-2026-07-25/findings/UT-monclass.md, so the ledger does not
 * re-queue them.
 */

import { describe, expect, it } from "vitest";

import { compileGamedata } from "./records.js";
import type { FileSpec } from "./records.js";
import { gamedataSpecs } from "./specs/index.js";

function spec(name: string): FileSpec {
  const found = gamedataSpecs.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no shipped spec named "${name}"`);
  return found;
}

/** Compile `lines` (record header first) and return the single record. */
function one(file: string, ...lines: string[]): Record<string, unknown> {
  const out = compileGamedata(`${lines.join("\n")}\n`, spec(file));
  const rec = out.records[0];
  if (rec === undefined) throw new Error(`no record compiled for ${file}`);
  return rec as Record<string, unknown>;
}

/** The upstream PARSE_ERROR_* name compileGamedata reports for `lines`. */
function codeOf(file: string, ...lines: string[]): string {
  try {
    compileGamedata(`${lines.join("\n")}\n`, spec(file));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected a parse failure");
}

/* ================================================================== *
 * c-info.c -> class.txt (init.c parse_class_*)
 * ================================================================== */

describe("c-info.c: the flat class directives", () => {
  const CLS = "class";

  it("splits the five stat adjustments (test_stats0)", () => {
    expect(one(CLS, "name:Test", "stats:3:-3:2:-2:1")["stats"]).toEqual({
      str: 3,
      int: -3,
      wis: 2,
      dex: -2,
      con: 1,
    });
  });

  /* Each class skill directive is "int base int incr" - the pair upstream
   * splits into c_skills[] and x_skills[]. The ten cases differ only in the
   * directive name and the numbers, so they are one table. */
  const SKILLS: Array<readonly [string, string, number, number]> = [
    ["test_skill_disarm_phys0", "skill-disarm-phys", 30, 8],
    ["test_skill_disarm_magic0", "skill-disarm-magic", 20, 10],
    ["test_skill_device0", "skill-device", 32, 10],
    ["test_skill_save0", "skill-save", 28, 10],
    ["test_skill_stealth0", "skill-stealth", 3, 0],
    ["test_skill_search0", "skill-search", 24, 0],
    ["test_skill_melee0", "skill-melee", 56, 30],
    ["test_skill_shoot0", "skill-shoot", 72, 45],
    ["test_skill_throw0", "skill-throw", 72, 45],
    ["test_skill_dig0", "skill-dig", 0, 0],
  ];

  it.each(SKILLS)("%s: %s carries base and incr", (_case, directive, base, incr) => {
    const rec = one(CLS, "name:Test", `${directive}:${String(base)}:${String(incr)}`);
    expect(rec[directive]).toEqual({ base, incr });
  });

  const SCALARS: Array<readonly [string, string, number]> = [
    ["test_hitdie0", "hitdie", 4],
    ["test_exp0", "exp", 30],
    ["test_max_attacks0", "max-attacks", 5],
    ["test_min_weight0", "min-weight", 35],
    ["test_strength_multiplier0", "strength-multiplier", 4],
  ];

  it.each(SCALARS)("%s: %s is one int", (_case, directive, value) => {
    expect(one(CLS, "name:Test", `${directive}:${String(value)}`)[directive]).toBe(value);
  });

  it("accumulates the ten titles in file order (test_title0)", () => {
    /* parse_class_title fills c->title[0..9] in order; the port's repeat
     * array is the same list, so index i is the level-(5i+5) title. */
    const titles = [
      "Runner",
      "Strider",
      "Scout",
      "Courser",
      "Tracker",
      "Guide",
      "Explorer",
      "Pathfinder",
      "Ranger",
      "Ranger Lord",
    ];
    const rec = one(CLS, "name:Ranger", ...titles.map((t) => `title:${t}`));
    expect(rec["title"]).toEqual(titles);
  });

  it("splits an equip line into tval/sval/min/max/eopts (test_equip0)", () => {
    /* All three forms upstream feeds parse_class_equip. `eopts` is a sym, so
     * it takes the whole rest of the line up to the next colon - the
     * "NOT-a | b" form arrives as one token for the binder to strtok. */
    const rec = one(
      CLS,
      "name:Test",
      "equip:magic book:2:2:5:none",
      "equip:light:lantern:1:1:birth_no_recall",
      "equip:light:wooden torch:1:2:NOT-birth_no_recall | birth_force_descend",
    );
    expect(rec["equip"]).toEqual([
      { tval: "magic book", sval: "2", min: 2, max: 5, eopts: "none" },
      { tval: "light", sval: "lantern", min: 1, max: 1, eopts: "birth_no_recall" },
      {
        tval: "light",
        sval: "wooden torch",
        min: 1,
        max: 2,
        eopts: "NOT-birth_no_recall | birth_force_descend",
      },
    ]);
  });

  it("keeps an empty obj-flags / player-flags line as a presence marker (test_obj_flags0, test_player_flags0)", () => {
    /* Both directives are "?str flags"; upstream's handler returns
     * PARSE_ERROR_NONE and leaves the flag set empty when
     * parser_hasval() is false. The compiler records the bare presence so a
     * binder can tell "directive present, no value" from "absent". */
    const rec = one(CLS, "name:Test", "obj-flags:", "player-flags:");
    expect(rec["obj-flags"]).toEqual([true]);
    expect(rec["player-flags"]).toEqual([true]);
  });

  it("accumulates multi-flag lines verbatim (test_obj_flags0, test_player_flags0)", () => {
    const rec = one(
      CLS,
      "name:Test",
      "obj-flags:FEATHER",
      "obj-flags:SEE_INVIS | IMPAIR_HP",
      "player-flags:ZERO_FAIL",
      "player-flags:BLESS_WEAPON | CHOOSE_SPELLS",
    );
    expect(rec["obj-flags"]).toEqual(["FEATHER", "SEE_INVIS | IMPAIR_HP"]);
    expect(rec["player-flags"]).toEqual(["ZERO_FAIL", "BLESS_WEAPON | CHOOSE_SPELLS"]);
  });

  it("splits magic into first/weight/books (test_magic0)", () => {
    expect(one(CLS, "name:Test", "magic:4:400:3")["magic"]).toEqual({
      first: 4,
      weight: 400,
      books: 3,
    });
  });
});

describe("c-info.c: the book / spell / effect chain", () => {
  const CLS = "class";

  /* The nesting itself (book under the record, spell under book, effect
   * under spell) is already pinned by records.upstream.test.ts,
   * "c-info.c: the class magic -> book -> spell -> effect childOf chain".
   * These cases add what that test does not assert. */

  it("splits a book line into its five fields (test_book0)", () => {
    const rec = one(CLS, "name:Test", "magic:1:300:3", "book:magic book:town:[First Spells]:2:arcane");
    expect(rec["book"]).toEqual([
      { tval: "magic book", quality: "town", name: "[First Spells]", spells: 2, realm: "arcane" },
    ]);
  });

  it("attaches book-graphics to the last book, glyph as a char field (test_book_graphics0)", () => {
    /* "book-graphics char glyph sym color": the glyph is exactly one
     * character (so ':' and non-ASCII both work) and the colour keeps its
     * text - one letter or a full name - for the binder to resolve. */
    const books = one(
      CLS,
      "name:Test",
      "magic:1:300:3",
      "book:magic book:town:[One]:2:arcane",
      "book-graphics:?:y",
      "book:magic book:town:[Two]:2:arcane",
      "book-graphics:_:Light Green",
    )["book"] as Array<Record<string, unknown>>;
    expect(books[0]?.["book-graphics"]).toEqual({ glyph: "?", color: "y" });
    expect(books[1]?.["book-graphics"]).toEqual({ glyph: "_", color: "Light Green" });
  });

  it("keeps book-properties' allocation range as raw text (test_book_properties0)", () => {
    const books = one(
      CLS,
      "name:Test",
      "magic:1:300:3",
      "book:magic book:town:[One]:2:arcane",
      "book-properties:25:40:1 to 100",
    )["book"] as Array<Record<string, unknown>>;
    expect(books[0]?.["book-properties"]).toEqual({ cost: 25, common: 40, minmax: "1 to 100" });
  });

  it("splits a spell line into its five fields (test_spell0)", () => {
    const books = one(
      CLS,
      "name:Test",
      "magic:1:300:3",
      "book:magic book:town:[One]:2:arcane",
      "spell:Light Room:1:2:26:4",
    )["book"] as Array<{ spell: Array<Record<string, unknown>> }>;
    expect(books[0]?.spell).toEqual([
      { name: "Light Room", level: 1, mana: 2, fail: 26, exp: 4 },
    ]);
  });

  it("takes the effect's optional subtype/radius/other in that order (test_effect0)", () => {
    /* The four forms upstream's test_effect0 feeds parse_class_effect:
     * "effect sym eff ?sym type ?int radius ?int other", optionals dropped
     * from the right. */
    const spells = (
      one(
        CLS,
        "name:Test",
        "magic:1:300:3",
        "book:magic book:town:[One]:4:arcane",
        "spell:S:1:1:20:1",
        "effect:LIGHT_AREA",
        "effect:BOLT_OR_BEAM:COLD",
        "effect:BALL:FIRE:2",
        "effect:SHORT_BEAM:ELEC:0:1",
      )["book"] as Array<{ spell: Array<{ effect: Array<Record<string, unknown>> }> }>
    )[0]?.spell[0]?.effect;
    expect(spells).toEqual([
      { eff: "LIGHT_AREA" },
      { eff: "BOLT_OR_BEAM", type: "COLD" },
      { eff: "BALL", type: "FIRE", radius: 2 },
      { eff: "SHORT_BEAM", type: "ELEC", radius: 0, other: 1 },
    ]);
  });

  it("attaches effect-yx / dice / expr / effect-msg to the LAST effect (test_effect_yx0, test_dice0, test_expr0, test_effect_msg0)", () => {
    const effects = (
      one(
        CLS,
        "name:Test",
        "magic:1:300:3",
        "book:magic book:town:[One]:4:arcane",
        "spell:S:1:1:20:1",
        "effect:LIGHT_AREA",
        "effect:BOLT:FIRE",
        "effect-yx:22:40",
        "dice:8+1d10m5",
        "expr:D:PLAYER_LEVEL:/ 5 + 1",
        "effect-msg:shadow shifting",
        "effect-msg: went wrong",
      )["book"] as Array<{ spell: Array<{ effect: Array<Record<string, unknown>> }> }>
    )[0]?.spell[0]?.effect;
    expect(effects?.[0]).toEqual({ eff: "LIGHT_AREA" });
    expect(effects?.[1]).toEqual({
      eff: "BOLT",
      type: "FIRE",
      "effect-yx": { y: 22, x: 40 },
      dice: "8+1d10m5",
      expr: [{ name: "D", base: "PLAYER_LEVEL", expr: "/ 5 + 1" }],
      /* effect-msg is string_append upstream; the array joins to the same
       * text, which is what test_effect_msg0 asserts. */
      "effect-msg": ["shadow shifting", " went wrong"],
    });
    expect((effects?.[1]?.["effect-msg"] as string[]).join("")).toBe(
      "shadow shifting went wrong",
    );
  });

  it("lets a second dice line for one effect replace the first (test_dice0)", () => {
    /* parse_class_dice dice_free()s the old dice and stores the new one, so
     * repeating the directive is legal and the LAST wins. */
    const effects = (
      one(
        CLS,
        "name:Test",
        "magic:1:300:3",
        "book:magic book:town:[One]:4:arcane",
        "spell:S:1:1:20:1",
        "effect:LIGHT_AREA",
        "dice:8+1d10m5",
        "dice:6+2d4",
      )["book"] as Array<{ spell: Array<{ effect: Array<Record<string, unknown>> }> }>
    )[0]?.spell[0]?.effect;
    expect(effects?.[0]?.["dice"]).toBe("6+2d4");
  });

  it("accumulates a spell's desc lines, which join to one paragraph (test_desc0)", () => {
    const spells = (
      one(
        CLS,
        "name:Test",
        "magic:1:300:3",
        "book:magic book:town:[One]:2:arcane",
        "spell:S:1:1:20:1",
        "desc:Shoots a bolt of frost that always hits its target.",
        "desc:  Sometimes a beam is fired instead.",
      )["book"] as Array<{ spell: Array<{ desc: string[] }> }>
    )[0]?.spell[0]?.desc;
    expect(spells).toEqual([
      "Shoots a bolt of frost that always hits its target.",
      "  Sometimes a beam is fired instead.",
    ]);
    expect(spells?.join("")).toBe(
      "Shoots a bolt of frost that always hits its target.  Sometimes a beam is fired instead.",
    );
  });

  it("does not modify the effect when expr precedes any dice (test_missing_dice0)", () => {
    /* parse_class_expr returns PARSE_ERROR_NONE and leaves e->dice NULL;
     * the port keeps the expr entry on the effect but no dice, so the
     * binder sees the same "no dice" state. */
    const effects = (
      one(
        CLS,
        "name:Test",
        "magic:1:300:3",
        "book:magic book:town:[One]:2:arcane",
        "spell:S:1:1:20:1",
        "effect:BOLT:FIRE",
        "expr:B:PLAYER_LEVEL:* 3 - 2",
      )["book"] as Array<{ spell: Array<{ effect: Array<Record<string, unknown>> }> }>
    )[0]?.spell[0]?.effect;
    expect(effects?.[0]?.["dice"]).toBeUndefined();
  });
});

/* ================================================================== *
 * r-info.c -> monster.txt (mon-init.c parse_monster_*)
 * ================================================================== */

describe("r-info.c: the flat monster directives", () => {
  const MON = "monster";

  const SCALARS: Array<readonly [string, string, string, number]> = [
    ["test_speed0", "speed", "7", 7],
    ["test_hp0", "hit-points", "500", 500],
    ["test_hearing0", "hearing", "80", 80],
    ["test_smell0", "smell", "30", 30],
    ["test_ac0", "armor-class", "22", 22],
    ["test_sleep0", "sleepiness", "3", 3],
    ["test_depth0", "depth", "42", 42],
    ["test_rarity0", "rarity", "11", 11],
    ["test_mexp0", "experience", "4", 4],
    ["test_spell_power0", "spell-power", "15", 15],
    ["test_innate_freq0", "innate-freq", "10", 10],
    ["test_spell_freq0", "spell-freq", "4", 4],
  ];

  it.each(SCALARS)("%s: %s is one int", (_case, directive, text, value) => {
    expect(one(MON, "name:Test", `${directive}:${text}`)[directive]).toBe(value);
  });

  it("keeps an empty plural line as a presence marker (test_plural0)", () => {
    /* "plural ?str plural": upstream leaves r->plural NULL when the field
     * is empty and sets it otherwise. */
    expect(one(MON, "name:Test", "plural:")["plural"]).toBe(true);
    expect(one(MON, "name:Test", "plural:red-hatted elves")["plural"]).toBe(
      "red-hatted elves",
    );
  });

  it("reads the glyph as a char field (test_glyph0)", () => {
    expect(one(MON, "name:Test", "glyph:!")["glyph"]).toBe("!");
    /* Upstream only runs the non-ASCII half under a UTF-8 locale; the port
     * is always UTF-16, so the yen sign is unconditional here. */
    expect(one(MON, "name:Test", "glyph:¥")["glyph"]).toBe("¥");
  });

  it("keeps the colour token verbatim, one letter or a full name (test_color0)", () => {
    expect(one(MON, "name:Test", "color:v")["color"]).toBe("v");
    expect(one(MON, "name:Test", "color:Light Green")["color"]).toBe("Light Green");
    expect(one(MON, "name:Test", "color:light red")["color"]).toBe("light red");
  });

  it("splits a blow line, with effect and damage optional (test_blow0, test_blow1)", () => {
    /* "blow sym method ?sym effect ?rand damage". test_blow1's line has a
     * FOURTH field, ":0", which the signature does not claim; strtok simply
     * never reads it, so the extra text is ignored rather than an error. */
    const rec = one(MON, "name:Test", "blow:CLAW:FIRE:9d12", "blow:BITE:FIRE:6d8:0");
    expect(rec["blow"]).toEqual([
      { method: "CLAW", effect: "FIRE", damage: "9d12" },
      { method: "BITE", effect: "FIRE", damage: "6d8" },
    ]);
  });

  it("accumulates flags and flags-off lines separately (test_flags0, test_flags_off0)", () => {
    const rec = one(
      MON,
      "name:Test",
      "flags:",
      "flags:UNAWARE",
      "flags:UNIQUE | MALE",
      "flags-off:",
      "flags-off:UNIQUE",
      "flags-off:MALE | UNAWARE",
    );
    expect(rec["flags"]).toEqual([true, "UNAWARE", "UNIQUE | MALE"]);
    expect(rec["flags-off"]).toEqual([true, "UNIQUE", "MALE | UNAWARE"]);
  });

  it("accumulates desc lines that join with no separator (test_desc0)", () => {
    const rec = one(MON, "name:Test", "desc:foo bar ", "desc: baz");
    expect(rec["desc"]).toEqual(["foo bar ", " baz"]);
    expect((rec["desc"] as string[]).join("")).toBe("foo bar  baz");
  });

  it("accumulates spells lines (test_spells0)", () => {
    const rec = one(MON, "name:Test", "spells:SCARE", "spells:BR_DARK | S_HOUND");
    expect(rec["spells"]).toEqual(["SCARE", "BR_DARK | S_HOUND"]);
  });

  it("keeps a spell message with an absent text field (test_messagevis0, test_messageinvis0, test_messagemiss0)", () => {
    /* "message-vis sym spell ?str message": upstream stores "" for the
     * message when the field is absent, so the alternate-message entry
     * exists with an empty string. */
    const rec = one(
      MON,
      "name:Test",
      "message-vis:TRAPS",
      "message-vis:WOUND:{name} curses malevolently.",
      "message-invis:BLINK",
      "message-invis:SHRIEK:Something shouts.",
      "message-miss:SPIT",
      "message-miss:BOULDER:{name} throws a boulder and misses.",
    );
    expect(rec["message-vis"]).toEqual([
      { spell: "TRAPS" },
      { spell: "WOUND", message: "{name} curses malevolently." },
    ]);
    expect(rec["message-invis"]).toEqual([
      { spell: "BLINK" },
      { spell: "SHRIEK", message: "Something shouts." },
    ]);
    expect(rec["message-miss"]).toEqual([
      { spell: "SPIT" },
      { spell: "BOULDER", message: "{name} throws a boulder and misses." },
    ]);
  });

  it("splits drop and drop-base and records their interleaved order (test_drop0, test_drop_base0)", () => {
    /* Upstream builds ONE r->drops list, so the two directives interleave;
     * the port's `drop-order` group is that encounter order. */
    const rec = one(
      MON,
      "name:Test",
      "drop:light:wooden torch:10:1:2",
      "drop-base:light:10:1:2",
    );
    expect(rec["drop"]).toEqual([
      { tval: "light", sval: "wooden torch", chance: 10, min: 1, max: 2 },
    ]);
    expect(rec["drop-base"]).toEqual([{ tval: "light", chance: 10, min: 1, max: 2 }]);
    expect(rec["drop-order"]).toEqual(["drop:0", "drop-base:0"]);
  });

  it("makes the friends role optional (test_friends0, test_friends_base0)", () => {
    const rec = one(
      MON,
      "name:Test",
      "friends:15:1d2:blubbering idiot",
      "friends:25:2d1:agent of the black market:servant",
      "friends:75:1d3:mean-looking mercenary:bodyguard",
      "friends-base:20:1d3:townsfolk",
      "friends-base:5:1d6:townsfolk:servant",
      "friends-base:10:1d2:townsfolk:bodyguard",
    );
    expect(rec["friends"]).toEqual([
      { chance: 15, number: "1d2", name: "blubbering idiot" },
      { chance: 25, number: "2d1", name: "agent of the black market", role: "servant" },
      { chance: 75, number: "1d3", name: "mean-looking mercenary", role: "bodyguard" },
    ]);
    expect(rec["friends-base"]).toEqual([
      { chance: 20, number: "1d3", name: "townsfolk" },
      { chance: 5, number: "1d6", name: "townsfolk", role: "servant" },
      { chance: 10, number: "1d2", name: "townsfolk", role: "bodyguard" },
    ]);
  });

  it("splits mimic into tval and sval and accumulates shapes (test_mimic0, test_shape0)", () => {
    const rec = one(
      MON,
      "name:Test",
      "mimic:chest:small wooden chest",
      "shape:townsfolk",
      "shape:blubbering idiot",
    );
    expect(rec["mimic"]).toEqual([{ tval: "chest", sval: "small wooden chest" }]);
    expect(rec["shape"]).toEqual(["townsfolk", "blubbering idiot"]);
  });
});

/* ================================================================== *
 * ptimed.c -> player_timed.txt (player-timed.c parse_player_timed_*)
 * ================================================================== */

describe("ptimed.c: the flat player_timed directives", () => {
  const PT = "player_timed";

  it("accumulates desc / on-end / on-increase / on-decrease lines (test_desc0, test_endmsg0, test_incmsg0, test_decmsg0)", () => {
    /* All four are string_append upstream, so the arrays join with no
     * separator to exactly the text those four cases assert. */
    const rec = one(
      PT,
      "name:FOOD",
      "desc:nourishment",
      "desc: (i.e. food)",
      "on-end:You no longer feel safe from evil!",
      "on-end:  They'll be after you soon.",
      "on-increase:You feel even safer from evil!",
      "on-increase:  And the shadows seem to lighten and shrink.",
      "on-decrease:You feel less safe from evil!",
      "on-decrease:  And the shadows seem to lengthen and darken.",
    );
    expect((rec["desc"] as string[]).join("")).toBe("nourishment (i.e. food)");
    expect((rec["on-end"] as string[]).join("")).toBe(
      "You no longer feel safe from evil!  They'll be after you soon.",
    );
    expect((rec["on-increase"] as string[]).join("")).toBe(
      "You feel even safer from evil!  And the shadows seem to lighten and shrink.",
    );
    expect((rec["on-decrease"] as string[]).join("")).toBe(
      "You feel less safe from evil!  And the shadows seem to lengthen and darken.",
    );
  });

  it("keeps msgt, resist and lower-bound as single fields (test_msgt0, test_resist0, test_lowerbound0)", () => {
    const rec = one(PT, "name:FOOD", "msgt:HUNGRY", "resist:COLD", "lower-bound:10");
    expect(rec["msgt"]).toBe("HUNGRY");
    expect(rec["resist"]).toBe("COLD");
    expect(rec["lower-bound"]).toBe(10);
  });

  it("accumulates the five fail codes in file order (test_fail0)", () => {
    /* "fail uint code str flag". Upstream PREPENDS each new entry, so its
     * list reads back last-first; the port keeps file order and the binder
     * owns the direction. */
    const rec = one(
      PT,
      "name:FOOD",
      "fail:1:FREE_ACT",
      "fail:2:FIRE",
      "fail:3:POIS",
      "fail:4:NO_MANA",
      "fail:5:SLOW",
    );
    expect(rec["fail"]).toEqual([
      { code: 1, flag: "FREE_ACT" },
      { code: 2, flag: "FIRE" },
      { code: 3, flag: "POIS" },
      { code: 4, flag: "NO_MANA" },
      { code: 5, flag: "SLOW" },
    ]);
  });

  it("makes the grade down-message optional in both spellings (test_grade0)", () => {
    /* "grade sym color int max sym name sym up_msg ?sym down_msg". The
     * three forms upstream emits: a down message, a trailing bare colon,
     * and the field omitted entirely. */
    const rec = one(
      PT,
      "name:FOOD",
      "grade:R:1: :You are still faint.:You are starving!!",
      "grade:r:4:Faint:You are still faint.:",
      "grade:o:8:Weak:You are still weak.",
    );
    expect(rec["grade"]).toEqual([
      {
        color: "R",
        max: 1,
        name: " ",
        up_msg: "You are still faint.",
        down_msg: "You are starving!!",
      },
      /* The trailing bare colon is a strtok delimiter run, so the optional
       * field is simply absent - identical to omitting it. */
      { color: "r", max: 4, name: "Faint", up_msg: "You are still faint." },
      { color: "o", max: 8, name: "Weak", up_msg: "You are still weak." },
    ]);
  });

  it("accumulates brand / slay / flag-synonym lines (test_brand0, test_slay0, test_flagsyn0)", () => {
    const rec = one(
      PT,
      "name:FOOD",
      "brand:POIS_2",
      "brand:ELEC_2",
      "brand:ACID_3",
      "slay:UNDEAD_3",
      "slay:ANIMAL_2",
      "flag-synonym:SUST_STR:0",
      "flag-synonym:TELEPATHY:1",
    );
    expect(rec["brand"]).toEqual(["POIS_2", "ELEC_2", "ACID_3"]);
    expect(rec["slay"]).toEqual(["UNDEAD_3", "ANIMAL_2"]);
    expect(rec["flag-synonym"]).toEqual([
      { code: "SUST_STR", exact: 0 },
      { code: "TELEPATHY", exact: 1 },
    ]);
  });

  it("keeps an empty flags line as a presence marker (test_flags0)", () => {
    const rec = one(PT, "name:FOOD", "flags:", "flags:NONSTACKING");
    expect(rec["flags"]).toEqual([true, "NONSTACKING"]);
  });

  it("takes the on-begin/on-end effect's optional fields right to left (test_begineffect0, test_endeffect0)", () => {
    const rec = one(
      PT,
      "name:FOOD",
      "on-begin-effect:DAMAGE",
      "on-begin-effect:CURE:BLIND",
      "on-begin-effect:BALL:COLD:3",
      "on-begin-effect:SPOT:LIGHT_WEAK:2:10",
      "on-end-effect:DAMAGE",
      "on-end-effect:SPOT:LIGHT_WEAK:2:10",
    );
    expect(rec["on-begin-effect"]).toEqual([
      { eff: "DAMAGE" },
      { eff: "CURE", type: "BLIND" },
      { eff: "BALL", type: "COLD", radius: 3 },
      { eff: "SPOT", type: "LIGHT_WEAK", radius: 2, other: 10 },
    ]);
    expect(rec["on-end-effect"]).toEqual([
      { eff: "DAMAGE" },
      { eff: "SPOT", type: "LIGHT_WEAK", radius: 2, other: 10 },
    ]);
  });

  it("attaches effect-yx / -dice / -expr / -msg to whichever effect came last (test_effectyx0, test_effectdice0, test_effectexpr0, test_effectmsg0)", () => {
    /* player-timed.c threads ONE `ps->e` cursor through both effect lists,
     * so a dependency lands on the most recent on-begin-effect OR
     * on-end-effect - which is why the port declares both as parents. */
    const rec = one(
      PT,
      "name:FOOD",
      "on-begin-effect:DAMAGE",
      "effect-yx:10:20",
      "effect-msg:despair",
      "effect-msg: and loneliness",
      "on-end-effect:DAMAGE",
      "effect-dice:4d$S",
      "effect-expr:S:DUNGEON_LEVEL:+ 19 / 20",
    );
    expect(rec["on-begin-effect"]).toEqual([
      {
        eff: "DAMAGE",
        "effect-yx": { y: 10, x: 20 },
        "effect-msg": ["despair", " and loneliness"],
      },
    ]);
    expect(rec["on-end-effect"]).toEqual([
      {
        eff: "DAMAGE",
        "effect-dice": "4d$S",
        "effect-expr": [{ name: "S", base: "DUNGEON_LEVEL", expr: "+ 19 / 20" }],
      },
    ]);
  });

  it("lets a second effect-dice line replace the first (test_effectdice0)", () => {
    /* parse_player_timed_effect_dice dice_free()s the previous dice before
     * storing the new one, so the LAST line wins. */
    const rec = one(
      PT,
      "name:FOOD",
      "on-end-effect:DAMAGE",
      "effect-dice:5+2d20",
      "effect-dice:3+4d5",
    );
    expect(rec["on-end-effect"]).toEqual([{ eff: "DAMAGE", "effect-dice": "3+4d5" }]);
  });

  it("rejects an effect dependency before any effect (test_missing_effect0)", () => {
    /* Unlike class.txt and object.txt, player-timed.c's four effect-*
     * handlers return PARSE_ERROR_MISSING_RECORD_HEADER when ps->e is NULL
     * (player-timed.c L473-560) rather than tolerating the orphan. */
    for (const line of [
      "effect-yx:10:20",
      "effect-dice:2d20",
      "effect-expr:B:PLAYER_HP:/ 4",
      "effect-msg:despair",
    ]) {
      expect(codeOf(PT, "name:FOOD", line), line).toMatch(/MISSING_RECORD_HEADER/);
    }
  });
});

/* ================================================================== *
 * k-info.c -> object.txt (obj-init.c parse_object_*)
 * ================================================================== */

describe("k-info.c: the flat object directives", () => {
  const OBJ = "object";

  it("keeps the glyph as a char and the colour verbatim (test_graphics0, test_graphics1)", () => {
    expect(one(OBJ, "name:Test", "graphics:~:red")["graphics"]).toEqual({
      glyph: "~",
      color: "red",
    });
    expect(one(OBJ, "name:Test", "graphics:!:W")["graphics"]).toEqual({
      glyph: "!",
      color: "W",
    });
  });

  const SCALARS: Array<readonly [string, string, string, number]> = [
    ["test_level0", "level", "10", 10],
    ["test_weight0", "weight", "5", 5],
    ["test_cost0", "cost", "120", 120],
    ["test_power0", "power", "17", 17],
  ];

  it.each(SCALARS)("%s: %s is one int", (_case, directive, text, value) => {
    expect(one(OBJ, "name:Test", `${directive}:${text}`)[directive]).toBe(value);
  });

  it("keeps the tval name verbatim (test_type0)", () => {
    expect(one(OBJ, "name:Test", "type:food")["type"]).toBe("food");
  });

  it("keeps the allocation range as raw text beside the commonness (test_alloc0)", () => {
    expect(one(OBJ, "name:Test", "alloc:3:4 to 6")["alloc"]).toEqual({
      common: 3,
      minmax: "4 to 6",
    });
  });

  it("reads the three attack dice and the armour pair (test_attack0, test_armor0)", () => {
    /* "attack rand hd rand to-h rand to-d" and "armor int ac rand to-a":
     * rand fields are validated against parse_random but stored raw. */
    const rec = one(OBJ, "name:Test", "attack:4d8:1d4:2d5", "armor:3:7d6");
    expect(rec["attack"]).toEqual({ hd: "4d8", "to-h": "1d4", "to-d": "2d5" });
    expect(rec["armor"]).toEqual({ ac: 3, "to-a": "7d6" });
  });

  it("keeps charges, pval and time as raw dice strings (test_charges0, test_pval0, test_time0)", () => {
    const rec = one(OBJ, "name:Test", "charges:2d8", "pval:1+2d3M4", "time:4d5");
    expect(rec["charges"]).toBe("2d8");
    expect(rec["pval"]).toBe("1+2d3M4");
    expect(rec["time"]).toBe("4d5");
  });

  it("splits pile into prob and stack (test_pile0)", () => {
    expect(one(OBJ, "name:Test", "pile:4:3d6")["pile"]).toEqual([
      { prob: 4, stack: "3d6" },
    ]);
  });

  it("accumulates flags, values, slay, brand and desc lines (test_flags0, test_values0, test_slay0, test_brand0, test_desc0)", () => {
    const rec = one(
      OBJ,
      "name:Test",
      "flags:EASY_KNOW | FEATHER",
      "flags:IGNORE_COLD",
      "values:STEALTH[-5]",
      "values:RES_ELEC[3] | SPEED[1+1d2]",
      "slay:ORC_3",
      "brand:COLD_2",
      "desc:foo bar",
      "desc: baz",
    );
    expect(rec["flags"]).toEqual(["EASY_KNOW | FEATHER", "IGNORE_COLD"]);
    expect(rec["values"]).toEqual(["STEALTH[-5]", "RES_ELEC[3] | SPEED[1+1d2]"]);
    expect(rec["slay"]).toEqual(["ORC_3"]);
    expect(rec["brand"]).toEqual(["COLD_2"]);
    expect((rec["desc"] as string[]).join("")).toBe("foo bar baz");
  });

  it("splits curse into name and power (test_curse0)", () => {
    const rec = one(
      OBJ,
      "name:Test",
      "curse:vulnerability:0",
      "curse:vulnerability:-5",
      "curse:teleportation:5",
    );
    expect(rec["curse"]).toEqual([
      { name: "vulnerability", power: 0 },
      { name: "vulnerability", power: -5 },
      { name: "teleportation", power: 5 },
    ]);
  });

  it("accumulates msg and vis-msg lines that join to one string (test_msg0, test_vis_msg0)", () => {
    const rec = one(
      OBJ,
      "name:Test",
      "msg:It feels warm to the touch.",
      "msg: And gives off an incredible stench.",
      "vis-msg:It glows.",
      "vis-msg: And emits some sparks.",
    );
    expect((rec["msg"] as string[]).join("")).toBe(
      "It feels warm to the touch. And gives off an incredible stench.",
    );
    expect((rec["vis-msg"] as string[]).join("")).toBe(
      "It glows. And emits some sparks.",
    );
  });

  it("chains object effects with their optional fields (test_effect0, test_effect_yx0, test_dice0, test_expr0, test_missing_dice0)", () => {
    const rec = one(
      OBJ,
      "name:Test",
      "effect:LIGHT_LEVEL",
      "effect:TIMED_INC:CUT",
      "effect:SPOT:ACID:2",
      "effect:ARC:FIRE:5:30",
      "effect-yx:11:23",
      "dice:5d8",
      "dice:3+4d6",
      "expr:B:PLAYER_HP:/ 50 + 15",
    );
    expect(rec["effect"]).toEqual([
      { eff: "LIGHT_LEVEL" },
      { eff: "TIMED_INC", type: "CUT" },
      { eff: "SPOT", type: "ACID", radius: 2 },
      {
        eff: "ARC",
        type: "FIRE",
        radius: 5,
        other: 30,
        "effect-yx": { y: 11, x: 23 },
        /* A second dice line replaces the first (test_dice0). */
        dice: "3+4d6",
        expr: [{ name: "B", base: "PLAYER_HP", expr: "/ 50 + 15" }],
      },
    ]);
  });

  it("does not error when effect dependencies precede any effect (test_missing_effect0)", () => {
    /* obj-init.c's effect-yx / dice / expr handlers return
     * PARSE_ERROR_NONE and leave k->effect NULL. The port parks the orphans
     * on the enclosing record and the object binder sees no effect chain. */
    const rec = one(
      OBJ,
      "name:Test",
      "effect-yx:3:7",
      "dice:d$S",
      "expr:S:PLAYER_LEVEL:+ 0",
    );
    expect(rec["effect"]).toBeUndefined();
  });
});

/* ================================================================== *
 * partrap.c -> trap.txt (init.c parse_trap_*)
 * ================================================================== */

describe("partrap.c: the flat trap directives", () => {
  const TRAP = "trap";
  const NAME = "name:test trap:test trap 1";

  it("splits the record header into name and desc (test_name0)", () => {
    expect(one(TRAP, NAME)["name"]).toEqual({
      name: "test trap",
      desc: "test trap 1",
    });
  });

  it("keeps the glyph as a char and the colour verbatim (test_graphics0)", () => {
    expect(one(TRAP, NAME, "graphics:^:Red")["graphics"]).toEqual({
      glyph: "^",
      color: "Red",
    });
    expect(one(TRAP, NAME, "graphics:%:light green")["graphics"]).toEqual({
      glyph: "%",
      color: "light green",
    });
    expect(one(TRAP, NAME, "graphics:_:s")["graphics"]).toEqual({
      glyph: "_",
      color: "s",
    });
  });

  it("splits appear into rarity/mindepth/maxnum (test_appear0)", () => {
    expect(one(TRAP, NAME, "appear:2:20:1")["appear"]).toEqual({
      rarity: 2,
      mindepth: 20,
      maxnum: 1,
    });
  });

  it("keeps visibility as raw dice text (test_visibility0)", () => {
    /* Registered "visibility str visibility", not rand: the handler runs
     * dice_parse_string itself, which is why test_visibility_bad0's
     * "1d6+1d10" is NOT_RANDOM at the binder and not at the line parser. */
    expect(one(TRAP, NAME, "visibility:5+2d10M50")["visibility"]).toBe("5+2d10M50");
    expect(one(TRAP, NAME, "visibility:1d6+1d10")["visibility"]).toBe("1d6+1d10");
  });

  it("accumulates flags lines including an empty one (test_flags0)", () => {
    const rec = one(TRAP, NAME, "flags:", "flags:TRAP", "flags:FLOOR | VISIBLE");
    expect(rec["flags"]).toEqual([true, "TRAP", "FLOOR | VISIBLE"]);
  });

  it("keeps save as one flags string (test_save0)", () => {
    expect(one(TRAP, NAME, "save:FREE_ACT | HOLD_LIFE")["save"]).toBe(
      "FREE_ACT | HOLD_LIFE",
    );
  });

  it("accumulates desc / msg / msg-good / msg-bad / msg-xtra (test_desc0, test_msg0, test_msg_good0, test_msg_bad0, test_msg_xtra0)", () => {
    const rec = one(
      TRAP,
      NAME,
      "desc:This weakened ceiling beam threatens to collapse at any moment.",
      "desc:  You would prefer not to be nearby when it does.",
      "msg:Blades whirl around you, slicing your skin!",
      "msg:  The air is filled with a fine mist of blood.",
      "msg-good:You manage to spring to the side.",
      "msg-good:  The floor is not as lucky and shatters.",
      "msg-bad:A small dart hits you!",
      "msg-bad:  Numbness spreads from where it pricked you.",
      "msg-xtra:You are impaled!",
      "msg-xtra:  And begin to bleed profusely.",
    );
    const joined = (k: string): string => (rec[k] as string[]).join("");
    expect(joined("desc")).toBe(
      "This weakened ceiling beam threatens to collapse at any moment." +
        "  You would prefer not to be nearby when it does.",
    );
    expect(joined("msg")).toBe(
      "Blades whirl around you, slicing your skin!" +
        "  The air is filled with a fine mist of blood.",
    );
    expect(joined("msg-good")).toBe(
      "You manage to spring to the side.  The floor is not as lucky and shatters.",
    );
    expect(joined("msg-bad")).toBe(
      "A small dart hits you!  Numbness spreads from where it pricked you.",
    );
    expect(joined("msg-xtra")).toBe(
      "You are impaled!  And begin to bleed profusely.",
    );
  });

  it("chains the main effect family (test_effect0, test_effect_yx0, test_dice0, test_expr0)", () => {
    const rec = one(
      TRAP,
      NAME,
      "effect:DAMAGE",
      "effect:TIMED_INC:SLOW",
      "effect:SPOT:FIRE:1",
      "effect:SPOT:LIGHT_WEAK:2:10",
      "effect-yx:11:23",
      "dice:5+2d8M30",
      "expr:B:DUNGEON_LEVEL:/ 10 + 8",
    );
    expect(rec["effect"]).toEqual([
      { eff: "DAMAGE" },
      { eff: "TIMED_INC", type: "SLOW" },
      { eff: "SPOT", type: "FIRE", radius: 1 },
      {
        eff: "SPOT",
        type: "LIGHT_WEAK",
        radius: 2,
        other: 10,
        "effect-yx": { y: 11, x: 23 },
        dice: "5+2d8M30",
        expr: [{ name: "B", base: "DUNGEON_LEVEL", expr: "/ 10 + 8" }],
      },
    ]);
  });

  it("chains the parallel effect-xtra family independently (test_effect_xtra0, test_effect_yx_xtra0, test_dice_xtra0, test_expr_xtra0)", () => {
    const rec = one(
      TRAP,
      NAME,
      "effect-xtra:WAKE",
      "effect-xtra:DRAIN_STAT:STR",
      "effect-xtra:SPOT:ACID:1",
      "effect-xtra:SPHERE:FIRE:4:5",
      "effect-yx-xtra:13:27",
      "dice-xtra:10+5d6",
      "expr-xtra:S:DUNGEON_LEVEL:/ 20 + 4",
    );
    expect(rec["effect-xtra"]).toEqual([
      { eff: "WAKE" },
      { eff: "DRAIN_STAT", type: "STR" },
      { eff: "SPOT", type: "ACID", radius: 1 },
      {
        eff: "SPHERE",
        type: "FIRE",
        radius: 4,
        other: 5,
        "effect-yx-xtra": { y: 13, x: 27 },
        "dice-xtra": "10+5d6",
        "expr-xtra": [{ name: "S", base: "DUNGEON_LEVEL", expr: "/ 20 + 4" }],
      },
    ]);
  });

  it("does not error when either family's dependencies come first (test_missing_effect_xtra0, test_missing_dice0, test_missing_dice_xtra0)", () => {
    /* init.c's trap effect-detail handlers return PARSE_ERROR_NONE with the
     * trap unmodified when the matching effect list is empty. */
    const orphan = one(
      TRAP,
      NAME,
      "effect-yx-xtra:7:15",
      "dice-xtra:$B+5d4",
      "expr-xtra:B:DUNGEON_LEVEL:/ 10 + 8",
    );
    expect(orphan["effect-xtra"]).toBeUndefined();

    /* expr with an effect but no dice leaves the effect's dice unset. */
    const noDice = one(TRAP, NAME, "effect:DAMAGE", "expr:S:DUNGEON_LEVEL:/ 5 + 2");
    expect((noDice["effect"] as Array<Record<string, unknown>>)[0]?.["dice"]).toBeUndefined();
    const noDiceXtra = one(
      TRAP,
      NAME,
      "effect-xtra:DAMAGE",
      "expr-xtra:B:DUNGEON_LEVEL:* 2",
    );
    expect(
      (noDiceXtra["effect-xtra"] as Array<Record<string, unknown>>)[0]?.["dice-xtra"],
    ).toBeUndefined();
  });

  it("compiles the whole dart-trap record (test_complete0)", () => {
    const rec = one(
      TRAP,
      "name:dart trap:slow dart",
      "graphics:^:r",
      "appear:1:2:0",
      "visibility:M50",
      "flags:TRAP | FLOOR | SAVE_ARMOR",
      "effect:DAMAGE",
      "dice:1d4",
      "effect:TIMED_INC_NO_RES:SLOW",
      "dice:20+1d20",
      "desc:A trap which shoots slowing darts.",
      "msg-good:A small dart barely misses you.",
      "msg-bad:A small dart hits you!",
    );
    expect(rec).toEqual({
      name: { name: "dart trap", desc: "slow dart" },
      graphics: { glyph: "^", color: "r" },
      appear: { rarity: 1, mindepth: 2, maxnum: 0 },
      visibility: "M50",
      flags: ["TRAP | FLOOR | SAVE_ARMOR"],
      effect: [
        { eff: "DAMAGE", dice: "1d4" },
        { eff: "TIMED_INC_NO_RES", type: "SLOW", dice: "20+1d20" },
      ],
      desc: ["A trap which shoots slowing darts."],
      "msg-good": ["A small dart barely misses you."],
      "msg-bad": ["A small dart hits you!"],
    });
    /* test_complete0 also asserts t->effect_xtra is NULL. */
    expect(rec["effect-xtra"]).toBeUndefined();
  });
});
