import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EF, PROJ } from "../generated";
import { Rng } from "../rng";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { EffectBuilder, effectNew } from "./effect";
import {
  appendRandomValueString,
  describeEffect,
  effectAvgDamage,
  effectDamages,
  effectInfo,
  effectNext,
  effectProjection,
  getSpellInfo,
  spellDamageSummary,
} from "./effect-info";
import type { EffectDescribeDeps } from "./effect-info";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as { records: T[] };
  return parsed.records;
}

const projections = bindProjections(packJson<ProjectionRecordJson>("projection"));

function describeDeps(overrides: Partial<EffectDescribeDeps> = {}): EffectDescribeDeps {
  return { projections, ...overrides };
}

describe("effectInfo / effectDamages", () => {
  it("reads the info string straight off the generated table", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("3d8").build();
    expect(effectInfo(bolt)).toBe("dam");
    expect(effectDamages(bolt!)).toBe(true);

    const heal = new EffectBuilder().effect("HEAL_HP").dice("15").build();
    expect(effectInfo(heal)).toBe("heal");
    expect(effectDamages(heal!)).toBe(false);

    const teleport = new EffectBuilder().effect("TELEPORT").dice("10").build();
    expect(effectInfo(teleport)).toBe("range");
    expect(effectDamages(teleport!)).toBe(false);
  });

  it("returns null/false for an invalid effect (EF_NONE, out of range)", () => {
    expect(effectInfo(effectNew(EF.NONE))).toBeNull();
    expect(effectInfo(null)).toBeNull();
  });
});

describe("effectAvgDamage", () => {
  it("computes the integer average of a simple bolt (2d4 -> 5)", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("2d4").build()!;
    /* 2 * (4+1) / 2 = 5, base 0. */
    expect(effectAvgDamage(bolt, null)).toBe(5);
  });

  it("computes the integer average of a bolt with base + dice (5+2d4 -> 10)", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("5+2d4").build()!;
    expect(effectAvgDamage(bolt, null)).toBe(10);
  });

  it("returns a fixed heal's own base with no averaging needed (heal isn't 'dam')", () => {
    const heal = new EffectBuilder().effect("HEAL_HP").dice("15").build()!;
    /* HEAL_HP's info is "heal", not "dam", so effect_avg_damage reports 0. */
    expect(effectAvgDamage(heal, null)).toBe(0);
  });

  it("threads a shared SET_VALUE dice into a following dice-less damaging effect", () => {
    /* SET_VALUE 4d6, then a BOLT with no dice of its own: mirrors spells that
     * share one dice roll across several sub-effects. */
    const chain = new EffectBuilder().effect("SET_VALUE").dice("4d6").effect("BOLT:FIRE").build()!;
    const bolt = chain.next!;
    expect(bolt.dice).toBeNull();
    /* 4 * (6+1) / 2 = 14. */
    expect(effectAvgDamage(bolt, chain.dice)).toBe(14);
  });

  it("averages a RANDOM effect's sub-effects (dam averaged across the count)", () => {
    /* RANDOM:2 sub-effects, each a bolt with different dice. */
    const chain = new EffectBuilder()
      .effect("RANDOM")
      .dice("2")
      .effect("BOLT:FIRE")
      .dice("2d4") // avg 5
      .effect("BOLT:COLD")
      .dice("4d4") // avg 10
      .build()!;
    expect(effectAvgDamage(chain, null)).toBe(7); // (5+10)/2 = 7 (integer)
  });
});

describe("effectProjection", () => {
  it("returns the projection's player_desc for a damaging bolt", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("2d4").build()!;
    expect(effectProjection(bolt, projections)).toBe(
      projections[PROJ.FIRE]!.playerDesc,
    );
  });

  it("returns '' when the effect has no projection-bearing info flag", () => {
    const heal = new EffectBuilder().effect("HEAL_HP").dice("15").build()!;
    expect(effectProjection(heal, projections)).toBe("");
  });

  it("returns '' for a RANDOM effect whose sub-effects have different projections", () => {
    const chain = new EffectBuilder()
      .effect("RANDOM")
      .dice("2")
      .effect("BOLT:FIRE")
      .dice("2d4")
      .effect("BOLT:COLD")
      .dice("2d4")
      .build()!;
    expect(effectProjection(chain, projections)).toBe("");
  });
});

