/**
 * Record-assembly semantics pinned against the upstream parse/ unit tests.
 *
 * These cases target exactly the hole
 * parity/phase3-2026-07-25/findings/W5-DATA-EXACTNESS.md names as its largest:
 * `recordStart`, `header`, `repeat` and `childOf` are port-supplied metadata on
 * BOTH sides of the data-exactness diff, because in C they live in the parser
 * handler bodies rather than in any text a scanner can read. The upstream
 * parse/ tests ARE that oracle, so every assertion here is drawn from one of
 * them by name.
 *
 * Upstream sources, one group per section below:
 *   reference/src/tests/parse/{a-info,blowe,blowm,body,brand,c-info,curse,
 *   e-info,f-info,h-info,k-info,mbase,mspell,objact,objbase,objprop,p-info,
 *   pain,partrap,pit,pprop,proj,ptimed,r-info,realm,shape,slay,ui_knowledge}.c
 *
 * Every spec used here is the real shipped FileSpec from ./specs, so the
 * assertions are about production metadata, not a fixture.
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

/**
 * Each entry is one upstream `test_missing_record_header0` (or
 * `test_missing_header_record0`) function: the gamedata file it covers, a
 * well-formed instance of the directive that upstream lets through as the
 * record header, and every directive line upstream asserts returns
 * PARSE_ERROR_MISSING_RECORD_HEADER before it.
 *
 * The dependent lines are transcribed verbatim from the upstream test.
 */
interface HeaderCase {
  readonly upstream: string;
  readonly file: string;
  readonly recordStart: string;
  readonly dependents: readonly string[];
}

