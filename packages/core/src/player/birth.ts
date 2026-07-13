/**
 * Character birth, ported from reference/src/player-birth.c (Angband 4.2.6):
 * the point-buy stat cost table and buy/sell semantics, the classic stat
 * roller (get_stats / do_cmd_roll_stats), history-chart generation, the
 * age/height/weight rolls, starting gold, and the level-1 hitpoint math from
 * player_generate.
 *
 * generatePlayer is a pure pipeline (race, class, options, rng) ->
 * PlayerBirthResult. It uses the classic roller (the do_cmd_roll_stats path)
 * for reproducible stats from a seeded Rng.
 *
 * DEFERRED (see parity/ledger/player-birth.yaml):
 *   - the point-based auto-spend "generate_stats" (its step 1/2 optimisation
 *     reads state->num_blows, which needs equipment-aware calc_bonuses);
 *     the point-buy primitives it is built on ARE ported here
 *   - starting inventory objects (returned as tval/sval kind-name refs only)
 *   - roll_hp for levels 2..50 (birth fills only the level-1 hitdie)
 *   - calc_mana (msp/csp left at 0)
 */

import type { Rng } from "../rng";
import { HIST, STAT } from "../generated";
import { TMD } from "../generated";
import {
  calcHitpoints,
  calcSkills,
  calcStatIndices,
  modifyStatValue,
  statUseToIndex,
} from "./calcs";
import { blankPlayer } from "./player";
import type { Player } from "./player";
import { historyAddFull } from "./history";
import { rollHp } from "./exp";
import { STAT_MAX } from "./types";
import type {
  HistoryChart,
  PlayerBody,
  PlayerClass,
  PlayerRace,
  StartItem,
} from "./types";

/** z_info->start_gold (constants.txt). */
export const START_GOLD = 600;

/**
 * birth_stat_costs[18 + 1] (player-birth.c): the point cost of a base stat at
 * each value 0..18. Buying a stat from v to v+1 costs birth_stat_costs[v + 1].
 */
export const BIRTH_STAT_COSTS: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 4,
];

/** MAX_BIRTH_POINTS = 3 * (1+1+1+1+1+1+2) (player-birth.c). */
export const MAX_BIRTH_POINTS = 20;

/** Base value every stat starts at during point-buy. */
export const BIRTH_STAT_BASE = 10;

/** Default PY_FOOD_FULL: the FOOD "Fed" grade max (90) times food_value (100). */
export const PY_FOOD_FULL_DEFAULT = 90 * 100;

/* ------------------------------------------------------------------ */
/* Point-buy (player-birth.c reset_stats / buy_stat / sell_stat)       */
/* ------------------------------------------------------------------ */

/** Mutable point-buy state (the stats[]/points arrays in player-birth.c). */
export interface StatBuyState {
  stats: number[];
  pointsSpent: number[];
  pointsLeft: number;
}

/** reset_stats: all stats at base 10, no points spent, full pool available. */
export function resetStats(): StatBuyState {
  return {
    stats: new Array<number>(STAT_MAX).fill(BIRTH_STAT_BASE),
    pointsSpent: new Array<number>(STAT_MAX).fill(0),
    pointsLeft: MAX_BIRTH_POINTS,
  };
}

/** Cost to raise a stat currently at `value` by one point (below 18 only). */
export function statIncreaseCost(value: number): number {
  return BIRTH_STAT_COSTS[value + 1] ?? 0;
}

/**
 * buy_stat: raise stat `choice` by one if it is below 18 and enough points
 * remain. Returns whether the purchase happened.
 */
export function buyStat(state: StatBuyState, choice: number): boolean {
  if (choice < 0 || choice >= STAT_MAX) return false;
  const cur = state.stats[choice] ?? 0;
  if (cur >= 18) return false;
  const cost = statIncreaseCost(cur);
  if (cost > state.pointsLeft) return false;
  state.stats[choice] = cur + 1;
  state.pointsSpent[choice] = (state.pointsSpent[choice] ?? 0) + cost;
  state.pointsLeft -= cost;
  return true;
}

/**
 * sell_stat: lower stat `choice` by one if it is above the base of 10,
 * refunding birth_stat_costs[value]. Returns whether the sale happened.
 */
