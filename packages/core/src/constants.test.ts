import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "./constants";
import type { ConstantsJson } from "./constants";

const json = JSON.parse(
  readFileSync(
    new URL("../../content/pack/constants.json", import.meta.url),
    "utf8",
  ),
) as ConstantsJson;

describe("bindConstants", () => {
  const z = bindConstants(json);

  it("binds the classic world shape values", () => {
    expect(z.maxDepth).toBe(128);
    expect(z.dungeonHgt).toBe(66);
    expect(z.dungeonWid).toBe(198);
    expect(z.townHgt).toBe(22);
    expect(z.townWid).toBe(66);
    expect(z.dayLength).toBe(10000);
    expect(z.moveEnergy).toBe(100);
  });

  it("binds monster generation and play constants", () => {
    expect(z.levelMonsterMax).toBe(1024);
    expect(z.allocMonsterChance).toBe(500);
    expect(z.monsterGroupMax).toBe(25);
    expect(z.glyphHardness).toBe(550);
    expect(z.lifeDrainPercent).toBe(2);
  });

  it("binds carry capacity, store, object and player constants", () => {
    expect(z.packSize).toBeGreaterThan(0);
    expect(z.quiverSize).toBeGreaterThan(0);
    expect(z.storeInvenMax).toBeGreaterThan(0);
    expect(z.fuelTorch).toBeGreaterThan(0);
    expect(z.maxSight).toBe(20);
    expect(z.maxRange).toBe(20);
    expect(z.startGold).toBeGreaterThan(0);
  });

  it("binds critical hit systems with level tables", () => {
    expect(z.meleeCritical.levels).toHaveLength(5);
    expect(z.meleeCritical.levels[0]).toEqual({
      cutoff: 400,
      mult: 2,
      add: 5,
      msg: "HIT_GOOD",
    });
    // The last ranged level uses cutoff -1 as the catch-all.
    expect(z.rangedCritical.levels[2]?.cutoff).toBe(-1);
    expect(z.oMeleeCritical.levels[0]?.msg).toBe("HIT_HI_SUPERB");
    expect(z.oRangedCritical.chanceAddDenominator).toBeGreaterThan(0);
  });

  it("rejects unknown labels like upstream PARSE_ERROR_UNDEFINED_DIRECTIVE", () => {
    const bad = structuredClone(json);
    (bad.records[0] as Record<string, unknown>)["mon-gen"] = [
      { label: "not-a-thing", value: 1 },
    ];
    expect(() => bindConstants(bad)).toThrow(/unknown label/);
  });
});