const HEADER_CASES: readonly HeaderCase[] = [
  {
    upstream: "a-info.c",
    file: "artifact",
    recordStart: "name:Test Artifact",
    dependents: [
      "base-object:light:Arkenstone",
      "graphics:~:y",
      "level:50",
      "weight:5",
      "cost:50000",
      "alloc:2:50 to 127",
      "attack:1d1:0:0",
      "armor:0:0",
      "flags:SEE_INVIS | HOLD_LIFE | NO_FUEL",
      "act:CLAIRVOYANCE",
      "time:50+d50",
      "msg:Your {kind} grow{s} magical spikes...",
      "values:LIGHT[4] | RES_LIGHT[1] | RES_DARK[1]",
      "desc:It is a highly magical McGuffin.",
      "slay:ANIMAL_2",
      "brand:ACID_3",
      "curse:teleportation:8",
    ],
  },
  {
    upstream: "blowe.c",
    file: "blow_effects",
    recordStart: "name:HURT",
    dependents: ["lore-color-base:Orange", "lore-color-resist:Yellow", "lore-color-immune:Green"],
  },
  {
    upstream: "blowm.c",
    file: "blow_methods",
    recordStart: "name:HIT",
    dependents: ["act:hits {target}"],
  },
  {
    upstream: "body.c",
    file: "body",
    recordStart: "body:Humanoid",
    dependents: ["slot:WEAPON:weapon"],
  },
  {
    upstream: "brand.c",
    file: "brand",
    recordStart: "code:ACID_1",
    dependents: [
      "name:acid",
      "verb:dissolve",
      "multiplier:3",
      "o-multiplier:25",
      "power:161",
      "resist-flag:IM_ACID",
      "vuln-flag:HURT_FIRE",
    ],
  },
  {
    upstream: "c-info.c",
    file: "class",
    recordStart: "name:Test Class",
    dependents: [
      "stats:0:1:-3:3:-1",
      "skill-disarm-phys:45:20",
      "skill-disarm-magic:45:20",
      "skill-device:32:10",
      "skill-save:28:10",
      "skill-stealth:3:1",
      "skill-search:20:16",
      "skill-melee:35:45",
      "skill-shoot:66:30",
      "skill-throw:55:45",
      "skill-dig:5:1",
      "hitdie:9",
      "exp:30",
      "max-attacks:4",
      "min-weight:40",
      "strength-multiplier:2",
      "title:Novice",
      "equip:magic book:2:2:5:none",
      "obj-flags:FREE_ACT | FEATHER",
      "player-flags:BLESS_WEAPON | ZERO_FAIL",
      "magic:3:400:9",
      "book:magic book:town:[First Spells]:2:arcane",
      "book-graphics:?:R",
      "book-properties:25:40:1 to 100",
      "spell:Light Room:1:2:26:4",
      "effect:LIGHT_AREA",
      "effect-yx:22:40",
      "dice:10",
      "expr:D:PLAYER_LEVEL:- 1 / 5 + 3",
      "effect-msg:shadow shifting",
      "desc:Detects all traps, doors, and stairs in the immediate area.",
    ],
  },
  {
    upstream: "curse.c",
    file: "curse",
    recordStart: "name:test curse",
    dependents: [
      "type:cloak",
      "weight:19",
      "combat:-5:-8:-15",
      "effect:TELEPORT",
      "effect-yx:7:9",
      "dice:$B+1d10",
      "expr:B:WEAPON_DAMAGE:+ 0",
      "msg:Your weapon turns on you!",
      "time:50+1d50",
      "flags:AGGRAVATE | NO_TELEPORT",
      "values:SPEED[2] | STEALTH[-10]",
      "desc:makes your movements quicker but noisier",
      "conflict:anti-teleportation",
      "conflict-flags:NO_TELEPORT",
    ],
  },
  {
    upstream: "e-info.c",
    file: "ego_item",
    recordStart: "name:of Testing",
    dependents: [
      "info:1000:10",
      "alloc:40:10 to 100",
      "type:sword",
      "item:helm:Skullcap",
      "combat:d6:d6:d4",
      "min-combat:15:255:0",
      "act:ILLUMINATION",
      "time:30+1d30",
      "flags:FEATHER | IGNORE_FIRE",
      "flags-off:TAKES_FUEL | HATES_ACID",
      "values:STEALTH[d2]",
      "min-values:STEALTH[0] | SPEED[0]",
      "desc:They boost your to-hit and to-dam values.",
      "slay:ORC_3",
      "brand:COLD_2",
      "curse:vulnerability:10",
    ],
  },
  {
    upstream: "f-info.c",
    file: "terrain",
    /* Note the record header is `code:`, not `name:` (f-info.c test_code0
     * comes before test_name0, and test_name_bad0 rejects a second name). */
    recordStart: "code:TEST_FEATURE",
    dependents: [
      "name:Test Feature",
      "graphics: :w",
      "priority:2",
      "mimic:GRANITE",
      "flags:LOS | PASSABLE",
      "digging:1",
      "desc:A door that is already open.",
      "walk-msg:It looks dangerous.  Really enter? ",
      "run-msg:Lava blocks your path.  Step into it? ",
      "hurt-msg:The lava burns you!",
      "die-msg:burning to a cinder in lava",
      "confused-msg:bangs into a door",
      "look-prefix:the entrance to the",
      "look-in-preposition:at",
      "resist-flag:IM_FIRE",
    ],
  },
  {
    upstream: "h-info.c",
    file: "history",
    recordStart: "chart:1:2:3",
    dependents: ["phrase:hello there"],
  },
  {
    upstream: "k-info.c",
    file: "object",
    recordStart: "name:Test Object",
    dependents: [
      "type:TV_FOOD",
      "graphics:~:blue",
      "level:10",
      "weight:2",
      "cost:50",
      "alloc:3:1 to 75",
      "attack:0:0:0",
      "armor:0:0",
      "charges:0",
      "pile:50:1d4",
      "flags:IGNORE_ACID",
      "power:10",
      "effect:DAMAGE",
      "effect-yx:7:14",
      "dice:$B+5d8",
      "expr:B:PLAYER_LEVEL:+ 0",
      "msg:That tastes awful.",
      "vis-msg:You see stars.",
      "time:5+2d10",
      "pval:0",
      "values:RES_FIRE[-1]",
      "desc:This is a pair of well-worn wooden clogs.",
      "slay:ORC_3",
      "brand:FIRE_2",
      "curse:teleportation:20",
    ],
  },
  {
    upstream: "mbase.c",
    file: "monster_base",
    recordStart: "name:test base",
    dependents: ["glyph:D", "pain:1", "flags:DRAGON | NO_CONF", "desc:Ancient Dragon/Wyrm"],
  },
  {
    upstream: "mspell.c",
    file: "monster_spell",
    recordStart: "name:BLINK",
    dependents: [
      "msgt:TELEPORT",
      "hit:20",
      "effect:DAMAGE",
      "effect-yx:10:15",
      "dice:3+1d35",
      "expr:D:SPELL_POWER:/ 8 + 1",
      "power-cutoff:15",
      "lore:cough up a hairball",
      "lore-color-base:Orange",
      "lore-color-resist:Yellow",
      "lore-color-immune:Light Green",
      "message-vis:{name} cackles.",
      "message-invis:Something cackles.",
      "message-miss:{name} gestures but stumbles.",
      "message-save:Something brushes your cheek, but you seem unharmed.",
    ],
  },
  {
    upstream: "objact.c",
    file: "activation",
    recordStart: "name:TEST_ACTIVATION",
    dependents: [
      "aim:0",
      "level:23",
      "power:102",
      "effect:DAMAGE",
      "effect-yx:10:20",
      "dice:3+$Nd4",
      "expr:N:PLAYER_LEVEL:/ 8",
      "msg:{name} throws off small green sparks...",
      "desc:does nothing, spectacularly",
    ],
  },
  {
    upstream: "objprop.c",
    file: "object_property",
    recordStart: "name:Test Property",
    dependents: [
      "type:flag",
      "subtype:protection",
      "id-type:on effect",
      "code:PROT_FEAR",
      "power:6",
      "mult:1",
      "type-mult:helm:2",
      "adjective:ugly",
      "neg-adjective:handsome",
      "msg:Your {name} glows.",
      "desc:testing",
      "bindui:test_ui_0:0",
    ],
  },
  {
    upstream: "p-info.c",
    file: "p_race",
    recordStart: "name:Test Race",
    dependents: [
      "stats:0:1:-1:1:-1",
      "skill-disarm-phys:2",
      "skill-disarm-magic:2",
      "skill-device:3",
      "skill-save:3",
      "skill-stealth:1",
      "skill-search:3",
      "skill-melee:-1",
      "skill-shoot:5",
      "skill-throw:5",
      "skill-dig:0",
      "hitdie:10",
      "exp:120",
      "infravision:2",
      "history:4",
      "age:24:16",
      "height:71:8",
      "weight:115:25",
      "obj-flags:SUST_DEX",
      "player-flags:KNOW_MUSHROOM",
      "values:RES_LIGHT[1]",
    ],
  },
  {
    upstream: "pain.c",
    file: "pain",
    recordStart: "type:3",
    dependents: ["message:shrug[s] off the attack."],
  },
  {
    upstream: "partrap.c",
    file: "trap",
    recordStart: "name:test trap:a test trap",
    dependents: [
      "graphics:;:G",
      "appear:2:20:1",
      "visibility:70",
      "flags:TRAP | FLOOR | PIT",
      "effect:DAMAGE",
      "effect-yx:11:22",
      "dice:4d$S",
      "expr:S:DUNGEON_LEVEL:/ 2",
      "effect-xtra:TIMED_INC:CUT",
      "effect-yx-xtra:13:25",
      "dice-xtra:8d$S",
      "expr-xtra:S:DUNGEON_LEVEL:/ 25 + 3",
      "save:FEATHER",
      "desc:A hole dug to snare the unwary.",
      "msg:You fall into a pit!",
    ],
  },
  {
    upstream: "pit.c",
    file: "pit",
    recordStart: "name:Test Pit",
    dependents: [
      "room:1",
      "alloc:1:25",
      "obj-rarity:0",
      "mon-base:ancient dragon",
      "mon-ban:cutpurse",
      "color:r",
      "flags-req:FEMALE",
      "flags-ban:MALE",
      "innate-freq:4",
      "spell-req:BR_FIRE",
      "spell-ban:BR_COLD",
    ],
  },
  {
    upstream: "pprop.c",
    file: "player_property",
    /* pprop.c lists `name:` among the directives that need a header, so the
     * header is `type:` (init.c parse_player_prop_type). */
    recordStart: "type:player",
    dependents: ["code:ZERO_FAIL", "desc:You are made of rock.", "name:Rock"],
  },
  {
    upstream: "proj.c",
    file: "projection",
    recordStart: "code:ACID",
    dependents: [
      "name:acid",
      "type:element",
      "desc:acid",
      "player-desc:acid",
      "blind-desc:acid",
      "lash-desc:acid",
      "numerator:1",
      "denominator:3",
      "divisor:3",
      "damage-cap:1600",
      "msgt:BR_ACID",
      "obvious:1",
      "wake:1",
      "color:Slate",
    ],
  },
  {
    upstream: "ptimed.c",
    file: "player_timed",
    recordStart: "name:FAST",
    dependents: [
      "desc:haste",
      "on-end:You feel yourself slow down.",
      "on-increase:You are more confused!",
      "on-decrease:You feel a little less confused.",
      "msgt:SPEED",
      "fail:1:FREE_ACT",
      "resist:ACID",
      "brand:ACID_3",
      "slay:ANIMAL_2",
      "flag-synonym:PROT_FEAR:0",
      "on-begin-effect:SCRAMBLE_STATS",
      "on-end-effect:UNSCRAMBLE_STATS",
      "effect-yx:10:20",
      "effect-dice:2d20",
      "effect-expr:B:PLAYER_HP:/ 4",
      "effect-msg:despair",
      "flags:NONSTACKING",
      "lower-bound:1",
    ],
  },
  {
    upstream: "r-info.c",
    file: "monster",
    recordStart: "name:Test Monster",
    dependents: [
      "plural:red-hatted elves",
      "base:townsfolk",
      "glyph:!",
      "color:r",
      "speed:110",
      "hit-points:3",
      "light:-2",
      "hearing:30",
      "smell:50",
      "armor-class:36",
      "sleepiness:45",
      "depth:15",
      "rarity:2",
      "experience:25",
      "flags:IM_POIS",
      "flags-off:HURT_COLD",
      "desc:He looks squalid and thoroughly revolting.",
      "innate-freq:4",
      "spell-freq:12",
      "spell-power:4",
      "spells:WOUND | SCARE",
      "message-vis:WOUND:{name} dances a jig.",
      "message-invis:WOUND:Something curses.",
      "message-miss:WOUND:{name} coughs up a hairball.",
      "drop:chest:small wooden chest:20:1:1",
      "drop-base:light:5:1:1",
      "friends:20:1d2:blubbering idiot",
      "friends-base:20:1d3:townsfolk",
      "mimic:chest:small wooden chest",
      "shape:townsfolk",
      "color-cycle:fancy:crystal",
    ],
  },
  {
    upstream: "realm.c",
    file: "realm",
    recordStart: "name:arcane",
    dependents: ["stat:STR", "verb:perform", "spell-noun:feat of strength", "book-noun:exercise manual"],
  },
  {
    upstream: "shape.c",
    file: "shape",
    recordStart: "name:test shape",
    dependents: [
      "combat:-3:-4:2",
      "skill-disarm-phys:-5",
      "skill-disarm-magic:-10",
      "skill-save:20",
      "skill-stealth:13",
      "skill-search:5",
      "skill-melee:10",
      "skill-throw:-5",
      "skill-dig:25",
      "obj-flags:FEATHER | FREE_ACT",
      "player-flags:STEAL",
      "values:SPEED[3] | STEALTH[3] | INFRA[5]",
      "effect:DAMAGE",
      "effect-yx:11:23",
      "dice:1d$S",
      "expr:S:PLAYER_LEVEL:+ 0",
      "effect-msg:turning into a bat",
      "blow:bite",
    ],
  },
  {
    upstream: "slay.c",
    file: "slay",
    recordStart: "code:EVIL_1",
    dependents: [
      "name:evil creatures",
      "race-flag:EVIL",
      "base:bat",
      "multiplier:5",
      "o-multiplier:35",
      "power:120",
      "melee-verb:smite",
      "range-verb:pierces",
    ],
  },
  {
    upstream: "ui_knowledge.c",
    file: "ui_knowledge",
    recordStart: "monster-category:Test Category",
    dependents: [
      "mcat-include-base:bat",
      "mcat-include-flag:UNIQUE",
      "mcat-include-other:fully-known",
    ],
  },
];

