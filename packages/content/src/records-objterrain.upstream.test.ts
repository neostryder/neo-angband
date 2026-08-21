/**
 * Record-assembly semantics for the object / terrain / projection group,
 * pinned against the upstream parse/ unit tests.
 *
 * Batch "objterr" of the UT-PORT lane:
 *   reference/src/tests/parse/{a-info,curse,e-info,f-info,mspell,p-info,pit,
 *   proj,shape}.c
 *
 * The port splits each upstream parse handler in two. The LINE grammar and
 * record assembly (what `compileGamedata` does with the shipped FileSpec) live
 * here; the name-to-enum resolution, range checks and cross-record lookups
 * that upstream's handlers do inline live in `packages/core` and are pinned by
 * packages/core/src/parse-objterrain.upstream.test.ts. Every case in this file
 * is therefore the part of an upstream case that is observable at the compiler
 * level: field extraction, accumulation shape, childOf grouping, and the
 * grammar-level parse errors.
 *
 * Every spec used here is the real shipped FileSpec from ./specs, so the
 * assertions are about production metadata, not a fixture.
 *
 * Not duplicated here, cited instead (already covered by
 * ./records.upstream.test.ts):
 *   f-info.c test_name_bad0     -> "a second name: in one terrain record"
 *   e-info.c test_order         -> "a short directive line is MISSING_FIELD"
 *   mspell.c test_cutoff0/lore0 -> "power-cutoff owns the lore group"
 *   mspell.c test_misplaced_effect_deps0 -> "orphan effect deps"
 *   mspell.c test_missing_record0, and the missing-record-header case of
 *   a-info / curse / e-info / f-info / p-info / pit / proj / shape
 *                               -> HEADER_CASES
 */

import { describe, expect, it } from "vitest";

import { compileGamedata } from "./records.js";
import type { FileSpec, JsonObject } from "./records.js";
import { gamedataSpecs } from "./specs/index.js";

