import { describe, expect, it } from "vitest";
import {
  adj_con_mhp,
  adj_dex_blow,
  adj_dex_ta,
  adj_int_dev,
  adj_str_blow,
  adj_str_td,
  adj_wis_sav,
  blows_table,
  calcHitpoints,
  modifyStatValue,
  player_exp,
  statUseToIndex,
  bonusChangeMessages,
} from "./calcs.js";
import type { PlayerState } from "./calcs.js";
import { STAT_RANGE } from "./types.js";

describe("adj_* tables (player-calcs.c verbatim)", () => {
  it("all tables have exactly STAT_RANGE entries", () => {
    for (const t of [
      adj_int_dev,
      adj_wis_sav,
      adj_dex_ta,
      adj_str_td,
      adj_str_blow,
      adj_dex_blow,
      adj_con_mhp,
    ]) {
      expect(t.length).toBe(STAT_RANGE);
      expect(STAT_RANGE).toBe(38);
    }
  });

  it("matches C spot values", () => {
    /* adj_con_mhp: index 0 (STR 3) = -250, 8 (11) = 0, 37 (18/220+) = 1250. */
    expect(adj_con_mhp[0]).toBe(-250);
    expect(adj_con_mhp[8]).toBe(0);
    expect(adj_con_mhp[37]).toBe(1250);
    /* adj_str_blow: 3 at index 0, 20 at 18/00 (index 15), 240 at index 37. */
    expect(adj_str_blow[0]).toBe(3);
    expect(adj_str_blow[15]).toBe(20);
    expect(adj_str_blow[37]).toBe(240);
    /* adj_dex_ta starts at -4; adj_int_dev tops out at 13; adj_str_td at 20. */
    expect(adj_dex_ta[0]).toBe(-4);
    expect(adj_int_dev[37]).toBe(13);
    expect(adj_str_td[37]).toBe(20);
    /* adj_wis_sav: index for stat 17 (=14) is 2, top is 19. */
    expect(adj_wis_sav[14]).toBe(2);
    expect(adj_wis_sav[37]).toBe(19);
    /* adj_dex_blow tops out at 11. */
    expect(adj_dex_blow[37]).toBe(11);
  });

  it("blows_table is 12x12 with correct corners", () => {
    expect(blows_table.length).toBe(12);
    for (const row of blows_table) expect(row.length).toBe(12);
    expect(blows_table[0]?.[0]).toBe(100);
    expect(blows_table[0]?.[11]).toBe(23);
    expect(blows_table[11]?.[0]).toBe(33);
    expect(blows_table[11]?.[11]).toBe(15);
  });

  it("player_exp has 50 thresholds", () => {
    expect(player_exp.length).toBe(50);
    expect(player_exp[0]).toBe(10);
    expect(player_exp[49]).toBe(5000000);
  });
});

describe("modify_stat_value (player-util.c)", () => {
  it("adds one point at a time below 18, ten above", () => {
    expect(modifyStatValue(17, 1)).toBe(18);
    expect(modifyStatValue(18, 1)).toBe(28);
    expect(modifyStatValue(10, 5)).toBe(15);
    expect(modifyStatValue(16, 3)).toBe(28);
  });

  it("subtracts symmetrically, flooring at 3", () => {
    expect(modifyStatValue(28, 1 - 2)).toBe(18);
    expect(modifyStatValue(18 + 10, -1)).toBe(18);
    expect(modifyStatValue(3, -1)).toBe(3);
    expect(modifyStatValue(20, -1)).toBe(18);
  });
});

describe("statUseToIndex (calc_bonuses)", () => {
  it("maps stat use values to adj-table indices", () => {
    expect(statUseToIndex(3)).toBe(0);
    expect(statUseToIndex(17)).toBe(14);
    expect(statUseToIndex(18)).toBe(15);
    expect(statUseToIndex(18 + 10)).toBe(16);
    /* 18/210-18/219 is index 36; 18/220+ (use >= 238) is the final index 37. */
    expect(statUseToIndex(18 + 219)).toBe(36);
    expect(statUseToIndex(18 + 220)).toBe(37);
    expect(statUseToIndex(400)).toBe(37);
  });
});