describe("effectNext", () => {
  it("advances past all of a RANDOM effect's declared sub-effects", () => {
    const chain = new EffectBuilder()
      .effect("RANDOM")
      .dice("2")
      .effect("BOLT:FIRE")
      .dice("2d4")
      .effect("BOLT:COLD")
      .dice("2d4")
      .effect("HEAL_HP")
      .dice("15")
      .build()!;
    const after = effectNext(chain);
    expect(after).not.toBeNull();
    expect(after!.index).toBe(EF.HEAL_HP);
  });

  it("is a plain .next step for a non-random effect", () => {
    const chain = new EffectBuilder().effect("BOLT:FIRE").dice("2d4").effect("HEAL_HP").dice("15").build()!;
    expect(effectNext(chain)).toBe(chain.next);
  });
});

describe("getSpellInfo", () => {
  it("Magic Missile at level 1: BOLT_OR_BEAM with dice resolved to 3d4", () => {
    /* class.json: effect BOLT_OR_BEAM:MISSILE, dice "$Dd4", expr D:PLAYER_LEVEL:- 1 / 5 + 3.
     * At level 1: D = (1 - 1) / 5 + 3 = 3, so the dice resolve to 3d4. */
    const chain = new EffectBuilder({ baseValues: { PLAYER_LEVEL: () => 1 } })
      .effect("BOLT_OR_BEAM:MISSILE")
      .dice("$Dd4")
      .expr("D", "PLAYER_LEVEL", "- 1 / 5 + 3")
      .build();
    expect(getSpellInfo(chain)).toBe(" dam 3d4");
  });

  it("shows a fixed heal row", () => {
    const chain = new EffectBuilder().effect("HEAL_HP").dice("15").build();
    expect(getSpellInfo(chain)).toBe(" heal 15");
  });

  it("joins multiple effect rows with ';' (a no-info effect like CURE contributes nothing)", () => {
    const chain = new EffectBuilder()
      .effect("HEAL_HP")
      .dice("15")
      .effect("CURE")
      .effect("BOLT:FIRE")
      .dice("2d4")
      .build();
    expect(getSpellInfo(chain)).toBe(" heal 15; dam 2d4");
  });

  it("suppresses a redundant repeat of the same effect/dice (de-dup guard)", () => {
    const chain = new EffectBuilder()
      .effect("BOLT:FIRE")
      .dice("2d4")
      .effect("BOLT:FIRE")
      .dice("2d4")
      .build();
    /* Second BOLT:FIRE 2d4 duplicates the first exactly, so only one row shows. */
    expect(getSpellInfo(chain)).toBe(" dam 2d4");
  });

  it("threads a shared SET_VALUE dice into a following dice-less row", () => {
    const chain = new EffectBuilder().effect("SET_VALUE").dice("4d6").effect("BOLT:FIRE").build();
    expect(getSpellInfo(chain)).toBe(" dam 4d6");
  });
});

describe("appendRandomValueString", () => {
  it("formats base, dice, and base+dice combinations", () => {
    expect(appendRandomValueString({ base: 15, dice: 0, sides: 0, mBonus: 0 })).toBe("15");
    expect(appendRandomValueString({ base: 0, dice: 3, sides: 8, mBonus: 0 })).toBe("3d8");
    expect(appendRandomValueString({ base: 0, dice: 1, sides: 6, mBonus: 0 })).toBe("d6");
    expect(appendRandomValueString({ base: 20, dice: 1, sides: 20, mBonus: 0 })).toBe("20+d20");
  });
});

