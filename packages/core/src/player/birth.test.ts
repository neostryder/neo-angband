import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIST, STAT } from "../generated";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import {
  BIRTH_MESSAGE_RECALL_BANNER,
  BIRTH_STAT_COSTS,
  MAX_BIRTH_POINTS,
  START_GOLD,
  birthGold,
  buyStat,
  findRomanSuffixStart,
  flavorSetAllAware,
  generateHistory,
  generatePlayer,
  generateStats,
  incrementNameSuffix,
  intToRoman,
  optionsInitCheat,
  pointBuyCost,
  resetStats,
  rollStats,
  romanToInt,
  sellStat,
} from "./birth";
import { calcHitpoints, modifyStatValue, statUseToIndex } from "./calcs";
import { OptionState } from "./options";
import { FlavorKnowledge } from "../obj/knowledge";
import type { ObjectKind } from "../obj/types";

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

describe("generate_stats (point-buy auto-allocation, player-birth.c:816-973)", () => {
  const warrior = reg.classByName("Warrior");
  const mage = reg.classByName("Mage");
  const human = reg.raceByName("Human");

  it("is deterministic and never overspends the pool", () => {
    if (!human || !warrior) return;
    const a = generateStats(human, warrior);
    const b = generateStats(human, warrior);
    expect(a.stats).toEqual(b.stats);
    expect(a.pointsLeft).toBe(b.pointsLeft);
    expect(a.pointsLeft).toBeGreaterThanOrEqual(0);
    /* spent + left conserves the whole pool. */
    const spent = a.pointsSpent.reduce((s, v) => s + v, 0);
    expect(spent + a.pointsLeft).toBe(MAX_BIRTH_POINTS);
    /* Every stat stays inside the point-buy band [10, 18]. */
    for (const v of a.stats) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(18);
    }
  });

  it("buys base STR to 17 for a warrior (step 0) and invests CON (step 3)", () => {
    if (!human || !warrior) return;
    const s = generateStats(human, warrior).stats;
    /* Step 0 always buys STR up to 17 (affordable at 8 points). */
    expect(s[STAT.STR]).toBe(17);
    /* A warrior spends the remaining pool on CON (up to base 16) and DEX. */
    expect(s[STAT.CON]).toBeGreaterThan(10);
    expect(s[STAT.DEX]).toBeGreaterThanOrEqual(10);
  });

  it("invests the spell-stat (INT) for a caster (step 3)", () => {
    if (!human || !mage) return;
    const s = generateStats(human, mage).stats;
    /* Mage: pure caster, spell_stat = INT, gets a heavy share of the pool. */
    expect(s[STAT.INT]).toBeGreaterThan(10);
  });

  it("feeds generatePlayer verbatim through the point-buy path", () => {
    const race = reg.raceByName("Half-Troll");
    const cls = reg.classByName("Warrior");
    const body = reg.bodies[0];
    if (!race || !cls || !body) return;
    const alloc = generateStats(race, cls);
    const { player } = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race), stats: [...alloc.stats] },
      new Rng(4242),
    );
    for (let i = 0; i < STAT.CON + 1; i++) {
      expect(player.statBirth[i]).toBe(alloc.stats[i]);
    }
    /* get_money (player-birth.c:392,1255) resets au to start_gold at accept,
       discarding the point-buy leftover-gold preview (birthGold). */
    expect(player.au).toBe(START_GOLD);
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