describe("parse/*: MISSING_RECORD_HEADER pins each spec's recordStart", () => {
  it("covers 27 upstream test files, one spec each", () => {
    /* 28 of the 38 upstream parse/ files carry a missing-record-header
     * case; objbase.c is the 28th and has its own describe below, because
     * object_base is the one file with a header directive. */
    expect(HEADER_CASES).toHaveLength(27);
    expect(new Set(HEADER_CASES.map((c) => c.file)).size).toBe(27);
    expect(new Set(HEADER_CASES.map((c) => c.upstream)).size).toBe(27);
  });

  for (const c of HEADER_CASES) {
    describe(`${c.upstream} -> ${c.file}.txt`, () => {
      it("accepts the record-header directive as the first line", () => {
        const out = compileGamedata(`${c.recordStart}\n`, spec(c.file));
        expect(out.records).toHaveLength(1);
      });

      it.each(c.dependents)("rejects %j before any record", (line) => {
        expect(() => compileGamedata(`${line}\n`, spec(c.file))).toThrow(
          /before first record/,
        );
      });

      it.each(c.dependents)("accepts %j after the record header", (line) => {
        expect(() =>
          compileGamedata(`${c.recordStart}\n${line}\n`, spec(c.file)),
        ).not.toThrow();
      });
    });
  }
});

