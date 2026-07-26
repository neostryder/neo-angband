import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF, RSF } from "../generated";
import { Rng } from "../rng";
import { bindMonsters } from "./bind";
import type {
  MonsterBaseRecordJson,
  MonsterPackRecords,
  MonsterRecordJson,
} from "./bind";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

function loadPack(): MonsterPackRecords {
  return {
    pain: packJson("pain"),
    blowMethods: packJson("blow_methods"),
    blowEffects: packJson("blow_effects"),
    monsterSpells: packJson("monster_spell"),
    monsterBases: packJson("monster_base"),
    monsters: packJson("monster"),
    summons: packJson("summon"),
    pits: packJson("pit"),
  };
}

const reg = bindMonsters(loadPack());

describe("MonsterRegistry counts", () => {
  it("binds every pack record", () => {
    expect(reg.races.length).toBe(624);
    expect(reg.bases.size).toBe(56);
    expect(reg.spells.size).toBe(91);
    expect(reg.blowMethods.size).toBe(19);
    expect(reg.blowEffects.size).toBe(30);
    expect(reg.pains.size).toBe(12);
    expect(reg.summons.length).toBe(17);
    expect(reg.pits.length).toBe(40);
  });

  it("keeps monster.txt record order as ridx", () => {
    expect(reg.races[0]?.name).toBe("<player>");
    expect(reg.races[623]?.name).toBe("Morgoth, Lord of Darkness");
    for (let i = 0; i < reg.races.length; i++) {
      expect(reg.races[i]?.ridx).toBe(i);
    }
  });
});

describe("Morgoth spot check", () => {
  const morgoth = reg.raceByName("Morgoth, Lord of Darkness");

  it("binds the record exactly as monster.txt declares it", () => {
    expect(morgoth).not.toBeNull();
    if (!morgoth) return;
    expect(morgoth.flags.has(RF.UNIQUE)).toBe(true);
    expect(morgoth.flags.has(RF.QUESTOR)).toBe(true);
    expect(morgoth.flags.has(RF.FORCE_DEPTH)).toBe(true);
    expect(morgoth.level).toBe(100);
    expect(morgoth.avgHp).toBe(20000);
    expect(morgoth.speed).toBe(140);
    expect(morgoth.mexp).toBe(60000);
    expect(morgoth.rarity).toBe(1);
    expect(morgoth.ac).toBe(180);
    expect(morgoth.maxNum).toBe(1);
  });

  it("binds spell flags and frequency (spell-freq 3 -> 33)", () => {
    if (!morgoth) return;
    expect(morgoth.freqSpell).toBe(33);
    expect(morgoth.freqInnate).toBe(0);
    /* Default spell power is the level; Morgoth has no spell-power. */
    expect(morgoth.spellPower).toBe(100);
    for (const name of [
      "BRAIN_SMASH",
      "BA_MANA",
      "BA_NETH",
      "BO_MANA",
      "S_HI_DEMON",
      "S_UNIQUE",
    ] as const) {
      expect(morgoth.spellFlags.has(RSF[name])).toBe(true);
    }
    expect(morgoth.spellFlags.has(RSF.BR_FIRE)).toBe(false);
  });

  it("binds blows with method, effect, and dice", () => {
    if (!morgoth) return;
    expect(morgoth.blows.length).toBe(4);
    const first = morgoth.blows[0];
    expect(first?.method.name).toBe("HIT");
    expect(first?.effect.name).toBe("SHATTER");
    expect(first?.diceRaw).toBe("20d10");
    const last = morgoth.blows[3];
    expect(last?.method.name).toBe("TOUCH");
    expect(last?.effect.name).toBe("DRAIN_CHARGES");
    expect(last?.dice).toBeNull();
  });
});

describe("base inheritance (parse_monster_base semantics)", () => {
  it("kobold carries base kobold flags plus its own", () => {
    const kobold = reg.raceByName("kobold");
    expect(kobold).not.toBeNull();
    if (!kobold) return;
    /* Inherited from base kobold. */
    for (const name of [
      "EVIL",
      "OPEN_DOOR",
      "BASH_DOOR",
      "SPIRIT",
      "CLEAR_WEB",
      "IM_POIS",
    ] as const) {
      expect(kobold.flags.has(RF[name])).toBe(true);
    }
    /* Its own line. */
    expect(kobold.flags.has(RF.DROP_60)).toBe(true);
    /* Glyph comes from the base template. */
    expect(kobold.dChar).toBe("k");
    expect(kobold.base.name).toBe("kobold");
    expect(kobold.maxNum).toBe(100);
  });

  it("flags-off removes inherited base flags (green glutton ghost)", () => {
    const ghost = reg.raceByName("green glutton ghost");
    expect(ghost).not.toBeNull();
    if (!ghost) return;
    expect(ghost.base.flags.has(RF.IM_COLD)).toBe(true);
    expect(ghost.flags.has(RF.IM_COLD)).toBe(false);
    /* The rest of the base flags survive. */
    expect(ghost.flags.has(RF.PASS_WALL)).toBe(true);
    expect(ghost.flags.has(RF.UNDEAD)).toBe(true);
  });

  it("hearing scales by max_sight / 20 (identity at the default)", () => {
    const kobold = reg.raceByName("kobold");
    expect(kobold?.hearing).toBe(20);
    expect(kobold?.smell).toBe(20);
  });
});

