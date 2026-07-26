/**
 * Binder-level semantics of the object / terrain / projection group, ported
 * from the upstream unit tests
 * reference/src/tests/parse/{a-info,curse,e-info,f-info,mspell,p-info,pit,
 * proj,shape}.c (batch "objterr" of the UT-PORT lane).
 *
 * Where the split falls: `packages/content` compiles the .txt to JSON (line
 * grammar and record assembly only, pinned by
 * packages/content/src/records-objterrain.upstream.test.ts) and the binders
 * here do the name-to-enum resolution, the range checks and the cross-record
 * lookups that upstream's parse handlers do inline. Every PARSE_ERROR_* code
 * these nine upstream files assert other than the pure grammar ones therefore
 * lands here, and none of it is reachable from the shipped gamedata, so the W5
 * data-exactness suite is structurally blind to all of it.
 *
 * Method, as in ./obj/bind.upstream.test.ts: take the real committed pack,
 * deep-copy it, plant exactly the token the upstream case plants, and require
 * the binder to refuse it. Each `describe` asserts the unmutated pack binds
 * first, so a throw can only come from the mutation.
 *
 * Deliberately NOT duplicated here (already covered, cited so the ledger
 * matches): every `*_bad0` case of a-info.c / e-info.c / curse.c that
 * ./obj/bind.upstream.test.ts already plants -- test_flags_bad0,
 * test_values_bad0, test_min_values_bad0, test_type_bad0, test_item_bad0,
 * test_slay_bad0, test_brand_bad0, test_curse_bad0, test_conflict_flags_bad0,
 * test_graphics_bad0, test_badtval0.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Dice } from "./dice";
import { EffectBuilder } from "./effects/effect";
import { EF, MSG, PROJ, RF, RSF, TF, TMD, TV } from "./generated";
import { SKILL } from "./player/types";
import { resolvePits } from "./gen/gen-monster";
import { bindMonsters } from "./mon/bind";
import type { MonsterPackRecords } from "./mon/bind";
import { ObjRegistry } from "./obj/bind";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "./obj/types";
import type { ObjPackJson } from "./obj/types";
import { bindPlayer } from "./player/bind";
import type { PlayerPackRecords } from "./player/bind";
import { FeatureRegistry } from "./world/feature";
import type { TerrainRecordJson } from "./world/feature";
import { bindProjections } from "./world/projection";
import type { ProjectionRecordJson } from "./world/projection";

/* ------------------------------------------------------------------ *
 * Pack loading
 * ------------------------------------------------------------------ */