describe("objbase.c: object_base's `default:` is a header directive", () => {
  const objectBase = spec("object_base");

  it("accepts default: before the first record (test_default0)", () => {
    /* obj-init.c parse_object_base_defaults runs off the parser's private
     * data before any kb_info entry exists, so it is legal at the top of
     * the file - the port models that with `header: ["default"]`. */
    const out = compileGamedata("default:break-chance:10\n", objectBase);
    expect(out.header).toEqual({ default: [{ label: "break-chance", value: 10 }] });
    expect(out.records).toEqual([]);
  });

  it("still accepts a record after the defaults (test_default_passthrough0)", () => {
    const out = compileGamedata(
      "default:break-chance:10\ndefault:max-stack:40\nname:sword:Sword~\n",
      objectBase,
    );
    expect(out.header).toEqual({
      default: [
        { label: "break-chance", value: 10 },
        { label: "max-stack", value: 40 },
      ],
    });
    expect(out.records).toEqual([{ name: { tval: "sword", name: "Sword~" } }]);
  });

  it("rejects the four non-header directives before a record (test_missing_record_header0)", () => {
    for (const line of ["graphics:Red", "break:3", "max-stack:10", "flags:EASY_KNOW"]) {
      expect(() => compileGamedata(`${line}\n`, objectBase), line).toThrow(
        /before first record/,
      );
    }
  });
});

