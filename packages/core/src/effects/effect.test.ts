import { describe, expect, it } from "vitest";

import { EF, MON_TMD, PROJ, STAT, TMD } from "../generated";
import { Rng } from "../rng";
import {
  EF_MAX,
  ENCH_TOAC,
  ENCH_TOBOTH,
  ENCH_TODAM,
  ENCH_TOHIT,
  EffectBuilder,
  effectLookup,
  effectNew,
  effectSubtype,
  effectValidUpstream,
  effectValueBaseByName,
  monTimedNameToIdx,
  projNameToIdx,
  statNameToIdx,
  timedNameToIdx,
} from "./effect";

describe("effectLookup", () => {
  it("maps names to EF indices (entry index + 1)", () => {
    expect(effectLookup("RANDOM")).toBe(EF.RANDOM);
    expect(effectLookup("HEAL_HP")).toBe(EF.HEAL_HP);
    expect(effectLookup("UNSCRAMBLE_STATS")).toBe(EF.UNSCRAMBLE_STATS);
  });

  it("returns EF_MAX for unknown names and is case-sensitive (streq)", () => {
    expect(effectLookup("XYZZY")).toBe(EF_MAX);
    expect(effectLookup("heal_hp")).toBe(EF_MAX);
  });
});

describe("effectValidUpstream", () => {
  it("accepts (EF_NONE, EF_MAX) numeric indices only", () => {
    expect(effectValidUpstream(effectNew(EF.HEAL_HP))).toBe(true);
    expect(effectValidUpstream(effectNew(0))).toBe(false);
    expect(effectValidUpstream(effectNew(EF_MAX))).toBe(false);
    expect(effectValidUpstream(effectNew("MOD_X"))).toBe(false);
    expect(effectValidUpstream(null)).toBe(false);
  });
});

describe("name_to_idx lookups", () => {
  it("proj_name_to_idx: case-insensitive, MAX reachable", () => {
    expect(projNameToIdx("FIRE")).toBe(PROJ.FIRE);
    expect(projNameToIdx("fire")).toBe(PROJ.FIRE);
    expect(projNameToIdx("MON_CRUSH")).toBe(PROJ.MON_CRUSH);
    /* "MAX" trails the name list, so it resolves to PROJ_MAX. */
    expect(projNameToIdx("MAX")).toBe(PROJ.MON_CRUSH + 1);
    expect(projNameToIdx("NOPE")).toBe(-1);
  });

  it("timed_name_to_idx: case-insensitive over TMD names", () => {
    expect(timedNameToIdx("FAST")).toBe(TMD.FAST);
    expect(timedNameToIdx("FOOD")).toBe(TMD.FOOD);
    expect(timedNameToIdx("opp_fire")).toBe(TMD.OPP_FIRE);
    expect(timedNameToIdx("XYZZY")).toBe(-1);
  });

  it("mon_timed_name_to_idx: case-sensitive, MAX not reachable", () => {
    expect(monTimedNameToIdx("SLEEP")).toBe(MON_TMD.SLEEP);
    expect(monTimedNameToIdx("FEAR")).toBe(MON_TMD.FEAR);
    expect(monTimedNameToIdx("sleep")).toBe(-1);
    expect(monTimedNameToIdx("MAX")).toBe(-1);
  });

  it("stat_name_to_idx: case-insensitive, trailing MAX reachable", () => {
    expect(statNameToIdx("STR")).toBe(STAT.STR);
    expect(statNameToIdx("con")).toBe(STAT.CON);
    expect(statNameToIdx("MAX")).toBe(5);
    expect(statNameToIdx("LUC")).toBe(-1);
  });
});