describe("point-based birth (generatePlayer with a given stat array)", () => {
  const race = reg.raceByName("Half-Troll");
  const cls = reg.classByName("Warrior");
  const body = reg.bodies[0];
  // A valid point-buy allocation: STR 10->17 (8) + CON 10->16 (6) = 14 spent,
  // so 6 points remain (gold bonus 6 * 50).
  const alloc = [17, 10, 10, 10, 16];

  function opts() {
    if (!race || !cls || !body) throw new Error("missing fixtures");
    return { race, cls, body };
  }

  it("uses the given stats verbatim (no roll) and honours the leftover-point gold", () => {
    const { race, cls, body } = opts();
    const { player } = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race), stats: alloc },
      new Rng(4242),
    );
    for (let i = 0; i < 5; i++) {
      expect(player.statMax[i]).toBe(alloc[i]);
      expect(player.statCur[i]).toBe(alloc[i]);
      expect(player.statBirth[i]).toBe(alloc[i]);
      expect(player.statMap[i]).toBe(i);
    }
    /* get_money (player-birth.c:392,1255) sets au = au_birth = start_gold at
       accept, so the 6 leftover points grant no gold bonus in play. */
    expect(player.au).toBe(START_GOLD);
    expect(player.auBirth).toBe(player.au);
  });

  it("draws ZERO stat RNG and skips EXACTLY the classic roller's draws", () => {
    const { race, cls, body } = opts();
    const seed = 9001;

    // Classic path: consumes rollStats + rollHp + ahw + history.
    const rngClassic = new Rng(seed);
    generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      rngClassic,
    );

    // Point-based path: pre-advance a fresh RNG past exactly the stat rolls the
    // classic path would have drawn, then run point-based (which draws none for
    // stats). If point-based skips ONLY the stat rolls, both RNGs are left in
    // byte-identical states after the shared downstream draws (rollHp, ahw,
    // history) - proving the draw order/count is unchanged everywhere else.
    const rngPoint = new Rng(seed);
    rollStats(rngPoint); // the stat-roll draws point-based omits
    generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race), stats: alloc },
      rngPoint,
    );

    expect(rngPoint.getState()).toEqual(rngClassic.getState());
  });

  it("leaves the classic path byte-identical to a bare rollStats for the seed", () => {
    const { race, cls, body } = opts();
    const seed = 555;
    const { player } = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      new Rng(seed),
    );
    // The classic roller still draws first from the same seed, so its stats
    // match a standalone rollStats (regression guard: unchanged RNG contract).
    expect(player.statMax.slice(0, 5)).toEqual(rollStats(new Rng(seed)));
  });

  it("classic birth is a stable snapshot for a fixed seed (regression)", () => {
    const { race, cls, body } = opts();
    const { player, history } = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      new Rng(2026),
    );
    const a = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      new Rng(2026),
    );
    expect(player.statMax).toEqual(a.player.statMax);
    expect(player.mhp).toBe(a.player.mhp);
    expect(player.age).toBe(a.player.age);
    expect(player.ht).toBe(a.player.ht);
    expect(player.wt).toBe(a.player.wt);
    expect(history).toBe(a.history);
    /* Classic path takes no gold bonus (0 leftover points). */
    expect(player.au).toBe(START_GOLD);
  });
});

describe("standard roller (generatePlayer rolledStats, do_cmd_roll_stats)", () => {
  const race = reg.raceByName("Half-Troll");
  const cls = reg.classByName("Warrior");
  const body = reg.bodies[0];
  /* Values a real roll can produce but point-buy cannot: an 8, and three 17s
     (unaffordable in one allocation) - proving rolledStats bypasses the buy. */
  const rolled = [8, 17, 17, 17, 12];

  it("applies rolled stats verbatim (no clamp) and awards start_gold only", () => {
    if (!race || !cls || !body) return;
    const { player } = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race), rolledStats: rolled },
      new Rng(4242),
    );
    for (let i = 0; i < STAT.CON + 1; i++) {
      expect(player.statMax[i]).toBe(rolled[i]);
      expect(player.statCur[i]).toBe(rolled[i]);
      expect(player.statBirth[i]).toBe(rolled[i]);
    }
    /* Roller leaves 0 leftover points -> exactly start_gold. */
    expect(player.au).toBe(START_GOLD);
  });

  it("draws ZERO stat RNG (same downstream state as pre-skipping the roll)", () => {
    if (!race || !cls || !body) return;
    const seed = 9001;
    const rngClassic = new Rng(seed);
    generatePlayer(race, cls, { body, historyChart: reg.historyChart(race) }, rngClassic);

    const rngRolled = new Rng(seed);
    rollStats(rngRolled); // the stat-roll draws the rolled path omits
    generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race), rolledStats: rolled },
      rngRolled,
    );
    expect(rngRolled.getState()).toEqual(rngClassic.getState());
  });
});