describe("blow binding", () => {
  it("Grip binds BITE / HURT / 1d4", () => {
    const grip = reg.raceByName("Grip, Farmer Maggot's Dog");
    expect(grip).not.toBeNull();
    if (!grip) return;
    expect(grip.blows.length).toBe(1);
    const blow = grip.blows[0];
    expect(blow?.method.name).toBe("BITE");
    expect(blow?.method.cut).toBe(true);
    expect(blow?.effect.name).toBe("HURT");
    expect(blow?.effect.power).toBe(40);
    expect(blow?.diceRaw).toBe("1d4");
    const rng = new Rng(12345);
    for (let i = 0; i < 50; i++) {
      const dmg = blow?.dice?.roll(rng) ?? -1;
      expect(dmg).toBeGreaterThanOrEqual(1);
      expect(dmg).toBeLessThanOrEqual(4);
    }
  });

  it("methods without an effect bind to NONE (urchin BEG)", () => {
    const urchin = reg.raceByName("filthy street urchin");
    const beg = urchin?.blows.find((b) => b.method.name === "BEG");
    expect(beg).toBeDefined();
    expect(beg?.effect.name).toBe("NONE");
    expect(beg?.dice).toBeNull();
  });
});

describe("spell binding", () => {
  it("crow of Durthang: spell-power overrides the level default", () => {
    const crow = reg.raceByName("crow of Durthang");
    expect(crow).not.toBeNull();
    if (!crow) return;
    expect(crow.level).toBe(7);
    expect(crow.spellPower).toBe(4);
    /* spell-freq 9 -> 100 / 9 = 11. */
    expect(crow.freqSpell).toBe(11);
    expect(crow.spellFlags.has(RSF.WOUND)).toBe(true);
    const seen = crow.spellMsgs.find(
      (m) => m.index === RSF.WOUND && m.msgType === "seen",
    );
    expect(seen?.message).toBe("{name} caws three times.");
  });

  it("monster_spell records carry hit, effects, and lore levels", () => {
    const shriek = reg.spells.get(RSF.SHRIEK);
    expect(shriek?.hit).toBe(100);
    expect(shriek?.effects[0]?.eff).toBe("WAKE");
    expect(shriek?.levels[0]?.power).toBe(0);
    expect(shriek?.levels[0]?.loreDesc).toBe("shriek for help");

    /* power-cutoff appends spell levels (SHOT gains one at power 25). */
    const shot = reg.spells.get(RSF.SHOT);
    expect(shot?.levels.length).toBeGreaterThanOrEqual(2);
    expect(shot?.levels[1]?.power).toBe(25);
    expect(shot?.levels[1]?.loreDesc).toBe("sling lead shots");
    /* Effect dice with a bound SPELL_POWER expression parse. */
    expect(shot?.effects[0]?.diceRaw).toBe("$Dd5");
    expect(shot?.effects[0]?.exprs[0]?.base).toBe("SPELL_POWER");
  });
});

describe("friends and shapes resolution (finish_parse_monster)", () => {
  it("resolves 'Same' to the race itself and names to races", () => {
    const urchin = reg.raceByName("filthy street urchin");
    expect(urchin).not.toBeNull();
    if (!urchin) return;
    const same = urchin.friends.find((f) => f.name === "Same");
    expect(same?.race).toBe(urchin);
    expect(same?.numberDice).toBe(3);
    expect(same?.numberSide).toBe(4);
    /* Lookup is case-insensitive: the record says "Scrawny cat". */
    const cat = urchin.friends.find((f) => f.name === "Scrawny cat");
    expect(cat?.race?.name).toBe("scrawny cat");
  });

  it("resolves friends-base to monster bases", () => {
    const soldier = reg.raceByName("soldier");
    expect(soldier?.friendsBase[0]?.base.name).toBe("person");
  });

  it("resolves shapes to races (Beorn)", () => {
    const beorn = reg.raceByName("Beorn, the Shape-Changer");
    expect(beorn?.shapes[0]?.race?.name).toBe("Beorn, the Mountain Bear");
  });
});

describe("moddability: extra records bind cleanly", () => {
  it("a mod-added base and race join the registry", () => {
    const pack = loadPack();
    const modBase: MonsterBaseRecordJson = {
      name: "clockwork",
      glyph: "g",
      pain: 2,
      flags: ["METAL | NONLIVING | EMPTY_MIND", "IM_ELEC"],
      desc: ["Clockwork automaton"],
    };
    const modRace: MonsterRecordJson = {
      name: "brass sentinel",
      base: "clockwork",
      color: "u",
      speed: 110,
      "hit-points": 40,
      hearing: 20,
      "armor-class": 50,
      sleepiness: 10,
      depth: 12,
      rarity: 2,
      experience: 40,
      blow: [{ method: "HIT", effect: "HURT", damage: "2d6" }],
      flags: ["BASH_DOOR"],
      spells: ["BO_ELEC"],
      desc: ["A ticking guardian of brass and cog."],
    };
    const modded = bindMonsters({
      ...pack,
      monsterBases: [...pack.monsterBases, modBase],
      monsters: [...pack.monsters, modRace],
    });

    expect(modded.races.length).toBe(625);
    expect(modded.bases.size).toBe(57);
    const race = modded.raceByName("brass sentinel");
    expect(race).not.toBeNull();
    if (!race) return;
    expect(race.ridx).toBe(624);
    /* Base inheritance applies to modded records identically. */
    expect(race.flags.has(RF.METAL)).toBe(true);
    expect(race.flags.has(RF.IM_ELEC)).toBe(true);
    expect(race.flags.has(RF.BASH_DOOR)).toBe(true);
    expect(race.dChar).toBe("g");
    expect(race.base.pain.painIdx).toBe(2);
    /* The parse_monster_spells frequency default kicks in (no
     * spell-freq given, BO_ELEC is neither breath nor innate). */
    expect(race.freqSpell).toBe(4);
    expect(race.freqInnate).toBe(0);
    expect(race.spellPower).toBe(12);
  });
});
