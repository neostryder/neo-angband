/**
 * Per-Borg mutable state for the combat/defense/escape cluster - the faithful
 * analog of the file-scope globals the C fight code read and wrote while it
 * "simulated then committed" a maneuver (reference/src/borg/borg-fight-attack.c,
 * borg-fight-defend.c, borg-escape.c).
 *
 * Upstream these are true globals:
 *   - borg_simulate            (borg.h): dry-run vs commit flag
 *   - borg_temp_x/y/n          (borg-flow.c): the near-monster scratch list
 *     borg_attack rebuilds and reads within a single call
 *   - successful_target        (borg-fight-attack.c): shot-tracking state
 *   - target_closest           (borg-fight-attack.c)
 *   - borg_tp_other_*          (borg-fight-attack.c): Teleport-Other exclusion
 *     list (the indices live in the danger globals so borg_danger reads them)
 *   - borg_fighting_unique     (borg-flow-kill.c): 0 none, 1..8 uniques, >=10
 *     Morgoth/questor; drives most escape/defend thresholds
 *   - borg_t_antisummon, borg_began (borg-flow.c): anti-loop timers
 *
 * The C keypress side effects (borg_keypress / borg_target) are replaced by the
 * perceive/act contract: an aux function, when committing (simulate=false),
 * stores the resulting AgentCommand on `pending` (and sets targets via ctx.act),
 * which the orchestrator (borgAttack/borgDefend) then returns. This preserves
 * the exact two-phase "simulate all, pick best, run best for real" pattern.
 *
 * Bundled per BorgWorld via a WeakMap so multiple Borgs / tests stay isolated,
 * exactly as danger/state.ts does for the danger globals.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgWorld } from "../world/model";

/** The combat cluster's mutable scratch state (one per Borg). */
export interface FightState {
  /** borg_simulate: dry-run (true) or commit (false). */
  simulate: boolean;
  /** The command produced during a commit pass (replaces borg_keypress). */
  pending: AgentCommand | null;

  /** borg_temp_x/y/n: near-monster scratch list, rebuilt each borg_attack. */
  readonly tempX: number[];
  readonly tempY: number[];
  tempN: number;

  /** successful_target: shot-tracking (0 none, >0 good, <0 missed). */
  successfulTarget: number;
  /** target_closest: tap/vampire-strike miss tracking. */
  targetClosest: number;

  /**
   * borg_fighting_unique: 0 none, 1..8 uniques nearby, 9 summoner-unique,
   * >=10 questor/Morgoth. Set by borg_update upstream (P8.6); default 0.
   */
  fightingUnique: number;
  /** borg_fighting_summoner: a summoner is engaged. */
  fightingSummoner: boolean;
  /** borg_fighting_evil_unique: the engaged unique is evil (Holy Word path). */
  fightingEvilUnique: boolean;

  /** borg_t_antisummon: clock at anti-summon corridor entry (borg-flow.c). */
  tAntisummon: number;
  /** borg_began: clock at level entry, for boredom thresholds. */
  began: number;
  /** borg_time_town: turns spent this town trip (borg-flow.c). */
  timeTown: number;

  /**
   * borg_game_ratio: game-turns per borg-turn (borg-trait.c). Only used by the
   * defend Resistance-refresh pre-check; a faithful nominal default (10x normal
   * speed energy) until P8.6 wires the true ratio.
   */
  gameRatio: number;
  /** borg_cfg[BORG_PLAYS_RISKY]: risk-tolerant play (borg config). */
  playsRisky: boolean;
}

const STATES = new WeakMap<BorgWorld, FightState>();

/** The fight state for a world, created lazily (borg_init zero state). */
export function getFightState(world: BorgWorld): FightState {
  let st = STATES.get(world);
  if (!st) {
    st = {
      simulate: true,
      pending: null,
      tempX: [],
      tempY: [],
      tempN: 0,
      successfulTarget: 0,
      targetClosest: 0,
      fightingUnique: 0,
      fightingSummoner: false,
      fightingEvilUnique: false,
      tAntisummon: 0,
      began: 0,
      timeTown: 0,
      gameRatio: 10,
      playsRisky: false,
    };
    STATES.set(world, st);
  }
  return st;
}

/** C integer division: truncate toward zero (a/b in C for ints). */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** ABS for ints. */
export function iabs(a: number): number {
  return a < 0 ? -a : a;
}