describe("history override (generatePlayer historyOverride, do_cmd_choose_history)", () => {
  const race = reg.raceByName("Human");
  const cls = reg.classByName("Warrior");
  const body = reg.bodies[0];

  it("overrides the stored history but keeps the RNG stream identical", () => {
    if (!race || !cls || !body) return;
    const seed = 321;
    const edited = "A wandering scholar with a mysterious past.";
    const rngA = new Rng(seed);
    const withOverride = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race), historyOverride: edited },
      rngA,
    );
    const rngB = new Rng(seed);
    const without = generatePlayer(
      race,
      cls,
      { body, historyChart: reg.historyChart(race) },
      rngB,
    );
    expect(withOverride.history).toBe(edited);
    expect(withOverride.player.history).toBe(edited);
    /* The get_history walk still ran (same RNG draws), so ahw etc. match. */
    expect(rngA.getState()).toEqual(rngB.getState());
    expect(withOverride.player.age).toBe(without.player.age);
  });
});

describe("roman-numeral dynastic suffixes (player-birth.c:1329-1481)", () => {
  it("int_to_roman matches upstream for representative values", () => {
    expect(intToRoman(1)).toBe("I");
    expect(intToRoman(4)).toBe("IV");
    expect(intToRoman(9)).toBe("IX");
    expect(intToRoman(14)).toBe("XIV");
    expect(intToRoman(40)).toBe("XL");
    expect(intToRoman(1984)).toBe("MCMLXXXIV");
    /* No roman numeral for non-positive integers (returns 0/null upstream). */
    expect(intToRoman(0)).toBeNull();
    expect(intToRoman(-3)).toBeNull();
    /* Too small a buffer aborts (upstream returns 0). */
    expect(intToRoman(1984, 4)).toBeNull();
  });

  it("roman_to_int is the inverse for well-formed numerals", () => {
    expect(romanToInt("I")).toBe(1);
    expect(romanToInt("IV")).toBe(4);
    expect(romanToInt("XIV")).toBe(14);
    expect(romanToInt("MCMLXXXIV")).toBe(1984);
    /* Empty / non-roman input -> -1. */
    expect(romanToInt("")).toBe(-1);
    expect(romanToInt("Bob")).toBe(-1);
  });

  it("find_roman_suffix_start locates a trailing numeral only after a space", () => {
    /* "Aragorn II": suffix "II" starts at index 8. */
    expect(findRomanSuffixStart("Aragorn II")).toBe(8);
    /* No space -> no suffix. */
    expect(findRomanSuffixStart("Aragorn")).toBeNull();
    /* Non-roman trailing word -> no suffix. */
    expect(findRomanSuffixStart("Aragorn Two")).toBeNull();
  });

  it("increments an existing suffix (Name II -> Name III), else unchanged", () => {
    expect(incrementNameSuffix("Aragorn II")).toBe("Aragorn III");
    expect(incrementNameSuffix("Beorn IV")).toBe("Beorn V");
    /* A name with no roman suffix is returned unchanged. */
    expect(incrementNameSuffix("Frodo")).toBe("Frodo");
    expect(incrementNameSuffix("Sam Gamgee")).toBe("Sam Gamgee");
  });
});

describe("acceptance-flow helpers (do_cmd_accept_character)", () => {
  it("options_init_cheat clears cheat options and their score twins", () => {
    const opts = new OptionState({ overrides: { cheat_hear: true } });
    /* The cheat override forces its score twin on (option_set coupling). */
    expect(opts.get("cheat_hear")).toBe(true);
    expect(opts.anyScoreSet()).toBe(true);
    optionsInitCheat(opts);
    expect(opts.get("cheat_hear")).toBe(false);
    expect(opts.get("score_hear")).toBe(false);
    expect(opts.anyScoreSet()).toBe(false);
  });

  it("flavor_set_all_aware marks every flavoured kind aware, and only those", () => {
    const flavor = new FlavorKnowledge(100);
    const kinds = [{ kidx: 1 }, { kidx: 2 }, { kidx: 3 }] as ObjectKind[];
    /* kidx 2 is unflavoured (e.g. food/torch): it must not be force-awared. */
    flavorSetAllAware(flavor, kinds, (k) => k.kidx !== 2);
    expect(flavor.isAware(kinds[0]!)).toBe(true);
    expect(flavor.isAware(kinds[1]!)).toBe(false);
    expect(flavor.isAware(kinds[2]!)).toBe(true);
  });

  it("exposes the exact five-line message-recall separator banner", () => {
    /* player-birth.c:1245-1249, verbatim including the padded spaces. */
    expect(BIRTH_MESSAGE_RECALL_BANNER).toEqual([
      " ",
      "  ",
      "====================",
      "  ",
      " ",
    ]);
  });
});
