import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF } from "../generated";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import type { MonsterRace } from "./types";
import { SummonTable, summonSpecificOkay } from "./summon";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
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

const table = new SummonTable(reg.summons, reg.bases);

function raceWhere(pred: (race: MonsterRace) => boolean): MonsterRace {
  const race = reg.races.find((r, i) => i > 0 && pred(r));
  if (!race) throw new Error("no such race in the pack");
  return race;
}

describe("SummonTable (mon-summon.c parse + lookups)", () => {
  it("binds every summon.txt record in file order", () => {
    expect(table.kinds.length).toBe(17);
    expect(table.nameToIdx("ANY")).toBe(0);
    expect(table.nameToIdx("KIN")).toBe(1);
    expect(table.nameToIdx("UNIQUE")).toBe(16);
    expect(table.nameToIdx("NO_SUCH_SUMMON")).toBe(-1);
  });

  it("resolves fallbacks (WRAITH / UNIQUE fall back to HI_UNDEAD)", () => {
    const hiUndead = table.nameToIdx("HI_UNDEAD");
    expect(table.fallbackType(table.nameToIdx("WRAITH"))).toBe(hiUndead);
    expect(table.fallbackType(table.nameToIdx("UNIQUE"))).toBe(hiUndead);
    expect(table.fallbackType(table.nameToIdx("ANY"))).toBe(-1);
  });

  it("resolves bases and race flags", () => {
    const spider = table.kinds[table.nameToIdx("SPIDER")]!;
    expect(spider.bases.map((b) => b.name)).toContain("spider");
    const undead = table.kinds[table.nameToIdx("UNDEAD")]!;
    expect(undead.raceFlag).toBe(RF.UNDEAD);
    expect(undead.uniqueAllowed).toBe(false);
    expect(table.kinds[table.nameToIdx("ANY")]!.uniqueAllowed).toBe(true);
  });

  it("keeps the summon descriptions", () => {
    expect(table.desc(table.nameToIdx("SPIDER"))).toBe("spiders");
  });
});

describe("summonSpecificOkay (mon-summon.c L273)", () => {
  const undeadIdx = table.nameToIdx("UNDEAD");
  const spiderIdx = table.nameToIdx("SPIDER");
  const anyIdx = table.nameToIdx("ANY");
  const kinIdx = table.nameToIdx("KIN");

  const undead = raceWhere(
    (r) => r.flags.has(RF.UNDEAD) && !r.flags.has(RF.UNIQUE),
  );
  const living = raceWhere(
    (r) => !r.flags.has(RF.UNDEAD) && !r.flags.has(RF.UNIQUE) && !!r.base,
  );
  const unique = raceWhere((r) => r.flags.has(RF.UNIQUE));
  const spider = raceWhere(
    (r) => r.base?.name === "spider" && !r.flags.has(RF.UNIQUE),
  );

  it("filters by race flag", () => {
    expect(summonSpecificOkay(table, undeadIdx, undead, null)).toBe(true);
    expect(summonSpecificOkay(table, undeadIdx, living, null)).toBe(false);
  });

  it("filters by base", () => {
    expect(summonSpecificOkay(table, spiderIdx, spider, null)).toBe(true);
    expect(summonSpecificOkay(table, spiderIdx, undead, null)).toBe(false);
  });

  it("forbids uniques unless the type allows them", () => {
    expect(summonSpecificOkay(table, undeadIdx, unique, null)).toBe(false);
    expect(summonSpecificOkay(table, anyIdx, unique, null)).toBe(true);
  });

  it("KIN matches non-unique races of the kin base only", () => {
    expect(summonSpecificOkay(table, kinIdx, spider, spider.base)).toBe(true);
    expect(summonSpecificOkay(table, kinIdx, spider, undead.base)).toBe(false);
    const uniqueKin = reg.races.find(
      (r) => r.flags.has(RF.UNIQUE) && r.base === spider.base,
    );
    if (uniqueKin) {
      expect(summonSpecificOkay(table, kinIdx, uniqueKin, spider.base)).toBe(
        false,
      );
    }
  });
});
