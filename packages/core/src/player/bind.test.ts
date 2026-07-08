import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorCharToAttr } from "../color";
import { OF, PF, STAT } from "../generated";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords, PRaceRecordJson, ClassRecordJson } from "./bind";
import { SKILL } from "./types";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

function loadPack(): PlayerPackRecords {
  return {
    races: packJson("p_race"),
    classes: packJson("class"),
    properties: packJson("player_property"),
    timed: packJson("player_timed"),
    shapes: packJson("shape"),
    bodies: packJson("body"),
    history: packJson("history"),
    realms: packJson("realm"),
  };
}

const reg = bindPlayer(loadPack());

describe("PlayerRegistry counts", () => {
  it("binds every pack record", () => {
    expect(reg.races.length).toBe(11);
    expect(reg.classes.length).toBe(9);
    expect(reg.timed.length).toBe(53);
    expect(reg.properties.length).toBe(44);
    expect(reg.shapes.length).toBe(9);
    expect(reg.bodies.length).toBe(1);
    expect(reg.realms.size).toBe(4);
  });

  it("keeps record order as ridx / cidx", () => {
    expect(reg.races[0]?.name).toBe("Human");
    expect(reg.races[10]?.name).toBe("Kobold");
    for (let i = 0; i < reg.races.length; i++) {
      expect(reg.races[i]?.ridx).toBe(i);
    }
    expect(reg.classes[0]?.name).toBe("Warrior");
    expect(reg.classes[8]?.name).toBe("Blackguard");
    for (let i = 0; i < reg.classes.length; i++) {
      expect(reg.classes[i]?.cidx).toBe(i);
    }
  });

  it("groups 165 history entries into charts", () => {
    let total = 0;
    for (const chart of reg.histories.values()) total += chart.entries.length;
    expect(total).toBe(165);
    expect(reg.histories.has(1)).toBe(true);
  });
});

describe("Half-Troll race spot check (p_race.txt)", () => {
  const ht = reg.raceByName("Half-Troll");

  it("binds stat adjustments exactly", () => {
    expect(ht).not.toBeNull();
    if (!ht) return;
    expect(ht.statAdj[STAT.STR]).toBe(4);
    expect(ht.statAdj[STAT.INT]).toBe(-4);
    expect(ht.statAdj[STAT.WIS]).toBe(-2);
    expect(ht.statAdj[STAT.DEX]).toBe(-4);
    expect(ht.statAdj[STAT.CON]).toBe(3);
  });

  it("binds skills by directive name, not position", () => {
    if (!ht) return;
    expect(ht.skills[SKILL.DISARM_PHYS]).toBe(-5);
    expect(ht.skills[SKILL.DISARM_MAGIC]).toBe(-5);
    expect(ht.skills[SKILL.DEVICE]).toBe(-8);
    expect(ht.skills[SKILL.SAVE]).toBe(-8);
    /* stealth (-2) precedes search (-9) in the data but SEARCH < STEALTH. */
    expect(ht.skills[SKILL.STEALTH]).toBe(-2);
    expect(ht.skills[SKILL.SEARCH]).toBe(-9);
    expect(ht.skills[SKILL.TO_HIT_MELEE]).toBe(20);
    expect(ht.skills[SKILL.TO_HIT_BOW]).toBe(-10);
    expect(ht.skills[SKILL.TO_HIT_THROW]).toBe(-10);
    expect(ht.skills[SKILL.DIGGING]).toBe(0);
  });

  it("binds hitdie, exp, infravision, history and racial flags", () => {
    if (!ht) return;
    expect(ht.hitdie).toBe(12);
    expect(ht.expFactor).toBe(120);
    expect(ht.infravision).toBe(3);
    expect(ht.historyChart).toBe(21);
    expect(ht.body).toBe(0);
    /* obj-flags: "SUST_STR | REGEN". */
    expect(ht.flags.has(OF.SUST_STR)).toBe(true);
    expect(ht.flags.has(OF.REGEN)).toBe(true);
    expect(ht.flags.has(OF.SEE_INVIS)).toBe(false);
  });

  it("binds RES_ value lines (Kobold RES_POIS[1])", () => {
    const kobold = reg.raceByName("Kobold");
    expect(kobold?.elInfo[STAT.INT]).toBeDefined();
    /* POIS is element 4; res_level 1. */
    const poisIdx = 4;
    expect(kobold?.elInfo[poisIdx]?.resLevel).toBe(1);
  });
});

