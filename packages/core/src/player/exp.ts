/**
 * Experience and level progression, ported from reference/src/player.c
 * (Angband 4.2.6): the player_exp[] advancement table, player_exp_gain /
 * player_exp_lose with the adjust_level engine (level loss below the
 * threshold, level gain with stat restoration and highest-level tracking),
 * player_stat_inc / player_stat_dec, plus roll_hp from player-birth.c (the
 * per-level hitdice rolls constrained to the 3/8..5/8 band) and the
 * monster-kill experience formula from mon-util.c player_kill_monster
 * (mexp * rlev / plev with 16.16 fractional carry).
 *
 * Level changes ripple into derived state (hitpoints, spells, mana,
 * bonuses); the caller supplies that recomputation through ExpDeps.
 * onLevelChange, keeping this module free of the session's wiring. Each
 * level gained also fires ExpDeps.onGainLevel (history_add(HIST_GAIN_LEVEL),
 * player.c L246-247), which the session wires to player/history.ts.
 *
 * DEFERRED (ledgered in parity/ledger/player-exp.yaml): the PU_/PR_ update
 * masks (display), and upstream's handle_stuff interleaving (the port
 * recomputes once after the loops settle).
 */

import type { Rng } from "../rng";
import { PY_MAX_LEVEL, STAT_MAX } from "./types";
import type { Player } from "./player";

/** player_exp[PY_MAX_LEVEL] (player.c L48): exp needed to reach level i+2. */
export const PLAYER_EXP: readonly number[] = [
  10, 25, 45, 70, 100, 140, 200, 280, 380, 500,
  650, 850, 1100, 1400, 1800, 2300, 2900, 3600, 4400, 5400,
  6800, 8400, 10200, 12500, 17500, 25000, 35000, 50000, 75000, 100000,
  150000, 200000, 275000, 350000, 450000, 550000, 700000, 850000, 1000000,
  1250000, 1500000, 1800000, 2100000, 2400000, 2700000, 3000000, 3500000,
  4000000, 4500000, 5000000,
];

/** PY_MAX_EXP (player.h). */
export const PY_MAX_EXP = 99999999;

/** The world hooks a level change ripples through. */
export interface ExpDeps {
  /** RNG for rolling unrolled hitdice on the way up. */
  rng: Rng;
  /** "Welcome to level %d." and the drain messages. */
  msg?(text: string): void;
  /**
   * PU_BONUS | PU_HP | PU_SPELLS: recompute mhp / spells / mana / bonuses
   * from the new level. Runs once after the level loops settle.
   */
  onLevelChange?(p: Player): void;
  /**
   * history_add(HIST_GAIN_LEVEL) (player.c L246-247): fired once per level
   * gained, inside the verbose block, immediately BEFORE the "Welcome to
   * level %d." message. `lev` is the just-reached level (p.lev already
   * incremented). Not called when verbose is false (a save-load replay of
   * adjustLevel must not re-log levels already recorded).
   */
  onGainLevel?(p: Player, lev: number): void;
}

/** exp needed for level `lev` (adjust_level's table read with expfact). */
function expToReach(p: Player, lev: number): number {
  return Math.trunc(((PLAYER_EXP[lev - 2] ?? 0) * p.expFactor) / 100);
}

/**
 * roll_hp (player-birth.c): roll the cumulative per-level hitdice, rerolling
 * until the final total lands within the 3/8..5/8 band. Level 1 is the full
 * hitdie (birth sets it); this fills levels 2..PY_MAX_LEVEL.
 */
export function rollHp(p: Player, rng: Rng): void {
  const minValue =
    Math.trunc((PY_MAX_LEVEL * (p.hitdie - 1) * 3) / 8) + PY_MAX_LEVEL;
  const maxValue =
    Math.trunc((PY_MAX_LEVEL * (p.hitdie - 1) * 5) / 8) + PY_MAX_LEVEL;
  p.playerHp[0] = p.hitdie;
  for (;;) {
    for (let i = 1; i < PY_MAX_LEVEL; i++) {
      p.playerHp[i] = (p.playerHp[i - 1] ?? 0) + rng.randint1(p.hitdie);
    }
    const total = p.playerHp[PY_MAX_LEVEL - 1] ?? 0;
    if (total < minValue || total > maxValue) continue;
    break;
  }
}

/**
 * adjust_level (player.c L208): clamp experience, sync max_exp, walk the
 * level down while under the previous threshold and up while over the next,
 * restoring drained stats and announcing each level gained, then track the
 * highest level max_exp supports and recompute the derived state.
 */
export function adjustLevel(p: Player, deps: ExpDeps, verbose = true): void {
  if (p.exp < 0) p.exp = 0;
  if (p.maxExp < 0) p.maxExp = 0;
  if (p.exp > PY_MAX_EXP) p.exp = PY_MAX_EXP;
  if (p.maxExp > PY_MAX_EXP) p.maxExp = PY_MAX_EXP;
  if (p.exp > p.maxExp) p.maxExp = p.exp;

  const levBefore = p.lev;

  while (p.lev > 1 && p.exp < expToReach(p, p.lev)) {
    p.lev--;
  }

  while (p.lev < PY_MAX_LEVEL && p.exp >= expToReach(p, p.lev + 1)) {
    p.lev++;
    if (p.lev > p.maxLev) p.maxLev = p.lev;
    if (verbose) {
      deps.onGainLevel?.(p, p.lev);
      deps.msg?.(`Welcome to level ${p.lev}.`);
    }
    /* effect_simple(EF_RESTORE_STAT) x5: drained stats come back. */
    for (let i = 0; i < STAT_MAX; i++) {
      if ((p.statCur[i] ?? 0) < (p.statMax[i] ?? 0)) {
        p.statCur[i] = p.statMax[i] ?? 0;
      }
    }
  }

  while (p.maxLev < PY_MAX_LEVEL && p.maxExp >= expToReach(p, p.maxLev + 1)) {
    p.maxLev++;
  }

  if (p.lev !== levBefore) {
    /* Roll any hitdice the new levels need (upstream rolls all at birth;
     * a pre-roll_hp save may carry zeroes). */
    for (let i = 1; i < p.lev; i++) {
      if (!(p.playerHp[i] ?? 0)) {
        p.playerHp[i] = (p.playerHp[i - 1] ?? 0) + deps.rng.randint1(p.hitdie);
      }
    }
  }
  deps.onLevelChange?.(p);
}

