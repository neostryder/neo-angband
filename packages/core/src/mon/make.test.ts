import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF } from "../generated";
import { Rng } from "../rng";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import { createMonster, MonAllocTable, monHp } from "./make";
import { turnEnergy } from "./monster";
import type { MonsterRace } from "./types";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

const pack: MonsterPackRecords = {
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
};

const reg = bindMonsters(pack);

function newTable(): MonAllocTable {
  return new MonAllocTable(reg.races);
}

/** The maximum level get_mon_num can reach after its OOD boost. */
function boostedMax(depth: number): number {
  return depth + Math.min(Math.trunc(depth / 4) + 2, 10);
}

describe("MonAllocTable", () => {
  it("builds a level-sorted table of every legal race", () => {
    const table = newTable();
    /* 624 records minus <player> and the six rarity-0 shape-only races
     * (Beorn's bear form, great elementals, the Sauron shapes). */
    expect(table.entries.length).toBe(617);
    let last = -1;
    for (const entry of table.entries) {
      expect(entry.level).toBeGreaterThanOrEqual(last);
      last = entry.level;
      const race = reg.races[entry.index] as MonsterRace;
      expect(race.rarity).toBeGreaterThan(0);
      /* prob1 = (100 / rarity) * (1 + level / 10). */
      expect(entry.prob1).toBe(
        Math.trunc(100 / race.rarity) * (1 + Math.trunc(race.level / 10)),
      );
    }
  });

  it("returns races within legal depth rules at 1/10/40/98", () => {
    const table = newTable();
    const rng = new Rng(20260708);
    for (const depth of [1, 10, 40, 98]) {
      for (let i = 0; i < 300; i++) {
        const race = table.getMonNum(rng, depth, depth);
        expect(race).not.toBeNull();
        if (!race) continue;
        /* Never deeper than the OOD boost allows. */
        expect(race.level).toBeLessThanOrEqual(boostedMax(depth));
        /* No town monsters in the dungeon. */
        expect(race.level).toBeGreaterThan(0);
        /* FORCE_DEPTH races stay at or below the placement level. */
        if (race.flags.has(RF.FORCE_DEPTH)) {
          expect(race.level).toBeLessThanOrEqual(depth);
        }
      }
    }
  });

  it("picks only town monsters at depth 0", () => {
    const table = newTable();
    const rng = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const race = table.getMonNum(rng, 0, 0);
      expect(race).not.toBeNull();
      expect(race?.level).toBe(0);
    }
  });

  it("never returns a unique rejected by the prep filter", () => {
    const table = newTable();
    const rng = new Rng(4242);
    const dead = new Set(["Grip, Farmer Maggot's Dog", "Fang, Farmer Maggot's Dog"]);
    table.prep((race) => !(race.flags.has(RF.UNIQUE) && dead.has(race.name)));
    for (let i = 0; i < 500; i++) {
      const race = table.getMonNum(rng, 2, 2);
      expect(race).not.toBeNull();
      if (race) expect(dead.has(race.name)).toBe(false);
    }
    /* Clearing the restriction restores prob2. */
    table.prep(null);
    for (const entry of table.entries) {
      expect(entry.prob2).toBe(entry.prob1);
    }
  });

  it("skips uniques whose population cap is reached (cur_num rule)", () => {
    const table = newTable();
    const rng = new Rng(777);
    const grip = reg.raceByName("Grip, Farmer Maggot's Dog");
    expect(grip).not.toBeNull();
    if (!grip) return;
    expect(grip.maxNum).toBe(1);
    grip.curNum = 1;
    try {
      for (let i = 0; i < 500; i++) {
        const race = table.getMonNum(rng, 2, 2);
        expect(race?.name).not.toBe(grip.name);
      }
    } finally {
      grip.curNum = 0;
    }
  });

  it("distribution respects rarity (loose bounds, seeded)", () => {
    const table = newTable();
    const rng = new Rng(31337);
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const race = table.getMonNum(rng, 2, 2);
      if (!race) continue;
      counts.set(race.name, (counts.get(race.name) ?? 0) + 1);
    }
    /* kobold is rarity 1 at level 2; wild cat is rarity 2 at level 2.
     * Expect roughly 2x, loosely bounded. */
    const kobold = counts.get("kobold") ?? 0;
    const wildCat = counts.get("wild cat") ?? 0;
    expect(kobold).toBeGreaterThan(0);
    expect(wildCat).toBeGreaterThan(0);
    expect(kobold).toBeGreaterThan(wildCat);
  });
});