describe("f-info.c test_name_bad0: a second name: in one terrain record is an error", () => {
  it("rejects the duplicate (PARSE_ERROR_REPEATED_DIRECTIVE)", () => {
    /* init.c parse_feat_name returns PARSE_ERROR_REPEATED_DIRECTIVE when
     * f->name is already set; the port's spec leaves `name` un-repeated so
     * compileGamedata refuses the second occurrence. */
    expect(() =>
      compileGamedata("code:TEST\nname:First Name\nname:Another Name\n", spec("terrain")),
    ).toThrow(/duplicate directive "name"/);
  });

  it("accepts a single name:", () => {
    const out = compileGamedata("code:TEST\nname:First Name\n", spec("terrain"));
    expect(out.records[0]).toEqual({ code: "TEST", name: "First Name" });
  });
});

describe("c-info.c test_magic_repeated0: a second magic: for one class is an error", () => {
  it("rejects the duplicate (PARSE_ERROR_REPEATED_DIRECTIVE)", () => {
    expect(() =>
      compileGamedata("name:Test\nmagic:1:300:3\nmagic:1:350:5\n", spec("class")),
    ).toThrow(/duplicate directive "magic"/);
  });
});

describe("c-info.c: the class magic -> book -> spell -> effect childOf chain", () => {
  const cls = spec("class");

  it("nests book under the record, spell under book, effect under spell", () => {
    const text = [
      "name:Test Class",
      "magic:1:300:3",
      "book:magic book:town:[First Spells]:2:arcane",
      "book-graphics:?:R",
      "book-properties:25:40:1 to 100",
      "spell:Light Room:1:2:26:4",
      "effect:LIGHT_AREA",
      "effect-yx:22:40",
      "dice:10",
      "expr:D:PLAYER_LEVEL:- 1 / 5 + 3",
      "effect-msg:shadow shifting",
      "desc:Lights up the room.",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, cls).records[0];
    expect(rec).toEqual({
      name: "Test Class",
      magic: { first: 1, weight: 300, books: 3 },
      book: [
        {
          tval: "magic book",
          quality: "town",
          name: "[First Spells]",
          spells: 2,
          realm: "arcane",
          "book-graphics": { glyph: "?", color: "R" },
          "book-properties": { cost: 25, common: 40, minmax: "1 to 100" },
          spell: [
            {
              name: "Light Room",
              level: 1,
              mana: 2,
              fail: 26,
              exp: 4,
              effect: [
                {
                  eff: "LIGHT_AREA",
                  "effect-yx": { y: 22, x: 40 },
                  dice: "10",
                  expr: [{ name: "D", base: "PLAYER_LEVEL", expr: "- 1 / 5 + 3" }],
                  "effect-msg": ["shadow shifting"],
                },
              ],
              desc: ["Lights up the room."],
            },
          ],
        },
      ],
    });
  });

  it("attaches a second spell to the most recent book, not the first", () => {
    const text = [
      "name:Test Class",
      "magic:1:300:3",
      "book:magic book:town:[Book One]:2:arcane",
      "spell:Spell A:1:1:20:1",
      "book:magic book:dungeon:[Book Two]:2:arcane",
      "spell:Spell B:2:2:22:2",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, cls).records[0] as {
      book: Array<{ name: string; spell: Array<{ name: string }> }>;
    };
    expect(rec.book.map((b) => [b.name, b.spell.map((s) => s.name)])).toEqual([
      ["[Book One]", ["Spell A"]],
      ["[Book Two]", ["Spell B"]],
    ]);
  });

  it("does not error when effect deps precede any effect (test_missing_effect0)", () => {
    /* Upstream returns PARSE_ERROR_NONE and leaves the spell untouched -
     * "human, not parser, error". The port likewise does not throw; it
     * parks the orphans on the enclosing record. Recorded as a benign
     * representation difference in the findings doc. */
    const text = [
      "name:Test Class",
      "magic:1:300:3",
      "book:magic book:town:[Book]:2:arcane",
      "spell:Spell A:1:1:20:1",
      "effect-yx:11:22",
      "dice:10+8d4",
      "expr:S:PLAYER_LEVEL:* 2",
      "effect-msg:self sacrifice",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, cls).records[0] as {
      book: Array<{ spell: Array<Record<string, unknown>> }>;
    };
    const s = rec.book[0]?.spell[0] as Record<string, unknown>;
    expect(s["effect"]).toBeUndefined();
  });
});