function packFile(name: string): { records: unknown[]; header?: unknown } {
  return JSON.parse(
    readFileSync(
      new URL(`../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: unknown[]; header?: unknown };
}

function packRecords<T>(name: string): T[] {
  return packFile(name).records as T[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

type Rec = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * f-info.c -- terrain, bound by world/feature.ts
 * ------------------------------------------------------------------ */

describe("f-info.c: terrain binder", () => {
  const TERRAIN = packRecords<TerrainRecordJson>("terrain");
  const fresh = (): TerrainRecordJson[] => clone(TERRAIN);
  const reg = new FeatureRegistry(fresh());

  function reject(mutate: (recs: Rec[]) => void, message: RegExp): void {
    const recs = fresh();
    mutate(recs as unknown as Rec[]);
    expect(() => new FeatureRegistry(recs)).toThrow(message);
  }

  it("the unmutated terrain binds (control)", () => {
    expect(() => new FeatureRegistry(fresh())).not.toThrow();
  });

  it("rejects an unknown code: (test_code_bad0, OUT_OF_BOUNDS)", () => {
    /* parse_feat_code: lookup_feat_code < 0 -> PARSE_ERROR_OUT_OF_BOUNDS. */
    reject((recs) => {
      (recs[0] as Rec)["code"] = "XYZZY";
    }, /code not in list-terrain\.h: XYZZY/);
  });

  it("rejects an unknown mimic: (test_mimic_bad0, OUT_OF_BOUNDS)", () => {
    reject((recs) => {
      (recs[0] as Rec)["mimic"] = "XYZZY";
    }, /mimic not found: XYZZY/);
  });

  it("resolves mimic: to the target's fidx (test_mimic0)", () => {
    const recs = fresh();
    (recs[0] as unknown as Rec)["mimic"] = "FLOOR";
    const mimicking = new FeatureRegistry(recs);
    expect(mimicking.byCodeName(recs[0]!.code).mimic).toBe(
      mimicking.byCodeName("FLOOR").fidx,
    );
  });

  it("rejects an unknown flags: token (test_flags_bad0, INVALID_FLAG)", () => {
    reject((recs) => {
      (recs[0] as Rec)["flags"] = ["XYZZY"];
    }, /unknown flag XYZZY/);
  });

  it("accepts an empty flags: line and sets nothing (test_flags0)", () => {
    /* The compiler stores `flags:` as the presence marker `true`; upstream's
     * !parser_hasval branch returns PARSE_ERROR_NONE with the flags
     * untouched. */
    const recs = fresh();
    (recs[0] as unknown as Rec)["flags"] = [];
    const empty = new FeatureRegistry(recs);
    expect(empty.byCodeName(recs[0]!.code).flags.isEmpty()).toBe(true);
  });

  it("ORs multiple flags: lines together (test_flags0)", () => {
    /* Upstream's case sets LOS on one line and "PERMANENT | DOWNSTAIR" on the
     * next, then requires the set to be exactly those three. */
    const recs = fresh();
    (recs[0] as unknown as Rec)["flags"] = ["LOS", "PERMANENT | DOWNSTAIR"];
    const reg2 = new FeatureRegistry(recs);
    const f = reg2.byCodeName(recs[0]!.code);
    for (const name of ["LOS", "PERMANENT", "DOWNSTAIR"] as const) {
      expect(reg2.featHas(f.fidx, TF[name]), name).toBe(true);
    }
    expect(f.flags.count()).toBe(3);
  });

  it("resolves resist-flag: to its RF index (test_resist_flag0)", () => {
    const recs = fresh();
    (recs[0] as unknown as Rec)["resist-flag"] = ["IM_POIS"];
    expect(new FeatureRegistry(recs).byCodeName(recs[0]!.code).resistFlag).toBe(
      RF.IM_POIS,
    );
  });

  it("rejects an unknown resist-flag: (test_resist_flag_bad0, INVALID_FLAG)", () => {
    reject((recs) => {
      (recs[0] as Rec)["resist-flag"] = ["XYZZY"];
    }, /unknown resist flag XYZZY/);
  });

  it("keeps priority: and joins the desc lines (test_priority0, test_desc0)", () => {
    const recs = fresh();
    (recs[0] as unknown as Rec)["priority"] = 2;
    (recs[0] as unknown as Rec)["desc"] = [
      "A door that is already open.",
      "  Player can pass through.",
    ];
    const f = new FeatureRegistry(recs).byCodeName(recs[0]!.code);
    expect(f.priority).toBe(2);
    expect(f.desc).toBe(
      "A door that is already open.  Player can pass through.",
    );
  });

  it.each([
    ["walk-msg", "walkMsg"],
    ["run-msg", "runMsg"],
    ["hurt-msg", "hurtMsg"],
    ["die-msg", "dieMsg"],
    ["confused-msg", "confusedMsg"],
    ["look-prefix", "lookPrefix"],
    ["look-in-preposition", "lookInPreposition"],
  ] as const)(
    "%s joins with no separator (test_walk_msg0/run_msg0/hurt_msg0/die_msg0/confused_msg0/look_prefix0/look_in_preposition0)",
    (key, field) => {
      const recs = fresh();
      (recs[0] as unknown as Rec)[key] = ["Ow!", "  That hurt!"];
      const f = new FeatureRegistry(recs).byCodeName(recs[0]!.code) as unknown as Rec;
      expect(f[field]).toBe("Ow!  That hurt!");
    },
  );

  it("keeps the graphics glyph and colour verbatim (test_graphics0)", () => {
    const recs = fresh();
    (recs[0] as unknown as Rec)["graphics"] = { glyph: ":", color: "Light Green" };
    const f = new FeatureRegistry(recs).byCodeName(recs[0]!.code);
    expect(f.dChar).toBe(":");
    expect(f.dAttr).toBe("Light Green");
  });

  /* GAP-1 (fixed): digging bounds. */
  describe("test_digging_bad0: digging: is bounded 1..5", () => {
    it("accepts every value the shipped data uses (test_digging0)", () => {
      const digs = new Set(
        TERRAIN.map((r) => r.digging).filter((d): d is number => d !== undefined),
      );
      expect([...digs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      const recs = fresh();
      (recs[0] as unknown as Rec)["digging"] = 2;
      expect(new FeatureRegistry(recs).byCodeName(recs[0]!.code).dig).toBe(2);
    });

    it("leaves dig 0 when there is no digging: line", () => {
      const recs = fresh();
      delete (recs[0] as unknown as Rec)["digging"];
      expect(new FeatureRegistry(recs).byCodeName(recs[0]!.code).dig).toBe(0);
    });

    it("rejects DIGGING_RUBBLE (0), which is below the range", () => {
      /* init.c parse_feat_digging: `dig_idx < DIGGING_RUBBLE + 1` is
       * PARSE_ERROR_OUT_OF_BOUNDS. */
      reject((recs) => {
        (recs[0] as Rec)["digging"] = 0;
      }, /digging 0 is out of bounds/);
    });

    it("rejects DIGGING_MAX + 1 (6), which is above the range", () => {
      reject((recs) => {
        (recs[0] as Rec)["digging"] = 6;
      }, /digging 6 is out of bounds/);
    });

    it("rejects a negative digging value", () => {
      reject((recs) => {
        (recs[0] as Rec)["digging"] = -1;
      }, /digging -1 is out of bounds/);
    });
  });

  it("binds every FEAT code the shipped terrain declares", () => {
    expect(reg.count()).toBe(TERRAIN.length);
  });
});

/* ------------------------------------------------------------------ *
 * proj.c -- projection, bound by world/projection.ts
 * ------------------------------------------------------------------ */

describe("proj.c: projection binder", () => {
  const PROJECTION = packRecords<ProjectionRecordJson>("projection");
  const fresh = (): ProjectionRecordJson[] => clone(PROJECTION);

  it("the unmutated projection binds (control)", () => {
    expect(() => bindProjections(fresh())).not.toThrow();
  });

  it("a record's fields land on its PROJ slot (test_combined0)", () => {
    const bound = bindProjections(fresh());
    const elec = bound[PROJ.ELEC]!;
    expect(elec.code).toBe("ELEC");
    expect(elec.type).toBe("element");
    expect(elec.msgt).toBe("BR_ELEC");
  });

  it.each([
    ["numerator", "numerator", 8, 8],
    ["divisor", "divisor", 12, 12],
    ["damage-cap", "damageCap", 789, 789],
  ] as const)(
    "%s binds straight through (test_numerator0, test_divisor0, test_damage_cap0)",
    (key, field, input, want) => {
      const recs = fresh();
      (recs[0] as unknown as Rec)[key] = input;
      const info = bindProjections(recs)[PROJ.ACID]! as unknown as Rec;
      expect(info[field]).toBe(want);
    },
  );

  it("an absent divisor defaults to 1, not 0 (test_code0)", () => {
    /* struct projection zeroes divisor, but the port's consumers treat it as
     * a divisor, so an absent line means 1. Upstream never ships a record
     * without one; asserting it here pins the port's own convention. */
    const recs = fresh();
    delete (recs[0] as unknown as Rec)["divisor"];
    expect(bindProjections(recs)[PROJ.ACID]!.divisor).toBe(1);
  });

  it("parses the denominator as dice (test_denominator0)", () => {
    const recs = fresh();
    (recs[0] as unknown as Rec)["denominator"] = "5+2d4";
    const denom = bindProjections(recs)[PROJ.ACID]!.denominator!;
    const want = new Dice();
    want.parseString("5+2d4");
    expect(denom.randomValue()).toEqual(want.randomValue());
  });

  it("obvious:/wake: are truthy tests on the stored int (test_obvious0, test_wake0)", () => {
    /* NOTE a real divergence, recorded as GAP-9 and NOT fixed here:
     * parse_projection_obvious stores `(obvious == 1)`, so upstream turns
     * `obvious:2` into FALSE. The port's `(rec.obvious ?? 0) !== 0` turns it
     * into TRUE. Unreachable on shipped data (every line is 0 or 1) and the
     * fix belongs with a wider pass over the port's several `?? 0 !== 0`
     * boolean conversions, so it is reported rather than patched. */
    const recs = fresh();
    (recs[0] as unknown as Rec)["obvious"] = 1;
    (recs[0] as unknown as Rec)["wake"] = 1;
    let info = bindProjections(recs)[PROJ.ACID]!;
    expect(info.obvious).toBe(true);
    expect(info.wake).toBe(true);

    (recs[0] as unknown as Rec)["obvious"] = 0;
    (recs[0] as unknown as Rec)["wake"] = 0;
    info = bindProjections(recs)[PROJ.ACID]!;
    expect(info.obvious).toBe(false);
    expect(info.wake).toBe(false);

    /* Upstream would give false for both of these. */
    (recs[0] as unknown as Rec)["obvious"] = 2;
    (recs[0] as unknown as Rec)["wake"] = 7;
    info = bindProjections(recs)[PROJ.ACID]!;
    expect(info.obvious).toBe(true);
    expect(info.wake).toBe(true);
  });

  it("keeps every description string, absent ones as null (test_desc0/player_desc0/blind_desc0/lash_desc0)", () => {
    const recs = fresh();
    Object.assign(recs[0] as unknown as Rec, {
      desc: "acid",
      "player-desc": "acidic mist",
      "blind-desc": "something acrid",
      "lash-desc": "oozing slime",
    });
    let info = bindProjections(recs)[PROJ.ACID]!;
    expect([info.desc, info.playerDesc, info.blindDesc, info.lashDesc]).toEqual([
      "acid",
      "acidic mist",
      "something acrid",
      "oozing slime",
    ]);

    for (const k of ["player-desc", "blind-desc", "lash-desc"]) {
      delete (recs[0] as unknown as Rec)[k];
    }
    info = bindProjections(recs)[PROJ.ACID]!;
    expect([info.playerDesc, info.blindDesc, info.lashDesc]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("keeps the colour token for the render layer (test_color0)", () => {
    const recs = fresh();
    (recs[0] as unknown as Rec)["color"] = "Light Red";
    expect(bindProjections(recs)[PROJ.ACID]!.color).toBe("Light Red");
  });

  /* GAP-5 (fixed): msgt validation. */
  describe("test_msgt_bad0: msgt: must name a MSG_ type", () => {
    it("accepts every msgt the shipped projection.txt uses (test_msgt0)", () => {
      for (const rec of PROJECTION) {
        if (rec.msgt !== undefined) {
          expect((MSG as Rec)[rec.msgt], rec.msgt).not.toBeUndefined();
        }
      }
    });

    it("rejects an unknown msgt (INVALID_MESSAGE)", () => {
      /* obj-init.c parse_projection_message_type:
       * message_lookup_by_name < 0 -> PARSE_ERROR_INVALID_MESSAGE. */
      const recs = fresh();
      (recs[0] as unknown as Rec)["msgt"] = "XYZZY";
      expect(() => bindProjections(recs)).toThrow(/invalid msgt XYZZY/);
    });

    it("accepts the case-insensitive and numeric forms message.c allows", () => {
      /* message_lookup_by_name my_stricmp's the names and also accepts a
       * decimal index below MSG_MAX. */
      for (const form of ["br_acid", "Br_Acid", String(MSG.BR_ACID)]) {
        const recs = fresh();
        (recs[0] as unknown as Rec)["msgt"] = form;
        expect(() => bindProjections(recs), form).not.toThrow();
      }
    });
  });

  /* GAP-6 (fixed): ELEMENT_NAME_MISMATCH. */
  describe("test_code_mismatch0: the first ELEM_MAX records are the elements, in order", () => {
    it("the shipped file satisfies the invariant", () => {
      const bound = bindProjections(fresh());
      expect(bound).toHaveLength(56);
      expect(PROJECTION.filter((r) => r.type === "element")).toHaveLength(25);
    });

    it("rejects an element record out of its list-elements.h position", () => {
      /* obj-init.c parse_projection_code L224: index is "previous index + 1"
       * and `index < ELEM_MAX && !streq(code, element_names[index])` is
       * PARSE_ERROR_ELEMENT_NAME_MISMATCH. Upstream's own case swaps in POIS
       * where FIRE was due; swapping two records reproduces it. */
      const recs = fresh();
      const a = recs[1]!;
      recs[1] = recs[4]!;
      recs[4] = a;
      expect(() => bindProjections(recs)).toThrow(
        /record 1 is POIS, expected the element ELEC/,
      );
    });

    it("rejects a non-element record in an element slot", () => {
      const recs = fresh();
      recs.splice(2, 0, clone(recs[30]!));
      expect(() => bindProjections(recs)).toThrow(
        /ELEMENT_NAME_MISMATCH/,
      );
    });

    it("reports a short file as a missing PROJ slot, not a name mismatch", () => {
      /* finish_parse_projection reports PARSE_ERROR_TOO_FEW_ENTRIES for that,
       * never ELEMENT_NAME_MISMATCH, so the label has to differ. */
      const recs = fresh().slice(0, 10);
      expect(() => bindProjections(recs)).toThrow(/no record for PROJ value/);
    });
  });
});

/* ------------------------------------------------------------------ *
 * pit.c -- pit, bound by mon/bind.ts + gen/gen-monster.ts
 * ------------------------------------------------------------------ */

function monPack(): MonsterPackRecords {
  return {
    pain: packRecords("pain"),
    blowMethods: packRecords("blow_methods"),
    blowEffects: packRecords("blow_effects"),
    monsterSpells: packRecords("monster_spell"),
    monsterBases: packRecords("monster_base"),
    monsters: packRecords("monster"),
    summons: packRecords("summon"),
    pits: packRecords("pit"),
  };
}

const MON_PACK = monPack();

describe("pit.c: pit binder", () => {
  const freshPack = (): MonsterPackRecords => clone(MON_PACK);

  function pits(mutate: (recs: Rec[]) => void): ReturnType<typeof resolvePits> {
    const pack = freshPack();
    mutate(pack.pits as unknown as Rec[]);
    return resolvePits(bindMonsters(pack));
  }

  it("the unmutated pack binds and resolves (control)", () => {
    expect(() => resolvePits(bindMonsters(freshPack()))).not.toThrow();
  });

  it("room:, alloc: and obj-rarity: reach the resolved profile (test_room0, test_alloc0, test_obj_rarity0)", () => {
    const resolved = pits((recs) => {
      Object.assign(recs[0]!, {
        room: 1,
        alloc: { rarity: 1, level: 25 },
        "obj-rarity": 5,
      });
    });
    expect(resolved[0]!.roomType).toBe(1);
    expect(resolved[0]!.rarity).toBe(1);
    expect(resolved[0]!.ave).toBe(25);
    expect(resolved[0]!.objRarity).toBe(5);
  });

  it("mon-base: resolves to monster_base templates (test_mon_base0)", () => {
    const resolved = pits((recs) => {
      recs[0]!["mon-base"] = ["ancient dragon", "ant"];
    });
    expect(resolved[0]!.bases.map((b) => b.name)).toEqual([
      "ancient dragon",
      "ant",
    ]);
  });

  it("rejects an unknown mon-base: (test_mon_base_bad0)", () => {
    /* mon-init.c parse_pit_mon_base: !base -> PARSE_ERROR_UNRECOGNISED_TVAL.
     * Upstream's case only asserts `r != PARSE_ERROR_NONE`. */
    expect(() =>
      pits((recs) => {
        recs[0]!["mon-base"] = ["xyzzy"];
      }),
    ).toThrow(/unknown base xyzzy/);
  });

  it("mon-ban: resolves races through lookup_monster (test_mon_ban0)", () => {
    const resolved = pits((recs) => {
      recs[0]!["mon-ban"] = ["cutpurse"];
    });
    expect(resolved[0]!.forbiddenMonsters.map((r) => r.name)).toEqual([
      "cutpurse",
    ]);
  });

  /* GAP-3 (fixed): mon-ban tolerance. */
  it("TOLERATES an unknown mon-ban: rather than refusing it (test_mon_ban_bad0)", () => {
    /* mon-init.c parse_pit_mon_ban has NO error branch: it appends the NULL
     * lookup_monster returned and returns PARSE_ERROR_NONE, and
     * mon_pit_hook's `race == monster->race` then never matches it. The port
     * used to throw here, which is stricter than the C. */
    const resolved = pits((recs) => {
      recs[0]!["mon-ban"] = ["cutpurse", "xyzzy"];
    });
    expect(resolved[0]!.forbiddenMonsters.map((r) => r.name)).toEqual([
      "cutpurse",
    ]);
  });

  it("color: resolves both the one-letter and full-name forms, case-insensitively (test_color0)", () => {
    const resolved = pits((recs) => {
      recs[0]!["color"] = ["Light Green", "light red", "y"];
    });
    /* z-color.c color_text_to_attr my_stricmp's the table, so "light red"
     * and "Light Red" are the same attr. */
    const [lightGreen, lightRed, yellow] = resolved[0]!.colors;
    expect(lightGreen).not.toBe(lightRed);
    expect(yellow).not.toBe(lightRed);
    const alt = pits((recs) => {
      recs[0]!["color"] = ["LIGHT GREEN"];
    });
    expect(alt[0]!.colors[0]).toBe(lightGreen);
  });

  it("flags-req:/flags-ban: OR into the two RF sets (test_flags_req0, test_flags_ban0)", () => {
    const resolved = pits((recs) => {
      recs[0]!["flags-req"] = ["UNDEAD", "SMART | NO_CONF"];
      /* Upstream's case omits the space before the pipe on purpose. */
      recs[0]!["flags-ban"] = ["KILL_BODY", "PASS_WALL| KILL_WALL"];
    });
    for (const f of [RF.UNDEAD, RF.SMART, RF.NO_CONF]) {
      expect(resolved[0]!.flags.has(f)).toBe(true);
    }
    for (const f of [RF.KILL_BODY, RF.PASS_WALL, RF.KILL_WALL]) {
      expect(resolved[0]!.forbiddenFlags.has(f)).toBe(true);
    }
  });

  it("an empty flags-req:/flags-ban: line sets nothing (test_flags_req0, test_flags_ban0)", () => {
    const resolved = pits((recs) => {
      recs[0]!["flags-req"] = [];
      recs[0]!["flags-ban"] = [];
    });
    expect(resolved[0]!.flags.isEmpty()).toBe(true);
    expect(resolved[0]!.forbiddenFlags.isEmpty()).toBe(true);
  });

  it.each([
    ["flags-req", /bad pit race flag: XYZZY/],
    ["flags-ban", /bad pit race flag: XYZZY/],
    ["spell-req", /bad pit spell flag: XYZZY/],
    ["spell-ban", /bad pit spell flag: XYZZY/],
  ] as const)(
    "rejects an unknown %s token (test_flags_req_bad0/flags_ban_bad0/spell_req_bad0/spell_ban_bad0, INVALID_FLAG)",
    (key, message) => {
      expect(() =>
        pits((recs) => {
          recs[0]![key] = ["XYZZY"];
        }),
      ).toThrow(message);
    },
  );

  it("spell-req:/spell-ban: OR into the two RSF sets (test_spell_req0, test_spell_ban0)", () => {
    const resolved = pits((recs) => {
      recs[0]!["spell-req"] = ["BR_FIRE", "SCARE | CONF"];
      recs[0]!["spell-ban"] = ["BR_COLD", "SCARE | CONF"];
    });
    for (const s of [RSF.BR_FIRE, RSF.SCARE, RSF.CONF]) {
      expect(resolved[0]!.spellFlags.has(s)).toBe(true);
    }
    expect(resolved[0]!.forbiddenSpellFlags.has(RSF.BR_COLD)).toBe(true);
  });

  /* GAP-2 (fixed): innate-freq range. */
  describe("test_innate_freq0 / test_innate_freq_bad0: innate-freq is a 1..100 percent", () => {
    it("stores 100/pct, so innate-freq:4 becomes 25 (test_innate_freq0)", () => {
      const resolved = pits((recs) => {
        recs[0]!["innate-freq"] = 4;
      });
      expect(resolved[0]!.freqInnate).toBe(25);
    });

    it("leaves 0 when there is no innate-freq: line", () => {
      const resolved = pits((recs) => {
        delete recs[0]!["innate-freq"];
      });
      expect(resolved[0]!.freqInnate).toBe(0);
    });

    it.each([0, -1, 101])(
      "rejects innate-freq:%s (INVALID_SPELL_FREQ)",
      (pct) => {
        /* mon-init.c parse_pit_innate_freq: `pct < 1 || pct > 100`. Without
         * the check 0 and -1 silently became "no requirement" and 101
         * silently truncated to 0 - both change which races mon_pit_hook
         * admits. */
        expect(() =>
          pits((recs) => {
            recs[0]!["innate-freq"] = pct;
          }),
        ).toThrow(/invalid innate-freq/);
      },
    );

    it("the one shipped pit that sets innate-freq is in range", () => {
      const set = MON_PACK.pits.filter(
        (p) => (p as unknown as Rec)["innate-freq"] !== undefined,
      );
      expect(set).toHaveLength(1);
      expect((set[0] as unknown as Rec)["innate-freq"]).toBe(4);
    });
  });
});

/* ------------------------------------------------------------------ *
 * mspell.c -- monster_spell, bound by mon/bind.ts
 * ------------------------------------------------------------------ */

describe("mspell.c: monster spell binder", () => {
  const freshPack = (): MonsterPackRecords => clone(MON_PACK);

  it("the unmutated pack binds (control)", () => {
    expect(() => bindMonsters(freshPack())).not.toThrow();
  });

  it("name: resolves to its RSF index (test_name0)", () => {
    expect(bindMonsters(freshPack()).spells.get(RSF.BLINK)!.name).toBe("BLINK");
  });

  it("rejects an unknown name: (test_name_bad0, INVALID_SPELL_NAME)", () => {
    const pack = freshPack();
    (pack.monsterSpells[0] as unknown as Rec)["name"] = "XYZZY";
    expect(() => bindMonsters(pack)).toThrow(/invalid spell name: XYZZY/);
  });

  it("hit: binds straight through (test_hit0)", () => {
    const pack = freshPack();
    (pack.monsterSpells[0] as unknown as Rec)["hit"] = 100;
    const name = (pack.monsterSpells[0] as unknown as Rec)["name"] as string;
    expect(
      bindMonsters(pack).spells.get((RSF as Rec)[name] as number)!.hit,
    ).toBe(100);
  });

  /* GAP-5 (fixed): msgt validation. */
  describe("test_msgt_bad0: msgt: must name a MSG_ type", () => {
    it("keeps a valid msgt (test_msgt0)", () => {
      const pack = freshPack();
      (pack.monsterSpells[0] as unknown as Rec)["msgt"] = "TELEPORT";
      const name = (pack.monsterSpells[0] as unknown as Rec)["name"] as string;
      expect(
        bindMonsters(pack).spells.get((RSF as Rec)[name] as number)!.msgt,
      ).toBe("TELEPORT");
    });

    it("rejects an unknown msgt (INVALID_MESSAGE)", () => {
      /* mon-init.c parse_mon_spell_message_type:
       * message_lookup_by_name < 0 -> PARSE_ERROR_INVALID_MESSAGE. */
      const pack = freshPack();
      (pack.monsterSpells[0] as unknown as Rec)["msgt"] = "XYZZY";
      expect(() => bindMonsters(pack)).toThrow(/invalid msgt XYZZY/);
    });

    it("defaults to GENERIC when there is no msgt: line", () => {
      const pack = freshPack();
      delete (pack.monsterSpells[0] as unknown as Rec)["msgt"];
      const name = (pack.monsterSpells[0] as unknown as Rec)["name"] as string;
      expect(
        bindMonsters(pack).spells.get((RSF as Rec)[name] as number)!.msgt,
      ).toBe("GENERIC");
    });
  });

  it("the implicit first level holds the pre-cutoff lore, colours and messages (test_lore_color0/resist0/immune0, test_message_vis0/invis0/miss0/save0)", () => {
    const pack = freshPack();
    Object.assign(pack.monsterSpells[0] as unknown as Rec, {
      "lore-color-base": "Orange",
      "lore-color-resist": "Yellow",
      "lore-color-immune": "Light Green",
      "message-vis": ["${name} cackles", " evilly."],
      "message-invis": ["Something cackles", " evilly."],
      "message-miss": ["${name} gestures", " but then stumbles."],
      "message-save": ["You duck", " and are shaken but unharmed."],
    });
    const name = (pack.monsterSpells[0] as unknown as Rec)["name"] as string;
    const level = bindMonsters(pack).spells.get((RSF as Rec)[name] as number)!
      .levels[0]!;
    expect(level.power).toBe(0);
    expect(level.loreColorBase).toBe("Orange");
    expect(level.loreColorResist).toBe("Yellow");
    expect(level.loreColorImmune).toBe("Light Green");
    /* string_append, so no separator. */
    expect(level.message).toBe("${name} cackles evilly.");
    expect(level.blindMessage).toBe("Something cackles evilly.");
    expect(level.missMessage).toBe("${name} gestures but then stumbles.");
    expect(level.saveMessage).toBe("You duck and are shaken but unharmed.");
  });

  it("power-cutoff: appends a level that owns the lore after it (test_cutoff0)", () => {
    const pack = freshPack();
    Object.assign(pack.monsterSpells[0] as unknown as Rec, {
      "power-cutoff": [{ power: 10, "lore-color-base": "o" }],
    });
    const name = (pack.monsterSpells[0] as unknown as Rec)["name"] as string;
    const levels = bindMonsters(pack).spells.get((RSF as Rec)[name] as number)!
      .levels;
    expect(levels).toHaveLength(2);
    expect(levels[1]!.power).toBe(10);
    expect(levels[1]!.loreColorBase).toBe("o");
  });

  it("rejects an unparseable dice: on a spell effect (test_dice_bad0, INVALID_DICE)", () => {
    const pack = freshPack();
    const effects = (pack.monsterSpells.find(
      (s) => ((s as unknown as Rec)["effect"] as unknown[] | undefined)?.length,
    ) as unknown as Rec)["effect"] as Rec[];
    effects[0]!["dice"] = "5+d8+d4";
    expect(() => bindMonsters(pack)).toThrow(/invalid dice string: 5\+d8\+d4/);
  });

  it.each([
    ["-1", -1, 0, 0],
    ["8", 8, 0, 0],
    ["d10", 0, 1, 10],
    ["-1+d5", -1, 1, 5],
    ["3+2d7", 3, 2, 7],
  ] as const)(
    "dice:%s parses to base %s, %sd%s (test_dice0)",
    (text, base, dice, sides) => {
      const d = new Dice();
      expect(d.parseString(text), text).toBe(true);
      const rv = d.randomValue();
      expect([rv.base, rv.dice, rv.sides]).toEqual([base, dice, sides]);
    },
  );
});

/* ------------------------------------------------------------------ *
 * effect chains -- shape.c / curse.c / mspell.c share grab_effect_data
 * ------------------------------------------------------------------ */

describe("shape.c / curse.c / mspell.c: the shared effect / dice / expr parser", () => {
  const build = (): EffectBuilder => new EffectBuilder();

  it("effect: takes name, subtype, radius and other (shape test_effect0, curse test_effect0, mspell test_effect0)", () => {
    const head = build()
      .effect("DAMAGE")
      .effect("CURE:POISONED")
      .effect("SPOT:LIGHT_WEAK:2")
      .effect("TIMED_INC:SHERO:0:5")
      .build()!;
    const chain = [];
    for (let e: typeof head | null = head; e; e = e.next) chain.push(e);
    expect(chain.map((e) => e.index)).toEqual([
      EF.DAMAGE,
      EF.CURE,
      EF.SPOT,
      EF.TIMED_INC,
    ]);
    expect(chain[0]!.subtype).toBe(0);
    expect(chain[0]!.dice).toBe(null);
    expect(chain[1]!.subtype).toBe(TMD.POISONED);
    expect(chain[2]!.subtype).toBe(PROJ.LIGHT_WEAK);
    expect(chain[2]!.radius).toBe(2);
    expect(chain[3]!.subtype).toBe(TMD.SHERO);
    expect(chain[3]!.radius).toBe(0);
    expect(chain[3]!.other).toBe(5);
  });

  it("rejects an unknown effect name (shape/curse/mspell test_effect_bad0, INVALID_EFFECT)", () => {
    expect(() => build().effect("XYZZY")).toThrow(
      /invalid effect "XYZZY" \(PARSE_ERROR_INVALID_EFFECT\)/,
    );
  });

  it.each([
    ["TIMED_INC:XYZZY", "curse.c / shape.c"],
    ["CURE:XYZZY", "mspell.c"],
  ] as const)(
    "rejects an unknown subtype on %s (test_effect_bad0, INVALID_VALUE)",
    (spec, _where) => {
      expect(() => build().effect(spec)).toThrow(
        /PARSE_ERROR_INVALID_VALUE/,
      );
    },
  );

  it("effect-yx: lands on the LAST effect (shape test_effect_yx0, curse test_effect_yx0, mspell test_effect_yx0)", () => {
    const head = build().effect("DAMAGE").effect("MAP_AREA").effectYx(6, 8).build()!;
    expect([head.y, head.x]).toEqual([0, 0]);
    expect([head.next!.y, head.next!.x]).toEqual([6, 8]);
  });

  it("dice: parses onto the last effect (shape test_dice0, curse test_dice0)", () => {
    const head = build().effect("DAMAGE").dice("5+6d7").build()!;
    const rv = head.dice!.randomValue();
    expect([rv.base, rv.dice, rv.sides, rv.mBonus]).toEqual([5, 6, 7, 0]);
  });

  it("a second dice: replaces the first (curse test_dice0)", () => {
    /* parse_curse_dice dice_free's the old dice before storing the new. */
    const head = build().effect("DAMAGE").dice("8+2d10").dice("-4+4d8").build()!;
    const rv = head.dice!.randomValue();
    expect([rv.base, rv.dice, rv.sides]).toEqual([-4, 4, 8]);
  });

  it.each([
    ["2d8+2d10-3", "shape.c test_dice_bad0"],
    ["a", "curse.c test_dice_bad0"],
    ["10+8d-1", "curse.c test_dice_bad0"],
    ["5+d8+d4", "mspell.c test_dice_bad0"],
  ] as const)("rejects dice:%s (INVALID_DICE)", (text, _where) => {
    expect(() => build().effect("DAMAGE").dice(text)).toThrow(
      /PARSE_ERROR_INVALID_DICE/,
    );
  });

  it("expr: binds into the dice (shape test_expr0, curse test_expr0, mspell test_expr0)", () => {
    expect(() =>
      build().effect("DAMAGE").dice("$B+4d$S").expr("B", "PLAYER_LEVEL", "* 2"),
    ).not.toThrow();
    expect(() =>
      build()
        .effect("DAMAGE")
        .dice("$B+$Dd$S")
        .expr("B", "MAX_SIGHT", " ")
        .expr("D", "SPELL_POWER", "/ 10 + 1")
        .expr("S", "SPELL_POWER", "* 2 + 3"),
    ).not.toThrow();
  });

  it.each([
    ["% 5", "shape.c test_expr_bad0: unknown operator"],
    ["% 8", "curse.c test_expr_bad0: unknown operator"],
    ["- 40000", "mspell.c test_expr_bad0: operand outside int16"],
    ["/ 0", "mspell.c test_expr_bad0: divide by zero"],
    ["% 2", "mspell.c test_expr_bad0: unknown operator"],
  ] as const)(
    "rejects the expression %j (BAD_EXPRESSION_STRING)",
    (expr, _where) => {
      expect(() =>
        build().effect("DAMAGE").dice("$B+4d$S").expr("B", "PLAYER_LEVEL", expr),
      ).toThrow(/PARSE_ERROR_BAD_EXPRESSION_STRING/);
    },
  );

  it.each([
    ["N", "shape.c test_expr_bad0"],
    ["B", "curse.c test_expr_bad0"],
    ["C", "mspell.c test_expr_bad0"],
  ] as const)(
    "rejects binding %s when it is not in the dice (UNBOUND_EXPRESSION)",
    (name, _where) => {
      expect(() =>
        build()
          .effect("DAMAGE")
          .dice("10+$Ad6")
          .expr(name, "PLAYER_LEVEL", "/ 5 + 1"),
      ).toThrow(/PARSE_ERROR_UNBOUND_EXPRESSION/);
    },
  );

  it("an expr: with no dice: is silently ignored (shape test_missing_dice0, mspell test_expr_bad0)", () => {
    /* Every upstream handler bails with PARSE_ERROR_NONE when
     * effect->dice == NULL: "assume that this is human and not parser
     * error". So this must NOT throw, even though the name is unbindable. */
    const head = build()
      .effect("DAMAGE")
      .expr("S", "PLAYER_LEVEL", "/ 5 + 2")
      .build()!;
    expect(head.dice).toBe(null);
  });

  it("effect deps before any effect: are silently ignored (shape test_missing_effect0, mspell test_misplaced_effect_deps0)", () => {
    expect(
      build()
        .effectYx(7, 15)
        .dice("7+2d8")
        .expr("S", "PLAYER_LEVEL", "* 2")
        .effectMsg("turning into a vampire")
        .build(),
    ).toBe(null);
  });

  it("effect-msg: appends to the last effect (shape test_effect_msg0)", () => {
    const head = build()
      .effect("DAMAGE")
      .effectMsg("turning into")
      .effectMsg(" a bat")
      .build()!;
    expect(head.msg).toBe("turning into a bat");
  });
});

/* ------------------------------------------------------------------ *
 * shape.c / p-info.c -- bound by player/bind.ts
 * ------------------------------------------------------------------ */

function playerPack(): PlayerPackRecords {
  return {
    races: packRecords("p_race"),
    classes: packRecords("class"),
    properties: packRecords("player_property"),
    timed: packRecords("player_timed"),
    shapes: packRecords("shape"),
    bodies: packRecords("body"),
    history: packRecords("history"),
    realms: packRecords("realm"),
  };
}

const PLAYER_PACK = playerPack();

describe("shape.c: shape binder", () => {
  const freshPack = (): PlayerPackRecords => clone(PLAYER_PACK);

  function shape(mutate: (rec: Rec) => void): Rec {
    const pack = freshPack();
    mutate(pack.shapes[0] as unknown as Rec);
    return bindPlayer(pack).shapes[0] as unknown as Rec;
  }

  function rejectShape(mutate: (rec: Rec) => void, message: RegExp): void {
    const pack = freshPack();
    mutate(pack.shapes[0] as unknown as Rec);
    expect(() => bindPlayer(pack)).toThrow(message);
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => bindPlayer(freshPack())).not.toThrow();
  });

  it("combat: maps to to-h / to-d / to-a (test_combat0)", () => {
    const s = shape((rec) => {
      rec["combat"] = { "to-h": 5, "to-d": 2, "to-a": -2 };
    });
    expect([s["toH"], s["toD"], s["toA"]]).toEqual([5, 2, -2]);
  });

  it.each([
    ["skill-disarm-phys", SKILL.DISARM_PHYS, -5],
    ["skill-disarm-magic", SKILL.DISARM_MAGIC, -10],
    ["skill-save", SKILL.SAVE, 20],
    ["skill-stealth", SKILL.STEALTH, -7],
    ["skill-search", SKILL.SEARCH, 12],
    ["skill-melee", SKILL.TO_HIT_MELEE, 9],
    ["skill-throw", SKILL.TO_HIT_THROW, 3],
    ["skill-dig", SKILL.DIGGING, 8],
  ] as const)(
    "%s lands at its SKILL index (test_disarm_phys0/disarm_magic0/save0/stealth0/search0/melee0/throw0/dig0)",
    (key, idx, value) => {
      const s = shape((rec) => {
        rec[key] = value;
      });
      expect((s["skills"] as number[])[idx]).toBe(value);
    },
  );

  it("obj-flags / player-flags OR into the two sets (test_obj_flags0, test_player_flags0)", () => {
    const s = shape((rec) => {
      rec["obj-flags"] = ["FEATHER", "FREE_ACT | REGEN"];
      rec["player-flags"] = ["STEAL", "SEE_ORE | ROCK"];
    });
    expect((s["flags"] as { count: () => number }).count()).toBe(3);
    expect((s["pflags"] as { count: () => number }).count()).toBe(3);
  });

  it("an empty obj-flags / player-flags line sets nothing (test_obj_flags0, test_player_flags0)", () => {
    const s = shape((rec) => {
      rec["obj-flags"] = [];
      rec["player-flags"] = [];
    });
    expect((s["flags"] as { isEmpty: () => boolean }).isEmpty()).toBe(true);
    expect((s["pflags"] as { isEmpty: () => boolean }).isEmpty()).toBe(true);
  });

  it("rejects an unknown obj-flags token (test_obj_flags_bad0, INVALID_FLAG)", () => {
    rejectShape((rec) => {
      rec["obj-flags"] = ["XYZZY"];
    }, /unknown shape obj-flag: XYZZY/);
  });

  it("rejects an unknown player-flags token (test_player_flags_bad0, INVALID_FLAG)", () => {
    rejectShape((rec) => {
      rec["player-flags"] = ["XYZZY"];
    }, /unknown shape player-flag: XYZZY/);
  });

  it("values: sets modifiers and RES_ levels (test_values0)", () => {
    const s = shape((rec) => {
      rec["values"] = ["STR[-2]", "RES_POIS[3] | STEALTH[4]"];
    });
    const mods = s["modifiers"] as number[];
    expect(mods.filter((m) => m !== 0)).toEqual([-2, 4]);
    const el = s["elInfo"] as Array<{ resLevel: number }>;
    expect(el.filter((e) => e.resLevel !== 0)).toHaveLength(1);
  });

  it.each([
    ["XYZZY[5]", /unknown shape value: XYZZY\[5\]/],
    ["RES_XYZZY[1]", /unknown shape value: RES_XYZZY\[1\]/],
  ] as const)(
    "rejects the value %s (test_values_bad0, INVALID_VALUE)",
    (token, message) => {
      rejectShape((rec) => {
        rec["values"] = [token];
      }, message);
    },
  );

  it("blow: keeps the whole list, duplicates included (test_blow0)", () => {
    const s = shape((rec) => {
      rec["blow"] = ["bite", "bite", "sting"];
    });
    expect(s["blows"]).toEqual(["bite", "bite", "sting"]);
  });

  it("carries the raw effect records for the assume-shape chain (test_effect0)", () => {
    const s = shape((rec) => {
      rec["effect"] = [{ eff: "DAMAGE", dice: "1d$S" }];
    });
    expect(s["effects"]).toEqual([{ eff: "DAMAGE", dice: "1d$S" }]);
  });
});

describe("p-info.c: player race binder", () => {
  const freshPack = (): PlayerPackRecords => clone(PLAYER_PACK);

  function race(mutate: (rec: Rec) => void): Rec {
    const pack = freshPack();
    mutate(pack.races[0] as unknown as Rec);
    return bindPlayer(pack).races[0] as unknown as Rec;
  }

  function rejectRace(mutate: (rec: Rec) => void, message: RegExp): void {
    const pack = freshPack();
    mutate(pack.races[0] as unknown as Rec);
    expect(() => bindPlayer(pack)).toThrow(message);
  }

  it("stats: lands in STAT order (test_stats0)", () => {
    const r = race((rec) => {
      rec["stats"] = { str: 1, int: -1, wis: 2, dex: -2, con: 3 };
    });
    expect(r["statAdj"]).toEqual([1, -1, 2, -2, 3]);
  });

  it.each([
    ["skill-disarm-magic", SKILL.DISARM_MAGIC, 1],
    ["skill-device", SKILL.DEVICE, 3],
    ["skill-save", SKILL.SAVE, 5],
    ["skill-stealth", SKILL.STEALTH, 7],
    ["skill-search", SKILL.SEARCH, 9],
    ["skill-melee", SKILL.TO_HIT_MELEE, 4],
    ["skill-shoot", SKILL.TO_HIT_BOW, 6],
    ["skill-throw", SKILL.TO_HIT_THROW, 8],
    ["skill-dig", SKILL.DIGGING, 10],
  ] as const)(
    "%s lands at its SKILL index (test_skill_disarm0/device0/save0/stealth0/search0/melee0/shoot0/throw0/dig0)",
    (key, idx, value) => {
      const r = race((rec) => {
        rec[key] = value;
      });
      expect((r["skills"] as number[])[idx]).toBe(value);
      /* skill-shoot must go to TO_HIT_BOW, not TO_HIT_THROW: upstream's
       * parse_p_race_skill_shoot writes SKILL_TO_HIT_BOW. */
    },
  );

  it("hitdie / exp / infravision / history bind straight through (test_hitdie0, test_exp0, test_infravision0, test_history0)", () => {
    const r = race((rec) => {
      Object.assign(rec, { hitdie: 10, exp: 120, infravision: 2, history: 4 });
    });
    expect([r["hitdie"], r["expFactor"], r["infravision"], r["historyChart"]]).toEqual(
      [10, 120, 2, 4],
    );
  });

  it("age / height / weight split into base and mod (test_age0, test_height0, test_weight0)", () => {
    const r = race((rec) => {
      rec["age"] = { base_age: 24, mod_age: 16 };
      rec["height"] = { base_hgt: 71, mod_hgt: 8 };
      rec["weight"] = { base_wgt: 115, mod_wgt: 25 };
    });
    expect([r["baseAge"], r["modAge"]]).toEqual([24, 16]);
    expect([r["baseHeight"], r["modHeight"]]).toEqual([71, 8]);
    expect([r["baseWeight"], r["modWeight"]]).toEqual([115, 25]);
  });

  it("obj-flags / player-flags OR in (test_obj_flags0, test_play_flags0)", () => {
    const r = race((rec) => {
      rec["obj-flags"] = ["SUST_DEX", "HOLD_LIFE | FREE_ACT"];
      rec["player-flags"] = ["KNOW_ZAPPER", "SEE_ORE | KNOW_MUSHROOM"];
    });
    expect((r["flags"] as { count: () => number }).count()).toBe(3);
    expect((r["pflags"] as { count: () => number }).count()).toBe(3);
  });

  it("an empty obj-flags / player-flags line sets nothing (test_obj_flags0, test_play_flags0)", () => {
    const r = race((rec) => {
      rec["obj-flags"] = [];
      rec["player-flags"] = [];
    });
    expect((r["flags"] as { isEmpty: () => boolean }).isEmpty()).toBe(true);
    expect((r["pflags"] as { isEmpty: () => boolean }).isEmpty()).toBe(true);
  });

  it("rejects an unknown obj-flags token (test_obj_flags_bad0, INVALID_FLAG)", () => {
    rejectRace((rec) => {
      rec["obj-flags"] = ["XYZZY"];
    }, /bad race object flag: XYZZY/);
  });

  it("rejects an unknown player-flags token (test_play_flags_bad0, INVALID_FLAG)", () => {
    rejectRace((rec) => {
      rec["player-flags"] = ["XYZZY"];
    }, /bad race player flag: XYZZY/);
  });

  it("values: only accepts RES_ tokens (test_values0)", () => {
    const r = race((rec) => {
      rec["values"] = ["RES_DARK[1]", "RES_FIRE[1] | RES_COLD[-1]"];
    });
    const nonZero = (r["elInfo"] as Array<{ resLevel: number }>)
      .map((e, i) => [i, e.resLevel] as const)
      .filter(([, v]) => v !== 0);
    expect(nonZero).toHaveLength(3);
    expect(nonZero.filter(([, v]) => v === -1)).toHaveLength(1);
  });

  it.each([
    ["XYZZY[2]", /unknown race value: XYZZY\[2\]/],
    ["RES_XYZZY[3]", /unknown race value: RES_XYZZY\[3\]/],
  ] as const)(
    "rejects the value %s (test_values_bad0, INVALID_VALUE)",
    (token, message) => {
      rejectRace((rec) => {
        rec["values"] = [token];
      }, message);
    },
  );
});

/* ------------------------------------------------------------------ *
 * a-info.c / e-info.c / curse.c -- bound by obj/bind.ts
 * ------------------------------------------------------------------ */

function objPack(): ObjPackJson {
  return {
    objectBase: packFile("object_base"),
    object: packFile("object"),
    egoItem: packFile("ego_item"),
    artifact: packFile("artifact"),
    curse: packFile("curse"),
    brand: packFile("brand"),
    slay: packFile("slay"),
    activation: packFile("activation"),
    objectProperty: packFile("object_property"),
    flavor: packFile("flavor"),
  } as unknown as ObjPackJson;
}

const OBJ_PACK = objPack();

describe("a-info.c: artifact binder", () => {
  const freshPack = (): ObjPackJson => clone(OBJ_PACK);

  function recs(pack: ObjPackJson, file: keyof ObjPackJson): Rec[] {
    return (pack[file] as unknown as { records: Rec[] }).records;
  }

  /** The last artifact, so mutating it cannot disturb the dummy-kind order. */
  function art(pack: ObjPackJson): Rec {
    const list = recs(pack, "artifact");
    return list[list.length - 1] as Rec;
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => new ObjRegistry(freshPack())).not.toThrow();
  });

  it("rejects a numeric-looking bad tval on base-object: (test_badtval1)", () => {
    /* tval_find_idx's numeric branch only accepts unsigned digits, so "-1"
     * falls through to the name scan and misses -> UNRECOGNISED_TVAL. */
    const pack = freshPack();
    (art(pack)["base-object"] as Rec)["tval"] = "-1";
    expect(() => new ObjRegistry(pack)).toThrow(/artifact: unknown tval -1/);
  });

  it("resolves base-object: to a tval/sval pair (test_base_object0)", () => {
    const reg = new ObjRegistry(freshPack());
    /* Every artifact must resolve to a real kind - a special artifact via a
     * dummy INSTA_ART record written by write_dummy_object_record, an ordinary
     * one via lookup_sval. */
    for (const a of reg.artifacts) {
      if (!a) continue;
      expect(reg.lookupKind(a.tval, a.sval), a.name).toBeTruthy();
    }
    expect(reg.artifacts.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("level / weight / cost / attack / armor bind straight through (test_level0, test_weight0, test_cost0, test_attack0, test_armor0)", () => {
    const pack = freshPack();
    Object.assign(art(pack), {
      level: 3,
      weight: 8,
      cost: 200,
      attack: { hd: "4d5", "to-h": 8, "to-d": 2 },
      armor: { ac: 3, "to-a": 1 },
    });
    const reg = new ObjRegistry(pack);
    const a = reg.artifacts[reg.artifacts.length - 1]!;
    expect([a.level, a.weight, a.cost]).toEqual([3, 8, 200]);
    /* `attack rand hd int to-h int to-d`: the dice go to dd/ds, the two ints
     * straight to to_h/to_d. */
    expect([a.dd, a.ds, a.toH, a.toD]).toEqual([4, 5, 8, 2]);
    expect([a.ac, a.toA]).toEqual([3, 1]);
  });

  /* a-info alloc0 / alloc1 / alloc2. */
  describe("test_alloc0 / test_alloc1 / test_alloc2: alloc bounds", () => {
    function allocReject(minmax: string, message: RegExp): void {
      const pack = freshPack();
      art(pack)["alloc"] = { common: 3, minmax };
      expect(() => new ObjRegistry(pack)).toThrow(message);
    }

    it("accepts a well-formed range (test_alloc2)", () => {
      const pack = freshPack();
      art(pack)["alloc"] = { common: 3, minmax: "5 to 10" };
      const reg = new ObjRegistry(pack);
      const a = reg.artifacts[reg.artifacts.length - 1]!;
      expect([a.allocProb, a.allocMin, a.allocMax]).toEqual([3, 5, 10]);
    });

    it("rejects a range with no `to` separator (test_alloc0, INVALID_ALLOCATION)", () => {
      /* obj-init.c parse_artifact_alloc: grab_int_range fails ->
       * PARSE_ERROR_INVALID_ALLOCATION. */
      allocReject("5", /invalid allocation range "5"/);
    });

    it("rejects an endpoint above 255 (test_alloc1, OUT_OF_BOUNDS)", () => {
      /* `amin > 255 || amax > 255 || amin < 0 || amax < 0`. */
      allocReject("5 to 300", /allocation out of bounds/);
    });

    it("rejects a negative endpoint (OUT_OF_BOUNDS)", () => {
      allocReject("-1 to 100", /allocation out of bounds/);
    });
  });

  it("flags: merges object flags and element flags (test_flags0)", () => {
    const pack = freshPack();
    art(pack)["flags"] = ["SEE_INVIS | HOLD_LIFE", "HATES_FIRE"];
    const reg = new ObjRegistry(pack);
    const a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.flags.count()).toBe(2);
    /* HATES_FIRE is an el_info flag, not an object flag - so it must NOT
     * land in `flags`, and the count above proves it did not. */
    expect(
      a.elInfo.filter((e) => (e.flags & EL_INFO_HATES) !== 0),
    ).toHaveLength(1);
  });

  it("an empty flags: line adds nothing (test_flags0)", () => {
    const pack = freshPack();
    art(pack)["flags"] = [];
    const reg = new ObjRegistry(pack);
    expect(reg.artifacts[reg.artifacts.length - 1]!.flags.isEmpty()).toBe(true);
  });

  it("values: sets modifiers and RES_ levels (test_values0)", () => {
    const pack = freshPack();
    art(pack)["values"] = ["STR[1] | CON[1]", "RES_ACID[-1]"];
    const reg = new ObjRegistry(pack);
    const a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.modifiers.filter((m) => m !== 0)).toEqual([1, 1]);
    expect(a.elInfo[0]!.resLevel).toBe(-1);
  });

  it("act: resolves to an activation and silently tolerates an unknown one (test_act0)", () => {
    /* parse_artifact_act stores whatever findact() returned, NULL included,
     * and never errors - the same tolerance e-info.c test_act_bad0 asserts. */
    const pack = freshPack();
    art(pack)["act"] = "CLAIRVOYANCE";
    art(pack)["time"] = "20+d30";
    let reg = new ObjRegistry(pack);
    let a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.activation?.name).toBe("CLAIRVOYANCE");
    /* time: is parsed only alongside act:, exactly as upstream. */
    expect([a.time.base, a.time.dice, a.time.sides]).toEqual([20, 1, 30]);

    art(pack)["act"] = "XYZZY";
    reg = new ObjRegistry(pack);
    a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.activation).toBe(null);
  });

  it("msg: and desc: join with no separator (test_msg0, test_desc0)", () => {
    const pack = freshPack();
    art(pack)["msg"] = ["foo", "bar"];
    art(pack)["desc"] = ["baz", " quxx"];
    const reg = new ObjRegistry(pack);
    const a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.altMsg).toBe("foobar");
    expect(a.text).toBe("baz quxx");
  });

  it("slay: and brand: set their 1-based flags (test_slay0, test_brand0)", () => {
    const pack = freshPack();
    art(pack)["slay"] = ["ANIMAL_2"];
    art(pack)["brand"] = ["ACID_3"];
    const reg = new ObjRegistry(pack);
    const a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.slays![0]).toBe(false);
    expect(a.slays![reg.lookupSlay("ANIMAL_2")]).toBe(true);
    expect(a.brands![0]).toBe(false);
    expect(a.brands![reg.lookupBrand("ACID_3")]).toBe(true);
  });

  it("curse: only stores a positive power, and does not error on a non-positive one (test_curse0)", () => {
    /* parse_artifact_curse: `if (power > 0)` guards the store, but a zero or
     * negative power still returns PARSE_ERROR_NONE - and when EVERY entry is
     * non-positive the curses array stays NULL. */
    const pack = freshPack();
    art(pack)["curse"] = [
      { name: "vulnerability", power: 0 },
      { name: "vulnerability", power: -7 },
    ];
    let reg = new ObjRegistry(pack);
    expect(reg.artifacts[reg.artifacts.length - 1]!.curses).toBe(null);

    art(pack)["curse"] = [
      { name: "vulnerability", power: 0 },
      { name: "teleportation", power: 15 },
    ];
    reg = new ObjRegistry(pack);
    const a = reg.artifacts[reg.artifacts.length - 1]!;
    expect(a.curses![reg.lookupCurse("vulnerability")]).toBe(0);
    expect(a.curses![reg.lookupCurse("teleportation")]).toBe(15);
  });
});

describe("e-info.c: ego item binder", () => {
  const freshPack = (): ObjPackJson => clone(OBJ_PACK);

  function ego(pack: ObjPackJson): Rec {
    return (pack.egoItem as unknown as { records: Rec[] }).records[0] as Rec;
  }

  it("info: is cost then rating (test_info0)", () => {
    const pack = freshPack();
    ego(pack)["info"] = { cost: 6, rating: 8 };
    const e = new ObjRegistry(pack).egos[0]!;
    expect([e.cost, e.rating]).toEqual([6, 8]);
  });

  it("alloc: binds prob/min/max (test_alloc0)", () => {
    const pack = freshPack();
    ego(pack)["alloc"] = { common: 40, minmax: "10 to 100" };
    const e = new ObjRegistry(pack).egos[0]!;
    expect([e.allocProb, e.allocMin, e.allocMax]).toEqual([40, 10, 100]);
  });

  it.each([
    ["10 100", /invalid allocation range/],
    ["-1 to 100", /allocation out of bounds/],
    ["0 to 290", /allocation out of bounds/],
    ["370 to 40", /allocation out of bounds/],
    ["30 to -7", /allocation out of bounds/],
    ["-70 to -3", /allocation out of bounds/],
    ["-10 to 371", /allocation out of bounds/],
    ["268 to 500", /allocation out of bounds/],
  ] as const)("rejects alloc %j (test_alloc_bad0)", (minmax, message) => {
    const pack = freshPack();
    ego(pack)["alloc"] = { common: 40, minmax };
    expect(() => new ObjRegistry(pack)).toThrow(message);
  });

  it("type: admits every kind of that tval (test_type0)", () => {
    const pack = freshPack();
    ego(pack)["type"] = ["sword"];
    delete ego(pack)["item"];
    const reg = new ObjRegistry(pack);
    const possItems = reg.egos[0]!.possItems;
    /* parse_ego_type walks every k_info entry of that tval, so the admitted
     * set must be EXACTLY the kinds of TV_SWORD - nothing more, nothing
     * less. */
    const swordTval = reg.kinds.find((k) => possItems.has(k.kidx))!.tval;
    expect(swordTval).toBe(TV.SWORD);
    const swords = reg.kinds.filter((k) => k.tval === swordTval);
    expect(swords.length).toBeGreaterThan(1);
    expect(possItems.size).toBe(swords.length);
    for (const kind of swords) expect(possItems.has(kind.kidx)).toBe(true);
  });

  it("item: admits exactly the named kind (test_item0)", () => {
    const pack = freshPack();
    delete ego(pack)["type"];
    /* Upstream's fixture uses helm:Skullcap; the shipped object.txt calls the
     * same slot "& Metal Cap~", and lookup_sval matches against
     * obj_desc_name_format's singular form, so "Metal Cap" is the token. */
    ego(pack)["item"] = [{ tval: "helm", sval: "Metal Cap" }];
    const reg = new ObjRegistry(pack);
    const possItems = reg.egos[0]!.possItems;
    expect(possItems.size).toBe(1);
    const kidx = [...possItems][0]!;
    expect(reg.kinds[kidx]!.name).toContain("Metal Cap");
  });

  it("combat: is dice, min-combat: is ints (test_combat0, test_min0)", () => {
    /* Getting these two the same way round is a live gameplay bug: the ego
     * bonus rolls, its minimum does not. */
    const pack = freshPack();
    ego(pack)["combat"] = { th: "1d2", td: "3d4", ta: "5d6" };
    ego(pack)["min-combat"] = { th: 10, td: 13, ta: 4 };
    const e = new ObjRegistry(pack).egos[0]!;
    expect([e.toH.dice, e.toH.sides]).toEqual([1, 2]);
    expect([e.toD.dice, e.toD.sides]).toEqual([3, 4]);
    expect([e.toA.dice, e.toA.sides]).toEqual([5, 6]);
    expect([e.minToH, e.minToD, e.minToA]).toEqual([10, 13, 4]);
  });

  it("act: resolves, and an unknown one is NOT an error (test_act0, test_act_bad0)", () => {
    /* obj-init.c parse_ego_act returns PARSE_ERROR_NONE unconditionally:
     * `e->activation = findact(name)`, NULL included. */
    const pack = freshPack();
    ego(pack)["act"] = "ILLUMINATION";
    ego(pack)["time"] = "100+1d200";
    let e = new ObjRegistry(pack).egos[0]!;
    expect(e.activation?.name).toBe("ILLUMINATION");
    expect([e.time.base, e.time.dice, e.time.sides]).toEqual([100, 1, 200]);

    ego(pack)["act"] = "XYZZY";
    e = new ObjRegistry(pack).egos[0]!;
    expect(e.activation).toBe(null);
  });

  it("flags: splits across object, kind and element flags (test_flags0)", () => {
    const pack = freshPack();
    ego(pack)["flags"] = ["SEE_INVIS", "RAND_POWER | IGNORE_ACID"];
    const e = new ObjRegistry(pack).egos[0]!;
    expect(e.flags.count()).toBe(1);
    expect(e.kindFlags.count()).toBe(1);
    /* IGNORE_ACID is an el_info flag on ELEM_ACID (index 0). */
    expect(e.elInfo[0]!.flags & EL_INFO_IGNORE).toBe(EL_INFO_IGNORE);
  });

  it("flags-off: is object flags only (test_flags_off0)", () => {
    const pack = freshPack();
    ego(pack)["flags-off"] = ["FEATHER", "SEE_INVIS | PROT_FEAR"];
    expect(new ObjRegistry(pack).egos[0]!.flagsOff.count()).toBe(3);
  });

  it("an empty flags: / flags-off: line adds nothing (test_flags0, test_flags_off0)", () => {
    const pack = freshPack();
    ego(pack)["flags"] = [];
    ego(pack)["flags-off"] = [];
    const e = new ObjRegistry(pack).egos[0]!;
    expect(e.flags.isEmpty()).toBe(true);
    expect(e.flagsOff.isEmpty()).toBe(true);
  });

  it("values: are RANDOM values, min-values: are ints (test_values0, test_min_values0)", () => {
    const pack = freshPack();
    ego(pack)["values"] = ["STEALTH[1+2d3]", "INFRA[3] | RES_POIS[1]"];
    ego(pack)["min-values"] = ["SPEED[1]", "STEALTH[2] | INFRA[4]"];
    const e = new ObjRegistry(pack).egos[0]!;
    const rolled = e.modifiers.filter((m) => m.dice !== 0 || m.base !== 0);
    expect(rolled).toContainEqual({ base: 1, dice: 2, sides: 3, mBonus: 0 });
    expect(rolled).toContainEqual({ base: 3, dice: 0, sides: 0, mBonus: 0 });
    expect(e.minModifiers.filter((m) => m !== 0).sort((a, b) => a - b)).toEqual([
      1, 2, 4,
    ]);
  });

  it("desc: joins with no separator (test_desc0)", () => {
    const pack = freshPack();
    ego(pack)["desc"] = ["foo", " bar"];
    expect(new ObjRegistry(pack).egos[0]!.text).toBe("foo bar");
  });

  it("slay / brand / curse, with the power > 0 gate (test_slay0, test_brand0, test_curse0)", () => {
    const pack = freshPack();
    ego(pack)["slay"] = ["ANIMAL_2"];
    ego(pack)["brand"] = ["COLD_2"];
    ego(pack)["curse"] = [
      { name: "teleportation", power: 0 },
      { name: "teleportation", power: -8 },
    ];
    let reg = new ObjRegistry(pack);
    let e = reg.egos[0]!;
    expect(e.slays![reg.lookupSlay("ANIMAL_2")]).toBe(true);
    expect(e.brands![reg.lookupBrand("COLD_2")]).toBe(true);
    expect(e.curses).toBe(null);

    ego(pack)["curse"] = [{ name: "vulnerability", power: 12 }];
    reg = new ObjRegistry(pack);
    e = reg.egos[0]!;
    expect(e.curses![reg.lookupCurse("vulnerability")]).toBe(12);
  });
});

describe("curse.c: curse binder", () => {
  const freshPack = (): ObjPackJson => clone(OBJ_PACK);

  /** finish_parse_curse binds in reverse file order, so index 1 is the last. */
  function curseRec(pack: ObjPackJson): Rec {
    const list = (pack.curse as unknown as { records: Rec[] }).records;
    return list[list.length - 1] as Rec;
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => new ObjRegistry(freshPack())).not.toThrow();
  });

  it("type: marks the tval possible (test_type0)", () => {
    const pack = freshPack();
    curseRec(pack)["type"] = ["cloak"];
    const c = new ObjRegistry(pack).curses[1]!;
    expect(c.poss.filter(Boolean)).toHaveLength(1);
  });

  it("combat: is to-h / to-d / to-a (test_combat0)", () => {
    const pack = freshPack();
    curseRec(pack)["combat"] = { "to-h": 1, "to-d": -2, "to-a": 3 };
    const c = new ObjRegistry(pack).curses[1]!;
    expect([c.obj.toH, c.obj.toD, c.obj.toA]).toEqual([1, -2, 3]);
  });

  /* GAP-4 (fixed): curse weight int16 range. */
  describe("test_weight0 / test_weight_bad0: weight must fit an int16", () => {
    it("accepts a negative adjustment (test_weight0)", () => {
      const pack = freshPack();
      curseRec(pack)["weight"] = -42;
      expect(new ObjRegistry(pack).curses[1]!.obj.weight).toBe(-42);
    });

    it("accepts both limits exactly", () => {
      for (const w of [-32768, 32767]) {
        const pack = freshPack();
        curseRec(pack)["weight"] = w;
        expect(new ObjRegistry(pack).curses[1]!.obj.weight, String(w)).toBe(w);
      }
    });

    it.each([32769, -32780])("rejects weight:%s (INVALID_VALUE)", (w) => {
      /* obj-init.c parse_curse_weight: `adjustment < -32768 ||
       * adjustment > 32767` -> PARSE_ERROR_INVALID_VALUE, because the field
       * is an int16_t. */
      const pack = freshPack();
      curseRec(pack)["weight"] = w;
      expect(() => new ObjRegistry(pack)).toThrow(
        /does not fit in an int16/,
      );
    });

    it("leaves weight 0 when there is no weight: line", () => {
      const pack = freshPack();
      delete curseRec(pack)["weight"];
      expect(new ObjRegistry(pack).curses[1]!.obj.weight).toBe(0);
    });
  });

  it("flags: merges object flags and element flags (test_flags0)", () => {
    const pack = freshPack();
    curseRec(pack)["flags"] = ["AGGRAVATE", "HATES_FIRE | IGNORE_ACID"];
    const c = new ObjRegistry(pack).curses[1]!;
    expect(c.obj.flags.count()).toBe(1);
    /* EL_INFO_HATES on FIRE and EL_INFO_IGNORE on ACID. */
    expect(
      c.obj.elInfo.filter((e) => (e.flags & EL_INFO_HATES) !== 0),
    ).toHaveLength(1);
    expect(
      c.obj.elInfo.filter((e) => (e.flags & EL_INFO_IGNORE) !== 0),
    ).toHaveLength(1);
  });

  it("values: sets modifiers and RES_ levels (test_values0)", () => {
    const pack = freshPack();
    curseRec(pack)["values"] = ["SPEED[-2]", "STEALTH[4] | RES_ELEC[3]"];
    const c = new ObjRegistry(pack).curses[1]!;
    expect(c.obj.modifiers.filter((m) => m !== 0).sort((a, b) => a - b)).toEqual(
      [-2, 4],
    );
    expect(c.obj.elInfo[1]!.resLevel).toBe(3);
  });

  it("msg: and desc: join with no separator (test_msg0, test_desc0)", () => {
    const pack = freshPack();
    curseRec(pack)["msg"] = ["Your equipment grabs you!", " And doesn't let go!"];
    curseRec(pack)["desc"] = ["makes you frail", " and clumsy"];
    const c = new ObjRegistry(pack).curses[1]!;
    expect(c.obj.effectMsg).toBe(
      "Your equipment grabs you! And doesn't let go!",
    );
    expect(c.desc).toBe("makes you frail and clumsy");
  });

  it("time: parses to a RandomValue (test_time0)", () => {
    const pack = freshPack();
    curseRec(pack)["time"] = "9+10d8";
    const t = new ObjRegistry(pack).curses[1]!.obj.time;
    expect([t.base, t.dice, t.sides, t.mBonus]).toEqual([9, 10, 8, 0]);
  });

  it("conflict: wraps each name in pipes and appends (test_conflict0)", () => {
    /* parse_curse_conflict appends "|", the name, then "|" - so two lines
     * give "|a||b|", and lookup elsewhere searches for "|name|". */
    const pack = freshPack();
    curseRec(pack)["conflict"] = ["chilled to the bone", "burning up"];
    expect(new ObjRegistry(pack).curses[1]!.conflict).toBe(
      "|chilled to the bone||burning up|",
    );
  });

  it("conflict-flags: are object flags on their own set (test_conflict_flags0)", () => {
    const pack = freshPack();
    curseRec(pack)["conflict-flags"] = ["AFRAID", "PROT_FEAR | NO_TELEPORT"];
    const c = new ObjRegistry(pack).curses[1]!;
    expect(c.conflictFlags.count()).toBe(3);
    /* They must NOT leak into the curse object's own flags. */
    expect(c.obj.flags.count()).toBe(0);
  });

  it("assembles the combined record's effect chain in order (test_combined0)", () => {
    const pack = freshPack();
    Object.assign(curseRec(pack), {
      type: ["helm"],
      effect: [
        { eff: "CURE", type: "POISONED" },
        { eff: "TIMED_DEC", type: "CUT", dice: "20" },
        { eff: "RESTORE_STAT", type: "STR" },
        { eff: "RESTORE_STAT", type: "CON" },
        { eff: "DRAIN_MANA", dice: "15" },
        { eff: "TIMED_INC", type: "CONFUSED", dice: "20+1d20" },
      ],
      time: "99+1d100",
      conflict: ["sickliness", "poison"],
      "conflict-flags": ["SUST_STR | SUST_CON"],
    });
    const c = new ObjRegistry(pack).curses[1]!;
    expect(c.obj.effect!.map((e) => e.eff)).toEqual([
      "CURE",
      "TIMED_DEC",
      "RESTORE_STAT",
      "RESTORE_STAT",
      "DRAIN_MANA",
      "TIMED_INC",
    ]);
    /* The dice must stay attached to the effect they followed. */
    expect(c.obj.effect!.map((e) => e.dice ?? null)).toEqual([
      null,
      "20",
      null,
      null,
      "15",
      "20+1d20",
    ]);
    expect(c.conflict).toBe("|sickliness||poison|");
  });
});