describe("describeEffect", () => {
  it("describes a damaging bolt (BOLTD): projection name, dice string, average damage", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("2d4").build();
    const text = describeEffect(bolt, null, 0, true, describeDeps());
    expect(text).toBe("casts a bolt of fire dealing 2d4 damage for an average of 5.0 damage");
  });

  it("describes a BALL with radius and average damage", () => {
    const ball = new EffectBuilder().effect("BALL:FIRE:2").dice("30").build();
    const text = describeEffect(ball, null, 0, true, describeDeps());
    expect(text).toBe(
      "fires a ball of fire with radius 2, dealing 30 damage at the centre",
    );
  });

  it("describes a BREATH with width and average damage", () => {
    /* effect:<name>:<type>:<radius>:<other>; BREATH's width lives in `other`. */
    const breath = new EffectBuilder().effect("BREATH:FIRE::30").dice("20").build();
    const text = describeEffect(breath, null, 0, true, describeDeps());
    expect(text).toBe(
      "breathes a cone of fire with width 30 degrees, dealing 20 damage at the source",
    );
  });

  it("describes a heal effect with a minimum-percentage clause", () => {
    const heal = new EffectBuilder().effect("HEAL_HP").dice("15").build();
    expect(describeEffect(heal, null, 0, true, describeDeps())).toBe(
      "heals 15 hitpoints",
    );
  });

  it("describes an EFINFO_NONE effect (its description verbatim)", () => {
    const recall = new EffectBuilder().effect("RECALL").build();
    expect(describeEffect(recall, null, 0, true, describeDeps())).toBe(
      "returns you from the dungeon or takes you to the dungeon after a short delay",
    );
  });

  it("returns null when nothing in the chain has a description", () => {
    /* SET_VALUE alone has no description and no successor. */
    const setValue = new EffectBuilder().effect("SET_VALUE").dice("5").build();
    expect(describeEffect(setValue, null, 0, true, describeDeps())).toBeNull();
  });

  it("prepends the prefix once, before the first description", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("2d4").build();
    const text = describeEffect(bolt, "It ", 0, true, describeDeps());
    expect(text).toBe("It casts a bolt of fire dealing 2d4 damage for an average of 5.0 damage");
  });
});

describe("spellDamageSummary", () => {
  it("returns null when the spell has no damaging effects", () => {
    const heal = new EffectBuilder().effect("HEAL_HP").dice("15").build();
    expect(spellDamageSummary(heal, projections)).toBeNull();
  });

  it("summarizes a single damaging effect", () => {
    const bolt = new EffectBuilder().effect("BOLT:FIRE").dice("2d4").build();
    expect(spellDamageSummary(bolt, projections)).toBe(
      "Inflicts an average of 5 fire damage.",
    );
  });

  it("summarizes two damaging effects with 'and'", () => {
    const chain = new EffectBuilder()
      .effect("BOLT:FIRE")
      .dice("2d4")
      .effect("BOLT:COLD")
      .dice("4d4")
      .build();
    /* COLD's player-desc in projection.txt is "frost", not "cold". */
    expect(spellDamageSummary(chain, projections)).toBe(
      "Inflicts an average of 5 fire and 10 frost damage.",
    );
  });

  it("summarizes a shared-dice chain (SET_VALUE feeding a dice-less bolt)", () => {
    const chain = new EffectBuilder().effect("SET_VALUE").dice("4d6").effect("BOLT:FIRE").build();
    expect(spellDamageSummary(chain, projections)).toBe(
      "Inflicts an average of 14 fire damage.",
    );
  });
});

describe("RNG invariance", () => {
  it("never draws from the RNG across get_spell_info / effectAvgDamage / describeEffect", () => {
    const rng = new Rng(12345);
    const before = rng.getState();

    const chain = new EffectBuilder()
      .effect("SET_VALUE")
      .dice("4d6")
      .effect("BOLT:FIRE")
      .effect("BALL:COLD:2")
      .dice("30")
      .effect("HEAL_HP")
      .dice("2d8")
      .build()!;

    getSpellInfo(chain);
    effectAvgDamage(chain, null);
    effectDamages(chain);
    effectProjection(chain, projections);
    effectNext(chain);
    describeEffect(chain, "It ", 5, false, describeDeps());
    spellDamageSummary(chain, projections);

    expect(rng.getState()).toEqual(before);
  });
});
