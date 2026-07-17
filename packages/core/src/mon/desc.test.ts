/**
 * monster_desc / get_mon_name / plural_aux (mon/desc.ts), locking in the
 * reference/src/mon-desc.c grammar: articles, possessives, gendered pronouns,
 * reflexives, hidden-monster indefinites, "(offscreen)" and capitalisation.
 */

import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { RF } from "../generated";
import { loc } from "../loc";
import { MFLAG } from "../generated";
import {
  MDESC,
  MDESC_DIED_FROM,
  MDESC_STANDARD,
  MDESC_TARG,
  getMonName,
  monsterDesc,
  pluralAux,
} from "./desc";
import { blankMonster } from "./monster";
import type { Monster } from "./monster";
import { RF_SIZE } from "./types";
import type { MonsterRace } from "./types";

/** A minimal race carrying just what monster_desc reads. */
function race(
  name: string,
  opts: { flags?: number[]; plural?: string | null } = {},
): MonsterRace {
  const flags = new FlagSet(RF_SIZE);
  for (const f of opts.flags ?? []) flags.on(f);
  return { name, plural: opts.plural ?? null, flags } as MonsterRace;
}

/** A monster of `race`, visible unless told otherwise, at (5, 5). */
function mon(r: MonsterRace, visible = true): Monster {
  const m = blankMonster(r);
  m.grid = loc(5, 5);
  if (visible) m.mflag.on(MFLAG.VISIBLE);
  return m;
}

describe("pluralAux (mon-desc.c L27)", () => {
  it("appends s normally and es after a trailing s", () => {
    expect(pluralAux("kobold")).toBe("kobolds");
    expect(pluralAux("brass")).toBe("brasses");
  });
});

describe("getMonName (mon-desc.c L44)", () => {
  it("uniques get [U] name with no count", () => {
    expect(getMonName(race("Grip, Farmer Maggot's Dog", { flags: [RF.UNIQUE] }), 3)).toBe(
      "[U] Grip, Farmer Maggot's Dog",
    );
  });

  it("count 1 uses the singular name in a 3-wide field", () => {
    expect(getMonName(race("kobold"), 1)).toBe("  1 kobold");
  });

  it("count > 1 prefers the explicit plural", () => {
    expect(getMonName(race("wolf", { plural: "wolves" }), 12)).toBe(" 12 wolves");
  });

  it("count > 1 without a plural runs plural_aux", () => {
    expect(getMonName(race("kobold"), 104)).toBe("104 kobolds");
  });
});