describe("calc_hitpoints", () => {
  it("adds the CON bonus per level and floors at lev+1", () => {
    /* hitdie 21, CON index for 0 bonus (index 8) -> 21 + 0 = 21 at level 1. */
    expect(calcHitpoints(21, 1, 8)).toBe(21);
    /* Positive CON bonus at higher level. */
    expect(calcHitpoints(100, 10, 37)).toBe(100 + Math.trunc((1250 * 10) / 100));
    /* Floor: a hugely negative CON at level 1 clamps to lev + 1 = 2. */
    expect(calcHitpoints(1, 1, 0)).toBe(2);
  });
});

/**
 * calc_bonuses' encumbrance notices (player-calcs.c:2412-2453). Found absent by
 * the upstream text census: calcBonuses ported the derive and not the diff at
 * the end of the same function, so all ten of these were unreachable.
 */
describe("bonusChangeMessages (player-calcs.c:2412-2453)", () => {
  /** Only the four fields the diff reads; the rest of PlayerState is inert. */
  const st = (over: Partial<PlayerState> = {}): PlayerState =>
    ({
      heavyShoot: false,
      heavyWield: false,
      blessWield: false,
      cumberArmor: false,
      ...over,
    }) as PlayerState;

  const BOTH = { hasWeapon: true, hasLauncher: true };
  const NEITHER = { hasWeapon: false, hasLauncher: false };

  it("says nothing when nothing changed", () => {
    expect(bonusChangeMessages(st(), st(), BOTH)).toEqual([]);
  });

  it("warns when a bow becomes too heavy (:2417)", () => {
    expect(
      bonusChangeMessages(st(), st({ heavyShoot: true }), BOTH),
    ).toEqual(["You have trouble wielding such a heavy bow."]);
  });

  it("swapping to a manageable bow reads differently from putting one down", () => {
    /* Both leave heavy_shoot false; the launcher slot tells them apart
     * (:2419 vs :2421). */
    expect(bonusChangeMessages(st({ heavyShoot: true }), st(), BOTH)).toEqual([
      "You have no trouble wielding your bow.",
    ]);
    expect(bonusChangeMessages(st({ heavyShoot: true }), st(), NEITHER)).toEqual(
      ["You feel relieved to put down your heavy bow."],
    );
  });

  it("does the same for a heavy weapon (:2428-2432)", () => {
    expect(bonusChangeMessages(st(), st({ heavyWield: true }), BOTH)).toEqual([
      "You have trouble wielding such a heavy weapon.",
    ]);
    expect(bonusChangeMessages(st({ heavyWield: true }), st(), BOTH)).toEqual([
      "You have no trouble wielding your weapon.",
    ]);
    expect(bonusChangeMessages(st({ heavyWield: true }), st(), NEITHER)).toEqual(
      ["You feel relieved to put down your heavy weapon."],
    );
  });

  it("attunement has no put-it-down line (:2435-2443)", () => {
    expect(bonusChangeMessages(st(), st({ blessWield: true }), BOTH)).toEqual([
      "You feel attuned to your weapon.",
    ]);
    expect(bonusChangeMessages(st({ blessWield: true }), st(), BOTH)).toEqual([
      "You feel less attuned to your weapon.",
    ]);
    /* Upstream deliberately stops at two branches here: removing the offending
     * weapon says nothing at all. */
    expect(bonusChangeMessages(st({ blessWield: true }), st(), NEITHER)).toEqual(
      [],
    );
  });

  it("reports armour weight costing and releasing mana (:2445-2452)", () => {
    expect(bonusChangeMessages(st(), st({ cumberArmor: true }), BOTH)).toEqual([
      "The weight of your armor reduces your maximum SP.",
    ]);
    expect(bonusChangeMessages(st({ cumberArmor: true }), st(), BOTH)).toEqual([
      "Your maximum SP is no longer reduced by armor weight.",
    ]);
  });

  it("emits several in upstream's order when a whole kit changes at once", () => {
    expect(
      bonusChangeMessages(
        st(),
        st({ heavyShoot: true, heavyWield: true, cumberArmor: true }),
        BOTH,
      ),
    ).toEqual([
      "You have trouble wielding such a heavy bow.",
      "You have trouble wielding such a heavy weapon.",
      "The weight of your armor reduces your maximum SP.",
    ]);
  });
});
