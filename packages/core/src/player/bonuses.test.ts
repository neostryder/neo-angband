/**
 * Tests for calcBonuses / calcBlows (player-calcs.c calc_bonuses and
 * calc_blows, innate portion). Every expected value is hand-derived from the
 * upstream C tables; the derivations are spelled out in comments with the
 * exact table indices used.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, OF, PF, STAT } from "../generated";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import { generatePlayer } from "./birth";
import {
  adjustSkillScale,
  calcBlows,
  calcBonuses,
  calcSkills,
  playerFlags,
  toCombatState,
  toDefenderState,
  weightLimit,
} from "./calcs";
import type { Player } from "./player";
import { SKILL, SKILL_MAX } from "./types";

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

/** A born player of the given race/class with explicitly set natural stats. */
function bornWithStats(
  raceName: string,
  clsName: string,
  stats: readonly number[],
): Player {
  const race = reg.raceByName(raceName);
  const cls = reg.classByName(clsName);
  const body = reg.bodies[0];
  if (!race || !cls || !body) throw new Error("missing fixtures");
  const { player } = generatePlayer(
    race,
    cls,
    { body, historyChart: reg.historyChart(race) },
    new Rng(4242),
  );
  for (let i = 0; i < stats.length; i++) {
    player.statMax[i] = stats[i] ?? 0;
    player.statCur[i] = stats[i] ?? 0;
    player.statBirth[i] = stats[i] ?? 0;
  }
  return player;
}

describe("calcBonuses: rune knowledge gates equipment modifiers (decision 25)", () => {
  const STATS = [16, 12, 11, 15, 14] as const;

  it("a born character starts with every rune unknown (obj_k empty)", () => {
    const p = bornWithStats("Human", "Warrior", STATS);
    expect(p.objKnown.modifiers.every((m) => m === 0)).toBe(true);
  });

  it("keeps an unlearned +STR modifier inert, then applies it once the rune is known", () => {
    const p = bornWithStats("Human", "Warrior", STATS);
    const equipment: (GameObject | null)[] = new Array<GameObject | null>(
      p.body.count,
    ).fill(null);
    // An item bearing +3 STR, worn in the last (non-weapon) slot.
    const item = objectNew({} as ObjectKind);
    item.modifiers[STAT.STR] = 3;
    equipment[p.body.count - 1] = item;

    // Rune unknown (the faithful birth default): the modifier does nothing.
    const unknown = calcBonuses(p, { equipment });
    expect(unknown.statAdd[STAT.STR]).toBe(0);

    // Learn the STR rune: the same worn item now grants its full +3.
    p.objKnown.modifiers[STAT.STR] = 1;
    const learned = calcBonuses(p, { equipment });
    expect(learned.statAdd[STAT.STR]).toBe(3);
    expect(learned.statUse[STAT.STR]).toBeGreaterThan(
      unknown.statUse[STAT.STR] ?? 0,
    );
  });
});

/*
 * The reference character: a level-1 Human Warrior with natural stats
 * STR 16, INT 12, WIS 11, DEX 15, CON 14.
 *
 * Human r_adj is all zero; Warrior c_adj is STR +3, INT -2, WIS -2, DEX +2,
 * CON +2 (class.txt). modify_stat_value gives:
 *   STR 16 +3 -> 17 -> 18 -> 28 (18/10)   ind = 15 + (28-18)/10 = 16
 *   INT 12 -2 -> 10                       ind = 10 - 3 = 7
 *   WIS 11 -2 -> 9                        ind = 6
 *   DEX 15 +2 -> 17                       ind = 14
 *   CON 14 +2 -> 16                       ind = 13
 */
const HUMAN_WARRIOR_STATS = [16, 12, 11, 15, 14] as const;

