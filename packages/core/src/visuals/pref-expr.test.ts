/**
 * process_pref_file_expr (ui-prefs.c L453-575), the `?:` expression language.
 *
 * Why this file exists, measured 2026-07-31: the evaluator this replaced matched
 * ONE bracket level with a regular expression, so the nested
 * `[AND [EQU $CLASS Ranger] [EQU $RACE Hobbit] ]` shape that every shipped
 * xtra-*.prf uses split into six bare tokens, none of which was "0", and the AND
 * came out TRUE. Combined with no $RACE/$CLASS being supplied at all, that meant
 * all 132 of xtra-shb.prf's `monster:<player>` lines applied in file order and
 * the LAST one won - so every Shockbolt character, whatever its race and class,
 * drew the female Kobold Paladin sprite at 0x84:0xF2.
 *
 * The integration test at the bottom is the one that matters: it runs the REAL
 * shipped pack through the real parser and asserts the tile a Hobbit Ranger
 * gets. The unit tests above it pin the semantics that make that work, including
 * two that look like bugs and are upstream's behaviour.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { parseTilePrefs } from "./prefs.js";
import {
  PREF_EXPR_MALFORMED,
  PREF_EXPR_UNKNOWN,
  evalPrefExpr,
  prefExprBypasses,
} from "./pref-expr.js";
import type { PrefExprVars } from "./pref-expr.js";
import { tileForMonster } from "./tile-prefs.js";

describe("evalPrefExpr: the variables upstream actually has", () => {
  it("expands $RACE, $CLASS and $SYS", () => {
    const vars = { RACE: "Hobbit", CLASS: "Ranger", SYS: "web" };
    expect(evalPrefExpr("$RACE", vars)).toBe("Hobbit");
    expect(evalPrefExpr("$CLASS", vars)).toBe("Ranger");
    expect(evalPrefExpr("$SYS", vars)).toBe("web");
  });

  it("leaves any OTHER variable unknown - there is no $GENDER in the C", () => {
    /* "GENDER" does not appear anywhere in reference/src. The 66 female player
     * tiles in the shipped xtra-*.prf files have never been reachable upstream,
     * and core keeps that wart.
     *
     * The cast is the assertion: even HANDED a value under that name, the
     * evaluator must not read it, because upstream's L553-560 knows three names
     * and looking the rest up in a dictionary would quietly add a variable to
     * the language. */
    const withGender = { RACE: "Hobbit", GENDER: "Female" } as PrefExprVars;
    expect(evalPrefExpr("$GENDER", withGender)).toBe(PREF_EXPR_UNKNOWN);
    expect(evalPrefExpr("$GRAF", { GRAF: "old" } as PrefExprVars)).toBe(
      PREF_EXPR_UNKNOWN,
    );
    /* Which is why every female line bypasses: unknown never equals "Female". */
    expect(prefExprBypasses("[EQU $GENDER Female]", withGender)).toBe(true);
    expect(
      prefExprBypasses("[AND [EQU $RACE Hobbit] [EQU $GENDER Female] ]", withGender),
    ).toBe(true);
  });

  it("an unset known variable is unknown too, not the empty string", () => {
    expect(evalPrefExpr("$CLASS", {})).toBe(PREF_EXPR_UNKNOWN);
  });
});

describe("evalPrefExpr: connectives", () => {
  const V = { RACE: "Hobbit", CLASS: "Ranger" };

  it("EQU compares each operand with its predecessor", () => {
    expect(evalPrefExpr("[EQU $RACE Hobbit]", V)).toBe("1");
    expect(evalPrefExpr("[EQU $RACE Dwarf]", V)).toBe("0");
    expect(evalPrefExpr("[EQU a a a]", V)).toBe("1");
    expect(evalPrefExpr("[EQU a a b]", V)).toBe("0");
  });

  it("nests: AND over two EQU brackets, which is the whole xtra-*.prf shape", () => {
    expect(evalPrefExpr("[AND [EQU $CLASS Ranger] [EQU $RACE Hobbit] ]", V)).toBe("1");
    expect(evalPrefExpr("[AND [EQU $CLASS Ranger] [EQU $RACE Dwarf] ]", V)).toBe("0");
    /* Three operands, and the trailing-space-before-] the files are full of. */
    expect(
      evalPrefExpr("[AND [EQU $CLASS Ranger] [EQU $RACE Hobbit]  [EQU 1 1] ]", V),
    ).toBe("1");
  });

  it("IOR/NOT", () => {
    expect(evalPrefExpr("[IOR [EQU $RACE Dwarf] [EQU $CLASS Ranger]]", V)).toBe("1");
    expect(evalPrefExpr("[IOR [EQU $RACE Dwarf] [EQU $CLASS Mage]]", V)).toBe("0");
    expect(evalPrefExpr("[NOT [EQU $RACE Dwarf]]", V)).toBe("1");
    expect(evalPrefExpr("[NOT [EQU $RACE Hobbit]]", V)).toBe("0");
  });

  it("LEQ and GEQ are STRICT, despite the names (upstream zeroes on >= 0 / <= 0)", () => {
    /* L509-531: `if (*t && (strcmp(p, t) >= 0)) v = "0";` - so equal operands
     * make LEQ false. An evaluator using <= here would silently apply a block
     * upstream skips. */
    expect(evalPrefExpr("[LEQ a b]", {})).toBe("1");
    expect(evalPrefExpr("[LEQ a a]", {})).toBe("0");
    expect(evalPrefExpr("[LEQ b a]", {})).toBe("0");
    expect(evalPrefExpr("[GEQ b a]", {})).toBe("1");
    expect(evalPrefExpr("[GEQ a a]", {})).toBe("0");
  });

  it("compares bytes, not numbers (strcmp)", () => {
    expect(evalPrefExpr("[LEQ 10 9]", {})).toBe("1");
  });

  it("an unknown connective consumes its bracket and stays unknown (fail open)", () => {
    expect(evalPrefExpr("[XOR 1 0]", {})).toBe(PREF_EXPR_UNKNOWN);
    expect(prefExprBypasses("[XOR 1 0]", {})).toBe(false);
  });

  it("an unterminated bracket is malformed, and still does not bypass", () => {
    expect(evalPrefExpr("[AND [EQU a a]", {})).toBe(PREF_EXPR_MALFORMED);
    expect(prefExprBypasses("[AND [EQU a a]", {})).toBe(false);
  });

  it("a bare constant is its own value, and only \"0\" is false", () => {
    expect(evalPrefExpr("1", {})).toBe("1");
    expect(evalPrefExpr("0", {})).toBe("0");
    expect(prefExprBypasses("0", {})).toBe(true);
    expect(prefExprBypasses("1", {})).toBe(false);
    expect(prefExprBypasses("banana", {})).toBe(false);
  });

  it("an empty expression is unknown (L487-488: \"Nothing\")", () => {
    expect(evalPrefExpr("", {})).toBe("");
    expect(evalPrefExpr("[]", {})).toBe(PREF_EXPR_UNKNOWN);
    expect(evalPrefExpr("[ ]", {})).toBe(PREF_EXPR_UNKNOWN);
  });
});