describe("monHp", () => {
  it("matches the upstream std-dev arithmetic (kobold avg 12)", () => {
    const kobold = reg.raceByName("kobold");
    expect(kobold).not.toBeNull();
    if (!kobold) return;
    /* std_dev = (((12 * 10) / 8) + 5) / 10 = 2, then +1 -> 3. */
    expect(monHp(kobold, "average")).toBe(12);
    expect(monHp(kobold, "minimise")).toBe(0);
    expect(monHp(kobold, "maximise")).toBe(24);
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      const hp = monHp(kobold, "randomise", rng);
      expect(hp).toBeGreaterThanOrEqual(0);
      expect(hp).toBeLessThanOrEqual(24);
    }
  });
});

describe("createMonster", () => {
  it("uniques get fixed hp and unvaried speed (Morgoth)", () => {
    const morgoth = reg.raceByName("Morgoth, Lord of Darkness");
    expect(morgoth).not.toBeNull();
    if (!morgoth) return;
    const rng = new Rng(1);
    const mon = createMonster(rng, morgoth);
    expect(mon.maxhp).toBe(20000);
    expect(mon.hp).toBe(20000);
    expect(mon.mspeed).toBe(140);
    expect(mon.energy).toBeGreaterThanOrEqual(0);
    expect(mon.energy).toBeLessThan(50);
    /* FORCE_SLEEP forces the NICE temp flag. */
    expect(mon.mflag.has(MFLAG.NICE)).toBe(true);
    /* sleepiness 0: no sleep timer even with sleep requested. */
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(mon.mflag.has(MFLAG.CAMOUFLAGE)).toBe(false);
  });

  it("non-uniques roll hp within the normal-distribution bounds", () => {
    const kobold = reg.raceByName("kobold");
    expect(kobold).not.toBeNull();
    if (!kobold) return;
    const rng = new Rng(2);
    const speedVar = Math.trunc(turnEnergy(kobold.speed) / 10);
    for (let i = 0; i < 100; i++) {
      const mon = createMonster(rng, kobold);
      expect(mon.maxhp).toBeGreaterThanOrEqual(1);
      expect(mon.maxhp).toBeLessThanOrEqual(monHp(kobold, "maximise"));
      expect(mon.hp).toBe(mon.maxhp);
      expect(mon.mspeed).toBeGreaterThanOrEqual(kobold.speed - speedVar);
      expect(mon.mspeed).toBeLessThanOrEqual(kobold.speed + speedVar);
      /* sleepiness 70: sleep timer in 140 + 1..700. */
      const sleep = mon.mTimed[MON_TMD.SLEEP] as number;
      expect(sleep).toBeGreaterThanOrEqual(141);
      expect(sleep).toBeLessThanOrEqual(840);
    }
    const awake = createMonster(rng, kobold, { sleep: false });
    expect(awake.mTimed[MON_TMD.SLEEP]).toBe(0);
  });

  it("UNAWARE races start camouflaged (creeping copper coins)", () => {
    const coins = reg.raceByName("creeping copper coins");
    expect(coins).not.toBeNull();
    if (!coins) return;
    expect(coins.flags.has(RF.UNAWARE)).toBe(true);
    const rng = new Rng(3);
    const mon = createMonster(rng, coins);
    expect(mon.mflag.has(MFLAG.CAMOUFLAGE)).toBe(true);
  });
});