describe("monsterDesc (mon-desc.c L108)", () => {
  it("hidden monsters default to 'it' / 'something' with IND_HID", () => {
    const m = mon(race("kobold"), false);
    expect(monsterDesc(m, MDESC.DEFAULT)).toBe("it");
    expect(monsterDesc(m, MDESC.IND_HID)).toBe("something");
    expect(monsterDesc(m, MDESC.IND_HID | MDESC.CAPITAL)).toBe("Something");
  });

  it("hidden pronouns are gendered only with PRO_HID", () => {
    const male = mon(race("apprentice", { flags: [RF.MALE] }), false);
    expect(monsterDesc(male, MDESC.PRO_HID)).toBe("he");
    expect(monsterDesc(male, MDESC.PRO_HID | MDESC.OBJE)).toBe("him");
    expect(monsterDesc(male, MDESC.PRO_HID | MDESC.POSS)).toBe("his");
    /* Without PRO_HID the gender is not extracted: neuter row. */
    expect(monsterDesc(male, MDESC.POSS)).toBe("its");
  });

  it("hidden indefinite pronouns become 'someone' for sexed monsters", () => {
    const female = mon(race("witch", { flags: [RF.FEMALE] }), false);
    expect(monsterDesc(female, MDESC.PRO_HID | MDESC.IND_HID)).toBe("someone");
    expect(monsterDesc(female, MDESC.PRO_HID)).toBe("she");
    expect(monsterDesc(female, MDESC.PRO_HID | MDESC.POSS | MDESC.OBJE)).toBe(
      "herself",
    );
  });

  it("visible monsters get definite/indefinite articles, vowel-aware", () => {
    expect(monsterDesc(mon(race("kobold")), MDESC.DEFAULT)).toBe("the kobold");
    expect(monsterDesc(mon(race("kobold")), MDESC.IND_VIS)).toBe("a kobold");
    expect(monsterDesc(mon(race("orc")), MDESC.IND_VIS)).toBe("an orc");
  });

  it("visible uniques use their bare name", () => {
    const m = mon(race("Fang, Farmer Maggot's Dog", { flags: [RF.UNIQUE] }));
    expect(monsterDesc(m, MDESC.DEFAULT)).toBe("Fang, Farmer Maggot's Dog");
  });

  it("possessive appends 's, stripping a NAME_COMMA phrase first", () => {
    expect(monsterDesc(mon(race("kobold")), MDESC.POSS)).toBe("the kobold's");
    const worm = mon(
      race("Wormtongue, Agent of Saruman", { flags: [RF.UNIQUE, RF.NAME_COMMA] }),
    );
    expect(monsterDesc(worm, MDESC.POSS)).toBe("Wormtongue's");
  });

  it("visible POSS|OBJE is the gendered reflexive", () => {
    expect(
      monsterDesc(mon(race("witch", { flags: [RF.FEMALE] })), MDESC.POSS | MDESC.OBJE),
    ).toBe("herself");
    expect(monsterDesc(mon(race("kobold")), MDESC.POSS | MDESC.OBJE)).toBe("itself");
  });

  it("PRO_VIS pronominalizes a visible monster", () => {
    const male = mon(race("apprentice", { flags: [RF.MALE] }));
    expect(monsterDesc(male, MDESC.PRO_VIS)).toBe("he");
    expect(monsterDesc(male, MDESC.PRO_VIS | MDESC.POSS)).toBe("his");
  });

  it("MDESC_COMMA adds a comma for NAME_COMMA races", () => {
    const worm = mon(
      race("Wormtongue, Agent of Saruman", { flags: [RF.UNIQUE, RF.NAME_COMMA] }),
    );
    expect(monsterDesc(worm, MDESC.COMMA)).toBe("Wormtongue, Agent of Saruman,");
    /* No NAME_COMMA: no comma. */
    expect(monsterDesc(mon(race("kobold")), MDESC.COMMA)).toBe("the kobold");
  });

  it("MDESC_SHOW / MDESC_HIDE force visibility", () => {
    const hidden = mon(race("kobold"), false);
    expect(monsterDesc(hidden, MDESC.SHOW)).toBe("the kobold");
    const seen = mon(race("kobold"));
    expect(monsterDesc(seen, MDESC.HIDE)).toBe("it");
  });

  it("the composite modes read as upstream documents them", () => {
    /* MDESC_STANDARD on a visible kobold: "The kobold". */
    expect(monsterDesc(mon(race("kobold")), MDESC_STANDARD)).toBe("The kobold");
    /* MDESC_STANDARD on a hidden one: "Something". */
    expect(monsterDesc(mon(race("kobold"), false), MDESC_STANDARD)).toBe("Something");
    /* MDESC_TARG hidden: "something"; visible: "the kobold". */
    expect(monsterDesc(mon(race("kobold"), false), MDESC_TARG)).toBe("something");
    expect(monsterDesc(mon(race("kobold")), MDESC_TARG)).toBe("the kobold");
    /* MDESC_DIED_FROM: full indefinite even when hidden. */
    expect(monsterDesc(mon(race("kobold"), false), MDESC_DIED_FROM)).toBe("a kobold");
  });

  it("mentions offscreen monsters when the panel test fails", () => {
    const m = mon(race("kobold"));
    expect(monsterDesc(m, MDESC.DEFAULT, () => false)).toBe("the kobold (offscreen)");
    /* Pronoun paths skip the offscreen tag, as upstream. */
    expect(monsterDesc(mon(race("kobold"), false), MDESC.DEFAULT, () => false)).toBe(
      "it",
    );
  });

  it("MDESC_CAPITAL capitalises every path", () => {
    expect(monsterDesc(mon(race("kobold")), MDESC.CAPITAL)).toBe("The kobold");
    expect(monsterDesc(mon(race("kobold"), false), MDESC.CAPITAL)).toBe("It");
    expect(
      monsterDesc(mon(race("kobold")), MDESC.CAPITAL | MDESC.POSS | MDESC.OBJE),
    ).toBe("Itself");
  });
});