export function sellStat(state: StatBuyState, choice: number): boolean {
  if (choice < 0 || choice >= STAT_MAX) return false;
  const cur = state.stats[choice] ?? 0;
  if (cur <= BIRTH_STAT_BASE) return false;
  const refund = BIRTH_STAT_COSTS[cur] ?? 0;
  state.stats[choice] = cur - 1;
  state.pointsSpent[choice] = (state.pointsSpent[choice] ?? 0) - refund;
  state.pointsLeft += refund;
  return true;
}

/**
 * Total point cost to raise a single stat from `from` to `to` (to <= 18),
 * i.e. sum of birth_stat_costs[v] for v in (from, to]. Convenience wrapper
 * over the buy_stat cost table.
 */
export function pointBuyCost(from: number, to: number): number {
  let total = 0;
  for (let v = from; v < to; v++) total += statIncreaseCost(v);
  return total;
}

/** recalculate_stats gold: start_gold + 50 * points_left. */
export function birthGold(pointsLeft: number): number {
  return START_GOLD + 50 * pointsLeft;
}

/* ------------------------------------------------------------------ */
/* Classic roller (player-birth.c get_stats)                           */
/* ------------------------------------------------------------------ */

/**
 * get_stats: roll each stat as 5 + 1d3 + 1d4 + 1d5, re-rolling the whole set
 * until the 15-dice total lands strictly between 7*STAT_MAX and 9*STAT_MAX.
 * Returns the natural stat_max array (values 8..17), indexed by STAT.
 */