/** player_exp_gain (player.c L269). */
export function playerExpGain(p: Player, amount: number, deps: ExpDeps): void {
  p.exp += amount;
  if (p.exp < p.maxExp) p.maxExp += Math.trunc(amount / 10);
  adjustLevel(p, deps);
}

/** player_exp_lose (player.c L277). */
export function playerExpLose(
  p: Player,
  amount: number,
  permanent: boolean,
  deps: ExpDeps,
): void {
  if (p.exp < amount) amount = p.exp;
  p.exp -= amount;
  if (permanent) p.maxExp -= amount;
  adjustLevel(p, deps);
}

/**
 * The kill reward slice of player_kill_monster (mon-util.c L1067): exp is
 * mexp * rlev / plev, with the remainder carried in the 16.16 exp_frac
 * accumulator, then granted through player_exp_gain.
 */
export function playerKillExp(
  p: Player,
  race: { mexp: number; level: number },
  deps: ExpDeps,
): void {
  const div = p.lev;
  const raw = race.mexp * race.level;
  let newExp = Math.trunc(raw / div);
  const newExpFrac = Math.trunc(((raw % div) * 0x10000) / div) + p.expFrac;
  if (newExpFrac >= 0x10000) {
    newExp++;
    p.expFrac = newExpFrac - 0x10000;
  } else {
    p.expFrac = newExpFrac;
  }
  playerExpGain(p, newExp, deps);
}

/** player_stat_inc (player.c L145): raise a stat toward 18/100. */
export function playerStatInc(p: Player, rng: Rng, stat: number): boolean {
  const v = p.statCur[stat] ?? 0;
  if (v >= 18 + 100) return false;
  if (v < 18) {
    p.statCur[stat] = v + 1;
  } else if (v < 18 + 90) {
    let gain = Math.trunc((Math.trunc((18 + 100 - v) / 2) + 3) / 2);
    if (gain < 1) gain = 1;
    p.statCur[stat] = Math.min(
      v + rng.randint1(gain) + Math.trunc(gain / 2),
      18 + 99,
    );
  } else {
    p.statCur[stat] = 18 + 100;
  }
  if ((p.statCur[stat] ?? 0) > (p.statMax[stat] ?? 0)) {
    p.statMax[stat] = p.statCur[stat] ?? 0;
  }
  return true;
}

/**
 * player_stat_dec (player.c L171): drain a stat (a tenth over 18/10, to 18
 * from the teens, one point above 3); permanent drains lower the max too.
 */
export function playerStatDec(
  p: Player,
  stat: number,
  permanent: boolean,
): boolean {
  let cur = p.statCur[stat] ?? 0;
  let max = p.statMax[stat] ?? 0;
  if (cur > 18 + 10) cur -= 10;
  else if (cur > 18) cur = 18;
  else if (cur > 3) cur -= 1;
  let res = cur !== (p.statCur[stat] ?? 0);

  if (permanent) {
    if (max > 18 + 10) max -= 10;
    else if (max > 18) max = 18;
    else if (max > 3) max -= 1;
    res = max !== (p.statMax[stat] ?? 0);
  }

  if (res) {
    p.statCur[stat] = cur;
    p.statMax[stat] = max;
  }
  return res;
}

/**
 * player_scramble_stats (player-util.c L375): swap the stats at random with
 * a Fisher-Yates shuffle, recording the swaps in statMap so they can be
 * reverted. The caller marks PU_BONUS.
 */
export function playerScrambleStats(p: Player, rng: Rng): void {
  for (let i = STAT_MAX - 1; i > 0; --i) {
    const j = rng.randint0(i);

    const max1 = p.statMax[i]!;
    const cur1 = p.statCur[i]!;
    p.statMax[i] = p.statMax[j]!;
    p.statCur[i] = p.statCur[j]!;
    p.statMax[j] = max1;
    p.statCur[j] = cur1;

    /* Record what we did */
    const swap = p.statMap[i]!;
    p.statMap[i] = p.statMap[j]!;
    p.statMap[j] = swap;
  }
}

/**
 * player_fix_scramble (player-util.c L409): revert all prior stat swaps.
 * No effect if the stats have not been swapped. The caller marks PU_BONUS.
 */
export function playerFixScramble(p: Player): void {
  const newCur = new Array<number>(STAT_MAX);
  const newMax = new Array<number>(STAT_MAX);
  for (let i = 0; i < STAT_MAX; ++i) {
    newCur[p.statMap[i]!] = p.statCur[i]!;
    newMax[p.statMap[i]!] = p.statMax[i]!;
  }
  for (let i = 0; i < STAT_MAX; ++i) {
    p.statCur[i] = newCur[i]!;
    p.statMax[i] = newMax[i]!;
    p.statMap[i] = i;
  }
}