describe("mspell.c test_misplaced_effect_deps0: orphan effect deps are not an error", () => {
  it("accepts effect-yx / dice / expr before any effect:", () => {
    const text = [
      "name:BLINK",
      "effect-yx:8:7",
      "dice:5+1d4",
      "expr:D:SPELL_POWER:* 8 + 20",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, spec("monster_spell")).records[0] as Record<
      string,
      unknown
    >;
    expect(rec["effect"]).toBeUndefined();
  });
});

describe("mspell.c test_cutoff0 / test_lore0: power-cutoff owns the lore group", () => {
  it("puts lore before the first power-cutoff on the record and later lore under it", () => {
    const text = [
      "name:BLINK",
      "lore:base lore",
      "lore-color-base:Orange",
      "power-cutoff:15",
      "lore:stronger lore",
      "lore-color-base:Yellow",
      "message-vis:{name} blinks.",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, spec("monster_spell")).records[0];
    expect(rec).toEqual({
      name: "BLINK",
      lore: ["base lore"],
      "lore-color-base": "Orange",
      "power-cutoff": [
        {
          power: 15,
          lore: ["stronger lore"],
          "lore-color-base": "Yellow",
          "message-vis": ["{name} blinks."],
        },
      ],
    });
  });
});

describe("ptimed.c: on-begin-effect and on-end-effect share one child group", () => {
  it("attaches each dependency to whichever effect directive came last", () => {
    /* player-timed.c walks to the end of whichever of the two effect lists
     * was most recently extended, so the port declares both as parents. */
    const text = [
      "name:FAST",
      "on-begin-effect:SCRAMBLE_STATS",
      "effect-dice:2d20",
      "on-end-effect:UNSCRAMBLE_STATS",
      "effect-yx:10:20",
      "effect-msg:despair",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, spec("player_timed")).records[0];
    expect(rec).toEqual({
      name: "FAST",
      "on-begin-effect": [{ eff: "SCRAMBLE_STATS", "effect-dice": "2d20" }],
      "on-end-effect": [
        {
          eff: "UNSCRAMBLE_STATS",
          "effect-yx": { y: 10, x: 20 },
          "effect-msg": ["despair"],
        },
      ],
    });
  });
});