describe("Warrior class spot check (class.txt)", () => {
  const w = reg.classByName("Warrior");

  it("binds stat modifiers and base/incr skills", () => {
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.statAdj[STAT.STR]).toBe(3);
    expect(w.statAdj[STAT.CON]).toBe(2);
    expect(w.skills[SKILL.TO_HIT_MELEE]).toBe(70);
    expect(w.extraSkills[SKILL.TO_HIT_MELEE]).toBe(45);
    /* search base 10/incr 12 despite stealth appearing first in the file. */
    expect(w.skills[SKILL.SEARCH]).toBe(10);
    expect(w.extraSkills[SKILL.SEARCH]).toBe(12);
    expect(w.skills[SKILL.STEALTH]).toBe(0);
  });

  it("binds hitdie, attacks, weight, multiplier, titles and flags", () => {
    if (!w) return;
    expect(w.hitdie).toBe(9);
    expect(w.maxAttacks).toBe(6);
    expect(w.minWeight).toBe(30);
    expect(w.attMultiply).toBe(5);
    expect(w.titles.length).toBe(10);
    expect(w.titles[0]).toBe("Rookie");
    expect(w.pflags.has(PF.NO_MANA)).toBe(true);
    expect(w.pflags.has(PF.SHIELD_BASH)).toBe(true);
    /* Warrior is a non-caster: empty magic. */
    expect(w.magic.numBooks).toBe(0);
    expect(w.magic.totalSpells).toBe(0);
  });

  it("binds starting inventory as kind-name refs with birth-option codes", () => {
    if (!w) return;
    expect(w.startItems.length).toBe(6);
    const scroll = w.startItems.find((s) => s.sval === "Word of Recall");
    expect(scroll?.tval).toBe("scroll");
    expect(scroll?.eopts).toEqual(["birth_no_recall"]);
    const food = w.startItems.find((s) => s.tval === "food");
    expect(food?.eopts).toEqual([]);
  });
});

describe("Mage magic structure (deferred spell effects preserved)", () => {
  const mage = reg.classByName("Mage");

  it("binds books, realm and minimal spell data", () => {
    expect(mage).not.toBeNull();
    if (!mage) return;
    expect(mage.magic.spellFirst).toBe(1);
    expect(mage.magic.spellWeight).toBe(300);
    expect(mage.magic.numBooks).toBe(5);
    expect(mage.magic.books.length).toBe(5);
    expect(mage.magic.totalSpells).toBeGreaterThan(0);

    const first = mage.magic.books[0];
    expect(first?.realm.name).toBe("arcane");
    expect(first?.realm.stat).toBe(STAT.INT);
    const spell = first?.spells[0];
    expect(spell?.name).toBe("Magic Missile");
    expect(spell?.level).toBe(1);
    expect(spell?.mana).toBe(1);
    expect(spell?.fail).toBe(22);
    expect(spell?.sidx).toBe(0);
    expect(spell?.bidx).toBe(0);
    /* Effect chain preserved raw, not compiled. */
    expect(spell?.effectsRaw.length).toBe(1);
  });
});

describe("timed effects (player-timed.c grade binding)", () => {
  it("prepends the implicit off grade", () => {
    const fast = reg.timed.find((t) => t.name === "FAST");
    expect(fast?.grades.length).toBe(2);
    expect(fast?.grades[0]?.grade).toBe(0);
    expect(fast?.grades[0]?.max).toBe(0);
    expect(fast?.grades[0]?.name).toBeNull();
    expect(fast?.grades[1]?.name).toBe("Haste");
    expect(fast?.grades[1]?.color).toBe(colorCharToAttr("G"));
    expect(fast?.grades[1]?.max).toBe(10000);
  });

  it("binds all seven CUT grades plus the off grade", () => {
    const cut = reg.timed.find((t) => t.name === "CUT");
    expect(cut?.grades.length).toBe(8);
    expect(cut?.grades[7]?.name).toBe("Mortal Wound");
    expect(cut?.fail[0]?.flag).toBe("ROCK");
  });

  it("scales FOOD grade maxima by food_value", () => {
    const food = reg.timed.find((t) => t.name === "FOOD");
    const fed = food?.grades.find((g) => g.name === "Fed");
    expect(fed?.max).toBe(9000);
  });
});

