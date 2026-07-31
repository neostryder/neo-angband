/**
 * Upstream unit tests from reference/src/tests/monster/desc.c
 *
 * Mapping:
 * - plural_aux / get_mon_name / monster_desc
 *   -> pluralAux / getMonName / monsterDesc (mon/desc.ts)
 * - panel_contains_hook -> panelContains optional arg on monsterDesc
 * - Buffer-size truncation: port returns a full JS string (no fixed buffer).
 *   Truncation assertions from C (sz-limited strnfmt) are re-expressed as
 *   prefix checks on the full string where the port has no fixed buffer, and
 *   full-string equality where sz == MY_SZ (full result).
 */

import { describe, expect, it } from "vitest";

import { FlagSet } from "../bitflag.js";
import { RF, MFLAG } from "../generated/index.js";
import { loc } from "../loc.js";
import {
  MDESC,
  MDESC_DIED_FROM,
  MDESC_STANDARD,
  MDESC_TARG,
  getMonName,
  monsterDesc,
  pluralAux,
} from "./desc.js";
import { blankMonster } from "./monster.js";
import type { Monster } from "./monster.js";
import { RF_SIZE } from "./types.js";
import type { MonsterRace } from "./types.js";

interface MonSpec {
  name: string;
  unique: boolean;
  male: boolean;
  female: boolean;
  comma: boolean;
}

const MONSTERS: MonSpec[] = [
  { name: "Gilgamesh", unique: true, male: true, female: false, comma: false },
  { name: "Inanna", unique: true, male: false, female: true, comma: false },
  { name: "Watcher in the Water", unique: true, male: false, female: false, comma: false },
  { name: "Wormtongue, Agent of Saruman", unique: true, male: true, female: false, comma: true },
  { name: "satyr", unique: false, male: true, female: false, comma: false },
  { name: "nymph", unique: false, male: false, female: true, comma: false },
  { name: "alligator", unique: false, male: false, female: false, comma: false },
  { name: "dog, man's best friend", unique: false, male: false, female: false, comma: true },
];

function raceOf(spec: MonSpec): MonsterRace {
  const flags = new FlagSet(RF_SIZE);
  if (spec.unique) flags.on(RF.UNIQUE);
  if (spec.male) flags.on(RF.MALE);
  if (spec.female) flags.on(RF.FEMALE);
  if (spec.comma) flags.on(RF.NAME_COMMA);
  return { name: spec.name, plural: null, flags } as MonsterRace;
}

function monOf(spec: MonSpec, visible: boolean): Monster {
  const m = blankMonster(raceOf(spec));
  m.grid = loc(5, 5);
  if (visible) m.mflag.on(MFLAG.VISIBLE);
  else m.mflag.off(MFLAG.VISIBLE);
  return m;
}

const always = () => true;
const never = () => false;