describe("partrap.c: the trap effect and effect-xtra groups are independent", () => {
  it("keeps dice under effect and dice-xtra under effect-xtra", () => {
    /* trap.txt registers a second, parallel family; a dice-xtra line must
     * not land on the plain effect even when that effect came later. */
    const text = [
      "name:test trap:a test trap",
      "effect:DAMAGE",
      "dice:4d$S",
      "effect-xtra:TIMED_INC:CUT",
      "dice-xtra:8d$S",
      "effect:TIMED_INC:STUN",
      "dice:5d4",
      "expr-xtra:S:DUNGEON_LEVEL:/ 25 + 3",
    ].join("\n");
    const rec = compileGamedata(`${text}\n`, spec("trap")).records[0];
    expect(rec).toEqual({
      name: { name: "test trap", desc: "a test trap" },
      effect: [
        { eff: "DAMAGE", dice: "4d$S" },
        { eff: "TIMED_INC", type: "STUN", dice: "5d4" },
      ],
      "effect-xtra": [
        {
          eff: "TIMED_INC",
          type: "CUT",
          "dice-xtra": "8d$S",
          "expr-xtra": [{ name: "S", base: "DUNGEON_LEVEL", expr: "/ 25 + 3" }],
        },
      ],
    });
  });
});

describe("v-info.c test_d0: repeated D: lines accumulate in order, spaces intact", () => {
  it("keeps both rows verbatim, including leading and trailing spaces", () => {
    /* Upstream string_appends them into one buffer, "  %%   %  % ";
     * the pack keeps the rows as an array and the room binder joins them
     * with no separator, so the array must preserve both rows exactly. */
    const out = compileGamedata("name:test\nD:  %%  \nD: %  % \n", spec("vault"));
    const rec = out.records[0] as { D: string[] };
    expect(rec.D).toEqual(["  %%  ", " %  % "]);
    expect(rec.D.join("")).toBe("  %%   %  % ");
  });
});

describe("pain.c test_message0: repeated message: lines accumulate in file order", () => {
  it("keeps the seven pain messages in order", () => {
    const lines = ["type:3"];
    for (let i = 0; i < 7; i++) lines.push(`message:pain ${String(i)}`);
    const rec = compileGamedata(`${lines.join("\n")}\n`, spec("pain")).records[0];
    expect(rec).toEqual({
      type: 3,
      message: ["pain 0", "pain 1", "pain 2", "pain 3", "pain 4", "pain 5", "pain 6"],
    });
  });
});

describe("e-info.c test_order: a short directive line is MISSING_FIELD", () => {
  it("rejects info: with only one of its two fields", () => {
    expect(() =>
      compileGamedata("name:of Testing\ninfo:4\n", spec("ego_item")),
    ).toThrow(/MISSING_FIELD/);
  });
});