/* ------------------------------------------------------------------------
 * The real pack, the real parser, the real question.
 * ------------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}
function readTiles(rel: string): string {
  return readFileSync(
    new URL(`../../../../reference/lib/tiles/${rel}`, import.meta.url),
    "utf8",
  );
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

/** graf-shb-dark.prf with its `%:` includes resolved, as the game loads it. */
function shockboltPlayerTile(vars: { RACE?: string; CLASS?: string }) {
  const includes: Record<string, string> = {
    "xtra-shb.prf": readTiles("shockbolt/xtra-shb.prf"),
    "flvr-shb.prf": readTiles("shockbolt/flvr-shb.prf"),
  };
  const map = parseTilePrefs(readTiles("shockbolt/graf-shb-dark.prf"), {
    features: reg.features,
    objects: reg.objects,
    monsters: reg.monsters,
    traps: reg.traps,
    loadFile: (name: string) => includes[name] ?? null,
    vars,
  });
  return tileForMonster(map, 0);
}

describe("the shipped Shockbolt pack picks the player tile by race and class", () => {
  it("a Hobbit Ranger gets the Hobbit Ranger sprite", () => {
    /* xtra-shb.prf:113-114, and it must WIN over both xtra-shb.prf:97 (any
     * Hobbit) and the human-classes `[EQU $CLASS Ranger]` at :35, because those
     * also match and come earlier - last matching line wins, which is how the
     * file is built. */
    expect(shockboltPlayerTile({ RACE: "Hobbit", CLASS: "Ranger" })).toEqual({
      attr: 0x83,
      char: 0x9d,
    });
  });

  it("a Hobbit Mage gets a DIFFERENT sprite from the Hobbit Ranger", () => {
    expect(shockboltPlayerTile({ RACE: "Hobbit", CLASS: "Mage" })).toEqual({
      attr: 0x83,
      char: 0x98,
    });
  });

  it("a Kobold Paladin gets the sprite everyone used to get", () => {
    /* 0x83:0xD3 - the male line at :117. The value the old evaluator handed to
     * EVERY character was 0x84:0xF2, the FEMALE Kobold Paladin from the last
     * line in the file, which upstream can never select at all. */
    expect(shockboltPlayerTile({ RACE: "Kobold", CLASS: "Paladin" })).toEqual({
      attr: 0x83,
      char: 0xd3,
    });
    expect(shockboltPlayerTile({ RACE: "Kobold", CLASS: "Paladin" })).not.toEqual({
      attr: 0x84,
      char: 0xf2,
    });
  });

  it("a Human Warrior gets the first block's tile, not the last line's", () => {
    expect(shockboltPlayerTile({ RACE: "Human", CLASS: "Warrior" })).toEqual({
      attr: 0x83,
      char: 0x87,
    });
  });

  it("with no race or class known, the graf file's own line stands", () => {
    /* Before the character exists (reset_visuals runs at ui_leave_init, after
     * birth) nothing in xtra-shb.prf can match, so graf-shb-dark.prf:748 is what
     * remains. It must not be the last xtra line. */
    expect(shockboltPlayerTile({})).toEqual({ attr: 0x83, char: 0x87 });
  });

  it("every other bundled pack still maps race 0 to a tile", () => {
    /* The `?:` bypass must not have swallowed the unconditional player lines the
     * other packs write in their graf files. */
    for (const [dir, graf] of [
      ["old", "graf-xxx.prf"],
      ["adam-bolt", "graf-new.prf"],
      ["gervais", "graf-dvg.prf"],
      ["nomad", "graf-nmd.prf"],
    ] as const) {
      const map = parseTilePrefs(readTiles(`${dir}/${graf}`), {
        features: reg.features,
        objects: reg.objects,
        monsters: reg.monsters,
        traps: reg.traps,
        vars: { RACE: "Hobbit", CLASS: "Ranger" },
      });
      const tile = tileForMonster(map, 0);
      expect(tile, `${dir} maps the player`).not.toBeNull();
      expect(tile!.attr & 0x80, `${dir}'s player is a tile code`).toBe(0x80);
    }
  });
});
