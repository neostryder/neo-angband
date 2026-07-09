import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MON_TMD, RSF } from "../generated";
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
} from "./spell";

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
