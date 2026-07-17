import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MON_TMD, RF, RSF } from "../generated";
import { Rng } from "../rng";
import { FlagSet } from "../bitflag";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import { blankMonster } from "./monster";
import type { MonsterRace, MonsterSpell } from "./types";
import { RSF_SIZE } from "./types";
import {
  MON_SPELL_TYPES,
  RST,
  RST_DAMAGE,
  breathDam,
  chanceOfSpellHit,
  chanceOfSpellHitBase,
  createMonSpellMask,
  ignoreSpells,
  monSpellHasDamage,
  monSpellIsBreath,
  monSpellIsInnate,
  monSpellIsValid,
  testSpells,
  updateSmartLearn,
} from "./spell";
import type { SmartLearnEnv } from "./spell";

function packJson<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const reg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

const someRace = reg.races.find((r) => r.rarity > 0) as MonsterRace;

describe("spell-type classification", () => {
  it("evaluates the generated RST_ expressions, aligned to RSF value", () => {
    expect(MON_SPELL_TYPES[RSF.NONE]).toBe(0);
    expect(MON_SPELL_TYPES[RSF.MAX]).toBe(0);
    expect(MON_SPELL_TYPES[RSF.BR_FIRE]).toBe(RST.BREATH | RST.INNATE);
    expect(MON_SPELL_TYPES[RSF.SHRIEK]).toBe(RST.ANNOY | RST.INNATE);
    expect(MON_SPELL_TYPES[RSF.BA_ACID]).toBe(RST.BALL);
  });

  it("classifies breath, damage and innate spells", () => {
    expect(monSpellIsBreath(RSF.BR_FIRE)).toBe(true);
    expect(monSpellIsBreath(RSF.SHRIEK)).toBe(false);

    expect(monSpellHasDamage(RSF.BR_FIRE)).toBe(true); // BREATH
    expect(monSpellHasDamage(RSF.BA_ACID)).toBe(true); // BALL
    expect(monSpellHasDamage(RSF.SHRIEK)).toBe(false); // ANNOY only

    expect(monSpellIsInnate(RSF.BR_FIRE)).toBe(true);
    expect(monSpellIsInnate(RSF.BA_ACID)).toBe(false);
  });

  it("recognises valid spell indices", () => {
    expect(monSpellIsValid(RSF.NONE)).toBe(false);
    expect(monSpellIsValid(RSF.SHRIEK)).toBe(true);
    expect(monSpellIsValid(RSF.MAX)).toBe(false);
  });

  it("RST_DAMAGE is the four damaging categories", () => {
    expect(RST_DAMAGE).toBe(RST.BOLT | RST.BALL | RST.BREATH | RST.DIRECT);
  });
});

describe("spell masks", () => {
  it("test_spells finds a wanted type in the flagset", () => {
    const f = new FlagSet(RSF_SIZE);
    f.on(RSF.BR_FIRE);
    f.on(RSF.SHRIEK);
    expect(testSpells(f, RST.BREATH)).toBe(true);
    expect(testSpells(f, RST.SUMMON)).toBe(false);
  });

  it("ignore_spells clears only the matching types", () => {
    const f = new FlagSet(RSF_SIZE);
    f.on(RSF.BR_FIRE);
    f.on(RSF.SHRIEK);
    ignoreSpells(f, RST.BREATH);
    expect(f.has(RSF.BR_FIRE)).toBe(false);
    expect(f.has(RSF.SHRIEK)).toBe(true);
  });

  it("create_mon_spell_mask builds a mask of a type", () => {
    const mask = createMonSpellMask(RST.BREATH);
    expect(mask.has(RSF.BR_FIRE)).toBe(true);
    expect(mask.has(RSF.SHRIEK)).toBe(false);
  });
});