describe("calcBonuses: level-1 Human Warrior (hand-derived)", () => {
  const player = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
  const state = calcBonuses(player);

  it("computes stat use values and indices", () => {
    expect(state.statUse).toEqual([28, 10, 9, 17, 16]);
    expect(state.statInd).toEqual([16, 7, 6, 14, 13]);
    /* statCur == statMax, so top matches use. */
    expect(state.statTop).toEqual(state.statUse);
    expect(state.statAdd).toEqual([0, 0, 0, 0, 0]);
  });

  it("computes skills from class base + stat tables + level scaling", () => {
    /* Warrior c_skills base (Human r_skills all 0), then the stat term from
       the C tables at the indices above, then x_skills * 1 / 10:
       DISARM_PHYS  25 + adj_dex_dis[14]=2  + 15/10=1 = 28
       DISARM_MAGIC 20 + adj_int_dis[7]=1   + 10/10=1 = 22
       DEVICE       18 + adj_int_dev[7]=1   +  7/10=0 = 19
       SAVE         18 + adj_wis_sav[6]=1   + 10/10=1 = 20
       SEARCH       10                      + 12/10=1 = 11
       STEALTH       0                      +  0      =  0
       MELEE        70                      + 45/10=4 = 74
       BOW          55                      + 45/10=4 = 59
       THROW        55                      + 45/10=4 = 59
       DIGGING       0 + adj_str_dig[16]=10 +  0      = 10 */
    expect(state.skills).toEqual([28, 22, 19, 20, 11, 0, 74, 59, 59, 10]);
  });

  it("computes to-hit/to-dam/to-ac from the stat tables", () => {
    /* to_h = adj_dex_th[14]=2 + adj_str_th[16]=1 = 3
       to_d = adj_str_td[16]=2
       to_a = adj_dex_ta[14]=1; base ac is 0 (unarmored). */
    expect(state.toH).toBe(3);
    expect(state.toD).toBe(2);
    expect(state.toA).toBe(1);
    expect(state.ac).toBe(0);
  });

  it("computes base speed 110 with no encumbrance", () => {
    expect(state.speed).toBe(110);
    /* weight_limit = adj_str_wgt[16]=22 * 100 = 2200. */
    expect(weightLimit(state)).toBe(2200);
  });

  it("computes unarmed blows through calc_blows", () => {
    /* str_index = adj_str_blow[16]=30 * att_multiply 5 / min_weight 30 = 5
       dex_index = adj_dex_blow[14] = 2
       blows_table[5][2] = 42 -> 10000/42 = 238, under the 600 cap. */
    expect(state.numBlows).toBe(238);
  });

  it("keeps innate misc fields at their unarmed/unarmored values", () => {
    expect(state.seeInfra).toBe(0); /* Human infravision 0 */
    expect(state.hold).toBe(30); /* adj_str_hold[16] = 30 */
    expect(state.numShots).toBe(0);
    expect(state.ammoMult).toBe(0);
    expect(state.ammoTval).toBe(0);
    expect(state.numMoves).toBe(0);
    expect(state.heavyWield).toBe(false);
    expect(state.heavyShoot).toBe(false);
    expect(state.blessWield).toBe(false);
    expect(state.cumberArmor).toBe(false);
    expect(state.curLight).toBe(0);
    expect(state.damRed).toBe(0);
    expect(state.percDamRed).toBe(0);
  });

  it("carries the Warrior player flags and NO_MANA for msp 0", () => {
    expect(state.pflags.has(PF.BRAVERY_30)).toBe(true);
    expect(state.pflags.has(PF.SHIELD_BASH)).toBe(true);
    expect(state.pflags.has(PF.NO_MANA)).toBe(true);
    /* BRAVERY_30 grants PROT_FEAR only at level 30+. */
    expect(state.flags.has(OF.PROT_FEAR)).toBe(false);
    expect(state.flags.has(OF.AFRAID)).toBe(false);
  });

  it("has all-zero element info for a Human", () => {
    for (const el of state.elInfo) expect(el.resLevel).toBe(0);
  });

  it("agrees with calcSkills for the innate case", () => {
    const race = reg.raceByName("Human");
    const cls = reg.classByName("Warrior");
    if (!race || !cls) throw new Error("missing fixtures");
    expect(calcSkills(race, cls, 1, state.statInd)).toEqual(state.skills);
  });
});

describe("calcBonuses: race/level variations", () => {
  it("grants OF_PROT_FEAR to a BRAVERY_30 class at level 30", () => {
    const player = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
    player.lev = 30;
    const state = calcBonuses(player);
    expect(state.flags.has(OF.PROT_FEAR)).toBe(true);
    expect(playerFlags(player).has(OF.PROT_FEAR)).toBe(true);
    /* Level scaling: MELEE = 70 + adj 0 + 45 * 30 / 10 = 205. */
    expect(state.skills[SKILL.TO_HIT_MELEE]).toBe(205);
  });

  it("keeps racial element resists (Elf resists light)", () => {
    const player = bornWithStats("Elf", "Warrior", HUMAN_WARRIOR_STATS);
    const state = calcBonuses(player);
    expect(state.elInfo[ELEM.LIGHT]?.resLevel).toBe(1);
    expect(state.elInfo[ELEM.DARK]?.resLevel).toBe(0);
  });

  it("applies UNLIGHT/EVIL element info only in the dungeon", () => {
    const player = bornWithStats(
      "Human",
      "Necromancer",
      HUMAN_WARRIOR_STATS,
    );
    const born = calcBonuses(player);
    expect(born.elInfo[ELEM.DARK]?.resLevel).toBe(0);
    expect(born.elInfo[ELEM.NETHER]?.resLevel).toBe(0);
    expect(born.elInfo[ELEM.HOLY_ORB]?.resLevel).toBe(0);
    const dungeon = calcBonuses(player, { characterDungeon: true });
    expect(dungeon.elInfo[ELEM.DARK]?.resLevel).toBe(1);
    expect(dungeon.elInfo[ELEM.NETHER]?.resLevel).toBe(1);
    expect(dungeon.elInfo[ELEM.HOLY_ORB]?.resLevel).toBe(-1);
  });

  it("picks up racial infravision (Dwarf sees 5)", () => {
    const player = bornWithStats("Dwarf", "Warrior", HUMAN_WARRIOR_STATS);
    const state = calcBonuses(player);
    expect(state.seeInfra).toBe(5);
  });
});

