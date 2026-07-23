/**
 * Character birth, ported from reference/src/player-birth.c (Angband 4.2.6):
 * the point-buy stat cost table and buy/sell semantics, the classic stat
 * roller (get_stats / do_cmd_roll_stats), history-chart generation, the
 * age/height/weight rolls, starting gold, and the level-1 hitpoint math from
 * player_generate.
 *
 * generatePlayer is a pure pipeline (race, class, options, rng) ->
 * PlayerBirthResult. It uses the classic roller (the do_cmd_roll_stats path)
 * for reproducible stats from a seeded Rng, or a supplied stat array (either a
 * point-buy allocation or a standard-roller result).
 *
 * Also ported here (player-birth.c): generate_stats (the point-buy auto-spend
 * heuristic that seeds the recommended per-class spread) and the Roman-numeral
 * dynastic-suffix helpers (int_to_roman / roman_to_int / find_roman_suffix_start,
 * used by do_cmd_birth_init when death -> new character reuses the savefile),
 * plus the acceptance-flow engine helpers options_init_cheat, flavor_set_all_aware
 * and the message-recall separator banner.
 *
 * DEFERRED (see parity/ledger/player-birth.yaml):
 *   - starting inventory objects (returned as tval/sval kind-name refs only)
 * calc_mana runs in the session layer after birth (session/game.ts calls
 * calcMana), so msp/csp are left at 0 here and populated there.
 */

import type { Rng } from "../rng";
import { HIST, STAT } from "../generated";
import { TMD } from "../generated";
import {
  calcBlows,
  calcHitpoints,
  calcSkills,
  calcStatIndices,
  modifyStatValue,
  statUseToIndex,
} from "./calcs";
import { blankPlayer } from "./player";
import type { Player } from "./player";
import type { OptionState } from "./options";
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
import type { FlavorKnowledge } from "../obj/knowledge";
import type { ObjectKind } from "../obj/types";

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

/**
 * generate_stats (player-birth.c:816-973): pick a reasonable set of point-buy
 * starting stats for a race/class following the upstream 5-step heuristic, and
 * return the resulting StatBuyState (stats/pointsSpent/pointsLeft). Draws NO
 * RNG. Invoked by do_cmd_choose_race/class (player-birth.c:1101,1112) to seed
 * the recommended per-class spread the point-buy screen starts from.
 *
 * Faithful to the C, step by step:
 *   0. buy base STR up to 17 (a pure caster then skips straight to step 3);
 *   1. buy DEX up to 17, tracking the best num_blows breakpoint (dex_break);
 *   2. sell DEX back down to that breakpoint (drop DEX that buys no extra blow);
 *   3. spend up to half the remaining pool on the spell-stat and CON (a warrior
 *      may spend all of it; a non-caster caps the spell-stat at base 16);
 *   4. dump any leftover points on DEX, then the non-spell stats, in order.
 *
 * num_blows is recomputed after each DEX buy exactly as buy_stat(update=true)
 * -> recalculate_stats -> get_bonuses would: calc_blows over the race/class
 * modified STR/DEX indices with NO wielded weapon (obj == NULL), since the
 * player is not outfitted until do_cmd_accept_character. percentDamage mirrors
 * OPT(player, birth_percent_damage) (default off), which only raises the blow
 * floor to two and never changes the breakpoint search.
 */