describe("spell hit chance", () => {
  it("base is MAX(level, 1) * 3 + spell hit", () => {
    const spell = { hit: 25 } as unknown as MonsterSpell;
    const expected = Math.max(someRace.level, 1) * 3 + 25;
    expect(chanceOfSpellHitBase(someRace, spell)).toBe(expected);
  });

  it("confusion reduces the hit chance", () => {
    const spell = { hit: 25 } as unknown as MonsterSpell;
    const mon = blankMonster(someRace);
    const base = chanceOfSpellHit(mon, spell);
    mon.mTimed[MON_TMD.CONF] = 20;
    const confused = chanceOfSpellHit(mon, spell);
    expect(confused).toBeLessThan(base);
    expect(confused).toBeGreaterThan(0);
  });
});

describe("breath_dam", () => {
  it("is hp / divisor, capped at the damage cap", () => {
    expect(breathDam({ divisor: 3, damageCap: 1600 }, 300)).toBe(100);
    expect(breathDam({ divisor: 3, damageCap: 50 }, 300)).toBe(50); // capped
    expect(breathDam({ divisor: 3, damageCap: 1600 }, 8)).toBe(2); // integer div
  });
});

describe("updateSmartLearn (mon-util.c L788)", () => {
  const smartRace = (): MonsterRace => {
    const r = reg.races.find((rr) => rr.flags.has(RF.SMART))!;
    return r;
  };
  const stupidRace = (): MonsterRace => {
    const r = reg.races.find((rr) => rr.flags.has(RF.STUPID))!;
    return r;
  };

  function env(over: Partial<SmartLearnEnv> = {}): {
    env: SmartLearnEnv;
    learned: { flags: number[]; elems: number[] };
  } {
    const learned = { flags: [] as number[], elems: [] as number[] };
    return {
      env: {
        aiLearn: true,
        equipLearnFlag: (of) => learned.flags.push(of),
        equipLearnElement: (e) => learned.elems.push(e),
        playerOfHas: () => true,
        playerPfHas: () => true,
        playerResLevel: () => 3,
        ...over,
      },
      learned,
    };
  }

  it("the player always learns the rune, even with ai_learn off", () => {
    const mon = blankMonster(smartRace());
    const { env: e, learned } = env({ aiLearn: false });
    updateSmartLearn(new Rng(1), mon, e, 5, 0, 2);
    expect(learned.flags).toEqual([5]);
    expect(learned.elems).toEqual([2]);
    /* But the monster memory stays blank. */
    expect(mon.knownPstate.flags.has(5)).toBe(false);
    expect(mon.knownPstate.elInfo[2]).toBe(0);
  });

  it("a smart monster memorizes flag, pflag and element (barring the 1-in-100 fail)", () => {
    /* Pick a seed whose one_in_(100) does not fire (smart: no 1-in-2 draw). */
    let seed = 1;
    while (new Rng(seed).oneIn(100)) seed++;
    const mon = blankMonster(smartRace());
    const { env: e } = env();
    updateSmartLearn(new Rng(seed), mon, e, 5, 3, 2);
    expect(mon.knownPstate.flags.has(5)).toBe(true);
    expect(mon.knownPstate.pflags.has(3)).toBe(true);
    expect(mon.knownPstate.elInfo[2]).toBe(3);
  });

  it("learning the absence of a property clears the memory bit", () => {
    let seed = 1;
    while (new Rng(seed).oneIn(100)) seed++;
    const mon = blankMonster(smartRace());
    mon.knownPstate.flags.on(5);
    const { env: e } = env({ playerOfHas: () => false });
    updateSmartLearn(new Rng(seed), mon, e, 5, 0, -1);
    expect(mon.knownPstate.flags.has(5)).toBe(false);
  });

  it("a stupid monster never memorizes", () => {
    const mon = blankMonster(stupidRace());
    const { env: e } = env();
    updateSmartLearn(new Rng(1), mon, e, 5, 0, 2);
    expect(mon.knownPstate.flags.has(5)).toBe(false);
  });

  it("no flag and no valid element is a no-op (sanity check)", () => {
    const mon = blankMonster(smartRace());
    const { env: e, learned } = env();
    updateSmartLearn(new Rng(1), mon, e, 0, 3, -1);
    expect(learned.flags).toHaveLength(0);
    expect(learned.elems).toHaveLength(0);
    expect(mon.knownPstate.pflags.has(3)).toBe(false);
  });
});
