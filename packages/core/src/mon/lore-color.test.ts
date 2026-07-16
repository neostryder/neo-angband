import { describe, expect, it } from "vitest";
import { COLOUR_DARK, colorTextToAttr } from "../color";
import { OF, PROJ, RSF } from "../generated";
import { calcBonuses } from "../player/calcs";
import { SKILL } from "../player/types";
import { makeState, monReg, plReg } from "../game/harness";
import { buildLoreColorState } from "../game/lore-color";
import type { MonsterRace } from "./types";
import { blowColorFor, spellColorFor } from "./lore-describe";
import type { LoreColorState } from "./lore-describe";

/** attr of a colour name (the same normalisation the port uses). */
const attr = (name: string): number => {
  const a = colorTextToAttr(name);
  return a < 0 ? 1 /* COLOUR_WHITE */ : a;
};

/** A never-resists / never-protected known-state (every hook returns "no"). */
function noResist(): LoreColorState {
  return {
    saveSkill: 0,
    resLevel: () => 0,
    hasFlag: () => false,
    incCheck: () => true, // no protection -> every timed effect can land
    theftSafe: false,
    hasChargeItem: false,
    hasEdible: false,
    lightBurning: false,
  };
}

const anyRace = monReg.races.find((r) => r.rarity > 0) as MonsterRace;
const spells = monReg.spells;

describe("spellColorFor (mon-lore.c L59)", () => {
  it("returns COLOUR_DARK for an unbound spell index", () => {
    expect(spellColorFor(anyRace, 999, spells, noResist())).toBe(COLOUR_DARK);
  });

  it("colours a breath by the player's element resistance (BR_FIRE)", () => {
    // BR_FIRE: base Orange, resist Yellow, immune Light Green (BREATH:FIRE).
    const base = attr("Orange");
    const resist = attr("Yellow");
    const immune = attr("Light Green");

    expect(spellColorFor(anyRace, RSF.BR_FIRE, spells, noResist())).toBe(base);
    expect(
      spellColorFor(anyRace, RSF.BR_FIRE, spells, {
        ...noResist(),
        resLevel: (e) => (e === PROJ.FIRE ? 1 : 0),
      }),
    ).toBe(resist);
    expect(
      spellColorFor(anyRace, RSF.BR_FIRE, spells, {
        ...noResist(),
        resLevel: (e) => (e === PROJ.FIRE ? 3 : 0),
      }),
    ).toBe(immune);
  });

  it("colours a save spell (SCARE) by whether the fear effect can land", () => {
    // SCARE: TIMED_INC:AFRAID, save message, base Yellow, resist Light Green.
    const base = attr("Yellow");
    const resist = attr("Light Green");
    // Fear can land (incCheck true) -> full danger (base).
    expect(spellColorFor(anyRace, RSF.SCARE, spells, noResist())).toBe(base);
    // Protected from fear (incCheck false) -> resist colour.
    expect(
      spellColorFor(anyRace, RSF.SCARE, spells, { ...noResist(), incCheck: () => false }),
    ).toBe(resist);
  });

  it("colours a sound breath by resist, then PROT_STUN, then base (BR_SOUN)", () => {
    const base = attr("Orange");
    const resist = attr("Yellow");
    const immune = attr("Light Green");
    expect(spellColorFor(anyRace, RSF.BR_SOUN, spells, noResist())).toBe(base);
    expect(
      spellColorFor(anyRace, RSF.BR_SOUN, spells, {
        ...noResist(),
        hasFlag: (f) => f === OF.PROT_STUN,
      }),
    ).toBe(resist);
    expect(
      spellColorFor(anyRace, RSF.BR_SOUN, spells, {
        ...noResist(),
        resLevel: (e) => (e === PROJ.SOUND ? 1 : 0),
      }),
    ).toBe(immune);
  });
});

describe("blowColorFor (mon-lore.c L178)", () => {
  const effect = (name: string) => {
    const e = monReg.blowEffects.get(name);
    if (!e) throw new Error(`no blow effect ${name}`);
    return e;
  };

  it("uses the base colour for an effect with no resist/immune colours", () => {
    const hurt = effect("HURT"); // plain damage, no resist colour
    expect(blowColorFor(hurt, noResist())).toBe(attr(hurt.loreColorBase));
  });

  it("colours an element blow (POISON) by the element resist", () => {
    const pois = effect("POISON"); // effect-type element, resist POIS
    expect(blowColorFor(pois, noResist())).toBe(attr(pois.loreColorBase));
    expect(
      blowColorFor(pois, { ...noResist(), resLevel: (e) => (e === PROJ.POIS ? 1 : 0) }),
    ).toBe(attr(pois.loreColorResist));
  });

  it("colours an immune blow (ACID) by resist level 0/1/3", () => {
    const acid = effect("ACID");
    expect(blowColorFor(acid, noResist())).toBe(attr(acid.loreColorBase));
    expect(
      blowColorFor(acid, { ...noResist(), resLevel: (e) => (e === PROJ.ACID ? 1 : 0) }),
    ).toBe(attr(acid.loreColorResist));
    expect(
      blowColorFor(acid, { ...noResist(), resLevel: (e) => (e === PROJ.ACID ? 3 : 0) }),
    ).toBe(attr(acid.loreColorImmune));
  });

  it("colours a flag blow (LOSE_STR) by the sustain flag", () => {
    const loseStr = effect("LOSE_STR"); // effect-type flag, resist SUST_STR
    expect(blowColorFor(loseStr, noResist())).toBe(attr(loseStr.loreColorBase));
    expect(
      blowColorFor(loseStr, { ...noResist(), hasFlag: (f) => f === OF.SUST_STR }),
    ).toBe(attr(loseStr.loreColorResist));
  });

  it("colours a theft blow (EAT_GOLD) by the DEX/level safety threshold", () => {
    const theft = effect("EAT_GOLD");
    expect(blowColorFor(theft, noResist())).toBe(attr(theft.loreColorBase));
    expect(blowColorFor(theft, { ...noResist(), theftSafe: true })).toBe(
      attr(theft.loreColorResist),
    );
  });

  it("colours an eat-food blow by whether the pack holds food", () => {
    const food = effect("EAT_FOOD");
    // Carrying food -> full danger (base); no food -> resist colour.
    expect(blowColorFor(food, { ...noResist(), hasEdible: true })).toBe(
      attr(food.loreColorBase),
    );
    expect(blowColorFor(food, noResist())).toBe(attr(food.loreColorResist));
  });
});

describe("buildLoreColorState (game/lore-color.ts)", () => {
  it("mirrors the derived player_state and an empty pack/light", () => {
    const state = makeState();
    state.playerState = calcBonuses(state.actor.player, { timedEffects: plReg.timed });
    const cs = buildLoreColorState(state, plReg.timed);

    // saveSkill / resists / flags read straight off the derived state.
    expect(cs.saveSkill).toBe(state.playerState.skills[SKILL.SAVE]);
    expect(cs.resLevel(PROJ.FIRE)).toBe(state.playerState.elInfo[PROJ.FIRE]?.resLevel ?? 0);
    expect(cs.hasFlag(OF.FREE_ACT)).toBe(state.playerState.flags.has(OF.FREE_ACT));

    // Fresh character carries no food / chargeables and wields no burning light.
    expect(cs.hasEdible).toBe(false);
    expect(cs.hasChargeItem).toBe(false);
    expect(cs.lightBurning).toBe(false);

    // A bound timed effect resolves through player_inc_check without throwing.
    expect(typeof cs.incCheck("AFRAID")).toBe("boolean");
  });
});