describe("calcBlows (player-calcs.c:1703-1735, hand-derived)", () => {
  const warrior = reg.classByName("Warrior");
  if (!warrior) throw new Error("missing Warrior");

  it("gives exactly one blow (100) unarmed at rock-bottom stats", () => {
    /* STR 5 -> ind 2: adj_str_blow[2]=5 * 5 / 30 = 0.
       DEX 8 -> ind 5: adj_dex_blow[5]=0.
       blows_table[0][0] = 100 -> 10000/100 = 100. */
    expect(calcBlows(warrior, null, 2, 5)).toBe(100);
  });

  it("computes unarmed blows for the reference Warrior", () => {
    /* Same derivation as the calcBonuses test: table[5][2]=42 -> 238. */
    expect(calcBlows(warrior, null, 16, 14)).toBe(238);
  });

  it("uses the real weapon weight once it exceeds min_weight", () => {
    /* 13.0 lb weapon (130 tenth-lb) > min_weight 30:
       str_index = adj_str_blow[16]=30 * 5 / 130 = 1
       dex_index = adj_dex_blow[14] = 2
       blows_table[1][2] = 85 -> 10000/85 = 117. */
    expect(calcBlows(warrior, 130, 16, 14)).toBe(117);
  });

  it("substitutes min_weight for lighter weapons", () => {
    /* A 1.2 lb Dagger (12) is below min_weight 30, so the divisor is 30 and
       the result equals the unarmed case. */
    expect(calcBlows(warrior, 12, 16, 14)).toBe(238);
  });

  it("adds 100 per extra blow", () => {
    expect(calcBlows(warrior, 130, 16, 14, 1)).toBe(217);
  });

  it("caps at 100 * max_attacks", () => {
    /* STR ind 37: adj_str_blow[37]=240 * 5 / 30 = 40 -> capped at 11.
       DEX ind 37: adj_dex_blow[37]=11.
       blows_table[11][11] = 15 -> 10000/15 = 666 -> min(666, 600) = 600. */
    expect(calcBlows(warrior, null, 37, 37)).toBe(600);
  });

  it("requires two blows under O-combat (birth_percent_damage)", () => {
    expect(calcBlows(warrior, null, 2, 5, 0, true)).toBe(200);
  });
});

describe("adjustSkillScale (player-calcs.c:1781-1792)", () => {
  it("scales up like value * (den + num) / den", () => {
    expect(adjustSkillScale(100, 1, 20, 0)).toBe(105);
    expect(adjustSkillScale(19, 1, 20, 0)).toBe(19); /* 19*1/20 trunc = 0 */
  });

  it("rounds the decrease up to mimic the positive-value identity", () => {
    /* 100 * (20 - 1) / 20 = 95: v -= ceil(100 * 1 / 20) = 5. */
    expect(adjustSkillScale(100, -1, 20, 0)).toBe(95);
    /* 19 -= ceil(19/20) = 1 -> 18 (contrast the trunc on the way up). */
    expect(adjustSkillScale(19, -1, 20, 0)).toBe(18);
  });
});

describe("adapters for combat and turn-loop consumers", () => {
  const player = bornWithStats("Human", "Warrior", HUMAN_WARRIOR_STATS);
  const state = calcBonuses(player);

  it("toCombatState exposes the PlayerCombatState fields", () => {
    const combat = toCombatState(state);
    expect(combat.toH).toBe(3);
    expect(combat.toD).toBe(2);
    expect(combat.ac).toBe(0);
    expect(combat.toA).toBe(1);
    expect(combat.numBlows).toBe(238);
    expect(combat.ammoMult).toBe(0);
    expect(combat.blessWield).toBe(false);
    expect(combat.skills.length).toBe(SKILL_MAX);
    expect(combat.skills[SKILL.TO_HIT_MELEE]).toBe(74);
  });

  it("toDefenderState exposes ac + to_a", () => {
    expect(toDefenderState(state)).toEqual({ ac: 0, toA: 1 });
  });
});