function spec(name: string): FileSpec {
  const found = gamedataSpecs.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no shipped spec named "${name}"`);
  return found;
}

/** Compile `lines` as one record and return it. */
function one(file: string, ...lines: string[]): JsonObject {
  const out = compileGamedata(`${lines.join("\n")}\n`, spec(file));
  expect(out.records).toHaveLength(1);
  return out.records[0] as JsonObject;
}

/* ------------------------------------------------------------------ *
 * proj.c -- projection.txt
 * ------------------------------------------------------------------ */

describe("proj.c: projection field extraction", () => {
  /* test_code0 asserts every field is zero/NULL after only `code:`; the port
   * models "absent" as an absent key, so the record is code-only. */
  it("a code:-only record carries nothing else (test_code0)", () => {
    expect(one("projection", "code:ACID")).toEqual({ code: "ACID" });
  });

  it("type: is a free string, not an enum (test_type0)", () => {
    expect(one("projection", "code:ACID", "type:element")["type"]).toBe("element");
    expect(one("projection", "code:ACID", "type:monster")["type"]).toBe("monster");
  });

  /* test_desc0 / test_player_desc0 / test_blind_desc0 / test_lash_desc0 all
   * use `str desc` and all four upstream handlers string_free the old value
   * first, i.e. LAST-ONE-WINS rather than append. See the GAP-7 block below
   * for the half of each case the port does not yet reach. */
  it.each([
    ["desc", "desc:acid"],
    ["player-desc", "player-desc:acidic mist"],
    ["blind-desc", "blind-desc:something acrid"],
    ["lash-desc", "lash-desc:oozing slime"],
  ])(
    "%s is a single str field (test_desc0/player_desc0/blind_desc0/lash_desc0)",
    (key, line) => {
      const rec = one("projection", "code:ACID", line);
      expect(rec[key]).toBe(line.slice(line.indexOf(":") + 1));
    },
  );

  it("numerator/divisor/damage-cap are uint (test_numerator0/divisor0/damage_cap0)", () => {
    const rec = one(
      "projection",
      "code:ACID",
      "numerator:8",
      "divisor:12",
      "damage-cap:789",
    );
    expect(rec).toEqual({
      code: "ACID",
      numerator: 8,
      divisor: 12,
      "damage-cap": 789,
    });
  });

  it("rejects a negative numerator, since the field is uint", () => {
    expect(() =>
      compileGamedata("code:ACID\nnumerator:-1\n", spec("projection")),
    ).toThrow(/NOT_NUMBER/);
  });

  it("denominator keeps the raw dice string (test_denominator0)", () => {
    /* parser_getrand validates but the port stores the raw text; Dice parses
     * it in world/projection.ts. "5+2d4" is base 5, 2d4. */
    expect(one("projection", "code:ACID", "denominator:5+2d4")["denominator"]).toBe(
      "5+2d4",
    );
  });

  it("rejects a malformed denominator (NOT_RANDOM)", () => {
    expect(() =>
      compileGamedata("code:ACID\ndenominator:2d8+2d10-3\n", spec("projection")),
    ).toThrow(/NOT_RANDOM/);
  });

  it("msgt / obvious / wake / color are stored verbatim (test_msgt0/obvious0/wake0/color0)", () => {
    const rec = one(
      "projection",
      "code:ACID",
      "msgt:HIT",
      "obvious:1",
      "wake:1",
      "color:u",
    );
    expect(rec).toEqual({
      code: "ACID",
      msgt: "HIT",
      obvious: 1,
      wake: 1,
      color: "u",
    });
  });

  it("keeps a multi-word colour name as one token (test_color0)", () => {
    /* `color sym color` is strtok'd on ':' only, so the space survives and the
     * case-insensitive name match happens in core. */
    expect(one("projection", "code:ACID", "color:Light Red")["color"]).toBe(
      "Light Red",
    );
  });

  /*
   * GAP-7: ordinary scalar directives are last-one-wins.
   *
   * Each of proj.c test_type0 / test_desc0 / test_player_desc0 /
   * test_blind_desc0 / test_lash_desc0 and curse.c test_dice0 parses the
   * directive TWICE ("Try setting it again to see if memory is leaked") and
   * requires PARSE_ERROR_NONE with the second value winning, because every
   * upstream handler string_free's / dice_free's the old value and assigns
   * the new one.
   *
   * Only init.c parse_feat_name and parse_class_magic return
   * PARSE_ERROR_REPEATED_DIRECTIVE, so all other non-accumulating directives
   * silently replace the prior value.
   */
  describe("GAP-7: a restated single-value directive replaces the prior value", () => {
    it.each([
      ["type", "type:element", "type:monster"],
      ["desc", "desc:acid", "desc:caustic substance"],
      ["player-desc", "player-desc:acidic mist", "player-desc:acid"],
      ["blind-desc", "blind-desc:something acrid", "blind-desc:acid"],
      ["lash-desc", "lash-desc:oozing slime", "lash-desc:acid"],
    ])(
      "upstream replaces a second %s: line (test_type0/desc0/player_desc0/blind_desc0/lash_desc0)",
      (key, first, second) => {
        const text = ["code:ACID", first, second, ""].join("\n");
        expect(compileGamedata(text, spec("projection")).records[0]?.[key]).toBe(
          second.slice(second.indexOf(":") + 1),
        );
      },
    );
  });

  it("assembles the whole ELEC record (test_combined0)", () => {
    const rec = one(
      "projection",
      "code:ELEC",
      "name:lightning",
      "type:element",
      "desc:electricity",
      "player-desc:crackling sparks",
      "blind-desc:something crackling",
      "lash-desc:Saint Elmo's fire",
      "numerator:3",
      "denominator:10",
      "divisor:4",
      "damage-cap:1200",
      "msgt:BR_ELEC",
      "obvious:1",
      "wake:1",
      "color:Blue",
    );
    expect(rec).toEqual({
      code: "ELEC",
      name: "lightning",
      type: "element",
      desc: "electricity",
      "player-desc": "crackling sparks",
      "blind-desc": "something crackling",
      "lash-desc": "Saint Elmo's fire",
      numerator: 3,
      denominator: "10",
      divisor: 4,
      "damage-cap": 1200,
      msgt: "BR_ELEC",
      obvious: 1,
      wake: 1,
      color: "Blue",
    });
  });

  it("code: starts a new record, so record order is the element order (test_code_mismatch0)", () => {
    /* parse_projection_code's index is "previous index + 1", which is exactly
     * the port's record position. bindProjections checks the position against
     * list-elements.h; here it only pins that the positions are what it will
     * see. */
    const out = compileGamedata(
      "code:ACID\nname:acid\ncode:POIS\nname:poison\n",
      spec("projection"),
    );
    expect(out.records.map((r) => r["code"])).toEqual(["ACID", "POIS"]);
  });
});

/* ------------------------------------------------------------------ *
 * f-info.c -- terrain.txt
 * ------------------------------------------------------------------ */

describe("f-info.c: terrain field extraction and string_append", () => {
  it("graphics: takes a bare colon as the glyph (test_graphics0)", () => {
    /* `graphics char glyph sym color` on "graphics:::Light Green": the char
     * field consumes exactly one character - here the ':' - then expects a
     * ':' separator. Getting this wrong makes the whole line MISSING_FIELD. */
    expect(one("terrain", "code:FLOOR", "graphics:::Light Green")["graphics"]).toEqual(
      { glyph: ":", color: "Light Green" },
    );
  });

  it("graphics: accepts the one-letter colour and a multi-word name (test_graphics0)", () => {
    expect(one("terrain", "code:FLOOR", "graphics:^:b")["graphics"]).toEqual({
      glyph: "^",
      color: "b",
    });
    expect(one("terrain", "code:FLOOR", "graphics:#:light purple")["graphics"]).toEqual(
      { glyph: "#", color: "light purple" },
    );
  });

  it("graphics: accepts a non-ASCII glyph (test_graphics0, UTF-8 branch)", () => {
    /* Upstream runs this only where nl_langinfo says UTF-8; the port is
     * always UTF-16, so the yen sign is one code point either way. */
    expect(one("terrain", "code:FLOOR", "graphics:¥:red")["graphics"]).toEqual({
      glyph: "¥",
      color: "red",
    });
  });

  it("rejects a two-character glyph (FIELD_TOO_LONG)", () => {
    expect(() =>
      compileGamedata("code:FLOOR\ngraphics:ab:red\n", spec("terrain")),
    ).toThrow(/FIELD_TOO_LONG/);
  });

  it("mimic: and priority: are plain fields (test_mimic0, test_priority0)", () => {
    const rec = one("terrain", "code:FLOOR", "mimic:GRANITE", "priority:2");
    expect(rec).toEqual({ code: "FLOOR", mimic: "GRANITE", priority: 2 });
  });

  it("digging: is an int, so a bad value reaches core unchanged (test_digging0)", () => {
    expect(one("terrain", "code:FLOOR", "digging:2")["digging"]).toBe(2);
    /* test_digging_bad0's two values are grammatical; the bounds check is
     * core's (see parse-objterrain.upstream.test.ts). */
    expect(one("terrain", "code:FLOOR", "digging:0")["digging"]).toBe(0);
    expect(one("terrain", "code:FLOOR", "digging:6")["digging"]).toBe(6);
  });

  it("flags: with no value is legal and adds nothing (test_flags0)", () => {
    /* `flags ?str flags`; parse_feat_flags returns PARSE_ERROR_NONE when
     * !parser_hasval. The port stores the optional-absent presence marker. */
    expect(one("terrain", "code:FLOOR", "flags:")["flags"]).toEqual([true]);
  });

  it("flags: accumulates across lines in file order (test_flags0)", () => {
    expect(
      one("terrain", "code:FLOOR", "flags:LOS", "flags:PERMANENT | DOWNSTAIR")[
        "flags"
      ],
    ).toEqual(["LOS", "PERMANENT | DOWNSTAIR"]);
  });

  /* The seven string_append fields. Upstream concatenates with NO separator,
   * so leading/trailing spaces in the source lines are load-bearing and the
   * array must preserve them exactly; core's joinLines does the join. */
  it.each([
    ["desc", "A door that is already open.", "  Player can pass through."],
    ["walk-msg", "It looks dangerous.", "  Really enter? "],
    ["run-msg", "It blocks your path.", "  Really enter? "],
    ["hurt-msg", "Ow!", "  That hurt!"],
    ["die-msg", "dissolving", " in a pool of acid"],
    ["confused-msg", "slams into a wall", " and stumbles"],
    ["look-prefix", "the entrance ", "to the"],
    ["look-in-preposition", "at the ", "brink of"],
  ])(
    "%s appends rather than replaces (test_desc0/walk_msg0/run_msg0/hurt_msg0/die_msg0/confused_msg0/look_prefix0/look_in_preposition0)",
    (key, first, second) => {
      const rec = one("terrain", "code:FLOOR", `${key}:${first}`, `${key}:${second}`);
      expect(rec[key]).toEqual([first, second]);
      expect((rec[key] as string[]).join("")).toBe(first + second);
    },
  );

  it("resist-flag: is a sym field (test_resist_flag0)", () => {
    expect(one("terrain", "code:FLOOR", "resist-flag:IM_POIS")["resist-flag"]).toEqual(
      ["IM_POIS"],
    );
  });
});

/* ------------------------------------------------------------------ *
 * pit.c -- pit.txt
 * ------------------------------------------------------------------ */

describe("pit.c: pit field extraction", () => {
  it("a name:-only record carries nothing else (test_name0)", () => {
    expect(one("pit", "name:Orc")).toEqual({ name: "Orc" });
  });

  it("room:, alloc: and obj-rarity: (test_room0, test_alloc0, test_obj_rarity0)", () => {
    /* `alloc uint rarity uint level`: "alloc:1:25" is rarity 1, ave 25 - the
     * order is rarity-then-level, and swapping them silently changes which
     * pit set_pit_type picks. */
    const rec = one("pit", "name:Orc", "room:1", "alloc:1:25", "obj-rarity:5");
    expect(rec).toEqual({
      name: "Orc",
      room: 1,
      alloc: { rarity: 1, level: 25 },
      "obj-rarity": 5,
    });
  });

  it("mon-base, mon-ban and color accumulate in FILE order (test_mon_base0, test_mon_ban0, test_color0)", () => {
    /* Upstream PREPENDS each of these three to a linked list, so its
     * head is the last line parsed. Every consumer (mon_pit_hook) only ever
     * asks "is X anywhere in this list", so the port keeps file order; the
     * upstream head-is-last assertion is a representation difference, not a
     * behavioural one. */
    const rec = one(
      "pit",
      "name:Orc",
      "mon-base:ancient dragon",
      "mon-base:ant",
      "mon-ban:wimpy gremlin",
      "mon-ban:ubergremlin",
      "color:Light Green",
      "color:y",
    );
    expect(rec["mon-base"]).toEqual(["ancient dragon", "ant"]);
    expect(rec["mon-ban"]).toEqual(["wimpy gremlin", "ubergremlin"]);
    expect(rec["color"]).toEqual(["Light Green", "y"]);
  });

  it.each(["flags-req", "flags-ban", "spell-req", "spell-ban"])(
    "%s: with no value is legal (test_flags_req0/flags_ban0/spell_req0/spell_ban0)",
    (key) => {
      expect(one("pit", "name:Orc", `${key}:`)[key]).toEqual([true]);
    },
  );

  it("flags-ban tolerates a missing space around the pipe (test_flags_ban0)", () => {
    /* Upstream strtok's on " |", so "PASS_WALL| KILL_WALL" is two tokens. */
    expect(
      one("pit", "name:Orc", "flags-ban:PASS_WALL| KILL_WALL")["flags-ban"],
    ).toEqual(["PASS_WALL| KILL_WALL"]);
  });

  it("innate-freq is a signed int, so -1 survives to core (test_innate_freq0/bad0)", () => {
    expect(one("pit", "name:Orc", "innate-freq:4")["innate-freq"]).toBe(4);
    expect(one("pit", "name:Orc", "innate-freq:-1")["innate-freq"]).toBe(-1);
    expect(one("pit", "name:Orc", "innate-freq:101")["innate-freq"]).toBe(101);
  });
});

/* ------------------------------------------------------------------ *
 * shape.c -- shape.txt
 * ------------------------------------------------------------------ */

describe("shape.c: shape field extraction and the effect group", () => {
  it("combat: is to-h, to-d, to-a in that order (test_combat0)", () => {
    /* parse_shape_combat reads to-h, to-d, to-a; "combat:5:2:-2" is
     * to_h 5, to_d 2, to_a -2. */
    expect(one("shape", "name:fox", "combat:5:2:-2")["combat"]).toEqual({
      "to-h": 5,
      "to-d": 2,
      "to-a": -2,
    });
  });

  it.each([
    ["skill-disarm-phys", -5],
    ["skill-disarm-magic", -10],
    ["skill-save", 20],
    ["skill-stealth", -7],
    ["skill-search", 12],
    ["skill-melee", 9],
    ["skill-throw", 3],
    ["skill-dig", 8],
  ])(
    "%s is a signed int (test_disarm_phys0/disarm_magic0/save0/stealth0/search0/melee0/throw0/dig0)",
    (key, value) => {
      expect(one("shape", "name:fox", `${key}:${String(value)}`)[key]).toBe(value);
    },
  );

  it.each(["obj-flags", "player-flags"])(
    "%s: with no value is legal (test_obj_flags0, test_player_flags0)",
    (key) => {
      expect(one("shape", "name:fox", `${key}:`)[key]).toEqual([true]);
    },
  );

  it("obj-flags / player-flags / values accumulate (test_obj_flags0/player_flags0/values0)", () => {
    const rec = one(
      "shape",
      "name:fox",
      "obj-flags:FEATHER",
      "obj-flags:FREE_ACT | REGEN",
      "player-flags:STEAL",
      "player-flags:SEE_ORE | ROCK",
      "values:STR[-2]",
      "values:RES_POIS[3] | STEALTH[4]",
    );
    expect(rec["obj-flags"]).toEqual(["FEATHER", "FREE_ACT | REGEN"]);
    expect(rec["player-flags"]).toEqual(["STEAL", "SEE_ORE | ROCK"]);
    expect(rec["values"]).toEqual(["STR[-2]", "RES_POIS[3] | STEALTH[4]"]);
  });

  it("effect: takes 1 to 4 fields and each starts a new group (test_effect0)", () => {
    const rec = one(
      "shape",
      "name:fox",
      "effect:DAMAGE",
      "effect:CURE:POISONED",
      "effect:SPOT:LIGHT_WEAK:2",
      "effect:TIMED_INC:SHERO:0:5",
    );
    expect(rec["effect"]).toEqual([
      { eff: "DAMAGE" },
      { eff: "CURE", type: "POISONED" },
      { eff: "SPOT", type: "LIGHT_WEAK", radius: 2 },
      { eff: "TIMED_INC", type: "SHERO", radius: 0, other: 5 },
    ]);
  });

  it("effect-yx / dice / expr / effect-msg attach to the LAST effect (test_effect_yx0, test_dice0, test_expr0, test_effect_msg0)", () => {
    const rec = one(
      "shape",
      "name:fox",
      "effect:DAMAGE",
      "effect:SPOT:FIRE:1",
      "effect-yx:7:15",
      "dice:$B+4d$S",
      "expr:B:PLAYER_LEVEL:* 2",
      "effect-msg:turning into",
      "effect-msg: a bat",
    );
    expect(rec["effect"]).toEqual([
      { eff: "DAMAGE" },
      {
        eff: "SPOT",
        type: "FIRE",
        radius: 1,
        "effect-yx": { y: 7, x: 15 },
        dice: "$B+4d$S",
        expr: [{ name: "B", base: "PLAYER_LEVEL", expr: "* 2" }],
        "effect-msg": ["turning into", " a bat"],
      },
    ]);
  });

  it("effect deps before any effect: are not an error (test_missing_effect0)", () => {
    /* Each upstream handler returns PARSE_ERROR_NONE with "assume that this
     * is human and not parser error"; the port parks the orphans on the
     * record so no `effect` key appears at all. */
    const rec = one(
      "shape",
      "name:fox",
      "effect-yx:7:15",
      "dice:7+2d$S",
      "expr:S:PLAYER_LEVEL:* 2",
      "effect-msg:turning into a vampire",
    );
    expect(rec["effect"]).toBeUndefined();
  });

  it("an expr: with no dice: on the effect is not an error either (test_missing_dice0)", () => {
    const rec = one(
      "shape",
      "name:fox",
      "effect:DAMAGE",
      "expr:S:PLAYER_LEVEL:/ 5 + 2",
    );
    const effects = rec["effect"] as JsonObject[];
    expect(effects[0]?.["dice"]).toBeUndefined();
    expect(effects[0]?.["expr"]).toEqual([
      { name: "S", base: "PLAYER_LEVEL", expr: "/ 5 + 2" },
    ]);
  });

  it("dice: keeps the raw string; a malformed one is NOT_RANDOM at core (test_dice_bad0)", () => {
    /* `dice str dice` is a str field, so "2d8+2d10-3" compiles; INVALID_DICE
     * comes from Dice.parseString in core. */
    const rec = one("shape", "name:fox", "effect:DAMAGE", "dice:2d8+2d10-3");
    expect((rec["effect"] as JsonObject[])[0]?.["dice"]).toBe("2d8+2d10-3");
  });

  it("blow: accumulates in file order, duplicates included (test_blow0)", () => {
    /* Upstream prepends and bumps num_blows, so "bite bite sting" yields the
     * list sting/bite/bite and num_blows 3. Blows are only ever picked at
     * random from the set, so the port keeps file order and the count is the
     * array length. */
    const rec = one("shape", "name:fox", "blow:bite", "blow:bite", "blow:sting");
    expect(rec["blow"]).toEqual(["bite", "bite", "sting"]);
  });
});

/* ------------------------------------------------------------------ *
 * p-info.c -- p_race.txt
 * ------------------------------------------------------------------ */

describe("p-info.c: player race field extraction", () => {
  it("stats: is str,int,wis,dex,con in that order (test_stats0)", () => {
    expect(one("p_race", "name:Half-Elf", "stats:1:-1:2:-2:3")["stats"]).toEqual({
      str: 1,
      int: -1,
      wis: 2,
      dex: -2,
      con: 3,
    });
  });

  it.each([
    ["skill-disarm-magic", 1],
    ["skill-device", 3],
    ["skill-save", 5],
    ["skill-stealth", 7],
    ["skill-search", 9],
    ["skill-melee", 4],
    ["skill-shoot", 6],
    ["skill-throw", 8],
    ["skill-dig", 10],
  ])(
    "%s is one signed int, not the class base/incr pair (test_skill_disarm0/device0/save0/stealth0/search0/melee0/shoot0/throw0/dig0)",
    (key, value) => {
      expect(one("p_race", "name:Half-Elf", `${key}:${String(value)}`)[key]).toBe(
        value,
      );
    },
  );

  it("hitdie / exp / infravision / history (test_hitdie0, test_exp0, test_infravision0, test_history0)", () => {
    const rec = one(
      "p_race",
      "name:Half-Elf",
      "hitdie:10",
      "exp:120",
      "infravision:2",
      "history:4",
    );
    expect(rec).toEqual({
      name: "Half-Elf",
      hitdie: 10,
      exp: 120,
      infravision: 2,
      history: 4,
    });
  });

  it("history: is uint, so a negative chart is NOT_NUMBER", () => {
    expect(() =>
      compileGamedata("name:Half-Elf\nhistory:-1\n", spec("p_race")),
    ).toThrow(/NOT_NUMBER/);
  });

  it("age / height / weight are base+mod pairs (test_age0, test_height0, test_weight0)", () => {
    const rec = one(
      "p_race",
      "name:Half-Elf",
      "age:24:16",
      "height:71:8",
      "weight:115:25",
    );
    expect(rec["age"]).toEqual({ base_age: 24, mod_age: 16 });
    expect(rec["height"]).toEqual({ base_hgt: 71, mod_hgt: 8 });
    expect(rec["weight"]).toEqual({ base_wgt: 115, mod_wgt: 25 });
  });

  it.each(["obj-flags", "player-flags"])(
    "%s: with no value is legal (test_obj_flags0, test_play_flags0)",
    (key) => {
      expect(one("p_race", "name:Half-Elf", `${key}:`)[key]).toEqual([true]);
    },
  );

  it("obj-flags / player-flags / values accumulate (test_obj_flags0/play_flags0/values0)", () => {
    const rec = one(
      "p_race",
      "name:Half-Elf",
      "obj-flags:SUST_DEX",
      "obj-flags:HOLD_LIFE | FREE_ACT",
      "player-flags:KNOW_ZAPPER",
      "player-flags:SEE_ORE | KNOW_MUSHROOM",
      "values:RES_DARK[1]",
      "values:RES_FIRE[1] | RES_COLD[-1]",
    );
    expect(rec["obj-flags"]).toEqual(["SUST_DEX", "HOLD_LIFE | FREE_ACT"]);
    expect(rec["player-flags"]).toEqual([
      "KNOW_ZAPPER",
      "SEE_ORE | KNOW_MUSHROOM",
    ]);
    expect(rec["values"]).toEqual(["RES_DARK[1]", "RES_FIRE[1] | RES_COLD[-1]"]);
  });
});

/* ------------------------------------------------------------------ *
 * curse.c -- curse.txt
 * ------------------------------------------------------------------ */

describe("curse.c: curse field extraction and the effect group", () => {
  it("type: accumulates, one tval per line (test_type0)", () => {
    expect(one("curse", "name:test curse", "type:cloak", "type:helm")["type"]).toEqual(
      ["cloak", "helm"],
    );
  });

  it("weight: is a signed int, so the int16 check is core's (test_weight0, test_weight_bad0)", () => {
    expect(one("curse", "name:test curse", "weight:-42")["weight"]).toBe(-42);
    expect(one("curse", "name:test curse", "weight:32769")["weight"]).toBe(32769);
    expect(one("curse", "name:test curse", "weight:-32780")["weight"]).toBe(-32780);
  });

  it("combat: is to-h, to-d, to-a (test_combat0)", () => {
    expect(one("curse", "name:test curse", "combat:1:-2:3")["combat"]).toEqual({
      "to-h": 1,
      "to-d": -2,
      "to-a": 3,
    });
  });

  it("effect: fields and the effect-yx / dice / expr children (test_effect0, test_effect_yx0, test_dice0, test_expr0)", () => {
    const rec = one(
      "curse",
      "name:test curse",
      "effect:DAMAGE",
      "effect:TIMED_INC:POISONED",
      "effect:SPOT:FIRE:3",
      "effect:SPOT:DARK_WEAK:2:5",
      "effect-yx:6:8",
      "dice:8+2d10",
      "expr:B:PLAYER_HP:/ 8",
    );
    expect(rec["effect"]).toEqual([
      { eff: "DAMAGE" },
      { eff: "TIMED_INC", type: "POISONED" },
      { eff: "SPOT", type: "FIRE", radius: 3 },
      {
        eff: "SPOT",
        type: "DARK_WEAK",
        radius: 2,
        other: 5,
        "effect-yx": { y: 6, x: 8 },
        dice: "8+2d10",
        expr: [{ name: "B", base: "PLAYER_HP", expr: "/ 8" }],
      },
    ]);
  });

  it("GAP-7: a second dice: on one effect replaces the first (test_dice0)", () => {
    /* parse_curse_dice dice_free's the old dice and stores the new one, so
     * upstream returns PARSE_ERROR_NONE with -4+4d8 winning over 8+2d10. */
    expect(
      compileGamedata(
        "name:test curse\neffect:DAMAGE\ndice:8+2d10\ndice:-4+4d8\n",
        spec("curse"),
      ).records[0]?.["effect"],
    ).toEqual([{ eff: "DAMAGE", dice: "-4+4d8" }]);
  });

  it("effect deps before any effect: are not an error (test_missing_dice0)", () => {
    const rec = one("curse", "name:test curse", "effect-yx:6:8", "dice:8+2d10");
    expect(rec["effect"]).toBeUndefined();
  });

  it("expr: accumulates on one effect (test_expr0, test_expr_bad0)", () => {
    const rec = one(
      "curse",
      "name:test curse",
      "effect:DAMAGE",
      "dice:10+$Ad6",
      "expr:A:PLAYER_LEVEL:% 8",
      "expr:B:DUNGEON_LEVEL:+ 0",
    );
    expect((rec["effect"] as JsonObject[])[0]?.["expr"]).toEqual([
      { name: "A", base: "PLAYER_LEVEL", expr: "% 8" },
      { name: "B", base: "DUNGEON_LEVEL", expr: "+ 0" },
    ]);
  });

  it("msg: and desc: append; conflict: accumulates (test_msg0, test_desc0, test_conflict0)", () => {
    const rec = one(
      "curse",
      "name:test curse",
      "msg:Your equipment grabs you!",
      "msg: And doesn't let go!",
      "desc:makes you frail",
      "desc: and clumsy",
      "conflict:chilled to the bone",
      "conflict:burning up",
    );
    expect(rec["msg"]).toEqual([
      "Your equipment grabs you!",
      " And doesn't let go!",
    ]);
    expect(rec["desc"]).toEqual(["makes you frail", " and clumsy"]);
    /* parse_curse_conflict wraps each name in pipes and appends, giving
     * "|a||b|"; core's bindCurses rebuilds exactly that from this array. */
    expect(rec["conflict"]).toEqual(["chilled to the bone", "burning up"]);
  });

  it("time: keeps the raw dice string (test_time0)", () => {
    expect(one("curse", "name:test curse", "time:9+10d8")["time"]).toBe("9+10d8");
  });

  it("flags: and conflict-flags: accumulate (test_flags0, test_conflict_flags0)", () => {
    const rec = one(
      "curse",
      "name:test curse",
      "flags:AGGRAVATE",
      "flags:HATES_FIRE | IGNORE_ACID",
      "conflict-flags:AFRAID",
      "conflict-flags:PROT_FEAR | NO_TELEPORT",
    );
    expect(rec["flags"]).toEqual(["AGGRAVATE", "HATES_FIRE | IGNORE_ACID"]);
    expect(rec["conflict-flags"]).toEqual([
      "AFRAID",
      "PROT_FEAR | NO_TELEPORT",
    ]);
  });

  it("values: accumulates (test_values0)", () => {
    expect(
      one(
        "curse",
        "name:test curse",
        "values:SPEED[-2]",
        "values:STEALTH[4] | RES_ELEC[3]",
      )["values"],
    ).toEqual(["SPEED[-2]", "STEALTH[4] | RES_ELEC[3]"]);
  });

  it("assembles the whole combined record (test_combined0)", () => {
    const rec = one(
      "curse",
      "name:the body is willing but the mind is weak",
      "type:helm",
      "effect:CURE:POISONED",
      "effect:TIMED_DEC:CUT",
      "dice:20",
      "effect:RESTORE_STAT:STR",
      "effect:RESTORE_STAT:CON",
      "effect:DRAIN_MANA",
      "dice:15",
      "effect:TIMED_INC:CONFUSED",
      "dice:20+1d20",
      "time:99+1d100",
      "conflict:sickliness",
      "conflict:poison",
      "conflict-flags:SUST_STR | SUST_CON",
      "msg:Your body feels invigorated while your mind descends into a fog.",
      "desc:periodically strengthens the body while weakening the mind",
    );
    /* Each dice: lands on the effect immediately above it, never on the
     * first effect of the record - the whole point of childOf. */
    expect(rec["effect"]).toEqual([
      { eff: "CURE", type: "POISONED" },
      { eff: "TIMED_DEC", type: "CUT", dice: "20" },
      { eff: "RESTORE_STAT", type: "STR" },
      { eff: "RESTORE_STAT", type: "CON" },
      { eff: "DRAIN_MANA", dice: "15" },
      { eff: "TIMED_INC", type: "CONFUSED", dice: "20+1d20" },
    ]);
    expect(rec["time"]).toBe("99+1d100");
    expect(rec["conflict"]).toEqual(["sickliness", "poison"]);
  });
});

/* ------------------------------------------------------------------ *
 * mspell.c -- monster_spell.txt
 * ------------------------------------------------------------------ */

describe("mspell.c: monster spell field extraction", () => {
  it("msgt: and hit: (test_msgt0, test_msgt_bad0, test_hit0)", () => {
    /* `msgt sym type` and `hit uint hit`. "XYZZY" is grammatical, so
     * INVALID_MESSAGE is core's check. */
    const rec = one("monster_spell", "name:BLINK", "msgt:TELEPORT", "hit:100");
    expect(rec).toEqual({ name: "BLINK", msgt: "TELEPORT", hit: 100 });
    expect(one("monster_spell", "name:BLINK", "msgt:XYZZY")["msgt"]).toBe("XYZZY");
  });

  it("effect: fields and the effect-yx child (test_effect0, test_effect_yx0)", () => {
    const rec = one(
      "monster_spell",
      "name:BLINK",
      "effect:DAMAGE",
      "effect:TIMED_INC:CONFUSED",
      "effect:BALL:ACID:2",
      "effect:BREATH:FIRE:10:30",
      "effect-yx:5:9",
    );
    expect(rec["effect"]).toEqual([
      { eff: "DAMAGE" },
      { eff: "TIMED_INC", type: "CONFUSED" },
      { eff: "BALL", type: "ACID", radius: 2 },
      {
        eff: "BREATH",
        type: "FIRE",
        radius: 10,
        other: 30,
        "effect-yx": { y: 5, x: 9 },
      },
    ]);
  });

  it.each([
    ["dice:-1", "-1"],
    ["dice:8", "8"],
    ["dice:d10", "d10"],
    ["dice:-1+d5", "-1+d5"],
    ["dice:3+2d7", "3+2d7"],
    ["dice:5+d8+d4", "5+d8+d4"],
  ])(
    "%s is stored raw for core's Dice to judge (test_dice0, test_dice_bad0)",
    (line, expected) => {
      const rec = one("monster_spell", "name:BLINK", "effect:DAMAGE", line);
      expect((rec["effect"] as JsonObject[])[0]?.["dice"]).toBe(expected);
    },
  );

  it("expr: accumulates on the effect (test_expr0, test_expr_bad0)", () => {
    const rec = one(
      "monster_spell",
      "name:BLINK",
      "effect:DAMAGE",
      "dice:$B+$Dd$S",
      "expr:B:MAX_SIGHT: ",
      "expr:D:SPELL_POWER:/ 10 + 1",
      "expr:S:SPELL_POWER:* 2 + 3",
    );
    expect((rec["effect"] as JsonObject[])[0]?.["expr"]).toEqual([
      { name: "B", base: "MAX_SIGHT", expr: " " },
      { name: "D", base: "SPELL_POWER", expr: "/ 10 + 1" },
      { name: "S", base: "SPELL_POWER", expr: "* 2 + 3" },
    ]);
  });

  it("the three lore colours belong to the current level (test_lore_color0/resist0/immune0)", () => {
    /* Before any power-cutoff they sit on the record (spell->level, the
     * implicit first level); after one they sit under it. */
    const rec = one(
      "monster_spell",
      "name:BLINK",
      "lore-color-base:Orange",
      "lore-color-resist:Yellow",
      "lore-color-immune:Light Green",
      "power-cutoff:10",
      "lore-color-base:o",
      "lore-color-resist:G",
      "lore-color-immune:u",
    );
    expect(rec["lore-color-base"]).toBe("Orange");
    expect(rec["lore-color-resist"]).toBe("Yellow");
    expect(rec["lore-color-immune"]).toBe("Light Green");
    expect((rec["power-cutoff"] as JsonObject[])[0]).toEqual({
      power: 10,
      "lore-color-base": "o",
      "lore-color-resist": "G",
      "lore-color-immune": "u",
    });
  });

  it.each([
    ["message-vis", "${name} cackles", " evilly."],
    ["message-invis", "Something cackles", " evilly."],
    ["message-miss", "${name} gestures", " but then stumbles."],
    ["message-save", "You duck", " and are shaken but unharmed."],
  ])(
    "%s appends rather than replaces (test_message_vis0/invis0/miss0/save0)",
    (key, first, second) => {
      const rec = one(
        "monster_spell",
        "name:BLINK",
        `${key}:${first}`,
        `${key}:${second}`,
      );
      expect(rec[key]).toEqual([first, second]);
      expect((rec[key] as string[]).join("")).toBe(first + second);
    },
  );
});

/* ------------------------------------------------------------------ *
 * a-info.c -- artifact.txt
 * ------------------------------------------------------------------ */

describe("a-info.c: artifact field extraction", () => {
  it("base-object: keeps a numeric tval as text for tval_find_idx (test_badtval1)", () => {
    /* "-1" is a legal sym token; tval_find_idx rejects it in core. */
    expect(one("artifact", "name:of Thrain", "base-object:-1:Junk")["base-object"]).toEqual(
      { tval: "-1", sval: "Junk" },
    );
    expect(
      one("artifact", "name:of Thrain", "base-object:light:Arkenstone")["base-object"],
    ).toEqual({ tval: "light", sval: "Arkenstone" });
  });

  it("graphics: glyph and colour (test_graphics0)", () => {
    expect(one("artifact", "name:of Thrain", "graphics:&:b")["graphics"]).toEqual({
      glyph: "&",
      color: "b",
    });
    expect(
      one("artifact", "name:of Thrain", "graphics:+:light green")["graphics"],
    ).toEqual({ glyph: "+", color: "light green" });
  });

  it("level / weight / cost are signed ints (test_level0, test_weight0, test_cost0)", () => {
    expect(
      one("artifact", "name:of Thrain", "level:3", "weight:8", "cost:200"),
    ).toEqual({ name: "of Thrain", level: 3, weight: 8, cost: 200 });
  });

  it("alloc: is `int common` plus a raw minmax string (test_alloc0, test_alloc1, test_alloc2)", () => {
    /* All three upstream cases are grammatical here; INVALID_ALLOCATION for
     * "5" and OUT_OF_BOUNDS for "5 to 300" are grab_int_range's job in
     * core, which is why the string is kept raw. */
    expect(one("artifact", "name:of Thrain", "alloc:3:5")["alloc"]).toEqual({
      common: 3,
      minmax: "5",
    });
    expect(one("artifact", "name:of Thrain", "alloc:3:5 to 300")["alloc"]).toEqual({
      common: 3,
      minmax: "5 to 300",
    });
    expect(one("artifact", "name:of Thrain", "alloc:3:5 to 10")["alloc"]).toEqual({
      common: 3,
      minmax: "5 to 10",
    });
  });

  it("attack: is `rand hd` then two ints (test_attack0)", () => {
    /* The artifact form differs from the object form: to-h and to-d are
     * plain ints here, dice only for the damage. */
    expect(one("artifact", "name:of Thrain", "attack:4d5:8:2")["attack"]).toEqual({
      hd: "4d5",
      "to-h": 8,
      "to-d": 2,
    });
  });

  it("armor: is ac then to-a (test_armor0)", () => {
    expect(one("artifact", "name:of Thrain", "armor:3:1")["armor"]).toEqual({
      ac: 3,
      "to-a": 1,
    });
  });

  it("flags: with no value is legal and flags accumulate (test_flags0)", () => {
    expect(one("artifact", "name:of Thrain", "flags:")["flags"]).toEqual([true]);
    const rec = one(
      "artifact",
      "name:of Thrain",
      "flags:SEE_INVIS | HOLD_LIFE",
      "flags:HATES_FIRE",
    );
    expect(rec["flags"]).toEqual(["SEE_INVIS | HOLD_LIFE", "HATES_FIRE"]);
  });

  it("act: and time: (test_act0, test_time0)", () => {
    const rec = one(
      "artifact",
      "name:of Thrain",
      "act:CLAIRVOYANCE",
      "time:20+d30",
    );
    expect(rec).toEqual({
      name: "of Thrain",
      act: "CLAIRVOYANCE",
      time: "20+d30",
    });
  });

  it("msg: and desc: append (test_msg0, test_desc0)", () => {
    const rec = one(
      "artifact",
      "name:of Thrain",
      "msg:foo",
      "msg:bar",
      "desc:baz",
      "desc: quxx",
    );
    expect(rec["msg"]).toEqual(["foo", "bar"]);
    expect((rec["msg"] as string[]).join("")).toBe("foobar");
    expect(rec["desc"]).toEqual(["baz", " quxx"]);
    expect((rec["desc"] as string[]).join("")).toBe("baz quxx");
  });

  it("values: accumulates (test_values0)", () => {
    expect(
      one("artifact", "name:of Thrain", "values:STR[1] | CON[1]", "values:RES_ACID[-1]")[
        "values"
      ],
    ).toEqual(["STR[1] | CON[1]", "RES_ACID[-1]"]);
  });

  it("slay: and brand: accumulate (test_slay0, test_brand0)", () => {
    const rec = one(
      "artifact",
      "name:of Thrain",
      "slay:ANIMAL_2",
      "brand:ACID_3",
    );
    expect(rec["slay"]).toEqual(["ANIMAL_2"]);
    expect(rec["brand"]).toEqual(["ACID_3"]);
  });

  it("curse: is a name/power pair per line, power kept signed (test_curse0)", () => {
    /* Upstream only stores a curse whose power is > 0 but never errors on a
     * non-positive one, so the zero and the negative must survive the
     * compile for core's `power > 0` gate to be the thing that drops them. */
    const rec = one(
      "artifact",
      "name:of Thrain",
      "curse:vulnerability:0",
      "curse:vulnerability:-7",
      "curse:teleportation:15",
    );
    expect(rec["curse"]).toEqual([
      { name: "vulnerability", power: 0 },
      { name: "vulnerability", power: -7 },
      { name: "teleportation", power: 15 },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * e-info.c -- ego_item.txt
 * ------------------------------------------------------------------ */

describe("e-info.c: ego item field extraction", () => {
  it("info: is cost then rating (test_info0)", () => {
    expect(one("ego_item", "name:of Testing", "info:6:8")["info"]).toEqual({
      cost: 6,
      rating: 8,
    });
  });

  it("alloc: keeps the minmax string raw (test_alloc0)", () => {
    expect(one("ego_item", "name:of Testing", "alloc:40:10 to 100")["alloc"]).toEqual({
      common: 40,
      minmax: "10 to 100",
    });
  });

  it("type: and item: accumulate (test_type0, test_item0)", () => {
    const rec = one(
      "ego_item",
      "name:of Testing",
      "type:sword",
      "type:polearm",
      "item:helm:Skullcap",
    );
    expect(rec["type"]).toEqual(["sword", "polearm"]);
    expect(rec["item"]).toEqual([{ tval: "helm", sval: "Skullcap" }]);
  });

  it("combat: is three rand fields, min-combat: three ints (test_combat0, test_min0)", () => {
    /* This is the pair most easily got wrong: the ego to-hit/to-dam/to-ac are
     * dice, its minima are plain ints. */
    const rec = one(
      "ego_item",
      "name:of Testing",
      "combat:1d2:3d4:5d6",
      "min-combat:10:13:4",
    );
    expect(rec["combat"]).toEqual({ th: "1d2", td: "3d4", ta: "5d6" });
    expect(rec["min-combat"]).toEqual({ th: 10, td: 13, ta: 4 });
  });

  it("act: and time: (test_act0, test_act_bad0, test_time0)", () => {
    /* test_act_bad0's "XYZZY" is grammatical and upstream does NOT error on
     * it - findact simply returns NULL - so it has to compile. */
    expect(one("ego_item", "name:of Testing", "act:ILLUMINATION")["act"]).toBe(
      "ILLUMINATION",
    );
    expect(one("ego_item", "name:of Testing", "act:XYZZY")["act"]).toBe("XYZZY");
    expect(one("ego_item", "name:of Testing", "time:100+1d200")["time"]).toBe(
      "100+1d200",
    );
  });

  it.each(["flags", "flags-off"])(
    "%s: with no value is legal (test_flags0, test_flags_off0)",
    (key) => {
      expect(one("ego_item", "name:of Testing", `${key}:`)[key]).toEqual([true]);
    },
  );

  it("flags / flags-off / values / min-values accumulate (test_flags0/flags_off0/values0/min_values0)", () => {
    const rec = one(
      "ego_item",
      "name:of Testing",
      "flags:SEE_INVIS",
      "flags:RAND_POWER | IGNORE_ACID",
      "flags-off:FEATHER",
      "flags-off:SEE_INVIS | PROT_FEAR",
      "values:STEALTH[1+2d3]",
      "values:INFRA[3] | RES_POIS[1]",
      "min-values:SPEED[1]",
      "min-values:STEALTH[2] | INFRA[4]",
    );
    expect(rec["flags"]).toEqual(["SEE_INVIS", "RAND_POWER | IGNORE_ACID"]);
    expect(rec["flags-off"]).toEqual(["FEATHER", "SEE_INVIS | PROT_FEAR"]);
    expect(rec["values"]).toEqual(["STEALTH[1+2d3]", "INFRA[3] | RES_POIS[1]"]);
    expect(rec["min-values"]).toEqual(["SPEED[1]", "STEALTH[2] | INFRA[4]"]);
  });

  it("desc: appends (test_desc0)", () => {
    const rec = one("ego_item", "name:of Testing", "desc:foo", "desc: bar");
    expect(rec["desc"]).toEqual(["foo", " bar"]);
    expect((rec["desc"] as string[]).join("")).toBe("foo bar");
  });

  it("slay / brand / curse (test_slay0, test_brand0, test_curse0)", () => {
    const rec = one(
      "ego_item",
      "name:of Testing",
      "slay:ANIMAL_2",
      "brand:COLD_2",
      "curse:teleportation:0",
      "curse:teleportation:-8",
      "curse:vulnerability:12",
    );
    expect(rec["slay"]).toEqual(["ANIMAL_2"]);
    expect(rec["brand"]).toEqual(["COLD_2"]);
    expect(rec["curse"]).toEqual([
      { name: "teleportation", power: 0 },
      { name: "teleportation", power: -8 },
      { name: "vulnerability", power: 12 },
    ]);
  });
});