describe("effectSubtype", () => {
  it("accepts plain numeric values with trailing spaces/tabs only", () => {
    expect(effectSubtype(EF.BALL, "7")).toBe(7);
    expect(effectSubtype(EF.BALL, "  7 \t")).toBe(7);
    expect(effectSubtype(EF.BALL, "-3")).toBe(-3);
    expect(effectSubtype(EF.BALL, "7x")).toBe(-1);
    expect(effectSubtype(EF.BALL, "2147483647")).toBe(-1);
    expect(effectSubtype(EF.BALL, "-2147483648")).toBe(-1);
    expect(effectSubtype(EF.BALL, "2147483646")).toBe(2147483646);
  });

  it("resolves projection names for the projection family", () => {
    expect(effectSubtype(EF.BALL, "FIRE")).toBe(PROJ.FIRE);
    expect(effectSubtype(EF.BOLT, "COLD")).toBe(PROJ.COLD);
    expect(effectSubtype(EF.TOUCH_AWARE, "ACID")).toBe(PROJ.ACID);
    expect(effectSubtype(EF.MELEE_BLOWS, "POIS")).toBe(PROJ.POIS);
    expect(effectSubtype(EF.PROJECT_LOS, "MON_CONF")).toBe(PROJ.MON_CONF);
  });

  it("resolves timed effect names for the timed family", () => {
    expect(effectSubtype(EF.CURE, "POISONED")).toBe(TMD.POISONED);
    expect(effectSubtype(EF.TIMED_SET, "BLESSED")).toBe(TMD.BLESSED);
    expect(effectSubtype(EF.TIMED_INC, "OPP_FIRE")).toBe(TMD.OPP_FIRE);
    expect(effectSubtype(EF.TIMED_INC_NO_RES, "STUN")).toBe(TMD.STUN);
    expect(effectSubtype(EF.TIMED_DEC, "CUT")).toBe(TMD.CUT);
  });

  it("resolves stat names for the stat family", () => {
    expect(effectSubtype(EF.RESTORE_STAT, "STR")).toBe(STAT.STR);
    expect(effectSubtype(EF.DRAIN_STAT, "INT")).toBe(STAT.INT);
    expect(effectSubtype(EF.LOSE_RANDOM_STAT, "WIS")).toBe(STAT.WIS);
    expect(effectSubtype(EF.GAIN_STAT, "DEX")).toBe(STAT.DEX);
  });

  it("resolves the fixed vocabularies", () => {
    expect(effectSubtype(EF.NOURISH, "INC_BY")).toBe(0);
    expect(effectSubtype(EF.NOURISH, "DEC_BY")).toBe(1);
    expect(effectSubtype(EF.NOURISH, "SET_TO")).toBe(2);
    expect(effectSubtype(EF.NOURISH, "INC_TO")).toBe(3);
    expect(effectSubtype(EF.NOURISH, "SIP")).toBe(-1);

    expect(effectSubtype(EF.ENCHANT, "TOBOTH")).toBe(ENCH_TOBOTH);
    expect(effectSubtype(EF.ENCHANT, "TOHIT")).toBe(ENCH_TOHIT);
    expect(effectSubtype(EF.ENCHANT, "TODAM")).toBe(ENCH_TODAM);
    expect(effectSubtype(EF.ENCHANT, "TOAC")).toBe(ENCH_TOAC);

    expect(effectSubtype(EF.EARTHQUAKE, "TARGETED")).toBe(1);
    expect(effectSubtype(EF.EARTHQUAKE, "NONE")).toBe(0);
    expect(effectSubtype(EF.GLYPH, "WARDING")).toBe(1);
    expect(effectSubtype(EF.GLYPH, "DECOY")).toBe(2);
    expect(effectSubtype(EF.TELEPORT, "AWAY")).toBe(1);
    expect(effectSubtype(EF.TELEPORT_TO, "SELF")).toBe(1);
  });

  it("resolves monster timed names for MON_TIMED_INC", () => {
    expect(effectSubtype(EF.MON_TIMED_INC, "STUN")).toBe(MON_TMD.STUN);
    expect(effectSubtype(EF.MON_TIMED_INC, "stun")).toBe(-1);
  });

  it("defaults: NONE is 0, anything else fails", () => {
    expect(effectSubtype(EF.LIGHT_AREA, "NONE")).toBe(0);
    expect(effectSubtype(EF.LIGHT_AREA, "SOMETHING")).toBe(-1);
  });

  it("defers SUMMON and SHAPECHANGE to injected resolvers", () => {
    expect(effectSubtype(EF.SUMMON, "KIN")).toBe(-1);
    expect(
      effectSubtype(EF.SUMMON, "KIN", {
        summonNameToIdx: (name) => (name === "KIN" ? 12 : -1),
      }),
    ).toBe(12);
    expect(effectSubtype(EF.SHAPECHANGE, "FOX")).toBe(-1);
    expect(
      effectSubtype(EF.SHAPECHANGE, "FOX", {
        shapeNameToIdx: () => 2,
      }),
    ).toBe(2);
  });

  it("routes mod string codes through the custom resolver", () => {
    expect(effectSubtype("MOD_X", "NONE")).toBe(0);
    expect(effectSubtype("MOD_X", "SPARKLE")).toBe(-1);
    expect(effectSubtype("MOD_X", "5")).toBe(5);
    expect(
      effectSubtype("MOD_X", "SPARKLE", {
        custom: (code, type) =>
          code === "MOD_X" && type === "SPARKLE" ? 9 : -1,
      }),
    ).toBe(9);
  });
});