describe("monster/desc (reference/src/tests/monster/desc.c)", () => {
  // upstream: test_plural_aux_0
  it("plural_aux 0", () => {
    expect(pluralAux("crow")).toBe("crows");
    expect(pluralAux("ibis")).toBe("ibises");
  });

  // upstream: test_get_mon_name_nonunique_0
  it("get_mon_name nonunique_0", () => {
    const crow = { name: "crow", plural: null, flags: new FlagSet(RF_SIZE) } as MonsterRace;
    expect(getMonName(crow, 1)).toBe("  1 crow");
    expect(getMonName(crow, 5)).toBe("  5 crows");

    const ibis = { name: "ibis", plural: null, flags: new FlagSet(RF_SIZE) } as MonsterRace;
    expect(getMonName(ibis, 1)).toBe("  1 ibis");
    expect(getMonName(ibis, 8)).toBe("  8 ibises");

    const dog = {
      name: "dog of war",
      plural: "dogs of war",
      flags: new FlagSet(RF_SIZE),
    } as MonsterRace;
    expect(getMonName(dog, 1)).toBe("  1 dog of war");
    expect(getMonName(dog, 2)).toBe("  2 dogs of war");
  });

  // upstream: test_get_mon_name_unique_0
  it("get_mon_name unique_0", () => {
    const flags = new FlagSet(RF_SIZE);
    flags.on(RF.UNIQUE);
    const r = { name: "Gilgamesh", plural: null, flags } as MonsterRace;
    expect(getMonName(r, 1)).toBe("[U] Gilgamesh");
    expect(getMonName(r, 3)).toBe("[U] Gilgamesh");
  });

  // upstream: test_monster_desc_hidden_def_0
  it("monster_desc hidden_def_0", () => {
    for (let i = 0; i < MONSTERS.length; i++) {
      const m = monOf(MONSTERS[i]!, false);
      expect(monsterDesc(m, 0, always)).toBe("it");
      expect(monsterDesc(m, MDESC.OBJE, always)).toBe("it");
      expect(monsterDesc(m, MDESC.POSS, always)).toBe("its");
      expect(monsterDesc(m, MDESC.OBJE | MDESC.POSS, always)).toBe("itself");
      expect(monsterDesc(m, MDESC.COMMA, always)).toBe("it");

      const pro = monsterDesc(m, MDESC.PRO_HID, always);
      if (MONSTERS[i]!.male) expect(pro).toBe("he");
      else if (MONSTERS[i]!.female) expect(pro).toBe("she");
      else expect(pro).toBe("it");

      // Visible but off-panel with MDESC_HIDE still uses hidden forms.
      m.mflag.on(MFLAG.VISIBLE);
      expect(monsterDesc(m, MDESC.HIDE, never)).toBe("it");
      m.mflag.off(MFLAG.VISIBLE);
    }
  });

  // upstream: test_monster_desc_hidden_indef_0
  it("monster_desc hidden_indef_0", () => {
    for (let i = 0; i < MONSTERS.length; i++) {
      const m = monOf(MONSTERS[i]!, false);
      expect(monsterDesc(m, MDESC.IND_HID, always)).toBe("something");
      expect(monsterDesc(m, MDESC.IND_HID | MDESC.OBJE, always)).toBe("something");
      expect(monsterDesc(m, MDESC.IND_HID | MDESC.POSS, always)).toBe("something's");
      expect(monsterDesc(m, MDESC.IND_HID | MDESC.OBJE | MDESC.POSS, always)).toBe("itself");

      const pro = monsterDesc(m, MDESC.IND_HID | MDESC.PRO_HID, always);
      if (MONSTERS[i]!.male || MONSTERS[i]!.female) expect(pro).toBe("someone");
      else expect(pro).toBe("something");

      expect(monsterDesc(m, MDESC_STANDARD, always)).toMatch(/^(Someone|Something)/);
      expect(monsterDesc(m, MDESC_TARG, always)).toMatch(/^(someone|something)/);
    }
  });

  // upstream: test_monster_desc_seen_def_0
  it("monster_desc seen_def_0", () => {
    const expected0 = [
      "Gilgamesh",
      "Inanna",
      "Watcher in the Water",
      "Wormtongue, Agent of Saruman",
      "the satyr",
      "the nymph",
      "the alligator",
      "the dog, man's best friend",
    ];
    const expectedPoss = [
      "Gilgamesh's",
      "Inanna's",
      "Watcher in the Water's",
      "Wormtongue's",
      "the satyr's",
      "the nymph's",
      "the alligator's",
      "the dog's",
    ];
    const expectedComma = [
      "Gilgamesh",
      "Inanna",
      "Watcher in the Water",
      "Wormtongue, Agent of Saruman,",
      "the satyr",
      "the nymph",
      "the alligator",
      "the dog, man's best friend,",
    ];
    const expectedStd = [
      "Gilgamesh",
      "Inanna",
      "Watcher in the Water",
      "Wormtongue, Agent of Saruman,",
      "The satyr",
      "The nymph",
      "The alligator",
      "The dog, man's best friend,",
    ];

    for (let i = 0; i < MONSTERS.length; i++) {
      const m = monOf(MONSTERS[i]!, true);
      expect(monsterDesc(m, 0, always)).toBe(expected0[i]);
      expect(monsterDesc(m, MDESC.OBJE, always)).toBe(expected0[i]);
      expect(monsterDesc(m, MDESC.POSS, always)).toBe(expectedPoss[i]);
      expect(monsterDesc(m, MDESC.COMMA, always)).toBe(expectedComma[i]);
      expect(monsterDesc(m, MDESC_STANDARD, always)).toBe(expectedStd[i]);
      expect(monsterDesc(m, MDESC_TARG, always)).toBe(expected0[i]);

      const refl = monsterDesc(m, MDESC.OBJE | MDESC.POSS, always);
      if (MONSTERS[i]!.male) expect(refl).toBe("himself");
      else if (MONSTERS[i]!.female) expect(refl).toBe("herself");
      else expect(refl).toBe("itself");

      // Offscreen via MDESC_SHOW with never-panel.
      m.mflag.off(MFLAG.VISIBLE);
      expect(monsterDesc(m, MDESC.SHOW, never)).toBe(`${expected0[i]} (offscreen)`);
    }
  });

  // upstream: test_monster_desc_seen_indef_0
  it("monster_desc seen_indef_0", () => {
    const expected = [
      "Gilgamesh",
      "Inanna",
      "Watcher in the Water",
      "Wormtongue, Agent of Saruman",
      "a satyr",
      "a nymph",
      "an alligator",
      "a dog, man's best friend",
    ];
    for (let i = 0; i < MONSTERS.length; i++) {
      const m = monOf(MONSTERS[i]!, true);
      expect(monsterDesc(m, MDESC.IND_VIS, always)).toBe(expected[i]);
      expect(monsterDesc(m, MDESC_DIED_FROM, never)).toBe(
        `${expected[i]} (offscreen)`,
      );
    }
  });
});