export function rollStats(rng: Rng): number[] {
  const dice = new Array<number>(3 * STAT_MAX).fill(0);
  for (;;) {
    let sum = 0;
    for (let i = 0; i < 3 * STAT_MAX; i++) {
      const d = rng.randint1(3 + (i % 3));
      dice[i] = d;
      sum += d;
    }
    if (sum > 7 * STAT_MAX && sum < 9 * STAT_MAX) break;
  }
  const stats = new Array<number>(STAT_MAX).fill(0);
  for (let i = 0; i < STAT_MAX; i++) {
    stats[i] =
      5 + (dice[3 * i] ?? 0) + (dice[3 * i + 1] ?? 0) + (dice[3 * i + 2] ?? 0);
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/* History, age/height/weight, gold (player-birth.c)                   */
/* ------------------------------------------------------------------ */

/**
 * get_history: walk the history graph from `chart`, at each node rolling
 * randint1(100) and taking the first entry whose cumulative roll threshold is
 * >= the roll, appending its text and moving to the successor chart. Returns
 * the concatenated history string (empty when chart is null).
 */
export function generateHistory(chart: HistoryChart | null, rng: Rng): string {
  let res = "";
  let node: HistoryChart | null = chart;
  while (node) {
    const roll = rng.randint1(100);
    let chosen = node.entries[node.entries.length - 1] ?? null;
    for (const entry of node.entries) {
      if (roll <= entry.roll) {
        chosen = entry;
        break;
      }
    }
    if (!chosen) break;
    res += chosen.text;
    node = chosen.succ;
  }
  return res;
}

/** get_ahw result: rolled age, height and weight. */
export interface Ahw {
  age: number;
  ht: number;
  wt: number;
}

/**
 * get_ahw: age = b_age + 1d(m_age); height and weight are normal rolls about
 * the racial base with the racial modifier as the spread.
 */
export function rollAhw(race: PlayerRace, rng: Rng): Ahw {
  const age = race.baseAge + rng.randint1(race.modAge);
  const ht = rng.randNormal(race.baseHeight, race.modHeight);
  const wt = rng.randNormal(race.baseWeight, race.modWeight);
  return { age, ht, wt };
}

/* ------------------------------------------------------------------ */
/* Full birth pipeline                                                 */
/* ------------------------------------------------------------------ */

/** A starting-inventory entry, kept as object kind-name refs (deferred). */
export interface StartItemRef {
  tval: string;
  sval: string;
  min: number;
  max: number;
  eopts: string[];
}

/** Inputs to generatePlayer that come from the registry / birth choices. */
export interface PlayerBirthOptions {
  /** The race's equipment body (registry.bodies[race.body]). */
  body: PlayerBody;
  /** The race's starting history chart (registry.historyChart(race)). */
  historyChart: HistoryChart | null;
  /** Starting timed[FOOD] ceiling; defaults to PY_FOOD_FULL_DEFAULT. */
  foodFull?: number;
}

/** Result of the birth pipeline: the new player plus deferred references. */
export interface PlayerBirthResult {
  player: Player;
  /** Class starting inventory, unresolved (object binding deferred). */
  startingKit: StartItemRef[];
  /** The generated history text (also stored on player.history). */
  history: string;
}

/**
 * generate_player pipeline (player_generate + get_stats + get_ahw +
 * get_history + get_money, with level-1 hitpoints from calc_hitpoints).
 *
 * The RNG is consumed in this order: stat rolls, then age/height/weight, then
 * the history walk, matching the do_cmd_roll_stats sequence (get_bonuses,
 * which does not consume the RNG, sits between stats and ahw upstream).
 */
export function generatePlayer(
  race: PlayerRace,
  cls: PlayerClass,
  options: PlayerBirthOptions,
  rng: Rng,
): PlayerBirthResult {
  const player = blankPlayer(race, cls, options.body);

  /* Stats: classic roller, then healed/birth copies with identity swap map. */
  const statMax = rollStats(rng);
  for (let i = 0; i < STAT_MAX; i++) {
    player.statMax[i] = statMax[i] ?? 0;
    player.statCur[i] = statMax[i] ?? 0;
    player.statBirth[i] = statMax[i] ?? 0;
    player.statMap[i] = i;
  }

  /* Level 1, experience factor and hitdice (player_generate). */
  player.lev = 1;
  player.maxLev = 1;
  player.exp = 0;
  player.maxExp = 0;
  player.expFrac = 0;
  player.expFactor = race.expFactor + cls.expFactor;
  player.hitdie = race.hitdie + cls.hitdie;
  player.playerHp[0] = player.hitdie;
  /* roll_hp: the cumulative hitdice for levels 2..50, banded 3/8..5/8. */
  rollHp(player, rng);

  /* Stat indices into adj_* tables, then level-1 hitpoints. */
  const statInd = calcStatIndices(race, cls, player.statCur);
  const conAdd = (race.statAdj[STAT.CON] ?? 0) + (cls.statAdj[STAT.CON] ?? 0);
  const conInd = statUseToIndex(
    modifyStatValue(player.statCur[STAT.CON] ?? 0, conAdd),
  );
  player.mhp = calcHitpoints(player.playerHp[0] ?? 0, 1, conInd);
  player.chp = player.mhp;
  player.chpFrac = 0;
  /* Mana is deferred (calc_mana). */
  player.msp = 0;
  player.csp = 0;
  player.cspFrac = 0;

  /* Non-equipment level-based skills. */
  player.skills = calcSkills(race, cls, 1, statInd);

  /* Age / height / weight. */
  const ahw = rollAhw(race, rng);
  player.age = ahw.age;
  player.ht = ahw.ht;
  player.wt = ahw.wt;
  player.htBirth = ahw.ht;
  player.wtBirth = ahw.wt;

  /* Well fed to start (player_generate). */
  const foodFull = options.foodFull ?? PY_FOOD_FULL_DEFAULT;
  player.timed[TMD.FOOD] = foodFull - 1;

  /* History. */
  const history = generateHistory(options.historyChart, rng);
  player.history = history;

  /* Starting gold (get_money; roller path leaves 0 points, so no bonus). */
  player.au = START_GOLD;
  player.auBirth = START_GOLD;

  /* do_cmd_accept_character (player-birth.c L1241-1242): history_clear then
   * history_add(HIST_PLAYER_BIRTH). blankPlayer already leaves player.hist
   * empty, so the clear is a no-op here; stamped with the constants true of
   * every character at birth (town, level 1, turn 0). */
  historyAddFull(
    player,
    1 << HIST.PLAYER_BIRTH,
    0,
    0,
    1,
    0,
    "Began the quest to destroy Morgoth.",
  );

  const startingKit: StartItemRef[] = cls.startItems.map((s: StartItem) => ({
    tval: s.tval,
    sval: s.sval,
    min: s.min,
    max: s.max,
    eopts: [...s.eopts],
  }));

  return { player, startingKit, history };
}