describe("effectValueBaseByName", () => {
  it("is case-insensitive over the injected providers", () => {
    const providers = { PLAYER_LEVEL: () => 30 };
    expect(effectValueBaseByName("player_level", providers)?.()).toBe(30);
    expect(effectValueBaseByName("SPELL_POWER", providers)).toBeNull();
    expect(effectValueBaseByName("PLAYER_LEVEL")).toBeNull();
  });
});

describe("EffectBuilder", () => {
  it("builds a chain from gamedata-style directives", () => {
    const chain = new EffectBuilder()
      .effect("TIMED_INC:OPP_FIRE")
      .dice("20+1d20")
      .effect("HEAL_HP")
      .dice("30+1d10")
      .effect("BALL:FIRE:2")
      .dice("72")
      .build();

    expect(chain).not.toBeNull();
    expect(chain?.index).toBe(EF.TIMED_INC);
    expect(chain?.subtype).toBe(TMD.OPP_FIRE);
    expect(chain?.diceString).toBe("20+1d20");

    const second = chain?.next;
    expect(second?.index).toBe(EF.HEAL_HP);
    expect(second?.diceString).toBe("30+1d10");
    /* 30+1d10 rolls in [31, 40]. */
    const rng = new Rng(3);
    for (let i = 0; i < 20; i++) {
      const rolled = second?.dice?.roll(rng) as number;
      expect(rolled).toBeGreaterThanOrEqual(31);
      expect(rolled).toBeLessThanOrEqual(40);
    }

    const third = second?.next;
    expect(third?.index).toBe(EF.BALL);
    expect(third?.subtype).toBe(PROJ.FIRE);
    expect(third?.radius).toBe(2);
    expect(third?.next).toBeNull();
  });

  it("applies effect-yx and other, and appends effect-msg", () => {
    const chain = new EffectBuilder()
      .effect("SPOT:FIRE:3:10")
      .effectYx(5, 12)
      .effectMsg("burns you")
      .effectMsg(" badly")
      .build();
    expect(chain?.subtype).toBe(PROJ.FIRE);
    expect(chain?.radius).toBe(3);
    expect(chain?.other).toBe(10);
    expect(chain?.y).toBe(5);
    expect(chain?.x).toBe(12);
    expect(chain?.msg).toBe("burns you badly");
  });

  it("binds expressions with injected base values", () => {
    const chain = new EffectBuilder({
      baseValues: { PLAYER_LEVEL: () => 30 },
    })
      .effect("HEAL_HP")
      .dice("$B")
      .expr("B", "PLAYER_LEVEL", "/ 2")
      .build();
    /* base = 30 / 2 = 15, no dice. */
    const rng = new Rng(1);
    expect(chain?.dice?.roll(rng)).toBe(15);
  });

  it("tolerates orphan dice/expr/yx directives, as upstream parsers", () => {
    const chain = new EffectBuilder()
      .dice("1d4")
      .expr("B", "PLAYER_LEVEL", "/ 2")
      .effectYx(1, 1)
      .effectMsg("nothing")
      .build();
    expect(chain).toBeNull();
  });

  it("throws upstream-named parse errors", () => {
    expect(() => new EffectBuilder().effect("NO_SUCH_EFFECT")).toThrow(
      /PARSE_ERROR_INVALID_EFFECT/,
    );
    expect(() => new EffectBuilder().effect("CURE:NO_SUCH_TIMED")).toThrow(
      /PARSE_ERROR_INVALID_VALUE/,
    );
    expect(() =>
      new EffectBuilder().effect("HEAL_HP").dice("1+2d3M-4"),
    ).toThrow(/PARSE_ERROR_INVALID_DICE/);
    expect(() =>
      new EffectBuilder().effect("HEAL_HP").dice("$B+1d4").expr("Z", "X", "/ 2"),
    ).toThrow(/PARSE_ERROR_UNBOUND_EXPRESSION/);
    expect(() =>
      new EffectBuilder()
        .effect("HEAL_HP")
        .dice("$B+1d4")
        .expr("B", "PLAYER_LEVEL", "% 2"),
    ).toThrow(/PARSE_ERROR_BAD_EXPRESSION_STRING/);
  });

  it("resolves mod effect names through lookupEffect", () => {
    const builder = new EffectBuilder({
      lookupEffect: (name) => (name === "MOD_SPARKLE" ? "MOD_SPARKLE" : null),
      custom: (code, type) =>
        code === "MOD_SPARKLE" && type === "GLITTER" ? 4 : -1,
    });
    const chain = builder
      .effect("MOD_SPARKLE:GLITTER")
      .dice("2d6")
      .build();
    expect(chain?.index).toBe("MOD_SPARKLE");
    expect(chain?.subtype).toBe(4);
  });
});
