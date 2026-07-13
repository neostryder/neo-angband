import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIST, STAT } from "../generated";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import {
  BIRTH_STAT_COSTS,
  MAX_BIRTH_POINTS,
  START_GOLD,
  birthGold,
  buyStat,
  generateHistory,
  generatePlayer,
  pointBuyCost,
  resetStats,
  rollStats,
  sellStat,
} from "./birth";
import { calcHitpoints, modifyStatValue, statUseToIndex } from "./calcs";

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

describe("point-buy (player-birth.c cost table)", () => {
  it("uses the exact birth_stat_costs table", () => {
    expect(BIRTH_STAT_COSTS.length).toBe(19);
    expect(BIRTH_STAT_COSTS[17]).toBe(2);
    expect(BIRTH_STAT_COSTS[18]).toBe(4);
    expect(MAX_BIRTH_POINTS).toBe(20);
  });

  it("buying a stat from 10 to 17 costs 8 points", () => {
    expect(pointBuyCost(10, 17)).toBe(8);
    const state = resetStats();
    for (let v = 10; v < 17; v++) expect(buyStat(state, STAT.STR)).toBe(true);
    expect(state.stats[STAT.STR]).toBe(17);
    expect(state.pointsSpent[STAT.STR]).toBe(8);
    expect(state.pointsLeft).toBe(MAX_BIRTH_POINTS - 8);
  });

  it("caps a stat at 18 (cost 4 for the last point) and refuses beyond", () => {
    const state = resetStats();
    /* 10->17 is 8, 17->18 is another 4 => 12 total, within the 20 pool. */
    for (let v = 10; v < 18; v++) expect(buyStat(state, STAT.STR)).toBe(true);
    expect(state.stats[STAT.STR]).toBe(18);
    expect(state.pointsSpent[STAT.STR]).toBe(12);
    expect(buyStat(state, STAT.STR)).toBe(false);
  });

  it("sells stats back, restoring the pool", () => {
    const state = resetStats();
    buyStat(state, STAT.CON);
    buyStat(state, STAT.CON);
    expect(state.stats[STAT.CON]).toBe(12);
    expect(sellStat(state, STAT.CON)).toBe(true);
    expect(state.stats[STAT.CON]).toBe(11);
    /* Cannot sell below the base of 10. */
    expect(sellStat(state, STAT.CON)).toBe(true);
    expect(sellStat(state, STAT.CON)).toBe(false);
    expect(state.pointsLeft).toBe(MAX_BIRTH_POINTS);
  });

  it("gold is start_gold + 50 per leftover point", () => {
    expect(birthGold(0)).toBe(START_GOLD);
    expect(birthGold(20)).toBe(START_GOLD + 1000);
  });
});

describe("stat roller (get_stats)", () => {
  it("is deterministic per seed and in range 8..17", () => {
    const a = rollStats(new Rng(777));
    const b = rollStats(new Rng(777));
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(17);
    }
  });
});

describe("history generation (get_history)", () => {
  it("is deterministic per seed and non-empty for Human", () => {
    const human = reg.raceByName("Human");
    expect(human).not.toBeNull();
    if (!human) return;
    const chart = reg.historyChart(human);
    const one = generateHistory(chart, new Rng(2024));
    const two = generateHistory(chart, new Rng(2024));
    expect(one).toBe(two);
    expect(one.length).toBeGreaterThan(0);
  });
});

describe("full birth pipeline (Half-Troll Warrior)", () => {
  const race = reg.raceByName("Half-Troll");
  const cls = reg.classByName("Warrior");
  const body = reg.bodies[0];

  function birth(seed: number) {
    if (!race || !cls || !body) throw new Error("missing fixtures");
    return generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      new Rng(seed),
    );
  }

  it("sets hitdie 21 and level-1 hitpoints from calc_hitpoints", () => {
    const { player } = birth(4242);
    expect(player.hitdie).toBe(21);
    expect(player.playerHp[0]).toBe(21);
    expect(player.lev).toBe(1);

    /* Recompute the CON index independently and verify mhp wiring. */
    const conAdd = 3 + 2; /* Half-Troll +3, Warrior +2 */
    const conInd = statUseToIndex(
      modifyStatValue(player.statCur[STAT.CON] ?? 0, conAdd),
    );
    expect(player.mhp).toBe(calcHitpoints(21, 1, conInd));
    expect(player.chp).toBe(player.mhp);
    expect(player.mhp).toBeGreaterThanOrEqual(2);
  });

  it("is fully deterministic per seed", () => {
    const a = birth(9001);
    const b = birth(9001);
    expect(a.player.statMax).toEqual(b.player.statMax);
    expect(a.player.mhp).toBe(b.player.mhp);
    expect(a.player.age).toBe(b.player.age);
    expect(a.player.ht).toBe(b.player.ht);
    expect(a.history).toBe(b.history);
  });

  it("fills stats, gold, food and starting kit", () => {
    const { player, startingKit } = birth(1234);
    expect(player.au).toBe(START_GOLD);
    for (let i = 0; i < 5; i++) {
      expect(player.statCur[i]).toBe(player.statBirth[i]);
      expect(player.statMap[i]).toBe(i);
    }
    /* Well fed: FOOD ceiling minus one. */
    expect(player.timed[10]).toBe(9000 - 1);
    /* Warrior kit has six entries; objects are deferred (kind-name refs). */
    expect(startingKit.length).toBe(6);
    expect(player.equipment.length).toBe(body?.count);
  });

  it("computes non-equipment skills (melee scales with level increment)", () => {
    const { player } = birth(555);
    /* SKILL_TO_HIT_MELEE base: Half-Troll +20, Warrior +70 = 90; plus the
       per-level increment x_skills 45 * lev(1) / 10 = 4 => 94. */
    expect(player.skills[6]).toBe(94);
  });

  it("logs exactly one HIST_PLAYER_BIRTH entry (do_cmd_accept_character)", () => {
    const { player } = birth(77);
    expect(player.hist).toHaveLength(1);
    const e = player.hist[0]!;
    expect(e.type).toBe(1 << HIST.PLAYER_BIRTH);
    expect(e.event).toBe("Began the quest to destroy Morgoth.");
    expect(e.dlev).toBe(0);
    expect(e.clev).toBe(1);
    expect(e.turn).toBe(0);
    expect(e.aIdx).toBe(0);
  });
});