export function generateStats(
  race: PlayerRace,
  cls: PlayerClass,
  percentDamage = false,
): StatBuyState {
  const buy = resetStats();
  const maxed = new Array<boolean>(STAT_MAX).fill(false);

  /* spell_stat: the realm stat of the class's first book, or 0 if no magic. */
  const spellStat = cls.magic.totalSpells
    ? (cls.magic.books[0]?.realm.stat ?? 0)
    : 0;
  const caster = cls.maxAttacks < 5;
  const warrior = cls.maxAttacks > 5;

  let blows = 10;
  let dexBreak = 10;

  /* player->state.num_blows (100x) for the current allocation: calc_blows over
   * the modified STR/DEX indices, unarmed (weaponWeight null). */
  const numBlows = (): number => {
    const strAdd =
      (race.statAdj[STAT.STR] ?? 0) + (cls.statAdj[STAT.STR] ?? 0);
    const dexAdd =
      (race.statAdj[STAT.DEX] ?? 0) + (cls.statAdj[STAT.DEX] ?? 0);
    const strInd = statUseToIndex(
      modifyStatValue(buy.stats[STAT.STR] ?? 0, strAdd),
    );
    const dexInd = statUseToIndex(
      modifyStatValue(buy.stats[STAT.DEX] ?? 0, dexAdd),
    );
    return calcBlows(cls, null, strInd, dexInd, 0, percentDamage);
  };

  let step = 0;
  while (buy.pointsLeft > 0 && step >= 0) {
    switch (step) {
      /* Step 0: buy base STR 17. */
      case 0: {
        if (!maxed[STAT.STR] && (buy.stats[STAT.STR] ?? 0) < 17) {
          if (!buyStat(buy, STAT.STR)) maxed[STAT.STR] = true;
        } else {
          step++;
          /* If pure caster skip to step 3. */
          if (caster) step = 3;
        }
        break;
      }

      /* Step 1: buy base DEX 17, recording the best blow breakpoint. */
      case 1: {
        if (!maxed[STAT.DEX] && (buy.stats[STAT.DEX] ?? 0) < 17) {
          if (!buyStat(buy, STAT.DEX)) maxed[STAT.DEX] = true;
          const nb = Math.trunc(numBlows() / 10);
          if (nb > blows) {
            blows = nb;
            dexBreak = buy.stats[STAT.DEX] ?? 0;
          }
        } else {
          step++;
        }
        break;
      }

      /* Step 2: sell back DEX that isn't getting us an extra blow. */
      case 2: {
        while ((buy.stats[STAT.DEX] ?? 0) > dexBreak) {
          sellStat(buy, STAT.DEX);
          maxed[STAT.DEX] = false;
        }
        step++;
        break;
      }

      /*
       * Step 3: spend up to half the remaining points on each of the spell-stat
       * and CON, capped at base 16 unless a pure class [caster or warrior].
       */
      case 3: {
        let pointsTrigger = Math.trunc(buy.pointsLeft / 2);

        if (warrior) {
          pointsTrigger = buy.pointsLeft;
        } else {
          while (
            !maxed[spellStat] &&
            (caster || (buy.stats[spellStat] ?? 0) < 18) &&
            (buy.pointsSpent[spellStat] ?? 0) < pointsTrigger
          ) {
            if (!buyStat(buy, spellStat)) maxed[spellStat] = true;
            if ((buy.pointsSpent[spellStat] ?? 0) > pointsTrigger) {
              sellStat(buy, spellStat);
              maxed[spellStat] = true;
            }
          }
        }

        while (
          !maxed[STAT.CON] &&
          (buy.stats[STAT.CON] ?? 0) < 16 &&
          (buy.pointsSpent[STAT.CON] ?? 0) < pointsTrigger
        ) {
          if (!buyStat(buy, STAT.CON)) maxed[STAT.CON] = true;
          if ((buy.pointsSpent[STAT.CON] ?? 0) > pointsTrigger) {
            sellStat(buy, STAT.CON);
            maxed[STAT.CON] = true;
          }
        }

        step++;
        break;
      }

      /*
       * Step 4: spend any remaining points as far as possible, in order, on
       * DEX and then the non-spell stat.
       */
      case 4: {
        let nextStat: number;
        if (!maxed[STAT.DEX]) {
          nextStat = STAT.DEX;
        } else if (!maxed[STAT.INT] && spellStat !== STAT.INT) {
          nextStat = STAT.INT;
        } else if (!maxed[STAT.WIS] && spellStat !== STAT.WIS) {
          nextStat = STAT.WIS;
        } else {
          step++;
          break;
        }

        /* Buy until we can't buy any more. */
        while (buyStat(buy, nextStat)) {
          /* keep buying this stat */
        }
        maxed[nextStat] = true;
        break;
      }

      default: {
        step = -1;
        break;
      }
    }
  }

  return buy;
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
  /**
   * Point-based allocated base stats (STAT_MAX values, each in
   * [BIRTH_STAT_BASE, 18]), the ui-birth.c BR_POINTBASED result. When present,
   * these stats are applied faithfully through the point-buy primitives
   * (reset_stats + buy_stat) and the classic roller is NOT run, so the stat
   * stage draws ZERO RNG and the leftover-point gold bonus (get_money) is
   * honoured. Omit for the classic roller (rollStats). Values below the base of
   * 10 are clamped up to the base; values above 18 are capped by buy_stat.
   */
  stats?: readonly number[];
  /**
   * A standard-roller result (do_cmd_roll_stats, player-birth.c:1159-1193): the
   * STAT_MAX natural stat values are applied VERBATIM - no point-buy clamp, no
   * cost accounting, no RNG. Mutually exclusive with `stats`; `rolledStats`
   * wins if both are given. Like the classic roller the roller leaves zero
   * leftover points, so get_money awards exactly start_gold. Use this to thread
   * a stat set the shell's roller UI rolled and the player accepted, keeping the
   * downstream draws (rollHp / ahw / history) byte-identical to the other paths.
   */
  rolledStats?: readonly number[];
  /**
   * An edited character background (do_cmd_choose_history, player-birth.c:1219-
   * 1230): when present it REPLACES the get_history result stored on the player.
   * The history walk is still run against `historyChart` so the RNG draw order
   * is unchanged (get_history has already consumed its draws by the time
   * do_cmd_choose_history overwrites the text upstream); only the final string
   * is overridden.
   */
  historyOverride?: string;
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

  /*
   * Stats: point-based (a given allocation, drawing ZERO RNG) or the classic
   * roller. For point-based we replay the allocation through reset_stats +
   * buy_stat so the resulting stats match ui-birth.c's point-buy exactly. The
   * leftover-point pool no longer affects gold (get_money resets au to
   * start_gold at accept, see below). For the classic path the RNG draw is the
   * unchanged rollStats sequence.
   */
  let statMax: number[];
  if (options.rolledStats) {
    /* Standard roller: the accepted natural stats are applied verbatim (no
     * point-buy clamp, no RNG). do_cmd_roll_stats zeroes the points
     * (player-birth.c:1183-1187) and get_money awards start_gold either way. */
    statMax = new Array<number>(STAT_MAX)
      .fill(0)
      .map((_, i) => options.rolledStats?.[i] ?? 0);
  } else if (options.stats) {
    const buy = resetStats();
    for (let i = 0; i < STAT_MAX; i++) {
      const target = options.stats[i] ?? BIRTH_STAT_BASE;
      while ((buy.stats[i] ?? 0) < target && buyStat(buy, i)) {
        /* raise this stat one point at a time, up to the target */
      }
    }
    statMax = buy.stats;
  } else {
    statMax = rollStats(rng);
  }
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
  /* Mana: calcMana runs in the session layer after birth; born at 0 here. */
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

  /* History. The get_history walk always runs (so the RNG stream is identical
   * across paths); an edited background (do_cmd_choose_history) then overrides
   * the resulting text, exactly as upstream replaces player->history. */
  const rolledHistory = generateHistory(options.historyChart, rng);
  const history = options.historyOverride ?? rolledHistory;
  player.history = history;

  /* Starting gold. do_cmd_accept_character (player-birth.c:1255) calls
   * get_money AFTER the interactive point-buy screen, and get_money (L392)
   * unconditionally sets au = au_birth = z_info->start_gold, DISCARDING the
   * "start_gold + 50 * points_left" preview that recalculate_stats (L693)
   * showed during birth. So every accepted character starts with exactly
   * START_GOLD regardless of leftover points. birthGold(pointsLeft) is kept
   * for the point-buy screen's live gold preview only, never the final value. */
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

/* ------------------------------------------------------------------ */
/* Acceptance-flow engine helpers (do_cmd_accept_character)            */
/* ------------------------------------------------------------------ */

/**
 * The birth message-recall separator banner (player-birth.c:1245-1249): five
 * lines pushed into the message log at do_cmd_accept_character so the new
 * character's messages start below a visible divider. Emit each verbatim (in
 * order) through the shell's message sink at acceptance. Exact strings and
 * order are load-bearing (upstream message_add) - do not trim the padded
 * spaces.
 */
export const BIRTH_MESSAGE_RECALL_BANNER: readonly string[] = [
  " ",
  "  ",
  "====================",
  "  ",
  " ",
];

/**
 * options_init_cheat (option.c:175-185): clear every cheat option and its
 * score twin at character acceptance so a fresh character starts un-flagged.
 * Upstream clears opt[i] and opt[i+1] (the score option that immediately
 * follows each cheat option); the port models the twin by name (cheat_X ->
 * score_X), matching OptionState's own coupling.
 */
export function optionsInitCheat(options: OptionState): void {
  for (const name of options.names()) {
    if (!options.isCheat(name)) continue;
    options.set(name, false);
    /* cheat_X -> score_X (the adjacent score option upstream clears). */
    const twin = "score" + name.slice("cheat".length);
    options.set(twin, false);
  }
}

/**
 * flavor_set_all_aware (obj-util.c:252-266): mark every flavoured object kind
 * aware, so a birth_know_flavors character auto-identifies consumables on
 * sight. Upstream sets kind->aware for every kind with a kind->flavor; the port
 * keeps the per-game flavour assignment out of the immutable kind records, so
 * the caller supplies `hasFlavor` (state.hasFlavor / flavorAssignment.hasFlavor)
 * to decide which kinds were flavoured this game.
 */
export function flavorSetAllAware(
  flavor: FlavorKnowledge,
  kinds: readonly ObjectKind[],
  hasFlavor: (kind: ObjectKind) => boolean,
): void {
  for (const kind of kinds) {
    if (hasFlavor(kind)) flavor.setAware(kind);
  }
}

/* ------------------------------------------------------------------ */
/* Roman-numeral dynastic suffixes (player-birth.c:1329-1481)          */
/* ------------------------------------------------------------------ */

/** int_to_roman symbol labels, largest first (player-birth.c:1371-1373). */
const ROMAN_LABELS: readonly string[] = [
  "M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I",
];
/** int_to_roman symbol values, aligned with ROMAN_LABELS. */
const ROMAN_VALUES: readonly number[] = [
  1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1,
];
/** The seven single roman characters, high to low (roman_to_int chr1). */
const ROMAN_CHR1 = "MDCLXVI";
/** roman_to_int chr2: the subtractive follow chars per chr1 index. */
const ROMAN_CHR2: readonly (string | null)[] = [
  null, null, "DM", null, "LC", null, "VX",
];
/** roman_to_int token values per [chr1 index][chr2 index]. */
const ROMAN_TOKEN_VALS: readonly (readonly number[])[] = [
  [1000],
  [500],
  [100, 400, 900],
  [50],
  [10, 40, 90],
  [5],
  [1, 4, 9],
];

/**
 * int_to_roman (player-birth.c:1368-1413): the upper-case roman numeral for a
 * positive integer, or null when none exists (n < 1) or the result would not
 * fit in `bufSize` characters (upstream returns 0 and an empty buffer). The
 * default bufSize is large enough that only n < 1 fails.
 */
export function intToRoman(n: number, bufSize = 64): string | null {
  if (n < 1) return null;
  let out = "";
  let rem = n;
  while (rem > 0) {
    let i = 0;
    while (rem < (ROMAN_VALUES[i] ?? 0)) i++;
    const label = ROMAN_LABELS[i] ?? "";
    /* No room in buffer (label + trailing NUL), so abort (L1393-1395). */
    if (out.length + label.length + 1 > bufSize) break;
    out += label;
    rem -= ROMAN_VALUES[i] ?? 0;
  }
  /* Ran out of space and aborted (L1404-1410). */
  if (rem > 0) return null;
  return out;
}

/**
 * roman_to_int (player-birth.c:1428-1481): the integer value of a roman
 * numeral, or -1 when the string is empty or contains a non-roman character.
 * The upstream quirk of parsing certain nonsense strings (e.g. "IVXCCCVIII")
 * is preserved deliberately.
 */
export function romanToInt(roman: string): number {
  if (roman.length === 0) return -1;
  let n = 0;
  for (let i = 0; i < roman.length; i++) {
    const c1 = roman[i] ?? "";
    const c2 = roman[i + 1];
    const c1i = ROMAN_CHR1.indexOf(c1);
    if (c1i < 0) return -1;
    let c2i = 0;
    const follow = ROMAN_CHR2[c1i];
    if (follow && c2 !== undefined) {
      const p = follow.indexOf(c2);
      if (p >= 0) {
        c2i = p + 1;
        /* Two-char token, so skip a char on the next pass. */
        i++;
      }
    }
    n += ROMAN_TOKEN_VALS[c1i]?.[c2i] ?? 0;
  }
  return n;
}

/**
 * find_roman_suffix_start (player-birth.c:1336-1354): the index within `buf`
 * where a trailing roman-numeral suffix begins (the character after the last
 * space), or null when there is no space or the characters after it are not all
 * roman symbols. A trailing space yields an index at the end of the string
 * (an empty suffix), matching the C pointer-to-NUL behaviour.
 */
export function findRomanSuffixStart(buf: string): number | null {
  const sp = buf.lastIndexOf(" ");
  if (sp < 0) return null;
  const start = sp + 1;
  for (let p = start; p < buf.length; p++) {
    if (!ROMAN_CHR1.includes(buf[p] ?? "")) return null;
  }
  return start;
}

/**
 * The dynastic-suffix increment from do_cmd_birth_init (player-birth.c:1060-
 * 1073): when death -> new character reuses the savefile, a name that already
 * carries a roman-numeral suffix has that suffix bumped by one (Name II ->
 * Name III). Returns the new full name; a name with no roman suffix, or one
 * whose incremented suffix will not fit, is returned unchanged (upstream logs
 * "Sorry, could not deal with suffix" and leaves the name alone).
 *
 * `bufSize` is PLAYER_NAME_LEN (option.h:23 = 32) by default.
 */
export function incrementNameSuffix(fullName: string, bufSize = 32): string {
  const start = findRomanSuffixStart(fullName);
  if (start === null) return fullName;
  const suffix = fullName.slice(start);
  const roman = intToRoman(romanToInt(suffix) + 1, bufSize - start);
  if (roman === null) return fullName;
  return fullName.slice(0, start) + roman;
}