describe("bodies and realms", () => {
  it("binds the Humanoid body with 12 slots", () => {
    const body = reg.bodies[0];
    expect(body?.name).toBe("Humanoid");
    expect(body?.count).toBe(12);
    expect(body?.slots[0]?.type).toBe("WEAPON");
    expect(body?.slots[0]?.name).toBe("weapon");
  });

  it("resolves a race's starting history chart", () => {
    const human = reg.raceByName("Human");
    expect(human).not.toBeNull();
    if (!human) return;
    const chart = reg.historyChart(human);
    expect(chart?.idx).toBe(1);
    expect(chart?.entries.length).toBeGreaterThan(0);
  });
});

describe("moddability: extra records bind cleanly", () => {
  it("a mod-added race and class join the registry", () => {
    const pack = loadPack();
    const modRace: PRaceRecordJson = {
      name: "Automaton",
      stats: { str: 5, int: -5, wis: -5, dex: 0, con: 5 },
      "skill-disarm-phys": 0,
      "skill-disarm-magic": 0,
      "skill-device": 0,
      "skill-save": 10,
      "skill-stealth": -3,
      "skill-search": 0,
      "skill-melee": 25,
      "skill-shoot": -10,
      "skill-throw": -10,
      "skill-dig": 0,
      hitdie: 14,
      exp: 200,
      infravision: 0,
      history: 1,
      age: { base_age: 1, mod_age: 1 },
      height: { base_hgt: 80, mod_hgt: 4 },
      weight: { base_wgt: 300, mod_wgt: 20 },
      "obj-flags": ["FREE_ACT | REGEN"],
      "player-flags": ["NO_MANA"],
      values: ["RES_POIS[1]"],
    };
    const modClass: ClassRecordJson = {
      name: "Tinker",
      stats: { str: 1, int: 3, wis: 0, dex: 2, con: 1 },
      "skill-disarm-phys": { base: 30, incr: 12 },
      "skill-disarm-magic": { base: 30, incr: 12 },
      "skill-device": { base: 30, incr: 13 },
      "skill-save": { base: 20, incr: 10 },
      "skill-stealth": { base: 1, incr: 0 },
      "skill-search": { base: 12, incr: 8 },
      "skill-melee": { base: 40, incr: 30 },
      "skill-shoot": { base: 40, incr: 30 },
      "skill-throw": { base: 40, incr: 30 },
      "skill-dig": { base: 0, incr: 0 },
      hitdie: 4,
      "max-attacks": 4,
      "min-weight": 30,
      "strength-multiplier": 3,
      title: ["Apprentice"],
      "player-flags": ["CHOOSE_SPELLS"],
    };
    const modded = bindPlayer({
      ...pack,
      races: [...pack.races, modRace],
      classes: [...pack.classes, modClass],
    });

    expect(modded.races.length).toBe(12);
    expect(modded.classes.length).toBe(10);

    const race = modded.raceByName("Automaton");
    expect(race?.ridx).toBe(11);
    expect(race?.statAdj[STAT.STR]).toBe(5);
    expect(race?.flags.has(OF.FREE_ACT)).toBe(true);
    expect(race?.flags.has(OF.REGEN)).toBe(true);
    expect(race?.pflags.has(PF.NO_MANA)).toBe(true);
    expect(race?.elInfo[4]?.resLevel).toBe(1);

    const cls = modded.classByName("Tinker");
    expect(cls?.cidx).toBe(9);
    expect(cls?.skills[SKILL.DEVICE]).toBe(30);
    expect(cls?.extraSkills[SKILL.DEVICE]).toBe(13);
    expect(cls?.pflags.has(PF.CHOOSE_SPELLS)).toBe(true);
  });
});
